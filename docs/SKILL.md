---
name: db-model-router
description: Database-agnostic REST API generator for Node.js/Express. Define model → get CRUD API + Express routes. 10 adapters, identical API. Works with express or ultimate-express.
---

# db-model-router — LLM Skill Reference

Database-agnostic REST API generator for Node.js/Express. Define model → get CRUD API + Express routes. 10 adapters, identical API. Works with `express` or `ultimate-express`. Generated projects use ESM (`import`/`export`).

## LLM Workflow (follow this order)

1. **Scaffold**: `db-model-router init --framework express --database postgres --session redis --rateLimiting --helmet --logger --yes` (all flags → zero prompts)
2. **Start infra**: `npm run docker:up` (starts DB + CloudBeaver + optional Loki/Grafana)
3. **Migrations**: Write SQL/JS migration files into `migrations/`, then `npm run migrate`
4. **Generate models**: `db-model-router generate --from dbmr.schema.json --models`
5. **Generate routes + tests**: `db-model-router generate --from dbmr.schema.json --routes --tests`
6. **Run**: `npm run dev`

Step 1 creates the project with ESM, Docker, and all infrastructure. Step 2 starts containers. Steps 3-5 define schema and generate code. Step 6 starts the server.

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
| `mariadb`     | mysql2                                           | 3306         |
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

| Param     | Type            | Description                                                                                                                                                                              |
| --------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| structure | `{col: "rule"}` | Types: `string\|integer\|numeric\|boolean\|object\|datetime\|auto_increment`. Prefix `required\|` for NOT NULL. PK, timestamps, soft-delete cols are auto-excluded by the code generator |
| pk        | string          | Primary key column. Convention: `<table>_id`                                                                                                                                             |
| unique    | string[]        | Columns for upsert conflict resolution                                                                                                                                                   |
| option    | object          | `{ safeDelete, created_at, modified_at }` — column names or null                                                                                                                         |

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

### Unified CLI: `db-model-router`

```bash
db-model-router <command> [options]
db-model-router help <command>     # detailed help for any command
```

#### `init` — Project Scaffold

Scaffolds a complete ESM-based Express REST API project with Docker support.

```bash
# Fully non-interactive (LLM-friendly — zero prompts)
db-model-router init --framework express --database postgres --session redis \
  --rateLimiting --helmet --logger --yes

# With Loki logging + Grafana
db-model-router init --database postgres --logger --loki --yes

# With output directory
db-model-router init --database mysql --output backend --yes

# From schema file
db-model-router init --from dbmr.schema.json --yes --no-install
```

| Flag                 | Description                                                                                                 | Default    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| `--from <path>`      | Read config from schema file                                                                                |            |
| `--framework <name>` | `express` or `ultimate-express`                                                                             | (prompted) |
| `--database <name>`  | `mysql`, `mariadb`, `postgres`, `sqlite3`, `mongodb`, `mssql`, `cockroachdb`, `oracle`, `redis`, `dynamodb` | (prompted) |
| `--db <name>`        | Alias for `--database`                                                                                      |            |
| `--session <type>`   | `memory`, `redis`, `database`                                                                               | (prompted) |
| `--output <dir>`     | Backend source directory (relative to cwd)                                                                  | (root)     |
| `--rateLimiting`     | Enable rate limiting                                                                                        | yes        |
| `--helmet`           | Enable Helmet security headers                                                                              | yes        |
| `--logger`           | Enable Winston request logger                                                                               | yes        |
| `--loki`             | Enable Loki transport + Loki/Grafana in docker-compose                                                      | no         |

Generated files (ESM, `"type": "module"`):

```
app.js                          Express entry point
.env / .env.example             Environment config (random passwords)
Dockerfile                      node:alpine production image
docker-compose.yml              DB + CloudBeaver + optional Loki/Grafana
.cloudbeaver/data-sources.json  Auto-connects CloudBeaver to DB
.grafana/datasources.yml        Auto-connects Grafana to Loki (when --loki)
<output>/commons/db.js          Database init, connect, global.db
<output>/commons/session.js     Session configuration
<output>/commons/security.js    Helmet, rate limiting, custom headers
<output>/commons/migrate.js     Migration runner (importable + standalone)
<output>/commons/add_migration.js  Migration creator (importable + standalone)
<output>/middleware/logger.js   Winston logger (+ Loki when LOKI_HOST is set)
<output>/route/index.js         Central route mounting
<output>/route/health.js        GET /health with DB connectivity check
<output>/migrations/            Initial migration files
```

Docker services (auto-generated in docker-compose.yml):

| Service     | When                        | Port   | Notes                                 |
| ----------- | --------------------------- | ------ | ------------------------------------- |
| Database    | Always (except sqlite3)     | Varies | Random password, bind mount `./data/` |
| Redis       | `session=redis`, DB ≠ redis | 6379   | Session store                         |
| CloudBeaver | SQL/MongoDB databases       | 8978   | Web DB admin, auto-connected          |
| Loki        | `--loki`                    | 3100   | Log aggregation                       |
| Grafana     | `--loki`                    | 3001   | Log visualization                     |

Scripts: `start`, `dev`, `test`, `migrate`, `add_migration`, `docker:build`, `docker:up`, `docker:down`.

**Critical**: `db-model-router` is CJS. Generated ESM code must use: `import dbModelRouter from "db-model-router"; const { init, db } = dbModelRouter;` — NOT named imports.

#### `inspect` — DB Introspection

```bash
db-model-router inspect --type postgres --env .env [--out schema.json] [--tables t1,t2]
```

| Flag               | Description                             |
| ------------------ | --------------------------------------- |
| `--type <adapter>` | Database adapter (required)             |
| `--env <path>`     | Path to .env file                       |
| `--out <path>`     | Output file (default: dbmr.schema.json) |
| `--tables <list>`  | Comma-separated table filter            |

#### `generate` — Code Generation

```bash
db-model-router generate --from dbmr.schema.json [--models] [--routes] [--openapi] [--tests] [--llm-docs]
```

| Flag            | Description                             |
| --------------- | --------------------------------------- |
| `--from <path>` | Schema file (default: dbmr.schema.json) |
| `--models`      | Generate only model files               |
| `--routes`      | Generate only route files + index       |
| `--openapi`     | Generate only OpenAPI spec              |
| `--tests`       | Generate only test files                |
| `--llm-docs`    | Generate only LLM docs                  |

No flags = generate all. Generated routes/tests use ESM imports.

#### `doctor` — Validation

```bash
db-model-router doctor [--from dbmr.schema.json] [--json]
```

Checks: schema validation, dependency check, file sync.

#### `diff` — Preview Changes

```bash
db-model-router diff [--from dbmr.schema.json] [--json]
```

Shows added/modified/deleted files without writing.

#### Universal Flags (all commands)

`--yes`, `--json`, `--dry-run`, `--no-install`, `--help`

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

1. `init()` before `db.connect()`. Don't destructure `db` before `init()` — it's a getter.
2. Generated projects are ESM (`"type": "module"`). The library itself is CJS. Use default import: `import dbModelRouter from "db-model-router"; const { init, db } = dbModelRouter;`
3. `model structure` excludes: PK col, timestamp cols, soft-delete cols.
4. `update()`/`patch()` require PK in payload. `upsert()` PK is optional.
5. `findOne()` returns `false` on no match. `byId()` returns `null`.
6. Bulk ops wrap in `{ data: [...] }`. Single ops use flat object.
7. Timestamps auto-stripped from payloads. DB handles defaults/triggers.
8. `safeDelete` makes `remove()` soft-delete; all reads auto-filter deleted rows.
9. `list()` defaults: page=0, size=30. `sort` array: `["-col"]` for DESC.
10. Use the unified `db-model-router` CLI with `dbmr.schema.json` for new projects.
11. `generate` auto-generates test files alongside routes. Tests use `supertest`.
12. `global.db` is set by `commons/db.js` — accessible anywhere without imports.
13. Logger dynamically loads `winston-loki` only when `LOKI_HOST` env var is set.
14. Docker passwords are randomly generated and shared between `.env` and `docker-compose.yml`.

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
When `logger=true`: adds `APP_NAME LOG_LEVEL LOKI_HOST` (LOKI_HOST empty unless `--loki`).

## Schema-Driven Workflow

The `db-model-router` command uses `dbmr.schema.json` as the source of truth.

### LLM Workflow (schema-driven)

1. **Inspect** (existing DB): `db-model-router inspect --type postgres --env .env` → writes `dbmr.schema.json`
2. **Edit** `dbmr.schema.json` — add relationships, tweak columns, set options
3. **Generate**: `db-model-router generate --from dbmr.schema.json` → models, routes, tests, OpenAPI
4. **Doctor**: `db-model-router doctor --from dbmr.schema.json` → validate schema + check sync
5. **Run**: `npm run dev`

### dbmr.schema.json Format

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
      "timestamps": { "created_at": "created_at", "modified_at": "updated_at" }
    }
  },
  "relationships": [
    { "parent": "users", "child": "posts", "foreignKey": "user_id" }
  ]
}
```

Fields per table: `columns` (required, include ALL columns), `pk` (required, convention: `<table>_id`), `unique` (default `[pk]`), `softDelete`, `timestamps`.
Column rules: `(required|)?(string|integer|numeric|boolean|object|datetime|auto_increment)`.

- `auto_increment` — auto-incrementing PK (SERIAL in Postgres, AUTO_INCREMENT in MySQL/MariaDB)
- `datetime` — date/time columns (TIMESTAMP, DATETIME, DATE)
- `required|<type>` — NOT NULL constraint
