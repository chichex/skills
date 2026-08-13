import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createSubmitWorkflowResolutionTool,
	validateWorkflowResolution,
	WorkflowResolutionValidationError,
} from "./protocol.ts";

function issue(number: number) {
	return { repository: "chichex/skills", number };
}

function startResolution() {
	return {
		version: 1,
		outcome: "start",
		code: "quick-run",
		recommendedClassification: "quick-run",
		fallbackClassification: "spec",
		recommendedRoute: "quick-run",
		selectedRoute: "quick-run",
		stage: "quick-run",
		mode: "new",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		sources: [issue(13)],
		canonicalIssue: issue(13),
		summary: "Implementar primitivas reutilizables.",
		impactExample: "El stage empieza en una sesión limpia.",
		scope: ["materialización", "sesiones"],
		checklist: ["parentSession", "cwd"],
		evidence: [{ kind: "issue", reference: "#13", detail: "selección confirmada" }],
		risks: ["contexto stale"],
		artifacts: [{
			id: "spec-13",
			location: "issue",
			path: "https://github.com/chichex/skills/issues/13",
			type: "spec",
			state: "approved",
			format: "canonical",
			provenance: "canonical",
			identityProvenance: "canonical",
			issue: issue(13),
			grill: null,
			project: null,
			supersededBy: null,
			parentId: null,
			revision: null,
			freshness: "fresh",
			primary: true,
			diagnostics: [{ code: "fresh", message: "issue body is current" }],
		}],
	};
}

test("validates and canonically clones a complete start resolution without merging recommendation and choice", () => {
	const input = startResolution();
	const result = validateWorkflowResolution(input);

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.value, input);
	assert.notEqual(result.value, input);
	assert.notEqual(result.value.sources, input.sources);
	assert.equal(result.value.recommendedRoute, "quick-run");
	assert.equal(result.value.selectedRoute, "quick-run");
	assert.deepEqual(JSON.parse(JSON.stringify(result.value)), result.value);
});

test("accepts the full v1 discriminated outcomes start, stop, and error", () => {
	const start = startResolution();
	const stop = {
		...start,
		outcome: "stop",
		code: "cancelled",
		selectedRoute: null,
		stage: null,
		mode: null,
	};
	const error = {
		...start,
		outcome: "error",
		code: "canonicalization",
		recommendedRoute: null,
		selectedRoute: null,
		stage: null,
		mode: null,
		artifacts: [],
	};

	for (const value of [start, stop, error]) {
		const result = validateWorkflowResolution(value);
		assert.equal(result.ok, true, `${value.outcome}: ${result.ok ? "" : result.diagnostics.join(", ")}`);
	}
});

test("rejects missing, extra, invalid enum, and malformed nested protocol fields", () => {
	const base = startResolution();
	const { version: _version, ...missingVersion } = base;
	const cases: Array<{ name: string; value: unknown; path: string }> = [
		{ name: "missing", value: missingVersion, path: "$.version" },
		{ name: "root extra", value: { ...base, transcript: "do not scrape" }, path: "$.transcript" },
		{ name: "enum", value: { ...base, outcome: "continue" }, path: "$.outcome" },
		{
			name: "nested extra",
			value: { ...base, canonicalIssue: { ...base.canonicalIssue, title: "extra" } },
			path: "$.canonicalIssue.title",
		},
		{
			name: "nested type",
			value: { ...base, artifacts: [{ ...base.artifacts[0], primary: "yes" }] },
			path: "$.artifacts[0].primary",
		},
	];

	for (const fixture of cases) {
		const result = validateWorkflowResolution(fixture.value);
		assert.equal(result.ok, false, fixture.name);
		if (result.ok) continue;
		assert.ok(result.diagnostics.some((diagnostic) => diagnostic.path === fixture.path), fixture.name);
	}
});

test("registerable terminal tool exposes a strict complete schema and returns the validated value", async () => {
	const tool = createSubmitWorkflowResolutionTool();
	const schema = tool.parameters as {
		additionalProperties?: boolean;
		required?: string[];
		properties?: Record<string, unknown>;
	};
	const expectedFields = [
		"version", "outcome", "code", "recommendedClassification", "fallbackClassification",
		"recommendedRoute", "selectedRoute", "stage", "mode", "repo", "cwd", "sources",
		"canonicalIssue", "summary", "impactExample", "scope", "checklist", "evidence", "risks", "artifacts",
	];

	assert.equal(tool.name, "submit_workflow_resolution");
	assert.equal(schema.additionalProperties, false);
	assert.deepEqual(schema.required, expectedFields);
	assert.deepEqual(Object.keys(schema.properties ?? {}), expectedFields);

	const input = startResolution();
	const result = await tool.execute("tool-1", input);
	assert.deepEqual(result.details, input);
	assert.equal(result.terminate, true);
	assert.equal(result.content.length, 1);
	assert.equal(result.content[0]?.type, "text");
	assert.ok((result.content[0]?.text.length ?? Infinity) <= 160);
});

test("terminal tool throws a typed error for invalid input and performs no callback mutation", async () => {
	const tool = createSubmitWorkflowResolutionTool();
	const invalid = { ...startResolution(), selectedRoute: undefined };

	await assert.rejects(
		() => tool.execute("tool-2", invalid),
		(error: unknown) => {
			assert.ok(error instanceof WorkflowResolutionValidationError);
			assert.equal(error.code, "invalid-workflow-resolution");
			assert.ok(error.diagnostics.some((diagnostic) => diagnostic.path === "$.selectedRoute"));
			return true;
		},
	);
});
