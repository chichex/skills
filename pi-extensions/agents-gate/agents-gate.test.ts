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
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

export function checkPluginDeclaresAgents(pluginJsonText: string): string[] {
	let parsed: { agents?: unknown };
	try {
		parsed = JSON.parse(pluginJsonText) as { agents?: unknown };
	} catch {
		return ["plugin.json: JSON invalido"];
	}
	const agents = parsed.agents;
	if (!Array.isArray(agents) || !agents.includes("./agents")) {
		return ["declaración de agents ausente en plugin.json"];
	}
	return [];
}

// --- CA-10: ningun agents/ bajo claude/, opencode/ o pi/ --------------------

export function forbiddenAgentDirs(paths: string[]): string[] {
	return paths.filter((path) => /^(claude|opencode|pi)\/[^/]+\/agents\//.test(path));
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

test("CA-1: agents/implementer.md tiene frontmatter valido, skills: [chichex-skills:tdd] y body en orden", async () => {
	const markdown = await readRepoFile("agents/implementer.md");
	const verdict = validateAgentFrontmatter("implementer", markdown, ["chichex-skills:tdd"]);
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
		/`## Comandos`/,
		/tests? primero[\s\S]{0,120}rojo/i,
		/tres intentos honestos/i,
		/prohibid[oa][\s\S]{0,40}debilitar|nunca aflojes un assert/i,
		/prohibid[oa][\s\S]{0,40}ampliar el alcance/i,
		/reporte final/i,
	];
	let cursor = -1;
	for (const pattern of orderedDoctrine) {
		const match = body.slice(cursor + 1).match(pattern);
		assert.ok(match, `agents/implementer.md: falta o esta fuera de orden ${pattern}`);
		const foundAt = cursor + 1 + (match.index ?? 0);
		assert.ok(foundAt > cursor, `agents/implementer.md: ${pattern} aparece antes de lo esperado`);
		cursor = foundAt;
	}

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
		/```json/,
		/no concluyente/i,
	];
	let cursor = -1;
	for (const pattern of orderedDoctrine) {
		const match = body.slice(cursor + 1).match(pattern);
		assert.ok(match, `agents/reviewer.md: falta o esta fuera de orden ${pattern}`);
		const foundAt = cursor + 1 + (match.index ?? 0);
		assert.ok(foundAt > cursor, `agents/reviewer.md: ${pattern} aparece antes de lo esperado`);
		cursor = foundAt;
	}
});

test("CA-3: plugin.json declara agents junto a skills, con description identica a marketplace.json", async () => {
	const pluginText = await readRepoFile(".claude-plugin/plugin.json");
	const problems = checkPluginDeclaresAgents(pluginText);
	assert.deepEqual(problems, []);
	const plugin = JSON.parse(pluginText) as { skills?: unknown; agents?: unknown; description: string };
	assert.deepEqual(plugin.skills, ["./claude"], "skills existente intacto");
	assert.deepEqual(plugin.agents, ["./agents"]);

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
	assert.doesNotMatch(markdown, /subagents en repos grandes\)/);
	assert.match(markdown, /subagents `Explore` con la tool `Agent`/);
	assert.doesNotMatch(markdown, /subagents `implementer`|subagents `reviewer`/);
});

test("CA-7: install.sh copia agents/*.md a CLAUDE_AGENTS_DIR en 'claude' y en 'all', sin tocar el home real", async () => {
	for (const which of ["claude", "all"]) {
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

			assert.equal(
				await absolutePathExists(join(process.env.HOME ?? "", ".claude", "agents", "implementer.md")),
				false,
				"install.sh no debe escribir en el HOME real del proceso",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test("CA-8: install.sh claude avisa la sombra del plugin chichex-skills solo cuando esta registrado", async () => {
	const root = await mkdtemp(join(tmpdir(), "chichex-claude-shadow-"));
	try {
		const fixtureRepo = join(root, "repo");
		await mkdir(join(fixtureRepo, "agents"), { recursive: true });
		for (const name of ["implementer.md", "reviewer.md"]) {
			await writeFile(join(fixtureRepo, "agents", name), await readFile(repoPath(`agents/${name}`), "utf8"));
		}
		const { copyFile } = await import("node:fs/promises");
		await copyFile(repoPath("install.sh"), join(fixtureRepo, "install.sh"));

		const registryWith = join(root, "installed_plugins_with.json");
		const registryWithout = join(root, "installed_plugins_without.json");
		await writeFile(
			registryWith,
			JSON.stringify({ version: 2, plugins: { "chichex-skills@chichex": [{ scope: "user" }] } }),
		);
		await writeFile(registryWithout, JSON.stringify({ version: 2, plugins: { "other-plugin@marketplace": [] } }));

		const baseEnv = {
			HOME: join(root, "home"),
			CLAUDE_SKILLS_DIR: join(root, "dest", "skills"),
			CLAUDE_AGENTS_DIR: join(root, "dest", "agents"),
			PATH: process.env.PATH ?? "",
		};

		const withPlugin = runInstaller(join(fixtureRepo, "install.sh"), ["claude"], {
			...baseEnv,
			CLAUDE_PLUGIN_REGISTRY_FILE: registryWith,
		});
		assert.equal(withPlugin.status, 0, `${withPlugin.stdout}\n${withPlugin.stderr}`);
		assert.match(
			`${withPlugin.stdout}\n${withPlugin.stderr}`,
			/chichex-skills[\s\S]{0,80}ya est[aá] instalado/i,
			"debe avisar cuando el plugin esta registrado",
		);
		assert.ok(
			await absolutePathExists(join(root, "dest", "agents", "implementer.md")),
			"el aviso no debe abortar la instalacion de agents/",
		);

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

test("autotest: declaracion de agents ausente en plugin.json falla con diagnostico", () => {
	assert.deepEqual(checkPluginDeclaresAgents(JSON.stringify({ skills: ["./claude"] })), [
		"declaración de agents ausente en plugin.json",
	]);
	assert.deepEqual(checkPluginDeclaresAgents(JSON.stringify({ skills: ["./claude"], agents: ["./agents"] })), []);
	assert.deepEqual(checkPluginDeclaresAgents("{ esto no es json"), ["plugin.json: JSON invalido"]);
});

test("autotest: un agents/ de scratch bajo claude/, opencode/ o pi/ se detecta; los sidecars de codex no", () => {
	const paths = [
		"claude/quick-run/agents/scratch.md",
		"opencode/grill/agents/scratch.yaml",
		"pi/tdd/agents/scratch.md",
		"codex/tdd/agents/openai.yaml",
		"agents/implementer.md",
	];
	assert.deepEqual(forbiddenAgentDirs(paths).sort(), [
		"claude/quick-run/agents/scratch.md",
		"opencode/grill/agents/scratch.yaml",
		"pi/tdd/agents/scratch.md",
	]);
});
