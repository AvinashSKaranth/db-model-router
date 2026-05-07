---
name: db-model-router
description: Use this skill whenever the user wants to build a REST API with Node.js/Express backed by any database — including MySQL, PostgreSQL, SQLite, MongoDB, MSSQL, Oracle, Redis, DynamoDB, or CockroachDB. Trigger on any mention of db-model-router, or when the user asks to scaffold, generate, or wire up a CRUD API, models, or routes for a Node/Express backend. Also trigger when the user asks about connecting to a specific database with db-model-router, model definitions, filter syntax, bulk operations, schema-driven generation, or CLI commands like init/generate/inspect/doctor/diff.
---

# db-model-router — LLM Skill Reference

Database-agnostic REST API generator for Node.js/Express. Define a model → get full CRUD + Express routes. 10 adapters, identical API. Generated projects use ESM (`import`/`export`).

## Adapter Reference Files

For adapter-specific connection options, env vars, upsert behavior, and table creation SQL, read the relevant file **on demand** (only when the user's task involves that adapter):

| Adapter       | Reference File              |
| ------------- | --------------------------- |
| `postgres`    | `references/postgres.md`    |
| `cockroachdb` | `references/cockroachdb.md` |
| `sqlite3`     | `references/sqlite3.md`     |
| `mongodb`     | `references/mongodb.md`     |
| `mssql`       | `references/mssql.md`       |
| `oracle`      | `references/oracle.md`      |
| `redis`       | `references/redis.md`       |
| `dynamodb`    | `references/dynamodb.md`    |

MySQL/MariaDB use `mysql2` — no separate reference file needed (see Connection Configs below).

---

## LLM Workflow (follow this order for new projects)

1. **Scaffold**: `db-model-router init --framework express --database postgres --session redis --rateLimiting --helmet --logger --yes`
2. **Start infra**: `npm run docker:up`
3. **Migrations**: Write SQL/JS files into `migrations/`, then `npm run migrate`
4. **Generate models**: `db-model-router generate --from dbmr.schema.json --models`
5. **Generate routes + tests**: `db-model-router generate --from dbmr.schema.json --routes --tests`
6. **Run**: `npm run dev`

For existing databases, use `inspect` first:

```bash
db-model-router inspect --type postgres --env .env   # → writes dbmr.schema.json
db-model-router generate --from dbmr.schema.json      # → models, routes, tests, OpenAPI
```

---

## Install

```bash
npm install db-model-router <framework> <driver>
```

Frameworks: `express` or `ultimate-express` (auto-detected; prefers ultimate-express when both present).

| Adapter       | Driver                                           | Install                                                                |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `mysql`       | mysql2                                           | `npm i db-model-router mysql2`                                         |
| `mariadb`     | mysql2                                           | `npm i db-model-router mysql2`                                         |
| `postgres`    | pg                                               | `npm i db-model-router pg`                                             |
| `sqlite3`     | better-sqlite3                                   | `npm i db-model-router better-sqlite3`                                 |
| `mongodb`     | mongodb                                          | `npm i db-model-router mongodb`                                        |
| `mssql`       | mssql                                            | `npm i db-model-router mssql`                                          |
| `cockroachdb` | pg                                               | `npm i db-model-router pg`                                             |
| `oracle`      | oracledb                                         | `npm i db-model-router oracledb`                                       |
| `redis`       | ioredis                                          | `npm i db-model-router ioredis`                                        |
| `dynamodb`    | @aws-sdk/client-dynamodb + @aws-sdk/lib-dynamodb | `npm i db-model-router @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb` |

---

## Init → Connect → Model → Route

```js
// CJS
const { init, db, model, route } = require("db-model-router");

// ESM (generated projects)
import dbModelRouter from "db-model-router";
const { init, db, model, route } = dbModelRouter;

init("postgres"); // call BEFORE db.connect() — do NOT destructure db before init()
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
  "id", // primary key column
  ["email"], // unique columns (for upsert conflict)
  {
    safeDelete: "is_deleted", // soft-delete column
    created_at: "created_at", // auto-managed timestamp
    modified_at: "updated_at", // auto-managed timestamp
  },
);

app.use("/users", route(users));
```

> **Critical**: Call `init()` before `db.connect()`. Default adapter is `mysql`. Do NOT destructure `db` before `init()` — it is a getter.
> **ESM note**: The library is CJS. Generated ESM projects must use default import (above) — NOT named `import { init }`.

For adapter-specific connect options (ports, env vars, upsert behavior), read the relevant file from `references/`.

---

## model(db, table, structure, pk, unique, option)

| Param       | Type            | Description                                                                                                     |
| ----------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `structure` | `{col: "rule"}` | Types: `string\|integer\|numeric\|boolean\|object\|datetime\|auto_increment`. Prefix `required\|` for NOT NULL. |
| `pk`        | string          | Primary key column. Convention: `<table>_id`                                                                    |
| `unique`    | string[]        | Columns for upsert conflict resolution                                                                          |
| `option`    | object          | `{ safeDelete, created_at, modified_at }` — column names or null                                                |

> PK, timestamp, soft-delete, and `auto_increment` cols are auto-excluded from insert/update payloads.

---

## Model Methods (all async)

```js
// INSERT
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

// DELETE — safeDelete: sets column=1; without: hard delete
await m.remove(1)
await m.remove({ name: "Bob" })
```

---

## Filter Syntax

Structure: `[OR_groups[AND_conditions[col, op, val]]]`
Operators: `= != < > <= >= LIKE NOT LIKE IN NOT IN`

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

### Query Parameter Filter Operators

When using `GET /` (list endpoint), query parameters are automatically parsed into filter conditions. Special value prefixes and patterns control the operator:

| Query Param Value  | Operator   | Example                       | Resulting Filter                     |
| ------------------ | ---------- | ----------------------------- | ------------------------------------ |
| `value`            | `=`        | `?name=john`                  | `name = 'john'`                      |
| `!value`           | `!=`       | `?name=!john`                 | `name != 'john'`                     |
| `>value`           | `>`        | `?age=>25`                    | `age > 25`                           |
| `>=value` (`>%3D`) | `>=`       | `?age=>%3D25`                 | `age >= 25`                          |
| `<value`           | `<`        | `?age=<25`                    | `age < 25`                           |
| `<=value` (`<%3D`) | `<=`       | `?age=<%3D25`                 | `age <= 25`                          |
| `%value%` (`%25`)  | `LIKE`     | `?name=%25john%25`            | `name LIKE '%john%'`                 |
| `!%value%`         | `NOT LIKE` | `?name=!%25john%25`           | `name NOT LIKE '%john%'`             |
| `in(a,b,c)`        | `IN`       | `?status=in(active,pending)`  | `status IN ('active','pending')`     |
| `!in(a,b,c)`       | `NOT IN`   | `?status=!in(active,pending)` | `status NOT IN ('active','pending')` |

`%` is URL-encoded as `%25`; `=` in `>=`/`<=` is URL-encoded as `%3D`. `LIKE` patterns follow SQL conventions: `%25john%25` → contains, `%25john` → ends with, `john%25` → starts with. `IN`/`NOT IN` values are comma-separated inside parentheses.

---

## route(model, override?)

Generates an Express Router with 9 endpoints:

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
| DELETE | `/`    | Bulk delete `{filter_object}`    |

**Payload override** (multi-tenancy): `route(m, { tenant_id: "user.tenant_id" })` — maps columns to `req` paths via lodash.get.

**Query params**: `select_columns=name,email`, `output_content_type=csv|xml|json`, `sort=-age,name`

---

## CLI Reference

```bash
db-model-router <command> [options]
db-model-router help <command>
```

### `init` — Scaffold project

```bash
# Fully non-interactive (LLM-friendly)
db-model-router init --framework express --database postgres --session redis \
  --rateLimiting --helmet --logger --yes

# With Loki/Grafana logging
db-model-router init --database postgres --logger --loki --yes

# From schema file
db-model-router init --from dbmr.schema.json --yes --no-install
```

Key flags: `--framework`, `--database` (or `--db`), `--session`, `--output`, `--rateLimiting`, `--helmet`, `--logger`, `--loki`, `--yes`, `--no-install`

Generated structure (ESM, `"type":"module"`):

```
app.js                             Express entry point
.env / .env.example                Env config (random passwords)
docker-compose.yml                 DB + CloudBeaver + optional Loki/Grafana
<output>/commons/db.js             Database init + global.db
<output>/commons/migrate.js        Migration runner
<output>/route/index.js            Central route mounting
<output>/route/health.js           GET /health endpoint
<output>/migrations/               Initial migration files
```

Docker services auto-generated: database, Redis (if session=redis), CloudBeaver (SQL/MongoDB, port 8978), Loki + Grafana (if --loki).

Scripts: `start`, `dev`, `test`, `migrate`, `add_migration`, `docker:build`, `docker:up`, `docker:down`.

### `inspect` — Introspect existing DB → schema

```bash
db-model-router inspect --type postgres --env .env [--out schema.json] [--tables t1,t2]
```

### `generate` — Generate code from schema

```bash
db-model-router generate --from dbmr.schema.json [--models] [--routes] [--openapi] [--tests] [--llm-docs]
```

No flags = generate all.

### `doctor` — Validate schema + check file sync

```bash
db-model-router doctor [--from dbmr.schema.json] [--json]
```

### `diff` — Preview changes without writing

```bash
db-model-router diff [--from dbmr.schema.json] [--json]
```

Universal flags (all commands): `--yes`, `--json`, `--dry-run`, `--no-install`, `--help`

### `db-manager` — Launch database management UI

```bash
db-model-router db-manager [--env .env] [--port 4000]
```

Starts a built-in web dashboard for browsing and managing your database. Features:

- Table browser with filtering, sorting, pagination, inline editing
- Raw SQL query editor with CSV export
- Query history tracking
- Dashboard overview (table stats: columns, indexes, rows, size)
- Light / Dark / System theme modes (persisted via localStorage)
- Typography: Fira Sans (UI) + Fira Code (data/code)

Requires a `.env` file with `DB_TYPE` and connection variables.

---

## Schema-Driven Workflow (dbmr.schema.json)

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
        "user_id": "auto_increment",
        "name": "required|string",
        "email": "required|string",
        "is_deleted": "boolean",
        "created_at": "datetime",
        "updated_at": "datetime"
      },
      "pk": "user_id",
      "unique": ["email"],
      "softDelete": "is_deleted",
      "timestamps": { "created_at": "created_at", "modified_at": "updated_at" },
      "parent": null
    },
    "posts": {
      "columns": {
        "post_id": "auto_increment",
        "title": "required|string",
        "user_id": "required|integer",
        "created_at": "datetime"
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
        "body": "required|string"
      },
      "pk": "comment_id",
      "unique": ["comment_id"],
      "parent": "posts"
    }
  }
}
```

### `parent` field rules

- `"parent": null` → top-level route: `/comments/`
- `"parent": "posts"` → nested route: `/posts/:post_id/comments/` (also mounted at top-level for direct access)
- **Do NOT use system tables as parents** (`users`, `tenants`, `roles`, `permissions`, `sessions`, `accounts`, `auth_tokens`). They are cross-cutting and referenced via FK columns — not route hierarchies. Only use `parent` for true domain hierarchies: `posts → comments`, `orders → order_items`, `projects → tasks`.

### Column Rules

Format: `(required|)?(string|integer|numeric|boolean|object|datetime|auto_increment)`

Include ALL columns in schema (PK, timestamps, softDelete). The generator auto-excludes them from model `structure`.

### Table Fields

| Field        | Required | Description                                      |
| ------------ | -------- | ------------------------------------------------ |
| `columns`    | Yes      | All columns including PK, timestamps, softDelete |
| `pk`         | Yes      | Primary key (convention: `<table>_id`)           |
| `unique`     | No       | Unique constraint columns (default: `[pk]`)      |
| `softDelete` | No       | Column name for soft-delete                      |
| `timestamps` | No       | `{ created_at, modified_at }` column mapping     |
| `parent`     | No       | Parent table for route nesting, or `null`        |

---

## Connection Configs (quick reference)

For full details (env vars, upsert behavior, notes), read the adapter reference file.

```js
// MySQL / MariaDB (default adapter)
init("mysql");
db.connect({
  host,
  port: 3306,
  user,
  password,
  database,
  connectionLimit: 100,
});

// PostgreSQL — see references/postgres.md
init("postgres");
db.connect({ host, port: 5432, user, password, database });

// SQLite3 — see references/sqlite3.md
init("sqlite3");
db.connect({ database: "./file.db" }); // or ":memory:"

// MongoDB — see references/mongodb.md
init("mongodb");
db.connect({ host, port: 27017, username, password, database });
// or: db.connect({ uri: "mongodb://user:pass@host:27017/db" })

// MSSQL — see references/mssql.md (db.connect is async — use await)
init("mssql");
await db.connect({
  server: host,
  port: 1433,
  user,
  password,
  database,
  options: { encrypt: false, trustServerCertificate: true },
});

// Oracle — see references/oracle.md
init("oracle");
db.connect({ host, port: 1521, user, password, database });

// Redis — see references/redis.md
init("redis");
db.connect({ host, port: 6379, password });

// DynamoDB — see references/dynamodb.md
init("dynamodb");
db.connect({ region, endpoint, accessKeyId, secretAccessKey });

// CockroachDB — see references/cockroachdb.md
init("cockroachdb");
db.connect({ host, port: 26257, user, password, database });
```

---

## Environment Variables by Database

| Database    | Variables                                                              |
| ----------- | ---------------------------------------------------------------------- |
| mysql       | `PORT DB_HOST DB_PORT=3306 DB_NAME DB_USER DB_PASS`                    |
| mariadb     | `PORT DB_HOST DB_PORT=3306 DB_NAME DB_USER DB_PASS`                    |
| postgres    | `PORT DB_HOST DB_PORT=5432 DB_NAME DB_USER DB_PASS`                    |
| cockroachdb | `PORT DB_HOST DB_PORT=26257 DB_NAME DB_USER DB_PASS`                   |
| sqlite3     | `PORT DB_NAME=./data/data.db`                                          |
| mongodb     | `PORT DB_HOST DB_PORT=27017 DB_NAME DB_USER DB_PASS`                   |
| mssql       | `PORT DB_HOST DB_PORT=1433 DB_NAME DB_USER DB_PASS`                    |
| oracle      | `PORT DB_HOST DB_PORT=1521 DB_NAME DB_USER DB_PASS`                    |
| redis       | `PORT DB_HOST DB_PORT=6379 DB_PASS`                                    |
| dynamodb    | `PORT AWS_REGION AWS_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY` |

When `session=redis` and database ≠ redis: adds `REDIS_HOST REDIS_PORT REDIS_PASS`.
When `logger=true`: adds `APP_NAME LOG_LEVEL LOKI_HOST`.

---

## Rules

1. `init()` before `db.connect()`. Don't destructure `db` before `init()` — it's a getter.
2. Generated projects are ESM. The library is CJS. Use default import: `import dbModelRouter from "db-model-router"; const { init, db } = dbModelRouter;`
3. `model structure` excludes: PK, timestamps, soft-delete, and `auto_increment` cols — the generator handles this.
4. `update()`/`patch()` require PK in payload. `upsert()` PK is optional.
5. `findOne()` returns `false` on no match. `byId()` returns `null`.
6. Bulk ops wrap in `{ data: [...] }`. Single ops use flat object.
7. Timestamps auto-stripped from payloads — DB handles defaults/triggers.
8. `safeDelete` makes `remove()` soft-delete; all reads auto-filter deleted rows.
9. `list()` defaults: page=0, size=30. `sort` array: `["-col"]` for DESC.
10. `global.db` is set by `commons/db.js` — accessible anywhere without imports.
11. Logger dynamically loads `winston-loki` only when `LOKI_HOST` env var is set.
12. Docker passwords are randomly generated and shared between `.env` and `docker-compose.yml`.
13. PK convention: `<table>_id` (e.g. `user_id`, `post_id`). Include ALL columns in schema.
14. Use `parent` only for domain hierarchies (e.g. `posts → comments`), not system tables.
