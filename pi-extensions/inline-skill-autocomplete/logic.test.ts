import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	applyInlineSkillCompletion,
	deprecatedAliasTarget,
	extractInlineSkillToken,
	orderSkillCommands,
	promoteInlineSkillInvocation,
	skillSuggestions,
} from "./logic.ts";

test("does not intercept Pi's normal command completion at message start", () => {
	assert.equal(extractInlineSkillToken(["/skill:sdd"], 0, 10), undefined);
});

test("extracts shorthand and full skill tokens after existing text", () => {
	assert.deepEqual(extractInlineSkillToken(["implement this /sdd"], 0, 19), {
		prefix: "/sdd",
		query: "sdd",
		tokenStart: 15,
		tokenEnd: 19,
	});
	assert.deepEqual(extractInlineSkillToken(["implement this /skill:sdd"], 0, 25), {
		prefix: "/skill:sdd",
		query: "sdd",
		tokenStart: 15,
		tokenEnd: 25,
	});
});

test("treats a slash token on a later line as inline", () => {
	assert.deepEqual(extractInlineSkillToken(["implement this", "/skill:sdd"], 1, 10), {
		prefix: "/skill:sdd",
		query: "sdd",
		tokenStart: 0,
		tokenEnd: 10,
	});
});

test("does not claim other colon-prefixed slash syntaxes", () => {
	assert.equal(extractInlineSkillToken(["look at /issue:123"], 0, 18), undefined);
});

test("replaces an inline partial token and positions the cursor after one space", () => {
	assert.deepEqual(
		applyInlineSkillCompletion(
			["implement /skill:sd-old later"],
			0,
			19,
			"skill:chiche-run",
			"/skill:sd",
		),
		{
			lines: ["implement /skill:chiche-run later"],
			cursorLine: 0,
			cursorCol: 28,
		},
	);
});

test("promotes a known inline skill so Pi can expand it", () => {
	const known = new Set(["chiche-run", "grill"]);
	assert.equal(
		promoteInlineSkillInvocation("implement this /skill:chiche-run", known),
		"/skill:chiche-run implement this",
	);
	assert.equal(
		promoteInlineSkillInvocation("please /skill:grill this design", known),
		"/skill:grill please this design",
	);
});

test("leaves leading and unknown skill commands alone", () => {
	const known = new Set(["chiche-run"]);
	assert.equal(promoteInlineSkillInvocation("/skill:chiche-run implement this", known), undefined);
	assert.equal(promoteInlineSkillInvocation("implement /skill:not-installed", known), undefined);
});

// Issue #103, S11: `skill:chiche-init|spec|run|land` y, marcados como alias,
// `skill:sdd-*`. La marca sale de la descripción del skill, no de una lista.
const STAGES = ["init", "spec", "run", "land"] as const;

async function skillDescription(skill: string): Promise<string> {
	const source = await readFile(new URL(`../../pi/${skill}/SKILL.md`, import.meta.url), "utf8");
	const description = /^description: (.+)$/m.exec(source)?.[1];
	assert.ok(description, `${skill} declara description`);
	return description;
}

test("the real sdd-* alias skills are recognised as aliases of their chiche-* target and chiche-* are not", async () => {
	for (const stage of STAGES) {
		assert.equal(deprecatedAliasTarget(await skillDescription(`sdd-${stage}`)), `chiche-${stage}`, `sdd-${stage}`);
		assert.equal(deprecatedAliasTarget(await skillDescription(`chiche-${stage}`)), undefined, `chiche-${stage}`);
	}
	assert.equal(deprecatedAliasTarget(undefined), undefined);
	assert.equal(deprecatedAliasTarget(""), undefined);
	assert.equal(deprecatedAliasTarget("Revisa un PR; no es un alias deprecado de nada"), undefined);
});

test("suggestions mark sdd-* aliases visibly and leave chiche-* and other skills untouched", async () => {
	const commands = await Promise.all(
		["chiche-run", "sdd-run", "grill"].map(async (skill) => ({
			name: `skill:${skill}`,
			description: skill === "grill" ? "Entrevista rigurosa" : await skillDescription(skill),
		})),
	);
	const [current, alias, grill] = skillSuggestions(commands);
	assert.deepEqual(current, { value: "skill:chiche-run", label: "skill:chiche-run", description: commands[0]!.description });
	assert.deepEqual(grill, { value: "skill:grill", label: "skill:grill", description: "Entrevista rigurosa" });
	assert.equal(alias?.value, "skill:sdd-run", "el valor que se completa no cambia");
	assert.equal(alias?.label, "skill:sdd-run (alias)", "la marca se ve aunque la descripción no entre en la terminal");
	assert.match(alias?.description ?? "", /^alias deprecado de chiche-run\./);
	assert.deepEqual(skillSuggestions([{ name: "skill:tdd" }]), [{ value: "skill:tdd", label: "skill:tdd", description: undefined }]);
});

test("aliases sort after the skills they replace, keeping the relative order of the rest", () => {
	const alias = (stage: string) => ({ name: `skill:sdd-${stage}`, description: `alias deprecado de chiche-${stage}. Solo para quien todavía escribe sdd-${stage}.` });
	const plain = (name: string) => ({ name: `skill:${name}`, description: "doctrina propia" });
	const ranked = [alias("run"), plain("chiche-run"), plain("grill"), alias("spec"), plain("chiche-spec")];
	assert.deepEqual(
		orderSkillCommands(ranked).map((command) => command.name),
		["skill:chiche-run", "skill:grill", "skill:chiche-spec", "skill:sdd-run", "skill:sdd-spec"],
	);
	assert.deepEqual(ranked.map((command) => command.name).slice(0, 2), ["skill:sdd-run", "skill:chiche-run"], "no muta la entrada");
});

test("completes and promotes chiche-* and sdd-* skill names the same way", () => {
	for (const name of ["chiche-init", "chiche-spec", "chiche-run", "chiche-land", "sdd-init", "sdd-spec", "sdd-run", "sdd-land"]) {
		assert.deepEqual(
			applyInlineSkillCompletion(["do this /skill:x"], 0, 16, `skill:${name}`, "/skill:x"),
			{ lines: [`do this /skill:${name} `], cursorLine: 0, cursorCol: `do this /skill:${name} `.length },
			name,
		);
		assert.equal(promoteInlineSkillInvocation(`do this /skill:${name}`, new Set([name])), `/skill:${name} do this`, name);
	}
});
