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
        "string:text|minLength:10",
        "required|string|email|maxLength:255",
        "integer:unsigned|min:0",
        "numeric:decimal(10,2)|min:0",
        "object|json",
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

  // -------------------------------------------------------------------------
  // Encrypted columns

  describe("encrypted columns", function () {
    function encSchema(columns, extra) {
      const schema = validSchema();
      schema.tables.users = Object.assign(
        { columns, pk: "id", unique: ["id"] },
        extra,
      );
      return schema;
    }

    it("accepts encrypted string/integer/numeric/boolean/datetime columns", function () {
      const schema = encSchema({
        id: "auto_increment",
        ssn: "encrypted|required|string",
        age: "encrypted|integer",
        score: "encrypted|numeric",
        is_vip: "encrypted|required|boolean",
        joined: "encrypted|datetime",
        profile: "object",
        "profile.dob": "encrypted|required|datetime",
      });
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    });

    it("rejects encrypted object columns (must use dotted keys)", function () {
      const schema = encSchema({ id: "auto_increment", blob: "encrypted|object" });
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes('type "object" which cannot be encrypted'),
        ),
      );
    });

    it("rejects encrypted auto_increment columns", function () {
      const schema = encSchema({ id: "encrypted|auto_increment" });
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
    });

    it("rejects dotted fields without a parent column", function () {
      const schema = encSchema({
        id: "auto_increment",
        "profile.dob": "encrypted|required|datetime",
      });
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes('has no parent column "profile"'),
        ),
      );
    });

    it("rejects dotted fields whose parent is not an object", function () {
      const schema = encSchema({
        id: "auto_increment",
        profile: "required|string",
        "profile.dob": "encrypted|required|datetime",
      });
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes('requires parent column "profile" to be declared as "object"'),
        ),
      );
    });

    it("accepts non-encrypted dotted fields over an object parent", function () {
      const schema = encSchema({
        id: "auto_increment",
        profile: "object",
        "profile.city": "required|string",
      });
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    });

    it("rejects more than one level of dotted nesting", function () {
      const schema = encSchema({
        id: "auto_increment",
        profile: "object",
        "profile.a.b": "encrypted|string",
      });
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) => e.message.includes("at most one level")),
      );
    });

    it("rejects dotted references in pk", function () {
      const schema = encSchema(
        { id: "auto_increment", profile: "object", "profile.dob": "encrypted|string" },
        { pk: "profile.dob", unique: ["id"] },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) => e.path === "tables.users.pk"),
      );
    });

    it("rejects pk referencing an encrypted column", function () {
      const schema = encSchema(
        { id: "auto_increment", ssn: "encrypted|string" },
        { pk: "ssn", unique: ["id"] },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some(
          (e) =>
            e.path === "tables.users.pk" &&
            e.message.includes('encrypted column "ssn"'),
        ),
      );
    });

    it("rejects dotted references in unique", function () {
      const schema = encSchema(
        { id: "auto_increment", profile: "object", "profile.dob": "encrypted|string" },
        { unique: ["profile.dob"] },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes('unique cannot reference a dotted (virtual JSON) field'),
        ),
      );
    });

    it("rejects unique referencing an encrypted column", function () {
      const schema = encSchema(
        { id: "auto_increment", ssn: "encrypted|string" },
        { unique: ["ssn"] },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.path === "tables.users.unique[0]" &&
          e.message.includes('cannot reference an encrypted column "ssn"'),
        ),
      );
    });

    it("rejects dotted references in search_columns", function () {
      const schema = encSchema(
        { id: "auto_increment", profile: "object", "profile.dob": "encrypted|string" },
        { search_columns: ["profile.dob"] },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes('search_columns cannot reference a dotted (virtual JSON) field'),
        ),
      );
    });

    it("rejects search_columns referencing an encrypted column", function () {
      const schema = encSchema(
        { id: "auto_increment", ssn: "encrypted|string", email: "string" },
        { search_columns: ["email", "ssn"] },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.path === "tables.users.search_columns[1]" &&
          e.message.includes('cannot reference an encrypted column "ssn"'),
        ),
      );
      assert.ok(
        !result.errors.some((e) => e.path === "tables.users.search_columns[0]"),
        "plain column in search_columns should not be flagged",
      );
    });

    it("rejects dotted references in softDelete", function () {
      const schema = encSchema(
        { id: "auto_increment", profile: "object", "profile.dob": "encrypted|string", is_deleted: "boolean" },
        { softDelete: "profile.dob" },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.message.includes('softDelete cannot reference a dotted (virtual JSON) field'),
        ),
      );
    });

    it("rejects softDelete referencing an encrypted column", function () {
      const schema = encSchema(
        { id: "auto_increment", is_deleted: "encrypted|boolean" },
        { softDelete: "is_deleted" },
      );
      const result = validateSchema(schema);
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) =>
          e.path === "tables.users.softDelete" &&
          e.message.includes('cannot reference an encrypted column "is_deleted"'),
        ),
      );
    });
  });

  // -------------------------------------------------------------------------
  // options.encryption

  describe("options.encryption", function () {
    function withEncryption(encryption) {
      const schema = validSchema();
      schema.options = { encryption };
      return schema;
    }

    it("accepts a valid encryption block", function () {
      const result = validateSchema(
        withEncryption({
          key: "env:ENC_KEY",
          version: 1,
          keys: { 1: "env:ENC_KEY" },
        }),
      );
      assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    });

    it("accepts a base64 key reference", function () {
      const result = validateSchema(
        withEncryption({ key: "c2VjcmV0", version: 1 }),
      );
      assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
    });

    it("requires key to be a string", function () {
      const result = validateSchema(withEncryption({ version: 1 }));
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) => e.path === "options.encryption.key"),
      );
    });

    it("requires version to be a positive integer", function () {
      for (const bad of [0, -1, "x", 1.5]) {
        const result = validateSchema(
          withEncryption({ key: "env:ENC_KEY", version: bad }),
        );
        assert.strictEqual(result.valid, false, `version=${bad}`);
        assert.ok(
          result.errors.some((e) => e.path === "options.encryption.version"),
        );
      }
    });

    it("validates the keys map", function () {
      const result = validateSchema(
        withEncryption({
          key: "env:ENC_KEY",
          version: 1,
          keys: { x: "env:ENC_KEY" },
        }),
      );
      assert.strictEqual(result.valid, false);
      assert.ok(
        result.errors.some((e) => e.path.startsWith("options.encryption.keys")),
      );
    });

    it("rejects a non-object encryption block", function () {
      const result = validateSchema(withEncryption("nope"));
      assert.strictEqual(result.valid, false);
    });
  });
});
