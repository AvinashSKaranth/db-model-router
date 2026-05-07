"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const supertest = require("supertest");

const createApp = require("../../db-manager/server");
const createMetadataDb = require("../../db-manager/metadata-db");
const sqliteAdapter = require("../../src/sqlite3/db");

describe("POST /api/query - Execute custom SQL", function () {
  this.timeout(15000);

  let app, request, metaDb;
  let testDbPath, metaDbPath;

  before(function () {
    const tmpDir = os.tmpdir();
    testDbPath = path.join(tmpDir, `api-query-test-${Date.now()}.sqlite`);
    metaDbPath = path.join(tmpDir, `api-query-meta-${Date.now()}.sqlite`);

    // Connect the sqlite3 adapter to the temp DB
    sqliteAdapter.connect({ database: testDbPath });

    // Run seed SQL against the test database
    const seedSql = fs.readFileSync(
      path.join(__dirname, "../../db-manager/demo/seeds/sqlite3.sql"),
      "utf8",
    );
    sqliteAdapter.query(seedSql);

    // Create metadata DB
    metaDb = createMetadataDb(metaDbPath);
    metaDb.init();
    metaDb._connectionId = metaDb.recordConnection("sqlite3", null, "test-db");

    // Create Express app
    app = createApp(sqliteAdapter, metaDb, "sqlite3");
    request = supertest(app);
  });

  after(function () {
    sqliteAdapter.disconnect();
    metaDb.close();

    // Remove temp files
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    } catch (_) {}
    try {
      if (fs.existsSync(metaDbPath)) fs.unlinkSync(metaDbPath);
    } catch (_) {}
    try {
      if (fs.existsSync(testDbPath + "-wal"))
        fs.unlinkSync(testDbPath + "-wal");
    } catch (_) {}
    try {
      if (fs.existsSync(testDbPath + "-shm"))
        fs.unlinkSync(testDbPath + "-shm");
    } catch (_) {}
    try {
      if (fs.existsSync(metaDbPath + "-wal"))
        fs.unlinkSync(metaDbPath + "-wal");
    } catch (_) {}
    try {
      if (fs.existsSync(metaDbPath + "-shm"))
        fs.unlinkSync(metaDbPath + "-shm");
    } catch (_) {}
  });

  it("should return columns, data, and rowCount on successful SELECT query", async function () {
    const res = await request
      .post("/api/query")
      .send({ query: "SELECT id, name, email FROM users" })
      .expect(200);

    assert.ok(Array.isArray(res.body.columns), "columns should be an array");
    assert.ok(Array.isArray(res.body.data), "data should be an array");
    assert.strictEqual(
      typeof res.body.rowCount,
      "number",
      "rowCount should be a number",
    );
    assert.deepStrictEqual(res.body.columns, ["id", "name", "email"]);
    assert.strictEqual(res.body.rowCount, res.body.data.length);
    assert.ok(res.body.rowCount > 0, "should have at least one row");
  });

  it("should return empty columns and data for a query with no results", async function () {
    const res = await request
      .post("/api/query")
      .send({ query: "SELECT * FROM users WHERE id = -999" })
      .expect(200);

    assert.deepStrictEqual(res.body.columns, []);
    assert.deepStrictEqual(res.body.data, []);
    assert.strictEqual(res.body.rowCount, 0);
  });

  it("should return 400 when query field is missing", async function () {
    const res = await request.post("/api/query").send({}).expect(400);

    assert.strictEqual(res.body.error, true);
    assert.ok(res.body.message, "should have an error message");
    assert.ok(
      res.body.message.includes("query"),
      "message should mention 'query'",
    );
  });

  it("should return 400 when query field is empty string", async function () {
    const res = await request
      .post("/api/query")
      .send({ query: "" })
      .expect(400);

    assert.strictEqual(res.body.error, true);
    assert.ok(res.body.message, "should have an error message");
  });

  it("should return 500 with error message on invalid SQL", async function () {
    const res = await request
      .post("/api/query")
      .send({ query: "SELECT * FROM nonexistent_table_xyz" })
      .expect(500);

    assert.strictEqual(res.body.error, true);
    assert.ok(res.body.message, "should have an error message");
  });

  it("should record successful query in metadata DB", async function () {
    const queryText = "SELECT id, name FROM users LIMIT 5";
    await request.post("/api/query").send({ query: queryText }).expect(200);

    // Check that the query was recorded in the metadata DB
    const queries = metaDb.getQueries(metaDb._connectionId);
    const recorded = queries.find((q) => q.query_text === queryText);
    assert.ok(recorded, "query should be recorded in metadata DB");
    assert.strictEqual(
      recorded.row_count,
      5,
      "row_count should match result count",
    );
  });
});
