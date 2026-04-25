/**
 * Property-Based Tests: CLI Init Scaffolding
 *
 * Tests for the pure generator functions and dependency collector
 * used by the `db-model-router-init` CLI command.
 */

"use strict";

const assert = require("assert");
const fc = require("fast-check");

const {
  DRIVER_MAP,
  collectDependencies,
  getScripts,
} = require("../../src/cli/init/dependencies");

const {
  generateAppJs,
  generateEnvFile,
  generateEnvExample,
  generateInitialMigration,
  migrationTimestamp,
  SQL_DATABASES,
  NOSQL_DATABASES,
} = require("../../src/cli/init/generators");

// --- Shared Arbitrary ---

/**
 * Generates a valid `answers` object covering the full input space:
 * 9 databases × 3 sessions × 2 frameworks × 2³ booleans = 432 combinations.
 */
function arbAnswers() {
  return fc.record({
    framework: fc.constantFrom("ultimate-express", "express"),
    database: fc.constantFrom(
      "mysql",
      "postgres",
      "sqlite3",
      "mongodb",
      "mssql",
      "cockroachdb",
      "oracle",
      "redis",
      "dynamodb",
    ),
    session: fc.constantFrom("memory", "redis", "database"),
    rateLimiting: fc.boolean(),
    helmet: fc.boolean(),
    logger: fc.boolean(),
  });
}

// =============================================================================
// Property Tests
// =============================================================================

describe("Feature: cli-init-scaffolding", function () {
  // ---------------------------------------------------------------------------
  // Property 1: Database driver mapping is correct
  // ---------------------------------------------------------------------------
  describe("Property 1: Database driver mapping is correct", function () {
    /**
     * **Validates: Requirements 3.2, 3.3**
     *
     * For any valid answers object, collectDependencies(answers) SHALL include
     * all driver packages from DRIVER_MAP[answers.database] in the returned
     * dependencies object.
     */
    it("collectDependencies includes the correct driver package(s) for every database selection", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const { dependencies } = collectDependencies(answers);
          const expectedDrivers = DRIVER_MAP[answers.database];

          assert.ok(
            Array.isArray(expectedDrivers) && expectedDrivers.length > 0,
            `DRIVER_MAP should have entries for "${answers.database}"`,
          );

          for (const driver of expectedDrivers) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(dependencies, driver),
              `dependencies should include driver "${driver}" for database "${answers.database}"`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 2: Environment variables match database selection
  // ---------------------------------------------------------------------------
  describe("Property 2: Environment variables match database selection", function () {
    /**
     * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9**
     *
     * For any valid answers object, generateEnvFile(answers) SHALL produce a
     * string containing PORT=3000 and the database-specific environment
     * variables with correct default port values.
     */

    /** Expected env vars per database (vars that MUST be present). */
    const DB_ENV_EXPECTATIONS = {
      mysql: {
        present: ["DB_HOST", "DB_PORT=3306", "DB_NAME", "DB_USER", "DB_PASS"],
        absent: [],
      },
      postgres: {
        present: ["DB_HOST", "DB_PORT=5432", "DB_NAME", "DB_USER", "DB_PASS"],
        absent: [],
      },
      cockroachdb: {
        present: ["DB_HOST", "DB_PORT=26257", "DB_NAME", "DB_USER", "DB_PASS"],
        absent: [],
      },
      sqlite3: {
        present: ["DB_NAME"],
        absent: ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASS"],
      },
      mongodb: {
        present: ["DB_HOST", "DB_PORT=27017", "DB_NAME", "DB_USER", "DB_PASS"],
        absent: [],
      },
      mssql: {
        present: ["DB_HOST", "DB_PORT=1433", "DB_NAME", "DB_USER", "DB_PASS"],
        absent: [],
      },
      oracle: {
        present: ["DB_HOST", "DB_PORT=1521", "DB_NAME", "DB_USER", "DB_PASS"],
        absent: [],
      },
      redis: {
        present: ["DB_HOST", "DB_PORT=6379", "DB_PASS"],
        absent: ["DB_NAME", "DB_USER"],
      },
      dynamodb: {
        present: [
          "AWS_REGION",
          "AWS_ENDPOINT",
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
        ],
        absent: ["DB_HOST", "DB_PORT"],
      },
    };

    it("generateEnvFile contains PORT=3000 and correct database-specific env vars for every database selection", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const env = generateEnvFile(answers);

          // PORT=3000 must always be present
          assert.ok(
            env.includes("PORT=3000"),
            `env output should contain PORT=3000 for database "${answers.database}"`,
          );

          const expectations = DB_ENV_EXPECTATIONS[answers.database];

          // Check all expected present vars
          for (const varSpec of expectations.present) {
            assert.ok(
              env.includes(varSpec),
              `env output should contain "${varSpec}" for database "${answers.database}"`,
            );
          }

          // Check all expected absent vars
          for (const varName of expectations.absent) {
            // Match the var name at the start of a line (as an env key)
            const pattern = new RegExp(`^${varName}=`, "m");
            assert.ok(
              !pattern.test(env),
              `env output should NOT contain "${varName}=" for database "${answers.database}"`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 3: Redis session env vars are included when needed
  // ---------------------------------------------------------------------------
  describe("Property 3: Redis session env vars are included when needed", function () {
    /**
     * **Validates: Requirements 9.10**
     *
     * For any valid answers object:
     * - When session === 'redis' AND database !== 'redis': REDIS_HOST, REDIS_PORT, REDIS_PASS must be present
     * - When session !== 'redis' OR database === 'redis': REDIS_HOST, REDIS_PORT, REDIS_PASS must be absent
     */

    const REDIS_SESSION_VARS = ["REDIS_HOST", "REDIS_PORT", "REDIS_PASS"];

    it("generateEnvFile includes REDIS_HOST, REDIS_PORT, REDIS_PASS when session is redis and database is not redis, absent otherwise", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const env = generateEnvFile(answers);
          const shouldInclude =
            answers.session === "redis" && answers.database !== "redis";

          for (const varName of REDIS_SESSION_VARS) {
            const pattern = new RegExp(`^${varName}=`, "m");
            if (shouldInclude) {
              assert.ok(
                pattern.test(env),
                `env output should contain "${varName}=" when session is redis and database is "${answers.database}"`,
              );
            } else {
              assert.ok(
                !pattern.test(env),
                `env output should NOT contain "${varName}=" when session is "${answers.session}" and database is "${answers.database}"`,
              );
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 4: .env and .env.example have identical variable names
  // ---------------------------------------------------------------------------
  describe("Property 4: .env and .env.example have identical variable names", function () {
    /**
     * **Validates: Requirements 9.11**
     *
     * For any valid answers object, the set of variable names (LHS of `=`)
     * in generateEnvFile(answers) SHALL equal the set of variable names in
     * generateEnvExample(answers).
     */

    /**
     * Extract variable names (left-hand side of `=`) from env file content,
     * ignoring comment lines (starting with #) and empty lines.
     */
    function extractVarNames(envContent) {
      return new Set(
        envContent
          .split("\n")
          .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
          .map((line) => line.split("=")[0]),
      );
    }

    it("generateEnvFile and generateEnvExample produce identical sets of variable names for every answers configuration", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const envVars = extractVarNames(generateEnvFile(answers));
          const exampleVars = extractVarNames(generateEnvExample(answers));

          // Assert both sets have the same size
          assert.strictEqual(
            envVars.size,
            exampleVars.size,
            `Variable count mismatch for database "${answers.database}", session "${answers.session}": .env has ${envVars.size}, .env.example has ${exampleVars.size}`,
          );

          // Assert every var in .env is also in .env.example
          for (const varName of envVars) {
            assert.ok(
              exampleVars.has(varName),
              `Variable "${varName}" found in .env but missing from .env.example (database: "${answers.database}", session: "${answers.session}")`,
            );
          }

          // Assert every var in .env.example is also in .env
          for (const varName of exampleVars) {
            assert.ok(
              envVars.has(varName),
              `Variable "${varName}" found in .env.example but missing from .env (database: "${answers.database}", session: "${answers.session}")`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 5: Migration file extension matches SQL/NoSQL classification
  // ---------------------------------------------------------------------------
  describe("Property 5: Migration file extension matches SQL/NoSQL classification", function () {
    /**
     * **Validates: Requirements 8.2, 8.3**
     *
     * For any valid answers object:
     * - When database is a SQL database: generateInitialMigration(answers).filename ends with `.sql`
     * - When database is a NoSQL database: generateInitialMigration(answers).filename ends with `.js`
     */
    it("generateInitialMigration returns .sql for SQL databases and .js for NoSQL databases", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const { filename } = generateInitialMigration(answers);

          if (SQL_DATABASES.includes(answers.database)) {
            assert.ok(
              filename.endsWith(".sql"),
              `Expected .sql extension for SQL database "${answers.database}", got filename "${filename}"`,
            );
          } else {
            assert.ok(
              NOSQL_DATABASES.includes(answers.database),
              `Database "${answers.database}" should be in NOSQL_DATABASES`,
            );
            assert.ok(
              filename.endsWith(".js"),
              `Expected .js extension for NoSQL database "${answers.database}", got filename "${filename}"`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 6: Migration timestamp format is YYYYMMDDHHMMSS
  // ---------------------------------------------------------------------------
  describe("Property 6: Migration timestamp format is YYYYMMDDHHMMSS", function () {
    /**
     * **Validates: Requirements 8.4**
     *
     * For any Date object, migrationTimestamp(date) SHALL produce a 14-character
     * string consisting entirely of digits, where the first 4 digits represent
     * a valid year, the next 2 a valid month (01-12), the next 2 a valid day
     * (01-31), the next 2 a valid hour (00-23), the next 2 a valid minute
     * (00-59), and the last 2 a valid second (00-59).
     */
    it("migrationTimestamp produces a 14-digit string with valid date/time component ranges", function () {
      fc.assert(
        fc.property(
          fc.date({
            min: new Date("0001-01-01T00:00:00Z"),
            max: new Date("9999-01-01T00:00:00Z"),
          }),
          (date) => {
            const ts = migrationTimestamp(date);

            // Exactly 14 characters
            assert.strictEqual(
              ts.length,
              14,
              `Expected 14 characters, got ${ts.length}: "${ts}"`,
            );

            // All digits
            assert.ok(/^\d{14}$/.test(ts), `Expected all digits, got "${ts}"`);

            // Parse components
            const year = parseInt(ts.slice(0, 4), 10);
            const month = parseInt(ts.slice(4, 6), 10);
            const day = parseInt(ts.slice(6, 8), 10);
            const hour = parseInt(ts.slice(8, 10), 10);
            const minute = parseInt(ts.slice(10, 12), 10);
            const second = parseInt(ts.slice(12, 14), 10);

            // Valid month (01-12)
            assert.ok(
              month >= 1 && month <= 12,
              `Month should be 01-12, got ${month} from "${ts}"`,
            );

            // Valid day (01-31)
            assert.ok(
              day >= 1 && day <= 31,
              `Day should be 01-31, got ${day} from "${ts}"`,
            );

            // Valid hour (00-23)
            assert.ok(
              hour >= 0 && hour <= 23,
              `Hour should be 00-23, got ${hour} from "${ts}"`,
            );

            // Valid minute (00-59)
            assert.ok(
              minute >= 0 && minute <= 59,
              `Minute should be 00-59, got ${minute} from "${ts}"`,
            );

            // Valid second (00-59)
            assert.ok(
              second >= 0 && second <= 59,
              `Second should be 00-59, got ${second} from "${ts}"`,
            );

            // Year should be a 4-digit number
            assert.ok(
              year >= 0 && year <= 9999,
              `Year should be 0000-9999, got ${year} from "${ts}"`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 7: Optional middleware toggles control both dependencies and app.js content
  // ---------------------------------------------------------------------------
  describe("Property 7: Optional middleware toggles control both dependencies and app.js content", function () {
    /**
     * **Validates: Requirements 5.2, 5.3, 6.2, 6.3, 7.2, 7.3, 11.5, 11.6, 11.7**
     *
     * For any valid answers configuration and for each boolean middleware flag
     * (rateLimiting, helmet, logger): when the flag is true,
     * collectDependencies(answers) SHALL include the corresponding package
     * AND generateAppJs(answers) SHALL contain the corresponding middleware setup.
     * When the flag is false, the package SHALL be absent from dependencies
     * AND the middleware setup SHALL be absent from app.js.
     *
     * Note: the logger middleware file is always required in app.js via
     * require("./middleware/logger"), but express-mung as a dependency is only
     * present when logger is true.
     */
    it("rateLimiting toggle controls express-rate-limit dep and rateLimit middleware in app.js", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const { dependencies } = collectDependencies(answers);
          const appJs = generateAppJs(answers);

          if (answers.rateLimiting) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(
                dependencies,
                "express-rate-limit",
              ),
              `dependencies should include "express-rate-limit" when rateLimiting is true`,
            );
            assert.ok(
              appJs.includes('require("express-rate-limit")'),
              `app.js should contain rateLimit require when rateLimiting is true`,
            );
            assert.ok(
              appJs.includes("rateLimit("),
              `app.js should contain rateLimit() middleware setup when rateLimiting is true`,
            );
          } else {
            assert.ok(
              !Object.prototype.hasOwnProperty.call(
                dependencies,
                "express-rate-limit",
              ),
              `dependencies should NOT include "express-rate-limit" when rateLimiting is false`,
            );
            assert.ok(
              !appJs.includes('require("express-rate-limit")'),
              `app.js should NOT contain rateLimit require when rateLimiting is false`,
            );
            assert.ok(
              !appJs.includes("rateLimit("),
              `app.js should NOT contain rateLimit() middleware setup when rateLimiting is false`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });

    it("helmet toggle controls helmet dep and helmet() middleware in app.js", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const { dependencies } = collectDependencies(answers);
          const appJs = generateAppJs(answers);

          if (answers.helmet) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(dependencies, "helmet"),
              `dependencies should include "helmet" when helmet is true`,
            );
            assert.ok(
              appJs.includes('require("helmet")'),
              `app.js should contain helmet require when helmet is true`,
            );
            assert.ok(
              appJs.includes("helmet()"),
              `app.js should contain helmet() middleware setup when helmet is true`,
            );
          } else {
            assert.ok(
              !Object.prototype.hasOwnProperty.call(dependencies, "helmet"),
              `dependencies should NOT include "helmet" when helmet is false`,
            );
            assert.ok(
              !appJs.includes('require("helmet")'),
              `app.js should NOT contain helmet require when helmet is false`,
            );
            assert.ok(
              !appJs.includes("helmet()"),
              `app.js should NOT contain helmet() middleware setup when helmet is false`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });

    it("logger toggle controls express-mung dep presence", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const { dependencies } = collectDependencies(answers);

          if (answers.logger) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(
                dependencies,
                "express-mung",
              ),
              `dependencies should include "express-mung" when logger is true`,
            );
          } else {
            assert.ok(
              !Object.prototype.hasOwnProperty.call(
                dependencies,
                "express-mung",
              ),
              `dependencies should NOT include "express-mung" when logger is false`,
            );
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 8: Session store configuration matches selection
  // ---------------------------------------------------------------------------
  describe("Property 8: Session store configuration matches selection", function () {
    /**
     * **Validates: Requirements 4.2, 4.3, 4.4, 11.4**
     *
     * For any valid answers configuration, generateAppJs(answers) SHALL contain
     * session middleware configuration matching the selected session store:
     * - 'memory': in-memory store comment and session({...}) but NOT RedisStore
     * - 'redis': Redis store comment, RedisStore, connect-redis require
     * - 'database': database store comment and session({...}) but NOT RedisStore
     *
     * Additionally, when session === 'redis', collectDependencies(answers) SHALL
     * include connect-redis and ioredis (ioredis may already be present via
     * database driver when database === 'redis').
     */
    it("memory session: app.js contains in-memory store setup without RedisStore", function () {
      fc.assert(
        fc.property(
          arbAnswers().filter((a) => a.session === "memory"),
          (answers) => {
            const appJs = generateAppJs(answers);

            // Should contain in-memory session comment
            assert.ok(
              appJs.includes("// Session with in-memory store"),
              `app.js should contain "// Session with in-memory store" when session is memory`,
            );

            // Should contain session middleware
            assert.ok(
              appJs.includes("session("),
              `app.js should contain session() middleware when session is memory`,
            );

            // Should NOT contain RedisStore
            assert.ok(
              !appJs.includes("RedisStore"),
              `app.js should NOT contain RedisStore when session is memory`,
            );

            // Should NOT contain connect-redis require
            assert.ok(
              !appJs.includes('require("connect-redis")'),
              `app.js should NOT contain connect-redis require when session is memory`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("redis session: app.js contains Redis store setup with RedisStore and connect-redis", function () {
      fc.assert(
        fc.property(
          arbAnswers().filter((a) => a.session === "redis"),
          (answers) => {
            const appJs = generateAppJs(answers);

            // Should contain Redis session comment
            assert.ok(
              appJs.includes("// Session with Redis store"),
              `app.js should contain "// Session with Redis store" when session is redis`,
            );

            // Should contain RedisStore
            assert.ok(
              appJs.includes("RedisStore"),
              `app.js should contain RedisStore when session is redis`,
            );

            // Should contain connect-redis require
            assert.ok(
              appJs.includes('require("connect-redis")'),
              `app.js should contain connect-redis require when session is redis`,
            );

            // Should contain ioredis require
            assert.ok(
              appJs.includes('require("ioredis")'),
              `app.js should contain ioredis require when session is redis`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("database session: app.js contains database store setup without RedisStore", function () {
      fc.assert(
        fc.property(
          arbAnswers().filter((a) => a.session === "database"),
          (answers) => {
            const appJs = generateAppJs(answers);

            // Should contain database session comment
            assert.ok(
              appJs.includes("// Session with database store"),
              `app.js should contain "// Session with database store" when session is database`,
            );

            // Should contain session middleware
            assert.ok(
              appJs.includes("session("),
              `app.js should contain session() middleware when session is database`,
            );

            // Should NOT contain RedisStore
            assert.ok(
              !appJs.includes("RedisStore"),
              `app.js should NOT contain RedisStore when session is database`,
            );

            // Should NOT contain connect-redis require
            assert.ok(
              !appJs.includes('require("connect-redis")'),
              `app.js should NOT contain connect-redis require when session is database`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("redis session: collectDependencies includes connect-redis and ioredis", function () {
      fc.assert(
        fc.property(
          arbAnswers().filter((a) => a.session === "redis"),
          (answers) => {
            const { dependencies } = collectDependencies(answers);

            // connect-redis must always be present for redis session
            assert.ok(
              Object.prototype.hasOwnProperty.call(
                dependencies,
                "connect-redis",
              ),
              `dependencies should include "connect-redis" when session is redis`,
            );

            // ioredis must be present (either via session or via database driver)
            assert.ok(
              Object.prototype.hasOwnProperty.call(dependencies, "ioredis"),
              `dependencies should include "ioredis" when session is redis`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("non-redis session: collectDependencies does NOT include connect-redis", function () {
      fc.assert(
        fc.property(
          arbAnswers().filter((a) => a.session !== "redis"),
          (answers) => {
            const { dependencies } = collectDependencies(answers);

            assert.ok(
              !Object.prototype.hasOwnProperty.call(
                dependencies,
                "connect-redis",
              ),
              `dependencies should NOT include "connect-redis" when session is "${answers.session}"`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Property 9: Core output invariants
  // ---------------------------------------------------------------------------
  describe("Property 9: Core output invariants", function () {
    /**
     * **Validates: Requirements 11.1, 11.2, 11.3, 11.8, 11.9, 11.10, 12.1, 12.2, 10.1–10.5, 4.6**
     *
     * For any valid answers configuration:
     * - generateAppJs always contains framework require, init(), db.connect(),
     *   express.json(), express.urlencoded, /health, error handler, process.env.PORT
     * - collectDependencies always includes db-model-router, dotenv, express-session,
     *   selected framework in deps and nodemon in devDeps
     * - getScripts() returns all 5 scripts with correct values
     */

    it("generateAppJs always contains framework require, init(), db.connect(), express.json(), express.urlencoded, /health, error handler, and process.env.PORT", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const appJs = generateAppJs(answers);

          // Framework require
          const expectedRequire =
            answers.framework === "ultimate-express"
              ? 'require("ultimate-express")'
              : 'require("express")';
          assert.ok(
            appJs.includes(expectedRequire),
            `app.js should contain ${expectedRequire} for framework "${answers.framework}"`,
          );

          // init() call with selected database
          assert.ok(
            appJs.includes(`init("${answers.database}")`),
            `app.js should contain init("${answers.database}")`,
          );

          // db.connect(
          assert.ok(
            appJs.includes("db.connect("),
            `app.js should contain db.connect(`,
          );

          // express.json()
          assert.ok(
            appJs.includes("express.json()"),
            `app.js should contain express.json()`,
          );

          // express.urlencoded
          assert.ok(
            appJs.includes("express.urlencoded"),
            `app.js should contain express.urlencoded`,
          );

          // /health endpoint
          assert.ok(
            appJs.includes("/health"),
            `app.js should contain /health endpoint`,
          );

          // Error handler (err, req, res, next)
          assert.ok(
            appJs.includes("err, req, res, next"),
            `app.js should contain error handler with (err, req, res, next)`,
          );

          // process.env.PORT
          assert.ok(
            appJs.includes("process.env.PORT"),
            `app.js should contain process.env.PORT`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it("collectDependencies always includes db-model-router, dotenv, express-session, selected framework in deps and nodemon in devDeps", function () {
      fc.assert(
        fc.property(arbAnswers(), (answers) => {
          const { dependencies, devDependencies } =
            collectDependencies(answers);

          // db-model-router
          assert.ok(
            Object.prototype.hasOwnProperty.call(
              dependencies,
              "db-model-router",
            ),
            `dependencies should include "db-model-router"`,
          );

          // dotenv
          assert.ok(
            Object.prototype.hasOwnProperty.call(dependencies, "dotenv"),
            `dependencies should include "dotenv"`,
          );

          // express-session
          assert.ok(
            Object.prototype.hasOwnProperty.call(
              dependencies,
              "express-session",
            ),
            `dependencies should include "express-session"`,
          );

          // selected framework
          assert.ok(
            Object.prototype.hasOwnProperty.call(
              dependencies,
              answers.framework,
            ),
            `dependencies should include selected framework "${answers.framework}"`,
          );

          // nodemon in devDependencies
          assert.ok(
            Object.prototype.hasOwnProperty.call(devDependencies, "nodemon"),
            `devDependencies should include "nodemon"`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it("getScripts() returns exactly the 5 scripts with correct values", function () {
      const scripts = getScripts();

      assert.strictEqual(
        Object.keys(scripts).length,
        5,
        `getScripts() should return exactly 5 scripts`,
      );

      assert.strictEqual(
        scripts.start,
        "node app.js",
        `start script should be "node app.js"`,
      );

      assert.strictEqual(
        scripts.dev,
        "nodemon app.js",
        `dev script should be "nodemon app.js"`,
      );

      assert.strictEqual(
        scripts.test,
        'echo "Error: no test specified" && exit 1',
        `test script should be 'echo "Error: no test specified" && exit 1'`,
      );

      assert.strictEqual(
        scripts.migrate,
        "node migrate.js",
        `migrate script should be "node migrate.js"`,
      );

      assert.strictEqual(
        scripts.add_migration,
        "node add_migration.js",
        `add_migration script should be "node add_migration.js"`,
      );
    });
  });
});
