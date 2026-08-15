#!/usr/bin/env node
"use strict";

const { parseFlags, OutputContext } = require("./flags");

const initCmd = require("./commands/init");
const inspectCmd = require("./commands/inspect");
const doctorCmd = require("./commands/doctor");
const diffCmd = require("./commands/diff");
const helpCmd = require("./commands/help");
const dbManagerCmd = require("./commands/db-manager");
const encryptScanCmd = require("./commands/encrypt-scan");
const encryptRotateKeyCmd = require("./commands/encrypt-rotate-key");

/**
 * Map of subcommand names to their handler functions.
 */
const COMMANDS = {
  init: initCmd,
  inspect: inspectCmd,
  doctor: doctorCmd,
  diff: diffCmd,
  "db-manager": dbManagerCmd,
  "encrypt:scan": encryptScanCmd,
  "encrypt:rotate-key": encryptRotateKeyCmd,
  help: helpCmd,
};

/**
 * Descriptions for each subcommand, used in help output.
 */
const COMMAND_DESCRIPTIONS = {
  init: "First-buildout only: scaffold a full project from dbmr.schema.json",
  inspect: "Introspect a live database and produce a schema file",
  doctor: "Validate schema, check dependencies, and verify file sync",
  diff: "Preview changes between current files and what the schema would produce",
  "db-manager": "Start a live database management UI",
  "encrypt:scan": "Scan/backfill unencrypted values in encrypted fields",
  "encrypt:rotate-key": "Rotate field-level encryption keys",
  help: "Show help for a command",
};

/**
 * Per-command flag summaries shown in the general help overview.
 */
const COMMAND_FLAGS = {
  init: [
    ["[schemaPath]", "Path to schema file (default: ./dbmr.schema.json)"],
    ["--dry-run", "Preview planned files without writing"],
    ["--no-install", "Skip npm install after scaffolding"],
  ],
  inspect: [
    ["--type <adapter>", "Database adapter (required)"],
    ["--env <path>", "Path to .env file"],
    ["--out <path>", "Output file (default: dbmr.schema.json)"],
    ["--tables <list>", "Comma-separated table filter"],
  ],
  doctor: [["--from <path>", "Schema file (default: dbmr.schema.json)"]],
  diff: [["--from <path>", "Schema file (default: dbmr.schema.json)"]],
  "db-manager": [
    ["--env <path>", "Path to .env file (default: .env)"],
    ["--port <number>", "Server port (default: 4000)"],
  ],
  "encrypt:scan": [
    ["--type <adapter>", "Database adapter (required)"],
    ["--from <path>", "Schema file (default: dbmr.schema.json)"],
    ["--env <path>", "Path to .env file"],
    ["--tables <list>", "Comma-separated table filter"],
    ["--apply", "Encrypt unencrypted values found"],
  ],
  "encrypt:rotate-key": [
    ["--type <adapter>", "Database adapter (required)"],
    ["--to <n>", "Target key version (required)"],
    ["--new-key <ref>", "New key reference"],
    ["--from <path>", "Schema file (default: dbmr.schema.json)"],
    ["--env <path>", "Path to .env file"],
    ["--tables <list>", "Comma-separated table filter"],
  ],
};

/**
 * Print help message listing all available subcommands with their flags.
 */
function printHelp() {
  console.log("Usage: db-model-router <command> [options]\n");

  console.log("Commands:\n");
  for (const [name, desc] of Object.entries(COMMAND_DESCRIPTIONS)) {
    if (name === "help") {
      console.log(`  ${name.padEnd(12)} ${desc}`);
      continue;
    }
    console.log(`  ${name.padEnd(12)} ${desc}`);
    const flags = COMMAND_FLAGS[name];
    if (flags) {
      for (const [flag, info] of flags) {
        console.log(`    ${flag.padEnd(22)} ${info}`);
      }
      console.log("");
    }
  }

  console.log("Global flags (all commands):");
  console.log("  --yes            Accept all defaults without prompting");
  console.log("  --json           Output machine-readable JSON");
  console.log("  --dry-run        Preview actions without side effects");
  console.log("  --no-install     Skip npm install step");
  console.log("  --help           Show help for a command");
  console.log('\nRun "db-model-router help <command>" for detailed usage.');
}

/**
 * Print error for unknown subcommand and list valid subcommands.
 * @param {string} cmd - The unknown subcommand
 */
function printUnknown(cmd) {
  const valid = Object.keys(COMMANDS).join(", ");
  console.error(`Unknown command: ${cmd}`);
  console.error(`Valid commands: ${valid}`);
}

/**
 * Main CLI entry point.
 * @param {string[]} argv - process.argv.slice(2) style array
 */
async function main(argv) {
  const { subcommand, flags, args } = parseFlags(argv);

  if (!subcommand) {
    printHelp();
    return;
  }

  // `help <command>` — extract the topic from the second positional arg
  if (subcommand === "help") {
    // Re-parse to grab the second positional word as the help topic.
    // parseFlags puts the first positional into subcommand; the second
    // positional ends up as a key in args (if it looks like a flag value)
    // or is lost. So we grab it directly from argv.
    const topic =
      argv.find((a, i) => i > 0 && !a.startsWith("-") && argv[0] === "help") ||
      argv.find(
        (a, i) => i > 0 && !a.startsWith("-") && argv.indexOf("help") < i,
      );
    args._command = topic || null;
    const ctx = new OutputContext(flags);
    await helpCmd(args, flags, ctx, { printHelp });
    ctx.flush();
    return;
  }

  // `<command> --help` — show detailed help for that command
  if (flags.help) {
    args._command = subcommand;
    const ctx = new OutputContext(flags);
    await helpCmd(args, flags, ctx, { printHelp });
    ctx.flush();
    return;
  }

  if (!COMMANDS[subcommand]) {
    printUnknown(subcommand);
    process.exitCode = 1;
    return;
  }

  const ctx = new OutputContext(flags);
  await COMMANDS[subcommand](args, flags, ctx);
  ctx.flush();
}

// When run directly as a script
if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.printHelp = printHelp;
module.exports.printUnknown = printUnknown;
