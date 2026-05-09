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
const { migrationTimestamp } = require("../init/generators");
const { generateSaasStructure } = require("../generate-saas-structure");
const { generateSaasOpenAPIPaths } = require("../saas/generate-saas-openapi");

/**
 * Supported database adapters for the SaaS structure generator.
 * @type {string[]}
 */
const SUPPORTED_ADAPTERS = [
  "postgres",
  "mysql",
  "sqlite3",
  "mssql",
  "oracle",
  "cockroachdb",
  "mongodb",
  "dynamodb",
  "redis",
];

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
  // --- Standard schema-based generation ---
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
  // All flags default to true — use --flag=false to disable
  const genModels = args.models !== false;
  const genRoutes = args.routes !== false;
  const genOpenapi = args.openapi !== false;
  const genTests = args.tests !== false;
  const genMigrations = args.migrations !== false;
  const genSaas = args["saas-structure"] !== false;

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
    const spec = generateOpenAPISpec(meta, { relationships });

    // Merge SaaS routes into the OpenAPI spec when saas-structure is active
    // SaaS routes appear BEFORE product routes in the docs
    if (genSaas) {
      const saasApi = generateSaasOpenAPIPaths();

      // Prepend SaaS paths before product paths
      const productPaths = spec.paths;
      spec.paths = { ...saasApi.paths, ...productPaths };

      // Prepend SaaS schemas before product schemas
      const productSchemas = spec.components.schemas;
      spec.components.schemas = { ...saasApi.schemas, ...productSchemas };

      if (!spec.components.securitySchemes) {
        spec.components.securitySchemes = {};
      }
      Object.assign(spec.components.securitySchemes, saasApi.securitySchemes);
    }

    planned.push({
      relPath: "openapi.json",
      content: JSON.stringify(spec, null, 2) + "\n",
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

  // --- SaaS structure files (additive, on top of schema-based generation) ---
  if (genSaas) {
    // Determine adapter: from --adapter flag, or from the schema's adapter field
    const adapter = args.adapter || schema.adapter;

    if (!adapter || !SUPPORTED_ADAPTERS.includes(adapter)) {
      const msg = adapter
        ? `Invalid adapter: ${adapter}. Supported: ${SUPPORTED_ADAPTERS.join(", ")}`
        : `Adapter is required for saas-structure generation. Provide --adapter or set adapter in schema.`;
      if (flags.json) {
        ctx.result({ error: true, code: "INVALID_ADAPTER", message: msg });
      } else {
        ctx.log(`Error: ${msg}`);
      }
      process.exitCode = 1;
      return;
    }

    const saasFiles = generateSaasStructure(adapter, {
      dryRun: flags.dryRun,
      json: flags.json,
      timestamp: new Date(),
      tableNames,
      relationships,
      routeOptions: { includeDocs: genOpenapi },
    });

    // The SaaS generator produces a combined routes/index.js that includes
    // both SaaS routes and dbmr schema-generated routes. Remove any
    // previously-planned routes/index.js from the schema generator.
    const existingIndexIdx = planned.findIndex(
      (p) => p.relPath === "routes/index.js",
    );
    if (existingIndexIdx !== -1) {
      planned.splice(existingIndexIdx, 1);
    }

    for (const entry of saasFiles) {
      planned.push(entry);
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
