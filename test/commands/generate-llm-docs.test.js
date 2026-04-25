"use strict";

const assert = require("assert");
const {
  generateLlmsTxt,
  generateLlmMd,
} = require("../../src/cli/commands/generate-llm-docs");

describe("LLM Docs Generator (src/cli/commands/generate-llm-docs.js)", function () {
  // -------------------------------------------------------------------
  // Requirement 9.3: llms.txt is ≤200 lines
  // -------------------------------------------------------------------
  describe("generateLlmsTxt()", function () {
    it("should produce output with ≤200 lines (Req 9.3)", function () {
      const content = generateLlmsTxt();
      const lineCount = content.split("\n").length;
      // The trailing newline adds one empty element, so actual lines = lineCount - 1
      // But we count all non-empty trailing: split gives N+1 for N newlines
      assert.ok(
        lineCount <= 201,
        `llms.txt should be ≤200 lines, got ${lineCount - 1} lines`,
      );
    });

    it("should contain CLI command references", function () {
      const content = generateLlmsTxt();
      assert.ok(content.includes("### init"), "Should reference init command");
      assert.ok(
        content.includes("### inspect"),
        "Should reference inspect command",
      );
      assert.ok(
        content.includes("### generate"),
        "Should reference generate command",
      );
      assert.ok(
        content.includes("### doctor"),
        "Should reference doctor command",
      );
      assert.ok(content.includes("### diff"), "Should reference diff command");
    });

    it("should contain schema format reference", function () {
      const content = generateLlmsTxt();
      assert.ok(content.includes("adapter"), "Should reference adapter");
      assert.ok(content.includes("framework"), "Should reference framework");
      assert.ok(content.includes("tables"), "Should reference tables");
    });

    it("should list universal flags", function () {
      const content = generateLlmsTxt();
      assert.ok(content.includes("--yes"), "Should list --yes flag");
      assert.ok(content.includes("--json"), "Should list --json flag");
      assert.ok(content.includes("--dry-run"), "Should list --dry-run flag");
      assert.ok(
        content.includes("--no-install"),
        "Should list --no-install flag",
      );
      assert.ok(content.includes("--help"), "Should list --help flag");
    });
  });

  // -------------------------------------------------------------------
  // Requirement 9.4: docs/llm.md contains required sections
  // -------------------------------------------------------------------
  describe("generateLlmMd()", function () {
    it("should contain Installation section (Req 9.2, 9.4)", function () {
      const content = generateLlmMd();
      assert.ok(
        content.includes("## Installation"),
        "Should have Installation heading",
      );
      assert.ok(
        content.includes("npm install db-model-router"),
        "Should have install command",
      );
    });

    it("should contain Canonical Schema-Driven Workflow section (Req 9.2, 9.4)", function () {
      const content = generateLlmMd();
      assert.ok(
        content.includes("## Canonical Schema-Driven Workflow"),
        "Should have workflow heading",
      );
    });

    it("should contain Schema Definition section (Req 9.2, 9.4)", function () {
      const content = generateLlmMd();
      assert.ok(
        content.includes("## Schema Definition"),
        "Should have schema definition heading",
      );
      assert.ok(
        content.includes("```json"),
        "Should have JSON code block for schema",
      );
    });

    it("should contain CLI Commands section with all subcommands (Req 9.2, 9.4)", function () {
      const content = generateLlmMd();
      assert.ok(
        content.includes("## CLI Commands"),
        "Should have CLI Commands heading",
      );
      assert.ok(content.includes("### init"), "Should have init subheading");
      assert.ok(
        content.includes("### inspect"),
        "Should have inspect subheading",
      );
      assert.ok(
        content.includes("### generate"),
        "Should have generate subheading",
      );
      assert.ok(
        content.includes("### doctor"),
        "Should have doctor subheading",
      );
      assert.ok(content.includes("### diff"), "Should have diff subheading");
    });

    it("should contain Route Contract section with 9 endpoints (Req 9.2, 9.4)", function () {
      const content = generateLlmMd();
      assert.ok(
        content.includes("## Route Contract"),
        "Should have Route Contract heading",
      );
      // Check all 9 endpoint patterns
      assert.ok(content.includes("GET"), "Should list GET endpoints");
      assert.ok(content.includes("POST"), "Should list POST endpoints");
      assert.ok(content.includes("PUT"), "Should list PUT endpoints");
      assert.ok(content.includes("PATCH"), "Should list PATCH endpoints");
      assert.ok(content.includes("DELETE"), "Should list DELETE endpoints");
      assert.ok(content.includes("Bulk insert"), "Should describe bulk insert");
      assert.ok(content.includes("Bulk update"), "Should describe bulk update");
      assert.ok(content.includes("Bulk delete"), "Should describe bulk delete");
      assert.ok(
        content.includes("Get single record"),
        "Should describe get single",
      );
      assert.ok(
        content.includes("Partial update"),
        "Should describe partial update",
      );
    });

    it("should contain Adapter Capability Matrix (Req 9.2, 9.4)", function () {
      const content = generateLlmMd();
      assert.ok(
        content.includes("## Adapter Capability Matrix"),
        "Should have Adapter Capability Matrix heading",
      );
      // Check all adapters are listed
      const adapters = [
        "mysql",
        "postgres",
        "sqlite3",
        "mongodb",
        "mssql",
        "cockroachdb",
        "oracle",
        "redis",
        "dynamodb",
      ];
      for (const adapter of adapters) {
        assert.ok(
          content.includes(`| ${adapter} |`),
          `Should list ${adapter} in capability matrix`,
        );
      }
    });

    it("should use consistent heading structure (Req 9.4)", function () {
      const content = generateLlmMd();
      const lines = content.split("\n");
      const headings = lines.filter((l) => l.startsWith("#"));

      // Should have a top-level heading
      assert.ok(
        headings.some((h) => h.startsWith("# ")),
        "Should have a top-level heading",
      );

      // Should have multiple level-2 headings
      const h2 = headings.filter((h) => h.startsWith("## "));
      assert.ok(
        h2.length >= 5,
        `Should have at least 5 level-2 headings, got ${h2.length}`,
      );

      // Should use code blocks
      const codeBlocks = content.match(/```/g) || [];
      assert.ok(
        codeBlocks.length >= 2,
        `Should have code blocks, got ${codeBlocks.length / 2} pairs`,
      );
    });
  });

  // -------------------------------------------------------------------
  // Requirement 9.5: Regeneration reflects schema changes
  // -------------------------------------------------------------------
  describe("regeneration consistency (Req 9.5)", function () {
    it("should produce identical output on repeated calls", function () {
      const txt1 = generateLlmsTxt();
      const txt2 = generateLlmsTxt();
      assert.strictEqual(
        txt1,
        txt2,
        "llms.txt should be identical across calls",
      );

      const md1 = generateLlmMd();
      const md2 = generateLlmMd();
      assert.strictEqual(md1, md2, "llm.md should be identical across calls");
    });

    it("should produce non-empty content", function () {
      const txt = generateLlmsTxt();
      assert.ok(txt.length > 0, "llms.txt should not be empty");

      const md = generateLlmMd();
      assert.ok(md.length > 0, "llm.md should not be empty");
    });
  });
});
