-- Benchmark schema: db-model-router vs Sequelize vs Prisma vs Drizzle
-- Applied fresh (drop + create) at the start of each contender process.

DROP TABLE IF EXISTS bench_audit;
DROP TABLE IF EXISTS bench_items;

CREATE TABLE bench_items (
  id          SERIAL PRIMARY KEY,
  sku         VARCHAR(32)   NOT NULL UNIQUE,
  name        VARCHAR(128)  NOT NULL,
  description VARCHAR(255)  NOT NULL DEFAULT '',
  quantity    INTEGER       NOT NULL DEFAULT 0,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  active      BOOLEAN       NOT NULL DEFAULT true,
  meta        JSONB         NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX bench_items_active_idx ON bench_items (active);

CREATE TABLE bench_audit (
  id      SERIAL PRIMARY KEY,
  item_id INTEGER     NOT NULL REFERENCES bench_items (id),
  action  VARCHAR(32) NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
