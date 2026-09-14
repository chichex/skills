// Gate determinista del skill coding-policies.
//
// Conserva los criterios históricos del contrato base y agrega invariantes
// de expansión por stack sin presentar la spec inicial como alcance vigente.
// Verifica los artefactos del skill en los cuatro harnesses
// ({claude,codex,opencode,pi}/coding-policies): frontmatter y extras por
// harness (CA-1), doctrina equivalente tras normalizar la capa de interaccion
// (CA-2, CA-6), template del archivo generado identico (CA-8), referencias
// Go, TypeScript, Node, React, Next.js, React Native y Kotlin Multiplatform
// estructuralmente validas e identicas byte a byte, integracion con
// sdd-init (CA-9) y documentacion (CA-10). No observa la conducta del agente
// al ejecutar el skill: eso es protocolo humano (CA-5, CA-7).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { Harness } from "../harness-gate/interaction.ts";
import {
	HARNESSES,
	fencedBlocks,
	firstDifference,
	normalizeInvocations,
	parseInteractionTable,
} from "../harness-gate/interaction.ts";

const SKILL = "coding-policies";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Prefijo de invocacion por harness, derivado de la tabla normativa de
// docs/harness-interaction-differences.md (misma fuente que harness-gate).
let prefixesCache: Record<Harness, string> | null = null;
async function invocationPrefixes(): Promise<Record<Harness, string>> {
	if (prefixesCache === null) {
		prefixesCache = parseInteractionTable(await readRepoFile("docs/harness-interaction-differences.md")).prefixes;
	}
	return prefixesCache;
}

// Frases literales de la capa de interaccion de cada harness, en el orden en
// que se reemplazan (la mas larga primero). Toda otra divergencia dentro del
// bloque de doctrina es drift.
const QUESTION_PHRASES: Record<Harness, [string, string][]> = {
	claude: [
		["usar `AskUserQuestion` con multiSelect", "«pregunta-multiple»"],
		["usar `AskUserQuestion`", "«pregunta»"],
	],
	codex: [
		["preguntar en texto plano con todas las opciones y terminar el turno", "«pregunta-multiple»"],
		["usar `request_user_input` (o el mismo gate en texto plano, terminando el turno)", "«pregunta»"],
	],
	opencode: [
		["preguntar en texto plano con todas las opciones y terminar el turno", "«pregunta-multiple»"],
		["preguntar en texto plano y terminar el turno", "«pregunta»"],
	],
	pi: [
		['usar `ask_user_question` con `selectionMode: "multiple"`', "«pregunta-multiple»"],
		["usar `ask_user_question`", "«pregunta»"],
	],
};

// Estilo de pregunta propio de cada harness y tools ajenas que no pueden
// quedar colgadas (checklist de harness-port).
const QUESTION_STYLE: Record<Harness, { required: RegExp[]; forbidden: RegExp }> = {
	claude: {
		required: [/usar `AskUserQuestion` con multiSelect/, /usar `AskUserQuestion`:/],
		forbidden: /request_user_input|ask_user_question|texto plano/,
	},
	codex: {
		required: [/usar `request_user_input`/, /texto plano/],
		forbidden: /AskUserQuestion|ask_user_question/,
	},
	opencode: {
		required: [/preguntar en texto plano y terminar el turno/],
		forbidden: /AskUserQuestion|request_user_input|ask_user_question|`question`/,
	},
	pi: {
		required: [/usar `ask_user_question`/, /selectionMode: "multiple"/],
		forbidden: /AskUserQuestion|request_user_input/,
	},
};

// Doctrina que cada copia tiene que declarar, evaluada sobre el bloque de
// doctrina ya normalizado (CA-6).
const PROCEDURE_DOCTRINE: RegExp[] = [
	/^## Argumentos$/m,
	/«skill:coding-policies» \[go\|typescript\|node\|react\|next\|react-native\|kotlin-multiplatform\|kmp\|kmm\|kotlin-android \.\.\.\] \[--out <ruta>\] \[--no-link\]/,
	/Los aliases `kmp` y `kmm` se normalizan a `kotlin-multiplatform`/,
	/`next` incorpora `react` antes de comprobar cobertura, generar y reportar/,
	/[Ss]tacks posicionales[^\n]*saltean la confirmación de stacks/,
	/`--out <ruta>`[^\n]*saltea la pregunta de destino/,
	/`--no-link`[^\n]*saltea el enganche/,
	/^## Fase 0 — Lanzador \(pregunta solo lo que los argumentos no fijan\)$/m,
	/Con argumentos vacíos dispara completo\. Con argumentos, pregunta solo lo que no fijaron/,
	/`--no-link` no afecta a esta fase/,
	/«pregunta-multiple» — "¿Qué stacks entran\?"/,
	/"¿Dónde lo genero\?": `\.sdd\/coding-policies\.md \(Recomendado\)`/,
	/raíz y hasta profundidad 2, excluyendo `node_modules`, `vendor`, `\.git`, `dist` y `build`/,
	/`dependencies` y `devDependencies`/,
	/registra dónde se vio/,
	/^\| Go \| `go` \| `go\.mod` \|$/m,
	/^\| TypeScript \| `typescript` \| `tsconfig\*\.json` \|$/m,
	/^\| React web \| `react` \| `package\.json` con `react-dom` \|$/m,
	/^\| Next\.js \| `next` \| `package\.json` con la clave exacta `next` en sus dependencias \|$/m,
	/^\| React Native \| `react-native` \| `package\.json` con la clave exacta `react-native` o `expo` en sus dependencias \(`react-native-web` no cuenta\) \|$/m,
	/^\| Node \| `node` \| `package\.json` sin `react-native`, `expo`, `react-dom` ni `next` \|$/m,
	/^\| Kotlin Multiplatform \| `kotlin-multiplatform` \| `build\.gradle`, `build\.gradle\.kts` o `gradle\/libs\.versions\.toml` que declare `org\.jetbrains\.kotlin\.multiplatform` o `kotlin\("multiplatform"\)` \|$/m,
	/^\| Kotlin Android \| `kotlin-android` \| `build\.gradle`, `build\.gradle\.kts` o `gradle\/libs\.versions\.toml` que declare `com\.android\.application` o `com\.android\.library` \|$/m,
	/TypeScript se detecta de forma independiente y puede coexistir con Node, React, Next\.js o React Native/,
	/Next\.js se detecta de forma independiente[^\n]*`next` incorpora `react`/,
	/`next` no incorpora `node`[^\n]*capa servidor del framework/,
	/`react-native` gana sobre `react`, y `react` sobre `node`/,
	/En un mismo marcador Gradle, `kotlin-multiplatform` prevalece sobre `kotlin-android`/,
	/cubierto si existe `references\/<id>\.md`/,
	/"sin prácticas definidas todavía" y no generan sección/,
	/[Ss]i ningún stack confirmado está cubierto, no se genera archivo y se informa; el skill termina ahí, sin enganche/,
	/no lo pisa: lo dice, termina ahí sin enganche/,
	/`no intentado` cubre `--no-link` y las corridas que terminaron antes del enganche/,
	/crea `\.sdd\/`[^\n]*si no existe/,
	/copiado verbatim/,
	/^### Regeneración \(el destino ya existe\)$/m,
	/stacks desactualizados \(`<id>: <version vieja> → <version nueva>`\)/,
	/todo salvo `## Ajustes de este proyecto` se reescribe[^\n]*«pregunta»: `Regenerar \(Recomendado\)` \/ `Cancelar`/,
	/[Pp]reservar verbatim el bloque entre `<!-- coding-policies:ajustes:start -->` y `<!-- coding-policies:ajustes:end -->`/,
	/nunca interpreta el contenido de Ajustes/,
	/no tiene los dos markers de ajustes, no lo pisa/,
	/^## Fase 4 — Enganche \(saltear con `--no-link`\)$/m,
	/[Ss]olo se ofrecen los que existen: el skill nunca crea archivos de contexto/,
	/«pregunta-multiple» — "¿Dónde agrego la referencia\?"/,
	/idempotente: en `CLAUDE\.md` y `AGENTS\.md`, verificando antes que `<ruta>` no esté ya presente[^\n]*en `\.sdd\/project\.md`, comparando la fila entera/,
	/\*\*CLAUDE\.md\*\* — agregar al final una línea `@<ruta>`/,
	/«agents-link»/,
	/\| coding-policies \| <ruta> \(<stacks>\) \| guia — sin gate: «skill:sdd-run» la sigue al generar, la juzga el reviewer \|/,
	/reemplazando el sentinel "Sin politicas activas"/,
	/actualizando la fila en su lugar si ya existe/,
	/sin tocar nada si la sección no existe[^\n]*«skill:sdd-init» --update/,
	/^## Fase 5 — Reporte$/m,
	/^Coding policies listas: <ruta> \(<generado\|regenerado>\)$/m,
	/^- desactualizados antes de regenerar: /m,
	/^## MUST NOT DO$/m,
	/[Nn]o tocar configuración global de ningún harness/,
	/[Nn]o crear archivos de contexto/,
	/[Nn]o editar sin confirmación/,
	/[Nn]o inventar reglas para stacks sin referencia/,
	/[Nn]o interpretar, validar ni reformatear el contenido de "Ajustes de este proyecto"/,
	/[Nn]o pisar un destino existente que no tenga los dos markers de ajustes/,
];

// Mecanismo de enganche en AGENTS.md (CA-6.7, desviacion decidida por el
// usuario en el review del PR #38): AGENTS.md es el archivo compartido por
// Codex, opencode y Pi, y solo el bloque de instruccion funciona en los tres
// (`@<ruta>` queda inerte fuera de opencode). Las cuatro copias escriben el
// mismo bloque; el test de doctrina lo compara byte a byte.
const AGENTS_LINK_BLOCK =
	/\*\*AGENTS\.md\*\*[\s\S]*<!-- coding-policies -->\n\s*Antes de escribir o modificar código en este proyecto, leer `<ruta>`/;
const AGENTS_LINK_STYLE: Record<Harness, RegExp> = {
	claude: AGENTS_LINK_BLOCK,
	codex: AGENTS_LINK_BLOCK,
	opencode: AGENTS_LINK_BLOCK,
	pi: AGENTS_LINK_BLOCK,
};

// Template del archivo generado (CA-8).
const TEMPLATE_MARKERS: RegExp[] = [
	/^# Coding policies — <proyecto>$/m,
	/^<!-- coding-policies: generated=<YYYY-MM-DD>; stacks=<id>@<YYYY-MM-DD>\[,<id>@<YYYY-MM-DD>\.\.\.\] -->$/m,
	/^## <Nombre del stack>$/m,
	/^<!-- coding-policies:stack=<id>; version=<YYYY-MM-DD> -->$/m,
	/^## Ajustes de este proyecto$/m,
	/^<!-- coding-policies:ajustes:start -->$/m,
	/^<!-- coding-policies:ajustes:end -->$/m,
];

// Referencia Go (CA-4).
const GO_SECTIONS = [
	"Layout de paquetes",
	"Errores",
	"Naming",
	"Interfaces y tipos",
	"Concurrencia",
	"Testing",
	"Dependencias y configuración",
	"Lectura ampliada",
];
const GO_LINKS = [
	"https://github.com/uber-go/guide/blob/master/style.md",
	"https://go.dev/doc/effective_go",
	"https://go.dev/wiki/CodeReviewComments",
	"https://www.ardanlabs.com/blog/2017/02/package-oriented-design.html",
];
const TYPESCRIPT_SECTIONS = [
	"Alcance y configuración",
	"Tipos e inferencia",
	"Modelado y narrowing",
	"Genéricos y APIs",
	"Límites y validación",
	"Promesas y concurrencia",
	"Módulos y runtime",
	"Linting y supresiones",
	"Testing y verificación",
	"Rendimiento del tipado",
	"Lectura ampliada",
];
const TYPESCRIPT_LINKS = [
	"https://www.typescriptlang.org/tsconfig/strict.html",
	"https://www.typescriptlang.org/docs/handbook/2/everyday-types.html",
	"https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
	"https://www.typescriptlang.org/docs/handbook/2/functions.html",
	"https://typescript-eslint.io/getting-started/typed-linting/",
	"https://typescript-eslint.io/blog/avoiding-anys/",
	"https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html",
	"https://nodejs.org/api/typescript.html",
	"https://zod.dev/basics",
	"https://github.com/microsoft/TypeScript/wiki/Performance",
];
const NODE_SECTIONS = [
	"Alcance y versiones",
	"Event loop y CPU",
	"Timeouts y cancelación",
	"Streams y backpressure",
	"Errores",
	"Lifecycle",
	"Seguridad",
	"Contexto y testing",
	"Verificación",
	"Lectura ampliada",
];
const NODE_LINKS = [
	"https://nodejs.org/en/about/previous-releases",
	"https://docs.npmjs.com/cli/commands/npm-ci/",
	"https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop",
	"https://nodejs.org/api/worker_threads.html",
	"https://nodejs.org/api/globals.html#class-abortcontroller",
	"https://nodejs.org/api/stream.html",
	"https://nodejs.org/api/errors.html",
	"https://nodejs.org/api/process.html",
	"https://nodejs.org/api/http.html#serverclosecallback",
	"https://nodejs.org/learn/getting-started/security-best-practices",
	"https://nodejs.org/api/async_context.html",
	"https://nodejs.org/api/test.html",
];
const REACT_SECTIONS = [
	"Pureza y Hooks",
	"Estado y reducers",
	"Effects",
	"Identidad y componentes",
	"Memoización",
	"Testing y accesibilidad",
	"Verificación",
	"Lectura ampliada",
];
const REACT_LINKS = [
	"https://react.dev/reference/rules",
	"https://react.dev/reference/eslint-plugin-react-hooks",
	"https://react.dev/learn/choosing-the-state-structure",
	"https://react.dev/learn/extracting-state-logic-into-a-reducer",
	"https://react.dev/learn/you-might-not-need-an-effect",
	"https://react.dev/learn/removing-effect-dependencies",
	"https://react.dev/learn/preserving-and-resetting-state",
	"https://react.dev/learn/react-compiler/introduction",
	"https://react.dev/reference/react/useEffectEvent",
];
const NEXT_SECTIONS = [
	"Alcance y versión",
	"Servidor y cliente",
	"Datos y concurrencia",
	"Caché y revalidación",
	"Autenticación y límites",
	"Entrega de interfaz",
	"Testing y producción",
	"Verificación",
	"Lectura ampliada",
];
const NEXT_LINKS = [
	"https://nextjs.org/docs/app/guides/ai-agents",
	"https://nextjs.org/docs/app/getting-started/server-and-client-components",
	"https://nextjs.org/docs/app/getting-started/fetching-data",
	"https://nextjs.org/docs/app/guides/backend-for-frontend",
	"https://nextjs.org/docs/app/getting-started/caching",
	"https://nextjs.org/docs/app/getting-started/revalidating",
	"https://nextjs.org/docs/app/guides/authentication",
	"https://nextjs.org/docs/app/getting-started/metadata-and-og-images",
	"https://nextjs.org/docs/app/guides/production-checklist",
	"https://nextjs.org/docs/app/guides/testing/playwright",
];
const REACT_NATIVE_SECTIONS = [
	"Alcance y versiones",
	"React: pureza, estado y efectos",
	"Plataformas y layout",
	"Accesibilidad",
	"Rendimiento y listas",
	"Testing",
	"Seguridad y almacenamiento",
	"Módulos nativos",
	"Expo",
	"Verificación",
	"Lectura ampliada",
];
const REACT_NATIVE_LINKS = [
	"https://react.dev/reference/rules",
	"https://react.dev/learn/you-might-not-need-an-effect",
	"https://reactnative.dev/docs/environment-setup",
	"https://reactnative.dev/docs/platform-specific-code",
	"https://reactnative.dev/docs/accessibility",
	"https://reactnative.dev/docs/performance",
	"https://reactnative.dev/docs/testing-overview",
	"https://reactnative.dev/docs/security",
	"https://reactnative.dev/docs/turbo-native-modules-introduction",
	"https://docs.expo.dev/develop/development-builds/introduction/",
	"https://docs.expo.dev/workflow/continuous-native-generation/",
	"https://docs.expo.dev/eas-update/runtime-versions/",
];
const KOTLIN_MULTIPLATFORM_SECTIONS = [
	"Alcance y estructura",
	"Build, versiones y targets",
	"Source sets y dependencias",
	"Límites de plataforma",
	"Coroutines y cancelación",
	"Swift y Objective-C",
	"Testing multiplataforma",
	"Kotlin idiomático",
	"Compose Multiplatform",
	"Verificación",
	"Lectura ampliada",
];
const KOTLIN_MULTIPLATFORM_LINKS = [
	"https://kotlinlang.org/docs/multiplatform/multiplatform-project-recommended-structure.html",
	"https://kotlinlang.org/docs/multiplatform/multiplatform-compatibility-guide.html",
	"https://kotlinlang.org/docs/multiplatform/multiplatform-hierarchy.html",
	"https://kotlinlang.org/docs/multiplatform/multiplatform-add-dependencies.html",
	"https://kotlinlang.org/docs/multiplatform/multiplatform-connect-to-apis.html",
	"https://kotlinlang.org/docs/multiplatform/multiplatform-expect-actual.html",
	"https://kotlinlang.org/docs/coroutines-cancellation.html",
	"https://kotlinlang.org/docs/native-objc-interop.html",
	"https://kotlinlang.org/docs/multiplatform/multiplatform-run-tests.html",
	"https://kotlinlang.org/docs/coding-conventions.html",
	"https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html",
];
const RULES_MIN = 25;
const RULES_MAX = 45;
const CONTENT_COVERAGE_PATTERN =
	/(?:Trae contenido para|It ships content for)[^|]*Go[^|]*TypeScript[^|]*Node[^|]*React[^|]*Next\.js[^|]*React Native[^|]*Kotlin Multiplatform/i;

interface ReferenceCase {
	id: string;
	name: string;
	sections: readonly string[];
	links: readonly string[];
}

const REFERENCES: readonly ReferenceCase[] = [
	{ id: "go", name: "Go", sections: GO_SECTIONS, links: GO_LINKS },
	{ id: "typescript", name: "TypeScript", sections: TYPESCRIPT_SECTIONS, links: TYPESCRIPT_LINKS },
	{ id: "node", name: "Node.js", sections: NODE_SECTIONS, links: NODE_LINKS },
	{ id: "react", name: "React", sections: REACT_SECTIONS, links: REACT_LINKS },
	{ id: "next", name: "Next.js", sections: NEXT_SECTIONS, links: NEXT_LINKS },
	{
		id: "react-native",
		name: "React Native",
		sections: REACT_NATIVE_SECTIONS,
		links: REACT_NATIVE_LINKS,
	},
	{
		id: "kotlin-multiplatform",
		name: "Kotlin Multiplatform",
		sections: KOTLIN_MULTIPLATFORM_SECTIONS,
		links: KOTLIN_MULTIPLATFORM_LINKS,
	},
];

const STACK_ORDER = [
	"go",
	"typescript",
	"react",
	"next",
	"react-native",
	"node",
	"kotlin-multiplatform",
	"kotlin-android",
] as const;

type StackId = (typeof STACK_ORDER)[number];
type DependencyMap = Record<string, string>;

interface DetectionFile {
	path: string;
	content?: string;
	packageJson?: { dependencies?: DependencyMap; devDependencies?: DependencyMap };
}

export function normalizeRequestedStacks(requested: string[]): StackId[] {
	const normalized = new Set<string>(requested.map((id) => (id === "kmp" || id === "kmm" ? "kotlin-multiplatform" : id)));
	if (normalized.has("next")) normalized.add("react");
	return STACK_ORDER.filter((id) => normalized.has(id));
}

export function detectFixtureStacks(files: DetectionFile[]): StackId[] {
	const detected = new Set<StackId>();
	for (const file of files) {
		const basename = file.path.split("/").at(-1) ?? file.path;
		if (basename === "go.mod") detected.add("go");
		if (/^tsconfig.*\.json$/.test(basename)) detected.add("typescript");
		if (basename === "package.json" && file.packageJson) {
			const dependencies = { ...file.packageJson.dependencies, ...file.packageJson.devDependencies };
			const hasReactNative = Object.hasOwn(dependencies, "react-native") || Object.hasOwn(dependencies, "expo");
			const hasNext = Object.hasOwn(dependencies, "next");
			if (hasReactNative) detected.add("react-native");
			else if (Object.hasOwn(dependencies, "react-dom") || hasNext) detected.add("react");
			else detected.add("node");
			if (hasNext) detected.add("next");
		}
		if (["build.gradle", "build.gradle.kts", "libs.versions.toml"].includes(basename)) {
			const content = file.content ?? "";
			if (/org\.jetbrains\.kotlin\.multiplatform|kotlin\(["']multiplatform["']\)/.test(content)) {
				detected.add("kotlin-multiplatform");
			} else if (/com\.android\.(?:application|library)/.test(content)) {
				detected.add("kotlin-android");
			}
		}
	}
	return STACK_ORDER.filter((id) => detected.has(id));
}

// Integracion con sdd-init (CA-9), sobre el SKILL.md con invocaciones normalizadas.
const SDD_INIT_DOCTRINE: RegExp[] = [
	/^- \*\*Coding policies del proyecto\*\*: si existe `\.sdd\/coding-policies\.md`[^\n]*escribir sin preguntar la fila `guia`[^\n]*también con `--assume`/m,
	/o si la fila `coding-policies` ya presente en `## Politicas de generacion` apunta a un archivo existente, porque el skill acepta `--out`/,
	/\| coding-policies \| <ruta> \(<stacks del marker>\) \| guia — sin gate: «skill:sdd-run» la sigue al generar, la juzga el reviewer \|/,
	/[Ss]i no existe, sumar al menú la opción `Generar coding policies`[^\n]*invoca `«skill:coding-policies»`; nunca con `--assume`/,
	/^\| Coding policies \| existe `\.sdd\/coding-policies\.md` pero `## Politicas de generacion` no tiene la fila `coding-policies` — no entra al menú: la Fase 3\.5 la escribe sin preguntar y el reporte la lista como `referenciado` \|$/m,
	/^- coding-policies: <referenciado\|generado\|no existe \(ofrecido\)\|--assume: no ofrecido>$/m,
];

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return await readFile(repoFile(path), "utf8");
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(repoFile(path));
		return true;
	} catch {
		return false;
	}
}

// El Pi Package shippea lo que git trackea, no el working tree: un artefacto
// del skill sin trackear pasaria el resto del gate y no llegaria a nadie.
export function isTracked(path: string): boolean {
	try {
		execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: REPO_ROOT, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function trackedReferenceIds(harness: Harness): string[] {
	const directory = `${harness}/${SKILL}/references/`;
	const output = execFileSync("git", ["ls-files", "--", `${directory}*.md`], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
	return output
		.split("\n")
		.filter(Boolean)
		.map((path) => path.slice(directory.length, -".md".length))
		.sort();
}

export function announcedReferenceIds(markdown: string): string[] {
	const section = markdown.split(/^## Referencias$/m)[1] ?? "";
	return [...section.matchAll(/^- `references\/([a-z][a-z0-9-]*)\.md` —/gm)]
		.map((match) => match[1] ?? "")
		.filter(Boolean)
		.sort();
}

export function ruleLinesInSection(markdown: string, section: string): string[] {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line === `### ${section}`);
	if (start < 0) return [];
	const end = lines.findIndex((line, index) => index > start && line.startsWith("### "));
	return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => /^- \*\*(MUST|SHOULD)\*\*/.test(line));
}

export function normalizeQuestions(text: string, harness: Harness): string {
	let result = text;
	for (const [phrase, token] of QUESTION_PHRASES[harness]) {
		result = result.split(phrase).join(token);
	}
	return result;
}

export function delimited(markdown: string, name: string): string | null {
	const block = markdown.match(new RegExp(`<!-- ${name}:start -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`));
	return block ? (block[1] ?? "") : null;
}

// Doctrina comparable entre harnesses: invocaciones y tool de preguntas
// reducidas a tokens, y el mecanismo de AGENTS.md (legitimamente distinto en
// opencode) reducido a un token que se valida aparte.
export function normalizeDoctrine(doctrine: string, harness: Harness, prefix: string): string {
	const withoutAgents = doctrine.replace(
		/<!-- coding-policies-agents-link:start -->\n[\s\S]*?\n<!-- coding-policies-agents-link:end -->/,
		"«agents-link»",
	);
	return normalizeQuestions(normalizeInvocations(withoutAgents, prefix), harness);
}

export function templateFence(markdown: string): string | null {
	const fence = fencedBlocks(markdown).find((candidate) =>
		/^<!-- coding-policies: generated=/m.test(candidate.content),
	);
	return fence ? fence.content : null;
}

interface Frontmatter {
	fields: Record<string, string>;
	body: string;
}

export function splitFrontmatter(markdown: string): Frontmatter | null {
	const lines = markdown.split("\n");
	if (lines[0] !== "---") return null;
	const end = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
	if (end < 0) return null;
	const fields: Record<string, string> = {};
	for (const line of lines.slice(1, end)) {
		const match = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
		if (match) fields[match[1] ?? ""] = (match[2] ?? "").trim();
	}
	return { fields, body: lines.slice(end + 1).join("\n") };
}

interface Rule {
	level: "MUST" | "SHOULD";
	rule: string;
	why: string;
	gate: string;
}

export function parseRule(line: string): Rule | string {
	const head = line.match(/^- \*\*(MUST|SHOULD)\*\* (.+)$/);
	if (!head) return "no empieza con `- **MUST**` o `- **SHOULD**`";
	const rest = head[2] ?? "";
	const whyParts = rest.split(". Porqué: ");
	if (whyParts.length !== 2) return "no tiene exactamente un `. Porqué: `";
	const gateParts = (whyParts[1] ?? "").split(". Gate: ");
	if (gateParts.length !== 2) return "no tiene exactamente un `. Gate: `";
	const rule = (whyParts[0] ?? "").trim();
	const why = (gateParts[0] ?? "").trim();
	const gate = (gateParts[1] ?? "").trim();
	if (rule === "") return "regla vacía";
	if (why === "") return "porqué vacío";
	if (gate !== "—" && !/`[^`]+`/.test(gate)) return "el gate no es `—` ni nombra una herramienta entre backticks";
	return { level: head[1] as "MUST" | "SHOULD", rule, why, gate };
}

interface ReferenceVerdict {
	problems: string[];
	rules: Rule[];
	sections: string[];
	fields: Record<string, string>;
}

export function validateReference(
	markdown: string,
	expectedSections: readonly string[],
	links: readonly string[],
): ReferenceVerdict {
	const problems: string[] = [];
	const rules: Rule[] = [];
	const sections: string[] = [];
	const split = splitFrontmatter(markdown);
	if (!split) {
		return { problems: ["sin frontmatter YAML"], rules, sections, fields: {} };
	}
	const { fields, body } = split;
	if (!/^[a-z][a-z0-9-]*$/.test(fields.stack ?? "")) problems.push("frontmatter sin `stack` válido");
	if ((fields.name ?? "") === "") problems.push("frontmatter sin `name`");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.version ?? "")) problems.push("frontmatter sin `version: YYYY-MM-DD`");

	let current: string | null = null;
	body.split("\n").forEach((line, index) => {
		const number = index + 1;
		const heading = line.match(/^(#{1,6}) (.*)$/);
		if (heading) {
			if ((heading[1] ?? "").length !== 3) {
				problems.push(`línea ${number}: encabezado de nivel distinto de ### (\`${line}\`)`);
				return;
			}
			current = (heading[2] ?? "").trim();
			sections.push(current);
			return;
		}
		if (!line.startsWith("- ")) return;
		if (current === null) {
			problems.push(`línea ${number}: bullet fuera de toda sección`);
			return;
		}
		if (current === "Lectura ampliada") return;
		const parsed = parseRule(line);
		if (typeof parsed === "string") {
			problems.push(`línea ${number}: ${parsed} (\`${line.slice(0, 60)}\`)`);
			return;
		}
		rules.push(parsed);
	});

	if (sections.join(" ") !== expectedSections.join(" ")) {
		problems.push(`secciones ${JSON.stringify(sections)} — esperadas ${JSON.stringify(expectedSections)} en ese orden`);
	}
	if (rules.length < RULES_MIN || rules.length > RULES_MAX) {
		problems.push(`${rules.length} reglas — esperadas entre ${RULES_MIN} y ${RULES_MAX}`);
	}
	const reading = body.split("### Lectura ampliada")[1] ?? "";
	for (const link of links) {
		if (!reading.includes(link)) problems.push(`Lectura ampliada sin el link ${link}`);
	}
	return { problems, rules, sections, fields };
}

// Compara los harnesses presentes en el mapa, el primero como referencia;
// un harness ausente no se inventa como divergencia (permite comparar
// subconjuntos, como el bloque de AGENTS.md que opencode no comparte).
export function compareAcrossHarnesses(label: string, byHarness: Map<Harness, string>): string[] {
	const divergences: string[] = [];
	const [reference, ...rest] = [...byHarness.keys()];
	if (reference === undefined) return divergences;
	const referenceText = byHarness.get(reference) ?? "";
	for (const harness of rest) {
		const other = byHarness.get(harness) ?? "";
		if (other !== referenceText) {
			divergences.push(`${label}: ${reference} y ${harness} difieren — ${firstDifference(referenceText, other)}`);
		}
	}
	return divergences;
}

async function skillMarkdown(harness: Harness): Promise<string> {
	return await readRepoFile(`${harness}/${SKILL}/SKILL.md`);
}

// --- CA-1: artefactos por harness --------------------------------------------

for (const harness of HARNESSES) {
	test(`${harness}/${SKILL}: SKILL.md con frontmatter y extras propios del harness`, async () => {
		const markdown = await skillMarkdown(harness);
		const split = splitFrontmatter(markdown);
		assert.ok(split, "SKILL.md abre con frontmatter YAML");
		assert.equal(split.fields.name, SKILL, "name igual a la carpeta");
		assert.match(
			split.fields.description ?? "",
			/coding policies[\s\S]*buenas prácticas[\s\S]*políticas de código/i,
			"la description dispara con los pedidos esperados",
		);
		assert.match(split.fields.description ?? "", /"mis prácticas de TypeScript"/, "la description dispara para TypeScript");
		assert.match(split.fields.description ?? "", /"mis prácticas de Node"/, "la description dispara para Node");
		assert.match(split.fields.description ?? "", /"mis prácticas de React"/, "la description dispara para React");
		assert.match(split.fields.description ?? "", /"mis prácticas de Next\.js"/, "la description dispara para Next.js");
		assert.match(split.fields.description ?? "", /"mis prácticas de React Native"/, "la description dispara para React Native");
		assert.match(split.fields.description ?? "", /"mis prácticas de Kotlin Multiplatform"/, "la description dispara para Kotlin Multiplatform");
		assert.match(split.fields.description ?? "", /"mis prácticas de KMP"/, "la description dispara para KMP");
		assert.match(split.fields.description ?? "", /"mis prácticas de KMM"/, "la description dispara para KMM");
		assert.match(markdown, /`references\/typescript\.md` — TypeScript/, "la lista de referencias incluye TypeScript");
		assert.match(markdown, /`references\/node\.md` — Node\.js/, "la lista de referencias incluye Node.js");
		assert.match(markdown, /`references\/react\.md` — React/, "la lista de referencias incluye React");
		assert.match(markdown, /`references\/next\.md` — Next\.js/, "la lista de referencias incluye Next.js");
		assert.match(markdown, /`references\/react-native\.md` — React Native/, "la lista de referencias incluye React Native");
		assert.match(
			markdown,
			/`references\/kotlin-multiplatform\.md` — Kotlin Multiplatform/,
			"la lista de referencias incluye Kotlin Multiplatform",
		);
		const hasSidecar = await exists(`${harness}/${SKILL}/agents/openai.yaml`);
		if (harness === "codex") {
			assert.ok(hasSidecar, "codex lleva agents/openai.yaml");
			const sidecar = await readRepoFile(`${harness}/${SKILL}/agents/openai.yaml`);
			for (const key of ["display_name", "short_description", "default_prompt"]) {
				assert.match(sidecar, new RegExp(`^\\s*${key}: "[^"]+"$`, "m"), `sidecar declara ${key}`);
			}
			assert.match(sidecar, /default_prompt: "[^"]*\$coding-policies/, "default_prompt invoca $coding-policies");
		} else {
			assert.equal(hasSidecar, false, `${harness} no lleva sidecar de Codex`);
		}
		if (harness === "pi") {
			assert.match(split.fields.compatibility ?? "", /ask_user_question/, "pi declara compatibility con la tool de preguntas");
		} else {
			assert.equal(split.fields.compatibility, undefined, `${harness} no declara compatibility`);
		}
	});
}

// --- CA-2: capa de interaccion propia y doctrina equivalente ------------------

for (const harness of HARNESSES) {
	test(`${harness}/${SKILL}: usa la tool de preguntas de su harness y ninguna ajena`, async () => {
		const markdown = await skillMarkdown(harness);
		for (const required of QUESTION_STYLE[harness].required) {
			assert.match(markdown, required, `${harness} no usa ${required}`);
		}
		assert.doesNotMatch(markdown, QUESTION_STYLE[harness].forbidden, `${harness} menciona una tool de otro harness`);
		assert.match(markdown, AGENTS_LINK_STYLE[harness], `${harness} no declara su mecanismo de enganche en AGENTS.md`);
	});
}

test(`${SKILL}: doctrina byte-equivalente entre harnesses tras normalizar la capa de interaccion`, async () => {
	const byHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const doctrine = delimited(await skillMarkdown(harness), "coding-policies-doctrine");
		assert.ok(doctrine, `${harness}/${SKILL}/SKILL.md delimita su doctrina`);
		byHarness.set(harness, normalizeDoctrine(doctrine, harness, (await invocationPrefixes())[harness]));
	}
	assert.deepEqual(compareAcrossHarnesses(SKILL, byHarness), []);
	// El bloque de AGENTS.md se compara crudo y por separado: tiene que ser
	// byte-igual en las cuatro copias, no solo matchear la regex laxa de
	// AGENTS_LINK_STYLE.
	const blocks = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const block = delimited(await skillMarkdown(harness), "coding-policies-agents-link");
		assert.ok(block, `${harness}/${SKILL}/SKILL.md delimita el bloque de AGENTS.md`);
		blocks.set(harness, block);
	}
	assert.deepEqual(compareAcrossHarnesses(`${SKILL} bloque AGENTS.md`, blocks), []);
});

test(`${SKILL}: censo Git anti-drift de referencias y artefactos`, async () => {
	const expected = REFERENCES.map((reference) => reference.id).sort();
	const censuses = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const tracked = trackedReferenceIds(harness);
		censuses.set(harness, tracked.join("\n"));
		assert.deepEqual(tracked, expected, `${harness}: el censo trackeado difiere de la tabla de casos`);
		assert.deepEqual(
			announcedReferenceIds(await skillMarkdown(harness)),
			expected,
			`${harness}: SKILL.md no anuncia exactamente las referencias trackeadas`,
		);
	}
	assert.deepEqual(compareAcrossHarnesses("censo de references/*.md", censuses), []);
	const fixedArtifacts = [...HARNESSES.map((harness) => `${harness}/${SKILL}/SKILL.md`), `codex/${SKILL}/agents/openai.yaml`];
	assert.deepEqual(fixedArtifacts.filter((path) => !isTracked(path)), [], "artefactos fijos sin trackear");
});

test(`${SKILL}: fixtures de package.json fijan coexistencia y precedencia`, () => {
	assert.deepEqual(
		detectFixtureStacks([
			{
				path: "package.json",
				packageJson: { dependencies: { "react-native": "1", "react-dom": "1", express: "1" } },
			},
		]),
		["react-native"],
		"react-native prevalece sobre react y node dentro del mismo manifest",
	);
	assert.deepEqual(
		detectFixtureStacks([{ path: "package.json", packageJson: { dependencies: { "react-dom": "1", express: "1" } } }]),
		["react"],
		"react prevalece sobre node dentro del mismo manifest",
	);
	assert.deepEqual(
		detectFixtureStacks([{ path: "package.json", packageJson: { dependencies: { "react-native-web": "1" } } }]),
		["node"],
		"react-native-web no cuenta como React Native",
	);
	assert.deepEqual(
		detectFixtureStacks([
			{ path: "tsconfig.app.json" },
			{ path: "package.json", packageJson: { devDependencies: { next: "1" } } },
		]),
		["typescript", "react", "next"],
		"next implica react, excluye la referencia node y coexiste con TypeScript",
	);
});

test(`${SKILL}: fixtures Gradle fijan precedencia por marcador y coexistencia entre módulos`, () => {
	assert.deepEqual(
		detectFixtureStacks([
			{
				path: "build.gradle.kts",
				content: 'plugins { kotlin("multiplatform"); id("com.android.library") }',
			},
		]),
		["kotlin-multiplatform"],
		"KMP prevalece en un mismo marcador",
	);
	assert.deepEqual(
		detectFixtureStacks([
			{ path: "shared/build.gradle.kts", content: 'plugins { kotlin("multiplatform") }' },
			{ path: "androidApp/build.gradle.kts", content: 'plugins { id("com.android.application") }' },
		]),
		["kotlin-multiplatform", "kotlin-android"],
		"módulos separados pueden aportar ambos stacks",
	);
});

test(`${SKILL}: normalización explícita aplica aliases y dependencia next → react`, () => {
	assert.deepEqual(normalizeRequestedStacks(["kmp", "kmm", "next"]), ["react", "next", "kotlin-multiplatform"]);
});

// --- CA-6: procedimiento completo --------------------------------------------

for (const harness of HARNESSES) {
	test(`${harness}/${SKILL}: declara el procedimiento completo`, async () => {
		const doctrine = delimited(await skillMarkdown(harness), "coding-policies-doctrine");
		assert.ok(doctrine);
		const normalized = normalizeDoctrine(doctrine, harness, (await invocationPrefixes())[harness]);
		for (const expected of PROCEDURE_DOCTRINE) {
			assert.match(normalized, expected, `${harness}/${SKILL}/SKILL.md no declara ${expected}`);
		}
	});
}

// --- CA-8: template del archivo generado -------------------------------------

test(`${SKILL}: template del archivo generado identico entre harnesses y con sus markers`, async () => {
	const byHarness = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const fence = templateFence(await skillMarkdown(harness));
		assert.ok(fence, `${harness}/${SKILL}/SKILL.md instruye el template del archivo generado`);
		for (const marker of TEMPLATE_MARKERS) {
			assert.match(fence, marker, `${harness}: el template no declara ${marker}`);
		}
		byHarness.set(harness, normalizeInvocations(fence, (await invocationPrefixes())[harness]));
	}
	assert.deepEqual(compareAcrossHarnesses(`${SKILL} template`, byHarness), []);
});

// --- Referencias -------------------------------------------------------------

for (const reference of REFERENCES) {
	test(`${SKILL}: references/${reference.id}.md valida e identica byte a byte en los cuatro harnesses`, async () => {
		const byHarness = new Map<Harness, string>();
		for (const harness of HARNESSES) {
			byHarness.set(harness, await readRepoFile(`${harness}/${SKILL}/references/${reference.id}.md`));
		}
		assert.deepEqual(compareAcrossHarnesses(`references/${reference.id}.md`, byHarness), []);
		const markdown = byHarness.get("claude") ?? "";
		const verdict = validateReference(markdown, reference.sections, reference.links);
		assert.deepEqual(verdict.problems, [], `${reference.id}: estructura inválida`);
		assert.equal(verdict.fields.stack, reference.id, `${reference.id}: frontmatter stack`);
		assert.equal(verdict.fields.name, reference.name, `${reference.id}: frontmatter name`);
		assert.ok(verdict.rules.some((rule) => rule.level === "MUST"), `${reference.id}: hay reglas MUST`);
		assert.ok(verdict.rules.some((rule) => rule.level === "SHOULD"), `${reference.id}: hay reglas SHOULD`);
		assert.ok(verdict.rules.some((rule) => rule.gate !== "—"), `${reference.id}: algún gate concreto`);
		if (reference.id === "node") {
			assert.doesNotMatch(markdown, /nodejs\.org\/docs\/latest-v\d+|docs\.npmjs\.com\/cli\/v\d+\//, "node: links sin rama mayor pinneada");
		}
	});
}

test(`${SKILL}: las secciones condicionales guardan cada regla`, async () => {
	const reactNative = await readRepoFile(`claude/${SKILL}/references/react-native.md`);
	const expoRules = ruleLinesInSection(reactNative, "Expo");
	assert.ok(expoRules.length > 0, "React Native declara reglas Expo");
	for (const rule of expoRules) {
		assert.match(rule, /^- \*\*(MUST|SHOULD)\*\* Si el proyecto usa Expo,/, `regla Expo sin guarda: ${rule}`);
	}
	const kotlin = await readRepoFile(`claude/${SKILL}/references/kotlin-multiplatform.md`);
	const composeRules = ruleLinesInSection(kotlin, "Compose Multiplatform");
	assert.ok(composeRules.length > 0, "KMP declara reglas Compose Multiplatform");
	for (const rule of composeRules) {
		assert.match(
			rule,
			/^- \*\*(MUST|SHOULD)\*\* Si el proyecto usa Compose Multiplatform,/,
			`regla Compose sin guarda: ${rule}`,
		);
	}
});

// --- CA-9: integracion con sdd-init ------------------------------------------

test("sdd-init integra coding-policies en los cuatro harnesses sin tocar el template del contrato", async () => {
	const bullets = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/sdd-init/SKILL.md`);
		const normalized = normalizeInvocations(markdown, (await invocationPrefixes())[harness]);
		for (const expected of SDD_INIT_DOCTRINE) {
			assert.match(normalized, expected, `${harness}/sdd-init/SKILL.md no declara ${expected}`);
		}
		const bullet = normalized.match(/^- \*\*Coding policies del proyecto\*\*:[^\n]*$/m)?.[0] ?? "";
		bullets.set(harness, bullet);
		const contractTemplate = fencedBlocks(markdown).find((fence) => /type=project; generated-at=/.test(fence.content));
		assert.ok(contractTemplate, `${harness}/sdd-init/SKILL.md conserva el template del contrato`);
		assert.doesNotMatch(contractTemplate.content, /coding-policies/, `${harness}: el template del contrato no cambia`);
	}
	assert.deepEqual(compareAcrossHarnesses("sdd-init coding-policies", bullets), []);
});

// --- CA-10: documentacion ----------------------------------------------------

test("READMEs y manifests del plugin documentan coding-policies", async () => {
	for (const readme of ["README.md", "README.en.md"]) {
		const text = await readRepoFile(readme);
		const row = text.match(/^\| \*\*`coding-policies`\*\* \|[^\n]*\|$/m)?.[0] ?? "";
		assert.notEqual(row, "", `${readme} tiene la fila coding-policies en la tabla de skills`);
		assert.match(row, /\.sdd\/coding-policies\.md/, `${readme}: la fila dice dónde genera`);
		assert.match(row, /Go/, `${readme}: la fila anuncia cobertura para Go`);
		assert.match(row, /TypeScript/, `${readme}: la fila anuncia cobertura para TypeScript`);
		assert.match(
			row,
			CONTENT_COVERAGE_PATTERN,
			`${readme}: la frase de contenido enumera los siete stacks cubiertos`,
		);
		assert.match(row, /[Aa]justes|[Aa]djustments/, `${readme}: la fila menciona la preservación de ajustes`);
	}
	for (const manifest of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
		const parsed = JSON.parse(await readRepoFile(manifest)) as {
			description?: string;
			keywords?: string[];
			plugins?: { description?: string; keywords?: string[] }[];
		};
		const entries = manifest.endsWith("marketplace.json") ? parsed.plugins ?? [] : [parsed];
		assert.ok(entries.length > 0, `${manifest} declara al menos una entrada`);
		for (const entry of entries) {
			const description = entry.description ?? "";
			assert.match(description, /coding-policies/, `${manifest}: description menciona coding-policies`);
			assert.match(
				description,
				/Go[\s\S]*TypeScript[\s\S]*Node\.js[\s\S]*React[\s\S]*Next\.js[\s\S]*React Native[\s\S]*Kotlin Multiplatform/,
				`${manifest}: description enumera los stacks con contenido`,
			);
			assert.doesNotMatch(description, /v1:\s*Go/i, `${manifest}: description no conserva el alcance v1 obsoleto`);
			assert.ok((entry.keywords ?? []).includes("coding-policies"), `${manifest}: keywords incluye coding-policies`);
		}
	}
});

// --- Autotests del gate: puede fallar y con que diagnostico -------------------

function syntheticReference(options: { rules?: number; dropSection?: string; breakRule?: string } = {}): string {
	const count = options.rules ?? 30;
	const sections = GO_SECTIONS.filter((section) => section !== options.dropSection);
	const ruleSections = sections.filter((section) => section !== "Lectura ampliada");
	const lines = ["---", "stack: go", "name: Go", "version: 2026-09-14", "---", ""];
	let emitted = 0;
	ruleSections.forEach((section, index) => {
		lines.push(`### ${section}`, "");
		const share = index === ruleSections.length - 1 ? count - emitted : Math.floor(count / ruleSections.length);
		for (let i = 0; i < share; i++) {
			lines.push(`- **MUST** Regla ${emitted + 1}. Porqué: motivo. Gate: \`go vet\``);
			emitted += 1;
		}
		lines.push("");
	});
	if (options.breakRule) {
		const index = lines.findIndex((line) => line.startsWith("- **MUST** Regla 1."));
		assert.ok(index >= 0, "la referencia sintetica tiene la regla 1 que el autotest va a romper");
		lines.splice(index, 1, options.breakRule);
	}
	if (sections.includes("Lectura ampliada")) {
		lines.push("### Lectura ampliada", "", ...GO_LINKS.map((link) => `- [${link}](${link})`), "");
	}
	return lines.join("\n");
}

test("autotest: una referencia sintetica valida pasa sin diagnosticos", () => {
	const verdict = validateReference(syntheticReference(), GO_SECTIONS, GO_LINKS);
	assert.deepEqual(verdict.problems, []);
	assert.equal(verdict.rules.length, 30);
});

test("autotest: la cobertura del README exige la frase de contenido, no autocontenido", () => {
	assert.doesNotMatch(
		"un archivo autocontenido (Go, TypeScript, Node, React, Next.js, React Native, Kotlin Multiplatform)",
		CONTENT_COVERAGE_PATTERN,
	);
	assert.match(
		"Trae contenido para Go, TypeScript, Node, React, Next.js, React Native y Kotlin Multiplatform",
		CONTENT_COVERAGE_PATTERN,
	);
});

test("autotest: una regla sin Gate se reporta con su linea", () => {
	const verdict = validateReference(
		syntheticReference({ breakRule: "- **MUST** Regla 1. Porqué: motivo sin gate" }),
		GO_SECTIONS,
		GO_LINKS,
	);
	assert.equal(verdict.problems.length, 1);
	assert.match(verdict.problems[0] ?? "", /no tiene exactamente un `\. Gate: `/);
});

test("autotest: un gate que no nombra herramienta se reporta", () => {
	assert.match(String(parseRule("- **SHOULD** Regla. Porqué: motivo. Gate: revisar a mano")), /no es `—` ni nombra/);
	assert.equal(typeof parseRule("- **SHOULD** Regla. Porqué: motivo. Gate: —"), "object");
	assert.equal(typeof parseRule("- **MUST** Regla. Porqué: motivo. Gate: `golangci-lint` (errcheck)"), "object");
});

test("autotest: una seccion faltante se reporta con el orden esperado", () => {
	const verdict = validateReference(syntheticReference({ dropSection: "Concurrencia" }), GO_SECTIONS, GO_LINKS);
	assert.equal(verdict.problems.length, 1);
	assert.match(verdict.problems[0] ?? "", /secciones .* esperadas/);
});

test("autotest: fuera del rango de reglas se reporta con el conteo", () => {
	const few = validateReference(syntheticReference({ rules: RULES_MIN - 1 }), GO_SECTIONS, GO_LINKS);
	assert.match(few.problems.join("\n"), new RegExp(`${RULES_MIN - 1} reglas`));
	const many = validateReference(syntheticReference({ rules: RULES_MAX + 1 }), GO_SECTIONS, GO_LINKS);
	assert.match(many.problems.join("\n"), new RegExp(`${RULES_MAX + 1} reglas`));
});

test("autotest: la normalizacion reduce invocacion y tool de preguntas al mismo token", () => {
	const claude = normalizeDoctrine("usar `AskUserQuestion` con multiSelect tras /coding-policies", "claude", "/");
	const codex = normalizeDoctrine(
		"preguntar en texto plano con todas las opciones y terminar el turno tras $coding-policies",
		"codex",
		"$",
	);
	const pi = normalizeDoctrine(
		'usar `ask_user_question` con `selectionMode: "multiple"` tras /skill:coding-policies',
		"pi",
		"/skill:",
	);
	assert.equal(claude, codex);
	assert.equal(codex, pi);
	assert.equal(claude, "«pregunta-multiple» tras «skill:coding-policies»");
});

test("autotest: una divergencia de doctrina entre harnesses se reporta con la linea", () => {
	const byHarness = new Map<Harness, string>([
		["claude", "a\nb"],
		["codex", "a\nb"],
		["opencode", "a\nDIVERGENTE"],
		["pi", "a\nb"],
	]);
	const divergences = compareAcrossHarnesses("x", byHarness);
	assert.equal(divergences.length, 1);
	assert.match(divergences[0] ?? "", /opencode[\s\S]*DIVERGENTE/);
});

test("autotest: la comparacion acepta un subconjunto de harnesses sin inventar ausentes", () => {
	const three = new Map<Harness, string>([
		["claude", "bloque"],
		["codex", "bloque"],
		["pi", "bloque DIVERGENTE"],
	]);
	const divergences = compareAcrossHarnesses("subconjunto", three);
	assert.equal(divergences.length, 1, "solo pi diverge; opencode no se compara porque no esta en el mapa");
	assert.match(divergences[0] ?? "", /pi[\s\S]*DIVERGENTE/);
});

test("autotest: un archivo untracked se reporta como no trackeado y uno trackeado como trackeado", async () => {
	const scratch = `claude/${SKILL}/references/.scratch-${process.pid}.md`;
	await writeFile(repoFile(scratch), "scratch untracked\n");
	try {
		assert.equal(isTracked(scratch), false);
		assert.equal(isTracked(`claude/${SKILL}/SKILL.md`), true);
	} finally {
		await rm(repoFile(scratch), { force: true });
	}
});
