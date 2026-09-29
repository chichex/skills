import assert from "node:assert/strict";
import { test } from "node:test";

import * as orchestrator from "./index.ts";

function issue(number: number) {
	return { repository: "chichex/skills", number };
}

function resolution(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		outcome: "start",
		code: "spec",
		recommendedClassification: "quick-run",
		fallbackClassification: "spec",
		recommendedRoute: "quick-run",
		selectedRoute: "spec",
		stage: "spec",
		mode: "new",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		sources: [issue(14)],
		canonicalIssue: issue(14),
		summary: "Integrate SDD transitions.",
		impactExample: "A confirmed fallback starts the selected spec stage.",
		scope: ["Pi orchestration"],
		checklist: ["fresh child"],
		evidence: [],
		risks: [],
		artifacts: [],
		...overrides,
	};
}

test("dispatch follows selectedRoute rather than the original recommendation", () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).resolveWorkflowDispatch, "function");
	const result = orchestrator.resolveWorkflowDispatch(resolution());
	assert.deepEqual(result, {
		ok: true,
		request: {
			resolution: resolution(),
			skill: { name: "sdd-spec", args: "#14" },
		},
	});
});

function artifact(type: "grill" | "spec", overrides: Record<string, unknown> = {}) {
	return {
		id: `${type}-primary`,
		location: type === "grill" ? "snapshot" : "local",
		path: type === "grill" ? "/snapshots/grill-14.json" : "/workspace/skills/.sdd/specs/issue-14.md",
		type,
		state: type === "grill" ? "active" : "approved",
		format: type === "grill" ? "snapshot" : "canonical",
		provenance: type === "grill" ? "snapshot" : "canonical",
		identityProvenance: type === "grill" ? "snapshot" : "canonical",
		issue: issue(14),
		grill: type === "grill" ? "grill-leaf-14" : null,
		project: type === "grill" ? "/workspace/skills" : null,
		supersededBy: null,
		parentId: null,
		revision: type === "grill" ? 2 : null,
		freshness: "fresh",
		primary: true,
		diagnostics: [],
		...overrides,
	};
}

test("dispatch maps every actionable route to one canonical downstream skill and target", () => {
	const cases = [
		["grill", "grill", "new", [], "grill", "#14"],
		["join-grill", "grill", "new", [], "grill", "#14"],
		["spec", "spec", "new", [], "sdd-spec", "#14"],
		["join-spec", "spec", "new", [], "sdd-spec", "#14"],
		["quick-run", "quick-run", "new", [], "quick-run", ""],
		["join-quick-run", "quick-run", "new", [], "quick-run", ""],
		["resume-grill", "grill", "resume", [artifact("grill")], "grill", "--resume \"grill-leaf-14\""],
		[
			"spec-from-grill",
			"spec",
			"from-grill",
			[
				artifact("grill", {
					location: "handoff",
					path: "/workspace/skills/.sdd/grills/final.md",
					format: "canonical",
					provenance: "canonical",
					identityProvenance: "canonical",
					state: "finalized",
				}),
				artifact("grill", {
					id: "runtime-copy",
					state: "finalized",
					primary: false,
				}),
			],
			"sdd-spec",
			"--from-grill \"grill-leaf-14\"",
		],
		[
			"update-existing-spec",
			"spec",
			"update",
			[artifact("spec", { state: "draft" })],
			"sdd-spec",
			"/workspace/skills/.sdd/specs/issue-14.md",
		],
		[
			"audit-existing-spec",
			"spec",
			"update",
			[artifact("spec", { freshness: "unknown" })],
			"sdd-spec",
			"/workspace/skills/.sdd/specs/issue-14.md",
		],
		[
			"run-existing-spec",
			"run-existing-spec",
			null,
			[artifact("spec")],
			"sdd-run",
			"/workspace/skills/.sdd/specs/issue-14.md",
		],
	] as const;

	for (const [route, stage, mode, artifacts, skill, expectedArgs] of cases) {
		const handoff = resolution({
			code: route,
			recommendedRoute: route,
			selectedRoute: route,
			stage,
			mode,
			artifacts,
		});
		const result = orchestrator.resolveWorkflowDispatch(handoff);
		assert.equal(result.ok, true, route);
		if (!result.ok) continue;
		assert.equal(result.request.skill.name, skill, route);
		assert.equal(result.request.skill.args, expectedArgs, route);
	}
});

test("CA-7/9: dispatch quotes unsafe logical grill ids without changing their identity", () => {
	const grill = "portable/unsafe id";
	const resumeInput = resolution({
		code: "resume-grill",
		recommendedRoute: "resume-grill",
		selectedRoute: "resume-grill",
		stage: "grill",
		mode: "resume",
		artifacts: [artifact("grill", { grill })],
	});
	const resumed = orchestrator.resolveWorkflowDispatch(resumeInput);
	assert.equal(resumed.ok, true);
	if (resumed.ok) assert.equal(resumed.request.skill.args, `--resume ${JSON.stringify(grill)}`);

	const handoff = artifact("grill", {
		location: "handoff",
		path: "/workspace/skills/.sdd/grills/final.md",
		format: "canonical",
		provenance: "canonical",
		identityProvenance: "canonical",
		state: "finalized",
		grill,
	});
	const snapshot = artifact("grill", {
		id: "runtime-copy",
		state: "finalized",
		primary: false,
		grill,
	});
	const specInput = resolution({
		code: "spec-from-grill",
		recommendedRoute: "spec-from-grill",
		selectedRoute: "spec-from-grill",
		stage: "spec",
		mode: "from-grill",
		artifacts: [handoff, snapshot],
	});
	const specified = orchestrator.resolveWorkflowDispatch(specInput);
	assert.equal(specified.ok, true);
	if (specified.ok) assert.equal(specified.request.skill.args, `--from-grill ${JSON.stringify(grill)}`);
});

test("CA-9: spec-from-grill dispatches a handoff-only by its validated absolute path", () => {
	const path = "/workspace/skills/.sdd/grills/final handoff.md";
	const portable = artifact("grill", {
		location: "handoff",
		path,
		state: "finalized",
		format: "canonical",
		provenance: "canonical",
		identityProvenance: "canonical",
		project: "/Users/old/skills",
	});
	const input = resolution({
		code: "spec-from-grill",
		recommendedRoute: "spec-from-grill",
		selectedRoute: "spec-from-grill",
		stage: "spec",
		mode: "from-grill",
		artifacts: [portable],
	});
	const result = orchestrator.resolveWorkflowDispatch(input);
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.request.skill.args, `--from-grill ${JSON.stringify(path)}`);
});

test("CA-9: spec-from-grill rejects unsafe, non-finalized, and diagnosed handoff paths", () => {
	for (const overrides of [
		{ path: "/workspace/skills/elsewhere/final.md" },
		{ path: "/workspace/skills/.sdd/grills/nested/final.md" },
		{ path: "relative/.sdd/grills/final.md" },
		{ state: "paused" },
		{ diagnostics: [{ code: "unsafe", message: "bad metadata" }] },
	]) {
		const input = resolution({
			code: "spec-from-grill",
			recommendedRoute: "spec-from-grill",
			selectedRoute: "spec-from-grill",
			stage: "spec",
			mode: "from-grill",
			artifacts: [artifact("grill", {
				location: "handoff",
				path: "/workspace/skills/.sdd/grills/final.md",
				state: "finalized",
				format: "canonical",
				provenance: "canonical",
				identityProvenance: "canonical",
				...overrides,
			})],
		});
		const result = orchestrator.resolveWorkflowDispatch(input);
		assert.equal(result.ok, false, JSON.stringify(overrides));
		if (!result.ok) assert.equal(result.code, "invalid-grill-reference");
	}
});
