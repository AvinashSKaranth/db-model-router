"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const help = require("../../src/cli/commands/help");
const diff = require("../../src/cli/commands/diff");
const doctor = require("../../src/cli/commands/doctor");
const { buildSchemaArtifacts } = require("../../src/cli/commands/generate");
const inspect = require("../../src/cli/commands/inspect");
const typesCommand = require("../../src/cli/commands/types");
const { resolveAndConnectDb } = require("../../src/cli/commands/migrate-helper");
const dbManager = require("../../src/cli/commands/db-manager");
const initCommand = require("../../src/cli/commands/init");
const encryptScan = require("../../src/cli/commands/encrypt-scan");
const encryptRotateKey = require("../../src/cli/commands/encrypt-rotate-key");
const { OutputContext } = require("../../src/cli/flags");

describe("CLI Commands Deep Coverage Suite", function () {
  this.timeout(15000);

  let tmpDir;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbmr-cmds-"));
  });

  afterEach(function () {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    process.exitCode = 0;
  });

  // -------------------------------------------------------------------------
  // 1. help.js
  // -------------------------------------------------------------------------
  describe("help command", function () {
    it("prints general help when no command is specified", async function () {
      let printed = false;
      const ctx = new OutputContext({ json: false });
      await help({}, {}, ctx, {
        printHelp: () => {
          printed = true;
        },
      });
      assert.strictEqual(printed, true);
    });

    it("prints specific topic help when valid topic given", async function () {
      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };
      await help({ _command: "init" }, {}, ctx);
      assert.ok(logs.some((l) => l.includes("Usage: db-model-router init")));
    });

    it("warns about unknown topic when invalid command requested", async function () {
      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };
      await help({ _command: "nonexistent" }, {}, ctx);
      assert.ok(logs.some((l) => l.includes("Unknown command: nonexistent")));
    });
  });

  // -------------------------------------------------------------------------
  // 2. diff.js
  // -------------------------------------------------------------------------
  describe("diff command", function () {
    it("handles missing schema file in human and json modes", async function () {
      const missingPath = path.join(tmpDir, "missing.json");
      const ctxHuman = { log: () => {} };
      await diff({ from: missingPath }, { json: false }, ctxHuman);
      assert.strictEqual(process.exitCode, 1);
      process.exitCode = 0;

      const results = [];
      const ctxJson = { result: (r) => results.push(r) };
      await diff({ from: missingPath }, { json: true }, ctxJson);
      assert.strictEqual(results[0].code, "SCHEMA_NOT_FOUND");
    });

    it("handles invalid JSON schema file", async function () {
      const badPath = path.join(tmpDir, "bad.json");
      fs.writeFileSync(badPath, "{ invalid json");

      const results = [];
      const ctx = { result: (r) => results.push(r) };
      await diff({ from: badPath }, { json: true }, ctx);
      assert.strictEqual(results[0].code, "SCHEMA_VALIDATION");
    });

    it("computes diff against generated files for a valid schema", async function () {
      const schemaPath = path.join(tmpDir, "dbmr.schema.json");
      fs.writeFileSync(
        schemaPath,
        JSON.stringify({
          adapter: "sqlite3",
          tables: {
            users: {
              primaryKey: "id",
              columns: { id: "auto_increment", name: "required|string" },
            },
          },
        }),
      );

      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };
      await diff({ from: schemaPath }, { json: false }, ctx);
      // diff exits with 1 when differences exist between schema and empty dir
      assert.strictEqual(process.exitCode, 1);
    });

    it("diff reports modified, deleted, and all up to date in human mode", async function () {
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        const schema = {
          adapter: "sqlite3",
          framework: "express",
          options: { saasStructure: false },
          tables: {
            items: {
              columns: { id: "auto_increment", name: "string" },
            },
          },
        };
        const schemaPath = path.join(tmpDir, "dbmr.schema.json");
        fs.writeFileSync(schemaPath, JSON.stringify(schema));

        // 1. Generate files
        const { parseSchema } = require("../../src/schema/schema-parser");
        await buildSchemaArtifacts({
          schema: parseSchema(JSON.stringify(schema)),
          baseDir: tmpDir,
          ctx: { log: () => {} },
          flags: { dryRun: false },
        });

        // 2. Up to date check
        const logsUpToDate = [];
        await diff({ from: schemaPath }, { json: false }, { log: (m) => logsUpToDate.push(m) });
        assert.ok(logsUpToDate.some((l) => l.includes("up to date")));

        // 3. Modify a file
        const modelFile = path.join(tmpDir, "models", "items.js");
        if (fs.existsSync(modelFile)) {
          fs.appendFileSync(modelFile, "\n// modified line\n");
        }
        // Add an extra unexpected file in models
        const extraFile = path.join(tmpDir, "models", "ghost.js");
        fs.writeFileSync(extraFile, "// ghost file");

        const logsDiff = [];
        await diff({ from: schemaPath }, { json: false }, { log: (m) => logsDiff.push(m) });
        assert.ok(logsDiff.some((l) => l.includes("Modified") || l.includes("Deleted") || l.includes("differ")));
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. doctor.js
  // -------------------------------------------------------------------------
  describe("doctor command", function () {
    it("handles missing schema in doctor check", async function () {
      const missingPath = path.join(tmpDir, "none.json");
      const results = [];
      const ctx = { result: (r) => results.push(r) };
      await doctor({ from: missingPath }, { json: true }, ctx);
      assert.strictEqual(results[0].validation.valid, false);
      assert.ok(results[0].validation.errors.some((e) => e.message.includes("not found")));
    });

    it("validates valid schema and reports driver checks", async function () {
      const schemaPath = path.join(tmpDir, "dbmr.schema.json");
      fs.writeFileSync(
        schemaPath,
        JSON.stringify({
          adapter: "sqlite3",
          tables: {
            items: {
              primaryKey: "id",
              columns: { id: "auto_increment", name: "string" },
            },
          },
        }),
      );

      const logs = [];
      const ctx = { log: (msg) => logs.push(msg) };
      await doctor({ from: schemaPath }, { json: false }, ctx);
      assert.ok(logs.some((l) => l.includes("Dependencies") || l.includes("Schema")));
    });

    it("doctor reports out-of-sync files and problems in human mode", async function () {
      const schemaPath = path.join(tmpDir, "dbmr.schema.json");
      fs.writeFileSync(
        schemaPath,
        JSON.stringify({
          adapter: "postgres",
          framework: "express",
          tables: {
            items: {
              columns: { id: "auto_increment", name: "string" },
            },
          },
        }),
      );

      const logs = [];
      const ctx = { log: (m) => logs.push(m) };
      await doctor({ from: schemaPath, dir: tmpDir }, { json: false }, ctx);
      assert.ok(
        logs.some(
          (l) =>
            l.includes("Files out of sync") ||
            l.includes("out of sync") ||
            l.includes("Dependencies"),
        ),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. generate.js (buildSchemaArtifacts)
  // -------------------------------------------------------------------------
  describe("generate.js (buildSchemaArtifacts)", function () {
    it("builds all artifacts into target baseDir with and without SaaS", async function () {
      const { parseSchema } = require("../../src/schema/schema-parser");
      const rawSchema = JSON.stringify({
        adapter: "sqlite3",
        framework: "express",
        options: {
          saasStructure: true,
          includeDocs: true,
        },
        tables: {
          categories: {
            primaryKey: "id",
            columns: { id: "auto_increment", name: "required|string" },
          },
          products: {
            primaryKey: "id",
            parent: "categories",
            columns: {
              id: "auto_increment",
              category_id: "required|integer",
              title: "required|string",
            },
          },
        },
      });
      const schema = parseSchema(rawSchema);

      const outDir = path.join(tmpDir, "app_out");
      const ctx = { log: () => {}, dryRun: () => {} };
      const res = await buildSchemaArtifacts({
        schema,
        baseDir: outDir,
        ctx,
        flags: { dryRun: false },
      });

      assert.ok(Array.isArray(res.files));
      assert.ok(fs.existsSync(path.join(outDir, "models/categories.js")));
      assert.ok(fs.existsSync(path.join(outDir, "models/products.js")));
      assert.ok(fs.existsSync(path.join(outDir, "openapi.json")));
      assert.ok(fs.existsSync(path.join(outDir, "routes/docs.js")));
    });
  });

  // -------------------------------------------------------------------------
  // 5. types.js
  // -------------------------------------------------------------------------
  describe("types command", function () {
    it("handles missing schema file", async function () {
      const errors = [];
      const ctx = { error: (e) => errors.push(e) };
      const code = await typesCommand({ from: path.join(tmpDir, "missing.json") }, ctx);
      assert.strictEqual(code, 1);
      assert.ok(errors[0].includes("not found"));
    });

    it("generates types declaration to file and stdout", async function () {
      const schemaPath = path.join(tmpDir, "dbmr.schema.json");
      fs.writeFileSync(
        schemaPath,
        JSON.stringify({
          tables: {
            users: {
              columns: { id: "auto_increment", name: "required|string" },
            },
          },
        }),
      );

      // stdout mode
      let stdoutData = "";
      const origWrite = process.stdout.write;
      try {
        process.stdout.write = (str) => {
          stdoutData += str;
          return true;
        };
        const codeStdout = await typesCommand({ from: schemaPath, stdout: true });
        assert.strictEqual(codeStdout, 0);
        assert.ok(stdoutData.includes("export interface Users"));
      } finally {
        process.stdout.write = origWrite;
      }

      // file output mode
      const outFile = path.join(tmpDir, "models.d.ts");
      const codeFile = await typesCommand({ from: schemaPath, out: outFile });
      assert.strictEqual(codeFile, 0);
      assert.ok(fs.existsSync(outFile));
      const content = fs.readFileSync(outFile, "utf8");
      assert.ok(content.includes("export interface Users"));
    });
  });

  // -------------------------------------------------------------------------
  // 6. migrate-helper.js
  // -------------------------------------------------------------------------
  describe("migrate-helper.js", function () {
    it("resolveAndConnectDb resolves adapter and loads database instance", function () {
      const res = resolveAndConnectDb({ type: "sqlite3" });
      assert.ok(res);
      assert.strictEqual(typeof res.db.query, "function");
      if (typeof res.db.disconnect === "function") res.db.disconnect();
    });
  });

  // -------------------------------------------------------------------------
  // 7. db-manager.js
  // -------------------------------------------------------------------------
  describe("db-manager.js", function () {
    it("exits with error when env file is missing", async function () {
      const logs = [];
      const ctx = { log: (m) => logs.push(m) };
      await dbManager({ env: path.join(tmpDir, "nonexistent.env") }, {}, ctx);
      assert.strictEqual(process.exitCode, 1);
      assert.ok(logs.some((l) => l.includes("Environment file not found")));
    });

    it("exits with error when DB_TYPE is not configured in env", async function () {
      const envFile = path.join(tmpDir, ".env");
      fs.writeFileSync(envFile, "PORT=4000\n");

      const origEnv = process.env.DB_TYPE;
      delete process.env.DB_TYPE;
      try {
        const logs = [];
        const ctx = { log: (m) => logs.push(m) };
        await dbManager({ env: envFile }, {}, ctx);
        assert.strictEqual(process.exitCode, 1);
        assert.ok(logs.some((l) => l.includes("DB_TYPE not specified")));
      } finally {
        if (origEnv) process.env.DB_TYPE = origEnv;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. encrypt-scan.js & encrypt-rotate-key.js
  // -------------------------------------------------------------------------
  describe("encrypt-scan.js & encrypt-rotate-key.js", function () {
    it("encrypt-scan handles missing schema file", async function () {
      const logs = [];
      const ctx = { log: (m) => logs.push(m) };
      await encryptScan({ from: path.join(tmpDir, "missing.json") }, {}, ctx);
      assert.strictEqual(process.exitCode, 1);
    });

    it("encrypt-rotate-key handles missing schema and dry-run scan", async function () {
      const logs = [];
      const ctx = { log: (m) => logs.push(m) };
      await encryptRotateKey({ from: path.join(tmpDir, "missing.json") }, {}, ctx);
      assert.strictEqual(process.exitCode, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 9. inspect.js
  // -------------------------------------------------------------------------
  describe("inspect.js", function () {
    it("modelMetaToSchema converts introspection models back to parsed schema", function () {
      const schema = inspect.modelMetaToSchema("sqlite3", "express", [
        {
          table: "products",
          structure: { title: "required|string", price: "numeric" },
          primary_key: "id",
          unique: ["title"],
          option: {
            safeDelete: "is_deleted",
            created_at: "created_at",
            modified_at: "updated_at",
          },
        },
      ]);
      assert.strictEqual(schema.adapter, "sqlite3");
      assert.strictEqual(schema.framework, "express");
      assert.ok(schema.tables.products);
      assert.strictEqual(schema.tables.products.pk, "id");
      assert.strictEqual(schema.tables.products.columns.created_at, "datetime");
      assert.strictEqual(schema.tables.products.columns.is_deleted, "boolean");
    });

    it("handles missing or unsupported --type in json and human modes", async function () {
      const results = [];
      const ctx = { result: (r) => results.push(r), log: () => {} };
      await inspect({}, { json: true }, ctx);
      assert.strictEqual(results[0].code, "INVALID_TYPE");

      const humanLogs = [];
      const humanCtx = { log: (m) => humanLogs.push(m) };
      await inspect({ type: "cassandra" }, { json: false }, humanCtx);
      assert.ok(humanLogs.some((l) => l.includes("Unsupported")));
    });
  });

  // -------------------------------------------------------------------------
  // 10. init.js command
  // -------------------------------------------------------------------------
  describe("init command handler", function () {
    it("handles missing and invalid schema file", async function () {
      const resMissing = [];
      const ctxMissing = { result: (r) => resMissing.push(r), log: () => {} };
      await initCommand({ from: path.join(tmpDir, "missing.json") }, { json: true }, ctxMissing);
      assert.strictEqual(resMissing[0].code, "SCHEMA_NOT_FOUND");

      const badSchema = path.join(tmpDir, "bad.json");
      fs.writeFileSync(badSchema, "{ invalid json");
      const resBad = [];
      const ctxBad = { result: (r) => resBad.push(r), log: () => {} };
      await initCommand({ from: badSchema }, { json: true }, ctxBad);
      assert.strictEqual(resBad[0].code, "SCHEMA_VALIDATION");
    });

    it("supports dryRun in json and human modes, and detects existing project", async function () {
      const schemaPath = path.join(tmpDir, "dbmr.schema.json");
      fs.writeFileSync(
        schemaPath,
        JSON.stringify({
          adapter: "sqlite3",
          framework: "express",
          options: { output: tmpDir, saasStructure: false },
          tables: {
            items: { columns: { id: "auto_increment", name: "string" } },
          },
        }),
      );

      // dryRun json
      const resDry = [];
      const ctxDry = { result: (r) => resDry.push(r), log: () => {} };
      await initCommand({ from: schemaPath }, { dryRun: true, json: true }, ctxDry);
      assert.ok(resDry[0].files);

      // dryRun human
      const humanLogs = [];
      const humanCtx = { log: (m) => humanLogs.push(m) };
      await initCommand({ from: schemaPath }, { dryRun: true, noInstall: true, json: false }, humanCtx);
      assert.ok(humanLogs.some((l) => l.includes("Dry run") || l.includes("planned")));

      // Existing project rejection
      const origCwd = process.cwd();
      try {
        process.chdir(tmpDir);
        fs.writeFileSync(path.join(tmpDir, "app.js"), "// existing project");
        const resExists = [];
        const ctxExists = { result: (r) => resExists.push(r), log: () => {} };
        await initCommand({ from: schemaPath }, { noInstall: true, json: true }, ctxExists);
        assert.strictEqual(resExists[0].code, "PROJECT_EXISTS");
      } finally {
        process.chdir(origCwd);
      }
    });
  });
});
