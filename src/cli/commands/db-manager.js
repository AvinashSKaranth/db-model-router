"use strict";

const fs = require("fs");
const path = require("path");

/**
 * DB Manager command handler for the unified CLI.
 *
 * Starts a live Express-based database management UI that connects
 * to any supported database through the library's adapter layer.
 *
 * Supported flags:
 *   --env   Path to .env file (default: ".env" in cwd)
 *   --port  Server port (default: 4000)
 *
 * @param {object} args - Parsed key-value args
 * @param {object} flags - Universal flags: { yes, json, dryRun, noInstall, help }
 * @param {import('../flags').OutputContext} ctx - Output context
 */
async function dbManager(args, flags, ctx) {
  // Parse flags with defaults
  const envPath = path.resolve(args.env || ".env");
  const port = parseInt(args.port, 10) || 4000;

  // Validate env file exists
  if (!fs.existsSync(envPath)) {
    ctx.log(`Error: Environment file not found: ${envPath}`);
    process.exitCode = 1;
    return;
  }

  // Load env vars from the specified file
  require("dotenv").config({ path: envPath });

  // Validate DB_TYPE is present
  const dbType = process.env.DB_TYPE;
  if (!dbType) {
    ctx.log(`Error: DB_TYPE not specified in ${envPath}`);
    process.exitCode = 1;
    return;
  }

  // Initialize the library adapter
  const restRouter = require("../../index.js");
  try {
    restRouter.init(dbType);
  } catch (err) {
    ctx.log(`Error: Failed to connect to ${dbType} database: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const db = restRouter.db;

  // Build connection config based on database type
  const config = { dateStrings: true };

  switch (dbType) {
    case "sqlite3":
      config.database = process.env.DB_NAME;
      config.filename = process.env.DB_NAME;
      break;
    case "mssql":
      config.server = process.env.DB_HOST || "localhost";
      config.port = process.env.DB_PORT;
      config.database = process.env.DB_NAME;
      config.user = process.env.DB_USER;
      config.password = process.env.DB_PASS;
      config.options = { encrypt: false, trustServerCertificate: true };
      break;
    default:
      // mysql, postgres, cockroachdb, etc.
      config.host = process.env.DB_HOST || "localhost";
      config.port = process.env.DB_PORT;
      config.database = process.env.DB_NAME;
      config.user = process.env.DB_USER;
      config.password = process.env.DB_PASS;
      break;
  }

  // Connect to the target database
  try {
    db.connect(config);
  } catch (err) {
    ctx.log(`Error: Failed to connect to ${dbType} database: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  // Initialize metadata DB
  const createMetadataDb = require("../../../db-manager/metadata-db.js");
  const metaDbPath = path.join(
    __dirname,
    "../../../db-manager/.dbmanager.sqlite",
  );
  const metaDb = createMetadataDb(metaDbPath);
  metaDb.init();

  // Record connection in history
  metaDb.recordConnection(
    dbType,
    process.env.DB_HOST || null,
    process.env.DB_NAME || dbType,
  );

  // Create Express app
  const createApp = require("../../../db-manager/server.js");
  const app = createApp(db, metaDb, dbType);

  // Start server
  const server = app.listen(port, () => {
    ctx.log(`DB Manager running at http://localhost:${port}`);
  });

  // Graceful shutdown handler
  const shutdown = () => {
    server.close(() => {
      try {
        if (db.disconnect) {
          db.disconnect();
        }
      } catch (_) {
        // ignore disconnect errors
      }
      metaDb.close();
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = dbManager;
