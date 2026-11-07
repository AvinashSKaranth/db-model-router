const { Pool } = require("pg");
const { jsonSafeParse } = require("../commons/function");

let pool = null;
let dateStringsMode = false;
const WHERE_INVALID = "Invalid filter object";
const pkCache = {};

function sanitizeValue(v) {
  if (v === undefined) return null;
  return v;
}

const RETRYABLE_ERRORS = [
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "57P01",
  "57P03",
];

const ERROR_MAP = {
  23505: "ER_DUP_ENTRY",
  23503: "ER_NO_REFERENCED_ROW",
};

function mapPgError(err) {
  const code = err.code || "";
  if (ERROR_MAP[code]) {
    err.code = ERROR_MAP[code];
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

/**
 * Quote a PostgreSQL identifier to prevent SQL injection.
 * Strips null bytes, handles multi-part identifiers (e.g. schema.table),
 * doubles any embedded double-quotes, then wraps each part in double-quotes.
 */
function escapeId(name) {
  if (typeof name !== "string") name = String(name);
  name = name.replace(/\0/g, "");
  return name
    .split(".")
    .map((part) => '"' + part.trim().replace(/"/g, '""') + '"')
    .join(".");
}

function connect(config) {
  dateStringsMode =
    config.dateStrings === true || process.env.DB_DATE_STRINGS === "true";

  const poolConfig = {
    host: config.host || process.env.DB_HOST,
    port: parseInt(config.port || process.env.DB_PORT || 5432),
    database: config.database || process.env.DB_NAME,
    user: config.user || process.env.DB_USER,
    password: config.password || process.env.DB_PASS,
    max:
      parseInt(config.connectionLimit) ||
      parseInt(process.env.DB_POOL_MAX) ||
      50,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  if (config.ssl) {
    poolConfig.ssl = config.ssl;
  }

  pool = new Pool(poolConfig);

  // Set session timezone to UTC for consistent timestamp handling
  pool.on("connect", (client) => {
    client.query("SET timezone = 'UTC'");
  });

  pool.on("error", (err) => {
    console.error("Unexpected PG pool error:", err.message);
  });

  return pool;
}

function mapResults(result) {
  if (result.rows) {
    return result.rows.map((row) => {
      if (!dateStringsMode) return row;
      const mapped = {};
      for (const [key, val] of Object.entries(row)) {
        mapped[key] =
          dateStringsMode && val instanceof Date
            ? val.toISOString().slice(0, 19).replace("T", " ")
            : val;
      }
      return mapped;
    });
  }
  return {
    affectedRows: result.rowCount || 0,
    insertId: 0,
  };
}

async function executeWithRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isRetryable(err)) {
      return await fn();
    }
    throw mapPgError(err);
  }
}

// Test hook: capture raw queries in test mode
const _sqlCaptureLog = [];
function getSqlCaptureLog() {
  return _sqlCaptureLog;
}

/**
 * Execute a native PostgreSQL query with parameterized values.
 * Uses node-postgres ($1, $2, ...) parameter binding directly.
 */
async function query(sql, parameter = []) {
  if (process.env.NODE_ENV === "test") {
    _sqlCaptureLog.push({ raw: sql, params: parameter });
  }

  // Strip leading /* PG_NATIVE */ comment if present for backwards compatibility
  let cleanSql = sql;
  if (typeof cleanSql === "string") {
    cleanSql = cleanSql.replace(/^\/\*\s*PG_NATIVE\s*\*\/\s*/i, "");
  }

  return executeWithRetry(async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(cleanSql, parameter);

      const isInsert = /^\s*INSERT\s/i.test(cleanSql);
      if (isInsert) {
        if (result.rows && result.rows.length > 0) {
          const firstRow = result.rows[0];
          const id = firstRow.id || firstRow[Object.keys(firstRow)[0]] || 0;
          return { affectedRows: result.rowCount || 0, insertId: id };
        }
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }

      const isUpdate = /^\s*(UPDATE|DELETE|MERGE)\s/i.test(cleanSql);
      if (isUpdate) {
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }

      return mapResults(result);
    } finally {
      client.release();
    }
  });
}

// WHERE builder — produces native PostgreSQL WHERE clauses with $N bind params
function where(filter, safeDelete = null, columnTypes = {}) {
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

  // Deep clone filter to avoid mutating caller objects
  const filterCopy = filter.map((group) =>
    Array.isArray(group) ? group.map((cond) => (Array.isArray(cond) ? [...cond] : cond)) : group,
  );

  if (safeDelete !== null) {
    const isBool = columnTypes[safeDelete] === "bool";
    const safeDeleteVal = isBool ? false : 0;
    for (const filterItem of filterCopy) {
      filterItem.push([safeDelete, "=", safeDeleteVal]);
    }
  }

  const valid_conditionals = [
    "=",
    "like",
    "not like",
    "ilike",
    "not ilike",
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

  for (const i of filterCopy) {
    let conditionAnd = [];
    for (const j of i) {
      if (!Array.isArray(j) || j.length < 3) return null;
      const op = String(j[1]).toLowerCase();
      if (!valid_conditionals.includes(op)) return null;
      if ((op === "in" || op === "not in") && (!Array.isArray(j[2]) || j[2].length === 0)) {
        return null;
      }

      const colName = j[0];
      const colType = columnTypes[colName];
      const isNumeric =
        colType &&
        ["int2", "int4", "int8", "float4", "float8", "numeric"].includes(colType);
      const isBool = colType === "bool";

      const coerceValue = (v) => {
        if (isNumeric) {
          if (v === "" || v === null || v === undefined) return null;
          if (typeof v === "boolean") return v ? 1 : 0;
          return v;
        }
        if (isBool) {
          if (v === "" || v === null || v === undefined) return null;
          if (v === 1 || v === "1" || v === "true" || v === true) return true;
          if (v === 0 || v === "0" || v === "false" || v === false) return false;
          return v;
        }
        return v;
      };

      if (op === "in" || op === "not in") {
        const coercedArray = j[2].map(coerceValue);
        const placeholders = coercedArray
          .map(() => {
            bindIdx++;
            return "$" + bindIdx;
          })
          .join(",");
        conditionAnd.push(`${escapeId(colName)} ${op.toUpperCase()} (${placeholders})`);
        value.push(...coercedArray);
      } else if (op === "like" || op === "ilike" || op === "not like" || op === "not ilike") {
        const isNot = op.startsWith("not");
        const pgOp = isNot ? "NOT ILIKE" : "ILIKE";
        bindIdx++;
        conditionAnd.push(`${escapeId(colName)} ${pgOp} $${bindIdx}`);
        const rawVal = String(j[2] ?? "");
        const val = rawVal.includes("%") ? rawVal : "%" + rawVal + "%";
        value.push(val);
      } else {
        const coerced = coerceValue(j[2]);
        bindIdx++;
        conditionAnd.push(`${escapeId(colName)} ${j[1]} $${bindIdx}`);
        value.push(coerced);
      }
    }
    conditionOr.push(conditionAnd.join(" AND "));
  }

  return {
    query: "WHERE ((" + conditionOr.join(") OR (") + "))",
    value,
  };
}

function sort_builder(sort) {
  if (!sort || sort.length < 1) return { query: "", value: [] };
  let items = [];
  for (const item of sort) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("-")) {
      items.push(escapeId(trimmed.slice(1).trim()) + " DESC");
    } else if (trimmed.startsWith("+")) {
      items.push(escapeId(trimmed.slice(1).trim()) + " ASC");
    } else {
      items.push(escapeId(trimmed) + " ASC");
    }
  }
  return { query: items.length > 0 ? "ORDER BY " + items.join(", ") : "", value: [] };
}

const tableColumnsCache = {};

async function getTableColumns(table) {
  if (tableColumnsCache[table] !== undefined) return tableColumnsCache[table];
  try {
    const cleanName = table.replace(/^.*"\."?/, "").replace(/"/g, "");
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT a.attname AS column_name, t.typname AS data_type 
         FROM pg_attribute a 
         JOIN pg_class c ON c.oid = a.attrelid 
         JOIN pg_type t ON t.oid = a.atttypid 
         WHERE c.relname = $1 AND a.attnum >= 1`,
        [cleanName],
      );
      const cols = {};
      for (const row of res.rows) {
        cols[row.column_name] = row.data_type.toLowerCase();
      }
      tableColumnsCache[table] = cols;
    } finally {
      client.release();
    }
  } catch (_) {
    return {};
  }
  return tableColumnsCache[table] || {};
}

async function get(table, filter = [], sort = [], safeDelete = null) {
  const columnTypes = await getTableColumns(table);
  const whereData = where(filter, safeDelete, columnTypes);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  const sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query}`;
  const rows = await query(sql, whereData.value);
  const count = await qcount(table, filter, safeDelete, columnTypes);
  return { data: jsonSafeParse(rows), count };
}

async function list(
  table,
  filter = [],
  sort = [],
  safeDelete = null,
  page = 0,
  limit = 30,
) {
  const columnTypes = await getTableColumns(table);
  const whereData = where(filter, safeDelete, columnTypes);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  const offset = page * limit;
  const sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query} LIMIT ${limit} OFFSET ${offset}`;
  const rows = await query(sql, whereData.value);
  const count = await qcount(table, filter, safeDelete, columnTypes);
  return { data: jsonSafeParse(rows), count };
}

async function qcount(table, filter, safeDelete = null, passedColumnTypes = null) {
  const columnTypes = passedColumnTypes || (await getTableColumns(table));
  const whereData = where(filter, safeDelete, columnTypes);
  if (whereData == null) return 0;
  const sql = `SELECT count(*) AS number FROM ${escapeId(table)} ${whereData.query}`;
  try {
    const rows = await query(sql, whereData.value);
    return parseInt(rows[0]?.number) || 0;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("qcount error:", err.message);
    }
    return 0;
  }
}

async function remove(table, filter, safeDelete = null) {
  const columnTypes = await getTableColumns(table);
  const whereData = where(filter, null, columnTypes);
  if (whereData == null) throw new Error(WHERE_INVALID);
  if (whereData.value.length < 1) {
    throw new Error("unable to remove as there are no filter attributes");
  }

  let sql;
  let params;
  if (safeDelete != null) {
    const isBool = columnTypes[safeDelete] === "bool";
    const setVal = isBool ? "TRUE" : "1";
    sql = `UPDATE ${escapeId(table)} SET ${escapeId(safeDelete)} = ${setVal} ${whereData.query}`;
    params = whereData.value;
  } else {
    sql = `DELETE FROM ${escapeId(table)} ${whereData.query}`;
    params = whereData.value;
  }

  const result = await query(sql, params);
  const rows = result.affectedRows || 0;
  return { message: rows + " " + table + (rows > 1 ? "s" : "") + " removed" };
}

function namify(text) {
  return text
    .replace("_", " ")
    .replace(/(^\w{1})|(\s+\w{1})/g, (letter) => letter.toUpperCase());
}

async function getPkColumn(table) {
  if (pkCache[table] !== undefined) return pkCache[table];
  try {
    const client = await pool.connect();
    try {
      const cleanName = table.replace(/^.*"\."?/, "").replace(/"/g, "");
      const r = await client.query(
        `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE c.relname = $1 AND i.indisprimary
         LIMIT 1`,
        [cleanName],
      );
      if (r.rows.length > 0) {
        pkCache[table] = r.rows[0].column_name;
      } else {
        const r2 = await client.query(
          `SELECT a.attname AS column_name
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = $1::regclass AND i.indisprimary
           LIMIT 1`,
          [table],
        ).catch(() => ({ rows: [] }));
        pkCache[table] = r2.rows.length > 0 ? r2.rows[0].column_name : null;
      }
    } finally {
      client.release();
    }
  } catch (e) {
    return null;
  }
  return pkCache[table];
}

async function insert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? data : [data];
  const total = array.length;
  const columns = Object.keys(array[0]);

  if (uniqueKeys.length > 0) {
    return await _insertOnConflict(table, array, columns, uniqueKeys, total);
  }

  if (total === 1) {
    const pk = await getPkColumn(table);
    const row = array[0];
    const vals = columns.map((c) => sanitizeValue(row[c]));
    const placeholders = columns.map((_, i) => "$" + (i + 1)).join(",");
    let sql = `INSERT INTO ${escapeId(table)} (${columns.map(escapeId).join(",")}) VALUES (${placeholders})`;
    if (pk) sql += ` RETURNING ${escapeId(pk)}`;

    const client = await pool.connect();
    try {
      const result = await client.query(sql, vals);
      const insertId =
        pk && result.rows && result.rows[0] ? result.rows[0][pk] : 0;
      return {
        rows: 1,
        message: `1 ${namify(table)} is saved`,
        type: "success",
        id: insertId,
      };
    } catch (e) {
      throw mapPgError(e);
    } finally {
      client.release();
    }
  }

  // Bulk insert chunked to respect PostgreSQL's wire protocol limit of 65,535 parameters
  const maxBatch = Math.max(1, Math.floor(65000 / columns.length));
  const BATCH_SIZE = Math.min(1000, maxBatch);
  const colList = columns.map(escapeId).join(",");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let offset = 0; offset < total; offset += BATCH_SIZE) {
      const batch = array.slice(offset, offset + BATCH_SIZE);
      let paramIdx = 0;
      const allParams = [];
      const valuesClauses = batch.map((row) => {
        const placeholders = columns.map((c) => {
          paramIdx++;
          allParams.push(sanitizeValue(row[c]));
          return "$" + paramIdx;
        });
        return "(" + placeholders.join(",") + ")";
      });
      const sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES ${valuesClauses.join(",")}`;
      await client.query(sql, allParams);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw mapPgError(e);
  } finally {
    client.release();
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

async function _insertOnConflict(table, array, columns, uniqueKeys, total) {
  let lastId = 0;
  const pk = await getPkColumn(table);
  const conflictCols = uniqueKeys.map(escapeId).join(",");
  const colList = columns.map(escapeId).join(",");
  const maxBatch = Math.max(1, Math.floor(65000 / columns.length));
  const BATCH_SIZE = Math.min(1000, maxBatch);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (let offset = 0; offset < total; offset += BATCH_SIZE) {
      const batch = array.slice(offset, offset + BATCH_SIZE);
      let paramIdx = 0;
      const allParams = [];
      const valuesClauses = batch.map((row) => {
        const placeholders = columns.map((c) => {
          paramIdx++;
          allParams.push(sanitizeValue(row[c]));
          return "$" + paramIdx;
        });
        return "(" + placeholders.join(",") + ")";
      });
      let sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES ${valuesClauses.join(",")} ON CONFLICT (${conflictCols}) DO NOTHING`;
      if (pk) sql += ` RETURNING ${escapeId(pk)}`;

      const result = await client.query(sql, allParams);
      if (pk && result.rows && result.rows.length > 0) {
        lastId = result.rows[result.rows.length - 1][pk] || lastId;
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw mapPgError(e);
  } finally {
    client.release();
  }

  return {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
    id: lastId,
  };
}

async function upsert(table, data, uniqueKeys = []) {
  if (!uniqueKeys || !uniqueKeys.length) {
    return insert(table, data);
  }
  let array = Array.isArray(data) ? data : [data];
  const total = array.length;
  const columns = Object.keys(array[0]);

  // If unique keys aren't all in the data, fall back to UPDATE using PK or available unique key
  const missingKeys = uniqueKeys.filter((k) => !columns.includes(k));
  if (missingKeys.length > 0) {
    const pk = await getPkColumn(table);
    const keyCol =
      pk && columns.includes(pk)
        ? pk
        : columns.find((c) => uniqueKeys.includes(c));
    if (keyCol) {
      let lastId = 0;
      for (const row of array) {
        const updateCols = columns.filter((c) => c !== keyCol);
        if (updateCols.length === 0) continue;
        const setClause = updateCols
          .map((c, i) => `${escapeId(c)} = $${i + 1}`)
          .join(", ");
        const vals = [
          ...updateCols.map((c) => sanitizeValue(row[c])),
          row[keyCol],
        ];
        const sql = `UPDATE ${escapeId(table)} SET ${setClause} WHERE ${escapeId(keyCol)} = $${updateCols.length + 1}`;
        await query(sql, vals);
        if (row[keyCol]) lastId = row[keyCol];
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
  }

  const nonUniqueColumns = columns.filter((c) => !uniqueKeys.includes(c));
  const pk = await getPkColumn(table);
  let lastId = 0;
  const maxBatch = Math.max(1, Math.floor(65000 / columns.length));
  const BATCH_SIZE = Math.min(1000, maxBatch);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updateSetSql = nonUniqueColumns
      .map((c) => `${escapeId(c)} = EXCLUDED.${escapeId(c)}`)
      .join(", ");
    const conflictCols = uniqueKeys.map(escapeId).join(",");
    const colList = columns.map(escapeId).join(",");

    for (let offset = 0; offset < total; offset += BATCH_SIZE) {
      const batch = array.slice(offset, offset + BATCH_SIZE);
      let paramIdx = 0;
      const allParams = [];
      const valuesClauses = batch.map((row) => {
        const placeholders = columns.map((c) => {
          paramIdx++;
          allParams.push(sanitizeValue(row[c]));
          return "$" + paramIdx;
        });
        return "(" + placeholders.join(",") + ")";
      });

      let sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES ${valuesClauses.join(",")} ON CONFLICT (${conflictCols})`;
      if (updateSetSql) {
        sql += ` DO UPDATE SET ${updateSetSql}`;
      } else {
        sql += ` DO NOTHING`;
      }
      if (pk) sql += ` RETURNING ${escapeId(pk)}`;

      const result = await client.query(sql, allParams);
      if (pk && result.rows && result.rows.length > 0) {
        lastId = result.rows[result.rows.length - 1][pk] || lastId;
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw mapPgError(e);
  } finally {
    client.release();
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

async function disconnect() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function transaction(fn) {
  if (typeof fn !== "function") {
    throw new Error("Transaction requires a callback function");
  }
  const client = await pool.connect();
  const kafkaBuffer = [];
  try {
    await client.query("BEGIN");

    const txQuery = async (sql, parameter = []) => {
      let cleanSql = sql;
      if (typeof cleanSql === "string") {
        cleanSql = cleanSql.replace(/^\/\*\s*PG_NATIVE\s*\*\/\s*/i, "");
      }
      const result = await client.query(cleanSql, parameter);
      const isInsert = /^\s*INSERT\s/i.test(cleanSql);
      if (isInsert) {
        if (result.rows && result.rows.length > 0) {
          const firstRow = result.rows[0];
          const id = firstRow.id || firstRow[Object.keys(firstRow)[0]] || 0;
          return { affectedRows: result.rowCount || 0, insertId: id };
        }
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }
      const isUpdate = /^\s*(UPDATE|DELETE|MERGE)\s/i.test(cleanSql);
      if (isUpdate) {
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }
      return mapResults(result);
    };

    const txAdapter = {
      ...module.exports,
      query: txQuery,
      get: async (table, filter = [], sort = [], safeDelete = null) => {
        const columnTypes = await getTableColumns(table);
        const whereData = where(filter, safeDelete, columnTypes);
        const sortData = sort_builder(sort);
        if (whereData == null) throw new Error(WHERE_INVALID);
        const sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query}`;
        const rows = await txQuery(sql, whereData.value);
        const count = await txAdapter.qcount(table, filter, safeDelete, columnTypes);
        return { data: jsonSafeParse(rows), count };
      },
      list: async (
        table,
        filter = [],
        sort = [],
        safeDelete = null,
        page = 0,
        limit = 30,
      ) => {
        const columnTypes = await getTableColumns(table);
        const whereData = where(filter, safeDelete, columnTypes);
        const sortData = sort_builder(sort);
        if (whereData == null) throw new Error(WHERE_INVALID);
        const offset = page * limit;
        const sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query} LIMIT ${limit} OFFSET ${offset}`;
        const rows = await txQuery(sql, whereData.value);
        const count = await txAdapter.qcount(table, filter, safeDelete, columnTypes);
        return { data: jsonSafeParse(rows), count };
      },
      qcount: async (table, filter, safeDelete = null, passedColumnTypes = null) => {
        const columnTypes = passedColumnTypes || (await getTableColumns(table));
        const whereData = where(filter, safeDelete, columnTypes);
        if (whereData == null) return 0;
        const sql = `SELECT count(*) AS number FROM ${escapeId(table)} ${whereData.query}`;
        try {
          const rows = await txQuery(sql, whereData.value);
          return parseInt(rows[0]?.number) || 0;
        } catch (_) {
          return 0;
        }
      },
      remove: async (table, filter, safeDelete = null) => {
        const columnTypes = await getTableColumns(table);
        const whereData = where(filter, null, columnTypes);
        if (whereData == null) throw new Error(WHERE_INVALID);
        if (whereData.value.length < 1) {
          throw new Error("unable to remove as there are no filter attributes");
        }
        let sql;
        let params;
        if (safeDelete != null) {
          const isBool = columnTypes[safeDelete] === "bool";
          const setVal = isBool ? "TRUE" : "1";
          sql = `UPDATE ${escapeId(table)} SET ${escapeId(safeDelete)} = ${setVal} ${whereData.query}`;
          params = whereData.value;
        } else {
          sql = `DELETE FROM ${escapeId(table)} ${whereData.query}`;
          params = whereData.value;
        }
        const result = await txQuery(sql, params);
        const rows = result.affectedRows || 0;
        return {
          message: rows + " " + table + (rows > 1 ? "s" : "") + " removed",
        };
      },
      insert: async (table, data, uniqueKeys = []) => {
        let array = Array.isArray(data) ? data : [data];
        const columns = Object.keys(array[0]);
        if (uniqueKeys.length > 0) {
          const colList = columns.map(escapeId).join(",");
          const placeholders = columns.map((_, i) => "$" + (i + 1)).join(",");
          const conflictTargets = uniqueKeys.flat().map(escapeId).join(",");
          const updates = columns
            .filter((c) => !uniqueKeys.flat().includes(c))
            .map((c) => `${escapeId(c)} = EXCLUDED.${escapeId(c)}`)
            .join(",");
          const sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflictTargets}) DO UPDATE SET ${updates} RETURNING *`;
          const vals = columns.map((c) => sanitizeValue(array[0][c]));
          const res = await client.query(sql, vals);
          const pk = await getPkColumn(table);
          const id = pk && res.rows[0] ? res.rows[0][pk] : 0;
          return {
            rows: 1,
            message: `1 ${namify(table)} is saved`,
            type: "success",
            id,
          };
        }
        const pk = await getPkColumn(table);
        const placeholders = columns.map((_, i) => "$" + (i + 1)).join(",");
        let sql = `INSERT INTO ${escapeId(table)} (${columns.map(escapeId).join(",")}) VALUES (${placeholders})`;
        if (pk) sql += ` RETURNING ${escapeId(pk)}`;
        const vals = columns.map((c) => sanitizeValue(array[0][c]));
        const res = await client.query(sql, vals);
        const insertId = pk && res.rows && res.rows[0] ? res.rows[0][pk] : 0;
        return {
          rows: 1,
          message: `1 ${namify(table)} is saved`,
          type: "success",
          id: insertId,
        };
      },
      upsert: async (table, data, uniqueKeys = []) => {
        return await txAdapter.insert(table, data, uniqueKeys);
      },
    };

    const tx = {
      adapter: txAdapter,
      client,
      _kafkaBuffer: kafkaBuffer,
      query: (sql, params) => txQuery(sql, params),
      model: (modelOrTable) => {
        const modelFn = require("../commons/model");
        const m =
          typeof modelOrTable === "string"
            ? modelFn(txAdapter, modelOrTable)
            : modelOrTable;
        return typeof m?.withTx === "function" ? m.withTx(tx) : m;
      },
    };

    const res = await fn(tx);
    await client.query("COMMIT");
    if (kafkaBuffer.length > 0) {
      const { produce } = require("../commons/kafka");
      for (const msg of kafkaBuffer) {
        produce(msg.table, msg.action, msg.data);
      }
    }
    return res;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw mapPgError(err);
  } finally {
    client.release();
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
  pool: null,
  getSqlCaptureLog,
  transaction,
};
