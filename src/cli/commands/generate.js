"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const { schemaToModelMeta } = require("../../schema/schema-to-meta");
const { generateModelFile } = require("../generate-model");
const {
  generateRouteFile,
  generateParentRouteFile,
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

  // For route generation, only use parent-derived relationships.
  // Explicit relationships may define multiple foreign keys per table,
  // but nested routes should follow the canonical parent declared on each table.
  const routeRelationships = [];
  for (const [tableName, tableDef] of Object.entries(schema.tables)) {
    if (tableDef.parent) {
      const parentTable = schema.tables[tableDef.parent];
      if (parentTable) {
        routeRelationships.push({
          parent: tableDef.parent,
          child: tableName,
          foreignKey: parentTable.pk,
        });
      }
    }
  }

  // Build ancestry chains for correct multi-level nested file placement.
  const ancestors = {};
  for (const m of meta) {
    const chain = [];
    let current = m.table;
    while (schema.tables[current]?.parent) {
      chain.unshift(schema.tables[current].parent);
      current = schema.tables[current].parent;
    }
    ancestors[m.table] = chain;
  }

  // Determine which artifact types to generate.
  // If any specific artifact flag is explicitly set to true, only generate those.
  // Otherwise, all artifact types are generated (unless explicitly set to false).
  const hasExplicitTrue =
    args.models === true ||
    args.routes === true ||
    args.openapi === true ||
    args.tests === true ||
    args.migrations === true;

  let genModels, genRoutes, genOpenapi, genTests, genMigrations, genSaas;

  if (hasExplicitTrue) {
    // Selective mode: only generate what was explicitly requested
    genModels = args.models === true;
    genRoutes = args.routes === true;
    genOpenapi = args.openapi === true;
    genTests = args.tests === true;
    genMigrations = args.migrations === true;
    genSaas = args["saas-structure"] === true;
  } else {
    // Default mode: generate all unless explicitly disabled
    genModels = args.models !== false;
    genRoutes = args.routes !== false;
    genOpenapi = args.openapi !== false;
    genTests = args.tests !== false;
    genMigrations = args.migrations !== false;
    genSaas = args["saas-structure"] !== false;
  }

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
    const childrenByParent = {};
    for (const rel of routeRelationships) {
      if (!childrenByParent[rel.parent]) childrenByParent[rel.parent] = [];
      childrenByParent[rel.parent].push(rel);
    }

    // Generate exactly ONE route file per table at its correct nested path.
    // Intermediate tables (both child and parent) get a hybrid route file
    // that scopes their own CRUD by an ancestor FK and mounts their children.
    for (const m of meta) {
      const tableName = m.table;
      const chain = ancestors[tableName];
      const hasChildren = (childrenByParent[tableName] || []).length > 0;
      const hasParent = chain.length > 0;

      const pathParts = [...chain, tableName];
      const relPath = `routes/${pathParts.join("/")}/index.js`;

      if (hasChildren) {
        const children = childrenByParent[tableName];
        if (hasParent) {
          // Intermediate node: own CRUD scoped by parent PK + mounts children
          const immediateParent = chain[chain.length - 1];
          const parentFk = schema.tables[immediateParent].pk;
          planned.push({
            relPath,
            content: generateParentRouteFile(tableName, children, parentFk),
          });
        } else {
          // Root parent: own CRUD unscoped + mounts children
          planned.push({
            relPath,
            content: generateParentRouteFile(tableName, children),
          });
        }
      } else if (hasParent) {
        // Leaf child
        const immediateParent = chain[chain.length - 1];
        const parentFk = schema.tables[immediateParent].pk;
        planned.push({
          relPath,
          content: generateChildRouteFile(tableName, immediateParent, parentFk),
        });
      } else {
        // Root leaf
        planned.push({
          relPath,
          content: generateRouteFile(tableName),
        });
      }
    }

    // Routes index file (include docs route when openapi is being generated)
    planned.push({
      relPath: "routes/index.js",
      content: generateRoutesIndexFile(tableNames, routeRelationships, {
        includeDocs: genOpenapi,
      }),
    });
  }

  // --- OpenAPI spec + docs route ---
  if (genOpenapi) {
    const spec = generateOpenAPISpec(meta, { relationships: routeRelationships });

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
    for (const m of meta) {
      const tableName = m.table;
      const chain = ancestors[tableName];
      const hasParent = chain.length > 0;

      if (hasParent) {
        const immediateParent = chain[chain.length - 1];
        const parentFk = schema.tables[immediateParent].pk;
        const pathParts = [...chain, tableName];
        const depth = pathParts.length;
        const modelsRelPath = "../".repeat(depth) + "models/";
        planned.push({
          relPath: `test/${pathParts.join("/")}.test.js`,
          content: generateChildTestFile(
            tableName,
            immediateParent,
            parentFk,
            m.primary_key,
            modelsRelPath,
          ),
        });
      } else {
        planned.push({
          relPath: `test/${tableName}.test.js`,
          content: generateTestFile(tableName, m.primary_key, m.structure),
        });
      }
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
      relationships: routeRelationships,
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
      // Skip seed/credential files if they already exist on disk —
      // they contain generated passwords that should not be overwritten.
      if (
        (entry.relPath === "seeds/saas-seed.js" ||
          entry.relPath === "credentials.md") &&
        fs.existsSync(path.join(baseDir, entry.relPath))
      ) {
        continue;
      }
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
