"use strict";

/**
 * SaaS model generator.
 *
 * Generates model files for all SaaS tables following the existing
 * `generateModelFile` pattern with `model(db, table, structure, pk, unique, option)`.
 * Models are adapter-agnostic (validation rules, not SQL types).
 */

// ---------------------------------------------------------------------------
// Model Definitions
// ---------------------------------------------------------------------------

/**
 * SaaS model definitions in the format expected by the model system.
 * Each entry defines: table name, structure (validation rules), primary key,
 * unique constraints, and option (timestamp columns).
 */
const MODEL_DEFINITIONS = [
  {
    table: "tenants",
    structure: {
      name: "required|string",
      slug: "required|string",
      attributes: "object",
    },
    primary_key: "tenant_id",
    unique: ["slug"],
    option: { created_at: "created_at", modified_at: "modified_at" },
  },
  {
    table: "roles",
    structure: {
      tenant_id: "integer",
      name: "required|string",
    },
    primary_key: "role_id",
    unique: ["tenant_id", "name"],
    option: { created_at: "created_at", modified_at: "modified_at" },
  },
  {
    table: "users",
    structure: {
      email: "required|string",
      phone: "string",
      password_hash: "required|string",
      name: "required|string",
      unique_attribute: "required|string",
      tenant_id: "integer",
      role_id: "required|integer",
      attributes: "object",
    },
    primary_key: "user_id",
    unique: ["tenant_id", "unique_attribute"],
    option: { created_at: "created_at", modified_at: "modified_at" },
  },
  {
    table: "role_permissions",
    structure: {
      role_id: "required|integer",
      permission: "required|object",
    },
    primary_key: "role_permission_id",
    unique: ["role_permission_id"],
    option: { created_at: "created_at", modified_at: "modified_at" },
  },
  {
    table: "webhooks",
    structure: {
      tenant_id: "required|integer",
      url: "required|string",
      key: "required|string",
      secret: "required|string",
    },
    primary_key: "webhook_id",
    unique: ["webhook_id"],
    option: { created_at: "created_at", modified_at: "modified_at" },
  },
  {
    table: "webhook_logs",
    structure: {
      webhook_id: "required|integer",
      tenant_id: "required|integer",
      event_type: "required|string",
      payload: "required|object",
      status: "required|string",
      response_body: "string",
      response_status_code: "integer",
    },
    primary_key: "webhook_log_id",
    unique: ["webhook_log_id"],
    option: { created_at: "created_at" },
  },
];

// ---------------------------------------------------------------------------
// Code Generation
// ---------------------------------------------------------------------------

/**
 * Generate the content of a single model file following the existing pattern.
 *
 * @param {object} def - Model definition object
 * @returns {string} Generated model file content
 */
function generateModelContent(def) {
  const varName = def.table;
  const structStr = JSON.stringify(def.structure, null, 4);
  const uniqueStr = JSON.stringify(def.unique);

  const optionParts = [];
  if (def.option.created_at)
    optionParts.push(`created_at: "${def.option.created_at}"`);
  if (def.option.modified_at)
    optionParts.push(`modified_at: "${def.option.modified_at}"`);
  const optionStr = `{ ${optionParts.join(", ")} }`;

  return `import dbModelRouter from "db-model-router";

const { db, model } = dbModelRouter;

const ${varName} = model(
  db,
  "${def.table}",
  ${structStr},
  "${def.primary_key}",
  ${uniqueStr},
  ${optionStr},
);

export default ${varName};
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate model files for all SaaS tables.
 *
 * @param {string} adapter - Database adapter name (accepted for API consistency, not used for model content)
 * @returns {Array<{ relPath: string, content: string }>}
 */
function generateSaasModels(adapter) {
  const results = [];

  for (const def of MODEL_DEFINITIONS) {
    results.push({
      relPath: `models/${def.table}.js`,
      content: generateModelContent(def),
    });
  }

  return results;
}

module.exports = {
  generateSaasModels,
  generateModelContent,
  MODEL_DEFINITIONS,
};
