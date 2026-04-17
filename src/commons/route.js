const express = require("express");
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

module.exports = function route(model, override = {}) {
  return express
    .Router({ mergeParams: true })
    .get("/:" + model.pk, (req, res) => {
      let payload = payloadOverride(
        { ...req.query, ...req.params },
        req,
        override,
      );
      const { select_columns, output_content_type } =
        extractReservedParams(payload);
      payload[model.pk] = req.params[model.pk];
      model
        .find(payload)
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
    })
    .post("/:id", (req, res) => {
      let payload = payloadOverride(req.body, req, override);
      delete payload[model.pk];
      model
        .insert(payload)
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .put("/:id", (req, res) => {
      let payload = payloadOverride(req.body, req, override);
      payload[model.pk] = req.params.id;
      let validateAccessPayload = payloadOverride({}, req, override);
      validateAccessPayload[model.pk] = req.params.id;
      model
        .findOne(validateAccessPayload)
        .then((found) => {
          if (found) {
            model
              .update(payload)
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
      let payload = payloadOverride(req.body, req, override);
      payload[model.pk] = req.params.id;
      let validateAccessPayload = payloadOverride({}, req, override);
      validateAccessPayload[model.pk] = req.params.id;
      model
        .findOne(validateAccessPayload)
        .then((found) => {
          if (found) {
            model
              .patch(payload)
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
      let payload = payloadOverride(req.body, req, override);
      payload[model.pk] = req.params.id;
      let validateAccessPayload = payloadOverride({}, req, override);
      validateAccessPayload[model.pk] = req.params.id;
      model
        .findOne(validateAccessPayload)
        .then((found) => {
          if (found) {
            model
              .remove(payload)
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
    .get("/", (req, res) => {
      let payload = payloadOverride(
        { ...req.query, ...req.params },
        req,
        override,
      );
      const { output_content_type } = extractReservedParams(payload);
      // select_columns stays in payload — model.list handles it
      model
        .list(payload)
        .then((response) => {
          sendFormatted(res, response, output_content_type);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .post("/", (req, res) => {
      let payload = payloadOverride(req.body.data, req, override);
      model
        .insert({ data: payload })
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .put("/", (req, res) => {
      let payload = payloadOverride(req.body.data, req, override);
      model
        .update({ data: payload })
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    })
    .delete("/", (req, res) => {
      let payload = payloadOverride(req.body.data, req, override);
      model
        .remove(payload)
        .then((response) => {
          res.status(200).send(response);
        })
        .catch((err) => {
          errorResponse(res, err);
        });
    });
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
    payload[key] = _.get(req, override[key], "");
  }
  for (const key in payload) {
    if (payload[key] === "null") {
      delete payload[key];
    }
  }
  return payload;
}
