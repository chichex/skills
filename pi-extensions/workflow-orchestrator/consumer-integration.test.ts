import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("/issues delegates Analyze to the structured orchestrator without slash skill dispatch", async () => {
	const source = await readFile(new URL("../github-issues.ts", import.meta.url), "utf8");
	assert.match(source, /requestIssueTriage/);
	assert.match(source, /issueTriageFailureMessage/);
	assert.doesNotMatch(source, /No se pudo iniciar issue-triage: \$\{result\.message\}/);
	assert.doesNotMatch(source, /`?\/skill:issue-triage/);
	assert.doesNotMatch(source, /sendUserMessage\([^\n]*issue-triage/);
});

test("/issues exposes localized actionable failures instead of internal materializer errors", async () => {
	const module = await import("../github-consumer-logic.ts") as { issueTriageFailureMessage?: (code: string) => string };
	assert.equal(typeof module.issueTriageFailureMessage, "function");
	for (const code of ["skill-not-found", "skill-unreadable", "orchestrator-unavailable", "triage-already-active"]) {
		const message = module.issueTriageFailureMessage!(code);
		assert.match(message, /[áéíóúñ]|skill|orquestador|triage/i);
		assert.doesNotMatch(message, /pi\.getCommands|Skill issue-triage is not present|workflow-orchestrator is not loaded/);
	}
});

test("/specs calls the shared direct launcher and never injects run slash commands", async () => {
	const source = await readFile(new URL("../grill-tools/index.ts", import.meta.url), "utf8");
	assert.match(source, /requestSddRun\(\s*pi,\s*selected\.path,\s*ctx/s);
	assert.doesNotMatch(source, /Ejecutar con \/skill:sdd-run/);
	assert.doesNotMatch(source, /`?\/skill:sdd-run/);
	assert.doesNotMatch(source, /sendUserMessage\([^\n]*sdd-run/);
});

test("github issue selector materializes grill actions without slash dispatch and preserves results on launch failure", async () => {
	const source = await readFile(new URL("../github-issue-selector.ts", import.meta.url), "utf8");
	assert.match(source, /continueWithMaterializedSkill/);
	assert.match(source, /grillTransition/);
	assert.doesNotMatch(source, /if \(!transition\.ok\) throw/);
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

test("Pi sdd-run recognizes direct and triage envelopes without weakening its own preconditions", async () => {
	const skill = await readFile(new URL("../../pi/sdd-run/SKILL.md", import.meta.url), "utf8");
	assert.match(skill, /workflow-launch version="1"/);
	assert.match(skill, /DirectRunRequestV1/);
	assert.match(skill, /workflow-handoff version="1"/);
	assert.match(skill, /run-existing-spec/);
	assert.match(skill, /exactamente uno|mutuamente excluyentes/i);
	assert.match(skill, /no reemplaza|no saltea/i);
	assert.match(skill, /precondiciones/i);
});

test("Pi issue-triage shows its result before one terminal submission and keeps manual fallback", async () => {
	const skill = await readFile(new URL("../../pi/issue-triage/SKILL.md", import.meta.url), "utf8");
	const phase = skill.match(/## Fase 6 — Emitir el resultado y terminar([\s\S]*?)## MUST DO/)?.[1] ?? "";
	const terminalStep = phase.match(/3\.([\s\S]*?)\n4\./)?.[1] ?? "";
	assert.match(terminalStep, /submit_workflow_resolution/);
	assert.match(terminalStep, /mostr[aá].*(?:resultado|s[ií]ntesis).*antes/is);
	assert.match(phase, /activa|disponible/i);
	assert.match(phase, /manual|no est[aá] activa|fallback/i);
	assert.match(phase, /serializad/i);
	assert.match(skill, /quick-run.*branch.*commit.*PR/is, "quick-run consent names its mutation capability before confirmation");
	assert.doesNotMatch(skill, /confirmaci[oó]n s[oó]lo registra `selectedRoute`; no autoriza/i);
});

test("grill resume validates materialization before persistence and domain modeling cannot auto-continue on finalize", async () => {
	const [source, skill] = await Promise.all([
		readFile(new URL("../grill-tools/index.ts", import.meta.url), "utf8"),
		readFile(new URL("../../pi/grill/SKILL.md", import.meta.url), "utf8"),
	]);
	assert.match(source, /allowsFinalizeSpecContinuation\(snapshot\.workflowMode\)/);
	for (const marker of ["action === duplicateChoice", 'selected.status === "finalized"']) {
		const start = source.indexOf(marker);
		assert.ok(start >= 0, marker);
		const region = source.slice(start, start + 2_600);
		assert.ok(region.indexOf("prepareMaterializedSkill") >= 0, marker);
		assert.ok(region.indexOf("prepareMaterializedSkill") < region.indexOf("saveSnapshot"), marker);
	}
	assert.match(skill, /domain-modeling[\s\S]*continueWithSpec:\s*false/i);
	assert.match(skill, /ADRs[\s\S]*select_grill_session/is);
});

test("workflow validation, route contracts, and direct descriptors have one implementation", async () => {
	const [protocol, direct, lifecycle, dispatch] = await Promise.all([
		readFile(new URL("./protocol.ts", import.meta.url), "utf8"),
		readFile(new URL("./direct-launch.ts", import.meta.url), "utf8"),
		readFile(new URL("./lifecycle.ts", import.meta.url), "utf8"),
		readFile(new URL("./dispatch.ts", import.meta.url), "utf8"),
	]);
	assert.match(protocol, /from "\.\/validation\.ts"/);
	assert.match(direct, /from "\.\/direct-protocol\.ts"/);
	assert.doesNotMatch(protocol, /function (?:isRecord|exactObject)\b/);
	assert.doesNotMatch(direct, /function (?:isRecord|exactObject)\b|const sourceLabel\b/);
	assert.match(lifecycle, /from "\.\/route-contract\.ts"/);
	assert.match(dispatch, /from "\.\/route-contract\.ts"/);
	assert.doesNotMatch(lifecycle, /START_DISPATCH|const sourceLabel\b/);
	assert.doesNotMatch(dispatch, /ROUTE_MATRIX|unsupported-route/);
});
