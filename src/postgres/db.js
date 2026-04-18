const { Pool } = require("pg");
const { jsonSafeParse } = require("../commons/function");
const sqlTranslator = require("./sql_translator");

let pool = null;
let dateStringsMode = false;
const WHERE_INVALID = "Invalid filter object";
const pkCache = {};

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

/**
 * Quote a PostgreSQL identifier to prevent SQL injection.
 * Doubles any embedded double-quotes, then wraps in double-quotes.
 */
function escapeId(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
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

  pool = new Pool(poolConfig);

  pool.on("error", (err) => {
    console.error("Unexpected PG pool error:", err.message);
  });

  return pool;
}

/**
 * Translate MySQL-style ? placeholders to PostgreSQL $1, $2, ...
 * Also resolves ?? identifier placeholders.
 */
function translatePlaceholders(sql, params) {
  if (!params || params.length === 0) return { sql, params: [] };

  const paramsCopy = [...params];

  // Step 1: resolve ?? identifiers
  while (sql.includes("??")) {
    const val = paramsCopy.shift();
    sql = sql.replace("??", String(val));
  }

  // Step 2: Check for bulk VALUES ? (array-of-arrays)
  const bulkMatch = sql.match(/VALUES\s+\?/i);
  if (
    bulkMatch &&
    paramsCopy.length === 1 &&
    Array.isArray(paramsCopy[0]) &&
    Array.isArray(paramsCopy[0][0])
  ) {
    return { sql, params: paramsCopy[0], isBulk: true };
  }

  // Step 3: replace ? with $1, $2, ...
  let bindIndex = 0;
  const pgParams = [];
  sql = sql.replace(/\?/g, () => {
    bindIndex++;
    pgParams.push(paramsCopy.shift());
    return "$" + bindIndex;
  });

  // Step 4: PG can't infer type for to_jsonb($N) — add explicit cast based on JS type
  sql = sql.replace(/to_jsonb\(\$(\d+)\)/g, (m, idx) => {
    const val = pgParams[parseInt(idx) - 1];
    if (typeof val === "number") return `to_jsonb($${idx}::numeric)`;
    if (typeof val === "boolean") return `to_jsonb($${idx}::boolean)`;
    return `to_jsonb($${idx}::text)`;
  });

  if (bindIndex === 0 && paramsCopy.length > 0) {
    return { sql, params: paramsCopy };
  }

  return { sql, params: pgParams };
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

// Test hook: capture raw MySQL SQL before translation (only in test mode)
const _sqlCaptureLog = [];
function getSqlCaptureLog() {
  return _sqlCaptureLog;
}

async function query(sql, parameter = []) {
  if (process.env.NODE_ENV === "test")
    _sqlCaptureLog.push({ raw: sql, params: parameter });
  const translated = sqlTranslator.translate(sql);
  const {
    sql: pgSql,
    params: pgParams,
    isBulk,
  } = translatePlaceholders(translated, parameter);

  return executeWithRetry(async () => {
    const client = await pool.connect();
    try {
      if (isBulk) {
        // Bulk insert: build multi-row VALUES
        const rows = pgParams;
        if (rows.length === 0) return { affectedRows: 0, insertId: 0 };
        const colCount = rows[0].length;
        let paramIdx = 0;
        const allParams = [];
        const valuesClauses = rows.map((row) => {
          const placeholders = row.map((v) => {
            paramIdx++;
            allParams.push(v);
            return "$" + paramIdx;
          });
          return "(" + placeholders.join(",") + ")";
        });
        const cleanSql = pgSql.replace(
          /VALUES\s+\?/i,
          "VALUES " + valuesClauses.join(","),
        );
        const result = await client.query(cleanSql, allParams);
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }

      const result = await client.query(pgSql, pgParams);

      const isInsert = /^\s*INSERT\s/i.test(pgSql);
      if (isInsert) {
        // If RETURNING was used, extract the id
        if (result.rows && result.rows.length > 0) {
          const firstRow = result.rows[0];
          const id = firstRow.id || firstRow[Object.keys(firstRow)[0]] || 0;
          return { affectedRows: result.rowCount || 0, insertId: id };
        }
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }

      const isUpdate = /^\s*(UPDATE|DELETE|MERGE)\s/i.test(pgSql);
      if (isUpdate) {
        return { affectedRows: result.rowCount || 0, insertId: 0 };
      }

      return mapResults(result);
    } finally {
      client.release();
    }
  });
}

// WHERE builder
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
            bindIdx++;
            return "$" + bindIdx;
          })
          .join(",");
        conditionAnd.push(`${escapeId(j[0])} ${j[1]} (${placeholders})`);
        value.push(
          ...j[2].map((v) =>
            typeof v === "boolean" ? (v ? 1 : 0) : v === "" ? null : v,
          ),
        );
      } else if (j[1] === "like" || j[1] === "not like") {
        bindIdx++;
        conditionAnd.push(`${escapeId(j[0])} ${j[1]} $${bindIdx}`);
        value.push("%" + j[2] + "%");
      } else {
        bindIdx++;
        conditionAnd.push(`${escapeId(j[0])} ${j[1]} $${bindIdx}`);
        // Coerce empty string to null (PG won't cast '' to bigint/int)
        // Coerce booleans to 0/1 (PG smallint columns store true/false as 1/0)
        let val = j[2];
        if (val === "") val = null;
        else if (typeof val === "boolean") val = val ? 1 : 0;
        value.push(val);
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
    if (item[0] === "-") {
      items.push(escapeId(item.replace("-", "")) + " DESC");
    } else {
      items.push(escapeId(item) + " ASC");
    }
  }
  return { query: "ORDER BY " + items.join(","), value: [] };
}

async function get(table, filter = [], sort = [], safeDelete = null) {
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  const sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query}`;
  const rows = await query(`/* PG_NATIVE */ ${sql}`, whereData.value);
  const count = await qcount(table, filter, safeDelete);
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
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  const offset = page * limit;
  const sql = `SELECT * FROM ${escapeId(table)} ${whereData.query} ${sortData.query} LIMIT ${limit} OFFSET ${offset}`;
  const rows = await query(`/* PG_NATIVE */ ${sql}`, whereData.value);
  const count = await qcount(table, filter, safeDelete);
  return { data: jsonSafeParse(rows), count };
}

async function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) return 0;
  const sql = `SELECT count(*) AS number FROM ${escapeId(table)} ${whereData.query}`;
  try {
    const rows = await query(`/* PG_NATIVE */ ${sql}`, whereData.value);
    return parseInt(rows[0]?.number) || 0;
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

  let sql;
  let params;
  if (safeDelete != null) {
    sql = `UPDATE ${escapeId(table)} SET ${escapeId(safeDelete)} = 1 ${whereData.query}`;
    params = whereData.value;
  } else {
    sql = `DELETE FROM ${escapeId(table)} ${whereData.query}`;
    params = whereData.value;
  }

  const result = await query(`/* PG_NATIVE */ ${sql}`, params);
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
  } catch (e) {
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

  // Bulk insert via multi-row VALUES
  const client = await pool.connect();
  try {
    let paramIdx = 0;
    const allParams = [];
    const valuesClauses = array.map((row) => {
      const placeholders = columns.map((c) => {
        paramIdx++;
        allParams.push(sanitizeValue(row[c]));
        return "$" + paramIdx;
      });
      return "(" + placeholders.join(",") + ")";
    });
    const sql = `INSERT INTO ${escapeId(table)} (${columns.map(escapeId).join(",")}) VALUES ${valuesClauses.join(",")}`;
    await client.query(sql, allParams);
  } catch (e) {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of array) {
      const vals = columns.map((c) => sanitizeValue(row[c]));
      const placeholders = columns.map((_, i) => "$" + (i + 1)).join(",");
      let sql = `INSERT INTO ${escapeId(table)} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflictCols}) DO NOTHING`;
      if (pk) sql += ` RETURNING ${escapeId(pk)}`;

      const result = await client.query(sql, vals);
      if (result.rows && result.rows.length > 0 && pk) {
        lastId = result.rows[0][pk] || 0;
      } else if (total === 1 && pk) {
        // Row already existed, fetch its PK
        const whereClauses = uniqueKeys
          .map((k, i) => `${escapeId(k)} = ${i + 1}`)
          .join(" AND ");
        const whereVals = uniqueKeys.map((k) => row[k]);
        const fetched = await client.query(
          `SELECT ${escapeId(pk)} FROM ${escapeId(table)} WHERE ${whereClauses}`,
          whereVals,
        );
        if (fetched.rows.length > 0) lastId = fetched.rows[0][pk] || 0;
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
        await query(`/* PG_NATIVE */ ${sql}`, vals);
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of array) {
      const vals = columns.map((c) => sanitizeValue(row[c]));
      const placeholders = columns.map((_, i) => "$" + (i + 1)).join(",");
      const conflictCols = uniqueKeys.map(escapeId).join(",");
      const updateSetSql = nonUniqueColumns
        .map((c) => `${escapeId(c)} = EXCLUDED.${escapeId(c)}`)
        .join(", ");

      let sql = `INSERT INTO ${escapeId(table)} (${columns.map(escapeId).join(",")}) VALUES (${placeholders}) ON CONFLICT (${conflictCols})`;
      if (updateSetSql) {
        sql += ` DO UPDATE SET ${updateSetSql}`;
      } else {
        sql += ` DO NOTHING`;
      }
      if (pk) sql += ` RETURNING ${escapeId(pk)}`;

      const result = await client.query(sql, vals);
      if (result.rows && result.rows.length > 0 && pk) {
        lastId = result.rows[0][pk] || 0;
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
  pool: null,
  getSqlCaptureLog,
};
