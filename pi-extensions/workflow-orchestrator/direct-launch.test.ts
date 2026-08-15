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

function evidence() {
	return [{ kind: "artifact", reference: ".sdd/specs/local.md", detail: "Canonical SDD spec" }];
}

function issueRequest() {
	return {
		version: 1,
		kind: "sdd-run",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		target: {
			type: "issue",
			canonicalReference: "chichex/skills#14",
			issue: { repository: "chichex/skills", number: 14 },
		},
		summary: "Run the SDD spec stored in issue #14.",
		evidence: evidence(),
	};
}

function specRequest() {
	return {
		version: 1,
		kind: "sdd-run",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		target: {
			type: "spec",
			canonicalReference: "chichex/skills:.sdd/specs/local.md",
			path: "/workspace/skills/.sdd/specs/local.md",
			issue: null,
		},
		summary: "Run local.md without inventing a GitHub issue.",
		evidence: evidence(),
	};
}

test("direct run request v1 strictly validates issue and issue-less spec targets", () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).validateDirectRunRequest, "function");
	for (const request of [issueRequest(), specRequest()]) {
		const result = orchestrator.validateDirectRunRequest(request);
		assert.equal(result.ok, true);
		if (result.ok) assert.deepEqual(result.value, request);
	}

	const extra = { ...issueRequest(), transcript: "must never be copied" };
	const invalid = orchestrator.validateDirectRunRequest(extra);
	assert.equal(invalid.ok, false);
	if (!invalid.ok) assert.ok(invalid.diagnostics.some((item) => item.code === "extra-field"));
	assert.equal(orchestrator.validateDirectRunRequest({ ...issueRequest(), summary: "x".repeat(241) }).ok, false);
});

test("the generic lifecycle cannot bypass strict DirectRunRequestV1 validation", async () => {
	const request = { ...issueRequest(), transcript: "must never cross the boundary" };
	const result = await orchestrator.startFreshStage({
		direct: {
			request,
			cwd: request.cwd,
			name: "SDD run-existing-spec · chichex/skills#14",
			repository: request.repo,
			canonicalReference: request.target.canonicalReference,
			issueNumber: request.target.issue.number,
		},
		skill: { name: "sdd-run", args: "#14" },
	}, {} as never, { commands: [] });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.code, "invalid-direct-request");
});

test("direct target resolution normalizes #NN and local/cross-project canonical specs without inventing issues", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).resolveDirectRunRequest, "function");
	const temporary = await mkdtemp(join(tmpdir(), "direct-sdd-run-"));
	try {
		const projectA = await realpath(temporary);
		const projectB = join(projectA, "project-b");
		await mkdir(join(projectA, ".sdd", "specs"), { recursive: true });
		await mkdir(join(projectB, ".sdd", "specs"), { recursive: true });
		const localSpec = join(projectA, ".sdd", "specs", "local.md");
		const crossSpec = join(projectB, ".sdd", "specs", "issue-7-cross.md");
		await writeFile(localSpec, [
			`# Spec — ${"Local artifact ".repeat(40)}`,
			"<!-- Generada. Estado: aprobada -->",
			"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=none; superseded-by=none -->",
			"",
		].join("\n"), "utf8");
		await writeFile(crossSpec, [
			"# Spec — Cross project",
			"<!-- Generada. Estado: aprobada -->",
			"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#7; grill=none; superseded-by=none -->",
			"",
		].join("\n"), "utf8");

		const dependencies = {
			async resolveGitRoot(path: string) {
				return path.startsWith(projectB) ? projectB : projectA;
			},
			async resolveRepository(root: string) {
				return root === projectB ? "owner/project-b" : "chichex/skills";
			},
		};
		const issue = await orchestrator.resolveDirectRunRequest("#14", projectA, dependencies);
		assert.equal(issue.ok, true);
		if (issue.ok) {
			assert.deepEqual(issue.request.target, {
				type: "issue",
				canonicalReference: "chichex/skills#14",
				issue: { repository: "chichex/skills", number: 14 },
			});
		}

		const local = await orchestrator.resolveDirectRunRequest(".sdd/specs/local.md", projectA, dependencies);
		assert.equal(local.ok, true);
		if (local.ok) {
			assert.equal(local.request.cwd, projectA);
			assert.ok(local.request.summary.length <= 240, "the transport summary stays bounded");
			assert.deepEqual(local.request.target, {
				type: "spec",
				canonicalReference: "chichex/skills:.sdd/specs/local.md",
				path: localSpec,
				issue: null,
			});
		}

		const cross = await orchestrator.resolveDirectRunRequest(crossSpec, projectA, dependencies);
		assert.equal(cross.ok, true);
		if (cross.ok) {
			assert.equal(cross.request.cwd, projectB);
			assert.equal(cross.request.repo, "owner/project-b");
			assert.deepEqual(cross.request.target, {
				type: "spec",
				canonicalReference: "owner/project-b:.sdd/specs/issue-7-cross.md",
				path: crossSpec,
				issue: { repository: "owner/project-b", number: 7 },
			});
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("startDirectRun creates a fresh linked child whose first message is materialized sdd-run plus request v1", async () => {
	assert.equal(typeof (orchestrator as Record<string, unknown>).startDirectRun, "function");
	const temporary = await mkdtemp(join(tmpdir(), "direct-sdd-child-"));
	try {
		const project = await realpath(temporary);
		const sessionDirectory = join(project, "sessions");
		const originFile = join(sessionDirectory, "origin.jsonl");
		const childFile = join(sessionDirectory, "child.jsonl");
		const skillPath = join(project, "skills", "sdd-run", "SKILL.md");
		const specPath = join(project, ".sdd", "specs", "local.md");
		await mkdir(dirname(skillPath), { recursive: true });
		await mkdir(dirname(specPath), { recursive: true });
		await mkdir(sessionDirectory, { recursive: true });
		await writeFile(skillPath, "---\nname: sdd-run\ndescription: Run\n---\n# SDD run\n", "utf8");
		await writeFile(specPath, "# Spec — Local\n", "utf8");
		await writeFile(originFile, "{}\n", "utf8");
		const request = specRequest();
		request.cwd = project;
		request.target.path = specPath;
		request.target.canonicalReference = "chichex/skills:.sdd/specs/local.md";
		request.evidence[0]!.reference = ".sdd/specs/local.md";
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
				assert.equal(options.parentSession, originFile);
				await options.setup({ appendSessionInfo(name: string) { sessionName = name; return "info"; } });
				await options.withSession({
					cwd: project,
					sessionManager: {
						getCwd: () => project,
						getSessionId: () => "child-id",
						getSessionFile: () => childFile,
					},
					getSystemPromptOptions: () => ({ cwd: project, contextFiles: [], skills: [] }),
					async sendUserMessage(message: string) { kickoff = message; },
				});
				return { cancelled: false };
			},
			async switchSession() { throw new Error("same-project launch must use newSession"); },
		};

		const result = await orchestrator.startDirectRun(request, context as never, {
			commands: [{ name: "skill:sdd-run", source: "skill", sourceInfo: { path: skillPath } }],
			stripSkillFrontmatter: fakeStripFrontmatter,
			resolveGitRoot: async () => project,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.target.sessionId, "child-id");
		assert.equal(result.target.artifactPath, specPath);
		assert.equal(sessionName, "SDD run-existing-spec · chichex/skills/local.md");
		assert.doesNotMatch(kickoff, /\/skill:sdd-run|origin transcript/i);
		assert.match(kickoff, new RegExp(`<skill name="sdd-run" location="${skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
		const envelope = kickoff.match(/<workflow-launch version="1">\n([\s\S]+)\n<\/workflow-launch>$/)?.[1];
		assert.ok(envelope);
		assert.deepEqual(JSON.parse(envelope), request);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("startDirectRun stages a cross-project child under the selected spec project", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "direct-sdd-cross-"));
	try {
		const origin = await realpath(temporary);
		const target = join(origin, "target");
		const originSessions = join(origin, "sessions");
		const originFile = join(originSessions, "origin.jsonl");
		const childFile = join(target, "sessions", "child.jsonl");
		const skillPath = join(origin, "global-skills", "sdd-run", "SKILL.md");
		const specPath = join(target, ".sdd", "specs", "local.md");
		await mkdir(dirname(originFile), { recursive: true });
		await mkdir(dirname(skillPath), { recursive: true });
		await mkdir(dirname(specPath), { recursive: true });
		await writeFile(originFile, "{}\n", "utf8");
		await writeFile(skillPath, "---\nname: sdd-run\ndescription: Run\n---\n# Run\n", "utf8");
		await writeFile(specPath, "# Spec — Target\n", "utf8");
		const request = specRequest();
		request.repo = "owner/target";
		request.cwd = target;
		request.target.canonicalReference = "owner/target:.sdd/specs/local.md";
		request.target.path = specPath;
		let stagedInput: unknown;
		let switched = "";
		const context = {
			cwd: origin,
			sessionManager: {
				getCwd: () => origin,
				getSessionId: () => "origin-id",
				getSessionFile: () => originFile,
				getSessionDir: () => originSessions,
			},
			async newSession() { throw new Error("cross-project launch must not use newSession"); },
			async switchSession(path: string, options: { withSession: (context: unknown) => Promise<void> }) {
				switched = path;
				await options.withSession({
					cwd: target,
					sessionManager: { getCwd: () => target, getSessionId: () => "child-id", getSessionFile: () => childFile },
					getSystemPromptOptions: () => ({
						cwd: target,
						contextFiles: [{ path: join(target, "AGENTS.md"), content: "target" }],
						skills: [],
					}),
					async sendUserMessage() {},
				});
				return { cancelled: false };
			},
		};
		const result = await orchestrator.startDirectRun(request, context as never, {
			commands: [{ name: "skill:sdd-run", source: "skill", sourceInfo: { path: skillPath } }],
			stripSkillFrontmatter: fakeStripFrontmatter,
			resolveGitRoot: async () => target,
			stageCrossProjectSession: async (input: unknown) => {
				stagedInput = input;
				return { sessionId: "staged-id", sessionFile: childFile, cwd: target };
			},
		});
		assert.equal(result.ok, true);
		assert.equal(switched, childFile);
		assert.deepEqual(stagedInput, {
			cwd: target,
			parentSession: originFile,
			name: "SDD run-existing-spec · owner/target/local.md",
			sourceCwd: origin,
			sourceSessionDir: originSessions,
		});
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
