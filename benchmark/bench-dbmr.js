/**
 * Contender: db-model-router (this library) on PostgreSQL.
 * Used exactly as documented: model(db, table, structure, pk, unique, option).
 */
const db = require("../src/postgres/db.js");
const model = require("../src/commons/model.js");
const { PG, makeItemFactory } = require("./lib");

const structure = {
  sku: "required|string",
  name: "required|string",
  description: "required|string",
  quantity: "required|integer",
  price: "required|numeric",
  active: "required|boolean",
  meta: "required|object",
};

module.exports = {
  name: "dbmr",
  label: "db-model-router",

  async setup(ctx) {
    db.connect({ host: PG.host, port: PG.port, user: PG.user, password: PG.password, database: PG.database });
    ctx.makeItem = makeItemFactory("dbmr");
    ctx.m = model(db, "bench_items", structure, "id", ["sku"]);
    ctx.audit = model(db, "bench_audit", { item_id: "required|integer", action: "required|string" }, "id", ["id"]);
  },

  async teardown() {
    await db.disconnect();
  },

  scenarios: {
    insert_single: (ctx) => ctx.m.insert(ctx.makeItem()),

    bulk_100: (ctx) => ctx.m.insert({ data: Array.from({ length: 100 }, () => ctx.makeItem()) }),
    bulk_1000: (ctx) => ctx.m.insert({ data: Array.from({ length: 1000 }, () => ctx.makeItem()) }),
    bulk_10000: (ctx) => ctx.m.insert({ data: Array.from({ length: 10000 }, () => ctx.makeItem()) }),

    read_pk: (ctx) => ctx.m.byId(ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0]),

    find_filter: (ctx) => ctx.m.find({ active: true }),
    find_sort_limit: (ctx) => ctx.m.find({ active: true, sort: ["+id"], limit: 20 }),
    list_page: (ctx) => ctx.m.list({ page: 0, size: 20 }),

    update_pk: (ctx) => {
      const id = ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0];
      // db-model-router's update validator requires the full record.
      return ctx.m.update({ ...ctx.makeItem(), id, quantity: (Math.random() * 100) | 0 });
    },

    bulk_update_100: (ctx) => {
      const ids = ctx.seedIds.slice(0, 100);
      const q = (Math.random() * 100) | 0;
      return ctx.m.update({ data: ids.map((id) => ({ ...ctx.makeItem(), id, quantity: q })) });
    },

    upsert: (ctx, i) => {
      if (i % 2 === 0) {
        // update path: existing sku
        const sku = `SEED-${String((i * 7) % ctx.seedIds.length).padStart(6, "0")}`;
        return ctx.m.upsert({ sku, name: `Upserted ${i}`, description: "upsert update path", quantity: i % 100, price: 9.99, active: true, meta: { upsert: true } });
      }
      // insert path: brand-new sku
      return ctx.m.upsert(ctx.makeItem());
    },

    delete_pk: (ctx) => {
      const id = ctx.seedIds[(ctx.state.deleteCursor = ((ctx.state.deleteCursor || 0) + 1) % ctx.seedIds.length)];
      return ctx.m.remove({ id });
    },

    tx_multi: (ctx) =>
      db.transaction(async (tx) => {
        const item = await tx.model(ctx.m).insert(ctx.makeItem());
        await tx.model(ctx.m).update({ ...item, quantity: 1 });
        await tx.model(ctx.audit).insert({ item_id: item.id, action: "bench" });
      }),

    tx_rollback: async (ctx) => {
      try {
        await db.transaction(async (tx) => {
          await tx.model(ctx.m).insert(ctx.makeItem());
          throw new Error("bench-rollback");
        });
        return { rolledBack: false };
      } catch (err) {
        if (err && err.message === "bench-rollback") return { rolledBack: true };
        throw err;
      }
    },

    jsonb_roundtrip: async (ctx) => {
      const item = await ctx.m.insert(ctx.makeItem());
      return ctx.m.byId(item.id);
    },
  },

  afterScenario(key, ctx, result) {
    if (key === "tx_rollback" && result && result.rolledBack === false) {
      return "transaction committed instead of rolling back";
    }
    return null;
  },
};
