process.env.NODE_ENV = "TEST";
const assert = require("assert");
const { CreateTableCommand, DeleteTableCommand } = require("@aws-sdk/client-dynamodb");
const db = require("../../src/dynamodb/db.js");
const model = require("../../src/commons/model.js");

const tableName =
  "test_sec_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

describe("DynamoDB Security & Architecture Tests", function () {
  this.timeout(15000);

  before(async function () {
    db.connect({
      endpoint: process.env.DYNAMODB_ENDPOINT || "http://localhost:8000",
      region: process.env.DYNAMODB_REGION || "us-east-1",
      accessKeyId: process.env.DYNAMODB_ACCESS_KEY_ID || "fakeMyKeyId",
      secretAccessKey:
        process.env.DYNAMODB_SECRET_ACCESS_KEY || "fakeSecretAccessKey",
    });

    await db.query(CreateTableCommand, {
      TableName: tableName,
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  after(async function () {
    try {
      await db.query(DeleteTableCommand, { TableName: tableName });
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
    assert.strictEqual(
      whereData1.query,
      whereData2.query,
      "Repeated calls with same filter must produce identical queries",
    );
  });

  it("should sort records in-memory using sort_builder helper", function () {
    const items = [
      { id: "1", name: "Charlie", age: 30 },
      { id: "2", name: "Alice", age: 25 },
      { id: "3", name: "Bob", age: 35 },
    ];
    const sorted = db.sort_builder(items, ["name"]);
    assert.strictEqual(sorted[0].name, "Alice");
    assert.strictEqual(sorted[1].name, "Bob");
    assert.strictEqual(sorted[2].name, "Charlie");
  });

  it("should throw error when qcount receives invalid filter", async function () {
    await assert.rejects(async () => {
      await db.qcount(tableName, "not-an-array");
    }, /Invalid filter object/);
  });

  it("should handle soft delete with safeDelete filter", async function () {
    const secModel = model(
      db,
      tableName,
      {
        id: "string",
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

    await secModel.remove(record.id);

    // Raw scan directly without safeDelete filter
    const rawResult = await db.get(tableName, [[["id", "=", record.id]]], [], null);
    assert.strictEqual(rawResult.count, 1);
    assert.strictEqual(rawResult.data[0].is_deleted, 1);

    const fetched = await secModel.byId(record.id);
    assert.strictEqual(fetched, null);
  });
});
