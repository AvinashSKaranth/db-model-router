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
  let filterCopy;
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
        filterCopy = [[]];
      }
    } else {
      // Clone filter array to prevent in-place mutation of caller's data
      filterCopy = filter.map((group) => group.map((cond) => [...cond]));
    }
  } catch {
    return null;
  }

  if (safeDelete !== null) {
    for (const filterItem of filterCopy) {
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

  for (const group of filterCopy) {
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
  const BATCH_SIZE = 1000;
  for (let i = 0; i < recordKeys.length; i += BATCH_SIZE) {
    const batch = recordKeys.slice(i, i + BATCH_SIZE);
    const pipe = client.pipeline();
    for (const key of batch) {
      pipe.hgetall(key);
    }
    const results = await pipe.exec();
    if (results) {
      for (const [err, hash] of results) {
        if (err) throw err;
        if (hash && Object.keys(hash).length > 0) {
          records.push(parseRecord(hash));
        }
      }
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

async function get(table, filter = [], sort = [], safeDelete = null, options = {}) {
  const { count = true, limit } = options || {};
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  let records = await getAllRecords(table);
  records = records.filter(whereData.query);

  if (sort && sort.length > 0) {
    records = sortItems(records, sort);
  }
  const totalCount = records.length;
  if (limit != null) {
    records = records.slice(0, parseInt(limit, 10));
  }

  return { data: jsonSafeParse(records), count: count !== false ? totalCount : records.length };
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
  } catch {
    return 0;
  }
}

async function remove(table, filter, safeDelete = null) {
  const whereData = where(filter);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  // Guard against empty filters at any nesting level to prevent accidental mass deletion
  const isFilterEmpty =
    !filter ||
    filter === "" ||
    !Array.isArray(filter) ||
    filter.length === 0 ||
    filter.every(
      (group) =>
        !Array.isArray(group) ||
        group.length === 0 ||
        group.every((cond) => !Array.isArray(cond) || cond.length < 3),
    );
  if (isFilterEmpty) {
    throw new Error("unable to remove as there are no filter attributes");
  }

  let records = await getAllRecords(table);
  const allMatch = records.filter(whereData.query);

  if (safeDelete != null) {
    const BATCH_SIZE = 1000;
    for (let i = 0; i < allMatch.length; i += BATCH_SIZE) {
      const batch = allMatch.slice(i, i + BATCH_SIZE);
      const pipe = client.pipeline();
      for (const record of batch) {
        const pkVal = record[primaryKey];
        if (pkVal != null) {
          pipe.hset(`${table}:${pkVal}`, safeDelete, "1");
        }
      }
      const results = await pipe.exec();
      if (results) {
        for (const [err] of results) {
          if (err) throw err;
        }
      }
    }
  } else {
    const keysToDelete = allMatch
      .map((r) => `${table}:${r[primaryKey]}`)
      .filter((k) => k !== `${table}:null` && k !== `${table}:undefined`);
    const BATCH_SIZE = 1000;
    for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
      const batch = keysToDelete.slice(i, i + BATCH_SIZE);
      if (batch.length > 0) {
        await client.del(...batch);
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

async function insert(table, data, _uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;

  let lastId = null;
    if (total === 1) {
      let pkVal = array[0][primaryKey];
      if (pkVal == null) {
        pkVal = await client.incr(`${table}:__seq`);
      }
      const record = { ...array[0], [primaryKey]: pkVal };
      const flat = flattenForHash(record);
      await client.hset(`${table}:${pkVal}`, flat);
      lastId = pkVal;
    } else {
      const missingCount = array.filter((r) => r[primaryKey] == null).length;
      let nextId = 0;
      if (missingCount > 0) {
        const maxId = await client.incrby(`${table}:__seq`, missingCount);
        nextId = maxId - missingCount + 1;
      }

      const BATCH_SIZE = 1000;
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = array.slice(i, i + BATCH_SIZE);
        const pipe = client.pipeline();
        for (const row of batch) {
          let pkVal = row[primaryKey];
          if (pkVal == null) {
            pkVal = nextId++;
          }
          const record = { ...row, [primaryKey]: pkVal };
          const flat = flattenForHash(record);
          pipe.hset(`${table}:${pkVal}`, flat);
          lastId = pkVal;
        }
        const results = await pipe.exec();
      if (results) {
        for (const [err] of results) {
          if (err) throw err;
        }
      }
      }
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

async function query(cmd, ...args) {
  if (!client) throw new Error("Redis client not connected");
  if (typeof client[cmd] === "function") {
    return await client[cmd](...args);
  }
  return await client.call(cmd, ...args);
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
        field = s.startsWith("+") ? s.substring(1) : s;
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
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = {
  connect,
  get,
  list,
  where,
  sort_builder: sortItems,
  query,
  qcount,
  remove,
  delete: remove,
  upsert,
  change: upsert,
  insert,
  disconnect,
  close: disconnect,
};
