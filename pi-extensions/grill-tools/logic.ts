// Logica pura del handoff interoperable de grill (CA-6, issue #10).
//
// Compone el handoff Markdown que Pi escribe en `.sdd/grills/` del proyecto
// con el template comun de los cuatro harnesses, y le garantiza el marker
// canonico SDD-Tracking v1 via sdd-artifacts. Sin I/O ni APIs de Pi: la
// escritura a disco vive en index.ts.

import {
	parseSddArtifact,
	upsertSddMetadata,
	type GrillMetadata,
	type IssueReference,
} from "../sdd-artifacts/index.ts";

export interface HandoffSnapshot {
	id: string;
	topic: string;
	projectPath: string;
	status: "active" | "paused" | "finalized";
	workflowMode: "standard" | "domain-modeling";
	sourceIssue?: { number: number; repository?: string };
	createdAt: string;
	summary?: string;
	decisions: { title: string; agreement: string }[];
	pendingBranches: { title: string; description?: string }[];
	handoffMarkdown?: string;
}

export interface HandoffPlan {
	fileName: string;
	content: string;
	diagnostics: string[];
}

const MARKER_LINE = /^[ \t]*<!--\s*SDD-Tracking\s*:.*-->[ \t]*$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function allowsFinalizeSpecContinuation(workflowMode: HandoffSnapshot["workflowMode"]): boolean {
	return workflowMode === "standard";
}

export function slugify(text: string): string {
	const slug = text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "grill";
}

function issueReference(sourceIssue: HandoffSnapshot["sourceIssue"]): IssueReference | null {
	if (!sourceIssue || !Number.isInteger(sourceIssue.number) || sourceIssue.number <= 0) return null;
	const repository = sourceIssue.repository?.trim() ?? "";
	if (REPOSITORY_PATTERN.test(repository)) return `${repository}#${sourceIssue.number}` as IssueReference;
	return `#${sourceIssue.number}`;
}

export function grillMetadataFromSnapshot(snapshot: HandoffSnapshot): GrillMetadata {
	return {
		version: 1,
		type: "grill",
		state: snapshot.status === "finalized" ? "finalized" : "paused",
		issue: issueReference(snapshot.sourceIssue),
		grill: snapshot.id,
		project: snapshot.projectPath,
	};
}

export function handoffFileNames(snapshot: HandoffSnapshot): { primary: string; fallback: string } {
	const date = snapshot.createdAt.slice(0, 10);
	const slug = slugify(snapshot.topic);
	const suffix = snapshot.id.split("-").pop() || "sesion";
	return {
		primary: `${date}-${slug}.md`,
		fallback: `${date}-${slug}-${suffix}.md`,
	};
}

export function composeHandoffMarkdown(snapshot: HandoffSnapshot): string {
	const state = snapshot.status === "finalized" ? "finalized" : "paused";
	const issue = issueReference(snapshot.sourceIssue);
	const fuente = issue ? `issue ${issue}` : snapshot.topic;
	const decisiones = snapshot.decisions.length
		? snapshot.decisions.map((decision, index) => `${index + 1}. ${decision.title} — ${decision.agreement}`)
		: ["(ninguna todavia)"];
	const ramas = snapshot.pendingBranches.length
		? snapshot.pendingBranches.map(
			(branch) => `- ${branch.title}${branch.description ? ` — ${branch.description}` : ""}`,
		)
		: ["(ninguna)"];
	const handoff =
		snapshot.status === "finalized" && snapshot.handoffMarkdown?.trim()
			? [snapshot.handoffMarkdown.trim()]
			: ["(vacío hasta finalizar el grill)"];
	return [
		`# Grill — ${snapshot.topic}`,
		`<!-- Estado: ${state}. Proyecto: ${snapshot.projectPath}. Fuente: ${fuente}. -->`,
		"",
		"## Modo",
		snapshot.workflowMode,
		"",
		"## Hechos comprobados",
		snapshot.summary?.trim() || "(sin registrar en el snapshot)",
		"",
		"## Decisiones resueltas",
		...decisiones,
		"",
		"## Ramas pendientes",
		...ramas,
		"",
		"## Handoff",
		...handoff,
		"",
	].join("\n");
}

function stripPreambleMarkers(markdown: string): string {
	const lines = markdown.split("\n");
	const kept: string[] = [];
	let inBody = false;
	for (const line of lines) {
		if (!inBody && /^##(?!#)/.test(line)) inBody = true;
		if (!inBody && MARKER_LINE.test(line)) continue;
		kept.push(line);
	}
	return kept.join("\n");
}

function applyGrillMarker(
	markdown: string,
	metadata: GrillMetadata,
): { content: string; diagnostics: string[] } {
	const first = upsertSddMetadata(markdown, metadata);
	if (first.ok) return { content: first.document, diagnostics: [] };
	const second = upsertSddMetadata(stripPreambleMarkers(markdown), metadata);
	if (second.ok) {
		return { content: second.document, diagnostics: first.diagnostics.map((diagnostic) => diagnostic.code) };
	}
	return {
		content: markdown,
		diagnostics: [...first.diagnostics, ...second.diagnostics].map((diagnostic) => diagnostic.code),
	};
}

export function handoffBelongsToSession(content: string, sessionId: string): boolean {
	const parsed = parseSddArtifact(content);
	return (
		parsed.kind === "metadata" &&
		parsed.format === "canonical" &&
		parsed.metadata.type === "grill" &&
		parsed.metadata.grill === sessionId
	);
}

export function planGrillHandoff(snapshot: HandoffSnapshot, existingContent: string | null): HandoffPlan {
	const names = handoffFileNames(snapshot);
	const fileName =
		existingContent === null || handoffBelongsToSession(existingContent, snapshot.id)
			? names.primary
			: names.fallback;
	const base =
		snapshot.status === "finalized" && snapshot.handoffMarkdown?.trim()
			? `${snapshot.handoffMarkdown.trim()}\n`
			: composeHandoffMarkdown(snapshot);
	const { content, diagnostics } = applyGrillMarker(base, grillMetadataFromSnapshot(snapshot));
	return { fileName, content, diagnostics };
}
