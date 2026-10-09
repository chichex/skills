// Gate anti-drift de los productores SDD (issue #10).
//
// Extrae los templates de artefactos con marker SDD-Tracking de los 16
// SKILL.md ({claude,codex,opencode,pi} × {sdd-init,sdd-spec,sdd-run,grill}),
// valida cada template contra el contrato docs/sdd-tracking-v1.md usando el
// parser de referencia (sdd-artifacts), y exige igualdad byte a byte entre
// harnesses tolerando SOLO las diferencias documentadas en
// docs/harness-interaction-differences.md.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parseSddArtifact } from "../sdd-artifacts/index.ts";
import type { Fence, Harness } from "./interaction.ts";
import {
	HARNESSES,
	fencedBlocks,
	firstDifference,
	escapeRegExp,
	normalizeInvocations,
	parseInteractionTable,
} from "./interaction.ts";

const SKILLS = ["sdd-init", "sdd-spec", "sdd-run", "grill"] as const;
type Skill = (typeof SKILLS)[number];

type TemplateType = "spec" | "grill" | "project";

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

const SDD_RUN_DIRTY_CHECKOUT_DOCTRINE = [
	/checkout sucio no bloquea por sí solo/i,
	/referencia remota actualizada/i,
	/artefactos de entrada del workflow/i,
	/spec target local/i,
	/`\.sdd\/project\.md`/,
	/handoff canónico/i,
	/`CONTEXT\.md`[\s\S]*`docs\/adr\/`/,
	/cambios locales restantes[\s\S]*excluidos[\s\S]*no abortan/i,
	/PRIMER commit/i,
	/checkout original queda intacto/i,
	/prerrequisito faltante o una desviación/i,
];

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

const SDD_SPEC_PUBLICATION_DOCTRINE = [
	/`parseSddArtifact`/,
	/`kind=metadata`[\s\S]*`format=canonical`[\s\S]*`type=spec`/,
	/siempre[\s\S]*`state=draft`[\s\S]*`state=approved`[\s\S]*eleg[\s\S]*run/i,
	/identidad semántica[\s\S]*issue[\s\S]*grill decodificado exacto/i,
	/precheck[\s\S]*antes de cualquier mutación/i,
	/releer[\s\S]*cada destino[\s\S]*misma postcondición/i,
	/`Llevar a issue`[\s\S]*equivalencia normativa/i,
	/transición a `state=approved`[\s\S]*mismo gate/i,
	/staging no-SDD[\s\S]*issue nueva/i,
	/predecesoras[\s\S]*`state=superseded`[\s\S]*`superseded-by`/i,
	/receipt exitoso[\s\S]*`Spec lista`/i,
];

// Issue #45: sdd-spec avanza sin preguntar y cierra con un menú; doctrina
// idéntica entre harnesses dentro del bloque `sdd-spec-flow`.
const SDD_SPEC_FLOW_DOCTRINE = [
	/inferencias nuevas[\s\S]*`\[ASSUMED\]`[\s\S]*sin preguntar/i,
	/decisiones del handoff[\s\S]*confirmadas/i,
	/mecanismo[\s\S]*propuesto[\s\S]*alternativas[\s\S]*sin preguntar/i,
	/`--out`[\s\S]*fuerza/i,
	/SDD-Tracking in:body/,
	// Spec #84, CA-14: el destino local es el common-dir, fuera del working tree.
	/`<git-common-dir>\/sdd\/specs\/<slug>\.md`/,
	/staging no-SDD/,
	/`Llevar a issue`/,
	/`Solicitar cambios`/,
	/`sdd-run con subagente`[\s\S]*solo[\s\S]*subagentes/i,
	/`state=approved`[\s\S]*antes de lanzar/i,
	/comments[\s\S]*posteriores[\s\S]*última publicación/i,
	/--paginate/,
	/`updated_at`/,
	/vuelve al menú/i,
	/`--assume`[\s\S]*sin menú/i,
];

// Issue #45: sdd-run imprime el plan y sigue, desvía sin preguntar cuando no
// cambia el alcance y ofrece code review post-PR. Bloque `sdd-run-flow`.
const SDD_RUN_FLOW_DOCTRINE = [
	/imprimir el plan y seguir/i,
	/choca con la spec o con una política/i,
	/`\[DEVIATION\]`[\s\S]*cambia el alcance[\s\S]*preguntar/i,
	/una sola spec candidata \(estado `draft` o `aprobada`/i,
	/`draft`[\s\S]*aprobada al correr/i,
	/`Code review`/,
	/`\.github\/workflows\/claude-review\.yml`[\s\S]*`workflow_dispatch`/,
	/gh workflow run claude-review\.yml -f pr=<N>/,
	/subagente `reviewer`[\s\S]*code review nativo[\s\S]*`--comment`/,
	/sin GHA[\s\S]*no aparece/i,
	/encadena[\s\S]*Fase 6/i,
];

// Hallazgo 3 del review de PR #46: la rama de `Code review` diverge por
// harness (subagente en Claude y, desde el issue #44, en Pi via la tool
// `subagent`) y cada una tiene que quedar gateada.
const CODE_REVIEW_BRANCH: Record<Harness, RegExp> = {
	claude: /`Code review` en Claude Code[\s\S]*`workflow_dispatch`[\s\S]*subagent_type: "reviewer"[\s\S]*`\/code-review --comment`/,
	codex: /`Code review` en Codex[\s\S]*sin subagentes[\s\S]*solo (?:aparece )?(?:si|por GHA)[\s\S]*`workflow_dispatch`/i,
	opencode: /`Code review` en opencode[\s\S]*sin subagentes[\s\S]*solo (?:aparece )?(?:si|por GHA)[\s\S]*`workflow_dispatch`/i,
	pi: /`Code review` en Pi[\s\S]*`workflow_dispatch`[\s\S]*`subagent`[\s\S]*`reviewer`[\s\S]*`\/skill:code-review`/,
};

// Hallazgo 10 del review de PR #46: en codex y opencode la oferta califica
// `Code review` inline como GHA-only. Pi dejo de calificarla (issue #44).
const CODE_REVIEW_OFFER_QUALIFIED = /`Code review` \(solo con GHA\)/;

// Issue #44: la exploracion de la Fase 2 en Pi delega en subagentes `scout`
// via la tool `subagent`, espejo de los `Explore` de Claude.
const PI_SCOUT_EXPLORATION = /subagentes `scout` con la tool `subagent`/;
// Tope de la exploracion con scouts: sin cantidad maxima ni exhaustividad
// explicita, el agente lanzaba 4 scouts con tasks abiertos que hacian cientos
// de lecturas y bloqueaban la sesion.
const PI_SCOUT_BUDGET_RUN = /como máximo 2[\s\S]{0,120}`Rápida`[\s\S]{0,400}Nunca pedir "explorá el worktree"[\s\S]{0,200}`failed \(timeout\)`[\s\S]{0,80}`Agent timeout`/;
const PI_SCOUT_BUDGET_RUN_OVERFLOW = /más de 2 áreas[\s\S]{0,120}2 de mayor blast radius[\s\S]{0,60}resto inline/;
const PI_SCOUT_BUDGET_SPEC = /como máximo 3[\s\S]{0,200}nunca `Exhaustiva`[\s\S]{0,400}Nunca un task abierto[\s\S]{0,200}`failed \(timeout\)`[\s\S]{0,80}`Agent timeout`/;

const FEEDBACK_REMEDIATION_QUESTION_STYLE: Record<Harness, RegExp> = {
	claude: /usar `AskUserQuestion`[\s\S]*Resolver feedback automáticamente/,
	codex: /usar `request_user_input`[\s\S]*texto plano[\s\S]*Resolver feedback automáticamente/,
	opencode: /preguntar en texto plano[\s\S]*terminar el turno[\s\S]*Resolver feedback automáticamente/,
	pi: /usar `ask_user_question`[\s\S]*Resolver feedback automáticamente/,
};

// grill: rondas por frontera de dependencias y hechos sin bloqueo en los
// cuatro harnesses; el atajo liviano vive en claude, codex y opencode.
const GRILL_ROUNDS_DOCTRINE = [
	/frontera de dependencias/,
	/(?:acopladas de hecho|cambiaría cómo se formula otra)[\s\S]{0,200}ronda siguiente/,
	/[Rr]ecalculá la frontera/,
];
const GRILL_NON_BLOCKING_FACTS_DOCTRINE = [
	/los hechos los averigua el agente, nunca el usuario/i,
	/solo esperan las preguntas que dependen de ese hecho/i,
	/el resto de la frontera se pregunta ya/i,
	/toda la frontera depende de hechos pendientes[\s\S]{0,200}ronda vacía/i,
	/exploración falla o vence[\s\S]{0,300}supuesto visible/i,
];
const GRILL_LIGHT_SHORTCUT = /### Atajo liviano \(1 a 3 preguntas\)/;
const GRILL_LIGHT_SHORTCUT_HARNESSES: readonly Harness[] = ["claude", "codex", "opencode"];
const GRILL_FACT_EXPLORATION: Record<Harness, RegExp> = {
	claude: /`Agent`[\s\S]{0,80}`Explore`[\s\S]{0,80}background/,
	codex: /subagente `explorer`[\s\S]{0,400}misma ronda/,
	opencode: /subagente `explore`[\s\S]{0,80}`task`[\s\S]{0,400}misma ronda/,
	pi: /`subagent`[\s\S]{0,80}`scout`[\s\S]{0,80}`background: true`/,
};

// Stacks de PRs por spec (issue #66, CA-1/CA-2): `sdd-spec` propone el corte
// en capas dentro de la spec; doctrina idéntica entre harnesses dentro del
// bloque `sdd-spec-delivery`.
const SDD_SPEC_DELIVERY_DOCTRINE = [
	/`## Plan de entrega`[\s\S]*`\| Capa \| Etapa \| CAs \| Justificacion \|`/,
	/cada capa es un grupo coherente de CAs[\s\S]*tests dan verde solos[\s\S]*regresión completa/i,
	/tamaño máximo de PR[\s\S]*activo[\s\S]*cada capa entra en el límite/i,
	/una sola capa[\s\S]*todo entra en un PR/i,
	/propuesta se escribe sin preguntar[\s\S]*`Solicitar cambios`/i,
];

// Stacks de PRs por spec (issue #66, CA-3 a CA-9): `sdd-run` entrega un stack
// nativo de GitHub cuando el Plan de entrega tiene 2 o más capas. Bloque
// `sdd-run-stack`, idéntico entre harnesses.
const SDD_RUN_STACK_DOCTRINE = [
	// CA-3: preflight
	/`## Plan de entrega` de 2 o más capas[\s\S]*`gh` ≥ 2\.90\.0[\s\S]*`git` ≥ 2\.36[\s\S]*`github\/gh-stack`[\s\S]*`gh extension list`/,
	/interactivo[\s\S]*`gh extension install github\/gh-stack` ahí mismo/,
	/`--assume`[\s\S]*frena antes de ramificar[\s\S]*comando exacto/,
	/una sola capa[\s\S]*nada cambia/i,
	// CA-4: ramificado
	/`gh stack init -b <base> sdd\/<slug>\/1-<etapa>`[\s\S]*`\.\.\/<repo>-sdd-<slug>`/,
	/`gh stack add sdd\/<slug>\/<n>-<etapa>`/,
	/no existe el branch pelado `sdd\/<slug>`/,
	/cualquier ref `sdd\/<slug>` o `sdd\/<slug>\/\*`[\s\S]*bloqueo de Fase 1\.4/,
	/slug kebab de hasta 20 caracteres[\s\S]*`Etapa`/,
	// CA-5: verificación por capa
	/antes de `gh stack add`[\s\S]*CAs verificados con su mecanismo[\s\S]*regresión completa[\s\S]*escalera del contrato hasta su techo/,
	/receipt Git por capa[\s\S]*`git diff --name-status <base de la capa>\.\.HEAD`/,
	/CA en FALLA congela su capa[\s\S]*no se abren[\s\S]*el reporte lo dice/,
	// CA-6: resultado por capa
	/`Capa` = `n\/N`[\s\S]*`1\/1` sin stack/,
	/su propio branch/,
	/`state=implemented`[\s\S]*solo en la capa top/,
	// CA-7: publicación
	/`gh stack submit --auto --open`[\s\S]*`gh pr edit --body-file`/,
	/de abajo lleva la spec completa[\s\S]*checklist humano[\s\S]*`Refs #NN`[\s\S]*PR top lleva `Closes #NN`[\s\S]*GitHub cierra el issue solo cuando aterriza la capa top/,
	/checklist humano del PR de abajo suma «verificar que GitHub cierra el issue al mergear la capa top»/,
	/`Capa n\/N del stack · spec en #<PR de abajo>`/,
	/`<título de la spec> — capa n\/N: <etapa>`/,
	/política de generación en FALLA[\s\S]*draft solo la capa que la viola[\s\S]*`gh pr ready --undo`/,
	/`--no-pr`[\s\S]*sin `submit`/,
	/Sigue sin mergear/,
	// CA-8: seguimiento
	/Fase 6[\s\S]*todos los PRs del stack de abajo hacia arriba/,
	/`Code review`[\s\S]*por cada PR/,
	/capa baja[\s\S]*`gh stack sync`[\s\S]*restackear/,
	/worktree del stack se retiene[\s\S]*`Terminar`[\s\S]*solo si está limpio/,
	// Remediación de review PR #67: conflicto de restack y trunk local
	/Si `gh stack sync` o `gh stack rebase` frenan por conflicto, no se resuelve a ciegas[\s\S]*`gh stack rebase --abort`[\s\S]*sin operación a medias[\s\S]*pendiente humano con el comando/,
	/`gh stack sync` no puede fast-forwardear el trunk local[\s\S]*checkouteado y sucio en el checkout original[\s\S]*frena con diagnóstico/,
	// CA-9: force
	/único force permitido es el `--force-with-lease`[\s\S]*`gh stack push`[\s\S]*`gh stack sync`[\s\S]*`gh stack rebase`[\s\S]*`sdd\/<slug>\/\*`/,
	/`git push --force` y `--force-with-lease` a mano siguen prohibidos/,
];

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

function delimitedDoctrine(markdown: string, name: string): string {
	const block = markdown.match(new RegExp(`<!-- ${name}:start -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`));
	assert.ok(block, `bloque delimitado ${name} presente`);
	return block[1] ?? "";
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

test("sdd-run tolera el checkout sucio, importa artefactos del workflow y aísla el resto en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-run/SKILL.md`);
		const doctrine = delimitedDoctrine(markdown, "sdd-run-dirty-checkout");
		for (const expected of SDD_RUN_DIRTY_CHECKOUT_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/sdd-run/SKILL.md no declara ${expected}`);
		}
		assert.doesNotMatch(
			markdown,
			/Única excepción — el spec target sin comitear|CUALQUIER otro path sucio[\s\S]{0,160}abort|cambios pendientes o estado a medias = abort/i,
			`${harness}/sdd-run/SKILL.md todavía bloquea el workflow por suciedad ordinaria`,
		);
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("sdd-run dirty checkout", byHarness), []);
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

test("sdd-spec exige la postcondición canónica antes de cualquier éxito observable en cada harness", async () => {
	const commonDoctrine = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-spec/SKILL.md`);
		const doctrine = delimitedDoctrine(markdown, "sdd-spec-publication-gate");
		for (const expected of SDD_SPEC_PUBLICATION_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/sdd-spec/SKILL.md no declara ${expected}`);
		}
		const doctrineStart = markdown.indexOf("<!-- sdd-spec-publication-gate:start -->");
		const reportStart = markdown.indexOf("## Reporte");
		assert.ok(doctrineStart >= 0 && reportStart >= 0 && doctrineStart < reportStart,
			`${harness}/sdd-spec/SKILL.md declara el gate después del reporte de éxito`);
		if (harness === "pi") {
			assert.match(doctrine, /`persist_sdd_spec`[\s\S]*`details\.receipt`/,
				"Pi debe ejecutar el boundary y comprobar su receipt estructurado");
		} else {
			assert.doesNotMatch(markdown, /`persist_sdd_spec`/,
				`${harness}/sdd-spec/SKILL.md no debe depender del runtime exclusivo de Pi`);
		}
		const normalizedDoctrine = harness === "pi"
			? doctrine.replace(
				/\n\nEn Pi,[\s\S]*$/,
				"\n\nLa ausencia de un runtime dedicado en este harness no relaja ninguna de estas postcondiciones.",
			)
			: doctrine;
		commonDoctrine.set(harness, [normalizedDoctrine]);
	}
	assert.deepEqual(compareTemplates("sdd-spec publication doctrine", commonDoctrine), []);
});

test("sdd-spec avanza sin preguntar inferencias ni mecanismo y cierra con menú en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /¿Alguna inferencia a revisar\?/, `${harness}/sdd-spec/SKILL.md todavía pregunta las inferencias`);
		assert.doesNotMatch(markdown, /¿Con qué lo verificamos\?/, `${harness}/sdd-spec/SKILL.md todavía pregunta el mecanismo`);
		assert.doesNotMatch(markdown, /¿Con qué intensidad\?/, `${harness}/sdd-spec/SKILL.md todavía pregunta la intensidad`);
		const doctrine = delimitedDoctrine(markdown, "sdd-spec-flow");
		for (const expected of SDD_SPEC_FLOW_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/sdd-spec/SKILL.md no declara ${expected}`);
		}
		const flowStart = markdown.indexOf("<!-- sdd-spec-flow:start -->");
		const reportStart = markdown.indexOf("## Reporte");
		assert.ok(flowStart >= 0 && reportStart >= 0 && flowStart < reportStart,
			`${harness}/sdd-spec/SKILL.md declara el flujo después del reporte`);
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("sdd-spec flow", byHarness), []);
});

test("sdd-spec no contradice que `Llevar a issue` conserva el .md, y Pi revierte la aprobación cancelada", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-spec/SKILL.md`);
		for (const line of markdown.split("\n")) {
			if (/(?:no crea además una|sin crear una) copia en `\.sdd\/specs\/`/.test(line)) {
				assert.match(line, /Llevar a issue/, `${harness}/sdd-spec/SKILL.md niega la copia local sin exceptuar Llevar a issue`);
			}
		}
		assert.doesNotMatch(delimitedDoctrine(markdown, "sdd-spec-publication-gate"), /`Ambos`/,
			`${harness}/sdd-spec/SKILL.md nombra una opción \`Ambos\` que ya no existe`);
	}
	const pi = await readRepoFile("pi/sdd-spec/SKILL.md");
	assert.match(pi, /`mode: "assume"`[\s\S]*`draft`[\s\S]*`mode: "interactive"`[\s\S]*`approved`/,
		"Pi declara qué mode del runtime publica draft y cuál aprueba");
	assert.match(pi, /cancel[\s\S]{0,200}revert[\s\S]{0,200}`draft`/i, "Pi revierte a draft si se cancela Ejecutar ahora");
});

test("sdd-spec lanza el run con subagente implementer en background en Claude y en Pi, nunca en codex ni opencode", async () => {
	const claude = await readRepoFile("claude/sdd-spec/SKILL.md");
	assert.match(claude, /subagent_type: "implementer"/);
	assert.match(claude, /run_in_background/);
	assert.match(claude, /`general-purpose`[\s\S]*(anunci|avis)/i);
	assert.match(claude, /--assume/);
	for (const harness of HARNESSES.filter((candidate) => candidate !== "claude")) {
		const markdown = await readRepoFile(`${harness}/sdd-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /subagent_type/, `${harness}/sdd-spec/SKILL.md no debe depender de subagentes de Claude`);
	}
	// Issue #44 CA-9/CA-12: Pi lanza la tool `subagent` con el agente bundleado
	// `implementer` en background y el task `/skill:sdd-run <target> --assume`.
	const pi = await readRepoFile("pi/sdd-spec/SKILL.md");
	assert.match(pi, /agent: "implementer"/, "pi/sdd-spec lanza el implementer bundleado");
	assert.match(pi, /background: true/, "pi/sdd-spec lanza el subagente en background");
	assert.match(pi, /`sdd-run con subagente`[\s\S]*--assume/, "pi/sdd-spec corre sdd-run desatendido en el hijo");
	assert.doesNotMatch(pi, /Pi no tiene subagentes/, "pi/sdd-spec ya tiene subagentes");
	assert.match(pi, PI_SCOUT_EXPLORATION, "pi/sdd-spec explora con scouts");
	assert.match(pi, PI_SCOUT_BUDGET_SPEC, "pi/sdd-spec acota los scouts: cantidad, exhaustividad, task cerrado y timeout");
	for (const harness of ["codex", "opencode"] as const) {
		const markdown = await readRepoFile(`${harness}/sdd-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /agent: "implementer"|background: true/, `${harness}/sdd-spec/SKILL.md no tiene subagentes`);
	}
});

test("sdd-run imprime el plan y sigue, desvía sin preguntar y ofrece code review post-PR en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-run/SKILL.md`);
		assert.doesNotMatch(markdown, /¿Con qué intensidad la corremos\?/, `${harness}/sdd-run/SKILL.md todavía pregunta la intensidad`);
		assert.doesNotMatch(markdown, /Interactivo: decirlo y preguntar si seguir/, `${harness}/sdd-run/SKILL.md todavía pregunta por specs en draft`);
		assert.doesNotMatch(markdown, /`Aprobar \(Recomendado\)` \/ `Ajustar`/, `${harness}/sdd-run/SKILL.md todavía frena en el gate del plan`);
		const doctrine = delimitedDoctrine(markdown, "sdd-run-flow");
		for (const expected of SDD_RUN_FLOW_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/sdd-run/SKILL.md no declara ${expected}`);
		}
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("sdd-run flow", byHarness), []);
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-run/SKILL.md`);
		assert.match(markdown, CODE_REVIEW_BRANCH[harness], `${harness}/sdd-run/SKILL.md no gatea su rama de Code review`);
		if (harness === "codex" || harness === "opencode") {
			assert.match(markdown, CODE_REVIEW_OFFER_QUALIFIED, `${harness}/sdd-run/SKILL.md ofrece Code review sin calificarlo como GHA-only`);
		}
		if (harness === "pi") {
			// Issue #44 CA-10/CA-12: Pi tiene subagentes via la tool `subagent`.
			assert.doesNotMatch(markdown, CODE_REVIEW_OFFER_QUALIFIED, "pi/sdd-run/SKILL.md ya no califica Code review como GHA-only");
			assert.doesNotMatch(markdown, /sin subagentes/i, "pi/sdd-run/SKILL.md ya no se declara sin subagentes");
			assert.match(markdown, /agent: "reviewer"[\s\S]*background: true[\s\S]*`\/skill:code-review <PR>`/, "pi/sdd-run lanza el reviewer bundleado en background");
			assert.match(markdown, /sin GHA y sin la tool[\s\S]*no aparece|tool `subagent` no est[aá] registrada[\s\S]*no aparece/i, "pi/sdd-run omite la opcion sin GHA ni tool");
			assert.match(markdown, PI_SCOUT_EXPLORATION, "pi/sdd-run explora con scouts en la Fase 2");
			assert.match(markdown, PI_SCOUT_BUDGET_RUN, "pi/sdd-run verifica inline por default y acota los scouts de la Fase 2");
			assert.match(markdown, PI_SCOUT_BUDGET_RUN_OVERFLOW, "pi/sdd-run resuelve el choque entre el tope de 2 scouts y un blast radius de mas de 2 areas");
		}
		if (harness !== "claude") {
			assert.doesNotMatch(markdown, /subagent_type/, `${harness}/sdd-run/SKILL.md no debe depender de subagentes de Claude`);
		}
		// Hallazgo 2: con `--assume` la política de dependencias `preguntar` no puede frenar.
		assert.match(markdown, /`preguntar` → [^\n]*`--assume`/, `${harness}/sdd-run/SKILL.md frena con --assume ante deps 'preguntar'`);
	}
	const claude = await readRepoFile("claude/sdd-run/SKILL.md");
	assert.match(claude, /subagent_type: "reviewer"/, "Claude lanza el review con el subagente reviewer");
	assert.match(claude, /`\/code-review --comment`/, "Claude nombra el code review nativo");
});

test("sdd-spec propone el Plan de entrega en el template y el criterio de corte, sin '2+ specs encadenadas', en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /2\+ specs encadenadas/, `${harness}/sdd-spec/SKILL.md todavía parte por tamaño en specs encadenadas`);
		const template = censusTemplates(markdown).markerFences[0]?.content ?? "";
		assert.match(
			template,
			/## Comportamiento esperado\n[^#]*\n## Plan de entrega\n[^#]*\| Capa \| Etapa \| CAs \| Justificacion \|\n[^#]*\n## Fuera de alcance\n/,
			`${harness}/sdd-spec/SKILL.md: el template no lleva ## Plan de entrega entre Comportamiento esperado y Fuera de alcance con la tabla Capa/Etapa/CAs/Justificacion`,
		);
		const doctrine = delimitedDoctrine(markdown, "sdd-spec-delivery");
		for (const expected of SDD_SPEC_DELIVERY_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/sdd-spec/SKILL.md no declara ${expected}`);
		}
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("sdd-spec delivery", byHarness), []);
});

test("sdd-run entrega un stack de PRs por capas con preflight, verificación por capa y force acotado en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-run/SKILL.md`);
		const doctrine = delimitedDoctrine(markdown, "sdd-run-stack");
		for (const expected of SDD_RUN_STACK_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/sdd-run/SKILL.md no declara ${expected}`);
		}
		// CA-6: el template de resultado lleva la columna Capa.
		const resultado = fencedBlocks(markdown).find((fence) => /^## Resultado de ejecucion/.test(fence.content));
		assert.match(
			resultado?.content ?? "",
			/\| CA \| Capa \| Estado \| Evidencia \|\n\|---\|---\|---\|---\|\n\| CA-1 \| 1\/1 \|/,
			`${harness}/sdd-run/SKILL.md: el template de Resultado de ejecucion no lleva la columna Capa`,
		);
		// Remediación de review PR #67: con 2 o más capas el push lo hace gh stack submit.
		const phase5 = markdown.match(/## Fase 5 — PR\n([\s\S]*?)(?=\n## )/)?.[1] ?? "";
		assert.match(
			phase5,
			/con 2 o más capas el push lo hace `gh stack submit`[\s\S]*solo verifica aptitud y Limites[\s\S]*no ejecuta `git push -u origin sdd\/<slug>`/,
			`${harness}/sdd-run/SKILL.md: Fase 5 paso 1 sigue ordenando git push -u con 2 o más capas`,
		);
		// CA-10: el reporte sugiere sdd-land y lista los PRs por capa.
		const report = fencedBlocks(markdown).find((fence) => /^Run completo:/.test(fence.content));
		assert.ok(report, `${harness}/sdd-run/SKILL.md no instruye el bloque Run completo`);
		assert.match(report.content, new RegExp(`siguiente paso: ${escapeRegExp(prefixes[harness])}sdd-land <stack\\|PR>`), `${harness}/sdd-run/SKILL.md: Run completo sin la línea siguiente paso`);
		assert.match(report.content, /PRs por capa/, `${harness}/sdd-run/SKILL.md: Run completo no lista los PRs por capa`);
		// CA-9: MUST DO y MUST NOT DO nombran el force acotado.
		for (const heading of ["MUST DO", "MUST NOT DO"]) {
			const section = markdown.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? "";
			assert.match(section, /--force-with-lease[\s\S]*`gh stack (?:push|sync|rebase)`/, `${harness}/sdd-run/SKILL.md ## ${heading} no acota el force a gh stack`);
		}
		byHarness.set(harness, [
			normalizeInvocations(doctrine, prefixes[harness]),
			normalizeInvocations(report.content, prefixes[harness]),
		]);
	}
	assert.deepEqual(compareTemplates("sdd-run stack", byHarness), []);
});

const RIESGO_DE_MERGE_TEMPLATE = [
	"## Riesgo de merge",
	"Reversible con un revert: <sí | no>. <si no: qué cambió afuera del repo y cómo se vuelve atrás: backup, flag, script, comando>",
	"Si sale mal, le pega a: <usuarios, sistemas o flujos afectados, una frase>",
].join("\n");

test("sdd-run y quick-run piden el loop rojo antes de tocar código y la sección Riesgo de merge en el body del PR", async () => {
	const withQuickRun = HARNESSES.filter((harness) => harness !== "opencode");
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-run/SKILL.md`);
		const risk = fencedBlocks(markdown).filter((fence) => /^## Riesgo de merge/.test(fence.content));
		assert.equal(risk.length, 1, `${harness}/sdd-run/SKILL.md: debe traer un solo template de Riesgo de merge`);
		assert.equal(risk[0]?.content, RIESGO_DE_MERGE_TEMPLATE, `${harness}/sdd-run/SKILL.md: el template de Riesgo de merge no es byte-idéntico`);
		// El template fenced lleva su propio "## " en columna 0: la subsección se delimita por la Fase 6, no por el primer "\n## ".
		const risk5 = markdown.match(/### Riesgo de merge en el body\n([\s\S]*?)(?=\n## Fase 6)/)?.[1] ?? "";
		assert.match(risk5, /es `no` y el body no dice cómo se vuelve atrás[^\n]*`--draft`/, `${harness}/sdd-run/SKILL.md: la regla de draft por riesgo sin rollback no está en la subsección`);
		assert.match(risk5, /PR de abajo[\s\S]*capas superiores/, `${harness}/sdd-run/SKILL.md: no distingue PR de abajo y capas superiores`);
		assert.match(risk5, /el draft va a la capa que no se revierte/, `${harness}/sdd-run/SKILL.md: no dice qué capa del stack sale en draft`);
		assert.match(risk5, /antes de `## Riesgo de merge`[\s\S]*conserva esa sección/, `${harness}/sdd-run/SKILL.md: no protege la sección ante la Fase 6`);
		assert.match(risk5, /`pendiente tuyo`/, `${harness}/sdd-run/SKILL.md: el draft por riesgo no se reporta`);
		const budget = markdown.match(/\n3\. \*\*Presupuesto por CA\*\*[^\n]*(?:\n   [^\n]*)*/)?.[0] ?? "";
		assert.match(budget, /loop rojo/, `${harness}/sdd-run/SKILL.md: el presupuesto por CA no exige el loop rojo`);
		assert.match(budget, /no cuentan/, `${harness}/sdd-run/SKILL.md: sin loop rojo los intentos no cuentan`);
		assert.match(budget, /después de implementarlo/, `${harness}/sdd-run/SKILL.md: el loop rojo no está acotado a CAs rotos`);
		assert.match(budget, /sin loop rojo»[^\n]*se sigue con los demás/, `${harness}/sdd-run/SKILL.md: falta el tope cuando no se arma el loop`);
		assert.match(markdown, /salvo la FALLA «sin loop rojo»/, `${harness}/sdd-run/SKILL.md: Timeouts no exceptúa la FALLA sin loop rojo`);
	}
	for (const harness of withQuickRun) {
		const markdown = await readRepoFile(`${harness}/quick-run/SKILL.md`);
		const risk = fencedBlocks(markdown).filter((fence) => /^## Riesgo de merge/.test(fence.content));
		assert.equal(risk.length, 1, `${harness}/quick-run/SKILL.md: debe traer un solo template de Riesgo de merge`);
		assert.equal(risk[0]?.content, RIESGO_DE_MERGE_TEMPLATE, `${harness}/quick-run/SKILL.md: el template de Riesgo de merge no es byte-idéntico`);
		assert.match(markdown, /### Ruta bug: loop rojo antes de tocar código/, `${harness}/quick-run/SKILL.md: sin ruta bug con loop rojo`);
		assert.match(markdown, /\[DEBUG-/, `${harness}/quick-run/SKILL.md: sin prefijo de instrumentación [DEBUG-xxxx]`);
		assert.match(markdown, /falla si alguna corrida falla/, `${harness}/quick-run/SKILL.md: el loop listo no contempla intermitentes`);
		assert.match(markdown, /sale en `--draft`[^\n]*pendiente humano/, `${harness}/quick-run/SKILL.md: el draft por riesgo no se reporta`);
	}
});

test("los implementer exigen el loop rojo antes de declarar una FALLA con diagnóstico", async () => {
	for (const file of ["agents/implementer.md", "pi-extensions/subagent/agents/implementer.md"]) {
		const markdown = await readRepoFile(file);
		const section = markdown.match(/## 6\. Tope de tres intentos honestos\n([\s\S]*?)(?=\n## 7)/)?.[1] ?? "";
		assert.match(section, /loop rojo/, `${file}: §6 no menciona el loop rojo`);
		assert.match(section, /sin loop rojo/i, `${file}: §6 no define la FALLA sin loop rojo`);
	}
});

test("grill nombra en cada harness la tool de preguntas que declara la tabla", async () => {
	const { questionTools } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const missing: string[] = [];
	for (const harness of HARNESSES) {
		const tool = questionTools[harness];
		if (tool === null) continue;
		const markdown = await readRepoFile(`${harness}/grill/SKILL.md`);
		const name = escapeRegExp(`\`${tool}\``);
		const usage = new RegExp(`(?:UNA llamada a |[Uu]s(?:ar|á) (?:la tool )?|invocá )${name}`);
		const negated = new RegExp(`no (?:hay|existe)[^.\\n]{0,60}${name}`, "i");
		if (!usage.test(markdown)) missing.push(`${harness}/grill/SKILL.md no instruye usar \`${tool}\``);
		if (negated.test(markdown)) missing.push(`${harness}/grill/SKILL.md niega \`${tool}\``);
	}
	assert.deepEqual(missing, []);
});

test("grill entrevista por rondas con hechos sin bloqueo en cada harness y atajo liviano fuera de Pi", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/grill/SKILL.md`);
		const expected = [...GRILL_ROUNDS_DOCTRINE, ...GRILL_NON_BLOCKING_FACTS_DOCTRINE, GRILL_FACT_EXPLORATION[harness]];
		if (GRILL_LIGHT_SHORTCUT_HARNESSES.includes(harness)) expected.push(GRILL_LIGHT_SHORTCUT);
		for (const pattern of expected) {
			if (!pattern.test(markdown)) problems.push(`${harness}/grill/SKILL.md no declara ${pattern}`);
		}
	}
	assert.deepEqual(problems, []);
});

test("autotest: la fila tool-preguntas mapea `—` a null y quita backticks", () => {
	const doc = [
		"<!-- interaction-differences:start -->",
		"| Campo | claude | codex | opencode | pi |",
		"|---|---|---|---|---|",
		"| invocacion | `/nombre` | `$nombre` | `/nombre` | `/skill:nombre` |",
		"| tool-preguntas | `AskUserQuestion` | `request_user_input` | — | `ask_user_question` |",
		"<!-- interaction-differences:end -->",
	].join("\n");
	assert.deepEqual(parseInteractionTable(doc).questionTools, {
		claude: "AskUserQuestion",
		codex: "request_user_input",
		opencode: null,
		pi: "ask_user_question",
	});
});

test("ultracode no aparece en ningún skill de claude/", async () => {
	const listing = spawnSync("git", ["ls-files", "claude/"], { cwd: fileURLToPath(repoFile("")), encoding: "utf8" });
	assert.equal(listing.status, 0, listing.stderr);
	const files = listing.stdout.split("\n").filter((path) => path.endsWith(".md"));
	assert.ok(files.length > 0, "git ls-files lista skills de claude/");
	const offenders: string[] = [];
	for (const path of files) {
		if (/ultracode/i.test(await readRepoFile(path))) offenders.push(path);
	}
	assert.deepEqual(offenders, []);
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
	assert.match(
		normalizeInvocations("invoca `/coding-policies go`", "/"),
		/«skill:coding-policies»/,
		"la lista de skills normalizables incluye coding-policies",
	);
});

// Spec #84 (CA-13 a CA-16): los borradores de planificación viven en
// <git-common-dir>/sdd/, fuera del working tree, y el árbol trackeado `.sdd/`
// sigue siendo el segundo lugar de lectura. Cada skill lleva un bloque
// delimitado idéntico entre harnesses con esa doctrina.
const COMMON_DIR_COMMAND = /`git rev-parse --path-format=absolute --git-common-dir`/;

const GRILL_DRAFTS_DOCTRINE = [
	/El handoff, el cuestionario y la carpeta de capturas se escriben en `<git-common-dir>\/sdd\/grills\/`, fuera del working tree/,
	COMMON_DIR_COMMAND,
	/Fuera de un repo git, en `\.sdd\/grills\/` del cwd/,
	/se miran los dos lugares: `\.sdd\/grills\/` del árbol[^\n]*`<git-common-dir>\/sdd\/grills\/`; ante el mismo nombre gana el del árbol/,
	/imprime su ruta absoluta/,
];

const SDD_SPEC_DRAFTS_DOCTRINE = [
	/La spec local se escribe en `<git-common-dir>\/sdd\/specs\/<slug>\.md`, fuera del working tree/,
	COMMON_DIR_COMMAND,
	/fuera de un repo git, en `\.sdd\/specs\/` del cwd/,
	/`\.sdd\/specs\/<slug>\.md` es su ruta lógica: se resuelve primero en el árbol trackeado[^\n]*y después en `<git-common-dir>\/sdd\/specs\/`/,
	/Los handoffs de `--from-grill` y la Fase 0 se listan de los dos lugares, `\.sdd\/grills\/` del árbol y `<git-common-dir>\/sdd\/grills\/`/,
	/La raíz operativa de un handoff sale de su campo `Proyecto`, no de dónde está guardado el archivo/,
	/imprime la ruta absoluta de la spec local/,
];

const SDD_RUN_DRAFTS_DOCTRINE = [
	/\*\*Borradores del common-dir\*\*: los artefactos de entrada se toman de `<git-common-dir>\/sdd\/`/,
	COMMON_DIR_COMMAND,
	/la spec target, el handoff canónico, su carpeta de capturas y las specs predecesoras/,
	/Por compatibilidad, también los que sigan sin trackear en `\.sdd\/` del checkout original/,
	/Se copian al worktree con el mismo nombre, bajo `\.sdd\/grills\/` y `\.sdd\/specs\/`, y entran en el PRIMER commit/,
	/Después de verificar ese commit[^\n]*se borran las copias de `<git-common-dir>\/sdd\/`/,
];

const ISSUE_TRIAGE_DRAFTS_DOCTRINE = [
	/`\.sdd\/grills\/` y `\.sdd\/specs\/` del árbol[^\n]*`<git-common-dir>\/sdd\/grills\/` y `<git-common-dir>\/sdd\/specs\/`/,
	COMMON_DIR_COMMAND,
	/El inventario y el linaje se resuelven en los dos lugares; ante el mismo nombre gana el del árbol/,
	/`superseded-by=\.sdd\/specs\/<x>\.md` se busca primero en el árbol y después en `<git-common-dir>\/sdd\/specs\/`/,
];

async function draftsBlocks(skill: string, block: string, patterns: RegExp[], harnesses: readonly Harness[] = HARNESSES): Promise<string[]> {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const problems: string[] = [];
	const byHarness = new Map<Harness, string[]>();
	for (const harness of harnesses) {
		const doctrine = delimitedDoctrine(await readRepoFile(`${harness}/${skill}/SKILL.md`), block);
		for (const pattern of patterns) {
			if (!pattern.test(doctrine)) problems.push(`${harness}/${skill}/SKILL.md (${block}) no declara ${pattern}`);
		}
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	const [reference, ...rest] = harnesses;
	for (const harness of rest) {
		const left = byHarness.get(reference!)?.[0] ?? "";
		const right = byHarness.get(harness)?.[0] ?? "";
		if (left !== right) problems.push(`${skill} (${block}): ${reference} vs ${harness} — ${firstDifference(left, right)}`);
	}
	return problems;
}

test("#84 CA-13: grill escribe handoff, cuestionario y capturas en <git-common-dir>/sdd/grills en los cuatro harnesses", async () => {
	const problems = await draftsBlocks("grill", "grill-drafts", GRILL_DRAFTS_DOCTRINE);
	for (const harness of HARNESSES) {
		const file = `${harness}/grill/SKILL.md`;
		const markdown = await readRepoFile(file);
		if (!/`<git-common-dir>\/sdd\/grills\/<fecha>-<slug>\.md`/.test(markdown)) problems.push(`${file}: el handoff no se escribe en <git-common-dir>/sdd/grills/<fecha>-<slug>.md`);
		if (!/`<git-common-dir>\/sdd\/grills\/<fecha>-<slug>-cuestionario\.md`/.test(markdown)) problems.push(`${file}: el cuestionario no se escribe en <git-common-dir>/sdd/grills/`);
		if (/`\.sdd\/grills\/<fecha>-<slug>(?:-cuestionario)?\.md`/.test(markdown)) problems.push(`${file}: todavía escribe en .sdd/grills/<fecha>-<slug>.md`);
		const design = delimitedDoctrine(markdown, "grill-design");
		if (!/se copian a `<git-common-dir>\/sdd\/grills\/<nombre-real-del-handoff>\/`/.test(design)) problems.push(`${file}: las capturas no se copian a <git-common-dir>/sdd/grills/`);
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-14: sdd-spec escribe la spec local en <git-common-dir>/sdd/specs y lista los dos lugares en los cuatro harnesses", async () => {
	const problems = await draftsBlocks("sdd-spec", "sdd-spec-drafts", SDD_SPEC_DRAFTS_DOCTRINE);
	for (const harness of HARNESSES) {
		const file = `${harness}/sdd-spec/SKILL.md`;
		const markdown = await readRepoFile(file);
		const flow = delimitedDoctrine(markdown, "sdd-spec-flow");
		if (!/`<git-common-dir>\/sdd\/specs\/<slug>\.md`/.test(flow)) problems.push(`${file}: el destino local de sdd-spec-flow no es <git-common-dir>/sdd/specs/<slug>.md`);
		if (/`local` = `\.sdd\/specs\/`/.test(markdown)) problems.push(`${file}: --out local todavía apunta a .sdd/specs/`);
		if (/ra[ií]z operativa (?:sale )?de la ubicaci[oó]n f[ií]sica|deriva la ra[ií]z operativa de la ubicaci[oó]n f[ií]sica/.test(markdown)) {
			problems.push(`${file}: la raíz operativa todavía sale de la ubicación física del handoff`);
		}
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-15: sdd-run toma los artefactos de entrada de <git-common-dir>/sdd/, los commitea en el worktree y borra las copias", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const doctrine = delimitedDoctrine(await readRepoFile(`${harness}/sdd-run/SKILL.md`), "sdd-run-dirty-checkout");
		for (const pattern of [...SDD_RUN_DRAFTS_DOCTRINE, /checkout original queda intacto/i]) {
			if (!pattern.test(doctrine)) problems.push(`${harness}/sdd-run/SKILL.md (sdd-run-dirty-checkout) no declara ${pattern}`);
		}
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-16: issue-triage resuelve el linaje en los dos lugares y los READMEs dicen dónde viven los borradores", async () => {
	const triageHarnesses = HARNESSES.filter((harness) => harness !== "opencode");
	const problems = await draftsBlocks("issue-triage", "issue-triage-drafts", ISSUE_TRIAGE_DRAFTS_DOCTRINE, triageHarnesses);
	for (const harness of ["claude", "codex"] as const) {
		const file = `${harness}/issue-triage/SKILL.md`;
		if (!/ubicado directamente bajo `<cwd>\/\.sdd\/grills\/` o `<git-common-dir>\/sdd\/grills\/`/.test(await readRepoFile(file))) {
			problems.push(`${file}: spec-from-grill no acepta el handoff de <git-common-dir>/sdd/grills/`);
		}
	}
	for (const path of ["README.md", "README.en.md"]) {
		const readme = await readRepoFile(path);
		for (const literal of ["`<git-common-dir>/sdd/grills/`", "`<git-common-dir>/sdd/specs/`", "`git rev-parse --path-format=absolute --git-common-dir`"]) {
			if (!readme.includes(literal)) problems.push(`${path}: no menciona ${literal}`);
		}
	}
	assert.deepEqual(problems, []);
});
