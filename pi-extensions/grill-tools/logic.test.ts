// Tests de la logica pura del handoff interoperable de grill (CA-6, issue #10):
// composicion desde el snapshot, naming en .sdd/grills/, mapeo a metadata v1 y
// upsert idempotente via sdd-artifacts. Sin I/O ni APIs de Pi.

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSddArtifact } from "../sdd-artifacts/index.ts";
import {
	allowsFinalizeSpecContinuation,
	composeHandoffMarkdown,
	grillMetadataFromSnapshot,
	handoffBelongsToSession,
	handoffFileNames,
	planGrillHandoff,
	slugify,
	type HandoffSnapshot,
} from "./logic.ts";

function makeSnapshot(overrides: Partial<HandoffSnapshot> = {}): HandoffSnapshot {
	return {
		id: "rate-limit-por-ip-20260808-abcd1234",
		topic: "Rate limit por IP",
		projectPath: "/workspace/demo",
		status: "paused",
		workflowMode: "standard",
		createdAt: "2026-08-08T14:00:00.000Z",
		decisions: [{ title: "Ventana", agreement: "deslizante de 60 segundos" }],
		pendingBranches: [{ title: "Persistencia", description: "redis o memoria" }],
		...overrides,
	};
}

const MARKER_LINE = /^<!--\s*SDD-Tracking\s*:.*-->$/i;

function markerCount(markdown: string): number {
	return markdown.split("\n").filter((line) => MARKER_LINE.test(line.trim())).length;
}

test("solo el modo standard puede encadenar spec durante finalize", () => {
	assert.equal(allowsFinalizeSpecContinuation("standard"), true);
	assert.equal(allowsFinalizeSpecContinuation("domain-modeling"), false);
});

test("slugify normaliza acentos, espacios y mayusculas", () => {
	assert.equal(slugify("Sesión de diseño"), "sesion-de-diseno");
	assert.equal(slugify("Rate limit por IP"), "rate-limit-por-ip");
	assert.equal(slugify("¡¡¡"), "grill");
});

test("handoffFileNames deriva fecha del createdAt y slug del topic, con fallback por sesion", () => {
	const names = handoffFileNames(makeSnapshot());
	assert.equal(names.primary, "2026-08-08-rate-limit-por-ip.md");
	assert.equal(names.fallback, "2026-08-08-rate-limit-por-ip-abcd1234.md");
});

test("grillMetadataFromSnapshot mapea identidad y estado al schema v1", () => {
	const base = grillMetadataFromSnapshot(makeSnapshot());
	assert.deepEqual(base, {
		version: 1,
		type: "grill",
		state: "paused",
		issue: null,
		grill: "rate-limit-por-ip-20260808-abcd1234",
		project: "/workspace/demo",
	});
	assert.equal(grillMetadataFromSnapshot(makeSnapshot({ status: "finalized" })).state, "finalized");
	assert.equal(grillMetadataFromSnapshot(makeSnapshot({ status: "active" })).state, "paused");
	assert.equal(
		grillMetadataFromSnapshot(makeSnapshot({ sourceIssue: { number: 7 } })).issue,
		"#7",
	);
	assert.equal(
		grillMetadataFromSnapshot(makeSnapshot({ sourceIssue: { number: 7, repository: "owner/repo" } })).issue,
		"owner/repo#7",
	);
	assert.equal(
		grillMetadataFromSnapshot(makeSnapshot({ sourceIssue: { number: 7, repository: "sin-slash" } })).issue,
		"#7",
	);
});

test("composeHandoffMarkdown emite el template interoperable y es determinista", () => {
	const snapshot = makeSnapshot({ summary: "Se acordo limitar por IP." });
	const markdown = composeHandoffMarkdown(snapshot);
	const lines = markdown.split("\n");
	assert.equal(lines[0], "# Grill — Rate limit por IP");
	assert.equal(
		lines[1],
		"<!-- Estado: paused. Proyecto: /workspace/demo. Fuente: Rate limit por IP. -->",
	);
	const headings = lines.filter((line) => line.startsWith("## "));
	assert.deepEqual(headings, [
		"## Modo",
		"## Hechos comprobados",
		"## Decisiones resueltas",
		"## Ramas pendientes",
		"## Handoff",
	]);
	assert.ok(markdown.includes("standard"));
	assert.ok(markdown.includes("Se acordo limitar por IP."));
	assert.ok(markdown.includes("1. Ventana — deslizante de 60 segundos"));
	assert.ok(markdown.includes("- Persistencia — redis o memoria"));
	assert.ok(markdown.endsWith("\n"));
	assert.equal(markdown, composeHandoffMarkdown(snapshot));
});

test("composeHandoffMarkdown usa el issue como Fuente cuando existe", () => {
	const markdown = composeHandoffMarkdown(makeSnapshot({ sourceIssue: { number: 9, repository: "owner/repo" } }));
	assert.ok(markdown.includes("Fuente: issue owner/repo#9."));
});

test("planGrillHandoff (paused) produce un documento canonico e idempotente", () => {
	const snapshot = makeSnapshot();
	const plan = planGrillHandoff(snapshot, null);
	assert.equal(plan.fileName, "2026-08-08-rate-limit-por-ip.md");
	assert.deepEqual(plan.diagnostics, []);
	assert.equal(markerCount(plan.content), 1);

	const parsed = parseSddArtifact(plan.content);
	assert.equal(parsed.kind, "metadata");
	if (parsed.kind !== "metadata" || parsed.format !== "canonical") {
		assert.fail("el handoff pausado debe llevar marker canonico");
	}
	assert.deepEqual(parsed.metadata, grillMetadataFromSnapshot(snapshot));
	assert.equal(parsed.state.value, "paused");

	const again = planGrillHandoff(snapshot, plan.content);
	assert.equal(again.fileName, plan.fileName);
	assert.equal(again.content, plan.content);
});

test("planGrillHandoff (finalized) preserva el markdown del modelo y agrega el marker autoritativo", () => {
	const handoffMarkdown = [
		"# Grill — Rate limit por IP",
		"<!-- Estado: finalized. Proyecto: /workspace/demo. Fuente: Rate limit por IP. -->",
		"",
		"## Hechos comprobados",
		"El limite actual vive en middleware/http.ts.",
		"",
		"## Handoff",
		"Contrato completo de la entrevista.",
	].join("\n");
	const snapshot = makeSnapshot({ status: "finalized", handoffMarkdown });
	const plan = planGrillHandoff(snapshot, null);

	assert.ok(plan.content.includes("El limite actual vive en middleware/http.ts."));
	assert.ok(plan.content.includes("Contrato completo de la entrevista."));
	assert.equal(markerCount(plan.content), 1);

	const parsed = parseSddArtifact(plan.content);
	if (parsed.kind !== "metadata" || parsed.format !== "canonical") {
		assert.fail("el handoff finalizado debe llevar marker canonico");
	}
	assert.equal(parsed.metadata.type, "grill");
	assert.ok(parsed.metadata.type === "grill" && parsed.metadata.state === "finalized");
	assert.ok(parsed.metadata.type === "grill" && parsed.metadata.grill === snapshot.id);
});

test("planGrillHandoff reconcilia un campo Estado legacy desactualizado del modelo", () => {
	const handoffMarkdown = [
		"# Grill — Rate limit por IP",
		"<!-- Estado: paused. Proyecto: /workspace/demo. Fuente: Rate limit por IP. -->",
		"",
		"## Handoff",
		"Contrato.",
	].join("\n");
	const plan = planGrillHandoff(makeSnapshot({ status: "finalized", handoffMarkdown }), null);
	assert.ok(
		plan.content.includes("<!-- Estado: finalized. Proyecto: /workspace/demo. Fuente: Rate limit por IP. -->"),
		"el campo Estado legacy queda reconciliado con el estado canonico",
	);
});

test("planGrillHandoff reemplaza un marker previo del modelo con los valores autoritativos", () => {
	const handoffMarkdown = [
		"# Grill — Rate limit por IP",
		"<!-- SDD-Tracking: version=1; type=grill; state=paused; issue=none; grill=otro-id; project=%2Fotro -->",
		"",
		"## Handoff",
		"Contrato.",
	].join("\n");
	const snapshot = makeSnapshot({ status: "finalized", handoffMarkdown });
	const plan = planGrillHandoff(snapshot, null);
	assert.equal(markerCount(plan.content), 1);
	const parsed = parseSddArtifact(plan.content);
	if (parsed.kind !== "metadata" || parsed.format !== "canonical" || parsed.metadata.type !== "grill") {
		assert.fail("el marker del modelo debe quedar reemplazado por uno canonico");
	}
	assert.equal(parsed.metadata.grill, snapshot.id);
	assert.equal(parsed.metadata.state, "finalized");
});

test("planGrillHandoff se recupera de markers divergentes del modelo sin duplicar", () => {
	const handoffMarkdown = [
		"# Grill — Rate limit por IP",
		"<!-- SDD-Tracking: version=1; type=grill; state=paused; issue=none; grill=uno; project=%2Fa -->",
		"<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=dos; project=%2Fb -->",
		"",
		"## Handoff",
		"Contrato.",
	].join("\n");
	const snapshot = makeSnapshot({ status: "finalized", handoffMarkdown });
	const plan = planGrillHandoff(snapshot, null);
	assert.equal(markerCount(plan.content), 1);
	assert.ok(plan.diagnostics.length > 0, "la recuperacion queda diagnosticada");
	const parsed = parseSddArtifact(plan.content);
	if (parsed.kind !== "metadata" || parsed.format !== "canonical" || parsed.metadata.type !== "grill") {
		assert.fail("tras la recuperacion el documento queda canonico");
	}
	assert.equal(parsed.metadata.grill, snapshot.id);
});

test("handoffBelongsToSession distingue el archivo propio de uno ajeno", () => {
	const snapshot = makeSnapshot();
	const own = planGrillHandoff(snapshot, null).content;
	assert.equal(handoffBelongsToSession(own, snapshot.id), true);
	assert.equal(handoffBelongsToSession(own, "otra-sesion"), false);
	assert.equal(handoffBelongsToSession("# Grill — Otro tema\n\n## Handoff\n", snapshot.id), false);
});

test("planGrillHandoff usa el nombre con sufijo cuando el archivo primario es de otra sesion", () => {
	const snapshot = makeSnapshot();
	const foreign = planGrillHandoff(makeSnapshot({ id: "rate-limit-por-ip-20260808-ffff9999" }), null).content;
	const plan = planGrillHandoff(snapshot, foreign);
	assert.equal(plan.fileName, "2026-08-08-rate-limit-por-ip-abcd1234.md");
});
