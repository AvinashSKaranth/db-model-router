"use strict";

const crypto = require("crypto");

/**
 * SaaS seed generator.
 *
 * Generates seed files for the Super Admin user and Tenant Admin Role,
 * plus a credentials.md file with the generated password.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * All valid modules in the SaaS system.
 * @type {string[]}
 */
const MODULES = ["users", "tenants", "roles", "permissions", "webhooks"];

/**
 * All valid actions in the permission system.
 * @type {string[]}
 */
const ACTIONS = [
  "read",
  "write",
  "update",
  "delete",
  "export",
  "approve",
  "global",
];

/**
 * Super Admin permissions: all actions for all modules with global scope.
 * @type {Array<{ module: string, action: string, scope: string }>}
 */
const SUPER_ADMIN_PERMISSIONS = [];
for (const mod of MODULES) {
  for (const action of ACTIONS) {
    SUPER_ADMIN_PERMISSIONS.push({ module: mod, action, scope: "global" });
  }
}

/**
 * Tenant Admin permissions: CRUD actions for users and roles with tenant scope.
 * No global permissions allowed.
 * @type {Array<{ module: string, action: string, scope: string }>}
 */
const TENANT_ADMIN_PERMISSIONS = [];
for (const mod of ["users", "roles"]) {
  for (const action of ["read", "write", "update", "delete"]) {
    TENANT_ADMIN_PERMISSIONS.push({ module: mod, action, scope: "tenant" });
  }
}

// ---------------------------------------------------------------------------
// Seed File Content Generation
// ---------------------------------------------------------------------------

/**
 * Generate the content of the `seeds/saas-seed.js` file.
 *
 * The seed file, when executed:
 * - Hashes the embedded password using the generated password utility
 * - Inserts the Super Admin user with NULL tenant_id and all permissions
 * - Inserts the Tenant Admin Role with NULL tenant_id and tenant-scoped permissions
 * - Writes credentials.md with the super admin email and password
 *
 * @param {string} password - The generated random password to embed
 * @returns {string} File content for seeds/saas-seed.js
 */
function generateSeedContent(password) {
  const superAdminPermsStr = JSON.stringify(SUPER_ADMIN_PERMISSIONS, null, 2);
  const tenantAdminPermsStr = JSON.stringify(TENANT_ADMIN_PERMISSIONS, null, 2);

  return `"use strict";

const path = require("path");
const fs = require("fs");
const { hashPassword } = require("../commons/password");

/**
 * Super Admin email address.
 */
const SUPER_ADMIN_EMAIL = "admin@system.local";

/**
 * Generated password for the Super Admin.
 * This is cryptographically random and unique per generation.
 */
const SUPER_ADMIN_PASSWORD = "${password}";

/**
 * Super Admin permissions: all actions for all modules with global scope.
 */
const SUPER_ADMIN_PERMISSIONS = ${superAdminPermsStr};

/**
 * Tenant Admin permissions: CRUD for users and roles with tenant scope.
 */
const TENANT_ADMIN_PERMISSIONS = ${tenantAdminPermsStr};

/**
 * Write the credentials.md file with the super admin login details.
 */
function writeCredentials() {
  const content = \`# Super Admin Credentials

**Email:** \${SUPER_ADMIN_EMAIL}
**Password:** \${SUPER_ADMIN_PASSWORD}

> ⚠️ **WARNING:** Change this password after first login. This file should not be committed to version control.
\`;
  fs.writeFileSync(path.join(process.cwd(), "credentials.md"), content, "utf8");
}

/**
 * Seed the database with Super Admin user and Tenant Admin Role.
 *
 * @param {object} db - Database connection/query interface
 * @returns {Promise<void>}
 */
async function seed(db) {
  const passwordHash = await hashPassword(SUPER_ADMIN_PASSWORD);

  // Insert Super Admin role with all permissions
  const superAdminRoleResult = await db("roles").insert({
    tenant_id: null,
    name: "Super Admin",
    created_at: new Date(),
    modified_at: new Date(),
  });
  const superAdminRoleId = Array.isArray(superAdminRoleResult)
    ? superAdminRoleResult[0]
    : superAdminRoleResult;

  // Insert Super Admin permissions
  for (const perm of SUPER_ADMIN_PERMISSIONS) {
    await db("role_permissions").insert({
      role_id: superAdminRoleId,
      permission: JSON.stringify(perm),
      created_at: new Date(),
      modified_at: new Date(),
    });
  }

  // Insert Super Admin user
  await db("users").insert({
    email: SUPER_ADMIN_EMAIL,
    password_hash: passwordHash,
    name: "Super Admin",
    tenant_id: null,
    role_id: superAdminRoleId,
    created_at: new Date(),
    modified_at: new Date(),
  });

  // Insert Tenant Admin Role
  const tenantAdminRoleResult = await db("roles").insert({
    tenant_id: null,
    name: "Tenant Admin",
    created_at: new Date(),
    modified_at: new Date(),
  });
  const tenantAdminRoleId = Array.isArray(tenantAdminRoleResult)
    ? tenantAdminRoleResult[0]
    : tenantAdminRoleResult;

  // Insert Tenant Admin permissions
  for (const perm of TENANT_ADMIN_PERMISSIONS) {
    await db("role_permissions").insert({
      role_id: tenantAdminRoleId,
      permission: JSON.stringify(perm),
      created_at: new Date(),
      modified_at: new Date(),
    });
  }

  // Write credentials file
  writeCredentials();

  console.log("SaaS seed completed successfully.");
  console.log("Super Admin:", SUPER_ADMIN_EMAIL);
  console.log("Credentials written to credentials.md");
}

module.exports = { seed, SUPER_ADMIN_PERMISSIONS, TENANT_ADMIN_PERMISSIONS, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD };
`;
}

/**
 * Generate the content of the `credentials.md` file.
 *
 * @param {string} password - The generated random password
 * @returns {string} File content for credentials.md
 */
function generateCredentialsContent(password) {
  return `# Super Admin Credentials

**Email:** admin@system.local
**Password:** ${password}

> ⚠️ **WARNING:** Change this password after first login. This file should not be committed to version control.
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate seed files for the SaaS structure.
 *
 * Produces:
 * - `seeds/saas-seed.js`: Seed script that inserts Super Admin and Tenant Admin Role
 * - `credentials.md`: File with super admin email and generated password
 *
 * @param {string} adapter - Database adapter name (accepted for API consistency)
 * @returns {Array<{ relPath: string, content: string }>}
 */
function generateSaasSeeds(adapter) {
  const password = crypto.randomBytes(16).toString("hex");

  return [
    {
      relPath: "seeds/saas-seed.js",
      content: generateSeedContent(password),
    },
    {
      relPath: "credentials.md",
      content: generateCredentialsContent(password),
    },
  ];
}

module.exports = {
  generateSaasSeeds,
  SUPER_ADMIN_PERMISSIONS,
  TENANT_ADMIN_PERMISSIONS,
};
