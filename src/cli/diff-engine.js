"use strict";

const fs = require("fs");
const path = require("path");
const { generateModelFile } = require("./generate-model.js");
const {
  generateRouteFile,
  generateParentRouteFile,
  generateChildRouteFile,
  generateRoutesIndexFile,
  generateTestFile,
  generateChildTestFile,
} = require("./generate-route.js");
const { generateOpenAPISpec } = require("./generate-openapi.js");
const { generateDocsRoute } = require("./generate-docs-route.js");

/**
 * Simple line-by-line diff between two strings.
 * Returns a human-readable unified-style diff string.
 */
function lineDiff(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const lines = [];
  const maxLen = Math.max(expectedLines.length, actualLines.length);

  for (let i = 0; i < maxLen; i++) {
    const exp = i < expectedLines.length ? expectedLines[i] : undefined;
    const act = i < actualLines.length ? actualLines[i] : undefined;

    if (exp === act) continue;
    if (act !== undefined && exp === undefined) {
      lines.push(`+${i + 1}: ${act}`);
    } else if (exp !== undefined && act === undefined) {
      lines.push(`-${i + 1}: ${exp}`);
    } else {
      lines.push(`-${i + 1}: ${act}`);
      lines.push(`+${i + 1}: ${exp}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build a map of relative file path → expected content for all artifacts
 * that the schema would generate.
 *
 * @param {Array<{table, structure, primary_key, unique, option}>} meta
 * @param {Array<{parent, child, foreignKey}>} relationships
 * @returns {Map<string, string>}
 */
function buildExpectedFiles(meta, relationships) {
  const expected = new Map();
  const tableNames = meta.map((m) => m.table).sort();

  // Build children map
  const childrenByParent = {};
  for (const rel of relationships) {
    if (!childrenByParent[rel.parent]) childrenByParent[rel.parent] = [];
    childrenByParent[rel.parent].push(rel);
  }

  // Build ancestry chains from relationships
  const parentMap = {};
  for (const rel of relationships) {
    parentMap[rel.child] = rel.parent;
  }
  const ancestors = {};
  for (const m of meta) {
    const chain = [];
    let current = m.table;
    while (parentMap[current]) {
      chain.unshift(parentMap[current]);
      current = parentMap[current];
    }
    ancestors[m.table] = chain;
  }

  const getPk = (table) => {
    const m = meta.find((x) => x.table === table);
    return m ? m.primary_key : "id";
  };

  // Model files
  for (const m of meta) {
    expected.set(`models/${m.table}.js`, generateModelFile(m));
  }

  // Route files: exactly one per table at its correct nested path
  for (const m of meta) {
    const tableName = m.table;
    const chain = ancestors[tableName];
    const hasChildren = (childrenByParent[tableName] || []).length > 0;
    const hasParent = chain.length > 0;

    const pathParts = [...chain, tableName];
    const relPath = `routes/${pathParts.join("/")}/index.js`;

    if (hasChildren) {
      const children = childrenByParent[tableName];
      if (hasParent) {
        const immediateParent = chain[chain.length - 1];
        const parentFk = getPk(immediateParent);
        expected.set(relPath, generateParentRouteFile(tableName, children, parentFk));
      } else {
        expected.set(relPath, generateParentRouteFile(tableName, children));
      }
    } else if (hasParent) {
      const immediateParent = chain[chain.length - 1];
      const parentFk = getPk(immediateParent);
      expected.set(relPath, generateChildRouteFile(tableName, immediateParent, parentFk));
    } else {
      expected.set(relPath, generateRouteFile(tableName));
    }
  }

  // Routes index file (with docs route)
  expected.set(
    "routes/index.js",
    generateRoutesIndexFile(tableNames, relationships, { includeDocs: true }),
  );

  // Docs route (Swagger UI)
  expected.set("routes/docs.js", generateDocsRoute());

  // Test files at correct nested paths
  for (const m of meta) {
    const tableName = m.table;
    const chain = ancestors[tableName];
    const hasParent = chain.length > 0;

    if (hasParent) {
      const immediateParent = chain[chain.length - 1];
      const parentFk = getPk(immediateParent);
      const pathParts = [...chain, tableName];
      const depth = pathParts.length;
      const modelsRelPath = "../".repeat(depth) + "models/";
      expected.set(
        `test/${pathParts.join("/")}.test.js`,
        generateChildTestFile(tableName, immediateParent, parentFk, m.primary_key, modelsRelPath),
      );
    } else {
      expected.set(
        `test/${tableName}.test.js`,
        generateTestFile(tableName, m.primary_key, m.structure),
      );
    }
  }

  // OpenAPI spec
  expected.set(
    "openapi.json",
    JSON.stringify(generateOpenAPISpec(meta, { relationships }), null, 2) +
      "\n",
  );

  return expected;
}

/**
 * Scan known artifact directories on disk and return a set of relative paths
 * that exist. Recursively scans subdirectories.
 *
 * @param {string} baseDir
 * @returns {Set<string>}
 */
function scanDiskFiles(baseDir) {
  const files = new Set();

  function scanDir(dir, prefix) {
    const fullDir = path.join(baseDir, dir);
    if (!fs.existsSync(fullDir)) return;
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const relPath = prefix
        ? `${prefix}/${entry.name}`
        : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), relPath);
      } else if (entry.name.endsWith(".js")) {
        files.add(relPath);
      }
    }
  }

  scanDir("models");
  scanDir("routes");

  // For test dir, only include .test.js files
  function scanTestDir(dir, prefix) {
    const fullDir = path.join(baseDir, dir);
    if (!fs.existsSync(fullDir)) return;
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const relPath = prefix
        ? `${prefix}/${entry.name}`
        : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        scanTestDir(path.join(dir, entry.name), relPath);
      } else if (entry.name.endsWith(".test.js")) {
        files.add(relPath);
      }
    }
  }

  scanTestDir("test");

  // Check for openapi.json at root
  const openapiPath = path.join(baseDir, "openapi.json");
  if (fs.existsSync(openapiPath)) {
    files.add("openapi.json");
  }

  return files;
}

/**
 * Compare expected generated content against actual files on disk.
 *
 * @param {string} baseDir — project root
 * @param {Array<{table, structure, primary_key, unique, option}>} meta — from schema
 * @param {Array<{parent, child, foreignKey}>} relationships
 * @returns {{ added: string[], modified: Array<{file: string, diff: string}>, deleted: string[] }}
 */
function computeDiff(baseDir, meta, relationships) {
  const expected = buildExpectedFiles(meta, relationships);
  const diskFiles = scanDiskFiles(baseDir);

  const added = [];
  const modified = [];
  const deleted = [];

  // Check expected files against disk
  for (const [relPath, expectedContent] of expected) {
    const fullPath = path.join(baseDir, relPath);
    if (!fs.existsSync(fullPath)) {
      added.push(relPath);
    } else {
      const actualContent = fs.readFileSync(fullPath, "utf8");
      if (actualContent !== expectedContent) {
        modified.push({
          file: relPath,
          diff: lineDiff(expectedContent, actualContent),
        });
      }
      // unchanged — not reported
    }
  }

  // Check disk files not in expected set → deleted
  for (const diskFile of diskFiles) {
    if (!expected.has(diskFile)) {
      deleted.push(diskFile);
    }
  }

  return {
    added: added.sort(),
    modified: modified.sort((a, b) => a.file.localeCompare(b.file)),
    deleted: deleted.sort(),
  };
}

module.exports = { computeDiff, buildExpectedFiles, lineDiff };
