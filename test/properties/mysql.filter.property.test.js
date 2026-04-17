/**
 * Property-Based Test: MySQL Filter Translation
 *
 * Property 1: Filter translation produces valid where clauses
 * Validates: Requirements 1.2
 *
 * For any valid Filter_Array containing supported operators,
 * the MySQL where() function SHALL produce an output object with a `query`
 * string and `value` array where the number of bind parameters (?) in the
 * query matches the length of the value array.
 *
 * Note: MySQL uses ?? for identifiers and ? for values. Only ? (not ??)
 * are bind parameters that correspond to entries in the value array.
 */

const assert = require("assert");
const fc = require("fast-check");
const { where } = require("../../src/mysql/db");

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
/**
 * Arbitrary: a valid column name (alphanumeric, starts with a letter, 1-20 chars)
 */
const arbColumnName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/)
  .filter((s) => s.length > 0);

/**
 * Arbitrary: a scalar value (string or integer)
 */
const arbScalarValue = fc.oneof(
  fc.string({ minLength: 0, maxLength: 50 }).filter((s) => s !== ""),
  fc.integer({ min: -10000, max: 10000 }),
);

/**
 * Arbitrary: a non-empty array of scalar values (for in/not in)
 */
const arbArrayValue = fc.array(arbScalarValue, { minLength: 1, maxLength: 10 });

/**
 * Arbitrary: a single filter condition [column, operator, value]
 */
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

/**
 * Arbitrary: an AND group (1-5 conditions)
 */
const arbAndGroup = fc.array(arbCondition, { minLength: 1, maxLength: 5 });

/**
 * Arbitrary: a Filter_Array (1-3 OR groups of AND conditions)
 */
const arbFilterArray = fc.array(arbAndGroup, { minLength: 1, maxLength: 3 });

/**
 * Count the number of ? bind parameters in a MySQL query string.
 * MySQL uses ?? for identifiers and ? for values.
 * We count only standalone ? (not preceded by another ?).
 */
function countBindParams(query) {
  let count = 0;
  for (let i = 0; i < query.length; i++) {
    if (query[i] === "?") {
      if (i + 1 < query.length && query[i + 1] === "?") {
        // This is the start of ??, skip both
        i++;
      } else if (i > 0 && query[i - 1] === "?") {
        // This is the second ? of ??, already skipped
      } else {
        count++;
      }
    }
  }
  return count;
}

/**
 * Count the expected number of values for a Filter_Array.
 * Each scalar condition contributes 1 value.
 * Each in/not in condition contributes N values (length of the array).
 * MySQL also adds a ?? identifier per condition, but those are not in the value array
 * for counting purposes — actually they ARE in the value array for mysql2.
 * The value array contains: [colName, val, colName, val, ...] for MySQL.
 */
function expectedValueCount(filterArray) {
  let count = 0;
  for (const andGroup of filterArray) {
    for (const condition of andGroup) {
      const op = condition[1];
      const val = condition[2];
      // Each condition has 1 ?? (column name) + value params
      count += 1; // for the ?? column identifier
      if (op === "in" || op === "not in") {
        count += Array.isArray(val) ? val.length : 1;
      } else {
        count += 1;
      }
    }
  }
  return count;
}

describe("Feature: database-adapter-standardization, Property 1: Filter translation produces valid where clauses (MySQL)", function () {
  /**
   * **Validates: Requirements 1.2**
   *
   * Property: For any valid Filter_Array, where() returns an object with
   * a `query` string and `value` array where the number of bind parameters
   * matches the value array length.
   */
  it("should produce query with bind parameter count matching value array length", function () {
    fc.assert(
      fc.property(arbFilterArray, (filterArray) => {
        const result = where(filterArray);

        // Result must not be null for valid inputs
        assert.notStrictEqual(
          result,
          null,
          "where() returned null for a valid filter",
        );
        assert.ok(typeof result === "object", "where() must return an object");

        // Must have query string and value array
        assert.ok(
          typeof result.query === "string",
          "result.query must be a string",
        );
        assert.ok(Array.isArray(result.value), "result.value must be an array");

        // Query must start with WHERE
        assert.ok(
          result.query.startsWith("WHERE"),
          `query must start with WHERE, got: ${result.query}`,
        );

        // Total placeholder count (?? + ?) must match value array length
        // MySQL value array includes both column identifiers (??) and bind values (?)
        const totalPlaceholders = (result.query.match(/\?\??/g) || []).length;
        assert.strictEqual(
          totalPlaceholders,
          result.value.length,
          `Total placeholder count (${totalPlaceholders}) must equal value length (${result.value.length}). Query: ${result.query}`,
        );

        // Value count must match expected from input
        const expected = expectedValueCount(filterArray);
        assert.strictEqual(
          result.value.length,
          expected,
          `Value length (${result.value.length}) must equal expected (${expected})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: Each operator used in the filter appears in the generated query.
   */
  it("should include all specified operators in the generated query", function () {
    fc.assert(
      fc.property(arbFilterArray, (filterArray) => {
        const result = where(filterArray);
        assert.notStrictEqual(result, null);

        for (const andGroup of filterArray) {
          for (const condition of andGroup) {
            const op = condition[1];
            assert.ok(
              result.query.toLowerCase().includes(op.toLowerCase()),
              `Operator "${op}" not found in query: ${result.query}`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: Empty/null filters return empty query with no values.
   */
  it("should return empty query for null, empty string, or empty array filters", function () {
    const emptyInputs = [null, "", [], [[]]];
    for (const input of emptyInputs) {
      const result = where(input);
      assert.ok(
        result !== null,
        `where(${JSON.stringify(input)}) should not return null`,
      );
      assert.strictEqual(
        result.query,
        "",
        `Expected empty query for input: ${JSON.stringify(input)}`,
      );
      assert.deepStrictEqual(
        result.value,
        [],
        `Expected empty value for input: ${JSON.stringify(input)}`,
      );
    }
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: Invalid operators cause where() to return null.
   */
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
          assert.strictEqual(
            result,
            null,
            `Expected null for unsupported operator "${badOp}"`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
