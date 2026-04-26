# db-model-router

A database-agnostic REST API generator for Node.js. Works with Express or ultimate-express (a high-performance drop-in replacement). Define a model, get a full CRUD API with filtering, pagination, and bulk operations — backed by any of 9 supported databases.

## Build a REST API with AI

This library is designed to be driven by an AI assistant. Give it a prompt like this:

```
Use db-model-router to build a REST API for a task management app with postgres.
I need: users (name, email, password_hash), projects (name, description, owner_id → users),
and tasks (title, status, priority, project_id → projects, assignee_id → users).
Scaffold the project, write the migrations, generate models and routes with parent-child
relationships for projects.tasks, and make sure everything runs.
```

For the LLM skill reference, see [SKILL.md](./docs/SKILL.md).

## Supported Adapters

| Adapter                                       | Module Key    | Driver                   | Install                                                                |
| --------------------------------------------- | ------------- | ------------------------ | ---------------------------------------------------------------------- |
| [MySQL](#mysql-example)                       | `mysql`       | mysql2                   | `npm i db-model-router mysql2`                                         |
| MariaDB                                       | `mariadb`     | mysql2                   | `npm i db-model-router mysql2`                                         |
| [PostgreSQL](./docs/adapters/postgres.md)     | `postgres`    | pg                       | `npm i db-model-router pg`                                             |
| [SQLite3](./docs/adapters/sqlite3.md)         | `sqlite3`     | better-sqlite3           | `npm i db-model-router better-sqlite3`                                 |
| [MongoDB](./docs/adapters/mongodb.md)         | `mongodb`     | mongodb                  | `npm i db-model-router mongodb`                                        |
| [MSSQL](./docs/adapters/mssql.md)             | `mssql`       | mssql                    | `npm i db-model-router mssql`                                          |
| [CockroachDB](./docs/adapters/cockroachdb.md) | `cockroachdb` | pg                       | `npm i db-model-router pg`                                             |
| [Oracle](./docs/adapters/oracle.md)           | `oracle`      | oracledb                 | `npm i db-model-router oracledb`                                       |
| [Redis](./docs/adapters/redis.md)             | `redis`       | ioredis                  | `npm i db-model-router ioredis`                                        |
| [DynamoDB](./docs/adapters/dynamodb.md)       | `dynamodb`    | @aws-sdk/client-dynamodb | `npm i db-model-router @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb` |

## Installation

Install the core package, your preferred Express framework, and the driver for your database:

```bash
# Pick your Express framework (one of the two)
npm install express
# OR for ~6x faster performance:
npm install ultimate-express

# Then install db-model-router + your database driver:

# MySQL (default)
npm install db-model-router mysql2

# PostgreSQL / CockroachDB
npm install db-model-router pg

# SQLite3
npm install db-model-router better-sqlite3

# MongoDB
npm install db-model-router mongodb

# MSSQL
npm install db-model-router mssql

# Oracle
npm install db-model-router oracledb

# Redis
npm install db-model-router ioredis

# DynamoDB
npm install db-model-router @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

Both `express` and `ultimate-express` are optional peer dependencies. The library auto-detects which one is installed (preferring `ultimate-express` when both are present). All database drivers are also optional peer dependencies, so your `node_modules` stays lean.

## Quick Start

The fastest way to start a new project:

```bash
# Scaffold a project interactively
npx db-model-router init

# Or fully non-interactive from a schema file
db-model-router init --from dbmr.schema.json --yes --no-install
db-model-router generate --from dbmr.schema.json
```

After scaffolding:

```bash
# 1. Edit .env with your database credentials
# 2. Start developing
npm run dev
```

## Schema-Driven Workflow

Instead of running multiple CLI commands manually, you can define your entire project in a single `dbmr.schema.json` file and let the CLI generate everything from it.

### The Schema File

`dbmr.schema.json` is a declarative JSON file that describes your adapter, framework, tables, columns, relationships, and options — all in one place:

```json
{
  "adapter": "postgres",
  "framework": "express",
  "options": {
    "session": "redis",
    "rateLimiting": true,
    "helmet": true,
    "logger": true,
    "loki": false
  },
  "tables": {
    "users": {
      "columns": {
        "user_id": "auto_increment",
        "name": "required|string",
        "email": "required|string",
        "age": "integer",
        "is_deleted": "boolean",
        "created_at": "datetime",
        "updated_at": "datetime"
      },
      "pk": "user_id",
      "unique": ["email"],
      "softDelete": "is_deleted",
      "timestamps": {
        "created_at": "created_at",
        "modified_at": "updated_at"
      }
    },
    "posts": {
      "columns": {
        "post_id": "auto_increment",
        "title": "required|string",
        "body": "string",
        "user_id": "required|integer",
        "created_at": "datetime",
        "modified_at": "datetime"
      },
      "pk": "post_id",
      "unique": ["post_id"]
    }
  },
  "relationships": [
    { "parent": "users", "child": "posts", "foreignKey": "user_id" }
  ]
}
```

Table entries support these fields:

| Field        | Required | Description                                                              |
| ------------ | -------- | ------------------------------------------------------------------------ |
| `columns`    | Yes      | Object mapping column names to Column_Rule strings (include ALL columns) |
| `pk`         | Yes      | Primary key column name (convention: `<table>_id`)                       |
| `unique`     | No       | Array of unique constraint columns (defaults to `[pk]`)                  |
| `softDelete` | No       | Column name used for soft-delete                                         |
| `timestamps` | No       | Object with `created_at` and `modified_at` column name mapping           |

Column rules use the format `(required|)?(string|integer|numeric|boolean|object|datetime|auto_increment)`.

- `auto_increment` — auto-incrementing PK (SERIAL in Postgres, AUTO_INCREMENT in MySQL/MariaDB)
- `datetime` — date/time columns (TIMESTAMP, DATETIME, DATE)
- `required|<type>` — NOT NULL constraint on insert/update

### Unified CLI: `db-model-router`

The `db-model-router` command is the unified entry point with five subcommands:

```bash
db-model-router <subcommand> [flags]
```

| Subcommand | Description                                                         |
| ---------- | ------------------------------------------------------------------- |
| `init`     | Scaffold a new project (optionally from a schema file)              |
| `inspect`  | Introspect a live database and produce a `dbmr.schema.json`         |
| `generate` | Generate models, routes, tests, and OpenAPI spec from the schema    |
| `doctor`   | Validate schema, check dependencies, verify generated files in sync |
| `diff`     | Preview what changes regeneration would make (read-only)            |

#### Universal Flags

All subcommands accept these flags:

| Flag           | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| `--yes`        | Accept all defaults, suppress interactive prompts           |
| `--json`       | Output machine-readable JSON instead of human-readable text |
| `--dry-run`    | Preview actions without writing files or running commands   |
| `--no-install` | Skip `npm install` (applies to commands that would run it)  |
| `--help`       | Show usage information for the subcommand                   |

#### Quick Workflow Example

```bash
# 1. Introspect an existing database into a schema file
db-model-router inspect --type postgres --env .env

# 2. (Optional) Edit dbmr.schema.json to add relationships, tweak columns, etc.

# 3. Generate all artifacts from the schema
db-model-router generate --from dbmr.schema.json

# 4. Check everything is in sync
db-model-router doctor --from dbmr.schema.json

# 5. Preview what a regeneration would change
db-model-router diff --from dbmr.schema.json
```

Or start a brand-new project from a schema file:

```bash
# Scaffold project + generate everything in one go
db-model-router init --from dbmr.schema.json --yes --no-install
db-model-router generate --from dbmr.schema.json
```

### Command Reference

#### `init`

Scaffold a new project from a schema file or interactively. Generates an ESM-based project (`"type": "module"` in package.json) with Docker support.

| Flag / Arg           | Description                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--from <path>`      | Read adapter, framework, and options from a `dbmr.schema.json` file                                                                                                       |
| `--framework <name>` | Express framework: `express` or `ultimate-express`                                                                                                                        |
| `--database <name>`  | Database adapter: `mysql`, `mariadb`, `postgres`, `sqlite3`, `mongodb`, `mssql`, `cockroachdb`, `oracle`, `redis`, `dynamodb`                                             |
| `--db <name>`        | Alias for `--database`                                                                                                                                                    |
| `--session <type>`   | Session store: `memory`, `redis`, `database`                                                                                                                              |
| `--output <dir>`     | Directory for backend source files (relative to cwd). `package.json` and `app.js` stay in root; `commons/`, `route/`, `middleware/`, `migrations/` go inside this folder. |
| `--rateLimiting`     | Enable rate limiting via `express-rate-limit` (default: yes)                                                                                                              |
| `--helmet`           | Enable Helmet security headers (default: yes)                                                                                                                             |
| `--logger`           | Enable Winston request logger (default: yes)                                                                                                                              |
| `--loki`             | Enable Grafana Loki log transport + Loki/Grafana in docker-compose (default: no, only asked when `--logger` is enabled)                                                   |

```bash
# Non-interactive with output directory
db-model-router init --framework express --database postgres --output backend --yes

# With Loki logging
db-model-router init --database postgres --logger --loki --yes

# From schema, skip install
db-model-router init --from dbmr.schema.json --yes --no-install

# Dry run to preview files
db-model-router init --from dbmr.schema.json --dry-run
```

Generated project structure (with `--output backend`):

```
├── package.json              # root (type: "module")
├── app.js                    # ESM entry point
├── .env / .env.example
├── .gitignore
├── Dockerfile                # node:alpine production image
├── .dockerignore
├── docker-compose.yml        # database + CloudBeaver + optional Loki/Grafana
├── .cloudbeaver/
│   └── data-sources.json     # auto-connects CloudBeaver to your DB
├── .grafana/                 # (only when --loki)
│   └── datasources.yml       # auto-connects Grafana to Loki
└── backend/
    ├── commons/
    │   ├── db.js             # database init, connect, global.db
    │   ├── session.js        # session configuration
    │   ├── security.js       # helmet, rate limiting, custom headers
    │   ├── migrate.js        # migration runner (importable + standalone script)
    │   └── add_migration.js  # migration creator (importable + standalone script)
    ├── middleware/
    │   └── logger.js         # Winston logger (+ Loki transport when LOKI_HOST is set)
    ├── route/
    │   ├── index.js          # central route mounting
    │   └── health.js         # GET /health with DB connectivity check
    └── migrations/
        └── <timestamp>_create_migrations_table.sql
```

Docker services included automatically:

| Service     | When                                  | Port   | Description                            |
| ----------- | ------------------------------------- | ------ | -------------------------------------- |
| Database    | Always (except sqlite3)               | Varies | Selected database with random password |
| Redis       | `--session redis` (if DB isn't redis) | 6379   | Session store                          |
| CloudBeaver | SQL/MongoDB databases                 | 8978   | Web-based DB admin, auto-connected     |
| Loki        | `--loki`                              | 3100   | Log aggregation                        |
| Grafana     | `--loki`                              | 3001   | Log visualization, Loki pre-configured |

npm scripts added: `start`, `dev`, `test`, `migrate`, `add_migration`, `docker:build`, `docker:up`, `docker:down`.

#### `inspect`

Introspect a live database and produce a `dbmr.schema.json` file.

| Flag / Arg         | Description                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `--type <adapter>` | Database adapter to introspect (required): `mysql`, `mariadb`, `postgres`, `sqlite3`, `mssql`, `oracle`, `cockroachdb` |
| `--env <path>`     | Path to `.env` file for database connection parameters                                                                 |
| `--out <path>`     | Output file path (default: `dbmr.schema.json`)                                                                         |
| `--tables <list>`  | Comma-separated list of tables to include (omit for all)                                                               |

```bash
db-model-router inspect --type postgres --env .env
db-model-router inspect --type sqlite3 --out schema.json --tables users,posts
db-model-router inspect --type mysql --json
```

#### `generate`

Generate models, routes, tests, OpenAPI spec, and LLM docs from a schema file. All generated code is ESM (`import`/`export`).

| Flag / Arg      | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `--from <path>` | Path to schema file (default: `dbmr.schema.json`)            |
| `--models`      | Generate only model files                                    |
| `--routes`      | Generate only route files (including child routes and index) |
| `--openapi`     | Generate only OpenAPI spec                                   |
| `--tests`       | Generate only test files                                     |
| `--llm-docs`    | Generate only LLM documentation (`llms.txt` + `docs/llm.md`) |

When no artifact flags are provided, all artifact types are generated.

```bash
db-model-router generate --from dbmr.schema.json
db-model-router generate --models --dry-run
db-model-router generate --routes --tests
db-model-router generate --from dbmr.schema.json --json
```

#### `doctor`

Validate schema, check adapter driver dependencies, and verify generated files are in sync.

| Flag / Arg      | Description                                       |
| --------------- | ------------------------------------------------- |
| `--from <path>` | Path to schema file (default: `dbmr.schema.json`) |

```bash
db-model-router doctor --from dbmr.schema.json
db-model-router doctor --json
```

Reports three checks: schema validation, dependency check, sync check.

#### `diff`

Preview changes between the current generated files and what the schema would produce. Read-only.

| Flag / Arg      | Description                                       |
| --------------- | ------------------------------------------------- |
| `--from <path>` | Path to schema file (default: `dbmr.schema.json`) |

```bash
db-model-router diff --from dbmr.schema.json
db-model-router diff --json
```

#### `help`

Show help for any command.

```bash
db-model-router help              # general overview with per-command flags
db-model-router help init         # detailed help for init
db-model-router init --help       # same as above
```

## MySQL Example

### 1. Connect

```js
const { init, db, model, route } = require("db-model-router");

// Default adapter is mysql, so init() is optional
db.connect({
  host: "localhost",
  port: 3306,
  user: "root",
  password: "password",
  database: "my_app",
  connectionLimit: 100,
  charset: "utf8mb4",
});
```

### 2. Define a Model

```js
const users = model(
  db,
  "users", // table name
  {
    // schema definition
    id: "integer", // auto-increment PK (excluded from inserts)
    name: "required|string",
    email: "required|string",
    age: "required|integer",
    meta: "object", // stored as JSON
    is_deleted: "boolean",
  },
  "id", // primary key column
  ["id"], // unique key columns
  { safeDelete: "is_deleted" }, // optional: soft-delete column
);
```

Schema types: `string`, `integer`, `boolean`, `object`. Prefix with `required|` to enforce on insert/update.

### 3. Mount REST Routes

```js
// Works with either express or ultimate-express
const express = require("express"); // or require("ultimate-express")
const app = express();
app.use(express.json());

app.use("/users", route(users));
app.listen(3000);
```

This creates 9 endpoints:

| Method | Path         | Description                     |
| ------ | ------------ | ------------------------------- |
| GET    | `/users/:id` | Get one record by PK            |
| POST   | `/users/add` | Insert a single record          |
| PUT    | `/users/:id` | Update a single record          |
| PATCH  | `/users/:id` | Partial update a single record  |
| DELETE | `/users/:id` | Delete a single record          |
| GET    | `/users/`    | List with pagination            |
| POST   | `/users/`    | Bulk insert (`{ data: [...] }`) |
| PUT    | `/users/`    | Bulk update (`{ data: [...] }`) |
| DELETE | `/users/`    | Bulk delete                     |

### 4. Payload Override

Inject values from the request into every payload (useful for multi-tenant apps):

```js
app.use((req, res, next) => {
  req.user = { user_id: 42 };
  next();
});

app.use("/users", route(users, { user_id: "user.user_id" }));
```

Every insert/update/query will have `user_id` set from `req.user.user_id`.

## Model API

All model methods are async (except SQLite3 which is synchronous under the hood).

### insert(data)

```js
// Single insert — returns the full inserted record
const user = await users.insert({
  name: "Alice",
  email: "alice@example.com",
  age: 30,
});
// => { id: 1, name: "Alice", email: "alice@example.com", age: 30 }

// Bulk insert — returns row count
const result = await users.insert({
  data: [
    { name: "Bob", email: "bob@example.com", age: 25 },
    { name: "Charlie", email: "charlie@example.com", age: 35 },
  ],
});
// => { rows: 2, message: "2 Userss are saved", type: "success" }
```

### update(data)

```js
// Single update — returns the updated record
const updated = await users.update({
  id: 1,
  name: "Alice Updated",
  email: "alice_v2@example.com",
  age: 31,
});

// Bulk update
const result = await users.update({
  data: [
    { id: 1, name: "Alice V3", email: "alice@example.com", age: 32 },
    { id: 2, name: "Bob V2", email: "bob@example.com", age: 26 },
  ],
});
```

### byId(id)

```js
const user = await users.byId(1);
// => { id: 1, name: "Alice", ... } or null
```

### find(filter)

```js
const result = await users.find({ name: "Alice" });
// => { data: [{ id: 1, name: "Alice", ... }], count: 1 }
```

### findOne(filter)

```js
const user = await users.findOne({ email: "alice@example.com" });
// => { id: 1, ... } or false
```

### list(options)

```js
const page = await users.list({ page: 0, size: 10 });
// => { data: [...], count: 100 }

// With filter
const filtered = await users.list({ name: "Ali", page: 0 });
```

### remove(idOrFilter)

```js
// By ID
await users.remove(1);

// By filter
await users.remove({ name: "Bob" });
```

## Filter System

Filters use a nested array structure: `[OR_groups[AND_conditions[column, operator, value]]]`

Supported operators: `=`, `like`, `not like`, `in`, `not in`, `<`, `>`, `<=`, `>=`, `!=`

```js
// Find users named Alice OR aged > 30
const result = await db.get("users", [
  [["name", "=", "Alice"]],
  [["age", ">", 30]],
]);

// Find users named Alice AND aged 30
const result = await db.get("users", [
  [
    ["name", "=", "Alice"],
    ["age", "=", 30],
  ],
]);
```

## Switching Adapters

To use a different database, call `init()` before `db.connect()`:

```js
const { init, db, model, route } = require("db-model-router");

init("postgres"); // or "mongodb", "sqlite3", "mssql", etc.

db.connect({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "password",
  database: "my_app",
});
```

The model and route APIs remain identical across all adapters. See the individual adapter docs for connection options:

- [PostgreSQL](./docs/adapters/postgres.md)
- [SQLite3](./docs/adapters/sqlite3.md)
- [MongoDB](./docs/adapters/mongodb.md)
- [MSSQL](./docs/adapters/mssql.md)
- [CockroachDB](./docs/adapters/cockroachdb.md)
- [Oracle](./docs/adapters/oracle.md)
- [Redis](./docs/adapters/redis.md)
- [DynamoDB](./docs/adapters/dynamodb.md)

## Environment Setup (Docker)

A `docker-compose.yml` is included for running all supported databases locally:

```bash
docker compose up -d
```

Per-adapter `.env` files live in `env/`:

```bash
npm run test:mysql      # uses env/.env.mysql
npm run test:postgres   # uses env/.env.postgres
npm run test:mongodb    # uses env/.env.mongodb
npm run test:redis      # uses env/.env.redis
npm run test:mssql      # uses env/.env.mssql
npm run test:cockroachdb # uses env/.env.cockroachdb
npm run test:dynamodb   # uses env/.env.dynamodb
npm run test:sqlite3    # uses env/.env.sqlite3 (in-memory, no Docker needed)
```

## License

Apache-2.0

## LLM Skill Reference

For AI/LLM integration, see the [Skill Reference](./docs/SKILL.md) — a structured document covering the full API surface, patterns, constraints, and connection configs for all adapters.
