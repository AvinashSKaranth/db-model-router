"use strict";

process.env.NODE_ENV = "TEST";
process.env.TEST_ENC_KEY = "model-test-encryption-key";

const assert = require("assert");
const db = require("../src/sqlite3/db.js");
const model = require("../src/commons/model.js");
const encryption = require("../src/commons/encryption");

const tableName =
  "enc_" +
  new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

const modelStructure = {
  id: "integer",
  name: "required|string",
  ssn: "encrypted|required|string",
  age: "encrypted|required|integer",
  is_vip: "encrypted|required|boolean",
  balance: "encrypted|numeric",
  profile: "object",
  "profile.dob": "encrypted|required|datetime",
  "profile.notes": "string",
  plain_field: "string",
};
const primaryKey = "id";

describe("encryption model integration (sqlite3)", function () {
  let testModel;

  before(function () {
    encryption.setConfig({ key: "env:TEST_ENC_KEY", version: 1 });
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${tableName}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "ssn" TEXT NOT NULL,
        "age" TEXT,
        "is_vip" TEXT,
        "balance" TEXT,
        "profile" TEXT,
        "plain_field" TEXT
      )`,
    );
    testModel = model(db, tableName, modelStructure, primaryKey, [primaryKey]);
  });

  after(function () {
    db.query(`DROP TABLE IF EXISTS "${tableName}"`);
    encryption.setConfig(null);
    db.disconnect();
  });

  it("throws at factory time when encrypted fields lack a config", function () {
    encryption.setConfig(null);
    assert.throws(
      () =>
        model(db, tableName, modelStructure, primaryKey, [primaryKey]),
      /declares encrypted fields but no encryption config/,
    );
    encryption.setConfig({ key: "env:TEST_ENC_KEY", version: 1 });
  });

  it("inserts a record with encrypted values and returns decrypted plaintext", async function () {
    const record = await testModel.insert({
      name: "Alice",
      ssn: "123-45-6789",
      age: 30,
      is_vip: true,
      balance: 99.5,
      profile: { dob: "1990-01-01 00:00:00", notes: "hello" },
      plain_field: "not-secret",
    });
    assert.strictEqual(record.ssn, "123-45-6789");
    assert.strictEqual(record.age, 30);
    assert.strictEqual(record.is_vip, true);
    assert.strictEqual(record.balance, 99.5);
    assert.strictEqual(record.profile.dob, "1990-01-01 00:00:00");
    assert.strictEqual(record.profile.notes, "hello");
    assert.strictEqual(record.plain_field, "not-secret");
  });

  it("stores ciphertext (enc:v1:) in the database", async function () {
    const rows = db.query(`SELECT * FROM "${tableName}"`);
    const row = rows[0];
    assert.ok(String(row.ssn).startsWith("enc:v1:"), `ssn was: ${row.ssn}`);
    assert.ok(String(row.profile).includes("enc:v1:"), "profile dob should be encrypted");
    assert.strictEqual(row.plain_field, "not-secret");
  });

  it("byId returns decrypted plaintext with correct types", async function () {
    const row = await db.query(`SELECT id FROM "${tableName}"`)[0];
    const record = await testModel.byId(row.id);
    assert.strictEqual(record.ssn, "123-45-6789");
    assert.strictEqual(typeof record.age, "number");
    assert.strictEqual(typeof record.is_vip, "boolean");
    assert.strictEqual(record.profile.dob, "1990-01-01 00:00:00");
  });

  it("find returns decrypted rows", async function () {
    const result = await testModel.find({});
    assert.ok(result.data.length >= 1);
    for (const row of result.data) {
      assert.strictEqual(row.ssn, "123-45-6789");
      assert.strictEqual(typeof row.age, "number");
      assert.strictEqual(row.profile.dob, "1990-01-01 00:00:00");
    }
  });

  it("findOne returns a decrypted record", async function () {
    const row = await db.query(`SELECT id FROM "${tableName}"`)[0];
    const record = await testModel.findOne({ id: row.id });
    assert.strictEqual(record.ssn, "123-45-6789");
  });

  it("list returns decrypted rows", async function () {
    const result = await testModel.list({});
    assert.ok(result.data.length >= 1);
    for (const row of result.data) {
      assert.strictEqual(row.ssn, "123-45-6789");
    }
  });

  it("update re-encrypts changed encrypted fields and returns plaintext", async function () {
    const row = await db.query(`SELECT id FROM "${tableName}"`)[0];
    const updated = await testModel.update({
      id: row.id,
      ssn: "987-65-4321",
      name: "Bob",
      age: 30,
      is_vip: true,
      profile: { dob: "1990-01-01 00:00:00" },
    });
    assert.strictEqual(updated.ssn, "987-65-4321");
    const reFetched = await testModel.byId(row.id);
    assert.strictEqual(reFetched.ssn, "987-65-4321");
    // Age should remain encrypted + decrypted correctly
    assert.strictEqual(reFetched.age, 30);
  });

  it("patch merges and re-encrypts", async function () {
    const row = await db.query(`SELECT id FROM "${tableName}"`)[0];
    const patched = await testModel.patch({
      id: row.id,
      is_vip: false,
      balance: 42,
    });
    assert.strictEqual(patched.is_vip, false);
    const reFetched = await testModel.byId(row.id);
    assert.strictEqual(reFetched.is_vip, false);
    assert.strictEqual(reFetched.balance, 42);
  });

  it("upsert inserts a new row when pk is absent", async function () {
    const record = await testModel.upsert({
      name: "Carol",
      ssn: "111-22-3333",
      age: 25,
      is_vip: false,
      profile: { dob: "1995-05-05 00:00:00" },
    });
    assert.strictEqual(record.ssn, "111-22-3333");
    const byId = await testModel.byId(record.id);
    assert.strictEqual(byId.ssn, "111-22-3333");
  });

  it("keeps legacy plaintext values untouched on read", async function () {
    const insertResult = await db.query(
      `INSERT INTO "${tableName}" (name, ssn, age, is_vip, profile) VALUES ('Legacy', 'LEGACY-SSN', '25', 'false', '{}')`,
    );
    const id = Number(insertResult.lastInsertRowid);
    const record = await testModel.byId(id);
    assert.strictEqual(record.ssn, "LEGACY-SSN");
  });

  it("never double-encrypts an already-encrypted envelope on update", async function () {
    const created = await testModel.insert({
      name: "Dana",
      ssn: "555-44-3333",
      age: 40,
      is_vip: true,
      profile: { dob: "1980-08-08 00:00:00" },
    });
    const row = await db.query(`SELECT id, ssn FROM "${tableName}" WHERE id = ?`, [created.id]);
    const raw = row[0].ssn;
    assert.ok(String(raw).startsWith("enc:v1:"), "seed must be encrypted");
    await testModel.update({
      id: created.id,
      ssn: raw,
      name: "Dana",
      age: 40,
      is_vip: true,
      profile: { dob: "1980-08-08 00:00:00" },
    });
    const after = await db.query(`SELECT ssn FROM "${tableName}" WHERE id = ?`, [created.id]);
    assert.strictEqual(after[0].ssn, raw);
  });

  describe("bulk Kafka events carry plaintext", function () {
    function stubProduce() {
      const kafka = require("../src/commons/kafka");
      const captured = [];
      const originalProduce = kafka.produce;
      kafka.produce = async (table, op, data) => captured.push({ table, op, data });
      // Re-load model.js so its destructured `produce` picks up the stub.
      delete require.cache[require.resolve("../src/commons/model.js")];
      const freshModel = require("../src/commons/model.js");
      return { kafka, captured, originalProduce, freshModel };
    }

    function restoreProduce(kafka, originalProduce) {
      kafka.produce = originalProduce;
    }

    it("bulk insert emits decrypted plaintext events", async function () {
      const { kafka, captured, originalProduce, freshModel } = stubProduce();
      try {
        const bulkModel = freshModel(db, tableName, modelStructure, primaryKey, [primaryKey]);
        await bulkModel.insert({
          data: [
            { name: "Eve", ssn: "555-00-1111", age: 35, is_vip: true, balance: 10.5, profile: { dob: "1985-05-05 00:00:00" }, plain_field: "x" },
            { name: "Frank", ssn: "555-00-2222", age: 41, is_vip: false, balance: 20.5, profile: { dob: "1979-11-11 00:00:00" }, plain_field: "y" },
          ],
        });
      } finally {
        restoreProduce(kafka, originalProduce);
      }
      const event = captured.find((e) => e.op === "insert");
      assert.ok(event, "should emit a bulk insert event");
      assert.strictEqual(event.table, tableName);
      assert.strictEqual(event.data.length, 2);
      for (const row of event.data) {
        assert.ok(!String(row.ssn).startsWith("enc:"), `ssn should be plaintext, got ${row.ssn}`);
        assert.strictEqual(typeof row.age, "number", "age should be restored to a number");
        assert.strictEqual(typeof row.is_vip, "boolean", "is_vip should be restored to a boolean");
        assert.ok(!String(row.profile.dob).startsWith("enc:"), "profile.dob should be plaintext");
      }
      assert.strictEqual(event.data[0].ssn, "555-00-1111");
      assert.strictEqual(event.data[0].profile.dob, "1985-05-05 00:00:00");
    });

    it("bulk update emits decrypted plaintext events", async function () {
      const { kafka, captured, originalProduce, freshModel } = stubProduce();
      try {
        const bulkModel = freshModel(db, tableName, modelStructure, primaryKey, [primaryKey]);
        const existing = await db.query(`SELECT id FROM "${tableName}" ORDER BY id DESC LIMIT 1`);
        const id = Number(existing[0].id);
        await bulkModel.update({
          data: [
            { id, ssn: "777-00-9999", name: "Eve", age: 36, is_vip: false, profile: { dob: "1985-05-05 00:00:00" } },
          ],
        });
      } finally {
        restoreProduce(kafka, originalProduce);
      }
      const event = captured.find((e) => e.op === "update");
      assert.ok(event, "should emit a bulk update event");
      assert.ok(event.data.length >= 1, "event should carry the updated row");
      const row = event.data[0];
      assert.ok(!String(row.ssn).startsWith("enc:"), `ssn should be plaintext, got ${row.ssn}`);
      assert.strictEqual(row.ssn, "777-00-9999");
      assert.ok(!String(row.profile.dob).startsWith("enc:"), "profile.dob should be plaintext");
    });
  });

  describe("sub-typed encrypted columns (encrypted|string:longtext)", function () {
    const subTable =
      "enc_sub_" +
      new Date()
        .toISOString()
        .replace(/[-T:.Z]/g, "")
        .slice(0, 14);
    const subStructure = {
      id: "integer",
      raw_response: "encrypted|string:longtext",
      is_active: "encrypted|boolean",
    };
    let subModel;

    before(function () {
      db.query(
        `CREATE TABLE "${subTable}" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "raw_response" TEXT, "is_active" TEXT)`,
      );
      subModel = model(db, subTable, subStructure, "id", ["id"]);
    });

    after(function () {
      db.query(`DROP TABLE IF EXISTS "${subTable}"`);
    });

    it("encrypts sub-typed columns on write and returns plaintext on read", async function () {
      const record = await subModel.insert({
        raw_response: "secret payload",
        is_active: 1,
      });
      assert.strictEqual(record.raw_response, "secret payload");
      assert.strictEqual(record.is_active, true, "boolean 1 should round-trip as true");
      const stored = await db.query(`SELECT raw_response, is_active FROM "${subTable}"`);
      assert.ok(
        String(stored[0].raw_response).startsWith("enc:v1:"),
        "raw_response should be ciphertext, got plaintext",
      );
      assert.ok(
        String(stored[0].is_active).startsWith("enc:v1:"),
        "is_active should be ciphertext, got plaintext",
      );
    });
  });
});