# Implementation Plan: DB Manager App

## Overview

Implement a standalone Express-based database management UI launched via `npx db-model-router db-manager`. The app connects to any supported database through the library's adapter layer, provides CRUD operations via a dark-themed EJS UI, and maintains connection/query history in an internal SQLite database. All code is CommonJS and lives in `db-manager/` (app files) and `src/cli/commands/db-manager.js` (CLI handler).

## Tasks

- [x] 1. Set up metadata database module
  - [x] 1.1 Create `db-manager/metadata-db.js` with `createMetadataDb(dbPath)` factory
    - Use `better-sqlite3` to open/create the SQLite file at the given path
    - Implement `init()` to create `connections` and `queries` tables (CREATE IF NOT EXISTS)
    - Implement `recordConnection(dbType, host, dbName)` → returns inserted id
    - Implement `recordQuery(connectionId, queryText, rowCount)` → returns inserted id
    - Implement `getConnections(limit=20)` → returns recent connections ordered by connected_at DESC
    - Implement `getQueries(connectionId, limit=50)` → returns recent queries for a connection
    - Implement `close()` to close the SQLite handle
    - Non-fatal error handling: wrap operations in try/catch, log to stderr on failure
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 1.2 Write property test: Connection history round-trip
    - **Property 1: Connection history round-trip**
    - **Validates: Requirements 2.6**
    - File: `test/properties/db-manager.property.test.js`
    - Use fast-check to generate arbitrary db_type, host, database_name strings
    - Assert that after `recordConnection`, `getConnections` returns a record with those exact values and a valid ISO timestamp

  - [x] 1.3 Write property test: Query history recording
    - **Property 2: Query history recording**
    - **Validates: Requirements 3.4**
    - File: `test/properties/db-manager.property.test.js`
    - Use fast-check to generate arbitrary query_text and row_count
    - Assert that after `recordQuery`, `getQueries` returns a record with exact query_text, correct connection_id, row_count, and valid timestamp

- [x] 2. Create adapter proxy module
  - [x] 2.1 Create `db-manager/adapter-proxy.js` with `createAdapterProxy(db, dbType)` factory
    - Implement `getTables()` with adapter-specific SQL (sqlite_master, SHOW TABLES, pg_tables, INFORMATION_SCHEMA, user_tables, etc.)
    - Implement `getSchema(table)` returning `{ columns: Column[], pk: string }`
    - Implement `listRows(table, filter, sort, page, limit)` delegating to `db.list()`
    - Implement `insertRow(table, data)` delegating to `db.insert()`
    - Implement `upsertRow(table, data, uniqueKeys)` delegating to `db.upsert()`
    - Implement `removeRows(table, filter)` delegating to `db.remove()`
    - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.2_

  - [x] 2.2 Write property test: Form fields match table columns
    - **Property 4: Form fields match table columns**
    - **Validates: Requirements 6.1, 8.1**
    - File: `test/properties/db-manager.property.test.js`
    - Create a temporary SQLite DB with fast-check generated column definitions
    - Assert `getSchema` returns columns array where names exactly match the table's actual columns

- [x] 3. Create API routes module
  - [x] 3.1 Create `db-manager/routes/api.js` with `apiRoutes(db, metaDb)` factory returning Express Router
    - GET `/api/tables` — list all tables via adapter proxy
    - GET `/api/tables/:name/schema` — get column metadata
    - GET `/api/tables/:name/rows` — list rows with pagination (query params: page, limit, sort, dir)
    - POST `/api/tables/:name/rows` — insert row(s), record in query history
    - PUT `/api/tables/:name/rows` — upsert row, record in query history
    - DELETE `/api/tables/:name/rows` — delete rows by PK filter, record in query history
    - POST `/api/tables/:name/export` — export selected rows as JSON file download
    - GET `/api/history/connections` — return connection history from metadata DB
    - GET `/api/history/queries` — return query history from metadata DB
    - Consistent error response shape: `{ error: true, message: "..." }`
    - _Requirements: 4.1, 5.2, 5.3, 5.4, 6.2, 7.1, 8.2, 9.1, 9.2, 9.3_

  - [x] 3.2 Write property test: Insert data integrity
    - **Property 5: Insert data integrity**
    - **Validates: Requirements 6.2**
    - File: `test/properties/db-manager.property.test.js`
    - Use fast-check to generate valid row data objects
    - Assert that POST to insert endpoint invokes adapter `insert` with correct table and equivalent data

  - [x] 3.3 Write property test: Delete filter correctness
    - **Property 6: Delete filter correctness**
    - **Validates: Requirements 7.1**
    - File: `test/properties/db-manager.property.test.js`
    - Use fast-check to generate non-empty arrays of PK values
    - Assert that DELETE endpoint invokes adapter `remove` with a filter matching exactly those PKs

  - [x] 3.4 Write property test: Upsert data integrity
    - **Property 7: Upsert data integrity**
    - **Validates: Requirements 8.2**
    - File: `test/properties/db-manager.property.test.js`
    - Use fast-check to generate valid row data and unique keys
    - Assert that PUT endpoint invokes adapter `upsert` with correct table, data, and uniqueKeys

  - [x] 3.5 Write property test: Export data integrity and format
    - **Property 8: Export data integrity and format**
    - **Validates: Requirements 9.1, 9.2**
    - File: `test/properties/db-manager.property.test.js`
    - Use fast-check to generate sets of row objects
    - Assert export response is valid JSON containing exactly those rows

  - [x] 3.6 Write property test: Export filename derivation
    - **Property 9: Export filename derivation**
    - **Validates: Requirements 9.3**
    - File: `test/properties/db-manager.property.test.js`
    - Use fast-check to generate valid table name strings
    - Assert Content-Disposition header filename contains the table name

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create Express server factory and view routes
  - [x] 5.1 Create `db-manager/server.js` with `createApp(db, metaDb)` factory
    - Configure EJS as view engine with views directory at `db-manager/views/`
    - Serve static files from `db-manager/public/`
    - Enable JSON and URL-encoded body parsing
    - Mount API routes at `/` (they already include `/api` prefix)
    - Mount view routes at `/`
    - Return the configured Express app instance
    - _Requirements: 10.1, 13.1, 13.2_

  - [x] 5.2 Create `db-manager/routes/views.js` with `viewRoutes(db, metaDb)` factory returning Express Router
    - GET `/` — render `index.ejs` with layout, passing connection info (DB_TYPE, DB_NAME)
    - _Requirements: 10.3_

- [x] 6. Create EJS templates and static assets
  - [x] 6.1 Create `db-manager/views/layout.ejs`
    - HTML shell with dark theme meta, CSS link, viewport meta tag
    - Include header partial, body content slot, and script tag for app.js
    - _Requirements: 10.1, 10.2, 11.1_

  - [x] 6.2 Create `db-manager/views/index.ejs`
    - Main page using layout, includes sidebar and data-panel partials
    - Two-column layout: sidebar left, data panel right
    - _Requirements: 10.3, 11.2_

  - [x] 6.3 Create `db-manager/views/partials/sidebar.ejs`
    - Accordion with "Tables" section (search input + table list placeholder)
    - Accordion with "History" section (connection/query history placeholder)
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 6.4 Create `db-manager/views/partials/header.ejs`
    - Top bar showing connection info (DB_TYPE, DB_NAME, host)
    - _Requirements: 11.2_

  - [x] 6.5 Create `db-manager/views/partials/data-panel.ejs`
    - Main content area with column header row, data rows container, pagination controls, and action buttons (Add, Delete, Export)
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 6.6 Create `db-manager/public/css/style.css`
    - Dark color scheme (dark backgrounds, light text)
    - Two-column layout (sidebar + data panel)
    - Accordion styles, table styles, form styles, button styles
    - Minimum viewport support: 1024px
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 6.7 Create `db-manager/public/js/app.js`
    - Fetch and render table list in sidebar
    - Client-side table search filtering (case-insensitive substring match)
    - Accordion toggle behavior for Tables/History sections
    - Load table data on selection (column headers + rows)
    - Pagination controls (page nav + page size dropdown: 30, 50, 100, no limit)
    - Add row form (dynamic fields from schema)
    - Inline edit mode (Edit → inputs → Save/Cancel)
    - Row selection checkboxes for delete/export
    - Export selected rows as JSON download
    - Error/success toast messages
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.3, 6.4, 7.1, 7.2, 7.3, 8.1, 8.3, 8.4, 9.1, 9.2, 9.3_

  - [x] 6.8 Write property test: Table search filter correctness
    - **Property 3: Table search filter correctness**
    - **Validates: Requirements 4.2**
    - File: `test/properties/db-manager.property.test.js`
    - Extract the filter function from app.js into a testable CommonJS module at `db-manager/utils/filter-tables.js`
    - Use fast-check to generate arrays of table names and search strings
    - Assert filtered result contains only and all tables whose names include the search string (case-insensitive)

- [x] 7. Create CLI command handler and register subcommand
  - [x] 7.1 Create `src/cli/commands/db-manager.js` command handler
    - Parse `--env` flag (default: `.env` in cwd) and `--port` flag (default: 4000)
    - Validate env file exists → print error and set `process.exitCode = 1` if not
    - Load env vars via `require('dotenv').config({ path })`
    - Validate `DB_TYPE` is present in env
    - Call `require('../../index.js').init(DB_TYPE)` and `db.connect(config)`
    - Initialize metadata DB at `db-manager/.dbmanager.sqlite`
    - Record connection in history
    - Create Express app via `createApp(db, metaDb)`
    - Start server on specified port, print URL to stdout
    - Register SIGTERM/SIGINT handlers for graceful shutdown (disconnect db, close metaDb, close server)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.4, 2.5, 2.6_

  - [x] 7.2 Register `db-manager` subcommand in `src/cli/main.js`
    - Add require for `./commands/db-manager`
    - Add entry to COMMANDS map
    - Add description to COMMAND_DESCRIPTIONS
    - Add flags to COMMAND_FLAGS (--env, --port)
    - _Requirements: 1.1_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Create demo environment files and seed data
  - [x] 9.1 Create demo env files in `db-manager/demo/`
    - `sqlite3.env` — DB_TYPE=sqlite3, DB_NAME=./db-manager/demo/demo.sqlite
    - `mysql.env` — credentials matching docker-compose.yml MySQL service
    - `postgres.env` — credentials matching docker-compose.yml PostgreSQL service
    - `mssql.env` — credentials matching docker-compose.yml MSSQL service
    - `cockroachdb.env` — credentials matching docker-compose.yml CockroachDB service
    - `oracle.env` — credentials matching docker-compose.yml Oracle service
    - `mongodb.env` — credentials matching docker-compose.yml MongoDB service
    - `redis.env` — credentials matching docker-compose.yml Redis service
    - `dynamodb.env` — credentials matching docker-compose.yml DynamoDB service
    - _Requirements: 12.1, 12.2_

  - [x] 9.2 Create seed SQL files in `db-manager/demo/seeds/`
    - `sqlite3.sql` — CREATE TABLE for at least 2 tables (e.g., users, products) with sample INSERT rows
    - `mysql.sql` — equivalent schema and seed data for MySQL
    - `postgres.sql` — equivalent schema and seed data for PostgreSQL
    - `mssql.sql` — equivalent schema and seed data for MSSQL
    - `cockroachdb.sql` — equivalent schema and seed data for CockroachDB
    - `oracle.sql` — equivalent schema and seed data for Oracle
    - _Requirements: 12.3, 12.4_

- [x] 10. Add gitignore entry and finalize file structure
  - [x] 10.1 Add `db-manager/.dbmanager.sqlite` to `.gitignore`
    - _Requirements: 13.4_

  - [x] 10.2 Write integration tests for the DB Manager App
    - File: `test/integration/db-manager-app.test.js`
    - Use supertest to test full request cycle with SQLite demo data
    - Test: GET /api/tables returns table list
    - Test: GET /api/tables/:name/rows returns paginated data
    - Test: POST /api/tables/:name/rows inserts a row
    - Test: PUT /api/tables/:name/rows updates a row
    - Test: DELETE /api/tables/:name/rows removes rows
    - Test: POST /api/tables/:name/export returns JSON download
    - Test: GET / returns HTML page
    - _Requirements: 5.2, 6.2, 7.1, 8.2, 9.1_

  - [x] 10.3 Write unit tests for CLI command handler
    - File: `test/commands/db-manager.test.js` (already exists, extend it)
    - Test: missing env file prints error and sets exit code
    - Test: missing DB_TYPE prints error and sets exit code
    - Test: default port is 4000
    - Test: --port flag overrides default
    - Test: --env flag specifies env file path
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All code uses CommonJS (`require`/`module.exports`) to match the existing project style
- The project already has `better-sqlite3`, `express`, `fast-check`, and `mocha` available
- EJS needs to be added as a dependency (or used from a local require)
- Property tests validate the 9 correctness properties defined in the design document
- Checkpoints ensure incremental validation throughout implementation
- Each task references specific requirement clauses for traceability
