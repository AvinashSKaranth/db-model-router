#!/usr/bin/env node

const path = require("path");
const fs = require("fs");

const DB_TYPE_MAP = {
  mysql: "mysql",
  postgres: "postgres",
  postgresql: "postgres",
  sqlite3: "sqlite3",
  mssql: "mssql",
  oracle: "oracle",
  cockroachdb: "cockroachdb",
};

const SUPPORTED_TYPES = Object.keys(DB_TYPE_MAP);

function safeVarName(name) {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return name;
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}

/**
 * Generate a route file for a single model.
 */
function generateRouteFile(tableName, modelsRelPath) {
  const varName = safeVarName(tableName);
  return `import dbModelRouter from "db-model-router";
import express from "express";
import { ${varName} } from "#models";

const router = express.Router({ mergeParams: true });
const { route } = dbModelRouter;

router.use("/", route(${varName}));

export default router;
`;
}

/**
 * Generate a parent route file that includes its own CRUD and mounts child routes.
 * e.g., routes/orders/index.js mounts order_items under /:order_id/items
 *
 * When the parent is itself a child (intermediate node), its own CRUD is scoped
 * by the parentForeignKey so it filters on params from the ancestor router.
 *
 * @param {string} tableName - Parent table name
 * @param {Array<{child, foreignKey}>} children - Child relationships for this parent
 * @param {string} [parentForeignKey] - If set, own CRUD is scoped by this FK from an ancestor
 * @returns {string}
 */
function generateParentRouteFile(tableName, children, parentForeignKey) {
  const varName = safeVarName(tableName);
  let code = `import dbModelRouter from "db-model-router";
import express from "express";
import { ${varName} } from "#models";
`;

  // Import child routes
  for (const child of children) {
    const childVar = safeVarName(child.child);
    code += `import ${childVar}Route from "./${child.child}/index.js";\n`;
  }

  code += `
const router = express.Router({ mergeParams: true });
const { route } = dbModelRouter;

`;

  // Mount child routes BEFORE own CRUD to prevent path clashing
  for (const child of children) {
    const childVar = safeVarName(child.child);
    code += `router.use("/:${child.foreignKey}/${child.child}", ${childVar}Route);\n`;
  }

  const scope = parentForeignKey
    ? `, { ${parentForeignKey}: "params.${parentForeignKey}" }`
    : "";
  code += `
// CRUD routes for ${tableName}
router.use("/", route(${varName}${scope}));

export default router;
`;
  return code;
}

/**
 * Generate a child route file that scopes queries by parent FK.
 * e.g., routes/orders/items/index.js — filters items where order_id = :order_id
 */
function generateChildRouteFile(
  childTable,
  parentTable,
  fkColumn,
  modelsRelPath,
) {
  const varName = safeVarName(childTable);
  return `import dbModelRouter from "db-model-router";
import express from "express";
import { ${varName} } from "#models";

const router = express.Router({ mergeParams: true });
const { route } = dbModelRouter;

// Child route: scoped by parent ${parentTable} via ${fkColumn}
router.use("/", route(${varName}, { ${fkColumn}: "params.${fkColumn}" }));

export default router;
`;
}

/**
 * Generate the routes index file that mounts all routes on an express Router.
 * Supports parent-child nesting: parent/:pk/child
 *
 * Child routes are placed in subfolders: routes/<parent>/<child>.js
 * Children are only mounted under their parent path (no duplicate top-level route).
 *
 * @param {string[]} tableNames
 * @param {Array<{parent, child, foreignKey}>} relationships
 * @param {{ includeDocs?: boolean }} [options]
 */
function generateRoutesIndexFile(tableNames, relationships = [], options = {}) {
  let imports = `import express from "express";\n\nconst router = express.Router({ mergeParams: true });\n\n`;

  // Collect child tables that are nested under parents
  const nestedChildren = new Set();
  for (const rel of relationships) {
    nestedChildren.add(rel.child);
  }

  // Import top-level routes only (children are mounted inside parent folders)
  for (const table of tableNames) {
    if (nestedChildren.has(table)) continue;
    const varName = safeVarName(table);
    imports += `import ${varName}Route from "./${table}/index.js";\n`;
  }

  // Import docs route if openapi is generated
  if (options.includeDocs) {
    imports += `import docsRoute from "./docs.js";\n`;
  }

  imports += "\n";

  // Mount docs route first
  if (options.includeDocs) {
    imports += `router.use("/docs", docsRoute);\n`;
  }

  // Mount top-level routes (children are already mounted inside their parent's index.js)
  for (const table of tableNames) {
    if (nestedChildren.has(table)) continue;
    const varName = safeVarName(table);
    imports += `router.use("/${table}", ${varName}Route);\n`;
  }

  imports += "\nexport default router;\n";
  return imports;
}

/**
 * Generate the routes index file (simple version, no relationships).
 */
function generateSimpleRoutesIndexFile(tableNames) {
  return generateRoutesIndexFile(tableNames, []);
}

/**
 * Generate a test file for a route covering all CRUD methods.
 * Uses supertest + the app's express setup.
 */
function generateTestFile(tableName, pk, structure) {
  const varName = safeVarName(tableName);
  const fakerFields = generateFakerFields(structure || {});
  const fakerImport = `import { faker } from "@faker-js/faker";`;

  return `import assert from "assert";
import express from "express";
import request from "supertest";
import "dotenv/config";
import "../commons/db.js";
import dbModelRouter from "db-model-router";
import { ${varName} } from "../models/index.js";
${fakerImport}

const { route } = dbModelRouter;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/${tableName}", route(${varName}));
  return app;
}

${fakerFields.helperFn}

describe("${tableName} routes", function () {
  let app;
  let createdId;

  before(function () {
    app = createApp();
  });

  describe("CRUD lifecycle", function () {
    it("POST /${tableName}/add — should insert a record", async function () {
      const data = generateFakeData();
      const res = await request(app)
        .post("/${tableName}/add")
        .send(data);
      assert.strictEqual(res.status, 200, \`Expected 200, got \${res.status}: \${JSON.stringify(res.body)}\`);
      createdId = res.body.${pk} || res.body.id;
      assert.ok(createdId, "Response should contain the created record ID");
    });

    it("GET /${tableName}/ — should list records including created one", async function () {
      const res = await request(app).get("/${tableName}/");
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length > 0, "Should have at least one record");
    });

    it("GET /${tableName}/:${pk} — should get the created record", async function () {
      const res = await request(app).get(\`/${tableName}/\${createdId}\`);
      assert.strictEqual(res.status, 200, \`Expected 200, got \${res.status}\`);
      assert.strictEqual(String(res.body.${pk} || res.body.id), String(createdId));
    });

    it("PUT /${tableName}/:${pk} — should update the record", async function () {
      const data = { ...generateFakeData(), ${pk}: createdId };
      const res = await request(app)
        .put(\`/${tableName}/\${createdId}\`)
        .send(data);
      assert.strictEqual(res.status, 200, \`Expected 200, got \${res.status}: \${JSON.stringify(res.body)}\`);
    });

    it("PATCH /${tableName}/:${pk} — should partially update the record", async function () {
      const res = await request(app)
        .patch(\`/${tableName}/\${createdId}\`)
        .send(${fakerFields.patchPayload});
      assert.strictEqual(res.status, 200, \`Expected 200, got \${res.status}: \${JSON.stringify(res.body)}\`);
    });

    it("DELETE /${tableName}/:${pk} — should delete the record", async function () {
      const res = await request(app).delete(\`/${tableName}/\${createdId}\`);
      assert.ok([200, 204].includes(res.status), \`Expected 200/204, got \${res.status}\`);
    });

    it("GET /${tableName}/:${pk} — should return 404 after deletion", async function () {
      const res = await request(app).get(\`/${tableName}/\${createdId}\`);
      assert.strictEqual(res.status, 404);
    });
  });

  describe("Bulk operations", function () {
    it("POST /${tableName}/ — should bulk insert records", async function () {
      const data = [generateFakeData(), generateFakeData()];
      const res = await request(app)
        .post("/${tableName}/")
        .send({ data });
      assert.strictEqual(res.status, 200, \`Expected 200, got \${res.status}: \${JSON.stringify(res.body)}\`);
    });
  });

  describe("Error handling", function () {
    it("GET /${tableName}/:${pk} — should return 404 for non-existent ID", async function () {
      const res = await request(app).get("/${tableName}/999999");
      assert.strictEqual(res.status, 404);
    });
  });
});
`;
}

/**
 * Generate a faker helper function string and patch payload based on model structure.
 *
 * @param {object} structure - Model structure { colName: "rule" }
 * @returns {{ helperFn: string, patchPayload: string }}
 */
function generateFakerFields(structure) {
  const lines = [];
  let firstStringCol = null;

  for (const [col, rule] of Object.entries(structure)) {
    if (col.includes(".")) continue;
    const fakerCall = columnToFaker(col, rule);
    lines.push(`    ${col}: ${fakerCall},`);
    if (!firstStringCol && rule.includes("string")) {
      firstStringCol = col;
    }
  }

  const helperFn = `function generateFakeData() {
  return {
${lines.join("\n")}
  };
}`;

  const patchPayload = firstStringCol
    ? `{ ${firstStringCol}: faker.lorem.word() }`
    : `{ ${
        Object.keys(structure).find((c) => !c.includes(".")) || "name"
      }: faker.lorem.word() }`;

  return { helperFn, patchPayload };
}

/**
 * Map a column name + rule to an appropriate faker call.
 */
function columnToFaker(col, rule) {
  const lowerCol = col.toLowerCase();

  // Name-based heuristics first
  if (lowerCol === "email") return "faker.internet.email()";
  if (lowerCol === "phone") return "faker.phone.number()";
  if (lowerCol === "name" || lowerCol.endsWith("_name"))
    return "faker.person.fullName()";
  if (lowerCol === "url" || lowerCol.endsWith("_url"))
    return "faker.internet.url()";
  if (lowerCol === "slug") return "faker.helpers.slugify(faker.lorem.words(2))";
  if (lowerCol === "password" || lowerCol === "password_hash")
    return "faker.internet.password()";
  if (lowerCol === "secret" || lowerCol === "key" || lowerCol === "token")
    return "faker.string.alphanumeric(32)";
  if (lowerCol === "title") return "faker.lorem.sentence()";
  if (
    lowerCol === "description" ||
    lowerCol === "body" ||
    lowerCol === "content"
  )
    return "faker.lorem.paragraph()";
  if (lowerCol === "status")
    return "faker.helpers.arrayElement(['active', 'inactive', 'pending'])";
  if (lowerCol === "event_type")
    return "faker.helpers.arrayElement(['user.created', 'order.placed', 'payment.received'])";
  if (lowerCol === "currency") return "faker.finance.currencyCode()";
  if (
    lowerCol.includes("amount") ||
    lowerCol.includes("price") ||
    lowerCol.includes("total") ||
    lowerCol.includes("subtotal")
  )
    return "parseFloat(faker.finance.amount())";
  if (lowerCol.includes("quantity") || lowerCol.includes("count"))
    return "faker.number.int({ min: 1, max: 100 })";
  if (lowerCol === "unique_attribute") return "faker.string.uuid()";
  if (lowerCol === "attributes") return "{ custom: faker.lorem.word() }";
  if (lowerCol === "permission")
    return "{ module: 'users', action: 'read', scope: 'tenant' }";
  if (lowerCol === "response_body") return "faker.lorem.sentence()";
  if (lowerCol === "response_status_code")
    return "faker.helpers.arrayElement([200, 201, 400, 500])";

  // Type-based fallback
  const parts = rule.split("|");
  const baseType = parts.filter((p) => p !== "required")[0] || "string";

  switch (baseType) {
    case "integer":
      if (lowerCol.endsWith("_id"))
        return "faker.number.int({ min: 1, max: 100 })";
      return "faker.number.int({ min: 1, max: 1000 })";
    case "numeric":
      return "parseFloat(faker.finance.amount())";
    case "boolean":
      return "faker.datatype.boolean()";
    case "object":
      return "{ key: faker.lorem.word() }";
    case "datetime":
      return "faker.date.recent().toISOString()";
    default:
      return "faker.lorem.word()";
  }
}

/**
 * Generate a child route test file that tests the nested parent/:fk/child endpoints.
 */
function generateChildTestFile(childTable, parentTable, fkColumn, pk, modelsRelPath = "../models/") {
  const childVar = safeVarName(childTable);
  return `import assert from "assert";
import express from "express";
import request from "supertest";
import dbModelRouter from "db-model-router";

const { route } = dbModelRouter;

import ${childVar} from "${modelsRelPath}${childTable}.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/${parentTable}/:${fkColumn}/${childTable}", route(${childVar}, { ${fkColumn}: "params.${fkColumn}" }));
  return app;
}

describe("${childTable} (child of ${parentTable}) routes", function () {
  let app;
  const parentId = 1;

  before(function () {
    app = createApp();
  });

  describe("GET /${parentTable}/:${fkColumn}/${childTable}/", function () {
    it("should list child records scoped by parent", async function () {
      const res = await request(app).get(\`/${parentTable}/\${parentId}/${childTable}/\`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  describe("POST /${parentTable}/:${fkColumn}/${childTable}/add", function () {
    it("should insert a child record", async function () {
      const res = await request(app)
        .post(\`/${parentTable}/\${parentId}/${childTable}/add\`)
        .send({});
      assert.ok([200, 201, 400].includes(res.status));
    });
  });

  describe("GET /${parentTable}/:${fkColumn}/${childTable}/:${pk}", function () {
    it("should get a child record by ID", async function () {
      const res = await request(app).get(\`/${parentTable}/\${parentId}/${childTable}/1\`);
      assert.ok([200, 404].includes(res.status));
    });
  });

  describe("PUT /${parentTable}/:${fkColumn}/${childTable}/:${pk}", function () {
    it("should update a child record", async function () {
      const res = await request(app)
        .put(\`/${parentTable}/\${parentId}/${childTable}/1\`)
        .send({});
      assert.ok([200, 400, 404].includes(res.status));
    });
  });

  describe("PATCH /${parentTable}/:${fkColumn}/${childTable}/:${pk}", function () {
    it("should partially update a child record", async function () {
      const res = await request(app)
        .patch(\`/${parentTable}/\${parentId}/${childTable}/1\`)
        .send({});
      assert.ok([200, 400, 404].includes(res.status));
    });
  });

  describe("DELETE /${parentTable}/:${fkColumn}/${childTable}/:${pk}", function () {
    it("should delete a child record", async function () {
      const res = await request(app).delete(\`/${parentTable}/\${parentId}/${childTable}/1\`);
      assert.ok([200, 204, 404].includes(res.status));
    });
  });
});
`;
}

/**
 * Read model directory to discover table names from generated model files.
 * Looks for .js files that are not index.js.
 */
function discoverModels(modelsDir) {
  if (!fs.existsSync(modelsDir)) return [];
  const files = fs
    .readdirSync(modelsDir)
    .filter((f) => f.endsWith(".js") && f !== "index.js");
  return files.map((f) => f.replace(/\.js$/, ""));
}

// --- Main CLI ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const modelsDir = path.resolve(args.models || "./models");
  const routesDir = path.resolve(args.output || "./routes");

  // Check if models exist; if not, generate them first
  let tableNames = discoverModels(modelsDir);

  if (tableNames.length === 0) {
    console.log("No models found. Generating models first...\n");

    const dbType = DB_TYPE_MAP[(args.type || "").toLowerCase()];
    if (!dbType) {
      console.error(
        `Error: No models found in "${modelsDir}" and no --type provided to generate them.\n` +
          `Either generate models first with db-model-router-generate-model, or provide --type to auto-generate.`,
      );
      process.exit(1);
    }

    // Build the generate-model command args and run it
    const generateArgs = ["--type", dbType, "--output", modelsDir];
    if (args.host) generateArgs.push("--host", args.host);
    if (args.port) generateArgs.push("--port", args.port);
    if (args.database) generateArgs.push("--database", args.database);
    if (args.user) generateArgs.push("--user", args.user);
    if (args.password) generateArgs.push("--password", args.password);
    if (args.schema) generateArgs.push("--schema", args.schema);
    if (args.env) generateArgs.push("--env", args.env);
    if (args.tables) generateArgs.push("--tables", args.tables);

    const { execFileSync } = require("child_process");
    try {
      const generateScript = path.join(__dirname, "generate-model.js");
      execFileSync(process.execPath, [generateScript, ...generateArgs], {
        stdio: "inherit",
      });
    } catch (err) {
      console.error("Model generation failed.");
      process.exit(1);
    }

    tableNames = discoverModels(modelsDir);
    if (tableNames.length === 0) {
      console.error("No models were generated. Cannot create routes.");
      process.exit(1);
    }
    console.log(""); // blank line after model generation output
  }

  // Calculate relative path from routes dir to models dir
  const modelsRelPath = path.relative(routesDir, modelsDir).replace(/\\/g, "/");

  // Parse --tables for parent.child relationships
  const relationships = [];
  if (args.tables) {
    const tableSpecs = args.tables.split(",").map((s) => s.trim());
    for (const spec of tableSpecs) {
      if (spec.includes(".")) {
        const parts = spec.split(".");
        const parent = parts[0];
        const child = parts[1];
        // Guess FK column: parent_id or parent's PK name
        // Convention: child table has a column named <parent>_id or <parent_singular>_id
        const fkColumn = parent.replace(/s$/, "") + "_id";
        // Only add if both tables exist in our model set
        if (tableNames.includes(parent) && tableNames.includes(child)) {
          relationships.push({ parent, child, foreignKey: fkColumn });
        }
      }
    }
  }

  // Write route files
  if (!fs.existsSync(routesDir)) {
    fs.mkdirSync(routesDir, { recursive: true });
  }

  // Collect child tables to skip top-level route files
  const nestedChildren = new Set();
  for (const rel of relationships) {
    nestedChildren.add(rel.child);
  }

  for (const table of tableNames) {
    if (nestedChildren.has(table)) continue;
    const filePath = path.join(routesDir, table + ".js");
    fs.writeFileSync(filePath, generateRouteFile(table, modelsRelPath));
    console.log(`  Created ${filePath}`);
  }

  // Write child route files in subfolders: routes/<parent>/<child>.js
  for (const rel of relationships) {
    const parentDir = path.join(routesDir, rel.parent);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const filePath = path.join(parentDir, `${rel.child}.js`);
    const childModelsRelPath = path
      .relative(parentDir, path.resolve(modelsDir))
      .replace(/\\/g, "/");
    fs.writeFileSync(
      filePath,
      generateChildRouteFile(
        rel.child,
        rel.parent,
        rel.foreignKey,
        childModelsRelPath,
      ),
    );
    console.log(`  Created ${filePath}`);
  }

  const indexPath = path.join(routesDir, "index.js");
  fs.writeFileSync(
    indexPath,
    generateRoutesIndexFile(tableNames, relationships),
  );
  console.log(`  Created ${indexPath}`);

  console.log(`\nGenerated ${tableNames.length} route(s) in ${routesDir}`);

  // Generate OpenAPI spec if model metadata is available
  try {
    const { introspectSQLite3 } = require("./generate-model.js");
    // Try to read model files to extract metadata for OpenAPI
    const { generateOpenAPISpec } = require("./generate-openapi.js");
    const modelMeta = [];
    for (const table of tableNames) {
      const modelPath = path.join(modelsDir, table + ".js");
      if (fs.existsSync(modelPath)) {
        const content = fs.readFileSync(modelPath, "utf8");
        // Extract structure, pk, unique from generated model file
        const meta = parseModelFile(content, table);
        if (meta) modelMeta.push(meta);
      }
    }
    if (modelMeta.length > 0) {
      const spec = generateOpenAPISpec(modelMeta, { relationships });
      const specPath = path.join(routesDir, "openapi.json");
      fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
      console.log(`  Created ${specPath}`);
    }
  } catch (e) {
    // OpenAPI generation is optional, don't fail
  }

  // Generate test files for all routes
  const testsDir = path.resolve(path.dirname(routesDir), "tests");
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }

  for (const table of tableNames) {
    // Try to extract PK from model file
    let pk = "id";
    const modelPath = path.join(modelsDir, table + ".js");
    if (fs.existsSync(modelPath)) {
      const meta = parseModelFile(fs.readFileSync(modelPath, "utf8"), table);
      if (meta && meta.primary_key) pk = meta.primary_key;
    }
    const testPath = path.join(testsDir, table + ".test.js");
    fs.writeFileSync(testPath, generateTestFile(table, pk));
    console.log(`  Created ${testPath}`);
  }

  // Generate child route test files in subfolders
  for (const rel of relationships) {
    let pk = "id";
    const modelPath = path.join(modelsDir, rel.child + ".js");
    if (fs.existsSync(modelPath)) {
      const meta = parseModelFile(
        fs.readFileSync(modelPath, "utf8"),
        rel.child,
      );
      if (meta && meta.primary_key) pk = meta.primary_key;
    }
    const parentTestDir = path.join(testsDir, rel.parent);
    if (!fs.existsSync(parentTestDir)) {
      fs.mkdirSync(parentTestDir, { recursive: true });
    }
    const testPath = path.join(parentTestDir, `${rel.child}.test.js`);
    fs.writeFileSync(
      testPath,
      generateChildTestFile(rel.child, rel.parent, rel.foreignKey, pk),
    );
    console.log(`  Created ${testPath}`);
  }

  console.log(
    `Generated ${tableNames.length + relationships.length} test file(s) in ${testsDir}`,
  );

  process.exit(0);
}

/**
 * Parse a generated model file to extract metadata for OpenAPI generation.
 */
function parseModelFile(content, tableName) {
  try {
    // Extract structure JSON
    const structMatch = content.match(
      /model\(\s*\n?\s*db,\s*\n?\s*"[^"]+",\s*\n?\s*(\{[\s\S]*?\}),/,
    );
    if (!structMatch) return null;
    const structure = JSON.parse(structMatch[1]);
    // Extract primary key
    const pkMatch = content.match(/"([^"]+)",\s*\n?\s*\[/);
    const primary_key = pkMatch ? pkMatch[1] : "id";
    return { table: tableName, structure, primary_key };
  } catch (e) {
    return null;
  }
}
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Usage: db-model-router-generate-route [options]

Options:
  --models      Path to models directory (default: ./models)
  --output      Output directory for routes (default: ./routes)
  --type        Database type — used to auto-generate models if missing
                (${SUPPORTED_TYPES.join(", ")})
  --host        Database host (passed to model generation)
  --port        Database port (passed to model generation)
  --database    Database name or file path (passed to model generation)
  --user        Database user (passed to model generation)
  --password    Database password (passed to model generation)
  --schema      Schema name, postgres only (passed to model generation)
  --env         Path to .env file (passed to model generation)
  --help        Show this help message

Examples:
  # Generate routes from existing models
  db-model-router-generate-route --models ./models --output ./routes

  # Auto-generate models + routes in one step
  db-model-router-generate-route --type mysql --env .env --models ./models --output ./routes

  # SQLite3 example
  db-model-router-generate-route --type sqlite3 --database ./myapp.db
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  generateRouteFile,
  generateParentRouteFile,
  generateChildRouteFile,
  generateRoutesIndexFile,
  generateTestFile,
  generateChildTestFile,
  discoverModels,
  safeVarName,
};
