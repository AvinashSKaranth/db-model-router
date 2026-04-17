/**
 * Property-Based Test: Unified Filter Translation Across All Adapters
 *
 * Property 1: Filter translation produces valid where clauses across all adapters
 * **Validates: Requirements 1.2, 2.2, 3.2, 4.3, 5.2, 6.2, 7.2, 8.2**
 *
 * For any valid Filter_Array containing any combination of supported operators,
 * the where() function of each adapter SHALL produce a valid output object
 * with the appropriate query and value structures for that adapter type.
 */

const assert = require("assert");
const fc = require("fast-check");

// Import where() from all adapters
const sqlite3Db = require("../../src/sqlite3/db");
const mysqlDb = require("../../src/mysql/db");
const postgresDb = require("../../src/postgres/db");
const oracleDb = require("../../src/oracle/db");
const mongodbDb = require("../../src/mongodb/db");
const dynamodbDb = require("../../src/dynamodb/db");
const redisDb = require("../../src/redis/db");
const cockroachdbDb = require("../../src/cockroachdb/db");
const mssqlDb = require("../../src/mssql/db");

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

// --- Arbitraries ---

const arbColumnName = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);

const arbScalarValue = fc.oneof(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.integer({ min: -10000, max: 10000 }),
);

const arbArrayValue = fc.array(arbScalarValue, { minLength: 1, maxLength: 5 });

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

const arbFilterArray = fc.array(arbAndGroup, { minLength: 1, maxLength: 3 });

// --- Helpers ---

/**
 * Count ? bind parameters in a SQL query string.
 */
function countQuestionMarks(query) {
  const matches = query.match(/\?/g);
  return matches ? matches.length : 0;
}

/**
 * Count $N bind parameters in a PostgreSQL-style query string.
 */
function countDollarParams(query) {
  const matches = query.match(/\$\d+/g);
  return matches ? new Set(matches).size : 0;
}

/**
 * Count @paramN bind parameters in an MSSQL-style query string.
 */
function countAtParams(query) {
  const matches = query.match(/@param\d+/g);
  return matches ? new Set(matches).size : 0;
}

/**
 * Count :N bind parameters in an Oracle-style query string.
 */
function countColonParams(query) {
  const matches = query.match(/:\d+/g);
  return matches ? new Set(matches).size : 0;
}

/**
 * Count expected values for a Filter_Array.
 */
function expectedValueCount(filterArray) {
  let count = 0;
  for (const andGroup of filterArray) {
    for (const condition of andGroup) {
      const op = condition[1];
      const val = condition[2];
      if (op === "in" || op === "not in") {
        count += Array.isArray(val) ? val.length : 1;
      } else {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Extract :valN placeholders from DynamoDB FilterExpression.
 */
function extractDynamoValuePlaceholders(query) {
  const matches = query.match(/:val\d+(?:_\d+)?/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extract #colN placeholders from DynamoDB FilterExpression.
 */
function extractDynamoNamePlaceholders(query) {
  const matches = query.match(/#col\d+/g);
  return matches ? [...new Set(matches)] : [];
}

// =============================================================================
// SQL Adapters: SQLite3, MySQL, PostgreSQL, Oracle, CockroachDB, MSSQL
// =============================================================================

describe("Feature: database-adapter-standardization, Property 1: Filter translation produces valid where clauses across all adapters", function () {
  // -------------------------------------------------------------------------
  // SQLite3
  // -------------------------------------------------------------------------
  describe("SQLite3", function () {
    /**
     * **Validates: Requirements 1.2**
     */
    it("should produce query with bind parameter count matching value array length", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = sqlite3Db.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(typeof result.query === "string");
          assert.ok(Array.isArray(result.value));
          assert.ok(result.query.startsWith("WHERE"));

          const bindCount = countQuestionMarks(result.query);
          assert.strictEqual(
            bindCount,
            result.value.length,
            `SQLite3: bind params (${bindCount}) != values (${result.value.length}). Query: ${result.query}`,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // MySQL
  // -------------------------------------------------------------------------
  describe("MySQL", function () {
    /**
     * **Validates: Requirements 1.2**
     *
     * MySQL uses ?? for identifiers and ? for values. The value array contains
     * both column names (for ??) and bind values (for ?).
     */
    it("should produce query with placeholder count matching value array length", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = mysqlDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(typeof result.query === "string");
          assert.ok(Array.isArray(result.value));
          assert.ok(result.query.startsWith("WHERE"));

          // Count all placeholders (?? and ?) — both consume from value array
          const totalPlaceholders = (result.query.match(/\?\??/g) || []).length;
          assert.strictEqual(
            totalPlaceholders,
            result.value.length,
            `MySQL: placeholders (${totalPlaceholders}) != values (${result.value.length}). Query: ${result.query}`,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // PostgreSQL
  // -------------------------------------------------------------------------
  describe("PostgreSQL", function () {
    /**
     * **Validates: Requirements 1.2**
     */
    it("should produce query with $N bind parameter count matching value array length", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = postgresDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(typeof result.query === "string");
          assert.ok(Array.isArray(result.value));
          assert.ok(result.query.startsWith("WHERE"));

          const bindCount = countDollarParams(result.query);
          assert.strictEqual(
            bindCount,
            result.value.length,
            `PostgreSQL: bind params (${bindCount}) != values (${result.value.length}). Query: ${result.query}`,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Oracle
  // -------------------------------------------------------------------------
  describe("Oracle", function () {
    /**
     * **Validates: Requirements 1.2**
     */
    it("should produce query with :N bind parameter count matching value array length", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = oracleDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(typeof result.query === "string");
          assert.ok(Array.isArray(result.value));
          assert.ok(result.query.startsWith("WHERE"));

          const bindCount = countColonParams(result.query);
          assert.strictEqual(
            bindCount,
            result.value.length,
            `Oracle: bind params (${bindCount}) != values (${result.value.length}). Query: ${result.query}`,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // CockroachDB
  // -------------------------------------------------------------------------
  describe("CockroachDB", function () {
    /**
     * **Validates: Requirements 5.2**
     */
    it("should produce query with $N bind parameter count matching value array length", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = cockroachdbDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(typeof result.query === "string");
          assert.ok(Array.isArray(result.value));
          assert.ok(result.query.startsWith("WHERE"));

          const bindCount = countDollarParams(result.query);
          assert.strictEqual(
            bindCount,
            result.value.length,
            `CockroachDB: bind params (${bindCount}) != values (${result.value.length}). Query: ${result.query}`,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // MSSQL
  // -------------------------------------------------------------------------
  describe("MSSQL", function () {
    /**
     * **Validates: Requirements 6.2**
     */
    it("should produce query with @paramN bind parameter count matching value array length", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = mssqlDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(typeof result.query === "string");
          assert.ok(Array.isArray(result.value));
          assert.ok(result.query.startsWith("WHERE"));

          const bindCount = countAtParams(result.query);
          assert.strictEqual(
            bindCount,
            result.value.length,
            `MSSQL: bind params (${bindCount}) != values (${result.value.length}). Query: ${result.query}`,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // MongoDB
  // -------------------------------------------------------------------------
  describe("MongoDB", function () {
    /**
     * **Validates: Requirements 2.2**
     */
    it("should produce a valid query object and empty value array", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = mongodbDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(
            typeof result.query === "object" && result.query !== null,
            "MongoDB: query must be an object",
          );
          assert.ok(Array.isArray(result.value));
          assert.deepStrictEqual(result.value, []);
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // DynamoDB
  // -------------------------------------------------------------------------
  describe("DynamoDB", function () {
    /**
     * **Validates: Requirements 3.2**
     */
    it("should produce FilterExpression with matching ExpressionAttributeValues and ExpressionAttributeNames", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = dynamodbDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(typeof result.query === "string");
          assert.ok(
            typeof result.value === "object" && !Array.isArray(result.value),
            "DynamoDB: value must be an object (ExpressionAttributeValues)",
          );
          assert.ok(
            typeof result.names === "object" && !Array.isArray(result.names),
            "DynamoDB: names must be an object (ExpressionAttributeNames)",
          );
          assert.ok(result.query.length > 0);

          // Every :valN placeholder in query must exist in result.value
          const valuePlaceholders = extractDynamoValuePlaceholders(
            result.query,
          );
          for (const ph of valuePlaceholders) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(result.value, ph),
              `DynamoDB: placeholder "${ph}" missing from value`,
            );
          }

          // Every #colN placeholder in query must exist in result.names
          const namePlaceholders = extractDynamoNamePlaceholders(result.query);
          for (const ph of namePlaceholders) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(result.names, ph),
              `DynamoDB: placeholder "${ph}" missing from names`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Redis
  // -------------------------------------------------------------------------
  describe("Redis", function () {
    /**
     * **Validates: Requirements 4.3**
     */
    it("should produce a filter function as query and empty value array", function () {
      fc.assert(
        fc.property(arbFilterArray, (filterArray) => {
          const result = redisDb.where(filterArray);
          assert.notStrictEqual(result, null);
          assert.ok(
            typeof result.query === "function",
            "Redis: query must be a function",
          );
          assert.ok(Array.isArray(result.value));
          assert.deepStrictEqual(result.value, []);
        }),
        { numRuns: 100 },
      );
    });
  });

  // =========================================================================
  // Edge cases: null, empty string, empty array → empty query for all adapters
  // =========================================================================
  describe("Edge cases: empty/null filters", function () {
    const emptyInputs = [null, "", [], [[]]];

    const sqlAdapters = [
      { name: "SQLite3", where: sqlite3Db.where },
      { name: "MySQL", where: mysqlDb.where },
      { name: "PostgreSQL", where: postgresDb.where },
      { name: "Oracle", where: oracleDb.where },
      { name: "CockroachDB", where: cockroachdbDb.where },
      { name: "MSSQL", where: mssqlDb.where },
    ];

    for (const adapter of sqlAdapters) {
      it(`${adapter.name}: should return empty query for null/empty filters`, function () {
        for (const input of emptyInputs) {
          const result = adapter.where(input);
          assert.ok(
            result !== null,
            `${adapter.name}: where(${JSON.stringify(input)}) should not return null`,
          );
          assert.strictEqual(result.query, "");
          assert.deepStrictEqual(result.value, []);
        }
      });
    }

    it("MongoDB: should return empty query object for null/empty filters", function () {
      for (const input of emptyInputs) {
        const result = mongodbDb.where(input);
        assert.ok(result !== null);
        assert.deepStrictEqual(result.query, {});
        assert.deepStrictEqual(result.value, []);
      }
    });

    it("DynamoDB: should return empty query for null/empty filters", function () {
      for (const input of emptyInputs) {
        const result = dynamodbDb.where(input);
        assert.ok(result !== null);
        assert.strictEqual(result.query, "");
        assert.deepStrictEqual(result.value, {});
        assert.deepStrictEqual(result.names, {});
      }
    });
  });

  // =========================================================================
  // Unsupported operators → null for all adapters
  // =========================================================================
  describe("Unsupported operators return null", function () {
    const allWheres = [
      { name: "SQLite3", where: sqlite3Db.where },
      { name: "MySQL", where: mysqlDb.where },
      { name: "PostgreSQL", where: postgresDb.where },
      { name: "Oracle", where: oracleDb.where },
      { name: "MongoDB", where: mongodbDb.where },
      { name: "DynamoDB", where: dynamodbDb.where },
      { name: "Redis", where: redisDb.where },
      { name: "CockroachDB", where: cockroachdbDb.where },
      { name: "MSSQL", where: mssqlDb.where },
    ];

    for (const adapter of allWheres) {
      it(`${adapter.name}: should return null for unsupported operators`, function () {
        fc.assert(
          fc.property(
            arbColumnName,
            fc
              .string({ minLength: 1, maxLength: 10 })
              .filter((s) => !SUPPORTED_OPERATORS.includes(s)),
            arbScalarValue,
            (col, badOp, val) => {
              const result = adapter.where([[[col, badOp, val]]]);
              assert.strictEqual(
                result,
                null,
                `${adapter.name}: expected null for unsupported operator "${badOp}"`,
              );
            },
          ),
          { numRuns: 100 },
        );
      });
    }
  });
});
