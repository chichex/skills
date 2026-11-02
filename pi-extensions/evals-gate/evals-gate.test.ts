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

// Grader de skill por caso: archivo, skill que su `input_match` reconoce y
// polaridad. Un positivo (`min: 1`) exige que el skill se dispare y matchea solo
// chiche-<x>. Un negativo (`max: 0`) exige que NO se dispare: tiene que atrapar
// tambien el alias sdd-<x>, porque el alias carga chiche-<x> y, si el modelo lo
// elige por error, el caso tiene que fallar igual.
type Polarity = "positive" | "negative";
const SKILL_GRADERS: Array<[string, string, Polarity]> = [
	["trigger-chiche-init/graders/fired-chiche-init.md", "chiche-init", "positive"],
	["trigger-chiche-run/graders/fired-chiche-run.md", "chiche-run", "positive"],
	["trigger-chiche-run/graders/not-chiche-spec.md", "chiche-spec", "negative"],
	["trigger-chiche-spec/graders/fired-chiche-spec.md", "chiche-spec", "positive"],
	["trigger-grill/graders/not-chiche-spec.md", "chiche-spec", "negative"],
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

test("#103 CA-12: un grader positivo matchea solo (?:[\\w-]+:)?chiche-<x>, con o sin namespace de plugin", async () => {
	for (const [path, skill, polarity] of SKILL_GRADERS) {
		if (polarity !== "positive") continue;
		const grader = await readFile(repoFile(`evals/${path}`), "utf8");
		assert.match(grader, /^min: 1$/m, `${path}: un grader positivo exige min: 1`);
		const literal = grader.match(/^input_match: '(.*)'$/m)?.[1];
		assert.equal(literal, `"skill"\\s*:\\s*"(?:[\\w-]+:)?${skill}"`, path);
		const pattern = new RegExp(literal ?? "");
		assert.match(`{"skill": "${skill}"}`, pattern, `${path}: sin namespace`);
		assert.match(`{"skill":"chiche:${skill}"}`, pattern, `${path}: con namespace chiche:`);
		assert.doesNotMatch(`{"skill": "${skill.replace("chiche-", "sdd-")}"}`, pattern, `${path}: no matchea el alias`);
	}
});

test("#103 CA-12: un grader negativo matchea (?:[\\w-]+:)?(?:chiche|sdd)-<x>: atrapa el skill y su alias", async () => {
	for (const [path, skill, polarity] of SKILL_GRADERS) {
		if (polarity !== "negative") continue;
		const grader = await readFile(repoFile(`evals/${path}`), "utf8");
		assert.match(grader, /^max: 0$/m, `${path}: un grader negativo exige max: 0`);
		const suffix = skill.replace("chiche-", "");
		const literal = grader.match(/^input_match: '(.*)'$/m)?.[1];
		assert.equal(literal, `"skill"\\s*:\\s*"(?:[\\w-]+:)?(?:chiche|sdd)-${suffix}"`, path);
		const pattern = new RegExp(literal ?? "");
		for (const name of [skill, `sdd-${suffix}`]) {
			assert.match(`{"skill": "${name}"}`, pattern, `${path}: sin namespace, ${name}`);
			assert.match(`{"skill":"chiche:${name}"}`, pattern, `${path}: con namespace chiche:, ${name}`);
		}
		assert.doesNotMatch(`{"skill": "grill"}`, pattern, `${path}: no matchea otro skill`);
		assert.doesNotMatch(`{"skill": "sdd-${suffix}-extra"}`, pattern, `${path}: no matchea un prefijo`);
	}
});

test("#103 CA-12: todo grader que nombra un skill chiche-* esta en la tabla del gate", async () => {
	const listed = new Set(SKILL_GRADERS.map(([path]) => `evals/${path}`));
	const unlisted: string[] = [];
	for (const file of await filesUnder("evals")) {
		if (!file.includes("/graders/")) continue;
		if (!/^input_match: .*chiche-/m.test(await readFile(file, "utf8"))) continue;
		const relative = file.slice(file.indexOf("evals/"));
		if (!listed.has(relative)) unlisted.push(relative);
	}
	assert.deepEqual(unlisted, []);
});

test("#103 CA-12: ningun archivo de evals/ nombra los skills viejos sdd-*", async () => {
	const offenders: string[] = [];
	for (const file of await filesUnder("evals")) {
		if (/sdd-(?:init|spec|run|land)/.test(await readFile(file, "utf8"))) offenders.push(file);
	}
	assert.deepEqual(offenders, []);
});
