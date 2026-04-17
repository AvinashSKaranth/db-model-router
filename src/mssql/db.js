const sql = require("mssql");
const { jsonSafeParse } = require("../commons/function");

let pool = null;
const WHERE_INVALID = "Invalid filter object";

const RETRYABLE_ERRORS = [
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEOUT",
  "ESOCKET",
];

const ERROR_MAP = {
  2627: "ER_DUP_ENTRY", // Violation of PRIMARY KEY / UNIQUE constraint
  2601: "ER_DUP_ENTRY", // Cannot insert duplicate key row
};

function mapMssqlError(err) {
  const num = err.number || err.originalError?.number || 0;
  if (ERROR_MAP[num]) {
    err.code = ERROR_MAP[num];
    err.sqlMessage = err.message;
    return err;
  }
  if (!err.sqlMessage) err.sqlMessage = err.message;
  return err;
}

function isRetryable(err) {
  const code = err.code || "";
  return RETRYABLE_ERRORS.includes(code);
}

async function connect(config) {
  const mssqlConfig = {
    server: config.server || config.host || process.env.DB_HOST || "localhost",
    port: parseInt(config.port || process.env.DB_PORT || 1433),
    database: config.database || process.env.DB_NAME,
    user: config.user || process.env.DB_USER,
    password: config.password || process.env.DB_PASS,
    pool: {
      max: parseInt(config.connectionLimit || process.env.DB_POOL_MAX || 50),
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: config.options?.encrypt ?? false,
      trustServerCertificate: config.options?.trustServerCertificate ?? true,
      enableArithAbort: true,
    },
  };

  pool = await sql.connect(mssqlConfig);
  return pool;
}

async function executeWithRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isRetryable(err)) {
      return await fn();
    }
    throw mapMssqlError(err);
  }
}

async function query(sqlStr, parameter = []) {
  return executeWithRetry(async () => {
    const request = pool.request();
    for (let i = 0; i < parameter.length; i++) {
      request.input("param" + i, parameter[i]);
    }
    // Replace positional @paramN placeholders if not already present
    const result = await request.query(sqlStr);
    return result.recordset || { affectedRows: result.rowsAffected?.[0] || 0 };
  });
}

function sort_builder(sort) {
  if (!sort || sort.length < 1) {
    return { query: "", value: [] };
  }
  let items = [];
  for (const item of sort) {
    if (item[0] === "-") {
      items.push(escapeId(item.replace("-", "")) + " DESC");
    } else {
      items.push(escapeId(item) + " ASC");
    }
  }
  return { query: "ORDER BY " + items.join(","), value: [] };
}

function where(filter, safeDelete = null) {
  try {
    if (
      filter === null ||
      filter === "" ||
      filter.length === 0 ||
      filter[0].length == [[]] ||
      filter[0][0].length == [[[]]]
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
  let bindIdx = 0;

  for (const i of filter) {
    let conditionAnd = [];
    for (const j of i) {
      if (!valid_conditionals.includes(j[1])) return null;
      if ((j[1] === "in" || j[1] === "not in") && !Array.isArray(j[2]))
        return null;

      if (j[1] === "in" || j[1] === "not in") {
        const placeholders = j[2]
          .map(() => {
            const p = "@param" + bindIdx;
            bindIdx++;
            return p;
          })
          .join(",");
        conditionAnd.push(`${escapeId(j[0])} ${j[1]} (${placeholders})`);
        value.push(...j[2]);
      } else if (j[1] === "like" || j[1] === "not like") {
        const p = "@param" + bindIdx;
        bindIdx++;
        conditionAnd.push(`${escapeId(j[0])} ${j[1]} ${p}`);
        value.push("%" + j[2] + "%");
      } else {
        const p = "@param" + bindIdx;
        bindIdx++;
        conditionAnd.push(`${escapeId(j[0])} ${j[1]} ${p}`);
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

async function get(table, filter = [], sort = [], safeDelete = null) {
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  const sqlStr = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query}`;
  const request = pool.request();
  for (let i = 0; i < whereData.value.length; i++) {
    request.input("param" + i, whereData.value[i]);
  }
  const result = await request.query(sqlStr);
  const rows = jsonSafeParse(result.recordset || []);
  const count = await qcount(table, filter, safeDelete);
  return { data: rows, count };
}

async function list(
  table,
  filter = [],
  sort = [],
  safeDelete = null,
  page = 0,
  limit = 30,
) {
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  const offset = page * limit;
  // MSSQL requires ORDER BY for OFFSET/FETCH. Use sort or default to (SELECT NULL)
  const orderClause = sortData.query || "ORDER BY (SELECT NULL)";
  const sqlStr = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${orderClause} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

  const request = pool.request();
  for (let i = 0; i < whereData.value.length; i++) {
    request.input("param" + i, whereData.value[i]);
  }
  const result = await request.query(sqlStr);
  const rows = jsonSafeParse(result.recordset || []);
  const count = await qcount(table, filter, safeDelete);
  return { data: rows, count };
}

async function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) return 0;
  const sqlStr = `SELECT COUNT(*) AS number FROM ${escapeId(table)} ${whereData.query}`;
  try {
    const request = pool.request();
    for (let i = 0; i < whereData.value.length; i++) {
      request.input("param" + i, whereData.value[i]);
    }
    const result = await request.query(sqlStr);
    return result.recordset?.[0]?.number || 0;
  } catch {
    return 0;
  }
}

async function remove(table, filter, safeDelete = null) {
  const whereData = where(filter);
  if (whereData == null) throw new Error(WHERE_INVALID);
  if (whereData.value.length < 1) {
    throw new Error("unable to remove as there are no filter attributes");
  }

  let sqlStr;
  if (safeDelete != null) {
    sqlStr = `UPDATE ${escapeId(table)} SET ${escapeId(safeDelete)} = 1 ${whereData.query}`;
  } else {
    sqlStr = `DELETE FROM ${escapeId(table)} ${whereData.query}`;
  }

  const request = pool.request();
  for (let i = 0; i < whereData.value.length; i++) {
    request.input("param" + i, whereData.value[i]);
  }
  const result = await request.query(sqlStr);
  const rows = result.rowsAffected?.[0] || 0;
  return { message: rows + " " + table + (rows > 1 ? "s" : "") + " removed" };
}

function namify(text) {
  return text
    .replace("_", " ")
    .replace(/(^\w{1})|(\s+\w{1})/g, (letter) => letter.toUpperCase());
}

function escapeId(name) {
  return "[" + name.replace(/\]/g, "]]") + "]";
}

async function upsert(table, data, uniqueKeys = []) {
  if (!uniqueKeys || uniqueKeys.length === 0) {
    return insert(table, data, uniqueKeys);
  }

  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;
  const columns = Object.keys(array[0]);
  const nonUniqueColumns = columns.filter((c) => !uniqueKeys.includes(c));
  let lastId = 0;

  for (const row of array) {
    const request = pool.request();
    let paramIdx = 0;

    // Build source VALUES
    const valuePlaceholders = columns.map((c) => {
      const p = "@param" + paramIdx;
      request.input("param" + paramIdx, row[c]);
      paramIdx++;
      return p;
    });

    const colList = columns.map(escapeId).join(",");
    const onClause = uniqueKeys
      .map((k) => `target.${escapeId(k)} = source.${escapeId(k)}`)
      .join(" AND ");

    let mergeSql = `MERGE INTO ${escapeId(table)} AS target`;
    mergeSql += ` USING (VALUES (${valuePlaceholders.join(",")})) AS source (${colList})`;
    mergeSql += ` ON ${onClause}`;

    if (nonUniqueColumns.length > 0) {
      const updateSet = nonUniqueColumns
        .map((c) => `target.${escapeId(c)} = source.${escapeId(c)}`)
        .join(",");
      mergeSql += ` WHEN MATCHED THEN UPDATE SET ${updateSet}`;
    }

    const insertCols = nonUniqueColumns.map((c) => escapeId(c)).join(",");
    const insertVals = nonUniqueColumns
      .map((c) => `source.${escapeId(c)}`)
      .join(",");
    mergeSql += ` WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
    mergeSql += ` OUTPUT INSERTED.*;`;

    try {
      const result = await request.query(mergeSql);
      if (result.recordset && result.recordset.length > 0) {
        const firstRow = result.recordset[0];
        lastId = firstRow.id || firstRow[Object.keys(firstRow)[0]] || 0;
      }
    } catch (e) {
      throw mapMssqlError(e);
    }
  }

  const response = {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
  };
  if (total === 1) response.id = lastId;
  return response;
}

async function insert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;
  const columns = Object.keys(array[0]);

  // Only use MERGE path if all unique key columns are present in the data
  const hasAllUniqueKeys =
    uniqueKeys &&
    uniqueKeys.length > 0 &&
    uniqueKeys.every((k) => columns.includes(k));

  if (total === 1) {
    const row = array[0];
    const request = pool.request();
    const colList = columns.map(escapeId).join(",");
    const valuePlaceholders = columns.map((c, i) => {
      request.input("param" + i, row[c]);
      return "@param" + i;
    });

    let sqlStr;
    if (hasAllUniqueKeys) {
      // INSERT with conflict ignore: use TRY/CATCH or check existence
      // For MSSQL, we use a MERGE with WHEN NOT MATCHED only
      const onClause = uniqueKeys
        .map((k) => `target.${escapeId(k)} = source.${escapeId(k)}`)
        .join(" AND ");
      const insertCols = columns.map(escapeId).join(",");
      const insertVals = columns.map((c) => `source.${escapeId(c)}`).join(",");

      sqlStr = `MERGE INTO ${escapeId(table)} AS target`;
      sqlStr += ` USING (VALUES (${valuePlaceholders.join(",")})) AS source (${colList})`;
      sqlStr += ` ON ${onClause}`;
      sqlStr += ` WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
      sqlStr += ` OUTPUT INSERTED.*;`;
    } else {
      sqlStr = `INSERT INTO ${escapeId(table)} (${colList}) OUTPUT INSERTED.* VALUES (${valuePlaceholders.join(",")})`;
    }

    try {
      const result = await request.query(sqlStr);
      const insertedRow = result.recordset?.[0];
      const insertId = insertedRow
        ? insertedRow.id || insertedRow[Object.keys(insertedRow)[0]] || 0
        : 0;
      return {
        rows: 1,
        message: `1 ${namify(table)} is saved`,
        type: "success",
        id: insertId,
      };
    } catch (e) {
      throw mapMssqlError(e);
    }
  }

  // Bulk insert
  for (const row of array) {
    const request = pool.request();
    const colList = columns.map(escapeId).join(",");
    const valuePlaceholders = columns.map((c, i) => {
      request.input("param" + i, row[c]);
      return "@param" + i;
    });

    let sqlStr;
    if (hasAllUniqueKeys) {
      const onClause = uniqueKeys
        .map((k) => `target.${escapeId(k)} = source.${escapeId(k)}`)
        .join(" AND ");
      const insertCols = columns.map(escapeId).join(",");
      const insertVals = columns.map((c) => `source.${escapeId(c)}`).join(",");

      sqlStr = `MERGE INTO ${escapeId(table)} AS target`;
      sqlStr += ` USING (VALUES (${valuePlaceholders.join(",")})) AS source (${colList})`;
      sqlStr += ` ON ${onClause}`;
      sqlStr += ` WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});`;
    } else {
      sqlStr = `INSERT INTO ${escapeId(table)} (${colList}) VALUES (${valuePlaceholders.join(",")})`;
    }

    try {
      await request.query(sqlStr);
    } catch (e) {
      throw mapMssqlError(e);
    }
  }

  return {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
    id: 0,
  };
}

async function disconnect() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

module.exports = {
  connect,
  get,
  list,
  where,
  query,
  qcount,
  remove,
  upsert,
  change: upsert,
  insert,
  disconnect,
  close: disconnect,
};
