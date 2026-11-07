/**
 * Contender: Prisma ORM 7 (Rust-free client + @prisma/adapter-pg on a pg Pool).
 * Prisma 7 only emits TypeScript, so the generated client is loaded via dynamic
 * import with tsx active (run.js spawns this contender with --import tsx).
 * Run `npx prisma generate --schema benchmark/prisma/schema.prisma` first
 * (or `npm run benchmark:generate`).
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { Pool } = require("pg");
const { PG, pgPoolConfig, makeItemFactory } = require("./lib");

let prisma;

module.exports = {
  name: "prisma",
  label: "Prisma",

  async setup(ctx) {
    const genDir = path.join(__dirname, "prisma", "generated");
    const clientPath = path.join(genDir, "client.ts");
    if (!fs.existsSync(clientPath)) {
      throw new Error("Prisma client not generated. Run: npm run benchmark:generate");
    }

    const pool = new Pool(pgPoolConfig(10));
    let PrismaClient;
    try {
      ({ PrismaClient } = await import(pathToFileURL(clientPath).href));
    } catch (e) {
      await pool.end();
      throw new Error(`Failed to load the generated Prisma client (Prisma 7 emits .ts; run under tsx). Underlying error: ${e.message}`);
    }
    const { PrismaPg } = require("@prisma/adapter-pg");
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
    ctx.prisma = prisma;
    ctx.makeItem = makeItemFactory("prisma");
  },

  async teardown() {
    if (prisma) await prisma.$disconnect();
  },

  scenarios: {
    insert_single: (ctx) => ctx.prisma.bench_items.create({ data: ctx.makeItem() }),

    bulk_100: (ctx) => ctx.prisma.bench_items.createMany({ data: Array.from({ length: 100 }, () => ctx.makeItem()) }),
    bulk_1000: (ctx) => ctx.prisma.bench_items.createMany({ data: Array.from({ length: 1000 }, () => ctx.makeItem()) }),
    bulk_10000: (ctx) => ctx.prisma.bench_items.createMany({ data: Array.from({ length: 10000 }, () => ctx.makeItem()) }),

    read_pk: (ctx) => ctx.prisma.bench_items.findUnique({ where: { id: ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0] } }),

    find_filter: (ctx) => ctx.prisma.bench_items.findMany({ where: { active: true } }),
    find_sort_limit: (ctx) => ctx.prisma.bench_items.findMany({ where: { active: true }, orderBy: { id: "asc" }, take: 20 }),
    list_page: async (ctx) => {
      const [data, count] = await ctx.prisma.$transaction([
        ctx.prisma.bench_items.findMany({ take: 20, skip: 0 }),
        ctx.prisma.bench_items.count(),
      ]);
      return { data, count };
    },

    update_pk: (ctx) => {
      const id = ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0];
      return ctx.prisma.bench_items.update({ where: { id }, data: { quantity: (Math.random() * 100) | 0 } });
    },

    bulk_update_100: (ctx) => {
      const ids = ctx.seedIds.slice(0, 100);
      const q = (Math.random() * 100) | 0;
      return ctx.prisma.bench_items.updateMany({ where: { id: { in: ids } }, data: { quantity: q } });
    },

    upsert: (ctx, i) => {
      if (i % 2 === 0) {
        const sku = `SEED-${String((i * 7) % ctx.seedIds.length).padStart(6, "0")}`;
        return ctx.prisma.bench_items.upsert({
          where: { sku },
          create: { sku, name: `Upserted ${i}`, description: "upsert update path", quantity: i % 100, price: 9.99, active: true, meta: { upsert: true } },
          update: { name: `Upserted ${i}`, quantity: i % 100, meta: { upsert: true } },
        });
      }
      const item = ctx.makeItem();
      return ctx.prisma.bench_items.upsert({ where: { sku: item.sku }, create: item, update: item });
    },

    delete_pk: (ctx) => {
      const idx = ((ctx.state.deleteCursor = ((ctx.state.deleteCursor || 0) + 1) % ctx.seedIds.length));
      return ctx.prisma.bench_items.delete({ where: { id: ctx.seedIds[idx] } });
    },

    tx_multi: (ctx) =>
      ctx.prisma.$transaction(async (tx) => {
        const item = await tx.bench_items.create({ data: ctx.makeItem() });
        await tx.bench_items.update({ where: { id: item.id }, data: { quantity: 1 } });
        await tx.bench_audit.create({ data: { item_id: item.id, action: "bench" } });
      }),

    tx_rollback: async (ctx) => {
      try {
        await ctx.prisma.$transaction(async (tx) => {
          await tx.bench_items.create({ data: ctx.makeItem() });
          throw new Error("bench-rollback");
        });
        return { rolledBack: false };
      } catch (err) {
        if (err && err.message === "bench-rollback") return { rolledBack: true };
        throw err;
      }
    },

    jsonb_roundtrip: async (ctx) => {
      const item = await ctx.prisma.bench_items.create({ data: ctx.makeItem() });
      return ctx.prisma.bench_items.findUnique({ where: { id: item.id } });
    },
  },

  afterScenario(key, ctx, result) {
    if (key === "tx_rollback" && result && result.rolledBack === false) {
      return "transaction committed instead of rolling back";
    }
    return null;
  },
};
