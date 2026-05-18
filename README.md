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

For the LLM skill reference, see [SKILL.md](./skill/SKILL.md). You can also add it directly to your AI assistant:

```bash
npx skills add https://github.com/AvinashSKaranth/db-model-router/skill
```

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

`dbmr.schema.json` is a declarative JSON file that describes your adapter, framework, tables, columns, module hierarchy, and options — all in one place.

#### Modules and the `parent` Field

Each table in the schema represents a **module**. Modules are either top-level or nested under a parent module using the `parent` field:

- `"parent": null` — top-level module, routes mount at `/<table>/`
- `"parent": "posts"` — child module, routes mount at `/posts/:post_id/comments/:comment_id`

When a table has `parent` set, the CLI automatically:

1. Creates a child route file scoped by the parent's PK as a URL parameter
2. Mounts the child routes under the parent path
3. Also mounts the child as a top-level route for direct access

#### Best Practice: Don't Use System Tables as Parents

Tables like `users`, `tenants`, `roles`, `permissions`, `sessions`, and `role_permissions` are cross-cutting concerns — they are referenced by almost every feature module via foreign key columns (e.g. `user_id`, `tenant_id`). Making them route parents would nest every feature module under them, which is not the intent.

Keep system tables as top-level modules (`"parent": null`) and reference them via FK columns in your feature tables. Only use `parent` for true domain hierarchies like `posts → comments`, `orders → order_items`, or `projects → tasks`.

Examples of tables that should stay top-level (not be parents of feature modules):
`users`, `tenants`, `roles`, `role_permissions`, `permissions`, `sessions`, `accounts`, `auth_tokens`

#### Example Schema

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
        "modified_at": "datetime"
      },
      "pk": "user_id",
      "unique": ["email"],
      "softDelete": "is_deleted",
      "timestamps": {
        "created_at": "created_at",
        "modified_at": "modified_at"
      },
      "parent": null
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
      "unique": ["post_id"],
      "parent": null
    },
    "comments": {
      "columns": {
        "comment_id": "auto_increment",
        "post_id": "required|integer",
        "user_id": "required|integer",
        "body": "required|string",
        "created_at": "datetime"
      },
      "pk": "comment_id",
      "unique": ["comment_id"],
      "parent": "posts"
    }
  }
}
```

This generates routes:

- `GET /users/`, `GET /users/:user_id` — top-level
- `GET /posts/`, `GET /posts/:post_id` — top-level
- `GET /posts/:post_id/comments/`, `GET /posts/:post_id/comments/:comment_id` — nested under posts
- `GET /comments/`, `GET /comments/:comment_id` — also available as top-level

Note: `comments` has `user_id` as a foreign key column but `users` is NOT its parent — `posts` is. The `user_id` is just a data reference, not a route hierarchy.

#### Table Fields

| Field        | Required | Description                                                              |
| ------------ | -------- | ------------------------------------------------------------------------ |
| `columns`    | Yes      | Object mapping column names to Column_Rule strings (include ALL columns) |
| `pk`         | Yes      | Primary key column name (convention: `<table>_id`)                       |
| `unique`     | No       | Array of unique constraint columns (defaults to `[pk]`)                  |
| `softDelete` | No       | Column name used for soft-delete                                         |
| `timestamps` | No       | Object with `created_at` and `modified_at` column name mapping           |
| `parent`     | No       | Parent table name for route nesting, or `null` for top-level             |

#### Column Rules

Format: `[required|]<type>[:<subtype>][|<validator>...]`

| Type             | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `auto_increment` | Auto-incrementing PK (SERIAL in Postgres, AUTO_INCREMENT in MySQL) |
| `datetime`       | Date/time columns (TIMESTAMP, DATETIME, DATE)                      |
| `string`         | Text columns (VARCHAR, TEXT, CHAR, UUID)                           |
| `integer`        | Integer columns (INT, BIGINT, SMALLINT)                            |
| `numeric`        | Decimal columns (DECIMAL, FLOAT, DOUBLE, MONEY)                    |
| `boolean`        | Boolean columns (BOOLEAN, BIT)                                     |
| `object`         | JSON columns (JSON, JSONB)                                         |

Prefix with `required|` for NOT NULL constraint. Append `:subtype` for finer SQL type control. Append `|validator` for runtime validation rules.

**Sub-type examples:**

```
"description": "string:text"                       # TEXT instead of VARCHAR(255)
"body": "required|string:longtext"                 # LONGTEXT NOT NULL
"stock": "required|integer:unsigned"               # INT UNSIGNED NOT NULL
"price": "required|numeric:decimal(10,4)"          # DECIMAL(10,4) NOT NULL
```

**Validation examples:**

```
"email": "required|string|email|maxLength:255"     # email format + length check
"phone": "string|phoneNumber"                      # phone number format
"rating": "required|integer|min:1|max:5"           # range validation
"slug": "required|string|regex:^[a-z0-9-]+$"      # pattern validation
"role": "required|string|in:admin,user,moderator"  # enum validation
```

For the full column rule specification including all sub-types and validators, see [docs/dbmr-schema-spec.md](./docs/dbmr-schema-spec.md).

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

| Flag / Arg               | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `--from <path>`          | Path to schema file (default: `dbmr.schema.json`) |
| `--models=false`         | Disable model file generation                     |
| `--routes=false`         | Disable route file generation                     |
| `--openapi=false`        | Disable OpenAPI spec generation                   |
| `--tests=false`          | Disable test file generation                      |
| `--migrations=false`     | Disable migration file generation                 |
| `--saas-structure=false` | Disable SaaS multi-tenant generation              |

All artifact types are **enabled by default**. Use `--flag=false` to disable specific ones.

##### `--saas-structure` — SaaS Multi-Tenant Architecture (default: enabled)

The SaaS structure is always generated unless explicitly disabled with `--saas-structure=false`. It scaffolds a complete multi-tenant SaaS backend on top of your schema-generated code:

- **Tables**: `tenants`, `users`, `roles`, `role_permissions`, `webhooks`, `webhook_logs`
- **Middleware**: `authenticate`, `tenantIsolation`, `hasPermission`
- **Routes**: CRUD for users/tenants/roles/permissions + auth (login/logout)
- **Utilities**: password hashing (crypto.scrypt), modules registry, webhook delivery with retry
- **Seeds**: Super Admin user + Tenant Admin role template
- **Migrations**: Single consolidated migration file for all SaaS tables

> **Important**: Since `--saas-structure` is on by default, the tables `users`, `tenants`, `roles`, and `role_permissions` are already generated with their models, routes, and migrations. **Do not add these tables to your `dbmr.schema.json`** — they will be duplicated. Only define your product/domain-specific tables in the schema (e.g., `products`, `orders`, `invoices`).

The generated `routes/index.js` automatically combines both SaaS routes (under `/api/auth`, `/api/users`, `/api/tenants`, `/api/roles`) and your schema-generated product routes. The OpenAPI/Swagger docs include all SaaS endpoints with security annotations.

```bash
db-model-router generate --from dbmr.schema.json
db-model-router generate --tests=false --dry-run       # skip tests
db-model-router generate --saas-structure=false        # skip SaaS generation
db-model-router generate --openapi=false --tests=false # skip OpenAPI and tests
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

## DB Manager

A built-in database management dashboard accessible via the CLI. Connects to any supported SQL database and provides a visual interface for browsing tables, editing data, running queries, and viewing history.

### Launch

```bash
db-model-router db-manager [--env .env] [--port 4000]
```

| Flag / Arg     | Description                             |
| -------------- | --------------------------------------- |
| `--env <path>` | Path to `.env` file with DB credentials |
| `--port <n>`   | Server port (default: 4000)             |

### Features

- **Dashboard** — Overview of all tables with column count, index count, row count, and size
- **Table Browser** — Browse, filter, sort, add, edit, and delete rows with pagination
- **Query Editor** — Execute raw SQL queries with results table and CSV export
- **Query History** — View previously executed queries with timestamps
- **Theme Support** — Light, Dark, and System (auto-detect) modes with persistent preference
- **Filter System** — Column-level filters with operators (=, !=, like, not like, <, >, <=, >=)
- **Inline Editing** — Edit rows directly in the table without a separate form
- **CSV Export** — Export selected rows or query results to CSV

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
| DELETE | `/users/`    | Bulk delete `{ name: "Bob" }`   |

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

Supported operators: `=`, `!=`, `<`, `>`, `<=`, `>=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`

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

### Query Parameter Filter Operators

When using `GET /` (list endpoint), query parameters are automatically parsed into filter conditions. Special value prefixes and patterns control the SQL operator used:

| Query Param Value      | Operator   | Example URL                   | Resulting Filter                     |
| ---------------------- | ---------- | ----------------------------- | ------------------------------------ |
| `value`                | `=`        | `?name=john`                  | `name = 'john'`                      |
| `!value`               | `!=`       | `?name=!john`                 | `name != 'john'`                     |
| `>value`               | `>`        | `?age=>25`                    | `age > 25`                           |
| `>=value` (use `>%3D`) | `>=`       | `?age=>%3D25`                 | `age >= 25`                          |
| `<value`               | `<`        | `?age=<25`                    | `age < 25`                           |
| `<=value` (use `<%3D`) | `<=`       | `?age=<%3D25`                 | `age <= 25`                          |
| `%value%` (use `%25`)  | `LIKE`     | `?name=%25john%25`            | `name LIKE '%john%'`                 |
| `!%value%`             | `NOT LIKE` | `?name=!%25john%25`           | `name NOT LIKE '%john%'`             |
| `in(a,b,c)`            | `IN`       | `?status=in(active,pending)`  | `status IN ('active','pending')`     |
| `!in(a,b,c)`           | `NOT IN`   | `?status=!in(active,pending)` | `status NOT IN ('active','pending')` |

**Notes:**

- `%` must be URL-encoded as `%25` in query strings. After URL decoding, the `%` character triggers `LIKE` detection.
- `=` in `>=` and `<=` must be URL-encoded as `%3D` (e.g. `>%3D25` for `>=25`).
- `LIKE` patterns follow SQL conventions: `%25john%25` → contains "john", `%25john` → ends with "john", `john%25` → starts with "john".
- `IN` and `NOT IN` values are comma-separated inside parentheses.
  Operators are detected in order of specificity: `!in(...)` → `in(...)` → `!%...%` → `%...%` → `>=` → `<=` → `>` → `<` → `!value` → `=` (default).

## Kafka Event Production

db-model-router has built-in Kafka support. When enabled, every write operation (insert, update, upsert, delete) automatically produces a Kafka event — one event per row affected.

### Setup

Install the Kafka driver:

```bash
npm install kafkajs
```

Set the `KAFKA_BROKER` environment variable in your `.env`:

```env
KAFKA_BROKER=localhost:9092
KAFKA_CLIENT_ID=my-app
KAFKA_TOPIC_PREFIX=dbmr
```

### Initialize

```js
const { init, db, kafka } = require("db-model-router");

init("postgres");
db.connect({ host: "localhost", database: "my_app" });

// Connect Kafka producer (only if KAFKA_BROKER is set)
await kafka.init();
```

Or with explicit options:

```js
await kafka.init({
  broker: "localhost:9092",
  clientId: "my-app",
  topicPrefix: "dbmr",
});
```

### API

| Method                                  | Description                                  |
| --------------------------------------- | -------------------------------------------- |
| `kafka.init(opts)`                      | Connect producer. Returns `true` on success. |
| `kafka.disconnect()`                    | Graceful shutdown.                           |
| `kafka.produce(table, operation, data)` | Manually produce an event.                   |
| `kafka.status()`                        | Returns `true` if connected.                 |

### Event Format

Each affected row produces its own event to topic `{prefix}.{table_name}`:

```json
{
  "table_name": "users",
  "operation_type": "insert",
  "data": { "id": 1, "name": "Alice", "email": "alice@example.com" },
  "timestamp": "2026-05-09T12:00:00.000Z"
}
```

- `operation_type`: `"insert"`, `"update"`, `"upsert"`, or `"delete"`
- `data`: The affected row as an object (not an array)
- Bulk operations (e.g. inserting 100 rows) produce 100 individual events, batched efficiently

### Behavior

- If `KAFKA_BROKER` is not set, Kafka is completely disabled with zero overhead
- Events are produced after successful DB operations only
- Read operations (`find`, `list`, `byId`) never produce events
- Large batches are automatically chunked (500 messages per send) to stay within Kafka's message size limits
- Failed event production logs a warning but does not throw or affect the API response

### Docker

The included `docker-compose.yml` provides Zookeeper, Kafka, and Kafka UI:

```bash
docker compose up -d zookeeper kafka kafka-ui
```

| Service   | Port | Description                       |
| --------- | ---- | --------------------------------- |
| Zookeeper | 2181 | Kafka coordination                |
| Kafka     | 9092 | Broker (host) / 29092 (internal)  |
| Kafka UI  | 8090 | Web dashboard for topics/messages |

### Testing

```bash
npm run test:kafka   # uses env/.env.kafka (SQLite3 + Kafka broker)
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

For AI/LLM integration, see the [Skill Reference](./skill/SKILL.md) — a structured document covering the full API surface, patterns, constraints, and connection configs for all adapters.

### Add the Skill to Your AI Assistant

You can install the db-model-router skill directly into any compatible AI assistant using:

```bash
npx skills add https://github.com/AvinashSKaranth/db-model-router/skill
```

Once installed, your AI assistant will automatically know how to scaffold projects, generate models and routes, write migrations, and work with all 10 supported database adapters.
