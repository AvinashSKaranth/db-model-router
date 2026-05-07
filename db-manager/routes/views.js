"use strict";

const express = require("express");

/**
 * Creates view routes for the DB Manager App.
 *
 * @param {object} db - The library adapter instance
 * @param {object} metaDb - The metadata database instance
 * @param {string} [dbType] - The database type (defaults to process.env.DB_TYPE)
 * @returns {express.Router} Express Router with view endpoints mounted
 */
function viewRoutes(db, metaDb, dbType) {
  const router = express.Router();
  const type = dbType || process.env.DB_TYPE || "sqlite3";

  // GET / — redirect to dashboard
  router.get("/", (req, res) => {
    res.redirect("/dashboard");
  });

  // GET /dashboard — render dashboard page (default landing page)
  router.get("/dashboard", (req, res) => {
    res.render("dashboard", {
      dbType: type,
      dbName: process.env.DB_NAME || "unknown",
      dbHost: process.env.DB_HOST || "localhost",
    });
  });

  // GET /tables — render table browser page
  router.get("/tables", (req, res) => {
    res.render("index", {
      dbType: type,
      dbName: process.env.DB_NAME || "unknown",
      dbHost: process.env.DB_HOST || "localhost",
    });
  });

  // GET /query — render query page
  router.get("/query", (req, res) => {
    res.render("query", {
      dbType: type,
      dbName: process.env.DB_NAME || "unknown",
      dbHost: process.env.DB_HOST || "localhost",
    });
  });

  // GET /history — render history page
  router.get("/history", (req, res) => {
    res.render("history", {
      dbType: type,
      dbName: process.env.DB_NAME || "unknown",
      dbHost: process.env.DB_HOST || "localhost",
    });
  });

  return router;
}

module.exports = viewRoutes;
