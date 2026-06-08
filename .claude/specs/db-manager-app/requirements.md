# Requirements Document

## Introduction

A standalone Express-based database management UI launched as a CLI subcommand (`npx db-model-router db-manager`). Unlike the existing `--db-manager` flag on the `generate` command (which produces static files at build time), this feature starts a live runtime server that connects to a database using the library's adapter layer and provides a full CRUD interface with a dark-themed UI. The application uses EJS for server-side rendering and maintains its own internal SQLite database for storing connection history and query history. All database adapters supported by the library are supported.

## Glossary

- **DB_Manager_App**: The standalone Express server that serves the database management UI using EJS templates and API endpoints
- **CLI_Parser**: The existing `parseFlags` module in `src/cli/flags.js` that parses command-line arguments
- **Library_Adapter**: The database adapter loaded via `src/index.js` `init()` and exposed as `db` (provides `list`, `get`, `query`, `insert`, `upsert`, `remove`, `connect`, `disconnect`)
- **Table_Sidebar**: The left-side panel in the UI containing an accordion with a searchable table list and a history section
- **Data_Panel**: The right-side panel displaying column metadata and row data for the selected table
- **Query_Tab**: A UI section allowing users to view paginated data with configurable page sizes
- **Env_File**: A `.env` file containing database connection credentials (DB_HOST, DB_NAME, DB_USER, DB_PASS, DB_PORT, DB_TYPE)
- **Metadata_DB**: An internal SQLite database (separate from the user's target database) used to store connection history and query history
- **Connection_History**: A record of past database connections stored in the Metadata_DB
- **Query_History**: A record of past queries executed through the UI stored in the Metadata_DB

## Requirements

### Requirement 1: CLI Subcommand Registration

**User Story:** As a developer, I want to launch the database manager by running `npx db-model-router db-manager`, so that I can manage my database without modifying my application code.

#### Acceptance Criteria

1. WHEN the user invokes `db-model-router db-manager`, THE CLI_Parser SHALL recognize `db-manager` as a valid subcommand and route execution to the db-manager command handler
2. WHEN the `--env` flag is provided with a file path, THE DB_Manager_App SHALL read database credentials from the specified Env_File
3. WHEN the `--port` flag is provided with a numeric value, THE DB_Manager_App SHALL start the Express server on the specified port
4. IF the `--env` flag is omitted, THEN THE DB_Manager_App SHALL default to reading from `.env` in the current working directory
5. IF the `--port` flag is omitted, THEN THE DB_Manager_App SHALL default to port 4000
6. IF the specified Env_File does not exist, THEN THE DB_Manager_App SHALL print an error message and exit with a non-zero exit code

### Requirement 2: Database Connection via Library Adapter

**User Story:** As a developer, I want the db-manager to use the same database adapter layer as the main library, so that all supported databases work consistently.

#### Acceptance Criteria

1. WHEN the DB_Manager_App starts, THE DB_Manager_App SHALL call `init(DB_TYPE)` from `src/index.js` using the DB_TYPE value from the Env_File
2. WHEN the Library_Adapter is initialized, THE DB_Manager_App SHALL call `db.connect()` with the credentials parsed from the Env_File
3. THE DB_Manager_App SHALL support all database adapters available in the Library_Adapter: mysql, mariadb, postgres, sqlite3, mssql, cockroachdb, oracle, mongodb, redis, and dynamodb
4. IF the database connection fails, THEN THE DB_Manager_App SHALL print a descriptive error message including the DB_TYPE and exit with a non-zero exit code
5. WHEN the DB_Manager_App process receives a termination signal, THE DB_Manager_App SHALL call `db.disconnect()` to cleanly close the database connection
6. WHEN a successful connection is established, THE DB_Manager_App SHALL store the connection details (DB_TYPE, DB_HOST, DB_NAME, timestamp) in the Connection_History within the Metadata_DB

### Requirement 3: Internal Metadata Database

**User Story:** As a developer, I want the db-manager to remember my past connections and queries, so that I can quickly reconnect or re-run previous queries.

#### Acceptance Criteria

1. WHEN the DB_Manager_App starts, THE DB_Manager_App SHALL open (or create) an internal SQLite Metadata_DB file at `db-manager/.dbmanager.sqlite`
2. THE Metadata_DB SHALL contain a `connections` table storing: id, db_type, host, database_name, connected_at timestamp
3. THE Metadata_DB SHALL contain a `queries` table storing: id, connection_id, query_text, executed_at timestamp, row_count
4. WHEN the user executes a query or CRUD operation, THE DB_Manager_App SHALL record the operation in the Query_History table of the Metadata_DB

### Requirement 4: Table Listing with Accordion Sidebar

**User Story:** As a developer, I want to see all tables in my database listed in a collapsible sidebar section, so that I can quickly navigate to the table I need while also accessing history.

#### Acceptance Criteria

1. WHEN the DB_Manager_App UI loads, THE Table_Sidebar SHALL display an accordion with a "Tables" section containing the list of all tables in the connected database
2. THE Table_Sidebar SHALL include a search input inside the "Tables" accordion section that filters the displayed tables by name (case-insensitive)
3. WHEN the user selects a table from the Table_Sidebar, THE Data_Panel SHALL display the column metadata and row data for that table
4. THE Table_Sidebar SHALL display a "History" accordion section below the "Tables" section showing recent Connection_History and Query_History entries from the Metadata_DB

### Requirement 5: View Table Data

**User Story:** As a developer, I want to view the data in any table with column information displayed, so that I can understand the structure and contents of my database.

#### Acceptance Criteria

1. WHEN a table is selected, THE Data_Panel SHALL display the column names and their data types as a header row
2. WHEN a table is selected, THE Data_Panel SHALL display the first page of row data using the Library_Adapter `list` operation
3. THE Query_Tab SHALL default to a page size of 30 rows
4. WHEN the user selects a page size from the dropdown, THE Query_Tab SHALL offer options of 30, 50, 100, and no limit
5. WHEN the user changes the page size, THE Data_Panel SHALL reload the data with the new page size applied

### Requirement 6: Add New Rows

**User Story:** As a developer, I want to add new rows to a table through the UI, so that I can insert test data or fix missing records without writing SQL.

#### Acceptance Criteria

1. WHEN the user activates the add-row action, THE Data_Panel SHALL display a form with input fields for each column in the selected table
2. WHEN the user submits the add-row form with valid data, THE DB_Manager_App SHALL call the Library_Adapter `insert` operation to create the new row
3. WHEN the insert operation succeeds, THE Data_Panel SHALL refresh the table data to include the newly added row
4. IF the insert operation fails, THEN THE DB_Manager_App SHALL display the error message returned by the Library_Adapter to the user

### Requirement 7: Delete Rows

**User Story:** As a developer, I want to delete specific rows from a table, so that I can remove incorrect or test data.

#### Acceptance Criteria

1. WHEN the user selects one or more rows and activates the delete action, THE DB_Manager_App SHALL call the Library_Adapter `remove` operation with a filter matching the selected rows
2. WHEN the delete operation succeeds, THE Data_Panel SHALL refresh the table data with the deleted rows removed
3. IF the delete operation fails, THEN THE DB_Manager_App SHALL display the error message returned by the Library_Adapter to the user

### Requirement 8: Edit Rows

**User Story:** As a developer, I want to edit specific rows in a table, so that I can correct data without writing SQL update statements.

#### Acceptance Criteria

1. WHEN the user activates the edit action on a row, THE Data_Panel SHALL display an editable form pre-populated with the current values of that row
2. WHEN the user submits the edit form with modified data, THE DB_Manager_App SHALL call the Library_Adapter `upsert` operation to update the row
3. WHEN the upsert operation succeeds, THE Data_Panel SHALL refresh the table data to reflect the updated values
4. IF the upsert operation fails, THEN THE DB_Manager_App SHALL display the error message returned by the Library_Adapter to the user

### Requirement 9: Export Rows

**User Story:** As a developer, I want to export specific rows from a table, so that I can share data or use it in other tools.

#### Acceptance Criteria

1. WHEN the user selects one or more rows and activates the export action, THE DB_Manager_App SHALL generate a downloadable file containing the selected row data
2. THE DB_Manager_App SHALL export data in JSON format
3. WHEN the export is triggered, THE DB_Manager_App SHALL initiate a file download in the user's browser with a filename based on the table name

### Requirement 10: EJS Templating

**User Story:** As a developer, I want the db-manager to use EJS for server-side rendering, so that the UI is rendered on the server and works without a frontend build step.

#### Acceptance Criteria

1. THE DB_Manager_App SHALL use EJS as the template engine for rendering HTML pages
2. THE DB_Manager_App SHALL store EJS template files in the `db-manager/views/` directory
3. THE DB_Manager_App SHALL render the main layout, table view, and form views using EJS partials for reusable components (sidebar, header, data table)

### Requirement 11: Dark Theme UI

**User Story:** As a developer, I want the database manager to use a dark theme, so that it is consistent with the existing db-manager design and comfortable for extended use.

#### Acceptance Criteria

1. THE DB_Manager_App SHALL render all UI components using a dark color scheme (dark backgrounds with light text)
2. THE DB_Manager_App SHALL use a layout with the Table_Sidebar on the left and the Data_Panel on the right
3. THE DB_Manager_App SHALL be usable on viewport widths of 1024 pixels and above

### Requirement 12: Demo Environment Files and Seed Data

**User Story:** As a developer, I want pre-configured environment files and seed data for each supported database adapter, so that I can test the db-manager against any adapter using Docker.

#### Acceptance Criteria

1. THE DB_Manager_App SHALL include a `db-manager/demo/` directory containing one `.env` file per supported adapter (sqlite3, mysql, postgres, mssql, cockroachdb, oracle, mongodb, redis, dynamodb)
2. EACH demo Env_File SHALL contain the correct connection credentials for the corresponding Docker service defined in the project's `docker-compose.yml`
3. THE DB_Manager_App SHALL include seed SQL or seed scripts in `db-manager/demo/seeds/` that create sample tables and insert sample data for each SQL-based adapter
4. THE SQLite demo seed SHALL create at least two tables with sample rows so the UI can be tested immediately without external dependencies

### Requirement 13: Application File Structure

**User Story:** As a developer, I want all db-manager app files organized in the `db-manager/` folder, so that the feature is self-contained and does not pollute the main library source.

#### Acceptance Criteria

1. THE DB_Manager_App SHALL serve static UI assets from the `db-manager/public/` directory
2. THE DB_Manager_App SHALL have its Express server setup, API routes, and EJS templates located within the `db-manager/` directory
3. THE CLI_Parser SHALL have the db-manager subcommand handler located at `src/cli/commands/db-manager.js`
4. THE Metadata_DB file SHALL be stored at `db-manager/.dbmanager.sqlite` and SHALL be listed in `.gitignore`
