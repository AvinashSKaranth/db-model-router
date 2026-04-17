/**
 * Property-Based Tests: Response Shape Invariants (SQLite3 in-memory)
 *
 * Property 2: Get and find always return data array and count number
 * Property 3: List pagination respects page and limit bounds
 *
 * **Validates: Requirements 1.3, 1.4, 2.3, 2.4, 3.3, 3.4, 4.4, 4.5, 6.3, 7.3, 7.4, 8.3, 8.4, 9.10, 9.12**
 *
 * Uses an in-memory SQLite3 database seeded with 50 records.
 * fast-check generates random filters and page/limit values to verify
 * that response shapes are always correct.
 */

const assert = require("assert");
const fc = require("fast-check");
const crypto = require("crypto");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");

const SEED_COUNT = 50;
const modelStructure = {
  id: "integer",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "id";

describe("Feature: database-adapter-standardization, Property 2: Get and find always return data array and count number", function () {
  const tableName =
    "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  let testModel;
  let seededNames = [];

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
    const records = [];
    for (let i = 1; i <= SEED_COUNT; i++) {
      const name = "User" + i;
      seededNames.push(name);
      records.push({
        name,
        email: "user" + i + "@test.com",
        age: 18 + (i % 60),
      });
    }
    db.insert(tableName, records);
  });

  after(function () {
    db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 1.3, 2.3, 3.3, 4.4, 7.3, 8.3, 9.10**
   *
   * Property 2: For any valid filter (including empty), calling model.find()
   * returns { data: Array, count: Number >= 0 } where count >= data.length.
   */
  it("model.find() always returns { data: Array, count: Number >= 0 }", async function () {
    const arbFilter = fc.oneof(
      fc.constant({}),
      fc.constantFrom(...seededNames).map((name) => ({ name })),
      fc.integer({ min: 18, max: 77 }).map((age) => ({ age })),
    );

    await fc.assert(
      fc.asyncProperty(arbFilter, async (filter) => {
        const result = await testModel.find(filter);

        assert.ok(
          Array.isArray(result.data),
          `data must be an array, got: ${typeof result.data}`,
        );
        assert.ok(
          typeof result.count === "number",
          `count must be a number, got: ${typeof result.count}`,
        );
        assert.ok(
          result.count >= 0,
          `count must be >= 0, got: ${result.count}`,
        );
        assert.ok(
          result.count >= result.data.length,
          `count (${result.count}) must be >= data.length (${result.data.length})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3, 2.3, 3.3, 4.4, 7.3, 8.3, 9.10**
   *
   * Property 2 (db layer): For any valid filter, calling db.get()
   * returns { data: Array, count: Number >= 0 }.
   */
  it("db.get() always returns { data: Array, count: Number >= 0 }", function () {
    const arbFilter = fc.oneof(
      fc.constant([]),
      fc.constantFrom(...seededNames).map((name) => [[["name", "=", name]]]),
      fc.integer({ min: 18, max: 77 }).map((age) => [[["age", "=", age]]]),
      fc.integer({ min: 18, max: 50 }).chain((minAge) =>
        fc.integer({ min: minAge, max: 77 }).map((maxAge) => [
          [
            ["age", ">=", minAge],
            ["age", "<=", maxAge],
          ],
        ]),
      ),
    );

    fc.assert(
      fc.property(arbFilter, (filter) => {
        const result = db.get(tableName, filter);

        assert.ok(
          Array.isArray(result.data),
          `data must be an array, got: ${typeof result.data}`,
        );
        assert.ok(
          typeof result.count === "number",
          `count must be a number, got: ${typeof result.count}`,
        );
        assert.ok(
          result.count >= 0,
          `count must be >= 0, got: ${result.count}`,
        );
        assert.ok(
          result.count >= result.data.length,
          `count (${result.count}) must be >= data.length (${result.data.length})`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe("Feature: database-adapter-standardization, Property 3: List pagination respects page and limit bounds", function () {
  const tableName2 =
    "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  let testModel2;

  before(function () {
    db.connect({ database: ":memory:" });

    db.query(
      `CREATE TABLE "${tableName2}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "age" INTEGER NOT NULL
      )`,
    );
    testModel2 = model(db, tableName2, modelStructure, primaryKey, [
      primaryKey,
    ]);
    const records = [];
    for (let i = 1; i <= SEED_COUNT; i++) {
      records.push({
        name: "Person" + i,
        email: "person" + i + "@test.com",
        age: 18 + (i % 60),
      });
    }
    db.insert(tableName2, records);
  });

  after(function () {
    db.query(`DROP TABLE IF EXISTS "${tableName2}"`);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 1.4, 2.4, 3.4, 4.5, 6.3, 7.4, 8.4, 9.12**
   *
   * Property 3: For any valid page >= 0 and limit > 0, calling db.list()
   * returns data.length <= limit and count >= 0.
   */
  it("db.list() returns data.length <= limit and count is total matching records", function () {
    const arbPage = fc.integer({ min: 0, max: 100 });
    const arbLimit = fc.integer({ min: 1, max: 50 });

    fc.assert(
      fc.property(arbPage, arbLimit, (page, limit) => {
        const result = db.list(tableName2, [], [], null, page, limit);

        assert.ok(
          Array.isArray(result.data),
          `data must be an array, got: ${typeof result.data}`,
        );
        assert.ok(
          typeof result.count === "number",
          `count must be a number, got: ${typeof result.count}`,
        );
        assert.ok(
          result.count >= 0,
          `count must be >= 0, got: ${result.count}`,
        );
        assert.ok(
          result.data.length <= limit,
          `data.length (${result.data.length}) must be <= limit (${limit})`,
        );
        assert.strictEqual(
          result.count,
          SEED_COUNT,
          `count should equal total seeded records (${SEED_COUNT})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 2.4, 3.4, 4.5, 6.3, 7.4, 8.4, 9.12**
   *
   * Property 3 (model layer): For any valid page >= 0 and size > 0,
   * calling model.list({ page, size }) returns data.length <= size.
   */
  it("model.list() returns data.length <= size and count is total matching records", async function () {
    const arbPage = fc.integer({ min: 0, max: 100 });
    const arbSize = fc.integer({ min: 1, max: 50 });

    await fc.assert(
      fc.asyncProperty(arbPage, arbSize, async (page, size) => {
        const result = await testModel2.list({ page, size });

        assert.ok(
          Array.isArray(result.data),
          `data must be an array, got: ${typeof result.data}`,
        );
        assert.ok(
          typeof result.count === "number",
          `count must be a number, got: ${typeof result.count}`,
        );
        assert.ok(
          result.count >= 0,
          `count must be >= 0, got: ${result.count}`,
        );
        assert.ok(
          result.data.length <= size,
          `data.length (${result.data.length}) must be <= size (${size})`,
        );
        assert.strictEqual(
          result.count,
          SEED_COUNT,
          `count should equal total seeded records (${SEED_COUNT})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4, 2.4, 3.4, 4.5, 6.3, 7.4, 8.4, 9.12**
   *
   * Property 3: Pagination with filters — data.length <= limit still holds
   * when a filter reduces the result set.
   */
  it("db.list() with filter still respects data.length <= limit", function () {
    const arbPage = fc.integer({ min: 0, max: 10 });
    const arbLimit = fc.integer({ min: 1, max: 50 });
    const arbMinAge = fc.integer({ min: 18, max: 50 });

    fc.assert(
      fc.property(arbPage, arbLimit, arbMinAge, (page, limit, minAge) => {
        const filter = [[["age", ">=", minAge]]];
        const result = db.list(tableName2, filter, [], null, page, limit);

        assert.ok(Array.isArray(result.data));
        assert.ok(typeof result.count === "number");
        assert.ok(result.count >= 0);
        assert.ok(
          result.data.length <= limit,
          `data.length (${result.data.length}) must be <= limit (${limit})`,
        );
        assert.ok(
          result.count >= result.data.length,
          `count (${result.count}) must be >= data.length (${result.data.length})`,
        );
      }),
      { numRuns: 100 },
    );
  });
});
