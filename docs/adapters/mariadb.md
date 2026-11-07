# MariaDB Adapter

Uses the [mysql2](https://www.npmjs.com/package/mysql2) wire-protocol connection pool.

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("mariadb");

db.connect({
  host: "localhost",
  port: 3306,
  user: "root",
  password: "password",
  database: "my_app",
  connectionLimit: 10,
});
```

## Environment Variables

```env
MARIADB_HOST=localhost
MARIADB_PORT=3306
MARIADB_USER=root
MARIADB_PASSWORD=password
MARIADB_DB=my_app
```

## Notes

- Dedicated adapter distinct from MySQL, catering to MariaDB-specific syntax and datatypes.
- **JSON Handling**: MariaDB treats `JSON` as an alias for `LONGTEXT ... CHECK (JSON_VALID(col))` (wire type 252). `db-model-router` automatically normalizes and parses JSON columns into native JavaScript objects through `jsonSafeParse()`.
- **Upsert Syntax**: MariaDB uses `?? = VALUES(??)` in `ON DUPLICATE KEY UPDATE` (MariaDB does not support MySQL 8's `AS new_row` alias syntax).
- Native support for ANSI SQL sequences (`CREATE SEQUENCE`) and 128-bit `UUID` columns (10.7+).

## Table Creation

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  age INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
