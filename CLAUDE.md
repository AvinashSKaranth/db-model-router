# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`db-model-router` is a database-agnostic REST API generator for Node.js. It generates CRUD Express routes from a model schema and supports 9+ database adapters (mysql, postgres, sqlite3, mongodb, mssql, cockroachdb, oracle, redis, dynamodb). It also provides a schema-driven CLI that scaffolds projects, introspects live databases, and generates models/routes/tests/OpenAPI specs.

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server (`nodemon src/serve.js`) |
| `npm test` | Run tests with the default env (`env/.env.default`, targets MySQL) |
| `npm run test:sqlite3` | Run SQLite3 adapter tests |
| `npm run test:mysql` | Run MySQL adapter tests |
| `npm run test:postgres` | Run PostgreSQL adapter tests |
| `npm run test:mongodb` | Run MongoDB adapter tests |
| `npm run test:dynamodb` | Run DynamoDB adapter tests |
| `npm run test:redis` | Run Redis adapter tests |
| `npm run test:mssql` | Run MSSQL adapter tests |
| `npm run test:oracle` | Run Oracle adapter tests |
| `npm run test:cockroachdb` | Run CockroachDB adapter tests |
| `npm run test:kafka` | Run Kafka tests |
| `npm run test:properties` | Run property-based tests (fast-check) |
| `npm run test:command` | Run CLI command tests |
| `npm run test:all` | Run all adapter + property + function + command tests |
| `npm run demo:clear` | Clear the `demo/` directory |
| `npm run demo:create` | Populate the `demo/` directory with sample files |

**Running a single test file:**
```bash
# Example: run only the MySQL individual adapter tests
dotenv -e env/.env.mysql -- mocha test/adapters/mysql.individual.test.js --timeout 15000 --exit

# Example: run a single CLI command test
dotenv -e env/.env.default -- mocha test/commands/generate.test.js --timeout 30000 --exit
```

**Running tests with a specific database:**
Tests load DB credentials from `env/.env.<adapter>`. Docker Compose provides local instances of all databases (see `docker-compose.yml`).

**Running a single test within a file:**
```bash
dotenv -e env/.env.sqlite3 -- mocha test/adapters/sqlite3.individual.test.js --grep "insert" --timeout 15000 --exit
```

## High-Level Architecture

### Core Runtime (`src/`)

The library follows a **singleton adapter pattern**:

1. **`src/index.js`** — Main entry. Exports `init(adapterName)`, `db` (lazy singleton), `model`, `route`, `kafka`. Calling `init("postgres")` loads the corresponding adapter module into the `db` singleton.
2. **`src/commons/model.js`** — The `model(db, table, structure, pk, uniqueKeys, option)` factory returns an object with async methods: `insert`, `update`, `upsert`, `remove`, `byId`, `find`, `findOne`, `list`, `patch`. This is the **universal model API**; it is identical across all adapters.
3. **`src/commons/route.js`** — The `route(model, override)` factory returns an Express `Router` with 9 standard endpoints (GET/POST/PUT/PATCH/DELETE for `/:id` and `/`). `override` injects request-derived values into payloads (e.g., `{ user_id: "user.user_id" }`).
4. **`src/commons/validator.js`** — Input validation using `node-input-validator`, plus the filter parser that converts query-string operators (`!value`, `>value`, `%value%`, `in(a,b)`) into the internal filter array format.
5. **`src/commons/kafka.js`** — Optional Kafka producer. If `KAFKA_BROKER` is set, write operations in `model.js` call `produce(table, operation, data)` after successful DB commits.
6. **`src/commons/function.js`** — Shared utilities (`jsonSafeParse`, `jsonStringify`, `getType`, etc.).

### Adapter Interface (`src/<adapter>/db.js`)

Each adapter must implement a common interface. This is the **only** adapter-specific code:

- `connect(credentials)` — initialize connection/pool/client.
- `get(table, filter, sort, safeDelete)` → `{ data: [...], count: <number> }`
- `list(table, filter, sort, safeDelete, page, limit)` → `{ data: [...], count: <number> }`
- `insert(table, data, uniqueKeys)` → `{ id }` or `{ rows, message }`
- `upsert(table, data, uniqueKeys)` — insert-or-update, bulk-capable.
- `remove(table, filter, safeDelete)` — hard delete or soft delete.
- `where(filter, safeDelete)` — internal filter builder (returns `{ query, value }`).
- `sort_builder(sort)` — internal sort builder.

Adapters live in `src/mysql/db.js`, `src/postgres/db.js`, `src/mongodb/db.js`, etc. Non-SQL adapters (MongoDB, Redis, DynamoDB) implement the same interface but translate filters into their native query languages.

### Filter System

Filters are nested arrays: `[OR_groups[AND_conditions[column, operator, value]]]`.

Example:
```js
// (name = "Alice") OR (age > 30)
[[["name", "=", "Alice"]], [["age", ">", 30]]]

// (name = "Alice" AND age = 30)
[[["name", "=", "Alice"], ["age", "=", 30]]]
```

Query parameters are auto-parsed by `validator.js` into this structure.

### Schema-Driven CLI (`src/cli/`)

The CLI is a unified entry point (`src/cli/main.js`) with subcommands:

- **`init`** — Scaffold a new project (optionally from `dbmr.schema.json`). Generates ESM project with Docker support, migrations, and optional Loki/Grafana logging.
- **`inspect`** — Introspect a live database and emit a `dbmr.schema.json` file.
- **`generate`** — Generate models, routes, tests, OpenAPI spec, migrations, and SaaS structure from a schema file.
- **`doctor`** — Validate schema, check peer dependencies, verify generated files are in sync.
- **`diff`** — Preview what `generate` would change without writing files.
- **`db-manager`** — Launch a built-in database management UI.
- **`help`** — Show detailed per-command help.

Key CLI modules:
- `src/cli/flags.js` — Universal flag parser (`--yes`, `--json`, `--dry-run`, `--no-install`, `--help`) and `OutputContext`.
- `src/schema/schema-parser.js` / `schema-validator.js` — Parse and validate `dbmr.schema.json`.
- `src/schema/schema-to-meta.js` — Convert parsed schema into `ModelMeta` objects consumed by generators.
- `src/cli/generate-model.js`, `generate-route.js`, `generate-openapi.js`, `generate-migration.js` — Code generators.
- `src/cli/generate-saas-structure.js` — Scaffolds multi-tenant SaaS tables (tenants, users, roles, role_permissions, webhooks, webhook_logs), middleware, and routes.

### SaaS Multi-Tenant Structure

When `generate` runs (unless `--saas-structure=false`), it injects a complete SaaS backend:
- Tables: `tenants`, `users`, `roles`, `role_permissions`, `webhooks`, `webhook_logs`
- Middleware: `authenticate`, `tenantIsolation`, `hasPermission`
- Routes: `/api/auth`, `/api/users`, `/api/tenants`, `/api/roles`
- Seeds: Super Admin user + Tenant Admin role template

**Important:** Do NOT add `users`, `tenants`, `roles`, or `role_permissions` to `dbmr.schema.json` — they are generated automatically.

### DB Manager (`db-manager/`)

A standalone Express dashboard for browsing tables, editing rows, running SQL queries, and exporting CSV. Launched via `db-model-router db-manager [--env .env] [--port 4000]`.

### Test Architecture

Tests use **Mocha** + **Supertest** + **assert**.

- `test/adapters/<adapter>.individual.test.js` — CRUD operations per adapter.
- `test/adapters/<adapter>.bulk.test.js` — Bulk insert/update/delete per adapter.
- `test/adapters/<adapter>.route.test.js` — HTTP route tests per adapter.
- `test/properties/*.property.test.js` — Property-based tests using `fast-check`.
- `test/commands/*.test.js` — CLI command tests.
- `test/integration/` — End-to-end integration tests (schema workflow, DB manager).

### Development Server

`src/serve.js` is a reference implementation. It:
1. Auto-detects `ultimate-express` then falls back to `express`.
2. Calls `init("mysql")` and `db.connect(...)` using `env/.env.default` credentials.
3. Defines a `test` model and mounts `/test` routes with a payload override for `user_id`.

When modifying core behavior, `serve.js` is useful for quick manual verification (`npm run dev`).

## Important Patterns

- **Peer dependencies:** All database drivers and Express variants are optional peer dependencies. The library throws a helpful `MODULE_NOT_FOUND` message telling the user exactly what to install.
- **Soft deletes:** Pass `{ safeDelete: "is_deleted" }` as the model option. The adapter's `get`/`list`/`remove` methods automatically filter on `safeDelete = 0` and `remove` becomes an UPDATE when `safeDelete` is set.
- **Timestamp handling:** `model.js` auto-strips `created_at` / `modified_at` variants from payloads before validation. Adapters do NOT need to handle this.
- **Bulk chunking:** SQL adapters chunk bulk inserts/updates at 999 rows per statement to stay within parameter limits.
- **JSON columns:** `object` type columns are stringified on insert/update and parsed on read via `jsonSafeParse` / `jsonStringify` in `function.js`.
