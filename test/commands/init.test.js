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
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-init-test-"));
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
        },
      },
      relationships: [],
      options: {
        session: "memory",
        rateLimiting: false,
        helmet: false,
        logger: false,
      },
    },
    overrides,
  );
  const filePath = path.join(dir, "dbmr.schema.json");
  fs.writeFileSync(filePath, JSON.stringify(schema, null, 2));
  return filePath;
}

describe("CLI Commands - init (src/cli/commands/init.js)", function () {
  let tmpDir;
  let origCwd;
  let initCmd;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Seed a package.json so ensurePackageJson() doesn't shell out
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0" }, null, 2),
    );
    initCmd = require("../../src/cli/commands/init");
  });

  afterEach(function () {
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
  });

  // -------------------------------------------------------------------
  // Requirement 3.1: --from reads schema file for adapter/framework
  // -------------------------------------------------------------------
  describe("--from flag (Req 3.1)", function () {
    it("should read adapter and framework from schema file", async function () {
      const schemaPath = writeSchemaFile(tmpDir, {
        adapter: "postgres",
        framework: "ultimate-express",
        options: {
          session: "redis",
          rateLimiting: true,
          helmet: true,
          logger: true,
        },
      });

      // Stub runInstall to avoid actual npm install
      const childProcess = require("child_process");
      const origExecSync = childProcess.execSync;
      childProcess.execSync = function () {};

      const origLog = console.log;
      console.log = function () {};

      const ctx = new OutputContext({ json: true });

      try {
        await initCmd(
          { from: schemaPath },
          {
            yes: false,
            json: true,
            dryRun: false,
            noInstall: true,
            help: false,
          },
          ctx,
        );
      } finally {
        childProcess.execSync = origExecSync;
        console.log = origLog;
      }

      // Verify the result contains generated files
      assert.ok(ctx._results.length > 0, "Should have a result");
      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Result should have files array");

      // Verify app.js was generated with the correct framework
      const appJs = fs.readFileSync(path.join(tmpDir, "app.js"), "utf8");
      assert.ok(
        appJs.includes("ultimate-express"),
        "app.js should use ultimate-express framework from schema",
      );

      // Verify .env was generated with postgres config
      const envFile = fs.readFileSync(path.join(tmpDir, ".env"), "utf8");
      assert.ok(
        envFile.includes("5432"),
        ".env should contain postgres default port from schema adapter",
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 3.2: --yes skips prompts
  // -------------------------------------------------------------------
  describe("--yes flag (Req 3.2)", function () {
    it("should accept defaults without prompting when --yes is provided", async function () {
      const origLog = console.log;
      console.log = function () {};

      const ctx = new OutputContext({ json: true });

      try {
        await initCmd(
          {},
          {
            yes: true,
            json: true,
            dryRun: false,
            noInstall: true,
            help: false,
          },
          ctx,
        );
      } finally {
        console.log = origLog;
      }

      assert.ok(ctx._results.length > 0, "Should have a result");
      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Result should have files array");
      assert.ok(result.files.length > 0, "Should have generated files");

      // Default is postgres + express — verify app.js exists
      assert.ok(
        fs.existsSync(path.join(tmpDir, "app.js")),
        "app.js should be created with defaults",
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 3.3: --no-install skips npm install
  // -------------------------------------------------------------------
  describe("--no-install flag (Req 3.3)", function () {
    it("should skip npm install when --no-install is provided", async function () {
      let npmInstallCalled = false;
      const childProcess = require("child_process");
      const origExecSync = childProcess.execSync;
      childProcess.execSync = function (cmd) {
        if (cmd === "npm install") {
          npmInstallCalled = true;
        }
      };

      const origLog = console.log;
      console.log = function () {};

      const ctx = new OutputContext({ json: true });

      try {
        await initCmd(
          {},
          {
            yes: true,
            json: true,
            dryRun: false,
            noInstall: true,
            help: false,
          },
          ctx,
        );
      } finally {
        childProcess.execSync = origExecSync;
        console.log = origLog;
      }

      assert.strictEqual(
        npmInstallCalled,
        false,
        "npm install should NOT be called when --no-install is set",
      );

      const result = ctx._results[0];
      assert.strictEqual(
        result.dependencies.installed,
        false,
        "Result should indicate dependencies were not installed",
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 3.5: --dry-run produces no file writes
  // -------------------------------------------------------------------
  describe("--dry-run flag (Req 3.5)", function () {
    it("should report planned files without writing any", async function () {
      const ctx = new OutputContext({ json: true });

      const origLog = console.log;
      console.log = function () {};

      try {
        await initCmd(
          {},
          {
            yes: true,
            json: true,
            dryRun: true,
            noInstall: false,
            help: false,
          },
          ctx,
        );
      } finally {
        console.log = origLog;
      }

      assert.ok(ctx._results.length > 0, "Should have a result");
      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Result should have files array");
      assert.ok(result.files.length > 0, "Should list planned files");

      // Verify no project files were actually written (only package.json from setup)
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "app.js")),
        "app.js should NOT exist in dry-run mode",
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, ".env")),
        ".env should NOT exist in dry-run mode",
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "migrate.js")),
        "root migrate.js should NOT exist in dry-run mode",
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "commons", "migrate.js")),
        "commons/migrate.js should NOT exist in dry-run mode",
      );
    });

    it("should include dry-run action in result", async function () {
      const ctx = new OutputContext({ json: true });

      await initCmd(
        {},
        { yes: true, json: true, dryRun: true, noInstall: false, help: false },
        ctx,
      );

      const result = ctx._results[0];
      assert.ok(
        result.actions.includes("dry-run"),
        "Actions should include dry-run",
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 3.4: --json outputs valid JSON result
  // -------------------------------------------------------------------
  describe("--json flag (Req 3.4)", function () {
    it("should output a JSON object with files, dependencies, and actions", async function () {
      const origLog = console.log;
      console.log = function () {};

      const ctx = new OutputContext({ json: true });

      try {
        await initCmd(
          {},
          {
            yes: true,
            json: true,
            dryRun: false,
            noInstall: true,
            help: false,
          },
          ctx,
        );
      } finally {
        console.log = origLog;
      }

      assert.ok(ctx._results.length > 0, "Should have accumulated a result");
      const result = ctx._results[0];

      // Validate structure
      assert.ok(Array.isArray(result.files), "Result should have files array");
      assert.ok(
        typeof result.dependencies === "object",
        "Result should have dependencies object",
      );
      assert.ok(
        typeof result.dependencies.installed === "boolean",
        "dependencies.installed should be boolean",
      );
      assert.ok(
        Array.isArray(result.actions),
        "Result should have actions array",
      );

      // Verify it's valid JSON when serialized
      const jsonStr = JSON.stringify(result);
      assert.doesNotThrow(
        () => JSON.parse(jsonStr),
        "Result should be serializable to valid JSON",
      );
    });
  });
});
