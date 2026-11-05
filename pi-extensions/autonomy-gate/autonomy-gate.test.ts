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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
// Capa 2 (CA-7 a CA-11): retiro de --assume/--subagent, propagación y conducta por nivel

const RETIRED_FLAGS_DIRS = ["claude", "codex", "opencode", "pi", "antigravity", "agents", ".claude", "README.md", "README.en.md", ".claude-plugin", ".codex-plugin", ".agents", "evals"] as const;

test("CA-7: --assume y --subagent no aparecen en los cinco harnesses, agents, .claude, READMEs, manifests, marketplace ni evals", () => {
	const grep = spawnSync("git", ["grep", "-n", "-e", "--assume", "-e", "--subagent", "--", ...RETIRED_FLAGS_DIRS], { cwd: repoPath(""), encoding: "utf8" });
	assert.ok(grep.status === 0 || grep.status === 1, grep.stderr);
	assert.deepEqual(grep.stdout.split("\n").filter((line) => line.trim() !== ""), []);
});

test("CA-8: en chiche-run --model/--effort exigen A3, --inline evita la segunda delegación, Pi gana «Run con subagente» con la tool subagent y Codex/opencode corren A3 inline", async () => {
	const table = await interactionTable();
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "chiche-run");
		const args = section(markdown, /^Argumentos$/);
		const signature = fencedBlocks(args)[0]?.content ?? "";
		if (!/\[--autonomy <level>\] \[--inline\]/.test(signature)) problems.push(`${harness}/chiche-run: la firma no lleva [--autonomy <level>] [--inline]`);
		if (!/^- `--inline` — /m.test(args)) problems.push(`${harness}/chiche-run: ## Argumentos no describe --inline`);
		if (harness === "codex" || harness === "opencode") {
			problems.push(...missing(args, [
				/corre inline en esta sesión con la conducta de A2 más la corrección automática del feedback de la Fase 6/,
				/`nivel efectivo: unattended \(A3\), leído de <fuente> · corre inline en (?:Codex|opencode)`/,
				/`--model\/--effort: este harness corre A3 inline`/,
			]).map((problem) => `${harness}/chiche-run: ${problem}`));
			if (/^## Run con subagente/m.test(markdown)) problems.push(`${harness}/chiche-run: no tiene subagentes y no debe ganar «Run con subagente»`);
			continue;
		}
		const subagent = section(markdown, /^Run con subagente \(solo con --autonomy A3 y sin --inline\)$/);
		if (!subagent) {
			problems.push(`${harness}/chiche-run: falta ## Run con subagente (solo con --autonomy A3 y sin --inline)`);
			continue;
		}
		const prefix = escapeRegExp(table.prefixes[harness]);
		problems.push(...missing(subagent, [
			/lanzadora, no corredora/,
			new RegExp(`\`${prefix}chiche-run <target> --autonomy A3 --inline\``),
			new RegExp(`\`${prefix}chiche-init --autonomy A3\``),
			new RegExp(`\`${prefix}chiche-spec <target> --autonomy A3\``),
			/corre la Fase 6 de A3 él mismo/,
			/Con `--inline` nada de esta sección aplica/,
		]).map((problem) => `${harness}/chiche-run «Run con subagente»: ${problem}`));
		if (harness === "pi") {
			problems.push(...missing(subagent, [/tool `subagent`/, /agent: "implementer"/, /background: true/, /PI_SUBAGENT_DEPTH=1/]).map((problem) => `pi/chiche-run: ${problem}`));
			if (!/`chiche-run --autonomy A3`[^\n]*«Run con subagente» de `\/skill:chiche-run`/.test(await skillFile("pi", "chiche-spec"))) problems.push("pi/chiche-spec: el menú no apunta a «Run con subagente» de pi/chiche-run");
		} else if (!/`--model\/--effort exigen --autonomy A3`/.test(args)) problems.push(`${harness}/chiche-run: --model/--effort sin A3 no abortan con el literal`);
	}
	for (const harness of HARNESSES) {
		const flow = delimitedBlock(await skillFile(harness, "chiche-spec"), "chiche-spec-flow") ?? "";
		if (!/`Llevar a issue` \/ `chiche-run` \/ `chiche-run --autonomy A3` \/ `Solicitar cambios`/.test(flow)) problems.push(`${harness}/chiche-spec: el menú no ofrece chiche-run --autonomy A3`);
		if (/chiche-run con subagente/.test(flow)) problems.push(`${harness}/chiche-spec: el menú todavía ofrece chiche-run con subagente`);
	}
	assert.deepEqual(problems, []);
});

test("CA-9: issue-triage agrega --autonomy a toda ruta encadenada, chiche-spec/chiche-run/grill lo propagan y Pi lo lleva por /issues y el orquestador", async () => {
	const problems: string[] = [];
	for (const harness of ["claude", "codex", "opencode", "antigravity"] as const) {
		const block = delimitedBlock(await skillFile(harness, "issue-triage"), "stage-chain") ?? "";
		const rows = block.split("\n").filter((line) => line.startsWith("|")).slice(2);
		if (rows.length < 6) problems.push(`${harness}/issue-triage: tabla stage-chain con ${rows.length} rutas`);
		for (const row of rows) if (!/`--autonomy <level>` si vino \|$/.test(row)) problems.push(`${harness}/issue-triage: la ruta ${row.slice(0, 40)}… no propaga --autonomy`);
	}
	for (const harness of HARNESSES) {
		const spec = section(await skillFile(harness, "chiche-spec"), /^Argumentos$/);
		if (!/el flag se propaga a `[^`]*chiche-run` y a `[^`]*chiche-init` cuando este skill los encadena/.test(spec)) problems.push(`${harness}/chiche-spec: no propaga --autonomy a chiche-run y chiche-init`);
		const run = await skillFile(harness, "chiche-run");
		if (!/con A2 o A3 → correr `[^`]*chiche-init --autonomy <level>` y seguir/.test(run)) problems.push(`${harness}/chiche-run: no propaga --autonomy a chiche-init`);
		if (!/encadenarlo con `--autonomy <level>` \(A2 o A3\)/.test(run)) problems.push(`${harness}/chiche-run: no propaga --autonomy a chiche-spec`);
		const grill = await skillFile(harness, "grill");
		if (!/--from-grill <(?:ruta-del-handoff|sessionId)>`[^\n]*más `--autonomy <(?:level|código)>` si esta corrida (?:lo )?recibió/.test(grill)) problems.push(`${harness}/grill: no propaga --autonomy a chiche-spec`);
	}
	const triagePi = section(await skillFile("pi", "issue-triage"), /^Invocación$/);
	if (!/`\/issues --autonomy <level>`[^\n]*el orquestador lo agrega a los argumentos del skill del stage elegido/.test(triagePi)) problems.push("pi/issue-triage: no documenta /issues --autonomy ni el despacho");
	const issues = await readRepoFile("pi-extensions/github-issues.ts");
	if (!/parseIssuesCommandArgs\(args/.test(issues)) problems.push("pi-extensions/github-issues.ts: /issues no parsea sus args");
	const dispatch = await readRepoFile("pi-extensions/workflow-orchestrator/dispatch.ts");
	if (!/withAutonomy\(args, autonomy\)/.test(dispatch)) problems.push("dispatch.ts: no agrega --autonomy a los args");
	assert.deepEqual(problems, []);
});

test("CA-10: el bloque autonomy-a2 está en grill y chiche-spec de los cinco harnesses, byte a byte, con la definición de impacto alto, la regla 0 / 1–3 / >3 de A3 y la conducta de chiche-spec por nivel", async () => {
	const { problems, blocks } = await sharedBlocks("autonomy-a2", ["grill", "chiche-spec"], { normalized: false });
	assert.deepEqual(problems, []);
	assert.equal(blocks.size, 10);
	const block = delimitedBlock(await skillFile("claude", "grill"), "autonomy-a2") ?? "";
	assert.deepEqual(missing(block, [
		/define el alcance entero, o roza la stop list, datos o migraciones, o un contrato externo \(API, formato, evento\)/,
		/el resto queda `\[ASSUMED\]` en el handoff o en la tabla de inferencias/,
		/`grill` corre el reconocimiento siempre/,
		/con 0 sigue sin preguntar; con 1 a 3 aplica el atajo liviano y sigue; con más de 3 aborta con el listado y el diagnóstico `pedido no autonomizable en A3: bajá a A2 o partilo`/,
		/con `supervised` \(A1\) no se pregunta antes de publicar y la corrida termina en el menú final/,
		/con A2 se preguntan las de impacto alto y no hay menú: responderlas es la aprobación/,
		/con A3 no se pregunta nada ni hay menú/,
	]), []);
	for (const skill of ["chiche-init", "chiche-run", "chiche-land", "design-system", "issue-triage"]) {
		for (const harness of HARNESSES) {
			if (delimitedBlock(await skillFile(harness, skill), "autonomy-a2") !== null) problems.push(`${harness}/${skill}: autonomy-a2 es solo de grill y chiche-spec`);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-11: la Fase 6 de chiche-run fija la conducta por nivel en los cinco harnesses: A2 lanza el review y termina, A3 corrige solo con tope de 2 ciclos y 30 minutos", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "chiche-run");
		const phase6 = section(markdown, /^Fase 6 — /);
		problems.push(...missing(phase6, [
			/\*\*Por nivel\.\*\* Con `supervised` \(A1\) rige el menú del paso 2/,
			/Con `plan-approved` \(A2\) no se pregunta: se lanza `Code review`[^\n]*termina sin esperar; los findings los lee el humano/,
			/Con `unattended` \(A3\) no se pregunta: se ejecutan `Code review` y `Resolver feedback automáticamente` con tope de 2 ciclos de corrección; al tercer lote de feedback se dejan los threads abiertos y se reporta/,
			/Corre en el mismo agente que corrió el run \(el `implementer` delegado, o la sesión con `--inline`\); el lanzador solo releva/,
			/Sin `\.github\/workflows\/claude-review\.yml`, el review corre en ese mismo agente con el code review nativo \(`[^`]*code-review[^`]*` sobre el PR\), sin lanzar otro subagente/,
			/El snapshot del paso 1 y la conservación del worktree aplican también en A3/,
			/30 minutos sin feedback nuevo terminan el seguimiento con `SEGUIMIENTO DE FEEDBACK DETENIDO` y limpian el worktree/,
			/Con A2 o A3 no se pregunta: ver «Por nivel»/,
		]).map((problem) => `${harness}/chiche-run Fase 6: ${problem}`));
		if (!/si el nivel efectivo es A1 o A3 y la corrida creó un PR/.test(section(markdown, /^Fase 5 — /))) problems.push(`${harness}/chiche-run: la Fase 5 ata el snapshot a A1 o A3`);
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// Capa 3 (CA-13 a CA-17): ensayo de niveles, stop list y recetas de deploy

const HOST = "claude/chiche-init/rehearsal-host.mjs";
const REHEARSAL_NOTICE = "ensayo disponible desde Claude Code: corré chiche-init --update ahí";

// Un `claude` falso que habla el stream de `claude -p --input-format stream-json
// --output-format stream-json --permission-prompt-tool stdio`: emite el `init`,
// N `control_request` de AskUserQuestion (esperando cada `control_response`) y el
// `result`. FAKE_QUESTIONS fija N, FAKE_TOOLS la lista del init y FAKE_MARK el
// archivo que escribe solo si llega al `result` (un corte lo deja sin escribir).
function fakeClaude(dir: string): string {
	const script = join(dir, "fake-claude.mjs");
	writeFileSync(script, `
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const n = Number(process.env.FAKE_QUESTIONS ?? "0");
const tools = (process.env.FAKE_TOOLS ?? "AskUserQuestion,Bash,Read").split(",");
writeFileSync(process.env.FAKE_ARGV, JSON.stringify(process.argv.slice(2)));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const rl = createInterface({ input: process.stdin });
const pending = new Map();
let asked = 0;
let started = false;
function ask() {
	if (asked >= n) {
		out({ type: "result", subtype: "success", total_cost_usd: 0.01 });
		if (process.env.FAKE_MARK) writeFileSync(process.env.FAKE_MARK, "done");
		setTimeout(() => process.exit(0), 20);
		return;
	}
	asked += 1;
	const id = "req-" + asked;
	pending.set(id, true);
	out({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "¿Formato?", header: "JSON", options: [{ label: "Compacto (Recomendado)", description: "" }, { label: "Indentado", description: "" }], multiSelect: false }] }, tool_use_id: "toolu_" + asked } });
}
rl.on("line", (line) => {
	let msg;
	try { msg = JSON.parse(line); } catch { return; }
	if (msg.type === "user" && !started) {
		started = true;
		out({ type: "system", subtype: "init", tools, model: "fake" });
		ask();
		return;
	}
	if (msg.type === "control_response") {
		const id = msg.response?.request_id;
		if (!pending.delete(id)) return;
		const answers = msg.response?.response?.updatedInput?.answers ?? {};
		if (process.env.FAKE_ANSWERS) writeFileSync(process.env.FAKE_ANSWERS, JSON.stringify(answers));
		ask();
	}
});
process.on("SIGTERM", () => process.exit(143));
`);
	const bin = join(dir, "claude");
	writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
	return bin;
}

function runHost(args: string[], env: Record<string, string>, cwd: string): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [repoPath(HOST), ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000 });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("CA-13: el host cuenta las AskUserQuestion del hijo headless: 0 → rehearsed, 1 en A3 → FAILED con corte, 3 en A2 → rehearsed, 4 en A2 → FAILED con corte, init sin la tool → unrehearsed", async (t) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "autonomy-gate-host-")));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const claude = fakeClaude(dir);
	const fixture = join(dir, "fixture");
	mkdirSync(fixture);
	const today = new Date().toISOString().slice(0, 10);
	const scenario = (name: string, args: string[], env: Record<string, string>) => {
		const mark = join(dir, `${name}.done`);
		const argv = join(dir, `${name}.argv`);
		const answers = join(dir, `${name}.answers`);
		const run = runHost(["--claude", claude, "--fixture", fixture, ...args], { FAKE_MARK: mark, FAKE_ARGV: argv, FAKE_ANSWERS: answers, ...env }, dir);
		return { ...run, done: existsSync(mark), argv: existsSync(argv) ? (JSON.parse(readFileSync(argv, "utf8")) as string[]) : [], answers: existsSync(answers) ? readFileSync(answers, "utf8") : "" };
	};

	const zero = scenario("zero", ["--stage", "spec", "--level", "A3"], { FAKE_QUESTIONS: "0" });
	assert.equal(zero.status, 0, zero.stderr);
	assert.equal(zero.stdout.trim(), `rehearsed ${today}`);
	assert.equal(zero.done, true, "sin corte: el hijo llegó al result");
	assert.ok(zero.argv.includes("--permission-prompt-tool") && zero.argv[zero.argv.indexOf("--permission-prompt-tool") + 1] === "stdio", `argv: ${zero.argv.join(" ")}`);
	for (const flag of ["-p", "--input-format", "--output-format", "--max-budget-usd"]) assert.ok(zero.argv.includes(flag), `argv sin ${flag}: ${zero.argv.join(" ")}`);
	assert.equal(zero.argv[zero.argv.indexOf("--input-format") + 1], "stream-json");
	assert.equal(zero.argv[zero.argv.indexOf("--output-format") + 1], "stream-json");

	const oneA3 = scenario("one-a3", ["--stage", "grill", "--level", "unattended"], { FAKE_QUESTIONS: "1" });
	assert.equal(oneA3.status, 1, oneA3.stderr);
	assert.equal(oneA3.stdout.trim(), "FAILED (1 preguntas)");
	assert.match(oneA3.stderr, /corte: tope de 0 preguntas superado/);
	assert.equal(oneA3.done, false, "el host corta al hijo al superar el tope");

	const threeA2 = scenario("three-a2", ["--stage", "spec", "--level", "A2"], { FAKE_QUESTIONS: "3" });
	assert.equal(threeA2.status, 0, threeA2.stderr);
	assert.equal(threeA2.stdout.trim(), `rehearsed ${today}`);
	assert.match(threeA2.stderr, /preguntas: 3 \(tope 3\)/);
	assert.match(threeA2.answers, /"¿Formato\?":"Compacto \(Recomendado\)"/, "el host responde la opción recomendada");

	const fourA2 = scenario("four-a2", ["--stage", "run", "--level", "plan-approved"], { FAKE_QUESTIONS: "4" });
	assert.equal(fourA2.status, 1, fourA2.stderr);
	assert.equal(fourA2.stdout.trim(), "FAILED (4 preguntas)");
	assert.match(fourA2.stderr, /corte: tope de 3 preguntas superado/);
	assert.equal(fourA2.done, false);

	const noTool = scenario("no-tool", ["--stage", "spec", "--level", "A3"], { FAKE_QUESTIONS: "0", FAKE_TOOLS: "Bash,Read" });
	assert.equal(noTool.status, 2, noTool.stderr);
	assert.equal(noTool.stdout.trim(), "unrehearsed");
	assert.match(noTool.stderr, /init sin AskUserQuestion/);

	const unsupported = runHost(["--claude", claude, "--fixture", fixture, "--stage", "spec", "--level", "A4"], {}, dir);
	assert.equal(unsupported.status, 2);
	assert.match(unsupported.stderr, /--autonomy A4: no soportado todavía \(v1 honra A1–A3\)/);
	const a1 = runHost(["--claude", claude, "--fixture", fixture, "--stage", "spec", "--level", "A1"], {}, dir);
	assert.equal(a1.status, 2);
	assert.match(a1.stderr, /solo se ensayan plan-approved \(A2\) y unattended \(A3\)/);
});

test("CA-13: sin --fixture el host genera el proyecto de juguete fuera del repo (CLI, test en verde, contrato con ## Autonomy y spec) y lo borra salvo --keep", async (t) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "autonomy-gate-toy-")));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const claude = fakeClaude(dir);
	const kept = runHost(["--claude", claude, "--stage", "run", "--level", "A3", "--keep"], { FAKE_QUESTIONS: "0", FAKE_ARGV: join(dir, "keep.argv") }, dir);
	assert.equal(kept.status, 0, kept.stderr);
	const toy = kept.stderr.match(/^fixture: (.+)$/m)?.[1] ?? "";
	assert.ok(toy && existsSync(toy), `el host anuncia el fixture: ${kept.stderr}`);
	t.after(() => rmSync(toy, { recursive: true, force: true }));
	assert.ok(!toy.startsWith(repoPath("")), "el proyecto de juguete vive fuera del repo");
	const tests = spawnSync(process.execPath, ["--test"], { cwd: toy, encoding: "utf8" });
	assert.equal(tests.status, 0, tests.stderr);
	const contract = readFileSync(join(toy, ".chiche/project.md"), "utf8");
	assert.match(contract, /^## Autonomy$/m);
	assert.match(contract, /^\| Action \| Pattern \| Reason \|$/m);
	assert.ok(existsSync(join(toy, ".chiche/specs/json-flag.md")), "spec chica para la fila run");
	assert.equal(spawnSync("git", ["-C", toy, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).stdout.trim(), "true", "el juguete es un repo git para chiche-run --no-pr");
	const argv = JSON.parse(readFileSync(join(dir, "keep.argv"), "utf8")) as string[];
	assert.ok(!argv.includes(toy), "el prompt viaja por stdin, no por argv");

	const dropped = runHost(["--claude", claude, "--stage", "spec", "--level", "A3"], { FAKE_QUESTIONS: "0", FAKE_ARGV: join(dir, "drop.argv") }, dir);
	assert.equal(dropped.status, 0, dropped.stderr);
	const dropToy = dropped.stderr.match(/^fixture: (.+)$/m)?.[1] ?? "";
	assert.ok(dropToy, dropped.stderr);
	assert.equal(existsSync(dropToy), false, "sin --keep el juguete se borra al terminar");
});

test("CA-13 y CA-14: chiche-init ensaya grill, spec y run solo en Claude Code con rehearsal-host.mjs; los otros harnesses escriben unrehearsed con el aviso literal; --no-verify escribe unrehearsed en todos", async () => {
	const problems: string[] = [];
	const claude = await skillFile("claude", "chiche-init");
	const rehearsal = section(claude, /^Ensayo de niveles/);
	problems.push(...missing(rehearsal, [
		/`rehearsal-host\.mjs`/,
		/`claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio --max-budget-usd <tope>`/,
		/`control_request` `can_use_tool` de `AskUserQuestion`/,
		/`unattended` \(A3\) exige 0 y `plan-approved` \(A2\) exige hasta 3; al pasar el tope corta el hijo/,
		/agregar un flag --json que imprima el resultado como JSON/,
		/`rehearsed <fecha>` si pasó, `FAILED \(<n> preguntas\)` si no/,
		/no lista `AskUserQuestion` o el hijo no termina, escribe `unrehearsed`, nunca `rehearsed`/,
		/Se saltea con `--no-verify`/,
		/--stage <grill\|spec\|run> --level <A2\|A3>/,
		/`review`, `land` y los ambientes no se ensayan/,
	]).map((problem) => `claude/chiche-init «Ensayo de niveles»: ${problem}`));
	if (!/toda fila ≥ A2 de `grill`, `spec` y `run` se ensaya/.test(section(claude, /^Fase 3 — /))) problems.push("claude/chiche-init Fase 3: no manda al ensayo");
	if (/ensayo disponible desde Claude Code/.test(claude)) problems.push("claude/chiche-init: el aviso de otro harness no va acá");
	for (const harness of ["codex", "opencode", "pi", "antigravity"] as const) {
		const markdown = await skillFile(harness, "chiche-init");
		if (/^## Ensayo de niveles/m.test(markdown) || /rehearsal-host/.test(markdown)) problems.push(`${harness}/chiche-init: el ensayo es solo de Claude Code`);
		if (!new RegExp(`\`unrehearsed\` en toda fila ≥ A2, con el aviso literal \`${escapeRegExp(REHEARSAL_NOTICE)}\``).test(section(markdown, /^Fase 3 — /))) problems.push(`${harness}/chiche-init Fase 3: falta unrehearsed con el aviso literal`);
	}
	for (const harness of HARNESSES) {
		if (!/`--no-verify`[^\n]*`unrehearsed` en todas/.test(section(await skillFile(harness, "chiche-init"), /^Fase 3 — /))) problems.push(`${harness}/chiche-init Fase 3: --no-verify no escribe unrehearsed en todas`);
	}
	assert.deepEqual(problems, []);
});

async function stopListCommand(): Promise<string> {
	const fences = fencedBlocks(await referenceBlock("autonomy-contract", "chiche-init"));
	assert.equal(fences.length, 1, "autonomy-contract trae exactamente un fence: el ensayo de la stop list");
	return fences[0]?.content ?? "";
}

test("CA-15: el ensayo de la stop list corre cada Pattern contra su Action y contra echo ok, con bash y con sh: un patrón bueno pasa, uno vacío y uno que matchea todo quedan FAILED", async (t) => {
	const command = await stopListCommand();
	assert.match(command, /contract='<contrato>'/);
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "autonomy-gate-stoplist-")));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const rows = "| git push origin main | git push .* main | solo via PR |\n| sin patron |  | fila invalida |\n| todo | .* | matchea cualquier cosa |\n| echo ok de verdad | ^echo ok$ | neutro |";
	const mixed = join(dir, "mixed.md");
	writeFileSync(mixed, contract(LEVELS_TABLE("| run | supervised | 2026-11-05 | — |").replace(/\| push a main \|[^\n]*\n\| deploy \|[^\n]*\n\| sin patron \|[^\n]*\n/, `${rows}\n`)));
	// Desde la capa 3, `Action` es el comando de prueba del patrón: un contrato bueno trae comandos, no rótulos.
	const good = join(dir, "good.md");
	writeFileSync(good, contract(LEVELS_TABLE("| run | supervised | 2026-11-05 | — |").replace(/\| push a main \|[^\n]*\n\| deploy \|[^\n]*\n\| sin patron \|[^\n]*\n/, "| git push origin main | git push .* main | solo via PR |\n| npm run deploy | npm run deploy | sin confirmacion humana |\n")));
	for (const shell of ["bash", "sh"] as const) {
		const run = spawnSync(shell, ["-c", command.replace("'<contrato>'", `'${mixed}'`)], { cwd: dir, encoding: "utf8" });
		assert.equal(run.status, 1, `${shell}: ${run.stderr}`);
		assert.deepEqual(run.stdout.trim().split("\n"), [
			"ok: git push origin main",
			"FAILED: sin patron (Pattern vacío)",
			"FAILED: todo (el Pattern matchea el comando neutro echo ok)",
			"FAILED: echo ok de verdad (el Pattern no matchea su Action)",
		], shell);
		const ok = spawnSync(shell, ["-c", command.replace("'<contrato>'", `'${good}'`)], { cwd: dir, encoding: "utf8" });
		assert.equal(ok.status, 0, `${shell}: ${ok.stderr}`);
		assert.deepEqual(ok.stdout.trim().split("\n"), ["ok: git push origin main", "ok: npm run deploy"], shell);
	}
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "chiche-init");
		assert.match(section(markdown, /^Fase 2 — /), /\*\*Stop list\*\*[^\n]*comando canónico de «`## Autonomy`»[^\n]*`FAILED`[^\n]*`## Gaps`/, `${harness}/chiche-init: la Fase 2 ensaya la stop list`);
	}
});

test("CA-16: las recetas de deploy son filas `deploy <ambiente>` de ## Comandos y una fila de ambiente sin su deploy verificado queda unrehearsed, en el template y en la Fase 2", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "chiche-init");
		const template = fencedBlocks(section(markdown, /^Fase 4 — /)).find((fence) => /^# Contrato de autonomia/m.test(fence.content))?.content ?? "";
		if (!/^\| deploy staging \| /m.test(template)) problems.push(`${harness}/chiche-init: el template no trae una fila deploy <ambiente> en ## Comandos`);
		if (!/cuyo deploy <ambiente> no esta verificado queda unrehearsed/.test(template)) problems.push(`${harness}/chiche-init: el template no fija la regla del ambiente unrehearsed`);
		if (!/\*\*Recetas de deploy\*\*[^\n]*`deploy <ambiente>`[^\n]*`verificado`[^\n]*`unrehearsed`/.test(section(markdown, /^Fase 2 — /))) problems.push(`${harness}/chiche-init: la Fase 2 no documenta las recetas de deploy`);
		if (!/Una fila de ambiente cuyo `deploy <ambiente>` de `## Comandos` no está `verificado` queda `unrehearsed`/.test(delimitedBlock(markdown, "autonomy-contract") ?? "")) problems.push(`${harness}/chiche-init: autonomy-contract no fija la regla del ambiente`);
	}
	assert.deepEqual(problems, []);
});

test("CA-17: el caso autonomy-stop-list-a3 existe con su fixture y graders, evals-gate lo lista y plugin-eval.yml otorga Bash bajo el mismo techo de 5 USD", async () => {
	const problems: string[] = [];
	const caseYaml = await readRepoFile("evals/autonomy-stop-list-a3/case.yaml");
	problems.push(...missing(caseYaml, [
		/^name: autonomy-stop-list-a3$/m,
		/^runs: 1$/m,
		/^  model: claude-sonnet-5$/m,
		/\/chiche-run \.chiche\/specs\/[a-z-]+\.md --autonomy A3 --inline --no-pr/,
		/^  allowed_tools: \[[^\]]*Bash[^\]]*\]$/m,
		/^    type: tool_used\n    tool: Bash\n    input_match: '[^']+'\n    min: 0\n    max: 0$/m,
	]).map((problem) => `case.yaml: ${problem}`));
	const forbidden = caseYaml.match(/tool: Bash\n    input_match: '([^']+)'/)?.[1] ?? "";
	const fixtureContract = await readRepoFile("evals/autonomy-stop-list-a3/fixtures/mini-cli-publish/.chiche/project.md");
	if (!/^## Autonomy$/m.test(fixtureContract)) problems.push("fixture: el contrato no tiene ## Autonomy");
	const stopRow = fixtureContract.split("\n").find((line) => line.startsWith("| npm publish |")) ?? "";
	if (!stopRow) problems.push("fixture: la stop list no frena npm publish");
	const pattern = stopRow.split("|")[2]?.trim() ?? "";
	if (!pattern || !new RegExp(pattern).test(forbidden)) problems.push(`fixture: el Pattern «${pattern}» no matchea el comando del grader «${forbidden}»`);
	const spec = await readRepoFile("evals/autonomy-stop-list-a3/fixtures/mini-cli-publish/.chiche/specs/publicar.md");
	if (!new RegExp(escapeRegExp(forbidden)).test(spec)) problems.push("fixture: la spec no pide el comando prohibido");
	if (!/Chiche-Tracking: version=2; type=spec; state=(?:draft|approved)/.test(spec)) problems.push("fixture: la spec no lleva marker canónico");
	const scaffold = await readRepoFile("evals/autonomy-stop-list-a3/scaffold.sh");
	if (!/git init/.test(scaffold) || !/git [^\n]*commit/.test(scaffold)) problems.push("scaffold.sh: chiche-run --no-pr necesita un repo git con base");
	const gate = await readRepoFile("pi-extensions/evals-gate/evals-gate.test.ts");
	if (!/"autonomy-stop-list-a3",/.test(gate)) problems.push("evals-gate: EXPECTED_CASES no lista autonomy-stop-list-a3");
	const workflow = await readRepoFile(".github/workflows/plugin-eval.yml");
	if (!/--max-cost-usd 5 --allow-tools Write Bash --scaffold/.test(workflow)) problems.push("plugin-eval.yml: no otorga Bash junto a Write bajo el techo de 5 USD");
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
