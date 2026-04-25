"use strict";

const VALID_ADAPTERS = new Set([
  "mysql",
  "postgres",
  "sqlite3",
  "mongodb",
  "mssql",
  "cockroachdb",
  "oracle",
  "redis",
  "dynamodb",
]);

const VALID_FRAMEWORKS = new Set(["express", "ultimate-express"]);

const COLUMN_RULE_RE = /^(required\|)?(string|integer|numeric|boolean|object)$/;

class SchemaValidationError extends Error {
  constructor(errors) {
    super(`Schema validation failed: ${errors.length} error(s)`);
    this.errors = errors;
  }
}

/**
 * Validate a raw schema object and collect all errors.
 * @param {object} raw — parsed JSON object
 * @returns {{ valid: boolean, errors: Array<{ path: string, message: string }> }}
 */
function validateSchema(raw) {
  const errors = [];

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ path: "", message: "Schema must be a non-null object" });
    return { valid: false, errors };
  }

  // adapter
  if (!raw.adapter || typeof raw.adapter !== "string") {
    errors.push({
      path: "adapter",
      message: "adapter is required and must be a string",
    });
  } else if (!VALID_ADAPTERS.has(raw.adapter)) {
    errors.push({
      path: "adapter",
      message: `Invalid adapter "${raw.adapter}". Must be one of: ${[...VALID_ADAPTERS].join(", ")}`,
    });
  }

  // framework
  if (!raw.framework || typeof raw.framework !== "string") {
    errors.push({
      path: "framework",
      message: "framework is required and must be a string",
    });
  } else if (!VALID_FRAMEWORKS.has(raw.framework)) {
    errors.push({
      path: "framework",
      message: `Invalid framework "${raw.framework}". Must be one of: ${[...VALID_FRAMEWORKS].join(", ")}`,
    });
  }

  // tables
  if (
    raw.tables == null ||
    typeof raw.tables !== "object" ||
    Array.isArray(raw.tables)
  ) {
    errors.push({
      path: "tables",
      message: "tables is required and must be an object",
    });
  } else {
    validateTables(raw.tables, errors);
  }

  // relationships
  if (raw.relationships !== undefined) {
    if (!Array.isArray(raw.relationships)) {
      errors.push({
        path: "relationships",
        message: "relationships must be an array",
      });
    } else {
      const tableNames =
        raw.tables &&
        typeof raw.tables === "object" &&
        !Array.isArray(raw.tables)
          ? new Set(Object.keys(raw.tables))
          : new Set();
      validateRelationships(raw.relationships, tableNames, errors);
    }
  }

  // options
  if (raw.options !== undefined) {
    if (
      raw.options == null ||
      typeof raw.options !== "object" ||
      Array.isArray(raw.options)
    ) {
      errors.push({ path: "options", message: "options must be an object" });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all table entries.
 */
function validateTables(tables, errors) {
  for (const [tableName, tableDef] of Object.entries(tables)) {
    const basePath = `tables.${tableName}`;

    if (
      tableDef == null ||
      typeof tableDef !== "object" ||
      Array.isArray(tableDef)
    ) {
      errors.push({
        path: basePath,
        message: `Table "${tableName}" must be an object`,
      });
      continue;
    }

    // columns
    if (
      tableDef.columns == null ||
      typeof tableDef.columns !== "object" ||
      Array.isArray(tableDef.columns)
    ) {
      errors.push({
        path: `${basePath}.columns`,
        message: `Table "${tableName}" must have a columns object`,
      });
      continue;
    }

    const columnNames = new Set(Object.keys(tableDef.columns));
    const pk = tableDef.pk || "id";

    // Validate each column rule
    for (const [colName, rule] of Object.entries(tableDef.columns)) {
      if (typeof rule !== "string" || !COLUMN_RULE_RE.test(rule)) {
        errors.push({
          path: `${basePath}.columns.${colName}`,
          message: `Invalid column rule "${rule}" for column "${colName}". Must match pattern: (required|)?(string|integer|numeric|boolean|object)`,
        });
      }
    }

    // Validate unique entries
    if (tableDef.unique !== undefined) {
      if (!Array.isArray(tableDef.unique)) {
        errors.push({
          path: `${basePath}.unique`,
          message: `unique must be an array in table "${tableName}"`,
        });
      } else {
        for (let i = 0; i < tableDef.unique.length; i++) {
          const entry = tableDef.unique[i];
          if (typeof entry !== "string") {
            errors.push({
              path: `${basePath}.unique[${i}]`,
              message: `unique entry must be a string in table "${tableName}"`,
            });
          } else if (entry !== pk && !columnNames.has(entry)) {
            errors.push({
              path: `${basePath}.unique[${i}]`,
              message: `unique entry "${entry}" does not match any column or the primary key "${pk}" in table "${tableName}"`,
            });
          }
        }
      }
    }

    // Validate softDelete
    if (tableDef.softDelete !== undefined && tableDef.softDelete !== null) {
      if (typeof tableDef.softDelete !== "string") {
        errors.push({
          path: `${basePath}.softDelete`,
          message: `softDelete must be a string in table "${tableName}"`,
        });
      } else if (!columnNames.has(tableDef.softDelete)) {
        errors.push({
          path: `${basePath}.softDelete`,
          message: `softDelete column "${tableDef.softDelete}" does not exist in table "${tableName}"`,
        });
      }
    }
  }
}

/**
 * Validate all relationship entries.
 */
function validateRelationships(relationships, tableNames, errors) {
  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i];
    const basePath = `relationships[${i}]`;

    if (rel == null || typeof rel !== "object" || Array.isArray(rel)) {
      errors.push({
        path: basePath,
        message: "Each relationship must be an object",
      });
      continue;
    }

    if (!rel.parent || typeof rel.parent !== "string") {
      errors.push({
        path: `${basePath}.parent`,
        message: "Relationship must have a parent string",
      });
    } else if (!tableNames.has(rel.parent)) {
      errors.push({
        path: `${basePath}.parent`,
        message: `Relationship parent "${rel.parent}" does not reference an existing table`,
      });
    }

    if (!rel.child || typeof rel.child !== "string") {
      errors.push({
        path: `${basePath}.child`,
        message: "Relationship must have a child string",
      });
    } else if (!tableNames.has(rel.child)) {
      errors.push({
        path: `${basePath}.child`,
        message: `Relationship child "${rel.child}" does not reference an existing table`,
      });
    }

    if (!rel.foreignKey || typeof rel.foreignKey !== "string") {
      errors.push({
        path: `${basePath}.foreignKey`,
        message: "Relationship must have a foreignKey string",
      });
    }
  }
}

module.exports = {
  SchemaValidationError,
  validateSchema,
  VALID_ADAPTERS,
  VALID_FRAMEWORKS,
  COLUMN_RULE_RE,
};
