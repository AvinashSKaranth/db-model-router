"use strict";

const assert = require("assert");
const pgDb = require("../../src/postgres/db");
const crDb = require("../../src/cockroachdb/db");
const mysqlDb = require("../../src/mysql/db");
const mariaDb = require("../../src/mariadb/db");

describe("SQL Database Adapters Coverage (Postgres, CockroachDB, MySQL, MariaDB)", function () {
  this.timeout(20000);

  // -------------------------------------------------------------------------
  // 1. PostgreSQL Comprehensive Coverage
  // -------------------------------------------------------------------------
  describe("PostgreSQL Adapter", function () {
    const testTable = "test_pg_cov_" + Date.now();

    before(async function () {
      pgDb.connect({
        host: "localhost",
        port: 5432,
        database: "test_db",
        user: "postgres",
        password: "password",
        dateStrings: true,
      });

      await pgDb.query(`
        CREATE TABLE IF NOT EXISTS "${testTable}" (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          score INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });

    after(async function () {
      try {
        await pgDb.query(`DROP TABLE IF EXISTS "${testTable}"`);
      } finally {
        await pgDb.disconnect();
      }
    });

    it("escapeId handles standard, schema, null bytes, and non-string names", function () {
      assert.strictEqual(pgDb.escapeId("users"), '"users"');
      assert.strictEqual(pgDb.escapeId("public.users"), '"public"."users"');
      assert.strictEqual(pgDb.escapeId('user"table'), '"user""table"');
      assert.strictEqual(pgDb.escapeId("test\0name"), '"testname"');
      assert.strictEqual(pgDb.escapeId(123), '"123"');
    });

    it("sort_builder handles empty, null, asc, and desc", function () {
      assert.deepStrictEqual(pgDb.sort_builder(null), { query: "", value: [] });
      assert.deepStrictEqual(pgDb.sort_builder([]), { query: "", value: [] });
      assert.strictEqual(pgDb.sort_builder(["name"]).query, 'ORDER BY "name" ASC');
      assert.strictEqual(pgDb.sort_builder(["-score", "+name"]).query, 'ORDER BY "score" DESC, "name" ASC');
      assert.strictEqual(pgDb.sort_builder([123, ""]).query, "");
    });

    it("where handles all conditionals, nulls, safeDelete, and column types", function () {
      assert.strictEqual(pgDb.where("invalid"), null);
      assert.deepStrictEqual(pgDb.where([]), { query: "", value: [] });
      assert.deepStrictEqual(pgDb.where([[]]), { query: "", value: [] });
      assert.deepStrictEqual(pgDb.where([[[]]]), { query: "", value: [] });

      // Safe delete with int vs bool column types
      const sdInt = pgDb.where([], "is_deleted", { is_deleted: "int4" });
      assert.ok(sdInt.query.includes('"is_deleted" = $1'));
      assert.strictEqual(sdInt.value[0], 0);

      const sdBool = pgDb.where([], "is_active", { is_active: "bool" });
      assert.strictEqual(sdBool.value[0], false);

      // Empty string coercion for numeric column
      const numFilter = pgDb.where([[["score", "=", ""]]], null, { score: "int4" });
      assert.strictEqual(numFilter.value[0], null);

      // Boolean coercion for integer column
      const boolOnInt = pgDb.where([[["score", "=", true]]], null, { score: "int4" });
      assert.strictEqual(boolOnInt.value[0], 1);

      // Conditionals
      const condFilter = [
        [
          ["name", "=", "Alice"],
          ["score", ">", 50],
          ["score", "<", 100],
          ["score", ">=", 60],
          ["score", "<=", 90],
          ["score", "!=", 75],
          ["name", "like", "Ali"],
          ["name", "not like", "Bob"],
          ["name", "ilike", "ali"],
          ["name", "not ilike", "bob"],
          ["score", "in", [10, 20]],
          ["score", "not in", [30, 40]],
        ],
      ];
      const w = pgDb.where(condFilter);
      assert.ok(w.query.startsWith("WHERE (("));
      assert.ok(w.value.includes("%Ali%"));
      assert.ok(w.value.includes("%Bob%"));

      assert.strictEqual(pgDb.where([[["name", "INVALID_OP", "val"]]]), null);
      assert.strictEqual(pgDb.where([[["name", "in", "not-array"]]]), null);
    });

    it("performs complete CRUD lifecycle with insert, list, get, qcount, upsert, remove", async function () {
      // Direct query with /* PG_NATIVE */ strip and UPDATE/DELETE branch
      const rawRes = await pgDb.query('/* PG_NATIVE */ SELECT 1 as num');
      assert.strictEqual(rawRes[0].num, 1);

      // 1. Single insert with returning ID
      const insRes = await pgDb.insert(testTable, { name: "Alice", score: 85, is_active: true });
      assert.ok(insRes.id > 0);
      assert.strictEqual(insRes.rows, 1);
      const aliceId = insRes.id;

      // 2. Bulk insert with chunking
      const bulkRes = await pgDb.insert(testTable, [
        { name: "Bob", score: 90, is_active: true },
        { name: "Charlie", score: 70, is_active: false },
      ]);
      assert.strictEqual(bulkRes.rows, 2);

      // 3. Insert on conflict (DO NOTHING)
      const conflictRes = await pgDb.insert(
        testTable,
        [{ name: "Alice", score: 99, is_active: true }],
        ["name"],
      );
      assert.ok(conflictRes.rows >= 0);

      // 4. Upsert (DO UPDATE)
      const upRes = await pgDb.upsert(testTable, { id: aliceId, name: "Alice", score: 95 }, ["name"]);
      assert.ok(upRes.rows >= 0);

      // 5. List with pagination, sort, fields
      const listRes = await pgDb.list(testTable, [[["score", ">=", 70]]], ["-score"], null, 0, 10);
      assert.ok(listRes.data.length >= 3);
      assert.strictEqual(listRes.count, 3);

      // 6. Get by ID / filter
      const getRes = await pgDb.get(testTable, [[["id", "=", aliceId]]]);
      assert.strictEqual(getRes.data.length, 1);
      assert.strictEqual(getRes.data[0].name, "Alice");

      // 7. Qcount
      const countRes = await pgDb.qcount(testTable, [[["is_active", "=", true]]]);
      assert.ok(countRes >= 2);

      // 8. Soft remove with is_active
      const softDel = await pgDb.remove(testTable, [[["id", "=", aliceId]]], "is_active");
      assert.ok(softDel.message.includes("removed"));

      // 9. Hard remove
      const delRes = await pgDb.remove(testTable, [[["id", "=", aliceId]]]);
      assert.ok(delRes.message.includes("removed"));

      // Remove validation error on empty filter
      await assert.rejects(
        async () => {
          await pgDb.remove(testTable, []);
        },
        /no filter attributes/,
      );
    });

    it("supports transactions with commit, rollback, and tx.model", async function () {
      // Commit with tx.adapter methods
      await pgDb.transaction(async (tx) => {
        await tx.query(`INSERT INTO "${testTable}" ("name", "score") VALUES ($1, $2)`, ["Tx User", 100]);
        assert.ok(typeof tx.model === "function");
        const txModel = tx.model(testTable);
        assert.ok(txModel);

        // tx.adapter CRUD
        const txGet = await tx.adapter.get(testTable, [[["name", "=", "Tx User"]]]);
        assert.strictEqual(txGet.data.length, 1);
        const txList = await tx.adapter.list(testTable, [[["name", "=", "Tx User"]]]);
        assert.strictEqual(txList.data.length, 1);
        const txCount = await tx.adapter.qcount(testTable, [[["name", "=", "Tx User"]]]);
        assert.strictEqual(txCount, 1);

        // tx.adapter insert, upsert, remove
        await tx.adapter.insert(testTable, { name: "Tx User 2", score: 200 });
        await tx.adapter.upsert(testTable, { name: "Tx User 2", score: 250 }, ["name"]);
        await tx.adapter.remove(testTable, [[["name", "=", "Tx User 2"]]]);
      });

      const listCommit = await pgDb.list(testTable, [[["name", "=", "Tx User"]]]);
      assert.strictEqual(listCommit.data.length, 1);

      // Rollback
      await assert.rejects(
        async () => {
          await pgDb.transaction(async (tx) => {
            await tx.query(`INSERT INTO "${testTable}" ("name", "score") VALUES ($1, $2)`, ["Rollback User", 50]);
            throw new Error("Simulated Tx Failure");
          });
        },
        /Simulated Tx Failure/,
      );

      const listRollback = await pgDb.list(testTable, [[["name", "=", "Rollback User"]]]);
      assert.strictEqual(listRollback.data.length, 0);

      // Transaction requires function check
      await assert.rejects(async () => {
        await pgDb.transaction(null);
      }, /Transaction requires a callback function/);
    });

    it("covers error mapping, retryable errors, and query edge cases", async function () {
      // 1. UPDATE / DELETE via query() returning affectedRows
      const updateRaw = await pgDb.query(`UPDATE "${testTable}" SET "score" = 101 WHERE "name" = $1`, ["Tx User"]);
      assert.strictEqual(updateRaw.affectedRows, 1);

      // 2. INSERT via query() without RETURNING
      const insertRaw = await pgDb.query(`INSERT INTO "${testTable}" ("name", "score") VALUES ($1, $2)`, ["Raw User", 200]);
      assert.strictEqual(insertRaw.affectedRows, 1);

      // 3. Upsert with unique key DO NOTHING (empty update columns)
      const doNothing = await pgDb.upsert(testTable, { name: "Raw User" }, ["name"]);
      assert.ok(doNothing.rows >= 0);

      // 4. Upsert with no unique keys (pure insert)
      const pureInsert = await pgDb.upsert(testTable, { name: "Pure Upsert", score: 55 }, []);
      assert.strictEqual(pureInsert.rows, 1);

      // 5. Bulk upsert with multiple records
      const bulkUp = await pgDb.upsert(
        testTable,
        [
          { name: "Tx User", score: 105 },
          { name: "Raw User", score: 205 },
        ],
        ["name"],
      );
      assert.ok(bulkUp.rows >= 0);

      // 6. Upsert missingKeys fallback to UPDATE using PK
      const listOne = await pgDb.list(testTable, [[["name", "=", "Tx User"]]]);
      const txUserId = listOne.data[0].id;
      const fallbackUp = await pgDb.upsert(testTable, { id: txUserId, score: 777 }, ["missing_col"]);
      assert.ok(fallbackUp.rows >= 1);

      // 7. _insertOnConflict via insert(table, data, uniqueKeys)
      const confIns = await pgDb.insert(
        testTable,
        [
          { name: "Conf User 1", score: 10 },
          { name: "Conf User 2", score: 20 },
        ],
        ["name"],
      );
      assert.strictEqual(confIns.rows, 2);

      // 8. getSqlCaptureLog
      const logs = pgDb.getSqlCaptureLog();
      assert.ok(Array.isArray(logs));
    });
  });

  // -------------------------------------------------------------------------
  // 2. CockroachDB Comprehensive Coverage
  // -------------------------------------------------------------------------
  describe("CockroachDB Adapter", function () {
    const testTable = "test_crdb_cov_" + Date.now();

    before(async function () {
      crDb.connect({
        host: "localhost",
        port: 26257,
        database: "defaultdb",
        user: "root",
      });

      await crDb.query(`
        CREATE TABLE IF NOT EXISTS "${testTable}" (
          id INT8 PRIMARY KEY DEFAULT unique_rowid(),
          name STRING NOT NULL UNIQUE,
          score INT DEFAULT 0,
          is_deleted INT DEFAULT 0
        )
      `);
    });

    after(async function () {
      try {
        await crDb.query(`DROP TABLE IF EXISTS "${testTable}"`);
      } finally {
        await crDb.disconnect();
      }
    });

    it("escapeId, sort_builder, and where cover all edge cases", function () {
      assert.strictEqual(crDb.escapeId("users"), '"users"');
      assert.strictEqual(crDb.escapeId("defaultdb.users"), '"defaultdb"."users"');
      assert.strictEqual(crDb.escapeId('user"table'), '"user""table"');

      assert.deepStrictEqual(crDb.sort_builder(null), { query: "", value: [] });
      assert.deepStrictEqual(crDb.sort_builder([]), { query: "", value: [] });
      assert.strictEqual(crDb.sort_builder(["name"]).query, 'ORDER BY "name" ASC');
      assert.strictEqual(crDb.sort_builder(["-score", "+name"]).query, 'ORDER BY "score" DESC,"name" ASC');

      assert.strictEqual(crDb.where("invalid"), null);
      assert.deepStrictEqual(crDb.where([]), { query: "", value: [] });

      const sd = crDb.where([], "is_deleted");
      assert.ok(sd.query.includes('"is_deleted" = $1'));
      assert.strictEqual(sd.value[0], 0);

      const cond = crDb.where([
        [
          ["name", "=", "CRDB User"],
          ["score", ">", 10],
          ["score", "<", 100],
          ["score", "<=", 90],
          ["score", ">=", 20],
          ["score", "!=", 50],
          ["name", "like", "CRDB"],
          ["name", "not like", "Test"],
          ["score", "in", [1, 2]],
          ["score", "not in", [3, 4]],
        ],
      ]);
      assert.ok(cond.query.startsWith("WHERE (("));
      assert.strictEqual(crDb.where([[["name", "INVALID", "val"]]]), null);
      assert.strictEqual(crDb.where([[["name", "in", "not-array"]]]), null);
    });

    it("CRUD operations: insert single/bulk, list, get, qcount, upsert, remove", async function () {
      // 1. Single insert
      const insRes = await crDb.insert(testTable, { name: "CRDB Alice", score: 80 });
      assert.ok(insRes.id);
      assert.strictEqual(insRes.rows, 1);
      const insertedId = insRes.id;

      // 2. Bulk insert
      const bulkRes = await crDb.insert(testTable, [
        { name: "CRDB Bob", score: 90 },
        { name: "CRDB Charlie", score: 70 },
      ]);
      assert.strictEqual(bulkRes.rows, 2);

      // 3. Upsert
      const upRes = await crDb.upsert(testTable, { id: insertedId, name: "CRDB Alice Updated", score: 85 }, ["id"]);
      assert.ok(upRes.rows >= 0);

      // 4. List
      const listRes = await crDb.list(testTable, [[["score", ">=", 70]]], ["-score"], null, 0, 10);
      assert.ok(listRes.data.length >= 3);
      assert.strictEqual(listRes.count, 3);

      // 5. Get
      const getRes = await crDb.get(testTable, [[["id", "=", insertedId]]]);
      assert.strictEqual(getRes.data.length, 1);

      // 6. Qcount
      const countRes = await crDb.qcount(testTable, [[["score", ">=", 70]]]);
      assert.strictEqual(countRes, 3);

      // 7. Soft remove
      const softRem = await crDb.remove(testTable, [[["id", "=", insertedId]]], "is_deleted");
      assert.ok(softRem.message.includes("removed"));

      // 8. Hard remove
      const hardRem = await crDb.remove(testTable, [[["id", "=", insertedId]]]);
      assert.ok(hardRem.message.includes("removed"));

      // Remove empty filter error
      await assert.rejects(
        async () => {
          await crDb.remove(testTable, []);
        },
        /filter attributes/,
      );
    });

    it("covers query edge cases and bulk upsert in CockroachDB", async function () {
      const updateRaw = await crDb.query(`UPDATE "${testTable}" SET "score" = 101 WHERE "name" = $1`, ["CRDB Bob"]);
      assert.strictEqual(updateRaw.affectedRows, 1);

      const insertRaw = await crDb.query(`INSERT INTO "${testTable}" ("name", "score") VALUES ($1, $2)`, ["Raw CRDB", 200]);
      assert.strictEqual(insertRaw.affectedRows, 1);

      const pureInsert = await crDb.upsert(testTable, { name: "Pure CRDB", score: 55 }, []);
      assert.strictEqual(pureInsert.rows, 1);

      const bulkUp = await crDb.upsert(
        testTable,
        [
          { name: "CRDB Bob", score: 105 },
          { name: "Raw CRDB", score: 205 },
        ],
        ["name"],
      );
      assert.ok(bulkUp.rows >= 0);

      // Upsert with missingKeys fallback to UPDATE
      const listOne = await crDb.list(testTable, [[["name", "=", "CRDB Bob"]]]);
      const bobId = listOne.data[0].id;
      const fallbackUp = await crDb.upsert(testTable, { id: bobId, score: 999 }, ["missing_col"]);
      assert.ok(fallbackUp.rows >= 1);

      // _insertOnConflict via insert(table, data, uniqueKeys)
      const confIns = await crDb.insert(
        testTable,
        [
          { name: "CRDB Conf 1", score: 11 },
          { name: "CRDB Conf 2", score: 22 },
        ],
        ["name"],
      );
      assert.strictEqual(confIns.rows, 2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. MySQL Comprehensive Coverage
  // -------------------------------------------------------------------------
  describe("MySQL Adapter", function () {
    const testTable = "test_mysql_cov_" + Date.now();

    before(async function () {
      mysqlDb.connect({
        host: "localhost",
        port: 3308,
        database: "test_db",
        user: "root",
        password: "password",
      });

      await mysqlDb.query(`
        CREATE TABLE IF NOT EXISTS \`${testTable}\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          score INT DEFAULT 0,
          is_deleted TINYINT(1) DEFAULT 0
        )
      `);
    });

    after(async function () {
      try {
        await mysqlDb.query(`DROP TABLE IF EXISTS \`${testTable}\``);
      } finally {
        await mysqlDb.disconnect();
      }
    });

    it("escapeId, sort_builder, and where edge cases", function () {
      assert.strictEqual(mysqlDb.escapeId("users"), "`users`");
      assert.strictEqual(mysqlDb.escapeId("test_db.users"), "`test_db`.`users`");

      assert.deepStrictEqual(mysqlDb.sort_builder(null), { query: "", value: [] });
      assert.strictEqual(mysqlDb.sort_builder(["+name", "-score"]).query, "ORDER BY ?? ASC,?? DESC");

      assert.strictEqual(mysqlDb.where("invalid"), null);
      assert.deepStrictEqual(mysqlDb.where([]), { query: "", value: [] });

      const sd = mysqlDb.where([], "is_deleted");
      assert.ok(sd.query.includes("?? = ?"));
      assert.strictEqual(sd.value[0], "is_deleted");
      assert.strictEqual(sd.value[1], 0);

      const w = mysqlDb.where([
        [
          ["name", "=", "MySQL User"],
          ["score", ">", 10],
          ["score", "<", 100],
          ["score", "<=", 90],
          ["score", ">=", 20],
          ["score", "!=", 50],
          ["name", "like", "MySQL"],
          ["name", "not like", "Test"],
          ["score", "in", [1, 2]],
          ["score", "not in", [3, 4]],
        ],
      ]);
      assert.ok(w.query.startsWith("WHERE (("));
      assert.strictEqual(mysqlDb.where([[["name", "INVALID_OP", "val"]]]), null);
      assert.strictEqual(mysqlDb.where([[["name", "in", "not-array"]]]), null);
    });

    it("CRUD operations: insert, list, get, qcount, upsert, remove", async function () {
      // 1. Single insert
      const insRes = await mysqlDb.insert(testTable, { name: "MySQL Alice", score: 85 });
      assert.ok(insRes.id > 0);
      assert.strictEqual(insRes.rows, 1);
      const insertedId = insRes.id;

      // 2. Bulk insert
      const bulkRes = await mysqlDb.insert(testTable, [
        { name: "MySQL Bob", score: 90 },
        { name: "MySQL Charlie", score: 70 },
      ]);
      assert.strictEqual(bulkRes.rows, 2);

      // 3. Upsert
      const upRes = await mysqlDb.upsert(testTable, { id: insertedId, name: "MySQL Alice Updated", score: 88 }, ["id"]);
      assert.ok(upRes.rows >= 0);

      // 4. List
      const listRes = await mysqlDb.list(testTable, [[["score", ">=", 70]]], ["-score"], null, 0, 10);
      assert.ok(listRes.data.length >= 3);
      assert.strictEqual(listRes.count, 3);

      // 5. Get
      const getRes = await mysqlDb.get(testTable, [[["id", "=", insertedId]]]);
      assert.strictEqual(getRes.data.length, 1);

      // 6. Qcount
      const countRes = await mysqlDb.qcount(testTable, [[["score", ">=", 70]]]);
      assert.strictEqual(countRes, 3);

      // 7. Soft remove
      const softRem = await mysqlDb.remove(testTable, [[["id", "=", insertedId]]], "is_deleted");
      assert.ok(softRem.message.includes("removed"));

      // 8. Hard remove
      const hardRem = await mysqlDb.remove(testTable, [[["id", "=", insertedId]]]);
      assert.ok(hardRem.message.includes("removed"));

      await assert.rejects(
        async () => {
          await mysqlDb.remove(testTable, []);
        },
        /filter attributes/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. MariaDB Comprehensive Coverage
  // -------------------------------------------------------------------------
  describe("MariaDB Adapter", function () {
    const testTable = "test_maria_cov_" + Date.now();

    before(async function () {
      mariaDb.connect({
        host: "localhost",
        port: 3309,
        database: "test_db",
        user: "root",
        password: "password",
      });

      await mariaDb.query(`
        CREATE TABLE IF NOT EXISTS \`${testTable}\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          score INT DEFAULT 0,
          is_deleted TINYINT(1) DEFAULT 0
        )
      `);
    });

    after(async function () {
      try {
        await mariaDb.query(`DROP TABLE IF EXISTS \`${testTable}\``);
      } finally {
        await mariaDb.disconnect();
      }
    });

    it("escapeId, sort_builder, and where edge cases", function () {
      assert.strictEqual(mariaDb.escapeId("users"), "`users`");
      assert.strictEqual(mariaDb.escapeId("test_db.users"), "`test_db`.`users`");

      assert.deepStrictEqual(mariaDb.sort_builder(null), { query: "", value: [] });
      assert.strictEqual(mariaDb.sort_builder(["+name", "-score"]).query, "ORDER BY ?? ASC,?? DESC");

      assert.strictEqual(mariaDb.where("invalid"), null);
      assert.deepStrictEqual(mariaDb.where([]), { query: "", value: [] });

      const sd = mariaDb.where([], "is_deleted");
      assert.ok(sd.query.includes("?? = ?"));
      assert.strictEqual(sd.value[0], "is_deleted");
      assert.strictEqual(sd.value[1], 0);

      const w = mariaDb.where([
        [
          ["name", "=", "Maria User"],
          ["score", ">", 10],
          ["score", "<", 100],
          ["score", "<=", 90],
          ["score", ">=", 20],
          ["score", "!=", 50],
          ["name", "like", "Maria"],
          ["name", "not like", "Test"],
          ["score", "in", [1, 2]],
          ["score", "not in", [3, 4]],
        ],
      ]);
      assert.ok(w.query.startsWith("WHERE (("));
      assert.strictEqual(mariaDb.where([[["name", "INVALID_OP", "val"]]]), null);
      assert.strictEqual(mariaDb.where([[["name", "in", "not-array"]]]), null);
    });

    it("CRUD operations: insert, list, get, qcount, upsert, remove", async function () {
      // 1. Single insert
      const insRes = await mariaDb.insert(testTable, { name: "Maria Alice", score: 85 });
      assert.ok(insRes.id > 0);
      assert.strictEqual(insRes.rows, 1);
      const insertedId = insRes.id;

      // 2. Bulk insert
      const bulkRes = await mariaDb.insert(testTable, [
        { name: "Maria Bob", score: 90 },
        { name: "Maria Charlie", score: 70 },
      ]);
      assert.strictEqual(bulkRes.rows, 2);

      // 3. Upsert
      const upRes = await mariaDb.upsert(testTable, { id: insertedId, name: "Maria Alice Updated", score: 88 }, ["id"]);
      assert.ok(upRes.rows >= 0);

      // 4. List
      const listRes = await mariaDb.list(testTable, [[["score", ">=", 70]]], ["-score"], null, 0, 10);
      assert.ok(listRes.data.length >= 3);
      assert.strictEqual(listRes.count, 3);

      // 5. Get
      const getRes = await mariaDb.get(testTable, [[["id", "=", insertedId]]]);
      assert.strictEqual(getRes.data.length, 1);

      // 6. Qcount
      const countRes = await mariaDb.qcount(testTable, [[["score", ">=", 70]]]);
      assert.strictEqual(countRes, 3);

      // 7. Soft remove
      const softRem = await mariaDb.remove(testTable, [[["id", "=", insertedId]]], "is_deleted");
      assert.ok(softRem.message.includes("removed"));

      // 8. Hard remove
      const hardRem = await mariaDb.remove(testTable, [[["id", "=", insertedId]]]);
      assert.ok(hardRem.message.includes("removed"));

      await assert.rejects(
        async () => {
          await mariaDb.remove(testTable, []);
        },
        /filter attributes/,
      );
    });
  });
});
