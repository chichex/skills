// Gate determinista del skill coding-policies (spec .sdd/specs/coding-policies.md).
//
// Verifica los artefactos del skill en los cuatro harnesses
// ({claude,codex,opencode,pi}/coding-policies): frontmatter y extras por
// harness (CA-1), doctrina equivalente tras normalizar la capa de interaccion
// (CA-2, CA-6), template del archivo generado identico (CA-8), referencias
// Go y TypeScript estructuralmente validas e identicas byte a byte, integracion con
// sdd-init (CA-9) y documentacion (CA-10). No observa la conducta del agente
// al ejecutar el skill: eso es protocolo humano (CA-5, CA-7).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Harness } from "../harness-gate/interaction.ts";
import {
	HARNESSES,
	fencedBlocks,
	firstDifference,
	normalizeInvocations,
	parseInteractionTable,
} from "../harness-gate/interaction.ts";

const SKILL = "coding-policies";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Prefijo de invocacion por harness, derivado de la tabla normativa de
// docs/harness-interaction-differences.md (misma fuente que harness-gate).
let prefixesCache: Record<Harness, string> | null = null;
async function invocationPrefixes(): Promise<Record<Harness, string>> {
	if (prefixesCache === null) {
		prefixesCache = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md")).prefixes;
	}
	return prefixesCache;
}

// Frases literales de la capa de interaccion de cada harness, en el orden en
// que se reemplazan (la mas larga primero). Toda otra divergencia dentro del
// bloque de doctrina es drift.
const QUESTION_PHRASES: Record<Harness, [string, string][]> = {
	claude: [
		["usar `AskUserQuestion` con multiSelect", "«pregunta-multiple»"],
		["usar `AskUserQuestion`", "«pregunta»"],
	],
	codex: [
		["preguntar en texto plano con todas las opciones y terminar el turno", "«pregunta-multiple»"],
		["usar `request_user_input` (o el mismo gate en texto plano, terminando el turno)", "«pregunta»"],
	],
	opencode: [
		["preguntar en texto plano con todas las opciones y terminar el turno", "«pregunta-multiple»"],
		["preguntar en texto plano y terminar el turno", "«pregunta»"],
	],
	pi: [
		['usar `ask_user_question` con `selectionMode: "multiple"`', "«pregunta-multiple»"],
		["usar `ask_user_question`", "«pregunta»"],
	],
};

// Estilo de pregunta propio de cada harness y tools ajenas que no pueden
// quedar colgadas (checklist de harness-port).
const QUESTION_STYLE: Record<Harness, { required: RegExp[]; forbidden: RegExp }> = {
	claude: {
		required: [/usar `AskUserQuestion` con multiSelect/, /usar `AskUserQuestion`:/],
		forbidden: /request_user_input|ask_user_question|texto plano/,
	},
	codex: {
		required: [/usar `request_user_input`/, /texto plano/],
		forbidden: /AskUserQuestion|ask_user_question/,
	},
	opencode: {
		required: [/preguntar en texto plano y terminar el turno/],
		forbidden: /AskUserQuestion|request_user_input|ask_user_question|`question`/,
	},
	pi: {
		required: [/usar `ask_user_question`/, /selectionMode: "multiple"/],
		forbidden: /AskUserQuestion|request_user_input/,
	},
};

// Doctrina que cada copia tiene que declarar, evaluada sobre el bloque de
// doctrina ya normalizado (CA-6).
const PROCEDURE_DOCTRINE: RegExp[] = [
	/^## Argumentos$/m,
	/«skill:coding-policies» \[go\|typescript\|node\|react\|react-native\|kotlin-android \.\.\.\] \[--out <ruta>\] \[--no-link\]/,
	/[Ss]tacks posicionales[^\n]*saltean la confirmación de stacks/,
	/`--out <ruta>`[^\n]*saltea la pregunta de destino/,
	/`--no-link`[^\n]*saltea el enganche/,
	/^## Fase 0 — Lanzador \(pregunta solo lo que los argumentos no fijan\)$/m,
	/Con argumentos vacíos dispara completo\. Con argumentos, pregunta solo lo que no fijaron/,
	/`--no-link` no afecta a esta fase/,
	/«pregunta-multiple» — "¿Qué stacks entran\?"/,
	/"¿Dónde lo genero\?": `\.sdd\/coding-policies\.md \(Recomendado\)`/,
	/raíz y hasta profundidad 2, excluyendo `node_modules`, `vendor`, `\.git`, `dist` y `build`/,
	/`dependencies` y `devDependencies`/,
	/registra dónde se vio/,
	/^\| Go \| `go` \| `go\.mod` \|$/m,
	/^\| TypeScript \| `typescript` \| `tsconfig\*\.json` \|$/m,
	/^\| React web \| `react` \| `package\.json` con `react-dom` \|$/m,
	/^\| React Native \| `react-native` \| `package\.json` con la clave exacta `react-native` o `expo` en sus dependencias \(`react-native-web` no cuenta\) \|$/m,
	/^\| Node \| `node` \| `package\.json` sin ninguno de los anteriores \|$/m,
	/^\| Kotlin Android \| `kotlin-android` \| `build\.gradle`, `build\.gradle\.kts` o `gradle\/libs\.versions\.toml` que declare `com\.android\.application` o `com\.android\.library` \|$/m,
	/TypeScript se detecta de forma independiente y puede coexistir con Node, React o React Native/,
	/cubierto si existe `references\/<id>\.md`/,
	/"sin prácticas definidas todavía" y no generan sección/,
	/[Ss]i ningún stack confirmado está cubierto, no se genera archivo y se informa; el skill termina ahí, sin enganche/,
	/no lo pisa: lo dice, termina ahí sin enganche/,
	/`no intentado` cubre `--no-link` y las corridas que terminaron antes del enganche/,
	/crea `\.sdd\/`[^\n]*si no existe/,
	/copiado verbatim/,
	/^### Regeneración \(el destino ya existe\)$/m,
	/stacks desactualizados \(`<id>: <version vieja> → <version nueva>`\)/,
	/todo salvo `## Ajustes de este proyecto` se reescribe[^\n]*«pregunta»: `Regenerar \(Recomendado\)` \/ `Cancelar`/,
	/[Pp]reservar verbatim el bloque entre `<!-- coding-policies:ajustes:start -->` y `<!-- coding-policies:ajustes:end -->`/,
	/nunca interpreta el contenido de Ajustes/,
	/no tiene los dos markers de ajustes, no lo pisa/,
	/^## Fase 4 — Enganche \(saltear con `--no-link`\)$/m,
	/[Ss]olo se ofrecen los que existen: el skill nunca crea archivos de contexto/,
	/«pregunta-multiple» — "¿Dónde agrego la referencia\?"/,
	/idempotente: en `CLAUDE\.md` y `AGENTS\.md`, verificando antes que `<ruta>` no esté ya presente[^\n]*en `\.sdd\/project\.md`, comparando la fila entera/,
	/\*\*CLAUDE\.md\*\* — agregar al final una línea `@<ruta>`/,
	/«agents-link»/,
	/\| coding-policies \| <ruta> \(<stacks>\) \| guia — sin gate: «skill:sdd-run» la sigue al generar, la juzga el reviewer \|/,
	/reemplazando el sentinel "Sin politicas activas"/,
	/actualizando la fila en su lugar si ya existe/,
	/sin tocar nada si la sección no existe[^\n]*«skill:sdd-init» --update/,
	/^## Fase 5 — Reporte$/m,
	/^Coding policies listas: <ruta> \(<generado\|regenerado>\)$/m,
	/^- desactualizados antes de regenerar: /m,
	/^## MUST NOT DO$/m,
	/[Nn]o tocar configuración global de ningún harness/,
	/[Nn]o crear archivos de contexto/,
	/[Nn]o editar sin confirmación/,
	/[Nn]o inventar reglas para stacks sin referencia/,
	/[Nn]o interpretar, validar ni reformatear el contenido de "Ajustes de este proyecto"/,
	/[Nn]o pisar un destino existente que no tenga los dos markers de ajustes/,
];

// Mecanismo de enganche en AGENTS.md (CA-6.7, desviacion decidida por el
// usuario en el review del PR #38): AGENTS.md es el archivo compartido por
// Codex, opencode y Pi, y solo el bloque de instruccion funciona en los tres
// (`@<ruta>` queda inerte fuera de opencode). Las cuatro copias escriben el
// mismo bloque; el test de doctrina lo compara byte a byte.
const AGENTS_LINK_BLOCK =
	/\*\*AGENTS\.md\*\*[\s\S]*<!-- coding-policies -->\n\s*Antes de escribir o modificar código en este proyecto, leer `<ruta>`/;
const AGENTS_LINK_STYLE: Record<Harness, RegExp> = {
	claude: AGENTS_LINK_BLOCK,
	codex: AGENTS_LINK_BLOCK,
	opencode: AGENTS_LINK_BLOCK,
	pi: AGENTS_LINK_BLOCK,
};

// Template del archivo generado (CA-8).
const TEMPLATE_MARKERS: RegExp[] = [
	/^# Coding policies — <proyecto>$/m,
	/^<!-- coding-policies: generated=<YYYY-MM-DD>; stacks=<id>@<YYYY-MM-DD>\[,<id>@<YYYY-MM-DD>\.\.\.\] -->$/m,
	/^## <Nombre del stack>$/m,
	/^<!-- coding-policies:stack=<id>; version=<YYYY-MM-DD> -->$/m,
	/^## Ajustes de este proyecto$/m,
	/^<!-- coding-policies:ajustes:start -->$/m,
	/^<!-- coding-policies:ajustes:end -->$/m,
];

// Referencia Go (CA-4).
const GO_SECTIONS = [
	"Layout de paquetes",
	"Errores",
	"Naming",
	"Interfaces y tipos",
	"Concurrencia",
	"Testing",
	"Dependencias y configuración",
	"Lectura ampliada",
];
const GO_LINKS = [
	"https://github.com/uber-go/guide/blob/master/style.md",
	"https://go.dev/doc/effective_go",
	"https://go.dev/wiki/CodeReviewComments",
	"https://www.ardanlabs.com/blog/2017/02/package-oriented-design.html",
];
const TYPESCRIPT_SECTIONS = [
	"Alcance y configuración",
	"Tipos e inferencia",
	"Modelado y narrowing",
	"Genéricos y APIs",
	"Límites y validación",
	"Promesas y concurrencia",
	"Módulos y runtime",
	"Linting y supresiones",
	"Testing y verificación",
	"Rendimiento del tipado",
	"Lectura ampliada",
];
const TYPESCRIPT_LINKS = [
	"https://www.typescriptlang.org/tsconfig/strict.html",
	"https://www.typescriptlang.org/docs/handbook/2/everyday-types.html",
	"https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
	"https://www.typescriptlang.org/docs/handbook/2/functions.html",
	"https://typescript-eslint.io/getting-started/typed-linting/",
	"https://typescript-eslint.io/blog/avoiding-anys/",
	"https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html",
	"https://nodejs.org/api/typescript.html",
	"https://zod.dev/basics",
	"https://github.com/microsoft/TypeScript/wiki/Performance",
];
const RULES_MIN = 25;
const RULES_MAX = 45;

// Integracion con sdd-init (CA-9), sobre el SKILL.md con invocaciones normalizadas.
const SDD_INIT_DOCTRINE: RegExp[] = [
	/^- \*\*Coding policies del proyecto\*\*: si existe `\.sdd\/coding-policies\.md`[^\n]*escribir sin preguntar la fila `guia`[^\n]*también con `--assume`/m,
	/o si la fila `coding-policies` ya presente en `## Politicas de generacion` apunta a un archivo existente, porque el skill acepta `--out`/,
	/\| coding-policies \| <ruta> \(<stacks del marker>\) \| guia — sin gate: «skill:sdd-run» la sigue al generar, la juzga el reviewer \|/,
	/[Ss]i no existe, sumar al menú la opción `Generar coding policies`[^\n]*invoca `«skill:coding-policies»`; nunca con `--assume`/,
	/^\| Coding policies \| existe `\.sdd\/coding-policies\.md` pero `## Politicas de generacion` no tiene la fila `coding-policies` — no entra al menú: la Fase 3\.5 la escribe sin preguntar y el reporte la lista como `referenciado` \|$/m,
	/^- coding-policies: <referenciado\|generado\|no existe \(ofrecido\)\|--assume: no ofrecido>$/m,
];

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return await readFile(repoFile(path), "utf8");
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(repoFile(path));
		return true;
	} catch {
		return false;
	}
}

// El Pi Package shippea lo que git trackea, no el working tree: un artefacto
// del skill sin trackear pasaria el resto del gate y no llegaria a nadie.
export function isTracked(path: string): boolean {
	try {
		execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function normalizeQuestions(text: string, harness: Harness): string {
	let result = text;
	for (const [phrase, token] of QUESTION_PHRASES[harness]) {
		result = result.split(phrase).join(token);
	}
	return result;
}

export function delimited(markdown: string, name: string): string | null {
	const block = markdown.match(new RegExp(`<!-- ${name}:start -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`));
	return block ? (block[1] ?? "") : null;
}

// Doctrina comparable entre harnesses: invocaciones y tool de preguntas
// reducidas a tokens, y el mecanismo de AGENTS.md (legitimamente distinto en
// opencode) reducido a un token que se valida aparte.
export function normalizeDoctrine(doctrine: string, harness: Harness, prefix: string): string {
	const withoutAgents = doctrine.replace(
		/<!-- coding-policies-agents-link:start -->\n[\s\S]*?\n<!-- coding-policies-agents-link:end -->/,
		"«agents-link»",
	);
	return normalizeQuestions(normalizeInvocations(withoutAgents, prefix), harness);
}

export function templateFence(markdown: string): string | null {
	const fence = fencedBlocks(markdown).find((candidate) =>
		/^<!-- coding-policies: generated=/m.test(candidate.content),
	);
	return fence ? fence.content : null;
}

interface Frontmatter {
	fields: Record<string, string>;
	body: string;
}

export function splitFrontmatter(markdown: string): Frontmatter | null {
	const lines = markdown.split("\n");
	if (lines[0] !== "---") return null;
	const end = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
	if (end < 0) return null;
	const fields: Record<string, string> = {};
	for (const line of lines.slice(1, end)) {
		const match = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
		if (match) fields[match[1] ?? ""] = (match[2] ?? "").trim();
	}
	return { fields, body: lines.slice(end + 1).join("\n") };
}

interface Rule {
	level: "MUST" | "SHOULD";
	rule: string;
	why: string;
	gate: string;
}

export function parseRule(line: string): Rule | string {
	const head = line.match(/^- \*\*(MUST|SHOULD)\*\* (.+)$/);
	if (!head) return "no empieza con `- **MUST**` o `- **SHOULD**`";
	const rest = head[2] ?? "";
	const whyParts = rest.split(". Porqué: ");
	if (whyParts.length !== 2) return "no tiene exactamente un `. Porqué: `";
	const gateParts = (whyParts[1] ?? "").split(". Gate: ");
	if (gateParts.length !== 2) return "no tiene exactamente un `. Gate: `";
	const rule = (whyParts[0] ?? "").trim();
	const why = (gateParts[0] ?? "").trim();
	const gate = (gateParts[1] ?? "").trim();
	if (rule === "") return "regla vacía";
	if (why === "") return "porqué vacío";
	if (gate !== "—" && !/`[^`]+`/.test(gate)) return "el gate no es `—` ni nombra una herramienta entre backticks";
	return { level: head[1] as "MUST" | "SHOULD", rule, why, gate };
}

interface ReferenceVerdict {
	problems: string[];
	rules: Rule[];
	sections: string[];
	fields: Record<string, string>;
}

export function validateReference(markdown: string, expectedSections: string[], links: string[]): ReferenceVerdict {
	const problems: string[] = [];
	const rules: Rule[] = [];
	const sections: string[] = [];
	const split = splitFrontmatter(markdown);
	if (!split) {
		return { problems: ["sin frontmatter YAML"], rules, sections, fields: {} };
	}
	const { fields, body } = split;
	if (!/^[a-z][a-z0-9-]*$/.test(fields.stack ?? "")) problems.push("frontmatter sin `stack` válido");
	if ((fields.name ?? "") === "") problems.push("frontmatter sin `name`");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.version ?? "")) problems.push("frontmatter sin `version: YYYY-MM-DD`");

	let current: string | null = null;
	body.split("\n").forEach((line, index) => {
		const number = index + 1;
		const heading = line.match(/^(#{1,6}) (.*)$/);
		if (heading) {
			if ((heading[1] ?? "").length !== 3) {
				problems.push(`línea ${number}: encabezado de nivel distinto de ### (\`${line}\`)`);
				return;
			}
			current = (heading[2] ?? "").trim();
			sections.push(current);
			return;
		}
		if (!line.startsWith("- ")) return;
		if (current === null) {
			problems.push(`línea ${number}: bullet fuera de toda sección`);
			return;
		}
		if (current === "Lectura ampliada") return;
		const parsed = parseRule(line);
		if (typeof parsed === "string") {
			problems.push(`línea ${number}: ${parsed} (\`${line.slice(0, 60)}\`)`);
			return;
		}
		rules.push(parsed);
	});

	if (sections.join(" ") !== expectedSections.join(" ")) {
		problems.push(`secciones ${JSON.stringify(sections)} — esperadas ${JSON.stringify(expectedSections)} en ese orden`);
	}
	if (rules.length < RULES_MIN || rules.length > RULES_MAX) {
		problems.push(`${rules.length} reglas — esperadas entre ${RULES_MIN} y ${RULES_MAX}`);
	}
	const reading = body.split("### Lectura ampliada")[1] ?? "";
	for (const link of links) {
		if (!reading.includes(link)) problems.push(`Lectura ampliada sin el link ${link}`);
	}
	return { problems, rules, sections, fields };
}

// Compara los harnesses presentes en el mapa, el primero como referencia;
// un harness ausente no se inventa como divergencia (permite comparar
// subconjuntos, como el bloque de AGENTS.md que opencode no comparte).
export function compareAcrossHarnesses(label: string, byHarness: Map<Harness, string>): string[] {
	const divergences: string[] = [];
	const [reference, ...rest] = [...byHarness.keys()];
	if (reference === undefined) return divergences;
	const referenceText = byHarness.get(reference) ?? "";
	for (const harness of rest) {
		const other = byHarness.get(harness) ?? "";
		if (other !== referenceText) {
			divergences.push(`${label}: ${reference} y ${harness} difieren — ${firstDifference(referenceText, other)}`);
		}
	}
	return divergences;
}

async function skillMarkdown(harness: Harness): Promise<string> {
	return await readRepoFile(`${harness}/${SKILL}/SKILL.md`);
}

// --- CA-1: artefactos por harness --------------------------------------------

for (const harness of HARNESSES) {
	test(`${harness}/${SKILL}: SKILL.md con frontmatter y extras propios del harness`, async () => {
		const markdown = await skillMarkdown(harness);
		const split = splitFrontmatter(markdown);
		assert.ok(split, "SKILL.md abre con frontmatter YAML");
		assert.equal(split.fields.name, SKILL, "name igual a la carpeta");
		assert.match(
			split.fields.description ?? "",
			/coding policies[\s\S]*buenas prácticas[\s\S]*políticas de código/i,
			"la description dispara con los pedidos esperados",
		);
		assert.match(split.fields.description ?? "", /"mis prácticas de TypeScript"/, "la description dispara para TypeScript");
		assert.match(markdown, /`references\/typescript\.md` — TypeScript/, "la lista de referencias incluye TypeScript");
		const hasSidecar = await exists(`${harness}/${SKILL}/agents/openai.yaml`);
		if (harness === "codex") {
			assert.ok(hasSidecar, "codex lleva agents/openai.yaml");
			const sidecar = await readRepoFile(`${harness}/${SKILL}/agents/openai.yaml`);
			for (const key of ["display_name", "short_description", "default_prompt"]) {
				assert.match(sidecar, new RegExp(`^\\s*${key}: "[^"]+"$`, "m"), `sidecar declara ${key}`);
			}
			assert.match(sidecar, /default_prompt: "[^"]*\$coding-policies/, "default_prompt invoca $coding-policies");
		} else {
			assert.equal(hasSidecar, false, `${harness} no lleva sidecar de Codex`);
		}
		if (harness === "pi") {
			assert.match(split.fields.compatibility ?? "", /ask_user_question/, "pi declara compatibility con la tool de preguntas");
		} else {
			assert.equal(split.fields.compatibility, undefined, `${harness} no declara compatibility`);
		}
	});
}

// --- CA-2: capa de interaccion propia y doctrina equivalente ------------------

for (const harness of HARNESSES) {
	test(`${harness}/${SKILL}: usa la tool de preguntas de su harness y ninguna ajena`, async () => {
		const markdown = await skillMarkdown(harness);
		for (const required of QUESTION_STYLE[harness].required) {
			assert.match(markdown, required, `${harness} no usa ${required}`);
		}
		assert.doesNotMatch(markdown, QUESTION_STYLE[harness].forbidden, `${harness} menciona una tool de otro harness`);
		assert.match(markdown, AGENTS_LINK_STYLE[harness], `${harness} no declara su mecanismo de enganche en AGENTS.md`);
	});
}

test(`${SKILL}: doctrina byte-equivalente entre harnesses tras normalizar la capa de interaccion`, async () => {
	const byHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const doctrine = delimited(await skillMarkdown(harness), "coding-policies-doctrine");
		assert.ok(doctrine, `${harness}/${SKILL}/SKILL.md delimita su doctrina`);
		byHarness.set(harness, normalizeDoctrine(doctrine, harness, (await invocationPrefixes())[harness]));
	}
	assert.deepEqual(compareAcrossHarnesses(SKILL, byHarness), []);
	// El bloque de AGENTS.md se compara crudo y por separado: tiene que ser
	// byte-igual en las cuatro copias, no solo matchear la regex laxa de
	// AGENTS_LINK_STYLE.
	const blocks = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const block = delimited(await skillMarkdown(harness), "coding-policies-agents-link");
		assert.ok(block, `${harness}/${SKILL}/SKILL.md delimita el bloque de AGENTS.md`);
		blocks.set(harness, block);
	}
	assert.deepEqual(compareAcrossHarnesses(`${SKILL} bloque AGENTS.md`, blocks), []);
});

test(`${SKILL}: los artefactos del skill estan trackeados en git (el Pi Package solo shippea lo trackeado)`, () => {
	const artifacts = HARNESSES.flatMap((harness) => [
		`${harness}/${SKILL}/SKILL.md`,
		`${harness}/${SKILL}/references/go.md`,
		`${harness}/${SKILL}/references/typescript.md`,
	]).concat([`codex/${SKILL}/agents/openai.yaml`]);
	assert.deepEqual(artifacts.filter((path) => !isTracked(path)), [], "artefactos sin trackear");
});

// --- CA-6: procedimiento completo --------------------------------------------

for (const harness of HARNESSES) {
	test(`${harness}/${SKILL}: declara el procedimiento completo`, async () => {
		const doctrine = delimited(await skillMarkdown(harness), "coding-policies-doctrine");
		assert.ok(doctrine);
		const normalized = normalizeDoctrine(doctrine, harness, (await invocationPrefixes())[harness]);
		for (const expected of PROCEDURE_DOCTRINE) {
			assert.match(normalized, expected, `${harness}/${SKILL}/SKILL.md no declara ${expected}`);
		}
	});
}

// --- CA-8: template del archivo generado -------------------------------------

test(`${SKILL}: template del archivo generado identico entre harnesses y con sus markers`, async () => {
	const byHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const fence = templateFence(await skillMarkdown(harness));
		assert.ok(fence, `${harness}/${SKILL}/SKILL.md instruye el template del archivo generado`);
		for (const marker of TEMPLATE_MARKERS) {
			assert.match(fence, marker, `${harness}: el template no declara ${marker}`);
		}
		byHarness.set(harness, normalizeInvocations(fence, (await invocationPrefixes())[harness]));
	}
	assert.deepEqual(compareAcrossHarnesses(`${SKILL} template`, byHarness), []);
});

// --- CA-4: referencia Go -----------------------------------------------------

test(`${SKILL}: references/go.md valida e identica byte a byte en los cuatro harnesses`, async () => {
	const byHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		byHarness.set(harness, await readRepoFile(`${harness}/${SKILL}/references/go.md`));
	}
	assert.deepEqual(compareAcrossHarnesses("references/go.md", byHarness), []);
	const verdict = validateReference(byHarness.get("claude") ?? "", GO_SECTIONS, GO_LINKS);
	assert.deepEqual(verdict.problems, []);
	assert.equal(verdict.fields.stack, "go");
	assert.equal(verdict.fields.name, "Go");
	assert.ok(verdict.rules.some((rule) => rule.level === "MUST"), "hay reglas MUST");
	assert.ok(verdict.rules.some((rule) => rule.level === "SHOULD"), "hay reglas SHOULD");
	assert.ok(verdict.rules.some((rule) => rule.gate !== "—"), "alguna regla nombra un gate concreto");
});

// --- Referencia TypeScript ---------------------------------------------------

test(`${SKILL}: references/typescript.md valida e identica byte a byte en los cuatro harnesses`, async () => {
	const byHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		byHarness.set(harness, await readRepoFile(`${harness}/${SKILL}/references/typescript.md`));
	}
	assert.deepEqual(compareAcrossHarnesses("references/typescript.md", byHarness), []);
	const verdict = validateReference(byHarness.get("claude") ?? "", TYPESCRIPT_SECTIONS, TYPESCRIPT_LINKS);
	assert.deepEqual(verdict.problems, []);
	assert.equal(verdict.fields.stack, "typescript");
	assert.equal(verdict.fields.name, "TypeScript");
	assert.ok(verdict.rules.some((rule) => rule.level === "MUST"), "hay reglas MUST");
	assert.ok(verdict.rules.some((rule) => rule.level === "SHOULD"), "hay reglas SHOULD");
	assert.ok(verdict.rules.some((rule) => rule.gate !== "—"), "alguna regla nombra un gate concreto");
});

// --- CA-9: integracion con sdd-init ------------------------------------------

test("sdd-init integra coding-policies en los cuatro harnesses sin tocar el template del contrato", async () => {
	const bullets = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-init/SKILL.md`);
		const normalized = normalizeInvocations(markdown, (await invocationPrefixes())[harness]);
		for (const expected of SDD_INIT_DOCTRINE) {
			assert.match(normalized, expected, `${harness}/sdd-init/SKILL.md no declara ${expected}`);
		}
		const bullet = normalized.match(/^- \*\*Coding policies del proyecto\*\*:[^\n]*$/m)?.[0] ?? "";
		bullets.set(harness, bullet);
		const contractTemplate = fencedBlocks(markdown).find((fence) => /type=project; generated-at=/.test(fence.content));
		assert.ok(contractTemplate, `${harness}/sdd-init/SKILL.md conserva el template del contrato`);
		assert.doesNotMatch(contractTemplate.content, /coding-policies/, `${harness}: el template del contrato no cambia`);
	}
	assert.deepEqual(compareAcrossHarnesses("sdd-init coding-policies", bullets), []);
});

// --- CA-10: documentacion ----------------------------------------------------

test("READMEs y manifests del plugin documentan coding-policies", async () => {
	for (const readme of ["README.md", "README.en.md"]) {
		const text = await readRepoFile(readme);
		const row = text.match(/^\| \*\*`coding-policies`\*\* \|[^\n]*\|$/m)?.[0] ?? "";
		assert.notEqual(row, "", `${readme} tiene la fila coding-policies en la tabla de skills`);
		assert.match(row, /\.sdd\/coding-policies\.md/, `${readme}: la fila dice dónde genera`);
		assert.match(row, /Go/, `${readme}: la fila anuncia cobertura para Go`);
		assert.match(row, /TypeScript/, `${readme}: la fila anuncia cobertura para TypeScript`);
		assert.match(row, /(?:contenido|content)[^|]*Go[^|]*TypeScript/i, `${readme}: la fila dice que ambos tienen contenido`);
		assert.match(row, /[Aa]justes|[Aa]djustments/, `${readme}: la fila menciona la preservación de ajustes`);
	}
	for (const manifest of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
		const parsed = JSON.parse(await readRepoFile(manifest)) as {
			description?: string;
			keywords?: string[];
			plugins?: { description?: string; keywords?: string[] }[];
		};
		const entries = manifest.endsWith("marketplace.json") ? parsed.plugins ?? [] : [parsed];
		assert.ok(entries.length > 0, `${manifest} declara al menos una entrada`);
		for (const entry of entries) {
			assert.match(entry.description ?? "", /coding-policies/, `${manifest}: description menciona coding-policies`);
			assert.ok((entry.keywords ?? []).includes("coding-policies"), `${manifest}: keywords incluye coding-policies`);
		}
	}
});

// --- Autotests del gate: puede fallar y con que diagnostico -------------------

function syntheticReference(options: { rules?: number; dropSection?: string; breakRule?: string } = {}): string {
	const count = options.rules ?? 30;
	const sections = GO_SECTIONS.filter((section) => section !== options.dropSection);
	const ruleSections = sections.filter((section) => section !== "Lectura ampliada");
	const lines = ["---", "stack: go", "name: Go", "version: 2026-09-14", "---", ""];
	let emitted = 0;
	ruleSections.forEach((section, index) => {
		lines.push(`### ${section}`, "");
		const share = index === ruleSections.length - 1 ? count - emitted : Math.floor(count / ruleSections.length);
		for (let i = 0; i < share; i++) {
			lines.push(`- **MUST** Regla ${emitted + 1}. Porqué: motivo. Gate: \`go vet\``);
			emitted += 1;
		}
		lines.push("");
	});
	if (options.breakRule) {
		const index = lines.findIndex((line) => line.startsWith("- **MUST** Regla 1."));
		assert.ok(index >= 0, "la referencia sintetica tiene la regla 1 que el autotest va a romper");
		lines.splice(index, 1, options.breakRule);
	}
	if (sections.includes("Lectura ampliada")) {
		lines.push("### Lectura ampliada", "", ...GO_LINKS.map((link) => `- [${link}](${link})`), "");
	}
	return lines.join("\n");
}

test("autotest: una referencia sintetica valida pasa sin diagnosticos", () => {
	const verdict = validateReference(syntheticReference(), GO_SECTIONS, GO_LINKS);
	assert.deepEqual(verdict.problems, []);
	assert.equal(verdict.rules.length, 30);
});

test("autotest: una regla sin Gate se reporta con su linea", () => {
	const verdict = validateReference(
		syntheticReference({ breakRule: "- **MUST** Regla 1. Porqué: motivo sin gate" }),
		GO_SECTIONS,
		GO_LINKS,
	);
	assert.equal(verdict.problems.length, 1);
	assert.match(verdict.problems[0] ?? "", /no tiene exactamente un `\. Gate: `/);
});

test("autotest: un gate que no nombra herramienta se reporta", () => {
	assert.match(String(parseRule("- **SHOULD** Regla. Porqué: motivo. Gate: revisar a mano")), /no es `—` ni nombra/);
	assert.equal(typeof parseRule("- **SHOULD** Regla. Porqué: motivo. Gate: —"), "object");
	assert.equal(typeof parseRule("- **MUST** Regla. Porqué: motivo. Gate: `golangci-lint` (errcheck)"), "object");
});

test("autotest: una seccion faltante se reporta con el orden esperado", () => {
	const verdict = validateReference(syntheticReference({ dropSection: "Concurrencia" }), GO_SECTIONS, GO_LINKS);
	assert.equal(verdict.problems.length, 1);
	assert.match(verdict.problems[0] ?? "", /secciones .* esperadas/);
});

test("autotest: fuera del rango de reglas se reporta con el conteo", () => {
	const few = validateReference(syntheticReference({ rules: RULES_MIN - 1 }), GO_SECTIONS, GO_LINKS);
	assert.match(few.problems.join("\n"), new RegExp(`${RULES_MIN - 1} reglas`));
	const many = validateReference(syntheticReference({ rules: RULES_MAX + 1 }), GO_SECTIONS, GO_LINKS);
	assert.match(many.problems.join("\n"), new RegExp(`${RULES_MAX + 1} reglas`));
});

test("autotest: la normalizacion reduce invocacion y tool de preguntas al mismo token", () => {
	const claude = normalizeDoctrine("usar `AskUserQuestion` con multiSelect tras /coding-policies", "claude", "/");
	const codex = normalizeDoctrine(
		"preguntar en texto plano con todas las opciones y terminar el turno tras $coding-policies",
		"codex",
		"$",
	);
	const pi = normalizeDoctrine(
		'usar `ask_user_question` con `selectionMode: "multiple"` tras /skill:coding-policies',
		"pi",
		"/skill:",
	);
	assert.equal(claude, codex);
	assert.equal(codex, pi);
	assert.equal(claude, "«pregunta-multiple» tras «skill:coding-policies»");
});

test("autotest: una divergencia de doctrina entre harnesses se reporta con la linea", () => {
	const byHarness = new Map<Harness, string>([
		["claude", "a\nb"],
		["codex", "a\nb"],
		["opencode", "a\nDIVERGENTE"],
		["pi", "a\nb"],
	]);
	const divergences = compareAcrossHarnesses("x", byHarness);
	assert.equal(divergences.length, 1);
	assert.match(divergences[0] ?? "", /opencode[\s\S]*DIVERGENTE/);
});

test("autotest: la comparacion acepta un subconjunto de harnesses sin inventar ausentes", () => {
	const three = new Map<Harness, string>([
		["claude", "bloque"],
		["codex", "bloque"],
		["pi", "bloque DIVERGENTE"],
	]);
	const divergences = compareAcrossHarnesses("subconjunto", three);
	assert.equal(divergences.length, 1, "solo pi diverge; opencode no se compara porque no esta en el mapa");
	assert.match(divergences[0] ?? "", /pi[\s\S]*DIVERGENTE/);
});

test("autotest: un archivo untracked se reporta como no trackeado y uno trackeado como trackeado", async () => {
	const scratch = `claude/${SKILL}/references/.scratch-${process.pid}.md`;
	await writeFile(repoFile(scratch), "scratch untracked\n");
	try {
		assert.equal(isTracked(scratch), false);
		assert.equal(isTracked(`claude/${SKILL}/SKILL.md`), true);
	} finally {
		await rm(repoFile(scratch), { force: true });
	}
});
