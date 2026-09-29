import { basename, resolve } from "node:path";

import {
	inspectMarkdownArtifact,
	normalizeIssueRef,
	type IssueRef,
	type ResolutionDiagnostic,
} from "../workflow-resolution/index.ts";

export const GRILL_SNAPSHOT_VERSION = 5;
export const DEFAULT_GRILL_QUESTION_LIMIT = 20;

export type GrillWorkflowMode = "standard" | "domain-modeling";
export type GrillInterviewMode = "unselected" | "fast" | "rounds" | "adaptive";
export type GrillStatus = "active" | "paused" | "finalized";

export interface GrillEstimate {
	min: number;
	likely: number;
	max: number;
}

export interface GrillSection {
	id: string;
	title: string;
	estimatedQuestions: number;
	dependsOn?: string[];
	status?: "pending" | "active" | "resolved";
}

export interface GrillInteraction {
	id: string;
	question: string;
	answers: string[];
	section?: string;
	recommendation?: string;
	createdAt: string;
}

export interface GrillDecision {
	id: string;
	title: string;
	agreement: string;
	section?: string;
	updatedAt: string;
}

export interface GrillPendingBranch {
	id: string;
	title: string;
	description?: string;
	section?: string;
}

export interface GrillIssueReference {
	number: number;
	repository?: string;
}

export interface ImportedHandoffSource {
	kind: "handoff-only";
	sourcePath: string;
	historicalProjectPath?: string;
	markdown: string;
	importedAt: string;
	hadRuntimeSnapshot: false;
}

export interface GrillSnapshot {
	version: number;
	id: string;
	topic: string;
	projectPath: string;
	projectName: string;
	status: GrillStatus;
	workflowMode: GrillWorkflowMode;
	interviewMode: GrillInterviewMode;
	sourceIssue?: GrillIssueReference;
	createdAt: string;
	updatedAt: string;
	estimate: GrillEstimate;
	questionLimit: number;
	sections: GrillSection[];
	interactions: GrillInteraction[];
	decisions: GrillDecision[];
	pendingBranches: GrillPendingBranch[];
	summary?: string;
	handoffMarkdown?: string;
	parentId?: string;
	revision: number;
	importedHandoff?: ImportedHandoffSource;
}

export interface SnapshotFileCandidate {
	path: string;
	repository: string;
	value?: unknown;
	readError?: string;
}

export interface HandoffFileCandidate {
	path: string;
	projectPath: string;
	repository: string;
	markdown?: string;
	readError?: string;
}

export type GrillInventoryAction = "inspect" | "resume" | "create-spec" | "duplicate";

export interface GrillInventoryEntry {
	key: string;
	grillId: string | null;
	topic: string;
	projectPath: string | null;
	historicalProjectPath: string | null;
	state: GrillStatus | "unknown";
	authority: "snapshot" | "handoff" | null;
	valid: boolean;
	diagnostics: ResolutionDiagnostic[];
	warnings: ResolutionDiagnostic[];
	snapshot?: GrillSnapshot;
	handoffMarkdown?: string;
	snapshotPath?: string;
	handoffPaths: string[];
	issue: IssueRef | null;
}

export interface GrillInventory {
	entries: GrillInventoryEntry[];
}

interface NormalizedSnapshotResult {
	snapshot: GrillSnapshot | null;
	diagnostics: ResolutionDiagnostic[];
	recoveredId: string | null;
	recoveredProjectPath: string | null;
}

interface InspectedSnapshot {
	kind: "snapshot";
	path: string;
	id: string | null;
	projectPath: string | null;
	topic: string;
	state: GrillStatus | "unknown";
	issue: IssueRef | null;
	snapshot?: GrillSnapshot;
	diagnostics: ResolutionDiagnostic[];
	warnings: ResolutionDiagnostic[];
}

interface InspectedHandoff {
	kind: "handoff";
	path: string;
	id: string | null;
	projectPath: string;
	historicalProjectPath: string | null;
	topic: string;
	state: "paused" | "finalized" | "unknown";
	issue: IssueRef | null;
	markdown?: string;
	diagnostics: ResolutionDiagnostic[];
	warnings: ResolutionDiagnostic[];
}

type InspectedCandidate = InspectedSnapshot | InspectedHandoff;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function validIssue(value: unknown): GrillIssueReference | undefined {
	if (!isRecord(value) || !Number.isInteger(value.number) || (value.number as number) < 1) return undefined;
	if (value.repository !== undefined && typeof value.repository !== "string") return undefined;
	return {
		number: value.number as number,
		...(typeof value.repository === "string" && value.repository.trim()
			? { repository: value.repository.trim() }
			: {}),
	};
}

function validImportedSource(value: unknown): ImportedHandoffSource | undefined {
	if (!isRecord(value) || value.kind !== "handoff-only" || value.hadRuntimeSnapshot !== false) return undefined;
	const sourcePath = nonEmptyString(value.sourcePath);
	const markdown = typeof value.markdown === "string" ? value.markdown : null;
	const importedAt = nonEmptyString(value.importedAt);
	if (!sourcePath || markdown === null || !importedAt) return undefined;
	const historicalProjectPath = value.historicalProjectPath === undefined
		? undefined
		: nonEmptyString(value.historicalProjectPath) ?? undefined;
	return {
		kind: "handoff-only",
		sourcePath,
		...(historicalProjectPath ? { historicalProjectPath } : {}),
		markdown,
		importedAt,
		hadRuntimeSnapshot: false,
	};
}

function normalizedEstimate(value: unknown): GrillEstimate {
	if (!isRecord(value)) return { min: 0, likely: 0, max: 0 };
	const integer = (candidate: unknown): number =>
		Number.isInteger(candidate) && (candidate as number) >= 0 ? candidate as number : 0;
	return { min: integer(value.min), likely: integer(value.likely), max: integer(value.max) };
}

export function normalizeGrillSnapshot(value: unknown): NormalizedSnapshotResult {
	const recoveredId = isRecord(value) ? nonEmptyString(value.id) : null;
	const recoveredProjectPath = isRecord(value) ? nonEmptyString(value.projectPath) : null;
	const diagnostics: ResolutionDiagnostic[] = [];
	if (!isRecord(value)) {
		return {
			snapshot: null,
			diagnostics: [{ code: "invalid-snapshot", message: "Snapshot must be a JSON object" }],
			recoveredId,
			recoveredProjectPath,
		};
	}

	const topic = nonEmptyString(value.topic);
	const status = value.status === "active" || value.status === "paused" || value.status === "finalized"
		? value.status
		: null;
	if (!recoveredId) diagnostics.push({ code: "invalid-snapshot", message: "Snapshot id is missing" });
	if (!topic) diagnostics.push({ code: "invalid-snapshot", message: "Snapshot topic is missing" });
	if (!recoveredProjectPath) diagnostics.push({ code: "invalid-snapshot", message: "Snapshot projectPath is missing" });
	if (!status) diagnostics.push({ code: "invalid-snapshot", message: "Snapshot status is invalid" });
	for (const field of ["interactions", "decisions", "pendingBranches"] as const) {
		if (!Array.isArray(value[field])) {
			diagnostics.push({ code: "invalid-snapshot", message: `Snapshot ${field} must be an array` });
		}
	}
	if (value.sourceIssue !== undefined && !validIssue(value.sourceIssue)) {
		diagnostics.push({ code: "invalid-snapshot", message: "Snapshot sourceIssue is invalid" });
	}
	if (value.importedHandoff !== undefined && !validImportedSource(value.importedHandoff)) {
		diagnostics.push({ code: "invalid-snapshot", message: "Snapshot importedHandoff is invalid" });
	}
	if (diagnostics.length > 0 || !recoveredId || !topic || !recoveredProjectPath || !status) {
		return { snapshot: null, diagnostics, recoveredId, recoveredProjectPath };
	}

	const createdAt = nonEmptyString(value.createdAt) ?? new Date(0).toISOString();
	const updatedAt = nonEmptyString(value.updatedAt) ?? createdAt;
	let workflowMode: GrillWorkflowMode;
	if (value.workflowMode === "domain-modeling" || value.workflowMode === "standard") {
		workflowMode = value.workflowMode;
	} else {
		const domainDecision = (value.decisions as unknown[]).find((decision) => {
			if (!isRecord(decision)) return false;
			const identity = `${nonEmptyString(decision.id) ?? ""} ${nonEmptyString(decision.title) ?? ""}`.toLowerCase();
			return identity.includes("domain modeling") || identity.includes("modelado de dominio");
		});
		const agreement = isRecord(domainDecision)
			? (nonEmptyString(domainDecision.agreement) ?? "").toLowerCase()
			: "";
		const explicitlyDisabled = /\b(no|false|standard|disabled|desactivad[oa]|sin documentaci[oó]n)\b/.test(agreement);
		workflowMode = domainDecision && !explicitlyDisabled ? "domain-modeling" : "standard";
	}
	const interviewMode: GrillInterviewMode = value.interviewMode === "fast"
		|| value.interviewMode === "rounds"
		|| value.interviewMode === "adaptive"
		? value.interviewMode
		: "unselected";
	const revision = Number.isInteger(value.revision) && (value.revision as number) > 0
		? value.revision as number
		: 1;
	const questionLimit = Number.isInteger(value.questionLimit) && (value.questionLimit as number) > 0
		? value.questionLimit as number
		: DEFAULT_GRILL_QUESTION_LIMIT;
	const importedHandoff = validImportedSource(value.importedHandoff);
	let sourceIssue = validIssue(value.sourceIssue);
	if (!sourceIssue) {
		const issueMatch = topic.match(/\bissue\s*#(\d+)/i) ?? recoveredId.match(/^issue-(\d+)(?:-|$)/i);
		const issueNumber = Number(issueMatch?.[1]);
		if (Number.isInteger(issueNumber) && issueNumber > 0) sourceIssue = { number: issueNumber };
	}
	const parentId = nonEmptyString(value.parentId);
	const summary = typeof value.summary === "string" ? value.summary : undefined;
	const handoffMarkdown = typeof value.handoffMarkdown === "string" ? value.handoffMarkdown : undefined;

	return {
		snapshot: {
			version: GRILL_SNAPSHOT_VERSION,
			id: recoveredId,
			topic,
			projectPath: resolve(recoveredProjectPath),
			projectName: nonEmptyString(value.projectName) ?? basename(recoveredProjectPath),
			status,
			workflowMode,
			interviewMode,
			...(sourceIssue ? { sourceIssue } : {}),
			createdAt,
			updatedAt,
			estimate: normalizedEstimate(value.estimate),
			questionLimit,
			sections: Array.isArray(value.sections) ? value.sections as GrillSection[] : [],
			interactions: value.interactions as GrillInteraction[],
			decisions: value.decisions as GrillDecision[],
			pendingBranches: value.pendingBranches as GrillPendingBranch[],
			...(summary !== undefined ? { summary } : {}),
			...(handoffMarkdown !== undefined ? { handoffMarkdown } : {}),
			...(parentId ? { parentId } : {}),
			revision,
			...(importedHandoff ? { importedHandoff } : {}),
		},
		diagnostics: [],
		recoveredId,
		recoveredProjectPath: resolve(recoveredProjectPath),
	};
}

function inspectSnapshot(candidate: SnapshotFileCandidate): InspectedSnapshot {
	if (candidate.readError) {
		return {
			kind: "snapshot",
			path: candidate.path,
			id: null,
			projectPath: null,
			topic: basename(candidate.path, ".json"),
			state: "unknown",
			issue: null,
			diagnostics: [{ code: "snapshot-read-error", message: `${candidate.path}: ${candidate.readError}` }],
			warnings: [],
		};
	}
	const normalized = normalizeGrillSnapshot(candidate.value);
	const snapshot = normalized.snapshot;
	const issue = snapshot?.sourceIssue
		? normalizeIssueRef(
			snapshot.sourceIssue.repository
				? `${snapshot.sourceIssue.repository}#${snapshot.sourceIssue.number}`
				: `#${snapshot.sourceIssue.number}`,
			candidate.repository,
		)
		: null;
	return {
		kind: "snapshot",
		path: candidate.path,
		id: snapshot?.id ?? normalized.recoveredId,
		projectPath: snapshot?.projectPath ?? (normalized.recoveredProjectPath
			? resolve(normalized.recoveredProjectPath)
			: null),
		topic: snapshot?.topic ?? normalized.recoveredId ?? basename(candidate.path, ".json"),
		state: snapshot?.status ?? "unknown",
		issue,
		...(snapshot ? { snapshot } : {}),
		diagnostics: normalized.diagnostics.map((diagnostic) => ({
			...diagnostic,
			message: `${candidate.path}: ${diagnostic.message}`,
		})),
		warnings: [],
	};
}

function heading(markdown: string, fallback: string): string {
	return markdown.match(/^#\s+(?:Grill\s*[—–-]\s*)?(.+?)\s*$/m)?.[1]?.trim() || fallback;
}

function inspectHandoff(candidate: HandoffFileCandidate): InspectedHandoff | null {
	const projectPath = resolve(candidate.projectPath);
	if (candidate.readError) {
		return {
			kind: "handoff",
			path: candidate.path,
			id: null,
			projectPath,
			historicalProjectPath: null,
			topic: basename(candidate.path, ".md"),
			state: "unknown",
			issue: null,
			diagnostics: [{ code: "handoff-read-error", message: `${candidate.path}: ${candidate.readError}` }],
			warnings: [],
		};
	}
	const markdown = candidate.markdown ?? "";
	const artifact = inspectMarkdownArtifact({
		kind: "markdown",
		id: candidate.path,
		expectedType: "grill",
		location: "handoff",
		path: candidate.path,
		markdown,
	}, { repository: candidate.repository, projectRoot: projectPath });

	if (artifact.type !== "grill" && artifact.format !== "invalid" && artifact.format !== "conflict"
		&& artifact.format !== "absent") {
		return null;
	}
	const warnings = artifact.diagnostics.filter(({ code }) => code === "legacy-metadata");
	const blocking = artifact.diagnostics.filter(({ code }) => code !== "legacy-metadata");
	const historicalProjectPath = artifact.project;
	if (historicalProjectPath && resolve(historicalProjectPath) !== projectPath) {
		warnings.push({
			code: "historical-project-mismatch",
			message: `Handoff declares historical project ${historicalProjectPath}; operational root is ${projectPath}`,
		});
	}
	const validState = artifact.state === "paused" || artifact.state === "finalized";
	const valid = (artifact.format === "canonical" || artifact.format === "legacy")
		&& artifact.type === "grill"
		&& artifact.grill !== null
		&& validState
		&& blocking.length === 0;
	const diagnostics = valid
		? []
		: [{
			code: "invalid-handoff",
			message: `${candidate.path}: ${blocking.map(({ code, message }) => `${code}: ${message}`).join("; ") || "handoff identity or state is unusable"}`,
		}];
	return {
		kind: "handoff",
		path: candidate.path,
		id: artifact.grill,
		projectPath,
		historicalProjectPath,
		topic: heading(markdown, basename(candidate.path, ".md")),
		state: validState ? artifact.state : "unknown",
		issue: artifact.issue,
		markdown,
		diagnostics,
		warnings,
	};
}

function normalizedMarkdown(markdown: string): string {
	return markdown
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.filter((line) => !/^\s*<!--\s*SDD-Tracking\s*:.*-->\s*$/i.test(line))
		.join("\n")
		.trim();
}

function compatiblePersistedContent(
	snapshotMarkdown: string,
	handoffMarkdown: string,
	imported: boolean,
): boolean {
	const snapshotContent = normalizedMarkdown(snapshotMarkdown);
	const handoffContent = normalizedMarkdown(handoffMarkdown);
	if (snapshotContent === handoffContent) return true;
	return imported
		&& snapshotContent.length > 0
		&& handoffContent.startsWith(`${snapshotContent}\n\n## Continuidad runtime importada`);
}

function sameIssue(left: IssueRef | null, right: IssueRef | null): boolean {
	if (left === null || right === null) return left === right;
	return left.number === right.number && left.repository.toLowerCase() === right.repository.toLowerCase();
}

function groupKey(candidate: InspectedCandidate): string {
	if (candidate.projectPath && candidate.id) return `identity\0${resolve(candidate.projectPath)}\0${candidate.id}`;
	return `${candidate.kind}\0${candidate.path}`;
}

function publicKey(projectPath: string | null, id: string | null, paths: string[]): string {
	return `grill:${encodeURIComponent(projectPath ?? "global")}:${encodeURIComponent(id ?? [...paths].sort().join("|"))}`;
}

function diagnostic(code: string, message: string): ResolutionDiagnostic {
	return { code, message };
}

function buildEntry(group: InspectedCandidate[]): GrillInventoryEntry {
	const snapshots = group
		.filter((candidate): candidate is InspectedSnapshot => candidate.kind === "snapshot")
		.sort((left, right) => left.path.localeCompare(right.path));
	const handoffs = group
		.filter((candidate): candidate is InspectedHandoff => candidate.kind === "handoff")
		.sort((left, right) => left.path.localeCompare(right.path));
	const first = group[0]!;
	const projectPath = first.projectPath ? resolve(first.projectPath) : null;
	const grillId = first.id;
	const errors = group.flatMap((candidate) => candidate.diagnostics);
	const warnings = group.flatMap((candidate) => candidate.warnings);
	if (snapshots.length > 1) {
		errors.push(diagnostic("duplicate-grill-snapshot", `More than one snapshot claims ${grillId ?? "an unknown grill"}`));
	}

	const handoffBodies = new Set(handoffs
		.filter((candidate) => candidate.markdown !== undefined)
		.map((candidate) => normalizedMarkdown(candidate.markdown!)));
	if (handoffBodies.size > 1) {
		errors.push(diagnostic("divergent-handoffs", `Persisted handoffs disagree for ${grillId ?? "an unknown grill"}`));
	}

	const snapshotCandidate = snapshots[0];
	const handoffCandidate = handoffs[0];
	const snapshot = snapshotCandidate?.snapshot;
	let state: GrillStatus | "unknown" = snapshotCandidate?.state ?? handoffCandidate?.state ?? "unknown";
	let authority: "snapshot" | "handoff" | null = null;
	let issue = snapshotCandidate?.issue ?? handoffCandidate?.issue ?? null;

	if (errors.length === 0 && snapshotCandidate && handoffCandidate) {
		if (!snapshot || snapshotCandidate.id !== handoffCandidate.id) {
			errors.push(diagnostic("grill-identity-mismatch", "Snapshot and handoff identities are incompatible"));
		} else {
			const compatibleState = snapshot.status === "active"
				? handoffCandidate.state === "paused"
				: handoffCandidate.state === snapshot.status;
			if (!compatibleState) {
				errors.push(diagnostic(
					"grill-state-mismatch",
					`Snapshot state ${snapshot.status} is incompatible with handoff state ${handoffCandidate.state}`,
				));
			}
			if (!sameIssue(snapshotCandidate.issue, handoffCandidate.issue)) {
				errors.push(diagnostic("grill-issue-mismatch", "Snapshot and handoff issue identities differ"));
			}
			const snapshotMarkdown = snapshot.importedHandoff?.markdown ?? snapshot.handoffMarkdown;
			if (snapshotMarkdown !== undefined && handoffCandidate.markdown !== undefined
				&& !compatiblePersistedContent(
					snapshotMarkdown,
					handoffCandidate.markdown,
					snapshot.importedHandoff !== undefined,
				)) {
				errors.push(diagnostic("grill-content-mismatch", "Snapshot and persisted handoff contents differ"));
			}
			state = snapshot.status;
			issue = snapshotCandidate.issue;
			authority = snapshot.status === "active" ? "snapshot" : "handoff";
		}
	} else if (errors.length === 0 && snapshotCandidate) {
		if (!snapshot) {
			errors.push(diagnostic("invalid-snapshot", `Snapshot ${snapshotCandidate.path} is unusable`));
		} else if (snapshot.status !== "active") {
			errors.push(diagnostic(
				"missing-persisted-handoff",
				`${snapshot.status} grill ${snapshot.id} requires its persisted handoff`,
			));
		} else {
			authority = "snapshot";
			state = snapshot.status;
		}
	} else if (errors.length === 0 && handoffCandidate) {
		authority = "handoff";
		state = handoffCandidate.state;
		issue = handoffCandidate.issue;
	}

	if (errors.length > 0) authority = null;
	const authoritativeTopic = authority === "snapshot"
		? snapshotCandidate?.topic
		: authority === "handoff"
			? handoffCandidate?.topic
			: snapshotCandidate?.topic ?? handoffCandidate?.topic;
	const paths = [...snapshots.map(({ path }) => path), ...handoffs.map(({ path }) => path)];
	return {
		key: publicKey(projectPath, grillId, paths),
		grillId,
		topic: authoritativeTopic ?? grillId ?? basename(first.path),
		projectPath,
		historicalProjectPath: handoffCandidate?.historicalProjectPath ?? null,
		state,
		authority,
		valid: errors.length === 0 && authority !== null,
		diagnostics: errors,
		warnings,
		...(snapshot ? { snapshot } : {}),
		...(handoffCandidate?.markdown !== undefined ? { handoffMarkdown: handoffCandidate.markdown } : {}),
		...(snapshotCandidate ? { snapshotPath: snapshotCandidate.path } : {}),
		handoffPaths: handoffs.map(({ path }) => path),
		issue,
	};
}

export function reconcileGrillInventory(input: {
	snapshots: SnapshotFileCandidate[];
	handoffs: HandoffFileCandidate[];
}): GrillInventory {
	const candidates: InspectedCandidate[] = [
		...input.snapshots.map(inspectSnapshot),
		...input.handoffs
			.filter(({ path }) => path.endsWith(".md") && !path.endsWith("-cuestionario.md"))
			.map(inspectHandoff)
			.filter((candidate): candidate is InspectedHandoff => candidate !== null),
	];
	const groups = new Map<string, InspectedCandidate[]>();
	for (const candidate of candidates) {
		const key = groupKey(candidate);
		groups.set(key, [...(groups.get(key) ?? []), candidate]);
	}
	const entries = [...groups.values()].map(buildEntry).sort((left, right) => {
		const topic = left.topic.localeCompare(right.topic);
		return topic !== 0 ? topic : left.key.localeCompare(right.key);
	});
	return { entries };
}

export function inventoryActions(entry: GrillInventoryEntry): GrillInventoryAction[] {
	if (!entry.valid) return ["inspect"];
	if (entry.state === "finalized") return ["inspect", "create-spec", "duplicate"];
	if (entry.state === "active" || entry.state === "paused") return ["inspect", "resume"];
	return ["inspect"];
}

export function filterGrillInventory(
	inventory: GrillInventory,
	options: {
		currentProject: string;
		scope: "current-project" | "all";
		status: "resumable" | "active" | "paused" | "finalized" | "all";
		query?: string;
		limit: number;
	},
): { entries: GrillInventoryEntry[]; unattributedErrorCount: number } {
	const currentProject = resolve(options.currentProject);
	const query = options.query?.trim().toLowerCase();
	const unattributedErrorCount = inventory.entries.filter((entry) => entry.projectPath === null && !entry.valid).length;
	const entries = inventory.entries.filter((entry) => {
		if (options.scope === "current-project" && entry.projectPath !== currentProject) return false;
		if (entry.valid) {
			if (options.status === "resumable" && entry.state === "finalized") return false;
			if (options.status !== "all" && options.status !== "resumable" && entry.state !== options.status) return false;
		}
		if (query) {
			const searchable = [
				entry.topic,
				entry.grillId ?? "",
				entry.snapshotPath ?? "",
				...entry.handoffPaths,
			].join("\n").toLowerCase();
			if (!searchable.includes(query)) return false;
		}
		return true;
	}).slice(0, options.limit);
	return { entries, unattributedErrorCount };
}
