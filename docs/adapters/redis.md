# Redis Adapter

Uses [ioredis](https://www.npmjs.com/package/ioredis). Records are stored as Redis hashes with key pattern `{table}:{id}`.

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("redis");

db.connect({
  host: "localhost",
  port: 6379,
  password: "", // optional
  db: 0, // Redis DB index, optional
  primaryKey: "id", // field used as the hash key suffix
});
```

## Environment Variables

```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Notes

- Each record is a Redis hash at key `{table}:{primaryKey}`
- Auto-incrementing IDs use `INCR {table}:__seq`
- All filtering, sorting, and pagination happen in-memory (full SCAN)
- Redis stores all values as strings — numeric coercion is applied on read
- Nested objects are JSON-serialized into hash fields
- Best suited for small-to-medium datasets where Redis is already in the stack

## Model Definition

```js
const users = model(
  db,
  "users",
  {
    id: "string",
    name: "required|string",
    email: "required|string",
    age: "required|integer",
  },
  "id",
  ["id"],
);
```

[← Back to main docs](../README.md)
