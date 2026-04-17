/**
 * Property-Based Tests: Route Behavior (SQLite3 in-memory)
 *
 * Property 10: Route GET /:pk returns 200 for existing and 404 for non-existing records
 * Property 11: Route POST inserts and returns the record
 * Property 12: Payload override injects fields from request
 *
 * **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.7, 10.10**
 *
 * Uses in-memory SQLite3 databases with fresh tables per describe block.
 * fast-check generates random payloads, exercised via supertest against Express apps.
 */

const assert = require("assert");
const fc = require("fast-check");
const crypto = require("crypto");
const express = require("express");
const request = require("supertest");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");
const route = require("../../src/commons/route.js");

// --- Arbitraries ---

const arbName = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z]$/),
    fc.string({ minLength: 0, maxLength: 49 }),
  )
  .map(([first, rest]) => first + rest)
  .filter((s) => s.trim().length > 0);

const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/),
    fc.constantFrom("com", "org", "net", "io"),
  )
  .map(([user, domain, tld]) => `${user}@${domain}.${tld}`);

const arbAge = fc.integer({ min: 1, max: 120 });

const arbRecord = fc
  .tuple(arbName, arbEmail, arbAge)
  .map(([name, email, age]) => ({ name, email, age }));

const arbRecordArray = fc.array(arbRecord, { minLength: 2, maxLength: 10 });

// --- Helpers ---

function makeTable() {
  return "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

// =============================================================================
// Property 10: Route GET /:pk returns 200 for existing and 404 for non-existing
// =============================================================================

describe("Feature: database-adapter-standardization, Property 10: Route GET /:pk returns 200 for existing and 404 for non-existing records", function () {
  const tableName = makeTable();
  const modelStructure = {
    id: "integer",
    name: "required|string",
    email: "required|string",
    age: "required|integer",
  };
  const primaryKey = "id";
  let app;
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "age" INTEGER NOT NULL
      )`,
    );
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
    app = express();
    app.use(express.json());
    app.use("/api", route(testModel));
  });

  after(function () {
    db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 10.2, 10.4, 10.5**
   *
   * For any valid record, inserting via model then GET /:pk returns 200
   * with the correct data. GET /999999 returns 404.
   */
  it("GET /:pk returns 200 with correct data for inserted records and 404 for non-existing", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecord, async (record) => {
        // Insert via model to get a known id
        const inserted = await testModel.insert({ ...record });
        assert.ok(inserted && inserted.id > 0);

        // GET existing record
        const res = await request(app)
          .get("/api/" + inserted.id)
          .expect(200);

        assert.strictEqual(res.body.id, inserted.id, "id must match");
        assert.strictEqual(res.body.name, record.name, "name must match");
        assert.strictEqual(res.body.email, record.email, "email must match");
        assert.strictEqual(res.body.age, record.age, "age must match");

        // GET non-existing record
        const notFoundRes = await request(app).get("/api/999999").expect(404);

        assert.strictEqual(notFoundRes.body.message, "Not Found");
        assert.strictEqual(notFoundRes.body.type, "danger");
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 11: Route POST inserts and returns the record
// =============================================================================

describe("Feature: database-adapter-standardization, Property 11: Route POST inserts and returns the record", function () {
  const tableName = makeTable();
  const modelStructure = {
    id: "integer",
    name: "required|string",
    email: "required|string",
    age: "required|integer",
  };
  const primaryKey = "id";
  let app;
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "age" INTEGER NOT NULL
      )`,
    );
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
    app = express();
    app.use(express.json());
    app.use("/api", route(testModel));
  });

  after(function () {
    db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * For any valid payload, POST /add returns 200 with the inserted record
   * containing a valid id and matching fields.
   */
  it("POST /add returns 200 with inserted record containing valid id and matching fields", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecord, async (record) => {
        const res = await request(app)
          .post("/api/add")
          .send({ ...record })
          .expect(200);

        assert.ok(
          typeof res.body.id === "number" && res.body.id > 0,
          `id must be a positive number, got: ${res.body.id}`,
        );
        assert.strictEqual(res.body.name, record.name, "name must match");
        assert.strictEqual(res.body.email, record.email, "email must match");
        assert.strictEqual(res.body.age, record.age, "age must match");
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.7**
   *
   * POST / with { data: [records] } returns 200 with rows matching input length.
   */
  it("POST / with { data: [records] } returns 200 with rows matching input length", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecordArray, async (records) => {
        const res = await request(app)
          .post("/api/")
          .send({ data: records.map((r) => ({ ...r })) })
          .expect(200);

        assert.strictEqual(
          res.body.rows,
          records.length,
          `rows (${res.body.rows}) must equal input length (${records.length})`,
        );
        assert.strictEqual(res.body.type, "success");
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 12: Payload override injects fields from request
// =============================================================================

describe("Feature: database-adapter-standardization, Property 12: Payload override injects fields from request", function () {
  const tableName = makeTable();
  const modelStructure = {
    id: "integer",
    name: "required|string",
    email: "required|string",
    age: "required|integer",
    user_id: "string",
  };
  const primaryKey = "id";
  let app;
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "age" INTEGER NOT NULL,
        "user_id" TEXT DEFAULT ''
      )`,
    );
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
    app = express();
    app.use(express.json());
    // Override: user_id is injected from the x-user-id header
    app.use("/api", route(testModel, { user_id: "headers.x-user-id" }));
  });

  after(function () {
    db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 10.10**
   *
   * When a route is created with override { user_id: "headers.x-user-id" },
   * POST /add with a custom x-user-id header injects that value into the
   * inserted record's user_id field.
   */
  it("POST /add with override injects header value into the inserted record", async function () {
    const arbUserId = fc
      .stringMatching(/^[a-z][a-z0-9]{0,9}$/)
      .filter((s) => s.length > 0);

    await fc.assert(
      fc.asyncProperty(arbRecord, arbUserId, async (record, userId) => {
        const res = await request(app)
          .post("/api/add")
          .set("x-user-id", userId)
          .send({ ...record })
          .expect(200);

        assert.ok(
          typeof res.body.id === "number" && res.body.id > 0,
          `id must be a positive number, got: ${res.body.id}`,
        );
        assert.strictEqual(
          res.body.user_id,
          userId,
          `user_id must be overridden to "${userId}", got: "${res.body.user_id}"`,
        );
        assert.strictEqual(res.body.name, record.name, "name must match");
        assert.strictEqual(res.body.email, record.email, "email must match");
        assert.strictEqual(res.body.age, record.age, "age must match");
      }),
      { numRuns: 100 },
    );
  });
});
