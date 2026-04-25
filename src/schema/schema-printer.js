"use strict";

/**
 * Serialize a parsed schema (internal representation from parseSchema())
 * back into a JSON string.
 *
 * - Tables are sorted alphabetically by name.
 * - Relationships are sorted by [parent, child].
 * - Output uses 2-space indentation with a trailing newline.
 * - Optional fields (options, unique, softDelete, relationships) are preserved.
 *
 * @param {object} schema — internal representation from parseSchema()
 * @returns {string} — JSON with 2-space indent + trailing newline
 */
function printSchema(schema) {
  const output = {};

  output.adapter = schema.adapter;
  output.framework = schema.framework;

  // Preserve options if present and non-empty
  if (schema.options && Object.keys(schema.options).length > 0) {
    output.options = schema.options;
  }

  // Sort tables alphabetically by name
  const sortedTableNames = Object.keys(schema.tables).sort();
  const tables = {};
  for (const name of sortedTableNames) {
    const table = schema.tables[name];
    const tableDef = {
      columns: table.columns,
    };

    // Include pk if not the default "id"
    if (table.pk && table.pk !== "id") {
      tableDef.pk = table.pk;
    }

    // Preserve unique if not the default [pk]
    const defaultUnique = [table.pk || "id"];
    const hasCustomUnique =
      table.unique &&
      (table.unique.length !== defaultUnique.length ||
        table.unique.some((v, i) => v !== defaultUnique[i]));
    if (hasCustomUnique) {
      tableDef.unique = table.unique;
    }

    // Preserve softDelete if set
    if (table.softDelete !== null && table.softDelete !== undefined) {
      tableDef.softDelete = table.softDelete;
    }

    // Preserve timestamps if not the default { created_at: null, modified_at: null }
    if (table.timestamps) {
      const hasCustomTimestamps =
        table.timestamps.created_at !== null ||
        table.timestamps.modified_at !== null;
      if (hasCustomTimestamps) {
        tableDef.timestamps = table.timestamps;
      }
    }

    tables[name] = tableDef;
  }
  output.tables = tables;

  // Sort relationships by [parent, child] and include if non-empty
  if (schema.relationships && schema.relationships.length > 0) {
    output.relationships = [...schema.relationships].sort((a, b) => {
      const cmp = a.parent.localeCompare(b.parent);
      if (cmp !== 0) return cmp;
      return a.child.localeCompare(b.child);
    });
  }

  return JSON.stringify(output, null, 2) + "\n";
}

module.exports = { printSchema };
