process.env.NODE_ENV = "TEST";
const assert = require("assert");
const express = require("express");
const request = require("supertest");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");
const route = require("../../src/commons/route.js");

describe("Model Lifecycle Hooks & Entity Interceptors", function () {
  const tableName = "test_hooks_" + Date.now();
  const structure = {
    id: "integer",
    name: "required|string",
    email: "required|string",
    status: "string",
  };
  const pk = "id";

  let hookLogs = [];
  let testModel;
  let app;

  before(function () {
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "status" TEXT DEFAULT 'active'
      )`,
    );

    testModel = model(db, tableName, structure, pk, [pk], {
      hooks: {
        beforeCreate: async (data, context) => {
          hookLogs.push({ hook: "beforeCreate", data: { ...data }, context });
          // Validation / blocking
          if (data.email && data.email.includes("blocked")) {
            throw new Error("Email domain blocked");
          }
          // Mutation / normalization
          if (data.email) {
            data.email = data.email.toLowerCase();
          }
          if (!data.status) {
            data.status = "pending";
          }
          return data;
        },
        afterCreate: async (record, context) => {
          hookLogs.push({ hook: "afterCreate", record: { ...record }, context });
          // Virtual property decoration
          if (record && typeof record === "object") {
            record._createdViaHook = true;
          }
          return record;
        },
        beforeUpdate: async (data, context) => {
          hookLogs.push({ hook: "beforeUpdate", data: { ...data }, context });
          if (data.status === "forbidden") {
            throw new Error("Cannot set forbidden status");
          }
          return data;
        },
        afterUpdate: async (record, context) => {
          hookLogs.push({ hook: "afterUpdate", record: { ...record }, context });
          if (record && typeof record === "object") {
            record._updatedViaHook = true;
          }
          return record;
        },
        beforeDelete: async (filter, context) => {
          hookLogs.push({ hook: "beforeDelete", filter, context });
          if (filter && filter.id === 9999) {
            throw new Error("Cannot delete protected record");
          }
          return filter;
        },
        afterDelete: async (result, context) => {
          hookLogs.push({ hook: "afterDelete", result, context });
          return result;
        },
        beforeFind: async (filter, context) => {
          hookLogs.push({ hook: "beforeFind", filter, context });
          return filter;
        },
        afterFind: async (rows, context) => {
          hookLogs.push({ hook: "afterFind", count: rows.length, context });
          for (const row of rows) {
            row._virtualBadge = "verified";
          }
          return rows;
        },
      },
    });

    app = express();
    app.use(express.json());
    // Attach dummy user to request
    app.use((req, res, next) => {
      req.user = { id: 42, role: "admin" };
      next();
    });
    app.use("/users", route(testModel));
  });

  after(function () {
    try {
      db.disconnect();
    } catch (_) {}
  });

  beforeEach(function () {
    hookLogs = [];
  });

  it("executes beforeCreate and normalizes data", async function () {
    const created = await testModel.insert(
      { name: "John Doe", email: "JOHN@EXAMPLE.COM" },
      { customSource: "manual_test" },
    );

    assert.strictEqual(created.email, "john@example.com");
    assert.strictEqual(created.status, "pending");
    assert.strictEqual(created._createdViaHook, true);

    const createLogs = hookLogs.filter((l) => l.hook === "beforeCreate");
    assert.strictEqual(createLogs.length, 1);
    assert.strictEqual(createLogs[0].context.customSource, "manual_test");
  });

  it("blocks insert when beforeCreate throws", async function () {
    await assert.rejects(
      async () => {
        await testModel.insert({ name: "Bad", email: "bad@blocked.com" });
      },
      { message: "Email domain blocked" },
    );
  });

  it("executes afterCreate on insert", async function () {
    const created = await testModel.insert({ name: "Jane", email: "jane@test.com" });
    const afterLogs = hookLogs.filter((l) => l.hook === "afterCreate");
    assert.strictEqual(afterLogs.length, 1);
    assert.strictEqual(created._createdViaHook, true);
  });

  it("executes beforeUpdate and afterUpdate on update and patch", async function () {
    const created = await testModel.insert({ name: "Bob", email: "bob@test.com" });
    const updated = await testModel.update({
      id: created.id,
      name: "Bob Updated",
      email: "bob@test.com",
      status: "active",
    });

    assert.strictEqual(updated.name, "Bob Updated");
    assert.strictEqual(updated._updatedViaHook, true);

    const patched = await testModel.patch({
      id: created.id,
      name: "Bob Patched",
    });
    assert.strictEqual(patched.name, "Bob Patched");
    assert.strictEqual(patched._updatedViaHook, true);

    const beforeUpLogs = hookLogs.filter((l) => l.hook === "beforeUpdate");
    assert.strictEqual(beforeUpLogs.length >= 2, true);
    const afterUpLogs = hookLogs.filter((l) => l.hook === "afterUpdate");
    assert.strictEqual(afterUpLogs.length >= 2, true);
  });

  it("blocks update when beforeUpdate throws", async function () {
    const created = await testModel.insert({ name: "Sam", email: "sam@test.com" });
    await assert.rejects(
      async () => {
        await testModel.update({ id: created.id, status: "forbidden" });
      },
      { message: "Cannot set forbidden status" },
    );
  });

  it("executes afterFind and decorates virtual fields on find/list/byId", async function () {
    const created = await testModel.insert({ name: "Alice", email: "alice@test.com" });

    // byId
    const foundById = await testModel.byId(created.id);
    assert.strictEqual(foundById._virtualBadge, "verified");

    // find
    const found = await testModel.find({ id: created.id });
    assert.strictEqual(found.data[0]._virtualBadge, "verified");

    // list
    const listed = await testModel.list({});
    assert.strictEqual(listed.data[0]._virtualBadge, "verified");
  });

  it("executes beforeDelete and afterDelete", async function () {
    const created = await testModel.insert({ name: "Temp", email: "temp@test.com" });
    await testModel.remove({ id: created.id });

    const beforeDelLogs = hookLogs.filter((l) => l.hook === "beforeDelete");
    assert.strictEqual(beforeDelLogs.length, 1);
    const afterDelLogs = hookLogs.filter((l) => l.hook === "afterDelete");
    assert.strictEqual(afterDelLogs.length, 1);
  });

  it("passes req and user context through route handlers to model hooks", async function () {
    const res = await request(app)
      .post("/users/1")
      .send({ name: "RouteUser", email: "ROUTE@TEST.COM" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.email, "route@test.com");
    assert.strictEqual(res.body._createdViaHook, true);

    const createLog = hookLogs.find((l) => l.hook === "beforeCreate");
    assert(createLog, "beforeCreate hook should have executed");
    assert(createLog.context.req, "context.req should be present");
    assert.strictEqual(createLog.context.user.role, "admin");
  });
});
