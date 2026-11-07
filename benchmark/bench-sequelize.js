/**
 * Contender: Sequelize 6 on PostgreSQL (same pg driver, pool max 10).
 * Default model API with validations on — the traditional-ORM baseline.
 */
const { Sequelize, DataTypes, Op } = require("sequelize");
const { PG, makeItemFactory } = require("./lib");

let sequelize;

module.exports = {
  name: "sequelize",
  label: "Sequelize",

  async setup(ctx) {
    sequelize = new Sequelize(PG.database, PG.user, PG.password, {
      host: PG.host,
      port: PG.port,
      dialect: "postgres",
      pool: { max: 10, min: 0, idle: 30000 },
      logging: false,
    });
    const Item = sequelize.define(
      "bench_items",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        sku: { type: DataTypes.STRING(32), allowNull: false, unique: true, validate: { len: [1, 32] } },
        name: { type: DataTypes.STRING(128), allowNull: false, validate: { len: [1, 128] } },
        description: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },
        quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.NOW },
        modified_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      },
      { tableName: "bench_items", timestamps: false, underscored: true },
    );
    const Audit = sequelize.define(
      "bench_audit",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        item_id: { type: DataTypes.INTEGER, allowNull: false },
        action: { type: DataTypes.STRING(32), allowNull: false },
        at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      },
      { tableName: "bench_audit", timestamps: false, underscored: true },
    );
    ctx.Item = Item;
    ctx.Audit = Audit;
    ctx.makeItem = makeItemFactory("sequelize");
  },

  async teardown() {
    await sequelize.close();
  },

  scenarios: {
    insert_single: (ctx) => ctx.Item.create(ctx.makeItem()),

    bulk_100: (ctx) => ctx.Item.bulkCreate(Array.from({ length: 100 }, () => ctx.makeItem())),
    bulk_1000: (ctx) => ctx.Item.bulkCreate(Array.from({ length: 1000 }, () => ctx.makeItem())),
    bulk_10000: (ctx) => ctx.Item.bulkCreate(Array.from({ length: 10000 }, () => ctx.makeItem())),

    read_pk: (ctx) => ctx.Item.findByPk(ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0]),

    find_filter: (ctx) => ctx.Item.findAll({ where: { active: true } }),
    find_sort_limit: (ctx) => ctx.Item.findAll({ where: { active: true }, order: [["id", "ASC"]], limit: 20 }),
    list_page: (ctx) => ctx.Item.findAndCountAll({ limit: 20, offset: 0 }),

    update_pk: (ctx) => {
      const id = ctx.seedIds[(Math.random() * ctx.seedIds.length) | 0];
      return ctx.Item.update({ quantity: (Math.random() * 100) | 0 }, { where: { id } });
    },

    bulk_update_100: (ctx) => {
      const ids = ctx.seedIds.slice(0, 100);
      const q = (Math.random() * 100) | 0;
      return ctx.Item.update({ quantity: q }, { where: { id: { [Op.in]: ids } } });
    },

    upsert: (ctx, i) => {
      if (i % 2 === 0) {
        const sku = `SEED-${String((i * 7) % ctx.seedIds.length).padStart(6, "0")}`;
        return ctx.Item.upsert({ sku, name: `Upserted ${i}`, description: "upsert update path", quantity: i % 100, price: 9.99, active: true, meta: { upsert: true } });
      }
      return ctx.Item.upsert(ctx.makeItem());
    },

    delete_pk: (ctx) => {
      const idx = ((ctx.state.deleteCursor = ((ctx.state.deleteCursor || 0) + 1) % ctx.seedIds.length));
      return ctx.Item.destroy({ where: { id: ctx.seedIds[idx] } });
    },

    tx_multi: (ctx) =>
      sequelize.transaction(async (t) => {
        const item = await ctx.Item.create(ctx.makeItem(), { transaction: t });
        await ctx.Item.update({ quantity: 1 }, { where: { id: item.id }, transaction: t });
        await ctx.Audit.create({ item_id: item.id, action: "bench" }, { transaction: t });
      }),

    tx_rollback: async (ctx) => {
      try {
        await sequelize.transaction(async (t) => {
          await ctx.Item.create(ctx.makeItem(), { transaction: t });
          throw new Error("bench-rollback");
        });
        return { rolledBack: false };
      } catch (err) {
        if (err && err.message === "bench-rollback") return { rolledBack: true };
        throw err;
      }
    },

    jsonb_roundtrip: async (ctx) => {
      const item = await ctx.Item.create(ctx.makeItem());
      return ctx.Item.findByPk(item.id);
    },
  },

  afterScenario(key, ctx, result) {
    if (key === "tx_rollback" && result && result.rolledBack === false) {
      return "transaction committed instead of rolling back";
    }
    return null;
  },
};
