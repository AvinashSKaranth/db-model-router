process.env.NODE_ENV = "TEST";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const express = require("express");

const fn = require("../../src/commons/function.js");
const kafka = require("../../src/commons/kafka.js");
const validator = require("../../src/commons/validator.js");
const model = require("../../src/commons/model.js");
const route = require("../../src/commons/route.js");
const migrationRunner = require("../../src/commons/migration-runner.js");
const sqliteDb = require("../../src/sqlite3/db.js");

describe("Commons & SQLite Deep Coverage Test Suite", function () {
  let testModel;
  let app;

  before(function () {
    sqliteDb.connect({ database: ":memory:" });
    sqliteDb.query(`CREATE TABLE deep_cov_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT,
      count INTEGER,
      payload TEXT,
      is_deleted INTEGER DEFAULT 0
    )`);
  });

  after(function () {
    try {
      sqliteDb.disconnect();
    } catch (_) {}
  });

  describe("function.js Complete Branch Coverage", function () {
    it("getByPath handles invalid objects and edge-case paths", function () {
      assert.strictEqual(fn.getByPath(null, ["a"]), undefined);
      assert.strictEqual(fn.getByPath(123, ["a"]), undefined);
      assert.strictEqual(fn.getByPath({}, null), undefined);
      assert.strictEqual(fn.getByPath({ a: null }, ["a", "b"]), undefined);
      assert.strictEqual(fn.getByPath({ a: "string" }, ["a", "b"]), undefined);
      assert.strictEqual(fn.getByPath({ a: { b: 42 } }, ["a", "b"]), 42);
      assert.strictEqual(fn.getByPath({ a: { b: 42 } }, ["a", "c"]), undefined);
    });

    it("setByPath handles invalid objects, creates intermediates, and deletes on undefined", function () {
      assert.strictEqual(fn.setByPath(null, ["a"], 1), null);
      assert.strictEqual(fn.setByPath({}, null, 1) instanceof Object, true);

      const obj = {};
      fn.setByPath(obj, ["user", "profile", "name"], "Alice");
      assert.strictEqual(obj.user.profile.name, "Alice");

      // Deleting property when value is undefined
      fn.setByPath(obj, ["user", "profile", "name"], undefined);
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(obj.user.profile, "name"),
        false,
      );

      // Intermediate is not an object
      const nonObj = { user: "string-value" };
      fn.setByPath(nonObj, ["user", "name"], "Bob");
      assert.strictEqual(nonObj.user, "string-value");
    });

    it("empty correctly evaluates falsy and truthy edge cases", function () {
      assert.strictEqual(fn.empty(null), true);
      assert.strictEqual(fn.empty(undefined), true);
      assert.strictEqual(fn.empty(""), true);
      assert.strictEqual(fn.empty(0), false);
      assert.strictEqual(fn.empty(false), false);
      assert.strictEqual(fn.empty("value"), false);
    });

    it("objectSelecter traverses nested paths and returns null for missing keys", function () {
      const data = { a: { b: { c: 100 } } };
      assert.strictEqual(fn.objectSelecter(data, ["a", "b", "c"]), 100);
      assert.strictEqual(fn.objectSelecter(data, ["a", "nonexistent"]), null);
    });

    it("wouldLosePrecision handles scientific notation, high precision, and boundaries", function () {
      // Scientific notation that loses precision
      assert.strictEqual(fn.wouldLosePrecision("1e30"), true);
      // Large integers beyond MAX_SAFE_INTEGER
      assert.strictEqual(fn.wouldLosePrecision("9007199254740993"), true);
      // Safe integers
      assert.strictEqual(fn.wouldLosePrecision("9007199254740990"), false);
      // Significant digits > 16
      assert.strictEqual(fn.wouldLosePrecision("1234567890123456789"), true);
      // Trailing zeros in decimal (not precision loss)
      assert.strictEqual(fn.wouldLosePrecision("1.50000"), false);
    });

    it("jsonSafeParse handles nested objects and invalid scalar values", function () {
      const nested = { a: '{"b":1}', c: 42 };
      const parsed = fn.jsonSafeParse(nested);
      assert.deepStrictEqual(parsed.a, { b: 1 });
      assert.strictEqual(parsed.c, 42);

      // Non-object, non-string primitives
      assert.strictEqual(fn.jsonSafeParse(123), 123);
      assert.strictEqual(fn.jsonSafeParse(true), true);
      assert.strictEqual(fn.jsonSafeParse(null), null);
    });

    it("jsonStringify handles arrays of objects and nested objects", function () {
      const arr = [{ a: { b: 1 } }, { c: { d: 2 } }];
      const res = fn.jsonStringify(arr);
      assert.strictEqual(typeof res[0].a, "string");
      assert.strictEqual(typeof res[1].c, "string");

      assert.strictEqual(fn.jsonStringify("simple-string"), "simple-string");
    });
  });

  describe("kafka.js Complete Branch Coverage", function () {
    it("returns false from init when broker is not specified", async function () {
      const orig = process.env.KAFKA_BROKER;
      delete process.env.KAFKA_BROKER;
      const res = await kafka.init({});
      assert.strictEqual(res, false);
      assert.strictEqual(kafka.status(), false);
      if (orig) process.env.KAFKA_BROKER = orig;
    });

    it("produce returns early when Kafka is not enabled", async function () {
      // Should not throw or crash when called while disabled
      await kafka.produce("items", "insert", { id: 1 });
      await kafka.disconnect();
      assert.strictEqual(kafka.status(), false);
    });

    it("initializes mock producer, batches large message sets, handles error, and disconnects", async function () {
      const kPath = require.resolve("kafkajs");
      let sentCount = 0;
      let shouldFail = false;
      require.cache[kPath] = {
        id: kPath,
        filename: kPath,
        loaded: true,
        exports: {
          Kafka: class {
            constructor() {}
            producer() {
              return {
                connect: async () => {},
                send: async ({ messages }) => {
                  if (shouldFail) throw new Error("Simulated broker network failure");
                  sentCount += messages.length;
                },
                disconnect: async () => {},
              };
            }
          },
        },
      };

      const initialized = await kafka.init({ broker: "mock:9092", topicPrefix: "test_dbmr" });
      assert.strictEqual(initialized, true);
      assert.strictEqual(kafka.status(), true);

      // Produce batch exceeding 500 items to test batch chunking
      const largeBatch = Array.from({ length: 650 }, (_, i) => ({ id: i, name: `Record_${i}` }));
      await kafka.produce("deep_cov_items", "insert", largeBatch);
      assert.strictEqual(sentCount, 650);

      // Produce single item
      await kafka.produce("deep_cov_items", "insert", { id: 999 });
      assert.strictEqual(sentCount, 651);

      // Trigger produce error catch block
      shouldFail = true;
      await kafka.produce("deep_cov_items", "update", { id: 1 });

      await kafka.disconnect();
      assert.strictEqual(kafka.status(), false);
      delete require.cache[kPath];
    });
  });

  describe("validator.js Complete Branch Coverage", function () {
    it("dataToFilter handles complex filter wrappers with additional object conditions", function () {
      const input = {
        filter: [[["status", "=", "active"]]],
        title: "Test Item",
      };
      const result = validator.dataToFilter(input, "id");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].length, 2);
    });

    it("dataToFilter handles empty filter wrapper with additional object conditions", function () {
      const input = {
        filter: [],
        title: "Test Item",
      };
      const result = validator.dataToFilter(input, "id");
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0][0][0], "title");
    });

    it("dataToFilter handles nested data arrays", function () {
      const input = { data: [1, 2, 3] };
      const result = validator.dataToFilter(input, "id");
      assert.deepStrictEqual(result, [[["id", "in", [1, 2, 3]]]]);
    });

    it("dataToFilter handles array of ID objects", function () {
      const input = [{ id: 10 }, { id: 20 }, { id: 30 }];
      const result = validator.dataToFilter(input, "id");
      assert.deepStrictEqual(result, [[["id", "in", [10, 20, 30]]]]);
    });

    it("dataToFilter handles array of non-ID objects by mapping to OR conditions", function () {
      const input = [{ title: "A" }, { title: "B" }];
      const result = validator.dataToFilter(input, "id");
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0][0][0], "title");
      assert.strictEqual(result[1][0][0], "title");
    });

    it("parseFilterValue covers all operators (<, >, <=, >=, !=, !in, %like%, !%not like%)", function () {
      assert.deepStrictEqual(validator.parseFilterValue("!in(a, b, c)"), ["not in", ["a", "b", "c"]]);
      assert.deepStrictEqual(validator.parseFilterValue("<=100"), ["<=", "100"]);
      assert.deepStrictEqual(validator.parseFilterValue(">=100"), [">=", "100"]);
      assert.deepStrictEqual(validator.parseFilterValue("<100"), ["<", "100"]);
      assert.deepStrictEqual(validator.parseFilterValue(">100"), [">", "100"]);
      assert.deepStrictEqual(validator.parseFilterValue("!archived"), ["!=", "archived"]);
      assert.deepStrictEqual(validator.parseFilterValue("!%keyword%"), ["not like", "%keyword%"]);
      assert.deepStrictEqual(validator.parseFilterValue("%keyword%"), ["like", "%keyword%"]);
      assert.deepStrictEqual(validator.parseFilterValue(123), ["=", 123]);
    });

    it("RemovePK removes primary key from array of records and handles missing pk", function () {
      const arr = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { name: "C" }];
      validator.RemovePK("id", arr);
      assert.strictEqual(arr[0].id, undefined);
      assert.strictEqual(arr[1].id, undefined);
      assert.strictEqual(arr[2].name, "C");
    });

    it("errorResponse handles status from cause and sends response", function () {
      let sentStatus = null;
      let sentBody = null;
      const fakeRes = {
        status: (s) => {
          sentStatus = s;
          return {
            send: (b) => {
              sentBody = b;
            },
          };
        },
      };

      const errWithCause = new Error("Failed validation", { cause: { status: 422 } });
      validator.errorResponse(fakeRes, errWithCause);
      assert.strictEqual(sentStatus, 422);
      assert.strictEqual(sentBody.type, "danger");

      const errWithoutCause = new Error("General error");
      validator.errorResponse(fakeRes, errWithoutCause);
      assert.strictEqual(sentStatus, 500);
    });
  });

  describe("model.js and route.js Complete Branch Coverage", function () {
    before(async function () {
      testModel = model(
        sqliteDb,
        "deep_cov_items",
        {
          id: "integer",
          title: "required|string",
          status: "string",
          count: "integer",
          payload: "string",
          is_deleted: "integer",
        },
        "id",
        ["id"],
        {
          safeDelete: "is_deleted",
          search_columns: ["title", "status"],
        },
      );

      app = express();
      app.use(express.json());
      app.use(
        "/api/items",
        route(
          testModel,
          {
            $skipMe: "headers.authorization",
            status: "headers.x-status",
          },
          { express },
        ),
      );
      app.use("/api/export", route(testModel, {}, { express }));
    });

    it("patch rejects when primary key is missing", async function () {
      await assert.rejects(
        async () => {
          await testModel.patch({ title: "No PK provided" });
        },
        /Primary key is required for patch/,
      );
    });

    it("patch returns null when record does not exist", async function () {
      const res = await testModel.patch({ id: 999999, title: "Nonexistent" });
      assert.strictEqual(res, null);
    });

    it("findOne executes afterFind hook when defined", async function () {
      let hookRan = false;
      const hookedModel = model(
        sqliteDb,
        "deep_cov_items",
        { id: "integer", title: "required|string", is_deleted: "integer" },
        "id",
        ["id"],
        {
          hooks: {
            afterFind: async (rows) => {
              hookRan = true;
              return rows;
            },
          },
        },
      );

      await hookedModel.insert({ title: "Hook Test" });
      const found = await hookedModel.findOne({ title: "Hook Test" });
      assert.ok(found);
      assert.strictEqual(hookRan, true);
    });

    it("withTx wraps the model with a transaction context", async function () {
      const txWrapped = testModel.withTx({
        adapter: sqliteDb,
        _kafkaBuffer: [],
      });
      assert.ok(txWrapped.insert);
      assert.ok(txWrapped.byId);
    });

    it("DELETE / with empty body returns 400", async function () {
      const res = await request(app).delete("/api/items/").send({});
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.type, "danger");
    });

    it("DELETE / with { data: [...] } deletes items successfully", async function () {
      const item1 = await testModel.insert({ title: "To Delete 1" });
      const item2 = await testModel.insert({ title: "To Delete 2" });

      const res = await request(app)
        .delete("/api/items/")
        .send({ data: [item1.id, item2.id] });
      assert.strictEqual(res.status, 200);

      const check1 = await testModel.byId(item1.id);
      const check2 = await testModel.byId(item2.id);
      assert.strictEqual(check1, null);
      assert.strictEqual(check2, null);
    });

    it("handles headers override and strips string 'null' in route payload", async function () {
      const res = await request(app)
        .post("/api/items/add")
        .set("x-status", "overridden-active")
        .send({
          title: "Override Item",
          count: "null",
        });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, "overridden-active");
    });

    it("sendFormatted exports collection as text/csv and application/xml", async function () {
      await testModel.insert({ title: "CSV Export Item" });

      const csvRes = await request(app).get("/api/export/?output_content_type=csv");
      assert.strictEqual(csvRes.status, 200);
      assert.ok(csvRes.headers["content-type"].includes("text/csv"));
      assert.ok(csvRes.text.includes("title"));

      const xmlRes = await request(app).get("/api/export/?output_content_type=xml");
      assert.strictEqual(xmlRes.status, 200);
      assert.ok(xmlRes.headers["content-type"].includes("application/xml"));
      assert.ok(xmlRes.text.includes("<?xml"));
    });
  });

  describe("migration-runner.js Complete Branch Coverage", function () {
    const tmpDir = path.join(__dirname, "..", "tmp_mig_cov_" + Date.now());

    before(function () {
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    after(function () {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    });

    it("runs SQL migrations UP and rolls them back with corresponding .down.sql", async function () {
      const sqlFile = path.join(tmpDir, "001_create_cov_table.sql");
      const downSqlFile = path.join(tmpDir, "001_create_cov_table.down.sql");

      fs.writeFileSync(sqlFile, "CREATE TABLE cov_tbl (id INTEGER PRIMARY KEY, note TEXT);");
      fs.writeFileSync(downSqlFile, "DROP TABLE IF EXISTS cov_tbl;");

      const upRes = await migrationRunner.up(sqliteDb, tmpDir, "sqlite");
      assert.strictEqual(upRes.applied.length, 1);
      assert.strictEqual(upRes.applied[0].filename, "001_create_cov_table.sql");

      // Verify table was created
      sqliteDb.query("INSERT INTO cov_tbl (note) VALUES ('hello')");

      // Rollback
      const downRes = await migrationRunner.down(sqliteDb, tmpDir, "sqlite");
      assert.strictEqual(downRes.rolledBack.length, 1);

      // Rolling back again when no migrations are applied
      const emptyDown = await migrationRunner.down(sqliteDb, tmpDir, "sqlite");
      assert.strictEqual(emptyDown.rolledBack.length, 0);
    });

    it("throws error when rolling back SQL migration without .down.sql file", async function () {
      const orphanSql = path.join(tmpDir, "002_orphan_migration.sql");
      fs.writeFileSync(orphanSql, "CREATE TABLE orphan_tbl (id INTEGER PRIMARY KEY);");

      await migrationRunner.up(sqliteDb, tmpDir, "sqlite");

      await assert.rejects(
        async () => {
          await migrationRunner.down(sqliteDb, tmpDir, "sqlite");
        },
        /missing corresponding '\.down\.sql' file/,
      );
    });
  });

  describe("sqlite3 db.js Transaction & Edge-Case Coverage", function () {
    it("transaction throws error when callback is not a function", async function () {
      await assert.rejects(async () => {
        await sqliteDb.transaction(null);
      }, /Transaction requires a callback function/);
    });

    it("handles nested transactions with savepoints and commit", async function () {
      await sqliteDb.transaction(async (_tx1) => {
        sqliteDb.query("INSERT INTO deep_cov_items (title) VALUES ('Outer Tx')");

        // Nested savepoint
        await sqliteDb.transaction(async (_tx2) => {
          sqliteDb.query("INSERT INTO deep_cov_items (title) VALUES ('Inner Savepoint')");
        });
      });

      const records = sqliteDb.query("SELECT * FROM deep_cov_items WHERE title IN ('Outer Tx', 'Inner Savepoint')");
      assert.strictEqual(records.length, 2);
    });

    it("tx.model creates model bound to transaction", async function () {
      await sqliteDb.transaction(async (tx) => {
        const m = tx.model("deep_cov_items");
        assert.ok(m);
      });
    });

    it("rolls back changes on transaction error", async function () {
      await assert.rejects(async () => {
        await sqliteDb.transaction(async () => {
          sqliteDb.query("INSERT INTO deep_cov_items (title) VALUES ('Should Be Rolled Back')");
          throw new Error("Force Rollback");
        });
      }, /Force Rollback/);

      const check = sqliteDb.query("SELECT * FROM deep_cov_items WHERE title = 'Should Be Rolled Back'");
      assert.strictEqual(check.length, 0, "Rolled back row must not exist in table");
    });

    it("rolls back inner savepoint on nested transaction error", async function () {
      await sqliteDb.transaction(async () => {
        sqliteDb.query("INSERT INTO deep_cov_items (title) VALUES ('Survives Outer')");

        await assert.rejects(async () => {
          await sqliteDb.transaction(async () => {
            sqliteDb.query("INSERT INTO deep_cov_items (title) VALUES ('Rolled Back Inner')");
            throw new Error("Force Savepoint Rollback");
          });
        }, /Force Savepoint Rollback/);
      });

      const survives = sqliteDb.query("SELECT * FROM deep_cov_items WHERE title = 'Survives Outer'");
      assert.strictEqual(survives.length, 1);

      const rolledBack = sqliteDb.query("SELECT * FROM deep_cov_items WHERE title = 'Rolled Back Inner'");
      assert.strictEqual(rolledBack.length, 0);
    });

    it("sort_builder and resolveSortIdentifiers cover sort order replacements", function () {
      const res = sqliteDb.list("deep_cov_items", [], [["title", "DESC"]]);
      assert.ok(Array.isArray(res.data));
    });
  });

  describe("Final Edge Cases for >95% Core Coverage", function () {
    it("function.js: getType covers undefined, and jsonSafeParse covers reviver path", function () {
      assert.strictEqual(fn.getType(undefined), "null");
      assert.strictEqual(fn.getType(null), "null");
      assert.strictEqual(fn.getType([]), "array");
      assert.strictEqual(fn.getType(123), "number");

      // wouldLosePrecision with non-safe roundtrip
      assert.strictEqual(fn.wouldLosePrecision("00123"), true);
    });

    it("kafka.js: init catches connection error when producer.connect fails", async function () {
      const kPath = require.resolve("kafkajs");
      require.cache[kPath] = {
        id: kPath,
        filename: kPath,
        loaded: true,
        exports: {
          Kafka: class {
            constructor() {}
            producer() {
              return {
                connect: async () => {
                  throw new Error("Connection refused");
                },
                disconnect: async () => {},
              };
            }
          },
        },
      };

      const res = await kafka.init({ broker: "invalid:9092" });
      assert.strictEqual(res, false);
      assert.strictEqual(kafka.status(), false);
      delete require.cache[kPath];
    });

    it("migration-runner.js: handles non-existent dir, missing name, and status check", async function () {
      const files = migrationRunner.getMigrationFiles("non_existent_dir_" + Date.now());
      assert.deepStrictEqual(files, []);

      assert.throws(() => {
        migrationRunner.createMigrationFile("");
      }, /Migration name is required/);

      assert.throws(() => {
        migrationRunner.createMigrationFile(null);
      }, /Migration name is required/);

      const status = await migrationRunner.status(sqliteDb, "non_existent_dir_" + Date.now(), "sqlite");
      assert.deepStrictEqual(status, []);
    });

    it("validator.js: dataToFilter handles primitive numbers, strings, and throws on invalid types", function () {
      assert.deepStrictEqual(validator.dataToFilter(42, "id"), [[["id", "=", 42]]]);
      assert.deepStrictEqual(validator.dataToFilter("foo", "id"), [[["id", "=", "foo"]]]);

      assert.throws(() => {
        validator.dataToFilter(true, "id");
      }, /Invalid filter Inputs/);

      assert.throws(() => {
        validator.dataToFilter([true, false], "id");
      }, /Invalid filter Inputs/);
    });

    it("model.js: find and findOne support sort parameters and beforeFind hook modification", async function () {
      await testModel.insert({ title: "Sort Test B", count: 20 });
      await testModel.insert({ title: "Sort Test A", count: 10 });

      const foundList = await testModel.find({ sort: "-title" });
      assert.ok(foundList.count >= 2);

      const hookedFindModel = model(
        sqliteDb,
        "deep_cov_items",
        { id: "integer", title: "required|string", is_deleted: "integer" },
        "id",
        ["id"],
        {
          hooks: {
            beforeFind: async (_f) => {
              // Modify filter
              return [[["title", "=", "Sort Test A"]]];
            },
          },
        },
      );

      const one = await hookedFindModel.findOne({ title: "Sort Test B" });
      assert.strictEqual(one.title, "Sort Test A");
    });

    it("route.js: POST / and PUT / validate data array and handle errors", async function () {
      const postBad = await request(app).post("/api/items/").send({});
      assert.strictEqual(postBad.status, 400);
      assert.strictEqual(postBad.body.message, "Request body must contain a 'data' array");

      const putBad = await request(app).put("/api/items/").send({});
      assert.strictEqual(putBad.status, 400);
      assert.strictEqual(putBad.body.message, "Request body must contain a 'data' array");
    });

    it("route.js: covers errorResponse catch handlers across PUT, PATCH, DELETE, POST", async function () {
      const failModel = {
        pk: "id",
        findOne: async () => { throw new Error("DB findOne fail"); },
        update: async () => { throw new Error("DB update fail"); },
        patch: async () => { throw new Error("DB patch fail"); },
        remove: async () => { throw new Error("DB remove fail"); },
        insert: async () => { throw new Error("DB insert fail"); },
        list: async () => { throw new Error("DB list fail"); },
        byId: async () => { throw new Error("DB byId fail"); },
      };

      const errorApp = express();
      errorApp.use(express.json());
      errorApp.use("/fail", route(failModel, {}, { express }));

      const resPut = await request(errorApp).put("/fail/1").send({ title: "X" });
      assert.strictEqual(resPut.status, 500);

      const resPatch = await request(errorApp).patch("/fail/1").send({ title: "X" });
      assert.strictEqual(resPatch.status, 500);

      const resDel = await request(errorApp).delete("/fail/1").send();
      assert.strictEqual(resDel.status, 500);

      const resBulkPost = await request(errorApp).post("/fail/").send({ data: [{ title: "X" }] });
      assert.strictEqual(resBulkPost.status, 500);

      const resBulkPut = await request(errorApp).put("/fail/").send({ data: [{ id: 1, title: "X" }] });
      assert.strictEqual(resBulkPut.status, 500);

      const resBulkDel = await request(errorApp).delete("/fail/").send({ title: "X" });
      assert.strictEqual(resBulkDel.status, 500);
    });

    it("migration-runner.js: ensureMigrationTable and getAppliedMigrations handle all dialetcs and missing tables", async function () {
      const sqlQueries = [];
      const mockDb = {
        query: async (sql) => {
          sqlQueries.push(sql);
          return [];
        },
      };

      await migrationRunner.ensureMigrationTable(mockDb, "mysql");
      await migrationRunner.ensureMigrationTable(mockDb, "mariadb");
      await migrationRunner.ensureMigrationTable(mockDb, "mssql");
      await migrationRunner.ensureMigrationTable(mockDb, "oracle");
      assert.strictEqual(sqlQueries.length, 4);

      // Error handling in getAppliedMigrations
      const tableMissingDb = {
        query: async () => {
          throw new Error("relation migrations does not exist");
        },
      };
      const res = await migrationRunner.getAppliedMigrations(tableMissingDb);
      assert.deepStrictEqual(res, []);

      const connErrDb = {
        query: async () => {
          throw new Error("Connection timeout");
        },
      };
      await assert.rejects(async () => {
        await migrationRunner.getAppliedMigrations(connErrDb);
      }, /Connection timeout/);
    });

    it("model.js: byId with options and afterFind hook, find with afterFind hook", async function () {
      let afterFindRan = 0;
      const hookedModel = model(
        sqliteDb,
        "deep_cov_items",
        { id: "integer", title: "required|string", is_deleted: "integer" },
        "id",
        ["id"],
        {
          hooks: {
            afterFind: async (rows) => {
              afterFindRan++;
              return rows;
            },
          },
        },
      );

      const inserted = await hookedModel.insert({ title: "Hook Item" });
      const foundById = await hookedModel.byId(inserted.id, { extraOption: true }, { user: "test" });
      assert.ok(foundById);
      assert.strictEqual(afterFindRan, 1);

      const foundFind = await hookedModel.find({ title: "Hook Item" });
      assert.ok(foundFind.count >= 1);
      assert.strictEqual(afterFindRan, 2);
    });

    it("sqlite3/db.js: escapeId handles numbers and pre-quoted strings, arrayParam generates placeholders", function () {
      const numEscaped = sqliteDb.escapeId(12345);
      assert.strictEqual(numEscaped, '"12345"');

      const preQuoted = sqliteDb.escapeId('"users"');
      assert.strictEqual(preQuoted, '"users"');

      const multiQuoted = sqliteDb.escapeId('"public"."users"');
      assert.strictEqual(multiQuoted, '"public"."users"');
    });

    it("function.js: isSmallFloat and precision loss regex stringification", function () {
      assert.strictEqual(fn.isSmallFloat(Infinity), false);
      assert.strictEqual(fn.isSmallFloat(NaN), false);
      assert.strictEqual(fn.isSmallFloat(100), true);
      assert.strictEqual(fn.isSmallFloat(10.5), true);

      const parsedBig = fn.jsonSafeParse('{"val": 9007199254740993}');
      assert.strictEqual(typeof parsedBig.val, "string");
      assert.strictEqual(parsedBig.val, "9007199254740993");
    });

    it("model.js: byId select_columns and invalid types, findOne sort", async function () {
      const item = await testModel.insert({ title: "Selection Test", count: 99 });
      const selected = await testModel.byId(item.id, { select_columns: ["title"] });
      assert.strictEqual(selected.title, "Selection Test");
      assert.strictEqual(selected.count, undefined);

      await assert.rejects(async () => {
        await testModel.byId(true);
      }, /Invalid id value/);

      const sortedOne = await testModel.findOne({ sort: "-id" });
      assert.ok(sortedOne);
    });

    it("route.js: handles errors when find/list/update throw in handlers", async function () {
      const throwingOpsModel = {
        pk: "id",
        findOne: async () => ({ id: 1, title: "Item" }),
        find: async () => { throw new Error("find crash"); },
        list: async () => { throw new Error("list crash"); },
        insert: async () => { throw new Error("insert crash"); },
        update: async () => { throw new Error("update crash"); },
        patch: async () => { throw new Error("patch crash"); },
        remove: async () => { throw new Error("remove crash"); },
      };

      const throwApp = express();
      throwApp.use(express.json());
      throwApp.use("/throw", route(throwingOpsModel, {}, { express }));

      const resGetId = await request(throwApp).get("/throw/1");
      assert.strictEqual(resGetId.status, 500);

      const resGetList = await request(throwApp).get("/throw/");
      assert.strictEqual(resGetList.status, 500);

      const resPost = await request(throwApp).post("/throw/add").send({ title: "X" });
      assert.strictEqual(resPost.status, 500);

      const resPut = await request(throwApp).put("/throw/1").send({ title: "X" });
      assert.strictEqual(resPut.status, 500);

      const resPatch = await request(throwApp).patch("/throw/1").send({ title: "X" });
      assert.strictEqual(resPatch.status, 500);

      const resDel = await request(throwApp).delete("/throw/1").send();
      assert.strictEqual(resDel.status, 500);
    });

    it("sqlite3/db.js: insert handles uniqueKeys missing in row", function () {
      const res = sqliteDb.insert("deep_cov_items", { title: "Unique Col Missing" }, ["absent_col"]);
      assert.strictEqual(res.rows, 1);
    });

    it("sqlite3/db.js: tx.adapter methods execute in transaction", async function () {
      await sqliteDb.transaction(async (tx) => {
        const txa = tx.adapter;
        await txa.insert("deep_cov_items", { title: "TxA Item" });
        const g = await txa.get("deep_cov_items", [[["title", "=", "TxA Item"]]]);
        assert.ok(g.count >= 1);
        const l = await txa.list("deep_cov_items", []);
        assert.ok(l.count >= 1);
        const c = await txa.qcount("deep_cov_items", []);
        assert.ok(c >= 1);
        await txa.upsert("deep_cov_items", { title: "TxA Item", count: 5 }, ["id"]);
        await txa.remove("deep_cov_items", [[["title", "=", "TxA Item"]]]);
      });
    });

    it("model.js: upsert handles bulk data array and single record with id", async function () {
      const bulkRes = await testModel.upsert({
        data: [{ title: "Bulk Upsert 1" }, { title: "Bulk Upsert 2" }],
      });
      assert.strictEqual(bulkRes.rows, 2);

      const item = await testModel.insert({ title: "To Upsert" });
      const singleRes = await testModel.upsert({ id: item.id, title: "Upserted Title" });
      assert.strictEqual(singleRes.title, "Upserted Title");

      const updated = await testModel.update({ id: item.id, title: "Direct Update" });
      assert.strictEqual(updated.title, "Direct Update");
    });

    it("route.js: resolveExpress handles framework option and non-QUERY router.all dispatch", async function () {
      const ueRouter = route(testModel, {}, { framework: "ultimate-express" });
      assert.ok(ueRouter);

      // Test non-QUERY hit on router.all
      const resOptions = await request(app).options("/api/items/");
      assert.ok(resOptions.status < 500);

      const uExpress = require("ultimate-express");
      const ueApp = uExpress();
      ueApp.use("/api/ue", ueRouter);
      const resUe = await request(ueApp).get("/api/ue/");
      assert.ok(resUe.status < 500);

      // Real HTTP QUERY request without body parser to exercise incoming stream fallback
      const http = require("http");
      const rawApp = express();
      rawApp.use("/raw", route(testModel, {}, { express }));
      const server = http.createServer(rawApp).listen(0);
      try {
        const port = server.address().port;
        await new Promise((resolve, reject) => {
          const req = http.request(
            {
              host: "127.0.0.1",
              port,
              path: "/raw/",
              method: "QUERY",
              headers: { "Content-Type": "application/json" },
            },
            (res) => {
              assert.strictEqual(res.statusCode, 200);
              resolve();
            },
          );
          req.on("error", reject);
          req.write(JSON.stringify({ title: "Streamed Title" }));
          req.end();
        });
      } finally {
        server.close();
      }
    });

    it("model.js: supports singleton signature model('table', ...) and bulk hook mapping", async function () {
      const restIndex = require("../../src/index.js");
      restIndex.init("sqlite3", { database: ":memory:" });
      restIndex.db.query(`CREATE TABLE IF NOT EXISTS deep_cov_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT,
        count INTEGER,
        payload TEXT,
        is_deleted INTEGER DEFAULT 0
      )`);

      const singletonModel = model(
        "deep_cov_items",
        { id: "integer", title: "required|string", is_deleted: "integer" },
        "id",
        ["id"],
        {
          hooks: {
            beforeCreate: async (item) => {
              item.status = "hooked-created";
              return item;
            },
          },
        },
      );
      assert.ok(singletonModel.insert);

      // Bulk insert running through hook item mapping
      const bulkHookRes = await singletonModel.insert({
        data: [{ title: "Bulk Hook 1" }, { title: "Bulk Hook 2" }],
      });
      assert.strictEqual(bulkHookRes.rows, 2);

      // Also exercise restIndex.transaction
      await restIndex.transaction(async (tx) => {
        assert.ok(tx);
      });

      // Cover update and upsert branch when db.upsert returns result without id
      const noIdDb = {
        ...sqliteDb,
        upsert: async () => ({ rows: 1 }),
      };
      const mNoId = model(noIdDb, "deep_cov_items", { id: "integer", title: "string", is_deleted: "integer" }, "id", ["id"]);
      const item = await testModel.insert({ title: "No Id Base" });
      const updatedNoId = await mNoId.update({ id: item.id, title: "No Id Updated" });
      assert.ok(updatedNoId);
      assert.strictEqual(updatedNoId.title, "No Id Base");

      const upsertedNoId = await mNoId.upsert({ id: item.id, title: "No Id Upserted" });
      assert.ok(upsertedNoId);
    });

    it("sqlite3/db.js: multi-statement quote parser, invalid where in get/list/qcount/remove", function () {
      // Multiple statements parser coverage
      sqliteDb.query("SELECT 'O''Reilly' AS author;");
      sqliteDb.query('CREATE TABLE IF NOT EXISTS "t""q" ("col""q" TEXT);');
      sqliteDb.query("SELECT /* block comment */ 1;");
      sqliteDb.query("SELECT 1; -- line comment\n");

      // Invalid where conditions
      assert.throws(() => {
        sqliteDb.get("deep_cov_items", [[["title", "INVALID_OP", 1]]]);
      }, /Invalid filter object/);

      assert.throws(() => {
        sqliteDb.list("deep_cov_items", [[["title", "INVALID_OP", 1]]]);
      }, /Invalid filter object/);

      const countZero = sqliteDb.qcount("deep_cov_items", [[["title", "INVALID_OP", 1]]]);
      assert.strictEqual(countZero, 0);

      assert.throws(() => {
        sqliteDb.remove("deep_cov_items", [[["title", "INVALID_OP", 1]]]);
      }, /Invalid filter object/);

      assert.throws(() => {
        sqliteDb.remove("deep_cov_items", []);
      }, /unable to remove as there are no filter attributes/);

      // resolveSortIdentifiers and arrayParam coverage
      const sortedSql = sqliteDb.resolveSortIdentifiers({ query: "ORDER BY ?? ASC", value: ["title"] });
      assert.strictEqual(sortedSql, 'ORDER BY "title" ASC');
      assert.strictEqual(sqliteDb.resolveSortIdentifiers({ query: "" }), "");

      const placeholders = sqliteDb.arrayParam(3);
      assert.strictEqual(placeholders, "?,?,?");

      // Duplicate identical row upsert (result.changes === 0)
      const ins = sqliteDb.insert("deep_cov_items", { title: "Identical Row" });
      const rowId = ins.id;
      sqliteDb.upsert("deep_cov_items", { id: rowId, title: "Identical Row" }, ["id"]);
      const upsertDup = sqliteDb.upsert("deep_cov_items", { id: rowId, title: "Identical Row" }, ["id"]);
      assert.ok(upsertDup);

      // Upsert with uniqueKeys missing from row
      const upsertNoKey = sqliteDb.upsert("deep_cov_items", { title: "No Unique In Row" }, ["id"]);
      assert.ok(upsertNoKey);

      // Insert and upsert with empty uniqueKeys array (runs standard INSERT path)
      const insNoKey = sqliteDb.insert("deep_cov_items", { title: "Standard Insert" }, []);
      assert.strictEqual(insNoKey.rows, 1);
      assert.ok(insNoKey.id > 0);

      const insBulkNoKey = sqliteDb.insert("deep_cov_items", [{ title: "Bulk Standard 1" }, { title: "Bulk Standard 2" }], []);
      assert.strictEqual(insBulkNoKey.rows, 2);

      const upsertEmptyKeys = sqliteDb.upsert("deep_cov_items", [{ title: "Upsert Empty Keys" }], []);
      assert.strictEqual(upsertEmptyKeys.rows, 1);

      // where() invalid JSON string handling and non-array in/not in
      const whereBadJson = sqliteDb.where("{bad json string");
      assert.strictEqual(whereBadJson, null);

      const whereInNotArr = sqliteDb.where([[["title", "in", "not-an-array"]]]);
      assert.strictEqual(whereInNotArr, null);

      const whereNotInNotArr = sqliteDb.where([[["title", "not in", "not-an-array"]]]);
      assert.strictEqual(whereNotInNotArr, null);

      // upsert DO NOTHING branch and duplicate conflict resolution
      sqliteDb.query("CREATE TABLE IF NOT EXISTS do_nothing_tbl (id INTEGER PRIMARY KEY, code TEXT UNIQUE, extra TEXT);");
      const i1 = sqliteDb.insert("do_nothing_tbl", { code: "C1" }, ["code"]);
      const u1 = sqliteDb.upsert("do_nothing_tbl", [{ code: "C1" }], ["code"]);
      assert.strictEqual(u1.id, i1.id);

      // Trigger causing changes === 0 in upsert (record not found in existing check)
      sqliteDb.query("CREATE TRIGGER IF NOT EXISTS ignore_trig BEFORE INSERT ON do_nothing_tbl WHEN NEW.code = 'BLOCK' BEGIN SELECT RAISE(IGNORE); END;");
      const uBlocked = sqliteDb.upsert("do_nothing_tbl", [{ code: "BLOCK" }], ["code"]);
      assert.strictEqual(uBlocked.id, 0);

      // Trigger causing changes === 0 in upsert with uniqueKey not in row
      sqliteDb.query("CREATE TRIGGER IF NOT EXISTS ignore_extra BEFORE INSERT ON do_nothing_tbl WHEN NEW.extra = 'BLOCK_EXTRA' BEGIN SELECT RAISE(IGNORE); END;");
      const uMissingKey = sqliteDb.upsert("do_nothing_tbl", [{ extra: "BLOCK_EXTRA" }], ["code"]);
      assert.strictEqual(uMissingKey.id, 0);

      // insert() conflict handling branches:
      // 1) presentKeys missing from row
      const insMissingKey = sqliteDb.insert(
        "do_nothing_tbl",
        [{ extra: "BLOCK_EXTRA" }],
        ["code"],
      );
      assert.strictEqual(insMissingKey.id, 0);

      // 2) Unique conflict on another column, presentKey has no existing row
      sqliteDb.query("CREATE TABLE IF NOT EXISTS unique_cov (id INTEGER PRIMARY KEY, email TEXT UNIQUE, code TEXT UNIQUE);");
      sqliteDb.insert("unique_cov", { email: "u1@test.com", code: "C1" }, ["email"]);
      const insNotFound = sqliteDb.insert("unique_cov", { email: "u2@test.com", code: "C1" }, ["email"]);
      assert.strictEqual(insNotFound.id, 0);

      // 3) changes === 0 and empty uniqueKeys (trigger prevents insert)
      sqliteDb.query("CREATE TRIGGER IF NOT EXISTS ignore_trig_cov BEFORE INSERT ON unique_cov WHEN NEW.code = 'BLOCKED' BEGIN SELECT RAISE(IGNORE); END;");
      const insBlockedEmptyKeys = sqliteDb.insert("unique_cov", { email: "blocked@test.com", code: "BLOCKED" }, []);
      assert.strictEqual(insBlockedEmptyKeys.id, 0);
    });
  });
});
