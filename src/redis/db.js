const Redis = require("ioredis");
const { jsonSafeParse } = require("../commons/function");

let client = null;
let primaryKey = "id";
const WHERE_INVALID = "Invalid filter object";

function connect(config) {
  const options = {};
  if (config.host) options.host = config.host;
  if (config.port) options.port = config.port;
  if (config.password) options.password = config.password;
  if (config.db != null) options.db = config.db;

  if (config.primaryKey) primaryKey = config.primaryKey;

  client = new Redis(options);
  return client;
}

function where(filter, safeDelete = null) {
  if (filter !== null && filter !== "" && !Array.isArray(filter)) {
    return null;
  }
  try {
    if (
      filter === null ||
      filter === "" ||
      filter.length === 0 ||
      (Array.isArray(filter[0]) && filter[0].length === 0) ||
      (Array.isArray(filter[0]) &&
        Array.isArray(filter[0][0]) &&
        filter[0][0].length === 0)
    ) {
      if (safeDelete === null) {
        return { query: () => true, value: [] };
      } else {
        filter = [[]];
      }
    }
  } catch (err) {
    return null;
  }

  if (safeDelete !== null) {
    for (const filterItem of filter) {
      filterItem.push([safeDelete, "=", 0]);
    }
  }

  const valid_conditionals = [
    "=",
    "like",
    "not like",
    "in",
    "not in",
    "<",
    ">",
    "<=",
    ">=",
    "!=",
  ];

  // Build filter groups for in-memory evaluation
  const orGroups = [];

  for (const group of filter) {
    const andConditions = [];
    for (const condition of group) {
      if (!valid_conditionals.includes(condition[1])) {
        return null;
      }
      if (
        (condition[1] === "in" || condition[1] === "not in") &&
        !Array.isArray(condition[2])
      ) {
        return null;
      }

      const field = condition[0];
      const op = condition[1];
      const val = condition[2];

      andConditions.push(buildMatcher(field, op, val));
    }
    if (andConditions.length > 0) {
      orGroups.push(andConditions);
    }
  }

  const filterFn = (record) => {
    if (orGroups.length === 0) return true;
    return orGroups.some((andGroup) =>
      andGroup.every((matcher) => matcher(record)),
    );
  };

  return { query: filterFn, value: [] };
}

function buildMatcher(field, op, val) {
  switch (op) {
    case "=":
      return (rec) => coerce(rec[field]) == val;
    case "!=":
      return (rec) => coerce(rec[field]) != val;
    case "<":
      return (rec) => Number(rec[field]) < Number(val);
    case ">":
      return (rec) => Number(rec[field]) > Number(val);
    case "<=":
      return (rec) => Number(rec[field]) <= Number(val);
    case ">=":
      return (rec) => Number(rec[field]) >= Number(val);
    case "like":
      return (rec) => {
        const str = String(rec[field] || "").toLowerCase();
        return str.includes(String(val).toLowerCase());
      };
    case "not like":
      return (rec) => {
        const str = String(rec[field] || "").toLowerCase();
        return !str.includes(String(val).toLowerCase());
      };
    case "in":
      return (rec) => {
        const v = coerce(rec[field]);
        return val.some((item) => item == v);
      };
    case "not in":
      return (rec) => {
        const v = coerce(rec[field]);
        return !val.some((item) => item == v);
      };
    default:
      return () => true;
  }
}

function coerce(val) {
  if (val === undefined || val === null) return val;
  // Redis stores everything as strings; try to coerce back to number
  const num = Number(val);
  if (!isNaN(num) && String(num) === val) return num;
  return val;
}

async function scanAllKeys(pattern) {
  const keys = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await client.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

async function getAllRecords(table) {
  const pattern = `${table}:*`;
  const keys = await scanAllKeys(pattern);
  // Filter out the sequence key
  const seqKey = `${table}:__seq`;
  const recordKeys = keys.filter((k) => k !== seqKey);

  if (recordKeys.length === 0) return [];

  const records = [];
  for (const key of recordKeys) {
    const hash = await client.hgetall(key);
    if (hash && Object.keys(hash).length > 0) {
      records.push(parseRecord(hash));
    }
  }
  return records;
}

function parseRecord(hash) {
  const record = {};
  for (const [key, val] of Object.entries(hash)) {
    // Try to parse JSON values (for nested objects/arrays)
    try {
      record[key] = JSON.parse(val);
    } catch {
      // Try numeric coercion
      const num = Number(val);
      if (!isNaN(num) && String(num) === val) {
        record[key] = num;
      } else {
        record[key] = val;
      }
    }
  }
  return record;
}

function flattenForHash(data) {
  const flat = {};
  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) {
      flat[key] = "";
    } else if (typeof val === "object") {
      flat[key] = JSON.stringify(val);
    } else {
      flat[key] = String(val);
    }
  }
  return flat;
}

async function get(table, filter = [], sort = [], safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  let records = await getAllRecords(table);
  records = records.filter(whereData.query);

  if (sort && sort.length > 0) {
    records = sortItems(records, sort);
  }

  return { data: jsonSafeParse(records), count: records.length };
}

async function list(
  table,
  filter = [],
  sort = [],
  safeDelete = null,
  page = 0,
  limit = 30,
) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  let records = await getAllRecords(table);
  records = records.filter(whereData.query);

  if (sort && sort.length > 0) {
    records = sortItems(records, sort);
  }

  const count = records.length;
  const offset = page * limit;
  const paged = records.slice(offset, offset + limit);

  return { data: jsonSafeParse(paged), count };
}

async function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    return 0;
  }
  try {
    let records = await getAllRecords(table);
    records = records.filter(whereData.query);
    return records.length;
  } catch (err) {
    return 0;
  }
}

async function remove(table, filter, safeDelete = null) {
  const whereData = where(filter);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  // Check if filter is effectively empty
  let records = await getAllRecords(table);
  const allMatch = records.filter(whereData.query);

  // If the filter was empty (matches everything), check if we have actual filter conditions
  const emptyFilter = where(filter);
  if (
    emptyFilter &&
    typeof emptyFilter.query === "function" &&
    filter != null &&
    (filter === "" ||
      filter.length === 0 ||
      (filter.length > 0 && filter[0].length === 0))
  ) {
    throw new Error("unable to remove as there are no filter attributes");
  }

  if (safeDelete != null) {
    for (const record of allMatch) {
      const pkVal = record[primaryKey];
      if (pkVal != null) {
        await client.hset(`${table}:${pkVal}`, safeDelete, "1");
      }
    }
  } else {
    for (const record of allMatch) {
      const pkVal = record[primaryKey];
      if (pkVal != null) {
        await client.del(`${table}:${pkVal}`);
      }
    }
  }

  const rows = allMatch.length;
  return {
    message: rows + " " + table + (rows > 1 ? "s" : "") + " removed",
  };
}

async function upsert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;

  if (!uniqueKeys || uniqueKeys.length === 0) {
    return insert(table, data, uniqueKeys);
  }

  let lastId = null;
  for (const row of array) {
    // Find existing record by unique keys
    let pkVal = row[primaryKey];

    if (pkVal == null) {
      // Try to find existing record by unique key match
      const records = await getAllRecords(table);
      const existing = records.find((rec) =>
        uniqueKeys.every((k) => rec[k] != null && rec[k] == row[k]),
      );
      if (existing) {
        pkVal = existing[primaryKey];
      } else {
        // Generate new id
        pkVal = await client.incr(`${table}:__seq`);
      }
    }

    const record = { ...row, [primaryKey]: pkVal };
    const flat = flattenForHash(record);
    await client.hset(`${table}:${pkVal}`, flat);
    lastId = pkVal;
  }

  const response = {
    rows: total,
    message:
      (total === 1
        ? `1 ${namify(table)} is `
        : `${total} ${namify(table)}s are `) + "saved",
    type: "success",
  };
  if (total === 1 && lastId != null) {
    response.id = lastId;
  }
  return response;
}

async function insert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;

  try {
    let lastId = null;
    for (const row of array) {
      let pkVal = row[primaryKey];

      if (pkVal == null) {
        // Auto-generate id using Redis INCR
        pkVal = await client.incr(`${table}:__seq`);
      }

      const record = { ...row, [primaryKey]: pkVal };
      const flat = flattenForHash(record);
      await client.hset(`${table}:${pkVal}`, flat);
      lastId = pkVal;
    }

    const response = {
      rows: total,
      message:
        (total === 1
          ? `1 ${namify(table)} is `
          : `${total} ${namify(table)}s are `) + "saved",
      type: "success",
    };
    if (total === 1 && lastId != null) {
      response.id = lastId;
    }
    return response;
  } catch (err) {
    throw err;
  }
}

async function disconnect() {
  if (client) {
    await client.quit();
    client = null;
  }
}

// --- Utility helpers ---

function sortItems(items, sort) {
  return [...items].sort((a, b) => {
    for (const s of sort) {
      let field, dir;
      if (s[0] === "-") {
        field = s.substring(1);
        dir = -1;
      } else {
        field = s;
        dir = 1;
      }
      if (a[field] < b[field]) return -1 * dir;
      if (a[field] > b[field]) return 1 * dir;
    }
    return 0;
  });
}

function namify(text) {
  return text
    .replace("_", " ")
    .replace(/(^\w{1})|(\s+\w{1})/g, (letter) => letter.toUpperCase());
}

module.exports = {
  connect,
  get,
  list,
  where,
  qcount,
  remove,
  upsert,
  change: upsert,
  insert,
  disconnect,
  close: disconnect,
};
