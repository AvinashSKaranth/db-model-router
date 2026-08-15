"use strict";

const { jsonStringify, getByPath, setByPath } = require("../commons/function");
const encryption = require("../commons/encryption");

/**
 * Iterate over all rows of a table in pages of `pageSize`.
 * Uses keyset pagination on the primary key when pk is a single column,
 * falling back to offset pagination for composite keys or missing pk.
 *
 * Yields arrays of raw rows (already jsonSafeParse'd by the adapter).
 *
 * @param {object} db - connected adapter
 * @param {string} table - table name
 * @param {string|string[]} pk - primary key column(s)
 * @param {{ pageSize?: number, safeDelete?: string|null }} options
 */
async function* iterateRows(db, table, pk, options = {}) {
  const pageSize = options.pageSize || 1000;
  const safeDelete = options.safeDelete || null;

  if (Array.isArray(pk) || !pk) {
    let page = 0;
    for (;;) {
      const result = await db.list(table, [], [], safeDelete, page, pageSize);
      const rows = result && result.data ? result.data : [];
      if (rows.length === 0) break;
      yield rows;
      page++;
      if (rows.length < pageSize) break;
    }
    return;
  }

  let lastPk = null;
  for (;;) {
    const filter = lastPk == null ? [] : [[[pk, ">", lastPk]]];
    const result = await db.list(table, filter, [pk], safeDelete, 0, pageSize);
    const rows = result && result.data ? result.data : [];
    if (rows.length === 0) break;
    yield rows;
    lastPk = rows[rows.length - 1][pk];
    if (rows.length < pageSize) break;
  }
}

/**
 * Read an encrypted field value from a raw row.
 * Columns read directly; JSON keys read via getByPath.
 */
function readField(row, meta, fieldKey) {
  if (meta.columns[fieldKey]) return row[fieldKey];
  if (meta.jsonKeys[fieldKey]) {
    const defs = meta.jsonKeys[fieldKey];
    const obj = row[fieldKey];
    if (obj == null || typeof obj !== "object") return undefined;
    const value = getByPath(obj, defs[0].path);
    return value;
  }
  // Dot suffix form: "profile.dob"
  for (const [parent, defs] of Object.entries(meta.jsonKeys)) {
    for (const def of defs) {
      if (`${parent}.${def.path.join(".")}` === fieldKey) {
        const obj = row[parent];
        if (obj == null || typeof obj !== "object") return undefined;
        return getByPath(obj, def.path);
      }
    }
  }
  return undefined;
}

/**
 * Set an encrypted field value on a raw row, returning the owner object
 * so serialization knows which column to stringify.
 */
function writeField(row, meta, fieldKey, value) {
  if (meta.columns[fieldKey]) {
    row[fieldKey] = value;
    return fieldKey;
  }
  for (const [parent, defs] of Object.entries(meta.jsonKeys)) {
    for (const def of defs) {
      if (`${parent}.${def.path.join(".")}` === fieldKey) {
        if (row[parent] == null || typeof row[parent] !== "object") {
          row[parent] = {};
        }
        setByPath(row[parent], def.path, value);
        return parent;
      }
    }
  }
  return null;
}

/**
 * List every encrypted field (col or dotted JSON key) in a structure as
 * stable field keys: physical column names as-is, JSON keys as "parent.key".
 * @param {object} meta - compileEncryptionMeta output
 * @returns {Array<{ key, type, column }>}
 */
function listFields(meta) {
  const fields = [];
  for (const [col, def] of Object.entries(meta.columns)) {
    fields.push({ key: col, type: def.type, column: col });
  }
  for (const [parent, defs] of Object.entries(meta.jsonKeys)) {
    for (const def of defs) {
      fields.push({
        key: `${parent}.${def.path.join(".")}`,
        type: def.type,
        column: parent,
      });
    }
  }
  return fields;
}

/**
 * Scan a table and count, per encrypted field, how many stored values are
 * unencrypted plaintext vs already-encrypted envelopes vs null.
 *
 * @param {object} db - connected adapter
 * @param {string} table - table name
 * @param {string|string[]} pk - primary key
 * @param {object} structure - model structure { col: rule }
 * @param {{ pageSize?: number, safeDelete?: string|null }} options
 * @returns {Promise<{ total: number, fields: object }>}
 */
async function scanTable(db, table, pk, structure, options = {}) {
  const meta = encryption.compileEncryptionMeta(structure);
  const fields = listFields(meta);

  const stats = {
    table,
    total: 0,
    analyzed: 0,
    fields: {},
  };
  for (const f of fields) {
    stats.fields[f.key] = { unencrypted: 0, encrypted: 0, null: 0 };
  }

  for await (const rows of iterateRows(db, table, pk, options)) {
    stats.total += rows.length;
    for (const row of rows) {
      let rowHasField = false;
      for (const f of fields) {
        const value = readField(row, meta, f.key);
        if (value === undefined) continue;
        rowHasField = true;
        if (value === null) {
          stats.fields[f.key].null++;
        } else if (encryption.parseEnvelope(value) !== null) {
          stats.fields[f.key].encrypted++;
        } else {
          stats.fields[f.key].unencrypted++;
        }
      }
      if (rowHasField) stats.analyzed++;
    }
  }
  return stats;
}

/**
 * Encrypt all unencrypted (plaintext) values in a table.
 * Writes changed rows back via db.upsert with the primary key.
 *
 * @param {object} db - connected adapter
 * @param {string} table - table name
 * @param {string|string[]} pk - primary key
 * @param {object} structure - model structure
 * @param {{ keyring, version }} config - resolved encryption config
 * @param {{ pageSize?: number, safeDelete?: string|null, dryRun?: boolean, onProgress?: Function }} options
 * @returns {Promise<{ total: number, changed: number, skipped: number }>}
 */
async function encryptTable(db, table, pk, structure, config, options = {}) {
  const meta = encryption.compileEncryptionMeta(structure);
  const fields = listFields(meta);
  const batch = [];
  let total = 0;
  let changed = 0;

  for await (const rows of iterateRows(db, table, pk, options)) {
    total += rows.length;
    for (const row of rows) {
      let dirty = false;
      for (const f of fields) {
        const value = readField(row, meta, f.key);
        if (value === undefined || value === null) continue;
        if (encryption.parseEnvelope(value) !== null) continue;
        const encrypted = encryption.encrypt(
          encryption.serializeValue(value, f.type),
          config.keyring[config.version],
          config.version,
        );
        writeField(row, meta, f.key, encrypted);
        dirty = true;
      }
      if (!dirty) continue;
      changed++;
      if (!options.dryRun) batch.push(row);
    }

    if (batch.length >= 1000 && !options.dryRun) {
      await flushBatch(db, table, pk, batch);
      batch.length = 0;
    }
    if (options.onProgress) options.onProgress(total, changed);
  }

  if (batch.length > 0 && !options.dryRun) {
    await flushBatch(db, table, pk, batch);
  }
  return { total, changed };
}

/**
 * Re-encrypt every envelope in a table under a new active key/version.
 * Envelopes already at the target version are left untouched.
 *
 * @param {object} db - connected adapter
 * @param {string} table - table name
 * @param {string|string[]} pk - primary key
 * @param {object} structure - model structure
 * @param {{ keyring: object, version: number }} config - config carrying OLD keys (decrypt)
 * @param {number} toVersion - target version number
 * @param {Buffer} newKey - new 32-byte key
 * @param {{ pageSize?: number, safeDelete?: string|null, dryRun?: boolean, onProgress?: Function }} options
 * @returns {Promise<{ total: number, changed: number, errors?: Array<{ pk, field, message }> }>}
 */
async function rotateTable(
  db,
  table,
  pk,
  structure,
  config,
  toVersion,
  newKey,
  options = {},
) {
  const meta = encryption.compileEncryptionMeta(structure);
  const fields = listFields(meta);
  const batch = [];
  const errors = [];
  let total = 0;
  let changed = 0;

  for await (const rows of iterateRows(db, table, pk, options)) {
    total += rows.length;
    for (const row of rows) {
      let dirty = false;
      for (const f of fields) {
        const value = readField(row, meta, f.key);
        if (value === undefined || value === null) continue;
        if (encryption.parseEnvelope(value) === null) {
          // Leave legacy plaintext alone; it was handled by encrypt:scan
          options.onLegacy && options.onLegacy(table, f.key);
          continue;
        }
        const parsed = encryption.parseEnvelope(value);
        if (parsed && parsed.version === toVersion) continue;
        try {
          const plaintext = encryption.decrypt(value, config.keyring);
          const encrypted = encryption.encrypt(plaintext, newKey, toVersion);
          writeField(row, meta, f.key, encrypted);
          dirty = true;
        } catch (err) {
          const pkValue = Array.isArray(pk)
            ? pk.map((c) => `${c}=${row[c]}`).join(",")
            : row[pk];
          errors.push({
            pk: pkValue,
            field: f.key,
            message: err.message,
          });
        }
      }
      if (!dirty) continue;
      changed++;
      if (!options.dryRun) batch.push(row);
    }

    if (batch.length >= 1000 && !options.dryRun) {
      await flushBatch(db, table, pk, batch);
      batch.length = 0;
    }
    if (options.onProgress) options.onProgress(total, changed);
  }

  if (batch.length > 0 && !options.dryRun) {
    await flushBatch(db, table, pk, batch);
  }
  return { total, changed, errors };
}

/**
 * Write a batch of mutated rows back to the database.
 * Object columns holding encrypted JSON keys are stringified by jsonStringify
 * (mirroring the model write path); plain string columns pass through untouched.
 */
async function flushBatch(db, table, pk, rows) {
  const uniqueKeys = Array.isArray(pk) ? pk : [pk];
  await db.upsert(table, jsonStringify(rows), uniqueKeys);
}

module.exports = {
  iterateRows,
  scanTable,
  encryptTable,
  rotateTable,
  listFields,
  readField,
  writeField,
};