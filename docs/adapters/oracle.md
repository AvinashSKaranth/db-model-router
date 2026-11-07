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
- Clean native Oracle SQL execution with `:1, :2, ...` positional bind variables
- Supports MySQL-style `?` placeholders in raw `db.query()` calls (auto-translated outside string literals)
- Native parameterized `MERGE INTO ... USING (SELECT ... FROM DUAL)` is used for upsert operations
- `RETURNING ... INTO :pk_out` is used to retrieve auto-generated IDs
- All table and column identifiers are securely quoted with `escapeId()`
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
