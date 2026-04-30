process.env.NODE_ENV = "TEST";
const crypto = require("crypto");
const assert = require("assert");
const express = require("express");
const request = require("supertest");
const db = require("../src/sqlite3/db.js");
const model = require("../src/commons/model.js");
const route = require("../src/commons/route.js");

const tableName = "filter_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

let app;
let testModel;

describe("Filter Operators — Route Integration (SQLite3)", function () {
  before(function () {
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "age" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active'
      )`,
    );
    testModel = model(
      db,
      tableName,
      {
        id: "integer",
        name: "required|string",
        email: "required|string",
        age: "required|integer",
        status: "string",
      },
      "id",
      ["id"],
    );
    app = express();
    app.use(express.json());
    app.use("/items", route(testModel));

    // Seed test data
    testModel.insert({
      data: [
        {
          name: "Alice Johnson",
          email: "alice@example.com",
          age: 30,
          status: "active",
        },
        {
          name: "Bob Smith",
          email: "bob@example.com",
          age: 25,
          status: "active",
        },
        {
          name: "Charlie Brown",
          email: "charlie@example.com",
          age: 35,
          status: "inactive",
        },
        {
          name: "Diana Prince",
          email: "diana@example.com",
          age: 28,
          status: "blocked",
        },
        {
          name: "Eve Johnson",
          email: "eve@example.com",
          age: 22,
          status: "active",
        },
      ],
    });
  });

  after(function () {
    db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    db.disconnect();
  });

  describe("LIKE operator (%value%)", function () {
    it("GET /items/?name=%Johnson% should return records containing Johnson", function (done) {
      request(app)
        .get("/items/")
        .query({ name: "%Johnson%" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 2);
          const names = res.body.data.map((r) => r.name);
          assert.ok(names.includes("Alice Johnson"));
          assert.ok(names.includes("Eve Johnson"));
        })
        .end(done);
    });

    it("GET /items/?name=Alice% should return records starting with Alice", function (done) {
      request(app)
        .get("/items/")
        .query({ name: "Alice%" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 1);
          assert.strictEqual(res.body.data[0].name, "Alice Johnson");
        })
        .end(done);
    });

    it("GET /items/?name=%Smith should return records ending with Smith", function (done) {
      request(app)
        .get("/items/")
        .query({ name: "%Smith" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 1);
          assert.strictEqual(res.body.data[0].name, "Bob Smith");
        })
        .end(done);
    });
  });

  describe("NOT LIKE operator (!%value%)", function () {
    it("GET /items/?name=!%Johnson% should exclude records containing Johnson", function (done) {
      request(app)
        .get("/items/")
        .query({ name: "!%Johnson%" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 3);
          const names = res.body.data.map((r) => r.name);
          assert.ok(!names.includes("Alice Johnson"));
          assert.ok(!names.includes("Eve Johnson"));
        })
        .end(done);
    });
  });

  describe("Greater than (>) operator", function () {
    it("GET /items/?age=>30 should return records with age > 30", function (done) {
      request(app)
        .get("/items/")
        .query({ age: ">30" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 1);
          assert.strictEqual(res.body.data[0].name, "Charlie Brown");
          assert.strictEqual(res.body.data[0].age, 35);
        })
        .end(done);
    });
  });

  describe("Greater than or equal (>=) operator", function () {
    it("GET /items/?age=>=30 should return records with age >= 30", function (done) {
      request(app)
        .get("/items/")
        .query({ age: ">=30" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 2);
          const ages = res.body.data.map((r) => r.age).sort();
          assert.deepStrictEqual(ages, [30, 35]);
        })
        .end(done);
    });
  });

  describe("Less than (<) operator", function () {
    it("GET /items/?age=<25 should return records with age < 25", function (done) {
      request(app)
        .get("/items/")
        .query({ age: "<25" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 1);
          assert.strictEqual(res.body.data[0].name, "Eve Johnson");
          assert.strictEqual(res.body.data[0].age, 22);
        })
        .end(done);
    });
  });

  describe("Less than or equal (<=) operator", function () {
    it("GET /items/?age=<=25 should return records with age <= 25", function (done) {
      request(app)
        .get("/items/")
        .query({ age: "<=25" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 2);
          const ages = res.body.data.map((r) => r.age).sort();
          assert.deepStrictEqual(ages, [22, 25]);
        })
        .end(done);
    });
  });

  describe("Not equal (!=) operator", function () {
    it("GET /items/?status=!active should exclude active records", function (done) {
      request(app)
        .get("/items/")
        .query({ status: "!active" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 2);
          const statuses = res.body.data.map((r) => r.status);
          assert.ok(!statuses.includes("active"));
          assert.ok(statuses.includes("inactive"));
          assert.ok(statuses.includes("blocked"));
        })
        .end(done);
    });
  });

  describe("IN operator", function () {
    it("GET /items/?status=in(active,blocked) should return matching records", function (done) {
      request(app)
        .get("/items/")
        .query({ status: "in(active,blocked)" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 4);
          const statuses = res.body.data.map((r) => r.status);
          for (const s of statuses) {
            assert.ok(["active", "blocked"].includes(s));
          }
        })
        .end(done);
    });
  });

  describe("NOT IN operator", function () {
    it("GET /items/?status=!in(active,blocked) should exclude matching records", function (done) {
      request(app)
        .get("/items/")
        .query({ status: "!in(active,blocked)" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 1);
          assert.strictEqual(res.body.data[0].status, "inactive");
        })
        .end(done);
    });
  });

  describe("Combined operators", function () {
    it("GET /items/?age=>=25&status=active should combine filters with AND", function (done) {
      request(app)
        .get("/items/")
        .query({ age: ">=25", status: "active" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 2);
          for (const r of res.body.data) {
            assert.ok(r.age >= 25);
            assert.strictEqual(r.status, "active");
          }
        })
        .end(done);
    });

    it("GET /items/?name=%Johnson%&age=>25 should combine LIKE and > filters", function (done) {
      request(app)
        .get("/items/")
        .query({ name: "%Johnson%", age: ">25" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 1);
          assert.strictEqual(res.body.data[0].name, "Alice Johnson");
        })
        .end(done);
    });
  });

  describe("Exact match (default =)", function () {
    it("GET /items/?status=active should still work as exact match", function (done) {
      request(app)
        .get("/items/")
        .query({ status: "active" })
        .expect(200)
        .expect((res) => {
          assert.strictEqual(res.body.count, 3);
          for (const r of res.body.data) {
            assert.strictEqual(r.status, "active");
          }
        })
        .end(done);
    });
  });
});
