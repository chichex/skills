import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	access,
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	writeFile,
} from "node:fs/promises";
import { builtinModules } from "node:module";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

interface PiPackageManifest {
	name?: unknown;
	version?: unknown;
	private?: unknown;
	type?: unknown;
	engines?: unknown;
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
	// package (bare specifier) -> ejemplo de archivo que lo importa. Solo imports
	// externos (no relativos, no builtins de Node) de codigo TRACKEADO en git.
	externalImports: Record<string, string>;
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
	"./pi/herdr-detach/SKILL.md",
	"./pi/issue-triage/SKILL.md",
	"./pi/quick-run/SKILL.md",
	"./pi/repo-clean/SKILL.md",
	"./pi/sdd-init/SKILL.md",
	"./pi/sdd-run/SKILL.md",
	"./pi/sdd-spec/SKILL.md",
	"./pi/tdd/SKILL.md",
];

const EXPECTED_THEMES = ["./pi-themes/claude-code.json"];

// No hay EXPECTED_EXTENSIONS: a diferencia de skills/themes (donde el manifest
// solo declara el directorio "./pi" / "./pi-themes" completo, sin listar
// archivos), el manifest de extensiones YA es una lista explicita por archivo
// (manifest.pi.extensions). Esa lista, comparada directamente contra el arbol
// (inventory.factories, ver validatePiPackage mas abajo), es la unica fuente
// de verdad que hace falta: agregar una tercera constante hardcodeada con el
// mismo contenido solo duplicaba el mantenimiento sin sumar seguridad
// (hallazgo F10 del review de PR #22).

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

// Deteccion de "esto es un entrypoint de extension de Pi" a partir del fuente.
// Cubre las formas de default-export que jiti/Pi aceptan como factory
// (function, async function, arrow, y un identificador que en el propio
// archivo se liga a una funcion) e ignora comentarios y literales de string
// para no confundir texto de ejemplo con codigo real (hallazgo F5 del review
// de PR #22).
//
// stripComments elimina SOLO comentarios (// y /* */) sin tocar el contenido
// de strings/template literals: recorre el fuente caracter a caracter
// llevando el estado string-vs-codigo, en vez de usar una sola regex, porque
// distinguir "// dentro de un string" (p.ej. un specifier de import como
// "http://algo") de "// que abre un comentario" no se puede resolver bien
// con una regex simple. Limitacion conocida y aceptada: no distingue un
// literal de regex (`/algo/g`) de un comentario si aparece pegado a otro
// `/` fuera de contexto de string — no ocurre en el estilo de este repo (sin
// regex literales en posicion de module specifier).
//
// externalImportPeers (mas abajo) usa stripComments a secas: el contenido
// del string ES el module specifier que necesita leer, y vaciarlo lo rompe
// (bug real detectado en review: la primera version de este fix reusaba
// stripCommentsAndStringLiterals -que vacia strings- para el censo de
// imports, asi que "zod" en `import { z } from "zod"` quedaba vaciado ANTES
// de que IMPORT_SPECIFIER lo viera, y el censo devolvia {} siempre, para
// cualquier archivo). hasFactoryExport, en cambio, SI quiere vaciar strings
// ademas de sacar comentarios (para no confundir un ejemplo de codigo dentro
// de un string/template con una factory real) — por eso compone
// stripCommentsAndStringLiterals = stripComments + blanqueo de strings,
// aplicado en ESE orden para no tener que lidiar con comentarios dentro de
// strings en la misma pasada (hallazgo F3 del review de PR #22).
function stripComments(source: string): string {
	let out = "";
	let i = 0;
	const n = source.length;
	while (i < n) {
		const ch = source[i];
		const next = source[i + 1];
		if (ch === "/" && next === "/") {
			while (i < n && source[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i = Math.min(i + 2, n);
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			out += ch;
			i++;
			while (i < n && source[i] !== quote) {
				if (source[i] === "\\" && i + 1 < n) {
					out += source[i] + source[i + 1];
					i += 2;
					continue;
				}
				out += source[i];
				i++;
			}
			if (i < n) {
				out += source[i];
				i++;
			}
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

function stripCommentsAndStringLiterals(source: string): string {
	return stripComments(source)
		.replace(/`(?:\\.|[^`\\])*`/g, "``")
		.replace(/"(?:\\.|[^"\\])*"/g, '""')
		.replace(/'(?:\\.|[^'\\])*'/g, "''");
}

const DEFAULT_EXPORT_FUNCTION = /^\s*export\s+default\s+(?:async\s+)?function\b/m;
const DEFAULT_EXPORT_ARROW = /^\s*export\s+default\s+(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m;
const DEFAULT_EXPORT_IDENTIFIER = /^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m;

function bindsFunctionValue(source: string, name: string): boolean {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`\\b(?:const|let|var)\\s+${escaped}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?` +
			`(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|[A-Za-z_$][\\w$]*\\s*=>)` +
			`|\\bfunction\\s+${escaped}\\s*\\(`,
	);
	return pattern.test(source);
}

function hasFactoryExport(rawSource: string): boolean {
	const source = stripCommentsAndStringLiterals(rawSource);
	if (DEFAULT_EXPORT_FUNCTION.test(source)) return true;
	if (DEFAULT_EXPORT_ARROW.test(source)) return true;
	const identifierMatch = source.match(DEFAULT_EXPORT_IDENTIFIER);
	return identifierMatch ? bindsFunctionValue(source, identifierMatch[1]) : false;
}

// Archivos trackeados por git bajo pi/, pi-extensions/ y pi-themes/: es lo que
// realmente shippea con el paquete (lo que `pi install git:...` clona), no
// necesariamente lo que haya en el working tree de un dev (scratch files,
// WIP sin agregar). Si git no esta disponible, no filtra nada (degrada al
// comportamiento anterior en vez de romper la suite) (hallazgo F9 del review
// de PR #22).
function gitTrackedPackagePaths(): Set<string> | null {
	const result = spawnSync("git", ["ls-files", "--", "pi", "pi-extensions", "pi-themes"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
	if (result.error || result.status !== 0) return null;
	return new Set(
		result.stdout
			.split("\n")
			.filter(Boolean)
			.map((relPath) => `./${relPath}`),
	);
}

// Peers derivados de los imports reales de codigo de produccion trackeado,
// en vez de una lista de peers hardcodeada que nunca lee los fuentes: un
// import externo nuevo (p.ej. "zod") tiene que aparecer aca para que
// validatePiPackage lo exija en peerDependencies (hallazgo F3 del review de
// PR #22). No intenta ser un parser JS/TS: es una heuristica de regex, igual
// que hasFactoryExport arriba.
const IMPORT_SPECIFIER =
	/\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm;

function packageNameFromSpecifier(spec: string): string {
	return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec);
}

async function externalImportPeers(paths: string[]): Promise<Record<string, string>> {
	const found: Record<string, string> = {};
	for (const path of paths) {
		const source = stripComments(await readFile(repoPath(path.slice(2)), "utf8"));
		for (const match of source.matchAll(IMPORT_SPECIFIER)) {
			const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
			if (!spec || spec.startsWith(".") || spec.startsWith("/")) continue;
			const bareBuiltin = spec.startsWith("node:") ? spec.slice("node:".length) : spec;
			if (spec.startsWith("node:") || builtinModules.includes(bareBuiltin)) continue;
			const pkg = packageNameFromSpecifier(spec);
			if (!(pkg in found)) found[pkg] = path;
		}
	}
	return found;
}

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
	const tracked = gitTrackedPackagePaths();
	const isTracked = (path: string) => tracked === null || tracked.has(path);

	const skills = (await walkFiles(repoPath("pi")))
		.filter((path) => path.endsWith(`${sep}SKILL.md`))
		.map(packagePath)
		.filter(isTracked)
		.sort();
	const themes = (await readdir(repoPath("pi-themes"), { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => packagePath(repoPath(`pi-themes/${entry.name}`)))
		.filter(isTracked)
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
	const trackedCandidates = factoryCandidates.filter(isTracked).sort();

	const factories: string[] = [];
	for (const path of trackedCandidates) {
		if (hasFactoryExport(await readFile(repoPath(path.slice(2)), "utf8"))) factories.push(path);
	}

	const allSourceFiles = (await walkFiles(repoPath("pi-extensions")))
		.filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
		.map(packagePath)
		.filter(isTracked)
		.sort();
	const externalImports = await externalImportPeers(allSourceFiles);

	return { skills, themes, factoryCandidates: trackedCandidates, factories, externalImports };
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
	// Un import externo nuevo (p.ej. `import { z } from "zod"`) tiene que
	// declararse como peer; si no, el manifest queda incompleto y `pi install`
	// instala un paquete que va a explotar al cargar la extension que lo usa.
	for (const pkg of Object.keys(inventory.externalImports).sort()) {
		const declared = isRecord(manifest.peerDependencies) && Object.hasOwn(manifest.peerDependencies, pkg);
		if (!declared) {
			problems.push(
				`peerDependencies: missing declared peer for import ${pkg} (used in ${inventory.externalImports[pkg]})`,
			);
		}
	}

	comparePaths("skill census", EXPECTED_SKILLS, inventory.skills, problems);
	comparePaths("theme census", EXPECTED_THEMES, inventory.themes, problems);

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
		if (extensions.join("\n") !== inventory.factories.join("\n")) {
			problems.push("manifest extensions: paths must be sorted and match the tree exactly");
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

// 60s (en vez de los 30s originales) da margen a runners frios/lentos antes
// de que Node mate el proceso: con 30s, un `pi install` lento en CI devolvia
// status=null/signal=SIGTERM y assertPiSuccess lo reportaba como "failed"
// indistinguible de un fallo real de Pi (hallazgo F14 del review de PR #22).
function runPi(args: string[], env: NodeJS.ProcessEnv, input?: string, timeout = 60_000) {
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
		timedOut: result.status === null && result.signal === "SIGTERM",
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function assertPiSuccess(result: ReturnType<typeof runPi>, operation: string): void {
	const timeoutHint = result.timedOut
		? " (status=null + signal=SIGTERM usually means runPi's timeout fired, not a real Pi failure — consider a slower runner or a larger timeout)"
		: "";
	assert.equal(
		result.status,
		0,
		`${operation} failed${timeoutHint} (signal=${result.signal ?? "none"})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
}

// Los probes nativos (RPC, lifecycle) necesitan el binario `pi` en PATH. Antes
// de este chequeo, correr `node --test pi-extensions/*/*.test.ts` sin Pi
// instalado hacia que `spawnSync("pi", ...)` devolviera ENOENT y runPi lo
// relanzara como excepcion cruda, rompiendo la suite entera para cualquier
// contribuidor sin Pi — CI instala Pi aparte, así que esos probes siguen
// corriendo ahí (hallazgo F4 del review de PR #22).
function detectPiAvailable(): boolean {
	const probe = spawnSync("pi", ["--version"], { encoding: "utf8" });
	return !probe.error && probe.status === 0;
}
const PI_AVAILABLE = detectPiAvailable();

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
	// Deliberadamente NO incluye "npm" ni "packages": en una maquina real esos
	// arboles contienen los node_modules de paquetes instalados (decenas de
	// miles de archivos), y ninguno de los tres comandos que este isolation
	// check rodea (`pi install <local-path>`, `pi list`, `pi remove`) los toca
	// — solo escriben/leen settings.json (y, para specs Git, "git", que sí
	// sigue incluido). Hashearlos dos veces por corrida era carísimo sin sumar
	// cobertura real (hallazgo F6 del review de PR #22).
	const trackedEntries = [
		"auth.json",
		"extensions",
		"git",
		"models.json",
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

async function absolutePathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

async function fileTree(root: string): Promise<string[]> {
	if (!await absolutePathExists(root)) return [];
	const entries: string[] = [];
	for (const path of await walkFiles(root)) {
		entries.push(`${relative(root, path).split(sep).join("/")}\0${await readFile(path, "utf8")}`);
	}
	return entries.sort();
}

function runInstaller(script: string, args: string[], env: NodeJS.ProcessEnv) {
	const result = spawnSync("bash", [script, ...args], {
		env: { ...process.env, ...env },
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		timeout: 30_000,
	});
	if (result.error) throw result.error;
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

async function seedManagedPath(source: string, destination: string): Promise<void> {
	const info = await lstat(source);
	if (info.isDirectory()) {
		await mkdir(destination, { recursive: true });
		await writeFile(join(destination, "managed-marker"), "managed\n");
		return;
	}
	await mkdir(resolve(destination, ".."), { recursive: true });
	await writeFile(destination, "managed\n");
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
	// >=22.19.0 es el engine que declara @earendil-works/pi-coding-agent: como el
	// package se consume via `pi install`, no tiene sentido pedir mas que Pi. El piso
	// propio del repo es 22.18.0 (type stripping nativo sin flag); suite verificada
	// en 22.18.0, 22.23.2, 24.19.0 y 26.4.0 — 22.17.1 y 20.x fallan al cargar los .ts.
	assert.deepEqual(manifest.engines, { node: ">=22.19.0" });
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
	(withoutExtension.pi as Record<string, unknown>).extensions = inventory.factories.slice(1);
	assert.ok(
		validatePiPackage(withoutExtension, inventory).some(
			(problem) => problem === `manifest extensions: missing ${inventory.factories[0]}`,
		),
	);

	const withHelper = structuredClone(manifest);
	(withHelper.pi as Record<string, unknown>).extensions = [
		...inventory.factories,
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

test("inventory gate flags a production import with no declared peer dependency", async () => {
	// OJO: esto prueba SOLO la capa de reporte (validatePiPackage), inyectando
	// el resultado directo en el inventory en vez de pasar por
	// externalImportPeers(). Por eso NO hubiera detectado el bug real de
	// review (externalImportPeers devolvia {} siempre por vaciar los strings
	// antes de leerlos) — ese camino lo cubre el test de abajo,
	// "externalImportPeers reads real imports from disk...", que llama a la
	// funcion real sobre un archivo real en disco.
	const manifest = await readManifest();
	const inventory = await productionInventory();

	const withUndeclaredImport = {
		...inventory,
		externalImports: { ...inventory.externalImports, zod: "./pi-extensions/warp-status.ts" },
	};
	assert.deepEqual(
		validatePiPackage(manifest, withUndeclaredImport).filter((problem) => problem.startsWith("peerDependencies:")),
		["peerDependencies: missing declared peer for import zod (used in ./pi-extensions/warp-status.ts)"],
	);
});

test("externalImportPeers reads real imports from disk, ignoring comments but not string module specifiers", async () => {
	// Regression del bug real detectado en review: la primera version de este
	// fix reusaba stripCommentsAndStringLiterals (que vacia el CONTENIDO de
	// los strings) para el censo de imports, asi que `import { z } from
	// "zod"` perdia el specifier "zod" ANTES de que IMPORT_SPECIFIER lo
	// viera, y externalImportPeers devolvia {} siempre, para cualquier
	// archivo — el test de arriba no lo detectaba porque inyecta el
	// resultado en vez de llamar a la funcion real. Este SI escribe un
	// archivo real en disco (dentro del arbol censado, no trackeado — se
	// borra al final) y llama a externalImportPeers de verdad, para que un
	// futuro cambio que rompa el parser ponga esto en rojo.
	const scratchAbsolute = repoPath("pi-extensions/.chichex-test-scratch-external-import.ts");
	const scratchRelative = packagePath(scratchAbsolute);
	try {
		await writeFile(
			scratchAbsolute,
			[
				'// example only, not a real import: import { fake } from "not-a-real-package";',
				'/* also fake: import x from "still-not-real"; */',
				'import { z } from "zod";',
				'import { readFile } from "node:fs/promises";',
				'import "./local-sibling.ts";',
				"",
			].join("\n"),
			"utf8",
		);
		const found = await externalImportPeers([scratchRelative]);
		assert.deepEqual(found, { zod: scratchRelative });
	} finally {
		await rm(scratchAbsolute, { force: true });
	}
});

test("productionInventory excludes untracked scratch files from the factory census", async () => {
	// Regression guard in the same spirit as the externalImportPeers test
	// above: writes a REAL untracked .ts file with a valid factory export
	// under pi-extensions/ (deliberately not `git add`-ed) and asserts it is
	// excluded from both gitTrackedPackagePaths() and the real
	// productionInventory() census. If gitTrackedPackagePaths() ever
	// regresses to a silent no-op (e.g. always returning null, or building
	// an empty/wrong set), this untracked file would leak into
	// inventory.factories and this test goes red — matching the F9 scenario
	// from the review (a WIP scratch file breaking the gate for local devs
	// is the inverse failure mode this guards against not regressing back
	// into "untracked files always counted").
	const scratchAbsolute = repoPath("pi-extensions/.chichex-test-scratch-untracked-factory.ts");
	const scratchRelative = packagePath(scratchAbsolute);
	try {
		await writeFile(scratchAbsolute, "export default function (pi) {\n\treturn {};\n}\n", "utf8");

		const tracked = gitTrackedPackagePaths();
		assert.ok(tracked, "this checkout must have git available for the test to be meaningful");
		assert.equal(tracked.has(scratchRelative), false, "scratch file must not be reported as git-tracked");

		const inventory = await productionInventory();
		assert.equal(inventory.factoryCandidates.includes(scratchRelative), false);
		assert.equal(inventory.factories.includes(scratchRelative), false);
	} finally {
		await rm(scratchAbsolute, { force: true });
	}
});

test("factory export detection recognizes function/async/arrow/const default exports and ignores comments and string literals", () => {
	const positive = [
		"export default function (pi) {}",
		"export default async function (pi) {}",
		"export default (pi) => {};",
		"export default async (pi) => {};",
		"export default pi => {};",
		"const factory = (pi) => {};\nexport default factory;",
		"const factory = async (pi) => {};\nexport default factory;",
		"async function factory(pi) {}\nexport default factory;",
		"function factory(pi) {}\nexport default factory;",
	];
	for (const source of positive) {
		assert.equal(hasFactoryExport(source), true, `expected factory export in: ${source}`);
	}

	const negative = [
		"export default 42;",
		"const notAFactory = 42;\nexport default notAFactory;",
		'// export default function (pi) {}\nexport default 42;',
		'const note = "export default function (pi) {}";\nexport default 42;',
		"const doc = `Example: export default function (pi) {}`;\nexport default 42;",
	];
	for (const source of negative) {
		assert.equal(hasFactoryExport(source), false, `did not expect factory export in: ${source}`);
	}
});

test("temporary package load exposes exactly the approved commands and theme", async (t) => {
	if (!PI_AVAILABLE) {
		t.skip("`pi` no está en PATH; se saltea el probe nativo (CI lo instala aparte)");
		return;
	}
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

// Los asserts de este test (wording de `pi list`, y que "llama" sea el UNICO
// comando built-in con cero paquetes) acoplan a la version de Pi que corre
// contra el binario en PATH. En CI eso es la version pineada en
// .github/workflows/ci.yml (`@earendil-works/pi-coding-agent@X.Y.Z`); si se
// sube ese pin y estos asserts empiezan a fallar, lo mas probable es que Pi
// haya cambiado el wording de `list` o agregado un comando built-in — hay
// que actualizar ambos juntos, no es un defecto de este repo (hallazgo F14
// del review de PR #22).
test("native local install, discovery, deduplication, and removal stay isolated", async (t) => {
	if (!PI_AVAILABLE) {
		t.skip("`pi` no está en PATH; se saltea el probe nativo (CI lo instala aparte)");
		return;
	}
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
	assert.equal(
		await realPiConfigDigest(),
		realConfigBefore,
		"real Pi configuration changed during isolated lifecycle (or a concurrent Pi session touched ~/.pi/agent while this test ran)",
	);
});

test("Pi cleanup requires exact confirmation, never pulls, and removes only managed copies", async () => {
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-clean-"));
	const fixtureRepo = join(root, "repo");
	const fakeBin = join(root, "bin");
	const skillsDest = join(root, "dest", "skills");
	const extensionsDest = join(root, "dest", "extensions");
	const themesDest = join(root, "dest", "themes");
	const gitMarker = join(root, "git-called");
	try {
		await mkdir(join(fixtureRepo, ".git"), { recursive: true });
		await mkdir(fakeBin, { recursive: true });
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));
		await writeFile(
			join(fakeBin, "git"),
			"#!/bin/sh\nprintf called > \"$GIT_MARKER\"\nexit 97\n",
		);
		await chmod(join(fakeBin, "git"), 0o755);

		const managedSkills = (await readdir(repoPath("pi"), { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		const managedExtensions = (await readdir(repoPath("pi-extensions")))
			.sort();
		const managedThemes = (await readdir(repoPath("pi-themes"), { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => entry.name)
			.sort();

		for (const name of managedSkills) {
			await mkdir(join(fixtureRepo, "pi", name), { recursive: true });
			await seedManagedPath(repoPath(`pi/${name}`), join(skillsDest, name));
		}
		for (const name of managedExtensions) {
			await seedManagedPath(repoPath(`pi-extensions/${name}`), join(fixtureRepo, "pi-extensions", name));
			await seedManagedPath(repoPath(`pi-extensions/${name}`), join(extensionsDest, name));
		}
		for (const name of managedThemes) {
			await mkdir(join(fixtureRepo, "pi-themes"), { recursive: true });
			await writeFile(join(fixtureRepo, "pi-themes", name), "{}\n");
			await seedManagedPath(repoPath(`pi-themes/${name}`), join(themesDest, name));
		}
		await mkdir(join(skillsDest, "foreign-skill"), { recursive: true });
		await writeFile(join(skillsDest, "foreign-skill", "keep"), "foreign\n");
		await writeFile(join(extensionsDest, "foreign-extension.ts"), "foreign\n");
		await writeFile(join(themesDest, "foreign-theme.json"), "foreign\n");

		// F2 regression: simula un nombre que un install.sh anterior instaló y
		// que la version ACTUAL del checkout ya renombró/eliminó. Sin el
		// manifest (.chichex-skills-managed), un clean derivado solo del árbol
		// fuente actual nunca ve estos nombres y los deja huérfanos.
		const orphanSkill = "legacy-orphan-skill";
		const orphanExtension = "legacy-orphan-extension.ts";
		const orphanTheme = "legacy-orphan-theme.json";
		await mkdir(join(skillsDest, orphanSkill), { recursive: true });
		await writeFile(join(skillsDest, orphanSkill, "SKILL.md"), "legacy\n");
		await writeFile(join(skillsDest, ".chichex-skills-managed"), `${orphanSkill}\n`);
		await writeFile(join(extensionsDest, orphanExtension), "legacy\n");
		await writeFile(join(extensionsDest, ".chichex-skills-managed"), `${orphanExtension}\n`);
		await writeFile(join(themesDest, orphanTheme), "{}\n");
		await writeFile(join(themesDest, ".chichex-skills-managed"), `${orphanTheme}\n`);

		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: skillsDest,
			PI_EXTENSIONS_DIR: extensionsDest,
			PI_THEMES_DIR: themesDest,
			PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
			GIT_MARKER: gitMarker,
		};
		const before = await fileTree(join(root, "dest"));
		const unconfirmed = runInstaller(join(fixtureRepo, "install.sh"), ["pi-clean"], env);
		assert.equal(unconfirmed.status, 2, `${unconfirmed.stdout}\n${unconfirmed.stderr}`);
		assert.match(`${unconfirmed.stdout}\n${unconfirmed.stderr}`, /pi-clean --confirm/);
		assert.deepEqual(await fileTree(join(root, "dest")), before, "unconfirmed cleanup mutated a destination");
		assert.equal(await absolutePathExists(gitMarker), false, "cleanup attempted git pull before confirmation");

		const confirmed = runInstaller(join(fixtureRepo, "install.sh"), ["pi-clean", "--confirm"], env);
		assert.equal(confirmed.status, 0, `${confirmed.stdout}\n${confirmed.stderr}`);
		assert.match(confirmed.stdout, /Limpieza Pi/);
		assert.equal(await absolutePathExists(gitMarker), false, "confirmed cleanup attempted git pull");
		for (const name of managedSkills) assert.equal(await absolutePathExists(join(skillsDest, name)), false, name);
		for (const name of managedExtensions) {
			assert.equal(await absolutePathExists(join(extensionsDest, name)), false, name);
		}
		for (const name of managedThemes) assert.equal(await absolutePathExists(join(themesDest, name)), false, name);
		assert.equal(await readFile(join(skillsDest, "foreign-skill", "keep"), "utf8"), "foreign\n");
		assert.equal(await readFile(join(extensionsDest, "foreign-extension.ts"), "utf8"), "foreign\n");
		assert.equal(await readFile(join(themesDest, "foreign-theme.json"), "utf8"), "foreign\n");

		// F2: los nombres huérfanos (renombrados/eliminados upstream, pero
		// registrados en el manifest de una instalación previa) también deben
		// desaparecer, y el manifest se "olvida" tras una limpieza completa.
		assert.equal(await absolutePathExists(join(skillsDest, orphanSkill)), false, "orphaned skill must be cleaned");
		assert.equal(
			await absolutePathExists(join(extensionsDest, orphanExtension)),
			false,
			"orphaned extension must be cleaned",
		);
		assert.equal(await absolutePathExists(join(themesDest, orphanTheme)), false, "orphaned theme must be cleaned");
		assert.equal(
			await absolutePathExists(join(skillsDest, ".chichex-skills-managed")),
			false,
			"manifest must be forgotten after a full clean",
		);

		const repeated = runInstaller(join(fixtureRepo, "install.sh"), ["pi-clean", "--confirm"], env);
		assert.equal(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);
		assert.equal(await absolutePathExists(gitMarker), false, "idempotent cleanup attempted git pull");
		assert.equal(await readFile(join(extensionsDest, "foreign-extension.ts"), "utf8"), "foreign\n");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("install.sh refuses to lay down legacy Pi copies when the native Pi Package is already registered", async () => {
	// F1 regression: `./install.sh pi` / `all` used to silently recreate the
	// legacy copies the README now says must never coexist with the native
	// Pi Package. This fakes `pi list` (read-only, no mutation) to report the
	// package as already installed and asserts install_pi refuses instead.
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-conflict-"));
	const fixtureRepo = join(root, "repo");
	const fakeBin = join(root, "bin");
	const skillsDest = join(root, "dest", "skills");
	try {
		await mkdir(join(fixtureRepo, "pi", "grill"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi", "grill", "SKILL.md"), "---\nname: grill\n---\n");
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));
		await mkdir(fakeBin, { recursive: true });
		await writeFile(
			join(fakeBin, "pi"),
			"#!/bin/sh\n" +
				'if [ "$1" = "list" ]; then\n' +
				"  printf 'User packages:\\n  git:github.com/chichex/skills\\n    /cache/path\\n'\n" +
				"  exit 0\n" +
				"fi\n" +
				"exit 0\n",
		);
		await chmod(join(fakeBin, "pi"), 0o755);

		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: skillsDest,
			PI_EXTENSIONS_DIR: join(root, "dest", "extensions"),
			PI_THEMES_DIR: join(root, "dest", "themes"),
			PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
		};

		const result = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], env);
		assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
		assert.match(`${result.stdout}${result.stderr}`, /Pi Package nativo.*ya está instalado/is);
		assert.equal(
			await absolutePathExists(skillsDest),
			false,
			"install_pi must not copy anything when a native package is already registered",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("install.sh proceeds with legacy Pi copies when no `pi` binary is on PATH", async () => {
	// Contributors without Pi installed must keep getting the old behaviour:
	// the conflict guard degrades to "no conflict" rather than blocking them.
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-no-pi-binary-"));
	const fixtureRepo = join(root, "repo");
	const skillsDest = join(root, "dest", "skills");
	try {
		await mkdir(join(fixtureRepo, "pi", "grill"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi", "grill", "SKILL.md"), "---\nname: grill\n---\n");
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));

		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: skillsDest,
			PI_EXTENSIONS_DIR: join(root, "dest", "extensions"),
			PI_THEMES_DIR: join(root, "dest", "themes"),
			// PATH POSIX minimo (bash, basename, mkdir, etc.) sin ningun `pi`:
			// pi_native_package_conflict debe degradar a "no hay conflicto",
			// no romper el install.
			PATH: "/usr/bin:/bin",
		};

		const result = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], env);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		assert.equal(await absolutePathExists(join(skillsDest, "grill")), true, "install must proceed without `pi` on PATH");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Pi cleanup warns instead of silently succeeding when a source directory is missing and nothing was ever installed", async () => {
	// F15 regression: unlike install_set/install_extensions/install_themes,
	// clean_pi used to return 0 with no warning at all when pi/, pi-extensions/
	// or pi-themes/ were missing from the checkout (e.g. a partial clone).
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-clean-partial-"));
	const fixtureRepo = join(root, "repo");
	const skillsDest = join(root, "dest", "skills");
	try {
		await mkdir(fixtureRepo, { recursive: true });
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));
		await mkdir(skillsDest, { recursive: true });

		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: skillsDest,
			PI_EXTENSIONS_DIR: join(root, "dest", "extensions"),
			PI_THEMES_DIR: join(root, "dest", "themes"),
			PATH: process.env.PATH ?? "",
		};
		const result = runInstaller(join(fixtureRepo, "install.sh"), ["pi-clean", "--confirm"], env);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		const combined = `${result.stdout}\n${result.stderr}`;
		assert.match(combined, /no existe .*[/\\]pi en el repo/);
		assert.match(combined, /no existe .*pi-extensions en el repo/);
		assert.match(combined, /no existe .*pi-themes en el repo/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Pi cleanup reconciles the Codex managed skill-precedence block instead of leaving it pointing at deleted paths", async () => {
	// F8 regression: clean_pi deleted $PI_DEST/<skill> but never touched the
	// Codex managed block in config.toml, leaving [[skills.config]] entries
	// pointing at files it had just removed.
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-clean-codex-"));
	const fixtureRepo = join(root, "repo");
	const skillsDest = join(root, "dest", "skills");
	const codexConfig = join(root, "codex", "config.toml");
	try {
		await mkdir(join(fixtureRepo, "pi", "grill"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi", "grill", "SKILL.md"), "---\nname: grill\n---\n");
		await mkdir(join(fixtureRepo, "codex", "grill"), { recursive: true });
		await writeFile(join(fixtureRepo, "codex", "grill", "SKILL.md"), "---\nname: grill\n---\n");
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));

		await mkdir(join(skillsDest, "grill"), { recursive: true });
		await writeFile(join(skillsDest, "grill", "SKILL.md"), "installed\n");
		await writeFile(join(skillsDest, ".chichex-skills-managed"), "grill\n");

		await mkdir(join(root, "codex"), { recursive: true });
		await writeFile(
			codexConfig,
			[
				"# >>> chichex/skills: prefer Codex over Pi >>>",
				"# Administrado por install.sh. Codex no fusiona skills con el mismo name.",
				"",
				"[[skills.config]]",
				`path = "${join(skillsDest, "grill", "SKILL.md")}"`,
				"enabled = false",
				"# <<< chichex/skills: prefer Codex over Pi <<<",
				"",
			].join("\n"),
		);

		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: skillsDest,
			PI_EXTENSIONS_DIR: join(root, "dest", "extensions"),
			PI_THEMES_DIR: join(root, "dest", "themes"),
			CODEX_CONFIG_FILE: codexConfig,
			PATH: process.env.PATH ?? "",
		};
		const result = runInstaller(join(fixtureRepo, "install.sh"), ["pi-clean", "--confirm"], env);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		const configAfter = await readFile(codexConfig, "utf8");
		assert.doesNotMatch(configAfter, /\[\[skills\.config\]\]/, "dead skills.config entries must be reconciled away");
		assert.match(configAfter, /chichex\/skills: prefer Codex over Pi/, "managed block markers must remain");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function assertNativePackageDocumentation(document: string): void {
	for (const literal of [
		"pi install git:github.com/chichex/skills",
		"pi install git:github.com/chichex/skills -l",
		"pi update --extensions",
		"pi remove git:github.com/chichex/skills",
		"./install.sh pi-clean --confirm",
		"pi --use-theme claude-code",
		".sdd/specs",
		".sdd/grills",
	]) {
		assert.ok(document.includes(literal), `missing package documentation: ${literal}`);
	}
	assert.match(document, /git:github\.com\/chichex\/skills@<[^>]+>/);
}

test("Spanish and English READMEs document the safe native package lifecycle", async () => {
	const spanish = await readFile(repoFile("README.md"), "utf8");
	const english = await readFile(repoFile("README.en.md"), "utf8");
	assertNativePackageDocumentation(spanish);
	assertNativePackageDocumentation(english);

	assert.match(spanish, /revis[aá].*(c[oó]digo|fuente).*antes de instalar/is);
	assert.match(spanish, /no mantengas.*Pi Package.*install\.sh pi/is);
	assert.match(spanish, /pin.*no avanz/is);
	assert.match(spanish, /global.*por defecto.*-l.*local/is);
	assert.match(spanish, /legacy|manual/is);

	assert.match(english, /review.*source.*before install/is);
	assert.match(english, /do not keep.*Pi Package.*install\.sh pi/is);
	assert.match(english, /pin.*do not advance/is);
	assert.match(english, /global.*by default.*-l.*local/is);
	assert.match(english, /legacy|manual/is);
});

test("autonomy contract and CI expose the verified Pi 0.84.2 package harness", async () => {
	const contract = await readFile(repoFile(".sdd/project.md"), "utf8");
	const workflow = await readFile(repoFile(".github/workflows/ci.yml"), "utf8");

	assert.doesNotMatch(contract, /no hay `package\.json`/);
	assert.match(contract, /package\.json.*Pi Package/is);
	assert.match(contract, /Pi `0\.84\.2`/);
	assert.match(contract, /node --test pi-extensions\/pi-package\/pi-package\.test\.ts/);
	assert.match(contract, /HOME.*PI_CODING_AGENT_DIR.*tempor/is);
	assert.match(contract, /## Politicas de generacion\nSin politicas activas\./);
	assert.match(contract, /## Decisiones humanas\n/);
	assert.match(workflow, /@earendil-works\/pi-coding-agent@0\.84\.2/);
});
