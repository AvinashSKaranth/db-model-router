"use strict";

const SQL_DATABASES = [
  "mysql",
  "mariadb",
  "postgres",
  "sqlite3",
  "mssql",
  "cockroachdb",
  "oracle",
];
const NOSQL_DATABASES = ["mongodb", "redis", "dynamodb"];

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
 * Returns true if the database is a SQL database.
 * @param {string} database
 * @returns {boolean}
 */
function isSql(database) {
  return SQL_DATABASES.includes(database);
}

// ---------------------------------------------------------------------------
// Environment variable config map (DRY: shared by .env and .env.example)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EnvVarDef
 * @property {string} key - Variable name
 * @property {string} defaultValue - Value for .env
 * @property {string} placeholder - Value for .env.example
 */

/** @type {Record<string, EnvVarDef[]>} */
const DB_ENV_MAP = {
  mysql: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "3306", placeholder: "3306" },
    { key: "DB_NAME", defaultValue: "my_app", placeholder: "your_database" },
    { key: "DB_USER", defaultValue: "root", placeholder: "your_user" },
    { key: "DB_PASS", defaultValue: "password", placeholder: "your_password" },
  ],
  mariadb: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "3306", placeholder: "3306" },
    { key: "DB_NAME", defaultValue: "my_app", placeholder: "your_database" },
    { key: "DB_USER", defaultValue: "root", placeholder: "your_user" },
    { key: "DB_PASS", defaultValue: "password", placeholder: "your_password" },
  ],
  postgres: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "5432", placeholder: "5432" },
    { key: "DB_NAME", defaultValue: "my_app", placeholder: "your_database" },
    { key: "DB_USER", defaultValue: "postgres", placeholder: "your_user" },
    { key: "DB_PASS", defaultValue: "password", placeholder: "your_password" },
  ],
  cockroachdb: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "26257", placeholder: "26257" },
    { key: "DB_NAME", defaultValue: "my_app", placeholder: "your_database" },
    { key: "DB_USER", defaultValue: "root", placeholder: "your_user" },
    { key: "DB_PASS", defaultValue: "password", placeholder: "your_password" },
  ],
  sqlite3: [
    {
      key: "DB_NAME",
      defaultValue: "./data/data.db",
      placeholder: "./data/data.db",
    },
  ],
  mongodb: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "27017", placeholder: "27017" },
    { key: "DB_NAME", defaultValue: "my_app", placeholder: "your_database" },
    { key: "DB_USER", defaultValue: "", placeholder: "your_user" },
    { key: "DB_PASS", defaultValue: "", placeholder: "your_password" },
  ],
  mssql: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "1433", placeholder: "1433" },
    { key: "DB_NAME", defaultValue: "my_app", placeholder: "your_database" },
    { key: "DB_USER", defaultValue: "sa", placeholder: "your_user" },
    { key: "DB_PASS", defaultValue: "password", placeholder: "your_password" },
  ],
  oracle: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "1521", placeholder: "1521" },
    { key: "DB_NAME", defaultValue: "my_app", placeholder: "your_database" },
    { key: "DB_USER", defaultValue: "system", placeholder: "your_user" },
    { key: "DB_PASS", defaultValue: "password", placeholder: "your_password" },
  ],
  redis: [
    { key: "DB_HOST", defaultValue: "localhost", placeholder: "localhost" },
    { key: "DB_PORT", defaultValue: "6379", placeholder: "6379" },
    { key: "DB_PASS", defaultValue: "", placeholder: "your_password" },
  ],
  dynamodb: [
    { key: "AWS_REGION", defaultValue: "us-east-1", placeholder: "us-east-1" },
    {
      key: "AWS_ENDPOINT",
      defaultValue: "http://localhost:8000",
      placeholder: "http://localhost:8000",
    },
    {
      key: "AWS_ACCESS_KEY_ID",
      defaultValue: "local",
      placeholder: "your_access_key",
    },
    {
      key: "AWS_SECRET_ACCESS_KEY",
      defaultValue: "local",
      placeholder: "your_secret_key",
    },
  ],
};

const REDIS_SESSION_VARS = [
  { key: "REDIS_HOST", defaultValue: "localhost", placeholder: "localhost" },
  { key: "REDIS_PORT", defaultValue: "6379", placeholder: "6379" },
  { key: "REDIS_PASS", defaultValue: "", placeholder: "your_password" },
];

/**
 * Generate a random alphanumeric password.
 * @param {number} [length=24]
 * @returns {string}
 */
function randomPassword(length) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const len = length || 24;
  let result = "";
  const crypto = require("crypto");
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Build env file content from the config map.
 * @param {import('./types').InitAnswers} answers
 * @param {'default'|'placeholder'} mode
 * @param {object} [secrets] - generated secrets to keep in sync with docker-compose
 * @param {string} [secrets.dbPass] - database password
 * @param {string} [secrets.redisPass] - redis session password
 * @param {string} [secrets.sessionSecret] - session secret
 * @returns {string}
 */
function buildEnvContent(answers, mode, secrets) {
  const s = secrets || {};
  const pick = mode === "placeholder" ? "placeholder" : "defaultValue";
  const lines = [];
  lines.push("# Server");
  lines.push("PORT=3000");
  lines.push("");
  lines.push("# Database");

  const vars = DB_ENV_MAP[answers.database] || [];
  for (const v of vars) {
    // Override password with generated secret in default mode
    if (mode === "default" && v.key === "DB_PASS" && s.dbPass) {
      lines.push(`${v.key}=${s.dbPass}`);
    } else {
      lines.push(`${v.key}=${v[pick]}`);
    }
  }

  // Session secret
  lines.push("");
  lines.push("# Session");
  lines.push(
    `SESSION_SECRET=${mode === "placeholder" ? "your_session_secret" : s.sessionSecret || "change-me"}`,
  );

  // Redis session env vars when session is redis and database is not redis
  if (answers.session === "redis" && answers.database !== "redis") {
    lines.push("");
    lines.push("# Redis Session");
    for (const v of REDIS_SESSION_VARS) {
      if (mode === "default" && v.key === "REDIS_PASS" && s.redisPass) {
        lines.push(`${v.key}=${s.redisPass}`);
      } else {
        lines.push(`${v.key}=${v[pick]}`);
      }
    }
  }

  // Logging
  if (answers.logger) {
    lines.push("");
    lines.push("# Logging");
    lines.push(
      `APP_NAME=${mode === "placeholder" ? "your_app_name" : "my-app"}`,
    );
    lines.push(`LOG_LEVEL=${mode === "placeholder" ? "info" : "info"}`);
    // LOKI_HOST: empty by default, set a URL to enable Loki transport
    if (answers.loki && mode === "default") {
      lines.push("LOKI_HOST=http://localhost:3100");
    } else {
      lines.push(
        `LOKI_HOST=${mode === "placeholder" ? "http://your-loki-host:3100" : ""}`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate .env file content.
 * @param {import('./types').InitAnswers} answers
 * @param {object} [secrets] - generated secrets
 * @returns {string}
 */
function generateEnvFile(answers, secrets) {
  return buildEnvContent(answers, "default", secrets);
}

/**
 * Generate .env.example file content with placeholder values.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateEnvExample(answers) {
  return buildEnvContent(answers, "placeholder");
}

// ---------------------------------------------------------------------------
// App.js generator (template-literal based)
// ---------------------------------------------------------------------------

/**
 * Generate the db.connect() block for the selected database.
 * @param {string} database
 * @returns {string}
 */
function dbConnectBlock(database) {
  if (database === "dynamodb") {
    return `db.connect({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});`;
  }
  if (database === "redis") {
    return `db.connect({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 6379,
  password: process.env.DB_PASS,
});`;
  }
  if (database === "sqlite3") {
    return `db.connect({
  database: process.env.DB_NAME || "./data/data.db",
});`;
  }
  return `db.connect({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});`;
}

/**
 * Return just the connect config properties (indented, no wrapper).
 * Used by generateDbModule where the caller controls the object name.
 * @param {string} database
 * @returns {string}
 */
function dbConnectArgs(database) {
  if (database === "dynamodb") {
    return `  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
`;
  }
  if (database === "redis") {
    return `  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 6379,
  password: process.env.DB_PASS,
`;
  }
  if (database === "sqlite3") {
    return `  database: process.env.DB_NAME || "./data/data.db",
`;
  }
  return `  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
`;
}

/**
 * Generate session middleware block for app.js.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function sessionBlock(answers) {
  if (answers.session === "redis") {
    const redisConfig =
      answers.database === "redis"
        ? `  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 6379,
  password: process.env.DB_PASS,`
        : `  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASS,`;

    return `
// Session with Redis store
const redisClient = new Redis({
${redisConfig}
});
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
}));`;
  }

  const label = answers.session === "database" ? "database" : "in-memory";
  return `
// Session with ${label} store
app.use(session({
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: false,
}));`;
}

/**
 * Generate the app.js file content.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateAppJs(answers) {
  const frameworkPkg =
    answers.framework === "ultimate-express" ? "ultimate-express" : "express";

  // Imports
  let imports = `const express = require("${frameworkPkg}");
const { init, db } = require("db-model-router");
const session = require("express-session");`;

  if (answers.session === "redis") {
    imports += `\nconst RedisStore = require("connect-redis").default;
const { Redis } = require("ioredis");`;
  }
  if (answers.rateLimiting) {
    imports += `\nconst rateLimit = require("express-rate-limit");`;
  }
  if (answers.helmet) {
    imports += `\nconst helmet = require("helmet");`;
  }
  imports += `\nconst logger = require("./middleware/logger");`;

  // Rate limiting block
  const rateLimitBlock = answers.rateLimiting
    ? `app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));`
    : "";

  const helmetBlock = answers.helmet ? `app.use(helmet());` : "";

  return `${imports}

// Load environment variables
require("dotenv").config();

// Initialize database adapter
init("${answers.database}");
${dbConnectBlock(answers.database)}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
${helmetBlock ? helmetBlock + "\n" : ""}${rateLimitBlock ? rateLimitBlock + "\n" : ""}${sessionBlock(answers)}
app.use(logger);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ type: "danger", message: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

module.exports = app;
`;
}

// ---------------------------------------------------------------------------
// Logger middleware generator
// ---------------------------------------------------------------------------

/**
 * Generate middleware/logger.js content.
 * When logger is enabled, uses Winston with winston-loki transport for Grafana.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateLoggerMiddleware(answers) {
  if (answers.logger) {
    return `import winston from "winston";

/**
 * Winston logger with Console transport.
 * If LOKI_HOST is set in .env, adds a Loki transport for Grafana visualization.
 */
const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length > 1
          ? " " + JSON.stringify(meta)
          : "";
        return \`[\${timestamp}] [\${level}] \${message}\${metaStr}\`;
      }),
    ),
  }),
];

// Add Loki transport only when LOKI_HOST is configured
if (process.env.LOKI_HOST) {
  const { default: LokiTransport } = await import("winston-loki");
  transports.push(
    new LokiTransport({
      host: process.env.LOKI_HOST,
      labels: { app: process.env.APP_NAME || "app" },
      json: true,
      onConnectionError: (err) => console.error("Loki connection error:", err),
    }),
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: { service: process.env.APP_NAME || "app" },
  transports,
});

/**
 * Express middleware that logs every request/response.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? "warn" : "info";
    logger.log({
      level,
      message: \`\${req.method} \${req.originalUrl} \${res.statusCode} \${duration}ms\`,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration,
    });
  });

  next();
}

requestLogger.logger = logger;
export default requestLogger;
`;
  }

  return `/**
 * Simple request logger middleware.
 * Logs method, URL, status code, and response time.
 */
export default function logger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 400 ? "WARN" : "INFO";
    console.log(
      \`[\${new Date().toISOString()}] [\${level}] \${method} \${originalUrl} \${status} \${duration}ms\`,
    );
  });

  next();
}
`;
}

// ---------------------------------------------------------------------------
// Migration script generators (Fix 3: migrate.js now checks tracking table)
// ---------------------------------------------------------------------------

/**
 * Generate migrate.js script content.
 * Checks _migrations tracking table before running each migration.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateMigrateScript(answers) {
  const isNoSql = NOSQL_DATABASES.includes(answers.database);

  if (isNoSql) {
    return `#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const { init, db } = require("db-model-router");

init("${answers.database}");

const migrationsDir = path.join(__dirname, "migrations");

async function getExecutedMigrations() {
  try {
    const result = await db.get("_migrations");
    return new Set((result || []).map(r => r.filename));
  } catch (e) {
    return new Set();
  }
}

async function recordMigration(filename, checksum) {
  await db.insert("_migrations", {
    filename,
    executed_at: new Date().toISOString(),
    checksum,
  });
}

async function migrate() {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".js"))
    .sort();

  const executed = await getExecutedMigrations();
  let ran = 0;

  for (const file of files) {
    if (executed.has(file)) {
      console.log(\`  Skipping (already executed): \${file}\`);
      continue;
    }
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const checksum = crypto.createHash("md5").update(content).digest("hex");

    const migration = require(filePath);
    console.log(\`  Running migration: \${file}\`);
    await migration.up(db);
    await recordMigration(file, checksum);
    console.log(\`  Completed: \${file}\`);
    ran++;
  }

  if (ran === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(\`\\n\${ran} migration(s) complete.\`);
  }
  process.exit(0);
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
`;
  }

  return `#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const { init, db } = require("db-model-router");

init("${answers.database}");

const migrationsDir = path.join(__dirname, "migrations");

async function getExecutedMigrations() {
  try {
    const result = await db.query("SELECT filename FROM _migrations");
    return new Set((result || []).map(r => r.filename));
  } catch (e) {
    // Table may not exist yet (first run)
    return new Set();
  }
}

async function recordMigration(filename, checksum) {
  await db.query(
    "INSERT INTO _migrations (filename, checksum) VALUES (?, ?)",
    [filename, checksum]
  );
}

async function migrate() {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  const executed = await getExecutedMigrations();
  let ran = 0;

  for (const file of files) {
    if (executed.has(file)) {
      console.log(\`  Skipping (already executed): \${file}\`);
      continue;
    }
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const checksum = crypto.createHash("md5").update(content).digest("hex");

    console.log(\`  Running migration: \${file}\`);
    await db.query(content);
    await recordMigration(file, checksum);
    console.log(\`  Completed: \${file}\`);
    ran++;
  }

  if (ran === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(\`\\n\${ran} migration(s) complete.\`);
  }
  process.exit(0);
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
`;
}

/**
 * Generate add_migration.js script content.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateAddMigrationScript(answers) {
  const isNoSql = NOSQL_DATABASES.includes(answers.database);
  const ext = isNoSql ? "js" : "sql";
  const template = isNoSql
    ? `"use strict";\\n\\nmodule.exports = {\\n  async up(db) {\\n    // Write your migration here\\n  },\\n\\n  async down(db) {\\n    // Write your rollback here\\n  },\\n};\\n`
    : `-- Write your migration SQL here\\n`;

  return `#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const migrationsDir = path.join(__dirname, "migrations");

function migrationTimestamp() {
  const now = new Date();
  const y = String(now.getFullYear()).padStart(4, "0");
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return \`\${y}\${mo}\${d}\${h}\${mi}\${s}\`;
}

const name = process.argv[2] || "migration";
const filename = \`\${migrationTimestamp()}_\${name}.${ext}\`;
const filePath = path.join(migrationsDir, filename);

if (!fs.existsSync(migrationsDir)) {
  fs.mkdirSync(migrationsDir, { recursive: true });
}

fs.writeFileSync(filePath, "${template}");
console.log(\`Created migration: \${filename}\`);
`;
}

// ---------------------------------------------------------------------------
// Initial migration + session migration generators
// ---------------------------------------------------------------------------

/**
 * Generate the initial migration file that creates the _migrations tracking table.
 * @param {import('./types').InitAnswers} answers
 * @param {Date} [date]
 * @returns {{ filename: string, content: string }}
 */
function generateInitialMigration(answers, date) {
  const ts = migrationTimestamp(date || new Date());

  if (isSql(answers.database)) {
    let content;
    if (answers.database === "postgres" || answers.database === "cockroachdb") {
      content = `CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) NOT NULL
);
`;
    } else if (answers.database === "mssql") {
      content = `CREATE TABLE _migrations (
  id INT IDENTITY(1,1) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  executed_at DATETIME DEFAULT GETDATE(),
  checksum VARCHAR(64) NOT NULL
);
`;
    } else if (answers.database === "oracle") {
      content = `CREATE TABLE _migrations (
  id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  filename VARCHAR2(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR2(64) NOT NULL
);
`;
    } else {
      // mysql, sqlite3
      content = `CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) NOT NULL
);
`;
    }
    return { filename: `${ts}_create_migrations_table.sql`, content };
  }

  // NoSQL databases
  let content;
  if (answers.database === "mongodb") {
    content = `export async function up(db) {
  await db.createCollection("_migrations");
  await db.collection("_migrations").createIndex({ filename: 1 }, { unique: true });
}

export async function down(db) {
  await db.collection("_migrations").drop();
}
`;
  } else if (answers.database === "redis") {
    content = `export async function up(db) {
  // _migrations hash key will be created on first HSET
  console.log("Redis migration tracking initialized using hash key: _migrations");
}

export async function down(db) {
  await db.del("_migrations");
}
`;
  } else {
    // dynamodb
    content = `import { CreateTableCommand, DeleteTableCommand } from "@aws-sdk/client-dynamodb";

export async function up(db) {
  await db.send(new CreateTableCommand({
    TableName: "_migrations",
    KeySchema: [{ AttributeName: "filename", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "filename", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  }));
}

export async function down(db) {
  await db.send(new DeleteTableCommand({ TableName: "_migrations" }));
}
`;
  }

  return { filename: `${ts}_create_migrations_table.js`, content };
}

/**
 * Generate the session migration file for SQL databases with database session store.
 * @param {import('./types').InitAnswers} answers
 * @param {Date} [date]
 * @returns {{ filename: string, content: string } | null}
 */
function generateSessionMigration(answers, date) {
  if (answers.session !== "database" || !isSql(answers.database)) {
    return null;
  }

  const ts = migrationTimestamp(date || new Date());

  let content;
  if (answers.database === "postgres" || answers.database === "cockroachdb") {
    content = `CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess TEXT NOT NULL,
  expired_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired_at);
`;
  } else if (answers.database === "mssql") {
    content = `CREATE TABLE sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess TEXT NOT NULL,
  expired_at DATETIME NOT NULL
);
CREATE INDEX idx_sessions_expired ON sessions(expired_at);
`;
  } else if (answers.database === "oracle") {
    content = `CREATE TABLE sessions (
  sid VARCHAR2(255) PRIMARY KEY,
  sess CLOB NOT NULL,
  expired_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_sessions_expired ON sessions(expired_at);
`;
  } else {
    // mysql, sqlite3
    content = `CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess TEXT NOT NULL,
  expired_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_sessions_expired ON sessions(expired_at);
`;
  }

  return { filename: `${ts}_create_sessions_table.sql`, content };
}

// ---------------------------------------------------------------------------
// Docker Compose generator
// ---------------------------------------------------------------------------

/**
 * Docker image and config for each supported database.
 */
const DOCKER_DB_MAP = {
  mysql: {
    image: "mysql:latest",
    port: "3306:3306",
    env: (secrets) => ({
      MYSQL_ROOT_PASSWORD: secrets.dbPass,
      MYSQL_DATABASE: "my_app",
    }),
    volumes: ["./data/mysql:/var/lib/mysql"],
  },
  mariadb: {
    image: "mariadb:latest",
    port: "3306:3306",
    env: (secrets) => ({
      MARIADB_ROOT_PASSWORD: secrets.dbPass,
      MARIADB_DATABASE: "my_app",
    }),
    volumes: ["./data/mariadb:/var/lib/mysql"],
  },
  postgres: {
    image: "postgres:alpine",
    port: "5432:5432",
    env: (secrets) => ({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: secrets.dbPass,
      POSTGRES_DB: "my_app",
    }),
    volumes: ["./data/postgres:/var/lib/postgresql/data"],
  },
  cockroachdb: {
    image: "cockroachdb/cockroach:latest",
    port: "26257:26257",
    command: "start-single-node --insecure",
    env: () => ({}),
    volumes: ["./data/cockroachdb:/cockroach/cockroach-data"],
  },
  mongodb: {
    image: "mongo:latest",
    port: "27017:27017",
    env: (secrets) => ({
      MONGO_INITDB_ROOT_USERNAME: "root",
      MONGO_INITDB_ROOT_PASSWORD: secrets.dbPass,
      MONGO_INITDB_DATABASE: "my_app",
    }),
    volumes: ["./data/mongodb:/data/db"],
  },
  mssql: {
    image: "mcr.microsoft.com/mssql/server:latest",
    port: "1433:1433",
    env: (secrets) => ({
      ACCEPT_EULA: "Y",
      MSSQL_SA_PASSWORD: secrets.dbPass,
    }),
    volumes: ["./data/mssql:/var/opt/mssql"],
  },
  oracle: {
    image: "gvenzl/oracle-xe:latest",
    port: "1521:1521",
    env: (secrets) => ({
      ORACLE_PASSWORD: secrets.dbPass,
      APP_USER: "system",
      APP_USER_PASSWORD: secrets.dbPass,
    }),
    volumes: ["./data/oracle:/opt/oracle/oradata"],
  },
  redis: {
    image: "redis:alpine",
    port: "6379:6379",
    command: null, // set dynamically if password
    env: () => ({}),
    volumes: ["./data/redis:/data"],
  },
  dynamodb: {
    image: "amazon/dynamodb-local:latest",
    port: "8000:8000",
    env: () => ({}),
    volumes: [],
  },
};

/**
 * CloudBeaver JDBC driver IDs and URL templates per database.
 */
const CLOUDBEAVER_DB_MAP = {
  mysql: {
    provider: "mysql",
    driver: "mysql8",
    urlTemplate: (host, port, dbName) =>
      `jdbc:mysql://${host}:${port}/${dbName}`,
  },
  mariadb: {
    provider: "mysql",
    driver: "mariaDB",
    urlTemplate: (host, port, dbName) =>
      `jdbc:mariadb://${host}:${port}/${dbName}`,
  },
  postgres: {
    provider: "postgresql",
    driver: "postgres-jdbc",
    urlTemplate: (host, port, dbName) =>
      `jdbc:postgresql://${host}:${port}/${dbName}`,
  },
  cockroachdb: {
    provider: "postgresql",
    driver: "postgres-jdbc",
    urlTemplate: (host, port, dbName) =>
      `jdbc:postgresql://${host}:${port}/${dbName}`,
  },
  mssql: {
    provider: "sqlserver",
    driver: "mssql_jdbc_ms_new",
    urlTemplate: (host, port, dbName) =>
      `jdbc:sqlserver://${host}:${port};databaseName=${dbName};trustServerCertificate=true`,
  },
  oracle: {
    provider: "oracle",
    driver: "oracle_thin",
    urlTemplate: (host, port, dbName) =>
      `jdbc:oracle:thin:@${host}:${port}/${dbName}`,
  },
  mongodb: {
    provider: "mongodb",
    driver: "mongodb",
    urlTemplate: (host, port, dbName) => `mongodb://${host}:${port}/${dbName}`,
  },
};

/**
 * Generate CloudBeaver data-sources.json for auto-connecting to the project database.
 * @param {import('./types').InitAnswers} answers
 * @param {object} secrets
 * @returns {string|null}
 */
function generateCloudBeaverDataSources(answers, secrets) {
  const cbDb = CLOUDBEAVER_DB_MAP[answers.database];
  if (!cbDb) return null;

  const dbConfig = DOCKER_DB_MAP[answers.database];
  if (!dbConfig) return null;

  const host = answers.database; // service name in docker-compose
  const port = dbConfig.port.split(":")[1];
  const dbName = "my_app";

  // Determine user/pass based on adapter
  let user = "root";
  let pass = secrets.dbPass;
  if (answers.database === "postgres" || answers.database === "cockroachdb")
    user = "postgres";
  if (answers.database === "mssql") user = "sa";
  if (answers.database === "oracle") user = "system";
  if (answers.database === "mongodb") user = "root";

  const connId = `${answers.database}-project-db`;
  const url = cbDb.urlTemplate(host, port, dbName);

  const config = {
    folders: {},
    connections: {
      [connId]: {
        provider: cbDb.provider,
        driver: cbDb.driver,
        name: `${answers.database} - my_app`,
        "save-password": true,
        configuration: {
          host: host,
          port: port,
          database: dbName,
          url: url,
          configurationType: "MANUAL",
          type: "dev",
          auth: "native",
          userName: user,
          userPassword: pass,
        },
      },
    },
  };

  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Generate docker-compose.yml content.
 * @param {import('./types').InitAnswers} answers
 * @param {object} secrets - { dbPass, redisPass }
 * @returns {string|null} null if no Docker service needed (e.g. sqlite3)
 */
function generateDockerCompose(answers, secrets) {
  // sqlite3 runs in-process, no Docker needed
  if (answers.database === "sqlite3") return null;

  const dbConfig = DOCKER_DB_MAP[answers.database];
  if (!dbConfig) return null;

  const services = {};

  // --- Primary database service ---
  const dbService = {
    container_name: `${answers.database}_db`,
    image: dbConfig.image,
    ports: [dbConfig.port],
    restart: "unless-stopped",
  };

  const envVars = dbConfig.env(secrets);
  if (Object.keys(envVars).length > 0) {
    dbService.environment = envVars;
  }
  if (dbConfig.command) {
    dbService.command = dbConfig.command;
  }
  // Redis with password
  if (answers.database === "redis" && secrets.dbPass) {
    dbService.command = `redis-server --requirepass ${secrets.dbPass}`;
  }
  if (dbConfig.volumes && dbConfig.volumes.length > 0) {
    dbService.volumes = dbConfig.volumes;
  }

  services[answers.database] = dbService;

  // --- Redis session service (if session=redis and db is not already redis) ---
  if (answers.session === "redis" && answers.database !== "redis") {
    const redisService = {
      container_name: "redis_session",
      image: "redis:alpine",
      ports: ["6379:6379"],
      restart: "unless-stopped",
    };
    if (secrets.redisPass) {
      redisService.command = `redis-server --requirepass ${secrets.redisPass}`;
    }
    redisService.volumes = ["./data/redis:/data"];
    services["redis"] = redisService;
  }

  // --- CloudBeaver service (for SQL/MongoDB databases) ---
  const hasCbSupport = !!CLOUDBEAVER_DB_MAP[answers.database];
  if (hasCbSupport) {
    services["cloudbeaver"] = {
      container_name: "cloudbeaver",
      image: "dbeaver/cloudbeaver:latest",
      ports: ["8978:8978"],
      restart: "unless-stopped",
      environment: {
        CB_SERVER_NAME: "CloudBeaver",
        CB_ADMIN_NAME: "cbadmin",
        CB_ADMIN_PASSWORD: secrets.dbPass,
      },
      volumes: [
        "./data/cloudbeaver:/opt/cloudbeaver/workspace",
        "./.cloudbeaver/data-sources.json:/opt/cloudbeaver/workspace/GlobalConfiguration/.dbeaver/data-sources.json:ro",
      ],
      depends_on: [answers.database],
    };
  }

  // --- Loki + Grafana (when logger + loki are enabled) ---
  if (answers.loki) {
    services["loki"] = {
      container_name: "loki",
      image: "grafana/loki:latest",
      ports: ["3100:3100"],
      restart: "unless-stopped",
      command: "-config.file=/etc/loki/local-config.yaml",
      volumes: ["./data/loki:/loki"],
    };

    services["grafana"] = {
      container_name: "grafana",
      image: "grafana/grafana:latest",
      ports: ["3001:3000"],
      restart: "unless-stopped",
      environment: {
        GF_SECURITY_ADMIN_USER: "admin",
        GF_SECURITY_ADMIN_PASSWORD: secrets.dbPass,
        GF_AUTH_ANONYMOUS_ENABLED: "true",
      },
      volumes: [
        "./data/grafana:/var/lib/grafana",
        "./.grafana/datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro",
      ],
      depends_on: ["loki"],
    };
  }

  // --- Build YAML manually (no dependency needed) ---
  const lines = [];
  lines.push("services:");

  for (const [name, svc] of Object.entries(services)) {
    lines.push(`  ${name}:`);
    lines.push(`    container_name: ${svc.container_name}`);
    lines.push(`    image: ${svc.image}`);
    if (svc.command) {
      lines.push(`    command: ${svc.command}`);
    }
    if (svc.ports && svc.ports.length > 0) {
      lines.push("    ports:");
      for (const p of svc.ports) {
        lines.push(`      - "${p}"`);
      }
    }
    if (svc.environment && Object.keys(svc.environment).length > 0) {
      lines.push("    environment:");
      for (const [k, v] of Object.entries(svc.environment)) {
        lines.push(`      ${k}: "${v}"`);
      }
    }
    if (svc.volumes && svc.volumes.length > 0) {
      lines.push("    volumes:");
      for (const v of svc.volumes) {
        lines.push(`      - ${v}`);
      }
    }
    if (svc.depends_on && svc.depends_on.length > 0) {
      lines.push("    depends_on:");
      for (const d of svc.depends_on) {
        lines.push(`      - ${d}`);
      }
    }
    lines.push(`    restart: unless-stopped`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate Dockerfile for the project.
 * Uses multi-stage build with node:alpine for a lean production image.
 * @param {import('./types').InitAnswers} answers
 * @param {string} [outputDir] - relative output directory for source files
 * @returns {string}
 */
function generateDockerfile(answers, outputDir) {
  const copyDirs = ["commons", "middleware", "route", "migrations"]
    .map((d) => {
      const src = outputDir ? `${outputDir}/${d}` : d;
      return `COPY ${src}/ ./${src}/`;
    })
    .join("\n");

  return `FROM node:alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY app.js ./
${copyDirs}

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "app.js"]
`;
}

/**
 * Generate Grafana datasource provisioning file for auto-connecting Loki.
 * @returns {string}
 */
function generateGrafanaDatasources() {
  return `apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    editable: false
`;
}

/**
 * Generate .dockerignore content.
 * @returns {string}
 */
function generateDockerignore() {
  return `node_modules
npm-debug.log
.env
.env.example
.git
.gitignore
data
`;
}

/**
 * Generate .gitignore content.
 * @returns {string}
 */
function generateGitignore() {
  return `node_modules/
.env
*.db
data/
.cloudbeaver/
`;
}

// ---------------------------------------------------------------------------
// Commons: session.js generator
// ---------------------------------------------------------------------------

/**
 * Generate commons/session.js — session configuration module.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateSessionJs(answers) {
  let imports = `import session from "express-session";\n`;

  if (answers.session === "redis") {
    imports += `import { RedisStore } from "connect-redis";\nimport ioredis from "ioredis";\n\nconst { Redis } = ioredis;\n`;
  }

  let storeSetup = "";
  let storeOption = "";

  if (answers.session === "redis") {
    const redisConfig =
      answers.database === "redis"
        ? `  host: process.env.DB_HOST || "localhost",\n  port: process.env.DB_PORT || 6379,\n  password: process.env.DB_PASS,`
        : `  host: process.env.REDIS_HOST || "localhost",\n  port: process.env.REDIS_PORT || 6379,\n  password: process.env.REDIS_PASS,`;

    storeSetup = `\nconst redisClient = new Redis({\n${redisConfig}\n});\n`;
    storeOption = `\n    store: new RedisStore({ client: redisClient }),`;
  }

  return `${imports}${storeSetup}
/**
 * Configure and return session middleware.
 * Session store: ${answers.session}
 */
export default function configureSession() {
  return session({${storeOption}
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
  });
}
`;
}

// ---------------------------------------------------------------------------
// Commons: migrate.js generator (standalone script)
// ---------------------------------------------------------------------------

/**
 * Generate commons/migrate.js — migration runner module.
 * Works as both an importable module and a standalone script.
 * @param {import('./types').InitAnswers} answers
 * @param {string} [outputDir] - relative output directory
 * @returns {string}
 */
function generateMigrateModule(answers, outputDir) {
  const isNoSql = NOSQL_DATABASES.includes(answers.database);
  // commons/migrate.js and migrations/ are sibling dirs inside the same outputDir
  const migrationsRel = "../migrations";

  if (isNoSql) {
    return `#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run all pending migrations from the migrations directory.
 * @param {object} db - db-model-router db instance
 * @param {string} migrationsDir - absolute path to migrations folder
 */
export default async function runMigrations(db, migrationsDir) {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".js"))
    .sort();

  let executed;
  try {
    const result = await db.get("_migrations");
    executed = new Set((result || []).map(r => r.filename));
  } catch (e) {
    executed = new Set();
  }

  let ran = 0;
  for (const file of files) {
    if (executed.has(file)) {
      console.log(\`  Skipping (already executed): \${file}\`);
      continue;
    }
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const checksum = crypto.createHash("md5").update(content).digest("hex");

    const migration = await import(filePath);
    console.log(\`  Running migration: \${file}\`);
    await migration.up(db);
    await db.insert("_migrations", {
      filename: file,
      executed_at: new Date().toISOString(),
      checksum,
    });
    console.log(\`  Completed: \${file}\`);
    ran++;
  }

  if (ran === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(\`\\n\${ran} migration(s) complete.\`);
  }
}

// Run as standalone script
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  await import("dotenv/config");
  const pkg = await import("db-model-router");
  const mod = pkg.default || pkg;
  mod.init("${answers.database}");
  const migrationsDir = path.join(__dirname, "${migrationsRel}");
  runMigrations(mod.db, migrationsDir)
    .then(() => process.exit(0))
    .catch(err => { console.error("Migration failed:", err); process.exit(1); });
}
`;
  }

  return `#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run all pending SQL migrations from the migrations directory.
 * @param {object} db - db-model-router db instance
 * @param {string} migrationsDir - absolute path to migrations folder
 */
export default async function runMigrations(db, migrationsDir) {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  let executed;
  try {
    const result = await db.query("SELECT filename FROM _migrations");
    executed = new Set((result || []).map(r => r.filename));
  } catch (e) {
    executed = new Set();
  }

  let ran = 0;
  for (const file of files) {
    if (executed.has(file)) {
      console.log(\`  Skipping (already executed): \${file}\`);
      continue;
    }
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const checksum = crypto.createHash("md5").update(content).digest("hex");

    console.log(\`  Running migration: \${file}\`);
    await db.query(content);
    await db.query(
      "INSERT INTO _migrations (filename, checksum) VALUES (?, ?)",
      [file, checksum]
    );
    console.log(\`  Completed: \${file}\`);
    ran++;
  }

  if (ran === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(\`\\n\${ran} migration(s) complete.\`);
  }
}

// Run as standalone script
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  await import("dotenv/config");
  const pkg = await import("db-model-router");
  const mod = pkg.default || pkg;
  mod.init("${answers.database}");
  const migrationsDir = path.join(__dirname, "${migrationsRel}");
  runMigrations(mod.db, migrationsDir)
    .then(() => process.exit(0))
    .catch(err => { console.error("Migration failed:", err); process.exit(1); });
}
`;
}

// ---------------------------------------------------------------------------
// Commons: add_migration.js generator (standalone script)
// ---------------------------------------------------------------------------

/**
 * Generate commons/add_migration.js — migration creation helper module.
 * Works as both an importable module and a standalone script.
 * @param {import('./types').InitAnswers} answers
 * @param {string} [outputDir] - relative output directory
 * @returns {string}
 */
function generateAddMigrationModule(answers, outputDir) {
  const isNoSql = NOSQL_DATABASES.includes(answers.database);
  const ext = isNoSql ? "js" : "sql";
  const template = isNoSql
    ? `export async function up(db) {\\n  // Write your migration here\\n}\\n\\nexport async function down(db) {\\n  // Write your rollback here\\n}\\n`
    : `-- Write your migration SQL here\\n`;
  const migrationsRel = "../migrations";

  return `#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create a new timestamped migration file.
 * @param {string} migrationsDir - absolute path to migrations folder
 * @param {string} [name] - migration name (default: "migration")
 * @returns {string} the created filename
 */
export default function addMigration(migrationsDir, name) {
  const migrationName = name || "migration";
  const now = new Date();
  const y = String(now.getFullYear()).padStart(4, "0");
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ts = \`\${y}\${mo}\${d}\${h}\${mi}\${s}\`;

  const filename = \`\${ts}_\${migrationName}.${ext}\`;
  const filePath = path.join(migrationsDir, filename);

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  fs.writeFileSync(filePath, "${template}");
  console.log(\`Created migration: \${filename}\`);
  return filename;
}

// Run as standalone script
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const migrationsDir = path.join(__dirname, "${migrationsRel}");
  const name = process.argv[2] || "migration";
  addMigration(migrationsDir, name);
}
`;
}

// ---------------------------------------------------------------------------
// Commons: security.js generator (helmet + header overrides)
// ---------------------------------------------------------------------------

/**
 * Generate commons/security.js — helmet and custom header security middleware.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateSecurityJs(answers) {
  let imports = "";
  if (answers.helmet) {
    imports += `import helmet from "helmet";\n`;
  }
  if (answers.rateLimiting) {
    imports += `import rateLimit from "express-rate-limit";\n`;
  }

  return `${imports}
/**
 * Apply security middleware to the Express app.
 * Includes: ${answers.helmet ? "Helmet, " : ""}${answers.rateLimiting ? "rate limiting, " : ""}custom security headers.
 * @param {import("express").Application} app
 */
export default function applySecurity(app) {
${answers.helmet ? `  // Helmet — sets various HTTP headers for security\n  app.use(helmet());\n` : "  // Helmet is not enabled. Install and enable via --helmet flag.\n"}
${answers.rateLimiting ? `  // Rate limiting\n  app.use(rateLimit({\n    windowMs: 15 * 60 * 1000,\n    max: 100,\n    standardHeaders: true,\n    legacyHeaders: false,\n  }));\n` : ""}
  // Custom security headers (override or extend as needed)
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");
    next();
  });
}
`;
}

// ---------------------------------------------------------------------------
// Route: health.js generator
// ---------------------------------------------------------------------------

/**
 * Generate route/health.js — health check route.
 * @returns {string}
 */
function generateHealthRoute() {
  return `import express from "express";

const router = express.Router();

/**
 * GET /health
 * Returns server health status, uptime, memory, and database connectivity.
 */
router.get("/", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    db: { connected: false },
  };

  try {
    if (global.db && typeof global.db.query === "function") {
      await global.db.query("SELECT NOW()");
      health.db.connected = true;
    } else if (global.db && typeof global.db.get === "function") {
      // NoSQL adapters (mongodb, redis, dynamodb)
      health.db.connected = true;
    }
  } catch (err) {
    health.status = "degraded";
    health.db.error = err.message;
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
`;
}

// ---------------------------------------------------------------------------
// Route: index.js generator — mounts all route modules
// ---------------------------------------------------------------------------

/**
 * Generate route/index.js — central route mounting file.
 * @returns {string}
 */
function generateRouteIndexFile() {
  return `import express from "express";
import healthRoute from "./health.js";

const router = express.Router();

router.use("/health", healthRoute);

export default router;
`;
}

// ---------------------------------------------------------------------------
// Commons: db.js generator — database init, connect, and global.db
// ---------------------------------------------------------------------------

/**
 * Generate commons/db.js — database initialization and connection module.
 * Sets global.db so the db instance is accessible across the application.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateDbModule(answers) {
  return `import "dotenv/config";
import dbModelRouter from "db-model-router";

// Initialize database adapter
dbModelRouter.init("${answers.database}");

// Connect to database
dbModelRouter.db.connect({
${dbConnectArgs(answers.database)}});

// Make db available globally across the application
const db = dbModelRouter.db;
global.db = db;

export { db };
export default db;
`;
}

// ---------------------------------------------------------------------------
// Updated app.js generator — links commons and route/index
// ---------------------------------------------------------------------------

/**
 * Generate the app.js file content (v2 — uses commons modules and route/index).
 * @param {import('./types').InitAnswers} answers
 * @param {string} [outputDir] - relative output directory for source files (e.g. "backend")
 * @returns {string}
 */
function generateAppJsV2(answers, outputDir) {
  const frameworkPkg =
    answers.framework === "ultimate-express" ? "ultimate-express" : "express";

  const commonsPrefix = outputDir ? `./${outputDir}/commons` : "./commons";
  const routePrefix = outputDir ? `./${outputDir}/route` : "./route";
  const middlewarePrefix = outputDir
    ? `./${outputDir}/middleware`
    : "./middleware";

  return `import express from "${frameworkPkg}";
import "${commonsPrefix}/db.js";
import configureSession from "${commonsPrefix}/session.js";
import applySecurity from "${commonsPrefix}/security.js";
import logger from "${middlewarePrefix}/logger.js";
import route from "${routePrefix}/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security (helmet, rate limiting, custom headers)
applySecurity(app);

// Session
app.use(configureSession());

// Logger
app.use(logger);

// Routes
app.use(route);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ type: "danger", message: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

export default app;
`;
}

module.exports = {
  migrationTimestamp,
  isSql,
  randomPassword,
  generateAppJs,
  generateAppJsV2,
  generateEnvFile,
  generateEnvExample,
  generateLoggerMiddleware,
  generateMigrateScript,
  generateAddMigrationScript,
  generateInitialMigration,
  generateSessionMigration,
  generateGitignore,
  generateDockerfile,
  generateDockerignore,
  generateGrafanaDatasources,
  generateDockerCompose,
  generateCloudBeaverDataSources,
  generateSessionJs,
  generateMigrateModule,
  generateAddMigrationModule,
  generateSecurityJs,
  generateHealthRoute,
  generateRouteIndexFile,
  generateDbModule,
  SQL_DATABASES,
  NOSQL_DATABASES,
};
