import assert from "node:assert/strict";
import { test } from "node:test";

import {
	compareSpecListEntries,
	specInspectionDiagnostics,
	specMenuPresentation,
	type SpecListEntry,
} from "./spec-list.ts";

function entry(overrides: Partial<SpecListEntry> = {}): SpecListEntry {
	return {
		title: "Healthy approved",
		state: "approved",
		format: "canonical",
		diagnostics: [],
		updatedAt: "2026-09-01T10:00:00.000Z",
		...overrides,
	};
}

test("puts every diagnosed or invalid/conflict spec first and disables execution with visible diagnostics", () => {
	const entries = [
		entry(),
		entry({ title: "Healthy draft", state: "draft", updatedAt: "2026-09-02T10:00:00.000Z" }),
		entry({
			title: "Legacy diagnosed",
			state: "approved",
			format: "legacy",
			diagnostics: [{ code: "legacy-metadata", message: "Lifecycle comes from legacy metadata" }],
			updatedAt: "2026-09-01T12:00:00.000Z",
		}),
		entry({
			title: "Duplicate marker",
			state: "approved",
			format: "canonical",
			diagnostics: [{ code: "duplicate-canonical", message: "Canonical marker is duplicated" }],
			updatedAt: "2026-09-03T10:00:00.000Z",
		}),
		entry({
			title: "Conflict",
			state: "unknown",
			format: "conflict",
			diagnostics: [{ code: "conflicting-canonical", message: "Canonical markers differ" }],
			updatedAt: "2026-09-03T10:00:00.000Z",
		}),
	].sort(compareSpecListEntries);

	assert.deepEqual(entries.map(({ title }) => title), [
		"Conflict",
		"Duplicate marker",
		"Legacy diagnosed",
		"Healthy approved",
		"Healthy draft",
	]);

	const invalidPresentation = specMenuPresentation(entries[0]!);
	assert.equal(invalidPresentation.canExecute, false);
	assert.match(invalidPresentation.label, /^⚠ /);
	assert.match(invalidPresentation.description, /conflicting-canonical/);
	assert.match(invalidPresentation.description, /Canonical markers differ/);
	assert.equal(
		specInspectionDiagnostics(entries[0]!),
		"- `conflicting-canonical` — Canonical markers differ",
	);

	const healthyPresentation = specMenuPresentation(entries[3]!);
	assert.equal(healthyPresentation.canExecute, true);
	assert.doesNotMatch(healthyPresentation.label, /^⚠ /);
	assert.equal(specInspectionDiagnostics(entries[3]!), "none");
});
