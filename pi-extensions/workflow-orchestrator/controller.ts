import { randomUUID } from "node:crypto";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

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
export const ISSUE_TRIAGE_REQUEST_EVENT = "sdd:issue-triage-request" as const;

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
}

interface IssueTriageEventRequest {
	input: IssueTriageRequest;
	context: Pick<ExtensionCommandContext, "cwd" | "sessionManager">;
	accept: (result: Promise<BeginIssueTriageResult>) => void;
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

interface ActiveTriageAttempt {
	sessionId: string;
	claimed: boolean;
}

interface DispatchReceipt {
	originSessionId: string;
	request: StartFreshStageRequest;
}

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
				const receipt = createReceipt();
				if (!/^[A-Za-z0-9_-]+$/.test(receipt) || receipts.has(receipt)) {
					throw new Error("Could not allocate a unique opaque workflow receipt");
				}
				receipts.set(receipt, { originSessionId: attempt.sessionId, request: dispatch.request });
				try {
					pi.sendUserMessage(`/${INTERNAL_DISPATCH_COMMAND} ${receipt}`, { deliverAs: "followUp" });
				} catch (error) {
					receipts.delete(receipt);
					throw error;
				}
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

			const result = await startFreshStage(pending.request, context, {
				commands: pi.getCommands() as readonly SkillCommandInfo[],
				readSkillFile: dependencies.readSkillFile,
				stripSkillFrontmatter: dependencies.stripSkillFrontmatter,
			});
			if (!result.ok && result.originPreserved) {
				notify(context, `SDD dispatch failed before switch (${result.code}): ${result.message}`);
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
		async beginIssueTriage(input, context) {
			if (!validIssueNumbers(input.issueNumbers)) {
				return { ok: false, code: "invalid-issues", message: "Issue selection must contain 1-12 unique positive integers" };
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
			activeAttempt = { sessionId: context.sessionManager.getSessionId(), claimed: false };
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
	return controller;
}
