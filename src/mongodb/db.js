const { MongoClient, ObjectId } = require("mongodb");
const { jsonSafeParse } = require("../commons/function");

let client = null;
let database = null;
const WHERE_INVALID = "Invalid filter object";

function connect(config) {
  const username = config.username || config.user || "";
  const password = config.password || "";
  const host = config.host || "localhost";
  const port = config.port || 27017;
  const dbName = config.database || config.db || "test";

  let uri;
  if (config.uri || config.url) {
    uri = config.uri || config.url;
  } else if (username && password) {
    uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  } else {
    uri = `mongodb://${host}:${port}`;
  }

  client = new MongoClient(uri, config.options || {});
  database = client.db(dbName);
  return client;
}

async function query(collection, operation, ...args) {
  const col = database.collection(collection);
  return col[operation](...args);
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
        return { query: {}, value: [] };
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

  let orGroups = [];

  for (const group of filter) {
    let andConditions = [];
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
      let val = condition[2];

      // Convert _id string values to ObjectId when they look like valid ObjectIds
      if (
        field === "_id" &&
        typeof val === "string" &&
        /^[0-9a-fA-F]{24}$/.test(val)
      ) {
        try {
          val = new ObjectId(val);
        } catch (e) {
          /* keep as string */
        }
      }

      switch (op) {
        case "=":
          andConditions.push({ [field]: val });
          break;
        case "!=":
          andConditions.push({ [field]: { $ne: val } });
          break;
        case "<":
          andConditions.push({ [field]: { $lt: val } });
          break;
        case ">":
          andConditions.push({ [field]: { $gt: val } });
          break;
        case "<=":
          andConditions.push({ [field]: { $lte: val } });
          break;
        case ">=":
          andConditions.push({ [field]: { $gte: val } });
          break;
        case "like":
          andConditions.push({
            [field]: { $regex: escapeRegex(val), $options: "i" },
          });
          break;
        case "not like":
          andConditions.push({
            [field]: { $not: { $regex: escapeRegex(val), $options: "i" } },
          });
          break;
        case "in":
          andConditions.push({ [field]: { $in: val } });
          break;
        case "not in":
          andConditions.push({ [field]: { $nin: val } });
          break;
      }
    }

    if (andConditions.length > 0) {
      orGroups.push({ $and: andConditions });
    }
  }

  let mongoQuery = {};
  if (orGroups.length === 1) {
    mongoQuery = orGroups[0];
  } else if (orGroups.length > 1) {
    mongoQuery = { $or: orGroups };
  }

  return { query: mongoQuery, value: [] };
}

async function get(table, filter = [], sort = [], safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  const col = database.collection(table);
  const mongoSort = buildSort(sort);
  const rows = await col.find(whereData.query).sort(mongoSort).toArray();
  const count = await col.countDocuments(whereData.query);
  return { data: jsonSafeParse(rows), count };
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

  const col = database.collection(table);
  const mongoSort = buildSort(sort);
  const rows = await col
    .find(whereData.query)
    .sort(mongoSort)
    .skip(page * limit)
    .limit(limit)
    .toArray();
  const count = await col.countDocuments(whereData.query);
  return { data: jsonSafeParse(rows), count };
}

async function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    return 0;
  }
  try {
    const col = database.collection(table);
    return await col.countDocuments(whereData.query);
  } catch (err) {
    return 0;
  }
}

async function remove(table, filter, safeDelete = null) {
  const whereData = where(filter);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }
  if (Object.keys(whereData.query).length < 1 && whereData.value.length < 1) {
    throw new Error("unable to remove as there are no filter attributes");
  }

  const col = database.collection(table);

  if (safeDelete != null) {
    const result = await col.updateMany(whereData.query, {
      $set: { [safeDelete]: 1 },
    });
    const rows = result.modifiedCount || 0;
    return {
      message: rows + " " + table + (rows > 1 ? "s" : "") + " removed",
    };
  } else {
    const result = await col.deleteMany(whereData.query);
    const rows = result.deletedCount || 0;
    return {
      message: rows + " " + table + (rows > 1 ? "s" : "") + " removed",
    };
  }
}

async function upsert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;
  const col = database.collection(table);

  if (!uniqueKeys || uniqueKeys.length === 0) {
    return insert(table, data, uniqueKeys);
  }

  let lastId = null;
  for (const row of array) {
    const filterObj = {};
    for (const key of uniqueKeys) {
      let val = row[key];
      // Convert _id string values to ObjectId when they look like valid ObjectIds
      if (
        key === "_id" &&
        typeof val === "string" &&
        /^[0-9a-fA-F]{24}$/.test(val)
      ) {
        try {
          val = new ObjectId(val);
        } catch (e) {
          /* keep as string */
        }
      }
      filterObj[key] = val;
    }
    const updateDoc = { $set: { ...row } };
    // Remove _id from $set as MongoDB doesn't allow modifying _id
    delete updateDoc.$set._id;
    const result = await col.updateOne(filterObj, updateDoc, { upsert: true });
    if (result.upsertedId) {
      lastId = result.upsertedId;
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
  if (total === 1 && lastId) {
    response.id = lastId;
  }
  return response;
}

async function insert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;
  const col = database.collection(table);

  try {
    let lastId = null;
    if (total === 1) {
      const result = await col.insertOne(array[0]);
      lastId = result.insertedId;
    } else {
      const result = await col.insertMany(array, { ordered: false });
      // For bulk, no single id to return
    }

    const response = {
      rows: total,
      message:
        (total === 1
          ? `1 ${namify(table)} is `
          : `${total} ${namify(table)}s are `) + "saved",
      type: "success",
    };
    if (total === 1 && lastId) {
      response.id = lastId;
    }
    return response;
  } catch (err) {
    if (err.code === 11000 || (err.message && err.message.includes("E11000"))) {
      const dupError = new Error(err.message);
      dupError.code = "ER_DUP_ENTRY";
      dupError.sqlMessage = err.message;
      throw dupError;
    }
    throw err;
  }
}

async function disconnect() {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}

// --- Utility helpers ---

/**
 * Escape special regex characters in a string so it can be safely used in $regex.
 */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSort(sort) {
  if (!sort || sort.length < 1) {
    return {};
  }
  const sortObj = {};
  for (const item of sort) {
    if (item[0] === "-") {
      sortObj[item.substring(1)] = -1;
    } else {
      sortObj[item] = 1;
    }
  }
  return sortObj;
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
  query,
  qcount,
  remove,
  upsert,
  change: upsert,
  insert,
  disconnect,
  close: disconnect,
};
