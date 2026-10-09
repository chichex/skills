import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import * as orchestrator from "./index.ts";

function fakeStripFrontmatter(content: string): string {
	const end = content.indexOf("\n---", 3);
	return end === -1 ? content : content.slice(end + 4).trim();
}

function grillRequest(cwd: string) {
	return {
		version: 1,
		kind: "grill",
		repo: "pramaestudio/brik",
		cwd,
		target: {
			type: "issue",
			canonicalReference: "pramaestudio/brik#114",
			issue: { repository: "pramaestudio/brik", number: 114 },
		},
		summary: "Grill pramaestudio/brik#114 before specification.",
		evidence: [{ kind: "issue", reference: "pramaestudio/brik#114", detail: "Canonical GitHub issue (OPEN)" }],
	};
}

test("DirectGrillRequestV1 accepts only exact issue launch payloads", () => {
	const valid = grillRequest("/workspace/brik");
	assert.equal(orchestrator.validateDirectGrillRequest(valid).ok, true);
	assert.equal(orchestrator.validateDirectGrillRequest({ ...valid, extra: true }).ok, false);
	assert.equal(orchestrator.validateDirectGrillRequest({ ...valid, kind: "sdd-run" }).ok, false);
	assert.equal(orchestrator.validateDirectGrillRequest({
		...valid,
		target: { type: "spec", canonicalReference: ".sdd/specs/demo.md", issue: null, path: "/workspace/brik/.sdd/specs/demo.md" },
	}).ok, false);
});

test("direct Grill resolves a cross-repository GitHub issue URL to its known local checkout", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).resolveDirectGrillRequest, "function");
	const temporary = await mkdtemp(join(tmpdir(), "direct-grill-url-"));
	try {
		const origin = await realpath(temporary);
		const target = join(origin, "brik");
		await mkdir(target);
		const result = await orchestrator.resolveDirectGrillRequest(
			"https://github.com/pramaestudio/brik/issues/114",
			origin,
			{
				resolveGitRoot: async (path: string) => path.startsWith(target) ? target : origin,
				resolveRepository: async (root: string) => root === target ? "pramaestudio/brik" : "chichex/skills",
				resolveRepositoryRoot: async () => ({ ok: true, root: target }),
				resolveIssue: async (_root: string, repository: string, number: number) => ({
					number,
					url: `https://github.com/${repository}/issues/${number}`,
					state: "OPEN",
					body: "# Product idea\n",
				}),
			},
		);

		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.request, {
				version: 1,
				kind: "grill",
				repo: "pramaestudio/brik",
				cwd: target,
				target: {
					type: "issue",
					canonicalReference: "pramaestudio/brik#114",
					issue: { repository: "pramaestudio/brik", number: 114 },
				},
				summary: "Grill pramaestudio/brik#114 before specification.",
				evidence: [{
					kind: "issue",
					reference: "pramaestudio/brik#114",
					detail: "Canonical GitHub issue (OPEN)",
				}],
			});
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("direct Grill preserves local #NN semantics and accepts owner/repo#NN", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "direct-grill-references-"));
	try {
		const origin = await realpath(temporary);
		const target = join(origin, "brik");
		await mkdir(target);
		let repositoryLookups = 0;
		const dependencies = {
			resolveGitRoot: async (path: string) => path.startsWith(target) ? target : origin,
			resolveRepository: async (root: string) => root === target ? "pramaestudio/brik" : "chichex/skills",
			resolveRepositoryRoot: async () => {
				repositoryLookups += 1;
				return { ok: true as const, root: target };
			},
			resolveIssue: async (_root: string, repository: string, number: number) => ({
				number,
				url: `https://github.com/${repository}/issues/${number}`,
				state: "OPEN",
				body: "# Product idea\n",
			}),
		};
		const local = await orchestrator.resolveDirectGrillRequest("#114", origin, dependencies);
		assert.equal(local.ok, true);
		if (local.ok) {
			assert.equal(local.request.repo, "chichex/skills");
			assert.equal(local.request.cwd, origin);
			assert.equal(local.request.target.canonicalReference, "chichex/skills#114");
		}
		assert.equal(repositoryLookups, 0);

		const qualified = await orchestrator.resolveDirectGrillRequest("pramaestudio/brik#114", origin, dependencies);
		assert.equal(qualified.ok, true);
		if (qualified.ok) {
			assert.equal(qualified.request.repo, "pramaestudio/brik");
			assert.equal(qualified.request.cwd, target);
			assert.equal(qualified.request.target.canonicalReference, "pramaestudio/brik#114");
		}
		assert.equal(repositoryLookups, 1);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("direct Grill reports missing and ambiguous destination checkouts before issue lookup", async () => {
	let issueLookups = 0;
	const base = {
		resolveGitRoot: async () => "/workspace/skills",
		resolveRepository: async () => "chichex/skills",
		realpath: async (path: string) => path,
		resolveIssue: async () => {
			issueLookups += 1;
			throw new Error("must not fetch an issue without one destination");
		},
	};
	const missing = await orchestrator.resolveDirectGrillRequest("pramaestudio/brik#114", "/workspace/skills", {
		...base,
		resolveRepositoryRoot: async () => ({ ok: false, code: "project-not-found", roots: [] }),
	});
	assert.equal(missing.ok, false);
	if (!missing.ok) {
		assert.equal(missing.code, "unresolved-project");
		assert.match(missing.message, /Open Pi once from that repository checkout/);
	}
	const ambiguous = await orchestrator.resolveDirectGrillRequest("pramaestudio/brik#114", "/workspace/skills", {
		...base,
		resolveRepositoryRoot: async () => ({
			ok: false,
			code: "ambiguous-project",
			roots: ["/clone-a/brik", "/clone-b/brik"],
		}),
	});
	assert.equal(ambiguous.ok, false);
	if (!ambiguous.ok) {
		assert.equal(ambiguous.code, "unresolved-project");
		assert.match(ambiguous.message, /\/clone-a\/brik, \/clone-b\/brik/);
	}
	assert.equal(issueLookups, 0);
});

test("direct Grill starts a linked child with the canonical skill and strict launch envelope", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "direct-grill-child-"));
	try {
		const project = await realpath(temporary);
		const sessionDirectory = join(project, "sessions");
		const originFile = join(sessionDirectory, "origin.jsonl");
		const childFile = join(sessionDirectory, "child.jsonl");
		const skillPath = join(project, "skills", "grill", "SKILL.md");
		await mkdir(dirname(skillPath), { recursive: true });
		await mkdir(sessionDirectory, { recursive: true });
		await writeFile(skillPath, "---\nname: grill\ndescription: Grill\n---\n# Grill\n", "utf8");
		await writeFile(originFile, "{}\n", "utf8");
		const request = grillRequest(project);
		let kickoff = "";
		let sessionName = "";
		const context = {
			cwd: project,
			sessionManager: {
				getCwd: () => project,
				getSessionId: () => "origin-id",
				getSessionFile: () => originFile,
				getSessionDir: () => sessionDirectory,
			},
			async newSession(options: {
				parentSession: string;
				setup: (manager: { appendSessionInfo(name: string): string }) => Promise<void>;
				withSession: (replacement: unknown) => Promise<void>;
			}) {
				await options.setup({ appendSessionInfo(name: string) { sessionName = name; return "info"; } });
				await options.withSession({
					cwd: project,
					sessionManager: {
						getCwd: () => project,
						getSessionId: () => "child-id",
						getSessionFile: () => childFile,
					},
					getSystemPromptOptions: () => ({
						cwd: project,
						contextFiles: [],
						skills: [{
							name: "grill",
							description: "Grill",
							filePath: skillPath,
							sourceInfo: { path: skillPath, scope: "temporary" },
						}],
					}),
					async sendUserMessage(message: string) { kickoff = message; },
				});
				return { cancelled: false };
			},
			async switchSession() { throw new Error("same-project launch must use newSession"); },
		};

		const result = await orchestrator.startDirectGrill(request, context as never, {
			commands: [{ name: "skill:grill", source: "skill", sourceInfo: { path: skillPath } }],
			stripSkillFrontmatter: fakeStripFrontmatter,
			resolveGitRoot: async () => project,
		});
		assert.equal(result.ok, true);
		assert.equal(sessionName, "Grill · pramaestudio/brik#114");
		assert.match(kickoff, /<skill name="grill"/);
		const envelope = kickoff.match(/<workflow-launch version="1">\n([\s\S]+)\n<\/workflow-launch>$/)?.[1];
		assert.ok(envelope);
		assert.deepEqual(JSON.parse(envelope), request);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
