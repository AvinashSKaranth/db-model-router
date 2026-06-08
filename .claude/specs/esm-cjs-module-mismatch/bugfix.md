# Bugfix Requirements Document

## Introduction

Generated model files use CommonJS syntax (`require()` / `module.exports`) while the generated project uses ESM (`import` / `export`). Since the init process sets `"type": "module"` in the generated `package.json`, Node.js treats all `.js` files as ESM modules. When an ESM route file tries to `import` from a CJS model file, it fails with `SyntaxError: The requested module does not provide an export named 'default'`. Additionally, the legacy generators `generateAppJs()`, `generateMigrateScript()`, and `generateAddMigrationScript()` still produce CJS output, creating the same incompatibility if they are used.

**Error:**

```
SyntaxError: The requested module '../models/addresses.js' does not provide an export named 'default'
```

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `generateModelFile()` in `src/cli/generate-model.js` generates a model file THEN the system produces CommonJS syntax (`const { db, model } = require("db-model-router")` and `module.exports = varName`) which is incompatible with the ESM project context

1.2 WHEN `generateIndexFile()` in `src/cli/generate-model.js` generates a models index file THEN the system produces CommonJS syntax (`const varName = require("./table")` and `module.exports = { ... }`) which is incompatible with the ESM project context

1.3 WHEN `generateAppJs()` in `src/cli/init/generators.js` generates an app.js file THEN the system produces CommonJS syntax (`const express = require(...)` and `module.exports = app`) which is incompatible with the ESM project context

1.4 WHEN `generateMigrateScript()` in `src/cli/init/generators.js` generates a migrate.js file THEN the system produces CommonJS syntax (`const fs = require("fs")`, `require("dotenv").config()`, `const { init, db } = require("db-model-router")`) which is incompatible with the ESM project context

1.5 WHEN `generateAddMigrationScript()` in `src/cli/init/generators.js` generates an add_migration.js file THEN the system produces CommonJS syntax (`const fs = require("fs")`) which is incompatible with the ESM project context

1.6 WHEN an ESM route file (e.g., `routes/addresses.js`) imports a CJS model file using `import addresses from "../models/addresses.js"` THEN the system throws a SyntaxError because the CJS model file does not provide a named `default` export

### Expected Behavior (Correct)

2.1 WHEN `generateModelFile()` in `src/cli/generate-model.js` generates a model file THEN the system SHALL produce ESM syntax using `import { db, model } from "db-model-router"` and `export default varName`

2.2 WHEN `generateIndexFile()` in `src/cli/generate-model.js` generates a models index file THEN the system SHALL produce ESM syntax using `import varName from "./table.js"` and `export { ... }` with a default export

2.3 WHEN `generateAppJs()` in `src/cli/init/generators.js` generates an app.js file THEN the system SHALL produce ESM syntax using `import` statements and `export default app`

2.4 WHEN `generateMigrateScript()` in `src/cli/init/generators.js` generates a migrate.js file THEN the system SHALL produce ESM syntax using `import` statements and ESM-compatible patterns

2.5 WHEN `generateAddMigrationScript()` in `src/cli/init/generators.js` generates an add_migration.js file THEN the system SHALL produce ESM syntax using `import` statements and ESM-compatible patterns

2.6 WHEN an ESM route file imports a generated model file THEN the system SHALL successfully resolve the import because the model file uses `export default`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `generateRouteFile()` in `src/cli/generate-route.js` generates a route file THEN the system SHALL CONTINUE TO produce valid ESM syntax with `import`/`export default`

3.2 WHEN `generateChildRouteFile()` in `src/cli/generate-route.js` generates a child route file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.3 WHEN `generateRoutesIndexFile()` in `src/cli/generate-route.js` generates a routes index file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.4 WHEN `generateTestFile()` in `src/cli/generate-route.js` generates a test file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.5 WHEN `generateChildTestFile()` in `src/cli/generate-route.js` generates a child test file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.6 WHEN `generateLoggerMiddleware()` in `src/cli/init/generators.js` generates a logger middleware file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.7 WHEN `generateDbModule()` in `src/cli/init/generators.js` generates a db.js file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.8 WHEN `generateAppJsV2()` in `src/cli/init/generators.js` generates an app.js file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.9 WHEN `generateMigrateModule()` in `src/cli/init/generators.js` generates a migrate module THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.10 WHEN `generateAddMigrationModule()` in `src/cli/init/generators.js` generates an add_migration module THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.11 WHEN `generateSessionJs()` in `src/cli/init/generators.js` generates a session.js file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.12 WHEN `generateSecurityJs()` in `src/cli/init/generators.js` generates a security.js file THEN the system SHALL CONTINUE TO produce valid ESM syntax

3.13 WHEN `generateModelFile()` generates a model file THEN the system SHALL CONTINUE TO correctly include the table name, structure, primary key, unique columns, and option parameters in the model definition

3.14 WHEN `generateIndexFile()` generates a models index file THEN the system SHALL CONTINUE TO import all model files and re-export them as a single module
