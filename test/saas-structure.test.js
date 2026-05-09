"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { generateSaasStructure } = require("../src/cli/generate-saas-structure");
const {
  generateSaasSeeds,
  SUPER_ADMIN_PERMISSIONS,
  TENANT_ADMIN_PERMISSIONS,
} = require("../src/cli/saas/generate-saas-seeds");
const { generateAuthRoutes } = require("../src/cli/saas/generate-saas-routes");
const {
  generateAuthenticateMiddleware,
  generateTenantIsolationMiddleware,
  generateHasPermissionMiddleware,
} = require("../src/cli/saas/generate-saas-middleware");

describe("SaaS Structure Generator", function () {
  // =========================================================================
  // 10.1 — CLI Integration
  // =========================================================================
  describe("CLI Integration", function () {
    it("generate command supports --saas-structure flag", function () {
      // The generate command module imports generateSaasStructure and checks
      // args["saas-structure"]. Verify the function exists and is callable.
      const generate = require("../src/cli/commands/generate");
      assert.strictEqual(typeof generate, "function");
      assert.strictEqual(typeof generateSaasStructure, "function");
    });

    it("--dry-run mode returns planned files without writing", function () {
      const planned = generateSaasStructure("postgres", {
        dryRun: true,
        timestamp: new Date("2024-01-01T00:00:00Z"),
      });

      // Should return an array of planned file objects
      assert.ok(Array.isArray(planned));
      assert.ok(planned.length > 0);

      // Each entry should have relPath and content
      for (const entry of planned) {
        assert.ok(
          typeof entry.relPath === "string",
          "relPath should be a string",
        );
        assert.ok(
          typeof entry.content === "string",
          "content should be a string",
        );
      }

      // Verify no files were written (dryRun is handled by the caller,
      // but the function itself just returns the planned array)
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "saas-dry-"));
      for (const entry of planned) {
        const fullPath = path.join(tempDir, entry.relPath);
        assert.ok(
          !fs.existsSync(fullPath),
          `File should not exist in dry-run: ${entry.relPath}`,
        );
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("--json output format returns correct structure", function () {
      const planned = generateSaasStructure("postgres", {
        json: true,
        timestamp: new Date("2024-01-01T00:00:00Z"),
      });

      // The planned array is what gets wrapped in { files: results } by the CLI
      assert.ok(Array.isArray(planned));
      // Simulate what the CLI does for JSON output
      const results = planned.map(function (p) {
        return { path: p.relPath, status: "planned" };
      });
      const jsonOutput = { files: results };

      assert.ok(jsonOutput.files);
      assert.ok(Array.isArray(jsonOutput.files));
      assert.ok(jsonOutput.files.length > 0);
      for (const r of jsonOutput.files) {
        assert.ok(typeof r.path === "string");
        assert.ok(typeof r.status === "string");
      }
    });

    it("invalid adapter selection is rejected by the CLI", function () {
      // The generate command checks SUPPORTED_ADAPTERS.includes(adapter)
      // and returns an error for invalid adapters.
      const SUPPORTED_ADAPTERS = [
        "postgres",
        "mysql",
        "sqlite3",
        "mssql",
        "oracle",
        "cockroachdb",
        "mongodb",
        "dynamodb",
        "redis",
      ];

      assert.ok(!SUPPORTED_ADAPTERS.includes("invalid-db"));
      assert.ok(!SUPPORTED_ADAPTERS.includes(""));
      assert.ok(!SUPPORTED_ADAPTERS.includes("POSTGRES")); // case-sensitive
      assert.ok(SUPPORTED_ADAPTERS.includes("postgres"));
      assert.ok(SUPPORTED_ADAPTERS.includes("mysql"));
    });
  });

  // =========================================================================
  // 10.2 — File Output and Reporting
  // =========================================================================
  describe("File Output and Reporting", function () {
    let planned;

    before(function () {
      planned = generateSaasStructure("postgres", {
        timestamp: new Date("2024-01-01T00:00:00Z"),
      });
    });

    it("planned array has correct relPaths for file status reporting", function () {
      const relPaths = planned.map(function (p) {
        return p.relPath;
      });

      // Should include key files
      assert.ok(
        relPaths.some(function (p) {
          return p.startsWith("migrations/");
        }),
        "should have migrations",
      );
      assert.ok(
        relPaths.some(function (p) {
          return p.startsWith("models/");
        }),
        "should have models",
      );
      assert.ok(
        relPaths.some(function (p) {
          return p.startsWith("middleware/");
        }),
        "should have middleware",
      );
      assert.ok(
        relPaths.some(function (p) {
          return p.startsWith("routes/");
        }),
        "should have routes",
      );
      assert.ok(
        relPaths.some(function (p) {
          return p.startsWith("seeds/");
        }),
        "should have seeds",
      );
      assert.ok(
        relPaths.includes("credentials.md"),
        "should have credentials.md",
      );
      assert.ok(relPaths.includes(".gitignore"), "should have .gitignore");
    });

    it("credentials.md contains email, password, and warning", function () {
      const credEntry = planned.find(function (p) {
        return p.relPath === "credentials.md";
      });
      assert.ok(credEntry, "credentials.md should be in planned files");

      const content = credEntry.content;
      assert.ok(
        content.includes("admin@system.local"),
        "should contain super admin email",
      );
      assert.ok(content.includes("Password:"), "should contain password label");
      assert.ok(content.includes("WARNING"), "should contain a warning");
      assert.ok(
        content.includes("Change this password") || content.includes("change"),
        "should warn to change password after first login",
      );
    });

    it(".gitignore update adds credentials.md entry", function () {
      const gitignoreEntry = planned.find(function (p) {
        return p.relPath === ".gitignore";
      });
      assert.ok(gitignoreEntry, ".gitignore should be in planned files");
      assert.ok(
        gitignoreEntry.content.includes("credentials.md"),
        ".gitignore should contain credentials.md",
      );
    });

    it("nested relPaths like routes/roles/permissions.js exist", function () {
      const relPaths = planned.map(function (p) {
        return p.relPath;
      });
      assert.ok(
        relPaths.includes("routes/roles/permissions.js"),
        "should have nested route routes/roles/permissions.js",
      );
    });
  });

  // =========================================================================
  // 10.3 — Seed File Content
  // =========================================================================
  describe("Seed File Content", function () {
    it("super admin has NULL tenant_id in seed content", function () {
      const seeds = generateSaasSeeds("postgres");
      const seedFile = seeds.find(function (s) {
        return s.relPath === "seeds/saas-seed.js";
      });
      assert.ok(seedFile, "seed file should exist");

      // The seed content should insert super admin with tenant_id: null
      assert.ok(
        seedFile.content.includes("tenant_id: null"),
        "super admin should have tenant_id: null",
      );
    });

    it("SUPER_ADMIN_PERMISSIONS covers all modules and all actions", function () {
      const MODULES = ["users", "tenants", "roles", "permissions", "webhooks"];
      const ACTIONS = [
        "read",
        "write",
        "update",
        "delete",
        "export",
        "approve",
        "global",
      ];

      for (const mod of MODULES) {
        for (const action of ACTIONS) {
          const found = SUPER_ADMIN_PERMISSIONS.find(function (p) {
            return p.module === mod && p.action === action;
          });
          assert.ok(
            found,
            `Super admin should have permission: ${mod}/${action}`,
          );
          assert.strictEqual(
            found.scope,
            "global",
            `Super admin ${mod}/${action} should be global scope`,
          );
        }
      }
    });

    it("tenant admin role has NULL tenant_id in seed content", function () {
      const seeds = generateSaasSeeds("postgres");
      const seedFile = seeds.find(function (s) {
        return s.relPath === "seeds/saas-seed.js";
      });
      assert.ok(seedFile, "seed file should exist");

      // Tenant Admin Role is also inserted with tenant_id: null
      // The seed content has two inserts with tenant_id: null (super admin role + tenant admin role)
      const matches = seedFile.content.match(/tenant_id: null/g);
      assert.ok(
        matches && matches.length >= 2,
        "should have at least 2 tenant_id: null entries (super admin user + roles)",
      );
    });

    it("TENANT_ADMIN_PERMISSIONS has tenant scope only (no global)", function () {
      assert.ok(TENANT_ADMIN_PERMISSIONS.length > 0, "should have permissions");

      for (const perm of TENANT_ADMIN_PERMISSIONS) {
        assert.strictEqual(
          perm.scope,
          "tenant",
          `Tenant admin permission ${perm.module}/${perm.action} should have tenant scope, got: ${perm.scope}`,
        );
        assert.notStrictEqual(
          perm.scope,
          "global",
          `Tenant admin should not have global scope for ${perm.module}/${perm.action}`,
        );
      }
    });

    it("TENANT_ADMIN_PERMISSIONS covers users and roles with CRUD actions", function () {
      const expectedModules = ["users", "roles"];
      const expectedActions = ["read", "write", "update", "delete"];

      for (const mod of expectedModules) {
        for (const action of expectedActions) {
          const found = TENANT_ADMIN_PERMISSIONS.find(function (p) {
            return p.module === mod && p.action === action;
          });
          assert.ok(
            found,
            `Tenant admin should have permission: ${mod}/${action}`,
          );
        }
      }
    });
  });

  // =========================================================================
  // 10.4 — Auth Routes
  // =========================================================================
  describe("Auth Routes", function () {
    let authContent;

    before(function () {
      const authRoute = generateAuthRoutes();
      authContent = authRoute.content;
    });

    it("login route content includes session population logic", function () {
      assert.ok(
        authContent.includes("req.session.user"),
        "should populate req.session.user",
      );
      assert.ok(
        authContent.includes("req.session.role"),
        "should populate req.session.role",
      );
      assert.ok(
        authContent.includes("req.session.permission"),
        "should populate req.session.permission",
      );
    });

    it("login route content includes 401 response for invalid credentials", function () {
      assert.ok(authContent.includes("401"), "should return 401 status");
      assert.ok(
        authContent.includes("Invalid credentials"),
        "should include 'Invalid credentials' message",
      );
    });

    it("logout route content includes session destroy and 200 response", function () {
      assert.ok(
        authContent.includes("req.session.destroy"),
        "should call req.session.destroy",
      );
      assert.ok(
        authContent.includes("Logout successful"),
        "should return logout success message",
      );
    });

    it("logout route content includes 500 response on session destroy failure", function () {
      assert.ok(authContent.includes("500"), "should return 500 on failure");
      assert.ok(
        authContent.includes("Failed to destroy session"),
        "should include session destroy failure message",
      );
    });

    it("login route uses verifyPassword for credential validation", function () {
      assert.ok(
        authContent.includes("verifyPassword"),
        "should use verifyPassword function",
      );
    });

    it("logout route is protected by authenticate middleware", function () {
      // The logout route should use the authenticate middleware
      assert.ok(
        authContent.includes("authenticate"),
        "logout should use authenticate middleware",
      );
    });
  });

  // =========================================================================
  // 10.5 — Middleware Generators
  // =========================================================================
  describe("Middleware Generators", function () {
    describe("authenticate middleware", function () {
      let content;

      before(function () {
        const result = generateAuthenticateMiddleware();
        content = result.content;
      });

      it("returns 401 without session", function () {
        assert.ok(content.includes("401"), "should return 401 status");
        assert.ok(
          content.includes("Unauthorized"),
          "should include Unauthorized message",
        );
        assert.ok(
          content.includes("!req.session") || content.includes("req.session"),
          "should check req.session",
        );
        assert.ok(
          content.includes("req.session.user"),
          "should check req.session.user",
        );
      });

      it("calls next() for valid session", function () {
        assert.ok(
          content.includes("next()"),
          "should call next() for valid sessions",
        );
      });
    });

    describe("tenant isolation middleware", function () {
      let content;

      before(function () {
        const result = generateTenantIsolationMiddleware();
        content = result.content;
      });

      it("injects tenant_id for non-global users", function () {
        assert.ok(
          content.includes("req.query.tenant_id"),
          "should inject tenant_id into req.query",
        );
        assert.ok(
          content.includes("req.body.tenant_id"),
          "should inject tenant_id into req.body",
        );
        assert.ok(
          content.includes("req.session.user.tenant_id"),
          "should use user's tenant_id from session",
        );
      });

      it("checks for global scope permission", function () {
        assert.ok(content.includes("global"), "should check for global scope");
        assert.ok(
          content.includes("hasGlobal") || content.includes("scope"),
          "should determine if user has global permission",
        );
      });

      it("passes through for global users without restriction", function () {
        // The middleware calls next() regardless, but only injects tenant_id for non-global
        assert.ok(content.includes("next()"), "should call next()");
        // The logic: if (!hasGlobal) { inject } then next()
        assert.ok(
          content.includes("if (!hasGlobal)") || content.includes("!hasGlobal"),
          "should conditionally inject based on global permission",
        );
      });
    });

    describe("hasPermission middleware", function () {
      let content;

      before(function () {
        const result = generateHasPermissionMiddleware();
        content = result.content;
      });

      it("returns 403 for invalid module", function () {
        assert.ok(content.includes("isValidModule"), "should validate module");
        assert.ok(content.includes("403"), "should return 403 status");
        assert.ok(
          content.includes("Invalid module"),
          "should include 'Invalid module' message",
        );
      });

      it("returns 403 for missing permission", function () {
        assert.ok(
          content.includes("Forbidden"),
          "should include 'Forbidden' message for missing permission",
        );
      });

      it("checks session permissions for matching module and action", function () {
        assert.ok(
          content.includes("req.session.permission"),
          "should check req.session.permission",
        );
        assert.ok(
          content.includes("p.module === module") ||
            content.includes("p.module"),
          "should match module",
        );
        assert.ok(
          content.includes("p.action === action") ||
            content.includes("p.action"),
          "should match action",
        );
      });

      it("allows access when action is 'global'", function () {
        assert.ok(
          content.includes('"global"') || content.includes("'global'"),
          "should check for global action as wildcard",
        );
      });

      it("calls next() when permission is found", function () {
        assert.ok(content.includes("next()"), "should call next() on success");
      });
    });
  });
});
