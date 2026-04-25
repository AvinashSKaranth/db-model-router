"use strict";

const fs = require("fs");
const path = require("path");
const { printSchema } = require("../../schema/schema-printer");
const {
  introspectMySQL,
  introspectPostgres,
  introspectSQLite3,
  introspectMSSQL,
  introspectOracle,
  introspectCockroachDB,
} = require("../generate-model");

/**
 * Map of adapter names to their introspection functions.
 * Each value is an async function(db) => ModelMeta[].
 */
const INTROSPECT_MAP = {
  mysql: introspectMySQL,
  postgres: introspectPostgres,
  sqlite3: introspectSQLite3,
  mssql: introspectMSSQL,
  oracle: introspectOracle,
  cockroachdb: introspectCockroachDB,
};

/**
 * Convert a ModelMeta array (from introspection) into a ParsedSchema object.
 * This is the reverse of schemaToModelMeta.
 *
 * @param {string} adapter - The database adapter name
 * @param {string} framework - The framework name (default: "express")
 * @param {Array<{table, structure, primary_key, unique, option}>} models
 * @returns {object} ParsedSchema
 */
function modelMetaToSchema(adapter, framework, models) {
  const tables = {};

  for (const m of models) {
    const columns = {};

    // Re-add columns from structure
    for (const [col, rule] of Object.entries(m.structure)) {
      columns[col] = rule;
    }

    const pk = m.primary_key || "id";
    const unique = m.unique && m.unique.length > 0 ? [...m.unique] : [pk];

    const opt = m.option || {};
    const softDelete = opt.safeDelete || null;
    const timestamps = {
      created_at: opt.created_at || null,
      modified_at: opt.modified_at || null,
    };

    tables[m.table] = {
      name: m.table,
      columns,
      pk,
      unique,
      softDelete,
      timestamps,
    };
  }

  return {
    adapter,
    framework: framework || "express",
    tables,
    relationships: [],
    options: {},
  };
}

/**
 * Inspect command handler for the unified CLI.
 *
 * Connects to a live database, introspects its structure, converts to
 * ParsedSchema, prints via schema-printer, and writes to file.
 *
 * Supported flags:
 *   --type     Database adapter type (required)
 *   --env      Path to .env file for connection params
 *   --out      Output file path (default: dbmr.schema.json)
 *   --tables   Comma-separated list of tables to include
 *   --json     Output schema to stdout as JSON (no file write)
 *   --dry-run  Output schema to stdout without writing file
 *
 * @param {object} args - Parsed key-value args
 * @param {object} flags - Universal flags: { yes, json, dryRun, noInstall, help }
 * @param {import('../flags').OutputContext} ctx - Output context
 */
async function inspect(args, flags, ctx) {
  const adapterType = args.type;
  if (!adapterType || !INTROSPECT_MAP[adapterType]) {
    const supported = Object.keys(INTROSPECT_MAP).join(", ");
    const msg = adapterType
      ? `Unsupported --type "${adapterType}". Supported: ${supported}`
      : `Missing required --type flag. Supported: ${supported}`;
    if (flags.json) {
      ctx.result({ error: true, code: "INVALID_TYPE", message: msg });
    } else {
      ctx.log(`Error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  // Load .env file if --env provided
  if (args.env) {
    require("dotenv").config({ path: path.resolve(args.env) });
  }

  // Connect to database
  let db;
  try {
    const restRouter = require("../../index.js");
    restRouter.init(adapterType);
    db = restRouter.db;

    const config = {
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      filename: process.env.DB_NAME,
      server: process.env.DB_HOST || "localhost",
      options: { encrypt: false, trustServerCertificate: true },
    };

    db.connect(config);
  } catch (err) {
    const msg = `Database connection failed: ${err.message}`;
    if (flags.json) {
      ctx.result({ error: true, code: "CONNECTION_FAILED", message: msg });
    } else {
      ctx.log(`Error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  // Introspect
  let models;
  try {
    const introspectFn = INTROSPECT_MAP[adapterType];
    models = await introspectFn(db);
  } catch (err) {
    const msg = `Introspection failed: ${err.message}`;
    if (flags.json) {
      ctx.result({ error: true, code: "INTROSPECTION_FAILED", message: msg });
    } else {
      ctx.log(`Error: ${msg}`);
    }
    process.exitCode = 1;
    // Disconnect
    if (db.disconnect) await db.disconnect();
    else if (db.close) db.close();
    return;
  }

  // Disconnect
  try {
    if (db.disconnect) await db.disconnect();
    else if (db.close) db.close();
  } catch (_) {
    // ignore disconnect errors
  }

  // Filter by --tables if provided
  if (args.tables) {
    const allowed = new Set(args.tables.split(",").map((s) => s.trim()));
    models = models.filter((m) => allowed.has(m.table));
  }

  // Convert ModelMeta[] → ParsedSchema
  const schema = modelMetaToSchema(adapterType, "express", models);

  // Print via schema-printer
  const output = printSchema(schema);

  // Determine output path
  const outPath = args.out || "dbmr.schema.json";

  if (flags.json) {
    // --json: output schema to stdout, no file write
    ctx.result({ schema: JSON.parse(output), writtenTo: null });
  } else if (flags.dryRun) {
    // --dry-run: output schema to stdout, no file write
    ctx.log(output);
    ctx.log(`Would write to: ${outPath}`);
  } else {
    // Write to file
    const resolvedPath = path.resolve(outPath);
    fs.writeFileSync(resolvedPath, output, "utf8");
    ctx.log(`Schema written to ${outPath}`);
    ctx.log(output);
  }
}

module.exports = inspect;
module.exports.modelMetaToSchema = modelMetaToSchema;
