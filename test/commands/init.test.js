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
        saasStructure: false,
      },
    },
    overrides,
  );
  const filePath = path.join(dir, "dbmr.schema.json");
  fs.writeFileSync(filePath, JSON.stringify(schema, null, 2));
  return filePath;
}

/**
 * Stub console.log to suppress noisy generator output during a test body.
 * Returns a restore function.
 */
function silenceLog() {
  const orig = console.log;
  console.log = function () {};
  return () => {
    console.log = orig;
  };
}

describe("CLI Commands - init (src/cli/commands/init.js)", function () {
  let tmpDir;
  let origCwd;
  let initCmd;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    // Seed a package.json so ensurePackageJson() doesn't shell out.
    // (app.js is NOT seeded — it is the first-buildout marker the guard checks.)
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0" }, null, 2),
    );
    delete require.cache[
      require.resolve("../../src/cli/commands/init")
    ];
    initCmd = require("../../src/cli/commands/init");
  });

  afterEach(function () {
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
  });

  // -------------------------------------------------------------------
  // Schema-driven buildout
  // -------------------------------------------------------------------
  describe("schema-driven buildout", function () {
    it("reads adapter/framework/options from schema via --from", async function () {
      const schemaPath = writeSchemaFile(tmpDir, {
        adapter: "postgres",
        framework: "ultimate-express",
        options: {
          session: "redis",
          rateLimiting: true,
          helmet: true,
          logger: true,
          saasStructure: false,
        },
      });

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [], from: schemaPath },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      assert.ok(ctx._results.length > 0, "Should have a result");
      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Result should have files array");

      const appJs = fs.readFileSync(path.join(tmpDir, "app.js"), "utf8");
      assert.ok(
        appJs.includes("ultimate-express"),
        "app.js should use ultimate-express framework from schema",
      );

      const envFile = fs.readFileSync(path.join(tmpDir, ".env"), "utf8");
      assert.ok(
        envFile.includes("5432"),
        ".env should contain postgres default port from schema adapter",
      );

      assert.ok(
        fs.existsSync(path.join(tmpDir, "models/users.js")),
        "users model should be generated from schema",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "routes/users/index.js")),
        "users route should be generated from schema",
      );
    });

    it("reads schema via positional arg", async function () {
      const schemaPath = writeSchemaFile(tmpDir);

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [schemaPath] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Should have files array");
      assert.ok(
        fs.existsSync(path.join(tmpDir, "models/users.js")),
        "users model should be generated via positional schema arg",
      );
    });

    it("defaults to ./dbmr.schema.json when no path given", async function () {
      writeSchemaFile(tmpDir); // writes dbmr.schema.json in cwd (tmpDir)

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      assert.ok(
        fs.existsSync(path.join(tmpDir, "models/users.js")),
        "users model should be generated from default ./dbmr.schema.json",
      );
    });

    it("writes apiBasePath and port from schema options into .env", async function () {
      writeSchemaFile(tmpDir, {
        adapter: "sqlite3",
        framework: "express",
        options: {
          session: "memory",
          rateLimiting: false,
          helmet: false,
          logger: false,
          saasStructure: false,
          apiBasePath: "/v1",
          port: 4000,
        },
      });

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      const envFile = fs.readFileSync(path.join(tmpDir, ".env"), "utf8");
      assert.ok(
        envFile.includes("PORT=4000"),
        ".env should contain PORT from schema options",
      );
      assert.ok(
        envFile.includes("API_BASE_PATH=/v1"),
        ".env should contain API_BASE_PATH from schema options",
      );
    });

    it("prefixes imports in package.json when options.output is set", async function () {
      writeSchemaFile(tmpDir, {
        adapter: "sqlite3",
        framework: "express",
        options: {
          session: "memory",
          rateLimiting: false,
          helmet: false,
          logger: false,
          saasStructure: false,
          output: "backend",
        },
      });

      const restore = silenceLog();
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          new OutputContext({ json: true }),
        );
      } finally {
        restore();
      }

      const pkg = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package.json"), "utf8"),
      );
      assert.ok(pkg.imports, "package.json should have an imports field");
      assert.strictEqual(
        pkg.imports["#models"],
        "./backend/models/index.js",
        "#models should point into the output directory",
      );
      assert.strictEqual(
        pkg.imports["#routes/*.js"],
        "./backend/routes/*.js",
        "#routes should point into the output directory",
      );
      assert.strictEqual(
        pkg.imports["#commons/*.js"],
        "./backend/commons/*.js",
        "#commons should point into the output directory",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "backend", "models", "users.js")),
        "model should be written under the output directory",
      );
    });

    it("generates SaaS structure when options.saasStructure is true", async function () {
      writeSchemaFile(tmpDir, {
        adapter: "sqlite3",
        framework: "express",
        options: {
          session: "memory",
          rateLimiting: false,
          helmet: false,
          logger: false,
          saasStructure: true,
        },
      });

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      assert.ok(
        fs.existsSync(path.join(tmpDir, "seeds", "saas-seed.js")),
        "SaaS seed file should be generated when saasStructure=true",
      );
    });

    it("skips SaaS structure when options.saasStructure is false", async function () {
      writeSchemaFile(tmpDir, {
        adapter: "sqlite3",
        framework: "express",
        options: {
          session: "memory",
          rateLimiting: false,
          helmet: false,
          logger: false,
          saasStructure: false,
        },
      });

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      assert.ok(
        !fs.existsSync(path.join(tmpDir, "seeds", "saas-seed.js")),
        "SaaS seed file should NOT exist when saasStructure=false",
      );
    });
  });

  // -------------------------------------------------------------------
  // First-buildout-only guard
  // -------------------------------------------------------------------
  describe("first-buildout-only guard", function () {
    it("refuses to run if app.js already exists in cwd", async function () {
      writeSchemaFile(tmpDir);
      // Seed an existing app.js — simulates a prior buildout
      fs.writeFileSync(path.join(tmpDir, "app.js"), "// existing project");

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      let exitCode;
      const origExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
        exitCode = process.exitCode;
      } finally {
        restore();
        process.exitCode = origExitCode;
      }

      assert.strictEqual(exitCode, 1, "Should set exitCode 1 when project exists");
      const result = ctx._results[0];
      assert.strictEqual(result.code, "PROJECT_EXISTS");
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "models", "users.js")),
        "No artifacts should be written when guard refuses",
      );
    });

    it("errors when schema file is missing", async function () {
      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      let exitCode;
      const origExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await initCmd(
          { _: [], from: "nope.schema.json" },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
        exitCode = process.exitCode;
      } finally {
        restore();
        process.exitCode = origExitCode;
      }

      assert.strictEqual(exitCode, 1, "Should set exitCode 1 on missing schema");
      assert.strictEqual(ctx._results[0].code, "SCHEMA_NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------
  // --no-install
  // -------------------------------------------------------------------
  describe("--no-install flag", function () {
    it("skips npm install when --no-install is provided", async function () {
      writeSchemaFile(tmpDir);
      let npmInstallCalled = false;
      const childProcess = require("child_process");
      const origExecSync = childProcess.execSync;
      childProcess.execSync = function (cmd) {
        if (cmd === "npm install") npmInstallCalled = true;
      };

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
        childProcess.execSync = origExecSync;
      }

      assert.strictEqual(npmInstallCalled, false, "npm install should NOT be called");
      const result = ctx._results[0];
      assert.strictEqual(
        result.dependencies.installed,
        false,
        "Result should indicate dependencies were not installed",
      );
    });
  });

  // -------------------------------------------------------------------
  // --dry-run
  // -------------------------------------------------------------------
  describe("--dry-run flag", function () {
    it("reports planned files without writing any", async function () {
      writeSchemaFile(tmpDir);

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: true, noInstall: false, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      assert.ok(ctx._results.length > 0, "Should have a result");
      const result = ctx._results[0];
      assert.ok(Array.isArray(result.files), "Result should have files array");
      assert.ok(result.files.length > 0, "Should list planned files");
      assert.ok(
        result.actions.includes("dry-run"),
        "Actions should include dry-run",
      );

      assert.ok(
        !fs.existsSync(path.join(tmpDir, "app.js")),
        "app.js should NOT exist in dry-run mode",
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, ".env")),
        ".env should NOT exist in dry-run mode",
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, "models", "users.js")),
        "models/users.js should NOT exist in dry-run mode",
      );
    });
  });

  // -------------------------------------------------------------------
  // --json
  // -------------------------------------------------------------------
  describe("--json flag", function () {
    it("outputs a JSON object with files, dependencies, and actions", async function () {
      writeSchemaFile(tmpDir);

      const restore = silenceLog();
      const ctx = new OutputContext({ json: true });
      try {
        await initCmd(
          { _: [] },
          { yes: false, json: true, dryRun: false, noInstall: true, help: false },
          ctx,
        );
      } finally {
        restore();
      }

      assert.ok(ctx._results.length > 0, "Should have accumulated a result");
      const result = ctx._results[0];

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

      assert.doesNotThrow(
        () => JSON.parse(JSON.stringify(result)),
        "Result should be serializable to valid JSON",
      );
    });
  });
});