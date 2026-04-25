---
name: db-model-router
description: Database-agnostic REST API generator for Node.js/Express. Define model → get CRUD API + Express routes. 9 adapters, identical API. Works with express or ultimate-express.
---

# db-model-router — LLM Skill Reference

Database-agnostic REST API generator for Node.js/Express. Define model → get CRUD API + Express routes. 9 adapters, identical API. Works with `express` or `ultimate-express`.

## LLM Workflow (follow this order)

1. **Scaffold**: `db-model-router-init --framework express --database postgres --session redis --rateLimiting --helmet --logger` (all flags → zero prompts)
2. **Migrations**: Write SQL/JS migration files into `migrations/` for the user's schema, then `npm run migrate`
3. **Generate models**: `db-model-router-generate-model --type postgres --env .env --output ./models`
4. **Generate routes + tests**: `db-model-router-generate-route --models ./models --output ./routes --tables users,posts,posts.comments`
5. **Run**: `npm run dev`

Step 1 creates the project. Step 2 defines the schema. Steps 3-4 introspect the DB and generate models, routes, tests, and OpenAPI spec. Step 5 starts the server.

## Install

```bash
npm install db-model-router <framework> <driver>
```

Frameworks: `express` or `ultimate-express` (auto-detected, prefers ultimate-express)
Drivers: `mysql2`, `pg`, `better-sqlite3`, `mongodb`, `mssql`, `oracledb`, `ioredis`, `@aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb`

## Adapters

| Module Key    | Driver                                           | Default Port |
| ------------- | ------------------------------------------------ | ------------ |
| `mysql`       | mysql2                                           | 3306         |
| `postgres`    | pg                                               | 5432         |
| `sqlite3`     | better-sqlite3                                   | —            |
| `mongodb`     | mongodb                                          | 27017        |
| `mssql`       | mssql                                            | 1433         |
| `cockroachdb` | pg                                               | 26257        |
| `oracle`      | oracledb                                         | 1521         |
| `redis`       | ioredis                                          | 6379         |
| `dynamodb`    | @aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb | —            |

## Init → Connect → Model → Route

```js
const { init, db, model, route } = require("db-model-router");
init("postgres"); // mysql|postgres|sqlite3|mongodb|mssql|cockroachdb|oracle|redis|dynamodb
db.connect({ host, port: 5432, user, password, database });

const users = model(
  db,
  "users",
  {
    name: "required|string",
    email: "required|string",
    age: "integer",
    meta: "object",
  },
  "id",
  ["email"],
  {
    safeDelete: "is_deleted",
    created_at: "created_at",
    modified_at: "updated_at",
  },
);

app.use("/users", route(users));
```

**Critical**: call `init()` before `db.connect()`. Default adapter is mysql. Do NOT destructure `db` before `init()`.

## model(db, table, structure, pk, unique, option)

| Param     | Type            | Description                                                                                                                    |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| structure | `{col: "rule"}` | Types: `string\|integer\|numeric\|boolean\|object`. Prefix `required\|` for NOT NULL. Exclude PK, timestamps, soft-delete cols |
| pk        | string          | Primary key column. Default `"id"`                                                                                             |
| unique    | string[]        | Columns for upsert conflict resolution                                                                                         |
| option    | object          | `{ safeDelete, created_at, modified_at }` — column names or null                                                               |

## Model Methods (all async)

```js
// INSERT — single returns record, bulk returns {rows, message, type}
await m.insert({ name: "Alice", email: "a@b.com", age: 30 })        // → {id:1, name:"Alice", ...}
await m.insert({ data: [{...}, {...}] })                              // → {rows:2, message, type:"success"}

// UPDATE — PK required in payload
await m.update({ id: 1, name: "Alice V2", email: "a@b.com", age: 31 })
await m.update({ data: [{id:1,...}, {id:2,...}] })

// PATCH — partial update, only sends changed fields, PK required
await m.patch({ id: 1, age: 35 })                                    // → full merged record

// UPSERT — PK optional, uses unique cols for conflict
await m.upsert({ email: "new@b.com", name: "New", age: 20 })

// READ
await m.byId(1)                                                       // → record or null
await m.find({ name: "Alice" })                                       // → {data:[], count}
await m.findOne({ email: "a@b.com" })                                 // → record or false
await m.list({ page: 0, size: 10, sort: ["-age"] })                   // → {data:[], count}

// DELETE — with safeDelete: sets column=1; without: hard delete
await m.remove(1)
await m.remove({ name: "Bob" })
```

## Filter Syntax

Structure: `[OR_groups[AND_conditions[col, op, val]]]`
Ops: `= != < > <= >= like not like in not in`

```js
// AND: age > 25 AND type = 1
[
  [
    ["age", ">", 25],
    ["type", "=", 1],
  ],
][
  // OR: name = "A" OR name = "B"
  ([["name", "=", "A"]], [["name", "=", "B"]])
][
  // IN
  [["type", "in", [1, 2, 3]]]
][
  // LIKE (auto-wraps with %)
  [["name", "like", "Ali"]]
];
```

## route(model, override?)

Generates Express Router with 9 endpoints:

| Method | Path   | Action                           |
| ------ | ------ | -------------------------------- |
| GET    | `/:pk` | Get by PK                        |
| POST   | `/add` | Insert single                    |
| PUT    | `/:pk` | Update single (PK from URL)      |
| PATCH  | `/:pk` | Partial update (PK from URL)     |
| DELETE | `/:pk` | Delete single                    |
| GET    | `/`    | List (page, size, sort, filters) |
| POST   | `/`    | Bulk insert `{data:[...]}`       |
| PUT    | `/`    | Bulk update `{data:[...]}`       |
| DELETE | `/`    | Bulk delete                      |

**Payload override** (multi-tenancy): `route(m, { tenant_id: "user.tenant_id" })` — maps cols to `req` paths via lodash.get.

**Query params**: `select_columns=name,email`, `output_content_type=csv|xml|json`, `sort=-age,name`

## CLI Tools

### db-model-router-init (interactive project scaffold)

Scaffolds a complete Express-based REST API project from scratch. Supports both interactive prompts and fully non-interactive CLI flags.

```bash
# Interactive (prompts for everything)
npx db-model-router-init

# Fully non-interactive (LLM-friendly — no prompts)
db-model-router-init --framework express --database postgres --session redis --rateLimiting --helmet --logger

# Partial flags — only prompts for missing values
db-model-router-init --database mysql --session memory
```

Flags: `--framework <name>`, `--database <name>` (or `--db`), `--session <type>`, `--rateLimiting`, `--helmet`, `--logger`, `--help`

When all 6 options are provided, runs with zero prompts.

Prompts (for missing values): framework (`ultimate-express`|`express`), database (9 options), session (`memory`|`redis`|`database`), rate limiting (y/n), helmet (y/n), logger (y/n).

If no `package.json` exists, runs `npm init` first. After prompts: generates files, updates `package.json`, runs `npm install`.

Generated structure:

```
app.js, .env, .env.example, .gitignore, migrate.js, add_migration.js,
middleware/logger.js, migrations/{timestamp}_create_migrations_table.sql|.js
```

Session migration (`{timestamp}_create_sessions_table.sql`) generated only for SQL databases with `session=database`.

Scripts added: `start` (node app.js), `dev` (nodemon app.js), `test`, `migrate` (node migrate.js), `add_migration` (node add_migration.js).

Dependencies always included: `db-model-router`, `dotenv`, selected framework, database driver(s), `express-session`. DevDeps: `nodemon`.
Conditional: `connect-redis` + `ioredis` (session=redis), `express-rate-limit`, `helmet`, `express-mung` (logger).

#### Environment Variables by Database

| Database    | Variables                                                                   |
| ----------- | --------------------------------------------------------------------------- |
| mysql       | `PORT=3000 DB_HOST DB_PORT=3306 DB_NAME DB_USER DB_PASS`                    |
| postgres    | `PORT=3000 DB_HOST DB_PORT=5432 DB_NAME DB_USER DB_PASS`                    |
| cockroachdb | `PORT=3000 DB_HOST DB_PORT=26257 DB_NAME DB_USER DB_PASS`                   |
| sqlite3     | `PORT=3000 DB_NAME=./data.db`                                               |
| mongodb     | `PORT=3000 DB_HOST DB_PORT=27017 DB_NAME DB_USER DB_PASS`                   |
| mssql       | `PORT=3000 DB_HOST DB_PORT=1433 DB_NAME DB_USER DB_PASS`                    |
| oracle      | `PORT=3000 DB_HOST DB_PORT=1521 DB_NAME DB_USER DB_PASS`                    |
| redis       | `PORT=3000 DB_HOST DB_PORT=6379 DB_PASS`                                    |
| dynamodb    | `PORT=3000 AWS_REGION AWS_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY` |

When `session=redis` and database ≠ redis: adds `REDIS_HOST=localhost REDIS_PORT=6379 REDIS_PASS`.

#### Migration Infrastructure

- `migrate.js` — reads `migrations/` dir, diffs against `_migrations` tracking table, executes pending in order
- `add_migration.js` — creates timestamped empty migration (`.sql` for SQL, `.js` for NoSQL)
- Tracking table `_migrations`: `{id, filename, executed_at, checksum}` (SQL) or equivalent collection/hash/table (NoSQL)
- Timestamp format: `YYYYMMDDHHMMSS`

### generate-model (DB introspection → model files)

```bash
db-model-router-generate-model --type <db> --env .env [--output ./models] [--tables t1,t2] [--schema public]
```

Options: `--type`, `--host`, `--port`, `--database`, `--user`, `--password`, `--schema`, `--output`, `--tables`, `--env`

Auto-detects: PK, unique indexes, DEFAULT→optional, timestamp cols (`created_at`, `updated_at`, `modified_at`, `createdAt`, etc.), soft-delete cols (`is_deleted`, `deleted`, `is_active`, `archived`, etc.). Multi-column unique indexes correctly grouped.

### generate-route (model files → route files + tests + OpenAPI)

```bash
db-model-router-generate-route --models ./models --output ./routes [--tables posts,posts.comments]
```

Options: `--models`, `--output`, `--type`, `--host`, `--port`, `--database`, `--user`, `--password`, `--schema`, `--tables`, `--env`

Generates:

- Route files for each model
- `index.js` mounting all routes on an Express Router
- `openapi.json` (OpenAPI 3.0 spec)
- Test files in `tests/` directory for all routes and methods (uses `supertest` + `assert`)

Dot notation `parent.child` creates nested routes: `parent/:parent_id/child` with FK scoping via `<parent_singular>_id`. Also generates child route test files.

Generated test files cover all 8 CRUD endpoints per table: GET by ID, POST add, PUT update, DELETE, list, bulk insert, bulk update, bulk delete.

## Connection Configs

```js
// MySQL (default)
db.connect({
  host,
  port: 3306,
  user,
  password,
  database,
  connectionLimit: 100,
});

// PostgreSQL / CockroachDB
init("postgres"); // cockroachdb port: 26257
db.connect({ host, port: 5432, user, password, database });

// SQLite3
init("sqlite3");
db.connect({ database: "./file.db" }); // or ":memory:"

// MongoDB
init("mongodb");
db.connect({ host, port: 27017, username, password, database });
// or: db.connect({ uri: "mongodb://user:pass@host:27017/db" })

// MSSQL
init("mssql");
await db.connect({
  server: host,
  port: 1433,
  user,
  password,
  database,
  options: { encrypt: false, trustServerCertificate: true },
});

// Oracle
init("oracle");
db.connect({ host, port: 1521, user, password, database });

// Redis
init("redis");
db.connect({ host, port: 6379, password });

// DynamoDB
init("dynamodb");
db.connect({ region, endpoint, accessKeyId, secretAccessKey });
```

## Rules

1. `init()` before `db.connect()`. Don't destructure `db` before `init()`.
2. `model structure` excludes: PK col, timestamp cols, soft-delete cols.
3. `update()`/`patch()` require PK in payload. `upsert()` PK is optional.
4. `findOne()` returns `false` on no match. `byId()` returns `null`.
5. Bulk ops wrap in `{ data: [...] }`. Single ops use flat object.
6. Timestamps auto-stripped from payloads. DB handles defaults/triggers.
7. `safeDelete` makes `remove()` soft-delete; all reads auto-filter deleted rows.
8. `list()` defaults: page=0, size=30. `sort` array: `["-col"]` for DESC.
9. CommonJS only (`require`). Use dynamic `import()` for ESM.
10. `db-model-router-init` for new projects (interactive). `generate-model` + `generate-route` for existing databases. Or use the unified `db-model-router` CLI with a `dbmr.schema.json` file.
11. `generate-route` auto-generates test files alongside routes. Tests use `supertest`.

## Schema-Driven Workflow (Unified CLI)

The `db-model-router` command is the unified CLI entry point. It uses a single `dbmr.schema.json` file as the source of truth for all code generation.

### LLM Workflow (schema-driven)

1. **Inspect** (existing DB): `db-model-router inspect --type postgres --env .env` → writes `dbmr.schema.json`
2. **Edit** `dbmr.schema.json` — add relationships, tweak columns, set options
3. **Generate**: `db-model-router generate --from dbmr.schema.json` → models, routes, tests, OpenAPI
4. **Doctor**: `db-model-router doctor --from dbmr.schema.json` → validate schema + check sync
5. **Run**: `npm run dev`

Or for new projects: `db-model-router init --from dbmr.schema.json --yes`

### Subcommands

| Subcommand | Description                                                 |
| ---------- | ----------------------------------------------------------- |
| `init`     | Scaffold project (optionally from schema file via `--from`) |
| `inspect`  | Introspect live DB → produce `dbmr.schema.json`             |
| `generate` | Generate models/routes/tests/OpenAPI from schema            |
| `doctor`   | Validate schema, check deps, verify files in sync           |
| `diff`     | Preview changes regeneration would make (read-only)         |

### Universal Flags

All subcommands accept: `--yes`, `--json`, `--dry-run`, `--no-install`, `--help`.

- `--yes`: suppress prompts, accept defaults
- `--json`: machine-readable JSON output only
- `--dry-run`: preview without writing files
- `--no-install`: skip `npm install`

### dbmr.schema.json Format

```json
{
  "adapter": "postgres",
  "framework": "express",
  "options": {
    "session": "redis",
    "rateLimiting": true,
    "helmet": true,
    "logger": true
  },
  "tables": {
    "users": {
      "columns": {
        "name": "required|string",
        "email": "required|string",
        "age": "integer"
      },
      "pk": "id",
      "unique": ["email"],
      "softDelete": "is_deleted",
      "timestamps": { "created_at": "created_at", "modified_at": "updated_at" }
    }
  },
  "relationships": [
    { "parent": "users", "child": "posts", "foreignKey": "user_id" }
  ]
}
```

Fields per table: `columns` (required), `pk` (default `"id"`), `unique` (default `[pk]`), `softDelete`, `timestamps`.
Column rules: `(required|)?(string|integer|numeric|boolean|object)`.
