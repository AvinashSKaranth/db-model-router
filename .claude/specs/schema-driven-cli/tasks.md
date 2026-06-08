# Implementation Plan: Schema-Driven CLI

## Overview

Bottom-up implementation starting with pure schema modules (no I/O, fully testable), then the bridge converter, then property-based tests for the schema layer, then infrastructure (flags, output context), then each CLI command, then the unified entry point, LLM docs, integration tests, and finally documentation updates. Each task builds on previous tasks so there is no orphaned code.

## Tasks

- [x] 1. Implement Schema Validator (`src/schema/schema-validator.js`)
  - [x] 1.1 Create `SchemaValidationError` class and `validateSchema(raw)` function
    - Define `VALID_ADAPTERS` set: `[mysql, postgres, sqlite3, mongodb, mssql, cockroachdb, oracle, redis, dynamodb]`
    - Define `VALID_FRAMEWORKS` set: `[express, ultimate-express]`
    - Define column rule regex: `/^(required\|)?(string|integer|numeric|boolean|object)$/`
    - Validate `adapter`, `framework`, `tables` (object), `relationships` (array), `options` (object)
    - Validate each column rule string against the regex
    - Validate each relationship has `parent`, `child`, `foreignKey` — all referencing existing table names
    - Validate each `unique` entry references a column in that table or the table's pk
    - Validate `softDelete` references a column in that table
    - Collect all errors as `{ path, message }` objects using dot notation paths
    - Return `{ valid: boolean, errors: [] }`
    - Export `SchemaValidationError` class with `.errors` array
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [x] 1.2 Write unit tests for schema validator
    - Test valid schema passes validation
    - Test invalid adapter returns error with path `"adapter"`
    - Test invalid framework returns error with path `"framework"`
    - Test invalid column rule returns error with column path
    - Test relationship referencing missing table returns error
    - Test unique entry referencing non-existent column returns error
    - Test softDelete referencing non-existent column returns error
    - Test multiple errors collected in single validation pass
    - _Requirements: 1.2, 1.3, 1.6, 1.7, 1.8, 1.9, 1.10_

- [x] 2. Implement Schema Parser (`src/schema/schema-parser.js`)
  - [x] 2.1 Create `parseSchema(input)` function
    - Accept JSON string or plain object as input
    - If string, `JSON.parse()` it; catch and wrap parse errors
    - Call `validateSchema()` on the raw object; throw `SchemaValidationError` if invalid
    - Normalize tables: default `pk` to `"id"` when omitted, default `unique` to `[pk]`, default `timestamps` to `{ created_at: null, modified_at: null }`, default `softDelete` to `null`
    - Return `{ adapter, framework, tables, relationships, options }` internal representation
    - _Requirements: 1.1, 1.4, 1.5, 2.2_

  - [x] 2.2 Write unit tests for schema parser
    - Test parsing a valid JSON string produces correct internal representation
    - Test parsing a plain object works identically
    - Test `pk` defaults to `"id"` when omitted
    - Test `unique` defaults to `[pk]` when omitted
    - Test invalid JSON string throws with descriptive error
    - Test invalid schema throws `SchemaValidationError`
    - _Requirements: 1.1, 1.4, 1.5_

- [x] 3. Implement Schema Printer (`src/schema/schema-printer.js`)
  - [x] 3.1 Create `printSchema(schema)` function
    - Accept the internal representation from `parseSchema()`
    - Sort tables alphabetically by name
    - Sort relationships by `[parent, child]`
    - Serialize to JSON with 2-space indentation and trailing newline
    - Preserve optional fields (`options`, `unique`, `softDelete`, `relationships`)
    - _Requirements: 2.1, 2.3, 11.3_

  - [x] 3.2 Write unit tests for schema printer
    - Test output is valid JSON with 2-space indent and trailing newline
    - Test tables are sorted alphabetically
    - Test relationships are sorted by `[parent, child]`
    - Test optional fields are preserved in output
    - _Requirements: 2.1, 2.3, 11.3_

- [x] 4. Checkpoint — Schema layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Schema-to-ModelMeta Converter (`src/schema/schema-to-meta.js`)
  - [x] 5.1 Create `schemaToModelMeta(schema)` function
    - Convert each table in the parsed schema to the `ModelMeta` format: `{ table, structure, primary_key, unique, option }`
    - Map `softDelete` → `option.safeDelete`, `timestamps.created_at` → `option.created_at`, `timestamps.modified_at` → `option.modified_at`
    - Exclude the primary key column from `structure` (matching existing generator behavior)
    - Exclude timestamp and softDelete columns from `structure`
    - Sort output array alphabetically by table name
    - _Requirements: 5.2, 5.9, 5.10_

  - [x] 5.2 Write unit tests for schema-to-meta converter
    - Test conversion of a known schema matches expected `ModelMeta[]` output
    - Test pk column is excluded from structure
    - Test timestamp and softDelete columns are excluded from structure
    - Test output is sorted alphabetically by table name
    - Test option fields map correctly from schema timestamps/softDelete
    - _Requirements: 5.2, 5.9, 5.10_

- [x] 6. Property-based tests for schema layer
  - [x] 6.1 Write property test for schema round-trip
    - **Property 1: Schema Round-Trip Preserves Data**
    - Implement `arbSchema` arbitrary generating valid schemas with 1–10 tables, 0–5 relationships, random column rules, random adapter/framework
    - Assert: `parseSchema(printSchema(parseSchema(input)))` deeply equals `parseSchema(input)`
    - **Validates: Requirements 2.2, 2.3**

  - [x] 6.2 Write property test for invalid adapter rejection
    - **Property 2: Invalid Adapter Rejection**
    - Implement `arbInvalidAdapter` generating strings not in the valid adapter set
    - Assert: validation fails with error identifying invalid adapter
    - **Validates: Requirements 1.2**

  - [x] 6.3 Write property test for invalid framework rejection
    - **Property 3: Invalid Framework Rejection**
    - Implement `arbInvalidFramework` generating strings not in the valid framework set
    - Assert: validation fails with error identifying invalid framework
    - **Validates: Requirements 1.3**

  - [x] 6.4 Write property test for column rule validation
    - **Property 4: Column Rule Validation**
    - Implement `arbInvalidColumnRule` generating strings that don't match the column rule pattern
    - Assert: validation fails with error identifying invalid column rule
    - **Validates: Requirements 1.6**

  - [x] 6.5 Write property test for primary key defaults
    - **Property 5: Primary Key Defaults**
    - Assert: parsed pk equals `pk` field if present, or `"id"` if omitted
    - **Validates: Requirements 1.4, 1.5**

  - [x] 6.6 Write property test for relationship validation
    - **Property 6: Relationship Validation**
    - Assert: relationships missing fields or referencing non-existent tables fail validation
    - **Validates: Requirements 1.7, 1.8**

  - [x] 6.7 Write property test for unique constraint validation
    - **Property 7: Unique Constraint Validation**
    - Assert: unique entries not matching column names or pk fail validation
    - **Validates: Requirements 1.9**

- [x] 7. Checkpoint — Schema layer with property tests complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Universal Flag Parser and OutputContext (`src/cli/flags.js`)
  - [x] 8.1 Create `parseFlags(argv)` and `OutputContext` class
    - Parse `--yes`, `--json`, `--dry-run`, `--no-install`, `--help` from argv
    - Extract subcommand (first non-flag argument)
    - Collect remaining key-value flags into `args` object
    - Implement `OutputContext` class: `log(msg)` is no-op when `--json`, `result(data)` accumulates JSON, `flush()` prints JSON to stdout if `--json`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 8.2 Write unit tests for flag parser and OutputContext
    - Test all flag combinations are parsed correctly
    - Test subcommand extraction
    - Test `OutputContext.log()` suppresses output when `--json` is active
    - Test `OutputContext.result()` accumulates data
    - Test `OutputContext.flush()` outputs valid JSON when `--json` is active
    - _Requirements: 8.1, 8.2, 8.5_

- [x] 9. Implement Diff Engine (`src/cli/diff-engine.js`)
  - [x] 9.1 Create `computeDiff(baseDir, meta, relationships)` function
    - Generate expected file contents in memory using existing generator functions
    - Compare expected content against actual files on disk
    - Categorize files as `added` (expected but not on disk), `modified` (on disk but different), `deleted` (on disk but not expected)
    - Use simple line-by-line diff for modified files
    - Return `{ added: string[], modified: Array<{file, diff}>, deleted: string[] }`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 9.2 Write unit tests for diff engine
    - Test added files detected when expected file missing from disk
    - Test modified files detected with correct diff output
    - Test deleted files detected when disk file not expected by schema
    - Test unchanged files not reported
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 10. Implement Init Command (`src/cli/commands/init.js`)
  - [x] 10.1 Create init command handler
    - When `--from` points to a Schema_File, read adapter/framework from schema instead of prompting
    - When `--yes` is provided, accept all defaults without prompting
    - When `--no-install` is provided, skip `npm install`
    - When `--json` is provided, output JSON result via `ctx.result()`
    - When `--dry-run` is provided, report planned files without writing
    - Reuse existing `generateFiles()`, `updatePackageJson()` from `src/cli/init.js`
    - Generate same set of project files as existing `db-model-router-init`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 10.2 Write unit tests for init command
    - Test `--from` reads schema file for adapter/framework
    - Test `--yes` skips prompts
    - Test `--no-install` skips npm install
    - Test `--dry-run` produces no file writes
    - Test `--json` outputs valid JSON result
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 11. Implement Inspect Command (`src/cli/commands/inspect.js`)
  - [x] 11.1 Create inspect command handler
    - Connect to database using existing `init()`/`db.connect()` and introspection functions
    - Convert `ModelMeta[]` → `ParsedSchema` (reverse of `schemaToModelMeta`)
    - Print via `schema-printer.js`
    - Write to `--out` path (default: `dbmr.schema.json`) unless `--dry-run` or `--json`
    - Support `--env`, `--type`, `--tables` flags
    - Handle connection failures with non-zero exit code and descriptive error
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 11.2 Write unit tests for inspect command
    - Test `--out` writes to specified path
    - Test `--json` outputs schema to stdout
    - Test `--dry-run` outputs schema without writing file
    - Test `--tables` filters output to specified tables
    - _Requirements: 4.3, 4.5, 4.6, 4.8_

- [x] 12. Implement Generate Command (`src/cli/commands/generate.js`)
  - [x] 12.1 Create generate command handler
    - Read and parse schema from `--from` (default: `dbmr.schema.json`)
    - Convert to `ModelMeta[]` via `schemaToModelMeta()`
    - Support `--models`, `--routes`, `--openapi`, `--tests` flags; generate all if none specified
    - Use existing `generateModelFile()`, `generateRouteFile()`, `generateRoutesIndexFile()`, `generateTestFile()`, `generateOpenAPISpec()` functions
    - Implement skip-unchanged logic: if file exists and content matches, skip and report unchanged
    - Support `--dry-run` (report planned files, no writes) and `--json` (JSON output via ctx)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 11.1, 11.4_

  - [x] 12.2 Write unit tests for generate command
    - Test all artifact types generated when no flags specified
    - Test `--models` generates only model files
    - Test `--routes` generates route files including child routes and index
    - Test `--dry-run` produces no file writes
    - Test skip-unchanged logic reports files as unchanged
    - Test `--json` outputs valid JSON with file statuses
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7, 5.8, 11.4_

- [x] 13. Implement Doctor Command (`src/cli/commands/doctor.js`)
  - [x] 13.1 Create doctor command handler
    - Parse and validate schema (report validation errors)
    - Read `package.json`, check adapter driver is in dependencies
    - Generate expected files in memory, compare with disk files using diff engine
    - Report `{ validation, dependencies, sync }` results
    - Exit code 0 if all pass, non-zero if any fail
    - Support `--json` flag for JSON output
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 13.2 Write unit tests for doctor command
    - Test valid schema + correct deps + synced files → exit 0
    - Test invalid schema → exit non-zero with validation errors
    - Test missing driver dependency → reported in dependencies check
    - Test out-of-sync file → reported in sync check
    - Test `--json` outputs structured JSON result
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 14. Implement Diff Command (`src/cli/commands/diff.js`)
  - [x] 14.1 Create diff command handler
    - Read and parse schema from `--from` (default: `dbmr.schema.json`)
    - Call `computeDiff()` from diff engine
    - Display added, modified (with line diffs), and deleted files
    - Support `--json` flag for JSON output
    - Ensure no files are modified on disk
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 14.2 Write unit tests for diff command
    - Test diff output categorizes files correctly
    - Test `--json` outputs valid JSON with added/modified/deleted arrays
    - Test no files modified after diff runs
    - _Requirements: 7.1, 7.4, 7.5_

- [x] 15. Checkpoint — All commands implemented
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement Unified CLI Entry Point (`src/cli/main.js`)
  - [x] 16.1 Create main dispatcher and register in `package.json` bin
    - Import all command handlers: `init`, `inspect`, `generate`, `doctor`, `diff`
    - Use `parseFlags(argv)` to extract subcommand, flags, args
    - Dispatch to the correct command handler with `OutputContext`
    - Print help when no subcommand or `--help` provided
    - Print error + valid subcommands when unknown subcommand provided (exit 1)
    - Add `"db-model-router": "src/cli/main.js"` to `package.json` bin field
    - Keep existing bin entries (`db-model-router-init`, `db-model-router-generate-model`, `db-model-router-generate-route`) unchanged
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 16.2 Write unit tests for CLI entry point
    - Test no subcommand displays help
    - Test `--help` displays help
    - Test unknown subcommand exits with code 1 and lists valid subcommands
    - Test each subcommand dispatches to correct handler
    - Test backward compatibility: old bin entries still functional
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 17. Implement LLM Docs Generation (`src/cli/commands/generate-llm-docs.js`)
  - [x] 17.1 Create LLM docs generator
    - Generate `llms.txt` at repo root: ultra-compact reference of all CLI commands, flags, and schema format (≤200 lines)
    - Generate `docs/llm.md`: installation instructions, canonical schema-driven workflow, full schema definition, all CLI commands with examples, route contract (8 endpoints per table), adapter capability matrix
    - Use consistent heading structure and code blocks in `docs/llm.md`
    - Wire into `generate` command as an additional artifact type
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 17.2 Write unit tests for LLM docs generator
    - Test `llms.txt` is ≤200 lines
    - Test `docs/llm.md` contains required sections (headings check)
    - Test regeneration reflects schema changes
    - _Requirements: 9.3, 9.4, 9.5_

- [x] 18. Property-based tests for code generation and CLI behavior
  - [x] 18.1 Write property test for artifact counts
    - **Property 8: Code Generation Artifact Counts**
    - For any valid schema with N tables and M relationships, verify exactly N model files, N + M route files + 1 index.js, 1 OpenAPI spec, N + M test files
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**

  - [x] 18.2 Write property test for generation idempotence
    - **Property 9: Generation Idempotence**
    - Run generator twice with same schema, assert byte-identical output
    - **Validates: Requirements 11.1, 11.3**

  - [x] 18.3 Write property test for no embedded non-determinism
    - **Property 10: No Embedded Non-Determinism**
    - Assert generated file contents contain no timestamps, `Date.now()`, `Math.random()`, or `process.env` references
    - **Validates: Requirements 11.2**

  - [x] 18.4 Write property test for skip unchanged files
    - **Property 11: Skip Unchanged Files**
    - Generate files, then run generator again, assert files reported as unchanged and not overwritten
    - **Validates: Requirements 11.4**

  - [x] 18.5 Write property test for doctor dependency check
    - **Property 12: Doctor Dependency Check**
    - For any valid schema, when adapter driver is absent from package.json, doctor reports missing dependency
    - **Validates: Requirements 6.2**

  - [x] 18.6 Write property test for doctor sync check
    - **Property 13: Doctor Sync Check**
    - For any valid schema, when a generated file differs from expected, doctor reports out of sync
    - **Validates: Requirements 6.3**

  - [x] 18.7 Write property test for diff categorization
    - **Property 14: Diff Categorization**
    - Assert files correctly categorized as added, modified, or deleted
    - **Validates: Requirements 7.1, 7.2**

  - [x] 18.8 Write property test for diff is read-only
    - **Property 15: Diff Is Read-Only**
    - Assert all file checksums identical before and after diff
    - **Validates: Requirements 7.5**

  - [x] 18.9 Write property test for JSON flag suppresses non-JSON output
    - **Property 16: JSON Flag Suppresses Non-JSON Output**
    - Assert stdout contains only a single valid JSON object with `--json`
    - **Validates: Requirements 8.2, 8.5**

  - [x] 18.10 Write property test for dry-run prevents side effects
    - **Property 17: Dry-Run Prevents Side Effects**
    - Assert file system state identical before and after `--dry-run` execution
    - **Validates: Requirements 8.3, 8.6**

  - [x] 18.11 Write property test for LLM docs line limit
    - **Property 18: LLM Docs Line Limit**
    - Assert `llms.txt` contains ≤200 lines for any valid schema
    - **Validates: Requirements 9.3**

- [x] 19. Checkpoint — All property tests complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Integration tests
  - [x] 20.1 Write full workflow integration test
    - `init --from schema.json` → `generate --from schema.json` → `doctor` → all pass
    - Use a temp directory with a test schema file
    - _Requirements: 3.1, 5.1, 6.4_

  - [x] 20.2 Write inspect round-trip integration test
    - Create SQLite3 in-memory DB → `inspect` → `generate --from` → compare generated models with direct introspection output
    - _Requirements: 4.1, 5.9_

  - [x] 20.3 Write existing generator equivalence integration test
    - Run old `generate-model` + `generate-route` on a test DB, run new `generate --from` on the inspected schema, compare outputs
    - _Requirements: 5.9, 5.10_

- [x] 21. Documentation updates
  - [x] 21.1 Update README.md and adapter docs
    - Add schema-driven workflow section to README.md
    - Document `dbmr.schema.json` format with examples
    - Document all new CLI subcommands (`init`, `inspect`, `generate`, `doctor`, `diff`)
    - Document universal flags (`--yes`, `--json`, `--dry-run`, `--no-install`)
    - Update `docs/SKILL.md` if it references CLI usage
    - _Requirements: 9.1, 9.2, 10.1, 10.2, 10.3_

- [x] 22. Final checkpoint — All tests pass, feature complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The schema layer (tasks 1–3) is pure with no I/O, making it ideal for isolated testing
- All code generation reuses existing functions from `generate-model.js`, `generate-route.js`, `generate-openapi.js`, and `init/generators.js`
