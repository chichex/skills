import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

// Gate de doctrina de claude/sdd-review-loop (spec .sdd/specs/sdd-review-loop.md).
// El skill existe solo para Claude Code y delega en el /code-review nativo, asi que
// no hay port que comparar: este test observa el artefacto entregado (SKILL.md,
// READMEs y descripcion del plugin) tal como lo consumen Claude Code y el plugin.
// La conducta real del skill (CA-10) es prueba humana y no se verifica aca.

const SKILL = "claude/sdd-review-loop/SKILL.md";
const SYNTAX =
	"/sdd-review-loop [<PR>] [--rounds N] [--level low|medium|high|xhigh|max] [--fix-scope correctness|all] [--model M] [--review-model M] [--fix-model M]";

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

function frontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(match?.[1], "frontmatter presente");
	return Object.fromEntries(
		match[1]
			.split("\n")
			.map((line) => line.match(/^([a-z-]+):\s*(.*)$/))
			.filter((entry): entry is RegExpMatchArray => entry !== null)
			.map((entry) => [entry[1], entry[2].trim()]),
	);
}

function body(markdown: string): string {
	return markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
}

// Texto de una seccion `## <heading>` hasta el proximo `## `.
function section(markdown: string, heading: RegExp): string {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.startsWith("## ") && heading.test(line));
	assert.notEqual(start, -1, `seccion ${heading} presente`);
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (lines[index]!.startsWith("## ")) {
			end = index;
			break;
		}
	}
	return lines.slice(start, end).join("\n");
}

function expectAll(text: string, patterns: Array<RegExp | string>, label: string): void {
	for (const pattern of patterns) {
		if (typeof pattern === "string") {
			assert.ok(text.includes(pattern), `${label}: falta «${pattern}»`);
		} else {
			assert.match(text, pattern, `${label}: falta ${pattern}`);
		}
	}
}

test("CA-1: el skill existe solo para Claude Code con frontmatter valido", async () => {
	const markdown = await readRepoFile(SKILL);
	const metadata = frontmatter(markdown);
	assert.equal(metadata.name, "sdd-review-loop", "name igual a la carpeta");
	const description = metadata.description ?? "";
	expectAll(
		description,
		[/rondas/i, /code-review/, /\bPR\b/, /subagente|Sonnet/i, /\.sdd\/project\.md|contrato/i],
		"description",
	);
	assert.equal(metadata.compatibility, undefined, "compatibility es un extra de Pi");
	await assert.rejects(access(repoFile("claude/sdd-review-loop/agents/openai.yaml")), "sidecar de Codex ausente");
	for (const harness of ["codex", "opencode", "pi"]) {
		await assert.rejects(access(repoFile(`${harness}/sdd-review-loop/SKILL.md`)), `${harness}: sin port en esta entrega`);
	}
});

test("CA-2: argumentos, defaults, tope duro y wizard de Fase 0", async () => {
	const doctrine = body(await readRepoFile(SKILL));
	const args = section(doctrine, /Argumentos/);
	assert.ok(args.includes(SYNTAX), "linea de sintaxis literal");
	expectAll(
		args,
		[
			/`--rounds N`[^\n]*default[^\n]*`3`/,
			/`1`[^\n]*`5`[^\n]*tope duro|tope duro[^\n]*`5`/,
			/no se clampea/,
			/`--level`[^\n]*default[^\n]*`high`/,
			/siempre[^\n]*expl[ií]cito/,
			/`ultra`[^\n]*rechaza/,
			/`--fix-scope`[^\n]*default[^\n]*`correctness`/,
			/`security`/,
			/`simplification`[^\n]*`efficiency`/,
			/`--model M`[^\n]*ambos/,
			/`--review-model`[^\n]*`--fix-model`[^\n]*sobreescriben/,
			/`sonnet`[^\n]*ambos|ambos[^\n]*`sonnet`/,
		],
		"## Argumentos",
	);

	const wizard = section(doctrine, /Fase 0/);
	expectAll(
		wizard,
		[
			/Lanzador/,
			/SOLO[^\n]*pelado/,
			/gh pr list --state open --limit 20/,
			/m[aá]s reciente primero/,
			/m[aá]ximo 4/,
			/AskUserQuestion/,
			/\(Recomendado\)/,
			/resumen[^\n]*comments[^\n]*push/i,
			/cero preguntas/,
			/flag[^\n]*no pregunta|no pregunta[^\n]*flag/i,
		],
		"## Fase 0",
	);
});

test("CA-3: preflight bloqueante antes del wizard", async () => {
	const doctrine = body(await readRepoFile(SKILL));
	const preflight = section(doctrine, /Fase 1/);
	expectAll(
		preflight,
		[
			/\.sdd\/project\.md[^\n]*\/sdd-init|\/sdd-init[^\n]*\.sdd\/project\.md/,
			"git rev-parse --show-toplevel",
			"gh auth status",
			"gh repo view --json nameWithOwner",
			/`\/code-review` nativo/,
			/no improvisa/,
			/draft[^\n]*acepta/i,
			/cerrado[^\n]*mergeado[^\n]*frena/i,
			/head repo[^\n]*base repo/i,
			/fork[^\n]*frena/i,
			/permisos[^\n]*hereda|hereda[^\n]*permisos/i,
			/no modifica settings|no modifica[^\n]*settings/i,
			/datos no confiables/,
		],
		"## Fase 1",
	);
});

test("CA-4: orquestacion por ronda con subagentes, JSON y parada temprana", async () => {
	const doctrine = body(await readRepoFile(SKILL));
	const loop = section(doctrine, /Fase 2/);
	expectAll(
		loop,
		[
			/tool `Agent`/,
			/background/,
			/`model`/,
			/tool `Skill`/,
			/`code-review`|`\/code-review`/,
			"--comment <nivel>",
			"```json",
			'"published"',
			'"findings"',
			'"counts"',
			/`published`[^\n]*`false`[^\n]*gh api|gh api[^\n]*`published`/i,
			/conteos[^\n]*clave/i,
			/nunca pega[^\n]*diff/i,
			/`--fix-scope`/,
			/parada temprana/i,
			/no convergencia/,
			/archivo[^\n]*categor[ií]a[^\n]*resumen normalizado/i,
			/contenido en[^\n]*N-1/,
			/bloqueados[^\n]*no cuentan/i,
			"`sin cambios`",
			/head nuevo|head actual/i,
		],
		"## Fase 2",
	);
});

test("CA-5: el corrector trabaja en worktree con la doctrina de la Fase 6 de sdd-run", async () => {
	const doctrine = body(await readRepoFile(SKILL));
	const fixer = section(doctrine, /Fase 3/);
	expectAll(
		fixer,
		[
			"../<repo>-review-loop-<PR>",
			"git fetch origin <headRef>",
			/detached[^\n]*origin\/<headRef>/,
			"HEAD:refs/heads/<headRef>",
			/checkout original/,
			/Fase 6[^\n]*sdd-run|sdd-run[^\n]*Fase 6/,
			/sin modificar[^\n]*sdd-run|no modifica[^\n]*sdd-run/,
			"gh api graphql",
			/paginando/,
			/archivo y l[ií]nea/,
			/v[aá]lido y en alcance/,
			/ya resuelto\/incorrecto/,
			/no accionable/,
			/bloqueado/,
			/test de regresi[oó]n[^\n]*primero|primero[^\n]*test de regresi[oó]n|regresi[oó]n[^\n]*antes/i,
			/tres intentos/,
			/revierte|revertir/i,
			/nunca[^\n]*rojo/i,
			"headRefOid",
			"fast-forward",
			"review: resolver",
			/nunca force/i,
			/branch default/,
			/respond[ea][^\n]*resuelve|responder[^\n]*resolver/i,
			/receipt[^\n]*comment resumen/i,
			"```json",
			'"pushed"',
			'"blocked"',
			/remueve el worktree[^\n]*limpio/i,
		],
		"## Fase 3",
	);
});

test("CA-6: reporte final en chat y comment resumen idempotente", async () => {
	const doctrine = body(await readRepoFile(SKILL));
	const closing = section(doctrine, /Fase 4/);
	expectAll(
		closing,
		[
			/SDD-REVIEW-LOOP <TERMINADO\|DETENIDO>/,
			/motivo de corte/i,
			"sin hallazgos accionables",
			"no convergencia",
			"N agotado",
			"sin cambios",
			"cancelado",
			"error terminal",
			/hallazgos[^\n]*accionables[^\n]*corregidos[^\n]*descartados[^\n]*bloqueados[^\n]*commits[^\n]*verificaci[oó]n/i,
			"<!-- sdd-review-loop:summary -->",
			/primera l[ií]nea/,
			/se edita[^\n]*en lugar de crear/i,
			/vivos[^\n]*sin reportar|sin reportar[^\n]*vivos/i,
		],
		"## Fase 4",
	);
});

test("CA-7: MUST DO y MUST NOT DO explicitos", async () => {
	const doctrine = body(await readRepoFile(SKILL));
	section(doctrine, /^## MUST DO$/);
	const forbidden = section(doctrine, /^## MUST NOT DO$/);
	expectAll(
		forbidden,
		[
			/mergear/i,
			/aprobar/i,
			/force-push/,
			/branch default/,
			/`--fix`/,
			/doctrina de `\/code-review`/,
			/sdd-run/,
			/instrucciones/,
			/checkout original/,
			/preguntas despu[eé]s del wizard/i,
			/5 rondas|tope/,
		],
		"## MUST NOT DO",
	);
});

test("CA-8: READMEs y descripcion del plugin documentan el skill", async () => {
	const rows: Record<string, RegExp> = {
		"README.md": /^## El workflow SDD$/m,
		"README.en.md": /^## The SDD workflow$/m,
	};
	for (const [path, heading] of Object.entries(rows)) {
		const markdown = await readRepoFile(path);
		const headingIndex = markdown.search(heading);
		assert.notEqual(headingIndex, -1, `${path}: seccion del workflow SDD`);
		const nextHeading = markdown.indexOf("\n## ", headingIndex + 1);
		const sddSection = markdown.slice(headingIndex, nextHeading === -1 ? undefined : nextHeading);
		const row = sddSection.match(/^\| \*\*`sdd-review-loop`\*\* \|.*$/m)?.[0];
		assert.ok(row, `${path}: fila de sdd-review-loop dentro de la tabla del workflow SDD`);
		expectAll(
			row,
			[/code-review/, /rondas|rounds/i, /Sonnet|subagent/i, /\.sdd\/project\.md|contrato|contract/i, /\/sdd-review-loop/],
			`${path} fila`,
		);
	}

	const plugin = JSON.parse(await readRepoFile(".claude-plugin/plugin.json")) as { description: string };
	assert.match(plugin.description, /sdd-review-loop|rondas de review/i, "plugin.json description");
	const marketplace = JSON.parse(await readRepoFile(".claude-plugin/marketplace.json")) as {
		plugins: Array<{ name: string; description: string }>;
	};
	const entry = marketplace.plugins.find((candidate) => candidate.name === "chichex-skills");
	assert.ok(entry, "marketplace.json: plugin chichex-skills");
	assert.match(entry.description, /sdd-review-loop|rondas de review/i, "marketplace.json description");
	assert.equal(entry.description, plugin.description, "ambas descripciones iguales (sin drift)");
});

test("CA-9: el gate vive en un directorio solo de tests", async () => {
	await assert.rejects(access(repoFile("pi-extensions/sdd-review-loop/index.ts")), "sin extension Pi");
});
