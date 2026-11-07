process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/sqlite3/db.js");
const model = require("../../src/commons/model.js");
const kafka = require("../../src/commons/kafka.js");

describe("Cross-Model ACID Transaction Management", function () {
  const usersTable = "test_tx_users_" + Date.now();
  const accountsTable = "test_tx_accounts_" + Date.now();

  const userStructure = {
    id: "integer",
    name: "required|string",
    email: "required|string",
  };
  const accountStructure = {
    id: "integer",
    user_id: "required|integer",
    balance: "required|numeric",
  };

  let userModel;
  let accountModel;
  let kafkaPublished = [];

  before(function () {
    db.connect({ database: ":memory:" });
    db.query(
      `CREATE TABLE "${usersTable}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT NOT NULL UNIQUE
      )`,
    );
    db.query(
      `CREATE TABLE "${accountsTable}" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "user_id" INTEGER NOT NULL,
        "balance" REAL NOT NULL
      )`,
    );

    userModel = model(db, usersTable, userStructure, "id", ["email"]);
    accountModel = model(db, accountsTable, accountStructure, "id", ["id"]);

    // Intercept kafka produce to verify transactional buffering
    const originalProduce = kafka.produce;
    kafka.produce = (table, action, data) => {
      kafkaPublished.push({ table, action, data });
      return originalProduce(table, action, data);
    };
  });

  after(function () {
    try {
      db.disconnect();
    } catch (_) {}
  });

  beforeEach(function () {
    kafkaPublished = [];
  });

  it("commits multiple operations across different models atomically", async function () {
    const result = await db.transaction(async (tx) => {
      const user = await tx.model(userModel).insert({
        name: "Alice Tx",
        email: "alice.tx@example.com",
      });
      const account = await accountModel.withTx(tx).insert({
        user_id: user.id,
        balance: 500,
      });
      return { user, account };
    });

    assert(result.user.id > 0);
    assert(result.account.id > 0);

    // Verify data persisted in database
    const userInDb = await userModel.byId(result.user.id);
    const accountInDb = await accountModel.byId(result.account.id);
    assert.strictEqual(userInDb.name, "Alice Tx");
    assert.strictEqual(accountInDb.balance, 500);

    // Verify Kafka events were flushed upon successful commit
    assert.strictEqual(kafkaPublished.length, 2);
    assert.strictEqual(kafkaPublished[0].table, usersTable);
    assert.strictEqual(kafkaPublished[1].table, accountsTable);
  });

  it("rolls back all operations when an error is thrown inside transaction", async function () {
    const initialUserCount = (await userModel.find({})).count;
    const initialAccountCount = (await accountModel.find({})).count;
    kafkaPublished = [];

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          await tx.model(userModel).insert({
            name: "Bob Tx",
            email: "bob.tx@example.com",
          });

          // Simulate an error halfway through
          throw new Error("Simulated transactional failure");
        });
      },
      { message: "Simulated transactional failure" },
    );

    // Verify Bob was rolled back
    const finalUserCount = (await userModel.find({})).count;
    const finalAccountCount = (await accountModel.find({})).count;
    assert.strictEqual(finalUserCount, initialUserCount);
    assert.strictEqual(finalAccountCount, initialAccountCount);

    // Verify Kafka did NOT publish any events for rolled back transaction!
    assert.strictEqual(kafkaPublished.length, 0);
  });

  it("supports raw tx.query inside transaction", async function () {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO "${usersTable}" ("name", "email") VALUES (?, ?)`,
        ["Charlie Raw", "charlie.raw@example.com"],
      );
    });

    const user = await userModel.findOne({ email: "charlie.raw@example.com" });
    assert.strictEqual(user.name, "Charlie Raw");
  });

  it("supports nested savepoints inside transaction", async function () {
    await db.transaction(async (tx) => {
      await tx.model(userModel).insert({
        name: "Outer User",
        email: "outer@example.com",
      });

      // Nested transaction that fails and is caught
      try {
        await db.transaction(async (nestedTx) => {
          await nestedTx.model(userModel).insert({
            name: "Inner User",
            email: "inner@example.com",
          });
          throw new Error("Inner error");
        });
      } catch {
        // Handled inner error
      }

      await tx.model(userModel).insert({
        name: "Outer User 2",
        email: "outer2@example.com",
      });
    });

    const outer1 = await userModel.findOne({ email: "outer@example.com" });
    const outer2 = await userModel.findOne({ email: "outer2@example.com" });
    const inner = await userModel.findOne({ email: "inner@example.com" });

    assert(outer1, "Outer 1 should exist");
    assert(outer2, "Outer 2 should exist");
    assert.strictEqual(inner, false, "Inner rolled-back record should not exist");
  });
});
