"use strict";

const SQL_DATABASES = [
  "mysql",
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
    { key: "DB_NAME", defaultValue: "./data.db", placeholder: "./data.db" },
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
 * Build env file content from the config map.
 * @param {import('./types').InitAnswers} answers
 * @param {'default'|'placeholder'} mode
 * @returns {string}
 */
function buildEnvContent(answers, mode) {
  const pick = mode === "placeholder" ? "placeholder" : "defaultValue";
  const lines = [];
  lines.push("# Server");
  lines.push("PORT=3000");
  lines.push("");
  lines.push("# Database");

  const vars = DB_ENV_MAP[answers.database] || [];
  for (const v of vars) {
    lines.push(`${v.key}=${v[pick]}`);
  }

  // Session secret
  lines.push("");
  lines.push("# Session");
  lines.push(
    `SESSION_SECRET=${mode === "placeholder" ? "your_session_secret" : "change-me"}`,
  );

  // Redis session env vars when session is redis and database is not redis
  if (answers.session === "redis" && answers.database !== "redis") {
    lines.push("");
    lines.push("# Redis Session");
    for (const v of REDIS_SESSION_VARS) {
      lines.push(`${v.key}=${v[pick]}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate .env file content.
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateEnvFile(answers) {
  return buildEnvContent(answers, "default");
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
  database: process.env.DB_NAME || "./data.db",
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
 * @param {import('./types').InitAnswers} answers
 * @returns {string}
 */
function generateLoggerMiddleware(answers) {
  if (answers.logger) {
    return `const mung = require("express-mung");

/**
 * Request/response logger middleware using express-mung.
 * Logs request details, response body, and response time.
 */
const logger = mung.json(function transform(body, req, res) {
  const duration = Date.now() - req._startTime;
  const status = res.statusCode;
  const level = status >= 400 ? "WARN" : "INFO";
  console.log(
    \`[\${new Date().toISOString()}] [\${level}] \${req.method} \${req.originalUrl} \${status} \${duration}ms\`,
  );
  console.log("  Request headers:", JSON.stringify(req.headers));
  console.log("  Response body:", JSON.stringify(body));
  return body;
});

function startTimer(req, res, next) {
  req._startTime = Date.now();
  next();
}

module.exports = [startTimer, logger];
`;
  }

  return `/**
 * Simple request logger middleware.
 * Logs method, URL, status code, and response time.
 */
module.exports = function logger(req, res, next) {
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
};
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
    content = `"use strict";

module.exports = {
  async up(db) {
    await db.createCollection("_migrations");
    await db.collection("_migrations").createIndex({ filename: 1 }, { unique: true });
  },

  async down(db) {
    await db.collection("_migrations").drop();
  },
};
`;
  } else if (answers.database === "redis") {
    content = `"use strict";

module.exports = {
  async up(db) {
    // _migrations hash key will be created on first HSET
    console.log("Redis migration tracking initialized using hash key: _migrations");
  },

  async down(db) {
    await db.del("_migrations");
  },
};
`;
  } else {
    // dynamodb
    content = `"use strict";

module.exports = {
  async up(db) {
    const { CreateTableCommand } = require("@aws-sdk/client-dynamodb");
    await db.send(new CreateTableCommand({
      TableName: "_migrations",
      KeySchema: [{ AttributeName: "filename", KeyType: "HASH" }],
      AttributeDefinitions: [{ AttributeName: "filename", AttributeType: "S" }],
      BillingMode: "PAY_PER_REQUEST",
    }));
  },

  async down(db) {
    const { DeleteTableCommand } = require("@aws-sdk/client-dynamodb");
    await db.send(new DeleteTableCommand({ TableName: "_migrations" }));
  },
};
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

/**
 * Generate .gitignore content.
 * @returns {string}
 */
function generateGitignore() {
  return `node_modules/
.env
*.db
`;
}

module.exports = {
  migrationTimestamp,
  isSql,
  generateAppJs,
  generateEnvFile,
  generateEnvExample,
  generateLoggerMiddleware,
  generateMigrateScript,
  generateAddMigrationScript,
  generateInitialMigration,
  generateSessionMigration,
  generateGitignore,
  SQL_DATABASES,
  NOSQL_DATABASES,
};
