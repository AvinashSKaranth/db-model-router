/**
 * Contender: Drizzle ORM 0.45 on PostgreSQL via drizzle-orm/node-postgres
 * and the same pg Pool (max 10) as everyone else. Plain CommonJS usage.
 */
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { pgTable, serial, varchar, integer, numeric, boolean, jsonb, timestamp } = require("drizzle-orm/pg-core");
const { eq, inArray, asc, desc, count } = require("drizzle-orm");
const { PG, pgPoolConfig, makeItemFactory } = require("./lib");

const benchItems = pgTable("bench_items", {
  id: serial("id").primaryKey(),
  sku: varchar("sku", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: varchar("description", { length: 255 }).notNull().default(""),
  quantity: integer("quantity").notNull().default(0),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  active: boolean("active").notNull().default(true),
  meta: jsonb("meta").notNull().default({}),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  modified_at: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
});

const benchAudit = pgTable("bench_audit", {
  id: serial("id").primaryKey(),
  item_id: integer("item_id").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

let pool, db;

// Postgres caps bound parameters at 65535 — chunk large VALUES lists.
async function bulkInsert(ctx, n) {
  const CHUNK = 1000;
  for (let start = 0; start < n; start += CHUNK) {
    const rows = Array.from({ length: Math.min(CHUNK, n - start) }, () => {
      const item = ctx.makeItem();
      return { ...item, price: item.price.toFixed(2) };
    });
    await db.insert(benchItems).values(rows);
  }
}

module.exports = {
  name: "drizzle",
  label: "Drizzle ORM",

  async setup(ctx) {
    pool = new Pool(pgPoolConfig(10));
    db = drizzle(pool);
    ctx.db = db;
    ctx.makeItem = makeItemFactory("drizzle");
  },

  async teardown() {
    await pool.end();
  },

  scenarios: {
    insert_single: (ctx) =>
      ctx.db.insert(benchItems).values(ctx.makeItem()).returning().then((r) => r[0]),

    bulk_100: (ctx) => bulkInsert(ctx, 100),
    bulk_1000: (ctx) => bulkInsert(ctx, 1000),
    bulk_10000: (ctx) => bulkInsert(ctx, 10000),

    read_pk: (ctx) =>
      ctx.db.select().from(benchItems).where(eq(benchItems.id, ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0])),

    find_filter: (ctx) => ctx.db.select().from(benchItems).where(eq(benchItems.active, true)),
    find_sort_limit: (ctx) =>
      ctx.db.select().from(benchItems).where(eq(benchItems.active, true)).orderBy(asc(benchItems.id)).limit(20),
    list_page: async (ctx) => {
      const data = await ctx.db.select().from(benchItems).limit(20).offset(0);
      const [{ value: total }] = await ctx.db.select({ value: count() }).from(benchItems);
      return { data, count: total };
    },

    update_pk: (ctx) => {
      const id = ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0];
      return ctx.db.update(benchItems).set({ quantity: (Math.random() * 100) | 0 }).where(eq(benchItems.id, id));
    },

    bulk_update_100: (ctx) => {
      const ids = ctx.seedIds.slice(0, 100);
      const q = (Math.random() * 100) | 0;
      return ctx.db.update(benchItems).set({ quantity: q }).where(inArray(benchItems.id, ids));
    },

    upsert: (ctx, i) => {
      if (i % 2 === 0) {
        const sku = `SEED-${String((i * 7) % ctx.seedIds.length).padStart(6, "0")}`;
        return ctx.db
          .insert(benchItems)
          .values({ sku, name: `Upserted ${i}`, description: "upsert update path", quantity: i % 100, price: "9.99", active: true, meta: { upsert: true } })
          .onConflictDoUpdate({ target: benchItems.sku, set: { name: `Upserted ${i}`, quantity: i % 100, meta: { upsert: true } } });
      }
      const item = ctx.makeItem();
      return ctx.db
        .insert(benchItems)
        .values({ ...item, price: item.price.toFixed(2) })
        .onConflictDoUpdate({ target: benchItems.sku, set: { name: item.name } });
    },

    delete_pk: (ctx) => {
      const idx = ((ctx.state.deleteCursor = ((ctx.state.deleteCursor || 0) + 1) % ctx.seedIds.length));
      return ctx.db.delete(benchItems).where(eq(benchItems.id, ctx.seedIds[idx]));
    },

    tx_multi: (ctx) =>
      ctx.db.transaction(async (tx) => {
        const item = { ...ctx.makeItem(), price: "1.00" };
        const [created] = await tx.insert(benchItems).values(item).returning();
        await tx.update(benchItems).set({ quantity: 1 }).where(eq(benchItems.id, created.id));
        await tx.insert(benchAudit).values({ item_id: created.id, action: "bench" });
      }),

    tx_rollback: async (ctx) => {
      try {
        await ctx.db.transaction(async (tx) => {
          const item = { ...ctx.makeItem(), price: "1.00" };
          await tx.insert(benchItems).values(item);
          throw new Error("bench-rollback");
        });
        return { rolledBack: false };
      } catch (err) {
        if (err && err.message === "bench-rollback") return { rolledBack: true };
        throw err;
      }
    },

    jsonb_roundtrip: async (ctx) => {
      const item = { ...ctx.makeItem(), price: "1.00" };
      const [created] = await ctx.db.insert(benchItems).values(item).returning();
      return ctx.db.select().from(benchItems).where(eq(benchItems.id, created.id));
    },
  },

  afterScenario(key, ctx, result) {
    if (key === "tx_rollback" && result && result.rolledBack === false) {
      return "transaction committed instead of rolling back";
    }
    return null;
  },
};
