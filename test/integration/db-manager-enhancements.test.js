"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const supertest = require("supertest");

const createApp = require("../../db-manager/server");
const createMetadataDb = require("../../db-manager/metadata-db");
const sqliteAdapter = require("../../src/sqlite3/db");

describe("DB Manager Enhancements - Integration", function () {
  this.timeout(15000);

  let app, request, metaDb;
  let testDbPath, metaDbPath;

  before(function () {
    const tmpDir = os.tmpdir();
    testDbPath = path.join(tmpDir, `enhancements-test-${Date.now()}.sqlite`);
    metaDbPath = path.join(tmpDir, `enhancements-meta-${Date.now()}.sqlite`);

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

  // =========================================================================
  // 9.1 Filter + Pagination
  // Validates: Requirements 5.3, 5.4, 10.1, 10.4
  // =========================================================================
  describe("Filter + Pagination", function () {
    it("should return filtered results when filter[name] is applied", async function () {
      const res = await request
        .get("/api/tables/users/rows?filter[name]=Ali")
        .expect(200);

      assert.ok(Array.isArray(res.body.data), "data should be an array");
      assert.ok(res.body.count > 0, "filtered count should be > 0");
      // All returned rows should have 'Ali' (case-insensitive) in the name
      for (const row of res.body.data) {
        assert.ok(
          row.name.toLowerCase().includes("ali"),
          `Expected name "${row.name}" to contain "ali"`,
        );
      }
    });

    it("should return paginated filtered results", async function () {
      const res = await request
        .get("/api/tables/users/rows?filter[name]=Ali&page=0&limit=1")
        .expect(200);

      assert.ok(Array.isArray(res.body.data), "data should be an array");
      assert.ok(res.body.data.length <= 1, "should return at most 1 row");
      assert.strictEqual(res.body.page, 0);
      assert.strictEqual(res.body.limit, 1);
      // count should reflect total filtered rows, not just the page
      assert.ok(
        res.body.count >= res.body.data.length,
        "count should be >= page data length",
      );
    });

    it("should apply multiple filters with AND logic", async function () {
      // Filter for name containing 'a' AND email containing 'example'
      const res = await request
        .get("/api/tables/users/rows?filter[name]=a&filter[email]=example")
        .expect(200);

      assert.ok(Array.isArray(res.body.data), "data should be an array");
      for (const row of res.body.data) {
        assert.ok(
          row.name.toLowerCase().includes("a"),
          `Expected name "${row.name}" to contain "a"`,
        );
        assert.ok(
          row.email.toLowerCase().includes("example"),
          `Expected email "${row.email}" to contain "example"`,
        );
      }
    });

    it("should return all rows when no filter is applied", async function () {
      const res = await request.get("/api/tables/users/rows").expect(200);

      assert.ok(Array.isArray(res.body.data), "data should be an array");
      // Seed has 5 users
      assert.strictEqual(res.body.count, 5, "should return all 5 seeded users");
    });

    it("should return correct filtered count for pagination", async function () {
      // First get the full filtered count
      const fullRes = await request
        .get("/api/tables/users/rows?filter[name]=e")
        .expect(200);

      const totalFiltered = fullRes.body.count;
      assert.ok(totalFiltered > 0, "should have filtered results");

      // Now paginate with limit=1 and verify count is still the total
      const pageRes = await request
        .get("/api/tables/users/rows?filter[name]=e&page=0&limit=1")
        .expect(200);

      assert.strictEqual(
        pageRes.body.count,
        totalFiltered,
        "paginated count should equal total filtered count",
      );
    });
  });

  // =========================================================================
  // 9.2 Query Execution
  // Validates: Requirements 11.1, 11.2, 11.3
  // =========================================================================
  describe("Query Execution", function () {
    it("should return columns, data, and rowCount for valid SELECT", async function () {
      const res = await request
        .post("/api/query")
        .send({ query: "SELECT id, name FROM users" })
        .expect(200);

      assert.ok(Array.isArray(res.body.columns), "columns should be an array");
      assert.ok(Array.isArray(res.body.data), "data should be an array");
      assert.strictEqual(
        typeof res.body.rowCount,
        "number",
        "rowCount should be a number",
      );
      assert.deepStrictEqual(res.body.columns, ["id", "name"]);
      assert.strictEqual(res.body.rowCount, res.body.data.length);
      assert.ok(res.body.rowCount > 0, "should have results");
    });

    it("should return 500 with error for invalid SQL", async function () {
      const res = await request
        .post("/api/query")
        .send({ query: "SELECT * FROM nonexistent_table_xyz" })
        .expect(500);

      assert.strictEqual(res.body.error, true);
      assert.ok(res.body.message, "should have an error message");
    });

    it("should return 400 when query field is missing (empty body)", async function () {
      const res = await request.post("/api/query").send({}).expect(400);

      assert.strictEqual(res.body.error, true);
      assert.ok(
        res.body.message.toLowerCase().includes("query"),
        "message should mention query",
      );
    });
  });

  // =========================================================================
  // 9.3 CSV Export
  // Validates: Requirements 1.1, 1.3, 1.5, 1.6
  // =========================================================================
  describe("CSV Export", function () {
    it("should return CSV with correct Content-Type for table export", async function () {
      const res = await request
        .post("/api/tables/users/export")
        .send({ keys: [1, 2], pkColumn: "id" })
        .expect(200);

      assert.ok(
        res.headers["content-type"].includes("text/csv"),
        `Expected Content-Type to include text/csv, got: ${res.headers["content-type"]}`,
      );
    });

    it("should set Content-Disposition with correct filename pattern for table export", async function () {
      const res = await request
        .post("/api/tables/users/export")
        .send({ keys: [1], pkColumn: "id" })
        .expect(200);

      const disposition = res.headers["content-disposition"];
      assert.ok(disposition, "Content-Disposition header should be set");
      assert.ok(disposition.includes("attachment"), "should be an attachment");
      // Filename should match: users_{YYYYMMDDTHHmmss}.csv
      const filenameMatch = disposition.match(/filename="(.+?)"/);
      assert.ok(filenameMatch, "should have a filename in Content-Disposition");
      const filename = filenameMatch[1];
      assert.ok(
        /^users_\d{8}T\d{6}\.csv$/.test(filename),
        `Filename "${filename}" should match pattern users_YYYYMMDDTHHmmss.csv`,
      );
    });

    it("should return CSV body with header row and data rows", async function () {
      const res = await request
        .post("/api/tables/users/export")
        .send({ keys: [1, 2], pkColumn: "id" })
        .expect(200);

      const csvBody = res.text;
      const lines = csvBody.split("\n").filter((l) => l.trim().length > 0);
      // First line is the header
      assert.ok(lines.length >= 2, "should have header + at least 1 data row");
      const header = lines[0];
      assert.ok(header.includes("id"), "header should contain 'id' column");
      assert.ok(header.includes("name"), "header should contain 'name' column");
      assert.ok(
        header.includes("email"),
        "header should contain 'email' column",
      );
    });

    it("should return CSV for query export with correct filename pattern", async function () {
      const res = await request
        .post("/api/query/export")
        .send({ query: "SELECT id, name FROM users LIMIT 2" })
        .expect(200);

      assert.ok(
        res.headers["content-type"].includes("text/csv"),
        "Content-Type should be text/csv",
      );

      const disposition = res.headers["content-disposition"];
      assert.ok(disposition, "Content-Disposition header should be set");
      const filenameMatch = disposition.match(/filename="(.+?)"/);
      assert.ok(filenameMatch, "should have a filename");
      const filename = filenameMatch[1];
      assert.ok(
        /^export_\d{8}T\d{6}\.csv$/.test(filename),
        `Filename "${filename}" should match pattern export_YYYYMMDDTHHmmss.csv`,
      );

      // Verify CSV body
      const lines = res.text.split("\n").filter((l) => l.trim().length > 0);
      assert.ok(lines.length >= 2, "should have header + data rows");
      assert.ok(lines[0].includes("id"), "header should contain 'id'");
      assert.ok(lines[0].includes("name"), "header should contain 'name'");
    });
  });

  // =========================================================================
  // 9.4 Dashboard Endpoint
  // Validates: Requirements 8.3, 8.4, 8.5, 8.6
  // =========================================================================
  describe("Dashboard Endpoint", function () {
    it("should return 200 with tables array", async function () {
      const res = await request.get("/api/dashboard").expect(200);

      assert.ok(Array.isArray(res.body.tables), "tables should be an array");
      assert.ok(res.body.tables.length > 0, "should have at least one table");
    });

    it("should include all seeded tables", async function () {
      const res = await request.get("/api/dashboard").expect(200);

      const tableNames = res.body.tables.map((t) => t.name);
      assert.ok(tableNames.includes("users"), "should include users table");
      assert.ok(
        tableNames.includes("products"),
        "should include products table",
      );
    });

    it("should include columnCount and rowCount for each table", async function () {
      const res = await request.get("/api/dashboard").expect(200);

      for (const table of res.body.tables) {
        assert.ok(table.name, "each table should have a name");
        assert.strictEqual(
          typeof table.columnCount,
          "number",
          `columnCount for "${table.name}" should be a number`,
        );
        assert.strictEqual(
          typeof table.rowCount,
          "number",
          `rowCount for "${table.name}" should be a number`,
        );
        assert.ok(
          table.columnCount > 0,
          `columnCount for "${table.name}" should be > 0`,
        );
      }
    });

    it("should return correct row counts for seeded tables", async function () {
      const res = await request.get("/api/dashboard").expect(200);

      const usersTable = res.body.tables.find((t) => t.name === "users");
      const productsTable = res.body.tables.find((t) => t.name === "products");

      assert.ok(usersTable, "users table should be present");
      assert.ok(productsTable, "products table should be present");
      // Seed inserts 5 users and 5 products
      assert.strictEqual(usersTable.rowCount, 5, "users should have 5 rows");
      assert.strictEqual(
        productsTable.rowCount,
        5,
        "products should have 5 rows",
      );
    });
  });

  // =========================================================================
  // 9.5 Sort Parameter Passing
  // Validates: Requirements 6.1, 6.2
  // =========================================================================
  describe("Sort Parameter Passing", function () {
    it("should return results sorted ascending by name", async function () {
      const res = await request
        .get("/api/tables/users/rows?sort=name&dir=asc")
        .expect(200);

      assert.ok(Array.isArray(res.body.data), "data should be an array");
      assert.ok(
        res.body.data.length > 1,
        "should have multiple rows to verify sort",
      );

      const names = res.body.data.map((r) => r.name);
      for (let i = 1; i < names.length; i++) {
        assert.ok(
          names[i - 1].localeCompare(names[i]) <= 0,
          `Expected "${names[i - 1]}" <= "${names[i]}" for ascending sort`,
        );
      }
    });

    it("should return results sorted descending by name", async function () {
      const res = await request
        .get("/api/tables/users/rows?sort=name&dir=desc")
        .expect(200);

      assert.ok(Array.isArray(res.body.data), "data should be an array");
      assert.ok(
        res.body.data.length > 1,
        "should have multiple rows to verify sort",
      );

      const names = res.body.data.map((r) => r.name);
      for (let i = 1; i < names.length; i++) {
        assert.ok(
          names[i - 1].localeCompare(names[i]) >= 0,
          `Expected "${names[i - 1]}" >= "${names[i]}" for descending sort`,
        );
      }
    });
  });
});
