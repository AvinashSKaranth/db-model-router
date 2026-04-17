process.env.NODE_ENV = "TEST";
const crypto = require("crypto");
const assert = require("assert");
const db = require("../../src/mysql/db.js");
const model = require("../../src/commons/model.js");

const tableName = "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const modelStructure = {
  id: "integer",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "id";

let testModel;

describe("MySQL Individual Operations", function () {
  this.timeout(15000);

  before(async function () {
    db.connect({
      host: process.env.MYSQL_HOST || "localhost",
      port: parseInt(process.env.MYSQL_PORT || "3306", 10),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "password",
      database: process.env.MYSQL_DB || "test_db",
    });
    await db.query(
      "CREATE TABLE IF NOT EXISTS `" +
        tableName +
        "` (" +
        "`id` INT AUTO_INCREMENT PRIMARY KEY," +
        "`name` VARCHAR(255) NOT NULL," +
        "`email` VARCHAR(255) NOT NULL," +
        "`age` INT NOT NULL" +
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    );
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(async function () {
    await db.query("DROP TABLE IF EXISTS `" + tableName + "`");
  });

  describe("Single Entry", function () {
    let insertedRecord;

    it("should insert a single record and return it with a valid PK", async function () {
      const result = await testModel.insert({
        name: "Alice",
        email: "alice@example.com",
        age: 30,
      });
      assert.ok(result, "insert should return a record");
      assert.ok(result.id > 0, "returned record should have a valid PK");
      assert.strictEqual(result.name, "Alice");
      assert.strictEqual(result.email, "alice@example.com");
      assert.strictEqual(result.age, 30);
      insertedRecord = result;
    });

    it("should get the record by ID using byId", async function () {
      const record = await testModel.byId(insertedRecord.id);
      assert.ok(record, "byId should return a record");
      assert.strictEqual(record.id, insertedRecord.id);
      assert.strictEqual(record.name, "Alice");
      assert.strictEqual(record.email, "alice@example.com");
    });

    it("should get the record by conditions using find", async function () {
      const result = await testModel.find({ name: "Alice" });
      assert.ok(Array.isArray(result.data), "find should return data array");
      assert.ok(result.count >= 1, "count should be at least 1");
      assert.strictEqual(result.data[0].name, "Alice");
    });

    it("should return the record using findOne with valid filter", async function () {
      const record = await testModel.findOne({ email: "alice@example.com" });
      assert.ok(record, "findOne should return a record");
      assert.strictEqual(record.email, "alice@example.com");
    });

    it("should return false from findOne when no record matches", async function () {
      const record = await testModel.findOne({
        email: "nonexistent@example.com",
      });
      assert.strictEqual(
        record,
        false,
        "findOne should return false for no match",
      );
    });

    it("should update a record and return updated fields", async function () {
      const updated = await testModel.update({
        id: insertedRecord.id,
        name: "Alice Updated",
        email: "alice_updated@example.com",
        age: 31,
      });
      assert.ok(updated, "update should return the updated record");
      assert.strictEqual(
        updated.id,
        insertedRecord.id,
        "PK should remain the same",
      );
      assert.strictEqual(updated.name, "Alice Updated");
      assert.strictEqual(updated.email, "alice_updated@example.com");
      assert.strictEqual(updated.age, 31);
    });

    it("should remove a record by ID and byId returns null", async function () {
      await testModel.remove(insertedRecord.id);
      const record = await testModel.byId(insertedRecord.id);
      assert.strictEqual(record, null, "byId should return null after removal");
    });

    it("should remove a record by filter", async function () {
      const rec = await testModel.insert({
        name: "Bob",
        email: "bob@example.com",
        age: 25,
      });
      assert.ok(rec.id > 0);

      await testModel.remove({ name: "Bob" });
      const result = await testModel.find({ name: "Bob" });
      assert.strictEqual(
        result.count,
        0,
        "find should return count 0 after filter removal",
      );
      assert.strictEqual(result.data.length, 0);
    });
  });
});
