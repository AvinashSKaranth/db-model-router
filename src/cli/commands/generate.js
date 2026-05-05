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
const { generateMigrationFiles } = require("../generate-migration");
const { generateDocsRoute } = require("../generate-docs-route");
const { generateDbManager } = require("../generate-db-manager");
const { migrationTimestamp } = require("../init/generators");

/**
 * Generate command handler for the unified CLI.
 *
 * Reads a schema file, converts to ModelMeta[], and generates
 * models, routes, tests, OpenAPI spec, migrations, and docs route.
 *
 * Supported flags:
 *   --from        Path to schema file (default: dbmr.schema.json)
 *   --models      Generate only model files
 *   --routes      Generate only route files (including child routes and index)
 *   --openapi     Generate only OpenAPI spec + docs route
 *   --tests       Generate only test files
 *   --migrations  Generate only migration files
 *   --db-manager  Generate DB Manager UI (SQL adapters only)
 *   --dry-run     Report planned files without writing
 *   --json        Output JSON result via ctx
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
    args.migrations === true ||
    args["db-manager"] === true;

  const genModels = !hasArtifactFlag || args.models === true;
  const genRoutes = !hasArtifactFlag || args.routes === true;
  const genOpenapi = !hasArtifactFlag || args.openapi === true;
  const genTests = !hasArtifactFlag || args.tests === true;
  const genMigrations = !hasArtifactFlag || args.migrations === true;
  //const genDbManager = !hasArtifactFlag || args["db-manager"] === true;
  const genDbManager = false;

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
    // Collect child tables to skip generating top-level route files for them
    const nestedChildren = new Set();
    for (const rel of relationships) {
      nestedChildren.add(rel.child);
    }

    // One route per top-level table (skip children)
    for (const m of meta) {
      if (nestedChildren.has(m.table)) continue;
      planned.push({
        relPath: `routes/${m.table}.js`,
        content: generateRouteFile(m.table, modelsRelPath),
      });
    }

    // Child route files in subfolders: routes/<parent>/<child>.js
    for (const rel of relationships) {
      planned.push({
        relPath: `routes/${rel.parent}/${rel.child}.js`,
        content: generateChildRouteFile(
          rel.child,
          rel.parent,
          rel.foreignKey,
          `../../models`,
        ),
      });
    }

    // Routes index file (include docs route when openapi is being generated)
    planned.push({
      relPath: "routes/index.js",
      content: generateRoutesIndexFile(tableNames, relationships, {
        includeDocs: genOpenapi,
      }),
    });
  }

  // --- OpenAPI spec + docs route ---
  if (genOpenapi) {
    planned.push({
      relPath: "openapi.json",
      content:
        JSON.stringify(generateOpenAPISpec(meta, { relationships }), null, 2) +
        "\n",
    });

    // Generate Swagger UI docs route
    planned.push({
      relPath: "routes/docs.js",
      content: generateDocsRoute(),
    });
  }

  // --- Migration files ---
  if (genMigrations) {
    const migrationFiles = generateMigrationFiles(schema);
    const ts = migrationTimestamp(new Date());
    for (const mf of migrationFiles) {
      planned.push({
        relPath: `migrations/${ts}_${mf.filename}`,
        content: mf.content,
      });
    }
  }

  // --- Test files ---
  if (genTests) {
    // Collect child tables to skip generating top-level test files for them
    const nestedChildrenForTests = new Set();
    for (const rel of relationships) {
      nestedChildrenForTests.add(rel.child);
    }

    for (const m of meta) {
      if (nestedChildrenForTests.has(m.table)) continue;
      planned.push({
        relPath: `test/${m.table}.test.js`,
        content: generateTestFile(m.table, m.primary_key),
      });
    }

    // Child test files in subfolders: test/<parent>/<child>.test.js
    for (const rel of relationships) {
      const childMeta = meta.find((m) => m.table === rel.child);
      const pk = childMeta ? childMeta.primary_key : "id";
      planned.push({
        relPath: `test/${rel.parent}/${rel.child}.test.js`,
        content: generateChildTestFile(
          rel.child,
          rel.parent,
          rel.foreignKey,
          pk,
        ),
      });
    }
  }

  // --- DB Manager ---
  if (genDbManager) {
    const dbmOptions = {};
    const envPath = path.join(baseDir, ".env");
    const envExamplePath = path.join(baseDir, ".env.example");
    const appJsPath = path.join(baseDir, "app.js");
    const pkgJsonPath = path.join(baseDir, "package.json");

    if (fs.existsSync(envPath)) {
      dbmOptions.envContent = fs.readFileSync(envPath, "utf8");
    }
    if (fs.existsSync(envExamplePath)) {
      dbmOptions.envExampleContent = fs.readFileSync(envExamplePath, "utf8");
    }
    if (fs.existsSync(appJsPath)) {
      dbmOptions.appJsContent = fs.readFileSync(appJsPath, "utf8");
    }
    if (fs.existsSync(pkgJsonPath)) {
      dbmOptions.packageJsonContent = fs.readFileSync(pkgJsonPath, "utf8");
    }

    const dbmResult = generateDbManager(schema, dbmOptions);

    for (const f of dbmResult.files) {
      planned.push(f);
    }

    for (const w of dbmResult.warnings) {
      ctx.log(`  warning: ${w}`);
    }
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
