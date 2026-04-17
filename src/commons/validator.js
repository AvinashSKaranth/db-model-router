const { Validator } = require("node-input-validator");
const { getType } = require("./function");
function RemovePK(modelPK, data) {
  for (const item of data) {
    if (item.hasOwnProperty(modelPK)) {
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
        validator.body[i] = structure[pk];
        break;
      default:
        break;
    }
    return validator.body;
  }
}
function errorResponse(res, err) {
  let message = "";
  if (err.hasOwnProperty("sqlMessage")) message = err.sqlMessage;
  else if (err.hasOwnProperty("message")) message = err.message;
  else message = "unknown error: " + err.toString();
  let status = 500;
  if (err.hasOwnProperty("cause") && err.cause.hasOwnProperty("status")) {
    status = err.cause.status;
  }
  res.status(status).send({ type: "danger", message });
}
async function validateInput(req, required) {
  let validator = new Validator(req, required);
  const matched = await validator.check();
  if (!matched) {
    throw new Error(getErrorMessage(validator.errors), {
      cause: { status: 422 },
    });
  }
  return true;
}
function getErrorMessage(errors) {
  let message = "";
  for (const i in errors) {
    if (errors.hasOwnProperty(i)) {
      message = message + (message !== "" ? " " : "");
      message = message + errors[i].message;
    }
  }
  return message;
}
function objectToFilter(obj) {
  let filterArray = [];
  for (let key in obj) {
    filterArray.push([key, "=", obj[key]]);
  }
  return [filterArray];
}
function dataToFilter(data, primary_key) {
  let filter = [];
  let type = getType(data);
  if (data.hasOwnProperty("filter") && getType(data.filter) === "array") {
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
  objectToFilter,
  dataToFilter,
};
/*async function validateInput(req, required) {
  console.log(req, required);
  for (const key in required) {
    if (req.hasOwnProperty(key)) {
      if (Array.isArray(req[key])) {
        throw Error({ message: "This service supports does not support array", status: 422 });
      }
      let validator = new Validator(req[key], required[key]);
      const matched = await validator.check();
      if (!matched) {
        console.log(getErrorMessage(key, validator.errors));
        //throw Error({ message: getErrorMessage(key, validator.errors), status: 422 });
      }
    }
  }
  return true;
}*/
