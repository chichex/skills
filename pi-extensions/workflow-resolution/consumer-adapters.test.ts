import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const consumers = [
	"../github-issues.ts",
	"../grill-tools/index.ts",
] as const;

for (const path of consumers) {
	test(`${path} consumes the normalized SDD artifact adapter`, async () => {
		const source = await readFile(new URL(path, import.meta.url), "utf8");
		assert.match(source, /workflow-resolution\/index\.ts/);
		assert.doesNotMatch(source, /function\s+specState\s*\(/);
		assert.doesNotMatch(source, /function\s+issueNumberFromSpec\s*\(/);
		assert.doesNotMatch(source, /function\s+specMetadata\s*\(/);
		assert.doesNotMatch(source, /Estado:\\s\*\([^\n]*match/);
	});
}
