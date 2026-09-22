// Logica de la tool `subagent` (issue #44 CA-1..CA-4), sin imports runtime de
// Pi para poder probarla con `spawn` y `sendMessage` inyectados.
// STUB: firmas sin comportamiento, para que los tests fallen por assert.

import type { AgentDiscoveryDeps, AgentScope } from "./agents.ts";
import type { JobRegistry, RunnerDeps, SingleResult } from "./jobs.ts";

export interface TaskItem {
	agent: string;
	task: string;
	cwd?: string;
}

export interface SubagentParams {
	agent?: string;
	task?: string;
	tasks?: TaskItem[];
	chain?: TaskItem[];
	agentScope?: AgentScope;
	confirmProjectAgents?: boolean;
	cwd?: string;
	background?: boolean;
	model?: string;
}

export interface ToolContextLike {
	cwd: string;
	hasUI: boolean;
	isProjectTrusted(): boolean;
	model?: { provider: string; id: string } | undefined;
	thinkingLevel?: string;
	ui: { confirm(title: string, message: string): Promise<boolean> };
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

export interface BackgroundDetails {
	jobId: string;
	agent: string;
	pid: number | undefined;
	status: "running";
}

export interface SubagentResultMessage {
	customType: "subagent-result";
	content: string;
	display: true;
	details: {
		jobId: string;
		agent: string;
		status: "completed" | "failed" | "aborted";
		usage: SingleResult["usage"];
		stopReason?: string;
	};
}

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details?: SubagentDetails | BackgroundDetails;
	isError?: boolean;
}

export type OnUpdate = (partial: ToolResult) => void;

export interface SubagentToolDeps {
	registry: JobRegistry;
	runner: RunnerDeps;
	discovery?: AgentDiscoveryDeps;
	sendMessage: (message: SubagentResultMessage, options: { deliverAs: "followUp"; triggerTurn: true }) => void;
	env?: NodeJS.ProcessEnv;
}

export type SubagentExecute = (
	toolCallId: string,
	params: SubagentParams,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdate | undefined,
	ctx: ToolContextLike,
) => Promise<ToolResult>;

export const NESTING_ERROR = "";

export function createSubagentExecute(_deps: SubagentToolDeps): SubagentExecute {
	return async () => ({ content: [{ type: "text", text: "" }] });
}
