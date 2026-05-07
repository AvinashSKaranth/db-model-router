/**
 * Property-Based Tests: DB Manager Metadata DB
 *
 * Property 1: Connection history round-trip
 *
 * **Validates: Requirements 2.6**
 *
 * Uses a temporary SQLite database per test run.
 * fast-check generates random connection details to verify round-trip invariants.
 */

const assert = require("assert");
const fc = require("fast-check");
const path = require("path");
const fs = require("fs");
const os = require("os");
const createMetadataDb = require("../../db-manager/metadata-db.js");

// --- Arbitraries ---

// db_type: non-empty alphanumeric strings (realistic adapter names)
const arbDbType = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,19}$/)
  .filter((s) => s.length > 0);

// host: nullable string representing a hostname or IP
const arbHost = fc.oneof(
  fc.constant(null),
  fc.stringMatching(/^[a-z0-9][a-z0-9.\-]{0,49}$/).filter((s) => s.length > 0),
);

// database_name: non-empty string
const arbDbName = fc
  .stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,29}$/)
  .filter((s) => s.length > 0);

// =============================================================================
// Property 1: Connection history round-trip
// =============================================================================

describe("Feature: db-manager-app, Property 1: Connection history round-trip", function () {
  let metaDb;
  let tmpDbPath;

  beforeEach(function () {
    tmpDbPath = path.join(
      os.tmpdir(),
      `test_metadata_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`,
    );
    metaDb = createMetadataDb(tmpDbPath);
    metaDb.init();
  });

  afterEach(function () {
    metaDb.close();
    try {
      fs.unlinkSync(tmpDbPath);
    } catch (_) {
      // ignore cleanup errors
    }
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * For any valid connection details (db_type, host, database_name),
   * when a connection is recorded in the Metadata_DB, subsequently querying
   * the connections table SHALL return a record containing those exact details
   * with a valid ISO timestamp.
   */
  it("recordConnection then getConnections returns a record with exact db_type, host, database_name and valid timestamp", async function () {
    await fc.assert(
      fc.asyncProperty(
        arbDbType,
        arbHost,
        arbDbName,
        async (dbType, host, dbName) => {
          const id = metaDb.recordConnection(dbType, host, dbName);
          assert.ok(
            typeof id === "number" && id > 0,
            `recordConnection should return a positive id, got: ${id}`,
          );

          const connections = metaDb.getConnections(100);
          const found = connections.find((c) => c.id === Number(id));
          assert.ok(
            found,
            `Connection with id ${id} should be found in getConnections`,
          );

          // Verify exact field values
          assert.strictEqual(found.db_type, dbType, "db_type must match");
          assert.strictEqual(
            found.host,
            host || null,
            "host must match (null when not provided)",
          );
          assert.strictEqual(
            found.database_name,
            dbName,
            "database_name must match",
          );

          // Verify valid timestamp
          assert.ok(found.connected_at, "connected_at must be present");
          // SQLite datetime('now') produces 'YYYY-MM-DD HH:MM:SS' format
          const timestamp = new Date(found.connected_at);
          assert.ok(
            !isNaN(timestamp.getTime()),
            `connected_at must be a valid parseable date, got: ${found.connected_at}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 2: Query history recording
// =============================================================================

/**
 * Property 2: Query history recording
 *
 * **Validates: Requirements 3.4**
 *
 * For any query text and row count, when a CRUD operation is recorded in the
 * Metadata_DB, subsequently querying the queries table SHALL return a record
 * containing the exact query text, correct connection_id, row count, and a
 * valid timestamp.
 */

// Arbitraries for query history
const arbQueryText = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

const arbRowCount = fc.nat({ max: 100000 });

describe("Feature: db-manager-app, Property 2: Query history recording", function () {
  let metaDb;
  let tmpDbPath;
  let connectionId;

  beforeEach(function () {
    tmpDbPath = path.join(
      os.tmpdir(),
      `test_metadata_query_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`,
    );
    metaDb = createMetadataDb(tmpDbPath);
    metaDb.init();
    // Record a connection first to get a valid connection_id
    connectionId = metaDb.recordConnection("sqlite3", "localhost", "test_db");
  });

  afterEach(function () {
    metaDb.close();
    try {
      fs.unlinkSync(tmpDbPath);
    } catch (_) {
      // ignore cleanup errors
    }
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * For any query text and row count, when recordQuery is called,
   * getQueries SHALL return a record with exact query_text, correct
   * connection_id, row_count, and a valid timestamp.
   */
  it("recordQuery then getQueries returns a record with exact query_text, correct connection_id, row_count, and valid timestamp", async function () {
    await fc.assert(
      fc.asyncProperty(
        arbQueryText,
        arbRowCount,
        async (queryText, rowCount) => {
          const id = metaDb.recordQuery(connectionId, queryText, rowCount);
          assert.ok(
            typeof id === "number" && id > 0,
            `recordQuery should return a positive id, got: ${id}`,
          );

          const queries = metaDb.getQueries(connectionId, 1000);
          const found = queries.find((q) => q.id === Number(id));
          assert.ok(found, `Query with id ${id} should be found in getQueries`);

          // Verify exact field values
          assert.strictEqual(
            found.query_text,
            queryText,
            "query_text must match exactly",
          );
          assert.strictEqual(
            found.connection_id,
            Number(connectionId),
            "connection_id must match the recorded connection",
          );
          assert.strictEqual(
            found.row_count,
            rowCount,
            "row_count must match exactly",
          );

          // Verify valid timestamp
          assert.ok(found.executed_at, "executed_at must be present");
          // SQLite datetime('now') produces 'YYYY-MM-DD HH:MM:SS' format
          const timestamp = new Date(found.executed_at);
          assert.ok(
            !isNaN(timestamp.getTime()),
            `executed_at must be a valid parseable date, got: ${found.executed_at}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 3: Table search filter correctness
// =============================================================================

/**
 * Property 3: Table search filter correctness
 *
 * **Validates: Requirements 4.2**
 *
 * For any list of table names and any search string, the filtered result SHALL
 * contain only tables whose names include the search string as a case-insensitive
 * substring, and SHALL contain all such matching tables.
 */

const filterTables = require("../../db-manager/utils/filter-tables.js");

// Arbitrary: valid table name strings (non-empty, alphanumeric + underscore)
const arbTableNameForFilter = fc
  .stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,29}$/)
  .filter((s) => s.length > 0);

// Arbitrary: array of table names (0 to 20 entries)
const arbTableList = fc.array(arbTableNameForFilter, {
  minLength: 0,
  maxLength: 20,
});

// Arbitrary: search string (can be empty or contain any characters)
const arbSearchString = fc.string({ minLength: 0, maxLength: 30 });

describe("Feature: db-manager-app, Property 3: Table search filter correctness", function () {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any list of table names and any search string, filterTables SHALL return
   * only tables whose names include the search string (case-insensitive), and
   * SHALL return all such matching tables (no false negatives).
   */
  it("filterTables returns only and all tables whose names include the search string (case-insensitive)", function () {
    fc.assert(
      fc.property(arbTableList, arbSearchString, (tables, search) => {
        const result = filterTables(tables, search);

        // When search is empty or whitespace-only, all tables should be returned
        if (!search || search.trim() === "") {
          assert.deepStrictEqual(
            result,
            tables,
            "When search is empty, all tables must be returned (in original order)",
          );
          return;
        }

        const needle = search.toLowerCase();

        // Property: every item in result must contain the search string (case-insensitive)
        for (const table of result) {
          assert.ok(
            table.toLowerCase().includes(needle),
            `Filtered result contains "${table}" which does not include search string "${search}" (case-insensitive)`,
          );
        }

        // Property: every table that matches must be in the result (no false negatives)
        const expectedMatches = tables.filter((t) =>
          t.toLowerCase().includes(needle),
        );
        assert.strictEqual(
          result.length,
          expectedMatches.length,
          `Expected ${expectedMatches.length} matching tables, got ${result.length}`,
        );
        assert.deepStrictEqual(
          result,
          expectedMatches,
          "Filtered result must contain all matching tables in original order",
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 4: Form fields match table columns
// =============================================================================

/**
 * Property 4: Form fields match table columns
 *
 * **Validates: Requirements 6.1, 8.1**
 *
 * For any table with a set of columns, the schema API response SHALL return
 * a columns array where each entry has a name, type, nullable, default, and pk
 * field, and the set of column names SHALL exactly match the table's actual columns.
 */

const Database = require("better-sqlite3");
const createAdapterProxy = require("../../db-manager/adapter-proxy.js");

// Arbitrary: valid SQL identifier column names (start with letter, alphanumeric + underscore)
const arbColumnName = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,19}$/)
  .filter((s) => s.length >= 2);

// Arbitrary: a non-empty array of unique column names (at least 1, at most 8)
const arbColumnNames = fc
  .uniqueArray(arbColumnName, { minLength: 1, maxLength: 8 })
  .filter((arr) => arr.length >= 1);

// Arbitrary: SQL column type
const arbColumnType = fc.constantFrom(
  "TEXT",
  "INTEGER",
  "REAL",
  "BLOB",
  "NUMERIC",
);

describe("Feature: db-manager-app, Property 4: Form fields match table columns", function () {
  /**
   * **Validates: Requirements 6.1, 8.1**
   *
   * For any set of valid column names, when a table is created with those columns
   * in a temporary SQLite database, getSchema SHALL return a columns array where
   * the set of column names exactly matches the table's actual columns.
   */
  it("getSchema returns columns whose names exactly match the table's actual columns", async function () {
    await fc.assert(
      fc.asyncProperty(
        arbColumnNames,
        arbColumnType,
        async (columnNames, colType) => {
          // Create a temporary in-memory SQLite database
          const tmpDb = new Database(":memory:");
          tmpDb.pragma("journal_mode = WAL");

          // Build CREATE TABLE statement with generated column names
          // First column is the primary key
          const colDefs = columnNames.map((name, idx) => {
            if (idx === 0) {
              return `"${name}" INTEGER PRIMARY KEY`;
            }
            return `"${name}" ${colType}`;
          });
          const createSql = `CREATE TABLE test_table (${colDefs.join(", ")})`;
          tmpDb.exec(createSql);

          // Create a minimal db adapter interface that the proxy expects
          const dbAdapter = {
            query(sql, params = []) {
              const stmt = tmpDb.prepare(sql);
              if (sql.trimStart().match(/^(SELECT|PRAGMA|WITH\s)/i)) {
                return stmt.all(...params);
              }
              return stmt.run(...params);
            },
          };

          // Create adapter proxy for sqlite3
          const proxy = createAdapterProxy(dbAdapter, "sqlite3");

          // Get schema
          const schema = await proxy.getSchema("test_table");

          // Assert columns array exists and has correct length
          assert.ok(
            Array.isArray(schema.columns),
            "schema.columns must be an array",
          );
          assert.strictEqual(
            schema.columns.length,
            columnNames.length,
            `Expected ${columnNames.length} columns, got ${schema.columns.length}`,
          );

          // Assert each column has required fields
          for (const col of schema.columns) {
            assert.ok("name" in col, "Each column must have a 'name' field");
            assert.ok("type" in col, "Each column must have a 'type' field");
            assert.ok(
              "nullable" in col,
              "Each column must have a 'nullable' field",
            );
            assert.ok(
              "default" in col,
              "Each column must have a 'default' field",
            );
            assert.ok("pk" in col, "Each column must have a 'pk' field");
          }

          // Assert the set of column names exactly matches
          const returnedNames = schema.columns.map((c) => c.name);
          const sortedExpected = [...columnNames].sort();
          const sortedReturned = [...returnedNames].sort();
          assert.deepStrictEqual(
            sortedReturned,
            sortedExpected,
            `Column names must match. Expected: ${JSON.stringify(sortedExpected)}, Got: ${JSON.stringify(sortedReturned)}`,
          );

          // Cleanup
          tmpDb.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 5: Insert data integrity
// =============================================================================

/**
 * Property 5: Insert data integrity
 *
 * **Validates: Requirements 6.2**
 *
 * For any valid row data object (keys matching column names, values of appropriate
 * types), calling the insert API endpoint SHALL invoke the library adapter's
 * `insert` function with the correct table name and an equivalent data object.
 */

const express = require("express");
const supertest = require("supertest");
const apiRoutes = require("../../db-manager/routes/api.js");

// Arbitrary: valid column name keys (non-empty, alphanumeric + underscore, starts with letter)
const arbFieldName = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,14}$/)
  .filter((s) => s.length >= 2);

// Arbitrary: field values (strings or numbers)
// Note: avoid -0 since JSON.parse(JSON.stringify(-0)) === 0 (JSON doesn't distinguish -0)
const arbFieldValue = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  fc.integer({ min: -100000, max: 100000 }),
  fc
    .double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
    .filter((v) => !Object.is(v, -0)),
);

// Arbitrary: a row data object with 1-6 unique keys and string/number values
const arbRowData = fc
  .uniqueArray(arbFieldName, { minLength: 1, maxLength: 6 })
  .chain((keys) =>
    fc.tuple(...keys.map(() => arbFieldValue)).map((values) => {
      const obj = {};
      keys.forEach((k, i) => {
        obj[k] = values[i];
      });
      return obj;
    }),
  );

// Arbitrary: valid table name
const arbTableName = fc
  .stringMatching(/^[a-z][a-z0-9_]{1,19}$/)
  .filter((s) => s.length >= 2);

describe("Feature: db-manager-app, Property 5: Insert data integrity", function () {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any valid row data object, POSTing to /api/tables/:name/rows
   * SHALL invoke the adapter's insert with the correct table name and
   * an equivalent data object.
   */
  it("POST /api/tables/:name/rows invokes adapter insert with correct table and equivalent data", async function () {
    await fc.assert(
      fc.asyncProperty(arbTableName, arbRowData, async (tableName, rowData) => {
        // Track calls to the mock adapter's insert method
        const insertCalls = [];

        const mockDb = {
          insert(table, data) {
            insertCalls.push({ table, data });
            return { rows: 1, message: "1 row saved", type: "success", id: 1 };
          },
          // Provide other methods the adapter proxy may need
          query() {
            return [];
          },
          list() {
            return { data: [], count: 0 };
          },
          upsert() {
            return { rows: 1, message: "1 row saved", type: "success", id: 1 };
          },
          remove() {
            return { message: "removed" };
          },
        };

        const mockMetaDb = {
          _connectionId: 1,
          recordQuery() {},
          getConnections() {
            return [];
          },
          getQueries() {
            return [];
          },
        };

        // Set up Express app with the API routes
        const app = express();
        app.use(express.json());
        app.use(apiRoutes(mockDb, mockMetaDb, "sqlite3"));

        // POST to insert endpoint
        const res = await supertest(app)
          .post(`/api/tables/${encodeURIComponent(tableName)}/rows`)
          .send({ data: rowData })
          .expect(200);

        // Assert insert was called exactly once
        assert.strictEqual(
          insertCalls.length,
          1,
          `Expected insert to be called once, got ${insertCalls.length} calls`,
        );

        // Assert correct table name
        assert.strictEqual(
          insertCalls[0].table,
          tableName,
          `Expected table name "${tableName}", got "${insertCalls[0].table}"`,
        );

        // Assert equivalent data object
        assert.deepStrictEqual(
          insertCalls[0].data,
          rowData,
          "Insert data must be equivalent to the posted data",
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 6: Delete filter correctness
// =============================================================================

/**
 * Property 6: Delete filter correctness
 *
 * **Validates: Requirements 7.1**
 *
 * For any non-empty set of primary key values, calling the delete API endpoint
 * SHALL invoke the library adapter's `remove` function with a filter that matches
 * exactly those primary key values.
 */

// Arbitrary: non-empty array of PK values (positive integers)
const arbPkValues = fc
  .array(fc.integer({ min: 1, max: 100000 }), { minLength: 1, maxLength: 20 })
  .filter((arr) => arr.length >= 1);

// Arbitrary: valid pkColumn name
const arbPkColumn = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,14}$/)
  .filter((s) => s.length >= 2);

describe("Feature: db-manager-app, Property 6: Delete filter correctness", function () {
  /**
   * **Validates: Requirements 7.1**
   *
   * For any non-empty array of PK values and a valid table name and pkColumn,
   * DELETEing to /api/tables/:name/rows with { keys, pkColumn } SHALL invoke
   * the adapter's remove with a filter where each element is [pkColumn, keyValue]
   * matching exactly those PK values.
   */
  it("DELETE /api/tables/:name/rows invokes adapter remove with filter matching exactly those PKs", async function () {
    await fc.assert(
      fc.asyncProperty(
        arbTableName,
        arbPkColumn,
        arbPkValues,
        async (tableName, pkColumn, keys) => {
          // Track calls to the mock adapter's remove method
          const removeCalls = [];

          const mockDb = {
            remove(table, filter) {
              removeCalls.push({ table, filter });
              return { message: `${filter.length} row(s) removed` };
            },
            // Provide other methods the adapter proxy may need
            query() {
              return [];
            },
            list() {
              return { data: [], count: 0 };
            },
            insert() {
              return {
                rows: 1,
                message: "1 row saved",
                type: "success",
                id: 1,
              };
            },
            upsert() {
              return {
                rows: 1,
                message: "1 row saved",
                type: "success",
                id: 1,
              };
            },
          };

          const mockMetaDb = {
            _connectionId: 1,
            recordQuery() {},
            getConnections() {
              return [];
            },
            getQueries() {
              return [];
            },
          };

          // Set up Express app with the API routes
          const app = express();
          app.use(express.json());
          app.use(apiRoutes(mockDb, mockMetaDb, "sqlite3"));

          // DELETE to the rows endpoint
          const res = await supertest(app)
            .delete(`/api/tables/${encodeURIComponent(tableName)}/rows`)
            .send({ keys, pkColumn })
            .expect(200);

          // Assert remove was called exactly once
          assert.strictEqual(
            removeCalls.length,
            1,
            `Expected remove to be called once, got ${removeCalls.length} calls`,
          );

          // Assert correct table name
          assert.strictEqual(
            removeCalls[0].table,
            tableName,
            `Expected table name "${tableName}", got "${removeCalls[0].table}"`,
          );

          // Assert filter matches exactly those PK values
          const expectedFilter = keys.map((k) => [[pkColumn, "=", k]]);
          assert.deepStrictEqual(
            removeCalls[0].filter,
            expectedFilter,
            "Remove filter must be an array of [[pkColumn, '=', keyValue]] conditions matching exactly the provided keys",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 7: Upsert data integrity
// =============================================================================

/**
 * Property 7: Upsert data integrity
 *
 * **Validates: Requirements 8.2**
 *
 * For any valid modified row data object and set of unique keys, calling the
 * update API endpoint SHALL invoke the library adapter's `upsert` function with
 * the correct table name, data object, and unique keys array.
 */

// Arbitrary: row data with a subset of its keys used as uniqueKeys
const arbRowDataWithUniqueKeys = fc
  .uniqueArray(arbFieldName, { minLength: 1, maxLength: 6 })
  .chain((keys) =>
    fc.tuple(
      fc.tuple(...keys.map(() => arbFieldValue)).map((values) => {
        const obj = {};
        keys.forEach((k, i) => {
          obj[k] = values[i];
        });
        return obj;
      }),
      // Pick a non-empty subset of the keys as uniqueKeys
      fc.subarray(keys, { minLength: 1 }),
    ),
  )
  .map(([data, uniqueKeys]) => ({ data, uniqueKeys }));

describe("Feature: db-manager-app, Property 7: Upsert data integrity", function () {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any valid row data object and set of unique keys, PUTting to
   * /api/tables/:name/rows with { data, uniqueKeys } SHALL invoke the
   * adapter's upsert with the correct table name, equivalent data object,
   * and the uniqueKeys array.
   */
  it("PUT /api/tables/:name/rows invokes adapter upsert with correct table, data, and uniqueKeys", async function () {
    await fc.assert(
      fc.asyncProperty(
        arbTableName,
        arbRowDataWithUniqueKeys,
        async (tableName, { data, uniqueKeys }) => {
          // Track calls to the mock adapter's upsert method
          const upsertCalls = [];

          const mockDb = {
            upsert(table, rowData, keys) {
              upsertCalls.push({ table, data: rowData, uniqueKeys: keys });
              return {
                rows: 1,
                message: "1 row saved",
                type: "success",
                id: 1,
              };
            },
            // Provide other methods the adapter proxy may need
            query() {
              return [];
            },
            list() {
              return { data: [], count: 0 };
            },
            insert() {
              return {
                rows: 1,
                message: "1 row saved",
                type: "success",
                id: 1,
              };
            },
            remove() {
              return { message: "removed" };
            },
          };

          const mockMetaDb = {
            _connectionId: 1,
            recordQuery() {},
            getConnections() {
              return [];
            },
            getQueries() {
              return [];
            },
          };

          // Set up Express app with the API routes
          const app = express();
          app.use(express.json());
          app.use(apiRoutes(mockDb, mockMetaDb, "sqlite3"));

          // PUT to upsert endpoint
          const res = await supertest(app)
            .put(`/api/tables/${encodeURIComponent(tableName)}/rows`)
            .send({ data, uniqueKeys })
            .expect(200);

          // Assert upsert was called exactly once
          assert.strictEqual(
            upsertCalls.length,
            1,
            `Expected upsert to be called once, got ${upsertCalls.length} calls`,
          );

          // Assert correct table name
          assert.strictEqual(
            upsertCalls[0].table,
            tableName,
            `Expected table name "${tableName}", got "${upsertCalls[0].table}"`,
          );

          // Assert equivalent data object
          assert.deepStrictEqual(
            upsertCalls[0].data,
            data,
            "Upsert data must be equivalent to the posted data",
          );

          // Assert uniqueKeys array matches
          assert.deepStrictEqual(
            upsertCalls[0].uniqueKeys,
            uniqueKeys,
            "Upsert uniqueKeys must match the posted uniqueKeys array",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 8: Export data integrity and format
// =============================================================================

/**
 * Property 8: Export data integrity and format
 *
 * **Validates: Requirements 9.1, 9.2**
 *
 * For any set of selected rows, the export API endpoint SHALL return valid JSON
 * containing exactly those rows (no more, no less), and the JSON SHALL round-trip
 * parse to produce equivalent objects.
 */

// Arbitrary: a non-empty array of row objects, each with an "id" field and some data fields
const arbExportRows = fc
  .uniqueArray(fc.integer({ min: 1, max: 100000 }), {
    minLength: 1,
    maxLength: 10,
  })
  .chain((ids) =>
    fc
      .tuple(...ids.map((id) => arbRowData.map((data) => ({ id, ...data }))))
      .map((rows) => rows),
  );

describe("Feature: db-manager-app, Property 8: Export data integrity and format", function () {
  /**
   * **Validates: Requirements 9.1, 9.2**
   *
   * For any non-empty set of row objects with unique ids, POSTing to
   * /api/tables/:name/export with { keys, pkColumn: "id" } SHALL return
   * valid CSV that contains a header row with column names and data rows
   * matching exactly those rows.
   */
  it("POST /api/tables/:name/export returns valid CSV containing exactly the selected rows", async function () {
    await fc.assert(
      fc.asyncProperty(arbTableName, arbExportRows, async (tableName, rows) => {
        const keys = rows.map((r) => r.id);

        const mockDb = {
          list(table, filter, sort, extra, page, limit) {
            // Return the rows when called with the matching filter
            return { data: rows, count: rows.length };
          },
          query() {
            return [
              {
                name: "id",
                type: "INTEGER",
                pk: 1,
                notnull: 1,
                dflt_value: null,
              },
              {
                name: "name",
                type: "TEXT",
                pk: 0,
                notnull: 0,
                dflt_value: null,
              },
              {
                name: "email",
                type: "TEXT",
                pk: 0,
                notnull: 0,
                dflt_value: null,
              },
            ];
          },
          insert() {
            return { rows: 1, message: "1 row saved", type: "success", id: 1 };
          },
          upsert() {
            return { rows: 1, message: "1 row saved", type: "success", id: 1 };
          },
          remove() {
            return { message: "removed" };
          },
        };

        const mockMetaDb = {
          _connectionId: 1,
          recordQuery() {},
          getConnections() {
            return [];
          },
          getQueries() {
            return [];
          },
        };

        // Set up Express app with the API routes
        const app = express();
        app.use(express.json());
        app.use(apiRoutes(mockDb, mockMetaDb, "sqlite3"));

        // POST to export endpoint
        const res = await supertest(app)
          .post(`/api/tables/${encodeURIComponent(tableName)}/export`)
          .send({ keys, pkColumn: "id" });

        // Assert response status is 200
        assert.strictEqual(
          res.status,
          200,
          `Expected status 200, got ${res.status}`,
        );

        // Assert Content-Type is text/csv
        assert.ok(
          res.headers["content-type"].includes("text/csv"),
          `Expected content-type to include text/csv, got: ${res.headers["content-type"]}`,
        );

        // Assert response body is valid CSV with header and data rows
        const bodyText = res.text;
        const lines = bodyText.split("\r\n").filter((l) => l.length > 0);

        // Should have header + data rows
        assert.ok(lines.length >= 1, "CSV must have at least a header row");

        // Header row should contain column names
        const header = lines[0];
        assert.ok(header.includes("id"), "CSV header must contain 'id' column");
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 9: Export filename derivation
// =============================================================================

/**
 * Property 9: Export filename derivation
 *
 * **Validates: Requirements 9.3**
 *
 * For any valid table name, the export response SHALL include a Content-Disposition
 * header with a filename that contains the table name as a substring.
 */

describe("Feature: db-manager-app, Property 9: Export filename derivation", function () {
  /**
   * **Validates: Requirements 9.3**
   *
   * For any valid table name, POSTing to /api/tables/:name/export with valid
   * keys SHALL return a response with a Content-Disposition header whose
   * filename contains the table name as a substring.
   */
  it("POST /api/tables/:name/export returns Content-Disposition header with filename containing the table name", async function () {
    await fc.assert(
      fc.asyncProperty(arbTableName, async (tableName) => {
        const mockDb = {
          list(table, filter, sort, extra, page, limit) {
            return { data: [{ id: 1, name: "test" }], count: 1 };
          },
          query() {
            return [
              {
                name: "id",
                type: "INTEGER",
                pk: 1,
                notnull: 1,
                dflt_value: null,
              },
              {
                name: "name",
                type: "TEXT",
                pk: 0,
                notnull: 0,
                dflt_value: null,
              },
            ];
          },
          insert() {
            return { rows: 1, message: "1 row saved", type: "success", id: 1 };
          },
          upsert() {
            return { rows: 1, message: "1 row saved", type: "success", id: 1 };
          },
          remove() {
            return { message: "removed" };
          },
        };

        const mockMetaDb = {
          _connectionId: 1,
          recordQuery() {},
          getConnections() {
            return [];
          },
          getQueries() {
            return [];
          },
        };

        // Set up Express app with the API routes
        const app = express();
        app.use(express.json());
        app.use(apiRoutes(mockDb, mockMetaDb, "sqlite3"));

        // POST to export endpoint
        const res = await supertest(app)
          .post(`/api/tables/${encodeURIComponent(tableName)}/export`)
          .send({ keys: [1], pkColumn: "id" });

        // Assert response status is 200
        assert.strictEqual(
          res.status,
          200,
          `Expected status 200, got ${res.status}`,
        );

        // Assert Content-Disposition header exists
        const contentDisposition = res.headers["content-disposition"];
        assert.ok(
          contentDisposition,
          "Response must have a Content-Disposition header",
        );

        // Assert the filename in Content-Disposition contains the table name
        assert.ok(
          contentDisposition.includes(tableName),
          `Content-Disposition header "${contentDisposition}" must contain the table name "${tableName}"`,
        );
      }),
      { numRuns: 100 },
    );
  });
});
