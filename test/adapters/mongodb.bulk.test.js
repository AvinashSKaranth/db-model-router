process.env.NODE_ENV = "TEST";
const crypto = require("crypto");
const assert = require("assert");
const db = require("../../src/mongodb/db.js");
const model = require("../../src/commons/model.js");

const collectionName =
  "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const modelStructure = {
  _id: "string",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "_id";

let testModel;

describe("MongoDB Bulk Operations", function () {
  before(async function () {
    this.timeout(10000);
    const host = process.env.MONGO_HOST || "localhost";
    const port = process.env.MONGO_PORT || 27017;
    const database = process.env.MONGO_DB || "test_db";
    db.connect({ host, port, database });
    testModel = model(db, collectionName, modelStructure, primaryKey, [
      primaryKey,
    ]);
  });

  after(async function () {
    this.timeout(10000);
    try {
      await db.query(collectionName, "drop");
    } catch (e) {
      // collection may not exist
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
      // First get existing records to obtain their PKs
      const existing = await testModel.find({});
      assert.ok(existing.data.length >= 5, "should have records to update");

      const toUpdate = existing.data.slice(0, 3).map((r) => ({
        _id: r._id.toString(),
        name: r.name + " Updated",
        email: r.email,
        age: r.age + 1,
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
      // Insert some records to remove
      await testModel.insert({
        data: [
          { name: "RemoveMe", email: "rm1@example.com", age: 99 },
          { name: "RemoveMe", email: "rm2@example.com", age: 99 },
        ],
      });

      // Remove by filter
      await testModel.remove({ name: "RemoveMe" });

      // Verify all matching records are gone
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
      this.timeout(10000);
      // Drop and recreate collection to ensure clean state
      try {
        await db.query(collectionName, "drop");
      } catch (e) {
        // collection may not exist
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

  describe("100k Bulk Insert & Delete Benchmark", function () {
    this.timeout(120000);
    const TOTAL = 100_000;

    function generateRecords(count) {
      const records = [];
      for (let i = 0; i < count; i++) {
        records.push({
          name: "Bench_" + i,
          email: "bench_" + i + "@load.test",
          age: 18 + (i % 60),
        });
      }
      return records;
    }

    it("should bulk insert 100,000 records", async function () {
      const records = generateRecords(TOTAL);
      const start = process.hrtime.bigint();
      const result = await testModel.insert({ data: records });
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      console.log(
        `        → Inserted ${result.rows.toLocaleString()} rows in ${elapsed.toFixed(0)} ms ` +
          `(${Math.round(result.rows / (elapsed / 1000)).toLocaleString()} rows/s)`,
      );

      assert.strictEqual(result.rows, TOTAL, "rows count must match input");
      assert.strictEqual(result.type, "success");
    });

    it("should count all 100,000 persisted rows", async function () {
      const count = await db.qcount(collectionName, [], null);
      assert.ok(count >= TOTAL, "collection must contain at least 100k docs");
    });

    it("should bulk delete all 100,000 records by filter", async function () {
      const start = process.hrtime.bigint();
      const result = await testModel.remove({
        filter: [[["age", ">=", 0]]],
      });
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

      console.log(`        → Deleted docs in ${elapsed.toFixed(0)} ms`);

      assert.ok(result.message, "remove should return a message");
    });

    it("should have 0 rows after bulk delete", async function () {
      const count = await db.qcount(collectionName, [], null);
      assert.strictEqual(
        count,
        0,
        "collection should be empty after bulk delete",
      );
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
          await db.list(
            collectionName,
            { unknown_column: "value" },
            [],
            null,
            0,
          );
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
