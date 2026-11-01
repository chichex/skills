// Gate de los casos de `claude plugin eval` (evals/). Solo tests, sin
// extension: no corre ningun eval (son pagos), asserta su forma. Issue #103,
// CA-12: los casos y graders siguen a los skills renombrados a chiche-*.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

const EXPECTED_CASES = [
	"adherence-chiche-spec",
	"silent-ambiguous",
	"trigger-chiche-init",
	"trigger-chiche-run",
	"trigger-chiche-spec",
	"trigger-grill",
];

// Grader de skill por caso: archivo y skill que su `input_match` reconoce.
const SKILL_GRADERS: Array<[string, string]> = [
	["trigger-chiche-init/graders/fired-chiche-init.md", "chiche-init"],
	["trigger-chiche-run/graders/fired-chiche-run.md", "chiche-run"],
	["trigger-chiche-run/graders/not-chiche-spec.md", "chiche-spec"],
	["trigger-chiche-spec/graders/fired-chiche-spec.md", "chiche-spec"],
	["trigger-grill/graders/not-chiche-spec.md", "chiche-spec"],
];

async function filesUnder(dir: string): Promise<string[]> {
	const entries = await readdir(repoFile(dir), { withFileTypes: true, recursive: true });
	return entries.filter((entry) => entry.isFile()).map((entry) => `${entry.parentPath}/${entry.name}`);
}

test("#103 CA-12: evals/ trae exactamente los casos renombrados a chiche-*", async () => {
	const cases = (await readdir(repoFile("evals"), { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	assert.deepEqual(cases, EXPECTED_CASES);
});

test("#103 CA-12: cada grader de skill matchea (?:[\\w-]+:)?chiche-<x> con o sin namespace de plugin", async () => {
	for (const [path, skill] of SKILL_GRADERS) {
		const grader = await readFile(repoFile(`evals/${path}`), "utf8");
		const literal = grader.match(/^input_match: '(.*)'$/m)?.[1];
		assert.equal(literal, `"skill"\\s*:\\s*"(?:[\\w-]+:)?${skill}"`, path);
		const pattern = new RegExp(literal ?? "");
		assert.match(`{"skill": "${skill}"}`, pattern, `${path}: sin namespace`);
		assert.match(`{"skill":"chiche:${skill}"}`, pattern, `${path}: con namespace chiche:`);
		assert.doesNotMatch(`{"skill": "${skill.replace("chiche-", "sdd-")}"}`, pattern, `${path}: no matchea el alias`);
	}
});

test("#103 CA-12: ningun archivo de evals/ nombra los skills viejos sdd-*", async () => {
	const offenders: string[] = [];
	for (const file of await filesUnder("evals")) {
		if (/sdd-(?:init|spec|run|land)/.test(await readFile(file, "utf8"))) offenders.push(file);
	}
	assert.deepEqual(offenders, []);
});
