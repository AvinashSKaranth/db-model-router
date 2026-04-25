#!/usr/bin/env node
"use strict";

const { parseFlags, OutputContext } = require("./flags");

const initCmd = require("./commands/init");
const inspectCmd = require("./commands/inspect");
const generateCmd = require("./commands/generate");
const doctorCmd = require("./commands/doctor");
const diffCmd = require("./commands/diff");

/**
 * Map of subcommand names to their handler functions.
 */
const COMMANDS = {
  init: initCmd,
  inspect: inspectCmd,
  generate: generateCmd,
  doctor: doctorCmd,
  diff: diffCmd,
};

/**
 * Descriptions for each subcommand, used in help output.
 */
const COMMAND_DESCRIPTIONS = {
  init: "Scaffold a new project from a schema file or interactively",
  inspect: "Introspect a live database and produce a schema file",
  generate: "Generate models, routes, tests, and OpenAPI spec from a schema",
  doctor: "Validate schema, check dependencies, and verify file sync",
  diff: "Preview changes between current files and what the schema would produce",
};

/**
 * Print help message listing all available subcommands.
 */
function printHelp() {
  console.log("Usage: db-model-router <command> [options]\n");
  console.log("Commands:");
  for (const [name, desc] of Object.entries(COMMAND_DESCRIPTIONS)) {
    console.log(`  ${name.padEnd(12)} ${desc}`);
  }
  console.log("\nGlobal flags:");
  console.log("  --yes          Accept all defaults without prompting");
  console.log("  --json         Output machine-readable JSON");
  console.log("  --dry-run      Preview actions without side effects");
  console.log("  --no-install   Skip npm install step");
  console.log("  --help         Show help for a command");
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

  if (!subcommand || flags.help) {
    printHelp();
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
