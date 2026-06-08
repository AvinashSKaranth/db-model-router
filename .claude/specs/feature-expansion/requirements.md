# Feature Expansion Requirements

## 1. Field Selection (select_columns)

- Add `select_columns` query param support to model's find, findOne, list, byId methods
- Format: `select_columns=name,email,age` (comma-separated column names)
- Strip `select_columns` from filter payload before processing
- Apply column projection to returned data (filter object keys)

## 2. Output Content Type (output_content_type)

- Add `output_content_type` query param: json (default), csv, xml
- Strip `output_content_type` from filter payload before processing
- JSON: current behavior
- CSV: return text/csv with header row + data rows
- XML: return application/xml with simple element structure
- Apply to list, find, byId route responses

## 3. Partial Update (PATCH)

- Add `patch` method to model that only validates/updates provided fields (no required check)
- Add PATCH /:id route endpoint
- Unlike update(), patch() should not require all fields — only the ones being changed + PK

## 4. CLI --tables Filter

- Add `--tables` flag to generate-model and generate-route
- Format: `--tables users,posts,orders,posts.comments`
- Dot notation = parent.child relationship (posts.comments → /posts/:post_id/comments)
- When --tables is not provided, use FK introspection to auto-detect parent-child
- `--exclude-parents` flag to list tables that should NOT be treated as parents (e.g., users)

## 5. Optional db Param on model()

- Make first param detection: if first arg is string → it's the table name, use internal db singleton
- If first arg is object → it's the db instance (backward compatible)

## 6. generate-app CLI

- Creates full app scaffold: app.js, models/, routes/, middleware/logger.js, migrations/, sessions/
- app.js: express setup, init, connect, mount routes, error handler
- .env.example with all DB config vars
- middleware/logger.js: simple request logger

## 7. OpenAPI/Swagger Generation

- Generate openapi.json from introspected models
- Include paths for all CRUD endpoints per table
- Include schema definitions from modelStructure
- Output alongside routes

## 8. Tests

- Test field selection, output format, PATCH in sqlite3 adapter tests
- Test CLI --tables filter
- Test optional db param
- Test generate-app output
