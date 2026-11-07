"use strict";

/**
 * SaaS migration generator.
 *
 * Generates CREATE TABLE migration files for all SaaS tables with proper
 * column types, foreign key constraints, and unique constraints per adapter.
 * Supports SQL adapters (postgres, mysql, mariadb, sqlite3, mssql, oracle, cockroachdb)
 * and NoSQL adapters (mongodb, dynamodb, redis).
 */

const { mapColumnType } = require("../generate-migration");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SQL_ADAPTERS = [
  "mysql",
  "mariadb",
  "postgres",
  "sqlite3",
  "mssql",
  "cockroachdb",
  "oracle",
];

/**
 * Map a TEXT column type per adapter.
 * Used for columns that need unbounded text storage (e.g. response_body).
 * @param {string} adapter
 * @returns {string}
 */
function textType(adapter) {
  if (adapter === "oracle") return "CLOB";
  if (adapter === "mssql") return "NVARCHAR(MAX)";
  return "TEXT";
}

/**
 * Table definitions in dependency order.
 * Each entry defines columns, primary key, foreign keys, and unique constraints.
 */
const TABLE_DEFINITIONS = [
  {
    name: "tenants",
    columns: [
      { name: "tenant_id", rule: "auto_increment", pk: true },
      { name: "name", rule: "required|string" },
      { name: "slug", rule: "required|string" },
      { name: "attributes", rule: "object" },
      { name: "created_at", rule: "datetime", timestamp: true },
      { name: "modified_at", rule: "datetime", timestamp: true },
    ],
    foreignKeys: [],
    unique: [["slug"]],
  },
  {
    name: "roles",
    columns: [
      { name: "role_id", rule: "auto_increment", pk: true },
      { name: "tenant_id", rule: "integer" },
      { name: "name", rule: "required|string" },
      { name: "created_at", rule: "datetime", timestamp: true },
      { name: "modified_at", rule: "datetime", timestamp: true },
    ],
    foreignKeys: [
      { column: "tenant_id", references: "tenants", refColumn: "tenant_id" },
    ],
    unique: [["tenant_id", "name"]],
  },
  {
    name: "users",
    columns: [
      { name: "user_id", rule: "auto_increment", pk: true },
      { name: "email", rule: "required|string" },
      { name: "phone", rule: "string" },
      { name: "password_hash", rule: "required|string" },
      { name: "name", rule: "required|string" },
      { name: "unique_attribute", rule: "required|string" },
      { name: "tenant_id", rule: "integer" },
      { name: "role_id", rule: "required|integer" },
      { name: "attributes", rule: "object" },
      { name: "created_at", rule: "datetime", timestamp: true },
      { name: "modified_at", rule: "datetime", timestamp: true },
    ],
    foreignKeys: [
      { column: "tenant_id", references: "tenants", refColumn: "tenant_id" },
      { column: "role_id", references: "roles", refColumn: "role_id" },
    ],
    unique: [["tenant_id", "unique_attribute"]],
  },
  {
    name: "role_permissions",
    columns: [
      { name: "role_permission_id", rule: "auto_increment", pk: true },
      { name: "role_id", rule: "required|integer" },
      { name: "permission", rule: "required|object" },
      { name: "created_at", rule: "datetime", timestamp: true },
      { name: "modified_at", rule: "datetime", timestamp: true },
    ],
    foreignKeys: [
      { column: "role_id", references: "roles", refColumn: "role_id" },
    ],
    unique: [],
  },
  {
    name: "webhooks",
    columns: [
      { name: "webhook_id", rule: "auto_increment", pk: true },
      { name: "tenant_id", rule: "required|integer" },
      { name: "url", rule: "required|string" },
      { name: "key", rule: "required|string" },
      { name: "secret", rule: "required|string" },
      { name: "created_at", rule: "datetime", timestamp: true },
      { name: "modified_at", rule: "datetime", timestamp: true },
    ],
    foreignKeys: [
      { column: "tenant_id", references: "tenants", refColumn: "tenant_id" },
    ],
    unique: [],
  },
  {
    name: "webhook_logs",
    columns: [
      { name: "webhook_log_id", rule: "auto_increment", pk: true },
      { name: "webhook_id", rule: "required|integer" },
      { name: "tenant_id", rule: "required|integer" },
      { name: "event_type", rule: "required|string" },
      { name: "payload", rule: "required|object" },
      { name: "status", rule: "required|string" },
      { name: "response_body", rule: "text" },
      { name: "response_status_code", rule: "integer" },
      { name: "created_at", rule: "datetime", timestamp: true },
    ],
    foreignKeys: [
      { column: "webhook_id", references: "webhooks", refColumn: "webhook_id" },
    ],
    unique: [],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Quote an identifier based on adapter.
 * @param {string} name
 * @param {string} adapter
 * @returns {string}
 */
function quoteIdent(name, adapter) {
  if (adapter === "mssql") return `[${name}]`;
  if (adapter === "oracle") return `"${name.toUpperCase()}"`;
  return name;
}

/**
 * Format a Date as YYYYMMDDHHMMSS (14-digit string).
 * @param {Date} date
 * @returns {string}
 */
function migrationTimestamp(date) {
  const y = String(date.getFullYear()).padStart(4, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${mo}${d}${h}${mi}${s}`;
}

/**
 * Default timestamp expression per adapter.
 * @param {string} adapter
 * @returns {string}
 */
function defaultTimestamp(adapter) {
  if (adapter === "mssql") {
    return " DEFAULT GETDATE()";
  }
  return " DEFAULT CURRENT_TIMESTAMP";
}

// ---------------------------------------------------------------------------
// SQL Migration Generation
// ---------------------------------------------------------------------------

/**
 * Generate a CREATE TABLE SQL statement for a SaaS table definition.
 *
 * @param {object} tableDef - Table definition from TABLE_DEFINITIONS
 * @param {string} adapter - Database adapter name
 * @returns {string} SQL CREATE TABLE statement
 */
function generateCreateTableSQL(tableDef, adapter) {
  const lines = [];

  for (const col of tableDef.columns) {
    let line;

    // Handle "text" type specially (not supported by mapColumnType)
    if (col.rule === "text") {
      const sqlType = textType(adapter);
      line = `  ${quoteIdent(col.name, adapter)} ${sqlType}`;
      // text columns are nullable by default
    } else {
      const { sqlType, nullable, isAutoIncrement } = mapColumnType(
        col.rule,
        adapter,
      );

      if (col.pk) {
        if (isAutoIncrement && adapter === "sqlite3") {
          line = `  ${quoteIdent(col.name, adapter)} INTEGER PRIMARY KEY AUTOINCREMENT`;
        } else {
          line = `  ${quoteIdent(col.name, adapter)} ${sqlType} PRIMARY KEY`;
        }
      } else {
        line = `  ${quoteIdent(col.name, adapter)} ${sqlType}`;
        if (!nullable) {
          line += " NOT NULL";
        }
        if (col.timestamp) {
          line += defaultTimestamp(adapter);
        }
      }
    }

    lines.push(line);
  }

  // Foreign key constraints
  for (const fk of tableDef.foreignKeys) {
    lines.push(
      `  FOREIGN KEY (${quoteIdent(fk.column, adapter)}) REFERENCES ${quoteIdent(fk.references, adapter)}(${quoteIdent(fk.refColumn, adapter)})`,
    );
  }

  // Unique constraints
  for (const cols of tableDef.unique) {
    const quotedCols = cols.map((c) => quoteIdent(c, adapter)).join(", ");
    lines.push(`  UNIQUE (${quotedCols})`);
  }

  const createPrefix =
    adapter === "oracle" || adapter === "mssql"
      ? `CREATE TABLE ${quoteIdent(tableDef.name, adapter)}`
      : `CREATE TABLE IF NOT EXISTS ${quoteIdent(tableDef.name, adapter)}`;

  return `${createPrefix} (\n${lines.join(",\n")}\n);\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate migration files for all SaaS tables.
 *
 * For SQL adapters: produces a single .sql file with all CREATE TABLE statements.
 * For NoSQL adapters: produces a single .js file with all collection setups.
 *
 * @param {string} adapter - Database adapter name
 * @param {Date|number} [timestamp] - Base timestamp (Date object or ms since epoch). Defaults to new Date().
 * @returns {Array<{ relPath: string, content: string }>}
 */
function generateSaasMigrations(adapter, timestamp) {
  let baseDate;
  if (timestamp instanceof Date) {
    baseDate = timestamp;
  } else if (typeof timestamp === "number") {
    baseDate = new Date(timestamp);
  } else {
    baseDate = new Date();
  }

  const isSql = SQL_ADAPTERS.includes(adapter);
  const tsStr = migrationTimestamp(baseDate);

  if (isSql) {
    // Single SQL file with all CREATE TABLE statements
    const statements = [];
    for (const tableDef of TABLE_DEFINITIONS) {
      statements.push(generateCreateTableSQL(tableDef, adapter));
    }
    const content = statements.join("\n");
    return [
      {
        relPath: `migrations/${tsStr}_create_saas_tables.sql`,
        content,
      },
    ];
  } else if (adapter === "mongodb") {
    // Single JS file with all MongoDB collection setups
    const content = `"use strict";

module.exports = {
  async up(db) {
${TABLE_DEFINITIONS.map((td) => {
  const indexLines = [];
  for (const cols of td.unique) {
    const indexObj = cols.map((c) => `${c}: 1`).join(", ");
    indexLines.push(
      `    await db.collection("${td.name}").createIndex({ ${indexObj} }, { unique: true });`,
    );
  }
  return `    await db.createCollection("${td.name}");\n${indexLines.join("\n")}`;
}).join("\n")}
  },

  async down(db) {
${TABLE_DEFINITIONS.map((td) => `    await db.collection("${td.name}").drop();`).join("\n")}
  },
};
`;
    return [
      {
        relPath: `migrations/${tsStr}_create_saas_tables.js`,
        content,
      },
    ];
  } else if (adapter === "dynamodb") {
    const pkNames = TABLE_DEFINITIONS.map((td) => {
      const pk = td.columns.find((c) => c.pk);
      return { table: td.name, pk: pk ? pk.name : "id" };
    });
    const content = `import { CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";

export async function up(db) {
${pkNames
  .map(
    (t) => `  await db.send(new CreateTableCommand({
    TableName: "${t.table}",
    KeySchema: [{ AttributeName: "${t.pk}", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "${t.pk}", AttributeType: "N" }],
    BillingMode: "PAY_PER_REQUEST",
  }));`,
  )
  .join("\n")}
}

export async function down(db) {
${pkNames.map((t) => `  await db.send(new DeleteTableCommand({ TableName: "${t.table}" }));`).join("\n")}
}
`;
    return [
      {
        relPath: `migrations/${tsStr}_create_saas_tables.js`,
        content,
      },
    ];
  } else if (adapter === "redis") {
    const content = `"use strict";

module.exports = {
  async up(db) {
    // Redis is schema-less. This migration is a placeholder.
${TABLE_DEFINITIONS.map((td) => `    console.log("Redis: ${td.name} collection ready (schema-less).");`).join("\n")}
  },

  async down(db) {
${TABLE_DEFINITIONS.map(
  (td) => `    const ${td.name}Keys = await db.keys("${td.name}:*");
    if (${td.name}Keys.length > 0) await db.del(...${td.name}Keys);`,
).join("\n")}
  },
};
`;
    return [
      {
        relPath: `migrations/${tsStr}_create_saas_tables.js`,
        content,
      },
    ];
  }

  // Fallback
  return [
    {
      relPath: `migrations/${tsStr}_create_saas_tables.js`,
      content: `// Migration for SaaS tables\n`,
    },
  ];
}

module.exports = {
  generateSaasMigrations,
  generateCreateTableSQL,
  TABLE_DEFINITIONS,
  SQL_ADAPTERS,
};
