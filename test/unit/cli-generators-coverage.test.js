"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { parseFlags, OutputContext } = require("../../src/cli/flags");
const {
  lineDiff,
  buildExpectedFiles,
  computeDiff,
} = require("../../src/cli/diff-engine");
const {
  iterateRows,
  readField,
  writeField,
  scanTable,
  rotateTable,
  encryptTable,
} = require("../../src/cli/encryption-batch");
const { generateDocsRoute } = require("../../src/cli/generate-docs-route");
const {
  parseColumnRule,
  generateMigrationFiles,
  generateCreateTableSQL,
} = require("../../src/cli/generate-migration");
const { generateOpenAPISpec } = require("../../src/cli/generate-openapi");
const {
  generateRouteFile,
  generateParentRouteFile,
  generateChildRouteFile,
  generateRoutesIndexFile,
  generateTestFile,
  generateChildTestFile,
} = require("../../src/cli/generate-route");
const modelGens = require("../../src/cli/generate-model");
const {
  generateTypes,
  ruleToTypeScript,
  toPascalCase,
} = require("../../src/cli/generate-types");
const {
  getGitignoreContent,
  generateSaasStructure,
} = require("../../src/cli/generate-saas-structure");
const {
  generateAuthenticateMiddleware,
  generateTenantIsolationMiddleware,
  generateHasPermissionMiddleware,
} = require("../../src/cli/saas/generate-saas-middleware");
const {
  generateSaasMigrations,
  TABLE_DEFINITIONS,
  SQL_ADAPTERS,
} = require("../../src/cli/saas/generate-saas-migrations");
const {
  generateSaasModels,
  generateModelContent,
} = require("../../src/cli/saas/generate-saas-models");
const { generateSaasOpenAPIPaths } = require("../../src/cli/saas/generate-saas-openapi");
const {
  generateCrudRoutes,
  generateAuthRoutes,
  generateRoutesIndex,
} = require("../../src/cli/saas/generate-saas-routes");
const {
  generateSaasSeeds,
  SUPER_ADMIN_PERMISSIONS,
  TENANT_ADMIN_PERMISSIONS,
} = require("../../src/cli/saas/generate-saas-seeds");
const { generateSaasTests } = require("../../src/cli/saas/generate-saas-tests");
const {
  generatePasswordUtil,
  generateModulesUtil,
  generateWebhookUtil,
} = require("../../src/cli/saas/generate-saas-utils");
const {
  DRIVER_MAP,
  collectDependencies,
  getScripts,
} = require("../../src/cli/init/dependencies");
const initGens = require("../../src/cli/init/generators");

describe("CLI Generators & SaaS Coverage Suite", function () {
  this.timeout(15000);

  // -------------------------------------------------------------------------
  // 1. flags.js
  // -------------------------------------------------------------------------
  describe("flags.js", function () {
    it("parseFlags handles all standard flags, camelCase args, subcommands, and positionals", function () {
      const argv = [
        "generate",
        "--yes",
        "--json",
        "--dry-run",
        "--no-install",
        "--help",
        "--from",
        "schema.json",
        "--new-key",
        "secret123",
        "extra1",
        "extra2",
      ];
      const parsed = parseFlags(argv);

      assert.strictEqual(parsed.subcommand, "generate");
      assert.strictEqual(parsed.flags.yes, true);
      assert.strictEqual(parsed.flags.json, true);
      assert.strictEqual(parsed.flags.dryRun, true);
      assert.strictEqual(parsed.flags.noInstall, true);
      assert.strictEqual(parsed.flags.help, true);
      assert.strictEqual(parsed.args.from, "schema.json");
      assert.strictEqual(parsed.args.newKey, "secret123");
      assert.deepStrictEqual(parsed.args._, ["extra1", "extra2"]);
    });

    it("OutputContext behaves correctly in human and json modes", function () {
      let outHuman = "";
      const origLog = console.log;
      try {
        console.log = (...args) => { outHuman += args.join(" ") + "\n"; };

        const ctxHuman = new OutputContext({ json: false });
        ctxHuman.log("A log message");
        ctxHuman.result({ id: 1 });
        ctxHuman.flush();
        assert.ok(outHuman.includes("A log message"));

        // JSON mode
        let outJson = "";
        console.log = (...args) => { outJson += args.join(" ") + "\n"; };

        const ctxJson = new OutputContext({ json: true });
        ctxJson.log("Hidden in json");
        ctxJson.result({ status: "ok", count: 5 });
        ctxJson.flush();
        assert.ok(!outJson.includes("Hidden in json"));
        const parsed = JSON.parse(outJson);
        assert.strictEqual(parsed.status, "ok");
        assert.strictEqual(parsed.count, 5);
      } finally {
        console.log = origLog;
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. diff-engine.js
  // -------------------------------------------------------------------------
  describe("diff-engine.js", function () {
    it("lineDiff handles additions, deletions, modifications, and matching lines", function () {
      const exp = "line 1\nline 2\nline 3\nline 4";
      const act = "line 1\nline 2 mod\nline 3\nline 4\nextra act";
      const diff = lineDiff(exp, act);
      assert.ok(diff.includes("-2: line 2 mod"));
      assert.ok(diff.includes("+2: line 2"));
      assert.ok(diff.includes("+5: extra act"));

      const identical = lineDiff("abc", "abc");
      assert.strictEqual(identical, "");
    });

    it("buildExpectedFiles creates expected files map for models, routes, and docs", function () {
      const meta = [
        {
          table: "users",
          structure: { name: "string" },
          primary_key: "id",
          unique: ["email"],
          option: {},
        },
        {
          table: "orders",
          structure: { total: "numeric" },
          primary_key: "id",
          unique: ["order_num"],
          option: {},
        },
      ];
      const rels = [{ parent: "users", child: "orders", foreignKey: "user_id" }];
      const files = buildExpectedFiles(meta, rels, { includeDocs: true });
      assert.ok(files.has("models/users.js"));
      assert.ok(files.has("models/orders.js"));
      assert.ok(files.has("models/index.js"));
      assert.ok(files.has("routes/users/index.js"));
      assert.ok(files.has("openapi.json"));
      assert.ok(files.has("routes/docs.js"));
    });

    it("computeDiff compares planned files with disk", function () {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbmr-diff-"));
      try {
        fs.mkdirSync(path.join(tmpDir, "models"), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "models/users.js"), "old content");

        const meta = [
          {
            table: "users",
            structure: { name: "string" },
            primary_key: "id",
            unique: ["name"],
            option: {},
          },
        ];

        const res = computeDiff(tmpDir, meta, []);
        assert.ok(Array.isArray(res.added));
        assert.ok(Array.isArray(res.modified));
        assert.ok(Array.isArray(res.deleted));
        assert.ok(res.modified.some((m) => m.file === "models/users.js"));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. encryption-batch.js
  // -------------------------------------------------------------------------
  describe("encryption-batch.js", function () {
    it("readField and writeField handle column and nested dot paths", function () {
      const meta = {
        columns: { ssn: true },
        jsonKeys: { metadata: [{ path: ["details", "card"] }] },
      };

      const row = { ssn: "ENC:ssn", metadata: { details: { card: "ENC:card" } } };
      assert.strictEqual(readField(row, meta, "ssn"), "ENC:ssn");
      assert.strictEqual(readField(row, meta, "metadata"), "ENC:card");
      assert.strictEqual(readField(row, meta, "metadata.details.card"), "ENC:card");

      writeField(row, meta, "ssn", "NEW:ssn");
      assert.strictEqual(row.ssn, "NEW:ssn");

      writeField(row, meta, "metadata.details.card", "NEW:card");
      assert.strictEqual(row.metadata.details.card, "NEW:card");
    });

    it("iterateRows yields pages for single and composite primary keys", async function () {
      const mockDb = {
        async list(table, filter, sort, safeDelete, page, pageSize) {
          if (filter.length === 0 && sort.length === 0) {
            // offset mode
            if (page === 0) return { data: [{ id: 1 }, { id: 2 }] };
            return { data: [] };
          }
          // keyset mode
          const lastId = filter[0]?.[0]?.[2] || 0;
          if (lastId === 0) return { data: [{ id: 1 }, { id: 2 }] };
          return { data: [] };
        },
      };

      // Keyset pagination
      const pagesKeyset = [];
      for await (const batch of iterateRows(mockDb, "test", "id", { pageSize: 2 })) {
        pagesKeyset.push(batch);
      }
      assert.strictEqual(pagesKeyset.length, 1);
      assert.strictEqual(pagesKeyset[0].length, 2);

      // Offset pagination (composite PK)
      const pagesOffset = [];
      for await (const batch of iterateRows(mockDb, "test", ["tenant_id", "id"], { pageSize: 2 })) {
        pagesOffset.push(batch);
      }
      assert.strictEqual(pagesOffset.length, 1);
      assert.strictEqual(pagesOffset[0].length, 2);
    });

    it("scanTable and rotateTableKey report counts correctly", async function () {
      const encryption = require("../../src/commons/encryption");
      const keyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const key2Hex = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      encryption.setConfig({
        key: keyHex,
        keys: { 1: keyHex, 2: key2Hex },
        version: 1,
      });

      const conf = encryption.getConfig();
      const encryptedVal = encryption.encrypt("my-secret", conf.keyring[1], 1);
      const mockDb = {
        async list() {
          return { data: [{ id: 1, ssn: encryptedVal, plaintext_col: "plain" }] };
        },
        async upsert() {
          return { rows: 1 };
        },
        async query() {
          return { affectedRows: 1 };
        },
      };

      const structure = { ssn: "required|string|encrypted" };

      // Scan table
      const scanRes = await scanTable(mockDb, "users", "id", structure, { pageSize: 10 });
      assert.strictEqual(scanRes.total, 1);
      assert.strictEqual(scanRes.fields.ssn.encrypted, 1);

      // Rotate table key
      const rotRes = await rotateTable(mockDb, "users", "id", structure, conf, 2, conf.keyring[2], {
        dryRun: false,
        pageSize: 10,
      });
      assert.strictEqual(rotRes.total, 1);
      assert.strictEqual(rotRes.changed, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. generate-docs-route.js & generate-route.js
  // -------------------------------------------------------------------------
  describe("generate-docs-route.js & generate-route.js", function () {
    it("generateDocsRoute produces valid Swagger UI router", function () {
      const code = generateDocsRoute();
      assert.ok(code.includes('import express from "express";'));
      assert.ok(code.includes("swaggerUi.setup(spec"));
      assert.ok(code.includes("export default router;"));
    });

    it("generateRouteFile generates standard route file", function () {
      const code = generateRouteFile("users");
      assert.ok(code.includes('import { users } from "#models";'));
      assert.ok(code.includes("router.use(\"/\", route(users));"));
    });

    it("generateParentRouteFile mounts child routes under param prefix", function () {
      const children = [{ child: "order_items", foreignKey: "order_id" }];
      const code = generateParentRouteFile("orders", children, "user_id");
      assert.ok(code.includes("import order_itemsRoute from \"./order_items/index.js\";"));
      assert.ok(code.includes("router.use(\"/:order_id/order_items\", order_itemsRoute);"));
      assert.ok(code.includes("route(orders, { user_id: \"params.user_id\" })"));
    });

    it("generateChildRouteFile mounts child router scoped to parent FK", function () {
      const code = generateChildRouteFile("order_items", "orders", "order_id");
      assert.ok(code.includes("route(order_items, { order_id: \"params.order_id\" })"));
    });

    it("generateRoutesIndexFile imports and mounts all table routes", function () {
      const tableNames = ["users", "orders"];
      const code = generateRoutesIndexFile(tableNames, [], { includeDocs: true });
      assert.ok(code.includes("import usersRoute from \"./users/index.js\";"));
      assert.ok(code.includes("import ordersRoute from \"./orders/index.js\";"));
      assert.ok(code.includes("import docsRoute from \"./docs.js\";"));
      assert.ok(code.includes("router.use(\"/users\", usersRoute);"));
      assert.ok(code.includes("router.use(\"/docs\", docsRoute);"));
    });

    it("generateTestFile and generateChildTestFile generate comprehensive supertest suites", function () {
      const structure = { name: "required|string", age: "integer" };
      const testCode = generateTestFile("users", "id", structure);
      assert.ok(testCode.includes('describe("users routes"'));
      assert.ok(testCode.includes("POST /users/add"));
      assert.ok(testCode.includes("GET /users/"));

      const childTestCode = generateChildTestFile("order_items", "orders", "order_id", "id", "../models/");
      assert.ok(childTestCode.includes('describe("order_items (child of orders) routes"'));
    });
  });

  // -------------------------------------------------------------------------
  // 5. generate-migration.js
  // -------------------------------------------------------------------------
  describe("generate-migration.js", function () {
    it("parseColumnRule parses types, subtypes, requirements, and validators", function () {
      const parsed1 = parseColumnRule("required|string:text|minLength:5");
      assert.strictEqual(parsed1.isRequired, true);
      assert.strictEqual(parsed1.baseType, "string");
      assert.strictEqual(parsed1.subType, "text");
      assert.deepStrictEqual(parsed1.validators, ["minLength:5"]);

      const parsed2 = parseColumnRule("auto_increment");
      assert.strictEqual(parsed2.baseType, "auto_increment");

      const parsed3 = parseColumnRule("datetime");
      assert.strictEqual(parsed3.baseType, "datetime");
    });

    it("generateCreateTableSQL supports all 10 adapters", function () {
      const tableDef = {
        primaryKey: "id",
        columns: {
          id: "auto_increment",
          name: "required|string",
          bio: "string:text",
          score: "integer",
          price: "numeric",
          is_active: "boolean",
          created_at: "datetime",
          meta: "object",
        },
        unique: [["name"]],
        foreignKeys: {
          user_id: { references: "users(id)", onDelete: "CASCADE" },
        },
      };

      const adapters = [
        "mysql",
        "mariadb",
        "postgres",
        "cockroachdb",
        "sqlite3",
        "mssql",
        "oracle",
        "mongodb",
        "dynamodb",
        "redis",
      ];

      for (const adapter of adapters) {
        const sql = generateCreateTableSQL("products", tableDef, adapter);
        assert.ok(typeof sql === "string" && sql.length > 0, `Expected SQL for ${adapter}`);
      }
    });

    it("generateMigrationFiles creates complete UP/DOWN migration files", function () {
      const schema = {
        adapter: "postgres",
        tables: {
          items: {
            primaryKey: "id",
            columns: {
              id: "auto_increment",
              title: "required|string",
            },
          },
        },
      };
      const migrations = generateMigrationFiles(schema);
      assert.strictEqual(migrations.length, 1);
      assert.ok(migrations[0].filename.includes("create_tables.sql"));
      assert.ok(migrations[0].content.includes("CREATE TABLE IF NOT EXISTS"));
    });
  });

  // -------------------------------------------------------------------------
  // 6. generate-openapi.js & generate-types.js
  // -------------------------------------------------------------------------
  describe("generate-openapi.js & generate-types.js", function () {
    it("generateOpenAPISpec builds complete OpenAPI 3.0 specification", function () {
      const models = [
        {
          table: "users",
          primary_key: "id",
          structure: {
            username: "required|string",
            email: "required|string:email",
            age: "integer",
          },
          unique: ["email"],
        },
      ];
      const spec = generateOpenAPISpec(models, {
        basePath: "/api",
        title: "Test API",
        version: "2.0.0",
      });

      assert.strictEqual(spec.openapi, "3.0.3");
      assert.strictEqual(spec.info.title, "Test API");
      assert.ok(spec.paths["/api/users/"]);
      assert.ok(spec.paths["/api/users/"].get);
      assert.ok(spec.paths["/api/users/"].post);
      assert.ok(spec.paths["/api/users/{id}"]);
      assert.ok(spec.components.schemas.Users);
    });

    it("generateTypes creates accurate TypeScript definitions", function () {
      assert.strictEqual(toPascalCase("user_profiles"), "UserProfiles");

      const t1 = ruleToTypeScript("required|string");
      assert.strictEqual(t1.type, "string");
      assert.strictEqual(t1.required, true);

      const t2 = ruleToTypeScript("integer");
      assert.strictEqual(t2.type, "number");
      assert.strictEqual(t2.required, false);

      const t3 = ruleToTypeScript("boolean");
      assert.strictEqual(t3.type, "boolean");

      const t4 = ruleToTypeScript("object");
      assert.strictEqual(t4.type, "Record<string, any>");

      const schema = {
        tables: {
          users: {
            columns: {
              id: "auto_increment",
              name: "required|string",
              bio: "string",
            },
          },
        },
      };
      const dts = generateTypes(schema);
      assert.ok(dts.includes("export interface Users {"));
      assert.ok(dts.includes("id: number;"));
      assert.ok(dts.includes("name: string;"));
      assert.ok(dts.includes("bio?: string | null;"));
      assert.ok(dts.includes("export interface DatabaseSchema"));
    });
  });

  // -------------------------------------------------------------------------
  // 7. SaaS Generators Suite
  // -------------------------------------------------------------------------
  describe("src/cli/saas/* suite", function () {
    it("generateSaasMiddleware generates auth, isolation, and permission middlewares", function () {
      const auth = generateAuthenticateMiddleware();
      assert.ok(auth.content.includes("export default authenticate;"));

      const iso = generateTenantIsolationMiddleware();
      assert.ok(iso.content.includes("export default tenantIsolation;"));

      const perm = generateHasPermissionMiddleware();
      assert.ok(perm.content.includes("export default hasPermission;"));
    });

    it("generateSaasMigrations produces migrations for all SaaS tables", function () {
      assert.ok(Array.isArray(TABLE_DEFINITIONS));
      assert.strictEqual(TABLE_DEFINITIONS.length, 6);

      for (const adapter of SQL_ADAPTERS) {
        const migs = generateSaasMigrations(adapter);
        assert.strictEqual(migs.length, 1);
        assert.ok(migs[0].relPath.includes("migrations/"));
        assert.ok(migs[0].content.includes("CREATE TABLE"));
      }
    });

    it("generateSaasModels produces model files and index", function () {
      const models = generateSaasModels();
      assert.strictEqual(models.length, 7);
      const tenantsModel = models.find((m) => m.relPath.includes("tenants.js"));
      assert.ok(tenantsModel.content.includes("export default tenants;"));
    });

    it("generateSaasOpenAPIPaths produces auth and tenant paths", function () {
      const res = generateSaasOpenAPIPaths();
      assert.ok(res.paths["/api/auth/login"]);
      assert.ok(res.paths["/api/auth/logout"]);
      assert.ok(res.paths["/api/users/"]);
    });

    it("generateSaasRoutes generates CRUD routes, auth routes, and unified index", function () {
      const crud = generateCrudRoutes();
      assert.strictEqual(crud.length, 4);

      const auth = generateAuthRoutes();
      assert.ok(auth.content.includes("router.post(\"/login\""));

      const index = generateRoutesIndex(["products"]);
      assert.ok(index.content.includes("router.use(\"/auth\", authRoute);"));
      assert.ok(index.content.includes("router.use(\"/products\", productsRoute);"));
    });

    it("generateSaasSeeds creates deterministic super admin and tenant permissions", function () {
      assert.ok(SUPER_ADMIN_PERMISSIONS.length > 0);
      assert.ok(TENANT_ADMIN_PERMISSIONS.length > 0);
      const seeds = generateSaasSeeds();
      assert.strictEqual(seeds.length, 2);
      assert.ok(seeds[0].content.includes("SUPER_ADMIN_EMAIL"));
    });

    it("generateSaasUtils generates password, modules, and webhook utilities", function () {
      const pw = generatePasswordUtil();
      assert.ok(pw.includes("hashPassword"));
      assert.ok(pw.includes("verifyPassword"));

      const mod = generateModulesUtil();
      assert.ok(mod.includes("isValidModule"));

      const wh = generateWebhookUtil();
      assert.ok(wh.includes("sendWebhook"));
    });

    it("generateSaasTests creates comprehensive integration tests", function () {
      const tests = generateSaasTests();
      assert.strictEqual(tests.length, 5);
      const authTest = tests.find((t) => t.relPath.includes("auth.test.js"));
      assert.ok(authTest.content.includes("authRoute"));
    });

    it("generateSaasStructure orchestrates full SaaS generation and gitignore update", function () {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbmr-saas-"));
      try {
        const gitignore = getGitignoreContent(tmpDir);
        assert.ok(gitignore.includes("credentials.md"));

        const planned = generateSaasStructure("sqlite3", {
          tableNames: ["orders"],
          relationships: [],
        });
        assert.ok(planned.length >= 25);
        assert.ok(planned.some((p) => p.relPath.includes("migrations/")));
        assert.ok(planned.some((p) => p.relPath.includes("models/")));
        assert.ok(planned.some((p) => p.relPath.includes("routes/")));
        assert.ok(planned.some((p) => p.relPath.includes("middleware/")));
        assert.ok(planned.some((p) => p.relPath.includes("commons/")));
        assert.ok(planned.some((p) => p.relPath.includes("seeds/")));
        assert.ok(planned.some((p) => p.relPath.includes("test/")));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. init/dependencies.js & init/generators.js
  // -------------------------------------------------------------------------
  describe("init/dependencies.js & init/generators.js", function () {
    it("collectDependencies resolves drivers, session, and cache for all adapters", function () {
      assert.ok(DRIVER_MAP.sqlite3);
      assert.ok(DRIVER_MAP.postgres);
      assert.ok(DRIVER_MAP.mysql);
      assert.ok(DRIVER_MAP.mariadb);
      assert.ok(DRIVER_MAP.oracle);
      assert.ok(DRIVER_MAP.mssql);
      assert.ok(DRIVER_MAP.cockroachdb);
      assert.ok(DRIVER_MAP.redis);
      assert.ok(DRIVER_MAP.mongodb);
      assert.ok(DRIVER_MAP.dynamodb);

      const sqlDeps = collectDependencies({
        database: "postgres",
        session: "redis",
        cache: "redis",
        framework: "express",
      });
      assert.ok(sqlDeps.dependencies.pg);
      assert.ok(sqlDeps.dependencies.ioredis);
      assert.ok(sqlDeps.dependencies["connect-redis"]);
      assert.ok(sqlDeps.dependencies.express);

      const ueDeps = collectDependencies({
        database: "sqlite3",
        framework: "ultimate-express",
      });
      assert.ok(ueDeps.dependencies["ultimate-express"]);
      assert.ok(ueDeps.dependencies["better-sqlite3"]);

      const scripts = getScripts("postgres");
      assert.ok(scripts.start);
      assert.ok(scripts.migrate);
      assert.ok(scripts.add_migration);
    });

    it("generators.js produces all project boilerplate files", function () {
      const config = {
        database: "sqlite3",
        framework: "express",
        session: "database",
        cache: "memory",
        logger: "pino",
        port: 3000,
        appName: "test-app",
        jwtSecret: "secret",
      };

      assert.ok(initGens.generateAppJs(config).includes("express"));
      assert.ok(initGens.generateEnvFile(config).includes("PORT=3000"));
      assert.ok(initGens.generateEnvExample(config).includes("PORT="));
      assert.ok(initGens.generateLoggerMiddleware(config).includes("winston"));
      assert.ok(initGens.generateGitignore().includes("node_modules"));
      assert.ok(initGens.generateDockerfile().includes("FROM node:alpine"));
      assert.ok(initGens.generateDockerignore().includes(".git"));
      assert.ok(initGens.generateSessionJs(config).includes("session"));
      assert.ok(initGens.generateSecurityJs(config).includes("helmet"));
      assert.ok(initGens.generateHealthRoute().includes("/health"));
      assert.ok(initGens.generateRouteIndexFile(config).includes("router"));
      assert.ok(initGens.generateDockerCompose({ database: "postgres" }, { dbPass: "pass" }).includes("services:"));
      assert.ok(initGens.generateGrafanaDatasources(config).includes("datasources:"));
      assert.ok(initGens.generateDbModule({ database: "sqlite3" }).includes("sqlite3"));
    });

    it("generate-route produces valid route and test code", function () {
      assert.ok(generateRouteFile("posts").includes("route(posts"));
      assert.ok(
        generateParentRouteFile("users", [{ child: "posts", foreignKey: "user_id" }]).includes("postsRoute"),
      );
      assert.ok(generateChildRouteFile("posts", "user_id").includes("user_id"));
      assert.ok(generateRoutesIndexFile(["posts", "users"]).includes("router"));
      assert.ok(generateTestFile("posts", { title: "required|string" }).includes("describe"));
      assert.ok(
        generateChildTestFile("posts", "users", "user_id", { title: "required|string" }).includes("describe"),
      );
    });

    it("generate-model introspects MySQL, Postgres, MSSQL, Oracle, CockroachDB and generates code", async function () {
      const mockMysql = {
        query: async (sql) => {
          if (sql.includes("SHOW TABLES")) return [{ t: "users" }];
          if (sql.includes("SHOW COLUMNS")) return [
            { Field: "id", Key: "PRI", Type: "int", Null: "NO", Extra: "auto_increment" },
            { Field: "name", Key: "", Type: "varchar(255)", Null: "NO", Extra: "" },
            { Field: "created_at", Key: "", Type: "datetime", Null: "YES", Extra: "" },
            { Field: "is_deleted", Key: "", Type: "tinyint(1)", Null: "YES", Extra: "" },
          ];
          if (sql.includes("SHOW INDEX")) return [{ Key_name: "PRIMARY", Column_name: "id", Non_unique: 0 }];
          return [];
        },
      };
      const myModels = await modelGens.introspectMySQL(mockMysql);
      assert.strictEqual(myModels.length, 1);
      assert.strictEqual(myModels[0].table, "users");

      const mockPg = {
        query: async (sql) => {
          if (sql.includes("FROM pg_tables")) return [{ tablename: "accounts" }];
          if (sql.includes("FROM information_schema.columns")) return [
            { column_name: "id", data_type: "integer", is_nullable: "NO", column_default: "nextval('seq')" },
            { column_name: "balance", data_type: "numeric", is_nullable: "NO", column_default: null },
            { column_name: "updated_at", data_type: "timestamp", is_nullable: "YES", column_default: null },
          ];
          if (sql.includes("FROM information_schema.table_constraints")) return [{ column_name: "id" }];
          if (sql.includes("FROM pg_index")) return [];
          return [];
        },
      };
      const pgModels = await modelGens.introspectPostgres(mockPg);
      assert.strictEqual(pgModels.length, 1);
      assert.strictEqual(pgModels[0].table, "accounts");

      const crModels = await modelGens.introspectCockroachDB(mockPg);
      assert.strictEqual(crModels.length, 1);

      const mockMssql = {
        query: async (sql) => {
          if (sql.includes("FROM INFORMATION_SCHEMA.TABLES")) return [{ TABLE_NAME: "orders" }];
          if (sql.includes("FROM INFORMATION_SCHEMA.COLUMNS")) return [
            { COLUMN_NAME: "id", DATA_TYPE: "int", IS_NULLABLE: "NO", COLUMN_DEFAULT: null },
            { COLUMN_NAME: "total", DATA_TYPE: "decimal", IS_NULLABLE: "NO", COLUMN_DEFAULT: null },
          ];
          if (sql.includes("FROM sys.indexes")) return [{ column_name: "id" }];
          return [];
        },
      };
      const msModels = await modelGens.introspectMSSQL(mockMssql);
      assert.strictEqual(msModels.length, 1);

      const mockOra = {
        query: async (sql) => {
          if (sql.includes("FROM user_tables")) return [{ TABLE_NAME: "INVOICES" }];
          if (sql.includes("FROM user_tab_cols")) return [
            { COLUMN_NAME: "ID", DATA_TYPE: "NUMBER", NULLABLE: "N", DATA_DEFAULT: null },
            { COLUMN_NAME: "AMOUNT", DATA_TYPE: "NUMBER", NULLABLE: "Y", DATA_DEFAULT: null },
          ];
          if (sql.includes("FROM user_constraints")) return [{ COLUMN_NAME: "ID" }];
          return [];
        },
      };
      const oraModels = await modelGens.introspectOracle(mockOra);
      assert.strictEqual(oraModels.length, 1);

      // generateModelFile & generateIndexFile
      const code = modelGens.generateModelFile(myModels[0]);
      assert.ok(code.includes("import dbModelRouter"));
      assert.ok(code.includes("model("));
      const indexCode = modelGens.generateIndexFile(myModels);
      assert.ok(indexCode.includes("users"));
    });
  });
});
