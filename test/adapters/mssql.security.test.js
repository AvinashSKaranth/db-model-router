process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/mssql/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("MSSQL Security & Architecture Tests", function () {
  this.timeout(30000);

  before(async function () {
    await db.connect({
      server: process.env.MSSQL_HOST || "localhost",
      port: parseInt(process.env.MSSQL_PORT || "1433"),
      database: process.env.MSSQL_DB || "master",
      user: process.env.MSSQL_USER || "sa",
      password: process.env.MSSQL_PASSWORD || "Password123!",
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
    });

    await db.query(
      `CREATE TABLE [${tableName}] (
        id INT IDENTITY(1,1) PRIMARY KEY,
        title NVARCHAR(255) NOT NULL,
        [order] INT DEFAULT 0,
        [select] NVARCHAR(255),
        is_deleted INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    );
  });

  after(async function () {
    try {
      await db.query(`DROP TABLE IF EXISTS [${tableName}]`);
    } catch (_) {}
    await db.disconnect();
  });

  it("should sanitize identifiers and prevent SQL injection through escapeId", function () {
    assert.strictEqual(db.escapeId("users"), "[users]");
    assert.strictEqual(db.escapeId("dbo.users"), "[dbo].[users]");
    assert.strictEqual(db.escapeId("col\0inject"), "[colinject]");
    assert.strictEqual(db.escapeId("col]name"), "[col]]name]");
  });

  it("should query tables and columns named with T-SQL reserved words seamlessly", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        order: "integer",
        select: "string",
      },
      "id",
      ["id"],
    );

    const inserted = await secModel.insert({
      title: "Reserved Word Test",
      order: 42,
      select: "Keyword column",
    });
    assert.ok(inserted.id > 0);

    const found = await secModel.findOne({ order: 42 });
    assert.ok(found);
    assert.strictEqual(found.title, "Reserved Word Test");
    assert.strictEqual(found.order, 42);
    assert.strictEqual(found.select, "Keyword column");
  });

  it("should map ? placeholders in raw query() outside string literals to @paramN", async function () {
    const res = await db.query(
      `INSERT INTO [${tableName}] (title, [select]) VALUES (?, ?)`,
      ["Question Test", "Is this real? Yes!"],
    );
    assert.strictEqual(res.affectedRows, 1);

    // Query with literal '?' inside single quotes AND a ? placeholder
    const rows = await db.query(
      `SELECT title, [select] AS sel FROM [${tableName}] WHERE [select] LIKE '%?%' AND title = ?`,
      ["Question Test"],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].title, "Question Test");
    assert.strictEqual(rows[0].sel, "Is this real? Yes!");
  });

  it("should properly format sort orders and escape sort identifiers", function () {
    const sort = ["-order", "select", "id"];
    const sortData = db.sort_builder(sort);
    assert.strictEqual(
      sortData.query,
      "ORDER BY [order] DESC,[select] ASC,[id] ASC",
    );
  });

  it("should properly propagate database errors in qcount", async function () {
    await assert.rejects(async () => {
      await db.qcount("nonexistent_table_xyz", []);
    });
  });

  it("should correctly handle soft delete with safeDelete filter", async function () {
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

    const record = await secModel.insert({
      title: "Soft Delete Item",
      order: 5,
    });
    assert.ok(record.id > 0);

    await secModel.remove(record.id);

    const raw = await db.query(
      `SELECT is_deleted FROM [${tableName}] WHERE id = @param0`,
      [record.id],
    );
    assert.strictEqual(raw[0].is_deleted, 1);

    const fetched = await secModel.byId(record.id);
    assert.strictEqual(fetched, null);
  });
});
