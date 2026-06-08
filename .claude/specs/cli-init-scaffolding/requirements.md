# Requirements Document

## Introduction

The `db-model-router-init` command is an interactive CLI that scaffolds a complete Express-based REST API project from scratch. It replaces the need for `generate-app` as the primary entry point for new projects by running `npm init`, prompting the user for framework, database, session, security, rate limiting, and logging preferences, then generating a fully configured project with migration infrastructure, environment configuration, and all necessary package.json scripts. The existing `generate-model`, `generate-route`, and `generate-app` commands remain available for use after initial scaffolding.

## Glossary

- **CLI**: The `db-model-router-init` command-line interface executable
- **Scaffold**: The complete set of generated project files and directories
- **Prompt_Engine**: The interactive prompt system that collects user choices (e.g., using `inquirer` or `prompts`)
- **Migration_Manager**: The subsystem responsible for creating and organizing database migration files
- **SQL_Database**: Any of the SQL-based supported databases: mysql, postgres, sqlite3, mssql, cockroachdb, oracle
- **NoSQL_Database**: Any of the non-SQL supported databases: mongodb, redis, dynamodb
- **Session_Store**: The session persistence mechanism chosen by the user: in-memory, redis, or database
- **Migration_Tracking_Table**: A persistent database table that records which migration files have been executed
- **Env_Generator**: The subsystem that produces the `.env` file based on selected database and server port
- **Script_Generator**: The subsystem that writes the `scripts` section of `package.json`

## Requirements

### Requirement 1: NPM Initialization

**User Story:** As a developer, I want the CLI to run the full `npm init` process first, so that my project has a valid `package.json` before any scaffolding begins.

#### Acceptance Criteria

1. WHEN the user executes `db-model-router-init`, THE CLI SHALL execute the `npm init` process in the current working directory before proceeding to interactive prompts.
2. WHEN `npm init` completes successfully, THE CLI SHALL proceed to the framework selection prompt.
3. IF `npm init` fails or the user aborts it, THEN THE CLI SHALL exit with a non-zero exit code and display an error message indicating that initialization was aborted.
4. WHEN a `package.json` already exists in the current directory, THE CLI SHALL skip the `npm init` step and proceed directly to the interactive prompts.

### Requirement 2: Express Framework Selection

**User Story:** As a developer, I want to choose between `ultimate-express` and `express` as my framework, so that I can pick the performance profile that suits my project.

#### Acceptance Criteria

1. WHEN `npm init` completes, THE Prompt_Engine SHALL display a selection prompt with two options: `ultimate-express` and `express`.
2. WHEN the user selects `ultimate-express`, THE CLI SHALL record `ultimate-express` as the chosen framework and include it as a dependency in `package.json`.
3. WHEN the user selects `express`, THE CLI SHALL record `express` as the chosen framework and include it as a dependency in `package.json`.
4. THE Prompt_Engine SHALL set `ultimate-express` as the default selection.

### Requirement 3: Database Selection

**User Story:** As a developer, I want to select my database from the full list of supported databases, so that the scaffold is configured for my chosen data store.

#### Acceptance Criteria

1. WHEN the framework selection completes, THE Prompt_Engine SHALL display a selection prompt listing all nine supported databases: mysql, postgres, sqlite3, mongodb, mssql, cockroachdb, oracle, redis, dynamodb.
2. WHEN the user selects a database, THE CLI SHALL record the selection and include the corresponding database driver as a dependency in `package.json`.
3. THE CLI SHALL map each database selection to its correct driver package: mysql to `mysql2`, postgres to `pg`, sqlite3 to `better-sqlite3`, mongodb to `mongodb`, mssql to `mssql`, cockroachdb to `pg`, oracle to `oracledb`, redis to `ioredis`, dynamodb to `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`.

### Requirement 4: Session Configuration

**User Story:** As a developer, I want to choose a session strategy during scaffolding, so that session management is pre-configured in my project.

#### Acceptance Criteria

1. WHEN the database selection completes, THE Prompt_Engine SHALL display a selection prompt with three session options: in-memory, redis, database.
2. WHEN the user selects `in-memory`, THE CLI SHALL configure `express-session` with the default in-memory store in the generated `app.js`.
3. WHEN the user selects `redis`, THE CLI SHALL include `connect-redis` and `ioredis` as dependencies and configure `express-session` with a Redis-backed store in the generated `app.js`.
4. WHEN the user selects `database`, THE CLI SHALL configure `express-session` with a database-backed session store in the generated `app.js`.
5. WHEN the user selects `database` as the Session_Store and the selected database is a SQL_Database, THE Migration_Manager SHALL generate an initial migration file that creates a sessions table with columns for session ID, session data, and expiration.
6. THE CLI SHALL include `express-session` as a dependency in `package.json` regardless of the session option selected.

### Requirement 5: Rate Limiting Configuration

**User Story:** As a developer, I want rate limiting pre-configured in my scaffold, so that my API has basic protection against abuse from the start.

#### Acceptance Criteria

1. WHEN the session selection completes, THE Prompt_Engine SHALL display a confirmation prompt asking whether to enable rate limiting.
2. WHEN the user enables rate limiting, THE CLI SHALL include `express-rate-limit` as a dependency in `package.json` and add rate limiting middleware to the generated `app.js` with sensible defaults.
3. WHEN the user declines rate limiting, THE CLI SHALL omit `express-rate-limit` from dependencies and omit rate limiting middleware from the generated `app.js`.

### Requirement 6: Security Configuration

**User Story:** As a developer, I want Helmet security headers pre-configured in my scaffold, so that my API follows security best practices by default.

#### Acceptance Criteria

1. WHEN the rate limiting prompt completes, THE Prompt_Engine SHALL display a confirmation prompt asking whether to enable Helmet security headers.
2. WHEN the user enables Helmet, THE CLI SHALL include `helmet` as a dependency in `package.json` and add Helmet middleware to the generated `app.js`.
3. WHEN the user declines Helmet, THE CLI SHALL omit `helmet` from dependencies and omit Helmet middleware from the generated `app.js`.

### Requirement 7: Logger Configuration

**User Story:** As a developer, I want a request/response logger pre-configured using `express-mung`, so that I have visibility into API traffic from the start.

#### Acceptance Criteria

1. WHEN the security prompt completes, THE Prompt_Engine SHALL display a confirmation prompt asking whether to enable the request/response logger.
2. WHEN the user enables the logger, THE CLI SHALL include `express-mung` as a dependency in `package.json` and generate a logger middleware file that logs console output, request details, response details, and response time.
3. WHEN the user declines the logger, THE CLI SHALL omit `express-mung` from dependencies and generate a minimal logger middleware file that logs only request method, URL, status code, and response time without using `express-mung`.

### Requirement 8: Migration Folder and Infrastructure

**User Story:** As a developer, I want a migration folder with tracking infrastructure, so that I can manage database schema changes in an organized and repeatable way.

#### Acceptance Criteria

1. THE CLI SHALL create a `migrations` directory in the project root.
2. WHEN the selected database is a SQL_Database, THE Migration_Manager SHALL generate an initial migration file named `{timestamp}.sql` that creates the Migration_Tracking_Table with columns for migration filename, execution timestamp, and a checksum.
3. WHEN the selected database is a NoSQL_Database, THE Migration_Manager SHALL generate an initial migration file named `{timestamp}.js` that creates the Migration_Tracking_Table equivalent as a collection or key-value structure.
4. THE Migration_Manager SHALL use the format `YYYYMMDDHHMMSS` for the timestamp prefix in migration filenames.
5. THE CLI SHALL generate a `migrate.js` script in the project root that reads the `migrations` directory, compares filenames against the Migration_Tracking_Table, and executes pending migrations in chronological order.
6. THE CLI SHALL generate an `add_migration.js` script in the project root that creates a new empty migration file in the `migrations` directory using the correct template (`.sql` for SQL_Database, `.js` for NoSQL_Database) with the current timestamp as the filename prefix.

### Requirement 9: Environment File Generation

**User Story:** As a developer, I want a `.env` file generated with the correct variables for my selected database and server port, so that I can configure my project without looking up connection parameters.

#### Acceptance Criteria

1. THE Env_Generator SHALL create a `.env` file in the project root containing the `PORT` variable set to `3000`.
2. WHEN the selected database is mysql, THE Env_Generator SHALL include `DB_HOST`, `DB_PORT` (defaulting to `3306`), `DB_NAME`, `DB_USER`, and `DB_PASS` variables in the `.env` file.
3. WHEN the selected database is postgres or cockroachdb, THE Env_Generator SHALL include `DB_HOST`, `DB_PORT` (defaulting to `5432` for postgres, `26257` for cockroachdb), `DB_NAME`, `DB_USER`, and `DB_PASS` variables in the `.env` file.
4. WHEN the selected database is sqlite3, THE Env_Generator SHALL include `DB_NAME` (defaulting to `./data.db`) in the `.env` file.
5. WHEN the selected database is mongodb, THE Env_Generator SHALL include `DB_HOST`, `DB_PORT` (defaulting to `27017`), `DB_NAME`, `DB_USER`, and `DB_PASS` variables in the `.env` file.
6. WHEN the selected database is mssql, THE Env_Generator SHALL include `DB_HOST`, `DB_PORT` (defaulting to `1433`), `DB_NAME`, `DB_USER`, and `DB_PASS` variables in the `.env` file.
7. WHEN the selected database is oracle, THE Env_Generator SHALL include `DB_HOST`, `DB_PORT` (defaulting to `1521`), `DB_NAME`, `DB_USER`, and `DB_PASS` variables in the `.env` file.
8. WHEN the selected database is redis, THE Env_Generator SHALL include `DB_HOST`, `DB_PORT` (defaulting to `6379`), and `DB_PASS` variables in the `.env` file.
9. WHEN the selected database is dynamodb, THE Env_Generator SHALL include `AWS_REGION`, `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` variables in the `.env` file.
10. WHEN the user selected `redis` as the Session_Store and the selected database is not redis, THE Env_Generator SHALL include `REDIS_HOST` (defaulting to `localhost`), `REDIS_PORT` (defaulting to `6379`), and `REDIS_PASS` variables in the `.env` file.
11. THE Env_Generator SHALL also create a `.env.example` file with the same variables but placeholder values.

### Requirement 10: Package.json Scripts

**User Story:** As a developer, I want all essential scripts pre-configured in `package.json`, so that I can start, develop, test, and manage migrations using standard npm commands.

#### Acceptance Criteria

1. THE Script_Generator SHALL add a `start` script to `package.json` that runs `node app.js`.
2. THE Script_Generator SHALL add a `dev` script to `package.json` that runs `nodemon app.js`.
3. THE Script_Generator SHALL add a `test` script to `package.json` with a placeholder test command.
4. THE Script_Generator SHALL add a `migrate` script to `package.json` that runs `node migrate.js`.
5. THE Script_Generator SHALL add an `add_migration` script to `package.json` that runs `node add_migration.js`.

### Requirement 11: Generated App Entry Point

**User Story:** As a developer, I want a fully configured `app.js` generated with all my selected middleware wired up, so that I can start the server immediately after running `npm install`.

#### Acceptance Criteria

1. THE CLI SHALL generate an `app.js` file that imports and initializes the selected Express framework.
2. THE CLI SHALL generate an `app.js` file that calls `init()` with the selected database adapter and `db.connect()` with environment variables from the `.env` file.
3. THE CLI SHALL generate an `app.js` file that registers `express.json()` and `express.urlencoded({ extended: true })` middleware.
4. WHEN the user enabled session support, THE CLI SHALL include session middleware configuration in the generated `app.js` using the selected Session_Store.
5. WHEN the user enabled rate limiting, THE CLI SHALL include rate limiting middleware in the generated `app.js`.
6. WHEN the user enabled Helmet, THE CLI SHALL include Helmet middleware in the generated `app.js`.
7. WHEN the user enabled the logger, THE CLI SHALL include the logger middleware in the generated `app.js`.
8. THE CLI SHALL generate an `app.js` file that includes a `/health` endpoint returning a JSON status response.
9. THE CLI SHALL generate an `app.js` file that includes a global error handler middleware.
10. THE CLI SHALL generate an `app.js` file that listens on the port specified by the `PORT` environment variable.

### Requirement 12: Dependency Installation

**User Story:** As a developer, I want all selected dependencies installed automatically after scaffolding, so that the project is ready to run without manual `npm install` steps.

#### Acceptance Criteria

1. WHEN all files have been generated, THE CLI SHALL include `db-model-router` and `dotenv` as dependencies in `package.json`.
2. WHEN all files have been generated, THE CLI SHALL include `nodemon` as a devDependency in `package.json`.
3. WHEN all files have been generated, THE CLI SHALL run `npm install` to install all recorded dependencies.
4. IF `npm install` fails, THEN THE CLI SHALL display an error message listing the dependencies that need to be installed manually and exit with a non-zero exit code.

### Requirement 13: Project Structure Output

**User Story:** As a developer, I want a clear summary of the generated project structure printed after scaffolding completes, so that I know what was created and where to find each file.

#### Acceptance Criteria

1. WHEN scaffolding completes successfully, THE CLI SHALL print a summary listing all generated files and directories to the console.
2. WHEN scaffolding completes successfully, THE CLI SHALL print instructions for the next steps: editing the `.env` file and running `npm run dev`.

### Requirement 14: CLI Registration

**User Story:** As a developer, I want the `db-model-router-init` command available as a global CLI command when the package is installed, so that I can run it from any directory.

#### Acceptance Criteria

1. THE CLI SHALL be registered in the `bin` field of the `db-model-router` package's `package.json` as `db-model-router-init` pointing to the CLI entry file.
2. THE CLI entry file SHALL include a Node.js shebang line (`#!/usr/bin/env node`) as the first line.
