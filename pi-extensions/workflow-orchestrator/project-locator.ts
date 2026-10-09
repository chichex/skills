import { execFile } from "node:child_process";
import { open, readFile, readdir, realpath as realpathDefault } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ResolveRepositoryRootResult =
	| { ok: true; root: string }
	| { ok: false; code: "project-not-found" | "ambiguous-project"; roots: string[] };

export interface ResolveKnownRepositoryRootDependencies {
	listKnownCwds?: () => Promise<string[]>;
	resolveGitRoot?: (cwd: string) => Promise<string>;
	resolvePrimaryWorktree?: (root: string) => Promise<string>;
	resolveRepository?: (root: string) => Promise<string | null>;
	realpath?: (path: string) => Promise<string>;
}

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const SESSIONS_DIR = join(AGENT_DIR, "sessions");
const GRILL_STORE_DIR = join(AGENT_DIR, "grill-sessions");

function execText(command: string, args: string[], cwd: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(command, args, { cwd, encoding: "utf8", timeout: 5_000 }, (error, stdout, stderr) => {
			if (error) reject(new Error(String(stderr).trim() || error.message));
			else resolvePromise(String(stdout).trim());
		});
	});
}

async function defaultGitRoot(cwd: string): Promise<string> {
	return execText("git", ["rev-parse", "--show-toplevel"], cwd);
}

async function defaultPrimaryWorktree(root: string): Promise<string> {
	const output = await execText("git", ["worktree", "list", "--porcelain"], root);
	const path = output.match(/^worktree (.+)$/m)?.[1]?.trim();
	return path || root;
}

export function repositoryFromGitHubRemote(remote: string): string | null {
	const value = remote.trim();
	const scp = /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(value);
	if (scp?.[1] && scp[2]) return `${scp[1]}/${scp[2]}`;

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (!["git:", "http:", "https:", "ssh:"].includes(url.protocol) || url.hostname.toLowerCase() !== "github.com") {
		return null;
	}
	const match = /^\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.pathname);
	return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : null;
}

async function defaultRepository(root: string): Promise<string | null> {
	return repositoryFromGitHubRemote(await execText("git", ["remote", "get-url", "origin"], root));
}

async function firstSessionCwd(directory: string): Promise<string | null> {
	let files: string[];
	try {
		files = (await readdir(directory)).filter((file) => file.endsWith(".jsonl")).sort();
	} catch {
		return null;
	}
	for (const file of files) {
		try {
			const handle = await open(join(directory, file), "r");
			try {
				const buffer = Buffer.alloc(4_096);
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
				const line = buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0];
				const parsed = JSON.parse(line) as { cwd?: unknown };
				if (typeof parsed.cwd === "string" && parsed.cwd.trim() !== "") return parsed.cwd;
			} finally {
				await handle.close();
			}
		} catch {
			// One corrupt session must not hide the other sessions for this project.
		}
	}
	return null;
}

async function sessionCwds(): Promise<string[]> {
	try {
		const directories = (await readdir(SESSIONS_DIR, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(SESSIONS_DIR, entry.name));
		const values = await Promise.all(directories.map(firstSessionCwd));
		return values.filter((value): value is string => value !== null);
	} catch {
		return [];
	}
}

async function grillProjectCwds(): Promise<string[]> {
	try {
		const files = (await readdir(GRILL_STORE_DIR)).filter((file) => file.endsWith(".json"));
		const values = await Promise.all(files.map(async (file): Promise<string | null> => {
			try {
				const parsed = JSON.parse(await readFile(join(GRILL_STORE_DIR, file), "utf8")) as { projectPath?: unknown };
				return typeof parsed.projectPath === "string" && parsed.projectPath.trim() !== ""
					? parsed.projectPath
					: null;
			} catch {
				return null;
			}
		}));
		return values.filter((value): value is string => value !== null);
	} catch {
		return [];
	}
}

async function defaultKnownCwds(): Promise<string[]> {
	const [sessions, grills] = await Promise.all([sessionCwds(), grillProjectCwds()]);
	return [...new Set([...sessions, ...grills])];
}

export async function resolveKnownRepositoryRoot(
	originRoot: string,
	repository: string,
	dependencies: ResolveKnownRepositoryRootDependencies = {},
): Promise<ResolveRepositoryRootResult> {
	const knownCwdsPort = dependencies.listKnownCwds ?? defaultKnownCwds;
	const gitRootPort = dependencies.resolveGitRoot ?? defaultGitRoot;
	const primaryWorktreePort = dependencies.resolvePrimaryWorktree ?? defaultPrimaryWorktree;
	const repositoryPort = dependencies.resolveRepository ?? defaultRepository;
	const realpathPort = dependencies.realpath ?? realpathDefault;
	const candidates = [...new Set([originRoot, ...await knownCwdsPort()].map((path) => resolve(path)))];
	const matches = new Set<string>();

	for (let index = 0; index < candidates.length; index += 8) {
		const batch = candidates.slice(index, index + 8);
		const inspected = await Promise.all(batch.map(async (cwd): Promise<{ root: string; repository: string } | null> => {
			try {
				const gitRoot = await realpathPort(await gitRootPort(cwd));
				const primaryRoot = await realpathPort(await primaryWorktreePort(gitRoot));
				const resolvedRepository = await repositoryPort(primaryRoot);
				return resolvedRepository ? { root: primaryRoot, repository: resolvedRepository } : null;
			} catch {
				return null;
			}
		}));
		for (const candidate of inspected) {
			if (candidate?.repository.toLowerCase() === repository.toLowerCase()) matches.add(candidate.root);
		}
	}

	const roots = [...matches].sort();
	if (roots.length === 1) return { ok: true, root: roots[0]! };
	return {
		ok: false,
		code: roots.length === 0 ? "project-not-found" : "ambiguous-project",
		roots,
	};
}
