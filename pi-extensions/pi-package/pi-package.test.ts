import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	access,
	chmod,
	copyFile,
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	symlink,
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
	description?: string;
}

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const EXPECTED_PEERS = {
	"@earendil-works/pi-agent-core": "*",
	"@earendil-works/pi-ai": "*",
	"@earendil-works/pi-coding-agent": "*",
	"@earendil-works/pi-tui": "*",
	typebox: "*",
};

const EXPECTED_SKILLS = [
	"./pi/chiche-init/SKILL.md",
	"./pi/chiche-land/SKILL.md",
	"./pi/chiche-run/SKILL.md",
	"./pi/chiche-spec/SKILL.md",
	"./pi/code-review/SKILL.md",
	"./pi/coding-policies/SKILL.md",
	"./pi/design-system/SKILL.md",
	"./pi/grill/SKILL.md",
	"./pi/issue-triage/SKILL.md",
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
	"chiche-run",
	"grill",
	"grills",
	"issues",
	"llama",
	"prs",
	"specs",
	"subagents",
	"visual-footer",
];

// Las cuatro etapas que renombró el issue #103: cada una existe solo como
// `chiche-<etapa>`; los alias `sdd-<etapa>` se retiraron en 4.0.0 (CA-22).
const RENAMED_STAGES = ["init", "spec", "run", "land"] as const;

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
		problems.push("peerDependencies: expected the five Pi core peers at range *");
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
			if (/\.test\.ts$|\/lib\/|\/chiche-artifacts\/|\/workflow-resolution\//.test(path)) {
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
	assertRetiredAliasesAbsent(commands);
}

// Issue #103, CA-22: get_commands expone `skill:chiche-*` y ninguna descripción
// de alias. Que no haya `skill:sdd-*` ni `/sdd-run` (y que sean 10 de extensión
// y 10 de skill) ya lo fija el deepEqual de los nombres de arriba.
function assertRetiredAliasesAbsent(commands: PiCommand[]): void {
	const byName = new Map(commands.map((command) => [command.name, command]));
	for (const stage of RENAMED_STAGES) {
		assert.equal(byName.get(`skill:chiche-${stage}`)?.source, "skill", `skill:chiche-${stage} falta en get_commands`);
	}
	assert.equal(byName.get("chiche-run")?.source, "extension");
	for (const command of commands) assert.doesNotMatch(command.description ?? "", /^alias deprecado de /, `${command.name} no es un alias`);
}

test("package manifest is deterministic, Git-only, and non-publishable", async () => {
	const manifest = await readManifest();

	assert.equal(manifest.name, "chiche");
	// VERSION es la fuente; scripts/version.sh exige el mismo valor en CI.
	assert.equal(manifest.version, (await readFile(repoFile("VERSION"), "utf8")).trim());
	assert.equal(manifest.private, true);
	assert.equal(manifest.type, "module");
	// >=22.19.0 es el engine que declara @earendil-works/pi-coding-agent: como el
	// package se consume via `pi install`, no tiene sentido pedir mas que Pi. El piso
	// propio del repo es 22.18.0 (type stripping nativo sin flag); suite verificada
	// en 22.18.0, 22.23.2, 24.19.0 y 26.4.0 — 22.17.1 y 20.x fallan al cargar los .ts.
	assert.deepEqual(manifest.engines, { node: ">=22.19.0" });
	assert.equal(manifest.license, "MIT");
	assert.equal(manifest.repository, "https://github.com/chichex/chiche.git");
	assert.equal(manifest.homepage, "https://github.com/chichex/chiche");
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
		"./pi-extensions/chiche-artifacts/index.ts",
	];
	assert.ok(
		validatePiPackage(withHelper, inventory).some(
			(problem) => problem.includes("helper or test entrypoint rejected ./pi-extensions/chiche-artifacts/index.ts"),
		),
	);

	const publicManifest = { ...manifest, private: false };
	assert.ok(validatePiPackage(publicManifest, inventory).includes("metadata: private must be true"));

	const wrongPeers = { ...manifest, peerDependencies: { ...EXPECTED_PEERS, typebox: "^1" } };
	assert.ok(
		validatePiPackage(wrongPeers, inventory).includes(
			"peerDependencies: expected the five Pi core peers at range *",
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
		// manifest (.chiche-managed), un clean derivado solo del árbol
		// fuente actual nunca ve estos nombres y los deja huérfanos.
		// Issue #103 CA-10: el manifest viejo (.chichex-skills-managed) se lee
		// igual, solo o junto al nuevo, y ambos se olvidan tras la limpieza.
		const orphanSkill = "legacy-orphan-skill";
		const orphanSkillNewManifest = "chiche-orphan-skill";
		const orphanExtension = "legacy-orphan-extension.ts";
		const orphanTheme = "legacy-orphan-theme.json";
		await mkdir(join(skillsDest, orphanSkill), { recursive: true });
		await writeFile(join(skillsDest, orphanSkill, "SKILL.md"), "legacy\n");
		await mkdir(join(skillsDest, orphanSkillNewManifest), { recursive: true });
		await writeFile(join(skillsDest, orphanSkillNewManifest, "SKILL.md"), "legacy\n");
		await writeFile(join(skillsDest, ".chichex-skills-managed"), `${orphanSkill}\n`);
		await writeFile(join(skillsDest, ".chiche-managed"), `${orphanSkillNewManifest}\n`);
		await writeFile(join(extensionsDest, orphanExtension), "legacy\n");
		await writeFile(join(extensionsDest, ".chichex-skills-managed"), `${orphanExtension}\n`);
		await writeFile(join(themesDest, orphanTheme), "{}\n");
		await writeFile(join(themesDest, ".chiche-managed"), `${orphanTheme}\n`);

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
			await absolutePathExists(join(skillsDest, orphanSkillNewManifest)),
			false,
			"orphaned skill listed in .chiche-managed must be cleaned",
		);
		assert.equal(
			await absolutePathExists(join(extensionsDest, orphanExtension)),
			false,
			"orphaned extension must be cleaned",
		);
		assert.equal(await absolutePathExists(join(themesDest, orphanTheme)), false, "orphaned theme must be cleaned");
		for (const dest of [skillsDest, extensionsDest, themesDest]) {
			for (const manifestName of [".chiche-managed", ".chichex-skills-managed"]) {
				assert.equal(
					await absolutePathExists(join(dest, manifestName)),
					false,
					`manifest ${manifestName} must be forgotten after a full clean (${dest})`,
				);
			}
		}

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
		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: skillsDest,
			PI_EXTENSIONS_DIR: join(root, "dest", "extensions"),
			PI_THEMES_DIR: join(root, "dest", "themes"),
			PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
		};

		// Issue #103 CA-10: el repo se renombra a chichex/chiche (capa 4); ambos
		// nombres cuentan como el Pi Package nativo de este repo.
		for (const source of ["git:github.com/chichex/skills", "git:github.com/chichex/chiche"]) {
			await writeFile(
				join(fakeBin, "pi"),
				"#!/bin/sh\n" +
					'if [ "$1" = "list" ]; then\n' +
					`  printf 'User packages:\\n  ${source}\\n    /cache/path\\n'\n` +
					"  exit 0\n" +
					"fi\n" +
					"exit 0\n",
			);
			await chmod(join(fakeBin, "pi"), 0o755);

			const result = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], env);
			assert.notEqual(result.status, 0, `${source}: ${result.stdout}\n${result.stderr}`);
			assert.match(`${result.stdout}${result.stderr}`, /Pi Package nativo.*ya está instalado/is);
			// Issue #103 CA-17: el mensaje nombra el repo actual aunque la fuente registrada sea la vieja.
			assert.match(result.stderr, /El Pi Package nativo \(chichex\/chiche\) ya está instalado/, source);
			// Review #109 (2): la fuente registrada puede ser la vieja, así que el hint remite a lo que muestra `pi list`.
			assert.match(result.stderr, /'pi remove <fuente>' con la fuente que muestra 'pi list'/, source);
			assert.match(result.stderr, /git:github\.com\/chichex\/chiche, o la vieja si instalaste con el nombre anterior del repo/, source);
			assert.equal(
				await absolutePathExists(skillsDest),
				false,
				`install_pi must not copy anything when a native package is already registered (${source})`,
			);
		}
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

		// Issue #103 CA-10: el bloque escrito antes del renombre lleva el
		// rotulo viejo chichex/skills; pi-clean lo reconoce y lo reescribe.
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
		const lines = configAfter.split("\n");
		assert.equal(lines.filter((line) => line === "# >>> chichex/chiche: prefer Codex over Pi >>>").length, 1, "managed block begin must remain, relabeled");
		assert.equal(lines.filter((line) => line === "# <<< chichex/chiche: prefer Codex over Pi <<<").length, 1, "managed block end must remain, relabeled");
		assert.doesNotMatch(configAfter, /chichex\/skills/, "the old chichex/skills block must be replaced, not kept");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("issue #103 CA-23: install.sh pi migrates an old .chichex-skills-managed, prunes the sdd-* copies installed by 2.x (old manifest) and by 3.x (.chiche-managed only), prunes retired extensions and themes, and pi-clean leaves unmanaged ones", async () => {
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-legacy-manifest-"));
	const fixtureRepo = join(root, "repo");
	const skillsDest = join(root, "dest", "skills");
	// El estado que dejaba una 3.x: solo `.chiche-managed`, con los alias sdd-* adentro.
	const skillsDest3x = join(root, "dest", "skills-3x");
	const extensionsDest = join(root, "dest", "extensions");
	const themesDest = join(root, "dest", "themes");
	const sentinel = join(root, "dest", "sentinel");
	try {
		await mkdir(fixtureRepo, { recursive: true });
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));
		await cp(repoPath("pi"), join(fixtureRepo, "pi"), { recursive: true });
		await mkdir(join(fixtureRepo, "pi-extensions"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi-extensions", "live-extension.ts"), "export default () => {};\n");
		await mkdir(join(fixtureRepo, "pi-themes"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi-themes", "live-theme.json"), "{}\n");

		await mkdir(join(root, "dest"), { recursive: true });
		await writeFile(sentinel, "no tocar");
		// Destino de skills como lo dejaba un install.sh 2.x: solo el manifest viejo,
		// con la copia completa de sdd-run y sin `.chiche-managed`.
		await mkdir(join(skillsDest, "retired-skill"), { recursive: true });
		await writeFile(join(skillsDest, "retired-skill", "SKILL.md"), "retirado\n");
		await mkdir(join(skillsDest, "sdd-run", "references"), { recursive: true });
		await writeFile(join(skillsDest, "sdd-run", "SKILL.md"), "---\nname: sdd-run\n---\nDoctrina completa vieja.\n");
		await writeFile(join(skillsDest, "sdd-run", "references", "stale.md"), "viejo\n");
		await mkdir(join(skillsDest, "user-skill"), { recursive: true });
		await writeFile(join(skillsDest, "user-skill", "SKILL.md"), "ajeno\n");
		await writeFile(join(skillsDest, ".chichex-skills-managed"), "retired-skill\nsdd-run\n../sentinel\n");
		// Destino como lo dejaba una 3.x (CA-23): solo `.chiche-managed`, con los cuatro
		// alias sdd-* (copias mínimas), los chiche-* y un skill retirado; sin manifest viejo.
		const aliases = RENAMED_STAGES.map((stage) => `sdd-${stage}`);
		const stages3x = RENAMED_STAGES.map((stage) => `chiche-${stage}`);
		await mkdir(join(skillsDest3x, "retired-skill"), { recursive: true });
		await writeFile(join(skillsDest3x, "retired-skill", "SKILL.md"), "retirado\n");
		for (const alias of aliases) {
			await mkdir(join(skillsDest3x, alias), { recursive: true });
			await writeFile(join(skillsDest3x, alias, "SKILL.md"), `---\nname: ${alias}\ndescription: alias deprecado de ${alias.replace("sdd-", "chiche-")}.\n---\n`);
		}
		for (const name of stages3x) {
			await mkdir(join(skillsDest3x, name), { recursive: true });
			await writeFile(join(skillsDest3x, name, "SKILL.md"), "copia 3.x vieja\n");
		}
		await mkdir(join(skillsDest3x, "user-skill"), { recursive: true });
		await writeFile(join(skillsDest3x, "user-skill", "SKILL.md"), "ajeno\n");
		await writeFile(join(skillsDest3x, ".chiche-managed"), ["retired-skill", ...aliases, ...stages3x, ""].join("\n"));
		// Extensiones y themes se podan al instalar igual que los skills: lo que
		// figura en el manifest viejo y el checkout ya no trae se borra entero.
		// `sdd-artifacts/` es la carpeta que el renombre a chiche-artifacts dejó
		// atrás, con un archivo anidado viejo que no puede sobrevivir.
		await mkdir(extensionsDest, { recursive: true });
		await writeFile(join(extensionsDest, "orphan-extension.ts"), "legacy\n");
		await writeFile(join(extensionsDest, "user-extension.ts"), "ajeno\n");
		await mkdir(join(extensionsDest, "sdd-artifacts", "lib"), { recursive: true });
		await writeFile(join(extensionsDest, "sdd-artifacts", "index.ts"), "export const viejo = true;\n");
		await writeFile(join(extensionsDest, "sdd-artifacts", "lib", "stale.ts"), "viejo\n");
		await mkdir(join(extensionsDest, "user-dir-extension"), { recursive: true });
		await writeFile(join(extensionsDest, "user-dir-extension", "index.ts"), "ajeno\n");
		// Nombres hostiles en el manifest viejo de extensiones: ni la migración
		// los copia ni la poda ni pi-clean los resuelven fuera de su lugar.
		await mkdir(join(extensionsDest, "a"), { recursive: true });
		await writeFile(join(extensionsDest, "a", "b"), "b-ajeno\n");
		await writeFile(
			join(extensionsDest, ".chichex-skills-managed"),
			"orphan-extension.ts\nlive-extension.ts\nsdd-artifacts\n../sentinel\n.\n..\na/b\n\n",
		);
		await mkdir(themesDest, { recursive: true });
		await writeFile(join(themesDest, "orphan-theme.json"), "{}\n");
		await writeFile(join(themesDest, "user-theme.json"), "ajeno\n");
		await writeFile(join(themesDest, ".chichex-skills-managed"), "orphan-theme.json\n../sentinel\n");
		await writeFile(join(themesDest, ".chiche-managed"), "live-theme.json\n");

		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: skillsDest,
			PI_EXTENSIONS_DIR: extensionsDest,
			PI_THEMES_DIR: themesDest,
			// Sin `pi` en PATH: el guard de conflicto degrada a "no hay conflicto".
			PATH: "/usr/bin:/bin",
		};
		const installed = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], env);
		assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);

		assert.equal(await absolutePathExists(join(skillsDest, "retired-skill")), false, "the retired skill from the old manifest is pruned");
		assert.equal(await absolutePathExists(join(skillsDest, "sdd-run")), false, "the 2.x sdd-run copy is pruned whole");
		assert.equal(await absolutePathExists(repoPath("pi/sdd-run")), false, "the checkout no longer ships sdd-run");
		assert.match(installed.stdout, /✗ sdd-run \(retirado del repo, podado\)/);
		for (const name of ["chiche-init", "chiche-spec", "chiche-run", "chiche-land"]) {
			assert.deepEqual(await fileTree(join(skillsDest, name)), await fileTree(repoPath(`pi/${name}`)), `${name} installed`);
		}
		const sourceSkills = (await readdir(repoPath("pi"), { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		const manifestLines = async (dest: string) =>
			(await readFile(join(dest, ".chiche-managed"), "utf8")).split("\n").filter(Boolean).sort();
		assert.deepEqual(await manifestLines(skillsDest), sourceSkills, ".chiche-managed lists exactly the installed skills");
		// Solo queda en el manifest lo que el checkout instala: lo retirado se
		// podó y los nombres hostiles nunca se copiaron.
		assert.deepEqual(await manifestLines(extensionsDest), ["live-extension.ts"]);
		assert.deepEqual(await manifestLines(themesDest), ["live-theme.json"]);
		for (const dest of [skillsDest, extensionsDest, themesDest]) {
			assert.equal(await absolutePathExists(join(dest, ".chichex-skills-managed")), false, `old manifest removed (${dest})`);
		}
		assert.equal(await absolutePathExists(join(extensionsDest, "orphan-extension.ts")), false, "the retired extension file is pruned on install");
		assert.equal(await absolutePathExists(join(extensionsDest, "sdd-artifacts")), false, "the renamed extension directory is pruned whole");
		assert.equal(
			await absolutePathExists(join(extensionsDest, "sdd-artifacts", "lib", "stale.ts")),
			false,
			"no stale nested file survives in the pruned extension directory",
		);
		assert.equal(await absolutePathExists(join(themesDest, "orphan-theme.json")), false, "the retired theme is pruned on install");
		assert.match(installed.stdout, /✗ sdd-artifacts \(retirado del repo, podado\)/);
		assert.match(installed.stdout, /✗ orphan-extension\.ts \(retirado del repo, podado\)/);
		assert.match(installed.stdout, /✗ orphan-theme\.json \(retirado del repo, podado\)/);
		assert.equal(await readFile(join(extensionsDest, "live-extension.ts"), "utf8"), "export default () => {};\n", "live extension installed");
		assert.equal(await readFile(join(themesDest, "live-theme.json"), "utf8"), "{}\n", "live theme installed");
		assert.equal(await readFile(join(skillsDest, "user-skill", "SKILL.md"), "utf8"), "ajeno\n", "unmanaged skill untouched");
		assert.equal(await readFile(join(extensionsDest, "user-extension.ts"), "utf8"), "ajeno\n", "unmanaged extension file untouched");
		assert.equal(await readFile(join(extensionsDest, "user-dir-extension", "index.ts"), "utf8"), "ajeno\n", "unmanaged extension directory untouched");
		assert.equal(await readFile(join(themesDest, "user-theme.json"), "utf8"), "ajeno\n", "unmanaged theme untouched");
		assert.equal(await readFile(join(extensionsDest, "a", "b"), "utf8"), "b-ajeno\n", "the prune ignores a manifest name with a slash");
		assert.equal(await readFile(sentinel, "utf8"), "no tocar", "a hostile name in the old manifest never resolves outside the destination");

		// El destino 3.x (solo `.chiche-managed`): los cuatro alias se podan enteros, los
		// chiche-* viejos se reemplazan, el manifest queda con lo instalado y lo ajeno sobrevive.
		const installed3x = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], { ...env, PI_SKILLS_DIR: skillsDest3x });
		assert.equal(installed3x.status, 0, `${installed3x.stdout}\n${installed3x.stderr}`);
		for (const alias of aliases) {
			assert.equal(await absolutePathExists(join(skillsDest3x, alias)), false, `the 3.x ${alias} alias is pruned`);
			assert.match(installed3x.stdout, new RegExp(`✗ ${alias} \\(retirado del repo, podado\\)`));
		}
		assert.equal(await absolutePathExists(join(skillsDest3x, "retired-skill")), false, "the retired skill of the 3.x manifest is pruned");
		for (const name of stages3x) {
			assert.deepEqual(await fileTree(join(skillsDest3x, name)), await fileTree(repoPath(`pi/${name}`)), `${name} installed over the old 3.x copy`);
		}
		assert.deepEqual(await manifestLines(skillsDest3x), sourceSkills, ".chiche-managed of the 3.x destination lists exactly the installed skills");
		assert.equal(await absolutePathExists(join(skillsDest3x, ".chichex-skills-managed")), false, "no old manifest appears in the 3.x destination");
		assert.equal(await readFile(join(skillsDest3x, "user-skill", "SKILL.md"), "utf8"), "ajeno\n", "unmanaged skill untouched in the 3.x destination");

		// pi-clean sigue borrando solo lo administrado: lo instalado desde el
		// checkout, no lo ajeno ni lo que la poda ya había retirado.
		const cleaned = runInstaller(join(fixtureRepo, "install.sh"), ["pi-clean", "--confirm"], env);
		assert.equal(cleaned.status, 0, `${cleaned.stdout}\n${cleaned.stderr}`);
		assert.equal(await readFile(sentinel, "utf8"), "no tocar", "pi-clean never resolves a hostile manifest name outside the destination");
		assert.equal(await readFile(join(extensionsDest, "a", "b"), "utf8"), "b-ajeno\n", "pi-clean ignores a manifest name with a slash");
		for (const name of sourceSkills) assert.equal(await absolutePathExists(join(skillsDest, name)), false, name);
		assert.equal(await absolutePathExists(join(extensionsDest, "live-extension.ts")), false, "installed extension cleaned");
		assert.equal(await absolutePathExists(join(themesDest, "live-theme.json")), false, "installed theme cleaned");
		assert.equal(await readFile(join(extensionsDest, "user-extension.ts"), "utf8"), "ajeno\n");
		assert.equal(await readFile(join(extensionsDest, "user-dir-extension", "index.ts"), "utf8"), "ajeno\n");
		assert.equal(await readFile(join(themesDest, "user-theme.json"), "utf8"), "ajeno\n");
		assert.equal(await readFile(join(skillsDest, "user-skill", "SKILL.md"), "utf8"), "ajeno\n");
		assert.equal(await readFile(sentinel, "utf8"), "no tocar");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("review #106 (verify A1/A2): install.sh pi prunes managed names with spaces, a leading dash, a glob or a symlink only inside the destination, skips a directory named like a theme, and keeps stderr clean", async () => {
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-prune-shapes-"));
	const repo = join(root, "repo");
	const ext = join(root, "dest", "extensions");
	const themes = join(root, "dest", "themes");
	const outside = join(root, "outside");
	try {
		await mkdir(join(repo, "pi-extensions", "live"), { recursive: true });
		await writeFile(join(repo, "pi-extensions", "live", "index.ts"), "export default () => {};\n");
		await mkdir(join(repo, "pi-themes"), { recursive: true });
		await writeFile(join(repo, "pi-themes", "live-theme.json"), "{}\n");
		await copyFile(repoPath("install.sh"), join(repo, "install.sh"));
		await cp(repoPath("pi"), join(repo, "pi"), { recursive: true });
		await mkdir(join(ext, "old dir", "nested"), { recursive: true });
		await writeFile(join(ext, "old dir", "nested", "f.ts"), "viejo\n");
		await writeFile(join(ext, "-rf"), "viejo\n");
		await writeFile(join(ext, "*"), "viejo\n");
		await writeFile(join(ext, "star-sibling.ts"), "ajeno\n");
		await writeFile(join(ext, "user ext.ts"), "ajeno\n");
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, "keep.txt"), "keep\n");
		await symlink(outside, join(ext, "link-ext"));
		// `-echiche-x` leido como opcion de grep quedaba sin podar (verify A2).
		await writeFile(join(ext, "-elive"), "viejo\n");
		await writeFile(join(ext, ".chiche-managed"), "old dir\n-rf\n*\nlink-ext\n-elive\n");
		// Una carpeta con nombre de theme no es un theme: se saltea sin abortar
		// la instalacion (verify A1: `rm -f` sobre un directorio + set -e).
		await mkdir(join(themes, "old.json", "x"), { recursive: true });
		await writeFile(join(themes, "old.json", "x", "f"), "carpeta\n");
		await writeFile(join(themes, "gone.json"), "{}\n");
		await writeFile(join(themes, ".chiche-managed"), "old.json\ngone.json\n");
		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: join(root, "dest", "skills"),
			PI_EXTENSIONS_DIR: ext,
			PI_THEMES_DIR: themes,
			PATH: "/usr/bin:/bin",
		};
		const installed = runInstaller(join(repo, "install.sh"), ["pi"], env);
		assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
		assert.equal(installed.stderr, "", "a manifest name that looks like a grep option never leaks an error");
		for (const name of ["old dir", "-rf", "*", "link-ext", "-elive"]) {
			assert.equal(await absolutePathExists(join(ext, name)), false, `${name} pruned`);
		}
		assert.equal(await readFile(join(ext, "star-sibling.ts"), "utf8"), "ajeno\n", "a literal * never globs");
		assert.equal(await readFile(join(ext, "user ext.ts"), "utf8"), "ajeno\n");
		assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep\n", "a symlink is unlinked, never followed");
		assert.deepEqual((await readFile(join(ext, ".chiche-managed"), "utf8")).split("\n").filter(Boolean), ["live"]);
		assert.equal(await readFile(join(themes, "old.json", "x", "f"), "utf8"), "carpeta\n", "a directory named like a theme is left alone");
		assert.equal(await absolutePathExists(join(themes, "gone.json")), false, "the retired theme file is pruned");
		assert.deepEqual((await readFile(join(themes, ".chiche-managed"), "utf8")).split("\n").filter(Boolean), ["live-theme.json"]);
		const leftovers = (await readdir(themes)).filter((entry) => entry.startsWith(".chiche-managed."));
		assert.deepEqual(leftovers, [], "no temporary manifest survives");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("issue #103 CA-10: install.sh pi prunes retired extensions and themes from .chiche-managed alone, ignores hostile names, and a second run changes nothing", async () => {
	// Sin manifest viejo que migrar: la poda lee `.chiche-managed` tal cual, así
	// que sus propias guardas (vacío, '/', '.', '..') son las únicas que frenan
	// un nombre hostil.
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-prune-managed-"));
	const fixtureRepo = join(root, "repo");
	const extensionsDest = join(root, "dest", "extensions");
	const themesDest = join(root, "dest", "themes");
	const sentinel = join(root, "dest", "sentinel");
	try {
		await mkdir(join(fixtureRepo, "pi", "grill"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi", "grill", "SKILL.md"), "---\nname: grill\n---\n");
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));
		await mkdir(join(fixtureRepo, "pi-extensions", "live-dir"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi-extensions", "live-dir", "index.ts"), "export default () => {};\n");
		await mkdir(join(fixtureRepo, "pi-themes"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi-themes", "live-theme.json"), "{}\n");

		await mkdir(join(root, "dest"), { recursive: true });
		await writeFile(sentinel, "no tocar");
		await mkdir(join(extensionsDest, "retired-dir", "nested"), { recursive: true });
		await writeFile(join(extensionsDest, "retired-dir", "index.ts"), "viejo\n");
		await writeFile(join(extensionsDest, "retired-dir", "nested", "stale.ts"), "viejo\n");
		await writeFile(join(extensionsDest, "retired-file.ts"), "viejo\n");
		await mkdir(join(extensionsDest, "user-dir"), { recursive: true });
		await writeFile(join(extensionsDest, "user-dir", "index.ts"), "ajeno\n");
		await writeFile(join(extensionsDest, "user-file.ts"), "ajeno\n");
		await mkdir(join(extensionsDest, "a"), { recursive: true });
		await writeFile(join(extensionsDest, "a", "b"), "b-ajeno\n");
		// Un nombre registrado que ya no existe en disco no rompe la poda.
		await writeFile(
			join(extensionsDest, ".chiche-managed"),
			"retired-dir\nretired-file.ts\nnever-on-disk.ts\n../sentinel\n.\n..\na/b\n\nlive-dir\n",
		);
		await mkdir(themesDest, { recursive: true });
		await writeFile(join(themesDest, "retired-theme.json"), "{}\n");
		await writeFile(join(themesDest, "user-theme.json"), "ajeno\n");
		await writeFile(join(themesDest, ".chiche-managed"), "retired-theme.json\n../sentinel\n..\nlive-theme.json\n");

		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: join(root, "dest", "skills"),
			PI_EXTENSIONS_DIR: extensionsDest,
			PI_THEMES_DIR: themesDest,
			// Sin `pi` en PATH: el guard de conflicto degrada a "no hay conflicto".
			PATH: "/usr/bin:/bin",
		};
		const first = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], env);
		assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);

		assert.equal(await absolutePathExists(join(extensionsDest, "retired-dir")), false, "the retired extension directory is pruned whole");
		assert.equal(await absolutePathExists(join(extensionsDest, "retired-file.ts")), false, "the retired extension file is pruned");
		assert.equal(await absolutePathExists(join(themesDest, "retired-theme.json")), false, "the retired theme is pruned");
		assert.match(first.stdout, /✗ retired-dir \(retirado del repo, podado\)/);
		assert.match(first.stdout, /✗ retired-theme\.json \(retirado del repo, podado\)/);
		assert.doesNotMatch(first.stdout, /never-on-disk/, "a registered name that is not on disk is dropped silently");
		assert.equal(await readFile(join(extensionsDest, "user-dir", "index.ts"), "utf8"), "ajeno\n", "unmanaged extension directory untouched");
		assert.equal(await readFile(join(extensionsDest, "user-file.ts"), "utf8"), "ajeno\n", "unmanaged extension file untouched");
		assert.equal(await readFile(join(themesDest, "user-theme.json"), "utf8"), "ajeno\n", "unmanaged theme untouched");
		assert.equal(await readFile(join(extensionsDest, "a", "b"), "utf8"), "b-ajeno\n", "a manifest name with a slash is never resolved");
		assert.equal(await readFile(sentinel, "utf8"), "no tocar", "a hostile name never resolves outside the destination");
		assert.equal(await readFile(join(extensionsDest, "live-dir", "index.ts"), "utf8"), "export default () => {};\n");
		assert.equal(await readFile(join(themesDest, "live-theme.json"), "utf8"), "{}\n");
		const manifestLines = async (dest: string) =>
			(await readFile(join(dest, ".chiche-managed"), "utf8")).split("\n").filter(Boolean).sort();
		assert.deepEqual(await manifestLines(extensionsDest), ["live-dir"], "the manifest is rewritten without the pruned or hostile names");
		assert.deepEqual(await manifestLines(themesDest), ["live-theme.json"]);

		const before = await fileTree(join(root, "dest"));
		const second = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], env);
		assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
		assert.deepEqual(await fileTree(join(root, "dest")), before, "a second install prunes nothing more and changes nothing");
		assert.doesNotMatch(second.stdout, /podado/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function assertNativePackageDocumentation(document: string): void {
	for (const literal of [
		"pi install git:github.com/chichex/chiche",
		"pi install git:github.com/chichex/chiche -l",
		"pi update --extensions",
		"pi remove git:github.com/chichex/chiche",
		"./install.sh pi-clean --confirm",
		"pi --use-theme claude-code",
		".chiche/grills",
		".sdd/grills",
		"<git-common-dir>/chiche/",
		"<git-common-dir>/sdd/",
	]) {
		assert.ok(document.includes(literal), `missing package documentation: ${literal}`);
	}
	assert.match(document, /git:github\.com\/chichex\/chiche@<[^>]+>/);
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

test("autonomy contract and CI expose the verified Pi 0.85.1 package harness", async () => {
	// Issue #44 CA-14: el pin sube a 0.85.1 (Pi local); el contrato y el workflow
	// tienen que nombrar la misma version que corre en CI.
	const contract = await readFile(repoFile(".chiche/project.md"), "utf8");
	const workflow = await readFile(repoFile(".github/workflows/ci.yml"), "utf8");

	assert.doesNotMatch(contract, /no hay `package\.json`/);
	assert.match(contract, /package\.json.*Pi Package/is);
	assert.match(contract, /Pi `0\.85\.1`/);
	assert.doesNotMatch(contract, /0\.84\.2/, "el contrato no puede seguir nombrando el pin viejo");
	assert.doesNotMatch(workflow, /0\.84\.2/, "el workflow no puede seguir nombrando el pin viejo");
	assert.match(contract, /node --test pi-extensions\/pi-package\/pi-package\.test\.ts/);
	assert.match(contract, /HOME.*PI_CODING_AGENT_DIR.*tempor/is);
	assert.match(contract, /## Politicas de generacion\nSin politicas activas\./);
	assert.match(contract, /## Decisiones humanas\n/);
	assert.match(workflow, /@earendil-works\/pi-coding-agent@0\.85\.1/);
});

test("install.sh pi copies the subagent extension directory with its bundled agents, and pi-clean removes it whole", async () => {
	// Issue #44 CA-8: el Pi Package nativo resuelve pi-extensions/subagent/agents/
	// relativo a la extension (import.meta.url); la via legacy (install.sh pi)
	// tiene que copiar ese directorio ENTERO (index.ts + agents/*.md) y
	// pi-clean --confirm borrarlo entero, para que ambas instalaciones vean
	// los mismos agentes bundleados.
	const bundledAgents = await readdir(repoPath("pi-extensions/subagent/agents")).catch(() => [] as string[]);
	assert.deepEqual(
		[...bundledAgents].sort(),
		["implementer.md", "reviewer.md", "scout.md"],
		"agentes bundleados esperados en pi-extensions/subagent/agents",
	);
	const root = await mkdtemp(join(tmpdir(), "chichex-pi-subagent-install-"));
	const fixtureRepo = join(root, "repo");
	const extensionsDest = join(root, "dest", "extensions");
	try {
		await mkdir(join(fixtureRepo, "pi", "grill"), { recursive: true });
		await writeFile(join(fixtureRepo, "pi", "grill", "SKILL.md"), "---\nname: grill\n---\n");
		await mkdir(join(fixtureRepo, "pi-extensions", "subagent", "agents"), { recursive: true });
		await copyFile(
			repoPath("pi-extensions/subagent/index.ts"),
			join(fixtureRepo, "pi-extensions", "subagent", "index.ts"),
		);
		for (const name of bundledAgents) {
			await copyFile(
				repoPath(`pi-extensions/subagent/agents/${name}`),
				join(fixtureRepo, "pi-extensions", "subagent", "agents", name),
			);
		}
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));
		const env = {
			HOME: join(root, "home"),
			PI_SKILLS_DIR: join(root, "dest", "skills"),
			PI_EXTENSIONS_DIR: extensionsDest,
			PI_THEMES_DIR: join(root, "dest", "themes"),
			// Sin `pi` en PATH: el guard de conflicto degrada a "no hay conflicto".
			PATH: "/usr/bin:/bin",
		};
		const installed = runInstaller(join(fixtureRepo, "install.sh"), ["pi"], env);
		assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
		assert.equal(await absolutePathExists(join(extensionsDest, "subagent", "index.ts")), true, "index.ts copiado");
		for (const name of bundledAgents) {
			const copied = join(extensionsDest, "subagent", "agents", name);
			assert.equal(await absolutePathExists(copied), true, `${name} no se copio junto con la extension`);
			assert.equal(
				await readFile(copied, "utf8"),
				await readFile(repoPath(`pi-extensions/subagent/agents/${name}`), "utf8"),
				`${name}: contenido distinto al del repo`,
			);
		}
		const cleaned = runInstaller(join(fixtureRepo, "install.sh"), ["pi-clean", "--confirm"], env);
		assert.equal(cleaned.status, 0, `${cleaned.stdout}\n${cleaned.stderr}`);
		assert.equal(
			await absolutePathExists(join(extensionsDest, "subagent")),
			false,
			"pi-clean debe borrar subagent/ entero, incluido agents/",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
