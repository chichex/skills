import assert from "node:assert/strict";
import { test } from "node:test";

import * as orchestrator from "./index.ts";

function fakeStripFrontmatter(content: string): string {
	const end = content.indexOf("\n---", 3);
	return end === -1 ? content : content.slice(end + 4).trim();
}

function createEventBus() {
	const handlers = new Map<string, Array<(data: unknown) => void>>();
	return {
		on(channel: string, handler: (data: unknown) => void) {
			handlers.set(channel, [...(handlers.get(channel) ?? []), handler]);
			return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((item) => item !== handler));
		},
		emit(channel: string, data: unknown) {
			for (const handler of handlers.get(channel) ?? []) handler(data);
		},
	};
}

function directRunRequest() {
	return {
		version: 1,
		kind: "sdd-run",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		target: {
			type: "issue",
			canonicalReference: "chichex/skills#14",
			issue: { repository: "chichex/skills", number: 14 },
		},
		summary: "Run issue #14.",
		evidence: [{ kind: "issue", reference: "chichex/skills#14", detail: "Explicit target" }],
	};
}

function workflowResolution(overrides: Record<string, unknown> = {}) {
	const issue = { repository: "chichex/skills", number: 14 };
	return {
		version: 1,
		outcome: "start",
		code: "quick-run",
		recommendedClassification: "quick-run",
		fallbackClassification: "spec",
		recommendedRoute: "quick-run",
		selectedRoute: "quick-run",
		stage: "quick-run",
		mode: "new",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		sources: [issue],
		canonicalIssue: issue,
		summary: "Integrate SDD transitions.",
		impactExample: "A confirmed route starts in a clean child.",
		scope: ["orchestrator"],
		checklist: ["one-shot"],
		evidence: [],
		risks: [],
		artifacts: [],
		...overrides,
	};
}

test("workflow orchestrator exposes a controller without globally activating the terminal tool", () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).createWorkflowController, "function");

	const tools: unknown[] = [];
	const commands: string[] = [];
	const events: string[] = [];
	orchestrator.default({
		events: createEventBus(),
		registerTool(tool: unknown) {
			tools.push(tool);
		},
		registerCommand(name: string) {
			commands.push(name);
		},
		on(name: string) {
			events.push(name);
		},
	} as never);

	assert.deepEqual(
		(tools as Array<{ name?: string }>).map((tool) => tool.name),
		["launch_sdd_run"],
		"only the explicitly confirmed direct-run tool is global; terminal triage remains lazy",
	);
	assert.deepEqual(commands, ["__sdd-dispatch", "sdd-run"]);
	assert.ok(events.includes("agent_settled"));
});

test("beginIssueTriage materializes canonical issue-triage and activates the terminal tool only for that attempt", async () => {
	const tools = new Map<string, { name: string }>();
	const commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> }>();
	const eventHandlers = new Map<string, (event: unknown, context: unknown) => unknown>();
	let activeTools = ["read", "foreign_tool"];
	const sent: Array<{ content: string; options?: unknown }> = [];
	const skillPath = "/canonical/issue-triage/SKILL.md";
	const pi = {
		events: createEventBus(),
		registerTool(tool: { name: string }) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: { handler: (args: string, context: unknown) => Promise<void> }) {
			commands.set(name, command);
		},
		on(name: string, handler: (event: unknown, context: unknown) => unknown) {
			eventHandlers.set(name, handler);
		},
		getCommands() {
			return [{ name: "skill:issue-triage", source: "skill", sourceInfo: { path: skillPath } }];
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
		sendUserMessage(content: string, options?: unknown) {
			sent.push({ content, options });
		},
	};
	const controller = orchestrator.createWorkflowController(pi as never, {
		readSkillFile: async () => "---\nname: issue-triage\ndescription: Triage\n---\n# Issue triage\n",
		stripSkillFrontmatter: fakeStripFrontmatter,
	});

	const result = await controller.beginIssueTriage(
		{ issueNumbers: [12, 13] },
		{ cwd: "/workspace/skills", sessionManager: { getSessionId: () => "origin-session" } } as never,
	);

	assert.deepEqual(result, { ok: true, code: "queued" });
	assert.ok(tools.has("submit_workflow_resolution"));
	assert.deepEqual(activeTools, ["read", "foreign_tool", "submit_workflow_resolution"]);
	assert.equal(sent.length, 1);
	assert.match(sent[0]!.content, new RegExp(`<skill name="issue-triage" location="${skillPath}">`));
	assert.match(sent[0]!.content, /# Issue triage\n<\/skill>\n\n#12 #13$/);
	assert.doesNotMatch(sent[0]!.content, /\/skill:issue-triage/);
	assert.equal(commands.has("__sdd-dispatch"), true);
	assert.equal(eventHandlers.has("agent_settled"), true);
});

test("terminal resolution is one-shot and hands an opaque same-session receipt to the internal command", async () => {
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
	const commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> }>();
	let activeTools = ["read"];
	const sent: Array<{ content: string; options?: { deliverAs?: string } }> = [];
	const notifications: string[] = [];
	const starts: unknown[] = [];
	const pi = {
		events: createEventBus(),
		registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: { handler: (args: string, context: unknown) => Promise<void> }) {
			commands.set(name, command);
		},
		on() {},
		getCommands() {
			return [{
				name: "skill:issue-triage",
				source: "skill",
				sourceInfo: { path: "/canonical/issue-triage/SKILL.md" },
			}];
		},
		getActiveTools: () => [...activeTools],
		setActiveTools(names: string[]) {
			activeTools = [...names];
		},
		sendUserMessage(content: string, options?: { deliverAs?: string }) {
			sent.push({ content, options });
		},
	};
	const controller = orchestrator.createWorkflowController(pi as never, {
		readSkillFile: async () => "---\nname: issue-triage\ndescription: Triage\n---\n# Triage\n",
		stripSkillFrontmatter: fakeStripFrontmatter,
		createReceipt: () => "opaque-receipt",
		startFreshStage: async (request: unknown) => {
			starts.push(request);
			return { ok: true } as never;
		},
	});
	const originContext = {
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin-session" },
	};
	assert.equal((await controller.beginIssueTriage({ issueNumbers: [14] }, originContext as never)).ok, true);

	const terminal = tools.get("submit_workflow_resolution");
	assert.ok(terminal);
	const terminalResult = await terminal.execute(
		"call-1",
		workflowResolution(),
		undefined,
		undefined,
		originContext,
	) as { terminate?: boolean };
	assert.equal(terminalResult.terminate, true);
	assert.deepEqual(activeTools, ["read"]);
	assert.equal(sent.length, 2);
	assert.deepEqual(sent[1], {
		content: "/__sdd-dispatch opaque-receipt",
		options: { deliverAs: "followUp" },
	});

	await assert.rejects(
		terminal.execute("call-2", workflowResolution(), undefined, undefined, originContext),
		/not active|already consumed/i,
	);

	const internal = commands.get("__sdd-dispatch");
	assert.ok(internal);
	const commandContext = {
		...originContext,
		ui: { notify(message: string) { notifications.push(message); } },
	};
	await internal.handler("opaque-receipt", commandContext);
	assert.equal(starts.length, 1);
	assert.deepEqual(starts[0], {
		resolution: workflowResolution(),
		skill: { name: "quick-run", args: JSON.stringify(workflowResolution()) },
	});

	await internal.handler("opaque-receipt", commandContext);
	assert.equal(starts.length, 1, "a consumed receipt cannot be replayed");
	assert.match(notifications.at(-1) ?? "", /invalid|expired|consumed/i);
});

test("a consumer extension requests triage through the shared event bus without owning controller state", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).requestIssueTriage, "function");
	const events = createEventBus();
	let activeTools = ["read"];
	const sent: string[] = [];
	const controllerPi = {
		events,
		registerTool() {},
		registerCommand() {},
		on() {},
		getCommands() {
			return [{
				name: "skill:issue-triage",
				source: "skill",
				sourceInfo: { path: "/canonical/issue-triage/SKILL.md" },
			}];
		},
		getActiveTools: () => [...activeTools],
		setActiveTools(names: string[]) { activeTools = [...names]; },
		sendUserMessage(content: string) { sent.push(content); },
	};
	orchestrator.createWorkflowController(controllerPi as never, {
		readSkillFile: async () => "---\nname: issue-triage\ndescription: Triage\n---\n# Triage\n",
		stripSkillFrontmatter: fakeStripFrontmatter,
	});
	const consumerPi = { events };
	const context = {
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin-session" },
	};

	const result = await orchestrator.requestIssueTriage(
		consumerPi as never,
		{ issueNumbers: [14] },
		context as never,
	);

	assert.deepEqual(result, { ok: true, code: "queued" });
	assert.equal(sent.length, 1);
	assert.match(sent[0]!, /#14$/);
});

test("/sdd-run validates its target and calls the shared direct launcher from a fresh command context", async () => {
	const commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> }>();
	const resolved: Array<{ target: string; cwd: string }> = [];
	const starts: unknown[] = [];
	const notifications: string[] = [];
	const pi = {
		events: createEventBus(),
		registerTool() {},
		registerCommand(name: string, command: { handler: (args: string, context: unknown) => Promise<void> }) {
			commands.set(name, command);
		},
		on() {},
		getCommands: () => [],
		getActiveTools: () => ["read"],
		setActiveTools() {},
		sendUserMessage() {},
	};
	orchestrator.createWorkflowController(pi as never, {
		resolveDirectRunRequest: async (target: string, cwd: string) => {
			resolved.push({ target, cwd });
			return { ok: true, request: directRunRequest() };
		},
		startDirectRun: async (request: unknown) => {
			starts.push(request);
			return { ok: true, code: "started" } as never;
		},
	} as never);
	let waited = 0;
	const context = {
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin-session" },
		async waitForIdle() { waited += 1; },
		ui: { notify(message: string) { notifications.push(message); } },
	};

	await commands.get("sdd-run")!.handler("  #14  ", context);
	assert.equal(waited, 1);
	assert.deepEqual(resolved, [{ target: "#14", cwd: "/workspace/skills" }]);
	assert.deepEqual(starts, [directRunRequest()]);
	assert.deepEqual(notifications, []);
});

test("/specs-style consumers call the same direct launcher through the shared event bus", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).requestSddRun, "function");
	const events = createEventBus();
	const starts: unknown[] = [];
	const controllerPi = {
		events,
		registerTool() {},
		registerCommand() {},
		on() {},
		getCommands: () => [],
		getActiveTools: () => ["read"],
		setActiveTools() {},
		sendUserMessage() {},
	};
	orchestrator.createWorkflowController(controllerPi as never, {
		resolveDirectRunRequest: async () => ({ ok: true, request: directRunRequest() }),
		startDirectRun: async (request: unknown) => {
			starts.push(request);
			return { ok: true, code: "started" } as never;
		},
	} as never);
	const context = { cwd: "/origin/project", sessionManager: { getSessionId: () => "origin" } };

	const result = await orchestrator.requestSddRun(
		{ events } as never,
		"/target/project/.sdd/specs/selected.md",
		context as never,
	);
	assert.equal(result.ok, true);
	assert.deepEqual(starts, [directRunRequest()]);
});

test("launch_sdd_run asks explicit authorization and bridges its direct request through a one-shot receipt", async () => {
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
	const commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> }>();
	const sent: Array<{ content: string; options?: unknown }> = [];
	const starts: unknown[] = [];
	const pi = {
		events: createEventBus(),
		registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: { handler: (args: string, context: unknown) => Promise<void> }) {
			commands.set(name, command);
		},
		on() {},
		getCommands: () => [],
		getActiveTools: () => ["read", "launch_sdd_run"],
		setActiveTools() {},
		sendUserMessage(content: string, options?: unknown) { sent.push({ content, options }); },
	};
	orchestrator.createWorkflowController(pi as never, {
		createReceipt: () => "direct-receipt",
		resolveDirectRunRequest: async () => ({ ok: true, request: directRunRequest() }),
		startDirectRun: async (request: unknown) => {
			starts.push(request);
			return { ok: true, code: "started" } as never;
		},
	} as never);
	let confirmations = 0;
	const toolContext = {
		hasUI: true,
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin-session" },
		ui: {
			async confirm(title: string) {
				confirmations += 1;
				assert.equal(title, "Ejecutar ahora");
				return true;
			},
		},
	};

	const result = await tools.get("launch_sdd_run")!.execute(
		"launch-1",
		{ target: "#14" },
		undefined,
		undefined,
		toolContext,
	) as { terminate?: boolean; details?: { authorized?: boolean } };
	assert.equal(confirmations, 1);
	assert.equal(result.terminate, true);
	assert.equal(result.details?.authorized, true);
	assert.deepEqual(sent, [{
		content: "/__sdd-dispatch direct-receipt",
		options: { deliverAs: "followUp" },
	}]);
	assert.deepEqual(starts, [], "tools cannot mutate sessions directly");

	const commandContext = {
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin-session" },
		ui: { notify() {} },
	};
	await commands.get("__sdd-dispatch")!.handler("direct-receipt", commandContext);
	assert.deepEqual(starts, [directRunRequest()]);
});
