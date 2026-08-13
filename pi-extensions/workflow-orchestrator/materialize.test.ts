import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { materializeSkill } from "./materialize.ts";

/**
 * Replicates Pi 0.84.1's real stripFrontmatter (utils/frontmatter.js) for
 * well-formed input, so tests can inject it as a dependency instead of
 * depending on @earendil-works/pi-coding-agent resolving under plain
 * `node --test` (it only resolves when loaded through Pi's own runtime; see
 * materialize.ts defaultStripFrontmatter and staging.ts createPiSessionManager
 * for the same, already-established pattern).
 */
function fakeStripFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return normalized;
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return normalized;
	return normalized.slice(endIndex + 4).trim();
}

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
			stripFrontmatter: fakeStripFrontmatter,
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
		stripFrontmatter: fakeStripFrontmatter,
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
		stripFrontmatter: fakeStripFrontmatter,
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.match(result.content, /\n# Sin frontmatter\nBody\n<\/skill>$/);
	assert.doesNotMatch(result.content, /<\/skill>\n\n/);
});

test("derives baseDir from the canonical path, ignoring a stale or extension-overwritten sourceInfo.baseDir", async () => {
	// Pi's own _expandSkillCommand never reads sourceInfo.baseDir — it reads
	// skill.baseDir, which skills.js loadSkillFromFile always sets to
	// dirname(filePath). sourceInfo itself CAN be overwritten with an unrelated
	// baseDir by resource-loader's findSourceInfoForPath for extension-
	// registered or metadata-matched skills, so a wrong/stale baseDir here must
	// not affect the result: dirname(path) wins regardless.
	const result = await materializeSkill("demo", "", {
		commands: [command("/canonical/demo/SKILL.md", "/some/unrelated/registration/dir")],
		readFile: async () => "# No frontmatter",
		stripFrontmatter: fakeStripFrontmatter,
	});

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.match(result.content, /References are relative to \/canonical\/demo\.\n/);
	assert.deepEqual(result.source, { path: "/canonical/demo/SKILL.md", baseDir: "/canonical/demo" });
});

test("fails closed with skill-frontmatter-invalid on malformed frontmatter YAML, instead of silently stripping and succeeding", async () => {
	// Pi's real stripFrontmatter parses the frontmatter YAML and throws on
	// malformed input; _expandSkillCommand then refuses to expand at all
	// (skill_expansion error, literal text passthrough). materializeSkill must
	// fail the same way rather than producing content Pi would never produce
	// for the same bytes.
	const result = await materializeSkill("demo", "", {
		commands: [command("/canonical/demo/SKILL.md", "/canonical/demo")],
		readFile: async () => "---\nname: [unterminated\n---\nBody\n",
		stripFrontmatter: () => {
			throw new Error("Flow sequence in block collection must be sufficiently indented and end with a ]");
		},
	});

	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.equal(result.code, "skill-frontmatter-invalid");
	assert.match(result.message, /unterminated|sequence|indented/);
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

test("without a stripFrontmatter override, falls back to Pi's real export and fails closed (not uncaught) where it cannot resolve", async () => {
	// The default dependency dynamically imports stripFrontmatter from
	// @earendil-works/pi-coding-agent, exactly like staging.ts's
	// createPiSessionManager does for SessionManager. That package only
	// resolves when Pi's own runtime loads this extension (verified manually
	// via `pi --extension ... --list-models`); under plain `node --test` it
	// does not resolve. Either way, materializeSkill must never reject
	// uncaught — a failed default must still surface as a typed result.
	const result = await materializeSkill("demo", "", {
		commands: [command("/canonical/demo/SKILL.md", "/canonical/demo")],
		readFile: async () => "# No frontmatter",
	});

	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.equal(result.code, "skill-frontmatter-invalid");
});
