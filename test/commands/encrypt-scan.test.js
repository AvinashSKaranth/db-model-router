"use strict";

process.env.TEST_ENC_KEY = "encryption-scan-command-test-key";
process.env.ENC_KEY = "encryption-command-test-master-key";
process.env.NEW_ENC_KEY = "encryption-command-test-rotation-key";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { OutputContext } = require("../../src/cli/flags");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cmd-enc-scan-test-"));
}
function rmTmpDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function buildSchema() {
  return {
    adapter: "sqlite3",
    framework: "express",
    tables: {
      users: {
        columns: {
          id: "auto_increment",
          ssn: "encrypted|required|string",
          email: "required|string",
          profile: "object",
          "profile.dob": "encrypted|required|datetime",
          "profile.city": "string",
        },
        pk: "id",
        unique: ["id"],
        timestamps: { created_at: null, modified_at: null },
      },
    },
    relationships: [],
    options: {
      encryption: { key: "env:ENC_KEY", version: 1, keys: { 1: "env:ENC_KEY" } },
    },
  };
}

describe("encryption CLI batch (encrypt:scan / encrypt:rotate-key)", function () {
  let tmpDir;
  let origCwd;
  let db;

  before(function () {
    // Set up an sqlite DB in a temp folder with plaintext rows
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);

    const dbFile = path.join(tmpDir, "enc.db");
    process.env.DB_NAME = dbFile;

    // Use a dedicated better-sqlite3 connection for verification queries.
    const Database = require("better-sqlite3");
    db = new Database(dbFile);
    db.exec(
      `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ssn TEXT NOT NULL,
        email TEXT NOT NULL,
        profile TEXT
      )`,
    );
    db.prepare(
      `INSERT INTO users (ssn, email, profile) VALUES
        ('123-45-6789', 'a@example.com', '{"dob":"1990-01-01 00:00:00","city":"NYC"}'),
        ('999-88-7777', 'b@example.com', '{"dob":"2001-02-03 00:00:00","city":"LAX"}'),
        ('555-11-0000', 'c@example.com', '{"dob":null,"city":"SFO"}')`,
    ).run();

    const schema = buildSchema();
    const dbFile2 = path.join(tmpDir, "dbmr.schema.json");
    fs.writeFileSync(dbFile2, JSON.stringify(schema, null, 2));
  });

  after(function () {
    if (db && db.close) {
      db.close();
    }
    process.chdir(origCwd);
    rmTmpDir(tmpDir);
    delete process.env.DB_NAME;
  });

  function runScan(args, flags) {
    const cmd = require("../../src/cli/commands/encrypt-scan");
    const ctx = new OutputContext(flags || {});
    return cmd(args, flags || {}, ctx).then(() => ({ ctx }));
  }

  function runRotate(args, flags) {
    const cmd = require("../../src/cli/commands/encrypt-rotate-key");
    const ctx = new OutputContext(flags || {});
    return cmd(args, flags || {}, ctx).then(() => ({ ctx }));
  }

  it("scan reports unencrypted values per field", async function () {
    const { ctx } = await runScan(
      { type: "sqlite3", from: "dbmr.schema.json" },
      { dryRun: true },
    );
    // Plain text output path should have printed counts
    assert.ok(ctx._results.length === 0, "human mode accumulates no results");
  });

  it("scan --json returns structured reports with field counts", async function () {
    const { ctx } = await runScan(
      { type: "sqlite3", from: "dbmr.schema.json" },
      { json: true, dryRun: true },
    );
    const [result] = ctx._results;
    assert.ok(result.reports, "should have reports");
    const users = result.reports.find((r) => r.table === "users");
    assert.ok(users, "should report users table");
    assert.strictEqual(users.total, 3);
    assert.strictEqual(users.fields.ssn.unencrypted, 3);
    assert.strictEqual(users.fields.ssn.encrypted, 0);
    assert.strictEqual(users.fields["profile.dob"].unencrypted, 2);
    assert.strictEqual(users.fields["profile.dob"].null, 1);
  });

  it("scan without --apply reports only and never writes", async function () {
    const { ctx } = await runScan(
      { type: "sqlite3", from: "dbmr.schema.json" },
      { json: true },
    );
    const [result] = ctx._results;
    assert.ok(result.reports, "should have reports");
    const users = result.reports.find((r) => r.table === "users");
    assert.strictEqual(users.fields.ssn.unencrypted, 3, "values still plaintext");
    assert.deepStrictEqual(result.applied, [], "no applied entries without --apply");
    // The database must be untouched (report-only contract)
    const rows = db.prepare("SELECT ssn FROM users ORDER BY id").all();
    for (const row of rows) {
      assert.ok(!String(row.ssn).startsWith("enc:"), "ssn must remain plaintext");
    }
  });

  it("scan reports no unencrypted after --apply", async function () {
    await runScan(
      { type: "sqlite3", from: "dbmr.schema.json", apply: true },
      {},
    );
    const { ctx } = await runScan(
      { type: "sqlite3", from: "dbmr.schema.json" },
      { json: true },
    );
    const [result] = ctx._results;
    const users = result.reports.find((r) => r.table === "users");
    assert.strictEqual(users.fields.ssn.unencrypted, 0);
    assert.strictEqual(users.fields.ssn.encrypted, 3);
    assert.strictEqual(users.fields["profile.dob"].encrypted, 2);
  });

  it("stores encrypt:v1 envelopes in the DB", async function () {
    const rows = db.prepare("SELECT ssn, profile FROM users ORDER BY id").all();
    for (const row of rows) {
      assert.ok(String(row.ssn).startsWith("enc:v1:"));
      const profile = JSON.parse(row.profile);
      if (profile.dob !== null) {
        assert.ok(String(profile.dob).startsWith("enc:v1:"));
      }
    }
  });

  it("keeps JSON object columns single-stringified (no double-encoding)", async function () {
    const encryption = require("../../src/commons/encryption");
    const keyring = { 1: encryption.resolveKey("env:ENC_KEY") };
    const expectedDob = { 1: "1990-01-01 00:00:00", 2: "2001-02-03 00:00:00", 3: null };
    const rows = db.prepare("SELECT id, ssn, profile FROM users ORDER BY id").all();
    for (const row of rows) {
      // The stored value must parse as a single JSON object — not a JSON
      // string containing another JSON string (the reported regression).
      let parsed;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(row.profile);
      }, "stored profile should be a single JSON document");
      assert.ok(
        !(typeof parsed === "string"),
        "profile must not be a double-encoded string",
      );
      // Plain, non-encrypted sibling key must survive untouched
      assert.strictEqual(parsed.city, ["NYC", "LAX", "SFO"][row.id - 1]);
      // Encrypted dotted key decrypts to the original value
      if (parsed.dob !== null) {
        assert.ok(String(parsed.dob).startsWith("enc:v1:"));
        assert.strictEqual(encryption.decrypt(parsed.dob, keyring), expectedDob[row.id]);
      }
    }
  });

  it("scan --apply --dry-run encrypts nothing", async function () {
    const { ctx } = await runScan(
      { type: "sqlite3", from: "dbmr.schema.json", apply: true },
      { json: true, dryRun: true },
    );
    const [result] = ctx._results;
    const applied = result.applied.find((a) => a.table === "users");
    assert.ok(applied, "should have a dry-run applied entry");
    // Since data is already encrypted, nothing to change
    assert.strictEqual(applied.changed, 0);
  });

  it("rotate-key re-encrypts v1 envelopes to v2", async function () {
    const { ctx } = await runRotate(
      {
        type: "sqlite3",
        from: "dbmr.schema.json",
        to: "2",
        newKey: "env:NEW_ENC_KEY",
        keys: '{"1":"env:ENC_KEY"}',
      },
      { json: true },
    );
    const [result] = ctx._results;
    assert.strictEqual(result.toVersion, 2);
    const users = result.results.find((r) => r.table === "users");
    assert.ok(users, "should report users table");
    assert.strictEqual(users.changed, 3, "all non-null rows should rotate");
    assert.deepStrictEqual(users.errors, []);
  });

  it("rotate-key produces enc:v2 envelopes decryptable with new key", async function () {
    const rows = db.prepare("SELECT ssn FROM users ORDER BY id").all();
    for (const row of rows) {
      assert.ok(String(row.ssn).startsWith("enc:v2:"));
    }
    const encryption = require("../../src/commons/encryption");
    const keyring = {
      1: encryption.resolveKey("env:ENC_KEY"),
      2: encryption.resolveKey("env:NEW_ENC_KEY"),
    };
    const first = db.prepare("SELECT ssn FROM users ORDER BY id LIMIT 1").get();
    assert.strictEqual(
      encryption.decrypt(first.ssn, keyring),
      "123-45-6789",
    );
  });

  it("rotate-key --dry-run changes nothing", async function () {
    const before = db.prepare("SELECT ssn FROM users ORDER BY id").all();
    const { ctx } = await runRotate(
      {
        type: "sqlite3",
        from: "dbmr.schema.json",
        to: "3",
        newKey: "env:NEW_ENC_KEY",
        keys: '{"1":"env:ENC_KEY","2":"env:NEW_ENC_KEY"}',
      },
      { json: true, dryRun: true },
    );
    const [result] = ctx._results;
    assert.strictEqual(result.results[0].changed, 3);
    const after = db.prepare("SELECT ssn FROM users ORDER BY id").all();
    for (let i = 0; i < before.length; i++) {
      assert.strictEqual(after[i].ssn, before[i].ssn);
    }
  });

  it("scan filters tables with --tables", async function () {
    const { ctx } = await runScan(
      { type: "sqlite3", from: "dbmr.schema.json", tables: "doesnotexist" },
      { json: true },
    );
    const [result] = ctx._results;
    assert.deepStrictEqual(result.reports, []);
    assert.deepStrictEqual(result.failures, []);
  });
});