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

test("grill consumers share inventory and materialize ID-or-path transitions in the same session", async () => {
	const source = await readFile(new URL("../grill-tools/index.ts", import.meta.url), "utf8");
	assert.match(source, /loadGrillInventory/);
	assert.ok((source.match(/await loadGrillInventory\(pi, currentProject\)/g) ?? []).length >= 2);
	assert.match(source, /prepareMaterializedSkill\(pi, "grill", `--resume \$\{JSON\.stringify\(expectedId\)\}`\)/);
	assert.match(source, /prepareMaterializedSkill\(pi, "grill", `--resume \$\{JSON\.stringify\(childId\)\}`\)/);
	assert.match(source, /validatedFinalizedHandoffPath/);
	assert.match(source, /`--from-grill \$\{JSON\.stringify\(sourceTarget\)\}`/);
	assert.match(source, /continueWithMaterializedSkill\(\s*pi,\s*"sdd-spec",\s*argument/s);
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

test("Pi grill delegates qualified GitHub issue targets and consumes the strict child launch envelope", async () => {
	const skill = await readFile(new URL("../../pi/grill/SKILL.md", import.meta.url), "utf8");
	assert.match(skill, /owner\/repo#NN/);
	assert.match(skill, /https:\/\/github\.com\/owner\/repo\/issues\/NN/);
	assert.match(skill, /launch_grill/);
	assert.match(skill, /workflow-launch version="1"/);
	assert.match(skill, /DirectGrillRequestV1/);
	assert.match(skill, /no vuelvas a invocar `launch_grill`/i);
});

test("CA-11: Pi grill and sdd-spec document portable handoff-only recovery by physical path", async () => {
	const [grill, spec] = await Promise.all([
		readFile(new URL("../../pi/grill/SKILL.md", import.meta.url), "utf8"),
		readFile(new URL("../../pi/sdd-spec/SKILL.md", import.meta.url), "utf8"),
	]);
	assert.match(grill, /snapshots[\s\S]*`\.sdd\/grills\/`[\s\S]*inventario/i);
	assert.match(grill, /proyecto actual[\s\S]*roots? conocidos[\s\S]*no.*filesystem/is);
	assert.match(grill, /handoff-only[\s\S]*pausado[\s\S]*Retomar[\s\S]*import/i);
	assert.match(grill, /finalizado[\s\S]*ruta absoluta[\s\S]*sdd-spec/is);
	assert.match(spec, /ruta absoluta[\s\S]*`\.sdd\/grills\/`[\s\S]*finalizado/is);
	assert.match(spec, /ra[ií]z operativa[\s\S]*ubicaci[oó]n f[ií]sica/is);
	assert.match(spec, /project.*hist[oó]ric[\s\S]*no bloque/is);
	assert.match(spec, /sin (?:snapshot|JSON) hermano/i);
	assert.match(spec, /grill.*marker[\s\S]*spec/is);
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

test("Pi sdd-run delegates qualified GitHub issue targets to the cross-project launcher", async () => {
	const skill = await readFile(new URL("../../pi/sdd-run/SKILL.md", import.meta.url), "utf8");
	assert.match(skill, /owner\/repo#NN/);
	assert.match(skill, /https:\/\/github\.com\/owner\/repo\/issues\/NN/);
	assert.match(skill, /sin.*workflow-launch[\s\S]*launch_sdd_run/is);
	assert.match(skill, /no (?:explores|implementes|toques Git)/i);
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
	assert.match(terminalStep, /si .*invocaci[oó]n falla.*orquestador/is);
	assert.match(terminalStep, /no.*modo manual/is);
	assert.match(phase, /activa|disponible/i);
	assert.match(phase, /manual|no est[aá] activa|fallback/i);
	assert.match(phase, /serializad/i);
	assert.match(skill, /quick-run.*branch.*commit.*PR/is, "quick-run consent names its mutation capability before confirmation");
	assert.doesNotMatch(skill, /confirmaci[oó]n s[oó]lo registra `selectedRoute`; no autoriza/i);
});

test("grill resume validates materialization before any import and finalize no longer depends on a domain mode", async () => {
	const [source, skill] = await Promise.all([
		readFile(new URL("../grill-tools/index.ts", import.meta.url), "utf8"),
		readFile(new URL("../../pi/grill/SKILL.md", import.meta.url), "utf8"),
	]);
	assert.doesNotMatch(source, /allowsFinalizeSpecContinuation|workflowMode|domain.modeling/);
	const actionStart = source.indexOf("async function performGrillAction");
	assert.ok(actionStart >= 0);
	const actionRegion = source.slice(actionStart, source.indexOf("export default function", actionStart));
	const firstPrepare = actionRegion.indexOf("prepareMaterializedSkill");
	assert.ok(firstPrepare >= 0);
	for (const mutation of ["persistImportedPlan", "saveSnapshot(resumed)", "writeNewSnapshot(duplicate)"]) {
		assert.ok(actionRegion.indexOf(mutation) > firstPrepare, mutation);
	}
	assert.match(actionRegion, /queueWithRollback/);
	assert.doesNotMatch(skill, /domain.modeling|workflowMode/);
	assert.match(skill, /continueWithSpec:\s*true/);
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
