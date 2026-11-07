# db-model-router vs Traditional ORM — Benchmark Plan (PostgreSQL)

## Goal

Measure how `db-model-router` (this library) compares against a traditional Node.js ORM
for common database workloads on PostgreSQL, and produce a self-contained HTML report.

## ORM choice: Sequelize

**Pick: [Sequelize](https://sequelize.org/)** — the canonical "traditional ORM" for Node.js:

- Mature, promise-based model API (`create`, `findAll`, `findByPk`, `update`, `destroy`,
  `bulkCreate`, `upsert`, `sequelize.transaction`) that maps 1:1 onto the operations we
  want to compare.
- First-class PostgreSQL support via `pg` (the same driver this library uses), so the
  wire protocol and pool are identical — the comparison isolates the ORM/library layer.
- No separate query engine binary (unlike Prisma), so we measure ORM overhead, not a
  Rust engine's FFI cost.

Alternatives considered and rejected for this round:

| ORM | Why not (for now) |
|---|---|
| Prisma | Modern paradigm, ships a Rust query engine; measures Prisma + engine, not "traditional ORM" overhead. Candidate for a later round. |
| TypeORM | Decorators + ActiveRecord/DataMapper dual API; heavier setup, similar paradigm to Sequelize. |
| Knex / Objection | Query builder (not a full ORM); useful as a "raw-ish" baseline later, not the traditional-ORM comparison. |

## What we compare

Same table, same data, same Postgres instance (docker-compose `db-model-router-postgres`,
`localhost:5432`, `test_db`), same pool size. Two contenders:

1. **db-model-router** — `model(db, table, structure, pk, unique, option)` API exactly as
   documented (validation on, default model settings).
2. **Sequelize** — model with matching column types and its default validations enabled
   (fair: both sides validate).

### Schema under test

Single table `bench_items` (plus a child table `bench_audit` for the multi-transaction case):

```
bench_items(
  id          SERIAL PRIMARY KEY,
  sku         VARCHAR(32)  NOT NULL UNIQUE,
  name        VARCHAR(128) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  quantity    INTEGER      NOT NULL DEFAULT 0,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  active      BOOLEAN      NOT NULL DEFAULT true,
  meta        JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ  NOT NULL DEFAULT now()
)
```

Indexed on `sku` (unique) and `active`. `meta` exercises JSONB handling on both sides.

### Operations (each run as an isolated scenario)

| # | Scenario | db-model-router | Sequelize |
|---|---|---|---|
| 1 | Insert single row (returns created record) | `insert()` | `create()` |
| 2 | Bulk insert 100 rows | `insert({ data: [...] })` | `bulkCreate()` |
| 3 | Bulk insert 1,000 rows | `insert({ data: [...] })` | `bulkCreate()` |
| 4 | Read by PK | `byId(id)` | `findByPk()` |
| 5 | Find with filter (indexed column, ~N matches) | `find({ active: true })` | `findAll({ where: { active: true } })` |
| 6 | Find with filter + sort + limit 20 | `find({ ..., sort, limit })` | `findAll({ ..., order, limit })` |
| 7 | Paginated list (page 1, size 20) | `list()` | `findAndCountAll({ limit, offset })` |
| 8 | Update by PK | `update()` | instance `update()` / `update(..., { where })` |
| 9 | Bulk update (filter + set) | `update({ data: [...] })` or filtered update | `update(..., { where })` |
| 10 | Upsert (insert-or-update on unique key) | `upsert()` | `upsert()` |
| 11 | Delete by PK | `remove({ id })` | `destroy({ where: { id } })` |
| 12 | Transaction: multi-statement (insert + update + insert into audit) | `db.transaction(fn)` | `sequelize.transaction(fn)` |
| 13 | Transaction rollback path (forced error, verify rollback) | same, throwing fn | same, throwing fn |
| 14 | JSON/JSONB round-trip read+write | meta column | meta column |

### Methodology

- **Seed**: identical dataset loaded once per contender via raw multi-row `INSERT`
  (bypassing both libraries) so neither side pays seed cost inside measurements.
- **Warmup**: 200 ops per scenario before timing (JIT + pool warmup).
- **Iterations**: default 1,000 ops per scenario (configurable via `--iterations`),
  5 runs, report median of runs.
- **Metrics** per scenario: mean, p50, p95, p99 latency (ms), throughput (ops/sec),
  error count.
- **Interleaving**: contenders alternate round-robin per scenario to cancel machine
  drift; Postgres `TRUNCATE ... RESTART IDENTITY` between scenarios that mutate.
- **Pool**: `pg.Pool` max = 10 for both (Sequelize `pool.max: 10`).
- **Fairness notes documented in report**:
  - `db-model-router.insert()` does an extra `SELECT ... WHERE id = ?` after insert to
    return the full record; Sequelize `create()` returns the instance without a re-select.
    We measure both as-is (that *is* the library's cost) and also report a "dbmr insert
    (excl. re-select)" diagnostic if feasible.
  - Validation is ON for both. Raw-SQL floor is out of scope for v1 (possible later as a
    third contender).

### Harness

Small custom runner (`benchmark/run.js`), no benchmark framework dependency:

- `node benchmark/run.js --db postgres --iterations 1000 --runs 5`
- Uses `performance.now()`, collects latency samples, computes percentiles.
- Exits non-zero on any scenario error.

## Folder layout

```
benchmark/
  PLAN.md                  # this file
  schema.sql               # bench_items + bench_audit DDL
  seed.js                  # raw-SQL seeder (shared by both contenders)
  bench-dbmr.js            # db-model-router scenarios
  bench-sequelize.js       # sequelize scenarios (same scenario keys)
  scenarios.js             # shared scenario definitions / payload factories
  run.js                   # harness: warmup, timing, percentiles, interleaving
  report.js                # renders self-contained HTML report
  reports/                 # OUTPUT — gitignored (benchmark/reports/*.html)
```

## HTML report

`benchmark/reports/postgres-<YYYYMMDD-HHmmss>.html`, fully self-contained (inline CSS +
inline SVG bar charts, zero external requests, works offline):

- Header: date, git SHA, Postgres version, Node version, machine summary.
- Summary table: scenario × contender → p50/p95/p99/throughput/ops-per-sec, with a
  "winner" column and % delta.
- Per-scenario bar charts (latency and throughput).
- Methodology + fairness notes from this plan.
- `.gitignore` covers `benchmark/reports/` and `benchmark/*.html` — reports are never
  committed.

## Steps

1. Add `sequelize` as a devDependency (not a peer/runtime dep).
2. Write `schema.sql`, seeder, scenarios.
3. Implement both contender adapters against the same scenario keys.
4. Implement harness + report generator.
5. Add `benchmark/reports/` to `.gitignore`.
6. Add npm script: `"benchmark": "node benchmark/run.js --db postgres"`.
7. Run it, sanity-check output, iterate.

## Out of scope (v1)

- MySQL/MariaDB/SQLite/MSSQL/Oracle (folder structured so `--db mysql` etc. can be added later).
- HTTP/Express layer (this benchmarks the data layer, not route overhead).
- Concurrency stress testing (separate `autocannon`-style phase later if wanted).
