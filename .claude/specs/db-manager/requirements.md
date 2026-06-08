# Requirements Document

## Introduction

The DB Manager feature adds a `--db-manager` flag to the existing `generate` CLI command in db-model-router. When this flag is used, the CLI scaffolds a dark-themed, EJS-rendered database management UI into the generated codebase. The UI is mounted at `/database` and provides password-based login, table browsing, schema inspection, data viewing with filtering/sorting/pagination, and raw SQL query execution. The feature targets SQL database adapters only (MySQL, PostgreSQL, SQLite3, MSSQL, CockroachDB, Oracle).

## Glossary

- **CLI**: The db-model-router command-line interface entry point (`src/cli/main.js`)
- **Generate_Command**: The `generate` subcommand handler (`src/cli/commands/generate.js`) that reads a schema file and produces models, routes, tests, and other artifacts
- **DB_Manager_Generator**: The new module responsible for producing all DB Manager files (EJS templates, route handler, middleware) as `{ relPath, content }` objects
- **DB_Manager_UI**: The set of EJS-rendered pages (login page, manager page with sidebar and tabs) served at `/database`
- **DB_Manager_Route**: The Express router mounted at `/database` that handles authentication, table listing, table data retrieval, and query execution
- **Auth_Middleware**: Middleware that checks `req.session["db-manager"]` to protect DB Manager pages and API endpoints behind login
- **Planned_File**: An object with `{ relPath, content }` representing a file to be written by the generate command
- **SQL_Adapter**: One of the supported SQL database adapters: mysql, mariadb, postgres, sqlite3, mssql, cockroachdb, oracle
- **Session**: The express-session instance already configured in the generated codebase via `commons/session.js`
- **EJS_Template**: An Embedded JavaScript template file (`.ejs`) used to render HTML pages server-side

## Requirements

### Requirement 1: CLI Flag Registration

**User Story:** As a developer, I want to pass a `--db-manager` flag to the `generate` command, so that the DB Manager UI files are included in my generated codebase.

#### Acceptance Criteria

1. WHEN the `--db-manager` flag is passed to the Generate_Command, THE Generate_Command SHALL include all DB_Manager_Generator output files in the planned file list
2. WHEN the `--db-manager` flag is not passed to the Generate_Command, THE Generate_Command SHALL not include any DB Manager files in the planned file list
3. WHEN the `--db-manager` flag is combined with `--dry-run`, THE Generate_Command SHALL list the DB Manager planned files without writing them to disk
4. WHEN the `--db-manager` flag is combined with `--json`, THE Generate_Command SHALL include the DB Manager file results in the JSON output
5. THE Generate_Command SHALL register `--db-manager` in the help output and flag summary alongside existing flags (`--models`, `--routes`, `--openapi`, `--tests`)

### Requirement 2: DB Manager File Generation

**User Story:** As a developer, I want the DB Manager generator to produce all necessary files using EJS templates, so that the scaffolded UI works out of the box after generation.

#### Acceptance Criteria

1. WHEN the `--db-manager` flag is active, THE DB_Manager_Generator SHALL produce Planned_File objects for: the DB Manager Express route handler, the Auth_Middleware module, the login page EJS_Template, and the manager page EJS_Template
2. THE DB_Manager_Generator SHALL produce all EJS_Template files with a dark theme color scheme
3. WHEN the `--db-manager` flag is active, THE DB_Manager_Generator SHALL append `DATABASE_MANAGER_PASSWORD=admin` to the generated `.env` file content
4. WHEN the `--db-manager` flag is active, THE DB_Manager_Generator SHALL append `DATABASE_MANAGER_PASSWORD=your_db_manager_password` to the generated `.env.example` file content
5. WHEN the `--db-manager` flag is active, THE DB_Manager_Generator SHALL add `ejs` as a dependency in the generated `package.json`
6. THE DB_Manager_Generator SHALL produce a Planned_File that registers the EJS view engine and sets the views directory in the generated `app.js`
7. THE DB_Manager_Generator SHALL produce a Planned_File that mounts the DB_Manager_Route at `/database` in the generated `app.js`

### Requirement 3: Login Page and Authentication

**User Story:** As a developer, I want the DB Manager to be protected by a password-only login page, so that unauthorized users cannot access the database management interface.

#### Acceptance Criteria

1. WHEN an unauthenticated user navigates to `/database`, THE DB_Manager_Route SHALL redirect the user to the login page
2. THE DB_Manager_UI SHALL render a login page with a single password input field and a submit button using a dark theme EJS_Template
3. WHEN a POST request is sent to `/database/login` with a password matching the `DATABASE_MANAGER_PASSWORD` environment variable, THE DB_Manager_Route SHALL set `req.session["db-manager"]` to `true` and redirect to `/database`
4. WHEN a POST request is sent to `/database/login` with an incorrect password, THE DB_Manager_Route SHALL re-render the login page with an error message
5. WHILE `req.session["db-manager"]` is not `true`, THE Auth_Middleware SHALL block access to all DB_Manager_Route endpoints except `/database/login` and redirect to the login page
6. IF the `DATABASE_MANAGER_PASSWORD` environment variable is not set, THEN THE DB_Manager_Route SHALL respond with a 503 status and a message indicating the password is not configured

### Requirement 4: Table Listing and Sidebar

**User Story:** As a developer, I want to see a list of all database tables in a sidebar, so that I can quickly navigate between tables.

#### Acceptance Criteria

1. WHEN an authenticated user navigates to `/database`, THE DB_Manager_UI SHALL display a left sidebar containing a list of all tables retrieved from the database
2. WHEN a GET request is sent to `/database/tables`, THE DB_Manager_Route SHALL return a JSON array of all table names from the connected database
3. THE DB_Manager_UI SHALL provide a text input in the sidebar that filters the displayed table list as the user types (client-side search)
4. WHEN a user clicks a table name in the sidebar, THE DB_Manager_UI SHALL load that table's structure and data in the main content area

### Requirement 5: Table Structure Tab

**User Story:** As a developer, I want to view the column definitions of a selected table, so that I can understand the schema without querying the database manually.

#### Acceptance Criteria

1. WHEN an authenticated user selects a table and clicks the "Table Structure" tab, THE DB_Manager_UI SHALL display the column definitions for that table
2. WHEN a GET request is sent to `/database/tables/:table_name` with a query parameter `schema=true`, THE DB_Manager_Route SHALL return the column definitions (column name, data type, nullable, default value, primary key) for the specified table
3. THE DB_Manager_UI SHALL render the column definitions in a tabular format with a dark theme

### Requirement 6: Data Tab

**User Story:** As a developer, I want to browse table data with filtering, sorting, and pagination, so that I can inspect records without writing SQL.

#### Acceptance Criteria

1. WHEN an authenticated user selects a table and clicks the "Data" tab, THE DB_Manager_UI SHALL display the top 30 rows of that table by default
2. WHEN a GET request is sent to `/database/tables/:table_name`, THE DB_Manager_Route SHALL return table rows with a default `size` of 30
3. WHEN a GET request is sent to `/database/tables/:table_name` with a `sort` query parameter, THE DB_Manager_Route SHALL return rows sorted by the specified column
4. WHEN a GET request is sent to `/database/tables/:table_name` with a `size` query parameter, THE DB_Manager_Route SHALL return the specified number of rows
5. WHEN a GET request is sent to `/database/tables/:table_name` with a `page` query parameter, THE DB_Manager_Route SHALL return the corresponding page of rows based on the `size` value
6. WHEN a GET request is sent to `/database/tables/:table_name` with column filter query parameters (e.g., `column_name=%value%`), THE DB_Manager_Route SHALL return only rows matching the filter criteria using LIKE-style matching
7. THE DB_Manager_UI SHALL provide filter inputs, sort controls, and pagination controls for the data view

### Requirement 7: Query Tab

**User Story:** As a developer, I want to execute raw SQL queries from the UI, so that I can run ad-hoc queries during development.

#### Acceptance Criteria

1. WHEN an authenticated user clicks the "Query" tab, THE DB_Manager_UI SHALL display a text area for entering SQL queries and an execute button
2. WHEN a POST request is sent to `/database/query` with a `sql` field in the request body, THE DB_Manager_Route SHALL execute the SQL query against the connected database and return the results as JSON
3. WHEN the SQL query executes successfully, THE DB_Manager_UI SHALL display the results in a tabular format
4. IF the SQL query fails, THEN THE DB_Manager_Route SHALL return the error message with a 400 status code
5. WHILE `req.session["db-manager"]` is not `true`, THE Auth_Middleware SHALL block access to the `/database/query` endpoint

### Requirement 8: SQL Database Adapter Compatibility

**User Story:** As a developer, I want the DB Manager to work with all supported SQL database adapters, so that the feature is available regardless of which SQL database I use.

#### Acceptance Criteria

1. THE DB_Manager_Generator SHALL produce DB Manager files only when the schema specifies a SQL_Adapter (mysql, mariadb, postgres, sqlite3, mssql, cockroachdb, oracle)
2. IF the schema specifies a NoSQL database (mongodb, redis, dynamodb), THEN THE DB_Manager_Generator SHALL skip DB Manager file generation and log a warning message
3. THE DB_Manager_Route SHALL use the `global.db` instance (initialized by `commons/db.js`) to execute all database operations, ensuring compatibility with the active SQL_Adapter

### Requirement 9: App.js Integration

**User Story:** As a developer, I want the generated `app.js` to automatically include the DB Manager route and EJS configuration, so that the feature works without manual setup.

#### Acceptance Criteria

1. WHEN the `--db-manager` flag is active, THE DB_Manager_Generator SHALL add `app.set("view engine", "ejs")` and `app.set("views", path.join(__dirname, "views"))` to the generated `app.js`
2. WHEN the `--db-manager` flag is active, THE DB_Manager_Generator SHALL add an import for the DB_Manager_Route and mount it with `app.use("/database", dbManagerRoute)` in the generated `app.js`
3. THE DB_Manager_Generator SHALL place the EJS_Template files in a `views/db-manager/` directory within the generated codebase

### Requirement 10: CSV Data Download

**User Story:** As a developer, I want to download table data as a CSV file, so that I can export records for analysis or sharing without writing SQL export queries.

#### Acceptance Criteria

1. WHEN an authenticated user clicks the "Download CSV" button on the Data tab, THE DB_Manager_UI SHALL send a GET request to `/database/tables/:table_name/csv` and trigger a file download in the browser
2. WHEN a GET request is sent to `/database/tables/:table_name/csv` without row selection parameters, THE DB_Manager_Route SHALL return all rows of the specified table formatted as CSV with a `Content-Type` of `text/csv` and a `Content-Disposition` header specifying a `.csv` filename
3. WHEN a GET request is sent to `/database/tables/:table_name/csv` with an `ids` query parameter containing a comma-separated list of primary key values, THE DB_Manager_Route SHALL return only the rows matching those primary key values formatted as CSV
4. THE DB_Manager_UI SHALL provide checkboxes on each row in the Data tab to allow the user to select specific rows for CSV download
5. WHEN one or more rows are selected via checkboxes, THE DB_Manager_UI SHALL include the selected primary key values in the `ids` query parameter of the CSV download request
6. WHEN no rows are selected and the user clicks "Download CSV", THE DB_Manager_UI SHALL download all rows matching the current filter and sort criteria
7. WHILE `req.session["db-manager"]` is not `true`, THE Auth_Middleware SHALL block access to the `/database/tables/:table_name/csv` endpoint

### Requirement 11: Bulk Row Deletion

**User Story:** As a developer, I want to select and delete multiple rows from a table, so that I can remove unwanted records efficiently during development.

#### Acceptance Criteria

1. THE DB_Manager_UI SHALL provide checkboxes on each row in the Data tab to allow the user to select specific rows for deletion
2. WHEN one or more rows are selected via checkboxes, THE DB_Manager_UI SHALL display a "Delete Selected" button
3. WHEN the user clicks the "Delete Selected" button, THE DB_Manager_UI SHALL display a confirmation dialog stating the number of rows to be deleted
4. WHEN the user confirms the deletion, THE DB_Manager_UI SHALL send a DELETE request to `/database/tables/:table_name` with the selected primary key values in the request body
5. WHEN a DELETE request is sent to `/database/tables/:table_name` with a JSON body containing a `keys` array of primary key values, THE DB_Manager_Route SHALL delete all rows matching those primary key values from the specified table and return the count of deleted rows
6. WHEN the deletion completes successfully, THE DB_Manager_UI SHALL remove the deleted rows from the displayed data and show a success message with the count of deleted rows
7. IF the DELETE request fails, THEN THE DB_Manager_Route SHALL return the error message with a 400 status code and THE DB_Manager_UI SHALL display the error message to the user
8. WHILE `req.session["db-manager"]` is not `true`, THE Auth_Middleware SHALL block access to the DELETE `/database/tables/:table_name` endpoint

### Requirement 12: Inline Row Editing

**User Story:** As a developer, I want to edit a row inline in the Data tab, so that I can update records directly without writing SQL update queries.

#### Acceptance Criteria

1. THE DB_Manager_UI SHALL display an edit button on each row in the Data tab
2. WHEN the user clicks the edit button on a row, THE DB_Manager_UI SHALL convert that row's cells into editable input fields pre-populated with the current values
3. WHILE a row is in edit mode, THE DB_Manager_UI SHALL display "Save" and "Cancel" buttons for that row
4. WHEN the user clicks "Save" on an edited row, THE DB_Manager_UI SHALL send a PUT request to `/database/tables/:table_name/:id` where `:id` is the primary key value of the edited row, with the updated field values in the request body
5. WHEN a PUT request is sent to `/database/tables/:table_name/:id` with a JSON body containing updated column values, THE DB_Manager_Route SHALL update the row matching the primary key value in the specified table and return the updated row data
6. WHEN the update completes successfully, THE DB_Manager_UI SHALL exit edit mode for that row, display the updated values, and show a success message
7. WHEN the user clicks "Cancel" on an edited row, THE DB_Manager_UI SHALL discard the changes and restore the original values
8. IF the PUT request fails, THEN THE DB_Manager_Route SHALL return the error message with a 400 status code and THE DB_Manager_UI SHALL display the error message to the user
9. WHILE `req.session["db-manager"]` is not `true`, THE Auth_Middleware SHALL block access to the PUT `/database/tables/:table_name/:id` endpoint

### Requirement 13: Row Insertion

**User Story:** As a developer, I want to insert a new row into a table through the UI, so that I can add test data without writing SQL insert queries.

#### Acceptance Criteria

1. THE DB_Manager_UI SHALL display an "Add Row" button on the Data tab
2. WHEN the user clicks the "Add Row" button, THE DB_Manager_UI SHALL display a form with input fields matching the column definitions of the selected table, using the schema information from the `/database/tables/:table_name?schema=true` endpoint
3. THE DB_Manager_UI SHALL set appropriate input types for each field based on the column data type (text input for strings, number input for numeric types, checkbox for booleans)
4. THE DB_Manager_UI SHALL indicate which fields are required based on the column nullable property from the schema
5. WHEN the user submits the insertion form, THE DB_Manager_UI SHALL send a POST request to `/database/tables/:table_name` with the form field values in the request body
6. WHEN a POST request is sent to `/database/tables/:table_name` with a JSON body containing column values, THE DB_Manager_Route SHALL insert a new row into the specified table and return the inserted row data
7. WHEN the insertion completes successfully, THE DB_Manager_UI SHALL close the form, refresh the data view to include the new row, and show a success message
8. IF the POST request fails, THEN THE DB_Manager_Route SHALL return the error message with a 400 status code and THE DB_Manager_UI SHALL display the error message on the form
9. WHILE `req.session["db-manager"]` is not `true`, THE Auth_Middleware SHALL block access to the POST `/database/tables/:table_name` endpoint
