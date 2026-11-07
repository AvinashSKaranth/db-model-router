process.env.NODE_ENV = "TEST";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  generateTypes,
  ruleToTypeScript,
  toPascalCase,
} = require("../../src/cli/generate-types");
const typesCommand = require("../../src/cli/commands/types");

describe("TypeScript Type Generator (generate-types & CLI)", function () {
  const tmpDir = path.join(__dirname, "..", "tmp_types_test");
  const tmpSchemaFile = path.join(tmpDir, "test.schema.json");
  const tmpOutFile = path.join(tmpDir, "models.d.ts");

  before(function () {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  after(function () {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe("ruleToTypeScript", function () {
    it("maps auto_increment to number and required", function () {
      const res = ruleToTypeScript("auto_increment");
      assert.strictEqual(res.type, "number");
      assert.strictEqual(res.required, true);
    });

    it("maps required string rules", function () {
      const res = ruleToTypeScript("required|string|email|maxLength:255");
      assert.strictEqual(res.type, "string");
      assert.strictEqual(res.required, true);
    });

    it("maps optional string rules with subtypes", function () {
      const res = ruleToTypeScript("string:text");
      assert.strictEqual(res.type, "string");
      assert.strictEqual(res.required, false);
    });

    it("maps numeric types to number", function () {
      assert.strictEqual(ruleToTypeScript("integer").type, "number");
      assert.strictEqual(ruleToTypeScript("required|integer:unsigned").type, "number");
      assert.strictEqual(ruleToTypeScript("numeric:decimal(10,2)").type, "number");
    });

    it("maps boolean types", function () {
      assert.strictEqual(ruleToTypeScript("boolean").type, "boolean");
      assert.strictEqual(ruleToTypeScript("required|boolean").required, true);
    });

    it("maps datetime types to string | Date", function () {
      assert.strictEqual(ruleToTypeScript("datetime").type, "string | Date");
    });

    it("maps object types to Record<string, any>", function () {
      assert.strictEqual(ruleToTypeScript("object").type, "Record<string, any>");
    });
  });

  describe("toPascalCase", function () {
    it("converts snake_case to PascalCase", function () {
      assert.strictEqual(toPascalCase("users"), "Users");
      assert.strictEqual(toPascalCase("order_items"), "OrderItems");
      assert.strictEqual(toPascalCase("campaign_recipient_log"), "CampaignRecipientLog");
    });
  });

  describe("generateTypes", function () {
    it("generates correct interface definitions from schema", function () {
      const schema = {
        tables: {
          users: {
            columns: {
              user_id: "auto_increment",
              name: "required|string",
              email: "required|string|email",
              age: "integer",
              is_deleted: "boolean",
              created_at: "datetime",
              metadata: "object",
            },
            pk: "user_id",
          },
          posts: {
            columns: {
              post_id: "auto_increment",
              title: "required|string",
              content: "string:text",
            },
            pk: "post_id",
          },
        },
      };

      const dts = generateTypes(schema);

      assert(dts.includes("export interface Users {"));
      assert(dts.includes("user_id: number;"));
      assert(dts.includes("name: string;"));
      assert(dts.includes("email: string;"));
      assert(dts.includes("age?: number | null;"));
      assert(dts.includes("is_deleted?: boolean | null;"));
      assert(dts.includes("created_at?: string | Date | null;"));
      assert(dts.includes("metadata?: Record<string, any> | null;"));
      assert(dts.includes("export interface Posts {"));
      assert(dts.includes("title: string;"));
      assert(dts.includes("content?: string | null;"));
      assert(dts.includes('export interface DatabaseSchema {'));
      assert(dts.includes('"users": Users;'));
      assert(dts.includes('"posts": Posts;'));
      assert(dts.includes("export type TableName = keyof DatabaseSchema;"));
    });

    it("throws on invalid schema without tables", function () {
      assert.throws(() => generateTypes({}), /Invalid schema/);
    });
  });

  describe("CLI types command", function () {
    it("reads schema file and writes .d.ts file", async function () {
      const schema = {
        tables: {
          products: {
            columns: {
              id: "auto_increment",
              title: "required|string",
              price: "required|numeric",
            },
            pk: "id",
          },
        },
      };
      fs.writeFileSync(tmpSchemaFile, JSON.stringify(schema, null, 2), "utf-8");

      const exitCode = await typesCommand({
        from: tmpSchemaFile,
        out: tmpOutFile,
      });

      assert.strictEqual(exitCode, 0);
      assert(fs.existsSync(tmpOutFile));
      const content = fs.readFileSync(tmpOutFile, "utf-8");
      assert(content.includes("export interface Products {"));
      assert(content.includes("title: string;"));
      assert(content.includes("price: number;"));
    });

    it("handles missing schema file gracefully", async function () {
      await assert.rejects(
        async () => {
          await typesCommand({
            from: "nonexistent.schema.json",
            out: tmpOutFile,
          });
        },
        /Schema file not found/,
      );
    });
  });
});
