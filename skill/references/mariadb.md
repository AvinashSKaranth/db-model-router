# MariaDB Adapter Reference

Uses `mysql2` wire-protocol connection pool with MariaDB-specific dialect handling.

## Connection Config

```js
init("mariadb");
db.connect({
  host: process.env.MARIADB_HOST || "localhost",
  port: parseInt(process.env.MARIADB_PORT || "3306"),
  user: process.env.MARIADB_USER || "root",
  password: process.env.MARIADB_PASSWORD || "password",
  database: process.env.MARIADB_DB || "test_db",
});
```

## Features & Behavior

- Identifiers quoted with backticks via `db.escapeId()`.
- Placeholders: `??` for table/column identifiers, `?` for values.
- JSON: Stored as `LONGTEXT ... CHECK (JSON_VALID(col))`; automatically parsed to JS objects via `jsonSafeParse()`.
- Upsert: Uses `?? = VALUES(??)` in `ON DUPLICATE KEY UPDATE` (MariaDB rejects MySQL 8's row aliases with error 1064).
