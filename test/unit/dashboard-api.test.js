"use strict";

const assert = require("assert");
const express = require("express");
const request = require("supertest");
const apiRoutes = require("../../db-manager/routes/api.js");

describe("GET /api/dashboard", function () {
  let app;

  before(function () {
    // Mock db adapter
    const mockDb = {
      query: async (sql) => {
        if (sql.includes("sqlite_master") && sql.includes("type='table'")) {
          return [{ name: "users" }, { name: "orders" }];
        }
        if (sql.includes("sqlite_master") && sql.includes("type='index'")) {
          if (sql.includes("users")) return [{ cnt: 2 }];
          if (sql.includes("orders")) return [{ cnt: 1 }];
          return [{ cnt: 0 }];
        }
        if (sql.includes("dbstat")) {
          return [{ total_size: 8192 }];
        }
        if (sql.includes("PRAGMA table_info")) {
          if (sql.includes("users")) {
            return [
              {
                name: "id",
                type: "INTEGER",
                pk: 1,
                notnull: 1,
                dflt_value: null,
              },
              {
                name: "name",
                type: "TEXT",
                pk: 0,
                notnull: 0,
                dflt_value: null,
              },
              {
                name: "email",
                type: "TEXT",
                pk: 0,
                notnull: 0,
                dflt_value: null,
              },
            ];
          }
          if (sql.includes("orders")) {
            return [
              {
                name: "id",
                type: "INTEGER",
                pk: 1,
                notnull: 1,
                dflt_value: null,
              },
              {
                name: "user_id",
                type: "INTEGER",
                pk: 0,
                notnull: 0,
                dflt_value: null,
              },
            ];
          }
        }
        return [];
      },
      list: async (table, filter, sort, fields, page, limit) => {
        if (table === "users") return { data: [], count: 50 };
        if (table === "orders") return { data: [], count: 100 };
        return { data: [], count: 0 };
      },
    };

    const mockMetaDb = {
      _connectionId: 1,
      recordQuery: () => {},
      getConnections: () => [],
      getQueries: () => [],
    };

    app = express();
    app.use(express.json());
    app.use(apiRoutes(mockDb, mockMetaDb, "sqlite3"));
  });

  it("should return table metadata with name, columnCount, rowCount", async function () {
    const res = await request(app).get("/api/dashboard").expect(200);
    assert.ok(res.body.tables, "Response should have tables array");
    assert.strictEqual(res.body.tables.length, 2);

    const users = res.body.tables.find((t) => t.name === "users");
    assert.ok(users, "Should have users table");
    assert.strictEqual(users.columnCount, 3);
    assert.strictEqual(users.rowCount, 50);

    const orders = res.body.tables.find((t) => t.name === "orders");
    assert.ok(orders, "Should have orders table");
    assert.strictEqual(orders.columnCount, 2);
    assert.strictEqual(orders.rowCount, 100);
  });

  it("should return 500 with error message on failure", async function () {
    const brokenDb = {
      query: async () => {
        throw new Error("DB connection lost");
      },
      list: async () => {
        throw new Error("DB connection lost");
      },
    };
    const brokenApp = express();
    brokenApp.use(express.json());
    brokenApp.use(
      apiRoutes(
        brokenDb,
        {
          _connectionId: 1,
          recordQuery: () => {},
          getConnections: () => [],
          getQueries: () => [],
        },
        "sqlite3",
      ),
    );

    const res = await request(brokenApp).get("/api/dashboard").expect(500);
    assert.strictEqual(res.body.error, true);
    assert.strictEqual(res.body.message, "Failed to retrieve table metadata");
  });

  it("should return empty tables array when no tables exist", async function () {
    const emptyDb = {
      query: async (sql) => {
        if (sql.includes("sqlite_master")) return [];
        return [];
      },
      list: async () => ({ data: [], count: 0 }),
    };
    const emptyApp = express();
    emptyApp.use(express.json());
    emptyApp.use(
      apiRoutes(
        emptyDb,
        {
          _connectionId: 1,
          recordQuery: () => {},
          getConnections: () => [],
          getQueries: () => [],
        },
        "sqlite3",
      ),
    );

    const res = await request(emptyApp).get("/api/dashboard").expect(200);
    assert.ok(Array.isArray(res.body.tables));
    assert.strictEqual(res.body.tables.length, 0);
  });
});
