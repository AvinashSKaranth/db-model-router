const SCEN = require("./scenarios");
const ORDER = ["dbmr", "sequelize", "prisma", "drizzle"];
const data = Object.fromEntries(ORDER.map((n) => [n, require("./reports/results-" + n + ".json").scenarios]));
console.log("scenario".padEnd(34), ORDER.map((n) => n.padStart(11)).join(""));
const wins = { dbmr: 0, sequelize: 0, prisma: 0, drizzle: 0 };
for (const s of SCEN) {
  const vals = ORDER.map((n) => data[n][s.key].meanMs);
  const best = Math.min(...vals);
  wins[ORDER[vals.indexOf(best)]]++;
  console.log(s.key.padEnd(34), vals.map((v) => (v < 100 ? v.toFixed(2) + "ms" : (v / 1000).toFixed(2) + "s").padStart(11)).join(""), " <- best", ORDER[vals.indexOf(best)]);
}
console.log("wins:", wins);
