const {
  RemovePK,
  getPayloadValidator,
  validateInput,
  dataToFilter,
  RemoveUnknownData,
} = require("./validator");
const {
  getType,
  jsonStringify,
  jsonSafeParse,
  getByPath,
  setByPath,
} = require("./function");
const encryption = require("./encryption");
const { produce } = require("./kafka");

const hasProp = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Build a validation-safe copy of the model structure by stripping the
 * internal `encrypted` flag token (node-input-validator rejects unknown rules).
 */
function buildValidatorStructure(modelStructure) {
  const out = {};
  for (const [k, v] of Object.entries(modelStructure || {})) {
    out[k] = encryption.sanitizeRule(v);
  }
  return out;
}

/**
 * Encrypt configured fields on a payload (single object or array of rows)
 * using the active key/version. Null and already-encrypted values are skipped.
 */
function encryptPayload(payload, meta, keyring, version) {
  if (!meta || !meta.hasEncrypted || payload == null) return payload;
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [col, def] of Object.entries(meta.columns)) {
      if (!Object.prototype.hasOwnProperty.call(row, col)) continue;
      const val = row[col];
      if (val === null || val === undefined) continue;
      if (encryption.parseEnvelope(val) !== null) continue;
      row[col] = encryption.encrypt(
        encryption.serializeValue(val, def.type),
        keyring[version],
        version,
      );
    }
    for (const [parent, defs] of Object.entries(meta.jsonKeys)) {
      const obj = row[parent];
      if (!obj || typeof obj !== "object") continue;
      for (const { path, type } of defs) {
        const val = getByPath(obj, path);
        if (val === null || val === undefined) continue;
        if (encryption.parseEnvelope(val) !== null) continue;
        setByPath(
          obj,
          path,
          encryption.encrypt(
            encryption.serializeValue(val, type),
            keyring[version],
            version,
          ),
        );
      }
    }
  }
  return payload;
}

/**
 * Decrypt configured fields on a record or array of records. Legacy plaintext
 * values pass through unchanged; reads remain side-effect-free.
 */
function decryptRows(rows, meta, keyring) {
  if (!meta || !meta.hasEncrypted || rows == null) return rows;
  const items = Array.isArray(rows) ? rows : [rows];
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    for (const [col, def] of Object.entries(meta.columns)) {
      if (!Object.prototype.hasOwnProperty.call(row, col)) continue;
      const val = row[col];
      if (val === null || val === undefined) continue;
      if (encryption.parseEnvelope(val) !== null) {
        row[col] = encryption.deserializeValue(
          encryption.decrypt(val, keyring),
          def.type,
        );
      }
    }
    for (const [parent, defs] of Object.entries(meta.jsonKeys)) {
      const obj = row[parent];
      if (!obj || typeof obj !== "object") continue;
      for (const { path, type } of defs) {
        const val = getByPath(obj, path);
        if (val === null || val === undefined) continue;
        if (encryption.parseEnvelope(val) !== null) {
          setByPath(
            obj,
            path,
            encryption.deserializeValue(encryption.decrypt(val, keyring), type),
          );
        }
      }
    }
  }
  return rows;
}

/**
 * Build a plaintext payload for Kafka events from the encrypted, stringified
 * rows produced by a bulk write path. Object columns holding encrypted dotted
 * keys are restored to objects (jsonStringify turned them into JSON strings)
 * so decryptRows can reach the envelopes, matching single-record events which
 * emit decrypted plaintext. The data handed to the adapter is untouched.
 */
function payloadForProduce(data, meta, keyring) {
  if (!meta || !meta.hasEncrypted || data == null) return data;
  const rows = Array.isArray(data) ? data : [data];
  if (meta.jsonKeys && Object.keys(meta.jsonKeys).length > 0) {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      for (const parent of Object.keys(meta.jsonKeys)) {
        if (typeof row[parent] === "string") {
          try {
            row[parent] = JSON.parse(row[parent]);
          } catch (_) {
            // Leave non-JSON values untouched.
          }
        }
      }
    }
  }
  return decryptRows(data, meta, keyring);
}

/**
 * Extract and remove reserved params from a data/payload object.
 * Returns { select_columns: string[]|null, output_content_type: string|null, search: string|null }
 *
 * `search` is the free-text search term. It is stripped here so it is never
 * treated as a column filter by dataToFilter; it is consumed by applySearch
 * against the model's configured `search_columns` option.
 */
function extractReservedParams(data) {
  let select_columns = null;
  let output_content_type = null;
  let search = null;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.select_columns) {
      select_columns =
        typeof data.select_columns === "string"
          ? data.select_columns.split(",").map((s) => s.trim())
          : data.select_columns;
      delete data.select_columns;
    }
    if (data.output_content_type) {
      output_content_type = data.output_content_type;
      delete data.output_content_type;
    }
    if (data.search !== undefined && data.search !== null) {
      search = data.search;
      delete data.search;
    }
  }
  return { select_columns, output_content_type, search };
}

/**
 * Fan a free-text `search` term out to one OR-group per configured search
 * column, AND-combined with the existing filter.
 *
 * Filter format is [[OR_groups[AND_conditions[col,op,val]]]] (top-level array
 * = OR, within a group = AND). Each search column becomes its own OR-group
 * containing a single `like` condition. To AND search with the existing
 * filter, cross-product every existing OR-group with every search OR-group:
 *
 *   merged = for g in base, for sg in searchGroups: [...g, ...sg]
 *
 * Result OR-joined == (existing OR-groups) AND (col0 LIKE term OR col1 LIKE term OR ...).
 * Empty base ([[]]) collapses to pure search OR-groups.
 *
 * The term is NOT pre-wrapped in `%` — adapters handle contains-wrapping:
 * mysql/postgres add `%term%` (postgres via ILIKE, case-insensitive);
 * mongodb/redis/dynamodb use native substring primitives (mongo regex `i`,
 * redis String.includes ci, dynamodb contains()).
 */
function applySearch(filter, searchColumns, term) {
  if (!Array.isArray(searchColumns) || searchColumns.length === 0) {
    return filter;
  }
  if (term === undefined || term === null) return filter;
  term = String(term).trim();
  if (term === "") return filter;
  const searchGroups = searchColumns.map((col) => [[col, "like", term]]);
  let base = Array.isArray(filter) && filter.length > 0 ? filter : [[]];
  const merged = [];
  for (const g of base) {
    // Drop malformed empty conditions (e.g. the `[]` placeholder inside the
    // `[[[]]]` shape returned by dataToFilter for an empty object); otherwise
    // adapter where() short-circuits the whole group to "match all".
    const gClean = (Array.isArray(g) ? g : []).filter(
      (c) => Array.isArray(c) && c.length === 3,
    );
    for (const sg of searchGroups) {
      merged.push([...gClean, ...sg]);
    }
  }
  return merged;
}

/**
 * Normalize sort input to an array of sort strings.
 * Handles: array of strings, JSON-stringified array, or comma-separated string ("-age,name").
 */
function normalizeSort(sort) {
  if (!sort) return [];
  if (Array.isArray(sort)) return sort;
  const parsed = jsonSafeParse(sort);
  if (Array.isArray(parsed)) return parsed;
  if (typeof sort === "string") {
    return sort
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Apply column projection to a single record or array of records.
 */
function applySelect(data, select_columns) {
  if (!select_columns || select_columns.length === 0) return data;
  if (Array.isArray(data)) {
    return data.map((row) => pickKeys(row, select_columns));
  }
  if (data && typeof data === "object") {
    return pickKeys(data, select_columns);
  }
  return data;
}

function pickKeys(obj, keys) {
  const result = {};
  for (const k of keys) {
    if (hasProp(obj, k)) result[k] = obj[k];
  }
  return result;
}

/**
 * Convert data to CSV string.
 */
function toCSV(data) {
  if (!Array.isArray(data) || data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return "";
        const str = typeof val === "object" ? JSON.stringify(val) : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? '"' + str.replace(/"/g, '""') + '"'
          : str;
      })
      .join(","),
  );
  return headers.join(",") + "\n" + rows.join("\n");
}

/**
 * Convert data to simple XML string.
 */
function toXML(data, rootName = "records", itemName = "record") {
  const items = Array.isArray(data) ? data : [data];
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<' + rootName + ">\n";
  for (const item of items) {
    xml += "  <" + itemName + ">\n";
    for (const [key, val] of Object.entries(item)) {
      let escaped = "";
      if (val !== null && val !== undefined) {
        escaped = typeof val === "object" ? escapeXml(JSON.stringify(val)) : escapeXml(String(val));
      }
      xml += "    <" + key + ">" + escaped + "</" + key + ">\n";
    }
    xml += "  </" + itemName + ">\n";
  }
  xml += "</" + rootName + ">\n";
  return xml;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CREATED_AT_VARIANTS = [
  "created_at",
  "createdAt",
  "created",
  "create_date",
  "createDate",
  "creation_date",
  "creationDate",
];
const MODIFIED_AT_VARIANTS = [
  "modified_at",
  "modifiedAt",
  "modified",
  "updated_at",
  "updatedAt",
  "updated",
  "update_date",
  "updateDate",
  "modification_date",
  "modificationDate",
];

function buildTimestampKeys(option) {
  let createdKeys = CREATED_AT_VARIANTS;
  if (option.created_at) {
    createdKeys = Array.isArray(option.created_at) ? option.created_at : [option.created_at];
  }
  let modifiedKeys = MODIFIED_AT_VARIANTS;
  if (option.modified_at) {
    modifiedKeys = Array.isArray(option.modified_at) ? option.modified_at : [option.modified_at];
  }
  return { createdKeys, modifiedKeys };
}

function stripTimestampFields(data, keys) {
  if (Array.isArray(data)) {
    for (const row of data) {
      for (const k of keys) delete row[k];
    }
  } else if (data && typeof data === "object") {
    for (const k of keys) delete data[k];
  }
  return data;
}

module.exports = function model(
  dbOrTable,
  tableOrStructure,
  modelStructureOrPK,
  primary_keyOrUnique,
  uniqueOrOption,
  optionOrUndefined,
) {
  // Detect if db was passed or if first arg is the table name (string)
  let db, table, modelStructure, primary_key, unique, option;
  if (typeof dbOrTable === "string") {
    // model("table", structure, pk, unique, option) — no db, use singleton
    const restRouter = require("../index.js");
    db = restRouter.db;
    table = dbOrTable;
    modelStructure = tableOrStructure || {};
    primary_key = modelStructureOrPK || "id";
    unique = primary_keyOrUnique || [];
    option = uniqueOrOption || { safeDelete: null };
    option.search_columns = Array.isArray(option.search_columns)
      ? option.search_columns
      : [];
  } else {
    // model(db, "table", structure, pk, unique, option) — classic signature
    db = dbOrTable;
    table = tableOrStructure;
    modelStructure = modelStructureOrPK || {};
    primary_key = primary_keyOrUnique || "id";
    unique = uniqueOrOption || [];
    option = optionOrUndefined || { safeDelete: null };
    option.search_columns = Array.isArray(option.search_columns)
      ? option.search_columns
      : [];
  }

  const { createdKeys, modifiedKeys } = buildTimestampKeys(option);
  const allTimestampKeys = [...createdKeys, ...modifiedKeys];

  const hooks = option?.hooks || {};

  const runItemHook = async (hookFn, item, context) => {
    if (!hookFn || !item || typeof item !== "object") return item;
    const res = await hookFn(item, context);
    return res !== undefined && typeof res === "object" ? res : item;
  };

  const runHook = async (hookFn, payload, context) => {
    if (!hookFn) return payload;
    if (payload && hasProp(payload, "data") && Array.isArray(payload.data)) {
      for (let i = 0; i < payload.data.length; i++) {
        payload.data[i] = await runItemHook(hookFn, payload.data[i], context);
      }
      return payload;
    } else if (Array.isArray(payload)) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] = await runItemHook(hookFn, payload[i], context);
      }
      return payload;
    } else {
      return await runItemHook(hookFn, payload, context);
    }
  };

  // Compile encryption metadata once per model from the structure rules.
  const encryptionMeta = encryption.compileEncryptionMeta(modelStructure);
  const validatorStructure = buildValidatorStructure(modelStructure);
  const activeEncryption = encryption.getConfig();

  if (encryptionMeta.hasEncrypted && !activeEncryption) {
    throw new Error(
      `Model "${table}" declares encrypted fields but no encryption config was provided to db.init(). ` +
        `Pass { encryption: { key, version } } to db.init(adapter, config).`,
    );
  }

  const emitProduce = (t, action, payload) => {
    if (option && option._kafkaBuffer) {
      option._kafkaBuffer.push({ table: t, action, data: payload });
    } else {
      produce(t, action, payload);
    }
  };

  return {
    insert: async (data, context = {}) => {
      let isBulk = false;
      if (hooks.beforeSave) data = await runHook(hooks.beforeSave, data, context);
      if (hooks.beforeCreate) data = await runHook(hooks.beforeCreate, data, context);
      if (hasProp(data, "data")) {
        isBulk = true;
        RemovePK(primary_key, data.data);
        stripTimestampFields(data.data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", validatorStructure, primary_key, true),
        );
        data = data.data;
        RemoveUnknownData(modelStructure, data);
      } else {
        delete data[primary_key];
        stripTimestampFields(data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", validatorStructure, primary_key, false),
        );
        RemoveUnknownData(modelStructure, [data]);
      }
      encryptPayload(data, encryptionMeta, activeEncryption?.keyring, activeEncryption?.version);
      data = jsonStringify(data);
      const insertResult = await db.insert(table, data, unique);
      if (!isBulk) {
        let record = insertResult.record || null;
        if (!record && hasProp(insertResult, "id") && insertResult.id) {
          const getResult = await db.get(
            table,
            [[[primary_key, "=", insertResult.id]]],
            [],
            null,
            { count: false, limit: 1 },
          );
          record = getResult.count > 0 ? getResult["data"][0] : null;
        }
        if (record) {
          decryptRows(record, encryptionMeta, activeEncryption?.keyring);
          if (hooks.afterSave) record = await runItemHook(hooks.afterSave, record, context);
          if (hooks.afterCreate) record = await runItemHook(hooks.afterCreate, record, context);
          emitProduce(table, "insert", record);
          return record;
        }
        if (hasProp(insertResult, "id")) {
          return null;
        }
      }
      // Bulk Insert or non-id return
      if (hooks.afterSave) await hooks.afterSave(insertResult, context);
      if (hooks.afterCreate) await hooks.afterCreate(insertResult, context);
      emitProduce(table, "insert", payloadForProduce(data, encryptionMeta, activeEncryption?.keyring));
      return insertResult;
    },
    update: async (data, context = {}) => {
      if (hooks.beforeSave) data = await runHook(hooks.beforeSave, data, context);
      if (hooks.beforeUpdate) data = await runHook(hooks.beforeUpdate, data, context);
      if (hasProp(data, "data")) {
        stripTimestampFields(data.data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("UPDATE", validatorStructure, primary_key, true),
        );
        data = data.data;
        data = RemoveUnknownData(modelStructure, data);
        encryptPayload(data, encryptionMeta, activeEncryption?.keyring, activeEncryption?.version);
        data = jsonStringify(data);
        const bulkResult = await db.upsert(table, data, unique);
        if (hooks.afterSave) await hooks.afterSave(bulkResult, context);
        if (hooks.afterUpdate) await hooks.afterUpdate(bulkResult, context);
        emitProduce(table, "update", payloadForProduce(data, encryptionMeta, activeEncryption?.keyring));
        return bulkResult;
      } else {
        stripTimestampFields(data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("UPDATE", validatorStructure, primary_key, false),
        );
        data = RemoveUnknownData(modelStructure, [data]);
        encryptPayload(data, encryptionMeta, activeEncryption?.keyring, activeEncryption?.version);
        data = jsonStringify(data);
        const updateResult = await db.upsert(table, data, unique);
        let record = updateResult.record || null;
        if (!record && hasProp(updateResult, "id") && updateResult.id > 0) {
          const getResult = await db.get(
            table,
            [[[primary_key, "=", updateResult.id]]],
            [],
            option.safeDelete,
            { count: false, limit: 1 },
          );
          record = getResult.count > 0 ? getResult["data"][0] : null;
        } else if (!record && hasProp(data[0], primary_key)) {
          const result = await db.get(
            table,
            [[[primary_key, "=", data[0][primary_key]]]],
            [],
            option.safeDelete,
            { count: false, limit: 1 },
          );
          record = result.count > 0 ? result["data"][0] : null;
        }
        if (record) {
          decryptRows(record, encryptionMeta, activeEncryption?.keyring);
          if (hooks.afterSave) record = await runItemHook(hooks.afterSave, record, context);
          if (hooks.afterUpdate) record = await runItemHook(hooks.afterUpdate, record, context);
          emitProduce(table, "update", record);
          return record;
        }
        if ((hasProp(updateResult, "id") && updateResult.id > 0) || hasProp(data[0], primary_key)) {
          return null;
        }
        if (hooks.afterSave) await hooks.afterSave(updateResult, context);
        if (hooks.afterUpdate) await hooks.afterUpdate(updateResult, context);
        return updateResult;
      }
    },
    upsert: async (data, context = {}) => {
      //* Same as Update but primary key is optional */
      if (hooks.beforeSave) data = await runHook(hooks.beforeSave, data, context);
      if (hooks.beforeUpdate) data = await runHook(hooks.beforeUpdate, data, context);
      if (hooks.beforeUpsert) data = await runHook(hooks.beforeUpsert, data, context);
      if (hasProp(data, "data")) {
        stripTimestampFields(data.data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", validatorStructure, primary_key, true),
        );
        data = data.data;
        data = RemoveUnknownData(modelStructure, data);
        encryptPayload(data, encryptionMeta, activeEncryption?.keyring, activeEncryption?.version);
        data = jsonStringify(data);
        const bulkResult = await db.upsert(table, data, unique);
        if (hooks.afterSave) await hooks.afterSave(bulkResult, context);
        if (hooks.afterUpdate) await hooks.afterUpdate(bulkResult, context);
        if (hooks.afterUpsert) await hooks.afterUpsert(bulkResult, context);
        emitProduce(table, "upsert", payloadForProduce(data, encryptionMeta, activeEncryption?.keyring));
        return bulkResult;
      } else {
        stripTimestampFields(data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", validatorStructure, primary_key, false),
        );
        const originalData = { ...data };
        data = RemoveUnknownData(modelStructure, [data]);
        encryptPayload(data, encryptionMeta, activeEncryption?.keyring, activeEncryption?.version);
        data = jsonStringify(data);
        const updateResult = await db.upsert(table, data, unique);
        let record = updateResult.record || null;
        if (!record && hasProp(updateResult, "id") && updateResult.id) {
          const getResult = await db.get(
            table,
            [[[primary_key, "=", updateResult.id]]],
            [],
            option.safeDelete,
            { count: false, limit: 1 },
          );
          record = getResult.count > 0 ? getResult["data"][0] : null;
        } else if (!record && hasProp(originalData, primary_key)) {
          const result = await db.get(
            table,
            [[[primary_key, "=", originalData[primary_key]]]],
            [],
            option.safeDelete,
            { count: false, limit: 1 },
          );
          record = result.count > 0 ? result["data"][0] : null;
        }
        if (record) {
          decryptRows(record, encryptionMeta, activeEncryption?.keyring);
          if (hooks.afterSave) record = await runItemHook(hooks.afterSave, record, context);
          if (hooks.afterUpdate) record = await runItemHook(hooks.afterUpdate, record, context);
          if (hooks.afterUpsert) record = await runItemHook(hooks.afterUpsert, record, context);
          emitProduce(table, "upsert", record);
          return record;
        }
        if (hasProp(updateResult, "id") || hasProp(originalData, primary_key)) {
          return null;
        }
        if (hooks.afterSave) await hooks.afterSave(updateResult, context);
        if (hooks.afterUpdate) await hooks.afterUpdate(updateResult, context);
        if (hooks.afterUpsert) await hooks.afterUpsert(updateResult, context);
        return updateResult;
      }
    },
    remove: async (data, context = {}) => {
      if (hooks.beforeDelete) {
        const res = await hooks.beforeDelete(data, context);
        if (res !== undefined) data = res;
      }
      const originalData = Array.isArray(data) ? [...data] : { ...data };
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      const removeResult = await db.remove(table, filter, option.safeDelete);
      if (hooks.afterDelete) {
        await hooks.afterDelete(removeResult, context);
      }
      emitProduce(table, "delete", originalData);
      return removeResult;
    },
    byId: async (id, options = {}, context = {}) => {
      if (id === null || id === undefined || id === "") {
        const err = new Error("Invalid id value", { cause: { status: 422 } });
        err.status = 422;
        throw err;
      }
      let opt = {};
      let ctx = context;
      if (options && typeof options === "object") {
        if (hasProp(options, "select_columns")) {
          opt = options;
        } else if (Object.keys(context).length === 0) {
          ctx = options;
        } else {
          opt = options;
        }
      }
      let type = getType(id);
      if (type === "string" || type === "number") {
        let filter = [[[primary_key, "=", id]]];
        if (hooks.beforeFind) {
          const f = await hooks.beforeFind(filter, ctx);
          if (f !== undefined && Array.isArray(f)) filter = f;
        }
        const result = await db.get(
          table,
          filter,
          [],
          option.safeDelete,
          { count: false, limit: 1 },
        );
        if (result.count > 0) {
          let record = result["data"][0];
          decryptRows(record, encryptionMeta, activeEncryption?.keyring);
          if (opt.select_columns)
            record = applySelect(record, opt.select_columns);
          if (hooks.afterFind) {
            const h = await hooks.afterFind([record], ctx);
            if (h !== undefined && Array.isArray(h) && h.length > 0) record = h[0];
          }
          return record;
        } else return null;
      } else {
        const err = new Error("Invalid id value", { cause: { status: 422 } });
        err.status = 422;
        throw err;
      }
    },
    find: async (data, context = {}) => {
      const { select_columns, search } = extractReservedParams(data);
      let sort = [];
      if (hasProp(data, "sort")) {
        sort = normalizeSort(data.sort);
        delete data.sort;
      }
      let limit = null;
      if (hasProp(data, "limit")) {
        limit = parseInt(data.limit, 10);
        if (isNaN(limit) || limit < 1) limit = null;
        delete data.limit;
      }
      let needCount = true;
      if (hasProp(data, "count")) {
        needCount = Boolean(data.count);
        delete data.count;
      } else if (limit != null) {
        needCount = false;
      }
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      filter = applySearch(filter, option.search_columns, search);
      if (hooks.beforeFind) {
        const f = await hooks.beforeFind(filter, context);
        if (f !== undefined && Array.isArray(f)) filter = f;
      }
      const getOptions = {};
      if (limit != null) getOptions.limit = limit;
      if (!needCount) getOptions.count = false;
      const result = await db.get(
        table,
        filter,
        sort,
        option.safeDelete,
        getOptions,
      );
      decryptRows(result.data, encryptionMeta, activeEncryption?.keyring);
      if (select_columns)
        result.data = applySelect(result.data, select_columns);
      if (hooks.afterFind) {
        const h = await hooks.afterFind(result.data, context);
        if (h !== undefined && Array.isArray(h)) result.data = h;
      }
      return result;
    },
    findOne: async (data, context = {}) => {
      const { select_columns, search } = extractReservedParams(data);
      let sort = [];
      if (hasProp(data, "sort")) {
        sort = normalizeSort(data.sort);
        delete data.sort;
      }
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      filter = applySearch(filter, option.search_columns, search);
      if (hooks.beforeFind) {
        const f = await hooks.beforeFind(filter, context);
        if (f !== undefined && Array.isArray(f)) filter = f;
      }
      let result = await db.get(
        table,
        filter,
        sort,
        option.safeDelete,
        { count: false, limit: 1 },
      );
      if (result.count > 0) {
        let record = result["data"][0];
        decryptRows(record, encryptionMeta, activeEncryption?.keyring);
        if (select_columns) record = applySelect(record, select_columns);
        if (hooks.afterFind) {
          const h = await hooks.afterFind([record], context);
          if (h !== undefined && Array.isArray(h) && h.length > 0) record = h[0];
        }
        return record;
      } else {
        return false;
      }
    },
    list: async (data, context = {}) => {
      const { select_columns, search } = extractReservedParams(data);
      let page = 0;
      let size = 30;
      let sort = [];
      if (hasProp(data, "page")) {
        page = parseInt(data.page, 10);
        if (isNaN(page) || page < 0) page = 0;
        delete data.page;
      }
      if (hasProp(data, "size") || hasProp(data, "limit")) {
        const rawSize = hasProp(data, "size") ? data.size : data.limit;
        size = parseInt(rawSize, 10);
        if (isNaN(size) || size < 1) size = 30;
        if (size > 200) size = 200;
        delete data.size;
        delete data.limit;
      }
      if (hasProp(data, "sort")) {
        sort = normalizeSort(data.sort);
        delete data.sort;
      }
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      filter = applySearch(filter, option.search_columns, search);
      let needCount = true;
      if (hasProp(data, "count")) {
        needCount = Boolean(data.count);
        delete data.count;
      }
      if (hooks.beforeFind) {
        const f = await hooks.beforeFind(filter, context);
        if (f !== undefined && Array.isArray(f)) filter = f;
      }
      const result = await db.list(
        table,
        filter,
        sort,
        option.safeDelete,
        page,
        size,
        { count: needCount },
      );
      decryptRows(result.data, encryptionMeta, activeEncryption?.keyring);
      if (select_columns)
        result.data = applySelect(result.data, select_columns);
      if (hooks.afterFind) {
        const h = await hooks.afterFind(result.data, context);
        if (h !== undefined && Array.isArray(h)) result.data = h;
      }
      return result;
    },
    patch: async (data, context = {}) => {
      // Partial update — fetch existing, merge patch fields, then upsert
      if (hooks.beforeSave) data = await runItemHook(hooks.beforeSave, data, context);
      if (hooks.beforeUpdate) data = await runItemHook(hooks.beforeUpdate, data, context);
      stripTimestampFields(data, allTimestampKeys);
      if (!hasProp(data, primary_key)) {
        throw new Error("Primary key is required for patch", {
          cause: { status: 422 },
        });
      }
      const pkValue = data[primary_key];
      // Validate input fields provided in patch (Review item B3)
      const patchValidator = {};
      for (const key of Object.keys(data)) {
        if (key === primary_key) continue;
        if (validatorStructure[key]) {
          const rules = validatorStructure[key]
            .split("|")
            .filter((r) => r !== "required")
            .join("|");
          if (rules) patchValidator[key] = rules;
        }
      }
      if (Object.keys(patchValidator).length > 0) {
        await validateInput(data, patchValidator);
      }

      // Fetch existing record
      const existing = await db.get(
        table,
        [[[primary_key, "=", pkValue]]],
        [],
        option.safeDelete,
        { count: false, limit: 1 },
      );
      if (existing.count === 0) return null;
      // Decrypt the stored record so the merged payload stays plaintext
      decryptRows(existing.data, encryptionMeta, activeEncryption?.keyring);
      // Merge: start with existing, overlay only known fields from patch
      const merged = { ...existing.data[0] };
      for (const key of Object.keys(data)) {
        if (key === primary_key) continue;
        if (hasProp(modelStructure, key)) {
          merged[key] = data[key];
        }
      }
      const pkOrig = merged[primary_key];
      encryptPayload([merged], encryptionMeta, activeEncryption?.keyring, activeEncryption?.version);
      const mergedArray = jsonStringify([merged]);
      // Restore the primary key value in case jsonStringify converted it
      // (e.g., MongoDB ObjectId gets stringified to a JSON string)
      mergedArray[0][primary_key] = pkOrig;
      await db.upsert(table, mergedArray, unique);
      // Re-fetch to return the updated record
      const result = await db.get(
        table,
        [[[primary_key, "=", pkValue]]],
        [],
        option.safeDelete,
        { count: false, limit: 1 },
      );
      if (result.count > 0) {
        let record = result.data[0];
        decryptRows(record, encryptionMeta, activeEncryption?.keyring);
        if (hooks.afterSave) record = await runItemHook(hooks.afterSave, record, context);
        if (hooks.afterUpdate) record = await runItemHook(hooks.afterUpdate, record, context);
        emitProduce(table, "update", record);
        return record;
      }
      return null;
    },
    withTx: (tx) => {
      const txAdapter = tx && tx.adapter ? tx.adapter : tx;
      const txBuffer = tx && tx._kafkaBuffer ? tx._kafkaBuffer : null;
      return model(
        txAdapter,
        table,
        modelStructure,
        primary_key,
        unique,
        {
          ...option,
          _kafkaBuffer: txBuffer,
        },
      );
    },
    pk: primary_key,
    modelStructure,
    table,
    hooks,
  };
};

// Export format helpers for route.js
module.exports.toCSV = toCSV;
module.exports.toXML = toXML;
module.exports.applySelect = applySelect;
module.exports.extractReservedParams = extractReservedParams;
module.exports.applySearch = applySearch;
