function resolveExpress(opts = {}) {
  if (opts.express) return opts.express;
  if (
    opts.framework === "ultimate-express" ||
    process.env.DBMR_FRAMEWORK === "ultimate-express"
  ) {
    try {
      return require("ultimate-express");
    } catch (_) {}
  }
  try {
    return require("express");
  } catch (_) {
    try {
      return require("ultimate-express");
    } catch (e) {
      throw new Error("Neither 'express' nor 'ultimate-express' is installed.");
    }
  }
}

const { errorResponse } = require("./validator");
const { toCSV, toXML, extractReservedParams, applySelect } = require("./model");
const _ = require("lodash");

/**
 * Send response in the requested format (json, csv, xml).
 */
function sendFormatted(res, data, contentType) {
  if (contentType === "csv") {
    const rows = Array.isArray(data) ? data : data.data || [data];
    res.setHeader("Content-Type", "text/csv");
    return res.send(toCSV(rows));
  }
  if (contentType === "xml") {
    const rows = Array.isArray(data) ? data : data.data || [data];
    res.setHeader("Content-Type", "application/xml");
    return res.send(toXML(rows));
  }
  return res.status(200).send(data);
}

module.exports = function route(model, override = {}, options = {}) {
  const opts = {
    ...(typeof options === "object" && options !== null ? options : {}),
    ...(override && override.$express ? { express: override.$express } : {}),
    ...(override && override.$router ? { router: override.$router } : {}),
    ...(override && override.$framework ? { framework: override.$framework } : {}),
  };
  const router = opts.router || resolveExpress(opts).Router({ mergeParams: true });

  const registerQuery = (path, handler) => {
    const queryHandler = async (req, res, next) => {
      if (
        req.method === "QUERY" &&
        (!req.body ||
          typeof req.body !== "object" ||
          Object.keys(req.body).length === 0)
      ) {
        // Fallback buffer & parse JSON if framework body parser skipped QUERY (e.g. default ultimate-express)
        if (typeof req.on === "function" && req.readable) {
          await new Promise((resolve) => {
            let raw = "";
            req.on("data", (chunk) => {
              raw += chunk;
            });
            req.on("end", () => {
              if (raw.trim()) {
                try {
                  req.body = JSON.parse(raw);
                } catch (_) {}
              }
              resolve();
            });
            req.on("error", () => resolve());
          });
        }
      }
      return handler(req, res, next);
    };

    if (typeof router.query === "function") {
      router.query(path, queryHandler);
    } else {
      router.all(path, (req, res, next) => {
        if (req.method === "QUERY") return queryHandler(req, res, next);
        next();
      });
    }
  };

  const handleGetById = (req, res, fromBody = false) => {
    const input = fromBody
      ? { ...(req.query || {}), ...(req.body || {}), ...(req.params || {}) }
      : { ...(req.query || {}), ...(req.params || {}) };
    let payload = payloadOverride(input, req, override);
    const { select_columns, output_content_type, search } =
      extractReservedParams(payload);
    payload[model.pk] = req.params[model.pk];
    // Re-attach search so the model layer can apply it against search_columns;
    // route only needs select_columns/output_content_type for response shaping.
    if (search !== null && search !== undefined) payload.search = search;
    model
      .find(payload, { req, user: req.user })
      .then((response) => {
        if (response.count > 0) {
          let record = response.data[0];
          if (select_columns) record = applySelect(record, select_columns);
          sendFormatted(res, record, output_content_type);
        } else res.status(404).send({ message: "Not Found", type: "danger" });
      })
      .catch((err) => {
        errorResponse(res, err);
      });
  };

  const handleList = (req, res, fromBody = false) => {
    const input = fromBody
      ? { ...(req.query || {}), ...(req.body || {}) }
      : { ...(req.query || {}), ...(req.params || {}) };
    let payload = payloadOverride(input, req, override);
    const { select_columns, output_content_type, search } =
      extractReservedParams(payload);
    // select_columns stays in payload — model.list handles it
    if (select_columns) payload.select_columns = select_columns;
    // Re-attach search so the model layer can apply it against search_columns.
    if (search !== null && search !== undefined) payload.search = search;
    model
      .list(payload, { req, user: req.user })
      .then((response) => {
        sendFormatted(res, response, output_content_type);
      })
      .catch((err) => {
        errorResponse(res, err);
      });
  };

  router
    .get("/:" + model.pk, (req, res) => handleGetById(req, res, false))
    .post("/:id", (req, res) => {
      let payload = payloadOverride(req.body || {}, req, override);
      delete payload[model.pk];
      model
        .insert(payload, { req, user: req.user })
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .put("/:id", (req, res) => {
      let payload = payloadOverride(req.body || {}, req, override);
      payload[model.pk] = req.params.id;
      let validateAccessPayload = payloadOverride({}, req, override);
      validateAccessPayload[model.pk] = req.params.id;
      model
        .findOne(validateAccessPayload, { req, user: req.user })
        .then((found) => {
          if (found) {
            model
              .update(payload, { req, user: req.user })
              .then((response) => {
                res.status(200).send(response);
              })
              .catch((err) => {
                errorResponse(res, err);
              });
          } else {
            res.status(404).send({ message: "Not Found", type: "danger" });
          }
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .patch("/:id", (req, res) => {
      let payload = payloadOverride(req.body || {}, req, override);
      payload[model.pk] = req.params.id;
      let validateAccessPayload = payloadOverride({}, req, override);
      validateAccessPayload[model.pk] = req.params.id;
      model
        .findOne(validateAccessPayload, { req, user: req.user })
        .then((found) => {
          if (found) {
            model
              .patch(payload, { req, user: req.user })
              .then((response) => {
                res.status(200).send(response);
              })
              .catch((err) => {
                errorResponse(res, err);
              });
          } else {
            res.status(404).send({ message: "Not Found", type: "danger" });
          }
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .delete("/:id", (req, res) => {
      let payload = payloadOverride(req.body || {}, req, override);
      payload[model.pk] = req.params.id;
      let validateAccessPayload = payloadOverride({}, req, override);
      validateAccessPayload[model.pk] = req.params.id;
      model
        .findOne(validateAccessPayload, { req, user: req.user })
        .then((found) => {
          if (found) {
            model
              .remove(payload, { req, user: req.user })
              .then((response) => {
                res.status(200).send(response);
              })
              .catch((err) => {
                errorResponse(res, err);
              });
          } else {
            res.status(404).send({ message: "Not Found", type: "danger" });
          }
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .get("/", (req, res) => handleList(req, res, false))
    .post("/", (req, res) => {
      if (!req.body || !Array.isArray(req.body.data)) {
        return res.status(400).send({
          type: "danger",
          message: "Request body must contain a 'data' array",
        });
      }
      let payload = payloadOverride(req.body.data, req, override);
      model
        .insert({ data: payload }, { req, user: req.user })
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .put("/", (req, res) => {
      if (!req.body || !Array.isArray(req.body.data)) {
        return res.status(400).send({
          type: "danger",
          message: "Request body must contain a 'data' array",
        });
      }
      let payload = payloadOverride(req.body.data, req, override);
      model
        .update({ data: payload }, { req, user: req.user })
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .delete("/", (req, res) => {
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).send({
          type: "danger",
          message: "Request body must contain filter criteria",
        });
      }
      // Accept { data: [...] } (legacy array) or plain filter object in body
      let payload;
      if (req.body.data && Array.isArray(req.body.data)) {
        payload = payloadOverride(req.body.data, req, override);
      } else {
        payload = payloadOverride(req.body, req, override);
      }
      model
        .remove(payload, { req, user: req.user })
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    });

  // QUERY method routes (RFC draft / HTTP QUERY method using request body)
  registerQuery("/:" + model.pk, (req, res) => handleGetById(req, res, true));
  registerQuery("/", (req, res) => handleList(req, res, true));

  return router;
};

function payloadOverride(payload, req, override) {
  if (Array.isArray(payload)) {
    for (const i in payload) {
      payload[i] = dataOverride(payload[i], req, override);
    }
  } else {
    payload = dataOverride(payload, req, override);
  }
  return payload;
}

function dataOverride(payload, req, override) {
  for (const key in override) {
    if (key.startsWith("$")) continue;
    payload[key] = _.get(req, override[key], "");
  }
  for (const key in payload) {
    if (payload[key] === "null") {
      delete payload[key];
    }
  }
  return payload;
}
