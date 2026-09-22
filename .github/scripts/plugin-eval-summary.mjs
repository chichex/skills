// Resumen Markdown del JSON de `claude plugin eval --json` para el step summary
// de plugin-eval.yml. Tolerante al shape: busca casos y costo donde estén.
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("uso: node plugin-eval-summary.mjs <resultado.json>");
  process.exit(1);
}
const result = JSON.parse(readFileSync(path, "utf8"));
const cases = Array.isArray(result.cases) ? result.cases : [];

console.log("## Plugin Eval");
console.log("");
console.log("| Caso | Score | Runs |");
console.log("|---|---|---|");
for (const entry of cases) {
  const name = entry.name ?? entry.id ?? entry.case ?? "?";
  const score = typeof entry.score === "number" ? entry.score.toFixed(2) : (entry.score ?? "?");
  const runs = Array.isArray(entry.runs) ? entry.runs.length : (entry.runs ?? "?");
  console.log(`| ${name} | ${score} | ${runs} |`);
}
console.log("");
const costKeys = ["totalCostUsd", "total_cost_usd", "costUsd", "cost_usd", "cost"];
const findCost = (obj, depth = 0) => {
  if (!obj || typeof obj !== "object" || depth > 3) return undefined;
  for (const key of costKeys) if (typeof obj[key] === "number") return obj[key];
  for (const value of Object.values(obj)) {
    const found = findCost(value, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
};
const cost = findCost(result);
console.log(cost === undefined ? "Costo: no reportado en el JSON." : `Costo total reportado: ${cost.toFixed(2)} USD.`);
