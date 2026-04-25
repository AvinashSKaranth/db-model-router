"use strict";

const fs = require("fs");
const path = require("path");
const { generateModelFile } = require("./generate-model.js");
const {
  generateRouteFile,
  generateChildRouteFile,
  generateRoutesIndexFile,
  generateTestFile,
  generateChildTestFile,
} = require("./generate-route.js");
const { generateOpenAPISpec } = require("./generate-openapi.js");

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
  const modelsRelPath = "../models";
  const tableNames = meta.map((m) => m.table).sort();

  // Model files
  for (const m of meta) {
    expected.set(`models/${m.table}.js`, generateModelFile(m));
  }

  // Route files (one per table)
  for (const m of meta) {
    expected.set(
      `routes/${m.table}.js`,
      generateRouteFile(m.table, modelsRelPath),
    );
  }

  // Child route files (one per relationship)
  for (const rel of relationships) {
    const childMeta = meta.find((m) => m.table === rel.child);
    const pk = childMeta ? childMeta.primary_key : "id";
    expected.set(
      `routes/${rel.child}_child_of_${rel.parent}.js`,
      generateChildRouteFile(
        rel.child,
        rel.parent,
        rel.foreignKey,
        modelsRelPath,
      ),
    );
  }

  // Routes index file
  expected.set(
    "routes/index.js",
    generateRoutesIndexFile(tableNames, relationships),
  );

  // Test files (one per table)
  for (const m of meta) {
    expected.set(
      `test/${m.table}.test.js`,
      generateTestFile(m.table, m.primary_key),
    );
  }

  // Child test files (one per relationship)
  for (const rel of relationships) {
    const childMeta = meta.find((m) => m.table === rel.child);
    const pk = childMeta ? childMeta.primary_key : "id";
    expected.set(
      `test/${rel.child}_child_of_${rel.parent}.test.js`,
      generateChildTestFile(rel.child, rel.parent, rel.foreignKey, pk),
    );
  }

  // OpenAPI spec
  expected.set(
    "openapi.json",
    JSON.stringify(generateOpenAPISpec(meta), null, 2) + "\n",
  );

  return expected;
}

/**
 * Scan known artifact directories on disk and return a set of relative paths
 * that exist.
 *
 * @param {string} baseDir
 * @returns {Set<string>}
 */
function scanDiskFiles(baseDir) {
  const files = new Set();

  const dirs = [
    { dir: "models", ext: ".js" },
    { dir: "routes", ext: ".js" },
    { dir: "test", ext: ".test.js" },
  ];

  for (const { dir, ext } of dirs) {
    const fullDir = path.join(baseDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const file of fs.readdirSync(fullDir)) {
      if (file.endsWith(ext)) {
        files.add(`${dir}/${file}`);
      }
    }
  }

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
