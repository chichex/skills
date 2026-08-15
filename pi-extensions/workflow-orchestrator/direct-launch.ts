import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import {
	readFile as readFileDefault,
	realpath as realpathDefault,
	stat as statDefault,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
	inspectMarkdownArtifact,
	type EvidenceRef,
	type IssueRef,
} from "../workflow-resolution/index.ts";
import {
	startFreshStage,
	type SessionCommandContextLike,
	type StartFreshStageDependencies,
	type StartFreshStageResult,
} from "./lifecycle.ts";

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

type RecordValue = Record<string, unknown>;

const REQUEST_FIELDS = ["version", "kind", "repo", "cwd", "target", "summary", "evidence"] as const;
const ISSUE_TARGET_FIELDS = ["type", "canonicalReference", "issue"] as const;
const SPEC_TARGET_FIELDS = ["type", "canonicalReference", "path", "issue"] as const;
const ISSUE_FIELDS = ["repository", "number"] as const;
const EVIDENCE_FIELDS = ["kind", "reference", "detail"] as const;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactObject(
	value: unknown,
	path: string,
	fields: readonly string[],
	diagnostics: DirectRunDiagnostic[],
): RecordValue | null {
	if (!isRecord(value)) {
		diagnostics.push({ path, code: "invalid-type", message: "Expected an object" });
		return null;
	}
	const allowed = new Set(fields);
	for (const field of fields) {
		if (!Object.hasOwn(value, field)) {
			diagnostics.push({ path: `${path}.${field}`, code: "missing-field", message: `Missing required field ${field}` });
		}
	}
	for (const field of Object.keys(value)) {
		if (!allowed.has(field)) {
			diagnostics.push({ path: `${path}.${field}`, code: "extra-field", message: `Unexpected field ${field}` });
		}
	}
	return value;
}

function nonEmptyString(value: unknown, path: string, diagnostics: DirectRunDiagnostic[]): value is string {
	if (typeof value === "string" && value.trim() !== "") return true;
	diagnostics.push({ path, code: "invalid-type", message: "Expected a non-empty string" });
	return false;
}

function issueValue(value: unknown, path: string, diagnostics: DirectRunDiagnostic[]): IssueRef | null {
	const object = exactObject(value, path, ISSUE_FIELDS, diagnostics);
	if (!object) return null;
	const repositoryOk = nonEmptyString(object.repository, `${path}.repository`, diagnostics);
	const numberOk = typeof object.number === "number" && Number.isInteger(object.number) && object.number > 0;
	if (!numberOk) diagnostics.push({ path: `${path}.number`, code: "invalid-value", message: "Expected a positive integer" });
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
		const object = exactObject(item, path, EVIDENCE_FIELDS, diagnostics);
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
	const object = exactObject(input, "$", REQUEST_FIELDS, diagnostics);
	if (!object) return { ok: false, diagnostics };
	if (object.version !== 1) diagnostics.push({ path: "$.version", code: "invalid-value", message: "Expected version 1" });
	if (object.kind !== "sdd-run") diagnostics.push({ path: "$.kind", code: "invalid-value", message: "Expected kind=sdd-run" });
	const repoOk = nonEmptyString(object.repo, "$.repo", diagnostics)
		&& /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(object.repo as string);
	if (typeof object.repo === "string" && !repoOk) {
		diagnostics.push({ path: "$.repo", code: "invalid-value", message: "Expected owner/repository" });
	}
	const cwdOk = nonEmptyString(object.cwd, "$.cwd", diagnostics) && isAbsolute(object.cwd as string);
	if (typeof object.cwd === "string" && !cwdOk) {
		diagnostics.push({ path: "$.cwd", code: "invalid-value", message: "Expected an absolute project root" });
	}
	const summaryOk = nonEmptyString(object.summary, "$.summary", diagnostics);
	const evidence = evidenceValue(object.evidence, diagnostics);

	let target: DirectIssueTargetV1 | DirectSpecTargetV1 | null = null;
	if (!isRecord(object.target)) {
		diagnostics.push({ path: "$.target", code: "invalid-type", message: "Expected an object" });
	} else if (object.target.type === "issue") {
		const targetObject = exactObject(object.target, "$.target", ISSUE_TARGET_FIELDS, diagnostics)!;
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
		const targetObject = exactObject(object.target, "$.target", SPEC_TARGET_FIELDS, diagnostics)!;
		const referenceOk = nonEmptyString(targetObject.canonicalReference, "$.target.canonicalReference", diagnostics);
		const pathOk = nonEmptyString(targetObject.path, "$.target.path", diagnostics) && isAbsolute(targetObject.path as string);
		if (typeof targetObject.path === "string" && !pathOk) {
			diagnostics.push({ path: "$.target.path", code: "invalid-value", message: "Expected an absolute spec path" });
		}
		const issue = targetObject.issue === null ? null : issueValue(targetObject.issue, "$.target.issue", diagnostics);
		if (issue && typeof object.repo === "string" && !sameRepository(issue.repository, object.repo)) {
			diagnostics.push({ path: "$.target.issue.repository", code: "invalid-value", message: "Spec issue repository must match repo" });
		}
		const artifactPath = typeof object.cwd === "string" && typeof targetObject.path === "string"
			? relativeArtifactPath(object.cwd, targetObject.path)
			: null;
		if (artifactPath === null) {
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

export type ResolveDirectRunResult =
	| { ok: true; request: DirectRunRequestV1 }
	| { ok: false; code: string; message: string };

export interface ResolveDirectRunDependencies {
	resolveGitRoot?: (path: string) => Promise<string>;
	resolveRepository?: (root: string) => Promise<string>;
	readFile?: (path: string, encoding: "utf8") => Promise<string>;
	realpath?: (path: string) => Promise<string>;
	stat?: (path: string) => Promise<Pick<Stats, "isFile">>;
}

function execText(command: string, args: string[], cwd: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(command, args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
			if (error) reject(new Error(String(stderr).trim() || error.message));
			else resolvePromise(String(stdout).trim());
		});
	});
}

function defaultGitRoot(path: string): Promise<string> {
	return execText("git", ["rev-parse", "--show-toplevel"], path);
}

async function defaultRepository(root: string): Promise<string> {
	const output = await execText("gh", ["repo", "view", "--json", "nameWithOwner"], root);
	const parsed = JSON.parse(output) as { nameWithOwner?: unknown };
	if (typeof parsed.nameWithOwner !== "string") throw new Error("gh repo view returned no nameWithOwner");
	return parsed.nameWithOwner;
}

function resolverFailure(code: string, message: string): ResolveDirectRunResult {
	return { ok: false, code, message };
}

function specTitle(markdown: string, path: string): string {
	return markdown.match(/^#\s+(?:Spec\s*[—–-]\s*)?(.+?)\s*$/m)?.[1]?.trim() || basename(path, ".md");
}

function canonicalRepository(repository: string): string | null {
	const value = repository.trim();
	return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

export async function resolveDirectRunRequest(
	rawTarget: string,
	originCwd: string,
	dependencies: ResolveDirectRunDependencies = {},
): Promise<ResolveDirectRunResult> {
	const target = rawTarget.trim();
	if (target === "") return resolverFailure("missing-target", "Use /sdd-run <ruta|#NN>");
	const gitRootPort = dependencies.resolveGitRoot ?? defaultGitRoot;
	const repositoryPort = dependencies.resolveRepository ?? defaultRepository;
	const realpathPort = dependencies.realpath ?? realpathDefault;
	const statPort = dependencies.stat ?? statDefault;
	const readPort = dependencies.readFile ?? readFileDefault;

	let originRoot: string;
	try {
		originRoot = await realpathPort(await gitRootPort(originCwd));
	} catch (error) {
		return resolverFailure("unresolved-cwd", `Resolve a Git project before retrying: ${error instanceof Error ? error.message : String(error)}`);
	}

	const issueMatch = /^#([1-9]\d*)$/.exec(target);
	if (issueMatch?.[1]) {
		try {
			const repo = canonicalRepository(await repositoryPort(originRoot));
			if (!repo) throw new Error("repository is not owner/repo");
			const number = Number(issueMatch[1]);
			const request: DirectRunRequestV1 = {
				version: 1,
				kind: "sdd-run",
				repo,
				cwd: originRoot,
				target: {
					type: "issue",
					canonicalReference: `${repo}#${number}`,
					issue: { repository: repo, number },
				},
				summary: `Run the SDD spec stored in ${repo}#${number}.`,
				evidence: [{ kind: "issue", reference: `${repo}#${number}`, detail: "Explicit direct sdd-run target" }],
			};
			return { ok: true, request };
		} catch (error) {
			return resolverFailure("unresolved-repository", `Resolve the GitHub repository before retrying: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (target.startsWith("#")) return resolverFailure("invalid-target", "Issue targets must use #NN with a positive integer");

	const candidate = isAbsolute(target) ? resolve(target) : resolve(originRoot, target);
	let path: string;
	let root: string;
	let markdown: string;
	try {
		path = await realpathPort(candidate);
		const fileStats = await statPort(path);
		if (!fileStats.isFile()) throw new Error("target is not a regular file");
		root = await realpathPort(await gitRootPort(dirname(path)));
		const relationship = relative(root, path);
		if (relationship === "" || relationship.startsWith("..") || isAbsolute(relationship)) {
			throw new Error("target is outside its Git root");
		}
		if (!isAbsolute(target) && root !== originRoot) {
			throw new Error("relative target resolves outside the current Git root");
		}
		markdown = await readPort(path, "utf8");
	} catch (error) {
		return resolverFailure(
			"unreadable-spec",
			`Choose a readable spec inside its own Git root: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	let repo: string;
	try {
		const resolved = canonicalRepository(await repositoryPort(root));
		if (!resolved) throw new Error("repository is not owner/repo");
		repo = resolved;
	} catch (error) {
		return resolverFailure("unresolved-repository", `Resolve the target repository before retrying: ${error instanceof Error ? error.message : String(error)}`);
	}
	const inspected = inspectMarkdownArtifact({
		kind: "markdown",
		id: path,
		expectedType: "spec",
		location: "local",
		path,
		markdown,
	}, { repository: repo, projectRoot: root });
	if (inspected.type !== "spec"
		|| inspected.format !== "canonical"
		|| inspected.provenance !== "canonical"
		|| inspected.identityProvenance !== "canonical"
		|| inspected.diagnostics.length > 0) {
		const diagnostics = inspected.diagnostics.map(({ code }) => code).join(", ") || `${inspected.type}/${inspected.format}`;
		return resolverFailure("invalid-spec", `Repair the target to one canonical SDD spec before retrying: ${diagnostics}`);
	}
	if (inspected.issue && !sameRepository(inspected.issue.repository, repo)) {
		return resolverFailure("conflicting-spec", `Repair the spec issue metadata to match ${repo}`);
	}
	const artifactPath = relative(root, path).split(sep).join("/");
	const request: DirectRunRequestV1 = {
		version: 1,
		kind: "sdd-run",
		repo,
		cwd: root,
		target: {
			type: "spec",
			canonicalReference: `${repo}:${artifactPath}`,
			path,
			issue: inspected.issue,
		},
		summary: `Run SDD spec ${specTitle(markdown, path)}.`,
		evidence: [{
			kind: "artifact",
			reference: artifactPath,
			detail: `Canonical local SDD spec (${inspected.state})`,
		}],
	};
	const validation = validateDirectRunRequest(request);
	return validation.ok
		? { ok: true, request: validation.value }
		: resolverFailure("invalid-request", validation.diagnostics.map(({ path, message }) => `${path} ${message}`).join("; "));
}

export async function startDirectRun(
	input: unknown,
	context: SessionCommandContextLike,
	dependencies: StartFreshStageDependencies,
): Promise<StartFreshStageResult> {
	const validation = validateDirectRunRequest(input);
	if (!validation.ok) {
		return {
			ok: false,
			code: "invalid-direct-request",
			phase: "validation",
			originPreserved: true,
			message: validation.diagnostics.map(({ path, message }) => `${path} ${message}`).join("; "),
		};
	}
	const request = validation.value;
	const target = request.target;
	const sourceLabel = target.type === "issue"
		? `${request.repo}#${target.issue.number}`
		: target.issue
			? `${request.repo}#${target.issue.number}`
			: `${request.repo}/${basename(target.path)}`;
	return startFreshStage({
		direct: {
			request,
			cwd: request.cwd,
			name: `SDD run-existing-spec · ${sourceLabel}`,
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
	}, context, dependencies);
}
