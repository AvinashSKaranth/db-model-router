"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  generateSessionMigration,
  SQL_DATABASES,
  NOSQL_DATABASES,
} = require("../src/cli/init/generators");

/**
 * Helper: create a temp directory and return its path.
 */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cli-init-test-"));
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
 * Helper: clear require cache for init.js and its sub-modules so we can
 * re-require with different stubs in place.
 */
function clearInitCache() {
  const initPath = require.resolve("../src/cli/init.js");
  delete require.cache[initPath];
}

/**
 * Helper: require a fresh copy of init.js (after clearing cache).
 */
function freshRequireInit() {
  clearInitCache();
  return require("../src/cli/init.js");
}

describe("CLI Init - src/cli/init.js orchestration", function () {
  // ---------------------------------------------------------------
  // ensurePackageJson() tests
  // ---------------------------------------------------------------
  describe("ensurePackageJson()", function () {
    let tmpDir;
    let origCwd;

    beforeEach(function () {
      tmpDir = makeTmpDir();
      origCwd = process.cwd();
      process.chdir(tmpDir);
    });

    afterEach(function () {
      process.chdir(origCwd);
      rmTmpDir(tmpDir);
      clearInitCache();
    });

    it("should skip npm init when package.json already exists (Req 1.4)", function () {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test" }),
      );

      const { ensurePackageJson } = freshRequireInit();
      // Should not throw — package.json exists so npm init is skipped
      assert.doesNotThrow(() => ensurePackageJson());
    });

    it("should exit with code 1 when npm init fails (Req 1.3)", function () {
      // Stub child_process.execSync BEFORE requiring init.js
      // so the destructured reference picks up our stub.
      const childProcess = require("child_process");
      const origExecSync = childProcess.execSync;
      childProcess.execSync = function (cmd, opts) {
        if (cmd === "npm init -y") {
          throw new Error("npm init failed");
        }
        return origExecSync.call(childProcess, cmd, opts);
      };

      let exitCode = null;
      const origExit = process.exit;
      process.exit = function (code) {
        exitCode = code;
        throw new Error("EXIT_" + code);
      };

      const origConsoleError = console.error;
      console.error = function () {};

      const { ensurePackageJson } = freshRequireInit();

      try {
        ensurePackageJson();
      } catch (e) {
        // Expected — our fake process.exit throws
      }

      assert.strictEqual(
        exitCode,
        1,
        "Should exit with code 1 on npm init failure",
      );

      // Restore
      process.exit = origExit;
      childProcess.execSync = origExecSync;
      console.error = origConsoleError;
    });
  });

  // ---------------------------------------------------------------
  // Prompt configuration tests
  // ---------------------------------------------------------------
  describe("Prompt configuration", function () {
    it("should have correct prompt options and defaults (Req 2.1, 2.4, 3.1, 4.1)", function () {
      const promptSrc = fs.readFileSync(
        path.join(__dirname, "..", "src", "cli", "init", "prompt.js"),
        "utf8",
      );

      // Framework prompt: list type, default ultimate-express
      assert.ok(
        promptSrc.includes('"ultimate-express"'),
        "Should include ultimate-express option",
      );
      assert.ok(
        promptSrc.includes('"express"'),
        "Should include express option",
      );
      assert.ok(
        promptSrc.includes('default: "ultimate-express"'),
        "Default framework should be ultimate-express",
      );

      // Database prompt: all 9 databases
      const databases = [
        "mysql",
        "postgres",
        "sqlite3",
        "mongodb",
        "mssql",
        "cockroachdb",
        "oracle",
        "redis",
        "dynamodb",
      ];
      for (const db of databases) {
        assert.ok(
          promptSrc.includes(`"${db}"`),
          `Should include ${db} database option`,
        );
      }

      // Session prompt: 3 options
      assert.ok(
        promptSrc.includes('"memory"'),
        "Should include memory session option",
      );
      assert.ok(
        promptSrc.includes('"redis"'),
        "Should include redis session option",
      );
      assert.ok(
        promptSrc.includes('"database"'),
        "Should include database session option",
      );

      // Confirm prompts for rateLimiting, helmet, logger
      assert.ok(
        promptSrc.includes('"rateLimiting"'),
        "Should have rateLimiting prompt",
      );
      assert.ok(promptSrc.includes('"helmet"'), "Should have helmet prompt");
      assert.ok(promptSrc.includes('"logger"'), "Should have logger prompt");

      // All confirm prompts should be type: "confirm"
      // 3 in main questions (rateLimiting, helmet, logger) + 1 follow-up (loki)
      const confirmCount = (promptSrc.match(/type:\s*"confirm"/g) || []).length;
      assert.strictEqual(
        confirmCount,
        4,
        "Should have exactly 4 confirm prompts",
      );

      // List prompts count
      const listCount = (promptSrc.match(/type:\s*"list"/g) || []).length;
      assert.strictEqual(listCount, 3, "Should have exactly 3 list prompts");
    });
  });

  // ---------------------------------------------------------------
  // runInstall() failure tests
  // ---------------------------------------------------------------
  describe("runInstall()", function () {
    it("should print manual install instructions on npm install failure (Req 12.4)", function () {
      // Stub child_process.execSync BEFORE requiring init.js
      const childProcess = require("child_process");
      const origExecSync = childProcess.execSync;
      childProcess.execSync = function (cmd, opts) {
        if (cmd === "npm install") {
          throw new Error("npm install failed");
        }
        return origExecSync.call(childProcess, cmd, opts);
      };

      let exitCode = null;
      const origExit = process.exit;
      process.exit = function (code) {
        exitCode = code;
        throw new Error("EXIT_" + code);
      };

      const errors = [];
      const origConsoleError = console.error;
      console.error = function (...args) {
        errors.push(args.join(" "));
      };

      const origConsoleLog = console.log;
      console.log = function () {};

      const { runInstall } = freshRequireInit();

      try {
        runInstall();
      } catch (e) {
        // Expected — our fake process.exit throws
      }

      assert.strictEqual(exitCode, 1, "Should exit with code 1");
      const errorOutput = errors.join("\n");
      assert.ok(
        errorOutput.includes("npm install"),
        "Should mention npm install in error message",
      );

      // Restore
      process.exit = origExit;
      childProcess.execSync = origExecSync;
      console.error = origConsoleError;
      console.log = origConsoleLog;
    });
  });

  // ---------------------------------------------------------------
  // Session migration generation tests
  // ---------------------------------------------------------------
  describe("Session migration generation (Req 4.5)", function () {
    const fixedDate = new Date("2025-01-15T10:30:00Z");

    it("should generate session migration for SQL databases with session=database", function () {
      for (const db of SQL_DATABASES) {
        const answers = {
          framework: "express",
          database: db,
          session: "database",
          rateLimiting: false,
          helmet: false,
          logger: false,
        };
        const result = generateSessionMigration(answers, fixedDate);
        assert.ok(
          result !== null,
          `Should generate session migration for ${db} + database session`,
        );
        assert.ok(
          result.filename.endsWith(".sql"),
          `Session migration for ${db} should be .sql`,
        );
        assert.ok(
          result.content.includes("sessions"),
          `Session migration for ${db} should create sessions table`,
        );
        assert.ok(
          result.content.includes("sid"),
          `Session migration for ${db} should have sid column`,
        );
        assert.ok(
          result.content.includes("sess"),
          `Session migration for ${db} should have sess column`,
        );
        assert.ok(
          result.content.includes("expired_at"),
          `Session migration for ${db} should have expired_at column`,
        );
      }
    });

    it("should return null for NoSQL databases with session=database", function () {
      for (const db of NOSQL_DATABASES) {
        const answers = {
          framework: "express",
          database: db,
          session: "database",
          rateLimiting: false,
          helmet: false,
          logger: false,
        };
        const result = generateSessionMigration(answers, fixedDate);
        assert.strictEqual(
          result,
          null,
          `Should NOT generate session migration for NoSQL ${db}`,
        );
      }
    });

    it("should return null for SQL databases with session=memory", function () {
      for (const db of SQL_DATABASES) {
        const answers = {
          framework: "express",
          database: db,
          session: "memory",
          rateLimiting: false,
          helmet: false,
          logger: false,
        };
        const result = generateSessionMigration(answers, fixedDate);
        assert.strictEqual(
          result,
          null,
          `Should NOT generate session migration for ${db} + memory session`,
        );
      }
    });

    it("should return null for SQL databases with session=redis", function () {
      for (const db of SQL_DATABASES) {
        const answers = {
          framework: "express",
          database: db,
          session: "redis",
          rateLimiting: false,
          helmet: false,
          logger: false,
        };
        const result = generateSessionMigration(answers, fixedDate);
        assert.strictEqual(
          result,
          null,
          `Should NOT generate session migration for ${db} + redis session`,
        );
      }
    });
  });

  // ---------------------------------------------------------------
  // Shebang line tests
  // ---------------------------------------------------------------
  describe("Shebang lines (Req 14.2)", function () {
    it("should have correct shebang line in src/cli/init.js", function () {
      const content = fs.readFileSync(
        path.join(__dirname, "..", "src", "cli", "init.js"),
        "utf8",
      );
      assert.ok(
        content.startsWith("#!/usr/bin/env node"),
        "init.js should start with #!/usr/bin/env node shebang",
      );
    });
  });

  // ---------------------------------------------------------------
  // printSummary() tests
  // ---------------------------------------------------------------
  describe("printSummary()", function () {
    it("should list all generated files in summary output (Req 13.1, 13.2)", function () {
      const logs = [];
      const origLog = console.log;
      console.log = function (...args) {
        logs.push(args.join(" "));
      };

      const { printSummary } = require("../src/cli/init.js");

      const generated = {
        files: [
          "app.js",
          ".env",
          ".env.example",
          "middleware/logger.js",
          "migrate.js",
          "add_migration.js",
          ".gitignore",
        ],
        migrationFiles: [
          "20250115103000_create_migrations_table.sql",
          "20250115103000_create_sessions_table.sql",
        ],
      };

      printSummary(generated);

      const output = logs.join("\n");
      console.log = origLog;

      // Verify all expected files are mentioned
      assert.ok(output.includes("app.js"), "Summary should mention app.js");
      assert.ok(output.includes(".env"), "Summary should mention .env");
      assert.ok(
        output.includes(".env.example"),
        "Summary should mention .env.example",
      );
      assert.ok(
        output.includes(".gitignore"),
        "Summary should mention .gitignore",
      );
      assert.ok(
        output.includes("migrate.js"),
        "Summary should mention migrate.js",
      );
      assert.ok(
        output.includes("add_migration.js"),
        "Summary should mention add_migration.js",
      );
      assert.ok(
        output.includes("logger.js"),
        "Summary should mention logger.js",
      );
      assert.ok(
        output.includes("migrations/"),
        "Summary should mention migrations/",
      );

      // Verify next-step instructions
      assert.ok(output.includes(".env"), "Summary should mention editing .env");
      assert.ok(
        output.includes("npm run dev"),
        "Summary should mention npm run dev",
      );
    });

    it("should include session migration in summary for SQL + database session", function () {
      const logs = [];
      const origLog = console.log;
      console.log = function (...args) {
        logs.push(args.join(" "));
      };

      const { printSummary } = require("../src/cli/init.js");

      const generated = {
        files: ["app.js", ".env"],
        migrationFiles: [
          "20250115103000_create_migrations_table.sql",
          "20250115103000_create_sessions_table.sql",
        ],
      };

      printSummary(generated);

      const output = logs.join("\n");
      console.log = origLog;

      assert.ok(
        output.includes("create_sessions_table"),
        "Summary should mention session migration for SQL + database session",
      );
    });

    it("should NOT include session migration in summary for NoSQL database", function () {
      const logs = [];
      const origLog = console.log;
      console.log = function (...args) {
        logs.push(args.join(" "));
      };

      const { printSummary } = require("../src/cli/init.js");

      const generated = {
        files: ["app.js", ".env"],
        migrationFiles: ["20250115103000_create_migrations_table.js"],
      };

      printSummary(generated);

      const output = logs.join("\n");
      console.log = origLog;

      assert.ok(
        !output.includes("create_sessions_table"),
        "Summary should NOT mention session migration for NoSQL database",
      );
    });
  });

  // ---------------------------------------------------------------
  // Ctrl+C handling tests
  // ---------------------------------------------------------------
  describe("Ctrl+C handling", function () {
    it("should handle prompt cancellation cleanly (Req 1.3)", function () {
      const initSrc = fs.readFileSync(
        path.join(__dirname, "..", "src", "cli", "init.js"),
        "utf8",
      );

      // Verify the try/catch around promptUser exists
      assert.ok(
        initSrc.includes("try") && initSrc.includes("promptUser"),
        "main() should have try/catch around promptUser",
      );
      assert.ok(
        initSrc.includes("Aborted"),
        "Should print Aborted message on Ctrl+C",
      );
      assert.ok(
        initSrc.includes("process.exit(1)"),
        "Should call process.exit(1) on Ctrl+C",
      );
    });
  });

  // ---------------------------------------------------------------
  // Malformed package.json error handling
  // ---------------------------------------------------------------
  describe("updatePackageJson() error handling", function () {
    let tmpDir;
    let origCwd;

    beforeEach(function () {
      tmpDir = makeTmpDir();
      origCwd = process.cwd();
      process.chdir(tmpDir);
    });

    afterEach(function () {
      process.chdir(origCwd);
      rmTmpDir(tmpDir);
    });

    it("should exit with code 1 on malformed package.json", function () {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        "{ invalid json !!! }",
      );

      let exitCode = null;
      const origExit = process.exit;
      process.exit = function (code) {
        exitCode = code;
        throw new Error("EXIT_" + code);
      };

      const errors = [];
      const origConsoleError = console.error;
      console.error = function (...args) {
        errors.push(args.join(" "));
      };

      const { updatePackageJson } = require("../src/cli/init.js");

      const answers = {
        framework: "express",
        database: "postgres",
        session: "memory",
        rateLimiting: false,
        helmet: false,
        logger: false,
      };

      try {
        updatePackageJson(answers);
      } catch (e) {
        // Expected — our fake process.exit throws
      }

      assert.strictEqual(
        exitCode,
        1,
        "Should exit with code 1 on malformed JSON",
      );
      const errorOutput = errors.join("\n");
      assert.ok(
        errorOutput.includes("invalid JSON") ||
          errorOutput.includes("package.json"),
        "Should mention JSON parse error",
      );

      // Restore
      process.exit = origExit;
      console.error = origConsoleError;
    });
  });

  // ---------------------------------------------------------------
  // generateFiles() tests with temp directory
  // ---------------------------------------------------------------
  describe("generateFiles()", function () {
    let tmpDir;
    let origCwd;

    beforeEach(function () {
      tmpDir = makeTmpDir();
      origCwd = process.cwd();
      process.chdir(tmpDir);
    });

    afterEach(function () {
      process.chdir(origCwd);
      rmTmpDir(tmpDir);
    });

    it("should create all expected files in the project directory", function () {
      const origLog = console.log;
      console.log = function () {};

      const { generateFiles } = require("../src/cli/init.js");

      const answers = {
        framework: "express",
        database: "postgres",
        session: "database",
        rateLimiting: true,
        helmet: true,
        logger: true,
      };

      generateFiles(answers);
      console.log = origLog;

      assert.ok(
        fs.existsSync(path.join(tmpDir, "app.js")),
        "app.js should exist",
      );
      assert.ok(fs.existsSync(path.join(tmpDir, ".env")), ".env should exist");
      assert.ok(
        fs.existsSync(path.join(tmpDir, ".env.example")),
        ".env.example should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, ".gitignore")),
        ".gitignore should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "commons", "migrate.js")),
        "commons/migrate.js should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "commons", "add_migration.js")),
        "commons/add_migration.js should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "commons", "session.js")),
        "commons/session.js should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "commons", "security.js")),
        "commons/security.js should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "route", "health.js")),
        "route/health.js should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "middleware", "logger.js")),
        "middleware/logger.js should exist",
      );
      assert.ok(
        fs.existsSync(path.join(tmpDir, "migrations")),
        "migrations/ should exist",
      );

      const migrationFiles = fs.readdirSync(path.join(tmpDir, "migrations"));
      assert.ok(
        migrationFiles.length >= 1,
        "Should have at least 1 migration file",
      );

      // For postgres + database session, should have 2 migration files
      assert.strictEqual(
        migrationFiles.length,
        2,
        "Should have 2 migration files (initial + session) for SQL + database session",
      );
    });

    it("should create only 1 migration file for NoSQL database", function () {
      const origLog = console.log;
      console.log = function () {};

      const { generateFiles } = require("../src/cli/init.js");

      const answers = {
        framework: "express",
        database: "mongodb",
        session: "database",
        rateLimiting: false,
        helmet: false,
        logger: false,
      };

      generateFiles(answers);
      console.log = origLog;

      const migrationFiles = fs.readdirSync(path.join(tmpDir, "migrations"));
      assert.strictEqual(
        migrationFiles.length,
        1,
        "NoSQL database should have only 1 migration file (no session migration)",
      );
    });
  });
});
