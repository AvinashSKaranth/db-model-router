const { Pool, types } = require("pg");
const { jsonSafeParse } = require("../commons/function");

// CockroachDB SERIAL uses unique_rowid() which generates INT8 values
// that often exceed Number.MAX_SAFE_INTEGER. Keep them as strings to
// preserve precision; convert small values to numbers for convenience.
types.setTypeParser(20, (val) => {
  if (val === null) return null;
  const n = Number(val);
  return Number.isSafeInteger(n) ? n : val;
});

let pool = null;
let dateStringsMode = false;
const WHERE_INVALID = "Invalid filter object";
const pkCache = {};

/**
 * Escapes an identifier with CockroachDB/PostgreSQL double quotes, stripping null bytes.
 */
function escapeId(name) {
  if (typeof name !== "string") name = String(name);
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

function sanitizeValue(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
    return v
      .replace("T", " ")
      .replace(/[+-]\d{2}:\d{2}$/, "")
      .slice(0, 19);
  }
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

function connect(config) {
  dateStringsMode =
    config.dateStrings === true || process.env.DB_DATE_STRINGS === "true";

  const poolConfig = {
    host: config.host || process.env.DB_HOST,
    port: parseInt(config.port || process.env.DB_PORT || 26257),
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

  pool = new Pool(poolConfig);

  pool.on("error", (err) => {
    console.error("Unexpected CockroachDB pool error:", err.message);
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

async function query(sql, parameter = []) {
  return executeWithRetry(async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(sql, parameter);

      const isInsert = /^\s*INSERT\s/i.test(sql);
      if (isInsert) {
        if (result.rows && result.rows.length > 0) {
          const firstRow = result.rows[0];
          const id = firstRow.id || firstRow[Object.keys(firstRow)[0]] || 0;
          return { affectedRows: result.rowCount || 0, insertId: id };
        }
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }

      const isUpdate = /^\s*(UPDATE|DELETE|MERGE)\s/i.test(sql);
      if (isUpdate) {
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }

      return mapResults(result);
    } finally {
      client.release();
    }
  });
}

// WHERE builder — generates PostgreSQL/CockroachDB-compatible WHERE clauses with $N bind params
function where(filter, safeDelete = null, columnTypes = {}) {
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
        return { query: "", value: [] };
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
      if (!valid_conditionals.includes(j[1])) return null;
      if ((j[1] === "in" || j[1] === "not in") && !Array.isArray(j[2]))
        return null;

      const colName = escapeId(j[0]);
      const colType = columnTypes[j[0]];
      const isNumeric =
        colType &&
        ["int", "int2", "int4", "int8", "float4", "float8", "numeric"].includes(colType);
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

      if (j[1] === "in" || j[1] === "not in") {
        const coercedArray = j[2].map(coerceValue);
        const placeholders = coercedArray
          .map(() => {
            bindIdx++;
            return "$" + bindIdx;
          })
          .join(",");
        conditionAnd.push(`${colName} ${j[1]} (${placeholders})`);
        value.push(...coercedArray);
      } else if (j[1] === "like" || j[1] === "not like") {
        bindIdx++;
        conditionAnd.push(`${colName} ${j[1] === "like" ? "ILIKE" : "NOT ILIKE"} $${bindIdx}`);
        value.push("%" + j[2] + "%");
      } else {
        const coerced = coerceValue(j[2]);
        bindIdx++;
        conditionAnd.push(`${colName} ${j[1]} $${bindIdx}`);
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
    let col = item.trim();
    if (col.startsWith("-")) {
      items.push(escapeId(col.slice(1).trim()) + " DESC");
    } else {
      items.push(escapeId(col.startsWith("+") ? col.slice(1).trim() : col) + " ASC");
    }
  }
  return { query: items.length > 0 ? "ORDER BY " + items.join(",") : "", value: [] };
}

const tableColumnsCache = {};

async function getTableColumns(table) {
  if (tableColumnsCache[table] !== undefined) return tableColumnsCache[table];
  try {
    const parts = table.split(".");
    const cleanName = parts[parts.length - 1].replace(/"/g, "").trim();
    const schemaName = parts.length > 1 ? parts[0].replace(/"/g, "").trim() : "public";
    const res = await query(
      `SELECT a.attname AS column_name, t.typname AS data_type 
       FROM pg_attribute a 
       JOIN pg_class c ON c.oid = a.attrelid 
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid 
       WHERE c.relname = $1 AND n.nspname = $2 AND a.attnum >= 1`,
      [cleanName, schemaName],
    );
    const cols = {};
    const rows = Array.isArray(res) ? res : res.rows || [];
    for (const row of rows) {
      cols[row.column_name] = row.data_type.toLowerCase();
    }
    tableColumnsCache[table] = cols;
  } catch {
    // fallback if table columns cannot be introspected
    return {};
  }
  return tableColumnsCache[table] || {};
}

async function get(table, filter = [], sort = [], safeDelete = null, options = {}) {
  const { count = true, limit } = options || {};
  const columnTypes = await getTableColumns(table);
  const whereData = where(filter, safeDelete, columnTypes);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  let sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query}`;
  if (limit != null) {
    sql += ` LIMIT ${parseInt(limit, 10)}`;
  }
  const rows = await query(sql, whereData.value);
  const c = count !== false ? await qcount(table, filter, safeDelete, columnTypes) : rows.length;
  return { data: jsonSafeParse(rows), count: c };
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
  const sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query} LIMIT ${parseInt(limit, 10)} OFFSET ${parseInt(offset, 10)}`;
  const rows = await query(sql, whereData.value);
  const count = await qcount(table, filter, safeDelete, columnTypes);
  return { data: jsonSafeParse(rows), count };
}

async function qcount(table, filter, safeDelete = null, passedColumnTypes = null) {
  const columnTypes = passedColumnTypes || (await getTableColumns(table));
  const whereData = where(filter, safeDelete, columnTypes);
  if (whereData == null) throw new Error(WHERE_INVALID);
  const sql = `SELECT count(*) AS number FROM ${escapeId(table)} ${whereData.query}`;
  const rows = await query(sql, whereData.value);
  return parseInt(rows[0]?.number) || 0;
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
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function getPkColumn(table) {
  if (pkCache[table] !== undefined) return pkCache[table];
  try {
    const client = await pool.connect();
    try {
      const r = await client.query(
        `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary
         LIMIT 1`,
        [table],
      );
      pkCache[table] = r.rows.length > 0 ? r.rows[0].column_name : null;
    } finally {
      client.release();
    }
  } catch {
    // fallback if PK cannot be determined
    pkCache[table] = null;
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
    const sql = `INSERT INTO ${escapeId(table)} (${columns.map(escapeId).join(",")}) VALUES (${placeholders}) RETURNING *`;

    const client = await pool.connect();
    try {
      const result = await client.query(sql, vals);
      const returnedRow = result.rows && result.rows[0];
      const insertId =
        pk && returnedRow ? returnedRow[pk] : 0;
      return {
        rows: 1,
        message: `1 ${namify(table)} is saved`,
        type: "success",
        id: insertId,
        record: returnedRow ? jsonSafeParse(returnedRow) : undefined,
      };
    } catch (e) {
      throw mapPgError(e);
    } finally {
      client.release();
    }
  }

  // Bulk insert via multi-row VALUES in batches of 1000
  const BATCH_SIZE = 1000;
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

  if (total === 1) {
    const client = await pool.connect();
    try {
      const vals = columns.map((c) => sanitizeValue(array[0][c]));
      const placeholders = columns.map((_, i) => "$" + (i + 1)).join(",");
      const sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO NOTHING RETURNING *`;
      const result = await client.query(sql, vals);
      const row = result.rows && result.rows[0];
      if (row && pk) {
        lastId = row[pk] || 0;
      } else if (!row && uniqueKeys.length > 0 && pk) {
        const whereClause = uniqueKeys
          .map((k, idx) => `${escapeId(k)} = $${idx + 1}`)
          .join(" AND ");
        const existingRes = await client.query(
          `SELECT ${escapeId(pk)} FROM ${escapeId(table)} WHERE ${whereClause}`,
          uniqueKeys.map((k) => sanitizeValue(array[0][k])),
        );
        if (existingRes.rows && existingRes.rows[0]) {
          lastId = existingRes.rows[0][pk];
        }
      }
      return {
        rows: 1,
        message: `1 ${namify(table)} is saved`,
        type: "success",
        id: lastId,
        record: row ? jsonSafeParse(row) : undefined,
      };
    } catch (e) {
      throw mapPgError(e);
    } finally {
      client.release();
    }
  }

  const BATCH_SIZE = 1000;

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
  let responseRecord = null;
  const BATCH_SIZE = 1000;

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
      if (total === 1) {
        sql += ` RETURNING *`;
      } else if (pk) {
        sql += ` RETURNING ${escapeId(pk)}`;
      }

      const result = await client.query(sql, allParams);
      if (result.rows && result.rows.length > 0) {
        const row = result.rows[result.rows.length - 1];
        if (pk && row[pk]) {
          lastId = row[pk];
        }
        if (total === 1) {
          responseRecord = jsonSafeParse(row);
        }
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
  if (total === 1) {
    response.id = lastId;
    if (responseRecord) response.record = responseRecord;
  }
  return response;
}

async function disconnect() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  connect,
  get,
  list,
  where,
  sort_builder,
  escapeId,
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
};
