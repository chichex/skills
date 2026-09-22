// Registro de jobs, lanzamiento del hijo `pi` y kill (issue #44 CA-3..CA-6).
//
// Todo lo que toca el sistema (spawn, timers, reloj, invocacion de pi) es
// inyectable via RunnerDeps para probarlo con un hijo simulado; index.ts pasa
// los reales. Cada hijo lanzado —foreground o background— es un job `sa-N` del
// registro en memoria de la sesion, asi /subagents lo lista y session_shutdown
// lo mata.

import { existsSync, promises as fs, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { AgentConfig, AgentSource } from "./agents.ts";

export const KILL_GRACE_MS = 5000;
export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const COLLAPSED_ITEM_COUNT = 10;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;

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

// Subconjunto del Message de pi-ai que el modo JSON del hijo emite y que la
// extension necesita (texto, tool calls, uso y motivo de parada).
export interface ChildContentPart {
	type: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

export interface ChildMessage {
	role: string;
	content: ChildContentPart[];
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: { total?: number };
	};
	stopReason?: string;
	errorMessage?: string;
	model?: string;
}

export interface SingleResult {
	agent: string;
	agentSource: AgentSource | "unknown";
	task: string;
	exitCode: number;
	messages: ChildMessage[];
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
	killTimer?: unknown;
	stopReason?: string;
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

export interface SubagentResultMessage {
	customType: "subagent-result";
	content: string;
	display: true;
	details: {
		jobId: string;
		agent: string;
		status: Exclude<JobStatus, "running">;
		usage: UsageStats;
		stopReason?: string;
	};
}

export function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

// --- Registro ----------------------------------------------------------------

export function createJobRegistry(): JobRegistry {
	const jobs = new Map<string, SubagentJob>();
	let next = 1;
	return {
		create(agent, task, background) {
			const id = `sa-${next}`;
			next += 1;
			const job: SubagentJob = {
				id,
				agent,
				task,
				background,
				status: "running",
				startedAt: Date.now(),
				exited: false,
				killRequested: false,
				proc: null,
			};
			jobs.set(id, job);
			return job;
		},
		get: (id) => jobs.get(id),
		list: () => Array.from(jobs.values()),
		running: () => Array.from(jobs.values()).filter((job) => job.status === "running"),
	};
}

// --- Formato -----------------------------------------------------------------

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsageStats(usage: Partial<UsageStats>, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatJobLine(job: SubagentJob, now: number): string {
	return `${job.id} ${job.agent} ${job.status} ${formatDuration((job.endedAt ?? now) - job.startedAt)}`;
}

export function formatAbortNotice(jobs: SubagentJob[]): string {
	if (jobs.length === 0) return "";
	return `Abortados ${jobs.length} subagentes: ${jobs.map((job) => `${job.id} (${job.agent})`).join(", ")}`;
}

export function getFinalOutput(messages: ChildMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]!;
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "text" && part.text) return part.text;
			}
		}
	}
	return "";
}

export function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}

export function truncateOutput(output: string, note = ""): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return output;
	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) truncated = truncated.slice(0, -1);
	const omitted = byteLength - Buffer.byteLength(truncated, "utf8");
	return `${truncated}\n\n[Output truncated: ${omitted} bytes omitted.${note ? ` ${note}` : ""}]`;
}

function statusLabel(job: SubagentJob, result: SingleResult): string {
	if (job.status === "aborted") return "aborted";
	if (job.status === "failed") return `failed (${result.stopReason ?? `exit ${result.exitCode}`})`;
	return "completed";
}

export function formatJobReport(job: SubagentJob, result: SingleResult): string {
	const usage = formatUsageStats(result.usage, result.model);
	return [
		`Subagente ${job.id} (${job.agent}): ${statusLabel(job, result)}`,
		`Uso: ${usage || "sin datos"}`,
		"---",
		truncateOutput(getResultOutput(result)),
	].join("\n");
}

export function buildResultMessage(job: SubagentJob, result: SingleResult): SubagentResultMessage {
	const status: SubagentResultMessage["details"]["status"] = job.status === "running" ? "completed" : job.status;
	return {
		customType: "subagent-result",
		content: formatJobReport(job, result),
		display: true,
		details: {
			jobId: job.id,
			agent: job.agent,
			status,
			usage: result.usage,
			...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
		},
	};
}

// --- Kill --------------------------------------------------------------------

function scheduleTimer(deps: RunnerDeps, callback: () => void, ms: number): unknown {
	if (deps.setTimeout) return deps.setTimeout(callback, ms);
	const timer = setTimeout(callback, ms);
	timer.unref();
	return timer;
}

function cancelTimer(deps: RunnerDeps, handle: unknown): void {
	if (deps.clearTimeout) deps.clearTimeout(handle);
	else clearTimeout(handle as NodeJS.Timeout);
}

// SIGTERM ahora y SIGKILL a los 5 s si el hijo sigue vivo. Idempotente por job:
// una segunda llamada (segundo session_shutdown, abort repetido) no manda nada.
export function killJob(job: SubagentJob, deps: RunnerDeps): boolean {
	if (job.status !== "running" || job.killRequested || !job.proc) return false;
	const proc = job.proc;
	job.killRequested = true;
	job.status = "aborted";
	job.stopReason = "aborted";
	proc.kill("SIGTERM");
	job.killTimer = scheduleTimer(
		deps,
		() => {
			job.killTimer = undefined;
			if (!job.exited) proc.kill("SIGKILL");
		},
		deps.killGraceMs ?? KILL_GRACE_MS,
	);
	return true;
}

export function abortRunningJobs(registry: JobRegistry, deps: RunnerDeps): SubagentJob[] {
	return registry.running().filter((job) => killJob(job, deps));
}

// Espera a que cada job de `jobs` cierre de verdad (evento "close" del
// proceso), sin importar si murio por el SIGTERM inicial o por el SIGKILL de
// gracia que killJob/abortRunningJobs ya agendaron. Pi ejecuta process.exit(0)
// apenas el handler de session_shutdown resuelve (issue #44 CA-5, PR #48
// review comment 4076517086): sin esta espera, un hijo que ignora SIGTERM
// sobrevive al proceso padre porque el timer de SIGKILL nunca llega a correr.
// Un job sin proceso o que ya salio resuelve al toque.
export function awaitJobsExit(jobs: SubagentJob[]): Promise<void> {
	return Promise.all(
		jobs.map((job) => {
			if (job.exited || !job.proc) return Promise.resolve();
			return new Promise<void>((resolve) => {
				job.proc!.on("close", () => resolve());
			});
		}),
	).then(() => undefined);
}

// --- Comando /subagents --------------------------------------------------------

export function subagentsCommand(
	args: string,
	registry: JobRegistry,
	notify: (text: string, level: "info" | "warning" | "error") => void,
	deps: RunnerDeps,
): void {
	const trimmed = args.trim();
	if (trimmed === "") {
		const jobs = registry.list();
		if (jobs.length === 0) {
			notify("Sin subagentes en esta sesión", "info");
			return;
		}
		const now = (deps.now ?? Date.now)();
		notify(jobs.map((job) => formatJobLine(job, now)).join("\n"), "info");
		return;
	}
	const abort = trimmed.match(/^abort\s+(\S+)$/);
	if (!abort) {
		notify("Uso: /subagents [abort <id>]", "error");
		return;
	}
	const job = registry.get(abort[1]!);
	if (!job) {
		notify(`No existe el job ${abort[1]}`, "error");
		return;
	}
	if (!killJob(job, deps)) {
		notify(`${job.id} ya no esta running (${job.status})`, "error");
		return;
	}
	notify(`${job.id} (${job.agent}) abortado`, "warning");
}

// --- Lanzamiento ---------------------------------------------------------------

// Igual que el ejemplo de Pi: si el proceso actual es un script (pi lanzado
// por node), relanzar node <script>; si es un binario empaquetado, relanzarlo;
// si no, `pi` en PATH.
export function getPiInvocation(args: string[]): PiInvocation {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) return { command: process.execPath, args };
	return { command: "pi", args };
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.mkdtemp(join(tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = join(dir, `prompt-${safeName}.md`);
	await fs.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	await fs.chmod(filePath, 0o600);
	return { dir, filePath };
}

function removeTempPrompt(tmp: { dir: string; filePath: string } | null): void {
	if (!tmp) return;
	try {
		unlinkSync(tmp.filePath);
	} catch {
		/* ignore */
	}
	try {
		rmdirSync(tmp.dir);
	} catch {
		/* ignore */
	}
}

// Lanza `pi --mode json -p --no-session ... <task>` para `agent` y registra el
// job. Resuelve apenas el proceso existe (pid disponible); `completion` se
// resuelve con el resultado al cerrar el hijo. El task viaja literal como
// ultimo argumento: un `/skill:...` inicial lo expande Pi en el hijo.
export async function launchAgent(
	registry: JobRegistry,
	agent: AgentConfig,
	task: string,
	options: LaunchOptions,
	deps: RunnerDeps,
): Promise<LaunchedAgent> {
	const now = deps.now ?? Date.now;
	const job = registry.create(agent.name, task, options.background);

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	const explicitModel = options.modelOverride ?? agent.model;
	const model = explicitModel ?? options.model;
	if (model) args.push("--model", model);
	// El thinking de la sesion solo se hereda junto con su modelo.
	if (!explicitModel && options.thinkingLevel) args.push("--thinking", options.thinkingLevel);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmp: { dir: string; filePath: string } | null = null;
	if (agent.systemPrompt.trim()) {
		tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
		args.push("--append-system-prompt", tmp.filePath);
	}
	args.push(task);

	const result: SingleResult = {
		agent: agent.name,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model,
		step: options.step,
		jobId: job.id,
	};

	const invocation = (deps.resolveInvocation ?? getPiInvocation)(args);
	let proc: ChildProcessLike;
	try {
		proc = deps.spawn(invocation.command, invocation.args, {
			cwd: options.cwd,
			env: { ...(deps.env ?? process.env), PI_SUBAGENT_DEPTH: "1" },
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		removeTempPrompt(tmp);
		job.status = "failed";
		job.exited = true;
		job.endedAt = now();
		throw error;
	}
	job.proc = proc;
	job.pid = proc.pid;
	job.startedAt = now();

	const completion = new Promise<SingleResult>((resolve) => {
		let buffer = "";
		let finished = false;

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: { type?: string; message?: ChildMessage };
			try {
				event = JSON.parse(line) as { type?: string; message?: ChildMessage };
			} catch {
				return;
			}
			if (event.type === "message_end" && event.message) {
				const message = event.message;
				result.messages.push(message);
				if (message.role === "assistant") {
					result.usage.turns += 1;
					const usage = message.usage;
					if (usage) {
						result.usage.input += usage.input || 0;
						result.usage.output += usage.output || 0;
						result.usage.cacheRead += usage.cacheRead || 0;
						result.usage.cacheWrite += usage.cacheWrite || 0;
						result.usage.cost += usage.cost?.total || 0;
						result.usage.contextTokens = usage.totalTokens || 0;
					}
					if (!result.model && message.model) result.model = message.model;
					if (message.stopReason) result.stopReason = message.stopReason;
					if (message.errorMessage) result.errorMessage = message.errorMessage;
				}
				options.onUpdate?.(result);
			} else if (event.type === "tool_result_end" && event.message) {
				result.messages.push(event.message);
				options.onUpdate?.(result);
			}
		};

		const finish = (code: number) => {
			if (finished) return;
			finished = true;
			if (buffer.trim()) processLine(buffer);
			buffer = "";
			job.exited = true;
			job.endedAt = now();
			if (job.killTimer !== undefined) {
				cancelTimer(deps, job.killTimer);
				job.killTimer = undefined;
			}
			removeTempPrompt(tmp);
			result.exitCode = code;
			if (job.status === "aborted") {
				result.stopReason = "aborted";
			} else {
				job.status = isFailedResult(result) ? "failed" : "completed";
			}
			job.result = result;
			resolve(result);
		};

		proc.stdout.on("data", (chunk) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});
		proc.stderr.on("data", (chunk) => {
			result.stderr += chunk.toString();
		});
		proc.on("close", (code) => finish(code ?? 0));
		proc.on("error", (error) => {
			result.stderr += error.message;
			finish(1);
		});
	});

	if (options.signal) {
		const abort = () => {
			killJob(job, deps);
		};
		if (options.signal.aborted) abort();
		else options.signal.addEventListener("abort", abort, { once: true });
	}

	return { job, completion };
}
