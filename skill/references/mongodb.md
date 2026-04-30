# MongoDB Adapter

Uses the official [mongodb](https://www.npmjs.com/package/mongodb) Node.js driver.

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("mongodb");

db.connect({
  host: "localhost",
  port: 27017,
  database: "my_app",
  // or with auth:
  username: "admin",
  password: "secret",
  // or with a full URI:
  uri: "mongodb://admin:secret@localhost:27017",
});
```

## Environment Variables

```env
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=test_db
```

## Notes

- Primary key is `_id` (MongoDB's default ObjectId)
- String `_id` values matching the 24-char hex format are auto-converted to `ObjectId`
- Filter operators are mapped to MongoDB query operators (`$eq`, `$regex`, `$in`, etc.)
- `like` uses `$regex` with case-insensitive matching
- No schema/table creation needed — collections are created on first insert

## Model Definition

```js
const users = model(
  db,
  "users",
  {
    _id: "string",
    name: "required|string",
    email: "required|string",
    age: "required|integer",
  },
  "_id",
  ["_id"],
);
```

[← Back to main docs](../../README.md)
