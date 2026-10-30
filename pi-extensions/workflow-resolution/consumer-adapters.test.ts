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

test("../github-issues.ts recognizes issue spec bodies by either tracking marker name (#103 CA-2)", async () => {
	const source = await readFile(new URL("../github-issues.ts", import.meta.url), "utf8");
	const filter = source.match(/if \(!\/\^#\\s\+Spec\\b\/im\.test\(body\) && !(\/[^\n]*?\/i)\.test\(body\)\) continue;/);
	assert.ok(filter?.[1], "the issue-body spec filter is present");
	const pattern = new RegExp(filter[1].slice(1, -2), "i");
	assert.match("<!-- Chiche-Tracking: version=2; type=spec; state=approved; issue=#9; grill=none; superseded-by=none -->", pattern);
	assert.match("<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#9; grill=none; superseded-by=none -->", pattern);
	assert.doesNotMatch("Plain issue body without a marker.", pattern);
});
