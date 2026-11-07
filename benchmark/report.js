/**
 * Renders a self-contained HTML benchmark report from results-<name>.json files
 * in benchmark/reports/. Inline CSS + inline SVG only — no external requests.
 */
const fs = require("fs");
const path = require("path");
const SCENARIOS = require("./scenarios");

const CONTENDERS = [
  { key: "dbmr", label: "db-model-router", color: "#6366f1" },
  { key: "sequelize", label: "Sequelize", color: "#f59e0b" },
  { key: "prisma", label: "Prisma", color: "#22c55e" },
  { key: "drizzle", label: "Drizzle ORM", color: "#38bdf8" },
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtMs(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + " s";
  return ms.toFixed(2) + " ms";
}

function fmtOps(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k/s" : n.toFixed(1) + "/s";
}

function renderScenarioSection(def, results) {
  const entries = CONTENDERS.map((c) => ({ c, r: results[c.key]?.scenarios?.[def.key] })).filter((e) => e.r);
  if (entries.length === 0) return "";
  const maxP50 = Math.max(...entries.map((e) => e.r.p50Ms), 0.001);
  const maxTput = Math.max(...entries.map((e) => e.r.throughputOpsPerSec), 0.001);
  const bestMean = Math.min(...entries.map((e) => e.r.meanMs));

  const rows = entries
    .map(({ c, r }) => {
      const delta = bestMean > 0 ? ((r.meanMs - bestMean) / bestMean) * 100 : 0;
      const isWinner = r.meanMs === bestMean;
      return `<tr class="${isWinner ? "winner" : ""}">
        <td><span class="dot" style="background:${c.color}"></span>${esc(c.label)}${isWinner ? " 🏆" : ""}</td>
        <td>${fmtMs(r.meanMs)}</td><td>${fmtMs(r.p50Ms)}</td><td>${fmtMs(r.p95Ms)}</td><td>${fmtMs(r.p99Ms)}</td>
        <td>${fmtOps(r.throughputOpsPerSec)}</td>
        <td>${delta === 0 ? "—" : "+" + delta.toFixed(1) + "%"}</td>
        <td>${r.errors || 0}</td>
      </tr>`;
    })
    .join("\n");

  const bar = (value, max, color) => {
    const w = Math.max(2, (value / max) * 220);
    return `<svg width="230" height="14" viewBox="0 0 230 14"><rect x="0" y="2" width="${w.toFixed(1)}" height="10" rx="2" fill="${color}"/></svg>`;
  };

  const latencyBars = entries
    .map(({ c, r }) => `<div class="bar-row"><span class="bar-label">${esc(c.label)}</span>${bar(r.p50Ms, maxP50, c.color)}<span class="bar-value">${fmtMs(r.p50Ms)}</span></div>`)
    .join("\n");
  const tputBars = entries
    .map(({ c, r }) => `<div class="bar-row"><span class="bar-label">${esc(c.label)}</span>${bar(r.throughputOpsPerSec, maxTput, c.color)}<span class="bar-value">${fmtOps(r.throughputOpsPerSec)}</span></div>`)
    .join("\n");

  return `<section class="card">
  <h3>${esc(def.label)} <span class="iters">${def.iterations.toLocaleString()} ops × ${def.runs} runs</span></h3>
  <div class="charts">
    <div><h4>p50 latency (lower is better)</h4>${latencyBars}</div>
    <div><h4>Throughput (higher is better)</h4>${tputBars}</div>
  </div>
  <table>
    <thead><tr><th>Contender</th><th>mean</th><th>p50</th><th>p95</th><th>p99</th><th>throughput</th><th>Δ vs best</th><th>errors</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderReport(reportsDir, outPath) {
  const results = {};
  for (const c of CONTENDERS) {
    const p = path.join(reportsDir, `results-${c.key}.json`);
    if (fs.existsSync(p)) results[c.key] = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const found = Object.keys(results);
  if (found.length === 0) throw new Error("no results-*.json found in " + reportsDir);

  const anyEnv = results[found[0]].env;
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fileTs = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;

  // win count per contender
  const wins = Object.fromEntries(CONTENDERS.map((c) => [c.key, 0]));
  for (const def of SCENARIOS) {
    let best = Infinity, bestKey = null;
    for (const c of CONTENDERS) {
      const r = results[c.key]?.scenarios?.[def.key];
      if (r && r.meanMs < best) { best = r.meanMs; bestKey = c.key; }
    }
    if (bestKey) wins[bestKey]++;
  }

  const summaryRows = CONTENDERS.filter((c) => results[c.key])
    .map((c) => `<tr><td><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</td><td>${wins[c.key]} / ${SCENARIOS.length}</td></tr>`)
    .join("\n");

  const sections = SCENARIOS.map((def) => renderScenarioSection(def, results)).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>db-model-router vs ORMs — PostgreSQL Benchmark ${fileTs}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; }
  header { padding: 2rem 2.5rem 1rem; border-bottom: 1px solid #1e293b; }
  h1 { margin: 0 0 .25rem; font-size: 1.6rem; }
  h2 { margin: 1.5rem 0 .75rem; font-size: 1.15rem; color: #93c5fd; }
  h3 { margin: 0 0 .75rem; font-size: 1.05rem; }
  h4 { margin: .25rem 0 .4rem; font-size: .8rem; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
  .sub { color: #94a3b8; font-size: .9rem; }
  main { padding: 1.5rem 2.5rem 3rem; max-width: 1200px; }
  .card { background: #111c34; border: 1px solid #1e293b; border-radius: 12px; padding: 1.1rem 1.25rem; margin-bottom: 1.25rem; }
  .iters { color: #64748b; font-size: .75rem; font-weight: 400; margin-left: .5rem; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; margin-top: .5rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #1e293b; }
  th { color: #94a3b8; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
  tr.winner td { color: #a5f3fc; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: .45rem; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: .5rem; }
  @media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
  .bar-row { display: flex; align-items: center; gap: .5rem; margin: .15rem 0; }
  .bar-label { width: 110px; font-size: .78rem; color: #cbd5e1; text-align: right; }
  .bar-value { font-size: .75rem; color: #94a3b8; font-variant-numeric: tabular-nums; }
  .env-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .4rem 1.5rem; font-size: .82rem; }
  .env-grid div { padding: .15rem 0; border-bottom: 1px dotted #1e293b; }
  .env-grid b { color: #94a3b8; font-weight: 600; }
  ul.notes { font-size: .82rem; color: #cbd5e1; line-height: 1.5; }
  code { background: #1e293b; padding: .1rem .35rem; border-radius: 4px; font-size: .8rem; }
</style>
</head>
<body>
<header>
  <h1>db-model-router vs ORMs — PostgreSQL Benchmark</h1>
  <div class="sub">Generated ${esc(anyEnv.date)} · git ${esc(anyEnv.gitSha)} · sequential contender execution (one process at a time, fixed order)</div>
</header>
<main>
  <section class="card">
    <h2>Environment</h2>
    <div class="env-grid">
      <div><b>PostgreSQL</b><br>${esc(anyEnv.pgVersion)}</div>
      <div><b>Node.js</b><br>${esc(anyEnv.node)}</div>
      <div><b>Platform</b><br>${esc(anyEnv.platform)}</div>
      <div><b>CPU</b><br>${esc(anyEnv.cpuModel)} × ${anyEnv.cpuCount}</div>
      <div><b>Memory</b><br>${anyEnv.totalMemGB} GB</div>
      <div><b>Git commit</b><br>${esc(anyEnv.gitSha)}</div>
    </div>
  </section>

  <section class="card">
    <h2>Scoreboard — scenarios won (by mean latency)</h2>
    <table><thead><tr><th>Contender</th><th>Wins</th></tr></thead><tbody>${summaryRows}</tbody></table>
    <p class="sub">Missing results (contender not run or failed) are simply omitted from the tables below.</p>
  </section>

  <h2>Scenarios</h2>
  ${sections}

  <section class="card">
    <h2>Methodology &amp; fairness notes</h2>
    <ul class="notes">
      <li>All four contenders ran <b>sequentially in separate Node processes</b>, never concurrently; each applied the schema fresh (drop + create) and reseeded 2,000 identical rows from raw SQL before measuring.</li>
      <li>Single-row scenarios (insert, read, update, upsert, delete, JSONB round-trip): <b>1,000 measured iterations × 5 runs</b>. Bulk/tx scenarios: reduced iteration counts as labeled per scenario. Warmup excluded from timing.</li>
      <li>Latency measured with <code>performance.now()</code> around each individual operation; p50/p95/p99 via nearest-rank percentile over all samples; throughput = total ops ÷ total sample time.</li>
      <li>Everyone shares the same <code>pg</code> driver and a pool of <b>max 10</b> connections.</li>
      <li><b>db-model-router</b> <code>insert()</code>/<code>update()</code>/<code>upsert()</code> re-SELECT the row after writing to return the full record (inside <code>update</code> the library also uses an UPSERT under the hood), and its <code>find()</code> has no <code>LIMIT</code> — the “filter + sort + limit 20” scenario uses <code>list()</code> for it. Measured as-is: this is the library's real cost.</li>
      <li><b>Sequelize</b> <code>create()</code>/<code>upsert()</code> do not re-SELECT. Validations enabled (parity with db-model-router's validation layer).</li>
      <li><b>Prisma 7</b> uses the Rust-free client with <code>@prisma/adapter-pg</code>. <code>createMany()</code> does not return rows (idiomatic Prisma).</li>
      <li><b>Drizzle</b> has no validation layer (SQL-first thin ORM). <code>price</code> is passed as a string to match <code>numeric</code> semantics.</li>
      <li>JSONB <code>meta</code> is written and read back in all contenders. Transaction scenarios wrap insert + update + audit-insert; the rollback scenario forces a throw and expects no partial writes.</li>
      <li>Numbers are machine-specific — compare contenders against each other on the same machine, not against absolute targets.</li>
    </ul>
  </section>
</main>
</body>
</html>`;

  const out = outPath || path.join(reportsDir, `postgres-${fileTs}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const docsOut = path.join(__dirname, "..", "docs", "benchmark", "index.html");
  if (fs.existsSync(path.dirname(docsOut))) {
    try {
      fs.writeFileSync(docsOut, html);
    } catch (_) {}
  }
  return out;
}

module.exports = { renderReport };

if (require.main === module) {
  // Usage: node benchmark/report.js [--out <path>]   (default: timestamped file in benchmark/reports/)
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const outPath = outIdx !== -1 ? path.resolve(argv[outIdx + 1]) : undefined;
  if (outIdx !== -1 && !argv[outIdx + 1]) {
    console.error("--out requires a path, e.g. node benchmark/report.js --out docs/benchmark.html");
    process.exit(1);
  }
  try {
    const out = renderReport(path.join(__dirname, "reports"), outPath);
    console.log("Report written to", out);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
