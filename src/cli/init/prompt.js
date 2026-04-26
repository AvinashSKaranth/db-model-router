"use strict";

const inquirer = require("inquirer");

const VALID_FRAMEWORKS = ["ultimate-express", "express"];
const VALID_DATABASES = [
  "mysql",
  "mariadb",
  "postgres",
  "sqlite3",
  "mongodb",
  "mssql",
  "cockroachdb",
  "oracle",
  "redis",
  "dynamodb",
];
const VALID_SESSIONS = ["memory", "redis", "database"];

/**
 * Parse CLI arguments into a partial answers object.
 * Supports: --framework, --database, --session, --rateLimiting, --helmet, --logger
 * Boolean flags accept: true/false, yes/no, 1/0, or just --flag (implies true)
 * @param {string[]} argv
 * @returns {Partial<import('./types').InitAnswers>}
 */
function parseInitArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }

  const partial = {};

  if (args.framework && VALID_FRAMEWORKS.includes(args.framework)) {
    partial.framework = args.framework;
  }
  if (args.database && VALID_DATABASES.includes(args.database)) {
    partial.database = args.database;
  }
  // Accept --db as alias for --database
  if (!partial.database && args.db && VALID_DATABASES.includes(args.db)) {
    partial.database = args.db;
  }
  if (args.session && VALID_SESSIONS.includes(args.session)) {
    partial.session = args.session;
  }

  // Boolean flags
  for (const flag of ["rateLimiting", "helmet", "logger", "loki"]) {
    if (args[flag] !== undefined) {
      partial[flag] = parseBool(args[flag]);
    }
  }

  // Output directory
  if (args.output !== undefined && args.output !== "true") {
    partial.output = args.output;
  }

  return partial;
}

/**
 * Parse a string as a boolean.
 * @param {string} val
 * @returns {boolean}
 */
function parseBool(val) {
  return ["true", "yes", "1"].includes(String(val).toLowerCase());
}

/**
 * Run the interactive prompt flow to collect user preferences.
 * Any values already present in `prefilledAnswers` are skipped (not prompted).
 * When all 6 values are provided, no prompts are shown at all.
 * @param {Partial<import('./types').InitAnswers>} [prefilledAnswers={}]
 * @returns {Promise<import('./types').InitAnswers>}
 */
async function promptUser(prefilledAnswers) {
  const prefilled = prefilledAnswers || {};

  const questions = [];

  if (prefilled.framework === undefined) {
    questions.push({
      type: "list",
      name: "framework",
      message: "Select your Express framework:",
      choices: VALID_FRAMEWORKS,
      default: "ultimate-express",
    });
  }

  if (prefilled.database === undefined) {
    questions.push({
      type: "list",
      name: "database",
      message: "Select your database:",
      choices: VALID_DATABASES,
    });
  }

  if (prefilled.session === undefined) {
    questions.push({
      type: "list",
      name: "session",
      message: "Select your session store:",
      choices: VALID_SESSIONS,
    });
  }

  if (prefilled.output === undefined) {
    questions.push({
      type: "input",
      name: "output",
      message:
        "Output directory for backend source files (leave empty for root):",
      default: "",
    });
  }

  if (prefilled.rateLimiting === undefined) {
    questions.push({
      type: "confirm",
      name: "rateLimiting",
      message: "Enable rate limiting?",
      default: true,
    });
  }

  if (prefilled.helmet === undefined) {
    questions.push({
      type: "confirm",
      name: "helmet",
      message: "Enable Helmet security headers?",
      default: true,
    });
  }

  if (prefilled.logger === undefined) {
    questions.push({
      type: "confirm",
      name: "logger",
      message: "Enable request/response logger (Winston)?",
      default: true,
    });
  }

  // If all values are prefilled, skip prompts entirely
  if (questions.length === 0) {
    return /** @type {import('./types').InitAnswers} */ (prefilled);
  }

  const prompted = await inquirer.prompt(questions);

  // Follow-up: if logger is enabled, ask about Loki
  if (prompted.logger && prefilled.loki === undefined) {
    const lokiAnswer = await inquirer.prompt([
      {
        type: "confirm",
        name: "loki",
        message: "Send logs to Grafana Loki?",
        default: false,
      },
    ]);
    prompted.loki = lokiAnswer.loki;
  } else if (!prompted.logger && prefilled.logger === undefined) {
    prompted.loki = false;
  }

  return Object.assign({}, prefilled, prompted);
}

module.exports = {
  promptUser,
  parseInitArgs,
  VALID_FRAMEWORKS,
  VALID_DATABASES,
  VALID_SESSIONS,
};
