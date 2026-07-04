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

// 2. Copy schema into the demo folder
const schemaPath =
  ADAPTER === "postgres"
    ? path.join(ROOT, "dbmr.postgres.test.schema.json")
    : path.join(ROOT, "dbmr.schema.json");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

// Patch adapter-specific options for the sqlite3 demo
if (ADAPTER === "sqlite3") {
  schema.adapter = "sqlite3";
  if (schema.options) {
    delete schema.options.session;
    delete schema.options.loki;
  }
}

const schemaDest = path.join(DEMO, "dbmr.schema.json");
fs.writeFileSync(schemaDest, JSON.stringify(schema, null, 2) + "\n");
console.log(`\n> Copied ${schemaPath} → ${schemaDest}`);

// 3. Scaffold + generate from schema + install in one init run
run("node ../src/cli/main.js init --yes", DEMO);

console.log("\n✔ Demo project ready in ./demo");
console.log("cd demo && npm run migrate && npm run dev\n");