# Requirements Document

## Introduction

This document specifies enhancements to the existing DB Manager App. The enhancements include: CSV export (replacing JSON), Material Icons for action buttons, column filtering, column sorting, a custom Query page, and a Dashboard page. The sidebar navigation order is updated to: Dashboard > Query > Tables > History.

## Glossary

- **DB_Manager_App**: The existing standalone Express server that serves the database management UI using EJS templates and API endpoints
- **Data_Panel**: The right-side panel displaying column metadata and row data for the selected table
- **Table_Sidebar**: The left-side panel containing navigation links and an accordion with table list and history
- **Export_Engine**: The server-side component responsible for generating CSV file downloads from row data
- **Filter_Bar**: A row of input fields displayed above the data table, one per column, used to filter visible rows
- **Sort_Indicator**: A visual indicator on column headers showing the current sort direction (ascending or descending)
- **Query_Page**: A dedicated page accessible from the sidebar that allows users to write and execute custom SQL queries
- **Dashboard_Page**: A dedicated page accessible from the sidebar that displays an overview of all tables with metadata (column count, size)
- **Material_Icons**: The Google Material Icons font library used to render icon glyphs in buttons and action cells
- **CSV_File**: A comma-separated values file with a header row containing column names and subsequent rows containing data values

## Requirements

### Requirement 1: CSV Export for Table Rows

**User Story:** As a developer, I want to export selected table rows as a CSV file instead of JSON, so that I can easily open the data in spreadsheet applications.

#### Acceptance Criteria

1. WHEN the user selects one or more rows and activates the export action, THE Export_Engine SHALL generate a downloadable CSV_File containing the selected row data
2. THE Export_Engine SHALL include a header row in the CSV_File with column names matching the table schema
3. WHEN exporting from a table view, THE Export*Engine SHALL set the download filename to the format `{table_name}*{timestamp}.csv` where timestamp is in ISO 8601 compact format (YYYYMMDDTHHmmss)
4. WHEN a cell value contains a comma, double quote, or newline character, THE Export_Engine SHALL enclose that cell value in double quotes and escape internal double quotes by doubling them
5. THE Export_Engine SHALL set the HTTP response Content-Type header to `text/csv`
6. THE Export_Engine SHALL set the HTTP response Content-Disposition header to `attachment` with the generated filename

### Requirement 2: CSV Export for Query Results

**User Story:** As a developer, I want to export query results as a CSV file, so that I can save and share the output of custom queries.

#### Acceptance Criteria

1. WHEN the user activates the export action on the Query_Page, THE Export_Engine SHALL generate a downloadable CSV_File containing all result rows
2. WHEN exporting from the Query*Page, THE Export_Engine SHALL set the download filename to the format `export*{timestamp}.csv` where timestamp is in ISO 8601 compact format (YYYYMMDDTHHmmss)
3. THE Export_Engine SHALL include a header row in the CSV_File with column names derived from the query result set

### Requirement 3: Material Icons for Row Actions

**User Story:** As a developer, I want edit and delete actions in table rows to use Material Icons, so that the interface is more visually intuitive and compact.

#### Acceptance Criteria

1. THE DB_Manager_App SHALL load the Google Material Icons font via a stylesheet link in the HTML head
2. WHEN rendering row action buttons, THE Data_Panel SHALL display a Material Icon "edit" glyph for the edit action instead of text
3. WHEN rendering row action buttons, THE Data_Panel SHALL display a Material Icon "delete" glyph for the delete action instead of text
4. EACH row action icon button SHALL include an `aria-label` attribute describing the action for accessibility

### Requirement 4: Material Icons for Toolbar Buttons

**User Story:** As a developer, I want the top action buttons (Add, Delete, Export) to use Material Icons and be aligned to the right, so that the toolbar is visually consistent and space-efficient.

#### Acceptance Criteria

1. THE Data_Panel toolbar SHALL display a Material Icon "add" glyph inside the Add button alongside the text label
2. THE Data_Panel toolbar SHALL display a Material Icon "delete" glyph inside the Delete button alongside the text label
3. THE Data_Panel toolbar SHALL display a Material Icon "file_download" glyph inside the Export button alongside the text label
4. THE Data_Panel toolbar SHALL align the action buttons to the right side of the toolbar using CSS
5. EACH toolbar button SHALL include both the icon and a visible text label for clarity

### Requirement 5: Column Filtering

**User Story:** As a developer, I want to filter table data by column values using input fields above the table, so that I can quickly find specific rows without writing queries.

#### Acceptance Criteria

1. WHEN a table is selected, THE Filter_Bar SHALL display one text input field for each column in the table schema
2. EACH filter input SHALL display the column name as placeholder text
3. WHEN the user enters text into a filter input, THE Data_Panel SHALL request filtered data from the server using a case-insensitive substring match on the corresponding column
4. WHEN multiple filter inputs contain values, THE Data_Panel SHALL apply all filters simultaneously using AND logic
5. WHEN all filter inputs are cleared, THE Data_Panel SHALL display the unfiltered table data
6. WHEN a filter is applied, THE Data_Panel SHALL reset pagination to the first page

### Requirement 6: Column Sorting

**User Story:** As a developer, I want to sort table data by clicking column headers, so that I can quickly organize data by any field.

#### Acceptance Criteria

1. WHEN the user clicks a column header, THE Data_Panel SHALL request data sorted by that column in ascending order
2. WHEN the user clicks the same column header a second time, THE Data_Panel SHALL request data sorted by that column in descending order
3. WHEN the user clicks the same column header a third time, THE Data_Panel SHALL remove sorting and display data in default order
4. THE Sort_Indicator SHALL display an upward arrow icon when the column is sorted ascending
5. THE Sort_Indicator SHALL display a downward arrow icon when the column is sorted descending
6. THE Data_Panel SHALL support sorting on only one column at a time
7. WHEN sorting is applied, THE Data_Panel SHALL reset pagination to the first page

### Requirement 7: Query Page

**User Story:** As a developer, I want a dedicated Query page where I can write and execute custom SQL queries, so that I can perform ad-hoc data analysis beyond simple table browsing.

#### Acceptance Criteria

1. THE Table_Sidebar SHALL display a "Query" navigation link above the Tables accordion section
2. WHEN the user clicks the "Query" link, THE DB_Manager_App SHALL navigate to the Query_Page
3. THE Query_Page SHALL display a multi-line text area for entering SQL queries
4. THE Query_Page SHALL display a "Run" button that executes the entered query
5. WHEN the user activates the Run button, THE DB_Manager_App SHALL send the query text to the server for execution via the Library_Adapter
6. WHEN the query executes successfully, THE Query_Page SHALL display the result rows in a table format with column headers
7. IF the query execution fails, THEN THE Query_Page SHALL display the error message returned by the server
8. WHEN query results are displayed, THE Query_Page SHALL display an Export button that exports results as a CSV_File
9. WHEN a query is executed, THE DB_Manager_App SHALL record the query text and row count in the Query_History within the Metadata_DB

### Requirement 8: Dashboard Page

**User Story:** As a developer, I want a Dashboard page that shows an overview of all tables with their metadata, so that I can quickly assess the database structure and size.

#### Acceptance Criteria

1. THE Table_Sidebar SHALL display a "Dashboard" navigation link as the first item, above the Query link
2. WHEN the user clicks the "Dashboard" link, THE DB_Manager_App SHALL navigate to the Dashboard_Page
3. THE Dashboard_Page SHALL display a list of all tables in the connected database
4. FOR EACH table in the list, THE Dashboard_Page SHALL display the table name
5. FOR EACH table in the list, THE Dashboard_Page SHALL display the approximate number of columns
6. FOR EACH table in the list, THE Dashboard_Page SHALL display the approximate size of the table (row count)
7. THE Dashboard_Page SHALL present the table information in a card or list layout consistent with the dark theme
8. WHEN the user clicks a table name on the Dashboard_Page, THE DB_Manager_App SHALL navigate to the table data view for that table

### Requirement 9: Sidebar Navigation Order

**User Story:** As a developer, I want the sidebar navigation items ordered logically (Dashboard, Query, Tables, History), so that the most commonly used features are easily accessible.

#### Acceptance Criteria

1. THE Table_Sidebar SHALL display navigation items in the following order from top to bottom: Dashboard link, Query link, Tables accordion section, History accordion section
2. THE Dashboard link and Query link SHALL be rendered as standalone clickable items (not inside accordion sections)
3. WHEN the Dashboard_Page is active, THE Dashboard link SHALL be visually highlighted as the active navigation item
4. WHEN the Query_Page is active, THE Query link SHALL be visually highlighted as the active navigation item

### Requirement 10: Server-Side Filtering API

**User Story:** As a developer, I want the server to support column-based filtering in the rows API, so that filtered data is paginated correctly on the server side.

#### Acceptance Criteria

1. WHEN the rows API receives filter query parameters, THE DB_Manager_App SHALL pass the filter conditions to the Library_Adapter list operation
2. THE rows API SHALL accept filter parameters in the format `filter[column_name]=value` as query string parameters
3. WHEN filter parameters are provided, THE DB_Manager_App SHALL apply case-insensitive substring matching for each filter condition
4. THE rows API SHALL return the filtered row count in the response to support correct pagination

### Requirement 11: Query Execution API

**User Story:** As a developer, I want a server-side API endpoint for executing custom queries, so that the Query_Page can send queries to the database securely.

#### Acceptance Criteria

1. WHEN the query API receives a POST request with a query string, THE DB_Manager_App SHALL execute the query using the Library_Adapter `query` method
2. WHEN the query executes successfully, THE query API SHALL return the result rows and column names in JSON format
3. IF the query execution fails, THEN THE query API SHALL return an error response with the error message and HTTP status 500
4. WHEN a query is executed successfully, THE DB_Manager_App SHALL record the query in the Metadata_DB Query_History
