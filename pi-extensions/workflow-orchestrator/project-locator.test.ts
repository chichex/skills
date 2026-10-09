import assert from "node:assert/strict";
import { test } from "node:test";

import * as orchestrator from "./index.ts";

test("GitHub remote parsing accepts canonical transports and rejects lookalike hosts", () => {
	for (const remote of [
		"git@github.com:pramaestudio/brik.git",
		"ssh://git@github.com/pramaestudio/brik.git",
		"https://github.com/pramaestudio/brik.git",
	]) {
		assert.equal(orchestrator.repositoryFromGitHubRemote(remote), "pramaestudio/brik");
	}
	for (const remote of [
		"https://notgithub.com/pramaestudio/brik.git",
		"https://example.test/github.com/pramaestudio/brik.git",
		"file:///github.com/pramaestudio/brik.git",
	]) {
		assert.equal(orchestrator.repositoryFromGitHubRemote(remote), null);
	}
});

test("known-project resolution maps a remembered linked worktree to the repository's primary checkout", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).resolveKnownRepositoryRoot, "function");
	const result = await orchestrator.resolveKnownRepositoryRoot(
		"/workspace/skills",
		"pramaestudio/brik",
		{
			listKnownCwds: async () => [
				"/workspace/skills",
				"/workspace/brik-sdd-feature/packages/mobile",
				"/workspace/brik",
			],
			resolveGitRoot: async (cwd: string) => cwd.includes("brik-sdd-feature")
				? "/workspace/brik-sdd-feature"
				: cwd.includes("brik") ? "/workspace/brik" : "/workspace/skills",
			resolvePrimaryWorktree: async (root: string) => root === "/workspace/brik-sdd-feature"
				? "/workspace/brik"
				: root,
			resolveRepository: async (root: string) => root === "/workspace/brik"
				? "pramaestudio/brik"
				: "chichex/skills",
			realpath: async (path: string) => path,
		},
	);

	assert.deepEqual(result, { ok: true, root: "/workspace/brik" });
});

test("known-project resolution fails closed when independent clones are ambiguous", async () => {
	const roots = ["/clone-a/brik", "/clone-b/brik"];
	const result = await orchestrator.resolveKnownRepositoryRoot(
		"/workspace/skills",
		"pramaestudio/brik",
		{
			listKnownCwds: async () => roots,
			resolveGitRoot: async (cwd: string) => cwd,
			resolvePrimaryWorktree: async (root: string) => root,
			resolveRepository: async (root: string) => root === "/workspace/skills"
				? "chichex/skills"
				: "pramaestudio/brik",
			realpath: async (path: string) => path,
		},
	);

	assert.deepEqual(result, { ok: false, code: "ambiguous-project", roots });
});
