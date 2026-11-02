import assert from "node:assert/strict";
import test from "node:test";

import {
	applyInlineSkillCompletion,
	extractInlineSkillToken,
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

// Issue #103, CA-22: los alias `sdd-*` se retiraron en 4.0.0. Las sugerencias
// son los nombres tal cual, sin marca "(alias)" y en el orden recibido.
test("suggestions keep names, order and descriptions untouched, even for an old alias-like description", () => {
	const commands = [
		{ name: "skill:chiche-run", description: "Ejecuta una spec" },
		{ name: "skill:legacy", description: "alias deprecado de chiche-run. Copia vieja." },
		{ name: "skill:grill", description: "Entrevista rigurosa" },
		{ name: "skill:tdd" },
	];
	assert.deepEqual(skillSuggestions(commands), [
		{ value: "skill:chiche-run", label: "skill:chiche-run", description: "Ejecuta una spec" },
		{ value: "skill:legacy", label: "skill:legacy", description: "alias deprecado de chiche-run. Copia vieja." },
		{ value: "skill:grill", label: "skill:grill", description: "Entrevista rigurosa" },
		{ value: "skill:tdd", label: "skill:tdd", description: undefined },
	]);
});

test("completes and promotes chiche-* skill names", () => {
	for (const name of ["chiche-init", "chiche-spec", "chiche-run", "chiche-land"]) {
		assert.deepEqual(
			applyInlineSkillCompletion(["do this /skill:x"], 0, 16, `skill:${name}`, "/skill:x"),
			{ lines: [`do this /skill:${name} `], cursorLine: 0, cursorCol: `do this /skill:${name} `.length },
			name,
		);
		assert.equal(promoteInlineSkillInvocation(`do this /skill:${name}`, new Set([name])), `/skill:${name} do this`, name);
	}
});
