process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/postgres/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

const intTableName =
  "test_sec_int_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("PostgreSQL Security & Clean Architecture Tests", function () {
  this.timeout(15000);

  before(async function () {
    db.connect({
      host: process.env.PG_HOST || "localhost",
      port: parseInt(process.env.PG_PORT || "5432"),
      database: process.env.PG_DB || "test_db",
      user: process.env.PG_USER || "postgres",
      password: process.env.PG_PASSWORD || "password",
    });

    await db.query(
      `CREATE TABLE ${tableName} (
        id SERIAL PRIMARY KEY,
        title VARCHAR NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        notes TEXT,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );

    await db.query(
      `CREATE TABLE ${intTableName} (
        id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL,
        age INTEGER,
        is_deleted INTEGER DEFAULT 0
      )`,
    );
  });

  after(async function () {
    try {
      await db.query(`DROP TABLE IF EXISTS ${tableName}`);
      await db.query(`DROP TABLE IF EXISTS ${intTableName}`);
    } catch (_) {}
    await db.disconnect();
  });

  it("should execute native PostgreSQL queries directly without translation layer or PG_NATIVE prefix", async function () {
    const res = await db.query(
      `INSERT INTO ${tableName} (title, is_active, notes) VALUES ($1, $2, $3) RETURNING id, title`,
      ["Native Query Test", true, "Direct PG execution"],
    );
    assert.strictEqual(res.affectedRows, 1);
    assert.ok(res.insertId > 0);

    const rows = await db.query(
      `SELECT title, is_active FROM ${tableName} WHERE id = $1`,
      [res.insertId],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].title, "Native Query Test");
    assert.strictEqual(rows[0].is_active, true);
  });

  it("should handle native PostgreSQL JSONB operators without parameter mangling", async function () {
    const insertRes = await db.query(
      `INSERT INTO ${tableName} (title, data) VALUES ($1, $2) RETURNING id`,
      ["JSONB Test", JSON.stringify({ role: "admin", access: true })],
    );

    // Test JSONB ? operator (check if key exists in jsonb)
    const rows = await db.query(
      `SELECT title FROM ${tableName} WHERE id = $1 AND data ? $2`,
      [insertRes.insertId, "role"],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].title, "JSONB Test");
  });

  it("should sanitize identifiers and prevent SQL injection through escapeId", function () {
    // Escaping simple identifier
    assert.strictEqual(db.where([[["user", "=", "test"]]]).query, 'WHERE (("user" = $1))');

    // Escaping schema-qualified identifier
    assert.strictEqual(
      db.where([[["public.users", "=", "test"]]]).query,
      'WHERE (("public"."users" = $1))',
    );

    // Stripping null bytes
    assert.strictEqual(
      db.where([[["col\0inject", "=", "test"]]]).query,
      'WHERE (("colinject" = $1))',
    );

    // Double-quotes escaping
    assert.strictEqual(
      db.where([[["col\"name", "=", "test"]]]).query,
      'WHERE (("col\"\"name" = $1))',
    );
  });

  it("should preserve boolean types and empty strings without corrupting types", function () {
    const filter = [
      [
        ["is_active", "=", true],
        ["notes", "=", ""],
      ],
    ];
    const whereData = db.where(filter);
    assert.strictEqual(whereData.value[0], true, "boolean must remain boolean");
    assert.strictEqual(whereData.value[1], "", "empty string must not become null");
  });

  it("should properly format sort orders and escape sort identifiers", function () {
    const sort = ["-created_at", "+title", "id"];
    const sortData = db.sort_builder(sort);
    assert.strictEqual(
      sortData.query,
      'ORDER BY "created_at" DESC, "title" ASC, "id" ASC',
    );
  });

  it("should correctly handle soft delete with boolean column", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        is_active: "boolean",
        notes: "string",
      },
      "id",
      ["id"],
      { safeDelete: "is_active" },
    );

    const record = await secModel.insert({
      title: "Soft Delete Item",
      notes: "Will be deleted",
    });
    assert.ok(record.id > 0);

    // Remove should soft-delete
    await secModel.remove(record.id);

    // Query directly to verify it was set to true (soft-deleted)
    const raw = await db.query(`SELECT is_active FROM ${tableName} WHERE id = $1`, [
      record.id,
    ]);
    assert.strictEqual(raw[0].is_active, true);

    // byId should return null because of safeDelete filter
    const fetched = await secModel.byId(record.id);
    assert.strictEqual(fetched, null);
  });

  it("should correctly handle soft delete with integer column (safeDelete = 0/1)", async function () {
    const intModel = model(
      db,
      intTableName,
      {
        id: "integer",
        name: "required|string",
        age: "integer",
        is_deleted: "integer",
      },
      "id",
      ["id"],
      { safeDelete: "is_deleted" },
    );

    const record = await intModel.insert({
      name: "Integer Soft Delete User",
      age: 30,
      is_deleted: 0,
    });
    assert.ok(record.id > 0);

    // Verify it can be fetched before deletion
    const active = await intModel.byId(record.id);
    assert.strictEqual(active.name, "Integer Soft Delete User");

    // Remove should soft-delete (setting integer is_deleted = 1)
    await intModel.remove(record.id);

    // Direct query to verify it was set to 1 (not boolean true)
    const raw = await db.query(`SELECT is_deleted FROM ${intTableName} WHERE id = $1`, [
      record.id,
    ]);
    assert.strictEqual(raw[0].is_deleted, 1);

    // byId and list should return null / empty because safeDelete binds 0 (not false)
    const fetched = await intModel.byId(record.id);
    assert.strictEqual(fetched, null);

    const listResult = await intModel.list({ name: "Integer Soft Delete User" });
    assert.strictEqual(listResult.data.length, 0);
  });

  it("should coerce empty string and boolean filters on integer/numeric columns without 500", async function () {
    const intModel = model(
      db,
      intTableName,
      {
        id: "integer",
        name: "required|string",
        age: "integer",
        is_deleted: "integer",
      },
      "id",
      ["id"],
    );

    // Empty string filter on integer column (like GET /users?age=) should coerce to null without throwing 22P02
    const resEmpty = await intModel.list({ age: "" });
    assert.ok(Array.isArray(resEmpty.data));

    // Boolean filter on integer column should coerce to 1/0 without throwing 22P02
    const resBool = await intModel.list({ age: true });
    assert.ok(Array.isArray(resBool.data));
  });
});
