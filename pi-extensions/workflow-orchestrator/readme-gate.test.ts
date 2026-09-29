import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readmeCases = [
	{
		path: "../../README.md",
		patterns: [
			/\*\*`workflow-orchestrator`\*\*/,
			/`\/issues`[\s\S]*`\/grills`[\s\S]*`\/specs`[\s\S]*`\/sdd-run`/,
			/grill.*spec.*misma sesi[oó]n/is,
			/spec.*run.*sesi[oó]n hija/is,
			/cross-project|otro proyecto/i,
			/autorizaci[oó]n expl[ií]cita/i,
			/post-switch/i,
			/`\.\/install\.sh pi`[\s\S]*`\/reload`/,
			/sesiones ya abiertas.*no reciben/i,
			/encontrar una spec.*no.*ejecut/i,
			/no.*merge/i,
			/provider local\/falso|provider local o falso/i,
			/`\/grills`[\s\S]*snapshots[\s\S]*handoffs[\s\S]*`\.sdd\/grills\/`/i,
			/proyecto actual[\s\S]*proyectos conocidos[\s\S]*sin (?:recorrer|escanear).*disco/i,
			/handoff pausado[\s\S]*importa[\s\S]*Retomar/i,
			/ruta hist[oó]rica[\s\S]*advertencia/i,
			/handoff finalizado[\s\S]*ruta absoluta[\s\S]*`sdd-spec --from-grill/i,
		],
	},
	{
		path: "../../README.en.md",
		patterns: [
			/\*\*`workflow-orchestrator`\*\*/,
			/`\/issues`[\s\S]*`\/grills`[\s\S]*`\/specs`[\s\S]*`\/sdd-run`/,
			/grill.*spec.*same session/is,
			/spec.*run.*child session/is,
			/cross-project|another project/i,
			/explicit authorization/i,
			/post-switch/i,
			/`\.\/install\.sh pi`[\s\S]*`\/reload`/,
			/already-open sessions.*do not receive/i,
			/finding a spec.*does not.*run/i,
			/never merges|does not merge/i,
			/local\/fake provider|local or fake provider/i,
			/`\/grills`[\s\S]*snapshots[\s\S]*handoffs[\s\S]*`\.sdd\/grills\/`/i,
			/current project[\s\S]*known projects[\s\S]*(?:never scans|without scanning).*disk/i,
			/paused handoff[\s\S]*imports[\s\S]*Resume/i,
			/historical path[\s\S]*warning/i,
			/finalized handoff[\s\S]*absolute path[\s\S]*`sdd-spec --from-grill/i,
		],
	},
] as const;

for (const { path, patterns } of readmeCases) {
	test(`${path} documents the orchestrated SDD rail and operational rollout`, async () => {
		const markdown = await readFile(new URL(path, import.meta.url), "utf8");
		for (const pattern of patterns) assert.match(markdown, pattern, pattern.source);
	});
}
