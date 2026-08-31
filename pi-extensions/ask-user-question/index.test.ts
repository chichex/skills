import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	accessSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

interface RegisteredTool {
	name: string;
	execute: (...args: any[]) => Promise<any>;
}

function findPiPackageRoot(): string | undefined {
	const located = spawnSync("sh", ["-c", "command -v pi"], { encoding: "utf8" });
	const executable = located.status === 0 ? located.stdout.trim() : "";
	if (!executable) return undefined;
	try {
		const root = resolve(dirname(realpathSync(executable)), "../..");
		accessSync(join(root, "package.json"));
		return root;
	} catch {
		return undefined;
	}
}

const PI_PACKAGE_ROOT = findPiPackageRoot();
let sandbox = "";
let tools = new Map<string, RegisteredTool>();
let visibleWidth: (text: string) => number;

before(async () => {
	if (!PI_PACKAGE_ROOT) return;
	sandbox = mkdtempSync(join(tmpdir(), "ask-user-question-test-"));
	copyFileSync(new URL("./index.ts", import.meta.url), join(sandbox, "index.ts"));

	const scopedRoot = join(sandbox, "node_modules", "@earendil-works");
	mkdirSync(scopedRoot, { recursive: true });
	for (const packageName of ["pi-ai", "pi-tui"]) {
		symlinkSync(
			join(PI_PACKAGE_ROOT, "node_modules", "@earendil-works", packageName),
			join(scopedRoot, packageName),
			"dir",
		);
	}
	symlinkSync(PI_PACKAGE_ROOT, join(scopedRoot, "pi-coding-agent"), "dir");
	symlinkSync(
		join(PI_PACKAGE_ROOT, "node_modules", "typebox"),
		join(sandbox, "node_modules", "typebox"),
		"dir",
	);

	const [{ default: register }, tui] = await Promise.all([
		import(`${pathToFileURL(join(sandbox, "index.ts")).href}?test=${Date.now()}`),
		import(pathToFileURL(join(PI_PACKAGE_ROOT, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js")).href),
	]);
	visibleWidth = tui.visibleWidth;
	register({
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		events: { on() {} },
		on() {},
	} as never);
});

after(() => {
	if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};
const ansiTheme = {
	fg: (_color: string, text: string) => `\x1b[38;5;250m${text}\x1b[39m`,
	bg: (_color: string, text: string) => `\x1b[48;5;237m${text}\x1b[49m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

function tuiContext(
	drive: (component: { render(width: number): string[]; handleInput(data: string): void }) => void,
	theme = plainTheme,
) {
	return {
		mode: "tui",
		ui: {
			async custom(factory: (...args: any[]) => any) {
				return await new Promise((resolveDone) => {
					const tui = { requestRender() {} };
					const component = factory(tui, theme, {}, resolveDone);
					drive(component);
				});
			},
		},
	};
}

function activeGrillContext(
	interviewMode: "unselected" | "fast" | "rounds" | "adaptive",
	drive: (component: { render(width: number): string[]; handleInput(data: string): void }) => void,
) {
	return {
		...tuiContext(drive),
		sessionManager: {
			getBranch() {
				return [{
					type: "message",
					message: {
						role: "toolResult",
						toolName: "grill_session",
						details: {
							action: "configure",
							snapshot: {
								id: "grill-rounds-test",
								status: "active",
								interviewMode,
							},
						},
					},
				}];
			},
		},
	};
}

test("ask_user_question reflows long recommendations when the available width shrinks", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("ask_user_question");
	assert.ok(tool);
	const reason = "La definición de editado condiciona reversiones, presets, filas dinámicas, señal accesible, cobertura DS y lifecycle; además comparte superficie con otra decisión y puede abrir o cerrar repreguntas materiales.";

	const result = await tool.execute(
		"call-single",
		{
			question: "¿Cómo querés recorrer estas decisiones?",
			options: [{
				value: "adaptive",
				label: "Grillado pregunta a pregunta",
				description: "Cada respuesta recalcula las ramas siguientes.",
				recommended: true,
				recommendationReason: reason,
			}],
			allowOther: true,
		},
		undefined,
		undefined,
		tuiContext((component) => {
			component.render(396);
			const narrow = component.render(196);
			assert.ok(
				narrow.every((line) => visibleWidth(line) <= 196),
				`rendered widths: ${narrow.map((line) => visibleWidth(line)).join(", ")}`,
			);
			component.handleInput("\r");
		}, ansiTheme),
	);

	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answers[0].value, "adaptive");
});

test("ask_user_questions collects a round of independent decisions in one UI", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("ask_user_questions");
	assert.ok(tool, "round tool is registered");
	assert.equal((tool as any).parameters.properties.questions.minItems, 2);
	assert.equal((tool as any).parameters.properties.questions.maxItems, 4);
	let customCalls = 0;

	const result = await tool.execute(
		"call-round",
		{
			questions: [
				{
					id: "scope",
					section: "Alcance",
					question: "¿Qué alcance confirmamos?",
					options: [{ value: "narrow", label: "Acotado", recommended: true }],
					allowOther: true,
				},
				{
					id: "rollout",
					section: "Entrega",
					question: "¿Cómo hacemos el rollout?",
					options: [{ value: "gradual", label: "Gradual", recommended: true }],
					allowOther: true,
				},
			],
		},
		undefined,
		undefined,
		tuiContext((component) => {
			customCalls++;
			component.render(300);
			assert.ok(component.render(80).every((line) => visibleWidth(line) <= 80));
			component.handleInput("\r");
			component.handleInput("\r");
			component.handleInput("\r");
		}),
	);

	assert.equal(customCalls, 1);
	assert.equal(result.details.cancelled, false);
	assert.deepEqual(
		result.details.questions.map((question: any) => [question.id, question.answers[0]?.value]),
		[["scope", "narrow"], ["rollout", "gradual"]],
	);
});

test("round mode blocks the singular tool when several decisions are unblocked", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("ask_user_question");
	assert.ok(tool);
	let customCalls = 0;

	await assert.rejects(
		tool.execute(
			"call-invalid-single-round",
			{
				question: "¿Qué política confirmamos para estas cuatro decisiones?",
				options: [{ value: "default", label: "Usar defaults" }],
				allowOther: true,
				grill: {
					sessionId: "grill-rounds-test",
					phase: "interview",
					frontierSize: 4,
				},
			},
			undefined,
			undefined,
			activeGrillContext("rounds", (component) => {
				customCalls++;
				component.handleInput("\r");
			}),
		),
		/ask_user_questions.*required/i,
	);
	assert.equal(customCalls, 0, "the invalid singular prompt must be blocked before opening the TUI");
});

test("round mode permits a singular one-question frontier when declared explicitly", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("ask_user_question");
	assert.ok(tool);

	const result = await tool.execute(
		"call-valid-single-round",
		{
			question: "¿Qué alcance confirmamos?",
			options: [{ value: "narrow", label: "Acotado" }],
			grill: {
				sessionId: "grill-rounds-test",
				phase: "interview",
				frontierSize: 1,
			},
		},
		undefined,
		undefined,
		activeGrillContext("rounds", (component) => component.handleInput("\r")),
	);

	assert.equal(result.details.cancelled, false);
	assert.equal(result.details.answers[0].value, "narrow");
});

test("adaptive mode blocks the plural round tool", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("ask_user_questions");
	assert.ok(tool);

	await assert.rejects(
		tool.execute(
			"call-invalid-adaptive-round",
			{
				questions: [
					{ id: "one", question: "¿Primera?", options: [{ value: "a", label: "A" }] },
					{ id: "two", question: "¿Segunda?", options: [{ value: "b", label: "B" }] },
				],
				grill: {
					sessionId: "grill-rounds-test",
					phase: "interview",
					frontierSize: 2,
				},
			},
			undefined,
			undefined,
			activeGrillContext("adaptive", (component) => {
				component.handleInput("\r");
				component.handleInput("\r");
				component.handleInput("\r");
			}),
		),
		/ask_user_question.*required/i,
	);
});

test("ask_user_questions preserves an intentional empty answer when a later decision cancels", { skip: !PI_PACKAGE_ROOT }, async () => {
	const tool = tools.get("ask_user_questions");
	assert.ok(tool);

	const result = await tool.execute(
		"call-partial-round",
		{
			questions: [
				{
					id: "optional",
					question: "¿Activamos alguna política opcional?",
					options: [{ value: "coverage", label: "Coverage" }],
					selectionMode: "multiple",
					allowEmptySelection: true,
				},
				{
					id: "required",
					question: "¿Qué estrategia usamos?",
					options: [{ value: "safe", label: "Segura" }],
				},
			],
		},
		undefined,
		undefined,
		tuiContext((component) => {
			component.handleInput("\r");
			component.handleInput("\x1b");
		}),
	);

	assert.equal(result.details.cancelled, true);
	assert.equal(result.details.questions[0].cancelled, false);
	assert.deepEqual(result.details.questions[0].answers, []);
	assert.equal(result.details.questions[1].cancelled, true);
});

test("Pi grill exposes quick, rounds, and one-by-one as distinct modes", async () => {
	const skill = await import("node:fs/promises").then(({ readFile }) =>
		readFile(new URL("../../pi/grill/SKILL.md", import.meta.url), "utf8")
	);
	assert.match(skill, /\*\*Grillado rápido\*\*/);
	assert.match(skill, /\*\*Por rondas\*\*/);
	assert.match(skill, /\*\*Grillado pregunta a pregunta\*\*/);
	assert.match(skill, /`ask_user_questions`/);
	assert.match(skill, /frontera de dependencias/i);
	assert.match(skill, /hasta 4 preguntas/i);
	assert.match(skill, /interviewMode/);
	assert.match(skill, /`grill_session`[^\n]*action: "configure"[^\n]*antes de la primera pregunta/i);
	assert.match(skill, /frontierSize/);
});
