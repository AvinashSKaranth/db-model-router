"use strict";

/**
 * Per-command detailed help text.
 * Each key matches a subcommand name from main.js.
 */
const COMMAND_HELP = {
  init: `Usage: db-model-router init [options]

Scaffold a new project from a schema file or interactively.
Creates app.js, .env, commons/, route/, middleware/, and migrations/.

Options:
  --from <path>          Read adapter, framework, and options from a schema file
  --framework <name>     Express framework: express, ultimate-express
  --database <name>      Database adapter: mysql, postgres, sqlite3, mongodb,
                         mssql, cockroachdb, oracle, redis, dynamodb
  --db <name>            Alias for --database
  --session <type>       Session store: memory, redis, database
  --output <dir>         Directory for backend source files (relative to cwd).
                         package.json and app.js stay in root; commons/, route/,
                         middleware/, and migrations/ go inside this folder.
  --rateLimiting         Enable rate limiting (default: yes)
  --helmet               Enable Helmet security headers (default: yes)
  --logger               Enable Winston + Loki logger for Grafana (default: yes)
  --yes                  Accept all defaults without prompting
  --json                 Output machine-readable JSON
  --dry-run              Preview planned files without writing
  --no-install           Skip npm install after scaffolding
  --help                 Show this help message

Generated files:
  app.js                              Express app entry point
  .env / .env.example                 Environment configuration
  .gitignore                          Git ignore rules
  <output>/commons/session.js         Session configuration
  <output>/commons/migrate.js         Migration runner (also runs as script)
  <output>/commons/add_migration.js   Migration creation helper (also runs as script)
  <output>/commons/security.js        Helmet, rate limiting, custom headers
  <output>/middleware/logger.js        Winston + Loki request logger
  <output>/route/health.js            GET /health endpoint
  <output>/migrations/                Initial migration files

Examples:
  db-model-router init --from dbmr.schema.json --yes --no-install
  db-model-router init --framework express --database postgres --output backend --yes
  db-model-router init --database mysql --session redis --helmet --rateLimiting
  db-model-router init --dry-run`,

  inspect: `Usage: db-model-router inspect [options]

Introspect a live database and produce a dbmr.schema.json file.
Connects to the database, reads table structures, and outputs a schema.

Options:
  --type <adapter>       Database adapter (required): mysql, postgres, sqlite3,
                         mssql, oracle, cockroachdb
  --env <path>           Path to .env file for connection parameters
  --out <path>           Output file path (default: dbmr.schema.json)
  --tables <list>        Comma-separated list of tables to include (omit for all)
  --yes                  Accept all defaults without prompting
  --json                 Output schema as JSON to stdout (no file write)
  --dry-run              Output schema to stdout without writing file
  --help                 Show this help message

Examples:
  db-model-router inspect --type postgres --env .env
  db-model-router inspect --type sqlite3 --out schema.json --tables users,posts
  db-model-router inspect --type mysql --json`,

  generate: `Usage: db-model-router generate [options]

Generate models, routes, tests, OpenAPI spec, and LLM docs from a schema file.
When no artifact flags are provided, all artifact types are generated.

Options:
  --from <path>          Path to schema file (default: dbmr.schema.json)
  --models               Generate only model files
  --routes               Generate only route files (including child routes and index)
  --openapi              Generate only OpenAPI spec
  --tests                Generate only test files
  --llm-docs             Generate only LLM documentation (llms.txt + docs/llm.md)
  --yes                  Accept all defaults without prompting
  --json                 Output machine-readable JSON
  --dry-run              Report planned files without writing
  --help                 Show this help message

Generated files:
  models/<table>.js                        Model with CRUD operations
  routes/<table>.js                        Express route handlers
  routes/<child>_child_of_<parent>.js      Child route (scoped by FK)
  routes/index.js                          Route mounting index
  test/<table>.test.js                     CRUD endpoint tests
  openapi.json                             OpenAPI 3.0 spec
  llms.txt                                 LLM quick reference
  docs/llm.md                              Full LLM reference

Examples:
  db-model-router generate --from dbmr.schema.json
  db-model-router generate --models --dry-run
  db-model-router generate --routes --tests
  db-model-router generate --from dbmr.schema.json --json`,

  doctor: `Usage: db-model-router doctor [options]

Validate schema, check adapter driver dependencies, and verify generated
files are in sync with the schema.

Options:
  --from <path>          Path to schema file (default: dbmr.schema.json)
  --yes                  Accept all defaults without prompting
  --json                 Output machine-readable JSON
  --help                 Show this help message

Checks performed:
  1. Schema validation    Syntax and structure of dbmr.schema.json
  2. Dependency check     Adapter driver present in package.json
  3. Sync check           Generated files match what the schema would produce

Examples:
  db-model-router doctor --from dbmr.schema.json
  db-model-router doctor --json`,

  diff: `Usage: db-model-router diff [options]

Preview changes between the current generated files and what the schema
would produce. Read-only — does not modify any files on disk.

Options:
  --from <path>          Path to schema file (default: dbmr.schema.json)
  --yes                  Accept all defaults without prompting
  --json                 Output machine-readable JSON
  --help                 Show this help message

Output shows:
  + Added      New files that would be created
  ~ Modified   Files with changes (includes line diffs)
  - Deleted    Extra files that would be removed

Examples:
  db-model-router diff --from dbmr.schema.json
  db-model-router diff --json`,
};

/**
 * Help command handler.
 *
 * When called with a command name in args (e.g. `help init`), prints
 * detailed help for that command. Otherwise prints the general overview.
 *
 * @param {object} args - Parsed key-value args
 * @param {object} flags - Universal flags
 * @param {import('../flags').OutputContext} ctx - Output context
 * @param {object} options - Injected dependencies
 * @param {Function} options.printHelp - General help printer from main.js
 */
async function help(args, flags, ctx, options) {
  // The command to get help for is the first positional arg captured
  // by parseFlags as a key-value. We also check args._command which
  // main.js will inject.
  const topic = args._command;

  if (topic && COMMAND_HELP[topic]) {
    ctx.log(COMMAND_HELP[topic]);
  } else if (topic) {
    ctx.log(`Unknown command: ${topic}\n`);
    ctx.log(`Available commands: ${Object.keys(COMMAND_HELP).join(", ")}\n`);
    ctx.log(`Run "db-model-router help <command>" for detailed help.`);
  } else {
    // No topic — print general help
    if (options && options.printHelp) {
      options.printHelp();
    }
  }
}

module.exports = help;
module.exports.COMMAND_HELP = COMMAND_HELP;
