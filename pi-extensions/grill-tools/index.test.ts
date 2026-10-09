import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	accessSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

import { handoffFileNames } from "./logic.ts";
import { snapshotStorageStem } from "./runtime-import.ts";

interface RegisteredTool {
	name: string;
	execute: (...args: any[]) => Promise<any>;
}

interface RegisteredCommand {
	handler: (...args: any[]) => Promise<void>;
}

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
let sandbox = "";
let previousHome: string | undefined;
let tools = new Map<string, RegisteredTool>();
let commands = new Map<string, RegisteredCommand>();
let grillEvents: any[] = [];
let sentMessages: Array<{ content: string; options?: unknown }> = [];
let appendedEntries: Array<{ type: string; data: unknown }> = [];
let availableSkills = new Set(["grill", "sdd-spec"]);
let failMessageQueue = false;
let skillPaths = new Map<string, string>();
let execHandler = async (..._args: any[]) => ({ code: 0, stdout: "", stderr: "" });

before(async () => {
	if (!PI_PACKAGE_ROOT) return;
	sandbox = mkdtempSync(join(tmpdir(), "grill-tools-test-"));
	cpSync(new URL("..", import.meta.url), join(sandbox, "pi-extensions"), { recursive: true });

	const scopedRoot = join(sandbox, "node_modules", "@earendil-works");
	mkdirSync(scopedRoot, { recursive: true });
	for (const packageName of ["pi-ai", "pi-tui"]) {
		symlinkSync(
			join(PI_PACKAGE_ROOT, "node_modules", "@earendil-works", packageName),
			join(scopedRoot, packageName),
			"dir",
		);
	}
	symlinkSync(PI_PACKAGE_ROOT, join(scopedRoot, "pi-coding-agent"), "dir");
	symlinkSync(
		join(PI_PACKAGE_ROOT, "node_modules", "typebox"),
		join(sandbox, "node_modules", "typebox"),
		"dir",
	);

	previousHome = process.env.HOME;
	process.env.HOME = join(sandbox, "home");
	mkdirSync(process.env.HOME, { recursive: true });
	for (const name of ["grill", "sdd-spec"]) {
		const path = join(sandbox, "skills", name, "SKILL.md");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `---\nname: ${name}\ndescription: Test ${name}\n---\n# ${name}\n`, "utf8");
		skillPaths.set(name, path);
	}

	const { default: register } = await import(
		`${pathToFileURL(join(sandbox, "pi-extensions", "grill-tools", "index.ts")).href}?test=${Date.now()}`
	);
	register({
		registerEntryRenderer() {},
		registerCommand(name: string, command: RegisteredCommand) {
			commands.set(name, command);
		},
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		events: {
			emit(name: string, payload: unknown) {
				if (name === "grill:interview-state") grillEvents.push(payload);
			},
		},
		getCommands() {
			return [...availableSkills].map((name) => ({
				name: `skill:${name}`,
				source: "skill",
				sourceInfo: { path: skillPaths.get(name) },
			}));
		},
		sendUserMessage(content: string, options?: unknown) {
			if (failMessageQueue) throw new Error("queue failed");
			sentMessages.push({ content, options });
		},
		appendEntry(type: string, data: unknown) {
			appendedEntries.push({ type, data });
		},
		exec: (...args: any[]) => execHandler(...args),
	} as never);
});

after(() => {
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

function canonicalHandoff(
	id: string,
	state: "paused" | "finalized",
	topic: string,
	projectPath: string,
): string {
	return [
		`# Grill — ${topic}`,
		`<!-- SDD-Tracking: version=1; type=grill; state=${state}; issue=none; grill=${encodeURIComponent(id)}; project=${encodeURIComponent(projectPath)} -->`,
		"",
		"## Hechos comprobados",
		"Confirmed source context.",
		"",
	].join("\n");
}

function storedSnapshotIds(): string[] {
	const directory = join(process.env.HOME!, ".pi", "agent", "grill-sessions");
	try {
		return readdirSync(directory)
			.filter((file) => file.endsWith(".json"))
			.flatMap((file) => {
				try {
					const parsed = JSON.parse(readFileSync(join(directory, file), "utf8"));
					return typeof parsed.id === "string" ? [parsed.id] : [];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

function removeStoredSnapshot(id: string): void {
	const directory = join(process.env.HOME!, ".pi", "agent", "grill-sessions");
	try {
		for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
			const path = join(directory, file);
			try {
				if (JSON.parse(readFileSync(path, "utf8")).id === id) rmSync(path, { force: true });
			} catch {
				// Keep unrelated corrupt fixtures.
			}
		}
	} catch {
		// The store may not exist yet.
	}
}

function rpcContext(projectPath: string, choices: string[]) {
	let index = 0;
	return {
		cwd: projectPath,
		hasUI: true,
		mode: "rpc",
		ui: {
			async select(_title: string, labels: string[]) {
				const choice = choices[index++];
				if (choice === undefined) return undefined;
				const selected = labels.find((label) => label.includes(choice));
				assert.ok(selected, `missing ${choice} in ${labels.join(" | ")}`);
				return selected;
			},
		},
	};
}

test("grill_session persists interviewMode and refuses checkpoints before it is selected", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "project");
	mkdirSync(projectPath, { recursive: true });

	const created = await tool.execute(
		"create-grill",
		{
			action: "create",
			topic: "Round persistence",
			projectPath,
			estimate: { min: 2, likely: 4, max: 6 },
		},
		undefined,
		undefined,
		{ cwd: projectPath },
	);
	assert.equal(created.details.snapshot.interviewMode, "unselected");

	await assert.rejects(
		tool.execute(
			"checkpoint-before-mode",
			{
				action: "checkpoint",
				sessionId: created.details.snapshot.id,
				interaction: { id: "q1", question: "¿Primera?", answers: ["A"] },
			},
			undefined,
			undefined,
			{ cwd: projectPath },
		),
		/configure.*interviewMode/i,
	);

	await assert.rejects(
		tool.execute(
			"configure-unselected",
			{ action: "configure", sessionId: created.details.snapshot.id, interviewMode: "unselected" },
			undefined,
			undefined,
			{ cwd: projectPath },
		),
		/configure requires interviewMode/i,
	);

	const configured = await tool.execute(
		"configure-rounds",
		{
			action: "configure",
			sessionId: created.details.snapshot.id,
			interviewMode: "rounds",
		},
		undefined,
		undefined,
		{ cwd: projectPath },
	);
	assert.equal(configured.details.snapshot.interviewMode, "rounds");
	assert.equal(configured.details.snapshot.status, "active");

	const persisted = JSON.parse(readFileSync(configured.details.jsonPath, "utf8"));
	assert.equal(persisted.interviewMode, "rounds");
	assert.ok(
		grillEvents.some((event) => event.id === persisted.id && event.interviewMode === "rounds"),
		"the questioning tool receives the persisted interview state",
	);

	const legacy = { ...persisted, id: "legacy-grill-without-interview-mode", version: 3 };
	delete legacy.interviewMode;
	const legacyPath = join(dirname(configured.details.jsonPath), `${legacy.id}.json`);
	writeFileSync(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
	const loadedLegacy = await tool.execute(
		"load-legacy-grill",
		{ action: "get", sessionId: legacy.id },
		undefined,
		undefined,
		{ cwd: projectPath },
	);
	assert.equal(loadedLegacy.details.snapshot.interviewMode, "unselected");
	assert.equal(loadedLegacy.details.snapshot.version, 5);
});

test("CA-1/4/6: /grills and select_grill_session expose the same handoff and snapshot inventory", async () => {
	const command = commands.get("grills");
	const tool = tools.get("select_grill_session");
	assert.ok(command);
	assert.ok(tool);
	const projectPath = join(sandbox, "inventory-project");
	const grillsDirectory = join(projectPath, ".sdd", "grills");
	const storeDirectory = join(process.env.HOME!, ".pi", "agent", "grill-sessions");
	mkdirSync(grillsDirectory, { recursive: true });
	mkdirSync(storeDirectory, { recursive: true });
	const handoffId = "portable-finalized";
	writeFileSync(join(grillsDirectory, "portable.md"), [
		"# Grill — Portable finalized",
		`<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=${handoffId}; project=${encodeURIComponent("/old/project")} -->`,
		"",
		"## Handoff",
		"Portable source.",
		"",
	].join("\n"));
	const timestamp = "2026-09-29T12:00:00.000Z";
	writeFileSync(join(storeDirectory, "runtime-active.json"), `${JSON.stringify({
		version: 4,
		id: "runtime-active",
		topic: "Runtime active",
		projectPath,
		projectName: "inventory-project",
		status: "active",
		interviewMode: "adaptive",
		createdAt: timestamp,
		updatedAt: timestamp,
		estimate: { min: 1, likely: 2, max: 3 },
		questionLimit: 20,
		sections: [],
		interactions: [],
		decisions: [],
		pendingBranches: [],
		revision: 1,
	}, null, 2)}\n`);

	const commandRenders: string[] = [];
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
	await command.handler("", {
		cwd: projectPath,
		mode: "tui",
		waitForIdle: async () => {},
		ui: {
			notify(message: string) {
				commandRenders.push(`NOTIFY: ${message}`);
			},
			async custom(factory: (...args: any[]) => any) {
				return new Promise((resolveDone) => {
					const component = factory({ requestRender() {} }, theme, {}, resolveDone);
					commandRenders.push(component.render(160).join("\n"));
					component.handleInput("\x1b");
				});
			},
		},
	});

	let toolLabels: string[] = [];
	const selected = await tool.execute(
		"same-inventory",
		{ status: "all", scope: "current-project" },
		undefined,
		undefined,
		{
			cwd: projectPath,
			hasUI: true,
			mode: "rpc",
			ui: {
				async select(_title: string, labels: string[]) {
					toolLabels = labels;
					return undefined;
				},
			},
		},
	);

	const commandView = commandRenders.join("\n");
	assert.match(commandView, /Portable finalized/);
	assert.match(commandView, /Runtime active/);
	assert.ok(toolLabels.some((label) => label.includes("Portable finalized")));
	assert.ok(toolLabels.some((label) => label.includes("Runtime active")));
	assert.equal(selected.details.action, "cancel");
});

test("CA-7: inspect and failed materialization never import a handoff-only snapshot", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "preflight-project");
	const handoffPath = join(projectPath, ".sdd", "grills", "preflight.md");
	const id = "preflight/unsafe id";
	mkdirSync(dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, canonicalHandoff(id, "paused", "Preflight paused", projectPath));
	removeStoredSnapshot(id);

	const inspected = await tool.execute(
		"inspect-handoff-only",
		{ status: "paused", query: "Preflight paused" },
		undefined,
		undefined,
		rpcContext(projectPath, ["Preflight paused", "Inspeccionar"]),
	);
	assert.equal(inspected.details.action, "inspect");
	assert.equal(storedSnapshotIds().includes(id), false);

	availableSkills.delete("grill");
	try {
		await assert.rejects(
			tool.execute(
				"failed-preflight",
				{ status: "paused", query: "Preflight paused" },
				undefined,
				undefined,
				rpcContext(projectPath, ["Preflight paused", "Retomar"]),
			),
			/Could not materialize grill/i,
		);
		assert.equal(storedSnapshotIds().includes(id), false);
	} finally {
		availableSkills.add("grill");
		removeStoredSnapshot(id);
	}
});

test("CA-7: a handoff changed after listing is revalidated before runtime import", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "revalidate-project");
	const handoffPath = join(projectPath, ".sdd", "grills", "revalidate.md");
	const id = "revalidate-before-import";
	mkdirSync(dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, canonicalHandoff(id, "paused", "Revalidate paused", projectPath));
	removeStoredSnapshot(id);
	let selection = 0;
	try {
		await assert.rejects(
			tool.execute(
				"revalidate-before-import",
				{ status: "paused", query: "Revalidate paused" },
				undefined,
				undefined,
				{
					cwd: projectPath,
					hasUI: true,
					mode: "rpc",
					ui: {
						async select(_title: string, labels: string[]) {
							selection += 1;
							if (selection === 1) {
								const selected = labels.find((label) => label.includes("Revalidate paused"));
								assert.ok(selected);
								writeFileSync(handoffPath, "# Grill — replaced with invalid metadata\n");
								return selected;
							}
							return labels.find((label) => label.includes("Retomar"));
						},
					},
				},
			),
			/changed|valid handoff-only|metadata/i,
		);
		assert.equal(storedSnapshotIds().includes(id), false);
	} finally {
		removeStoredSnapshot(id);
	}
});

test("CA-7: a queue failure rolls back a newly imported runtime snapshot", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "queue-failure-project");
	const handoffPath = join(projectPath, ".sdd", "grills", "queue-failure.md");
	const id = "queue-failure/unsafe id";
	mkdirSync(dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, canonicalHandoff(id, "paused", "Queue failure paused", projectPath));
	removeStoredSnapshot(id);
	failMessageQueue = true;
	try {
		await assert.rejects(
			tool.execute(
				"queue-failure",
				{ status: "paused", query: "Queue failure paused" },
				undefined,
				undefined,
				rpcContext(projectPath, ["Queue failure paused", "Retomar"]),
			),
			/queue failed/i,
		);
		assert.equal(storedSnapshotIds().includes(id), false, "failed delivery must not leave an imported snapshot");
	} finally {
		failMessageQueue = false;
		removeStoredSnapshot(id);
	}
});

test("CA-7/8: resume imports the exact logical identity and complete handoff before queuing grill", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "resume-import-project");
	const handoffPath = join(projectPath, ".sdd", "grills", "resume.md");
	const id = "resume/unsafe id";
	const markdown = canonicalHandoff(id, "paused", "Resume imported", "/historical/project");
	mkdirSync(dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, markdown);
	removeStoredSnapshot(id);
	sentMessages = [];
	try {
		const result = await tool.execute(
			"resume-import",
			{ status: "paused", query: "Resume imported" },
			undefined,
			undefined,
			rpcContext(projectPath, ["Resume imported", "Retomar"]),
		);
		assert.equal(result.details.action, "resume");
		assert.equal(result.details.selected.id, id);
		assert.equal(result.details.selected.projectPath, projectPath);
		assert.equal(result.details.selected.interviewMode, "unselected");
		assert.equal(result.details.selected.importedHandoff.markdown, markdown);
		assert.equal(result.details.selected.importedHandoff.sourcePath, handoffPath);
		assert.equal(result.details.selected.importedHandoff.historicalProjectPath, "/historical/project");
		assert.equal(sentMessages.length, 1);
		assert.ok(sentMessages[0]!.content.endsWith(`--resume ${JSON.stringify(id)}`));
		assert.deepEqual(sentMessages[0]!.options, { deliverAs: "followUp" });
	} finally {
		removeStoredSnapshot(id);
	}
});

test("CA-9: finalized handoff-only queues sdd-spec by validated absolute path without importing", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "spec source with spaces");
	const handoffPath = join(projectPath, ".sdd", "grills", "final source.md");
	const id = "final-path-source";
	mkdirSync(dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, canonicalHandoff(id, "finalized", "Final path source", "/old/project"));
	removeStoredSnapshot(id);
	sentMessages = [];
	const result = await tool.execute(
		"spec-from-path",
		{ status: "finalized", query: "Final path source" },
		undefined,
		undefined,
		rpcContext(projectPath, ["Final path source", "Crear spec SDD"]),
	);
	assert.equal(result.details.action, "create-spec");
	assert.equal(result.details.sourceTarget, handoffPath);
	assert.equal(storedSnapshotIds().includes(id), false);
	assert.equal(sentMessages.length, 1);
	assert.match(sentMessages[0]!.content, new RegExp(`--from-grill ${JSON.stringify(handoffPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
});

test("CA-5/6: inventory inspection truncates oversized persisted handoffs", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "large-inspection-project");
	const handoffPath = join(projectPath, ".sdd", "grills", "large.md");
	const id = "large-inspection";
	const largeFact = "confirmed-context-".repeat(6_000);
	const markdown = canonicalHandoff(id, "finalized", "Large inspection", projectPath).replace(
		"Confirmed source context.",
		largeFact,
	);
	mkdirSync(dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, markdown);

	const result = await tool.execute(
		"large-inspection",
		{ status: "finalized", query: "Large inspection", intent: "spec-source" },
		undefined,
		undefined,
		rpcContext(projectPath, ["Large inspection"]),
	);
	const content = result.content[0].text as string;
	assert.ok(Buffer.byteLength(content, "utf8") < 48 * 1024, "inspection output stays under the tool budget");
	assert.match(content, /Inventory inspection truncated/);
});

test("CA-9: snapshot-backed spec dispatch quotes an unsafe logical grill id", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "snapshot-spec-source");
	const storeDirectory = join(process.env.HOME!, ".pi", "agent", "grill-sessions");
	const id = "final/unsafe id";
	const topic = "Unsafe snapshot spec source";
	const handoffMarkdown = canonicalHandoff(id, "finalized", topic, projectPath);
	const timestamp = "2026-09-29T12:00:00.000Z";
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(storeDirectory, { recursive: true });
	writeFileSync(join(storeDirectory, `${snapshotStorageStem(id)}.json`), `${JSON.stringify({
		version: 5,
		id,
		topic,
		projectPath,
		projectName: "snapshot-spec-source",
		status: "finalized",
		interviewMode: "adaptive",
		createdAt: timestamp,
		updatedAt: timestamp,
		estimate: { min: 1, likely: 2, max: 3 },
		questionLimit: 20,
		sections: [],
		interactions: [],
		decisions: [],
		pendingBranches: [],
		handoffMarkdown,
		revision: 1,
	}, null, 2)}\n`);
	sentMessages = [];
	try {
		const result = await tool.execute(
			"spec-from-unsafe-id",
			{ status: "finalized", query: topic },
			undefined,
			undefined,
			rpcContext(projectPath, [topic, "Crear spec SDD"]),
		);
		assert.equal(result.details.action, "create-spec");
		assert.equal(result.details.sourceTarget, id);
		assert.equal(sentMessages.length, 1);
		assert.ok(sentMessages[0]!.content.endsWith(`--from-grill ${JSON.stringify(id)}`));
	} finally {
		removeStoredSnapshot(id);
	}
});

test("CA-7: corrupt snapshots whose id contains ENOENT are not mistaken for missing files", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "corrupt-enoent-project");
	const handoffPath = join(projectPath, ".sdd", "grills", "corrupt.md");
	const storeDirectory = join(process.env.HOME!, ".pi", "agent", "grill-sessions");
	const id = "corrupt-ENOENT-id";
	const snapshotPath = join(storeDirectory, `${id}.json`);
	const corruptContent = `{"id":"${id}","broken":`;
	mkdirSync(dirname(handoffPath), { recursive: true });
	mkdirSync(storeDirectory, { recursive: true });
	writeFileSync(handoffPath, canonicalHandoff(id, "paused", "Corrupt ENOENT snapshot", projectPath));
	writeFileSync(snapshotPath, corruptContent);
	sentMessages = [];
	try {
		await assert.rejects(
			tool.execute(
				"corrupt-enoent",
				{ status: "paused", query: "Corrupt ENOENT snapshot" },
				undefined,
				undefined,
				rpcContext(projectPath, ["Corrupt ENOENT snapshot", "Retomar"]),
			),
			(error: Error) => {
				assert.match(error.message, /Could not load grill session.*corrupt-ENOENT-id/i);
				assert.doesNotMatch(error.message, /EEXIST/);
				return true;
			},
		);
		assert.equal(readFileSync(snapshotPath, "utf8"), corruptContent);
		assert.equal(sentMessages.length, 0);
	} finally {
		rmSync(snapshotPath, { force: true });
	}
});

test("CA-1: inventory discovery shares repository lookups and bounds git root concurrency", async () => {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	const projectPath = join(sandbox, "inventory-cache-project");
	const handoffPath = join(projectPath, ".sdd", "grills", "cached.md");
	mkdirSync(dirname(handoffPath), { recursive: true });
	writeFileSync(handoffPath, canonicalHandoff("cached-inventory", "paused", "Cached inventory", projectPath));

	const sessionsDirectory = join(process.env.HOME!, ".pi", "agent", "sessions");
	for (let index = 0; index < 8; index += 1) {
		const cwd = join(sandbox, `known-project-${index}`);
		const directory = join(sessionsDirectory, `cache-session-${index}`);
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "session.jsonl"), `${JSON.stringify({ type: "session", cwd })}\n`);
	}

	let activeRootLookups = 0;
	let maxRootConcurrency = 0;
	const repositoryCalls = new Map<string, number>();
	execHandler = async (command: string, args: string[], options: { cwd?: string }) => {
		assert.equal(command, "git");
		const cwd = resolve(options.cwd ?? projectPath);
		if (args[0] === "rev-parse") {
			activeRootLookups += 1;
			maxRootConcurrency = Math.max(maxRootConcurrency, activeRootLookups);
			await new Promise((resolveDone) => setTimeout(resolveDone, 5));
			activeRootLookups -= 1;
			return { code: 0, stdout: `${cwd}\n`, stderr: "" };
		}
		if (args[0] === "config") {
			repositoryCalls.set(cwd, (repositoryCalls.get(cwd) ?? 0) + 1);
			return { code: 0, stdout: "git@github.com:chichex/skills.git\n", stderr: "" };
		}
		throw new Error(`unexpected git args: ${args.join(" ")}`);
	};
	try {
		await tool.execute(
			"bounded-inventory",
			{ status: "all", scope: "all", query: "no-such-grill" },
			undefined,
			undefined,
			{
				cwd: projectPath,
				hasUI: true,
				mode: "rpc",
				ui: { async select() { return undefined; } },
			},
		);
		assert.ok(maxRootConcurrency <= 4, `git root concurrency was ${maxRootConcurrency}`);
		assert.equal(repositoryCalls.get(resolve(projectPath)), 1);
	} finally {
		execHandler = async (..._args: any[]) => ({ code: 0, stdout: "", stderr: "" });
	}
});

test("persist_sdd_spec exposes the parser-backed boundary and returns a receipt after a local reread", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("persist_sdd_spec");
	assert.ok(tool, "the executable Pi boundary is registered");
	const projectPath = join(sandbox, "publication-project");
	const relativePath = ".sdd/specs/canonical.md";
	const absolutePath = join(projectPath, relativePath);
	mkdirSync(projectPath, { recursive: true });
	const markdown = [
		"# Spec — Canonical publication",
		"<!-- Generada por /skill:sdd-spec. Estado: aprobada -->",
		"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=none; superseded-by=none -->",
		"",
		"## Contexto",
		"Body.",
		"",
	].join("\n");

	const result = await tool.execute(
		"persist-local-spec",
		{
			mode: "interactive",
			repository: "local/publication-project",
			projectPath,
			documents: [{
				id: "successor",
				role: "successor",
				markdown,
				destinations: [{ kind: "local", path: relativePath }],
			}],
		},
		undefined,
		undefined,
		{ cwd: projectPath },
	);

	assert.equal(result.details.ok, true);
	assert.equal(result.details.receipt.kind, "sdd-spec-publication");
	assert.equal(readFileSync(absolutePath, "utf8"), markdown);
});

test("persist_sdd_spec keeps local content normative while archiving an existing issue body idempotently in Ambos", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("persist_sdd_spec");
	assert.ok(tool);
	const projectPath = join(sandbox, "ambos-publication-project");
	const localPath = join(projectPath, ".sdd", "specs", "issue-33-canonical.md");
	mkdirSync(projectPath, { recursive: true });
	let remoteBody = "Original request.\n";
	execHandler = async (command: string, args: string[]) => {
		if (command === "git" && args[0] === "rev-parse") {
			return { code: 0, stdout: `${projectPath}\n`, stderr: "" };
		}
		if (command === "git" && args[0] === "config") {
			return { code: 0, stdout: "git@github.com:chichex/skills.git\n", stderr: "" };
		}
		if (command === "gh" && args[0] === "issue" && args[1] === "view") {
			return { code: 0, stdout: JSON.stringify({ body: remoteBody }), stderr: "" };
		}
		if (command === "gh" && args[0] === "issue" && args[1] === "edit") {
			const bodyPath = args[args.indexOf("--body-file") + 1];
			remoteBody = readFileSync(bodyPath, "utf8");
			return { code: 0, stdout: "", stderr: "" };
		}
		throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
	};
	try {
		const markdown = [
			"# Spec — Ambos publication",
			"<!-- Generada por /skill:sdd-spec. Estado: aprobada -->",
			"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#33; grill=none; superseded-by=none -->",
			"",
			"## Contexto",
			"Body.",
			"",
		].join("\n");
		const input = {
			mode: "interactive",
			repository: "chichex/skills",
			projectPath,
			documents: [{
				id: "successor",
				role: "successor",
				markdown,
				issueNumber: 33,
				destinations: [
					{ kind: "local", path: ".sdd/specs/issue-33-canonical.md" },
					{ kind: "issue", issueNumber: 33 },
				],
			}],
		};

		const first = await tool.execute("persist-ambos", input, undefined, undefined, { cwd: projectPath });
		assert.equal(first.details.ok, true);
		assert.equal(readFileSync(localPath, "utf8"), markdown);
		assert.match(remoteBody, /<details><summary>Body original<\/summary>/);
		assert.match(remoteBody, /Original request\./);
		assert.equal(remoteBody.match(/<details><summary>Body original<\/summary>/g)?.length, 1);

		const retry = await tool.execute("retry-ambos", input, undefined, undefined, { cwd: projectPath });
		assert.equal(retry.details.ok, true);
		assert.equal(remoteBody.match(/<details><summary>Body original<\/summary>/g)?.length, 1);
		assert.match(remoteBody, /Original request\./);
	} finally {
		execHandler = async (..._args: any[]) => ({ code: 0, stdout: "", stderr: "" });
	}
});

test("persist_sdd_spec creates a staging issue and publishes only after binding its identity", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("persist_sdd_spec");
	assert.ok(tool);
	const projectPath = join(sandbox, "github-publication-project");
	mkdirSync(projectPath, { recursive: true });
	let stagingBody = "";
	let publishedBody = "";
	execHandler = async (command: string, args: string[], options: { cwd?: string }) => {
		if (command === "git" && args[0] === "rev-parse") {
			return { code: 0, stdout: `${projectPath}\n`, stderr: "" };
		}
		if (command === "git" && args[0] === "config") {
			return { code: 0, stdout: "https://github.com/chichex/skills.git\n", stderr: "" };
		}
		if (command === "gh" && args[0] === "issue" && args[1] === "create") {
			const bodyPath = args[args.indexOf("--body-file") + 1];
			stagingBody = readFileSync(bodyPath, "utf8");
			publishedBody = stagingBody;
			return { code: 0, stdout: "https://github.com/chichex/skills/issues/77\n", stderr: "" };
		}
		if (command === "gh" && args[0] === "issue" && args[1] === "edit") {
			const bodyPath = args[args.indexOf("--body-file") + 1];
			publishedBody = readFileSync(bodyPath, "utf8");
			return { code: 0, stdout: "", stderr: "" };
		}
		if (command === "gh" && args[0] === "issue" && args[1] === "view") {
			return { code: 0, stdout: JSON.stringify({ body: publishedBody }), stderr: "" };
		}
		throw new Error(`unexpected command in ${options.cwd}: ${command} ${args.join(" ")}`);
	};
	try {
		const markdown = [
			"# Spec — New issue publication",
			"<!-- Generada por /skill:sdd-spec. Estado: aprobada -->",
			"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=none; superseded-by=none -->",
			"",
			"## Contexto",
			"Body.",
			"",
		].join("\n");
		const result = await tool.execute(
			"persist-new-issue-spec",
			{
				mode: "interactive",
				repository: "chichex/skills",
				projectPath,
				documents: [{
					id: "successor",
					role: "successor",
					markdown,
					destinations: [{ kind: "new-issue", title: "New issue publication" }],
				}],
			},
			undefined,
			undefined,
			{ cwd: projectPath },
		);

		assert.equal(result.details.ok, true);
		assert.doesNotMatch(stagingBody, /SDD-Tracking/, "the creation body is not a transient spec");
		assert.match(publishedBody, /issue=#77/);
		assert.doesNotMatch(publishedBody, /issue=none/);
		assert.doesNotMatch(publishedBody, /<details>/, "staging is not archived into the final issue body");
		assert.deepEqual(result.details.receipt.documents[0].destinations, ["issue:chichex/skills#77"]);
	} finally {
		execHandler = async (..._args: any[]) => ({ code: 0, stdout: "", stderr: "" });
	}
});

// Spec #84 (CA-10, CA-11): los borradores van a <git-common-dir>/sdd/, fuera
// de los working trees. Estos tests usan repos git reales con un worktree
// linkeado, con rutas canónicas (realpath) para no depender de /var vs
// /private/var en macOS.
function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-c", "user.name=sdd", "-c", "user.email=sdd@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

function repoWithLinkedWorktree(name: string): { base: string; main: string; linked: string; common: string } {
	const base = realpathSync(mkdtempSync(join(tmpdir(), `grill-tools-${name}-`)));
	const main = join(base, "repo");
	mkdirSync(main);
	git(main, "init", "-q", "-b", "main");
	writeFileSync(join(main, "README.md"), "repo\n");
	git(main, "add", "README.md");
	git(main, "commit", "-q", "-m", "init");
	const linked = join(base, "repo-wt");
	git(main, "worktree", "add", "-q", "-b", "feature", linked);
	return { base, main, linked, common: join(main, ".git") };
}

function gitStatus(cwd: string): string {
	return git(cwd, "status", "--porcelain", "--untracked-files=all");
}

function canonicalSpec(title: string): string {
	return [
		`# Spec — ${title}`,
		"<!-- Generada por /skill:sdd-spec. Estado: aprobada -->",
		"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=none; superseded-by=none -->",
		"",
		"## Contexto",
		"Body.",
		"",
	].join("\n");
}

async function selectLabels(cwd: string, params: Record<string, unknown>): Promise<string[]> {
	const tool = tools.get("select_grill_session");
	assert.ok(tool);
	let labels: string[] = [];
	await tool.execute("list-labels", params, undefined, undefined, {
		cwd,
		hasUI: true,
		mode: "rpc",
		ui: {
			async select(_title: string, offered: string[]) {
				labels = offered;
				return undefined;
			},
		},
	});
	return labels;
}

let themeReady = false;

async function renderSpecs(cwd: string): Promise<string> {
	const command = commands.get("specs");
	assert.ok(command);
	if (!themeReady) {
		// selectMenu usa el theme global de Pi: se inicializa una vez, sin watcher.
		const pi = await import(pathToFileURL(join(sandbox, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")).href);
		pi.initTheme(undefined, false);
		themeReady = true;
	}
	const renders: string[] = [];
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
	await command.handler("", {
		cwd,
		mode: "tui",
		waitForIdle: async () => {},
		ui: {
			notify(message: string) {
				renders.push(`NOTIFY: ${message}`);
			},
			async custom(factory: (...args: any[]) => any) {
				return new Promise((resolveDone) => {
					const component = factory({ requestRender() {} }, theme, {}, resolveDone);
					renders.push(component.render(200).join("\n"));
					component.handleInput("\x1b");
				});
			},
		},
	});
	return renders.join("\n");
}

test("#84 CA-10: grill_session pause y finalize escriben el handoff en <git-common-dir>/sdd/grills sin ensuciar ningún checkout", { skip: !PI_PACKAGE_ROOT }, async (t) => {
	const tool = tools.get("grill_session");
	assert.ok(tool);
	const { base, main, linked, common } = repoWithLinkedWorktree("pause");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const created = await tool.execute(
		"create-local-handoff",
		{ action: "create", topic: "Borradores fuera del árbol", projectPath: main, estimate: { min: 1, likely: 2, max: 3 } },
		undefined,
		undefined,
		{ cwd: main },
	);
	const id = created.details.snapshot.id;
	t.after(() => removeStoredSnapshot(id));
	await tool.execute("configure-local-handoff", { action: "configure", sessionId: id, interviewMode: "adaptive" }, undefined, undefined, { cwd: main });

	const paused = await tool.execute("pause-local-handoff", { action: "pause", sessionId: id, summary: "Pausa" }, undefined, undefined, { cwd: main });
	assert.equal(dirname(paused.details.repoHandoffPath), join(common, "sdd", "grills"));
	assert.match(readFileSync(paused.details.repoHandoffPath, "utf8"), /state=paused/);
	assert.equal(gitStatus(main), "", "checkout principal limpio después de pause");
	assert.equal(gitStatus(linked), "", "worktree linkeado limpio después de pause");

	const finalized = await tool.execute(
		"finalize-local-handoff",
		{ action: "finalize", sessionId: id, handoffMarkdown: "# Grill — Borradores fuera del árbol\n\n## Handoff\nListo.\n" },
		undefined,
		undefined,
		{ cwd: main },
	);
	assert.equal(finalized.details.repoHandoffPath, paused.details.repoHandoffPath);
	assert.match(readFileSync(finalized.details.repoHandoffPath, "utf8"), /state=finalized/);
	assert.equal(gitStatus(main), "", "checkout principal limpio después de finalize");
	assert.equal(gitStatus(linked), "", "worktree linkeado limpio después de finalize");
});

test("#84 CA-10: /grills y select_grill_session listan los dos lugares y no duplican el handoff local entre worktrees", { skip: !PI_PACKAGE_ROOT }, async (t) => {
	const { base, main, linked, common } = repoWithLinkedWorktree("listing");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const localDirectory = join(common, "sdd", "grills");
	mkdirSync(localDirectory, { recursive: true });
	writeFileSync(join(localDirectory, "local.md"), canonicalHandoff("cero-residuos-local", "paused", "Handoff local compartido", main));
	mkdirSync(join(main, ".sdd", "grills"), { recursive: true });
	writeFileSync(join(main, ".sdd", "grills", "trackeado.md"), canonicalHandoff("cero-residuos-trackeado", "paused", "Handoff trackeado del principal", main));
	// Una sesión en cada checkout los vuelve roots conocidos para el scope "all".
	for (const [name, cwd] of [["cero-residuos-main", main], ["cero-residuos-linked", linked]] as const) {
		const sessionDirectory = join(process.env.HOME!, ".pi", "agent", "sessions", name);
		mkdirSync(sessionDirectory, { recursive: true });
		writeFileSync(join(sessionDirectory, "session.jsonl"), `${JSON.stringify({ type: "session", cwd })}\n`);
		t.after(() => rmSync(sessionDirectory, { recursive: true, force: true }));
	}

	for (const cwd of [main, linked]) {
		const all = await selectLabels(cwd, { status: "all", scope: "all", query: "cero-residuos" });
		assert.equal(all.filter((label) => label.includes("Handoff local compartido")).length, 1, `${cwd}: el handoff local aparece una sola vez`);
		assert.equal(all.filter((label) => label.includes("Handoff trackeado del principal")).length, 1, `${cwd}: el handoff trackeado aparece una sola vez`);
	}
	const current = await selectLabels(main, { status: "all", scope: "current-project", query: "cero-residuos" });
	assert.ok(current.some((label) => label.includes("Handoff local compartido")), "el proyecto del handoff local lo ve en su scope");
	assert.ok(current.some((label) => label.includes("Handoff trackeado del principal")));
});

test("#84 CA-11: persist_sdd_spec con destino local escribe en <git-common-dir>/sdd/specs desde el principal y desde el worktree", { skip: !PI_PACKAGE_ROOT }, async (t) => {
	const tool = tools.get("persist_sdd_spec");
	assert.ok(tool);
	const { base, main, linked, common } = repoWithLinkedWorktree("persist");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	for (const [projectPath, slug] of [[main, "desde-principal"], [linked, "desde-worktree"]] as const) {
		const markdown = canonicalSpec(`Spec ${slug}`);
		const result = await tool.execute(
			`persist-${slug}`,
			{
				mode: "interactive",
				repository: `local/${projectPath === main ? "repo" : "repo-wt"}`,
				projectPath,
				documents: [{ id: "successor", role: "successor", markdown, destinations: [{ kind: "local", path: `.sdd/specs/${slug}.md` }] }],
			},
			undefined,
			undefined,
			{ cwd: projectPath },
		);
		assert.equal(result.details.ok, true, JSON.stringify(result.details.diagnostics));
		assert.equal(readFileSync(join(common, "sdd", "specs", `${slug}.md`), "utf8"), markdown);
		assert.equal(gitStatus(main), "", `${slug}: checkout principal limpio`);
		assert.equal(gitStatus(linked), "", `${slug}: worktree linkeado limpio`);
	}
});

test("#84 CA-11: el confinamiento de persist_sdd_spec acepta los dos directorios y rechaza cualquier otro", { skip: !PI_PACKAGE_ROOT }, async (t) => {
	const tool = tools.get("persist_sdd_spec");
	assert.ok(tool);
	const { base, main, common } = repoWithLinkedWorktree("confine");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const persist = (path: string) => tool.execute(
		"persist-confined",
		{
			mode: "interactive",
			repository: "local/repo",
			projectPath: main,
			documents: [{ id: "successor", role: "successor", markdown: canonicalSpec("Confinada"), destinations: [{ kind: "local", path }] }],
		},
		undefined,
		undefined,
		{ cwd: main },
	);
	for (const outside of [join(main, "specs", "x.md"), join(main, ".sdd", "grills", "x.md"), join(common, "sdd", "grills", "x.md"), join(common, "sdd", "specs", "sub", "x.md"), "specs/x.md"]) {
		await assert.rejects(persist(outside), /Local spec destination must be one Markdown file directly under/, `rechaza ${outside}`);
	}
	const local = await persist(join(common, "sdd", "specs", "absoluta-local.md"));
	assert.equal(local.details.ok, true);
	const tracked = await persist(join(main, ".sdd", "specs", "absoluta-trackeada.md"));
	assert.equal(tracked.details.ok, true);
	assert.equal(readFileSync(join(main, ".sdd", "specs", "absoluta-trackeada.md"), "utf8"), canonicalSpec("Confinada"));
});

test("#84 CA-11: /specs lista los dos lugares desde el principal y desde el worktree, y ante el mismo nombre gana el trackeado", { skip: !PI_PACKAGE_ROOT }, async (t) => {
	const { base, main, linked, common } = repoWithLinkedWorktree("specs");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const localDirectory = join(common, "sdd", "specs");
	mkdirSync(localDirectory, { recursive: true });
	mkdirSync(join(main, ".sdd", "specs"), { recursive: true });
	writeFileSync(join(main, ".sdd", "specs", "compartida.md"), canonicalSpec("Compartida trackeada"));
	writeFileSync(join(localDirectory, "compartida.md"), canonicalSpec("Compartida local"));
	writeFileSync(join(localDirectory, "solo-local.md"), canonicalSpec("Solo local"));
	for (const cwd of [main, linked]) {
		const view = await renderSpecs(cwd);
		assert.match(view, /Solo local/, `${cwd}: /specs muestra la spec local`);
		assert.doesNotMatch(view, /NOTIFY/, `${cwd}: sin errores`);
	}
	const fromMain = await renderSpecs(main);
	assert.match(fromMain, /Compartida trackeada/);
	assert.doesNotMatch(fromMain, /Compartida local/, "la trackeada gana ante el mismo nombre");
});

test("#84 CA-10: una revisión local no queda oculta detrás de un handoff trackeado con el mismo nombre", { skip: !PI_PACKAGE_ROOT }, async (t) => {
	const tool = tools.get("grill_session");
	assert.ok(tool);
	const { base, main, common } = repoWithLinkedWorktree("shadow");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const created = await tool.execute(
		"create-shadowed-handoff",
		{ action: "create", topic: "Handoff ya commiteado", projectPath: main, estimate: { min: 1, likely: 2, max: 3 } },
		undefined,
		undefined,
		{ cwd: main },
	);
	const snapshot = created.details.snapshot;
	t.after(() => removeStoredSnapshot(snapshot.id));
	const names = handoffFileNames(snapshot);
	mkdirSync(join(main, ".sdd", "grills"), { recursive: true });
	writeFileSync(join(main, ".sdd", "grills", names.primary), canonicalHandoff(snapshot.id, "paused", "Handoff ya commiteado", main));
	git(main, "add", ".sdd/grills");
	git(main, "commit", "-q", "-m", "handoff commiteado");
	await tool.execute("configure-shadowed", { action: "configure", sessionId: snapshot.id, interviewMode: "adaptive" }, undefined, undefined, { cwd: main });
	const paused = await tool.execute("pause-shadowed", { action: "pause", sessionId: snapshot.id, summary: "Nueva revisión" }, undefined, undefined, { cwd: main });
	assert.equal(paused.details.repoHandoffPath, join(common, "sdd", "grills", names.fallback));
	assert.equal(gitStatus(main), "");
});
