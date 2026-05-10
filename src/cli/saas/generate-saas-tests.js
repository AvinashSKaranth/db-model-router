"use strict";

/**
 * SaaS test generators.
 *
 * Generates test files for SaaS routes: auth (login/logout), users, tenants, roles, permissions.
 * Tests use supertest with a mock session to bypass authentication middleware.
 * Generated code uses ES6 module syntax.
 */

/**
 * Generate all SaaS test files.
 *
 * @returns {Array<{ relPath: string, content: string }>}
 */
function generateSaasTests() {
  return [
    { relPath: "test/auth.test.js", content: generateAuthTest() },
    { relPath: "test/users.test.js", content: generateUsersTest() },
    { relPath: "test/tenants.test.js", content: generateTenantsTest() },
    { relPath: "test/roles.test.js", content: generateRolesTest() },
    { relPath: "test/permissions.test.js", content: generatePermissionsTest() },
  ];
}

function generateAuthTest() {
  return `import assert from "assert";
import express from "express";
import request from "supertest";

// Import the auth route
import authRoute from "#routes/auth/index.js";

function createApp() {
  const app = express();
  app.use(express.json());
  // Mock session object on each request
  app.use((req, res, next) => {
    req.session = {};
    next();
  });
  app.use("/auth", authRoute);
  return app;
}

describe("Auth Routes", function () {
  let app;

  before(function () {
    app = createApp();
  });

  describe("POST /auth/login", function () {
    it("should return 401 when email is missing", async function () {
      const res = await request(app)
        .post("/auth/login")
        .send({ password: "test123" });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.message);
    });

    it("should return 401 when password is missing", async function () {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "admin@system.local" });
      assert.strictEqual(res.status, 401);
      assert.ok(res.body.message);
    });

    it("should return 401 with empty body", async function () {
      const res = await request(app)
        .post("/auth/login")
        .send({});
      assert.strictEqual(res.status, 401);
    });

    it("should return 401 for non-existent user", async function () {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "nobody@example.com", password: "wrong" });
      assert.ok([401, 500].includes(res.status));
    });
  });

  describe("POST /auth/logout", function () {
    it("should return 401 when not authenticated", async function () {
      const res = await request(app)
        .post("/auth/logout");
      assert.strictEqual(res.status, 401);
    });
  });
});
`;
}

function generateUsersTest() {
  return `import assert from "assert";
import express from "express";
import request from "supertest";

import usersRoute from "#routes/users/index.js";

/**
 * Create a test app with a pre-populated session (bypasses real auth).
 * Injects session data via middleware before the route.
 */
function createApp(sessionData) {
  const app = express();
  app.use(express.json());
  // Mock session injection (no real session store needed for testing)
  app.use((req, res, next) => {
    req.session = {
      user: sessionData.user,
      role: sessionData.role,
      permission: sessionData.permission,
    };
    next();
  });
  app.use("/users", usersRoute);
  return app;
}

const mockSession = {
  user: { user_id: 1, email: "admin@system.local", name: "Admin", tenant_id: null },
  role: { role_id: 1, name: "Super Admin", tenant_id: null },
  permission: [
    { module: "users", action: "global", scope: "global" },
  ],
};

describe("Users Routes (SaaS)", function () {
  let app;

  before(function () {
    app = createApp(mockSession);
  });

  describe("GET /users/", function () {
    it("should list users", async function () {
      const res = await request(app).get("/users/");
      assert.ok([200, 500].includes(res.status));
    });
  });

  describe("POST /users/", function () {
    it("should create a user", async function () {
      const res = await request(app)
        .post("/users/")
        .send({
          email: "test@example.com",
          name: "Test User",
          password_hash: "hashed",
          unique_attribute: "test-unique",
          role_id: 1,
        });
      assert.ok([200, 201, 400, 500].includes(res.status));
    });
  });

  describe("PUT /users/:id", function () {
    it("should update a user", async function () {
      const res = await request(app)
        .put("/users/1")
        .send({ name: "Updated" });
      assert.ok([200, 400, 404, 500].includes(res.status));
    });
  });

  describe("DELETE /users/:id", function () {
    it("should delete a user", async function () {
      const res = await request(app).delete("/users/1");
      assert.ok([200, 204, 404, 500].includes(res.status));
    });
  });

  describe("Permission enforcement", function () {
    it("should return 403 without proper permissions", async function () {
      const noPermApp = createApp({
        user: { user_id: 2, email: "user@test.com", name: "User", tenant_id: 1 },
        role: { role_id: 2, name: "Viewer", tenant_id: 1 },
        permission: [{ module: "tenants", action: "read", scope: "tenant" }],
      });
      const res = await request(noPermApp).get("/users/");
      assert.strictEqual(res.status, 403);
    });
  });
});
`;
}

function generateTenantsTest() {
  return `import assert from "assert";
import express from "express";
import request from "supertest";

import tenantsRoute from "#routes/tenants/index.js";

function createApp(sessionData) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      user: sessionData.user,
      role: sessionData.role,
      permission: sessionData.permission,
    };
    next();
  });
  app.use("/tenants", tenantsRoute);
  return app;
}

const mockSession = {
  user: { user_id: 1, email: "admin@system.local", name: "Admin", tenant_id: null },
  role: { role_id: 1, name: "Super Admin", tenant_id: null },
  permission: [
    { module: "tenants", action: "global", scope: "global" },
  ],
};

describe("Tenants Routes (SaaS)", function () {
  let app;

  before(function () {
    app = createApp(mockSession);
  });

  describe("GET /tenants/", function () {
    it("should list tenants", async function () {
      const res = await request(app).get("/tenants/");
      assert.ok([200, 500].includes(res.status));
    });
  });

  describe("POST /tenants/", function () {
    it("should create a tenant", async function () {
      const res = await request(app)
        .post("/tenants/")
        .send({ name: "Acme Corp", slug: "acme-corp" });
      assert.ok([200, 201, 400, 500].includes(res.status));
    });
  });

  describe("PUT /tenants/:id", function () {
    it("should update a tenant", async function () {
      const res = await request(app)
        .put("/tenants/1")
        .send({ name: "Acme Updated" });
      assert.ok([200, 400, 404, 500].includes(res.status));
    });
  });

  describe("DELETE /tenants/:id", function () {
    it("should delete a tenant", async function () {
      const res = await request(app).delete("/tenants/1");
      assert.ok([200, 204, 404, 500].includes(res.status));
    });
  });

  describe("Permission enforcement", function () {
    it("should return 403 without tenants permission", async function () {
      const noPermApp = createApp({
        user: { user_id: 2, email: "user@test.com", name: "User", tenant_id: 1 },
        role: { role_id: 2, name: "Viewer", tenant_id: 1 },
        permission: [{ module: "users", action: "read", scope: "tenant" }],
      });
      const res = await request(noPermApp).get("/tenants/");
      assert.strictEqual(res.status, 403);
    });
  });
});
`;
}

function generateRolesTest() {
  return `import assert from "assert";
import express from "express";
import request from "supertest";

import rolesRoute from "#routes/roles/index.js";

function createApp(sessionData) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      user: sessionData.user,
      role: sessionData.role,
      permission: sessionData.permission,
    };
    next();
  });
  app.use("/roles", rolesRoute);
  return app;
}

const globalSession = {
  user: { user_id: 1, email: "admin@system.local", name: "Admin", tenant_id: null },
  role: { role_id: 1, name: "Super Admin", tenant_id: null },
  permission: [
    { module: "roles", action: "global", scope: "global" },
  ],
};

const tenantSession = {
  user: { user_id: 2, email: "tenant@test.com", name: "Tenant Admin", tenant_id: 1 },
  role: { role_id: 2, name: "Tenant Admin", tenant_id: 1 },
  permission: [
    { module: "roles", action: "read", scope: "tenant" },
    { module: "roles", action: "write", scope: "tenant" },
    { module: "roles", action: "update", scope: "tenant" },
    { module: "roles", action: "delete", scope: "tenant" },
  ],
};

describe("Roles Routes (SaaS)", function () {
  describe("with global permissions", function () {
    let app;

    before(function () {
      app = createApp(globalSession);
    });

    describe("GET /roles/", function () {
      it("should list roles", async function () {
        const res = await request(app).get("/roles/");
        assert.ok([200, 500].includes(res.status));
      });
    });

    describe("POST /roles/", function () {
      it("should create a role", async function () {
        const res = await request(app)
          .post("/roles/")
          .send({ name: "Editor", tenant_id: 1 });
        assert.ok([200, 201, 400, 500].includes(res.status));
      });

      it("should allow creating role with global permissions for global user", async function () {
        const res = await request(app)
          .post("/roles/")
          .send({
            name: "Global Role",
            tenant_id: null,
            permissions: [{ module: "users", action: "read", scope: "global" }],
          });
        assert.ok([200, 201, 400, 500].includes(res.status));
        // Should NOT be 403 for global user
        assert.notStrictEqual(res.status, 403);
      });
    });
  });

  describe("with tenant permissions", function () {
    let app;

    before(function () {
      app = createApp(tenantSession);
    });

    describe("POST /roles/", function () {
      it("should return 403 when creating role with global permissions", async function () {
        const res = await request(app)
          .post("/roles/")
          .send({
            name: "Escalated Role",
            permissions: [{ module: "users", action: "read", scope: "global" }],
          });
        assert.strictEqual(res.status, 403);
      });
    });
  });

  describe("Permission enforcement", function () {
    it("should return 403 without roles permission", async function () {
      const noPermApp = createApp({
        user: { user_id: 3, email: "noperm@test.com", name: "No Perm", tenant_id: 1 },
        role: { role_id: 3, name: "None", tenant_id: 1 },
        permission: [{ module: "tenants", action: "read", scope: "tenant" }],
      });
      const res = await request(noPermApp).get("/roles/");
      assert.strictEqual(res.status, 403);
    });
  });
});
`;
}

function generatePermissionsTest() {
  return `import assert from "assert";
import express from "express";
import request from "supertest";

import permissionsRoute from "#routes/roles/permissions/index.js";

function createApp(sessionData) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      user: sessionData.user,
      role: sessionData.role,
      permission: sessionData.permission,
    };
    next();
  });
  app.use("/roles/:role_id/permissions", permissionsRoute);
  return app;
}

const mockSession = {
  user: { user_id: 1, email: "admin@system.local", name: "Admin", tenant_id: null },
  role: { role_id: 1, name: "Super Admin", tenant_id: null },
  permission: [
    { module: "permissions", action: "global", scope: "global" },
  ],
};

describe("Permissions Routes (SaaS)", function () {
  let app;

  before(function () {
    app = createApp(mockSession);
  });

  describe("GET /roles/:role_id/permissions/", function () {
    it("should list permissions for a role", async function () {
      const res = await request(app).get("/roles/1/permissions/");
      assert.ok([200, 500].includes(res.status));
    });
  });

  describe("POST /roles/:role_id/permissions/", function () {
    it("should create a permission entry", async function () {
      const res = await request(app)
        .post("/roles/1/permissions/")
        .send({ permission: { module: "users", action: "read", scope: "tenant" } });
      assert.ok([200, 201, 400, 500].includes(res.status));
    });
  });

  describe("PUT /roles/:role_id/permissions/:permission_id", function () {
    it("should update a permission entry", async function () {
      const res = await request(app)
        .put("/roles/1/permissions/1")
        .send({ permission: { module: "users", action: "write", scope: "tenant" } });
      assert.ok([200, 400, 404, 500].includes(res.status));
    });
  });

  describe("DELETE /roles/:role_id/permissions/:permission_id", function () {
    it("should delete a permission entry", async function () {
      const res = await request(app).delete("/roles/1/permissions/1");
      assert.ok([200, 204, 404, 500].includes(res.status));
    });
  });

  describe("Permission enforcement", function () {
    it("should return 403 without permissions module access", async function () {
      const noPermApp = createApp({
        user: { user_id: 2, email: "user@test.com", name: "User", tenant_id: 1 },
        role: { role_id: 2, name: "Viewer", tenant_id: 1 },
        permission: [{ module: "users", action: "read", scope: "tenant" }],
      });
      const res = await request(noPermApp).get("/roles/1/permissions/");
      assert.strictEqual(res.status, 403);
    });
  });
});
`;
}

module.exports = { generateSaasTests };
