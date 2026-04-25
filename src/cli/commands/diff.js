"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const { SchemaValidationError } = require("../../schema/schema-validator");
const { schemaToModelMeta } = require("../../schema/schema-to-meta");
const { computeDiff } = require("../diff-engine");

/**
 * Diff command handler for the unified CLI.
 *
 * Compares the current generated files against what the schema would produce,
 * reporting additions, modifications (with line diffs), and deletions.
 * Does NOT modify any files on disk.
 *
 * Supported flags:
 *   --from      Path to schema file (default: dbmr.schema.json)
 *   --json      Output JSON result via ctx
 *
 * @param {object} args - Parsed key-value args
 * @param {object} flags - Universal flags: { yes, json, dryRun, noInstall, help }
 * @param {import('../flags').OutputContext} ctx - Output context
 */
async function diff(args, flags, ctx) {
  const schemaFile = args.from || "dbmr.schema.json";
  const schemaPath = path.resolve(schemaFile);
  const baseDir = process.cwd();

  // --- 1. Read and parse schema ---
  if (!fs.existsSync(schemaPath)) {
    const msg = `Schema file not found: ${schemaFile}`;
    if (flags.json) {
      ctx.result({ error: true, code: "SCHEMA_NOT_FOUND", message: msg });
    } else {
      ctx.log(`Error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  let schema;
  try {
    const raw = fs.readFileSync(schemaPath, "utf8");
    schema = parseSchema(raw);
  } catch (err) {
    const msg = `Schema parse error: ${err.message}`;
    if (flags.json) {
      ctx.result({
        error: true,
        code: "SCHEMA_VALIDATION",
        message: msg,
        errors: err.errors || [],
      });
    } else {
      ctx.log(`Error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  // --- 2. Compute diff ---
  const meta = schemaToModelMeta(schema);
  const relationships = schema.relationships || [];
  const result = computeDiff(baseDir, meta, relationships);

  // --- 3. Output results ---
  if (flags.json) {
    ctx.result({
      added: result.added,
      modified: result.modified,
      deleted: result.deleted,
    });
  } else {
    const total =
      result.added.length + result.modified.length + result.deleted.length;

    if (total === 0) {
      ctx.log("All generated files are up to date.");
      return;
    }

    if (result.added.length > 0) {
      ctx.log("Added (new files to create):");
      for (const f of result.added) {
        ctx.log(`  + ${f}`);
      }
    }

    if (result.modified.length > 0) {
      ctx.log("Modified (files with changes):");
      for (const m of result.modified) {
        ctx.log(`  ~ ${m.file}`);
        // Display line diffs indented
        for (const line of m.diff.split("\n")) {
          if (line) {
            ctx.log(`    ${line}`);
          }
        }
      }
    }

    if (result.deleted.length > 0) {
      ctx.log("Deleted (extra files to remove):");
      for (const f of result.deleted) {
        ctx.log(`  - ${f}`);
      }
    }

    ctx.log(`\n${total} file(s) differ.`);
  }
}

module.exports = diff;
