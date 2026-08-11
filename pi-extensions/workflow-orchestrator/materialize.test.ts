import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { materializeSkill } from "./materialize.ts";

test("materializes one canonical skill exactly like Pi 0.84.1 without arguments", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-orchestrator-materialize-"));
	try {
		const skillPath = join(root, "demo", "SKILL.md");
		await mkdir(join(root, "demo"));
		await writeFile(skillPath, [
			"---",
			"name: demo",
			"description: Demo skill",
			"---",
			"",
			"# Demo",
			"",
			"Body.",
			"",
		].join("\n"), "utf8");

		const result = await materializeSkill("demo", "", {
			commands: [{
				name: "skill:demo",
				source: "skill",
				sourceInfo: {
					path: skillPath,
					baseDir: join(root, "demo"),
					source: "skills",
					scope: "temporary",
					origin: "top-level",
				},
			}],
		});

		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.content, [
			`<skill name="demo" location="${skillPath}">`,
			`References are relative to ${join(root, "demo")}.`,
			"",
			"# Demo",
			"",
			"Body.",
			"</skill>",
		].join("\n"));
		assert.deepEqual(result.source, { path: skillPath, baseDir: join(root, "demo") });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function command(path: string, baseDir: string, overrides: Record<string, unknown> = {}) {
	return {
		name: "skill:demo",
		source: "skill",
		sourceInfo: {
			path,
			baseDir,
			source: "skills",
			scope: "temporary",
			origin: "top-level",
		},
		...overrides,
	};
}

test("matches Pi 0.84.1 for CRLF frontmatter, Unicode body, and trimmed arguments", async () => {
	const reads: string[] = [];
	const result = await materializeSkill("demo", "  #13  \n", {
		commands: [command("/canonical/demo/SKILL.md", "/canonical/demo")],
		readFile: async (path) => {
			reads.push(path);
			return "---\r\nname: demo\r\ndescription: Prueba\r\n---\r\n\r\n# Órbita 🚀\r\n\r\nVer `references/á.md`.\r\n";
		},
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.content, [
		'<skill name="demo" location="/canonical/demo/SKILL.md">',
		"References are relative to /canonical/demo.",
		"",
		"# Órbita 🚀",
		"",
		"Ver `references/á.md`.",
		"</skill>",
		"",
		"#13",
	].join("\n"));
	assert.deepEqual(reads, ["/canonical/demo/SKILL.md"]);
});

test("normalizes EOL and trims a skill body even when no frontmatter exists", async () => {
	const result = await materializeSkill("demo", " \t ", {
		commands: [command("/canonical/demo/SKILL.md", "/canonical/demo")],
		readFile: async () => "\r\n# Sin frontmatter\rBody\r\n",
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.match(result.content, /\n# Sin frontmatter\nBody\n<\/skill>$/);
	assert.doesNotMatch(result.content, /<\/skill>\n\n/);
});

test("fails closed on missing, non-skill, ambiguous, and unusable provenance without reading", async () => {
	let reads = 0;
	const readFile = async () => {
		reads += 1;
		return "body";
	};
	const cases = [
		{
			name: "missing",
			commands: [],
			code: "skill-not-found",
		},
		{
			name: "non-skill",
			commands: [command("/canonical/demo/SKILL.md", "/canonical/demo", { source: "extension" })],
			code: "skill-not-skill",
		},
		{
			name: "ambiguous",
			commands: [
				command("/canonical/a/SKILL.md", "/canonical/a"),
				command("/canonical/b/SKILL.md", "/canonical/b"),
			],
			code: "skill-ambiguous",
		},
		{
			name: "missing baseDir",
			commands: [command("/canonical/demo/SKILL.md", "/canonical/demo", {
				sourceInfo: { path: "/canonical/demo/SKILL.md" },
			})],
			code: "skill-provenance-invalid",
		},
		{
			name: "relative provenance",
			commands: [command("relative/SKILL.md", "relative")],
			code: "skill-provenance-invalid",
		},
	] as const;

	for (const fixture of cases) {
		const result = await materializeSkill("demo", "", { commands: fixture.commands, readFile });
		assert.equal(result.ok, false, fixture.name);
		if (result.ok) continue;
		assert.equal(result.code, fixture.code, fixture.name);
	}
	assert.equal(reads, 0, "invalid catalog entries never trigger filesystem discovery");
});

test("reports an unreadable canonical file without falling back to another path", async () => {
	const attempted: string[] = [];
	const result = await materializeSkill("demo", "", {
		commands: [command("/canonical/demo/SKILL.md", "/canonical/demo")],
		readFile: async (path) => {
			attempted.push(path);
			throw Object.assign(new Error("permission denied"), { code: "EACCES" });
		},
	});

	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.equal(result.code, "skill-unreadable");
	assert.match(result.message, /permission denied/);
	assert.deepEqual(attempted, ["/canonical/demo/SKILL.md"]);
});
