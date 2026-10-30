// Gate anti-drift del log de eventos SDD (issue #93, CA-8 a CA-12).
//
// grill, sdd-spec, sdd-run y sdd-land registran sus transiciones en
// <git-common-dir>/chiche/events.jsonl con el formato events-v1
// (docs/sdd-events-v1.md); los lectores suman el <git-common-dir>/sdd/events.jsonl
// previo (issue #103, CA-4). Este gate lee los 16 SKILL.md reales: exige el
// bloque `sdd-events` idéntico byte a byte, el literal del harness fuera del
// bloque y cada evento en su punto de transición. Además corre con bash y con
// sh el comando canónico del bloque en repos git temporales y valida la línea
// con parseSddEventLine. Es solo-tests (sin index.ts), como sdd-land-gate y
// design-gate. Que un agente siga la doctrina en una sesión real es prueba
// humana (CA-13).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Harness } from "../harness-gate/interaction.ts";
import { HARNESSES, escapeRegExp, fencedBlocks, firstDifference } from "../harness-gate/interaction.ts";
import { parseSddEventLine, readSddEvents, serializeSddEvent, type SddEvent } from "../sdd-artifacts/sdd-events.ts";

const SKILLS = ["grill", "sdd-spec", "sdd-run", "sdd-land"] as const;
type Skill = (typeof SKILLS)[number];

const HARNESS_LABELS: Record<Harness, string> = {
	claude: "Claude Code",
	codex: "Codex",
	opencode: "opencode",
	pi: "Pi",
	antigravity: "Google Antigravity",
};

const PLACEHOLDERS = ["harness", "event", "issue", "spec", "previous", "grill", "pr", "reason"] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];
const PLACEHOLDER_TOKENS: Record<Placeholder, string> = {
	harness: "'<harness>'",
	event: "'<evento>'",
	issue: "'<issue>'",
	spec: "'<spec>'",
	previous: "'<previous>'",
	grill: "'<grill>'",
	pr: "'<prs>'",
	reason: "'<reason>'",
};

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

// Sección que abre el primer heading (de cualquier nivel) que cumple `heading`
// y termina en el siguiente heading de su nivel o superior. Ignora los
// headings dentro de fences, que son templates y no estructura.
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

async function skillFile(harness: Harness, skill: Skill): Promise<string> {
	return readRepoFile(`${harness}/${skill}/SKILL.md`);
}

// Los bloques tal cual, sin normalizar: el comando es ejecutable y tiene que
// ser el mismo byte a byte en los 16 archivos.
async function eventBlocks(): Promise<{ blocks: Map<string, string>; problems: string[] }> {
	const blocks = new Map<string, string>();
	const problems: string[] = [];
	for (const skill of SKILLS) {
		for (const harness of HARNESSES) {
			const path = `${harness}/${skill}/SKILL.md`;
			const block = delimitedBlock(await skillFile(harness, skill), "sdd-events");
			if (block === null) {
				problems.push(`${path}: falta el bloque <!-- sdd-events:start/end -->`);
				continue;
			}
			blocks.set(path, block);
		}
	}
	return { blocks, problems };
}

async function referenceBlock(): Promise<string> {
	const block = delimitedBlock(await skillFile("claude", "grill"), "sdd-events");
	assert.ok(block, "claude/grill trae el bloque sdd-events");
	return block;
}

async function canonicalCommand(): Promise<string> {
	const fences = fencedBlocks(await referenceBlock());
	assert.equal(fences.length, 1, "el bloque trae exactamente un fence: el comando canónico");
	return fences[0]?.content ?? "";
}

function missing(text: string, patterns: RegExp[]): string[] {
	return patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `falta ${pattern}`);
}

// ---------------------------------------------------------------------------
// CA-8: bloque compartido y literal del harness

test("CA-8: el bloque sdd-events está en los 20 SKILL.md y es idéntico byte a byte", async () => {
	const { blocks, problems } = await eventBlocks();
	const reference = blocks.get("claude/grill/SKILL.md") ?? "";
	for (const [path, block] of blocks) {
		if (block !== reference) problems.push(`claude/grill vs ${path}: ${firstDifference(reference, block)}`);
	}
	assert.deepEqual(problems, []);
	assert.equal(blocks.size, 20);
});

test("CA-8: el bloque trae el puntero al formato, el comando canónico, la regla best-effort y la prohibición del working tree", async () => {
	const block = await referenceBlock();
	assert.deepEqual(missing(block, [
		/`docs\/sdd-events-v1\.md`/,
		/`<git-common-dir>\/chiche\/events\.jsonl`/,
		/El log se escribe en `<git-common-dir>\/chiche\/`/,
		/Un fallo del append nunca frena ni hace fallar el skill/,
		/termina con exit 0/,
		/el reporte del skill lo nombra en una línea/,
		/nunca dentro del working tree/,
		/sin caer a `\.sdd\/`/,
		/`previous` es `none` salvo en `spec\.moved`/,
		/\*\*Validación barata\.\*\*[^\n]*un valor inválido cae en el mismo aviso y no escribe nada/,
	]), []);
	const command = await canonicalCommand();
	assert.match(command, /git rev-parse --path-format=absolute --git-common-dir/);
	assert.match(command, /mkdir -p "\$dir\/chiche" &&/);
	assert.match(command, />> "\$dir\/chiche\/events\.jsonl"/);
	assert.doesNotMatch(block, /\/sdd\//, "el bloque no nombra el lugar sdd/ del common-dir");
	assert.match(command, /date -u \+%Y-%m-%dT%H:%M:%SZ/);
	assert.match(command, /\bok && dir=\$\(git rev-parse/, "la validación corre antes de resolver el common-dir y del append");
	for (const placeholder of PLACEHOLDERS) {
		const token = PLACEHOLDER_TOKENS[placeholder];
		assert.equal(command.split(token).length - 1, 1, `${token} aparece una sola vez en el comando`);
	}
	assert.doesNotMatch(block, /`(?:claude|codex|opencode|pi|antigravity)`|harness='(?:claude|codex|opencode|pi|antigravity)'/, "el literal del harness no vive en el bloque");
});

test("CA-8: el literal del harness va fuera del bloque, en una sola línea por archivo", async () => {
	const problems: string[] = [];
	const linePattern = /^En (Claude Code|Codex|opencode|Pi|Google Antigravity), `<harness>` es `([a-z]+)`\.$/gm;
	for (const skill of SKILLS) {
		for (const harness of HARNESSES) {
			const path = `${harness}/${skill}/SKILL.md`;
			const outside = withoutBlock(await skillFile(harness, skill), "sdd-events");
			const lines = [...outside.matchAll(linePattern)];
			if (lines.length !== 1) {
				problems.push(`${path}: ${lines.length} líneas de harness (se espera 1)`);
				continue;
			}
			const [, label, literal] = lines[0] ?? [];
			if (label !== HARNESS_LABELS[harness] || literal !== harness) {
				problems.push(`${path}: la línea dice ${label}/${literal}, se espera ${HARNESS_LABELS[harness]}/${harness}`);
			}
		}
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// CA-9: cada skill nombra su evento en su punto de transición

test("CA-9: grill registra grill.paused al pausar o guardar y grill.finalized al persistir el handoff final", async () => {
	const problems: string[] = [];
	for (const harness of ["claude", "codex", "opencode", "antigravity"] as const) {
		const markdown = await skillFile(harness, "grill");
		const persistence = section(markdown, /^Persistencia y reanudación$/);
		const closing = section(markdown, /^Cierre$/);
		if (!/pausa[^\n]*guarda[^\n]*`grill\.paused`|`grill\.paused`[^\n]*pausa/.test(persistence)) {
			problems.push(`${harness}/grill: «Persistencia y reanudación» no registra grill.paused al pausar o guardar`);
		}
		if (!/handoff `finalized`[^\n]*`grill\.finalized`/.test(closing)) {
			problems.push(`${harness}/grill: «Cierre» no registra grill.finalized al persistir el handoff final`);
		}
	}
	const pi = await skillFile("pi", "grill");
	if (!/`grill\.paused` y `grill\.finalized` los registra `grill_session`/.test(section(pi, /^Log de eventos$/))) {
		problems.push("pi/grill: «Log de eventos» no dice que grill_session registra los eventos");
	}
	if (!/este skill no corre el comando, ni lo repone a mano si la tool avisa/.test(section(pi, /^Log de eventos$/))) {
		problems.push("pi/grill: «Log de eventos» no prohíbe reponer el evento a mano");
	}
	if (!/la tool registra `grill\.paused`/.test(section(pi, /^Cancelación o pausa$/))) {
		problems.push("pi/grill: la pausa no dice que la tool registra grill.paused");
	}
	if (!/la tool registra `grill\.finalized`/.test(section(pi, /^Paso 3: persistencia final$/))) {
		problems.push("pi/grill: la persistencia final no dice que la tool registra grill.finalized");
	}
	assert.deepEqual(problems, []);
});

test("CA-9: sdd-spec registra spec.published con receipt, spec.approved en el menú y spec.superseded por predecesora", async () => {
	const problems: string[] = [];
	for (const harness of ["claude", "codex", "opencode", "antigravity"] as const) {
		const events = section(await skillFile(harness, "sdd-spec"), /^Log de eventos$/);
		problems.push(...missing(events, [
			/receipt de cada publicación/,
			/`spec\.published` cuando la spec queda `draft`/,
			/`spec\.approved` en la transición del menú a `aprobada` \(una republicación de una spec que ya estaba `aprobada` no lo registra\)/,
			/un `spec\.superseded` por cada predecesora/,
			/`Llevar a issue` registra antes un `spec\.moved`: `previous` es la ruta lógica `\.sdd\/specs\/<slug>\.md` que la spec tenía y `spec` el `#NN` nuevo/,
			/`issue` y `grill` son los del marker de cada documento publicado, sin codificar \(una predecesora lleva los suyos, no los de la sucesora\)/,
			/Una publicación sin receipt no registra nada/,
		]).map((problem) => `${harness}/sdd-spec: ${problem}`));
	}
	const pi = section(await skillFile("pi", "sdd-spec"), /^Log de eventos$/);
	problems.push(...missing(pi, [
		/`spec\.published`, `spec\.moved`, `spec\.approved` y `spec\.superseded` los registra `persist_sdd_spec`/,
		/`spec\.moved` al `Llevar a issue` y `spec\.approved` solo en la transición/,
		/este skill no corre el comando, ni lo repone a mano si la tool avisa/,
	]).map((problem) => `pi/sdd-spec: ${problem}`));
	assert.deepEqual(problems, []);
});

test("CA-9: sdd-run registra run.started, run.pr-opened, run.committed y run.failed en sus fases, y la Fase 6 no emite", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "sdd-run");
		const checks: Array<[string, string, RegExp]> = [
			["Fase 1", section(markdown, /^Fase 1 — /), /worktree y el branch[^\n]*`gh stack init`[^\n]*`run\.started`/],
			["Fase 5", section(markdown, /^Fase 5 — /), /`gh pr create`[^\n]*`gh stack submit`[^\n]*`run\.pr-opened`[^\n]*orden de capa/],
			["Fase 5", section(markdown, /^Fase 5 — /), /`--no-pr`[^\n]*`run\.committed`/],
			["Run interrumpido", section(markdown, /^Run interrumpido$/), /Al emitir `RUN INTERRUMPIDO` después de `run\.started`, registrar `run\.failed` con `reason=interrupted`[^\n]*antes de `run\.started` no se registra nada/],
			["Log de eventos", section(markdown, /^Log de eventos$/), /`run\.failed` con `reason=interrupted` en «Run interrumpido» si ya hubo `run\.started`/],
			["Log de eventos", section(markdown, /^Log de eventos$/), /abort posterior a `run\.started` registra `run\.failed` con `reason=aborted`/],
			["Log de eventos", section(markdown, /^Log de eventos$/), /La Fase 6 no registra eventos/],
		];
		for (const [where, text, pattern] of checks) {
			if (!pattern.test(text)) problems.push(`${harness}/sdd-run «${where}»: falta ${pattern}`);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-9: sdd-land registra un land.merged por cada PR cuyo merge verificó", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await skillFile(harness, "sdd-land");
		if (!/Por cada PR cuyo merge verificó, registrar un `land\.merged`/.test(section(markdown, /^Fase 3 — /))) {
			problems.push(`${harness}/sdd-land: la Fase 3 no registra land.merged por PR verificado`);
		}
		const events = section(markdown, /^Log de eventos$/);
		if (!/`--dry-run` y `--clean-only` no registran nada/.test(events)) {
			problems.push(`${harness}/sdd-land: «Log de eventos» no excluye --dry-run y --clean-only`);
		}
		if (!/en un stack, el issue del `Refs`\/`Closes` del stack para todos sus PRs: la línea `spec en #<PR>` nombra un PR, no un issue/.test(events)) {
			problems.push(`${harness}/sdd-land: «Log de eventos» no fija el issue de land.merged en un stack`);
		}
		if (!/Un PR que queda `en cola` al vencer `--wait` y que la cola mergea después no registra `land\.merged`/.test(events)) {
			problems.push(`${harness}/sdd-land: «Log de eventos» no documenta la pérdida del merge queue`);
		}
	}
	assert.deepEqual(problems, []);
});

test("CA-9 (review #95): en Codex, el append pide escalación desde el primer intento y sin permiso se saltea con el aviso", async () => {
	const problems: string[] = [];
	const escalation = /^En Codex, el sandbox por defecto deja `\.git\/` en solo lectura y el comando termina con exit 0 aunque el append falle: correrlo pidiendo escalación desde el primer intento; sin permiso, saltear el evento con el aviso, sin caer a `\.sdd\/`\.$/m;
	for (const skill of SKILLS) {
		for (const harness of HARNESSES) {
			const outside = withoutBlock(await skillFile(harness, skill), "sdd-events");
			const has = escalation.test(outside);
			if (harness === "codex" && !has) problems.push(`codex/${skill}/SKILL.md: falta la escalación del append`);
			if (harness !== "codex" && has) problems.push(`${harness}/${skill}/SKILL.md: la escalación del append es solo de Codex`);
		}
	}
	const doc = await readRepoFile("docs/harness-interaction-differences.md");
	if (!/^En Codex, el sandbox por defecto[^\n]*El append del log de eventos \(`<git-common-dir>\/chiche\/events\.jsonl`\) de `grill`, `sdd-spec`, `sdd-run` y `sdd-land` también pide escalación en Codex, desde el primer intento[^\n]*sin permiso, el evento se saltea con el aviso y nunca cae a `\.sdd\/`/m.test(doc)) {
		problems.push("docs/harness-interaction-differences.md: falta el append del log de eventos (con sdd-land) en la diferencia de Codex");
	}
	assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// CA-10: el comando canónico, ejecutado con bash

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-c", "user.name=sdd", "-c", "user.email=sdd@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

function repoWithLinkedWorktree(name: string): { base: string; main: string; linked: string; common: string } {
	const base = realpathSync(mkdtempSync(join(tmpdir(), `events-gate-${name}-`)));
	const main = join(base, "repo");
	mkdirSync(main);
	git(main, "init", "-q", "-b", "main");
	git(main, "commit", "-q", "--allow-empty", "-m", "init");
	const linked = join(base, "repo-wt");
	git(main, "worktree", "add", "-q", "-b", "feature", linked);
	return { base, main, linked, common: join(main, ".git") };
}

function runCommand(
	command: string,
	cwd: string,
	values: Record<Placeholder, string>,
	options: { shell?: "bash" | "sh"; env?: Record<string, string> } = {},
): { status: number | null; stderr: string } {
	let script = command;
	for (const placeholder of PLACEHOLDERS) {
		script = script.replace(PLACEHOLDER_TOKENS[placeholder], `'${values[placeholder]}'`);
	}
	const env = { ...process.env, ...options.env };
	for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
	const result = spawnSync(options.shell ?? "bash", ["-c", script], { cwd, encoding: "utf8", env });
	return { status: result.status, stderr: result.stderr };
}

function logBytes(common: string): string | null {
	const path = join(common, "chiche", "events.jsonl");
	return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function logLines(common: string): string[] {
	const content = readFileSync(join(common, "chiche", "events.jsonl"), "utf8");
	assert.ok(content.endsWith("\n"), "termina en LF");
	return content.slice(0, -1).split("\n");
}

function status(cwd: string): string {
	return git(cwd, "status", "--porcelain", "--untracked-files=all");
}

const STARTED: Record<Placeholder, string> = {
	harness: "claude",
	event: "run.started",
	issue: "#93",
	spec: "#93",
	previous: "none",
	grill: "session 9/á",
	pr: "",
	reason: "none",
};

test("CA-10: el comando agrega una línea válida, también desde un worktree enlazado, y deja git status vacío", async (t) => {
	const command = await canonicalCommand();
	const { base, main, linked, common } = repoWithLinkedWorktree("append");
	t.after(() => rmSync(base, { recursive: true, force: true }));

	const first = runCommand(command, main, STARTED);
	assert.equal(first.status, 0, first.stderr);
	assert.equal(first.stderr, "", "sin aviso cuando el append funciona");
	const [line] = logLines(common);
	assert.match(line ?? "", /"spec":"%2393","previous":"none","grill":"session%209%2F%C3%A1"/, "el comando percent-encodea spec y grill");
	const parsed = parseSddEventLine(line ?? "");
	assert.equal(parsed.kind, "event", `${line}: ${JSON.stringify(parsed)}`);
	const { ts: _ts, ...fields } = (parsed as { kind: "event"; event: SddEvent }).event;
	assert.deepEqual(fields, { v: 1, harness: "claude", event: "run.started", issue: "#93", spec: "#93", previous: null, grill: "session 9/á", pr: [], reason: null });

	const fromWorktree = runCommand(command, linked, {
		...STARTED,
		harness: "codex",
		event: "run.pr-opened",
		grill: "none",
		pr: "101,102",
	});
	assert.equal(fromWorktree.status, 0, fromWorktree.stderr);
	const lines = logLines(common);
	assert.equal(lines.length, 2, "el worktree enlazado escribe en el mismo events.jsonl del common-dir");
	const second = parseSddEventLine(lines[1] ?? "");
	assert.equal(second.kind, "event", lines[1]);
	assert.deepEqual(second.kind === "event" ? second.event.pr : [], [101, 102]);
	assert.equal(existsSync(join(common, "worktrees", "repo-wt", "chiche")), false, "nada en el gitdir del worktree");
	assert.equal(existsSync(join(common, "sdd")), false, "nada en sdd/ del common-dir");

	assert.equal(status(main), "", "checkout principal limpio");
	assert.equal(status(linked), "", "worktree enlazado limpio");
});

test("CA-10: con el destino no escribible o fuera de git, el comando termina con exit 0 y avisa por stderr", async (t) => {
	const command = await canonicalCommand();
	const { base, main, linked, common } = repoWithLinkedWorktree("blocked");
	const outside = realpathSync(mkdtempSync(join(tmpdir(), "events-gate-outside-")));
	t.after(() => {
		rmSync(base, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});
	mkdirSync(join(common, "chiche", "events.jsonl"), { recursive: true });

	const blocked = runCommand(command, main, STARTED);
	assert.equal(blocked.status, 0, "exit 0 aunque el append falle");
	assert.match(blocked.stderr, /aviso: no se registró el evento SDD run\.started/);
	assert.ok(statSync(join(common, "chiche", "events.jsonl")).isDirectory());
	assert.deepEqual(readdirSync(join(common, "chiche", "events.jsonl")), []);
	assert.equal(existsSync(join(common, "sdd")), false, "sin caer a sdd/ del common-dir");
	assert.equal(status(main), "", "sin caer al working tree");
	assert.equal(status(linked), "", "sin caer al working tree del worktree");

	const notGit = runCommand(command, outside, STARTED);
	assert.equal(notGit.status, 0);
	assert.match(notGit.stderr, /aviso: no se registró el evento SDD run\.started/);
	assert.deepEqual(readdirSync(outside), [], "fuera de git no escribe nada");
});

test("CA-10 (review #95): spec.moved lleva previous codificado y la línea es válida, con bash y con sh", async (t) => {
	const command = await canonicalCommand();
	const { base, main, common } = repoWithLinkedWorktree("moved");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const moved = { ...STARTED, harness: "codex", event: "spec.moved", previous: ".sdd/specs/llevar.md", grill: "none" };
	for (const shell of ["bash", "sh"] as const) {
		const run = runCommand(command, main, moved, { shell });
		assert.equal(run.status, 0, `${shell}: ${run.stderr}`);
		assert.equal(run.stderr, "", `${shell}: sin aviso`);
	}
	const lines = logLines(common);
	assert.equal(lines.length, 2);
	assert.equal(lines[0]?.replace(/"ts":"[^"]*"/, ""), lines[1]?.replace(/"ts":"[^"]*"/, ""), "bash y sh escriben la misma línea");
	assert.match(lines[0] ?? "", /"spec":"%2393","previous":".sdd%2Fspecs%2Fllevar.md","grill":"none"/);
	const parsed = parseSddEventLine(lines[0] ?? "");
	assert.equal(parsed.kind, "event", `${lines[0]}: ${JSON.stringify(parsed)}`);
	assert.equal(parsed.kind === "event" ? parsed.event.previous : "", ".sdd/specs/llevar.md");
});

test("CA-10 (review #95): un valor inválido cae en el aviso con exit 0 y no escribe nada, con bash y con sh", async (t) => {
	const command = await canonicalCommand();
	const { base, main, common } = repoWithLinkedWorktree("invalid");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const cases: Array<[string, Partial<Record<Placeholder, string>>]> = [
		["issue sin #", { issue: "93" }],
		["issue con espacio", { issue: "# 93" }],
		["land.merged con pr vacío", { event: "land.merged", spec: "none", pr: "" }],
		["land.merged con dos pr", { event: "land.merged", spec: "none", pr: "101,102" }],
		["pr con espacio", { event: "run.pr-opened", pr: "101, 102" }],
		["pr con cero a la izquierda", { event: "run.pr-opened", pr: "0101" }],
		["spec.published con spec=none", { event: "spec.published", spec: "none" }],
		["spec vacío", { spec: "" }],
		["grill vacío", { grill: "" }],
		["placeholder de grill sin reemplazar", { grill: "<grill>" }],
		["placeholder de slug sin reemplazar", { spec: ".sdd/specs/<slug>.md" }],
		["evento fuera del catálogo", { event: "run.merged" }],
		["harness desconocido", { harness: "cursor" }],
		["spec.moved sin previous", { event: "spec.moved" }],
		["previous en un evento que no es spec.moved", { previous: ".sdd/specs/x.md" }],
		["run.failed sin reason", { event: "run.failed" }],
		["reason en un evento que no es run.failed", { reason: "aborted" }],
		["grill.paused sin grill", { event: "grill.paused", spec: "none", grill: "none" }],
		["run.pr-opened sin pr", { event: "run.pr-opened" }],
	];
	const problems: string[] = [];
	for (const shell of ["bash", "sh"] as const) {
		for (const [name, overrides] of cases) {
			const run = runCommand(command, main, { ...STARTED, ...overrides }, { shell });
			if (run.status !== 0) problems.push(`${shell} ${name}: exit ${run.status}`);
			if (!/aviso: no se registró el evento SDD/.test(run.stderr)) problems.push(`${shell} ${name}: sin aviso (${run.stderr})`);
			const written = logBytes(common);
			if (written !== null && written !== "") problems.push(`${shell} ${name}: escribió ${JSON.stringify(written)}`);
		}
	}
	assert.deepEqual(problems, []);
	assert.equal(existsSync(join(common, "sdd")), false, "nada en sdd/ del common-dir");
	assert.equal(status(main), "", "sin caer al working tree");
});

test("CA-10 (review #95): la guarda de 1024 bytes, con LC_ALL=C, cuenta bytes: el borde se escribe y un byte más no", async (t) => {
	const command = await canonicalCommand();
	const { base, main, common } = repoWithLinkedWorktree("guard");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	// Un entorno UTF-8: sin el `export LC_ALL=C` del comando, `á` contaría como un
	// carácter y enc() lo codificaría mal.
	const env = { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
	const event = (spec: string): Record<Placeholder, string> => ({ ...STARTED, spec, grill: "none" });
	const lineBytes = (spec: string) => {
		const serialized = serializeSddEvent({ v: 1, ts: "2026-10-14T00:00:00Z", harness: "claude", event: "run.started", issue: "#93", spec, previous: null, grill: null, pr: [], reason: null });
		return serialized.ok ? Buffer.byteLength(serialized.line, "utf8") : Number.NaN;
	};
	const accents = "á".repeat(100);
	const padding = 1023 - lineBytes(accents);
	assert.ok(padding > 0);
	const border = `${accents}${"x".repeat(padding)}`;
	assert.equal(lineBytes(border), 1023, "línea de 1023 bytes más su LF: 1024");
	const over = `${border}x`;

	const tooLong = runCommand(command, main, event("á".repeat(340)), { env });
	assert.equal(tooLong.status, 0);
	assert.match(tooLong.stderr, /aviso: no se registró el evento SDD run\.started/);
	assert.equal(logBytes(common), null, "una línea de unos 2000 bytes no escribe ningún byte");

	const atBorder = runCommand(command, main, event(border), { env });
	assert.equal(atBorder.status, 0, atBorder.stderr);
	assert.equal(atBorder.stderr, "", "el borde se escribe sin aviso");
	const [line] = logLines(common);
	assert.equal(Buffer.byteLength(`${line}\n`, "utf8"), 1024);
	const parsed = parseSddEventLine(line ?? "");
	assert.equal(parsed.kind, "event", JSON.stringify(parsed));
	assert.equal(parsed.kind === "event" ? parsed.event.spec : "", border);

	const overBorder = runCommand(command, main, event(over), { env });
	assert.equal(overBorder.status, 0);
	assert.match(overBorder.stderr, /aviso: no se registró el evento SDD run\.started/);
	assert.equal(logLines(common).length, 1, "un byte más no agrega la línea");
});

test("CA-4 (#103): la lectura une el chiche/events.jsonl del comando con un sdd/events.jsonl previo, ordenada por ts", async (t) => {
	const command = await canonicalCommand();
	const { base, main, linked, common } = repoWithLinkedWorktree("read-both");
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const legacy = (ts: string, event: Partial<SddEvent>): string => {
		const serialized = serializeSddEvent({ v: 1, ts, harness: "pi", event: "run.started", issue: "#93", spec: "#93", previous: null, grill: null, pr: [], reason: null, ...event });
		assert.ok(serialized.ok);
		return serialized.line;
	};
	// El log previo al renombre: uno anterior y uno posterior a cualquier `date` real.
	mkdirSync(join(common, "sdd"));
	const before = legacy("2000-01-01T00:00:00Z", {});
	const after = legacy("9999-12-31T23:59:59Z", { event: "run.committed" });
	writeFileSync(join(common, "sdd", "events.jsonl"), `${before}\n${after}\n`, "utf8");

	const run = runCommand(command, linked, { ...STARTED, event: "run.pr-opened", grill: "none", pr: "101" });
	assert.equal(run.status, 0, run.stderr);
	assert.equal(run.stderr, "");
	assert.equal(logLines(common).length, 1, "el append va a chiche/events.jsonl");
	assert.equal(readFileSync(join(common, "sdd", "events.jsonl"), "utf8"), `${before}\n${after}\n`, "sdd/events.jsonl queda intacto");

	for (const cwd of [main, linked]) {
		const events = await readSddEvents(cwd);
		assert.deepEqual(events.map((event) => `${event.harness} ${event.event}`), ["pi run.started", "claude run.pr-opened", "pi run.committed"], cwd);
		assert.deepEqual(events.map((event) => event.ts), [...events.map((event) => event.ts)].sort(), "ordenados por ts");
	}
	assert.equal(status(main), "", "checkout principal limpio");
	assert.equal(status(linked), "", "worktree enlazado limpio");
});

// ---------------------------------------------------------------------------
// CA-11 y CA-12: gate solo-tests y cableado del contrato

test("CA-11: events-gate es solo-tests y el package sigue con 11 extensiones", async () => {
	assert.equal(existsSync(repoPath("pi-extensions/events-gate/index.ts")), false, "sin index.ts");
	const manifest = JSON.parse(await readRepoFile("package.json")) as { pi: { extensions: string[] } };
	assert.equal(manifest.pi.extensions.length, 11);
	assert.ok(manifest.pi.extensions.every((path) => !path.includes("events-gate")));
});

test("CA-12: el contrato suma la fila del gate de eventos con el conteo real de este archivo", async () => {
	const contract = await readRepoFile(".sdd/project.md");
	const commands = section(contract, /^Comandos$/);
	const own = await readFile(new URL(import.meta.url), "utf8");
	const count = own.match(/^test\(/gm)?.length ?? 0;
	const row = commands.match(/^\| gate de eventos SDD \| `node --test pi-extensions\/events-gate\/events-gate\.test\.ts` \| raiz \| verificado \d{4}-\d{2}-\d{2} \| [^|]+ \| (\d+)\/(\d+);/m);
	assert.ok(row, "fila `gate de eventos SDD` con comando, cwd, fecha y conteo");
	const fullRow = commands.split("\n").find((line) => line.startsWith("| gate de eventos SDD |")) ?? "";
	assert.match(fullRow, /idéntico byte a byte/, "la fila promete la igualdad estricta que el gate prueba");
	assert.doesNotMatch(fullRow, /tras normalizar/);
	assert.equal(Number(row[1]), count, "pasan todos los tests del gate");
	assert.equal(Number(row[2]), count, "el conteo de la fila es el de este archivo");
});
