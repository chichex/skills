// Rutas de los artefactos de planificación SDD (spec #84, CA-9).
//
// Los borradores (handoffs de grill y specs locales) se escriben en
// <git-common-dir>/sdd/<kind>: fuera del working tree, compartido por todos los
// worktrees del repo e invisible para `git status`. El árbol trackeado
// <root>/.sdd/<kind> sigue siendo un lugar de lectura: ahí quedan los
// artefactos que un PR ya commiteó, y ante el mismo nombre gana el trackeado.
// Fuera de un repo git no hay common-dir y los dos lugares son el mismo.

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type SddArtifactKind = "grills" | "specs";

export interface SddArtifactDirs {
	tracked: string;
	local: string;
}

export interface SddArtifactEntry {
	name: string;
	path: string;
	location: "tracked" | "local";
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<{ code: number; stdout: string }>;

const COMMON_DIR_ARGS = ["rev-parse", "--path-format=absolute", "--git-common-dir"] as const;

export const defaultGitRunner: GitRunner = (args, cwd) =>
	new Promise((resolveRun) => {
		execFile("git", [...args], { cwd, encoding: "utf8", timeout: 5_000 }, (error, stdout) => {
			const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
			resolveRun({ code, stdout: String(stdout ?? "") });
		});
	});

/** `<git-common-dir>` absoluto de `root`, o `null` fuera de un repo git. */
export async function resolveGitCommonDir(root: string, runGit: GitRunner = defaultGitRunner): Promise<string | null> {
	try {
		const result = await runGit(COMMON_DIR_ARGS, root);
		const commonDir = result.code === 0 ? result.stdout.trim() : "";
		return commonDir && isAbsolute(commonDir) ? resolve(commonDir) : null;
	} catch {
		return null;
	}
}

/** Los dos lugares sin consultar git: `local` igual a `tracked`. */
export function trackedSddArtifactDirs(root: string, kind: SddArtifactKind): SddArtifactDirs {
	const tracked = join(resolve(root), ".sdd", kind);
	return { tracked, local: tracked };
}

/** `<git-common-dir>/sdd/<kind>` dado el common-dir ya resuelto. */
export function localSddArtifactDir(commonDir: string, kind: SddArtifactKind): string {
	return join(resolve(commonDir), "sdd", kind);
}

export async function resolveSddArtifactDirs(root: string, kind: SddArtifactKind, runGit: GitRunner = defaultGitRunner): Promise<SddArtifactDirs> {
	const dirs = trackedSddArtifactDirs(root, kind);
	const commonDir = await resolveGitCommonDir(root, runGit);
	return commonDir ? { ...dirs, local: localSddArtifactDir(commonDir, kind) } : dirs;
}

/** Acepta solo una ruta absoluta directamente bajo `tracked` o bajo `local`. */
export function isSddArtifactPath(dirs: SddArtifactDirs, path: string): boolean {
	if (!isAbsolute(path)) return false;
	const parent = dirname(resolve(path));
	return parent === resolve(dirs.tracked) || parent === resolve(dirs.local);
}

async function markdownFiles(directory: string): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name);
	} catch {
		return [];
	}
}

/** Une los Markdown de los dos lugares; ante el mismo nombre gana el trackeado. */
export async function listSddArtifacts(dirs: SddArtifactDirs): Promise<SddArtifactEntry[]> {
	const byName = new Map<string, SddArtifactEntry>();
	for (const name of await markdownFiles(dirs.tracked)) byName.set(name, { name, path: join(dirs.tracked, name), location: "tracked" });
	if (resolve(dirs.local) !== resolve(dirs.tracked)) {
		for (const name of await markdownFiles(dirs.local)) {
			if (!byName.has(name)) byName.set(name, { name, path: join(dirs.local, name), location: "local" });
		}
	}
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
