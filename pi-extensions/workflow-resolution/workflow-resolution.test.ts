import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildFreshnessEvidence,
	inspectMarkdownArtifact,
	resolveWorkflow,
	selectWorkflowRoute,
} from "./index.ts";

const REPOSITORY = "chichex/skills";
const PROJECT_ROOT = "/workspace/skills";

function issue(number: number) {
	return { repository: REPOSITORY, number };
}

function resolutionInput(overrides: Record<string, unknown> = {}) {
	return {
		repository: REPOSITORY,
		cwd: PROJECT_ROOT,
		sources: [issue(11)],
		canonicalIssue: issue(11),
		canonicalIssueUsable: true,
		recommendedClassification: "quick-run",
		fallbackClassification: "spec",
		summary: "Resolver el próximo stage.",
		impactExample: "Una spec implementada no vuelve a ejecutarse.",
		scope: ["resolver"],
		checklist: ["resultado estructurado"],
		evidence: [],
		risks: [],
		artifacts: [],
		...overrides,
	};
}

function freshness(value: "fresh" | "stale" | "unknown") {
	return {
		baseline: { source: "local-file" as const, at: "2026-08-08T10:00:00.000Z" },
		historyComplete: value !== "unknown",
		materialEvents: [],
		administrativeEvents: [],
		freshness: value,
		diagnostics: value === "unknown" ? [{ code: "incomplete-history", message: "incomplete" }] : [],
	};
}

function encodeReference(value: string): string {
	return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
		`%${character.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

function specAt({
	id,
	path,
	state,
	supersededBy = null,
	fresh = "unknown",
	location = "local",
	grill = null,
}: {
	id: string;
	path: string;
	state: "draft" | "approved" | "implemented" | "superseded";
	supersededBy?: string | null;
	fresh?: "fresh" | "stale" | "unknown";
	location?: "local" | "issue";
	grill?: string | null;
}) {
	return {
		kind: "markdown" as const,
		id,
		expectedType: "spec" as const,
		location,
		path,
		...(location === "issue" ? { hostIssue: issue(11) } : {}),
		markdown: [
			`# Spec — ${id}`,
			`<!-- SDD-Tracking: version=1; type=spec; state=${state}; issue=#11; grill=${grill === null ? "none" : encodeReference(grill)}; superseded-by=${supersededBy === null ? "none" : encodeReference(supersededBy)} -->`,
			"",
			"## Contexto",
			`Body ${id}.`,
			"",
		].join("\n"),
		freshness: freshness(fresh),
	};
}

function grillHandoff(id: string, state: "paused" | "finalized") {
	return {
		kind: "markdown" as const,
		id: `handoff-${id}-${state}`,
		expectedType: "grill" as const,
		location: "handoff" as const,
		path: `${PROJECT_ROOT}/.sdd/grills/${id}.md`,
		markdown: [
			`# Grill — ${id}`,
			`<!-- SDD-Tracking: version=1; type=grill; state=${state}; issue=#11; grill=${encodeReference(id)}; project=${encodeReference(PROJECT_ROOT)} -->`,
			"",
			"## Handoff",
			`Handoff ${id}.`,
			"",
		].join("\n"),
	};
}

function grillSnapshot({
	id,
	state,
	parentId = null,
	revision = 1,
}: {
	id: string;
	state: "active" | "paused" | "finalized";
	parentId?: string | null;
	revision?: number;
}) {
	return {
		kind: "grill-snapshot" as const,
		id: `snapshot-${id}`,
		path: `/home/test/.pi/agent/grill-sessions/${id}.json`,
		grillId: id,
		state,
		issue: issue(11),
		projectPath: PROJECT_ROOT,
		parentId,
		revision,
	};
}

function canonicalSpec(
	state: "draft" | "approved" | "implemented" | "superseded",
	freshnessValue: "fresh" | "stale" | "unknown" = "unknown",
) {
	return {
		kind: "markdown" as const,
		id: `spec-${state}-${freshnessValue}`,
		expectedType: "spec" as const,
		location: "local" as const,
		path: `/workspace/skills/.sdd/specs/issue-11-${state}.md`,
		markdown: [
			`# Spec — ${state}`,
			`<!-- SDD-Tracking: version=1; type=spec; state=${state}; issue=#11; grill=none; superseded-by=${state === "superseded" ? ".sdd%2Fspecs%2Fissue-11-next.md" : "none"} -->`,
			"",
			"## Contexto",
			"Body.",
			"",
		].join("\n"),
		freshness: freshness(freshnessValue),
	};
}

test("reads canonical implemented state and relative issue identity without a legacy Estado field", () => {
	const markdown = [
		"# Spec — Resolver artefactos",
		"<!-- SDD-Tracking: version=1; type=spec; state=implemented; issue=#11; grill=none; superseded-by=none -->",
		"",
		"## Resultado de ejecucion",
		"Done.",
		"",
	].join("\n");

	const artifact = inspectMarkdownArtifact({
		kind: "markdown",
		id: "local-spec",
		expectedType: "spec",
		location: "local",
		path: "/workspace/skills/.sdd/specs/issue-11-resolver.md",
		markdown,
	}, {
		repository: REPOSITORY,
		projectRoot: PROJECT_ROOT,
	});

	assert.equal(artifact.state, "implemented");
	assert.equal(artifact.format, "canonical");
	assert.equal(artifact.provenance, "canonical");
	assert.deepEqual(artifact.issue, issue(11));
	assert.equal(artifact.identityProvenance, "canonical");
	assert.deepEqual(artifact.diagnostics, []);
});

test("recovers only legacy or absent identity and diagnoses canonical mismatches", () => {
	const legacy = inspectMarkdownArtifact({
		kind: "markdown",
		id: "legacy-spec",
		expectedType: "spec",
		location: "local",
		path: "/workspace/skills/.sdd/specs/legacy.md",
		markdown: "# Spec — Legacy\n<!-- Estado: pendiente de ejecución. Fuente: issue #11. -->\n",
	}, { repository: REPOSITORY, projectRoot: PROJECT_ROOT });
	assert.equal(legacy.state, "approved");
	assert.equal(legacy.format, "legacy");
	assert.equal(legacy.provenance, "legacy-explicit");
	assert.equal(legacy.identityProvenance, "legacy");
	assert.deepEqual(legacy.issue, issue(11));

	const absent = inspectMarkdownArtifact({
		kind: "markdown",
		id: "absent-spec",
		expectedType: "spec",
		location: "local",
		path: "/workspace/skills/.sdd/specs/issue-11-no-marker.md",
		markdown: "# Notes without artifact metadata\n",
	}, { repository: REPOSITORY, projectRoot: PROJECT_ROOT });
	assert.equal(absent.format, "absent");
	assert.equal(absent.identityProvenance, "filename");
	assert.deepEqual(absent.issue, issue(11));
	assert.ok(absent.diagnostics.some(({ code }) => code === "identity-from-filename"));

	const mismatched = inspectMarkdownArtifact({
		kind: "markdown",
		id: "mismatched-spec",
		expectedType: "spec",
		location: "issue",
		path: "https://github.com/chichex/skills/issues/11",
		hostIssue: issue(11),
		markdown: [
			"# Spec — Wrong issue",
			"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#12; grill=none; superseded-by=none -->",
		].join("\n"),
	}, { repository: REPOSITORY, projectRoot: PROJECT_ROOT });
	assert.deepEqual(mismatched.issue, issue(12), "canonical identity remains authoritative");
	assert.equal(mismatched.identityProvenance, "canonical");
	assert.ok(mismatched.diagnostics.some(({ code }) => code === "issue-mismatch"));

	const wrongType = inspectMarkdownArtifact({
		kind: "markdown",
		id: "wrong-type",
		expectedType: "spec",
		location: "issue",
		path: "https://github.com/chichex/skills/issues/11",
		hostIssue: issue(11),
		markdown: [
			"# Grill — Not a spec",
			"<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=#11; grill=g-11; project=%2Fworkspace%2Fskills -->",
		].join("\n"),
	}, { repository: REPOSITORY, projectRoot: PROJECT_ROOT });
	assert.equal(wrongType.type, "grill");
	assert.ok(wrongType.diagnostics.some(({ code }) => code === "artifact-type-mismatch"));
});

test("builds conservative trivalent freshness from material and administrative history", () => {
	const stale = buildFreshnessEvidence({
		baseline: { source: "local-file", at: "2026-08-08T10:00:00.000Z" },
		historyComplete: false,
		events: [
			{ kind: "labels", at: "2026-08-08T10:30:00.000Z" },
			{ kind: "comment", at: "2026-08-08T11:00:00.000Z" },
		],
	});
	assert.equal(stale.freshness, "stale", "a demonstrably later material event is sufficient");
	assert.deepEqual(stale.materialEvents.map(({ kind }) => kind), ["comment"]);
	assert.deepEqual(stale.administrativeEvents.map(({ kind }) => kind), ["labels"]);

	const fresh = buildFreshnessEvidence({
		baseline: { source: "issue-body", at: "2026-08-08T10:00:00.000Z" },
		historyComplete: true,
		events: [
			{ kind: "title", at: "2026-08-08T09:00:00.000Z" },
			{ kind: "assignees", at: "2026-08-08T12:00:00.000Z" },
		],
	});
	assert.equal(fresh.freshness, "fresh", "administrative changes do not stale a spec");

	for (const evidence of [
		buildFreshnessEvidence({
			baseline: { source: "local-file", at: "2026-08-08T10:00:00.000Z" },
			historyComplete: false,
			events: [],
		}),
		buildFreshnessEvidence({
			baseline: { source: "local-file", at: null },
			historyComplete: true,
			events: [],
		}),
		buildFreshnessEvidence({
			baseline: { source: "local-file", at: "2026-08-08T10:00:00.000Z" },
			historyComplete: true,
			events: [{ kind: "body", at: "not-a-time" }],
		}),
	]) {
		assert.equal(evidence.freshness, "unknown");
		assert.ok(evidence.diagnostics.length > 0);
	}
});

test("routes new work and a single resolved spec through the deterministic stage matrix", () => {
	const newWork = resolveWorkflow(resolutionInput());
	assert.deepEqual(
		{
			outcome: newWork.outcome,
			code: newWork.code,
			recommendedRoute: newWork.recommendedRoute,
			selectedRoute: newWork.selectedRoute,
			stage: newWork.stage,
			mode: newWork.mode,
		},
		{
			outcome: "start",
			code: "quick-run",
			recommendedRoute: "quick-run",
			selectedRoute: null,
			stage: "quick-run",
			mode: "new",
		},
	);

	const cases = [
		["draft", "unknown", "start", "update-existing-spec", "spec", "update"],
		["approved", "fresh", "start", "run-existing-spec", "run-existing-spec", null],
		["approved", "unknown", "start", "audit-existing-spec", "spec", "update"],
		["implemented", "fresh", "stop", "already-implemented", null, null],
		["implemented", "stale", "start", "audit-existing-spec", "spec", "update"],
	] as const;

	for (const [state, freshness, outcome, route, stage, mode] of cases) {
		const result = resolveWorkflow(resolutionInput({ artifacts: [canonicalSpec(state, freshness)] }));
		assert.equal(result.outcome, outcome, `${state}/${freshness}: outcome`);
		assert.equal(result.code, route, `${state}/${freshness}: code`);
		assert.equal(result.recommendedClassification, "quick-run", `${state}/${freshness}: original classification`);
		assert.equal(result.recommendedRoute, route, `${state}/${freshness}: route`);
		assert.equal(result.selectedRoute, null, `${state}/${freshness}: before gate`);
		assert.equal(result.stage, stage, `${state}/${freshness}: stage`);
		assert.equal(result.mode, mode, `${state}/${freshness}: mode`);
		assert.equal(result.artifacts.length, 1, `${state}/${freshness}: evidence`);
	}
});

test("deduplicates only normatively equivalent local and GitHub spec copies", () => {
	const local = canonicalSpec("approved", "fresh");
	const githubMarkdown = local.markdown
		.replace("issue=#11", "issue=chichex/skills#11")
		.replaceAll("\n", "\r\n")
		.replace(/\r\n$/, "")
		+ [
			"\r\n\r\n<details><summary>Body original</summary>",
			"",
			"Archived transport payload.",
			"",
			"</details>",
			"",
		].join("\r\n");
	const issueCopy = {
		...local,
		id: "issue-copy",
		location: "issue" as const,
		path: "https://github.com/chichex/skills/issues/11",
		hostIssue: issue(11),
		markdown: githubMarkdown,
	};

	const equivalent = resolveWorkflow(resolutionInput({ artifacts: [issueCopy, local] }));
	assert.equal(equivalent.recommendedRoute, "run-existing-spec");
	assert.equal(equivalent.artifacts.length, 2, "both physical references remain as evidence");
	assert.equal(equivalent.artifacts.find(({ id }) => id === local.id)?.primary, true, "local copy is primary");
	assert.equal(equivalent.artifacts.find(({ id }) => id === issueCopy.id)?.primary, false);

	for (const [name, markdown] of [
		["state", githubMarkdown.replace("state=approved", "state=implemented")],
		["prose", githubMarkdown.replace("Body.", "Body changed.")],
	] as const) {
		const conflict = resolveWorkflow(resolutionInput({
			artifacts: [local, { ...issueCopy, id: `issue-${name}`, markdown }],
		}));
		assert.equal(conflict.outcome, "stop", name);
		assert.equal(conflict.code, "artifact-conflict", name);
		assert.equal(conflict.recommendedRoute, "artifact-conflict", name);
		assert.equal(conflict.artifacts.length, 2, name);
	}
});

test("audits safely associated unknown metadata but blocks unsafe or conflicting metadata", () => {
	const legacyUnknown = {
		kind: "markdown" as const,
		id: "legacy-unknown",
		expectedType: "spec" as const,
		location: "local" as const,
		path: "/workspace/skills/.sdd/specs/issue-11-legacy.md",
		markdown: "# Spec — Legacy\n<!-- Status: waiting. Source: issue #11. -->\n",
	};
	const absent = {
		kind: "markdown" as const,
		id: "absent",
		expectedType: "spec" as const,
		location: "local" as const,
		path: "/workspace/skills/.sdd/specs/issue-11-absent.md",
		markdown: "# Spec-shaped notes\n",
	};
	const invalidOnIssue = {
		kind: "markdown" as const,
		id: "invalid-hosted",
		expectedType: "spec" as const,
		location: "issue" as const,
		path: "https://github.com/chichex/skills/issues/11",
		hostIssue: issue(11),
		markdown: "# Spec\n<!-- SDD-Tracking: version=2; type=spec; state=approved; issue=#11; grill=none; superseded-by=none -->\n",
	};

	for (const candidate of [legacyUnknown, absent, invalidOnIssue]) {
		const result = resolveWorkflow(resolutionInput({ artifacts: [candidate] }));
		assert.equal(result.outcome, "start", candidate.id);
		assert.equal(result.code, "audit-existing-spec", candidate.id);
		assert.equal(result.artifacts[0]?.state, "unknown", candidate.id);
		assert.ok(result.artifacts[0]?.diagnostics.length, candidate.id);
	}
	assert.equal(
		resolveWorkflow(resolutionInput({ artifacts: [invalidOnIssue] })).artifacts[0]?.diagnostics[0]?.code,
		"unsupported-version",
	);

	const invalidLocal = { ...invalidOnIssue, id: "invalid-local", location: "local" as const, path: absent.path };
	const unsafe = resolveWorkflow(resolutionInput({ artifacts: [invalidLocal] }));
	assert.equal(unsafe.code, "artifact-conflict");
	assert.equal(unsafe.artifacts[0]?.identityProvenance, "absent");

	const approved = canonicalSpec("approved", "fresh");
	const conflicting = {
		...approved,
		id: "conflicting-markers",
		location: "issue" as const,
		path: "https://github.com/chichex/skills/issues/11",
		hostIssue: issue(11),
		markdown: approved.markdown.replace(
			"<!-- SDD-Tracking:",
			"<!-- SDD-Tracking: version=1; type=spec; state=draft; issue=#11; grill=none; superseded-by=none -->\n<!-- SDD-Tracking:",
		),
	};
	const conflict = resolveWorkflow(resolutionInput({ artifacts: [conflicting] }));
	assert.equal(conflict.code, "artifact-conflict");
	assert.ok(conflict.artifacts[0]?.diagnostics.some(({ code }) => code === "conflicting-canonical"));
});

test("follows one explicit spec lineage and stops on unusable or conflicting graphs", () => {
	const oldPath = `${PROJECT_ROOT}/.sdd/specs/issue-11-old.md`;
	const nextPath = `${PROJECT_ROOT}/.sdd/specs/issue-11-next.md`;
	const old = specAt({
		id: "old",
		path: oldPath,
		state: "superseded",
		supersededBy: ".sdd/specs/issue-11-next.md",
	});
	const next = specAt({ id: "next", path: nextPath, state: "approved", fresh: "fresh" });
	const linear = resolveWorkflow(resolutionInput({ artifacts: [old, next] }));
	assert.equal(linear.code, "run-existing-spec");
	assert.equal(linear.artifacts.find(({ id }) => id === "next")?.primary, true);
	assert.equal(linear.artifacts.find(({ id }) => id === "old")?.primary, false);

	const issueSuccessor = specAt({
		id: "issue-successor",
		path: "https://github.com/chichex/skills/issues/11",
		state: "draft",
		location: "issue",
	});
	const toIssue = specAt({
		id: "to-issue",
		path: oldPath,
		state: "superseded",
		supersededBy: "chichex/skills#11",
	});
	assert.equal(
		resolveWorkflow(resolutionInput({ artifacts: [toIssue, issueSuccessor] })).code,
		"update-existing-spec",
	);

	for (const target of [".sdd/specs/missing.md", "../outside.md", "other/repo#11"]) {
		const unresolved = resolveWorkflow(resolutionInput({
			artifacts: [specAt({ id: `old-${target}`, path: oldPath, state: "superseded", supersededBy: target })],
		}));
		assert.equal(unresolved.outcome, "stop", target);
		assert.equal(unresolved.code, "superseded-artifact", target);
		assert.ok(unresolved.artifacts[0]?.diagnostics.some(({ code }) => code === "superseded-target-unusable"));
	}

	const cycleA = specAt({ id: "cycle-a", path: oldPath, state: "superseded", supersededBy: ".sdd/specs/issue-11-next.md" });
	const cycleB = specAt({ id: "cycle-b", path: nextPath, state: "superseded", supersededBy: ".sdd/specs/issue-11-old.md" });
	const cycle = resolveWorkflow(resolutionInput({ artifacts: [cycleA, cycleB] }));
	assert.equal(cycle.code, "artifact-conflict");
	assert.ok(cycle.artifacts.some(({ diagnostics }) => diagnostics.some(({ code }) => code === "lineage-cycle")));

	const parallel = resolveWorkflow(resolutionInput({
		artifacts: [
			specAt({ id: "parallel-a", path: oldPath, state: "draft" }),
			specAt({ id: "parallel-b", path: nextPath, state: "approved", fresh: "fresh" }),
		],
	}));
	assert.equal(parallel.code, "artifact-conflict");
	assert.ok(parallel.artifacts.every(({ diagnostics }) =>
		diagnostics.some(({ code }) => code === "parallel-live-specs")
	));
});

test("reconciles grill persistence, runtime revisions, and downstream spec precedence", () => {
	const active = resolveWorkflow(resolutionInput({
		artifacts: [grillHandoff("g-active", "paused"), grillSnapshot({ id: "g-active", state: "active" })],
	}));
	assert.equal(active.code, "resume-grill");
	assert.equal(active.stage, "grill");
	assert.equal(active.mode, "resume");
	assert.equal(active.artifacts.find(({ format }) => format === "snapshot")?.primary, true);

	const finalized = resolveWorkflow(resolutionInput({ artifacts: [grillHandoff("g-final", "finalized")] }));
	assert.equal(finalized.code, "spec-from-grill");
	assert.equal(finalized.mode, "from-grill");

	const activeWithoutHandoff = resolveWorkflow(resolutionInput({
		artifacts: [grillSnapshot({ id: "g-live", state: "active" })],
	}));
	assert.equal(activeWithoutHandoff.code, "resume-grill");
	assert.ok(activeWithoutHandoff.artifacts[0]?.diagnostics.some(({ code }) => code === "handoff-unavailable"));

	for (const candidate of [
		grillSnapshot({ id: "g-paused", state: "paused" }),
		grillSnapshot({ id: "g-finalized", state: "finalized" }),
	]) {
		const missing = resolveWorkflow(resolutionInput({ artifacts: [candidate] }));
		assert.equal(missing.code, "artifact-conflict", candidate.id);
		assert.ok(missing.artifacts[0]?.diagnostics.some(({ code }) => code === "missing-persisted-handoff"));
	}

	const disagreement = resolveWorkflow(resolutionInput({
		artifacts: [grillSnapshot({ id: "g-mismatch", state: "paused" }), grillHandoff("g-mismatch", "finalized")],
	}));
	assert.equal(disagreement.code, "artifact-conflict");
	assert.ok(disagreement.artifacts.every(({ diagnostics }) =>
		diagnostics.some(({ code }) => code === "grill-state-mismatch")
	));

	const parent = grillSnapshot({ id: "g-parent", state: "finalized", revision: 1 });
	const parentHandoff = grillHandoff("g-parent", "finalized");
	const child = grillSnapshot({ id: "g-child", state: "active", parentId: "g-parent", revision: 2 });
	const linear = resolveWorkflow(resolutionInput({ artifacts: [parent, parentHandoff, child] }));
	assert.equal(linear.code, "resume-grill");
	assert.equal(linear.artifacts.find(({ id }) => id === child.id)?.primary, true);

	const sibling = grillSnapshot({ id: "g-sibling", state: "active", parentId: "g-parent", revision: 2 });
	const parallel = resolveWorkflow(resolutionInput({ artifacts: [parent, parentHandoff, child, sibling] }));
	assert.equal(parallel.code, "artifact-conflict");
	assert.ok(parallel.artifacts.some(({ diagnostics }) => diagnostics.some(({ code }) => code === "parallel-grill-revisions")));

	const linkedSpec = specAt({
		id: "downstream-spec",
		path: `${PROJECT_ROOT}/.sdd/specs/issue-11-downstream.md`,
		state: "approved",
		fresh: "fresh",
		grill: "g-final",
	});
	const downstream = resolveWorkflow(resolutionInput({
		artifacts: [grillHandoff("g-final", "finalized"), linkedSpec],
	}));
	assert.equal(downstream.code, "run-existing-spec");
	assert.equal(downstream.artifacts.find(({ id }) => id === linkedSpec.id)?.primary, true);

	const unlinked = resolveWorkflow(resolutionInput({
		artifacts: [grillHandoff("g-final", "finalized"), { ...linkedSpec, id: "unlinked", markdown: linkedSpec.markdown.replace("grill=g-final", "grill=none") }],
	}));
	assert.equal(unlinked.code, "artifact-conflict");
	assert.ok(unlinked.artifacts.some(({ diagnostics }) =>
		diagnostics.some(({ code }) => code === "parallel-spec-grill-lineage")
	));
});

test("requires join canonicalization before inspection and uses only canonical issue artifacts", () => {
	let markdownRead = false;
	const poison = {
		kind: "markdown" as const,
		id: "source-poison",
		expectedType: "spec" as const,
		location: "issue" as const,
		path: "https://github.com/chichex/skills/issues/11",
		hostIssue: issue(11),
		get markdown(): string {
			markdownRead = true;
			throw new Error("source artifact must not be inspected before canonicalization");
		},
	};
	const blocked = resolveWorkflow(resolutionInput({
		sources: [issue(11), issue(12)],
		canonicalIssue: null,
		canonicalIssueUsable: false,
		recommendedClassification: "join-spec",
		fallbackClassification: "join-grill",
		artifacts: [poison],
	}));
	assert.equal(markdownRead, false);
	assert.equal(blocked.outcome, "error");
	assert.equal(blocked.code, "canonicalization");
	assert.equal(blocked.recommendedRoute, null);
	assert.equal(blocked.artifacts.length, 0);
	assert.deepEqual(blocked.sources, [issue(11), issue(12)]);

	const sourceSpec = specAt({
		id: "source-implemented",
		path: "https://github.com/chichex/skills/issues/11",
		state: "implemented",
		fresh: "fresh",
		location: "issue",
	});
	const canonicalDraft = {
		...specAt({
			id: "canonical-draft",
			path: "https://github.com/chichex/skills/issues/20",
			state: "draft",
			location: "issue",
		}),
		hostIssue: issue(20),
	};
	canonicalDraft.markdown = canonicalDraft.markdown.replace("issue=#11", "issue=#20");
	const canonical = resolveWorkflow(resolutionInput({
		sources: [issue(11), issue(12)],
		canonicalIssue: issue(20),
		canonicalIssueUsable: true,
		recommendedClassification: "join-spec",
		fallbackClassification: "join-grill",
		artifacts: [sourceSpec, canonicalDraft],
	}));
	assert.equal(canonical.code, "update-existing-spec");
	assert.deepEqual(canonical.canonicalIssue, issue(20));
	assert.deepEqual(canonical.artifacts.map(({ id }) => id), ["canonical-draft"]);
	assert.deepEqual(canonical.sources, [issue(11), issue(12)]);

	const noCanonicalArtifact = resolveWorkflow(resolutionInput({
		sources: [issue(11), issue(12)],
		canonicalIssue: issue(20),
		canonicalIssueUsable: true,
		recommendedClassification: "join-spec",
		fallbackClassification: "join-grill",
		artifacts: [sourceSpec],
	}));
	assert.equal(noCanonicalArtifact.code, "join-spec", "source specs never become fallback artifacts");
	assert.equal(noCanonicalArtifact.artifacts.length, 0);
});

test("keeps recommendation and effective selection independent in serializable v1 results", () => {
	const proposed = resolveWorkflow(resolutionInput());
	const primary = selectWorkflowRoute(proposed, "recommended");
	assert.equal(primary.recommendedRoute, "quick-run");
	assert.equal(primary.selectedRoute, "quick-run");
	assert.equal(primary.code, "quick-run");

	const fallback = selectWorkflowRoute(proposed, "fallback");
	assert.equal(fallback.recommendedClassification, "quick-run");
	assert.equal(fallback.fallbackClassification, "spec");
	assert.equal(fallback.recommendedRoute, "quick-run");
	assert.equal(fallback.selectedRoute, "spec");
	assert.equal(fallback.code, "spec");
	assert.equal(fallback.stage, "spec");
	assert.equal(fallback.mode, "new");
	assert.equal(proposed.selectedRoute, null, "selection does not mutate the proposal");

	const cancelled = selectWorkflowRoute(proposed, "cancel");
	assert.equal(cancelled.outcome, "stop");
	assert.equal(cancelled.code, "cancelled");
	assert.equal(cancelled.selectedRoute, null);
	assert.equal(cancelled.recommendedRoute, "quick-run");

	for (const protectedResult of [
		resolveWorkflow(resolutionInput({ artifacts: [canonicalSpec("implemented", "fresh")] })),
		resolveWorkflow(resolutionInput({ artifacts: [canonicalSpec("draft", "unknown")] })),
	]) {
		const attemptedFallback = selectWorkflowRoute(protectedResult, "fallback");
		assert.notEqual(attemptedFallback.selectedRoute, "quick-run");
		assert.notEqual(attemptedFallback.code, "run-existing-spec");
	}

	for (const result of [primary, fallback, cancelled, resolveWorkflow(resolutionInput({ artifacts: [canonicalSpec("approved", "fresh")] }))]) {
		assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
		assert.equal(result.version, 1);
		assert.equal(typeof result.code, "string");
	}
});
