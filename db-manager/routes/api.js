"use strict";

const express = require("express");
const createAdapterProxy = require("../adapter-proxy");
const {
  parseFilterValue,
  objectToFilter,
} = require("../../src/commons/validator");
const { generateCSV } = require("../utils/csv-export");
const {
  generateExportFilename,
  generateQueryExportFilename,
} = require("../utils/export-filename");

// Reserved query params that are NOT filter columns
const RESERVED_PARAMS = ["page", "limit", "sort", "dir"];

/**
 * Extracts filter params from query string (excludes reserved params).
 * Uses the library's parseFilterValue to parse operator prefixes.
 * Returns filter in the library's format: [[col, op, val], ...]
 */
function buildFilter(query) {
  const filterObj = {};
  for (const key of Object.keys(query)) {
    if (RESERVED_PARAMS.includes(key)) continue;
    // Skip Express-parsed nested objects (like filter[0][col])
    if (typeof query[key] !== "string") continue;
    filterObj[key] = query[key];
  }
  if (Object.keys(filterObj).length === 0) return [];
  return objectToFilter(filterObj);
}

/**
 * Creates API routes for the DB Manager App.
 *
 * @param {object} db - The library adapter instance (has list, insert, upsert, remove, query methods)
 * @param {object} metaDb - The metadata database instance
 * @param {string} [dbType] - The database type (defaults to process.env.DB_TYPE)
 * @returns {express.Router} Express Router with all API endpoints mounted
 */
function apiRoutes(db, metaDb, dbType) {
  const router = express.Router();
  const type = dbType || process.env.DB_TYPE || "sqlite3";
  const proxy = createAdapterProxy(db, type);

  // GET /api/tables — list all tables
  router.get("/api/tables", async (req, res) => {
    try {
      const tables = await proxy.getTables();
      res.json({ tables });
    } catch (err) {
      res
        .status(500)
        .json({ error: true, message: err.message || "Failed to list tables" });
    }
  });

  // GET /api/tables/:name/schema — get column metadata
  router.get("/api/tables/:name/schema", async (req, res) => {
    try {
      const schema = await proxy.getSchema(req.params.name);
      res.json(schema);
    } catch (err) {
      res
        .status(500)
        .json({ error: true, message: err.message || "Failed to get schema" });
    }
  });

  // GET /api/tables/:name/rows — list rows with pagination, filtering, sorting
  // Filter syntax matches the library: ?name=john&age=>25&status=!inactive
  router.get("/api/tables/:name/rows", async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 0;
      const limit = parseInt(req.query.limit, 10) || 30;
      const sort = [];
      if (req.query.sort) {
        const dir = (req.query.dir || "asc").toLowerCase();
        sort.push(dir === "desc" ? `-${req.query.sort}` : req.query.sort);
      }

      const filter = buildFilter(req.query);

      const result = await db.list(
        req.params.name,
        filter,
        sort,
        null,
        page,
        limit,
      );
      res.json({
        data: result.data || [],
        count: result.count || 0,
        page,
        limit,
      });
    } catch (err) {
      res
        .status(500)
        .json({ error: true, message: err.message || "Failed to list rows" });
    }
  });

  // POST /api/tables/:name/rows — insert row(s)
  router.post("/api/tables/:name/rows", async (req, res) => {
    try {
      const { data } = req.body;
      if (!data) {
        return res
          .status(400)
          .json({ error: true, message: "Missing 'data' in request body" });
      }

      const table = req.params.name;
      const result = await db.insert(table, data);

      // Record in query history (non-fatal)
      try {
        const connectionId = metaDb._connectionId || 1;
        metaDb.recordQuery(
          connectionId,
          `INSERT INTO ${table}`,
          result.rows || 1,
        );
      } catch (_) {}

      res.json(result);
    } catch (err) {
      res
        .status(500)
        .json({ error: true, message: err.message || "Failed to insert row" });
    }
  });

  // PUT /api/tables/:name/rows — upsert row
  router.put("/api/tables/:name/rows", async (req, res) => {
    try {
      const { data, uniqueKeys } = req.body;
      if (!data) {
        return res
          .status(400)
          .json({ error: true, message: "Missing 'data' in request body" });
      }

      const table = req.params.name;
      const result = await db.upsert(table, data, uniqueKeys || []);

      // Record in query history (non-fatal)
      try {
        const connectionId = metaDb._connectionId || 1;
        metaDb.recordQuery(
          connectionId,
          `UPSERT INTO ${table}`,
          result.rows || 1,
        );
      } catch (_) {}

      res.json(result);
    } catch (err) {
      res
        .status(500)
        .json({ error: true, message: err.message || "Failed to upsert row" });
    }
  });

  // DELETE /api/tables/:name/rows — delete rows by PK filter
  router.delete("/api/tables/:name/rows", async (req, res) => {
    try {
      const { keys, pkColumn } = req.body;
      if (!keys || !Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({
          error: true,
          message: "Missing or empty 'keys' array in request body",
        });
      }
      if (!pkColumn) {
        return res
          .status(400)
          .json({ error: true, message: "Missing 'pkColumn' in request body" });
      }

      const table = req.params.name;
      const filter = keys.map((k) => [[pkColumn, "=", k]]);
      const result = await db.remove(table, filter);

      // Record in query history (non-fatal)
      try {
        const connectionId = metaDb._connectionId || 1;
        metaDb.recordQuery(
          connectionId,
          `DELETE FROM ${table} WHERE ${pkColumn} IN (${keys.join(", ")})`,
          keys.length,
        );
      } catch (_) {}

      res.json(result || { message: `${keys.length} row(s) removed` });
    } catch (err) {
      res
        .status(500)
        .json({ error: true, message: err.message || "Failed to delete rows" });
    }
  });

  // POST /api/tables/:name/export — export selected rows as CSV
  router.post("/api/tables/:name/export", async (req, res) => {
    try {
      const { keys, pkColumn } = req.body;
      if (!keys || !Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({
          error: true,
          message: "Missing or empty 'keys' array in request body",
        });
      }
      if (!pkColumn) {
        return res
          .status(400)
          .json({ error: true, message: "Missing 'pkColumn' in request body" });
      }

      const table = req.params.name;
      const filter = keys.map((k) => [[pkColumn, "=", k]]);
      const result = await db.get(table, filter);
      const rows = result.data || [];

      // Get schema for column names
      const schema = await proxy.getSchema(table);
      const columns = schema.columns.map((col) => col.name);

      const csv = generateCSV(columns, rows);
      const filename = generateExportFilename(table);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(csv);
    } catch (err) {
      res
        .status(500)
        .json({ error: true, message: err.message || "Failed to export rows" });
    }
  });

  // GET /api/history/connections
  router.get("/api/history/connections", (req, res) => {
    try {
      const connections = metaDb.getConnections();
      res.json({ connections });
    } catch (err) {
      res.status(500).json({
        error: true,
        message: err.message || "Failed to get connection history",
      });
    }
  });

  // GET /api/history/queries
  router.get("/api/history/queries", (req, res) => {
    try {
      const connectionId = req.query.connectionId
        ? parseInt(req.query.connectionId, 10)
        : metaDb._connectionId || 1;
      const queries = metaDb.getQueries(connectionId);
      res.json({ queries });
    } catch (err) {
      res.status(500).json({
        error: true,
        message: err.message || "Failed to get query history",
      });
    }
  });

  // POST /api/query — execute custom SQL
  router.post("/api/query", async (req, res) => {
    try {
      const { query: queryText } = req.body;
      if (!queryText) {
        return res
          .status(400)
          .json({ error: true, message: "Missing 'query' in request body" });
      }

      const result = await db.query(queryText);
      const data = Array.isArray(result) ? result : [];
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      const rowCount = data.length;

      // Record in metadata DB (non-fatal)
      try {
        const connectionId = metaDb._connectionId || 1;
        metaDb.recordQuery(connectionId, queryText, rowCount);
      } catch (_) {}

      res.json({ columns, data, rowCount });
    } catch (err) {
      res.status(500).json({
        error: true,
        message: err.message || "Query execution failed",
      });
    }
  });

  // POST /api/query/export — export query results as CSV
  router.post("/api/query/export", async (req, res) => {
    try {
      const { query: queryText } = req.body;
      if (!queryText) {
        return res
          .status(400)
          .json({ error: true, message: "Missing 'query' in request body" });
      }

      const result = await db.query(queryText);
      const data = Array.isArray(result) ? result : [];
      const columns = data.length > 0 ? Object.keys(data[0]) : [];

      const csv = generateCSV(columns, data);
      const filename = generateQueryExportFilename();

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(csv);
    } catch (err) {
      res.status(500).json({
        error: true,
        message: err.message || "Query execution failed",
      });
    }
  });

  // GET /api/dashboard — table metadata
  router.get("/api/dashboard", async (req, res) => {
    try {
      const tableNames = await proxy.getTables();
      const tables = await Promise.all(
        tableNames.map(async (name) => {
          const schema = await proxy.getSchema(name);
          const columnCount = schema.columns.length;
          const result = await db.list(name, [], [], null, 0, 1);
          const rowCount = result.count || 0;

          let indexCount = 0;
          try {
            const indexes = await db.query(
              `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='index' AND tbl_name='${name}'`,
            );
            if (indexes && indexes[0]) indexCount = indexes[0].cnt || 0;
          } catch (_) {}

          let sizeMB = 0;
          try {
            const pageInfo = await db.query(
              `SELECT SUM(pgsize) as total_size FROM dbstat WHERE name='${name}'`,
            );
            if (pageInfo && pageInfo[0] && pageInfo[0].total_size) {
              sizeMB = parseFloat(
                (pageInfo[0].total_size / (1024 * 1024)).toFixed(3),
              );
            }
          } catch (_) {
            sizeMB = parseFloat(
              ((rowCount * columnCount * 50) / (1024 * 1024)).toFixed(3),
            );
          }

          return { name, columnCount, indexCount, rowCount, sizeMB };
        }),
      );
      res.json({ tables });
    } catch (err) {
      res.status(500).json({
        error: true,
        message: "Failed to retrieve table metadata",
      });
    }
  });

  return router;
}

module.exports = apiRoutes;
