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
// comando `skill:sdd-*`, ni como `name: "sdd-*"` de un skill a materializar. Los
// identificadores persistidos (`kind: "sdd-run"`, `sdd-spec-publication`,
// `sdd-spec-inspection`, `__sdd-dispatch`) no son skills y no entran acá.
const FORBIDDEN_ALIAS_DISPATCH = /\/?skill:sdd-(?:init|spec|run|land)\b|\bname: "sdd-(?:init|spec|run|land)"/;

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
		assert.doesNotMatch(await readFile(path, "utf8"), FORBIDDEN_ALIAS_DISPATCH, path);
	}
});

test("the alias dispatch gate rejects each shape it is meant to catch", () => {
	for (const bad of ["/skill:sdd-run #14", "pi.getCommands().has('skill:sdd-spec')", 'skill: { name: "sdd-land" }', "`/skill:sdd-init`"]) {
		assert.match(bad, FORBIDDEN_ALIAS_DISPATCH, bad);
	}
	for (const fine of ['kind: "sdd-run"', 'registerCommand("sdd-run"', "sdd-spec-publication", "__sdd-dispatch", "/skill:chiche-run"]) {
		assert.doesNotMatch(fine, FORBIDDEN_ALIAS_DISPATCH, fine);
	}
});
