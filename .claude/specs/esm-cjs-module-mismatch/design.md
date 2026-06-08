# ESM/CJS Module Mismatch Bugfix Design

## Overview

Five code-generation functions produce CommonJS output (`require()` / `module.exports`) while the generated project is configured as ESM (`"type": "module"` in `package.json`). Node.js treats all `.js` files in such projects as ES modules, so when an ESM route file tries to `import` from a CJS model file, it throws a `SyntaxError`. The fix converts the output of these five functions from CJS to ESM syntax, matching the pattern already used by the other generators in the same codebase.

## Glossary

- **Bug_Condition (C)**: The output of a generator function contains CJS syntax (`require()` or `module.exports`) when it should produce ESM syntax
- **Property (P)**: All generator functions that produce project files SHALL output valid ESM syntax (`import` / `export`)
- **Preservation**: The 12+ generator functions that already produce ESM output, plus the semantic content of model files (table name, structure, primary key, unique columns, options), must remain unchanged
- **`generateModelFile()`**: Function in `src/cli/generate-model.js` that produces a single model file from introspected table metadata
- **`generateIndexFile()`**: Function in `src/cli/generate-model.js` that produces a barrel file re-exporting all models
- **`generateAppJs()`**: Function in `src/cli/init/generators.js` that produces the legacy app.js entry point
- **`generateMigrateScript()`**: Function in `src/cli/init/generators.js` that produces the legacy migration runner script
- **`generateAddMigrationScript()`**: Function in `src/cli/init/generators.js` that produces the legacy migration creation script

## Bug Details

### Bug Condition

The bug manifests when any of the five CJS generator functions produce output that is written into a project with `"type": "module"` in `package.json`. Node.js interprets all `.js` files as ESM in such projects, so `require()` and `module.exports` cause a `SyntaxError` at import time.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { functionName: string, output: string }
  OUTPUT: boolean

  RETURN input.functionName IN [
           "generateModelFile",
           "generateIndexFile",
           "generateAppJs",
           "generateMigrateScript",
           "generateAddMigrationScript"
         ]
         AND (
           output CONTAINS "require("
           OR output CONTAINS "module.exports"
         )
END FUNCTION
```

### Examples

- `generateModelFile({ table: "users", ... })` produces `const { db, model } = require("db-model-router")` and `module.exports = users` — should produce `import { db, model } from "db-model-router"` and `export default users`
- `generateIndexFile([{ table: "users" }, { table: "orders" }])` produces `const users = require("./users")` and `module.exports = { users, orders }` — should produce `import users from "./users.js"` and `export { users, orders }` with `export default { users, orders }`
- `generateAppJs({ database: "postgres", ... })` produces `const express = require("express")` and `module.exports = app` — should produce `import express from "express"` and `export default app`
- `generateMigrateScript({ database: "postgres" })` produces `const fs = require("fs")` and `require("dotenv").config()` — should produce `import fs from "fs"` and `import "dotenv/config"`
- `generateAddMigrationScript({ database: "postgres" })` produces `const fs = require("fs")` — should produce `import fs from "fs"`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- All 5 generator functions in `src/cli/generate-route.js` (`generateRouteFile`, `generateChildRouteFile`, `generateRoutesIndexFile`, `generateTestFile`, `generateChildTestFile`) must continue to produce valid ESM syntax
- All 7 ESM generators in `src/cli/init/generators.js` (`generateLoggerMiddleware`, `generateDbModule`, `generateAppJsV2`, `generateMigrateModule`, `generateAddMigrationModule`, `generateSessionJs`, `generateSecurityJs`) must continue to produce valid ESM syntax
- `generateModelFile()` must continue to correctly include the table name, column structure, primary key, unique columns, and option parameters (safeDelete, created_at, modified_at) in the model definition call
- `generateIndexFile()` must continue to import all model files and re-export them as a single module
- `generateAppJs()` must continue to include all middleware setup (session, helmet, rate limiting, logger), database connection, health check, and error handler
- `generateMigrateScript()` must continue to handle both SQL and NoSQL migration patterns, track executed migrations, and compute checksums
- `generateAddMigrationScript()` must continue to generate timestamped migration files with the correct extension (.sql for SQL, .js for NoSQL)

**Scope:**
All inputs that do NOT involve the five buggy generator functions should be completely unaffected by this fix. This includes:

- Route generation functions (already ESM)
- V2 generator functions (already ESM)
- Database introspection functions
- Schema parsing and validation
- All runtime model/route/validator code

## Hypothesized Root Cause

Based on the code analysis, the root cause is straightforward:

1. **Historical CJS patterns**: `generateModelFile()` and `generateIndexFile()` in `src/cli/generate-model.js` were written using CJS syntax (`require` / `module.exports`) before the project adopted ESM as the default for generated projects. They were never updated when `"type": "module"` was added to the generated `package.json`.

2. **Legacy generators not updated**: `generateAppJs()`, `generateMigrateScript()`, and `generateAddMigrationScript()` in `src/cli/init/generators.js` are the "v1" versions of generators that were later replaced by ESM-native "v2" equivalents (`generateAppJsV2`, `generateMigrateModule`, `generateAddMigrationModule`). The v1 functions were kept for backward compatibility but never converted to produce ESM output.

3. **No syntax validation**: There is no automated check that verifies the module syntax of generated output matches the project's module system configuration.

## Correctness Properties

Property 1: Bug Condition - Generator Output Uses ESM Syntax

_For any_ input to the five buggy generator functions (`generateModelFile`, `generateIndexFile`, `generateAppJs`, `generateMigrateScript`, `generateAddMigrationScript`), the fixed function SHALL produce output that uses ESM syntax (`import` / `export`) and does NOT contain CJS syntax (`require(` / `module.exports`).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Existing ESM Generators Unchanged

_For any_ input to the already-correct ESM generator functions (`generateRouteFile`, `generateChildRouteFile`, `generateRoutesIndexFile`, `generateTestFile`, `generateChildTestFile`, `generateLoggerMiddleware`, `generateDbModule`, `generateAppJsV2`, `generateMigrateModule`, `generateAddMigrationModule`, `generateSessionJs`, `generateSecurityJs`), the fixed code SHALL produce exactly the same output as the original code, preserving all existing ESM functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12**

Property 3: Preservation - Model File Semantic Content

_For any_ model metadata input (table name, structure, primary key, unique columns, options), the fixed `generateModelFile()` SHALL produce output that contains the same table name, structure JSON, primary key, unique columns array, and option parameters as the original function, preserving all semantic content while changing only the module syntax.

**Validates: Requirements 3.13**

Property 4: Preservation - Index File Re-exports All Models

_For any_ array of model metadata, the fixed `generateIndexFile()` SHALL produce output that imports every model file and re-exports all of them, preserving the barrel-file behavior while changing only the module syntax.

**Validates: Requirements 3.14**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/cli/generate-model.js`

**Function**: `generateModelFile(m)`

**Specific Changes**:

1. **Replace CJS import**: Change `const { db, model } = require("db-model-router");` to `import { db, model } from "db-model-router";`
2. **Replace CJS export**: Change `module.exports = ${varName};` to `export default ${varName};`

**Function**: `generateIndexFile(models)`

**Specific Changes**:

1. **Replace CJS imports**: Change `const ${varName} = require("./${m.table}");` to `import ${varName} from "./${m.table}.js";`
2. **Replace CJS export**: Change `module.exports = { ... };` to named exports `export { ... };` plus `export default { ... };`

---

**File**: `src/cli/init/generators.js`

**Function**: `generateAppJs(answers)`

**Specific Changes**:

1. **Replace all CJS require() calls**: Convert `const express = require("express")`, `const { init, db } = require("db-model-router")`, `const session = require("express-session")`, etc. to ESM `import` statements
2. **Replace dotenv require**: Change `require("dotenv").config()` to `import "dotenv/config";`
3. **Replace conditional requires**: Convert `const RedisStore = require("connect-redis").default` and `const { Redis } = require("ioredis")` to ESM imports
4. **Replace CJS export**: Change `module.exports = app;` to `export default app;`
5. **Replace logger require**: Change `const logger = require("./middleware/logger");` to `import logger from "./middleware/logger.js";`

**Function**: `generateMigrateScript(answers)`

**Specific Changes**:

1. **Replace CJS requires**: Convert `const fs = require("fs")`, `const path = require("path")`, `const crypto = require("crypto")` to ESM imports
2. **Replace dotenv require**: Change `require("dotenv").config()` to `import "dotenv/config";`
3. **Replace db-model-router require**: Change `const { init, db } = require("db-model-router")` to `import { init, db } from "db-model-router";`
4. **Replace \_\_dirname**: Add `import { fileURLToPath } from "url";` and compute `__dirname` from `import.meta.url`
5. **Replace NoSQL migration require**: Change `const migration = require(filePath)` to `const migration = await import(filePath)`
6. **Remove `"use strict";`**: Not needed in ESM (strict mode is the default)

**Function**: `generateAddMigrationScript(answers)`

**Specific Changes**:

1. **Replace CJS requires**: Convert `const fs = require("fs")`, `const path = require("path")` to ESM imports
2. **Replace \_\_dirname**: Add `import { fileURLToPath } from "url";` and compute `__dirname` from `import.meta.url`
3. **Remove `"use strict";`**: Not needed in ESM
4. **Update NoSQL template**: Change the embedded template from `module.exports = { ... }` to `export async function up(db) { ... }` / `export async function down(db) { ... }`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Call each of the five buggy generator functions with representative inputs and assert that the output does NOT contain CJS syntax. Run these tests on the UNFIXED code to observe failures and confirm the bug.

**Test Cases**:

1. **Model File CJS Test**: Call `generateModelFile()` with sample model metadata, assert output contains no `require(` or `module.exports` (will fail on unfixed code)
2. **Index File CJS Test**: Call `generateIndexFile()` with sample model array, assert output contains no `require(` or `module.exports` (will fail on unfixed code)
3. **App.js CJS Test**: Call `generateAppJs()` with sample answers, assert output contains no `require(` or `module.exports` (will fail on unfixed code)
4. **Migrate Script CJS Test**: Call `generateMigrateScript()` with sample answers for both SQL and NoSQL, assert output contains no `require(` or `module.exports` (will fail on unfixed code)
5. **Add Migration Script CJS Test**: Call `generateAddMigrationScript()` with sample answers for both SQL and NoSQL, assert output contains no `require(` or `module.exports` (will fail on unfixed code)

**Expected Counterexamples**:

- All five functions will produce output containing `require(` and/or `module.exports`
- Root cause confirmed: these functions use CJS template strings that were never converted to ESM

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedGenerator(input)
  ASSERT NOT result CONTAINS "require("
  ASSERT NOT result CONTAINS "module.exports"
  ASSERT result CONTAINS "import " OR result CONTAINS "export "
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalGenerator(input) = fixedGenerator(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain (random table names, structures, answer configurations)
- It catches edge cases that manual unit tests might miss (special characters in table names, empty structures, unusual option combinations)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for the already-correct ESM generators, then write property-based tests capturing that behavior to ensure the fix doesn't regress them.

**Test Cases**:

1. **Route Generator Preservation**: Verify `generateRouteFile()`, `generateChildRouteFile()`, `generateRoutesIndexFile()` continue to produce identical ESM output after the fix
2. **Test Generator Preservation**: Verify `generateTestFile()`, `generateChildTestFile()` continue to produce identical ESM output
3. **V2 Generator Preservation**: Verify `generateAppJsV2()`, `generateDbModule()`, `generateMigrateModule()`, `generateAddMigrationModule()`, `generateSessionJs()`, `generateSecurityJs()`, `generateLoggerMiddleware()` continue to produce identical ESM output
4. **Model Semantic Preservation**: Verify `generateModelFile()` output still contains the correct table name, structure JSON, primary key, unique array, and options regardless of module syntax change

### Unit Tests

- Test each of the five fixed functions with representative inputs and verify ESM syntax
- Test edge cases: tables with special characters, empty structures, models with/without options
- Test `generateAppJs()` with all combinations of session type, helmet, rate limiting
- Test `generateMigrateScript()` and `generateAddMigrationScript()` for both SQL and NoSQL database types

### Property-Based Tests

- Generate random model metadata (table names, structures, primary keys, unique columns, options) and verify `generateModelFile()` always produces valid ESM with correct semantic content
- Generate random model arrays and verify `generateIndexFile()` always produces valid ESM that imports and re-exports all models
- Generate random answer configurations and verify `generateAppJs()`, `generateMigrateScript()`, `generateAddMigrationScript()` always produce valid ESM
- Generate random inputs for already-correct generators and verify output is unchanged (preservation)

### Integration Tests

- Generate a complete project (models + routes + app.js) and verify all files use consistent ESM syntax
- Verify that a generated route file can structurally import a generated model file (both use compatible import/export patterns)
- Verify the generated app.js correctly imports from middleware, session, and other modules using ESM syntax
