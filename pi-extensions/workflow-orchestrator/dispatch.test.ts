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
		["quick-run", "quick-run", "new", [], "quick-run", "__resolution__"],
		["join-quick-run", "quick-run", "new", [], "quick-run", "__resolution__"],
		["resume-grill", "grill", "resume", [artifact("grill")], "grill", "--resume grill-leaf-14"],
		[
			"spec-from-grill",
			"spec",
			"from-grill",
			[artifact("grill", {
				location: "handoff",
				format: "canonical",
				provenance: "canonical",
				identityProvenance: "canonical",
				state: "finalized",
			})],
			"sdd-spec",
			"--from-grill grill-leaf-14",
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
		assert.equal(
			result.request.skill.args,
			expectedArgs === "__resolution__" ? JSON.stringify(result.request.resolution) : expectedArgs,
			route,
		);
	}
});
