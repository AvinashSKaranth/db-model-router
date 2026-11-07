process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/redis/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("Redis Security & Architecture Tests", function () {
  this.timeout(15000);

  before(async function () {
    db.connect({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || "",
      db: parseInt(process.env.REDIS_DB || "0"),
    });
  });

  after(async function () {
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
    assert.strictEqual(
      typeof whereData1.query,
      typeof whereData2.query,
      "Repeated calls with same filter must produce functions",
    );
  });

  it("should execute raw redis queries through query() function", async function () {
    await db.query("set", `${tableName}:raw_test`, "hello_redis");
    const val = await db.query("get", `${tableName}:raw_test`);
    assert.strictEqual(val, "hello_redis");
    await db.query("del", `${tableName}:raw_test`);
  });

  it("should sort records with sort_builder helper", function () {
    const items = [
      { id: 1, name: "Charlie" },
      { id: 2, name: "Alice" },
      { id: 3, name: "Bob" },
    ];
    const sorted = db.sort_builder(items, ["name"]);
    assert.strictEqual(sorted[0].name, "Alice");
    assert.strictEqual(sorted[1].name, "Bob");
    assert.strictEqual(sorted[2].name, "Charlie");
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
    assert.ok(record.id);

    await secModel.remove(String(record.id));

    const raw = await db.query("hgetall", `${tableName}:${record.id}`);
    assert.strictEqual(raw.is_deleted, "1");

    const fetched = await secModel.byId(String(record.id));
    assert.strictEqual(fetched, null);
  });
});
