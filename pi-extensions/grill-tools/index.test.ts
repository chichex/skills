import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	accessSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
let grillEvents: any[] = [];

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

	const { default: register } = await import(
		`${pathToFileURL(join(sandbox, "pi-extensions", "grill-tools", "index.ts")).href}?test=${Date.now()}`
	);
	register({
		registerEntryRenderer() {},
		registerCommand() {},
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		events: {
			emit(name: string, payload: unknown) {
				if (name === "grill:interview-state") grillEvents.push(payload);
			},
		},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	} as never);
});

after(() => {
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

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
	assert.equal(loadedLegacy.details.snapshot.version, 4);
});
