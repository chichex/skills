import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { persistPreparedSessionAtomically, stageCrossProjectSession } from "./staging.ts";

test("atomically persists one minimal v3 child header plus session name in a temporary store", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-orchestrator-stage-"));
	try {
		const sessionFile = join(root, "2026-08-11T10-00-00-000Z_child-id.jsonl");
		const header = {
			type: "session",
			version: 3,
			id: "child-id",
			timestamp: "2026-08-11T10:00:00.000Z",
			cwd: "/workspace/target",
			parentSession: "/sessions/origin.jsonl",
		};
		const sessionInfo = {
			type: "session_info",
			id: "info-id",
			parentId: null,
			timestamp: "2026-08-11T10:00:00.001Z",
			name: "SDD spec · owner/repo#13",
		};
		const manager = {
			getHeader: () => header,
			getEntries: () => [sessionInfo],
			getSessionId: () => "child-id",
			getSessionFile: () => sessionFile,
			getCwd: () => "/workspace/target",
		};

		const result = await persistPreparedSessionAtomically(manager);
		assert.deepEqual(result, {
			sessionId: "child-id",
			sessionFile,
			cwd: "/workspace/target",
		});
		const lines = (await readFile(sessionFile, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
		assert.deepEqual(lines, [header, sessionInfo]);
		assert.equal(lines.some((entry) => entry.type === "message"), false);
		assert.equal((await stat(sessionFile)).mode & 0o077, 0, "staged session is private");
		assert.deepEqual(await readdir(root), [sessionFile.split("/").at(-1)]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("never overwrites a pre-existing session and removes its temporary file on failure", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-orchestrator-stage-existing-"));
	try {
		const sessionFile = join(root, "existing.jsonl");
		await writeFile(sessionFile, "PREEXISTING\n", "utf8");
		const manager = {
			getHeader: () => ({
				type: "session", version: 3, id: "child-id", timestamp: "2026-08-11T10:00:00.000Z",
				cwd: "/workspace/target", parentSession: "/sessions/origin.jsonl",
			}),
			getEntries: () => [{
				type: "session_info", id: "info-id", parentId: null, timestamp: "2026-08-11T10:00:00.001Z",
				name: "SDD spec · owner/repo#13",
			}],
			getSessionId: () => "child-id",
			getSessionFile: () => sessionFile,
			getCwd: () => "/workspace/target",
		};

		await assert.rejects(() => persistPreparedSessionAtomically(manager), /EEXIST|exist/i);
		assert.equal(await readFile(sessionFile, "utf8"), "PREEXISTING\n");
		assert.deepEqual(await readdir(root), ["existing.jsonl"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects any staged conversation entry before creating a file", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-orchestrator-stage-invalid-"));
	try {
		const manager = {
			getHeader: () => ({
				type: "session", version: 3, id: "child-id", timestamp: "2026-08-11T10:00:00.000Z",
				cwd: "/workspace/target", parentSession: "/sessions/origin.jsonl",
			}),
			getEntries: () => [{
				type: "message", id: "copied", parentId: null, timestamp: "2026-08-11T10:00:00.001Z",
				message: { role: "user", content: "copied transcript" },
			}],
			getSessionId: () => "child-id",
			getSessionFile: () => join(root, "child.jsonl"),
			getCwd: () => "/workspace/target",
		};

		await assert.rejects(() => persistPreparedSessionAtomically(manager), /session_info/);
		assert.deepEqual(await readdir(root), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("default staging adapter names the public SessionManager draft before atomically persisting it", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-orchestrator-stage-adapter-"));
	try {
		const sessionFile = join(root, "child.jsonl");
		const entries: Record<string, unknown>[] = [];
		const appendedNames: string[] = [];
		const result = await stageCrossProjectSession({
			cwd: "/workspace/target",
			parentSession: "/sessions/origin.jsonl",
			name: "SDD run-existing-spec · owner/repo#13",
		}, {
			createSessionManager(input) {
				return {
					getHeader: () => ({
						type: "session", version: 3, id: "child-id", timestamp: "2026-08-11T10:00:00.000Z",
						cwd: input.cwd, parentSession: input.parentSession,
					}),
					getEntries: () => entries,
					getSessionId: () => "child-id",
					getSessionFile: () => sessionFile,
					getCwd: () => input.cwd,
					appendSessionInfo(name) {
						appendedNames.push(name);
						entries.push({
							type: "session_info", id: "info-id", parentId: null,
							timestamp: "2026-08-11T10:00:00.001Z", name,
						});
						return "info-id";
					},
				};
			},
		});

		assert.deepEqual(appendedNames, ["SDD run-existing-spec · owner/repo#13"]);
		assert.equal(result.sessionFile, sessionFile);
		assert.equal((await readFile(sessionFile, "utf8")).includes("run-existing-spec"), true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
