"use strict";

const assert = require("assert");
const { parseSchema } = require("../src/schema/schema-parser");
const { SchemaValidationError } = require("../src/schema/schema-validator");

/**
 * Helper: returns a minimal valid schema object.
 */
function validSchema() {
  return {
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
  };
}

describe("Schema Parser", function () {
  // -------------------------------------------------------------------------
  // Parsing a valid JSON string produces correct internal representation
  // -------------------------------------------------------------------------
  describe("parseSchema with JSON string", function () {
    it("parses a valid JSON string and returns the internal representation", function () {
      const schema = validSchema();
      const result = parseSchema(JSON.stringify(schema));

      assert.strictEqual(result.adapter, "postgres");
      assert.strictEqual(result.framework, "express");
      assert.deepStrictEqual(result.relationships, []);
      assert.deepStrictEqual(result.options, {});
      assert.ok(result.tables.users);
      assert.strictEqual(result.tables.users.name, "users");
      assert.deepStrictEqual(result.tables.users.columns, {
        name: "required|string",
        email: "required|string",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Parsing a plain object works identically
  // -------------------------------------------------------------------------
  describe("parseSchema with plain object", function () {
    it("parses a plain object and returns the same result as a JSON string", function () {
      const schema = validSchema();
      const fromObject = parseSchema(schema);
      const fromString = parseSchema(JSON.stringify(validSchema()));

      assert.deepStrictEqual(fromObject, fromString);
    });
  });

  // -------------------------------------------------------------------------
  // pk defaults to "id" when omitted
  // -------------------------------------------------------------------------
  describe("pk defaults", function () {
    it("defaults pk to 'id' when omitted", function () {
      const schema = validSchema();
      const result = parseSchema(schema);
      assert.strictEqual(result.tables.users.pk, "id");
    });

    it("uses the provided pk when present", function () {
      const schema = validSchema();
      schema.tables.users.pk = "user_id";
      const result = parseSchema(schema);
      assert.strictEqual(result.tables.users.pk, "user_id");
    });
  });

  // -------------------------------------------------------------------------
  // unique defaults to [pk] when omitted
  // -------------------------------------------------------------------------
  describe("unique defaults", function () {
    it("defaults unique to [pk] when omitted", function () {
      const schema = validSchema();
      const result = parseSchema(schema);
      assert.deepStrictEqual(result.tables.users.unique, ["id"]);
    });

    it("defaults unique to [custom pk] when pk is set but unique is omitted", function () {
      const schema = validSchema();
      schema.tables.users.pk = "user_id";
      const result = parseSchema(schema);
      assert.deepStrictEqual(result.tables.users.unique, ["user_id"]);
    });

    it("preserves explicit unique when provided", function () {
      const schema = validSchema();
      schema.tables.users.unique = ["email"];
      const result = parseSchema(schema);
      assert.deepStrictEqual(result.tables.users.unique, ["email"]);
    });
  });

  // -------------------------------------------------------------------------
  // timestamps defaults
  // -------------------------------------------------------------------------
  describe("timestamps defaults", function () {
    it("defaults timestamps to { created_at: null, modified_at: null } when omitted", function () {
      const schema = validSchema();
      const result = parseSchema(schema);
      assert.deepStrictEqual(result.tables.users.timestamps, {
        created_at: null,
        modified_at: null,
      });
    });

    it("preserves explicit timestamps when provided", function () {
      const schema = validSchema();
      schema.tables.users.timestamps = {
        created_at: "created_at",
        modified_at: "updated_at",
      };
      const result = parseSchema(schema);
      assert.deepStrictEqual(result.tables.users.timestamps, {
        created_at: "created_at",
        modified_at: "updated_at",
      });
    });
  });

  // -------------------------------------------------------------------------
  // softDelete defaults
  // -------------------------------------------------------------------------
  describe("softDelete defaults", function () {
    it("defaults softDelete to null when omitted", function () {
      const schema = validSchema();
      const result = parseSchema(schema);
      assert.strictEqual(result.tables.users.softDelete, null);
    });

    it("preserves explicit softDelete when provided", function () {
      const schema = validSchema();
      schema.tables.users.columns.is_deleted = "boolean";
      schema.tables.users.softDelete = "is_deleted";
      const result = parseSchema(schema);
      assert.strictEqual(result.tables.users.softDelete, "is_deleted");
    });
  });

  // -------------------------------------------------------------------------
  // Invalid JSON string throws with descriptive error
  // -------------------------------------------------------------------------
  describe("invalid JSON string", function () {
    it("throws SchemaValidationError with descriptive message for invalid JSON", function () {
      assert.throws(
        () => parseSchema("{not valid json}"),
        (err) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.strictEqual(err.errors.length, 1);
          assert.strictEqual(err.errors[0].path, "");
          assert.ok(err.errors[0].message.includes("Invalid JSON"));
          return true;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Invalid schema throws SchemaValidationError
  // -------------------------------------------------------------------------
  describe("invalid schema", function () {
    it("throws SchemaValidationError for invalid adapter", function () {
      const schema = validSchema();
      schema.adapter = "baddb";
      assert.throws(
        () => parseSchema(schema),
        (err) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.ok(err.errors.some((e) => e.path === "adapter"));
          return true;
        },
      );
    });

    it("throws SchemaValidationError for missing tables", function () {
      const schema = validSchema();
      delete schema.tables;
      assert.throws(
        () => parseSchema(schema),
        (err) => {
          assert.ok(err instanceof SchemaValidationError);
          assert.ok(err.errors.some((e) => e.path === "tables"));
          return true;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Relationships and options are preserved
  // -------------------------------------------------------------------------
  describe("relationships and options", function () {
    it("preserves relationships from the schema", function () {
      const schema = validSchema();
      schema.tables.posts = {
        columns: {
          title: "required|string",
          user_id: "required|integer",
        },
      };
      schema.relationships = [
        { parent: "users", child: "posts", foreignKey: "user_id" },
      ];
      const result = parseSchema(schema);
      assert.strictEqual(result.relationships.length, 1);
      assert.deepStrictEqual(result.relationships[0], {
        parent: "users",
        child: "posts",
        foreignKey: "user_id",
      });
    });

    it("preserves options from the schema", function () {
      const schema = validSchema();
      schema.options = { session: "redis", helmet: true };
      const result = parseSchema(schema);
      assert.deepStrictEqual(result.options, {
        session: "redis",
        helmet: true,
      });
    });
  });
});
