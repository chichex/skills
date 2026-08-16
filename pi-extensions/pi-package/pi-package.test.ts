import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

interface PiPackageManifest {
	name?: unknown;
	version?: unknown;
	private?: unknown;
	type?: unknown;
	license?: unknown;
	repository?: unknown;
	homepage?: unknown;
	keywords?: unknown;
	scripts?: unknown;
	dependencies?: unknown;
	peerDependencies?: unknown;
	bundledDependencies?: unknown;
	bundleDependencies?: unknown;
	pi?: unknown;
}

interface ProductionInventory {
	skills: string[];
	themes: string[];
	factoryCandidates: string[];
	factories: string[];
}

interface IsolatedPiEnvironment {
	root: string;
	configDir: string;
	env: NodeJS.ProcessEnv;
}

interface PiCommand {
	name: string;
	source: string;
}

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const EXPECTED_PEERS = {
	"@earendil-works/pi-ai": "*",
	"@earendil-works/pi-coding-agent": "*",
	"@earendil-works/pi-tui": "*",
	typebox: "*",
};

const EXPECTED_SKILLS = [
	"./pi/code-review/SKILL.md",
	"./pi/domain-modeling/SKILL.md",
	"./pi/find-skills/SKILL.md",
	"./pi/github-issue-selector/SKILL.md",
	"./pi/grill/SKILL.md",
	"./pi/issue-triage/SKILL.md",
	"./pi/quick-run/SKILL.md",
	"./pi/repo-clean/SKILL.md",
	"./pi/sdd-init/SKILL.md",
	"./pi/sdd-run/SKILL.md",
	"./pi/sdd-spec/SKILL.md",
	"./pi/tdd/SKILL.md",
];

const EXPECTED_THEMES = ["./pi-themes/claude-code.json"];

const EXPECTED_EXTENSIONS = [
	"./pi-extensions/ask-user-question/index.ts",
	"./pi-extensions/claude-tool-renderer.ts",
	"./pi-extensions/github-issue-selector.ts",
	"./pi-extensions/github-issues.ts",
	"./pi-extensions/github-prs/index.ts",
	"./pi-extensions/grill-tools/index.ts",
	"./pi-extensions/inline-skill-autocomplete/index.ts",
	"./pi-extensions/visual-footer.ts",
	"./pi-extensions/warp-status.ts",
	"./pi-extensions/workflow-orchestrator/index.ts",
];

const EXPECTED_EXTENSION_COMMANDS = [
	"__sdd-dispatch",
	"grills",
	"issues",
	"llama",
	"prs",
	"sdd-run",
	"specs",
	"visual-footer",
];

const EXPECTED_SKILL_COMMANDS = EXPECTED_SKILLS.map((path) => `skill:${path.split("/").at(-2)}`).sort();
const EXPECTED_COMMANDS = [...EXPECTED_EXTENSION_COMMANDS, ...EXPECTED_SKILL_COMMANDS].sort();
const FACTORY_EXPORT = /\bexport\s+default\s+(?:async\s+)?function\b/;

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

function repoPath(path: string): string {
	return join(REPO_ROOT, path);
}

function packagePath(path: string): string {
	return `./${relative(REPO_ROOT, path).split(sep).join("/")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string")
		? value
		: undefined;
}

async function readManifest(): Promise<PiPackageManifest> {
	return JSON.parse(await readFile(repoFile("package.json"), "utf8")) as PiPackageManifest;
}

async function pathExists(path: string): Promise<boolean> {
	return access(repoFile(path)).then(
		() => true,
		() => false,
	);
}

async function walkFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...await walkFiles(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

async function productionInventory(): Promise<ProductionInventory> {
	const skills = (await walkFiles(repoPath("pi")))
		.filter((path) => path.endsWith(`${sep}SKILL.md`))
		.map(packagePath)
		.sort();
	const themes = (await readdir(repoPath("pi-themes"), { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => packagePath(repoPath(`pi-themes/${entry.name}`)))
		.sort();

	const factoryCandidates: string[] = [];
	for (const entry of await readdir(repoPath("pi-extensions"), { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			factoryCandidates.push(packagePath(repoPath(`pi-extensions/${entry.name}`)));
			continue;
		}
		if (entry.isDirectory() && await pathExists(`pi-extensions/${entry.name}/index.ts`)) {
			factoryCandidates.push(packagePath(repoPath(`pi-extensions/${entry.name}/index.ts`)));
		}
	}
	factoryCandidates.sort();

	const factories: string[] = [];
	for (const path of factoryCandidates) {
		if (FACTORY_EXPORT.test(await readFile(repoPath(path.slice(2)), "utf8"))) factories.push(path);
	}
	return { skills, themes, factoryCandidates, factories };
}

function sameStringRecord(value: unknown, expected: Record<string, string>): boolean {
	if (!isRecord(value)) return false;
	const keys = Object.keys(value).sort();
	const expectedKeys = Object.keys(expected).sort();
	return keys.length === expectedKeys.length &&
		keys.every((key, index) => key === expectedKeys[index] && value[key] === expected[key]);
}

function comparePaths(label: string, expected: readonly string[], actual: readonly string[], problems: string[]): void {
	for (const path of expected) {
		if (!actual.includes(path)) problems.push(`${label}: missing ${path}`);
	}
	for (const path of actual) {
		if (!expected.includes(path)) problems.push(`${label}: unexpected ${path}`);
	}
}

function validatePiPackage(manifest: PiPackageManifest, inventory: ProductionInventory): string[] {
	const problems: string[] = [];
	if (manifest.private !== true) problems.push("metadata: private must be true");
	if (Object.hasOwn(manifest, "scripts")) problems.push("metadata: scripts are not allowed");
	if (!sameStringRecord(manifest.peerDependencies, EXPECTED_PEERS)) {
		problems.push("peerDependencies: expected the four Pi core peers at range *");
	}
	if (Object.hasOwn(manifest, "dependencies")) problems.push("dependencies: runtime dependencies are not allowed");
	if (Object.hasOwn(manifest, "bundledDependencies") || Object.hasOwn(manifest, "bundleDependencies")) {
		problems.push("bundledDependencies: bundled packages are not allowed");
	}

	comparePaths("skill census", EXPECTED_SKILLS, inventory.skills, problems);
	comparePaths("theme census", EXPECTED_THEMES, inventory.themes, problems);
	comparePaths("factory census", EXPECTED_EXTENSIONS, inventory.factories, problems);

	if (!isRecord(manifest.pi)) {
		problems.push("manifest: missing pi resource block");
		return problems;
	}
	const keys = Object.keys(manifest.pi).sort();
	if (keys.join(",") !== "extensions,skills,themes") {
		problems.push(`manifest pi keys: expected extensions,skills,themes; got ${keys.join(",")}`);
	}
	const extensions = stringArray(manifest.pi.extensions);
	const skills = stringArray(manifest.pi.skills);
	const themes = stringArray(manifest.pi.themes);
	if (!extensions) problems.push("manifest extensions: expected a string array");
	else {
		comparePaths("manifest extensions", inventory.factories, extensions, problems);
		if (extensions.join("\n") !== EXPECTED_EXTENSIONS.join("\n")) {
			problems.push("manifest extensions: paths or order differ from the approved inventory");
		}
		for (const path of extensions) {
			if (/\.test\.ts$|\/lib\/|\/sdd-artifacts\/|\/workflow-resolution\//.test(path)) {
				problems.push(`manifest extensions: helper or test entrypoint rejected ${path}`);
			}
			if (!inventory.factoryCandidates.includes(path)) {
				problems.push(`manifest extensions: unsupported Pi entrypoint ${path}`);
			} else if (!inventory.factories.includes(path)) {
				problems.push(`manifest extensions: entrypoint has no default factory ${path}`);
			}
		}
	}
	if (!skills || skills.join("\n") !== "./pi") {
		problems.push("manifest skills: expected only ./pi");
	}
	if (!themes || themes.join("\n") !== "./pi-themes") {
		problems.push("manifest themes: expected only ./pi-themes");
	}
	return problems;
}

function runPi(args: string[], env: NodeJS.ProcessEnv, input?: string, timeout = 30_000) {
	const result = spawnSync("pi", args, {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		encoding: "utf8",
		input,
		maxBuffer: 10 * 1024 * 1024,
		timeout,
	});
	if (result.error) throw result.error;
	return {
		status: result.status,
		signal: result.signal,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function assertPiSuccess(result: ReturnType<typeof runPi>, operation: string): void {
	assert.equal(
		result.status,
		0,
		`${operation} failed (signal=${result.signal ?? "none"})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
}

function rpcCommands(extraArgs: string[], env: NodeJS.ProcessEnv): PiCommand[] {
	const result = runPi(
		[
			...extraArgs,
			"--mode",
			"rpc",
			"--no-session",
			"--offline",
			"--no-context-files",
		],
		env,
		'{"id":"inventory","type":"get_commands"}\n',
	);
	assertPiSuccess(result, `pi ${extraArgs.join(" ")} RPC inventory`);
	const events = result.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	assert.deepEqual(
		events.filter((event) => event.type === "extension_error"),
		[],
		`extension_error emitted by package:\n${result.stdout}`,
	);
	const response = events.find(
		(event) => event.type === "response" && event.command === "get_commands" && event.id === "inventory",
	);
	assert.ok(response, `get_commands response missing:\n${result.stdout}`);
	assert.equal(response.success, true);
	assert.ok(isRecord(response.data) && Array.isArray(response.data.commands));
	return response.data.commands as PiCommand[];
}

async function isolatedPiEnvironment(): Promise<IsolatedPiEnvironment> {
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-package-"));
	const home = join(root, "home");
	const configDir = join(root, "pi-agent");
	await mkdir(home, { recursive: true });
	await mkdir(configDir, { recursive: true });
	return {
		root,
		configDir,
		env: {
			HOME: home,
			PI_CODING_AGENT_DIR: configDir,
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			GIT_TERMINAL_PROMPT: "0",
			NO_COLOR: "1",
			TERM: "dumb",
		},
	};
}

async function realPiConfigDigest(): Promise<string> {
	const configRoot = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? homedir(), ".pi", "agent");
	const trackedEntries = [
		"auth.json",
		"extensions",
		"git",
		"models.json",
		"npm",
		"packages",
		"prompts",
		"settings.json",
		"skills",
		"themes",
		"trust.json",
	];
	const hash = createHash("sha256");

	const visit = async (path: string, label: string): Promise<void> => {
		let info;
		try {
			info = await lstat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				hash.update(`${label}\0absent\0`);
				return;
			}
			throw error;
		}
		if (info.isSymbolicLink()) {
			hash.update(`${label}\0symlink\0${await readlink(path)}\0`);
			return;
		}
		if (info.isDirectory()) {
			hash.update(`${label}\0directory\0`);
			for (const entry of (await readdir(path)).sort()) {
				await visit(join(path, entry), `${label}/${entry}`);
			}
			return;
		}
		if (info.isFile()) {
			hash.update(`${label}\0file\0`);
			hash.update(await readFile(path));
			return;
		}
		hash.update(`${label}\0other\0`);
	};

	for (const entry of trackedEntries) await visit(join(configRoot, entry), entry);
	return hash.digest("hex");
}

function assertExpectedPackageCommands(commands: PiCommand[]): void {
	assert.deepEqual(commands.map((command) => command.name).sort(), EXPECTED_COMMANDS);
	assert.deepEqual(
		commands.filter((command) => command.source === "extension").map((command) => command.name).sort(),
		EXPECTED_EXTENSION_COMMANDS,
	);
	assert.deepEqual(
		commands.filter((command) => command.source === "skill").map((command) => command.name).sort(),
		EXPECTED_SKILL_COMMANDS,
	);
}

test("package manifest is deterministic, Git-only, and non-publishable", async () => {
	const manifest = await readManifest();

	assert.equal(manifest.name, "chichex-skills");
	assert.equal(manifest.version, "0.0.0");
	assert.equal(manifest.private, true);
	assert.equal(manifest.type, "module");
	assert.equal(manifest.license, "MIT");
	assert.equal(manifest.repository, "https://github.com/chichex/skills.git");
	assert.equal(manifest.homepage, "https://github.com/chichex/skills");
	assert.deepEqual(manifest.keywords, ["pi-package"]);
	assert.equal(Object.hasOwn(manifest, "scripts"), false, "Git-only package must not expose npm scripts");
	assert.equal(await pathExists("package-lock.json"), false, "repository must not gain a package lockfile");
});

test("Pi core imports are exact peers and never runtime or bundled dependencies", async () => {
	const manifest = await readManifest();

	assert.deepEqual(manifest.peerDependencies, EXPECTED_PEERS);
	assert.equal(Object.hasOwn(manifest, "dependencies"), false, "core imports belong only in peerDependencies");
	assert.equal(Object.hasOwn(manifest, "bundledDependencies"), false);
	assert.equal(Object.hasOwn(manifest, "bundleDependencies"), false);
});

test("manifest inventory matches every production Pi skill, theme, and extension factory", async () => {
	const manifest = await readManifest();
	const inventory = await productionInventory();

	assert.deepEqual(validatePiPackage(manifest, inventory), []);
});

test("inventory gate diagnoses omitted resources, false modules, public metadata, and bad peers", async () => {
	const manifest = await readManifest();
	const inventory = await productionInventory();
	assert.ok(isRecord(manifest.pi), "test setup requires the approved pi block");

	const withoutExtension = structuredClone(manifest);
	(withoutExtension.pi as Record<string, unknown>).extensions = EXPECTED_EXTENSIONS.slice(1);
	assert.ok(
		validatePiPackage(withoutExtension, inventory).some(
			(problem) => problem === `manifest extensions: missing ${EXPECTED_EXTENSIONS[0]}`,
		),
	);

	const withHelper = structuredClone(manifest);
	(withHelper.pi as Record<string, unknown>).extensions = [
		...EXPECTED_EXTENSIONS,
		"./pi-extensions/sdd-artifacts/index.ts",
	];
	assert.ok(
		validatePiPackage(withHelper, inventory).some(
			(problem) => problem.includes("helper or test entrypoint rejected ./pi-extensions/sdd-artifacts/index.ts"),
		),
	);

	const publicManifest = { ...manifest, private: false };
	assert.ok(validatePiPackage(publicManifest, inventory).includes("metadata: private must be true"));

	const wrongPeers = { ...manifest, peerDependencies: { ...EXPECTED_PEERS, typebox: "^1" } };
	assert.ok(
		validatePiPackage(wrongPeers, inventory).includes(
			"peerDependencies: expected the four Pi core peers at range *",
		),
	);

	const addedFactory = "./pi-extensions/new-production-extension.ts";
	const expandedInventory = {
		...inventory,
		factoryCandidates: [...inventory.factoryCandidates, addedFactory],
		factories: [...inventory.factories, addedFactory],
	};
	assert.ok(
		validatePiPackage(manifest, expandedInventory).includes(`manifest extensions: missing ${addedFactory}`),
	);
});

test("temporary package load exposes exactly the approved commands and theme", async () => {
	const isolated = await isolatedPiEnvironment();
	try {
		assertExpectedPackageCommands(rpcCommands(["-e", "./"], isolated.env));
		const theme = runPi(
			["-e", "./", "--use-theme", "claude-code", "--list-models", "--offline", "--no-context-files"],
			isolated.env,
		);
		assertPiSuccess(theme, "temporary claude-code theme smoke");
	} finally {
		await rm(isolated.root, { recursive: true, force: true });
	}
});

test("native local install, discovery, deduplication, and removal stay isolated", async () => {
	const isolated = await isolatedPiEnvironment();
	const realConfigBefore = await realPiConfigDigest();
	try {
		const firstInstall = runPi(["install", REPO_ROOT], isolated.env);
		assertPiSuccess(firstInstall, "first local package install");
		const secondInstall = runPi(["install", REPO_ROOT], isolated.env);
		assertPiSuccess(secondInstall, "idempotent local package install");

		const settings = JSON.parse(
			await readFile(join(isolated.configDir, "settings.json"), "utf8"),
		) as Record<string, unknown>;
		assert.ok(Array.isArray(settings.packages));
		assert.equal(settings.packages.length, 1, "same local package must have one settings entry");
		assert.equal(typeof settings.packages[0], "string");
		assert.equal(resolve(isolated.configDir, settings.packages[0] as string), REPO_ROOT);

		const listed = runPi(["list"], isolated.env);
		assertPiSuccess(listed, "pi list after install");
		assert.match(listed.stdout, /User packages:/);
		assertExpectedPackageCommands(rpcCommands([], isolated.env));

		const removed = runPi(["remove", REPO_ROOT], isolated.env);
		assertPiSuccess(removed, "local package removal");
		const settingsAfter = JSON.parse(
			await readFile(join(isolated.configDir, "settings.json"), "utf8"),
		) as Record<string, unknown>;
		assert.deepEqual(settingsAfter.packages, []);
		const listedAfter = runPi(["list"], isolated.env);
		assertPiSuccess(listedAfter, "pi list after removal");
		assert.match(listedAfter.stdout, /No packages installed\./);
		assert.deepEqual(rpcCommands([], isolated.env).map((command) => command.name), ["llama"]);
	} finally {
		await rm(isolated.root, { recursive: true, force: true });
	}
	assert.equal(await realPiConfigDigest(), realConfigBefore, "real Pi configuration changed during isolated lifecycle");
});
