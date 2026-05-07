"use strict";

/**
 * Creates an adapter proxy that translates API requests into library adapter calls.
 * Handles adapter-specific table listing queries and delegates CRUD operations.
 *
 * @param {object} db - The library adapter instance (from src/index.js init())
 * @param {string} dbType - The database type (e.g., 'sqlite3', 'mysql', 'postgres')
 * @returns {object} Adapter proxy interface
 */
function createAdapterProxy(db, dbType) {
  const type = (dbType || "").toLowerCase();

  /**
   * Returns the SQL or command to list tables for the given adapter type.
   * @returns {{ sql: string, extract: function }} Query config for table listing
   */
  function getTableListConfig() {
    switch (type) {
      case "sqlite3":
        return {
          sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          extract: (rows) => rows.map((r) => r.name),
        };
      case "mysql":
      case "mariadb":
        return {
          sql: "SHOW TABLES",
          extract: (rows) =>
            rows.map((r) => {
              // SHOW TABLES returns rows with a dynamic key like "Tables_in_dbname"
              const keys = Object.keys(r);
              return r[keys[0]];
            }),
        };
      case "postgres":
      case "postgresql":
      case "cockroachdb":
        return {
          sql: "SELECT tablename FROM pg_tables WHERE schemaname='public'",
          extract: (rows) => rows.map((r) => r.tablename),
        };
      case "mssql":
        return {
          sql: "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'",
          extract: (rows) => rows.map((r) => r.TABLE_NAME),
        };
      case "oracle":
        return {
          sql: "SELECT table_name FROM user_tables",
          extract: (rows) => rows.map((r) => r.TABLE_NAME || r.table_name),
        };
      case "mongodb":
        return {
          sql: "listCollections",
          extract: (rows) => {
            if (Array.isArray(rows)) {
              return rows.map((r) => r.name || r);
            }
            return [];
          },
        };
      case "dynamodb":
        return {
          sql: "ListTables",
          extract: (rows) => {
            if (Array.isArray(rows)) {
              return rows.map((r) => r.TableName || r);
            }
            if (rows && rows.TableNames) {
              return rows.TableNames;
            }
            return [];
          },
        };
      case "redis":
        return {
          sql: "KEYS *",
          extract: (rows) => {
            if (Array.isArray(rows)) {
              return rows;
            }
            return [];
          },
        };
      default:
        return {
          sql: "SHOW TABLES",
          extract: (rows) =>
            rows.map((r) => {
              const keys = Object.keys(r);
              return r[keys[0]];
            }),
        };
    }
  }

  /**
   * Returns the SQL to get schema/column info for a table.
   * @param {string} table - Table name
   * @returns {{ sql: string, params: Array, extract: function }}
   */
  function getSchemaConfig(table) {
    switch (type) {
      case "sqlite3":
        return {
          sql: `PRAGMA table_info("${table.replace(/"/g, '""')}")`,
          params: [],
          extract: (rows) => {
            let pk = null;
            const columns = rows.map((r) => {
              const isPk = r.pk === 1;
              if (isPk) pk = r.name;
              return {
                name: r.name,
                type: r.type || "TEXT",
                nullable: isPk ? false : r.notnull === 0,
                default: r.dflt_value,
                pk: isPk,
              };
            });
            return { columns, pk };
          },
        };
      case "mysql":
      case "mariadb":
        return {
          sql: `SHOW COLUMNS FROM \`${table.replace(/`/g, "``")}\``,
          params: [],
          extract: (rows) => {
            let pk = null;
            const columns = rows.map((r) => {
              const isPk = r.Key === "PRI";
              if (isPk && !pk) pk = r.Field;
              return {
                name: r.Field,
                type: r.Type,
                nullable: r.Null === "YES",
                default: r.Default,
                pk: isPk,
              };
            });
            return { columns, pk };
          },
        };
      case "postgres":
      case "postgresql":
      case "cockroachdb":
        return {
          sql: `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
                CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN true ELSE false END as is_pk
                FROM information_schema.columns c
                LEFT JOIN information_schema.key_column_usage kcu
                  ON c.table_name = kcu.table_name AND c.column_name = kcu.column_name
                LEFT JOIN information_schema.table_constraints tc
                  ON kcu.constraint_name = tc.constraint_name AND tc.constraint_type = 'PRIMARY KEY'
                WHERE c.table_name = '${table.replace(/'/g, "''")}'
                AND c.table_schema = 'public'
                ORDER BY c.ordinal_position`,
          params: [],
          extract: (rows) => {
            let pk = null;
            const columns = rows.map((r) => {
              const isPk = r.is_pk === true || r.is_pk === "true";
              if (isPk && !pk) pk = r.column_name;
              return {
                name: r.column_name,
                type: r.data_type,
                nullable: r.is_nullable === "YES",
                default: r.column_default,
                pk: isPk,
              };
            });
            return { columns, pk };
          },
        };
      case "mssql":
        return {
          sql: `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
                CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PK
                FROM INFORMATION_SCHEMA.COLUMNS c
                LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                  ON c.TABLE_NAME = kcu.TABLE_NAME AND c.COLUMN_NAME = kcu.COLUMN_NAME
                  AND kcu.CONSTRAINT_NAME IN (
                    SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
                    WHERE CONSTRAINT_TYPE = 'PRIMARY KEY' AND TABLE_NAME = '${table.replace(/'/g, "''")}'
                  )
                WHERE c.TABLE_NAME = '${table.replace(/'/g, "''")}'
                ORDER BY c.ORDINAL_POSITION`,
          params: [],
          extract: (rows) => {
            let pk = null;
            const columns = rows.map((r) => {
              const isPk = r.IS_PK === 1;
              if (isPk && !pk) pk = r.COLUMN_NAME;
              return {
                name: r.COLUMN_NAME,
                type: r.DATA_TYPE,
                nullable: r.IS_NULLABLE === "YES",
                default: r.COLUMN_DEFAULT,
                pk: isPk,
              };
            });
            return { columns, pk };
          },
        };
      case "oracle":
        return {
          sql: `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT,
                CASE WHEN cc.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PK
                FROM USER_TAB_COLUMNS c
                LEFT JOIN (
                  SELECT cc2.COLUMN_NAME FROM USER_CONS_COLUMNS cc2
                  JOIN USER_CONSTRAINTS uc ON cc2.CONSTRAINT_NAME = uc.CONSTRAINT_NAME
                  WHERE uc.CONSTRAINT_TYPE = 'P' AND uc.TABLE_NAME = '${table.replace(/'/g, "''").toUpperCase()}'
                ) cc ON c.COLUMN_NAME = cc.COLUMN_NAME
                WHERE c.TABLE_NAME = '${table.replace(/'/g, "''").toUpperCase()}'
                ORDER BY c.COLUMN_ID`,
          params: [],
          extract: (rows) => {
            let pk = null;
            const columns = rows.map((r) => {
              const isPk = r.IS_PK === 1;
              if (isPk && !pk) pk = r.COLUMN_NAME;
              return {
                name: r.COLUMN_NAME,
                type: r.DATA_TYPE,
                nullable: r.NULLABLE === "Y",
                default: r.DATA_DEFAULT,
                pk: isPk,
              };
            });
            return { columns, pk };
          },
        };
      case "mongodb":
        // MongoDB doesn't have a fixed schema; return empty columns
        return {
          sql: null,
          params: [],
          extract: () => ({ columns: [], pk: "_id" }),
        };
      case "dynamodb":
        // DynamoDB schema is defined at table creation; return minimal info
        return {
          sql: null,
          params: [],
          extract: () => ({ columns: [], pk: null }),
        };
      case "redis":
        // Redis is key-value; no column schema
        return {
          sql: null,
          params: [],
          extract: () => ({ columns: [], pk: "key" }),
        };
      default:
        return {
          sql: `SHOW COLUMNS FROM \`${table.replace(/`/g, "``")}\``,
          params: [],
          extract: (rows) => {
            let pk = null;
            const columns = rows.map((r) => {
              const isPk = r.Key === "PRI";
              if (isPk && !pk) pk = r.Field;
              return {
                name: r.Field,
                type: r.Type,
                nullable: r.Null === "YES",
                default: r.Default,
                pk: isPk,
              };
            });
            return { columns, pk };
          },
        };
    }
  }

  return {
    /**
     * Lists all tables in the connected database.
     * @returns {Promise<string[]>} Array of table names
     */
    async getTables() {
      const config = getTableListConfig();
      const result = await Promise.resolve(db.query(config.sql));
      return config.extract(result);
    },

    /**
     * Gets the schema (columns and primary key) for a table.
     * @param {string} table - Table name
     * @returns {Promise<{ columns: Array, pk: string|null }>}
     */
    async getSchema(table) {
      const config = getSchemaConfig(table);
      if (config.sql === null) {
        return config.extract();
      }
      const result = await Promise.resolve(db.query(config.sql, config.params));
      return config.extract(result);
    },

    /**
     * Lists rows from a table with optional filtering, sorting, and pagination.
     * Delegates to db.list().
     * @param {string} table - Table name
     * @param {Array} filter - Filter conditions (library format)
     * @param {Array} sort - Sort directives (e.g., ["-name", "id"])
     * @param {number} page - Page number (0-indexed)
     * @param {number} limit - Rows per page
     * @returns {Promise<{ data: Array, count: number }>}
     */
    async listRows(table, filter = [], sort = [], page = 0, limit = 30) {
      const result = await Promise.resolve(
        db.list(table, filter, sort, null, page, limit),
      );
      return result;
    },

    /**
     * Inserts a new row into a table.
     * Delegates to db.insert().
     * @param {string} table - Table name
     * @param {object} data - Row data object
     * @returns {Promise<{ rows: number, message: string, type: string, id?: number }>}
     */
    async insertRow(table, data) {
      const result = await Promise.resolve(db.insert(table, data));
      return result;
    },

    /**
     * Upserts a row (insert or update on conflict).
     * Delegates to db.upsert().
     * @param {string} table - Table name
     * @param {object} data - Row data object
     * @param {string[]} uniqueKeys - Columns that define uniqueness
     * @returns {Promise<{ rows: number, message: string, type: string, id?: number }>}
     */
    async upsertRow(table, data, uniqueKeys = []) {
      const result = await Promise.resolve(db.upsert(table, data, uniqueKeys));
      return result;
    },

    /**
     * Removes rows from a table matching the given filter.
     * Delegates to db.remove().
     * @param {string} table - Table name
     * @param {Array} filter - Filter conditions (library format)
     * @returns {Promise<{ message: string }>}
     */
    async removeRows(table, filter) {
      const result = await Promise.resolve(db.remove(table, filter));
      return result;
    },
  };
}

module.exports = createAdapterProxy;
