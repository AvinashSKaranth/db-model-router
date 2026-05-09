"use strict";

const fs = require("fs");
const path = require("path");

const { generateSaasMigrations } = require("./saas/generate-saas-migrations");
const { generateSaasModels } = require("./saas/generate-saas-models");
const {
  generateAuthenticateMiddleware,
  generateTenantIsolationMiddleware,
  generateHasPermissionMiddleware,
} = require("./saas/generate-saas-middleware");
const {
  generateCrudRoutes,
  generateAuthRoutes,
  generateRoutesIndex,
} = require("./saas/generate-saas-routes");
const { generateSaasSeeds } = require("./saas/generate-saas-seeds");
const {
  generatePasswordUtil,
  generateModulesUtil,
  generateWebhookUtil,
} = require("./saas/generate-saas-utils");

/**
 * Read the existing .gitignore file and append `credentials.md` if not already present.
 * Returns the full .gitignore content to be written.
 *
 * @returns {string} Updated .gitignore content
 */
function getGitignoreContent() {
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  let content = "";
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, "utf8");
  }
  if (!content.includes("credentials.md")) {
    content = content.trimEnd() + "\ncredentials.md\n";
  }
  return content;
}

/**
 * Main SaaS structure generator orchestrator.
 *
 * Calls all sub-generators and aggregates their output into a single
 * planned[] array of { relPath, content } objects compatible with the
 * existing generate command's file write loop.
 *
 * @param {string} adapter - Database adapter name (e.g. "postgres", "mysql", "sqlite3")
 * @param {object} [options] - Generation options
 * @param {boolean} [options.dryRun] - If true, files will not be written (handled by caller)
 * @param {boolean} [options.json] - If true, output JSON format (handled by caller)
 * @param {Date|number} [options.timestamp] - Base timestamp for migration files
 * @param {string[]} [options.tableNames] - Schema-generated table names for routes index
 * @param {Array<{parent, child, foreignKey}>} [options.relationships] - Schema relationships for routes index
 * @param {{ includeDocs?: boolean }} [options.routeOptions] - Options for routes index generation
 * @returns {Array<{ relPath: string, content: string }>} Combined planned file array
 */
function generateSaasStructure(adapter, options) {
  const opts = options || {};
  const planned = [];

  // 1. Migrations
  const timestamp = opts.timestamp || new Date();
  const migrations = generateSaasMigrations(adapter, timestamp);
  for (const entry of migrations) {
    planned.push(entry);
  }

  // 2. Models (includes models/index.js barrel with both SaaS + dbmr tables)
  const models = generateSaasModels(adapter, opts.tableNames || []);
  for (const entry of models) {
    planned.push(entry);
  }

  // 3. Middleware
  planned.push(generateAuthenticateMiddleware());
  planned.push(generateTenantIsolationMiddleware());
  planned.push(generateHasPermissionMiddleware());

  // 4. Routes (CRUD + auth + combined index with dbmr routes)
  const crudRoutes = generateCrudRoutes();
  for (const entry of crudRoutes) {
    planned.push(entry);
  }
  planned.push(generateAuthRoutes());
  planned.push(
    generateRoutesIndex(
      opts.tableNames || [],
      opts.relationships || [],
      opts.routeOptions || {},
    ),
  );

  // 5. Seeds
  const seeds = generateSaasSeeds(adapter);
  for (const entry of seeds) {
    planned.push(entry);
  }

  // 6. Utilities
  planned.push({
    relPath: "commons/password.js",
    content: generatePasswordUtil(),
  });
  planned.push({
    relPath: "commons/modules.js",
    content: generateModulesUtil(),
  });
  planned.push({
    relPath: "commons/webhook.js",
    content: generateWebhookUtil(),
  });

  // 7. .gitignore update (add credentials.md)
  planned.push({ relPath: ".gitignore", content: getGitignoreContent() });

  return planned;
}

module.exports = { generateSaasStructure, getGitignoreContent };
