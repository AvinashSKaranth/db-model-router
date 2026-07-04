"use strict";

const fs = require("fs");
const path = require("path");
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
  "mariadb",
  "sqlite3",
  "mssql",
  "oracle",
  "cockroachdb",
  "mongodb",
  "dynamodb",
  "redis",
];

/**
 * Build all schema-driven artifacts (models, routes, tests, OpenAPI spec,
 * migrations, docs route, and optional SaaS structure) from an already-parsed
 * schema, writing them under `baseDir`.
 *
 * This is the internal buildout engine invoked by the `init` command. It is
 * NOT registered as a CLI subcommand. All artifact types are always generated;
 * the SaaS structure is gated by `schema.options.saasStructure` (default true).
 *
 * @param {object} opts
 * @param {object} opts.schema - Parsed schema from parseSchema()
 * @param {string} opts.baseDir - Absolute directory to write artifacts into
 * @param {import('../flags').OutputContext} opts.ctx - Output context for --json support
 * @param {object} opts.flags - Universal flags: { json, dryRun, ... }
 * @returns {Promise<{ files: Array<{ path: string, status: string }> }>}
 */
async function buildSchemaArtifacts({ schema, baseDir, ctx, flags }) {
  const meta = schemaToModelMeta(schema);
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

  // Always generate every artifact type. SaaS gated by schema.options.saasStructure.
  const genModels = true;
  const genRoutes = true;
  const genOpenapi = true;
  const genTests = true;
  const genMigrations = true;
  const genSaas = !(schema.options && schema.options.saasStructure === false);

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
          const immediateParent = chain[chain.length - 1];
          const parentFk = schema.tables[immediateParent].pk;
          planned.push({
            relPath,
            content: generateParentRouteFile(tableName, children, parentFk),
          });
        } else {
          planned.push({
            relPath,
            content: generateParentRouteFile(tableName, children),
          });
        }
      } else if (hasParent) {
        const immediateParent = chain[chain.length - 1];
        const parentFk = schema.tables[immediateParent].pk;
        planned.push({
          relPath,
          content: generateChildRouteFile(tableName, immediateParent, parentFk),
        });
      } else {
        planned.push({
          relPath,
          content: generateRouteFile(tableName),
        });
      }
    }

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

    if (genSaas) {
      const saasApi = generateSaasOpenAPIPaths();
      const productPaths = spec.paths;
      spec.paths = { ...saasApi.paths, ...productPaths };
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
    const adapter = schema.adapter;

    if (!adapter || !SUPPORTED_ADAPTERS.includes(adapter)) {
      const msg = adapter
        ? `Invalid adapter: ${adapter}. Supported: ${SUPPORTED_ADAPTERS.join(", ")}`
        : `Adapter is required for saas-structure generation. Set adapter in schema.`;
      if (flags.json) {
        ctx.result({ error: true, code: "INVALID_ADAPTER", message: msg });
      } else {
        ctx.log(`Error: ${msg}`);
      }
      process.exitCode = 1;
      return { files: [] };
    }

    const saasFiles = generateSaasStructure(adapter, {
      dryRun: flags.dryRun,
      json: flags.json,
      timestamp: new Date(),
      tableNames,
      relationships: routeRelationships,
      routeOptions: { includeDocs: genOpenapi },
      baseDir,
    });

    // The SaaS generator produces a combined routes/index.js that includes
    // both SaaS routes and dbmr schema-generated routes. Remove any previously
    // planned routes/index.js from the schema generator.
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
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      results.push({ path: relPath, status: "overwritten" });
      ctx.log(`  overwritten ${relPath}`);
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      results.push({ path: relPath, status: "created" });
      ctx.log(`  created ${relPath}`);
    }
  }

  if (flags.dryRun) {
    if (flags.json) {
      ctx.result({ files: results });
    } else {
      ctx.log("Dry run — the following schema artifacts would be generated:");
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
      `\nSchema artifacts: ${created} created, ${overwritten} overwritten, ${unchanged} unchanged.`,
    );
  }

  return { files: results };
}

module.exports = { buildSchemaArtifacts, SUPPORTED_ADAPTERS };