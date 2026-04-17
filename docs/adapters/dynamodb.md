# DynamoDB Adapter

Uses [@aws-sdk/client-dynamodb](https://www.npmjs.com/package/@aws-sdk/client-dynamodb) and [@aws-sdk/lib-dynamodb](https://www.npmjs.com/package/@aws-sdk/lib-dynamodb).

## Connection

```js
const { init, db, model, route } = require("db-model-router");
init("dynamodb");

db.connect({
  region: "us-east-1",
  // For local development (DynamoDB Local):
  endpoint: "http://localhost:8000",
  accessKeyId: "fakeAccessKey",
  secretAccessKey: "fakeSecretKey",
  primaryKey: "id",
});
```

## Environment Variables

```env
DYNAMODB_HOST=localhost
DYNAMODB_PORT=8000
DYNAMODB_REGION=us-east-1
DYNAMODB_ACCESS_KEY=fakeAccessKey
DYNAMODB_SECRET_KEY=fakeSecretKey
```

## Notes

- Tables must be created beforehand (the adapter does not create tables)
- Auto-generates UUID primary keys for records missing the PK field
- Filter operators are mapped to DynamoDB FilterExpression syntax
- `like` uses `contains()`, `in` uses `IN ()`
- All filtering and pagination happen via `Scan` with in-memory post-processing
- Batch writes are chunked into groups of 25 (DynamoDB limit)
- `UpdateCommand` is used for upsert operations
- Best suited for serverless / AWS-native architectures

## Table Creation (AWS CLI)

```bash
aws dynamodb create-table \
  --table-name users \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000
```

[← Back to main docs](../README.md)
