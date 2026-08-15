# Field-Level Encryption

`db-model-router` supports transparent field-level encryption (AES-256-GCM). Mark any column — or a nested JSON key inside an `object` column — with the `encrypted` flag in a column rule, and the runtime automatically encrypts it on write and decrypts it on read. Existing data (legacy plaintext) passes through reads unchanged, and two CLI commands (`encrypt:scan`, `encrypt:rotate-key`) handle backfill and key rotation.

---

## How It Works

- **Algorithm:** `aes-256-gcm` with a fresh random 12-byte IV per value and a 16-byte authentication tag. Tampered ciphertext fails decryption with an error.
- **Envelope format:** values are stored as `enc:v<N>:<base64(iv + ciphertext + tag)>` where `N` is the key version.
- **NULL / missing values** are never encrypted and are not touched.
- **Typed round-trip:** integers, numbers, booleans, and datetimes are serialized before encryption and restored to their native type after decryption.
- **Side-effect-free reads:** a value that is not an envelope (`enc:...`) is returned as-is. Reads never rewrite data, so old plaintext keeps working until you run `encrypt:scan --apply`.
- **Config is resolved once** at `db.init()` time and reused for every operation.

---

## Schema Declaration

### Whole Column

Prefix any **encryptable type** column rule with `encrypted`:

```json
{
  "columns": {
    "ssn": "encrypted|required|string",
    "account_number": "encrypted|string",
    "salary": "encrypted|numeric",
    "birth_date": "encrypted|datetime",
    "is_pii": "encrypted|boolean"
  }
}
```

> **Order matters:** the `encrypted` token must come **before** `required` (e.g. `encrypted|required|string`). `required|encrypted|string` is rejected by the schema validator.

### Encryptable Types

Only these base types may carry the `encrypted` flag:

| Type      | Notes                                            |
| --------- | ------------------------------------------------ |
| `string`  | Default                                          |
| `integer` | Restored as integer on read                      |
| `numeric` | Restored as float on read                        |
| `boolean` | Restored as boolean on read                      |
| `datetime`| Stored/restored as a `YYYY-MM-DD HH:mm:ss` string |

`object` and `auto_increment` columns **cannot** be encrypted directly. Use dotted JSON-key encryption (below) for `object` columns.

### Dotted JSON Key (inside an `object` column)

To encrypt only part of a JSON object, declare the parent as `object` and encrypt individual keys with dot notation:

```json
{
  "columns": {
    "profile": "object",
    "profile.dob": "encrypted|required|datetime",
    "profile.ssn": "encrypted|string",
    "profile.nickname": "string"
  }
}
```

Rules for dotted fields:

1. The parent column **must** be declared as `object` (or `required|object`).
2. At most **one level** of dot nesting is allowed (`profile.dob`, not `a.b.c`).
3. Dotted keys can be encrypted **or** plain (mixed within the same object).
4. Dotted keys are **validation-only entries** — no extra SQL column is created, and the whole object is still stored as a single JSON value.
5. `pk`, `unique`, `softDelete`, and `search_columns` may **never** reference a dotted field.

---

## Key Configuration

### Key References

Keys are resolved from a reference string:

| Reference              | Resolution                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `env:VAR_NAME`         | `sha256(process.env.VAR_NAME)` — recommended; keeps keys out of the schema |
| raw base64 (32 bytes)  | Decoded directly as the AES key                                            |
| any other string       | `sha256(string)`                                                           |

> **Note:** any base64-looking string that decodes to a length other than 32 bytes falls back to `sha256`. To pin an exact key, always use `env:` or a string that is exactly 32 bytes after base64-decoding.

### `options.encryption` (schema + generated projects)

```json
{
  "adapter": "postgres",
  "framework": "express",
  "options": {
    "encryption": {
      "key": "env:ENC_KEY",
      "version": 1,
      "keys": {
        "1": "env:ENC_KEY"
      }
    }
  },
  "tables": { ... }
}
```

| Field     | Required | Description                                                                                          |
| --------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `key`     | Yes      | Reference to the **active** encryption key (`env:VAR` or a base64 key).                              |
| `version` | Yes      | Positive integer version tag written into every new envelope.                                        |
| `keys`    | No       | Keyring for **read** decryption — maps each historical version to its key reference. Add old keys here during rotation. |

### Runtime (`db.init`)

Pass the same block as the `encryption` member of the `db.init` config:

```js
const { init, db, model, route } = require("db-model-router");

init("postgres", {
  encryption: {
    key: "env:ENC_KEY",
    version: 1,
    keys: { 1: "env:ENC_KEY" },
  },
});

db.connect({ host, port: 5432, user, password, database });
```

- If a model declares encrypted fields but **no** encryption config was given to `db.init()`, the model factory throws a descriptive error.
- If config is present but a model has no encrypted fields, the model is unaffected.
- `keys` is optional at runtime but **required during rotation** if you still have data encrypted under an older version (otherwise reads of those rows fail with `No key available for encryption version vN`).

---

## Runtime Behavior

Once configured, encryption is fully transparent through the universal model API:

```js
const users = model(db, "users", { ssn: "encrypted|required|string" }, "id", ["id"]);

await users.insert({ ssn: "123-45-6789" });
// DB stores: "enc:v1:..."   (plaintext never touches disk)
await users.byId(1);        // → { id: 1, ssn: "123-45-6789" }
```

- **Write paths** (`insert`, `update`, `patch`, `upsert`, bulk variants): payload fields are encrypted before hitting the adapter.
- **Read paths** (`byId`, `find`, `findOne`, `list`, plus `patch`/`upsert` return values): stored envelopes are decrypted and type-restored.
- **Validation still applies** to the plaintext value: the `encrypted` token is stripped from the rule before `node-input-validator` sees it, so `required`, `minLength`, `email`, etc. all behave normally.
- **Filters/search cannot target encrypted fields** — encrypted values are opaque ciphertext, so you cannot `?ssn=123-45-6789`, `search`, sort, or filter on them. Query by other (non-encrypted) columns.

---

## CLI Workflows

### `encrypt:scan` — find and backfill plaintext

`encrypt:scan` scans every table with an encrypted field and reports how many stored values are still plaintext vs. already encrypted vs. null.

```bash
# Report only
db-model-router encrypt:scan --type sqlite3 --env .env

# Backfill (encrypt) everything unencrypted
db-model-router encrypt:scan --type postgres --env .env --apply

# Dry run — preview what --apply would change
db-model-router encrypt:scan --type sqlite3 --env .env --apply --dry-run

# Limit to specific tables
db-model-router encrypt:scan --type postgres --env .env --apply --tables users,orders

# Machine-readable output
db-model-router encrypt:scan --type sqlite3 --env .env --apply --json
```

| Flag             | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `--type`         | Database adapter (required): `mysql`, `postgres`, `sqlite3`, ... |
| `--from <path>`  | Schema file (default: `dbmr.schema.json`)                       |
| `--env <path>`   | Path to `.env` for DB credentials                               |
| `--tables <list>`| Comma-separated table filter (default: all)                     |
| `--key <ref>`    | Override the active key reference                               |
| `--version <n>`  | Override the active key version                                 |
| `--keys <json>`  | Override the keyring map (JSON, e.g. `{"1":"env:ENC_KEY"}`)     |
| `--apply`        | Encrypt unencrypted values found (default: report only)         |
| `--dry-run`      | Preview what `--apply` would change without writing             |
| `--json`         | Machine-readable output                                         |

`--json` output shape: `{ "reports": [...], "applied": [...], "failures": [] }`.

### `encrypt:rotate-key` — re-encrypt under a new key version

Rotation reads with the **old** keyring and writes every envelope under a **new** key/version. Envelopes already at the target version are left untouched.

```bash
# Rotate everything to v2 with a new key
db-model-router encrypt:rotate-key --type sqlite3 --env .env --to 2 --new-key env:NEW_ENC_KEY

# Dry run + JSON
db-model-router encrypt:rotate-key --type postgres --env .env --to 3 --dry-run --json
```

| Flag              | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `--type`          | Database adapter (required)                                                 |
| `--to <n>`        | Target key version (required, positive integer)                             |
| `--new-key <ref>` | New key reference (default: `options.encryption.key`)                       |
| `--key <ref>`     | Old/active key reference used to read current data (default: `options.encryption.key`) |
| `--keys <json>`   | **OLD** keyring map — must include every version currently encrypting data (default: `options.encryption.keys`) |
| `--from <path>`   | Schema file (default: `dbmr.schema.json`)                                   |
| `--env <path>`    | Path to `.env` for DB credentials                                           |
| `--tables <list>` | Comma-separated table filter (default: all)                                 |
| `--dry-run`       | Preview what would change without writing                                   |
| `--json`          | Machine-readable output                                                     |

**After rotation, update the schema** so future writes use the new key and old envelopes remain readable:

```json
{
  "options": {
    "encryption": {
      "key": "env:NEW_ENC_KEY",
      "version": 2,
      "keys": {
        "1": "env:OLD_ENC_KEY",
        "2": "env:NEW_ENC_KEY"
      }
    }
  }
}
```

Then update the runtime `db.init` config to match. Run `db-model-router doctor` to verify.

**Important:** the CLI commands do not modify `dbmr.schema.json` — you bump `version`/`key`/`keys` yourself. Records whose envelopes can't be decrypted (e.g. missing old key) are reported per `pk`/`field` in the output and left untouched; the rest of the batch still proceeds.

---

## Envelope & Key Details

- **Version tag:** an integer in the envelope identifies which keyring entry decrypts it. Storing the version in-band is what makes the multi-key keyring work.
- **Key derivation:** `sha256(secret)` produces a 32-byte AES-256 key. Use `env:` refs to keep secrets out of schema files and out of the repo.
- **Failure modes:**
  - Decrypting with the wrong key → GCM authentication failure (throws).
  - Envelope version with no keyring entry → `No key available for encryption version vN`.
  - Malformed envelope → `Value is not an encrypted envelope`.
  - Marking `object`/`auto_increment` (or a missing type) as `encrypted` → the field is left in plaintext and a warning is printed to stderr (`WARNING: field "x" is marked "encrypted" but type "y" cannot be encrypted; storing plaintext`). The schema validator rejects these at schema level; the warning mainly surfaces for direct programmatic `model()` usage.

---

## Batch Processing Details

- Both CLI commands page through tables with keyset pagination on the primary key (offset fallback for composite/none), 1000 rows per page.
- Mutated rows are flushed to the DB in **1000-row** `db.upsert` batches.
- JSON object columns holding encrypted dotted keys are stringified once by the same `jsonStringify` helper the model write path uses (no manual re-stringification; plain string columns pass through untouched).
- `--dry-run` runs the full scan/decrypt/encrypt pipeline but discards the batches (no writes, no errors).

---

## Limitations

- **Encrypted fields are not filterable/searchable/sortable.** Opaque ciphertext defeats `=`, `LIKE`, `search=`, ordering, and range queries.
- **No unique constraints on encrypted columns.** Uniqueness must be enforced on a non-encrypted column (or the whole encrypted value, which is not user-friendly).
- **`object` columns encrypt per-key** (via dotted declarations), never the whole column at once.
- **One dot level** of dotted-key nesting.
- Envelope ciphertext is stored as text; storage size grows by IV + tag + base64 overhead (~+33–50%).
- The schema validator and `doctor` catch misconfiguration (encrypted on a non-encryptable type, `encrypted` after `required`, dotted field without an `object` parent, encrypted fields with no `options.encryption`), but they cannot verify the key itself is correct — wrong keys only surface at runtime as decrypt failures.
