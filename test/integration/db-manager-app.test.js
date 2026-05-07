"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const supertest = require("supertest");

const createApp = require("../../db-manager/server");
const createMetadataDb = require("../../db-manager/metadata-db");
const sqliteAdapter = require("../../src/sqlite3/db");

describe("DB Manager App - Integration", function () {
  this.timeout(15000);

  let app, request, metaDb;
  let testDbPath, metaDbPath;

  before(function () {
    // Create temp SQLite DB for test data
    const tmpDir = os.tmpdir();
    testDbPath = path.join(tmpDir, `dbmanager-test-${Date.now()}.sqlite`);
    metaDbPath = path.join(tmpDir, `dbmanager-meta-${Date.now()}.sqlite`);

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
    // Clean up
    sqliteAdapter.disconnect();
    metaDb.close();

    // Remove temp files
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    } catch (_) {}
    try {
      if (fs.existsSync(metaDbPath)) fs.unlinkSync(metaDbPath);
    } catch (_) {}
    // WAL files
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

  describe("GET /api/tables", function () {
    it("should return a list of tables", async function () {
      const res = await request.get("/api/tables").expect(200);

      assert.ok(res.body.tables, "Response should have a tables property");
      assert.ok(Array.isArray(res.body.tables), "tables should be an array");
      assert.ok(
        res.body.tables.includes("users"),
        "tables should include 'users'",
      );
      assert.ok(
        res.body.tables.includes("products"),
        "tables should include 'products'",
      );
    });
  });

  describe("GET /api/tables/:name/rows", function () {
    it("should return paginated data for a table", async function () {
      const res = await request
        .get("/api/tables/users/rows?page=0&limit=10")
        .expect(200);

      assert.ok(Array.isArray(res.body.data), "data should be an array");
      assert.strictEqual(
        typeof res.body.count,
        "number",
        "count should be a number",
      );
      assert.strictEqual(res.body.page, 0, "page should be 0");
      assert.strictEqual(res.body.limit, 10, "limit should be 10");
      assert.ok(res.body.data.length > 0, "should have at least one row");
      assert.ok(res.body.data.length <= 10, "should not exceed limit");
      // Verify row shape
      const row = res.body.data[0];
      assert.ok("id" in row, "row should have id");
      assert.ok("name" in row, "row should have name");
      assert.ok("email" in row, "row should have email");
    });

    it("should respect pagination parameters", async function () {
      const res = await request
        .get("/api/tables/users/rows?page=0&limit=2")
        .expect(200);

      assert.strictEqual(res.body.data.length, 2, "should return 2 rows");
      assert.strictEqual(res.body.limit, 2, "limit should be 2");
    });
  });

  describe("POST /api/tables/:name/rows", function () {
    it("should insert a new row", async function () {
      const newUser = { name: "TestUser", email: "test@example.com" };
      const res = await request
        .post("/api/tables/users/rows")
        .send({ data: newUser })
        .expect(200);

      assert.ok(res.body.rows, "response should have rows count");
      assert.strictEqual(res.body.type, "success", "type should be success");
      assert.ok(res.body.id, "response should have an id");
      assert.ok(res.body.message, "response should have a message");

      // Verify the row was actually inserted
      const verify = await request
        .get("/api/tables/users/rows?page=0&limit=100")
        .expect(200);
      const found = verify.body.data.find(
        (r) => r.email === "test@example.com",
      );
      assert.ok(found, "inserted row should be retrievable");
      assert.strictEqual(found.name, "TestUser");
    });

    it("should return 400 when data is missing", async function () {
      const res = await request
        .post("/api/tables/users/rows")
        .send({})
        .expect(400);

      assert.ok(res.body.error, "response should indicate error");
      assert.ok(res.body.message, "response should have error message");
    });
  });

  describe("PUT /api/tables/:name/rows", function () {
    it("should update an existing row", async function () {
      const updatedData = {
        id: 1,
        name: "Alice Updated",
        email: "alice@example.com",
      };
      const res = await request
        .put("/api/tables/users/rows")
        .send({ data: updatedData, uniqueKeys: ["id"] })
        .expect(200);

      assert.ok(res.body.rows, "response should have rows count");
      assert.strictEqual(res.body.type, "success", "type should be success");

      // Verify the row was actually updated
      const verify = await request
        .get("/api/tables/users/rows?page=0&limit=100")
        .expect(200);
      const found = verify.body.data.find((r) => r.id === 1);
      assert.ok(found, "updated row should exist");
      assert.strictEqual(found.name, "Alice Updated");
    });

    it("should return 400 when data is missing", async function () {
      const res = await request
        .put("/api/tables/users/rows")
        .send({})
        .expect(400);

      assert.ok(res.body.error, "response should indicate error");
    });
  });

  describe("DELETE /api/tables/:name/rows", function () {
    it("should remove rows by primary key", async function () {
      // First insert a row to delete
      const insertRes = await request
        .post("/api/tables/products/rows")
        .send({ data: { name: "ToDelete", price: 1.0, stock: 1 } })
        .expect(200);

      const insertedId = insertRes.body.id;

      const res = await request
        .delete("/api/tables/products/rows")
        .send({ keys: [insertedId], pkColumn: "id" })
        .expect(200);

      assert.ok(res.body.message, "response should have a message");

      // Verify the row was actually deleted
      const verify = await request
        .get("/api/tables/products/rows?page=0&limit=100")
        .expect(200);
      const found = verify.body.data.find((r) => r.id === insertedId);
      assert.ok(!found, "deleted row should not be retrievable");
    });

    it("should return 400 when keys are missing", async function () {
      const res = await request
        .delete("/api/tables/products/rows")
        .send({})
        .expect(400);

      assert.ok(res.body.error, "response should indicate error");
    });

    it("should return 400 when pkColumn is missing", async function () {
      const res = await request
        .delete("/api/tables/products/rows")
        .send({ keys: [1] })
        .expect(400);

      assert.ok(res.body.error, "response should indicate error");
    });
  });

  describe("POST /api/tables/:name/export", function () {
    it("should return a CSV file download", async function () {
      const res = await request
        .post("/api/tables/users/export")
        .send({ keys: [1, 2], pkColumn: "id" })
        .expect(200);

      // Check Content-Disposition header
      const disposition = res.headers["content-disposition"];
      assert.ok(disposition, "should have Content-Disposition header");
      assert.ok(
        disposition.includes("users_"),
        "filename should contain table name",
      );
      assert.ok(
        disposition.includes(".csv"),
        "filename should have .csv extension",
      );

      // Check Content-Type
      assert.ok(
        res.headers["content-type"].includes("text/csv"),
        "content-type should be text/csv",
      );

      // Verify the response body is valid CSV with header row
      const lines = res.text.split("\r\n").filter((l) => l.length > 0);
      assert.ok(lines.length > 1, "CSV should have header and data rows");
      // Header should contain column names
      const header = lines[0];
      assert.ok(header.includes("id"), "CSV header should contain 'id' column");
    });

    it("should return 400 when keys are missing", async function () {
      const res = await request
        .post("/api/tables/users/export")
        .send({})
        .expect(400);

      assert.ok(res.body.error, "response should indicate error");
    });
  });

  describe("GET /", function () {
    it("should return an HTML page", async function () {
      const res = await request.get("/").expect(200);

      assert.ok(
        res.headers["content-type"].includes("text/html"),
        "content-type should be text/html",
      );
      assert.ok(res.text.includes("<html"), "response should contain HTML");
      assert.ok(
        res.text.includes("</html>"),
        "response should contain closing HTML tag",
      );
    });
  });
});
