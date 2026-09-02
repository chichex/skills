import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import {
	parseSddArtifact,
	type ArtifactType,
	type NormalizedArtifactState,
	type StateProvenance,
} from "../sdd-artifacts/index.ts";

export interface IssueRef {
	repository: string;
	number: number;
}

export interface ResolutionDiagnostic {
	code: string;
	message: string;
}

export type ArtifactLocation = "local" | "issue" | "handoff" | "snapshot";
export type ArtifactFormat = "canonical" | "legacy" | "absent" | "invalid" | "conflict" | "snapshot";
export type ArtifactState = NormalizedArtifactState | "active";
export type ArtifactProvenance = StateProvenance | "snapshot";
export type IdentityProvenance = "canonical" | "legacy" | "filename" | "location" | "snapshot" | "absent";
export type Freshness = "fresh" | "stale" | "unknown";

export interface MarkdownArtifactCandidate {
	kind: "markdown";
	id: string;
	expectedType: "spec" | "grill";
	location: Exclude<ArtifactLocation, "snapshot">;
	path: string;
	markdown: string;
	hostIssue?: IssueRef;
	freshness?: FreshnessEvidence;
}

export interface GrillSnapshotCandidate {
	kind: "grill-snapshot";
	id: string;
	path: string;
	grillId: string;
	state: "active" | "paused" | "finalized";
	issue: IssueRef | null;
	projectPath: string;
	parentId: string | null;
	revision: number;
}

export type ArtifactCandidate = MarkdownArtifactCandidate | GrillSnapshotCandidate;

export interface ArtifactInspectionContext {
	repository: string;
	projectRoot: string;
}

export interface ArtifactRef {
	id: string;
	location: ArtifactLocation;
	path: string;
	type: ArtifactType | "unknown";
	state: ArtifactState;
	format: ArtifactFormat;
	provenance: ArtifactProvenance;
	identityProvenance: IdentityProvenance;
	issue: IssueRef | null;
	grill: string | null;
	project: string | null;
	supersededBy: string | null;
	parentId: string | null;
	revision: number | null;
	freshness: Freshness;
	primary: boolean;
	diagnostics: ResolutionDiagnostic[];
}

export type MaterialEventKind = "title" | "body" | "comment";
export type AdministrativeEventKind = "labels" | "assignees" | "milestone";
export type IssueEventKind = MaterialEventKind | AdministrativeEventKind;

export interface TemporalEvent {
	kind: IssueEventKind;
	at: string | null;
}

export interface FreshnessEvidenceInput {
	baseline: { source: "local-file" | "issue-body"; at: string | null };
	historyComplete: boolean;
	events: TemporalEvent[];
}

export interface FreshnessEvidence {
	baseline: { source: "local-file" | "issue-body"; at: string | null };
	historyComplete: boolean;
	materialEvents: TemporalEvent[];
	administrativeEvents: TemporalEvent[];
	freshness: Freshness;
	diagnostics: ResolutionDiagnostic[];
}

const MATERIAL_EVENTS = new Set<IssueEventKind>(["title", "body", "comment"]);

function comparableTimestamp(value: string | null): number | null {
	if (value === null || value.trim() === "") return null;
	const normalized = value.trim();
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) return null;
	const timestamp = Date.parse(normalized);
	return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildFreshnessEvidence(input: FreshnessEvidenceInput): FreshnessEvidence {
	const materialEvents = input.events
		.filter((event) => MATERIAL_EVENTS.has(event.kind))
		.map((event) => ({ kind: event.kind, at: event.at }));
	const administrativeEvents = input.events
		.filter((event) => !MATERIAL_EVENTS.has(event.kind))
		.map((event) => ({ kind: event.kind, at: event.at }));
	const diagnostics: ResolutionDiagnostic[] = [];
	const baselineTimestamp = comparableTimestamp(input.baseline.at);

	if (baselineTimestamp !== null) {
		for (const event of materialEvents) {
			const eventTimestamp = comparableTimestamp(event.at);
			if (eventTimestamp !== null && eventTimestamp > baselineTimestamp) {
				return {
					baseline: { ...input.baseline },
					historyComplete: input.historyComplete,
					materialEvents,
					administrativeEvents,
					freshness: "stale",
					diagnostics,
				};
			}
		}
	}

	if (baselineTimestamp === null) {
		diagnostics.push({ code: "missing-baseline", message: "Artifact baseline timestamp is missing or incomparable" });
	}
	for (const event of materialEvents) {
		if (comparableTimestamp(event.at) === null) {
			diagnostics.push({
				code: "incomparable-material-event",
				message: `Material ${event.kind} event has no comparable timestamp`,
			});
		}
	}
	if (!input.historyComplete) {
		diagnostics.push({ code: "incomplete-history", message: "Material issue history is incomplete" });
	}

	return {
		baseline: { ...input.baseline },
		historyComplete: input.historyComplete,
		materialEvents,
		administrativeEvents,
		freshness: diagnostics.length === 0 ? "fresh" : "unknown",
		diagnostics,
	};
}

function normalizeRepository(repository: string): string {
	return repository.trim();
}

export function normalizeIssueRef(reference: string | IssueRef | null, repository: string): IssueRef | null {
	if (reference === null) return null;
	if (typeof reference !== "string") {
		if (!Number.isInteger(reference.number) || reference.number <= 0) return null;
		return { repository: normalizeRepository(reference.repository), number: reference.number };
	}
	const relative = /^#([1-9]\d*)$/.exec(reference);
	if (relative?.[1]) return { repository: normalizeRepository(repository), number: Number(relative[1]) };
	const qualified = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#([1-9]\d*)$/.exec(reference);
	if (!qualified?.[1] || !qualified[2]) return null;
	const candidateRepository = qualified[1];
	return {
		repository: candidateRepository.toLowerCase() === repository.toLowerCase()
			? normalizeRepository(repository)
			: candidateRepository,
		number: Number(qualified[2]),
	};
}

function parserDiagnostics(
	diagnostics: ReadonlyArray<{ code: string; message: string }>,
): ResolutionDiagnostic[] {
	return diagnostics.map(({ code, message }) => ({ code, message }));
}

function sameIssue(left: IssueRef, right: IssueRef): boolean {
	return left.number === right.number && left.repository.toLowerCase() === right.repository.toLowerCase();
}

function issueFromFileName(path: string, repository: string): IssueRef | null {
	const number = issueNumberHintFromPath(path);
	return number === null ? null : { repository: normalizeRepository(repository), number };
}

export function inspectMarkdownArtifact(
	candidate: MarkdownArtifactCandidate,
	context: ArtifactInspectionContext,
): ArtifactRef {
	const parsed = parseSddArtifact(candidate.markdown);
	const diagnostics = parserDiagnostics(parsed.diagnostics);
	if (parsed.kind === "metadata" && parsed.format === "legacy") {
		diagnostics.push({ code: "legacy-metadata", message: "Artifact identity or lifecycle comes from legacy metadata" });
	} else if (parsed.kind === "absent") {
		diagnostics.push({ code: "missing-metadata", message: "Artifact-shaped Markdown has no SDD metadata" });
	}
	const metadata = parsed.kind === "metadata" ? parsed.metadata : null;
	const hostIssue = candidate.hostIssue ? normalizeIssueRef(candidate.hostIssue, context.repository) : null;
	const filenameIssue = candidate.expectedType === "spec"
		? issueFromFileName(candidate.path, context.repository)
		: null;
	let issue: IssueRef | null = null;
	let identityProvenance: IdentityProvenance = "absent";

	if (metadata && metadata.type !== "project") {
		issue = normalizeIssueRef(metadata.issue, context.repository);
		if (parsed.format === "canonical") {
			identityProvenance = "canonical";
		} else if (issue) {
			identityProvenance = "legacy";
		} else if (filenameIssue) {
			issue = filenameIssue;
			identityProvenance = "filename";
			diagnostics.push({
				code: "identity-from-filename",
				message: `Recovered legacy issue identity from ${basename(candidate.path)}`,
			});
		} else if (candidate.location === "issue" && hostIssue) {
			issue = hostIssue;
			identityProvenance = "location";
			diagnostics.push({ code: "identity-from-location", message: "Recovered legacy issue identity from its host issue" });
		}
	} else if (parsed.kind === "absent") {
		if (candidate.location === "issue" && hostIssue) {
			issue = hostIssue;
			identityProvenance = "location";
			diagnostics.push({ code: "identity-from-location", message: "Recovered absent issue identity from its host issue" });
		} else if (filenameIssue) {
			issue = filenameIssue;
			identityProvenance = "filename";
			diagnostics.push({
				code: "identity-from-filename",
				message: `Recovered absent issue identity from ${basename(candidate.path)}`,
			});
		}
	} else if (candidate.location === "issue" && hostIssue) {
		// Invalid canonical metadata never falls back to legacy or a filename.
		// The GitHub issue that physically hosts the body is nevertheless a
		// safe association and remains explicitly diagnosed as such.
		issue = hostIssue;
		identityProvenance = "location";
		diagnostics.push({ code: "identity-from-location", message: "Associated malformed metadata through its host issue" });
	}

	if (hostIssue && (!issue || !sameIssue(hostIssue, issue))) {
		diagnostics.push({
			code: "issue-mismatch",
			message: `Artifact identity does not match host issue ${hostIssue.repository}#${hostIssue.number}`,
		});
	}
	if (filenameIssue && identityProvenance !== "filename" && (!issue || !sameIssue(filenameIssue, issue))) {
		diagnostics.push({
			code: "filename-identity-mismatch",
			message: `Artifact identity does not match filename ${basename(candidate.path)}`,
		});
	}
	if (metadata && metadata.type !== candidate.expectedType) {
		diagnostics.push({
			code: "artifact-type-mismatch",
			message: `Expected ${candidate.expectedType} metadata but parsed ${metadata.type}`,
		});
	}

	const grill = metadata && metadata.type !== "project" ? metadata.grill : null;
	const project = metadata?.type === "grill"
		? metadata.project
		: metadata && metadata.type === "unknown"
			? metadata.project
			: null;
	const supersededBy = metadata?.type === "spec" ? metadata.supersededBy : null;
	const format: ArtifactFormat = parsed.kind === "metadata" ? parsed.format : parsed.kind;
	const type = metadata?.type ?? candidate.expectedType;

	return {
		id: candidate.id,
		location: candidate.location,
		path: candidate.path,
		type,
		state: parsed.state.value,
		format,
		provenance: parsed.state.provenance,
		identityProvenance,
		issue,
		grill,
		project,
		supersededBy,
		parentId: null,
		revision: null,
		freshness: candidate.freshness?.freshness ?? "unknown",
		primary: false,
		diagnostics,
	};
}

export function inspectGrillSnapshot(
	candidate: GrillSnapshotCandidate,
	context: ArtifactInspectionContext,
): ArtifactRef {
	const diagnostics: ResolutionDiagnostic[] = [];
	const issue = normalizeIssueRef(candidate.issue, context.repository);
	if (candidate.grillId.trim() === "") {
		diagnostics.push({ code: "invalid-grill-snapshot", message: "Snapshot grill id is empty" });
	}
	if (!Number.isInteger(candidate.revision) || candidate.revision < 1) {
		diagnostics.push({ code: "invalid-grill-snapshot", message: "Snapshot revision must be a positive integer" });
	}
	if (candidate.parentId === candidate.grillId) {
		diagnostics.push({ code: "invalid-grill-snapshot", message: "Snapshot cannot be its own parent" });
	}
	if (resolve(candidate.projectPath) !== resolve(context.projectRoot)) {
		diagnostics.push({ code: "project-mismatch", message: "Snapshot belongs to another project" });
	}
	return {
		id: candidate.id,
		location: "snapshot",
		path: candidate.path,
		type: "grill",
		state: candidate.state,
		format: "snapshot",
		provenance: "snapshot",
		identityProvenance: "snapshot",
		issue,
		grill: candidate.grillId,
		project: candidate.projectPath,
		supersededBy: null,
		parentId: candidate.parentId,
		revision: candidate.revision,
		freshness: "unknown",
		primary: false,
		diagnostics,
	};
}

export function inspectArtifactCandidate(
	candidate: ArtifactCandidate,
	context: ArtifactInspectionContext,
): ArtifactRef {
	return candidate.kind === "markdown"
		? inspectMarkdownArtifact(candidate, context)
		: inspectGrillSnapshot(candidate, context);
}

export function issueNumberHintFromPath(path: string): number | null {
	const value = basename(path).match(/^issue-([1-9]\d*)(?:-|\.md$)/i)?.[1];
	return value ? Number(value) : null;
}

export type NewWorkRoute =
	| "blocked-dependency"
	| "split-too-large"
	| "grill"
	| "spec"
	| "quick-run"
	| "incoherent-selection"
	| "combined-too-large"
	| "join-grill"
	| "join-spec"
	| "join-quick-run";

export type ExistingWorkRoute =
	| "resume-grill"
	| "spec-from-grill"
	| "update-existing-spec"
	| "run-existing-spec"
	| "already-implemented"
	| "superseded-artifact"
	| "audit-existing-spec"
	| "artifact-conflict";

export type WorkflowRoute = NewWorkRoute | ExistingWorkRoute;
export type WorkflowStage = "grill" | "spec" | "quick-run" | "run-existing-spec";
export type WorkflowMode = "new" | "resume" | "update" | "from-grill";

export interface EvidenceRef {
	kind: string;
	reference: string;
	detail: string;
}

export interface WorkflowResolutionInput {
	repository: string;
	cwd: string;
	sources: IssueRef[];
	canonicalIssue: IssueRef | null;
	canonicalIssueUsable: boolean;
	recommendedClassification: NewWorkRoute | null;
	fallbackClassification: NewWorkRoute | null;
	summary: string;
	impactExample: string;
	scope: string[];
	checklist: string[];
	evidence: EvidenceRef[];
	risks: string[];
	artifacts: ArtifactCandidate[];
}

interface WorkflowResolutionBaseV1 {
	version: 1;
	recommendedClassification: NewWorkRoute | null;
	fallbackClassification: NewWorkRoute | null;
	recommendedRoute: WorkflowRoute | null;
	selectedRoute: WorkflowRoute | null;
	repo: string;
	cwd: string;
	sources: IssueRef[];
	canonicalIssue: IssueRef | null;
	summary: string;
	impactExample: string;
	scope: string[];
	checklist: string[];
	evidence: EvidenceRef[];
	risks: string[];
	artifacts: ArtifactRef[];
}

export type WorkflowResolutionV1 =
	| (WorkflowResolutionBaseV1 & {
		outcome: "start";
		code: WorkflowRoute;
		stage: WorkflowStage;
		mode: WorkflowMode | null;
	})
	| (WorkflowResolutionBaseV1 & {
		outcome: "stop";
		code: WorkflowRoute | "cancelled";
		stage: null;
		mode: null;
	})
	| (WorkflowResolutionBaseV1 & {
		outcome: "error";
		code: "canonicalization";
		stage: null;
		mode: null;
	});

type Dispatch =
	| { outcome: "start"; stage: WorkflowStage; mode: WorkflowMode | null }
	| { outcome: "stop"; stage: null; mode: null };

const STOP_CLASSIFICATIONS = new Set<NewWorkRoute>([
	"blocked-dependency",
	"split-too-large",
	"incoherent-selection",
	"combined-too-large",
]);

function dispatchForRoute(route: WorkflowRoute): Dispatch {
	if (route === "grill" || route === "join-grill") return { outcome: "start", stage: "grill", mode: "new" };
	if (route === "spec" || route === "join-spec") return { outcome: "start", stage: "spec", mode: "new" };
	if (route === "quick-run" || route === "join-quick-run") {
		return { outcome: "start", stage: "quick-run", mode: "new" };
	}
	if (route === "resume-grill") return { outcome: "start", stage: "grill", mode: "resume" };
	if (route === "spec-from-grill") return { outcome: "start", stage: "spec", mode: "from-grill" };
	if (route === "update-existing-spec" || route === "audit-existing-spec") {
		return { outcome: "start", stage: "spec", mode: "update" };
	}
	if (route === "run-existing-spec") return { outcome: "start", stage: "run-existing-spec", mode: null };
	if (STOP_CLASSIFICATIONS.has(route as NewWorkRoute)
		|| route === "already-implemented"
		|| route === "superseded-artifact"
		|| route === "artifact-conflict") {
		return { outcome: "stop", stage: null, mode: null };
	}
	return { outcome: "stop", stage: null, mode: null };
}

function normalizedIssueInput(reference: IssueRef | null, repository: string): IssueRef | null {
	return reference === null ? null : normalizeIssueRef(reference, repository);
}

function baseResolution(
	input: WorkflowResolutionInput,
	route: WorkflowRoute | null,
	artifacts: ArtifactRef[],
): WorkflowResolutionV1 {
	const dispatch = route === null
		? { outcome: "stop" as const, stage: null, mode: null }
		: dispatchForRoute(route);
	return {
		version: 1,
		outcome: dispatch.outcome,
		code: route ?? "artifact-conflict",
		recommendedClassification: input.recommendedClassification,
		fallbackClassification: input.fallbackClassification,
		recommendedRoute: route,
		selectedRoute: null,
		stage: dispatch.stage,
		mode: dispatch.mode,
		repo: normalizeRepository(input.repository),
		cwd: input.cwd,
		sources: input.sources
			.map((source) => normalizeIssueRef(source, input.repository))
			.filter((source): source is IssueRef => source !== null),
		canonicalIssue: normalizedIssueInput(input.canonicalIssue, input.repository),
		summary: input.summary,
		impactExample: input.impactExample,
		scope: [...input.scope],
		checklist: [...input.checklist],
		evidence: input.evidence.map((item) => ({ ...item })),
		risks: [...input.risks],
		artifacts,
	};
}

function canonicalizationError(input: WorkflowResolutionInput): WorkflowResolutionV1 {
	return {
		...baseResolution(input, null, []),
		outcome: "error",
		code: "canonicalization",
		recommendedRoute: null,
		selectedRoute: null,
		stage: null,
		mode: null,
	};
}

function explicitCandidateIssue(
	candidate: ArtifactCandidate,
	context: ArtifactInspectionContext,
): IssueRef | null {
	if (candidate.kind === "grill-snapshot") return normalizeIssueRef(candidate.issue, context.repository);
	return candidate.location === "issue" && candidate.hostIssue
		? normalizeIssueRef(candidate.hostIssue, context.repository)
		: null;
}

function issueIsOriginalSource(issue: IssueRef, input: WorkflowResolutionInput, target: IssueRef): boolean {
	return input.sources.length > 1
		&& !sameIssue(issue, target)
		&& input.sources.some((source) => {
			const normalized = normalizeIssueRef(source, input.repository);
			return normalized !== null && sameIssue(normalized, issue);
		});
}

function candidateAllowedInInventory(
	candidate: ArtifactCandidate,
	input: WorkflowResolutionInput,
	target: IssueRef,
	context: ArtifactInspectionContext,
): boolean {
	const explicitIssue = explicitCandidateIssue(candidate, context);
	return explicitIssue === null || !issueIsOriginalSource(explicitIssue, input, target);
}

function candidateTargetsIssue(
	candidate: ArtifactCandidate,
	artifact: ArtifactRef,
	target: IssueRef,
	context: ArtifactInspectionContext,
): boolean {
	if (artifact.issue && sameIssue(artifact.issue, target)) return true;
	if (candidate.kind === "grill-snapshot") return false;
	const host = candidate.hostIssue ? normalizeIssueRef(candidate.hostIssue, context.repository) : null;
	if (host && sameIssue(host, target)) return true;
	const hint = candidate.expectedType === "spec" ? issueFromFileName(candidate.path, context.repository) : null;
	return hint !== null && sameIssue(hint, target);
}

function candidateMatchesSuccessor(
	source: InspectedArtifact,
	candidate: InspectedArtifact,
	input: WorkflowResolutionInput,
	target: IssueRef,
	context: ArtifactInspectionContext,
): boolean {
	const reference = source.artifact.supersededBy;
	if (reference === null) return false;
	const issueReference = issueReferenceFromSuccessor(reference, input.repository);
	if (issueReference) {
		if (issueReference.repository.toLowerCase() !== input.repository.toLowerCase()) return false;
		if (issueIsOriginalSource(issueReference, input, target)) return false;
		return candidateTargetsIssue(candidate.candidate, candidate.artifact, issueReference, context);
	}
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) return false;

	const projectRoot = resolve(input.cwd);
	const paths = new Set<string>();
	if (isAbsolute(reference)) {
		paths.add(resolve(reference));
	} else {
		paths.add(resolve(projectRoot, reference));
		if (source.candidate.kind === "markdown" && source.candidate.location === "local") {
			paths.add(resolve(dirname(source.candidate.path), reference));
		}
	}
	if ([...paths].some((path) => !pathInsideProject(path, projectRoot))) return false;
	if (candidate.candidate.kind !== "markdown" || candidate.candidate.location !== "local") return false;
	if (candidate.artifact.issue && issueIsOriginalSource(candidate.artifact.issue, input, target)) return false;
	return paths.has(resolve(candidate.candidate.path));
}

function relevantArtifactEntries(
	allEntries: InspectedArtifact[],
	input: WorkflowResolutionInput,
	target: IssueRef,
	context: ArtifactInspectionContext,
): InspectedArtifact[] {
	const selected = new Set<number>();
	allEntries.forEach((entry, index) => {
		if (candidateTargetsIssue(entry.candidate, entry.artifact, target, context)) selected.add(index);
	});

	let changed = true;
	while (changed) {
		changed = false;
		for (const sourceIndex of [...selected]) {
			const source = allEntries[sourceIndex];
			if (!source || source.artifact.type !== "spec" || source.artifact.state !== "superseded") continue;
			allEntries.forEach((candidate, candidateIndex) => {
				if (selected.has(candidateIndex)) return;
				if (candidateMatchesSuccessor(source, candidate, input, target, context)) {
					selected.add(candidateIndex);
					changed = true;
				}
			});
		}
	}
	return allEntries.filter((_entry, index) => selected.has(index));
}

function normalizeIssueMarkers(markdown: string, repository: string): string {
	return markdown
		.split("\n")
		.map((line) => {
			if (!/^[ \t]*<!--\s*SDD-Tracking\s*:/i.test(line)) return line;
			return line.replace(
				/(\bissue\s*=\s*)(#[1-9]\d*|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#[1-9]\d*)/i,
				(_match, prefix: string, raw: string) => {
					const normalized = normalizeIssueRef(raw, repository);
					return normalized
						? `${prefix}${repository}#${normalized.number}`
						: `${prefix}${raw}`;
				},
			);
		})
		.join("\n");
}

export function normalizeNormativeSpecContent(
	markdown: string,
	repository: string,
	location: "local" | "issue",
): string {
	let normalized = markdown.replace(/\r\n?/g, "\n");
	if (location === "issue") {
		normalized = normalized.replace(
			/\n[ \t\n]*<details><summary>Body original<\/summary>\n[\s\S]*?\n<\/details>[ \t\n]*$/,
			"\n",
		);
	}
	normalized = normalizeIssueMarkers(normalized, repository);
	return `${normalized.replace(/\n*$/, "")}\n`;
}

function normativeSpecContent(candidate: MarkdownArtifactCandidate, repository: string): string {
	return normalizeNormativeSpecContent(
		candidate.markdown,
		repository,
		candidate.location === "issue" ? "issue" : "local",
	);
}

function routeSingleSpec(spec: ArtifactRef): WorkflowRoute {
	if (spec.state === "draft") return "update-existing-spec";
	if (spec.state === "approved") {
		return spec.freshness === "fresh" ? "run-existing-spec" : "audit-existing-spec";
	}
	if (spec.state === "implemented") {
		return spec.freshness === "fresh" ? "already-implemented" : "audit-existing-spec";
	}
	if (spec.state === "superseded") return "superseded-artifact";
	return "audit-existing-spec";
}

const BLOCKING_ARTIFACT_DIAGNOSTICS = new Set([
	"issue-mismatch",
	"filename-identity-mismatch",
	"artifact-type-mismatch",
	"conflicting-canonical",
	"legacy-type-conflict",
	"legacy-state-conflict",
	"invalid-grill-snapshot",
	"project-mismatch",
]);

interface InspectedArtifact {
	candidate: ArtifactCandidate;
	artifact: ArtifactRef;
}

interface InspectedMarkdownArtifact extends InspectedArtifact {
	candidate: MarkdownArtifactCandidate;
}

interface SpecNode {
	entries: InspectedMarkdownArtifact[];
	content: string;
	primary: InspectedMarkdownArtifact;
}

function canMergeAsCopies(node: SpecNode, entry: InspectedMarkdownArtifact): boolean {
	if (node.entries.some(({ candidate }) => candidate.path === entry.candidate.path)) return true;
	const hasLocal = node.entries.some(({ candidate }) => candidate.location === "local");
	const hasIssue = node.entries.some(({ candidate }) => candidate.location === "issue");
	if (entry.candidate.location === "local") return !hasLocal && hasIssue;
	if (entry.candidate.location === "issue") return !hasIssue && hasLocal;
	return false;
}

function specNodes(entries: InspectedMarkdownArtifact[], repository: string): SpecNode[] {
	const nodes: SpecNode[] = [];
	for (const entry of entries) {
		const content = normativeSpecContent(entry.candidate, repository);
		const existing = nodes.find((node) => node.content === content && canMergeAsCopies(node, entry));
		if (existing) {
			existing.entries.push(entry);
			existing.primary = existing.entries.find(({ candidate }) => candidate.location === "local") ?? existing.entries[0]!;
			continue;
		}
		nodes.push({ entries: [entry], content, primary: entry });
	}
	return nodes;
}

function withArtifactDiagnostic(
	artifacts: ArtifactRef[],
	ids: ReadonlySet<string>,
	code: string,
	message: string,
): ArtifactRef[] {
	return artifacts.map((artifact) => ids.has(artifact.id)
		? { ...artifact, diagnostics: [...artifact.diagnostics, { code, message }] }
		: artifact);
}

function nodeIds(nodes: SpecNode[], indexes: Iterable<number>): Set<string> {
	const ids = new Set<string>();
	for (const index of indexes) {
		for (const entry of nodes[index]?.entries ?? []) ids.add(entry.artifact.id);
	}
	return ids;
}

function pathInsideProject(path: string, projectRoot: string): boolean {
	const relation = relative(resolve(projectRoot), resolve(path));
	return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function issueReferenceFromSuccessor(reference: string, repository: string): IssueRef | null {
	const direct = normalizeIssueRef(reference, repository);
	if (direct) return direct;
	const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)\/?$/i.exec(reference);
	return url?.[1] && url[2]
		? normalizeIssueRef(`${url[1]}#${url[2]}`, repository)
		: null;
}

type SuccessorResolution =
	| { kind: "resolved"; index: number }
	| { kind: "unusable" }
	| { kind: "ambiguous"; indexes: number[] };

function resolveSuccessor(
	reference: string,
	source: SpecNode,
	nodes: SpecNode[],
	input: WorkflowResolutionInput,
): SuccessorResolution {
	const issueReference = issueReferenceFromSuccessor(reference, input.repository);
	if (issueReference) {
		if (issueReference.repository.toLowerCase() !== input.repository.toLowerCase()) return { kind: "unusable" };
		const matches = nodes
			.map((node, index) => ({ node, index }))
			.filter(({ node }) => node.entries.some(({ candidate, artifact }) =>
				candidate.location === "issue"
				&& artifact.issue !== null
				&& sameIssue(artifact.issue, issueReference)))
			.map(({ index }) => index);
		if (matches.length === 1) return { kind: "resolved", index: matches[0]! };
		return matches.length > 1 ? { kind: "ambiguous", indexes: matches } : { kind: "unusable" };
	}
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) return { kind: "unusable" };

	const projectRoot = resolve(input.cwd);
	const candidates = new Set<string>();
	if (isAbsolute(reference)) {
		candidates.add(resolve(reference));
	} else {
		candidates.add(resolve(projectRoot, reference));
		for (const entry of source.entries) {
			if (entry.candidate.location === "local") {
				candidates.add(resolve(dirname(entry.candidate.path), reference));
			}
		}
	}
	if ([...candidates].some((candidate) => !pathInsideProject(candidate, projectRoot))) return { kind: "unusable" };
	const matches = nodes
		.map((node, index) => ({ node, index }))
		.filter(({ node }) => node.entries.some(({ candidate }) =>
			candidate.location === "local" && candidates.has(resolve(candidate.path))))
		.map(({ index }) => index);
	if (matches.length === 1) return { kind: "resolved", index: matches[0]! };
	return matches.length > 1 ? { kind: "ambiguous", indexes: matches } : { kind: "unusable" };
}

function routeSpecGraph(
	entries: InspectedMarkdownArtifact[],
	input: WorkflowResolutionInput,
	initialArtifacts: ArtifactRef[],
): { route: WorkflowRoute; artifacts: ArtifactRef[]; leaf: ArtifactRef | null } {
	const nodes = specNodes(entries, input.repository);
	const edges = new Map<number, number>();
	let artifacts = initialArtifacts;

	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index]!;
		if (node.primary.artifact.state !== "superseded") continue;
		const successor = node.primary.artifact.supersededBy;
		const resolution = successor === null
			? { kind: "unusable" as const }
			: resolveSuccessor(successor, node, nodes, input);
		if (resolution.kind === "unusable") {
			artifacts = withArtifactDiagnostic(
				artifacts,
				nodeIds(nodes, [index]),
				"superseded-target-unusable",
				`Superseded target ${successor ?? "<missing>"} is absent, external, or outside the project`,
			);
			return { route: "superseded-artifact", artifacts, leaf: null };
		}
		if (resolution.kind === "ambiguous") {
			artifacts = withArtifactDiagnostic(
				artifacts,
				nodeIds(nodes, [index, ...resolution.indexes]),
				"ambiguous-superseded-target",
				`Superseded target ${successor} resolves to more than one artifact`,
			);
			return { route: "artifact-conflict", artifacts, leaf: null };
		}
		edges.set(index, resolution.index);
	}

	const cycleIndexes = new Set<number>();
	for (let start = 0; start < nodes.length; start += 1) {
		const path: number[] = [];
		const positions = new Map<number, number>();
		let current: number | undefined = start;
		while (current !== undefined) {
			const seenAt = positions.get(current);
			if (seenAt !== undefined) {
				for (const member of path.slice(seenAt)) cycleIndexes.add(member);
				break;
			}
			positions.set(current, path.length);
			path.push(current);
			current = edges.get(current);
		}
	}
	if (cycleIndexes.size > 0) {
		artifacts = withArtifactDiagnostic(
			artifacts,
			nodeIds(nodes, cycleIndexes),
			"lineage-cycle",
			"Spec supersession lineage contains a cycle",
		);
		return { route: "artifact-conflict", artifacts, leaf: null };
	}

	const leaves = nodes
		.map((node, index) => ({ node, index }))
		.filter(({ node }) => node.primary.artifact.state !== "superseded")
		.map(({ index }) => index);
	if (leaves.length !== 1) {
		artifacts = withArtifactDiagnostic(
			artifacts,
			nodeIds(nodes, nodes.map((_node, index) => index)),
			"parallel-live-specs",
			"Specs for the same issue have parallel or missing live leaves",
		);
		return { route: "artifact-conflict", artifacts, leaf: null };
	}

	const leaf = nodes[leaves[0]!]!;
	artifacts = artifacts.map((artifact) => ({ ...artifact, primary: artifact.id === leaf.primary.artifact.id }));
	const primary = artifacts.find((artifact) => artifact.primary)!;
	return { route: routeSingleSpec(primary), artifacts, leaf: primary };
}

interface GrillNode {
	grillId: string;
	entries: InspectedArtifact[];
	primary: InspectedArtifact;
	state: "active" | "paused" | "finalized";
	parentId: string | null;
	revision: number | null;
}

interface GrillGraphResolution {
	route: WorkflowRoute;
	artifacts: ArtifactRef[];
	leafGrillId: string | null;
	leafState: "active" | "paused" | "finalized" | null;
}

function idsForEntries(entries: InspectedArtifact[]): Set<string> {
	return new Set(entries.map(({ artifact }) => artifact.id));
}

function routeGrillGraph(
	entries: InspectedArtifact[],
	initialArtifacts: ArtifactRef[],
): GrillGraphResolution {
	let artifacts = initialArtifacts;
	const missingIdentity = entries.filter(({ artifact }) => !artifact.grill);
	if (missingIdentity.length > 0) {
		artifacts = withArtifactDiagnostic(
			artifacts,
			idsForEntries(missingIdentity),
			"missing-grill-identity",
			"Grill artifact has no usable grill id",
		);
		return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
	}

	const groups = new Map<string, InspectedArtifact[]>();
	for (const entry of entries) {
		const grillId = entry.artifact.grill!;
		groups.set(grillId, [...(groups.get(grillId) ?? []), entry]);
	}
	const nodes: GrillNode[] = [];
	for (const [grillId, group] of groups) {
		const snapshots = group.filter(({ candidate }) => candidate.kind === "grill-snapshot");
		const handoffs = group.filter(({ candidate }) => candidate.kind === "markdown");
		if (snapshots.length > 1) {
			artifacts = withArtifactDiagnostic(
				artifacts,
				idsForEntries(group),
				"duplicate-grill-snapshot",
				`More than one runtime snapshot claims grill ${grillId}`,
			);
			return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
		}

		const projects = new Set(group.map(({ artifact }) => artifact.project && resolve(artifact.project)).filter(Boolean));
		const issues = group.map(({ artifact }) => artifact.issue).filter((value): value is IssueRef => value !== null);
		const identityMismatch = projects.size > 1
			|| issues.some((value) => !sameIssue(value, issues[0] ?? value));
		if (identityMismatch) {
			artifacts = withArtifactDiagnostic(
				artifacts,
				idsForEntries(group),
				"grill-identity-mismatch",
				`Snapshot and handoff disagree on identity for grill ${grillId}`,
			);
			return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
		}

		const snapshot = snapshots[0];
		const handoffStates = new Set(handoffs.map(({ artifact }) => artifact.state));
		let state: "active" | "paused" | "finalized";
		let primary: InspectedArtifact;
		if (snapshot) {
			state = snapshot.artifact.state as "active" | "paused" | "finalized";
			if (state === "active") {
				if ([...handoffStates].some((value) => value !== "paused")) {
					artifacts = withArtifactDiagnostic(
						artifacts,
						idsForEntries(group),
						"grill-state-mismatch",
						`Active snapshot ${grillId} is compatible only with a prior paused handoff`,
					);
					return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
				}
				primary = snapshot;
				if (handoffs.length === 0) {
					artifacts = withArtifactDiagnostic(
						artifacts,
						idsForEntries([snapshot]),
						"handoff-unavailable",
						`Active grill ${grillId} has no persisted handoff yet`,
					);
				}
			} else {
				if (handoffs.length === 0) {
					artifacts = withArtifactDiagnostic(
						artifacts,
						idsForEntries([snapshot]),
						"missing-persisted-handoff",
						`${state} grill ${grillId} requires its interoperable handoff`,
					);
					return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
				}
				if (handoffStates.size !== 1 || !handoffStates.has(state)) {
					artifacts = withArtifactDiagnostic(
						artifacts,
						idsForEntries(group),
						"grill-state-mismatch",
						`Snapshot and handoff disagree on persisted state for grill ${grillId}`,
					);
					return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
				}
				primary = handoffs[0]!;
			}
		} else {
			if (handoffStates.size !== 1 || (handoffStates.has("paused") === false && handoffStates.has("finalized") === false)) {
				artifacts = withArtifactDiagnostic(
					artifacts,
					idsForEntries(group),
					"grill-state-mismatch",
					`Persisted handoffs disagree for grill ${grillId}`,
				);
				return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
			}
			state = [...handoffStates][0] as "paused" | "finalized";
			primary = handoffs[0]!;
		}
		nodes.push({
			grillId,
			entries: group,
			primary,
			state,
			parentId: snapshot?.artifact.parentId ?? null,
			revision: snapshot?.artifact.revision ?? null,
		});
	}

	const byId = new Map(nodes.map((node, index) => [node.grillId, index]));
	const children = new Map<number, number[]>();
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index]!;
		if (node.parentId === null) continue;
		const parentIndex = byId.get(node.parentId);
		const parent = parentIndex === undefined ? undefined : nodes[parentIndex];
		if (parentIndex === undefined || !parent || node.revision === null || parent.revision === null
			|| node.revision !== parent.revision + 1) {
			artifacts = withArtifactDiagnostic(
				artifacts,
				idsForEntries(node.entries),
				"invalid-grill-parent",
				`Runtime parent/revision for grill ${node.grillId} is missing or inconsistent`,
			);
			return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
		}
		children.set(parentIndex, [...(children.get(parentIndex) ?? []), index]);
	}

	const cycle = new Set<number>();
	for (let start = 0; start < nodes.length; start += 1) {
		const seen = new Set<number>();
		let current: number | undefined = start;
		while (current !== undefined) {
			if (seen.has(current)) {
				for (const index of seen) cycle.add(index);
				break;
			}
			seen.add(current);
			const parentId = nodes[current]?.parentId;
			current = parentId ? byId.get(parentId) : undefined;
		}
	}
	if (cycle.size > 0) {
		artifacts = withArtifactDiagnostic(
			artifacts,
			idsForEntries([...cycle].flatMap((index) => nodes[index]?.entries ?? [])),
			"grill-lineage-cycle",
			"Runtime grill lineage contains a cycle",
		);
		return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
	}

	const leaves = nodes.map((_node, index) => index).filter((index) => (children.get(index) ?? []).length === 0);
	if (leaves.length !== 1) {
		artifacts = withArtifactDiagnostic(
			artifacts,
			idsForEntries(nodes.flatMap((node) => node.entries)),
			"parallel-grill-revisions",
			"Grill runtime lineage has parallel live revisions",
		);
		return { route: "artifact-conflict", artifacts, leafGrillId: null, leafState: null };
	}

	const leaf = nodes[leaves[0]!]!;
	artifacts = artifacts.map((artifact) => ({ ...artifact, primary: artifact.id === leaf.primary.artifact.id }));
	return {
		route: leaf.state === "finalized" ? "spec-from-grill" : "resume-grill",
		artifacts,
		leafGrillId: leaf.grillId,
		leafState: leaf.state,
	};
}

export function resolveWorkflow(input: WorkflowResolutionInput): WorkflowResolutionV1 {
	const requiresCanonicalIssue = input.sources.length > 1
		|| input.recommendedClassification?.startsWith("join-") === true;
	if (requiresCanonicalIssue && (!input.canonicalIssueUsable || input.canonicalIssue === null)) {
		return canonicalizationError(input);
	}

	const target = normalizedIssueInput(input.canonicalIssue, input.repository)
		?? (input.sources.length === 1 ? normalizedIssueInput(input.sources[0] ?? null, input.repository) : null);
	const context: ArtifactInspectionContext = {
		repository: input.repository,
		projectRoot: input.cwd,
	};
	const allInspected: InspectedArtifact[] = target === null
		? []
		: input.artifacts
			.filter((candidate) => candidateAllowedInInventory(candidate, input, target, context))
			.map((candidate) => ({ candidate, artifact: inspectArtifactCandidate(candidate, context) }));
	const inspected = target === null
		? []
		: relevantArtifactEntries(allInspected, input, target, context);
	let artifacts = inspected.map(({ artifact }) => ({ ...artifact, primary: false }));

	if (artifacts.some((artifact) =>
		artifact.format === "conflict"
		|| (artifact.format === "invalid" && artifact.identityProvenance === "absent")
		|| artifact.diagnostics.some((diagnostic) => BLOCKING_ARTIFACT_DIAGNOSTICS.has(diagnostic.code)))) {
		return baseResolution(input, "artifact-conflict", artifacts);
	}

	const specEntries = inspected.filter(({ candidate, artifact }) =>
		candidate.kind === "markdown" && artifact.type === "spec") as InspectedMarkdownArtifact[];
	const grillEntries = inspected.filter(({ artifact }) => artifact.type === "grill");
	const grillResolved = grillEntries.length > 0 ? routeGrillGraph(grillEntries, artifacts) : null;
	if (grillResolved?.route === "artifact-conflict") {
		return baseResolution(input, "artifact-conflict", grillResolved.artifacts);
	}
	if (grillResolved) artifacts = grillResolved.artifacts;

	if (specEntries.length > 0) {
		const specResolved = routeSpecGraph(specEntries, input, artifacts);
		if (specResolved.route === "artifact-conflict" || specResolved.route === "superseded-artifact") {
			return baseResolution(input, specResolved.route, specResolved.artifacts);
		}
		if (grillResolved) {
			const downstream = grillResolved.leafState === "finalized"
				&& specResolved.leaf?.grill !== null
				&& specResolved.leaf?.grill === grillResolved.leafGrillId;
			if (!downstream) {
				const ids = new Set([...specEntries, ...grillEntries].map(({ artifact }) => artifact.id));
				const conflicted = withArtifactDiagnostic(
					specResolved.artifacts,
					ids,
					"parallel-spec-grill-lineage",
					"Spec and grill compete for the same issue without a finalized downstream link",
				);
				return baseResolution(input, "artifact-conflict", conflicted);
			}
		}
		return baseResolution(input, specResolved.route, specResolved.artifacts);
	}

	if (grillResolved) return baseResolution(input, grillResolved.route, grillResolved.artifacts);
	const route = input.recommendedClassification;
	return baseResolution(input, route, artifacts);
}

export type WorkflowSelection = "recommended" | "fallback" | "cancel";

export function selectWorkflowRoute(
	resolution: WorkflowResolutionV1,
	selection: WorkflowSelection,
): WorkflowResolutionV1 {
	if (selection === "cancel") {
		return {
			...resolution,
			outcome: "stop",
			code: "cancelled",
			selectedRoute: null,
			stage: null,
			mode: null,
		};
	}
	if (resolution.outcome !== "start" || resolution.recommendedRoute === null) return { ...resolution };

	const artifactAwareRoute = resolution.recommendedRoute !== resolution.recommendedClassification;
	const route = selection === "recommended" || artifactAwareRoute
		? resolution.recommendedRoute
		: resolution.fallbackClassification;
	if (route === null) return { ...resolution };
	const dispatch = dispatchForRoute(route);
	return {
		...resolution,
		outcome: dispatch.outcome,
		code: route,
		selectedRoute: route,
		stage: dispatch.stage,
		mode: dispatch.mode,
	};
}
