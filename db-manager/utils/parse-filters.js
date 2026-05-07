"use strict";

/**
 * Parses filter query parameters into adapter-compatible filter arrays.
 *
 * Supports two formats:
 * 1. New format: filter[0][col]=name&filter[0][op]=like&filter[0][val]=ali
 *    → [['name', 'like', 'ali']]
 * 2. Legacy format: filter[column_name]=value (defaults to 'like' operator)
 *    → [['column_name', 'like', 'value']]
 *
 * @param {object} queryParams - The query parameters object (e.g., req.query)
 * @returns {Array<[string, string, string]>} Array of [column, operator, value] tuples
 */
function parseFilters(queryParams) {
  var filters = [];

  if (!queryParams || typeof queryParams !== "object") {
    return filters;
  }

  var filterParam = queryParams.filter;

  if (!filterParam || typeof filterParam !== "object") {
    // Try flat key format: { 'filter[name]': 'ali' }
    var keys = Object.keys(queryParams);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var match = key.match(/^filter\[(.+)\]$/);
      if (match) {
        var column = match[1];
        var value = queryParams[key];
        if (typeof value === "string" && value.length > 0) {
          filters.push([column, "like", value]);
        }
      }
    }
    return filters;
  }

  // Check if it's the new indexed format: filter[0][col], filter[0][op], filter[0][val]
  // Express parses this as: { filter: { '0': { col: 'name', op: 'like', val: 'ali' }, ... } }
  // or as: { filter: [ { col: 'name', op: 'like', val: 'ali' } ] }
  if (Array.isArray(filterParam)) {
    // Array format
    for (var j = 0; j < filterParam.length; j++) {
      var item = filterParam[j];
      if (
        item &&
        item.col &&
        item.op &&
        item.val !== undefined &&
        item.val !== ""
      ) {
        filters.push([item.col, item.op, item.val]);
      }
    }
    return filters;
  }

  // Object format — could be indexed { '0': { col, op, val } } or legacy { name: 'ali' }
  var filterKeys = Object.keys(filterParam);

  // Check if first key is numeric (indexed format)
  if (filterKeys.length > 0 && /^\d+$/.test(filterKeys[0])) {
    for (var k = 0; k < filterKeys.length; k++) {
      var entry = filterParam[filterKeys[k]];
      if (
        entry &&
        entry.col &&
        entry.op &&
        entry.val !== undefined &&
        entry.val !== ""
      ) {
        filters.push([entry.col, entry.op, entry.val]);
      }
    }
    return filters;
  }

  // Legacy nested object format: { filter: { name: 'ali', email: 'gmail' } }
  for (var m = 0; m < filterKeys.length; m++) {
    var col = filterKeys[m];
    var val = filterParam[col];
    if (typeof val === "string" && val.length > 0) {
      filters.push([col, "like", val]);
    }
  }

  return filters;
}

module.exports = { parseFilters };
