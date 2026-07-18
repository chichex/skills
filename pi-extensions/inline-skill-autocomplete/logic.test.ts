import assert from "node:assert/strict";
import test from "node:test";

import {
	applyInlineSkillCompletion,
	extractInlineSkillToken,
	promoteInlineSkillInvocation,
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
			"skill:sdd-run",
			"/skill:sd",
		),
		{
			lines: ["implement /skill:sdd-run later"],
			cursorLine: 0,
			cursorCol: 25,
		},
	);
});

test("promotes a known inline skill so Pi can expand it", () => {
	const known = new Set(["sdd-run", "grill"]);
	assert.equal(
		promoteInlineSkillInvocation("implement this /skill:sdd-run", known),
		"/skill:sdd-run implement this",
	);
	assert.equal(
		promoteInlineSkillInvocation("please /skill:grill this design", known),
		"/skill:grill please this design",
	);
});

test("leaves leading and unknown skill commands alone", () => {
	const known = new Set(["sdd-run"]);
	assert.equal(promoteInlineSkillInvocation("/skill:sdd-run implement this", known), undefined);
	assert.equal(promoteInlineSkillInvocation("implement /skill:not-installed", known), undefined);
});
