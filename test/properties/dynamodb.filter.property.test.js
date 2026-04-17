/**
 * Property-Based Test: DynamoDB Filter Translation
 *
 * Property 1: Filter translation produces valid where clauses
 * Validates: Requirements 3.2
 *
 * For any valid Filter_Array containing supported operators,
 * the DynamoDB where() function SHALL produce an output object with a `query`
 * string (FilterExpression), `value` object (ExpressionAttributeValues),
 * and `names` object (ExpressionAttributeNames).
 */

const assert = require("assert");
const fc = require("fast-check");
const { where } = require("../../src/dynamodb/db");

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
  fc.string({ minLength: 1, maxLength: 50 }),
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
 * Extract all :valN and :valN_K placeholders from a DynamoDB FilterExpression.
 */
function extractValuePlaceholders(query) {
  const matches = query.match(/:val\d+(?:_\d+)?/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extract all #colN placeholders from a DynamoDB FilterExpression.
 */
function extractNamePlaceholders(query) {
  const matches = query.match(/#col\d+/g);
  return matches ? [...new Set(matches)] : [];
}

describe("Feature: database-adapter-standardization, Property 1: Filter translation produces valid where clauses (DynamoDB)", function () {
  /**
   * **Validates: Requirements 3.2**
   *
   * Property: For any valid Filter_Array, where() returns a non-null object
   * with a `query` string (FilterExpression), `value` object (ExpressionAttributeValues),
   * and `names` object (ExpressionAttributeNames).
   */
  it("should produce a valid FilterExpression, ExpressionAttributeValues, and ExpressionAttributeNames", function () {
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

        // result.query must be a string (FilterExpression)
        assert.ok(
          typeof result.query === "string",
          "result.query must be a string (FilterExpression)",
        );

        // result.value must be an object (ExpressionAttributeValues)
        assert.ok(
          typeof result.value === "object" &&
            result.value !== null &&
            !Array.isArray(result.value),
          "result.value must be an object (ExpressionAttributeValues)",
        );

        // result.names must be an object (ExpressionAttributeNames)
        assert.ok(
          typeof result.names === "object" &&
            result.names !== null &&
            !Array.isArray(result.names),
          "result.names must be an object (ExpressionAttributeNames)",
        );

        // Query should be non-empty for valid non-empty filters
        assert.ok(
          result.query.length > 0,
          "FilterExpression should be non-empty for valid filters",
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Property: Every :valN placeholder in the query has a corresponding key
   * in result.value, and every #colN placeholder has a corresponding key
   * in result.names.
   */
  it("should have matching placeholders between query, value, and names", function () {
    fc.assert(
      fc.property(arbFilterArray, (filterArray) => {
        const result = where(filterArray);
        assert.notStrictEqual(result, null);

        const valuePlaceholders = extractValuePlaceholders(result.query);
        const namePlaceholders = extractNamePlaceholders(result.query);

        // Every :valN placeholder in query must have a key in result.value
        for (const placeholder of valuePlaceholders) {
          assert.ok(
            Object.prototype.hasOwnProperty.call(result.value, placeholder),
            `Value placeholder "${placeholder}" in query not found in result.value. Query: ${result.query}, Values: ${JSON.stringify(result.value)}`,
          );
        }

        // Every key in result.value must appear in the query
        for (const key of Object.keys(result.value)) {
          assert.ok(
            result.query.includes(key),
            `Value key "${key}" not found in query: ${result.query}`,
          );
        }

        // Every #colN placeholder in query must have a key in result.names
        for (const placeholder of namePlaceholders) {
          assert.ok(
            Object.prototype.hasOwnProperty.call(result.names, placeholder),
            `Name placeholder "${placeholder}" in query not found in result.names. Query: ${result.query}, Names: ${JSON.stringify(result.names)}`,
          );
        }

        // Every key in result.names must appear in the query
        for (const key of Object.keys(result.names)) {
          assert.ok(
            result.query.includes(key),
            `Name key "${key}" not found in query: ${result.query}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Property: Empty/null filters return { query: "", value: {}, names: {} }.
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
        {},
        `Expected empty value for input: ${JSON.stringify(input)}`,
      );
      assert.deepStrictEqual(
        result.names,
        {},
        `Expected empty names for input: ${JSON.stringify(input)}`,
      );
    }
  });

  /**
   * **Validates: Requirements 3.2**
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
