"use strict";

/**
 * SaaS middleware generators.
 *
 * Each function returns a { relPath, content } object for a middleware file.
 * Generated code uses ES6 module syntax (import/export).
 */

/**
 * Generate the authenticate middleware file.
 *
 * @returns {{ relPath: string, content: string }}
 */
function generateAuthenticateMiddleware() {
  const relPath = "middleware/authenticate.js";
  const content = `/**
 * Authentication middleware.
 *
 * Validates that the request has an active session with a user object.
 * Responds with 401 Unauthorized if no valid session exists.
 */
function authenticate(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export default authenticate;
`;
  return { relPath, content };
}

/**
 * Generate the tenant isolation middleware file.
 *
 * @returns {{ relPath: string, content: string }}
 */
function generateTenantIsolationMiddleware() {
  const relPath = "middleware/tenantIsolation.js";
  const content = `/**
 * Tenant isolation middleware.
 *
 * Restricts data access to the user's own tenant unless the user
 * has a global-scoped permission. Injects tenant_id into query
 * and body parameters for non-global users.
 */
function tenantIsolation(req, res, next) {
  const hasGlobal = req.session.permission.some((p) => p.scope === "global");
  if (!hasGlobal) {
    req.query.tenant_id = req.session.user.tenant_id;
    req.body.tenant_id = req.session.user.tenant_id;
  }
  next();
}

export default tenantIsolation;
`;
  return { relPath, content };
}

/**
 * Generate the hasPermission middleware file.
 *
 * @returns {{ relPath: string, content: string }}
 */
function generateHasPermissionMiddleware() {
  const relPath = "middleware/hasPermission.js";
  const content = `import { isValidModule } from "#commons/modules.js";

/**
 * Permission validation middleware factory.
 *
 * Returns a middleware function that checks whether the authenticated user
 * has the required permission for the specified module and action.
 * A permission entry with action "global" grants access to any action
 * on that module.
 *
 * @param {string} module - The module name to check permission for
 * @param {string} action - The required action
 * @returns {function} Express middleware function
 */
function hasPermission(module, action) {
  return (req, res, next) => {
    if (!isValidModule(module)) {
      return res.status(403).json({ message: "Invalid module" });
    }
    const match = req.session.permission.find(
      (p) => p.module === module && (p.action === action || p.action === "global")
    );
    if (!match) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

export default hasPermission;
`;
  return { relPath, content };
}

module.exports = {
  generateAuthenticateMiddleware,
  generateTenantIsolationMiddleware,
  generateHasPermissionMiddleware,
};
