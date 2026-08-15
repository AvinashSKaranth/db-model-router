"use strict";

/**
 * Per-command detailed help text.
 * Each key matches a subcommand name from main.js.
 */
const COMMAND_HELP = {
  init: `Usage: db-model-router init [schemaPath] [options]

First-buildout ONLY. Scaffolds a complete project (app.js, commons/, routes/,
middleware/, migrations/, models/, tests, OpenAPI spec, and optional SaaS
structure) from a single dbmr.schema.json file.

ALL project configuration lives in the schema's "options" block. There are no
config flags on this command — set everything in dbmr.schema.json:

  options:
    output          Relative/absolute dir for source files (null = cwd root)
    saasStructure   boolean (default: true) — generate multi-tenant SaaS scaffold
    apiBasePath     string starting with "/" (default: "/api")
    port            positive integer (default: 3000)
    session         "memory" | "redis" | "database" (default: "memory")
    rateLimiting    boolean (default: true)
    helmet          boolean (default: true)
    logger          boolean (default: true)
    loki            boolean (default: false)

refuses to run if a project already exists in cwd (app.js or package.json
present). init is NOT for adding new tables, models, or routes — see below.

Arguments:
  schemaPath             Path to schema file (default: ./dbmr.schema.json)

Options:
  --json                 Output machine-readable JSON
  --dry-run              Preview planned files without writing
  --no-install           Skip npm install after scaffolding
  --help                 Show this help message

Generated files:
  app.js                              Express app entry point
  .env / .env.example                 Environment configuration (PORT, API_BASE_PATH)
  .gitignore                          Git ignore rules
  <output>/commons/db.js              Database init, connect, and global.db
  <output>/commons/session.js         Session configuration
  <output>/commons/migrate.js         Migration runner (also runs as script)
  <output>/commons/add_migration.js   Migration creation helper (also runs as script)
  <output>/commons/security.js        Helmet, rate limiting, custom headers
  <output>/middleware/logger.js       Winston + Loki request logger
  <output>/routes/index.js            Central route mounting
  <output>/routes/health.js           GET /health endpoint
  <output>/routes/docs.js             Swagger UI at /docs
  <output>/routes/<table>/index.js    CRUD route per table (nested by parent)
  <output>/models/<table>.js          Model with CRUD operations per table
  <output>/migrations/                CREATE TABLE migrations (SQL) or per-table (NoSQL)
  <output>/test/<table>.test.js       CRUD endpoint tests per table
  <output>/openapi.json               OpenAPI 3.0 spec
  SaaS files (when saasStructure=true): tenants/users/roles middleware + routes + seeds

Examples:
  db-model-router init                          # uses ./dbmr.schema.json
  db-model-router init ./my.schema.json
  db-model-router init --dry-run
  db-model-router init --no-install --json

ADDING NEW TABLES / MODELS / ROUTES AFTER BUILDOUT (manual — do NOT re-run init):
  1. Migration: create a new timestamped migration under migrations/ with the
     CREATE TABLE (SQL) or create_<table>.js (NoSQL). Use the scaffold helper:
       node commons/add_migration.js <name>
     then write your CREATE TABLE SQL / collection setup inside it.
  2. Model: add models/<table>.js mirroring an existing model:
       const model = require('#commons/model');
       const db = require('#commons/db');
       module.exports = model(db, '<table>', structure, '<pk>', uniqueKeys, option);
  3. Route: add routes/<table>/index.js via route(model):
       const route = require('#commons/route');
       module.exports = route(require('#models/<table>'));
     then mount it in routes/index.js at the desired endpoint:
       router.use('/<endpoint>', require('./<table>/index.js'));
  4. Run the new migration, then restart the server.`,

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

  "encrypt:scan": `Usage: db-model-router encrypt:scan [options]

Scan one or more tables for unencrypted values in fields marked encrypted
in the schema, and optionally backfill them (--apply).

Fields are encrypted at write time by the runtime when db.init() is given an
encryption config. Values written before encryption was enabled remain in
plaintext; encrypt:scan finds and (with --apply) encrypts them.

Encryption config comes from options.encryption in the schema:
  options:
    encryption:
      key: "env:ENC_KEY"     # key reference (env:VAR or base64 key)
      version: 1             # active key version
      keys: { 1: "env:ENC_KEY" }  # optional rotation history

Options:
  --type <adapter>       Database adapter (required): mysql, postgres, sqlite3, ...
  --from <path>          Schema file (default: dbmr.schema.json)
  --env <path>           Path to .env file for DB credentials
  --tables <list>        Comma-separated table filter (default: all)
  --key <ref>            Override encryption key reference
  --version <n>          Override active key version
  --keys <json>          Override keyring map (JSON)
  --apply                Encrypt unencrypted values found (default: report only)
  --dry-run              Preview what --apply would change without writing
  --json                 Output machine-readable JSON
  --help                 Show this help message

Examples:
  db-model-router encrypt:scan --type sqlite3 --env .env
  db-model-router encrypt:scan --type postgres --env .env --tables users,orders
  db-model-router encrypt:scan --type sqlite3 --env .env --apply --dry-run
  db-model-router encrypt:scan --type sqlite3 --env .env --apply --json`,

  "encrypt:rotate-key": `Usage: db-model-router encrypt:rotate-key [options]

Re-encrypt every value in every encrypted field under a new key version.
Reads decrypt with the existing keyring (old keys) and writes use the new
key. After rotation, bump options.encryption in the schema:
  options:
    encryption:
      key: "env:NEW_ENC_KEY"
      version: 2
      keys: { 1: "env:OLD_ENC_KEY", 2: "env:NEW_ENC_KEY" }

Options:
  --type <adapter>       Database adapter (required): mysql, postgres, sqlite3, ...
  --to <n>               Target key version (required)
  --new-key <ref>        New key reference (default: options.encryption.key)
  --key <ref>            Old/active key reference (default: options.encryption.key)
  --keys <json>          Override OLD keyring map (must include keys currently
                         encrypting data; default: options.encryption.keys)
  --from <path>          Schema file (default: dbmr.schema.json)
  --env <path>           Path to .env file for DB credentials
  --tables <list>        Comma-separated table filter (default: all)
  --dry-run              Preview what would change without writing
  --json                 Output machine-readable JSON
  --help                 Show this help message

Examples:
  db-model-router encrypt:rotate-key --type sqlite3 --env .env --to 2 --new-key env:NEW_ENC_KEY
  db-model-router encrypt:rotate-key --type postgres --env .env --to 3 --dry-run --json`,
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
