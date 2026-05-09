process.env.NODE_ENV = "TEST";

const assert = require("assert");

describe("Kafka Producer Service", function () {
  let kafka;

  beforeEach(function () {
    // Clear module cache to get fresh state for each test
    delete require.cache[require.resolve("../src/commons/kafka.js")];
    kafka = require("../src/commons/kafka.js");
  });

  describe("kafka.init", function () {
    it("should return false when KAFKA_BROKER is not set", async function () {
      delete process.env.KAFKA_BROKER;
      const result = await kafka.init();
      assert.strictEqual(result, false);
      assert.strictEqual(kafka.status(), false);
    });

    it("should return false when broker option is empty", async function () {
      const result = await kafka.init({ broker: "" });
      assert.strictEqual(result, false);
      assert.strictEqual(kafka.status(), false);
    });

    it("should return false when broker is unreachable", async function () {
      this.timeout(20000);
      const result = await kafka.init({ broker: "localhost:99999" });
      assert.strictEqual(result, false);
    });
  });

  describe("kafka.produce", function () {
    it("should not throw when Kafka is not enabled", async function () {
      delete process.env.KAFKA_BROKER;
      await kafka.init();
      await kafka.produce("test_table", "insert", { id: 1, name: "test" });
    });

    it("should not throw when called with array data and Kafka is disabled", async function () {
      delete process.env.KAFKA_BROKER;
      await kafka.init();
      await kafka.produce("test_table", "insert", [
        { id: 1, name: "test1" },
        { id: 2, name: "test2" },
      ]);
    });
  });

  describe("kafka.disconnect", function () {
    it("should not throw when Kafka was never initialized", async function () {
      await kafka.disconnect();
    });
  });

  describe("kafka.status", function () {
    it("should return false when not initialized", function () {
      assert.strictEqual(kafka.status(), false);
    });

    it("should return false after failed initialization", async function () {
      delete process.env.KAFKA_BROKER;
      await kafka.init();
      assert.strictEqual(kafka.status(), false);
    });
  });
});
