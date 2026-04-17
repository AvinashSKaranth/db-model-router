process.env.NODE_ENV = "TEST";
const crypto = require("crypto");
const assert = require("assert");
const {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} = require("@aws-sdk/client-dynamodb");
const db = require("../../src/dynamodb/db.js");
const model = require("../../src/commons/model.js");

const tableName = "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const modelStructure = {
  id: "string",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "id";

let testModel;

const endpoint = `http://${process.env.DYNAMODB_HOST || "localhost"}:${process.env.DYNAMODB_PORT || 8000}`;
const region = process.env.DYNAMODB_REGION || "us-east-1";
const accessKeyId = process.env.DYNAMODB_ACCESS_KEY || "fakeAccessKey";
const secretAccessKey = process.env.DYNAMODB_SECRET_KEY || "fakeSecretKey";

describe("DynamoDB Individual Operations", function () {
  this.timeout(15000);

  before(async function () {
    // Create the test table directly via the DynamoDB client
    const rawClient = new DynamoDBClient({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    await rawClient.send(
      new CreateTableCommand({
        TableName: tableName,
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );

    // Wait for table to become active
    let active = false;
    while (!active) {
      const desc = await rawClient.send(
        new DescribeTableCommand({ TableName: tableName }),
      );
      if (desc.Table.TableStatus === "ACTIVE") active = true;
    }

    // Connect the adapter
    db.connect({
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      primaryKey: "id",
    });

    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(async function () {
    const rawClient = new DynamoDBClient({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    try {
      await rawClient.send(new DeleteTableCommand({ TableName: tableName }));
    } catch (e) {
      // table may not exist
    }
    await db.disconnect();
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
      assert.ok(result.id, "returned record should have a valid PK");
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
      assert.ok(rec.id);

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
