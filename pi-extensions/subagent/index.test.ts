import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	accessSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { abortRunningJobs, createJobRegistry, PER_TASK_OUTPUT_CAP, type RunnerDeps, type SpawnLike } from "./jobs.ts";
import { createSubagentExecute, NESTING_ERROR, type SubagentToolDeps, type ToolContextLike } from "./tool.ts";

// Issue #44:
// - CA-1: la factory real (index.ts, con typebox/pi-tui/pi-coding-agent) se
//	 carga en un sandbox con los peers de la instalacion local de Pi, igual que
//	 pi-extensions/ask-user-question; se skipea sin `pi`.
// - CA-3 y CA-4: la logica de la tool (tool.ts) se prueba directo con `spawn`
//	 y `sendMessage` inyectados y un hijo simulado: sin `pi` real ni providers.

const EXTENSION_DIR = fileURLToPath(new URL("./", import.meta.url));

function findPiPackageRoot(): string | undefined {
	const located = spawnSync("sh", ["-c", "command -v pi"], { encoding: "utf8" });
	const executable = located.status === 0 ? located.stdout.trim() : "";
	if (!executable) return undefined;
	try {
		const root = resolve(dirname(realpathSync(executable)), "../..");
		accessSync(join(root, "package.json"));
		return root;
	} catch {
		return undefined;
	}
}

const PI_PACKAGE_ROOT = findPiPackageRoot();
const cleanups: string[] = [];

after(() => {
	for (const path of cleanups) rmSync(path, { recursive: true, force: true });
});

function activeHandles(): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const name of process.getActiveResourcesInfo()) {
		if (name === "ChildProcess" || name === "Timeout" || name === "Immediate") counts[name] = (counts[name] ?? 0) + 1;
	}
	return counts;
}

// --- CA-1: factory real en sandbox -------------------------------------------

test("CA-1: la factory registra la tool `subagent` con su schema, el comando /subagents y session_shutdown, sin abrir handles", { skip: !PI_PACKAGE_ROOT }, async () => {
	const sandbox = mkdtempSync(join(tmpdir(), "chichex-subagent-index-"));
	cleanups.push(sandbox);
	mkdirSync(join(sandbox, "agents"), { recursive: true });
	for (const entry of readdirSync(EXTENSION_DIR)) {
		if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) copyFileSync(join(EXTENSION_DIR, entry), join(sandbox, entry));
	}
	for (const entry of readdirSync(join(EXTENSION_DIR, "agents"))) {
		copyFileSync(join(EXTENSION_DIR, "agents", entry), join(sandbox, "agents", entry));
	}
	const scopedRoot = join(sandbox, "node_modules", "@earendil-works");
	mkdirSync(scopedRoot, { recursive: true });
	for (const packageName of ["pi-ai", "pi-tui", "pi-agent-core"]) {
		symlinkSync(join(PI_PACKAGE_ROOT!, "node_modules", "@earendil-works", packageName), join(scopedRoot, packageName), "dir");
	}
	symlinkSync(PI_PACKAGE_ROOT!, join(scopedRoot, "pi-coding-agent"), "dir");
	symlinkSync(join(PI_PACKAGE_ROOT!, "node_modules", "typebox"), join(sandbox, "node_modules", "typebox"), "dir");

	const { default: register } = await import(`${pathToFileURL(join(sandbox, "index.ts")).href}?test=${Date.now()}`);
	const tools: Array<Record<string, any>> = [];
	const commands: Array<{ name: string; options: Record<string, any> }> = [];
	const events: string[] = [];
	const before = activeHandles();
	register({
		registerTool(tool: Record<string, any>) {
			tools.push(tool);
		},
		registerCommand(name: string, options: Record<string, any>) {
			commands.push({ name, options });
		},
		on(name: string) {
			events.push(name);
		},
		sendMessage() {},
		events: { on() {}, emit() {} },
	} as never);
	assert.deepEqual(activeHandles(), before, "la factory no inicia procesos, timers ni handles");

	assert.deepEqual(tools.map((tool) => tool.name), ["subagent"]);
	const tool = tools[0]!;
	assert.equal(typeof tool.execute, "function");
	assert.equal(typeof tool.renderCall, "function");
	assert.equal(typeof tool.renderResult, "function");
	const properties = tool.parameters.properties as Record<string, any>;
	assert.deepEqual(
		Object.keys(properties).sort(),
		["agent", "agentScope", "background", "chain", "confirmProjectAgents", "cwd", "model", "task", "tasks"],
	);
	assert.equal(properties.agent.type, "string");
	assert.equal(properties.task.type, "string");
	assert.equal(properties.tasks.type, "array");
	assert.deepEqual(Object.keys(properties.tasks.items.properties).sort(), ["agent", "cwd", "task"]);
	assert.equal(properties.chain.type, "array");
	assert.match(properties.chain.items.properties.task.description, /\{previous\}/);
	assert.deepEqual(properties.agentScope.enum, ["package", "user", "project", "all"]);
	assert.equal(properties.agentScope.default, "package");
	assert.equal(properties.confirmProjectAgents.type, "boolean");
	assert.equal(properties.confirmProjectAgents.default, true);
	assert.equal(properties.background.type, "boolean");
	assert.equal(properties.background.default, false);
	assert.match(properties.background.description, /single/i);
	assert.equal(properties.model.type, "string");
	assert.match(tool.description, /8 tareas|max(imo)? 8|8 tasks/i);
	assert.match(tool.description, /package/);

	assert.deepEqual(commands.map((command) => command.name), ["subagents"]);
	assert.equal(typeof commands[0]!.options.handler, "function");
	assert.ok(events.includes("session_shutdown"), "registra el kill de CA-5");
});

// --- PR #48 review (comment 4076517102): isError a traves del runtime real --

function usage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

// AgentToolResult de Pi (@earendil-works/pi-agent-core) no define `isError`;
// `executePreparedToolCall` fija `isError: false` para cualquier execute()
// que resuelva normalmente y solo pone `true` si la promesa rechaza. Este
// test corre la tool REAL (registrada por la factory real) a traves del
// Agent real de pi-agent-core con un streamFn scripteado (sin proveedores:
// nunca llama una API), y observa `tool_execution_end.isError` tal como lo
// veria Pi en produccion — no el `ToolResult.isError` que tool.ts devuelve
// como dato interno.
test("CA-3: un rechazo de la tool (nesting) llega como tool_execution_end.isError=true en el runtime real de Pi", { skip: !PI_PACKAGE_ROOT }, async () => {
	const sandbox = mkdtempSync(join(tmpdir(), "chichex-subagent-runtime-"));
	cleanups.push(sandbox);
	mkdirSync(join(sandbox, "agents"), { recursive: true });
	for (const entry of readdirSync(EXTENSION_DIR)) {
		if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) copyFileSync(join(EXTENSION_DIR, entry), join(sandbox, entry));
	}
	for (const entry of readdirSync(join(EXTENSION_DIR, "agents"))) {
		copyFileSync(join(EXTENSION_DIR, "agents", entry), join(sandbox, "agents", entry));
	}
	const scopedRoot = join(sandbox, "node_modules", "@earendil-works");
	mkdirSync(scopedRoot, { recursive: true });
	for (const packageName of ["pi-ai", "pi-tui", "pi-agent-core"]) {
		symlinkSync(join(PI_PACKAGE_ROOT!, "node_modules", "@earendil-works", packageName), join(scopedRoot, packageName), "dir");
	}
	symlinkSync(PI_PACKAGE_ROOT!, join(scopedRoot, "pi-coding-agent"), "dir");
	symlinkSync(join(PI_PACKAGE_ROOT!, "node_modules", "typebox"), join(sandbox, "node_modules", "typebox"), "dir");

	const { default: register } = await import(`${pathToFileURL(join(sandbox, "index.ts")).href}?test=${Date.now()}`);
	const tools: Array<{ name: string; execute: (...args: any[]) => Promise<any> }> = [];
	register({
		registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }) {
			tools.push(tool);
		},
		registerCommand() {},
		on() {},
		sendMessage() {},
		events: { on() {}, emit() {} },
	} as never);
	const subagentTool = tools[0]!;
	// El AgentTool de pi-agent-core (la interfaz que consume el Agent real)
	// llama execute(toolCallId, params, signal, onUpdate) con 4 argumentos:
	// pi-coding-agent es quien liga el 5to (`ctx: ExtensionContext`) antes de
	// entregar la tool a pi-agent-core. Como este test no levanta esa capa
	// completa, ligamos un ctx minimo equivalente (mismo shape que
	// ToolContextLike) para ejercitar el mismo camino que corre en produccion.
	const fakeCtx = {
		cwd: sandbox,
		hasUI: false,
		isProjectTrusted: () => true,
		model: { provider: "anthropic", id: "test-model" },
		thinkingLevel: "off",
		ui: { confirm: async () => true },
	};
	const wrappedTool = {
		...subagentTool,
		execute: (toolCallId: string, params: unknown, signal: unknown, onUpdate: unknown) =>
			subagentTool.execute(toolCallId, params, signal, onUpdate, fakeCtx),
	};

	// pi-agent-core resuelve `@earendil-works/pi-ai` desde su propio
	// node_modules hoisted (sibling de pi-agent-core dentro de
	// pi-coding-agent/node_modules): un import por path absoluto no necesita
	// sandbox propio.
	const agentCoreEntry = join(PI_PACKAGE_ROOT!, "node_modules", "@earendil-works", "pi-agent-core", "dist", "index.js");
	const piAiEntry = join(PI_PACKAGE_ROOT!, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js");
	const { Agent } = await import(pathToFileURL(agentCoreEntry).href);
	const { createAssistantMessageEventStream } = await import(pathToFileURL(piAiEntry).href);

	const previousDepth = process.env.PI_SUBAGENT_DEPTH;
	process.env.PI_SUBAGENT_DEPTH = "1"; // simula un padre ya anidado (CA-3)
	try {
		let call = 0;
		function streamFn() {
			call += 1;
			const stream = createAssistantMessageEventStream();
			const message =
				call === 1
					? {
							role: "assistant",
							content: [{ type: "toolCall", id: "call-1", name: "subagent", arguments: { agent: "implementer", task: "t" } }],
							api: "anthropic-messages",
							provider: "anthropic",
							model: "test-model",
							usage: usage(),
							stopReason: "toolUse",
							timestamp: Date.now(),
						}
					: {
							role: "assistant",
							content: [{ type: "text", text: "listo" }],
							api: "anthropic-messages",
							provider: "anthropic",
							model: "test-model",
							usage: usage(),
							stopReason: "stop",
							timestamp: Date.now(),
						};
			stream.push({ type: "done", reason: message.stopReason, message });
			return stream;
		}

		const agent = new Agent({
			streamFn,
			initialState: {
				systemPrompt: "test",
				model: { provider: "anthropic", id: "test-model" },
				thinkingLevel: "off",
				tools: [wrappedTool],
				messages: [],
			},
		});
		const toolEvents: Array<{ toolName: string; isError: boolean }> = [];
		agent.subscribe((event: { type: string; toolName?: string; isError?: boolean }) => {
			if (event.type === "tool_execution_end") toolEvents.push(event as { toolName: string; isError: boolean });
		});

		await agent.prompt("dispara un subagente anidado");

		assert.equal(toolEvents.length, 1);
		assert.equal(toolEvents[0]!.toolName, "subagent");
		assert.equal(toolEvents[0]!.isError, true, "el rechazo de nesting debe llegar como tool_execution_end.isError");
	} finally {
		if (previousDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = previousDepth;
	}
});

// Companero necesario del fix anterior: al hacer que index.ts lance una
// excepcion cuando `result.isError`, Pi colapsa ese resultado a
// `{content, details: {}}` (createErrorToolResult) para el transcript real.
// render.ts asumia `details.results` siempre presente; sin el `?.`, un
// resultado de error real crashearia el renderResult de la TUI.
test("renderResult no crashea con `details: {}` (lo que produce Pi al colapsar un execute() que rechaza)", { skip: !PI_PACKAGE_ROOT }, async () => {
	const sandbox = mkdtempSync(join(tmpdir(), "chichex-subagent-render-"));
	cleanups.push(sandbox);
	for (const entry of readdirSync(EXTENSION_DIR)) {
		if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) copyFileSync(join(EXTENSION_DIR, entry), join(sandbox, entry));
	}
	const scopedRoot = join(sandbox, "node_modules", "@earendil-works");
	mkdirSync(scopedRoot, { recursive: true });
	for (const packageName of ["pi-ai", "pi-tui", "pi-agent-core"]) {
		symlinkSync(join(PI_PACKAGE_ROOT!, "node_modules", "@earendil-works", packageName), join(scopedRoot, packageName), "dir");
	}
	symlinkSync(PI_PACKAGE_ROOT!, join(scopedRoot, "pi-coding-agent"), "dir");
	symlinkSync(join(PI_PACKAGE_ROOT!, "node_modules", "typebox"), join(sandbox, "node_modules", "typebox"), "dir");

	const { renderResult } = await import(`${pathToFileURL(join(sandbox, "render.ts")).href}?test=${Date.now()}`);
	const fakeTheme = { fg: (_color: string, t: string) => t, bold: (t: string) => t };

	// Forma exacta de createErrorToolResult() en pi-agent-core al colapsar un
	// execute() que rechazo: content con el mensaje, details vacio.
	const collapsed = { content: [{ type: "text", text: "anidamiento de subagentes no permitido" }], details: {} };
	assert.doesNotThrow(() => renderResult(collapsed, { expanded: false }, fakeTheme));
	const rendered = renderResult(collapsed, { expanded: false }, fakeTheme) as { render(width: number): string[] };
	assert.match(rendered.render(200).join("\n"), /anidamiento de subagentes no permitido/);
});

// --- CA-3 y CA-4: tool.ts con hijo simulado ----------------------------------

class FakeChild extends EventEmitter {
	pid = 4242;
	exitCode: number | null = null;
	signals: string[] = [];
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
		this.signals.push(String(signal));
		return true;
	}
	emitEvent(event: unknown): void {
		this.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
	}
	assistant(text: string, extra: Record<string, unknown> = {}): void {
		this.emitEvent({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text }],
				usage: { input: 1000, output: 250, cacheRead: 0, cacheWrite: 0, totalTokens: 1250, cost: { total: 0.005 } },
				stopReason: "end",
				model: "claude-x",
				...extra,
			},
		});
	}
	close(code = 0): void {
		this.exitCode = code;
		this.emit("close", code);
	}
}

interface SpawnCall {
	command: string;
	args: string[];
	options: { cwd: string; env: NodeJS.ProcessEnv; stdio: unknown; shell: boolean };
	child: FakeChild;
}

interface Harness {
	deps: SubagentToolDeps;
	calls: SpawnCall[];
	sent: Array<{ message: Record<string, any>; options: Record<string, any> }>;
	timers: Array<{ callback: () => void; ms: number }>;
	registry: ReturnType<typeof createJobRegistry>;
	execute: ReturnType<typeof createSubagentExecute>;
	ctx: ToolContextLike;
	root: string;
}

function agentMarkdown(name: string, extra = ""): string {
	return `---\nname: ${name}\ndescription: "Agente ${name}"\n${extra}---\n\nSos ${name}. Doctrina de ${name}.\n`;
}

function harness(overrides: { env?: NodeJS.ProcessEnv; trusted?: boolean; hasUI?: boolean; confirm?: () => Promise<boolean> } = {}): Harness {
	const root = mkdtempSync(join(tmpdir(), "chichex-subagent-tool-"));
	cleanups.push(root);
	const packageAgentsDir = join(root, "pkg", "agents");
	const agentDir = join(root, "pi-agent");
	const projectRoot = join(root, "project");
	mkdirSync(packageAgentsDir, { recursive: true });
	mkdirSync(join(agentDir, "agents"), { recursive: true });
	mkdirSync(join(projectRoot, ".pi", "agents"), { recursive: true });
	writeFileSync(join(packageAgentsDir, "implementer.md"), agentMarkdown("implementer"));
	writeFileSync(join(packageAgentsDir, "reviewer.md"), agentMarkdown("reviewer", "tools: read, grep\n"));
	writeFileSync(join(packageAgentsDir, "pinned.md"), agentMarkdown("pinned", "model: openai/gpt-x\n"));
	writeFileSync(join(projectRoot, ".pi", "agents", "local.md"), agentMarkdown("local"));

	const calls: SpawnCall[] = [];
	const sent: Harness["sent"] = [];
	const timers: Harness["timers"] = [];
	const spawn: SpawnLike = (command, args, options) => {
		const child = new FakeChild();
		child.pid = 4242 + calls.length;
		calls.push({ command, args, options, child });
		return child;
	};
	const runner: RunnerDeps = {
		spawn,
		resolveInvocation: (args) => ({ command: "pi", args }),
		env: overrides.env ?? { PATH: "/usr/bin", HOME: root },
		setTimeout: (callback, ms) => {
			const timer = { callback, ms };
			timers.push(timer);
			return timer;
		},
		clearTimeout: () => {},
	};
	const registry = createJobRegistry();
	const deps: SubagentToolDeps = {
		registry,
		runner,
		discovery: { packageAgentsDir, getAgentDir: () => agentDir, configDirName: ".pi" },
		sendMessage: (message, options) => {
			sent.push({ message: message as Record<string, any>, options: options as Record<string, any> });
		},
		env: overrides.env ?? {},
	};
	const ctx: ToolContextLike = {
		cwd: projectRoot,
		hasUI: overrides.hasUI ?? true,
		isProjectTrusted: () => overrides.trusted ?? true,
		model: { provider: "anthropic", id: "claude-x" },
		thinkingLevel: "high",
		ui: { confirm: overrides.confirm ?? (async () => true) },
	};
	return { deps, calls, sent, timers, registry, execute: createSubagentExecute(deps), ctx, root };
}

// Espera por reloj, no por vueltas del event loop: antes de cada spawn hay I/O
// real (mkdtemp + writeFile del prompt temporal) que en un runner de CI lento
// puede tardar mas que 500 setImmediate (~17 ms) y volvia flaky el test.
async function until(condition: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise((done) => setTimeout(done, 1));
	}
	if (condition()) return;
	assert.fail(`timeout esperando: ${label}`);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.map((part) => part.text ?? "").join("");
}

// A diferencia de `until`, no falla el test si la condicion no se cumple:
// sirve para detectar, sin colgar el test, si el codigo bajo prueba SIGUE
// una rama que en el estado buggy no deberia tomar (p. ej. la cadena
// avanzando a un paso 2 que no debe lanzarse).
async function settles(condition: () => boolean, iterations = 100): Promise<boolean> {
	for (let i = 0; i < iterations; i += 1) {
		if (condition()) return true;
		await new Promise((done) => setImmediate(done));
	}
	return false;
}

test("CA-3: el hijo se lanza con --mode json -p --no-session, modelo y thinking de la sesion, --tools, prompt temporal 0600 y el task literal al final", async () => {
	const h = harness();
	const pending = h.execute("call-1", { agent: "reviewer", task: "/skill:code-review 85 --no-publish" }, undefined, undefined, h.ctx);
	await until(() => h.calls.length === 1, "spawn del reviewer");
	const call = h.calls[0]!;
	assert.equal(call.command, "pi");
	const promptIndex = call.args.indexOf("--append-system-prompt");
	assert.ok(promptIndex > 0, "pasa --append-system-prompt");
	const promptPath = call.args[promptIndex + 1]!;
	assert.deepEqual(call.args, [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--model",
		"anthropic/claude-x",
		"--thinking",
		"high",
		"--tools",
		"read,grep",
		"--append-system-prompt",
		promptPath,
		"/skill:code-review 85 --no-publish",
	]);
	assert.equal(call.options.cwd, h.ctx.cwd);
	assert.equal(call.options.shell, false);
	assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
	assert.equal(call.options.env.PI_SUBAGENT_DEPTH, "1");
	assert.equal(call.options.env.PATH, "/usr/bin", "hereda el env base");
	assert.ok(existsSync(promptPath), "el prompt temporal existe mientras corre el hijo");
	assert.equal(statSync(promptPath).mode & 0o777, 0o600);
	assert.equal(readFileSync(promptPath, "utf8"), "\nSos reviewer. Doctrina de reviewer.\n");

	call.child.assistant("Review publicado.");
	call.child.close(0);
	const result = await pending;
	assert.equal(text(result), "Review publicado.");
	assert.notEqual(result.isError, true);
	assert.equal(existsSync(promptPath), false, "el prompt temporal se borra al terminar");
	assert.equal(existsSync(dirname(promptPath)), false, "y su directorio temporal tambien");
	const job = h.registry.get("sa-1");
	assert.equal(job?.status, "completed");
	assert.equal(job?.background, false);
});

test("CA-3: un agente con model fija --model sin --thinking; el parametro `model` de la llamada gana sobre ambos", async () => {
	const h = harness();
	const pinned = h.execute("call-1", { agent: "pinned", task: "t" }, undefined, undefined, h.ctx);
	await until(() => h.calls.length === 1, "spawn de pinned");
	assert.deepEqual(h.calls[0]!.args.slice(0, 6), ["--mode", "json", "-p", "--no-session", "--model", "openai/gpt-x"]);
	assert.equal(h.calls[0]!.args.includes("--thinking"), false);
	assert.equal(h.calls[0]!.args.includes("--tools"), false, "implementer/pinned sin tools heredan todas");
	h.calls[0]!.child.assistant("ok");
	h.calls[0]!.child.close(0);
	await pinned;

	// [DEVIATION] issue #44: `model` por llamada para que sdd-review-loop pueda
	// aplicar --model/--review-model/--fix-model por rol (CA-11).
	const overridden = h.execute("call-2", { agent: "implementer", task: "t", model: "google/gemini-x" }, undefined, undefined, h.ctx);
	await until(() => h.calls.length === 2, "spawn con model override");
	assert.deepEqual(h.calls[1]!.args.slice(0, 6), ["--mode", "json", "-p", "--no-session", "--model", "google/gemini-x"]);
	assert.equal(h.calls[1]!.args.includes("--thinking"), false);
	h.calls[1]!.child.assistant("ok");
	h.calls[1]!.child.close(0);
	await overridden;
});

test("CA-3: `cwd` de la llamada reemplaza el cwd de la sesion para el hijo", async () => {
	const h = harness();
	const other = join(h.root, "other");
	mkdirSync(other, { recursive: true });
	const pending = h.execute("call-1", { agent: "implementer", task: "t", cwd: other }, undefined, undefined, h.ctx);
	await until(() => h.calls.length === 1, "spawn con cwd");
	assert.equal(h.calls[0]!.options.cwd, other);
	h.calls[0]!.child.assistant("ok");
	h.calls[0]!.child.close(0);
	await pending;
});

test("CA-3: con PI_SUBAGENT_DEPTH >= 1 en el padre, la tool rechaza sin lanzar ningun proceso", async () => {
	const h = harness({ env: { PI_SUBAGENT_DEPTH: "1" } });
	const result = await h.execute("call-1", { agent: "implementer", task: "t" }, undefined, undefined, h.ctx);
	assert.equal(result.isError, true);
	assert.match(text(result), /anidamiento de subagentes no permitido/);
	assert.equal(NESTING_ERROR, "anidamiento de subagentes no permitido");
	assert.equal(h.calls.length, 0);
	const background = await h.execute("call-2", { agent: "implementer", task: "t", background: true }, undefined, undefined, h.ctx);
	assert.equal(background.isError, true);
	assert.equal(h.calls.length, 0);
	assert.deepEqual(h.registry.list(), []);
});

test("CA-4: con background la tool devuelve antes del close y al terminar inyecta subagent-result como followUp con triggerTurn", async () => {
	const h = harness();
	const result = await h.execute("call-1", { agent: "implementer", task: "/skill:sdd-run #44 --assume", background: true }, undefined, undefined, h.ctx);
	assert.equal(h.calls.length, 1, "spawn ya ocurrio");
	assert.equal(h.calls[0]!.child.exitCode, null, "el hijo sigue vivo");
	assert.equal(h.calls[0]!.args.at(-1), "/skill:sdd-run #44 --assume", "el task viaja literal, sin prefijo");
	assert.equal(text(result), "Job sa-1 lanzado (implementer)");
	assert.deepEqual(result.details, { jobId: "sa-1", agent: "implementer", pid: 4242, status: "running" });
	assert.equal(h.registry.get("sa-1")?.status, "running");
	assert.deepEqual(h.sent, [], "todavia no hay resultado que inyectar");

	const child = h.calls[0]!.child;
	child.assistant("Voy a crear el PR.");
	child.emitEvent({ type: "tool_result_end", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "ok" }] } });
	child.assistant("Run completo: PR #99 https://github.com/x/y/pull/99");
	child.close(0);
	await until(() => h.sent.length === 1, "subagent-result inyectado");
	const { message, options } = h.sent[0]!;
	assert.deepEqual(options, { deliverAs: "followUp", triggerTurn: true });
	assert.equal(message.customType, "subagent-result");
	assert.equal(message.display, true);
	assert.deepEqual(message.details, {
		jobId: "sa-1",
		agent: "implementer",
		status: "completed",
		usage: { input: 2000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.01, contextTokens: 1250, turns: 2 },
		stopReason: "end",
	});
	assert.match(message.content, /sa-1/);
	assert.match(message.content, /implementer/);
	assert.match(message.content, /completed/);
	assert.match(message.content, /2 turns/);
	assert.match(message.content, /\$0\.0100/);
	assert.match(message.content, /Run completo: PR #99/);
	assert.equal(h.registry.get("sa-1")?.status, "completed");
});

test("CA-4: un hijo que falla inyecta status failed (<stopReason>) con su diagnostico; los ids crecen por sesion", async () => {
	const h = harness();
	await h.execute("call-1", { agent: "implementer", task: "a", background: true }, undefined, undefined, h.ctx);
	const second = await h.execute("call-2", { agent: "reviewer", task: "b", background: true }, undefined, undefined, h.ctx);
	assert.equal(text(second), "Job sa-2 lanzado (reviewer)");
	const failing = h.calls[1]!.child;
	failing.assistant("", { stopReason: "error", errorMessage: "provider exploto" });
	failing.close(1);
	await until(() => h.sent.length === 1, "resultado del que fallo");
	assert.equal(h.sent[0]!.message.details.jobId, "sa-2");
	assert.equal(h.sent[0]!.message.details.status, "failed");
	assert.equal(h.sent[0]!.message.details.stopReason, "error");
	assert.match(h.sent[0]!.message.content, /failed \(error\)/);
	assert.match(h.sent[0]!.message.content, /provider exploto/);
	assert.equal(h.registry.get("sa-2")?.status, "failed");
	assert.equal(h.registry.get("sa-1")?.status, "running");
	h.calls[0]!.child.close(0);
	await until(() => h.sent.length === 2, "resultado del primero");
	assert.equal(h.sent[1]!.message.details.jobId, "sa-1");
});

// PR #48 review (comment 4076517097, hallazgo confirmado): con --mode json,
// Pi sale con exit code 0 aunque la respuesta se haya truncado por el limite
// de tokens (stopReason "length"). Sin tratar "length" como fallo, este job
// background quedaria "completed" con salida truncada.
test("CA-4: un hijo background con exit 0 pero stopReason \"length\" queda failed (length), no completed", async () => {
	const h = harness();
	await h.execute("call-1", { agent: "implementer", task: "a", background: true }, undefined, undefined, h.ctx);
	const child = h.calls[0]!.child;
	child.assistant("resultado a medio terminar", { stopReason: "length" });
	child.close(0);
	await until(() => h.sent.length === 1, "resultado truncado");
	assert.equal(h.sent[0]!.message.details.status, "failed");
	assert.equal(h.sent[0]!.message.details.stopReason, "length");
	assert.match(h.sent[0]!.message.content, /failed \(length\)/);
	assert.equal(h.registry.get("sa-1")?.status, "failed");
});

test("CA-4: un job abortado (kill de CA-5) no emite subagent-result y queda aborted", async () => {
	const h = harness();
	await h.execute("call-1", { agent: "implementer", task: "a", background: true }, undefined, undefined, h.ctx);
	const aborted = abortRunningJobs(h.registry, h.deps.runner);
	assert.deepEqual(aborted.map((job) => job.id), ["sa-1"]);
	assert.deepEqual(h.calls[0]!.child.signals, ["SIGTERM"]);
	h.calls[0]!.child.close(143);
	for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done));
	assert.deepEqual(h.sent, []);
	assert.equal(h.registry.get("sa-1")?.status, "aborted");
});

test("CA-4: la salida final del hijo se capa a 50 KB con marca de truncado", async () => {
	const h = harness();
	await h.execute("call-1", { agent: "implementer", task: "a", background: true }, undefined, undefined, h.ctx);
	const child = h.calls[0]!.child;
	child.assistant("x".repeat(PER_TASK_OUTPUT_CAP + 5000));
	child.close(0);
	await until(() => h.sent.length === 1, "resultado grande");
	const content = h.sent[0]!.message.content as string;
	assert.match(content, /\[Output truncated: 5000 bytes omitted/);
	assert.ok(Buffer.byteLength(content, "utf8") < PER_TASK_OUTPUT_CAP + 400, "cabecera + salida capada");
});

test("CA-1: exactamente un modo por llamada; cero o dos modos devuelven el error con la lista de agentes; background solo en single", async () => {
	const h = harness();
	const none = await h.execute("c", {}, undefined, undefined, h.ctx);
	assert.match(text(none), /Invalid parameters\. Provide exactly one mode\./);
	assert.match(text(none), /Available agents: implementer \(package\), pinned \(package\), reviewer \(package\)/);
	const two = await h.execute("c", { agent: "implementer", task: "t", tasks: [{ agent: "reviewer", task: "u" }] }, undefined, undefined, h.ctx);
	assert.match(text(two), /Provide exactly one mode/);
	const backgroundParallel = await h.execute("c", { tasks: [{ agent: "reviewer", task: "u" }], background: true }, undefined, undefined, h.ctx);
	assert.equal(backgroundParallel.isError, true);
	assert.match(text(backgroundParallel), /background[\s\S]*single/i);
	const unknown = await h.execute("c", { agent: "nadie", task: "t" }, undefined, undefined, h.ctx);
	assert.equal(unknown.isError, true);
	assert.match(text(unknown), /Unknown agent: "nadie"/);
	const unknownBackground = await h.execute("c", { agent: "nadie", task: "t", background: true }, undefined, undefined, h.ctx);
	assert.equal(unknownBackground.isError, true);
	assert.match(text(unknownBackground), /Unknown agent: "nadie"/);
	assert.equal(h.calls.length, 0, "ningun modo invalido lanza procesos");
	assert.deepEqual(h.registry.list(), []);
});

test("CA-2: un agente project en repo no confiable exige ctx.ui.confirm salvo confirmProjectAgents=false; package y user nunca", async () => {
	const confirmations: string[] = [];
	const h = harness({
		trusted: false,
		confirm: async (title: string) => {
			confirmations.push(title);
			return false;
		},
	});
	const declined = await h.execute("c", { agent: "local", task: "t", agentScope: "all" }, undefined, undefined, h.ctx);
	assert.deepEqual(confirmations, ["Run project-local agents?"]);
	assert.match(text(declined), /Canceled: project-local agents not approved\./);
	assert.equal(h.calls.length, 0);

	const pending = h.execute("c", { agent: "implementer", task: "t", agentScope: "all" }, undefined, undefined, h.ctx);
	await until(() => h.calls.length === 1, "package agent sin confirm");
	assert.equal(confirmations.length, 1, "el agente package no pregunta");
	h.calls[0]!.child.assistant("ok");
	h.calls[0]!.child.close(0);
	await pending;

	const skipped = h.execute("c", { agent: "local", task: "t", agentScope: "project", confirmProjectAgents: false }, undefined, undefined, h.ctx);
	await until(() => h.calls.length === 2, "project agent sin confirm");
	assert.equal(confirmations.length, 1, "confirmProjectAgents=false no pregunta");
	h.calls[1]!.child.assistant("ok");
	h.calls[1]!.child.close(0);
	await skipped;
});

test("CA-1: parallel corre las tareas concurrentes con tope de 8 y chain reemplaza {previous}", async () => {
	const h = harness();
	const tooMany = await h.execute(
		"c",
		{ tasks: Array.from({ length: 9 }, () => ({ agent: "implementer", task: "t" })) },
		undefined,
		undefined,
		h.ctx,
	);
	assert.match(text(tooMany), /Too many parallel tasks \(9\)\. Max is 8\./);
	assert.equal(h.calls.length, 0);

	const parallel = h.execute("c", { tasks: [{ agent: "implementer", task: "uno" }, { agent: "reviewer", task: "dos" }] }, undefined, undefined, h.ctx);
	await until(() => h.calls.length === 2, "dos spawns concurrentes");
	// Los dos workers escriben su prompt temporal en paralelo: el orden de los
	// spawns no esta garantizado, asi que cada hijo se ubica por su task.
	assert.deepEqual([...h.calls.map((call) => call.args.at(-1))].sort(), ["dos", "uno"], "ambas tareas lanzadas antes de que termine ninguna");
	const uno = h.calls.find((call) => call.args.at(-1) === "uno")!;
	const dos = h.calls.find((call) => call.args.at(-1) === "dos")!;
	uno.child.assistant("salida uno");
	uno.child.close(0);
	dos.child.assistant("salida dos");
	dos.child.close(0);
	const parallelResult = await parallel;
	assert.match(text(parallelResult), /Parallel: 2\/2 succeeded/);
	assert.match(text(parallelResult), /\[implementer\] completed[\s\S]*salida uno/);
	assert.match(text(parallelResult), /\[reviewer\] completed[\s\S]*salida dos/);
	assert.deepEqual(h.registry.list().map((job) => job.status), ["completed", "completed"]);

	const chain = h.execute(
		"c",
		{ chain: [{ agent: "implementer", task: "primero" }, { agent: "reviewer", task: "Sigue con: {previous}" }] },
		undefined,
		undefined,
		h.ctx,
	);
	await until(() => h.calls.length === 3, "paso 1 de la cadena");
	h.calls[2]!.child.assistant("resultado del paso 1");
	h.calls[2]!.child.close(0);
	await until(() => h.calls.length === 4, "paso 2 de la cadena");
	assert.equal(h.calls[3]!.args.at(-1), "Sigue con: resultado del paso 1");
	h.calls[3]!.child.assistant("resultado final");
	h.calls[3]!.child.close(0);
	assert.equal(text(await chain), "resultado final");
});

// PR #48 review (comment 4076517097, hallazgo confirmado): un paso de la
// cadena que termina con exit 0 pero stopReason "length" (salida truncada
// por el limite de tokens) no puede tratarse como exito: la cadena seguiria
// usando esa salida truncada como {previous} del paso siguiente.
test("CA-1: un paso de la cadena con exit 0 pero stopReason \"length\" corta la cadena en vez de seguir con salida truncada", async () => {
	const h = harness();
	const chain = h.execute(
		"c",
		{ chain: [{ agent: "implementer", task: "primero" }, { agent: "reviewer", task: "Sigue con: {previous}" }] },
		undefined,
		undefined,
		h.ctx,
	);
	await until(() => h.calls.length === 1, "paso 1 de la cadena");
	h.calls[0]!.child.assistant("a medio terminar", { stopReason: "length" });
	h.calls[0]!.child.close(0);

	// En el estado buggy (stopReason "length" no cuenta como fallo) la cadena
	// sigue al paso 2 usando la salida truncada como {previous}; alimentamos
	// ese hijo tambien para no colgar el test en ningun escenario.
	const continuedToStep2 = await settles(() => h.calls.length === 2);
	if (continuedToStep2) {
		h.calls[1]!.child.assistant("siguio de largo con salida truncada");
		h.calls[1]!.child.close(0);
	}
	const result = await chain;
	assert.equal(continuedToStep2, false, "no debe usar salida truncada (stopReason length) como {previous}");
	assert.match(text(result), /Chain stopped at step 1 \(implementer\)/);
	assert.equal(result.isError, true);
	assert.equal(h.calls.length, 1, "no debe lanzar el paso 2 con salida truncada como {previous}");
});

test("CA-5: crear la tool no lanza procesos ni timers; solo la tool y el comando los crean", () => {
	const h = harness();
	assert.equal(h.calls.length, 0);
	assert.equal(h.timers.length, 0);
	assert.deepEqual(h.registry.list(), []);
});
