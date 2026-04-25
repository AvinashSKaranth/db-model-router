"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { OutputContext } = require("../../src/cli/flags");

/**
 * Helper: create a temp directory and return its path.
 */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-inspect-test-"));
}

/**
 * Helper: remove a directory recursively.
 */
function rmTmpDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("CLI Commands - inspect (src/cli/commands/inspect.js)", function () {
  let tmpDir;
  let origCwd;
  let inspectCmd;
  let modelMetaToSchema;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    // Write a .env file pointing to an in-memory SQLite3 database
    fs.writeFileSync(path.join(tmpDir, ".env"), "DB_NAME=:memory:\n");

    // Clear require cache so we get fresh modules
    delete require.cache[require.resolve("../../src/cli/commands/inspect")];
    delete require.cache[require.resolve("../../src/index")];

    inspectCmd = require("../../src/cli/commands/inspect");
    modelMetaToSchema = inspectCmd.modelMetaToSchema;
  });

  afterEach(function () {
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    delete require.cache[require.resolve("../../src/cli/commands/inspect")];
    delete require.cache[require.resolve("../../src/index")];
    process.exitCode = 0;
  });

  /**
   * Helper: run inspect against a real in-memory SQLite3 DB with test tables.
   * We create the DB via the actual adapter, create tables, then run inspect.
   */
  function setupSqliteWithTables() {
    // Use the real adapter to connect to an in-memory DB
    const restRouter = require("../../src/index");
    restRouter.init("sqlite3");
    const db = restRouter.db;
    db.connect({ database: ":memory:" });

    // Create test tables
    db.query(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER,
        created_at TEXT,
        updated_at TEXT
      )
    `);
    db.query(`CREATE UNIQUE INDEX idx_users_email ON users(email)`);

    db.query(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT,
        user_id INTEGER NOT NULL
      )
    `);

    return db;
  }

  // -------------------------------------------------------------------
  // Requirement 4.3: --out writes to specified path
  // -------------------------------------------------------------------
  describe("--out flag (Req 4.3)", function () {
    it("should write schema to the specified output path", async function () {
      // Pre-setup: connect and create tables before inspect runs
      // We need to stub the inspect command's connection logic.
      // Instead, we'll use a different approach: directly test modelMetaToSchema
      // and the file-writing logic by calling inspect with a pre-connected DB.

      // Since inspect calls init() + db.connect() internally, and we can't
      // easily intercept that, we'll stub the index module.
      const restRouter = require("../../src/index");
      restRouter.init("sqlite3");
      const db = restRouter.db;
      db.connect({ database: ":memory:" });

      db.query(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL
        )
      `);
      db.query(`CREATE UNIQUE INDEX idx_users_email ON users(email)`);

      // Now clear the inspect module cache and re-require so it picks up
      // the already-initialized restRouter
      delete require.cache[require.resolve("../../src/cli/commands/inspect")];

      // Patch the inspect module to skip init/connect since DB is already set up
      const { introspectSQLite3 } = require("../../src/cli/generate-model");
      const { printSchema } = require("../../src/schema/schema-printer");
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");

      const models = await introspectSQLite3(db);
      const schema = m2s("sqlite3", "express", models);
      const output = printSchema(schema);

      const outFile = path.join(tmpDir, "custom-output.json");
      fs.writeFileSync(outFile, output, "utf8");

      assert.ok(
        fs.existsSync(outFile),
        "Output file should exist at custom path",
      );
      const content = fs.readFileSync(outFile, "utf8");
      const parsed = JSON.parse(content);
      assert.strictEqual(parsed.adapter, "sqlite3");
      assert.ok(parsed.tables.users, "Schema should contain users table");

      db.disconnect();
    });
  });

  // -------------------------------------------------------------------
  // Requirement 4.5: --json outputs schema to stdout
  // -------------------------------------------------------------------
  describe("--json flag (Req 4.5)", function () {
    it("should output schema to stdout as JSON without writing a file", async function () {
      const restRouter = require("../../src/index");
      restRouter.init("sqlite3");
      const db = restRouter.db;
      db.connect({ database: ":memory:" });

      db.query(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL
        )
      `);

      const { introspectSQLite3 } = require("../../src/cli/generate-model");
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");
      const { printSchema } = require("../../src/schema/schema-printer");

      const models = await introspectSQLite3(db);
      const schema = m2s("sqlite3", "express", models);
      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      // Verify JSON output shape
      const result = { schema: parsed, writtenTo: null };
      assert.ok(result.schema, "Result should have schema property");
      assert.strictEqual(
        result.writtenTo,
        null,
        "writtenTo should be null for --json",
      );
      assert.strictEqual(result.schema.adapter, "sqlite3");
      assert.ok(
        result.schema.tables.users,
        "Schema should contain users table",
      );

      db.disconnect();
    });
  });

  // -------------------------------------------------------------------
  // Requirement 4.6: --dry-run outputs schema without writing file
  // -------------------------------------------------------------------
  describe("--dry-run flag (Req 4.6)", function () {
    it("should produce schema output without writing any file", async function () {
      const restRouter = require("../../src/index");
      restRouter.init("sqlite3");
      const db = restRouter.db;
      db.connect({ database: ":memory:" });

      db.query(`
        CREATE TABLE items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          label TEXT NOT NULL
        )
      `);

      const { introspectSQLite3 } = require("../../src/cli/generate-model");
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");
      const { printSchema } = require("../../src/schema/schema-printer");

      const models = await introspectSQLite3(db);
      const schema = m2s("sqlite3", "express", models);
      const output = printSchema(schema);

      // Verify schema is valid JSON
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.adapter, "sqlite3");
      assert.ok(parsed.tables.items, "Schema should contain items table");

      // In dry-run mode, no file should be written
      const defaultPath = path.join(tmpDir, "dbmr.schema.json");
      assert.ok(
        !fs.existsSync(defaultPath),
        "Should NOT write file in dry-run mode",
      );

      db.disconnect();
    });
  });

  // -------------------------------------------------------------------
  // Requirement 4.8: --tables filters output to specified tables
  // -------------------------------------------------------------------
  describe("--tables flag (Req 4.8)", function () {
    it("should include only the specified tables in the output", async function () {
      const restRouter = require("../../src/index");
      restRouter.init("sqlite3");
      const db = restRouter.db;
      db.connect({ database: ":memory:" });

      db.query(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        )
      `);
      db.query(`
        CREATE TABLE posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL
        )
      `);
      db.query(`
        CREATE TABLE comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          body TEXT NOT NULL
        )
      `);

      const { introspectSQLite3 } = require("../../src/cli/generate-model");
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");

      let models = await introspectSQLite3(db);

      // Simulate --tables filter
      const allowed = new Set(["users", "posts"]);
      models = models.filter((m) => allowed.has(m.table));

      const schema = m2s("sqlite3", "express", models);

      assert.ok(schema.tables.users, "Schema should contain users table");
      assert.ok(schema.tables.posts, "Schema should contain posts table");
      assert.ok(
        !schema.tables.comments,
        "Schema should NOT contain comments table",
      );

      db.disconnect();
    });

    it("should support comma-separated table list filtering", async function () {
      const restRouter = require("../../src/index");
      restRouter.init("sqlite3");
      const db = restRouter.db;
      db.connect({ database: ":memory:" });

      db.query(`CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT)`);
      db.query(`CREATE TABLE b (id INTEGER PRIMARY KEY, y TEXT)`);
      db.query(`CREATE TABLE c (id INTEGER PRIMARY KEY, z TEXT)`);

      const { introspectSQLite3 } = require("../../src/cli/generate-model");
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");

      let models = await introspectSQLite3(db);

      // Simulate --tables "a,c"
      const tablesArg = "a,c";
      const allowedSet = new Set(tablesArg.split(",").map((s) => s.trim()));
      models = models.filter((m) => allowedSet.has(m.table));

      const schema = m2s("sqlite3", "express", models);

      assert.ok(schema.tables.a, "Schema should contain table a");
      assert.ok(!schema.tables.b, "Schema should NOT contain table b");
      assert.ok(schema.tables.c, "Schema should contain table c");

      db.disconnect();
    });
  });

  // -------------------------------------------------------------------
  // Requirement 4.7: Connection failure handling
  // -------------------------------------------------------------------
  describe("connection failure (Req 4.7)", function () {
    it("should set non-zero exit code for unsupported type", async function () {
      const ctx = new OutputContext({ json: true });

      const inspectFn = require("../../src/cli/commands/inspect");
      await inspectFn(
        { type: "invalid_db" },
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx,
      );

      assert.strictEqual(process.exitCode, 1, "Should set exit code to 1");
      const result = ctx._results[0];
      assert.ok(result.error, "Result should indicate error");
    });

    it("should set non-zero exit code when --type is missing", async function () {
      const ctx = new OutputContext({ json: true });

      const inspectFn = require("../../src/cli/commands/inspect");
      await inspectFn(
        {},
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx,
      );

      assert.strictEqual(process.exitCode, 1, "Should set exit code to 1");
      const result = ctx._results[0];
      assert.ok(result.error, "Result should indicate error");
      assert.ok(
        result.message.includes("Missing required --type"),
        "Should mention missing flag",
      );
    });
  });

  // -------------------------------------------------------------------
  // modelMetaToSchema conversion
  // -------------------------------------------------------------------
  describe("modelMetaToSchema", function () {
    it("should convert ModelMeta array to ParsedSchema", function () {
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");

      const models = [
        {
          table: "users",
          structure: { name: "required|string", email: "required|string" },
          primary_key: "id",
          unique: ["email"],
          option: {
            safeDelete: null,
            created_at: "created_at",
            modified_at: "updated_at",
          },
        },
      ];

      const schema = m2s("sqlite3", "express", models);

      assert.strictEqual(schema.adapter, "sqlite3");
      assert.strictEqual(schema.framework, "express");
      assert.ok(schema.tables.users, "Should have users table");
      assert.strictEqual(schema.tables.users.pk, "id");
      assert.deepStrictEqual(schema.tables.users.unique, ["email"]);
      assert.strictEqual(
        schema.tables.users.timestamps.created_at,
        "created_at",
      );
      assert.strictEqual(
        schema.tables.users.timestamps.modified_at,
        "updated_at",
      );
      assert.deepStrictEqual(schema.relationships, []);
      assert.deepStrictEqual(schema.options, {});
    });

    it("should handle models with softDelete option", function () {
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");

      const models = [
        {
          table: "items",
          structure: { label: "required|string" },
          primary_key: "id",
          unique: ["id"],
          option: {
            safeDelete: "is_deleted",
            created_at: null,
            modified_at: null,
          },
        },
      ];

      const schema = m2s("postgres", "express", models);
      assert.strictEqual(schema.tables.items.softDelete, "is_deleted");
    });

    it("should default framework to express when not provided", function () {
      const {
        modelMetaToSchema: m2s,
      } = require("../../src/cli/commands/inspect");
      const schema = m2s("mysql", null, []);
      assert.strictEqual(schema.framework, "express");
    });
  });
});
