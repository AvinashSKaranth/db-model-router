process.env.NODE_ENV = "TEST";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const migrateCreate = require("../../src/cli/commands/migrate-create");
const migrateUp = require("../../src/cli/commands/migrate-up");
const migrateStatus = require("../../src/cli/commands/migrate-status");
const migrateDown = require("../../src/cli/commands/migrate-down");

describe("Database Migration CLI Commands (migrate:*)", function () {
  const tmpCliDir = path.join(__dirname, "..", "tmp_migrate_cli_test");
  const testDbFile = path.join(tmpCliDir, "cli_test.db");

  before(function () {
    if (!fs.existsSync(tmpCliDir)) {
      fs.mkdirSync(tmpCliDir, { recursive: true });
    }
  });

  after(async function () {
    try {
      await require("../../src/sqlite3/db.js").disconnect();
    } catch (_) {}
    try {
      fs.rmSync(tmpCliDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("executes migrate:create via CLI", async function () {
    const exitCode = await migrateCreate({
      _: ["migrate:create", "add_test_table"],
      dir: tmpCliDir,
    });
    assert.strictEqual(exitCode, 0);

    const files = fs.readdirSync(tmpCliDir);
    const created = files.find((f) => f.includes("add_test_table"));
    assert(created, "Migration file should have been created");

    // Write a real table creation into the created file so migrate:up can run it
    const fullPath = path.join(tmpCliDir, created);
    fs.writeFileSync(
      fullPath,
      `module.exports = {
        up: async (db) => {
          await db.query("CREATE TABLE cli_test (id INTEGER PRIMARY KEY, note TEXT);");
        },
        down: async (db) => {
          await db.query("DROP TABLE IF EXISTS cli_test;");
        }
      };`,
    );
  });

  it("executes migrate:up and migrate:status via CLI", async function () {
    // Set DB_NAME to testDbFile
    process.env.DB_NAME = testDbFile;
    process.env.DB_TYPE = "sqlite3";

    const upExit = await migrateUp({
      type: "sqlite3",
      dir: tmpCliDir,
    });
    assert.strictEqual(upExit, 0);

    const statusExit = await migrateStatus({
      type: "sqlite3",
      dir: tmpCliDir,
    });
    assert.strictEqual(statusExit, 0);
  });

  it("executes migrate:down via CLI", async function () {
    process.env.DB_NAME = testDbFile;
    process.env.DB_TYPE = "sqlite3";

    const downExit = await migrateDown({
      type: "sqlite3",
      dir: tmpCliDir,
    });
    assert.strictEqual(downExit, 0);
  });
});
