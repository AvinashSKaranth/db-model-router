"use strict";

const assert = require("assert");
const { parseSchema } = require("../src/schema/schema-parser");
const { schemaToModelMeta } = require("../src/schema/schema-to-meta");

/**
 * Helper: returns a rich valid schema with timestamps, softDelete, and relationships.
 */
function richSchema() {
  return {
    adapter: "postgres",
    framework: "express",
    tables: {
      users: {
        columns: {
          name: "required|string",
          email: "required|string",
          age: "integer",
          is_deleted: "boolean",
          created_at: "string",
          updated_at: "string",
        },
        pk: "id",
        unique: ["email"],
        softDelete: "is_deleted",
        timestamps: {
          created_at: "created_at",
          modified_at: "updated_at",
        },
      },
      posts: {
        columns: {
          title: "required|string",
          body: "string",
          user_id: "required|integer",
        },
        pk: "id",
        unique: ["id"],
      },
    },
    relationships: [{ parent: "users", child: "posts", foreignKey: "user_id" }],
  };
}

describe("Schema-to-ModelMeta Converter", function () {
  // -------------------------------------------------------------------------
  // Full conversion of a known schema matches expected ModelMeta[] output
  // -------------------------------------------------------------------------
  describe("full conversion", function () {
    it("converts a known schema to the expected ModelMeta[] output", function () {
      const parsed = parseSchema(richSchema());
      const meta = schemaToModelMeta(parsed);

      assert.strictEqual(meta.length, 2);

      // posts (alphabetically first)
      assert.deepStrictEqual(meta[0], {
        table: "posts",
        structure: {
          title: "required|string",
          body: "string",
          user_id: "required|integer",
        },
        primary_key: "id",
        unique: ["id"],
        option: {
          safeDelete: null,
          created_at: null,
          modified_at: null,
        },
      });

      // users (alphabetically second)
      assert.deepStrictEqual(meta[1], {
        table: "users",
        structure: {
          name: "required|string",
          email: "required|string",
          age: "integer",
        },
        primary_key: "id",
        unique: ["email"],
        option: {
          safeDelete: "is_deleted",
          created_at: "created_at",
          modified_at: "updated_at",
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Primary key column is excluded from structure
  // -------------------------------------------------------------------------
  describe("pk exclusion", function () {
    it("excludes the primary key column from structure", function () {
      const schema = {
        adapter: "mysql",
        framework: "express",
        tables: {
          items: {
            columns: {
              item_id: "integer",
              label: "required|string",
            },
            pk: "item_id",
          },
        },
      };
      const parsed = parseSchema(schema);
      const meta = schemaToModelMeta(parsed);

      assert.strictEqual(meta.length, 1);
      assert.strictEqual(meta[0].primary_key, "item_id");
      assert.ok(
        !("item_id" in meta[0].structure),
        "pk should not be in structure",
      );
      assert.deepStrictEqual(meta[0].structure, { label: "required|string" });
    });
  });

  // -------------------------------------------------------------------------
  // Timestamp and softDelete columns are excluded from structure
  // -------------------------------------------------------------------------
  describe("timestamp and softDelete exclusion", function () {
    it("excludes timestamp and softDelete columns from structure", function () {
      const parsed = parseSchema(richSchema());
      const meta = schemaToModelMeta(parsed);

      // users table has is_deleted, created_at, updated_at — all should be excluded
      const usersStructure = meta.find((m) => m.table === "users").structure;
      assert.ok(
        !("is_deleted" in usersStructure),
        "softDelete column should not be in structure",
      );
      assert.ok(
        !("created_at" in usersStructure),
        "created_at column should not be in structure",
      );
      assert.ok(
        !("updated_at" in usersStructure),
        "modified_at column should not be in structure",
      );

      // Only name, email, age should remain
      assert.deepStrictEqual(Object.keys(usersStructure).sort(), [
        "age",
        "email",
        "name",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Output is sorted alphabetically by table name
  // -------------------------------------------------------------------------
  describe("alphabetical sorting", function () {
    it("sorts output alphabetically by table name", function () {
      const schema = {
        adapter: "sqlite3",
        framework: "express",
        tables: {
          zebras: { columns: { stripe: "string" } },
          apples: { columns: { color: "string" } },
          mangoes: { columns: { ripe: "boolean" } },
        },
      };
      const parsed = parseSchema(schema);
      const meta = schemaToModelMeta(parsed);

      assert.deepStrictEqual(
        meta.map((m) => m.table),
        ["apples", "mangoes", "zebras"],
      );
    });
  });

  // -------------------------------------------------------------------------
  // Option fields map correctly from schema timestamps/softDelete
  // -------------------------------------------------------------------------
  describe("option field mapping", function () {
    it("maps softDelete to option.safeDelete", function () {
      const schema = {
        adapter: "postgres",
        framework: "express",
        tables: {
          items: {
            columns: {
              name: "required|string",
              removed: "boolean",
            },
            softDelete: "removed",
          },
        },
      };
      const parsed = parseSchema(schema);
      const meta = schemaToModelMeta(parsed);

      assert.strictEqual(meta[0].option.safeDelete, "removed");
    });

    it("maps timestamps.created_at to option.created_at", function () {
      const schema = {
        adapter: "postgres",
        framework: "express",
        tables: {
          items: {
            columns: {
              name: "required|string",
              made_at: "string",
            },
            timestamps: { created_at: "made_at" },
          },
        },
      };
      const parsed = parseSchema(schema);
      const meta = schemaToModelMeta(parsed);

      assert.strictEqual(meta[0].option.created_at, "made_at");
    });

    it("maps timestamps.modified_at to option.modified_at", function () {
      const schema = {
        adapter: "postgres",
        framework: "express",
        tables: {
          items: {
            columns: {
              name: "required|string",
              changed_at: "string",
            },
            timestamps: { modified_at: "changed_at" },
          },
        },
      };
      const parsed = parseSchema(schema);
      const meta = schemaToModelMeta(parsed);

      assert.strictEqual(meta[0].option.modified_at, "changed_at");
    });

    it("sets option fields to null when not present in schema", function () {
      const schema = {
        adapter: "mysql",
        framework: "express",
        tables: {
          simple: {
            columns: { val: "string" },
          },
        },
      };
      const parsed = parseSchema(schema);
      const meta = schemaToModelMeta(parsed);

      assert.deepStrictEqual(meta[0].option, {
        safeDelete: null,
        created_at: null,
        modified_at: null,
      });
    });
  });
});
