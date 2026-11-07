"use strict";

const path = require("path");
const { createMigrationFile } = require("../../commons/migration-runner");

/**
 * CLI command: dbmr migrate:create <name>
 */
async function migrateCreateCommand(flags, outputContext) {
  const name = flags._?.[1] || flags.name;
  if (!name) {
    const msg = "Usage: db-model-router migrate:create <name>";
    if (outputContext) {
      outputContext.error(msg);
      return 1;
    }
    throw new Error(msg);
  }

  const dir = flags.dir || flags.migrations || "migrations";
  const { fullPath } = createMigrationFile(name, dir);

  const msg = `Created migration file: ${path.relative(process.cwd(), fullPath)}`;
  if (outputContext) {
    outputContext.success(msg);
  } else {
    console.log(msg);
  }

  return 0;
}

module.exports = migrateCreateCommand;
