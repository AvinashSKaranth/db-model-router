"use strict";

/**
 * SaaS utility generators.
 *
 * Each function returns the file content string for a commons/ utility module.
 * Generated code uses ES6 module syntax (import/export).
 */

/**
 * Generate the content for `commons/password.js`.
 *
 * @returns {string} File content for commons/password.js
 */
function generatePasswordUtil() {
  return `import crypto from "crypto";

/**
 * Hash a password using scrypt with a random salt.
 * Returns a string in the format "salt:derivedKey" (both hex-encoded).
 *
 * @param {string} password - The plaintext password to hash
 * @returns {Promise<string>} The hashed password string
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt + ":" + derivedKey.toString("hex"));
    });
  });
}

/**
 * Verify a password against a previously hashed value.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param {string} password - The plaintext password to verify
 * @param {string} hash - The stored hash in "salt:derivedKey" format
 * @returns {Promise<boolean>} True if the password matches, false otherwise
 */
export function verifyPassword(password, hash) {
  const [salt, key] = hash.split(":");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey));
    });
  });
}
`;
}

/**
 * Generate the content for `commons/modules.js`.
 *
 * @returns {string} File content for commons/modules.js
 */
function generateModulesUtil() {
  return `/**
 * Registry of all SaaS module names.
 * This is the single source of truth for valid module identifiers
 * used by the permission system.
 *
 * @type {string[]}
 */
export const modules = ["users", "tenants", "roles", "permissions", "webhooks"];

/**
 * Check whether a given name is a registered module.
 *
 * @param {string} name - The module name to validate
 * @returns {boolean} True if the name exists in the modules registry
 */
export function isValidModule(name) {
  return modules.includes(name);
}
`;
}

/**
 * Generate the content for `commons/webhook.js`.
 *
 * @returns {string} File content for commons/webhook.js
 */
function generateWebhookUtil() {
  return `import crypto from "crypto";

/**
 * Retry delay schedule in seconds.
 * Attempt 0: immediate, 1: 1 min, 2: 5 min, 3: 1 hour, 4: 1 day.
 *
 * @type {number[]}
 */
export const RETRY_DELAYS = [0, 60, 300, 3600, 86400];

/**
 * Sign a webhook payload using HMAC-SHA256.
 *
 * @param {object} payload - The payload object to sign
 * @param {string} secret - The tenant's webhook secret
 * @returns {string} Hex-encoded HMAC-SHA256 signature
 */
export function signPayload(payload, secret) {
  const body = JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Look up the configured webhook for a tenant.
 * TODO: Replace this stub with actual database lookup.
 */
export async function lookupWebhook(tenantId) {
  return null;
}

/**
 * Log a webhook delivery event.
 * TODO: Replace this stub with actual database insert into webhook_logs.
 */
export async function logWebhookEvent(webhookId, tenantId, eventType, payload, status, responseBody, responseStatusCode) {
  // Stub: replace with actual DB insert
}

/**
 * Delay execution for the specified number of milliseconds.
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a webhook notification to the configured endpoint for a tenant.
 * Retries delivery up to 5 times with exponential backoff.
 */
export async function sendWebhook(tenantId, event, context) {
  const webhook = await lookupWebhook(tenantId);
  if (!webhook) return;

  const payload = { context, event, timestamp: new Date().toISOString() };
  payload.signature = signPayload(payload, webhook.secret);

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await delay(RETRY_DELAYS[attempt] * 1000);
      console.log(\`Webhook retry attempt \${attempt}, delay: \${RETRY_DELAYS[attempt]}s\`);
    }
    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Key": webhook.key },
        body: JSON.stringify(payload),
      });
      await logWebhookEvent(
        webhook.id, tenantId, event.type, payload,
        response.ok ? "success" : "failed",
        await response.text(), response.status
      );
      if (response.ok) return;
    } catch (err) {
      await logWebhookEvent(
        webhook.id, tenantId, event.type, payload,
        "error", err.message, null
      );
    }
  }
}
`;
}

module.exports = {
  generatePasswordUtil,
  generateModulesUtil,
  generateWebhookUtil,
};
