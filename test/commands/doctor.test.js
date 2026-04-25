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
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-doctor-test-"));
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
      },
      relationships: [],
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
 * Write a package.json with given dependencies into a directory.
 */
function writePkg(dir, deps) {
  const pkg = {
    name: "test-project",
    version: "1.0.0",
    dependencies: deps || {},
  };
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(pkg, null, 2),
  );
}

/**
 * Generate all files for a schema so they are in sync.
 * Uses the generate command to produce the expected files.
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

describe("CLI Commands - doctor (src/cli/commands/doctor.js)", function () {
  let tmpDir;
  let origCwd;
  let doctorCmd;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    delete require.cache[require.resolve("../../src/cli/commands/doctor")];
    doctorCmd = require("../../src/cli/commands/doctor");
  });

  afterEach(function () {
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    delete require.cache[require.resolve("../../src/cli/commands/doctor")];
    process.exitCode = 0;
  });

  // -------------------------------------------------------------------
  // Requirement 6.4: Valid schema + correct deps + synced files → exit 0
  // -------------------------------------------------------------------
  describe("all checks pass (Req 6.4)", function () {
    it("should exit 0 when schema is valid, deps present, and files in sync", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);
      writePkg(tmpDir, { "better-sqlite3": "^9.0.0" });

      // Generate files so they are in sync
      await generateSyncedFiles(tmpDir, schemaPath);

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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

      assert.strictEqual(
        result.validation.valid,
        true,
        "Validation should pass",
      );
      assert.strictEqual(
        result.dependencies.ok,
        true,
        "Dependencies should be OK",
      );
      assert.strictEqual(result.sync.ok, true, "Sync should be OK");
      assert.strictEqual(process.exitCode, 0, "Exit code should be 0");
    });
  });

  // -------------------------------------------------------------------
  // Requirement 6.1: Invalid schema → exit non-zero with validation errors
  // -------------------------------------------------------------------
  describe("invalid schema (Req 6.1)", function () {
    it("should exit non-zero when schema has validation errors", async function () {
      const badSchema = {
        adapter: "not-a-real-adapter",
        framework: "express",
        tables: {},
      };
      const schemaPath = writeSchema(tmpDir, badSchema);
      writePkg(tmpDir, {});

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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
      assert.strictEqual(
        result.validation.valid,
        false,
        "Validation should fail",
      );
      assert.ok(
        result.validation.errors.length > 0,
        "Should have validation errors",
      );
      assert.strictEqual(process.exitCode, 1, "Exit code should be 1");
    });

    it("should exit non-zero when schema file is missing", async function () {
      writePkg(tmpDir, {});

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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

      const result = ctx._results[0];
      assert.strictEqual(result.validation.valid, false);
      assert.ok(
        result.validation.errors.some((e) => e.message.includes("not found")),
        "Should report file not found",
      );
      assert.strictEqual(process.exitCode, 1);
    });
  });

  // -------------------------------------------------------------------
  // Requirement 6.2: Missing driver dependency → reported
  // -------------------------------------------------------------------
  describe("missing driver dependency (Req 6.2)", function () {
    it("should report missing driver when adapter dep is absent from package.json", async function () {
      const schema = validSchema({ adapter: "postgres" });
      const schemaPath = writeSchema(tmpDir, schema);
      // Write package.json WITHOUT pg
      writePkg(tmpDir, { express: "^4.0.0" });

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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
      assert.strictEqual(
        result.dependencies.ok,
        false,
        "Dependencies should fail",
      );
      assert.ok(
        result.dependencies.missing.length > 0,
        "Should have missing deps",
      );
      assert.strictEqual(result.dependencies.missing[0].driver, "pg");
      assert.strictEqual(result.dependencies.missing[0].adapter, "postgres");
      assert.strictEqual(process.exitCode, 1);
    });

    it("should pass when driver is present in dependencies", async function () {
      const schema = validSchema({ adapter: "mysql" });
      const schemaPath = writeSchema(tmpDir, schema);
      writePkg(tmpDir, { mysql2: "^3.0.0" });

      // Generate synced files
      await generateSyncedFiles(tmpDir, schemaPath);

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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
      assert.strictEqual(
        result.dependencies.ok,
        true,
        "Dependencies should pass",
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 6.3: Out-of-sync file → reported in sync check
  // -------------------------------------------------------------------
  describe("out-of-sync files (Req 6.3)", function () {
    it("should report files as out of sync when they differ from expected", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);
      writePkg(tmpDir, { "better-sqlite3": "^9.0.0" });

      // Generate files first
      await generateSyncedFiles(tmpDir, schemaPath);

      // Tamper with a generated file
      const modelPath = path.join(tmpDir, "models", "users.js");
      fs.writeFileSync(modelPath, "// tampered content\n", "utf8");

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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
      assert.strictEqual(result.sync.ok, false, "Sync should fail");
      assert.ok(
        result.sync.outOfSync.length > 0,
        "Should have out-of-sync files",
      );

      const modifiedFile = result.sync.outOfSync.find(
        (s) => s.file === "models/users.js",
      );
      assert.ok(modifiedFile, "users.js should be reported as out of sync");
      assert.strictEqual(modifiedFile.status, "modified");
      assert.strictEqual(process.exitCode, 1);
    });

    it("should report missing files as out of sync", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);
      writePkg(tmpDir, { "better-sqlite3": "^9.0.0" });

      // Don't generate any files — they should all be reported as missing

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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
      assert.strictEqual(result.sync.ok, false, "Sync should fail");
      assert.ok(
        result.sync.outOfSync.length > 0,
        "Should have out-of-sync files",
      );

      const missingFiles = result.sync.outOfSync.filter(
        (s) => s.status === "missing",
      );
      assert.ok(missingFiles.length > 0, "Should have missing files");
      assert.strictEqual(process.exitCode, 1);
    });
  });

  // -------------------------------------------------------------------
  // Requirement 6.6: --json outputs structured JSON result
  // -------------------------------------------------------------------
  describe("--json flag (Req 6.6)", function () {
    it("should output structured JSON with validation, dependencies, and sync", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);
      writePkg(tmpDir, { "better-sqlite3": "^9.0.0" });

      await generateSyncedFiles(tmpDir, schemaPath);

      const ctx = new OutputContext({ json: true });
      await doctorCmd(
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
      assert.ok("validation" in result, "Result should have validation");
      assert.ok("dependencies" in result, "Result should have dependencies");
      assert.ok("sync" in result, "Result should have sync");

      assert.ok(typeof result.validation.valid === "boolean");
      assert.ok(Array.isArray(result.validation.errors));
      assert.ok(typeof result.dependencies.ok === "boolean");
      assert.ok(Array.isArray(result.dependencies.missing));
      assert.ok(typeof result.sync.ok === "boolean");
      assert.ok(Array.isArray(result.sync.outOfSync));

      // Verify it's valid JSON when serialized
      const jsonStr = JSON.stringify(result);
      assert.doesNotThrow(() => JSON.parse(jsonStr), "Should be valid JSON");
    });
  });

  // -------------------------------------------------------------------
  // Human-readable output (non-JSON)
  // -------------------------------------------------------------------
  describe("human-readable output", function () {
    it("should log human-readable messages when --json is not set", async function () {
      const schema = validSchema();
      const schemaPath = writeSchema(tmpDir, schema);
      writePkg(tmpDir, { "better-sqlite3": "^9.0.0" });

      await generateSyncedFiles(tmpDir, schemaPath);

      // Capture console.log output
      const logs = [];
      const origLog = console.log;
      console.log = (msg) => logs.push(msg);

      try {
        const ctx = new OutputContext({ json: false });
        await doctorCmd(
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

        assert.ok(logs.some((l) => l.includes("Schema validation passed")));
        assert.ok(logs.some((l) => l.includes("Dependencies OK")));
        assert.ok(logs.some((l) => l.includes("Generated files in sync")));
      } finally {
        console.log = origLog;
      }
    });
  });
});
