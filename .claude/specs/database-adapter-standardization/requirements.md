# Requirements Document

## Introduction

This feature standardizes all database adapters in the multi-database adapter library to follow the same module conventions established by the MySQL adapter. Currently, MySQL, PostgreSQL, and Oracle have full implementations (db, model, route, function, validator modules), while SQLite3, MongoDB, DynamoDB, Redis, CockroachDB, MSSQL, PocketBase, and Supabase are stub-only. The goal is to implement all adapters with the same interface, add REST route generation via Express routers, write comprehensive tests (individual, bulk, and router-based) for every adapter, and provide a Docker Compose file so all databases can be spun up for integration testing.

## Glossary

- **Adapter**: A database-specific module that exports `db`, `model`, and `route` sub-modules conforming to the standard interface
- **DB_Module**: The low-level database access layer within an adapter, exposing `connect`, `query`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions
- **Model_Module**: The business-logic layer that wraps a DB_Module and provides `insert`, `update`, `upsert`, `remove`, `byId`, `find`, `findOne`, and `list` operations with validation
- **Route_Module**: An Express router factory that generates RESTful CRUD endpoints (GET, POST, PUT, DELETE) for both single and bulk operations from a Model_Module instance
- **Function_Module**: A shared utility module exporting `jsonSafeParse`, `jsonStringify`, `getType`, `empty`, and `objectSelecter` helpers
- **Validator_Module**: A shared validation module exporting `RemovePK`, `RemoveUnknownData`, `getPayloadValidator`, `errorResponse`, `validateInput`, `dataToFilter`, and `objectToFilter` helpers
- **SQL_Adapter**: An adapter for SQL-based databases (SQLite3, CockroachDB, MSSQL) that uses SQL queries with dialect-specific translation
- **NoSQL_Adapter**: An adapter for non-relational databases (MongoDB, DynamoDB, Redis, PocketBase, Supabase) that translates the standard filter interface into native query operations
- **Filter_Array**: The standard filter format used across all adapters: a nested array structure `[[[column, operator, value], ...], ...]` representing OR groups of AND conditions
- **Docker_Compose_File**: A `docker-compose.yml` configuration that defines services for all supported databases with appropriate images and port mappings
- **Test_Suite**: A collection of Mocha test files covering individual operations, bulk operations, and router-based REST API tests for each adapter

## Requirements

### Requirement 1: SQLite3 Adapter Implementation

**User Story:** As a developer, I want a fully functional SQLite3 adapter, so that I can use the same model/route interface with an SQLite3 database.

#### Acceptance Criteria

1. THE SQLite3 DB_Module SHALL expose `connect`, `query`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. WHEN a filter array is provided, THE SQLite3 DB_Module SHALL translate the Filter_Array into valid SQLite3 WHERE clauses supporting `=`, `like`, `not like`, `in`, `not in`, `<`, `>`, `<=`, `>=`, and `!=` operators
3. WHEN a `get` call is made, THE SQLite3 DB_Module SHALL return an object with `data` (array of rows) and `count` (total matching rows) properties
4. WHEN a `list` call is made with `page` and `limit` parameters, THE SQLite3 DB_Module SHALL return paginated results using LIMIT/OFFSET
5. WHEN an `insert` call is made with a single record, THE SQLite3 DB_Module SHALL return an object containing the `id` of the inserted row
6. WHEN an `insert` call is made with an array of records, THE SQLite3 DB_Module SHALL insert all records and return the total `rows` count
7. THE SQLite3 Adapter SHALL export `db`, `model`, and `route` from its `index.js`
8. THE SQLite3 Adapter SHALL include a `function.js` re-exporting the shared Function_Module
9. THE SQLite3 Adapter SHALL include a `validator.js` re-exporting the shared Validator_Module

### Requirement 2: MongoDB Adapter Implementation

**User Story:** As a developer, I want a fully functional MongoDB adapter, so that I can use the same model/route interface with a MongoDB database.

#### Acceptance Criteria

1. THE MongoDB DB_Module SHALL expose `connect`, `query`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. WHEN a Filter_Array is provided, THE MongoDB DB_Module SHALL translate the filter into a MongoDB query object using `$and`, `$or`, `$in`, `$nin`, `$regex`, `$lt`, `$gt`, `$lte`, `$gte`, and `$ne` operators
3. WHEN a `get` call is made, THE MongoDB DB_Module SHALL return an object with `data` (array of documents) and `count` (total matching documents) properties
4. WHEN a `list` call is made with `page` and `limit` parameters, THE MongoDB DB_Module SHALL return paginated results using `skip` and `limit`
5. WHEN an `insert` call is made with a single document, THE MongoDB DB_Module SHALL return an object containing the `id` of the inserted document
6. THE MongoDB Adapter SHALL export `db`, `model`, and `route` from its `index.js`

### Requirement 3: DynamoDB Adapter Implementation

**User Story:** As a developer, I want a fully functional DynamoDB adapter, so that I can use the same model/route interface with a DynamoDB table.

#### Acceptance Criteria

1. THE DynamoDB DB_Module SHALL expose `connect`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. WHEN a Filter_Array is provided, THE DynamoDB DB_Module SHALL translate the filter into DynamoDB FilterExpression and ExpressionAttributeValues
3. WHEN a `get` call is made, THE DynamoDB DB_Module SHALL return an object with `data` (array of items) and `count` (total matching items) properties
4. WHEN a `list` call is made with `page` and `limit` parameters, THE DynamoDB DB_Module SHALL return paginated results using DynamoDB Scan/Query with Limit and ExclusiveStartKey
5. WHEN an `insert` call is made with a single item, THE DynamoDB DB_Module SHALL return an object containing the `id` of the inserted item
6. THE DynamoDB Adapter SHALL export `db`, `model`, and `route` from its `index.js`

### Requirement 4: Redis Adapter Implementation

**User Story:** As a developer, I want a fully functional Redis adapter, so that I can use the same model/route interface with Redis as a data store.

#### Acceptance Criteria

1. THE Redis DB_Module SHALL expose `connect`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. THE Redis DB_Module SHALL store records as Redis Hashes keyed by `{table}:{primary_key_value}`
3. WHEN a Filter_Array is provided, THE Redis DB_Module SHALL scan and filter records in-memory to match the standard filter operators
4. WHEN a `get` call is made, THE Redis DB_Module SHALL return an object with `data` (array of records) and `count` (total matching records) properties
5. WHEN a `list` call is made with `page` and `limit` parameters, THE Redis DB_Module SHALL return paginated results by slicing the filtered result set
6. THE Redis Adapter SHALL export `db`, `model`, and `route` from its `index.js`

### Requirement 5: CockroachDB Adapter Implementation

**User Story:** As a developer, I want a fully functional CockroachDB adapter, so that I can use the same model/route interface with CockroachDB.

#### Acceptance Criteria

1. THE CockroachDB DB_Module SHALL expose `connect`, `query`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. WHEN a Filter_Array is provided, THE CockroachDB DB_Module SHALL translate the filter into valid CockroachDB-compatible PostgreSQL WHERE clauses
3. THE CockroachDB DB_Module SHALL use the `pg` (node-postgres) client library since CockroachDB is PostgreSQL wire-compatible
4. WHEN an `upsert` call is made, THE CockroachDB DB_Module SHALL use `INSERT ... ON CONFLICT ... DO UPDATE SET` syntax
5. THE CockroachDB Adapter SHALL export `db`, `model`, and `route` from its `index.js`

### Requirement 6: MSSQL Adapter Implementation

**User Story:** As a developer, I want a fully functional MSSQL adapter, so that I can use the same model/route interface with Microsoft SQL Server.

#### Acceptance Criteria

1. THE MSSQL DB_Module SHALL expose `connect`, `query`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. WHEN a Filter_Array is provided, THE MSSQL DB_Module SHALL translate the filter into valid T-SQL WHERE clauses
3. WHEN a `list` call is made with `page` and `limit` parameters, THE MSSQL DB_Module SHALL return paginated results using `OFFSET ... ROWS FETCH NEXT ... ROWS ONLY`
4. WHEN an `upsert` call is made, THE MSSQL DB_Module SHALL use `MERGE INTO` syntax for upsert operations
5. WHEN an `insert` call is made with a single record, THE MSSQL DB_Module SHALL return the inserted row identity using `SCOPE_IDENTITY()` or `OUTPUT INSERTED`
6. THE MSSQL Adapter SHALL export `db`, `model`, and `route` from its `index.js`

### Requirement 7: PocketBase Adapter Implementation

**User Story:** As a developer, I want a fully functional PocketBase adapter, so that I can use the same model/route interface with a PocketBase backend.

#### Acceptance Criteria

1. THE PocketBase DB_Module SHALL expose `connect`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. WHEN a Filter_Array is provided, THE PocketBase DB_Module SHALL translate the filter into PocketBase SDK filter strings
3. WHEN a `get` call is made, THE PocketBase DB_Module SHALL return an object with `data` (array of records) and `count` (total matching records) properties
4. WHEN a `list` call is made with `page` and `limit` parameters, THE PocketBase DB_Module SHALL return paginated results using the PocketBase SDK pagination parameters
5. THE PocketBase Adapter SHALL export `db`, `model`, and `route` from its `index.js`

### Requirement 8: Supabase Adapter Implementation

**User Story:** As a developer, I want a fully functional Supabase adapter, so that I can use the same model/route interface with a Supabase project.

#### Acceptance Criteria

1. THE Supabase DB_Module SHALL expose `connect`, `get`, `list`, `qcount`, `remove`, `upsert`, `insert`, and `change` functions with the same signatures as the MySQL DB_Module
2. WHEN a Filter_Array is provided, THE Supabase DB_Module SHALL translate the filter into Supabase JS client query builder calls using `.eq()`, `.like()`, `.in()`, `.lt()`, `.gt()`, `.lte()`, `.gte()`, and `.neq()` methods
3. WHEN a `get` call is made, THE Supabase DB_Module SHALL return an object with `data` (array of rows) and `count` (total matching rows) properties
4. WHEN a `list` call is made with `page` and `limit` parameters, THE Supabase DB_Module SHALL return paginated results using `.range()`
5. WHEN an `upsert` call is made, THE Supabase DB_Module SHALL use the Supabase `.upsert()` method
6. THE Supabase Adapter SHALL export `db`, `model`, and `route` from its `index.js`

### Requirement 9: Model Module Consistency

**User Story:** As a developer, I want all adapters to use a consistent Model_Module interface, so that switching databases requires no application code changes.

#### Acceptance Criteria

1. THE Model_Module for each adapter SHALL accept the same constructor parameters: `(db, table, modelStructure, primary_key, unique, option)`
2. THE Model_Module for each adapter SHALL expose `insert`, `update`, `upsert`, `remove`, `byId`, `find`, `findOne`, and `list` methods
3. WHEN `insert` is called with a single object, THE Model_Module SHALL validate the payload against the model structure, remove the primary key, insert the record, and return the inserted record fetched by its new primary key
4. WHEN `insert` is called with a `data` array (bulk), THE Model_Module SHALL validate each entry, remove primary keys, insert all records, and return the total `rows` count
5. WHEN `update` is called with a single object containing the primary key, THE Model_Module SHALL validate the payload, update the record, and return the updated record
6. WHEN `update` is called with a `data` array (bulk), THE Model_Module SHALL validate each entry, update all records via upsert, and return the total `rows` count
7. WHEN `remove` is called with a primary key value, THE Model_Module SHALL delete the matching record
8. WHEN `remove` is called with a filter object or Filter_Array, THE Model_Module SHALL delete all matching records
9. WHEN `byId` is called with a valid id, THE Model_Module SHALL return the single matching record or null
10. WHEN `find` is called with a filter, THE Model_Module SHALL return an object with `data` (array) and `count` (number) properties
11. WHEN `findOne` is called with a filter matching a record, THE Model_Module SHALL return the first matching record; WHEN no record matches, THE Model_Module SHALL return `false`
12. WHEN `list` is called, THE Model_Module SHALL support `page`, `size`, `sort`, and filter parameters and return paginated results with `data` and `count`
13. THE Model_Module for each adapter SHALL expose `pk`, `modelStructure`, and `table` properties

### Requirement 10: Route Module Consistency

**User Story:** As a developer, I want all adapters to provide a Route_Module that generates Express REST endpoints, so that I can mount CRUD APIs for any database with a single function call.

#### Acceptance Criteria

1. THE Route_Module for each adapter SHALL accept `(model, override)` parameters and return an Express Router
2. THE Route_Module SHALL register `GET /:pk` to retrieve a single record by primary key, returning 200 with the record or 404 when not found
3. THE Route_Module SHALL register `POST /:id` to insert a single record, returning 200 with the inserted record
4. THE Route_Module SHALL register `PUT /:id` to update a single record, verifying the record exists before updating, returning 200 with the updated record or 404 when not found
5. THE Route_Module SHALL register `DELETE /:id` to delete a single record, verifying the record exists before deleting, returning 200 with the deletion result or 404 when not found
6. THE Route_Module SHALL register `GET /` to list records with pagination support
7. THE Route_Module SHALL register `POST /` to bulk insert records from `req.body.data`
8. THE Route_Module SHALL register `PUT /` to bulk update records from `req.body.data`
9. THE Route_Module SHALL register `DELETE /` to bulk delete records from `req.body.data`
10. THE Route_Module SHALL support payload override via the `override` parameter, allowing fields to be injected from `req` (e.g., `{ user_id: "user.user_id" }`)

### Requirement 11: Test Suite for Individual Database Operations

**User Story:** As a developer, I want comprehensive test cases for individual CRUD operations on each adapter, so that I can verify each adapter works correctly in isolation.

#### Acceptance Criteria

1. THE Test_Suite SHALL include individual operation tests for each adapter: MySQL, PostgreSQL, Oracle, SQLite3, MongoDB, DynamoDB, Redis, CockroachDB, MSSQL, PocketBase, and Supabase
2. WHEN a single insert test runs, THE Test_Suite SHALL verify the returned record contains a valid primary key and the correct field values
3. WHEN a single update test runs, THE Test_Suite SHALL verify the returned record reflects the updated field values
4. WHEN a `byId` test runs, THE Test_Suite SHALL verify the correct record is returned for a known primary key
5. WHEN a `findOne` test runs with a valid filter, THE Test_Suite SHALL verify the correct record is returned; WHEN an invalid filter is used, THE Test_Suite SHALL verify `false` is returned
6. WHEN a `find` test runs, THE Test_Suite SHALL verify results are returned for id-based, object-based, and Filter_Array-based queries
7. WHEN a `remove` test runs, THE Test_Suite SHALL verify the record is deleted and subsequent `byId` returns null

### Requirement 12: Test Suite for Bulk Database Operations

**User Story:** As a developer, I want comprehensive test cases for bulk CRUD operations on each adapter, so that I can verify batch processing works correctly.

#### Acceptance Criteria

1. THE Test_Suite SHALL include bulk operation tests for each adapter
2. WHEN a bulk insert test runs with an array of records, THE Test_Suite SHALL verify the returned `rows` count matches the input array length
3. WHEN a bulk update test runs with an array of records containing primary keys, THE Test_Suite SHALL verify the returned `rows` count matches the input array length
4. WHEN a bulk remove test runs with a Filter_Array, THE Test_Suite SHALL verify all matching records are deleted and subsequent find returns count 0
5. WHEN a list test runs with pagination, THE Test_Suite SHALL verify page 0 returns 30 records (default page size) and the last page returns the correct remainder

### Requirement 13: Test Suite for Router-Based REST APIs

**User Story:** As a developer, I want test cases that exercise the REST API routes for each adapter, so that I can verify the full HTTP request/response cycle.

#### Acceptance Criteria

1. THE Test_Suite SHALL include router-based API tests for each adapter using supertest
2. WHEN a POST request is sent to `/:id` (with id = "add"), THE Test_Suite SHALL verify a 200 response with the inserted record
3. WHEN a GET request is sent to `/:pk_value`, THE Test_Suite SHALL verify a 200 response with the correct record
4. WHEN a PUT request is sent to `/:pk_value`, THE Test_Suite SHALL verify a 200 response with the updated record
5. WHEN a DELETE request is sent to `/:pk_value`, THE Test_Suite SHALL verify a 200 response and the record is removed
6. WHEN a POST request is sent to `/` with a `data` array, THE Test_Suite SHALL verify a 200 response with the bulk insert result
7. WHEN a GET request is sent to `/`, THE Test_Suite SHALL verify a 200 response with paginated list results

### Requirement 14: Docker Compose for Integration Testing

**User Story:** As a developer, I want a Docker Compose file that spins up all supported databases, so that I can run the full test suite against real database instances.

#### Acceptance Criteria

1. THE Docker_Compose_File SHALL define services for MySQL, PostgreSQL, MongoDB, Redis, CockroachDB, MSSQL, and DynamoDB (via DynamoDB Local)
2. THE Docker_Compose_File SHALL expose each database on a unique host port to avoid conflicts
3. THE Docker_Compose_File SHALL configure each service with default credentials matching the test environment variables
4. THE Docker_Compose_File SHALL include health checks for each service so tests can wait for readiness
5. THE Docker_Compose_File SHALL define a shared network for all database services
6. IF a database service fails to start, THEN THE Docker_Compose_File SHALL allow the remaining services to continue starting independently via `depends_on` with `condition: service_healthy` or `restart: unless-stopped`

### Requirement 15: Shared Utility Re-exports

**User Story:** As a developer, I want each adapter to re-export the shared Function_Module and Validator_Module, so that adapter-specific code can import utilities from a consistent relative path.

#### Acceptance Criteria

1. THE SQL_Adapter adapters (SQLite3, CockroachDB, MSSQL) SHALL each include a `function.js` that re-exports the shared Function_Module
2. THE SQL_Adapter adapters (SQLite3, CockroachDB, MSSQL) SHALL each include a `validator.js` that re-exports the shared Validator_Module
3. THE NoSQL_Adapter adapters (MongoDB, DynamoDB, Redis, PocketBase, Supabase) SHALL each include a `function.js` that re-exports the shared Function_Module
4. THE NoSQL_Adapter adapters (MongoDB, DynamoDB, Redis, PocketBase, Supabase) SHALL each include a `validator.js` that re-exports the shared Validator_Module
