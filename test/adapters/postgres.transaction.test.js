process.env.NODE_ENV = "TEST";
const assert = require("assert");
const db = require("../../src/postgres/db.js");
const model = require("../../src/commons/model.js");

describe("PostgreSQL Live Transaction Support", function () {
  const usersTable = "pg_tx_users_" + Date.now();
  const accountsTable = "pg_tx_accounts_" + Date.now();

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

  before(async function () {
    db.connect({
      host: process.env.PG_HOST || "localhost",
      port: process.env.PG_PORT || 5432,
      user: process.env.PG_USER || "postgres",
      password: process.env.PG_PASSWORD || "password",
      database: process.env.PG_DB || "test_db",
    });

    await db.query(`CREATE TABLE "${usersTable}" (
      "id" SERIAL PRIMARY KEY,
      "name" VARCHAR(255) NOT NULL,
      "email" VARCHAR(255) NOT NULL UNIQUE
    )`);

    await db.query(`CREATE TABLE "${accountsTable}" (
      "id" SERIAL PRIMARY KEY,
      "user_id" INT NOT NULL,
      "balance" NUMERIC NOT NULL
    )`);

    userModel = model(db, usersTable, userStructure, "id", ["email"]);
    accountModel = model(db, accountsTable, accountStructure, "id", ["id"]);
  });

  after(async function () {
    try {
      await db.query(`DROP TABLE IF EXISTS "${accountsTable}" CASCADE`);
      await db.query(`DROP TABLE IF EXISTS "${usersTable}" CASCADE`);
      await db.disconnect();
    } catch (_) {}
  });

  it("commits multiple operations across tables atomically in PostgreSQL", async function () {
    const res = await db.transaction(async (tx) => {
      const user = await tx.model(userModel).insert({
        name: "PG Alice",
        email: "pg.alice@example.com",
      });
      const account = await tx.model(accountModel).insert({
        user_id: user.id,
        balance: 1500,
      });
      return { user, account };
    });

    assert(res.user.id > 0);
    assert(res.account.id > 0);

    const u = await userModel.byId(res.user.id);
    const a = await accountModel.byId(res.account.id);
    assert.strictEqual(u.name, "PG Alice");
    assert.strictEqual(Number(a.balance), 1500);
  });

  it("rolls back all operations in PostgreSQL when transaction fails", async function () {
    const initialCount = (await userModel.find({})).count;

    await assert.rejects(
      async () => {
        await db.transaction(async (tx) => {
          await tx.model(userModel).insert({
            name: "PG Bob",
            email: "pg.bob@example.com",
          });
          throw new Error("PG Rollback Trigger");
        });
      },
      { message: "PG Rollback Trigger" },
    );

    const finalCount = (await userModel.find({})).count;
    assert.strictEqual(finalCount, initialCount);

    const bob = await userModel.findOne({ email: "pg.bob@example.com" });
    assert.strictEqual(bob, false);
  });
});
