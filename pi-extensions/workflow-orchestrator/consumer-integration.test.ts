import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("/issues delegates Analyze to the structured orchestrator without slash skill dispatch", async () => {
	const source = await readFile(new URL("../github-issues.ts", import.meta.url), "utf8");
	assert.match(source, /requestIssueTriage/);
	assert.doesNotMatch(source, /`?\/skill:issue-triage/);
	assert.doesNotMatch(source, /sendUserMessage\([^\n]*issue-triage/);
});

test("Pi issue-triage submits one terminal result when orchestrated and keeps manual fallback", async () => {
	const skill = await readFile(new URL("../../pi/issue-triage/SKILL.md", import.meta.url), "utf8");
	const phase = skill.match(/## Fase 6 — Emitir el resultado y terminar([\s\S]*?)## MUST DO/)?.[1] ?? "";
	assert.match(phase, /submit_workflow_resolution/);
	assert.match(phase, /activa|disponible/i);
	assert.match(phase, /manual|no est[aá] activa|fallback/i);
	assert.match(phase, /serializad/i);
});
