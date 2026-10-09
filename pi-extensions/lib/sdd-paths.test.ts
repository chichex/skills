// CA-9 (spec #84): los borradores de planificación viven en
// <git-common-dir>/sdd/<kind>, fuera del working tree, y el árbol trackeado
// <root>/.sdd/<kind> sigue siendo el segundo lugar de lectura. Los tests usan
// un repo git temporal real con un worktree linkeado: el common-dir es el
// mismo desde los dos checkouts y queda fuera de los dos working trees.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { isSddArtifactPath, listSddArtifacts, resolveSddArtifactDirs } from "./sdd-paths.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-c", "user.name=sdd", "-c", "user.email=sdd@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		encoding: "utf8",
	});
}

function repoWithLinkedWorktree(): { base: string; main: string; linked: string } {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "sdd-paths-")));
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

test("CA-9: la ruta local coincide desde el checkout principal y desde el worktree linkeado", async (t) => {
	const { base, main, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	for (const kind of ["grills", "specs"] as const) {
		const fromMain = await resolveSddArtifactDirs(main, kind);
		const fromLinked = await resolveSddArtifactDirs(linked, kind);
		assert.equal(fromMain.local, join(main, ".git", "sdd", kind));
		assert.equal(fromLinked.local, fromMain.local, `${kind}: misma ruta local desde los dos checkouts`);
		assert.equal(fromMain.tracked, join(main, ".sdd", kind));
		assert.equal(fromLinked.tracked, join(linked, ".sdd", kind));
	}
});

test("CA-9: después de escribir en local, git status queda vacío en el checkout principal y en el worktree", async (t) => {
	const { base, main, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	for (const [root, kind] of [[main, "grills"], [linked, "specs"]] as const) {
		const { local } = await resolveSddArtifactDirs(root, kind);
		mkdirSync(local, { recursive: true });
		writeFileSync(join(local, `borrador-${kind}.md`), "# borrador\n");
	}
	for (const root of [main, linked]) {
		assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), "", `${root}: git status vacío`);
	}
});

test("CA-9: isSddArtifactPath acepta solo los dos directorios y rechaza cualquier otra ruta", async (t) => {
	const { base, main, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const dirs = await resolveSddArtifactDirs(linked, "specs");
	assert.equal(isSddArtifactPath(dirs, join(dirs.tracked, "a.md")), true);
	assert.equal(isSddArtifactPath(dirs, join(dirs.local, "a.md")), true);
	for (const outside of [
		join(linked, "a.md"),
		join(linked, ".sdd", "grills", "a.md"),
		join(dirs.tracked, "sub", "a.md"),
		join(dirs.local, "..", "a.md"),
		join(dirs.local, "sub", "a.md"),
		join(main, ".sdd", "specs", "a.md"),
		"relativa/a.md",
	]) {
		assert.equal(isSddArtifactPath(dirs, outside), false, `rechaza ${outside}`);
	}
});

test("CA-9: listSddArtifacts une los dos lugares y ante el mismo nombre gana el trackeado", async (t) => {
	const { base, linked } = repoWithLinkedWorktree();
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const dirs = await resolveSddArtifactDirs(linked, "grills");
	mkdirSync(dirs.tracked, { recursive: true });
	mkdirSync(join(dirs.local, "capturas"), { recursive: true });
	writeFileSync(join(dirs.tracked, "a.md"), "trackeado\n");
	writeFileSync(join(dirs.local, "a.md"), "local\n");
	writeFileSync(join(dirs.local, "b.md"), "local\n");
	writeFileSync(join(dirs.local, "notas.txt"), "no es markdown\n");
	const entries = await listSddArtifacts(dirs);
	assert.deepEqual(entries, [
		{ name: "a.md", path: join(dirs.tracked, "a.md"), location: "tracked" },
		{ name: "b.md", path: join(dirs.local, "b.md"), location: "local" },
	]);
});

test("CA-9: fuera de un repo git, local es igual a tracked y el listado no duplica", async (t) => {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "sdd-paths-nogit-")));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const dirs = await resolveSddArtifactDirs(base, "specs");
	assert.equal(dirs.tracked, join(base, ".sdd", "specs"));
	assert.equal(dirs.local, dirs.tracked);
	mkdirSync(dirs.tracked, { recursive: true });
	writeFileSync(join(dirs.tracked, "x.md"), "x\n");
	assert.deepEqual(await listSddArtifacts(dirs), [{ name: "x.md", path: join(dirs.tracked, "x.md"), location: "tracked" }]);
});

test("CA-9: el runner de git es inyectable y un fallo de git degrada a tracked", async () => {
	const calls: string[][] = [];
	const dirs = await resolveSddArtifactDirs("/proyecto", "grills", async (args, cwd) => {
		calls.push([cwd, ...args]);
		return { code: 0, stdout: "/proyecto/.git\n" };
	});
	assert.deepEqual(calls, [["/proyecto", "rev-parse", "--path-format=absolute", "--git-common-dir"]]);
	assert.deepEqual(dirs, { tracked: "/proyecto/.sdd/grills", local: "/proyecto/.git/sdd/grills" });
	const failed = await resolveSddArtifactDirs("/proyecto", "specs", async () => ({ code: 128, stdout: "" }));
	assert.deepEqual(failed, { tracked: "/proyecto/.sdd/specs", local: "/proyecto/.sdd/specs" });
});

// Los lugares que leen o escriben borradores resuelven las rutas con este
// módulo: ninguno vuelve a armar `.sdd/grills` o `.sdd/specs` a mano (spec #84,
// riesgo «la capa 2 toca mucho»).
const CONSUMERS = [
	"../grill-tools/index.ts",
	"../github-issues.ts",
	"../workflow-orchestrator/dispatch.ts",
	"../workflow-orchestrator/direct-launch.ts",
] as const;

for (const path of CONSUMERS) {
	test(`CA-10 a CA-12: ${path} resuelve los borradores con lib/sdd-paths.ts y no arma .sdd/<kind> a mano`, async () => {
		const source = await readFile(new URL(path, import.meta.url), "utf8");
		assert.match(source, /lib\/sdd-paths\.ts"/, "importa lib/sdd-paths.ts");
		assert.doesNotMatch(source, /(?:join|resolve)\([^)]*"\.sdd",\s*"(?:grills|specs)"/, "sin rutas .sdd/<kind> armadas a mano");
	});
}
