# SQLite3 Adapter

Uses [better-sqlite3](https://www.npmjs.com/package/better-sqlite3) for synchronous, high-performance SQLite access.

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("sqlite3");

db.connect({ database: "./data.db" });
// or in-memory:
db.connect({ database: ":memory:" });
```

## Options

| Option          | Description                 |
| --------------- | --------------------------- |
| `database`      | File path or `:memory:`     |
| `readonly`      | Open in read-only mode      |
| `fileMustExist` | Throw if file doesn't exist |

## Notes

- All operations are synchronous (wrapped to match the async model API)
- WAL journal mode is enabled by default for better concurrency
- Uses `INSERT OR IGNORE` for conflict handling
- `ON CONFLICT ... DO UPDATE SET` for upsert
- No Docker container needed — runs in-process

## Table Creation

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  age INTEGER NOT NULL
);
```

[← Back to main docs](../README.md)
