# Oracle Adapter

Uses [oracledb](https://www.npmjs.com/package/oracledb) (Oracle Instant Client required).

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("oracle");

db.connect({
  host: "localhost",
  port: 1521,
  database: "XEPDB1",
  user: "system",
  password: "oracle",
});
```

## Environment Variables

```env
ORACLE_HOST=localhost
ORACLE_PORT=1521
ORACLE_DB=XEPDB1
ORACLE_USER=system
ORACLE_PASSWORD=oracle
```

## Notes

- Requires Oracle Instant Client installed on the host
- Uses connection pooling with session callbacks for NLS date format
- MySQL-style `?` placeholders are auto-translated to `:1, :2, ...`
- Includes a SQL translator that converts MySQL DDL/DML to Oracle syntax
- `MERGE INTO ... USING DUAL` is used for upsert operations
- `RETURNING ... INTO :pk_out` is used to retrieve auto-generated IDs
- Oracle reserved words in column names are auto-quoted
- `CLOB` values are fetched as strings

## Table Creation

```sql
CREATE TABLE users (
  id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR2(255) NOT NULL,
  email VARCHAR2(255) NOT NULL,
  age NUMBER NOT NULL
);
```

[← Back to main docs](../../README.md)
