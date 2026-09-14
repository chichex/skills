// Capa de interaccion compartida por los gates anti-drift entre harnesses
// (harness-gate y coding-policies-gate): inventario de harnesses y skills,
// lectura de la tabla normativa de docs/harness-interaction-differences.md,
// normalizacion de invocaciones y utilidades de fences y diffs. No es una
// extension de Pi: no tiene default export y solo la importan los tests.

import assert from "node:assert/strict";

export const HARNESSES = ["claude", "codex", "opencode", "pi"] as const;
export type Harness = (typeof HARNESSES)[number];

// Nombres de skill del repo que pueden aparecer invocados dentro de un
// template o de la doctrina. Se ordenan por longitud descendente al construir
// la lista, para que la alternancia de la regex no corte un nombre largo por
// uno que sea su prefijo.
export const SKILL_NAMES = [
	"grill-with-domain-modeling",
	"github-issue-selector",
	"coding-policies",
	"domain-modeling",
	"issue-triage",
	"mini-grill",
	"code-review",
	"repo-clean",
	"find-skills",
	"yt-summary",
	"sdd-init",
	"sdd-spec",
	"sdd-run",
	"grill",
	"tdd",
].sort((a, b) => b.length - a.length);

export interface InteractionTable {
	prefixes: Record<Harness, string>;
}

export function parseInteractionTable(doc: string): InteractionTable {
	const block = doc.match(
		/<!-- interaction-differences:start -->\n([\s\S]*?)\n<!-- interaction-differences:end -->/,
	);
	assert.ok(block, "bloque delimitado interaction-differences presente");
	const rows = (block[1] ?? "").split("\n").filter((line) => line.startsWith("|"));
	const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
	assert.deepEqual(cells(rows[0] ?? ""), ["Campo", ...HARNESSES], "columnas en el orden canonico");
	const byField = new Map<string, string[]>();
	for (const row of rows.slice(2)) {
		const parsed = cells(row);
		byField.set(parsed[0] ?? "", parsed.slice(1));
	}
	const invocation = byField.get("invocacion");
	assert.ok(invocation, "fila invocacion presente en la tabla");
	const prefixes = {} as Record<Harness, string>;
	HARNESSES.forEach((harness, index) => {
		const pattern = (invocation[index] ?? "").replaceAll("`", "");
		assert.ok(pattern.endsWith("nombre"), `celda invocacion de ${harness} termina en "nombre"`);
		prefixes[harness] = pattern.slice(0, -"nombre".length);
	});
	return { prefixes };
}

export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reduce cada invocacion de un skill del repo con el prefijo del harness
// (`/sdd-spec`, `$sdd-spec`, `/skill:sdd-spec`) a un token comun.
export function normalizeInvocations(text: string, prefix: string): string {
	const names = SKILL_NAMES.map(escapeRegExp).join("|");
	const pattern = new RegExp(
		`(^|[^A-Za-z0-9.])${escapeRegExp(prefix)}(${names})(?![A-Za-z0-9-])`,
		"gm",
	);
	return text.replace(pattern, (_match, before: string, name: string) => `${before}«skill:${name}»`);
}

export interface Fence {
	content: string;
	line: number;
}

export function fencedBlocks(markdown: string): Fence[] {
	const lines = markdown.split("\n");
	const fences: Fence[] = [];
	let open: { char: string; length: number; start: number; inner: string[] } | null = null;
	lines.forEach((line, index) => {
		if (open === null) {
			const opening = line.match(/^\s*(`{3,}|~{3,})/);
			if (opening) {
				const delimiter = opening[1] ?? "";
				open = { char: delimiter[0] ?? "`", length: delimiter.length, start: index + 1, inner: [] };
			}
			return;
		}
		const closing = line.match(/^\s*(`{3,}|~{3,})\s*$/);
		if (closing && (closing[1] ?? "")[0] === open.char && (closing[1] ?? "").length >= open.length) {
			fences.push({ content: open.inner.join("\n"), line: open.start });
			open = null;
			return;
		}
		open.inner.push(line);
	});
	return fences;
}

export function firstDifference(a: string, b: string): string {
	const aLines = a.split("\n");
	const bLines = b.split("\n");
	const max = Math.max(aLines.length, bLines.length);
	for (let index = 0; index < max; index++) {
		if (aLines[index] !== bLines[index]) {
			return `linea ${index + 1}: \`${aLines[index] ?? "<ausente>"}\` vs \`${bLines[index] ?? "<ausente>"}\``;
		}
	}
	return "identicos";
}
