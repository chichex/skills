// Gate anti-drift de la doctrina de diseño (issue #74, CA-1 a CA-17).
//
// El inventario `## Diseño` del contrato, el skill `design-system` y las ramas
// de diseño de grill, sdd-spec y sdd-run existen en los cuatro harnesses con
// doctrina idéntica y solo la capa de interacción distinta. Este gate lee los
// SKILL.md reales, exige con regexes la doctrina de cada CA, compara los
// bloques delimitados entre harnesses tras normalizar invocaciones y tool de
// preguntas, y observa el wiring del repo (pi-package, harness-gate, README,
// manifests, contrato). Es solo-tests, igual que sdd-land-gate. La conducta de
// un agente siguiendo la doctrina (CA-18) es prueba humana y no se verifica acá.

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

import type { Harness } from "../harness-gate/interaction.ts";
import {
	HARNESSES,
	SKILL_NAMES,
	escapeRegExp,
	fencedBlocks,
	firstDifference,
	normalizeInvocations,
	parseInteractionTable,
} from "../harness-gate/interaction.ts";

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

async function exists(path: string): Promise<boolean> {
	return access(repoFile(path)).then(
		() => true,
		() => false,
	);
}

function rawFrontmatter(markdown: string): string {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(match?.[1], "frontmatter presente");
	return match[1];
}

export function delimitedBlock(markdown: string, name: string): string | null {
	const block = markdown.match(new RegExp(`<!-- ${escapeRegExp(name)}:start -->\\n([\\s\\S]*?)\\n<!-- ${escapeRegExp(name)}:end -->`));
	return block ? (block[1] ?? "") : null;
}

function section(markdown: string, heading: RegExp): string {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.startsWith("## ") && heading.test(line));
	if (start === -1) return "";
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (lines[index]?.startsWith("## ")) {
			end = index;
			break;
		}
	}
	return lines.slice(start, end).join("\n");
}

export function missing(text: string, patterns: RegExp[]): string[] {
	return patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `falta ${pattern}`);
}

// Lee el bloque delimitado `name` de `<harness>/<skill>/SKILL.md`, normaliza las
// invocaciones de skills del repo a la sintaxis de Claude (`/nombre`) y la tool
// de preguntas del harness a un token común. Es la vista que se compara entre
// harnesses y contra la que se escriben las regexes de doctrina.
async function normalizedBlocks(skill: string, name: string): Promise<{ blocks: Map<Harness, string>; problems: string[] }> {
	const table = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const blocks = new Map<Harness, string>();
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/${skill}/SKILL.md`;
		if (!(await exists(path))) {
			problems.push(`${path} no existe`);
			continue;
		}
		const block = delimitedBlock(await readRepoFile(path), name);
		if (block === null) {
			problems.push(`${path}: falta el bloque <!-- ${name}:start/end -->`);
			continue;
		}
		const tool = table.questionTools[harness];
		let normalized = normalizeInvocations(block, table.prefixes[harness]).replace(/«skill:([a-z-]+)»/g, "/$1");
		if (tool !== null) normalized = normalized.replaceAll(`\`${tool}\``, "«tool-preguntas»");
		blocks.set(harness, normalized);
	}
	return { blocks, problems };
}

function divergences(blocks: Map<Harness, string>): string[] {
	const [reference, ...rest] = HARNESSES;
	return rest
		.filter((harness) => blocks.has(harness) && blocks.get(harness) !== blocks.get(reference))
		.map((harness) => `${reference} vs ${harness}: ${firstDifference(blocks.get(reference) ?? "", blocks.get(harness) ?? "")}`);
}

async function doctrineProblems(skill: string, name: string, patterns: RegExp[]): Promise<string[]> {
	const { blocks, problems } = await normalizedBlocks(skill, name);
	for (const [harness, block] of blocks) {
		for (const problem of missing(block, patterns)) problems.push(`${harness}/${skill} <!-- ${name} -->: ${problem}`);
	}
	return problems;
}

async function identityProblems(skill: string, name: string): Promise<string[]> {
	const { blocks, problems } = await normalizedBlocks(skill, name);
	return [...problems, ...divergences(blocks)];
}

// ---------------------------------------------------------------------------
// B. Skill nuevo `design-system` (CA-6, CA-7, CA-7b, CA-8)
// ---------------------------------------------------------------------------

const DESIGN_SYSTEM_TRIGGERS = [
	"design system",
	"sistema de diseño",
	"tokens de diseño",
	"dirección visual",
	"generar DESIGN_SYSTEM.md",
	"sdd-init",
];

// Censo de superficies y elementos de diseño: el mismo en sdd-init (CA-2) y en
// design-system (CA-7, paso 1).
export const DESIGN_CENSUS: RegExp[] = [
	/`react-dom`/,
	/`next`/,
	/`react-native`/,
	/`expo`/,
	/Gradle/,
	/profundidad 2/,
	/tokens/i,
	/componentes base/i,
	/`DESIGN_SYSTEM\.md`/,
	/`design-system\/`/,
	/Storybook/,
	/`docs\/design\/`/,
	/`design-sync\/`/,
	/Claude Design/,
];

const DESIGN_SYSTEM_DOCTRINE: RegExp[] = [
	...DESIGN_CENSUS,
	// Orden de los seis pasos de CA-7.
	/ya tiene sistema[\s\S]*no generar[\s\S]*registrar el inventario en `## Diseño`[\s\S]*una sola ronda de dirección visual[\s\S]*plan de tokens[\s\S]*[Rr]evisar contra el pedido y el inventario[\s\S]*[Cc]onstruir el doc[\s\S]*[Aa]utocrítica[\s\S]*`DESIGN_SYSTEM\.md` en la raíz de la superficie[\s\S]*idempotente[\s\S]*## MUST NOT DO/i,
	/audiencia y tono[\s\S]*paleta base[\s\S]*tipografía[\s\S]*densidad, radios y modo claro\/oscuro/,
	/recomendación primera/,
	/`frontend-design`[^\n]*instalado[^\n]*refuerzo[^\n]*antes del plan de tokens[^\n]*nunca como requisito/,
	/solo en archivos que ya existen/,
	/fila de la superficie en `## Diseño` de `\.sdd\/project\.md`[^\n]*si la sección no existe[^\n]*`\/sdd-init --update`/,
	/`@DESIGN_SYSTEM\.md`[^\n]*`CLAUDE\.md`/,
	/<!-- design-system-agents-link:start -->[\s\S]*<!-- design-system-agents-link:end -->[\s\S]*`AGENTS\.md`|`AGENTS\.md`[\s\S]*<!-- design-system-agents-link:start -->[\s\S]*<!-- design-system-agents-link:end -->/,
	/^- No escribir código de la aplicación/m,
	/tokens en código/,
	/componentes/,
	/No pisar `## Ajustes de este proyecto`/,
];

const DESIGN_SYSTEM_TEMPLATE: RegExp[] = [
	/^# Design system — <superficie>$/m,
	/^<!-- design-system: generated=<YYYY-MM-DD>; surface=<nombre>; direction=<slug> -->$/m,
	/^## Dirección\n[\s\S]*^## Tokens\n[\s\S]*^## Componentes base\n[\s\S]*^## Estados y patrones\n[\s\S]*^## Reglas\n[\s\S]*^## Ajustes de este proyecto\n<!-- design-system:ajustes:start -->\n<!-- design-system:ajustes:end -->$/m,
	/^## Tokens\n[\s\S]*color[\s\S]*tipografía[\s\S]*espaciado[\s\S]*radios[\s\S]*sombras[\s\S]*^## Componentes base/im,
	/^- \*\*MUST\|SHOULD\*\* <regla>\. Porqué: <texto>\.$/m,
];

test("CA-6: design-system existe en los cuatro harnesses con name, description entre comillas, triggers y extras por harness", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/design-system/SKILL.md`;
		if (!(await exists(path))) {
			problems.push(`${path} no existe`);
			continue;
		}
		const fm = rawFrontmatter(await readRepoFile(path));
		if (!/^name: design-system$/m.test(fm)) problems.push(`${path}: name distinto de design-system`);
		const description = fm.match(/^description: "(.*)"$/m)?.[1];
		if (description === undefined) {
			problems.push(`${path}: description no está entre comillas dobles en una línea`);
		} else {
			if (description.length >= 500) problems.push(`${path}: description de ${description.length} caracteres (tope 499)`);
			for (const trigger of DESIGN_SYSTEM_TRIGGERS) {
				if (!description.includes(trigger)) problems.push(`${path}: description sin el trigger «${trigger}»`);
			}
		}
		const compatibility = fm.match(/^compatibility: (.*)$/m)?.[1];
		if (harness === "pi" && !/ask_user_question/.test(compatibility ?? "")) problems.push(`${path}: compatibility no declara la tool de preguntas`);
		if (harness !== "pi" && compatibility !== undefined) problems.push(`${path}: compatibility solo corresponde a Pi`);
	}
	if (await exists("codex/design-system/agents/openai.yaml")) {
		const sidecar = await readRepoFile("codex/design-system/agents/openai.yaml");
		if (!/interface:\n {2}display_name: "[^"]+"\n {2}short_description: "[^"]+"\n {2}default_prompt: "[^"]*\$design-system[^"]*"/.test(sidecar)) {
			problems.push("codex/design-system/agents/openai.yaml: bloque interface incompleto");
		}
	} else {
		problems.push("codex/design-system/agents/openai.yaml no existe");
	}
	for (const harness of ["claude", "opencode", "pi"]) {
		if (await exists(`${harness}/design-system/agents`)) problems.push(`${harness}/design-system no lleva agents/`);
	}
	assert.deepEqual(problems, []);
});

test("CA-7: la doctrina de design-system está declarada en orden en los cuatro harnesses", async () => {
	assert.deepEqual(await doctrineProblems("design-system", "design-system-doctrine", DESIGN_SYSTEM_DOCTRINE), []);
});

test("CA-7, CA-7b: el bloque design-system-doctrine es idéntico entre harnesses tras normalizar", async () => {
	assert.deepEqual(await identityProblems("design-system", "design-system-doctrine"), []);
});

test("CA-7: cada design-system nombra su propia tool de preguntas y ninguna ajena", async () => {
	const { questionTools } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/design-system/SKILL.md`;
		if (!(await exists(path))) {
			problems.push(`${path} no existe`);
			continue;
		}
		const markdown = await readRepoFile(path);
		for (const other of HARNESSES) {
			const tool = questionTools[other];
			if (tool === null) continue;
			const used = markdown.includes(`\`${tool}\``);
			if (other === harness && !used) problems.push(`${path} no nombra \`${tool}\``);
			if (other !== harness && used) problems.push(`${path} nombra la tool ajena \`${tool}\``);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-7b: el template de DESIGN_SYSTEM.md trae H1, marker, secciones en orden, formato de reglas y ajustes preservados", async () => {
	const { blocks, problems } = await normalizedBlocks("design-system", "design-system-doctrine");
	for (const [harness, block] of blocks) {
		const template = fencedBlocks(block).find((fence) => fence.content.includes("# Design system — <superficie>"));
		if (!template) {
			problems.push(`${harness}/design-system: sin fence con el template de DESIGN_SYSTEM.md`);
			continue;
		}
		for (const problem of missing(template.content, DESIGN_SYSTEM_TEMPLATE)) problems.push(`${harness}/design-system template: ${problem}`);
		if (!/`<!-- design-system:ajustes:start -->`[^\n]*`<!-- design-system:ajustes:end -->`[^\n]*byte a byte/.test(block)) {
			problems.push(`${harness}/design-system: no declara la preservación byte a byte de los ajustes`);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-8: design-system queda cableado en pi-package, harness-gate, README y manifests", async () => {
	const problems: string[] = [];
	const pkg = await readRepoFile("pi-extensions/pi-package/pi-package.test.ts");
	if (!pkg.includes('"./pi/design-system/SKILL.md"')) problems.push("EXPECTED_SKILLS sin ./pi/design-system/SKILL.md");
	if (!SKILL_NAMES.includes("design-system")) problems.push("SKILL_NAMES sin design-system");

	const sections: Record<string, { skills: RegExp; sdd: RegExp }> = {
		"README.md": { skills: /^## Skills fundacionales$/, sdd: /^## El workflow SDD$/ },
		"README.en.md": { skills: /^## Foundational skills$/, sdd: /^## The SDD workflow$/ },
	};
	for (const [path, headings] of Object.entries(sections)) {
		const markdown = await readRepoFile(path);
		const skills = section(markdown, headings.skills);
		if (!/^\| \*\*`design-system`\*\*[^|]*\|.*DESIGN_SYSTEM\.md.*$/m.test(skills)) problems.push(`${path}: sin fila design-system en la tabla de skills fundacionales`);
		if (!/design-system/.test(section(markdown, headings.sdd))) problems.push(`${path}: el workflow SDD no nombra design-system`);
	}

	const plugin = JSON.parse(await readRepoFile(".claude-plugin/plugin.json")) as { description: string };
	const marketplace = JSON.parse(await readRepoFile(".claude-plugin/marketplace.json")) as {
		plugins: Array<{ name: string; description: string }>;
	};
	const entry = marketplace.plugins.find((candidate) => candidate.name === "chichex-skills");
	if (!/design-system/.test(plugin.description)) problems.push("plugin.json no nombra design-system");
	if (entry?.description !== plugin.description) problems.push("descriptions de plugin.json y marketplace.json distintas");
	assert.deepEqual(problems, []);
});

test("autotest: un bloque ausente o divergente se reporta con su diagnóstico", () => {
	assert.equal(delimitedBlock("sin bloque", "design-system-doctrine"), null);
	assert.equal(delimitedBlock("<!-- x:start -->\nhola\n<!-- x:end -->", "x"), "hola");
	const problems = missing("texto sin nada relevante", DESIGN_SYSTEM_DOCTRINE);
	assert.ok(problems.length >= 10);
	assert.match(problems[0] ?? "", /react-dom/);
	const drift = divergences(new Map<Harness, string>([
		["claude", "a\nb"],
		["codex", "a\nc"],
		["opencode", "a\nb"],
		["pi", "a\nb"],
	]));
	assert.deepEqual(drift, ["claude vs codex: linea 2: `b` vs `c`"]);
});
