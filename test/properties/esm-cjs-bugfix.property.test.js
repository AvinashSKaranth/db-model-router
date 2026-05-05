/**
 * Property-Based Tests: ESM/CJS Module Mismatch Bugfix
 *
 * Bug Condition Exploration — Property 1:
 * The five legacy generator functions (generateModelFile, generateIndexFile,
 * generateAppJs, generateMigrateScript, generateAddMigrationScript) should
 * produce ESM syntax (import/export) and NOT CJS syntax (require/module.exports).
 *
 * This test is EXPECTED TO FAIL on unfixed code — failure confirms the bug exists.
 *
 * Uses Mocha + assert + fast-check, matching the existing pattern in
 * test/properties/codegen.property.test.js.
 */

"use strict";

const assert = require("assert");
const fc = require("fast-check");

const {
  generateModelFile,
  generateIndexFile,
} = require("../../src/cli/generate-model");

const {
  generateAppJs,
  generateMigrateScript,
  generateAddMigrationScript,
  SQL_DATABASES,
  NOSQL_DATABASES,
} = require("../../src/cli/init/generators");

// =============================================================================
// Constants
// =============================================================================

const ALL_DATABASES = [...SQL_DATABASES, ...NOSQL_DATABASES];
const FRAMEWORKS = ["express", "ultimate-express"];
const SESSION_TYPES = ["redis", "database", "memory"];
const COLUMN_TYPES = ["string", "integer", "numeric", "boolean", "object"];

// =============================================================================
// Arbitraries
// =============================================================================

/** Random valid JS identifier for table/column names */
const arbIdentifier = fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/);

/** Random column rule (matching the pattern used in model structures) */
const arbColumnRule = fc.oneof(
  fc.constantFrom(...COLUMN_TYPES),
  fc.constantFrom(...COLUMN_TYPES.map((t) => `required|${t}`)),
);

/** Random structure object: { colName: rule, ... } with 1–6 columns */
const arbStructure = fc
  .uniqueArray(arbIdentifier, { minLength: 1, maxLength: 6 })
  .chain((names) =>
    fc
      .array(arbColumnRule, {
        minLength: names.length,
        maxLength: names.length,
      })
      .map((rules) => {
        const structure = {};
        for (let i = 0; i < names.length; i++) {
          structure[names[i]] = rules[i];
        }
        return structure;
      }),
  );

/** Random option object for model metadata */
const arbOption = fc
  .record({
    useSafeDelete: fc.boolean(),
    useCreatedAt: fc.boolean(),
    useModifiedAt: fc.boolean(),
  })
  .map(({ useSafeDelete, useCreatedAt, useModifiedAt }) => {
    const option = {
      safeDelete: useSafeDelete ? "is_deleted" : null,
      created_at: useCreatedAt ? "created_at" : null,
      modified_at: useModifiedAt ? "updated_at" : null,
    };
    return option;
  });

/**
 * arbModelMeta: random { table, primary_key, unique, structure, option }
 * for generateModelFile()
 */
const arbModelMeta = fc
  .record({
    table: arbIdentifier,
    primary_key: arbIdentifier,
    structure: arbStructure,
    option: arbOption,
  })
  .chain((meta) =>
    fc
      .uniqueArray(arbIdentifier, { minLength: 1, maxLength: 3 })
      .map((uniqueCols) => ({
        ...meta,
        unique: uniqueCols,
      })),
  );

/**
 * arbModelArray: array of 1–5 arbModelMeta for generateIndexFile()
 * Uses unique table names to avoid collisions.
 */
const arbModelArray = fc
  .uniqueArray(arbIdentifier, { minLength: 1, maxLength: 5 })
  .chain((tableNames) =>
    fc
      .tuple(
        ...tableNames.map((table) =>
          fc
            .record({
              primary_key: arbIdentifier,
              structure: arbStructure,
              option: arbOption,
            })
            .chain((meta) =>
              fc
                .uniqueArray(arbIdentifier, { minLength: 1, maxLength: 3 })
                .map((uniqueCols) => ({
                  table,
                  ...meta,
                  unique: uniqueCols,
                })),
            ),
        ),
      )
      .map((models) => models),
  );

/**
 * arbInitAnswers: random { database, framework, session, helmet, rateLimiting, logger }
 * for generateAppJs(), generateMigrateScript(), generateAddMigrationScript()
 */
const arbInitAnswers = fc.record({
  database: fc.constantFrom(...ALL_DATABASES),
  framework: fc.constantFrom(...FRAMEWORKS),
  session: fc.constantFrom(...SESSION_TYPES),
  helmet: fc.boolean(),
  rateLimiting: fc.boolean(),
  logger: fc.boolean(),
});

// =============================================================================
// Property 1: Bug Condition — CJS Syntax in Five Generator Functions
// =============================================================================

describe("Bugfix: esm-cjs-module-mismatch, Property 1: Bug Condition — CJS Syntax in Five Generator Functions", function () {
  this.timeout(30000);

  /**
   * **Validates: Requirements 1.1**
   *
   * generateModelFile(m) output does NOT contain `require(` or `module.exports`,
   * and DOES contain `import ` and `export default`.
   */
  it("generateModelFile() produces ESM syntax, not CJS", function () {
    fc.assert(
      fc.property(arbModelMeta, (m) => {
        const output = generateModelFile(m);

        assert.ok(
          !output.includes("require("),
          `generateModelFile() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateModelFile() output contains "module.exports" — CJS detected:\n${output}`,
        );
        assert.ok(
          output.includes("import "),
          `generateModelFile() output missing "import " — expected ESM import:\n${output}`,
        );
        assert.ok(
          output.includes("export default"),
          `generateModelFile() output missing "export default" — expected ESM export:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * generateIndexFile(models) output does NOT contain `require(` or `module.exports`,
   * and DOES contain `import ` and `export `.
   */
  it("generateIndexFile() produces ESM syntax, not CJS", function () {
    fc.assert(
      fc.property(arbModelArray, (models) => {
        const output = generateIndexFile(models);

        assert.ok(
          !output.includes("require("),
          `generateIndexFile() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateIndexFile() output contains "module.exports" — CJS detected:\n${output}`,
        );
        assert.ok(
          output.includes("import "),
          `generateIndexFile() output missing "import " — expected ESM import:\n${output}`,
        );
        assert.ok(
          output.includes("export "),
          `generateIndexFile() output missing "export " — expected ESM export:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * generateAppJs(answers) output does NOT contain `require(` or `module.exports`,
   * and DOES contain `import ` and `export default`.
   */
  it("generateAppJs() produces ESM syntax, not CJS", function () {
    fc.assert(
      fc.property(arbInitAnswers, (answers) => {
        const output = generateAppJs(answers);

        assert.ok(
          !output.includes("require("),
          `generateAppJs() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateAppJs() output contains "module.exports" — CJS detected:\n${output}`,
        );
        assert.ok(
          output.includes("import "),
          `generateAppJs() output missing "import " — expected ESM import:\n${output}`,
        );
        assert.ok(
          output.includes("export default"),
          `generateAppJs() output missing "export default" — expected ESM export:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * generateMigrateScript(answers) output does NOT contain `require(` or `module.exports`,
   * and DOES contain `import ` (for both SQL and NoSQL paths).
   */
  it("generateMigrateScript() produces ESM syntax, not CJS", function () {
    fc.assert(
      fc.property(arbInitAnswers, (answers) => {
        const output = generateMigrateScript(answers);

        assert.ok(
          !output.includes("require("),
          `generateMigrateScript() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateMigrateScript() output contains "module.exports" — CJS detected:\n${output}`,
        );
        assert.ok(
          output.includes("import "),
          `generateMigrateScript() output missing "import " — expected ESM import:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * generateAddMigrationScript(answers) output does NOT contain `require(` or `module.exports`,
   * and DOES contain `import ` (for both SQL and NoSQL paths).
   * For NoSQL, the embedded template must use `export async function` instead of `module.exports`.
   */
  it("generateAddMigrationScript() produces ESM syntax, not CJS", function () {
    fc.assert(
      fc.property(arbInitAnswers, (answers) => {
        const output = generateAddMigrationScript(answers);

        assert.ok(
          !output.includes("require("),
          `generateAddMigrationScript() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateAddMigrationScript() output contains "module.exports" — CJS detected:\n${output}`,
        );
        assert.ok(
          output.includes("import "),
          `generateAddMigrationScript() output missing "import " — expected ESM import:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Additional imports for Preservation tests
// =============================================================================

const {
  generateRouteFile,
  generateChildRouteFile,
  generateRoutesIndexFile,
  generateTestFile,
  generateChildTestFile,
  safeVarName,
} = require("../../src/cli/generate-route");

const {
  generateLoggerMiddleware,
  generateDbModule,
  generateAppJsV2,
  generateMigrateModule,
  generateAddMigrationModule,
  generateSessionJs,
  generateSecurityJs,
} = require("../../src/cli/init/generators");

// =============================================================================
// Additional Arbitraries for Preservation tests
// =============================================================================

/** Random relative path for models directory (e.g. "../models") */
const arbModelsRelPath = fc.constantFrom(
  "../models",
  "../../models",
  "./models",
  "../src/models",
);

/** Random foreign key column name */
const arbFkColumn = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,8}$/)
  .map((name) => name + "_id");

/** Random primary key name */
const arbPk = fc.constantFrom("id", "uid", "pk", "record_id");

/**
 * Random relationships array for generateRoutesIndexFile.
 * Given a list of table names, generates 0–2 parent-child relationships.
 */
function arbRelationships(tableNames) {
  if (tableNames.length < 2) return fc.constant([]);
  return fc
    .array(
      fc.record({
        parentIdx: fc.nat({ max: tableNames.length - 1 }),
        childIdx: fc.nat({ max: tableNames.length - 1 }),
        foreignKey: arbFkColumn,
      }),
      { minLength: 0, maxLength: 2 },
    )
    .map((rels) => {
      const seen = new Set();
      const result = [];
      for (const r of rels) {
        if (r.parentIdx === r.childIdx) continue;
        const parent = tableNames[r.parentIdx];
        const child = tableNames[r.childIdx];
        const key = `${child}_of_${parent}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ parent, child, foreignKey: r.foreignKey });
      }
      return result;
    });
}

/** Random optional outputDir for V2 generators */
const arbOutputDir = fc.constantFrom(undefined, "backend", "src");

// =============================================================================
// Property 2: Preservation — Existing ESM Generators Unchanged
// =============================================================================

describe("Bugfix: esm-cjs-module-mismatch, Property 2: Preservation — Existing ESM Generators Unchanged", function () {
  this.timeout(30000);

  // ---------------------------------------------------------------------------
  // Route generators (src/cli/generate-route.js)
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 3.1**
   *
   * generateRouteFile() produces valid ESM syntax and no CJS contamination.
   */
  it("generateRouteFile() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(
        arbIdentifier,
        arbModelsRelPath,
        (tableName, modelsRelPath) => {
          const output = generateRouteFile(tableName, modelsRelPath);

          assert.ok(
            output.includes("import ") || output.includes("export "),
            `generateRouteFile() output missing ESM syntax:\n${output}`,
          );
          assert.ok(
            !output.includes("require("),
            `generateRouteFile() output contains "require(" — CJS detected:\n${output}`,
          );
          assert.ok(
            !output.includes("module.exports"),
            `generateRouteFile() output contains "module.exports" — CJS detected:\n${output}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * generateChildRouteFile() produces valid ESM syntax and no CJS contamination.
   */
  it("generateChildRouteFile() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(
        arbIdentifier,
        arbIdentifier,
        arbFkColumn,
        arbModelsRelPath,
        (childTable, parentTable, fkColumn, modelsRelPath) => {
          const output = generateChildRouteFile(
            childTable,
            parentTable,
            fkColumn,
            modelsRelPath,
          );

          assert.ok(
            output.includes("import ") || output.includes("export "),
            `generateChildRouteFile() output missing ESM syntax:\n${output}`,
          );
          assert.ok(
            !output.includes("require("),
            `generateChildRouteFile() output contains "require(" — CJS detected:\n${output}`,
          );
          assert.ok(
            !output.includes("module.exports"),
            `generateChildRouteFile() output contains "module.exports" — CJS detected:\n${output}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * generateRoutesIndexFile() produces valid ESM syntax and no CJS contamination.
   */
  it("generateRoutesIndexFile() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbIdentifier, { minLength: 1, maxLength: 5 }),
        (tableNames) => {
          // Test with no relationships first (simple case)
          const output = generateRoutesIndexFile(tableNames);

          assert.ok(
            output.includes("import ") || output.includes("export "),
            `generateRoutesIndexFile() output missing ESM syntax:\n${output}`,
          );
          assert.ok(
            !output.includes("require("),
            `generateRoutesIndexFile() output contains "require(" — CJS detected:\n${output}`,
          );
          assert.ok(
            !output.includes("module.exports"),
            `generateRoutesIndexFile() output contains "module.exports" — CJS detected:\n${output}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.3 (with relationships)**
   *
   * generateRoutesIndexFile() with relationships produces valid ESM syntax.
   */
  it("generateRoutesIndexFile() with relationships produces valid ESM syntax", function () {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(arbIdentifier, { minLength: 2, maxLength: 5 })
          .chain((tableNames) =>
            arbRelationships(tableNames).map((rels) => ({
              tableNames,
              relationships: rels,
            })),
          ),
        ({ tableNames, relationships }) => {
          const output = generateRoutesIndexFile(tableNames, relationships);

          assert.ok(
            output.includes("import ") || output.includes("export "),
            `generateRoutesIndexFile() output missing ESM syntax:\n${output}`,
          );
          assert.ok(
            !output.includes("require("),
            `generateRoutesIndexFile() output contains "require(" — CJS detected:\n${output}`,
          );
          assert.ok(
            !output.includes("module.exports"),
            `generateRoutesIndexFile() output contains "module.exports" — CJS detected:\n${output}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * generateTestFile() produces valid ESM syntax and no CJS contamination.
   */
  it("generateTestFile() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbIdentifier, arbPk, (tableName, pk) => {
        const output = generateTestFile(tableName, pk);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateTestFile() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateTestFile() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateTestFile() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * generateChildTestFile() produces valid ESM syntax and no CJS contamination.
   */
  it("generateChildTestFile() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(
        arbIdentifier,
        arbIdentifier,
        arbFkColumn,
        arbPk,
        (childTable, parentTable, fkColumn, pk) => {
          const output = generateChildTestFile(
            childTable,
            parentTable,
            fkColumn,
            pk,
          );

          assert.ok(
            output.includes("import ") || output.includes("export "),
            `generateChildTestFile() output missing ESM syntax:\n${output}`,
          );
          assert.ok(
            !output.includes("require("),
            `generateChildTestFile() output contains "require(" — CJS detected:\n${output}`,
          );
          assert.ok(
            !output.includes("module.exports"),
            `generateChildTestFile() output contains "module.exports" — CJS detected:\n${output}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // V2/ESM generators (src/cli/init/generators.js)
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 3.6**
   *
   * generateLoggerMiddleware() produces valid ESM syntax and no CJS contamination.
   */
  it("generateLoggerMiddleware() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbInitAnswers, (answers) => {
        const output = generateLoggerMiddleware(answers);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateLoggerMiddleware() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateLoggerMiddleware() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateLoggerMiddleware() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.7**
   *
   * generateDbModule() produces valid ESM syntax and no CJS contamination.
   */
  it("generateDbModule() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbInitAnswers, (answers) => {
        const output = generateDbModule(answers);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateDbModule() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateDbModule() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateDbModule() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.8**
   *
   * generateAppJsV2() produces valid ESM syntax and no CJS contamination.
   */
  it("generateAppJsV2() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbInitAnswers, arbOutputDir, (answers, outputDir) => {
        const output = generateAppJsV2(answers, outputDir);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateAppJsV2() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateAppJsV2() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateAppJsV2() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.9**
   *
   * generateMigrateModule() produces valid ESM syntax and no CJS contamination.
   */
  it("generateMigrateModule() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbInitAnswers, arbOutputDir, (answers, outputDir) => {
        const output = generateMigrateModule(answers, outputDir);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateMigrateModule() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateMigrateModule() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateMigrateModule() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.10**
   *
   * generateAddMigrationModule() produces valid ESM syntax and no CJS contamination.
   */
  it("generateAddMigrationModule() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbInitAnswers, arbOutputDir, (answers, outputDir) => {
        const output = generateAddMigrationModule(answers, outputDir);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateAddMigrationModule() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateAddMigrationModule() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateAddMigrationModule() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.11**
   *
   * generateSessionJs() produces valid ESM syntax and no CJS contamination.
   */
  it("generateSessionJs() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbInitAnswers, (answers) => {
        const output = generateSessionJs(answers);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateSessionJs() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateSessionJs() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateSessionJs() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.12**
   *
   * generateSecurityJs() produces valid ESM syntax and no CJS contamination.
   */
  it("generateSecurityJs() produces valid ESM syntax", function () {
    fc.assert(
      fc.property(arbInitAnswers, (answers) => {
        const output = generateSecurityJs(answers);

        assert.ok(
          output.includes("import ") || output.includes("export "),
          `generateSecurityJs() output missing ESM syntax:\n${output}`,
        );
        assert.ok(
          !output.includes("require("),
          `generateSecurityJs() output contains "require(" — CJS detected:\n${output}`,
        );
        assert.ok(
          !output.includes("module.exports"),
          `generateSecurityJs() output contains "module.exports" — CJS detected:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 3: Preservation — Model File Semantic Content
// =============================================================================

describe("Bugfix: esm-cjs-module-mismatch, Property 3: Preservation — Model File Semantic Content", function () {
  this.timeout(30000);

  /**
   * **Validates: Requirements 3.13**
   *
   * generateModelFile() output contains the table name, stringified structure JSON,
   * primary key, and unique array regardless of module syntax.
   */
  it("generateModelFile() preserves table name, structure, primary key, and unique array", function () {
    fc.assert(
      fc.property(arbModelMeta, (m) => {
        const output = generateModelFile(m);

        // Table name appears in the model() call as a string
        assert.ok(
          output.includes(`"${m.table}"`),
          `generateModelFile() output missing table name "${m.table}":\n${output}`,
        );

        // Structure JSON is embedded in the output
        const structStr = JSON.stringify(m.structure, null, 4);
        assert.ok(
          output.includes(structStr),
          `generateModelFile() output missing structure JSON:\n${output}`,
        );

        // Primary key appears as a string
        assert.ok(
          output.includes(`"${m.primary_key}"`),
          `generateModelFile() output missing primary key "${m.primary_key}":\n${output}`,
        );

        // Unique array appears as JSON
        const uniqueStr = JSON.stringify(m.unique);
        assert.ok(
          output.includes(uniqueStr),
          `generateModelFile() output missing unique array ${uniqueStr}:\n${output}`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Property 4: Preservation — Index File Re-exports All Models
// =============================================================================

describe("Bugfix: esm-cjs-module-mismatch, Property 4: Preservation — Index File Re-exports All Models", function () {
  this.timeout(30000);

  /**
   * **Validates: Requirements 3.14**
   *
   * generateIndexFile() output imports every model file and re-exports all of them.
   * Every table name appears in both an import and an export statement.
   */
  it("generateIndexFile() imports and exports every model", function () {
    fc.assert(
      fc.property(arbModelArray, (models) => {
        const output = generateIndexFile(models);

        for (const m of models) {
          const varName = safeVarName(m.table);

          // Each model has an import referencing the table name
          const hasImport =
            output.includes(`require("./${m.table}")`) ||
            output.includes(`from "./${m.table}.js"`) ||
            output.includes(`from "./${m.table}"`);
          assert.ok(
            hasImport,
            `generateIndexFile() output missing import for table "${m.table}":\n${output}`,
          );

          // Each model variable appears in an export
          const hasExport =
            output.includes(`${varName},`) ||
            output.includes(`${varName} }`) ||
            output.includes(`${varName}}`);
          assert.ok(
            hasExport,
            `generateIndexFile() output missing export for variable "${varName}":\n${output}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
