"use strict";

/**
 * Generates a timestamp string in ISO 8601 compact format (YYYYMMDDTHHmmss).
 * @returns {string} Timestamp string, e.g. "20250615T143022"
 */
function generateTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
}

/**
 * Generates an export filename for a table export.
 * Format: {tableName}_{YYYYMMDDTHHmmss}.csv
 * @param {string} tableName - The name of the table being exported
 * @returns {string} The generated filename
 */
function generateExportFilename(tableName) {
  const timestamp = generateTimestamp();
  return `${tableName}_${timestamp}.csv`;
}

/**
 * Generates an export filename for a query export.
 * Format: export_{YYYYMMDDTHHmmss}.csv
 * @returns {string} The generated filename
 */
function generateQueryExportFilename() {
  const timestamp = generateTimestamp();
  return `export_${timestamp}.csv`;
}

module.exports = {
  generateExportFilename,
  generateQueryExportFilename,
  generateTimestamp,
};
