"use strict";

/**
 * SaaS OpenAPI spec generator.
 *
 * Generates OpenAPI 3.0 paths and schemas for the SaaS-specific routes:
 * - Auth routes (login, logout)
 * - CRUD routes for users, tenants, roles with middleware annotations
 * - Nested role_permissions routes
 *
 * This is merged into the main openapi.json alongside schema-generated paths.
 */

const { MODEL_DEFINITIONS } = require("./generate-saas-models");

/**
 * Generate the SaaS portion of the OpenAPI spec.
 * Returns paths and schemas to be merged into the main spec.
 *
 * @returns {{ paths: object, schemas: object, securitySchemes: object }}
 */
function generateSaasOpenAPIPaths() {
  const paths = {};
  const schemas = {};

  // --- Security scheme ---
  const securitySchemes = {
    sessionAuth: {
      type: "apiKey",
      in: "cookie",
      name: "connect.sid",
      description: "Session cookie authentication",
    },
  };

  const security = [{ sessionAuth: [] }];

  // --- Auth routes ---
  paths["/api/auth/login"] = {
    post: {
      tags: ["auth"],
      summary: "Login and create session",
      description:
        "Authenticate with email and password. On success, populates session with user, role, and permissions.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: {
                  type: "string",
                  format: "email",
                  description: "User email address",
                },
                password: { type: "string", description: "User password" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Login successful",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string", example: "Login successful" },
                  user: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      email: { type: "string" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        401: { description: "Invalid credentials" },
        500: { description: "Internal server error" },
      },
    },
  };

  paths["/api/auth/logout"] = {
    post: {
      tags: ["auth"],
      summary: "Logout and destroy session",
      description: "Destroys the current session. Requires authentication.",
      security,
      responses: {
        200: {
          description: "Logout successful",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string", example: "Logout successful" },
                },
              },
            },
          },
        },
        401: { description: "Unauthorized - no valid session" },
        500: { description: "Failed to destroy session" },
      },
    },
  };

  // --- SaaS CRUD routes ---
  const crudTables = [
    { table: "users", tag: "users", prefix: "/api/users", module: "users" },
    {
      table: "tenants",
      tag: "tenants",
      prefix: "/api/tenants",
      module: "tenants",
    },
    { table: "roles", tag: "roles", prefix: "/api/roles", module: "roles" },
  ];

  for (const { table, tag, prefix, module } of crudTables) {
    const modelDef = MODEL_DEFINITIONS.find((m) => m.table === table);
    if (!modelDef) continue;

    const pk = modelDef.primary_key;
    const schemaName = capitalize(table);

    // Build schema
    const properties = {};
    const required = [];
    properties[pk] = { type: "integer", description: "Primary key" };
    for (const [col, rule] of Object.entries(modelDef.structure)) {
      const parsed = parseRule(rule);
      properties[col] = { type: parsed.type };
      if (parsed.required) required.push(col);
    }
    schemas[schemaName] = {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };

    const ref = { $ref: `#/components/schemas/${schemaName}` };

    // GET / - List
    paths[`${prefix}/`] = {
      get: {
        tags: [tag],
        summary: `List ${table}`,
        description: `List all ${table}. Requires authentication, tenant isolation, and ${module}:read permission.`,
        security,
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 0 },
          },
          {
            name: "size",
            in: "query",
            schema: { type: "integer", default: 30 },
          },
        ],
        responses: {
          200: {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: ref },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden - insufficient permissions" },
        },
      },
      post: {
        tags: [tag],
        summary: `Create ${table.replace(/s$/, "")}`,
        description: `Create a new ${table.replace(/s$/, "")}. Requires authentication, tenant isolation, and ${module}:write permission.`,
        security,
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref } },
        },
        responses: {
          201: {
            description: "Created",
            content: { "application/json": { schema: ref } },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden - insufficient permissions" },
          500: { description: "Internal server error" },
        },
      },
    };

    // GET /:id, PUT /:id, DELETE /:id
    paths[`${prefix}/{${pk}}`] = {
      get: {
        tags: [tag],
        summary: `Get ${table.replace(/s$/, "")} by ID`,
        description: `Get a single ${table.replace(/s$/, "")} by ${pk}. Requires ${module}:read permission.`,
        security,
        parameters: [
          { name: pk, in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          200: {
            description: "Success",
            content: { "application/json": { schema: ref } },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
      put: {
        tags: [tag],
        summary: `Update ${table.replace(/s$/, "")}`,
        description: `Update a ${table.replace(/s$/, "")} by ${pk}. Requires ${module}:update permission.`,
        security,
        parameters: [
          { name: pk, in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref } },
        },
        responses: {
          200: {
            description: "Updated",
            content: { "application/json": { schema: ref } },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
      delete: {
        tags: [tag],
        summary: `Delete ${table.replace(/s$/, "")}`,
        description: `Delete a ${table.replace(/s$/, "")} by ${pk}. Requires ${module}:delete permission.`,
        security,
        parameters: [
          { name: pk, in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: {
          200: { description: "Deleted" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Not found" },
        },
      },
    };
  }

  // --- Nested role_permissions routes ---
  const rpDef = MODEL_DEFINITIONS.find((m) => m.table === "role_permissions");
  if (rpDef) {
    const rpPk = rpDef.primary_key;
    const rpSchemaName = "RolePermission";
    const rpProperties = {};
    const rpRequired = [];
    rpProperties[rpPk] = { type: "integer", description: "Primary key" };
    for (const [col, rule] of Object.entries(rpDef.structure)) {
      const parsed = parseRule(rule);
      rpProperties[col] = { type: parsed.type };
      if (parsed.required) rpRequired.push(col);
    }
    schemas[rpSchemaName] = {
      type: "object",
      properties: rpProperties,
      ...(rpRequired.length > 0 ? { required: rpRequired } : {}),
    };
    const rpRef = { $ref: `#/components/schemas/${rpSchemaName}` };

    const rpPrefix = "/api/roles/{role_id}/permissions";
    const roleIdParam = {
      name: "role_id",
      in: "path",
      required: true,
      schema: { type: "integer" },
      description: "Role ID",
    };

    paths[`${rpPrefix}/`] = {
      get: {
        tags: ["permissions"],
        summary: "List permissions for a role",
        description:
          "List all permission entries for a specific role. Requires permissions:read.",
        security,
        parameters: [roleIdParam],
        responses: {
          200: {
            description: "Success",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { type: "array", items: rpRef } },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
      post: {
        tags: ["permissions"],
        summary: "Add permission to role",
        description:
          "Create a new permission entry for a role. Requires permissions:write.",
        security,
        parameters: [roleIdParam],
        requestBody: {
          required: true,
          content: { "application/json": { schema: rpRef } },
        },
        responses: {
          201: {
            description: "Created",
            content: { "application/json": { schema: rpRef } },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    };

    paths[`${rpPrefix}/{${rpPk}}`] = {
      put: {
        tags: ["permissions"],
        summary: "Update a role permission",
        description: `Update a permission entry by ${rpPk}. Requires permissions:update.`,
        security,
        parameters: [
          roleIdParam,
          {
            name: rpPk,
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: rpRef } },
        },
        responses: {
          200: {
            description: "Updated",
            content: { "application/json": { schema: rpRef } },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
      delete: {
        tags: ["permissions"],
        summary: "Delete a role permission",
        description: `Delete a permission entry by ${rpPk}. Requires permissions:delete.`,
        security,
        parameters: [
          roleIdParam,
          {
            name: rpPk,
            in: "path",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          200: { description: "Deleted" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    };
  }

  return { paths, schemas, securitySchemes };
}

function parseRule(rule) {
  const parts = rule.split("|");
  const isRequired = parts.includes("required");
  let type = "string";
  for (const p of parts) {
    if (p === "integer") type = "integer";
    else if (p === "numeric") type = "number";
    else if (p === "object") type = "object";
    else if (p === "string") type = "string";
  }
  return { type, required: isRequired };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { generateSaasOpenAPIPaths };
