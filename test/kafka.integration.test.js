/**
 * Kafka Integration Tests (SQLite3 + Real Kafka Broker)
 *
 * Tests that model operations (insert, update, upsert, delete) correctly
 * produce Kafka events. Each entry produces its own event with data as an object.
 *
 * Event format:
 * { table_name, operation_type, data: object, timestamp }
 *
 * Requires:
 * - A running Kafka broker at KAFKA_BROKER (default: localhost:9092)
 * - kafkajs installed
 *
 * Run with: npm run test:kafka
 */
process.env.NODE_ENV = "TEST";

const assert = require("assert");
const { Kafka } = require("kafkajs");

const db = require("../src/sqlite3/db.js");
const model = require("../src/commons/model.js");
const kafka = require("../src/commons/kafka.js");

const BROKER = process.env.KAFKA_BROKER || "localhost:9092";
const TOPIC_PREFIX = process.env.KAFKA_TOPIC_PREFIX || "dbmr";
const tableName =
  "test_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);
const topic = `${TOPIC_PREFIX}.${tableName}`;

let testModel;
let consumer;
let consumedMessages = [];

describe("Kafka Integration - SQLite3 + Real Broker", function () {
  this.timeout(60000);

  before(async function () {
    // Connect SQLite3
    db.connect({ database: process.env.SQLITE_DB || ":memory:" });
    db.query(
      `CREATE TABLE IF NOT EXISTS "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL UNIQUE,
        "status" INTEGER NOT NULL DEFAULT 0,
        "created_at" TEXT DEFAULT (datetime('now')),
        "modified_at" TEXT DEFAULT (datetime('now'))
      )`,
    );

    testModel = model(
      db,
      tableName,
      {
        name: "required|string",
        email: "required|string",
        status: "integer",
      },
      "id",
      ["email"],
    );

    // Initialize Kafka producer
    const connected = await kafka.init({
      broker: BROKER,
      clientId: "db-model-router-test",
      topicPrefix: TOPIC_PREFIX,
    });

    if (!connected) {
      throw new Error(
        `Could not connect to Kafka broker at ${BROKER}. Is it running?`,
      );
    }

    // Set up a consumer to verify messages arrive in Kafka
    const kafkaClient = new Kafka({
      clientId: "db-model-router-test-consumer",
      brokers: BROKER.split(","),
    });

    consumer = kafkaClient.consumer({ groupId: "test-group-" + Date.now() });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ message }) => {
        consumedMessages.push(JSON.parse(message.value.toString()));
      },
    });

    // Give consumer time to join the group
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  after(async function () {
    db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    db.disconnect();
    await kafka.disconnect();
    if (consumer) {
      await consumer.disconnect();
    }
  });

  beforeEach(function () {
    consumedMessages = [];
  });

  /**
   * Helper: wait for messages to arrive in the consumer
   */
  async function waitForMessages(expectedCount = 1, timeoutMs = 10000) {
    const start = Date.now();
    while (consumedMessages.length < expectedCount) {
      if (Date.now() - start > timeoutMs) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  describe("INSERT - single record", function () {
    it("should produce one event with data as an object", async function () {
      await testModel.insert({
        name: "John Doe",
        email: "john_" + Date.now() + "@example.com",
        status: 1,
      });

      await waitForMessages(1);

      assert.strictEqual(consumedMessages.length, 1);
      const msg = consumedMessages[0];
      assert.strictEqual(msg.table_name, tableName);
      assert.strictEqual(msg.operation_type, "insert");
      assert.strictEqual(typeof msg.data, "object");
      assert.ok(
        !Array.isArray(msg.data),
        "data should be an object, not array",
      );
      assert.strictEqual(msg.data.name, "John Doe");
      assert.ok(msg.timestamp);
    });
  });

  describe("INSERT - bulk (each entry = separate event)", function () {
    it("should produce one event per inserted record", async function () {
      consumedMessages = [];

      await testModel.insert({
        data: [
          {
            name: "Alice",
            email: "alice_" + Date.now() + "@example.com",
            status: 1,
          },
          {
            name: "Bob",
            email: "bob_" + Date.now() + "@example.com",
            status: 2,
          },
          {
            name: "Charlie",
            email: "charlie_" + Date.now() + "@example.com",
            status: 3,
          },
        ],
      });

      await waitForMessages(3);

      assert.strictEqual(consumedMessages.length, 3);
      for (const msg of consumedMessages) {
        assert.strictEqual(msg.table_name, tableName);
        assert.strictEqual(msg.operation_type, "insert");
        assert.strictEqual(typeof msg.data, "object");
        assert.ok(!Array.isArray(msg.data));
        assert.ok(msg.timestamp);
      }
    });
  });

  describe("UPDATE - single record", function () {
    it("should produce one event with data as an object", async function () {
      consumedMessages = [];

      const list = await testModel.list({});
      assert.ok(list.data.length > 0, "Need existing records to update");
      const record = list.data[0];

      await testModel.update({
        id: record.id,
        name: "Updated Name",
        email: record.email,
        status: 99,
      });

      await waitForMessages(1);

      assert.strictEqual(consumedMessages.length, 1);
      const msg = consumedMessages[0];
      assert.strictEqual(msg.table_name, tableName);
      assert.strictEqual(msg.operation_type, "update");
      assert.strictEqual(typeof msg.data, "object");
      assert.ok(!Array.isArray(msg.data));
    });
  });

  describe("UPDATE - bulk (each entry = separate event)", function () {
    it("should produce one event per updated record", async function () {
      consumedMessages = [];

      const list = await testModel.list({});
      if (list.data.length < 2) return this.skip();

      const records = list.data.slice(0, 2).map((r) => ({
        id: r.id,
        name: r.name + " BulkUpd",
        email: r.email,
        status: 50,
      }));

      await testModel.update({ data: records });

      await waitForMessages(2);

      assert.strictEqual(consumedMessages.length, 2);
      for (const msg of consumedMessages) {
        assert.strictEqual(msg.table_name, tableName);
        assert.strictEqual(msg.operation_type, "update");
        assert.strictEqual(typeof msg.data, "object");
        assert.ok(!Array.isArray(msg.data));
      }
    });
  });

  describe("UPSERT - single record", function () {
    it("should produce one event with data as an object", async function () {
      consumedMessages = [];

      await testModel.upsert({
        name: "Upserted",
        email: "upsert_" + Date.now() + "@example.com",
        status: 7,
      });

      await waitForMessages(1);

      assert.strictEqual(consumedMessages.length, 1);
      const msg = consumedMessages[0];
      assert.strictEqual(msg.table_name, tableName);
      assert.strictEqual(msg.operation_type, "upsert");
      assert.strictEqual(typeof msg.data, "object");
      assert.ok(!Array.isArray(msg.data));
    });
  });

  describe("UPSERT - bulk (each entry = separate event)", function () {
    it("should produce one event per upserted record", async function () {
      consumedMessages = [];

      await testModel.upsert({
        data: [
          {
            name: "Ups1",
            email: "ups1_" + Date.now() + "@example.com",
            status: 1,
          },
          {
            name: "Ups2",
            email: "ups2_" + Date.now() + "@example.com",
            status: 2,
          },
        ],
      });

      await waitForMessages(2);

      assert.strictEqual(consumedMessages.length, 2);
      for (const msg of consumedMessages) {
        assert.strictEqual(msg.table_name, tableName);
        assert.strictEqual(msg.operation_type, "upsert");
        assert.strictEqual(typeof msg.data, "object");
        assert.ok(!Array.isArray(msg.data));
      }
    });
  });

  describe("DELETE - single record", function () {
    it("should produce one event with data as an object", async function () {
      consumedMessages = [];

      const list = await testModel.list({});
      assert.ok(list.data.length > 0, "Need existing records to delete");
      const record = list.data[0];

      await testModel.remove({ id: record.id });

      await waitForMessages(1);

      assert.strictEqual(consumedMessages.length, 1);
      const msg = consumedMessages[0];
      assert.strictEqual(msg.table_name, tableName);
      assert.strictEqual(msg.operation_type, "delete");
      assert.strictEqual(typeof msg.data, "object");
      assert.ok(!Array.isArray(msg.data));
      assert.ok(msg.timestamp);
    });
  });

  describe("Event payload structure", function () {
    it("should contain table_name, operation_type, data (object), and ISO timestamp", async function () {
      consumedMessages = [];

      await testModel.insert({
        name: "Payload Test",
        email: "payload_" + Date.now() + "@example.com",
        status: 1,
      });

      await waitForMessages(1);

      const msg = consumedMessages[0];
      assert.ok(msg.hasOwnProperty("table_name"), "Missing table_name");
      assert.ok(msg.hasOwnProperty("operation_type"), "Missing operation_type");
      assert.ok(msg.hasOwnProperty("data"), "Missing data");
      assert.ok(msg.hasOwnProperty("timestamp"), "Missing timestamp");

      assert.strictEqual(typeof msg.table_name, "string");
      assert.strictEqual(typeof msg.operation_type, "string");
      assert.strictEqual(typeof msg.data, "object");
      assert.ok(!Array.isArray(msg.data), "data must be an object, not array");
      assert.strictEqual(typeof msg.timestamp, "string");

      // Validate ISO 8601 timestamp
      const ts = new Date(msg.timestamp);
      assert.ok(!isNaN(ts.getTime()), "timestamp should be valid ISO 8601");
    });
  });

  describe("No events for read operations", function () {
    it("should NOT produce events for list()", async function () {
      consumedMessages = [];
      await testModel.list({});
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.strictEqual(consumedMessages.length, 0);
    });

    it("should NOT produce events for find()", async function () {
      consumedMessages = [];
      await testModel.find({});
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.strictEqual(consumedMessages.length, 0);
    });
  });

  describe("Bulk 10,000 rows - INSERT", function () {
    const BULK_COUNT = 10000;

    it(`should produce ${BULK_COUNT} events for ${BULK_COUNT} inserted rows`, async function () {
      this.timeout(120000);
      consumedMessages = [];

      const rows = [];
      for (let i = 0; i < BULK_COUNT; i++) {
        rows.push({
          name: `User_${i}`,
          email: `bulk_insert_${i}_${Date.now()}@example.com`,
          status: i % 10,
        });
      }

      await testModel.insert({ data: rows });

      await waitForMessages(BULK_COUNT, 60000);

      assert.strictEqual(consumedMessages.length, BULK_COUNT);
      for (const msg of consumedMessages) {
        assert.strictEqual(msg.table_name, tableName);
        assert.strictEqual(msg.operation_type, "insert");
        assert.strictEqual(typeof msg.data, "object");
        assert.ok(!Array.isArray(msg.data));
      }
    });
  });

  describe("Bulk 10,000 rows - UPDATE", function () {
    const BULK_COUNT = 10000;

    it(`should produce ${BULK_COUNT} events for ${BULK_COUNT} updated rows`, async function () {
      this.timeout(120000);
      consumedMessages = [];

      // Fetch all rows directly (bypasses model's 200 size cap)
      const existing = db.query(
        `SELECT * FROM "${tableName}" LIMIT ${BULK_COUNT}`,
      );
      assert.ok(
        existing.length >= BULK_COUNT,
        `Need at least ${BULK_COUNT} records, got ${existing.length}`,
      );

      const rows = existing.slice(0, BULK_COUNT).map((r) => ({
        id: r.id,
        name: r.name + "_updated",
        email: r.email,
        status: (r.status || 0) + 1,
      }));

      await testModel.update({ data: rows });

      await waitForMessages(BULK_COUNT, 60000);

      assert.strictEqual(consumedMessages.length, BULK_COUNT);
      for (const msg of consumedMessages) {
        assert.strictEqual(msg.table_name, tableName);
        assert.strictEqual(msg.operation_type, "update");
        assert.strictEqual(typeof msg.data, "object");
        assert.ok(!Array.isArray(msg.data));
      }
    });
  });

  describe("Bulk 10,000 rows - DELETE", function () {
    const BULK_COUNT = 10000;

    it(`should produce ${BULK_COUNT} events for ${BULK_COUNT} deleted rows`, async function () {
      this.timeout(120000);
      consumedMessages = [];

      // Fetch all rows directly
      const existing = db.query(
        `SELECT * FROM "${tableName}" LIMIT ${BULK_COUNT}`,
      );
      assert.ok(
        existing.length >= BULK_COUNT,
        `Need at least ${BULK_COUNT} records, got ${existing.length}`,
      );

      for (const row of existing.slice(0, BULK_COUNT)) {
        await testModel.remove({ id: row.id });
      }

      await waitForMessages(BULK_COUNT, 60000);

      assert.strictEqual(consumedMessages.length, BULK_COUNT);
      for (const msg of consumedMessages) {
        assert.strictEqual(msg.table_name, tableName);
        assert.strictEqual(msg.operation_type, "delete");
        assert.strictEqual(typeof msg.data, "object");
        assert.ok(!Array.isArray(msg.data));
      }
    });
  });
});
