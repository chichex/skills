import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startFreshStage } from "./lifecycle.ts";
import { stageCrossProjectSession as persistCrossProjectSession } from "./staging.ts";

function issue(number: number) {
	return { repository: "chichex/skills", number };
}

function resolution(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		outcome: "start",
		code: "quick-run",
		recommendedClassification: "quick-run",
		fallbackClassification: "spec",
		recommendedRoute: "quick-run",
		selectedRoute: "quick-run",
		stage: "quick-run",
		mode: "new",
		repo: "chichex/skills",
		cwd: "/workspace/skills",
		sources: [issue(13)],
		canonicalIssue: issue(13),
		summary: "Start a fresh stage.",
		impactExample: "No triage transcript is copied.",
		scope: ["orchestration"],
		checklist: ["fresh session"],
		evidence: [],
		risks: [],
		artifacts: [],
		...overrides,
	};
}

test("rejects stop, error, unconfirmed, mismatched, and incoherent dispatch before every mutable or I/O port", async () => {
	const calls: string[] = [];
	const forbidden = (name: string) => async () => {
		calls.push(name);
		throw new Error(`${name} must not run`);
	};
	const context = {
		cwd: "/workspace/skills",
		sessionManager: {
			getCwd: () => "/workspace/skills",
			getSessionId: () => "origin-id",
			getSessionFile: () => "/sessions/origin.jsonl",
		},
		newSession: forbidden("newSession"),
		switchSession: forbidden("switchSession"),
	};
	const dependencies = {
		commands: [],
		readSkillFile: forbidden("readSkillFile"),
		realpath: forbidden("realpath"),
		stat: forbidden("stat"),
		resolveGitRoot: forbidden("resolveGitRoot"),
		stageCrossProjectSession: forbidden("stageCrossProjectSession"),
		removeFile: forbidden("removeFile"),
	};
	const cases = [
		resolution({ outcome: "stop", code: "cancelled", selectedRoute: null, stage: null, mode: null }),
		resolution({ outcome: "error", code: "canonicalization", recommendedRoute: null, selectedRoute: null, stage: null, mode: null }),
		resolution({ selectedRoute: null }),
		resolution({ selectedRoute: "spec" }),
		resolution({ stage: "spec" }),
		resolution({ selectedRoute: "already-implemented", code: "already-implemented" }),
	];

	for (const handoff of cases) {
		const result = await startFreshStage(
			{ resolution: handoff, skill: { name: "quick-run", args: "" } },
			context as never,
			dependencies as never,
		);
		assert.equal(result.ok, false);
		assert.equal(result.code, "invalid-handoff");
		assert.equal(result.phase, "validation");
		assert.equal(result.originPreserved, true);
	}
	assert.deepEqual(calls, []);
});

test("accepts every actionable route only through its exact stage and mode matrix", async () => {
	const context = {
		cwd: "/workspace/skills",
		sessionManager: {
			getCwd: () => "/workspace/skills",
			getSessionId: () => "origin-id",
			getSessionFile: () => "/sessions/origin.jsonl",
		},
		newSession: async () => { throw new Error("must not mutate"); },
		switchSession: async () => { throw new Error("must not mutate"); },
	};
	const cases = [
		["grill", "grill", "new"],
		["join-grill", "grill", "new"],
		["spec", "spec", "new"],
		["join-spec", "spec", "new"],
		["quick-run", "quick-run", "new"],
		["join-quick-run", "quick-run", "new"],
		["resume-grill", "grill", "resume"],
		["spec-from-grill", "spec", "from-grill"],
		["update-existing-spec", "spec", "update"],
		["audit-existing-spec", "spec", "update"],
		["run-existing-spec", "run-existing-spec", null],
	] as const;

	for (const [route, stage, mode] of cases) {
		const isJoin = route.startsWith("join-");
		const handoff = resolution({
			code: route,
			recommendedRoute: route,
			selectedRoute: route,
			stage,
			mode,
			canonicalIssue: isJoin ? issue(13) : null,
		});
		const result = await startFreshStage(
			{ resolution: handoff, skill: { name: "missing", args: "" } },
			context as never,
			{ commands: [] },
		);
		assert.equal(result.ok, false, route);
		assert.equal(result.code, "skill-not-found", route);
		assert.equal(result.phase, "validation", route);
		assert.equal(result.originPreserved, true, route);
	}
});

test("starts a fresh linked same-project session and sends only materialized skill plus the deterministic handoff", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-orchestrator-same-"));
	try {
		const project = await realpath(root);
		const skillDir = join(root, "skill");
		const skillPath = join(skillDir, "SKILL.md");
		const sessionDir = join(project, "sessions");
		const originFile = join(sessionDir, "origin.jsonl");
		const childFile = join(sessionDir, "child.jsonl");
		await mkdir(skillDir);
		await mkdir(sessionDir);
		await writeFile(skillPath, "---\nname: quick-run\ndescription: Run\n---\n# Quick run\n", "utf8");
		await writeFile(originFile, `${JSON.stringify({ type: "session", version: 3, id: "origin-id", cwd: project })}\n`, "utf8");

		const handoff = resolution({ cwd: project, canonicalIssue: null });
		const calls: string[] = [];
		let kickoff = "";
		const context = {
			cwd: project,
			sessionManager: {
				getCwd: () => project,
				getSessionId: () => "origin-id",
				getSessionFile: () => originFile,
			},
			async newSession(options: {
				parentSession: string;
				setup: (manager: { appendSessionInfo(name: string): string }) => Promise<void>;
				withSession: (replacement: unknown) => Promise<void>;
			}) {
				calls.push("MUTATE:newSession");
				assert.equal(options.parentSession, originFile);
				await options.setup({
					appendSessionInfo(name) {
						calls.push(`session-info:${name}`);
						return "info-id";
					},
				});
				await options.withSession({
					cwd: project,
					sessionManager: {
						getCwd: () => project,
						getSessionId: () => "child-id",
						getSessionFile: () => childFile,
					},
					getSystemPromptOptions() {
						calls.push("target-resources");
						return {
							cwd: project,
							contextFiles: [{ path: join(project, "AGENTS.md"), content: "target" }],
							skills: [{
								filePath: join(project, ".agents/skills/project/SKILL.md"),
								sourceInfo: { path: join(project, ".agents/skills/project/SKILL.md"), scope: "project" },
							}],
						};
					},
					async sendUserMessage(message: string) {
						calls.push("kickoff");
						kickoff = message;
					},
				});
				return { cancelled: false };
			},
			async switchSession() {
				throw new Error("same-project must not switchSession");
			},
		};
		const result = await startFreshStage(
			{ resolution: handoff, skill: { name: "quick-run", args: "  --assume  " } },
			context as never,
			{
				commands: [{
					name: "skill:quick-run",
					source: "skill",
					sourceInfo: {
						path: skillPath,
						baseDir: skillDir,
						source: "skills",
						scope: "temporary",
						origin: "top-level",
					},
				}],
				async readSkillFile(path, encoding) {
					calls.push("read-skill");
					return readFile(path, encoding);
				},
				async realpath(path) {
					calls.push(`realpath:${path}`);
					return realpath(path);
				},
				async stat(path) {
					calls.push(`stat:${path}`);
					return stat(path);
				},
				async resolveGitRoot(cwd) {
					calls.push(`git-root:${cwd}`);
					return project;
				},
				async stageCrossProjectSession() {
					throw new Error("same-project must not stage");
				},
			} as never,
		);

		assert.equal(result.ok, true, JSON.stringify(result));
		if (!result.ok) return;
		assert.deepEqual(result.source, { sessionId: "origin-id", sessionFile: originFile, cwd: project });
		assert.deepEqual(result.target, {
			sessionId: "child-id",
			sessionFile: childFile,
			cwd: project,
			name: "SDD quick-run · chichex/skills#13",
			repository: "chichex/skills",
			issueNumber: 13,
		});
		const mutationIndex = calls.indexOf("MUTATE:newSession");
		assert.ok(mutationIndex > 0);
		assert.ok(calls.slice(0, mutationIndex).includes("read-skill"));
		assert.ok(calls.slice(0, mutationIndex).some((call) => call.startsWith("git-root:")));
		assert.deepEqual(calls.slice(mutationIndex), [
			"MUTATE:newSession",
			"session-info:SDD quick-run · chichex/skills#13",
			"target-resources",
			"kickoff",
		]);
		assert.doesNotMatch(kickoff, /\/skill:/);
		const envelope = kickoff.match(/^([\s\S]+)\n\n<workflow-handoff version="1">\n([^\n]+)\n<\/workflow-handoff>$/);
		assert.ok(envelope);
		assert.equal(envelope[1], [
			`<skill name="quick-run" location="${skillPath}">`,
			`References are relative to ${skillDir}.`,
			"",
			"# Quick run",
			"</skill>",
			"",
			"--assume",
		].join("\n"));
		assert.deepEqual(JSON.parse(envelope[2]!), handoff);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("stages and switches to a fresh cross-project child using only the replacement context after switch", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-orchestrator-cross-"));
	try {
		const sourceProject = join(root, "source");
		const targetProject = join(root, "target");
		const skillDir = join(root, "skill");
		await mkdir(sourceProject);
		await mkdir(targetProject);
		await mkdir(skillDir);
		const sourceCwd = await realpath(sourceProject);
		const targetCwd = await realpath(targetProject);
		const originFile = join(sourceCwd, "origin.jsonl");
		const targetSessionFile = join(targetCwd, "sessions", "child.jsonl");
		const skillPath = join(skillDir, "SKILL.md");
		const originTranscriptMarker = "ORIGIN_TRANSCRIPT_MUST_NOT_BE_COPIED";
		await writeFile(originFile, [
			JSON.stringify({ type: "session", version: 3, id: "origin-id", cwd: sourceCwd }),
			JSON.stringify({
				type: "message",
				id: "origin-message",
				parentId: null,
				timestamp: "2026-08-11T09:00:00.000Z",
				message: { role: "user", content: originTranscriptMarker, timestamp: 1 },
			}),
			"",
		].join("\n"), "utf8");
		await writeFile(skillPath, "---\nname: sdd-spec\ndescription: Spec\n---\n# Spec stage\n", "utf8");

		const handoff = resolution({
			cwd: targetCwd,
			code: "spec",
			selectedRoute: "spec",
			stage: "spec",
			mode: "new",
		});
		const calls: string[] = [];
		let kickoff = "";
		let originStale = false;
		const originManager = {
			getCwd: () => {
				if (originStale) throw new Error("stale origin manager used");
				return sourceCwd;
			},
			getSessionId: () => {
				if (originStale) throw new Error("stale origin manager used");
				return "origin-id";
			},
			getSessionFile: () => {
				if (originStale) throw new Error("stale origin manager used");
				return originFile;
			},
		};
		const context = {
			get cwd() {
				if (originStale) throw new Error("stale origin context used");
				return sourceCwd;
			},
			sessionManager: originManager,
			async newSession() {
				throw new Error("cross-project must not call newSession");
			},
			async switchSession(path: string, options: { withSession: (context: unknown) => Promise<void> }) {
				calls.push("MUTATE:switchSession");
				assert.equal(path, targetSessionFile);
				const staged = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
				assert.equal(staged.length, 2);
				assert.deepEqual(staged[0], {
					type: "session",
					version: 3,
					id: "child-id",
					timestamp: "2026-08-11T10:00:00.000Z",
					cwd: targetCwd,
					parentSession: originFile,
				});
				assert.equal(staged[1].type, "session_info");
				assert.equal(staged[1].name, "SDD spec · chichex/skills#13");
				assert.equal(staged.some((entry) => entry.type === "message"), false);
				originStale = true;
				await options.withSession({
					cwd: targetCwd,
					sessionManager: {
						getCwd: () => targetCwd,
						getSessionId: () => "child-id",
						getSessionFile: () => targetSessionFile,
					},
					getSystemPromptOptions() {
						calls.push("target-resources");
						return {
							cwd: targetCwd,
							contextFiles: [
								{ path: "/home/test/.pi/agent/AGENTS.md", content: "GLOBAL_MARKER" },
								{ path: join(targetCwd, "AGENTS.md"), content: "TARGET_MARKER" },
							],
							skills: [{
								filePath: join(targetCwd, ".agents/skills/target/SKILL.md"),
								sourceInfo: { path: join(targetCwd, ".agents/skills/target/SKILL.md"), scope: "project" },
							}],
						};
					},
					async sendUserMessage(message: string) {
						calls.push("kickoff");
						kickoff = message;
					},
				});
				return { cancelled: false };
			},
		};

		const result = await startFreshStage(
			{ resolution: handoff, skill: { name: "sdd-spec", args: "#13" } },
			context as never,
			{
				commands: [{
					name: "skill:sdd-spec",
					source: "skill",
					sourceInfo: {
						path: skillPath,
						baseDir: skillDir,
						source: "skills",
						scope: "temporary",
						origin: "top-level",
					},
				}],
				resolveGitRoot: async (cwd) => cwd,
				async stageCrossProjectSession(input) {
					calls.push("MUTATE:stageSession");
					return persistCrossProjectSession(input, {
						createSessionManager: () => {
							const entries: Record<string, unknown>[] = [];
							return {
								getHeader: () => ({
									type: "session",
									version: 3,
									id: "child-id",
									timestamp: "2026-08-11T10:00:00.000Z",
									cwd: input.cwd,
									parentSession: input.parentSession,
								}),
								getEntries: () => entries,
								getSessionId: () => "child-id",
								getSessionFile: () => targetSessionFile,
								getCwd: () => input.cwd,
								appendSessionInfo(name: string) {
									entries.push({
										type: "session_info",
										id: "info-id",
										parentId: null,
										timestamp: "2026-08-11T10:00:00.001Z",
										name,
									});
									return "info-id";
								},
							};
						},
					});
				},
			} as never,
		);

		assert.equal(result.ok, true, JSON.stringify(result));
		if (!result.ok) return;
		assert.equal(originStale, true);
		assert.deepEqual(calls.slice(-4), [
			"MUTATE:stageSession",
			"MUTATE:switchSession",
			"target-resources",
			"kickoff",
		]);
		assert.deepEqual(result.target, {
			sessionId: "child-id",
			sessionFile: targetSessionFile,
			cwd: targetCwd,
			name: "SDD spec · chichex/skills#13",
			repository: "chichex/skills",
			issueNumber: 13,
		});
		assert.doesNotMatch(kickoff, new RegExp(`${originTranscriptMarker}|/skill:`));
		const envelopeJson = kickoff.match(/<workflow-handoff version="1">\n([^\n]+)\n<\/workflow-handoff>$/)?.[1];
		assert.ok(envelopeJson);
		assert.deepEqual(JSON.parse(envelopeJson), handoff);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
