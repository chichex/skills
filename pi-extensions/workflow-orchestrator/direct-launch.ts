import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import {
	readFile as readFileDefault,
	realpath as realpathDefault,
	stat as statDefault,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { localSddArtifactDir, resolveGitCommonDir, trackedSddArtifactDirs } from "../lib/sdd-paths.ts";
import { parseSddArtifact } from "../sdd-artifacts/index.ts";
import { inspectMarkdownArtifact } from "../workflow-resolution/index.ts";
import {
	describeDirectRun,
	validateDirectRunRequest,
	type DirectRunRequestV1,
} from "./direct-protocol.ts";
import {
	startFreshStage,
	type SessionCommandContextLike,
	type StartFreshStageDependencies,
	type StartFreshStageResult,
} from "./lifecycle.ts";
import {
	resolveKnownRepositoryRoot,
	type ResolveRepositoryRootResult,
} from "./project-locator.ts";

export {
	describeDirectRun,
	validateDirectRunRequest,
} from "./direct-protocol.ts";
export type {
	DirectIssueTargetV1,
	DirectRunDiagnostic,
	DirectRunLaunchDescriptor,
	DirectRunRequestV1,
	DirectRunValidation,
	DirectSpecTargetV1,
} from "./direct-protocol.ts";

export interface DirectTargetResolutionFailure {
	ok: false;
	code: string;
	message: string;
}

export type ResolveDirectRunResult =
	| { ok: true; request: DirectRunRequestV1 }
	| DirectTargetResolutionFailure;

export interface ResolvedIssueDocument {
	number: number;
	url: string;
	state: string;
	body: string;
}

export interface ResolveDirectRunDependencies {
	resolveGitRoot?: (path: string) => Promise<string>;
	/** `<git-common-dir>` absoluto de un root, o `null` fuera de un repo git. */
	resolveGitCommonDir?: (root: string) => Promise<string | null>;
	resolveRepository?: (root: string) => Promise<string>;
	resolveRepositoryRoot?: (originRoot: string, repository: string) => Promise<ResolveRepositoryRootResult>;
	resolveIssue?: (root: string, repository: string, number: number) => Promise<ResolvedIssueDocument>;
	readFile?: (path: string, encoding: "utf8") => Promise<string>;
	realpath?: (path: string) => Promise<string>;
	stat?: (path: string) => Promise<Pick<Stats, "isFile">>;
}

const MAX_SPEC_TITLE_LENGTH = 220;

function execText(command: string, args: string[], cwd: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(command, args, { cwd, encoding: "utf8", timeout: 10_000 }, (error, stdout, stderr) => {
			if (error) reject(new Error(String(stderr).trim() || error.message));
			else resolvePromise(String(stdout).trim());
		});
	});
}

export function defaultGitRoot(path: string): Promise<string> {
	return execText("git", ["rev-parse", "--show-toplevel"], path);
}

export async function defaultRepository(root: string): Promise<string> {
	const output = await execText("gh", ["repo", "view", "--json", "nameWithOwner"], root);
	const parsed = JSON.parse(output) as { nameWithOwner?: unknown };
	if (typeof parsed.nameWithOwner !== "string") throw new Error("gh repo view returned no nameWithOwner");
	return parsed.nameWithOwner;
}

export async function defaultIssue(root: string, repository: string, number: number): Promise<ResolvedIssueDocument> {
	const output = await execText(
		"gh",
		["issue", "view", String(number), "--repo", repository, "--json", "number,url,state,body"],
		root,
	);
	const parsed = JSON.parse(output) as Partial<ResolvedIssueDocument>;
	if (parsed.number !== number
		|| typeof parsed.url !== "string"
		|| typeof parsed.state !== "string"
		|| typeof parsed.body !== "string") {
		throw new Error("gh issue view returned an incomplete or mismatched issue");
	}
	return parsed as ResolvedIssueDocument;
}

function resolverFailure(code: string, message: string): DirectTargetResolutionFailure {
	return { ok: false, code, message };
}

function specTitle(markdown: string, path: string): string {
	const title = markdown.match(/^#\s+(?:Spec\s*[—–-]\s*)?(.+?)\s*$/m)?.[1]?.trim() || basename(path, ".md");
	return title.length <= MAX_SPEC_TITLE_LENGTH
		? title
		: `${title.slice(0, MAX_SPEC_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function canonicalRepository(repository: string): string | null {
	const value = repository.trim();
	return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

export function sameRepository(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

export interface ParsedIssueTarget {
	number: number;
	repository?: string;
}

function positiveIssueNumber(value: string): number | null {
	if (!/^[1-9]\d*$/.test(value)) return null;
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : null;
}

export function parseIssueTarget(target: string): ParsedIssueTarget | null {
	const local = /^#([1-9]\d*)$/.exec(target);
	if (local?.[1]) {
		const number = positiveIssueNumber(local[1]);
		return number === null ? null : { number };
	}

	const qualified = /^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#([1-9]\d*)$/.exec(target);
	if (qualified?.[1] && qualified[2]) {
		const number = positiveIssueNumber(qualified[2]);
		return number === null ? null : { repository: qualified[1], number };
	}

	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.port) {
		return null;
	}
	const match = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/issues\/([1-9]\d*)\/?$/.exec(url.pathname);
	if (!match?.[1] || !match[2] || !match[3]) return null;
	const number = positiveIssueNumber(match[3]);
	return number === null ? null : { repository: `${match[1]}/${match[2]}`, number };
}

export type ResolveIssueProjectResult =
	| { ok: true; root: string; repository: string; number: number }
	| DirectTargetResolutionFailure;

export async function resolveIssueProject(
	parsed: ParsedIssueTarget,
	originRoot: string,
	dependencies: ResolveDirectRunDependencies = {},
): Promise<ResolveIssueProjectResult> {
	const repositoryPort = dependencies.resolveRepository ?? defaultRepository;
	const repositoryRootPort = dependencies.resolveRepositoryRoot ?? resolveKnownRepositoryRoot;
	const gitRootPort = dependencies.resolveGitRoot ?? defaultGitRoot;
	const realpathPort = dependencies.realpath ?? realpathDefault;

	let originRepository: string | null = null;
	try {
		originRepository = canonicalRepository(await repositoryPort(originRoot));
	} catch {
		originRepository = null;
	}
	const repository = parsed.repository ?? originRepository;
	if (!repository) {
		return resolverFailure("unresolved-repository", "Resolve the current GitHub repository or use owner/repo#NN before retrying");
	}

	let root = originRoot;
	if (!originRepository || !sameRepository(originRepository, repository)) {
		const rootResolution = await repositoryRootPort(originRoot, repository);
		if (!rootResolution.ok) {
			const detail = rootResolution.code === "ambiguous-project"
				? `Multiple known checkouts match: ${rootResolution.roots.join(", ")}`
				: "Open Pi once from that repository checkout so it becomes a known project";
			return resolverFailure("unresolved-project", `Could not resolve a unique local checkout for ${repository}. ${detail}`);
		}
		try {
			root = await realpathPort(await gitRootPort(rootResolution.root));
			const resolvedRepository = canonicalRepository(await repositoryPort(root));
			if (!resolvedRepository || !sameRepository(resolvedRepository, repository)) {
				throw new Error(`resolved checkout belongs to ${resolvedRepository ?? "an unknown repository"}`);
			}
		} catch (error) {
			return resolverFailure("unresolved-project", `Verify the local checkout for ${repository}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return { ok: true, root, repository, number: parsed.number };
}

export type ResolveIssueDocumentResult =
	| { ok: true; issue: ResolvedIssueDocument }
	| DirectTargetResolutionFailure;

export async function resolveIssueDocument(
	project: { root: string; repository: string; number: number },
	dependencies: ResolveDirectRunDependencies = {},
): Promise<ResolveIssueDocumentResult> {
	const issuePort = dependencies.resolveIssue ?? defaultIssue;
	try {
		const issue = await issuePort(project.root, project.repository, project.number);
		if (issue.number !== project.number) throw new Error("resolved issue number does not match the target");
		return { ok: true, issue };
	} catch (error) {
		return resolverFailure("unresolved-issue", `Verify that ${project.repository}#${project.number} exists before retrying: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function hasCanonicalContract(
	root: string,
	readFile: (path: string, encoding: "utf8") => Promise<string>,
): Promise<boolean> {
	try {
		const markdown = await readFile(join(root, ".sdd", "project.md"), "utf8");
		const parsed = parseSddArtifact(markdown);
		return parsed.kind === "metadata"
			&& parsed.format === "canonical"
			&& parsed.metadata.type === "project"
			&& parsed.diagnostics.length === 0;
	} catch {
		return false;
	}
}

export async function isSddProject(
	cwd: string,
	dependencies: ResolveDirectRunDependencies = {},
): Promise<boolean> {
	const gitRootPort = dependencies.resolveGitRoot ?? defaultGitRoot;
	const realpathPort = dependencies.realpath ?? realpathDefault;
	const readPort = dependencies.readFile ?? readFileDefault;
	try {
		const root = await realpathPort(await gitRootPort(cwd));
		return hasCanonicalContract(root, readPort);
	} catch {
		return false;
	}
}

function contractFailure(root: string): ResolveDirectRunResult {
	return resolverFailure(
		"missing-contract",
		`Create a canonical .sdd/project.md in ${root} before launching sdd-run`,
	);
}

export async function resolveDirectRunRequest(
	rawTarget: string,
	originCwd: string,
	dependencies: ResolveDirectRunDependencies = {},
): Promise<ResolveDirectRunResult> {
	const target = rawTarget.trim();
	if (target === "") return resolverFailure("missing-target", "Use /sdd-run <ruta|#NN|owner/repo#NN|GitHub issue URL>");
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

	const parsedIssue = parseIssueTarget(target);
	if (parsedIssue) {
		const issueProject = await resolveIssueProject(parsedIssue, originRoot, dependencies);
		if (!issueProject.ok) return issueProject;
		const { number, repository: repo, root: issueRoot } = issueProject;
		if (!await hasCanonicalContract(issueRoot, readPort)) return contractFailure(issueRoot);
		const issueResolution = await resolveIssueDocument(issueProject, dependencies);
		if (!issueResolution.ok) return issueResolution;
		const issueDocument = issueResolution.issue;
		const inspected = inspectMarkdownArtifact({
			kind: "markdown",
			id: issueDocument.url,
			expectedType: "spec",
			location: "issue",
			path: issueDocument.url,
			markdown: issueDocument.body,
			hostIssue: { repository: repo, number },
		}, { repository: repo, projectRoot: issueRoot });
		if (inspected.type !== "spec"
			|| inspected.format !== "canonical"
			|| inspected.provenance !== "canonical"
			|| inspected.identityProvenance !== "canonical"
			|| !inspected.issue
			|| inspected.issue.number !== number
			|| !sameRepository(inspected.issue.repository, repo)
			|| inspected.diagnostics.length > 0) {
			const diagnostics = inspected.diagnostics.map(({ code }) => code).join(", ") || `${inspected.type}/${inspected.format}`;
			return resolverFailure("invalid-spec", `Store one canonical SDD spec for ${repo}#${number} before retrying: ${diagnostics}`);
		}
		const request: DirectRunRequestV1 = {
			version: 1,
			kind: "sdd-run",
			repo,
			cwd: issueRoot,
			target: {
				type: "issue",
				canonicalReference: `${repo}#${number}`,
				issue: { repository: repo, number },
			},
			summary: `Run the canonical SDD spec stored in ${repo}#${number}.`,
			evidence: [{
				kind: "issue",
				reference: `${repo}#${number}`,
				detail: `Canonical issue-hosted SDD spec (${inspected.state})`,
			}],
		};
		const validation = validateDirectRunRequest(request);
		return validation.ok
			? { ok: true, request: validation.value }
			: resolverFailure("invalid-request", validation.diagnostics.map(({ path, message }) => `${path} ${message}`).join("; "));
	}
	if (target.startsWith("#") || /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#/.test(target) || /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
		return resolverFailure("invalid-target", "Issue targets must use #NN, owner/repo#NN, or https://github.com/owner/repo/issues/NN");
	}

	// CA-7 defines relative spec targets against the project root, regardless of
	// the subdirectory from which the Pi session was opened. Spec #84 (CA-12):
	// a borrador lives in <git-common-dir>/sdd/specs/, shared by every worktree
	// of the repo; the logical path `.sdd/specs/<x>.md` resolves first in the
	// tracked tree and then there.
	const commonDirPort = dependencies.resolveGitCommonDir ?? ((root: string) => resolveGitCommonDir(root));
	let draftDirectory: string | null = null;
	try {
		const commonDir = await commonDirPort(originRoot);
		if (commonDir) {
			const directory = localSddArtifactDir(commonDir, "specs");
			draftDirectory = await realpathPort(directory).catch(() => directory);
		}
	} catch {
		draftDirectory = null;
	}
	let candidate = isAbsolute(target) ? resolve(target) : resolve(originRoot, target);
	if (!isAbsolute(target) && draftDirectory && dirname(candidate) === trackedSddArtifactDirs(originRoot, "specs").tracked) {
		const tracked = await statPort(candidate).then((entry) => entry.isFile(), () => false);
		if (!tracked) candidate = join(draftDirectory, basename(candidate));
	}
	let path: string;
	let root: string;
	let artifactPath: string;
	let markdown: string;
	try {
		path = await realpathPort(candidate);
		const fileStats = await statPort(path);
		if (!fileStats.isFile()) throw new Error("target is not a regular file");
		if (draftDirectory && dirname(path) === draftDirectory && path.endsWith(".md")) {
			root = originRoot;
			artifactPath = `.sdd/specs/${basename(path)}`;
		} else {
			root = await realpathPort(await gitRootPort(dirname(path)));
			const relationship = relative(root, path);
			if (relationship === "" || relationship.startsWith("..") || isAbsolute(relationship)) {
				throw new Error("target is outside its Git root");
			}
			if (!isAbsolute(target) && root !== originRoot) {
				throw new Error("relative target resolves outside the current Git root");
			}
			artifactPath = relationship.split(sep).join("/");
		}
		markdown = await readPort(path, "utf8");
	} catch (error) {
		return resolverFailure(
			"unreadable-spec",
			`Choose a readable spec inside its own Git root: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!await hasCanonicalContract(root, readPort)) return contractFailure(root);

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
	if (inspected.issue && inspected.issue.repository.toLowerCase() !== repo.toLowerCase()) {
		return resolverFailure("conflicting-spec", `Repair the spec issue metadata to match ${repo}`);
	}
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
	const descriptor = describeDirectRun(request);
	return startFreshStage({
		direct: { request, ...descriptor.direct },
		skill: descriptor.skill,
	}, context, dependencies);
}
