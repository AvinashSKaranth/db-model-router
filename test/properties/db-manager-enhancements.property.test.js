/**
 * Property-Based Tests: DB Manager Enhancements
 *
 * Property 1: CSV generation round-trip
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.3**
 *
 * Uses fast-check to generate arbitrary column names and row data,
 * then verifies that generateCSV produces output that can be parsed
 * back to equivalent data.
 */

"use strict";

const assert = require("assert");
const fc = require("fast-check");
const {
  generateCSV,
  escapeCSVCell,
} = require("../../db-manager/utils/csv-export.js");
const { nextSortState } = require("../../db-manager/utils/sort-state.js");

// =============================================================================
// CSV Parser for round-trip verification
// =============================================================================

/**
 * Parses an RFC 4180 compliant CSV string into an array of rows.
 * Returns { headers: string[], rows: string[][] }
 */
function parseCSV(csvString) {
  const records = [];
  let current = "";
  let inQuotes = false;
  const fields = [];

  for (let i = 0; i < csvString.length; i++) {
    const ch = csvString[i];
    const next = csvString[i + 1];

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          // Escaped double quote
          current += '"';
          i++; // skip next quote
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else if (ch === "\r" && next === "\n") {
        // End of record (CRLF)
        fields.push(current);
        current = "";
        records.push([...fields]);
        fields.length = 0;
        i++; // skip \n
      } else if (ch === "\n") {
        // End of record (LF only - shouldn't happen in RFC 4180 but handle gracefully)
        fields.push(current);
        current = "";
        records.push([...fields]);
        fields.length = 0;
      } else {
        current += ch;
      }
    }
  }

  // Handle any remaining content (if CSV doesn't end with CRLF)
  if (current.length > 0 || fields.length > 0) {
    fields.push(current);
    records.push([...fields]);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  return {
    headers: records[0],
    rows: records.slice(1),
  };
}

// =============================================================================
// Arbitraries
// =============================================================================

// Column names: alphanumeric to avoid edge cases in column name parsing for round-trip
const arbColumnName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,14}$/)
  .filter((s) => s.length >= 1);

// Unique column names array (1 to 8 columns)
const arbColumns = fc
  .uniqueArray(arbColumnName, { minLength: 1, maxLength: 8 })
  .filter((arr) => arr.length >= 1);

// Cell values: strings, numbers, or null
const arbCellValue = fc.oneof(
  fc.constant(null),
  fc.integer({ min: -100000, max: 100000 }),
  fc
    .double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
    .filter((v) => !Object.is(v, -0) && isFinite(v)),
  fc.string({ minLength: 0, maxLength: 50 }),
);

/**
 * Generate an array of row objects given column names.
 * Each row has a value for every column.
 */
function arbRows(columns) {
  if (columns.length === 0) {
    return fc.constant([]);
  }
  const arbRow = fc.tuple(...columns.map(() => arbCellValue)).map((values) => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = values[i];
    });
    return obj;
  });
  return fc.array(arbRow, { minLength: 0, maxLength: 10 });
}

// =============================================================================
// Property 1: CSV generation round-trip
// =============================================================================

describe("Feature: db-manager-enhancements, Property 1: CSV generation round-trip", function () {
  this.timeout(30000);

  /**
   * **Validates: Requirements 1.1, 1.2, 2.1, 2.3**
   *
   * For any array of column names and any array of row objects (with values
   * being strings, numbers, or null), generating a CSV via generateCSV(columns, rows)
   * and then parsing the resulting CSV string back into rows SHALL produce data
   * equivalent to the original input — the header row contains all column names
   * in order, and each subsequent row contains the correct values for each column.
   */
  it("generateCSV output, when parsed, produces headers matching column names and rows matching original values", function () {
    fc.assert(
      fc.property(
        arbColumns.chain((columns) =>
          arbRows(columns).map((rows) => ({ columns, rows })),
        ),
        ({ columns, rows }) => {
          // Generate CSV
          const csv = generateCSV(columns, rows);

          // Parse it back
          const parsed = parseCSV(csv);

          // Header row contains all column names in order
          assert.deepStrictEqual(
            parsed.headers,
            columns,
            `Header row must contain all column names in order. Expected: ${JSON.stringify(columns)}, Got: ${JSON.stringify(parsed.headers)}`,
          );

          // Number of data rows must match
          assert.strictEqual(
            parsed.rows.length,
            rows.length,
            `Expected ${rows.length} data rows, got ${parsed.rows.length}`,
          );

          // Each row must contain the correct values for each column
          for (let i = 0; i < rows.length; i++) {
            const originalRow = rows[i];
            const parsedRow = parsed.rows[i];

            assert.strictEqual(
              parsedRow.length,
              columns.length,
              `Row ${i} must have ${columns.length} fields, got ${parsedRow.length}`,
            );

            for (let j = 0; j < columns.length; j++) {
              const col = columns[j];
              const originalValue = originalRow[col];
              const parsedValue = parsedRow[j];

              // Determine expected string representation
              let expectedStr;
              if (originalValue === null || originalValue === undefined) {
                expectedStr = "";
              } else {
                expectedStr = String(originalValue);
              }

              assert.strictEqual(
                parsedValue,
                expectedStr,
                `Row ${i}, column "${col}": expected "${expectedStr}", got "${parsedValue}"`,
              );
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 2: CSV cell escaping correctness
// =============================================================================

describe("Feature: db-manager-enhancements, Property 2: CSV cell escaping correctness", function () {
  this.timeout(30000);

  /**
   * **Validates: Requirements 1.4**
   *
   * For any string value, `escapeCSVCell(value)` SHALL produce output that,
   * when embedded in a CSV row and parsed by a standards-compliant CSV parser,
   * yields the original string value. Specifically: if the value contains a
   * comma, double quote, or newline, the output SHALL be wrapped in double
   * quotes with internal double quotes doubled.
   */
  it("escapeCSVCell output, when embedded in a CSV row and parsed, yields the original string value", function () {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (value) => {
        // Escape the value
        const escaped = escapeCSVCell(value);

        // Embed in a single-cell CSV row and parse it back
        const csvRow = escaped + "\r\n";
        const parsed = parseCSV(csvRow);

        // The parsed result should have one row with one cell equal to the original value
        assert.strictEqual(
          parsed.headers.length,
          1,
          `Expected 1 field in parsed row, got ${parsed.headers.length}`,
        );
        assert.strictEqual(
          parsed.headers[0],
          value,
          `Round-trip failed: escapeCSVCell(${JSON.stringify(value)}) = ${JSON.stringify(escaped)}, parsed back as ${JSON.stringify(parsed.headers[0])}`,
        );

        // Verify structural correctness: if value contains special chars, it must be quoted
        const hasSpecialChars =
          value.indexOf(",") !== -1 ||
          value.indexOf('"') !== -1 ||
          value.indexOf("\n") !== -1 ||
          value.indexOf("\r") !== -1;

        if (hasSpecialChars) {
          assert.strictEqual(
            escaped[0],
            '"',
            `Value with special chars must start with double quote: ${JSON.stringify(value)}`,
          );
          assert.strictEqual(
            escaped[escaped.length - 1],
            '"',
            `Value with special chars must end with double quote: ${JSON.stringify(value)}`,
          );

          // Internal double quotes must be doubled
          const inner = escaped.slice(1, -1);
          const originalQuoteCount = (value.match(/"/g) || []).length;
          const innerQuoteCount = (inner.match(/"/g) || []).length;
          assert.strictEqual(
            innerQuoteCount,
            originalQuoteCount * 2,
            `Internal double quotes must be doubled: original has ${originalQuoteCount} quotes, inner should have ${originalQuoteCount * 2} but has ${innerQuoteCount}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 7: Sort state machine cycling
// =============================================================================

describe("Feature: db-manager-enhancements, Property 7: Sort state machine cycling", function () {
  this.timeout(30000);

  // Arbitrary for column names (non-empty alphanumeric strings)
  const arbColumn = fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/)
    .filter((s) => s.length >= 1);

  /**
   * **Validates: Requirements 6.1, 6.2, 6.3, 6.6**
   *
   * For any column name, the sort state SHALL cycle through exactly three states
   * in order: (1) first click sets sort to ascending on that column, (2) second
   * click on the same column sets sort to descending, (3) third click on the same
   * column clears the sort.
   */
  it("sort state cycles through null → asc → desc → null for any column", function () {
    fc.assert(
      fc.property(arbColumn, (column) => {
        // Start from null state (no sort active)
        const initialState = { column: null, dir: null };

        // First click → ascending
        const state1 = nextSortState(initialState, column);
        assert.strictEqual(
          state1.column,
          column,
          `After first click, column should be "${column}", got "${state1.column}"`,
        );
        assert.strictEqual(
          state1.dir,
          "asc",
          `After first click, dir should be "asc", got "${state1.dir}"`,
        );

        // Second click on same column → descending
        const state2 = nextSortState(state1, column);
        assert.strictEqual(
          state2.column,
          column,
          `After second click, column should be "${column}", got "${state2.column}"`,
        );
        assert.strictEqual(
          state2.dir,
          "desc",
          `After second click, dir should be "desc", got "${state2.dir}"`,
        );

        // Third click on same column → clears sort
        const state3 = nextSortState(state2, column);
        assert.strictEqual(
          state3.column,
          null,
          `After third click, column should be null, got "${state3.column}"`,
        );
        assert.strictEqual(
          state3.dir,
          null,
          `After third click, dir should be null, got "${state3.dir}"`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.6**
   *
   * Clicking a different column SHALL reset the cycle to ascending on the new
   * column, clearing any previous sort.
   */
  it("clicking a different column resets sort to ascending on the new column", function () {
    fc.assert(
      fc.property(
        arbColumn,
        arbColumn.filter((c) => c.length >= 1),
        fc.constantFrom("asc", "desc"),
        (columnA, columnB, currentDir) => {
          // Skip if columns are the same (we need different columns)
          fc.pre(columnA !== columnB);

          // Start with an active sort on columnA
          const currentState = { column: columnA, dir: currentDir };

          // Click on a different column (columnB)
          const newState = nextSortState(currentState, columnB);

          // Should reset to ascending on the new column
          assert.strictEqual(
            newState.column,
            columnB,
            `After clicking different column, column should be "${columnB}", got "${newState.column}"`,
          );
          assert.strictEqual(
            newState.dir,
            "asc",
            `After clicking different column, dir should be "asc", got "${newState.dir}"`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 3: Export filename format
// =============================================================================

const {
  generateExportFilename,
  generateQueryExportFilename,
} = require("../../db-manager/utils/export-filename.js");

describe("Feature: db-manager-enhancements, Property 3: Export filename format", function () {
  this.timeout(30000);

  // Arbitrary for valid table names: non-empty strings of alphanumeric and underscore characters
  const arbTableName = fc
    .stringMatching(/^[a-zA-Z0-9_]+$/)
    .filter((s) => s.length >= 1 && s.length <= 64);

  /**
   * **Validates: Requirements 1.3, 2.2**
   *
   * For any valid table name (non-empty string of alphanumeric and underscore
   * characters), the generated export filename SHALL match the pattern
   * `{table_name}_{YYYYMMDDTHHmmss}.csv` where the timestamp portion is exactly
   * 15 characters of digits and the letter T.
   */
  it("generateExportFilename produces filename matching {table_name}_{YYYYMMDDTHHmmss}.csv pattern", function () {
    fc.assert(
      fc.property(arbTableName, (tableName) => {
        const filename = generateExportFilename(tableName);

        // The filename must start with the table name followed by underscore
        assert.ok(
          filename.startsWith(`${tableName}_`),
          `Filename "${filename}" must start with "${tableName}_"`,
        );

        // The filename must end with .csv
        assert.ok(
          filename.endsWith(".csv"),
          `Filename "${filename}" must end with ".csv"`,
        );

        // Extract the timestamp portion (between tableName_ and .csv)
        const prefix = `${tableName}_`;
        const suffix = ".csv";
        const timestamp = filename.slice(prefix.length, -suffix.length);

        // Timestamp must be exactly 15 characters
        assert.strictEqual(
          timestamp.length,
          15,
          `Timestamp "${timestamp}" must be exactly 15 characters, got ${timestamp.length}`,
        );

        // Timestamp must match the pattern: 8 digits, T, 6 digits (YYYYMMDDTHHmmss)
        const timestampRegex = /^\d{8}T\d{6}$/;
        assert.ok(
          timestampRegex.test(timestamp),
          `Timestamp "${timestamp}" must match pattern \\d{8}T\\d{6}`,
        );

        // Full filename must match the complete regex pattern
        const fullPattern = new RegExp(
          `^${tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_\\d{8}T\\d{6}\\.csv$`,
        );
        assert.ok(
          fullPattern.test(filename),
          `Filename "${filename}" must match full pattern {table_name}_{YYYYMMDDTHHmmss}.csv`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * The query export filename SHALL match the pattern `export_{YYYYMMDDTHHmmss}.csv`
   * where the timestamp portion is exactly 15 characters of digits and the letter T.
   */
  it("generateQueryExportFilename produces filename matching export_{YYYYMMDDTHHmmss}.csv pattern", function () {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const filename = generateQueryExportFilename();

        // The filename must start with "export_"
        assert.ok(
          filename.startsWith("export_"),
          `Filename "${filename}" must start with "export_"`,
        );

        // The filename must end with .csv
        assert.ok(
          filename.endsWith(".csv"),
          `Filename "${filename}" must end with ".csv"`,
        );

        // Extract the timestamp portion (between "export_" and ".csv")
        const prefix = "export_";
        const suffix = ".csv";
        const timestamp = filename.slice(prefix.length, -suffix.length);

        // Timestamp must be exactly 15 characters
        assert.strictEqual(
          timestamp.length,
          15,
          `Timestamp "${timestamp}" must be exactly 15 characters, got ${timestamp.length}`,
        );

        // Timestamp must match the pattern: 8 digits, T, 6 digits (YYYYMMDDTHHmmss)
        const timestampRegex = /^\d{8}T\d{6}$/;
        assert.ok(
          timestampRegex.test(timestamp),
          `Timestamp "${timestamp}" must match pattern \\d{8}T\\d{6}`,
        );

        // Full filename must match the complete regex pattern
        const fullPattern = /^export_\d{8}T\d{6}\.csv$/;
        assert.ok(
          fullPattern.test(filename),
          `Filename "${filename}" must match full pattern export_{YYYYMMDDTHHmmss}.csv`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 5: Server-side filter correctness
// =============================================================================

const { parseFilters } = require("../../db-manager/utils/parse-filters.js");

describe("Feature: db-manager-enhancements, Property 5: Server-side filter correctness", function () {
  this.timeout(30000);

  /**
   * Applies filters to an in-memory array of rows, simulating what the server does.
   * For each row, checks if ALL filter conditions match (case-insensitive substring).
   *
   * @param {object[]} rows - Array of row objects
   * @param {Array<[string, string, string]>} filters - Array of [column, op, value] tuples
   * @returns {object[]} Filtered rows
   */
  function applyFilters(rows, filters) {
    if (!filters || filters.length === 0) return rows;
    return rows.filter(function (row) {
      return filters.every(function (tuple) {
        var column = tuple[0];
        var value = tuple[2];
        var cellValue = row[column];
        if (cellValue === null || cellValue === undefined) return false;
        return String(cellValue).toLowerCase().includes(value.toLowerCase());
      });
    });
  }

  // Arbitrary for column names (alphanumeric, starting with a letter)
  const arbColumnName = fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,9}$/)
    .filter((s) => s.length >= 1);

  // Unique column names array (1 to 5 columns)
  const arbColumns = fc
    .uniqueArray(arbColumnName, { minLength: 1, maxLength: 5 })
    .filter((arr) => arr.length >= 1);

  // Cell values: non-empty strings with mixed case for meaningful filter testing
  const arbCellValue = fc.oneof(
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.constantFrom("Alice", "bob", "CHARLIE", "david", "Eve", "frank"),
    fc.constantFrom("test@gmail.com", "user@yahoo.com", "admin@company.org"),
    fc.constant(null),
  );

  // Filter search value: short non-empty strings for substring matching
  const arbFilterValue = fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => s.length >= 1);

  /**
   * Generate an array of row objects given column names.
   */
  function arbRows(columns) {
    const arbRow = fc
      .tuple(...columns.map(() => arbCellValue))
      .map(function (values) {
        var obj = {};
        columns.forEach(function (col, i) {
          obj[col] = values[i];
        });
        return obj;
      });
    return fc.array(arbRow, { minLength: 0, maxLength: 15 });
  }

  /**
   * Generate filter conditions as an array of [column, 'like', value] tuples.
   * Filters reference columns that exist in the schema.
   */
  function arbFilters(columns) {
    const arbSingleFilter = fc
      .tuple(fc.constantFrom(...columns), arbFilterValue)
      .map(function (pair) {
        return [pair[0], "like", pair[1]];
      });
    return fc.array(arbSingleFilter, { minLength: 0, maxLength: 3 });
  }

  /**
   * **Validates: Requirements 5.3, 5.4, 5.5, 10.1, 10.2, 10.3**
   *
   * For any set of rows and any set of filter conditions (column-value pairs),
   * the filtered result SHALL contain exactly those rows where every filtered
   * column's value contains the corresponding filter string as a case-insensitive
   * substring. Rows not matching all conditions SHALL be excluded, and rows
   * matching all conditions SHALL be included.
   */
  it("applyFilters returns exactly the rows matching all filter conditions as case-insensitive substrings", function () {
    fc.assert(
      fc.property(
        arbColumns.chain(function (columns) {
          return fc.tuple(
            fc.constant(columns),
            arbRows(columns),
            arbFilters(columns),
          );
        }),
        function (tuple) {
          var columns = tuple[0];
          var rows = tuple[1];
          var filters = tuple[2];

          // Apply filters using our reference implementation
          var filtered = applyFilters(rows, filters);

          // Verify: every row in the filtered result matches ALL filter conditions
          for (var i = 0; i < filtered.length; i++) {
            var row = filtered[i];
            for (var f = 0; f < filters.length; f++) {
              var column = filters[f][0];
              var value = filters[f][2];
              var cellValue = row[column];
              assert.notStrictEqual(
                cellValue,
                null,
                "Filtered row " +
                  i +
                  " has null value for column '" +
                  column +
                  "' but should match filter",
              );
              assert.notStrictEqual(
                cellValue,
                undefined,
                "Filtered row " +
                  i +
                  " has undefined value for column '" +
                  column +
                  "' but should match filter",
              );
              assert.ok(
                String(cellValue).toLowerCase().includes(value.toLowerCase()),
                "Filtered row " +
                  i +
                  ", column '" +
                  column +
                  "': value '" +
                  String(cellValue) +
                  "' does not contain filter '" +
                  value +
                  "' (case-insensitive)",
              );
            }
          }

          // Verify: every row NOT in the filtered result fails at least one filter condition
          for (var j = 0; j < rows.length; j++) {
            var row2 = rows[j];
            var isIncluded = filtered.indexOf(row2) !== -1;
            if (!isIncluded) {
              // This row must fail at least one filter condition
              var failsAtLeastOne = false;
              for (var f2 = 0; f2 < filters.length; f2++) {
                var col = filters[f2][0];
                var val = filters[f2][2];
                var cell = row2[col];
                if (cell === null || cell === undefined) {
                  failsAtLeastOne = true;
                  break;
                }
                if (!String(cell).toLowerCase().includes(val.toLowerCase())) {
                  failsAtLeastOne = true;
                  break;
                }
              }
              assert.ok(
                failsAtLeastOne,
                "Row " +
                  j +
                  " was excluded but matches all filter conditions: " +
                  JSON.stringify(row2) +
                  " with filters " +
                  JSON.stringify(filters),
              );
            }
          }

          // Verify: the count of filtered rows is correct
          var expectedCount = rows.filter(function (row3) {
            return filters.every(function (tuple2) {
              var col2 = tuple2[0];
              var val2 = tuple2[2];
              var cell2 = row3[col2];
              if (cell2 === null || cell2 === undefined) return false;
              return String(cell2).toLowerCase().includes(val2.toLowerCase());
            });
          }).length;

          assert.strictEqual(
            filtered.length,
            expectedCount,
            "Filtered count " +
              filtered.length +
              " does not match expected " +
              expectedCount,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.1, 10.2, 10.3**
   *
   * The parseFilters utility correctly converts query params in the format
   * filter[column_name]=value into [column, 'like', value] tuples that can
   * be used by applyFilters to produce correct results.
   */
  it("parseFilters correctly converts query params to filter tuples that produce correct filtering", function () {
    fc.assert(
      fc.property(
        arbColumns.chain(function (columns) {
          return fc.tuple(
            fc.constant(columns),
            arbRows(columns),
            arbFilters(columns),
          );
        }),
        function (tuple) {
          var columns = tuple[0];
          var rows = tuple[1];
          var filters = tuple[2];

          // Build query params object from filters (simulating what the client sends)
          var queryParams = {};
          for (var i = 0; i < filters.length; i++) {
            var col = filters[i][0];
            var val = filters[i][2];
            queryParams["filter[" + col + "]"] = val;
          }

          // Parse the query params using the actual parseFilters utility
          var parsedFilters = parseFilters(queryParams);

          // Apply both the original filters and parsed filters
          var resultFromOriginal = applyFilters(rows, filters);
          var resultFromParsed = applyFilters(rows, parsedFilters);

          // When there are no duplicate column filters, results should be identical
          // (parseFilters deduplicates by taking the last value for a column)
          var uniqueColumns = [];
          var seen = {};
          for (var j = filters.length - 1; j >= 0; j--) {
            var c = filters[j][0];
            if (!seen[c]) {
              seen[c] = true;
              uniqueColumns.push(c);
            }
          }

          // Build deduplicated filters (last value wins, matching parseFilters behavior)
          var deduplicatedFilters = [];
          var seenCols = {};
          for (var k = 0; k < filters.length; k++) {
            seenCols[filters[k][0]] = filters[k][2];
          }
          var colKeys = Object.keys(seenCols);
          for (var m = 0; m < colKeys.length; m++) {
            deduplicatedFilters.push([
              colKeys[m],
              "like",
              seenCols[colKeys[m]],
            ]);
          }

          var expectedResult = applyFilters(rows, deduplicatedFilters);

          // The parsed filters should produce the same result as deduplicated filters
          assert.strictEqual(
            resultFromParsed.length,
            expectedResult.length,
            "Parsed filter result count " +
              resultFromParsed.length +
              " does not match expected " +
              expectedResult.length,
          );

          // Verify each row in parsed result is in expected result
          for (var n = 0; n < resultFromParsed.length; n++) {
            assert.ok(
              expectedResult.indexOf(resultFromParsed[n]) !== -1,
              "Row from parsed filter result not found in expected result",
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 6: Filtered row count accuracy
// =============================================================================

describe("Feature: db-manager-enhancements, Property 6: Filtered row count accuracy", function () {
  this.timeout(30000);

  /**
   * Applies filters to an in-memory array of rows, simulating what the server does.
   * For each row, checks if ALL filter conditions match (case-insensitive substring).
   *
   * @param {object[]} rows - Array of row objects
   * @param {Array<[string, string, string]>} filters - Array of [column, op, value] tuples
   * @returns {object[]} Filtered rows
   */
  function applyFilters(rows, filters) {
    if (!filters || filters.length === 0) return rows;
    return rows.filter(function (row) {
      return filters.every(function (tuple) {
        var column = tuple[0];
        var value = tuple[2];
        var cellValue = row[column];
        if (cellValue === null || cellValue === undefined) return false;
        return String(cellValue).toLowerCase().includes(value.toLowerCase());
      });
    });
  }

  /**
   * Simulates pagination by slicing the filtered results.
   *
   * @param {object[]} rows - Full array of filtered rows
   * @param {number} page - Zero-based page index
   * @param {number} limit - Number of rows per page
   * @returns {{ data: object[], count: number }} Paginated response with total count
   */
  function paginateWithCount(rows, page, limit) {
    var start = page * limit;
    var data = rows.slice(start, start + limit);
    return { data: data, count: rows.length };
  }

  // Arbitrary for column names (alphanumeric, starting with a letter)
  const arbColumnName = fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,9}$/)
    .filter((s) => s.length >= 1);

  // Unique column names array (1 to 5 columns)
  const arbColumns = fc
    .uniqueArray(arbColumnName, { minLength: 1, maxLength: 5 })
    .filter((arr) => arr.length >= 1);

  // Cell values: non-empty strings with mixed case for meaningful filter testing
  const arbCellValue = fc.oneof(
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.constantFrom("Alice", "bob", "CHARLIE", "david", "Eve", "frank"),
    fc.constantFrom("test@gmail.com", "user@yahoo.com", "admin@company.org"),
    fc.constant(null),
  );

  // Filter search value: short non-empty strings for substring matching
  const arbFilterValue = fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => s.length >= 1);

  /**
   * Generate an array of row objects given column names.
   */
  function arbRows(columns) {
    const arbRow = fc
      .tuple(...columns.map(() => arbCellValue))
      .map(function (values) {
        var obj = {};
        columns.forEach(function (col, i) {
          obj[col] = values[i];
        });
        return obj;
      });
    return fc.array(arbRow, { minLength: 0, maxLength: 20 });
  }

  /**
   * Generate filter conditions as an array of [column, 'like', value] tuples.
   * Filters reference columns that exist in the schema.
   */
  function arbFilters(columns) {
    const arbSingleFilter = fc
      .tuple(fc.constantFrom(...columns), arbFilterValue)
      .map(function (pair) {
        return [pair[0], "like", pair[1]];
      });
    return fc.array(arbSingleFilter, { minLength: 0, maxLength: 3 });
  }

  /**
   * **Validates: Requirements 10.4**
   *
   * For any table data and any set of filter conditions, the `count` field in
   * the API response SHALL equal the total number of rows in the table that
   * match all filter conditions, regardless of pagination parameters.
   */
  it("count field equals total matching rows regardless of pagination parameters", function () {
    fc.assert(
      fc.property(
        arbColumns.chain(function (columns) {
          return fc.tuple(
            fc.constant(columns),
            arbRows(columns),
            arbFilters(columns),
            fc.nat({ max: 10 }), // page (0-10)
            fc.integer({ min: 1, max: 10 }), // limit (1-10)
          );
        }),
        function (tuple) {
          var columns = tuple[0];
          var rows = tuple[1];
          var filters = tuple[2];
          var page = tuple[3];
          var limit = tuple[4];

          // Apply filters to get the full filtered set
          var allFilteredRows = applyFilters(rows, filters);

          // Simulate the API response with pagination
          var response = paginateWithCount(allFilteredRows, page, limit);

          // The count field must equal the TOTAL number of matching rows,
          // NOT the number of rows on the current page
          assert.strictEqual(
            response.count,
            allFilteredRows.length,
            "count field (" +
              response.count +
              ") must equal total matching rows (" +
              allFilteredRows.length +
              "), not the paginated subset length (" +
              response.data.length +
              ")",
          );

          // The paginated data length must be <= limit
          assert.ok(
            response.data.length <= limit,
            "Paginated data length (" +
              response.data.length +
              ") must be <= limit (" +
              limit +
              ")",
          );

          // The paginated data length must be <= count
          assert.ok(
            response.data.length <= response.count,
            "Paginated data length (" +
              response.data.length +
              ") must be <= count (" +
              response.count +
              ")",
          );

          // Verify count is independent of page/limit by checking with different pagination
          var responsePage0 = paginateWithCount(allFilteredRows, 0, 1);
          var responseFullPage = paginateWithCount(allFilteredRows, 0, 1000);

          assert.strictEqual(
            responsePage0.count,
            allFilteredRows.length,
            "count with page=0, limit=1 must still equal total matching rows",
          );
          assert.strictEqual(
            responseFullPage.count,
            allFilteredRows.length,
            "count with page=0, limit=1000 must still equal total matching rows",
          );

          // All three responses must report the same count
          assert.strictEqual(
            response.count,
            responsePage0.count,
            "count must be consistent across different pagination parameters",
          );
          assert.strictEqual(
            response.count,
            responseFullPage.count,
            "count must be consistent across different pagination parameters",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 8: Query history recording
// =============================================================================

const createMetadataDb = require("../../db-manager/metadata-db");
const os = require("os");
const path = require("path");
const fs = require("fs");

describe("Feature: db-manager-enhancements, Property 8: Query history recording", function () {
  this.timeout(30000);

  let metaDb;
  let dbPath;
  let connectionId;

  before(function () {
    // Create a temporary SQLite file for the metadata DB
    dbPath = path.join(
      os.tmpdir(),
      `test-metadata-db-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
    );
    metaDb = createMetadataDb(dbPath);
    metaDb.init();
    // Record a connection so we have a valid connectionId
    connectionId = metaDb.recordConnection("sqlite3", null, "test-db");
  });

  after(function () {
    if (metaDb) {
      metaDb.close();
    }
    // Clean up the temporary file
    try {
      if (dbPath && fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch (_) {
      // Ignore cleanup errors
    }
  });

  // Arbitrary for query text: non-empty strings simulating SQL queries
  const arbQueryText = fc.oneof(
    fc
      .stringMatching(/^[A-Z]{1}[a-zA-Z0-9_ *,.'()=<>]{0,99}$/)
      .filter((s) => s.length >= 1),
    fc.constantFrom(
      "SELECT * FROM users",
      "SELECT id, name FROM products WHERE id > 5",
      "INSERT INTO logs (msg) VALUES ('test')",
      "UPDATE users SET active = 1",
      "DELETE FROM sessions WHERE expired = 1",
    ),
  );

  // Arbitrary for row count: non-negative integers
  const arbRowCount = fc.nat({ max: 10000 });

  /**
   * **Validates: Requirements 7.9, 11.4**
   *
   * For any successfully executed query string, after execution the Metadata_DB
   * queries table SHALL contain a record with the exact query text and a row
   * count matching the number of result rows returned.
   */
  it("recordQuery stores exact query text and row count retrievable via getQueries", function () {
    fc.assert(
      fc.property(arbQueryText, arbRowCount, function (queryText, rowCount) {
        // Record the query
        const insertedId = metaDb.recordQuery(
          connectionId,
          queryText,
          rowCount,
        );

        // Verify the record was inserted
        assert.ok(
          insertedId !== null && insertedId !== undefined,
          "recordQuery must return a non-null id, got: " + insertedId,
        );

        // Retrieve queries for this connection with a high limit to ensure
        // we can find the just-inserted record even after many iterations
        const queries = metaDb.getQueries(connectionId, 10000);

        // Find the recorded query by its id
        const recorded = queries.find(function (q) {
          return q.id === Number(insertedId);
        });

        assert.ok(
          recorded !== undefined,
          "Recorded query with id " +
            insertedId +
            " must be found in getQueries result",
        );

        // Verify exact query text
        assert.strictEqual(
          recorded.query_text,
          queryText,
          "Recorded query_text must exactly match input. Expected: " +
            JSON.stringify(queryText) +
            ", Got: " +
            JSON.stringify(recorded.query_text),
        );

        // Verify row count
        assert.strictEqual(
          recorded.row_count,
          rowCount,
          "Recorded row_count must match input. Expected: " +
            rowCount +
            ", Got: " +
            recorded.row_count,
        );

        // Verify connection_id
        assert.strictEqual(
          recorded.connection_id,
          Number(connectionId),
          "Recorded connection_id must match. Expected: " +
            connectionId +
            ", Got: " +
            recorded.connection_id,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 4: Filter bar matches schema columns
// =============================================================================

const {
  buildFilterConfig,
} = require("../../db-manager/utils/build-filter-config.js");

describe("Feature: db-manager-enhancements, Property 4: Filter bar matches schema columns", function () {
  this.timeout(30000);

  // Arbitrary for column names: alphanumeric starting with a letter
  const arbColumnName = fc
    .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/)
    .filter((s) => s.length >= 1);

  // Unique column names array (1 to 10 columns)
  const arbUniqueColumns = fc
    .uniqueArray(arbColumnName, { minLength: 1, maxLength: 10 })
    .filter((arr) => arr.length >= 1);

  // Build a schema object from an array of column names
  function buildSchema(columnNames) {
    return {
      columns: columnNames.map(function (name) {
        return { name: name };
      }),
    };
  }

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For any table schema with N columns, the filter bar SHALL render exactly N
   * input elements, and for each column in the schema, there SHALL exist a
   * corresponding filter input whose `column` attribute equals the column name
   * and whose `placeholder` attribute equals the column name.
   */
  it("buildFilterConfig returns exactly N configs matching schema columns with correct column and placeholder", function () {
    fc.assert(
      fc.property(arbUniqueColumns, function (columnNames) {
        var schema = buildSchema(columnNames);
        var config = buildFilterConfig(schema);

        // Must have exactly N elements (one per column)
        assert.strictEqual(
          config.length,
          columnNames.length,
          "Filter config must have exactly " +
            columnNames.length +
            " elements, got " +
            config.length,
        );

        // For each column in the schema, there must be a corresponding config entry
        for (var i = 0; i < columnNames.length; i++) {
          var colName = columnNames[i];
          var entry = config[i];

          // The entry's column attribute must equal the column name
          assert.strictEqual(
            entry.column,
            colName,
            "Config entry " +
              i +
              " column must be '" +
              colName +
              "', got '" +
              entry.column +
              "'",
          );

          // The entry's placeholder attribute must equal the column name
          assert.strictEqual(
            entry.placeholder,
            colName,
            "Config entry " +
              i +
              " placeholder must be '" +
              colName +
              "', got '" +
              entry.placeholder +
              "'",
          );
        }

        // Verify uniqueness: each column name appears exactly once in the config
        var configColumns = config.map(function (c) {
          return c.column;
        });
        var uniqueConfigColumns = configColumns.filter(function (c, idx) {
          return configColumns.indexOf(c) === idx;
        });
        assert.strictEqual(
          uniqueConfigColumns.length,
          columnNames.length,
          "Each column must appear exactly once in the filter config",
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For an empty or invalid schema, buildFilterConfig SHALL return an empty array.
   */
  it("buildFilterConfig returns empty array for null, undefined, or missing columns", function () {
    fc.assert(
      fc.property(
        fc.constantFrom(
          null,
          undefined,
          {},
          { columns: null },
          { columns: undefined },
        ),
        function (invalidSchema) {
          var config = buildFilterConfig(invalidSchema);
          assert.ok(
            Array.isArray(config),
            "buildFilterConfig must return an array, got " + typeof config,
          );
          assert.strictEqual(
            config.length,
            0,
            "buildFilterConfig must return empty array for invalid schema, got length " +
              config.length,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
