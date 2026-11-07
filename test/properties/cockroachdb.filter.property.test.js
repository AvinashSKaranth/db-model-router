/**
 * Property-Based Test: CockroachDB Filter Translation
 *
 * Property 1: Filter translation produces valid where clauses
 * Validates: Requirements 1.2
 *
 * For any valid Filter_Array containing supported operators,
 * the CockroachDB where() function SHALL produce an output object with a `query`
 * string and `value` array where the number of $N bind parameters in the
 * query matches the length of the value array.
 */

const assert = require("assert");
const fc = require("fast-check");
const { where } = require("../../src/cockroachdb/db");

const SUPPORTED_OPERATORS = [
  "=",
  "like",
  "not like",
  "in",
  "not in",
  "<",
  ">",
  "<=",
  ">=",
  "!=",
];

const SCALAR_OPERATORS = SUPPORTED_OPERATORS.filter(
  (op) => op !== "in" && op !== "not in",
);
const ARRAY_OPERATORS = ["in", "not in"];

const arbColumnName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/)
  .filter((s) => s.length > 0);

const arbScalarValue = fc.oneof(
  fc.string({ minLength: 0, maxLength: 50 }).filter((s) => s !== ""),
  fc.integer({ min: -10000, max: 10000 }),
);

const arbArrayValue = fc.array(arbScalarValue, { minLength: 1, maxLength: 10 });

const arbScalarCondition = fc.tuple(
  arbColumnName,
  fc.constantFrom(...SCALAR_OPERATORS),
  arbScalarValue,
);

const arbArrayCondition = fc.tuple(
  arbColumnName,
  fc.constantFrom(...ARRAY_OPERATORS),
  arbArrayValue,
);

const arbCondition = fc.oneof(arbScalarCondition, arbArrayCondition);
const arbAndGroup = fc.array(arbCondition, { minLength: 1, maxLength: 5 });
const arbFilterArray = fc.array(arbAndGroup, { minLength: 1, maxLength: 4 });

describe("CockroachDB Filter Property-Based Tests", function () {
  this.timeout(15000);

  it("should produce a where clause with $N parameter count matching value array length", function () {
    fc.assert(
      fc.property(arbFilterArray, (filter) => {
        const result = where(filter);

        assert.ok(result !== null, "where() should not return null for valid filters");
        assert.ok(typeof result.query === "string", "query must be a string");
        assert.ok(Array.isArray(result.value), "value must be an array");

        const matches = result.query.match(/\$\d+/g) || [];
        assert.strictEqual(
          matches.length,
          result.value.length,
          `Placeholder count (${matches.length}) does not match value count (${result.value.length})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("should wrap conditions in WHERE ((...)) and structure with AND / OR properly", function () {
    fc.assert(
      fc.property(arbFilterArray, (filter) => {
        const result = where(filter);

        assert.ok(result !== null);
        assert.ok(
          result.query.startsWith("WHERE (("),
          `Query should start with "WHERE ((": ${result.query}`,
        );
        assert.ok(
          result.query.endsWith("))"),
          `Query should end with "))": ${result.query}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("should return empty query for null, empty string, or empty array filters", function () {
    const emptyInputs = [null, "", [], [[]]];
    for (const input of emptyInputs) {
      const result = where(input);
      assert.ok(result !== null);
      assert.strictEqual(result.query, "");
      assert.deepStrictEqual(result.value, []);
    }
  });

  it("should return null for unsupported operators", function () {
    fc.assert(
      fc.property(
        arbColumnName,
        fc
          .string({ minLength: 1, maxLength: 10 })
          .filter((s) => !SUPPORTED_OPERATORS.includes(s.toLowerCase())),
        arbScalarValue,
        (col, badOp, val) => {
          const result = where([[[col, badOp, val]]]);
          assert.strictEqual(result, null);
        },
      ),
      { numRuns: 100 },
    );
  });
});
