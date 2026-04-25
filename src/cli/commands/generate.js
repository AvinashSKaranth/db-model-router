"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const { schemaToModelMeta } = require("../../schema/schema-to-meta");
const { generateModelFile } = require("../generate-model");
const {
  generateRouteFile,
  generateChildRouteFile,
  generateRoutesIndexFile,
  generateTestFile,
  generateChildTestFile,
} = require("../generate-route");
const { generateOpenAPISpec } = require("../generate-openapi");
const { generateLlmsTxt, generateLlmMd } = require("./generate-llm-docs");

/**
 * Generate command handler for the unified CLI.
 *
 * Reads a schema file, converts to ModelMeta[], and generates
 * models, routes, tests, and OpenAPI spec files.
 *
 * Supported flags:
 *   --from      Path to schema file (default: dbmr.schema.json)
 *   --models    Generate only model files
 *   --routes    Generate only route files (including child routes and index)
 *   --openapi   Generate only OpenAPI spec
 *   --tests     Generate only test files
 *   --dry-run   Report planned files without writing
 *   --json      Output JSON result via ctx
 *
 * When no artifact flags are provided, all artifact types are generated.
 *
 * @param {object} args - Parsed key-value args
 * @param {object} flags - Universal flags: { yes, json, dryRun, noInstall, help }
 * @param {import('../flags').OutputContext} ctx - Output context
 */
async function generate(args, flags, ctx) {
  const schemaPath = path.resolve(args.from || "dbmr.schema.json");

  if (!fs.existsSync(schemaPath)) {
    const msg = `Schema file not found: ${args.from || "dbmr.schema.json"}`;
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

  const meta = schemaToModelMeta(schema);
  const relationships = schema.relationships || [];
  const tableNames = meta.map((m) => m.table).sort();

  // Determine which artifact types to generate
  const hasArtifactFlag =
    args.models === true ||
    args.routes === true ||
    args.openapi === true ||
    args.tests === true ||
    args["llm-docs"] === true;

  const genModels = !hasArtifactFlag || args.models === true;
  const genRoutes = !hasArtifactFlag || args.routes === true;
  const genOpenapi = !hasArtifactFlag || args.openapi === true;
  const genTests = !hasArtifactFlag || args.tests === true;
  const genLlmDocs = !hasArtifactFlag || args["llm-docs"] === true;

  const modelsRelPath = "../models";
  const baseDir = process.cwd();

  // Collect all planned files: { relPath, content }
  const planned = [];

  // --- Model files ---
  if (genModels) {
    for (const m of meta) {
      planned.push({
        relPath: `models/${m.table}.js`,
        content: generateModelFile(m),
      });
    }
  }

  // --- Route files ---
  if (genRoutes) {
    // One route per table
    for (const m of meta) {
      planned.push({
        relPath: `routes/${m.table}.js`,
        content: generateRouteFile(m.table, modelsRelPath),
      });
    }

    // Child route files (one per relationship)
    for (const rel of relationships) {
      planned.push({
        relPath: `routes/${rel.child}_child_of_${rel.parent}.js`,
        content: generateChildRouteFile(
          rel.child,
          rel.parent,
          rel.foreignKey,
          modelsRelPath,
        ),
      });
    }

    // Routes index file
    planned.push({
      relPath: "routes/index.js",
      content: generateRoutesIndexFile(tableNames, relationships),
    });
  }

  // --- OpenAPI spec ---
  if (genOpenapi) {
    planned.push({
      relPath: "openapi.json",
      content: JSON.stringify(generateOpenAPISpec(meta), null, 2) + "\n",
    });
  }

  // --- Test files ---
  if (genTests) {
    for (const m of meta) {
      planned.push({
        relPath: `test/${m.table}.test.js`,
        content: generateTestFile(m.table, m.primary_key),
      });
    }

    // Child test files (one per relationship)
    for (const rel of relationships) {
      const childMeta = meta.find((m) => m.table === rel.child);
      const pk = childMeta ? childMeta.primary_key : "id";
      planned.push({
        relPath: `test/${rel.child}_child_of_${rel.parent}.test.js`,
        content: generateChildTestFile(
          rel.child,
          rel.parent,
          rel.foreignKey,
          pk,
        ),
      });
    }
  }

  // --- LLM docs ---
  if (genLlmDocs) {
    planned.push({
      relPath: "llms.txt",
      content: generateLlmsTxt(),
    });
    planned.push({
      relPath: "docs/llm.md",
      content: generateLlmMd(),
    });
  }

  // --- Process planned files ---
  const results = [];

  for (const { relPath, content } of planned) {
    const fullPath = path.join(baseDir, relPath);

    if (flags.dryRun) {
      results.push({ path: relPath, status: "planned" });
      continue;
    }

    // Check if file exists and content matches (skip-unchanged)
    if (fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath, "utf8");
      if (existing === content) {
        results.push({ path: relPath, status: "unchanged" });
        ctx.log(`  unchanged ${relPath}`);
        continue;
      }
      // File exists but content differs — overwrite
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      results.push({ path: relPath, status: "overwritten" });
      ctx.log(`  overwritten ${relPath}`);
    } else {
      // File does not exist — create
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      results.push({ path: relPath, status: "created" });
      ctx.log(`  created ${relPath}`);
    }
  }

  // --- Output ---
  if (flags.dryRun) {
    if (flags.json) {
      ctx.result({ files: results });
    } else {
      ctx.log("Dry run — the following files would be generated:");
      for (const r of results) {
        ctx.log(`  ${r.path}`);
      }
      ctx.log(`\n${results.length} file(s) planned.`);
    }
  } else if (flags.json) {
    ctx.result({ files: results });
  } else {
    const created = results.filter((r) => r.status === "created").length;
    const overwritten = results.filter(
      (r) => r.status === "overwritten",
    ).length;
    const unchanged = results.filter((r) => r.status === "unchanged").length;
    ctx.log(
      `\nDone. ${created} created, ${overwritten} overwritten, ${unchanged} unchanged.`,
    );
  }
}

module.exports = generate;
