// Gate anti-drift de los productores SDD (issue #10).
//
// Extrae los templates de artefactos con marker SDD-Tracking de los 16
// SKILL.md ({claude,codex,opencode,pi} × {sdd-init,sdd-spec,sdd-run,grill}),
// valida cada template contra el contrato docs/sdd-tracking-v1.md usando el
// parser de referencia (sdd-artifacts), y exige igualdad byte a byte entre
// harnesses tolerando SOLO las diferencias documentadas en
// docs/harness-interaction-differences.md.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { parseSddArtifact } from "../sdd-artifacts/index.ts";

const HARNESSES = ["claude", "codex", "opencode", "pi"] as const;
type Harness = (typeof HARNESSES)[number];

const SKILLS = ["sdd-init", "sdd-spec", "sdd-run", "grill"] as const;
type Skill = (typeof SKILLS)[number];

type TemplateType = "spec" | "grill" | "project";

// Nombres de skill del repo que pueden aparecer invocados dentro de un
// template; los mas largos primero para que la alternancia no corte antes.
const SKILL_NAMES = [
	"grill-with-domain-modeling",
	"github-issue-selector",
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
];

// Cuantos templates de marker exige cada skill, por tipo de artefacto.
const EXPECTED_TEMPLATES: Record<Skill, Record<TemplateType, number>> = {
	"sdd-init": { spec: 0, grill: 0, project: 1 },
	"sdd-spec": { spec: 2, grill: 0, project: 0 },
	"sdd-run": { spec: 1, grill: 0, project: 0 },
	grill: { spec: 0, grill: 1, project: 0 },
};

// Forma que debe declarar cada template, en orden de aparicion.
const EXPECTED_SHAPES: Record<Skill, RegExp[]> = {
	"sdd-init": [/type=project; generated-at=<YYYY-MM-DD>/],
	"sdd-spec": [
		/type=spec; state=<draft\|approved>; .*superseded-by=none/,
		/type=spec; state=superseded; .*superseded-by=<ref>/,
	],
	"sdd-run": [/type=spec; state=implemented; .*superseded-by=none/],
	grill: [/type=grill; state=<paused\|finalized>; /],
};

const EXPECTED_ARTIFACT_TYPE: Record<Skill, TemplateType> = {
	"sdd-init": "project",
	"sdd-spec": "spec",
	"sdd-run": "spec",
	grill: "grill",
};

const FEEDBACK_REMEDIATION_DOCTRINE = [
	/## Fase 6 — Seguimiento y resolución automática del feedback del PR/,
	/Run completo[\s\S]*PR creado/,
	/`--assume`[\s\S]*no (?:preguntar|ofrecer)[\s\S]*no esperar/,
	/ID estable \+ `updatedAt`/,
	/threads por `thread\.id` \+ `isResolved`/,
	/conversaci[oó]n[\s\S]*reviews[\s\S]*comentarios inline/,
	/polling[\s\S]*60 segundos[\s\S]*primer plano/,
	/Resolver feedback automáticamente/,
	/autoriza[\s\S]*editar[\s\S]*commitear[\s\S]*pushear[\s\S]*responder[\s\S]*resolver threads/i,
	/validar cada planteo[\s\S]*código[\s\S]*spec[\s\S]*contrato/i,
	/worktree[\s\S]*headRefOid[\s\S]*branch del PR/i,
	/test de regresión[\s\S]*fallar[\s\S]*regresión completa/i,
	/push[\s\S]*mismo branch[\s\S]*force-push/i,
	/resolver[\s\S]*thread[\s\S]*push[\s\S]*verde/i,
	/refrescar[\s\S]*snapshot[\s\S]*respuestas propias[\s\S]*polling/i,
	/ambiguo[\s\S]*fuera de alcance[\s\S]*confirmaci[oó]n expl[ií]cita/i,
	/`Feedback resuelto` solo si[\s\S]*no hay bloqueos[\s\S]*`SEGUIMIENTO DE FEEDBACK DETENIDO`/i,
];

const FEEDBACK_REMEDIATION_QUESTION_STYLE: Record<Harness, RegExp> = {
	claude: /usar `AskUserQuestion`[\s\S]*Resolver feedback automáticamente/,
	codex: /usar `request_user_input`[\s\S]*texto plano[\s\S]*Resolver feedback automáticamente/,
	opencode: /preguntar en texto plano[\s\S]*terminar el turno[\s\S]*Resolver feedback automáticamente/,
	pi: /usar `ask_user_question`[\s\S]*Resolver feedback automáticamente/,
};

// Valores concretos para instanciar placeholders de un template de marker.
const PLACEHOLDER_SAMPLE: Record<string, string> = {
	"#NN": "#12",
	"owner/repo#NN": "owner/repo#12",
	ref: "some-ref",
	"YYYY-MM-DD": "2026-08-08",
};

const MARKER_LINE = /^[ \t]*<!--\s*SDD-Tracking\s*:.*-->[ \t]*$/i;

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return await readFile(repoFile(path), "utf8");
}

interface InteractionTable {
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

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeInvocations(text: string, prefix: string): string {
	const names = SKILL_NAMES.map(escapeRegExp).join("|");
	const pattern = new RegExp(
		`(^|[^A-Za-z0-9.])${escapeRegExp(prefix)}(${names})(?![A-Za-z0-9-])`,
		"gm",
	);
	return text.replace(pattern, (_match, before: string, name: string) => `${before}«skill:${name}»`);
}

interface Fence {
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

interface CanonicalTemplate {
	line: string;
	type: TemplateType | null;
	fenceLine: number;
}

interface Census {
	canonical: CanonicalTemplate[];
	legacy: { line: string; fenceLine: number }[];
	markerFences: Fence[];
}

export function censusTemplates(markdown: string): Census {
	const canonical: CanonicalTemplate[] = [];
	const legacy: { line: string; fenceLine: number }[] = [];
	const markerFences: Fence[] = [];
	for (const fence of fencedBlocks(markdown)) {
		const markers = fence.content.split("\n").filter((line) => MARKER_LINE.test(line));
		if (markers.length === 0) continue;
		markerFences.push(fence);
		for (const raw of markers) {
			const line = raw.trim();
			if (/\bversion\s*=/i.test(line) || /\btype\s*=/i.test(line)) {
				const type = line.match(/\btype=(spec|grill|project)\b/)?.[1] as TemplateType | undefined;
				canonical.push({ line, type: type ?? null, fenceLine: fence.line });
			} else {
				legacy.push({ line, fenceLine: fence.line });
			}
		}
	}
	return { canonical, legacy, markerFences };
}

export function instantiations(template: string): string[] {
	const matches = [...template.matchAll(/<([^<>]+)>/g)];
	if (matches.length === 0) return [template];
	const alternativesAt = matches.map((match) =>
		(match[1] ?? "").split("|").map((alt) => PLACEHOLDER_SAMPLE[alt.trim()] ?? alt.trim()),
	);
	const build = (choices: number[]): string => {
		let result = "";
		let cursor = 0;
		matches.forEach((match, index) => {
			result += template.slice(cursor, match.index) + (alternativesAt[index] ?? [])[choices[index] ?? 0];
			cursor = (match.index ?? 0) + match[0].length;
		});
		return result + template.slice(cursor);
	};
	const variants = new Set<string>();
	matches.forEach((_match, position) => {
		(alternativesAt[position] ?? []).forEach((_alternative, choice) => {
			const choices = matches.map(() => 0);
			choices[position] = choice;
			variants.add(build(choices));
		});
	});
	return [...variants];
}

interface TemplateVerdict {
	ok: boolean;
	problems: string[];
}

export function validateTemplateLine(line: string, expectedType: TemplateType): TemplateVerdict {
	const problems: string[] = [];
	for (const variant of instantiations(line)) {
		const document = `# Artefacto\n${variant}\n\n## Cuerpo\nContenido.\n`;
		const parsed = parseSddArtifact(document);
		if (parsed.kind !== "metadata" || parsed.format !== "canonical") {
			const diagnostics = parsed.diagnostics
				.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
				.join("; ");
			problems.push(`instancia no canonica \`${variant}\` (kind=${parsed.kind}) — ${diagnostics}`);
			continue;
		}
		if (parsed.metadata.type !== expectedType) {
			problems.push(`instancia \`${variant}\` parsea como type=${parsed.metadata.type}, esperado ${expectedType}`);
		}
	}
	return { ok: problems.length === 0, problems };
}

function firstDifference(a: string, b: string): string {
	const aLines = a.split("\n");
	const bLines = b.split("\n");
	const max = Math.max(aLines.length, bLines.length);
	for (let index = 0; index < max; index++) {
		if (aLines[index] !== bLines[index]) {
			return `linea ${index + 1} del template: \`${aLines[index] ?? "<ausente>"}\` vs \`${bLines[index] ?? "<ausente>"}\``;
		}
	}
	return "identicos";
}

export function compareTemplates(skill: string, byHarness: Map<Harness, string[]>): string[] {
	const divergences: string[] = [];
	const [reference, ...rest] = HARNESSES;
	const referenceTemplates = byHarness.get(reference) ?? [];
	for (const harness of rest) {
		const templates = byHarness.get(harness) ?? [];
		if (templates.length !== referenceTemplates.length) {
			divergences.push(
				`${skill}: ${reference} tiene ${referenceTemplates.length} templates y ${harness} tiene ${templates.length}`,
			);
			continue;
		}
		referenceTemplates.forEach((template, index) => {
			const other = templates[index] ?? "";
			if (template !== other) {
				divergences.push(
					`${skill}: template #${index + 1} difiere entre ${reference} y ${harness} — ${firstDifference(template, other)}`,
				);
			}
		});
	}
	return divergences;
}

function countByType(census: Census): Record<TemplateType, number> {
	const counts: Record<TemplateType, number> = { spec: 0, grill: 0, project: 0 };
	for (const entry of census.canonical) {
		if (entry.type !== null) counts[entry.type] += 1;
	}
	return counts;
}

// --- Gate sobre el arbol real -----------------------------------------------

for (const skill of SKILLS) {
	for (const harness of HARNESSES) {
		test(`${harness}/${skill}: templates de marker v1 esperados y sin marker legacy`, async () => {
			const census = censusTemplates(await readRepoFile(`${harness}/${skill}/SKILL.md`));
			assert.deepEqual(
				census.legacy,
				[],
				`${harness}/${skill}/SKILL.md instruye un marker SDD-Tracking legacy (sin version/type)`,
			);
			for (const entry of census.canonical) {
				assert.notEqual(
					entry.type,
					null,
					`${harness}/${skill}/SKILL.md linea de fence ${entry.fenceLine}: template canonico sin type literal`,
				);
			}
			assert.deepEqual(
				countByType(census),
				EXPECTED_TEMPLATES[skill],
				`${harness}/${skill}/SKILL.md no instruye los templates de marker v1 esperados`,
			);
		});
	}
}

test("cada template declara la forma esperada para su skill (estados y supersesion)", async () => {
	const problems: string[] = [];
	for (const skill of SKILLS) {
		for (const harness of HARNESSES) {
			const census = censusTemplates(await readRepoFile(`${harness}/${skill}/SKILL.md`));
			const shapes = EXPECTED_SHAPES[skill];
			if (census.canonical.length !== shapes.length) {
				problems.push(`${harness}/${skill}: ${census.canonical.length} templates, esperados ${shapes.length}`);
				continue;
			}
			shapes.forEach((shape, index) => {
				const line = census.canonical[index]?.line ?? "";
				if (!shape.test(line)) {
					problems.push(`${harness}/${skill}: template #${index + 1} no declara ${shape} — \`${line}\``);
				}
			});
		}
	}
	assert.deepEqual(problems, []);
});

test("cada template de marker instancia a markers canonicos del contrato", async () => {
	const problems: string[] = [];
	for (const skill of SKILLS) {
		for (const harness of HARNESSES) {
			const census = censusTemplates(await readRepoFile(`${harness}/${skill}/SKILL.md`));
			for (const entry of census.canonical) {
				const verdict = validateTemplateLine(entry.line, EXPECTED_ARTIFACT_TYPE[skill]);
				if (!verdict.ok) {
					problems.push(`${harness}/${skill}/SKILL.md (fence linea ${entry.fenceLine}): ${verdict.problems.join("; ")}`);
				}
			}
		}
	}
	assert.deepEqual(problems, []);
});

test("templates byte-equivalentes entre harnesses tras normalizar la invocacion", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const divergences: string[] = [];
	for (const skill of SKILLS) {
		const byHarness = new Map<Harness, string[]>();
		for (const harness of HARNESSES) {
			const markdown = await readRepoFile(`${harness}/${skill}/SKILL.md`);
			const templates = censusTemplates(markdown).markerFences.map((fence) =>
				normalizeInvocations(fence.content, prefixes[harness]),
			);
			if (skill === "sdd-run") {
				const resultado = fencedBlocks(markdown).find((fence) =>
					/^## Resultado de ejecucion/.test(fence.content),
				);
				if (resultado) {
					templates.push(normalizeInvocations(resultado.content, prefixes[harness]));
				} else {
					divergences.push(`sdd-run: ${harness} no instruye el template de ## Resultado de ejecucion`);
				}
			}
			byHarness.set(harness, templates);
		}
		divergences.push(...compareTemplates(skill, byHarness));
	}
	assert.deepEqual(divergences, []);
});

test("sdd-run remedia feedback del PR de forma automática, opt-in y segura en cada harness", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-run/SKILL.md`);
		for (const doctrine of FEEDBACK_REMEDIATION_DOCTRINE) {
			assert.match(markdown, doctrine, `${harness}/sdd-run/SKILL.md no declara ${doctrine}`);
		}
		assert.match(
			markdown,
			FEEDBACK_REMEDIATION_QUESTION_STYLE[harness],
			`${harness}/sdd-run/SKILL.md no usa el gate de remediación propio del harness`,
		);
		assert.doesNotMatch(
			markdown,
			/no editar código[\s\S]*turno nuevo/i,
			`${harness}/sdd-run/SKILL.md todavía obliga a detenerse después de detectar feedback`,
		);
	}
});

test(".sdd/project.md lleva el marker canonico type=project", async () => {
	const parsed = parseSddArtifact(await readRepoFile(".sdd/project.md"));
	assert.equal(parsed.kind, "metadata", "el contrato del repo tiene metadata SDD");
	assert.ok(parsed.kind === "metadata" && parsed.format === "canonical", "el marker es canonico, no legacy");
	assert.ok(
		parsed.kind === "metadata" && parsed.format === "canonical" && parsed.metadata.type === "project",
		"el marker declara type=project",
	);
});

// --- Autotests del gate: puede fallar y con que diagnostico ------------------

test("autotest: una divergencia entre harnesses se reporta con la linea que difiere", () => {
	const byHarness = new Map<Harness, string[]>([
		["claude", ["# Spec — <titulo>\nlinea comun"]],
		["codex", ["# Spec — <titulo>\nlinea comun"]],
		["opencode", ["# Spec — <titulo>\nlinea DIVERGENTE"]],
		["pi", ["# Spec — <titulo>\nlinea comun"]],
	]);
	const divergences = compareTemplates("sdd-spec", byHarness);
	assert.equal(divergences.length, 1);
	assert.match(divergences[0] ?? "", /opencode/);
	assert.match(divergences[0] ?? "", /DIVERGENTE/);
});

test("autotest: un template que falta en un harness se reporta como diferencia de cantidad", () => {
	const byHarness = new Map<Harness, string[]>([
		["claude", ["template"]],
		["codex", ["template"]],
		["opencode", []],
		["pi", ["template"]],
	]);
	const divergences = compareTemplates("grill", byHarness);
	assert.equal(divergences.length, 1);
	assert.match(divergences[0] ?? "", /1 templates y opencode tiene 0/);
});

test("autotest: un template no canonico falla la validacion con diagnostico del contrato", () => {
	const verdict = validateTemplateLine(
		"<!-- SDD-Tracking: version=1; type=spec; state=<draft|approved>; issue=<#NN|owner/repo#NN|none>; grill=<ref|none> -->",
		"spec",
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /missing-key/);
});

test("autotest: un marker legacy dentro de un template se clasifica como legacy", () => {
	const census = censusTemplates(
		["```markdown", "# Spec — X", "<!-- SDD-Tracking: issue=#9; grill=none -->", "```"].join("\n"),
	);
	assert.equal(census.canonical.length, 0);
	assert.equal(census.legacy.length, 1);
});

test("autotest: la normalizacion reduce las tres sintaxis de invocacion al mismo token", () => {
	const claude = normalizeInvocations("<!-- Generada por /sdd-spec el <fecha>. -->", "/");
	const codex = normalizeInvocations("<!-- Generada por $sdd-spec el <fecha>. -->", "$");
	const pi = normalizeInvocations("<!-- Generada por /skill:sdd-spec el <fecha>. -->", "/skill:");
	assert.equal(claude, codex);
	assert.equal(codex, pi);
	assert.match(claude, /«skill:sdd-spec»/);
	assert.equal(normalizeInvocations("archivo en .sdd/grills/x.md", "/"), "archivo en .sdd/grills/x.md");
});
