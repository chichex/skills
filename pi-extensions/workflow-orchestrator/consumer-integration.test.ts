import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("/issues delegates Analyze to the structured orchestrator without slash skill dispatch", async () => {
	const source = await readFile(new URL("../github-issues.ts", import.meta.url), "utf8");
	assert.match(source, /requestIssueTriage/);
	assert.doesNotMatch(source, /`?\/skill:issue-triage/);
	assert.doesNotMatch(source, /sendUserMessage\([^\n]*issue-triage/);
});

test("/specs calls the shared direct launcher and never injects run slash commands", async () => {
	const source = await readFile(new URL("../grill-tools/index.ts", import.meta.url), "utf8");
	assert.match(source, /requestSddRun\(\s*pi,\s*selected\.path,\s*ctx/s);
	assert.doesNotMatch(source, /Ejecutar con \/skill:sdd-run/);
	assert.doesNotMatch(source, /`?\/skill:sdd-run/);
	assert.doesNotMatch(source, /sendUserMessage\([^\n]*sdd-run/);
});

test("github issue selector materializes grill actions without slash dispatch", async () => {
	const source = await readFile(new URL("../github-issue-selector.ts", import.meta.url), "utf8");
	assert.match(source, /continueWithMaterializedSkill/);
	assert.doesNotMatch(source, /`?\/skill:grill/);
	assert.doesNotMatch(source, /sendUserMessage\([^\n]*grill/);
});

test("grill consumers materialize resume and grill-to-spec in the same session", async () => {
	const source = await readFile(new URL("../grill-tools/index.ts", import.meta.url), "utf8");
	assert.match(source, /continueWithMaterializedSkill/);
	assert.match(source, /"grill",\s*`--resume \$\{session\.id\}`/s);
	assert.match(source, /"sdd-spec",\s*`--from-grill \$\{selected\.id\}`/s);
	assert.match(source, /continueWithSpec/);
	assert.doesNotMatch(source, /`?\/skill:(?:grill|sdd-spec)/);
	assert.doesNotMatch(source, /sendUserMessage\([^\n]*(?:grill|sdd-spec)/);
});

test("Pi grill uses structured resume and finalize continuation instead of ad-hoc SKILL reads", async () => {
	const skill = await readFile(new URL("../../pi/grill/SKILL.md", import.meta.url), "utf8");
	assert.match(skill, /--resume <sessionId>/);
	assert.match(skill, /continueWithSpec:\s*true/);
	assert.doesNotMatch(skill, /le[eé] `~\/\.agents\/skills\/sdd-spec\/SKILL\.md`/i);
});

test("Pi sdd-spec consumes orchestrated spec targets from the structured handoff", async () => {
	const skill = await readFile(new URL("../../pi/sdd-spec/SKILL.md", import.meta.url), "utf8");
	assert.match(skill, /workflow-handoff version="1"/);
	assert.match(skill, /spec-from-grill/);
	assert.match(skill, /update-existing-spec\|audit-existing-spec/);
	assert.match(skill, /ArtifactRef.*primary|primary.*ArtifactRef/is);
	assert.match(skill, /nunca.*scrap/i);
});

test("Pi sdd-spec exposes Ejecutar ahora only after persistence and delegates to launch_sdd_run", async () => {
	const skill = await readFile(new URL("../../pi/sdd-spec/SKILL.md", import.meta.url), "utf8");
	const reportIndex = skill.indexOf("## Reporte");
	const executeIndex = skill.indexOf("Ejecutar ahora");
	assert.ok(reportIndex >= 0 && executeIndex > reportIndex, "the execution gate follows persisted spec reporting");
	assert.match(skill.slice(executeIndex), /launch_sdd_run/);
	assert.match(skill.slice(executeIndex), /cancel/i);
	assert.doesNotMatch(skill.slice(executeIndex), /encontrar.*ejecut/i);
});

test("Pi sdd-run recognizes a strict direct request envelope without weakening its own preconditions", async () => {
	const skill = await readFile(new URL("../../pi/sdd-run/SKILL.md", import.meta.url), "utf8");
	assert.match(skill, /workflow-launch version="1"/);
	assert.match(skill, /DirectRunRequestV1/);
	assert.match(skill, /no reemplaza|no saltea/i);
	assert.match(skill, /precondiciones/i);
});

test("Pi issue-triage submits one terminal result when orchestrated and keeps manual fallback", async () => {
	const skill = await readFile(new URL("../../pi/issue-triage/SKILL.md", import.meta.url), "utf8");
	const phase = skill.match(/## Fase 6 — Emitir el resultado y terminar([\s\S]*?)## MUST DO/)?.[1] ?? "";
	assert.match(phase, /submit_workflow_resolution/);
	assert.match(phase, /activa|disponible/i);
	assert.match(phase, /manual|no est[aá] activa|fallback/i);
	assert.match(phase, /serializad/i);
});
