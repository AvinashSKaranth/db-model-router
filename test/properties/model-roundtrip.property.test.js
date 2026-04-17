/**
 * Property-Based Tests: Model CRUD Round-Trip Invariants (SQLite3 in-memory)
 *
 * Property 4: Single insert returns a valid id
 * Property 5: Bulk insert rows count matches input length
 * Property 6: Model insert round-trip preserves data
 * Property 7: Model update round-trip preserves changes
 * Property 8: Model remove then byId returns null
 * Property 9: FindOne returns record or false
 *
 * **Validates: Requirements 1.5, 1.6, 2.5, 3.5, 6.5, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.11**
 *
 * Uses in-memory SQLite3 databases with fresh tables per describe block.
 * fast-check generates random model-conforming records to verify invariants.
 */

const assert = require("assert");
const fc = require("fast-check");
const crypto = require("crypto");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");

const modelStructure = {
  id: "integer",
  name: "required|string",
  email: "required|string",
  age: "required|integer",
};
const primaryKey = "id";

// --- Arbitraries ---

// Names must start with a letter so jsonSafeParse won't coerce them to numbers
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
  .map(([name, email, age]) => ({
    name,
    email,
    age,
  }));

const arbRecordArray = fc.array(arbRecord, { minLength: 1, maxLength: 10 });
// --- Helpers ---

function makeTable() {
  return "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function createTable(tableName) {
  db.query(
    `CREATE TABLE "${tableName}" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "age" INTEGER NOT NULL
    )`,
  );
}

function dropTable(tableName) {
  db.query(`DROP TABLE IF EXISTS "${tableName}"`);
}

// =============================================================================
// Property 4: Single insert returns a valid id
// =============================================================================

describe("Feature: database-adapter-standardization, Property 4: Single insert returns a valid id", function () {
  const tableName = makeTable();
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    createTable(tableName);
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(function () {
    dropTable(tableName);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 1.5, 2.5, 3.5, 6.5**
   *
   * For any valid single record, model.insert() returns a record
   * with an id > 0.
   */
  it("model.insert() returns a record with id > 0 for any valid single record", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecord, async (record) => {
        const result = await testModel.insert({ ...record });
        assert.ok(result, "insert should return a record");
        assert.ok(
          typeof result.id === "number" && result.id > 0,
          `id must be a positive number, got: ${result.id}`,
        );
      }),
      { numRuns: 100 },
    );
  });
});
// =============================================================================
// Property 5: Bulk insert rows count matches input length
// =============================================================================

describe("Feature: database-adapter-standardization, Property 5: Bulk insert rows count matches input length", function () {
  const tableName = makeTable();
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    createTable(tableName);
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(function () {
    dropTable(tableName);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 1.6, 9.4**
   *
   * For any array of N valid records (N >= 2), model.insert({ data: records })
   * returns an object with rows === N. When N === 1, the model returns the
   * fetched record (since db.insert returns an id for single inserts), so we
   * test N >= 2 for the rows count property.
   */
  it("model.insert({ data: records }) returns rows === N for N random records (N >= 2)", async function () {
    const arbMultiRecordArray = fc.array(arbRecord, {
      minLength: 2,
      maxLength: 10,
    });

    await fc.assert(
      fc.asyncProperty(arbMultiRecordArray, async (records) => {
        const result = await testModel.insert({
          data: records.map((r) => ({ ...r })),
        });
        assert.ok(result, "bulk insert should return a result");
        assert.strictEqual(
          result.rows,
          records.length,
          `rows (${result.rows}) must equal input length (${records.length})`,
        );
      }),
      { numRuns: 100 },
    );
  });
});
// =============================================================================
// Property 6: Model insert round-trip preserves data
// =============================================================================

describe("Feature: database-adapter-standardization, Property 6: Model insert round-trip preserves data", function () {
  const tableName = makeTable();
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    createTable(tableName);
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(function () {
    dropTable(tableName);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 9.3, 9.9**
   *
   * For any valid record, inserting it and then fetching by the returned id
   * yields a record whose non-PK fields match the original input.
   */
  it("insert then byId returns the same data for any valid record", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecord, async (record) => {
        const inserted = await testModel.insert({ ...record });
        assert.ok(inserted, "insert should return a record");
        assert.ok(inserted.id > 0, "inserted record must have a valid id");

        const fetched = await testModel.byId(inserted.id);
        assert.ok(fetched, "byId should return the record");
        assert.strictEqual(fetched.id, inserted.id, "id must match");
        assert.strictEqual(fetched.name, record.name, "name must match");
        assert.strictEqual(fetched.email, record.email, "email must match");
        assert.strictEqual(fetched.age, record.age, "age must match");
      }),
      { numRuns: 100 },
    );
  });
});
// =============================================================================
// Property 7: Model update round-trip preserves changes
// =============================================================================

describe("Feature: database-adapter-standardization, Property 7: Model update round-trip preserves changes", function () {
  const tableName = makeTable();
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    createTable(tableName);
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(function () {
    dropTable(tableName);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 9.5, 9.6**
   *
   * For any valid record, inserting it, then updating with new random values,
   * the returned record has the new values and the same primary key.
   */
  it("insert then update preserves new values and same PK", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecord, arbRecord, async (original, updated) => {
        const inserted = await testModel.insert({ ...original });
        assert.ok(inserted && inserted.id > 0);

        const updatePayload = {
          id: inserted.id,
          name: updated.name,
          email: updated.email,
          age: updated.age,
        };
        const result = await testModel.update({ ...updatePayload });
        assert.ok(result, "update should return the updated record");
        assert.strictEqual(
          result.id,
          inserted.id,
          "PK must remain unchanged after update",
        );
        assert.strictEqual(
          result.name,
          updated.name,
          "name must reflect update",
        );
        assert.strictEqual(
          result.email,
          updated.email,
          "email must reflect update",
        );
        assert.strictEqual(result.age, updated.age, "age must reflect update");
      }),
      { numRuns: 100 },
    );
  });
});
// =============================================================================
// Property 8: Model remove then byId returns null
// =============================================================================

describe("Feature: database-adapter-standardization, Property 8: Model remove then byId returns null", function () {
  const tableName = makeTable();
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    createTable(tableName);
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(function () {
    dropTable(tableName);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 9.7, 9.8**
   *
   * For any valid record, inserting it, removing by id, then byId returns null.
   */
  it("insert then remove(id) then byId returns null", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecord, async (record) => {
        const inserted = await testModel.insert({ ...record });
        assert.ok(inserted && inserted.id > 0);

        await testModel.remove(inserted.id);
        const fetched = await testModel.byId(inserted.id);
        assert.strictEqual(
          fetched,
          null,
          `byId(${inserted.id}) must return null after remove`,
        );
      }),
      { numRuns: 100 },
    );
  });
});
// =============================================================================
// Property 9: FindOne returns record or false
// =============================================================================

describe("Feature: database-adapter-standardization, Property 9: FindOne returns record or false", function () {
  const tableName = makeTable();
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    createTable(tableName);
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(function () {
    dropTable(tableName);
    db.disconnect();
  });

  /**
   * **Validates: Requirements 9.11**
   *
   * For any valid record, after inserting it, findOne with a matching filter
   * returns the record; findOne with a non-matching filter returns false.
   */
  it("findOne returns the record for matching filter and false for non-matching", async function () {
    await fc.assert(
      fc.asyncProperty(arbRecord, async (record) => {
        const inserted = await testModel.insert({ ...record });
        assert.ok(inserted && inserted.id > 0);

        // findOne with matching filter should return the record
        const found = await testModel.findOne({ id: inserted.id });
        assert.ok(found, "findOne with matching id should return a record");
        assert.strictEqual(found.id, inserted.id);
        assert.strictEqual(found.name, record.name);

        // findOne with non-matching filter should return false
        const notFound = await testModel.findOne({ id: -999 });
        assert.strictEqual(
          notFound,
          false,
          "findOne with non-matching filter must return false",
        );
      }),
      { numRuns: 100 },
    );
  });
});
