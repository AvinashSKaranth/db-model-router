"use strict";

const VALID_ADAPTERS = new Set([
  "mysql",
  "mariadb",
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

const COLUMN_RULE_RE =
  /^(encrypted\|)?(required\|)?(string|integer|numeric|boolean|object|datetime|auto_increment)(:[^|]+)?(\|[^|]+)*$/;

// Field types that may carry the `encrypted` flag. object columns must use
// dotted JSON-key encryption instead; auto_increment is managed by the DB.
const ENCRYPTABLE_TYPES = new Set([
  "string",
  "integer",
  "numeric",
  "boolean",
  "datetime",
]);

// Detect whether a column rule declares the `encrypted` flag.
function isEncryptedRule(rule) {
  return typeof rule === "string" && rule.split("|").includes("encrypted");
}

// Extract the base type token from a column rule (the first non-flag token).
function baseTypeOf(rule) {
  if (typeof rule !== "string") return null;
  const parts = rule.split("|");
  for (const p of parts) {
    if (p === "required" || p === "encrypted") continue;
    const token = p.indexOf(":") > -1 ? p.slice(0, p.indexOf(":")) : p;
    if (/^(string|integer|numeric|boolean|object|datetime|auto_increment)$/.test(token)) {
      return token;
    }
  }
  return null;
}

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
    } else {
      validateOptions(raw.options, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the buildout-config keys inside `options`.
 * Only the known keys are type-checked; unknown keys are passed through silently.
 *  - output: string (relative or absolute path)
 *  - saasStructure: boolean
 *  - apiBasePath: string starting with "/"
 *  - port: positive integer
 *  - session: "memory" | "redis" | "database"
 *  - rateLimiting / helmet / logger / loki: boolean
 */
function validateOptions(options, errors) {
  if (options.output !== undefined && options.output !== null) {
    if (typeof options.output !== "string" || options.output.length === 0) {
      errors.push({
        path: "options.output",
        message: "options.output must be a non-empty string path or null",
      });
    }
  }

  if (options.saasStructure !== undefined) {
    if (typeof options.saasStructure !== "boolean") {
      errors.push({
        path: "options.saasStructure",
        message: "options.saasStructure must be a boolean",
      });
    }
  }

  if (options.apiBasePath !== undefined) {
    if (
      typeof options.apiBasePath !== "string" ||
      !options.apiBasePath.startsWith("/")
    ) {
      errors.push({
        path: "options.apiBasePath",
        message: 'options.apiBasePath must be a string starting with "/" (e.g. "/api")',
      });
    }
  }

  if (options.port !== undefined) {
    if (
      typeof options.port !== "number" ||
      !Number.isInteger(options.port) ||
      options.port <= 0
    ) {
      errors.push({
        path: "options.port",
        message: "options.port must be a positive integer",
      });
    }
  }

  if (options.session !== undefined) {
    if (!["memory", "redis", "database"].includes(options.session)) {
      errors.push({
        path: "options.session",
        message: 'options.session must be one of: memory, redis, database',
      });
    }
  }

  for (const key of ["rateLimiting", "helmet", "logger", "loki"]) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") {
      errors.push({
        path: `options.${key}`,
        message: `options.${key} must be a boolean`,
      });
    }
  }

  if (options.encryption !== undefined) {
    validateEncryptionOptions(options.encryption, errors);
  }
}

/**
 * Validate the `options.encryption` block.
 * Shape: { key, version, keys? }
 *   key     — env:VAR or base64 literal key reference (required)
 *   version — positive integer tagging the active key (required)
 *   keys    — optional map of version → key reference (rotation history)
 */
function validateEncryptionOptions(encryption, errors) {
  if (encryption == null || typeof encryption !== "object" || Array.isArray(encryption)) {
    errors.push({
      path: "options.encryption",
      message: "options.encryption must be an object { key, version, keys? }",
    });
    return;
  }
  if (encryption.key === undefined || typeof encryption.key !== "string") {
    errors.push({
      path: "options.encryption.key",
      message: "options.encryption.key must be a string (env:VAR or base64 key)",
    });
  }
  const version = encryption.version;
  if (version === undefined) {
    errors.push({
      path: "options.encryption.version",
      message: "options.encryption.version must be a positive integer",
    });
  } else if (!Number.isInteger(version) || version < 1) {
    errors.push({
      path: "options.encryption.version",
      message: "options.encryption.version must be a positive integer",
    });
  }
  if (encryption.keys !== undefined) {
    if (typeof encryption.keys !== "object" || Array.isArray(encryption.keys)) {
      errors.push({
        path: "options.encryption.keys",
        message: "options.encryption.keys must be an object mapping version → key reference",
      });
    } else {
      for (const [v, ref] of Object.entries(encryption.keys)) {
        const n = parseInt(v, 10);
        if (!Number.isInteger(n) || n < 1) {
          errors.push({
            path: `options.encryption.keys.${v}`,
            message: `encryption keys version key must be a positive integer (got "${v}")`,
          });
        }
        if (typeof ref !== "string" || ref.length === 0) {
          errors.push({
            path: `options.encryption.keys.${v}`,
            message: `encryption key reference for version ${v} must be a non-empty string`,
          });
        }
      }
    }
  }
}

/**
 * Validate all table entries.
 */
function validateTables(tables, errors) {
  const tableNames = new Set(Object.keys(tables));

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
          message: `Invalid column rule "${rule}" for column "${colName}". Must match pattern: (encrypted|)?(required|)?(string|integer|numeric|boolean|object|datetime|auto_increment)`,
        });
      }
    }

    // Validate encrypted flags and dotted (virtual JSON) field definitions.
    for (const [colName, rule] of Object.entries(tableDef.columns)) {
      const colPath = `${basePath}.columns.${colName}`;
      const encrypted = isEncryptedRule(rule);
      const isDotted = colName.includes(".");

      if (isDotted) {
        const parent = colName.split(".")[0];
        if (!Object.prototype.hasOwnProperty.call(tableDef.columns, parent)) {
          errors.push({
            path: colPath,
            message: `Dotted field "${colName}" has no parent column "${parent}" in table "${tableName}"`,
          });
          continue;
        }
        const parentRule = tableDef.columns[parent];
        const parentType = baseTypeOf(parentRule);
        if (parentType !== "object") {
          errors.push({
            path: colPath,
            message: `Dotted field "${colName}" requires parent column "${parent}" to be declared as "object" (found "${parentType || parentRule}")`,
          });
        }
        // Only a single dot is supported (nested JSON is expressed via the
        // parent object's own structure, not deeper dotted column names).
        if (colName.split(".").length > 2) {
          errors.push({
            path: colPath,
            message: `Dotted field "${colName}" must use at most one level of nesting (parent.key)`,
          });
        }
        // Dotted fields must not be referenced by physical-column constraints.
        if (encrypted && !ENCRYPTABLE_TYPES.has(baseTypeOf(rule))) {
          errors.push({
            path: colPath,
            message: `Dotted field "${colName}" uses type "${baseTypeOf(rule)}" which cannot be encrypted. Supported: ${[...ENCRYPTABLE_TYPES].join(", ")}`,
          });
        }
      } else if (encrypted) {
        const type = baseTypeOf(rule);
        if (!ENCRYPTABLE_TYPES.has(type)) {
          errors.push({
            path: colPath,
            message: `Column "${colName}" uses type "${type}" which cannot be encrypted. Supported: ${[...ENCRYPTABLE_TYPES].join(", ")}`,
          });
        }
      }
    }

    // Validate that pk/unique/softDelete/search_columns never reference
    // virtual dotted fields (those are JSON keys, not physical columns).
    if (typeof pk === "string" && pk.includes(".")) {
      errors.push({
        path: `${basePath}.pk`,
        message: `pk cannot reference a dotted (virtual JSON) field "${pk}"`,
      });
    }
    if (
      typeof pk === "string" &&
      !pk.includes(".") &&
      columnNames.has(pk) &&
      isEncryptedRule(tableDef.columns[pk])
    ) {
      errors.push({
        path: `${basePath}.pk`,
        message: `pk cannot reference an encrypted column "${pk}" (encrypted fields cannot be used to look up rows)`,
      });
    }
    if (tableDef.unique !== undefined) {
      const groups = Array.isArray(tableDef.unique[0])
        ? tableDef.unique
        : [tableDef.unique];
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        if (Array.isArray(group)) {
          for (let i = 0; i < group.length; i++) {
            if (typeof group[i] === "string" && group[i].includes(".")) {
              errors.push({
                path: `${basePath}.unique[${g}][${i}]`,
                message: `unique cannot reference a dotted (virtual JSON) field "${group[i]}"`,
              });
            }
          }
        }
      }
    }
    if (
      typeof tableDef.softDelete === "string" &&
      tableDef.softDelete.includes(".")
    ) {
      errors.push({
        path: `${basePath}.softDelete`,
        message: `softDelete cannot reference a dotted (virtual JSON) field "${tableDef.softDelete}"`,
      });
    } else if (
      typeof tableDef.softDelete === "string" &&
      !tableDef.softDelete.includes(".") &&
      columnNames.has(tableDef.softDelete) &&
      isEncryptedRule(tableDef.columns[tableDef.softDelete])
    ) {
      errors.push({
        path: `${basePath}.softDelete`,
        message: `softDelete cannot reference an encrypted column "${tableDef.softDelete}" (encrypted fields cannot be filtered)`,
      });
    }
    if (Array.isArray(tableDef.search_columns)) {
      for (let i = 0; i < tableDef.search_columns.length; i++) {
        if (
          typeof tableDef.search_columns[i] === "string" &&
          tableDef.search_columns[i].includes(".")
        ) {
          errors.push({
            path: `${basePath}.search_columns[${i}]`,
            message: `search_columns cannot reference a dotted (virtual JSON) field "${tableDef.search_columns[i]}"`,
          });
        } else if (
          typeof tableDef.search_columns[i] === "string" &&
          !tableDef.search_columns[i].includes(".") &&
          columnNames.has(tableDef.search_columns[i]) &&
          isEncryptedRule(tableDef.columns[tableDef.search_columns[i]])
        ) {
          errors.push({
            path: `${basePath}.search_columns[${i}]`,
            message: `search_columns cannot reference an encrypted column "${tableDef.search_columns[i]}" (encrypted fields cannot be searched)`,
          });
        }
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
        // Support both flat arrays and array-of-arrays
        const groups = Array.isArray(tableDef.unique[0])
          ? tableDef.unique
          : [tableDef.unique];
        for (let g = 0; g < groups.length; g++) {
          const group = groups[g];
          const groupPath = Array.isArray(tableDef.unique[0])
            ? `${basePath}.unique[${g}]`
            : `${basePath}.unique`;
          if (!Array.isArray(group)) {
            errors.push({
              path: groupPath,
              message: `unique constraint must be an array of column names in table "${tableName}"`,
            });
            continue;
          }
          for (let i = 0; i < group.length; i++) {
            const entry = group[i];
            if (typeof entry !== "string") {
              errors.push({
                path: `${groupPath}[${i}]`,
                message: `unique entry must be a string in table "${tableName}"`,
              });
            } else if (
              columnNames.has(entry) &&
              isEncryptedRule(tableDef.columns[entry])
            ) {
              errors.push({
                path: `${groupPath}[${i}]`,
                message: `unique entry "${entry}" cannot reference an encrypted column "${entry}" (encrypted values are never equal, so uniqueness cannot be enforced)`,
              });
            } else if (entry !== pk && !columnNames.has(entry)) {
              errors.push({
                path: `${groupPath}[${i}]`,
                message: `unique entry "${entry}" does not match any column or the primary key "${pk}" in table "${tableName}"`,
              });
            }
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

    // Validate search_columns (free-text search targets)
    if (
      tableDef.search_columns !== undefined &&
      tableDef.search_columns !== null
    ) {
      if (!Array.isArray(tableDef.search_columns)) {
        errors.push({
          path: `${basePath}.search_columns`,
          message: `search_columns must be an array of strings in table "${tableName}"`,
        });
      } else {
        for (let i = 0; i < tableDef.search_columns.length; i++) {
          const col = tableDef.search_columns[i];
          if (typeof col !== "string" || col.length === 0) {
            errors.push({
              path: `${basePath}.search_columns[${i}]`,
              message: `search_columns entry must be a non-empty string in table "${tableName}"`,
            });
          } else if (!columnNames.has(col)) {
            errors.push({
              path: `${basePath}.search_columns[${i}]`,
              message: `search_columns entry "${col}" does not exist in table "${tableName}"`,
            });
          }
        }
      }
    }

    // Validate parent (route nesting)
    if (tableDef.parent !== undefined && tableDef.parent !== null) {
      if (typeof tableDef.parent !== "string") {
        errors.push({
          path: `${basePath}.parent`,
          message: `parent must be a string or null in table "${tableName}"`,
        });
      } else if (!tableNames.has(tableDef.parent)) {
        errors.push({
          path: `${basePath}.parent`,
          message: `parent "${tableDef.parent}" does not reference an existing table in table "${tableName}"`,
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
