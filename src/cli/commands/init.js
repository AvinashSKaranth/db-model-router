"use strict";

const fs = require("fs");
const path = require("path");
const { parseSchema } = require("../../schema/schema-parser");
const {
  generateFiles,
  updatePackageJson,
  runInstall,
  printSummary,
  ensurePackageJson,
} = require("../init");
const { promptUser } = require("../init/prompt");

/**
 * Default answers used when --yes is provided and no schema is available.
 */
const DEFAULT_ANSWERS = {
  framework: "express",
  database: "postgres",
  session: "memory",
  rateLimiting: false,
  helmet: false,
  logger: false,
};

/**
 * Init command handler for the unified CLI.
 *
 * Scaffolds a new project from a schema file or interactively.
 *
 * @param {object} args - Parsed positional/key-value args (e.g. { from, framework, database })
 * @param {object} flags - Universal flags: { yes, json, dryRun, noInstall, help }
 * @param {import('../flags').OutputContext} ctx - Output context for --json support
 */
async function init(args, flags, ctx) {
  let answers;

  if (args.from) {
    // --from points to a schema file: read adapter/framework from it
    const schemaPath = path.resolve(args.from);
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${args.from}`);
    }
    const raw = fs.readFileSync(schemaPath, "utf8");
    const schema = parseSchema(raw);

    answers = {
      framework: schema.framework,
      database: schema.adapter,
      session: (schema.options && schema.options.session) || "memory",
      rateLimiting: !!(schema.options && schema.options.rateLimiting),
      helmet: !!(schema.options && schema.options.helmet),
      logger: !!(schema.options && schema.options.logger),
    };
  } else if (flags.yes) {
    // --yes with no schema: use defaults, but allow CLI overrides
    answers = Object.assign({}, DEFAULT_ANSWERS);
    if (args.framework) answers.framework = args.framework;
    if (args.database) answers.database = args.database;
  } else {
    // Interactive: build prefilled from CLI args, prompt for the rest
    const prefilled = {};
    if (args.framework) prefilled.framework = args.framework;
    if (args.database) prefilled.database = args.database;
    answers = await promptUser(prefilled);
  }

  // --dry-run: report planned files without writing
  if (flags.dryRun) {
    const planned = planFiles(answers);
    if (flags.json) {
      ctx.result({
        files: planned,
        dependencies: { installed: false },
        actions: ["dry-run"],
      });
    } else {
      ctx.log("Dry run — the following files would be created:");
      for (const f of planned) {
        ctx.log(`  ${f}`);
      }
      ctx.log("\nNo files were written.");
    }
    return;
  }

  // Ensure package.json exists
  ensurePackageJson();

  // Generate project files
  const generated = generateFiles(answers);

  // Update package.json with deps and scripts
  updatePackageJson(answers);

  // npm install (unless --no-install)
  const installed = !flags.noInstall;
  if (installed) {
    runInstall();
  }

  // Output
  const allFiles = [
    ...generated.files,
    ...generated.migrationFiles.map((m) => `migrations/${m}`),
  ];

  if (flags.json) {
    ctx.result({
      files: allFiles,
      dependencies: { installed },
      actions: installed ? ["scaffolded", "installed"] : ["scaffolded"],
    });
  } else {
    printSummary(generated);
    if (!installed) {
      ctx.log(
        "\nSkipped npm install (--no-install). Run `npm install` manually.",
      );
    }
  }
}

/**
 * Compute the list of files that would be created (for --dry-run).
 * This mirrors the file list from generateFiles() without writing anything.
 *
 * @param {object} answers
 * @returns {string[]}
 */
function planFiles(answers) {
  const { isSql } = require("../init/generators");
  const files = [
    "app.js",
    ".env",
    ".env.example",
    "middleware/logger.js",
    "migrate.js",
    "add_migration.js",
    ".gitignore",
    "migrations/<timestamp>_create_migrations_table" +
      (isSql(answers.database) ? ".sql" : ".js"),
  ];

  if (answers.session === "database" && isSql(answers.database)) {
    files.push("migrations/<timestamp>_create_sessions_table.sql");
  }

  return files;
}

module.exports = init;
