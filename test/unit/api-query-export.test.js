"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const supertest = require("supertest");

const createApp = require("../../db-manager/server");
const createMetadataDb = require("../../db-manager/metadata-db");
const sqliteAdapter = require("../../src/sqlite3/db");

describe("POST /api/query/export - Export query results as CSV", function () {
  this.timeout(15000);

  let app, request, metaDb;
  let testDbPath, metaDbPath;

  before(function () {
    const tmpDir = os.tmpdir();
    testDbPath = path.join(
      tmpDir,
      `api-query-export-test-${Date.now()}.sqlite`,
    );
    metaDbPath = path.join(
      tmpDir,
      `api-query-export-meta-${Date.now()}.sqlite`,
    );

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

  it("should return CSV with correct Content-Type header", async function () {
    const res = await request
      .post("/api/query/export")
      .send({ query: "SELECT id, name, email FROM users" })
      .expect(200)
      .expect("Content-Type", /text\/csv/);

    assert.ok(res.text, "response body should contain CSV text");
  });

  it("should set Content-Disposition with export_{timestamp}.csv filename", async function () {
    const res = await request
      .post("/api/query/export")
      .send({ query: "SELECT id, name FROM users" })
      .expect(200);

    const disposition = res.headers["content-disposition"];
    assert.ok(disposition, "Content-Disposition header should be set");
    assert.ok(disposition.startsWith("attachment;"), "should be an attachment");
    // Filename should match export_{YYYYMMDDTHHmmss}.csv pattern
    const filenameMatch = disposition.match(
      /filename="(export_\d{8}T\d{6}\.csv)"/,
    );
    assert.ok(
      filenameMatch,
      "filename should match export_{YYYYMMDDTHHmmss}.csv pattern",
    );
  });

  it("should include header row with column names in CSV output", async function () {
    const res = await request
      .post("/api/query/export")
      .send({ query: "SELECT id, name, email FROM users" })
      .expect(200);

    const lines = res.text.split("\r\n");
    assert.strictEqual(
      lines[0],
      "id,name,email",
      "first line should be column headers",
    );
  });

  it("should include data rows in CSV output", async function () {
    const res = await request
      .post("/api/query/export")
      .send({ query: "SELECT id, name FROM users LIMIT 2" })
      .expect(200);

    const lines = res.text.split("\r\n").filter((l) => l.length > 0);
    // Header + at least 2 data rows
    assert.ok(lines.length >= 3, "should have header + at least 2 data rows");
  });

  it("should return CSV with empty body (header only) for query with no results", async function () {
    const res = await request
      .post("/api/query/export")
      .send({ query: "SELECT * FROM users WHERE id = -999" })
      .expect(200);

    // When no rows, columns are empty so CSV is just a CRLF (empty header)
    assert.strictEqual(
      res.text,
      "\r\n",
      "should return minimal CSV for empty result",
    );
  });

  it("should return 400 when query field is missing", async function () {
    const res = await request.post("/api/query/export").send({}).expect(400);

    assert.strictEqual(res.body.error, true);
    assert.ok(res.body.message, "should have an error message");
    assert.ok(
      res.body.message.includes("query"),
      "message should mention 'query'",
    );
  });

  it("should return 400 when query field is empty string", async function () {
    const res = await request
      .post("/api/query/export")
      .send({ query: "" })
      .expect(400);

    assert.strictEqual(res.body.error, true);
    assert.ok(res.body.message, "should have an error message");
  });

  it("should return 500 with error message on invalid SQL", async function () {
    const res = await request
      .post("/api/query/export")
      .send({ query: "SELECT * FROM nonexistent_table_xyz" })
      .expect(500);

    assert.strictEqual(res.body.error, true);
    assert.ok(res.body.message, "should have an error message");
  });
});
