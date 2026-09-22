// Gate anti-drift del layer de agentes de plugin de Claude Code (spec
// .sdd/specs/subagentes-claude.md).
//
// Censa agents/*.md sobre archivos TRACKEADOS en git (no el working tree),
// valida el frontmatter de cada agente y verifica los textos doctrinales que
// las CA-1 a CA-6, CA-11 y CA-12 exigen en claude/sdd-review-loop/SKILL.md,
// claude/sdd-run/SKILL.md, .claude-plugin/plugin.json, ambos READMEs,
// harness-port y el contrato. Falla con diagnostico nombrando el archivo
// ante cada forma de drift. No hay extension Pi en este directorio: es
// solo-tests, igual que pi-extensions/sdd-review-loop.

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

function gitTrackedAgentPaths(): Set<string> | null {
	const result = spawnSync("git", ["ls-files", "--", "agents"], {
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

// --- Doctrina de sdd-review-loop y plugin.json ------------------------------

export function checkSubagentTypesDeclared(markdown: string): string[] {
	const problems: string[] = [];
	if (!/subagent_type:\s*"reviewer"/.test(markdown)) {
		problems.push('subagent_type ausente en sdd-review-loop: falta subagent_type: "reviewer" para el revisor');
	}
	if (!/subagent_type:\s*"implementer"/.test(markdown)) {
		problems.push('subagent_type ausente en sdd-review-loop: falta subagent_type: "implementer" para el corrector');
	}
	return problems;
}

export function checkDegradationLine(markdown: string): string[] {
	const pattern =
		/no est[aá] disponible[\s\S]{0,200}?agente por defecto[\s\S]{0,160}?anuncia|agente por defecto[\s\S]{0,160}?anuncia[\s\S]{0,160}?nunca aborta/i;
	return pattern.test(markdown) ? [] : ["línea de degradación ausente en sdd-review-loop"];
}

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

	// Orden exacto exigido por CA-1: cada patron tiene que aparecer despues del anterior.
	const orderedDoctrine: RegExp[] = [
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
	const orderProblems = checkOrderedPatterns(body, orderedDoctrine);
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

	const orderedDoctrine: RegExp[] = [
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
		/--comment[\s\S]{0,200}parte[\s\S]{0,20}del trabajo/i,
		/```json/,
		/no concluyente/i,
	];
	const orderProblems = checkOrderedPatterns(body, orderedDoctrine);
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

test("CA-4, CA-5, CA-6: sdd-review-loop nombra subagent_type, degrada sin abortar y no fija model", async () => {
	const markdown = await readRepoFile("claude/sdd-review-loop/SKILL.md");

	assert.deepEqual(checkSubagentTypesDeclared(markdown), []);
	assert.deepEqual(checkDegradationLine(markdown), []);

	// Doctrina que CA-4 exige preservar intacta.
	assert.match(markdown, /Nunca corren dos subagentes de la misma ronda en paralelo/);
	assert.match(markdown, /no lee el diff/);
	assert.match(markdown, /n[uú]mero o URL can[oó]nica/);

	// El reporte final de Fase 4 lleva el dato de degradacion como linea propia.
	const reportBlock = markdown.slice(markdown.indexOf("SDD-REVIEW-LOOP <TERMINADO|DETENIDO>"));
	assert.match(reportBlock.slice(0, 800), /tipos de agente/i);

	// CA-6: ningun agente custom fija model; el flag de invocacion sigue ganando.
	assert.match(markdown, /gana sobre cualquier `model`|gana sobre[\s\S]{0,40}frontmatter/i);
	assert.match(markdown, /--model M`[^\n]*ambos/);
});

test("CA-10: ningun agents/ bajo claude/, opencode/ o pi/; los sidecars de codex no disparan falso positivo", () => {
	const tracked = spawnSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" });
	assert.equal(tracked.status, 0);
	const allPaths = tracked.stdout.split("\n").filter(Boolean);
	const forbidden = forbiddenAgentDirs(allPaths);
	assert.deepEqual(forbidden, [], `agents/ prohibido fuera de la raiz: ${forbidden.join(", ")}`);

	const codexSidecars = allPaths.filter((path) => /^codex\/[^/]+\/agents\/openai\.yaml$/.test(path));
	assert.ok(codexSidecars.length >= 17, "los sidecars de codex siguen presentes y no los toca este gate");
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
	assert.match(harnessPort, /no se portea|no viaja/i);

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

test("autotest: subagent_type ausente en sdd-review-loop falla con diagnostico por rol", () => {
	assert.deepEqual(checkSubagentTypesDeclared("sin ninguna mencion"), [
		'subagent_type ausente en sdd-review-loop: falta subagent_type: "reviewer" para el revisor',
		'subagent_type ausente en sdd-review-loop: falta subagent_type: "implementer" para el corrector',
	]);
	assert.deepEqual(checkSubagentTypesDeclared('subagent_type: "reviewer" nada mas'), [
		'subagent_type ausente en sdd-review-loop: falta subagent_type: "implementer" para el corrector',
	]);
});

test("autotest: linea de degradacion ausente falla con diagnostico", () => {
	assert.deepEqual(checkDegradationLine("doctrina sin mencionar que pasa si el tipo no existe"), [
		"línea de degradación ausente en sdd-review-loop",
	]);
	assert.deepEqual(
		checkDegradationLine(
			"si el tipo no está disponible en la instalación, la ronda sigue con el agente por defecto de la sesión y lo anuncia en el reporte",
		),
		[],
	);
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
