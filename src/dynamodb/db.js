const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { jsonSafeParse } = require("../commons/function");

let docClient = null;
let tablePrefix = "";
let primaryKey = "id";
const WHERE_INVALID = "Invalid filter object";

function connect(config) {
  const clientConfig = {};
  if (config.region) clientConfig.region = config.region;
  if (config.endpoint) clientConfig.endpoint = config.endpoint;
  if (config.accessKeyId && config.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }

  const client = new DynamoDBClient(clientConfig);
  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  tablePrefix = config.tablePrefix || config.prefix || "";
  if (config.primaryKey) primaryKey = config.primaryKey;

  return docClient;
}

function tableName(table) {
  return tablePrefix ? `${tablePrefix}${table}` : table;
}

function where(filter, safeDelete = null) {
  try {
    if (
      filter === null ||
      filter === "" ||
      filter.length === 0 ||
      filter[0].length == [[]] ||
      filter[0][0].length == [[[]]]
    ) {
      if (safeDelete === null) {
        return { query: "", value: {}, names: {} };
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
  let expressionValues = {};
  let expressionNames = {};
  let paramIndex = 0;

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
      const val = condition[2];
      const nameKey = `#col${paramIndex}`;
      expressionNames[nameKey] = field;

      switch (op) {
        case "=":
          expressionValues[`:val${paramIndex}`] = val;
          andConditions.push(`${nameKey} = :val${paramIndex}`);
          break;
        case "!=":
          expressionValues[`:val${paramIndex}`] = val;
          andConditions.push(`${nameKey} <> :val${paramIndex}`);
          break;
        case "<":
        case ">":
        case "<=":
        case ">=":
          expressionValues[`:val${paramIndex}`] = val;
          andConditions.push(`${nameKey} ${op} :val${paramIndex}`);
          break;
        case "like":
          expressionValues[`:val${paramIndex}`] = val;
          andConditions.push(`contains(${nameKey}, :val${paramIndex})`);
          break;
        case "not like":
          expressionValues[`:val${paramIndex}`] = val;
          andConditions.push(`NOT contains(${nameKey}, :val${paramIndex})`);
          break;
        case "in": {
          const inParts = [];
          for (let k = 0; k < val.length; k++) {
            const inKey = `:val${paramIndex}_${k}`;
            expressionValues[inKey] = val[k];
            inParts.push(inKey);
          }
          andConditions.push(`${nameKey} IN (${inParts.join(", ")})`);
          break;
        }
        case "not in": {
          const ninParts = [];
          for (let k = 0; k < val.length; k++) {
            const ninKey = `:val${paramIndex}_${k}`;
            expressionValues[ninKey] = val[k];
            ninParts.push(ninKey);
          }
          andConditions.push(`NOT ${nameKey} IN (${ninParts.join(", ")})`);
          break;
        }
      }
      paramIndex++;
    }
    if (andConditions.length > 0) {
      orGroups.push(andConditions.join(" AND "));
    }
  }

  let filterExpression = "";
  if (orGroups.length === 1) {
    filterExpression = orGroups[0];
  } else if (orGroups.length > 1) {
    filterExpression = orGroups.map((g) => `(${g})`).join(" OR ");
  }

  return {
    query: filterExpression,
    value: expressionValues,
    names: expressionNames,
  };
}

async function get(table, filter = [], sort = [], safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }

  const params = { TableName: tableName(table) };
  if (whereData.query) {
    params.FilterExpression = whereData.query;
    params.ExpressionAttributeValues = whereData.value;
    params.ExpressionAttributeNames = whereData.names;
  }

  // Scan all items (handle pagination internally to get all results)
  let items = [];
  let lastKey = undefined;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await docClient.send(new ScanCommand(params));
    items = items.concat(result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Apply sort in-memory
  if (sort && sort.length > 0) {
    items = sortItems(items, sort);
  }

  return { data: jsonSafeParse(items), count: items.length };
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

  // Get total count first
  const count = await qcount(table, filter, safeDelete);

  // Scan all matching items (DynamoDB Limit applies before FilterExpression)
  const params = { TableName: tableName(table) };
  if (whereData.query) {
    params.FilterExpression = whereData.query;
    params.ExpressionAttributeValues = whereData.value;
    params.ExpressionAttributeNames = whereData.names;
  }

  let items = [];
  let lastKey = undefined;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await docClient.send(new ScanCommand(params));
    items = items.concat(result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Apply sort in-memory
  if (sort && sort.length > 0) {
    items = sortItems(items, sort);
  }

  // Apply pagination in-memory
  const offset = page * limit;
  const paged = items.slice(offset, offset + limit);

  return { data: jsonSafeParse(paged), count };
}

async function qcount(table, filter, safeDelete = null) {
  const whereData = where(filter, safeDelete);
  if (whereData == null) {
    return 0;
  }

  try {
    const params = {
      TableName: tableName(table),
      Select: "COUNT",
    };
    if (whereData.query) {
      params.FilterExpression = whereData.query;
      params.ExpressionAttributeValues = whereData.value;
      params.ExpressionAttributeNames = whereData.names;
    }

    let total = 0;
    let lastKey = undefined;
    do {
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const result = await docClient.send(new ScanCommand(params));
      total += result.Count || 0;
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return total;
  } catch (err) {
    return 0;
  }
}

async function remove(table, filter, safeDelete = null) {
  const whereData = where(filter);
  if (whereData == null) {
    throw new Error(WHERE_INVALID);
  }
  if (!whereData.query && Object.keys(whereData.value).length < 1) {
    throw new Error("unable to remove as there are no filter attributes");
  }

  // First get matching items to find their keys
  const items = await getAllMatchingItems(table, whereData);

  if (safeDelete != null) {
    // Soft delete: update each item
    for (const item of items) {
      const key = extractKey(item);
      await docClient.send(
        new UpdateCommand({
          TableName: tableName(table),
          Key: key,
          UpdateExpression: `SET #sd = :sdVal`,
          ExpressionAttributeNames: { "#sd": safeDelete },
          ExpressionAttributeValues: { ":sdVal": 1 },
        }),
      );
    }
  } else {
    // Hard delete
    for (const item of items) {
      const key = extractKey(item);
      await docClient.send(
        new DeleteCommand({
          TableName: tableName(table),
          Key: key,
        }),
      );
    }
  }

  const rows = items.length;
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
    const key = {};
    for (const k of uniqueKeys) {
      key[k] = row[k];
    }

    const nonKeyFields = Object.keys(row).filter(
      (k) => !uniqueKeys.includes(k),
    );
    if (nonKeyFields.length === 0) {
      // Only key fields, just put the item
      await docClient.send(
        new PutCommand({
          TableName: tableName(table),
          Item: row,
        }),
      );
      lastId = key[uniqueKeys[0]];
    } else {
      const updateParts = [];
      const exprValues = {};
      const exprNames = {};
      nonKeyFields.forEach((field, idx) => {
        exprNames[`#f${idx}`] = field;
        exprValues[`:v${idx}`] = row[field];
        updateParts.push(`#f${idx} = :v${idx}`);
      });

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName(table),
            Key: key,
            UpdateExpression: `SET ${updateParts.join(", ")}`,
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValues,
          }),
        );
      } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
          const dupError = new Error(err.message);
          dupError.code = "ER_DUP_ENTRY";
          dupError.sqlMessage = err.message;
          throw dupError;
        }
        if (err.name === "ResourceNotFoundException") {
          const notFoundError = new Error(err.message);
          notFoundError.sqlMessage = err.message;
          throw notFoundError;
        }
        throw err;
      }
      lastId = key[uniqueKeys[0]];
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

async function insert(table, data, uniqueKeys = []) {
  let array = Array.isArray(data) ? [...data] : [data];
  const total = array.length;

  // Auto-generate primary key (UUID) for items missing it
  const pkField = (uniqueKeys && uniqueKeys[0]) || primaryKey;
  for (const item of array) {
    if (item[pkField] == null || item[pkField] === "") {
      item[pkField] = crypto.randomUUID();
    }
  }

  try {
    if (total === 1) {
      await docClient.send(
        new PutCommand({
          TableName: tableName(table),
          Item: array[0],
        }),
      );

      const response = {
        rows: 1,
        message: `1 ${namify(table)} is saved`,
        type: "success",
      };
      if (array[0][pkField] != null) {
        response.id = array[0][pkField];
      }
      return response;
    } else {
      // Batch write (max 25 items per batch)
      const batches = [];
      for (let i = 0; i < array.length; i += 25) {
        batches.push(array.slice(i, i + 25));
      }

      for (const batch of batches) {
        const requestItems = {
          [tableName(table)]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        };
        await docClient.send(
          new BatchWriteCommand({ RequestItems: requestItems }),
        );
      }

      return {
        rows: total,
        message: `${total} ${namify(table)}s are saved`,
        type: "success",
      };
    }
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      const dupError = new Error(err.message);
      dupError.code = "ER_DUP_ENTRY";
      dupError.sqlMessage = err.message;
      throw dupError;
    }
    if (err.name === "ResourceNotFoundException") {
      const notFoundError = new Error(err.message);
      notFoundError.sqlMessage = err.message;
      throw notFoundError;
    }
    throw err;
  }
}

async function disconnect() {
  docClient = null;
  tablePrefix = "";
}

// --- Utility helpers ---

async function getAllMatchingItems(table, whereData) {
  const params = { TableName: tableName(table) };
  if (whereData.query) {
    params.FilterExpression = whereData.query;
    params.ExpressionAttributeValues = whereData.value;
    params.ExpressionAttributeNames = whereData.names;
  }

  let items = [];
  let lastKey = undefined;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await docClient.send(new ScanCommand(params));
    items = items.concat(result.Items || []);
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

function extractKey(item) {
  // For DynamoDB, we need to know the key schema.
  // We use the primaryKey configured at connect time.
  const key = {};
  if (item[primaryKey] != null) {
    key[primaryKey] = item[primaryKey];
  }
  return key;
}

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
