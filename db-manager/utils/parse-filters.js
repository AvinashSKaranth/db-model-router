"use strict";

/**
 * Parses filter query parameters into adapter-compatible filter arrays.
 *
 * Accepts a query params object (e.g., req.query) and extracts all keys
 * matching the pattern `filter[column_name]`. Returns an array of
 * [column, operator, value] tuples for case-insensitive LIKE matching.
 *
 * @param {object} queryParams - The query parameters object (e.g., req.query)
 * @returns {Array<[string, string, string]>} Array of [column, 'like', value] tuples
 *
 * @example
 * parseFilters({ 'filter[name]': 'ali', 'filter[email]': 'gmail', page: '0' })
 * // Returns: [['name', 'like', 'ali'], ['email', 'like', 'gmail']]
 */
function parseFilters(queryParams) {
  var filters = [];

  if (!queryParams || typeof queryParams !== "object") {
    return filters;
  }

  // Handle Express-parsed nested object format: { filter: { name: 'ali', email: 'gmail' } }
  if (queryParams.filter && typeof queryParams.filter === "object") {
    var filterObj = queryParams.filter;
    var filterKeys = Object.keys(filterObj);
    for (var k = 0; k < filterKeys.length; k++) {
      var col = filterKeys[k];
      var val = filterObj[col];
      if (typeof val === "string" && val.length > 0) {
        filters.push([col, "like", val]);
      }
    }
    return filters;
  }

  // Handle flat key format: { 'filter[name]': 'ali', 'filter[email]': 'gmail' }
  var keys = Object.keys(queryParams);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var match = key.match(/^filter\[(.+)\]$/);

    if (match) {
      var column = match[1];
      var value = queryParams[key];

      // Only add filter if value is a non-empty string
      if (typeof value === "string" && value.length > 0) {
        filters.push([column, "like", value]);
      }
    }
  }

  return filters;
}

module.exports = { parseFilters };
