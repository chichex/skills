import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import {
	buildImportedDuplicate,
	buildImportedResume,
	persistImportedSnapshots,
	snapshotStorageStem,
	type SnapshotImportPorts,
} from "./runtime-import.ts";
import type { GrillInventoryEntry, GrillSnapshot } from "./inventory.ts";

const ROOT = "/workspace/current repo";
const SOURCE_PATH = `${ROOT}/.sdd/grills/source handoff.md`;
const MARKDOWN = [
	"# Grill — Portable source",
	"<!-- SDD-Tracking: version=1; type=grill; state=paused; issue=owner%2Frepo%237; grill=portable%2F..%2Fid; project=%2FUsers%2Fold%2Frepo -->",
	"",
	"## Modo",
	"domain-modeling",
	"",
	"## Hechos comprobados",
	"Confirmed source fact.",
	"",
].join("\n");

function entry(overrides: Partial<GrillInventoryEntry> = {}): GrillInventoryEntry {
	return {
		key: "portable-key",
		grillId: "portable/../id",
		topic: "Portable source",
		projectPath: ROOT,
		historicalProjectPath: "/Users/old/repo",
		state: "paused",
		authority: "handoff",
		valid: true,
		diagnostics: [],
		warnings: [{ code: "historical-project-mismatch", message: "portable" }],
		handoffMarkdown: MARKDOWN,
		handoffPaths: [SOURCE_PATH],
		issue: { repository: "owner/repo", number: 7 },
		...overrides,
	};
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function memoryPorts(
	initial: GrillSnapshot[] = [],
	overrides: Partial<SnapshotImportPorts> = {},
): SnapshotImportPorts & { store: Map<string, GrillSnapshot>; writes: string[]; removals: string[] } {
	const store = new Map(initial.map((snapshot) => [snapshot.id, clone(snapshot)]));
	const writes: string[] = [];
	const removals: string[] = [];
	return {
		store,
		writes,
		removals,
		async read(id) {
			return store.has(id) ? clone(store.get(id)!) : null;
		},
		async writeNew(snapshot) {
			if (store.has(snapshot.id)) throw new Error(`collision: ${snapshot.id}`);
			writes.push(snapshot.id);
			store.set(snapshot.id, clone(snapshot));
		},
		async remove(id) {
			removals.push(id);
			store.delete(id);
		},
		...overrides,
	};
}

test("CA-7/10: unsafe logical ids keep their identity but map to deterministic confined filenames", () => {
	assert.equal(snapshotStorageStem("legacy-safe_id-7"), "legacy-safe_id-7");
	const unsafe = snapshotStorageStem("../../escape/🦙");
	assert.match(unsafe, /^imported-[a-f0-9]{40}$/);
	assert.equal(unsafe, snapshotStorageStem("../../escape/🦙"));
	assert.notEqual(unsafe, snapshotStorageStem("../../escape/other"));
	assert.equal(resolve("/store", `${unsafe}.json`).startsWith("/store/"), true);
});

test("CA-3/7: resume import uses the physical root, explicit conservative defaults and the complete source", () => {
	const timestamp = "2026-09-29T12:00:00.000Z";
	const plan = buildImportedResume(entry(), timestamp);
	assert.equal(plan.snapshots.length, 1);
	const imported = plan.snapshots[0]!;
	assert.equal(imported.id, "portable/../id");
	assert.equal(imported.projectPath, ROOT);
	assert.equal(imported.status, "active");
	assert.equal(imported.workflowMode, "domain-modeling");
	assert.equal(imported.interviewMode, "unselected");
	assert.deepEqual(imported.estimate, { min: 0, likely: 0, max: 0 });
	assert.equal(imported.questionLimit, 20);
	assert.deepEqual(imported.interactions, []);
	assert.deepEqual(imported.decisions, []);
	assert.deepEqual(imported.pendingBranches, []);
	assert.deepEqual(imported.sourceIssue, { repository: "owner/repo", number: 7 });
	assert.equal(imported.handoffMarkdown, MARKDOWN);
	assert.deepEqual(imported.importedHandoff, {
		kind: "handoff-only",
		sourcePath: SOURCE_PATH,
		historicalProjectPath: "/Users/old/repo",
		markdown: MARKDOWN,
		importedAt: timestamp,
		hadRuntimeSnapshot: false,
	});
});

test("CA-7: persistence rereads before success, is idempotent, and rejects an incompatible collision", async () => {
	const plan = buildImportedResume(entry(), "2026-09-29T12:00:00.000Z");
	const ports = memoryPorts();
	const first = await persistImportedSnapshots(plan, ports);
	assert.deepEqual(first.snapshots.map(({ id }) => id), ["portable/../id"]);
	assert.deepEqual(ports.writes, ["portable/../id"]);

	const retry = await persistImportedSnapshots(plan, ports);
	assert.deepEqual(retry.snapshots.map(({ id }) => id), ["portable/../id"]);
	assert.deepEqual(ports.writes, ["portable/../id"], "a compatible retry reuses the persisted snapshot");

	const incompatible = clone(plan.snapshots[0]!);
	incompatible.importedHandoff = undefined;
	incompatible.handoffMarkdown = "different";
	const collisionPorts = memoryPorts([incompatible]);
	await assert.rejects(persistImportedSnapshots(plan, collisionPorts), /incompatible.*portable\/\.\.\/id/i);
	assert.deepEqual(collisionPorts.writes, []);
	assert.equal(collisionPorts.store.get("portable/../id")?.handoffMarkdown, "different");
});

test("CA-7: write and post-read failures leave no newly imported snapshot", async () => {
	const plan = buildImportedResume(entry(), "2026-09-29T12:00:00.000Z");
	const writeFailure = memoryPorts([], {
		async writeNew() {
			throw new Error("disk full");
		},
	});
	await assert.rejects(persistImportedSnapshots(plan, writeFailure), /disk full/);
	assert.equal(writeFailure.store.size, 0);

	let reads = 0;
	const postReadFailure = memoryPorts([], {
		async read(id) {
			reads += 1;
			if (reads > 1) throw new Error("post-read failed");
			return postReadFailure.store.has(id) ? clone(postReadFailure.store.get(id)!) : null;
		},
	});
	await assert.rejects(persistImportedSnapshots(plan, postReadFailure), /post-read failed/);
	assert.equal(postReadFailure.store.size, 0);
	assert.deepEqual(postReadFailure.removals, ["portable/../id"]);
});

test("CA-8: duplicate materializes one imported baseline and one child without a phantom revision", async () => {
	const finalizedMarkdown = MARKDOWN.replace("state=paused", "state=finalized");
	const source = entry({ state: "finalized", handoffMarkdown: finalizedMarkdown });
	const plan = buildImportedDuplicate(source, "child-safe-id", "2026-09-29T12:00:00.000Z");
	assert.equal(plan.snapshots.length, 2);
	const [baseline, child] = plan.snapshots;
	assert.equal(baseline?.status, "finalized");
	assert.equal(baseline?.revision, 1);
	assert.equal(baseline?.importedHandoff?.hadRuntimeSnapshot, false);
	assert.equal(child?.status, "active");
	assert.equal(child?.parentId, baseline?.id);
	assert.equal(child?.revision, 2);
	assert.equal(child?.handoffMarkdown, undefined);
	assert.equal(child?.importedHandoff?.markdown, finalizedMarkdown);

	const ports = memoryPorts();
	const receipt = await persistImportedSnapshots(plan, ports);
	assert.deepEqual(receipt.snapshots.map(({ id }) => id), ["portable/../id", "child-safe-id"]);
	assert.deepEqual(ports.writes, ["portable/../id", "child-safe-id"]);

	const retryPlan = buildImportedDuplicate(source, "second-child", "2026-09-29T13:00:00.000Z");
	await persistImportedSnapshots(retryPlan, ports);
	assert.deepEqual(ports.writes, ["portable/../id", "child-safe-id", "second-child"]);
	assert.equal(ports.store.size, 3, "the compatible baseline is reused and each requested child exists once");
});
