import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerWaitPrExtension } from "./index.ts";

const PORTABLE_HARNESSES = ["codex", "opencode", "pi"] as const;
const HARNESSES = [...PORTABLE_HARNESSES, "claude"] as const;
type Harness = (typeof HARNESSES)[number];

const INVOCATION: Record<Harness, string> = {
	claude: "/",
	codex: "$",
	opencode: "/",
	pi: "/skill:",
};

// Claude Code trae su propio /code-review, asi que claude/wait-pr delega en el
// comando nativo en vez de leer ../code-review/SKILL.md. El loop de monitoreo
// sigue siendo el mismo en los cuatro harnesses.
const MONITORING_CLAUSES = [
	"--include-open",
	"--once",
	"gh api --paginate",
	"node_id",
	"max_pr_number",
	"60 segundos",
	"created_at",
	"primer plano",
	"datos no confiables",
];

const MONITORING_PATTERNS = [
	/baseline.*abierto.*sin `--include-open`.*no se revisa/is,
	/default.*continuo.*hasta que el usuario cancele/is,
	/lote.*created_at.*m[aá]s antiguo.*secuencial/is,
	/URL can[oó]nica.*no.*t[ií]tulo.*body/is,
	/no duplica.*doctrina.*«skill:code-review»/is,
	/timeout.*no concluyente.*reanudar/is,
	/Nunca lanzar.*`&`.*`nohup`.*hu[eé]rfano/is,
	/ID.*seen.*antes.*review/is,
	/number.*>.*max_pr_number.*ciclo anterior/is,
	/reabierto.*no.*nuevo/is,
	/primero.*watermark.*despu[eé]s.*endpoint paginado/is,
	/baseline.*number.*>.*max_pr_number.*encola/is,
];

function repoFile(path: string): URL {
	return new URL(`../../${path}`, import.meta.url);
}

async function readRepoFile(path: string): Promise<string> {
	return readFile(repoFile(path), "utf8");
}

function frontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(match?.[1], "frontmatter presente");
	return Object.fromEntries(
		match[1]
			.split("\n")
			.map((line) => line.match(/^([a-z-]+):\s*(.*)$/))
			.filter((entry): entry is RegExpMatchArray => entry !== null)
			.map((entry) => [entry[1], entry[2].trim()]),
	);
}

function doctrine(markdown: string): string {
	const match = markdown.match(
		/<!-- wait-pr-doctrine:start -->\n([\s\S]*?)\n<!-- wait-pr-doctrine:end -->/,
	);
	assert.ok(match?.[1], "bloque normativo wait-pr presente");
	return match[1];
}

function normalizeDoctrine(markdown: string, harness: Harness): string {
	const prefix = INVOCATION[harness].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return doctrine(markdown).replace(
		new RegExp(`(^|[^A-Za-z0-9.])${prefix}(wait-pr|code-review)`, "gm"),
		(_match, before: string, name: string) => `${before}«skill:${name}»`,
	);
}

interface RegisteredCommand {
	description?: string;
	handler: (args: string, context: unknown) => Promise<void> | void;
}

interface CommandFixture {
	name: string;
	source: string;
	sourceInfo?: { path?: string };
}

function extensionHarness(commands: CommandFixture[]) {
	const registered = new Map<string, RegisteredCommand>();
	const sent: string[] = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const events: string[] = [];
	const pi = {
		registerCommand(name: string, command: RegisteredCommand) {
			registered.set(name, command);
		},
		getCommands() {
			return commands;
		},
		sendUserMessage(content: string) {
			events.push("send");
			sent.push(content);
		},
	} as unknown as ExtensionAPI;
	registerWaitPrExtension(pi, {
		stripSkillFrontmatter(content) {
			return content.replace(/^---\n[\s\S]*?\n---\n/, "");
		},
	});
	const context = (mode = "tui") => ({
		mode,
		async waitForIdle() {
			events.push("idle");
		},
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	});
	return { registered, sent, notifications, events, context };
}

test("wait-pr is packaged for all four harnesses with equivalent doctrine", async () => {
	const normalized = new Map<Harness, string>();
	for (const harness of HARNESSES) {
		const markdown = await readRepoFile(`${harness}/wait-pr/SKILL.md`);
		const metadata = frontmatter(markdown);
		assert.equal(metadata.name, "wait-pr", `${harness}: name`);
		assert.match(metadata.description ?? "", /PRs nuevos.*code-review/i, `${harness}: description`);
		normalized.set(harness, normalizeDoctrine(markdown, harness));
	}
	const reference = normalized.get("codex");
	assert.ok(reference);
	for (const harness of PORTABLE_HARNESSES.slice(1)) {
		assert.equal(normalized.get(harness), reference, `${harness}: doctrina equivalente`);
	}

	const piMetadata = frontmatter(await readRepoFile("pi/wait-pr/SKILL.md"));
	assert.match(piMetadata.compatibility ?? "", /\bgit\b/i);
	assert.match(piMetadata.compatibility ?? "", /\bgh\b/);
	assert.match(piMetadata.compatibility ?? "", /code-review/);

	const codexSidecar = await readRepoFile("codex/wait-pr/agents/openai.yaml");
	assert.match(codexSidecar, /default_prompt:\s*"[^"]*\$wait-pr[^"]*"/);
	assert.match(codexSidecar, /allow_implicit_invocation:\s*false/);
});

test("wait-pr doctrine has a race-safe, paginated, sequential review loop", async () => {
	for (const harness of HARNESSES) {
		const contract = normalizeDoctrine(await readRepoFile(`${harness}/wait-pr/SKILL.md`), harness);
		for (const clause of MONITORING_CLAUSES) {
			assert.ok(contract.includes(clause), `${harness}: ${clause}`);
		}
		for (const pattern of MONITORING_PATTERNS) {
			assert.match(contract, pattern, `${harness}: ${pattern}`);
		}
		assert.match(contract, /no autoriza.*publicar/is, `${harness}: publicar no se hereda`);
	}

	const piContract = normalizeDoctrine(await readRepoFile("pi/wait-pr/SKILL.md"), "pi");
	assert.ok(piContract.includes("../code-review/SKILL.md"));
	assert.match(piContract, /confirmación explícita/i);
	assert.match(piContract, /no autoriza.*publicar.*gate.*code-review/is);
});

test("claude/wait-pr delegates to the code-review built into Claude Code", async () => {
	const markdown = await readRepoFile("claude/wait-pr/SKILL.md");
	const contract = doctrine(markdown);

	// El repo no mantiene un code-review propio para claude: el harness ya lo trae.
	await assert.rejects(access(repoFile("claude/code-review/SKILL.md")));
	assert.doesNotMatch(contract, /\.\.\/code-review\/SKILL\.md/, "no lee un SKILL.md inexistente");
	assert.match(contract, /`\/code-review` nativo de Claude Code/);

	// Extras que pertenecen a otros harnesses.
	assert.equal(frontmatter(markdown).compatibility, undefined, "compatibility es de Pi");
	await assert.rejects(access(repoFile("claude/wait-pr/agents/openai.yaml")));

	// Los flags de escritura del comando nativo no se heredan de la invocacion.
	assert.match(contract, /`--comment` y `--fix` nunca se agregan por iniciativa de este skill/);
	assert.match(contract, /No publicar comments[\s\S]*`--comment` o `--fix`[\s\S]*iniciativa propia/);
});

test("Pi /wait-pr materializes the canonical skill and preserves arguments", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "wait-pr-command-"));
	try {
		const skillPath = join(temporary, "SKILL.md");
		await writeFile(skillPath, "---\nname: wait-pr\ndescription: Wait\n---\n# Wait PR\n\nMonitor.\n", "utf8");
		const harness = extensionHarness([
			{ name: "skill:wait-pr", source: "skill", sourceInfo: { path: skillPath } },
			{ name: "skill:code-review", source: "skill", sourceInfo: { path: join(temporary, "code-review.md") } },
		]);
		const command = harness.registered.get("wait-pr");
		assert.ok(command, "/wait-pr registrado");
		assert.match(command.description ?? "", /PRs nuevos.*code-review/i);

		await command.handler("  --once  ", harness.context());
		assert.deepEqual(harness.events, ["idle", "send"]);
		assert.equal(harness.sent.length, 1);
		assert.match(harness.sent[0] ?? "", new RegExp(`<skill name="wait-pr" location="${skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
		assert.match(harness.sent[0] ?? "", /# Wait PR\n\nMonitor\./);
		assert.match(harness.sent[0] ?? "", /\n\n--once$/);
		assert.doesNotMatch(harness.sent[0] ?? "", /\/skill:wait-pr/);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});

test("Pi /wait-pr fails closed outside TUI or without code-review", async () => {
	const outsideTui = extensionHarness([]);
	await outsideTui.registered.get("wait-pr")!.handler("", outsideTui.context("rpc"));
	assert.deepEqual(outsideTui.sent, []);
	assert.match(outsideTui.notifications[0]?.message ?? "", /modo TUI/i);

	const missingReview = extensionHarness([
		{ name: "skill:wait-pr", source: "skill", sourceInfo: { path: "/tmp/wait-pr/SKILL.md" } },
	]);
	await missingReview.registered.get("wait-pr")!.handler("", missingReview.context());
	assert.deepEqual(missingReview.sent, []);
	assert.match(missingReview.notifications[0]?.message ?? "", /code-review/i);

	const missingWaitPr = extensionHarness([
		{ name: "skill:code-review", source: "skill", sourceInfo: { path: "/tmp/code-review/SKILL.md" } },
	]);
	await missingWaitPr.registered.get("wait-pr")!.handler("", missingWaitPr.context());
	assert.deepEqual(missingWaitPr.sent, []);
	assert.match(missingWaitPr.notifications[0]?.message ?? "", /wait-pr.*not present/i);
});

test("READMEs document the portable skill and Pi launcher", async () => {
	for (const path of ["README.md", "README.en.md"]) {
		const markdown = await readRepoFile(path);
		assert.match(markdown, /\| \*\*`wait-pr`\*\* \|/);
		assert.match(markdown, /\*\*`wait-pr`\*\*[\s\S]*`\/wait-pr`/);
		assert.match(markdown, /\| \*\*`wait-pr`\*\* \|[^\n]*(nativo|built-in)/);
	}
});
