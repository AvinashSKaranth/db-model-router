process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/oracle/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("Oracle Security & Clean Architecture Tests", function () {
  this.timeout(30000);

  before(async function () {
    db.connect({
      host: process.env.ORACLE_HOST || "localhost",
      port: parseInt(process.env.ORACLE_PORT || "1521"),
      database: process.env.ORACLE_DB || "freepdb1",
      user: process.env.ORACLE_USER || "system",
      password: process.env.ORACLE_PASSWORD || "oracle",
    });

    await db.query(
      `CREATE TABLE ${tableName} (
        id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title VARCHAR2(255) NOT NULL,
        "ORDER" NUMBER DEFAULT 0,
        "COMMENT" VARCHAR2(255),
        is_deleted NUMBER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );
  });

  after(async function () {
    try {
      await db.query(`DROP TABLE ${tableName}`);
    } catch (_) {}
    await db.disconnect();
  });

  it("should execute native Oracle queries directly without translation layer or ORACLE_NATIVE prefix", async function () {
    const res = await db.query(
      `INSERT INTO ${tableName} (title, "ORDER", "COMMENT") VALUES (:1, :2, :3)`,
      ["Native Query Test", 42, "Direct Oracle execution"],
    );
    assert.strictEqual(res.affectedRows, 1);

    const rows = await db.query(
      `SELECT title, "ORDER" AS ord, "COMMENT" AS cmt FROM ${tableName} WHERE title = :1`,
      ["Native Query Test"],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].title, "Native Query Test");
    assert.strictEqual(rows[0].ord, 42);
    assert.strictEqual(rows[0].cmt, "Direct Oracle execution");
  });

  it("should preserve literal '?' in SQL string literals without corrupting them or treating as binds", async function () {
    const res = await db.query(
      `INSERT INTO ${tableName} (title, "COMMENT") VALUES (:1, :2)`,
      ["Question Test", "Is this real? Yes!"],
    );
    assert.strictEqual(res.affectedRows, 1);

    // Query with literal '?' in single quotes AND a ? placeholder
    const rows = await db.query(
      `SELECT title, "COMMENT" AS cmt FROM ${tableName} WHERE "COMMENT" LIKE '%?%' AND title = ?`,
      ["Question Test"],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].title, "Question Test");
    assert.strictEqual(rows[0].cmt, "Is this real? Yes!");
  });

  it("should sanitize identifiers and prevent SQL injection through escapeId", function () {
    // Escaping simple identifier
    assert.strictEqual(db.escapeId("users"), '"USERS"');

    // Escaping reserved word
    assert.strictEqual(db.escapeId("order"), '"ORDER"');
    assert.strictEqual(db.escapeId("comment"), '"COMMENT"');

    // Escaping schema-qualified identifier
    assert.strictEqual(
      db.escapeId("system.users"),
      '"SYSTEM"."USERS"',
    );

    // Stripping null bytes
    assert.strictEqual(
      db.escapeId("col\0inject"),
      '"COLINJECT"',
    );

    // Escaping embedded double quotes
    assert.strictEqual(
      db.escapeId('col"name'),
      '"COL""NAME"',
    );
  });

  it("should escape column names in where() preventing SQL injection", function () {
    const injectionCol = 'title" OR 1=1 --';
    const whereData = db.where([[[injectionCol, "=", "val"]]]);
    assert.ok(whereData.query.includes('"TITLE"" OR 1=1 --"'));
    assert.strictEqual(whereData.value[0], "val");
  });

  it("should query tables and columns named with Oracle reserved words seamlessly", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        order: "integer",
        comment: "string",
      },
      "id",
      ["id"],
    );

    const inserted = await secModel.insert({
      title: "Reserved Word Test",
      order: 99,
      comment: "Works with reserved words",
    });
    assert.ok(inserted.id > 0);

    const found = await secModel.findOne({ order: 99 });
    assert.ok(found);
    assert.strictEqual(found.title, "Reserved Word Test");
    assert.strictEqual(found.order, 99);
  });

  it("should properly format sort orders and escape sort identifiers", function () {
    const sort = ["-order", "title", "id"];
    const sortData = db.sort_builder(sort);
    assert.strictEqual(
      sortData.query,
      'ORDER BY "ORDER" DESC,"TITLE" ASC,"ID" ASC',
    );
  });

  it("should correctly handle soft delete with safeDelete filter", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        order: "integer",
        comment: "string",
        is_deleted: "integer",
      },
      "id",
      ["id"],
      { safeDelete: "is_deleted" },
    );

    const record = await secModel.insert({
      title: "Soft Delete Item",
      comment: "Will be deleted",
    });
    assert.ok(record.id > 0);

    // Remove should soft-delete (set is_deleted = 1)
    await secModel.remove(record.id);

    // Query directly to verify it was marked as deleted
    const raw = await db.query(
      `SELECT is_deleted FROM ${tableName} WHERE id = :1`,
      [record.id],
    );
    assert.strictEqual(raw[0].is_deleted, 1);

    // byId should return null because of safeDelete filter
    const fetched = await secModel.byId(record.id);
    assert.strictEqual(fetched, null);
  });
});
