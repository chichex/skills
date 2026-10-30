// Rutas de los artefactos de planificación (spec #84, CA-9; issue #103, CA-1).
//
// Los borradores (handoffs de grill y specs locales) se escriben en
// <git-common-dir>/chiche/<kind>: fuera del working tree, compartido por todos
// los worktrees del repo e invisible para `git status`. Se leen de cuatro
// lugares: los trackeados <root>/.chiche/<kind> y <root>/.sdd/<kind>, donde
// quedan los artefactos que un PR ya commiteó, y los locales
// <git-common-dir>/chiche/<kind> y <git-common-dir>/sdd/<kind>. Un artefacto se
// identifica por su nombre: ante el mismo nombre gana el trackeado sobre el
// local y chiche sobre sdd. Los lugares `sdd` son solo de lectura, hasta que
// una spec posterior retire la doble lectura. Fuera de un repo git no hay
// common-dir y el lugar local de cada marca es el trackeado.

import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type ArtifactKind = "grills" | "specs";
export type ArtifactBrand = "chiche" | "sdd";
export type ArtifactLocation = "tracked" | "local";

export interface ArtifactDirs {
	/** `<root>/.chiche/<kind>`. */
	tracked: string;
	/** `<git-common-dir>/chiche/<kind>`: el destino de todo artefacto nuevo. */
	local: string;
	/** `<root>/.sdd/<kind>`, solo lectura. */
	legacyTracked: string;
	/** `<git-common-dir>/sdd/<kind>`, solo lectura. */
	legacyLocal: string;
}

export interface ArtifactReadDir {
	path: string;
	location: ArtifactLocation;
	brand: ArtifactBrand;
}

export interface ArtifactEntry extends Omit<ArtifactReadDir, "path"> {
	name: string;
	path: string;
}

export type GitRunner = (args: readonly string[], cwd: string) => Promise<{ code: number; stdout: string }>;

const COMMON_DIR_ARGS = ["rev-parse", "--path-format=absolute", "--git-common-dir"] as const;
const TRACKED_DIR: Record<ArtifactBrand, string> = { chiche: ".chiche", sdd: ".sdd" };

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

/** Los cuatro lugares sin consultar git: el local de cada marca es su trackeado. */
export function trackedArtifactDirs(root: string, kind: ArtifactKind): ArtifactDirs {
	const tracked = join(resolve(root), TRACKED_DIR.chiche, kind);
	const legacyTracked = join(resolve(root), TRACKED_DIR.sdd, kind);
	return { tracked, local: tracked, legacyTracked, legacyLocal: legacyTracked };
}

/** `<git-common-dir>/<marca>/<kind>` dado el common-dir ya resuelto; por defecto, chiche. */
export function localArtifactDir(commonDir: string, kind: ArtifactKind, brand: ArtifactBrand = "chiche"): string {
	return join(resolve(commonDir), brand, kind);
}

export async function resolveArtifactDirs(root: string, kind: ArtifactKind, runGit: GitRunner = defaultGitRunner): Promise<ArtifactDirs> {
	const dirs = trackedArtifactDirs(root, kind);
	const commonDir = await resolveGitCommonDir(root, runGit);
	return commonDir
		? { ...dirs, local: localArtifactDir(commonDir, kind), legacyLocal: localArtifactDir(commonDir, kind, "sdd") }
		: dirs;
}

/** Los lugares de lectura en orden de precedencia, sin repetir un mismo directorio. */
export function artifactReadDirs(dirs: ArtifactDirs): ArtifactReadDir[] {
	const ordered: ArtifactReadDir[] = [
		{ path: dirs.tracked, location: "tracked", brand: "chiche" },
		{ path: dirs.legacyTracked, location: "tracked", brand: "sdd" },
		{ path: dirs.local, location: "local", brand: "chiche" },
		{ path: dirs.legacyLocal, location: "local", brand: "sdd" },
	];
	const seen = new Set<string>();
	return ordered.filter((entry) => {
		const key = resolve(entry.path);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Acepta solo una ruta absoluta directamente bajo alguno de los cuatro lugares. */
export function isArtifactPath(dirs: ArtifactDirs, path: string): boolean {
	if (!isAbsolute(path)) return false;
	const parent = dirname(resolve(path));
	return artifactReadDirs(dirs).some((entry) => parent === resolve(entry.path));
}

async function markdownFiles(directory: string): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name);
	} catch {
		return [];
	}
}

/** Une los Markdown de los cuatro lugares; ante el mismo nombre gana el primero en precedencia. */
export async function listArtifacts(dirs: ArtifactDirs): Promise<ArtifactEntry[]> {
	const byName = new Map<string, ArtifactEntry>();
	for (const directory of artifactReadDirs(dirs)) {
		for (const name of await markdownFiles(directory.path)) {
			if (!byName.has(name)) byName.set(name, { name, path: join(directory.path, name), location: directory.location, brand: directory.brand });
		}
	}
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Ruta de un artefacto por nombre: el archivo existente con la misma
 * precedencia que `listArtifacts`, o `<git-common-dir>/chiche/<kind>/<name>`
 * si todavía no existe. Ejemplo: `x.md` solo en `.sdd/specs/` resuelve ahí y
 * se actualiza en su lugar; `nueva.md` resuelve al lugar local de chiche.
 */
export async function resolveArtifactName(dirs: ArtifactDirs, name: string): Promise<string> {
	for (const directory of artifactReadDirs(dirs)) {
		const path = join(directory.path, name);
		if (await stat(path).then((entry) => entry.isFile(), () => false)) return path;
	}
	return join(dirs.local, name);
}

/** Worktrees del repo de `root` según `git worktree list --porcelain`; el primero es el principal. */
export async function resolveRepoWorktrees(root: string, runGit: GitRunner = defaultGitRunner): Promise<string[]> {
	try {
		const result = await runGit(["worktree", "list", "--porcelain"], root);
		if (result.code !== 0) return [];
		return result.stdout
			.split("\n")
			.filter((line) => line.startsWith("worktree "))
			.map((line) => resolve(line.slice("worktree ".length)));
	} catch {
		return [];
	}
}
