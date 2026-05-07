"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");

/**
 * Helper: create a temp directory and return its path.
 */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-dbmanager-test-"));
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
 * Helper: find a free port to avoid EADDRINUSE conflicts.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

describe("CLI Commands - db-manager (src/cli/commands/db-manager.js)", function () {
  let tmpDir;
  let origCwd;
  let dbManagerCmd;

  beforeEach(function () {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
    process.exitCode = 0;

    // Clear cached env vars that might leak between tests
    delete process.env.DB_TYPE;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASS;
    delete process.env.DB_PORT;

    // Clear require cache for the command module and its dependencies
    delete require.cache[require.resolve("../../src/cli/commands/db-manager")];
    delete require.cache[require.resolve("../../src/index")];
    dbManagerCmd = require("../../src/cli/commands/db-manager");
  });

  afterEach(function () {
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    delete require.cache[require.resolve("../../src/cli/commands/db-manager")];
    delete require.cache[require.resolve("../../src/index")];
    process.exitCode = 0;

    // Clean up env vars
    delete process.env.DB_TYPE;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASS;
    delete process.env.DB_PORT;
  });

  // -------------------------------------------------------------------
  // Requirement 1.6: Missing env file prints error and sets exit code
  // -------------------------------------------------------------------
  describe("missing env file (Req 1.6)", function () {
    it("should print error and set exit code when env file does not exist", async function () {
      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };
      const nonExistentPath = path.join(tmpDir, "nonexistent.env");

      await dbManagerCmd(
        { env: nonExistentPath },
        { yes: false, json: false, dryRun: false },
        ctx,
      );

      assert.strictEqual(process.exitCode, 1, "Should set exit code to 1");
      assert.strictEqual(logs.length, 1, "Should log exactly one message");
      assert.ok(
        logs[0].includes("Environment file not found"),
        `Error message should contain "Environment file not found", got: "${logs[0]}"`,
      );
    });

    it("should include the resolved file path in the error message", async function () {
      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };
      const fakePath = path.join(tmpDir, "missing-file.env");

      await dbManagerCmd(
        { env: fakePath },
        { yes: false, json: false, dryRun: false },
        ctx,
      );

      assert.strictEqual(process.exitCode, 1);
      // The handler resolves the path, so check for the resolved version
      const resolvedPath = path.resolve(fakePath);
      assert.ok(
        logs[0].includes(resolvedPath),
        `Error message should contain the resolved file path "${resolvedPath}", got: "${logs[0]}"`,
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 1.2, 1.4: Missing DB_TYPE prints error and sets exit code
  // -------------------------------------------------------------------
  describe("missing DB_TYPE (Req 1.2, 1.4)", function () {
    it("should print error and set exit code when env file has no DB_TYPE", async function () {
      // Create a .env file without DB_TYPE
      const envFile = path.join(tmpDir, "test.env");
      fs.writeFileSync(envFile, "DB_HOST=localhost\nDB_NAME=testdb\n");

      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };

      await dbManagerCmd(
        { env: envFile },
        { yes: false, json: false, dryRun: false },
        ctx,
      );

      assert.strictEqual(process.exitCode, 1, "Should set exit code to 1");
      assert.strictEqual(logs.length, 1, "Should log exactly one message");
      assert.ok(
        logs[0].includes("DB_TYPE not specified"),
        `Error message should contain "DB_TYPE not specified", got: "${logs[0]}"`,
      );
    });

    it("should include the env file path in the DB_TYPE error message", async function () {
      const envFile = path.join(tmpDir, "custom.env");
      fs.writeFileSync(envFile, "DB_NAME=mydb\n");

      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };

      await dbManagerCmd(
        { env: envFile },
        { yes: false, json: false, dryRun: false },
        ctx,
      );

      assert.strictEqual(process.exitCode, 1);
      const resolvedPath = path.resolve(envFile);
      assert.ok(
        logs[0].includes(resolvedPath),
        `Error message should contain the env file path "${resolvedPath}", got: "${logs[0]}"`,
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 1.5: Default port is 4000
  // -------------------------------------------------------------------
  describe("default port (Req 1.5)", function () {
    it("should default to port 4000 when --port flag is not provided", async function () {
      // We test this by verifying the handler's port parsing logic.
      // Since actually binding to port 4000 may conflict, we test the
      // validation path: create an env that will fail at adapter init
      // but after port parsing. Instead, we verify the log output
      // mentions port 4000 by using a port that's free.

      // Actually, the simplest approach: verify the handler uses 4000
      // by checking the log output. We need to start a real server.
      // Use a free port approach: we'll test that without --port, the
      // handler attempts to listen on 4000.
      // To avoid conflicts, we'll just verify the code path by checking
      // that the handler's internal port variable defaults to 4000.
      // We can do this by observing the log message.

      const envFile = path.join(tmpDir, "test.env");
      fs.writeFileSync(envFile, "DB_TYPE=sqlite3\nDB_NAME=:memory:\n");

      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };

      // Use a wrapper to intercept the listen call
      const express = require("express");
      const origListen = express.application.listen;
      let listenPort = null;
      let serverInstance = null;

      express.application.listen = function (port, cb) {
        listenPort = port;
        serverInstance = origListen.call(this, 0, cb); // bind to random port to avoid conflicts
        return serverInstance;
      };

      try {
        await dbManagerCmd(
          { env: envFile },
          { yes: false, json: false, dryRun: false },
          ctx,
        );

        // Wait briefly for the listen callback to fire
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.strictEqual(
          listenPort,
          4000,
          "Should attempt to listen on default port 4000",
        );
      } finally {
        express.application.listen = origListen;
        if (serverInstance) {
          serverInstance.close();
        }
      }
    });
  });

  // -------------------------------------------------------------------
  // Requirement 1.3: --port flag overrides default
  // -------------------------------------------------------------------
  describe("--port flag (Req 1.3)", function () {
    it("should use the specified port when --port flag is provided", async function () {
      const envFile = path.join(tmpDir, "test.env");
      fs.writeFileSync(envFile, "DB_TYPE=sqlite3\nDB_NAME=:memory:\n");

      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };

      const express = require("express");
      const origListen = express.application.listen;
      let listenPort = null;
      let serverInstance = null;

      express.application.listen = function (port, cb) {
        listenPort = port;
        serverInstance = origListen.call(this, 0, cb); // bind to random port
        return serverInstance;
      };

      try {
        await dbManagerCmd(
          { env: envFile, port: "8080" },
          { yes: false, json: false, dryRun: false },
          ctx,
        );

        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.strictEqual(
          listenPort,
          8080,
          "Should attempt to listen on specified port 8080",
        );
      } finally {
        express.application.listen = origListen;
        if (serverInstance) {
          serverInstance.close();
        }
      }
    });
  });

  // -------------------------------------------------------------------
  // Requirement 1.2: --env flag specifies env file path
  // -------------------------------------------------------------------
  describe("--env flag (Req 1.2)", function () {
    it("should read from the specified env file path", async function () {
      // Create env file at a custom nested path
      const customEnvPath = path.join(tmpDir, "custom", "my.env");
      fs.mkdirSync(path.join(tmpDir, "custom"), { recursive: true });
      fs.writeFileSync(customEnvPath, "DB_TYPE=sqlite3\nDB_NAME=:memory:\n");

      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };

      const express = require("express");
      const origListen = express.application.listen;
      let serverInstance = null;

      express.application.listen = function (port, cb) {
        serverInstance = origListen.call(this, 0, cb);
        return serverInstance;
      };

      try {
        await dbManagerCmd(
          { env: customEnvPath },
          { yes: false, json: false, dryRun: false },
          ctx,
        );

        await new Promise((resolve) => setTimeout(resolve, 100));

        // If it read the env file successfully, it should start the server
        // (not error about missing file or missing DB_TYPE)
        assert.notStrictEqual(
          process.exitCode,
          1,
          "Should not set exit code to 1",
        );
        const portLog = logs.find((l) => l.includes("DB Manager running at"));
        assert.ok(
          portLog,
          "Should successfully start the server when --env points to a valid file",
        );
      } finally {
        express.application.listen = origListen;
        if (serverInstance) {
          serverInstance.close();
        }
      }
    });

    it("should error when --env points to a non-existent file", async function () {
      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };

      await dbManagerCmd(
        { env: path.join(tmpDir, "does-not-exist.env") },
        { yes: false, json: false, dryRun: false },
        ctx,
      );

      assert.strictEqual(process.exitCode, 1);
      assert.ok(logs[0].includes("Environment file not found"));
    });
  });
});
