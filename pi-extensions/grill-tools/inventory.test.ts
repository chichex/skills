import assert from "node:assert/strict";
import { test } from "node:test";

import {
	filterGrillInventory,
	inventoryActions,
	normalizeGrillSnapshot,
	reconcileGrillInventory,
	type GrillSnapshot,
	type HandoffFileCandidate,
	type SnapshotFileCandidate,
} from "./inventory.ts";

const ROOT = "/workspace/current repo";
const OTHER_ROOT = "/workspace/other";
const REPOSITORY = "chichex/skills";

function encodeReference(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
		`%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

function handoffMarkdown({
	id,
	state = "paused",
	project = ROOT,
	issue = "none",
	body = `Context for ${id}.`,
}: {
	id: string;
	state?: "paused" | "finalized";
	project?: string;
	issue?: string;
	body?: string;
}): string {
	return [
		`# Grill — ${id}`,
		`<!-- SDD-Tracking: version=1; type=grill; state=${state}; issue=${issue}; grill=${encodeReference(id)}; project=${encodeReference(project)} -->`,
		"",
		"## Modo",
		"standard",
		"",
		"## Handoff",
		body,
		"",
	].join("\n");
}

function snapshot(overrides: Partial<GrillSnapshot> = {}): GrillSnapshot {
	const timestamp = "2026-09-29T10:00:00.000Z";
	return {
		version: 4,
		id: "snapshot-only",
		topic: "Snapshot only",
		projectPath: ROOT,
		projectName: "current repo",
		status: "active",
		interviewMode: "adaptive",
		createdAt: timestamp,
		updatedAt: timestamp,
		estimate: { min: 1, likely: 2, max: 3 },
		questionLimit: 20,
		sections: [],
		interactions: [],
		decisions: [],
		pendingBranches: [],
		revision: 1,
		...overrides,
	};
}

function snapshotFile(value: unknown, fileName = "snapshot.json"): SnapshotFileCandidate {
	return {
		path: `/tmp/grill-sessions/${fileName}`,
		repository: REPOSITORY,
		value,
	};
}

function handoffFile(
	markdown: string,
	path = `${ROOT}/.sdd/grills/handoff.md`,
	projectPath = ROOT,
): HandoffFileCandidate {
	return { path, projectPath, repository: REPOSITORY, markdown };
}

test("CA-1/2: snapshot-only, handoff-only and compatible dual-source candidates share one deterministic inventory", () => {
	const bothMarkdown = handoffMarkdown({ id: "both", state: "paused" });
	const result = reconcileGrillInventory({
		snapshots: [
			snapshotFile(snapshot()),
			snapshotFile(snapshot({
				id: "both",
				topic: "Both",
				status: "active",
				handoffMarkdown: bothMarkdown,
			}), "both.json"),
		],
		handoffs: [
			handoffFile(handoffMarkdown({ id: "handoff-only", state: "finalized" }), `${ROOT}/.sdd/grills/only.md`),
			handoffFile(bothMarkdown, `${ROOT}/.sdd/grills/both.md`),
		],
	});

	assert.equal(result.entries.length, 3);
	const snapshotOnly = result.entries.find((entry) => entry.grillId === "snapshot-only");
	const handoffOnly = result.entries.find((entry) => entry.grillId === "handoff-only");
	const both = result.entries.find((entry) => entry.grillId === "both");
	assert.ok(snapshotOnly?.valid);
	assert.equal(snapshotOnly?.authority, "snapshot");
	assert.deepEqual(inventoryActions(snapshotOnly!), ["inspect", "resume"]);
	assert.ok(handoffOnly?.valid);
	assert.equal(handoffOnly?.authority, "handoff");
	assert.deepEqual(inventoryActions(handoffOnly!), ["inspect", "create-spec", "duplicate"]);
	assert.ok(both?.valid);
	assert.equal(both?.authority, "snapshot", "an active runtime snapshot outranks its prior paused handoff");
	assert.equal(both?.snapshotPath, "/tmp/grill-sessions/both.json");
	assert.deepEqual(both?.handoffPaths, [`${ROOT}/.sdd/grills/both.md`]);
});

test("CA-6/10: legacy paused and finalized snapshots remain actionable without a repo handoff", () => {
	const finalizedMarkdown = handoffMarkdown({ id: "legacy-finalized", state: "finalized" });
	const result = reconcileGrillInventory({
		snapshots: [
			snapshotFile(snapshot({
				id: "legacy-paused",
				topic: "Legacy paused",
				status: "paused",
			}), "legacy-paused.json"),
			snapshotFile(snapshot({
				id: "legacy-finalized",
				topic: "Legacy finalized",
				status: "finalized",
				handoffMarkdown: finalizedMarkdown,
			}), "legacy-finalized.json"),
			snapshotFile(snapshot({
				id: "legacy-finalized-without-source",
				topic: "Legacy finalized without source",
				status: "finalized",
			}), "legacy-finalized-without-source.json"),
		],
		handoffs: [],
	});

	const paused = result.entries.find((entry) => entry.grillId === "legacy-paused");
	assert.equal(paused?.valid, true);
	assert.equal(paused?.authority, "snapshot");
	assert.deepEqual(inventoryActions(paused!), ["inspect", "resume"]);
	assert.ok(paused?.warnings.some(({ code }) => code === "missing-persisted-handoff"));

	const finalized = result.entries.find((entry) => entry.grillId === "legacy-finalized");
	assert.equal(finalized?.valid, true);
	assert.equal(finalized?.authority, "snapshot");
	assert.deepEqual(inventoryActions(finalized!), ["inspect", "create-spec", "duplicate"]);
	assert.ok(finalized?.warnings.some(({ code }) => code === "missing-persisted-handoff"));

	const finalizedWithoutSource = result.entries.find(
		(entry) => entry.grillId === "legacy-finalized-without-source",
	);
	assert.equal(finalizedWithoutSource?.valid, true);
	assert.deepEqual(inventoryActions(finalizedWithoutSource!), ["inspect", "duplicate"]);
});

test("CA-2/3: persisted authority, equivalent duplicates, portable roots and conflicts never use timestamps as a tiebreaker", () => {
	const portable = handoffMarkdown({ id: "portable", state: "finalized", project: "/Users/old/repo" });
	const equivalent = handoffMarkdown({ id: "equivalent", state: "paused" });
	const divergentA = handoffMarkdown({ id: "divergent", state: "paused", body: "A" });
	const divergentB = handoffMarkdown({ id: "divergent", state: "paused", body: "B" });
	const result = reconcileGrillInventory({
		snapshots: [
			snapshotFile(snapshot({
				id: "portable",
				topic: "Portable",
				status: "finalized",
				handoffMarkdown: portable,
				updatedAt: "2099-01-01T00:00:00.000Z",
			}), "portable.json"),
		],
		handoffs: [
			handoffFile(portable, `${ROOT}/.sdd/grills/portable.md`),
			handoffFile(equivalent, `${ROOT}/.sdd/grills/equivalent-a.md`),
			handoffFile(equivalent, `${ROOT}/.sdd/grills/equivalent-b.md`),
			handoffFile(divergentA, `${ROOT}/.sdd/grills/divergent-a.md`),
			handoffFile(divergentB, `${ROOT}/.sdd/grills/divergent-b.md`),
			handoffFile(portable, `${OTHER_ROOT}/.sdd/grills/portable.md`, OTHER_ROOT),
		],
	});

	const portableEntries = result.entries.filter((entry) => entry.grillId === "portable");
	assert.equal(portableEntries.length, 2, "the same logical id in two physical roots is never merged");
	const currentPortable = portableEntries.find((entry) => entry.projectPath === ROOT);
	assert.ok(currentPortable?.valid);
	assert.equal(currentPortable?.authority, "handoff", "persisted finalized handoff outranks its snapshot");
	assert.equal(currentPortable?.historicalProjectPath, "/Users/old/repo");
	assert.ok(currentPortable?.warnings.some(({ code }) => code === "historical-project-mismatch"));
	assert.deepEqual(inventoryActions(currentPortable!), ["inspect", "create-spec", "duplicate"]);

	const equivalentEntry = result.entries.find((entry) => entry.grillId === "equivalent");
	assert.ok(equivalentEntry?.valid);
	assert.equal(equivalentEntry?.handoffPaths.length, 2);

	const divergent = result.entries.find((entry) => entry.grillId === "divergent");
	assert.equal(divergent?.valid, false);
	assert.ok(divergent?.diagnostics.some(({ code }) => code === "divergent-handoffs"));
	assert.deepEqual(inventoryActions(divergent!), ["inspect"]);
});

test("CA-4/5/6: invalid candidates remain visible, are isolated, and filters run after reconciliation", () => {
	const valid = handoffMarkdown({ id: "same-topic-a", state: "paused" });
	const second = handoffMarkdown({ id: "same-topic-b", state: "paused" }).replace(
		"# Grill — same-topic-b",
		"# Grill — Shared topic",
	);
	const first = valid.replace("# Grill — same-topic-a", "# Grill — Shared topic");
	const result = reconcileGrillInventory({
		snapshots: [
			{ path: "/tmp/grill-sessions/broken-json.json", repository: REPOSITORY, readError: "Unexpected EOF" },
			snapshotFile({ id: "broken-shape", projectPath: ROOT, status: "paused" }, "broken-shape.json"),
		],
		handoffs: [
			handoffFile(first, `${ROOT}/.sdd/grills/a.md`),
			handoffFile(second, `${ROOT}/.sdd/grills/b.md`),
			handoffFile("# Grill — Broken\n<!-- SDD-Tracking: version=1; type=grill; state=nope -->\n", `${ROOT}/.sdd/grills/broken.md`),
		],
	});

	assert.equal(result.entries.length, 5);
	const keys = result.entries.map((entry) => entry.key);
	assert.equal(new Set(keys).size, keys.length, "internal keys remain unique even when topics match");
	assert.equal(result.entries.filter((entry) => entry.valid).length, 2);
	assert.ok(result.entries.some((entry) => entry.diagnostics.some(({ code }) => code === "snapshot-read-error")));
	assert.ok(result.entries.some((entry) => entry.diagnostics.some(({ code }) => code === "invalid-snapshot")));
	assert.ok(result.entries.some((entry) => entry.diagnostics.some(({ code }) => code === "invalid-handoff")));

	const local = filterGrillInventory(result, {
		currentProject: ROOT,
		scope: "current-project",
		status: "resumable",
		query: "shared topic",
		limit: 1,
	});
	assert.equal(local.entries.length, 1, "limit applies after source reconciliation and query filtering");
	assert.equal(local.truncatedCount, 1, "callers can disclose identities hidden by the limit");
	assert.equal(local.unattributedErrorCount, 1, "local scope reports but does not misattribute global corrupt files");
	assert.equal(local.entries[0]?.topic, "Shared topic");

	const all = filterGrillInventory(result, {
		currentProject: ROOT,
		scope: "all",
		status: "all",
		limit: 100,
	});
	assert.equal(all.entries.length, 5);
	assert.equal(all.truncatedCount, 0);
	assert.ok(all.entries.some((entry) => entry.projectPath === null));
});

test("CA-5: plain Markdown is ignored while a malformed SDD marker remains diagnosable", () => {
	const result = reconcileGrillInventory({
		snapshots: [],
		handoffs: [
			handoffFile("# Notas\n\nUn borrador sin metadata SDD.\n", `${ROOT}/.sdd/grills/NOTAS.md`),
			handoffFile([
				"# Grill — Unknown marker type",
				"<!-- SDD-Tracking: version=1; type=unknown-kind; state=paused; issue=none; grill=broken; project=%2Fworkspace -->",
				"",
			].join("\n"), `${ROOT}/.sdd/grills/broken-marker.md`),
		],
	});

	assert.equal(result.entries.length, 1);
	assert.equal(result.entries[0]?.valid, false);
	assert.ok(result.entries[0]?.diagnostics.some(({ code }) => code === "invalid-handoff"));
	assert.equal(result.entries[0]?.handoffPaths[0], `${ROOT}/.sdd/grills/broken-marker.md`);
});

test("CA-10: v4 snapshots normalize explicitly without losing the inferred issue and without a workflow mode", () => {
	const legacy = snapshot({
		version: 4,
		id: "issue-42-domain",
		topic: "Issue #42 domain review",
		decisions: [{
			id: "domain-modeling",
			title: "Modelado de dominio",
			agreement: "enabled",
			updatedAt: "2026-09-29T10:00:00.000Z",
		}],
	});
	const normalized = normalizeGrillSnapshot(legacy);
	assert.ok(normalized.snapshot);
	assert.equal(normalized.snapshot.version, 5);
	assert.deepEqual(normalized.snapshot.sourceIssue, { number: 42 });
	assert.equal("workflowMode" in normalized.snapshot, false);
});

test("CA-8/10: imported source remains compatible after a persisted continuity section is appended", () => {
	const source = handoffMarkdown({ id: "imported-cycle", state: "finalized", body: "Original confirmed facts." });
	const persisted = `${source.trim()}\n\n## Continuidad runtime importada\n\nNew confirmed facts.\n`;
	const result = reconcileGrillInventory({
		snapshots: [snapshotFile(snapshot({
			version: 5,
			id: "imported-cycle",
			topic: "Imported cycle",
			status: "finalized",
			handoffMarkdown: "New confirmed facts.",
			importedHandoff: {
				kind: "handoff-only",
				sourcePath: `${ROOT}/.sdd/grills/imported-cycle.md`,
				markdown: source,
				importedAt: "2026-09-29T11:00:00.000Z",
				hadRuntimeSnapshot: false,
			},
		}), "imported-cycle.json")],
		handoffs: [handoffFile(persisted, `${ROOT}/.sdd/grills/imported-cycle.md`)],
	});
	assert.equal(result.entries.length, 1);
	assert.equal(result.entries[0]?.valid, true);
	assert.equal(result.entries[0]?.authority, "handoff");
});

test("CA-2/5: incompatible state, issue, or persisted content blocks only that identity", () => {
	const stateMismatch = handoffMarkdown({ id: "state-mismatch", state: "finalized" });
	const issueMismatch = handoffMarkdown({ id: "issue-mismatch", state: "paused", issue: "#8" });
	const contentA = handoffMarkdown({ id: "content-mismatch", state: "finalized", body: "Persisted A" });
	const contentB = handoffMarkdown({ id: "content-mismatch", state: "finalized", body: "Persisted B" });
	const neighbor = handoffMarkdown({ id: "neighbor", state: "paused" });
	const result = reconcileGrillInventory({
		snapshots: [
			snapshotFile(snapshot({ id: "state-mismatch", topic: "State", status: "active" }), "state.json"),
			snapshotFile(snapshot({
				id: "issue-mismatch",
				topic: "Issue",
				status: "active",
				sourceIssue: { number: 7 },
			}), "issue.json"),
			snapshotFile(snapshot({
				id: "content-mismatch",
				topic: "Content",
				status: "finalized",
				handoffMarkdown: contentA,
			}), "content.json"),
		],
		handoffs: [
			handoffFile(stateMismatch, `${ROOT}/.sdd/grills/state.md`),
			handoffFile(issueMismatch, `${ROOT}/.sdd/grills/issue.md`),
			handoffFile(contentB, `${ROOT}/.sdd/grills/content.md`),
			handoffFile(neighbor, `${ROOT}/.sdd/grills/neighbor.md`),
		],
	});

	for (const id of ["state-mismatch", "issue-mismatch", "content-mismatch"]) {
		const entry = result.entries.find((candidate) => candidate.grillId === id);
		assert.equal(entry?.valid, false, id);
		assert.deepEqual(inventoryActions(entry!), ["inspect"], id);
	}
	const neighborEntry = result.entries.find((entry) => entry.grillId === "neighbor");
	assert.ok(neighborEntry?.valid);
	assert.deepEqual(inventoryActions(neighborEntry!), ["inspect", "resume"]);
});
