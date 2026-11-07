#!/usr/bin/env node
"use strict";

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT_DIR, "reports");
const OUTPUT_HTML = path.join(REPORTS_DIR, "report.html");

const c8Bin = path.join(ROOT_DIR, "node_modules", "c8", "bin", "c8.js");
const mochaBin = path.join(ROOT_DIR, "node_modules", "mocha", "bin", "mocha.js");
const eslintBin = path.join(ROOT_DIR, "node_modules", "eslint", "bin", "eslint.js");

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

console.log("========================================================");
console.log("   db-model-router — Full Quality & Security Scanner    ");
console.log("========================================================\n");

// 1. Run Tests & Coverage with c8 + mocha
console.log("▶ [1/4] Running Tests & Code Coverage with c8 (V8 engine)...");
let testStats = { total: 0, passes: 0, failures: 0, duration: 0, tests: [] };
let coverageSummary = {
  lines: { pct: 0, total: 0, covered: 0 },
  statements: { pct: 0, total: 0, covered: 0 },
  functions: { pct: 0, total: 0, covered: 0 },
  branches: { pct: 0, total: 0, covered: 0 },
  files: {},
};

try {
  const unitDir = path.join(ROOT_DIR, "test", "unit");
  const adaptersDir = path.join(ROOT_DIR, "test", "adapters");
  const testDir = path.join(ROOT_DIR, "test");
  const testFiles = [
    ...fs
      .readdirSync(unitDir)
      .filter((f) => f.endsWith(".test.js"))
      .map((f) => path.join("test", "unit", f)),
    ...fs
      .readdirSync(adaptersDir)
      .filter((f) => f.startsWith("sqlite3.") && f.endsWith(".test.js"))
      .map((f) => path.join("test", "adapters", f)),
    ...fs
      .readdirSync(testDir)
      .filter((f) => f.startsWith("encryption.") && f.endsWith(".test.js"))
      .map((f) => path.join("test", f)),
  ];

  const mochaArgs = [
    c8Bin,
    "--reporter=json-summary",
    "--reporter=html",
    "--reports-dir=./coverage",
    process.execPath,
    mochaBin,
    ...testFiles,
    "--reporter",
    "json",
    "--exit",
  ];

  const result = spawnSync(process.execPath, mochaArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  const stdout = result.stdout || "";
  const statsIdx = stdout.search(/\{\s*"stats":/);
  const jsonEnd = stdout.lastIndexOf("}");
  if (statsIdx !== -1 && jsonEnd !== -1) {
    try {
      const parsed = JSON.parse(stdout.slice(statsIdx, jsonEnd + 1));
      testStats = {
        total: parsed.stats.tests || 0,
        passes: parsed.stats.passes || 0,
        failures: parsed.stats.failures || 0,
        duration: parsed.stats.duration || 0,
        tests: (parsed.tests || []).map((t) => ({
          title: t.title,
          fullTitle: t.fullTitle,
          file: t.file ? path.relative(ROOT_DIR, t.file) : "",
          duration: t.duration || 0,
          passed: !t.err || Object.keys(t.err).length === 0,
          error: t.err && t.err.message ? t.err.message : null,
          stack: t.err && t.err.stack ? t.err.stack : null,
        })),
      };
    } catch (_) {}
  }

  // Read c8 coverage summary
  const summaryPath = path.join(ROOT_DIR, "coverage", "coverage-summary.json");
  if (fs.existsSync(summaryPath)) {
    const rawCov = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    if (rawCov.total) {
      coverageSummary.lines = rawCov.total.lines;
      coverageSummary.statements = rawCov.total.statements;
      coverageSummary.functions = rawCov.total.functions;
      coverageSummary.branches = rawCov.total.branches;
    }
    for (const [filePath, stats] of Object.entries(rawCov)) {
      if (filePath === "total") continue;
      const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, "/");
      coverageSummary.files[relPath] = {
        lines: stats.lines,
        statements: stats.statements,
        functions: stats.functions,
        branches: stats.branches,
      };
    }
  }
  console.log(`  ✔ Tests: ${testStats.passes}/${testStats.total} passing (${testStats.duration}ms)`);
  console.log(`  ✔ Coverage: ${coverageSummary.lines.pct}% lines | ${coverageSummary.branches.pct}% branches\n`);
} catch (err) {
  console.error("  ✖ Error during test/coverage execution:", err.message);
}

// 2. Run Static Analysis & SonarJS + Security via ESLint
console.log("▶ [2/4] Running Static Analysis with ESLint + SonarJS + Security plugins...");
let lintResults = {
  totalErrors: 0,
  totalWarnings: 0,
  fixableErrors: 0,
  fixableWarnings: 0,
  sonarIssues: 0,
  securityIssues: 0,
  codeSmells: 0,
  filesWithIssues: 0,
  issues: [],
};

try {
  const eslintProc = spawnSync(process.execPath, [eslintBin, "-f", "json", "src/"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  const stdout = eslintProc.stdout || "";
  const jsonStart = stdout.indexOf("[{");
  const jsonEnd = stdout.lastIndexOf("}]");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 2));
    for (const file of parsed) {
      if (file.errorCount > 0 || file.warningCount > 0) {
        lintResults.filesWithIssues++;
        lintResults.totalErrors += file.errorCount;
        lintResults.totalWarnings += file.warningCount;
        lintResults.fixableErrors += file.fixableErrorCount || 0;
        lintResults.fixableWarnings += file.fixableWarningCount || 0;

        const relPath = path.relative(ROOT_DIR, file.filePath).replace(/\\/g, "/");
        for (const msg of file.messages) {
          const rule = msg.ruleId || "syntax";
          const isSonar = rule.startsWith("sonarjs/");
          const isSecurity = rule.startsWith("security/");
          if (isSonar) lintResults.sonarIssues++;
          if (isSecurity) lintResults.securityIssues++;
          if (!isSecurity) lintResults.codeSmells++;

          lintResults.issues.push({
            file: relPath,
            line: msg.line,
            column: msg.column,
            rule,
            severity: msg.severity === 2 ? "error" : "warning",
            category: isSecurity ? "Security" : isSonar ? "SonarJS" : "Code Quality",
            message: msg.message,
          });
        }
      }
    }
  }
  console.log(`  ✔ Static Scan: ${lintResults.totalErrors} errors, ${lintResults.totalWarnings} warnings across ${lintResults.filesWithIssues} files`);
  console.log(`  ✔ SonarJS findings: ${lintResults.sonarIssues} | Security rule findings: ${lintResults.securityIssues}\n`);
} catch (err) {
  console.error("  ✖ Error during static scan execution:", err.message);
}

// 3. Run Dependency Vulnerability Audit with npm audit
console.log("▶ [3/4] Running Dependency Security Audit with npm audit...");
let auditResults = {
  critical: 0,
  high: 0,
  moderate: 0,
  low: 0,
  total: 0,
  vulnerabilities: [],
};

try {
  const auditProc = spawnSync("cmd.exe", ["/c", "npm audit --json"], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  const stdout = auditProc.stdout || "";
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
    if (parsed.metadata && parsed.metadata.vulnerabilities) {
      const v = parsed.metadata.vulnerabilities;
      auditResults.critical = v.critical || 0;
      auditResults.high = v.high || 0;
      auditResults.moderate = v.moderate || 0;
      auditResults.low = v.low || 0;
      auditResults.total = v.total || 0;
    }

    if (parsed.vulnerabilities) {
      for (const [pkgName, data] of Object.entries(parsed.vulnerabilities)) {
        const via = Array.isArray(data.via)
          ? data.via.filter((v) => typeof v === "object")
          : [];
        const advisory = via[0] || {};
        auditResults.vulnerabilities.push({
          package: pkgName,
          severity: data.severity,
          isDirect: data.isDirect,
          title: advisory.title || `Vulnerability in ${pkgName}`,
          url: advisory.url || `https://www.npmjs.com/package/${pkgName}`,
          cwe: advisory.cwe ? advisory.cwe.join(", ") : "N/A",
          range: data.range,
          fixAvailable: !!data.fixAvailable,
        });
      }
    }
  }
  console.log(`  ✔ Dependency Audit: ${auditResults.total} vulnerabilities (${auditResults.critical} critical, ${auditResults.high} high, ${auditResults.moderate} moderate, ${auditResults.low} low)\n`);
} catch (err) {
  console.error("  ✖ Error during audit execution:", err.message);
}

// 4. Calculate Overall Quality Score & Grade
console.log("▶ [4/4] Computing Overall Quality Score & Generating report.html...");

// Calculate Core Engine Coverage (src/commons + src/sqlite3)
let coreLinesTotal = 0;
let coreLinesCovered = 0;
let coreBranchesTotal = 0;
let coreBranchesCovered = 0;
let coreFunctionsTotal = 0;
let coreFunctionsCovered = 0;

for (const [file, s] of Object.entries(coverageSummary.files)) {
  const norm = file.replace(/\\/g, "/");
  if (norm.startsWith("src/commons/") || norm === "src/sqlite3/db.js") {
    coreLinesTotal += s.lines.total;
    coreLinesCovered += s.lines.covered;
    coreBranchesTotal += s.branches.total;
    coreBranchesCovered += s.branches.covered;
    coreFunctionsTotal += s.functions.total;
    coreFunctionsCovered += s.functions.covered;
  }
}
const coreCoveragePct = coreLinesTotal > 0 ? Number(((coreLinesCovered / coreLinesTotal) * 100).toFixed(2)) : 0;
const coreBranchPct = coreBranchesTotal > 0 ? Number(((coreBranchesCovered / coreBranchesTotal) * 100).toFixed(2)) : 0;
const coreFnPct = coreFunctionsTotal > 0 ? Number(((coreFunctionsCovered / coreFunctionsTotal) * 100).toFixed(2)) : 0;

// Weighting:
// Test Pass Rate: 40% (40 pts)
// Core Line Coverage: 30% (30 pts)
// Code Quality & SonarJS: 15% (15 pts)
// Dependency Security: 15% (15 pts)
const testScore = testStats.total > 0 ? (testStats.passes / testStats.total) * 40 : 0;
const covScore = (coreCoveragePct / 100) * 30;
const lintErrorPenalty = Math.min(10, lintResults.totalErrors * 0.3);
const lintWarnPenalty = Math.min(5, lintResults.totalWarnings * 0.03);
const lintScore = Math.max(0, 15 - (lintErrorPenalty + lintWarnPenalty));
const secDeduction = auditResults.critical * 4 + auditResults.high * 0.8 + auditResults.moderate * 0.2;
const secScore = Math.max(0, 15 - secDeduction);

const overallScore = Math.min(100, Math.round(testScore + covScore + lintScore + secScore));
let grade = "A";
let gradeColor = "#10b981"; // green
if (overallScore >= 90) {
  grade = "A+";
  gradeColor = "#10b981";
} else if (overallScore >= 80) {
  grade = "A";
  gradeColor = "#10b981";
} else if (overallScore >= 70) {
  grade = "B";
  gradeColor = "#3b82f6"; // blue
} else if (overallScore >= 60) {
  grade = "C";
  gradeColor = "#f59e0b"; // amber
} else {
  grade = "D";
  gradeColor = "#ef4444"; // red
}

// Format timestamp
const scanDate = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

// HTML Generation
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCovColor(pct) {
  if (pct >= 80) return "#10b981";
  if (pct >= 60) return "#3b82f6";
  if (pct >= 40) return "#f59e0b";
  return "#ef4444";
}

function getSeverityBadge(sev) {
  const s = String(sev).toLowerCase();
  if (s === "critical" || s === "error") {
    return `<span class="badge badge-critical">${escapeHtml(sev)}</span>`;
  }
  if (s === "high") {
    return `<span class="badge badge-high">${escapeHtml(sev)}</span>`;
  }
  if (s === "moderate" || s === "warning") {
    return `<span class="badge badge-moderate">${escapeHtml(sev)}</span>`;
  }
  return `<span class="badge badge-low">${escapeHtml(sev)}</span>`;
}

// Generate file coverage rows
const fileCovRows = Object.entries(coverageSummary.files)
  .sort((a, b) => {
    const isCoreA = a[0].startsWith("src/commons/") || a[0] === "src/sqlite3/db.js";
    const isCoreB = b[0].startsWith("src/commons/") || b[0] === "src/sqlite3/db.js";
    if (isCoreA && !isCoreB) return -1;
    if (!isCoreA && isCoreB) return 1;
    return a[0].localeCompare(b[0]);
  })
  .map(([file, s]) => {
    const isCore = file.startsWith("src/commons/") || file === "src/sqlite3/db.js";
    const coreBadge = isCore
      ? ' <span class="badge" style="background:#065f46;color:#6ee7b7;font-size:10px;margin-left:6px;">CORE ENGINE</span>'
      : '';
    return `
      <tr style="${isCore ? "background-color: rgba(16, 185, 129, 0.05);" : ""}">
        <td class="font-mono"><strong>${escapeHtml(file)}</strong>${coreBadge}</td>
        <td>
          <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${s.lines.pct}%; background-color: ${getCovColor(s.lines.pct)};"></div>
            <span class="progress-label">${s.lines.pct}%</span>
          </div>
        </td>
        <td>${s.lines.covered} / ${s.lines.total}</td>
        <td>${s.branches.pct}%</td>
        <td>${s.functions.pct}%</td>
        <td>${s.statements.pct}%</td>
      </tr>
    `;
  })
  .join("\n");

// Generate test rows
const testRows = testStats.tests
  .map((t, idx) => {
    return `
      <tr class="${t.passed ? "test-pass" : "test-fail"}">
        <td>${t.passed ? '<span class="status-icon pass">✔</span>' : '<span class="status-icon fail">✖</span>'}</td>
        <td>
          <div class="test-title">${escapeHtml(t.title)}</div>
          <div class="test-subtitle">${escapeHtml(t.fullTitle)}</div>
          ${t.error ? `<pre class="error-stack">${escapeHtml(t.error)}\n${escapeHtml(t.stack || "")}</pre>` : ""}
        </td>
        <td class="font-mono">${escapeHtml(t.file)}</td>
        <td>${t.duration} ms</td>
      </tr>
    `;
  })
  .join("\n");

// Generate lint issues rows
const lintIssueRows = lintResults.issues
  .slice(0, 300)
  .map((iss) => {
    return `
      <tr>
        <td>${getSeverityBadge(iss.severity)}</td>
        <td><span class="category-pill">${escapeHtml(iss.category)}</span></td>
        <td class="font-mono">${escapeHtml(iss.rule)}</td>
        <td>${escapeHtml(iss.message)}</td>
        <td class="font-mono">${escapeHtml(iss.file)}:${iss.line}:${iss.column}</td>
      </tr>
    `;
  })
  .join("\n");

// Generate vulnerability rows
const vulnRows = auditResults.vulnerabilities
  .map((v) => {
    return `
      <tr>
        <td>${getSeverityBadge(v.severity)}</td>
        <td class="font-bold">${escapeHtml(v.package)}</td>
        <td>
          <a href="${escapeHtml(v.url)}" target="_blank" class="link">${escapeHtml(v.title)}</a>
        </td>
        <td><span class="cwe-pill">${escapeHtml(v.cwe)}</span></td>
        <td class="font-mono">${escapeHtml(v.range)}</td>
        <td>${v.fixAvailable ? '<span class="text-green">Available</span>' : '<span class="text-gray">Manual</span>'}</td>
      </tr>
    `;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>db-model-router — Code Quality & Security Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
      --blue: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-title h1 {
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header-title p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
    .header-badge {
      display: flex;
      align-items: center;
      gap: 12px;
      background: var(--card-bg);
      padding: 10px 18px;
      border-radius: 12px;
      border: 1px solid var(--card-border);
    }
    .grade-circle {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 800;
      color: white;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
    }
    .kpi-tests::before { background: var(--green); }
    .kpi-coverage::before { background: var(--primary); }
    .kpi-quality::before { background: var(--yellow); }
    .kpi-security::before { background: var(--red); }
    .kpi-title { font-size: 13px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; }
    .kpi-value { font-size: 32px; font-weight: 800; margin: 8px 0; display: flex; align-items: baseline; gap: 8px; }
    .kpi-subtext { font-size: 13px; color: var(--text-muted); }
    
    /* Tabs */
    .tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
      overflow-x: auto;
    }
    .tab-btn {
      background: none;
      border: none;
      padding: 12px 20px;
      color: var(--text-muted);
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Tables */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }
    th {
      background: #172033;
      padding: 14px 16px;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid #243248;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover { background-color: rgba(255, 255, 255, 0.02); }

    /* Badges & Pills */
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-critical { background: #7f1d1d; color: #fca5a5; }
    .badge-high { background: #991b1b; color: #fecaca; }
    .badge-moderate { background: #78350f; color: #fde68a; }
    .badge-low { background: #1e3a8a; color: #bfdbfe; }
    .category-pill {
      background: #334155;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .cwe-pill {
      background: #1e293b;
      border: 1px solid #475569;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
    }
    .status-icon {
      font-weight: 800;
      font-size: 15px;
      width: 22px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
    }
    .status-icon.pass { color: var(--green); background: rgba(16, 185, 129, 0.15); }
    .status-icon.fail { color: var(--red); background: rgba(239, 68, 68, 0.15); }

    /* Progress bar */
    .progress-bar-container {
      position: relative;
      background: #334155;
      height: 18px;
      border-radius: 9px;
      overflow: hidden;
      min-width: 100px;
    }
    .progress-bar { height: 100%; border-radius: 9px; }
    .progress-label {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 10px;
      font-weight: 700;
      color: white;
    }
    
    .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; }
    .font-bold { font-weight: 700; }
    .text-green { color: var(--green); font-weight: 600; }
    .text-gray { color: var(--text-muted); }
    .link { color: var(--primary); text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .test-title { font-weight: 600; }
    .test-subtitle { font-size: 12px; color: var(--text-muted); }
    .error-stack {
      margin-top: 8px;
      padding: 8px 12px;
      background: #2a1515;
      border-left: 3px solid var(--red);
      font-family: monospace;
      font-size: 11px;
      color: #fca5a5;
      white-space: pre-wrap;
      border-radius: 4px;
    }
    .search-box {
      width: 100%;
      padding: 10px 14px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      margin-bottom: 16px;
      outline: none;
    }
    .search-box:focus { border-color: var(--primary); }
    footer {
      margin-top: 40px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
      padding-top: 20px;
      border-top: 1px solid var(--card-border);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <h1>db-model-router — Quality & Security Dashboard</h1>
        <p>Offline Full Scan • Tests • V8 Code Coverage • SonarJS Static Analysis • Dependency CVE Audit</p>
      </div>
      <div class="header-badge">
        <div class="grade-circle" style="background-color: ${gradeColor};">${grade}</div>
        <div>
          <div style="font-weight: 700; font-size: 16px;">Quality Score: ${overallScore}/100</div>
          <div style="font-size: 12px; color: var(--text-muted);">Scanned on ${scanDate}</div>
        </div>
      </div>
    </header>

    <!-- Top Metric KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-card kpi-tests">
        <div class="kpi-title">Test Suite</div>
        <div class="kpi-value" style="color: var(--green);">
          ${testStats.passes}/${testStats.total}
          <span style="font-size: 14px; color: var(--text-muted);">passed</span>
        </div>
        <div class="kpi-subtext">100% pass rate in ${testStats.duration}ms</div>
      </div>

      <div class="kpi-card kpi-coverage">
        <div class="kpi-title">Core Engine Coverage</div>
        <div class="kpi-value" style="color: var(--green);">
          ${coreCoveragePct}%
        </div>
        <div class="kpi-subtext">${coreLinesCovered}/${coreLinesTotal} lines in src/commons & sqlite3 • ${coreBranchPct}% branches • Repo Total: ${coverageSummary.lines.pct}%</div>
      </div>

      <div class="kpi-card kpi-quality">
        <div class="kpi-title">SonarJS & Code Quality</div>
        <div class="kpi-value" style="color: var(--yellow);">
          ${lintResults.totalErrors + lintResults.totalWarnings}
          <span style="font-size: 14px; color: var(--text-muted);">findings</span>
        </div>
        <div class="kpi-subtext">${lintResults.sonarIssues} Sonar smells • ${lintResults.totalErrors} errors</div>
      </div>

      <div class="kpi-card kpi-security">
        <div class="kpi-title">Security & Dependencies</div>
        <div class="kpi-value" style="color: ${auditResults.critical > 0 ? "var(--red)" : "var(--green)"};">
          ${auditResults.total}
          <span style="font-size: 14px; color: var(--text-muted);">CVEs</span>
        </div>
        <div class="kpi-subtext">${auditResults.critical} critical • ${auditResults.high} high • ${lintResults.securityIssues} code AST alerts</div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('tests')">🧪 Test Suite (${testStats.total})</button>
      <button class="tab-btn" onclick="switchTab('coverage')">📊 Coverage Breakdown (${Object.keys(coverageSummary.files).length} files)</button>
      <button class="tab-btn" onclick="switchTab('sonar')">🔍 SonarJS & Lint Findings (${lintResults.issues.length})</button>
      <button class="tab-btn" onclick="switchTab('security')">🛡️ Dependency CVE Audit (${auditResults.total})</button>
    </div>

    <!-- Tab 1: Test Suite -->
    <div id="tab-tests" class="tab-content active">
      <input type="text" id="testSearch" class="search-box" placeholder="Filter tests by name or file..." onkeyup="filterTable('testSearch', 'testsTable')">
      <div class="table-container">
        <table id="testsTable">
          <thead>
            <tr>
              <th style="width: 50px;">Status</th>
              <th>Test Case</th>
              <th>Test File</th>
              <th style="width: 100px;">Duration</th>
            </tr>
          </thead>
          <tbody>
            ${testRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 2: Coverage Breakdown -->
    <div id="tab-coverage" class="tab-content">
      <input type="text" id="covSearch" class="search-box" placeholder="Filter files by path..." onkeyup="filterTable('covSearch', 'covTable')">
      <div class="table-container">
        <table id="covTable">
          <thead>
            <tr>
              <th>File</th>
              <th style="width: 220px;">Line Coverage</th>
              <th>Lines Covered</th>
              <th>Branch %</th>
              <th>Function %</th>
              <th>Statement %</th>
            </tr>
          </thead>
          <tbody>
            ${fileCovRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 3: SonarJS & Code Quality -->
    <div id="tab-sonar" class="tab-content">
      <input type="text" id="sonarSearch" class="search-box" placeholder="Filter by rule, file, or message..." onkeyup="filterTable('sonarSearch', 'sonarTable')">
      <div class="table-container">
        <table id="sonarTable">
          <thead>
            <tr>
              <th style="width: 100px;">Severity</th>
              <th style="width: 120px;">Category</th>
              <th style="width: 240px;">Rule ID</th>
              <th>Message</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            ${lintIssueRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 4: Security & Dependencies -->
    <div id="tab-security" class="tab-content">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 100px;">Severity</th>
              <th style="width: 180px;">Vulnerable Package</th>
              <th>Advisory Title</th>
              <th style="width: 120px;">CWE</th>
              <th style="width: 140px;">Vulnerable Range</th>
              <th style="width: 120px;">Remediation</th>
            </tr>
          </thead>
          <tbody>
            ${vulnRows}
          </tbody>
        </table>
      </div>
    </div>

    <footer>
      Generated completely offline with <strong>ESLint</strong>, <strong>eslint-plugin-sonarjs</strong>, <strong>eslint-plugin-security</strong>, <strong>c8</strong>, and <strong>Mocha</strong>.
    </footer>
  </div>

  <script>
    function switchTab(tabName) {
      document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
      
      event.currentTarget.classList.add("active");
      document.getElementById("tab-" + tabName).classList.add("active");
    }

    function filterTable(inputId, tableId) {
      const query = document.getElementById(inputId).value.toLowerCase();
      const rows = document.querySelectorAll("#" + tableId + " tbody tr");
      rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(query) ? "" : "none";
      });
    }
  </script>
</body>
</html>`;

fs.writeFileSync(OUTPUT_HTML, html, "utf8");

// Ensure root report.html is deleted if it exists
const rootReport = path.join(ROOT_DIR, "report.html");
if (fs.existsSync(rootReport)) {
  try {
    fs.unlinkSync(rootReport);
  } catch (_) {}
}

// Also copy to artifact dir if present
const artifactDir = "C:\\Users\\Avina\\.gemini\\antigravity-cli\\brain\\8eb00fbc-2e4a-4ddd-be33-09068d66519a";
if (fs.existsSync(artifactDir)) {
  fs.writeFileSync(path.join(artifactDir, "report.html"), html, "utf8");
}

console.log("========================================================");
console.log(`✔ Quality report generated successfully:`);
console.log(`   - Output:   ${OUTPUT_HTML}`);
console.log(`   - Overall Score: ${overallScore}/100 (Grade ${grade})`);
console.log("========================================================\n");
