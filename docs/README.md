# rest-router

A database-agnostic REST API generator for Node.js. Works with Express or ultimate-express (a high-performance drop-in replacement). Define a model, get a full CRUD API with filtering, pagination, and bulk operations — backed by any of 9 supported databases.

## Supported Adapters

| Adapter                                  | Module Key    | Driver                   | Install                                                                |
| ---------------------------------------- | ------------- | ------------------------ | ---------------------------------------------------------------------- |
| [MySQL](#mysql-example)                  | `mysql`       | mysql2                   | `npm i db-model-router mysql2`                                         |
| [PostgreSQL](./adapters/postgres.md)     | `postgres`    | pg                       | `npm i db-model-router pg`                                             |
| [SQLite3](./adapters/sqlite3.md)         | `sqlite3`     | better-sqlite3           | `npm i db-model-router better-sqlite3`                                 |
| [MongoDB](./adapters/mongodb.md)         | `mongodb`     | mongodb                  | `npm i db-model-router mongodb`                                        |
| [MSSQL](./adapters/mssql.md)             | `mssql`       | mssql                    | `npm i db-model-router mssql`                                          |
| [CockroachDB](./adapters/cockroachdb.md) | `cockroachdb` | pg                       | `npm i db-model-router pg`                                             |
| [Oracle](./adapters/oracle.md)           | `oracle`      | oracledb                 | `npm i db-model-router oracledb`                                       |
| [Redis](./adapters/redis.md)             | `redis`       | ioredis                  | `npm i db-model-router ioredis`                                        |
| [DynamoDB](./adapters/dynamodb.md)       | `dynamodb`    | @aws-sdk/client-dynamodb | `npm i db-model-router @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb` |

## Installation

Install the core package, your preferred Express framework, and the driver for your database:

```bash
# Pick your Express framework (one of the two)
npm install express
# OR for ~6x faster performance:
npm install ultimate-express

# Then install db-model-router + your database driver
npm install db-model-router <driver>
```

Both `express` and `ultimate-express` are optional peer dependencies — the library auto-detects which one is installed (preferring `ultimate-express` when both are present). All database drivers are also optional peer dependencies.

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
});
```

### 2. Define a Model

```js
const users = model(
  db,
  "users",
  {
    name: "required|string",
    email: "required|string",
    age: "required|integer",
    meta: "object",
  },
  "id",
  ["email"],
  { safeDelete: "is_deleted" },
);
```

Schema types: `string`, `integer`, `numeric`, `object`. Prefix with `required|` to enforce on insert/update.

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
| POST   | `/users/:id` | Insert a single record          |
| PUT    | `/users/:id` | Update a single record          |
| PATCH  | `/users/:id` | Partial update (changed fields) |
| DELETE | `/users/:id` | Delete a single record          |
| GET    | `/users/`    | List with pagination            |
| POST   | `/users/`    | Bulk insert (`{ data: [...] }`) |
| PUT    | `/users/`    | Bulk update (`{ data: [...] }`) |
| DELETE | `/users/`    | Bulk delete                     |

### 4. Payload Override

Inject values from the request into every payload (useful for multi-tenant apps):

```js
app.use("/users", route(users, { user_id: "user.user_id" }));
```

## Model API

All model methods are async.

### insert / update / patch / upsert

```js
const user = await users.insert({ name: "Alice", email: "a@b.com", age: 30 });
const bulk = await users.insert({ data: [{ ... }, { ... }] });
const updated = await users.update({ id: 1, name: "Alice V2", email: "a@b.com", age: 31 });
const patched = await users.patch({ id: 1, age: 35 }); // partial — only updates age
```

### byId / find / findOne / list

```js
await users.byId(1); // record or null
await users.find({ name: "Alice" }); // { data: [...], count }
await users.findOne({ email: "a@b.com" }); // record or false
await users.list({ page: 0, size: 10, sort: ["-age"] }); // { data: [...], count }
```

### remove

```js
await users.remove(1);
await users.remove({ name: "Bob" });
```

## Filter System

Structure: `[OR_groups[AND_conditions[column, operator, value]]]`

Operators: `=`, `like`, `not like`, `in`, `not in`, `<`, `>`, `<=`, `>=`, `!=`

```js
// Alice AND age 30
await db.get("users", [
  [
    ["name", "=", "Alice"],
    ["age", "=", 30],
  ],
]);

// Alice OR age > 30
await db.get("users", [[["name", "=", "Alice"]], [["age", ">", 30]]]);
```

## Switching Adapters

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

The model and route APIs remain identical across all adapters.

## CLI Tools

### generate-app

Scaffolds a complete Express REST API from an existing database.

```bash
rest-router-generate-app --type mysql --env .env
rest-router-generate-app --type sqlite3 --database ./myapp.db --output ./my-api
rest-router-generate-app --type postgres --env .env --tables users,posts,posts.comments
```

Creates: `app.js`, `models/`, `routes/`, `middleware/logger.js`, `.env.example`, `openapi.json`

### generate-model

Introspects DB → generates model files with auto-detected PK, unique indexes, timestamps, soft-delete.

```bash
rest-router-generate-model --type mysql --env .env --output ./models [--tables users,posts]
```

### generate-route

Generates route files + OpenAPI spec from models. Supports parent-child via dot notation.

```bash
rest-router-generate-route --models ./models --output ./routes [--tables posts,posts.comments]
```

`posts.comments` → nested route `posts/:post_id/comments` with FK scoping.

## License

Apache-2.0

## LLM Skill Reference

For AI/LLM integration, see the [Skill Reference](./SKILL.md).
