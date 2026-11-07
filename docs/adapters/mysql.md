# MySQL Adapter

Uses the [mysql2](https://www.npmjs.com/package/mysql2) driver with connection pooling.

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("mysql");

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
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DB=my_app
```

## Notes

- Uses MySQL backtick identifier escaping (`??`) and parameterized value placeholders (`?`).
- Supports native binary JSON data types (`MYSQL_TYPE_JSON` = 245).
- Upserts utilize `ON DUPLICATE KEY UPDATE` with automatic handling for composite unique keys and fallback to `INSERT IGNORE` when no mutable non-key columns exist.
- Soft delete support via `safeDelete` option seamlessly integrates without in-place filter mutations.

## Table Creation

```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  age INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
