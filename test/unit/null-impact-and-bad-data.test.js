process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");
const { jsonSafeParse, jsonStringify, wouldLosePrecision } = require("../../src/commons/function.js");
const { dataToFilter, objectToFilter } = require("../../src/commons/validator.js");

describe("Null Impact & Bad Data Handling Tests", function () {
  const tableName = "bad_data_test_" + Date.now();
  let testModel;

  before(function () {
    db.connect({ database: ":memory:" });
    db.query(`CREATE TABLE "${tableName}" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "title" TEXT NOT NULL,
      "count" INTEGER,
      "price" REAL,
      "metadata" TEXT,
      "is_deleted" INTEGER DEFAULT 0
    )`);

    testModel = model(
      db,
      tableName,
      {
        id: "integer",
        title: "required|string",
        count: "integer",
        price: "numeric",
        metadata: "object",
        is_deleted: "integer",
      },
      "id",
      ["id"],
      { safeDelete: "is_deleted" },
    );
  });

  after(function () {
    try {
      db.disconnect();
    } catch (_) {}
  });

  describe("Null & Undefined Impact", function () {
    it("handles null and undefined values in byId safely without crashing", async function () {
      await assert.rejects(
        async () => {
          await testModel.byId(null);
        },
        /Invalid id value/,
      );

      await assert.rejects(
        async () => {
          await testModel.byId(undefined);
        },
        /Invalid id value/,
      );

      await assert.rejects(
        async () => {
          await testModel.byId("");
        },
        /Invalid id value/,
      );
    });

    it("handles null in optional columns during insert and update", async function () {
      const inserted = await testModel.insert({
        title: "Nullable Item",
        count: null,
        price: null,
        metadata: null,
      });

      assert.ok(inserted.id > 0);
      assert.strictEqual(inserted.count, null);
      assert.strictEqual(inserted.price, null);

      // Verify read-back preserves null
      const fetched = await testModel.byId(inserted.id);
      assert.strictEqual(fetched.title, "Nullable Item");
      assert.strictEqual(fetched.count, null);
      assert.strictEqual(fetched.price, null);
    });

    it("handles empty object {} in filters without crashing", function () {
      const f1 = dataToFilter({}, "id");
      assert.deepStrictEqual(f1, [[[]]]);

      const f2 = objectToFilter({});
      assert.deepStrictEqual(f2, [[]]);
    });

    it("handles null in dataToFilter by throwing 422 error", function () {
      assert.throws(() => {
        dataToFilter(null, "id");
      }, /Invalid filter Inputs/);

      assert.throws(() => {
        dataToFilter(undefined, "id");
      }, /Invalid filter Inputs/);
    });

    it("handles null and scalar values in jsonSafeParse without corrupting text", function () {
      assert.strictEqual(jsonSafeParse(null), null);
      assert.strictEqual(jsonSafeParse(undefined), undefined);
      assert.strictEqual(jsonSafeParse(12345), 12345);
      assert.strictEqual(jsonSafeParse(true), true);
      assert.strictEqual(jsonSafeParse(false), false);

      // Plain scalar strings MUST remain strings and not be coerced to numbers/booleans (Review item D1)
      assert.strictEqual(jsonSafeParse("12345"), "12345");
      assert.strictEqual(jsonSafeParse("true"), "true");
      assert.strictEqual(jsonSafeParse("false"), "false");
      assert.strictEqual(jsonSafeParse("null"), "null");
      assert.strictEqual(jsonSafeParse("0123"), "0123");

      // Real JSON objects and arrays MUST be parsed
      assert.deepStrictEqual(jsonSafeParse('{"a":1,"b":"hello"}'), { a: 1, b: "hello" });
      assert.deepStrictEqual(jsonSafeParse("[1, 2, 3]"), [1, 2, 3]);
    });

    it("handles null in jsonStringify safely", function () {
      assert.strictEqual(jsonStringify(null), null);
      assert.strictEqual(jsonStringify(undefined), undefined);
      assert.strictEqual(jsonStringify("text"), "text");
      assert.strictEqual(jsonStringify(42), 42);

      // Objects with null fields
      const input = { a: 1, b: null, c: { d: "nested" } };
      const output = jsonStringify(input);
      assert.strictEqual(output.a, 1);
      assert.strictEqual(output.b, null);
      assert.strictEqual(output.c, '{"d":"nested"}');
    });
  });

  describe("Bad Data & Type Validation", function () {
    it("rejects insert missing required fields with validation error", async function () {
      await assert.rejects(
        async () => {
          await testModel.insert({
            count: 10,
          });
        },
        (err) => {
          assert.strictEqual(err.status, 422);
          return true;
        },
      );
    });

    it("rejects insert with invalid field types (string in integer field)", async function () {
      await assert.rejects(
        async () => {
          await testModel.insert({
            title: "Bad Type Item",
            count: "not-a-number",
          });
        },
        (err) => {
          assert.strictEqual(err.status, 422);
          return true;
        },
      );
    });

    it("rejects patch with invalid field types (string in integer column)", async function () {
      const item = await testModel.insert({
        title: "Item for Patch",
        count: 5,
      });

      await assert.rejects(
        async () => {
          await testModel.patch({
            id: item.id,
            count: "invalid-integer",
          });
        },
        (err) => {
          assert.strictEqual(err.status, 422);
          return true;
        },
      );
    });

    it("sanitizes out-of-bounds pagination parameters in list()", async function () {
      // Negative page should become 0
      const resNeg = await testModel.list({ page: -5, size: -10 });
      assert.ok(Array.isArray(resNeg.data));

      // Over-maximum size (> 200) should be clamped to 200
      const resLarge = await testModel.list({ page: "bad", size: 99999 });
      assert.ok(Array.isArray(resLarge.data));
    });

    it("handles malformed JSON in jsonSafeParse by returning raw string", function () {
      const broken1 = "{ key without quotes: 123 }";
      assert.strictEqual(jsonSafeParse(broken1), broken1);

      const broken2 = "[1, 2, broken]";
      assert.strictEqual(jsonSafeParse(broken2), broken2);

      const broken3 = "{ unclosed";
      assert.strictEqual(jsonSafeParse(broken3), broken3);
    });

    it("handles string sort formatting gracefully (Review item B1)", async function () {
      // String sort should not iterate characters (e.g. "-title" -> no such column: "t")
      const res1 = await testModel.list({ sort: "-title" });
      assert.ok(Array.isArray(res1.data));

      const res2 = await testModel.list({ sort: "+count, -title" });
      assert.ok(Array.isArray(res2.data));

      const res3 = await testModel.list({ sort: "id" });
      assert.ok(Array.isArray(res3.data));
    });

    it("handles array removal payloads gracefully (Review items A4, B2, C1)", async function () {
      const row1 = await testModel.insert({ title: "To Delete 1" });
      const row2 = await testModel.insert({ title: "To Delete 2" });

      // Array of IDs: [row1.id, row2.id]
      const filter1 = dataToFilter([row1.id, row2.id], "id");
      assert.deepStrictEqual(filter1, [[["id", "in", [row1.id, row2.id]]]]);

      // Array of objects with IDs: [{ id: row1.id }, { id: row2.id }]
      const filter2 = dataToFilter([{ id: row1.id }, { id: row2.id }], "id");
      assert.deepStrictEqual(filter2, [[["id", "in", [row1.id, row2.id]]]]);

      // Array of arbitrary conditions: [{ title: "A" }, { title: "B" }]
      const filter3 = dataToFilter([{ title: "A" }, { title: "B" }], "id");
      assert.strictEqual(filter3.length, 2);
      assert.deepStrictEqual(filter3[0], [["title", "=", "A"]]);
      assert.deepStrictEqual(filter3[1], [["title", "=", "B"]]);

      // Remove via array
      const remRes = await testModel.remove([row1.id, row2.id]);
      assert.ok(remRes);

      const check1 = await testModel.byId(row1.id);
      const check2 = await testModel.byId(row2.id);
      assert.strictEqual(check1, null);
      assert.strictEqual(check2, null);
    });

    it("correctly identifies numbers that would lose precision (wouldLosePrecision)", function () {
      // Normal safe numbers
      assert.strictEqual(wouldLosePrecision("100"), false);
      assert.strictEqual(wouldLosePrecision("9007199254740991"), false); // MAX_SAFE_INTEGER
      assert.strictEqual(wouldLosePrecision("1.50"), false);

      // Numbers that lose precision
      assert.strictEqual(wouldLosePrecision("9007199254740992"), true);
      assert.strictEqual(wouldLosePrecision("12345678901234567890"), true);
    });
  });

  describe("Duplicate Insert & Stale ID Protection (Review item I1)", function () {
    const uniqueTable = "uniq_test_" + Date.now();
    let uniqueModel;

    before(function () {
      db.query(`CREATE TABLE "${uniqueTable}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "email" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL
      )`);

      uniqueModel = model(
        db,
        uniqueTable,
        {
          id: "integer",
          email: "required|string",
          name: "required|string",
        },
        "id",
        ["id", "email"],
      );
    });

    it("returns correct existing record id when duplicate is ignored (never returns stale previous insert id)", async function () {
      const userA = await uniqueModel.insert({ email: "alice@test.com", name: "Alice" });
      assert.ok(userA.id > 0);

      const userB = await uniqueModel.insert({ email: "bob@test.com", name: "Bob" });
      assert.ok(userB.id > 0);
      assert.notStrictEqual(userA.id, userB.id);

      // Re-insert userA (duplicate email)
      const duplicateA = await uniqueModel.insert({ email: "alice@test.com", name: "Alice Duplicate" });

      // Must return userA's ID (id: 1), NEVER userB's stale ID (id: 2)!
      assert.strictEqual(duplicateA.id, userA.id, "Duplicate insert must return existing row id, not stale previous insert id");
      assert.strictEqual(duplicateA.email, "alice@test.com");
      assert.strictEqual(duplicateA.name, "Alice"); // Kept original Alice
    });
  });
});
