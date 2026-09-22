// Registro de jobs, lanzamiento del hijo `pi` y kill (issue #44 CA-3..CA-6).
// STUB: firmas sin comportamiento, para que los tests fallen por assert.

import type { AgentConfig } from "./agents.ts";

export type JobStatus = "running" | "completed" | "failed" | "aborted";

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "package" | "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: unknown[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	jobId?: string;
}

export interface ChildProcessLike {
	pid?: number;
	exitCode: number | null;
	stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
	stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
	on(event: "close", listener: (code: number | null) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	kill(signal?: NodeJS.Signals | number): boolean;
}

export interface SpawnOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	shell: false;
	stdio: ["ignore", "pipe", "pipe"];
}

export type SpawnLike = (command: string, args: string[], options: SpawnOptions) => ChildProcessLike;

export interface PiInvocation {
	command: string;
	args: string[];
}

export interface RunnerDeps {
	spawn: SpawnLike;
	resolveInvocation?: (args: string[]) => PiInvocation;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	setTimeout?: (callback: () => void, ms: number) => unknown;
	clearTimeout?: (handle: unknown) => void;
	killGraceMs?: number;
}

export interface SubagentJob {
	id: string;
	agent: string;
	task: string;
	background: boolean;
	status: JobStatus;
	pid?: number;
	startedAt: number;
	endedAt?: number;
	exited: boolean;
	killRequested: boolean;
	proc: ChildProcessLike | null;
	result?: SingleResult;
}

export interface JobRegistry {
	create(agent: string, task: string, background: boolean): SubagentJob;
	get(id: string): SubagentJob | undefined;
	list(): SubagentJob[];
	running(): SubagentJob[];
}

export interface LaunchOptions {
	cwd: string;
	background: boolean;
	model?: string;
	thinkingLevel?: string;
	modelOverride?: string;
	signal?: AbortSignal;
	onUpdate?: (result: SingleResult) => void;
	step?: number;
}

export interface LaunchedAgent {
	job: SubagentJob;
	completion: Promise<SingleResult>;
}

export const KILL_GRACE_MS = 0;
export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const COLLAPSED_ITEM_COUNT = 10;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;

function notImplemented(): never {
	throw new Error("not implemented");
}

export function createJobRegistry(): JobRegistry {
	return { create: notImplemented, get: () => undefined, list: () => [], running: () => [] };
}

export async function launchAgent(
	_registry: JobRegistry,
	_agent: AgentConfig,
	_task: string,
	_options: LaunchOptions,
	_deps: RunnerDeps,
): Promise<LaunchedAgent> {
	return notImplemented();
}

export function killJob(_job: SubagentJob, _deps: RunnerDeps): boolean {
	return false;
}

export function abortRunningJobs(_registry: JobRegistry, _deps: RunnerDeps): SubagentJob[] {
	return [];
}

export function formatAbortNotice(_jobs: SubagentJob[]): string {
	return "";
}

export function formatDuration(_ms: number): string {
	return "";
}

export function formatJobLine(_job: SubagentJob, _now: number): string {
	return "";
}

export function subagentsCommand(
	_args: string,
	_registry: JobRegistry,
	_notify: (text: string, level: "info" | "warning" | "error") => void,
	_deps: RunnerDeps,
): void {}
