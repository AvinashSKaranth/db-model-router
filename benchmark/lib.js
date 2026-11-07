/**
 * Shared benchmark plumbing: DB config, raw pool, schema apply, seed/reset,
 * payload factories and stats helpers. Used by run.js and every contender.
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const PG = {
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT || "5432", 10),
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "password",
  database: process.env.PG_DB || "test_db",
};

const SEED_ROWS = 2000;

function pgPoolConfig(max = 10) {
  return { ...PG, max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 };
}

function createRawPool(max = 10) {
  return new Pool(pgPoolConfig(max));
}

async function applySchema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}

/** Deterministic base row i (0-based). */
function seedRow(i) {
  return {
    sku: `SEED-${String(i).padStart(6, "0")}`,
    name: `Seed Item ${i}`,
    description: `Benchmark seed row number ${i}`,
    quantity: i % 100,
    price: ((i * 137) % 10000) / 100, // 0.00 - 99.99
    active: i % 2 === 0,
    meta: JSON.stringify({ color: ["red", "green", "blue"][i % 3], tags: [`t${i % 7}`, `u${i % 13}`], weight: (i * 31) % 500 }),
  };
}

/** Shared reset: truncate + reseed SEED_ROWS rows. Returns seeded ids. */
async function resetAndSeed(pool) {
  await pool.query("TRUNCATE bench_items, bench_audit RESTART IDENTITY CASCADE");
  const CHUNK = 250;
  for (let start = 0; start < SEED_ROWS; start += CHUNK) {
    const rows = [];
    const values = [];
    for (let i = start; i < Math.min(start + CHUNK, SEED_ROWS); i++) {
      const r = seedRow(i);
      const b = (i - start) * 7;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::numeric,$${b + 6},$${b + 7}::jsonb)`);
      rows.push(r.sku, r.name, r.description, r.quantity, r.price, r.active, r.meta);
    }
    await pool.query(
      `INSERT INTO bench_items (sku, name, description, quantity, price, active, meta) VALUES ${values.join(",")}`,
      rows,
    );
  }
  const { rows } = await pool.query("SELECT id FROM bench_items ORDER BY id");
  return rows.map((r) => r.id);
}

/** Unique payload factory for insert benchmarks. */
function makeItemFactory(tag) {
  let counter = 0;
  const stamp = `${process.pid.toString(36)}${Date.now().toString(36)}`;
  return function makeItem() {
    counter += 1;
    return {
      sku: `B${stamp}-${counter}`,
      name: `Bench Item ${counter}`,
      description: `benchmark payload row ${counter} for ${tag}`,
      quantity: counter % 100,
      price: ((counter * 137) % 10000) / 100,
      active: counter % 2 === 0,
      meta: { color: ["red", "green", "blue"][counter % 3], tags: [`t${counter % 7}`], weight: (counter * 31) % 500 },
    };
  };
}

/** Percentile (nearest-rank) of an ascending-sorted array. */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  return { mean, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), min: s[0], max: s[n - 1] };
}

module.exports = { PG, SEED_ROWS, pgPoolConfig, createRawPool, applySchema, resetAndSeed, makeItemFactory, summarize, percentile };
