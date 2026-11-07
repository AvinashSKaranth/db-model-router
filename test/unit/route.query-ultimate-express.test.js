process.env.NODE_ENV = "TEST";
const assert = require("assert");
const request = require("supertest");
const uExpress = require("ultimate-express");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");
const route = require("../../src/commons/route.js");

describe("HTTP QUERY Method Support with ultimate-express", function () {
  const tableName = "test_ue_query_" + Date.now();
  const structure = {
    id: "integer",
    name: "required|string",
    role: "required|string",
  };
  let testModel;
  let app;

  before(async function () {
    db.connect({ database: ":memory:" });
    db.query(`CREATE TABLE "${tableName}" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "role" TEXT NOT NULL
    )`);

    testModel = model(db, tableName, structure, "id", ["id"]);
    await testModel.insert({
      data: [
        { name: "Alice", role: "admin" },
        { name: "Bob", role: "member" },
      ],
    });

    app = uExpress();
    // Configure body methods for QUERY support
    app.set("body methods", ["POST", "PUT", "PATCH", "DELETE", "QUERY"]);
    app.use(uExpress.json());
    app.use("/users", route(testModel, {}, { express: uExpress }));
  });

  after(function () {
    try {
      db.disconnect();
    } catch (_) {}
  });

  it("buffers and filters QUERY body properly under ultimate-express", async function () {
    const res = await request(app)
      .query("/users")
      .send({ role: "admin" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.count, 1);
    assert.strictEqual(res.body.data[0].name, "Alice");
  });
});
