process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("SQLite3 Security & Architecture Tests", function () {
  before(function () {
    db.connect({ database: ":memory:" });

    db.query(
      `CREATE TABLE ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        "order" INTEGER DEFAULT 0,
        "group" TEXT,
        is_deleted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
    );
  });

  after(function () {
    try {
      db.query(`DROP TABLE IF EXISTS ${tableName}`);
    } catch (_) {}
    db.disconnect();
  });

  it("should sanitize identifiers and prevent SQL injection through escapeId", function () {
    assert.strictEqual(db.escapeId("users"), '"users"');
    assert.strictEqual(db.escapeId("main.users"), '"main"."users"');
    assert.strictEqual(db.escapeId("col\0inject"), '"colinject"');
    assert.strictEqual(db.escapeId('col"name'), '"col""name"');
  });

  it("should query tables and columns named with SQLite reserved words seamlessly", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        order: "integer",
        group: "string",
      },
      "id",
      ["id"],
    );

    const inserted = await secModel.insert({
      title: "Reserved Word Item",
      order: 10,
      group: "alpha",
    });
    assert.ok(inserted.id > 0);

    const found = await secModel.findOne({ order: 10 });
    assert.ok(found);
    assert.strictEqual(found.title, "Reserved Word Item");
    assert.strictEqual(found.group, "alpha");
  });

  it("should handle semicolons inside string literals without misidentifying as multi-statement", function () {
    const res = db.query(
      `INSERT INTO ${tableName} (title, "group") VALUES (?, ?)`,
      ["Semicolon; Test", "part1;part2"],
    );
    assert.strictEqual(res.changes, 1);

    const rows = db.query(
      `SELECT title, "group" as grp FROM ${tableName} WHERE title = ?`,
      ["Semicolon; Test"],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].grp, "part1;part2");
  });

  it("should format sort orders with escaped identifiers", function () {
    const sort = ["-order", "group", "id"];
    const sortData = db.sort_builder(sort);
    assert.strictEqual(
      sortData.query,
      'ORDER BY "order" DESC,"group" ASC,"id" ASC',
    );
  });

  it("should properly propagate database errors in qcount", function () {
    assert.throws(() => {
      db.qcount("nonexistent_table_xyz", []);
    });
  });

  it("should handle soft delete with safeDelete filter", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        order: "integer",
        is_deleted: "integer",
      },
      "id",
      ["id"],
      { safeDelete: "is_deleted" },
    );

    const rec = await secModel.insert({
      title: "Soft Delete SQLite",
      order: 5,
    });
    assert.ok(rec.id > 0);

    await secModel.remove(rec.id);

    const raw = db.query(
      `SELECT is_deleted FROM ${tableName} WHERE id = ?`,
      [rec.id],
    );
    assert.strictEqual(raw[0].is_deleted, 1);

    const byId = await secModel.byId(rec.id);
    assert.strictEqual(byId, null);
  });
});
