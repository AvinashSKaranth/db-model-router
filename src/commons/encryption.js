"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ENVELOPE_PREFIX = "enc:";
const ENVELOPE_RE = /^enc:v(\d+):([A-Za-z0-9+/]+={0,2})$/;

const ENCRYPTABLE_TYPES = new Set([
  "string",
  "integer",
  "numeric",
  "boolean",
  "datetime",
]);

let activeConfig = null;

/**
 * Check whether a value is an encrypted envelope string.
 * @param {*} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

/**
 * Parse an encrypted envelope into { version, payload }.
 * Returns null for values that are not `enc:v<N>:...` envelopes.
 * @param {string|*} value
 * @returns {{ version: number, payload: string }|null}
 */
function parseEnvelope(value) {
  if (typeof value !== "string") return null;
  const match = ENVELOPE_RE.exec(value);
  if (!match) return null;
  return { version: parseInt(match[1], 10), payload: match[2] };
}

/**
 * Encrypt a plaintext string and produce an envelope.
 * Uses a fresh random 12-byte IV for every call (AES-256-GCM).
 * @param {*} plaintext - value to serialize and encrypt (null-safe: caller skips nulls)
 * @param {Buffer} key - 32-byte AES key
 * @param {number} version - key version tag embedded in the envelope
 * @returns {string} `enc:v<N>:<base64(iv + ciphertext + tag)>`
 */
function encrypt(plaintext, key, version) {
  if (plaintext === null || plaintext === undefined) {
    throw new Error("Cannot encrypt null/undefined value");
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, enc, tag]).toString("base64");
  return `${ENVELOPE_PREFIX}v${version}:${payload}`;
}

/**
 * Decrypt an envelope string back to plaintext.
 * Validates the GCM authentication tag; throws on tampering/mismatch.
 * @param {string} envelope - `enc:v<N>:...`
 * @param {object} keyring - `{ [version]: Buffer }`
 * @returns {string} plaintext
 */
function decrypt(envelope, keyring) {
  const parsed = parseEnvelope(envelope);
  if (!parsed) {
    throw new Error(`Value is not an encrypted envelope: "${envelope}"`);
  }
  const key = keyring[parsed.version];
  if (!key) {
    throw new Error(
      `No key available for encryption version v${parsed.version}`,
    );
  }
  const raw = Buffer.from(parsed.payload, "base64");
  if (raw.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error(`Corrupted ciphertext in envelope v${parsed.version}`);
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(raw.length - TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH, raw.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return out.toString("utf8");
}

/**
 * Resolve a key reference into a deterministic 32-byte AES-256 key.
 * Accepted refs:
 *   - `env:VAR_NAME`  -> sha256(process.env[VAR_NAME])
 *   - raw base64      -> decoded bytes when exactly 32 bytes, else sha256(ref)
 *   - any other string-> sha256(ref)
 * @param {string} ref
 * @returns {Buffer} 32-byte key
 */
function resolveKey(ref) {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(`Invalid encryption key reference: ${ref}`);
  }
  let secret = ref;
  if (ref.startsWith("env:")) {
    const varName = ref.slice(4);
    secret = process.env[varName];
    if (!secret) {
      throw new Error(
        `Encryption key reference "${ref}" requires env var "${varName}" to be set`,
      );
    }
  } else {
    // Try base64 decode for exact 32-byte keys
    const looksBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(ref);
    if (looksBase64) {
      try {
        const decoded = Buffer.from(ref, "base64");
        if (decoded.length === 32) return decoded;
      } catch (_) {
        // fall through to hashing
      }
    }
  }
  return crypto.createHash("sha256").update(String(secret), "utf8").digest();
}

/**
 * Configure the active encryption keyring.
 * Resolved once (per spec) and reused for every operation.
 * @param {object} config - { key, version, keys?: { [version]: ref } }
 */
function setConfig(config) {
  if (config == null) {
    activeConfig = null;
    return;
  }
  if (typeof config !== "object" || Array.isArray(config)) {
    throw new Error("encryption config must be an object");
  }
  if (typeof config.version !== "number" || config.version < 1) {
    throw new Error("encryption.version must be a positive integer");
  }
  if (!config.key) {
    throw new Error("encryption.key is required");
  }

  const keyring = {};
  const activeKey = resolveKey(config.key);
  keyring[config.version] = activeKey;

  if (config.keys && typeof config.keys === "object") {
    for (const [version, ref] of Object.entries(config.keys)) {
      const v = parseInt(version, 10);
      if (Number.isInteger(v) && v >= 1) {
        keyring[v] = resolveKey(ref);
      }
    }
  }
  // Ensure the active version is authoritative
  keyring[config.version] = activeKey;

  activeConfig = {
    key: activeKey,
    version: config.version,
    keyring,
  };
}

/**
 * Get the resolved active encryption config.
 * @returns {{ key: Buffer, version: number, keyring: object }|null}
 */
function getConfig() {
  return activeConfig;
}

/**
 * Get the keyring (all resolvable versions).
 * @returns {object|null}
 */
function getKeyring() {
  return activeConfig ? activeConfig.keyring : null;
}

/**
 * Serialize a typed value to its string representation for encryption.
 * Numbers/booleans/datetimes are stringified so they round-trip through
 * the envelope; strings and legacy plaintext pass through.
 * @param {*} value
 * @param {string} type
 * @returns {*}
 */
function serializeValue(value, type) {
  if (value === null || value === undefined) return value;
  switch (type) {
    case "boolean": {
      // Accept the truthy representations node-input-validator admits
      // (true, 1, "true", "1") without silently flipping them to false.
      const s = typeof value === "string" ? value.trim().toLowerCase() : value;
      return s === true || s === "true" || s === 1 || s === "1"
        ? "true"
        : "false";
    }
    case "integer":
    case "numeric":
      return String(value);
    case "datetime":
      if (value instanceof Date) {
        return value.toISOString();
      }
      return String(value);
    default:
      return value;
  }
}

/**
 * Deserialize a decrypted string back into its typed value.
 * @param {*} value
 * @param {string} type
 * @returns {*}
 */
function deserializeValue(value, type) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  switch (type) {
    case "boolean":
      return value === "true" || value === "1";
    case "integer": {
      const n = Number.parseInt(value, 10);
      return Number.isNaN(n) ? value : n;
    }
    case "numeric": {
      const n = Number.parseFloat(value);
      return Number.isNaN(n) ? value : n;
    }
    case "datetime":
      return value;
    default:
      return value;
  }
}

/**
 * Base types recognized in a pipe-flag rule string.
 */
const BASE_TYPES = new Set([
  "auto_increment",
  "string",
  "integer",
  "numeric",
  "boolean",
  "datetime",
  "object",
]);

/**
 * Extract the encryption-relevant metadata from a model structure.
 *
 * Rules may declare encryption either on a whole physical column:
 *   "ssn": "encrypted|required|string"
 * or on a nested JSON key using dot notation:
 *   "profile.dob": "encrypted|required|datetime"
 *
 * @param {object} structure - { colName: "pipe|rule" }
 * @returns {{ columns: object, jsonKeys: object, hasEncrypted: boolean }}
 *   columns: { colName: { type } }
 *   jsonKeys: { parentCol: Array<{ path: string[], type }> }
 */
function compileEncryptionMeta(structure) {
  const meta = { columns: {}, jsonKeys: {}, hasEncrypted: false };
  if (!structure || typeof structure !== "object") return meta;

  for (const [col, rule] of Object.entries(structure)) {
    if (typeof rule !== "string") continue;
    const parts = rule.split("|");
    if (!parts.includes("encrypted")) continue;

    let baseType = null;
    for (const p of parts) {
      // Rules may carry a subtype after a colon (e.g. "string:longtext",
      // "integer:unsigned"); the base type is the token before it.
      const token = p.indexOf(":") > -1 ? p.slice(0, p.indexOf(":")) : p;
      if (BASE_TYPES.has(token)) {
        baseType = token;
        break;
      }
    }
    if (!baseType || !ENCRYPTABLE_TYPES.has(baseType)) {
      console.warn(
        `[db-model-router] WARNING: field "${col}" is marked "encrypted" but ` +
          `type "${baseType || "(none)"}" cannot be encrypted; storing plaintext ` +
          `(supported: ${[...ENCRYPTABLE_TYPES].join(", ")})`,
      );
      continue;
    }

    meta.hasEncrypted = true;
    if (col.includes(".")) {
      const segments = col.split(".");
      const parent = segments[0];
      const path = segments.slice(1);
      if (!meta.jsonKeys[parent]) meta.jsonKeys[parent] = [];
      meta.jsonKeys[parent].push({ path, type: baseType });
    } else {
      meta.columns[col] = { type: baseType };
    }
  }
  return meta;
}

/**
 * Remove internal flag tokens (`encrypted`) from a pipe rule so it is safe
 * for node-input-validator (which throws on unknown rule names).
 * @param {string} rule
 * @returns {string}
 */
function sanitizeRule(rule) {
  if (typeof rule !== "string") return rule;
  if (!rule.includes("encrypted")) return rule;
  return rule
    .split("|")
    .filter((p) => p !== "encrypted")
    .join("|");
}

module.exports = {
  ALGORITHM,
  ENVELOPE_PREFIX,
  ENCRYPTABLE_TYPES,
  isEncrypted,
  parseEnvelope,
  encrypt,
  decrypt,
  resolveKey,
  setConfig,
  getConfig,
  getKeyring,
  serializeValue,
  deserializeValue,
  compileEncryptionMeta,
  sanitizeRule,
};