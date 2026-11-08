const mysql = require("mysql2");
const { jsonSafeParse } = require("../commons/function");

let pool = null;
const WHERE_INVALID = "Invalid filter object";

/**
 * Escapes an identifier with MariaDB backticks, stripping null bytes.
 */
function escapeId(name) {
  if (typeof name !== "string") name = String(name);
  name = name.replace(/\0/g, "");
  return mysql.escapeId(name);
}

/**
 * Connect to MariaDB using the mysql2 connection pool.
 * Note: MariaDB uses the MySQL wire protocol, but has distinct dialect features:
 * - JSON is an alias for LONGTEXT with CHECK (JSON_VALID(col)); returned as strings.
 * - MariaDB does not support MySQL 8's `AS new_row` alias in ON DUPLICATE KEY UPDATE.
 * - MariaDB supports ANSI SQL sequences and native UUID (10.7+).
 */
function connect(credentials) {
  // Force UTC timezone so timestamps are consistent
  credentials.timezone = "+00:00";
  // Enable multiple statements by default so multi-query migration files run in one call
  if (credentials.multipleStatements === undefined) {
    credentials.multipleStatements = true;
  }
  pool = mysql.createPool(credentials);
  return pool;
}

function query(sql, parameter = []) {
  return new Promise((resolve, reject) => {
    pool.query(sql, parameter, function (error, results) {
      if (error) {
        return reject(error);
      }
      resolve(results);
    });
  });
}

function sort_builder(sort) {
  if (!sort || sort.length < 1) {
    return {
      query: "",
      value: [],
    };
  }
  let query_item = [];
  let value = [];
  for (const item of sort) {
    if (typeof item !== "string") continue;
    let col = item.trim();
    if (col.startsWith("-")) {
      query_item.push("?? DESC");
      value.push(col.slice(1).trim());
    } else {
      query_item.push("?? ASC");
      value.push(col.startsWith("+") ? col.slice(1).trim() : col);
    }
  }
  let query = query_item.length > 0 ? "ORDER BY " + query_item.join(",") : "";
  return {
    query,
    value,
  };
}

function where(filter, safeDelete = null) {
  if (filter !== null && filter !== "" && !Array.isArray(filter)) {
    return null;
  }
  let filterCopy;
  try {
    if (
      filter === null ||
      filter === "" ||
      filter.length === 0 ||
      (Array.isArray(filter[0]) && filter[0].length === 0) ||
      (Array.isArray(filter[0]) &&
        Array.isArray(filter[0][0]) &&
        filter[0][0].length === 0)
    ) {
      if (safeDelete === null) {
        return {
          query: "",
          value: [],
        };
      } else {
        filterCopy = [[]];
      }
    } else {
      // Clone filter array to prevent in-place mutation of caller's data
      filterCopy = filter.map((group) => group.map((cond) => [...cond]));
    }
  } catch {
    return null;
  }

  if (safeDelete !== null) {
    for (const filterItem of filterCopy) {
      filterItem.push([safeDelete, "=", 0]);
    }
  }

  const valid_conditionals = [
    "=",
    "like",
    "not like",
    "in",
    "not in",
    "<",
    ">",
    "<=",
    ">=",
    "!=",
  ];
  let conditionOr = [];
  let value = [];

  for (const i of filterCopy) {
    let conditionAnd = [];
    for (const j of i) {
      if (!valid_conditionals.includes(j[1])) {
        return null;
      }
      if ((j[1] === "in" || j[1] === "not in") && !Array.isArray(j[2])) {
        return null;
      }
      if (j[1] === "in" || j[1] === "not in") {
        conditionAnd.push("?? " + j[1] + " " + arrayParam(j[2].length));
        value.push(j[0], ...j[2]);
      } else if (j[1] === "like" || j[1] === "not like") {
        conditionAnd.push("?? " + j[1] + " ?");
        value.push(j[0], "%" + j[2] + "%");
      } else {
        conditionAnd.push("?? " + j[1] + " ?");
        value.push(j[0], j[2]);
      }
    }
    conditionOr.push(conditionAnd.join(" AND "));
  }

  let query = "WHERE ((" + conditionOr.join(") OR (") + "))";
  return {
    query,
    value,
  };
}

async function get(table, filter = [], sort = [], safeDelete = null, options = {}) {
  const { count = true, limit } = options || {};
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }
  let statement = `SELECT * FROM ?? ${whereData.query} ${sortData.query}`.trim();
  const params = [table, ...whereData.value, ...sortData.value];
  if (limit != null) {
    statement += ` LIMIT ?`;
    params.push(parseInt(limit, 10));
  }
  statement += `;`;
  const [results] = await pool
    .promise()
    .query(statement, params);
  const c =
    count !== false && limit != null
      ? await qcount(table, filter, safeDelete)
      : results.length;
  // jsonSafeParse is critical for MariaDB because MariaDB returns JSON as LONGTEXT strings
  return { data: jsonSafeParse(results), count: c };
}

async function list(
  table,
  filter = [],
  sort = [],
  safeDelete = null,
  page = 0,
  limit = 30,
  options = {},
) {
  const { count: needCount = true } = options || {};
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }
  const offset = page * limit;
  const statement = `SELECT * FROM ?? ${whereData.query} ${sortData.query} LIMIT ? OFFSET ?;`.trim();
  const [results] = await pool
    .promise()
    .query(statement, [
      table,
      ...whereData.value,
      ...sortData.value,
      limit,
      offset,
    ]);
  const count =
    needCount !== false
      ? await qcount(table, filter, safeDelete)
      : results.length;
  return { data: jsonSafeParse(results), count };
}

async function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }
  const statement = `SELECT count(*) AS number FROM ?? ${whereData.query};`.trim();
  const [results] = await pool
    .promise()
    .query(statement, [table, ...whereData.value]);
  return results && results[0] ? results[0].number : 0;
}

async function remove(table, filter, safeDelete = null) {
  const whereData = where(filter);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }
  if (whereData.value.length < 1) {
    throw new Error("unable to remove as there is not filter attributes");
  }

  let statement;
  let params;
  if (safeDelete != null) {
    statement = `UPDATE ?? SET ?? = 1 ${whereData.query};`.trim();
    params = [table, safeDelete, ...whereData.value];
  } else {
    statement = `DELETE FROM ?? ${whereData.query};`.trim();
    params = [table, ...whereData.value];
  }

  const [results] = await pool.promise().query(statement, params);
  const rows = results ? results.affectedRows || 0 : 0;
  return {
    message: rows + " " + table + (rows > 1 ? "s" : "") + " removed",
  };
}

function getChangeParameter(row, uniqueKeys, onDuplicate = true) {
  const insertColumn = Object.keys(row);
  const updateColumn = [];
  let isDuplicate = onDuplicate;

  if (onDuplicate) {
    for (const column of insertColumn) {
      if (!uniqueKeys.includes(column)) {
        updateColumn.push(column);
        updateColumn.push(column);
      }
    }
    // Fall back to INSERT IGNORE if no non-unique columns to update
    if (updateColumn.length === 0) {
      isDuplicate = false;
    }
  }

  const queryStart =
    "INSERT " +
    (!isDuplicate ? "IGNORE" : "") +
    " INTO ?? " +
    insertParam(insertColumn.length);

  let queryEnd = "";
  if (isDuplicate) {
    const updatePairs = [];
    for (let i = 0; i < updateColumn.length; i += 2) {
      // In MariaDB, VALUES(col) is the supported dialect syntax (unlike MySQL 8's row aliases)
      updatePairs.push("??=VALUES(??)");
    }
    queryEnd = " ON DUPLICATE KEY UPDATE " + updatePairs.join(",");
  }
  queryEnd += ";";

  return [
    `${queryStart} VALUES ? ${queryEnd}`,
    insertColumn,
    updateColumn,
  ];
}

async function upsert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  let count = 0;
  let total = 0;
  const promise = [];

  const [statement, insertColumn, updateColumn] = getChangeParameter(
    array[0],
    uniqueKeys,
  );

  let value = [];
  for (const v of array) {
    const entry = [];
    for (const col of insertColumn) {
      entry.push(v[col]);
    }
    value.push(entry);
    count++;
    total++;
    if (count > 999) {
      promise.push(
        pool
          .promise()
          .query(statement, [
            table,
            ...insertColumn,
            value,
            ...updateColumn,
          ]),
      );
      value = [];
      count = 0;
    }
  }
  if (count > 0) {
    promise.push(
      pool
        .promise()
        .query(statement, [table, ...insertColumn, value, ...updateColumn]),
    );
  }

  const response = {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
  };

  const results = await Promise.all(promise);
  if (total === 1 && results[0]?.[0]) {
    response["id"] = results[0][0].insertId;
  }
  return response;
}

async function insert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  let count = 0;
  let total = 0;
  const promise = [];

  const [statement, insertColumn] = getChangeParameter(
    array[0],
    uniqueKeys,
    false,
  );

  let value = [];
  for (const v of array) {
    const entry = [];
    for (const col of insertColumn) {
      entry.push(v[col]);
    }
    value.push(entry);
    count++;
    total++;
    if (count > 999) {
      promise.push(
        pool.promise().query(statement, [table, ...insertColumn, value]),
      );
      value = [];
      count = 0;
    }
  }
  if (count > 0) {
    promise.push(
      pool.promise().query(statement, [table, ...insertColumn, value]),
    );
  }

  const response = {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
  };

  const results = await Promise.all(promise);
  if (total === 1 && results[0]?.[0]) {
    response["id"] = results[0][0].insertId;
  }
  return response;
}

async function disconnect() {
  if (pool) {
    await pool.promise().end();
    pool = null;
  }
}

function insertParam(number) {
  let str = "";
  for (let i = 0; i < number; i++) {
    str += i === 0 ? "??" : ",??";
  }
  return `(${str})`;
}

function arrayParam(number) {
  let str = "";
  for (let i = 0; i < number; i++) {
    str += i === 0 ? "?" : ",?";
  }
  return `(${str})`;
}

function namify(text) {
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = {
  connect,
  get,
  list,
  where,
  sort_builder,
  query,
  qcount,
  remove,
  delete: remove,
  upsert,
  change: upsert,
  insert,
  disconnect,
  close: disconnect,
  escapeId,
  pool: null,
};
