import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSddArtifact } from "./index.ts";
import {
	persistSpecPublication,
	validateSpecPublication,
	type SpecPublicationPorts,
} from "./spec-publication.ts";

function canonicalSpec(options: {
	state?: "approved" | "draft" | "superseded";
	issue?: string;
	grill?: string;
	supersededBy?: string;
} = {}): string {
	const state = options.state ?? "approved";
	const issue = options.issue ?? "#33";
	const grill = options.grill ?? "session%2033%2F%C3%A1";
	const supersededBy = options.supersededBy ?? "none";
	return [
		"# Spec — Canonical publication",
		`<!-- Generada por /skill:sdd-spec. Estado: ${state === "approved" ? "aprobada" : state} -->`,
		`<!-- SDD-Tracking: version=1; type=spec; state=${state}; issue=${issue}; grill=${grill}; superseded-by=${supersededBy} -->`,
		"",
		"## Contexto",
		"Body.",
		"",
	].join("\n");
}

test("accepts one canonical interactive spec with semantic issue identity and exact decoded grill", () => {
	const result = validateSpecPublication(canonicalSpec(), {
		mode: "interactive",
		repository: "chichex/skills",
		issue: { repository: "chichex/skills", number: 33 },
		grill: "session 33/á",
		supersededBy: null,
	});

	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.metadata.state, "approved");
		assert.equal(result.metadata.issue, "#33");
		assert.equal(result.metadata.grill, "session 33/á");
	}
});

test("accepts draft only in assume mode and rejects every malformed or mismatched identity with typed diagnostics", () => {
	assert.equal(validateSpecPublication(canonicalSpec({ state: "draft" }), {
		mode: "assume",
		repository: "chichex/skills",
		issue: { repository: "chichex/skills", number: 33 },
		grill: "session 33/á",
		supersededBy: null,
	}).ok, true);

	const approved = canonicalSpec();
	const marker = approved.split("\n")[2]!;
	const invalidCases = [
		{
			name: "invalid state",
			markdown: approved.replace("state=approved", "state=specified"),
			code: "invalid-state",
		},
		{
			name: "wrong issue",
			markdown: approved.replace("issue=#33", "issue=#34"),
			code: "issue-mismatch",
		},
		{
			name: "wrong grill",
			markdown: approved.replace("grill=session%2033%2F%C3%A1", "grill=other"),
			code: "grill-mismatch",
		},
		{
			name: "duplicate marker",
			markdown: approved.replace(marker, `${marker}\n${marker}`),
			code: "duplicate-canonical",
		},
		{
			name: "conflicting metadata",
			markdown: approved.replace(marker, `${marker}\n${marker.replace("state=approved", "state=draft")}`),
			code: "conflicting-canonical",
		},
	] as const;

	for (const fixture of invalidCases) {
		const result = validateSpecPublication(fixture.markdown, {
			mode: "interactive",
			repository: "chichex/skills",
			issue: { repository: "chichex/skills", number: 33 },
			grill: "session 33/á",
			supersededBy: null,
		});
		assert.equal(result.ok, false, fixture.name);
		if (!result.ok) {
			assert.ok(result.diagnostics.some(({ code }) => code === fixture.code), fixture.name);
		}
	}
});

test("persists a valid local spec, rereads it, and returns a receipt only after the postcheck", async () => {
	const path = "/workspace/skills/.sdd/specs/issue-33.md";
	const markdown = canonicalSpec();
	const stored = new Map<string, string>();
	const calls: string[] = [];
	const ports: SpecPublicationPorts = {
		async writeLocal(target, content) {
			calls.push(`write:${target}`);
			stored.set(target, content);
		},
		async readLocal(target) {
			calls.push(`read:${target}`);
			return stored.get(target) ?? "";
		},
		async writeIssue() { throw new Error("unexpected issue write"); },
		async readIssue() { throw new Error("unexpected issue read"); },
		async createIssue() { throw new Error("unexpected issue create"); },
	};

	const result = await persistSpecPublication({
		documents: [{
			id: "successor",
			markdown,
			expectation: {
				mode: "interactive",
				repository: "chichex/skills",
				issue: { repository: "chichex/skills", number: 33 },
				grill: "session 33/á",
				supersededBy: null,
			},
			destinations: [{ kind: "local", path }],
		}],
	}, ports);

	assert.equal(result.ok, true);
	assert.deepEqual(calls, [`write:${path}`, `read:${path}`]);
	if (result.ok) {
		assert.equal(result.receipt.version, 1);
		assert.equal(result.receipt.documents[0]?.id, "successor");
		assert.deepEqual(result.receipt.documents[0]?.destinations, [`local:${path}`]);
	}
});

test("persists a canonical draft and returns a receipt in assume mode", async () => {
	const markdown = canonicalSpec({ state: "draft", grill: "none" });
	let stored = "";
	const result = await persistSpecPublication({
		documents: [{
			id: "successor",
			markdown,
			expectation: {
				mode: "assume",
				repository: "chichex/skills",
				issue: { repository: "chichex/skills", number: 33 },
				grill: null,
				supersededBy: null,
			},
			destinations: [{ kind: "local", path: "/workspace/draft.md" }],
		}],
	}, {
		async writeLocal(_path, content) { stored = content; },
		async readLocal() { return stored; },
		async writeIssue() { throw new Error("unexpected issue write"); },
		async readIssue() { throw new Error("unexpected issue read"); },
		async createIssue() { throw new Error("unexpected issue create"); },
	});
	assert.equal(result.ok, true);
	assert.equal(stored, markdown);
});

test("rejects every invalid metadata case before invoking a mutation port and never returns a receipt", async () => {
	let mutations = 0;
	const ports: SpecPublicationPorts = {
		async writeLocal() { mutations += 1; },
		async readLocal() { return ""; },
		async writeIssue() { mutations += 1; },
		async readIssue() { return ""; },
		async createIssue() { mutations += 1; return { repository: "chichex/skills", number: 99 }; },
	};
	const approved = canonicalSpec();
	const marker = approved.split("\n")[2]!;
	const fixtures = [
		approved.replace("state=approved", "state=specified"),
		approved.replace("issue=#33", "issue=#34"),
		approved.replace("grill=session%2033%2F%C3%A1", "grill=other"),
		approved.replace(marker, `${marker}\n${marker}`),
		approved.replace(marker, `${marker}\n${marker.replace("state=approved", "state=draft")}`),
	];

	for (const markdown of fixtures) {
		const result = await persistSpecPublication({
			documents: [{
				id: "invalid-successor",
				markdown,
				expectation: {
					mode: "interactive",
					repository: "chichex/skills",
					issue: { repository: "chichex/skills", number: 33 },
					grill: "session 33/á",
					supersededBy: null,
				},
				destinations: [{ kind: "local", path: "/workspace/spec.md" }],
			}],
		}, ports);
		assert.equal(result.ok, false);
		assert.equal("receipt" in result, false);
	}
	assert.equal(mutations, 0);
});

test("persists an existing issue spec and requires an independent reread before issuing the receipt", async () => {
	const issue = { repository: "chichex/skills", number: 33 };
	const markdown = canonicalSpec({ issue: "chichex/skills#33" });
	let body = "";
	const calls: string[] = [];
	const ports: SpecPublicationPorts = {
		async writeLocal() { throw new Error("unexpected local write"); },
		async readLocal() { throw new Error("unexpected local read"); },
		async writeIssue(target, content) {
			calls.push(`write:${target.repository}#${target.number}`);
			body = content;
		},
		async readIssue(target) {
			calls.push(`read:${target.repository}#${target.number}`);
			return body;
		},
		async createIssue() { throw new Error("unexpected issue create"); },
	};
	const result = await persistSpecPublication({
		documents: [{
			id: "successor",
			markdown,
			expectation: {
				mode: "interactive",
				repository: "chichex/skills",
				issue,
				grill: "session 33/á",
				supersededBy: null,
			},
			destinations: [{ kind: "issue", issue }],
		}],
	}, ports);

	assert.equal(result.ok, true);
	assert.deepEqual(calls, ["write:chichex/skills#33", "read:chichex/skills#33"]);
	if (result.ok) assert.deepEqual(result.receipt.documents[0]?.destinations, ["issue:chichex/skills#33"]);
});

test("blocks an Ambos receipt when reread copies diverge beyond the shared transport normalizations", async () => {
	const issue = { repository: "chichex/skills", number: 33 };
	const localPath = "/workspace/skills/.sdd/specs/issue-33.md";
	const markdown = canonicalSpec();
	const localBodies = new Map<string, string>();
	let issueBody = "";
	let tamperIssue = false;
	const ports: SpecPublicationPorts = {
		async writeLocal(path, content) { localBodies.set(path, content); },
		async readLocal(path) { return localBodies.get(path) ?? ""; },
		async writeIssue(_target, content) {
			issueBody = content
				.replace("issue=#33", "issue=chichex/skills#33")
				.replace(/\n$/, "")
				+ "\n\n<details><summary>Body original</summary>\n\nArchived source.\n\n</details>\n";
		},
		async readIssue() {
			return tamperIssue ? issueBody.replace("Body.", "Body changed.") : issueBody;
		},
		async createIssue() { throw new Error("unexpected issue create"); },
	};
	const input = {
		documents: [{
			id: "successor",
			markdown,
			expectation: {
				mode: "interactive" as const,
				repository: "chichex/skills",
				issue,
				grill: "session 33/á",
				supersededBy: null,
			},
			destinations: [
				{ kind: "local" as const, path: localPath },
				{ kind: "issue" as const, issue },
			],
		}],
	};

	const equivalent = await persistSpecPublication(input, ports);
	assert.equal(equivalent.ok, true, "known transport differences are equivalent");

	tamperIssue = true;
	const divergent = await persistSpecPublication(input, ports);
	assert.equal(divergent.ok, false);
	assert.equal("receipt" in divergent, false);
	if (!divergent.ok) {
		assert.ok(divergent.diagnostics.some(({ code, stage }) => code === "copy-divergence" && stage === "comparison"));
		assert.deepEqual(
			divergent.outcomes.map(({ written, verified }) => ({ written, verified })),
			[{ written: true, verified: true }, { written: true, verified: true }],
			"both successful writes remain visible for an idempotent retry",
		);
	}
});

test("creates a non-SDD staging issue before publishing and rereading the identity-bound spec", async () => {
	const initial = canonicalSpec({ issue: "none" });
	const createdIssue = { repository: "chichex/skills", number: 88 };
	let published = "";
	let staging = "";
	const ports: SpecPublicationPorts = {
		async writeLocal() { throw new Error("unexpected local write"); },
		async readLocal() { throw new Error("unexpected local read"); },
		async createIssue(repository, title, stagingBody) {
			assert.equal(repository, "chichex/skills");
			assert.equal(title, "Canonical publication");
			staging = stagingBody;
			return createdIssue;
		},
		async writeIssue(issue, markdown) {
			assert.deepEqual(issue, createdIssue);
			published = markdown;
		},
		async readIssue(issue) {
			assert.deepEqual(issue, createdIssue);
			return published;
		},
	};

	const result = await persistSpecPublication({
		documents: [{
			id: "successor",
			markdown: initial,
			expectation: {
				mode: "interactive",
				repository: "chichex/skills",
				issue: null,
				grill: "session 33/á",
				supersededBy: null,
			},
			destinations: [{
				kind: "new-issue",
				repository: "chichex/skills",
				title: "Canonical publication",
			}],
		}],
	}, ports);

	assert.equal(parseSddArtifact(staging).kind, "absent", "the creation body is not an SDD artifact");
	const parsedPublished = parseSddArtifact(published);
	assert.equal(parsedPublished.kind, "metadata");
	assert.equal(
		parsedPublished.kind === "metadata" && parsedPublished.metadata.type === "spec"
			? parsedPublished.metadata.issue
			: undefined,
		"#88",
	);
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.deepEqual(result.receipt.documents[0]?.destinations, ["issue:chichex/skills#88"]);
	}
});

test("reports a staged issue after update failure and retries it as the same existing issue", async () => {
	const createdIssue = { repository: "chichex/skills", number: 89 };
	let attemptedBody = "";
	let remoteBody = "";
	let failUpdate = true;
	let creates = 0;
	const ports: SpecPublicationPorts = {
		async writeLocal() { throw new Error("unexpected local write"); },
		async readLocal() { throw new Error("unexpected local read"); },
		async createIssue() { creates += 1; return createdIssue; },
		async writeIssue(_issue, markdown) {
			attemptedBody = markdown;
			if (failUpdate) throw new Error("simulated update failure");
			remoteBody = markdown;
		},
		async readIssue() { return remoteBody; },
	};
	const result = await persistSpecPublication({
		documents: [{
			id: "successor",
			markdown: canonicalSpec({ issue: "none", grill: "none" }),
			expectation: {
				mode: "interactive",
				repository: "chichex/skills",
				issue: null,
				grill: null,
				supersededBy: null,
			},
			destinations: [{ kind: "new-issue", repository: "chichex/skills", title: "Staged" }],
		}],
	}, ports);

	assert.equal(result.ok, false);
	assert.equal("receipt" in result, false);
	assert.notEqual(attemptedBody, "");
	const parsed = parseSddArtifact(attemptedBody);
	assert.equal(
		parsed.kind === "metadata" && parsed.metadata.type === "spec" ? parsed.metadata.issue : undefined,
		"#89",
		"the attempted update is already bound to the created identity",
	);
	if (!result.ok) {
		assert.deepEqual(result.createdIssues, [createdIssue]);
		assert.ok(result.diagnostics.some(({ code, stage }) => code === "persistence-failed" && stage === "write"));
	}

	failUpdate = false;
	const retry = await persistSpecPublication({
		documents: [{
			id: "successor",
			markdown: attemptedBody,
			expectation: {
				mode: "interactive",
				repository: "chichex/skills",
				issue: createdIssue,
				grill: null,
				supersededBy: null,
			},
			destinations: [{ kind: "issue", issue: createdIssue }],
		}],
	}, ports);
	assert.equal(retry.ok, true);
	assert.equal(creates, 1, "retry reuses the diagnosed staged issue instead of creating another");
});

test("fails closed when a destination reread tampers with state, issue, or grill after a successful write", async () => {
	const markdown = canonicalSpec();
	const tamperedCopies = [
		{ markdown: markdown.replace("state=approved", "state=implemented"), code: "state-mismatch" },
		{ markdown: markdown.replace("issue=#33", "issue=#34"), code: "issue-mismatch" },
		{ markdown: markdown.replace("grill=session%2033%2F%C3%A1", "grill=other"), code: "grill-mismatch" },
	];
	let writes = 0;
	for (const tampered of tamperedCopies) {
		const result = await persistSpecPublication({
			documents: [{
				id: "successor",
				markdown,
				expectation: {
					mode: "interactive",
					repository: "chichex/skills",
					issue: { repository: "chichex/skills", number: 33 },
					grill: "session 33/á",
					supersededBy: null,
				},
				destinations: [{ kind: "local", path: "/workspace/spec.md" }],
			}],
		}, {
			async writeLocal() { writes += 1; },
			async readLocal() { return tampered.markdown; },
			async writeIssue() { throw new Error("unexpected issue write"); },
			async readIssue() { throw new Error("unexpected issue read"); },
			async createIssue() { throw new Error("unexpected issue create"); },
		});

		assert.equal(result.ok, false);
		assert.equal("receipt" in result, false);
		if (!result.ok) {
			assert.ok(result.diagnostics.some(({ code, stage }) => code === tampered.code && stage === "postcheck"));
			assert.deepEqual(result.outcomes, [{
				documentId: "successor",
				destination: "local:/workspace/spec.md",
				written: true,
				verified: false,
			}]);
		}
	}
	assert.equal(writes, 3);
});

test("preserves a successful half of Ambos and an idempotent retry converges without duplicate files or markers", async () => {
	const issue = { repository: "chichex/skills", number: 33 };
	const localPath = "/workspace/skills/.sdd/specs/issue-33.md";
	const markdown = canonicalSpec();
	const local = new Map<string, string>();
	let remote = "";
	let failRemote = true;
	const ports: SpecPublicationPorts = {
		async writeLocal(path, content) { local.set(path, content); },
		async readLocal(path) { return local.get(path) ?? ""; },
		async writeIssue(_target, content) {
			if (failRemote) throw new Error("simulated GitHub outage");
			remote = content;
		},
		async readIssue() { return remote; },
		async createIssue() { throw new Error("unexpected issue create"); },
	};
	const input = {
		documents: [{
			id: "successor",
			markdown,
			expectation: {
				mode: "interactive" as const,
				repository: "chichex/skills",
				issue,
				grill: "session 33/á",
				supersededBy: null,
			},
			destinations: [
				{ kind: "local" as const, path: localPath },
				{ kind: "issue" as const, issue },
			],
		}],
	};

	const partial = await persistSpecPublication(input, ports);
	assert.equal(partial.ok, false);
	if (!partial.ok) {
		assert.deepEqual(
			partial.outcomes.map(({ written, verified }) => ({ written, verified })),
			[{ written: true, verified: true }, { written: false, verified: false }],
		);
	}
	failRemote = false;
	const retry = await persistSpecPublication(input, ports);
	assert.equal(retry.ok, true);
	assert.equal(local.size, 1);
	assert.equal(local.get(localPath)?.match(/SDD-Tracking/g)?.length, 1);
});

test("validates successor and superseded predecessor as one all-or-nothing receipt", async () => {
	const issue = { repository: "chichex/skills", number: 33 };
	const successorPath = "/workspace/skills/.sdd/specs/issue-33-next.md";
	const predecessorPath = "/workspace/skills/.sdd/specs/issue-33-old.md";
	const successor = canonicalSpec({ grill: "none" });
	const predecessor = canonicalSpec({
		state: "superseded",
		grill: "none",
		supersededBy: ".sdd%2Fspecs%2Fissue-33-next.md",
	});
	const stored = new Map<string, string>([[predecessorPath, canonicalSpec({ grill: "none" })]]);
	let writes = 0;
	const ports: SpecPublicationPorts = {
		async writeLocal(path, content) { writes += 1; stored.set(path, content); },
		async readLocal(path) { return stored.get(path) ?? ""; },
		async writeIssue() { throw new Error("unexpected issue write"); },
		async readIssue() { throw new Error("unexpected issue read"); },
		async createIssue() { throw new Error("unexpected issue create"); },
	};
	const documents = [
		{
			id: "successor",
			role: "successor" as const,
			markdown: successor,
			expectation: {
				mode: "interactive" as const,
				repository: "chichex/skills",
				issue,
				grill: null,
				supersededBy: null,
			},
			destinations: [{ kind: "local" as const, path: successorPath }],
		},
		{
			id: "predecessor",
			role: "predecessor" as const,
			markdown: predecessor,
			expectation: {
				mode: "interactive" as const,
				repository: "chichex/skills",
				issue,
				grill: null,
				state: "superseded" as const,
				supersededBy: ".sdd/specs/issue-33-next.md",
			},
			destinations: [{ kind: "local" as const, path: predecessorPath }],
		},
	];

	const result = await persistSpecPublication({ documents }, ports);
	assert.equal(result.ok, true);
	if (result.ok) assert.deepEqual(result.receipt.documents.map(({ id }) => id), ["successor", "predecessor"]);

	writes = 0;
	const invalid = await persistSpecPublication({
		documents: documents.map((document) => document.id === "predecessor"
			? { ...document, markdown: document.markdown.replace("issue=#33", "issue=#34") }
			: document),
	}, ports);
	assert.equal(invalid.ok, false);
	assert.equal(writes, 0, "all prechecks complete before any lifecycle mutation");
});

test("refuses a superseded-by pointer that does not identify any successor destination", async () => {
	const predecessorPath = "/workspace/skills/.sdd/specs/old.md";
	const successorPath = "/workspace/skills/.sdd/specs/next.md";
	let writes = 0;
	const result = await persistSpecPublication({
		documents: [
			{
				id: "successor",
				role: "successor",
				markdown: canonicalSpec({ grill: "none" }),
				expectation: {
					mode: "interactive",
					repository: "chichex/skills",
					issue: { repository: "chichex/skills", number: 33 },
					grill: null,
					supersededBy: null,
				},
				destinations: [{ kind: "local", path: successorPath }],
			},
			{
				id: "predecessor",
				role: "predecessor",
				markdown: canonicalSpec({ state: "superseded", grill: "none", supersededBy: "other.md" }),
				expectation: {
					mode: "interactive",
					repository: "chichex/skills",
					issue: { repository: "chichex/skills", number: 33 },
					grill: null,
					state: "superseded",
					supersededBy: "other.md",
				},
				destinations: [{ kind: "local", path: predecessorPath }],
			},
		],
	}, {
		async writeLocal() { writes += 1; },
		async readLocal(path) {
			return path === predecessorPath ? canonicalSpec({ grill: "none" }) : "";
		},
		async writeIssue() { writes += 1; },
		async readIssue() { return ""; },
		async createIssue() { writes += 1; return { repository: "chichex/skills", number: 99 }; },
	});

	assert.equal(result.ok, false);
	assert.equal(writes, 0);
	if (!result.ok) assert.ok(result.diagnostics.some(({ code }) => code === "predecessor-target-mismatch"));
});

test("refuses to rewrite a predecessor when its persisted identity would not be preserved", async () => {
	const oldPath = "/workspace/skills/.sdd/specs/old.md";
	const nextPath = "/workspace/skills/.sdd/specs/next.md";
	const persistedOld = canonicalSpec({ issue: "#33", grill: "none" });
	const successor = canonicalSpec({ issue: "#34", grill: "none" });
	const rewrittenOld = canonicalSpec({
		state: "superseded",
		issue: "#34",
		grill: "none",
		supersededBy: ".sdd%2Fspecs%2Fnext.md",
	});
	let writes = 0;
	const result = await persistSpecPublication({
		documents: [
			{
				id: "successor",
				role: "successor",
				markdown: successor,
				expectation: {
					mode: "interactive",
					repository: "chichex/skills",
					issue: { repository: "chichex/skills", number: 34 },
					grill: null,
					supersededBy: null,
				},
				destinations: [{ kind: "local", path: nextPath }],
			},
			{
				id: "predecessor",
				role: "predecessor",
				markdown: rewrittenOld,
				expectation: {
					mode: "interactive",
					repository: "chichex/skills",
					issue: { repository: "chichex/skills", number: 34 },
					grill: null,
					state: "superseded",
					supersededBy: ".sdd/specs/next.md",
				},
				destinations: [{ kind: "local", path: oldPath }],
			},
		],
	}, {
		async writeLocal() { writes += 1; },
		async readLocal(path) { return path === oldPath ? persistedOld : successor; },
		async writeIssue() { writes += 1; },
		async readIssue() { return ""; },
		async createIssue() { writes += 1; return { repository: "chichex/skills", number: 99 }; },
	});

	assert.equal(result.ok, false);
	assert.equal(writes, 0);
	if (!result.ok) {
		assert.ok(result.diagnostics.some(({ code, stage }) => code === "issue-mismatch" && stage === "precheck"));
	}
});

test("rejects an issue destination whose host identity differs from the validated spec before mutation", async () => {
	let writes = 0;
	const result = await persistSpecPublication({
		documents: [{
			id: "successor",
			markdown: canonicalSpec(),
			expectation: {
				mode: "interactive",
				repository: "chichex/skills",
				issue: { repository: "chichex/skills", number: 33 },
				grill: "session 33/á",
				supersededBy: null,
			},
			destinations: [{
				kind: "issue",
				issue: { repository: "chichex/skills", number: 34 },
			}],
		}],
	}, {
		async writeLocal() { writes += 1; },
		async readLocal() { return ""; },
		async writeIssue() { writes += 1; },
		async readIssue() { return ""; },
		async createIssue() { writes += 1; return { repository: "chichex/skills", number: 34 }; },
	});

	assert.equal(result.ok, false);
	assert.equal(writes, 0);
	if (!result.ok) assert.ok(result.diagnostics.some(({ code }) => code === "destination-identity-mismatch"));
});
