"use strict";

/**
 * Universal flag parser and OutputContext for the db-model-router CLI.
 *
 * Parses --yes, --json, --dry-run, --no-install, --help from argv.
 * Extracts the subcommand (first non-flag argument).
 * Collects remaining key-value flags into an args object.
 *
 * @module cli/flags
 */

/**
 * Parse CLI argv into subcommand, flags, and args.
 *
 * @param {string[]} argv - process.argv.slice(2) style array
 * @returns {{ subcommand: string|null, flags: Flags, args: object }}
 */
function parseFlags(argv) {
  const flags = {
    yes: false,
    json: false,
    dryRun: false,
    noInstall: false,
    help: false,
  };

  const args = {};
  let subcommand = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--yes") {
      flags.yes = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--no-install") {
      flags.noInstall = true;
    } else if (arg === "--help") {
      flags.help = true;
    } else if (arg.startsWith("--")) {
      // Key-value flag: --from schema.json → { from: "schema.json" }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++; // skip the value
      } else {
        args[key] = true;
      }
    } else if (subcommand === null) {
      subcommand = arg;
    }
  }

  return { subcommand, flags, args };
}

/**
 * OutputContext controls CLI output behavior based on flags.
 *
 * When --json is active:
 *   - log() is a no-op (suppresses human-readable output)
 *   - result() accumulates data
 *   - flush() prints the accumulated JSON to stdout
 *
 * When --json is NOT active:
 *   - log() prints to stdout
 *   - result() is a no-op
 *   - flush() is a no-op
 */
class OutputContext {
  constructor(flags) {
    this._json = !!(flags && flags.json);
    this._results = [];
  }

  /**
   * Log a human-readable message. No-op when --json is active.
   * @param {string} msg
   */
  log(msg) {
    if (!this._json) {
      console.log(msg);
    }
  }

  /**
   * Accumulate a result object for JSON output.
   * @param {*} data
   */
  result(data) {
    this._results.push(data);
  }

  /**
   * Flush accumulated JSON results to stdout if --json is active.
   * Prints a single JSON object (or the last result if only one was accumulated).
   */
  flush() {
    if (this._json && this._results.length > 0) {
      const output =
        this._results.length === 1 ? this._results[0] : this._results;
      console.log(JSON.stringify(output));
    }
  }
}

module.exports = { parseFlags, OutputContext };
