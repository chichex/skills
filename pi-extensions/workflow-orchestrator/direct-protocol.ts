import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import type { EvidenceRef, IssueRef } from "../workflow-resolution/index.ts";
import { exactObject, isRecord } from "./validation.ts";

export interface DirectIssueTargetV1 {
	type: "issue";
	canonicalReference: string;
	issue: IssueRef;
}

export interface DirectSpecTargetV1 {
	type: "spec";
	canonicalReference: string;
	path: string;
	issue: IssueRef | null;
}

export interface DirectRunRequestV1 {
	version: 1;
	kind: "sdd-run";
	repo: string;
	cwd: string;
	target: DirectIssueTargetV1 | DirectSpecTargetV1;
	summary: string;
	evidence: EvidenceRef[];
}

export interface DirectRunDiagnostic {
	path: string;
	code: "missing-field" | "extra-field" | "invalid-type" | "invalid-value";
	message: string;
}

export type DirectRunValidation =
	| { ok: true; value: DirectRunRequestV1 }
	| { ok: false; diagnostics: DirectRunDiagnostic[] };

export interface DirectRunLaunchDescriptor {
	direct: {
		cwd: string;
		name: string;
		repository: string;
		canonicalReference: string;
		issueNumber?: number;
		artifactPath?: string;
	};
	skill: {
		name: "sdd-run";
		args: string;
	};
}

const REQUEST_FIELDS = ["version", "kind", "repo", "cwd", "target", "summary", "evidence"] as const;
const ISSUE_TARGET_FIELDS = ["type", "canonicalReference", "issue"] as const;
const SPEC_TARGET_FIELDS = ["type", "canonicalReference", "path", "issue"] as const;
const ISSUE_FIELDS = ["repository", "number"] as const;
const EVIDENCE_FIELDS = ["kind", "reference", "detail"] as const;
const MAX_SUMMARY_LENGTH = 240;

function nonEmptyString(value: unknown, path: string, diagnostics: DirectRunDiagnostic[]): value is string {
	if (typeof value !== "string") {
		diagnostics.push({ path, code: "invalid-type", message: "Expected a string" });
		return false;
	}
	if (value.trim() === "") {
		diagnostics.push({ path, code: "invalid-value", message: "Expected a non-empty string" });
		return false;
	}
	return true;
}

function issueValue(value: unknown, path: string, diagnostics: DirectRunDiagnostic[]): IssueRef | null {
	const object = exactObject(value, path, ISSUE_FIELDS, (diagnostic) => diagnostics.push(diagnostic));
	if (!object) return null;
	const repositoryOk = nonEmptyString(object.repository, `${path}.repository`, diagnostics);
	const numberOk = typeof object.number === "number"
		&& Number.isSafeInteger(object.number)
		&& object.number > 0;
	if (!numberOk) diagnostics.push({ path: `${path}.number`, code: "invalid-value", message: "Expected a positive safe integer" });
	return repositoryOk && numberOk
		? { repository: object.repository as string, number: object.number as number }
		: null;
}

function evidenceValue(value: unknown, diagnostics: DirectRunDiagnostic[]): EvidenceRef[] {
	if (!Array.isArray(value) || value.length === 0) {
		diagnostics.push({ path: "$.evidence", code: "invalid-value", message: "Expected at least one evidence item" });
		return [];
	}
	return value.flatMap((item, index) => {
		const path = `$.evidence[${index}]`;
		const object = exactObject(item, path, EVIDENCE_FIELDS, (diagnostic) => diagnostics.push(diagnostic));
		if (!object) return [];
		const kindOk = nonEmptyString(object.kind, `${path}.kind`, diagnostics);
		const referenceOk = nonEmptyString(object.reference, `${path}.reference`, diagnostics);
		const detailOk = nonEmptyString(object.detail, `${path}.detail`, diagnostics);
		return kindOk && referenceOk && detailOk
			? [{ kind: object.kind as string, reference: object.reference as string, detail: object.detail as string }]
			: [];
	});
}

function sameRepository(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

function relativeArtifactPath(root: string, path: string): string | null {
	if (!isAbsolute(root) || !isAbsolute(path)) return null;
	const relationship = relative(resolve(root), resolve(path));
	if (relationship === "" || relationship.startsWith("..") || isAbsolute(relationship)) return null;
	return relationship.split(sep).join("/");
}

export function validateDirectRunRequest(input: unknown): DirectRunValidation {
	const diagnostics: DirectRunDiagnostic[] = [];
	const object = exactObject(input, "$", REQUEST_FIELDS, (diagnostic) => diagnostics.push(diagnostic));
	if (!object) return { ok: false, diagnostics };
	if (object.version !== 1) diagnostics.push({ path: "$.version", code: "invalid-value", message: "Expected version 1" });
	if (object.kind !== "sdd-run") diagnostics.push({ path: "$.kind", code: "invalid-value", message: "Expected kind=sdd-run" });

	const repoStringOk = nonEmptyString(object.repo, "$.repo", diagnostics);
	const repoOk = repoStringOk && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(object.repo as string);
	if (repoStringOk && !repoOk) {
		diagnostics.push({ path: "$.repo", code: "invalid-value", message: "Expected owner/repository" });
	}
	const cwdStringOk = nonEmptyString(object.cwd, "$.cwd", diagnostics);
	const cwdOk = cwdStringOk && isAbsolute(object.cwd as string);
	if (cwdStringOk && !cwdOk) {
		diagnostics.push({ path: "$.cwd", code: "invalid-value", message: "Expected an absolute project root" });
	}
	const summaryStringOk = nonEmptyString(object.summary, "$.summary", diagnostics);
	const summaryOk = summaryStringOk && (object.summary as string).length <= MAX_SUMMARY_LENGTH;
	if (summaryStringOk && !summaryOk) {
		diagnostics.push({ path: "$.summary", code: "invalid-value", message: `Summary exceeds ${MAX_SUMMARY_LENGTH} characters` });
	}
	const evidence = evidenceValue(object.evidence, diagnostics);

	let target: DirectIssueTargetV1 | DirectSpecTargetV1 | null = null;
	if (!isRecord(object.target)) {
		diagnostics.push({ path: "$.target", code: "invalid-type", message: "Expected an object" });
	} else if (object.target.type === "issue") {
		const targetObject = exactObject(object.target, "$.target", ISSUE_TARGET_FIELDS, (diagnostic) => diagnostics.push(diagnostic))!;
		const referenceOk = nonEmptyString(targetObject.canonicalReference, "$.target.canonicalReference", diagnostics);
		const issue = issueValue(targetObject.issue, "$.target.issue", diagnostics);
		if (issue && typeof object.repo === "string" && !sameRepository(issue.repository, object.repo)) {
			diagnostics.push({ path: "$.target.issue.repository", code: "invalid-value", message: "Issue repository must match repo" });
		}
		if (issue && typeof object.repo === "string" && targetObject.canonicalReference !== `${object.repo}#${issue.number}`) {
			diagnostics.push({ path: "$.target.canonicalReference", code: "invalid-value", message: "Issue reference is not canonical" });
		}
		if (referenceOk && issue) {
			target = { type: "issue", canonicalReference: targetObject.canonicalReference as string, issue };
		}
	} else if (object.target.type === "spec") {
		const targetObject = exactObject(object.target, "$.target", SPEC_TARGET_FIELDS, (diagnostic) => diagnostics.push(diagnostic))!;
		const referenceOk = nonEmptyString(targetObject.canonicalReference, "$.target.canonicalReference", diagnostics);
		const pathStringOk = nonEmptyString(targetObject.path, "$.target.path", diagnostics);
		const pathOk = pathStringOk && isAbsolute(targetObject.path as string);
		if (pathStringOk && !pathOk) {
			diagnostics.push({ path: "$.target.path", code: "invalid-value", message: "Expected an absolute spec path" });
		}
		const issue = targetObject.issue === null ? null : issueValue(targetObject.issue, "$.target.issue", diagnostics);
		if (issue && typeof object.repo === "string" && !sameRepository(issue.repository, object.repo)) {
			diagnostics.push({ path: "$.target.issue.repository", code: "invalid-value", message: "Spec issue repository must match repo" });
		}
		const artifactPath = cwdOk && pathOk
			? relativeArtifactPath(object.cwd as string, targetObject.path as string)
			: null;
		if (artifactPath === null && pathOk && cwdOk) {
			diagnostics.push({ path: "$.target.path", code: "invalid-value", message: "Spec path must be inside cwd" });
		}
		if (artifactPath && typeof object.repo === "string"
			&& targetObject.canonicalReference !== `${object.repo}:${artifactPath}`) {
			diagnostics.push({ path: "$.target.canonicalReference", code: "invalid-value", message: "Spec reference is not canonical" });
		}
		if (referenceOk && pathOk && artifactPath && (targetObject.issue === null || issue)) {
			target = {
				type: "spec",
				canonicalReference: targetObject.canonicalReference as string,
				path: targetObject.path as string,
				issue,
			};
		}
	} else {
		diagnostics.push({ path: "$.target.type", code: "invalid-value", message: "Expected issue or spec target" });
	}

	if (diagnostics.length > 0 || !repoOk || !cwdOk || !summaryOk || !target) return { ok: false, diagnostics };
	return {
		ok: true,
		value: {
			version: 1,
			kind: "sdd-run",
			repo: object.repo as string,
			cwd: object.cwd as string,
			target,
			summary: object.summary as string,
			evidence,
		},
	};
}

export function describeDirectRun(request: DirectRunRequestV1): DirectRunLaunchDescriptor {
	const target = request.target;
	const source = target.type === "issue"
		? `${request.repo}#${target.issue.number}`
		: target.issue
			? `${request.repo}#${target.issue.number}`
			: `${request.repo}/${basename(target.path)}`;
	return {
		direct: {
			cwd: request.cwd,
			name: `SDD run-existing-spec · ${source}`,
			repository: request.repo,
			canonicalReference: target.canonicalReference,
			...(target.type === "issue"
				? { issueNumber: target.issue.number }
				: { artifactPath: target.path }),
		},
		skill: {
			name: "sdd-run",
			args: target.type === "issue" ? `#${target.issue.number}` : target.path,
		},
	};
}
