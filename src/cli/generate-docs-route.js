"use strict";

/**
 * Generate a routes/docs.js file that serves Swagger UI for the OpenAPI spec.
 * Uses swagger-ui-express to mount at /docs.
 *
 * @returns {string}
 */
function generateDocsRoute() {
  return `import express from "express";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(__dirname, "../openapi.json"), "utf8"));

const router = express.Router();

router.use("/", swaggerUi.serve);
router.get("/", swaggerUi.setup(spec, {
  customSiteTitle: "API Documentation",
  customCss: ".swagger-ui .topbar { display: none }",
}));

export default router;
`;
}

module.exports = { generateDocsRoute };
