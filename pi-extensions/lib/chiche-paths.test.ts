// Issue #103, CA-1: los artefactos de planificación se leen de cuatro lugares
// y se escriben en uno. Trackeados: <root>/.chiche/<kind> y <root>/.sdd/<kind>;
// locales: <git-common-dir>/chiche/<kind> y <git-common-dir>/sdd/<kind>. Ante
// el mismo nombre gana el trackeado sobre el local y chiche sobre sdd; lo nuevo
// se escribe siempre en <git-common-dir>/chiche/<kind>. Los tests usan un repo
// git temporal real con un worktree linkeado: el common-dir es el mismo desde
// los dos checkouts y queda fuera de los dos working trees (spec #84, CA-9).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	artifactReadDirs,
	isArtifactPath,
	listArtifacts,
	localArtifactDir,
	resolveArtifactDirs,
	resolveArtifactName,
	resolveGitCommonDir,
	resolveRepoWorktrees,
	trackedArtifactDirs,
} from "./chiche-paths.ts";
import * as legacy from "./sdd-paths.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-c", "user.name=sdd", "-c", "user.email=sdd@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
	});
}

function repoWithLinkedWorktree(): { base: string; main: string; linked: string } {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "chiche-paths-")));
	const main = join(base, "repo");
	mkdirSync(main);
	git(main, "init", "-q", "-b", "main");
	writeFileSync(join(main, "README.md"), "repo\n");
	git(main, "add", "README.md");
	git(main, "commit", "-q", "-m", "init");
	const linked = join(base, "repo-wt");
	git(main, "worktree", "add", "-q", "-b", "feature", linked);
	return { base, main, linked };
}

function write(directory: string, name: string, content: string): void {
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, name), content);
}

test("CA-1: resuelve los dos pares de lugares, iguales desde el checkout principal y desde el worktree linkeado", async (t) => {
	const { base, main, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	for (const kind of ["grills", "specs"] as const) {
		const fromMain = await resolveArtifactDirs(main, kind);
		const fromLinked = await resolveArtifactDirs(linked, kind);
		assert.deepEqual(fromMain, {
			tracked: join(main, ".chiche", kind),
			local: join(main, ".git", "chiche", kind),
			legacyTracked: join(main, ".sdd", kind),
			legacyLocal: join(main, ".git", "sdd", kind),
		});
		assert.deepEqual(fromLinked, {
			tracked: join(linked, ".chiche", kind),
			local: fromMain.local,
			legacyTracked: join(linked, ".sdd", kind),
			legacyLocal: fromMain.legacyLocal,
		});
	}
});

test("CA-1: escribir en el lugar local de chiche deja git status vacío en el checkout principal y en el worktree", async (t) => {
	const { base, main, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	for (const [root, kind] of [[main, "grills"], [linked, "specs"]] as const) {
		write((await resolveArtifactDirs(root, kind)).local, `borrador-${kind}.md`, "# borrador\n");
	}
	for (const root of [main, linked]) {
		assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), "", `${root}: git status vacío`);
	}
});

test("CA-1: isArtifactPath acepta solo los cuatro directorios y rechaza cualquier otra ruta", async (t) => {
	const { base, main, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const dirs = await resolveArtifactDirs(linked, "specs");
	for (const directory of [dirs.tracked, dirs.local, dirs.legacyTracked, dirs.legacyLocal]) {
		assert.equal(isArtifactPath(dirs, join(directory, "a.md")), true, `acepta ${directory}`);
	}
	for (const outside of [
		join(linked, "a.md"),
		join(linked, ".sdd", "grills", "a.md"),
		join(linked, ".chiche", "grills", "a.md"),
		join(dirs.tracked, "sub", "a.md"),
		join(dirs.legacyTracked, "sub", "a.md"),
		join(dirs.local, "..", "a.md"),
		join(dirs.legacyLocal, "sub", "a.md"),
		join(main, ".chiche", "specs", "a.md"),
		join(main, ".sdd", "specs", "a.md"),
		"relativa/a.md",
	]) {
		assert.equal(isArtifactPath(dirs, outside), false, `rechaza ${outside}`);
	}
});

test("CA-1: listArtifacts une los cuatro lugares; gana el trackeado sobre el local y chiche sobre sdd", async (t) => {
	const { base, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const dirs = await resolveArtifactDirs(linked, "grills");
	// a: en los cuatro. b: sdd trackeado contra chiche local. c: chiche local
	// contra sdd local. d: solo sdd local. e: solo chiche trackeado.
	for (const name of ["a.md", "e.md"]) write(dirs.tracked, name, "chiche trackeado\n");
	for (const name of ["a.md", "b.md"]) write(dirs.legacyTracked, name, "sdd trackeado\n");
	for (const name of ["a.md", "b.md", "c.md"]) write(dirs.local, name, "chiche local\n");
	for (const name of ["a.md", "c.md", "d.md"]) write(dirs.legacyLocal, name, "sdd local\n");
	write(dirs.local, "notas.txt", "no es markdown\n");
	mkdirSync(join(dirs.legacyLocal, "capturas.md"), { recursive: true });
	assert.deepEqual(await listArtifacts(dirs), [
		{ name: "a.md", path: join(dirs.tracked, "a.md"), location: "tracked", brand: "chiche" },
		{ name: "b.md", path: join(dirs.legacyTracked, "b.md"), location: "tracked", brand: "sdd" },
		{ name: "c.md", path: join(dirs.local, "c.md"), location: "local", brand: "chiche" },
		{ name: "d.md", path: join(dirs.legacyLocal, "d.md"), location: "local", brand: "sdd" },
		{ name: "e.md", path: join(dirs.tracked, "e.md"), location: "tracked", brand: "chiche" },
	]);
});

test("CA-1: resolveArtifactName devuelve el existente con la misma precedencia y, si no hay, el local de chiche", async (t) => {
	const { base, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const dirs = await resolveArtifactDirs(linked, "specs");
	assert.equal(await resolveArtifactName(dirs, "nueva.md"), join(dirs.local, "nueva.md"));
	write(dirs.legacyLocal, "x.md", "sdd local\n");
	assert.equal(await resolveArtifactName(dirs, "x.md"), join(dirs.legacyLocal, "x.md"));
	write(dirs.local, "x.md", "chiche local\n");
	assert.equal(await resolveArtifactName(dirs, "x.md"), join(dirs.local, "x.md"));
	write(dirs.legacyTracked, "x.md", "sdd trackeado\n");
	assert.equal(await resolveArtifactName(dirs, "x.md"), join(dirs.legacyTracked, "x.md"));
	write(dirs.tracked, "x.md", "chiche trackeado\n");
	assert.equal(await resolveArtifactName(dirs, "x.md"), join(dirs.tracked, "x.md"));
});

test("CA-1: fuera de un repo git, local es igual a tracked en cada marca y el listado no duplica", async (t) => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "chiche-paths-nogit-")));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const dirs = await resolveArtifactDirs(base, "specs");
	assert.deepEqual(dirs, trackedArtifactDirs(base, "specs"));
	assert.equal(dirs.tracked, join(base, ".chiche", "specs"));
	assert.equal(dirs.local, dirs.tracked);
	assert.equal(dirs.legacyTracked, join(base, ".sdd", "specs"));
	assert.equal(dirs.legacyLocal, dirs.legacyTracked);
	assert.deepEqual(artifactReadDirs(dirs), [
		{ path: dirs.tracked, location: "tracked", brand: "chiche" },
		{ path: dirs.legacyTracked, location: "tracked", brand: "sdd" },
	]);
	write(dirs.tracked, "x.md", "x\n");
	write(dirs.legacyTracked, "y.md", "y\n");
	assert.deepEqual(await listArtifacts(dirs), [
		{ name: "x.md", path: join(dirs.tracked, "x.md"), location: "tracked", brand: "chiche" },
		{ name: "y.md", path: join(dirs.legacyTracked, "y.md"), location: "tracked", brand: "sdd" },
	]);
});

test("CA-1: el runner de git es inyectable y un fallo de git degrada a los lugares trackeados", async () => {
	const calls: string[][] = [];
	const dirs = await resolveArtifactDirs("/proyecto", "grills", async (args, cwd) => {
		calls.push([cwd, ...args]);
		return { code: 0, stdout: "/proyecto/.git\n" };
	});
	assert.deepEqual(calls, [["/proyecto", "rev-parse", "--path-format=absolute", "--git-common-dir"]]);
	assert.deepEqual(dirs, {
		tracked: "/proyecto/.chiche/grills",
		local: "/proyecto/.git/chiche/grills",
		legacyTracked: "/proyecto/.sdd/grills",
		legacyLocal: "/proyecto/.git/sdd/grills",
	});
	assert.deepEqual(artifactReadDirs(dirs).map((entry) => entry.path), [
		"/proyecto/.chiche/grills",
		"/proyecto/.sdd/grills",
		"/proyecto/.git/chiche/grills",
		"/proyecto/.git/sdd/grills",
	]);
	const failed = await resolveArtifactDirs("/proyecto", "specs", async () => ({ code: 128, stdout: "" }));
	assert.deepEqual(failed, trackedArtifactDirs("/proyecto", "specs"));
	assert.equal(localArtifactDir("/proyecto/.git", "specs"), "/proyecto/.git/chiche/specs");
	assert.equal(localArtifactDir("/proyecto/.git", "specs", "sdd"), "/proyecto/.git/sdd/specs");
});

test("CA-1: sdd-paths.ts reexporta chiche-paths.ts con aviso @deprecated", async () => {
	const source = await readFile(new URL("./sdd-paths.ts", import.meta.url), "utf8");
	assert.match(source, /@deprecated/);
	assert.match(source, /from "\.\/chiche-paths\.ts"/);
	assert.equal(legacy.resolveSddArtifactDirs, resolveArtifactDirs);
	assert.equal(legacy.listSddArtifacts, listArtifacts);
	assert.equal(legacy.isSddArtifactPath, isArtifactPath);
	assert.equal(legacy.trackedSddArtifactDirs, trackedArtifactDirs);
	assert.equal(legacy.localSddArtifactDir, localArtifactDir);
	assert.equal(legacy.resolveGitCommonDir, resolveGitCommonDir);
	assert.equal(legacy.resolveRepoWorktrees, resolveRepoWorktrees);
});

// Los lugares que leen o escriben borradores resuelven las rutas con este
// módulo: ninguno vuelve a armar `.chiche/<kind>` o `.sdd/<kind>` a mano
// (spec #84, riesgo «la capa 2 toca mucho»).
const CONSUMERS = [
	"../grill-tools/index.ts",
	"../github-issues.ts",
	"../workflow-orchestrator/dispatch.ts",
	"../workflow-orchestrator/direct-launch.ts",
	"../workflow-resolution/index.ts",
	"../sdd-artifacts/sdd-events.ts",
	"../workflow-orchestrator/lifecycle.ts",
] as const;

for (const path of CONSUMERS) {
	test(`CA-1: ${path} resuelve las rutas con lib/chiche-paths.ts y no arma .chiche/<kind> ni .sdd/<kind> a mano`, async () => {
		const source = await readFile(new URL(path, import.meta.url), "utf8");
		assert.match(source, /lib\/chiche-paths\.ts"/, "importa lib/chiche-paths.ts");
		assert.doesNotMatch(source, /lib\/sdd-paths\.ts"/, "no importa el módulo deprecado");
		assert.doesNotMatch(source, /(?:join|resolve)\([^)]*"\.(?:sdd|chiche)",\s*"(?:grills|specs)"/, "sin rutas armadas a mano");
	});
}

test("review #86: resolveRepoWorktrees lista los worktrees del repo con el principal primero, desde cualquiera de ellos", async (t) => {
	const { base, main, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	assert.deepEqual(await resolveRepoWorktrees(linked), [main, linked]);
	assert.deepEqual(await resolveRepoWorktrees(main), [main, linked]);
	assert.deepEqual(await resolveRepoWorktrees(join(base, "no-existe")), []);
});
