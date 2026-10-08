import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import {
	DEFAULT_GRILL_QUESTION_LIMIT,
	GRILL_SNAPSHOT_VERSION,
	type GrillInventoryEntry,
	type GrillSnapshot,
} from "./inventory.ts";

export interface ImportedSnapshotPlan {
	snapshots: GrillSnapshot[];
}

export interface SnapshotImportPorts {
	read(id: string): Promise<GrillSnapshot | null>;
	writeNew(snapshot: GrillSnapshot): Promise<void>;
	remove(id: string): Promise<void>;
}

const SAFE_STORAGE_ID = /^[A-Za-z0-9_-]+$/;

export function snapshotStorageStem(id: string): string {
	if (SAFE_STORAGE_ID.test(id)) return id;
	return `imported-${createHash("sha256").update(id).digest("hex").slice(0, 40)}`;
}

function assertHandoffOnly(
	entry: GrillInventoryEntry,
	expectedState: "paused" | "finalized",
): asserts entry is GrillInventoryEntry & {
	grillId: string;
	projectPath: string;
	handoffMarkdown: string;
} {
	if (!entry.valid || entry.authority !== "handoff" || entry.state !== expectedState) {
		throw new Error(`A valid handoff-only ${expectedState} entry is required`);
	}
	if (entry.snapshot) throw new Error("Runtime import is only valid when no snapshot exists");
	if (!entry.grillId || !entry.projectPath || !entry.handoffMarkdown || entry.handoffPaths.length === 0) {
		throw new Error("Handoff identity, physical project, source path, and Markdown are required");
	}
}

function importedBaseline(
	entry: GrillInventoryEntry & { grillId: string; projectPath: string; handoffMarkdown: string },
	status: "active" | "finalized",
	timestamp: string,
): GrillSnapshot {
	const sourcePath = resolve(entry.handoffPaths[0]!);
	const projectPath = resolve(entry.projectPath);
	return {
		version: GRILL_SNAPSHOT_VERSION,
		id: entry.grillId,
		topic: entry.topic,
		projectPath,
		projectName: basename(projectPath),
		status,
		interviewMode: "unselected",
		...(entry.issue
			? { sourceIssue: { number: entry.issue.number, repository: entry.issue.repository } }
			: {}),
		createdAt: timestamp,
		updatedAt: timestamp,
		estimate: { min: 0, likely: 0, max: 0 },
		questionLimit: DEFAULT_GRILL_QUESTION_LIMIT,
		sections: [],
		interactions: [],
		decisions: [],
		pendingBranches: [],
		handoffMarkdown: entry.handoffMarkdown,
		revision: 1,
		importedHandoff: {
			kind: "handoff-only",
			sourcePath,
			...(entry.historicalProjectPath
				? { historicalProjectPath: entry.historicalProjectPath }
				: {}),
			markdown: entry.handoffMarkdown,
			importedAt: timestamp,
			hadRuntimeSnapshot: false,
		},
	};
}

export function buildImportedResume(
	entry: GrillInventoryEntry,
	timestamp: string,
): ImportedSnapshotPlan {
	assertHandoffOnly(entry, "paused");
	return { snapshots: [importedBaseline(entry, "active", timestamp)] };
}

export function buildImportedDuplicate(
	entry: GrillInventoryEntry,
	childId: string,
	timestamp: string,
): ImportedSnapshotPlan {
	assertHandoffOnly(entry, "finalized");
	if (!childId.trim() || childId === entry.grillId) throw new Error("A distinct child grill id is required");
	const baseline = importedBaseline(entry, "finalized", timestamp);
	const child: GrillSnapshot = {
		...baseline,
		id: childId,
		status: "active",
		interviewMode: "unselected",
		createdAt: timestamp,
		updatedAt: timestamp,
		handoffMarkdown: undefined,
		parentId: baseline.id,
		revision: baseline.revision + 1,
	};
	return { snapshots: [baseline, child] };
}

function sameIssue(left: GrillSnapshot["sourceIssue"], right: GrillSnapshot["sourceIssue"]): boolean {
	if (!left || !right) return left === right;
	return left.number === right.number
		&& (left.repository ?? "").toLowerCase() === (right.repository ?? "").toLowerCase();
}

function compatibleSnapshot(actual: GrillSnapshot, expected: GrillSnapshot): boolean {
	const actualSource = actual.importedHandoff;
	const expectedSource = expected.importedHandoff;
	return actual.id === expected.id
		&& resolve(actual.projectPath) === resolve(expected.projectPath)
		&& actual.status === expected.status
		&& actual.interviewMode === expected.interviewMode
		&& actual.parentId === expected.parentId
		&& actual.revision === expected.revision
		&& sameIssue(actual.sourceIssue, expected.sourceIssue)
		&& actual.handoffMarkdown === expected.handoffMarkdown
		&& actualSource?.kind === "handoff-only"
		&& expectedSource?.kind === "handoff-only"
		&& resolve(actualSource.sourcePath) === resolve(expectedSource.sourcePath)
		&& actualSource.historicalProjectPath === expectedSource.historicalProjectPath
		&& actualSource.markdown === expectedSource.markdown
		&& actualSource.hadRuntimeSnapshot === false;
}

async function cleanupCreated(ids: string[], ports: SnapshotImportPorts): Promise<string[]> {
	const failures: string[] = [];
	for (const id of [...ids].reverse()) {
		try {
			await ports.remove(id);
		} catch (error) {
			failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return failures;
}

export async function persistImportedSnapshots(
	plan: ImportedSnapshotPlan,
	ports: SnapshotImportPorts,
): Promise<{ snapshots: GrillSnapshot[]; createdIds: string[] }> {
	if (plan.snapshots.length === 0) throw new Error("An import plan must contain at least one snapshot");
	const ids = plan.snapshots.map(({ id }) => id);
	if (new Set(ids).size !== ids.length) throw new Error("An import plan cannot repeat a logical grill id");

	const existing = new Map<string, GrillSnapshot>();
	for (const expected of plan.snapshots) {
		const found = await ports.read(expected.id);
		if (!found) continue;
		if (!compatibleSnapshot(found, expected)) {
			throw new Error(`Refusing incompatible runtime snapshot collision for ${expected.id}`);
		}
		existing.set(expected.id, found);
	}

	const created: string[] = [];
	try {
		for (const expected of plan.snapshots) {
			if (existing.has(expected.id)) continue;
			await ports.writeNew(expected);
			created.push(expected.id);
		}

		const snapshots: GrillSnapshot[] = [];
		for (const expected of plan.snapshots) {
			const reread = await ports.read(expected.id);
			if (!reread || !compatibleSnapshot(reread, expected)) {
				throw new Error(`Imported snapshot postcondition failed for ${expected.id}`);
			}
			snapshots.push(reread);
		}
		return { snapshots, createdIds: [...created] };
	} catch (error) {
		const cleanupFailures = await cleanupCreated(created, ports);
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(cleanupFailures.length > 0
			? `${message}; cleanup failed: ${cleanupFailures.join("; ")}`
			: message);
	}
}
