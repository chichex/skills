import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const HARNESSES = ["claude", "codex", "pi"] as const;
type Harness = (typeof HARNESSES)[number];

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

export function artifactAwareBlock(markdown: string): string {
	const match = markdown.match(
		/<!-- artifact-aware:start -->\n([\s\S]*?)\n<!-- artifact-aware:end -->/,
	);
	assert.ok(match?.[1], "bloque normativo artifact-aware presente");
	return match[1];
}

interface InteractionDifferences {
	invocation: Record<Harness, string>;
	questionTool: Record<Harness, string>;
}

export function parseInteractionDifferences(markdown: string): InteractionDifferences {
	const block = markdown.match(
		/<!-- interaction-differences:start -->\n([\s\S]*?)\n<!-- interaction-differences:end -->/,
	);
	assert.ok(block?.[1], "tabla normativa de interacción presente");
	const rows = block[1].split("\n").filter((line) => line.startsWith("|"));
	const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", ""));
	const header = cells(rows[0] ?? "");
	const indexes = new Map(header.map((name, index) => [name, index]));
	const row = (name: string): string[] => cells(rows.find((line) => cells(line)[0] === name) ?? "");
	const invocations = row("invocacion");
	const tools = row("tool-preguntas");
	const invocation = {} as Record<Harness, string>;
	const questionTool = {} as Record<Harness, string>;
	for (const harness of HARNESSES) {
		const index = indexes.get(harness);
		assert.notEqual(index, undefined, `columna ${harness} presente`);
		const invocationPattern = invocations[index!] ?? "";
		assert.ok(invocationPattern.endsWith("nombre"), `${harness}: patrón de invocación válido`);
		invocation[harness] = invocationPattern.slice(0, -"nombre".length);
		questionTool[harness] = tools[index!] ?? "";
	}
	return { invocation, questionTool };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeArtifactAwareBlock(
	block: string,
	harness: Harness,
	differences: InteractionDifferences,
): string {
	const invocation = differences.invocation[harness];
	const questionTool = differences.questionTool[harness];
	let normalized = block.replace(
		new RegExp(`${escapeRegExp(invocation)}(issue-triage|quick-run|grill|sdd-spec|sdd-run)`, "g"),
		(_match, name: string) => `«skill:${name}»`,
	);
	if (questionTool && questionTool !== "—") {
		normalized = normalized.replaceAll(questionTool, "«question-tool»");
	}
	return normalized;
}

export function compareArtifactAwareBlocks(blocks: Map<Harness, string>): string[] {
	const reference = blocks.get("claude") ?? "";
	const differences: string[] = [];
	for (const harness of HARNESSES.slice(1)) {
		if ((blocks.get(harness) ?? "") !== reference) differences.push(`${harness} diverge de claude`);
	}
	return differences;
}

const REQUIRED_ROUTES = [
	"resume-grill",
	"spec-from-grill",
	"update-existing-spec",
	"run-existing-spec",
	"already-implemented",
	"superseded-artifact",
	"audit-existing-spec",
	"artifact-conflict",
] as const;

const REQUIRED_SCHEMA_FIELDS = [
	"version",
	"outcome",
	"code",
	"recommendedClassification",
	"fallbackClassification",
	"recommendedRoute",
	"selectedRoute",
	"stage",
	"mode",
	"repo",
	"cwd",
	"sources",
	"canonicalIssue",
	"summary",
	"impactExample",
	"scope",
	"checklist",
	"evidence",
	"risks",
	"artifacts",
] as const;

test("issue-triage has one equivalent artifact-aware contract in all existing harnesses", async () => {
	const interaction = parseInteractionDifferences(await readRepoFile("docs/harness-interaction-differences.md"));
	const blocks = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/issue-triage/SKILL.md`);
		blocks.set(harness, normalizeArtifactAwareBlock(artifactAwareBlock(markdown), harness, interaction));
		assert.doesNotMatch(markdown, /## Fase 6 — Ejecutar la ruta/);
		assert.doesNotMatch(markdown, /Creá un worktree hermano/);
		assert.doesNotMatch(markdown, /Quick-run completo:/);
		assert.doesNotMatch(markdown, /Cargá (?:completo )?(?:el skill )?[`~/.a-z-]*(?:grill|sdd-spec)\/SKILL\.md/);
	}
	assert.deepEqual(compareArtifactAwareBlocks(blocks), []);

	const contract = blocks.get("pi") ?? "";
	for (const route of REQUIRED_ROUTES) assert.match(contract, new RegExp(`\\b${route}\\b`), route);
	for (const field of REQUIRED_SCHEMA_FIELDS) assert.match(contract, new RegExp(`\\b${field}\\b`), field);
	for (const rule of [
		"parseSddArtifact",
		"CRLF",
		"Body original",
		"superseded-by",
		"fresh|stale|unknown",
		"parentId",
		"canonicalization",
		"selectedRoute=null",
		"JSON.parse(JSON.stringify(result))",
	]) {
		assert.ok(contract.includes(rule), rule);
	}
	assert.match(contract, /termina.*sin ejecutar.*stage/is);
	assert.match(contract, /no ejecuta grill, spec, run ni quick-run/i);
});

test("artifact-aware gate reports injected route/schema drift", () => {
	const base = "route=run-existing-spec\nselectedRoute=null";
	const blocks = new Map<Harness, string>([
		["claude", base],
		["codex", base.replace("run-existing-spec", "quick-run")],
		["pi", base],
	]);
	assert.deepEqual(compareArtifactAwareBlocks(blocks), ["codex diverge de claude"]);
});

test("issue-triage remains absent from OpenCode", async () => {
	await assert.rejects(access(repoFile("opencode/issue-triage/SKILL.md")));
});
