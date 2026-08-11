import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

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
	if (Object.keys(header).some((key) => !["type", "version", "id", "timestamp", "cwd", "parentSession"].includes(key))) {
		throw new Error("Prepared session header contains unsupported fields");
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
	if (Object.keys(entry).some((key) => !["type", "id", "parentId", "timestamp", "name"].includes(key))) {
		throw new Error("Prepared session_info contains unsupported fields");
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
}

export interface StageCrossProjectSessionDependencies {
	createSessionManager?: (input: StageCrossProjectSessionInput) => Promise<MutablePreparedSessionManagerLike>
		| MutablePreparedSessionManagerLike;
}

async function createPiSessionManager(
	input: StageCrossProjectSessionInput,
): Promise<MutablePreparedSessionManagerLike> {
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	return SessionManager.create(input.cwd, undefined, { parentSession: input.parentSession });
}

export async function stageCrossProjectSession(
	input: StageCrossProjectSessionInput,
	dependencies: StageCrossProjectSessionDependencies = {},
): Promise<PersistedStagedSession> {
	const manager = await (dependencies.createSessionManager ?? createPiSessionManager)(input);
	manager.appendSessionInfo(input.name);
	return persistPreparedSessionAtomically(manager);
}
