#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const DB_TYPE_MAP = {
  mysql: "mysql",
  postgres: "postgres",
  postgresql: "postgres",
  sqlite3: "sqlite3",
  mssql: "mssql",
  oracle: "oracle",
  cockroachdb: "cockroachdb",
};

const SUPPORTED_TYPES = Object.keys(DB_TYPE_MAP);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateAppJs(dbType) {
  return `let express;
try { express = require("ultimate-express"); } catch (_) { express = require("express"); }
const { init, db } = require("db-model-router");
const logger = require("./middleware/logger");
const routes = require("./routes");

// Load environment variables
require("dotenv").config();

// Initialize database adapter
init("${dbType}");
db.connect({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger);

// Routes
app.use("/api", routes);

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

function generateLoggerMiddleware() {
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

function generateEnvExample(dbType) {
  const lines = [
    "# Server",
    "PORT=3000",
    "",
    "# Database",
    `DB_TYPE=${dbType}`,
  ];
  switch (dbType) {
    case "mysql":
      lines.push(
        "DB_HOST=localhost",
        "DB_PORT=3306",
        "DB_NAME=my_app",
        "DB_USER=root",
        "DB_PASS=password",
      );
      break;
    case "postgres":
    case "cockroachdb":
      lines.push(
        "DB_HOST=localhost",
        `DB_PORT=${dbType === "cockroachdb" ? 26257 : 5432}`,
        "DB_NAME=my_app",
        "DB_USER=postgres",
        "DB_PASS=password",
      );
      break;
    case "sqlite3":
      lines.push("DB_NAME=./data.db");
      break;
    case "mssql":
      lines.push(
        "DB_HOST=localhost",
        "DB_PORT=1433",
        "DB_NAME=my_app",
        "DB_USER=sa",
        "DB_PASS=password",
      );
      break;
    case "oracle":
      lines.push(
        "DB_HOST=localhost",
        "DB_PORT=1521",
        "DB_NAME=my_app",
        "DB_USER=system",
        "DB_PASS=password",
      );
      break;
    case "mongodb":
      lines.push(
        "DB_HOST=localhost",
        "DB_PORT=27017",
        "DB_NAME=my_app",
        "DB_USER=",
        "DB_PASS=",
      );
      break;
    case "redis":
      lines.push("DB_HOST=localhost", "DB_PORT=6379", "DB_PASS=");
      break;
    case "dynamodb":
      lines.push(
        "AWS_REGION=us-east-1",
        "AWS_ENDPOINT=http://localhost:8000",
        "AWS_ACCESS_KEY_ID=local",
        "AWS_SECRET_ACCESS_KEY=local",
      );
      break;
    default:
      lines.push(
        "DB_HOST=localhost",
        "DB_PORT=3306",
        "DB_NAME=my_app",
        "DB_USER=root",
        "DB_PASS=password",
      );
  }
  return lines.join("\n") + "\n";
}

function generateGitignore() {
  return `node_modules/
.env
*.db
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const dbType = DB_TYPE_MAP[(args.type || "").toLowerCase()];
  if (!dbType) {
    console.error(
      `Error: --type is required. Supported: ${SUPPORTED_TYPES.join(", ")}`,
    );
    process.exit(1);
  }

  const outputDir = path.resolve(args.output || ".");
  const modelsDir = path.join(outputDir, "models");
  const routesDir = path.join(outputDir, "routes");
  const middlewareDir = path.join(outputDir, "middleware");
  const migrationsDir = path.join(outputDir, "migrations");
  const sessionsDir = path.join(outputDir, "sessions");

  console.log(`Scaffolding app in ${outputDir}...\n`);

  // Create directories
  for (const dir of [outputDir, middlewareDir, migrationsDir, sessionsDir]) {
    ensureDir(dir);
  }

  // Generate models via generate-model CLI
  const generateModelArgs = ["--type", dbType, "--output", modelsDir];
  if (args.host) generateModelArgs.push("--host", args.host);
  if (args.port) generateModelArgs.push("--port", args.port);
  if (args.database) generateModelArgs.push("--database", args.database);
  if (args.user) generateModelArgs.push("--user", args.user);
  if (args.password) generateModelArgs.push("--password", args.password);
  if (args.schema) generateModelArgs.push("--schema", args.schema);
  if (args.env) generateModelArgs.push("--env", args.env);
  if (args.tables) generateModelArgs.push("--tables", args.tables);

  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, "generate-model.js"), ...generateModelArgs],
      { stdio: "inherit" },
    );
  } catch (err) {
    console.error("Model generation failed.");
    process.exit(1);
  }

  // Generate routes via generate-route CLI
  const generateRouteArgs = ["--models", modelsDir, "--output", routesDir];
  if (args.tables) generateRouteArgs.push("--tables", args.tables);

  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, "generate-route.js"), ...generateRouteArgs],
      { stdio: "inherit" },
    );
  } catch (err) {
    console.error("Route generation failed.");
    process.exit(1);
  }

  // Write app.js
  const appPath = path.join(outputDir, "app.js");
  if (!fs.existsSync(appPath)) {
    fs.writeFileSync(appPath, generateAppJs(dbType));
    console.log(`  Created ${appPath}`);
  } else {
    console.log(`  Skipped ${appPath} (already exists)`);
  }

  // Write middleware/logger.js
  const loggerPath = path.join(middlewareDir, "logger.js");
  if (!fs.existsSync(loggerPath)) {
    fs.writeFileSync(loggerPath, generateLoggerMiddleware());
    console.log(`  Created ${loggerPath}`);
  }

  // Write .env.example
  const envPath = path.join(outputDir, ".env.example");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, generateEnvExample(dbType));
    console.log(`  Created ${envPath}`);
  }

  // Write .gitignore
  const gitignorePath = path.join(outputDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, generateGitignore());
    console.log(`  Created ${gitignorePath}`);
  }

  // Write placeholder files
  const migrationReadme = path.join(migrationsDir, "README.md");
  if (!fs.existsSync(migrationReadme)) {
    fs.writeFileSync(
      migrationReadme,
      "# Migrations\n\nPlace your database migration scripts here.\n",
    );
  }
  const sessionReadme = path.join(sessionsDir, "README.md");
  if (!fs.existsSync(sessionReadme)) {
    fs.writeFileSync(
      sessionReadme,
      "# Sessions\n\nSession configuration and store setup.\n",
    );
  }

  console.log("\nApp scaffolded. To start:");
  console.log(`  cp .env.example .env`);
  console.log(`  npm install`);
  console.log(`  node app.js`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Usage: rest-router-generate-app --type <db_type> [options]

Scaffolds a complete Express REST API app from an existing database.
Creates: app.js, models/, routes/, middleware/logger.js, migrations/, sessions/, .env.example

Options:
  --type        Database type (${SUPPORTED_TYPES.join(", ")}) [required]
  --output      Output directory (default: current directory)
  --host        Database host
  --port        Database port
  --database    Database name or file path
  --user        Database user
  --password    Database password
  --schema      Schema name (postgres only)
  --tables      Comma-separated tables (supports parent.child notation)
  --env         Path to .env file for DB connection
  --help        Show this help message

Examples:
  rest-router-generate-app --type mysql --env .env
  rest-router-generate-app --type sqlite3 --database ./myapp.db --output ./my-api
  rest-router-generate-app --type postgres --env .env --tables users,posts,posts.comments
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  generateAppJs,
  generateLoggerMiddleware,
  generateEnvExample,
};
