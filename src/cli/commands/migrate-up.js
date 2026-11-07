"use strict";

const { up } = require("../../commons/migration-runner");
const { resolveAndConnectDb } = require("./migrate-helper");

/**
 * CLI command: dbmr migrate:up
 */
async function migrateUpCommand(flags, outputContext) {
  const { db, adapterType } = resolveAndConnectDb(flags);
  const dir = flags.dir || flags.migrations || "migrations";

  try {
    const result = await up(db, dir, adapterType);

    if (result.applied.length === 0) {
      const msg = "Database is already up to date. No pending migrations.";
      if (outputContext) outputContext.info(msg);
      else console.log(msg);
      return 0;
    }

    const title = `Applied ${result.applied.length} migration(s) (Batch ${result.batch}):`;
    if (outputContext) outputContext.success(title);
    else console.log(title);

    for (const m of result.applied) {
      const item = `  ✔ ${m.filename}`;
      if (outputContext) outputContext.log(item);
      else console.log(item);
    }

    return 0;
  } catch (err) {
    const msg = `Migration failed: ${err.message}`;
    if (outputContext) outputContext.error(msg);
    else console.error(msg);
    return 1;
  }
}

module.exports = migrateUpCommand;
