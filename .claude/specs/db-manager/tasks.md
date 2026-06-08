# Implementation Plan: DB Manager

## Overview

Implement the `--db-manager` flag for the `generate` CLI command. This creates a new generator module (`src/cli/generate-db-manager.js`) that produces planned file objects for a dark-themed, EJS-rendered database management UI. The generator integrates into the existing `planned` array pipeline in `src/cli/commands/generate.js`. All generated output uses ES module syntax and relies on `global.db` for database access. The feature targets SQL adapters only.

## Tasks

- [x] 1. Create the DB Manager generator module with core template functions
  - [x] 1.1 Create `src/cli/generate-db-manager.js` with the SQL_ADAPTERS list, the main `generateDbManager(schema, options)` function signature, and the `generateDbManagerAuthMiddleware()` function that returns the auth middleware content string
    - The module MUST use CommonJS (`module.exports`)
    - `generateDbManagerAuthMiddleware()` returns an ES module string that exports a default middleware function checking `req.session["db-manager"] === true`
    - If not authenticated, redirect to `/database/login`
    - Export `SQL_ADAPTERS` array: `["mysql", "mariadb", "postgres", "sqlite3", "mssql", "cockroachdb", "oracle"]`
    - _Requirements: 2.1, 3.5, 8.1_

  - [x] 1.2 Implement `generateLoginTemplate()` in `generate-db-manager.js`
    - Returns an EJS template string for `views/db-manager/login.ejs`
    - Dark theme with inline `<style>` block
    - Single password input field and submit button
    - Displays error message when `locals.error` is set
    - Displays 503 message when `locals.notConfigured` is set
    - Form POSTs to `/database/login`
    - _Requirements: 2.2, 3.2, 3.4, 3.6_

  - [x] 1.3 Implement `generateManagerTemplate()` in `generate-db-manager.js`
    - Returns an EJS template string for `views/db-manager/manager.ejs`
    - Dark theme with inline `<style>` block and inline vanilla JavaScript
    - Left sidebar with table list and text search input for client-side filtering
    - Three tabs: Structure, Data, Query
    - Structure tab: renders column definitions in a table (name, type, nullable, default, pk)
    - Data tab: filter inputs, sort controls, pagination controls, row checkboxes, "Delete Selected" button with confirmation, edit/save/cancel per row, "Add Row" button with form, "Download CSV" button
    - Query tab: SQL textarea, execute button, results table, error display
    - All AJAX calls use `fetch()` to the `/database/*` API endpoints
    - _Requirements: 2.2, 4.1, 4.3, 4.4, 5.1, 5.3, 6.1, 6.7, 7.1, 7.3, 7.4, 10.1, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.6, 12.1, 12.2, 12.3, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 13.7_

  - [x] 1.4 Write unit tests for `generateDbManagerAuthMiddleware()`, `generateLoginTemplate()`, and `generateManagerTemplate()`
    - Create `test/commands/generate-db-manager.test.js`
    - Verify auth middleware string contains session check, redirect logic, and ES module export
    - Verify login template contains password input, form action, error display, dark theme styles
    - Verify manager template contains sidebar, three tabs, fetch calls, CSV download, delete button, edit controls, add row form
    - _Requirements: 2.1, 2.2, 3.2, 3.5_

- [x] 2. Implement the route handler template and remaining generator functions
  - [x] 2.1 Implement `generateDbManagerRoute()` in `generate-db-manager.js`
    - Returns an ES module string for `routes/database.js`
    - Imports the auth middleware from `../middleware/db-manager-auth.js`
    - Imports `express` and uses `express.Router()`
    - Uses `global.db.query()` for all database operations
    - Implements all endpoints from the design: GET `/`, GET/POST `/login`, GET `/tables`, GET `/tables/:table_name` (data + schema mode), GET `/tables/:table_name/csv`, DELETE `/tables/:table_name`, PUT `/tables/:table_name/:id`, POST `/tables/:table_name`, POST `/query`
    - Login POST checks `process.env.DATABASE_MANAGER_PASSWORD`; if not set, responds 503
    - Auth middleware applied to all routes except GET/POST `/login`
    - CSV endpoint sets `Content-Type: text/csv` and `Content-Disposition` header
    - Bulk delete accepts `{ keys: [...] }` body
    - Row update accepts JSON body with column values
    - Row insert accepts JSON body with column values
    - Query endpoint executes raw SQL via `global.db.query()`
    - _Requirements: 3.1, 3.3, 3.4, 3.6, 4.2, 5.2, 6.2, 6.3, 6.4, 6.5, 6.6, 7.2, 7.4, 7.5, 8.3, 10.2, 10.3, 10.7, 11.4, 11.5, 11.7, 11.8, 12.4, 12.5, 12.8, 12.9, 13.5, 13.6, 13.8, 13.9_

  - [x] 2.2 Implement `appendDbManagerEnv(existingEnv)` and `appendDbManagerEnvExample(existingEnvExample)` in `generate-db-manager.js`
    - `appendDbManagerEnv` appends `DATABASE_MANAGER_PASSWORD=admin` to the existing .env content
    - `appendDbManagerEnvExample` appends `DATABASE_MANAGER_PASSWORD=your_db_manager_password` to the existing .env.example content
    - Both add a newline separator and a `# DB Manager` comment before the variable
    - _Requirements: 2.3, 2.4_

  - [x] 2.3 Implement `addEjsDependency(packageJsonStr)` in `generate-db-manager.js`
    - Parses the package.json string, adds `"ejs"` to `dependencies`, returns the modified JSON string
    - _Requirements: 2.5_

  - [x] 2.4 Implement `addDbManagerToAppJs(appJsContent)` in `generate-db-manager.js`
    - Injects `import path from "path"` (if not present), `app.set("view engine", "ejs")`, `app.set("views", path.join(__dirname, "views"))`, import for the database route, and `app.use("/database", dbManagerRoute)` into the existing app.js content string
    - Places EJS config after middleware setup and route mount before the error handler
    - _Requirements: 2.6, 2.7, 9.1, 9.2_

  - [x] 2.5 Write unit tests for `generateDbManagerRoute()`, env functions, `addEjsDependency()`, and `addDbManagerToAppJs()`
    - Verify route handler string contains all endpoint paths, auth middleware import, global.db usage, CSV headers, session check
    - Verify env append functions add the correct variables with comment headers
    - Verify `addEjsDependency` adds ejs to dependencies in parsed JSON
    - Verify `addDbManagerToAppJs` injects view engine config, path import, route import, and route mount
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 9.1, 9.2_

- [x] 3. Wire up the main generateDbManager function and SQL adapter guard
  - [x] 3.1 Implement the main `generateDbManager(schema, options)` function body in `generate-db-manager.js`
    - Check `schema.adapter` against `SQL_ADAPTERS`; if NoSQL, return `{ files: [], warnings: ["DB Manager requires a SQL adapter..."] }`
    - Call each template function and assemble the planned files array with correct `relPath` values: `routes/database.js`, `middleware/db-manager-auth.js`, `views/db-manager/login.ejs`, `views/db-manager/manager.ejs`
    - Call `appendDbManagerEnv`, `appendDbManagerEnvExample`, `addEjsDependency`, `addDbManagerToAppJs` using content from `options`
    - Return `{ files: [...], warnings: [] }`
    - Export `generateDbManager` and all individual template functions via `module.exports`
    - _Requirements: 2.1, 8.1, 8.2, 9.3_

  - [x] 3.2 Write unit tests for `generateDbManager()` integration
    - Test with a SQL adapter schema: verify all 4 template files are returned with correct relPaths
    - Test with a NoSQL adapter (e.g., `mongodb`): verify empty files array and warning message
    - Test that env, package.json, and app.js modifications are included when options are provided
    - _Requirements: 2.1, 8.1, 8.2_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate DB Manager into the generate command
  - [x] 5.1 Add `--db-manager` flag handling to `src/cli/commands/generate.js`
    - Require `generate-db-manager.js` at the top of the file
    - Add `args["db-manager"]` to the `hasArtifactFlag` check
    - Add a `genDbManager` boolean: `!hasArtifactFlag || args["db-manager"] === true` — but only when `--db-manager` is explicitly passed (do not generate by default when no flags are given)
    - When `genDbManager` is true, call `generateDbManager(schema, { envContent, envExampleContent, appJsContent, packageJsonContent })` passing existing planned content where available
    - Merge returned `files` into the `planned` array
    - Log any warnings via `ctx.log()`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 5.2 Register `--db-manager` in help output and flag summary
    - Add `["--db-manager", "Generate DB Manager UI (SQL adapters only)"]` to `COMMAND_FLAGS.generate` in `src/cli/main.js`
    - Add `--db-manager` option description to `COMMAND_HELP.generate` in `src/cli/commands/help.js`
    - _Requirements: 1.5_

  - [x] 5.3 Write unit tests for the `--db-manager` flag integration in generate command
    - Create tests in `test/commands/generate.test.js` (or a new file) that:
    - Test `--db-manager` with a SQL adapter schema: verify DB Manager files appear in the planned output
    - Test `--db-manager` with `--dry-run`: verify DB Manager files are listed as planned
    - Test `--db-manager` with `--json`: verify DB Manager files appear in JSON output
    - Test `--db-manager` with a NoSQL adapter: verify no DB Manager files and warning is logged
    - Test that DB Manager files are NOT generated when `--db-manager` is not passed
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.2_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The design uses JavaScript (CommonJS for generator, ES modules for generated code), so no language selection was needed
- The design has no Correctness Properties section, so property-based tests are not included
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The generator module follows the same pattern as existing generators (`generate-route.js`, `generate-model.js`)
- All generated code uses `global.db.query()` for database operations, matching the existing `commons/db.js` pattern
