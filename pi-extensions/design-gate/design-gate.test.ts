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
	/\*\*Tokens\*\*: theme o tokens en código/,
	/componentes base/i,
	/claves exactas de `dependencies` y `devDependencies`/,
	/`react-native-web` no cuenta/,
	/`gradle\/libs\.versions\.toml`/,
	/`kotlin\("multiplatform"\)`/,
	/`com\.android\.library` y un módulo KMP sin Compose no abren superficie/,
	/Los defaults de un scaffold no cuentan/,
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
	/^- No escribir código de la aplicación: ni tokens en código, ni componentes, ni temas\.$/m,
	/`DESIGN_SYSTEM\.md` con el marker `design-system:` de este skill prevalece sobre las demás señales/,
	/\*\*Rama de registro\*\*[^\n]*solo `\.sdd\/project\.md`/,
	/un único bloque por archivo, con una línea por superficie/,
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

test("CA-7: la capa de interacción de Codex y opencode usa la etiqueta de la doctrina y Codex cubre más de 3 opciones", async () => {
	const problems: string[] = [];
	for (const harness of ["codex", "opencode"]) {
		const path = `${harness}/design-system/SKILL.md`;
		if (/\(Recommended\)/.test(await readRepoFile(path))) problems.push(`${path}: usa (Recommended) en vez de la etiqueta (Recomendado) de la doctrina`);
	}
	if (!/más de 3 opciones/.test(await readRepoFile("codex/design-system/SKILL.md"))) problems.push("codex/design-system: no cubre preguntas con más de 3 opciones");
	assert.deepEqual(problems, []);
});

test("autotest: recortar el MUST NOT de design-system o el censo de tokens se detecta", async () => {
	const block = delimitedBlock(await readRepoFile("claude/design-system/SKILL.md"), "design-system-doctrine") ?? "";
	const trimmed = block.replace(/^- No escribir código de la aplicación.*$/m, "- No escribir código de la aplicación.");
	assert.ok(missing(trimmed, DESIGN_SYSTEM_DOCTRINE).some((problem) => /No escribir código de la aplicación/.test(problem)));
	const noTokens = block.replace(/^- \*\*Tokens\*\*.*$/m, "");
	assert.ok(missing(noTokens, DESIGN_SYSTEM_DOCTRINE).some((problem) => /Tokens/.test(problem)));
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
	for (const [path, readmeHeadings] of Object.entries(sections)) {
		const markdown = await readRepoFile(path);
		const skills = section(markdown, readmeHeadings.skills);
		if (!/^\| \*\*`design-system`\*\*[^|]*\|.*DESIGN_SYSTEM\.md.*$/m.test(skills)) problems.push(`${path}: sin fila design-system en la tabla de skills fundacionales`);
		if (!/design-system/.test(section(markdown, readmeHeadings.sdd))) problems.push(`${path}: el workflow SDD no nombra design-system`);
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

// ---------------------------------------------------------------------------
// A. Contrato — sdd-init (CA-1 a CA-5)
// ---------------------------------------------------------------------------

const CONTRACT_DESIGN_HEADER = "| Superficie | Raices | Tokens | Componentes | Docs y mocks | Claude Design | Estado |";

function projectTemplate(markdown: string): string | null {
	const fences = fencedBlocks(markdown).filter((fence) => fence.content.includes("type=project"));
	return fences.length === 1 ? (fences[0]?.content ?? "") : null;
}

function headings(markdown: string): string[] {
	return markdown.split("\n").filter((line) => /^## /.test(line));
}

test("CA-1: el template del contrato trae ## Diseño entre ## Stack y ## Comandos, con sentinel y tabla por superficie, idéntico entre harnesses", async () => {
	const table = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const problems: string[] = [];
	const templates = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const path = `${harness}/sdd-init/SKILL.md`;
		const template = projectTemplate(await readRepoFile(path));
		if (template === null) {
			problems.push(`${path}: no hay exactamente un fence con marker type=project`);
			continue;
		}
		const list = headings(template);
		const stack = list.indexOf("## Stack");
		if (stack === -1) problems.push(`${path}: el template no tiene ## Stack`);
		else if (list[stack + 1] !== "## Diseño" || list[stack + 2] !== "## Comandos") problems.push(`${path}: orden de secciones ${list.join(" > ")}`);
		if ((template.match(/type=project/g) ?? []).length !== 1) problems.push(`${path}: más de un marker type=project en el fence`);
		const design = section(template, /^## Diseño$/);
		if (!design.includes("Sin superficies UI.")) problems.push(`${path}: ## Diseño sin el sentinel «Sin superficies UI.»`);
		if (!design.includes(CONTRACT_DESIGN_HEADER)) problems.push(`${path}: ## Diseño sin la cabecera ${CONTRACT_DESIGN_HEADER}`);
		if (!/`con sistema`[^\n]*`sin sistema`/.test(design)) problems.push(`${path}: ## Diseño no declara los estados con sistema / sin sistema`);
		if (!/<URL o projectId> \(Decisiones humanas <fecha>\)/.test(design)) problems.push(`${path}: ## Diseño no muestra cómo se cita la decisión de Claude Design`);
		if (/coding-policies/.test(template)) problems.push(`${path}: el template del contrato nombra coding-policies`);
		templates.set(harness, normalizeInvocations(template, table.prefixes[harness]));
	}
	assert.deepEqual([...problems, ...divergences(templates)], []);
});

const SDD_INIT_CENSUS: RegExp[] = [
	...DESIGN_CENSUS,
	/una fila por superficie/,
	/`con sistema`[\s\S]*`sin sistema`/,
	/`Sin superficies UI\.`/,
	/`--update`[^\n]*`## Diseño`[^\n]*inventario[^\n]*Claude Design[^\n]*`## Decisiones humanas`/,
	/bundle `design-sync\/` en la raíz del repo se asigna/,
];

const SDD_INIT_POLICIES: RegExp[] = [
	/ratchet/,
	/solo para superficies `con sistema`[^\n]*tokens/,
	/hex fuera del directorio de tokens/,
	/estilos inline/,
	/componentes duplicados por nombre/,
	/`git grep -IhoE '#\(\[0-9a-fA-F\]\{3\}\)\{1,2\}' -- <raíces> ':!<tokens>' \| wc -l`/,
	/`git grep -h 'style=\{\{' -- <raíces> ':!<ui kit>' \| wc -l`/,
	/`git grep -hoE '\(function\|const\|class\) \[A-Z\]\[A-Za-z0-9\]\+' -- <raíces> ':!<ui kit>' \| sort \| uniq -d \| wc -l`/,
	/^(?![\s\S]*--exclude-dir)(?![\s\S]*StyleSheet\.create)[\s\S]*$/,
	/también en `--update` aunque se elija `Mantener`/,
	/baseline/,
	/`Generar design system`[^\n]*solo si hay al menos una superficie `sin sistema`/,
	/invoca `\/design-system` sin flags/,
	/nunca con `--assume`/,
];

test("CA-2: la Fase 1 de sdd-init releva DISEÑO por superficie con el censo común", async () => {
	const problems = await doctrineProblems("sdd-init", "sdd-init-design-census", SDD_INIT_CENSUS);
	for (const harness of HARNESSES) {
		const path = `${harness}/sdd-init/SKILL.md`;
		const markdown = await readRepoFile(path);
		const phase1 = section(markdown, /^## Fase 1 — Exploración$/);
		if (!phase1.includes("<!-- sdd-init-design-census:start -->")) problems.push(`${path}: el censo de diseño no está en la Fase 1`);
		if (harness === "claude" || harness === "opencode") {
			const prompt = phase1.match(/description: "harness del proyecto"[\s\S]*?Busqueda breadth/)?.[0] ?? "";
			if (!/^ {2}4\. DISEÑO:/m.test(prompt)) problems.push(`${path}: el Explore «harness del proyecto» no pide DISEÑO`);
			for (const pattern of ["node_modules", "react-native-web", "libs.versions.toml", "globals.css", "tailwind.config", "components/ui/", ".storybook/", "design-sync/README.md", "defaults de scaffold"]) {
				if (!prompt.includes(pattern)) problems.push(`${path}: el Explore «harness del proyecto» no recibe «${pattern}» del censo`);
			}
		} else if (!/^1\. \*\*Harness\*\*:[^\n]*DISEÑO/m.test(phase1)) {
			problems.push(`${path}: la lente **Harness** no pide DISEÑO`);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-2, CA-4: el censo de diseño de sdd-init es idéntico entre harnesses", async () => {
	assert.deepEqual(await identityProblems("sdd-init", "sdd-init-design-census"), []);
});

test("CA-3: la Fase 3.5 ofrece ratchets de diseño y Generar design system; el reporte gana la línea design-system", async () => {
	const problems = await doctrineProblems("sdd-init", "sdd-init-design-policies", SDD_INIT_POLICIES);
	problems.push(...(await identityProblems("sdd-init", "sdd-init-design-policies")));
	for (const harness of HARNESSES) {
		const path = `${harness}/sdd-init/SKILL.md`;
		const markdown = await readRepoFile(path);
		if (!section(markdown, /^## Fase 3\.5 — Políticas de generación$/).includes("<!-- sdd-init-design-policies:start -->")) problems.push(`${path}: los gates de diseño no están en la Fase 3.5`);
		if (!section(markdown, /^## Reporte$/).includes("- design-system: <referenciado|generado|no existe (ofrecido)|con sistema (no ofrecido)|--assume: no ofrecido|sin superficies UI>")) problems.push(`${path}: el reporte no tiene la línea design-system`);
	}
	assert.deepEqual(problems, []);
});

test("CA-4: la tabla de Upgrade de contrato gana la fila Diseño", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/sdd-init/SKILL.md`;
		if (!/^\| Diseño \| no existe la sección `## Diseño` — no entra al menú: [^\n]*\|$/m.test(await readRepoFile(path))) problems.push(`${path}: sin fila Diseño (fuera del menú) en Upgrade de contrato`);
	}
	assert.deepEqual(problems, []);
});

test("CA-5: el contrato de este repo gana ## Diseño sin superficies, la fila del gate y los conteos nuevos", async () => {
	const contract = await readRepoFile(".sdd/project.md");
	const contractHeadings = headings(contract);
	assert.notEqual(contractHeadings.indexOf("## Stack"), -1, "el contrato tiene ## Stack");
	assert.equal(contractHeadings[contractHeadings.indexOf("## Stack") + 1], "## Diseño", "## Diseño va inmediatamente después de ## Stack");
	assert.match(section(contract, /^## Diseño$/), /^## Diseño\nSin superficies UI\.\n/);
	const commands = section(contract, /^## Comandos$/);
	assert.match(commands, /^\| gate de doctrina de diseño \| `node --test pi-extensions\/design-gate\/design-gate\.test\.ts` \|/m);
	assert.match(commands, /^\| lint de frontmatter \|[^\n]*\| 50 skills OK;/m);
	assert.match(contract, /13 skills de Pi/);
	assert.doesNotMatch(contract, /12 skills de Pi/);
	assert.match(contract, /RPC con 23 comandos[^\n]*`skill:design-system`/);
	assert.match(contract, /## Politicas de generacion\nSin politicas activas\./);
	assert.match(contract, /## Decisiones humanas\n/);
});

// ---------------------------------------------------------------------------
// C. Grill (CA-9 a CA-11)
// ---------------------------------------------------------------------------

const GRILL_DESIGN_BRANCH: RegExp[] = [
	/lee `## Diseño` de `\.sdd\/project\.md`/,
	/si falta o es `Sin superficies UI\.` con señales de UI en el repo[^\n]*explora una vez[^\n]*`\/sdd-init --update`/i,
	/cruzando las raíces de cada superficie con los paths que el pedido tocaría/,
	/solo si queda ambiguo[^\n]*una única pregunta/i,
	/toca al menos una superficie UI[^\n]*sección `Diseño`[^\n]*cinco ramas/,
	/pantallas, flujos y estados \(carga, vacío, error, éxito\)[\s\S]*reuso vs\. componentes nuevos[\s\S]*dirección visual, solo si la superficie está `sin sistema`[\s\S]*plataformas y accesibilidad[\s\S]*web sólida en celular y webview[^\n]*solo para superficies web/i,
	/se preguntan únicamente cuando el inventario y el repo no las resuelven/,
	/el mapa del reconocimiento muestra la sección `Diseño` y su activación/i,
	/Los pedidos sin UI no ven ninguna pregunta nueva/,
];

const GRILL_DESIGN_CAPTURES: RegExp[] = [
	/Playwright MCP[^\n]*`browser_navigate`[^\n]*`browser_take_screenshot`/,
	/navegador headless que el contrato declare/,
	/mocks HTML[^\n]*bundle `design-sync\/`[^\n]*Claude Design[^\n]*Storybook/,
	/que el usuario adjunte se guardan tal cual/,
	/nunca se inventa una captura/,
	/viven en el scratch hasta guardar, pausar o finalizar/,
	/`\.sdd\/grills\/<nombre-real-del-handoff>\/`[^\n]*mismo nombre base que el `\.md`[^\n]*sufijo de colisión/,
	/el handoff las referencia por ruta relativa/,
];

const GRILL_DESIGN_HANDOFF: RegExp[] = [
	/mientras la sesión está `paused`, las decisiones de diseño viven en `## Decisiones resueltas` con prefijo `Diseño:`/i,
	/el contrato visible del cierre incluye el diseño/,
];

const GRILL_TEMPLATE_DESIGN: RegExp[] = [
	/superficies/,
	/pantallas, flujos y estados/,
	/componentes a reusar o crear por nombre del inventario/,
	/direccion visual/,
	/webview, plataforma y accesibilidad/,
	/capturas de referencia por ruta relativa/,
	/Diseño:/,
];

test("CA-9: grill declara la rama de diseño en los cuatro harnesses", async () => {
	assert.deepEqual(await doctrineProblems("grill", "grill-design", GRILL_DESIGN_BRANCH), []);
});

test("CA-10: grill declara las capturas de referencia y dónde se guardan", async () => {
	assert.deepEqual(await doctrineProblems("grill", "grill-design", GRILL_DESIGN_CAPTURES), []);
});

test("CA-9 a CA-11: el bloque grill-design es idéntico entre harnesses", async () => {
	assert.deepEqual(await identityProblems("grill", "grill-design", ), []);
});

test("CA-11: el template del handoff gana ## Diseño entre ## Ramas pendientes y ## Handoff, con un solo marker type=grill", async () => {
	const problems = await doctrineProblems("grill", "grill-design", GRILL_DESIGN_HANDOFF);
	for (const harness of HARNESSES) {
		const path = `${harness}/grill/SKILL.md`;
		const fences = fencedBlocks(await readRepoFile(path)).filter((fence) => fence.content.includes("type=grill"));
		if (fences.length !== 1) {
			problems.push(`${path}: ${fences.length} fences con marker type=grill`);
			continue;
		}
		const template = fences[0]?.content ?? "";
		const list = headings(template);
		const pending = list.indexOf("## Ramas pendientes");
		if (list[pending + 1] !== "## Diseño" || list[pending + 2] !== "## Handoff") problems.push(`${path}: orden ${list.join(" > ")}`);
		for (const problem of missing(section(template, /^## Diseño$/), GRILL_TEMPLATE_DESIGN)) problems.push(`${path} template ## Diseño: ${problem}`);
	}
	const pi = await readRepoFile("pi/grill/SKILL.md");
	if (!/`finalize` escribe el `handoffMarkdown` verbatim, con `## Diseño`/.test(pi)) problems.push("pi/grill: Formato del handoff no dice que finalize escribe ## Diseño verbatim");
	const logicTest = await readRepoFile("pi-extensions/grill-tools/logic.test.ts");
	for (const heading of ["## Hechos comprobados", "## Decisiones resueltas", "## Ramas pendientes", "## Handoff"]) {
		if (!logicTest.includes(heading)) problems.push(`grill-tools/logic.test.ts ya no exige ${heading}`);
	}
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
