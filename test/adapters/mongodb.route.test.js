process.env.NODE_ENV = "TEST";
const crypto = require("crypto");
const assert = require("assert");
const express = require("express");
const request = require("supertest");
const db = require("../../src/mongodb/db.js");
const model = require("../../src/commons/model.js");
const route = require("../../src/commons/route.js");

const collectionName =
  "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const modelStructure = {
  _id: "string",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "_id";

let app;
let testModel;

describe("MongoDB Route REST API", function () {
  before(async function () {
    this.timeout(10000);
    const host = process.env.MONGO_HOST || "localhost";
    const port = process.env.MONGO_PORT || 27017;
    const database = process.env.MONGO_DB || "test_db";
    db.connect({ host, port, database });
    testModel = model(db, collectionName, modelStructure, primaryKey, [
      primaryKey,
    ]);
    app = express();
    app.use(express.json());
    app.use("/test", route(testModel));
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

  describe("Single Record Operations", function () {
    let insertedId;

    it("POST /test/add should insert a record and return 200", function (done) {
      request(app)
        .post("/test/add")
        .send({ name: "Alice", email: "alice@example.com", age: 30 })
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert.ok(res.body._id, "should return a valid _id");
          assert.strictEqual(res.body.name, "Alice");
          assert.strictEqual(res.body.email, "alice@example.com");
          assert.strictEqual(res.body.age, 30);
          insertedId = res.body._id;
        })
        .end(done);
    });

    it("GET /test/:pk should return 200 with the correct record", function (done) {
      request(app)
        .get("/test/" + insertedId)
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert.strictEqual(String(res.body._id), String(insertedId));
          assert.strictEqual(res.body.name, "Alice");
          assert.strictEqual(res.body.email, "alice@example.com");
        })
        .end(done);
    });

    it("GET /test/:nonexistent_pk should return 404", function (done) {
      request(app)
        .get("/test/000000000000000000000000")
        .expect("Content-Type", /json/)
        .expect(404)
        .expect((res) => {
          assert.strictEqual(res.body.message, "Not Found");
          assert.strictEqual(res.body.type, "danger");
        })
        .end(done);
    });

    it("PUT /test/:pk should update the record and return 200", function (done) {
      request(app)
        .put("/test/" + insertedId)
        .send({
          name: "Alice Updated",
          email: "alice_updated@example.com",
          age: 31,
        })
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert.strictEqual(String(res.body._id), String(insertedId));
          assert.strictEqual(res.body.name, "Alice Updated");
          assert.strictEqual(res.body.email, "alice_updated@example.com");
          assert.strictEqual(res.body.age, 31);
        })
        .end(done);
    });

    it("PUT /test/:nonexistent_pk should return 404", function (done) {
      request(app)
        .put("/test/000000000000000000000000")
        .send({ name: "Ghost", email: "ghost@example.com", age: 0 })
        .expect("Content-Type", /json/)
        .expect(404)
        .expect((res) => {
          assert.strictEqual(res.body.message, "Not Found");
        })
        .end(done);
    });

    it("PATCH /test/:pk should partially update the record and return 200", function (done) {
      request(app)
        .patch("/test/" + insertedId)
        .send({ name: "Alice Patched" })
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert.strictEqual(String(res.body._id), String(insertedId));
          assert.strictEqual(res.body.name, "Alice Patched");
          assert.strictEqual(res.body.email, "alice_updated@example.com");
          assert.strictEqual(res.body.age, 31);
        })
        .end(done);
    });

    it("PATCH /test/:nonexistent_pk should return 404", function (done) {
      request(app)
        .patch("/test/000000000000000000000000")
        .send({ name: "Ghost" })
        .expect("Content-Type", /json/)
        .expect(404)
        .expect((res) => {
          assert.strictEqual(res.body.message, "Not Found");
        })
        .end(done);
    });

    it("DELETE /test/:pk should remove the record and return 200", function (done) {
      request(app)
        .delete("/test/" + insertedId)
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert.ok(res.body.message, "should return a message");
        })
        .end(done);
    });

    it("DELETE /test/:nonexistent_pk should return 404", function (done) {
      request(app)
        .delete("/test/000000000000000000000000")
        .expect("Content-Type", /json/)
        .expect(404)
        .expect((res) => {
          assert.strictEqual(res.body.message, "Not Found");
        })
        .end(done);
    });
  });

  describe("Bulk and List Operations", function () {
    before(async function () {
      // Clear any leftover data
      const all = await testModel.find({});
      for (const r of all.data) {
        await testModel.remove(r._id);
      }
    });

    it("GET /test/ should return 200 with paginated list", function (done) {
      request(app)
        .get("/test/")
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert.ok(Array.isArray(res.body.data), "data should be an array");
          assert.ok(
            typeof res.body.count === "number",
            "count should be a number",
          );
        })
        .end(done);
    });

    it("POST /test/ with data array should bulk insert and return 200", function (done) {
      request(app)
        .post("/test/")
        .send({
          data: [
            { name: "Bulk1", email: "bulk1@example.com", age: 20 },
            { name: "Bulk2", email: "bulk2@example.com", age: 21 },
            { name: "Bulk3", email: "bulk3@example.com", age: 22 },
          ],
        })
        .expect("Content-Type", /json/)
        .expect(200)
        .expect((res) => {
          assert.strictEqual(
            res.body.rows,
            3,
            "rows should match input length",
          );
          assert.strictEqual(res.body.type, "success");
        })
        .end(done);
    });

    it("PUT /test/ with data array should bulk update and return 200", async function () {
      const existing = await testModel.find({});
      const toUpdate = existing.data.slice(0, 2).map((r) => ({
        _id: r._id.toString(),
        name: r.name + " Updated",
        email: r.email,
        age: r.age + 1,
      }));

      const res = await request(app)
        .put("/test/")
        .send({ data: toUpdate })
        .expect("Content-Type", /json/)
        .expect(200);

      assert.strictEqual(res.body.rows, 2, "rows should match update count");
      assert.strictEqual(res.body.type, "success");
    });

    it("DELETE /test/ with data should bulk remove and return 200", async function () {
      // Insert records to remove
      await testModel.insert({
        data: [
          { name: "ToRemove", email: "rm1@example.com", age: 99 },
          { name: "ToRemove", email: "rm2@example.com", age: 99 },
        ],
      });

      const res = await request(app)
        .delete("/test/")
        .send({ data: { name: "ToRemove" } })
        .expect("Content-Type", /json/)
        .expect(200);

      assert.ok(res.body.message, "should return a removal message");

      // Verify records are gone
      const check = await testModel.find({ name: "ToRemove" });
      assert.strictEqual(check.count, 0, "removed records should not exist");
    });
  });
});
