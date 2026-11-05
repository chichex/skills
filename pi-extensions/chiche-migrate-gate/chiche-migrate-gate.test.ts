// Gate de la migración `.sdd/` → `.chiche/` de chiche-init (issue #103, CA-13).
//
// `chiche-init --update` sobre un repo con `.sdd/` ofrece migrarlo a `.chiche/`
// con una secuencia de comandos canónica, escrita una sola vez en el bloque
// compartido `chiche-init-migrate` de los cinco harnesses. Este gate lee los
// cinco SKILL.md reales: exige el bloque idéntico byte a byte con un único
// fence `bash`, la doctrina alrededor (opciones, regla de `--autonomy` ≥ A2, fusión,
// contrato en `.chiche/project.md`, marker v2 en la Fase 4) y el literal de la
// tool de preguntas fuera del bloque. Además EJECUTA la secuencia con `bash` en
// repos git temporales: un repo completo, la fusión con un `.chiche/` previo,
// un repo sin `<git-common-dir>/sdd/`, un worktree enlazado y un common-dir no
// escribible. Es solo-tests (sin index.ts): el gate del package censa
// exactamente 11 factories. Que un agente haga la pregunta y siga la doctrina
// en una sesión real es prueba humana (CA-20).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { parseSddArtifact, type ParseResult } from "../chiche-artifacts/index.ts";
import { readSddEvents, serializeSddEvent, type SddEvent } from "../chiche-artifacts/sdd-events.ts";
import type { Harness } from "../harness-gate/interaction.ts";
import {
	HARNESSES,
	escapeRegExp,
	fencedBlocks,
	firstDifference,
	normalizeInvocations,
	parseInteractionTable,
} from "../harness-gate/interaction.ts";

const BLOCK = "chiche-init-migrate";

const HARNESS_LABELS: Record<Harness, string> = {
	claude: "Claude Code",
	codex: "Codex",
	opencode: "opencode",
	pi: "Pi",
	antigravity: "Google Antigravity",
};

const QUESTION = "¿Migro el contrato y los artefactos a .chiche/?";
const OPTION_MIGRATE = "`Migrar a .chiche/ (Recomendado)`";
const OPTION_KEEP = "`Mantener .sdd/`";
const PROJECT_TEMPLATE = "<!-- Chiche-Tracking: version=2; type=project; generated-at=<YYYY-MM-DD> -->";
const MARKER_UPDATE_RULE =
	"El marker de un artefacto existente es `SDD-Tracking: version=1` o `Chiche-Tracking: version=2`: al reescribirlo se reemplaza en su lugar por `Chiche-Tracking: version=2` conservando los demás campos, y nunca se agrega otro al lado.";
const REPORT_LINE =
	"- migracion: <.sdd/ → .chiche/ (<N> artefactos; <git-common-dir>/sdd/ movido|conservado: <motivo>; con cambios previos: <lista|ninguno>; escritos fuera del commit sugerido: <lista|ninguno>; sin trackear o ignorado en .chiche/: <lista|ninguno>) | mantenida .sdd/ | mejora disponible (--autonomy ≥ A2) | no aplica>";
const CHECKLIST_ROW =
	'| Directorio .chiche/ | existe .sdd/project.md, trackeado o no — no entra al menú: lo ofrece la pregunta propia de "## Migración a .chiche/", antes que todo lo demás |';
const MIGRATION_HEADING = "Migración a .chiche/ (corridas sobre un repo con .sdd/)";

function repoPath(path: string): string {
	return new URL(`../../${path}`, import.meta.url).pathname;
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoPath(path), "utf8");
}

function delimitedBlock(markdown: string, name: string): string | null {
	const block = markdown.match(new RegExp(`<!-- ${escapeRegExp(name)}:start -->\\n([\\s\\S]*?)\\n<!-- ${escapeRegExp(name)}:end -->`));
	return block ? (block[1] ?? "") : null;
}

function withoutBlock(markdown: string, name: string): string {
	return markdown.replace(new RegExp(`<!-- ${escapeRegExp(name)}:start -->\\n[\\s\\S]*?\\n<!-- ${escapeRegExp(name)}:end -->`), "");
}

// Sección que abre el primer heading `##` que cumple `heading` y termina en el
// siguiente `##`. Ignora los headings dentro de fences, que son templates.
function section(markdown: string, heading: RegExp): string {
	const lines = markdown.split("\n");
	let fence = false;
	let start = -1;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^\s*(```|~~~)/.test(line)) fence = !fence;
		if (fence) continue;
		const match = /^## (.*)$/.exec(line);
		if (!match) continue;
		if (start === -1) {
			if (heading.test(match[1] ?? "")) start = index;
			continue;
		}
		return lines.slice(start, index).join("\n");
	}
	return start === -1 ? "" : lines.slice(start).join("\n");
}

function headings(markdown: string): string[] {
	const result: string[] = [];
	let fence = false;
	for (const line of markdown.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) fence = !fence;
		if (fence) continue;
		const match = /^## (.*)$/.exec(line);
		if (match) result.push(match[1] ?? "");
	}
	return result;
}

async function skillFile(harness: Harness): Promise<string> {
	return readRepoFile(`${harness}/chiche-init/SKILL.md`);
}

async function migrateBlocks(): Promise<{ blocks: Map<string, string>; problems: string[] }> {
	const blocks = new Map<string, string>();
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/chiche-init/SKILL.md`;
		const block = delimitedBlock(await skillFile(harness), BLOCK);
		if (block === null) {
			problems.push(`${path}: falta el bloque <!-- ${BLOCK}:start/end -->`);
			continue;
		}
		blocks.set(path, block);
	}
	return { blocks, problems };
}

async function referenceBlock(): Promise<string> {
	const block = delimitedBlock(await skillFile("claude"), BLOCK);
	assert.ok(block, `claude/chiche-init trae el bloque ${BLOCK}`);
	return block;
}

async function canonicalSequence(): Promise<string> {
	const fences = fencedBlocks(await referenceBlock());
	assert.equal(fences.length, 1, "el bloque trae exactamente un fence: la secuencia canónica");
	return fences[0]?.content ?? "";
}

function missing(text: string, patterns: RegExp[]): string[] {
	return patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `falta ${pattern}`);
}

// ---------------------------------------------------------------------------
// Bloque compartido

test("CA-13: el bloque chiche-init-migrate está en los cinco chiche-init y es idéntico byte a byte", async () => {
	const { blocks, problems } = await migrateBlocks();
	const reference = blocks.get("claude/chiche-init/SKILL.md") ?? "";
	for (const [path, block] of blocks) {
		if (block !== reference) problems.push(`claude/chiche-init vs ${path}: ${firstDifference(reference, block)}`);
	}
	assert.deepEqual(problems, []);
	assert.equal(blocks.size, 5);
});

test("CA-13: el bloque trae un único fence y es bash", async () => {
	const { blocks, problems } = await migrateBlocks();
	assert.equal(blocks.size + problems.length, 5);
	for (const [path, block] of blocks) {
		const fenceLines = block.split("\n").filter((line) => /^\s*(`{3,}|~{3,})/.test(line));
		if (fenceLines.length !== 2) problems.push(`${path}: ${fenceLines.length} líneas de fence (se esperan 2: abre y cierra)`);
		else if (fenceLines[0] !== "```bash") problems.push(`${path}: el fence abre con \`${fenceLines[0]}\`, se espera \`\`\`bash`);
		if (fencedBlocks(block).length !== 1) problems.push(`${path}: ${fencedBlocks(block).length} fences, se espera 1`);
	}
	assert.deepEqual(problems, []);
});

test("CA-13: el bloque nombra la pregunta, las dos opciones, la regla de --autonomy ≥ A2, Decisiones humanas, la nota sin .sdd/ y conservado", async () => {
	const block = await referenceBlock();
	assert.deepEqual(missing(block, [
		new RegExp(escapeRegExp(`"${QUESTION}"`)),
		new RegExp(`^1\\. ${escapeRegExp(OPTION_MIGRATE)} — `, "m"),
		new RegExp(`^2\\. ${escapeRegExp(OPTION_KEEP)} — no cambia nada\\.$`, "m"),
		// Review de #107-2 (4): «Cuándo» y la fila de la checklist dicen lo mismo: aplica con `.sdd/project.md`, trackeado o no.
		/\*\*Cuándo\.\*\* En toda corrida sobre un repo con `\.sdd\/project\.md` \(trackeado o no\): `--update` explícito, o el lanzador que detectó un contrato existente\. Es lo PRIMERO que hace la corrida, antes de re-explorar, de la checklist de "## Upgrade de contrato" y de escribir nada\. Sin `\.sdd\/project\.md`, esta sección no aplica\./,
		/`git mv \.sdd \.chiche`/,
		// Review de #107 (6) y (1a): la reescritura alcanza a lo que ESTA corrida movió y a los tres archivos de la raíz, `.gitignore` incluido.
		// Review de #107-2 (4): lo que `git mv` arrastró sin trackear (y no está ignorado) también se reescribe.
		/^- Reescribe a `\.chiche\/` toda referencia `\.sdd\/` dentro de lo que ESTA corrida movió a `\.chiche\/` \(también lo que `git mv` arrastró sin trackear y no está ignorado\) y la de `CLAUDE\.md`, `AGENTS\.md` \(`@\.sdd\/project\.md`, el bloque `sdd-contract`\) y `\.gitignore` \(`\.sdd\/evidence\/` pasa a `\.chiche\/evidence\/`: lo ignorado sigue ignorado\)\.$/m,
		// Review de #107-2 (6): solo el primer marker de cada archivo, el del preámbulo.
		/^- Reescribe el marker de cada artefacto a `Chiche-Tracking: version=2`, con los demás campos intactos \(contrato `docs\/chiche-tracking-v2\.md`\)\. Solo cambia el primero de cada archivo, el del preámbulo: un ejemplo de marker dentro de un fence del cuerpo queda como estaba\.$/m,
		/Mueve `<git-common-dir>\/sdd\/` a `<git-common-dir>\/chiche\/`, incluido `events\.jsonl`/,
		/## Decisiones humanas/,
		// Review de #107-2 (7): la nota nombra el common-dir solo si esa corrida lo movió; sin la sección, avisa.
		/^- Anota la migración, con fecha, en `## Decisiones humanas` de `\.chiche\/project\.md`, una sola vez: si la nota ya está, una nueva corrida de la secuencia no la repite\. Dice que `<git-common-dir>\/sdd\/` pasó a `<git-common-dir>\/chiche\/` solo si esa corrida lo movió\. Sin la sección `## Decisiones humanas`, la secuencia avisa `chiche-init: \.chiche\/project\.md sin seccion '## Decisiones humanas'; anota la migracion a mano` y sigue\.$/m,
		/Con `\.chiche\/` ya presente, la secuencia mueve lo que falta y conserva lo que ya está en `\.chiche\/`/,
		/La reescritura de una re-corrida alcanza solo a lo que esa corrida movió \(más `CLAUDE\.md`, `AGENTS\.md` y `\.gitignore`\): una mención histórica de `\.sdd\/` restaurada a mano en `\.chiche\/` no se vuelve a reescribir\./,
		/chiche-init: conservado <ruta>; queda <ruta vieja>/,
		/Si el harness no puede escribir en `<git-common-dir>\/chiche\/`, el paso del common-dir se saltea con el aviso/,
		/`Mantener \.sdd\/` no cambia nada: el contrato sigue en `\.sdd\/project\.md`, la corrida lo lee de ahí y la oferta se repite en el próximo `--update`/,
		/Con `--autonomy` ≥ A2 no se migra ni se pregunta: el reporte lo lista como `mejora disponible`/,
		/Tras migrar, el resto de la corrida lee y escribe `\.chiche\/project\.md`/,
		// El cierre `Commit + PR` copia solo paths escritos y no reproduce los renames de `git mv`: tras migrar queda sin commitear.
		/^- Si la corrida migró, el cierre `Commit \+ PR` queda en `Dejar sin commitear` con el motivo `migración: los renames viven en el checkout principal`: ese cierre copia solo los paths que la corrida escribió y no reproduce los renames de `git mv`\. /m,
		/El reporte nombra el commit sugerido para el humano: `git add -u -- \.chiche \$\(ls CLAUDE\.md AGENTS\.md \.gitignore 2>\/dev\/null\) && git commit -m "chore\(chiche-init\): migracion a \.chiche\/"` \(los `git mv` ya están en el índice; `git add -u` toma las reescrituras de `\.chiche\/\*\*`, `CLAUDE\.md`, `AGENTS\.md` y `\.gitignore`, también lo que el grupo \(a\) ya tenía cambiado en esos paths, y nunca agrega archivos sin trackear\)\.$/m,
		// Review de #107-2 (4): un `.sdd/` sin archivos trackeados no se migra; un link trackeado nunca se reescribe.
		/^- Si `\.sdd\/` no tiene ningún archivo trackeado \(`git ls-files -- \.sdd` vacío\), no se migra: la secuencia imprime `chiche-init: \.sdd\/ sin trackear; commitealo o movelo a mano, no se migra`, sale con 0 sin tocar nada y el reporte dice `mantenida \.sdd\/` con ese motivo\. Con al menos un archivo trackeado, `git mv` mueve el directorio entero y la reescritura alcanza también al contrato sin trackear que viaja con él\.$/m,
		/^- La reescritura saltea los symlinks: `CLAUDE\.md -> AGENTS\.md` queda como link y `AGENTS\.md` se reescribe por su propio nombre; un link trackeado bajo `\.chiche\/` que apunta fuera nunca toca su destino\.$/m,
	]), []);
	const script = await canonicalSequence();
	assert.equal(block.includes("--assume"), false, "el bloque no nombra un flag retirado (issue #102, CA-7)");
	assert.equal(block.includes("--autonomy"), true, "el bloque nombra el nivel que reemplaza al flag retirado");
	assert.equal(/git add -A|checkout limpio/.test(block), false, "el commit sugerido no suma todo ni supone un checkout limpio");
	assert.match(script, /for f in CLAUDE\.md AGENTS\.md \.gitignore; do/, "la secuencia reescribe también el .gitignore de la raíz");
	const bullet = block.split("\n").find((line) => line.startsWith("- Anota la migración")) ?? "";
	assert.ok(bullet, "el bloque trae la bullet que describe la nota");
	assert.equal(bullet.includes(".sdd/"), false, `la bullet de la nota no nombra .sdd/: ${bullet}`);
	const note = /awk -v line="([^"]*)"/.exec(script)?.[1] ?? "";
	assert.ok(note.includes(MIGRATION_NOTE), `la nota del awk dice «${MIGRATION_NOTE}»: ${note}`);
	assert.ok(note.includes("(antes .sdd)"), `la nota recuerda el nombre anterior sin barra: ${note}`);
	assert.equal(note.includes(".sdd/"), false, `la nota del awk no lleva .sdd/ (la reescritura de una nueva corrida no la cambia): ${note}`);
	assert.ok(script.includes(`grep -q '${MIGRATION_NOTE}' .chiche/project.md`), "el awk va guardado por un grep de la misma frase");
});

// Review de #107-2 (1): el reporte separa lo que ya estaba sucio, lo que escribió la corrida (con el `git add -- <ruta>` de lo que el
// comando no toma) y lo que `git mv` arrastró; nada del bloque dice que `git mv` arrastra un `.chiche/coding-policies.md` nuevo.
test("review #107-2 (1): la doctrina del reporte separa tres grupos con el snapshot de commit-pr-close y nombra el git add de lo que escribió un encadenado", async () => {
	const block = await referenceBlock();
	const bullet = block.split("\n").find((line) => line.startsWith("- El reporte de la migración separa tres grupos")) ?? "";
	assert.ok(bullet, "el bloque trae la bullet de los tres grupos");
	assert.deepEqual(missing(bullet, [
		/con el `git status --porcelain=v1 -z` que `commit-pr-close` ya tomó antes de la primera escritura:/,
		/\(a\) los paths que ya tenían cambios antes de migrar, que el humano saca del commit con `git restore --staged -- <ruta>` o commitea aparte;/,
		/\(b\) lo que escribió esta corrida: los artefactos reescritos, los imports, `\.gitignore` y lo que crearon `coding-policies` o `design-system` encadenados \(`\.chiche\/coding-policies\.md`, `DESIGN_SYSTEM\.md`\), que el commit sugerido no toma y el reporte nombra con `git add -- <ruta>`;/,
		/\(c\) lo que `git mv` arrastró a `\.chiche\/` sin trackear \(`git ls-files --others --exclude-standard \.chiche`\) o ignorado \(`git ls-files --others -i --exclude-standard \.chiche`\), que el commit sugerido tampoco toma y decide el humano\.$/,
	]), []);
	assert.equal(/arrastró[^.;]*coding-policies/.test(block), false, "`git mv` no arrastra el coding-policies.md que crea un encadenado");
	const report = section(await skillFile("claude"), /^Reporte$/);
	assert.ok(report.includes("con cambios previos: <lista|ninguno>; escritos fuera del commit sugerido: <lista|ninguno>; sin trackear o ignorado en .chiche/: <lista|ninguno>"), "la línea del reporte lleva los tres grupos");
});

test("CA-13: el bloque no nombra ninguna tool de preguntas, literal de harness ni invocación de skill", async () => {
	const problems: string[] = [];
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const block = await referenceBlock();
	if (/AskUserQuestion|request_user_input|ask_user_question|ask_question|`question`/.test(block)) problems.push("el bloque nombra una tool de preguntas");
	if (/`(?:claude|codex|opencode|pi|antigravity)`|\b(?:Claude Code|Codex|OpenCode|opencode|Antigravity)\b|\bPi\b/.test(block)) problems.push("el bloque nombra un harness");
	for (const harness of HARNESSES) {
		if (normalizeInvocations(block, prefixes[harness]) !== block) problems.push(`el bloque invoca un skill con el prefijo de ${harness}`);
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// Ubicación y literal del harness

test("CA-13: la sección va entre «Upgrade de contrato» y la Fase 4, con el literal de la tool de preguntas en una línea fuera del bloque", async () => {
	const { questionTools } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const linePattern = /^En (Claude Code|Codex|opencode|Pi|Google Antigravity), la pregunta de esta sección usa `([A-Za-z_]+)`\.$/gm;
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/chiche-init/SKILL.md`;
		const markdown = await skillFile(harness);
		const order = headings(markdown);
		const upgrade = order.findIndex((heading) => /^Upgrade de contrato\b/.test(heading));
		if (upgrade === -1) problems.push(`${path}: falta «## Upgrade de contrato»`);
		else {
			if (order[upgrade + 1] !== MIGRATION_HEADING) problems.push(`${path}: después de «Upgrade de contrato» viene «${order[upgrade + 1]}», se espera «${MIGRATION_HEADING}»`);
			if (!/^Fase 4\b/.test(order[upgrade + 2] ?? "")) problems.push(`${path}: después de la migración viene «${order[upgrade + 2]}», se espera la Fase 4`);
		}
		const migration = section(markdown, /^Migración a \.chiche\//);
		const outside = withoutBlock(migration, BLOCK);
		const lines = [...outside.matchAll(linePattern)];
		if (lines.length !== 1) {
			problems.push(`${path}: ${lines.length} líneas de la tool de preguntas (se espera 1)`);
		} else {
			const [, label, tool] = lines[0] ?? [];
			if (label !== HARNESS_LABELS[harness] || tool !== questionTools[harness]) {
				problems.push(`${path}: la línea dice ${label}/${tool}, se espera ${HARNESS_LABELS[harness]}/${questionTools[harness]}`);
			}
		}
		if (harness === "codex") {
			if (!/^En Codex, el sandbox por defecto deja `\.git\/` en solo lectura y `git mv` escribe `\.git\/index`: la secuencia entera pide escalación desde el primer intento; sin permiso no se migra nada, el contrato sigue en `\.sdd\/project\.md` y el reporte dice `mantenida \.sdd\/ \(sin permiso para escribir \.git\/\)` \(ver `docs\/harness-interaction-differences\.md`\)\.$/m.test(outside)) {
				problems.push(`${path}: falta la escalación de toda la secuencia fuera del bloque`);
			}
			if (/paso del common-dir[^\n]*la migración del árbol sigue/.test(outside)) problems.push(`${path}: dice que sin permiso la migración del árbol sigue, y git mv ya falla en el primer paso`);
		} else if (/escalación/.test(outside)) {
			problems.push(`${path}: la escalación del common-dir es solo de Codex`);
		}
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// El contrato vive en .chiche/project.md

test("CA-13: los cinco chiche-init nombran .chiche/project.md como contrato y .sdd/project.md solo como fallback y migración", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/chiche-init/SKILL.md`;
		const markdown = await skillFile(harness);
		const description = markdown.match(/^description: (.*)$/m)?.[1] ?? "";
		if (!description.includes(".chiche/project.md") || description.includes(".sdd/")) problems.push(`${path}: la description debe nombrar .chiche/project.md y no .sdd/`);

		const contract = section(markdown, /^Qu[eé] es el contrato de autonomía$/);
		if (!contract.includes("`.chiche/project.md` responde")) problems.push(`${path}: «Qué es el contrato» no abre con .chiche/project.md`);
		if (contract.split(".sdd/project.md").length - 1 !== 1) problems.push(`${path}: «Qué es el contrato» debe nombrar .sdd/project.md una sola vez (el fallback)`);
		if (!/Un repo inicializado antes del renombre guarda el contrato en `\.sdd\/project\.md` y las coding policies en `\.sdd\/coding-policies\.md`: este skill los lee de ahí \(abajo, `\.chiche\/` es la ruta en uso\) y `--update` ofrece la migración \(`## Migración a \.chiche\/`\)\./.test(contract)) {
			problems.push(`${path}: falta la frase de fallback a .sdd/project.md con la oferta de migración`);
		}

		for (const [name, pattern] of [
			["Argumentos", /^Argumentos$/],
			["Fase 0", /^Fase 0\b/],
			["Fase 3.5", /^Fase 3\.5\b/],
			["Fase 4", /^Fase 4\b/],
			["Reporte", /^Reporte$/],
			["MUST DO", /^MUST DO$/],
			["MUST NOT DO", /^MUST NOT DO$/],
		] as const) {
			// Issue #102 CA-4: el bloque `autonomy-resolve` de ## Argumentos lee el contrato con fallback a .sdd/project.md (lo gatea autonomy-gate).
			const body = withoutBlock(section(markdown, pattern), "autonomy-resolve");
			if (body === "") problems.push(`${path}: falta la sección ${name}`);
			else if (body.includes(".sdd/project.md") || body.includes(".sdd/coding-policies.md")) problems.push(`${path}: ${name} todavía nombra .sdd/`);
		}
		for (const [name, pattern, needle] of [
			["Fase 0", /^Fase 0\b/, "Si `.chiche/project.md` ya existe"],
			["Fase 3.5", /^Fase 3\.5\b/, "si existe `.chiche/coding-policies.md`"],
			["Fase 4", /^Fase 4\b/, "Escribir `.chiche/project.md` con EXACTAMENTE esta estructura"],
			["Reporte", /^Reporte$/, "Contrato de autonomia listo: .chiche/project.md"],
			["MUST NOT DO", /^MUST NOT DO$/, "No pisar un `.chiche/project.md` editado a mano sin preservar `## Decisiones humanas`."],
		] as const) {
			if (!section(markdown, pattern).includes(needle)) problems.push(`${path}: ${name} no dice «${needle}»`);
		}
		if (!section(markdown, /^Fase 0\b/).includes("genera .chiche/project.md: el contrato de autonomia")) problems.push(`${path}: el menú de la Fase 0 no dice «genera .chiche/project.md»`);
	}
	assert.deepEqual(problems, []);
});

test("CA-13: la Fase 4 emite Chiche-Tracking v2 type=project con la regla del marker existente y la excepción del contrato", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/chiche-init/SKILL.md`;
		const phase = section(await skillFile(harness), /^Fase 4\b/);
		const template = phase.split("\n").filter((line) => line === PROJECT_TEMPLATE);
		if (template.length !== 1) problems.push(`${path}: ${template.length} líneas «${PROJECT_TEMPLATE}» en la Fase 4 (se espera 1)`);
		if (/SDD-Tracking: version=1; type=project/.test(phase)) problems.push(`${path}: la Fase 4 todavía instruye el template SDD-Tracking v1`);
		for (const pattern of [
			/La línea `Chiche-Tracking` es el marker canónico de tracking \(contrato `docs\/chiche-tracking-v2\.md`\)/,
			/exactamente un marker por contrato/,
			new RegExp(escapeRegExp(MARKER_UPDATE_RULE)),
		]) {
			if (!pattern.test(phase)) problems.push(`${path}: la Fase 4 no dice ${pattern}`);
		}
		// Review de #107 (4): una reescritura migra v1 → v2 en su lugar; ya no hay «conservando su nombre y su versión» ni excepción aparte para el contrato.
		if (/conservando su nombre y su versión|Una excepción: el contrato se regenera/.test(phase)) problems.push(`${path}: la Fase 4 todavía conserva la versión del marker o trae la excepción del contrato`);
	}
	// El template de la Fase 4 instancia un marker canónico v2 de tipo project.
	const instance = PROJECT_TEMPLATE.replace("<YYYY-MM-DD>", "2026-11-02");
	const parsed = parseSddArtifact(`# Contrato\n${instance}\n`);
	assert.equal(parsed.kind, "metadata");
	if (parsed.kind === "metadata" && parsed.format === "canonical") {
		assert.equal(parsed.markerName, "Chiche-Tracking");
		assert.equal(parsed.version, 2);
		assert.equal(parsed.metadata.type, "project");
	} else {
		assert.fail(`el template no parsea como marker canónico: ${JSON.stringify(parsed)}`);
	}
	assert.deepEqual(problems, []);
});

test("CA-13: la checklist de upgrade, el reporte y la Fase 5 llevan la migración y la ruta del contrato en uso", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const path = `${harness}/chiche-init/SKILL.md`;
		const markdown = await skillFile(harness);
		const upgrade = section(markdown, /^Upgrade de contrato\b/);
		if (!upgrade.split("\n").includes(CHECKLIST_ROW)) problems.push(`${path}: falta la fila «Directorio .chiche/» de la checklist`);
		if (!/En TODA corrida sobre un `\.chiche\/project\.md` existente/.test(upgrade)) problems.push(`${path}: el Upgrade de contrato no habla de .chiche/project.md`);
		const report = section(markdown, /^Reporte$/);
		if (!report.split("\n").includes(REPORT_LINE)) problems.push(`${path}: el reporte no trae la línea «- migracion: …»`);
		const phase5 = section(markdown, /^Fase 5\b/);
		if (!phase5.includes(".chiche/project.md")) problems.push(`${path}: la Fase 5 no nombra .chiche/project.md`);
		if (!/En un repo que mantuvo `\.sdd\/` \(`Mantener \.sdd\/`\), la línea o el bloque nombra la ruta del contrato en uso \(`@\.sdd\/project\.md` \/ "leer `\.sdd\/project\.md`"\), y una referencia que ya apunta a la ruta en uso nunca se duplica\./.test(phase5)) {
			problems.push(`${path}: la Fase 5 no nombra la ruta en uso de un repo que mantuvo .sdd/`);
		}
		if (/<!-- sdd-contract -->/.test(markdown) && !/<!-- sdd-contract -->\n\s*Antes de planificar o modificar este proyecto, leer `\.chiche\/project\.md` y respetar/.test(phase5)) {
			problems.push(`${path}: el bloque sdd-contract de la Fase 5 no manda a leer .chiche/project.md`);
		}
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// La secuencia canónica, ejecutada con bash

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-c", "user.name=chiche", "-c", "user.email=chiche@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

function cleanEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
	return env;
}

function runSequence(script: string, cwd: string, env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync("bash", ["-c", script], { cwd, encoding: "utf8", env: { ...cleanEnv(), ...env } });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeTree(root: string, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
}

function scratch(t: { after: (fn: () => void) => void }, name: string): string {
	const base = realpathSync(mkdtempSync(join(tmpdir(), `chiche-migrate-gate-${name}-`)));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	return base;
}

function initRepo(base: string, files: Record<string, string>): string {
	const repo = join(base, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	writeTree(repo, files);
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "fixture");
	return repo;
}

function porcelain(cwd: string): string[] {
	return git(cwd, "status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean);
}

function markdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	return (readdirSync(root, { recursive: true }) as string[]).filter((path) => path.endsWith(".md")).sort();
}

function allFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	return (readdirSync(root, { recursive: true, withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
		.sort();
}

function canonical(parsed: ParseResult) {
	assert.equal(parsed.kind, "metadata", `parsea como metadata: ${JSON.stringify(parsed)}`);
	assert.ok(parsed.kind === "metadata" && parsed.format === "canonical", "el marker es canónico");
	return parsed as Extract<ParseResult, { kind: "metadata"; format: "canonical" }>;
}

const MIGRATION_NOTE = "migracion a .chiche/ con chiche-init --update";

function utcToday(): string {
	return new Date().toISOString().slice(0, 10);
}

// La línea que la secuencia agrega bajo `## Decisiones humanas`. Review de #107-2 (7): nombra el paso del common-dir solo si esa corrida lo hizo.
const NOTE_MARKERS_CLAUSE = "los artefactos llevan Chiche-Tracking: version=2";
const NOTE_COMMON_CLAUSE = " y <git-common-dir>/sdd/ paso a <git-common-dir>/chiche/";

function migrationNote(repo: string): string {
	const lines = readFileSync(join(repo, ".chiche/project.md"), "utf8").split("\n");
	const heading = lines.indexOf("## Decisiones humanas");
	assert.ok(heading >= 0, "el contrato tiene ## Decisiones humanas");
	return lines[heading + 1] ?? "";
}

function assertShortNote(repo: string, why: string): void {
	const note = migrationNote(repo);
	assert.ok(note.includes(MIGRATION_NOTE), `${why}: la línea dice «${MIGRATION_NOTE}»: ${note}`);
	assert.ok(note.endsWith(`${NOTE_MARKERS_CLAUSE}.`), `${why}: la nota termina después de la cláusula de los markers: ${note}`);
	assert.equal(note.includes("<git-common-dir>"), false, `${why}: la nota no dice que el common-dir migró: ${note}`);
}

const CONTRACT_V1 = [
	"# Contrato de autonomia — fixture",
	"<!-- Generado por /chiche-init el 2026-08-15. Refrescar con /chiche-init --update. -->",
	"<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-15 -->",
	"",
	"## Stack",
	"Repo de prueba. La spec vive en `.sdd/specs/a.md`.",
	"",
	"## Decisiones humanas",
	"- 2026-08-15: solo local.",
	"",
	"## Gaps",
	"Ninguno.",
	"",
].join("\n");

const SPEC_A = [
	"# Spec — A",
	"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=owner/repo#9; grill=session%209; superseded-by=none -->",
	"",
	"## Contexto",
	"Spec A. Contrato en `.sdd/project.md`.",
	"",
].join("\n");

const SPEC_B = [
	"# Spec — B",
	"<!-- SDD-Tracking: version=1; type=spec; state=superseded; issue=#9; grill=none; superseded-by=.sdd%2Fspecs%2Fa.md -->",
	"",
	"## Contexto",
	"Spec B, reemplazada por `.sdd/specs/a.md`. Ver el contrato en `.sdd/project.md`.",
	"",
].join("\n");

const GRILL_X = [
	"# Grill — x",
	"<!-- Estado: finalized. Proyecto: /workspace/project. Fuente: #9. -->",
	"<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=#9; grill=session-9; project=%2Fworkspace%2Fproject -->",
	"",
	"## Hechos comprobados",
	"- El contrato está en `.sdd/project.md`.",
	"",
].join("\n");

const AGENTS_BLOCK = [
	"# Agentes",
	"",
	"<!-- sdd-contract -->",
	"Antes de planificar o modificar este proyecto, leer `.sdd/project.md` y respetar sus comandos, verificacion autonoma y limites.",
	"",
].join("\n");

const FULL_TREE: Record<string, string> = {
	".sdd/project.md": CONTRACT_V1,
	".sdd/specs/a.md": SPEC_A,
	".sdd/specs/b.md": SPEC_B,
	".sdd/grills/2026-01-01-x.md": GRILL_X,
	"CLAUDE.md": "@.sdd/project.md\n",
	"AGENTS.md": AGENTS_BLOCK,
};

// Review de #107 (1): un repo con `.gitignore` anclado a `.sdd/`.
const GITIGNORE = "node_modules/\n.sdd/evidence/\n";
const TREE_WITH_GITIGNORE: Record<string, string> = { ...FULL_TREE, ".gitignore": GITIGNORE };

function eventLine(overrides: Partial<SddEvent>): string {
	const event: SddEvent = {
		v: 1,
		ts: "2026-10-01T10:00:00Z",
		harness: "claude",
		event: "run.started",
		issue: "#9",
		spec: "#9",
		previous: null,
		grill: null,
		pr: [],
		reason: null,
		...overrides,
	};
	const serialized = serializeSddEvent(event);
	assert.ok(serialized.ok, JSON.stringify(serialized));
	return serialized.line;
}

test("CA-13: la secuencia migra .sdd/ a .chiche/ en un repo completo y deja git status solo con renames, los tres archivos de la raíz y lo que arrastró sin trackear", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "full");
	const repo = initRepo(base, TREE_WITH_GITIGNORE);
	const common = join(repo, ".git");
	// Review de #107 (1): `git mv` arrastra lo ignorado y lo sin trackear de `.sdd/`.
	writeTree(repo, { ".sdd/evidence/local.log": "evidencia local ignorada\n", ".sdd/grills/2026-01-03-draft.md": "# Grill — draft\nborrador sin trackear\n" });
	assert.equal(git(repo, "check-ignore", ".sdd/evidence/local.log").trim(), ".sdd/evidence/local.log", "el fixture ignora la evidencia local");
	const sddLines = [eventLine({ ts: "2026-10-01T10:00:00Z" }), eventLine({ ts: "2026-10-02T10:00:00Z", event: "run.committed" })];
	const chicheLine = eventLine({ ts: "2026-10-30T10:00:00Z", harness: "codex", event: "land.merged", pr: [101] });
	writeTree(common, {
		"sdd/events.jsonl": `${sddLines.join("\n")}\n`,
		"sdd/grills/2026-01-02-y.md": "# Grill — y\nborrador del common-dir\n",
		"chiche/events.jsonl": `${chicheLine}\n`,
	});
	const tracked = markdownFiles(join(repo, ".sdd")).filter((path) => path !== "grills/2026-01-03-draft.md");
	const before = new Map(tracked.map((path) => [path, canonical(parseSddArtifact(readFileSync(join(repo, ".sdd", path), "utf8")))]));
	assert.equal(before.size, 4, "el fixture trae contrato, dos specs y un grill trackeados");
	for (const parsed of before.values()) assert.equal(parsed.markerName, "SDD-Tracking");

	const tmp = join(base, "tmp");
	mkdirSync(tmp);
	const first = utcToday();
	const run = runSequence(script, repo, { TMPDIR: tmp });
	const last = utcToday();
	assert.equal(run.status, 0, run.stderr);
	assert.deepEqual(readdirSync(tmp), [], "la lista temporal de la secuencia se borra al terminar");
	assert.equal(run.stderr, "", "sin avisos en stderr");
	assert.equal(run.stdout, "", "sin archivos repetidos, la secuencia no imprime nada");

	assert.equal(existsSync(join(repo, ".sdd")), false, ".sdd/ desapareció");
	assert.deepEqual(markdownFiles(join(repo, ".chiche")), [...before.keys(), "grills/2026-01-03-draft.md"].sort(), "los cuatro archivos trackeados y el borrador que git mv arrastró");
	assert.equal(readFileSync(join(repo, ".chiche/grills/2026-01-03-draft.md"), "utf8"), "# Grill — draft\nborrador sin trackear\n", "lo que no está trackeado viaja sin reescribir");
	for (const [path, previous] of before) {
		const text = readFileSync(join(repo, ".chiche", path), "utf8");
		const parsed = canonical(parseSddArtifact(text));
		assert.equal(parsed.markerName, "Chiche-Tracking", `${path}: marker Chiche-Tracking`);
		assert.equal(parsed.version, 2, `${path}: version 2`);
		assert.deepEqual(parsed.metadata, previous.metadata, `${path}: los demás campos quedan intactos`);
		assert.equal(text.split("\n").filter((line) => /<!--\s*(?:SDD|Chiche)-Tracking\s*:/.test(line)).length, 1, `${path}: exactamente un marker`);
		assert.equal(text.includes(".sdd/"), false, `${path}: sin referencias a .sdd/`);
	}
	// Las referencias en prosa se reescriben; la referencia codificada de superseded-by sigue siendo la misma.
	assert.match(readFileSync(join(repo, ".chiche/specs/b.md"), "utf8"), /Ver el contrato en `\.chiche\/project\.md`/);
	assert.match(readFileSync(join(repo, ".chiche/specs/b.md"), "utf8"), /superseded-by=\.sdd%2Fspecs%2Fa\.md -->/);

	assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), "@.chiche/project.md\n");
	const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
	assert.match(agents, /<!-- sdd-contract -->\nAntes de planificar o modificar este proyecto, leer `\.chiche\/project\.md` y respetar/);
	assert.equal(agents.includes(".sdd/"), false, "AGENTS.md sin .sdd/");

	assert.equal(readFileSync(join(common, "chiche", "events.jsonl"), "utf8"), `${sddLines.join("\n")}\n${chicheLine}\n`, "events.jsonl: las líneas de sdd/ primero y la de chiche/ después");
	assert.deepEqual((await readSddEvents(repo)).map((event) => event.ts), ["2026-10-01T10:00:00Z", "2026-10-02T10:00:00Z", "2026-10-30T10:00:00Z"]);
	assert.equal(existsSync(join(common, "sdd")), false, "<git-common-dir>/sdd/ desapareció");
	assert.equal(readFileSync(join(common, "chiche", "grills", "2026-01-02-y.md"), "utf8"), "# Grill — y\nborrador del common-dir\n");
	assert.deepEqual(allFiles(join(repo)).filter((path) => path.endsWith(".chiche-migrate")), [], "sin temporales");

	const status = porcelain(repo);
	const renames = status.filter((line) => /^R[M ] \.sdd\/\S+ -> \.chiche\/\S+$/.test(line));
	assert.equal(renames.length, 4, `cuatro renames: ${status.join(" | ")}`);
	assert.deepEqual(
		status.filter((line) => !renames.includes(line)).sort(),
		[" M .gitignore", " M AGENTS.md", " M CLAUDE.md", "?? .chiche/grills/2026-01-03-draft.md"],
		"nada más que los tres archivos de la raíz y el borrador que git mv arrastró sin trackear; la evidencia ignorada no aparece",
	);
	// Review de #107 (1a): el patrón anclado a `.sdd/` del .gitignore se reescribe y lo ignorado sigue ignorado bajo `.chiche/`.
	assert.equal(readFileSync(join(repo, ".gitignore"), "utf8"), "node_modules/\n.chiche/evidence/\n");
	assert.equal(git(repo, "check-ignore", ".chiche/evidence/local.log").trim(), ".chiche/evidence/local.log", "la evidencia local sigue ignorada");
	// Review de #107 (1c): los dos comandos del reporte listan lo que git mv arrastró.
	assert.equal(git(repo, "ls-files", "--others", ".chiche"), ".chiche/evidence/local.log\n.chiche/grills/2026-01-03-draft.md\n", "lo sin trackear, con lo ignorado adentro");
	assert.equal(git(repo, "ls-files", "--others", "-i", "--exclude-standard", ".chiche"), ".chiche/evidence/local.log\n");

	const decisions = readFileSync(join(repo, ".chiche/project.md"), "utf8").split("\n");
	const heading = decisions.indexOf("## Decisiones humanas");
	assert.ok(heading >= 0);
	const note = decisions[heading + 1] ?? "";
	assert.ok([first, last].some((day) => note.startsWith(`- ${day}: `)), `la línea abre con la fecha UTC de hoy: ${note}`);
	assert.ok(note.includes(MIGRATION_NOTE), `la línea dice «${MIGRATION_NOTE}»: ${note}`);
	assert.ok(note.endsWith(`${NOTE_MARKERS_CLAUSE}${NOTE_COMMON_CLAUSE}.`), `el common-dir migró: la nota lo dice: ${note}`);
	assert.equal(decisions[heading + 2], "- 2026-08-15: solo local.", "las decisiones previas se conservan");
});

test("CA-13: con .chiche/ ya presente la secuencia mueve lo que falta, conserva lo que ya está y lo avisa", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "merge");
	const chicheContract = CONTRACT_V1
		.replace("<!-- SDD-Tracking: version=1;", "<!-- Chiche-Tracking: version=2;")
		.replace("Repo de prueba.", "Contrato que ya vivía en chiche.");
	const sddContract = CONTRACT_V1.replace("Repo de prueba.", "Contrato viejo de sdd.");
	const repo = initRepo(base, {
		".chiche/project.md": chicheContract,
		".sdd/project.md": sddContract,
		".sdd/specs/c.md": SPEC_A.replace("Spec A.", "Spec C."),
	});

	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /conservado \.chiche\/project\.md/);
	assert.equal(run.stdout, "chiche-init: conservado .chiche/project.md; queda .sdd/project.md\n");

	const kept = readFileSync(join(repo, ".chiche/project.md"), "utf8");
	assert.match(kept, /Contrato que ya vivía en chiche\./);
	assert.doesNotMatch(kept, /Contrato viejo de sdd\./);
	assert.ok(kept.includes(MIGRATION_NOTE), "la nota de la migración va al contrato que quedó");
	assert.equal(readFileSync(join(repo, ".sdd/project.md"), "utf8"), sddContract, "el duplicado de .sdd/ queda como estaba");
	assert.equal(existsSync(join(repo, ".sdd/specs")), false, "la carpeta vacía de .sdd/ se limpia");
	const moved = canonical(parseSddArtifact(readFileSync(join(repo, ".chiche/specs/c.md"), "utf8")));
	assert.equal(moved.markerName, "Chiche-Tracking");
	assert.equal(moved.version, 2);
	assert.match(readFileSync(join(repo, ".chiche/specs/c.md"), "utf8"), /Spec C\. Contrato en `\.chiche\/project\.md`\./);

	const status = porcelain(repo);
	assert.deepEqual(status.filter((line) => !/^R[M ] \.sdd\/specs\/c\.md -> \.chiche\/specs\/c\.md$/.test(line)), [" M .chiche/project.md"]);
});

test("CA-13: sin <git-common-dir>/sdd/ la secuencia migra el árbol, sale con 0 y no crea nada en el common-dir", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "nocommon");
	const repo = initRepo(base, FULL_TREE);
	const common = join(repo, ".git");
	assert.equal(existsSync(join(common, "sdd")), false);

	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stderr, "");
	assert.equal(run.stdout, "");
	assert.equal(existsSync(join(repo, ".sdd")), false);
	assert.deepEqual(markdownFiles(join(repo, ".chiche")), ["grills/2026-01-01-x.md", "project.md", "specs/a.md", "specs/b.md"]);
	assert.equal(existsSync(join(common, "chiche")), false, "no se crea chiche/ en el common-dir");
	assert.equal(existsSync(join(common, "sdd")), false);
	assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), "@.chiche/project.md\n");
	assert.equal(porcelain(repo).filter((line) => /^\?\?/.test(line)).length, 0, "nada untracked");
	assertShortNote(repo, "sin <git-common-dir>/sdd/");
});

test("CA-13: sin CLAUDE.md ni AGENTS.md la secuencia no los crea", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "noimports");
	const repo = initRepo(base, { ".sdd/project.md": CONTRACT_V1, ".sdd/specs/a.md": SPEC_A });
	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(existsSync(join(repo, "CLAUDE.md")), false);
	assert.equal(existsSync(join(repo, "AGENTS.md")), false);
	assert.equal(porcelain(repo).filter((line) => !/^R[M ] \.sdd\/\S+ -> \.chiche\/\S+$/.test(line)).length, 0);
});

test("CA-13: desde un worktree enlazado el log de eventos viaja al .git/chiche/ del repo principal", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "linked");
	const main = initRepo(base, FULL_TREE);
	const common = join(main, ".git");
	const linked = join(base, "repo-wt");
	git(main, "worktree", "add", "-q", "-b", "feature", linked);
	const lines = [eventLine({ ts: "2026-10-01T10:00:00Z" }), eventLine({ ts: "2026-10-02T10:00:00Z", event: "run.committed" })];
	writeTree(common, { "sdd/events.jsonl": `${lines.join("\n")}\n`, "sdd/grills/2026-01-02-y.md": "# Grill — y\n" });

	const run = runSequence(script, linked);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stderr, "");
	assert.equal(readFileSync(join(common, "chiche", "events.jsonl"), "utf8"), `${lines.join("\n")}\n`, "el log aterriza en el .git/chiche/ del repo principal");
	assert.equal(existsSync(join(common, "sdd")), false);
	assert.equal(existsSync(join(common, "worktrees", "repo-wt", "chiche")), false, "nada en el gitdir del worktree");
	assert.equal(existsSync(join(linked, ".sdd")), false, "el worktree migró su árbol");
	assert.equal(readFileSync(join(linked, "CLAUDE.md"), "utf8"), "@.chiche/project.md\n");
	assert.equal(existsSync(join(main, ".sdd/project.md")), true, "el checkout principal no se toca");
	assert.deepEqual(porcelain(main), [], "checkout principal limpio");
});

test("CA-13: con el common-dir no escribible la secuencia avisa, migra el árbol y deja <git-common-dir>/sdd/ como está", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "blocked");
	const repo = initRepo(base, FULL_TREE);
	const common = join(repo, ".git");
	const events = `${eventLine({})}\n`;
	writeTree(common, { "sdd/events.jsonl": events, chiche: "un archivo donde debería haber un directorio" });

	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stdout, `chiche-init: no se pudo escribir en ${common}/chiche; ${common}/sdd queda como está\n`);
	assert.equal(readFileSync(join(common, "sdd", "events.jsonl"), "utf8"), events, "el log viejo no se pierde");
	assert.equal(existsSync(join(repo, ".sdd")), false, "el árbol migró igual");
	assert.ok(readFileSync(join(repo, ".chiche/project.md"), "utf8").includes(MIGRATION_NOTE));
	assertShortNote(repo, "common-dir no escribible");
});

test("CA-13: un .sdd/ sin project.md migra igual y sale con 0 sin inventar el contrato", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "nocontract");
	const repo = initRepo(base, { ".sdd/specs/a.md": SPEC_A, "CLAUDE.md": "# Proyecto\n" });
	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(existsSync(join(repo, ".sdd")), false);
	assert.equal(existsSync(join(repo, ".chiche/project.md")), false, "no se crea un contrato vacío");
	assert.equal(canonical(parseSddArtifact(readFileSync(join(repo, ".chiche/specs/a.md"), "utf8"))).markerName, "Chiche-Tracking");
	assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), "# Proyecto\n", "un CLAUDE.md sin referencias no se toca");
	assert.deepEqual(porcelain(repo), ["RM .sdd/specs/a.md -> .chiche/specs/a.md"]);
});

test("CA-13: un adjunto binario bajo .sdd/ viaja intacto y no entra a la reescritura", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "binary");
	const repo = join(base, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	writeTree(repo, FULL_TREE);
	const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x2e, 0x73, 0x64, 0x64, 0x2f, 0x00]);
	mkdirSync(join(repo, ".sdd/grills/2026-01-01-x"), { recursive: true });
	writeFileSync(join(repo, ".sdd/grills/2026-01-01-x/captura.png"), png);
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "fixture");

	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.deepEqual(readFileSync(join(repo, ".chiche/grills/2026-01-01-x/captura.png")), png, "los bytes del adjunto no cambian");
	assert.ok(porcelain(repo).includes("R  .sdd/grills/2026-01-01-x/captura.png -> .chiche/grills/2026-01-01-x/captura.png"), "el adjunto es un rename puro");
});

// S13/B1
test("CA-13: un segmento final sin LF en sdd/events.jsonl no se funde con el log de chiche/", async (t) => {
	const script = await canonicalSequence();
	const repo = initRepo(scratch(t, "nolf"), FULL_TREE);
	const common = join(repo, ".git");
	writeTree(common, {
		"sdd/events.jsonl": `${eventLine({})}\n${eventLine({ ts: "2026-10-02T10:00:00Z" }).slice(0, 40)}`,
		"chiche/events.jsonl": `${eventLine({ ts: "2026-10-30T10:00:00Z", harness: "codex" })}\n`,
	});
	const before = (await readSddEvents(repo)).map((event) => event.ts);
	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.deepEqual((await readSddEvents(repo)).map((event) => event.ts), before, "la migración no pierde eventos legibles");
});

// S13/B2
test("CA-13: la reescritura conserva symlinks y el modo de los archivos", async (t) => {
	const script = await canonicalSequence();
	const repo = join(scratch(t, "modes"), "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	const { "CLAUDE.md": _claude, ...tree } = FULL_TREE;
	writeTree(repo, { ...tree, ".sdd/evidence/check.sh": "#!/bin/sh\ncat .sdd/project.md\n" });
	chmodSync(join(repo, ".sdd/evidence/check.sh"), 0o755);
	symlinkSync("AGENTS.md", join(repo, "CLAUDE.md"));
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "fixture");
	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.ok(lstatSync(join(repo, "CLAUDE.md")).isSymbolicLink(), "CLAUDE.md sigue siendo symlink");
	assert.equal(readlinkSync(join(repo, "CLAUDE.md")), "AGENTS.md", "el link no cambia de destino");
	assert.match(readFileSync(join(repo, "AGENTS.md"), "utf8"), /leer `\.chiche\/project\.md` y respetar/, "AGENTS.md, el destino del link, se reescribe por su propio nombre");
	assert.equal(statSync(join(repo, ".chiche/evidence/check.sh")).mode & 0o777, 0o755);
	assert.equal(git(repo, "diff", "--summary"), "", "sin mode change");
});

// S13/S1
test("CA-13: re-correr la secuencia con duplicados conservados no reescribe ni duplica la nota", async (t) => {
	const script = await canonicalSequence();
	const repo = initRepo(scratch(t, "rerun"), {
		...FULL_TREE,
		".chiche/specs/a.md": SPEC_A.replace("<!-- SDD-Tracking: version=1;", "<!-- Chiche-Tracking: version=2;"),
	});
	assert.equal(runSequence(script, repo).status, 0);
	const once = readFileSync(join(repo, ".chiche/project.md"), "utf8");
	const again = runSequence(script, repo);
	assert.equal(again.status, 0, again.stderr);
	assert.equal(readFileSync(join(repo, ".chiche/project.md"), "utf8"), once);
});

// Review de #107 (6)
test("review #107 (6): una re-corrida con un duplicado conservado no pisa las menciones históricas restauradas y sí migra lo recién movido", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "rerun-moved");
	const repo = initRepo(base, {
		...FULL_TREE,
		".chiche/specs/a.md": SPEC_A.replace("<!-- SDD-Tracking: version=1;", "<!-- Chiche-Tracking: version=2;"),
	});
	const tmp = join(base, "tmp");
	mkdirSync(tmp);
	assert.equal(runSequence(script, repo, { TMPDIR: tmp }).status, 0);
	const historical = "- 2026-10-30: la spec vivia en `.sdd/specs/a.md` (mencion historica restaurada a mano).";
	appendFileSync(join(repo, ".chiche/project.md"), `${historical}\n`);
	writeTree(repo, { ".sdd/specs/d.md": SPEC_A.replace("Spec A.", "Spec D. Ver `.sdd/specs/a.md`.") });
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "restaurar la mencion historica y sumar d");
	const project = readFileSync(join(repo, ".chiche/project.md"), "utf8");

	const again = runSequence(script, repo, { TMPDIR: tmp });
	assert.equal(again.status, 0, again.stderr);
	assert.equal(again.stdout, "chiche-init: conservado .chiche/specs/a.md; queda .sdd/specs/a.md\n");
	assert.equal(readFileSync(join(repo, ".chiche/project.md"), "utf8"), project, "lo que ya estaba en .chiche/ no se reescribe");
	assert.ok(project.includes(historical), "la mención histórica sigue en el contrato");
	const moved = readFileSync(join(repo, ".chiche/specs/d.md"), "utf8");
	const parsed = canonical(parseSddArtifact(moved));
	assert.equal(parsed.markerName, "Chiche-Tracking", "lo recién movido sí se migra");
	assert.equal(parsed.version, 2);
	assert.match(moved, /Spec D\. Ver `\.chiche\/specs\/a\.md`\./);
	assert.equal(existsSync(join(repo, ".sdd/specs/d.md")), false);
	assert.equal(existsSync(join(repo, ".sdd/specs/a.md")), true, "el duplicado conservado queda donde estaba");
	assert.deepEqual(readdirSync(tmp), [], "sin temporales");
});

// Review de #107-2 (4): un `.sdd/` sin ningún archivo trackeado no se migra.
test("review #107-2 (4): con .sdd/ entero sin trackear la secuencia avisa, sale con 0 y no toca nada", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "untracked");
	const repo = initRepo(base, { "README.md": "# repo\n", "CLAUDE.md": "@.sdd/project.md\n" });
	const common = join(repo, ".git");
	writeTree(repo, { ".sdd/project.md": CONTRACT_V1, ".sdd/specs/a.md": SPEC_A });
	writeTree(common, { "sdd/events.jsonl": `${eventLine({})}\n` });
	const before = porcelain(repo);
	const sdd = allFiles(join(repo, ".sdd"));
	const tmp = join(base, "tmp");
	mkdirSync(tmp);

	const run = runSequence(script, repo, { TMPDIR: tmp });
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stderr, "");
	assert.equal(run.stdout, "chiche-init: .sdd/ sin trackear; commitealo o movelo a mano, no se migra\n");
	assert.equal(existsSync(join(repo, ".chiche")), false, "no se crea .chiche/");
	assert.deepEqual(allFiles(join(repo, ".sdd")), sdd, ".sdd/ queda como estaba");
	assert.equal(readFileSync(join(repo, ".sdd/project.md"), "utf8"), CONTRACT_V1, "el contrato sin trackear no se reescribe");
	assert.equal(readFileSync(join(repo, "CLAUDE.md"), "utf8"), "@.sdd/project.md\n", "los imports no se reescriben");
	assert.equal(existsSync(join(common, "sdd", "events.jsonl")), true, "el common-dir no se toca");
	assert.equal(existsSync(join(common, "chiche")), false);
	assert.deepEqual(porcelain(repo), before, "git status no cambia");
	assert.deepEqual(readdirSync(tmp), [], "sin temporales");
});

test("review #107-2 (4): con una spec trackeada y el contrato sin trackear, git mv lo arrastra y la reescritura lo alcanza", async (t) => {
	const script = await canonicalSequence();
	const repo = initRepo(scratch(t, "mixed"), { ".sdd/specs/a.md": SPEC_A, "CLAUDE.md": "@.sdd/project.md\n" });
	writeTree(repo, { ".sdd/project.md": CONTRACT_V1 });
	assert.equal(git(repo, "ls-files", "--", ".sdd/project.md"), "", "el contrato del fixture no está trackeado");

	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(existsSync(join(repo, ".sdd")), false);
	const contract = readFileSync(join(repo, ".chiche/project.md"), "utf8");
	const parsed = canonical(parseSddArtifact(contract));
	assert.equal(parsed.markerName, "Chiche-Tracking", "el contrato sin trackear recibe el marker v2");
	assert.equal(parsed.version, 2);
	assert.equal(parsed.metadata.type, "project");
	assert.equal(contract.includes(".sdd/"), false, "el contrato sin trackear no conserva referencias a .sdd/");
	assert.ok(contract.includes(MIGRATION_NOTE), "la nota de la migración llega al contrato que viajó sin trackear");
	assert.equal(canonical(parseSddArtifact(readFileSync(join(repo, ".chiche/specs/a.md"), "utf8"))).markerName, "Chiche-Tracking");
	assert.deepEqual(porcelain(repo).sort(), [" M CLAUDE.md", "?? .chiche/project.md", "RM .sdd/specs/a.md -> .chiche/specs/a.md"]);
});

// Review de #107-2 (6)
test("review #107-2 (6): solo el primer marker de cada archivo pasa a v2; un ejemplo de marker dentro de un fence queda como estaba", async (t) => {
	const script = await canonicalSequence();
	const example = "<!-- SDD-Tracking: version=1; type=spec; state=draft; issue=none; grill=none; superseded-by=none -->";
	const body = `${SPEC_A}\n## Formato\n\n\`\`\`markdown\n${example}\n\`\`\`\n`;
	const repo = initRepo(scratch(t, "fence"), { ".sdd/project.md": CONTRACT_V1, ".sdd/specs/a.md": body });
	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	const text = readFileSync(join(repo, ".chiche/specs/a.md"), "utf8");
	const markers = text.split("\n").filter((line) => /<!--\s*(?:SDD|Chiche)-Tracking\s*:/.test(line));
	assert.equal(markers.length, 2, `el marker del preámbulo y el ejemplo del fence: ${markers.join(" | ")}`);
	assert.ok(markers[0]?.startsWith("<!-- Chiche-Tracking: version=2; type=spec; state=approved;"), `el primero migró: ${markers[0]}`);
	assert.equal(markers[1], example, "el ejemplo del cuerpo no cambia");
	const parsed = canonical(parseSddArtifact(text));
	assert.equal(parsed.markerName, "Chiche-Tracking");
	assert.equal(parsed.version, 2);
});

test("review #107-2 (6): un symlink trackeado bajo .sdd/ que apunta fuera migra como link y no reescribe su destino", async (t) => {
	const script = await canonicalSequence();
	const base = scratch(t, "symlink-out");
	const repo = join(base, "repo");
	mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	const doc = `# Doc\n${SPEC_A.split("\n")[1]}\nVer \`.sdd/specs/a.md\` y \`.sdd/project.md\`.\n`;
	writeTree(repo, { ".sdd/project.md": CONTRACT_V1, ".sdd/specs/a.md": SPEC_A, "docs/x.md": doc });
	symlinkSync("../../docs/x.md", join(repo, ".sdd/specs/x.md"));
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "fixture");

	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(readFileSync(join(repo, "docs/x.md"), "utf8"), doc, "el destino del link no es de esta migración: queda byte a byte igual");
	assert.ok(lstatSync(join(repo, ".chiche/specs/x.md")).isSymbolicLink(), "el link migra como link");
	assert.equal(readlinkSync(join(repo, ".chiche/specs/x.md")), "../../docs/x.md");
	assert.equal(porcelain(repo).some((line) => line.includes("docs/x.md")), false, "docs/x.md no aparece en git status");
	assert.equal(canonical(parseSddArtifact(readFileSync(join(repo, ".chiche/specs/a.md"), "utf8"))).markerName, "Chiche-Tracking", "lo demás sí se migra");
});

// Review de #107-2 (7)
test("review #107-2 (7): un contrato sin ## Decisiones humanas avisa, sale con 0 y no escribe la nota", async (t) => {
	const script = await canonicalSequence();
	const contract = CONTRACT_V1.replace(/\n## Decisiones humanas\n- 2026-08-15: solo local\.\n/, "");
	assert.equal(contract.includes("## Decisiones humanas"), false, "el fixture no trae la sección");
	const repo = initRepo(scratch(t, "nosection"), { ".sdd/project.md": contract, ".sdd/specs/a.md": SPEC_A });
	const run = runSequence(script, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stderr, "");
	assert.equal(run.stdout, "chiche-init: .chiche/project.md sin seccion '## Decisiones humanas'; anota la migracion a mano\n");
	const migrated = readFileSync(join(repo, ".chiche/project.md"), "utf8");
	assert.equal(migrated.includes(MIGRATION_NOTE), false, "sin sección no se inventa una nota");
	assert.equal(canonical(parseSddArtifact(migrated)).markerName, "Chiche-Tracking", "el resto de la migración sigue");
});

// Review de #107 (1b): el commit sugerido toma la migración y nada más.
function suggestedCommit(block: string): string {
	const command = /commit sugerido para el humano: `(git add -u -- [^`]+)`/.exec(block)?.[1];
	assert.ok(command, "el bloque nombra el commit sugerido entre backticks");
	return command;
}

function runCommit(command: string, cwd: string): { status: number | null; stdout: string; stderr: string } {
	return runSequence(command, cwd, {
		GIT_AUTHOR_NAME: "chiche",
		GIT_AUTHOR_EMAIL: "chiche@example.invalid",
		GIT_COMMITTER_NAME: "chiche",
		GIT_COMMITTER_EMAIL: "chiche@example.invalid",
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "commit.gpgsign",
		GIT_CONFIG_VALUE_0: "false",
	});
}

test("review #107 (1): el commit sugerido toma la migración y deja un cambio ajeno, un borrador sin trackear y lo ignorado fuera", async (t) => {
	const script = await canonicalSequence();
	const command = suggestedCommit(await referenceBlock());
	const repo = initRepo(scratch(t, "suggested"), { ...TREE_WITH_GITIGNORE, "src/foo.ts": "export const foo = 1;\n" });
	writeTree(repo, {
		"src/foo.ts": "export const foo = 2;\n",
		".sdd/evidence/local.log": "evidencia local ignorada\n",
		".sdd/grills/2026-01-03-draft.md": "# Grill — draft\nborrador sin trackear\n",
	});
	assert.equal(runSequence(script, repo).status, 0);

	const commit = runCommit(command, repo);
	assert.equal(commit.status, 0, commit.stderr);
	const changed = git(repo, "show", "--name-status", "--no-renames", "--format=%s").split("\n").filter(Boolean);
	assert.equal(changed[0], "chore(chiche-init): migracion a .chiche/");
	assert.deepEqual(
		changed.slice(1).sort(),
		[
			"A\t.chiche/grills/2026-01-01-x.md",
			"A\t.chiche/project.md",
			"A\t.chiche/specs/a.md",
			"A\t.chiche/specs/b.md",
			"D\t.sdd/grills/2026-01-01-x.md",
			"D\t.sdd/project.md",
			"D\t.sdd/specs/a.md",
			"D\t.sdd/specs/b.md",
			"M\t.gitignore",
			"M\tAGENTS.md",
			"M\tCLAUDE.md",
		],
		"el commit lleva los cuatro archivos movidos y las reescrituras de los tres archivos de la raíz, y nada más",
	);
	assert.deepEqual(porcelain(repo).sort(), [" M src/foo.ts", "?? .chiche/grills/2026-01-03-draft.md"], "quedan fuera el cambio ajeno y el borrador sin trackear; la evidencia ignorada ni aparece");
	assert.equal(git(repo, "check-ignore", ".chiche/evidence/local.log").trim(), ".chiche/evidence/local.log");
});

// Review de #107-2 (1): lo que crea un coding-policies o design-system encadenado queda fuera del comando; el reporte lo nombra con `git add -- <ruta>`.
test("review #107-2 (1): el commit sugerido deja afuera lo que escribió un encadenado y el git add -- <ruta> del reporte lo suma", async (t) => {
	const script = await canonicalSequence();
	const command = suggestedCommit(await referenceBlock());
	const repo = initRepo(scratch(t, "suggested-chained"), FULL_TREE);
	assert.equal(runSequence(script, repo).status, 0);
	writeTree(repo, { ".chiche/coding-policies.md": "# Coding policies\n", "DESIGN_SYSTEM.md": "# Design system\n" });

	assert.equal(runCommit(command, repo).status, 0);
	assert.deepEqual(porcelain(repo).sort(), ["?? .chiche/coding-policies.md", "?? DESIGN_SYSTEM.md"], "el comando no toma lo que escribió el encadenado");
	assert.equal(runCommit("git add -- .chiche/coding-policies.md DESIGN_SYSTEM.md && git commit -q -m 'docs: policies y diseño'", repo).status, 0);
	assert.deepEqual(porcelain(repo), [], "el git add -- <ruta> del reporte los suma");
});

test("review #107 (1): el commit sugerido anda sin AGENTS.md ni .gitignore", async (t) => {
	const script = await canonicalSequence();
	const command = suggestedCommit(await referenceBlock());
	const repo = initRepo(scratch(t, "suggested-min"), { ".sdd/project.md": CONTRACT_V1, ".sdd/specs/a.md": SPEC_A, "CLAUDE.md": "@.sdd/project.md\n" });
	assert.equal(runSequence(script, repo).status, 0);
	const commit = runCommit(command, repo);
	assert.equal(commit.status, 0, commit.stderr);
	assert.deepEqual(porcelain(repo), [], "la migración quedó entera en el commit");
});

// S13/S3
test("CA-13: con <git-common-dir>/chiche/ presente y no escribible la secuencia avisa, sigue y anota", { skip: process.getuid?.() === 0 }, async (t) => {
	const script = await canonicalSequence();
	const repo = initRepo(scratch(t, "rochiche"), FULL_TREE);
	const common = join(repo, ".git");
	const events = `${eventLine({})}\n`;
	writeTree(common, { "sdd/events.jsonl": events, "chiche/events.jsonl": `${eventLine({ ts: "2026-10-30T10:00:00Z" })}\n` });
	chmodSync(join(common, "chiche"), 0o555);
	const run = runSequence(script, repo);
	chmodSync(join(common, "chiche"), 0o755);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /chiche-init: no se pudo escribir en /);
	assert.equal(readFileSync(join(common, "sdd", "events.jsonl"), "utf8"), events);
	assert.ok(readFileSync(join(repo, ".chiche/project.md"), "utf8").includes(MIGRATION_NOTE));
	assertShortNote(repo, "<git-common-dir>/chiche/ no escribible");
});

// S13/S4
test("CA-13: la secuencia no depende de que pipefail esté apagado", async (t) => {
	const script = await canonicalSequence();
	const { "AGENTS.md": _agents, ...tree } = FULL_TREE;
	const repo = initRepo(scratch(t, "pipefail"), tree);
	const run = runSequence(`set -o pipefail\n${script}`, repo);
	assert.equal(run.status, 0, run.stderr);
	assert.ok(readFileSync(join(repo, ".chiche/project.md"), "utf8").includes(MIGRATION_NOTE));
});

// Review de #107 (8)
test("CA-15 (review #107, 8): el .gitignore de este repo ignora las specs que el eval de adherencia escribe en .chiche/ y ya no nombra .sdd/", async () => {
	const lines = (await readRepoFile(".gitignore")).split("\n").filter(Boolean);
	assert.ok(lines.includes("evals/*/fixtures/*/.chiche/specs/"), `el fixture del eval escribe su spec en .chiche/specs/: ${lines.join(" | ")}`);
	assert.deepEqual(lines.filter((line) => line.includes(".sdd")), [], "ningún patrón del .gitignore apunta a .sdd/");
	const check = spawnSync("git", ["check-ignore", "-q", "--no-index", "evals/adherence-chiche-spec/fixtures/mini-cli/.chiche/specs/json-flag.md"], { cwd: repoPath(""), env: cleanEnv() });
	assert.equal(check.status, 0, "la spec que escribe el caso de adherencia queda ignorada dentro del fixture");
});

// S15
test("CA-15: el contrato suma la fila de este gate con el conteo real de este archivo y la doctrina que prueba", async () => {
	const commands = section(await readRepoFile(".chiche/project.md"), /^Comandos$/);
	const own = await readFile(new URL(import.meta.url), "utf8");
	const count = own.match(/^test\(/gm)?.length ?? 0;
	const row = commands.split("\n").find((line) => line.startsWith("| gate de migracion a .chiche/ |")) ?? "";
	const cells = /^\| gate de migracion a \.chiche\/ \| `node --test pi-extensions\/chiche-migrate-gate\/chiche-migrate-gate\.test\.ts` \| raiz \| verificado \d{4}-\d{2}-\d{2} \| [^|]+ \| (\d+)\/(\d+);/.exec(row);
	assert.ok(cells, "fila `gate de migracion a .chiche/` con comando, cwd, fecha y conteo");
	assert.equal(Number(cells[1]), count, "pasan todos los tests del gate");
	assert.equal(Number(cells[2]), count, "el conteo de la fila es el de este archivo");
	for (const promise of [/sin index\.ts/, /identico byte a byte/, /Migrar a \.chiche\/ \(Recomendado\)/, /Mantener \.sdd\//, /--autonomy/, /sin commit/, /CA-20/]) {
		assert.match(row, promise, `la fila promete lo que el gate prueba: ${promise}`);
	}
});
