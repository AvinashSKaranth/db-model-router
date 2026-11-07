# MySQL Adapter Reference

Uses `mysql2` driver with connection pooling.

## Connection Config

```js
init("mysql");
db.connect({
  host: process.env.MYSQL_HOST || "localhost",
  port: parseInt(process.env.MYSQL_PORT || "3306"),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "password",
  database: process.env.MYSQL_DB || "test_db",
});
```

## Features & Behavior

- Identifiers quoted with MySQL backticks via `db.escapeId()`.
- Placeholders: `??` for table/column identifiers, `?` for values.
- JSON: Native binary JSON (`MYSQL_TYPE_JSON` = 245) supported directly.
- Upsert: Uses `INSERT ... ON DUPLICATE KEY UPDATE` with fallback to `INSERT IGNORE` when update columns are empty.
