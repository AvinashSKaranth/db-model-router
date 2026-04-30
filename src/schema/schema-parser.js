"use strict";

const { validateSchema, SchemaValidationError } = require("./schema-validator");

/**
 * Parse a schema from a JSON string or plain object.
 *
 * - If `input` is a string, JSON.parse it (wrapping parse errors).
 * - Validate via validateSchema(); throw SchemaValidationError if invalid.
 * - Normalize each table with defaults for pk, unique, timestamps, softDelete.
 * - Return the internal { adapter, framework, tables, relationships, options } representation.
 *
 * @param {string|object} input — raw JSON string or parsed object
 * @returns {{ adapter: string, framework: string, tables: object, relationships: Array, options: object }}
 * @throws {SchemaValidationError}
 */
function parseSchema(input) {
  let raw = input;

  // If string, attempt JSON.parse; wrap errors
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      throw new SchemaValidationError([
        {
          path: "",
          message: `Invalid JSON: ${err.message}`,
        },
      ]);
    }
  }

  // Validate
  const result = validateSchema(raw);
  if (!result.valid) {
    throw new SchemaValidationError(result.errors);
  }

  // Normalize tables
  const tables = {};
  for (const [tableName, tableDef] of Object.entries(raw.tables)) {
    const pk = tableDef.pk || "id";
    const unique = tableDef.unique !== undefined ? [...tableDef.unique] : [pk];
    const timestamps =
      tableDef.timestamps !== undefined
        ? { ...tableDef.timestamps }
        : { created_at: null, modified_at: null };
    // Ensure timestamps always has both keys
    if (!("created_at" in timestamps)) {
      timestamps.created_at = null;
    }
    if (!("modified_at" in timestamps)) {
      timestamps.modified_at = null;
    }
    const softDelete =
      tableDef.softDelete !== undefined ? tableDef.softDelete : null;

    const parent =
      tableDef.parent !== undefined && tableDef.parent !== null
        ? tableDef.parent
        : null;

    tables[tableName] = {
      name: tableName,
      columns: { ...tableDef.columns },
      pk,
      unique,
      softDelete,
      timestamps,
      parent,
    };
  }

  // Derive relationships from parent fields on tables.
  // If a table has parent set, create a relationship entry.
  // Also merge any explicitly declared relationships.
  const derivedRelationships = [];
  const seenRels = new Set();

  for (const [tableName, tableDef] of Object.entries(tables)) {
    if (tableDef.parent) {
      const parentTable = tables[tableDef.parent];
      if (parentTable) {
        // FK column is the parent's PK name (e.g. post_id for posts)
        const fkColumn = parentTable.pk;
        const key = `${tableDef.parent}:${tableName}:${fkColumn}`;
        if (!seenRels.has(key)) {
          derivedRelationships.push({
            parent: tableDef.parent,
            child: tableName,
            foreignKey: fkColumn,
          });
          seenRels.add(key);
        }
      }
    }
  }

  // Merge explicit relationships (from the relationships array) that aren't already derived
  if (raw.relationships) {
    for (const rel of raw.relationships) {
      const key = `${rel.parent}:${rel.child}:${rel.foreignKey}`;
      if (!seenRels.has(key)) {
        derivedRelationships.push({ ...rel });
        seenRels.add(key);
      }
    }
  }

  return {
    adapter: raw.adapter,
    framework: raw.framework,
    tables,
    relationships: derivedRelationships,
    options: raw.options ? { ...raw.options } : {},
  };
}

module.exports = { parseSchema };
