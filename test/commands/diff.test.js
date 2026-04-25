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
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-diff-test-"));
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
 * Minimal valid schema object for testing.
 */
function validSchema(overrides) {
  return Object.assign(
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
}

/**
 * Write a schema file into a directory.
 */
function writeSchema(dir, schema) {
  const filePath = path.join(dir, "dbmr.schema.json");
  fs.writeFileSync(filePath, JSON.stringify(schema, null, 2));
  return filePath;
}

/**
 * Generate all files for a schema so they are in sync.
 */
async function generateSyncedFiles(dir, schemaPath) {
  delete require.cache[require.resolve("../../src/cli/commands/generate")];
  const generateCmd = require("../../src/cli/commands/generate");
  const ctx = new OutputContext({ json: true });
  await generateCmd(
    { from: schemaPath },
    { yes: false, json: true, dryRun: false, noInstall: false, help: false },
    ctx,
  );
}

/**
 * Recursively collect all files in a directory as { relPath: content } map.
 */
function snapshotDir(baseDir, prefix) {
  prefix = prefix || "";
  const snapshot = {};
  if (!fs.existsSync(baseDir)) return snapshot;
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(snapshot, snapshotDir(full, rel));
    } else {
      snapshot[rel] = fs.readFileSync(full, "utf8");
    }
  }
  return snapshot;
}

describe("CLI Commands - diff (src/cli/commands/diff.js)", function () {
  let tmpDir;
  let origCwd;
  let diffCmd;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    delete require.cache[require.resolve("../../src/cli/commands/diff")];
    diffCmd = require("../../src/cli/commands/diff");
  });

  afterEach(function () {
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    delete require.cache[require.resolve("../../src/cli/commands/diff")];
    process.exitCode = 0;
  });

  // -------------------------------------------------------------------
  // Requirement 7.1: Diff categorizes files correctly
  // -------------------------------------------------------------------
  describe("file categorization (Req 7.1)", function () {
    it("should report all files as added when no generated files exist", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

      const result = ctx._results[0];
      assert.ok(result.added.length > 0, "Should have added files");
      assert.ok(result.added.includes("models/users.js"));
      assert.ok(result.added.includes("models/posts.js"));
      assert.ok(result.added.includes("routes/users.js"));
      assert.ok(result.added.includes("routes/index.js"));
      assert.ok(result.added.includes("openapi.json"));
      assert.strictEqual(result.modified.length, 0);
      assert.strictEqual(result.deleted.length, 0);
    });

    it("should report modified files when content differs", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      // Generate synced files first
      await generateSyncedFiles(tmpDir, schemaPath);

      // Tamper with a file
      const modelPath = path.join(tmpDir, "models", "users.js");
      fs.writeFileSync(modelPath, "// tampered\n", "utf8");

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

      const result = ctx._results[0];
      const modEntry = result.modified.find(
        (m) => m.file === "models/users.js",
      );
      assert.ok(modEntry, "models/users.js should be in modified list");
      assert.ok(modEntry.diff.length > 0, "diff should not be empty");
    });

    it("should report deleted files when extra files exist on disk", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      // Generate synced files
      await generateSyncedFiles(tmpDir, schemaPath);

      // Add an extra file the schema doesn't expect
      fs.writeFileSync(
        path.join(tmpDir, "models", "orphan.js"),
        "// orphan\n",
        "utf8",
      );

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

      const result = ctx._results[0];
      assert.ok(
        result.deleted.includes("models/orphan.js"),
        "orphan.js should be in deleted list",
      );
    });

    it("should report no differences when all files are in sync", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      await generateSyncedFiles(tmpDir, schemaPath);

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

      const result = ctx._results[0];
      assert.strictEqual(result.added.length, 0, "No added files");
      assert.strictEqual(result.modified.length, 0, "No modified files");
      assert.strictEqual(result.deleted.length, 0, "No deleted files");
    });
  });

  // -------------------------------------------------------------------
  // Requirement 7.4: --json outputs valid JSON with added/modified/deleted
  // -------------------------------------------------------------------
  describe("--json flag (Req 7.4)", function () {
    it("should output valid JSON with added, modified, and deleted arrays", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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
      assert.ok(Array.isArray(result.added), "Result should have added array");
      assert.ok(
        Array.isArray(result.modified),
        "Result should have modified array",
      );
      assert.ok(
        Array.isArray(result.deleted),
        "Result should have deleted array",
      );

      // Each added entry is a string
      for (const f of result.added) {
        assert.ok(typeof f === "string", "Added entries should be strings");
      }

      // Each modified entry has file and diff
      for (const m of result.modified) {
        assert.ok(
          typeof m.file === "string",
          "Modified entry should have file",
        );
        assert.ok(
          typeof m.diff === "string",
          "Modified entry should have diff",
        );
      }

      // Verify it's valid JSON when serialized
      const jsonStr = JSON.stringify(result);
      assert.doesNotThrow(() => JSON.parse(jsonStr), "Should be valid JSON");
    });
  });

  // -------------------------------------------------------------------
  // Requirement 7.5: No files modified after diff runs
  // -------------------------------------------------------------------
  describe("read-only operation (Req 7.5)", function () {
    it("should not modify any files on disk after running diff", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      // Generate synced files
      await generateSyncedFiles(tmpDir, schemaPath);

      // Tamper with a file to create a diff scenario
      const modelPath = path.join(tmpDir, "models", "users.js");
      fs.writeFileSync(modelPath, "// tampered\n", "utf8");

      // Snapshot all files before diff
      const before = snapshotDir(tmpDir);

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

      // Snapshot all files after diff
      const after = snapshotDir(tmpDir);

      // Compare snapshots — every file should be identical
      const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of allKeys) {
        assert.ok(key in before, `File ${key} should exist before diff`);
        assert.ok(key in after, `File ${key} should exist after diff`);
        assert.strictEqual(
          before[key],
          after[key],
          `File ${key} should not be modified by diff`,
        );
      }
    });

    it("should not create any new files on disk", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      // No generated files — diff should report them as added but NOT create them
      const beforeFiles = snapshotDir(tmpDir);

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

      const afterFiles = snapshotDir(tmpDir);

      // Same set of files before and after
      assert.deepStrictEqual(
        Object.keys(beforeFiles).sort(),
        Object.keys(afterFiles).sort(),
        "No new files should be created by diff",
      );
    });
  });

  // -------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------
  describe("error handling", function () {
    it("should report error when schema file not found", async function () {
      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

    it("should report error for invalid schema", async function () {
      const badSchema = {
        adapter: "invalid",
        framework: "express",
        tables: {},
      };
      const schemaPath = writeSchema(tmpDir, badSchema);

      const ctx = new OutputContext({ json: true });
      await diffCmd(
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

      assert.strictEqual(process.exitCode, 1, "Should set exit code to 1");
      const result = ctx._results[0];
      assert.ok(result.error, "Result should indicate error");
      assert.strictEqual(result.code, "SCHEMA_VALIDATION");
    });
  });

  // -------------------------------------------------------------------
  // Human-readable output
  // -------------------------------------------------------------------
  describe("human-readable output", function () {
    it("should log human-readable messages when --json is not set", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);

      try {
        const ctx = new OutputContext({ json: false });
        await diffCmd(
          { from: schemaPath },
          {
            yes: false,
            json: false,
            dryRun: false,
            noInstall: false,
            help: false,
          },
          ctx,
        );

        // Should have human-readable output about added files
        assert.ok(
          logs.some((l) => l.includes("Added")),
          "Should show Added section",
        );
        assert.ok(
          logs.some((l) => l.includes("differ")),
          "Should show total count",
        );
      } finally {
        console.log = origLog;
      }
    });

    it("should log 'up to date' when no differences", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);

      await generateSyncedFiles(tmpDir, schemaPath);

      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);

      try {
        delete require.cache[require.resolve("../../src/cli/commands/diff")];
        const diffCmd2 = require("../../src/cli/commands/diff");
        const ctx = new OutputContext({ json: false });
        await diffCmd2(
          { from: schemaPath },
          {
            yes: false,
            json: false,
            dryRun: false,
            noInstall: false,
            help: false,
          },
          ctx,
        );

        assert.ok(
          logs.some((l) => l.includes("up to date")),
          "Should show up to date message",
        );
      } finally {
        console.log = origLog;
      }
    });
  });
});
