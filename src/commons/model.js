const {
  RemovePK,
  getPayloadValidator,
  validateInput,
  dataToFilter,
  RemoveUnknownData,
} = require("./validator");
const { getType, jsonStringify, jsonSafeParse } = require("./function");

/**
 * Extract and remove reserved params from a data/payload object.
 * Returns { select_columns: string[]|null, output_content_type: string|null, cleaned: data }
 */
function extractReservedParams(data) {
  let select_columns = null;
  let output_content_type = null;
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
  }
  return { select_columns, output_content_type };
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
    if (obj.hasOwnProperty(k)) result[k] = obj[k];
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
      const escaped =
        val === null || val === undefined
          ? ""
          : typeof val === "object"
            ? escapeXml(JSON.stringify(val))
            : escapeXml(String(val));
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
  let createdKeys = [];
  let modifiedKeys = [];
  if (option.created_at) {
    createdKeys = Array.isArray(option.created_at)
      ? option.created_at
      : [option.created_at];
  } else {
    createdKeys = CREATED_AT_VARIANTS;
  }
  if (option.modified_at) {
    modifiedKeys = Array.isArray(option.modified_at)
      ? option.modified_at
      : [option.modified_at];
  } else {
    modifiedKeys = MODIFIED_AT_VARIANTS;
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
  } else {
    // model(db, "table", structure, pk, unique, option) — classic signature
    db = dbOrTable;
    table = tableOrStructure;
    modelStructure = modelStructureOrPK || {};
    primary_key = primary_keyOrUnique || "id";
    unique = uniqueOrOption || [];
    option = optionOrUndefined || { safeDelete: null };
  }

  const { createdKeys, modifiedKeys } = buildTimestampKeys(option);
  const allTimestampKeys = [...createdKeys, ...modifiedKeys];

  return {
    insert: async (data) => {
      let isBulk = false;
      if (data.hasOwnProperty("data")) {
        isBulk = true;
        RemovePK(primary_key, data.data);
        stripTimestampFields(data.data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", modelStructure, primary_key, true),
        );
        data = data.data;
      } else {
        delete data[primary_key];
        stripTimestampFields(data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", modelStructure, primary_key, false),
        );
      }
      data = jsonStringify(data);
      const insertResult = await db.insert(table, data, unique);
      if (!isBulk && insertResult.hasOwnProperty("id")) {
        const getResult = await db.get(table, [
          [[primary_key, "=", insertResult.id]],
        ]);
        return getResult.count > 0 ? getResult["data"][0] : null;
      }
      //TODO: Bulk Insert -> Return inserted objects
      return insertResult;
    },
    update: async (data) => {
      let updateResult = null;
      if (data.hasOwnProperty("data")) {
        stripTimestampFields(data.data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("UPDATE", modelStructure, primary_key, true),
        );
        data = data.data;
        data = RemoveUnknownData(modelStructure, data);
        data = jsonStringify(data);
        updateResult = await db.upsert(table, data, unique);
        //TODO: Bulk Update -> Return updated objects
      } else {
        stripTimestampFields(data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("UPDATE", modelStructure, primary_key, false),
        );
        data = RemoveUnknownData(modelStructure, [data]);
        data = jsonStringify(data);
        updateResult = await db.upsert(table, data, unique);
        if (updateResult.hasOwnProperty("id") && updateResult.id > 0) {
          const getResult = await db.get(table, [
            [[primary_key, "=", updateResult.id]],
          ]);
          return getResult.count > 0 ? getResult["data"][0] : null;
        } else if (data[0].hasOwnProperty(primary_key)) {
          const result = await db.get(
            table,
            [[[primary_key, "=", data[0][primary_key]]]],
            [],
            option.safeDelete,
          );
          if (result.count > 0) return result["data"][0];
          else return null;
        }
      }
      return updateResult;
    },
    upsert: async (data) => {
      //* Same as Update but primary key is optional */
      let updateResult = null;
      if (data.hasOwnProperty("data")) {
        stripTimestampFields(data.data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", modelStructure, primary_key, true),
        );
        data = data.data;
        data = RemoveUnknownData(modelStructure, data);
        data = jsonStringify(data);
        updateResult = await db.upsert(table, data, unique);
        //TODO: Bulk Upsert -> Return Inserted/Updated objects
      } else {
        stripTimestampFields(data, allTimestampKeys);
        await validateInput(
          data,
          getPayloadValidator("CREATE", modelStructure, primary_key, false),
        );
        data = RemoveUnknownData(modelStructure, [data]);
        data = jsonStringify(data);
        updateResult = await db.upsert(table, data, unique);
        if (updateResult.hasOwnProperty("id")) {
          const getResult = await db.get(table, [
            [[primary_key, "=", updateResult.id]],
          ]);
          return getResult.count > 0 ? getResult["data"][0] : null;
        } else if (data.hasOwnProperty(primary_key)) {
          const result = await db.get(
            table,
            [[[primary_key, "=", data[primary_key]]]],
            option.safeDelete,
          );
          if (result.count > 0) return result["data"][0];
          else return null;
        }
      }
      return updateResult;
    },
    remove: async (data) => {
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      return await db.remove(table, filter, option.safeDelete);
    },
    byId: async (id, options = {}) => {
      let type = getType(id);
      if (type === "string" || type === "number") {
        const result = await db.get(
          table,
          [[[primary_key, "=", id]]],
          [],
          option.safeDelete,
        );
        if (result.count > 0) {
          let record = result["data"][0];
          if (options.select_columns)
            record = applySelect(record, options.select_columns);
          return record;
        } else return null;
      } else {
        throw new Error("Invalid id value", { cause: { status: 422 } });
      }
    },
    //TODO: Implement Sort Logic
    find: async (data) => {
      const { select_columns } = extractReservedParams(data);
      let sort = [];
      if (data.hasOwnProperty("sort")) {
        sort = data.sort;
        delete data.sort;
        sort = jsonSafeParse(sort);
      }
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      const result = await db.get(table, filter, sort, option.safeDelete);
      if (select_columns)
        result.data = applySelect(result.data, select_columns);
      return result;
    },
    findOne: async (data) => {
      const { select_columns } = extractReservedParams(data);
      let sort = [];
      if (data.hasOwnProperty("sort")) {
        sort = data.sort;
        delete data.sort;
        sort = jsonSafeParse(sort);
      }
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      let result = await db.get(table, filter, sort, option.safeDelete);
      if (result.count > 0) {
        let record = result["data"][0];
        if (select_columns) record = applySelect(record, select_columns);
        return record;
      } else {
        return false;
      }
    },
    list: async (data) => {
      const { select_columns } = extractReservedParams(data);
      let page = 0;
      let size = 30;
      let sort = [];
      if (data.hasOwnProperty("page")) {
        page = parseInt(data.page, 10);
        if (isNaN(page) || page < 0) page = 0;
        delete data.page;
      }
      if (data.hasOwnProperty("size")) {
        size = parseInt(data.size, 10);
        if (isNaN(size) || size < 1) size = 30;
        if (size > 200) size = 200;
        delete data.size;
      }
      if (data.hasOwnProperty("sort")) {
        sort = data.sort;
        delete data.sort;
      }
      let filter = dataToFilter(jsonSafeParse(data), primary_key);
      sort = jsonSafeParse(sort);
      const result = await db.list(
        table,
        filter,
        sort,
        option.safeDelete,
        page,
        size,
      );
      if (select_columns)
        result.data = applySelect(result.data, select_columns);
      return result;
    },
    patch: async (data) => {
      // Partial update — fetch existing, merge patch fields, then upsert
      stripTimestampFields(data, allTimestampKeys);
      if (!data.hasOwnProperty(primary_key)) {
        throw new Error("Primary key is required for patch", {
          cause: { status: 422 },
        });
      }
      const pkValue = data[primary_key];
      // Fetch existing record
      const existing = await db.get(
        table,
        [[[primary_key, "=", pkValue]]],
        [],
        option.safeDelete,
      );
      if (existing.count === 0) return null;
      // Merge: start with existing, overlay only known fields from patch
      const merged = { ...existing.data[0] };
      for (const key of Object.keys(data)) {
        if (key === primary_key) continue;
        if (modelStructure.hasOwnProperty(key)) {
          merged[key] = data[key];
        }
      }
      const pkOrig = merged[primary_key];
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
      );
      if (result.count > 0) return result["data"][0];
      return null;
    },
    pk: primary_key,
    modelStructure,
    table,
  };
};

// Export format helpers for route.js
module.exports.toCSV = toCSV;
module.exports.toXML = toXML;
module.exports.applySelect = applySelect;
module.exports.extractReservedParams = extractReservedParams;
