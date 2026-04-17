#!/usr/bin/env node

const path = require("path");
const fs = require("fs");

const DB_TYPE_MAP = {
  mysql: "mysql",
  postgres: "postgres",
  postgresql: "postgres",
  sqlite3: "sqlite3",
  mssql: "mssql",
  oracle: "oracle",
  cockroachdb: "cockroachdb",
};

const SUPPORTED_TYPES = Object.keys(DB_TYPE_MAP);

// --- Introspection queries per adapter ---

async function introspectMySQL(db) {
  const tables = await db.query("SHOW TABLES");
  const tableNames = tables.map((r) => Object.values(r)[0]);
  const models = [];
  for (const table of tableNames) {
    const columns = await db.query("SHOW COLUMNS FROM `" + table + "`");
    const pk = columns.find((c) => c.Key === "PRI");
    const pkName = pk ? pk.Field : "id";
    const indexes = await db.query("SHOW INDEX FROM `" + table + "`");
    const uniqueCols = getUniqueColumns(
      indexes,
      "Key_name",
      "Column_name",
      pkName,
    );
    const allColNames = columns.map((c) => c.Field);
    const option = detectOptionColumns(allColNames);
    const structure = {};
    for (const col of columns) {
      if (pk && col.Field === pk.Field) continue;
      if (isTimestampColumn(col.Field)) continue;
      if (isSafeDeleteColumn(col.Field)) continue;
      structure[col.Field] = buildRule(col);
    }
    models.push({
      table,
      primary_key: pkName,
      unique: uniqueCols,
      structure,
      option,
    });
  }
  return models;
}

/**
 * Groups index rows by index name and returns the best unique key set.
 * Prefers multi-column unique indexes over single-column ones.
 * Excludes the PRIMARY key index.
 * Falls back to [pkName] if no unique indexes found.
 */
function getUniqueColumns(indexRows, indexNameKey, columnNameKey, pkName) {
  const groups = {};
  for (const row of indexRows) {
    const idxName = row[indexNameKey];
    const colName = row[columnNameKey];
    const isUnique =
      row.unique === 1 ||
      row.unique === true ||
      row.Non_unique === 0 ||
      row.is_unique === true;
    if (!isUnique) continue;
    if (idxName === "PRIMARY" || idxName === "pk" || idxName === pkName)
      continue;
    if (!groups[idxName]) groups[idxName] = [];
    groups[idxName].push(colName);
  }
  const allGroups = Object.values(groups);
  if (allGroups.length === 0) return [pkName];
  // Prefer multi-column unique index, otherwise take the first one
  const multi = allGroups.find((g) => g.length > 1);
  if (multi) return multi;
  // Flatten all single-column unique indexes
  const flat = allGroups.flat();
  return flat.length > 0 ? flat : [pkName];
}

async function introspectPostgres(db, schema = "public") {
  const tables = await db.query(
    `/* PG_NATIVE */ SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [schema],
  );
  const tableNames = tables.map((r) => r.tablename);
  const models = [];
  for (const table of tableNames) {
    const columns = await db.query(
      `/* PG_NATIVE */ SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table],
    );
    const pkResult = await db.query(
      `/* PG_NATIVE */ SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [table],
    );
    const pk = pkResult.length > 0 ? pkResult[0].attname : "id";
    // Get unique indexes grouped by index name
    const uniqueIdxResult = await db.query(
      `/* PG_NATIVE */ SELECT ic.relname AS index_name, a.attname AS column_name
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisunique AND NOT i.indisprimary
       ORDER BY ic.relname, a.attnum`,
      [table],
    );
    const uniqueCols = groupUniqueIndexes(
      uniqueIdxResult,
      "index_name",
      "column_name",
      pk,
    );
    const allColNames = columns.map((c) => c.column_name);
    const option = detectOptionColumns(allColNames);
    const structure = {};
    for (const col of columns) {
      if (col.column_name === pk) continue;
      if (isTimestampColumn(col.column_name)) continue;
      if (isSafeDeleteColumn(col.column_name)) continue;
      structure[col.column_name] = buildRulePg(col);
    }
    models.push({
      table,
      primary_key: pk,
      unique: uniqueCols,
      structure,
      option,
    });
  }
  return models;
}

/**
 * Groups unique index query results by index name and picks the best set.
 * Prefers multi-column unique indexes. Falls back to [pkName].
 */
function groupUniqueIndexes(rows, indexNameKey, columnNameKey, pkName) {
  const groups = {};
  for (const row of rows) {
    const idxName = row[indexNameKey];
    const colName = row[columnNameKey];
    if (!groups[idxName]) groups[idxName] = [];
    groups[idxName].push(colName);
  }
  const allGroups = Object.values(groups);
  if (allGroups.length === 0) return [pkName];
  const multi = allGroups.find((g) => g.length > 1);
  if (multi) return multi;
  const flat = allGroups.flat();
  return flat.length > 0 ? flat : [pkName];
}

async function introspectSQLite3(db) {
  const tables = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .map((r) => r.name);
  const models = [];
  for (const table of tables) {
    const columns = db.query("PRAGMA table_info(`" + table + "`)");
    const pk = columns.find((c) => c.pk === 1);
    const pkName = pk ? pk.name : "id";
    const uniqueIdxs = db.query("PRAGMA index_list(`" + table + "`)");
    // Group unique index columns by index name
    const idxGroups = {};
    for (const idx of uniqueIdxs) {
      if (idx.unique) {
        const info = db.query("PRAGMA index_info(`" + idx.name + "`)");
        idxGroups[idx.name] = info.map((i) => i.name);
      }
    }
    const allGroups = Object.values(idxGroups);
    let uniqueCols;
    if (allGroups.length === 0) {
      uniqueCols = [pkName];
    } else {
      const multi = allGroups.find((g) => g.length > 1);
      if (multi) {
        uniqueCols = multi;
      } else {
        uniqueCols = allGroups.flat();
      }
    }
    const allColNames = columns.map((c) => c.name);
    const option = detectOptionColumns(allColNames);
    const structure = {};
    for (const col of columns) {
      if (pk && col.name === pk.name) continue;
      if (isTimestampColumn(col.name)) continue;
      if (isSafeDeleteColumn(col.name)) continue;
      structure[col.name] = buildRuleSqlite(col);
    }
    models.push({
      table,
      primary_key: pkName,
      unique: uniqueCols,
      structure,
      option,
    });
  }
  return models;
}

async function introspectMSSQL(db) {
  const tables = await db.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'",
  );
  const tableNames = (tables.recordset || tables).map((r) => r.TABLE_NAME);
  const models = [];
  for (const table of tableNames) {
    const columns = await db.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}'
       ORDER BY ORDINAL_POSITION`,
    );
    const colRows = columns.recordset || columns;
    const pkResult = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE OBJECTPROPERTY(OBJECT_ID(CONSTRAINT_SCHEMA + '.' + CONSTRAINT_NAME), 'IsPrimaryKey') = 1
       AND TABLE_NAME = '${table}'`,
    );
    const pkRows = pkResult.recordset || pkResult;
    const pk = pkRows.length > 0 ? pkRows[0].COLUMN_NAME : "id";
    // Get unique constraints grouped by constraint name (excluding PK)
    const uniqueResult = await db.query(
      `SELECT tc.CONSTRAINT_NAME, col.COLUMN_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE col ON tc.CONSTRAINT_NAME = col.CONSTRAINT_NAME
       WHERE tc.TABLE_NAME = '${table}' AND tc.CONSTRAINT_TYPE = 'UNIQUE'
       ORDER BY tc.CONSTRAINT_NAME, col.ORDINAL_POSITION`,
    );
    const uniqueRows = uniqueResult.recordset || uniqueResult;
    const uniqueCols = groupUniqueIndexes(
      uniqueRows,
      "CONSTRAINT_NAME",
      "COLUMN_NAME",
      pk,
    );
    const allColNames = colRows.map((c) => c.COLUMN_NAME);
    const option = detectOptionColumns(allColNames);
    const structure = {};
    for (const col of colRows) {
      if (col.COLUMN_NAME === pk) continue;
      if (isTimestampColumn(col.COLUMN_NAME)) continue;
      if (isSafeDeleteColumn(col.COLUMN_NAME)) continue;
      structure[col.COLUMN_NAME] = buildRuleMssql(col);
    }
    models.push({
      table,
      primary_key: pk,
      unique: uniqueCols,
      structure,
      option,
    });
  }
  return models;
}

async function introspectOracle(db) {
  const tables = await db.query(
    "/* ORACLE_NATIVE */ SELECT table_name FROM user_tables ORDER BY table_name",
    [],
  );
  const tableNames = tables.map((r) => r.table_name || r.TABLE_NAME);
  const models = [];
  for (const table of tableNames) {
    const columns = await db.query(
      `/* ORACLE_NATIVE */ SELECT column_name, data_type, nullable, data_default
       FROM user_tab_columns WHERE table_name = :1 ORDER BY column_id`,
      [table.toUpperCase()],
    );
    const pkResult = await db.query(
      `/* ORACLE_NATIVE */ SELECT cols.column_name FROM user_constraints cons
       JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
       WHERE cons.table_name = :1 AND cons.constraint_type = 'P'`,
      [table.toUpperCase()],
    );
    const pkRows = pkResult.map((r) =>
      (r.column_name || r.COLUMN_NAME || "").toLowerCase(),
    );
    const pk = pkRows.length > 0 ? pkRows[0] : "id";
    // Get unique constraints grouped by constraint name (excluding PK)
    const uniqueResult = await db.query(
      `/* ORACLE_NATIVE */ SELECT cons.constraint_name, cols.column_name
       FROM user_constraints cons
       JOIN user_cons_columns cols ON cons.constraint_name = cols.constraint_name
       WHERE cons.table_name = :1 AND cons.constraint_type = 'U'
       ORDER BY cons.constraint_name, cols.position`,
      [table.toUpperCase()],
    );
    const uniqueRows = uniqueResult.map((r) => ({
      constraint_name: (
        r.constraint_name ||
        r.CONSTRAINT_NAME ||
        ""
      ).toLowerCase(),
      column_name: (r.column_name || r.COLUMN_NAME || "").toLowerCase(),
    }));
    const uniqueCols = groupUniqueIndexes(
      uniqueRows,
      "constraint_name",
      "column_name",
      pk,
    );
    const allColNames = columns.map((c) =>
      (c.column_name || c.COLUMN_NAME || "").toLowerCase(),
    );
    const option = detectOptionColumns(allColNames);
    const structure = {};
    for (const col of columns) {
      const colName = (col.column_name || col.COLUMN_NAME || "").toLowerCase();
      if (colName === pk) continue;
      if (isTimestampColumn(colName)) continue;
      if (isSafeDeleteColumn(colName)) continue;
      structure[colName] = buildRuleOracle(col);
    }
    models.push({
      table: table.toLowerCase(),
      primary_key: pk,
      unique: uniqueCols,
      structure,
      option,
    });
  }
  return models;
}

async function introspectCockroachDB(db) {
  // CockroachDB is PG-compatible, reuse postgres introspection
  return introspectPostgres(db);
}

// --- Timestamp column detection ---

const CREATED_AT_VARIANTS = new Set([
  "created_at",
  "createdat",
  "created",
  "create_date",
  "createdate",
  "creation_date",
  "creationdate",
]);

const MODIFIED_AT_VARIANTS = new Set([
  "modified_at",
  "modifiedat",
  "modified",
  "updated_at",
  "updatedat",
  "updated",
  "update_date",
  "updatedate",
  "modification_date",
  "modificationdate",
]);

const TIMESTAMP_COLUMNS = new Set([
  ...CREATED_AT_VARIANTS,
  ...MODIFIED_AT_VARIANTS,
]);

const SAFE_DELETE_VARIANTS = new Set([
  "is_deleted",
  "isdeleted",
  "deleted",
  "is_removed",
  "isremoved",
  "removed",
  "soft_deleted",
  "softdeleted",
  "is_active",
  "isactive",
  "is_archived",
  "isarchived",
  "archived",
]);

function isTimestampColumn(name) {
  return TIMESTAMP_COLUMNS.has(name.toLowerCase());
}

function isSafeDeleteColumn(name) {
  return SAFE_DELETE_VARIANTS.has(name.toLowerCase());
}

function isCreatedAtColumn(name) {
  return CREATED_AT_VARIANTS.has(name.toLowerCase());
}

function isModifiedAtColumn(name) {
  return MODIFIED_AT_VARIANTS.has(name.toLowerCase());
}

/**
 * Scan column names and return detected option fields:
 *   { safeDelete, created_at, modified_at }
 * Each is the actual column name from the DB, or null if not found.
 */
function detectOptionColumns(columnNames) {
  let safeDelete = null;
  let created_at = null;
  let modified_at = null;
  for (const name of columnNames) {
    const lower = name.toLowerCase();
    if (!safeDelete && isSafeDeleteColumn(lower)) safeDelete = name;
    if (!created_at && isCreatedAtColumn(lower)) created_at = name;
    if (!modified_at && isModifiedAtColumn(lower)) modified_at = name;
  }
  return { safeDelete, created_at, modified_at };
}

// --- Rule builders per DB type ---

function buildRule(col) {
  // MySQL SHOW COLUMNS format: { Field, Type, Null, Key, Default, Extra }
  const nullable = col.Null === "YES";
  const hasDefault =
    col.Default !== null || (col.Extra && col.Extra.includes("auto_increment"));
  const type = mysqlTypeToValidator(col.Type);
  return (nullable || hasDefault ? "" : "required|") + type;
}

function buildRulePg(col) {
  const nullable = col.is_nullable === "YES";
  const hasDefault =
    col.column_default !== null && col.column_default !== undefined;
  const type = pgTypeToValidator(col.data_type);
  return (nullable || hasDefault ? "" : "required|") + type;
}

function buildRuleSqlite(col) {
  const nullable = col.notnull === 0;
  const hasDefault = col.dflt_value !== null && col.dflt_value !== undefined;
  const type = sqliteTypeToValidator(col.type);
  return (nullable || hasDefault ? "" : "required|") + type;
}

function buildRuleMssql(col) {
  const nullable = col.IS_NULLABLE === "YES";
  const hasDefault =
    col.COLUMN_DEFAULT !== null && col.COLUMN_DEFAULT !== undefined;
  const type = mssqlTypeToValidator(col.DATA_TYPE);
  return (nullable || hasDefault ? "" : "required|") + type;
}

function buildRuleOracle(col) {
  const nullable = (col.nullable || col.NULLABLE || "Y") === "Y";
  const rawDefault = col.data_default || col.DATA_DEFAULT;
  const hasDefault =
    rawDefault !== null &&
    rawDefault !== undefined &&
    String(rawDefault).trim() !== "";
  const dataType = (col.data_type || col.DATA_TYPE || "").toUpperCase();
  const type = oracleTypeToValidator(dataType);
  return (nullable || hasDefault ? "" : "required|") + type;
}

function mysqlTypeToValidator(t) {
  t = t.toLowerCase();
  if (/int/.test(t)) return "integer";
  if (/float|double|decimal|numeric/.test(t)) return "numeric";
  if (/json/.test(t)) return "object";
  if (/text|char|varchar|enum|set/.test(t)) return "string";
  if (/blob|binary/.test(t)) return "string";
  if (/date|time|year/.test(t)) return "string";
  if (/bool/.test(t)) return "integer";
  return "string";
}

function pgTypeToValidator(t) {
  t = t.toLowerCase();
  if (/int|serial/.test(t)) return "integer";
  if (/numeric|decimal|real|double|float|money/.test(t)) return "numeric";
  if (/json/.test(t)) return "object";
  if (/bool/.test(t)) return "integer";
  if (/char|text|varchar|uuid/.test(t)) return "string";
  if (/date|time|interval/.test(t)) return "string";
  return "string";
}

function sqliteTypeToValidator(t) {
  t = (t || "").toLowerCase();
  if (/int/.test(t)) return "integer";
  if (/real|float|double|numeric|decimal/.test(t)) return "numeric";
  if (/json/.test(t)) return "object";
  if (/blob/.test(t)) return "string";
  return "string";
}

function mssqlTypeToValidator(t) {
  t = (t || "").toLowerCase();
  if (/int|smallint|tinyint|bigint/.test(t)) return "integer";
  if (/decimal|numeric|float|real|money/.test(t)) return "numeric";
  if (/bit/.test(t)) return "integer";
  if (/char|text|varchar|nchar|nvarchar|ntext/.test(t)) return "string";
  if (/date|time|datetime/.test(t)) return "string";
  if (/uniqueidentifier/.test(t)) return "string";
  return "string";
}

function oracleTypeToValidator(t) {
  if (/NUMBER|INTEGER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE/.test(t))
    return "numeric";
  if (/CLOB|BLOB|RAW|LONG/.test(t)) return "string";
  if (/DATE|TIMESTAMP/.test(t)) return "string";
  if (/CHAR|VARCHAR|NCHAR|NVARCHAR/.test(t)) return "string";
  return "string";
}

// --- Code generation ---

function safeVarName(name) {
  // If the table name is a valid JS identifier, use it as-is
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return name;
  // Otherwise fall back to a safe version
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}

function generateModelFile(m) {
  const varName = safeVarName(m.table);
  const structStr = JSON.stringify(m.structure, null, 4);
  const uniqueStr = JSON.stringify(m.unique);
  const opt = m.option || {};
  const hasOption = opt.safeDelete || opt.created_at || opt.modified_at;
  let optionStr = "";
  if (hasOption) {
    const parts = [];
    if (opt.safeDelete) parts.push(`safeDelete: "${opt.safeDelete}"`);
    if (opt.created_at) parts.push(`created_at: "${opt.created_at}"`);
    if (opt.modified_at) parts.push(`modified_at: "${opt.modified_at}"`);
    optionStr = `\n  { ${parts.join(", ")} },`;
  }
  return `const { db, model } = require("db-model-router");

const ${varName} = model(
  db,
  "${m.table}",
  ${structStr},
  "${m.primary_key}",
  ${uniqueStr},${optionStr}
);

module.exports = ${varName};
`;
}

function generateIndexFile(models) {
  let imports = "";
  let exports = "";
  for (const m of models) {
    const varName = safeVarName(m.table);
    imports += `const ${varName} = require("./${m.table}");\n`;
    exports += `  ${varName},\n`;
  }
  return `${imports}
module.exports = {
${exports}};
`;
}

// --- Main CLI ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const dbType = DB_TYPE_MAP[(args.type || "").toLowerCase()];
  if (!dbType) {
    console.error(
      `Error: Unsupported --type "${args.type}". Supported: ${SUPPORTED_TYPES.join(", ")}`,
    );
    process.exit(1);
  }

  const outputDir = path.resolve(args.output || "./models");

  // Load env file if provided
  if (args.env) {
    require("dotenv").config({ path: path.resolve(args.env) });
  }

  const config = buildConfig(args);

  console.log(`Connecting to ${dbType}...`);

  const restRouter = require("../index.js");
  restRouter.init(dbType);
  const db = restRouter.db;
  db.connect(config);

  let models;
  try {
    switch (dbType) {
      case "mysql":
        models = await introspectMySQL(db);
        break;
      case "postgres":
        models = await introspectPostgres(db, args.schema || "public");
        break;
      case "sqlite3":
        models = await introspectSQLite3(db);
        break;
      case "mssql":
        models = await introspectMSSQL(db);
        break;
      case "oracle":
        models = await introspectOracle(db);
        break;
      case "cockroachdb":
        models = await introspectCockroachDB(db);
        break;
    }
  } catch (err) {
    console.error("Introspection failed:", err.message);
    process.exit(1);
  }

  if (!models || models.length === 0) {
    console.log("No tables found.");
    process.exit(0);
  }

  // Apply --tables filter if provided
  if (args.tables) {
    const tableSpecs = args.tables.split(",").map((s) => s.trim());
    const allowedTables = new Set(
      tableSpecs.map((s) => (s.includes(".") ? s.split(".").pop() : s)),
    );
    // Also include parent tables referenced in dot notation
    for (const spec of tableSpecs) {
      if (spec.includes(".")) {
        const parts = spec.split(".");
        for (const p of parts) allowedTables.add(p);
      }
    }
    models = models.filter((m) => allowedTables.has(m.table));
  }

  // Write files
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const m of models) {
    const filePath = path.join(outputDir, m.table + ".js");
    fs.writeFileSync(filePath, generateModelFile(m));
    console.log(`  Created ${filePath}`);
  }

  const indexPath = path.join(outputDir, "index.js");
  fs.writeFileSync(indexPath, generateIndexFile(models));
  console.log(`  Created ${indexPath}`);

  console.log(`\nGenerated ${models.length} model(s) in ${outputDir}`);

  // Disconnect
  if (db.disconnect) await db.disconnect();
  else if (db.close) await db.close();
  process.exit(0);
}

function buildConfig(args) {
  return {
    host: args.host || process.env.DB_HOST || "localhost",
    port: args.port || process.env.DB_PORT,
    database: args.database || process.env.DB_NAME,
    user: args.user || process.env.DB_USER,
    password: args.password || process.env.DB_PASS,
    // sqlite3
    filename: args.database || process.env.DB_NAME,
    // mssql
    server: args.host || process.env.DB_HOST || "localhost",
    options: { encrypt: false, trustServerCertificate: true },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Usage: rest-router-generate-model --type <db_type> [options]

Options:
  --type        Database type (${SUPPORTED_TYPES.join(", ")})
  --host        Database host (default: localhost)
  --port        Database port
  --database    Database name (or file path for sqlite3)
  --user        Database user
  --password    Database password
  --schema      Schema name (postgres only, default: public)
  --output      Output directory (default: ./models)
  --tables      Comma-separated list of tables to generate (default: all)
                Use dot notation for parent-child: posts.comments
  --env         Path to .env file to load
  --help        Show this help message

Examples:
  rest-router-generate-model --type mysql --host localhost --database mydb --user root --password secret
  rest-router-generate-model --type sqlite3 --database ./myapp.db --output ./src/models
  rest-router-generate-model --type postgres --env .env --output ./models
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

// Export for programmatic use / testing
module.exports = {
  introspectMySQL,
  introspectPostgres,
  introspectSQLite3,
  introspectMSSQL,
  introspectOracle,
  introspectCockroachDB,
  generateModelFile,
  generateIndexFile,
  isTimestampColumn,
  isSafeDeleteColumn,
  isCreatedAtColumn,
  isModifiedAtColumn,
  detectOptionColumns,
  safeVarName,
};
