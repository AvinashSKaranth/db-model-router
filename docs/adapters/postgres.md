# PostgreSQL Adapter

Uses the [pg](https://www.npmjs.com/package/pg) driver with connection pooling.

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("postgres");

db.connect({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "password",
  database: "my_app",
  connectionLimit: 50, // pool max
  dateStrings: false, // set true to return dates as strings
});
```

## Environment Variables

```env
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=password
PG_DB=test_db
```

## Notes

- Supports MySQL-style `?` placeholders in raw `db.query()` calls — they are auto-translated to `$1, $2, ...`
- `SERIAL` / `BIGSERIAL` primary keys are auto-detected via `pg_index`
- `ON CONFLICT` is used for upsert operations
- Includes a SQL translator layer that converts common MySQL DDL/DML to PostgreSQL syntax

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
