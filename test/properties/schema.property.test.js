/**
 * Property-Based Tests: Schema Layer
 *
 * Tests Properties 1–7 from the schema-driven-cli design document.
 * Uses fast-check with Mocha + assert, following the existing pattern
 * from test/properties/filter.property.test.js.
 */

"use strict";

const assert = require("assert");
const fc = require("fast-check");

const { parseSchema } = require("../../src/schema/schema-parser");
const { printSchema } = require("../../src/schema/schema-printer");
const {
  validateSchema,
  SchemaValidationError,
  VALID_ADAPTERS,
  VALID_FRAMEWORKS,
  COLUMN_RULE_RE,
} = require("../../src/schema/schema-validator");

// =============================================================================
// Constants
// =============================================================================

const ADAPTERS = [...VALID_ADAPTERS];
const FRAMEWORKS = [...VALID_FRAMEWORKS];
const COLUMN_TYPES = ["string", "integer", "numeric", "boolean", "object"];

// =============================================================================
// Arbitraries
// =============================================================================

/** Generates a valid SQL-style identifier for table/column names. */
const arbIdentifier = fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/);

/** Generates a valid adapter from the allowed set. */
const arbValidAdapter = fc.constantFrom(...ADAPTERS);

/** Generates a valid framework from the allowed set. */
const arbValidFramework = fc.constantFrom(...FRAMEWORKS);

/** Generates a valid column rule string matching the regex. */
const arbColumnRule = fc.oneof(
  fc.constantFrom(...COLUMN_TYPES),
  fc.constantFrom(...COLUMN_TYPES.map((t) => `required|${t}`)),
);

/**
 * Generates a columns object with 1–6 columns, each with a valid column rule.
 * Returns { columns, columnNames } so callers can reference column names.
 */
const arbColumns = fc
  .uniqueArray(arbIdentifier, { minLength: 1, maxLength: 6 })
  .chain((names) =>
    fc.tuple(
      fc.constant(names),
      fc.array(arbColumnRule, {
        minLength: names.length,
        maxLength: names.length,
      }),
    ),
  )
  .map(([names, rules]) => {
    const columns = {};
    for (let i = 0; i < names.length; i++) {
      columns[names[i]] = rules[i];
    }
    return { columns, columnNames: names };
  });

/**
 * Generates a single valid table definition.
 * Returns { tableDef, columnNames, pk } for downstream use.
 */
const arbTableDef = arbColumns.chain(({ columns, columnNames }) =>
  fc
    .record({
      usePk: fc.boolean(),
      pkName: arbIdentifier,
      useSoftDelete: fc.boolean(),
      useTimestamps: fc.boolean(),
      useUnique: fc.boolean(),
    })
    .map(({ usePk, pkName, useSoftDelete, useTimestamps, useUnique }) => {
      const tableDef = { columns: { ...columns } };
      const pk = usePk ? pkName : undefined;
      if (usePk) {
        tableDef.pk = pkName;
      }
      const effectivePk = pk || "id";

      if (useUnique && columnNames.length > 0) {
        // Pick a subset of column names + possibly the pk
        const candidates = [...columnNames, effectivePk];
        const uniqueSet = [...new Set(candidates)].slice(0, 3);
        tableDef.unique = uniqueSet;
      }

      if (useSoftDelete && columnNames.length > 0) {
        // Pick a column that has boolean type, or just pick the first column
        const boolCols = columnNames.filter(
          (c) => columns[c] === "boolean" || columns[c] === "required|boolean",
        );
        if (boolCols.length > 0) {
          tableDef.softDelete = boolCols[0];
        }
      }

      if (useTimestamps) {
        tableDef.timestamps = {
          created_at: "created_at",
          modified_at: "updated_at",
        };
      }

      return { tableDef, columnNames, pk: effectivePk };
    }),
);

/**
 * Generates a full valid schema object with 1–10 tables, 0–5 relationships,
 * random column rules, and random adapter/framework.
 */
const arbSchema = fc
  .uniqueArray(arbIdentifier, { minLength: 1, maxLength: 10 })
  .chain((tableNames) =>
    fc
      .tuple(
        arbValidAdapter,
        arbValidFramework,
        fc.array(arbTableDef, {
          minLength: tableNames.length,
          maxLength: tableNames.length,
        }),
      )
      .map(([adapter, framework, tableDefs]) => {
        const tables = {};
        const tableNamesList = [];
        for (let i = 0; i < tableNames.length; i++) {
          tables[tableNames[i]] = tableDefs[i].tableDef;
          tableNamesList.push(tableNames[i]);
        }
        return { adapter, framework, tables, tableNamesList };
      }),
  )
  .chain(({ adapter, framework, tables, tableNamesList }) => {
    // Generate 0–5 valid relationships between existing tables
    const maxRels = Math.min(5, tableNamesList.length > 1 ? 5 : 0);
    if (maxRels === 0) {
      return fc.constant({ adapter, framework, tables });
    }
    return fc
      .array(
        fc.record({
          parentIdx: fc.nat({ max: tableNamesList.length - 1 }),
          childIdx: fc.nat({ max: tableNamesList.length - 1 }),
          foreignKey: arbIdentifier,
        }),
        { minLength: 0, maxLength: maxRels },
      )
      .map((rels) => {
        const relationships = rels
          .filter((r) => r.parentIdx !== r.childIdx)
          .map((r) => ({
            parent: tableNamesList[r.parentIdx],
            child: tableNamesList[r.childIdx],
            foreignKey: r.foreignKey,
          }));
        const schema = { adapter, framework, tables };
        if (relationships.length > 0) {
          schema.relationships = relationships;
        }
        return schema;
      });
  });

/**
 * Generates a string that is NOT in the valid adapter set.
 * Filters out any accidentally generated valid adapter.
 */
const arbInvalidAdapter = fc
  .stringMatching(/^[a-z][a-z0-9_]{1,15}$/)
  .filter((s) => !VALID_ADAPTERS.has(s));

/**
 * Generates a string that is NOT in the valid framework set.
 * Filters out any accidentally generated valid framework.
 */
const arbInvalidFramework = fc
  .stringMatching(/^[a-z][a-z0-9_-]{1,20}$/)
  .filter((s) => !VALID_FRAMEWORKS.has(s));

/**
 * Generates a string that does NOT match the column rule regex.
 * Includes random strings that won't pass the pattern.
 */
const arbInvalidColumnRule = fc
  .oneof(
    // Random strings that are unlikely to match
    fc
      .stringMatching(/^[a-z]{1,5}\|[a-z]{1,5}$/)
      .filter((s) => !COLUMN_RULE_RE.test(s)),
    // Strings with invalid types
    fc.constantFrom(
      "required|text",
      "required|float",
      "optional|string",
      "string|required",
      "required|",
      "|string",
      "required|string|extra",
      "REQUIRED|string",
      "int",
      "varchar",
      "text",
      "float",
      "double",
      "required|varchar",
    ),
    // Empty or whitespace
    fc.constantFrom("", " ", "  "),
  )
  .filter((s) => !COLUMN_RULE_RE.test(s));

/** Helper: builds a minimal valid schema with a given adapter. */
function minimalSchemaWith(overrides) {
  return {
    adapter: "postgres",
    framework: "express",
    tables: {
      users: {
        columns: {
          name: "required|string",
          email: "required|string",
        },
      },
    },
    ...overrides,
  };
}

// =============================================================================
// Property 1: Schema Round-Trip Preserves Data
// =============================================================================

describe("Feature: schema-driven-cli, Property 1: Schema Round-Trip Preserves Data", function () {
  /**
   * **Validates: Requirements 2.2, 2.3**
   *
   * For any valid dbmr.schema.json document, parsing it with parseSchema()
   * then printing with printSchema() then parsing again shall produce an
   * internal representation deeply equal to the first parse result.
   */
  it("parseSchema(printSchema(parseSchema(input))) deeply equals parseSchema(input)", function () {
    /**
     * Helper: normalize a parsed schema for comparison.
     * The printer sorts relationships by [parent, child], so we sort both
     * sides before comparing to focus on data preservation, not ordering.
     */
    function normalize(parsed) {
      const copy = JSON.parse(JSON.stringify(parsed));
      if (copy.relationships) {
        copy.relationships.sort((a, b) => {
          const cmp = a.parent.localeCompare(b.parent);
          if (cmp !== 0) return cmp;
          return a.child.localeCompare(b.child);
        });
      }
      return copy;
    }

    fc.assert(
      fc.property(arbSchema, (rawSchema) => {
        const firstParse = parseSchema(rawSchema);
        const printed = printSchema(firstParse);
        const secondParse = parseSchema(printed);

        assert.deepStrictEqual(
          normalize(secondParse),
          normalize(firstParse),
          "Round-trip parse-print-parse should produce identical internal representation",
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 2: Invalid Adapter Rejection
// =============================================================================

describe("Feature: schema-driven-cli, Property 2: Invalid Adapter Rejection", function () {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any string that is not in the valid adapter set, a schema containing
   * that string as the adapter value shall fail validation with an error
   * identifying the invalid adapter.
   */
  it("validation fails with error identifying invalid adapter", function () {
    fc.assert(
      fc.property(arbInvalidAdapter, (badAdapter) => {
        const schema = minimalSchemaWith({ adapter: badAdapter });
        const result = validateSchema(schema);

        assert.strictEqual(
          result.valid,
          false,
          `Should reject adapter "${badAdapter}"`,
        );
        assert.ok(
          result.errors.some(
            (e) => e.path === "adapter" && e.message.includes(badAdapter),
          ),
          `Should have an error at path "adapter" mentioning "${badAdapter}"`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 3: Invalid Framework Rejection
// =============================================================================

describe("Feature: schema-driven-cli, Property 3: Invalid Framework Rejection", function () {
  /**
   * **Validates: Requirements 1.3**
   *
   * For any string that is not in the valid framework set, a schema containing
   * that string as the framework value shall fail validation with an error
   * identifying the invalid framework.
   */
  it("validation fails with error identifying invalid framework", function () {
    fc.assert(
      fc.property(arbInvalidFramework, (badFramework) => {
        const schema = minimalSchemaWith({ framework: badFramework });
        const result = validateSchema(schema);

        assert.strictEqual(
          result.valid,
          false,
          `Should reject framework "${badFramework}"`,
        );
        assert.ok(
          result.errors.some(
            (e) => e.path === "framework" && e.message.includes(badFramework),
          ),
          `Should have an error at path "framework" mentioning "${badFramework}"`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 4: Column Rule Validation
// =============================================================================

describe("Feature: schema-driven-cli, Property 4: Column Rule Validation", function () {
  /**
   * **Validates: Requirements 1.6**
   *
   * For any string that does not match the column rule pattern, using it as
   * a column value in a schema shall fail validation with an error identifying
   * the invalid column rule.
   */
  it("validation fails with error identifying invalid column rule", function () {
    fc.assert(
      fc.property(arbInvalidColumnRule, arbIdentifier, (badRule, colName) => {
        const schema = minimalSchemaWith({
          tables: {
            test_table: {
              columns: {
                [colName]: badRule,
              },
            },
          },
        });
        const result = validateSchema(schema);

        assert.strictEqual(
          result.valid,
          false,
          `Should reject column rule "${badRule}"`,
        );
        assert.ok(
          result.errors.some(
            (e) =>
              e.path.includes("columns") &&
              e.message.includes("Invalid column rule"),
          ),
          `Should have an error at a columns path mentioning invalid column rule for "${badRule}"`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 5: Primary Key Defaults
// =============================================================================

describe("Feature: schema-driven-cli, Property 5: Primary Key Defaults", function () {
  /**
   * **Validates: Requirements 1.4, 1.5**
   *
   * For any table entry in a valid schema, the parsed primary key shall equal
   * the pk field value if present, or "id" if the pk field is omitted.
   */
  it("parsed pk equals pk field if present, or 'id' if omitted", function () {
    fc.assert(
      fc.property(
        arbIdentifier,
        arbColumns,
        fc.option(arbIdentifier, { nil: undefined }),
        (tableName, { columns }, maybePk) => {
          const tableDef = { columns };
          if (maybePk !== undefined) {
            tableDef.pk = maybePk;
          }

          const schema = {
            adapter: "postgres",
            framework: "express",
            tables: { [tableName]: tableDef },
          };

          const parsed = parseSchema(schema);
          const expectedPk = maybePk !== undefined ? maybePk : "id";

          assert.strictEqual(
            parsed.tables[tableName].pk,
            expectedPk,
            `pk should be "${expectedPk}" but got "${parsed.tables[tableName].pk}"`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 6: Relationship Validation
// =============================================================================

describe("Feature: schema-driven-cli, Property 6: Relationship Validation", function () {
  /**
   * **Validates: Requirements 1.7, 1.8**
   *
   * For any schema with a relationships array, entries missing parent, child,
   * or foreignKey fields, or entries referencing table names not present in the
   * tables object, shall fail validation with descriptive errors.
   */
  describe("missing fields", function () {
    it("relationships missing parent fail validation", function () {
      fc.assert(
        fc.property(arbIdentifier, arbIdentifier, (child, fk) => {
          const schema = minimalSchemaWith({
            relationships: [{ child, foreignKey: fk }],
          });
          const result = validateSchema(schema);

          assert.strictEqual(result.valid, false);
          assert.ok(
            result.errors.some(
              (e) => e.path.includes("parent") && e.message.includes("parent"),
            ),
            "Should report missing parent field",
          );
        }),
        { numRuns: 100 },
      );
    });

    it("relationships missing child fail validation", function () {
      fc.assert(
        fc.property(arbIdentifier, arbIdentifier, (parent, fk) => {
          const schema = minimalSchemaWith({
            relationships: [{ parent: "users", foreignKey: fk }],
          });
          // Remove child entirely
          const result = validateSchema(schema);

          assert.strictEqual(result.valid, false);
          assert.ok(
            result.errors.some(
              (e) => e.path.includes("child") && e.message.includes("child"),
            ),
            "Should report missing child field",
          );
        }),
        { numRuns: 100 },
      );
    });

    it("relationships missing foreignKey fail validation", function () {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const schema = minimalSchemaWith({
            relationships: [{ parent: "users", child: "users" }],
          });
          const result = validateSchema(schema);

          assert.strictEqual(result.valid, false);
          assert.ok(
            result.errors.some(
              (e) =>
                e.path.includes("foreignKey") &&
                e.message.includes("foreignKey"),
            ),
            "Should report missing foreignKey field",
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("non-existent table references", function () {
    it("relationships referencing non-existent parent table fail validation", function () {
      fc.assert(
        fc.property(
          arbIdentifier.filter((s) => s !== "users"),
          arbIdentifier,
          (fakeParent, fk) => {
            const schema = minimalSchemaWith({
              relationships: [
                { parent: fakeParent, child: "users", foreignKey: fk },
              ],
            });
            const result = validateSchema(schema);

            assert.strictEqual(result.valid, false);
            assert.ok(
              result.errors.some(
                (e) =>
                  e.path.includes("parent") && e.message.includes(fakeParent),
              ),
              `Should report that parent "${fakeParent}" does not reference an existing table`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("relationships referencing non-existent child table fail validation", function () {
      fc.assert(
        fc.property(
          arbIdentifier.filter((s) => s !== "users"),
          arbIdentifier,
          (fakeChild, fk) => {
            const schema = minimalSchemaWith({
              relationships: [
                { parent: "users", child: fakeChild, foreignKey: fk },
              ],
            });
            const result = validateSchema(schema);

            assert.strictEqual(result.valid, false);
            assert.ok(
              result.errors.some(
                (e) =>
                  e.path.includes("child") && e.message.includes(fakeChild),
              ),
              `Should report that child "${fakeChild}" does not reference an existing table`,
            );
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

// =============================================================================
// Property 7: Unique Constraint Validation
// =============================================================================

describe("Feature: schema-driven-cli, Property 7: Unique Constraint Validation", function () {
  /**
   * **Validates: Requirements 1.9**
   *
   * For any table entry with a unique array, elements that do not match a
   * column name in that table's columns object or the table's primary key
   * shall fail validation.
   */
  it("unique entries not matching column names or pk fail validation", function () {
    fc.assert(
      fc.property(
        arbColumns,
        arbIdentifier,
        ({ columns, columnNames }, bogusUnique) => {
          // Ensure the bogus unique entry doesn't accidentally match a column or the default pk
          const pk = "id";
          fc.pre(!columnNames.includes(bogusUnique) && bogusUnique !== pk);

          const schema = {
            adapter: "postgres",
            framework: "express",
            tables: {
              test_table: {
                columns,
                unique: [bogusUnique],
              },
            },
          };
          const result = validateSchema(schema);

          assert.strictEqual(
            result.valid,
            false,
            `Should reject unique entry "${bogusUnique}" not matching any column or pk`,
          );
          assert.ok(
            result.errors.some(
              (e) =>
                e.path.includes("unique") && e.message.includes(bogusUnique),
            ),
            `Should have an error mentioning "${bogusUnique}" in unique validation`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
