// Logica de la tool `subagent` (issue #44 CA-1..CA-4), sin imports runtime de
// Pi para poder probarla con `spawn` y `sendMessage` inyectados.
//
// Modos: single (agent + task), parallel (tasks[], max 8, 4 concurrentes) y
// chain (secuencial con {previous}). Solo single admite `background: true`:
// devuelve el id del job al instante y, al terminar el hijo, inyecta un
// mensaje custom `subagent-result` como followUp que dispara un turno.

import { type AgentConfig, type AgentDiscoveryDeps, type AgentScope, discoverAgents } from "./agents.ts";
import {
	buildResultMessage,
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	type JobRegistry,
	launchAgent,
	MAX_CONCURRENCY,
	MAX_PARALLEL_TASKS,
	type RunnerDeps,
	type SingleResult,
	type SubagentResultMessage,
	emptyUsage,
	truncateOutput,
} from "./jobs.ts";

export type { SubagentResultMessage } from "./jobs.ts";

export const NESTING_ERROR = "anidamiento de subagentes no permitido";

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

export type SubagentMode = "single" | "parallel" | "chain";

export interface SubagentDetails {
	mode: SubagentMode;
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

interface Dispatch {
	cwd: string;
	model?: string;
	thinkingLevel?: string;
	modelOverride?: string;
}

function text(value: string): ToolResult["content"] {
	return [{ type: "text", text: value }];
}

function unknownAgentResult(agentName: string, task: string, agents: AgentConfig[], step?: number): SingleResult {
	const available = agents.map((agent) => `"${agent.name}"`).join(", ") || "none";
	return {
		agent: agentName,
		agentSource: "unknown",
		task,
		exitCode: 1,
		messages: [],
		stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
		usage: emptyUsage(),
		step,
	};
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current]!, current);
		}
	});
	await Promise.all(workers);
	return results;
}

function nestingDepth(env: NodeJS.ProcessEnv): number {
	const parsed = Number.parseInt(env.PI_SUBAGENT_DEPTH ?? "0", 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function createSubagentExecute(deps: SubagentToolDeps): SubagentExecute {
	const runSingle = async (
		agents: AgentConfig[],
		agentName: string,
		task: string,
		dispatch: Dispatch,
		cwd: string | undefined,
		step: number | undefined,
		signal: AbortSignal | undefined,
		onUpdate: ((result: SingleResult) => void) | undefined,
	): Promise<SingleResult> => {
		const agent = agents.find((candidate) => candidate.name === agentName);
		if (!agent) return unknownAgentResult(agentName, task, agents, step);
		const launched = await launchAgent(
			deps.registry,
			agent,
			task,
			{
				cwd: cwd ?? dispatch.cwd,
				background: false,
				model: dispatch.model,
				thinkingLevel: dispatch.thinkingLevel,
				modelOverride: dispatch.modelOverride,
				signal,
				step,
				onUpdate,
			},
			deps.runner,
		);
		return launched.completion;
	};

	return async (_toolCallId, params, signal, onUpdate, ctx) => {
		const agentScope: AgentScope = params.agentScope ?? "package";
		const discovery = discoverAgents(ctx.cwd, agentScope, deps.discovery ?? {});
		const agents = discovery.agents;
		const confirmProjectAgents = params.confirmProjectAgents ?? true;
		const dispatch: Dispatch = {
			cwd: ctx.cwd,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			thinkingLevel: ctx.thinkingLevel,
			modelOverride: params.model,
		};

		const hasChain = (params.chain?.length ?? 0) > 0;
		const hasTasks = (params.tasks?.length ?? 0) > 0;
		const hasSingle = Boolean(params.agent && params.task);
		const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
		const mode: SubagentMode = hasChain ? "chain" : hasTasks ? "parallel" : "single";

		const makeDetails =
			(detailsMode: SubagentMode) =>
			(results: SingleResult[]): SubagentDetails => ({
				mode: detailsMode,
				agentScope,
				projectAgentsDir: discovery.projectAgentsDir,
				results,
			});
		const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";

		if (modeCount !== 1) {
			return {
				content: text(`Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`),
				details: makeDetails("single")([]),
			};
		}
		if (params.background && !hasSingle) {
			return {
				content: text("`background: true` solo vale en modo single (agent + task); parallel y chain corren en foreground."),
				details: makeDetails(mode)([]),
				isError: true,
			};
		}
		// Un hijo lanzado por esta tool hereda PI_SUBAGENT_DEPTH=1: no anida.
		if (nestingDepth(deps.env ?? process.env) >= 1) {
			return { content: text(NESTING_ERROR), details: makeDetails(mode)([]), isError: true };
		}

		// Los agentes del proyecto son prompts controlados por el repo: en un
		// repo no confiable y con UI se confirman, salvo confirmProjectAgents=false.
		// Los de package y user nunca preguntan.
		if ((agentScope === "project" || agentScope === "all") && confirmProjectAgents && ctx.hasUI && !ctx.isProjectTrusted()) {
			const requested = new Set<string>();
			if (params.chain) for (const step of params.chain) requested.add(step.agent);
			if (params.tasks) for (const item of params.tasks) requested.add(item.agent);
			if (params.agent) requested.add(params.agent);
			const projectAgents = Array.from(requested)
				.map((name) => agents.find((agent) => agent.name === name))
				.filter((agent): agent is AgentConfig => agent?.source === "project");
			if (projectAgents.length > 0) {
				const names = projectAgents.map((agent) => agent.name).join(", ");
				const dir = discovery.projectAgentsDir ?? "(unknown)";
				const ok = await ctx.ui.confirm(
					"Run project-local agents?",
					`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
				);
				if (!ok) {
					return { content: text("Canceled: project-local agents not approved."), details: makeDetails(mode)([]) };
				}
			}
		}

		if (params.chain && params.chain.length > 0) {
			const results: SingleResult[] = [];
			let previousOutput = "";
			for (let i = 0; i < params.chain.length; i++) {
				const step = params.chain[i]!;
				const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
				const chainUpdate = onUpdate
					? (current: SingleResult) =>
						  onUpdate({
							  content: text(getFinalOutput(current.messages) || "(running...)"),
							  details: makeDetails("chain")([...results, current]),
						  })
					: undefined;
				const result = await runSingle(agents, step.agent, taskWithContext, dispatch, step.cwd, i + 1, signal, chainUpdate);
				results.push(result);
				if (isFailedResult(result)) {
					return {
						content: text(`Chain stopped at step ${i + 1} (${step.agent}): ${getResultOutput(result)}`),
						details: makeDetails("chain")(results),
						isError: true,
					};
				}
				previousOutput = getFinalOutput(result.messages);
			}
			return {
				content: text(getFinalOutput(results[results.length - 1]!.messages) || "(no output)"),
				details: makeDetails("chain")(results),
			};
		}

		if (params.tasks && params.tasks.length > 0) {
			if (params.tasks.length > MAX_PARALLEL_TASKS) {
				return {
					content: text(`Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`),
					details: makeDetails("parallel")([]),
				};
			}
			const allResults: SingleResult[] = params.tasks.map((item) => ({
				agent: item.agent,
				agentSource: "unknown",
				task: item.task,
				exitCode: -1, // -1 = todavia corriendo
				messages: [],
				stderr: "",
				usage: emptyUsage(),
			}));
			const emitParallelUpdate = () => {
				if (!onUpdate) return;
				const running = allResults.filter((result) => result.exitCode === -1).length;
				const done = allResults.length - running;
				onUpdate({
					content: text(`Parallel: ${done}/${allResults.length} done, ${running} running...`),
					details: makeDetails("parallel")([...allResults]),
				});
			};
			const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (item, index) => {
				const result = await runSingle(agents, item.agent, item.task, dispatch, item.cwd, undefined, signal, (partial) => {
					allResults[index] = { ...partial, exitCode: -1 };
					emitParallelUpdate();
				});
				allResults[index] = result;
				emitParallelUpdate();
				return result;
			});
			const successCount = results.filter((result) => !isFailedResult(result)).length;
			const summaries = results.map((result) => {
				const output = truncateOutput(getResultOutput(result), "Full output preserved in tool details.");
				const status = isFailedResult(result)
					? `failed${result.stopReason && result.stopReason !== "end" ? ` (${result.stopReason})` : ""}`
					: "completed";
				return `### [${result.agent}] ${status}\n\n${output}`;
			});
			return {
				content: text(`Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`),
				details: makeDetails("parallel")(results),
			};
		}

		// single
		const agentName = params.agent!;
		const task = params.task!;
		const agent = agents.find((candidate) => candidate.name === agentName);
		if (!agent) {
			const missing = unknownAgentResult(agentName, task, agents);
			return { content: text(`Agent failed: ${missing.stderr}`), details: makeDetails("single")([missing]), isError: true };
		}

		if (params.background) {
			const launched = await launchAgent(
				deps.registry,
				agent,
				task,
				{
					cwd: params.cwd ?? dispatch.cwd,
					background: true,
					model: dispatch.model,
					thinkingLevel: dispatch.thinkingLevel,
					modelOverride: dispatch.modelOverride,
				},
				deps.runner,
			);
			const { job } = launched;
			void launched.completion.then((result) => {
				// Un job abortado (session_shutdown o /subagents abort) no reporta.
				if (job.status === "aborted") return;
				deps.sendMessage(buildResultMessage(job, result), { deliverAs: "followUp", triggerTurn: true });
			});
			return {
				content: text(`Job ${job.id} lanzado (${agent.name})`),
				details: { jobId: job.id, agent: agent.name, pid: job.pid, status: "running" },
			};
		}

		const result = await runSingle(
			agents,
			agentName,
			task,
			dispatch,
			params.cwd,
			undefined,
			signal,
			onUpdate
				? (current) =>
					  onUpdate({
						  content: text(getFinalOutput(current.messages) || "(running...)"),
						  details: makeDetails("single")([current]),
					  })
				: undefined,
		);
		if (isFailedResult(result)) {
			return {
				content: text(`Agent ${result.stopReason || "failed"}: ${getResultOutput(result)}`),
				details: makeDetails("single")([result]),
				isError: true,
			};
		}
		return { content: text(getFinalOutput(result.messages) || "(no output)"), details: makeDetails("single")([result]) };
	};
}
