process.env.NODE_ENV = "TEST";
const assert = require("assert");
const express = require("express");
const request = require("supertest");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");
const route = require("../../src/commons/route.js");

const tableName = "test_query_method_" + Date.now();
const modelStructure = {
  id: "integer",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "id";

let app;
let testModel;

describe("HTTP QUERY Method Support in route()", function () {
  before(async function () {
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "age" INTEGER NOT NULL
      )`,
    );
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey], {
      search_columns: ["name", "email"],
    });

    app = express();
    app.use(express.json());
    app.use("/items", route(testModel));

    // Seed test records
    await testModel.insert({
      data: [
        { name: "Alice", email: "alice@example.com", age: 30 },
        { name: "Bob", email: "bob@example.com", age: 25 },
        { name: "Charlie", email: "charlie@example.com", age: 35 },
      ],
    });
  });

  after(function () {
    try {
      db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    } catch (_) {}
    db.disconnect();
  });

  it("QUERY /items should list records using body filter criteria", function (done) {
    request(app)
      .query("/items")
      .send({ name: "Bob" })
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((res) => {
        assert.ok(res.body.data, "response should have data array");
        assert.strictEqual(res.body.count, 1);
        assert.strictEqual(res.body.data[0].name, "Bob");
      })
      .end(done);
  });

  it("QUERY /items should support pagination and sorting in request body", function (done) {
    request(app)
      .query("/items")
      .send({ page: 0, limit: 2, sort: ["-age"] })
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((res) => {
        assert.strictEqual(res.body.data.length, 2);
        assert.strictEqual(res.body.count, 3);
        assert.strictEqual(res.body.data[0].name, "Charlie"); // age 35
        assert.strictEqual(res.body.data[1].name, "Alice"); // age 30
      })
      .end(done);
  });

  it("QUERY /items should support free-text search in request body", function (done) {
    request(app)
      .query("/items")
      .send({ search: "alice" })
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((res) => {
        assert.strictEqual(res.body.count, 1);
        assert.strictEqual(res.body.data[0].name, "Alice");
      })
      .end(done);
  });

  it("QUERY /items should support column projection select_columns in request body", function (done) {
    request(app)
      .query("/items")
      .send({ select_columns: ["name"] })
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((res) => {
        assert.ok(res.body.data.length > 0);
        assert.ok(res.body.data[0].name !== undefined);
        assert.strictEqual(res.body.data[0].age, undefined);
        assert.strictEqual(res.body.data[0].email, undefined);
      })
      .end(done);
  });

  it("QUERY /items/:pk should retrieve single record with body-based projection", function (done) {
    request(app)
      .query("/items/1")
      .send({ select_columns: ["name", "email"] })
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((res) => {
        assert.strictEqual(res.body.name, "Alice");
        assert.strictEqual(res.body.email, "alice@example.com");
        assert.strictEqual(res.body.age, undefined);
      })
      .end(done);
  });

  it("QUERY /items/:pk should return 404 for nonexistent id", function (done) {
    request(app)
      .query("/items/99999")
      .send({})
      .expect(404)
      .expect((res) => {
        assert.strictEqual(res.body.message, "Not Found");
        assert.strictEqual(res.body.type, "danger");
      })
      .end(done);
  });
});
