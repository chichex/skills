import assert from "node:assert/strict";
import { test } from "node:test";

import {
	filterGrillInventory,
	inventoryActions,
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
		workflowMode: "standard",
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
	assert.equal(local.unattributedErrorCount, 1, "local scope reports but does not misattribute global corrupt files");
	assert.equal(local.entries[0]?.topic, "Shared topic");

	const all = filterGrillInventory(result, {
		currentProject: ROOT,
		scope: "all",
		status: "all",
		limit: 100,
	});
	assert.equal(all.entries.length, 5);
	assert.ok(all.entries.some((entry) => entry.projectPath === null));
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
