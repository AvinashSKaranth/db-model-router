"use strict";

const assert = require("assert");
const {
  generateLoginTemplate,
  generateDbManagerAuthMiddleware,
  generateManagerTemplate,
  generateDbManagerRoute,
  appendDbManagerEnv,
  appendDbManagerEnvExample,
  addEjsDependency,
  addDbManagerToAppJs,
  generateDbManager,
  SQL_ADAPTERS,
} = require("../../src/cli/generate-db-manager");

describe("DB Manager Generator (src/cli/generate-db-manager.js)", function () {
  // -------------------------------------------------------------------
  // generateLoginTemplate() — Requirements: 2.2, 3.2, 3.4, 3.6
  // -------------------------------------------------------------------
  describe("generateLoginTemplate()", function () {
    it("should return a valid HTML5 document with doctype, head, and body", function () {
      const html = generateLoginTemplate();
      assert.ok(html.includes("<!DOCTYPE html>"), "Should have HTML5 doctype");
      assert.ok(html.includes("<head>"), "Should have head element");
      assert.ok(html.includes("<body>"), "Should have body element");
      assert.ok(html.includes("</html>"), "Should close html element");
    });

    it("should include dark theme inline styles (Req 2.2)", function () {
      const html = generateLoginTemplate();
      assert.ok(html.includes("<style>"), "Should have inline style block");
      assert.ok(html.includes("</style>"), "Should close style block");
      // Dark theme: dark background color
      assert.ok(
        html.includes("#1a1a2e") ||
          html.includes("#16213e") ||
          html.includes("background"),
        "Should have dark background colors",
      );
    });

    it("should contain a password input field and submit button (Req 3.2)", function () {
      const html = generateLoginTemplate();
      assert.ok(
        html.includes('type="password"'),
        "Should have a password input",
      );
      assert.ok(
        html.includes('type="submit"') || html.includes("<button"),
        "Should have a submit button",
      );
    });

    it("should have a form that POSTs to /database/login (Req 3.2)", function () {
      const html = generateLoginTemplate();
      assert.ok(html.includes('method="POST"'), "Form should use POST method");
      assert.ok(
        html.includes('action="/database/login"'),
        "Form should POST to /database/login",
      );
    });

    it("should display error message when locals.error is set (Req 3.4)", function () {
      const html = generateLoginTemplate();
      assert.ok(html.includes("locals.error"), "Should check locals.error");
      assert.ok(
        html.includes("<%= error %>") || html.includes("<%= locals.error %>"),
        "Should display the error message",
      );
    });

    it("should display 503 message when locals.notConfigured is set (Req 3.6)", function () {
      const html = generateLoginTemplate();
      assert.ok(
        html.includes("locals.notConfigured"),
        "Should check locals.notConfigured",
      );
      assert.ok(
        html.includes("503") || html.includes("not configured"),
        "Should display a 503 / not configured message",
      );
    });

    it("should produce identical output on repeated calls", function () {
      const html1 = generateLoginTemplate();
      const html2 = generateLoginTemplate();
      assert.strictEqual(html1, html2, "Should be deterministic");
    });

    it("should produce non-empty content", function () {
      const html = generateLoginTemplate();
      assert.ok(html.length > 0, "Should not be empty");
    });
  });

  // -------------------------------------------------------------------
  // generateDbManagerAuthMiddleware() — Requirements: 2.1, 3.5
  // -------------------------------------------------------------------
  describe("generateDbManagerAuthMiddleware()", function () {
    it('should contain a session check for req.session["db-manager"]', function () {
      const content = generateDbManagerAuthMiddleware();
      assert.ok(
        content.includes('req.session["db-manager"]'),
        'Should check req.session["db-manager"]',
      );
    });

    it("should redirect unauthenticated users to /database/login", function () {
      const content = generateDbManagerAuthMiddleware();
      assert.ok(
        content.includes("/database/login"),
        "Should redirect to /database/login",
      );
      assert.ok(content.includes("res.redirect"), "Should use res.redirect()");
    });

    it("should use ES module export default syntax", function () {
      const content = generateDbManagerAuthMiddleware();
      assert.ok(
        content.includes("export default"),
        "Should use export default",
      );
    });

    it("should call next() when authenticated", function () {
      const content = generateDbManagerAuthMiddleware();
      assert.ok(
        content.includes("next()"),
        "Should call next() for authenticated users",
      );
    });

    it("should produce identical output on repeated calls", function () {
      const a = generateDbManagerAuthMiddleware();
      const b = generateDbManagerAuthMiddleware();
      assert.strictEqual(a, b, "Should be deterministic");
    });
  });

  // -------------------------------------------------------------------
  // generateManagerTemplate() — Requirements: 2.2, 4.1, 4.3, 5.1, 6.7,
  //   7.1, 10.1, 11.1, 11.2, 12.1, 13.1
  // -------------------------------------------------------------------
  describe("generateManagerTemplate()", function () {
    it("should return a valid HTML5 document", function () {
      const html = generateManagerTemplate();
      assert.ok(html.includes("<!DOCTYPE html>"), "Should have HTML5 doctype");
      assert.ok(html.includes("<head>"), "Should have head element");
      assert.ok(html.includes("<body>"), "Should have body element");
      assert.ok(html.includes("</html>"), "Should close html element");
    });

    it("should include dark theme inline styles (Req 2.2)", function () {
      const html = generateManagerTemplate();
      assert.ok(html.includes("<style>"), "Should have inline style block");
      assert.ok(
        html.includes("#1a1a2e") || html.includes("#16213e"),
        "Should have dark background colors",
      );
    });

    it("should contain a sidebar with table list and search input (Req 4.1, 4.3)", function () {
      const html = generateManagerTemplate();
      assert.ok(html.includes("sidebar"), "Should have sidebar element");
      assert.ok(html.includes("tableList"), "Should have table list element");
      assert.ok(
        html.includes("tableSearch") || html.includes("Search tables"),
        "Should have table search input",
      );
    });

    it("should contain three tabs: Structure, Data, Query (Req 5.1, 6.7, 7.1)", function () {
      const html = generateManagerTemplate();
      assert.ok(
        html.includes('data-tab="structure"') ||
          html.includes('data-tab="structure"'),
        "Should have Structure tab",
      );
      assert.ok(
        html.includes('data-tab="data"') || html.includes('data-tab="data"'),
        "Should have Data tab",
      );
      assert.ok(
        html.includes('data-tab="query"') || html.includes('data-tab="query"'),
        "Should have Query tab",
      );
    });

    it("should use fetch calls to /database/* endpoints", function () {
      const html = generateManagerTemplate();
      assert.ok(
        html.includes('"/database/tables"') ||
          html.includes("/database/tables"),
        "Should fetch /database/tables",
      );
      assert.ok(
        html.includes('"/database/query"') || html.includes("/database/query"),
        "Should fetch /database/query",
      );
    });

    it("should contain a CSV download button (Req 10.1)", function () {
      const html = generateManagerTemplate();
      assert.ok(
        html.includes("downloadCsvBtn") || html.includes("Download CSV"),
        "Should have CSV download button",
      );
      assert.ok(html.includes("/csv"), "Should reference the CSV endpoint");
    });

    it("should contain a delete button (Req 11.1, 11.2)", function () {
      const html = generateManagerTemplate();
      assert.ok(
        html.includes("deleteSelectedBtn") || html.includes("Delete Selected"),
        "Should have delete selected button",
      );
    });

    it("should contain edit controls (Req 12.1)", function () {
      const html = generateManagerTemplate();
      assert.ok(
        html.includes("edit-btn") || html.includes("Edit"),
        "Should have edit button",
      );
      assert.ok(
        html.includes("Save") && html.includes("Cancel"),
        "Should have Save and Cancel buttons for inline editing",
      );
    });

    it("should contain an add row form (Req 13.1)", function () {
      const html = generateManagerTemplate();
      assert.ok(
        html.includes("addRowBtn") || html.includes("Add Row"),
        "Should have Add Row button",
      );
      assert.ok(
        html.includes("addRowForm") || html.includes("add-row-form"),
        "Should have add row form element",
      );
    });

    it("should produce identical output on repeated calls", function () {
      const a = generateManagerTemplate();
      const b = generateManagerTemplate();
      assert.strictEqual(a, b, "Should be deterministic");
    });

    it("should produce non-empty content", function () {
      const html = generateManagerTemplate();
      assert.ok(html.length > 0, "Should not be empty");
    });
  });

  // -------------------------------------------------------------------
  // generateDbManagerRoute() — Requirements: 3.1, 3.3, 3.4, 3.6, 4.2,
  //   5.2, 6.2–6.6, 7.2, 7.4, 8.3, 10.2, 10.3, 11.4, 11.5, 12.4, 12.5,
  //   13.5, 13.6
  // -------------------------------------------------------------------
  describe("generateDbManagerRoute()", function () {
    it("should import express and create a Router", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes('import express from "express"'),
        "Should import express",
      );
      assert.ok(route.includes("express.Router()"), "Should create a Router");
    });

    it("should import the auth middleware (Req 3.5)", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes(
          'import dbManagerAuth from "../middleware/db-manager-auth.js"',
        ),
        "Should import dbManagerAuth middleware",
      );
    });

    it("should apply auth middleware with router.use (Req 3.5)", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes("router.use(dbManagerAuth)"),
        "Should apply auth middleware to protected routes",
      );
    });

    it("should contain all endpoint paths", function () {
      const route = generateDbManagerRoute();
      // Login endpoints
      assert.ok(
        route.includes('router.get("/login"'),
        "Should have GET /login",
      );
      assert.ok(
        route.includes('router.post("/login"'),
        "Should have POST /login",
      );
      // Manager page
      assert.ok(route.includes('router.get("/",'), "Should have GET /");
      // Tables endpoints
      assert.ok(
        route.includes('router.get("/tables"'),
        "Should have GET /tables",
      );
      assert.ok(
        route.includes('router.get("/tables/:table_name"'),
        "Should have GET /tables/:table_name",
      );
      assert.ok(
        route.includes('router.get("/tables/:table_name/csv"'),
        "Should have GET /tables/:table_name/csv",
      );
      assert.ok(
        route.includes('router.delete("/tables/:table_name"'),
        "Should have DELETE /tables/:table_name",
      );
      assert.ok(
        route.includes('router.put("/tables/:table_name/:id"'),
        "Should have PUT /tables/:table_name/:id",
      );
      assert.ok(
        route.includes('router.post("/tables/:table_name"'),
        "Should have POST /tables/:table_name",
      );
      // Query endpoint
      assert.ok(
        route.includes('router.post("/query"'),
        "Should have POST /query",
      );
    });

    it("should use global.db for database operations (Req 8.3)", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes("global.db.query"),
        "Should use global.db.query()",
      );
    });

    it("should check DATABASE_MANAGER_PASSWORD for login (Req 3.3, 3.6)", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes("process.env.DATABASE_MANAGER_PASSWORD"),
        "Should check DATABASE_MANAGER_PASSWORD env var",
      );
    });

    it("should set session on successful login (Req 3.3)", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes('req.session["db-manager"] = true'),
        'Should set req.session["db-manager"] = true on login',
      );
    });

    it("should respond with 503 when password is not configured (Req 3.6)", function () {
      const route = generateDbManagerRoute();
      assert.ok(route.includes("503"), "Should return 503 status");
    });

    it("should set CSV Content-Type and Content-Disposition headers (Req 10.2)", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes("text/csv"),
        "Should set Content-Type to text/csv",
      );
      assert.ok(
        route.includes("Content-Disposition"),
        "Should set Content-Disposition header",
      );
    });

    it("should export default router as ES module", function () {
      const route = generateDbManagerRoute();
      assert.ok(
        route.includes("export default router"),
        "Should export default router",
      );
    });

    it("should produce identical output on repeated calls", function () {
      const a = generateDbManagerRoute();
      const b = generateDbManagerRoute();
      assert.strictEqual(a, b, "Should be deterministic");
    });
  });

  // -------------------------------------------------------------------
  // appendDbManagerEnv() — Requirement: 2.3
  // -------------------------------------------------------------------
  describe("appendDbManagerEnv()", function () {
    it("should append DATABASE_MANAGER_PASSWORD=admin to existing env content", function () {
      const existing = "PORT=3000\nDB_HOST=localhost\n";
      const result = appendDbManagerEnv(existing);
      assert.ok(
        result.includes("DATABASE_MANAGER_PASSWORD=admin"),
        "Should contain DATABASE_MANAGER_PASSWORD=admin",
      );
    });

    it("should add a '# DB Manager' comment header before the variable", function () {
      const existing = "PORT=3000\n";
      const result = appendDbManagerEnv(existing);
      assert.ok(
        result.includes("# DB Manager"),
        "Should have a comment header",
      );
      const commentIdx = result.indexOf("# DB Manager");
      const varIdx = result.indexOf("DATABASE_MANAGER_PASSWORD=admin");
      assert.ok(
        commentIdx < varIdx,
        "Comment should appear before the variable",
      );
    });

    it("should preserve existing env content", function () {
      const existing = "PORT=3000\nDB_HOST=localhost\n";
      const result = appendDbManagerEnv(existing);
      assert.ok(result.includes("PORT=3000"), "Should preserve PORT");
      assert.ok(
        result.includes("DB_HOST=localhost"),
        "Should preserve DB_HOST",
      );
    });
  });

  // -------------------------------------------------------------------
  // appendDbManagerEnvExample() — Requirement: 2.4
  // -------------------------------------------------------------------
  describe("appendDbManagerEnvExample()", function () {
    it("should append DATABASE_MANAGER_PASSWORD=your_db_manager_password to existing env example", function () {
      const existing = "PORT=3000\nDB_HOST=localhost\n";
      const result = appendDbManagerEnvExample(existing);
      assert.ok(
        result.includes("DATABASE_MANAGER_PASSWORD=your_db_manager_password"),
        "Should contain DATABASE_MANAGER_PASSWORD=your_db_manager_password",
      );
    });

    it("should add a '# DB Manager' comment header before the variable", function () {
      const existing = "PORT=3000\n";
      const result = appendDbManagerEnvExample(existing);
      assert.ok(
        result.includes("# DB Manager"),
        "Should have a comment header",
      );
      const commentIdx = result.indexOf("# DB Manager");
      const varIdx = result.indexOf(
        "DATABASE_MANAGER_PASSWORD=your_db_manager_password",
      );
      assert.ok(
        commentIdx < varIdx,
        "Comment should appear before the variable",
      );
    });

    it("should preserve existing env example content", function () {
      const existing = "PORT=3000\nDB_HOST=localhost\n";
      const result = appendDbManagerEnvExample(existing);
      assert.ok(result.includes("PORT=3000"), "Should preserve PORT");
      assert.ok(
        result.includes("DB_HOST=localhost"),
        "Should preserve DB_HOST",
      );
    });
  });

  // -------------------------------------------------------------------
  // addEjsDependency() — Requirement: 2.5
  // -------------------------------------------------------------------
  describe("addEjsDependency()", function () {
    it("should add ejs to dependencies in parsed JSON", function () {
      const pkgJson = JSON.stringify(
        { name: "test", dependencies: { express: "^4.18.0" } },
        null,
        2,
      );
      const result = addEjsDependency(pkgJson);
      const parsed = JSON.parse(result);
      assert.ok(parsed.dependencies.ejs, "Should have ejs in dependencies");
    });

    it("should preserve existing dependencies", function () {
      const pkgJson = JSON.stringify(
        { name: "test", dependencies: { express: "^4.18.0" } },
        null,
        2,
      );
      const result = addEjsDependency(pkgJson);
      const parsed = JSON.parse(result);
      assert.strictEqual(
        parsed.dependencies.express,
        "^4.18.0",
        "Should preserve express dependency",
      );
    });

    it("should create dependencies object if it does not exist", function () {
      const pkgJson = JSON.stringify({ name: "test" }, null, 2);
      const result = addEjsDependency(pkgJson);
      const parsed = JSON.parse(result);
      assert.ok(parsed.dependencies, "Should create dependencies object");
      assert.ok(parsed.dependencies.ejs, "Should have ejs in new dependencies");
    });

    it("should return valid JSON", function () {
      const pkgJson = JSON.stringify(
        { name: "test", dependencies: {} },
        null,
        2,
      );
      const result = addEjsDependency(pkgJson);
      assert.doesNotThrow(() => JSON.parse(result), "Should return valid JSON");
    });
  });

  // -------------------------------------------------------------------
  // addDbManagerToAppJs() — Requirements: 2.6, 2.7, 9.1, 9.2
  // -------------------------------------------------------------------
  describe("addDbManagerToAppJs()", function () {
    const sampleAppJs = `import express from "express";
import "./commons/db.js";
import configureSession from "./commons/session.js";
import applySecurity from "./commons/security.js";
import logger from "./middleware/logger.js";
import route from "./routes/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

applySecurity(app);
app.use(configureSession());
app.use(logger);
app.use(route);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ type: "danger", message: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

export default app;
`;

    it("should inject 'import path from \"path\"' (Req 9.1)", function () {
      const result = addDbManagerToAppJs(sampleAppJs);
      assert.ok(
        result.includes('import path from "path"'),
        'Should add import path from "path"',
      );
    });

    it("should inject the dbManagerRoute import (Req 9.2)", function () {
      const result = addDbManagerToAppJs(sampleAppJs);
      assert.ok(
        result.includes('import dbManagerRoute from "./routes/database.js"'),
        "Should add dbManagerRoute import",
      );
    });

    it("should inject view engine config (Req 9.1)", function () {
      const result = addDbManagerToAppJs(sampleAppJs);
      assert.ok(
        result.includes('app.set("view engine", "ejs")'),
        "Should set view engine to ejs",
      );
      assert.ok(
        result.includes('app.set("views", path.join(__dirname, "views"))'),
        "Should set views directory",
      );
    });

    it("should inject route mount before the error handler (Req 9.2)", function () {
      const result = addDbManagerToAppJs(sampleAppJs);
      assert.ok(
        result.includes('app.use("/database", dbManagerRoute)'),
        "Should mount dbManagerRoute at /database",
      );
      const mountIdx = result.indexOf('app.use("/database", dbManagerRoute)');
      const errorIdx = result.indexOf("app.use((err, req, res, next)");
      assert.ok(
        mountIdx < errorIdx,
        "Route mount should appear before error handler",
      );
    });

    it("should preserve existing app.js content", function () {
      const result = addDbManagerToAppJs(sampleAppJs);
      assert.ok(
        result.includes('import express from "express"'),
        "Should preserve express import",
      );
      assert.ok(
        result.includes("app.use(express.json())"),
        "Should preserve middleware",
      );
      assert.ok(
        result.includes("export default app"),
        "Should preserve default export",
      );
    });

    it("should not duplicate path import if already present", function () {
      const appWithPath = 'import path from "path";\n' + sampleAppJs;
      const result = addDbManagerToAppJs(appWithPath);
      const matches = result.match(/import path from "path"/g);
      assert.strictEqual(matches.length, 1, "Should not duplicate path import");
    });
  });

  // -------------------------------------------------------------------
  // generateDbManager() integration — Requirements: 2.1, 8.1, 8.2
  // -------------------------------------------------------------------
  describe("generateDbManager()", function () {
    var CORE_REL_PATHS = [
      "routes/database.js",
      "middleware/db-manager-auth.js",
      "views/db-manager/login.ejs",
      "views/db-manager/manager.ejs",
    ];

    // --- SQL adapter: returns all 4 core template files (Req 2.1, 8.1) ---
    it("should return all 4 core template files with correct relPaths for a SQL adapter", function () {
      var result = generateDbManager({ adapter: "postgres" });
      assert.strictEqual(result.warnings.length, 0, "Should have no warnings");
      assert.ok(result.files.length >= 4, "Should have at least 4 files");

      var relPaths = result.files.map(function (f) {
        return f.relPath;
      });
      CORE_REL_PATHS.forEach(function (expected) {
        assert.ok(relPaths.includes(expected), "Should include " + expected);
      });
    });

    it("should work with every SQL adapter in SQL_ADAPTERS list (Req 8.1)", function () {
      SQL_ADAPTERS.forEach(function (adapter) {
        var result = generateDbManager({ adapter: adapter });
        assert.strictEqual(
          result.warnings.length,
          0,
          "Should have no warnings for " + adapter,
        );
        assert.ok(
          result.files.length >= 4,
          "Should have at least 4 files for " + adapter,
        );
      });
    });

    it("should return non-empty content for each core template file", function () {
      var result = generateDbManager({ adapter: "mysql" });
      result.files.forEach(function (f) {
        assert.ok(
          f.content && f.content.length > 0,
          "File " + f.relPath + " should have non-empty content",
        );
      });
    });

    // --- NoSQL adapter: empty files and warning (Req 8.2) ---
    it("should return empty files array and a warning for mongodb (NoSQL)", function () {
      var result = generateDbManager({ adapter: "mongodb" });
      assert.strictEqual(result.files.length, 0, "Should have no files");
      assert.strictEqual(result.warnings.length, 1, "Should have one warning");
      assert.ok(
        result.warnings[0].includes("SQL adapter"),
        "Warning should mention SQL adapter",
      );
      assert.ok(
        result.warnings[0].includes("mongodb"),
        "Warning should mention the adapter name",
      );
    });

    it("should return empty files array and a warning for redis (NoSQL)", function () {
      var result = generateDbManager({ adapter: "redis" });
      assert.strictEqual(result.files.length, 0, "Should have no files");
      assert.strictEqual(result.warnings.length, 1, "Should have one warning");
    });

    it("should return empty files array and a warning for dynamodb (NoSQL)", function () {
      var result = generateDbManager({ adapter: "dynamodb" });
      assert.strictEqual(result.files.length, 0, "Should have no files");
      assert.strictEqual(result.warnings.length, 1, "Should have one warning");
    });

    // --- Without options: only 4 core files (Req 2.1) ---
    it("should return only the 4 core template files when no options are provided", function () {
      var result = generateDbManager({ adapter: "sqlite3" });
      assert.strictEqual(result.files.length, 4, "Should have exactly 4 files");
      var relPaths = result.files.map(function (f) {
        return f.relPath;
      });
      CORE_REL_PATHS.forEach(function (expected) {
        assert.ok(relPaths.includes(expected), "Should include " + expected);
      });
    });

    it("should return only the 4 core template files when options is an empty object", function () {
      var result = generateDbManager({ adapter: "postgres" }, {});
      assert.strictEqual(result.files.length, 4, "Should have exactly 4 files");
    });

    // --- With options: env, package.json, app.js modifications included ---
    it("should include .env modification when envContent option is provided", function () {
      var result = generateDbManager(
        { adapter: "postgres" },
        { envContent: "PORT=3000\n" },
      );
      var envFile = result.files.find(function (f) {
        return f.relPath === ".env";
      });
      assert.ok(envFile, "Should include .env file");
      assert.ok(
        envFile.content.includes("DATABASE_MANAGER_PASSWORD"),
        ".env should contain DATABASE_MANAGER_PASSWORD",
      );
    });

    it("should include .env.example modification when envExampleContent option is provided", function () {
      var result = generateDbManager(
        { adapter: "postgres" },
        { envExampleContent: "PORT=3000\n" },
      );
      var envExFile = result.files.find(function (f) {
        return f.relPath === ".env.example";
      });
      assert.ok(envExFile, "Should include .env.example file");
      assert.ok(
        envExFile.content.includes("DATABASE_MANAGER_PASSWORD"),
        ".env.example should contain DATABASE_MANAGER_PASSWORD",
      );
    });

    it("should include package.json modification when packageJsonContent option is provided", function () {
      var pkgJson = JSON.stringify(
        { name: "test", dependencies: { express: "^4.18.0" } },
        null,
        2,
      );
      var result = generateDbManager(
        { adapter: "postgres" },
        { packageJsonContent: pkgJson },
      );
      var pkgFile = result.files.find(function (f) {
        return f.relPath === "package.json";
      });
      assert.ok(pkgFile, "Should include package.json file");
      var parsed = JSON.parse(pkgFile.content);
      assert.ok(
        parsed.dependencies.ejs,
        "package.json should have ejs dependency",
      );
    });

    it("should include app.js modification when appJsContent option is provided", function () {
      var appJs =
        'import express from "express";\nconst app = express();\napp.use((err, req, res, next) => {});\nexport default app;\n';
      var result = generateDbManager(
        { adapter: "postgres" },
        { appJsContent: appJs },
      );
      var appFile = result.files.find(function (f) {
        return f.relPath === "app.js";
      });
      assert.ok(appFile, "Should include app.js file");
      assert.ok(
        appFile.content.includes('app.use("/database", dbManagerRoute)'),
        "app.js should mount the database route",
      );
    });

    it("should include all 8 files when all options are provided", function () {
      var pkgJson = JSON.stringify({ name: "test", dependencies: {} }, null, 2);
      var appJs =
        'import express from "express";\nconst app = express();\napp.use((err, req, res, next) => {});\nexport default app;\n';
      var result = generateDbManager(
        { adapter: "mssql" },
        {
          envContent: "PORT=3000\n",
          envExampleContent: "PORT=3000\n",
          packageJsonContent: pkgJson,
          appJsContent: appJs,
        },
      );
      assert.strictEqual(
        result.files.length,
        8,
        "Should have 8 files (4 core + 4 optional)",
      );
      assert.strictEqual(result.warnings.length, 0, "Should have no warnings");

      var relPaths = result.files.map(function (f) {
        return f.relPath;
      });
      assert.ok(relPaths.includes(".env"), "Should include .env");
      assert.ok(
        relPaths.includes(".env.example"),
        "Should include .env.example",
      );
      assert.ok(
        relPaths.includes("package.json"),
        "Should include package.json",
      );
      assert.ok(relPaths.includes("app.js"), "Should include app.js");
    });

    // --- NoSQL with options: still returns empty files ---
    it("should return empty files for NoSQL adapter even when options are provided", function () {
      var result = generateDbManager(
        { adapter: "mongodb" },
        {
          envContent: "PORT=3000\n",
          packageJsonContent: JSON.stringify(
            { name: "test", dependencies: {} },
            null,
            2,
          ),
        },
      );
      assert.strictEqual(
        result.files.length,
        0,
        "Should have no files for NoSQL",
      );
      assert.strictEqual(result.warnings.length, 1, "Should have one warning");
    });
  });
});
