"use strict";

/**
 * Filters a list of table names by a search string using case-insensitive substring matching.
 *
 * @param {string[]} tables - Array of table name strings
 * @param {string} search - The search string to filter by
 * @returns {string[]} Filtered array containing only tables whose names include the search string (case-insensitive)
 */
function filterTables(tables, search) {
  if (!search || search.trim() === "") {
    return tables.slice();
  }
  const needle = search.toLowerCase();
  return tables.filter(function (table) {
    return table.toLowerCase().indexOf(needle) !== -1;
  });
}

module.exports = filterTables;
