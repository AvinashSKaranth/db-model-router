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

    tables[tableName] = {
      name: tableName,
      columns: { ...tableDef.columns },
      pk,
      unique,
      softDelete,
      timestamps,
    };
  }

  return {
    adapter: raw.adapter,
    framework: raw.framework,
    tables,
    relationships: raw.relationships ? [...raw.relationships] : [],
    options: raw.options ? { ...raw.options } : {},
  };
}

module.exports = { parseSchema };
