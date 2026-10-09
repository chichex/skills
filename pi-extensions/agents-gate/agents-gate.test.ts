// Gate anti-drift del layer de agentes de plugin de Claude Code (spec
// .sdd/specs/subagentes-claude.md).
//
// Censa agents/*.md sobre archivos TRACKEADOS en git (no el working tree),
// valida el frontmatter de cada agente y verifica los textos doctrinales que
// las CA-1 a CA-3, CA-11 y CA-12 exigen en claude/sdd-run/SKILL.md,
// .claude-plugin/plugin.json, ambos READMEs, harness-port y el contrato. Falla con diagnostico nombrando el archivo
// ante cada forma de drift. No hay extension Pi en este directorio: es
// solo-tests, igual que pi-extensions/sdd-land-gate.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

function repoPath(path: string): string {
	return join(REPO_ROOT, path);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

async function absolutePathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
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

// --- Censo de agents/*.md sobre archivos trackeados en git -----------------

const EXPECTED_AGENTS = ["./agents/implementer.md", "./agents/reviewer.md"];

// Issue #44: el UNICO port de agents/ vive en pi-extensions/subagent/agents/,
// bundleado con la tool `subagent` del Pi Package (el manifest de Pi Package no
// tiene campo `agents`, asi que los agentes viajan dentro de la extension).
// Codex y opencode no lo reciben. Se censa sobre archivos trackeados, igual
// que agents/ de la raiz.
const PI_AGENTS_DIR = "pi-extensions/subagent/agents";
const EXPECTED_PI_AGENTS = [
	"./pi-extensions/subagent/agents/implementer.md",
	"./pi-extensions/subagent/agents/reviewer.md",
	"./pi-extensions/subagent/agents/scout.md",
];

function gitTrackedAgentPaths(dir = "agents"): Set<string> | null {
	const result = spawnSync("git", ["ls-files", "--", dir], {
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

export function diffAgentCensus(actual: string[], expected: string[]): string[] {
	const problems: string[] = [];
	const actualSet = new Set(actual);
	const expectedSet = new Set(expected);
	for (const path of expected) {
		if (!actualSet.has(path)) problems.push(`agente faltante: ${path}`);
	}
	for (const path of actual) {
		if (!expectedSet.has(path)) problems.push(`agente inesperado: ${path}`);
	}
	return problems;
}

// --- Frontmatter -------------------------------------------------------------

const FORBIDDEN_AGENT_FIELDS = ["model", "tools", "disallowedTools", "hooks", "mcpServers", "permissionMode"];

interface SplitAgent {
	frontmatter: string;
	body: string;
}

export function splitFrontmatter(markdown: string): SplitAgent | null {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return null;
	return { frontmatter: match[1] ?? "", body: match[2] ?? "" };
}

function topLevelKeys(frontmatter: string): string[] {
	return frontmatter
		.split("\n")
		.map((line) => line.match(/^([A-Za-z_][\w-]*):/))
		.filter((entry): entry is RegExpMatchArray => entry !== null)
		.map((entry) => entry[1]!);
}

function frontmatterScalar(frontmatter: string, key: string): string | null {
	const line = frontmatter.split("\n").find((candidate) => new RegExp(`^${key}:`).test(candidate));
	if (line === undefined) return null;
	return line
		.replace(new RegExp(`^${key}:\\s*`), "")
		.trim()
		.replace(/^"(.*)"$/, "$1")
		.replace(/^'(.*)'$/, "$1");
}

function descriptionNonEmpty(frontmatter: string): boolean {
	const lines = frontmatter.split("\n");
	const index = lines.findIndex((line) => /^description:/.test(line));
	if (index === -1) return false;
	const raw = (lines[index] ?? "").replace(/^description:\s*/, "").trim();
	if (/^[>|][+-]?$/.test(raw)) {
		for (let i = index + 1; i < lines.length; i += 1) {
			const line = lines[i] ?? "";
			if (/^[A-Za-z_][\w-]*:/.test(line)) break;
			if (/^\s+\S/.test(line)) return true;
		}
		return false;
	}
	return raw.length > 0 && raw !== '""' && raw !== "''";
}

// `description:` en agents/*.md tiene que estar entre comillas dobles.
// validateAgentFrontmatter es todo regex por linea, nunca parsea YAML de
// verdad: un valor sin comillas que empiece con `[`, `{`, `&`, `*`, backtick
// o `@`, o que contenga ": ", rompe el parseo real de Claude Code aunque
// este gate de verde. Exigir comillas es la mitigacion barata (hallazgo #10
// del review de PR #43). agents/ no lo cubre scripts/lint-frontmatter.sh
// (solo recorre claude/, codex/, opencode/ y pi/), asi que este es el unico
// gate para el frontmatter de agents/.
function descriptionIsQuoted(frontmatter: string): boolean {
	const line = frontmatter.split("\n").find((candidate) => /^description:/.test(candidate));
	if (line === undefined) return false;
	const raw = line.replace(/^description:\s*/, "").trim();
	return /^"[\s\S]*"$/.test(raw);
}

function skillsList(frontmatter: string): string[] {
	const lines = frontmatter.split("\n");
	const index = lines.findIndex((line) => /^skills:/.test(line));
	if (index === -1) return [];
	const items: string[] = [];
	for (let i = index + 1; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (/^[A-Za-z_][\w-]*:/.test(line)) break;
		const itemMatch = line.match(/^\s*-\s*(.+)$/);
		if (itemMatch) items.push((itemMatch[1] ?? "").trim());
	}
	return items;
}

// --- Orden de doctrina dentro de un body ------------------------------------

// Verifica que cada patron en `patterns` aparezca en `body`, EN ORDEN. Usada
// por CA-1 y CA-2 para exigir que la doctrina de cada agente respete un
// orden exacto de secciones.
export function checkOrderedPatterns(body: string, patterns: RegExp[]): string[] {
	const problems: string[] = [];
	let cursor = 0;
	for (const pattern of patterns) {
		const match = body.slice(cursor).match(pattern);
		if (!match) {
			problems.push(`falta o esta fuera de orden: ${pattern}`);
			break;
		}
		// El cursor avanza al FINAL del match (indice + longitud), no a su
		// inicio + 1: un patron que solo aparece DENTRO del texto que el
		// patron anterior ya consumio no cuenta como que aparece "despues"
		// (hallazgo #9 del review de PR #43).
		cursor += (match.index ?? 0) + match[0].length;
	}
	return problems;
}

interface AgentValidation {
	ok: boolean;
	problems: string[];
}

export function validateAgentFrontmatter(
	basename: string,
	markdown: string,
	requiredSkills: string[] | null,
): AgentValidation {
	const problems: string[] = [];
	const parts = splitFrontmatter(markdown);
	if (!parts) return { ok: false, problems: [`${basename}: sin frontmatter YAML valido (falta --- de apertura/cierre)`] };
	const { frontmatter } = parts;

	const name = frontmatterScalar(frontmatter, "name");
	if (!name) problems.push(`${basename}: falta name: en el frontmatter (o esta vacio)`);
	else if (name !== basename) problems.push(`${basename}: name: '${name}' no coincide con el basename '${basename}'`);

	if (!descriptionNonEmpty(frontmatter)) problems.push(`${basename}: description: falta o esta vacia`);
	else if (!descriptionIsQuoted(frontmatter))
		problems.push(`${basename}: description: debe ir entre comillas dobles (un escalar sin comillas rompe el parseo real de Claude Code si empieza con [ { & * \` @ o contiene ': ')`);

	const keys = topLevelKeys(frontmatter);
	for (const forbidden of FORBIDDEN_AGENT_FIELDS) {
		if (keys.includes(forbidden)) problems.push(`${basename}: campo prohibido presente: ${forbidden}`);
	}

	if (requiredSkills !== null) {
		const actual = skillsList(frontmatter);
		if (actual.join("|") !== requiredSkills.join("|")) {
			problems.push(
				`${basename}: skills: esperado [${requiredSkills.join(", ")}], encontrado [${actual.join(", ")}]`,
			);
		}
	}

	return { ok: problems.length === 0, problems };
}

// --- Doctrina ordenada de los agentes (Claude y su port Pi) -----------------

// Orden exacto exigido por CA-1 para agents/implementer.md. Vive a nivel de
// modulo porque el port Pi (issue #44 CA-7, pi-extensions/subagent/agents/
// implementer.md) tiene que pasar EXACTAMENTE los mismos patrones.
const IMPLEMENTER_DOCTRINE: RegExp[] = [
	/`\.sdd\/project\.md`/,
	/fila `guia`[\s\S]*?coding policies|coding policies[\s\S]*?fila `guia`/i,
	/sin asumir su ruta|no asumas una ruta fija/i,
	/`## Limites`/,
	// Hallazgo #5 del review de PR #43: '## Limites' solo puede restringir
	// mas, nunca autorizar menos (no puede pisar las secciones 7 y 8), y
	// tiene que alinear con la doctrina de datos no confiables de
	// agents/reviewer.md ante un contrato que el propio PR puede modificar.
	/solo puede sumar restricciones/i,
	/mismo criterio que usa `agents\/reviewer\.md`|dato no confiable/i,
	/`## Comandos`/,
	/tests? primero[\s\S]{0,120}rojo/i,
	// Hallazgo #6 del review de PR #43: escape hatch para cambios sin rojo
	// previo posible (rename, comentario, README, plugin.json), con el
	// mismo patron que ya usa la seccion 2 (declarar en el reporte final).
	/rojo previo[\s\S]{0,250}gate m[aá]s fuerte|gate m[aá]s fuerte[\s\S]{0,250}rojo previo/i,
	/tres intentos honestos/i,
	/prohibid[oa][\s\S]{0,40}debilitar|nunca aflojes un assert/i,
	/prohibid[oa][\s\S]{0,40}ampliar el alcance/i,
	/reporte final/i,
];

// Orden exacto exigido por CA-2 para agents/reviewer.md, parametrizado por la
// UNICA diferencia de capa de interaccion del port Pi: en Claude Code el
// orquestador pasa `--comment` y publicar esos comments es parte del trabajo;
// en Pi `code-review` publica un review COMMENT por default (no existe
// `--comment`), asi que la doctrina dice que esa publicacion por default es
// parte del trabajo.
export function reviewerDoctrine(harness: "claude" | "pi"): RegExp[] {
	return [
		/`code-review`[\s\S]{0,200}sin resumir|sin resumir[\s\S]{0,200}reinterpretar/i,
		/t[ií]tulo[\s\S]{0,80}body[\s\S]{0,80}comments[\s\S]{0,80}autor/i,
		/no confiable/i,
		/no edit[aá]/i,
		/no commite[aá]/i,
		/no pushe[aá]/i,
		// Hallazgo #7 del review de PR #43: publicar los comments inline que
		// genera `/code-review --comment` es parte del trabajo (el orquestador
		// se lo pasa como argumento), no una violacion de "no edita/commitea/
		// pushea"; lo prohibido sigue siendo aprobar formalmente, pedir
		// cambios formalmente, resolver threads o tocar archivos.
		/no apruebes[\s\S]{0,120}(formalmente|request changes)/i,
		harness === "claude"
			? /--comment[\s\S]{0,200}parte[\s\S]{0,20}del trabajo/i
			: /por default[\s\S]{0,200}parte[\s\S]{0,20}del trabajo/i,
		/```json/,
		/no concluyente/i,
	];
}

// --- Frontmatter de los ports Pi (issue #44 CA-7) ---------------------------

// name == basename y description entre comillas dobles, como en agents/. Sin
// `model` (los agentes bundleados heredan modelo y thinking de la sesion) ni
// `skills` (Pi ignora la clave; la precarga va en el body como /skill:...).
// `tools` es exacto cuando el port lo restringe (reviewer, scout) y tiene que
// estar ausente en implementer, que hereda todas las tools.
const FORBIDDEN_PI_AGENT_FIELDS = ["model", "skills"];

export function validatePiAgentFrontmatter(
	basename: string,
	markdown: string,
	expectedTools: string | null,
): AgentValidation {
	const problems: string[] = [];
	const parts = splitFrontmatter(markdown);
	if (!parts) return { ok: false, problems: [`${basename}: sin frontmatter YAML valido (falta --- de apertura/cierre)`] };
	const { frontmatter } = parts;

	const name = frontmatterScalar(frontmatter, "name");
	if (!name) problems.push(`${basename}: falta name: en el frontmatter (o esta vacio)`);
	else if (name !== basename) problems.push(`${basename}: name: '${name}' no coincide con el basename '${basename}'`);

	if (!descriptionNonEmpty(frontmatter)) problems.push(`${basename}: description: falta o esta vacia`);
	else if (!descriptionIsQuoted(frontmatter))
		problems.push(`${basename}: description: debe ir entre comillas dobles (mismo criterio que agents/)`);

	const keys = topLevelKeys(frontmatter);
	for (const forbidden of FORBIDDEN_PI_AGENT_FIELDS) {
		if (keys.includes(forbidden)) problems.push(`${basename}: campo prohibido presente en el port Pi: ${forbidden}`);
	}

	const tools = frontmatterScalar(frontmatter, "tools");
	if (expectedTools === null) {
		if (tools !== null) problems.push(`${basename}: tools: no debe declararse (el implementer hereda todas las tools)`);
	} else if (tools !== expectedTools) {
		problems.push(`${basename}: tools: esperado '${expectedTools}', encontrado '${tools ?? "(ausente)"}'`);
	}

	return { ok: problems.length === 0, problems };
}

// --- plugin.json --------------------------------------------------------------

// Claude Code valida cada entrada de `agents` como ruta a un `.md` (un
// directorio como "./agents" rompe la carga del plugin con
// "agents.0: Invalid input") y, si el campo existe, deja de autodescubrir
// agents/ en la raiz. Por eso el manifest no declara el campo: el
// autodescubrimiento expone todo agents/*.md sin lista que mantener.
export function checkPluginAgentsAutodiscovered(pluginJsonText: string): string[] {
	let parsed: { agents?: unknown };
	try {
		parsed = JSON.parse(pluginJsonText) as { agents?: unknown };
	} catch {
		return ["plugin.json: JSON invalido"];
	}
	if ("agents" in parsed) {
		return ["plugin.json declara agents: omitir el campo para autodescubrir agents/"];
	}
	return [];
}

// --- CA-10: ningun agents/ bajo claude/, opencode/ o pi/ --------------------

export function forbiddenAgentDirs(paths: string[]): string[] {
	// (.*\/)? cubre cualquier profundidad de anidado, incluida la profundidad
	// 1 (agents/ directo bajo el harness, sin subcarpeta de skill) — el regex
	// anterior [^/]+\/agents\/ exigia exactamente un segmento intermedio y se
	// perdia ese caso (hallazgo #8 del review de PR #43).
	return paths.filter((path) => /^(claude|opencode|pi)\/(.*\/)?agents\//.test(path));
}

// =============================================================================
// Tests sobre el arbol real
// =============================================================================

test("CA-9: censo de agents/*.md sobre archivos trackeados en git contra la lista esperada", () => {
	const tracked = gitTrackedAgentPaths();
	assert.ok(tracked, "git ls-files -- agents debe correr sin error");
	const actual = [...(tracked ?? new Set<string>())].sort();
	const divergences = diffAgentCensus(actual, EXPECTED_AGENTS);
	assert.deepEqual(divergences, [], `censo de agents/: ${divergences.join("; ")}`);
});

test("CA-1: agents/implementer.md tiene frontmatter valido, skills: [chichex-skills:tdd, chichex-skills:sdd-run] y body en orden", async () => {
	const markdown = await readRepoFile("agents/implementer.md");
	// Hallazgo 1 del review de PR #46: `sdd-run con subagente` necesita el skill precargado.
	const verdict = validateAgentFrontmatter("implementer", markdown, ["chichex-skills:tdd", "chichex-skills:sdd-run"]);
	assert.deepEqual(verdict.problems, [], `agents/implementer.md: ${verdict.problems.join("; ")}`);

	const parts = splitFrontmatter(markdown);
	assert.ok(parts, "agents/implementer.md: frontmatter parseable");
	const body = parts?.body ?? "";

	// Orden exacto exigido por CA-1: cada patron tiene que aparecer despues del
	// anterior (lista compartida con el port Pi, ver IMPLEMENTER_DOCTRINE).
	const orderProblems = checkOrderedPatterns(body, IMPLEMENTER_DOCTRINE);
	assert.deepEqual(orderProblems, [], `agents/implementer.md: ${orderProblems.join("; ")}`);

	// El reporte final nombra las cuatro cosas que exige CA-1.
	const finalReport = body.slice(body.search(/reporte final/i));
	assert.match(finalReport, /comandos/i);
	assert.match(finalReport, /resultado exacto|resultado/i);
	assert.match(finalReport, /archivos/i);
	assert.match(finalReport, /pol[ií]ticas/i);
	assert.match(finalReport, /no verificado|sin verificar|qued[oó] sin verificar/i);
});

test("CA-2: agents/reviewer.md tiene frontmatter valido, sin skills forzadas y body en orden", async () => {
	const markdown = await readRepoFile("agents/reviewer.md");
	const verdict = validateAgentFrontmatter("reviewer", markdown, null);
	assert.deepEqual(verdict.problems, [], `agents/reviewer.md: ${verdict.problems.join("; ")}`);

	const parts = splitFrontmatter(markdown);
	assert.ok(parts, "agents/reviewer.md: frontmatter parseable");
	const body = parts?.body ?? "";

	const orderProblems = checkOrderedPatterns(body, reviewerDoctrine("claude"));
	assert.deepEqual(orderProblems, [], `agents/reviewer.md: ${orderProblems.join("; ")}`);
});

test("CA-3: plugin.json autodescubre agents/ junto a skills, con description identica a marketplace.json", async () => {
	const pluginText = await readRepoFile(".claude-plugin/plugin.json");
	const problems = checkPluginAgentsAutodiscovered(pluginText);
	assert.deepEqual(problems, []);
	const plugin = JSON.parse(pluginText) as { skills?: unknown; description: string };
	assert.deepEqual(plugin.skills, ["./claude"], "skills existente intacto");

	const marketplace = JSON.parse(await readRepoFile(".claude-plugin/marketplace.json")) as {
		plugins: Array<{ name: string; description: string }>;
	};
	const entry = marketplace.plugins.find((candidate) => candidate.name === "chichex-skills");
	assert.ok(entry, "marketplace.json: plugin chichex-skills");
	assert.equal(entry?.description, plugin.description, "descripciones byte a byte iguales");
});

test("CA-10: ningun agents/ bajo claude/, opencode/ o pi/; los sidecars de codex no disparan falso positivo", () => {
	const tracked = spawnSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
	assert.equal(tracked.status, 0);
	const allPaths = tracked.stdout.split("\n").filter(Boolean);
	const forbidden = forbiddenAgentDirs(allPaths);
	assert.deepEqual(forbidden, [], `agents/ prohibido fuera de la raiz: ${forbidden.join(", ")}`);

	const codexSidecars = allPaths.filter((path) => /^codex\/[^/]+\/agents\/openai\.yaml$/.test(path));
	assert.ok(codexSidecars.length >= 14, "los sidecars de codex siguen presentes y no los toca este gate");
});

test("CA-11: READMEs, harness-port y el contrato documentan el layer de agentes", async () => {
	const readmeEs = await readRepoFile("README.md");
	const readmeEn = await readRepoFile("README.en.md");
	assert.match(readmeEs, /agents\//);
	assert.match(readmeEn, /agents\//);
	assert.match(readmeEs, /agentes de `agents\/`|agentes del plugin/i);
	assert.match(readmeEn, /agents of `agents\/`|plugin's agents/i);

	// Hallazgo #12 del review de PR #43: install.sh:18-28 ya documenta
	// CLAUDE_AGENTS_DIR y el registro de plugins como overrides, pero la
	// lista de destinos/overrides y el bloque de copia manual de ambos
	// READMEs no los mencionaba.
	assert.match(readmeEs, /~\/\.claude\/agents\//);
	assert.match(readmeEn, /~\/\.claude\/agents\//);
	assert.match(readmeEs, /CLAUDE_AGENTS_DIR/);
	assert.match(readmeEn, /CLAUDE_AGENTS_DIR/);
	assert.match(readmeEs, /CLAUDE_PLUGIN_REGISTRY_FILE/);
	assert.match(readmeEn, /CLAUDE_PLUGIN_REGISTRY_FILE/);
	assert.match(readmeEs, /cp agents\/\*\.md\s+~\/\.claude\/agents\//);
	assert.match(readmeEn, /cp agents\/\*\.md\s+~\/\.claude\/agents\//);

	const harnessPort = await readRepoFile(".claude/skills/harness-port/SKILL.md");
	assert.match(harnessPort, /agents\/[\s\S]{0,200}(plugin|Codex)/i);
	// Issue #44 CA-13: agents/ es el layer de agentes del plugin de Claude Code
	// y su UNICO port vive en pi-extensions/subagent/agents/; codex y opencode
	// no lo reciben.
	assert.match(harnessPort, /[uú]nico port[\s\S]{0,160}`pi-extensions\/subagent\/agents\/`/i);
	assert.match(harnessPort, /codex[\s\S]{0,80}opencode[\s\S]{0,80}(no lo reciben|no se portea|no viaja)/i);

	const contract = await readRepoFile(".sdd/project.md");
	assert.match(contract, /agents-gate\/agents-gate\.test\.ts/);
	// Literales que pi-extensions/pi-package/pi-package.test.ts:1214-1219 assertea
	// sobre este mismo archivo: agregar la fila nueva no puede tocarlos.
	assert.match(contract, /## Politicas de generacion\nSin politicas activas\./);
	assert.match(contract, /## Decisiones humanas\n/);
});

test("CA-12: sdd-run nombra Explore + tool Agent en la Fase 2, sin agregar un tipo custom", async () => {
	const markdown = await readRepoFile("claude/sdd-run/SKILL.md");
	// Issue #45: la Fase 6 lanza el subagente `reviewer` para el code review
	// post-PR; la restricción aplica solo a la exploración de la Fase 2.
	const phase2 = markdown.match(/## Fase 2 —[\s\S]*?(?=\n## Fase 3 —)/)?.[0] ?? "";
	assert.ok(phase2, "claude/sdd-run/SKILL.md tiene Fase 2");
	assert.doesNotMatch(phase2, /subagents en repos grandes\)/);
	assert.match(phase2, /subagents `Explore` con la tool `Agent`/);
	assert.doesNotMatch(phase2, /`implementer`|`reviewer`/);
});

test("issue #66 CA-9, CA-10, CA-24: sdd-run acota el force a gh stack, sugiere sdd-land y el contrato y el plugin reconocen sdd-land", async () => {
	const markdown = await readRepoFile("claude/sdd-run/SKILL.md");
	assert.match(markdown, /único force permitido es el `--force-with-lease`[\s\S]*`gh stack push`[\s\S]*`gh stack sync`[\s\S]*`gh stack rebase`/);
	assert.match(markdown, /siguiente paso: \/sdd-land <stack\|PR>/);

	const plugin = JSON.parse(await readRepoFile(".claude-plugin/plugin.json")) as { description: string };
	assert.match(plugin.description, /sdd-land/, "plugin.json nombra sdd-land");
	const marketplace = JSON.parse(await readRepoFile(".claude-plugin/marketplace.json")) as {
		plugins: Array<{ name: string; description: string }>;
	};
	assert.match(marketplace.plugins.find((entry) => entry.name === "chichex-skills")?.description ?? "", /sdd-land/, "marketplace.json nombra sdd-land");

	const contract = await readRepoFile(".sdd/project.md");
	assert.match(contract, /salvo `\/sdd-land` invocado por el humano, que confirma el plan antes de mergear/, "contrato: excepción de merge para sdd-land en ## Limites");
	assert.match(contract, /node --test pi-extensions\/sdd-land-gate\/sdd-land-gate\.test\.ts/, "contrato: fila del gate de sdd-land");
	assert.match(contract, /gh-stack/, "contrato: versión de gh-stack verificada en ## Gaps");
	// Literales que pi-package.test.ts assertea sobre el mismo archivo.
	assert.match(contract, /## Politicas de generacion\nSin politicas activas\./);
	assert.match(contract, /## Decisiones humanas\n/);
});

test("issue #45: la description de implementer invita a usarlo proactivamente en cualquier implementación", async () => {
	const markdown = await readRepoFile("agents/implementer.md");
	const line = markdown.split("\n").find((candidate) => /^description:/.test(candidate)) ?? "";
	assert.match(line, /^description: ".*"$/, "description entre comillas dobles");
	assert.match(line, /PROACTIVAMENTE/);
	assert.match(line, /cualquier tarea de implementación/i);
});

test("CA-7: install.sh copia agents/*.md a CLAUDE_AGENTS_DIR en 'claude', 'all' y 'both', sin tocar el home real ni dejar un manifest sin lector", async () => {
	// Hallazgo #11 del review de PR #43: leer process.env.HOME (el HOME real
	// del proceso que corre el test) nunca puede detectar una escritura hecha
	// por install.sh, que corre con un HOME sobrescrito. Comparamos estado
	// (existencia + mtime) del path del HOME real ANTES y DESPUES de cada
	// corrida: asi cualquier escritura ahi se detecta pase lo que pase en la
	// maquina de quien corre el test.
	const realHomeAgentFile = join(homedir(), ".claude", "agents", "implementer.md");
	const beforeRun = await stat(realHomeAgentFile).catch(() => null);

	// Hallazgo #4 del review de PR #43: 'both' tiene que pasar por la misma
	// definicion de "el set de Claude" que 'claude' y 'all' (install_claude),
	// no instalar skills de Claude a mano sin agentes ni aviso.
	for (const which of ["claude", "all", "both"]) {
		const root = await mkdtemp(join(tmpdir(), "chichex-claude-agents-"));
		try {
			const fixtureRepo = join(root, "repo");
			await mkdir(join(fixtureRepo, "agents"), { recursive: true });
			for (const name of ["implementer.md", "reviewer.md"]) {
				await writeFile(join(fixtureRepo, "agents", name), await readFile(repoPath(`agents/${name}`), "utf8"));
			}
			const { copyFile } = await import("node:fs/promises");
			await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));

			const skillsDest = join(root, "dest", "skills");
			const agentsDest = join(root, "dest", "agents");
			const env = {
				HOME: join(root, "home"),
				CLAUDE_SKILLS_DIR: skillsDest,
				CLAUDE_AGENTS_DIR: agentsDest,
				CLAUDE_PLUGIN_REGISTRY_FILE: join(root, "no-registry.json"),
				PI_SKILLS_DIR: join(root, "dest", "pi-skills"),
				PI_EXTENSIONS_DIR: join(root, "dest", "pi-extensions"),
				PI_THEMES_DIR: join(root, "dest", "pi-themes"),
				CODEX_SKILLS_DIR: join(root, "dest", "codex-skills"),
				CODEX_CONFIG_FILE: join(root, "dest", "codex-config.toml"),
				OPENCODE_SKILLS_DIR: join(root, "dest", "opencode-skills"),
				PATH: process.env.PATH ?? "",
			};

			const result = runInstaller(join(fixtureRepo, "install.sh"), [which], env);
			assert.equal(result.status, 0, `install.sh ${which}: ${result.stdout}\n${result.stderr}`);

			for (const name of ["implementer.md", "reviewer.md"]) {
				const copied = await absolutePathExists(join(agentsDest, name));
				assert.ok(copied, `install.sh ${which}: ${name} no aparecio en CLAUDE_AGENTS_DIR`);
				const content = await readFile(join(agentsDest, name), "utf8");
				const original = await readFile(repoPath(`agents/${name}`), "utf8");
				assert.equal(content, original, `install.sh ${which}: contenido de ${name} no coincide`);
			}

			// Hallazgo #3 del review de PR #43: nada lee el manifest
			// '.chichex-skills-managed' para el kind 'md' (clean_managed no
			// tiene rama para agentes de Claude), asi que install_agents no
			// debe escribirlo: un manifest sin lector es arbol incoherente.
			assert.equal(
				await absolutePathExists(join(agentsDest, ".chichex-skills-managed")),
				false,
				`install.sh ${which}: no debe escribir el manifest .chichex-skills-managed en CLAUDE_AGENTS_DIR (nada lo limpia para el kind md)`,
			);

			const afterRun = await stat(realHomeAgentFile).catch(() => null);
			if (beforeRun === null) {
				assert.equal(
					afterRun,
					null,
					`install.sh ${which}: no debe crear ${realHomeAgentFile} en el HOME real del proceso`,
				);
			} else {
				assert.ok(afterRun, `install.sh ${which}: ${realHomeAgentFile} desaparecio del HOME real del proceso`);
				assert.equal(
					afterRun?.mtimeMs,
					beforeRun.mtimeMs,
					`install.sh ${which}: ${realHomeAgentFile} cambio de mtime en el HOME real del proceso`,
				);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test("CA-8: install.sh claude avisa la sombra del plugin chichex-skills solo cuando esta registrado, y salta agents/ sin abortar skills", async () => {
	const root = await mkdtemp(join(tmpdir(), "chichex-claude-shadow-"));
	try {
		const fixtureRepo = join(root, "repo");
		await mkdir(join(fixtureRepo, "agents"), { recursive: true });
		for (const name of ["implementer.md", "reviewer.md"]) {
			await writeFile(join(fixtureRepo, "agents", name), await readFile(repoPath(`agents/${name}`), "utf8"));
		}
		// Fixture minima de un skill de claude/ para poder distinguir, con el
		// conflicto de plugin activo, "los skills se instalan igual" (lo unico
		// que CA-8 exige) de "los agentes tambien se instalan" (lo que ya NO
		// pasa desde el hallazgo #1 del review de PR #43).
		await mkdir(join(fixtureRepo, "claude", "dummy-skill"), { recursive: true });
		await writeFile(join(fixtureRepo, "claude", "dummy-skill", "SKILL.md"), "---\nname: dummy-skill\n---\nDummy.\n");
		const { copyFile } = await import("node:fs/promises");
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));

		const registryWith = join(root, "installed_plugins_with.json");
		// Hallazgo #2 del review de PR #43: "chichex-skills@chichex" es una
		// forma INVENTADA por este mismo fixture, no un formato verificado de
		// installed_plugins.json. Sumamos una segunda forma plausible sin
		// sufijo de version para no reconfirmar la unica forma que inventamos.
		const registryWithBareName = join(root, "installed_plugins_bare.json");
		const registryWithout = join(root, "installed_plugins_without.json");
		await writeFile(
			registryWith,
			JSON.stringify({ version: 2, plugins: { "chichex-skills@chichex": [{ scope: "user" }] } }),
		);
		await writeFile(
			registryWithBareName,
			JSON.stringify({ version: 2, plugins: { "chichex-skills": [{ scope: "user" }] } }),
		);
		await writeFile(registryWithout, JSON.stringify({ version: 2, plugins: { "other-plugin@marketplace": [] } }));

		const baseEnv = {
			HOME: join(root, "home"),
			CLAUDE_SKILLS_DIR: join(root, "dest", "skills"),
			CLAUDE_AGENTS_DIR: join(root, "dest", "agents"),
			PATH: process.env.PATH ?? "",
		};

		for (const registry of [registryWith, registryWithBareName]) {
			const withPlugin = runInstaller(join(fixtureRepo, "install.sh"), ["claude"], {
				...baseEnv,
				CLAUDE_PLUGIN_REGISTRY_FILE: registry,
			});
			assert.equal(withPlugin.status, 0, `${withPlugin.stdout}\n${withPlugin.stderr}`);
			assert.match(
				`${withPlugin.stdout}\n${withPlugin.stderr}`,
				/chichex-skills[\s\S]{0,80}ya est[aá] instalado/i,
				`debe avisar cuando el plugin esta registrado (${registry})`,
			);
			assert.ok(
				await absolutePathExists(join(root, "dest", "skills", "dummy-skill", "SKILL.md")),
				"CA-8 solo exige que el aviso no aborte la instalacion de skills: dummy-skill debe instalarse igual",
			);
			assert.equal(
				await absolutePathExists(join(root, "dest", "agents", "implementer.md")),
				false,
				"con el plugin ya instalado, install.sh no debe instalar agents/ (lo que el aviso dice que no hace falta)",
			);
			await rm(join(root, "dest"), { recursive: true, force: true });
		}

		const withoutPlugin = runInstaller(join(fixtureRepo, "install.sh"), ["claude"], {
			...baseEnv,
			CLAUDE_PLUGIN_REGISTRY_FILE: registryWithout,
		});
		assert.equal(withoutPlugin.status, 0, `${withoutPlugin.stdout}\n${withoutPlugin.stderr}`);
		assert.doesNotMatch(
			`${withoutPlugin.stdout}\n${withoutPlugin.stderr}`,
			/ya est[aá] instalado/i,
			"no debe avisar cuando el plugin no esta registrado",
		);
		assert.ok(
			await absolutePathExists(join(root, "dest", "agents", "implementer.md")),
			"sin conflicto, agents/ se instala normalmente",
		);
		await rm(join(root, "dest"), { recursive: true, force: true });

		const missingRegistry = runInstaller(join(fixtureRepo, "install.sh"), ["claude"], {
			...baseEnv,
			CLAUDE_PLUGIN_REGISTRY_FILE: join(root, "does-not-exist.json"),
		});
		assert.equal(missingRegistry.status, 0, `${missingRegistry.stdout}\n${missingRegistry.stderr}`);
		assert.doesNotMatch(
			`${missingRegistry.stdout}\n${missingRegistry.stderr}`,
			/ya est[aá] instalado/i,
			"un registro ausente nunca dispara el aviso",
		);
		assert.ok(
			await absolutePathExists(join(root, "dest", "agents", "implementer.md")),
			"sin registro, agents/ se instala normalmente",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// =============================================================================
// Autotests del gate: puede fallar y con que diagnostico (CA-9)
// =============================================================================

test("autotest: censo reporta agente faltante y agente inesperado por nombre", () => {
	const divergences = diffAgentCensus(["./agents/implementer.md", "./agents/scratch.md"], EXPECTED_AGENTS);
	assert.deepEqual(divergences.sort(), [
		"agente faltante: ./agents/reviewer.md",
		"agente inesperado: ./agents/scratch.md",
	]);
});

test("autotest: frontmatter con name que no matchea el basename falla con diagnostico", () => {
	const markdown = "---\nname: otro-nombre\ndescription: algo\n---\nBody.\n";
	const verdict = validateAgentFrontmatter("implementer", markdown, null);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /name: 'otro-nombre' no coincide con el basename 'implementer'/);
});

test("autotest: description vacia falla con diagnostico", () => {
	const markdown = "---\nname: implementer\ndescription:\n---\nBody.\n";
	const verdict = validateAgentFrontmatter("implementer", markdown, null);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /description: falta o esta vacia/);
});

test("autotest: description sin comillas dobles falla con diagnostico", () => {
	const markdown = "---\nname: implementer\ndescription: sin comillas por aca\n---\nBody.\n";
	const verdict = validateAgentFrontmatter("implementer", markdown, null);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /description:.*comillas dobles/);
});

test("autotest: description entre comillas dobles pasa la validacion de comillas", () => {
	const markdown = '---\nname: implementer\ndescription: "algo entre comillas"\n---\nBody.\n';
	const verdict = validateAgentFrontmatter("implementer", markdown, null);
	assert.deepEqual(verdict.problems, []);
});

test("autotest: campo prohibido (model) presente falla con diagnostico", () => {
	const markdown = "---\nname: implementer\ndescription: algo\nmodel: sonnet\n---\nBody.\n";
	const verdict = validateAgentFrontmatter("implementer", markdown, null);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /campo prohibido presente: model/);
});

test("autotest: cada campo prohibido individual dispara su propio diagnostico", () => {
	for (const field of FORBIDDEN_AGENT_FIELDS) {
		const markdown = `---\nname: implementer\ndescription: algo\n${field}: x\n---\nBody.\n`;
		const verdict = validateAgentFrontmatter("implementer", markdown, null);
		assert.match(verdict.problems.join("\n"), new RegExp(`campo prohibido presente: ${field}`));
	}
});

test("autotest: skills requeridas ausentes o distintas fallan con diagnostico", () => {
	const markdown = "---\nname: implementer\ndescription: algo\n---\nBody.\n";
	const verdict = validateAgentFrontmatter("implementer", markdown, ["chichex-skills:tdd"]);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /skills: esperado \[chichex-skills:tdd\], encontrado \[\]/);
});

test("autotest: declarar agents en plugin.json falla con diagnostico", () => {
	const diagnostic = ["plugin.json declara agents: omitir el campo para autodescubrir agents/"];
	assert.deepEqual(checkPluginAgentsAutodiscovered(JSON.stringify({ skills: ["./claude"] })), []);
	// El directorio que rompio la carga del plugin en Claude Code 2.1.276.
	assert.deepEqual(checkPluginAgentsAutodiscovered(JSON.stringify({ agents: ["./agents"] })), diagnostic);
	// Una lista de .md valida para Claude Code igual apaga el autodescubrimiento.
	assert.deepEqual(checkPluginAgentsAutodiscovered(JSON.stringify({ agents: ["./agents/implementer.md"] })), diagnostic);
	assert.deepEqual(checkPluginAgentsAutodiscovered("{ esto no es json"), ["plugin.json: JSON invalido"]);
});

test("autotest: un agents/ de scratch bajo claude/, opencode/ o pi/ se detecta; los sidecars de codex no", () => {
	const paths = [
		"claude/quick-run/agents/scratch.md",
		"opencode/grill/agents/scratch.yaml",
		"pi/tdd/agents/scratch.md",
		// Hallazgo #8 del review de PR #43: profundidad 1 (directo bajo el
		// harness, sin subcarpeta de skill) es la alternativa que la spec
		// descarto y el drift mas probable; el regex viejo (^(claude|opencode|
		// pi)\/[^/]+\/agents\/) solo cubria profundidad 2 y se la perdia.
		"claude/agents/x.md",
		"codex/tdd/agents/openai.yaml",
		"agents/implementer.md",
		// Issue #44 CA-13: el port Pi vive bajo pi-extensions/, no bajo pi/.
		"pi-extensions/subagent/agents/implementer.md",
	];
	assert.deepEqual(forbiddenAgentDirs(paths).sort(), [
		"claude/agents/x.md",
		"claude/quick-run/agents/scratch.md",
		"opencode/grill/agents/scratch.yaml",
		"pi/tdd/agents/scratch.md",
	]);
});

test("autotest: checkOrderedPatterns no debe validar un patron que solo aparece DENTRO del match del patron anterior", () => {
	// Hallazgo #9 del review de PR #43: si el cursor avanza al INICIO del
	// match anterior + 1 (en vez de a su FINAL), un patron que cae dentro del
	// texto que el patron anterior ya consumio se "reencuentra" ahi y pasa
	// como si viniera despues, cuando en realidad esta contenido en el bloque
	// previo. "XXXX" esta dentro del propio match de /AAAA[\s\S]*AAAA/.
	const body = "AAAA XXXX AAAA YYYY";
	const patterns = [/AAAA[\s\S]*AAAA/, /XXXX/];
	const problems = checkOrderedPatterns(body, patterns);
	assert.notDeepEqual(
		problems,
		[],
		"XXXX esta contenido en el match del patron anterior: no deberia validar como 'encontrado despues'",
	);
});

test("autotest: checkOrderedPatterns acepta patrones que realmente aparecen despues del match anterior", () => {
	const body = "AAAA XXXX AAAA YYYY";
	const patterns = [/AAAA[\s\S]*AAAA/, /YYYY/];
	assert.deepEqual(checkOrderedPatterns(body, patterns), []);
});

// =============================================================================
// Issue #44: port Pi de los agentes (pi-extensions/subagent/agents/)
// =============================================================================

test("issue #44 CA-7: censo de pi-extensions/subagent/agents/*.md sobre archivos trackeados contra la lista esperada", () => {
	const tracked = gitTrackedAgentPaths(PI_AGENTS_DIR);
	assert.ok(tracked, `git ls-files -- ${PI_AGENTS_DIR} debe correr sin error`);
	const actual = [...(tracked ?? new Set<string>())].sort();
	const divergences = diffAgentCensus(actual, EXPECTED_PI_AGENTS);
	assert.deepEqual(divergences, [], `censo de ${PI_AGENTS_DIR}/: ${divergences.join("; ")}`);
});

test("issue #44 CA-7: el port Pi de implementer conserva la doctrina ordenada de CA-1 y precarga skills por /skill:", async () => {
	const markdown = await readRepoFile(`${PI_AGENTS_DIR}/implementer.md`);
	const verdict = validatePiAgentFrontmatter("implementer", markdown, null);
	assert.deepEqual(verdict.problems, [], `${PI_AGENTS_DIR}/implementer.md: ${verdict.problems.join("; ")}`);

	const body = splitFrontmatter(markdown)?.body ?? "";
	const orderProblems = checkOrderedPatterns(body, IMPLEMENTER_DOCTRINE);
	assert.deepEqual(orderProblems, [], `${PI_AGENTS_DIR}/implementer.md: ${orderProblems.join("; ")}`);

	// Capa Pi: sin `skills:` en el frontmatter (Pi lo ignora), la precarga va
	// por invocacion en el body: /skill:tdd antes de implementar y
	// /skill:sdd-run cuando el task es una spec.
	assert.match(
		body,
		/`\/skill:tdd`[\s\S]{0,200}antes de (implementar|tocar)|antes de (implementar|tocar)[\s\S]{0,200}`\/skill:tdd`/i,
	);
	assert.match(body, /`\/skill:sdd-run`[\s\S]{0,200}spec|spec[\s\S]{0,200}`\/skill:sdd-run`/i);
	assert.doesNotMatch(markdown, /subagent_type|tool `Agent`|tool `Skill`|chichex-skills:/, "sin restos de la capa de Claude Code");

	const finalReport = body.slice(body.search(/reporte final/i));
	assert.match(finalReport, /comandos/i);
	assert.match(finalReport, /archivos/i);
	assert.match(finalReport, /pol[ií]ticas/i);
	assert.match(finalReport, /no verificado|sin verificar|qued[oó] sin verificar/i);
});

test("issue #44 CA-7: el port Pi de reviewer invoca /skill:code-review con los argumentos exactos, sin --comment ni tool Skill", async () => {
	const markdown = await readRepoFile(`${PI_AGENTS_DIR}/reviewer.md`);
	const verdict = validatePiAgentFrontmatter("reviewer", markdown, "read, grep, find, ls, bash");
	assert.deepEqual(verdict.problems, [], `${PI_AGENTS_DIR}/reviewer.md: ${verdict.problems.join("; ")}`);

	const body = splitFrontmatter(markdown)?.body ?? "";
	const orderProblems = checkOrderedPatterns(body, reviewerDoctrine("pi"));
	assert.deepEqual(orderProblems, [], `${PI_AGENTS_DIR}/reviewer.md: ${orderProblems.join("; ")}`);
	assert.match(body, /`\/skill:code-review/, "invoca el skill de Pi");
	assert.match(body, /argumentos exactos/i);
	assert.doesNotMatch(markdown, /--comment|tool `Skill`|subagent_type/, "sin restos de la capa de Claude Code");
});

test("issue #44 CA-7: scout esta en español y conserva las secciones del ejemplo", async () => {
	const markdown = await readRepoFile(`${PI_AGENTS_DIR}/scout.md`);
	const verdict = validatePiAgentFrontmatter("scout", markdown, "read, grep, find, ls, bash");
	assert.deepEqual(verdict.problems, [], `${PI_AGENTS_DIR}/scout.md: ${verdict.problems.join("; ")}`);

	const body = splitFrontmatter(markdown)?.body ?? "";
	for (const heading of ["## Files Retrieved", "## Key Code", "## Architecture", "## Start Here"]) {
		assert.ok(body.includes(heading), `scout.md: falta la seccion ${heading}`);
	}
	assert.match(body, /Sos un(a)? scout/i, "scout.md en español rioplatense");
	assert.doesNotMatch(body, /You are a scout/, "scout.md no copia el body en ingles");
});

test("issue #44 CA-15: READMEs y contrato documentan la tool subagent, /subagents, los agentes bundleados y el kill al cerrar", async () => {
	const rows: Record<string, RegExp[]> = {
		"README.md": [/cerrar la sesi[oó]n|cierre de (la )?sesi[oó]n|session_shutdown/i],
		"README.en.md": [/session (closes|ends|shutdown)|closing the session|session_shutdown/i],
	};
	for (const [path, extra] of Object.entries(rows)) {
		const markdown = await readRepoFile(path);
		const row = markdown.match(/^\| \*\*`subagent`\*\* \|.*$/m)?.[0];
		assert.ok(row, `${path}: fila de subagent en la tabla de extensiones de Pi`);
		for (const pattern of [
			/single/,
			/parallel/,
			/chain/,
			/agentScope/,
			/background/,
			/\/subagents/,
			/`implementer`/,
			/`reviewer`/,
			/`scout`/,
			...extra,
		]) {
			assert.match(row, pattern, `${path} fila subagent: falta ${pattern}`);
		}
		assert.match(markdown, /pi-extensions\/[\s\S]{0,240}subagent\//, `${path}: el arbol lista pi-extensions/subagent/`);
	}

	const contract = await readRepoFile(".sdd/project.md");
	assert.match(contract, /node --test pi-extensions\/subagent\/\*\.test\.ts/, "contrato: fila del gate de subagent");
	assert.match(contract, /anidamiento/i, "contrato: gap de anidamiento bloqueado");
	assert.match(contract, /`\/new`[\s\S]{0,60}`\/reload`/, "contrato: gap de jobs perdidos en /new y /reload");
	assert.match(contract, /`--tools`[\s\S]{0,160}extensi/i, "contrato: gap de --tools filtrando tools de extension");
	// Literales que pi-package.test.ts assertea sobre el mismo archivo.
	assert.match(contract, /## Politicas de generacion\nSin politicas activas\./);
	assert.match(contract, /## Decisiones humanas\n/);
});

// --- Autotests del port Pi ---------------------------------------------------

test("autotest (issue #44): el censo Pi reporta agente faltante e inesperado por nombre", () => {
	const divergences = diffAgentCensus(
		["./pi-extensions/subagent/agents/implementer.md", "./pi-extensions/subagent/agents/planner.md"],
		EXPECTED_PI_AGENTS,
	);
	assert.deepEqual(divergences.sort(), [
		"agente faltante: ./pi-extensions/subagent/agents/reviewer.md",
		"agente faltante: ./pi-extensions/subagent/agents/scout.md",
		"agente inesperado: ./pi-extensions/subagent/agents/planner.md",
	]);
});

test("autotest (issue #44): el frontmatter Pi rechaza model, skills, tools en implementer, tools distinto y description sin comillas", () => {
	const tools = "read, grep, find, ls, bash";
	const withModel = `---\nname: reviewer\ndescription: "x"\ntools: ${tools}\nmodel: claude-sonnet-4-5\n---\nBody.\n`;
	assert.match(
		validatePiAgentFrontmatter("reviewer", withModel, tools).problems.join("\n"),
		/campo prohibido presente en el port Pi: model/,
	);
	const withSkills = '---\nname: implementer\ndescription: "x"\nskills:\n	 - chichex-skills:tdd\n---\nBody.\n';
	assert.match(
		validatePiAgentFrontmatter("implementer", withSkills, null).problems.join("\n"),
		/campo prohibido presente en el port Pi: skills/,
	);
	const implementerWithTools = '---\nname: implementer\ndescription: "x"\ntools: read\n---\nBody.\n';
	assert.match(
		validatePiAgentFrontmatter("implementer", implementerWithTools, null).problems.join("\n"),
		/tools: no debe declararse/,
	);
	const wrongTools = '---\nname: scout\ndescription: "x"\ntools: read, bash\n---\nBody.\n';
	assert.match(
		validatePiAgentFrontmatter("scout", wrongTools, tools).problems.join("\n"),
		/tools: esperado 'read, grep, find, ls, bash', encontrado 'read, bash'/,
	);
	const missingTools = '---\nname: scout\ndescription: "x"\n---\nBody.\n';
	assert.match(
		validatePiAgentFrontmatter("scout", missingTools, tools).problems.join("\n"),
		/tools: esperado 'read, grep, find, ls, bash', encontrado '\(ausente\)'/,
	);
	const unquoted = `---\nname: scout\ndescription: sin comillas\ntools: ${tools}\n---\nBody.\n`;
	assert.match(validatePiAgentFrontmatter("scout", unquoted, tools).problems.join("\n"), /description:.*comillas dobles/);
	const ok = `---\nname: scout\ndescription: "ok"\ntools: ${tools}\n---\nBody.\n`;
	assert.deepEqual(validatePiAgentFrontmatter("scout", ok, tools).problems, []);
});

test("autotest (issue #44): un patron de doctrina ausente en el port Pi falla con diagnostico", () => {
	const problems = checkOrderedPatterns(
		"Sos un reviewer. Invocá `code-review` sin resumir ni reinterpretar su doctrina.",
		reviewerDoctrine("pi"),
	);
	assert.equal(problems.length, 1);
	assert.match(problems[0] ?? "", /falta o esta fuera de orden/);
	// El patron de publicacion difiere por harness: el texto de Claude no vale para Pi.
	const claudeOnly = "publicar los comments que genera `--comment` es parte del trabajo";
	assert.notDeepEqual(checkOrderedPatterns(claudeOnly, [reviewerDoctrine("pi")[7]!]), []);
	assert.deepEqual(checkOrderedPatterns(claudeOnly, [reviewerDoctrine("claude")[7]!]), []);
});

test("install.sh poda los skills administrados retirados y respeta los no administrados, en todos los destinos", async () => {
	const root = await mkdtemp(join(tmpdir(), "chichex-prune-"));
	try {
		const fixtureRepo = join(root, "repo");
		const { copyFile } = await import("node:fs/promises");
		await mkdir(fixtureRepo, { recursive: true });
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));
		const dests = {
			claude: join(root, "dest", "claude-skills"),
			codex: join(root, "dest", "codex-skills"),
			opencode: join(root, "dest", "opencode-skills"),
			pi: join(root, "dest", "pi-skills"),
		};
		const sentinel = join(root, "dest", "sentinel");
		await mkdir(join(root, "dest"), { recursive: true });
		await writeFile(sentinel, "no tocar");
		for (const harness of Object.keys(dests)) {
			await mkdir(join(fixtureRepo, harness, "live-skill"), { recursive: true });
			await writeFile(join(fixtureRepo, harness, "live-skill", "SKILL.md"), "---\nname: live-skill\n---\n");
		}
		for (const [harness, dest] of Object.entries(dests)) {
			for (const name of ["retired-skill", "user-skill"]) {
				await mkdir(join(dest, name), { recursive: true });
				await writeFile(join(dest, name, "SKILL.md"), `${harness} ${name}`);
			}
			// retired-skill figura en el manifest; user-skill no. "../sentinel" es un
			// nombre hostil que la poda nunca debe resolver fuera del destino.
			await writeFile(join(dest, ".chichex-skills-managed"), "retired-skill\n../sentinel\n");
		}
		const configFile = join(root, "dest", "codex-config.toml");
		await writeFile(
			configFile,
			[
				"# >>> chichex/skills: prefer Codex over Pi >>>",
				"[[skills.config]]",
				`path = "${join(dests.pi, "retired-skill", "SKILL.md")}"`,
				"enabled = false",
				"# <<< chichex/skills: prefer Codex over Pi <<<",
				"",
			].join("\n"),
		);

		const result = runInstaller(join(fixtureRepo, "install.sh"), ["all"], {
			HOME: join(root, "home"),
			CLAUDE_SKILLS_DIR: dests.claude,
			CLAUDE_AGENTS_DIR: join(root, "dest", "agents"),
			CLAUDE_PLUGIN_REGISTRY_FILE: join(root, "no-registry.json"),
			PI_SKILLS_DIR: dests.pi,
			PI_EXTENSIONS_DIR: join(root, "dest", "pi-extensions"),
			PI_THEMES_DIR: join(root, "dest", "pi-themes"),
			CODEX_SKILLS_DIR: dests.codex,
			CODEX_CONFIG_FILE: configFile,
			OPENCODE_SKILLS_DIR: dests.opencode,
			PATH: process.env.PATH ?? "",
		});
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

		for (const [harness, dest] of Object.entries(dests)) {
			assert.equal(await absolutePathExists(join(dest, "retired-skill")), false, `${harness}: el skill administrado retirado debe podarse`);
			assert.ok(await absolutePathExists(join(dest, "user-skill", "SKILL.md")), `${harness}: el skill no administrado debe sobrevivir`);
			assert.ok(await absolutePathExists(join(dest, "live-skill", "SKILL.md")), `${harness}: el skill vigente se instala`);
			const manifest = await readFile(join(dest, ".chichex-skills-managed"), "utf8");
			assert.match(manifest, /^live-skill$/m, `${harness}: el manifest registra el skill vigente`);
			assert.doesNotMatch(manifest, /retired-skill|sentinel/, `${harness}: el manifest se reescribe sin lo podado ni nombres hostiles`);
		}
		assert.equal(await readFile(sentinel, "utf8"), "no tocar", "un nombre hostil del manifest no puede borrar fuera del destino");
		const config = await readFile(configFile, "utf8");
		assert.doesNotMatch(config, /retired-skill/, "el bloque de precedencia de Codex no conserva entradas de skills retirados");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// =============================================================================
// Issue #82: run con subagente — modelo y effort elegibles con recomendado
// =============================================================================

// Doctrina de claude/sdd-run/SKILL.md (CA-1 a CA-7 de la spec #82) y del
// parrafo Claude de claude/sdd-spec/SKILL.md (CA-8). Vive FUERA de los bloques
// compartidos entre harnesses (sdd-run-flow, sdd-run-stack,
// sdd-run-dirty-checkout, sdd-spec-flow) y fuera de la Fase 2, que CA-12 de
// este gate y harness-gate ya acotan. Cada lista se evalua sobre la porcion del
// SKILL.md que le corresponde (ver sliceSddRunSkill); un patron ausente se
// reporta como `<archivo>: falta <patron> en <seccion>`.

const SDD_RUN_SKILL = "claude/sdd-run/SKILL.md";
const SDD_SPEC_SKILL = "claude/sdd-spec/SKILL.md";

const SDD_RUN_SUBAGENT_SYNTAX =
	"/sdd-run [.sdd/specs/<spec>.md | #NN] [--assume] [--no-pr] [--base <branch>] [--subagent] [--model M] [--effort E]";
const SDD_RUN_SUBAGENT_HEADING = "## Run con subagente (solo con --subagent, --model o --effort)";
const SDD_RUN_SHARED_BLOCKS = ["sdd-run-flow", "sdd-run-stack", "sdd-run-design", "sdd-run-dirty-checkout"];

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// CA-1: flags en ## Argumentos (antes del bloque sdd-run-flow).
const SUBAGENT_ARGUMENTS_DOCTRINE: RegExp[] = [
	new RegExp(`^${escapeRegExp(SDD_RUN_SUBAGENT_SYNTAX)}$`, "m"),
	/`--subagent`[^\n]*delega el run completo[^\n]*`implementer`[^\n]*background[^\n]*`\/sdd-run <target> --assume`/,
	/`--model M`[^\n]*`sonnet`[^\n]*`opus`[^\n]*`fable`[^\n]*`haiku`/,
	/`--effort E`[^\n]*`low`[^\n]*`medium`[^\n]*`high`[^\n]*`xhigh`[^\n]*`max`/,
	/sin `--subagent` implican `--subagent`/,
];

// CA-1: atajo del lanzador de la Fase 0.
const SUBAGENT_LAUNCHER_SHORTCUT =
	/Atajo: \/sdd-run <spec\|#NN> \[--assume\] \[--no-pr\] \[--subagent\] \[--model M\] \[--effort E\] saltea este menu\./;

// CA-2: la sesion que recibe --subagent es lanzadora, no corredora.
const SUBAGENT_LAUNCHER_DOCTRINE: RegExp[] = [
	/lanzadora, no corredora/,
	/`gh issue view`/,
	/no ejecuta ninguna fase/,
	/ni crea worktree/,
	/no ofrece la Fase 6/,
	/`--no-pr`[^\n]*`--base`[^\n]*propagan/,
];

// CA-3: derivacion del recomendado. Las dos constantes sueltas son las que los
// autotests mutan (umbral `hasta 9`, effort `high`).
const SUBAGENT_THRESHOLD_ROW = /hasta 10 \| 11 a 16 \| 17 o más/;
const SUBAGENT_EFFORT_ALWAYS = /`xhigh` siempre/;
const SUBAGENT_RECOMMENDATION_DOCTRINE: RegExp[] = [
	/ids únicos `CA-N`/,
	/`## Comportamiento esperado`/,
	/`## Plan de verificacion`/,
	/no pude contar CAs/,
	/`## Plan de entrega`/,
	SUBAGENT_THRESHOLD_ROW,
	/\| Capas \| 1 \| 2 o más \|/,
	/el mayor que proponga cualquier señal/,
	SUBAGENT_EFFORT_ALWAYS,
	/solo avisa/,
	/nunca mueve el escalón/,
];

// CA-4: pregunta de modelo y effort con AskUserQuestion.
const SUBAGENT_QUESTION_DOCTRINE: RegExp[] = [
	/una sola[^\n]*`AskUserQuestion`[^\n]*dos preguntas/i,
	/`sonnet` \/ `opus` \/ `fable` \/ `Modelo de la sesión`/,
	/`medium` \/ `high` \/ `xhigh` \/ `max`/,
	/\(Recomendado\)/,
	/«Other»[^\n]*`haiku`[^\n]*`low`/,
	/`--model` presente saltea/,
	/`--effort` presente saltea/,
	/`--assume`[^\n]*nunca se pregunta/,
	/no pasar `model`/,
	/`CLAUDE_CODE_SUBAGENT_MODEL`/,
	/`effort` se pasa siempre/,
];

// CA-5: lanzamiento de la tool Agent con model y effort.
const SUBAGENT_LAUNCH_DOCTRINE: RegExp[] = [
	/subagent_type: "implementer"/,
	/run_in_background: true/,
	/pide explícitamente pasar `effort`/,
	/`\/sdd-run <target> --assume`/,
	/subagente: <modelo> · <effort>/,
	/subagente: modelo de la sesión · <effort>/,
	/`general-purpose`[^\n]*anunciarlo/,
	/no acepta `effort`[^\n]*lanzar sin él/,
];

// CA-6: traza visible al lanzar y al relevar.
const SUBAGENT_TRACE_LINE =
	/Subagente implementer: modelo <m> \(<escalón>: <N> CAs · <k> capas\) · effort <e> · verificabilidad: ALTA <a> · MEDIA\/BAJA <b> · NULA <c>/;
const SUBAGENT_TRACE_DOCTRINE: RegExp[] = [
	SUBAGENT_TRACE_LINE,
	/al llegar la notificación[^\n]*modelo y effort/i,
	/Sin `--subagent`, `--model` ni `--effort`[^\n]*como hoy/,
];

// CA-7: ownership coherente con la sesion lanzadora.
const SUBAGENT_OWNERSHIP_DOCTRINE: RegExp[] = [
	/`implementer` lanzado por `--subagent` o por `sdd-run con subagente`/,
	/NO delegar "completar toda la spec"/,
	/La sesión que lanza con `--subagent` no es el agente que corre/,
];

// CA-8: el parrafo Claude de sdd-spec (fuera de sdd-spec-flow) reusa la
// doctrina y conserva los literales que harness-gate ya exige.
const SDD_SPEC_SUBAGENT_DOCTRINE: RegExp[] = [
	/sigue la sección «Run con subagente» de `sdd-run`/,
	/dos preguntas/,
	/subagent_type: "implementer"/,
	/run_in_background/,
	/`model` y `effort`/,
	/`general-purpose`[\s\S]*(anunci|avis)/i,
	/--assume/,
];

function sliceBetween(markdown: string, start: RegExp, end: RegExp): string | null {
	const startMatch = start.exec(markdown);
	if (!startMatch) return null;
	const rest = markdown.slice(startMatch.index);
	const endMatch = end.exec(rest.slice(startMatch[0].length));
	if (!endMatch) return rest;
	return rest.slice(0, startMatch[0].length + endMatch.index);
}

export interface SddRunSubagentSlices {
	argumentos: string | null;
	fase0: string | null;
	section: string | null;
	ownership: string | null;
}

export function sliceSddRunSkill(markdown: string): SddRunSubagentSlices {
	return {
		argumentos: sliceBetween(markdown, /^## Argumentos$/m, /\n(?:## |<!-- sdd-run-flow:start -->)/),
		fase0: sliceBetween(markdown, /^## Fase 0 /m, /\n## /),
		section: sliceBetween(markdown, /^## Run con subagente/m, /\n## /),
		ownership: sliceBetween(markdown, /^### Ownership y tareas$/m, /\n##/),
	};
}

export function missingPatterns(path: string, text: string | null, patterns: RegExp[], where: string): string[] {
	if (text === null) return [`${path}: falta la sección ${where}`];
	return patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `${path}: falta ${pattern} en ${where}`);
}

// CA-2: la seccion vive entre `<!-- sdd-run-stack:end -->` y `## Fase 0`, fuera
// de todo bloque compartido y sin contener markers de bloque.
export function checkSubagentSectionPlacement(path: string, markdown: string): string[] {
	const heading = markdown.search(/^## Run con subagente/m);
	if (heading === -1) return [`${path}: falta la sección ${SDD_RUN_SUBAGENT_HEADING}`];
	const problems: string[] = [];
	if (!markdown.includes(SDD_RUN_SUBAGENT_HEADING)) {
		problems.push(`${path}: el heading de Run con subagente no es literalmente '${SDD_RUN_SUBAGENT_HEADING}'`);
	}
	const fase0 = markdown.search(/^## Fase 0 /m);
	if (fase0 === -1 || heading > fase0) problems.push(`${path}: ## Run con subagente debe ir antes de ## Fase 0`);
	const stackEnd = markdown.indexOf("<!-- sdd-run-stack:end -->");
	if (stackEnd === -1 || heading < stackEnd) {
		problems.push(`${path}: ## Run con subagente debe ir después de ## Entrega por capas (marker sdd-run-stack:end)`);
	}
	for (const block of SDD_RUN_SHARED_BLOCKS) {
		const start = markdown.indexOf(`<!-- ${block}:start -->`);
		const end = markdown.indexOf(`<!-- ${block}:end -->`);
		if (start !== -1 && end !== -1 && heading > start && heading < end) {
			problems.push(`${path}: ## Run con subagente está dentro del bloque compartido ${block}`);
		}
	}
	if (/<!-- sdd-run-/.test(sliceSddRunSkill(markdown).section ?? "")) {
		problems.push(`${path}: ## Run con subagente contiene un marker de bloque compartido`);
	}
	return problems;
}

export function checkSddRunSubagentDoctrine(path: string, markdown: string): string[] {
	const slices = sliceSddRunSkill(markdown);
	const sectionDoctrine = [
		...SUBAGENT_LAUNCHER_DOCTRINE,
		...SUBAGENT_RECOMMENDATION_DOCTRINE,
		...SUBAGENT_QUESTION_DOCTRINE,
		...SUBAGENT_LAUNCH_DOCTRINE,
		...SUBAGENT_TRACE_DOCTRINE,
	];
	return [
		...missingPatterns(path, slices.argumentos, SUBAGENT_ARGUMENTS_DOCTRINE, "## Argumentos"),
		...missingPatterns(path, slices.fase0, [SUBAGENT_LAUNCHER_SHORTCUT], "## Fase 0"),
		...checkSubagentSectionPlacement(path, markdown),
		...(slices.section === null ? [] : missingPatterns(path, slices.section, sectionDoctrine, "## Run con subagente")),
		...missingPatterns(path, slices.ownership, SUBAGENT_OWNERSHIP_DOCTRINE, "### Ownership y tareas"),
	];
}

// SKILL.md sintetico minimo que cumple toda la doctrina; los autotests lo
// mutan (sin tabla, `hasta 9`, effort `high`, seccion mal ubicada).
interface SyntheticSddRunOptions {
	thresholds?: string | null;
	effort?: string;
	sectionAfterFase0?: boolean;
}

export function syntheticSddRunSkill({
	thresholds = "| CAs | hasta 10 | 11 a 16 | 17 o más |\n  | Capas | 1 | 2 o más | — |",
	effort = "xhigh",
	sectionAfterFase0 = false,
}: SyntheticSddRunOptions = {}): string {
	const table =
		thresholds === null
			? ""
			: [
					"- **Tabla de umbrales** (escalón = el mayor que proponga cualquier señal):",
					"",
					"  | Señal | `sonnet` | `opus` | `fable` |",
					"  |---|---|---|---|",
					`  ${thresholds}`,
					"",
				].join("\n");
	const section = [
		SDD_RUN_SUBAGENT_HEADING,
		"",
		"La sesión que recibe `--subagent` es **lanzadora, no corredora**: resuelve el target (leyendo el body con `gh issue view` cuando es issue), no ejecuta ninguna fase del run ni crea worktree ni branch, y no ofrece la Fase 6. `--no-pr` y `--base` se propagan tal cual al prompt del subagente.",
		"",
		"- **Conteo de CAs**: ids únicos `CA-N` en los headings de `## Comportamiento esperado`; si da 0, las filas `| CA-N |` de `## Plan de verificacion`; si ambos dan 0, el recomendado es `opus` con el aviso «no pude contar CAs».",
		"- **Capas**: filas numeradas de la tabla de `## Plan de entrega`; sin sección, 1 capa.",
		table,
		`- **Effort recomendado: \`${effort}\` siempre**, independiente del escalón.`,
		"- **Verificabilidad solo avisa**: nunca mueve el escalón.",
		"- Interactivo y sin flags: **una sola** llamada a `AskUserQuestion` con **dos preguntas**: modelo, con opciones `sonnet` / `opus` / `fable` / `Modelo de la sesión`, el recomendado primero y marcado `(Recomendado)`; y effort, con opciones `medium` / `high` / `xhigh` / `max`. «Other» cubre `haiku` y `low`.",
		"- `--model` presente saltea la pregunta de modelo; `--effort` presente saltea la de effort.",
		"- Con `--assume` nunca se pregunta.",
		"- `Modelo de la sesión` significa no pasar `model` a la tool `Agent` (hereda el de la sesión o `CLAUDE_CODE_SUBAGENT_MODEL`); `effort` se pasa siempre.",
		'- Lanzar la tool `Agent` con `subagent_type: "implementer"`, `run_in_background: true`, `model` y `effort`. Este skill pide explícitamente pasar `effort`.',
		"- El prompt pide `/sdd-run <target> --assume` y la línea `subagente: <modelo> · <effort>` (con `Modelo de la sesión`, `subagente: modelo de la sesión · <effort>`).",
		"- Si el tipo `implementer` no está disponible, usar `general-purpose` y anunciarlo. Si la tool no acepta `effort`, anunciarlo y lanzar sin él.",
		"- Traza: `Subagente implementer: modelo <m> (<escalón>: <N> CAs · <k> capas) · effort <e> · verificabilidad: ALTA <a> · MEDIA/BAJA <b> · NULA <c>`.",
		"- Al llegar la notificación del subagente, la sesión releva el PR y el reporte repitiendo modelo y effort.",
		"- Sin `--subagent`, `--model` ni `--effort`, nada de lo anterior aparece y el run corre como hoy.",
		"",
	].join("\n");
	const fase0 = [
		"## Fase 0 — Lanzador (solo con `/sdd-run` pelado)",
		"",
		"```text",
		"Atajo: /sdd-run <spec|#NN> [--assume] [--no-pr] [--subagent] [--model M] [--effort E] saltea este menu.",
		"```",
		"",
	].join("\n");
	return [
		"---\nname: sdd-run\ndescription: sintético\n---",
		"",
		"## Argumentos",
		"",
		"```text",
		SDD_RUN_SUBAGENT_SYNTAX,
		"```",
		"",
		"- `--assume` — cero preguntas.",
		"- `--subagent` — delega el run completo a un subagente `implementer` en background que corre `/sdd-run <target> --assume`; la sesión queda libre.",
		"- `--model M` — modelo del subagente; `M` es un alias de la tool `Agent`: `sonnet`, `opus`, `fable` o `haiku`.",
		"- `--effort E` — effort del subagente; `E` es `low`, `medium`, `high`, `xhigh` o `max`.",
		"- `--model` o `--effort` sin `--subagent` implican `--subagent`.",
		"",
		"<!-- sdd-run-flow:start -->",
		"### Flujo sin fricción",
		"<!-- sdd-run-flow:end -->",
		"",
		"<!-- sdd-run-stack:start -->",
		"## Entrega por capas",
		"<!-- sdd-run-stack:end -->",
		"",
		sectionAfterFase0 ? fase0 + section : section + fase0,
		"## Fase 3 — Implementar",
		"",
		"### Ownership y tareas",
		"",
		'- El agente que corre el run (la sesión principal, o el `implementer` lanzado por `--subagent` o por `sdd-run con subagente` de `sdd-spec`) conserva ownership. NO delegar "completar toda la spec".',
		"- La sesión que lanza con `--subagent` no es el agente que corre.",
		"",
		"### Timeouts",
		"",
	].join("\n");
}

test("issue #82 CA-1: sdd-run declara --subagent, --model M y --effort E en ## Argumentos y en el atajo de la Fase 0", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const slices = sliceSddRunSkill(markdown);
	const problems = [
		...missingPatterns(SDD_RUN_SKILL, slices.argumentos, SUBAGENT_ARGUMENTS_DOCTRINE, "## Argumentos"),
		...missingPatterns(SDD_RUN_SKILL, slices.fase0, [SUBAGENT_LAUNCHER_SHORTCUT], "## Fase 0"),
	];
	assert.deepEqual(problems, [], problems.join("\n"));
	// La frase que sigue al heading de la Fase 0 no cambia (CA-1).
	assert.match(slices.fase0 ?? "", /Dispara SOLO cuando los argumentos vienen vacíos\. Si trajo spec, issue o flags, saltear\./);
});

test("issue #82 CA-2: la sección Run con subagente vive entre Entrega por capas y la Fase 0, fuera de los bloques compartidos, y declara a la sesión lanzadora", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const problems = [
		...checkSubagentSectionPlacement(SDD_RUN_SKILL, markdown),
		...missingPatterns(SDD_RUN_SKILL, sliceSddRunSkill(markdown).section, SUBAGENT_LAUNCHER_DOCTRINE, "## Run con subagente"),
	];
	assert.deepEqual(problems, [], problems.join("\n"));
	// CA-9: la Fase 2 sigue sin nombrar implementer/reviewer (lo gatea CA-12 de
	// este archivo) y los bloques compartidos no ganan la doctrina nueva.
	for (const block of SDD_RUN_SHARED_BLOCKS) {
		const shared = markdown.match(new RegExp(`<!-- ${block}:start -->([\\s\\S]*?)<!-- ${block}:end -->`))?.[1] ?? "";
		assert.ok(shared, `${SDD_RUN_SKILL}: bloque ${block} presente`);
		assert.doesNotMatch(shared, /--subagent|--effort|`--model`/, `${SDD_RUN_SKILL}: el bloque compartido ${block} no debe ganar la doctrina del run con subagente`);
	}
});

test("issue #82 CA-3: la sección deriva el recomendado por CAs y capas con la tabla de umbrales, xhigh siempre y verificabilidad que solo avisa", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const problems = missingPatterns(SDD_RUN_SKILL, sliceSddRunSkill(markdown).section, SUBAGENT_RECOMMENDATION_DOCTRINE, "## Run con subagente");
	assert.deepEqual(problems, [], problems.join("\n"));
});

test("issue #82 CA-4: una sola AskUserQuestion con dos preguntas, Modelo de la sesión, (Recomendado), flags que saltean y --assume que no pregunta", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const problems = missingPatterns(SDD_RUN_SKILL, sliceSddRunSkill(markdown).section, SUBAGENT_QUESTION_DOCTRINE, "## Run con subagente");
	assert.deepEqual(problems, [], problems.join("\n"));
});

test("issue #82 CA-5: lanza la tool Agent con implementer, background, model y effort explícito, y el fence Run completo no cambia", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const problems = missingPatterns(SDD_RUN_SKILL, sliceSddRunSkill(markdown).section, SUBAGENT_LAUNCH_DOCTRINE, "## Run con subagente");
	assert.deepEqual(problems, [], problems.join("\n"));
	// La línea `subagente:` se pide por prompt: el bloque de código `Run completo`
	// (compartido entre harnesses, lo compara harness-gate) no la incorpora.
	const report = markdown.match(/```text\nRun completo:[\s\S]*?```/)?.[0] ?? "";
	assert.ok(report, `${SDD_RUN_SKILL}: fence Run completo presente`);
	assert.doesNotMatch(report, /subagente/, `${SDD_RUN_SKILL}: el fence Run completo no debe cambiar`);
});

test("issue #82 CA-6: la traza Subagente implementer se imprime al lanzar y al relevar, y sin flags el run corre como hoy", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const problems = missingPatterns(SDD_RUN_SKILL, sliceSddRunSkill(markdown).section, SUBAGENT_TRACE_DOCTRINE, "## Run con subagente");
	assert.deepEqual(problems, [], problems.join("\n"));
});

test("issue #82 CA-7: Ownership y tareas nombra al implementer lanzado por --subagent y a la sesión lanzadora que no corre", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const problems = missingPatterns(SDD_RUN_SKILL, sliceSddRunSkill(markdown).ownership, SUBAGENT_OWNERSHIP_DOCTRINE, "### Ownership y tareas");
	assert.deepEqual(problems, [], problems.join("\n"));
});

// Review #83 (h9): la funcion compuesta que validan los autotests corre tambien
// sobre el SKILL.md real, asi una lista sumada a checkSddRunSubagentDoctrine y
// no a un test por CA sigue gateando el archivo real.
test("issue #82 CA-10: checkSddRunSubagentDoctrine corre sobre el claude/sdd-run/SKILL.md real sin hallazgos", async () => {
	const markdown = await readRepoFile(SDD_RUN_SKILL);
	const problems = checkSddRunSubagentDoctrine(SDD_RUN_SKILL, markdown);
	assert.deepEqual(problems, [], problems.join("\n"));
});

test("issue #82 CA-8: el párrafo Claude de sdd-spec reusa la sección Run con subagente de sdd-run fuera de sdd-spec-flow", async () => {
	const markdown = await readRepoFile(SDD_SPEC_SKILL);
	const flowEnd = markdown.indexOf("<!-- sdd-spec-flow:end -->");
	const gateStart = markdown.indexOf("<!-- sdd-spec-publication-gate:start -->");
	assert.ok(flowEnd !== -1 && gateStart !== -1 && flowEnd < gateStart, `${SDD_SPEC_SKILL}: markers sdd-spec-flow:end y sdd-spec-publication-gate:start`);
	const claudeParagraph = markdown.slice(flowEnd, gateStart);
	const problems = missingPatterns(SDD_SPEC_SKILL, claudeParagraph, SDD_SPEC_SUBAGENT_DOCTRINE, "párrafo Claude del menú final");
	assert.deepEqual(problems, [], problems.join("\n"));
	const flow = markdown.match(/<!-- sdd-spec-flow:start -->([\s\S]*?)<!-- sdd-spec-flow:end -->/)?.[1] ?? "";
	assert.doesNotMatch(flow, /Run con subagente|`effort`|subagent_type/, `${SDD_SPEC_SKILL}: el bloque compartido sdd-spec-flow no debe ganar la doctrina Claude`);
});

test("issue #82 CA-11: READMEs y contrato documentan --subagent, modelo/effort con recomendado, y el contrato lleva el conteo real del gate", async () => {
	const readmeEs = await readRepoFile("README.md");
	const readmeEn = await readRepoFile("README.en.md");
	const rowEs = readmeEs.match(/^\| \*\*`sdd-run`\*\* \|.*$/m)?.[0] ?? "";
	const rowEn = readmeEn.match(/^\| \*\*`sdd-run`\*\* \|.*$/m)?.[0] ?? "";
	assert.ok(rowEs, "README.md: fila sdd-run");
	assert.ok(rowEn, "README.en.md: fila sdd-run");
	for (const pattern of [/--subagent/, /modelo[^|]*effort/i, /recomendado/i, /`--model`\/`--effort`/, /`xhigh`/]) {
		assert.match(rowEs, pattern, `README.md fila sdd-run: falta ${pattern}`);
	}
	for (const pattern of [/--subagent/, /model[^|]*effort/i, /recommended/i, /`--model`\/`--effort`/, /`xhigh`/]) {
		assert.match(rowEn, pattern, `README.en.md fila sdd-run: falta ${pattern}`);
	}
	const specRowEs = readmeEs.match(/^\| \*\*`sdd-spec`\*\* \|.*$/m)?.[0] ?? "";
	const specRowEn = readmeEn.match(/^\| \*\*`sdd-spec`\*\* \|.*$/m)?.[0] ?? "";
	assert.match(specRowEs, /`sdd-run con subagente`[^|]*misma elección/i, "README.md fila sdd-spec: el menú de Claude usa la misma elección de modelo y effort");
	assert.match(specRowEn, /`sdd-run con subagente`[^|]*same[^|]*(choice|selection)/i, "README.en.md fila sdd-spec: the Claude menu uses the same model/effort choice");

	const contract = await readRepoFile(".sdd/project.md");
	const gateRow = contract.match(/^\| gate anti-drift de agentes de plugin \|.*$/m)?.[0] ?? "";
	assert.ok(gateRow, ".sdd/project.md: fila del gate de agentes");
	for (const pattern of [/--subagent/, /modelo[^|]*effort/i, /umbrales/i]) {
		assert.match(gateRow, pattern, `.sdd/project.md fila del gate de agentes: falta ${pattern}`);
	}
	// El total de la fila coincide con los tests declarados en este archivo
	// (todos son `test(` de nivel superior; ninguno se skipea). El numerador
	// («N pasando») no se compara con un conteo estático, porque contar `test(`
	// no observa que pasen: eso lo valida la corrida de CI de este mismo gate.
	const declared = gateRow.match(/^\|(?:[^|]*\|){5} \d+\/(\d+);/);
	assert.ok(declared, ".sdd/project.md fila del gate de agentes: conteo `N/N;` al inicio de las notas");
	const self = await readRepoFile("pi-extensions/agents-gate/agents-gate.test.ts");
	const actualTests = (self.match(/^test\(/gm) ?? []).length;
	assert.equal(Number(declared?.[1]), actualTests, `.sdd/project.md declara ${declared?.[1]} tests totales y el gate tiene ${actualTests}`);
});

// --- Autotests del gate del run con subagente (CA-10) ------------------------

test("autotest (issue #82): el SKILL.md sintético completo pasa el gate del run con subagente", () => {
	assert.deepEqual(checkSddRunSubagentDoctrine("sintetico/SKILL.md", syntheticSddRunSkill()), []);
});

test("autotest (issue #82): un SKILL.md sintético sin la tabla de umbrales falla nombrando el archivo y el patrón ausente", () => {
	const problems = checkSddRunSubagentDoctrine("sintetico/SKILL.md", syntheticSddRunSkill({ thresholds: null }));
	assert.notDeepEqual(problems, []);
	for (const problem of problems) assert.match(problem, /^sintetico\/SKILL\.md: falta /);
	assert.ok(problems.includes(`sintetico/SKILL.md: falta ${SUBAGENT_THRESHOLD_ROW} en ## Run con subagente`), problems.join("\n"));
	assert.ok(problems.includes(`sintetico/SKILL.md: falta ${/\| Capas \| 1 \| 2 o más \|/} en ## Run con subagente`), problems.join("\n"));
});

test("autotest (issue #82): un umbral distinto (hasta 9) y un effort recomendado high fallan con el patrón exacto", () => {
	const nine = checkSddRunSubagentDoctrine(
		"sintetico/SKILL.md",
		syntheticSddRunSkill({ thresholds: "| CAs | hasta 9 | 10 a 16 | 17 o más |\n  | Capas | 1 | 2 o más | — |" }),
	);
	assert.deepEqual(nine, [`sintetico/SKILL.md: falta ${SUBAGENT_THRESHOLD_ROW} en ## Run con subagente`]);
	const high = checkSddRunSubagentDoctrine("sintetico/SKILL.md", syntheticSddRunSkill({ effort: "high" }));
	assert.deepEqual(high, [`sintetico/SKILL.md: falta ${SUBAGENT_EFFORT_ALWAYS} en ## Run con subagente`]);
});

test("autotest (issue #82): la sección Run con subagente después de la Fase 0 o ausente falla con diagnóstico de ubicación", () => {
	const misplaced = checkSubagentSectionPlacement("sintetico/SKILL.md", syntheticSddRunSkill({ sectionAfterFase0: true }));
	assert.deepEqual(misplaced, ["sintetico/SKILL.md: ## Run con subagente debe ir antes de ## Fase 0"]);
	const withoutSection = syntheticSddRunSkill().replace(/## Run con subagente[\s\S]*?(?=\n## Fase 0)/, "");
	assert.deepEqual(checkSubagentSectionPlacement("sintetico/SKILL.md", withoutSection), [
		`sintetico/SKILL.md: falta la sección ${SDD_RUN_SUBAGENT_HEADING}`,
	]);
});
