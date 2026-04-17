process.env.NODE_ENV = "TEST";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const db = require("../src/sqlite3/db.js");
const model = require("../src/commons/model.js");
const {
  toCSV,
  toXML,
  applySelect,
  extractReservedParams,
} = require("../src/commons/model.js");
const { generateOpenAPISpec } = require("../src/cli/generate-openapi.js");
const {
  generateAppJs,
  generateLoggerMiddleware,
  generateEnvExample,
} = require("../src/cli/generate-app.js");
const {
  introspectSQLite3,
  generateModelFile,
  safeVarName,
} = require("../src/cli/generate-model.js");

const TEST_DB = path.join(
  __dirname,
  "test_features_" + crypto.randomUUID().slice(0, 8) + ".db",
);

describe("Feature Expansion Tests", function () {
  before(function () {
    const rawDb = new Database(TEST_DB);
    rawDb.exec(`
      CREATE TABLE users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER,
        bio TEXT DEFAULT '',
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_users_email ON users(email);
      CREATE TABLE posts (
        post_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        status INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );
      CREATE TABLE comments (
        comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(post_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );
    `);
    rawDb.close();
  });

  after(function () {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe("Optional db param on model()", function () {
    before(function () {
      // Initialize the singleton so model() without db works
      const restRouter = require("../src/index.js");
      restRouter.init("sqlite3");
      restRouter.db.connect({ database: TEST_DB });
    });

    after(function () {
      db.disconnect();
    });

    it("should create a model without passing db (uses singleton)", function () {
      const users = model(
        "users",
        { name: "required|string", email: "required|string", age: "integer" },
        "user_id",
        ["email"],
      );
      assert.strictEqual(users.table, "users");
      assert.strictEqual(users.pk, "user_id");
    });

    it("should insert and retrieve using singleton model", async function () {
      const users = model(
        "users",
        { name: "required|string", email: "required|string", age: "integer" },
        "user_id",
        ["email"],
      );
      const inserted = await users.insert({
        name: "Singleton",
        email: "single@test.com",
        age: 30,
      });
      assert.ok(inserted);
      assert.ok(inserted.user_id > 0);
      const found = await users.byId(inserted.user_id);
      assert.strictEqual(found.name, "Singleton");
    });

    it("should still work with explicit db param (backward compat)", function () {
      const users = model(
        db,
        "users",
        { name: "required|string", email: "required|string" },
        "user_id",
        ["email"],
      );
      assert.strictEqual(users.table, "users");
      assert.strictEqual(users.pk, "user_id");
    });
  });

  describe("Field Selection (select_columns)", function () {
    let users;

    before(function () {
      db.connect({ database: TEST_DB });
      users = model(
        db,
        "users",
        {
          name: "required|string",
          email: "required|string",
          age: "integer",
          bio: "string",
        },
        "user_id",
        ["email"],
      );
    });

    after(function () {
      db.disconnect();
    });

    it("should return only selected columns in find()", async function () {
      await users.insert({
        name: "SelectTest",
        email: "select@test.com",
        age: 25,
      });
      const result = await users.find({
        select_columns: "name,email",
        name: "SelectTest",
      });
      assert.ok(result.data.length > 0);
      const record = result.data[0];
      assert.ok(record.hasOwnProperty("name"));
      assert.ok(record.hasOwnProperty("email"));
      assert.ok(!record.hasOwnProperty("age"));
      assert.ok(!record.hasOwnProperty("user_id"));
    });

    it("should return only selected columns in findOne()", async function () {
      const record = await users.findOne({
        select_columns: "name",
        email: "select@test.com",
      });
      assert.ok(record);
      assert.ok(record.hasOwnProperty("name"));
      assert.ok(!record.hasOwnProperty("email"));
    });

    it("should return only selected columns in list()", async function () {
      const result = await users.list({
        select_columns: "user_id,name",
        page: 0,
        size: 10,
      });
      assert.ok(result.data.length > 0);
      const record = result.data[0];
      assert.ok(record.hasOwnProperty("user_id"));
      assert.ok(record.hasOwnProperty("name"));
      assert.ok(!record.hasOwnProperty("email"));
    });

    it("should return only selected columns in byId()", async function () {
      const all = await users.list({ page: 0, size: 1 });
      const id = all.data[0].user_id;
      const record = await users.byId(id, { select_columns: ["name", "age"] });
      assert.ok(record);
      assert.ok(record.hasOwnProperty("name"));
      assert.ok(record.hasOwnProperty("age"));
      assert.ok(!record.hasOwnProperty("email"));
    });
  });

  describe("Output Format Helpers", function () {
    it("toCSV should convert array to CSV string", function () {
      const data = [
        { id: 1, name: "Alice", age: 30 },
        { id: 2, name: "Bob", age: 25 },
      ];
      const csv = toCSV(data);
      assert.ok(csv.startsWith("id,name,age"));
      assert.ok(csv.includes("1,Alice,30"));
      assert.ok(csv.includes("2,Bob,25"));
    });

    it("toCSV should handle commas and quotes in values", function () {
      const data = [{ id: 1, name: 'O"Brien', desc: "hello, world" }];
      const csv = toCSV(data);
      assert.ok(csv.includes('"O""Brien"'));
      assert.ok(csv.includes('"hello, world"'));
    });

    it("toXML should convert array to XML string", function () {
      const data = [{ id: 1, name: "Alice" }];
      const xml = toXML(data);
      assert.ok(xml.includes("<?xml"));
      assert.ok(xml.includes("<records>"));
      assert.ok(xml.includes("<id>1</id>"));
      assert.ok(xml.includes("<name>Alice</name>"));
    });

    it("toXML should escape special characters", function () {
      const data = [{ id: 1, name: "A<B&C" }];
      const xml = toXML(data);
      assert.ok(xml.includes("A&lt;B&amp;C"));
    });
  });

  describe("extractReservedParams", function () {
    it("should extract and remove select_columns", function () {
      const data = { name: "Alice", select_columns: "name,email", age: 30 };
      const { select_columns } = extractReservedParams(data);
      assert.deepStrictEqual(select_columns, ["name", "email"]);
      assert.ok(!data.hasOwnProperty("select_columns"));
    });

    it("should extract and remove output_content_type", function () {
      const data = { name: "Alice", output_content_type: "csv" };
      const { output_content_type } = extractReservedParams(data);
      assert.strictEqual(output_content_type, "csv");
      assert.ok(!data.hasOwnProperty("output_content_type"));
    });

    it("should return null when params not present", function () {
      const data = { name: "Alice" };
      const { select_columns, output_content_type } =
        extractReservedParams(data);
      assert.strictEqual(select_columns, null);
      assert.strictEqual(output_content_type, null);
    });
  });

  describe("Partial Update (PATCH)", function () {
    let users;

    before(function () {
      db.connect({ database: TEST_DB });
      users = model(
        db,
        "users",
        {
          name: "required|string",
          email: "required|string",
          age: "integer",
          bio: "string",
        },
        "user_id",
        ["email"],
      );
    });

    after(function () {
      db.disconnect();
    });

    it("should patch only provided fields", async function () {
      const inserted = await users.insert({
        name: "PatchMe",
        email: "patch@test.com",
        age: 20,
      });
      const patched = await users.patch({ user_id: inserted.user_id, age: 99 });
      assert.ok(patched);
      assert.strictEqual(patched.age, 99);
      assert.strictEqual(patched.name, "PatchMe"); // unchanged
      assert.strictEqual(patched.email, "patch@test.com"); // unchanged
    });

    it("should reject patch without primary key", async function () {
      try {
        await users.patch({ name: "NoPK" });
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err.message.includes("Primary key is required"));
      }
    });

    it("should ignore unknown fields in patch", async function () {
      const all = await users.list({ page: 0, size: 1 });
      const id = all.data[0].user_id;
      const patched = await users.patch({
        user_id: id,
        unknown_field: "ignored",
        name: "Patched",
      });
      assert.ok(patched);
      assert.strictEqual(patched.name, "Patched");
      assert.ok(!patched.hasOwnProperty("unknown_field"));
    });
  });

  describe("CLI --tables Filter", function () {
    let models;

    before(async function () {
      db.connect({ database: TEST_DB });
      models = await introspectSQLite3(db);
      db.disconnect();
    });

    it("should have all 3 tables from introspection", function () {
      assert.strictEqual(models.length, 3);
    });

    it("should filter models by --tables simulation", function () {
      const tableSpecs = "users,posts".split(",");
      const allowedTables = new Set(tableSpecs);
      const filtered = models.filter((m) => allowedTables.has(m.table));
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.find((m) => m.table === "users"));
      assert.ok(filtered.find((m) => m.table === "posts"));
    });

    it("should include parent tables from dot notation", function () {
      const tableSpecs = "posts.comments".split(",");
      const allowedTables = new Set();
      for (const spec of tableSpecs) {
        if (spec.includes(".")) {
          const parts = spec.split(".");
          for (const p of parts) allowedTables.add(p);
        } else {
          allowedTables.add(spec);
        }
      }
      const filtered = models.filter((m) => allowedTables.has(m.table));
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.find((m) => m.table === "posts"));
      assert.ok(filtered.find((m) => m.table === "comments"));
    });
  });

  describe("OpenAPI Spec Generation", function () {
    it("should generate valid OpenAPI 3.0 spec", function () {
      const models = [
        {
          table: "users",
          primary_key: "user_id",
          structure: {
            name: "required|string",
            email: "required|string",
            age: "integer",
          },
        },
        {
          table: "posts",
          primary_key: "post_id",
          structure: {
            user_id: "required|integer",
            title: "required|string",
            body: "string",
          },
        },
      ];
      const spec = generateOpenAPISpec(models);
      assert.strictEqual(spec.openapi, "3.0.3");
      assert.ok(spec.paths["/api/users/"]);
      assert.ok(spec.paths["/api/users/{user_id}"]);
      assert.ok(spec.paths["/api/posts/"]);
      assert.ok(spec.paths["/api/posts/{post_id}"]);
      assert.ok(spec.components.schemas.Users);
      assert.ok(spec.components.schemas.Posts);
    });

    it("should include PATCH endpoint in spec", function () {
      const models = [
        {
          table: "users",
          primary_key: "id",
          structure: { name: "required|string" },
        },
      ];
      const spec = generateOpenAPISpec(models);
      assert.ok(spec.paths["/api/users/{id}"].patch);
      assert.strictEqual(
        spec.paths["/api/users/{id}"].patch.summary,
        "Partial update a users",
      );
    });

    it("should include select_columns and output_content_type params", function () {
      const models = [
        { table: "items", primary_key: "id", structure: { name: "string" } },
      ];
      const spec = generateOpenAPISpec(models);
      const listParams = spec.paths["/api/items/"].get.parameters;
      assert.ok(listParams.find((p) => p.name === "select_columns"));
      assert.ok(listParams.find((p) => p.name === "output_content_type"));
    });

    it("should map validation types to OpenAPI types", function () {
      const models = [
        {
          table: "test",
          primary_key: "id",
          structure: {
            count: "required|integer",
            price: "required|numeric",
            meta: "object",
            label: "string",
          },
        },
      ];
      const spec = generateOpenAPISpec(models);
      const props = spec.components.schemas.Test.properties;
      assert.strictEqual(props.count.type, "integer");
      assert.strictEqual(props.price.type, "number");
      assert.strictEqual(props.meta.type, "object");
      assert.strictEqual(props.label.type, "string");
    });
  });

  describe("generate-app Helpers", function () {
    it("should generate valid app.js content", function () {
      const content = generateAppJs("postgres");
      assert.ok(content.includes('init("postgres")'));
      assert.ok(content.includes("express()"));
      assert.ok(content.includes('require("./middleware/logger")'));
      assert.ok(content.includes('require("./routes")'));
      assert.ok(content.includes("/health"));
    });

    it("should generate logger middleware", function () {
      const content = generateLoggerMiddleware();
      assert.ok(content.includes("module.exports"));
      assert.ok(content.includes("req, res, next"));
      assert.ok(content.includes("res.on"));
    });

    it("should generate .env.example for mysql", function () {
      const content = generateEnvExample("mysql");
      assert.ok(content.includes("DB_HOST=localhost"));
      assert.ok(content.includes("DB_PORT=3306"));
    });

    it("should generate .env.example for sqlite3", function () {
      const content = generateEnvExample("sqlite3");
      assert.ok(content.includes("DB_NAME=./data.db"));
    });

    it("should generate .env.example for postgres", function () {
      const content = generateEnvExample("postgres");
      assert.ok(content.includes("DB_PORT=5432"));
    });
  });

  describe("applySelect helper", function () {
    it("should pick specified keys from object", function () {
      const result = applySelect(
        { id: 1, name: "A", email: "a@b.c", age: 30 },
        ["name", "email"],
      );
      assert.deepStrictEqual(result, { name: "A", email: "a@b.c" });
    });

    it("should pick specified keys from array of objects", function () {
      const data = [
        { id: 1, name: "A", age: 30 },
        { id: 2, name: "B", age: 25 },
      ];
      const result = applySelect(data, ["name"]);
      assert.deepStrictEqual(result, [{ name: "A" }, { name: "B" }]);
    });

    it("should return data unchanged when no columns specified", function () {
      const data = { id: 1, name: "A" };
      const result = applySelect(data, null);
      assert.deepStrictEqual(result, data);
    });
  });
});
