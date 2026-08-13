import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";

export interface PreparedSessionManagerLike {
	getHeader(): unknown;
	getEntries(): unknown[];
	getSessionId(): string;
	getSessionFile(): string | undefined;
	getCwd(): string;
}

export interface MutablePreparedSessionManagerLike extends PreparedSessionManagerLike {
	appendSessionInfo(name: string): string;
}

export interface PersistedStagedSession {
	sessionId: string;
	sessionFile: string;
	cwd: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePreparedSession(manager: PreparedSessionManagerLike): {
	header: Record<string, unknown>;
	entry: Record<string, unknown>;
	sessionId: string;
	sessionFile: string;
	cwd: string;
} {
	const header = manager.getHeader();
	const entries = manager.getEntries();
	const sessionId = manager.getSessionId();
	const sessionFile = manager.getSessionFile();
	const cwd = manager.getCwd();
	// Required fields present and well-formed, unknown fields tolerated: Pi's
	// session-file format is open (a future minor can add a header or
	// session_info field), so rejecting anything beyond this fixed allowlist
	// would break every cross-project stage the moment Pi adds one.
	if (!isRecord(header)
		|| header.type !== "session"
		|| header.version !== 3
		|| typeof header.id !== "string"
		|| typeof header.timestamp !== "string"
		|| typeof header.cwd !== "string"
		|| typeof header.parentSession !== "string"
		|| header.parentSession.trim() === "") {
		throw new Error("Prepared session requires one complete v3 child header");
	}
	if (entries.length !== 1 || !isRecord(entries[0])) {
		throw new Error("Prepared session must contain exactly one session_info entry");
	}
	const entry = entries[0];
	if (entry.type !== "session_info"
		|| typeof entry.id !== "string"
		|| entry.parentId !== null
		|| typeof entry.timestamp !== "string"
		|| typeof entry.name !== "string"
		|| entry.name.trim() === "") {
		throw new Error("Prepared session must contain one named session_info root entry");
	}
	if (sessionId !== header.id || cwd !== header.cwd || !sessionFile || !isAbsolute(sessionFile)) {
		throw new Error("Prepared session manager identity does not match its header/path");
	}
	return { header, entry, sessionId, sessionFile, cwd };
}

/**
 * Makes a complete JSONL visible with one exclusive hard-link operation, so a
 * pre-existing session is never overwritten and a partial file is never opened.
 */
export async function persistPreparedSessionAtomically(
	manager: PreparedSessionManagerLike,
): Promise<PersistedStagedSession> {
	const prepared = validatePreparedSession(manager);
	await mkdir(dirname(prepared.sessionFile), { recursive: true });
	const temporaryFile = `${prepared.sessionFile}.tmp-${randomUUID()}`;
	const payload = `${JSON.stringify(prepared.header)}\n${JSON.stringify(prepared.entry)}\n`;
	let temporaryExists = false;
	try {
		const handle = await open(temporaryFile, "wx", 0o600);
		temporaryExists = true;
		try {
			await handle.writeFile(payload, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await link(temporaryFile, prepared.sessionFile);
		await unlink(temporaryFile);
		temporaryExists = false;
		return {
			sessionId: prepared.sessionId,
			sessionFile: prepared.sessionFile,
			cwd: prepared.cwd,
		};
	} catch (error) {
		if (temporaryExists) {
			try {
				await unlink(temporaryFile);
			} catch {}
		}
		throw error;
	}
}

export interface StageCrossProjectSessionInput {
	cwd: string;
	parentSession: string;
	name: string;
	/**
	 * The origin session's own cwd and session directory (context.cwd and
	 * sessionManager.getSessionDir()), used only to decide whether to
	 * propagate an explicit --session-dir override to the staged child — see
	 * resolveSessionDirOverride below. Optional so existing same-project-only
	 * callers keep compiling; stageCrossProjectSession is cross-project by
	 * definition and should always receive both in practice.
	 */
	sourceCwd?: string;
	sourceSessionDir?: string;
}

export interface StageCrossProjectSessionDependencies {
	createSessionManager?: (input: StageCrossProjectSessionInput) => Promise<MutablePreparedSessionManagerLike>
		| MutablePreparedSessionManagerLike;
}

/**
 * Pi 0.84.1's SessionManager.create(cwd, sessionDir) falls back to a per-cwd
 * default directory whenever sessionDir is falsy (session-manager.js
 * getDefaultSessionDirPath: `${agentDir}/sessions/--<cwd with /, \, and :
 * replaced by ->--`). Pi's own runtime newSession() always reuses the
 * current session's getSessionDir() (agent-session-runtime.js), because it
 * never changes cwd — so that reuse is a no-op whenever the current session
 * already sits in its own per-cwd default. A cross-project child does
 * change cwd, so blindly reusing the origin's getSessionDir() would misfile
 * a child that should get ITS OWN per-cwd default under the origin's
 * directory instead. Only propagate the origin's session dir when it does
 * NOT look like its own per-cwd default (i.e. the user passed an explicit
 * --session-dir override, which is cwd-independent and must reach the
 * child); otherwise let SessionManager.create() compute the child's own
 * default, exactly like it would for a fresh same-project session.
 */
export function resolveSessionDirOverride(sourceCwd: string, sourceSessionDir: string): string | undefined {
	const safeSegment = `--${sourceCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return basename(sourceSessionDir) === safeSegment ? undefined : sourceSessionDir;
}

async function createPiSessionManager(
	input: StageCrossProjectSessionInput,
): Promise<MutablePreparedSessionManagerLike> {
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	const sessionDir = input.sourceCwd !== undefined && input.sourceSessionDir !== undefined
		? resolveSessionDirOverride(input.sourceCwd, input.sourceSessionDir)
		: undefined;
	return SessionManager.create(input.cwd, sessionDir, { parentSession: input.parentSession });
}

export async function stageCrossProjectSession(
	input: StageCrossProjectSessionInput,
	dependencies: StageCrossProjectSessionDependencies = {},
): Promise<PersistedStagedSession> {
	const manager = await (dependencies.createSessionManager ?? createPiSessionManager)(input);
	manager.appendSessionInfo(input.name);
	return persistPreparedSessionAtomically(manager);
}
