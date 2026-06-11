#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEMO = path.join(ROOT, "demo");

const ADAPTER = process.argv[2] || "sqlite3";
const SUPPORTED_ADAPTERS = ["sqlite3", "postgres", "mysql", "mariadb"];

if (!SUPPORTED_ADAPTERS.includes(ADAPTER)) {
  console.error(`Error: Unsupported adapter "${ADAPTER}".`);
  console.error(`Supported: ${SUPPORTED_ADAPTERS.join(", ")}`);
  process.exit(1);
}

// 1. Clear demo folder
if (fs.existsSync(DEMO)) {
  fs.rmSync(DEMO, { recursive: true, force: true });
}
fs.mkdirSync(DEMO, { recursive: true });

const run = (cmd, cwd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

if (ADAPTER === "postgres") {
  // --- Postgres demo flow ---
  const schemaPath = path.join(ROOT, "dbmr.postgres.test.schema.json");

  // 2. Copy Postgres schema into the demo folder
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const schemaDest = path.join(DEMO, "dbmr.schema.json");
  fs.writeFileSync(schemaDest, JSON.stringify(schema, null, 2) + "\n");
  console.log(`\n> Copied ${schemaPath} → ${schemaDest}`);

  // 3. Scaffold project with postgres
  run(
    "node ../src/cli/main.js init --database postgres --yes --no-install",
    DEMO,
  );

  // 4. Generate from schema (already copied)
  run("node ../src/cli/main.js generate --from dbmr.schema.json", DEMO);

  // 5. Install dependencies
  run("npm install", DEMO);

  console.log("\n✔ Postgres demo project ready in ./demo");
  console.log("cd demo && npm run migrate && npm run dev\n");
} else {
  // --- SQLite3 demo flow (default) ---

  // 2. Scaffold project with sqlite3
  run(
    "node ../src/cli/main.js init --database sqlite3 --yes --no-install",
    DEMO,
  );

  // 3. Copy schema and patch adapter to sqlite3
  const schema = JSON.parse(
    fs.readFileSync(path.join(ROOT, "dbmr.schema.json"), "utf8"),
  );
  schema.adapter = "sqlite3";
  if (schema.options) {
    delete schema.options.session;
    delete schema.options.loki;
  }
  fs.writeFileSync(
    path.join(DEMO, "dbmr.schema.json"),
    JSON.stringify(schema, null, 2) + "\n",
  );
  console.log("\n> Copied and patched dbmr.schema.json (adapter → sqlite3)");

  // 4. Generate models, routes, tests, openapi from schema
  run("node ../src/cli/main.js generate --from dbmr.schema.json", DEMO);

  // 5. Install dependencies
  run("npm install", DEMO);

  console.log("\n✔ Demo project ready in ./demo");
  console.log("cd demo && npm run migrate && npm run dev\n");
}
