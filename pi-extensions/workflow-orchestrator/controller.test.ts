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
	assert.ok(events.includes("before_agent_start"));
	assert.ok(events.includes("resources_discover"));
});

test("launch_sdd_run is active only while the current project has a canonical SDD contract", async () => {
	const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
	let activeTools = ["read", "launch_sdd_run"];
	let sddAware = false;
	let awarenessChecks = 0;
	const pi = {
		events: createEventBus(),
		registerTool() {},
		registerCommand() {},
		on(name: string, handler: (event: unknown, context: unknown) => unknown) { handlers.set(name, handler); },
		getActiveTools: () => [...activeTools],
		setActiveTools(names: string[]) { activeTools = [...names]; },
		getCommands: () => [],
		sendUserMessage() {},
	};
	orchestrator.createWorkflowController(pi as never, {
		isSddProject: async () => {
			awarenessChecks += 1;
			return sddAware;
		},
	} as never);
	const context = { cwd: "/workspace/project", sessionManager: { getSessionId: () => "origin" } };
	await handlers.get("resources_discover")!({}, context);
	assert.deepEqual(activeTools, ["read"]);

	sddAware = true;
	await handlers.get("resources_discover")!({}, context);
	assert.deepEqual(activeTools, ["read", "launch_sdd_run"], "a resource reload re-enables only the gated tool");
	const checksBeforeSettle = handlers.has("agent_settled");
	await handlers.get("agent_settled")!({}, context);
	assert.equal(checksBeforeSettle, true);
	assert.equal(awarenessChecks, 2, "settling a turn does not spawn Git or reread the contract");
	assert.deepEqual(activeTools, ["read", "launch_sdd_run"]);
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
	let now = 1_000;
	const controller = orchestrator.createWorkflowController(pi as never, {
		readSkillFile: async () => "---\nname: issue-triage\ndescription: Triage\n---\n# Issue triage\n",
		stripSkillFrontmatter: fakeStripFrontmatter,
		now: () => now,
		triageAttemptTtlMs: 60_000,
	});

	const originContext = { cwd: "/workspace/skills", sessionManager: { getSessionId: () => "origin-session" } };
	const result = await controller.beginIssueTriage(
		{ issueNumbers: [12, 13] },
		originContext as never,
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
	await eventHandlers.get("agent_settled")!({}, originContext);
	assert.deepEqual(
		activeTools,
		["read", "foreign_tool", "submit_workflow_resolution"],
		"a settled user turn does not destroy a multi-turn triage attempt",
	);
	now += 60_001;
	await eventHandlers.get("before_agent_start")!({}, originContext);
	assert.deepEqual(activeTools, ["read", "foreign_tool"], "an abandoned attempt expires before a later turn");
});

test("terminal resolution is one-shot and hands an opaque same-session receipt to the internal command", async () => {
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
	const commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> }>();
	let activeTools = ["read"];
	const sent: Array<{ content: string; options?: { deliverAs?: string } }> = [];
	const notifications: string[] = [];
	const starts: unknown[] = [];
	let settledBeforeDispatch = false;
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
			assert.equal(settledBeforeDispatch, true, "the internal command waits for the terminal tool turn");
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
		options: { deliverAs: "followUp", expandPromptTemplates: true },
	});

	await assert.rejects(
		terminal.execute("call-2", workflowResolution(), undefined, undefined, originContext),
		/not active|already consumed/i,
	);

	const internal = commands.get("__sdd-dispatch");
	assert.ok(internal);
	const commandContext = {
		...originContext,
		async waitForIdle() { settledBeforeDispatch = true; },
		ui: { notify(message: string) { notifications.push(message); } },
	};
	await internal.handler("opaque-receipt", commandContext);
	assert.equal(starts.length, 1);
	assert.deepEqual(starts[0], {
		resolution: workflowResolution(),
		skill: { name: "quick-run", args: "" },
	});

	await internal.handler("opaque-receipt", commandContext);
	assert.equal(starts.length, 1, "a consumed receipt cannot be replayed");
	assert.match(notifications.at(-1) ?? "", /invalid|expired|consumed/i);
});

test("invalid terminal payloads do not burn the attempt and a corrected result can still dispatch once", async () => {
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
	let activeTools = ["read"];
	const sent: string[] = [];
	const pi = {
		events: createEventBus(),
		registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) { tools.set(tool.name, tool); },
		registerCommand() {},
		on() {},
		getCommands: () => [{ name: "skill:issue-triage", source: "skill", sourceInfo: { path: "/skills/triage/SKILL.md" } }],
		getActiveTools: () => [...activeTools],
		setActiveTools(names: string[]) { activeTools = [...names]; },
		sendUserMessage(content: string) { sent.push(content); },
	};
	const controller = orchestrator.createWorkflowController(pi as never, {
		readSkillFile: async () => "---\nname: issue-triage\ndescription: Triage\n---\n# Triage\n",
		stripSkillFrontmatter: fakeStripFrontmatter,
		createReceipt: () => "corrected-receipt",
	});
	const context = { cwd: "/workspace/skills", sessionManager: { getSessionId: () => "origin" } };
	await controller.beginIssueTriage({ issueNumbers: [14] }, context as never);
	const terminal = tools.get("submit_workflow_resolution")!;

	await assert.rejects(terminal.execute("invalid-schema", {}, undefined, undefined, context), /invalid.*resolution/i);
	assert.ok(activeTools.includes("submit_workflow_resolution"));
	await assert.rejects(
		terminal.execute("invalid-dispatch", workflowResolution({
			code: "resume-grill",
			recommendedRoute: "resume-grill",
			selectedRoute: "resume-grill",
			stage: "grill",
			mode: "resume",
		}), undefined, undefined, context),
		/invalid-grill-reference/i,
	);
	assert.ok(activeTools.includes("submit_workflow_resolution"));

	await terminal.execute("corrected", workflowResolution(), undefined, undefined, context);
	assert.deepEqual(activeTools, ["read"]);
	assert.equal(sent.filter((message) => message === "/__sdd-dispatch corrected-receipt").length, 1);
	await assert.rejects(terminal.execute("duplicate", workflowResolution(), undefined, undefined, context), /consumed|not active/i);
});

test("beginIssueTriage reserves its attempt before asynchronous materialization", async () => {
	let releaseFirstRead!: () => void;
	const firstRead = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
	let reads = 0;
	let activeTools = ["read"];
	const sent: string[] = [];
	const pi = {
		events: createEventBus(),
		registerTool() {},
		registerCommand() {},
		on() {},
		getCommands: () => [{ name: "skill:issue-triage", source: "skill", sourceInfo: { path: "/skills/triage/SKILL.md" } }],
		getActiveTools: () => [...activeTools],
		setActiveTools(names: string[]) { activeTools = [...names]; },
		sendUserMessage(content: string) { sent.push(content); },
	};
	const controller = orchestrator.createWorkflowController(pi as never, {
		readSkillFile: async () => {
			reads += 1;
			if (reads === 1) await firstRead;
			return "---\nname: issue-triage\ndescription: Triage\n---\n# Triage\n";
		},
		stripSkillFrontmatter: fakeStripFrontmatter,
	});
	const context = { cwd: "/workspace/skills", sessionManager: { getSessionId: () => "origin" } };
	const first = controller.beginIssueTriage({ issueNumbers: [14] }, context as never);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const second = await controller.beginIssueTriage({ issueNumbers: [15] }, context as never);
	assert.deepEqual(second, {
		ok: false,
		code: "triage-already-active",
		message: "An issue triage attempt is already active",
	});
	releaseFirstRead();
	assert.equal((await first).ok, true);
	assert.equal(reads, 1);
	assert.equal(sent.length, 1);
	assert.match(sent[0]!, /#14$/);
});

test("pending receipts expire and stay bounded when queued follow-ups are abandoned", async () => {
	const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
	const commands = new Map<string, { handler: (args: string, context: unknown) => Promise<void> }>();
	const sent: string[] = [];
	const notifications: string[] = [];
	const starts: unknown[] = [];
	const ids = ["receipt-1", "receipt-2", "receipt-3"];
	let now = 1_000;
	const pi = {
		events: createEventBus(),
		registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: { handler: (args: string, context: unknown) => Promise<void> }) { commands.set(name, command); },
		on() {},
		getCommands: () => [],
		getActiveTools: () => ["launch_sdd_run"],
		setActiveTools() {},
		sendUserMessage(content: string) { sent.push(content); },
	};
	orchestrator.createWorkflowController(pi as never, {
		createReceipt: () => ids.shift()!,
		now: () => now,
		receiptTtlMs: 50,
		maxPendingReceipts: 2,
		resolveDirectRunRequest: async () => ({ ok: true, request: directRunRequest() }),
		startDirectRun: async (request: unknown) => { starts.push(request); return { ok: true } as never; },
	} as never);
	const toolContext = {
		hasUI: true,
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin" },
		ui: { async confirm() { return true; } },
	};
	for (let index = 0; index < 3; index += 1) {
		await tools.get("launch_sdd_run")!.execute(`launch-${index}`, { target: "#14" }, undefined, undefined, toolContext);
	}
	assert.equal(sent.length, 3);
	const commandContext = {
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin" },
		async waitForIdle() {},
		ui: { notify(message: string) { notifications.push(message); } },
	};
	await commands.get("__sdd-dispatch")!.handler("receipt-1", commandContext);
	assert.equal(starts.length, 0, "the oldest receipt is evicted at the configured bound");
	now += 51;
	await commands.get("__sdd-dispatch")!.handler("receipt-3", commandContext);
	assert.equal(starts.length, 0, "an expired receipt cannot launch");
	assert.equal(notifications.length, 2);
});

test("stop, error, and unconfirmed terminal results preserve the origin and queue no dispatch", async () => {
	const cases = [
		workflowResolution({ outcome: "stop", code: "cancelled", selectedRoute: null, stage: null, mode: null }),
		workflowResolution({
			outcome: "error",
			code: "canonicalization",
			recommendedRoute: null,
			selectedRoute: null,
			stage: null,
			mode: null,
		}),
		workflowResolution({ selectedRoute: null }),
	];
	for (const handoff of cases) {
		const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
		let activeTools = ["read"];
		const sent: string[] = [];
		let starts = 0;
		const pi = {
			events: createEventBus(),
			registerTool(tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) { tools.set(tool.name, tool); },
			registerCommand() {},
			on() {},
			getCommands: () => [{ name: "skill:issue-triage", source: "skill", sourceInfo: { path: "/skills/triage/SKILL.md" } }],
			getActiveTools: () => [...activeTools],
			setActiveTools(names: string[]) { activeTools = [...names]; },
			sendUserMessage(content: string) { sent.push(content); },
		};
		const controller = orchestrator.createWorkflowController(pi as never, {
			readSkillFile: async () => "---\nname: issue-triage\ndescription: Triage\n---\n# Triage\n",
			stripSkillFrontmatter: fakeStripFrontmatter,
			startFreshStage: async () => { starts += 1; return { ok: true } as never; },
		});
		const context = { cwd: "/workspace/skills", sessionManager: { getSessionId: () => "origin" } };
		await controller.beginIssueTriage({ issueNumbers: [14] }, context as never);
		const result = await tools.get("submit_workflow_resolution")!.execute(
			"terminal",
			handoff,
			undefined,
			undefined,
			context,
		) as { terminate?: boolean };
		assert.equal(result.terminate, true);
		assert.equal(starts, 0);
		assert.equal(sent.length, 1, "only the materialized triage kickoff was sent");
		assert.deepEqual(activeTools, ["read"]);
	}
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
		options: { deliverAs: "followUp", expandPromptTemplates: true },
	}]);
	assert.deepEqual(starts, [], "tools cannot mutate sessions directly");

	const commandContext = {
		cwd: "/workspace/skills",
		sessionManager: { getSessionId: () => "origin-session" },
		async waitForIdle() {},
		ui: { notify() {} },
	};
	await commands.get("__sdd-dispatch")!.handler("direct-receipt", commandContext);
	assert.deepEqual(starts, [directRunRequest()]);
});
