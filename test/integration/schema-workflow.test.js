"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { OutputContext } = require("../../src/cli/flags");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "integ-schema-workflow-"));
}

function rmTmpDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build a minimal valid schema object for sqlite3.
 */
function testSchema() {
  return {
    adapter: "sqlite3",
    framework: "express",
    tables: {
      users: {
        columns: {
          name: "required|string",
          email: "required|string",
          age: "integer",
        },
        pk: "id",
        unique: ["email"],
      },
      posts: {
        columns: {
          title: "required|string",
          body: "string",
          user_id: "required|integer",
        },
        pk: "id",
        unique: ["id"],
      },
    },
    relationships: [{ parent: "users", child: "posts", foreignKey: "user_id" }],
    options: {},
  };
}

// =========================================================================
// Task 20.1 — Full workflow integration test
//   init --from schema.json → generate --from schema.json → doctor → all pass
//   Requirements: 3.1, 5.1, 6.4
// =========================================================================

describe("Integration: full workflow (init → generate → doctor)", function () {
  let tmpDir, origCwd, origLog;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    // Write package.json so ensurePackageJson doesn't shell out
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify(
        {
          name: "test-project",
          version: "1.0.0",
          dependencies: { "better-sqlite3": "^9.0.0" },
        },
        null,
        2,
      ),
    );

    // Write the schema file
    fs.writeFileSync(
      path.join(tmpDir, "dbmr.schema.json"),
      JSON.stringify(testSchema(), null, 2),
    );

    // Suppress console.log
    origLog = console.log;
    console.log = function () {};
  });

  afterEach(function () {
    console.log = origLog;
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    process.exitCode = 0;
  });

  it("init → generate → doctor should all succeed", async function () {
    this.timeout(15000);

    const schemaPath = path.join(tmpDir, "dbmr.schema.json");

    // ---- Step 1: init --from schema.json --no-install --yes ----
    delete require.cache[require.resolve("../../src/cli/commands/init")];
    const initCmd = require("../../src/cli/commands/init");
    const initCtx = new OutputContext({ json: true });

    await initCmd(
      { from: schemaPath },
      { yes: true, json: true, dryRun: false, noInstall: true, help: false },
      initCtx,
    );

    assert.ok(initCtx._results.length > 0, "init should produce a result");
    const initResult = initCtx._results[0];
    assert.ok(
      Array.isArray(initResult.files),
      "init result should have files array",
    );
    assert.ok(initResult.files.length > 0, "init should generate files");

    // Verify key scaffolded files exist
    assert.ok(
      fs.existsSync(path.join(tmpDir, "app.js")),
      "app.js should exist after init",
    );

    // ---- Step 2: generate --from schema.json ----
    delete require.cache[require.resolve("../../src/cli/commands/generate")];
    const generateCmd = require("../../src/cli/commands/generate");
    const genCtx = new OutputContext({ json: true });

    await generateCmd(
      { from: schemaPath },
      { yes: false, json: true, dryRun: false, noInstall: false, help: false },
      genCtx,
    );

    assert.ok(genCtx._results.length > 0, "generate should produce a result");
    const genResult = genCtx._results[0];
    assert.ok(
      Array.isArray(genResult.files),
      "generate result should have files array",
    );

    // Verify generated artifacts exist
    assert.ok(
      fs.existsSync(path.join(tmpDir, "models/users.js")),
      "users model should exist",
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, "models/posts.js")),
      "posts model should exist",
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, "routes/index.js")),
      "routes index should exist",
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, "openapi.json")),
      "openapi.json should exist",
    );

    // ---- Step 3: doctor ----
    delete require.cache[require.resolve("../../src/cli/commands/doctor")];
    const doctorCmd = require("../../src/cli/commands/doctor");
    const docCtx = new OutputContext({ json: true });

    await doctorCmd(
      { from: schemaPath },
      { yes: false, json: true, dryRun: false, noInstall: false, help: false },
      docCtx,
    );

    assert.ok(docCtx._results.length > 0, "doctor should produce a result");
    const docResult = docCtx._results[0];

    assert.strictEqual(
      docResult.validation.valid,
      true,
      "Schema validation should pass",
    );
    assert.strictEqual(
      docResult.dependencies.ok,
      true,
      "Dependencies should be OK (better-sqlite3 in package.json)",
    );
    assert.strictEqual(
      docResult.sync.ok,
      true,
      "Generated files should be in sync",
    );
    assert.strictEqual(process.exitCode, 0, "doctor exit code should be 0");
  });
});

// =========================================================================
// Task 20.2 — Inspect round-trip integration test
//   Create SQLite3 in-memory DB → inspect → generate --from → compare
//   generated models with direct introspection output
//   Requirements: 4.1, 5.9
// =========================================================================

describe("Integration: inspect round-trip (SQLite3 → inspect → generate)", function () {
  let tmpDir, origCwd, origLog;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    // Suppress console.log
    origLog = console.log;
    console.log = function () {};
  });

  afterEach(function () {
    console.log = origLog;
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    process.exitCode = 0;
  });

  it("should produce equivalent models from inspect round-trip", async function () {
    this.timeout(15000);

    // ---- Step 1: Create an in-memory SQLite3 DB with test tables ----
    const Database = require("better-sqlite3");
    const memDb = new Database(":memory:");

    memDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER,
        UNIQUE(email)
      );
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT,
        user_id INTEGER NOT NULL
      );
    `);

    // ---- Step 2: Introspect directly using introspectSQLite3 ----
    const { introspectSQLite3 } = require("../../src/cli/generate-model");

    // Create a thin wrapper that mimics the db interface expected by introspectSQLite3
    const dbWrapper = {
      query(sql) {
        const stmt = memDb.prepare(sql);
        if (sql.trimStart().match(/^(SELECT|PRAGMA|WITH\s)/i)) {
          return stmt.all();
        }
        return stmt.run();
      },
    };

    const directModels = await introspectSQLite3(dbWrapper);

    // ---- Step 3: Convert introspection to schema via modelMetaToSchema ----
    const { modelMetaToSchema } = require("../../src/cli/commands/inspect");
    const { printSchema } = require("../../src/schema/schema-printer");

    const schema = modelMetaToSchema("sqlite3", "express", directModels);
    const schemaJson = printSchema(schema);

    // Write schema to file
    const schemaPath = path.join(tmpDir, "dbmr.schema.json");
    fs.writeFileSync(schemaPath, schemaJson, "utf8");

    // ---- Step 4: Generate models from the schema ----
    delete require.cache[require.resolve("../../src/cli/commands/generate")];
    const generateCmd = require("../../src/cli/commands/generate");
    const genCtx = new OutputContext({ json: true });

    await generateCmd(
      { from: schemaPath, models: true },
      { yes: false, json: true, dryRun: false, noInstall: false, help: false },
      genCtx,
    );

    assert.ok(genCtx._results.length > 0, "generate should produce a result");
    const genResult = genCtx._results[0];
    assert.ok(Array.isArray(genResult.files), "should have files array");

    // ---- Step 5: Compare generated model files with direct generation ----
    const { generateModelFile } = require("../../src/cli/generate-model");
    const { parseSchema } = require("../../src/schema/schema-parser");
    const { schemaToModelMeta } = require("../../src/schema/schema-to-meta");

    const parsedSchema = parseSchema(schemaJson);
    const schemaMeta = schemaToModelMeta(parsedSchema);

    // Sort both by table name for comparison
    const sortedDirect = [...directModels].sort((a, b) =>
      a.table.localeCompare(b.table),
    );
    const sortedSchema = [...schemaMeta].sort((a, b) =>
      a.table.localeCompare(b.table),
    );

    assert.strictEqual(
      sortedDirect.length,
      sortedSchema.length,
      "Should have same number of tables",
    );

    for (let i = 0; i < sortedDirect.length; i++) {
      const directMeta = sortedDirect[i];
      const schemaMeta_ = sortedSchema[i];

      assert.strictEqual(
        directMeta.table,
        schemaMeta_.table,
        "Table names should match",
      );
      assert.strictEqual(
        directMeta.primary_key,
        schemaMeta_.primary_key,
        `PK should match for ${directMeta.table}`,
      );

      // Compare generated model file content
      const directModelContent = generateModelFile(directMeta);
      const schemaModelContent = generateModelFile(schemaMeta_);
      assert.strictEqual(
        directModelContent,
        schemaModelContent,
        `Model file content should match for ${directMeta.table}`,
      );
    }

    // Also verify the actual files on disk match
    for (const m of sortedDirect) {
      const diskContent = fs.readFileSync(
        path.join(tmpDir, "models", m.table + ".js"),
        "utf8",
      );
      const expectedContent = generateModelFile(m);
      assert.strictEqual(
        diskContent,
        expectedContent,
        `Disk model file should match for ${m.table}`,
      );
    }

    memDb.close();
  });
});

// =========================================================================
// Task 20.3 — Existing generator equivalence integration test
//   Run old generate-model + generate-route on a test DB, run new
//   generate --from on the inspected schema, compare outputs
//   Requirements: 5.9, 5.10
// =========================================================================

describe("Integration: existing generator equivalence", function () {
  let tmpDir, origCwd, origLog;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    // Suppress console.log
    origLog = console.log;
    console.log = function () {};
  });

  afterEach(function () {
    console.log = origLog;
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    process.exitCode = 0;
  });

  it("new generate --from should produce equivalent output to old generators", async function () {
    this.timeout(15000);

    // ---- Step 1: Create an in-memory SQLite3 DB with test tables ----
    const Database = require("better-sqlite3");
    const memDb = new Database(":memory:");

    memDb.exec(`
      CREATE TABLE authors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        bio TEXT
      );
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        author_id INTEGER NOT NULL
      );
    `);

    // ---- Step 2: Introspect using old generate-model functions ----
    const {
      introspectSQLite3,
      generateModelFile,
    } = require("../../src/cli/generate-model");
    const {
      generateRouteFile,
      generateRoutesIndexFile,
    } = require("../../src/cli/generate-route");

    const dbWrapper = {
      query(sql) {
        const stmt = memDb.prepare(sql);
        if (sql.trimStart().match(/^(SELECT|PRAGMA|WITH\s)/i)) {
          return stmt.all();
        }
        return stmt.run();
      },
    };

    const models = await introspectSQLite3(dbWrapper);
    const tableNames = models.map((m) => m.table).sort();

    // Generate old-style model files
    const oldModels = {};
    for (const m of models) {
      oldModels[m.table] = generateModelFile(m);
    }

    // Generate old-style route files
    const modelsRelPath = "../models";
    const oldRoutes = {};
    for (const table of tableNames) {
      oldRoutes[table] = generateRouteFile(table, modelsRelPath);
    }
    const oldRoutesIndex = generateRoutesIndexFile(tableNames, []);

    // ---- Step 3: Convert introspection to schema, write it ----
    const { modelMetaToSchema } = require("../../src/cli/commands/inspect");
    const { printSchema } = require("../../src/schema/schema-printer");

    const schema = modelMetaToSchema("sqlite3", "express", models);
    const schemaJson = printSchema(schema);

    const schemaPath = path.join(tmpDir, "dbmr.schema.json");
    fs.writeFileSync(schemaPath, schemaJson, "utf8");

    // ---- Step 4: Run new generate --from on the schema ----
    delete require.cache[require.resolve("../../src/cli/commands/generate")];
    const generateCmd = require("../../src/cli/commands/generate");
    const genCtx = new OutputContext({ json: true });

    await generateCmd(
      { from: schemaPath },
      { yes: false, json: true, dryRun: false, noInstall: false, help: false },
      genCtx,
    );

    assert.ok(genCtx._results.length > 0, "generate should produce a result");

    // ---- Step 5: Compare model files ----
    for (const table of tableNames) {
      const newModelContent = fs.readFileSync(
        path.join(tmpDir, "models", table + ".js"),
        "utf8",
      );
      assert.strictEqual(
        newModelContent,
        oldModels[table],
        `Model file for ${table} should be equivalent`,
      );
    }

    // ---- Step 6: Compare route files ----
    for (const table of tableNames) {
      const newRouteContent = fs.readFileSync(
        path.join(tmpDir, "routes", table + ".js"),
        "utf8",
      );
      assert.strictEqual(
        newRouteContent,
        oldRoutes[table],
        `Route file for ${table} should be equivalent`,
      );
    }

    // ---- Step 7: Compare routes index ----
    const newRoutesIndex = fs.readFileSync(
      path.join(tmpDir, "routes", "index.js"),
      "utf8",
    );
    assert.strictEqual(
      newRoutesIndex,
      oldRoutesIndex,
      "Routes index.js should be equivalent",
    );

    memDb.close();
  });
});
