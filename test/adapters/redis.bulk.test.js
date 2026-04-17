process.env.NODE_ENV = "TEST";
const crypto = require("crypto");
const assert = require("assert");
const db = require("../../src/redis/db.js");
const model = require("../../src/commons/model.js");

const tablePrefix =
  "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const tableName = tablePrefix;
const modelStructure = {
  id: "string",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "id";

let testModel;

const host = process.env.REDIS_HOST || "localhost";
const port = parseInt(process.env.REDIS_PORT || "6379", 10);

describe("Redis Bulk Operations", function () {
  this.timeout(15000);

  before(async function () {
    db.connect({ host, port, primaryKey: "id" });
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(async function () {
    // Clean up all keys with the test table prefix
    try {
      const Redis = require("ioredis");
      const cleanupClient = new Redis({ host, port });
      const pattern = `${tableName}:*`;
      let cursor = "0";
      do {
        const [nextCursor, keys] = await cleanupClient.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await cleanupClient.del(...keys);
        }
      } while (cursor !== "0");
      await cleanupClient.quit();
    } catch (e) {
      // ignore cleanup errors
    }

    await db.disconnect();
  });

  describe("Bulk Insert", function () {
    it("should bulk insert 5 records and return rows count matching input length", async function () {
      const records = [
        { name: "Alice", email: "alice@example.com", age: 30 },
        { name: "Bob", email: "bob@example.com", age: 25 },
        { name: "Charlie", email: "charlie@example.com", age: 35 },
        { name: "Diana", email: "diana@example.com", age: 28 },
        { name: "Eve", email: "eve@example.com", age: 32 },
      ];
      const result = await testModel.insert({ data: records });
      assert.strictEqual(
        result.rows,
        5,
        "rows count should match input length",
      );
    });
  });

  describe("Bulk Update", function () {
    it("should bulk update multiple records and return rows count", async function () {
      const existing = await testModel.find({});
      assert.ok(existing.data.length >= 5, "should have records to update");

      const toUpdate = existing.data.slice(0, 3).map((r) => ({
        id: String(r.id),
        name: r.name + " Updated",
        email: r.email,
        age: Number(r.age) + 1,
      }));

      const result = await testModel.update({ data: toUpdate });
      assert.strictEqual(
        result.rows,
        3,
        "rows count should match update input length",
      );
    });
  });

  describe("Bulk Remove", function () {
    it("should bulk remove records using a filter and verify count is 0", async function () {
      await testModel.insert({
        data: [
          { name: "RemoveMe", email: "rm1@example.com", age: 99 },
          { name: "RemoveMe", email: "rm2@example.com", age: 99 },
        ],
      });

      await testModel.remove({ name: "RemoveMe" });

      const result = await testModel.find({ name: "RemoveMe" });
      assert.strictEqual(
        result.count,
        0,
        "find should return count 0 after bulk remove",
      );
      assert.strictEqual(result.data.length, 0);
    });
  });

  describe("List Pagination", function () {
    before(async function () {
      // Clear all existing records
      const all = await testModel.find({});
      for (const r of all.data) {
        await testModel.remove(String(r.id));
      }

      const records = [];
      for (let i = 1; i <= 35; i++) {
        records.push({
          name: "User" + i,
          email: "user" + i + "@example.com",
          age: 20 + i,
        });
      }
      await testModel.insert({ data: records });
    });

    it("should return 30 records on page 0 (default page size)", async function () {
      const result = await testModel.list({ page: 0 });
      assert.strictEqual(
        result.data.length,
        30,
        "page 0 should return 30 records",
      );
      assert.strictEqual(result.count, 35, "count should equal total records");
    });

    it("should return remaining records on page 1", async function () {
      const result = await testModel.list({ page: 1 });
      assert.strictEqual(
        result.data.length,
        5,
        "page 1 should return remaining 5 records",
      );
      assert.strictEqual(result.count, 35, "count should equal total records");
    });
  });

  describe("List with Search Filters", function () {
    it("should filter results by name using like", async function () {
      const result = await testModel.list({ name: "User1" });
      assert.ok(result.data.length > 0, "should find records matching filter");
      for (const r of result.data) {
        assert.ok(
          r.name.includes("User1"),
          "each record name should contain User1",
        );
      }
    });
  });

  describe("Invalid Data Handling", function () {
    it("should throw on bulk insert with missing required fields", async function () {
      await assert.rejects(
        async () => {
          await testModel.insert({ data: [{ name: "NoEmail" }] });
        },
        (err) => {
          assert.ok(err, "should throw an error for missing required fields");
          return true;
        },
      );
    });

    it("should throw on invalid filter object", async function () {
      await assert.rejects(
        async () => {
          await db.list(tableName, { unknown_column: "value" }, [], null, 0);
        },
        (err) => {
          assert.ok(
            err.message === "Invalid filter object",
            "should throw Invalid filter object",
          );
          return true;
        },
      );
    });
  });
});
