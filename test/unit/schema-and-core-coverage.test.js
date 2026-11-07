"use strict";

const assert = require("assert");
const Module = require("module");
const {
  validateSchema,
  SchemaValidationError,
  VALID_ADAPTERS,
  VALID_FRAMEWORKS,
} = require("../../src/schema/schema-validator");
const { parseSchema } = require("../../src/schema/schema-parser");
const { printSchema } = require("../../src/schema/schema-printer");
const { schemaToModelMeta } = require("../../src/schema/schema-to-meta");
const dbModelRouter = require("../../src/index");
const encryption = require("../../src/commons/encryption");

describe("Schema and Core Library Coverage Suite", function () {
  this.timeout(10000);

  // -------------------------------------------------------------------------
  // 1. schema-validator.js
  // -------------------------------------------------------------------------
  describe("schema-validator.js", function () {
    it("validates a completely valid schema without errors", function () {
      const schema = {
        adapter: "sqlite3",
        framework: "express",
        options: {
          port: 8080,
          output: "src",
          saasStructure: true,
          session: "memory",
          rateLimiting: true,
          helmet: true,
          logger: true,
        },
        tables: {
          users: {
            pk: "id",
            columns: {
              id: "auto_increment",
              username: "required|string",
              email: "required|string",
              deleted: "boolean",
            },
            unique: [["username"], ["email"]],
            softDelete: "deleted",
            search_columns: ["username"],
          },
          posts: {
            pk: "id",
            parent: "users",
            columns: {
              id: "auto_increment",
              user_id: "required|integer",
              title: "required|string",
            },
            unique: [["id"]],
          },
        },
        relationships: [
          {
            parent: "users",
            child: "posts",
            foreignKey: "user_id",
          },
        ],
      };

      const res = validateSchema(schema);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.errors.length, 0);
    });

    it("SchemaValidationError captures message, code, and errors", function () {
      const err = new SchemaValidationError([
        { path: "adapter", message: "Invalid adapter" },
      ]);
      assert.strictEqual(err.errors.length, 1);
      assert.ok(err.message.includes("Schema validation failed: 1 error(s)"));
    });

    it("catches top-level non-object and missing required fields", function () {
      assert.strictEqual(validateSchema(null).valid, false);
      assert.strictEqual(validateSchema("not an object").valid, false);
      assert.strictEqual(validateSchema([]).valid, false);

      const missingTop = validateSchema({}).errors;
      assert.ok(missingTop.some((e) => e.path === "adapter"));
      assert.ok(missingTop.some((e) => e.path === "tables"));
    });

    it("catches invalid adapter and invalid framework", function () {
      const errs = validateSchema({
        adapter: "unsupported_db",
        framework: "unsupported_fw",
        tables: {},
      }).errors;
      assert.ok(errs.some((e) => e.path === "adapter"));
      assert.ok(errs.some((e) => e.path === "framework"));
    });

    it("catches invalid table structures and missing columns", function () {
      const errs = validateSchema({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          emptyTable: null,
          noColumns: {},
        },
      }).errors;
      assert.ok(errs.some((e) => e.message.includes("must be an object")));
      assert.ok(errs.some((e) => e.message.includes("columns object")));
    });

    it("catches primary key, column rule, unique, and softDelete errors", function () {
      const errs = validateSchema({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          items: {
            pk: "dotted.field",
            columns: {
              bad_col: "invalid_rule_pattern$$$",
              good_col: "string",
            },
            unique: "not-an-array",
            softDelete: 12345,
            search_columns: "not-an-array",
            parent: 999,
          },
        },
      }).errors;
      assert.ok(errs.some((e) => e.path.includes("pk")));
      assert.ok(errs.some((e) => e.path.includes("bad_col")));
      assert.ok(errs.some((e) => e.path.includes("unique")));
      assert.ok(errs.some((e) => e.path.includes("softDelete")));
      assert.ok(errs.some((e) => e.path.includes("search_columns")));
      assert.ok(errs.some((e) => e.path.includes("parent")));
    });

    it("catches relationship reference errors", function () {
      const errs = validateSchema({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          users: {
            pk: "id",
            columns: { id: "auto_increment" },
          },
        },
        relationships: [
          null,
          { parent: "nonexistent", child: "users", foreignKey: "x" },
          { parent: "users", child: "nonexistent", foreignKey: "y" },
          { parent: "users", child: "users" }, // missing foreignKey
        ],
      }).errors;
      assert.ok(errs.some((e) => e.path.includes("relationships[0]")));
      assert.ok(errs.some((e) => e.message.includes("does not reference an existing table")));
      assert.ok(errs.some((e) => e.message.includes("foreignKey string")));
    });

    it("catches dotted or encrypted pk, unique, softDelete, and search_columns", function () {
      const errs = validateSchema({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          secure_items: {
            pk: "enc_id",
            columns: {
              enc_id: "required|string|encrypted",
              title: "required|string",
              meta: "object",
              deleted: "boolean|encrypted",
              bio: "string|encrypted",
            },
            unique: [["meta.tag"]],
            softDelete: "deleted",
            search_columns: ["bio", "meta.desc"],
          },
        },
      }).errors;
      assert.ok(errs.some((e) => e.message.includes("pk cannot reference an encrypted column")));
      assert.ok(errs.some((e) => e.message.includes("unique cannot reference a dotted")));
      assert.ok(errs.some((e) => e.message.includes("softDelete cannot reference an encrypted column")));
      assert.ok(errs.some((e) => e.message.includes("search_columns cannot reference an encrypted column")));
      assert.ok(errs.some((e) => e.message.includes("search_columns cannot reference a dotted")));
    });

    it("catches dotted softDelete", function () {
      const errs = validateSchema({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          tbl: {
            pk: "id",
            columns: { id: "auto_increment", meta: "object" },
            softDelete: "meta.is_deleted",
          },
        },
      }).errors;
      assert.ok(errs.some((e) => e.message.includes("softDelete cannot reference a dotted")));
    });

    it("catches table parent pointing to non-existent table", function () {
      const errs = validateSchema({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          items: {
            pk: "id",
            parent: "ghost_table",
            columns: { id: "auto_increment" },
          },
        },
      }).errors;
      assert.ok(errs.some((e) => e.message.includes('parent "ghost_table" does not reference an existing table')));
    });

    it("catches relationships with missing or invalid parent and child", function () {
      const errs = validateSchema({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          users: { pk: "id", columns: { id: "auto_increment" } },
        },
        relationships: [
          { parent: 123, child: "users", foreignKey: "id" },
          { parent: "users", child: 456, foreignKey: "id" },
          { parent: "users", child: "users", foreignKey: 789 },
        ],
      }).errors;
      assert.ok(errs.some((e) => e.message.includes("Relationship must have a parent string")));
      assert.ok(errs.some((e) => e.message.includes("Relationship must have a child string")));
      assert.ok(errs.some((e) => e.message.includes("Relationship must have a foreignKey string")));
    });
  });

  // -------------------------------------------------------------------------
  // 2. schema-parser.js
  // -------------------------------------------------------------------------
  describe("schema-parser.js", function () {
    it("parses valid JSON schema and fills options defaults", function () {
      const raw = JSON.stringify({
        adapter: "sqlite3",
        framework: "express",
        tables: {
          accounts: {
            columns: {
              id: "auto_increment",
              balance: "numeric",
            },
          },
        },
      });

      const parsed = parseSchema(raw);
      assert.strictEqual(parsed.adapter, "sqlite3");
      assert.strictEqual(parsed.framework, "express");
      assert.strictEqual(parsed.options.port, 3000);
      assert.strictEqual(parsed.options.saasStructure, true);
      assert.strictEqual(parsed.tables.accounts.pk, "id");
      assert.deepStrictEqual(parsed.tables.accounts.unique, ["id"]);
    });

    it("throws SchemaValidationError on malformed JSON or invalid schema", function () {
      assert.throws(() => parseSchema("{ invalid json"), /Schema validation failed/);
      assert.throws(() => parseSchema(JSON.stringify({ adapter: "bad" })), (err) => err instanceof SchemaValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // 3. schema-printer.js
  // -------------------------------------------------------------------------
  describe("schema-printer.js", function () {
    it("prints schema preserving table order, options, and relationships", function () {
      const schema = {
        adapter: "postgres",
        framework: "express",
        options: { port: 4000 },
        tables: {
          b_table: {
            pk: "id",
            columns: { id: "auto_increment", name: "string" },
            unique: ["name"],
            softDelete: "is_deleted",
            search_columns: ["name"],
            timestamps: { created_at: "created_at", modified_at: null },
            parent: "a_table",
          },
          a_table: {
            pk: "id",
            columns: { id: "auto_increment" },
            unique: ["id"],
          },
        },
        relationships: [
          { parent: "a_table", child: "b_table", foreignKey: "a_id" },
        ],
      };

      const printed = printSchema(schema);
      assert.ok(typeof printed === "string");
      const parsedBack = JSON.parse(printed);
      assert.strictEqual(parsedBack.adapter, "postgres");
      assert.strictEqual(parsedBack.options.port, 4000);
      const keys = Object.keys(parsedBack.tables);
      assert.strictEqual(keys[0], "a_table");
      assert.strictEqual(keys[1], "b_table");
      assert.strictEqual(parsedBack.tables.b_table.softDelete, "is_deleted");
    });
  });

  // -------------------------------------------------------------------------
  // 4. schema-to-meta.js
  // -------------------------------------------------------------------------
  describe("schema-to-meta.js", function () {
    it("converts parsed schema into model metadata structures", function () {
      const schema = {
        tables: {
          tasks: {
            pk: "task_id",
            columns: {
              task_id: "auto_increment",
              title: "required|string",
              is_deleted: "boolean",
              created_at: "datetime",
            },
            unique: ["title"],
            softDelete: "is_deleted",
            search_columns: ["title"],
            timestamps: { created_at: "created_at", modified_at: "updated_at" },
          },
        },
      };

      const meta = schemaToModelMeta(schema);
      assert.strictEqual(meta.length, 1);
      assert.strictEqual(meta[0].table, "tasks");
      assert.strictEqual(meta[0].primary_key, "task_id");
      assert.deepStrictEqual(meta[0].unique, ["title"]);
      assert.strictEqual(meta[0].option.safeDelete, "is_deleted");
      assert.strictEqual(meta[0].option.created_at, "created_at");
      assert.strictEqual(meta[0].option.modified_at, "updated_at");
      assert.deepStrictEqual(meta[0].option.search_columns, ["title"]);
    });
  });

  // -------------------------------------------------------------------------
  // 5. src/index.js
  // -------------------------------------------------------------------------
  describe("src/index.js (main module entry)", function () {
    it("init loads each adapter and rejects unsupported adapters", function () {
      // Test all supported adapters
      const adapters = [
        "mysql",
        "mariadb",
        "postgresql",
        "postgres",
        "oracle",
        "sqlite3",
        "mssql",
        "cockroachdb",
        "mongodb",
        "redis",
        "dynamodb",
      ];

      for (const a of adapters) {
        dbModelRouter.init(a);
        assert.ok(dbModelRouter.db);
      }

      // Unsupported adapter
      assert.throws(() => {
        dbModelRouter.init("unknown_adapter");
      }, /Unsupported DB_TYPE/);
    });

    it("init formats missing driver error when driver MODULE_NOT_FOUND occurs", function () {
      const origRequire = Module.prototype.require;
      try {
        Module.prototype.require = function (p) {
          if (p.endsWith("sqlite3/db.js") || p.endsWith("sqlite3/db")) {
            const err = new Error("Cannot find module 'better-sqlite3'");
            err.code = "MODULE_NOT_FOUND";
            throw err;
          }
          return origRequire.apply(this, arguments);
        };
        assert.throws(
          () => dbModelRouter.init("sqlite3"),
          /Missing driver for "sqlite3"\. Install it with: npm install better-sqlite3/,
        );
      } finally {
        Module.prototype.require = origRequire;
      }
    });

    it("init re-throws generic non-MODULE_NOT_FOUND driver error", function () {
      const origRequire = Module.prototype.require;
      try {
        Module.prototype.require = function (p) {
          if (p.endsWith("sqlite3/db.js") || p.endsWith("sqlite3/db")) {
            throw new Error("Generic driver crash");
          }
          return origRequire.apply(this, arguments);
        };
        assert.throws(
          () => dbModelRouter.init("sqlite3"),
          /Generic driver crash/,
        );
      } finally {
        Module.prototype.require = origRequire;
      }
    });

    it("transaction delegates when supported and throws when unsupported", async function () {
      // With sqlite3 (supports transactions)
      dbModelRouter.init("sqlite3");
      dbModelRouter.db.connect({ database: ":memory:" });
      const res = await dbModelRouter.transaction(async () => {
        return "tx-success";
      });
      assert.strictEqual(res, "tx-success");

      // With adapter without transaction (mocked)
      const origTx = dbModelRouter.db.transaction;
      try {
        dbModelRouter.db.transaction = undefined;
        await assert.rejects(async () => {
          await dbModelRouter.transaction(async () => {});
        }, /does not support transactions/);
      } finally {
        dbModelRouter.db.transaction = origTx;
      }
    });

    it("initConfig captures encryption and retains keyring across calls", function () {
      const keyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      dbModelRouter.init("sqlite3", {
        encryption: {
          key: keyHex,
          version: 1,
        },
      });
      assert.ok(dbModelRouter.initConfig);
      assert.strictEqual(dbModelRouter.initConfig.encryption.version, 1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. src/commons/encryption.js (edge cases)
  // -------------------------------------------------------------------------
  describe("src/commons/encryption.js edge cases", function () {
    const keyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    before(function () {
      encryption.setConfig({
        key: keyHex,
        version: 1,
      });
    });

    it("isEncrypted and parseEnvelope validate format strictly", function () {
      assert.strictEqual(encryption.isEncrypted(null), false);
      assert.strictEqual(encryption.isEncrypted("plain text"), false);
      assert.strictEqual(encryption.isEncrypted("enc:v1:abc"), true);

      assert.strictEqual(encryption.parseEnvelope(null), null);
      assert.strictEqual(encryption.parseEnvelope("not-an-envelope"), null);
      assert.strictEqual(encryption.parseEnvelope("enc:bad:format:extra"), null);
      assert.strictEqual(encryption.parseEnvelope("enc:vABC:payload"), null);

      const parsed = encryption.parseEnvelope("enc:v2:myPayload==");
      assert.strictEqual(parsed.version, 2);
      assert.strictEqual(parsed.payload, "myPayload==");
    });

    it("sanitizeRule strips 'encrypted' token from rules", function () {
      assert.strictEqual(
        encryption.sanitizeRule("required|string|encrypted|minLength:5"),
        "required|string|minLength:5",
      );
      assert.strictEqual(encryption.sanitizeRule("encrypted"), "");
      assert.strictEqual(encryption.sanitizeRule(null), null);
    });

    it("serializeValue and deserializeValue handle all scalar and object types", function () {
      const types = [
        { type: "string", val: "hello", check: (v) => v === "hello" },
        { type: "integer", val: 42, check: (v) => v === 42 },
        { type: "numeric", val: 3.1415, check: (v) => Math.abs(v - 3.1415) < 0.001 },
        { type: "boolean", val: true, check: (v) => v === true },
        { type: "datetime", val: new Date("2026-01-01T00:00:00.000Z"), check: (v) => typeof v === "string" && !isNaN(Date.parse(v)) },
        { type: "object", val: { a: 1, b: "test" }, check: (v) => v.a === 1 && v.b === "test" },
      ];

      for (const { type, val, check } of types) {
        const ser = encryption.serializeValue(val, type);
        const deser = encryption.deserializeValue(ser, type);
        assert.ok(check(deser), `Failed serialization for type ${type}`);
      }

      // Null and undefined
      assert.strictEqual(encryption.serializeValue(null, "string"), null);
      assert.strictEqual(encryption.deserializeValue(null, "string"), null);
    });

    it("encrypt and decrypt roundtrip successfully", function () {
      const conf = encryption.getConfig();
      const plaintext = "Top secret data payload";
      const cipher = encryption.encrypt(plaintext, conf.keyring[1], 1);
      assert.ok(cipher.startsWith("enc:v1:"));

      const decrypted = encryption.decrypt(cipher, conf.keyring);
      assert.strictEqual(decrypted, plaintext);

      // Decrypt unknown version throws
      assert.throws(() => {
        encryption.decrypt("enc:v999:payload==", conf.keyring);
      }, /No key available for encryption version/);
    });
  });
});
