"use strict";

/**
 * Convert a parsed schema into the model metadata array used by
 * generateModelFile(), generateRouteFile(), generateOpenAPISpec().
 *
 * Each ModelMeta matches the shape returned by the existing introspection
 * functions:
 *   { table, structure, primary_key, unique, option }
 *
 * - The primary key column is excluded from `structure`.
 * - Timestamp columns (created_at, modified_at values) are excluded from `structure`.
 * - The softDelete column is excluded from `structure`.
 * - Output is sorted alphabetically by table name.
 *
 * @param {{ adapter: string, framework: string, tables: object, relationships: Array, options: object }} schema
 * @returns {Array<{ table: string, structure: object, primary_key: string, unique: string[], option: { safeDelete: string|null, created_at: string|null, modified_at: string|null } }>}
 */
function schemaToModelMeta(schema) {
  const tableNames = Object.keys(schema.tables).sort();
  return tableNames.map((tableName) => {
    const tableDef = schema.tables[tableName];

    // Build the set of columns to exclude from structure
    const excludeSet = new Set();

    // Exclude primary key
    excludeSet.add(tableDef.pk);

    // Exclude timestamp columns
    if (tableDef.timestamps) {
      if (tableDef.timestamps.created_at) {
        excludeSet.add(tableDef.timestamps.created_at);
      }
      if (tableDef.timestamps.modified_at) {
        excludeSet.add(tableDef.timestamps.modified_at);
      }
    }

    // Exclude softDelete column
    if (tableDef.softDelete) {
      excludeSet.add(tableDef.softDelete);
    }

    // Build structure, excluding the above columns
    const structure = {};
    for (const [colName, rule] of Object.entries(tableDef.columns)) {
      if (!excludeSet.has(colName)) {
        // Strip auto_increment and datetime columns from model structure
        // (DB handles these automatically)
        const baseType = rule.replace(/^required\|/, "");
        if (baseType === "auto_increment") continue;
        structure[colName] = rule;
      }
    }

    // Map option fields
    const option = {
      safeDelete: tableDef.softDelete || null,
      created_at: tableDef.timestamps
        ? tableDef.timestamps.created_at || null
        : null,
      modified_at: tableDef.timestamps
        ? tableDef.timestamps.modified_at || null
        : null,
    };

    return {
      table: tableName,
      structure,
      primary_key: tableDef.pk,
      unique: [...tableDef.unique],
      option,
    };
  });
}

module.exports = { schemaToModelMeta };
