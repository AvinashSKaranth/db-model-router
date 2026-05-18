# dbmr.schema.json — Column Rule Specification

This document defines the full column rule syntax for `dbmr.schema.json`. Column rules are pipe-delimited strings that describe the **data type**, **sub-type**, and **validation constraints** for each column.

---

## Syntax

```
[required|]<type>[:<subtype>][|<validator>[|<validator>...]]
```

**Parts:**

| Part        | Required | Description                                                    |
| ----------- | -------- | -------------------------------------------------------------- |
| `required`  | No       | Prefix — marks column as NOT NULL                              |
| `type`      | Yes      | Base data type (see table below)                               |
| `:subtype`  | No       | Colon-suffixed sub-type for finer SQL type control             |
| `validator` | No       | One or more validation rules (node-input-validator compatible) |

**Examples:**

```
"name": "required|string"                          # VARCHAR(255) NOT NULL
"description": "string:text"                       # TEXT, nullable
"body": "required|string:longtext"                 # LONGTEXT NOT NULL
"email": "required|string|email|maxLength:255"     # VARCHAR(255) NOT NULL + email validation
"phone": "string|phoneNumber"                      # VARCHAR(255) + phone validation
"stock": "required|integer:unsigned"               # INT UNSIGNED NOT NULL
"view_count": "integer:bigint"                     # BIGINT, nullable
"price": "required|numeric:decimal(10,4)"          # DECIMAL(10,4) NOT NULL
"rating": "required|integer|min:1|max:5"           # INTEGER NOT NULL + range validation
"slug": "required|string|regex:^[a-z0-9-]+$"      # VARCHAR(255) NOT NULL + pattern validation
```

---

## Base Types

| Type             | Default SQL Type | Description                    |
| ---------------- | ---------------- | ------------------------------ |
| `auto_increment` | SERIAL / INT AI  | Auto-incrementing primary key  |
| `string`         | VARCHAR(255)     | Text/string columns            |
| `integer`        | INTEGER          | Whole number columns           |
| `numeric`        | DECIMAL(12,2)    | Decimal/floating-point columns |
| `boolean`        | BOOLEAN          | True/false columns             |
| `datetime`       | TIMESTAMP        | Date and time columns          |
| `object`         | JSON / JSONB     | JSON data columns              |

---

## Sub-Types (colon syntax)

Sub-types refine the SQL column type generated for each adapter. If no sub-type is specified, the default mapping is used.

### String Sub-Types

| Sub-Type     | MySQL / MariaDB | PostgreSQL   | SQLite3 | MSSQL            | Oracle        |
| ------------ | --------------- | ------------ | ------- | ---------------- | ------------- |
| _(default)_  | VARCHAR(255)    | VARCHAR(255) | TEXT    | NVARCHAR(255)    | VARCHAR2(255) |
| `text`       | TEXT            | TEXT         | TEXT    | NVARCHAR(MAX)    | CLOB          |
| `mediumtext` | MEDIUMTEXT      | TEXT         | TEXT    | NVARCHAR(MAX)    | CLOB          |
| `longtext`   | LONGTEXT        | TEXT         | TEXT    | NVARCHAR(MAX)    | CLOB          |
| `char`       | CHAR(255)       | CHAR(255)    | TEXT    | NCHAR(255)       | CHAR(255)     |
| `char(N)`    | CHAR(N)         | CHAR(N)      | TEXT    | NCHAR(N)         | CHAR(N)       |
| `varchar(N)` | VARCHAR(N)      | VARCHAR(N)   | TEXT    | NVARCHAR(N)      | VARCHAR2(N)   |
| `uuid`       | CHAR(36)        | UUID         | TEXT    | UNIQUEIDENTIFIER | CHAR(36)      |

**Usage:**

```json
"description": "string:text"
"content": "required|string:longtext"
"code": "string:char(10)"
"external_id": "string:uuid"
"title": "required|string:varchar(500)"
```

### Integer Sub-Types

| Sub-Type          | MySQL / MariaDB | PostgreSQL | SQLite3 | MSSQL    | Oracle     |
| ----------------- | --------------- | ---------- | ------- | -------- | ---------- |
| _(default)_       | INT             | INTEGER    | INTEGER | INT      | NUMBER(10) |
| `tinyint`         | TINYINT         | SMALLINT   | INTEGER | TINYINT  | NUMBER(3)  |
| `smallint`        | SMALLINT        | SMALLINT   | INTEGER | SMALLINT | NUMBER(5)  |
| `bigint`          | BIGINT          | BIGINT     | INTEGER | BIGINT   | NUMBER(19) |
| `unsigned`        | INT UNSIGNED    | INTEGER    | INTEGER | INT      | NUMBER(10) |
| `bigint_unsigned` | BIGINT UNSIGNED | BIGINT     | INTEGER | BIGINT   | NUMBER(19) |

**Usage:**

```json
"stock_quantity": "required|integer:unsigned"
"view_count": "integer:bigint"
"flags": "integer:tinyint"
"population": "integer:bigint_unsigned"
```

### Numeric Sub-Types

| Sub-Type       | MySQL / MariaDB | PostgreSQL       | SQLite3 | MSSQL         | Oracle        |
| -------------- | --------------- | ---------------- | ------- | ------------- | ------------- |
| _(default)_    | DECIMAL(12,2)   | DECIMAL(12,2)    | REAL    | DECIMAL(12,2) | NUMBER(12,2)  |
| `float`        | FLOAT           | REAL             | REAL    | FLOAT         | FLOAT         |
| `double`       | DOUBLE          | DOUBLE PRECISION | REAL    | FLOAT         | BINARY_DOUBLE |
| `decimal(P,S)` | DECIMAL(P,S)    | DECIMAL(P,S)     | REAL    | DECIMAL(P,S)  | NUMBER(P,S)   |
| `money`        | DECIMAL(19,4)   | MONEY            | REAL    | MONEY         | NUMBER(19,4)  |

**Usage:**

```json
"price": "required|numeric:decimal(10,4)"
"weight": "numeric:float"
"latitude": "numeric:double"
"balance": "required|numeric:money"
```

---

## Validation Rules

Validation rules are appended after the type (and optional sub-type) using the pipe `|` separator. These map directly to [node-input-validator](https://www.npmjs.com/package/node-input-validator) rules and are enforced at the API layer during insert/update operations.

### Available Validators

| Validator             | Description                              | Example                          |
| --------------------- | ---------------------------------------- | -------------------------------- |
| `email`               | Must be a valid email address            | `string\|email`                  |
| `phoneNumber`         | Must be a valid phone number             | `string\|phoneNumber`            |
| `url`                 | Must be a valid URL                      | `string\|url`                    |
| `ip`                  | Must be a valid IP address               | `string\|ip`                     |
| `minLength:N`         | Minimum string length                    | `string\|minLength:3`            |
| `maxLength:N`         | Maximum string length                    | `string\|maxLength:100`          |
| `lengthBetween:N1,N2` | String length must be between N1 and N2  | `string\|lengthBetween:3,50`     |
| `min:N`               | Minimum numeric value                    | `integer\|min:0`                 |
| `max:N`               | Maximum numeric value                    | `integer\|max:100`               |
| `between:N1,N2`       | Numeric value must be between N1 and N2  | `integer\|between:1,5`           |
| `regex:PATTERN`       | Must match the regex pattern             | `string\|regex:^[a-z0-9-]+$`     |
| `alpha`               | Only alphabetic characters               | `string\|alpha`                  |
| `alphaNumeric`        | Only alphanumeric characters             | `string\|alphaNumeric`           |
| `alphaDash`           | Alphanumeric, dashes, and underscores    | `string\|alphaDash`              |
| `in:val1,val2,...`    | Must be one of the listed values (enum)  | `string\|in:active,inactive`     |
| `notIn:val1,val2,...` | Must NOT be one of the listed values     | `string\|notIn:banned,suspended` |
| `digits:N`            | Must be exactly N digits                 | `string\|digits:6`               |
| `digitsBetween:N1,N2` | Digit count must be between N1 and N2    | `string\|digitsBetween:4,8`      |
| `dateFormat:FORMAT`   | Must match date format (e.g. YYYY-MM-DD) | `string\|dateFormat:YYYY-MM-DD`  |
| `json`                | Must be valid JSON string                | `string\|json`                   |
| `same:field`          | Must match another field's value         | `string\|same:password`          |
| `different:field`     | Must differ from another field's value   | `string\|different:old_email`    |

### Validation Rule Parsing

The parser distinguishes between **type/sub-type tokens** and **validation tokens**:

1. `required` — always a modifier (NOT NULL)
2. First non-`required` token — the **base type** (string, integer, numeric, boolean, object, datetime, auto_increment)
3. If the base type contains a colon `:` — the part after `:` is the **sub-type**
4. All remaining pipe-separated tokens — **validation rules**

**Parsing example:**

```
"required|string:text|minLength:10|maxLength:5000"
```

| Token            | Role       |
| ---------------- | ---------- |
| `required`       | Modifier   |
| `string:text`    | Type + Sub |
| `minLength:10`   | Validator  |
| `maxLength:5000` | Validator  |

Result:

- SQL: `TEXT NOT NULL`
- Validation: `{ required: true, minLength: 10, maxLength: 5000 }`

---

## Full Example Schema

```json
{
  "adapter": "postgres",
  "framework": "express",
  "options": {
    "session": "redis",
    "rateLimiting": true,
    "helmet": true,
    "logger": true,
    "loki": false
  },
  "tables": {
    "products": {
      "columns": {
        "product_id": "auto_increment",
        "category_id": "required|integer:unsigned",
        "name": "required|string:varchar(300)|minLength:3|maxLength:300",
        "slug": "required|string|regex:^[a-z0-9-]+$|maxLength:300",
        "description": "string:text|maxLength:5000",
        "short_description": "string:varchar(500)|maxLength:500",
        "sku": "required|string|alphaNumeric|minLength:3|maxLength:50",
        "price": "required|numeric:decimal(10,2)|min:0",
        "compare_at_price": "numeric:decimal(10,2)|min:0",
        "cost_price": "numeric:decimal(10,2)|min:0",
        "currency": "required|string|minLength:3|maxLength:3",
        "stock_quantity": "required|integer:unsigned|min:0",
        "low_stock_threshold": "integer:unsigned|min:0",
        "weight": "numeric:float|min:0",
        "weight_unit": "string|in:kg,lb,oz,g",
        "is_active": "boolean",
        "is_featured": "boolean",
        "is_deleted": "boolean",
        "meta": "object",
        "created_at": "datetime",
        "modified_at": "datetime"
      },
      "pk": "product_id",
      "unique": ["sku", "slug"],
      "softDelete": "is_deleted",
      "timestamps": {
        "created_at": "created_at",
        "modified_at": "modified_at"
      },
      "parent": null
    },
    "users": {
      "columns": {
        "user_id": "auto_increment",
        "name": "required|string|minLength:2|maxLength:100",
        "email": "required|string|email|maxLength:255",
        "phone": "string|phoneNumber",
        "password_hash": "required|string:varchar(500)",
        "avatar_url": "string|url",
        "bio": "string:text|maxLength:2000",
        "age": "integer|min:13|max:150",
        "role": "required|string|in:admin,user,moderator",
        "login_count": "integer:unsigned|min:0",
        "is_verified": "boolean",
        "is_deleted": "boolean",
        "last_login_ip": "string|ip",
        "metadata": "object|json",
        "created_at": "datetime",
        "modified_at": "datetime"
      },
      "pk": "user_id",
      "unique": ["email"],
      "softDelete": "is_deleted",
      "timestamps": {
        "created_at": "created_at",
        "modified_at": "modified_at"
      },
      "parent": null
    },
    "addresses": {
      "columns": {
        "address_id": "auto_increment",
        "user_id": "required|integer:unsigned",
        "label": "string|in:home,work,billing,shipping|maxLength:50",
        "line1": "required|string|minLength:5|maxLength:255",
        "line2": "string|maxLength:255",
        "city": "required|string|minLength:2|maxLength:100",
        "state": "required|string|minLength:2|maxLength:100",
        "postal_code": "required|string|minLength:3|maxLength:20",
        "country": "required|string|minLength:2|maxLength:2",
        "is_default": "boolean",
        "created_at": "datetime",
        "modified_at": "datetime"
      },
      "pk": "address_id",
      "unique": ["address_id"],
      "timestamps": {
        "created_at": "created_at",
        "modified_at": "modified_at"
      },
      "parent": null
    },
    "orders": {
      "columns": {
        "order_id": "auto_increment",
        "user_id": "required|integer:unsigned",
        "order_number": "required|string|alphaDash|maxLength:50",
        "status": "required|string|in:pending,processing,shipped,delivered,cancelled",
        "subtotal": "required|numeric:money|min:0",
        "tax_amount": "required|numeric:money|min:0",
        "shipping_amount": "required|numeric:money|min:0",
        "discount_amount": "numeric:money|min:0",
        "total": "required|numeric:money|min:0",
        "currency": "required|string|minLength:3|maxLength:3",
        "notes": "string:text|maxLength:2000",
        "created_at": "datetime",
        "modified_at": "datetime"
      },
      "pk": "order_id",
      "unique": ["order_number"],
      "timestamps": {
        "created_at": "created_at",
        "modified_at": "modified_at"
      },
      "parent": null
    }
  }
}
```

---

## How It Affects Code Generation

### Migration Generation

The sub-type controls the SQL column type in generated migrations:

```sql
-- "name": "required|string:varchar(300)|minLength:3|maxLength:300"
CREATE TABLE products (
  name VARCHAR(300) NOT NULL,
  ...
);

-- "description": "string:text|maxLength:5000"
CREATE TABLE products (
  description TEXT,
  ...
);

-- "stock_quantity": "required|integer:unsigned|min:0"
CREATE TABLE products (
  stock_quantity INT UNSIGNED NOT NULL,  -- MySQL
  stock_quantity INTEGER NOT NULL,       -- PostgreSQL (no unsigned)
  ...
);
```

### Model Generation

Validation rules are extracted and passed to the model structure for runtime enforcement:

```js
// Generated model structure
const products = model(
  db,
  "products",
  {
    name: "required|string|minLength:3|maxLength:300",
    slug: "required|string|regex:^[a-z0-9-]+$|maxLength:300",
    price: "required|numeric|min:0",
    weight_unit: "string|in:kg,lb,oz,g",
    // ...
  },
  "product_id",
  ["sku", "slug"],
  { safeDelete: "is_deleted" },
);
```

The model passes these rules to `node-input-validator` on every insert/update/patch operation. Sub-types are stripped — only the base type and validators are kept in the runtime structure.

### OpenAPI Generation

Validators map to OpenAPI schema properties:

| Validator       | OpenAPI Property                      |
| --------------- | ------------------------------------- |
| `email`         | `format: "email"`                     |
| `url`           | `format: "uri"`                       |
| `ip`            | `format: "ipv4"`                      |
| `phoneNumber`   | `pattern: "^\\+?[0-9\\s\\-\\(\\)]+$"` |
| `minLength:N`   | `minLength: N`                        |
| `maxLength:N`   | `maxLength: N`                        |
| `min:N`         | `minimum: N`                          |
| `max:N`         | `maximum: N`                          |
| `between:N1,N2` | `minimum: N1, maximum: N2`            |
| `in:a,b,c`      | `enum: ["a", "b", "c"]`               |
| `regex:PATTERN` | `pattern: "PATTERN"`                  |
| `alpha`         | `pattern: "^[a-zA-Z]+$"`              |
| `alphaNumeric`  | `pattern: "^[a-zA-Z0-9]+$"`           |
| `alphaDash`     | `pattern: "^[a-zA-Z0-9_-]+$"`         |

---

## Backward Compatibility

The new syntax is fully backward compatible:

- `"required|string"` — still works (VARCHAR(255) NOT NULL, no extra validation)
- `"integer"` — still works (INTEGER, nullable, no extra validation)
- `"string:text"` — new sub-type, no validation
- `"required|string|email"` — new validation, default sub-type
- `"required|string:text|minLength:10|maxLength:5000"` — full syntax

Existing schemas without sub-types or validators continue to work unchanged.
