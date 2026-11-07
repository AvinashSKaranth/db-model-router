/**
 * Property-Based Test: MariaDB Filter Translation
 *
 * Property 1: Filter translation produces valid where clauses
 * Validates: Requirements 1.2
 *
 * For any valid Filter_Array containing supported operators,
 * the MariaDB where() function SHALL produce an output object with a `query`
 * string and `value` array where the number of bind parameters (?) in the
 * query matches the length of the value array.
 *
 * Note: MariaDB uses ?? for identifiers and ? for values.
 */

const assert = require("assert");
const fc = require("fast-check");
const { where } = require("../../src/mariadb/db");

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
 * Arbitrary: an AND-group of conditions (1 to 5 conditions)
 */
const arbAndGroup = fc.array(arbCondition, { minLength: 1, maxLength: 5 });

/**
 * Arbitrary: a full filter array (OR of AND groups, 1 to 4 groups)
 */
const arbFilterArray = fc.array(arbAndGroup, { minLength: 1, maxLength: 4 });

describe("MariaDB Filter Property-Based Tests", function () {
  this.timeout(15000);

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: The query contains matching placeholder counts for values and identifiers.
   */
  it("should produce a where clause with placeholder count matching value array length", function () {
    fc.assert(
      fc.property(arbFilterArray, (filter) => {
        const result = where(filter);

        assert.ok(result !== null, "where() should not return null for valid filters");
        assert.ok(typeof result.query === "string", "query must be a string");
        assert.ok(Array.isArray(result.value), "value must be an array");

        // Count ? in query (ignoring ??)
        const valuePlaceholders = (result.query.match(/(?<!\?)\?(?!\?)/g) || []).length;
        const identPlaceholders = (result.query.match(/\?\?/g) || []).length;

        // Total elements in result.value is (identifiers + values)
        assert.strictEqual(
          identPlaceholders + valuePlaceholders,
          result.value.length,
          `Total placeholders (${identPlaceholders} id + ${valuePlaceholders} val) must match value length (${result.value.length})`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Property: Structure correctness - starts with WHERE (( and contains valid AND / OR clauses.
   */
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

        if (filter.length > 1) {
          assert.ok(
            result.query.includes(") OR ("),
            `Multi-group filter should contain ") OR (": ${result.query}`,
          );
        }

        for (const andGroup of filter) {
          if (andGroup.length > 1) {
            assert.ok(
              result.query.includes(" AND "),
              `Multi-condition group should contain " AND ": ${result.query}`,
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
   * Property: Operator preservation - every operator appears in query.
   */
  it("should include each condition's operator in the generated query", function () {
    fc.assert(
      fc.property(arbFilterArray, (filter) => {
        const result = where(filter);
        assert.ok(result !== null);

        for (const andGroup of filter) {
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
