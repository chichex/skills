import { isAbsolute, relative, resolve } from "node:path";

import type {
	ArtifactRef,
	WorkflowResolutionV1,
	WorkflowRoute,
} from "../workflow-resolution/index.ts";
import type { StartFreshStageRequest } from "./lifecycle.ts";
import { validateWorkflowResolution } from "./protocol.ts";

export type WorkflowDispatchResult =
	| { ok: true; request: StartFreshStageRequest }
	| { ok: false; code: string; message: string };

const ROUTE_MATRIX = new Map<WorkflowRoute, { stage: string; mode: string | null }>([
	["grill", { stage: "grill", mode: "new" }],
	["join-grill", { stage: "grill", mode: "new" }],
	["spec", { stage: "spec", mode: "new" }],
	["join-spec", { stage: "spec", mode: "new" }],
	["quick-run", { stage: "quick-run", mode: "new" }],
	["join-quick-run", { stage: "quick-run", mode: "new" }],
	["resume-grill", { stage: "grill", mode: "resume" }],
	["spec-from-grill", { stage: "spec", mode: "from-grill" }],
	["update-existing-spec", { stage: "spec", mode: "update" }],
	["audit-existing-spec", { stage: "spec", mode: "update" }],
	["run-existing-spec", { stage: "run-existing-spec", mode: null }],
]);

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

function coherentStart(resolution: WorkflowResolutionV1): boolean {
	if (resolution.outcome !== "start" || resolution.selectedRoute === null || resolution.code !== resolution.selectedRoute) {
		return false;
	}
	const expected = ROUTE_MATRIX.get(resolution.selectedRoute);
	return expected !== undefined && resolution.stage === expected.stage && resolution.mode === expected.mode;
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

function validatedSpec(
	resolution: WorkflowResolutionV1,
	issue: { repository: string; number: number },
): ArtifactRef | null {
	const spec = primaryArtifact(resolution, "spec");
	if (!spec || !canonicalArtifact(spec) || !spec.issue || !sameIssue(spec.issue, issue)) return null;
	if (spec.location === "local") {
		if (!isAbsolute(spec.path) || !pathInside(resolution.cwd, spec.path)) return null;
		return spec;
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

export function resolveWorkflowDispatch(input: unknown): WorkflowDispatchResult {
	const validation = validateWorkflowResolution(input);
	if (!validation.ok) {
		return failure(
			"invalid-resolution",
			validation.diagnostics.map(({ path, message }) => `${path} ${message}`).join("; "),
		);
	}
	const resolution = validation.value;
	if (!coherentStart(resolution)) {
		return failure("not-actionable", "Resolution is not a confirmed coherent start");
	}

	const issue = effectiveIssue(resolution);
	if (!issue || !sameRepository(issue.repository, resolution.repo)) {
		return failure("missing-effective-issue", "Dispatch requires one canonical issue in repo");
	}
	const route = resolution.selectedRoute!;
	if (route.startsWith("join-") && resolution.canonicalIssue === null) {
		return failure("missing-effective-issue", "Join dispatch requires canonicalIssue");
	}

	if (route === "grill" || route === "join-grill") return request(resolution, "grill", `#${issue.number}`);
	if (route === "spec" || route === "join-spec") return request(resolution, "sdd-spec", `#${issue.number}`);
	if (route === "quick-run" || route === "join-quick-run") {
		return request(resolution, "quick-run", JSON.stringify(resolution));
	}
	if (route === "resume-grill") {
		const grill = validatedGrill(resolution, issue, true);
		return grill
			? request(resolution, "grill", `--resume ${grill.grill}`)
			: failure("invalid-grill-reference", "resume-grill requires one canonical in-project grill leaf");
	}
	if (route === "spec-from-grill") {
		const grill = validatedGrill(resolution, issue, false);
		return grill
			? request(resolution, "sdd-spec", `--from-grill ${grill.grill}`)
			: failure("invalid-grill-reference", "spec-from-grill requires one canonical in-project grill leaf");
	}
	if (route === "update-existing-spec" || route === "audit-existing-spec" || route === "run-existing-spec") {
		const spec = validatedSpec(resolution, issue);
		if (!spec) return failure("invalid-spec-reference", `${route} requires one canonical in-project primary spec`);
		return request(
			resolution,
			route === "run-existing-spec" ? "sdd-run" : "sdd-spec",
			specArgument(spec),
		);
	}
	return failure("unsupported-route", `No dispatch mapping for ${route}`);
}
