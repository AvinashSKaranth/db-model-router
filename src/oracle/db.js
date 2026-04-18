const oracledb = require("oracledb");
const { jsonSafeParse } = require("../commons/function");
const sqlTranslator = require("./sql_translator");

let pool = null;
let dateStringsMode = false;
const WHERE_INVALID = "Invalid filter object";
const pkCache = {};
const ORACLE_RESERVED_WORDS = new Set([
  "access",
  "add",
  "all",
  "alter",
  "and",
  "any",
  "as",
  "asc",
  "audit",
  "between",
  "by",
  "char",
  "check",
  "cluster",
  "column",
  "comment",
  "compress",
  "connect",
  "create",
  "current",
  "date",
  "decimal",
  "default",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "exclusive",
  "exists",
  "file",
  "float",
  "for",
  "from",
  "grant",
  "group",
  "having",
  "identified",
  "immediate",
  "in",
  "increment",
  "index",
  "initial",
  "insert",
  "integer",
  "intersect",
  "into",
  "is",
  "level",
  "like",
  "lock",
  "long",
  "maxextents",
  "minus",
  "mlslabel",
  "mode",
  "modify",
  "noaudit",
  "nocompress",
  "not",
  "nowait",
  "null",
  "number",
  "of",
  "offline",
  "on",
  "online",
  "option",
  "or",
  "order",
  "pctfree",
  "prior",
  "public",
  "raw",
  "rename",
  "resource",
  "revoke",
  "row",
  "rowid",
  "rownum",
  "rows",
  "select",
  "session",
  "set",
  "share",
  "size",
  "smallint",
  "start",
  "successful",
  "synonym",
  "sysdate",
  "table",
  "then",
  "to",
  "trigger",
  "type",
  "uid",
  "union",
  "unique",
  "update",
  "user",
  "validate",
  "values",
  "varchar",
  "varchar2",
  "view",
  "whenever",
  "where",
  "with",
  "private",
]);
function quoteCol(col) {
  return ORACLE_RESERVED_WORDS.has(col.toLowerCase())
    ? '"' + col.toUpperCase() + '"'
    : col;
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

// Retry-eligible ORA errors
const RETRYABLE_ERRORS = ["ORA-03113", "ORA-03114", "ORA-12541"];

// Oracle → MySQL error code mapping
const ERROR_MAP = {
  "ORA-00001": "ER_DUP_ENTRY",
  "ORA-02291": "ER_NO_REFERENCED_ROW",
  "ORA-03113": "PROTOCOL_CONNECTION_LOST",
  "ORA-03114": "PROTOCOL_CONNECTION_LOST",
  "ORA-12541": "ECONNREFUSED",
};

function mapOracleError(err) {
  const msg = err.message || "";
  for (const [ora, mysql] of Object.entries(ERROR_MAP)) {
    if (msg.includes(ora)) {
      err.code = mysql;
      err.sqlMessage = msg;
      return err;
    }
  }
  if (!err.sqlMessage) err.sqlMessage = msg;
  return err;
}

function isRetryable(err) {
  const msg = err.message || "";
  return RETRYABLE_ERRORS.some((code) => msg.includes(code));
}

function initSession(conn, requestedTag, cb) {
  conn
    .execute(
      "ALTER SESSION SET NLS_DATE_FORMAT='YYYY-MM-DD HH24:MI:SS' NLS_TIMESTAMP_FORMAT='YYYY-MM-DD HH24:MI:SS'",
    )
    .then(() => cb(null))
    .catch(cb);
}

function connect(config) {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  oracledb.autoCommit = true;
  oracledb.fetchAsString = [oracledb.CLOB];

  dateStringsMode =
    config.dateStrings === true || process.env.DB_DATE_STRINGS === "true";

  const connectString =
    process.env.DB_CONNECT_STRING ||
    `${config.host || process.env.DB_HOST}:${config.port || process.env.DB_PORT || 1521}/${config.database || process.env.DB_NAME}`;

  const poolConfig = {
    user: config.user || process.env.DB_USER,
    password: config.password || process.env.DB_PASS,
    connectString,
    poolMin: parseInt(process.env.DB_POOL_MIN) || 4,
    poolMax:
      parseInt(config.connectionLimit) ||
      parseInt(process.env.DB_POOL_MAX) ||
      50,
    poolIncrement: parseInt(process.env.DB_POOL_INCREMENT) || 2,
    sessionCallback: initSession,
  };

  pool = oracledb.createPool(poolConfig);
  return pool;
}

/**
 * Resolve ?? (identifier) and ? (value) placeholders.
 * Returns { sql, params } with Oracle :1,:2,... bind vars.
 */
function translatePlaceholders(sql, params) {
  if (!params || params.length === 0) return { sql, params: [] };

  const paramsCopy = [...params];
  let oracleParams = [];

  // Step 0: Fix '?' (quoted placeholders) - remove quotes around ?
  sql = sql.replace(/'(\?)'/g, "$1");

  // Step 1: resolve ?? identifiers (consume from front of params)
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
    // Bulk insert — return special marker
    return { sql, params: paramsCopy[0], isBulk: true };
  }

  // Step 3: replace ? with :1, :2, ...
  let bindIndex = 0;
  sql = sql.replace(/\?/g, () => {
    bindIndex++;
    oracleParams.push(paramsCopy.shift());
    return ":" + bindIndex;
  });

  // If no ? were found but SQL has :N placeholders, pass params through
  if (bindIndex === 0 && paramsCopy.length > 0 && /:\d+/.test(sql)) {
    oracleParams = paramsCopy;
  }

  return { sql, params: oracleParams };
}

function mapResults(result) {
  if (result.rows) {
    return result.rows.map((row) => {
      const mapped = {};
      for (const [key, val] of Object.entries(row)) {
        const lk = key.toLowerCase();
        const parsed =
          typeof val === "string" && val.startsWith("{")
            ? jsonSafeParse(val)
            : val;
        mapped[lk] =
          dateStringsMode && val instanceof Date
            ? val.toISOString().slice(0, 19).replace("T", " ")
            : parsed;
      }
      return mapped;
    });
  }
  return {
    affectedRows: result.rowsAffected || 0,
    insertId: result.outBinds?.id?.[0] || 0,
  };
}

async function executeWithRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isRetryable(err)) {
      return await fn();
    }
    throw mapOracleError(err);
  }
}

async function query(sql, parameter = []) {
  const resolvedPool = await pool;
  const translated = sqlTranslator.translate(sql);
  const {
    sql: oracleSql,
    params: oracleParams,
    isBulk,
  } = translatePlaceholders(translated, parameter);

  return executeWithRetry(async () => {
    const conn = await resolvedPool.getConnection();
    try {
      if (isBulk) {
        // Bulk insert via executeMany
        const cleanSql = oracleSql.replace(/VALUES\s+\?/i, () => {
          const cols = oracleParams[0];
          const placeholders = cols.map((_, i) => ":" + (i + 1)).join(",");
          return `VALUES (${placeholders})`;
        });
        const result = await conn.executeMany(cleanSql, oracleParams, {
          autoCommit: true,
        });
        return { affectedRows: result.rowsAffected || 0, insertId: 0 };
      }

      // Detect statement type (strip leading comments for detection)
      const sqlNoComment = oracleSql.replace(/^\s*\/\*.*?\*\/\s*/g, "");
      const isInsert = /^\s*INSERT\s/i.test(sqlNoComment);
      let execSql = oracleSql;
      let execParams = oracleParams;
      let execOptions = {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      };

      if (isInsert && !oracleSql.match(/RETURNING/i)) {
        // Try to add RETURNING id INTO :pk_out
        execSql = oracleSql + " RETURNING id INTO :pk_out";
        execParams = [
          ...oracleParams,
          { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        ];
        // Convert positional to named binds for mixed mode
        let idx = 0;
        const namedParams = {};
        execSql = execSql.replace(/:(\d+)/g, (_, num) => {
          const name = "p" + num;
          namedParams[name] = oracleParams[parseInt(num) - 1];
          return ":" + name;
        });
        namedParams["pk_out"] = {
          dir: oracledb.BIND_OUT,
          type: oracledb.NUMBER,
        };
        execParams = namedParams;
      }

      let result;
      try {
        result = await conn.execute(execSql, execParams, execOptions);
      } catch (insertErr) {
        // If RETURNING failed (e.g. no 'id' column), retry without it
        if (
          isInsert &&
          insertErr.message &&
          insertErr.message.includes("ORA-")
        ) {
          result = await conn.execute(oracleSql, oracleParams, execOptions);
        } else {
          throw insertErr;
        }
      }

      if (isInsert) {
        const insertId =
          result.outBinds?.pk_out?.[0] || result.outBinds?.pk_out || 0;
        return {
          affectedRows: result.rowsAffected || 0,
          insertId,
        };
      }

      const isUpdate = /^\s*(UPDATE|DELETE|MERGE)\s/i.test(sqlNoComment);
      if (isUpdate) {
        return {
          affectedRows: result.rowsAffected || 0,
          insertId: 0,
        };
      }

      return mapResults(result);
    } finally {
      await conn.close();
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
            return ":" + bindIdx;
          })
          .join(",");
        conditionAnd.push(`${j[0]} ${j[1]} (${placeholders})`);
        // Convert booleans to numbers for Oracle
        value.push(
          ...j[2].map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)),
        );
      } else if (j[1] === "like" || j[1] === "not like") {
        bindIdx++;
        conditionAnd.push(`${j[0]} ${j[1]} :${bindIdx}`);
        value.push("%" + j[2] + "%");
      } else {
        bindIdx++;
        conditionAnd.push(`${j[0]} ${j[1]} :${bindIdx}`);
        // Convert boolean to number for Oracle; coerce empty string to null (Oracle treats '' as NULL anyway)
        const val =
          typeof j[2] === "boolean"
            ? j[2]
              ? 1
              : 0
            : j[2] === ""
              ? null
              : j[2];
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
      items.push(item.replace("-", "") + " DESC");
    } else {
      items.push(item + " ASC");
    }
  }
  return { query: "ORDER BY " + items.join(","), value: [] };
}

async function get(table, filter = [], sort = [], safeDelete = null) {
  const whereData = where(filter, safeDelete);
  const sortData = sort_builder(sort);
  if (whereData == null) throw new Error(WHERE_INVALID);

  const sql = `SELECT * FROM ${table} ${whereData.query} ${sortData.query}`;
  const rows = await query(`/* ORACLE_NATIVE */ ${sql}`, whereData.value);
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
  const sql = `SELECT * FROM ${table} ${whereData.query} ${sortData.query} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  const rows = await query(`/* ORACLE_NATIVE */ ${sql}`, whereData.value);
  const count = await qcount(table, filter, safeDelete);
  return { data: jsonSafeParse(rows), count };
}

async function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) return 0;
  const sql = `SELECT count(*) AS "number" FROM ${table} ${whereData.query}`;
  try {
    const rows = await query(`/* ORACLE_NATIVE */ ${sql}`, whereData.value);
    return rows[0]?.number || 0;
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
    sql = `UPDATE ${table} SET ${safeDelete} = 1 ${whereData.query}`;
    params = whereData.value;
  } else {
    sql = `DELETE FROM ${table} ${whereData.query}`;
    params = whereData.value;
  }

  const result = await query(`/* ORACLE_NATIVE */ ${sql}`, params);
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
    const resolvedPool = await pool;
    const conn = await resolvedPool.getConnection();
    try {
      const r = await conn.execute(
        `SELECT cols.column_name FROM user_constraints cons JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name WHERE cons.table_name = :1 AND cons.constraint_type = 'P' AND ROWNUM = 1`,
        [table.toUpperCase()],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      pkCache[table] =
        r.rows.length > 0 ? r.rows[0].COLUMN_NAME.toLowerCase() : null;
    } finally {
      await conn.close();
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
  const qCols = columns.map(quoteCol);

  // Only use MERGE when unique keys are actually present in the data
  const effectiveUniqueKeys = uniqueKeys.filter((k) => columns.includes(k));
  if (effectiveUniqueKeys.length > 0) {
    return await _mergeInsertOnly(
      table,
      array,
      columns,
      effectiveUniqueKeys,
      total,
    );
  }

  if (total === 1) {
    const pk = await getPkColumn(table);
    const row = array[0];
    const vals = columns.map((c) => sanitizeValue(row[c]));
    const placeholders = columns.map((_, i) => ":" + (i + 1)).join(",");
    let sql = `INSERT INTO ${table} (${qCols.join(",")}) VALUES (${placeholders})`;

    if (pk) {
      sql += ` RETURNING ${quoteCol(pk)} INTO :pk_out`;
      const namedParams = {};
      vals.forEach((v, i) => {
        namedParams["p" + (i + 1)] = v;
      });
      namedParams["pk_out"] = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };
      sql = sql.replace(/:(\d+)/g, (_, num) => ":p" + num);

      const resolvedPool = await pool;
      const conn = await resolvedPool.getConnection();
      try {
        const result = await conn.execute(sql, namedParams, {
          autoCommit: true,
        });
        const insertId =
          result.outBinds?.pk_out?.[0] || result.outBinds?.pk_out || 0;
        return {
          rows: 1,
          message: `1 ${namify(table)} is saved`,
          type: "success",
          id: insertId,
        };
      } catch (e) {
        throw mapOracleError(e);
      } finally {
        await conn.close();
      }
    }

    const result = await query(`/* ORACLE_NATIVE */ ${sql}`, vals);
    return {
      rows: 1,
      message: `1 ${namify(table)} is saved`,
      type: "success",
      id: result.insertId || 0,
    };
  }

  // Bulk insert via executeMany in batches of 1000
  const resolvedPool = await pool;
  let insertId = 0;
  const placeholders = columns.map((_, i) => ":" + (i + 1)).join(",");
  const sql = `INSERT INTO ${table} (${qCols.join(",")}) VALUES (${placeholders})`;

  for (let i = 0; i < array.length; i += 1000) {
    const batch = array
      .slice(i, i + 1000)
      .map((row) => columns.map((c) => sanitizeValue(row[c])));
    const conn = await resolvedPool.getConnection();
    try {
      await conn.executeMany(sql, batch, { autoCommit: true });
    } finally {
      await conn.close();
    }
  }

  return {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
    id: insertId,
  };
}

async function _mergeInsertOnly(table, array, columns, uniqueKeys, total) {
  let lastId = 0;
  const pk = await getPkColumn(table);

  for (let i = 0; i < array.length; i += 1000) {
    const batch = array.slice(i, i + 1000);
    for (const row of batch) {
      const vals = columns.map((c) => sanitizeValue(row[c]));
      const usingCols = columns
        .map((c, idx) => `:${idx + 1} AS ${quoteCol(c)}`)
        .join(", ");
      const onClause = uniqueKeys
        .map((k) => `t.${quoteCol(k)} = s.${quoteCol(k)}`)
        .join(" AND ");
      // Exclude PK identity column from the INSERT portion of MERGE
      const insertColumns = pk ? columns.filter((c) => c !== pk) : columns;
      const insertCols = insertColumns.map(quoteCol).join(",");
      const insertVals = insertColumns.map((c) => `s.${quoteCol(c)}`).join(",");

      const sql = `MERGE INTO ${table} t USING (SELECT ${usingCols} FROM DUAL) s ON (${onClause}) WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;
      await query(`/* ORACLE_NATIVE */ ${sql}`, vals);

      // Fetch the PK of the inserted/existing row
      if (total === 1) {
        const pk = await getPkColumn(table);
        if (pk) {
          const whereClause = uniqueKeys
            .map((k, idx) => `${k} = :${idx + 1}`)
            .join(" AND ");
          const whereVals = uniqueKeys.map((k) => row[k]);
          const fetched = await query(
            `/* ORACLE_NATIVE */ SELECT ${pk} FROM ${table} WHERE ${whereClause}`,
            whereVals,
          );
          if (fetched.length > 0) lastId = fetched[0][pk] || 0;
        }
      }
    }
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
          .map((c, i) => `${quoteCol(c)} = :${i + 1}`)
          .join(", ");
        const vals = [
          ...updateCols.map((c) => sanitizeValue(row[c])),
          row[keyCol],
        ];
        const sql = `UPDATE ${table} SET ${setClause} WHERE ${quoteCol(keyCol)} = :${updateCols.length + 1}`;
        await query(`/* ORACLE_NATIVE */ ${sql}`, vals);
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

  let lastId = 0;
  const pk = await getPkColumn(table);

  for (let i = 0; i < array.length; i += 1000) {
    const batch = array.slice(i, i + 1000);
    for (const row of batch) {
      const vals = columns.map((c) => sanitizeValue(row[c]));
      const usingCols = columns
        .map((c, idx) => `:${idx + 1} AS ${quoteCol(c)}`)
        .join(", ");
      const onClause = uniqueKeys
        .map((k) => `t.${quoteCol(k)} = s.${quoteCol(k)}`)
        .join(" AND ");
      const updateSet = nonUniqueColumns
        .map((c) => `t.${quoteCol(c)} = s.${quoteCol(c)}`)
        .join(", ");
      // Exclude PK identity column from the INSERT portion of MERGE
      const insertColumns = pk ? columns.filter((c) => c !== pk) : columns;
      const insertCols = insertColumns.map(quoteCol).join(",");
      const insertVals = insertColumns.map((c) => `s.${quoteCol(c)}`).join(",");

      let sql = `MERGE INTO ${table} t USING (SELECT ${usingCols} FROM DUAL) s ON (${onClause})`;
      if (updateSet) {
        sql += ` WHEN MATCHED THEN UPDATE SET ${updateSet}`;
      }
      sql += ` WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals})`;

      const result = await query(`/* ORACLE_NATIVE */ ${sql}`, vals);

      // MERGE doesn't support RETURNING, so fetch the PK via unique keys
      if (total === 1) {
        const pk = await getPkColumn(table);
        if (pk) {
          const whereClause = uniqueKeys
            .map((k, idx) => `${quoteCol(k)} = :${idx + 1}`)
            .join(" AND ");
          const whereVals = uniqueKeys.map((k) => row[k]);
          const fetched = await query(
            `/* ORACLE_NATIVE */ SELECT ${quoteCol(pk)} FROM ${table} WHERE ${whereClause}`,
            whereVals,
          );
          if (fetched.length > 0) lastId = fetched[0][pk] || 0;
        }
      }
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

async function disconnect() {
  if (pool) {
    const resolvedPool = await pool;
    await resolvedPool.close(0);
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
  pool: null, // Exposed for compatibility, but use methods instead
};
