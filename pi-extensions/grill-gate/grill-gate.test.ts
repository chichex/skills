// Gate anti-drift de la doctrina de bloques de grill (issue #89, CA-1 a CA-6, CA-9, CA-11 y CA-12).
//
// El skill `grill` entrevista sin tope de preguntas y siempre por bloques, en los cuatro
// harnesses, con doctrina idéntica y solo la capa de interacción distinta. Este gate lee los
// SKILL.md reales, exige con regexes la doctrina de cada CA, compara el bloque delimitado
// `grill-blocks` entre harnesses tras normalizar invocaciones y tool de preguntas, y observa el
// wiring del repo (runtime de Pi, README, contrato, CI). Es solo-tests, igual que `design-gate`
// y `sdd-land-gate`: esta carpeta no tiene `index.ts` ni factory, porque el gate del Pi Package
// censa exactamente las factories de produccion. La conducta de un agente siguiendo la doctrina
// (CA-14) es prueba humana y no se verifica aca.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { test } from "node:test";

import type { Harness } from "../harness-gate/interaction.ts";
import {
	HARNESSES,
	escapeRegExp,
	fencedBlocks,
	firstDifference,
	normalizeInvocations,
	parseInteractionTable,
} from "../harness-gate/interaction.ts";

const REPO_ROOT = new URL("../../", import.meta.url);

function repoFile(path: string): URL {
	return new URL(path, REPO_ROOT);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

async function grillSkill(harness: Harness): Promise<string> {
	return readRepoFile(`${harness}/grill/SKILL.md`);
}

// Archivos trackeados en git (el indice), no lo que haya en el working tree de un dev: un borrador
// local sin trackear no entra al censo. Mismo criterio que pi-package y sdd-land-gate.
function trackedFiles(...pathspecs: string[]): string[] {
	const output = execFileSync("git", ["ls-files", "-z", "--", ...pathspecs], {
		cwd: repoFile("."),
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	return output.split("\0").filter(Boolean);
}

export function delimitedBlock(markdown: string, name: string): string | null {
	const block = markdown.match(new RegExp(`<!-- ${escapeRegExp(name)}:start -->\\n([\\s\\S]*?)\\n<!-- ${escapeRegExp(name)}:end -->`));
	return block ? (block[1] ?? "") : null;
}

// Cuerpo de la seccion cuyo encabezado (de cualquier nivel) cumple `heading`, hasta el siguiente
// encabezado del mismo nivel o superior.
function section(markdown: string, heading: RegExp): string {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => /^#{1,6} /.test(line) && heading.test(line));
	if (start === -1) return "";
	const level = (lines[start]?.match(/^#+/)?.[0] ?? "#").length;
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		const marker = lines[index]?.match(/^(#{1,6}) /)?.[1];
		if (marker && marker.length <= level) {
			end = index;
			break;
		}
	}
	return lines.slice(start, end).join("\n");
}

export function missing(text: string, patterns: RegExp[]): string[] {
	return patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `falta ${pattern}`);
}

export function present(text: string, patterns: RegExp[]): string[] {
	return patterns.filter((pattern) => pattern.test(text)).map((pattern) => `sobra ${pattern}`);
}

// Lee el bloque delimitado `name`, normaliza las invocaciones de skills del repo a la sintaxis
// de Claude y la tool de preguntas del harness a un token comun. Es la vista que se compara.
async function normalizedBlocks(name: string): Promise<{ blocks: Map<Harness, string>; problems: string[] }> {
	const table = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const blocks = new Map<Harness, string>();
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/grill/SKILL.md`;
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

export function divergences(blocks: Map<Harness, string>): string[] {
	const [reference, ...rest] = HARNESSES;
	return rest
		.filter((harness) => blocks.has(harness) && blocks.get(harness) !== blocks.get(reference))
		.map((harness) => `${reference} vs ${harness}: ${firstDifference(blocks.get(reference) ?? "", blocks.get(harness) ?? "")}`);
}

// ---------------------------------------------------------------------------
// A. Sin tope en la doctrina (CA-1)
// ---------------------------------------------------------------------------

// El nombre del campo retirado del runtime se arma a pedazos: CA-9 exige que no aparezca escrito
// en ningun archivo trackeado de pi-extensions, y este gate tambien lo es.
const RETIRED_FIELD = ["question", "Limit"].join("");
const RETIRED_CONSTANT = ["QUESTION", "LIMIT"].join("_");

export const CAP_PHRASES: RegExp[] = [
	/Límite de 20/,
	/tope de 20/,
	/límite de 20/,
	/20 preguntas/,
	/hasta 20/,
	/elección de bloque/,
	new RegExp(RETIRED_FIELD),
];

const PER_CALL_MENTION: Record<Harness, RegExp> = {
	claude: /hasta 4 preguntas por llamada/,
	codex: /hasta 3 preguntas/,
	opencode: /hasta 4 preguntas por llamada/,
	pi: /hasta 4 preguntas/,
	antigravity: /hasta 4 preguntas/,
};

test("CA-1: ningún grill/SKILL.md habla de un tope de 20 ni de elegir bloque", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		for (const problem of present(await grillSkill(harness), CAP_PHRASES)) problems.push(`${harness}/grill/SKILL.md: ${problem}`);
	}
	assert.deepEqual(problems, []);
});

test("CA-1: las menciones al máximo por llamada de cada tool se conservan", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		for (const problem of missing(await grillSkill(harness), [PER_CALL_MENTION[harness]])) problems.push(`${harness}/grill/SKILL.md: ${problem}`);
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// B. Bloque compartido `grill-blocks` (CA-2 y CA-3)
// ---------------------------------------------------------------------------

const BLOCKS_DOCTRINE: RegExp[] = [
	// (a)
	/Un bloque es una sección coherente del árbol de decisiones/,
	// (b)
	/mapa del reconocimiento lista los bloques en orden de dependencias, cada uno con su estimación/,
	// (c)
	/El agente ordena y anuncia los bloques, sin preguntar cuál abordar[^\n]*respuesta libre de la configuración o en cualquier momento/,
	// (d)
	/Dentro del bloque\.\*\* Se entrevista por rondas sobre la frontera o pregunta a pregunta/,
	// (e)
	/Una sesión recorre todos los bloques, uno tras otro/,
	// (f)
	/Al cerrar un bloque, el agente muestra un resumen corto de lo decidido, anuncia el siguiente y hace UNA pregunta con dos opciones: «Seguir con <bloque>» \(recomendada\) y «Cortar acá y seguir más tarde»\. Cortar es pausar, con la exportación de cuestionario disponible/,
	// (g)
	/Después del último bloque no hay frontera[^\n]*se pasa al cierre/,
	// (h)
	/La pregunta de frontera de bloque, la configuración y la confirmación final no son preguntas de decisión y no entran en la estimación/,
	// review #90: el handoff pausado conserva a qué bloque pertenece cada decisión sin cambiar su formato
	/\*\*Handoff pausado\.\*\* Mientras la sesión está `paused`, cada decisión de `## Decisiones resueltas` va con el prefijo de su bloque \(`<Bloque>: \.\.\.`, como `Diseño:`\) y cada entrada de `## Ramas pendientes` lleva el encabezado de su bloque, para reconstruir los bloques al retomar/,
];

test("CA-2: los cuatro grill/SKILL.md llevan el bloque grill-blocks bajo ### Bloques con la doctrina de (a) a (h)", async () => {
	const { blocks, problems } = await normalizedBlocks("grill-blocks");
	for (const [harness, block] of blocks) {
		for (const problem of missing(block, BLOCKS_DOCTRINE)) problems.push(`${harness}/grill: <!-- grill-blocks -->: ${problem}`);
		const skill = await grillSkill(harness);
		if (!/^### Bloques\n\n<!-- grill-blocks:start -->$/m.test(skill)) {
			problems.push(`${harness}/grill: el bloque grill-blocks no está inmediatamente bajo el título \`### Bloques\``);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-3: el bloque grill-blocks es idéntico entre harnesses tras normalizar invocaciones y tool de preguntas", async () => {
	const { blocks, problems } = await normalizedBlocks("grill-blocks");
	assert.deepEqual([...problems, ...divergences(blocks)], []);
});

// ---------------------------------------------------------------------------
// C. Capa de cada harness fuera del bloque (CA-4)
// ---------------------------------------------------------------------------

test("CA-4: en Claude Code, Codex y opencode el atajo liviano no usa bloques ni frontera de bloque", async () => {
	const problems: string[] = [];
	for (const harness of ["claude", "codex", "opencode"] as const) {
		const shortcut = section(await grillSkill(harness), /^### Atajo liviano \(1 a 3 preguntas\)$/);
		if (shortcut === "") problems.push(`${harness}/grill: falta el atajo liviano`);
		for (const problem of missing(shortcut, [/sin mapa, configuración, bloques ni frontera de bloque, todo en una sola ronda/])) problems.push(`${harness}/grill: atajo liviano ${problem}`);
	}
	assert.deepEqual(problems, []);
});

test("CA-4: en Codex y opencode el Grillado rápido propone las decisiones del bloque en curso y aplica la frontera de bloque", async () => {
	const problems: string[] = [];
	for (const harness of ["codex", "opencode"] as const) {
		const quick = section(await grillSkill(harness), /^## Grillado rápido$/);
		if (quick === "") problems.push(`${harness}/grill: falta la sección Grillado rápido`);
		for (const problem of missing(quick, [/Renderizar las decisiones del bloque en curso en orden de dependencia/, /frontera de bloque/])) problems.push(`${harness}/grill: Grillado rápido ${problem}`);
	}
	assert.deepEqual(problems, []);
});

const PI_BLOCKS_LAYER: RegExp[] = [
	/En Pi, los bloques se persisten como `sections` de `grill_session`, cada una con `status` \(`pending`, `active`, `resolved`\) que se actualiza en cada `checkpoint` y en cada frontera de bloque/,
	/La pregunta de frontera de bloque va por `ask_user_question` con `grill: \{ sessionId, phase: "configuration" \}`, sin `frontierSize`/,
	/El Grillado rápido va bloque a bloque: propuesta y revisión colectiva del bloque en curso, y frontera de bloque entre bloques/,
	// review #90: decision.section = id del bloque; la tool escribe el prefijo al pausar
	/`decision\.section` lleva el id del bloque, y cada rama de `pendingBranches` también con `section`; al pausar, la tool escribe el título del bloque como prefijo de cada decisión y de cada rama/,
	// review #90: un bloque sin checkpoint corrige el status en el checkpoint siguiente o en el pause
	/Si el bloque no tuvo `checkpoint` \(todas sus elecciones quedaron `\[ASSUMED\]`\), el `status` de las secciones se corrige en el primer `checkpoint` del bloque siguiente o en el `pause`/,
];

test("CA-4: en Pi la frontera de bloque va por configuration, los bloques se persisten como sections con status y el Grillado rápido va bloque a bloque", async () => {
	const skill = await grillSkill("pi");
	const problems = missing(skill, PI_BLOCKS_LAYER).map((problem) => `pi/grill: ${problem}`);
	const quick = section(skill, /^### Modalidad C: Grillado rápido$/);
	for (const problem of missing(quick, [/bloque en curso/, /frontera de bloque/])) problems.push(`pi/grill: Modalidad C ${problem}`);
	const frontierBullet = skill.split("\n").find((line) => line.startsWith("- `frontierSize`:")) ?? "";
	for (const problem of missing(frontierBullet, [/Vale 1 en modo adaptativo, de 1 a 4 en rondas y la cantidad de decisiones del bloque en la revisión colectiva del modo rápido/])) problems.push(`pi/grill: frontierSize ${problem}`);
	for (const problem of present(frontierBullet, [/\b\d{2,}\b/])) problems.push(`pi/grill: frontierSize ${problem}`);
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// D. Cierre, reanudación y pausa por bloques (CA-5)
// ---------------------------------------------------------------------------

const BLOCKS_LIFECYCLE: RegExp[] = [
	/todos los bloques estén resueltos/,
	/decisiones(?: resueltas)?,? agrupadas por bloque y enumeradas/,
	/bloques cerrados con sus decisiones resueltas \(agrupadas por su prefijo de bloque\)[^\n]*el bloque en curso[^\n]*bloques pendientes[^\n]*por el bloque en curso/,
	/`## Ramas pendientes`[^\n]*lista lo pendiente del bloque en curso y los bloques no empezados, en orden/,
];

test("CA-5: los cuatro harnesses cierran, reanudan y pausan por bloques sin cambiar el formato del handoff", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const skill = await grillSkill(harness);
		for (const problem of missing(skill, BLOCKS_LIFECYCLE)) problems.push(`${harness}/grill: ${problem}`);
		const templates = fencedBlocks(skill).filter((fence) => fence.content.includes("type=grill"));
		if (templates.length !== 1) problems.push(`${harness}/grill: ${templates.length} templates con marker type=grill`);
		for (const problem of missing(templates[0]?.content ?? "", [/SDD-Tracking: version=1; type=grill; state=<paused\|finalized>; issue=<#NN\|owner\/repo#NN\|none>; grill=<ref>; project=<ref>/, /## Hechos comprobados[\s\S]*## Decisiones resueltas[\s\S]*## Ramas pendientes[\s\S]*## Diseño[\s\S]*## Handoff/])) problems.push(`${harness}/grill: template del handoff ${problem}`);
	}
	assert.deepEqual(problems, []);
});

// Restos del modelo de sesión acotada a un bloque elegido: con «todos los bloques resueltos» el
// mapa no declara un alcance de sesión y el contrato no lista bloques para futuras sesiones.
const BOUNDED_SESSION_REMNANTS: RegExp[] = [
	/alcance de (?:la|esta) sesión/,
	/bloques pendientes para futuras sesiones/,
	/futuras sesiones/,
	/riesgos, pendientes/,
];

test("review #90: ni el mapa ni el contrato del cierre conservan restos de la sesión acotada", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		for (const problem of present(await grillSkill(harness), BOUNDED_SESSION_REMNANTS)) problems.push(`${harness}/grill/SKILL.md: ${problem}`);
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// E. Límites y clasificación de UI sin tope (CA-6)
// ---------------------------------------------------------------------------

test("CA-6: ## Límites conserva «preguntas compuestas» sin referencia a un tope", async () => {
	const problems: string[] = [];
	for (const harness of ["claude", "codex", "opencode"] as const) {
		const limits = section(await grillSkill(harness), /^## Límites$/);
		if (limits === "") problems.push(`${harness}/grill: falta ## Límites`);
		for (const problem of missing(limits, [/preguntas compuestas: una decisión por pregunta/])) problems.push(`${harness}/grill: ## Límites ${problem}`);
		for (const problem of present(limits, [/\b20\b/, /tope/i, /límite de/i])) problems.push(`${harness}/grill: ## Límites ${problem}`);
	}
	const pi = await grillSkill("pi");
	for (const problem of missing(pi, [/no armes preguntas compuestas/, /una decisión por pregunta/])) problems.push(`pi/grill: ${problem}`);
	assert.deepEqual(problems, []);
});

test("CA-6: la pregunta de clasificación de UI «no es una pregunta de decisión» y el bloque grill-design sigue idéntico", async () => {
	const { blocks, problems } = await normalizedBlocks("grill-design");
	for (const [harness, block] of blocks) {
		for (const problem of missing(block, [/va en el reconocimiento y no es una pregunta de decisión/])) problems.push(`${harness}/grill: <!-- grill-design -->: ${problem}`);
		for (const problem of present(block, CAP_PHRASES)) problems.push(`${harness}/grill: <!-- grill-design -->: ${problem}`);
	}
	assert.deepEqual([...problems, ...divergences(blocks)], []);
});

// ---------------------------------------------------------------------------
// F. Runtime Pi sin tope (CA-9)
// ---------------------------------------------------------------------------

export async function retiredFieldOffenders(): Promise<string[]> {
	const pattern = new RegExp(`${RETIRED_FIELD}|${RETIRED_CONSTANT}`);
	const offenders: string[] = [];
	for (const path of trackedFiles("pi-extensions")) {
		const text = await readRepoFile(path).catch(() => null);
		if (text !== null && pattern.test(text)) offenders.push(path);
	}
	return offenders;
}

test("CA-9: ningún archivo trackeado de pi-extensions nombra el tope de preguntas retirado", async () => {
	assert.deepEqual(await retiredFieldOffenders(), []);
});

// ---------------------------------------------------------------------------
// G. Wiring: README, contrato, CI y forma del gate (CA-11 y CA-12)
// ---------------------------------------------------------------------------

const README_GRILL_ROW: RegExp[] = [
	/La entrevista va por bloques en orden de dependencias/,
	/al cerrar cada bloque muestra un resumen corto/,
	/seguir con el siguiente o cortar y seguir más tarde/,
];

test("CA-11: la fila grill de README.md describe la entrevista por bloques y no menciona un tope por sesión", async () => {
	const readme = await readRepoFile("README.md");
	const rows = readme.split("\n").filter((line) => line.startsWith("| **`grill`**"));
	assert.equal(rows.length, 1, "una sola fila grill en README.md");
	const row = rows[0] ?? "";
	assert.deepEqual(missing(row, README_GRILL_ROW), []);
	assert.deepEqual(present(row, [/\btope\b/i, /\blímite\b/i, /hasta 20/, /20 preguntas/]), []);
});

test("CA-12: el contrato suma la fila del gate de grill y CI lo corre con el glob de extensiones", async () => {
	const contract = await readRepoFile(".sdd/project.md");
	const commands = section(contract, /^## Comandos$/);
	assert.match(commands, /^\| gate de doctrina de grill \| `node --test pi-extensions\/grill-gate\/grill-gate\.test\.ts` \| raiz \| verificado \d{4}-\d{2}-\d{2} \|/m);
	assert.match(await readRepoFile(".github/workflows/ci.yml"), /node --test pi-extensions\/\*\/\*\.test\.ts/);
});

const GATE_FOLDER = "pi-extensions/grill-gate";

// Sin `index.ts` ni factory (default export) entre los archivos trackeados de la carpeta del gate:
// el gate del Pi Package censa exactamente las factories de produccion.
export async function gateShapeProblems(): Promise<string[]> {
	const files = trackedFiles(GATE_FOLDER);
	const problems: string[] = [];
	if (!files.includes(`${GATE_FOLDER}/grill-gate.test.ts`)) problems.push("falta grill-gate.test.ts entre los archivos trackeados");
	for (const path of files) {
		if (basename(path) === "index.ts") problems.push(`${path}: el gate no tiene index.ts`);
		const text = await readRepoFile(path).catch(() => null);
		if (text !== null && /export\s+default/.test(text)) problems.push(`${path}: el gate no exporta una factory por default`);
	}
	return problems;
}

test("CA-12: el gate de grill es solo-tests: sin index.ts ni factory en su carpeta", async () => {
	assert.deepEqual(await gateShapeProblems(), []);
});

test("CA-9 y CA-12: un scratch file untracked real no rompe el gate (solo cuentan los archivos trackeados)", async () => {
	// Borradores locales de un dev (una nota que nombra el campo retirado, un prototipo con factory)
	// no entran en el censo: el contrato habla de archivos trackeados, como pi-package y sdd-land-gate.
	const notes = `${GATE_FOLDER}/.chichex-test-scratch-notes.md`;
	const factory = `${GATE_FOLDER}/.chichex-test-scratch-factory.ts`;
	try {
		await writeFile(repoFile(notes), `borrador que nombra ${RETIRED_FIELD} y ${RETIRED_CONSTANT}\n`, "utf8");
		await writeFile(repoFile(factory), `${["export", "default"].join(" ")} function (pi) {\n\treturn {};\n}\n`, "utf8");
		const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", GATE_FOLDER], {
			cwd: repoFile("."),
			encoding: "utf8",
		}).split("\0");
		assert.ok(untracked.includes(notes) && untracked.includes(factory), "los scratch files existen y git los ve como untracked");
		assert.equal(trackedFiles(GATE_FOLDER).includes(notes), false);
		assert.equal(trackedFiles(GATE_FOLDER).includes(factory), false);
		assert.deepEqual(await retiredFieldOffenders(), []);
		assert.deepEqual(await gateShapeProblems(), []);
	} finally {
		await rm(repoFile(notes), { force: true });
		await rm(repoFile(factory), { force: true });
	}
});

// ---------------------------------------------------------------------------
// H. Autotests del propio gate
// ---------------------------------------------------------------------------

test("autotest: el detector de tope reporta cada frase retirada y acepta la doctrina nueva", () => {
	for (const phrase of ["### Límite de 20", "Tope duro de 20 preguntas de decisión", "tope de 20", "dividilo en bloques de hasta 20", "la elección de bloque", `campo ${RETIRED_FIELD}`]) {
		assert.ok(present(phrase, CAP_PHRASES).length > 0, `detecta: ${phrase}`);
	}
	assert.deepEqual(present("hasta 4 preguntas por llamada y hasta 3 por request_user_input", CAP_PHRASES), []);
	assert.deepEqual(present("Un bloque es una sección coherente del árbol de decisiones", CAP_PHRASES), []);
});

test("autotest: un bloque ausente, incompleto o divergente se reporta con su diagnóstico", () => {
	assert.equal(delimitedBlock("sin bloque", "grill-blocks"), null);
	assert.equal(delimitedBlock("<!-- x:start -->\nhola\n<!-- x:end -->", "x"), "hola");
	const problems = missing("texto sin nada relevante", BLOCKS_DOCTRINE);
	assert.equal(problems.length, BLOCKS_DOCTRINE.length);
	assert.match(problems[0] ?? "", /Un bloque es una sección coherente/);
	const drift = divergences(new Map<Harness, string>([
		["claude", "a\nb"],
		["codex", "a\nc"],
		["opencode", "a\nb"],
		["pi", "a\nb"],
	]));
	assert.deepEqual(drift, ["claude vs codex: linea 2: `b` vs `c`"]);
});

test("autotest: section() recorta hasta el siguiente encabezado del mismo nivel", () => {
	const markdown = "## A\ntexto A\n### A.1\nsub\n## B\ntexto B";
	assert.equal(section(markdown, /^## A$/), "## A\ntexto A\n### A.1\nsub");
	assert.equal(section(markdown, /^### A\.1$/), "### A.1\nsub");
	assert.equal(section(markdown, /^## Z$/), "");
});
