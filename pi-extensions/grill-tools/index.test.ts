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
		exec: (...args: any[]) => execHandler(...args),
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
