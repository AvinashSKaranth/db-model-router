process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/mongodb/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("MongoDB Security & Architecture Tests", function () {
  this.timeout(15000);

  before(async function () {
    db.connect({
      host: process.env.MONGO_HOST || "localhost",
      port: parseInt(process.env.MONGO_PORT || "27017"),
      database: process.env.MONGO_DB || "test_db",
      user: process.env.MONGO_USER || "",
      password: process.env.MONGO_PASSWORD || "",
    });
  });

  after(async function () {
    try {
      await db.query(tableName, "drop");
    } catch (_) {}
    await db.disconnect();
  });

  it("should NOT mutate caller's filter array in-place when safeDelete is used", function () {
    const originalFilter = [[["title", "=", "Test Item"]]];
    const filterSnapshot = JSON.stringify(originalFilter);

    const whereData1 = db.where(originalFilter, "is_deleted");
    assert.strictEqual(
      JSON.stringify(originalFilter),
      filterSnapshot,
      "where() must not mutate the original filter array",
    );

    const whereData2 = db.where(originalFilter, "is_deleted");
    assert.deepStrictEqual(
      whereData1.query,
      whereData2.query,
      "Repeated calls with same filter must produce identical queries",
    );
  });

  it("should properly format sort orders with sort_builder", function () {
    const sort = ["-created_at", "title"];
    const sortData = db.sort_builder(sort);
    assert.deepStrictEqual(sortData, {
      created_at: -1,
      title: 1,
    });
  });

  it("should handle soft delete with safeDelete filter", async function () {
    const secModel = model(
      db,
      tableName,
      {
        title: "required|string",
        order: "integer",
        is_deleted: "integer",
      },
      "_id",
      ["_id"],
      { safeDelete: "is_deleted" },
    );

    const record = await secModel.insert({
      title: "Soft Delete Item",
      order: 7,
    });
    assert.ok(record._id);

    await secModel.remove({ _id: record._id });

    const raw = await db.query(tableName, "findOne", { _id: record._id });
    assert.strictEqual(raw.is_deleted, 1);

    const fetched = await secModel.byId(record._id.toString());
    assert.strictEqual(fetched, null);
  });

  it("should throw error when qcount receives invalid filter", async function () {
    await assert.rejects(async () => {
      await db.qcount(tableName, "not-an-array");
    }, /Invalid filter object/);
  });
});
