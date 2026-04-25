"use strict";

const assert = require("assert");
const {
  validateSchema,
  VALID_ADAPTERS,
  VALID_FRAMEWORKS,
} = require("../src/schema/schema-validator");

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

describe("Schema Validator", function () {
  // -------------------------------------------------------------------------
  // Valid schema passes validation
  // -------------------------------------------------------------------------
  describe("valid schema", function () {
    it("returns valid: true with no errors for a minimal valid schema", function () {
      const result = validateSchema(validSchema());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it("accepts all valid adapters", function () {
      for (const adapter of VALID_ADAPTERS) {
        const schema = validSchema();
        schema.adapter = adapter;
        const result = validateSchema(schema);
        assert.strictEqual(
          result.valid,
          true,
          `adapter "${adapter}" should be valid`,
        );
      }
    });

    it("accepts all valid frameworks", function () {
      for (const fw of VALID_FRAMEWORKS) {
        const schema = validSchema();
        schema.framework = fw;
        const result = validateSchema(schema);
        assert.strictEqual(
          result.valid,
          true,
          `framework "${fw}" should be valid`,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Invalid adapter returns error with path "adapter"
  // -------------------------------------------------------------------------
  describe("invalid adapter", function () {
    it("returns an error with path 'adapter' for an unknown adapter", function () {
      const schema = validSchema();
      schema.adapter = "couchdb";
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      const err = result.errors.find((e) => e.path === "adapter");
      assert.ok(err, "should have an error with path 'adapter'");
      assert.ok(
        err.message.includes("couchdb"),
        "message should mention the invalid value",
      );
    });

    it("returns an error when adapter is missing", function () {
      const schema = validSchema();
      delete schema.adapter;
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.path === "adapter"));
    });
  });

  // -------------------------------------------------------------------------
  // Invalid framework returns error with path "framework"
  // -------------------------------------------------------------------------
  describe("invalid framework", function () {
    it("returns an error with path 'framework' for an unknown framework", function () {
      const schema = validSchema();
      schema.framework = "koa";
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      const err = result.errors.find((e) => e.path === "framework");
      assert.ok(err, "should have an error with path 'framework'");
      assert.ok(
        err.message.includes("koa"),
        "message should mention the invalid value",
      );
    });

    it("returns an error when framework is missing", function () {
      const schema = validSchema();
      delete schema.framework;
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.path === "framework"));
    });
  });

  // -------------------------------------------------------------------------
  // Invalid column rule returns error with column path
  // -------------------------------------------------------------------------
  describe("invalid column rule", function () {
    it("returns an error with the column path for an invalid rule", function () {
      const schema = validSchema();
      schema.tables.users.columns.age = "not-a-valid-rule";
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      const err = result.errors.find(
        (e) => e.path === "tables.users.columns.age",
      );
      assert.ok(err, "should have an error at tables.users.columns.age");
      assert.ok(
        err.message.includes("not-a-valid-rule"),
        "message should mention the invalid rule",
      );
    });

    it("accepts all valid column rule patterns", function () {
      const validRules = [
        "string",
        "integer",
        "numeric",
        "boolean",
        "object",
        "required|string",
        "required|integer",
        "required|numeric",
        "required|boolean",
        "required|object",
      ];
      for (const rule of validRules) {
        const schema = validSchema();
        schema.tables.users.columns.test_col = rule;
        const result = validateSchema(schema);
        assert.strictEqual(
          result.valid,
          true,
          `rule "${rule}" should be valid`,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Relationship referencing missing table returns error
  // -------------------------------------------------------------------------
  describe("relationship referencing missing table", function () {
    it("returns an error when parent references a non-existent table", function () {
      const schema = validSchema();
      schema.relationships = [
        { parent: "nonexistent", child: "users", foreignKey: "user_id" },
      ];
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      const err = result.errors.find(
        (e) => e.path === "relationships[0].parent",
      );
      assert.ok(err, "should have an error at relationships[0].parent");
      assert.ok(err.message.includes("nonexistent"));
    });

    it("returns an error when child references a non-existent table", function () {
      const schema = validSchema();
      schema.relationships = [
        { parent: "users", child: "nonexistent", foreignKey: "user_id" },
      ];
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      const err = result.errors.find(
        (e) => e.path === "relationships[0].child",
      );
      assert.ok(err, "should have an error at relationships[0].child");
      assert.ok(err.message.includes("nonexistent"));
    });
  });

  // -------------------------------------------------------------------------
  // Unique entry referencing non-existent column returns error
  // -------------------------------------------------------------------------
  describe("unique entry referencing non-existent column", function () {
    it("returns an error when unique references a column not in the table", function () {
      const schema = validSchema();
      schema.tables.users.unique = ["ghost_column"];
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      const err = result.errors.find(
        (e) => e.path === "tables.users.unique[0]",
      );
      assert.ok(err, "should have an error at tables.users.unique[0]");
      assert.ok(err.message.includes("ghost_column"));
    });

    it("allows unique entry matching the default pk 'id'", function () {
      const schema = validSchema();
      schema.tables.users.unique = ["id"];
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, true);
    });

    it("allows unique entry matching a custom pk", function () {
      const schema = validSchema();
      schema.tables.users.pk = "user_id";
      schema.tables.users.unique = ["user_id"];
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, true);
    });
  });

  // -------------------------------------------------------------------------
  // softDelete referencing non-existent column returns error
  // -------------------------------------------------------------------------
  describe("softDelete referencing non-existent column", function () {
    it("returns an error when softDelete references a column not in the table", function () {
      const schema = validSchema();
      schema.tables.users.softDelete = "deleted_flag";
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      const err = result.errors.find(
        (e) => e.path === "tables.users.softDelete",
      );
      assert.ok(err, "should have an error at tables.users.softDelete");
      assert.ok(err.message.includes("deleted_flag"));
    });

    it("accepts softDelete when it references an existing column", function () {
      const schema = validSchema();
      schema.tables.users.columns.is_deleted = "boolean";
      schema.tables.users.softDelete = "is_deleted";
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, true);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple errors collected in single validation pass
  // -------------------------------------------------------------------------
  describe("multiple errors collected in single validation pass", function () {
    it("collects adapter, framework, and column errors in one pass", function () {
      const schema = {
        adapter: "baddb",
        framework: "badfw",
        tables: {
          items: {
            columns: {
              name: "invalid-rule",
            },
          },
        },
      };
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.length >= 3,
        `expected at least 3 errors, got ${result.errors.length}`,
      );
      assert.ok(result.errors.some((e) => e.path === "adapter"));
      assert.ok(result.errors.some((e) => e.path === "framework"));
      assert.ok(
        result.errors.some((e) => e.path === "tables.items.columns.name"),
      );
    });

    it("collects relationship and unique errors together", function () {
      const schema = validSchema();
      schema.tables.users.unique = ["no_such_col"];
      schema.relationships = [
        { parent: "missing_parent", child: "users", foreignKey: "fk" },
      ];
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.length >= 2,
        `expected at least 2 errors, got ${result.errors.length}`,
      );
      assert.ok(result.errors.some((e) => e.path === "tables.users.unique[0]"));
      assert.ok(
        result.errors.some((e) => e.path === "relationships[0].parent"),
      );
    });
  });
});
