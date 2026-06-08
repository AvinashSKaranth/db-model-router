# Implementation Plan: CLI Init Scaffolding

## Overview

Implement the `db-model-router-init` interactive CLI command that scaffolds a complete Express-based REST API project. The implementation follows a bottom-up approach: pure generator functions first (testable in isolation), then the orchestrator and CLI entry point, then wiring and integration. Property-based tests are placed close to the generators they validate.

## Tasks

- [x] 1. Create generator module with core pure functions
  - [x] 1.1 Create `src/cli/init/generators.js` with all pure generator functions
    - Implement `generateAppJs(answers)` that produces a complete `app.js` string with conditional middleware imports (session, rate limiting, helmet, logger), framework require, `init()` call, `db.connect()`, `express.json()`, `express.urlencoded`, `/health` endpoint, error handler, and `process.env.PORT` listener
    - Implement `generateEnvFile(answers)` that produces `.env` content with `PORT=3000` and database-specific variables with correct default ports (mysql→3306, postgres→5432, sqlite3→DB*NAME only, mongodb→27017, mssql→1433, cockroachdb→26257, oracle→1521, redis→6379, dynamodb→AWS*\* vars)
    - Implement `generateEnvExample(answers)` that produces `.env.example` with identical variable names but placeholder values
    - Implement `generateLoggerMiddleware(answers)` that produces `middleware/logger.js` content — full `express-mung` logger when `answers.logger === true`, minimal fallback otherwise
    - Implement `generateMigrateScript(answers)` that produces `migrate.js` content
    - Implement `generateAddMigrationScript(answers)` that produces `add_migration.js` content
    - Implement `generateInitialMigration(answers)` that returns `{ filename, content }` — `.sql` for SQL databases, `.js` for NoSQL databases, creating the `_migrations` tracking table
    - Implement `generateSessionMigration(answers)` that returns `{ filename, content }` or `null` — only generates for SQL databases with `session === 'database'`
    - Implement `generateGitignore()` that returns `.gitignore` content (`node_modules/`, `.env`, `*.db`)
    - Implement `migrationTimestamp(date)` that formats a Date as `YYYYMMDDHHMMSS` (14-digit string)
    - Export all functions for testing
    - _Requirements: 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1–9.11, 11.1–11.10_

  - [x] 1.2 Create `src/cli/init/dependencies.js` with dependency collector
    - Implement `collectDependencies(answers)` returning `{ dependencies, devDependencies }`
    - Always include `db-model-router`, `dotenv`, selected framework, correct database driver(s), `express-session` in dependencies and `nodemon` in devDependencies
    - Conditionally include `connect-redis` + `ioredis` when `session === 'redis'`, `express-rate-limit` when `rateLimiting === true`, `helmet` when `helmet === true`, `express-mung` when `logger === true`
    - Implement `DRIVER_MAP` constant mapping all 9 databases to their driver packages
    - Implement `getScripts()` returning the 5 package.json scripts object (`start`, `dev`, `test`, `migrate`, `add_migration`)
    - Export all functions for testing
    - _Requirements: 3.2, 3.3, 5.2, 5.3, 6.2, 6.3, 7.2, 10.1–10.5, 12.1, 12.2_

- [x] 2. Write property-based tests for generators and dependency collector
  - [x] 2.1 Write property test: Database driver mapping is correct
    - **Property 1: Database driver mapping is correct**
    - **Validates: Requirements 3.2, 3.3**
    - Create `test/properties/cli-init.property.test.js`
    - Use `fast-check` arbitrary generating random valid `answers` objects (9 databases × 3 sessions × 2³ booleans)
    - Assert `collectDependencies(answers)` includes the correct driver package(s) for every database selection

  - [x] 2.2 Write property test: Environment variables match database selection
    - **Property 2: Environment variables match database selection**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9**
    - Assert `generateEnvFile(answers)` contains `PORT=3000` and the correct database-specific env vars with correct default port values

  - [x] 2.3 Write property test: Redis session env vars are included when needed
    - **Property 3: Redis session env vars are included when needed**
    - **Validates: Requirements 9.10**
    - Assert `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASS` present when `session === 'redis'` AND `database !== 'redis'`, absent otherwise

  - [x] 2.4 Write property test: .env and .env.example have identical variable names
    - **Property 4: .env and .env.example have identical variable names**
    - **Validates: Requirements 9.11**
    - Extract variable names (LHS of `=`) from both outputs and assert set equality

  - [x] 2.5 Write property test: Migration file extension matches SQL/NoSQL classification
    - **Property 5: Migration file extension matches SQL/NoSQL classification**
    - **Validates: Requirements 8.2, 8.3**
    - Assert `.sql` extension for SQL databases, `.js` for NoSQL databases

  - [x] 2.6 Write property test: Migration timestamp format is YYYYMMDDHHMMSS
    - **Property 6: Migration timestamp format is YYYYMMDDHHMMSS**
    - **Validates: Requirements 8.4**
    - Generate random Date objects, assert `migrationTimestamp(date)` produces a 14-digit string with valid year/month/day/hour/minute/second ranges

  - [x] 2.7 Write property test: Optional middleware toggles control both dependencies and app.js content
    - **Property 7: Optional middleware toggles control both dependencies and app.js content**
    - **Validates: Requirements 5.2, 5.3, 6.2, 6.3, 7.2, 7.3, 11.5, 11.6, 11.7**
    - For each boolean flag (rateLimiting, helmet, logger): when true, assert corresponding package in deps AND middleware setup in app.js; when false, assert both absent

  - [x] 2.8 Write property test: Session store configuration matches selection
    - **Property 8: Session store configuration matches selection**
    - **Validates: Requirements 4.2, 4.3, 4.4, 11.4**
    - Assert app.js contains correct session store setup for each session option; assert `connect-redis` + `ioredis` in deps when `session === 'redis'`

  - [x] 2.9 Write property test: Core output invariants
    - **Property 9: Core output invariants**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.8, 11.9, 11.10, 12.1, 12.2, 10.1–10.5, 4.6**
    - Assert `generateAppJs` always contains framework require, `init()`, `db.connect()`, `express.json()`, `express.urlencoded`, `/health`, error handler, `process.env.PORT`
    - Assert `collectDependencies` always includes `db-model-router`, `dotenv`, `express-session`, selected framework in deps and `nodemon` in devDeps
    - Assert `getScripts()` returns all 5 scripts with correct values

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create prompt module and CLI entry point
  - [x] 4.1 Create `src/cli/init/prompt.js` with inquirer prompt flow
    - Implement `promptUser()` that runs sequential `inquirer` prompts: framework (list, default `ultimate-express`), database (list, 9 options), session (list, 3 options), rateLimiting (confirm), helmet (confirm), logger (confirm)
    - Return the `answers` object matching the `InitAnswers` typedef
    - Add `inquirer` as a dependency in the project's `package.json`
    - _Requirements: 2.1, 2.4, 3.1, 4.1, 5.1, 6.1, 7.1_

  - [x] 4.2 Create `src/cli/init.js` as the CLI entry point orchestrator
    - Add `#!/usr/bin/env node` shebang line
    - Implement `ensurePackageJson()` that checks for `package.json` existence, runs `execSync('npm init')` if missing, exits with code 1 on failure
    - Implement `generateFiles(answers)` that calls all generators and writes files using `fs.writeFileSync`, creating `middleware/` and `migrations/` directories as needed
    - Implement `updatePackageJson(answers)` that reads existing `package.json`, merges scripts and dependencies from `collectDependencies(answers)` and `getScripts()`, writes back with `JSON.stringify(pkg, null, 2)`
    - Implement `runInstall()` that runs `execSync('npm install')`, catches failure and prints manual install instructions, exits with code 1 on error
    - Implement `printSummary(answers)` that prints the generated file tree and next-step instructions (edit `.env`, run `npm run dev`)
    - Implement `main()` orchestrating: `ensurePackageJson()` → `promptUser()` → `generateFiles()` → `updatePackageJson()` → `runInstall()` → `printSummary()`
    - Handle Ctrl+C (inquirer throw) with clean exit code 1
    - Handle file write errors (`EACCES`/`EPERM`) with descriptive error messages
    - Handle malformed `package.json` with JSON parse error message
    - _Requirements: 1.1–1.4, 12.3, 12.4, 13.1, 13.2, 14.2_

  - [x] 4.3 Register `db-model-router-init` in `package.json` bin field
    - Add `"db-model-router-init": "src/cli/init.js"` to the existing `bin` object in the project's `package.json`
    - _Requirements: 14.1_

- [x] 5. Write unit tests for CLI orchestration
  - [x] 5.1 Write unit tests for `src/cli/init.js` orchestration logic
    - Create `test/cli.init.test.js`
    - Test `ensurePackageJson()` skips when `package.json` exists
    - Test `ensurePackageJson()` failure exits with code 1
    - Test prompt configuration has correct options and defaults
    - Test `runInstall()` failure prints manual install instructions
    - Test session migration is generated only for SQL + database session
    - Test generated files have correct shebang lines
    - Test summary output lists all generated files
    - Test Ctrl+C handling exits cleanly
    - Test malformed `package.json` error handling
    - _Requirements: 1.2, 1.3, 1.4, 4.5, 12.4, 13.1, 13.2_

- [x] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update documentation
  - [x] 7.1 Update `README.md` with `db-model-router-init` command documentation
    - Add a section describing the new `db-model-router-init` command, its purpose, and usage
    - Document the interactive prompt flow and available options
    - Document the generated project structure

  - [x] 7.2 Update `docs/README.md` with detailed init command documentation
    - Add comprehensive documentation for the init command
    - Document all prompt options and their effects
    - Document the migration infrastructure (`migrate.js`, `add_migration.js`, `migrations/`)
    - Document environment variable configuration per database

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All generators are pure functions for testability — no I/O in generator modules
- The existing CLI commands (`generate-model`, `generate-route`, `generate-app`) remain unchanged
- `fast-check` and `mocha` are already devDependencies in the project
- `inquirer` needs to be added as a new dependency
- Property tests cover all 216 input combinations (9 databases × 3 sessions × 2³ booleans)
- Each property test references specific requirements for traceability
