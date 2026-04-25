"use strict";

/**
 * LLM Docs Generator
 *
 * Generates two documentation files optimized for LLM consumption:
 * - llms.txt: ultra-compact CLI reference (≤200 lines)
 * - docs/llm.md: full reference with examples, schema definition, route contract, etc.
 */

const ADAPTERS = [
  "mysql",
  "postgres",
  "sqlite3",
  "mongodb",
  "mssql",
  "cockroachdb",
  "oracle",
  "redis",
  "dynamodb",
];

const FRAMEWORKS = ["express", "ultimate-express"];

const SUBCOMMANDS = ["init", "inspect", "generate", "doctor", "diff"];

const UNIVERSAL_FLAGS = [
  "--yes",
  "--json",
  "--dry-run",
  "--no-install",
  "--help",
];

const ADAPTER_CAPABILITIES = {
  mysql: { sql: true, transactions: true, migrations: true, streaming: false },
  postgres: {
    sql: true,
    transactions: true,
    migrations: true,
    streaming: false,
  },
  sqlite3: {
    sql: true,
    transactions: true,
    migrations: true,
    streaming: false,
  },
  mongodb: {
    sql: false,
    transactions: false,
    migrations: false,
    streaming: false,
  },
  mssql: { sql: true, transactions: true, migrations: true, streaming: false },
  cockroachdb: {
    sql: true,
    transactions: true,
    migrations: true,
    streaming: false,
  },
  oracle: { sql: true, transactions: true, migrations: true, streaming: false },
  redis: {
    sql: false,
    transactions: false,
    migrations: false,
    streaming: false,
  },
  dynamodb: {
    sql: false,
    transactions: false,
    migrations: false,
    streaming: false,
  },
};

/**
 * Generate the content for llms.txt — ultra-compact CLI reference (≤200 lines).
 * @returns {string}
 */
function generateLlmsTxt() {
  const lines = [
    "# db-model-router — LLM Quick Reference",
    "",
    "## Schema File: dbmr.schema.json",
    '{ "adapter": "<adapter>", "framework": "<framework>", "tables": { "<name>": { "columns": { "<col>": "<rule>" }, "pk": "<col>", "unique": ["<col>"], "softDelete": "<col>" } }, "relationships": [{ "parent": "<t>", "child": "<t>", "foreignKey": "<col>" }], "options": {} }',
    "",
    "Adapters: " + ADAPTERS.join(", "),
    "Frameworks: " + FRAMEWORKS.join(", "),
    'Column rules: (required|)?(string|integer|numeric|boolean|object) e.g. "required|string"',
    "",
    "## Universal Flags",
    UNIVERSAL_FLAGS.join("  "),
    "",
    "## Commands",
    "",
    "### init",
    "Scaffold a new project.",
    "  --from <schema>   Read config from schema file",
    "  --framework <fw>  Framework (express|ultimate-express)",
    "  --database <db>   Adapter name",
    "Example: db-model-router init --from dbmr.schema.json --yes --no-install",
    "",
    "### inspect",
    "Introspect a live database and produce a schema file.",
    "  --type <adapter>  Database adapter",
    "  --env <path>      Path to .env file",
    "  --out <path>      Output path (default: dbmr.schema.json)",
    "  --tables <list>   Comma-separated table filter",
    "Example: db-model-router inspect --type sqlite3 --env .env --out schema.json",
    "",
    "### generate",
    "Generate code artifacts from schema.",
    "  --from <schema>   Schema file (default: dbmr.schema.json)",
    "  --models          Generate model files only",
    "  --routes          Generate route files only",
    "  --openapi         Generate OpenAPI spec only",
    "  --tests           Generate test files only",
    "  --llm-docs        Generate LLM documentation only",
    "Example: db-model-router generate --from dbmr.schema.json",
    "Example: db-model-router generate --models --dry-run",
    "",
    "### doctor",
    "Validate schema, check dependencies, verify file sync.",
    "  --from <schema>   Schema file (default: dbmr.schema.json)",
    "Example: db-model-router doctor --from dbmr.schema.json --json",
    "",
    "### diff",
    "Preview changes between schema and generated files.",
    "  --from <schema>   Schema file (default: dbmr.schema.json)",
    "Example: db-model-router diff --from dbmr.schema.json",
    "",
    "## Route Contract (per table)",
    "GET    /api/<table>/        List (page, size, sort, select_columns)",
    "POST   /api/<table>/        Bulk insert",
    "PUT    /api/<table>/        Bulk update",
    "DELETE /api/<table>/        Bulk delete",
    "GET    /api/<table>/:id     Get by ID",
    "POST   /api/<table>/:id     Insert one",
    "PUT    /api/<table>/:id     Update one",
    "PATCH  /api/<table>/:id     Partial update one",
    "DELETE /api/<table>/:id     Delete one",
    "",
    "## Generated Files",
    "models/<table>.js           Model with CRUD operations",
    "routes/<table>.js           Express route handlers",
    "routes/<child>_child_of_<parent>.js  Child route",
    "routes/index.js             Route mounting index",
    "test/<table>.test.js        CRUD endpoint tests",
    "openapi.json                OpenAPI 3.0 spec",
    "llms.txt                    This file",
    "docs/llm.md                 Full LLM reference",
  ];

  return lines.join("\n") + "\n";
}

/**
 * Generate the content for docs/llm.md — full LLM reference.
 * @returns {string}
 */
function generateLlmMd() {
  const sections = [];

  // Title
  sections.push("# db-model-router — LLM Reference");
  sections.push("");

  // Installation
  sections.push("## Installation");
  sections.push("");
  sections.push("```bash");
  sections.push("npm install db-model-router");
  sections.push("```");
  sections.push("");

  // Workflow
  sections.push("## Canonical Schema-Driven Workflow");
  sections.push("");
  sections.push("1. Create or inspect a `dbmr.schema.json` schema file");
  sections.push(
    "2. Run `db-model-router generate --from dbmr.schema.json` to generate all artifacts",
  );
  sections.push(
    "3. Run `db-model-router doctor` to validate schema and check sync",
  );
  sections.push(
    "4. Run `db-model-router diff` to preview changes before regenerating",
  );
  sections.push("5. Edit the schema file and repeat from step 2");
  sections.push("");

  // Schema Definition
  sections.push("## Schema Definition");
  sections.push("");
  sections.push(
    "The `dbmr.schema.json` file is the single source of truth for your project.",
  );
  sections.push("");
  sections.push("```json");
  sections.push(
    JSON.stringify(
      {
        adapter: "<adapter>",
        framework: "<framework>",
        tables: {
          "<table_name>": {
            columns: {
              "<column_name>": "<column_rule>",
            },
            pk: "<primary_key_column>",
            unique: ["<column_name>"],
            softDelete: "<column_name>",
            timestamps: {
              created_at: "<column_name>",
              modified_at: "<column_name>",
            },
          },
        },
        relationships: [
          { parent: "<table>", child: "<table>", foreignKey: "<column>" },
        ],
        options: {},
      },
      null,
      2,
    ),
  );
  sections.push("```");
  sections.push("");
  sections.push("### Adapters");
  sections.push("");
  sections.push("| Adapter | Description |");
  sections.push("|---------|-------------|");
  for (const a of ADAPTERS) {
    sections.push(`| ${a} | ${a} database adapter |`);
  }
  sections.push("");
  sections.push("### Frameworks");
  sections.push("");
  sections.push("| Framework | Description |");
  sections.push("|-----------|-------------|");
  for (const f of FRAMEWORKS) {
    sections.push(`| ${f} | ${f} HTTP framework |`);
  }
  sections.push("");
  sections.push("### Column Rules");
  sections.push("");
  sections.push(
    "Column rules use pipe-delimited tokens: `(required|)?(string|integer|numeric|boolean|object)`",
  );
  sections.push("");
  sections.push(
    'Examples: `"required|string"`, `"integer"`, `"required|boolean"`, `"object"`',
  );
  sections.push("");

  // CLI Commands
  sections.push("## CLI Commands");
  sections.push("");
  sections.push(
    "All commands support universal flags: " +
      UNIVERSAL_FLAGS.map((f) => "`" + f + "`").join(", "),
  );
  sections.push("");

  // init
  sections.push("### init");
  sections.push("");
  sections.push("Scaffold a new project from a schema file or interactively.");
  sections.push("");
  sections.push("```bash");
  sections.push("# From schema file, non-interactive");
  sections.push(
    "db-model-router init --from dbmr.schema.json --yes --no-install",
  );
  sections.push("");
  sections.push("# Interactive with defaults");
  sections.push(
    "db-model-router init --framework express --database sqlite3 --yes",
  );
  sections.push("");
  sections.push("# Dry run to preview");
  sections.push("db-model-router init --from dbmr.schema.json --dry-run");
  sections.push("```");
  sections.push("");
  sections.push("| Flag | Description |");
  sections.push("|------|-------------|");
  sections.push("| `--from <path>` | Read config from schema file |");
  sections.push(
    "| `--framework <fw>` | Framework: express, ultimate-express |",
  );
  sections.push("| `--database <db>` | Adapter name |");
  sections.push("");

  // inspect
  sections.push("### inspect");
  sections.push("");
  sections.push("Introspect a live database and produce a schema file.");
  sections.push("");
  sections.push("```bash");
  sections.push(
    "db-model-router inspect --type postgres --env .env --out dbmr.schema.json",
  );
  sections.push(
    "db-model-router inspect --type sqlite3 --tables users,posts --json",
  );
  sections.push("```");
  sections.push("");
  sections.push("| Flag | Description |");
  sections.push("|------|-------------|");
  sections.push("| `--type <adapter>` | Database adapter to use |");
  sections.push("| `--env <path>` | Path to .env file |");
  sections.push("| `--out <path>` | Output file (default: dbmr.schema.json) |");
  sections.push("| `--tables <list>` | Comma-separated table filter |");
  sections.push("");

  // generate
  sections.push("### generate");
  sections.push("");
  sections.push("Generate code artifacts from the schema file.");
  sections.push("");
  sections.push("```bash");
  sections.push("# Generate all artifacts");
  sections.push("db-model-router generate --from dbmr.schema.json");
  sections.push("");
  sections.push("# Generate only models");
  sections.push("db-model-router generate --models");
  sections.push("");
  sections.push("# Generate only routes");
  sections.push("db-model-router generate --routes");
  sections.push("");
  sections.push("# Preview with dry-run");
  sections.push("db-model-router generate --dry-run --json");
  sections.push("");
  sections.push("# Generate LLM docs only");
  sections.push("db-model-router generate --llm-docs");
  sections.push("```");
  sections.push("");
  sections.push("| Flag | Description |");
  sections.push("|------|-------------|");
  sections.push(
    "| `--from <path>` | Schema file (default: dbmr.schema.json) |",
  );
  sections.push("| `--models` | Generate model files only |");
  sections.push("| `--routes` | Generate route files only |");
  sections.push("| `--openapi` | Generate OpenAPI spec only |");
  sections.push("| `--tests` | Generate test files only |");
  sections.push("| `--llm-docs` | Generate LLM documentation only |");
  sections.push("");

  // doctor
  sections.push("### doctor");
  sections.push("");
  sections.push(
    "Validate schema, check dependencies, and verify generated files are in sync.",
  );
  sections.push("");
  sections.push("```bash");
  sections.push("db-model-router doctor --from dbmr.schema.json");
  sections.push("db-model-router doctor --json");
  sections.push("```");
  sections.push("");

  // diff
  sections.push("### diff");
  sections.push("");
  sections.push(
    "Preview changes between the schema and currently generated files.",
  );
  sections.push("");
  sections.push("```bash");
  sections.push("db-model-router diff --from dbmr.schema.json");
  sections.push("db-model-router diff --json");
  sections.push("```");
  sections.push("");

  // Route Contract
  sections.push("## Route Contract");
  sections.push("");
  sections.push("Each table generates 9 endpoints:");
  sections.push("");
  sections.push("| Method | Path | Description |");
  sections.push("|--------|------|-------------|");
  sections.push(
    "| GET | `/api/<table>/` | List with pagination (page, size, sort, select_columns) |",
  );
  sections.push("| POST | `/api/<table>/` | Bulk insert |");
  sections.push("| PUT | `/api/<table>/` | Bulk update |");
  sections.push("| DELETE | `/api/<table>/` | Bulk delete |");
  sections.push(
    "| GET | `/api/<table>/:id` | Get single record by primary key |",
  );
  sections.push("| POST | `/api/<table>/:id` | Insert single record |");
  sections.push("| PUT | `/api/<table>/:id` | Update single record |");
  sections.push(
    "| PATCH | `/api/<table>/:id` | Partial update single record |",
  );
  sections.push("| DELETE | `/api/<table>/:id` | Delete single record |");
  sections.push("");

  // Adapter Capability Matrix
  sections.push("## Adapter Capability Matrix");
  sections.push("");
  sections.push("| Adapter | SQL | Transactions | Migrations | Streaming |");
  sections.push("|---------|-----|--------------|------------|-----------|");
  for (const [adapter, caps] of Object.entries(ADAPTER_CAPABILITIES)) {
    const yn = (v) => (v ? "Yes" : "No");
    sections.push(
      `| ${adapter} | ${yn(caps.sql)} | ${yn(caps.transactions)} | ${yn(caps.migrations)} | ${yn(caps.streaming)} |`,
    );
  }
  sections.push("");

  return sections.join("\n") + "\n";
}

module.exports = { generateLlmsTxt, generateLlmMd };
