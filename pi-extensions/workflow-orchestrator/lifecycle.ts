import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import {
	readFile as readFileDefault,
	realpath as realpathDefault,
	stat as statDefault,
	unlink as unlinkDefault,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { WorkflowResolutionV1, WorkflowRoute } from "../workflow-resolution/index.ts";
import {
	materializeSkill,
	type MaterializeSkillErrorCode,
	type SkillCommandInfo,
} from "./materialize.ts";
import { validateWorkflowResolution } from "./protocol.ts";
import { stageCrossProjectSession as stageCrossProjectSessionDefault } from "./staging.ts";

export type StartFreshStagePhase = "validation" | "staging" | "switch" | "post-switch" | "complete";

export type StartFreshStageErrorCode =
	| "invalid-resolution"
	| "invalid-handoff"
	| MaterializeSkillErrorCode
	| "origin-session-unpersisted"
	| "unresolved-cwd"
	| "staging-failed"
	| "session-switch-cancelled"
	| "session-switch-failed"
	| "target-resources-invalid"
	| "kickoff-failed";

export interface SessionReference {
	sessionId: string;
	sessionFile: string;
	cwd: string;
}

export interface TargetSessionReference {
	sessionId?: string;
	sessionFile?: string;
	cwd: string;
	name: string;
	repository: string;
	issueNumber: number;
}

export type StartFreshStageResult =
	| {
		ok: true;
		code: "started";
		phase: "complete";
		originPreserved: false;
		source: SessionReference;
		target: Required<Pick<TargetSessionReference, "sessionId" | "sessionFile">> & TargetSessionReference;
	}
	| {
		ok: false;
		code: StartFreshStageErrorCode;
		phase: Exclude<StartFreshStagePhase, "complete">;
		originPreserved: boolean;
		message: string;
		source?: SessionReference;
		target?: TargetSessionReference;
		orphanSessionFile?: string;
	};

export interface StartFreshStageRequest {
	resolution: unknown;
	skill: {
		name: string;
		args?: string;
	};
}

export interface SessionManagerLike {
	getCwd(): string;
	getSessionId(): string;
	getSessionFile(): string | undefined;
}

export interface ReplacementSessionContextLike {
	cwd: string;
	sessionManager: SessionManagerLike;
	getSystemPromptOptions(): {
		cwd: string;
		contextFiles?: Array<{ path: string; content: string }>;
		skills?: Array<{
			filePath: string;
			sourceInfo?: { path?: string; scope?: string };
		}>;
	};
	sendUserMessage(content: string): Promise<void>;
}

export interface MutableSessionManagerLike extends SessionManagerLike {
	appendSessionInfo(name: string): string;
}

export interface SessionCommandContextLike {
	cwd: string;
	sessionManager: SessionManagerLike;
	newSession(options: {
		parentSession: string;
		setup: (sessionManager: MutableSessionManagerLike) => Promise<void>;
		withSession: (context: ReplacementSessionContextLike) => Promise<void>;
	}): Promise<{ cancelled: boolean }>;
	switchSession(sessionPath: string, options: {
		withSession: (context: ReplacementSessionContextLike) => Promise<void>;
	}): Promise<{ cancelled: boolean }>;
}

export interface StagedSessionReference {
	sessionId: string;
	sessionFile: string;
	cwd: string;
}

export interface StartFreshStageDependencies {
	commands: readonly SkillCommandInfo[];
	readSkillFile?: (path: string, encoding: "utf8") => Promise<string>;
	realpath?: (path: string) => Promise<string>;
	stat?: (path: string) => Promise<Pick<Stats, "isDirectory">>;
	resolveGitRoot?: (cwd: string) => Promise<string>;
	stageCrossProjectSession?: (input: {
		cwd: string;
		parentSession: string;
		name: string;
	}) => Promise<StagedSessionReference>;
	removeFile?: (path: string) => Promise<void>;
}

const START_DISPATCH = new Map<WorkflowRoute, { stage: string; mode: string | null }>([
	["grill", { stage: "grill", mode: "new" }],
	["join-grill", { stage: "grill", mode: "new" }],
	["spec", { stage: "spec", mode: "new" }],
	["join-spec", { stage: "spec", mode: "new" }],
	["quick-run", { stage: "quick-run", mode: "new" }],
	["join-quick-run", { stage: "quick-run", mode: "new" }],
	["resume-grill", { stage: "grill", mode: "resume" }],
	["spec-from-grill", { stage: "spec", mode: "from-grill" }],
	["update-existing-spec", { stage: "spec", mode: "update" }],
	["audit-existing-spec", { stage: "spec", mode: "update" }],
	["run-existing-spec", { stage: "run-existing-spec", mode: null }],
]);

interface ResultReferences {
	source?: SessionReference;
	target?: TargetSessionReference;
	orphanSessionFile?: string;
}

function errorResult(
	code: StartFreshStageErrorCode,
	phase: Exclude<StartFreshStagePhase, "complete">,
	message: string,
	originPreserved = true,
	references: ResultReferences = {},
): StartFreshStageResult {
	return { ok: false, code, phase, originPreserved, message, ...references };
}

function isConfirmedCoherentStart(resolution: WorkflowResolutionV1): boolean {
	if (resolution.outcome !== "start" || resolution.selectedRoute === null) return false;
	if (resolution.code !== resolution.selectedRoute) return false;
	const expected = START_DISPATCH.get(resolution.selectedRoute);
	return expected !== undefined
		&& resolution.stage === expected.stage
		&& resolution.mode === expected.mode;
}

function sameRepository(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

function effectiveIssue(resolution: WorkflowResolutionV1): { repository: string; number: number } | null {
	if (resolution.canonicalIssue) return resolution.canonicalIssue;
	return resolution.sources.length === 1 ? resolution.sources[0]! : null;
}

function validateHandoffPayload(resolution: WorkflowResolutionV1): string | null {
	if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(resolution.repo)) {
		return "repo must be an owner/repository identifier";
	}
	if (resolution.cwd.trim() === "" || !isAbsolute(resolution.cwd)) {
		return "cwd must be an absolute project root";
	}
	if (resolution.summary.trim() === "" || resolution.impactExample.trim() === "") {
		return "summary and impactExample are required handoff fields";
	}
	const issue = effectiveIssue(resolution);
	if (!issue || !sameRepository(issue.repository, resolution.repo)) {
		return "handoff has no effective issue in repo";
	}
	if (resolution.sources.some((source) => !sameRepository(source.repository, resolution.repo))) {
		return "all source issues must belong to repo";
	}
	if (resolution.canonicalIssue && !sameRepository(resolution.canonicalIssue.repository, resolution.repo)) {
		return "canonicalIssue must belong to repo";
	}
	if (resolution.selectedRoute?.startsWith("join-") && resolution.canonicalIssue === null) {
		return "join routes require canonicalIssue";
	}
	return null;
}

function pathIsInside(root: string, candidate: string): boolean {
	const relationship = relative(resolve(root), resolve(candidate));
	return relationship === "" || (!relationship.startsWith("..") && !isAbsolute(relationship));
}

function replacementResourcesAreValid(
	context: ReplacementSessionContextLike,
	targetCwd: string,
	sourceCwd: string,
	sourceSessionId: string,
): boolean {
	if (context.sessionManager.getSessionId() === sourceSessionId) return false;
	if (resolve(context.cwd) !== targetCwd || resolve(context.sessionManager.getCwd()) !== targetCwd) return false;
	const options = context.getSystemPromptOptions();
	if (resolve(options.cwd) !== targetCwd) return false;
	// Pi legitimately includes global/ancestor context files outside the project.
	// What must never survive a cross-project replacement is a file scoped under
	// the old project root.
	if (sourceCwd !== targetCwd
		&& (options.contextFiles ?? []).some(({ path }) => pathIsInside(sourceCwd, path))) return false;
	if ((options.skills ?? []).some((skill) =>
		skill.sourceInfo?.scope === "project"
		&& !pathIsInside(targetCwd, typeof skill.sourceInfo.path === "string" ? skill.sourceInfo.path : skill.filePath))) {
		return false;
	}
	return true;
}

interface PostSwitchReceipt {
	target?: Required<Pick<TargetSessionReference, "sessionId" | "sessionFile">> & TargetSessionReference;
	failure?: { code: "target-resources-invalid" | "kickoff-failed"; message: string };
}

interface ReplacementCallbackData {
	targetCwd: string;
	sourceCwd: string;
	sourceSessionId: string;
	name: string;
	repository: string;
	issueNumber: number;
	kickoff: string;
	receipt: PostSwitchReceipt;
}

function createReplacementCallback(data: ReplacementCallbackData) {
	return async (context: ReplacementSessionContextLike): Promise<void> => {
		try {
			if (!replacementResourcesAreValid(context, data.targetCwd, data.sourceCwd, data.sourceSessionId)) {
				data.receipt.failure = {
					code: "target-resources-invalid",
					message: "Replacement context does not expose the validated target cwd/resources",
				};
				throw new Error(data.receipt.failure.message);
			}
		} catch (error) {
			if (!data.receipt.failure) {
				data.receipt.failure = {
					code: "target-resources-invalid",
					message: error instanceof Error ? error.message : String(error),
				};
			}
			throw error;
		}

		const sessionId = context.sessionManager.getSessionId();
		const sessionFile = context.sessionManager.getSessionFile();
		if (!sessionFile) {
			data.receipt.failure = {
				code: "target-resources-invalid",
				message: "Replacement session is not persisted",
			};
			throw new Error(data.receipt.failure.message);
		}
		data.receipt.target = {
			sessionId,
			sessionFile,
			cwd: data.targetCwd,
			name: data.name,
			repository: data.repository,
			issueNumber: data.issueNumber,
		};
		try {
			await context.sendUserMessage(data.kickoff);
		} catch (error) {
			data.receipt.failure = {
				code: "kickoff-failed",
				message: error instanceof Error ? error.message : String(error),
			};
			throw error;
		}
	};
}

function createSessionSetup(name: string) {
	return async (sessionManager: MutableSessionManagerLike): Promise<void> => {
		sessionManager.appendSessionInfo(name);
	};
}

function defaultGitRoot(cwd: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" }, (error, stdout) => {
			if (error) reject(error);
			else resolvePromise(stdout.trim());
		});
	});
}

/**
 * The handoff envelope is closed by a literal `</workflow-handoff>` sentinel.
 * JSON.stringify never escapes `<`, so a string field that happens to contain
 * that sequence (e.g. issue body text flowing into resolution.summary) would
 * close the envelope early and let its remainder be read as content outside
 * of it (prompt-injection with orchestrator authority). Escaping `<` to its
 * JSON-valid \u form keeps the payload byte-identical once JSON.parse'd while
 * making the sentinel unforgeable from inside the payload.
 */
function escapeHandoffEnvelope(json: string): string {
	return json.replace(/</g, "\\u003c");
}

function buildKickoff(materializedSkill: string, resolution: WorkflowResolutionV1): string {
	const payload = escapeHandoffEnvelope(JSON.stringify(resolution));
	return `${materializedSkill}\n\n<workflow-handoff version="1">\n${payload}\n</workflow-handoff>`;
}

export async function startFreshStage(
	request: StartFreshStageRequest,
	context: SessionCommandContextLike,
	dependencies: StartFreshStageDependencies,
): Promise<StartFreshStageResult> {
	const validation = validateWorkflowResolution(request.resolution);
	if (!validation.ok) {
		return errorResult(
			"invalid-resolution",
			"validation",
			validation.diagnostics.map(({ path, message }) => `${path} ${message}`).join("; "),
		);
	}
	const resolution = validation.value;
	if (!isConfirmedCoherentStart(resolution)) {
		return errorResult("invalid-handoff", "validation", "Resolution is not a confirmed coherent start dispatch");
	}
	if (typeof request.skill?.name !== "string" || request.skill.name.trim() === ""
		|| (request.skill.args !== undefined && typeof request.skill.args !== "string")) {
		return errorResult("invalid-handoff", "validation", "Skill name and arguments are invalid");
	}
	const payloadError = validateHandoffPayload(resolution);
	if (payloadError) return errorResult("invalid-handoff", "validation", payloadError);
	const issue = effectiveIssue(resolution)!;

	const materialized = await materializeSkill(request.skill.name, request.skill.args ?? "", {
		commands: dependencies.commands,
		readFile: dependencies.readSkillFile ?? readFileDefault,
	});
	if (!materialized.ok) {
		return errorResult(materialized.code, "validation", materialized.message);
	}

	const realpathPort = dependencies.realpath ?? realpathDefault;
	const statPort = dependencies.stat ?? statDefault;
	const gitRootPort = dependencies.resolveGitRoot ?? defaultGitRoot;
	// Pi's own SessionManager only ever resolve()s a cwd, never realpath()s it
	// (session-manager.js: `this.cwd = resolvePath(cwd)`), and hands that same
	// resolve()-only form back to extensions via context.cwd/getCwd(). targetCwd
	// is therefore kept in that same resolve()-only identity form below, so it
	// can be compared directly against Pi-produced values without requiring the
	// caller's raw input to already equal its own realpath — a requirement that
	// any symlinked project root (e.g. anything under /tmp on macOS) could never
	// satisfy. realpath is used only here, to confirm a real directory and Git
	// root actually exist at that location.
	let targetCwd: string;
	try {
		const targetRealCwd = await realpathPort(resolution.cwd);
		const targetStats = await statPort(targetRealCwd);
		if (!targetStats.isDirectory()) throw new Error("cwd is not a directory");
		const gitRoot = await realpathPort(await gitRootPort(targetRealCwd));
		if (gitRoot !== targetRealCwd) throw new Error("cwd is not the Git root");
		targetCwd = resolve(resolution.cwd);
	} catch (error) {
		return errorResult("unresolved-cwd", "validation", error instanceof Error ? error.message : String(error));
	}

	let source: SessionReference;
	try {
		const sessionFile = context.sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Origin session has no persisted file");
		const canonicalSessionFile = await realpathPort(sessionFile);
		const sessionStats = await statPort(canonicalSessionFile);
		if (sessionStats.isDirectory()) throw new Error("Origin session path is not a file");
		// Same resolve()-only identity form as targetCwd above, so the
		// same-vs-cross-project decision below and the post-switch identity
		// check in replacementResourcesAreValid compare like with like.
		const contextCwd = resolve(context.cwd);
		const managerCwd = resolve(context.sessionManager.getCwd());
		if (contextCwd !== managerCwd) throw new Error("Origin context and session manager cwd disagree");
		source = {
			sessionId: context.sessionManager.getSessionId(),
			sessionFile: canonicalSessionFile,
			cwd: contextCwd,
		};
	} catch (error) {
		return errorResult(
			"origin-session-unpersisted",
			"validation",
			error instanceof Error ? error.message : String(error),
		);
	}

	const name = `SDD ${resolution.stage} · ${resolution.repo}#${issue.number}`;
	const kickoff = buildKickoff(materialized.content, resolution);
	const targetBase: TargetSessionReference = {
		cwd: targetCwd,
		name,
		repository: resolution.repo,
		issueNumber: issue.number,
	};
	const receipt: PostSwitchReceipt = {};
	const withSession = createReplacementCallback({
		targetCwd,
		sourceCwd: source.cwd,
		sourceSessionId: source.sessionId,
		name,
		repository: resolution.repo,
		issueNumber: issue.number,
		kickoff,
		receipt,
	});

	if (source.cwd === targetCwd) {
		let replacementResult: { cancelled: boolean };
		try {
			replacementResult = await context.newSession({
				parentSession: source.sessionFile,
				setup: createSessionSetup(name),
				withSession,
			});
		} catch (error) {
			if (receipt.failure) {
				return errorResult(receipt.failure.code, "post-switch", receipt.failure.message, false, {
					source,
					target: receipt.target ?? targetBase,
				});
			}
			return errorResult(
				"session-switch-failed",
				"switch",
				error instanceof Error ? error.message : String(error),
				false,
				{ source, target: targetBase },
			);
		}
		if (replacementResult.cancelled) {
			return errorResult("session-switch-cancelled", "switch", "New session was cancelled", true, {
				source,
				target: targetBase,
			});
		}
		if (!receipt.target) {
			return errorResult("session-switch-failed", "switch", "Replacement callback did not run", false, {
				source,
				target: targetBase,
			});
		}
		return {
			ok: true,
			code: "started",
			phase: "complete",
			originPreserved: false,
			source,
			target: receipt.target,
		};
	}

	const stageSession = dependencies.stageCrossProjectSession ?? stageCrossProjectSessionDefault;
	let staged: StagedSessionReference;
	try {
		staged = await stageSession({ cwd: targetCwd, parentSession: source.sessionFile, name });
	} catch (error) {
		return errorResult(
			"staging-failed",
			"staging",
			error instanceof Error ? error.message : String(error),
			true,
			{ source, target: targetBase },
		);
	}

	if (staged.sessionId === source.sessionId || staged.cwd !== targetCwd || !isAbsolute(staged.sessionFile)) {
		// Never delete a path the code itself just deemed invalid: when the very
		// reason we are here is that staged.sessionFile is NOT absolute, unlinking
		// it would resolve against the running process's cwd (not any project we
		// validated) and could silently remove an unrelated file. Only attempt
		// cleanup once the path itself is trustworthy.
		if (isAbsolute(staged.sessionFile)) {
			try {
				await (dependencies.removeFile ?? unlinkDefault)(staged.sessionFile);
			} catch (error) {
				return errorResult(
					"staging-failed",
					"staging",
					`Staged session identity is invalid and cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
					true,
					{
						source,
						target: { ...targetBase, ...staged },
						orphanSessionFile: staged.sessionFile,
					},
				);
			}
		}
		return errorResult("staging-failed", "staging", "Staged session identity does not match the target child", true, {
			source,
			target: targetBase,
		});
	}

	let switchResult: { cancelled: boolean };
	try {
		switchResult = await context.switchSession(staged.sessionFile, { withSession });
	} catch (error) {
		if (receipt.failure) {
			return errorResult(receipt.failure.code, "post-switch", receipt.failure.message, false, {
				source,
				target: receipt.target ?? { ...targetBase, ...staged },
			});
		}
		return errorResult(
			"session-switch-failed",
			"switch",
			error instanceof Error ? error.message : String(error),
			false,
			{ source, target: { ...targetBase, ...staged } },
		);
	}
	if (switchResult.cancelled) {
		try {
			await (dependencies.removeFile ?? unlinkDefault)(staged.sessionFile);
		} catch (error) {
			return errorResult(
				"session-switch-cancelled",
				"switch",
				`Session switch was cancelled and staged cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
				true,
				{
					source,
					target: { ...targetBase, ...staged },
					orphanSessionFile: staged.sessionFile,
				},
			);
		}
		return errorResult("session-switch-cancelled", "switch", "Session switch was cancelled", true, {
			source,
			target: { ...targetBase, ...staged },
		});
	}
	if (!receipt.target) {
		return errorResult("session-switch-failed", "switch", "Replacement callback did not run", false, {
			source,
			target: { ...targetBase, ...staged },
		});
	}
	return {
		ok: true,
		code: "started",
		phase: "complete",
		originPreserved: false,
		source,
		target: receipt.target,
	};
}
