"use strict";

const path = require("path");
const express = require("express");
const apiRoutes = require("./routes/api");
const viewRoutes = require("./routes/views");

/**
 * Creates and configures the Express app for the DB Manager.
 *
 * @param {object} db - The library adapter instance
 * @param {object} metaDb - The metadata database instance
 * @param {string} [dbType] - The database type (defaults to process.env.DB_TYPE)
 * @returns {express.Application} Configured Express app instance
 */
function createApp(db, metaDb, dbType) {
  const app = express();

  // View engine setup
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  // Static files
  app.use(express.static(path.join(__dirname, "public")));

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount API routes (they already include /api prefix)
  app.use("/", apiRoutes(db, metaDb, dbType));

  // Mount view routes
  app.use("/", viewRoutes(db, metaDb, dbType));

  return app;
}

module.exports = createApp;
