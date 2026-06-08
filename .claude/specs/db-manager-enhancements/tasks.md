# Implementation Plan: DB Manager Enhancements

## Overview

This plan implements six feature areas for the DB Manager App: CSV export (replacing JSON), Material Icons, column filtering, column sorting, a Query page, and a Dashboard page. Tasks are ordered to build foundational utilities first, then API routes, then views and client-side logic, with property tests placed close to the code they validate.

## Tasks

- [x] 1. Create CSV export utility and extracted utility modules
  - [x] 1.1 Create `db-manager/utils/csv-export.js` with `generateCSV` and `escapeCSVCell` functions
    - Implement RFC 4180 compliant CSV generation
    - Handle null/undefined as empty string, escape commas/quotes/newlines
    - Export both functions via `module.exports`
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.3_

  - [x] 1.2 Create `db-manager/utils/sort-state.js` with `nextSortState` function
    - Implement sort state cycling: null → asc → desc → null
    - Clicking a different column resets to asc on new column
    - Signature: `nextSortState(currentState, clickedColumn) → { column, dir }`
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

  - [x] 1.3 Create `db-manager/utils/parse-filters.js` with `parseFilters` function
    - Parse `filter[column_name]=value` query params into adapter-compatible filter arrays
    - Return array of `[column, operator, value]` tuples for case-insensitive LIKE matching
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 1.4 Write property test: CSV generation round-trip (Property 1)
    - **Property 1: CSV generation round-trip**
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.3**
    - File: `test/properties/db-manager-enhancements.property.test.js`

  - [x] 1.5 Write property test: CSV cell escaping correctness (Property 2)
    - **Property 2: CSV cell escaping correctness**
    - **Validates: Requirements 1.4**
    - File: `test/properties/db-manager-enhancements.property.test.js`

  - [x] 1.6 Write property test: Sort state machine cycling (Property 7)
    - **Property 7: Sort state machine cycling**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6**
    - File: `test/properties/db-manager-enhancements.property.test.js`

- [x] 2. Checkpoint - Verify utility modules and property tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Modify API routes for filtering, sorting, CSV export, query, and dashboard
  - [x] 3.1 Update `GET /api/tables/:name/rows` to accept `filter[column]=value` query params
    - Import and use `parseFilters` to convert query params to adapter filter format
    - Pass parsed filters to `proxy.listRows` so filtering is server-side
    - Ensure filtered count is returned for correct pagination
    - _Requirements: 5.3, 5.4, 10.1, 10.2, 10.3, 10.4_

  - [x] 3.2 Change `POST /api/tables/:name/export` from JSON to CSV response
    - Import `generateCSV` from `csv-export.js`
    - Fetch schema to get column names for CSV header
    - Set Content-Type to `text/csv` and Content-Disposition with timestamped filename
    - Filename format: `{table_name}_{YYYYMMDDTHHmmss}.csv`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 3.3 Add `POST /api/query` endpoint for executing custom SQL
    - Accept `{ query }` in request body
    - Execute via `db.query(queryText)` on the library adapter
    - Return `{ columns, data, rowCount }` on success
    - Return `{ error: true, message }` with HTTP 500 on failure
    - Record query in metadata DB on success
    - _Requirements: 7.5, 7.6, 7.7, 7.9, 11.1, 11.2, 11.3, 11.4_

  - [x] 3.4 Add `POST /api/query/export` endpoint for CSV export of query results
    - Accept `{ query }` in request body
    - Execute query, generate CSV from results
    - Set Content-Type to `text/csv`, filename: `export_{YYYYMMDDTHHmmss}.csv`
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.5 Add `GET /api/dashboard` endpoint for table metadata
    - Iterate all tables, get schema (column count) and row count for each
    - Return `{ tables: [{ name, columnCount, rowCount }] }`
    - _Requirements: 8.3, 8.4, 8.5, 8.6_

  - [x] 3.6 Write property test: Export filename format (Property 3)
    - **Property 3: Export filename format**
    - **Validates: Requirements 1.3, 2.2**
    - File: `test/properties/db-manager-enhancements.property.test.js`

  - [x] 3.7 Write property test: Server-side filter correctness (Property 5)
    - **Property 5: Server-side filter correctness**
    - **Validates: Requirements 5.3, 5.4, 5.5, 10.1, 10.2, 10.3**
    - File: `test/properties/db-manager-enhancements.property.test.js`

  - [x] 3.8 Write property test: Filtered row count accuracy (Property 6)
    - **Property 6: Filtered row count accuracy**
    - **Validates: Requirements 10.4**
    - File: `test/properties/db-manager-enhancements.property.test.js`

  - [x] 3.9 Write property test: Query history recording (Property 8)
    - **Property 8: Query history recording**
    - **Validates: Requirements 7.9, 11.4**
    - File: `test/properties/db-manager-enhancements.property.test.js`

- [x] 4. Checkpoint - Verify API routes and property tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add view routes and EJS templates for Dashboard and Query pages
  - [x] 5.1 Update `db-manager/routes/views.js` to add `/dashboard` and `/query` routes
    - `GET /dashboard` renders `dashboard.ejs` with same template variables as index
    - `GET /query` renders `query.ejs` with same template variables as index
    - _Requirements: 7.2, 8.2_

  - [x] 5.2 Update `db-manager/views/layout.ejs` to add Material Icons CDN link
    - Add `<link>` for Google Material Icons font in `<head>`
    - _Requirements: 3.1_

  - [x] 5.3 Update `db-manager/views/partials/sidebar.ejs` with nav links and reordered sections
    - Add Dashboard and Query standalone nav links above the accordion
    - Order: Dashboard link → Query link → Tables accordion → History accordion
    - Add `nav-link` class and `data-page` attribute for active state tracking
    - _Requirements: 7.1, 8.1, 9.1, 9.2, 9.3, 9.4_

  - [x] 5.4 Update `db-manager/views/partials/data-panel.ejs` with filter bar placeholder and icon buttons
    - Add a `<div class="filter-bar"></div>` container above the data table wrapper
    - Update toolbar buttons to include Material Icon spans alongside text labels
    - Align toolbar buttons to the right with CSS class
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1_

  - [x] 5.5 Create `db-manager/views/dashboard.ejs` template
    - Include sidebar partial, render a main content area with `.dashboard-content` container
    - Cards will be populated by client-side JS from `/api/dashboard`
    - _Requirements: 8.3, 8.7_

  - [x] 5.6 Create `db-manager/views/query.ejs` template
    - Include sidebar partial, render main content with textarea, Run button, results table, Export button, error box
    - _Requirements: 7.3, 7.4, 7.8_

- [x] 6. Update client-side JavaScript (`db-manager/public/js/app.js`)
  - [x] 6.1 Add filter bar rendering logic
    - After schema loads, dynamically create filter inputs inside `.filter-bar`
    - One input per column with `data-column` attribute and column name as placeholder
    - Debounce input events (300ms) and re-fetch rows with filter params
    - Reset pagination to page 0 when filters change
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 6.2 Add sort click handling on column headers
    - Make column headers clickable with `sortable` class
    - Track sort state using `nextSortState` logic (inline, matching extracted utility)
    - Display Material Icon sort indicators (arrow_upward / arrow_downward)
    - Pass sort/dir params to rows API; reset pagination on sort change
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 6.3 Update row action buttons to use Material Icons
    - Replace "Edit" text with `<span class="material-icons">edit</span>` plus `aria-label="Edit row"`
    - Add delete button per row with `<span class="material-icons">delete</span>` plus `aria-label="Delete row"`
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 6.4 Update CSV export download logic
    - Change export fetch to expect `text/csv` response (blob download)
    - Use the filename from Content-Disposition header or fallback to `{table}_{timestamp}.csv`
    - _Requirements: 1.1, 1.5, 1.6_

  - [x] 6.5 Add Query page client-side logic
    - Detect if on query page (check for `.query-content` element)
    - Bind Run button to POST `/api/query` with textarea value
    - Render results in a dynamic table; show error messages in error box
    - Bind Export button to POST `/api/query/export` and trigger CSV download
    - _Requirements: 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 6.6 Add Dashboard page client-side logic
    - Detect if on dashboard page (check for `.dashboard-content` element)
    - Fetch `/api/dashboard` and render table cards with name, column count, row count
    - Make cards clickable to navigate to `/?table={name}` (or select table)
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 6.7 Add sidebar nav link active state and click handling
    - Highlight active nav link based on current page URL
    - Dashboard link navigates to `/dashboard`, Query link navigates to `/query`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 6.8 Write property test: Filter bar matches schema columns (Property 4)
    - **Property 4: Filter bar matches schema columns**
    - **Validates: Requirements 5.1, 5.2**
    - Extract filter bar generation to a testable pure function in `db-manager/utils/build-filter-config.js`
    - File: `test/properties/db-manager-enhancements.property.test.js`

- [x] 7. Update CSS styles (`db-manager/public/css/style.css`)
  - [x] 7.1 Add filter bar styles
    - `.filter-bar` as a flex row with gap, matching table column widths
    - `.filter-input` styled consistently with existing `.table-search`
    - _Requirements: 5.1, 5.2_

  - [x] 7.2 Add sort indicator styles
    - `.sortable` cursor pointer, hover highlight
    - `.sort-icon` inline icon sizing and color
    - _Requirements: 6.4, 6.5_

  - [x] 7.3 Add sidebar nav link styles
    - `.nav-links` section with `.nav-link` items styled like accordion toggles
    - `.nav-link.active` highlighted state
    - Material Icons inline with nav text
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 7.4 Add Query page styles
    - `.query-content` layout with textarea, button row, results table, error box
    - Error box styled with red border and background
    - _Requirements: 7.3, 7.4, 7.6, 7.7_

  - [x] 7.5 Add Dashboard page styles
    - `.dashboard-content` grid layout for table cards
    - `.table-card` with dark theme surface, hover effect, metadata display
    - _Requirements: 8.3, 8.7_

  - [x] 7.6 Update toolbar button alignment
    - `.data-toolbar` flex with `justify-content: flex-end` or margin-left auto on button group
    - Icon + text button layout with gap
    - _Requirements: 4.4, 4.5_

- [x] 8. Checkpoint - Verify all UI changes render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Write integration tests
  - [x] 9.1 Write integration tests for filter + pagination cycle
    - Apply filter via query params, verify filtered count, paginate, verify pages
    - File: `test/integration/db-manager-enhancements.test.js`
    - _Requirements: 5.3, 5.4, 10.1, 10.4_

  - [x] 9.2 Write integration tests for query execution
    - Valid SQL returns results; invalid SQL returns error with 500
    - File: `test/integration/db-manager-enhancements.test.js`
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 9.3 Write integration tests for CSV export
    - Verify Content-Type, Content-Disposition, filename format, CSV body format
    - File: `test/integration/db-manager-enhancements.test.js`
    - _Requirements: 1.1, 1.3, 1.5, 1.6_

  - [x] 9.4 Write integration tests for dashboard endpoint
    - Verify all tables listed with columnCount and rowCount
    - File: `test/integration/db-manager-enhancements.test.js`
    - _Requirements: 8.3, 8.4, 8.5, 8.6_

  - [x] 9.5 Write integration tests for sort parameter passing
    - Verify sorted results from API with sort/dir params
    - File: `test/integration/db-manager-enhancements.test.js`
    - _Requirements: 6.1, 6.2_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Integration tests use supertest against the Express app with a test SQLite database
- All code uses CommonJS (`require`/`module.exports`) to match the existing codebase
- The `fast-check` library (already installed) is used for property-based tests
- Utility functions are extracted into `db-manager/utils/` for testability without DOM
