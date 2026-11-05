// Gate anti-drift de los productores SDD (issue #10).
//
// Extrae los templates de artefactos con marker Chiche-Tracking de los 16
// SKILL.md ({claude,codex,opencode,pi} × {chiche-init,chiche-spec,chiche-run,grill}),
// valida cada template contra el contrato docs/chiche-tracking-v2.md usando el
// parser de referencia (chiche-artifacts), y exige igualdad byte a byte entre
// harnesses tolerando SOLO las diferencias documentadas en
// docs/harness-interaction-differences.md. El censo lee los dos markers
// (`SDD-Tracking` v1 y `Chiche-Tracking` v2), pero un template de artefacto
// nuevo con `SDD-Tracking: version=1` es un defecto (issue #103, CA-13).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parseSddArtifact } from "../chiche-artifacts/index.ts";
import type { Fence, Harness } from "./interaction.ts";
import {
	HARNESSES,
	fencedBlocks,
	firstDifference,
	escapeRegExp,
	normalizeInvocations,
	parseInteractionTable,
} from "./interaction.ts";

const SKILLS = ["chiche-init", "chiche-spec", "chiche-run", "grill"] as const;
type Skill = (typeof SKILLS)[number];

type TemplateType = "spec" | "grill" | "project";

// Cuantos templates de marker exige cada skill, por tipo de artefacto.
const EXPECTED_TEMPLATES: Record<Skill, Record<TemplateType, number>> = {
	"chiche-init": { spec: 0, grill: 0, project: 1 },
	"chiche-spec": { spec: 2, grill: 0, project: 0 },
	"chiche-run": { spec: 1, grill: 0, project: 0 },
	grill: { spec: 0, grill: 1, project: 0 },
};

// Forma que debe declarar cada template, en orden de aparicion.
const EXPECTED_SHAPES: Record<Skill, RegExp[]> = {
	"chiche-init": [/type=project; generated-at=<YYYY-MM-DD>/],
	"chiche-spec": [
		/type=spec; state=<draft\|approved>; .*superseded-by=none/,
		/type=spec; state=superseded; .*superseded-by=<ref>/,
	],
	"chiche-run": [/type=spec; state=implemented; .*superseded-by=none/],
	grill: [/type=grill; state=<paused\|finalized>; /],
};

const EXPECTED_ARTIFACT_TYPE: Record<Skill, TemplateType> = {
	"chiche-init": "project",
	"chiche-spec": "spec",
	"chiche-run": "spec",
	grill: "grill",
};

const SDD_RUN_DIRTY_CHECKOUT_DOCTRINE = [
	/checkout sucio no bloquea por sí solo/i,
	/referencia remota actualizada/i,
	/artefactos de entrada del workflow/i,
	/spec target local/i,
	/`\.chiche\/project\.md`/,
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
	// Issue #102 CA-11: con A2 o A3 no se pregunta; «Por nivel» fija la conducta.
	/Con A2 o A3 no se pregunta: ver «Por nivel»/,
	/\*\*Por nivel\.\*\*[^\n]*`plan-approved` \(A2\)[^\n]*termina sin esperar[^\n]*`unattended` \(A3\)[^\n]*tope de 2 ciclos de corrección[^\n]*30 minutos sin feedback nuevo[^\n]*`SEGUIMIENTO DE FEEDBACK DETENIDO`/,
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

// Issue #45: chiche-spec avanza sin preguntar y cierra con un menú; doctrina
// idéntica entre harnesses dentro del bloque `chiche-spec-flow`.
const SDD_SPEC_FLOW_DOCTRINE = [
	/inferencias nuevas[\s\S]*`\[ASSUMED\]`[\s\S]*sin preguntar/i,
	/decisiones del handoff[\s\S]*confirmadas/i,
	/mecanismo[\s\S]*propuesto[\s\S]*alternativas[\s\S]*sin preguntar/i,
	/`--out`[\s\S]*fuerza/i,
	// Review de #105 (F7): Pi publica las issue-specs nuevas con `Chiche-Tracking`, así que se buscan las dos marcas.
	/`gh issue list --state all --limit 50 --search "SDD-Tracking in:body"` o `gh issue list --state all --limit 50 --search "Chiche-Tracking in:body"` devuelve al menos uno/,
	// Spec #84, CA-14 e issue #103, CA-5: el destino local es el common-dir de chiche, fuera del working tree.
	/`<git-common-dir>\/chiche\/specs\/<slug>\.md`/,
	/staging no-SDD/,
	/`Llevar a issue`/,
	/`Solicitar cambios`/,
	/`chiche-run --autonomy A3`[\s\S]*harnesses con subagentes lo delega en un `implementer`/,
	/`state=approved`[\s\S]*antes de lanzar/i,
	/comments[\s\S]*posteriores[\s\S]*última publicación/i,
	/--paginate/,
	/`updated_at`/,
	/vuelve al menú/i,
	/Con A2 o A3[\s\S]*no hay menú/,
];

// Issue #45: chiche-run imprime el plan y sigue, desvía sin preguntar cuando no
// cambia el alcance y ofrece code review post-PR. Bloque `chiche-run-flow`.
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
	antigravity: /`Code review` en Antigravity[\s\S]*`workflow_dispatch`[\s\S]*invoke_subagent[\s\S]*`\/code-review <PR>`/,
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
	antigravity: /usar `ask_question`[\s\S]*Resolver feedback automáticamente/,
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
const GRILL_LIGHT_SHORTCUT_HARNESSES: readonly Harness[] = ["claude", "codex", "opencode", "antigravity"];
const GRILL_FACT_EXPLORATION: Record<Harness, RegExp> = {
	claude: /`Agent`[\s\S]{0,80}`Explore`[\s\S]{0,80}background/,
	codex: /subagente `explorer`[\s\S]{0,400}misma ronda/,
	opencode: /subagente `explore`[\s\S]{0,80}`task`[\s\S]{0,400}misma ronda/,
	pi: /`subagent`[\s\S]{0,80}`scout`[\s\S]{0,80}`background: true`/,
	antigravity: /`invoke_subagent`[\s\S]{0,80}`research`[\s\S]{0,80}background/,
};

// Stacks de PRs por spec (issue #66, CA-1/CA-2): `chiche-spec` propone el corte
// en capas dentro de la spec; doctrina idéntica entre harnesses dentro del
// bloque `chiche-spec-delivery`.
const SDD_SPEC_DELIVERY_DOCTRINE = [
	/`## Plan de entrega`[\s\S]*`\| Capa \| Etapa \| CAs \| Justificacion \|`/,
	/cada capa es un grupo coherente de CAs[\s\S]*tests dan verde solos[\s\S]*regresión completa/i,
	/tamaño máximo de PR[\s\S]*activo[\s\S]*cada capa entra en el límite/i,
	/una sola capa[\s\S]*todo entra en un PR/i,
	/propuesta se escribe sin preguntar[\s\S]*`Solicitar cambios`/i,
];

// Stacks de PRs por spec (issue #66, CA-3 a CA-9): `chiche-run` entrega un stack
// nativo de GitHub cuando el Plan de entrega tiene 2 o más capas. Bloque
// `chiche-run-stack`, idéntico entre harnesses.
const SDD_RUN_STACK_DOCTRINE = [
	// CA-3: preflight
	/`## Plan de entrega` de 2 o más capas[\s\S]*`gh` ≥ 2\.90\.0[\s\S]*`git` ≥ 2\.36[\s\S]*`github\/gh-stack`[\s\S]*`gh extension list`/,
	/interactivo[\s\S]*`gh extension install github\/gh-stack` ahí mismo/,
	/con A2 o A3 frena antes de ramificar[\s\S]*comando exacto/,
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

const MARKER_LINE = /^[ \t]*<!--\s*(?:SDD|Chiche)-Tracking\s*:.*-->[ \t]*$/i;
const V1_MARKER = /^<!--\s*SDD-Tracking\s*:/i;
const V2_TEMPLATE_PREFIX = "<!-- Chiche-Tracking: version=2; ";

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
	// Templates que todavía instruyen `SDD-Tracking`: un artefacto nuevo nace v2.
	v1: { line: string; fenceLine: number }[];
	markerFences: Fence[];
}

export function censusTemplates(markdown: string): Census {
	const canonical: CanonicalTemplate[] = [];
	const legacy: { line: string; fenceLine: number }[] = [];
	const v1: { line: string; fenceLine: number }[] = [];
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
				if (V1_MARKER.test(line)) v1.push({ line, fenceLine: fence.line });
			} else {
				legacy.push({ line, fenceLine: fence.line });
			}
		}
	}
	return { canonical, legacy, v1, markerFences };
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
		if (parsed.markerName !== "Chiche-Tracking" || parsed.version !== 2) {
			problems.push(`instancia \`${variant}\` es un template ${parsed.markerName} v${parsed.version}: los artefactos nuevos nacen Chiche-Tracking: version=2`);
		}
	}
	return { ok: problems.length === 0, problems };
}

// Issue #102 CA-4: el bloque compartido `autonomy-resolve` (gateado por autonomy-gate) nombra el fallback
// `.sdd/project.md` en su prosa y en su comando canónico; los conteos de «una sola frase de fallback» lo excluyen.
function withoutAutonomyResolve(markdown: string): string {
	return markdown.replace(/<!-- autonomy-resolve:start -->\n[\s\S]*?\n<!-- autonomy-resolve:end -->/, "");
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
		test(`${harness}/${skill}: templates de marker v2 esperados, sin template v1 y sin marker legacy`, async () => {
			const census = censusTemplates(await readRepoFile(`${harness}/${skill}/SKILL.md`));
			assert.deepEqual(
				census.legacy,
				[],
				`${harness}/${skill}/SKILL.md instruye un marker legacy (sin version/type)`,
			);
			assert.deepEqual(
				census.v1,
				[],
				`${harness}/${skill}/SKILL.md instruye un template SDD-Tracking v1: los artefactos nuevos nacen Chiche-Tracking: version=2`,
			);
			for (const entry of census.canonical) {
				assert.ok(
					entry.line.startsWith(V2_TEMPLATE_PREFIX),
					`${harness}/${skill}/SKILL.md linea de fence ${entry.fenceLine}: el template no abre con \`${V2_TEMPLATE_PREFIX}\``,
				);
			}
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
				`${harness}/${skill}/SKILL.md no instruye los templates de marker v2 esperados`,
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
			if (skill === "chiche-run") {
				const resultado = fencedBlocks(markdown).find((fence) =>
					/^## Resultado de ejecucion/.test(fence.content),
				);
				if (resultado) {
					templates.push(normalizeInvocations(resultado.content, prefixes[harness]));
				} else {
					divergences.push(`chiche-run: ${harness} no instruye el template de ## Resultado de ejecucion`);
				}
			}
			byHarness.set(harness, templates);
		}
		divergences.push(...compareTemplates(skill, byHarness));
	}
	assert.deepEqual(divergences, []);
});

test("chiche-run tolera el checkout sucio, importa artefactos del workflow y aísla el resto en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-run/SKILL.md`);
		const doctrine = delimitedDoctrine(markdown, "chiche-run-dirty-checkout");
		for (const expected of SDD_RUN_DIRTY_CHECKOUT_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/chiche-run/SKILL.md no declara ${expected}`);
		}
		assert.doesNotMatch(
			markdown,
			/Única excepción — el spec target sin comitear|CUALQUIER otro path sucio[\s\S]{0,160}abort|cambios pendientes o estado a medias = abort/i,
			`${harness}/chiche-run/SKILL.md todavía bloquea el workflow por suciedad ordinaria`,
		);
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("chiche-run dirty checkout", byHarness), []);
});

test("chiche-run remedia feedback del PR de forma automática, opt-in y segura en cada harness", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-run/SKILL.md`);
		for (const doctrine of FEEDBACK_REMEDIATION_DOCTRINE) {
			assert.match(markdown, doctrine, `${harness}/chiche-run/SKILL.md no declara ${doctrine}`);
		}
		assert.match(
			markdown,
			FEEDBACK_REMEDIATION_QUESTION_STYLE[harness],
			`${harness}/chiche-run/SKILL.md no usa el gate de remediación propio del harness`,
		);
		assert.doesNotMatch(
			markdown,
			/no editar código[\s\S]*turno nuevo/i,
			`${harness}/chiche-run/SKILL.md todavía obliga a detenerse después de detectar feedback`,
		);
	}
});

test("chiche-spec exige la postcondición canónica antes de cualquier éxito observable en cada harness", async () => {
	const commonDoctrine = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-spec/SKILL.md`);
		const doctrine = delimitedDoctrine(markdown, "chiche-spec-publication-gate");
		for (const expected of SDD_SPEC_PUBLICATION_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/chiche-spec/SKILL.md no declara ${expected}`);
		}
		const doctrineStart = markdown.indexOf("<!-- chiche-spec-publication-gate:start -->");
		const reportStart = markdown.indexOf("## Reporte");
		assert.ok(doctrineStart >= 0 && reportStart >= 0 && doctrineStart < reportStart,
			`${harness}/chiche-spec/SKILL.md declara el gate después del reporte de éxito`);
		if (harness === "pi") {
			assert.match(doctrine, /`persist_sdd_spec`[\s\S]*`details\.receipt`/,
				"Pi debe ejecutar el boundary y comprobar su receipt estructurado");
		} else {
			assert.doesNotMatch(markdown, /`persist_sdd_spec`/,
				`${harness}/chiche-spec/SKILL.md no debe depender del runtime exclusivo de Pi`);
		}
		const normalizedDoctrine = harness === "pi"
			? doctrine.replace(
				/\n\nEn Pi,[\s\S]*$/,
				"\n\nLa ausencia de un runtime dedicado en este harness no relaja ninguna de estas postcondiciones.",
			)
			: doctrine;
		commonDoctrine.set(harness, [normalizedDoctrine]);
	}
	assert.deepEqual(compareTemplates("chiche-spec publication doctrine", commonDoctrine), []);
});

test("chiche-spec avanza sin preguntar inferencias ni mecanismo y cierra con menú en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /¿Alguna inferencia a revisar\?/, `${harness}/chiche-spec/SKILL.md todavía pregunta las inferencias`);
		assert.doesNotMatch(markdown, /¿Con qué lo verificamos\?/, `${harness}/chiche-spec/SKILL.md todavía pregunta el mecanismo`);
		assert.doesNotMatch(markdown, /¿Con qué intensidad\?/, `${harness}/chiche-spec/SKILL.md todavía pregunta la intensidad`);
		const doctrine = delimitedDoctrine(markdown, "chiche-spec-flow");
		for (const expected of SDD_SPEC_FLOW_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/chiche-spec/SKILL.md no declara ${expected}`);
		}
		const flowStart = markdown.indexOf("<!-- chiche-spec-flow:start -->");
		const reportStart = markdown.indexOf("## Reporte");
		assert.ok(flowStart >= 0 && reportStart >= 0 && flowStart < reportStart,
			`${harness}/chiche-spec/SKILL.md declara el flujo después del reporte`);
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("chiche-spec flow", byHarness), []);
});

test("chiche-spec no contradice que `Llevar a issue` conserva el .md, y Pi revierte la aprobación cancelada", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-spec/SKILL.md`);
		for (const line of markdown.split("\n")) {
			if (/(?:no crea además una|sin crear una) copia en `\.sdd\/specs\/`/.test(line)) {
				assert.match(line, /Llevar a issue/, `${harness}/chiche-spec/SKILL.md niega la copia local sin exceptuar Llevar a issue`);
			}
		}
		assert.doesNotMatch(delimitedDoctrine(markdown, "chiche-spec-publication-gate"), /`Ambos`/,
			`${harness}/chiche-spec/SKILL.md nombra una opción \`Ambos\` que ya no existe`);
	}
	const pi = await readRepoFile("pi/chiche-spec/SKILL.md");
	assert.match(pi, /`mode: "assume"`[\s\S]*`draft`[\s\S]*`mode: "interactive"`[\s\S]*`approved`/,
		"Pi declara qué mode del runtime publica draft y cuál aprueba");
	assert.match(pi, /cancel[\s\S]{0,200}revert[\s\S]{0,200}`draft`/i, "Pi revierte a draft si se cancela Ejecutar ahora");
});

test("chiche-spec lanza el run con subagente implementer en background en Claude y en Pi, nunca en codex ni opencode", async () => {
	const claude = await readRepoFile("claude/chiche-spec/SKILL.md");
	assert.match(claude, /subagent_type: "implementer"/);
	assert.match(claude, /run_in_background/);
	assert.match(claude, /`general-purpose`[\s\S]*(anunci|avis)/i);
	assert.match(claude, /`\/chiche-run <target> --autonomy A3 --inline`/);
	for (const harness of HARNESSES.filter((candidate) => candidate !== "claude")) {
		const markdown = await readRepoFile(`${harness}/chiche-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /subagent_type/, `${harness}/chiche-spec/SKILL.md no debe depender de subagentes de Claude`);
	}
	// Issue #44 CA-9/CA-12: Pi lanza la tool `subagent` con el agente bundleado
	// `implementer` en background y el task `/skill:chiche-run <target> --autonomy A3 --inline` (issue #102 CA-8).
	const pi = await readRepoFile("pi/chiche-spec/SKILL.md");
	assert.match(pi, /agent: "implementer"/, "pi/chiche-spec lanza el implementer bundleado");
	assert.match(pi, /background: true/, "pi/chiche-spec lanza el subagente en background");
	assert.match(pi, /`chiche-run --autonomy A3`[\s\S]*`\/skill:chiche-run <target> --autonomy A3 --inline`/, "pi/chiche-spec corre chiche-run desatendido en el hijo");
	assert.doesNotMatch(pi, /Pi no tiene subagentes/, "pi/chiche-spec ya tiene subagentes");
	assert.match(pi, PI_SCOUT_EXPLORATION, "pi/chiche-spec explora con scouts");
	assert.match(pi, PI_SCOUT_BUDGET_SPEC, "pi/chiche-spec acota los scouts: cantidad, exhaustividad, task cerrado y timeout");
	for (const harness of ["codex", "opencode"] as const) {
		const markdown = await readRepoFile(`${harness}/chiche-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /agent: "implementer"|background: true/, `${harness}/chiche-spec/SKILL.md no tiene subagentes`);
	}
});

test("chiche-run imprime el plan y sigue, desvía sin preguntar y ofrece code review post-PR en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-run/SKILL.md`);
		assert.doesNotMatch(markdown, /¿Con qué intensidad la corremos\?/, `${harness}/chiche-run/SKILL.md todavía pregunta la intensidad`);
		assert.doesNotMatch(markdown, /Interactivo: decirlo y preguntar si seguir/, `${harness}/chiche-run/SKILL.md todavía pregunta por specs en draft`);
		assert.doesNotMatch(markdown, /`Aprobar \(Recomendado\)` \/ `Ajustar`/, `${harness}/chiche-run/SKILL.md todavía frena en el gate del plan`);
		const doctrine = delimitedDoctrine(markdown, "chiche-run-flow");
		for (const expected of SDD_RUN_FLOW_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/chiche-run/SKILL.md no declara ${expected}`);
		}
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("chiche-run flow", byHarness), []);
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-run/SKILL.md`);
		assert.match(markdown, CODE_REVIEW_BRANCH[harness], `${harness}/chiche-run/SKILL.md no gatea su rama de Code review`);
		if (harness === "codex" || harness === "opencode") {
			assert.match(markdown, CODE_REVIEW_OFFER_QUALIFIED, `${harness}/chiche-run/SKILL.md ofrece Code review sin calificarlo como GHA-only`);
		}
		if (harness === "pi") {
			// Issue #44 CA-10/CA-12: Pi tiene subagentes via la tool `subagent`.
			assert.doesNotMatch(markdown, CODE_REVIEW_OFFER_QUALIFIED, "pi/chiche-run/SKILL.md ya no califica Code review como GHA-only");
			assert.doesNotMatch(markdown, /sin subagentes/i, "pi/chiche-run/SKILL.md ya no se declara sin subagentes");
			assert.match(markdown, /agent: "reviewer"[\s\S]*background: true[\s\S]*`\/skill:code-review <PR>`/, "pi/chiche-run lanza el reviewer bundleado en background");
			assert.match(markdown, /sin GHA y sin la tool[\s\S]*no aparece|tool `subagent` no est[aá] registrada[\s\S]*no aparece/i, "pi/chiche-run omite la opcion sin GHA ni tool");
			assert.match(markdown, PI_SCOUT_EXPLORATION, "pi/chiche-run explora con scouts en la Fase 2");
			assert.match(markdown, PI_SCOUT_BUDGET_RUN, "pi/chiche-run verifica inline por default y acota los scouts de la Fase 2");
			assert.match(markdown, PI_SCOUT_BUDGET_RUN_OVERFLOW, "pi/chiche-run resuelve el choque entre el tope de 2 scouts y un blast radius de mas de 2 areas");
		}
		if (harness !== "claude") {
			assert.doesNotMatch(markdown, /subagent_type/, `${harness}/chiche-run/SKILL.md no debe depender de subagentes de Claude`);
		}
		// Hallazgo 2: con A2 o A3 la política de dependencias `preguntar` no puede frenar.
		assert.match(markdown, /`preguntar` → [^\n]*con A2 o A3, no agregar la dep/, `${harness}/chiche-run/SKILL.md no frena con A2 o A3 ante deps 'preguntar'`);
	}
	const claude = await readRepoFile("claude/chiche-run/SKILL.md");
	assert.match(claude, /subagent_type: "reviewer"/, "Claude lanza el review con el subagente reviewer");
	assert.match(claude, /`\/code-review --comment`/, "Claude nombra el code review nativo");
});

test("chiche-spec propone el Plan de entrega en el template y el criterio de corte, sin '2+ specs encadenadas', en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-spec/SKILL.md`);
		assert.doesNotMatch(markdown, /2\+ specs encadenadas/, `${harness}/chiche-spec/SKILL.md todavía parte por tamaño en specs encadenadas`);
		const template = censusTemplates(markdown).markerFences[0]?.content ?? "";
		assert.match(
			template,
			/## Comportamiento esperado\n[^#]*\n## Plan de entrega\n[^#]*\| Capa \| Etapa \| CAs \| Justificacion \|\n[^#]*\n## Fuera de alcance\n/,
			`${harness}/chiche-spec/SKILL.md: el template no lleva ## Plan de entrega entre Comportamiento esperado y Fuera de alcance con la tabla Capa/Etapa/CAs/Justificacion`,
		);
		const doctrine = delimitedDoctrine(markdown, "chiche-spec-delivery");
		for (const expected of SDD_SPEC_DELIVERY_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/chiche-spec/SKILL.md no declara ${expected}`);
		}
		byHarness.set(harness, [normalizeInvocations(doctrine, prefixes[harness])]);
	}
	assert.deepEqual(compareTemplates("chiche-spec delivery", byHarness), []);
});

test("chiche-run entrega un stack de PRs por capas con preflight, verificación por capa y force acotado en cada harness", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const byHarness = new Map<Harness, string[]>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-run/SKILL.md`);
		const doctrine = delimitedDoctrine(markdown, "chiche-run-stack");
		for (const expected of SDD_RUN_STACK_DOCTRINE) {
			assert.match(doctrine, expected, `${harness}/chiche-run/SKILL.md no declara ${expected}`);
		}
		// CA-6: el template de resultado lleva la columna Capa.
		const resultado = fencedBlocks(markdown).find((fence) => /^## Resultado de ejecucion/.test(fence.content));
		assert.match(
			resultado?.content ?? "",
			/\| CA \| Capa \| Estado \| Evidencia \|\n\|---\|---\|---\|---\|\n\| CA-1 \| 1\/1 \|/,
			`${harness}/chiche-run/SKILL.md: el template de Resultado de ejecucion no lleva la columna Capa`,
		);
		// Remediación de review PR #67: con 2 o más capas el push lo hace gh stack submit.
		const phase5 = markdown.match(/## Fase 5 — PR\n([\s\S]*?)(?=\n## )/)?.[1] ?? "";
		assert.match(
			phase5,
			/con 2 o más capas el push lo hace `gh stack submit`[\s\S]*solo verifica aptitud y stop list[\s\S]*no ejecuta `git push -u origin sdd\/<slug>`/,
			`${harness}/chiche-run/SKILL.md: Fase 5 paso 1 sigue ordenando git push -u con 2 o más capas`,
		);
		// CA-10: el reporte sugiere chiche-land y lista los PRs por capa.
		const report = fencedBlocks(markdown).find((fence) => /^Run completo:/.test(fence.content));
		assert.ok(report, `${harness}/chiche-run/SKILL.md no instruye el bloque Run completo`);
		assert.match(report.content, new RegExp(`siguiente paso: ${escapeRegExp(prefixes[harness])}chiche-land <stack\\|PR>`), `${harness}/chiche-run/SKILL.md: Run completo sin la línea siguiente paso`);
		assert.match(report.content, /PRs por capa/, `${harness}/chiche-run/SKILL.md: Run completo no lista los PRs por capa`);
		// CA-9: MUST DO y MUST NOT DO nombran el force acotado.
		for (const heading of ["MUST DO", "MUST NOT DO"]) {
			const section = markdown.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? "";
			assert.match(section, /--force-with-lease[\s\S]*`gh stack (?:push|sync|rebase)`/, `${harness}/chiche-run/SKILL.md ## ${heading} no acota el force a gh stack`);
		}
		byHarness.set(harness, [
			normalizeInvocations(doctrine, prefixes[harness]),
			normalizeInvocations(report.content, prefixes[harness]),
		]);
	}
	assert.deepEqual(compareTemplates("chiche-run stack", byHarness), []);
});

const RIESGO_DE_MERGE_TEMPLATE = [
	"## Riesgo de merge",
	"Reversible con un revert: <sí | no>. <si no: qué cambió afuera del repo y cómo se vuelve atrás: backup, flag, script, comando>",
	"Si sale mal, le pega a: <usuarios, sistemas o flujos afectados, una frase>",
].join("\n");

test("chiche-run pide el loop rojo antes de tocar código y la sección Riesgo de merge en el body del PR", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-run/SKILL.md`);
		const risk = fencedBlocks(markdown).filter((fence) => /^## Riesgo de merge/.test(fence.content));
		assert.equal(risk.length, 1, `${harness}/chiche-run/SKILL.md: debe traer un solo template de Riesgo de merge`);
		assert.equal(risk[0]?.content, RIESGO_DE_MERGE_TEMPLATE, `${harness}/chiche-run/SKILL.md: el template de Riesgo de merge no es byte-idéntico`);
		// El template fenced lleva su propio "## " en columna 0: la subsección se delimita por la Fase 6, no por el primer "\n## ".
		const risk5 = markdown.match(/### Riesgo de merge en el body\n([\s\S]*?)(?=\n## Fase 6)/)?.[1] ?? "";
		assert.match(risk5, /es `no` y el body no dice cómo se vuelve atrás[^\n]*`--draft`/, `${harness}/chiche-run/SKILL.md: la regla de draft por riesgo sin rollback no está en la subsección`);
		assert.match(risk5, /PR de abajo[\s\S]*capas superiores/, `${harness}/chiche-run/SKILL.md: no distingue PR de abajo y capas superiores`);
		assert.match(risk5, /el draft va a la capa que no se revierte/, `${harness}/chiche-run/SKILL.md: no dice qué capa del stack sale en draft`);
		assert.match(risk5, /antes de `## Riesgo de merge`[\s\S]*conserva esa sección/, `${harness}/chiche-run/SKILL.md: no protege la sección ante la Fase 6`);
		assert.match(risk5, /`pendiente tuyo`/, `${harness}/chiche-run/SKILL.md: el draft por riesgo no se reporta`);
		const budget = markdown.match(/\n3\. \*\*Presupuesto por CA\*\*[^\n]*(?:\n   [^\n]*)*/)?.[0] ?? "";
		assert.match(budget, /loop rojo/, `${harness}/chiche-run/SKILL.md: el presupuesto por CA no exige el loop rojo`);
		assert.match(budget, /no cuentan/, `${harness}/chiche-run/SKILL.md: sin loop rojo los intentos no cuentan`);
		assert.match(budget, /después de implementarlo/, `${harness}/chiche-run/SKILL.md: el loop rojo no está acotado a CAs rotos`);
		assert.match(budget, /sin loop rojo»[^\n]*se sigue con los demás/, `${harness}/chiche-run/SKILL.md: falta el tope cuando no se arma el loop`);
		assert.match(markdown, /salvo la FALLA «sin loop rojo»/, `${harness}/chiche-run/SKILL.md: Timeouts no exceptúa la FALLA sin loop rojo`);
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
		"| Campo | claude | codex | opencode | pi | antigravity |",
		"|---|---|---|---|---|---|",
		"| invocacion | `/nombre` | `$nombre` | `/nombre` | `/skill:nombre` | `/nombre` |",
		"| tool-preguntas | `AskUserQuestion` | `request_user_input` | — | `ask_user_question` | `ask_question` |",
		"<!-- interaction-differences:end -->",
	].join("\n");
	assert.deepEqual(parseInteractionTable(doc).questionTools, {
		claude: "AskUserQuestion",
		codex: "request_user_input",
		opencode: null,
		pi: "ask_user_question",
		antigravity: "ask_question",
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

test(".chiche/project.md lleva el marker canonico type=project", async () => {
	const parsed = parseSddArtifact(await readRepoFile(".chiche/project.md"));
	assert.equal(parsed.kind, "metadata", "el contrato del repo tiene metadata SDD");
	assert.ok(parsed.kind === "metadata" && parsed.format === "canonical", "el marker es canonico, no legacy");
	assert.ok(
		parsed.kind === "metadata" && parsed.format === "canonical" && parsed.metadata.type === "project",
		"el marker declara type=project",
	);
});

// --- #103 CA-21: los alias sdd-<x> se retiraron en 4.0.0 ---------------------

const RETIRED_ALIASES = ["sdd-init", "sdd-spec", "sdd-run", "sdd-land"] as const;

// Lineas que el grep de CA-21 puede devolver: solo las de los README que dicen que los
// nombres "se retiraron en 4.0.0" / "were retired in 4.0.0" (una linea que solo menciona
// "retirar" otra cosa no cuenta) y la frase de la instalacion manual que manda borrar a
// mano las cuatro carpetas (quien copio con `cp -R` no tiene manifest que las pode).
const RETIREMENT_NOTE =
	/^README(?:\.en)?\.md:\d+:(?:.*(?:\bse retiraron en 4\.0\.0|\bwere retired in 4\.0\.0)|Si copiaste a mano, no hay manifest: borrá vos las carpetas |If you copied by hand there is no manifest: delete the )/;

// Los nombres retirados en los archivos TRACKEADOS (git grep): un archivo suelto sin
// trackear no cuenta. Estado 0 si hay coincidencias, 1 si no hay, mayor que 1 si git falla.
// El borde es "fin de linea o un caracter que no continua el identificador": `\b` no sirve
// porque `-` es borde de palabra y `sdd-spec-publication` (identificador persistido) pasaria.
function grepRetiredNames(cwd: string) {
	return spawnSync(
		"git",
		["grep", "-n", "-E", "sdd-(init|spec|run|land)([^A-Za-z0-9_-]|$)", "--", "claude", "codex", "opencode", "pi", "antigravity", "agents", "evals", "README.md", "README.en.md"],
		{ cwd, encoding: "utf8" },
	);
}

test("#103 CA-21: ninguna carpeta sdd-* reaparece en ningun harness", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		for (const alias of RETIRED_ALIASES) {
			const text = await readRepoFile(`${harness}/${alias}/SKILL.md`).catch(() => null);
			if (text !== null) problems.push(`${harness}/${alias}/SKILL.md: el alias se retiro en 4.0.0`);
		}
	}
	assert.deepEqual(problems, []);
});

test("#103 CA-21: fuera de la nota de retiro de los README nadie nombra sdd-init|spec|run|land", () => {
	const grep = grepRetiredNames(fileURLToPath(repoFile("")));
	assert.equal(grep.status, 0, `el grep debe hallar la nota de retiro de los README (estado ${grep.status}): ${grep.stderr}`);
	const lines = grep.stdout.split("\n").filter((line) => line.length > 0);
	assert.deepEqual(lines.filter((line) => !RETIREMENT_NOTE.test(line)), [], "solo queda la nota de retiro de los README");
	for (const readme of ["README.md", "README.en.md"]) {
		assert.ok(lines.some((line) => line.startsWith(`${readme}:`)), `${readme} registra el retiro`);
	}
});

test("#103 CA-21: el grep mira archivos trackeados: un archivo suelto sin trackear que nombra sdd-run no falla el gate", async () => {
	const repo = await mkdtemp(join(tmpdir(), "chiche-ca21-"));
	try {
		const git = (...args: string[]) => {
			const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
			assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
		};
		git("init", "-q");
		for (const dir of ["claude", "codex", "opencode", "pi", "antigravity", "agents", "evals"]) await mkdir(join(repo, dir), { recursive: true });
		await writeFile(join(repo, "README.md"), "Los nombres `sdd-run` y `sdd-land` se retiraron en 4.0.0.\n");
		await writeFile(join(repo, "README.en.md"), "The names `sdd-run` and `sdd-land` were retired in 4.0.0.\n");
		git("add", "README.md", "README.en.md");
		await writeFile(join(repo, "claude", "scratch.md"), "borrador suelto: sdd-run\n");

		const grep = grepRetiredNames(repo);
		assert.equal(grep.status, 0, grep.stderr);
		const lines = grep.stdout.split("\n").filter((line) => line.length > 0);
		assert.equal(lines.length, 2, `solo las lineas trackeadas de los dos README: ${lines.join(" | ")}`);
		for (const line of lines) assert.match(line, RETIREMENT_NOTE);
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
});

test("#103 CA-21: el borde del grep no confunde sdd-spec-publication ni sdd-spec-inspection con sdd-spec, pero sí cuenta el nombre al final de línea o antes de puntuación", async () => {
	const repo = await mkdtemp(join(tmpdir(), "chiche-ca21-boundary-"));
	try {
		const git = (...args: string[]) => {
			const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
			assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
		};
		git("init", "-q");
		for (const dir of ["claude", "codex", "opencode", "pi", "antigravity", "agents", "evals"]) await mkdir(join(repo, dir), { recursive: true });
		await writeFile(join(repo, "README.md"), "# readme\n");
		await writeFile(join(repo, "README.en.md"), "# readme\n");
		// Identificadores persistidos de la capa 2: `-` es borde de palabra, pero no son el nombre retirado.
		await writeFile(join(repo, "pi", "persisted.ts"), 'const a = "sdd-spec-publication";\nconst b = "sdd-spec-inspection";\n');
		git("add", ".");

		const persisted = grepRetiredNames(repo);
		assert.equal(persisted.status, 1, `los identificadores persistidos no cuentan (estado ${persisted.status}): ${persisted.stdout}${persisted.stderr}`);
		assert.equal(persisted.stdout, "");

		// Controles: el nombre retirado sí cuenta al final de línea y antes de cualquier puntuación.
		await writeFile(join(repo, "agents", "names.md"), "usá sdd-land\n`sdd-init`, sdd-run. (sdd-spec) sdd-land:\n");
		git("add", ".");
		const names = grepRetiredNames(repo);
		assert.equal(names.status, 0, names.stderr);
		const lines = names.stdout.split("\n").filter((line) => line.length > 0);
		assert.deepEqual(lines.map((line) => line.split(":")[0]), ["agents/names.md", "agents/names.md"], `solo las dos líneas de names.md: ${lines.join(" | ")}`);
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
});

test("autotest: RETIREMENT_NOTE acepta las frases de retiro y de instalación manual de los README y rechaza cualquier otra linea", () => {
	assert.match("README.md:22:Los nombres anteriores `sdd-init` y `sdd-run` se retiraron en 4.0.0: migrá.", RETIREMENT_NOTE);
	assert.match("README.en.md:24:The previous names `sdd-init` were retired in 4.0.0: migrate.", RETIREMENT_NOTE);
	assert.match("README.md:271:Si copiaste a mano, no hay manifest: borrá vos las carpetas `sdd-init`, `sdd-spec`, `sdd-run` y `sdd-land` de cada destino.", RETIREMENT_NOTE);
	assert.match("README.en.md:273:If you copied by hand there is no manifest: delete the `sdd-init`, `sdd-spec`, `sdd-run` and `sdd-land` folders from each destination yourself.", RETIREMENT_NOTE);
	assert.doesNotMatch("README.md:30:Para retirar el tag de `sdd-run` usá git tag -d.", RETIREMENT_NOTE);
	assert.doesNotMatch("README.md:32:Antes: Si copiaste a mano, no hay manifest: borrá vos las carpetas `sdd-run`.", RETIREMENT_NOTE);
	assert.doesNotMatch("claude/grill/SKILL.md:9:Si copiaste a mano, no hay manifest: borrá vos las carpetas `sdd-run`.", RETIREMENT_NOTE);
	assert.doesNotMatch("README.md:31:`sdd-spec` se retiraron en 3.0.0.", RETIREMENT_NOTE);
	assert.doesNotMatch("claude/grill/SKILL.md:9:`sdd-run` se retiraron en 4.0.0.", RETIREMENT_NOTE);
});

// --- #103 CA-17: el arbol usa chichex/chiche --------------------------------

// El nombre viejo del repo. Se arma con join para que este archivo no se encuentre a si mismo.
const OLD_REPO_NAME = ["chichex", "skills"].join("/");

interface OldNameAllowance {
	file: string;
	test: RegExp;
	// Cantidad exacta de lineas del archivo que esta entrada debe cubrir; sin ella, una o mas.
	exactly?: number;
}

// Unicas lineas trackeadas que pueden seguir nombrando el repo viejo (decision L46 de la spec chiche-rename).
// Los artefactos historicos congelados de .chiche/grills y .chiche/specs quedan fuera del grep.
const OLD_NAME_ALLOWANCES: OldNameAllowance[] = [
	// La nota de instalacion de cada README: una sola linea por README.
	{ file: "README.md", test: /\bse llamaba `chichex\/skills`/, exactly: 1 },
	{ file: "README.en.md", test: /\bwas named `chichex\/skills`/, exactly: 1 },
	// install.sh: el rotulo viejo del bloque de Codex (para reemplazarlo) y la deteccion en `pi list`,
	// que sigue reconociendo la fuente que el usuario tipeo antes del renombre. El comentario de esa
	// deteccion se admite con su texto exacto: un comentario nuevo que nombre el repo viejo falla.
	{ file: "install.sh", test: /^CODEX_LEGACY_(?:BEGIN|END)=/ },
	{ file: "install.sh", test: /grep -F -q -e 'chichex\/skills'/ },
	{ file: "install.sh", test: /^ {2}# y también la fuente vieja `git:github\.com\/chichex\/skills`: `pi list` muestra$/ },
	// Los tests que ejercitan ese bloque viejo y esa deteccion.
	{ file: "pi-extensions/agents-gate/agents-gate.test.ts", test: /"# (?:>>>|<<<) chichex\/skills: prefer Codex over Pi (?:>>>|<<<)"/ },
	{ file: "pi-extensions/agents-gate/agents-gate.test.ts", test: /^test\("issue #103 CA-10: install\.sh codex reemplaza el bloque viejo chichex\/skills de config\.toml/ },
	{ file: "pi-extensions/pi-package/pi-package.test.ts", test: /"# (?:>>>|<<<) chichex\/skills: prefer Codex over Pi (?:>>>|<<<)"/ },
	{ file: "pi-extensions/pi-package/pi-package.test.ts", test: /rotulo viejo chichex\/skills;/ },
	{ file: "pi-extensions/pi-package/pi-package.test.ts", test: /assert\.doesNotMatch\(configAfter, \/chichex\\\/skills\/, "the old chichex\/skills block must be replaced/ },
	{ file: "pi-extensions/pi-package/pi-package.test.ts", test: /for \(const source of \["git:github\.com\/chichex\/skills", "git:github\.com\/chichex\/chiche"\]\)/ },
	// El titulo de este gate nombra el repo viejo (el resto de este archivo lo arma con OLD_REPO_NAME).
	{ file: "pi-extensions/harness-gate/harness-gate.test.ts", test: /^test\("issue #103 CA-17: el árbol usa chichex\/chiche; chichex\/skills solo sobrevive/ },
	// Entradas fechadas de `## Decisiones humanas` (historia del renombre) y la limitacion de la deteccion en `## Gaps`.
	{ file: ".chiche/project.md", test: /^- \d{4}-\d{2}-\d{2}: / },
	{ file: ".chiche/project.md", test: /^- La deteccion de "el Pi Package nativo ya esta instalado"/ },
];

// Tope de lineas por archivo, ademas de la allowlist: install.sh nombra el repo viejo en cuatro lineas
// (los dos rotulos del bloque de Codex, el comentario de la deteccion y su grep sobre `pi list`).
const OLD_NAME_FILE_LIMITS: Record<string, number> = { "install.sh": 4 };

// Lineas `archivo:numero:texto` de git grep que ninguna entrada cubre, las entradas con `exactly`
// que no cubren exactamente esa cantidad de lineas y los archivos que pasan su tope de lineas.
function oldNameProblems(grepLines: string[], allowances: OldNameAllowance[], limits: Record<string, number> = {}): string[] {
	const problems: string[] = [];
	const covered = new Map<OldNameAllowance, number>();
	const perFile = new Map<string, number>();
	for (const line of grepLines) {
		const match = /^([^:]+):(\d+):(.*)$/.exec(line);
		if (match === null) {
			problems.push(`${line}: salida de git grep ilegible`);
			continue;
		}
		const [, file, , text] = match;
		perFile.set(file ?? "", (perFile.get(file ?? "") ?? 0) + 1);
		const entry = allowances.find((allowance) => allowance.file === file && allowance.test.test(text ?? ""));
		if (entry === undefined) problems.push(`${file}:${match[2]}: nombra el repo viejo y no esta en la allowlist`);
		else covered.set(entry, (covered.get(entry) ?? 0) + 1);
	}
	for (const allowance of allowances) {
		if (allowance.exactly !== undefined && (covered.get(allowance) ?? 0) !== allowance.exactly) {
			problems.push(`${allowance.file}: la nota ${allowance.test} debe aparecer ${allowance.exactly} vez y aparece ${covered.get(allowance) ?? 0}`);
		}
	}
	for (const [file, limit] of Object.entries(limits)) {
		const count = perFile.get(file) ?? 0;
		if (count > limit) problems.push(`${file}: nombra el repo viejo en ${count} lineas y el tope es ${limit}`);
	}
	return problems;
}

// Archivos TRACKEADOS (git grep), sin los artefactos historicos congelados. Estado 0 si hay
// coincidencias, 1 si no hay, mayor que 1 si git falla.
function grepOldRepoName(cwd: string) {
	return spawnSync("git", ["grep", "-n", "-F", OLD_REPO_NAME, "--", ".", ":!.chiche/grills", ":!.chiche/specs"], { cwd, encoding: "utf8" });
}

test("issue #103 CA-17: el árbol usa chichex/chiche; chichex/skills solo sobrevive en la allowlist", () => {
	const grep = grepOldRepoName(fileURLToPath(repoFile("")));
	assert.ok(grep.status === 0 || grep.status === 1, `git grep fallo (estado ${grep.status}): ${grep.stderr}`);
	const lines = grep.stdout.split("\n").filter((line) => line.length > 0);
	assert.deepEqual(oldNameProblems(lines, OLD_NAME_ALLOWANCES, OLD_NAME_FILE_LIMITS), []);
});

test("autotest: oldNameProblems rechaza una linea fuera de la allowlist y una nota de README repetida o ausente", () => {
	const allowances: OldNameAllowance[] = [
		{ file: "README.md", test: /\bse llamaba `chichex\/skills`/, exactly: 1 },
		{ file: "install.sh", test: /^CODEX_LEGACY_(?:BEGIN|END)=/ },
	];
	const noteTest = allowances[0]?.test;
	const note = `README.md:10:**El repo se llamaba \`${OLD_REPO_NAME}\`.** Actualizá el remote.`;
	const legacy = `install.sh:52:CODEX_LEGACY_BEGIN="# >>> ${OLD_REPO_NAME}: prefer Codex over Pi >>>"`;
	const uncovered = (file: string, line: number) => `${file}:${line}: nombra el repo viejo y no esta en la allowlist`;
	const noteCount = (count: number) => `README.md: la nota ${noteTest} debe aparecer 1 vez y aparece ${count}`;

	assert.deepEqual(oldNameProblems([note, legacy], allowances), []);
	assert.deepEqual(oldNameProblems([`README.md:99:pi install git:github.com/${OLD_REPO_NAME}`, note], allowances), [uncovered("README.md", 99)]);
	assert.deepEqual(oldNameProblems([`package.json:10:"repository": "https://github.com/${OLD_REPO_NAME}.git"`], allowances), [
		uncovered("package.json", 10),
		noteCount(0),
	]);
	assert.deepEqual(oldNameProblems([note, `README.md:11:Tambien se llamaba \`${OLD_REPO_NAME}\`.`], allowances), [noteCount(2)]);
	assert.deepEqual(oldNameProblems([note, `install.sh:60:echo ${OLD_REPO_NAME}`], allowances), [uncovered("install.sh", 60)]);
});

test("issue #103 CA-17: el grep mira archivos trackeados y deja afuera .chiche/grills y .chiche/specs", async () => {
	const repo = await mkdtemp(join(tmpdir(), "chiche-ca17-"));
	try {
		const git = (...args: string[]) => {
			const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
			assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
		};
		git("init", "-q");
		for (const dir of [".chiche/grills", ".chiche/specs"]) await mkdir(join(repo, dir), { recursive: true });
		await writeFile(join(repo, "README.md"), `antes \`${OLD_REPO_NAME}\`\n`);
		await writeFile(join(repo, ".chiche/grills/historico.md"), `${OLD_REPO_NAME}\n`);
		await writeFile(join(repo, ".chiche/specs/historica.md"), `${OLD_REPO_NAME}\n`);
		git("add", "README.md", ".chiche");
		await writeFile(join(repo, "suelto.md"), `${OLD_REPO_NAME}\n`);

		const grep = grepOldRepoName(repo);
		assert.equal(grep.status, 0, grep.stderr);
		assert.deepEqual(grep.stdout.split("\n").filter((line) => line.length > 0), [`README.md:1:antes \`${OLD_REPO_NAME}\``]);
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
});

// --- #103 CA-18: los README presentan chiche ------------------------------------

const README_PITCH = [
	{ path: "README.md", tagline: "anda un chiche", flow: "## El flujo chiche", retirement: "se retiraron en 4.0.0" },
	{ path: "README.en.md", tagline: "you choose how much the agent decides", flow: "## The chiche workflow", retirement: "were retired in 4.0.0" },
] as const;

const CHICHE_FLOW_CHAIN = "chiche-init → chiche-spec → chiche-run → chiche-land";
// La unica mencion de SDD como nombre de la suite: la nota tecnica del pitch.
const SDD_TECHNICAL_NOTE = "Spec-Driven Development (SDD)";
// SDD como palabra suelta; `SDD-Tracking`, `sdd-events-v1` o `SDD` entre backticks son identificadores.
const SDD_STANDALONE = /(^|[^\w`-])SDD(?=[^\w`-]|$)/g;

// Cuantas veces una linea nombra SDD como palabra suelta.
function standaloneSddCount(line: string): number {
	return (line.match(SDD_STANDALONE) ?? []).length;
}

// Review #109 (6): la nota tecnica nombra SDD exactamente una vez (la de «Spec-Driven Development (SDD)»);
// cualquier otra linea, ninguna. Antes la linea de la nota quedaba exenta entera.
function sddMentionProblems(path: string, lines: string[]): string[] {
	const problems: string[] = [];
	lines.forEach((line, index) => {
		const count = standaloneSddCount(line);
		if (line.includes(SDD_TECHNICAL_NOTE)) {
			if (count !== 1) problems.push(`${path}:${index + 1}: la nota técnica nombra SDD ${count} veces y debe nombrarlo 1`);
		} else if (count > 0) problems.push(`${path}:${index + 1}: nombra SDD como suite fuera de la nota técnica`);
	});
	return problems;
}

test("issue #103 CA-18 (issue #102 CA-20): los README se titulan # chiche, abren con el tagline, nombran los niveles y --autonomy, y el flujo chiche", async () => {
	const problems: string[] = [];
	for (const readme of README_PITCH) {
		const markdown = await readRepoFile(readme.path);
		const lines = markdown.split("\n");
		if (lines[0] !== "# chiche") problems.push(`${readme.path}: la línea 1 es «${lines[0]}» y debe ser «# chiche»`);
		if (!lines.slice(0, 8).join("\n").toLowerCase().includes(readme.tagline)) problems.push(`${readme.path}: las primeras 8 líneas no dicen «${readme.tagline}»`);
		// Issue #102 CA-20: el párrafo de apertura nombra los tres niveles y el flag del dial.
		const opening = lines.slice(0, 8).join("\n");
		for (const token of ["`supervised`", "`plan-approved`", "`unattended`", "`--autonomy`"]) {
			if (!opening.includes(token)) problems.push(`${readme.path}: el párrafo de apertura no nombra ${token}`);
		}

		const flowStart = lines.indexOf(readme.flow);
		if (flowStart === -1) problems.push(`${readme.path}: falta el heading «${readme.flow}»`);
		else {
			const flowEnd = lines.findIndex((line, index) => index > flowStart && line.startsWith("## "));
			const flow = lines.slice(flowStart, flowEnd === -1 ? undefined : flowEnd).join("\n");
			if (!flow.includes(CHICHE_FLOW_CHAIN)) problems.push(`${readme.path}: la sección «${readme.flow}» no nombra «${CHICHE_FLOW_CHAIN}»`);
		}

		const noteCount = markdown.split(SDD_TECHNICAL_NOTE).length - 1;
		if (noteCount !== 1) problems.push(`${readme.path}: «${SDD_TECHNICAL_NOTE}» aparece ${noteCount} veces y debe aparecer 1`);
		problems.push(...sddMentionProblems(readme.path, lines));

		if (!markdown.includes(readme.retirement)) problems.push(`${readme.path}: perdió la nota de retiro «${readme.retirement}»`);
	}
	assert.deepEqual(problems, []);
});

// --- Autotests del gate: puede fallar y con que diagnostico ------------------

test("autotest: la nota técnica admite un solo SDD suelto y el resto de las líneas ninguno", () => {
	const note = `Por detrás es **${SDD_TECHNICAL_NOTE}**: contrato → spec → ejecución → cierre.`;
	assert.deepEqual(sddMentionProblems("README.md", ["# chiche", note, "`SDD-Tracking` y `sdd-events-v1` son identificadores."]), []);
	assert.deepEqual(sddMentionProblems("README.md", [`${note} SDD manda.`]), ["README.md:1: la nota técnica nombra SDD 2 veces y debe nombrarlo 1"]);
	assert.deepEqual(sddMentionProblems("README.md", [note, "## El workflow SDD"]), ["README.md:2: nombra SDD como suite fuera de la nota técnica"]);
});

test("autotest: una divergencia entre harnesses se reporta con la linea que difiere", () => {
	const byHarness = new Map<Harness, string[]>([
		["claude", ["# Spec — <titulo>\nlinea comun"]],
		["codex", ["# Spec — <titulo>\nlinea comun"]],
		["opencode", ["# Spec — <titulo>\nlinea DIVERGENTE"]],
		["pi", ["# Spec — <titulo>\nlinea comun"]],
		["antigravity", ["# Spec — <titulo>\nlinea comun"]],
	]);
	const divergences = compareTemplates("chiche-spec", byHarness);
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
		["antigravity", ["template"]],
	]);
	const divergences = compareTemplates("grill", byHarness);
	assert.equal(divergences.length, 1);
	assert.match(divergences[0] ?? "", /1 templates y opencode tiene 0/);
});

test("autotest: un template no canonico falla la validacion con diagnostico del contrato", () => {
	const verdict = validateTemplateLine(
		"<!-- Chiche-Tracking: version=2; type=spec; state=<draft|approved>; issue=<#NN|owner/repo#NN|none>; grill=<ref|none> -->",
		"spec",
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /missing-key/);
});

test("autotest: un template Chiche-Tracking v2 canonico pasa la validacion", () => {
	const line = "<!-- Chiche-Tracking: version=2; type=spec; state=<draft|approved>; issue=<#NN|owner/repo#NN|none>; grill=<ref|none>; superseded-by=none -->";
	assert.deepEqual(validateTemplateLine(line, "spec"), { ok: true, problems: [] });
	const census = censusTemplates(["```markdown", "# Spec — X", line, "```"].join("\n"));
	assert.equal(census.canonical.length, 1);
	assert.deepEqual(census.v1, []);
	assert.deepEqual(census.legacy, []);
});

test("autotest: un template SDD-Tracking v1 se censa y se reporta como template v1", () => {
	const line = "<!-- SDD-Tracking: version=1; type=spec; state=<draft|approved>; issue=<#NN|owner/repo#NN|none>; grill=<ref|none>; superseded-by=none -->";
	const census = censusTemplates(["```markdown", "# Spec — X", line, "```"].join("\n"));
	assert.equal(census.canonical.length, 1, "el censo todavia lee el marker v1");
	assert.equal(census.v1.length, 1, "pero lo clasifica como template v1");
	const verdict = validateTemplateLine(line, "spec");
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join("\n"), /template SDD-Tracking v1: los artefactos nuevos nacen Chiche-Tracking: version=2/);
});

test("autotest: un marker legacy dentro de un template se clasifica como legacy", () => {
	const census = censusTemplates(
		["```markdown", "# Spec — X", "<!-- SDD-Tracking: issue=#9; grill=none -->", "```"].join("\n"),
	);
	assert.equal(census.canonical.length, 0);
	assert.equal(census.legacy.length, 1);
});

test("autotest: la normalizacion reduce las tres sintaxis de invocacion al mismo token", () => {
	const claude = normalizeInvocations("<!-- Generada por /chiche-spec el <fecha>. -->", "/");
	const codex = normalizeInvocations("<!-- Generada por $chiche-spec el <fecha>. -->", "$");
	const pi = normalizeInvocations("<!-- Generada por /skill:chiche-spec el <fecha>. -->", "/skill:");
	assert.equal(claude, codex);
	assert.equal(codex, pi);
	assert.match(claude, /«skill:chiche-spec»/);
	assert.equal(normalizeInvocations("archivo en .sdd/grills/x.md", "/"), "archivo en .sdd/grills/x.md");
	assert.match(
		normalizeInvocations("invoca `/coding-policies go`", "/"),
		/«skill:coding-policies»/,
		"la lista de skills normalizables incluye coding-policies",
	);
});

// Spec #84 (CA-13 a CA-16) e issue #103 (CA-1, CA-5): los borradores de
// planificación se escriben en <git-common-dir>/chiche/, fuera del working
// tree, y se leen de cuatro lugares: los trackeados `.chiche/` y `.sdd/` y los
// locales <git-common-dir>/chiche/ y <git-common-dir>/sdd/. Ante el mismo
// nombre gana el trackeado sobre el local y chiche sobre sdd. Cada skill lleva
// un bloque delimitado byte a byte idéntico entre harnesses con esa doctrina.
const COMMON_DIR_COMMAND = /`git rev-parse --path-format=absolute --git-common-dir`/;
const DRAFTS_PRECEDENCE = /ante el mismo nombre gana el trackeado sobre el local y `chiche` sobre `sdd`/;
// Decisión humana del review de #86: Codex no escribe en `.git/` con su sandbox por defecto.
// Issue #103, T7c (S14): grill, chiche-spec y chiche-run escriben o copian bajo `.chiche/`, así que el fallback sin
// escalación de los tres es `.chiche/` del cwd, nunca `.sdd/`; esos borradores los resuelve chiche-land en su Fase 5.
const CODEX_NEUTRAL_LINE = /Si el harness no puede escribir en `<git-common-dir>\/chiche\/`, su capa de interacción dice cómo pedir permiso o caer a `\.chiche\/` del cwd/;
const SDD_RUN_NEUTRAL_LINE = /Si el harness no puede escribir en `<git-common-dir>\/chiche\/` o `<git-common-dir>\/sdd\/`, su capa de interacción dice cómo pedir permiso o caer a `\.chiche\/` del cwd/;

// Los cuatro lugares de `kind`, en el orden de precedencia de CA-1 y dentro
// de una misma cláusula (sin `;` de por medio): `.chiche/<kind>/`,
// `.sdd/<kind>/`, `<git-common-dir>/chiche/<kind>/`, `<git-common-dir>/sdd/<kind>/`.
function fourPlacesInOrder(kind: string): RegExp {
	const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const places = [`\`\\.chiche\\/${escaped}\\/\``, `\`\\.sdd\\/${escaped}\\/\``, `\`<git-common-dir>\\/chiche\\/${escaped}\\/\``, `\`<git-common-dir>\\/sdd\\/${escaped}\\/\``];
	return new RegExp(`en este orden: ${places.join("[^;\\n]*")}`);
}

const GRILL_DRAFTS_DOCTRINE = [
	/El handoff, el cuestionario y la carpeta de capturas se escriben en `<git-common-dir>\/chiche\/grills\/`, fuera del working tree/,
	COMMON_DIR_COMMAND,
	/Fuera de un repo git, en `\.chiche\/grills\/` del cwd/,
	/Para leer o retomar se miran los cuatro lugares, en este orden: `\.chiche\/grills\/` y `\.sdd\/grills\/` del árbol[^;\n]*`<git-common-dir>\/chiche\/grills\/` y `<git-common-dir>\/sdd\/grills\/`/,
	fourPlacesInOrder("grills"),
	DRAFTS_PRECEDENCE,
	/Todo guardado se escribe en `<git-common-dir>\/chiche\/grills\/`, aunque el handoff retomado venga de otro de los cuatro lugares/,
	/imprime su ruta absoluta/,
	CODEX_NEUTRAL_LINE,
];

const SDD_SPEC_DRAFTS_DOCTRINE = [
	/La spec local se escribe en `<git-common-dir>\/chiche\/specs\/<slug>\.md`, fuera del working tree/,
	COMMON_DIR_COMMAND,
	/fuera de un repo git, en `\.chiche\/specs\/` del cwd/,
	fourPlacesInOrder("specs"),
	fourPlacesInOrder("grills"),
	DRAFTS_PRECEDENCE,
	// L4 del issue #103: el artefacto existente se actualiza en su lugar; lo nuevo va a chiche.
	/`\.chiche\/specs\/<slug>\.md` es su ruta lógica \(`\.sdd\/specs\/<slug>\.md` si ya vive en un lugar `sdd`\): si el nombre ya existe en alguno de los cuatro lugares, se actualiza en su lugar; si no, se escribe en `<git-common-dir>\/chiche\/specs\/`/,
	/Los handoffs de `--from-grill` y la Fase 0 se listan de los cuatro lugares, en este orden/,
	// Review de #86: raíz física en el árbol; en el common-dir, `Proyecto` o el worktree principal.
	/La raíz operativa de un handoff depende de dónde está: en `\.chiche\/grills\/` o `\.sdd\/grills\/` del árbol es la raíz física del checkout que lo contiene; en `<git-common-dir>\/chiche\/grills\/` o `<git-common-dir>\/sdd\/grills\/` es su campo `Proyecto` si nombra un worktree del mismo repo[^\n]*y, si no, el worktree principal de ese common-dir/,
	CODEX_NEUTRAL_LINE,
	/imprime la ruta absoluta de la spec local/,
];

const SDD_RUN_DRAFTS_DOCTRINE = [
	/\*\*Borradores del common-dir\*\*: los artefactos de entrada se toman de `<git-common-dir>\/chiche\/` y de `<git-common-dir>\/sdd\/`/,
	COMMON_DIR_COMMAND,
	/la spec target, el handoff canónico, su carpeta de capturas y las specs predecesoras/,
	/Por compatibilidad, también los que sigan sin trackear en `\.chiche\/` o `\.sdd\/` del checkout original/,
	/Se copian al worktree con el mismo nombre, bajo `\.chiche\/grills\/` y `\.chiche\/specs\/` \(también los de `<git-common-dir>\/sdd\/` y los de un `\.sdd\/` sin trackear\), y entran en el PRIMER commit/,
	// Review de #86: el borrado espera al push, así la única copia nunca queda en un branch local.
	/las copias de `<git-common-dir>\/chiche\/` y de `<git-common-dir>\/sdd\/` se borran recién después del push del branch \(o con el PR abierto\)/,
	/Con `--no-pr`, o si el run termina antes del push, se conservan y el reporte las nombra/,
	SDD_RUN_NEUTRAL_LINE,
];

const ISSUE_TRIAGE_DRAFTS_DOCTRINE = [
	/los trackeados `\.chiche\/grills\/`, `\.chiche\/specs\/`, `\.sdd\/grills\/` y `\.sdd\/specs\/` del árbol[^\n]*los locales `<git-common-dir>\/chiche\/grills\/`, `<git-common-dir>\/chiche\/specs\/`, `<git-common-dir>\/sdd\/grills\/` y `<git-common-dir>\/sdd\/specs\/`/,
	COMMON_DIR_COMMAND,
	/El inventario y el linaje se resuelven en los cuatro lugares de cada tipo \(`grills` o `specs`\), en este orden/,
	fourPlacesInOrder("<tipo>"),
	DRAFTS_PRECEDENCE,
	/Un `superseded-by=\.chiche\/specs\/<x>\.md` o `superseded-by=\.sdd\/specs\/<x>\.md` se busca por nombre en ese mismo orden, y los cuatro cuentan como dentro del proyecto/,
];

// Ningún bloque de borradores conserva la doctrina de dos lugares ni un
// fallback a `.sdd/` del cwd: desde T7c todo se escribe y se copia bajo `.chiche/` (S14).
const DRAFTS_STALE = [/los dos lugares/, /gana el del árbol/, /caer a `\.sdd\/` del cwd/];

async function draftsBlocks(skill: string, block: string, patterns: RegExp[]): Promise<string[]> {
	const problems: string[] = [];
	const byHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const doctrine = delimitedDoctrine(await readRepoFile(`${harness}/${skill}/SKILL.md`), block);
		for (const pattern of patterns) {
			if (!pattern.test(doctrine)) problems.push(`${harness}/${skill}/SKILL.md (${block}) no declara ${pattern}`);
		}
		for (const stale of DRAFTS_STALE) {
			if (stale.test(doctrine)) problems.push(`${harness}/${skill}/SKILL.md (${block}) todavía declara ${stale}`);
		}
		byHarness.set(harness, doctrine);
	}
	// Issue #103, CA-5: el bloque es idéntico byte a byte, sin normalizar invocaciones.
	const [reference, ...rest] = HARNESSES;
	for (const harness of rest) {
		const left = byHarness.get(reference!) ?? "";
		const right = byHarness.get(harness) ?? "";
		if (left !== right) problems.push(`${skill} (${block}): ${reference} vs ${harness} — ${firstDifference(left, right)}`);
	}
	return problems;
}

test("autotest: fourPlacesInOrder exige los cuatro lugares en orden y en una misma cláusula", () => {
	const pattern = fourPlacesInOrder("grills");
	const ordered = "en este orden: `.chiche/grills/` y `.sdd/grills/` del árbol, y `<git-common-dir>/chiche/grills/` y `<git-common-dir>/sdd/grills/`; ante el mismo nombre";
	assert.match(ordered, pattern);
	assert.doesNotMatch(ordered.replace("`.chiche/grills/` y `.sdd/grills/`", "`.sdd/grills/` y `.chiche/grills/`"), pattern, "chiche antes que sdd");
	assert.doesNotMatch(ordered.replace("del árbol, y", "del árbol; y"), pattern, "una sola cláusula");
	assert.doesNotMatch(ordered.replace(", y `<git-common-dir>/chiche/grills/`", ""), pattern, "los cuatro lugares");
	assert.match("en este orden: `.chiche/<tipo>/`, `.sdd/<tipo>/`, `<git-common-dir>/chiche/<tipo>/` y `<git-common-dir>/sdd/<tipo>/`", fourPlacesInOrder("<tipo>"));
});

test("#84 CA-13, #103 CA-5: grill escribe handoff, cuestionario y capturas en <git-common-dir>/chiche/grills y retoma de los cuatro lugares en los cinco harnesses", async () => {
	const problems = await draftsBlocks("grill", "grill-drafts", GRILL_DRAFTS_DOCTRINE);
	for (const harness of HARNESSES) {
		const file = `${harness}/grill/SKILL.md`;
		const markdown = await readRepoFile(file);
		if (!/`<git-common-dir>\/chiche\/grills\/<fecha>-<slug>\.md`/.test(markdown)) problems.push(`${file}: el handoff no se escribe en <git-common-dir>/chiche/grills/<fecha>-<slug>.md`);
		if (!/`<git-common-dir>\/chiche\/grills\/<fecha>-<slug>-cuestionario\.md`/.test(markdown)) problems.push(`${file}: el cuestionario no se escribe en <git-common-dir>/chiche/grills/`);
		if (/`(?:<git-common-dir>\/sdd|\.sdd|\.chiche)\/grills\/<fecha>-<slug>(?:-cuestionario)?\.md`/.test(markdown)) problems.push(`${file}: todavía escribe fuera de <git-common-dir>/chiche/grills/<fecha>-<slug>.md`);
		if (/handoffs? (?:previos )?(?:de los dos lugares|en `\.sdd\/grills\/` y `<git-common-dir>\/sdd\/grills\/`)/.test(markdown)) problems.push(`${file}: todavía lista los handoffs de dos lugares`);
		if (harness !== "pi" && !/list(?:á|ar) por fecha los handoffs de los cuatro lugares \(`\.chiche\/grills\/\*\.md`, `\.sdd\/grills\/\*\.md`, `<git-common-dir>\/chiche\/grills\/\*\.md` y `<git-common-dir>\/sdd\/grills\/\*\.md`\)/.test(markdown)) {
			problems.push(`${file}: la reanudación no lista los handoffs de los cuatro lugares`);
		}
		if (harness === "pi" && !/handoffs portables de cada root conocido bajo `\.chiche\/grills\/` y `\.sdd\/grills\/` y de `<git-common-dir>\/chiche\/grills\/` y `<git-common-dir>\/sdd\/grills\/`/.test(markdown)) {
			problems.push(`${file}: /grills y select_grill_session no combinan los cuatro lugares`);
		}
		const design = delimitedDoctrine(markdown, "grill-design");
		if (!/se copian a `<git-common-dir>\/chiche\/grills\/<nombre-real-del-handoff>\/`/.test(design)) problems.push(`${file}: las capturas no se copian a <git-common-dir>/chiche/grills/`);
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-14, #103 CA-5: chiche-spec escribe la spec local en <git-common-dir>/chiche/specs y su Fase 0 lista los cuatro lugares en los cinco harnesses", async () => {
	const problems = await draftsBlocks("chiche-spec", "chiche-spec-drafts", SDD_SPEC_DRAFTS_DOCTRINE);
	for (const harness of HARNESSES) {
		const file = `${harness}/chiche-spec/SKILL.md`;
		const markdown = await readRepoFile(file);
		const flow = delimitedDoctrine(markdown, "chiche-spec-flow");
		if (!/`<git-common-dir>\/chiche\/specs\/<slug>\.md`/.test(flow)) problems.push(`${file}: el destino local de chiche-spec-flow no es <git-common-dir>/chiche/specs/<slug>.md`);
		if (/`<git-common-dir>\/sdd\/specs\/(?:issue-NN-)?<slug>\.md`/.test(flow)) problems.push(`${file}: chiche-spec-flow todavía escribe en <git-common-dir>/sdd/specs/`);
		if (!/`local` = `<git-common-dir>\/chiche\/specs\/`/.test(markdown)) problems.push(`${file}: --out local no apunta a <git-common-dir>/chiche/specs/`);
		if (/`local` = `\.sdd\/specs\/`/.test(markdown)) problems.push(`${file}: --out local todavía apunta a .sdd/specs/`);
		if (!/Revisar `\.chiche\/specs\/`, `\.sdd\/specs\/`, `<git-common-dir>\/chiche\/specs\/` y `<git-common-dir>\/sdd\/specs\/`/.test(markdown)) problems.push(`${file}: la búsqueda de una spec previa no mira los cuatro lugares`);
		if (/`\.sdd\/grills\/` (?:o|y) (?:en )?`<git-common-dir>\/sdd\/grills\/`|`\.sdd\/specs\/` y `<git-common-dir>\/sdd\/specs\/`|`\.sdd\/grills\/\*\.md` y `<git-common-dir>\/sdd\/grills\/\*\.md`/.test(markdown)) {
			problems.push(`${file}: todavía enumera dos lugares de handoffs o specs`);
		}
		if (/ra[ií]z operativa (?:de un handoff )?sale (?:de su|del) campo `Proyecto`[^\n]*no de d[oó]nde est[aá] guardado el archivo/.test(markdown)) {
			problems.push(`${file}: la raíz operativa de un handoff del árbol todavía sale de Proyecto`);
		}
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-15, #103 CA-5: chiche-run toma los artefactos de entrada de <git-common-dir>/chiche/ y <git-common-dir>/sdd/, los commitea en el worktree y borra las copias", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/chiche-run/SKILL.md`);
		const doctrine = delimitedDoctrine(markdown, "chiche-run-dirty-checkout");
		for (const pattern of [...SDD_RUN_DRAFTS_DOCTRINE, /checkout original queda intacto/i]) {
			if (!pattern.test(doctrine)) problems.push(`${harness}/chiche-run/SKILL.md (chiche-run-dirty-checkout) no declara ${pattern}`);
		}
		if (!/Listar las specs de `\.chiche\/specs\/`, `\.sdd\/specs\/`, `<git-common-dir>\/chiche\/specs\/` y `<git-common-dir>\/sdd\/specs\/`/.test(markdown)) {
			problems.push(`${harness}/chiche-run/SKILL.md: la Fase 0 no lista las specs de los cuatro lugares`);
		}
	}
	assert.deepEqual(problems, []);
});

// Issue #103, CA-14 (S14): chiche-run copia al worktree los artefactos de entrada bajo `.chiche/` aunque
// vengan de `<git-common-dir>/sdd/` o de un `.sdd/` sin trackear, y deja su evidencia en
// `.chiche/evidence/`. Un argumento `.chiche/specs/<x>.md` o `.sdd/specs/<x>.md` se resuelve por nombre
// en los cuatro lugares (review de #107, 3); solo una ruta fuera de esas dos formas se lee tal cual.
test("#103 CA-14: chiche-run copia los artefactos de entrada al worktree bajo .chiche/ y deja la evidencia en .chiche/evidence/", async () => {
	const problems: string[] = [];
	const argumentCompat = new RegExp(`Un argumento \`\\.chiche\\/specs\\/<x>\\.md\` o \`\\.sdd\\/specs\\/<x>\\.md\`[^\\n]*se resuelve por nombre[^\\n]*${fourPlacesInOrder("specs").source}[^\\n]*${DRAFTS_PRECEDENCE.source}[^\\n]*Solo una ruta que no es ninguna de esas dos formas se lee tal cual\\.`);
	for (const harness of HARNESSES) {
		const file = `${harness}/chiche-run/SKILL.md`;
		const markdown = await readRepoFile(file);
		const doctrine = delimitedDoctrine(markdown, "chiche-run-dirty-checkout");
		const copyLine = doctrine.split("\n").find((line) => line.includes("Se copian al worktree")) ?? "";
		if (!/Se copian al worktree con el mismo nombre, bajo `\.chiche\/grills\/` y `\.chiche\/specs\/`/.test(copyLine)) {
			problems.push(`${file}: la copia al worktree no va bajo .chiche/grills/ y .chiche/specs/`);
		}
		if (/`\.sdd\/(?:grills|specs)\/`/.test(copyLine)) problems.push(`${file}: la frase de la copia todavía nombra .sdd/grills/ o .sdd/specs/ como destino`);
		if (!/entran en el PRIMER commit/.test(copyLine)) problems.push(`${file}: las copias ya no entran en el PRIMER commit`);
		if (/\.sdd\/evidence\//.test(markdown)) problems.push(`${file}: la evidencia todavía va a .sdd/evidence/`);
		for (const literal of ["bajo `.chiche/evidence/<slug>/`", "/raw/<sha>/.chiche/evidence/<slug>/<pantalla>.png", "`.chiche/evidence/` queda fuera de los gates"]) {
			if (!markdown.includes(literal)) problems.push(`${file}: no dice ${literal}`);
		}
		if (!/^\S*chiche-run \[\.chiche\/specs\/<spec>\.md \| #NN/m.test(markdown)) problems.push(`${file}: el argumento de ejemplo no es .chiche/specs/<spec>.md`);
		if (!argumentCompat.test(markdown)) problems.push(`${file}: no dice que un argumento .chiche/specs/<x>.md o .sdd/specs/<x>.md se resuelve por nombre en los cuatro lugares y que solo otra ruta se lee tal cual`);
		if (/Ruta → leerla\./.test(markdown)) problems.push(`${file}: «Ruta → leerla.» manda a leer literal también las rutas .chiche/specs/ y .sdd/specs/`);
	}
	assert.deepEqual(problems, []);
});

// Issue #103, CA-14 (S14), decisión (d) de L30: en la Fase 5, chiche-land barre los borradores de ambos
// common-dirs cuyo blob ya está en origin/<default>. El bloque es idéntico byte a byte entre harnesses.
const CHICHE_LAND_COMMON_DIR_DOCTRINE = [
	/antes de clasificar los paths sucios, barre los dos common-dirs, `<git-common-dir>\/chiche\/` y `<git-common-dir>\/sdd\/`/,
	COMMON_DIR_COMMAND,
	/con `<kind>` = `specs` o `grills`, incluida la carpeta de capturas de un handoff/,
	/`git hash-object <archivo>` es igual a `git rev-parse origin\/<default>:\.chiche\/<kind>\/<nombre>` o a `git rev-parse origin\/<default>:\.sdd\/<kind>\/<nombre>`/,
	/Se borra con `rm -- <archivo>` y va al reporte como `ya aterrizados` con su ruta/,
	/Un borrador sin gemelo aterrizado, o con otro contenido, nunca se toca/,
	/Con `--dry-run` se lista lo que se borraría y no se borra/,
	/con `--clean-only` el barrido corre igual/,
];

test("#103 CA-14: chiche-land barre en la Fase 5 los borradores ya aterrizados de ambos common-dirs, con un bloque idéntico", async () => {
	const problems: string[] = [];
	const blocks = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const file = `${harness}/chiche-land/SKILL.md`;
		const markdown = await readRepoFile(file);
		if (markdown.split("<!-- chiche-land-common-dir:start -->").length !== 2) {
			problems.push(`${file}: debe traer un solo bloque chiche-land-common-dir`);
			continue;
		}
		const block = delimitedDoctrine(markdown, "chiche-land-common-dir");
		blocks.set(harness, block);
		for (const pattern of CHICHE_LAND_COMMON_DIR_DOCTRINE) {
			if (!pattern.test(block)) problems.push(`${file} (chiche-land-common-dir) no declara ${pattern}`);
		}
		const at = markdown.indexOf("<!-- chiche-land-common-dir:start -->");
		const phase5 = markdown.indexOf("## Fase 5 — Checkout principal");
		const phase6 = markdown.indexOf("## Fase 6 — ");
		if (!(phase5 !== -1 && phase5 < at && at < phase6)) problems.push(`${file}: el bloque no está dentro de la Fase 5`);
		if (!(markdown.indexOf("Primero `git fetch --prune`") < at && at < markdown.indexOf("- **Sucio**"))) {
			problems.push(`${file}: el barrido no va después del git fetch --prune y antes de clasificar los paths sucios`);
		}
		if (!/- ya aterrizados: <paths \| ninguno> · del common-dir: <rutas \| ninguno> · sin resolver: <paths \| ninguno>/.test(markdown)) {
			problems.push(`${file}: el reporte no lista los ya aterrizados del common-dir`);
		}
	}
	const [reference, ...rest] = HARNESSES;
	for (const harness of rest) {
		const a = blocks.get(reference);
		const b = blocks.get(harness);
		if (a !== undefined && b !== undefined && a !== b) problems.push(`chiche-land-common-dir ${reference} vs ${harness}: ${firstDifference(a, b)}`);
	}
	assert.deepEqual(problems, []);
});

// Issue #103, decisión (a) de L30 y T7c: el contrato es `.chiche/project.md`; una sola frase de fallback a
// `.sdd/project.md` por skill, donde se lee por primera vez, y en ningún otro lugar. La migración
// (`chiche-init --update`) la ofrece la frase misma, con la invocación de cada harness.
const CONTRACT_FALLBACK_SKILLS = ["chiche-run", "chiche-land", "chiche-spec", "grill", "coding-policies", "design-system", "issue-triage"] as const;
// Review de #107-2 (3): `coding-policies` y `design-system` también ESCRIBEN el contrato, así que la frase dice «se lee y se escribe ahí».
const CONTRACT_FALLBACK_SENTENCE = /Un repo inicializado antes del renombre lo tiene en `\.sdd\/project\.md`: se lee y se escribe ahí, y `[^`\s]*chiche-init --update` ofrece migrarlo\./;
// Review de #107 (2): `coding-policies` es el único skill que ESCRIBE un archivo del contrato viejo, así que suma una
// segunda mención de `.sdd/coding-policies.md`: el destino por defecto de un repo sin migrar, regenerado en el lugar.
const CODING_POLICIES_DESTINATION_FALLBACK = /Si `\.chiche\/coding-policies\.md` no existe y `\.sdd\/coding-policies\.md` sí \(repo sin migrar o con `Mantener \.sdd\/`\), ese es el default y la opción `\(Recomendado\)`: se regenera en el lugar preservando `## Ajustes de este proyecto`, `CLAUDE\.md` conserva su import y `[^`\s]*chiche-init --update` lo migra después\./;
test("#103 L30 (a), T7c: los skills leen el contrato de .chiche/project.md con una sola frase de fallback a .sdd/project.md", async () => {
	const problems: string[] = [];
	for (const skill of CONTRACT_FALLBACK_SKILLS) {
		for (const harness of HARNESSES) {
			const file = `${harness}/${skill}/SKILL.md`;
			// Issue #102 CA-4: el bloque `autonomy-resolve` lee el contrato del branch default con el mismo
			// fallback a `.sdd/project.md` (prosa y comando canónico); autonomy-gate lo verifica, así que queda fuera del conteo.
			const markdown = withoutAutonomyResolve(await readRepoFile(file));
			if (!markdown.includes("`.chiche/project.md`")) problems.push(`${file}: no lee .chiche/project.md`);
			if ((markdown.match(/\.sdd\/project\.md/g) ?? []).length !== 1) problems.push(`${file}: debe nombrar .sdd/project.md una sola vez, en la frase de fallback`);
			if (!CONTRACT_FALLBACK_SENTENCE.test(markdown)) problems.push(`${file}: falta la frase de fallback del contrato`);
			if ((markdown.match(/Un repo inicializado antes del renombre lo tiene en/g) ?? []).length !== 1) problems.push(`${file}: la frase de fallback debe aparecer una sola vez`);
			const frontmatter = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1] ?? "";
			if (frontmatter.includes(".sdd/")) problems.push(`${file}: el frontmatter todavía nombra .sdd/`);
			if (skill === "coding-policies") {
				if ((markdown.match(/\.sdd\/coding-policies\.md/g) ?? []).length !== 1) problems.push(`${file}: debe nombrar .sdd/coding-policies.md una sola vez, en la frase de fallback del destino`);
				if (!CODING_POLICIES_DESTINATION_FALLBACK.test(markdown)) problems.push(`${file}: falta la frase de fallback del destino a .sdd/coding-policies.md`);
				if ((markdown.match(/Si `\.chiche\/coding-policies\.md` no existe/g) ?? []).length !== 1) problems.push(`${file}: la frase de fallback del destino debe aparecer una sola vez`);
				if (!markdown.includes("`.chiche/coding-policies.md`")) problems.push(`${file}: el destino por defecto no es .chiche/coding-policies.md`);
			}
		}
	}
	assert.deepEqual(problems, []);
});

// Review de #107-2 (3): en un repo sin migrar `.chiche/project.md` no existe; el enganche y el reporte nombran el contrato con su fallback para no
// leer «no existe» sobre un contrato que sí está (en `.sdd/project.md`).
test("review #107-2 (3): el enganche y el reporte de coding-policies y design-system nombran el contrato con su fallback", async () => {
	const problems: string[] = [];
	const contract = "el contrato (`.chiche/project.md` o su fallback)";
	for (const harness of HARNESSES) {
		const policies = `${harness}/coding-policies/SKILL.md`;
		const policiesText = await readRepoFile(policies);
		for (const literal of [
			`Detectar en la raíz \`CLAUDE.md\`, \`AGENTS.md\` y ${contract}.`,
			`3. **El contrato (\`.chiche/project.md\` o su fallback)** — en la tabla de \`## Politicas de generacion\``,
			`en ${contract}, comparando la fila entera`,
		]) {
			if (!policiesText.includes(literal)) problems.push(`${policies}: falta «${literal}»`);
		}
		if (!/^- enganche: .* · contrato \(\.chiche\/project\.md o su fallback\) <agregado\|actualizado\|ya estaba\|omitido\|sin seccion\|no existe>$/m.test(policiesText)) problems.push(`${policies}: el enum del reporte no dice «contrato (.chiche/project.md o su fallback)»`);
		if (/ · \.chiche\/project\.md <agregado/.test(policiesText)) problems.push(`${policies}: el enum del reporte todavía nombra solo .chiche/project.md`);

		const design = `${harness}/design-system/SKILL.md`;
		const designText = await readRepoFile(design);
		for (const literal of [
			`**Rama de registro** (la superficie ya tenía sistema): solo ${contract}`,
			`1. **El contrato (\`.chiche/project.md\` o su fallback)** — fila de la superficie en \`## Diseño\` del contrato`,
		]) {
			if (!designText.includes(literal)) problems.push(`${design}: falta «${literal}»`);
		}
		if (!/^- enganche: <no intentado> \| contrato \(\.chiche\/project\.md o su fallback\) <agregado\|actualizado\|ya estaba\|omitido\|sin seccion\|no existe> · /m.test(designText)) problems.push(`${design}: el enum del reporte no dice «contrato (.chiche/project.md o su fallback)»`);
		if (/\| \.chiche\/project\.md <agregado/.test(designText)) problems.push(`${design}: el enum del reporte todavía nombra solo .chiche/project.md`);
		for (const [file, text] of [[policies, policiesText], [design, withoutAutonomyResolve(designText)]] as const) {
			if ((text.match(/\.sdd\/project\.md/g) ?? []).length !== 1) problems.push(`${file}: debe nombrar .sdd/project.md una sola vez, en la frase de fallback`);
		}
	}
	assert.deepEqual(problems, []);
});

// Review de #107-2 (2): code-review lee la spec del PR de los cuatro lugares, con la precedencia de chiche-paths, y el contrato con su fallback.
test("review #107-2 (2): code-review busca la spec del PR en los cuatro lugares y lee el contrato con su fallback", async () => {
	const problems: string[] = [];
	for (const harness of ["codex", "opencode", "pi", "antigravity"] as const) {
		const file = `${harness}/code-review/SKILL.md`;
		const markdown = await readRepoFile(file);
		const lookup = "4. `.chiche/specs/`, `.sdd/specs/`, `<git-common-dir>/chiche/specs/`, `<git-common-dir>/sdd/specs/` (en ese orden de precedencia), `specs/`, `docs/`, `prd/` u otra ruta explícita del repo que coincida con el PR;";
		if (!markdown.split("\n").includes(lookup)) problems.push(`${file}: la lista de la spec no nombra los cuatro lugares en orden de precedencia`);
		if (!markdown.includes("Usar `.chiche/project.md` o su fallback como fuente principal si existe.")) problems.push(`${file}: la fuente principal no nombra el fallback`);
		if ((markdown.match(/\.sdd\/project\.md/g) ?? []).length !== 1) problems.push(`${file}: debe nombrar .sdd/project.md una sola vez, en la frase de fallback`);
		if (!/\(un repo inicializado antes del renombre lo tiene en `\.sdd\/project\.md`: se lee y se escribe ahí, y `[^`\s]*chiche-init --update` ofrece migrarlo\)/.test(markdown)) problems.push(`${file}: falta la frase de fallback del contrato`);
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-16, #103 CA-5: issue-triage resuelve el linaje en los cuatro lugares y los READMEs dicen dónde viven los borradores", async () => {
	const problems = await draftsBlocks("issue-triage", "issue-triage-drafts", ISSUE_TRIAGE_DRAFTS_DOCTRINE);
	for (const harness of ["claude", "codex", "opencode"] as const) {
		const file = `${harness}/issue-triage/SKILL.md`;
		const markdown = await readRepoFile(file);
		if (!/dentro de `cwd`, de `<git-common-dir>\/chiche\/` o de `<git-common-dir>\/sdd\/`/.test(markdown)) problems.push(`${file}: los artefactos del common-dir no cuentan chiche y sdd`);
		if (!/ubicado directamente bajo `<cwd>\/\.chiche\/grills\/`, `<cwd>\/\.sdd\/grills\/`, `<git-common-dir>\/chiche\/grills\/` o `<git-common-dir>\/sdd\/grills\/`/.test(markdown)) {
			problems.push(`${file}: spec-from-grill no acepta el handoff de los cuatro lugares`);
		}
	}
	for (const path of ["README.md", "README.en.md"]) {
		const readme = await readRepoFile(path);
		for (const literal of ["`<git-common-dir>/chiche/grills/`", "`<git-common-dir>/chiche/specs/`", "`<git-common-dir>/chiche/events.jsonl`", "`<git-common-dir>/sdd/events.jsonl`", "`git rev-parse --path-format=absolute --git-common-dir`"]) {
			if (!readme.includes(literal)) problems.push(`${path}: no menciona ${literal}`);
		}
		// Issue #103, T7c: el README dice que `.sdd/` se sigue leyendo, que `chiche-init --update` lo migra y que
		// chiche-run copia bajo `.chiche/`; la fila de chiche-init nombra el contrato nuevo.
		const spanish = path === "README.md";
		const migrates = spanish ? "`chiche-init --update` migra `.sdd/` a `.chiche/`" : "`chiche-init --update` migrates `.sdd/` to `.chiche/`";
		if (!readme.includes(migrates)) problems.push(`${path}: no dice que ${migrates}`);
		// Review de #107 (7): las filas `grill` y `chiche-spec` escriben en <git-common-dir>/chiche/grills/ y leen de los cuatro lugares.
		const grillRow = readme.split("\n").find((line) => line.startsWith("| **`grill`** |")) ?? "";
		const specRow = readme.split("\n").find((line) => line.startsWith("| **`chiche-spec`** |")) ?? "";
		const places = "(`.chiche/grills/`, `.sdd/grills/`, `<git-common-dir>/chiche/grills/` and `<git-common-dir>/sdd/grills/`)";
		const lugares = "(`.chiche/grills/`, `.sdd/grills/`, `<git-common-dir>/chiche/grills/` y `<git-common-dir>/sdd/grills/`)";
		for (const literal of spanish
			? [`persiste sesiones en \`<git-common-dir>/chiche/grills/\`, fuera del working tree, y las reanuda de los cuatro lugares ${lugares}`, "escribe además el handoff interoperable en `<git-common-dir>/chiche/grills/` del proyecto"]
			: [`persists sessions in \`<git-common-dir>/chiche/grills/\`, outside the working tree, and resumes them from the four places ${places}`, "writes the interoperable handoff into the project's `<git-common-dir>/chiche/grills/`"]) {
			if (!grillRow.includes(literal)) problems.push(`${path}: la fila grill no dice «${literal}»`);
		}
		const specLiteral = spanish ? `parte de un handoff finalizado de \`grill\` de los cuatro lugares ${lugares}` : `starts from a finalized \`grill\` handoff in the four places ${places}`;
		if (!specRow.includes(specLiteral)) problems.push(`${path}: la fila chiche-spec no dice «${specLiteral}»`);
		for (const [name, row] of [["grill", grillRow], ["chiche-spec", specRow]] as const) {
			if (/(?:persiste|persists)[^|]*<git-common-dir>\/sdd\/grills\/`, (?:fuera|outside)|(?:en|in) `<git-common-dir>\/sdd\/grills\/` (?:o|or) `\.sdd\/grills\/`/.test(row)) problems.push(`${path}: la fila ${name} todavía escribe o lee solo en <git-common-dir>/sdd/grills/`);
		}
		if (!readme.includes(spanish ? "a `.chiche/` de su worktree" : "into its worktree's `.chiche/`")) problems.push(`${path}: chiche-run no copia a .chiche/ del worktree`);
		if (/a `\.sdd\/` de su worktree|worktree's `\.sdd\/`/.test(readme)) problems.push(`${path}: chiche-run todavía copia a .sdd/ del worktree`);
		const initRow = readme.match(/^\| \*\*`chiche-init`\*\* \|[^\n]*\|$/m)?.[0] ?? "";
		if (!initRow.includes("`.chiche/project.md`") || initRow.includes(".sdd/project.md")) problems.push(`${path}: la fila de chiche-init no nombra solo .chiche/project.md`);
	}
	assert.deepEqual(problems, []);
});

test("#84 review #86, #103 CA-5, CA-14, review #105: en Codex, escribir o borrar en <git-common-dir> pide escalación o cae al cwd", async () => {
	const problems: string[] = [];
	const shared = /En Codex, el sandbox por defecto deja `\.git\/` en solo lectura \(`mkdir: \.git\/chiche: Operation not permitted`\): pedir escalación para escribir en `<git-common-dir>\/chiche\/`/;
	const fallback: Record<string, RegExp> = {
		grill: /sin permiso, escribir en `\.chiche\/` del cwd y decirlo en el reporte[^\n]*`\$chiche-land`/,
		"chiche-spec": /sin permiso, escribir en `\.chiche\/` del cwd y decirlo en el reporte[^\n]*`\$chiche-land`/,
		"chiche-run": /pedir escalación para escribir en `<git-common-dir>\/chiche\/` y `<git-common-dir>\/sdd\/`, donde se borran las copias; sin permiso, dejarlas y decirlo en el reporte\. Los borradores que `\$grill` y `\$chiche-spec` hayan dejado en `\.chiche\/` o `\.sdd\/` del cwd entran/,
	};
	for (const [skill, pattern] of Object.entries(fallback)) {
		const codex = await readRepoFile(`codex/${skill}/SKILL.md`);
		if (!shared.test(codex)) problems.push(`codex/${skill}/SKILL.md: falta la escalación de Codex`);
		if (!pattern.test(codex)) problems.push(`codex/${skill}/SKILL.md: falta el fallback ${pattern}`);
		if (/sin permiso, escribir en `\.sdd\/` del cwd/.test(codex)) problems.push(`codex/${skill}/SKILL.md: el fallback todavía va a .sdd/ del cwd`);
		for (const harness of ["claude", "opencode", "pi", "antigravity"] as const) {
			if (/pedir escalación para escribir en `<git-common-dir>/.test(await readRepoFile(`${harness}/${skill}/SKILL.md`))) problems.push(`${harness}/${skill}/SKILL.md: la escalación es solo de Codex`);
		}
	}
	// Issue #103, CA-14: el barrido de la Fase 5 borra dentro de `.git/`; solo Codex lo dice (capa de interacción).
	const sweepEscalation = /En Codex, el sandbox por defecto deja `\.git\/` en solo lectura: pedir escalación para borrar en `<git-common-dir>\/chiche\/` y `<git-common-dir>\/sdd\/` los borradores ya aterrizados; sin permiso, van a `sin resolver` con la ruta y el comando\./;
	for (const harness of HARNESSES) {
		const has = sweepEscalation.test(await readRepoFile(`${harness}/chiche-land/SKILL.md`));
		if (harness === "codex" && !has) problems.push("codex/chiche-land/SKILL.md: falta la escalación del barrido del common-dir");
		if (harness !== "codex" && has) problems.push(`${harness}/chiche-land/SKILL.md: la escalación del barrido es solo de Codex`);
	}
	const doc = await readRepoFile("docs/harness-interaction-differences.md");
	if (!/En Codex[^\n]*`codex sandbox -P :workspace`[^\n]*Codex 0\.146\.0[^\n]*borradores en `<git-common-dir>\/chiche\/`[^\n]*escalación[^\n]*sin permiso, escriben en `\.chiche\/` del cwd y lo dicen en el reporte, y esos borradores los resuelve `chiche-land` en su Fase 5/.test(doc)) problems.push("docs/harness-interaction-differences.md: falta la diferencia de Codex con `.git/`");
	if (/borradores en `<git-common-dir>\/sdd\/`|escriben en `\.sdd\/` del cwd/.test(doc)) problems.push("docs/harness-interaction-differences.md: la diferencia de Codex todavía escribe borradores en sdd o cae a .sdd/");
	// Review de #107 (9): `chiche-land` no escribe borradores; su barrido tiene frase propia y, sin permiso, va a `sin resolver`.
	if (!/\. `chiche-land` no escribe borradores: su barrido de la Fase 5 borra los ya aterrizados de `<git-common-dir>\/chiche\/` y `<git-common-dir>\/sdd\/`, pide escalación en Codex y, sin permiso, los manda a `sin resolver` con la ruta y el comando\./.test(doc)) problems.push("docs/harness-interaction-differences.md: la diferencia de Codex no trae la frase propia del barrido de chiche-land");
	if (/y `chiche-land` \(al barrer/.test(doc)) problems.push("docs/harness-interaction-differences.md: chiche-land sigue agrupado entre los skills que escriben borradores");
	if (!/La secuencia de migración de `chiche-init --update` pide la escalación entera en Codex[^\n]*`git mv` escribe `\.git\/index`[^\n]*sin permiso no se migra nada[^\n]*`mantenida \.sdd\/ \(sin permiso para escribir \.git\/\)`/.test(doc)) problems.push("docs/harness-interaction-differences.md: falta la escalación de la migración de chiche-init en Codex");
	assert.deepEqual(problems, []);
});

// Review de #105 (F2): Pi escribe `Chiche-Tracking: version=2`, así que un
// artefacto que otro harness actualiza puede traer cualquiera de los dos
// markers. Cada regla de actualización lo dice, y la regla principal de cada
// skill lo dice con esta frase literal. Los templates de artefactos nuevos
// ya emiten `Chiche-Tracking: version=2` (issue #103, CA-13): el census de
// arriba los exige v2.
const MARKER_BOTH = "`SDD-Tracking: version=1` o `Chiche-Tracking: version=2`";
const MARKER_NEVER_ANOTHER = "nunca se agrega otro";
// Review de #107 (4): una reescritura migra v1 → v2 en su lugar (docs/chiche-tracking-v2.md; es lo que hace
// `upsertSddMetadata` en Pi), así que ninguna regla promete conservar el nombre o la versión del marker.
const MARKER_UPDATE_RULE = "El marker de un artefacto existente es `SDD-Tracking: version=1` o `Chiche-Tracking: version=2`: al reescribirlo se reemplaza en su lugar por `Chiche-Tracking: version=2` conservando los demás campos, y nunca se agrega otro al lado.";
const MARKER_KEEPS_VERSION = /conserv\w+ su nombre|preserva su nombre|su nombre y su versión|su nombre, su versión/;

interface MarkerUpdateRule {
	anchor: RegExp;
	full: boolean;
	harnesses?: readonly Harness[];
}

const MARKER_UPDATE_RULES: Record<"grill" | "chiche-spec" | "chiche-run", MarkerUpdateRule[]> = {
	grill: [
		{ anchor: /Guardar de nuevo hace upsert/, full: true, harnesses: ["claude", "codex", "opencode", "antigravity"] },
		{ anchor: /En Pi lo escribe y actualiza la tool/, full: false, harnesses: ["pi"] },
	],
	"chiche-spec": [
		{ anchor: /`--triage-route update-existing-spec\|audit-existing-spec` exige un target explícito/, full: false, harnesses: ["claude", "codex", "opencode", "antigravity"] },
		{ anchor: /Re-correr sobre la misma spec hace upsert/, full: true },
		{ anchor: /la opción upsertea el marker/, full: false },
		{ anchor: /Ser idempotente: re-correr sobre el mismo pedido/, full: false },
	],
	"chiche-run": [
		{ anchor: /Actualizar la spec \(único artefacto que el run modifica/, full: false },
		{ anchor: /La transición preserva la identidad/, full: true },
		{ anchor: /Mantener la identidad del marker/, full: false },
	],
};

export function markerUpdateProblems(file: string, markdown: string, rules: MarkerUpdateRule[], harness: Harness): string[] {
	const problems: string[] = [];
	for (const rule of rules) {
		if (rule.harnesses && !rule.harnesses.includes(harness)) continue;
		const lines = markdown.split("\n").filter((line) => rule.anchor.test(line));
		if (lines.length === 0) problems.push(`${file}: falta la regla ${rule.anchor}`);
		for (const line of lines) {
			if (!line.includes(MARKER_BOTH)) problems.push(`${file} ${rule.anchor}: no nombra ${MARKER_BOTH}`);
			if (!line.includes(MARKER_NEVER_ANOTHER)) problems.push(`${file} ${rule.anchor}: no dice «${MARKER_NEVER_ANOTHER}»`);
			if (rule.full && !line.includes(MARKER_UPDATE_RULE)) problems.push(`${file} ${rule.anchor}: no lleva la regla literal del marker existente`);
			if (MARKER_KEEPS_VERSION.test(line)) problems.push(`${file} ${rule.anchor}: promete conservar el nombre o la versión del marker, y una reescritura migra v1 → v2`);
		}
	}
	return problems;
}

test("autotest: markerUpdateProblems exige los dos markers y que nunca se agregue otro en cada regla", () => {
	const rules: MarkerUpdateRule[] = [{ anchor: /hace upsert/, full: true }];
	assert.deepEqual(markerUpdateProblems("x", `Guardar hace upsert. ${MARKER_UPDATE_RULE}`, rules, "claude"), []);
	assert.equal(markerUpdateProblems("x", "Guardar hace upsert del marker `SDD-Tracking`, nunca se agrega otro.", rules, "claude").length, 2);
	const keeping = "Guardar hace upsert. El marker de un artefacto es `SDD-Tracking: version=1` o `Chiche-Tracking: version=2`: el existente se reemplaza en su lugar conservando su nombre y su versión, y nunca se agrega otro al lado.";
	assert.equal(markerUpdateProblems("x", keeping, rules, "claude").length, 2, "la regla vieja ni es la literal ni migra v1 → v2");
	assert.equal(markerUpdateProblems("x", "Guardar hace upsert. `SDD-Tracking: version=1` o `Chiche-Tracking: version=2`: preserva su nombre, su versión; nunca se agrega otro.", [{ ...rules[0]!, full: false }], "claude").length, 1);
	assert.deepEqual(markerUpdateProblems("x", "sin la regla", rules, "claude"), ["x: falta la regla /hace upsert/"]);
	assert.deepEqual(markerUpdateProblems("x", "sin la regla", [{ ...rules[0]!, harnesses: ["pi"] }], "claude"), []);
});

test("review #105 (F2): toda regla que actualiza el marker de un artefacto existente acepta SDD-Tracking v1 o Chiche-Tracking v2 y nunca agrega otro, en los cinco harnesses", async () => {
	const problems: string[] = [];
	for (const [skill, rules] of Object.entries(MARKER_UPDATE_RULES)) {
		for (const harness of HARNESSES) {
			const file = `${harness}/${skill}/SKILL.md`;
			problems.push(...markerUpdateProblems(file, await readRepoFile(file), rules, harness));
		}
	}
	const pi = await readRepoFile("pi/grill/SKILL.md");
	if (/garantiza el marker `SDD-Tracking`/.test(pi)) problems.push("pi/grill/SKILL.md: la tool todavía «garantiza el marker `SDD-Tracking`»");
	if (!/cada `pause` y `finalize` upsertea [^\n]* y escribe el marker `Chiche-Tracking: version=2`/.test(pi)) problems.push("pi/grill/SKILL.md: no dice que la tool escribe `Chiche-Tracking: version=2`");
	// Issue #103, T7c: un marker legacy sin `version=` migra a v2 con los mismos campos (no "al formato v1").
	const legacyMigration = "Un marker `SDD-Tracking` legacy (sin `version=`) se migra a `Chiche-Tracking: version=2` en la misma pasada, con los mismos campos.";
	for (const harness of HARNESSES) {
		const file = `${harness}/chiche-spec/SKILL.md`;
		const markdown = await readRepoFile(file);
		if (!markdown.includes(legacyMigration)) problems.push(`${file}: el marker legacy sin version= no migra a Chiche-Tracking: version=2`);
		if (/se migra al formato v1/.test(markdown)) problems.push(`${file}: todavía migra el marker legacy al formato v1`);
	}
	assert.deepEqual(problems, []);
});

// Spec #84 (CA-17, CA-18 y CA-20): worktrees con dueño, temporales con trap y
// los skills del contrato cierran con Commit + PR.
// Review de #87: todo `git worktree remove` (con o sin backticks) va en el
// patrón literal de la doctrina, no alcanza con un unlock cercano.
function unlockBeforeEveryRemove(markdown: string): boolean {
	const removes = (markdown.match(/git worktree remove/g) ?? []).length;
	const paired = (markdown.match(/`git worktree unlock` y después `git worktree remove`/g) ?? []).length;
	return removes > 0 && removes === paired;
}

test("autotest: unlockBeforeEveryRemove rechaza un unlock ajeno cerca y un remove en prosa", () => {
	assert.equal(unlockBeforeEveryRemove("nunca `git worktree unlock` ajeno; `git worktree remove` de lo propio"), false);
	assert.equal(unlockBeforeEveryRemove("con `git worktree unlock` y después `git worktree remove`; si no, removerlo con git worktree remove"), false);
	assert.equal(unlockBeforeEveryRemove("con `git worktree unlock` y después `git worktree remove`."), true);
});

test("#84 CA-17: chiche-run crea su worktree con --lock --reason y lo desbloquea antes de removerlo", async () => {
	const problems: string[] = [];
	for (const harness of HARNESSES) {
		const file = `${harness}/chiche-run/SKILL.md`;
		const markdown = await readRepoFile(file);
		if (!/`git worktree add --lock --reason "chiche-run <slug>" \.\.\/<repo>-sdd-<slug> -b sdd\/<slug> <base-ref>`/.test(delimitedDoctrine(markdown, "chiche-run-dirty-checkout"))) problems.push(`${file}: el worktree del PR único no nace con --lock --reason "chiche-run <slug>"`);
		if (!/`git worktree add --lock --reason "chiche-run <slug>" \.\.\/<repo>-sdd-<slug> -b sdd\/<slug>\/1-<etapa> <base-ref>`/.test(delimitedDoctrine(markdown, "chiche-run-stack"))) problems.push(`${file}: el worktree del stack no nace con --lock --reason "chiche-run <slug>"`);
		if (!unlockBeforeEveryRemove(markdown)) problems.push(`${file}: algún git worktree remove no va precedido de git worktree unlock`);
		if (!/retenerlo bloqueado para la Fase 6[^\n]*el reporte lo dice/.test(markdown)) problems.push(`${file}: el worktree retenido para la Fase 6 no queda bloqueado ni lo dice el reporte`);
		if (!/- worktree: <removido \| conservado bloqueado \(`chiche-run <slug>`\) en <ruta>>/.test(markdown)) problems.push(`${file}: el reporte no dice si el worktree quedó bloqueado`);
		if (!/`[/$](?:skill:)?chiche-land` solo lo remueve, limpio, cuando su branch ya se mergeó/.test(markdown)) problems.push(`${file}: contradice la excepción de chiche-land para el lock de chiche-run`);
		if (!/Si el worktree ya no existe porque `[/$](?:skill:)?chiche-land` lo removió tras el merge, es una salida normal y no se reintenta/.test(markdown)) problems.push(`${file}: la Fase 6 no tolera el worktree removido por chiche-land`);
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-18: code-review y grill limpian sus temporales con trap", async () => {
	const problems: string[] = [];
	for (const harness of ["codex", "opencode", "pi"] as const) {
		const file = `${harness}/code-review/SKILL.md`;
		const markdown = await readRepoFile(file);
		if (/--lock/.test(markdown)) problems.push(`${file}: el worktree de review no lleva lock`);
		for (const pattern of [
			/review_dir="\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/<repo>-review-<PR>-XXXXXX"\)"/,
			// Review de #87: sin lock; un SIGKILL deja el worktree en $TMPDIR y `git worktree prune` lo poda.
			/trap 'git worktree remove --force "\$review_dir"[^']*' EXIT/,
			/git worktree add --detach "\$review_dir" <head-sha>/,
			/[Uu]n `SIGKILL` no corre el `trap`[^\n]*`git worktree prune` lo poda/,
			/vive dentro de un solo comando de shell/,
		]) {
			if (!pattern.test(markdown)) problems.push(`${file}: falta ${pattern}`);
		}
	}
	for (const harness of HARNESSES) {
		const file = `${harness}/grill/SKILL.md`;
		const design = delimitedDoctrine(await readRepoFile(file), "grill-design");
		if (!/trap 'rm -rf -- "<scratch>"' EXIT/.test(design)) problems.push(`${file}: el scratch de capturas no se borra con trap`);
		if (!/`cp -R -- "<scratch>\/\." "<destino>\/" && rm -rf -- "<scratch>"`/.test(design)) problems.push(`${file}: el scratch se borra aunque la copia falle`);
		if (!/si la copia falla, se conserva y el reporte nombra su ruta y las capturas que no se copiaron/.test(design)) problems.push(`${file}: la copia fallida no conserva el scratch`);
	}
	assert.deepEqual(problems, []);
});

test("#84 CA-20: chiche-init, coding-policies y design-system cierran con Commit + PR en los cuatro harnesses", async () => {
	const { prefixes } = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md"));
	const problems: string[] = [];
	let reference: string | null = null;
	for (const skill of ["chiche-init", "coding-policies", "design-system"] as const) {
		for (const harness of HARNESSES) {
			const file = `${harness}/${skill}/SKILL.md`;
			const markdown = await readRepoFile(file);
			const block = delimitedDoctrine(markdown, "commit-pr-close");
			for (const pattern of [
				/`Commit \+ PR \(Recomendado\)` \/ `Dejar sin commitear`/,
				new RegExp(`\`git worktree add --lock --reason "${skill} <YYYY-MM-DD>" \\.\\./<repo>-${skill}-<YYYY-MM-DD> -b chore/${skill}-<YYYY-MM-DD> origin/<default>\``),
				/Copiar al worktree, con la misma ruta relativa, solo los paths que esta corrida escribió; commitear, pushear ese branch y abrir el PR/,
				/`git worktree unlock` y después `git worktree remove`/,
				/`ya aterrizado`/,
				// Review de #87; issue #102 CA-5: la aptitud consulta la stop list de ## Autonomy.
				/ninguna fila de la stop list matchea `git push -u origin <branch>`/,
				/se copia solo si `HEAD:<path>` del checkout es igual a `origin\/<default>:<path>` y el path no tenía cambios antes de la corrida/,
				/`git status --porcelain=v1 -z` que la corrida tomó antes de escribir su primer archivo/,
				/el primer sufijo libre \(`-2`, `-3`…\)/,
				new RegExp(`\`gh pr create --base <default> --title "chore\\(${skill}\\): <YYYY-MM-DD>" --body-file <archivo>\``),
				/el cierre queda como commit local sin PR: el reporte nombra el branch, el motivo y el comando para seguir/,
				/En modo desatendido, si el skill lo tiene, no se pregunta y el cierre queda en `Dejar sin commitear`/,
				/Si un skill encadena a otro \(`[/$](?:skill:)?chiche-init` encadena `[/$](?:skill:)?coding-policies` y `[/$](?:skill:)?design-system`\), el cierre lo ofrece una sola vez el que encadenó/,
			]) {
				if (!pattern.test(block)) problems.push(`${file} (commit-pr-close): falta ${pattern}`);
			}
			// Solo los slots del nombre del skill; la regla de encadenado nombra chiche-init a propósito.
			const normalized = normalizeInvocations(block, prefixes[harness])
				.replaceAll(`"${skill} <YYYY-MM-DD>"`, `"<skill> <YYYY-MM-DD>"`)
				.replaceAll(`<repo>-${skill}-`, "<repo>-<skill>-")
				.replaceAll(`chore/${skill}-`, "chore/<skill>-")
				.replaceAll(`chore(${skill})`, "chore(<skill>)");
			const outside = markdown.replace(/<!-- commit-pr-close:start -->[\s\S]*?<!-- commit-pr-close:end -->/, "");
			if (!/pregunta del cierre `Commit \+ PR`/.test(outside)) problems.push(`${file}: la capa de interacción no nombra la pregunta del cierre`);
			if (reference === null) reference = normalized;
			else if (normalized !== reference) problems.push(`${file}: commit-pr-close diverge — ${firstDifference(reference, normalized)}`);
		}
	}
	for (const harness of HARNESSES) {
		const file = `${harness}/chiche-init/SKILL.md`;
		if (/^- No commitear nada\.$/m.test(await readRepoFile(file))) problems.push(`${file}: MUST NOT DO todavía prohíbe todo commit`);
	}
	assert.deepEqual(problems, []);
});
