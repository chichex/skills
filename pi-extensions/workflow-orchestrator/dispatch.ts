import { isAbsolute, relative, resolve } from "node:path";

import { isGrillHandoffCandidatePath } from "../grill-tools/inventory.ts";
import {
	isSddArtifactPath,
	resolveSddArtifactDirs,
	trackedSddArtifactDirs,
	type SddArtifactDirs,
} from "../lib/sdd-paths.ts";
import type {
	ArtifactRef,
	WorkflowResolutionV1,
} from "../workflow-resolution/index.ts";
import type { StartFreshStageRequest } from "./lifecycle.ts";
import { validateWorkflowResolution } from "./protocol.ts";
import { isConfirmedCoherentStart } from "./route-contract.ts";

/** Los dos lugares de borradores del repo de `resolution.cwd` (spec #84, CA-12). */
export interface WorkflowDispatchDirs {
	grills: SddArtifactDirs;
	specs: SddArtifactDirs;
}

export type WorkflowDispatchResult =
	| { ok: true; request: StartFreshStageRequest }
	| { ok: false; code: string; message: string };

function failure(code: string, message: string): WorkflowDispatchResult {
	return { ok: false, code, message };
}

function sameRepository(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

function sameIssue(
	left: { repository: string; number: number },
	right: { repository: string; number: number },
): boolean {
	return left.number === right.number && sameRepository(left.repository, right.repository);
}

function effectiveIssue(resolution: WorkflowResolutionV1): { repository: string; number: number } | null {
	return resolution.canonicalIssue ?? (resolution.sources.length === 1 ? resolution.sources[0]! : null);
}

function pathInside(root: string, candidate: string): boolean {
	const relation = relative(resolve(root), resolve(candidate));
	return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function primaryArtifact(
	resolution: WorkflowResolutionV1,
	type: "grill" | "spec",
): ArtifactRef | null {
	const matches = resolution.artifacts.filter((artifact) => artifact.primary && artifact.type === type);
	return matches.length === 1 ? matches[0]! : null;
}

function canonicalArtifact(artifact: ArtifactRef): boolean {
	return artifact.format === "canonical"
		&& artifact.provenance === "canonical"
		&& artifact.identityProvenance === "canonical"
		&& artifact.diagnostics.length === 0;
}

function validatedGrill(
	resolution: WorkflowResolutionV1,
	issue: { repository: string; number: number },
	allowSnapshot: boolean,
): ArtifactRef | null {
	const grill = primaryArtifact(resolution, "grill");
	if (!grill || !grill.grill || !grill.issue || !sameIssue(grill.issue, issue)) return null;
	if (!grill.project || resolve(grill.project) !== resolve(resolution.cwd)) return null;
	if (grill.diagnostics.length > 0) return null;
	if (allowSnapshot && grill.format === "snapshot" && grill.provenance === "snapshot") return grill;
	return canonicalArtifact(grill) ? grill : null;
}

function directHandoffPath(dirs: SddArtifactDirs, path: string): boolean {
	if (!isAbsolute(path) || !isGrillHandoffCandidatePath(path)) return false;
	return isSddArtifactPath(dirs, path);
}

function validatedFinalizedGrillSource(
	resolution: WorkflowResolutionV1,
	issue: { repository: string; number: number },
	dirs: WorkflowDispatchDirs,
): { kind: "id" | "path"; value: string } | null {
	const handoff = primaryArtifact(resolution, "grill");
	if (!handoff
		|| handoff.location !== "handoff"
		|| handoff.state !== "finalized"
		|| !handoff.grill
		|| !handoff.issue
		|| !sameIssue(handoff.issue, issue)
		|| !canonicalArtifact(handoff)
		|| !directHandoffPath(dirs.grills, handoff.path)) {
		return null;
	}
	const snapshots = resolution.artifacts.filter((artifact) =>
		artifact.type === "grill"
		&& artifact.location === "snapshot"
		&& artifact.grill === handoff.grill
	);
	if (snapshots.length === 0) return { kind: "path", value: resolve(handoff.path) };
	if (snapshots.length !== 1) return null;
	const snapshot = snapshots[0]!;
	if (snapshot.format !== "snapshot"
		|| snapshot.provenance !== "snapshot"
		|| snapshot.identityProvenance !== "snapshot"
		|| snapshot.state !== "finalized"
		|| !snapshot.issue
		|| !sameIssue(snapshot.issue, issue)
		|| !snapshot.project
		|| resolve(snapshot.project) !== resolve(resolution.cwd)
		|| snapshot.diagnostics.length > 0) {
		return null;
	}
	return { kind: "id", value: handoff.grill };
}

function validatedSpec(
	resolution: WorkflowResolutionV1,
	issue: { repository: string; number: number },
	dirs: WorkflowDispatchDirs,
): ArtifactRef | null {
	const spec = primaryArtifact(resolution, "spec");
	if (!spec || !canonicalArtifact(spec) || !spec.issue || !sameIssue(spec.issue, issue)) return null;
	if (spec.location === "local") {
		if (!isAbsolute(spec.path)) return null;
		const inProject = pathInside(resolution.cwd, spec.path);
		const draft = resolve(dirs.specs.local) !== resolve(dirs.specs.tracked) && isSddArtifactPath(dirs.specs, spec.path);
		return inProject || draft ? spec : null;
	}
	return spec.location === "issue" ? spec : null;
}

function specArgument(spec: ArtifactRef): string {
	return spec.location === "issue" && spec.issue ? `#${spec.issue.number}` : spec.path;
}

function request(
	resolution: WorkflowResolutionV1,
	name: string,
	args: string,
): WorkflowDispatchResult {
	return { ok: true, request: { resolution, skill: { name, args } } };
}

export function resolveWorkflowDispatch(input: unknown, sddDirs?: WorkflowDispatchDirs): WorkflowDispatchResult {
	const validation = validateWorkflowResolution(input);
	if (!validation.ok) {
		return failure(
			"invalid-resolution",
			validation.diagnostics.map(({ path, message }) => `${path} ${message}`).join("; "),
		);
	}
	const resolution = validation.value;
	if (!isConfirmedCoherentStart(resolution)) {
		return failure("not-actionable", "Resolution is not a confirmed coherent start");
	}
	const dirs = sddDirs ?? {
		grills: trackedSddArtifactDirs(resolution.cwd, "grills"),
		specs: trackedSddArtifactDirs(resolution.cwd, "specs"),
	};

	const issue = effectiveIssue(resolution);
	if (!issue || !sameRepository(issue.repository, resolution.repo)) {
		return failure("missing-effective-issue", "Dispatch requires one canonical issue in repo");
	}
	const route = resolution.selectedRoute;
	if (route.startsWith("join-") && resolution.canonicalIssue === null) {
		return failure("missing-effective-issue", "Join dispatch requires canonicalIssue");
	}

	switch (route) {
		case "grill":
		case "join-grill":
			return request(resolution, "grill", `#${issue.number}`);
		case "spec":
		case "join-spec":
			return request(resolution, "sdd-spec", `#${issue.number}`);
		case "quick-run":
		case "join-quick-run":
			// The complete resolution is carried once in the escaped workflow
			// envelope. Repeating attacker-controlled issue prose as raw skill args
			// would create a second, unframed authority channel.
			return request(resolution, "quick-run", "");
		case "resume-grill": {
			const grill = validatedGrill(resolution, issue, true);
			return grill
				? request(resolution, "grill", `--resume ${JSON.stringify(grill.grill)}`)
				: failure("invalid-grill-reference", "resume-grill requires one canonical in-project grill leaf");
		}
		case "spec-from-grill": {
			const source = validatedFinalizedGrillSource(resolution, issue, dirs);
			return source
				? request(
					resolution,
					"sdd-spec",
					`--from-grill ${JSON.stringify(source.value)}`,
				)
				: failure("invalid-grill-reference", "spec-from-grill requires one canonical finalized grill source");
		}
		case "update-existing-spec":
		case "audit-existing-spec":
		case "run-existing-spec": {
			const spec = validatedSpec(resolution, issue, dirs);
			if (!spec) return failure("invalid-spec-reference", `${route} requires one canonical in-project primary spec`);
			return request(
				resolution,
				route === "run-existing-spec" ? "sdd-run" : "sdd-spec",
				specArgument(spec),
			);
		}
	}
	const exhaustive: never = route;
	return exhaustive;
}

/**
 * Igual que resolveWorkflowDispatch, pero resuelve con git los dos lugares de
 * borradores del repo de `cwd` (spec #84, CA-12): así una spec o un handoff en
 * <git-common-dir>/sdd/ se aceptan desde el checkout principal y desde un
 * worktree linkeado.
 */
export async function resolveWorkflowDispatchForCwd(input: unknown): Promise<WorkflowDispatchResult> {
	const cwd = typeof input === "object" && input !== null && typeof (input as { cwd?: unknown }).cwd === "string"
		? (input as { cwd: string }).cwd
		: null;
	if (cwd === null || !isAbsolute(cwd)) return resolveWorkflowDispatch(input);
	const [grills, specs] = await Promise.all([
		resolveSddArtifactDirs(cwd, "grills"),
		resolveSddArtifactDirs(cwd, "specs"),
	]);
	return resolveWorkflowDispatch(input, { grills, specs });
}
