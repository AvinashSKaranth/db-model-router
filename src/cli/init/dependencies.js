"use strict";

/**
 * Maps each supported database to its driver package(s).
 */
const DRIVER_MAP = {
  mysql: ["mysql2"],
  mariadb: ["mysql2"],
  postgres: ["pg"],
  sqlite3: ["better-sqlite3"],
  mongodb: ["mongodb"],
  mssql: ["mssql"],
  cockroachdb: ["pg"],
  oracle: ["oracledb"],
  redis: ["ioredis"],
  dynamodb: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"],
};

/**
 * Collect dependencies and devDependencies based on user answers.
 * @param {import('./types').InitAnswers} answers
 * @returns {{ dependencies: Record<string, string>, devDependencies: Record<string, string> }}
 */
function collectDependencies(answers) {
  const dependencies = {};
  const devDependencies = {};

  // Always included
  dependencies["db-model-router"] = "latest";
  dependencies["dotenv"] = "latest";
  dependencies[answers.framework] = "latest";
  dependencies["express-session"] = "latest";

  // Database driver(s)
  const drivers = DRIVER_MAP[answers.database] || [];
  for (const driver of drivers) {
    dependencies[driver] = "latest";
  }

  // Session: redis
  if (answers.session === "redis") {
    dependencies["connect-redis"] = "latest";
    // Only add ioredis if not already included via the database driver
    if (answers.database !== "redis") {
      dependencies["ioredis"] = "latest";
    }
  }

  // Optional middleware
  if (answers.rateLimiting) {
    dependencies["express-rate-limit"] = "latest";
  }
  if (answers.helmet) {
    dependencies["helmet"] = "latest";
  }
  if (answers.logger) {
    dependencies["winston"] = "latest";
    if (answers.loki) {
      dependencies["winston-loki"] = "latest";
    }
  }

  // Dev dependencies
  devDependencies["nodemon"] = "latest";

  return { dependencies, devDependencies };
}

/**
 * Returns the package.json scripts.
 * @param {string} [outputDir] - relative output directory for source files
 * @returns {Record<string, string>}
 */
function getScripts(outputDir) {
  const prefix = outputDir ? `${outputDir}/` : "";
  return {
    start: "node app.js",
    dev: "nodemon app.js",
    test: 'echo "Error: no test specified" && exit 1',
    migrate: `node ${prefix}commons/migrate.js`,
    add_migration: `node ${prefix}commons/add_migration.js`,
    "docker:build": "docker build -t app .",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
  };
}

module.exports = {
  DRIVER_MAP,
  collectDependencies,
  getScripts,
};
