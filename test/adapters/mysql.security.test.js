process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/mysql/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("MySQL Security & Architecture Tests", function () {
  this.timeout(15000);

  before(async function () {
    db.connect({
      host: process.env.MYSQL_HOST || "localhost",
      port: parseInt(process.env.MYSQL_PORT || "3308"),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "password",
      database: process.env.MYSQL_DB || "test_db",
    });

    await db.query(
      "CREATE TABLE IF NOT EXISTS `" +
        tableName +
        "` (" +
        "`id` INT AUTO_INCREMENT PRIMARY KEY," +
        "`title` VARCHAR(255) NOT NULL," +
        "`order` INT DEFAULT 0," +
        "`desc` VARCHAR(255)," +
        "`is_deleted` INT DEFAULT 0," +
        "`created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    );
  });

  after(async function () {
    try {
      await db.query("DROP TABLE IF EXISTS `" + tableName + "`");
    } catch (_) {}
    await db.disconnect();
  });

  it("should sanitize identifiers and prevent SQL injection through escapeId", function () {
    assert.strictEqual(db.escapeId("users"), "`users`");
    assert.strictEqual(db.escapeId("col\0inject"), "`colinject`");
    assert.strictEqual(db.escapeId("col`name"), "`col``name`");
    assert.strictEqual(db.escapeId("db.table"), "`db`.`table`");
  });

  it("should NOT mutate caller's filter array in-place when safeDelete is used", function () {
    const originalFilter = [[["title", "=", "Test Item"]]];
    const filterSnapshot = JSON.stringify(originalFilter);

    // Call where with safeDelete
    const whereData1 = db.where(originalFilter, "is_deleted");
    assert.strictEqual(
      JSON.stringify(originalFilter),
      filterSnapshot,
      "where() must not mutate the original filter array",
    );

    // Call again to verify no duplicate accumulation
    const whereData2 = db.where(originalFilter, "is_deleted");
    assert.strictEqual(
      whereData1.query,
      whereData2.query,
      "Repeated calls with same filter must produce identical queries",
    );
  });

  it("should query tables and columns named with MySQL reserved words seamlessly", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        order: "integer",
        desc: "string",
      },
      "id",
      ["id"],
    );

    const inserted = await secModel.insert({
      title: "Reserved Word Test",
      order: 100,
      desc: "Keyword column",
    });
    assert.ok(inserted.id > 0);

    const found = await secModel.findOne({ order: 100 });
    assert.ok(found);
    assert.strictEqual(found.title, "Reserved Word Test");
    assert.strictEqual(found.order, 100);
    assert.strictEqual(found.desc, "Keyword column");
  });

  it("should format sort orders with escaped identifiers", function () {
    const sort = ["-order", "desc", "id"];
    const sortData = db.sort_builder(sort);
    assert.strictEqual(
      sortData.query,
      "ORDER BY ?? DESC,?? ASC,?? ASC",
    );
    assert.deepStrictEqual(sortData.value, ["order", "desc", "id"]);
  });

  it("should properly propagate database errors in qcount", async function () {
    await assert.rejects(async () => {
      await db.qcount("nonexistent_table_xyz", []);
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

    const record = await secModel.insert({
      title: "Soft Delete Item",
      order: 7,
    });
    assert.ok(record.id > 0);

    await secModel.remove(record.id);

    const raw = await db.query(
      `SELECT is_deleted FROM \`${tableName}\` WHERE id = ?`,
      [record.id],
    );
    assert.strictEqual(raw[0].is_deleted, 1);

    const fetched = await secModel.byId(record.id);
    assert.strictEqual(fetched, null);
  });
});
