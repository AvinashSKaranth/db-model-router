const { Validator } = require("node-input-validator");
const { getType } = require("./function");

const hasProp = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

function RemovePK(modelPK, data) {
  for (const item of data) {
    if (hasProp(item, modelPK)) {
      delete item[modelPK];
    }
  }
}
function RemoveUnknownData(ModelStructure, data) {
  const modelStructure = Object.keys(ModelStructure);
  for (const item of data) {
    for (const i in item) {
      if (!modelStructure.includes(i)) {
        delete item[i];
      }
    }
  }
  return data;
}
function getPayloadValidator(type, structure, pk, bulk = false) {
  if (bulk) {
    const body = {};
    switch (type) {
      case "CREATE":
        body["data"] = "required|array";
        for (const i in structure) {
          if (i !== pk) body[`data.*.${i}`] = structure[i];
        }
        break;
      case "UPDATE":
        body["data"] = "required|array";
        for (const i in structure) {
          body[`data.*.${i}`] = structure[i];
        }
        break;
      case "DELETE":
        body["filter"] = "required|array";
        break;
      default:
        break;
    }
    return body;
  } else {
    const validator = { body: {} };
    switch (type) {
      case "CREATE":
        for (const i in structure) {
          if (i !== pk) validator.body[i] = structure[i];
        }
        break;
      case "UPDATE":
        for (const i in structure) {
          validator.body[i] = structure[i];
        }
        break;
      case "DELETE":
      case "GET":
        validator.body[pk] = structure[pk];
        break;
      default:
        break;
    }
    return validator.body;
  }
}
function errorResponse(res, err) {
  let status = 500;
  if (hasProp(err, "cause") && hasProp(err.cause, "status")) {
    status = err.cause.status;
  }
  // For client errors (4xx), return the validation message.
  // For server/database errors (5xx), return a generic message to avoid leaking internals.
  let message;
  if (status >= 400 && status < 500) {
    message = err.message || "Bad request";
  } else {
    if (
      process.env.NODE_ENV === "development" ||
      process.env.NODE_ENV === "test" ||
      process.env.NODE_ENV === "TEST"
    ) {
      message = err.sqlMessage || err.message || "Internal server error";
    } else {
      message = "Internal server error";
    }
  }
  res.status(status).send({ type: "danger", message });
}
async function validateInput(req, required) {
  let validator = new Validator(req, required);
  const matched = await validator.check();
  if (!matched) {
    const err = new Error(getErrorMessage(validator.errors), {
      cause: { status: 422 },
    });
    err.status = 422;
    throw err;
  }
  return true;
}
function getErrorMessage(errors) {
  let message = "";
  for (const i in errors) {
    if (hasProp(errors, i)) {
      message = message + (message !== "" ? " " : "");
      message = message + errors[i].message;
    }
  }
  return message;
}
function parseFilterValue(value) {
  if (typeof value !== "string") {
    return ["=", value];
  }

  // !in(john,snow,ram) -> not in
  if (/^!in\((.+)\)$/i.test(value)) {
    const items = value.match(/^!in\((.+)\)$/i)[1].split(",").map((v) => v.trim());
    return ["not in", items];
  }

  // in(john,snow,ram) -> in
  if (/^in\((.+)\)$/i.test(value)) {
    const items = value.match(/^in\((.+)\)$/i)[1].split(",").map((v) => v.trim());
    return ["in", items];
  }

  // !%john% -> not like
  if (value.startsWith("!") && value.slice(1).includes("%")) {
    return ["not like", value.slice(1)];
  }

  // %john% -> like
  if (value.includes("%")) {
    return ["like", value];
  }

  // >= (value arrives as >=xxx after URL decoding of >%3Dxxx)
  if (value.startsWith(">=")) {
    return [">=", value.slice(2)];
  }

  // <= (value arrives as <=xxx after URL decoding of <%3Dxxx)
  if (value.startsWith("<=")) {
    return ["<=", value.slice(2)];
  }

  // > greater than
  if (value.startsWith(">")) {
    return [">", value.slice(1)];
  }

  // < less than
  if (value.startsWith("<")) {
    return ["<", value.slice(1)];
  }

  // !value -> not equal
  if (value.startsWith("!")) {
    return ["!=", value.slice(1)];
  }

  return ["=", value];
}

function objectToFilter(obj) {
  let filterArray = [];
  for (let key in obj) {
    let [operator, value] = parseFilterValue(obj[key]);
    filterArray.push([key, operator, value]);
  }
  return [filterArray];
}
function isEmptyFilter(filter) {
  if (!filter || !Array.isArray(filter) || filter.length === 0) return true;
  if (filter.length === 1 && Array.isArray(filter[0]) && filter[0].length === 0) return true;
  if (
    filter.length === 1 &&
    Array.isArray(filter[0]) &&
    filter[0].length === 1 &&
    Array.isArray(filter[0][0]) &&
    filter[0][0].length === 0
  ) {
    return true;
  }
  return false;
}

function dataToFilter(data, primary_key) {
  if (data === null || data === undefined || data === "") {
    const err = new Error("Invalid filter Inputs", { cause: { status: 422 } });
    err.status = 422;
    throw err;
  }
  if (typeof data === "number" || typeof data === "string") {
    return [[[primary_key, "=", data]]];
  }
  let filter;
  let type = getType(data);

  if (type === "array") {
    if (data.length === 0) return [[[]]];
    // If array of primitives (numbers or strings), treat as pk in [...]
    const allPrimitives = data.every((x) => typeof x === "number" || typeof x === "string");
    if (allPrimitives) {
      return [[[primary_key, "in", data]]];
    }
    // If array of objects where each has the primary_key
    const allObjects = data.every((x) => typeof x === "object" && x !== null);
    if (allObjects) {
      const allPkOnly = data.every((x) => Object.keys(x).length === 1 && hasProp(x, primary_key));
      if (allPkOnly) {
        const ids = data.map((x) => x[primary_key]);
        return [[[primary_key, "in", ids]]];
      }
      // Or-combine multiple object conditions
      return data.map((item) => objectToFilter(item)[0]);
    }
    const err = new Error("Invalid filter Inputs", { cause: { status: 422 } });
    err.status = 422;
    throw err;
  }

  if (data && typeof data === "object" && hasProp(data, "data") && Array.isArray(data.data)) {
    return dataToFilter(data.data, primary_key);
  }

  if (hasProp(data, "filter") && getType(data.filter) === "array") {
    filter = JSON.parse(JSON.stringify(data.filter));
    if (Object.keys(data).length > 1) {
      delete data.filter;
      let filter2 = objectToFilter(data);
      if (filter.toString().length > 0) {
        for (let item1 of filter) {
          for (let item2 of filter2[0]) {
            item1.push(item2);
          }
        }
      } else {
        filter = filter2;
      }
    }
  } else if (type === "object" && Object.keys(data).length > 0) {
    filter = objectToFilter(data);
  } else if (type === "number" || type === "string") {
    filter = [[[primary_key, "=", data]]];
  } else if (type === "object" && Object.keys(data).length === 0) {
    filter = [[[]]];
  } else {
    throw new Error("Invalid filter Inputs", { cause: { status: 422 } });
  }
  return filter;
}
module.exports = {
  RemovePK,
  RemoveUnknownData,
  getPayloadValidator,
  errorResponse,
  validateInput,
  getErrorMessage,
  parseFilterValue,
  objectToFilter,
  dataToFilter,
  isEmptyFilter,
};
