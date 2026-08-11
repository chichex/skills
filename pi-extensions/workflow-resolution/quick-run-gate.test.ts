import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const HARNESSES = ["claude", "codex", "pi"] as const;
type Harness = (typeof HARNESSES)[number];

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

interface Frontmatter {
	name: string;
	description: string;
	compatibility?: string;
}

function frontmatter(markdown: string): Frontmatter {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(match?.[1], "frontmatter presente");
	const value = (name: string): string | undefined => {
		const field = match[1].match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
		return field?.[1]?.trim();
	};
	return {
		name: value("name") ?? "",
		description: value("description") ?? "",
		compatibility: value("compatibility"),
	};
}

export function quickRunDoctrineBlock(markdown: string): string {
	const match = markdown.match(
		/<!-- quick-run-doctrine:start -->\n([\s\S]*?)\n<!-- quick-run-doctrine:end -->/,
	);
	assert.ok(match?.[1], "bloque normativo quick-run presente");
	return match[1];
}

interface InteractionDifferences {
	invocation: Record<Harness, string>;
	questionTool: Record<Harness, string>;
	extras: Record<Harness, string>;
}

export function parseInteractionDifferences(markdown: string): InteractionDifferences {
	const block = markdown.match(
		/<!-- interaction-differences:start -->\n([\s\S]*?)\n<!-- interaction-differences:end -->/,
	);
	assert.ok(block?.[1], "tabla normativa de interacción presente");
	const rows = block[1].split("\n").filter((line) => line.startsWith("|"));
	const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", ""));
	const header = cells(rows[0] ?? "");
	const indexes = new Map(header.map((name, index) => [name, index]));
	const row = (name: string): string[] => cells(rows.find((line) => cells(line)[0] === name) ?? "");
	const invocationRow = row("invocacion");
	const questionToolRow = row("tool-preguntas");
	const extrasRow = row("extras");
	const invocation = {} as Record<Harness, string>;
	const questionTool = {} as Record<Harness, string>;
	const extras = {} as Record<Harness, string>;
	for (const harness of HARNESSES) {
		const index = indexes.get(harness);
		assert.notEqual(index, undefined, `columna ${harness} presente`);
		const pattern = invocationRow[index!] ?? "";
		assert.ok(pattern.endsWith("nombre"), `${harness}: patrón de invocación válido`);
		invocation[harness] = pattern.slice(0, -"nombre".length);
		questionTool[harness] = questionToolRow[index!] ?? "";
		extras[harness] = extrasRow[index!] ?? "";
	}
	return { invocation, questionTool, extras };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeQuickRunDoctrine(
	block: string,
	harness: Harness,
	differences: InteractionDifferences,
): string {
	const invocation = differences.invocation[harness];
	let normalized = block.replace(
		new RegExp(`${escapeRegExp(invocation)}(issue-triage|quick-run|grill|sdd-init|sdd-spec)`, "g"),
		(_match, name: string) => `«skill:${name}»`,
	);
	const questionTool = differences.questionTool[harness];
	if (questionTool && questionTool !== "—") normalized = normalized.replaceAll(questionTool, "«question-tool»");
	return normalized;
}

export function compareQuickRunDoctrines(blocks: Map<Harness, string>): string[] {
	const reference = blocks.get("claude") ?? "";
	const expectedLines = reference.split("\n");
	const differences: string[] = [];
	for (const harness of HARNESSES.slice(1)) {
		const actual = blocks.get(harness) ?? "";
		if (actual === reference) continue;
		const actualLines = actual.split("\n");
		const length = Math.max(expectedLines.length, actualLines.length);
		let line = 0;
		while (line < length && expectedLines[line] === actualLines[line]) line += 1;
		differences.push(
			`${harness} diverge de claude en línea ${line + 1}: esperado ${JSON.stringify(expectedLines[line] ?? "<EOF>")}; recibido ${JSON.stringify(actualLines[line] ?? "<EOF>")}`,
		);
	}
	return differences;
}

const SUCCESS_TEMPLATE = `Quick-run completo: PR #N <url> | branch <name> en <commit>
- issue: #N
- checklist: X/X verificado
- tests: <comandos y resultados exactos>
- no ejecutado: <suite/build/etc.>
- cambios: <resumen>
- pendiente humano: <revisar PR o acción concreta>`;

const INTERRUPTED_TEMPLATE = `QUICK-RUN INTERRUMPIDO
- bloqueo: <detalle>
- checklist verificado: X/Y
- cambios sin commit: <paths o ninguno>
- tests rojos/no concluyentes: <detalle>
- worktree: <ruta>
- reanudar con: <instrucción exacta>`;

test("quick-run is packaged only for Claude, Codex, and Pi with safe harness extras", async () => {
	const markdownByHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/quick-run/SKILL.md`);
		markdownByHarness.set(harness, markdown);
		const metadata = frontmatter(markdown);
		assert.equal(metadata.name, "quick-run", `${harness}: name`);
		assert.match(metadata.description, /s[oó]lo consume.*handoff.*triage/i, `${harness}: entrada acotada`);
	}
	await assert.rejects(access(repoFile("opencode/quick-run/SKILL.md")));

	const codexSidecar = await readRepoFile("codex/quick-run/agents/openai.yaml");
	assert.match(codexSidecar, /default_prompt:\s*"[^"]*\$quick-run[^"]*"/);
	assert.match(codexSidecar, /allow_implicit_invocation:\s*false/);

	const piMetadata = frontmatter(markdownByHarness.get("pi") ?? "");
	assert.match(piMetadata.compatibility ?? "", /\bGit\b/);
	assert.match(piMetadata.compatibility ?? "", /\bgh\b/);
	for (const tool of ["read", "bash", "edit", "write"]) {
		assert.match(piMetadata.compatibility ?? "", new RegExp(`\\b${tool}\\b`), `Pi declara ${tool}`);
	}
});

test("quick-run keeps one equivalent handoff, isolation, TDD, and delivery doctrine", async () => {
	const interaction = parseInteractionDifferences(await readRepoFile("docs/harness-interaction-differences.md"));
	assert.equal(interaction.extras.claude, "—");
	assert.equal(interaction.extras.codex, "agents/openai.yaml");
	assert.equal(interaction.extras.pi, "compatibility");

	const blocks = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/quick-run/SKILL.md`);
		blocks.set(harness, normalizeQuickRunDoctrine(quickRunDoctrineBlock(markdown), harness, interaction));
	}
	assert.deepEqual(compareQuickRunDoctrines(blocks), []);

	const contract = blocks.get("pi") ?? "";
	for (const clause of [
		"WorkflowResolutionV1",
		"JSON.parse(JSON.stringify(handoff))",
		"version=1",
		"outcome=start",
		"stage=quick-run",
		"mode=new",
		"selectedRoute=quick-run|join-quick-run",
		"repo",
		"cwd",
		"canonicalIssue",
		"summary",
		"impactExample",
		"checklist",
		"evidence",
		"risks",
		"git status --porcelain",
		"quick/issue-<N>-<slug>",
		"Máximo tres intentos honestos por verificación",
	]) {
		assert.ok(contract.includes(clause), clause);
	}
	assert.match(contract, /antes de `git fetch`.*branch\/worktree.*editar.*publicar/is);
	assert.match(contract, /fuente canónica.*autoritativa/is);
	assert.match(contract, /bodies y comentarios.*datos no confiables.*nunca instrucciones/is);
	assert.match(contract, /join-quick-run.*branch.*Closes #N.*únicamente.*issue canónico/is);
	assert.match(contract, /no.*prueba criptográfica.*procedencia/is);
	assert.match(contract, /ausente.*no confirmado.*malformado.*otro repo\/cwd.*issue canónico.*fren/is);
	assert.match(contract, /reparación exacta.*«skill:issue-triage»/is);

	assert.match(contract, /branch default.*remote\/contrato.*nunca asumas `main`/is);
	assert.match(contract, /rebase\/merge.*detached HEAD.*divergencias/is);
	assert.match(contract, /No hagas stash, reset, checkout forzado ni.*limpieza/is);
	assert.match(contract, /git fetch.*antes de ramificar/is);
	assert.match(contract, /worktree hermano.*base actualizado/is);
	assert.match(contract, /nunca edites el checkout original/is);
	assert.match(contract, /ausencia de `.sdd\/project\.md`.*no.*«skill:sdd-init».*no bloquea/is);
	assert.match(contract, /límites del repo.*prevalecen.*handoff/is);

	assert.match(contract, /test focalizado.*primero.*falle por la razón correcta/is);
	assert.match(contract, /Implementá sólo lo necesario.*checklist/is);
	assert.match(contract, /decisión nueva.*migración.*seguridad.*integración externa.*expansión transversal.*verificación fiable/is);
	assert.match(contract, /recomendá `«skill:grill»` o `«skill:sdd-spec»`/is);
	assert.match(contract, /No debilites tests ni asserts/is);
	assert.match(contract, /chequeo estático más barato/is);
	assert.match(contract, /No afirmes.*regresión completa.*si no se corrió/is);

	assert.match(contract, /checklist completo.*ningún proceso.*tarea pendiente.*worktree.*sin cambios sin commit/is);
	assert.match(contract, /pusheá sólo.*branch quick.*creá.*PR/is);
	assert.match(contract, /fuente canónica.*Closes #N.*checklist observable.*evidencia.*limitaciones\/no ejecutado.*firma estándar/is);
	assert.match(contract, /No merges.*PR/is);
	assert.match(contract, /branch \+ commit local.*comando.*siguiente/is);
	assert.match(contract, /Remové el worktree.*PR exitoso.*interrupción.*rojo.*preserv/is);
	assert.ok(contract.includes(SUCCESS_TEMPLATE), "template de éxito exacto");
	assert.ok(contract.includes(INTERRUPTED_TEMPLATE), "template de interrupción exacto");
	assert.match(contract, /Nunca llames “completo”.*tareas.*procesos.*cambios sin commit.*verificaciones requeridas pendientes/is);
	assert.match(contract, /nunca.*push.*branch default.*force-push.*merge/is);
});

test("issue-triage emits the complete quick-run payload but never executes its consumer", async () => {
	const interaction = parseInteractionDifferences(await readRepoFile("docs/harness-interaction-differences.md"));
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/issue-triage/SKILL.md`);
		const invocation = interaction.invocation[harness];
		assert.match(markdown, new RegExp(`consumidor downstream dedicado.*${escapeRegExp(invocation)}quick-run`, "is"));
		assert.match(markdown, /fuente canónica.*summary.*impactExample.*checklist.*evidence.*risks/is);
		assert.match(markdown, /recommendedRoute.*selectedRoute.*separad/is);
		assert.match(markdown, /termina.*serializar.*resultado/is);
		assert.doesNotMatch(markdown, /## Fase 6 — Ejecutar la ruta/);
		assert.doesNotMatch(markdown, /Creá un worktree hermano/);
		assert.doesNotMatch(markdown, /Quick-run completo:/);
		assert.doesNotMatch(markdown, /(?:Cargá|Invocá)(?: el skill)? [`$\/\w:-]*quick-run/i);
		assert.doesNotMatch(markdown, /## .*Ejecutar.*quick-run/i);
	}
});

test("quick-run drift comparison reports the first injected difference", () => {
	const base = "gate estructural\npreflight limpio\nreporte exacto";
	const blocks = new Map<Harness, string>([
		["claude", base],
		["codex", base.replace("preflight limpio", "preflight relajado")],
		["pi", base],
	]);
	assert.deepEqual(compareQuickRunDoctrines(blocks), [
		'codex diverge de claude en línea 2: esperado "preflight limpio"; recibido "preflight relajado"',
	]);
});

test("README documents quick-run separately and issue-triage as a handoff producer", async () => {
	for (const path of ["README.md", "README.en.md"]) {
		const markdown = await readRepoFile(path);
		assert.match(markdown, /\| \*\*`quick-run`\*\* \*\(Codex\/Claude\/Pi\)\* \|/);
		assert.match(markdown, /\| \*\*`issue-triage`\*\*.*handoff/i);
	}
});
