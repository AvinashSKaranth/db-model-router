"use strict";

/**
 * Computes the next sort state given the current state and the clicked column.
 *
 * Sort state cycles: null → 'asc' → 'desc' → null
 * Clicking a different column resets to ascending on the new column.
 *
 * @param {{ column: string|null, dir: string|null }} currentState - Current sort state
 * @param {string} clickedColumn - The column header that was clicked
 * @returns {{ column: string|null, dir: string|null }} The new sort state
 */
function nextSortState(currentState, clickedColumn) {
  var currentColumn = currentState && currentState.column;
  var currentDir = currentState && currentState.dir;

  // Clicking a different column → start ascending on new column
  if (clickedColumn !== currentColumn) {
    return { column: clickedColumn, dir: "asc" };
  }

  // Same column clicked — cycle through states
  if (currentDir === null || currentDir === undefined) {
    return { column: clickedColumn, dir: "asc" };
  }

  if (currentDir === "asc") {
    return { column: clickedColumn, dir: "desc" };
  }

  // currentDir === 'desc' → clear sort
  return { column: null, dir: null };
}

module.exports = { nextSortState };
