# db-model-router vs ORM Benchmarks — Plan (PostgreSQL)

## Goal

Measure how `db-model-router` (this library) compares against traditional/modern Node.js
ORMs for common database workloads on PostgreSQL, and produce a self-contained HTML report.

## Contenders (4)

| # | Contender | Version (pinned) | Notes |
|---|---|---|---|
| 1 | **db-model-router** | this repo | `model(db, table, structure, pk, unique, option)`, validation on, default settings |
| 2 | **Sequelize** | `sequelize@6.37.8` | The canonical "traditional ORM"; same `pg` driver, pool max 10, default validations on |
| 3 | **Prisma** | `prisma@7.10.1` + `@prisma/client@7.10.1` + `@prisma/adapter-pg` | Prisma ORM 7 Rust-free client (`prisma-client` generator, driver adapter `PrismaPg`, same `pg` pool underneath) |
| 4 | **Drizzle ORM** | `drizzle-orm@0.45.4` | SQL-like TypeScript ORM; used from plain JS via `drizzle-orm/node-postgres` on the same `pg` Pool |

All four run **in the same Node process model as the library itself** (CommonJS, no
TypeScript compile step for the harness; Prisma client is generated ahead of time by
`prisma generate` as part of setup). devDependencies only — nothing is added to
`dependencies` or `peerDependencies`.

### Why these four

- **Sequelize** — the traditional ORM baseline; classic model API (`create`, `findByPk`,
  `bulkCreate`, `update`, `destroy`, `sequelize.transaction`).
- **Prisma** — the most-used modern ORM; Rust-free client + `pg` driver adapter keeps the
  comparison at the ORM layer rather than the engine layer.
- **Drizzle** — lightweight, SQL-first modern ORM; closest in spirit to "thin" libraries
  like db-model-router.
- **db-model-router** — the subject under test, used exactly as documented.

## Execution model: sequential, one contender at a time

**No interleaved runs.** Each contender runs its complete suite in its **own Node process**,
one after another, so they never compete for CPU, pool connections, or memory:

```
for contender in [dbmr, sequelize, prisma, drizzle]:   # order recorded in report
  spawn `node benchmark/run.js --contender <name>`      # fresh process, fresh Pool
  wait for exit (non-zero = failed contender, recorded, suite continues)
  TRUNCATE bench_items, bench_audit; reseed raw
  cooldown pause (default 5s) + global.gc() between contenders
```

- Run order is fixed and printed in the report; a `--reverse` flag flips it for a second
  pass to detect order bias (optional).
- Fresh `pg.Pool` per contender process, `max: 10` everywhere.
- Each contender drops/recreates nothing — seed data is identical via shared raw-SQL
  seeder; mutating scenarios `TRUNCATE ... RESTART IDENTITY` and reseed.
- Report notes sequential execution and run order; inter-contender variance is visible by
  re-running with `--reverse`.

### Schema under test

Single table `bench_items` (plus child table `bench_audit` for the multi-transaction case):

```
bench_items(
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
)

bench_audit(
  id         SERIAL PRIMARY KEY,
  item_id    INTEGER NOT NULL REFERENCES bench_items(id),
  action     VARCHAR(32) NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Indexed on `sku` (unique) and `active`. `meta` exercises JSONB on all four contenders.

### Operations (each an isolated scenario)

| # | Scenario | db-model-router | Sequelize | Prisma | Drizzle |
|---|---|---|---|---|---|
| 1 | Insert single row (returns created record) | `insert()` | `create()` | `create()` | `insert().returning()` |
| 2 | Bulk insert 100 rows | `insert({ data: [...] })` | `bulkCreate()` | `createMany()` | `insert().values([...])` |
| 3 | Bulk insert 1,000 rows | `insert({ data: [...] })` | `bulkCreate()` | `createMany()` | `insert().values([...])` |
| 4 | **Bulk insert 10,000 rows** | `insert({ data: [...] })` | `bulkCreate()` | `createMany()` | `insert().values([...])` |
| 5 | Read by PK | `byId(id)` | `findByPk()` | `findUnique()` | `select ... where id =` |
| 6 | Find with filter (indexed column) | `find({ active: true })` | `findAll({ where })` | `findMany({ where })` | `select ... where` |
| 7 | Find filter + sort + limit 20 | `find({ ..., sort })` | `findAll({ order, limit })` | `findMany({ orderBy, take })` | `select ... orderBy limit` |
| 8 | Paginated list (page 1, size 20) | `list()` | `findAndCountAll()` | `findMany` + `count` | `select ... limit/offset` + `count()` |
| 9 | Update by PK | `update()` | instance `update()` | `update()` | `update ... where id =` |
| 10 | Bulk update (filter + set) | filtered/bulk `update()` | `update(..., { where })` | `updateMany()` | `update ... where` |
| 11 | Upsert on unique key (`sku`) | `upsert()` | `upsert()` | `upsert()` | `onConflictDoUpdate()` |
| 12 | Delete by PK | `remove({ id })` | `destroy({ where })` | `delete()` | `delete ... where id =` |
| 13 | Transaction: multi-statement (insert + update + audit insert) | `db.transaction(fn)` | `sequelize.transaction(fn)` | `$transaction([...])` | `db.transaction(async tx => ...)` |
| 14 | Transaction rollback path (forced error, verify no partial writes) | same, throwing fn | same, throwing fn | same, throwing fn | same, throwing fn |
| 15 | JSONB round-trip write+read (`meta`) | insert + `byId` | create + findByPk | create + findUnique | insert + select |

> Prisma `createMany()` does not return rows and its `upsert` requires a unique where —
> both are the idiomatic Prisma equivalents; noted in the report's fairness section.
> Drizzle `returning()` is used for parity with the others returning the created row.

### Methodology

- **Seed**: identical dataset loaded once per contender process via raw multi-row
  `INSERT` (bypassing all four libraries) — no contender pays seed cost in measurements.
- **Warmup**: 200 ops per scenario before timing (JIT + pool warmup).
- **Iterations**:
  - **Single-row scenarios (1, 5, 9, 11, 12, 15)**: exactly **1,000 measured iterations**
    per run, so the mean is statistically meaningful and not a fluke; reported mean, p50,
    p95, p99.
  - Bulk/transaction scenarios (2, 3, 4, 6–8, 10, 13, 14): 100 iterations per run
    (bulk 10k: 10 iterations — it's heavy).
  - `--runs 5` independent runs per scenario; report shows median-of-runs plus spread
    (min/max) so flakiness is visible, not hidden.
- **Metrics**: mean, p50, p95, p99 (ms), throughput (ops/sec), error count per scenario.
- **Isolation**: contenders run sequentially in separate processes (see above) — *not*
  interleaved — so they never share CPU/pool; `TRUNCATE` + raw reseed between scenarios
  that mutate; `--reverse` flag for order-bias check.
- **Pool**: `pg.Pool max: 10` for db-model-router / Drizzle / Prisma adapter;
  Sequelize `pool: { max: 10 }`.
- **Fairness notes documented in report**:
  - `db-model-router.insert()` does an extra `SELECT ... WHERE id = ?` after insert to
    return the full record; Sequelize `create()` and Drizzle `returning()` do not
    re-select; Prisma `create()` returns the row via `RETURNING`. Measured as-is — that
    is each library's real cost — with a diagnostic "dbmr insert excl. re-select" timing
    also reported if feasible.
  - Validation is ON for all contenders where the ORM has equivalent validation
    (Sequelize validations, Prisma schema-level checks; Drizzle has none — noted).
  - Prisma uses its Rust-free client with the `pg` adapter; an engine-based comparison
    would measure the wrong thing.
  - Numbers are machine-specific; the report embeds environment info, not absolute claims.

### Harness

Small custom runner (`benchmark/run.js`), no benchmark-framework dependency:

- `node benchmark/run.js --contender dbmr|sequelize|prisma|drizzle [--iterations N] [--runs 5]`
  runs one contender (used by the sequential driver).
- `node benchmark/run.js --all` spawns the four contenders sequentially, merges results,
  renders the report.
- Uses `performance.now()`, collects latency samples, computes percentiles.
- Exits non-zero if any scenario errors.

## Folder layout

```
benchmark/
  PLAN.md                  # this file
  schema.sql               # bench_items + bench_audit DDL
  seed.js                  # raw-SQL seeder (shared by all contenders)
  prisma/schema.prisma     # Prisma model(s); client generated to benchmark/prisma/generated/
  scenarios.js             # shared scenario definitions / payload factories
  bench-dbmr.js            # db-model-router contender
  bench-sequelize.js       # Sequelize contender
  bench-prisma.js          # Prisma contender
  bench-drizzle.js         # Drizzle contender
  run.js                   # harness: --contender one, --all sequential driver
  report.js                # renders self-contained HTML report
  reports/                 # OUTPUT — gitignored (benchmark/reports/*.html)
```

## HTML report

`benchmark/reports/postgres-<YYYYMMDD-HHmmss>.html`, fully self-contained (inline CSS +
inline SVG bar charts, zero external requests, works offline):

- Header: date, git SHA, Postgres version, Node version, OS/CPU summary, run order of
  the four contenders, sequential-execution note.
- Summary matrix: scenario × 4 contenders → mean/p50/p95/p99/throughput/ops-per-sec,
  winner per scenario, % delta vs the best.
- Per-scenario grouped bar charts (latency and throughput), one group per contender.
- Methodology + fairness notes from this plan; iteration counts per scenario class
  (1,000 for single-row ops) spelled out.
- `.gitignore` covers `benchmark/reports/` and `benchmark/*.html` — reports are never
  committed.

## Steps

1. Add devDependencies: `sequelize`, `prisma`, `@prisma/client`, `@prisma/adapter-pg`,
   `drizzle-orm` (pinned versions above). No runtime/peer dep changes.
2. Write `schema.sql`, seeder, `scenarios.js`.
3. Write `prisma/schema.prisma`; `prisma generate` (wired into setup script / `prebenchmark`).
4. Implement the four contender adapters against shared scenario keys.
5. Implement harness (`--contender` + sequential `--all` driver) + report generator.
6. `.gitignore` already covers `benchmark/reports/` and `benchmark/*.html`.
7. Add npm script: `"benchmark": "node benchmark/run.js --all --db postgres"`.
8. Run it, sanity-check output, iterate.

## Out of scope (v1)

- MySQL/MariaDB/SQLite/MSSQL/Oracle (folder structured so `--db mysql` etc. can be added later).
- HTTP/Express layer (this benchmarks the data layer, not route overhead).
- Parallel/concurrency stress testing (sequential-only by design; a separate contention
  phase could come later).
