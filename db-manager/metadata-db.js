"use strict";

const Database = require("better-sqlite3");

/**
 * Creates a metadata database manager for tracking connection and query history.
 * @param {string} dbPath - Path to the SQLite database file
 * @returns {object} Metadata DB interface
 */
function createMetadataDb(dbPath) {
  let db;

  try {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
  } catch (err) {
    process.stderr.write(
      `[metadata-db] Failed to open database at ${dbPath}: ${err.message}\n`,
    );
    // Return a no-op interface so the app can continue without history
    return {
      init() {},
      recordConnection() {
        return null;
      },
      recordQuery() {
        return null;
      },
      getConnections() {
        return [];
      },
      getQueries() {
        return [];
      },
      close() {},
    };
  }

  return {
    /**
     * Creates the connections and queries tables if they don't exist.
     */
    init() {
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            db_type TEXT NOT NULL,
            host TEXT,
            database_name TEXT NOT NULL,
            connected_at TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id INTEGER NOT NULL,
            query_text TEXT NOT NULL,
            executed_at TEXT NOT NULL DEFAULT (datetime('now')),
            row_count INTEGER DEFAULT 0,
            FOREIGN KEY (connection_id) REFERENCES connections(id)
          );
        `);
      } catch (err) {
        process.stderr.write(
          `[metadata-db] Failed to initialize tables: ${err.message}\n`,
        );
      }
    },

    /**
     * Records a new database connection in history.
     * @param {string} dbType - The database type (e.g., 'sqlite3', 'mysql')
     * @param {string|null} host - The database host
     * @param {string} dbName - The database name
     * @returns {number|null} The inserted row id, or null on failure
     */
    recordConnection(dbType, host, dbName) {
      try {
        const stmt = db.prepare(
          "INSERT INTO connections (db_type, host, database_name) VALUES (?, ?, ?)",
        );
        const result = stmt.run(dbType, host || null, dbName);
        return result.lastInsertRowid;
      } catch (err) {
        process.stderr.write(
          `[metadata-db] Failed to record connection: ${err.message}\n`,
        );
        return null;
      }
    },

    /**
     * Records a query execution in history.
     * @param {number} connectionId - The connection id this query belongs to
     * @param {string} queryText - The query text or operation description
     * @param {number} rowCount - Number of rows affected/returned
     * @returns {number|null} The inserted row id, or null on failure
     */
    recordQuery(connectionId, queryText, rowCount) {
      try {
        const stmt = db.prepare(
          "INSERT INTO queries (connection_id, query_text, row_count) VALUES (?, ?, ?)",
        );
        const result = stmt.run(connectionId, queryText, rowCount || 0);
        return result.lastInsertRowid;
      } catch (err) {
        process.stderr.write(
          `[metadata-db] Failed to record query: ${err.message}\n`,
        );
        return null;
      }
    },

    /**
     * Retrieves recent connections ordered by connected_at DESC.
     * @param {number} [limit=20] - Maximum number of connections to return
     * @returns {Array} Array of connection records
     */
    getConnections(limit = 20) {
      try {
        const stmt = db.prepare(
          "SELECT * FROM connections ORDER BY connected_at DESC LIMIT ?",
        );
        return stmt.all(limit);
      } catch (err) {
        process.stderr.write(
          `[metadata-db] Failed to get connections: ${err.message}\n`,
        );
        return [];
      }
    },

    /**
     * Retrieves recent queries for a specific connection.
     * @param {number} connectionId - The connection id to filter by
     * @param {number} [limit=50] - Maximum number of queries to return
     * @returns {Array} Array of query records
     */
    getQueries(connectionId, limit = 50) {
      try {
        const stmt = db.prepare(
          "SELECT * FROM queries WHERE connection_id = ? ORDER BY executed_at DESC LIMIT ?",
        );
        return stmt.all(connectionId, limit);
      } catch (err) {
        process.stderr.write(
          `[metadata-db] Failed to get queries: ${err.message}\n`,
        );
        return [];
      }
    },

    /**
     * Closes the SQLite database handle.
     */
    close() {
      try {
        if (db && db.open) {
          db.close();
        }
      } catch (err) {
        process.stderr.write(
          `[metadata-db] Failed to close database: ${err.message}\n`,
        );
      }
    },
  };
}

module.exports = createMetadataDb;
