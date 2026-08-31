"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const { rotateTable } = require("../encryption-batch");
const encryption = require("../../commons/encryption");
const { connectDb } = require("./encrypt-scan");

/**
 * encrypt:rotate-key — re-encrypt all `encrypted` fields in the schema to a
 * new key version. Reads with the existing keyring (old keys) and writes with
 * the new key/version.
 *
 * Flags:
 *   --from <path>      Schema file (default: dbmr.schema.json)
 *   --type <adapter>   Database adapter (required)
 *   --env <path>       Path to .env file for DB credentials
 *   --tables <list>    Comma-separated table filter (default: all)
 *   --to <n>           Target key version (required)
 *   --new-key <ref>    New key reference (default: options.encryption.key)
 *   --keys <json>      Override OLD keyring map — must contain the keys that
 *                      currently encrypt the data (default: options.encryption.keys)
 *   --key <ref>        Alias for old key reference (options.encryption.key)
 *   --dry-run          Preview what would change without writing
 *   --json             Output machine-readable JSON
 */
async function encryptRotateKey(args, flags, ctx) {
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

  const toVersion = parseInt(args.to, 10);
  if (!Number.isInteger(toVersion) || toVersion < 1) {
    ctx.log("Error: Missing or invalid --to <n> target key version (positive integer)");
    process.exitCode = 1;
    return;
  }

  const encOpts = (schema.options && schema.options.encryption) || {};
  const oldKeyRef = args.key || encOpts.key;
  const oldKeys = args.keys ? JSON.parse(args.keys) : encOpts.keys;
  const newKeyRef = args.newKey || encOpts.key;

  if (!oldKeyRef) {
    ctx.log("Error: No encryption key configured. Set options.encryption.key in the schema or pass --key");
    process.exitCode = 1;
    return;
  }

  // Resolve the OLD keyring (key/keys). Rotation never re-writes the config in
  // the schema file; the user is expected to bump options.encryption afterward.
  let oldConfig;
  try {
    encryption.setConfig({ key: oldKeyRef, version: encOpts.version, keys: oldKeys });
    oldConfig = encryption.getConfig();
    if (!oldConfig) throw new Error("Failed to resolve encryption config");
  } catch (err) {
    ctx.log(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // Resolve the NEW key (active key for version `toVersion`)
  let newKey;
  try {
    newKey = encryption.resolveKey(newKeyRef);
  } catch (err) {
    ctx.log(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const allowed = args.tables
    ? new Set(args.tables.split(",").map((s) => s.trim()))
    : null;

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
    if (flags.json) ctx.result({ rotated: [] });
    return;
  }

  let db;
  try {
    const conn = connectDb(adapterType, args);
    db = conn.db;
  } catch (err) {
    ctx.log(`Error: Database connection failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  const failures = [];
  try {
    for (const tableName of targets) {
      const tableDef = schema.tables[tableName];
      try {
        const result = await rotateTable(
          db,
          tableName,
          tableDef.pk,
          tableDef.columns,
          oldConfig,
          toVersion,
          newKey,
          { safeDelete: tableDef.softDelete || null, dryRun: flags.dryRun },
        );
        results.push({ table: tableName, ...result });
      } catch (err) {
        failures.push({ table: tableName, message: err.message });
      }
    }
  } finally {
    if (db.disconnect) await db.disconnect();
    else if (db.close) db.close();
  }

  if (flags.json) {
    ctx.result({ toVersion, results, failures });
    return;
  }

  ctx.log(`Rotating keys to version v${toVersion}:\n`);
  for (const r of results) {
    ctx.log(
      `  ${r.table}: ${r.changed} value(s) ${flags.dryRun ? "would be" : ""} rotated${r.errors && r.errors.length ? `, ${r.errors.length} error(s)` : ""}`,
    );
    if (r.errors) {
      for (const e of r.errors) {
        ctx.log(`    - pk=${e.pk} field=${e.field}: ${e.message}`);
      }
    }
  }
  if (failures.length > 0) {
    ctx.log("\nFailed tables:");
    for (const f of failures) ctx.log(`  ${f.table}: ${f.message}`);
  }
  if (!flags.dryRun) {
    ctx.log(
      `\nRotation complete. Update options.encryption in ${schemaFile} — set version to ${toVersion} and ensure keys includes the new key (run "db-model-router doctor" to check).`,
    );
  }
}

module.exports = encryptRotateKey;