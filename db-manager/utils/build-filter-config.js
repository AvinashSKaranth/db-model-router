"use strict";

/**
 * Builds filter bar configuration from a table schema.
 * This is a pure function extracted from the client-side filter bar rendering
 * logic so it can be tested without DOM dependencies.
 *
 * @param {{ columns: Array<{ name: string }> }} schema - Table schema
 * @returns {Array<{ column: string, placeholder: string }>} Filter input configs
 */
function buildFilterConfig(schema) {
  if (!schema || !schema.columns) return [];
  return schema.columns.map(function (col) {
    return { column: col.name, placeholder: col.name };
  });
}

module.exports = { buildFilterConfig };
