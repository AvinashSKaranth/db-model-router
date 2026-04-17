/**
 * JSON column consistency tests.
 *
 * Verifies that JSON/object columns preserve data integrity through
 * insert → read round-trips, specifically for:
 *   - Regular numbers
 *   - MAX_SAFE_INTEGER boundary values
 *   - Numbers stored as strings (e.g. large IDs, phone numbers)
 *   - Nested objects and arrays
 *   - Mixed types within a single JSON value
 *
 * Runs against all available adapters based on DB_TYPE env var.
 * Default: sqlite3 (no Docker needed).
 */
process.env.NODE_ENV = "TEST";
const crypto = require("crypto");
const assert = require("assert");
const model = require("../src/commons/model.js");

const DB_TYPE = (process.env.DB_TYPE || "sqlite3").toLowerCase();
const tableName = "json_" + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const STRING_PK_ADAPTERS = ["mongodb", "redis", "dynamodb"];
const primaryKey = DB_TYPE === "mongodb" ? "_id" : "id";
const modelStructure = {
  [primaryKey]: STRING_PK_ADAPTERS.includes(DB_TYPE) ? "string" : "integer",
  label: "required|string",
  meta: "object",
};

let db;
let testModel;

// Adapter-specific setup
const adapters = {
  sqlite3: {
    mod: () => require("../src/sqlite3/db.js"),
    connect: (d) => d.connect({ database: ":memory:" }),
    createTable: (d) =>
      d.query(
        `CREATE TABLE "${tableName}" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT NOT NULL, "meta" TEXT)`,
      ),
    dropTable: (d) => d.query(`DROP TABLE IF EXISTS "${tableName}"`),
  },
  mysql: {
    mod: () => require("../src/mysql/db.js"),
    connect: (d) =>
      d.connect({
        host: process.env.MYSQL_HOST || "localhost",
        port: parseInt(process.env.MYSQL_PORT || "3306"),
        user: process.env.MYSQL_USER || "root",
        password: process.env.MYSQL_PASSWORD || "password",
        database: process.env.MYSQL_DB || "test_db",
      }),
    createTable: (d) =>
      d.query(
        `CREATE TABLE IF NOT EXISTS \`${tableName}\` (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(255) NOT NULL, meta JSON) ENGINE=InnoDB`,
      ),
    dropTable: (d) => d.query(`DROP TABLE IF EXISTS \`${tableName}\``),
  },
  postgres: {
    mod: () => require("../src/postgres/db.js"),
    connect: (d) =>
      d.connect({
        host: process.env.PG_HOST || "localhost",
        port: parseInt(process.env.PG_PORT || "5432"),
        database: process.env.PG_DB || "test_db",
        user: process.env.PG_USER || "postgres",
        password: process.env.PG_PASSWORD || "password",
      }),
    createTable: (d) =>
      d.query(
        `CREATE TABLE ${tableName} (id SERIAL PRIMARY KEY, label VARCHAR NOT NULL, meta JSONB)`,
      ),
    dropTable: (d) => d.query(`DROP TABLE IF EXISTS ${tableName}`),
  },
  oracle: {
    mod: () => require("../src/oracle/db.js"),
    connect: (d) =>
      d.connect({
        host: process.env.ORACLE_HOST || "localhost",
        port: parseInt(process.env.ORACLE_PORT || "1521"),
        database: process.env.ORACLE_DB || "XEPDB1",
        user: process.env.ORACLE_USER || "system",
        password: process.env.ORACLE_PASSWORD || "oracle",
      }),
    createTable: (d) =>
      d.query(
        `/* ORACLE_NATIVE */ CREATE TABLE ${tableName} (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label VARCHAR2(255) NOT NULL, meta CLOB)`,
      ),
    dropTable: (d) =>
      d.query(`/* ORACLE_NATIVE */ DROP TABLE ${tableName}`).catch(() => {}),
  },
  mssql: {
    mod: () => require("../src/mssql/db.js"),
    connect: (d) =>
      d.connect({
        server: process.env.MSSQL_HOST || "localhost",
        port: parseInt(process.env.MSSQL_PORT || "1433"),
        database: process.env.MSSQL_DB || "master",
        user: process.env.MSSQL_USER || "sa",
        password: process.env.MSSQL_PASSWORD || "Password123!",
        options: { encrypt: false, trustServerCertificate: true },
      }),
    createTable: (d) =>
      d.query(
        `CREATE TABLE [${tableName}] (id INT IDENTITY(1,1) PRIMARY KEY, label NVARCHAR(255), meta NVARCHAR(MAX))`,
      ),
    dropTable: (d) =>
      d.query(`DROP TABLE IF EXISTS [${tableName}]`).catch(() => {}),
  },
  cockroachdb: {
    mod: () => require("../src/cockroachdb/db.js"),
    connect: (d) =>
      d.connect({
        host: process.env.CRDB_HOST || "localhost",
        port: parseInt(process.env.CRDB_PORT || "26257"),
        database: process.env.CRDB_NAME || "defaultdb",
        user: process.env.CRDB_USER || "root",
        password: process.env.CRDB_PASS || "",
      }),
    createTable: (d) =>
      d.query(
        `CREATE TABLE ${tableName} (id SERIAL PRIMARY KEY, label VARCHAR NOT NULL, meta JSONB)`,
      ),
    dropTable: (d) =>
      d.query(`DROP TABLE IF EXISTS ${tableName}`).catch(() => {}),
  },
  mongodb: {
    mod: () => require("../src/mongodb/db.js"),
    connect: (d) => {
      const host = process.env.MONGO_HOST || "localhost";
      const port = process.env.MONGO_PORT || 27017;
      const database = process.env.MONGO_DB || "test_db";
      d.connect({ host, port, database });
    },
    createTable: () => {},
    dropTable: (d) => d.query(tableName, "drop").catch(() => {}),
  },
  redis: {
    mod: () => require("../src/redis/db.js"),
    connect: (d) =>
      d.connect({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        primaryKey: "id",
      }),
    createTable: () => {},
    dropTable: () => {},
  },
  dynamodb: {
    mod: () => require("../src/dynamodb/db.js"),
    connect: (d) =>
      d.connect({
        endpoint: `http://${process.env.DYNAMODB_HOST || "localhost"}:${process.env.DYNAMODB_PORT || 8000}`,
        region: process.env.DYNAMODB_REGION || "us-east-1",
        accessKeyId: process.env.DYNAMODB_ACCESS_KEY || "fakeAccessKey",
        secretAccessKey: process.env.DYNAMODB_SECRET_KEY || "fakeSecretKey",
        primaryKey: "id",
      }),
    createTable: async () => {
      const {
        DynamoDBClient,
        CreateTableCommand,
        DescribeTableCommand,
      } = require("@aws-sdk/client-dynamodb");
      const endpoint = `http://${process.env.DYNAMODB_HOST || "localhost"}:${process.env.DYNAMODB_PORT || 8000}`;
      const client = new DynamoDBClient({
        endpoint,
        region: process.env.DYNAMODB_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.DYNAMODB_ACCESS_KEY || "fakeAccessKey",
          secretAccessKey: process.env.DYNAMODB_SECRET_KEY || "fakeSecretKey",
        },
      });
      await client.send(
        new CreateTableCommand({
          TableName: tableName,
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
          BillingMode: "PAY_PER_REQUEST",
        }),
      );
      let active = false;
      while (!active) {
        const desc = await client.send(
          new DescribeTableCommand({ TableName: tableName }),
        );
        if (desc.Table.TableStatus === "ACTIVE") active = true;
      }
    },
    dropTable: async () => {
      const {
        DynamoDBClient,
        DeleteTableCommand,
      } = require("@aws-sdk/client-dynamodb");
      const endpoint = `http://${process.env.DYNAMODB_HOST || "localhost"}:${process.env.DYNAMODB_PORT || 8000}`;
      const client = new DynamoDBClient({
        endpoint,
        region: process.env.DYNAMODB_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.DYNAMODB_ACCESS_KEY || "fakeAccessKey",
          secretAccessKey: process.env.DYNAMODB_SECRET_KEY || "fakeSecretKey",
        },
      });
      await client
        .send(new DeleteTableCommand({ TableName: tableName }))
        .catch(() => {});
    },
  },
};

const adapter = adapters[DB_TYPE];
if (!adapter) {
  console.error(`Unknown DB_TYPE: ${DB_TYPE}`);
  process.exit(1);
}

describe(`JSON Column Consistency (${DB_TYPE})`, function () {
  this.timeout(30000);

  before(async function () {
    db = adapter.mod();
    await adapter.connect(db);
    await adapter.createTable(db);
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(async function () {
    try {
      await adapter.dropTable(db);
    } catch (_) {}
    if (db.disconnect) await db.disconnect();
    else if (db.close) await db.close();
  });

  async function insertAndRead(label, meta) {
    const payload = { label };
    if (meta !== undefined) payload.meta = meta;
    const inserted = await testModel.insert(payload);
    const id = inserted[primaryKey];
    assert.ok(id, "should return a valid id");
    // MongoDB returns ObjectId — convert to string for byId
    const lookupId = typeof id === "object" && id.toString ? id.toString() : id;
    const record = await testModel.byId(lookupId);
    assert.ok(record, "byId should return the record");
    return record;
  }

  describe("Regular numbers in JSON", function () {
    it("should preserve small integers", async function () {
      const meta = { count: 42, zero: 0, negative: -7 };
      const record = await insertAndRead("small-ints", meta);
      assert.strictEqual(record.meta.count, 42);
      assert.strictEqual(record.meta.zero, 0);
      assert.strictEqual(record.meta.negative, -7);
    });

    it("should preserve floating point numbers", async function () {
      const meta = { price: 19.99, ratio: 0.333 };
      const record = await insertAndRead("floats", meta);
      assert.strictEqual(record.meta.price, 19.99);
      assert.strictEqual(record.meta.ratio, 0.333);
    });
  });

  describe("MAX_SAFE_INTEGER boundary values in JSON", function () {
    it("should preserve Number.MAX_SAFE_INTEGER exactly", async function () {
      const meta = { big: Number.MAX_SAFE_INTEGER };
      const record = await insertAndRead("max-safe", meta);
      assert.strictEqual(record.meta.big, Number.MAX_SAFE_INTEGER);
    });

    it("should preserve Number.MIN_SAFE_INTEGER exactly", async function () {
      const meta = { small: Number.MIN_SAFE_INTEGER };
      const record = await insertAndRead("min-safe", meta);
      assert.strictEqual(record.meta.small, Number.MIN_SAFE_INTEGER);
    });

    it("should preserve numbers just below MAX_SAFE_INTEGER", async function () {
      const val = Number.MAX_SAFE_INTEGER - 1;
      const meta = { val };
      const record = await insertAndRead("below-max-safe", meta);
      assert.strictEqual(record.meta.val, val);
    });

    it("should preserve beyond-MAX_SAFE_INTEGER numbers stored as strings", async function () {
      const meta = { huge: "9007199254740993" };
      const record = await insertAndRead("beyond-max-str", meta);
      assert.strictEqual(record.meta.huge, "9007199254740993");
    });
  });

  describe("Numbers as strings in JSON", function () {
    it("should preserve large numeric strings that exceed MAX_SAFE_INTEGER", async function () {
      const meta = {
        bigId: "9999999999999999999",
        phone19: "1234567890123456789",
      };
      const record = await insertAndRead("large-numeric-strings", meta);
      // These are too large for JS numbers — must stay as strings
      assert.strictEqual(typeof record.meta.bigId, "string");
      assert.strictEqual(record.meta.bigId, "9999999999999999999");
      assert.strictEqual(typeof record.meta.phone19, "string");
      assert.strictEqual(record.meta.phone19, "1234567890123456789");
    });

    it("should preserve strings with leading zeros", async function () {
      const meta = { zip: "00501", code: "007" };
      const record = await insertAndRead("leading-zeros", meta);
      // Leading zeros make these non-numeric — must stay as strings
      assert.strictEqual(record.meta.zip, "00501");
      assert.strictEqual(record.meta.code, "007");
    });

    it("should preserve non-numeric strings", async function () {
      const meta = { label: "abc123", empty: "", space: " " };
      const record = await insertAndRead("non-numeric-strings", meta);
      assert.strictEqual(record.meta.label, "abc123");
      assert.strictEqual(record.meta.empty, "");
      assert.strictEqual(record.meta.space, " ");
    });
  });

  describe("Nested objects and arrays in JSON", function () {
    it("should preserve nested objects", async function () {
      const meta = {
        address: {
          street: "123 Main St",
          city: "Springfield",
          geo: { lat: 39.7817, lng: -89.6501 },
        },
      };
      const record = await insertAndRead("nested-obj", meta);
      assert.strictEqual(record.meta.address.street, "123 Main St");
      assert.strictEqual(record.meta.address.geo.lat, 39.7817);
    });

    it("should preserve arrays", async function () {
      const meta = { tags: ["a", "b", "c"], scores: [100, 200, 300] };
      const record = await insertAndRead("arrays", meta);
      assert.deepStrictEqual(record.meta.tags, ["a", "b", "c"]);
      assert.deepStrictEqual(record.meta.scores, [100, 200, 300]);
    });

    it("should preserve arrays of objects", async function () {
      const meta = {
        items: [
          { sku: "A1", qty: 2 },
          { sku: "B2", qty: 5 },
        ],
      };
      const record = await insertAndRead("array-of-objects", meta);
      assert.strictEqual(record.meta.items.length, 2);
      assert.strictEqual(record.meta.items[0].sku, "A1");
      assert.strictEqual(record.meta.items[1].qty, 5);
    });
  });

  describe("Mixed types in a single JSON value", function () {
    it("should preserve a complex mixed-type object", async function () {
      const meta = {
        name: "test",
        count: 42,
        price: 9.99,
        active: true,
        tags: ["x", "y"],
        nested: { a: 1, b: "two" },
        nothing: null,
        bigSafe: Number.MAX_SAFE_INTEGER,
        bigStr: "9007199254740993",
      };
      const record = await insertAndRead("mixed", meta);
      assert.strictEqual(record.meta.name, "test");
      assert.strictEqual(record.meta.count, 42);
      assert.strictEqual(record.meta.price, 9.99);
      assert.strictEqual(record.meta.active, true);
      assert.deepStrictEqual(record.meta.tags, ["x", "y"]);
      assert.strictEqual(record.meta.nested.a, 1);
      assert.strictEqual(record.meta.nested.b, "two");
      assert.strictEqual(record.meta.nothing, null);
      assert.strictEqual(record.meta.bigSafe, Number.MAX_SAFE_INTEGER);
      assert.strictEqual(record.meta.bigStr, "9007199254740993");
    });
  });

  describe("JSON round-trip through update and patch", function () {
    it("should preserve JSON through update", async function () {
      const meta = { version: 1, data: { key: "original" } };
      const inserted = await testModel.insert({ label: "update-json", meta });
      const id = inserted[primaryKey];
      const lookupId =
        typeof id === "object" && id.toString ? id.toString() : id;
      const updatedMeta = {
        version: 2,
        data: { key: "updated" },
        extra: true,
      };
      const updated = await testModel.update({
        [primaryKey]: lookupId,
        label: "update-json",
        meta: updatedMeta,
      });
      assert.ok(updated, "update should return the updated record");
      assert.strictEqual(updated.meta.version, 2);
      assert.strictEqual(updated.meta.data.key, "updated");
      assert.strictEqual(updated.meta.extra, true);
    });

    it("should preserve JSON through patch", async function () {
      const meta = {
        score: 100,
        bigVal: Number.MAX_SAFE_INTEGER,
        strNum: "12345678901234567890",
      };
      const inserted = await testModel.insert({ label: "patch-json", meta });
      const id = inserted[primaryKey];
      const lookupId =
        typeof id === "object" && id.toString ? id.toString() : id;
      const newMeta = {
        score: 200,
        bigVal: Number.MAX_SAFE_INTEGER,
        strNum: "12345678901234567890",
        added: "new",
      };
      const patched = await testModel.patch({
        [primaryKey]: lookupId,
        meta: newMeta,
      });
      assert.strictEqual(patched.meta.score, 200);
      assert.strictEqual(patched.meta.bigVal, Number.MAX_SAFE_INTEGER);
      assert.strictEqual(patched.meta.strNum, "12345678901234567890");
      assert.strictEqual(patched.meta.added, "new");
    });
  });

  describe("Edge cases", function () {
    it("should handle empty object", async function () {
      const record = await insertAndRead("empty-obj", {});
      assert.deepStrictEqual(record.meta, {});
    });

    it("should handle empty array", async function () {
      const record = await insertAndRead("empty-arr", []);
      assert.deepStrictEqual(record.meta, []);
    });
  });
});
