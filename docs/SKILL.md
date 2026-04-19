# db-model-router — LLM Skill Reference

Database-agnostic REST API generator for Node.js/Express. Define model → get CRUD API + Express routes. 9 adapters, identical API.

## Install

```bash
npm install db-model-router <driver>
```

Drivers: `mysql2`, `pg`, `better-sqlite3`, `mongodb`, `mssql`, `oracledb`, `ioredis`, `@aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb`

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

| Param     | Type            | Description                                                                                                           |
| --------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| structure | `{col: "rule"}` | Types: `string\|integer\|numeric\|object`. Prefix `required\|` for NOT NULL. Exclude PK, timestamps, soft-delete cols |
| pk        | string          | Primary key column. Default `"id"`                                                                                    |
| unique    | string[]        | Columns for upsert conflict resolution                                                                                |
| option    | object          | `{ safeDelete, created_at, modified_at }` — column names or null                                                      |

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
[
  [
    ["age", ">", 25],
    ["type", "=", 1],
  ],
][([["name", "=", "A"]], [["name", "=", "B"]])][[["type", "in", [1, 2, 3]]]][ // AND // OR // IN
  [["name", "like", "Ali"]]
]; // LIKE %Ali%
```

## route(model, override?)

Generates Express Router with 9 endpoints:

| Method | Path   | Action                           |
| ------ | ------ | -------------------------------- |
| GET    | `/:pk` | Get by PK                        |
| POST   | `/:id` | Insert single                    |
| PUT    | `/:id` | Update single (PK from URL)      |
| PATCH  | `/:id` | Partial update                   |
| DELETE | `/:id` | Delete single                    |
| GET    | `/`    | List (page, size, sort, filters) |
| POST   | `/`    | Bulk insert `{data:[...]}`       |
| PUT    | `/`    | Bulk update `{data:[...]}`       |
| DELETE | `/`    | Bulk delete `{data:[...]}`       |

**Payload override** (multi-tenancy): `route(m, { tenant_id: "user.tenant_id" })` — maps cols to `req` paths via lodash.get.

**Query params**: `select_columns=name,email`, `output_content_type=csv|xml|json`, `sort=-age,name`

## CLI Tools

### generate-app (full scaffold)

```bash
db-model-router-generate-app --type mysql --env .env [--output ./dir] [--tables users,posts,posts.comments]
```

Creates: `app.js`, `models/`, `routes/`, `middleware/logger.js`, `.env.example`, `.gitignore`, `migrations/`, `sessions/`, `openapi.json`

### generate-model (DB introspection → model files)

```bash
db-model-router-generate-model --type <db> --env .env [--output ./models] [--tables t1,t2] [--schema public]
```

Auto-detects: PK, unique indexes, DEFAULT→optional, timestamp cols, soft-delete cols.

### generate-route (model files → route files + OpenAPI)

```bash
db-model-router-generate-route --models ./models --output ./routes [--tables posts,posts.comments]
```

Dot notation `parent.child` creates nested routes: `parent/:parent_id/child` with FK scoping via `<parent_singular>_id`.

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
2. `modelStructure` excludes: PK col, timestamp cols, soft-delete cols.
3. `update()`/`patch()` require PK in payload. `upsert()` PK is optional.
4. `findOne()` returns `false` on no match. `byId()` returns `null`.
5. Bulk ops wrap in `{ data: [...] }`. Single ops use flat object.
6. Timestamps auto-stripped from payloads. DB handles defaults/triggers.
7. `safeDelete` makes `remove()` soft-delete; all reads auto-filter deleted rows.
8. `list()` defaults: page=0, size=30. `sort` array: `["-col"]` for DESC.
9. CommonJS only (`require`). Use dynamic `import()` for ESM.
