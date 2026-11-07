"use strict";

const fs = require("fs");
const path = require("path");

const MIGRATIONS_TABLE = "_dbmr_migrations";

/**
 * Ensure the migration tracking table exists across various database adapters.
 */
async function ensureMigrationTable(db, adapterType = "") {
  const at = (adapterType || "").toLowerCase();

  if (at.includes("postgres") || at.includes("cockroach")) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
        "id" VARCHAR(255) PRIMARY KEY,
        "name" VARCHAR(255) NOT NULL,
        "batch" INT NOT NULL,
        "applied_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else if (at.includes("mysql") || at.includes("mariadb")) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
        \`id\` VARCHAR(255) NOT NULL,
        \`name\` VARCHAR(255) NOT NULL,
        \`batch\` INT NOT NULL,
        \`applied_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      )
    `);
  } else if (at.includes("mssql")) {
    await db.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${MIGRATIONS_TABLE}' and xtype='U')
      CREATE TABLE [${MIGRATIONS_TABLE}] (
        [id] VARCHAR(255) PRIMARY KEY,
        [name] VARCHAR(255) NOT NULL,
        [batch] INT NOT NULL,
        [applied_at] DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else if (at.includes("oracle")) {
    await db.query(`
      BEGIN
        EXECUTE IMMEDIATE 'CREATE TABLE "${MIGRATIONS_TABLE}" (
          "id" VARCHAR2(255) PRIMARY KEY,
          "name" VARCHAR2(255) NOT NULL,
          "batch" NUMBER NOT NULL,
          "applied_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )';
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLCODE != -955 THEN RAISE; END IF;
      END;
    `);
  } else {
    // Default to SQLite3 / universal standard SQL
    await db.query(`
      CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "batch" INTEGER NOT NULL,
        "applied_at" TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
}

/**
 * Fetch all applied migrations from the tracking table.
 */
async function getAppliedMigrations(db) {
  try {
    const res = await db.query(
      `SELECT id, name, batch, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id ASC`,
    );
    // Standardize result array
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    if (res && Array.isArray(res.rows)) return res.rows;
    return [];
  } catch (err) {
    const msg = (err && err.message ? err.message : String(err)).toLowerCase();
    const isTableMissing =
      msg.includes("no such table") ||
      msg.includes("does not exist") ||
      msg.includes("doesn't exist") ||
      msg.includes("invalid object name") ||
      msg.includes("ora-00942");
    if (isTableMissing) {
      return [];
    }
    throw err;
  }
}

/**
 * List all migration files from disk in alphanumeric order.
 */
function getMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  const files = fs.readdirSync(migrationsDir);
  return files
    .filter((f) => /^\d+_.+\.(js|sql)$/i.test(f) && !/\.down\.sql$/i.test(f))
    .sort()
    .map((filename) => {
      const fullPath = path.join(migrationsDir, filename);
      const ext = path.extname(filename).toLowerCase();
      const id = path.basename(filename, ext);
      return {
        filename,
        fullPath,
        ext,
        id,
      };
    });
}

/**
 * Create a new timestamped migration file on disk.
 */
function createMigrationFile(name, migrationsDir = "migrations") {
  if (!name || typeof name !== "string") {
    throw new Error("Migration name is required");
  }

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());

  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const fileName = `${timestamp}_${cleanName}.js`;
  const fullPath = path.join(migrationsDir, fileName);

  const template = `"use strict";

module.exports = {
  /**
   * Run the migration.
   * @param {import("db-model-router").DatabaseAdapter} db
   */
  up: async (db) => {
    // Write your schema changes here. Example:
    // await db.query("CREATE TABLE example (id INT PRIMARY KEY, title TEXT);");
  },

  /**
   * Revert the migration.
   * @param {import("db-model-router").DatabaseAdapter} db
   */
  down: async (db) => {
    // Write your rollback logic here. Example:
    // await db.query("DROP TABLE example;");
  },
};
`;

  fs.writeFileSync(fullPath, template, "utf-8");
  return { fileName, fullPath };
}

/**
 * Run pending migrations forward (UP).
 */
async function up(db, migrationsDir = "migrations", adapterType = "") {
  await ensureMigrationTable(db, adapterType);

  const applied = await getAppliedMigrations(db);
  const appliedIds = new Set(applied.map((m) => m.id));

  const allFiles = getMigrationFiles(migrationsDir);
  const pending = allFiles.filter((f) => !appliedIds.has(f.id));

  if (pending.length === 0) {
    return { applied: [], currentBatch: applied.length > 0 ? Math.max(...applied.map((m) => Number(m.batch) || 0)) : 0 };
  }

  const lastBatch = applied.length > 0
    ? Math.max(...applied.map((m) => Number(m.batch) || 0))
    : 0;
  const nextBatch = lastBatch + 1;

  const isPg =
    adapterType.toLowerCase().includes("postgres") ||
    adapterType.toLowerCase().includes("cockroach");

  const newlyApplied = [];

  for (const file of pending) {
    if (file.ext === ".js") {
      // eslint-disable-next-line security/detect-non-literal-require
      const migration = require(path.resolve(file.fullPath));
      if (typeof migration.up === "function") {
        await migration.up(db);
      }
    } else if (file.ext === ".sql") {
      const sql = fs.readFileSync(file.fullPath, "utf-8");
      if (sql.trim()) {
        await db.query(sql);
      }
    }

    // Record migration
    const insertSql = isPg
      ? `INSERT INTO "${MIGRATIONS_TABLE}" ("id", "name", "batch") VALUES ($1, $2, $3)`
      : `INSERT INTO "${MIGRATIONS_TABLE}" ("id", "name", "batch") VALUES (?, ?, ?)`;

    await db.query(insertSql, [file.id, file.filename, nextBatch]);
    newlyApplied.push({ id: file.id, filename: file.filename, batch: nextBatch });
  }

  return { applied: newlyApplied, batch: nextBatch };
}

/**
 * Revert the last batch of migrations (DOWN).
 */
async function down(db, migrationsDir = "migrations", adapterType = "") {
  await ensureMigrationTable(db, adapterType);

  const applied = await getAppliedMigrations(db);
  if (applied.length === 0) {
    return { rolledBack: [] };
  }

  const lastBatch = Math.max(...applied.map((m) => Number(m.batch) || 0));
  const batchMigrations = applied
    .filter((m) => Number(m.batch) === lastBatch)
    .sort((a, b) => b.id.localeCompare(a.id)); // Reverse chronological order

  const allFiles = getMigrationFiles(migrationsDir);
  const fileMap = new Map(allFiles.map((f) => [f.id, f]));

  const isPg =
    adapterType.toLowerCase().includes("postgres") ||
    adapterType.toLowerCase().includes("cockroach");

  const rolledBack = [];

  for (const m of batchMigrations) {
    const file = fileMap.get(m.id);
    if (file && file.ext === ".js") {
      // eslint-disable-next-line security/detect-non-literal-require
      const migration = require(path.resolve(file.fullPath));
      if (typeof migration.down === "function") {
        await migration.down(db);
      }
    } else if (file && file.ext === ".sql") {
      const downSqlFile = file.fullPath.replace(/\.sql$/i, ".down.sql");
      if (fs.existsSync(downSqlFile)) {
        const downSql = fs.readFileSync(downSqlFile, "utf8");
        await db.query(downSql);
      } else {
        throw new Error(
          `Cannot rollback SQL migration '${file.filename}': missing corresponding '.down.sql' file`,
        );
      }
    }

    const deleteSql = isPg
      ? `DELETE FROM "${MIGRATIONS_TABLE}" WHERE "id" = $1`
      : `DELETE FROM "${MIGRATIONS_TABLE}" WHERE "id" = ?`;

    await db.query(deleteSql, [m.id]);
    rolledBack.push({ id: m.id, name: m.name, batch: lastBatch });
  }

  return { rolledBack, batch: lastBatch };
}

/**
 * Get status of all migrations (applied and pending).
 */
async function status(db, migrationsDir = "migrations", adapterType = "") {
  await ensureMigrationTable(db, adapterType);

  const applied = await getAppliedMigrations(db);
  const appliedMap = new Map(applied.map((m) => [m.id, m]));

  const allFiles = getMigrationFiles(migrationsDir);

  return allFiles.map((f) => {
    const record = appliedMap.get(f.id);
    if (record) {
      return {
        id: f.id,
        filename: f.filename,
        status: "Applied",
        batch: Number(record.batch),
        applied_at: record.applied_at,
      };
    }
    return {
      id: f.id,
      filename: f.filename,
      status: "Pending",
      batch: null,
      applied_at: null,
    };
  });
}

module.exports = {
  MIGRATIONS_TABLE,
  ensureMigrationTable,
  getAppliedMigrations,
  getMigrationFiles,
  createMigrationFile,
  up,
  down,
  status,
};
