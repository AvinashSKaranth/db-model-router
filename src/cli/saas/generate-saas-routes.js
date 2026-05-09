"use strict";

/**
 * SaaS route generators.
 *
 * Generates CRUD routes, auth routes, and the routes index file
 * for the SaaS structure generator. All generated code uses ES6 module syntax.
 */

/**
 * Generate CRUD route files for users, tenants, roles, and role_permissions.
 *
 * @returns {Array<{ relPath: string, content: string }>}
 */
function generateCrudRoutes() {
  const files = [];

  files.push({ relPath: "routes/users.js", content: generateUsersRoute() });
  files.push({ relPath: "routes/tenants.js", content: generateTenantsRoute() });
  files.push({ relPath: "routes/roles.js", content: generateRolesRoute() });
  files.push({
    relPath: "routes/roles/permissions.js",
    content: generatePermissionsRoute(),
  });

  return files;
}

function generateUsersRoute() {
  return `import express from "express";
import authenticate from "../middleware/authenticate.js";
import tenantIsolation from "../middleware/tenantIsolation.js";
import hasPermission from "../middleware/hasPermission.js";
import users from "../models/users.js";

const router = express.Router();

router.get("/", authenticate, tenantIsolation, hasPermission("users", "read"), async (req, res) => {
  try {
    const results = await users.findAll(req.query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/", authenticate, tenantIsolation, hasPermission("users", "write"), async (req, res) => {
  try {
    const result = await users.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id", authenticate, tenantIsolation, hasPermission("users", "update"), async (req, res) => {
  try {
    const result = await users.update(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/:id", authenticate, tenantIsolation, hasPermission("users", "delete"), async (req, res) => {
  try {
    const result = await users.delete(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
`;
}

function generateTenantsRoute() {
  return `import express from "express";
import authenticate from "../middleware/authenticate.js";
import tenantIsolation from "../middleware/tenantIsolation.js";
import hasPermission from "../middleware/hasPermission.js";
import tenants from "../models/tenants.js";

const router = express.Router();

router.get("/", authenticate, tenantIsolation, hasPermission("tenants", "read"), async (req, res) => {
  try {
    const results = await tenants.findAll(req.query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/", authenticate, tenantIsolation, hasPermission("tenants", "write"), async (req, res) => {
  try {
    const result = await tenants.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id", authenticate, tenantIsolation, hasPermission("tenants", "update"), async (req, res) => {
  try {
    const result = await tenants.update(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/:id", authenticate, tenantIsolation, hasPermission("tenants", "delete"), async (req, res) => {
  try {
    const result = await tenants.delete(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
`;
}

function generateRolesRoute() {
  return `import express from "express";
import authenticate from "../middleware/authenticate.js";
import tenantIsolation from "../middleware/tenantIsolation.js";
import hasPermission from "../middleware/hasPermission.js";
import roles from "../models/roles.js";

const router = express.Router();

function userHasGlobalPermission(req) {
  return req.session.permission.some((p) => p.scope === "global");
}

function guardSystemRole(req, res, role) {
  if (role.tenant_id === null && !userHasGlobalPermission(req)) {
    res.status(403).json({ message: "Cannot modify system roles" });
    return true;
  }
  return false;
}

function guardGlobalPermissionEscalation(req, res) {
  const permissions = req.body.permissions || [];
  const hasGlobalEntry = permissions.some((p) => p.scope === "global");
  if (hasGlobalEntry && !userHasGlobalPermission(req)) {
    res.status(403).json({ message: "Cannot assign global permissions" });
    return true;
  }
  return false;
}

router.get("/", authenticate, tenantIsolation, hasPermission("roles", "read"), async (req, res) => {
  try {
    const results = await roles.findAll(req.query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/", authenticate, tenantIsolation, hasPermission("roles", "write"), async (req, res) => {
  try {
    if (guardGlobalPermissionEscalation(req, res)) return;
    const result = await roles.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id", authenticate, tenantIsolation, hasPermission("roles", "update"), async (req, res) => {
  try {
    const role = await roles.findById(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });
    if (guardSystemRole(req, res, role)) return;
    if (guardGlobalPermissionEscalation(req, res)) return;
    const result = await roles.update(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/:id", authenticate, tenantIsolation, hasPermission("roles", "delete"), async (req, res) => {
  try {
    const role = await roles.findById(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });
    if (guardSystemRole(req, res, role)) return;
    const result = await roles.delete(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
`;
}

function generatePermissionsRoute() {
  return `import express from "express";
import authenticate from "../../middleware/authenticate.js";
import tenantIsolation from "../../middleware/tenantIsolation.js";
import hasPermission from "../../middleware/hasPermission.js";
import role_permissions from "../../models/role_permissions.js";

const router = express.Router({ mergeParams: true });

router.get("/", authenticate, tenantIsolation, hasPermission("permissions", "read"), async (req, res) => {
  try {
    const query = { ...req.query, role_id: req.params.role_id };
    const results = await role_permissions.findAll(query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/", authenticate, tenantIsolation, hasPermission("permissions", "write"), async (req, res) => {
  try {
    const data = { ...req.body, role_id: req.params.role_id };
    const result = await role_permissions.create(data);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/:permission_id", authenticate, tenantIsolation, hasPermission("permissions", "update"), async (req, res) => {
  try {
    const result = await role_permissions.update(req.params.permission_id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/:permission_id", authenticate, tenantIsolation, hasPermission("permissions", "delete"), async (req, res) => {
  try {
    const result = await role_permissions.delete(req.params.permission_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
`;
}

/**
 * Generate the auth routes file (login and logout) in ES6.
 *
 * @returns {{ relPath: string, content: string }}
 */
function generateAuthRoutes() {
  const relPath = "routes/auth.js";
  const content = `import express from "express";
import authenticate from "../middleware/authenticate.js";
import { verifyPassword } from "../commons/password.js";
import users from "../models/users.js";
import roles from "../models/roles.js";
import role_permissions from "../models/role_permissions.js";

const router = express.Router();

// POST /api/auth/login - Authenticate user and create session
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const userResults = await users.findAll({ email });
    const user = Array.isArray(userResults) ? userResults[0] : (userResults?.data?.[0] ?? null);

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const role = await roles.findById(user.role_id);
    const permsResult = await role_permissions.findAll({ role_id: user.role_id });
    const permissionList = Array.isArray(permsResult) ? permsResult : (permsResult?.data ?? []);

    req.session.user = user;
    req.session.role = role;
    req.session.permission = permissionList.map((p) =>
      typeof p.permission === "string" ? JSON.parse(p.permission) : p.permission
    );

    res.json({ message: "Login successful", user: { id: user.user_id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/logout - Destroy session
router.post("/logout", authenticate, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Failed to destroy session" });
    }
    res.json({ message: "Logout successful" });
  });
});

export default router;
`;
  return { relPath, content };
}

/**
 * Generate the routes index file that wires both SaaS routes and dbmr-generated routes.
 *
 * This function accepts tableNames and relationships from the schema so it can
 * mount both the SaaS auth/CRUD routes AND the dbmr schema-generated routes.
 *
 * @param {string[]} [tableNames] - Schema-generated table names (from dbmr)
 * @param {Array<{parent, child, foreignKey}>} [relationships] - Schema relationships
 * @param {{ includeDocs?: boolean }} [options]
 * @returns {{ relPath: string, content: string }}
 */
function generateRoutesIndex(tableNames, relationships, options) {
  tableNames = tableNames || [];
  relationships = relationships || [];
  options = options || {};

  // SaaS tables that have their own dedicated route files
  const saasRouteModules = new Set([
    "users",
    "tenants",
    "roles",
    "role_permissions",
  ]);

  // Collect child tables from relationships
  const nestedChildren = new Set();
  for (const rel of relationships) {
    nestedChildren.add(rel.child);
  }

  let code = `import express from "express";\n\nconst router = express.Router();\n\n`;

  // --- SaaS route imports ---
  code += `// SaaS auth & CRUD routes\n`;
  code += `import authRoute from "./auth.js";\n`;
  code += `import saasUsersRoute from "./users.js";\n`;
  code += `import saasTenantsRoute from "./tenants.js";\n`;
  code += `import saasRolesRoute from "./roles.js";\n`;
  code += `import saasPermissionsRoute from "./roles/permissions.js";\n\n`;

  // --- dbmr schema-generated route imports (skip SaaS-owned tables) ---
  const dbmrTables = tableNames.filter(
    (t) => !saasRouteModules.has(t) && !nestedChildren.has(t),
  );
  if (dbmrTables.length > 0 || relationships.length > 0) {
    code += `// Schema-generated routes\n`;
  }
  for (const table of dbmrTables) {
    code += `import ${safeVarName(table)}Route from "./${table}.js";\n`;
  }
  for (const rel of relationships) {
    if (saasRouteModules.has(rel.child)) continue;
    code += `import ${safeVarName(rel.child)}ChildRoute from "./${rel.parent}/${rel.child}.js";\n`;
  }

  if (options.includeDocs) {
    code += `import docsRoute from "./docs.js";\n`;
  }

  code += `\n`;

  // --- Mount SaaS routes ---
  code += `// SaaS routes\n`;
  code += `router.use("/api/auth", authRoute);\n`;
  code += `router.use("/api/users", saasUsersRoute);\n`;
  code += `router.use("/api/tenants", saasTenantsRoute);\n`;
  code += `router.use("/api/roles", saasRolesRoute);\n`;
  code += `router.use("/api/roles/:role_id/permissions", saasPermissionsRoute);\n\n`;

  // --- Mount docs route ---
  if (options.includeDocs) {
    code += `router.use("/docs", docsRoute);\n`;
  }

  // --- Mount dbmr child routes before parent routes ---
  for (const rel of relationships) {
    if (saasRouteModules.has(rel.child)) continue;
    const childVar = safeVarName(rel.child);
    code += `router.use("/${rel.parent}/:${rel.foreignKey}/${rel.child}", ${childVar}ChildRoute);\n`;
  }

  // --- Mount dbmr top-level routes ---
  if (dbmrTables.length > 0) {
    code += `\n// Schema-generated routes\n`;
  }
  for (const table of dbmrTables) {
    code += `router.use("/${table}", ${safeVarName(table)}Route);\n`;
  }

  code += `\nexport default router;\n`;

  return { relPath: "routes/index.js", content: code };
}

function safeVarName(name) {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return name;
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}

module.exports = {
  generateCrudRoutes,
  generateAuthRoutes,
  generateRoutesIndex,
};
