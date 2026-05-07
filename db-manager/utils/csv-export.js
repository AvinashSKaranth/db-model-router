"use strict";

/**
 * Escapes a single cell value for CSV (RFC 4180).
 * Wraps in double quotes if value contains comma, double quote, or newline.
 * Internal double quotes are doubled.
 * @param {*} value - Cell value (will be stringified)
 * @returns {string} Escaped CSV cell value
 */
function escapeCSVCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  var str = String(value);

  if (
    str.indexOf('"') !== -1 ||
    str.indexOf(",") !== -1 ||
    str.indexOf("\n") !== -1 ||
    str.indexOf("\r") !== -1
  ) {
    return '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Converts rows to a CSV string with proper escaping.
 * @param {string[]} columns - Column names for the header row
 * @param {object[]} rows - Array of row objects
 * @returns {string} RFC 4180 compliant CSV string
 */
function generateCSV(columns, rows) {
  var lines = [];

  // Header row - column names are escaped using the same rules as cell values
  var header = columns
    .map(function (col) {
      return escapeCSVCell(col);
    })
    .join(",");
  lines.push(header);

  // Data rows
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var cells = columns.map(function (col) {
      return escapeCSVCell(row[col]);
    });
    lines.push(cells.join(","));
  }

  // RFC 4180: each record ends with CRLF
  return lines.join("\r\n") + "\r\n";
}

module.exports = { generateCSV, escapeCSVCell };
