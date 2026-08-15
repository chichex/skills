import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const FORBIDDEN_SKILL_SLASH = /\/skill:(?:issue-triage|grill|sdd-spec|sdd-run|quick-run)\b/;
const FORBIDDEN_DYNAMIC_SLASH = /`\/\$\{(?:skillCommand|grillCommand|command)\}/;

test("included Pi consumers contain zero SDD dispatch through literal or dynamic skill slash messages", async () => {
	for (const path of productionSources) {
		const source = await readFile(new URL(path, import.meta.url), "utf8");
		assert.doesNotMatch(source, FORBIDDEN_SKILL_SLASH, path);
		assert.doesNotMatch(source, FORBIDDEN_DYNAMIC_SLASH, path);
	}
});
