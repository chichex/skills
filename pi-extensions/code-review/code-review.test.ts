import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const HARNESSES = ["codex", "opencode", "pi"] as const;
const INVOCATIONS = {
	codex: "$code-review",
	opencode: "/code-review",
	pi: "/skill:code-review",
} as const;

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

test("portable code-review publishes one COMMENT review by default with an explicit opt-out", async () => {
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/code-review/SKILL.md`);
		const invocation = INVOCATIONS[harness];

		assert.ok(
			markdown.includes(`${invocation} [<numero de PR | URL de PR>] [--no-publish]`),
			`${harness}: documenta el opt-out`,
		);
		assert.match(markdown, /Sin `--no-publish`, publicar automáticamente un único review de tipo `COMMENT`/);
		assert.match(markdown, /No abrir un gate ni pedir confirmación adicional/);
		assert.match(markdown, /`event`: `COMMENT`/);
		assert.match(markdown, /Volver a consultar `headRefOid` inmediatamente antes del POST/);
		assert.match(markdown, /No publicar si aplica `--no-publish` o si cambió el head SHA revisado/);
		assert.doesNotMatch(markdown, /## Gate obligatorio de publicación/);
		assert.doesNotMatch(markdown, /No publicar \(Recomendado\)|Pedir confirmación explícita/);
	}
});

test("READMEs document automatic publication and the preview-only opt-out", async () => {
	for (const path of ["README.md", "README.en.md"]) {
		const markdown = await readRepoFile(path);
		assert.match(markdown, /\*\*`code-review`\*\*[\s\S]*--no-publish/);
	}
});
