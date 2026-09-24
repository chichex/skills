// Extension `subagent` del Pi Package (issue #44): tool `subagent` para delegar
// tareas a subagentes con contexto aislado (hijos `pi --mode json -p
// --no-session`), comando `/subagents` y kill de los hijos vivos en
// session_shutdown. Adaptacion propia de examples/extensions/subagent de Pi
// 0.85.1 con tres agentes bundleados (implementer, reviewer, scout), scope
// `package` y modo background.
//
// La factory solo registra: procesos, timers y handles los crean la tool y el
// comando cuando se usan.

import { spawn } from "node:child_process";
import { StringEnum } from "@earendil-works/pi-ai";
import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { PACKAGE_AGENTS_DIR } from "./agents.ts";
import {
	abortRunningJobs,
	awaitJobsExit,
	createJobRegistry,
	formatAbortNotice,
	MAX_CONCURRENCY,
	MAX_PARALLEL_TASKS,
	type RunnerDeps,
	type SpawnLike,
	subagentsCommand,
} from "./jobs.ts";
import { renderCall, renderResult } from "./render.ts";
import { createSubagentExecute, type SubagentToolDeps } from "./tool.ts";

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["package", "user", "project", "all"] as const, {
	description: [
		'Which agent directories to use. Default: "package" (the agents bundled with this Pi Package).',
		'"user" reads <agent dir>/agents, "project" reads the nearest project-local agents dir,',
		'"all" combines the three with precedence project > user > package.',
	].join(" "),
	default: "package",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode). A leading /skill:<name> is expanded by the child." })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	background: Type.Optional(
		Type.Boolean({
			description:
				"Single mode only: return immediately with a job id (sa-N) and inject the report as a `subagent-result` message when the child finishes. Default: false.",
			default: false,
		}),
	),
	model: Type.Optional(
		Type.String({
			description: "provider/id to run the child with; overrides the agent's model and the session model (no --thinking is inherited).",
		}),
	),
});

const DESCRIPTION = [
	"Delegate tasks to specialized subagents with isolated context.",
	`Modes: single (agent + task), parallel (tasks array, max ${MAX_PARALLEL_TASKS} tasks, ${MAX_CONCURRENCY} concurrent), chain (sequential with {previous} placeholder).`,
	"Single mode accepts background: true to get a job id (sa-N) back at once; the report arrives later as a subagent-result message and /subagents lists or aborts jobs.",
	`Default agent scope is "package": implementer, reviewer and scout bundled in ${PACKAGE_AGENTS_DIR}.`,
	`Set agentScope to "user", "project" or "all" to include ${getAgentDir()}/agents or ${CONFIG_DIR_NAME}/agents.`,
].join(" ");

export default function (pi: ExtensionAPI): void {
	const registry = createJobRegistry();
	const runner: RunnerDeps = { spawn: spawn as unknown as SpawnLike };
	const deps: SubagentToolDeps = {
		registry,
		runner,
		discovery: { getAgentDir, configDirName: CONFIG_DIR_NAME, parseFrontmatter },
		sendMessage: (message, options) => pi.sendMessage(message, options),
	};
	const execute = createSubagentExecute(deps);

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: DESCRIPTION,
		parameters: SubagentParams,
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const result = await execute(toolCallId, params, signal, onUpdate, ctx);
			// AgentToolResult de Pi no define `isError` (PR #48 review, comment
			// 4076517102): executePreparedToolCall solo marca isError:true si
			// execute() rechaza, asi que un `{ isError: true }` resuelto
			// normalmente (nesting, agente desconocido, hijo fallido) entraba al
			// transcript como si hubiera tenido exito. Lanzar preserva el texto
			// del resultado para el modelo; los `details` estructurados de ese
			// resultado puntual se pierden (ver el fallback en render.ts).
			if (result.isError) throw new Error(result.content.map((part) => part.text ?? "").join(""));
			return result;
		},
		renderCall: (args, theme) => renderCall(args, theme),
		renderResult: (result, options, theme) => renderResult(result, options, theme),
	});

	pi.registerCommand("subagents", {
		description: "Lista los subagentes de la sesión o aborta uno: /subagents [abort <id>]",
		handler: async (args, ctx) => {
			subagentsCommand(args ?? "", registry, (text, level) => ctx.ui.notify(text, level), runner);
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const aborted = abortRunningJobs(registry, runner);
		if (aborted.length > 0 && ctx.hasUI) ctx.ui.notify(formatAbortNotice(aborted), "warning");
		// Pi corre process.exit(0) apenas este handler resuelve (PR #48 review
		// comment 4076517086): sin esperar el cierre real, un hijo que ignora
		// SIGTERM sobrevive al proceso padre.
		await awaitJobsExit(aborted);
	});
}
