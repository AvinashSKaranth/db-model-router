# MSSQL (SQL Server) Adapter

Uses the [mssql](https://www.npmjs.com/package/mssql) driver with tedious.

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("mssql");

await db.connect({
  server: "localhost",
  port: 1433,
  database: "master",
  user: "sa",
  password: "Password123!",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
});
```

Note: `db.connect()` is async for MSSQL — use `await`.

## Environment Variables

```env
MSSQL_HOST=localhost
MSSQL_PORT=1433
MSSQL_DB=master
MSSQL_USER=sa
MSSQL_PASSWORD=Password123!
```

## Notes

- Column names are escaped with `[brackets]`
- Uses `MERGE` statements for upsert operations
- IDENTITY columns are auto-excluded from INSERT in MERGE statements
- Pagination uses `OFFSET ... ROWS FETCH NEXT ... ROWS ONLY`
- `OUTPUT INSERTED.*` is used to return inserted rows

## Table Creation

```sql
CREATE TABLE users (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(255),
  email NVARCHAR(255),
  age INT
);
```

[← Back to main docs](../../README.md)
