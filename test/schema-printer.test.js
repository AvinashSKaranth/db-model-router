"use strict";

const assert = require("assert");
const { printSchema } = require("../src/schema/schema-printer");
const { parseSchema } = require("../src/schema/schema-parser");

/**
 * Helper: returns a minimal parsed schema (as parseSchema would return).
 */
function minimalParsedSchema() {
  return parseSchema({
    adapter: "postgres",
    framework: "express",
    tables: {
      users: {
        columns: {
          name: "required|string",
          email: "required|string",
        },
      },
    },
  });
}

describe("Schema Printer", function () {
  // -------------------------------------------------------------------------
  // Output is valid JSON with 2-space indent and trailing newline
  // -------------------------------------------------------------------------
  describe("JSON format", function () {
    it("produces valid JSON with 2-space indentation and trailing newline", function () {
      const schema = minimalParsedSchema();
      const output = printSchema(schema);

      // Trailing newline
      assert.ok(output.endsWith("\n"), "Output should end with a newline");

      // Valid JSON (strip trailing newline for parse)
      const parsed = JSON.parse(output);
      assert.ok(typeof parsed === "object");

      // 2-space indentation: re-serialize and compare
      const expected = JSON.stringify(parsed, null, 2) + "\n";
      assert.strictEqual(output, expected);
    });
  });

  // -------------------------------------------------------------------------
  // Tables are sorted alphabetically
  // -------------------------------------------------------------------------
  describe("table sorting", function () {
    it("sorts tables alphabetically by name", function () {
      const schema = parseSchema({
        adapter: "mysql",
        framework: "express",
        tables: {
          zebras: {
            columns: { stripe_count: "integer" },
          },
          apples: {
            columns: { color: "string" },
          },
          mangoes: {
            columns: { sweetness: "integer" },
          },
        },
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);
      const tableNames = Object.keys(parsed.tables);

      assert.deepStrictEqual(tableNames, ["apples", "mangoes", "zebras"]);
    });
  });

  // -------------------------------------------------------------------------
  // Relationships are sorted by [parent, child]
  // -------------------------------------------------------------------------
  describe("relationship sorting", function () {
    it("sorts relationships by [parent, child]", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        tables: {
          authors: { columns: { name: "string" } },
          books: { columns: { title: "string", author_id: "integer" } },
          chapters: { columns: { title: "string", book_id: "integer" } },
        },
        relationships: [
          { parent: "books", child: "chapters", foreignKey: "book_id" },
          { parent: "authors", child: "books", foreignKey: "author_id" },
        ],
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.relationships.length, 2);
      assert.strictEqual(parsed.relationships[0].parent, "authors");
      assert.strictEqual(parsed.relationships[0].child, "books");
      assert.strictEqual(parsed.relationships[1].parent, "books");
      assert.strictEqual(parsed.relationships[1].child, "chapters");
    });

    it("sorts by child when parents are equal", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        tables: {
          users: { columns: { name: "string" } },
          posts: { columns: { user_id: "integer" } },
          comments: { columns: { user_id: "integer" } },
        },
        relationships: [
          { parent: "users", child: "posts", foreignKey: "user_id" },
          { parent: "users", child: "comments", foreignKey: "user_id" },
        ],
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.relationships[0].child, "comments");
      assert.strictEqual(parsed.relationships[1].child, "posts");
    });
  });

  // -------------------------------------------------------------------------
  // Optional fields are preserved in output
  // -------------------------------------------------------------------------
  describe("optional field preservation", function () {
    it("preserves options in output", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        options: { session: "redis", helmet: true },
        tables: {
          users: { columns: { name: "string" } },
        },
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.deepStrictEqual(parsed.options, {
        session: "redis",
        helmet: true,
      });
    });

    it("preserves unique constraints in output", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        tables: {
          users: {
            columns: { name: "string", email: "required|string" },
            unique: ["email"],
          },
        },
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.deepStrictEqual(parsed.tables.users.unique, ["email"]);
    });

    it("preserves softDelete in output", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        tables: {
          users: {
            columns: { name: "string", is_deleted: "boolean" },
            softDelete: "is_deleted",
          },
        },
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.tables.users.softDelete, "is_deleted");
    });

    it("preserves relationships in output", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        tables: {
          users: { columns: { name: "string" } },
          posts: { columns: { user_id: "integer" } },
        },
        relationships: [
          { parent: "users", child: "posts", foreignKey: "user_id" },
        ],
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.relationships.length, 1);
      assert.deepStrictEqual(parsed.relationships[0], {
        parent: "users",
        child: "posts",
        foreignKey: "user_id",
      });
    });

    it("preserves custom timestamps in output", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        tables: {
          users: {
            columns: { name: "string" },
            timestamps: {
              created_at: "created_at",
              modified_at: "updated_at",
            },
          },
        },
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.deepStrictEqual(parsed.tables.users.timestamps, {
        created_at: "created_at",
        modified_at: "updated_at",
      });
    });

    it("preserves custom pk in output", function () {
      const schema = parseSchema({
        adapter: "postgres",
        framework: "express",
        tables: {
          users: {
            columns: { name: "string" },
            pk: "user_id",
          },
        },
      });

      const output = printSchema(schema);
      const parsed = JSON.parse(output);

      assert.strictEqual(parsed.tables.users.pk, "user_id");
    });
  });
});
