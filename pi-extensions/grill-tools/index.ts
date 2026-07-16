import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import { truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

const STORE_DIR = join(homedir(), ".pi", "agent", "grill-sessions");
const FORMAT_VERSION = 1;
const DEFAULT_QUESTION_LIMIT = 20;

interface AskOption {
	value: string;
	label: string;
	description?: string;
	recommended?: boolean;
	recommendationReason?: string;
}

interface AskAnswer {
	value: string;
	label: string;
	wasCustom: boolean;
}

interface AskQuestionDetails {
	question: string;
	selectionMode: "single" | "multiple";
	answers: AskAnswer[];
	cancelled: boolean;
	section?: string;
	questionNumber?: number;
	estimatedTotal?: number;
}

interface GrillEstimate {
	min: number;
	likely: number;
	max: number;
}

interface GrillSection {
	id: string;
	title: string;
	estimatedQuestions: number;
	dependsOn?: string[];
	status?: "pending" | "active" | "resolved";
}

interface GrillInteraction {
	id: string;
	question: string;
	answers: string[];
	section?: string;
	recommendation?: string;
	createdAt: string;
}

interface GrillDecision {
	id: string;
	title: string;
	agreement: string;
	section?: string;
	updatedAt: string;
}

interface GrillPendingBranch {
	id: string;
	title: string;
	description?: string;
	section?: string;
}

type GrillStatus = "active" | "paused" | "finalized";

interface GrillSnapshot {
	version: number;
	id: string;
	topic: string;
	projectPath: string;
	projectName: string;
	status: GrillStatus;
	createdAt: string;
	updatedAt: string;
	estimate: GrillEstimate;
	questionLimit: number;
	sections: GrillSection[];
	interactions: GrillInteraction[];
	decisions: GrillDecision[];
	pendingBranches: GrillPendingBranch[];
	summary?: string;
	handoffMarkdown?: string;
	parentId?: string;
	revision: number;
}

const AskOptionSchema = Type.Object({
	value: Type.String({ description: "Stable value returned for this option" }),
	label: Type.String({ description: "Label displayed to the user" }),
	description: Type.Optional(Type.String({ description: "Optional explanatory text" })),
	recommended: Type.Optional(Type.Boolean({ description: "Mark this option as recommended" })),
	recommendationReason: Type.Optional(
		Type.String({ description: "Short reason why this option is recommended" }),
	),
});

const AskQuestionParams = Type.Object({
	question: Type.String({ description: "Ask exactly one self-contained question" }),
	options: Type.Array(AskOptionSchema, { description: "Selectable answers; may be empty for free-text-only input" }),
	selectionMode: Type.Optional(
		StringEnum(["single", "multiple"] as const, { description: "Defaults to single" }),
	),
	allowOther: Type.Optional(
		Type.Boolean({ description: "Allow a free-text answer. Defaults to false" }),
	),
	section: Type.Optional(Type.String({ description: "Optional section or topic label" })),
	questionNumber: Type.Optional(Type.Integer({ minimum: 1, description: "Current question number" })),
	estimatedTotal: Type.Optional(Type.Integer({ minimum: 1, description: "Current estimated total" })),
});

const EstimateSchema = Type.Object({
	min: Type.Integer({ minimum: 0 }),
	likely: Type.Integer({ minimum: 0 }),
	max: Type.Integer({ minimum: 0 }),
});

const SectionSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	estimatedQuestions: Type.Integer({ minimum: 0 }),
	dependsOn: Type.Optional(Type.Array(Type.String())),
	status: Type.Optional(StringEnum(["pending", "active", "resolved"] as const)),
});

const DecisionSchema = Type.Object({
	id: Type.String({ description: "Stable decision identifier; reuse it when revising a decision" }),
	title: Type.String(),
	agreement: Type.String(),
	section: Type.Optional(Type.String()),
});

const PendingBranchSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	description: Type.Optional(Type.String()),
	section: Type.Optional(Type.String()),
});

const InteractionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this asked question" }),
	question: Type.String(),
	answers: Type.Array(Type.String(), { minItems: 1 }),
	section: Type.Optional(Type.String()),
	recommendation: Type.Optional(Type.String()),
});

const GrillSessionParams = Type.Object({
	action: StringEnum(["create", "checkpoint", "pause", "finalize", "get"] as const),
	sessionId: Type.Optional(Type.String({ description: "Required except for create" })),
	topic: Type.Optional(Type.String({ description: "Required for create" })),
	projectPath: Type.Optional(Type.String({ description: "Defaults to the current git root or cwd" })),
	estimate: Type.Optional(EstimateSchema),
	questionLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	sections: Type.Optional(Type.Array(SectionSchema, { description: "Full replacement section map" })),
	interaction: Type.Optional(InteractionSchema),
	decision: Type.Optional(DecisionSchema),
	pendingBranches: Type.Optional(
		Type.Array(PendingBranchSchema, { description: "Full replacement list of unresolved branches" }),
	),
	summary: Type.Optional(Type.String()),
	handoffMarkdown: Type.Optional(Type.String({ description: "Required for finalize" })),
});

const SelectGrillSessionParams = Type.Object({
	status: Type.Optional(
		StringEnum(["resumable", "active", "paused", "finalized", "all"] as const, {
			description: "Defaults to resumable (active and paused)",
		}),
	),
	scope: Type.Optional(
		StringEnum(["current-project", "all"] as const, {
			description: "Defaults to current-project",
		}),
	),
	query: Type.Optional(Type.String({ description: "Optional case-insensitive topic search" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	intent: Type.Optional(
		StringEnum(["manage", "spec-source"] as const, {
			description: "Defaults to manage. spec-source selects a finalized handoff without opening its action menu.",
		}),
	),
});

function now(): string {
	return new Date().toISOString();
}

function slugify(text: string): string {
	const slug = text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "grill";
}

function jsonPath(id: string): string {
	return join(STORE_DIR, `${id}.json`);
}

function markdownPath(id: string): string {
	return join(STORE_DIR, `${id}.md`);
}

async function ensureStore(): Promise<void> {
	await mkdir(STORE_DIR, { recursive: true });
}

async function writeAtomic(path: string, content: string): Promise<void> {
	await ensureStore();
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, content, "utf8");
	await rename(temporary, path);
}

function isSnapshot(value: unknown): value is GrillSnapshot {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<GrillSnapshot>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.topic === "string" &&
		typeof candidate.projectPath === "string" &&
		(candidate.status === "active" || candidate.status === "paused" || candidate.status === "finalized") &&
		Array.isArray(candidate.interactions) &&
		Array.isArray(candidate.decisions) &&
		Array.isArray(candidate.pendingBranches)
	);
}

async function saveSnapshot(snapshot: GrillSnapshot): Promise<void> {
	snapshot.updatedAt = now();
	await writeAtomic(jsonPath(snapshot.id), `${JSON.stringify(snapshot, null, 2)}\n`);
}

async function loadSnapshot(id: string): Promise<GrillSnapshot> {
	if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid grill session id");
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(jsonPath(id), "utf8"));
	} catch (error) {
		throw new Error(`Could not load grill session ${id}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isSnapshot(parsed)) throw new Error(`Invalid grill session file: ${id}`);
	return parsed;
}

async function listSnapshots(): Promise<GrillSnapshot[]> {
	await ensureStore();
	const files = (await readdir(STORE_DIR)).filter((file) => file.endsWith(".json"));
	const snapshots: GrillSnapshot[] = [];
	for (const file of files) {
		try {
			const parsed: unknown = JSON.parse(await readFile(join(STORE_DIR, file), "utf8"));
			if (isSnapshot(parsed)) snapshots.push(parsed);
		} catch {
			// Ignore corrupt entries in the selector; direct get still reports the error.
		}
	}
	return snapshots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function projectRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
	const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000 });
	return result.code === 0 && result.stdout.trim() ? resolve(result.stdout.trim()) : resolve(cwd);
}

function compactSnapshot(snapshot: GrillSnapshot): object {
	return {
		id: snapshot.id,
		topic: snapshot.topic,
		projectPath: snapshot.projectPath,
		status: snapshot.status,
		progress: `${snapshot.interactions.length} of ~${snapshot.estimate.likely} (limit ${snapshot.questionLimit})`,
		estimate: snapshot.estimate,
		sections: snapshot.sections,
		decisions: snapshot.decisions,
		pendingBranches: snapshot.pendingBranches,
		summary: snapshot.summary,
		handoffMarkdown: snapshot.handoffMarkdown,
		parentId: snapshot.parentId,
		revision: snapshot.revision,
		updatedAt: snapshot.updatedAt,
	};
}

function snapshotText(prefix: string, snapshot: GrillSnapshot): string {
	const output = `${prefix}\n${JSON.stringify(compactSnapshot(snapshot), null, 2)}`;
	const truncated = truncateHead(output, { maxBytes: 45 * 1024, maxLines: 1_900 });
	return truncated.truncated
		? `${truncated.content}\n\n[Snapshot truncated. Full state: ${jsonPath(snapshot.id)}]`
		: truncated.content;
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return value;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusIcon(status: GrillStatus): string {
	if (status === "active") return "●";
	if (status === "paused") return "Ⅱ";
	return "✓";
}

function choiceLabel(snapshot: GrillSnapshot): string {
	return `${statusIcon(snapshot.status)} ${snapshot.topic} · ${basename(snapshot.projectPath)} · ${snapshot.interactions.length}/~${snapshot.estimate.likely} · ${formatDate(snapshot.updatedAt)} · ${snapshot.id.slice(-8)}`;
}

function upsertDecision(snapshot: GrillSnapshot, decision: Omit<GrillDecision, "updatedAt">): void {
	const existing = snapshot.decisions.findIndex((item) => item.id === decision.id);
	const next: GrillDecision = { ...decision, updatedAt: now() };
	if (existing >= 0) snapshot.decisions[existing] = next;
	else snapshot.decisions.push(next);
}

function errorAskResult(question: string, message: string): { content: Array<{ type: "text"; text: string }>; details: AskQuestionDetails } {
	return {
		content: [{ type: "text", text: message }],
		details: { question, selectionMode: "single", answers: [], cancelled: true },
	};
}

export default function grillTools(pi: ExtensionAPI) {
	pi.registerCommand("grills", {
		description: "Abrir el selector interactivo de sesiones de grill",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("El selector de grills requiere modo interactivo", "error");
				return;
			}

			await ctx.waitForIdle();

			const instruction = [
				"Mostrá y permitime gestionar todas las sesiones de grill guardadas del proyecto actual.",
				'Invocá select_grill_session con status "all" y scope "current-project".',
				"Si elijo retomar o duplicar una sesión, seguí el flujo de reanudación del grill; si solo la inspecciono, resumila sin iniciar preguntas.",
			].join(" ");
			const hasGrillSkill = pi
				.getCommands()
				.some((command) => command.source === "skill" && command.name === "skill:grill");

			pi.sendUserMessage(hasGrillSkill ? `/skill:grill ${instruction}` : instruction);
		},
	});

	pi.registerTool({
		name: "ask_user_question",
		label: "Ask user question",
		description:
			"Ask exactly one interactive question. Supports single choice, multiple choice, recommended options with reasons, and optional free-text input. The user's answer is returned as tool context for the next model turn.",
		promptSnippet: "Ask one interactive single-choice, multiple-choice, or free-text question",
		promptGuidelines: [
			"Use ask_user_question when one user decision is required before proceeding; ask only one question per call.",
		],
		parameters: AskQuestionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				return errorAskResult(params.question, "Error: ask_user_question requires interactive TUI mode");
			}

			const selectionMode = params.selectionMode ?? "single";
			const allowOther = params.allowOther ?? false;
			if (params.options.length === 0 && !allowOther) {
				return errorAskResult(params.question, "Error: provide at least one option or enable allowOther");
			}

			type RenderOption = AskOption & { isOther?: boolean };
			const options: RenderOption[] = [...params.options];
			if (allowOther) options.push({ value: "__other__", label: "Escribir otra respuesta…", isOther: true });

			const result = await ctx.ui.custom<AskAnswer[] | null>((tui, theme, _keybindings, done) => {
				let optionIndex = 0;
				let inputMode = params.options.length === 0 && allowOther;
				let notice = "";
				let cachedLines: string[] | undefined;
				const selected = new Set<number>();

				const editorTheme: EditorTheme = {
					borderColor: (text) => theme.fg("accent", text),
					selectList: {
						selectedPrefix: (text) => theme.fg("accent", text),
						selectedText: (text) => theme.fg("accent", text),
						description: (text) => theme.fg("muted", text),
						scrollInfo: (text) => theme.fg("dim", text),
						noMatch: (text) => theme.fg("warning", text),
					},
				};
				const editor = new Editor(tui, editorTheme);

				function refresh(): void {
					cachedLines = undefined;
					tui.requestRender();
				}

				function selectedAnswers(custom?: string): AskAnswer[] {
					const answers = [...selected]
						.sort((a, b) => a - b)
						.map((index) => options[index])
						.filter((option) => option && !option.isOther)
						.map((option) => ({ value: option.value, label: option.label, wasCustom: false }));
					if (custom) answers.push({ value: custom, label: custom, wasCustom: true });
					return answers;
				}

				editor.onSubmit = (value) => {
					const answer = value.trim();
					if (!answer) {
						notice = "La respuesta no puede estar vacía.";
						refresh();
						return;
					}
					done(selectionMode === "multiple" ? selectedAnswers(answer) : [{ value: answer, label: answer, wasCustom: true }]);
				};

				function handleInput(data: string): void {
					if (inputMode) {
						if (matchesKey(data, Key.escape)) {
							if (params.options.length === 0) done(null);
							else {
								inputMode = false;
								editor.setText("");
								notice = "";
								refresh();
							}
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					if (matchesKey(data, Key.up)) {
						optionIndex = Math.max(0, optionIndex - 1);
						notice = "";
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						optionIndex = Math.min(options.length - 1, optionIndex + 1);
						notice = "";
						refresh();
						return;
					}
					if (matchesKey(data, Key.escape)) {
						done(null);
						return;
					}

					const option = options[optionIndex];
					if (selectionMode === "multiple" && matchesKey(data, Key.space) && option && !option.isOther) {
						if (selected.has(optionIndex)) selected.delete(optionIndex);
						else selected.add(optionIndex);
						notice = "";
						refresh();
						return;
					}

					if (matchesKey(data, Key.enter) && option) {
						if (option.isOther) {
							inputMode = true;
							notice = "";
							refresh();
							return;
						}
						if (selectionMode === "single") {
							done([{ value: option.value, label: option.label, wasCustom: false }]);
							return;
						}
						if (selected.size === 0) {
							notice = "Seleccioná al menos una opción con Espacio.";
							refresh();
							return;
						}
						done(selectedAnswers());
					}
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;
					const renderWidth = Math.max(1, width);
					const lines: string[] = [];

					function addWrapped(text: string): void {
						lines.push(...wrapTextWithAnsi(text, renderWidth));
					}

					function addWrappedWithPrefix(prefix: string, text: string): void {
						const prefixWidth = visibleWidth(prefix);
						if (prefixWidth >= renderWidth) {
							addWrapped(prefix + text);
							return;
						}
						const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
						const continuation = " ".repeat(prefixWidth);
						for (let index = 0; index < wrapped.length; index++) {
							lines.push(`${index === 0 ? prefix : continuation}${wrapped[index]}`);
						}
					}

					lines.push(theme.fg("accent", "─".repeat(renderWidth)));
					const progress = params.questionNumber
						? `Pregunta ${params.questionNumber}${params.estimatedTotal ? ` de ~${params.estimatedTotal}` : ""}`
						: undefined;
					const heading = [params.section, progress].filter(Boolean).join(" · ");
					if (heading) addWrappedWithPrefix(" ", theme.fg("muted", heading));
					addWrappedWithPrefix(" ", theme.fg("text", params.question));
					lines.push("");

					for (let index = 0; index < options.length; index++) {
						const option = options[index];
						const focused = index === optionIndex;
						const checked = selected.has(index);
						const cursor = focused ? theme.fg("accent", "> ") : "  ";
						const marker = selectionMode === "multiple" && !option.isOther ? `${checked ? "[x]" : "[ ]"} ` : "";
						const recommended = option.recommended ? theme.fg("success", " ★ Recomendada") : "";
						const label = `${marker}${option.label}${recommended}`;
						addWrappedWithPrefix(cursor, theme.fg(focused ? "accent" : "text", label));
						if (option.description) addWrappedWithPrefix("     ", theme.fg("muted", option.description));
						if (option.recommended && option.recommendationReason) {
							addWrappedWithPrefix("     ", theme.fg("dim", `Motivo: ${option.recommendationReason}`));
						}
					}

					if (inputMode) {
						if (options.length > 1) lines.push("");
						addWrappedWithPrefix(" ", theme.fg("muted", "Tu respuesta:"));
						for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
					}

					lines.push("");
					if (notice) addWrappedWithPrefix(" ", theme.fg("warning", notice));
					const help = inputMode
						? "Enter enviar · Esc volver/pausar"
						: selectionMode === "multiple"
							? "↑↓ navegar · Espacio marcar · Enter enviar · Esc cancelar"
							: "↑↓ navegar · Enter elegir · Esc cancelar";
					addWrappedWithPrefix(" ", theme.fg("dim", help));
					lines.push(theme.fg("accent", "─".repeat(renderWidth)));
					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			const details: AskQuestionDetails = {
				question: params.question,
				selectionMode,
				answers: result ?? [],
				cancelled: result === null,
				section: params.section,
				questionNumber: params.questionNumber,
				estimatedTotal: params.estimatedTotal,
			};
			if (!result) {
				return { content: [{ type: "text", text: "The user cancelled or paused the question." }], details };
			}
			const labels = result.map((answer) => answer.wasCustom ? `wrote: ${answer.label}` : `selected: ${answer.label}`);
			return { content: [{ type: "text", text: `User ${labels.join("; ")}` }], details };
		},

		renderCall(args, theme) {
			const progress = args.questionNumber
				? ` ${theme.fg("dim", `[${args.questionNumber}${args.estimatedTotal ? `/~${args.estimatedTotal}` : ""}]`)}`
				: "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ask_user_question"))}${progress} ${theme.fg("muted", args.question)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as AskQuestionDetails | undefined;
			if (!details || details.cancelled) return new Text(theme.fg("warning", "Paused/cancelled"), 0, 0);
			return new Text(
				`${theme.fg("success", "✓ ")}${details.answers.map((answer) => answer.label).join(", ")}`,
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "grill_session",
		label: "Grill session",
		description:
			"Create, checkpoint, pause, finalize, or retrieve a persistent grill interview. Grill sessions are stored globally and survive Pi sessions. Use only as directed by the grill skill.",
		parameters: GrillSessionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.action === "create") {
				if (!params.topic?.trim()) throw new Error("topic is required for create");
				if (!params.estimate) throw new Error("estimate is required for create");
				const root = params.projectPath?.trim()
					? resolve(ctx.cwd, params.projectPath.trim())
					: await projectRoot(pi, ctx.cwd);
				const timestamp = now();
				const id = `${slugify(params.topic)}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;
				const snapshot: GrillSnapshot = {
					version: FORMAT_VERSION,
					id,
					topic: params.topic.trim(),
					projectPath: root,
					projectName: basename(root),
					status: "active",
					createdAt: timestamp,
					updatedAt: timestamp,
					estimate: params.estimate,
					questionLimit: params.questionLimit ?? DEFAULT_QUESTION_LIMIT,
					sections: params.sections ?? [],
					interactions: [],
					decisions: [],
					pendingBranches: params.pendingBranches ?? [],
					summary: params.summary,
					revision: 1,
				};
				await saveSnapshot(snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Created grill session.", snapshot) }],
					details: { action: "create", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (!params.sessionId) throw new Error(`sessionId is required for ${params.action}`);
			const snapshot = await loadSnapshot(params.sessionId);

			if (params.action === "get") {
				return {
					content: [{ type: "text", text: snapshotText("Loaded grill session.", snapshot) }],
					details: { action: "get", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (snapshot.status === "finalized") {
				throw new Error("Finalized grill sessions are immutable; duplicate it with select_grill_session first");
			}

			if (params.action === "checkpoint") {
				if (!params.interaction) throw new Error("interaction is required for checkpoint");
				if (snapshot.interactions.some((item) => item.id === params.interaction!.id)) {
					throw new Error(`Interaction id already exists: ${params.interaction.id}`);
				}
				if (snapshot.interactions.length >= snapshot.questionLimit) {
					throw new Error(
						`Hard question limit reached (${snapshot.questionLimit}). Pause and split the remaining branches before asking more.`,
					);
				}
				snapshot.interactions.push({ ...params.interaction, createdAt: now() });
				if (params.decision) upsertDecision(snapshot, params.decision);
				if (params.pendingBranches) snapshot.pendingBranches = params.pendingBranches;
				if (params.sections) snapshot.sections = params.sections;
				if (params.estimate) snapshot.estimate = params.estimate;
				if (params.summary !== undefined) snapshot.summary = params.summary;
				snapshot.status = "active";
				await saveSnapshot(snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Checkpoint saved.", snapshot) }],
					details: { action: "checkpoint", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (params.action === "pause") {
				if (params.pendingBranches) snapshot.pendingBranches = params.pendingBranches;
				if (params.sections) snapshot.sections = params.sections;
				if (params.estimate) snapshot.estimate = params.estimate;
				if (params.summary !== undefined) snapshot.summary = params.summary;
				snapshot.status = "paused";
				await saveSnapshot(snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Grill session paused.", snapshot) }],
					details: { action: "pause", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (params.action === "finalize") {
				if (!params.handoffMarkdown?.trim()) throw new Error("handoffMarkdown is required for finalize");
				if (params.pendingBranches) snapshot.pendingBranches = params.pendingBranches;
				if (params.sections) snapshot.sections = params.sections;
				if (params.summary !== undefined) snapshot.summary = params.summary;
				snapshot.status = "finalized";
				snapshot.handoffMarkdown = params.handoffMarkdown.trim();
				await writeAtomic(markdownPath(snapshot.id), `${snapshot.handoffMarkdown}\n`);
				await saveSnapshot(snapshot);
				return {
					content: [{
						type: "text",
						text: `${snapshotText("Grill session finalized.", snapshot)}\nMarkdown: ${markdownPath(snapshot.id)}`,
					}],
					details: {
						action: "finalize",
						snapshot,
						jsonPath: jsonPath(snapshot.id),
						markdownPath: markdownPath(snapshot.id),
					},
				};
			}

			throw new Error(`Unsupported action: ${params.action}`);
		},

		renderCall(args, theme) {
			const id = args.sessionId ? ` ${theme.fg("dim", args.sessionId)}` : "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("grill_session"))} ${theme.fg("accent", args.action)}${id}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { snapshot?: GrillSnapshot; markdownPath?: string } | undefined;
			if (!details?.snapshot) return new Text(theme.fg("warning", "No snapshot"), 0, 0);
			const snapshot = details.snapshot;
			const suffix = details.markdownPath ? `\n${theme.fg("dim", details.markdownPath)}` : "";
			return new Text(
				`${theme.fg("success", "✓ ")}${snapshot.topic} · ${snapshot.status} · ${snapshot.interactions.length}/~${snapshot.estimate.likely}${suffix}`,
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "select_grill_session",
		label: "Select grill session",
		description:
			"Interactively list, inspect, resume, duplicate, or turn finalized grill sessions into an SDD spec. Use when the user wants to see, continue, or specify from a previous grilling interview.",
		promptSnippet: "Interactively select and resume a previous grill session",
		promptGuidelines: [
			"Use select_grill_session when the user asks to list, inspect, resume, or revisit grilling sessions.",
		],
		parameters: SelectGrillSessionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) throw new Error("select_grill_session requires interactive or RPC mode");
			const status = params.status ?? "resumable";
			const scope = params.scope ?? "current-project";
			const limit = params.limit ?? 50;
			const currentProject = await projectRoot(pi, ctx.cwd);
			const query = params.query?.trim().toLowerCase();

			const allSnapshots = await listSnapshots();
			function filteredSnapshots(targetScope: "current-project" | "all"): GrillSnapshot[] {
				let matches = allSnapshots;
				if (targetScope === "current-project") {
					matches = matches.filter((snapshot) => resolve(snapshot.projectPath) === currentProject);
				}
				if (status === "resumable") matches = matches.filter((snapshot) => snapshot.status !== "finalized");
				else if (status !== "all") matches = matches.filter((snapshot) => snapshot.status === status);
				if (query) matches = matches.filter((snapshot) => snapshot.topic.toLowerCase().includes(query));
				return matches.slice(0, limit);
			}

			let effectiveScope = scope;
			const showAllChoice = "🌐 Mostrar sesiones de todos los proyectos…";
			const showProjectChoice = `⌂ Volver a sesiones de ${basename(currentProject)}`;
			const backChoice = "← Volver a la lista de sesiones";

			while (true) {
				const snapshots = filteredSnapshots(effectiveScope);
				const scopeChoice = effectiveScope === "current-project" ? showAllChoice : showProjectChoice;
				const choices = [...snapshots.map(choiceLabel)];
				if (scope === "current-project") choices.push(scopeChoice);

				if (choices.length === 0) {
					return {
						content: [{ type: "text", text: "No grill sessions matched the selected filters." }],
						details: { selected: null, action: "none", status, scope: effectiveScope },
					};
				}

				const selectedChoice = await ctx.ui.select(
					`Grill sessions · ${effectiveScope === "current-project" ? basename(currentProject) : "all projects"}`,
					choices,
				);
				if (selectedChoice === undefined) {
					return {
						content: [{ type: "text", text: "The user cancelled grill session selection." }],
						details: { selected: null, action: "cancel" },
					};
				}
				if (selectedChoice === showAllChoice) {
					effectiveScope = "all";
					continue;
				}
				if (selectedChoice === showProjectChoice) {
					effectiveScope = "current-project";
					continue;
				}

				const selected = snapshots[choices.indexOf(selectedChoice)];
				if (!selected) throw new Error("Could not resolve the selected grill session");

				if ((params.intent ?? "manage") === "spec-source") {
					if (selected.status !== "finalized" || !selected.handoffMarkdown) {
						throw new Error("An SDD source must be a finalized grill session with a handoff");
					}
					return {
						content: [{ type: "text", text: snapshotText("Selected finalized grill session as SDD source.", selected) }],
						details: {
							selected,
							action: "spec-source",
							jsonPath: jsonPath(selected.id),
							markdownPath: markdownPath(selected.id),
						},
					};
				}

				const createSpecChoice = "Crear spec SDD desde el handoff finalizado";
				const actionChoices = selected.status === "finalized"
					? [backChoice, "Inspect only", createSpecChoice, "Duplicate as a new revision"]
					: [backChoice, "Resume in this conversation", "Inspect only"];
				const selectedAction = await ctx.ui.select(`${selected.topic} · ${selected.status}`, actionChoices);
				if (selectedAction === undefined || selectedAction === backChoice) continue;

				if (selectedAction === "Inspect only") {
					return {
						content: [{ type: "text", text: snapshotText("Selected grill session for inspection.", selected) }],
						details: {
							selected,
							action: "inspect",
							jsonPath: jsonPath(selected.id),
							markdownPath: selected.handoffMarkdown ? markdownPath(selected.id) : undefined,
						},
					};
				}

				if (selectedAction === createSpecChoice) {
					const hasSddSpecSkill = pi.getCommands().some((command) => command.name === "skill:sdd-spec");
					const instruction = [
						`Create an SDD spec from finalized grill session ${selected.id}.`,
						`Use project root ${selected.projectPath}.`,
						"Treat the frozen handoff as authoritative and do not ask again about confirmed decisions.",
					].join(" ");
					pi.sendUserMessage(
						hasSddSpecSkill ? `/skill:sdd-spec --from-grill ${selected.id}` : instruction,
						{ deliverAs: "steer" },
					);
					return {
						content: [{
							type: "text",
							text: `${snapshotText("Selected finalized grill session as SDD source.", selected)}\nNext action: ${instruction}`,
						}],
						details: {
							selected,
							action: "create-sdd-spec",
							jsonPath: jsonPath(selected.id),
							markdownPath: markdownPath(selected.id),
						},
					};
				}

				if (selected.status === "finalized") {
					const timestamp = now();
					const duplicate: GrillSnapshot = {
						...selected,
						id: `${slugify(selected.topic)}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`,
						status: "active",
						createdAt: timestamp,
						updatedAt: timestamp,
						handoffMarkdown: undefined,
						parentId: selected.id,
						revision: selected.revision + 1,
					};
					await saveSnapshot(duplicate);
					return {
						content: [{ type: "text", text: snapshotText("Duplicated finalized grill session as a new active revision.", duplicate) }],
						details: { selected: duplicate, action: "duplicate", sourceId: selected.id, jsonPath: jsonPath(duplicate.id) },
					};
				}

				selected.status = "active";
				await saveSnapshot(selected);
				return {
					content: [{ type: "text", text: snapshotText("Resumed grill session in this conversation.", selected) }],
					details: { selected, action: "resume", jsonPath: jsonPath(selected.id) },
				};
			}
		},

		renderCall(args, theme) {
			const scope = args.scope ?? "current-project";
			const status = args.status ?? "resumable";
			const intent = args.intent ?? "manage";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("select_grill_session"))} ${theme.fg("muted", `${scope} · ${status} · ${intent}`)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { selected?: GrillSnapshot | null; action?: string } | undefined;
			if (!details?.selected) return new Text(theme.fg("warning", details?.action === "cancel" ? "Cancelled" : "No sessions"), 0, 0);
			return new Text(
				`${theme.fg("success", "✓ ")}${details.selected.topic} · ${theme.fg("accent", details.action ?? "selected")}`,
				0,
				0,
			);
		},
	});
}
