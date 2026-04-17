# CockroachDB Adapter

Uses the [pg](https://www.npmjs.com/package/pg) driver (CockroachDB is PostgreSQL wire-compatible).

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("cockroachdb");

db.connect({
  host: "localhost",
  port: 26257,
  database: "defaultdb",
  user: "root",
  password: "",
});
```

## Environment Variables

```env
CRDB_HOST=localhost
CRDB_PORT=26257
CRDB_NAME=defaultdb
CRDB_USER=root
CRDB_PASS=
```

## Notes

- `SERIAL` columns use CockroachDB's `unique_rowid()` which generates INT8 values
- Large INT8 values that exceed `Number.MAX_SAFE_INTEGER` are kept as strings to preserve precision
- Includes automatic retry logic for transient connection errors
- Uses `ON CONFLICT` for upsert operations
- Run with `--insecure` flag for local development (see docker-compose.yml)

## Table Creation

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR NOT NULL,
  age INTEGER NOT NULL
);
```

[← Back to main docs](../README.md)
