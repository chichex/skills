import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(repoFile(path), "utf8")) as T;
}

test("el plugin de Codex carga el set codex y no el set claude", async () => {
	const codex = await readJson<{ name: string; version: string; skills: string }>(".codex-plugin/plugin.json");
	const claude = await readJson<{ name: string; skills: string[] }>(".claude-plugin/plugin.json");

	assert.equal(codex.name, "chiche");
	assert.equal(codex.version, (await readFile(repoFile("VERSION"), "utf8")).trim());
	assert.equal(codex.skills, "./codex/");
	assert.equal(claude.name, codex.name);
	assert.deepEqual(claude.skills, ["./claude"]);
});

test("#103 CA-9: los manifests y los marketplaces publican el plugin chiche y abren su descripcion con la marca", async () => {
	const pkg = await readJson<{ name: string }>("package.json");
	assert.equal(pkg.name, "chiche");
	for (const path of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
		const manifest = await readJson<{ name: string; description: string }>(path);
		assert.equal(manifest.name, "chiche", path);
		assert.match(manifest.description, /^chiche: /, path);
	}
	const claudeMarketplace = await readJson<{ plugins: Array<{ name: string; description: string }> }>(
		".claude-plugin/marketplace.json",
	);
	assert.deepEqual(claudeMarketplace.plugins.map((plugin) => plugin.name), ["chiche"]);
	assert.match(claudeMarketplace.plugins[0]?.description ?? "", /^chiche: /);
	const codexMarketplace = await readJson<{ interface: { displayName: string } }>(".agents/plugins/marketplace.json");
	assert.match(codexMarketplace.interface.displayName, /^chiche\b/);
});

test("el marketplace nativo de Codex publica el plugin desde la raiz", async () => {
	const marketplace = await readJson<{
		name: string;
		plugins: Array<{
			name: string;
			source: { source: string; path: string };
			policy: { installation: string; authentication: string; products: string[] };
			category: string;
		}>;
	}>(".agents/plugins/marketplace.json");

	assert.equal(marketplace.name, "chichex");
	assert.equal(marketplace.plugins.length, 1);
	const [plugin] = marketplace.plugins;
	assert.equal(plugin?.name, "chiche");
	assert.deepEqual(plugin?.source, { source: "local", path: "./" });
	assert.deepEqual(plugin?.policy, {
		installation: "AVAILABLE",
		authentication: "ON_INSTALL",
		products: ["CODEX"],
	});
	assert.equal(plugin?.category, "Developer Tools");

	for (const readmePath of ["README.md", "README.en.md"]) {
		const readme = await readFile(repoFile(readmePath), "utf8");
		assert.match(readme, /codex plugin marketplace add chichex\/skills/);
		assert.match(readme, /codex plugin add chiche@chichex/);
		assert.match(readme, /codex plugin marketplace upgrade chichex/);
	}
});

test("todos los directorios publicados contienen SKILL.md", async () => {
	const entries = await readdir(repoFile("codex"), { withFileTypes: true });
	const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
	assert.ok(skillDirs.length > 0);

	for (const skillDir of skillDirs) {
		const skill = await readFile(repoFile(`codex/${skillDir}/SKILL.md`), "utf8");
		assert.match(skill, /^---\n/);
	}
});
