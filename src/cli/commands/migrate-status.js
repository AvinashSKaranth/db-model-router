"use strict";

const { status } = require("../../commons/migration-runner");
const { resolveAndConnectDb } = require("./migrate-helper");

/**
 * CLI command: dbmr migrate:status
 */
async function migrateStatusCommand(flags, outputContext) {
  const { db, adapterType } = resolveAndConnectDb(flags);
  const dir = flags.dir || flags.migrations || "migrations";

  try {
    const list = await status(db, dir, adapterType);

    if (list.length === 0) {
      const msg = "No migration files found in directory.";
      if (outputContext) outputContext.info(msg);
      else console.log(msg);
      return 0;
    }

    const header = "Status   | Batch | Migration";
    const divider = "---------|-------|-----------------------------------";
    if (outputContext) {
      outputContext.log(header);
      outputContext.log(divider);
    } else {
      console.log(header);
      console.log(divider);
    }

    for (const item of list) {
      const st = item.status === "Applied" ? "Applied " : "Pending ";
      const b = item.batch !== null ? String(item.batch).padStart(5) : "     ";
      const line = `${st} | ${b} | ${item.filename}`;
      if (outputContext) outputContext.log(line);
      else console.log(line);
    }

    return 0;
  } catch (err) {
    const msg = `Failed to get status: ${err.message}`;
    if (outputContext) outputContext.error(msg);
    else console.error(msg);
    return 1;
  }
}

module.exports = migrateStatusCommand;
