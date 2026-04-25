"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  computeDiff,
  buildExpectedFiles,
  lineDiff,
} = require("../src/cli/diff-engine.js");
const { generateModelFile } = require("../src/cli/generate-model.js");
const {
  generateRouteFile,
  generateRoutesIndexFile,
  generateTestFile,
} = require("../src/cli/generate-route.js");
const { generateOpenAPISpec } = require("../src/cli/generate-openapi.js");

/**
 * Helper: create a minimal ModelMeta for testing.
 */
function makeMeta(table, columns, pk) {
  return {
    table,
    structure: columns,
    primary_key: pk || "id",
    unique: [pk || "id"],
    option: { safeDelete: null, created_at: null, modified_at: null },
  };
}

/**
 * Helper: create a temp directory and return its path.
 */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "diff-engine-test-"));
}

/**
 * Helper: write a file inside baseDir, creating directories as needed.
 */
function writeFile(baseDir, relPath, content) {
  const fullPath = path.join(baseDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

describe("Diff Engine", function () {
  const meta = [
    makeMeta(
      "users",
      { name: "required|string", email: "required|string" },
      "id",
    ),
    makeMeta("posts", { title: "required|string", body: "string" }, "id"),
  ];
  const relationships = [];

  describe("lineDiff()", function () {
    it("should return empty string for identical content", function () {
      const diff = lineDiff("line1\nline2", "line1\nline2");
      assert.strictEqual(diff, "");
    });

    it("should show changed lines", function () {
      const diff = lineDiff("line1\nchanged", "line1\noriginal");
      assert.ok(diff.length > 0);
      assert.ok(diff.includes("original") || diff.includes("changed"));
    });
  });

  describe("added files", function () {
    it("should detect expected files missing from disk", function () {
      const tmpDir = makeTmpDir();
      try {
        // Empty disk — all expected files should be "added"
        const result = computeDiff(tmpDir, meta, relationships);
        assert.ok(result.added.length > 0, "should have added files");
        // Should include model files
        assert.ok(result.added.includes("models/users.js"));
        assert.ok(result.added.includes("models/posts.js"));
        // Should include route files
        assert.ok(result.added.includes("routes/users.js"));
        assert.ok(result.added.includes("routes/posts.js"));
        assert.ok(result.added.includes("routes/index.js"));
        // Should include test files
        assert.ok(result.added.includes("test/users.test.js"));
        assert.ok(result.added.includes("test/posts.test.js"));
        // Should include openapi spec
        assert.ok(result.added.includes("openapi.json"));
        // No modified or deleted
        assert.strictEqual(result.modified.length, 0);
        assert.strictEqual(result.deleted.length, 0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should detect partially missing files as added", function () {
      const tmpDir = makeTmpDir();
      try {
        // Write only the users model — posts model should be "added"
        const expected = buildExpectedFiles(meta, relationships);
        writeFile(tmpDir, "models/users.js", expected.get("models/users.js"));
        // Write all route files so they aren't added
        for (const [relPath, content] of expected) {
          if (relPath !== "models/users.js") continue;
        }

        const result = computeDiff(tmpDir, meta, relationships);
        assert.ok(result.added.includes("models/posts.js"));
        assert.ok(!result.added.includes("models/users.js"));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("modified files", function () {
    it("should detect modified files with correct diff output", function () {
      const tmpDir = makeTmpDir();
      try {
        const expected = buildExpectedFiles(meta, relationships);
        // Write all expected files
        for (const [relPath, content] of expected) {
          writeFile(tmpDir, relPath, content);
        }
        // Now modify one file
        const modifiedContent =
          "// modified content\n" + expected.get("models/users.js");
        writeFile(tmpDir, "models/users.js", modifiedContent);

        const result = computeDiff(tmpDir, meta, relationships);
        assert.strictEqual(result.added.length, 0);
        assert.strictEqual(result.deleted.length, 0);
        assert.ok(
          result.modified.length >= 1,
          "should have at least one modified file",
        );

        const modEntry = result.modified.find(
          (m) => m.file === "models/users.js",
        );
        assert.ok(modEntry, "models/users.js should be in modified list");
        assert.ok(modEntry.diff.length > 0, "diff should not be empty");
        assert.ok(
          modEntry.diff.includes("modified content"),
          "diff should reference the changed content",
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("deleted files", function () {
    it("should detect disk files not expected by schema", function () {
      const tmpDir = makeTmpDir();
      try {
        const expected = buildExpectedFiles(meta, relationships);
        // Write all expected files
        for (const [relPath, content] of expected) {
          writeFile(tmpDir, relPath, content);
        }
        // Write an extra file that the schema doesn't expect
        writeFile(tmpDir, "models/orphan_table.js", "// orphan model\n");
        writeFile(tmpDir, "routes/orphan_table.js", "// orphan route\n");

        const result = computeDiff(tmpDir, meta, relationships);
        assert.ok(
          result.deleted.includes("models/orphan_table.js"),
          "orphan model should be deleted",
        );
        assert.ok(
          result.deleted.includes("routes/orphan_table.js"),
          "orphan route should be deleted",
        );
        assert.strictEqual(result.added.length, 0);
        assert.strictEqual(result.modified.length, 0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("unchanged files", function () {
    it("should not report unchanged files", function () {
      const tmpDir = makeTmpDir();
      try {
        const expected = buildExpectedFiles(meta, relationships);
        // Write all expected files with exact content
        for (const [relPath, content] of expected) {
          writeFile(tmpDir, relPath, content);
        }

        const result = computeDiff(tmpDir, meta, relationships);
        assert.strictEqual(result.added.length, 0, "no added files");
        assert.strictEqual(result.modified.length, 0, "no modified files");
        assert.strictEqual(result.deleted.length, 0, "no deleted files");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("relationships", function () {
    it("should handle child route and test files for relationships", function () {
      const tmpDir = makeTmpDir();
      const rels = [{ parent: "users", child: "posts", foreignKey: "user_id" }];
      try {
        // Empty disk — everything should be added
        const result = computeDiff(tmpDir, meta, rels);
        assert.ok(
          result.added.includes("routes/posts_child_of_users.js"),
          "child route should be added",
        );
        assert.ok(
          result.added.includes("test/posts_child_of_users.test.js"),
          "child test should be added",
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
