import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ACTIONABLE_ROUTE_CONTRACT } from "../workflow-orchestrator/route-contract.ts";

const HARNESSES = ["claude", "codex", "opencode", "pi"] as const;
type Harness = (typeof HARNESSES)[number];

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

export function artifactAwareBlock(markdown: string): string {
	const match = markdown.match(
		/<!-- artifact-aware:start -->\n([\s\S]*?)\n<!-- artifact-aware:end -->/,
	);
	assert.ok(match?.[1], "bloque normativo artifact-aware presente");
	return match[1];
}

interface InteractionDifferences {
	invocation: Record<Harness, string>;
	questionTool: Record<Harness, string>;
}

export function parseInteractionDifferences(markdown: string): InteractionDifferences {
	const block = markdown.match(
		/<!-- interaction-differences:start -->\n([\s\S]*?)\n<!-- interaction-differences:end -->/,
	);
	assert.ok(block?.[1], "tabla normativa de interacción presente");
	const rows = block[1].split("\n").filter((line) => line.startsWith("|"));
	const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", ""));
	const header = cells(rows[0] ?? "");
	const indexes = new Map(header.map((name, index) => [name, index]));
	const row = (name: string): string[] => cells(rows.find((line) => cells(line)[0] === name) ?? "");
	const invocations = row("invocacion");
	const tools = row("tool-preguntas");
	const invocation = {} as Record<Harness, string>;
	const questionTool = {} as Record<Harness, string>;
	for (const harness of HARNESSES) {
		const index = indexes.get(harness);
		assert.notEqual(index, undefined, `columna ${harness} presente`);
		const invocationPattern = invocations[index!] ?? "";
		assert.ok(invocationPattern.endsWith("nombre"), `${harness}: patrón de invocación válido`);
		invocation[harness] = invocationPattern.slice(0, -"nombre".length);
		questionTool[harness] = tools[index!] ?? "";
	}
	return { invocation, questionTool };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeArtifactAwareBlock(
	block: string,
	harness: Harness,
	differences: InteractionDifferences,
): string {
	const invocation = differences.invocation[harness];
	const questionTool = differences.questionTool[harness];
	// Mismo borde que normalizeInvocations de harness-gate/interaction.ts: una
	// ruta como `.sdd/grills/` no es una invocación de `/grill`.
	let normalized = block.replace(
		new RegExp(`(^|[^A-Za-z0-9.])${escapeRegExp(invocation)}(issue-triage|grill|sdd-spec|sdd-run)(?![A-Za-z0-9-])`, "gm"),
		(_match, before: string, name: string) => `${before}«skill:${name}»`,
	);
	if (questionTool && questionTool !== "—") {
		normalized = normalized.replaceAll(questionTool, "«question-tool»");
	}
	return normalized;
}

export function compareArtifactAwareBlocks(blocks: Map<Harness, string>): string[] {
	const reference = blocks.get("claude") ?? "";
	const differences: string[] = [];
	for (const harness of HARNESSES.slice(1)) {
		if ((blocks.get(harness) ?? "") !== reference) differences.push(`${harness} diverge de claude`);
	}
	return differences;
}

const REQUIRED_ROUTES = [
	"resume-grill",
	"spec-from-grill",
	"update-existing-spec",
	"run-existing-spec",
	"already-implemented",
	"superseded-artifact",
	"audit-existing-spec",
	"artifact-conflict",
] as const;

const REQUIRED_SCHEMA_FIELDS = [
	"version",
	"outcome",
	"code",
	"recommendedClassification",
	"fallbackClassification",
	"recommendedRoute",
	"selectedRoute",
	"stage",
	"mode",
	"repo",
	"cwd",
	"sources",
	"canonicalIssue",
	"summary",
	"impactExample",
	"scope",
	"checklist",
	"evidence",
	"risks",
	"artifacts",
] as const;

test("issue-triage has one equivalent artifact-aware contract in all existing harnesses", async () => {
	const interaction = parseInteractionDifferences(await readRepoFile("docs/harness-interaction-differences.md"));
	const blocks = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/issue-triage/SKILL.md`);
		blocks.set(harness, normalizeArtifactAwareBlock(artifactAwareBlock(markdown), harness, interaction));
		assert.doesNotMatch(markdown, /## Fase 6 — Ejecutar la ruta/);
		assert.doesNotMatch(markdown, /Creá un worktree hermano/);
		assert.doesNotMatch(markdown, /Cargá (?:completo )?(?:el skill )?[`~/.a-z-]*(?:grill|sdd-spec)\/SKILL\.md/);
	}
	assert.deepEqual(compareArtifactAwareBlocks(blocks), []);

	const contract = blocks.get("pi") ?? "";
	for (const route of REQUIRED_ROUTES) assert.match(contract, new RegExp(`\\b${route}\\b`), route);
	for (const field of REQUIRED_SCHEMA_FIELDS) assert.match(contract, new RegExp(`\\b${field}\\b`), field);
	for (const rule of [
		"parseSddArtifact",
		"CRLF",
		"Body original",
		"superseded-by",
		"fresh|stale|unknown",
		"parentId",
		"canonicalization",
		"selectedRoute=null",
		"JSON.parse(JSON.stringify(result))",
	]) {
		assert.ok(contract.includes(rule), rule);
	}
	assert.match(contract, /no ejecuta pasos de ningún stage/i);
	assert.match(contract, /en Claude, Codex y OpenCode lo encadena la Fase 7/);
	assert.match(contract, /en Pi lo abre el orquestador de `\/issues`/);
	assert.doesNotMatch(contract, /triage produce contexto y termina/);
});

test("artifact-aware gate reports injected route/schema drift", () => {
	const base = "route=run-existing-spec\nselectedRoute=null";
	const blocks = new Map<Harness, string>([
		["claude", base],
		["codex", base.replace("run-existing-spec", "update-existing-spec")],
		["opencode", base],
		["pi", base],
	]);
	assert.deepEqual(compareArtifactAwareBlocks(blocks), ["codex diverge de claude"]);
});

test("opencode issue-triage uses native skill loading and question gates with a blocking fallback", async () => {
	const markdown = await readRepoFile("opencode/issue-triage/SKILL.md");
	assert.match(markdown, /\/issue-triage #12/);
	assert.match(markdown, /tool `skill`/);
	assert.match(markdown, /`question`[^\n]*Fases 4 y 5/);
	assert.match(markdown, /Confirmar \(Recommended\)/);
	assert.match(markdown, /ruta completa[^\n]*`description`/);
	assert.match(markdown, /Si `question` no está disponible[^\n]*opciones numeradas[^\n]*terminá el turno[^\n]*esperá/);
	const actionable = markdown.split("### Rutas accionables\n")[1]?.split("## Fase 5")[0] ?? "";
	assert.match(actionable, /Con `question`[^\n]*labels[^\n]*Interacción en OpenCode/);
	assert.match(actionable, /En el fallback en texto plano[^\n]*opciones numeradas:/);
	assert.match(markdown, /Pasale sólo el nombre sin la barra[^\n]*`grill`[^\n]*`sdd-spec`[^\n]*`sdd-run`/);
	assert.match(markdown, /argumentos de invocación[^\n]*nunca como invocación pelada/);
	assert.match(markdown, /Si el skill no está instalado o su carga queda denegada[^\n]*comando exacto[^\n]*terminá/);
	assert.doesNotMatch(markdown, /AskUserQuestion|request_user_input|ask_user_question|submit_workflow_resolution|tool `Skill`/);
	assert.doesNotMatch(markdown, /\$sdd-|\/skill:|quick-run/);
});

const CHAINING_HARNESSES = ["claude", "codex", "opencode"] as const;

// Stage → skill dueño; las rutas salen del contrato que usa el orquestador de Pi.
const STAGE_SKILLS: Record<string, string> = {
	grill: "grill",
	spec: "sdd-spec",
	"run-existing-spec": "sdd-run",
};

const START_ROUTE_SKILLS: Record<string, string> = Object.fromEntries(
	Object.entries(ACTIONABLE_ROUTE_CONTRACT).map(([route, { stage }]) => [route, STAGE_SKILLS[stage]!]),
);

export function stageChainBlock(markdown: string): string {
	const match = markdown.match(/<!-- stage-chain:start -->\n([\s\S]*?)\n<!-- stage-chain:end -->/);
	assert.ok(match?.[1], "tabla normativa stage-chain presente");
	return match[1];
}

function stageChainRows(block: string): string[][] {
	return block.split("\n").filter((row) => row.startsWith("|")).slice(2)
		.map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

export function stageChainRoutes(block: string, invocation: string): Map<string, string> {
	const routes = new Map<string, string>();
	for (const [routeCell = "", skillCell = ""] of stageChainRows(block)) {
		const skill = skillCell.replaceAll("`", "");
		for (const route of routeCell.matchAll(/`([a-z-]+)`/g)) {
			routes.set(route[1]!, skill.startsWith(invocation) ? skill.slice(invocation.length) : `?${skill}`);
		}
	}
	return routes;
}

export function stageChainArguments(block: string): Map<string, string> {
	const args = new Map<string, string>();
	for (const [routeCell = "", , argsCell = ""] of stageChainRows(block)) {
		for (const route of routeCell.matchAll(/`([a-z-]+)`/g)) args.set(route[1]!, argsCell);
	}
	return args;
}

test("issue-triage chains the confirmed stage in harnesses without orchestrator", async () => {
	const interaction = parseInteractionDifferences(await readRepoFile("docs/harness-interaction-differences.md"));
	const blocks = new Map<Harness, string>();
	for (const harness of CHAINING_HARNESSES) {
		const markdown = await readRepoFile(`${harness}/issue-triage/SKILL.md`);
		const block = stageChainBlock(markdown);
		const routes = stageChainRoutes(block, interaction.invocation[harness]);
		assert.deepEqual(Object.fromEntries(routes), START_ROUTE_SKILLS, `${harness}: mapeo ruta → skill`);
		const args = stageChainArguments(block);
		assert.match(args.get("spec-from-grill") ?? "", /--from-grill/);
		for (const route of ["update-existing-spec", "audit-existing-spec"]) {
			assert.match(args.get(route) ?? "", /--triage-route/, `${harness}: ${route} distingue update/audit`);
		}
		assert.match(markdown, /code=selectedRoute/);
		assert.match(markdown, /join-\*[^\n]*sin `canonicalIssue`[^\n]*no encadenes/);
		assert.match(markdown, /reescribe el body del issue/);
		blocks.set(harness, normalizeArtifactAwareBlock(block, harness, interaction));
		assert.match(markdown, /## Fase 7 — Encadenar el stage confirmado/);
		assert.doesNotMatch(markdown, /no autoriza a ejecutar el stage/);
		assert.doesNotMatch(markdown, /No invocar ni ejecutar grill, spec o run/);
		assert.match(markdown, /selectedRoute=null[^\n]*no encadenes/i);
	}
	for (const harness of CHAINING_HARNESSES.slice(1)) {
		assert.equal(blocks.get(harness), blocks.get("claude"), `${harness} diverge de claude en stage-chain`);
	}
});

test("codex issue-triage leaves run as a ready command because its sidecar forbids implicit invocation", async () => {
	const markdown = await readRepoFile("codex/issue-triage/SKILL.md");
	assert.match(markdown, /Excepción de Codex: `run-existing-spec` no se encadena/);
	const sidecar = await readRepoFile("codex/sdd-run/agents/openai.yaml");
	assert.match(sidecar, /allow_implicit_invocation:\s*false/, "sdd-run: la excepción de issue-triage depende de esta política");
});

test("sdd-spec accepts the chained triage target in every chaining harness", async () => {
	for (const harness of CHAINING_HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-spec/SKILL.md`);
		assert.match(markdown, /### Entrada encadenada desde issue-triage/, harness);
		assert.match(markdown, /\| ruta de spec\]/, `${harness}: firma acepta ruta de spec`);
		assert.match(markdown, /--triage-route update-existing-spec\|audit-existing-spec/, harness);
	}
});

test("sdd-spec preserves equivalent chained input safeguards in every chaining harness", async () => {
	const interaction = parseInteractionDifferences(await readRepoFile("docs/harness-interaction-differences.md"));
	const inputBlock = (markdown: string) => {
		const match = markdown.match(/### Entrada encadenada desde issue-triage\n([\s\S]*?)\n<!-- sdd-spec-drafts:start -->/);
		assert.ok(match?.[1], "entrada encadenada presente");
		return match[1];
	};
	const claude = inputBlock(await readRepoFile("claude/sdd-spec/SKILL.md"));
	for (const harness of CHAINING_HARNESSES.slice(1)) {
		const block = inputBlock(await readRepoFile(`${harness}/sdd-spec/SKILL.md`));
		assert.equal(
			normalizeArtifactAwareBlock(block, harness, interaction),
			normalizeArtifactAwareBlock(claude, "claude", interaction),
			`${harness}: entrada encadenada diverge de claude`,
		);
	}
});

test("both READMEs advertise issue-triage and its confirmed chaining in OpenCode", async () => {
	for (const path of ["README.md", "README.en.md"]) {
		const markdown = await readRepoFile(path);
		const row = markdown.split("\n").find((line) => line.startsWith("| **`issue-triage`**")) ?? "";
		assert.match(row, /Claude y OpenCode encadena el skill del stage|Claude and OpenCode chain the stage skill/, path);
		assert.match(row, /Disponible en los cuatro harnesses|Available in all four harnesses/, path);
		assert.doesNotMatch(row, /\*\(Codex\/Claude\/Pi\)\*/, path);
		assert.match(markdown, /(?:Para encadenar|Chaining)[^\n]*`grill`[^\n]*`sdd-spec`[^\n]*`sdd-run`/, `${path}: permisos de skills encadenados`);
	}
});

test("pi issue-triage keeps chaining in the orchestrator, not in the skill", async () => {
	const markdown = await readRepoFile("pi/issue-triage/SKILL.md");
	assert.doesNotMatch(markdown, /<!-- stage-chain:start -->/);
	assert.match(markdown, /submit_workflow_resolution/);
});

test("stage-chain gate reports a route mapped to the wrong skill", () => {
	const block = [
		"| `selectedRoute` | Skill | Argumentos |",
		"|---|---|---|",
		"| `grill`, `join-grill` | `/sdd-spec` | `#<N>` |",
	].join("\n");
	assert.equal(stageChainRoutes(block, "/").get("join-grill"), "sdd-spec");
	assert.equal(stageChainRoutes(block, "$").get("grill"), "?/sdd-spec");
});

test("autotest: el normalizador de issue-triage no confunde una ruta .sdd/grills/ con la invocación /grill", async () => {
	const interaction = parseInteractionDifferences(await readRepoFile("docs/harness-interaction-differences.md"));
	assert.equal(
		normalizeArtifactAwareBlock("`/grill` y `<git-common-dir>/sdd/grills/`", "claude", interaction),
		"`«skill:grill»` y `<git-common-dir>/sdd/grills/`",
	);
});
