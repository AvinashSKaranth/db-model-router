"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const { SchemaValidationError } = require("../../schema/schema-validator");
const { schemaToModelMeta } = require("../../schema/schema-to-meta");
const { computeDiff } = require("../diff-engine");

/**
 * Adapter-to-driver mapping.
 * Maps each supported adapter to the npm package name required.
 */
const ADAPTER_DRIVER_MAP = {
  mysql: "mysql2",
  postgres: "pg",
  sqlite3: "better-sqlite3",
  mongodb: "mongodb",
  mssql: "tedious",
  cockroachdb: "pg",
  oracle: "oracledb",
  redis: "redis",
  dynamodb: "@aws-sdk/client-dynamodb",
};

/**
 * Doctor command handler for the unified CLI.
 *
 * Validates the schema, checks adapter driver dependencies in package.json,
 * and verifies generated files are in sync with the schema.
 *
 * Supported flags:
 *   --from      Path to schema file (default: dbmr.schema.json)
 *   --json      Output JSON result via ctx
 *
 * @param {object} args - Parsed key-value args
 * @param {object} flags - Universal flags: { yes, json, dryRun, noInstall, help }
 * @param {import('../flags').OutputContext} ctx - Output context
 */
async function doctor(args, flags, ctx) {
  const schemaFile = args.from || "dbmr.schema.json";
  const schemaPath = path.resolve(schemaFile);
  const baseDir = process.cwd();

  // --- 1. Schema validation ---
  const validation = { valid: true, errors: [] };
  let schema = null;

  if (!fs.existsSync(schemaPath)) {
    validation.valid = false;
    validation.errors.push({
      path: "",
      message: `Schema file not found: ${schemaFile}`,
    });
  } else {
    try {
      const raw = fs.readFileSync(schemaPath, "utf8");
      schema = parseSchema(raw);
    } catch (err) {
      validation.valid = false;
      if (err instanceof SchemaValidationError) {
        validation.errors = err.errors;
      } else {
        validation.errors.push({ path: "", message: err.message });
      }
    }
  }

  // --- 2. Dependency check ---
  const dependencies = { ok: true, missing: [] };

  if (schema) {
    const driver = ADAPTER_DRIVER_MAP[schema.adapter];
    if (driver) {
      const pkgPath = path.join(baseDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
          const allDeps = Object.assign(
            {},
            pkg.dependencies || {},
            pkg.devDependencies || {},
          );
          if (!allDeps[driver]) {
            dependencies.ok = false;
            dependencies.missing.push({
              adapter: schema.adapter,
              driver,
            });
          }
        } catch (_) {
          // If package.json is unreadable, report driver as missing
          dependencies.ok = false;
          dependencies.missing.push({
            adapter: schema.adapter,
            driver,
          });
        }
      } else {
        dependencies.ok = false;
        dependencies.missing.push({
          adapter: schema.adapter,
          driver,
        });
      }
    }
  }

  // --- 3. Sync check ---
  const sync = { ok: true, outOfSync: [] };

  if (schema) {
    const meta = schemaToModelMeta(schema);
    const relationships = schema.relationships || [];
    const diff = computeDiff(baseDir, meta, relationships);

    if (
      diff.added.length > 0 ||
      diff.modified.length > 0 ||
      diff.deleted.length > 0
    ) {
      sync.ok = false;
      for (const f of diff.added) {
        sync.outOfSync.push({ file: f, status: "missing" });
      }
      for (const m of diff.modified) {
        sync.outOfSync.push({ file: m.file, status: "modified" });
      }
      for (const f of diff.deleted) {
        sync.outOfSync.push({ file: f, status: "extra" });
      }
    }
  }

  // --- 4. Report results ---
  const allPass = validation.valid && dependencies.ok && sync.ok;
  const report = { validation, dependencies, sync };

  if (flags.json) {
    ctx.result(report);
  } else {
    // Validation
    if (validation.valid) {
      ctx.log("✓ Schema validation passed");
    } else {
      ctx.log("✗ Schema validation failed:");
      for (const e of validation.errors) {
        const loc = e.path ? ` (${e.path})` : "";
        ctx.log(`    ${e.message}${loc}`);
      }
    }

    // Dependencies
    if (dependencies.ok) {
      ctx.log("✓ Dependencies OK");
    } else {
      ctx.log("✗ Missing dependencies:");
      for (const m of dependencies.missing) {
        ctx.log(`    ${m.adapter} requires "${m.driver}" in package.json`);
      }
    }

    // Sync
    if (sync.ok) {
      ctx.log("✓ Generated files in sync");
    } else {
      ctx.log("✗ Files out of sync:");
      for (const s of sync.outOfSync) {
        ctx.log(`    ${s.file} (${s.status})`);
      }
    }
  }

  // --- 5. Exit code ---
  if (!allPass) {
    process.exitCode = 1;
  }
}

module.exports = doctor;
module.exports.ADAPTER_DRIVER_MAP = ADAPTER_DRIVER_MAP;
