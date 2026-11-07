"use strict";

const { down } = require("../../commons/migration-runner");
const { resolveAndConnectDb } = require("./migrate-helper");

/**
 * CLI command: dbmr migrate:down
 */
async function migrateDownCommand(flags, outputContext) {
  const { db, adapterType } = resolveAndConnectDb(flags);
  const dir = flags.dir || flags.migrations || "migrations";

  try {
    const result = await down(db, dir, adapterType);

    if (result.rolledBack.length === 0) {
      const msg = "No migrations found to rollback.";
      if (outputContext) outputContext.info(msg);
      else console.log(msg);
      return 0;
    }

    const title = `Rolled back ${result.rolledBack.length} migration(s) (Batch ${result.batch}):`;
    if (outputContext) outputContext.success(title);
    else console.log(title);

    for (const m of result.rolledBack) {
      const item = `  ↩ ${m.name || m.id}`;
      if (outputContext) outputContext.log(item);
      else console.log(item);
    }

    return 0;
  } catch (err) {
    const msg = `Rollback failed: ${err.message}`;
    if (outputContext) outputContext.error(msg);
    else console.error(msg);
    return 1;
  }
}

module.exports = migrateDownCommand;
