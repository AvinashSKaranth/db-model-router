#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const {
  generateAppJs,
  generateEnvFile,
  generateEnvExample,
  generateLoggerMiddleware,
  generateMigrateScript,
  generateAddMigrationScript,
  generateInitialMigration,
  generateSessionMigration,
  generateGitignore,
} = require("./init/generators");

const { collectDependencies, getScripts } = require("./init/dependencies");
const { promptUser, parseInitArgs } = require("./init/prompt");

/**
 * Ensure a package.json exists in the current directory.
 * Uses `npm init -y` for non-interactive creation. Exits with code 1 on failure.
 */
function ensurePackageJson() {
  if (fs.existsSync("package.json")) {
    return;
  }
  try {
    execSync("npm init -y", { stdio: "inherit" });
  } catch (err) {
    console.error("Error: npm init failed or was aborted.");
    process.exit(1);
  }
  if (!fs.existsSync("package.json")) {
    console.error("Error: package.json was not created. Aborting.");
    process.exit(1);
  }
}

/**
 * Write a file, but warn (and skip) if it already exists.
 * @param {string} filePath
 * @param {string} content
 * @returns {boolean} true if written, false if skipped
 */
function safeWriteFile(filePath, content) {
  if (fs.existsSync(filePath)) {
    console.log(`  Skipped ${filePath} (already exists)`);
    return false;
  }
  fs.writeFileSync(filePath, content);
  console.log(`  Created ${filePath}`);
  return true;
}

/**
 * Generate all project files based on user answers.
 * Creates directories and writes files. Skips files that already exist.
 * Returns the list of generated filenames for the summary.
 * @param {import('./init/types').InitAnswers} answers
 * @returns {{ files: string[], migrationFiles: string[] }}
 */
function generateFiles(answers) {
  const files = [];
  const migrationFiles = [];

  // Create directories
  if (!fs.existsSync("middleware")) {
    fs.mkdirSync("middleware", { recursive: true });
  }
  if (!fs.existsSync("migrations")) {
    fs.mkdirSync("migrations", { recursive: true });
  }

  // Write files (skip if they already exist)
  if (safeWriteFile("app.js", generateAppJs(answers))) files.push("app.js");
  if (safeWriteFile(".env", generateEnvFile(answers))) files.push(".env");
  if (safeWriteFile(".env.example", generateEnvExample(answers)))
    files.push(".env.example");

  const loggerPath = path.join("middleware", "logger.js");
  if (safeWriteFile(loggerPath, generateLoggerMiddleware(answers)))
    files.push("middleware/logger.js");

  if (safeWriteFile("migrate.js", generateMigrateScript(answers)))
    files.push("migrate.js");
  if (safeWriteFile("add_migration.js", generateAddMigrationScript(answers)))
    files.push("add_migration.js");
  if (safeWriteFile(".gitignore", generateGitignore()))
    files.push(".gitignore");

  // Initial migration
  const initialMigration = generateInitialMigration(answers);
  const initialPath = path.join("migrations", initialMigration.filename);
  if (safeWriteFile(initialPath, initialMigration.content)) {
    migrationFiles.push(initialMigration.filename);
  }

  // Conditional session migration
  const sessionMigration = generateSessionMigration(answers);
  if (sessionMigration !== null) {
    const sessionPath = path.join("migrations", sessionMigration.filename);
    if (safeWriteFile(sessionPath, sessionMigration.content)) {
      migrationFiles.push(sessionMigration.filename);
    }
  }

  return { files, migrationFiles };
}

/**
 * Update package.json with scripts and dependencies from the answers.
 * @param {import('./init/types').InitAnswers} answers
 */
function updatePackageJson(answers) {
  let raw;
  try {
    raw = fs.readFileSync("package.json", "utf8");
  } catch (err) {
    console.error("Error: Could not read package.json.");
    process.exit(1);
  }

  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (err) {
    console.error(
      "Error: package.json contains invalid JSON. Please fix it manually and re-run.",
    );
    process.exit(1);
  }

  const { dependencies, devDependencies } = collectDependencies(answers);
  const scripts = getScripts();

  pkg.scripts = Object.assign({}, pkg.scripts || {}, scripts);
  pkg.dependencies = Object.assign({}, pkg.dependencies || {}, dependencies);
  pkg.devDependencies = Object.assign(
    {},
    pkg.devDependencies || {},
    devDependencies,
  );

  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log("  Updated package.json");
}

/**
 * Run npm install. On failure, print manual install instructions and exit with code 1.
 */
function runInstall() {
  console.log("\nInstalling dependencies...\n");
  try {
    execSync("npm install", { stdio: "inherit" });
  } catch (err) {
    console.error(
      "\nError: npm install failed. Please run the following command manually:",
    );
    console.error("  npm install");
    process.exit(1);
  }
}

/**
 * Print a summary of generated files and next-step instructions.
 * Uses the file lists captured during generation (no re-calling generators).
 * @param {{ files: string[], migrationFiles: string[] }} generated
 */
function printSummary(generated) {
  console.log("\n✔ Project scaffolded successfully!\n");
  console.log("Generated files:");

  for (const f of generated.files) {
    console.log(`  ${f}`);
  }
  if (generated.migrationFiles.length > 0) {
    console.log("  migrations/");
    for (const m of generated.migrationFiles) {
      console.log(`    └── ${m}`);
    }
  }

  console.log("\nNext steps:");
  console.log("  1. Edit .env with your database credentials");
  console.log("  2. Run: npm run dev");
}

/**
 * Main orchestrator.
 */
async function main() {
  const cliArgs = parseInitArgs(process.argv.slice(2));

  // If --help flag, print usage and exit
  if (process.argv.includes("--help")) {
    printUsage();
    process.exit(0);
  }

  ensurePackageJson();

  let answers;
  try {
    answers = await promptUser(cliArgs);
  } catch (err) {
    // Handle Ctrl+C (inquirer throws on user cancel)
    console.log("\nAborted.");
    process.exit(1);
  }

  let generated;
  try {
    generated = generateFiles(answers);
  } catch (err) {
    if (err.code === "EACCES" || err.code === "EPERM") {
      console.error(
        `Error: Permission denied writing files. Check directory permissions.\n  ${err.message}`,
      );
    } else {
      console.error(`Error: Failed to generate files.\n  ${err.message}`);
    }
    process.exit(1);
  }

  updatePackageJson(answers);
  runInstall();
  printSummary(generated);
}

/**
 * Print CLI usage information.
 */
function printUsage() {
  console.log(`
Usage: db-model-router-init [options]

Scaffolds a complete Express-based REST API project. When all options are
provided, runs non-interactively (no prompts). Missing options are prompted.

Options:
  --framework <name>    Express framework: ultimate-express, express
  --database <name>     Database: mysql, postgres, sqlite3, mongodb, mssql,
                        cockroachdb, oracle, redis, dynamodb
  --db <name>           Alias for --database
  --session <type>      Session store: memory, redis, database
  --rateLimiting        Enable rate limiting (express-rate-limit)
  --helmet              Enable Helmet security headers
  --logger              Enable request/response logger (express-mung)
  --help                Show this help message

Examples:
  # Fully non-interactive (LLM-friendly)
  db-model-router-init --framework express --database postgres --session redis --rateLimiting --helmet --logger

  # Partial — only prompts for missing values
  db-model-router-init --database mysql --session memory

  # Interactive (no flags)
  db-model-router-init
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  ensurePackageJson,
  generateFiles,
  updatePackageJson,
  runInstall,
  printSummary,
  main,
};
