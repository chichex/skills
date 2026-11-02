import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const productionSources = [
	"../github-issues.ts",
	"../github-issue-selector.ts",
	"../grill-tools/index.ts",
	"./controller.ts",
	"./direct-launch.ts",
	"./dispatch.ts",
	"./index.ts",
	"./same-session.ts",
] as const;

const FORBIDDEN_SKILL_SLASH = /\/skill:(?:issue-triage|grill|chiche-spec|chiche-run)\b/;
const FORBIDDEN_DYNAMIC_SLASH = /`\/\$\{(?:skillCommand|grillCommand|command)\}/;

test("included Pi consumers contain zero SDD dispatch through literal or dynamic skill slash messages", async () => {
	for (const path of productionSources) {
		const source = await readFile(new URL(path, import.meta.url), "utf8");
		assert.doesNotMatch(source, FORBIDDEN_SKILL_SLASH, path);
		assert.doesNotMatch(source, FORBIDDEN_DYNAMIC_SLASH, path);
	}
});

// Issue #103, S11: los alias `sdd-*` existen solo para quien los escribe a mano.
// Ningún consumidor Pi los despacha: ni por `/skill:sdd-*`, ni por nombre de
// comando `skill:sdd-*`, ni como `name: "sdd-*"` de un skill a materializar.
const FORBIDDEN_ALIAS_DISPATCH = /\/?skill:sdd-(?:init|spec|run|land)\b|\bname: "sdd-(?:init|spec|run|land)"/;

// Ni como nombre posicional: producción pasa el skill como string suelto
// (`request(resolution, "chiche-spec", …)`, `continueWithMaterializedSkill(pi,
// "chiche-spec", …)`), así que el literal entero `"sdd-<x>"` también se prohíbe.
const FORBIDDEN_ALIAS_LITERAL = /["'`]sdd-(?:init|spec|run|land)["'`]/;

// Formas con el literal `"sdd-<x>"` que no despachan un skill y deben quedar.
// Se quitan del fuente antes de buscar.
const ALLOWED_ALIAS_LITERALS = [
	// El comando de extensión `/sdd-run` es el alias deprecado en sí (S11): avisa y delega en `/chiche-run`.
	/\bregisterCommand\("sdd-run"/g,
	// Discriminante `kind` del protocolo directo (direct-protocol.ts, direct-launch.ts): un request v1
	// ya emitido lo lleva persistido, así que renombrarlo lo invalidaría. No nombra un skill.
	/\bkind: "sdd-run"/g,
	// La validación de ese mismo discriminante (`object.kind !== "sdd-run"`).
	/\bkind !== "sdd-run"/g,
	// `"sdd-spec-publication"` (receipt persistido de chiche-artifacts) y `"sdd-spec-inspection"` (entrada de
	// sesión de grill-tools) no necesitan excepción: el literal sigue después de `spec`, no cierra la comilla.
];

// Los despachos de alias que encuentra el gate en `source`, tras quitar las formas permitidas.
function aliasDispatches(source: string): string[] {
	let text = source;
	for (const allowed of ALLOWED_ALIAS_LITERALS) text = text.replace(allowed, "");
	return [FORBIDDEN_ALIAS_DISPATCH, FORBIDDEN_ALIAS_LITERAL]
		.flatMap((pattern) => text.match(new RegExp(pattern.source, "g")) ?? []);
}

async function productionTypeScript(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "fixtures") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await productionTypeScript(path));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
	}
	return files;
}

test("no Pi extension dispatches a deprecated sdd-* alias skill", async () => {
	const sources = await productionTypeScript(fileURLToPath(new URL("..", import.meta.url)));
	assert.ok(sources.length > 20, `se esperaban los fuentes de producción de pi-extensions, hay ${sources.length}`);
	for (const path of sources) {
		assert.deepEqual(aliasDispatches(await readFile(path, "utf8")), [], path);
	}
});

test("the alias dispatch gate rejects each shape it is meant to catch", () => {
	for (const bad of ["/skill:sdd-run #14", "pi.getCommands().has('skill:sdd-spec')", 'skill: { name: "sdd-land" }', "`/skill:sdd-init`"]) {
		assert.notDeepEqual(aliasDispatches(bad), [], bad);
	}
	for (const fine of ["sdd-spec-publication", "__sdd-dispatch", "/skill:chiche-run"]) {
		assert.deepEqual(aliasDispatches(fine), [], fine);
	}
});

test("the alias dispatch gate rejects a positional skill name, the way production dispatches", () => {
	for (const bad of [
		'request(resolution, "sdd-spec", { issue })',
		'continueWithMaterializedSkill(pi, "sdd-run", context)',
		"await dispatch(pi, 'sdd-land')",
		"skill(`sdd-init`)",
		'const skills = ["grill", "sdd-spec"]',
	]) {
		assert.notDeepEqual(aliasDispatches(bad), [], bad);
	}
});

test("the alias dispatch gate keeps the persisted identifiers and the /sdd-run command", () => {
	for (const fine of [
		'pi.registerCommand("sdd-run", {',
		'kind: "sdd-run";',
		'kind: "sdd-run",',
		'if (object.kind !== "sdd-run") diagnostics.push(',
		'kind: "sdd-spec-publication";',
		'pi.registerEntryRenderer("sdd-spec-inspection", render)',
		'pi.appendEntry("sdd-spec-inspection", details)',
		'notify(context, "sdd-run es un alias deprecado: usá chiche-run", "info")',
		'registerCommand("__sdd-dispatch"',
		'request(resolution, "chiche-spec", { issue })',
		'continueWithMaterializedSkill(pi, "chiche-run", context)',
	]) {
		assert.deepEqual(aliasDispatches(fine), [], fine);
	}
	// La excepción es por forma, no por archivo: el mismo nombre suelto en otra posición sigue prohibido.
	assert.notDeepEqual(aliasDispatches('registerCommand("sdd-run", () => dispatch(pi, "sdd-run"))'), []);
});
