# rest-router

A database-agnostic REST API generator for Node.js. Works with Express or ultimate-express (a high-performance drop-in replacement). Define a model, get a full CRUD API with filtering, pagination, and bulk operations — backed by any of 9 supported databases.

## Supported Adapters

| Adapter                                       | Module Key    | Driver                   | Install                                                                |
| --------------------------------------------- | ------------- | ------------------------ | ---------------------------------------------------------------------- |
| [MySQL](#mysql-example)                       | `mysql`       | mysql2                   | `npm i db-model-router mysql2`                                         |
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

This creates 8 endpoints:

| Method | Path         | Description                     |
| ------ | ------------ | ------------------------------- |
| GET    | `/users/:id` | Get one record by PK            |
| POST   | `/users/add` | Insert a single record          |
| PUT    | `/users/:id` | Update a single record          |
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

## CLI Tools

Three CLI commands are included to scaffold models, routes, and full apps from an existing database.

### generate-app

The fastest way to go from database to running API. Scaffolds a complete Express REST API project in a single command — introspects your database, generates models and routes (including parent-child relationships), and creates the app entry point, middleware, environment config, and project structure.

```bash
# Full app from MySQL
rest-router-generate-app --type mysql --env .env

# SQLite3 into a specific directory
rest-router-generate-app --type sqlite3 --database ./myapp.db --output ./my-api

# Postgres with specific tables and relationships
rest-router-generate-app --type postgres --env .env --tables users,posts,posts.comments
```

Options:

| Option       | Description                                                                     |
| ------------ | ------------------------------------------------------------------------------- |
| `--type`     | Database type (mysql, postgres, sqlite3, mssql, oracle, cockroachdb) [required] |
| `--output`   | Output directory (default: current directory)                                   |
| `--host`     | Database host                                                                   |
| `--port`     | Database port                                                                   |
| `--database` | Database name or file path                                                      |
| `--user`     | Database user                                                                   |
| `--password` | Database password                                                               |
| `--schema`   | Schema name (postgres only)                                                     |
| `--tables`   | Comma-separated tables, supports `parent.child` notation for relationships      |
| `--env`      | Path to .env file for DB connection                                             |

Generated project structure:

```
my-api/
  app.js              # Express app with init(), db.connect(), middleware, error handler, health check
  .env.example         # Pre-filled environment template for your DB type
  .gitignore           # node_modules, .env, *.db
  middleware/
    logger.js          # Request logger (method, URL, status, response time)
  models/
    users.js           # Auto-generated from DB introspection
    posts.js
    index.js
  routes/
    users.js           # Auto-generated route files
    posts.js
    index.js
    openapi.json       # OpenAPI 3.0 spec
  migrations/
    README.md          # Placeholder for migration scripts
  sessions/
    README.md          # Placeholder for session config
```

When `--tables` includes parent-child notation (e.g., `posts.comments`), the routes directory also includes scoped child route files and nested route mounting — see [Parent-Child Relationships](#parent-child-relationships-foreign-keys) below.

To start the generated app:

```bash
cp .env.example .env   # edit with your DB credentials
npm install
node app.js
```

### generate-model

Connects to your database, introspects all tables, and generates model files with validation rules, primary keys, unique constraints, and auto-detected options (safeDelete, timestamps). This is called automatically by `generate-app`, but can be used standalone.

```bash
# Basic usage
rest-router-generate-model --type mysql --host localhost --database mydb --user root --password secret

# Using an .env file
rest-router-generate-model --type postgres --env .env --output ./src/models

# SQLite3
rest-router-generate-model --type sqlite3 --database ./myapp.db --output ./models

# Only specific tables
rest-router-generate-model --type mysql --env .env --tables users,posts,comments
```

Options:

| Option       | Description                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| `--type`     | Database type (mysql, postgres, sqlite3, mssql, oracle, cockroachdb)          |
| `--host`     | Database host (default: localhost)                                            |
| `--port`     | Database port                                                                 |
| `--database` | Database name (or file path for sqlite3)                                      |
| `--user`     | Database user                                                                 |
| `--password` | Database password                                                             |
| `--schema`   | Schema name (postgres only, default: public)                                  |
| `--output`   | Output directory (default: ./models)                                          |
| `--tables`   | Comma-separated list of tables to generate (supports `parent.child` notation) |
| `--env`      | Path to .env file to load                                                     |

Auto-detection:

- Columns with `DEFAULT` values are marked as optional (not `required`)
- Timestamp columns (`created_at`, `updated_at`, `modified_at`, `createdAt`, etc.) are excluded from the model structure and added to the option object
- Soft-delete columns (`is_deleted`, `deleted`, `is_active`, `archived`, etc.) are excluded from the structure and set as `safeDelete` in the option
- Multi-column unique indexes are correctly grouped for the unique constraint parameter

Generated output:

```
models/
  users.js          # model(db, "users", {...}, "user_id", ["email"], { safeDelete: "is_deleted", ... })
  posts.js          # model(db, "posts", {...}, "post_id", ["post_id"])
  index.js          # exports { users, posts }
```

### generate-route

Generates Express route files for each model. If models don't exist yet, it auto-generates them first. Also generates an OpenAPI 3.0 spec (`openapi.json`) from the model metadata. This is called automatically by `generate-app`, but can be used standalone.

```bash
# From existing models
rest-router-generate-route --models ./models --output ./routes

# Auto-generate models + routes in one step
rest-router-generate-route --type mysql --env .env --models ./models --output ./routes

# SQLite3 one-liner
rest-router-generate-route --type sqlite3 --database ./myapp.db
```

Options:

| Option       | Description                                                                |
| ------------ | -------------------------------------------------------------------------- |
| `--models`   | Path to models directory (default: ./models)                               |
| `--output`   | Output directory for routes (default: ./routes)                            |
| `--type`     | Database type — triggers model generation if models are missing            |
| `--host`     | Database host (passed to model generation)                                 |
| `--port`     | Database port (passed to model generation)                                 |
| `--database` | Database name or file path (passed to model generation)                    |
| `--user`     | Database user (passed to model generation)                                 |
| `--password` | Database password (passed to model generation)                             |
| `--schema`   | Schema name (passed to model generation)                                   |
| `--tables`   | Comma-separated tables, supports `parent.child` notation for relationships |
| `--env`      | Path to .env file (passed to model generation)                             |

#### Parent-Child Relationships (Foreign Keys)

Use dot notation in `--tables` to declare parent-child relationships. This works in `generate-route`, `generate-app`, and `generate-model`. The generator creates nested routes that automatically scope child queries by the parent's foreign key.

```bash
# Declare that comments belong to posts
rest-router-generate-route --type mysql --env .env --tables users,posts,posts.comments

# Same via generate-app
rest-router-generate-app --type mysql --env .env --tables users,posts,posts.comments
```

The FK column is derived by convention: `<parent_singular>_id` (e.g., `posts.comments` → `post_id`).

This generates:

```
routes/
  users.js                        # route(users)
  posts.js                        # route(posts)
  comments.js                     # route(comments)  — direct access
  comments_child_of_posts.js      # route(comments, { post_id: "params.post_id" })  — scoped
  index.js                        # mounts all routes
  openapi.json                    # OpenAPI 3.0 spec
```

The generated `index.js` mounts both nested and top-level routes:

```js
// Nested: GET /api/posts/:post_id/comments — returns only comments for that post
router.use("/posts/:post_id/comments", commentsChildRoute);

// Direct: GET /api/comments — returns all comments
router.use("/comments", commentsRoute);
```

The child route file uses payload override to scope every query:

```js
// comments_child_of_posts.js
module.exports = route(comments, { post_id: "params.post_id" });
```

#### Generated output (without relationships)

```
routes/
  users.js          # route(users)
  posts.js          # route(posts)
  index.js          # express.Router() mounting all routes at /users, /posts, etc.
  openapi.json      # OpenAPI 3.0 spec
```

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
