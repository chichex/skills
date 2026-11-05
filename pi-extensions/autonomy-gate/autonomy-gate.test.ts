// Gate anti-drift del dial de autonomía (issue #102).
//
// Capa 1 (CA-1 a CA-6): `## Autonomy` reemplaza a `## Limites` en el template
// de chiche-init; la gramática de niveles vive en el bloque `autonomy-levels`
// (byte a byte en 7 skills × 5 harnesses), la precedencia y la lectura del
// branch default en `autonomy-resolve` (idéntico tras la normalización de
// docs/harness-interaction-differences.md) y la forma del contrato en
// `autonomy-contract` (chiche-init × 5). El comando canónico de
// `autonomy-resolve` se ejecuta con bash y con sh en repos git temporales.
// Es solo-tests (sin index.ts), como events-gate: el package censa exactamente
// 11 factories. Que un agente honre el nivel en una sesión real es prueba
// humana (CA-18, CA-19).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Harness } from "../harness-gate/interaction.ts";
import { HARNESSES, escapeRegExp, fencedBlocks, firstDifference, normalizeInvocations, parseInteractionTable } from "../harness-gate/interaction.ts";

const SKILLS = ["grill", "issue-triage", "chiche-init", "chiche-spec", "chiche-run", "chiche-land", "design-system"] as const;
type Skill = (typeof SKILLS)[number];
const STAGE_READERS: Record<string, string> = { grill: "grill", "chiche-spec": "spec", "chiche-run": "run", "chiche-land": "land" };
const NO_ROW_SKILLS = ["chiche-init", "issue-triage", "design-system"] as const;
const FLAGLESS_SKILLS = ["tdd", "coding-policies"] as const;
const SUPERVISED_ONLY_SKILLS = ["chiche-land", "design-system"] as const;
const UNSUPPORTED = "--autonomy <nivel>: no soportado todavía (v1 honra A1–A3)";
const LIMITES_FALLBACK = "contrato sin ## Autonomy: rigen sus ## Limites; corré chiche-init --update";
const WORKING_TREE_NOTICE = "nivel leído del working tree: sin remote";
const APTITUDE = "ninguna fila de la stop list matchea `git push -u origin <branch>`";
const GREP_DIRS = ["claude", "codex", "opencode", "pi", "antigravity", "agents", "pi-extensions/subagent/agents"] as const;

function repoPath(path: string): string {
	return new URL(`../../${path}`, import.meta.url).pathname;
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoPath(path), "utf8");
}

async function skillFile(harness: Harness, skill: string): Promise<string> {
	return readRepoFile(`${harness}/${skill}/SKILL.md`);
}

function delimitedBlock(markdown: string, name: string): string | null {
	const block = markdown.match(new RegExp(`<!-- ${escapeRegExp(name)}:start -->\\n([\\s\\S]*?)\\n<!-- ${escapeRegExp(name)}:end -->`));
	return block ? (block[1] ?? "") : null;
}

function section(markdown: string, heading: RegExp): string {
	const lines = markdown.split("\n");
	let fence = false;
	let start = -1;
	let level = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^\s*(```|~~~)/.test(line)) fence = !fence;
		if (fence) continue;
		const match = /^(#{2,4}) (.*)$/.exec(line);
		if (!match) continue;
		const depth = match[1]?.length ?? 0;
		if (start === -1) {
			if (heading.test(match[2] ?? "")) {
				start = index;
				level = depth;
			}
			continue;
		}
		if (depth <= level) return lines.slice(start, index).join("\n");
	}
	return start === -1 ? "" : lines.slice(start).join("\n");
}

let tableCache: ReturnType<typeof parseInteractionTable> | null = null;
async function interactionTable(): Promise<ReturnType<typeof parseInteractionTable>> {
	if (!tableCache) tableCache = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	return tableCache;
}

// La única normalización permitida (docs/harness-interaction-differences.md):
// invocaciones con el prefijo del harness y la tool de preguntas.
async function normalize(text: string, harness: Harness): Promise<string> {
	const table = await interactionTable();
	let out = normalizeInvocations(text, table.prefixes[harness]);
	const tool = table.questionTools[harness];
	if (tool) out = out.replaceAll(`\`${tool}\``, "`«tool-preguntas»`");
	return out;
}

async function sharedBlocks(name: string, skills: readonly string[], options: { normalized: boolean }): Promise<{ problems: string[]; blocks: Map<string, string> }> {
	const problems: string[] = [];
	const blocks = new Map<string, string>();
	for (const skill of skills) {
		for (const harness of HARNESSES) {
			const path = `${harness}/${skill}/SKILL.md`;
			const block = delimitedBlock(await skillFile(harness, skill), name);
			if (block === null) {
				problems.push(`${path}: falta el bloque <!-- ${name}:start/end -->`);
				continue;
			}
			blocks.set(path, options.normalized ? await normalize(block, harness) : block);
		}
	}
	const [reference] = [...blocks.entries()];
	if (reference) {
		for (const [path, block] of blocks) {
			if (block !== reference[1]) problems.push(`${reference[0]} vs ${path}: ${firstDifference(reference[1], block)}`);
		}
	}
	return { problems, blocks };
}

function missing(text: string, patterns: RegExp[]): string[] {
	return patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `falta ${pattern}`);
}

async function referenceBlock(name: string, skill: Skill = "chiche-run"): Promise<string> {
	const block = delimitedBlock(await skillFile("claude", skill), name);
	assert.ok(block, `claude/${skill} trae el bloque ${name}`);
	return block;
}

async function canonicalCommand(): Promise<string> {
	const fences = fencedBlocks(await referenceBlock("autonomy-resolve"));
	assert.equal(fences.length, 1, "autonomy-resolve trae exactamente un fence: el comando canónico");
	return fences[0]?.content ?? "";
}

// ---------------------------------------------------------------------------
// CA-1: template del contrato y bloque autonomy-contract

test("CA-1: el template de la Fase 4 de chiche-init lleva ## Autonomy con sus dos tablas y ya no ## Limites, en los cinco harnesses", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "chiche-init");
		const phase = section(markdown, /^Fase 4 — /);
		const fence = fencedBlocks(phase).find((candidate) => /^# Contrato de autonomia/m.test(candidate.content));
		if (!fence) {
			problems.push(`${harness}/chiche-init: la Fase 4 no trae el template del contrato`);
			continue;
		}
		const template = fence.content;
		if (!/^## Autonomy$/m.test(template)) problems.push(`${harness}/chiche-init: el template no tiene ## Autonomy`);
		if (/^## Limites$/m.test(template)) problems.push(`${harness}/chiche-init: el template todavía tiene ## Limites`);
		if (!/^\| Stage \| Level \| Since \| Rehearsed \|$/m.test(template)) problems.push(`${harness}/chiche-init: falta la tabla de niveles`);
		if (!/^\| Action \| Pattern \| Reason \|$/m.test(template)) problems.push(`${harness}/chiche-init: falta la tabla de paradas`);
		const autonomyIndex = template.indexOf("## Autonomy");
		const policiesIndex = template.indexOf("## Politicas de generacion");
		const verificationIndex = template.indexOf("## Verificacion autonoma");
		if (!(verificationIndex < autonomyIndex && autonomyIndex < policiesIndex)) problems.push(`${harness}/chiche-init: ## Autonomy va entre ## Verificacion autonoma y ## Politicas de generacion`);
	}
	assert.deepEqual(problems, []);
});

test("CA-1: el bloque autonomy-contract es idéntico en los cinco chiche-init tras normalizar y fija columnas, valores de Rehearsed y la forma del Pattern", async () => {
	const { problems, blocks } = await sharedBlocks("autonomy-contract", ["chiche-init"], { normalized: true });
	assert.deepEqual(problems, []);
	assert.equal(blocks.size, 5);
	const block = await referenceBlock("autonomy-contract", "chiche-init");
	assert.deepEqual(missing(block, [
		/`\| Stage \| Level \| Since \| Rehearsed \|`/,
		/`\| Action \| Pattern \| Reason \|`/,
		/filas fijas `grill`, `spec`, `run`, `review` y `land`, más una por ambiente de `## Ambientes`/,
		/`land`, `review` y los ambientes solo aceptan `supervised`/,
		/ningún skill lee `review`/,
		/`rehearsed <YYYY-MM-DD>`/,
		/`unrehearsed`/,
		/`FAILED \(<motivo>\)`/,
		/regex POSIX extendida \(`grep -E`\)/,
		/una por fila y sin `\|`/,
		/`Pattern` vacío es inválida/,
		/`## Decisiones humanas`/,
		/los skills la ignoran con aviso/,
	]), []);
});

// ---------------------------------------------------------------------------
// CA-2: gramática de niveles

test("CA-2: el bloque autonomy-levels está en los 35 SKILL.md, byte a byte, con la escala A0–A5 y el diagnóstico literal de A0/A4/A5", async () => {
	const { problems, blocks } = await sharedBlocks("autonomy-levels", SKILLS, { normalized: false });
	assert.deepEqual(problems, []);
	assert.equal(blocks.size, 35);
	const block = await referenceBlock("autonomy-levels");
	assert.deepEqual(missing(block, [
		/`manual \(A0\)`, `supervised \(A1\)`, `plan-approved \(A2\)`, `unattended \(A3\)`, `auto-land \(A4\)` y `auto-deploy \(A5\)`/,
		/acepta el código o la palabra/,
		/sin distinguir mayúsculas/,
		new RegExp(escapeRegExp(`\`${UNSUPPORTED}\``)),
		/aborta antes de cualquier mutación/,
		/cualquier otro token aborta listando los valores válidos/,
		/el default es `supervised \(A1\)`/,
	]), []);
	assert.doesNotMatch(block, /`(?:\/|\$|\/skill:)(?:grill|chiche-[a-z]+|issue-triage|design-system)/, "el bloque no invoca skills: así es byte a byte en los cinco harnesses");
});

// ---------------------------------------------------------------------------
// CA-3: firmas

test("CA-3: los siete skills declaran [--autonomy <level>] con la invocación de su harness; grill gana ## Argumentos; tdd y coding-policies no lo ganan", async () => {
	const table = await interactionTable();
	const problems: string[] = [];
	for (const skill of SKILLS) {
		for (const harness of HARNESSES) {
			const markdown = await skillFile(harness, skill);
			const args = section(markdown, /^(Argumentos|Argumentos Pi|Invocación)$/);
			if (!args) {
				problems.push(`${harness}/${skill}: sin sección ## Argumentos`);
				continue;
			}
			const signature = fencedBlocks(args)[0]?.content ?? "";
			const prefix = escapeRegExp(table.prefixes[harness]);
			if (!new RegExp(`^${prefix}${escapeRegExp(skill)} .*\\[--autonomy <level>\\]`, "m").test(signature)) {
				problems.push(`${harness}/${skill}: la firma no lleva [--autonomy <level>] con el prefijo ${table.prefixes[harness]}`);
			}
			if (!/^- `--autonomy <level>` — /m.test(args)) problems.push(`${harness}/${skill}: ## Argumentos no describe --autonomy`);
		}
	}
	for (const skill of SUPERVISED_ONLY_SKILLS) {
		for (const harness of HARNESSES) {
			const args = section(await skillFile(harness, skill), /^Argumentos$/);
			if (!/`--autonomy <level>`[^\n]*aborta con cualquier valor distinto de `supervised`\/`A1`/.test(args)) {
				problems.push(`${harness}/${skill}: --autonomy no aborta fuera de supervised/A1`);
			}
		}
	}
	for (const skill of FLAGLESS_SKILLS) {
		for (const harness of HARNESSES) {
			if (/--autonomy/.test(await skillFile(harness, skill))) problems.push(`${harness}/${skill}: no gana el flag --autonomy`);
		}
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// CA-4: precedencia, lectura y comando canónico

test("CA-4: el bloque autonomy-resolve es idéntico en los 35 SKILL.md tras normalizar, fija precedencia, fila por skill, fallbacks y traza", async () => {
	const { problems, blocks } = await sharedBlocks("autonomy-resolve", SKILLS, { normalized: true });
	assert.deepEqual(problems, []);
	assert.equal(blocks.size, 35);
	const block = await referenceBlock("autonomy-resolve");
	assert.deepEqual(missing(block, [
		/el del flag `--autonomy` si vino; si no, la fila del `Stage` en `## Autonomy` del contrato leído del branch default/,
		/un PR no puede subirse la autonomía a sí mismo/,
		/`grill` lee la fila `grill`, `chiche-spec` la fila `spec`, `chiche-run` la fila `run` y `chiche-land` la fila `land`/,
		/`chiche-init`, `issue-triage` y `design-system` no tienen fila: flag o `supervised \(A1\)`/,
		/`git fetch` best-effort/,
		/`git show origin\/<default>:\.chiche\/project\.md`, con fallback a `\.sdd\/project\.md`/,
		new RegExp(escapeRegExp(`\`${WORKING_TREE_NOTICE}\``)),
		/`unrehearsed` o `FAILED`, rige `supervised \(A1\)` con aviso/,
		new RegExp(escapeRegExp(`\`${LIMITES_FALLBACK}\``)),
		/esa prosa sigue rigiendo como restricción/,
		/se lee de la misma fuente y frena en todo nivel/,
		/`nivel efectivo: <nombre> \(<código>\), leído de <fuente>`/,
		/sin parámetros posicionales ni variables de argumentos del harness/,
	]), []);
	const command = await canonicalCommand();
	assert.match(command, /stage='<stage>' flag='<flag>'/, "los dos placeholders se asignan al inicio");
	assert.match(command, /git symbolic-ref -q --short refs\/remotes\/origin\/HEAD/);
	assert.match(command, /git show "\$ref:\.chiche\/project\.md"[^\n]*git show "\$ref:\.sdd\/project\.md"/);
	assert.match(command, /echo "nivel efectivo: \$nivel, leído de \$src"/);
});

test("CA-4: ningún bloque autonomy-* contiene parámetros posicionales ni $ARGUMENTS, en ninguno de los 35 archivos", async () => {
	const problems: string[] = [];
	for (const skill of SKILLS) {
		for (const harness of HARNESSES) {
			const markdown = await skillFile(harness, skill);
			for (const name of ["autonomy-levels", "autonomy-resolve", "autonomy-contract", "autonomy-a2"]) {
				const block = delimitedBlock(markdown, name);
				if (block === null) continue;
				const hit = block.match(/\$(?:[0-9]|ARGUMENTS|@|\*)/);
				if (hit) problems.push(`${harness}/${skill} bloque ${name}: contiene ${hit[0]}`);
			}
		}
	}
	assert.deepEqual(problems, []);
});

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-c", "user.name=sdd", "-c", "user.email=sdd@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

const LEVELS_TABLE = (rows: string) => `## Autonomy\n| Stage | Level | Since | Rehearsed |\n|---|---|---|---|\n${rows}\n\n| Action | Pattern | Reason |\n|---|---|---|\n| push a main | git push .* main | solo via PR |\n| deploy | npm run deploy | sin confirmacion humana |\n| sin patron |  | fila invalida |\n`;

function contract(autonomy: string | null, limites = false): string {
	return [
		"# Contrato de autonomia — demo",
		"<!-- Chiche-Tracking: version=2; type=project; generated-at=2026-11-05 -->",
		"",
		"## Comandos",
		"| Accion | Comando | cwd | Estado | Duracion | Notas |",
		"|---|---|---|---|---|---|",
		"",
		"## Ambientes",
		"Solo local.",
		"",
		"## Verificacion autonoma",
		"1. node --test",
		"",
		...(autonomy === null ? [] : [autonomy]),
		...(limites ? ["## Limites", "- No hacer git push a main.", ""] : []),
		"## Politicas de generacion",
		"Sin politicas activas.",
		"",
		"## Decisiones humanas",
		"",
		"## Gaps",
		"",
	].join("\n");
}

function runResolve(command: string, cwd: string, stage: string, flag: string, shell: "bash" | "sh" = "bash"): { status: number | null; stdout: string; stderr: string } {
	const script = command.replace("'<stage>'", `'${stage}'`).replace("'<flag>'", `'${flag}'`);
	const env = { ...process.env };
	for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
	const result = spawnSync(shell, ["-c", script], { cwd, encoding: "utf8", env });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Repo con remote local: `main` publicado con el contrato `base`, y un branch
// de trabajo con el contrato `branch` commiteado y sin pushear.
function repoWithRemote(name: string, base: string, branch: string, contractPath = ".chiche/project.md"): { root: string; work: string } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), `autonomy-gate-${name}-`)));
	const bare = join(root, "origin.git");
	git(root, "init", "-q", "--bare", "-b", "main", bare);
	const seed = join(root, "seed");
	git(root, "clone", "-q", bare, seed);
	mkdirSync(join(seed, contractPath, ".."), { recursive: true });
	writeFileSync(join(seed, contractPath), base);
	git(seed, "add", "-A");
	git(seed, "commit", "-q", "-m", "contrato base");
	git(seed, "push", "-q", "origin", "HEAD:main");
	const work = join(root, "work");
	git(root, "clone", "-q", bare, work);
	git(work, "checkout", "-q", "-b", "feature");
	writeFileSync(join(work, contractPath), branch);
	git(work, "commit", "-q", "--allow-empty", "-am", "sube la autonomia en el branch");
	return { root, work };
}

test("CA-4: el comando lee el nivel de origin/<default>, no del branch: base A1 + branch A3 → A1, con la stop list y la fila sin Pattern ignorada con aviso", async (t) => {
	const command = await canonicalCommand();
	const base = contract(LEVELS_TABLE("| grill | supervised | 2026-11-05 | — |\n| run | supervised | 2026-11-05 | — |"));
	const branch = contract(LEVELS_TABLE("| grill | supervised | 2026-11-05 | — |\n| run | unattended | 2026-11-05 | rehearsed 2026-11-05 |"));
	const { root, work } = repoWithRemote("adversarial", base, branch);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const shell of ["bash", "sh"] as const) {
		const run = runResolve(command, work, "run", "", shell);
		assert.equal(run.status, 0, `${shell}: ${run.stderr}`);
		assert.match(run.stdout, /^nivel efectivo: supervised \(A1\), leído de origin\/main$/m, `${shell}: ${run.stdout}`);
		assert.doesNotMatch(run.stdout, /\(A3\)/, `${shell}: el branch no sube la autonomía`);
		assert.match(run.stdout, /^parada: \| push a main \| git push \.\* main \| solo via PR \|$/m, `${shell}: stop list leída de la misma fuente`);
		assert.match(run.stdout, /^parada: \| deploy \| npm run deploy \|/m);
		assert.doesNotMatch(run.stdout, /sin patron/, `${shell}: la fila sin Pattern no se emite como parada`);
		assert.match(run.stderr, /aviso: fila de la stop list sin Pattern, ignorada/, `${shell}: ${run.stderr}`);
		assert.doesNotMatch(run.stderr, /working tree/);
	}
	assert.equal(git(work, "status", "--porcelain"), "", "el comando no toca el working tree");
});

test("CA-4: el flag manda sobre el contrato y la stop list igual se lee; A0/A4/A5 y un token inválido abortan con exit 2 y el diagnóstico literal", async (t) => {
	const command = await canonicalCommand();
	const base = contract(LEVELS_TABLE("| run | supervised | 2026-11-05 | — |"));
	const { root, work } = repoWithRemote("flag", base, base);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const shell of ["bash", "sh"] as const) {
		for (const [flag, expected] of [["A3", "unattended (A3)"], ["a2", "plan-approved (A2)"], ["Supervised", "supervised (A1)"], ["plan-approved", "plan-approved (A2)"]] as const) {
			const run = runResolve(command, work, "run", flag, shell);
			assert.equal(run.status, 0, `${shell} ${flag}: ${run.stderr}`);
			assert.match(run.stdout, new RegExp(`^nivel efectivo: ${escapeRegExp(expected)}, leído de --autonomy$`, "m"), `${shell} ${flag}: ${run.stdout}`);
			assert.match(run.stdout, /^parada: \| push a main \|/m, `${shell} ${flag}: la stop list se lee aunque venga el flag`);
		}
		for (const flag of ["A0", "manual", "a4", "auto-land", "A5", "auto-deploy"]) {
			const run = runResolve(command, work, "run", flag, shell);
			assert.equal(run.status, 2, `${shell} ${flag}: exit 2`);
			assert.equal(run.stdout, "", `${shell} ${flag}: no imprime nivel`);
			assert.match(run.stderr, new RegExp(`^${escapeRegExp(UNSUPPORTED.replace("<nivel>", flag))}$`, "m"), `${shell} ${flag}: ${run.stderr}`);
		}
		const invalid = runResolve(command, work, "run", "extreme", shell);
		assert.equal(invalid.status, 2, `${shell}: token inválido → exit 2`);
		assert.match(invalid.stderr, /--autonomy extreme: valor inválido; válidos: supervised \(A1\), plan-approved \(A2\), unattended \(A3\)/);
	}
});

test("CA-4: sin remote lee el working tree y avisa; una fila FAILED o unrehearsed cae a A1 con aviso", async (t) => {
	const command = await canonicalCommand();
	const root = realpathSync(mkdtempSync(join(tmpdir(), "autonomy-gate-local-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	git(root, "init", "-q", "-b", "main");
	mkdirSync(join(root, ".chiche"));
	writeFileSync(join(root, ".chiche/project.md"), contract(LEVELS_TABLE("| spec | plan-approved | 2026-11-05 | rehearsed 2026-11-05 |\n| run | unattended | 2026-11-05 | FAILED (2 preguntas) |\n| grill | plan-approved | 2026-11-05 | unrehearsed |")));
	git(root, "add", "-A");
	git(root, "commit", "-q", "-m", "contrato local");
	for (const shell of ["bash", "sh"] as const) {
		const spec = runResolve(command, root, "spec", "", shell);
		assert.equal(spec.status, 0, `${shell}: ${spec.stderr}`);
		assert.match(spec.stdout, /^nivel efectivo: plan-approved \(A2\), leído de working tree$/m, `${shell}: ${spec.stdout}`);
		assert.match(spec.stderr, new RegExp(escapeRegExp(WORKING_TREE_NOTICE)), `${shell}: ${spec.stderr}`);
		const failed = runResolve(command, root, "run", "", shell);
		assert.match(failed.stdout, /^nivel efectivo: supervised \(A1\), leído de working tree$/m, `${shell}: ${failed.stdout}`);
		assert.match(failed.stderr, /fila run sin ensayo \(FAILED \(2 preguntas\)\): rige supervised \(A1\)/, `${shell}: ${failed.stderr}`);
		const unrehearsed = runResolve(command, root, "grill", "", shell);
		assert.match(unrehearsed.stdout, /^nivel efectivo: supervised \(A1\), leído de working tree$/m);
		assert.match(unrehearsed.stderr, /fila grill sin ensayo \(unrehearsed\)/);
		const none = runResolve(command, root, "none", "", shell);
		assert.match(none.stdout, /^nivel efectivo: supervised \(A1\), leído de working tree$/m, `${shell}: los skills sin fila resuelven supervised`);
		const absent = runResolve(command, root, "land", "", shell);
		assert.match(absent.stdout, /^nivel efectivo: supervised \(A1\), leído de working tree$/m);
		assert.match(absent.stderr, /## Autonomy sin fila land/);
	}
	assert.equal(git(root, "status", "--porcelain"), "");
});

test("CA-4: un contrato que sigue en .sdd/ se lee desde el branch default; uno con ## Limites y sin ## Autonomy da A1 con el aviso literal", async (t) => {
	const command = await canonicalCommand();
	const sdd = contract(LEVELS_TABLE("| spec | plan-approved | 2026-11-05 | rehearsed 2026-11-05 |"));
	const legacy = repoWithRemote("sdd", sdd, sdd, ".sdd/project.md");
	const limites = repoWithRemote("limites", contract(null, true), contract(null, true));
	const empty = repoWithRemote("sin-seccion", contract(null), contract(null));
	t.after(() => {
		for (const repo of [legacy, limites, empty]) rmSync(repo.root, { recursive: true, force: true });
	});
	for (const shell of ["bash", "sh"] as const) {
		const fromSdd = runResolve(command, legacy.work, "spec", "", shell);
		assert.equal(fromSdd.status, 0, `${shell}: ${fromSdd.stderr}`);
		assert.match(fromSdd.stdout, /^nivel efectivo: plan-approved \(A2\), leído de origin\/main$/m, `${shell}: ${fromSdd.stdout}`);
		const withLimites = runResolve(command, limites.work, "run", "", shell);
		assert.equal(withLimites.status, 0, `${shell}: ${withLimites.stderr}`);
		assert.match(withLimites.stdout, /^nivel efectivo: supervised \(A1\), leído de origin\/main$/m);
		assert.match(withLimites.stderr, new RegExp(`^aviso: ${escapeRegExp(LIMITES_FALLBACK)}$`, "m"), `${shell}: ${withLimites.stderr}`);
		assert.doesNotMatch(withLimites.stdout, /^parada:/m, "sin ## Autonomy no hay stop list en tabla");
		const withFlag = runResolve(command, limites.work, "run", "A2", shell);
		assert.match(withFlag.stdout, /^nivel efectivo: plan-approved \(A2\), leído de --autonomy$/m);
		assert.match(withFlag.stderr, new RegExp(escapeRegExp(LIMITES_FALLBACK)), `${shell}: con flag la prosa de ## Limites sigue avisando`);
		const noSection = runResolve(command, empty.work, "run", "", shell);
		assert.match(noSection.stdout, /^nivel efectivo: supervised \(A1\), leído de origin\/main$/m);
		assert.match(noSection.stderr, /contrato sin ## Autonomy: rige supervised \(A1\)/);
		assert.doesNotMatch(noSection.stderr, /## Limites/);
	}
});

// ---------------------------------------------------------------------------
// CA-5: nadie cita ## Limites como fuente propia

test("CA-5: grep de Limites sobre los cinco harnesses y los agents devuelve solo el fallback de autonomy-resolve y la migración de chiche-init", () => {
	const grep = spawnSync("git", ["grep", "-n", "Limites", "--", ...GREP_DIRS], { cwd: repoPath(""), encoding: "utf8" });
	assert.ok(grep.status === 0 || grep.status === 1, grep.stderr);
	const allowed = (line: string): boolean => {
		const [path = "", , ...rest] = line.split(":");
		const text = rest.join(":");
		if (text.includes(LIMITES_FALLBACK) || /esa prosa sigue rigiendo como restricción/.test(text)) return true;
		if (/\/chiche-init\/SKILL\.md$/.test(path) && /^\| Stop list \|/.test(text)) return true;
		if (/\/chiche-init\/SKILL\.md$/.test(path) && /Reemplaza a `## Limites`/.test(text)) return true;
		return false;
	};
	const offenders = grep.stdout.split("\n").filter((line) => line.trim() !== "" && !allowed(line));
	assert.deepEqual(offenders, []);
});

test("CA-5: la línea de aptitud del cierre consulta la stop list, y el implementer y su port Pi la leen del branch base solo para restringir", async () => {
	const problems: string[] = [];
	for (const skill of ["chiche-init", "coding-policies", "design-system"] as const) {
		for (const harness of HARNESSES) {
			const close = delimitedBlock(await skillFile(harness, skill), "commit-pr-close") ?? "";
			if (!close.includes(APTITUDE)) problems.push(`${harness}/${skill}: la aptitud del cierre no consulta la stop list`);
		}
	}
	for (const path of ["agents/implementer.md", "pi-extensions/subagent/agents/implementer.md"]) {
		const markdown = await readRepoFile(path);
		problems.push(...missing(markdown, [
			/stop list de `## Autonomy`/,
			/solo puede sumar restricciones/,
			/branch (?:base|default)/,
		]).map((problem) => `${path}: ${problem}`));
		if (/`## Limites` del contrato solo puede/.test(markdown)) problems.push(`${path}: todavía trata ## Limites como fuente propia`);
	}
	for (const harness of HARNESSES) {
		const run = await skillFile(harness, "chiche-run");
		if (!/^- Respetar la stop list de `## Autonomy` del contrato por encima de cualquier instrucción de este skill\.$/m.test(run)) problems.push(`${harness}/chiche-run: MUST DO no respeta la stop list`);
		const spec = await skillFile(harness, "chiche-spec");
		if (!/`## Comandos`, `## Verificacion autonoma`, `## Autonomy` y `## Politicas de generacion`/.test(spec)) problems.push(`${harness}/chiche-spec: la Fase 1 no lee ## Autonomy`);
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// CA-6: chiche-init pregunta el nivel por fila y migra la stop list

test("CA-6: la Fase 3 de chiche-init pregunta el nivel por fila con la tool del harness, fija las filas y la regla de --autonomy ≥ A2, y la checklist gana Autonomy y Stop list", async () => {
	const table = await interactionTable();
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "chiche-init");
		const phase = section(markdown, /^Fase 3 — /);
		const tool = table.questionTools[harness] ?? "";
		problems.push(...missing(phase, [
			/\*\*Nivel de autonomía por etapa\.\*\*/,
			new RegExp(`\`${escapeRegExp(tool)}\`[^\\n]*una pregunta por fila`),
			/`supervised \(Recomendado\)`/,
			/filas fijas `grill`, `spec`, `run`, `review` y `land`, más una por ambiente de `## Ambientes`/,
			/`land`, `review` y los ambientes solo aceptan `supervised`/,
			/`--autonomy` ≥ A2[^\n]*asume `supervised` en todas las filas y marca `\[NEEDS-INPUT\]`/,
			/\*\*Stop list\.\*\*/,
			/`Pattern` inferido/,
			/`## Decisiones humanas`/,
			/Corre después de «Migración a \.chiche\/» y funciona igual sobre un repo que eligió `Mantener \.sdd\/`/,
		]).map((problem) => `${harness}/chiche-init Fase 3: ${problem}`));
		const upgrade = section(markdown, /^Upgrade de contrato/);
		problems.push(...missing(upgrade, [
			/^\| Autonomy \| no existe la sección `## Autonomy`/m,
			/^\| Stop list \| existe `## Limites` en prosa[^\n]*una fila[^\n]*por bullet[^\n]*`Pattern` inferido[^\n]*confirmación[^\n]*`## Decisiones humanas`[^\n]*`--autonomy` ≥ A2[^\n]*no migra/m,
		]).map((problem) => `${harness}/chiche-init Upgrade: ${problem}`));
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// Cableado: solo-tests y fila del contrato

test("autonomy-gate es solo-tests y el package sigue con 11 extensiones", async () => {
	assert.equal(existsSync(repoPath("pi-extensions/autonomy-gate/index.ts")), false, "sin index.ts");
	const manifest = JSON.parse(await readRepoFile("package.json")) as { pi: { extensions: string[] } };
	assert.equal(manifest.pi.extensions.length, 11);
	assert.ok(manifest.pi.extensions.every((path) => !path.includes("autonomy-gate")));
});

test("el contrato de este repo suma la fila del gate de autonomía con el conteo real de este archivo", async () => {
	const commands = section(await readRepoFile(".chiche/project.md"), /^Comandos$/);
	const own = await readFile(new URL(import.meta.url), "utf8");
	const count = own.match(/^test\(/gm)?.length ?? 0;
	const row = commands.match(/^\| gate del dial de autonomia \| `node --test pi-extensions\/autonomy-gate\/autonomy-gate\.test\.ts` \| raiz \| verificado \d{4}-\d{2}-\d{2} \| [^|]+ \| (\d+)\/(\d+);/m);
	assert.ok(row, "fila `gate del dial de autonomia` con comando, cwd, fecha y conteo");
	assert.equal(Number(row[1]), count, "pasan todos los tests del gate");
	assert.equal(Number(row[2]), count, "el conteo de la fila es el de este archivo");
});
