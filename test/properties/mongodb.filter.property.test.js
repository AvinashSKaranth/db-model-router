/**
 * Property-Based Test: MongoDB Filter Translation
 *
 * Property 1: Filter translation produces valid where clauses
 * Validates: Requirements 2.2
 *
 * For any valid Filter_Array containing supported operators,
 * the MongoDB where() function SHALL produce an output object with a `query`
 * object (MongoDB query) and `value` array (always empty for MongoDB),
 * and the query object contains the expected MongoDB operators.
 */

const assert = require("assert");
const fc = require("fast-check");
const { where } = require("../../src/mongodb/db");

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
 * Map from standard operators to expected MongoDB query operators.
 */
const OPERATOR_TO_MONGO = {
  "=": null, // equality uses { field: value } — no special $op
  "!=": "$ne",
  "<": "$lt",
  ">": "$gt",
  "<=": "$lte",
  ">=": "$gte",
  like: "$regex",
  "not like": "$not",
  in: "$in",
  "not in": "$nin",
};

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
 * Recursively check if a MongoDB query object contains a given key anywhere.
 */
function queryContainsKey(obj, key) {
  if (obj === null || typeof obj !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
  for (const v of Object.values(obj)) {
    if (queryContainsKey(v, key)) return true;
  }
  return false;
}

describe("Feature: database-adapter-standardization, Property 1: Filter translation produces valid where clauses (MongoDB)", function () {
  /**
   * **Validates: Requirements 2.2**
   *
   * Property: For any valid Filter_Array, where() returns a non-null object
   * with a `query` object and `value` array (empty for MongoDB).
   */
  it("should produce a valid query object and empty value array for valid filters", function () {
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

        // Must have query object and value array
        assert.ok(
          typeof result.query === "object" && result.query !== null,
          "result.query must be an object",
        );
        assert.ok(Array.isArray(result.value), "result.value must be an array");

        // MongoDB where() always returns an empty value array
        assert.deepStrictEqual(
          result.value,
          [],
          "result.value must be an empty array for MongoDB",
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * Property: The query object contains the expected MongoDB operators
   * ($and, $or, $in, $nin, $regex, $lt, $gt, $lte, $gte, $ne, $not)
   * corresponding to the operators used in the filter.
   */
  it("should include expected MongoDB operators in the generated query", function () {
    fc.assert(
      fc.property(arbFilterArray, (filterArray) => {
        const result = where(filterArray);
        assert.notStrictEqual(result, null);

        // Collect all non-equality operators used in the filter
        const usedMongoOps = new Set();
        for (const andGroup of filterArray) {
          for (const condition of andGroup) {
            const op = condition[1];
            const mongoOp = OPERATOR_TO_MONGO[op];
            if (mongoOp !== null) {
              usedMongoOps.add(mongoOp);
            }
          }
        }

        // Each expected MongoDB operator should appear in the query object
        for (const mongoOp of usedMongoOps) {
          assert.ok(
            queryContainsKey(result.query, mongoOp),
            `Expected MongoDB operator "${mongoOp}" not found in query: ${JSON.stringify(result.query)}`,
          );
        }

        // Multi-group filters should use $or (when > 1 group) or $and (single group)
        if (filterArray.length > 1) {
          assert.ok(
            queryContainsKey(result.query, "$or"),
            `Expected $or in query for multi-group filter: ${JSON.stringify(result.query)}`,
          );
        } else if (filterArray.length === 1 && filterArray[0].length > 0) {
          assert.ok(
            queryContainsKey(result.query, "$and"),
            `Expected $and in query for single-group filter: ${JSON.stringify(result.query)}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * Property: Empty/null filters return { query: {}, value: [] }.
   */
  it("should return empty query for null, empty string, or empty array filters", function () {
    const emptyInputs = [null, "", [], [[]]];
    for (const input of emptyInputs) {
      const result = where(input);
      assert.ok(
        result !== null,
        `where(${JSON.stringify(input)}) should not return null`,
      );
      assert.deepStrictEqual(
        result.query,
        {},
        `Expected empty query object for input: ${JSON.stringify(input)}`,
      );
      assert.deepStrictEqual(
        result.value,
        [],
        `Expected empty value array for input: ${JSON.stringify(input)}`,
      );
    }
  });

  /**
   * **Validates: Requirements 2.2**
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
