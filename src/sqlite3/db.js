const Database = require("better-sqlite3");
const { jsonSafeParse } = require("../commons/function");

let db = null;
const WHERE_INVALID = "Invalid filter object";

function connect(config) {
  const dbPath = config.database || config.filename || ":memory:";
  const options = {};
  if (config.readonly) options.readonly = true;
  if (config.fileMustExist) options.fileMustExist = true;
  if (config.verbose) options.verbose = config.verbose;
  db = new Database(dbPath, options);
  db.pragma("journal_mode = WAL");
  return db;
}

/**
 * Checks if SQL contains multiple statements outside string literals and comments.
 */
function isMultiStatement(sql) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let semicolonCount = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inSingleQuote) {
      if (ch === "'") {
        if (next === "'") {
          i++;
        } else {
          inSingleQuote = false;
        }
      }
    } else if (inDoubleQuote) {
      if (ch === '"') {
        if (next === '"') {
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
    } else if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        i++;
        inBlockComment = false;
      }
    } else {
      if (ch === "'") {
        inSingleQuote = true;
      } else if (ch === '"') {
        inDoubleQuote = true;
      } else if (ch === "-" && next === "-") {
        inLineComment = true;
      } else if (ch === "/" && next === "*") {
        inBlockComment = true;
      } else if (ch === ";") {
        const remaining = sql.slice(i + 1).replace(/--[^\n]*/g, "").trim();
        if (remaining.length > 0) {
          semicolonCount++;
        }
      }
    }
  }
  return semicolonCount > 0;
}

function query(sql, parameter = []) {
  // Use exec() for multi-statement SQL (e.g., migration files)
  if (parameter.length === 0 && isMultiStatement(sql)) {
    db.exec(sql);
    return { changes: 0 };
  }
  const stmt = db.prepare(sql);
  if (sql.trimStart().match(/^(SELECT|PRAGMA|WITH\s)/i)) {
    return stmt.all(...parameter);
  }
  return stmt.run(...parameter);
}

function sort_builder(sort) {
  if (!sort || sort.length < 1) {
    return { query: "", value: [] };
  }
  let query_items = [];
  for (const item of sort) {
    if (typeof item !== "string") continue;
    let col = item.trim();
    let dir = "ASC";
    if (col.startsWith("-")) {
      col = col.substring(1).trim();
      dir = "DESC";
    }
    if (!col) continue;
    query_items.push(`${escapeId(col)} ${dir}`);
  }
  return {
    query: query_items.length > 0 ? "ORDER BY " + query_items.join(",") : "",
    value: [],
  };
}

function where(filter, safeDelete = null) {
  if (filter !== null && filter !== "" && !Array.isArray(filter)) {
    return null;
  }
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
        return { query: "", value: [] };
      } else {
        filter = [[]];
      }
    }
  } catch (err) {
    return null;
  }

  if (safeDelete !== null) {
    for (const filterItem of filter) {
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

  for (const i of filter) {
    let conditionAnd = [];
    for (const j of i) {
      if (!valid_conditionals.includes(j[1])) {
        return null;
      }
      if ((j[1] === "in" || j[1] === "not in") && !Array.isArray(j[2])) {
        return null;
      }
      if (j[1] === "in" || j[1] === "not in") {
        conditionAnd.push(
          escapeId(j[0]) + " " + j[1] + " (" + arrayParam(j[2].length) + ")",
        );
        value.push(...j[2]);
      } else if (j[1] === "like" || j[1] === "not like") {
        conditionAnd.push(escapeId(j[0]) + " " + j[1] + " ?");
        value.push("%" + j[2] + "%");
      } else {
        conditionAnd.push(escapeId(j[0]) + " " + j[1] + " ?");
        value.push(j[2]);
      }
    }
    conditionOr.push(conditionAnd.join(" AND "));
  }

  return {
    query: "WHERE ((" + conditionOr.join(") OR (") + "))",
    value,
  };
}

function get(table, filter = [], sort = [], safeDelete = null) {
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  const sortQuery = resolveSortIdentifiers(sortData);
  const statement = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortQuery}`.trim();
  const rows = db.prepare(statement).all(...whereData.value);
  const count = qcount(table, filter, safeDelete);
  return { data: jsonSafeParse(rows), count };
}

function list(
  table,
  filter = [],
  sort = [],
  safeDelete = null,
  page = 0,
  limit = 30,
) {
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  const sortQuery = resolveSortIdentifiers(sortData);
  const offset = page * limit;
  const statement = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortQuery} LIMIT ? OFFSET ?`.trim();
  const rows = db.prepare(statement).all(...whereData.value, limit, offset);
  const count = qcount(table, filter, safeDelete);
  return { data: jsonSafeParse(rows), count };
}

function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    return 0;
  }
  const statement = `SELECT count(*) AS number FROM ${escapeId(table)} ${whereData.query}`.trim();
  const result = db.prepare(statement).get(...whereData.value);
  return result ? result.number : 0;
}

function remove(table, filter, safeDelete = null) {
  const whereData = where(filter);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }
  if (whereData.value.length < 1) {
    throw new Error("unable to remove as there are no filter attributes");
  }

  let statement;
  let params;
  if (safeDelete != null) {
    statement = `UPDATE ${escapeId(table)} SET ${escapeId(safeDelete)} = 1 ${whereData.query}`.trim();
    params = whereData.value;
  } else {
    statement = `DELETE FROM ${escapeId(table)} ${whereData.query}`.trim();
    params = whereData.value;
  }

  const result = db.prepare(statement).run(...params);
  const rows = result.changes || 0;
  return {
    message: rows + " " + table + (rows > 1 ? "s" : "") + " removed",
  };
}

function upsert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;
  const columns = Object.keys(array[0]);

  if (!uniqueKeys || uniqueKeys.length === 0) {
    return insert(table, data, uniqueKeys);
  }

  const colList = columns.map(escapeId).join(",");
  const placeholders = columns.map(() => "?").join(",");
  const nonUniqueColumns = columns.filter((c) => !uniqueKeys.includes(c));
  const updateSet = nonUniqueColumns
    .map((c) => `${escapeId(c)} = excluded.${escapeId(c)}`)
    .join(",");
  const conflictCols = uniqueKeys.map(escapeId).join(",");

  let sql;
  if (updateSet) {
    sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES (${placeholders}) ON CONFLICT(${conflictCols}) DO UPDATE SET ${updateSet}`;
  } else {
    sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES (${placeholders}) ON CONFLICT(${conflictCols}) DO NOTHING`;
  }

  const stmt = db.prepare(sql);
  let lastId = 0;

  const runAll = db.transaction(() => {
    for (const row of array) {
      const vals = columns.map((c) => row[c]);
      const result = stmt.run(...vals);
      if (result.lastInsertRowid) {
        lastId = Number(result.lastInsertRowid);
      }
    }
  });
  runAll();

  const response = {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
  };
  if (total === 1) {
    response.id = lastId;
  }
  return response;
}

function insert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;
  const columns = Object.keys(array[0]);

  const colList = columns.map(escapeId).join(",");
  const placeholders = columns.map(() => "?").join(",");

  let sql;
  if (uniqueKeys && uniqueKeys.length > 0) {
    const conflictCols = uniqueKeys.map(escapeId).join(",");
    sql = `INSERT OR IGNORE INTO ${escapeId(table)} (${colList}) VALUES (${placeholders})`;
  } else {
    sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES (${placeholders})`;
  }

  const stmt = db.prepare(sql);
  let lastId = 0;

  const runAll = db.transaction(() => {
    for (const row of array) {
      const vals = columns.map((c) => row[c]);
      const result = stmt.run(...vals);
      if (result.lastInsertRowid) {
        lastId = Number(result.lastInsertRowid);
      }
    }
  });
  runAll();

  const response = {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
  };
  if (total === 1) {
    response.id = lastId;
  }
  return response;
}

function disconnect() {
  if (db) {
    db.close();
    db = null;
  }
}

// --- Utility helpers ---

function escapeId(name) {
  if (typeof name !== "string") {
    name = String(name);
  }
  name = name.replace(/\0/g, "");
  return name
    .split(".")
    .map((part) => {
      part = part.trim();
      if (part.startsWith('"') && part.endsWith('"')) {
        part = part.slice(1, -1);
      }
      return '"' + part.replace(/"/g, '""') + '"';
    })
    .join(".");
}

function arrayParam(number) {
  let str = "";
  for (let i = 0; i < number; i++) {
    str += i === 0 ? "?" : ",?";
  }
  return str;
}

function resolveSortIdentifiers(sortData) {
  if (!sortData.query) return "";
  let q = sortData.query;
  if (sortData.value && sortData.value.length > 0) {
    for (const v of sortData.value) {
      q = q.replace("??", escapeId(v));
    }
  }
  return q;
}

function namify(text) {
  return text
    .replace("_", " ")
    .replace(/(^\w{1})|(\s+\w{1})/g, (letter) => letter.toUpperCase());
}

let txDepth = 0;

async function transaction(fn) {
  if (typeof fn !== "function") {
    throw new Error("Transaction requires a callback function");
  }
  const isTopLevel = txDepth === 0;
  const spName = `sp_${txDepth}`;
  txDepth++;

  if (isTopLevel) {
    query("BEGIN");
  } else {
    query(`SAVEPOINT ${spName}`);
  }

  const kafkaBuffer = isTopLevel ? [] : null;
  const tx = {
    adapter: module.exports,
    _kafkaBuffer: kafkaBuffer,
    query: (sql, params) => query(sql, params),
    model: (modelOrTable) => {
      const modelFn = require("../commons/model");
      const m =
        typeof modelOrTable === "string"
          ? modelFn(module.exports, modelOrTable)
          : modelOrTable;
      return typeof m?.withTx === "function" ? m.withTx(tx) : m;
    },
  };

  try {
    const result = await fn(tx);
    if (isTopLevel) {
      query("COMMIT");
      if (kafkaBuffer && kafkaBuffer.length > 0) {
        const { produce } = require("../commons/kafka");
        for (const msg of kafkaBuffer) {
          produce(msg.table, msg.action, msg.data);
        }
      }
    } else {
      query(`RELEASE SAVEPOINT ${spName}`);
    }
    txDepth--;
    return result;
  } catch (err) {
    if (isTopLevel) {
      try {
        query("ROLLBACK");
      } catch (_) {}
    } else {
      try {
        query(`ROLLBACK TO SAVEPOINT ${spName}`);
      } catch (_) {}
    }
    txDepth--;
    throw err;
  }
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
  transaction,
};
