"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Resolve adapter type and connect to database for CLI commands.
 */
function resolveAndConnectDb(flags) {
  const envPath = flags.env || ".env";
  const resolvedEnv = path.resolve(process.cwd(), envPath);
  if (fs.existsSync(resolvedEnv)) {
    require("dotenv").config({ path: resolvedEnv });
  }

  let adapterType = flags.type || process.env.DB_TYPE || "";

  if (!adapterType) {
    const schemaFile = flags.from || "dbmr.schema.json";
    const resolvedSchema = path.resolve(process.cwd(), schemaFile);
    if (fs.existsSync(resolvedSchema)) {
      try {
        const schema = JSON.parse(fs.readFileSync(resolvedSchema, "utf-8"));
        if (schema.adapter) adapterType = schema.adapter;
      } catch (_) {}
    }
  }

  if (!adapterType) {
    adapterType = "sqlite3";
  }

  const restRouter = require("../../index.js");
  restRouter.init(adapterType);
  const db = restRouter.db;

  const config = {
    host: process.env.DB_HOST || process.env.PG_HOST || "localhost",
    port: process.env.DB_PORT || process.env.PG_PORT,
    database:
      process.env.DB_NAME ||
      process.env.PG_DB ||
      process.env.DB_DATABASE ||
      "test.db",
    user: process.env.DB_USER || process.env.PG_USER,
    password: process.env.DB_PASS || process.env.PG_PASSWORD,
    filename: process.env.DB_NAME || "test.db",
    server: process.env.DB_HOST || "localhost",
    options: { encrypt: false, trustServerCertificate: true },
  };

  db.connect(config);
  return { db, adapterType, restRouter };
}

module.exports = {
  resolveAndConnectDb,
};
