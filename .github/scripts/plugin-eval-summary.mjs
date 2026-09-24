// Resumen Markdown del JSON de `claude plugin eval --json` para el step summary
// de plugin-eval.yml. Shape real (schemaVersion 1, Claude Code 2.1.28x):
// { costUsd, aggregates: { casesTotal, casesPassed, overallScore },
//   cases: [{ name, aggregates: { score, passRate }, arms: { with: [run], without?: [run] } }] }
// donde cada run trae { score, passed, turns, costUsd }.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("uso: node plugin-eval-summary.mjs <resultado.json>");
  process.exit(1);
}
const result = JSON.parse(readFileSync(path, "utf8"));
const cases = Array.isArray(result.cases) ? result.cases : [];
const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : "?");
const runsOf = (entry, arm) => (Array.isArray(entry.arms?.[arm]) ? entry.arms[arm] : []);
const meanScore = (runs) => (runs.length ? runs.reduce((acc, run) => acc + (run.score ?? 0), 0) / runs.length : undefined);
const hasBaseline = cases.some((entry) => runsOf(entry, "without").length > 0);

console.log("## Plugin Eval");
console.log("");
console.log(hasBaseline ? "| Caso | Score | Pasa | Runs | Sin plugin |" : "| Caso | Score | Pasa | Runs |");
console.log(hasBaseline ? "|---|---|---|---|---|" : "|---|---|---|---|");
for (const entry of cases) {
  const withRuns = runsOf(entry, "with");
  const score = typeof entry.aggregates?.score === "number" ? entry.aggregates.score : meanScore(withRuns);
  const passed = withRuns.filter((run) => run.passed).length;
  const row = [entry.name ?? "?", fmt(score), `${passed}/${withRuns.length}`, String(withRuns.length)];
  if (hasBaseline) row.push(fmt(meanScore(runsOf(entry, "without"))));
  console.log(`| ${row.join(" | ")} |`);
}
console.log("");
if (result.aggregates) {
  const a = result.aggregates;
  console.log(`Casos: ${a.casesPassed ?? "?"}/${a.casesTotal ?? cases.length} en verde · score global ${fmt(a.overallScore)}.`);
}
console.log(typeof result.costUsd === "number" ? `Costo total reportado: ${result.costUsd.toFixed(2)} USD.` : "Costo: no reportado en el JSON.");
if (result.partial) console.log("Corrida parcial: se alcanzó el techo de --max-cost-usd.");
