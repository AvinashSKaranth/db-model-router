"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const { scanTable, encryptTable } = require("../encryption-batch");
const encryption = require("../../commons/encryption");

/**
 * Resolve encryption config for a schema (its options.encryption block)
 * plus any overrides from CLI flags.
 */
function resolveEncryptionConfig(schema, args) {
  const opts = (schema.options && schema.options.encryption) || {};
  const key = args.key || opts.key;
  const version =
    args.version !== undefined ? parseInt(args.version, 10) : opts.version;
  const keys = args.keys ? JSON.parse(args.keys) : opts.keys;

  if (!key || !version) {
    return { error: "Missing encryption config. Provide options.encryption in the schema or --key/--version flags." };
  }

  try {
    encryption.setConfig({ key, version, keys });
    const config = encryption.getConfig();
    if (!config) return { error: "Failed to resolve encryption config" };
    return { config };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Build a per-model db connection using the same env/flag conventions as
 * the inspect command.
 */
function connectDb(adapterType, args) {
  if (args.env) {
    require("dotenv").config({ path: path.resolve(args.env) });
  }
  const restRouter = require("../../index.js");
  restRouter.init(adapterType);
  const db = restRouter.db;
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
  return { db, restRouter };
}

/**
 * encrypt:scan — scan one or more tables for unencrypted values in
 * fields that are marked `encrypted` in the schema.
 *
 * Flags:
 *   --from <path>      Schema file (default: dbmr.schema.json)
 *   --type <adapter>   Database adapter (mysql, postgres, sqlite3, ...)
 *   --env <path>       Path to .env file for DB credentials
 *   --tables <list>    Comma-separated table filter (default: all)
 *   --key <ref>        Override encryption key reference
 *   --version <n>      Override active key version
 *   --keys <json>      Override keyring map (JSON)
 *   --apply            Encrypt unencrypted values found (default: report only)
 *   --dry-run          Preview what would change without writing any data
 *   --json             Output machine-readable JSON
 */
async function encryptScan(args, flags, ctx) {
  const schemaFile = args.from || "dbmr.schema.json";
  const schemaPath = path.resolve(schemaFile);

  if (!fs.existsSync(schemaPath)) {
    ctx.log(`Error: Schema file not found: ${schemaFile}`);
    process.exitCode = 1;
    return;
  }

  let schema;
  try {
    schema = parseSchema(fs.readFileSync(schemaPath, "utf8"));
  } catch (err) {
    ctx.log(`Error: Failed to parse schema: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const adapterType = args.type;
  if (!adapterType) {
    ctx.log("Error: Missing required --type flag (mysql, postgres, sqlite3, ...)");
    process.exitCode = 1;
    return;
  }

  // Filter tables
  const allowed = args.tables
    ? new Set(args.tables.split(",").map((s) => s.trim()))
    : null;

  // Find tables that declare at least one encrypted field
  const targets = [];
  for (const [tableName, tableDef] of Object.entries(schema.tables)) {
    if (allowed && !allowed.has(tableName)) continue;
    const hasEncrypted = Object.values(tableDef.columns).some(
      (rule) => typeof rule === "string" && rule.split("|").includes("encrypted"),
    );
    if (hasEncrypted) targets.push(tableName);
  }

  if (targets.length === 0) {
    ctx.log("No tables declare encrypted fields in the schema.");
    if (flags.json) ctx.result({ reports: [], applied: [], failures: [] });
    return;
  }

  const { error, config } = resolveEncryptionConfig(schema, args);
  if (error) {
    ctx.log(`Error: ${error}`);
    process.exitCode = 1;
    return;
  }

  // Connect
  let db;
  try {
    const conn = connectDb(adapterType, args);
    db = conn.db;
  } catch (err) {
    ctx.log(`Error: Database connection failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const reports = [];
  const failures = [];
  const applied = [];
  try {
    for (const tableName of targets) {
      const tableDef = schema.tables[tableName];
      try {
        const commonOptions = {
          safeDelete: tableDef.softDelete || null,
        };
        const stats = await scanTable(db, tableName, tableDef.pk, tableDef.columns, commonOptions);
        reports.push(stats);

        // Report-only by default. --apply writes encrypted values back; with
        // --apply --dry-run, encryptTable still scans and counts but writes
        // nothing.
        if (args.apply) {
          const result = await encryptTable(
            db,
            tableName,
            tableDef.pk,
            tableDef.columns,
            config,
            { ...commonOptions, dryRun: !!flags.dryRun },
          );
          applied.push({ table: tableName, ...result });
        }
      } catch (err) {
        failures.push({ table: tableName, message: err.message });
      }
    }
  } finally {
    if (db.disconnect) await db.disconnect();
    else if (db.close) db.close();
  }

  if (flags.json) {
    ctx.result({ reports, applied, failures });
    return;
  }

  for (const stats of reports) {
    ctx.log(`\n${stats.table}:`);
    for (const [field, counts] of Object.entries(stats.fields)) {
      ctx.log(
        `  ${field}  ${counts.unencrypted} unencrypted / ${counts.encrypted} encrypted / ${counts.null} null`,
      );
    }
  }
  if (applied.length > 0) {
    ctx.log("\nEncryption applied:");
    for (const a of applied) {
      ctx.log(
        `  ${a.table}: ${a.changed} value(s) ${flags.dryRun ? "would be" : ""} encrypted`,
      );
    }
  }
  if (failures.length > 0) {
    ctx.log("\nFailed tables:");
    for (const f of failures) ctx.log(`  ${f.table}: ${f.message}`);
  }

  const totalUnencrypted = reports.reduce(
    (acc, r) =>
      acc +
      Object.values(r.fields).reduce((a, f) => a + f.unencrypted, 0),
    0,
  );
  if (totalUnencrypted > 0) {
    if (args.apply && flags.dryRun) {
      ctx.log(`\n${totalUnencrypted} unencrypted value(s) found. Re-run without --dry-run to encrypt them.`);
    } else if (!args.apply) {
      ctx.log(`\n${totalUnencrypted} unencrypted value(s) found. Re-run with --apply to encrypt them.`);
    }
  }
}

module.exports = encryptScan;
module.exports.resolveEncryptionConfig = resolveEncryptionConfig;
module.exports.connectDb = connectDb;