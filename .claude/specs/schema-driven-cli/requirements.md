# Requirements Document

## Introduction

This feature introduces a central machine-readable project contract (`dbmr.schema.json`) and a unified, deterministic CLI that replaces the current fragmented `init` + `generate-model` + `generate-route` workflow. An LLM (or human) edits a small declarative schema file, and the CLI regenerates all repetitive code locally. Every CLI command supports `--yes`, `--json`, `--dry-run`, and `--no-install` flags for fully non-interactive, machine-friendly operation.

## Glossary

- **Schema_File**: The `dbmr.schema.json` file — a JSON document that describes the entire project configuration including adapter, framework, tables, columns, relationships, and options.
- **CLI**: The `db-model-router` command-line interface that reads and operates on the Schema_File.
- **Schema_Parser**: The module responsible for reading, validating, and normalizing the Schema_File into an internal representation.
- **Schema_Printer**: The module responsible for serializing the internal representation back into a valid Schema_File JSON document.
- **Code_Generator**: The module that produces model files, route files, test files, and OpenAPI specs from the parsed Schema_File.
- **Inspector**: The module that connects to a live database, introspects its structure, and produces a Schema_File.
- **Doctor**: The CLI subcommand that validates the Schema_File, checks project dependencies, and verifies generated files are in sync with the schema.
- **Diff_Engine**: The module that compares the current generated files against what the Schema_File would produce, reporting additions, modifications, and deletions.
- **Adapter**: A database-specific driver module (one of: mysql, postgres, sqlite3, mongodb, mssql, cockroachdb, oracle, redis, dynamodb).
- **Framework**: The Express-compatible HTTP framework used by the generated project (one of: express, ultimate-express).
- **Column_Rule**: A pipe-delimited validation string describing a column's constraints (e.g., `"required|string"`, `"integer"`).
- **Relationship**: A parent-child foreign key association between two tables, described by parent table, child table, and foreign key column.
- **LLM_Docs**: Machine-readable documentation files (`llms.txt` and `docs/llm.md`) optimized for LLM consumption.

## Requirements

### Requirement 1: Schema File Structure and Validation

**User Story:** As a developer, I want a single JSON schema file that describes my entire project, so that all code generation is driven from one declarative source of truth.

#### Acceptance Criteria

1. THE Schema_Parser SHALL accept a JSON file containing the fields: `adapter` (string), `framework` (string), `tables` (object), `relationships` (array), and `options` (object).
2. WHEN the Schema_File contains an `adapter` value not in the set [mysql, postgres, sqlite3, mongodb, mssql, cockroachdb, oracle, redis, dynamodb], THE Schema_Parser SHALL return a validation error identifying the invalid adapter value.
3. WHEN the Schema_File contains a `framework` value not in the set [express, ultimate-express], THE Schema_Parser SHALL return a validation error identifying the invalid framework value.
4. WHEN a table entry in the Schema_File contains a `pk` field, THE Schema_Parser SHALL use that value as the primary key column name for that table.
5. WHEN a table entry omits the `pk` field, THE Schema_Parser SHALL default the primary key column name to `"id"`.
6. THE Schema_Parser SHALL validate that each column value in a table's `columns` object is a valid Column_Rule string containing only recognized tokens separated by pipe characters.
7. WHEN the Schema_File contains a `relationships` array, THE Schema_Parser SHALL validate that each entry has `parent` (string), `child` (string), and `foreignKey` (string) fields.
8. WHEN a relationship references a table name not present in the `tables` object, THE Schema_Parser SHALL return a validation error identifying the missing table.
9. WHEN a table entry contains a `unique` field, THE Schema_Parser SHALL validate that each element in the array is a string matching a column name defined in that table's `columns` object or the table's primary key.
10. WHEN a table entry contains a `softDelete` field, THE Schema_Parser SHALL record that column name as the safe-delete column for that table.

### Requirement 2: Schema Round-Trip (Parse and Print)

**User Story:** As a developer, I want the schema file to survive a parse-then-print cycle without data loss, so that automated tools can safely read and rewrite the file.

#### Acceptance Criteria

1. THE Schema_Printer SHALL format the internal representation back into a valid JSON document with 2-space indentation and a trailing newline.
2. FOR ALL valid Schema_File documents, parsing with the Schema_Parser then printing with the Schema_Printer then parsing again SHALL produce an equivalent internal representation (round-trip property).
3. WHEN the Schema_File contains optional fields (`options`, `unique`, `softDelete`, `relationships`), THE Schema_Printer SHALL preserve those fields in the output.

### Requirement 3: Init Command with Schema Support

**User Story:** As a developer, I want `db-model-router init` to scaffold a project from a schema file or interactively, so that I can bootstrap new projects in one step.

#### Acceptance Criteria

1. WHEN the `--from` flag points to a valid Schema_File, THE CLI init command SHALL read adapter and framework values from the Schema_File instead of prompting.
2. WHEN the `--yes` flag is provided, THE CLI init command SHALL accept all default values without prompting.
3. WHEN the `--no-install` flag is provided, THE CLI init command SHALL skip the `npm install` step after scaffolding.
4. WHEN the `--json` flag is provided, THE CLI init command SHALL output a JSON object describing the generated files and actions taken instead of human-readable text.
5. WHEN the `--dry-run` flag is provided, THE CLI init command SHALL report what files would be created and what dependencies would be installed without writing any files or running any commands.
6. WHEN no Schema_File is provided and all required flags (`--framework`, `--database`) are present along with `--yes`, THE CLI init command SHALL run fully non-interactively.
7. THE CLI init command SHALL generate the same set of project files as the existing `db-model-router-init` command (app.js, .env, .env.example, .gitignore, migrate.js, add_migration.js, middleware/logger.js, and migration files).

### Requirement 4: Inspect Command

**User Story:** As a developer, I want to introspect an existing database and produce a schema file, so that I can adopt the schema-driven workflow on existing projects.

#### Acceptance Criteria

1. WHEN the `--type` flag specifies a supported SQL adapter (mysql, postgres, sqlite3, mssql, oracle, cockroachdb), THE Inspector SHALL connect to the database and produce a Schema_File containing all discovered tables, columns, primary keys, unique constraints, and detected options (softDelete, timestamps).
2. WHEN the `--env` flag points to a `.env` file, THE Inspector SHALL load database connection parameters from that file.
3. WHEN the `--out` flag is provided, THE Inspector SHALL write the Schema_File to the specified file path.
4. WHEN the `--out` flag is omitted, THE Inspector SHALL write the Schema_File to `dbmr.schema.json` in the current directory.
5. WHEN the `--json` flag is provided, THE Inspector SHALL output the schema to stdout as JSON instead of writing to a file.
6. WHEN the `--dry-run` flag is provided, THE Inspector SHALL output the schema to stdout without writing any file.
7. IF the database connection fails, THEN THE Inspector SHALL return a non-zero exit code and a descriptive error message.
8. WHEN the `--tables` flag is provided with a comma-separated list, THE Inspector SHALL include only the specified tables in the output Schema_File.

### Requirement 5: Generate Command

**User Story:** As a developer, I want to generate all project artifacts (models, routes, tests, OpenAPI spec) from the schema file in one command, so that code generation is deterministic and repeatable.

#### Acceptance Criteria

1. WHEN the `--from` flag points to a valid Schema_File, THE Code_Generator SHALL read the schema and generate artifacts based on the selected flags.
2. WHEN the `--models` flag is provided, THE Code_Generator SHALL generate one model file per table defined in the Schema_File, using the table's columns, primary key, unique constraints, and options.
3. WHEN the `--routes` flag is provided, THE Code_Generator SHALL generate route files for each table, including child route files for each relationship, and an index.js mounting all routes.
4. WHEN the `--openapi` flag is provided, THE Code_Generator SHALL generate an OpenAPI 3.0 specification file from the schema's table and column definitions.
5. WHEN the `--tests` flag is provided, THE Code_Generator SHALL generate test files covering all CRUD endpoints for each table and each parent-child relationship.
6. WHEN no artifact flags (`--models`, `--routes`, `--openapi`, `--tests`) are provided, THE Code_Generator SHALL generate all artifact types.
7. WHEN the `--dry-run` flag is provided, THE Code_Generator SHALL output a list of files that would be created or modified without writing any files.
8. WHEN the `--json` flag is provided, THE Code_Generator SHALL output a JSON object listing all generated file paths and their status (created, skipped, or overwritten).
9. THE Code_Generator SHALL produce model files that are functionally equivalent to those produced by the existing `db-model-router-generate-model` command for the same table structure.
10. THE Code_Generator SHALL produce route files that are functionally equivalent to those produced by the existing `db-model-router-generate-route` command for the same table structure and relationships.

### Requirement 6: Doctor Command

**User Story:** As a developer, I want to validate my schema file and check that generated files are in sync, so that I can detect drift and configuration errors early.

#### Acceptance Criteria

1. THE Doctor SHALL validate the Schema_File against all Schema_Parser validation rules and report any errors.
2. THE Doctor SHALL check that all database driver packages required by the schema's adapter are listed in `package.json` dependencies.
3. THE Doctor SHALL compare each generated file (models, routes, tests, OpenAPI spec) against what the Schema_File would produce and report files that are out of sync.
4. WHEN all checks pass, THE Doctor SHALL exit with code 0 and report a success status.
5. WHEN any check fails, THE Doctor SHALL exit with a non-zero exit code and report all failures.
6. WHEN the `--json` flag is provided, THE Doctor SHALL output a JSON object containing the validation results, dependency check results, and sync status for each file.

### Requirement 7: Diff Command

**User Story:** As a developer, I want to preview what changes would occur if I regenerated from the schema, so that I can review before committing to a regeneration.

#### Acceptance Criteria

1. WHEN the `--from` flag points to a valid Schema_File, THE Diff_Engine SHALL compare the current generated files against what the Schema_File would produce.
2. THE Diff_Engine SHALL report files that would be added, modified, or deleted.
3. WHEN a file would be modified, THE Diff_Engine SHALL display the differences between the current file content and the expected content.
4. WHEN the `--json` flag is provided, THE Diff_Engine SHALL output the diff results as a JSON object with arrays for added, modified, and deleted files.
5. THE Diff_Engine SHALL not modify any files on disk.

### Requirement 8: Universal CLI Flags

**User Story:** As an LLM operator, I want every CLI command to support `--yes`, `--json`, `--dry-run`, and `--no-install` flags, so that all commands are fully automatable.

#### Acceptance Criteria

1. THE CLI SHALL accept the `--yes` flag on all commands to suppress interactive prompts and accept defaults.
2. THE CLI SHALL accept the `--json` flag on all commands to produce machine-readable JSON output instead of human-readable text.
3. THE CLI SHALL accept the `--dry-run` flag on all commands to preview actions without performing side effects (no file writes, no installs, no database connections for mutation).
4. THE CLI SHALL accept the `--no-install` flag on commands that would otherwise run `npm install`, to skip the installation step.
5. WHEN the `--json` flag is active, THE CLI SHALL suppress all console.log output that is not part of the JSON result.
6. WHEN the `--dry-run` flag is active, THE CLI SHALL exit with code 0 after reporting planned actions, without modifying the file system.

### Requirement 9: LLM Documentation Generation

**User Story:** As an LLM integrator, I want dense, machine-readable documentation files, so that LLMs can operate the CLI without consulting the human-readable README.

#### Acceptance Criteria

1. THE CLI SHALL generate a `llms.txt` file at the repository root containing an ultra-compact reference of all CLI commands, their flags, and the schema format.
2. THE CLI SHALL generate a `docs/llm.md` file containing: installation instructions, the canonical schema-driven workflow, the full `dbmr.schema.json` schema definition, all CLI commands with examples, the route contract (8 endpoints per table), and an adapter capability matrix.
3. THE `llms.txt` file SHALL be no longer than 200 lines.
4. THE `docs/llm.md` file SHALL use consistent heading structure and code blocks suitable for LLM context windows.
5. WHEN the Schema_File changes, THE Code_Generator SHALL be capable of regenerating `llms.txt` and `docs/llm.md` to reflect the current schema structure.

### Requirement 10: Unified CLI Entry Point

**User Story:** As a developer, I want a single `db-model-router` command with subcommands, so that the CLI surface is consistent and discoverable.

#### Acceptance Criteria

1. THE CLI SHALL expose a single `db-model-router` binary that dispatches to subcommands: `init`, `inspect`, `generate`, `doctor`, and `diff`.
2. WHEN no subcommand is provided, THE CLI SHALL display a help message listing all available subcommands and their descriptions.
3. WHEN the `--help` flag is provided to any subcommand, THE CLI SHALL display usage information for that subcommand including all accepted flags.
4. THE CLI SHALL maintain backward compatibility by keeping the existing `db-model-router-init`, `db-model-router-generate-model`, and `db-model-router-generate-route` binaries functional.
5. WHEN an unknown subcommand is provided, THE CLI SHALL exit with a non-zero exit code and display an error message listing valid subcommands.

### Requirement 11: Generated File Reproducibility

**User Story:** As a developer, I want generated files to be fully reproducible from the schema, so that I can delete and regenerate them at any time with identical results.

#### Acceptance Criteria

1. WHEN the Code_Generator is run twice with the same Schema_File and no external state changes, THE Code_Generator SHALL produce byte-identical output files.
2. THE Code_Generator SHALL not embed timestamps, random values, or environment-dependent data into generated files.
3. THE Code_Generator SHALL sort table entries and relationship entries in a deterministic order (alphabetical by table name) when generating index files and route mounting order.
4. WHEN a generated file already exists and its content matches what would be generated, THE Code_Generator SHALL skip that file and report it as unchanged.
