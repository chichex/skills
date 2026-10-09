import { realpath as realpathDefault } from "node:fs/promises";

import {
	defaultGitRoot,
	parseIssueTarget,
	resolveIssueDocument,
	resolveIssueProject,
	type ResolveDirectRunDependencies,
} from "./direct-launch.ts";
import {
	describeDirectGrill,
	validateDirectGrillRequest,
	type DirectGrillRequestV1,
} from "./direct-protocol.ts";
import {
	startFreshStage,
	type SessionCommandContextLike,
	type StartFreshStageDependencies,
	type StartFreshStageResult,
} from "./lifecycle.ts";

export {
	describeDirectGrill,
	validateDirectGrillRequest,
} from "./direct-protocol.ts";
export type {
	DirectGrillLaunchDescriptor,
	DirectGrillRequestV1,
} from "./direct-protocol.ts";

export type ResolveDirectGrillResult =
	| { ok: true; request: DirectGrillRequestV1 }
	| { ok: false; code: string; message: string };

function failure(code: string, message: string): ResolveDirectGrillResult {
	return { ok: false, code, message };
}

export async function resolveDirectGrillRequest(
	rawTarget: string,
	originCwd: string,
	dependencies: ResolveDirectRunDependencies = {},
): Promise<ResolveDirectGrillResult> {
	const target = rawTarget.trim();
	if (target === "") return failure("missing-target", "Use /grill <#NN|owner/repo#NN|GitHub issue URL>");
	const parsed = parseIssueTarget(target);
	if (!parsed) {
		return failure("invalid-target", "Grill issue targets must use #NN, owner/repo#NN, or https://github.com/owner/repo/issues/NN");
	}

	const gitRootPort = dependencies.resolveGitRoot ?? defaultGitRoot;
	const realpathPort = dependencies.realpath ?? realpathDefault;
	let originRoot: string;
	try {
		originRoot = await realpathPort(await gitRootPort(originCwd));
	} catch (error) {
		return failure("unresolved-cwd", `Resolve a Git project before retrying: ${error instanceof Error ? error.message : String(error)}`);
	}
	const issueProject = await resolveIssueProject(parsed, originRoot, dependencies);
	if (!issueProject.ok) return issueProject;
	const issueResolution = await resolveIssueDocument(issueProject, dependencies);
	if (!issueResolution.ok) return issueResolution;
	const { number, repository: repo, root: issueRoot } = issueProject;
	const issueDocument = issueResolution.issue;
	const reference = `${repo}#${number}`;
	const request: DirectGrillRequestV1 = {
		version: 1,
		kind: "grill",
		repo,
		cwd: issueRoot,
		target: {
			type: "issue",
			canonicalReference: reference,
			issue: { repository: repo, number },
		},
		summary: `Grill ${reference} before specification.`,
		evidence: [{ kind: "issue", reference, detail: `Canonical GitHub issue (${issueDocument.state})` }],
	};
	const validation = validateDirectGrillRequest(request);
	return validation.ok
		? { ok: true, request: validation.value }
		: failure("invalid-request", validation.diagnostics.map(({ path, message }) => `${path} ${message}`).join("; "));
}

export async function startDirectGrill(
	input: unknown,
	context: SessionCommandContextLike,
	dependencies: StartFreshStageDependencies,
): Promise<StartFreshStageResult> {
	const validation = validateDirectGrillRequest(input);
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
	const descriptor = describeDirectGrill(request);
	return startFreshStage({
		direct: { request, ...descriptor.direct },
		skill: descriptor.skill,
	}, context, dependencies);
}
