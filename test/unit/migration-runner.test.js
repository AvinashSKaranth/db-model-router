process.env.NODE_ENV = "TEST";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const db = require("../../src/sqlite3/db.js");
const {
  createMigrationFile,
  ensureMigrationTable,
  getAppliedMigrations,
  getMigrationFiles,
  up,
  down,
  status,
} = require("../../src/commons/migration-runner");

describe("Database Migrations Engine (migration-runner)", function () {
  const tmpBaseDir = path.join(__dirname, "..", "tmp_migrations_test");
  const createDir = path.join(tmpBaseDir, "create_test");
  const runnerDir = path.join(tmpBaseDir, "runner_test");

  before(function () {
    if (!fs.existsSync(createDir)) fs.mkdirSync(createDir, { recursive: true });
    if (!fs.existsSync(runnerDir)) fs.mkdirSync(runnerDir, { recursive: true });
    db.connect({ database: ":memory:" });
  });

  after(function () {
    try {
      db.disconnect();
    } catch (_) {}
    try {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("creates a timestamped migration template file", function () {
    const { fileName, fullPath } = createMigrationFile(
      "create_users_table",
      createDir,
    );
    assert(fs.existsSync(fullPath));
    assert(/_create_users_table\.js$/.test(fileName));

    const content = fs.readFileSync(fullPath, "utf-8");
    assert(content.includes("up: async (db) =>"));
    assert(content.includes("down: async (db) =>"));
  });

  it("ensures _dbmr_migrations tracking table exists", async function () {
    await ensureMigrationTable(db, "sqlite3");
    const applied = await getAppliedMigrations(db);
    assert(Array.isArray(applied));
    assert.strictEqual(applied.length, 0);
  });

  it("runs migrations forward (UP) in batches", async function () {
    // Migration 1: create products table
    const m1Path = path.join(runnerDir, "20260101000001_create_products.js");
    fs.writeFileSync(
      m1Path,
      `module.exports = {
        up: async (db) => {
          await db.query("CREATE TABLE products (id INTEGER PRIMARY KEY, title TEXT);");
        },
        down: async (db) => {
          await db.query("DROP TABLE IF EXISTS products;");
        }
      };`,
    );

    // Migration 2: create orders table
    const m2Path = path.join(runnerDir, "20260101000002_create_orders.js");
    fs.writeFileSync(
      m2Path,
      `module.exports = {
        up: async (db) => {
          await db.query("CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL);");
        },
        down: async (db) => {
          await db.query("DROP TABLE IF EXISTS orders;");
        }
      };`,
    );

    const res1 = await up(db, runnerDir, "sqlite3");
    assert.strictEqual(res1.applied.length, 2);
    assert.strictEqual(res1.batch, 1);

    // Verify tables created
    await db.query("INSERT INTO products (title) VALUES ('Book');");
    await db.query("INSERT INTO orders (total) VALUES (99.5);");

    const prods = await db.query("SELECT * FROM products");
    assert.strictEqual(prods.length, 1);
    assert.strictEqual(prods[0].title, "Book");

    // Re-running UP when up-to-date
    const res2 = await up(db, runnerDir, "sqlite3");
    assert.strictEqual(res2.applied.length, 0);

    // Add Migration 3: add sku column
    const m3Path = path.join(runnerDir, "20260101000003_add_sku.js");
    fs.writeFileSync(
      m3Path,
      `module.exports = {
        up: async (db) => {
          await db.query("ALTER TABLE products ADD COLUMN sku TEXT;");
        },
        down: async (db) => {
          // SQLite does not support DROP COLUMN in older versions; noop for test
        }
      };`,
    );

    const res3 = await up(db, runnerDir, "sqlite3");
    assert.strictEqual(res3.applied.length, 1);
    assert.strictEqual(res3.batch, 2);
  });

  it("checks migration status reporting", async function () {
    const list = await status(db, runnerDir, "sqlite3");
    assert.strictEqual(list.length, 3);
    assert.strictEqual(list[0].status, "Applied");
    assert.strictEqual(list[0].batch, 1);
    assert.strictEqual(list[1].status, "Applied");
    assert.strictEqual(list[1].batch, 1);
    assert.strictEqual(list[2].status, "Applied");
    assert.strictEqual(list[2].batch, 2);
  });

  it("rolls back the last batch with DOWN", async function () {
    const resDown1 = await down(db, runnerDir, "sqlite3");
    assert.strictEqual(resDown1.rolledBack.length, 1);
    assert.strictEqual(resDown1.batch, 2);

    const currentStatus = await status(db, runnerDir, "sqlite3");
    const m3 = currentStatus.find((s) => s.id === "20260101000003_add_sku");
    assert.strictEqual(m3.status, "Pending");
    assert.strictEqual(m3.batch, null);

    // Rollback batch 1
    const resDown2 = await down(db, runnerDir, "sqlite3");
    assert.strictEqual(resDown2.rolledBack.length, 2);
    assert.strictEqual(resDown2.batch, 1);

    // Verify orders table was dropped
    assert.throws(() => {
      db.query("SELECT * FROM orders");
    });
  });
});
