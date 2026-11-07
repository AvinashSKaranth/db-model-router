/**
 * Benchmark harness.
 *
 *   node benchmark/run.js --contender dbmr|sequelize|prisma|drizzle [--runs N]
 *   node benchmark/run.js --all            # sequential: each contender in its own process
 *   node benchmark/run.js                  # same as --all
 *
 * Contender processes apply schema.sql (drop+create) and seed 2000 rows before
 * measuring. Results are written to benchmark/reports/results-<name>.json.
 * --all then merges and renders the HTML report via report.js.
 * Sequential execution is intentional: contenders never compete for resources.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { performance } = require("perf_hooks");
const lib = require("./lib");
const SCENARIOS = require("./scenarios");

const ORDER = ["dbmr", "sequelize", "prisma", "drizzle"];
// Contenders whose process needs a loader (Prisma 7 emits TypeScript only).
const LOADER = { prisma: ["--import", "tsx"] };
const REPORTS_DIR = path.join(__dirname, "reports");

function parseArgs(argv) {
  const args = { runs: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--contender") args.contender = argv[++i];
    else if (a === "--runs") args.runs = parseInt(argv[++i], 10);
    else if (a === "--reverse") args.reverse = true;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node benchmark/run.js [--contender NAME] [--all] [--runs N] [--reverse]");
      process.exit(0);
    }
  }
  return args;
}

function envInfo(pgVersion) {
  let gitSha = "unknown";
  try { gitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.join(__dirname, "..") }).toString().trim(); } catch {}
  const cpus = require("os").cpus();
  return {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpuModel: cpus.length ? cpus[0].model : "unknown",
    cpuCount: cpus.length,
    totalMemGB: +(require("os").totalmem() / 1024 ** 3).toFixed(1),
    pgVersion,
    gitSha,
  };
}

async function runContender(name, runsOverride) {
  const contender = require(`./bench-${name}.js`);
  const pool = lib.createRawPool(10);
  console.log(`\n=== ${contender.label} (${name}) — sequential contender run ===`);
  await lib.applySchema(pool);
  console.log("schema applied (drop + create)");

  const { rows } = await pool.query("SELECT version() AS v");
  const pgVersion = rows[0].v.split(",")[0];

  const ctx = { pool, state: {}, seedIds: [] };
  await contender.setup(ctx);

  const results = { contender: name, label: contender.label, env: envInfo(pgVersion), scenarios: {} };

  for (const def of SCENARIOS) {
    const runScenario = contender.scenarios[def.key];
    if (!runScenario) throw new Error(`contender ${name} missing scenario ${def.key}`);
    const runs = runsOverride || def.runs;
    const iterations = def.iterations;
    const samples = [];
    let errors = 0;
    let lastResult;

    // Reset + warmup (untimed)
    ctx.seedIds = await lib.resetAndSeed(pool);
    const shorten = (e) => {
      const msg = e && Array.isArray(e.errors) && e.errors.length ? e.errors.map((x) => `${x.path}: ${x.message}`).join("; ") : (e && e.message) || String(e);
      return String(msg).replace(/\s+/g, " ").slice(0, 300);
    };
    for (let i = 0; i < def.warmup; i++) {
      try { await runScenario(ctx, i); } catch (e) { errors++; if (errors <= 2) console.error(`  warmup ${def.key}: ${shorten(e)}`); }
    }

    const t0Scenario = performance.now();
    for (let run = 0; run < runs; run++) {
      if (def.resetPerRun) {
        ctx.seedIds = await lib.resetAndSeed(pool);
        ctx.state.deleteCursor = 0;
      }
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        try {
          lastResult = await runScenario(ctx, i);
        } catch (e) {
          errors++;
          if (errors <= 3) console.error(`  ${def.key} iter ${i}: ${shorten(e)}`);
        }
        samples.push(performance.now() - start);
      }
      const dt = performance.now() - t0;
      console.log(`  ${def.key} run ${run + 1}/${runs}: ${iterations} ops in ${dt.toFixed(0)}ms (${(iterations / (dt / 1000)).toFixed(1)} ops/s)${errors ? ` errors=${errors}` : ""}`);
    }

    const stats = lib.summarize(samples);
    const totalOps = runs * iterations;
    const totalSeconds = samples.reduce((a, b) => a + b, 0) / 1000;
    // Correctness check hook (untimed)
    const hookIssue = contender.afterScenario ? contender.afterScenario(def.key, ctx, lastResult) : null;
    if (hookIssue) { errors++; console.error(`  ${def.key} correctness: ${hookIssue}`); }

    results.scenarios[def.key] = {
      label: def.label,
      iterations,
      runs,
      measuredOps: totalOps,
      meanMs: +stats.mean.toFixed(4),
      p50Ms: +stats.p50.toFixed(4),
      p95Ms: +stats.p95.toFixed(4),
      p99Ms: +stats.p99.toFixed(4),
      minMs: +stats.min.toFixed(4),
      maxMs: +stats.max.toFixed(4),
      throughputOpsPerSec: +(totalOps / totalSeconds).toFixed(1),
      errors,
    };
  }

  await contender.teardown();
  await pool.end();

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, `results-${name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`wrote ${outPath}`);
  return results;
}

function spawnContender(name, runs) {
  return new Promise((resolve, reject) => {
    const argv = [...(LOADER[name] || []), __filename, "--contender", name];
    if (runs) argv.push("--runs", String(runs));
    const child = spawn(process.execPath, argv, { stdio: "inherit", env: { ...process.env, __BENCH_LOADER: LOADER[name] ? "1" : process.env.__BENCH_LOADER } });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`contender ${name} exited with code ${code}`))));
  });
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.contender) {
    // Re-exec under the required loader if this process wasn't started with it.
    const loader = LOADER[args.contender];
    if (loader && !process.env.__BENCH_LOADER) {
      const argv = [...loader, __filename, "--contender", args.contender];
      if (args.runs) argv.push("--runs", String(args.runs));
      const child = spawn(process.execPath, argv, { stdio: "inherit", env: { ...process.env, __BENCH_LOADER: "1" } });
      child.on("exit", (code) => process.exit(code || 0));
      return;
    }
    await runContender(args.contender, args.runs);
    return;
  }
  let order = [...ORDER];
  if (args.reverse) order.reverse();
  console.log(`Sequential benchmark order: ${order.join(" -> ")}`);
  for (const name of order) {
    await spawnContender(name, args.runs);
    // Cooldown between contenders so pools/JIT settle before the next process.
    await new Promise((r) => setTimeout(r, 3000));
  }
  const { renderReport } = require("./report");
  const out = renderReport(REPORTS_DIR);
  console.log(`\nReport written to ${out}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
