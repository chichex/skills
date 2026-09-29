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
			workflowMode: "standard",
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

test("CA-1/4/6: /grills and select_grill_session expose the same handoff and snapshot inventory", { skip: !PI_PACKAGE_ROOT }, async () => {
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
		workflowMode: "standard",
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

test("CA-7: inspect and failed materialization never import a handoff-only snapshot", { skip: !PI_PACKAGE_ROOT }, async () => {
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

test("CA-7: a handoff changed after listing is revalidated before runtime import", { skip: !PI_PACKAGE_ROOT }, async () => {
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

test("CA-7: a queue failure rolls back a newly imported runtime snapshot", { skip: !PI_PACKAGE_ROOT }, async () => {
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

test("CA-7/8: resume imports the exact logical identity and complete handoff before queuing grill", { skip: !PI_PACKAGE_ROOT }, async () => {
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
		assert.match(sentMessages[0]!.content, /--resume resume\/unsafe id$/);
		assert.deepEqual(sentMessages[0]!.options, { deliverAs: "followUp" });
	} finally {
		removeStoredSnapshot(id);
	}
});

test("CA-9: finalized handoff-only queues sdd-spec by validated absolute path without importing", { skip: !PI_PACKAGE_ROOT }, async () => {
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
