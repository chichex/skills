import { randomUUID } from "node:crypto";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
	resolveDirectRunRequest as resolveDirectRunRequestDefault,
	startDirectRun as startDirectRunDefault,
	type DirectRunRequestV1,
	type ResolveDirectRunDependencies,
	type ResolveDirectRunResult,
} from "./direct-launch.ts";
import { resolveWorkflowDispatch } from "./dispatch.ts";
import {
	startFreshStage as startFreshStageDefault,
	type StartFreshStageRequest,
	type StartFreshStageResult,
} from "./lifecycle.ts";
import { materializeSkill, type SkillCommandInfo } from "./materialize.ts";
import { createSubmitWorkflowResolutionTool } from "./protocol.ts";

export const INTERNAL_DISPATCH_COMMAND = "__sdd-dispatch" as const;
export const SUBMIT_WORKFLOW_RESOLUTION_TOOL = "submit_workflow_resolution" as const;
export const LAUNCH_SDD_RUN_TOOL = "launch_sdd_run" as const;
export const ISSUE_TRIAGE_REQUEST_EVENT = "sdd:issue-triage-request" as const;
export const SDD_RUN_REQUEST_EVENT = "sdd:run-request" as const;

export type BeginIssueTriageResult =
	| { ok: true; code: "queued" }
	| { ok: false; code: string; message: string };

export interface IssueTriageRequest {
	issueNumbers: number[];
}

export interface WorkflowControllerDependencies {
	readSkillFile?: (path: string, encoding: "utf8") => Promise<string>;
	stripSkillFrontmatter?: (content: string) => string | Promise<string>;
	createReceipt?: () => string;
	directRunDependencies?: ResolveDirectRunDependencies;
	resolveDirectRunRequest?: (
		target: string,
		cwd: string,
		dependencies?: ResolveDirectRunDependencies,
	) => Promise<ResolveDirectRunResult>;
	startDirectRun?: (
		request: DirectRunRequestV1,
		context: ExtensionCommandContext,
		dependencies: {
			commands: readonly SkillCommandInfo[];
			readSkillFile?: (path: string, encoding: "utf8") => Promise<string>;
			stripSkillFrontmatter?: (content: string) => string | Promise<string>;
		},
	) => Promise<StartFreshStageResult>;
	startFreshStage?: (
		request: StartFreshStageRequest,
		context: ExtensionCommandContext,
		dependencies: {
			commands: readonly SkillCommandInfo[];
			readSkillFile?: (path: string, encoding: "utf8") => Promise<string>;
			stripSkillFrontmatter?: (content: string) => string | Promise<string>;
		},
	) => Promise<StartFreshStageResult>;
}

export interface WorkflowController {
	beginIssueTriage(
		input: IssueTriageRequest,
		context: Pick<ExtensionCommandContext, "cwd" | "sessionManager">,
	): Promise<BeginIssueTriageResult>;
	launchSddRun(target: string, context: ExtensionCommandContext): Promise<ResolveDirectRunResult | StartFreshStageResult>;
}

interface IssueTriageEventRequest {
	input: IssueTriageRequest;
	context: Pick<ExtensionCommandContext, "cwd" | "sessionManager">;
	accept: (result: Promise<BeginIssueTriageResult>) => void;
}

interface SddRunEventRequest {
	target: string;
	context: ExtensionCommandContext;
	accept: (result: Promise<ResolveDirectRunResult | StartFreshStageResult>) => void;
}

export function requestIssueTriage(
	pi: Pick<ExtensionAPI, "events">,
	input: IssueTriageRequest,
	context: Pick<ExtensionCommandContext, "cwd" | "sessionManager">,
): Promise<BeginIssueTriageResult> {
	return new Promise((resolvePromise, reject) => {
		let accepted = false;
		const request: IssueTriageEventRequest = {
			input,
			context,
			accept(result) {
				if (accepted) return;
				accepted = true;
				result.then(resolvePromise, reject);
			},
		};
		pi.events.emit(ISSUE_TRIAGE_REQUEST_EVENT, request);
		if (!accepted) {
			resolvePromise({
				ok: false,
				code: "orchestrator-unavailable",
				message: "workflow-orchestrator is not loaded",
			});
		}
	});
}

export function requestSddRun(
	pi: Pick<ExtensionAPI, "events">,
	target: string,
	context: ExtensionCommandContext,
): Promise<ResolveDirectRunResult | StartFreshStageResult> {
	return new Promise((resolvePromise, reject) => {
		let accepted = false;
		const request: SddRunEventRequest = {
			target,
			context,
			accept(result) {
				if (accepted) return;
				accepted = true;
				result.then(resolvePromise, reject);
			},
		};
		pi.events.emit(SDD_RUN_REQUEST_EVENT, request);
		if (!accepted) {
			resolvePromise({
				ok: false,
				code: "orchestrator-unavailable",
				message: "workflow-orchestrator is not loaded",
			});
		}
	});
}

interface ActiveTriageAttempt {
	sessionId: string;
	claimed: boolean;
}

type DispatchReceipt =
	| { kind: "workflow"; originSessionId: string; request: StartFreshStageRequest }
	| { kind: "direct"; originSessionId: string; request: DirectRunRequestV1 };

function validIssueNumbers(numbers: number[]): boolean {
	return numbers.length >= 1
		&& numbers.length <= 12
		&& numbers.every((number) => Number.isInteger(number) && number > 0)
		&& new Set(numbers).size === numbers.length;
}

function contextSessionId(context: unknown): string | null {
	if (!context || typeof context !== "object") return null;
	const sessionManager = (context as { sessionManager?: unknown }).sessionManager;
	if (!sessionManager || typeof sessionManager !== "object") return null;
	const getSessionId = (sessionManager as { getSessionId?: unknown }).getSessionId;
	if (typeof getSessionId !== "function") return null;
	try {
		const value = getSessionId.call(sessionManager);
		return typeof value === "string" && value.trim() !== "" ? value : null;
	} catch {
		return null;
	}
}

function notify(context: unknown, message: string, level: "info" | "warning" | "error" = "error"): void {
	if (!context || typeof context !== "object") return;
	const ui = (context as { ui?: unknown }).ui;
	if (!ui || typeof ui !== "object") return;
	const notifyPort = (ui as { notify?: unknown }).notify;
	if (typeof notifyPort === "function") notifyPort.call(ui, message, level);
}

export function createWorkflowController(
	pi: ExtensionAPI,
	dependencies: WorkflowControllerDependencies = {},
): WorkflowController {
	let activeAttempt: ActiveTriageAttempt | undefined;
	let terminalRegistered = false;
	const receipts = new Map<string, DispatchReceipt>();
	const startFreshStage = dependencies.startFreshStage ?? startFreshStageDefault;
	const resolveDirectRunRequest = dependencies.resolveDirectRunRequest ?? resolveDirectRunRequestDefault;
	const startDirectRun = dependencies.startDirectRun ?? startDirectRunDefault;
	const createReceipt = dependencies.createReceipt ?? randomUUID;

	function deactivateTerminal(): void {
		const current = pi.getActiveTools();
		if (current.includes(SUBMIT_WORKFLOW_RESOLUTION_TOOL)) {
			pi.setActiveTools(current.filter((name) => name !== SUBMIT_WORKFLOW_RESOLUTION_TOOL));
		}
	}

	function endAttempt(): void {
		activeAttempt = undefined;
		deactivateTerminal();
	}

	function queueReceipt(receipt: DispatchReceipt): string {
		const id = createReceipt();
		if (!/^[A-Za-z0-9_-]+$/.test(id) || receipts.has(id)) {
			throw new Error("Could not allocate a unique opaque workflow receipt");
		}
		receipts.set(id, receipt);
		try {
			pi.sendUserMessage(`/${INTERNAL_DISPATCH_COMMAND} ${id}`, { deliverAs: "followUp" });
		} catch (error) {
			receipts.delete(id);
			throw error;
		}
		return id;
	}

	pi.registerTool({
		name: LAUNCH_SDD_RUN_TOOL,
		label: "Launch SDD run",
		description: "Validate an SDD spec target, ask for explicit execution authorization, and launch it in a fresh session.",
		parameters: {
			type: "object",
			required: ["target"],
			properties: { target: { type: "string" } },
			additionalProperties: false,
		},
		async execute(_toolCallId, params, _signal, _onUpdate, context) {
			if (!context.hasUI) throw new Error("launch_sdd_run requires interactive or RPC mode");
			if (!params || typeof params !== "object" || typeof (params as { target?: unknown }).target !== "string") {
				throw new Error("launch_sdd_run requires target=<ruta|#NN>");
			}
			const target = (params as { target: string }).target.trim();
			const resolved = await resolveDirectRunRequest(target, context.cwd, dependencies.directRunDependencies);
			if (!resolved.ok) throw new Error(`${resolved.code}: ${resolved.message}`);
			const authorized = await context.ui.confirm(
				"Ejecutar ahora",
				`${resolved.request.summary}\n\nSe abrirá una sesión hija ligada a la actual.`,
			);
			if (!authorized) {
				return {
					content: [{ type: "text", text: "The user cancelled SDD execution; the current session is unchanged." }],
					details: { authorized: false, target: resolved.request.target },
				};
			}
			const sessionId = contextSessionId(context);
			if (!sessionId) throw new Error("Cannot authorize SDD execution from an unbound session");
			queueReceipt({ kind: "direct", originSessionId: sessionId, request: resolved.request });
			return {
				content: [{ type: "text", text: "SDD execution authorized; queued a fresh-session launch." }],
				details: { authorized: true, target: resolved.request.target },
				terminate: true,
			};
		},
	} as never);

	function registerTerminal(): void {
		if (terminalRegistered) return;
		const terminal = createSubmitWorkflowResolutionTool();
		pi.registerTool({
			...terminal,
			async execute(toolCallId, params, signal, onUpdate, context) {
				const attempt = activeAttempt;
				if (!attempt || attempt.claimed) {
					throw new Error("submit_workflow_resolution is not active or was already consumed");
				}
				attempt.claimed = true;
				endAttempt();

				const sessionId = contextSessionId(context);
				if (!sessionId || sessionId !== attempt.sessionId) {
					throw new Error("submit_workflow_resolution belongs to a different session");
				}

				const terminalResult = await terminal.execute(toolCallId, params, signal, onUpdate, context);
				const resolution = terminalResult.details;
				if (resolution.outcome !== "start" || resolution.selectedRoute === null) return terminalResult;

				const dispatch = resolveWorkflowDispatch(resolution);
				if (!dispatch.ok) throw new Error(`${dispatch.code}: ${dispatch.message}`);
				queueReceipt({
					kind: "workflow",
					originSessionId: attempt.sessionId,
					request: dispatch.request,
				});
				return terminalResult;
			},
		} as never);
		terminalRegistered = true;
	}

	pi.registerCommand(INTERNAL_DISPATCH_COMMAND, {
		description: "Consume an internal one-shot SDD workflow receipt",
		async handler(args, context) {
			const receipt = args.trim();
			if (!/^[A-Za-z0-9_-]+$/.test(receipt)) {
				notify(context, "Invalid internal SDD workflow receipt");
				return;
			}
			const pending = receipts.get(receipt);
			receipts.delete(receipt);
			if (!pending) {
				notify(context, "Invalid, expired, or already consumed SDD workflow receipt");
				return;
			}
			if (context.sessionManager.getSessionId() !== pending.originSessionId) {
				notify(context, "SDD workflow receipt belongs to another session");
				return;
			}

			const launchDependencies = {
				commands: pi.getCommands() as readonly SkillCommandInfo[],
				readSkillFile: dependencies.readSkillFile,
				stripSkillFrontmatter: dependencies.stripSkillFrontmatter,
			};
			const result = pending.kind === "workflow"
				? await startFreshStage(pending.request, context, launchDependencies)
				: await startDirectRun(pending.request, context, launchDependencies);
			if (!result.ok && result.originPreserved) {
				notify(context, `SDD dispatch failed before switch (${result.code}): ${result.message}`);
			}
		},
	});
	pi.registerCommand("sdd-run", {
		description: "Run an SDD spec target in a fresh linked session: /sdd-run <ruta|#NN>",
		async handler(args, context) {
			await context.waitForIdle();
			const result = await controller.launchSddRun(args, context);
			if (!result.ok && !("originPreserved" in result && !result.originPreserved)) {
				notify(context, `SDD run launch failed (${result.code}): ${result.message}`);
			}
		},
	});

	pi.on("agent_settled", (_event, context) => {
		if (activeAttempt && contextSessionId(context) === activeAttempt.sessionId) endAttempt();
	});
	pi.on("session_shutdown", () => {
		endAttempt();
		receipts.clear();
	});

	const controller: WorkflowController = {
		async launchSddRun(target, context) {
			const resolved = await resolveDirectRunRequest(target.trim(), context.cwd, dependencies.directRunDependencies);
			if (!resolved.ok) return resolved;
			return startDirectRun(resolved.request, context, {
				commands: pi.getCommands() as readonly SkillCommandInfo[],
				readSkillFile: dependencies.readSkillFile,
				stripSkillFrontmatter: dependencies.stripSkillFrontmatter,
			});
		},
		async beginIssueTriage(input, context) {
			if (!validIssueNumbers(input.issueNumbers)) {
				return { ok: false, code: "invalid-issues", message: "Issue selection must contain 1-12 unique positive integers" };
			}
			const sessionId = contextSessionId(context);
			if (!sessionId) {
				return { ok: false, code: "origin-session-unbound", message: "Issue triage requires a persisted origin session" };
			}
			if (activeAttempt) {
				return { ok: false, code: "triage-already-active", message: "An issue triage attempt is already active" };
			}

			const materialized = await materializeSkill(
				"issue-triage",
				input.issueNumbers.map((number) => `#${number}`).join(" "),
				{
					commands: pi.getCommands() as readonly SkillCommandInfo[],
					readFile: dependencies.readSkillFile,
					stripFrontmatter: dependencies.stripSkillFrontmatter,
				},
			);
			if (!materialized.ok) return materialized;

			registerTerminal();
			activeAttempt = { sessionId, claimed: false };
			const activeTools = pi.getActiveTools();
			if (!activeTools.includes(SUBMIT_WORKFLOW_RESOLUTION_TOOL)) {
				pi.setActiveTools([...activeTools, SUBMIT_WORKFLOW_RESOLUTION_TOOL]);
			}
			try {
				pi.sendUserMessage(materialized.content);
			} catch (error) {
				endAttempt();
				return {
					ok: false,
					code: "triage-kickoff-failed",
					message: error instanceof Error ? error.message : String(error),
				};
			}
			return { ok: true, code: "queued" };
		},
	};

	pi.events.on(ISSUE_TRIAGE_REQUEST_EVENT, (data) => {
		if (!data || typeof data !== "object") return;
		const request = data as Partial<IssueTriageEventRequest>;
		if (!request.input || !request.context || typeof request.accept !== "function") return;
		request.accept(controller.beginIssueTriage(request.input, request.context));
	});
	pi.events.on(SDD_RUN_REQUEST_EVENT, (data) => {
		if (!data || typeof data !== "object") return;
		const request = data as Partial<SddRunEventRequest>;
		if (typeof request.target !== "string" || !request.context || typeof request.accept !== "function") return;
		request.accept(controller.launchSddRun(request.target, request.context));
	});
	return controller;
}
