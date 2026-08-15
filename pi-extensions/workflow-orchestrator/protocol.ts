import type {
	ArtifactRef,
	EvidenceRef,
	IssueRef,
	NewWorkRoute,
	WorkflowMode,
	WorkflowResolutionV1,
	WorkflowRoute,
	WorkflowStage,
} from "../workflow-resolution/index.ts";
import { exactObject, type RecordValue } from "./validation.ts";

export interface WorkflowResolutionDiagnostic {
	path: string;
	code: "missing-field" | "extra-field" | "invalid-type" | "invalid-enum" | "invalid-value";
	message: string;
}

export type WorkflowResolutionValidation =
	| { ok: true; value: WorkflowResolutionV1 }
	| { ok: false; diagnostics: WorkflowResolutionDiagnostic[] };

const NEW_WORK_ROUTES = [
	"blocked-dependency",
	"split-too-large",
	"grill",
	"spec",
	"quick-run",
	"incoherent-selection",
	"combined-too-large",
	"join-grill",
	"join-spec",
	"join-quick-run",
] as const satisfies readonly NewWorkRoute[];

const EXISTING_WORK_ROUTES = [
	"resume-grill",
	"spec-from-grill",
	"update-existing-spec",
	"run-existing-spec",
	"already-implemented",
	"superseded-artifact",
	"audit-existing-spec",
	"artifact-conflict",
] as const;

export const WORKFLOW_ROUTES = [...NEW_WORK_ROUTES, ...EXISTING_WORK_ROUTES] as const satisfies readonly WorkflowRoute[];
export const WORKFLOW_STAGES = ["grill", "spec", "quick-run", "run-existing-spec"] as const satisfies readonly WorkflowStage[];
export const WORKFLOW_MODES = ["new", "resume", "update", "from-grill"] as const satisfies readonly WorkflowMode[];

const ARTIFACT_LOCATIONS = ["local", "issue", "handoff", "snapshot"] as const;
const ARTIFACT_TYPES = ["spec", "grill", "project", "unknown"] as const;
const ARTIFACT_STATES = ["draft", "approved", "implemented", "superseded", "paused", "finalized", "unknown", "active"] as const;
const ARTIFACT_FORMATS = ["canonical", "legacy", "absent", "invalid", "conflict", "snapshot"] as const;
const ARTIFACT_PROVENANCES = ["canonical", "legacy-explicit", "legacy-inferred", "absent", "snapshot"] as const;
const IDENTITY_PROVENANCES = ["canonical", "legacy", "filename", "location", "snapshot", "absent"] as const;
const FRESHNESS_VALUES = ["fresh", "stale", "unknown"] as const;

const RESOLUTION_FIELDS = [
	"version",
	"outcome",
	"code",
	"recommendedClassification",
	"fallbackClassification",
	"recommendedRoute",
	"selectedRoute",
	"stage",
	"mode",
	"repo",
	"cwd",
	"sources",
	"canonicalIssue",
	"summary",
	"impactExample",
	"scope",
	"checklist",
	"evidence",
	"risks",
	"artifacts",
] as const;

const ISSUE_FIELDS = ["repository", "number"] as const;
const EVIDENCE_FIELDS = ["kind", "reference", "detail"] as const;
const DIAGNOSTIC_FIELDS = ["code", "message"] as const;
const ARTIFACT_FIELDS = [
	"id",
	"location",
	"path",
	"type",
	"state",
	"format",
	"provenance",
	"identityProvenance",
	"issue",
	"grill",
	"project",
	"supersededBy",
	"parentId",
	"revision",
	"freshness",
	"primary",
	"diagnostics",
] as const;

function exactWorkflowObject(
	value: unknown,
	path: string,
	fields: readonly string[],
	diagnostics: WorkflowResolutionDiagnostic[],
): RecordValue | null {
	return exactObject(value, path, fields, (diagnostic) => diagnostics.push(diagnostic));
}

function stringValue(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): value is string {
	if (typeof value === "string") return true;
	diagnostics.push({ path, code: "invalid-type", message: "Expected a string" });
	return false;
}

function booleanValue(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): value is boolean {
	if (typeof value === "boolean") return true;
	diagnostics.push({ path, code: "invalid-type", message: "Expected a boolean" });
	return false;
}

function enumValue<const T extends readonly string[]>(
	value: unknown,
	values: T,
	path: string,
	diagnostics: WorkflowResolutionDiagnostic[],
): value is T[number] {
	if (typeof value === "string" && (values as readonly string[]).includes(value)) return true;
	diagnostics.push({ path, code: "invalid-enum", message: `Expected one of: ${values.join(", ")}` });
	return false;
}

function nullableString(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): value is string | null {
	return value === null || stringValue(value, path, diagnostics);
}

function nullableEnum<const T extends readonly string[]>(
	value: unknown,
	values: T,
	path: string,
	diagnostics: WorkflowResolutionDiagnostic[],
): value is T[number] | null {
	return value === null || enumValue(value, values, path, diagnostics);
}

function stringArray(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): value is string[] {
	if (!Array.isArray(value)) {
		diagnostics.push({ path, code: "invalid-type", message: "Expected an array" });
		return false;
	}
	value.forEach((item, index) => stringValue(item, `${path}[${index}]`, diagnostics));
	return true;
}

function issueValue(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): IssueRef | null {
	const object = exactWorkflowObject(value, path, ISSUE_FIELDS, diagnostics);
	if (!object) return null;
	const repositoryOk = stringValue(object.repository, `${path}.repository`, diagnostics);
	const numberOk = typeof object.number === "number" && Number.isInteger(object.number) && object.number > 0;
	if (!numberOk) {
		diagnostics.push({ path: `${path}.number`, code: "invalid-value", message: "Expected a positive integer" });
	}
	if (!repositoryOk || !numberOk) return null;
	return { repository: object.repository as string, number: object.number as number };
}

function nullableIssueValue(
	value: unknown,
	path: string,
	diagnostics: WorkflowResolutionDiagnostic[],
): IssueRef | null | undefined {
	if (value === null) return null;
	return issueValue(value, path, diagnostics) ?? undefined;
}

function issueArray(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): IssueRef[] {
	if (!Array.isArray(value)) {
		diagnostics.push({ path, code: "invalid-type", message: "Expected an array" });
		return [];
	}
	return value.flatMap((item, index) => {
		const parsed = issueValue(item, `${path}[${index}]`, diagnostics);
		return parsed ? [parsed] : [];
	});
}

function evidenceArray(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): EvidenceRef[] {
	if (!Array.isArray(value)) {
		diagnostics.push({ path, code: "invalid-type", message: "Expected an array" });
		return [];
	}
	return value.flatMap((item, index) => {
		const itemPath = `${path}[${index}]`;
		const object = exactWorkflowObject(item, itemPath, EVIDENCE_FIELDS, diagnostics);
		if (!object) return [];
		const kindOk = stringValue(object.kind, `${itemPath}.kind`, diagnostics);
		const referenceOk = stringValue(object.reference, `${itemPath}.reference`, diagnostics);
		const detailOk = stringValue(object.detail, `${itemPath}.detail`, diagnostics);
		return kindOk && referenceOk && detailOk
			? [{ kind: object.kind as string, reference: object.reference as string, detail: object.detail as string }]
			: [];
	});
}

function artifactArray(value: unknown, path: string, diagnostics: WorkflowResolutionDiagnostic[]): ArtifactRef[] {
	if (!Array.isArray(value)) {
		diagnostics.push({ path, code: "invalid-type", message: "Expected an array" });
		return [];
	}
	return value.flatMap((item, index) => {
		const itemPath = `${path}[${index}]`;
		const object = exactWorkflowObject(item, itemPath, ARTIFACT_FIELDS, diagnostics);
		if (!object) return [];
		const idOk = stringValue(object.id, `${itemPath}.id`, diagnostics);
		const locationOk = enumValue(object.location, ARTIFACT_LOCATIONS, `${itemPath}.location`, diagnostics);
		const artifactPathOk = stringValue(object.path, `${itemPath}.path`, diagnostics);
		const typeOk = enumValue(object.type, ARTIFACT_TYPES, `${itemPath}.type`, diagnostics);
		const stateOk = enumValue(object.state, ARTIFACT_STATES, `${itemPath}.state`, diagnostics);
		const formatOk = enumValue(object.format, ARTIFACT_FORMATS, `${itemPath}.format`, diagnostics);
		const provenanceOk = enumValue(object.provenance, ARTIFACT_PROVENANCES, `${itemPath}.provenance`, diagnostics);
		const identityOk = enumValue(
			object.identityProvenance,
			IDENTITY_PROVENANCES,
			`${itemPath}.identityProvenance`,
			diagnostics,
		);
		const issue = nullableIssueValue(object.issue, `${itemPath}.issue`, diagnostics);
		const grillOk = nullableString(object.grill, `${itemPath}.grill`, diagnostics);
		const projectOk = nullableString(object.project, `${itemPath}.project`, diagnostics);
		const supersededOk = nullableString(object.supersededBy, `${itemPath}.supersededBy`, diagnostics);
		const parentOk = nullableString(object.parentId, `${itemPath}.parentId`, diagnostics);
		const revisionOk = object.revision === null
			|| (typeof object.revision === "number" && Number.isInteger(object.revision) && object.revision >= 0);
		if (!revisionOk) {
			diagnostics.push({ path: `${itemPath}.revision`, code: "invalid-value", message: "Expected null or a non-negative integer" });
		}
		const freshnessOk = enumValue(object.freshness, FRESHNESS_VALUES, `${itemPath}.freshness`, diagnostics);
		const primaryOk = booleanValue(object.primary, `${itemPath}.primary`, diagnostics);
		const artifactDiagnostics: Array<{ code: string; message: string }> = [];
		if (!Array.isArray(object.diagnostics)) {
			diagnostics.push({ path: `${itemPath}.diagnostics`, code: "invalid-type", message: "Expected an array" });
		} else {
			object.diagnostics.forEach((diagnostic, diagnosticIndex) => {
				const diagnosticPath = `${itemPath}.diagnostics[${diagnosticIndex}]`;
				const diagnosticObject = exactWorkflowObject(diagnostic, diagnosticPath, DIAGNOSTIC_FIELDS, diagnostics);
				if (!diagnosticObject) return;
				const codeOk = stringValue(diagnosticObject.code, `${diagnosticPath}.code`, diagnostics);
				const messageOk = stringValue(diagnosticObject.message, `${diagnosticPath}.message`, diagnostics);
				if (codeOk && messageOk) {
					artifactDiagnostics.push({
						code: diagnosticObject.code as string,
						message: diagnosticObject.message as string,
					});
				}
			});
		}
		const valid = idOk && locationOk && artifactPathOk && typeOk && stateOk && formatOk
			&& provenanceOk && identityOk && issue !== undefined && grillOk && projectOk && supersededOk
			&& parentOk && revisionOk && freshnessOk && primaryOk && Array.isArray(object.diagnostics);
		if (!valid) return [];
		return [{
			id: object.id as string,
			location: object.location as ArtifactRef["location"],
			path: object.path as string,
			type: object.type as ArtifactRef["type"],
			state: object.state as ArtifactRef["state"],
			format: object.format as ArtifactRef["format"],
			provenance: object.provenance as ArtifactRef["provenance"],
			identityProvenance: object.identityProvenance as ArtifactRef["identityProvenance"],
			issue,
			grill: object.grill as string | null,
			project: object.project as string | null,
			supersededBy: object.supersededBy as string | null,
			parentId: object.parentId as string | null,
			revision: object.revision as number | null,
			freshness: object.freshness as ArtifactRef["freshness"],
			primary: object.primary as boolean,
			diagnostics: artifactDiagnostics,
		}];
	});
}

function validateDiscriminant(object: RecordValue, diagnostics: WorkflowResolutionDiagnostic[]): void {
	if (!enumValue(object.outcome, ["start", "stop", "error"] as const, "$.outcome", diagnostics)) return;
	if (object.outcome === "start") {
		enumValue(object.code, WORKFLOW_ROUTES, "$.code", diagnostics);
		enumValue(object.stage, WORKFLOW_STAGES, "$.stage", diagnostics);
		nullableEnum(object.mode, WORKFLOW_MODES, "$.mode", diagnostics);
		return;
	}
	if (object.outcome === "stop") {
		enumValue(object.code, [...WORKFLOW_ROUTES, "cancelled"] as const, "$.code", diagnostics);
		if (object.stage !== null) {
			diagnostics.push({ path: "$.stage", code: "invalid-value", message: "Stop resolutions require stage=null" });
		}
		if (object.mode !== null) {
			diagnostics.push({ path: "$.mode", code: "invalid-value", message: "Stop resolutions require mode=null" });
		}
		return;
	}
	if (object.code !== "canonicalization") {
		diagnostics.push({ path: "$.code", code: "invalid-enum", message: "Error resolutions require code=canonicalization" });
	}
	if (object.stage !== null) {
		diagnostics.push({ path: "$.stage", code: "invalid-value", message: "Error resolutions require stage=null" });
	}
	if (object.mode !== null) {
		diagnostics.push({ path: "$.mode", code: "invalid-value", message: "Error resolutions require mode=null" });
	}
}

export function validateWorkflowResolution(value: unknown): WorkflowResolutionValidation {
	const diagnostics: WorkflowResolutionDiagnostic[] = [];
	const object = exactWorkflowObject(value, "$", RESOLUTION_FIELDS, diagnostics);
	if (!object) return { ok: false, diagnostics };

	if (object.version !== 1) {
		diagnostics.push({ path: "$.version", code: "invalid-value", message: "Expected protocol version 1" });
	}
	validateDiscriminant(object, diagnostics);
	nullableEnum(object.recommendedClassification, NEW_WORK_ROUTES, "$.recommendedClassification", diagnostics);
	nullableEnum(object.fallbackClassification, NEW_WORK_ROUTES, "$.fallbackClassification", diagnostics);
	nullableEnum(object.recommendedRoute, WORKFLOW_ROUTES, "$.recommendedRoute", diagnostics);
	nullableEnum(object.selectedRoute, WORKFLOW_ROUTES, "$.selectedRoute", diagnostics);
	stringValue(object.repo, "$.repo", diagnostics);
	stringValue(object.cwd, "$.cwd", diagnostics);
	const sources = issueArray(object.sources, "$.sources", diagnostics);
	const canonicalIssue = nullableIssueValue(object.canonicalIssue, "$.canonicalIssue", diagnostics);
	stringValue(object.summary, "$.summary", diagnostics);
	stringValue(object.impactExample, "$.impactExample", diagnostics);
	stringArray(object.scope, "$.scope", diagnostics);
	stringArray(object.checklist, "$.checklist", diagnostics);
	const evidence = evidenceArray(object.evidence, "$.evidence", diagnostics);
	stringArray(object.risks, "$.risks", diagnostics);
	const artifacts = artifactArray(object.artifacts, "$.artifacts", diagnostics);

	if (diagnostics.length > 0 || canonicalIssue === undefined) return { ok: false, diagnostics };
	const normalized = {
		version: 1,
		outcome: object.outcome,
		code: object.code,
		recommendedClassification: object.recommendedClassification,
		fallbackClassification: object.fallbackClassification,
		recommendedRoute: object.recommendedRoute,
		selectedRoute: object.selectedRoute,
		stage: object.stage,
		mode: object.mode,
		repo: object.repo,
		cwd: object.cwd,
		sources,
		canonicalIssue,
		summary: object.summary,
		impactExample: object.impactExample,
		scope: [...(object.scope as string[])],
		checklist: [...(object.checklist as string[])],
		evidence,
		risks: [...(object.risks as string[])],
		artifacts,
	} as WorkflowResolutionV1;
	return { ok: true, value: normalized };
}

function enumSchema(values: readonly string[]) {
	return { type: "string", enum: [...values] };
}

function nullableSchema(schema: Record<string, unknown>) {
	return { anyOf: [schema, { type: "null" }] };
}

function strictObjectSchema(properties: Record<string, unknown>) {
	return {
		type: "object",
		required: Object.keys(properties),
		properties,
		additionalProperties: false,
	};
}

const issueSchema = strictObjectSchema({
	repository: { type: "string" },
	number: { type: "integer", minimum: 1 },
});
const diagnosticSchema = strictObjectSchema({ code: { type: "string" }, message: { type: "string" } });
const artifactSchema = strictObjectSchema({
	id: { type: "string" },
	location: enumSchema(ARTIFACT_LOCATIONS),
	path: { type: "string" },
	type: enumSchema(ARTIFACT_TYPES),
	state: enumSchema(ARTIFACT_STATES),
	format: enumSchema(ARTIFACT_FORMATS),
	provenance: enumSchema(ARTIFACT_PROVENANCES),
	identityProvenance: enumSchema(IDENTITY_PROVENANCES),
	issue: nullableSchema(issueSchema),
	grill: nullableSchema({ type: "string" }),
	project: nullableSchema({ type: "string" }),
	supersededBy: nullableSchema({ type: "string" }),
	parentId: nullableSchema({ type: "string" }),
	revision: nullableSchema({ type: "integer", minimum: 0 }),
	freshness: enumSchema(FRESHNESS_VALUES),
	primary: { type: "boolean" },
	diagnostics: { type: "array", items: diagnosticSchema },
});
const evidenceSchema = strictObjectSchema({
	kind: { type: "string" },
	reference: { type: "string" },
	detail: { type: "string" },
});

export const WORKFLOW_RESOLUTION_SCHEMA = strictObjectSchema({
	version: { type: "integer", enum: [1] },
	outcome: enumSchema(["start", "stop", "error"]),
	code: enumSchema([...WORKFLOW_ROUTES, "cancelled", "canonicalization"]),
	recommendedClassification: nullableSchema(enumSchema(NEW_WORK_ROUTES)),
	fallbackClassification: nullableSchema(enumSchema(NEW_WORK_ROUTES)),
	recommendedRoute: nullableSchema(enumSchema(WORKFLOW_ROUTES)),
	selectedRoute: nullableSchema(enumSchema(WORKFLOW_ROUTES)),
	stage: nullableSchema(enumSchema(WORKFLOW_STAGES)),
	mode: nullableSchema(enumSchema(WORKFLOW_MODES)),
	repo: { type: "string" },
	cwd: { type: "string" },
	sources: { type: "array", items: issueSchema },
	canonicalIssue: nullableSchema(issueSchema),
	summary: { type: "string" },
	impactExample: { type: "string" },
	scope: { type: "array", items: { type: "string" } },
	checklist: { type: "array", items: { type: "string" } },
	evidence: { type: "array", items: evidenceSchema },
	risks: { type: "array", items: { type: "string" } },
	artifacts: { type: "array", items: artifactSchema },
});

export class WorkflowResolutionValidationError extends Error {
	readonly code = "invalid-workflow-resolution" as const;
	readonly diagnostics: WorkflowResolutionDiagnostic[];

	constructor(diagnostics: WorkflowResolutionDiagnostic[]) {
		super(`Invalid WorkflowResolutionV1: ${diagnostics.map(({ path, message }) => `${path} ${message}`).join("; ")}`);
		this.name = "WorkflowResolutionValidationError";
		this.diagnostics = diagnostics;
	}
}

export interface SubmitWorkflowResolutionTool {
	name: "submit_workflow_resolution";
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (
		toolCallId: string,
		params: unknown,
		signal?: AbortSignal,
		onUpdate?: unknown,
		context?: unknown,
	) => Promise<{
		content: Array<{ type: "text"; text: string }>;
		details: WorkflowResolutionV1;
		terminate: true;
	}>;
}

export function createSubmitWorkflowResolutionTool(): SubmitWorkflowResolutionTool {
	return {
		name: "submit_workflow_resolution",
		label: "Submit Workflow Resolution",
		description: "Submit one final, validated WorkflowResolutionV1 without dispatching its selected stage.",
		parameters: WORKFLOW_RESOLUTION_SCHEMA,
		async execute(_toolCallId, params) {
			const validation = validateWorkflowResolution(params);
			if (!validation.ok) throw new WorkflowResolutionValidationError(validation.diagnostics);
			return {
				content: [{
					type: "text",
					text: `Workflow resolution accepted: ${validation.value.outcome}/${validation.value.code}.`,
				}],
				details: validation.value,
				terminate: true,
			};
		},
	};
}
