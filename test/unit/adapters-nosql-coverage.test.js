"use strict";

const assert = require("assert");
const redisDb = require("../../src/redis/db");
const mongoDb = require("../../src/mongodb/db");
const ddbDb = require("../../src/dynamodb/db");
const {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
} = require("@aws-sdk/client-dynamodb");

describe("NoSQL Database Adapters Coverage (Redis, MongoDB, DynamoDB)", function () {
  this.timeout(25000);

  // -------------------------------------------------------------------------
  // 1. Redis Adapter Coverage
  // -------------------------------------------------------------------------
  describe("Redis Adapter", function () {
    const testTable = "test_redis_cov_" + Date.now();

    before(async function () {
      redisDb.connect({
        host: "localhost",
        port: 6379,
      });
    });

    after(async function () {
      try {
        await redisDb.remove(testTable, [[["id", "!=", ""]]] );
      } catch {
        // cleanup ignore
      } finally {
        await redisDb.disconnect();
      }
    });

    it("sort_builder (sortItems) and where in-memory matchers", function () {
      // sortItems
      const items = [
        { name: "Bob", score: 50 },
        { name: "Alice", score: 90 },
        { name: "Charlie", score: 70 },
      ];
      const sortedAsc = redisDb.sort_builder(items, ["name"]);
      assert.strictEqual(sortedAsc[0].name, "Alice");

      const sortedDesc = redisDb.sort_builder(items, ["-score"]);
      assert.strictEqual(sortedDesc[0].score, 90);

      // where with all operators
      assert.strictEqual(redisDb.where("invalid"), null);
      const emptyWhere = redisDb.where([]);
      assert.strictEqual(typeof emptyWhere.query, "function");
      assert.strictEqual(emptyWhere.query({ id: 1 }), true);

      // Conditionals
      const w = redisDb.where([
        [
          ["name", "=", "Alice"],
          ["score", ">", 50],
          ["score", "<", 100],
          ["score", ">=", 60],
          ["score", "<=", 90],
          ["score", "!=", 75],
          ["name", "like", "Ali"],
          ["name", "not like", "Bob"],
          ["score", "in", [90, 95]],
          ["score", "not in", [10, 20]],
        ],
      ]);
      assert.strictEqual(w.query({ name: "Alice", score: 90 }), true);
      assert.strictEqual(w.query({ name: "Bob", score: 90 }), false);

      // Safe delete
      const sd = redisDb.where([], "is_deleted");
      assert.strictEqual(sd.query({ is_deleted: 0 }), true);
      assert.strictEqual(sd.query({ is_deleted: 1 }), false);

      assert.strictEqual(redisDb.where([[["name", "INVALID_OP", "val"]]]), null);
      assert.strictEqual(redisDb.where([[["name", "in", "not-array"]]]), null);
    });

    it("CRUD operations: insert, list, get, qcount, upsert, remove", async function () {
      // 1. Single insert
      const insRes = await redisDb.insert(testTable, { id: "u1", name: "Alice", score: 85 });
      assert.strictEqual(insRes.rows, 1);
      assert.ok(insRes.id);

      // 2. Bulk insert
      const bulkRes = await redisDb.insert(testTable, [
        { id: "u2", name: "Bob", score: 90 },
        { id: "u3", name: "Charlie", score: 70 },
      ]);
      assert.strictEqual(bulkRes.rows, 2);

      // 3. Upsert
      const upRes = await redisDb.upsert(testTable, { id: "u1", name: "Alice Updated", score: 95 }, ["id"]);
      assert.ok(upRes.rows >= 0);

      // 4. List with sort
      const listRes = await redisDb.list(testTable, [[["score", ">=", 70]]], ["-score"], null, 0, 10);
      assert.ok(listRes.data.length >= 3);
      assert.strictEqual(listRes.count, 3);
      assert.strictEqual(listRes.data[0].score, 95);

      // 5. Get
      const getRes = await redisDb.get(testTable, [[["id", "=", "u1"]]]);
      assert.strictEqual(getRes.data.length, 1);
      assert.strictEqual(getRes.data[0].name, "Alice Updated");

      // 6. Qcount
      const countRes = await redisDb.qcount(testTable, [[["score", ">=", 70]]]);
      assert.strictEqual(countRes, 3);

      // 7. Remove
      const delRes = await redisDb.remove(testTable, [[["id", "=", "u1"]]]);
      assert.ok(delRes.message.includes("removed"));

      const afterDel = await redisDb.get(testTable, [[["id", "=", "u1"]]]);
      assert.strictEqual(afterDel.data.length, 0);

      // Remove with empty filter error
      // 8. Auto-generated sequence keys on bulk insert without primaryKey
      const autoIns = await redisDb.insert(testTable, [
        { name: "Auto1", score: 10 },
        { name: "Auto2", score: 20 },
      ]);
      assert.strictEqual(autoIns.rows, 2);

      // Single insert without PK (auto sequence)
      const singleAuto = await redisDb.insert(testTable, { name: "Single Auto", score: 30 });
      assert.strictEqual(singleAuto.rows, 1);
      assert.ok(singleAuto.id);

      // Upsert without unique keys
      const noUniqUp = await redisDb.upsert(testTable, { name: "No Uniq", score: 40 }, []);
      assert.strictEqual(noUniqUp.rows, 1);

      // Upsert without PK finding existing by unique key
      const matchUp = await redisDb.upsert(testTable, { name: "Auto1", score: 15 }, ["name"]);
      assert.strictEqual(matchUp.rows, 1);

      // Upsert without PK generating new seq ID
      const newSeqUp = await redisDb.upsert(testTable, { name: "Unique Seq Brand New", score: 99 }, ["name"]);
      assert.strictEqual(newSeqUp.rows, 1);
      assert.ok(newSeqUp.id);

      // 9. query method
      const echoRes = await redisDb.query("echo", "test-ping");
      assert.strictEqual(echoRes, "test-ping");

      // 10. sortItems equality branch
      const eqSorted = redisDb.sort_builder([{ name: "Same" }, { name: "Same" }], ["name"]);
      assert.strictEqual(eqSorted.length, 2);
    });
  });

  // -------------------------------------------------------------------------
  // 2. MongoDB Adapter Coverage
  // -------------------------------------------------------------------------
  describe("MongoDB Adapter", function () {
    const testTable = "test_mongo_cov_" + Date.now();

    before(async function () {
      await mongoDb.connect({
        host: "localhost",
        port: 27017,
        database: "test_db",
      });
    });

    after(async function () {
      try {
        await mongoDb.remove(testTable, [[["name", "!=", ""]]] );
      } catch {
        // cleanup ignore
      } finally {
        await mongoDb.disconnect();
      }
    });

    it("sort_builder and where filter documents", function () {
      const sortObj = mongoDb.sort_builder(["name", "-score"]);
      assert.strictEqual(sortObj.name, 1);
      assert.strictEqual(sortObj.score, -1);

      assert.strictEqual(mongoDb.where("invalid"), null);
      assert.deepStrictEqual(mongoDb.where([]), { query: {}, value: [] });

      const sd = mongoDb.where([], "is_deleted");
      assert.deepStrictEqual(sd.query.$and[0], { is_deleted: 0 });

      // All conditionals
      const w = mongoDb.where([
        [
          ["name", "=", "Mongo Alice"],
          ["score", ">", 10],
          ["score", "<", 100],
          ["score", "<=", 90],
          ["score", ">=", 20],
          ["score", "!=", 50],
          ["name", "like", "Mongo"],
          ["name", "not like", "Test"],
          ["score", "in", [1, 2]],
          ["score", "not in", [3, 4]],
        ],
      ]);
      assert.ok(w.query.$and);
      assert.strictEqual(mongoDb.where([[["name", "INVALID_OP", "val"]]]), null);
      assert.strictEqual(mongoDb.where([[["name", "in", "not-array"]]]), null);
    });

    it("CRUD operations: insert, list, get, qcount, upsert, remove", async function () {
      // 1. Single insert
      const insRes = await mongoDb.insert(testTable, { name: "Mongo Alice", score: 85, is_deleted: 0 });
      assert.ok(insRes.id);
      assert.strictEqual(insRes.rows, 1);
      const insertedId = String(insRes.id);

      // 2. Bulk insert
      const bulkRes = await mongoDb.insert(testTable, [
        { name: "Mongo Bob", score: 90, is_deleted: 0 },
        { name: "Mongo Charlie", score: 70, is_deleted: 0 },
      ]);
      assert.strictEqual(bulkRes.rows, 2);

      // 3. Upsert
      const upRes = await mongoDb.upsert(testTable, { _id: insertedId, name: "Mongo Alice Up", score: 95, is_deleted: 0 }, ["_id"]);
      assert.ok(upRes.rows >= 0);

      // 4. List
      const listRes = await mongoDb.list(testTable, [[["score", ">=", 70]]], ["-score"], null, 0, 10);
      assert.ok(listRes.data.length >= 3);
      assert.strictEqual(listRes.count, 3);

      // 5. Get
      const getRes = await mongoDb.get(testTable, [[["_id", "=", insertedId]]]);
      assert.strictEqual(getRes.data.length, 1);

      // 6. Qcount
      const countRes = await mongoDb.qcount(testTable, [[["score", ">=", 70]]]);
      assert.strictEqual(countRes, 3);

      // 7. Soft remove
      const softRem = await mongoDb.remove(testTable, [[["_id", "=", insertedId]]], "is_deleted");
      assert.ok(softRem.message.includes("removed"));

      // 8. Hard remove
      const hardRem = await mongoDb.remove(testTable, [[["_id", "=", insertedId]]]);
      assert.ok(hardRem.message.includes("removed"));

      // 9. Upsert creating a new document (upsertedId branch)
      const newUp = await mongoDb.upsert(testTable, { name: "Mongo New Brand", score: 99 }, ["name"]);
      assert.strictEqual(newUp.rows, 1);
      assert.ok(newUp.id);

      // 10. Duplicate key error mapping
      await mongoDb.insert(testTable, { _id: "dup_key_test", name: "First" });
      await assert.rejects(
        async () => {
          await mongoDb.insert(testTable, { _id: "dup_key_test", name: "Second" });
        },
        (err) => err.code === "ER_DUP_ENTRY" && err.sqlMessage.includes("E11000"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. DynamoDB Adapter Coverage
  // -------------------------------------------------------------------------
  describe("DynamoDB Adapter", function () {
    const testTable = "test_ddb_cov_" + Date.now();
    const endpoint = "http://localhost:8000";
    const region = "us-east-1";
    const rawClient = new DynamoDBClient({
      endpoint,
      region,
      credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    });

    before(async function () {
      await rawClient.send(
        new CreateTableCommand({
          TableName: testTable,
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
          BillingMode: "PAY_PER_REQUEST",
        }),
      );

      ddbDb.connect({
        endpoint,
        region,
        accessKeyId: "fake",
        secretAccessKey: "fake",
      });
    });

    after(async function () {
      try {
        await rawClient.send(new DeleteTableCommand({ TableName: testTable }));
      } catch {
        // ignore
      } finally {
        await ddbDb.disconnect();
      }
    });

    it("sort_builder and where expressions", function () {
      const items = [
        { name: "Bob", score: 50 },
        { name: "Alice", score: 90 },
      ];
      const sorted = ddbDb.sort_builder(items, ["name"]);
      assert.strictEqual(sorted[0].name, "Alice");

      assert.strictEqual(ddbDb.where("invalid"), null);
      assert.deepStrictEqual(ddbDb.where([]), { query: "", value: {}, names: {} });

      const sd = ddbDb.where([], "is_deleted");
      assert.ok(sd.query.includes("#"));
      assert.strictEqual(sd.value[":val0"], 0);

      const w = ddbDb.where([
        [
          ["name", "=", "DDB User"],
          ["score", ">", 10],
          ["score", "<", 100],
          ["score", "<=", 90],
          ["score", ">=", 20],
          ["score", "!=", 50],
          ["name", "like", "DDB"],
          ["name", "not like", "Test"],
          ["score", "in", [1, 2]],
        ],
      ]);
      assert.ok(w.query.length > 0);
      assert.strictEqual(ddbDb.where([[["name", "INVALID_OP", "val"]]]), null);
      assert.strictEqual(ddbDb.where([[["name", "in", "not-array"]]]), null);
    });

    it("CRUD operations: insert, list, get, qcount, upsert, remove", async function () {
      // 1. Single insert
      const insRes = await ddbDb.insert(testTable, { id: "d1", name: "DDB Alice", score: 85, is_deleted: 0 });
      assert.strictEqual(insRes.rows, 1);
      assert.ok(insRes.id);

      // 2. Bulk insert
      const bulkRes = await ddbDb.insert(testTable, [
        { id: "d2", name: "DDB Bob", score: 90, is_deleted: 0 },
        { id: "d3", name: "DDB Charlie", score: 70, is_deleted: 0 },
      ]);
      assert.strictEqual(bulkRes.rows, 2);

      // 3. Upsert
      const upRes = await ddbDb.upsert(testTable, { id: "d1", name: "DDB Alice Up", score: 95, is_deleted: 0 }, ["id"]);
      assert.ok(upRes.rows >= 0);

      // 4. List
      const listRes = await ddbDb.list(testTable, [[["score", ">=", 70]]], ["-score"], null, 0, 10);
      assert.ok(listRes.data.length >= 3);
      assert.strictEqual(listRes.count, 3);

      // 5. Get
      const getRes = await ddbDb.get(testTable, [[["id", "=", "d1"]]]);
      assert.strictEqual(getRes.data.length, 1);

      // 6. Qcount
      const countRes = await ddbDb.qcount(testTable, [[["score", ">=", 70]]]);
      assert.strictEqual(countRes, 3);

      // 7. Soft remove
      const softRem = await ddbDb.remove(testTable, [[["id", "=", "d1"]]], "is_deleted");
      assert.ok(softRem.message.includes("removed"));

      // 8. Hard remove
      const hardRem = await ddbDb.remove(testTable, [[["id", "=", "d1"]]]);
      assert.ok(hardRem.message.includes("removed"));

      // 9. query method
      const { ScanCommand: DocScanCommand } = require("@aws-sdk/lib-dynamodb");
      const scanRes = await ddbDb.query(DocScanCommand, { TableName: testTable });
      assert.ok(scanRes.Items);

      // 10. sort equality
      const eqDdb = ddbDb.sort_builder([{ name: "Same" }, { name: "Same" }], ["name"]);
      assert.strictEqual(eqDdb.length, 2);

      // 11. ResourceNotFoundException mapping
      await assert.rejects(
        async () => {
          await ddbDb.insert("nonexistent_table_12345", { id: "none", name: "bad" });
        },
        /non-existent table/,
      );
    });
  });
});
