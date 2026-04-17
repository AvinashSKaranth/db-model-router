const mysql = require("mysql2");
const { jsonSafeParse } = require("../commons/function");
let pool = null;
const WHERE_INVALID = "Invalid filter object";

function connect(credentails) {
  pool = mysql.createPool(credentails);
  return pool;
}
function query(sql, parameter = []) {
  return new Promise((resolve, reject) => {
    pool.query(sql, parameter, function (error, results) {
      if (error) {
        reject(error);
      }
      resolve(results);
    });
  });
}

function sort_builder(sort) {
  if (sort.length < 1) {
    return {
      query: "",
      value: [],
    };
  }
  let query_item = [];
  let value = [];
  for (const item of sort) {
    if (item[0] === "-") {
      query_item.push("?? DESC");
      value.push(item.replace("-", ""));
    } else {
      query_item.push("?? ASC");
      value.push(item);
    }
  }
  let query = "ORDER BY " + query_item.join(",");
  return {
    query,
    value,
  };
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
        return {
          query: "",
          value: [],
        };
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
  let conditionOr = [];
  let value = [];
  for (const i of filter) {
    let conditionAnd = [];
    for (const j of i) {
      if (!valid_conditionals.includes(j[1])) {
        return null;
      }
      if ((j[1] === "in" || j[1] === "not in") && !Array.isArray(j[2])) {
        return null;
      }
      if (j[1] === "in" || j[1] === "not in") {
        conditionAnd.push("?? " + j[1] + " " + arrayParam(j[2].length) + "");
        value.push(j[0], ...j[2]);
      } else if (j[1] === "like" || j[1] === "not like") {
        conditionAnd.push("?? " + j[1] + " ?");
        value.push(j[0], "%" + j[2] + "%");
      } else {
        conditionAnd.push("?? " + j[1] + " ?");
        value.push(j[0], j[2]);
      }
    }
    conditionOr.push(conditionAnd.join(" AND "));
  }
  let query = "WHERE ((" + conditionOr.join(") OR (") + "))";
  return {
    query,
    value,
  };
}
function get(table, filter = [], sort = [], safeDelete = null) {
  const response = {};
  return new Promise((resolve, reject) => {
    if (safeDelete !== null) {
      for (const filterItem of filter) {
        filterItem.push([safeDelete, "=", 0]);
      }
    }
    const whereData = where(filter, safeDelete);
    const sortData = sort_builder(sort);
    const statement = `SELECT * FROM ?? ${whereData["query"]} ${sortData["query"]};`;
    pool.query(
      statement,
      [table, ...whereData["value"], ...sortData["value"]],
      function (error, results) {
        if (error) {
          reject({ message: error.sqlMessage });
        }
        response["data"] = jsonSafeParse(results);
        response["count"] = qcount(table, filter, safeDelete).then((count) => {
          response["count"] = count;
          resolve(response);
        });
      },
    );
  });
}

function list(
  table,
  filter = [],
  sort = [],
  safeDelete = null,
  page = 0,
  limit = 30,
) {
  const response = {};
  return new Promise((resolve, reject) => {
    const whereData = where(filter, safeDelete);
    const sortData = sort_builder(sort);
    if (whereData == null) {
      reject({ message: WHERE_INVALID });
    }
    const statement = `SELECT * FROM ?? ${whereData["query"]} ${sortData["query"]} LIMIT ? OFFSET ?;`;
    pool.query(
      statement,
      [table, ...whereData["value"], ...sortData["value"], limit, page * limit],
      function (error, results) {
        if (error) {
          reject({ message: error.sqlMessage });
        }
        response["data"] = jsonSafeParse(results);
        response["count"] = qcount(table, filter, safeDelete).then((count) => {
          response["count"] = count;
          resolve(response);
        });
      },
    );
  });
}

function qcount(table, filter, safeDelete = null) {
  return new Promise((resolve) => {
    const whereData = where(filter, safeDelete);
    if (whereData == null) {
      reject({ message: WHERE_INVALID });
    }
    const statement = `SELECT count(*) AS number FROM ?? ${whereData["query"]};`;
    pool.query(
      statement,
      [table, ...whereData["value"]],
      function (error, results) {
        if (error || results === "undefined") {
          resolve(0);
        } else {
          resolve(results[0].number);
        }
      },
    );
  });
}

function remove(table, filter, safeDelete = null) {
  return new Promise((resolve, reject) => {
    const whereData = where(filter);
    if (whereData == null) {
      reject({ message: WHERE_INVALID });
    }
    if (whereData.value.length < 1) {
      reject({ status: "unable to remove as there is not filter attributes" });
    } else {
      let statement = "";
      if (safeDelete != null) {
        statement = `UPDATE  ?? SET ?? = 1  ${whereData["query"]};`;
      } else {
        statement = `DELETE FROM ?? ${whereData["query"]};`;
      }
      pool.query(
        statement,
        safeDelete != null
          ? [table, safeDelete, ...whereData["value"]]
          : [table, ...whereData["value"]],
        function (error, results) {
          if (error || results === undefined) {
            reject({ message: error.sqlMessage });
          }
          if (results) {
            let rows = results.affectedRows || 0;
            resolve({
              message: rows + " " + table + (rows > 1 ? "s" : "") + " removed",
            });
          }
        },
      );
    }
  });
}

function upsert(table, data, uniqueKeys = []) {
  return new Promise((resolve, reject) => {
    let array = [];
    const promise = [];
    let count = 0;
    let total = 0;
    if (!isset(data[0])) {
      array.push(data);
    } else {
      array = data;
    }
    const [statement, insertColumn, updateColumn] = getChangeParameter(
      array[0],
      uniqueKeys,
    );
    let value = [];
    for (const [i, v] of Object.entries(array)) {
      if (array.hasOwnProperty(i)) {
        const entry = [];
        for (const col of insertColumn) {
          entry.push(v[col]);
        }
        value.push(entry);
        count++;
        total++;
        if (count > 999) {
          promise.push(
            pool
              .promise()
              .query(
                statement,
                [table, ...insertColumn, value, ...updateColumn],
                function (_error, results) {
                  if (error) {
                    reject(error);
                  }
                  resolve(results);
                },
              ),
          );
          value = [];
          count = 0;
        }
      }
    }
    if (count > 0) {
      promise.push(
        pool
          .promise()
          .query(
            statement,
            [table, ...insertColumn, value, ...updateColumn],
            function (error, results) {
              if (error) {
                reject(error);
              }
              resolve(results);
            },
          ),
      );
    }

    const response = {
      rows: total,
      message:
        (total === 1
          ? `1 ${namify(table)} is `
          : `${total} ${namify(table)}s are `) + "saved",
      type: "success",
    };
    Promise.all(promise)
      .then((results) => {
        try {
          if (total === 1) {
            response["id"] = results[0][0].insertId;
          }
          resolve(response);
        } catch (err) {
          reject(err);
        }
      })
      .catch((error) => {
        reject({ message: error.sqlMessage, type: "danger" });
      });
  });
}

function getChangeParameter(row, uniqueKeys, onDuplicate = true) {
  const insertColumn = Object.keys(row);
  const updateColumn = [];
  const queryStart =
    "INSERT " +
    (!onDuplicate ? "IGNORE" : "") +
    " INTO ?? " +
    insertParam(insertColumn.length);
  let queryEnd = "";
  if (onDuplicate) {
    queryEnd = " ON DUPLICATE KEY UPDATE ";
    for (const column of insertColumn) {
      if (!uniqueKeys.includes(column)) {
        if (queryEnd !== " ON DUPLICATE KEY UPDATE ") {
          queryEnd += ",";
        }
        queryEnd += "??=DATA.??";
        updateColumn.push(column);
        updateColumn.push(column);
      }
    }
  }
  queryEnd += ";";
  return [
    `${queryStart} VALUES ? AS DATA ${queryEnd}`,
    insertColumn,
    updateColumn,
  ];
}
function insertParam(number) {
  let str = "";
  for (let i = 0; i < number; i++) {
    if (i === 0) {
      str = "??";
    } else {
      str = str + ",??";
    }
  }
  return `(${str})`;
}
function arrayParam(number) {
  let str = "";
  for (let i = 0; i < number; i++) {
    if (i === 0) {
      str = "?";
    } else {
      str = str + ",?";
    }
  }
  return `(${str})`;
}
function isset(obj) {
  return typeof obj !== "undefined";
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
  pool,
  insert,
};

function insert(table, data, uniqueKeys = []) {
  return new Promise((resolve, reject) => {
    let array = [];
    const promise = [];
    let count = 0;
    let total = 0;
    if (!isset(data[0])) {
      array.push(data);
    } else {
      array = data;
    }
    const [statement, insertColumn, updateColumn] = getChangeParameter(
      array[0],
      uniqueKeys,
      false,
    );
    let value = [];
    for (const [i, v] of Object.entries(array)) {
      if (array.hasOwnProperty(i)) {
        const entry = [];
        for (const col of insertColumn) {
          entry.push(v[col]);
        }
        value.push(entry);
        count++;
        total++;
        if (count > 999) {
          promise.push(
            pool
              .promise()
              .query(
                statement,
                [table, ...insertColumn, value],
                function (_error, results) {
                  if (error) {
                    reject(error);
                  }
                  resolve(results);
                },
              ),
          );
          value = [];
          count = 0;
        }
      }
    }
    if (count > 0) {
      promise.push(
        pool
          .promise()
          .query(
            statement,
            [table, ...insertColumn, value],
            function (error, results) {
              if (error) {
                reject(error);
              }
              resolve(results);
            },
          ),
      );
    }

    const response = {
      rows: total,
      message:
        (total === 1
          ? `1 ${namify(table)} is `
          : `${total} ${namify(table)}s are `) + "saved",
      type: "success",
    };
    Promise.all(promise)
      .then((results) => {
        try {
          if (total === 1) {
            response["id"] = results[0][0].insertId;
          }
          resolve(response);
        } catch (err) {
          reject(err);
        }
      })
      .catch((error) => {
        reject({ message: error.sqlMessage, type: "danger" });
      });
  });
}
/*
function update(table, data, uniqueKeys = []) {
  return new Promise((resolve) => {
    let array = [];
    const promise = [];
    let count = 0;
    let total = 0;
    if (!isset(data[0])) {
      array.push(data);
    } else {
      array = data;
    }
    const [statement, insertColumn, updateColumn] = getChangeParameter(
      array[0],
      uniqueKeys
    );
    let value = [];
    for (const [i, v] of Object.entries(array)) {
      if (array.hasOwnProperty(i)) {
        const entry = [];
        for (const col of insertColumn) {
          entry.push(v[col]);
        }
        value.push(entry);
        count++;
        total++;
        if (count > 999) {
          promise.push(
            pool
              .promise()
              .query(
                statement,
                [table, ...insertColumn, value, ...updateColumn],
                function (_error, results) {
                  resolve(results);
                }
              )
          );
          value = [];
          count = 0;
        }
      }
    }
    if (count > 0) {
      promise.push(
        pool
          .promise()
          .query(
            statement,
            [table, ...insertColumn, value, ...updateColumn],
            function (_error, results) {
              resolve(results);
            }
          )
      );
    }

    const response = {
      rows: total,
      message:
        (total === 1
          ? `1 ${namify(table)} is `
          : `${total} ${namify(table)}s are `) + "saved",
      type: "success",
    };
    Promise.all(promise)
      .then((results) => {
        try {
          if (total === 1) {
            response["id"] = results[0][0].insertId;
          }
        } catch (err) {}
        resolve(response);
      })
      .catch((error) => {
        resolve({ message: error.sqlMessage, type: "danger" });
      });
  });
}*/
