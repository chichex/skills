// Gate del versionado y el release continuo.
//
// `VERSION` en la raiz es la unica fuente de la version del repo; package.json
// y .codex-plugin/plugin.json la repiten y CI exige que coincidan. Cada PR sube
// VERSION un paso semver respecto del branch base, y cada push a main crea el
// tag `v<VERSION>` con su release. Este gate ejecuta scripts/version.sh en
// repos git temporales y lee .github/workflows/ci.yml. Es solo-tests (sin
// index.ts), como events-gate, para no tocar el censo de factories del package.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts/version.sh");

type Run = { status: number | null; stdout: string; stderr: string };

function run(command: string, args: string[], cwd: string): Run {
	const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 10_000 });
	if (result.error) throw result.error;
	return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function git(cwd: string, ...args: string[]): void {
	const result = run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], cwd);
	assert.equal(result.status, 0, result.stderr);
}

function version(cwd: string, ...args: string[]): Run {
	return run("bash", [SCRIPT, ...args], cwd);
}

type Fixture = { version?: string; pkg?: string; codex?: string };

function writeFixture(dir: string, { version: v, pkg, codex }: Fixture): void {
	if (v !== undefined) writeFileSync(join(dir, "VERSION"), v);
	writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "x", version: pkg ?? "0.0.0" }, null, 2)}\n`);
	mkdirSync(join(dir, ".codex-plugin"), { recursive: true });
	writeFileSync(join(dir, ".codex-plugin/plugin.json"), `${JSON.stringify({ name: "x", version: codex ?? "0.0.0" }, null, 2)}\n`);
}

function withRepo(fixture: Fixture, body: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "version-gate-"));
	try {
		git(dir, "init", "-q", "-b", "main");
		writeFixture(dir, fixture);
		body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function synced(v: string): Fixture {
	return { version: `${v}\n`, pkg: v, codex: v };
}

test("check imprime la version cuando VERSION es semver y los manifests coinciden", () => {
	withRepo(synced("2.0.0"), (dir) => {
		const result = version(dir, "check");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "2.0.0\n");
		assert.equal(result.stderr, "");
	});
});

test("check falla si VERSION no existe", () => {
	withRepo({ pkg: "2.0.0", codex: "2.0.0" }, (dir) => {
		const result = version(dir, "check");
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "VERSION no existe en la raiz del repo\n");
	});
});

for (const bad of ["2.0", "v2.0.0", "2.0.0-rc.1", "02.0.0", "2.0.0 extra", ""]) {
	test(`check rechaza VERSION invalida: '${bad}'`, () => {
		withRepo({ version: `${bad}\n`, pkg: bad, codex: bad }, (dir) => {
			const result = version(dir, "check");
			assert.equal(result.status, 1);
			assert.equal(result.stdout, "");
			assert.equal(
				result.stderr,
				`VERSION invalida: '${bad}' (se espera MAJOR.MINOR.PATCH, por ejemplo 2.0.0)\n`,
			);
		});
	});
}

test("check acepta VERSION sin salto de linea final", () => {
	withRepo({ version: "2.0.0", pkg: "2.0.0", codex: "2.0.0" }, (dir) => {
		const result = version(dir, "check");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "2.0.0\n");
	});
});

test("check falla y nombra cada manifest desincronizado", () => {
	withRepo({ version: "2.0.0\n", pkg: "0.0.0", codex: "0.1.0" }, (dir) => {
		const result = version(dir, "check");
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(
			result.stderr,
			"package.json tiene version '0.0.0' y VERSION dice '2.0.0'\n" +
				".codex-plugin/plugin.json tiene version '0.1.0' y VERSION dice '2.0.0'\n",
		);
	});
});

for (const next of ["1.3.2", "1.4.0", "2.0.0"]) {
	test(`check --next-of 1.3.1 acepta ${next}`, () => {
		withRepo(synced(next), (dir) => {
			const result = version(dir, "check", "--next-of", "1.3.1");
			assert.equal(result.status, 0, result.stderr);
			assert.equal(result.stdout, `${next}\n`);
		});
	});
}

for (const wrong of ["1.3.1", "1.3.0", "1.3.3", "1.5.0", "1.4.1", "2.0.1", "3.0.0", "2.1.0"]) {
	test(`check --next-of 1.3.1 rechaza ${wrong}`, () => {
		withRepo(synced(wrong), (dir) => {
			const result = version(dir, "check", "--next-of", "1.3.1");
			assert.equal(result.status, 1);
			assert.equal(result.stdout, "");
			assert.equal(
				result.stderr,
				`VERSION '${wrong}' no es el siguiente de '1.3.1': usá 1.3.2, 1.4.0 o 2.0.0\n`,
			);
		});
	});
}

test("check --newer-than acepta saltos y rechaza iguales o menores", () => {
	withRepo(synced("2.0.3"), (dir) => {
		assert.equal(version(dir, "check", "--newer-than", "2.0.0").status, 0);
		assert.equal(version(dir, "check", "--newer-than", "1.9.12").status, 0);
		for (const base of ["2.0.3", "2.0.10", "2.1.0", "10.0.0"]) {
			const result = version(dir, "check", "--newer-than", base);
			assert.equal(result.status, 1, base);
			assert.equal(result.stdout, "");
			assert.equal(result.stderr, `VERSION '2.0.3' no es mayor que '${base}'\n`);
		}
	});
});

test("check rechaza una base invalida y opciones desconocidas", () => {
	withRepo(synced("2.0.0"), (dir) => {
		const badBase = version(dir, "check", "--next-of", "1.3");
		assert.equal(badBase.status, 2);
		assert.equal(badBase.stderr, "version base invalida: '1.3'\n");
		const unknown = version(dir, "check", "--loquesea");
		assert.equal(unknown.status, 2);
		assert.match(unknown.stderr, /^opcion desconocida: --loquesea\nuso: /);
		const none = version(dir);
		assert.equal(none.status, 2);
		assert.match(none.stderr, /^uso: /);
	});
});

test("base lee VERSION del ref y, sin archivo, cae al ultimo tag semver", () => {
	withRepo(synced("2.0.0"), (dir) => {
		rmSync(join(dir, "VERSION"));
		git(dir, "add", ".");
		git(dir, "commit", "-q", "-m", "init");
		git(dir, "tag", "v1.2.0");
		git(dir, "tag", "v1.10.0");
		git(dir, "tag", "otro-tag");
		const fromTag = version(dir, "base", "HEAD");
		assert.equal(fromTag.status, 0, fromTag.stderr);
		assert.equal(fromTag.stdout, "1.10.0\n");

		writeFileSync(join(dir, "VERSION"), "2.0.0\n");
		git(dir, "add", "VERSION");
		git(dir, "commit", "-q", "-m", "version");
		const fromFile = version(dir, "base", "HEAD");
		assert.equal(fromFile.status, 0, fromFile.stderr);
		assert.equal(fromFile.stdout, "2.0.0\n");
	});
});

test("base falla si el ref no tiene VERSION ni hay tags semver", () => {
	withRepo(synced("2.0.0"), (dir) => {
		rmSync(join(dir, "VERSION"));
		git(dir, "add", ".");
		git(dir, "commit", "-q", "-m", "init");
		const result = version(dir, "base", "HEAD");
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "no hay version base: HEAD no tiene VERSION y no hay tags vX.Y.Z\n");
	});
});

test("latest imprime el ultimo tag semver o nada", () => {
	withRepo(synced("2.0.0"), (dir) => {
		git(dir, "add", ".");
		git(dir, "commit", "-q", "-m", "init");
		const empty = version(dir, "latest");
		assert.equal(empty.status, 0, empty.stderr);
		assert.equal(empty.stdout, "");
		git(dir, "tag", "v1.9.0");
		git(dir, "tag", "v1.10.0");
		git(dir, "tag", "v1.10.0-rc.1");
		const latest = version(dir, "latest");
		assert.equal(latest.stdout, "1.10.0\n");
	});
});

test("el repo real tiene VERSION valida y los manifests sincronizados", () => {
	const result = version(REPO_ROOT, "check");
	assert.equal(result.status, 0, result.stderr);
	const current = readFileSync(join(REPO_ROOT, "VERSION"), "utf8").trim();
	assert.equal(result.stdout, `${current}\n`);
});

function jobBlock(workflow: string, job: string): string {
	const start = workflow.indexOf(`\n  ${job}:\n`);
	assert.notEqual(start, -1, `falta el job ${job} en ci.yml`);
	const rest = workflow.slice(start + 1);
	const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
	return next === -1 ? rest : rest.slice(0, next + 1);
}

test("ci.yml chequea la version en cada PR contra el branch base", () => {
	const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
	const job = jobBlock(workflow, "version");
	assert.match(job, /name: Versión semver\n/);
	assert.match(job, /fetch-depth: 0/);
	assert.match(job, /if: github\.event_name == 'pull_request'/);
	assert.match(job, /BASE_REF: \$\{\{ github\.base_ref \}\}/);
	assert.match(job, /bash scripts\/version\.sh base "origin\/\$BASE_REF"/);
	assert.match(job, /bash scripts\/version\.sh check --next-of "\$base"/);
	assert.match(job, /bash scripts\/version\.sh check\n/);
});

test("ci.yml crea el release solo en push a main y despues de los checks", () => {
	const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
	assert.match(workflow, /\npermissions:\n {2}contents: read\n/);
	const job = jobBlock(workflow, "release");
	assert.match(job, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
	const needs = job.match(/needs: \[([^\]]+)\]/)?.[1]?.split(",").map((name) => name.trim()).sort();
	assert.deepEqual(needs, ["frontmatter", "harness-gate", "plugin-validate", "shell", "tests", "version"]);
	assert.match(job, /permissions:\n {6}contents: write\n/);
	assert.match(job, /concurrency:\n {6}group: release\n {6}cancel-in-progress: false\n/);
	assert.match(job, /git ls-remote --exit-code --tags origin "refs\/tags\/v\$v"/);
	assert.match(job, /bash scripts\/version\.sh check --newer-than "\$latest"/);
	assert.match(
		job,
		/gh release create "v\$v" --target "\$GITHUB_SHA" --title "v\$v" --generate-notes/,
	);
	assert.match(job, /GH_TOKEN: \$\{\{ github\.token \}\}/);
});

test("shellcheck y bash -n de CI cubren scripts/version.sh", () => {
	const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
	assert.match(workflow, /bash -n scripts\/version\.sh\n/);
	assert.match(workflow, /shellcheck install\.sh scripts\/lint-frontmatter\.sh scripts\/drift-report\.sh scripts\/version\.sh\n/);
});
