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
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-generate-test-"));
}

/**
 * Helper: remove a directory recursively.
 */
function rmTmpDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Helper: write a minimal valid schema file into a directory.
 * Returns the path to the schema file.
 */
function writeSchemaFile(dir, overrides) {
  const schema = Object.assign(
    {
      adapter: "sqlite3",
      framework: "express",
      tables: {
        users: {
          columns: { name: "required|string", email: "required|string" },
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
      relationships: [
        { parent: "users", child: "posts", foreignKey: "user_id" },
      ],
      options: {},
    },
    overrides,
  );
  const filePath = path.join(dir, "dbmr.schema.json");
  fs.writeFileSync(filePath, JSON.stringify(schema, null, 2));
  return filePath;
}

describe("CLI Commands - generate (src/cli/commands/generate.js)", function () {
  let tmpDir;
  let origCwd;
  let generateCmd;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    // Clear require cache
    delete require.cache[require.resolve("../../src/cli/commands/generate")];
    generateCmd = require("../../src/cli/commands/generate");
  });

  afterEach(function () {
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    delete require.cache[require.resolve("../../src/cli/commands/generate")];
    process.exitCode = 0;
  });

  // -------------------------------------------------------------------
  // Requirement 5.6: All artifact types generated when no flags specified
  // -------------------------------------------------------------------
  describe("all artifacts when no flags (Req 5.6)", function () {
    it("should generate models, routes, tests, and openapi when no artifact flags given", async function () {
      const schemaPath = writeSchemaFile(tmpDir);
      const ctx = new OutputContext({ json: true });

      await generateCmd(
        { from: schemaPath },
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx,
      );

      assert.ok(ctx._results.length > 0, "Should have a result");
      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Result should have files array");

      const paths = result.files.map((f) => f.path);

      // Model files: users.js, posts.js
      assert.ok(
        paths.includes("models/users.js"),
        "Should generate users model",
      );
      assert.ok(
        paths.includes("models/posts.js"),
        "Should generate posts model",
      );

      // Route files: users.js, posts.js, child route, index.js
      assert.ok(
        paths.includes("routes/users.js"),
        "Should generate users route",
      );
      assert.ok(
        paths.includes("routes/posts.js"),
        "Should generate posts route",
      );
      assert.ok(
        paths.includes("routes/posts_child_of_users.js"),
        "Should generate child route",
      );
      assert.ok(
        paths.includes("routes/index.js"),
        "Should generate routes index",
      );

      // OpenAPI
      assert.ok(paths.includes("openapi.json"), "Should generate openapi.json");

      // Test files
      assert.ok(
        paths.includes("test/users.test.js"),
        "Should generate users test",
      );
      assert.ok(
        paths.includes("test/posts.test.js"),
        "Should generate posts test",
      );
      assert.ok(
        paths.includes("test/posts_child_of_users.test.js"),
        "Should generate child test",
      );

      // Verify files actually exist on disk
      assert.ok(fs.existsSync(path.join(tmpDir, "models/users.js")));
      assert.ok(fs.existsSync(path.join(tmpDir, "routes/index.js")));
      assert.ok(fs.existsSync(path.join(tmpDir, "openapi.json")));
      assert.ok(fs.existsSync(path.join(tmpDir, "test/users.test.js")));
    });
  });

  // -------------------------------------------------------------------
  // Requirement 5.2: --models generates only model files
  // -------------------------------------------------------------------
  describe("--models flag (Req 5.2)", function () {
    it("should generate only model files when --models is specified", async function () {
      const schemaPath = writeSchemaFile(tmpDir);
      const ctx = new OutputContext({ json: true });

      await generateCmd(
        { from: schemaPath, models: true },
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx,
      );

      const result = ctx._results[0];
      const paths = result.files.map((f) => f.path);

      // Should have model files
      assert.ok(
        paths.includes("models/users.js"),
        "Should generate users model",
      );
      assert.ok(
        paths.includes("models/posts.js"),
        "Should generate posts model",
      );

      // Should NOT have route, test, or openapi files
      const nonModelFiles = paths.filter((p) => !p.startsWith("models/"));
      assert.strictEqual(
        nonModelFiles.length,
        0,
        "Should only generate model files, got: " + nonModelFiles.join(", "),
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 5.3: --routes generates route files including child routes and index
  // -------------------------------------------------------------------
  describe("--routes flag (Req 5.3)", function () {
    it("should generate route files, child routes, and index when --routes is specified", async function () {
      const schemaPath = writeSchemaFile(tmpDir);
      const ctx = new OutputContext({ json: true });

      await generateCmd(
        { from: schemaPath, routes: true },
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx,
      );

      const result = ctx._results[0];
      const paths = result.files.map((f) => f.path);

      // Should have route files
      assert.ok(
        paths.includes("routes/users.js"),
        "Should generate users route",
      );
      assert.ok(
        paths.includes("routes/posts.js"),
        "Should generate posts route",
      );
      assert.ok(
        paths.includes("routes/posts_child_of_users.js"),
        "Should generate child route",
      );
      assert.ok(
        paths.includes("routes/index.js"),
        "Should generate routes index",
      );

      // Should NOT have model, test, or openapi files
      const nonRouteFiles = paths.filter((p) => !p.startsWith("routes/"));
      assert.strictEqual(
        nonRouteFiles.length,
        0,
        "Should only generate route files, got: " + nonRouteFiles.join(", "),
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 5.7: --dry-run produces no file writes
  // -------------------------------------------------------------------
  describe("--dry-run flag (Req 5.7)", function () {
    it("should report planned files without writing any", async function () {
      const schemaPath = writeSchemaFile(tmpDir);
      const ctx = new OutputContext({ json: true });

      await generateCmd(
        { from: schemaPath },
        { yes: false, json: true, dryRun: true, noInstall: false, help: false },
        ctx,
      );

      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Result should have files array");
      assert.ok(result.files.length > 0, "Should list planned files");

      // All statuses should be "planned"
      for (const f of result.files) {
        assert.strictEqual(f.status, "planned", `${f.path} should be planned`);
      }

      // Verify no files were actually written
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "models")),
        "models/ should NOT exist in dry-run mode",
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "routes")),
        "routes/ should NOT exist in dry-run mode",
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "openapi.json")),
        "openapi.json should NOT exist in dry-run mode",
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 11.4: Skip-unchanged logic reports files as unchanged
  // -------------------------------------------------------------------
  describe("skip-unchanged logic (Req 11.4)", function () {
    it("should report files as unchanged when content matches", async function () {
      const schemaPath = writeSchemaFile(tmpDir);

      // First run: generate all files
      const ctx1 = new OutputContext({ json: true });
      await generateCmd(
        { from: schemaPath },
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx1,
      );

      const firstResult = ctx1._results[0];
      // All should be "created" on first run
      for (const f of firstResult.files) {
        assert.strictEqual(
          f.status,
          "created",
          `${f.path} should be created on first run`,
        );
      }

      // Second run: same schema, same files
      delete require.cache[require.resolve("../../src/cli/commands/generate")];
      const generateCmd2 = require("../../src/cli/commands/generate");
      const ctx2 = new OutputContext({ json: true });
      await generateCmd2(
        { from: schemaPath },
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx2,
      );

      const secondResult = ctx2._results[0];
      // All should be "unchanged" on second run
      for (const f of secondResult.files) {
        assert.strictEqual(
          f.status,
          "unchanged",
          `${f.path} should be unchanged on second run`,
        );
      }
    });
  });

  // -------------------------------------------------------------------
  // Requirement 5.8: --json outputs valid JSON with file statuses
  // -------------------------------------------------------------------
  describe("--json flag (Req 5.8)", function () {
    it("should output a JSON object with files array containing path and status", async function () {
      const schemaPath = writeSchemaFile(tmpDir);
      const ctx = new OutputContext({ json: true });

      await generateCmd(
        { from: schemaPath },
        {
          yes: false,
          json: true,
          dryRun: false,
          noInstall: false,
          help: false,
        },
        ctx,
      );

      assert.ok(ctx._results.length > 0, "Should have accumulated a result");
      const result = ctx._results[0];

      // Validate structure
      assert.ok(Array.isArray(result.files), "Result should have files array");
      for (const f of result.files) {
        assert.ok(typeof f.path === "string", "Each file should have a path");
        assert.ok(
          ["created", "overwritten", "unchanged", "planned"].includes(f.status),
          `Status should be valid, got: ${f.status}`,
        );
      }

      // Verify it's valid JSON when serialized
      const jsonStr = JSON.stringify(result);
      assert.doesNotThrow(
        () => JSON.parse(jsonStr),
        "Result should be serializable to valid JSON",
      );
    });
  });

  // -------------------------------------------------------------------
  // Error handling: missing schema file
  // -------------------------------------------------------------------
  describe("error handling", function () {
    it("should report error when schema file not found", async function () {
      const ctx = new OutputContext({ json: true });

      await generateCmd(
        { from: "nonexistent.json" },
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
      assert.strictEqual(result.code, "SCHEMA_NOT_FOUND");
    });
  });
});
