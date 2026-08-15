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
		],
	},
] as const;

for (const { path, patterns } of readmeCases) {
	test(`${path} documents the orchestrated SDD rail and operational rollout`, async () => {
		const markdown = await readFile(new URL(path, import.meta.url), "utf8");
		for (const pattern of patterns) assert.match(markdown, pattern, pattern.source);
	});
}
