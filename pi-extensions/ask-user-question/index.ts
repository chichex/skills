import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface AskOption {
	value: string;
	label: string;
	description?: string;
	recommended?: boolean;
	recommendationReason?: string;
}

type GrillInterviewMode = "unselected" | "fast" | "rounds" | "adaptive";
type GrillQuestionPhase = "configuration" | "interview" | "closure";

interface GrillQuestionContext {
	sessionId: string;
	phase: GrillQuestionPhase;
	frontierSize?: number;
}

interface GrillInterviewState {
	id: string;
	status: "active" | "paused" | "finalized";
	interviewMode: GrillInterviewMode;
}

interface AskQuestionInput {
	id?: string;
	question: string;
	options: AskOption[];
	selectionMode?: "single" | "multiple";
	allowOther?: boolean;
	allowEmptySelection?: boolean;
	section?: string;
	questionNumber?: number;
	estimatedTotal?: number;
	grill?: GrillQuestionContext;
}

interface ResolvedQuestion extends AskQuestionInput {
	selectionMode: "single" | "multiple";
	allowOther: boolean;
	allowEmptySelection: boolean;
}

interface AskAnswer {
	value: string;
	label: string;
	wasCustom: boolean;
}

interface AskQuestionDetails {
	id?: string;
	question: string;
	selectionMode: "single" | "multiple";
	answers: AskAnswer[];
	cancelled: boolean;
	section?: string;
	questionNumber?: number;
	estimatedTotal?: number;
	grill?: GrillQuestionContext;
}

interface AskQuestionsDetails {
	questions: AskQuestionDetails[];
	cancelled: boolean;
	grill?: GrillQuestionContext;
}

interface AskDialogResult {
	answers: AskAnswer[][];
	answered: boolean[];
	cancelled: boolean;
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

const AskQuestionFields = {
	question: Type.String({ description: "Ask exactly one self-contained question" }),
	options: Type.Array(AskOptionSchema, { description: "Selectable answers; may be empty for free-text-only input" }),
	selectionMode: Type.Optional(
		StringEnum(["single", "multiple"] as const, { description: "Defaults to single" }),
	),
	allowOther: Type.Optional(
		Type.Boolean({ description: "Allow a free-text answer. Defaults to false" }),
	),
	allowEmptySelection: Type.Optional(
		Type.Boolean({
			description: "Allow submitting a multiple-choice question with no options selected. Defaults to false.",
		}),
	),
	section: Type.Optional(Type.String({ description: "Optional section or topic label" })),
	questionNumber: Type.Optional(Type.Integer({ minimum: 1, description: "Current question number" })),
	estimatedTotal: Type.Optional(Type.Integer({ minimum: 1, description: "Current estimated total" })),
};

const GrillQuestionContextSchema = Type.Object({
	sessionId: Type.String({ minLength: 1, description: "Persistent grill session id" }),
	phase: StringEnum(["configuration", "interview", "closure"] as const, {
		description: "Which grill phase owns this question",
	}),
	frontierSize: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 20,
			description: "Number of decisions represented by this interview prompt (rounds remain limited to 4)",
		}),
	),
});

const AskQuestionParams = Type.Object({
	...AskQuestionFields,
	grill: Type.Optional(GrillQuestionContextSchema),
});

const AskRoundQuestionSchema = Type.Object({
	id: Type.String({ minLength: 1, description: "Unique stable identifier for this decision" }),
	...AskQuestionFields,
});

const AskQuestionsParams = Type.Object({
	questions: Type.Array(AskRoundQuestionSchema, {
		minItems: 2,
		maxItems: 4,
		description: "Two to four independent, already-unblocked questions in this round",
	}),
	grill: Type.Optional(GrillQuestionContextSchema),
});

function resolveQuestion(question: AskQuestionInput): ResolvedQuestion {
	const selectionMode = question.selectionMode ?? "single";
	return {
		...question,
		selectionMode,
		allowOther: question.allowOther ?? false,
		allowEmptySelection: selectionMode === "multiple" && (question.allowEmptySelection ?? false),
	};
}

function invalidQuestion(question: ResolvedQuestion): string | undefined {
	if (question.options.length === 0 && !question.allowOther) {
		return "provide at least one option or enable allowOther";
	}
	return undefined;
}

function questionDetails(
	question: ResolvedQuestion,
	answers: AskAnswer[],
	cancelled: boolean,
): AskQuestionDetails {
	return {
		id: question.id,
		question: question.question,
		selectionMode: question.selectionMode,
		answers,
		cancelled,
		section: question.section,
		questionNumber: question.questionNumber,
		estimatedTotal: question.estimatedTotal,
		grill: question.grill,
	};
}

function errorAskResult(
	question: string,
	message: string,
): { content: Array<{ type: "text"; text: string }>; details: AskQuestionDetails } {
	return {
		content: [{ type: "text", text: message }],
		details: { question, selectionMode: "single", answers: [], cancelled: true },
	};
}

function errorQuestionsResult(
	questions: ResolvedQuestion[],
	message: string,
): { content: Array<{ type: "text"; text: string }>; details: AskQuestionsDetails } {
	return {
		content: [{ type: "text", text: message }],
		details: {
			questions: questions.map((question) => questionDetails(question, [], true)),
			cancelled: true,
		},
	};
}

function answerSummary(answers: AskAnswer[]): string {
	if (answers.length === 0) return "submitted no selections";
	return answers
		.map((answer) => answer.wasCustom ? `wrote: ${answer.label}` : `selected: ${answer.label}`)
		.join("; ");
}

async function withHerdrBlocked<T>(pi: ExtensionAPI, prompt: () => Promise<T>): Promise<T> {
	// Herdr's current Pi integration consumes this compatibility event while a
	// tool keeps the agent turn active but is actually waiting on the user.
	pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
	try {
		return await prompt();
	} finally {
		pi.events.emit("herdr:blocked", { active: false });
	}
}

function isGrillInterviewState(value: unknown): value is GrillInterviewState {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<GrillInterviewState>;
	return (
		typeof candidate.id === "string" &&
		(candidate.status === "active" || candidate.status === "paused" || candidate.status === "finalized") &&
		(
			candidate.interviewMode === "unselected" ||
			candidate.interviewMode === "fast" ||
			candidate.interviewMode === "rounds" ||
			candidate.interviewMode === "adaptive"
		)
	);
}

function grillStateFromBranch(ctx: ExtensionContext): GrillInterviewState | undefined {
	const sessionManager = (ctx as ExtensionContext & {
		sessionManager?: { getBranch?: () => unknown[] };
	}).sessionManager;
	const branch = sessionManager?.getBranch?.();
	if (!Array.isArray(branch)) return undefined;

	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as {
			type?: string;
			message?: { role?: string; toolName?: string; details?: { snapshot?: unknown } };
		};
		if (
			entry.type !== "message" ||
			entry.message?.role !== "toolResult" ||
			entry.message.toolName !== "grill_session"
		) continue;
		const snapshot = entry.message.details?.snapshot;
		return isGrillInterviewState(snapshot) ? snapshot : undefined;
	}
	return undefined;
}

function enforceGrillQuestionTool(
	state: GrillInterviewState | undefined,
	tool: "single" | "round",
	context: GrillQuestionContext | undefined,
	questionCount: number,
): void {
	if (!state || state.status !== "active") return;
	if (context?.sessionId && context.sessionId !== state.id) {
		throw new Error(
			`Active grill session is ${state.id}, but the question declared ${context.sessionId}. Use the active session id.`,
		);
	}

	if (context?.phase === "configuration" || context?.phase === "closure") {
		if (tool === "round") {
			throw new Error(`ask_user_question is required for grill ${context.phase}; do not open a question round.`);
		}
		return;
	}

	if (state.interviewMode === "unselected") {
		throw new Error(
			"Configure grill_session interviewMode before asking an interview question. The selected mode is persisted and enforced.",
		);
	}

	if (state.interviewMode === "rounds") {
		if (tool === "single") {
			if (context?.phase === "interview" && context.frontierSize === 1) return;
			const size = context?.frontierSize;
			throw new Error(
				`ask_user_questions is required for an active rounds grill${size ? ` with a frontier of ${size}` : ""}. ` +
				"ask_user_question is allowed only when grill.phase is interview and grill.frontierSize is exactly 1, or for configuration/closure.",
			);
		}
		if (context?.phase !== "interview") {
			throw new Error("A rounds grill must declare grill.phase=interview when calling ask_user_questions.");
		}
		if (context.frontierSize !== questionCount) {
			throw new Error(
				`The rounds grill declared frontierSize=${context.frontierSize ?? "missing"}, but supplied ${questionCount} questions.`,
			);
		}
		return;
	}

	if (tool === "round") {
		throw new Error(
			`ask_user_question is required while grill interviewMode=${state.interviewMode}; ask_user_questions is only valid in rounds mode.`,
		);
	}
}

async function askQuestionsInTui(
	ctx: ExtensionContext,
	questions: ResolvedQuestion[],
): Promise<AskDialogResult> {
	const result = await ctx.ui.custom<AskDialogResult>((tui, theme, _keybindings, done) => {
		const isRound = questions.length > 1;
		const submitTab = questions.length;
		const totalTabs = questions.length + (isRound ? 1 : 0);
		let currentTab = 0;
		let optionIndex = 0;
		let inputMode = questions[0].options.length === 0 && questions[0].allowOther;
		let notice = "";
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		const answersByQuestion = new Map<number, AskAnswer[]>();
		const selectedByQuestion = new Map<number, Set<number>>();

		type RenderOption = AskOption & { isOther?: boolean };

		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("borderAccent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.bg("selectedBg", theme.fg("text", text)),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		const editor = new Editor(tui, editorTheme);

		function clearCache(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		}

		function refresh(): void {
			clearCache();
			tui.requestRender();
		}

		function currentQuestion(): ResolvedQuestion | undefined {
			return questions[currentTab];
		}

		function currentOptions(): RenderOption[] {
			const question = currentQuestion();
			if (!question) return [];
			const options: RenderOption[] = [...question.options];
			if (question.allowOther) {
				options.push({ value: "__other__", label: "Escribir otra respuesta…", isOther: true });
			}
			return options;
		}

		function selectedSet(questionIndex: number): Set<number> {
			let selected = selectedByQuestion.get(questionIndex);
			if (!selected) {
				selected = new Set<number>();
				selectedByQuestion.set(questionIndex, selected);
			}
			return selected;
		}

		function selectedAnswers(questionIndex: number, custom?: string): AskAnswer[] {
			const question = questions[questionIndex];
			const answers = [...selectedSet(questionIndex)]
				.sort((a, b) => a - b)
				.map((index) => question.options[index])
				.filter((option): option is AskOption => option !== undefined)
				.map((option) => ({ value: option.value, label: option.label, wasCustom: false }));
			if (custom) answers.push({ value: custom, label: custom, wasCustom: true });
			return answers;
		}

		function allAnswered(): boolean {
			return questions.every((_question, index) => answersByQuestion.has(index));
		}

		function finish(cancelled: boolean): void {
			done({
				answers: questions.map((_question, index) => answersByQuestion.get(index) ?? []),
				answered: questions.map((_question, index) => answersByQuestion.has(index)),
				cancelled,
			});
		}

		function switchTab(nextTab: number): void {
			currentTab = ((nextTab % totalTabs) + totalTabs) % totalTabs;
			const question = currentQuestion();
			inputMode = Boolean(
				question && question.options.length === 0 && question.allowOther && !answersByQuestion.has(currentTab),
			);
			editor.setText("");
			notice = "";
			const selected = currentTab < questions.length ? [...selectedSet(currentTab)] : [];
			optionIndex = selected[0] ?? 0;
			refresh();
		}

		function advanceAfterAnswer(): void {
			if (!isRound) {
				finish(false);
				return;
			}
			for (let index = currentTab + 1; index < questions.length; index++) {
				if (!answersByQuestion.has(index)) {
					switchTab(index);
					return;
				}
			}
			for (let index = 0; index < currentTab; index++) {
				if (!answersByQuestion.has(index)) {
					switchTab(index);
					return;
				}
			}
			switchTab(submitTab);
		}

		function saveCustomAnswer(value: string): void {
			const answer = value.trim();
			if (!answer) {
				notice = "La respuesta no puede estar vacía.";
				refresh();
				return;
			}
			const question = questions[currentTab];
			const answers = question.selectionMode === "multiple"
				? selectedAnswers(currentTab, answer)
				: [{ value: answer, label: answer, wasCustom: true }];
			answersByQuestion.set(currentTab, answers);
			inputMode = false;
			editor.setText("");
			advanceAfterAnswer();
		}

		editor.onSubmit = saveCustomAnswer;

		function handleInput(data: string): void {
			if (inputMode) {
				if (matchesKey(data, Key.escape)) {
					const question = currentQuestion();
					if (question && question.options.length === 0 && !isRound) {
						finish(true);
					} else {
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

			if (isRound && (matchesKey(data, Key.tab) || matchesKey(data, Key.right))) {
				switchTab(currentTab + 1);
				return;
			}
			if (isRound && (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left))) {
				switchTab(currentTab - 1);
				return;
			}

			if (isRound && currentTab === submitTab) {
				if (matchesKey(data, Key.enter)) {
					if (allAnswered()) finish(false);
					else {
						notice = "Respondé todas las decisiones antes de enviar la ronda.";
						refresh();
					}
				} else if (matchesKey(data, Key.escape)) {
					finish(true);
				}
				return;
			}

			const question = currentQuestion();
			const options = currentOptions();
			if (!question) return;

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
				finish(true);
				return;
			}

			const option = options[optionIndex];
			const selected = selectedSet(currentTab);
			if (question.selectionMode === "multiple" && matchesKey(data, Key.space) && option && !option.isOther) {
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
				if (question.selectionMode === "single") {
					selected.clear();
					selected.add(optionIndex);
					answersByQuestion.set(currentTab, selectedAnswers(currentTab));
					advanceAfterAnswer();
					return;
				}
				if (selected.size === 0 && !question.allowEmptySelection) {
					notice = "Seleccioná al menos una opción con Espacio.";
					refresh();
					return;
				}
				answersByQuestion.set(currentTab, selectedAnswers(currentTab));
				advanceAfterAnswer();
			}
		}

		function render(width: number): string[] {
			const renderWidth = Math.max(1, Math.floor(width));
			if (cachedLines && cachedWidth === renderWidth) return cachedLines;
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

			function styleProse(text: string): string {
				const backtick = String.fromCharCode(96);
				return text
					.split(/(\x60[^\x60]+\x60)/g)
					.map((part) => part.startsWith(backtick) && part.endsWith(backtick)
						? theme.fg("mdCode", part)
						: theme.fg("text", part))
					.join("");
			}

			lines.push(theme.fg("borderMuted", "─".repeat(renderWidth)));

			if (isRound) {
				const tabs: string[] = [];
				for (let index = 0; index < questions.length; index++) {
					const answered = answersByQuestion.has(index);
					const active = currentTab === index;
					const label = questions[index].section || questions[index].id || `P${index + 1}`;
					const text = ` ${answered ? "■" : "□"} ${label} `;
					tabs.push(active
						? theme.bg("selectedBg", theme.fg("text", text))
						: theme.fg(answered ? "success" : "muted", text));
				}
				const submitText = " ✓ Enviar ";
				tabs.push(currentTab === submitTab
					? theme.bg("selectedBg", theme.fg("text", submitText))
					: theme.fg(allAnswered() ? "success" : "dim", submitText));
				addWrappedWithPrefix(" ", tabs.join(" "));
				lines.push("");
			}

			if (isRound && currentTab === submitTab) {
				addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("Revisá la ronda antes de enviarla")));
				lines.push("");
				for (let index = 0; index < questions.length; index++) {
					const question = questions[index];
					const label = question.section || question.id || `Pregunta ${index + 1}`;
					const answers = answersByQuestion.get(index);
					const summary = answers
						? answers.length > 0 ? answers.map((answer) => answer.label).join(", ") : "Sin selecciones"
						: "Pendiente";
					addWrappedWithPrefix(" ", `${theme.fg("muted", `${label}:`)} ${theme.fg(answers ? "text" : "warning", summary)}`);
				}
				lines.push("");
				addWrappedWithPrefix(
					" ",
					allAnswered()
						? theme.fg("success", "Enter envía todas las respuestas")
						: theme.fg("warning", "Todavía hay decisiones pendientes"),
				);
			} else {
				const question = currentQuestion();
				const options = currentOptions();
				if (question) {
					if (isRound) addWrappedWithPrefix(" ", theme.fg("dim", `Ronda · decisión ${currentTab + 1} de ${questions.length}`));
					const progress = question.questionNumber
						? `Pregunta ${question.questionNumber}${question.estimatedTotal ? ` de ~${question.estimatedTotal}` : ""}`
						: undefined;
					if (question.section) addWrappedWithPrefix(" ", theme.fg("accent", theme.bold(question.section)));
					if (progress) addWrappedWithPrefix(" ", theme.fg("dim", progress));
					if (isRound || question.section || progress) lines.push("");

					let renderedQuestionTitle = false;
					for (const rawLine of question.question.split(/\r?\n/)) {
						const line = rawLine.trimEnd();
						if (!line.trim()) {
							lines.push("");
							continue;
						}
						if (!renderedQuestionTitle) {
							addWrappedWithPrefix(" ", theme.fg("text", theme.bold(line)));
							renderedQuestionTitle = true;
							continue;
						}
						const sectionLine = line.match(/^([^:]{1,32}:)(.*)$/);
						if (sectionLine && !/^\d/.test(sectionLine[1])) {
							const styled = theme.fg("accent", theme.bold(sectionLine[1])) + styleProse(sectionLine[2]);
							addWrappedWithPrefix(" ", styled);
						} else {
							addWrappedWithPrefix(" ", styleProse(line));
						}
					}
					lines.push("");

					const selected = selectedSet(currentTab);
					const savedAnswers = answersByQuestion.get(currentTab) ?? [];
					for (let index = 0; index < options.length; index++) {
						const option = options[index];
						const focused = index === optionIndex;
						const checked = selected.has(index);
						const customSaved = option.isOther && savedAnswers.some((answer) => answer.wasCustom);
						const cursor = focused ? theme.fg("accent", "› ") : "  ";
						const marker = question.selectionMode === "multiple" && !option.isOther
							? `${checked ? "[x]" : "[ ]"} `
							: customSaved ? "[x] " : "";
						const recommended = option.recommended
							? ` ${theme.fg("warning", theme.bold("★ Recomendada"))}`
							: "";
						const label = `${marker}${option.label}${recommended}`;
						const styledLabel = focused
							? theme.bg("selectedBg", theme.fg("text", theme.bold(label)))
							: theme.fg("text", label);
						addWrappedWithPrefix(cursor, styledLabel);
						if (option.description) addWrappedWithPrefix("    ", theme.fg("muted", option.description));
						if (option.recommended && option.recommendationReason) {
							const reason = `${theme.fg("warning", "Por qué:")} ${theme.fg("muted", option.recommendationReason)}`;
							addWrappedWithPrefix("    ", reason);
						}
					}

					if (inputMode) {
						if (options.length > 1) lines.push("");
						addWrappedWithPrefix(" ", theme.fg("muted", "Tu respuesta:"));
						const editorWidth = Math.max(1, renderWidth - 2);
						for (const line of editor.render(editorWidth)) lines.push(` ${line}`);
					}
				}
			}

			lines.push("");
			if (notice) addWrappedWithPrefix(" ", theme.fg("warning", notice));
			const question = currentQuestion();
			const help = inputMode
				? "Enter guardar · Esc volver/pausar"
				: isRound
					? currentTab === submitTab
						? "Tab/←→ revisar · Enter enviar · Esc cancelar"
						: question?.selectionMode === "multiple"
							? "Tab/←→ decisiones · ↑↓ navegar · Espacio marcar · Enter guardar · Esc cancelar"
							: "Tab/←→ decisiones · ↑↓ navegar · Enter guardar · Esc cancelar"
					: question?.selectionMode === "multiple"
						? question.allowEmptySelection
							? "↑↓ navegar · Espacio marcar · Enter enviar (puede quedar vacío) · Esc cancelar"
							: "↑↓ navegar · Espacio marcar · Enter enviar · Esc cancelar"
						: "↑↓ navegar · Enter elegir · Esc cancelar";
			addWrappedWithPrefix(" ", theme.fg("dim", help));
			lines.push(theme.fg("borderMuted", "─".repeat(renderWidth)));

			cachedWidth = renderWidth;
			cachedLines = lines.map((line) =>
				visibleWidth(line) <= renderWidth ? line : truncateToWidth(line, renderWidth, "")
			);
			return cachedLines;
		}

		return {
			get focused() {
				return editor.focused;
			},
			set focused(value: boolean) {
				editor.focused = value;
			},
			render,
			invalidate: () => {
				clearCache();
				editor.invalidate();
			},
			handleInput,
		};
	});

	return result ?? {
		answers: questions.map(() => []),
		answered: questions.map(() => false),
		cancelled: true,
	};
}

export default function askUserQuestion(pi: ExtensionAPI) {
	let publishedGrillState: GrillInterviewState | undefined;
	pi.events.on("grill:interview-state", (state: unknown) => {
		publishedGrillState = isGrillInterviewState(state) ? state : undefined;
	});
	pi.on("session_start", () => {
		publishedGrillState = undefined;
	});
	pi.on("session_tree", () => {
		publishedGrillState = undefined;
	});

	function currentGrillState(ctx: ExtensionContext): GrillInterviewState | undefined {
		return grillStateFromBranch(ctx) ?? publishedGrillState;
	}

	pi.registerTool({
		name: "ask_user_question",
		label: "Ask user question",
		description:
			"Ask exactly one interactive question. Supports single choice, multiple choice, recommended options with reasons, and optional free-text input. Active grill interview modes are enforced: a rounds grill may use this tool only for an explicitly declared one-question frontier or configuration/closure.",
		promptSnippet: "Ask one interactive single-choice, multiple-choice, or free-text question",
		promptGuidelines: [
			"Use ask_user_question when one user decision is required before proceeding; ask only one question per call.",
			"During an active grill, include grill session/phase/frontier metadata; in rounds mode ask_user_question is valid only when the dependency frontier has exactly one decision.",
		],
		parameters: AskQuestionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const question = resolveQuestion(params as AskQuestionInput);
			enforceGrillQuestionTool(currentGrillState(ctx), "single", question.grill, 1);
			if (ctx.mode !== "tui") {
				return errorAskResult(params.question, "Error: ask_user_question requires interactive TUI mode");
			}

			const problem = invalidQuestion(question);
			if (problem) return errorAskResult(question.question, `Error: ${problem}`);

			const result = await withHerdrBlocked(pi, () => askQuestionsInTui(ctx, [question]));
			const answers = result.answers[0] ?? [];
			const details = questionDetails(question, answers, result.cancelled);
			if (result.cancelled) {
				return { content: [{ type: "text" as const, text: "The user cancelled or paused the question." }], details };
			}
			return {
				content: [{
					type: "text" as const,
					text: answers.length === 0 ? "User submitted no selections." : `User ${answerSummary(answers)}`,
				}],
				details,
			};
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
			const answer = details.answers.length > 0
				? details.answers.map((item) => item.label).join(", ")
				: "No options selected";
			return new Text(`${theme.fg("success", "✓ ")}${answer}`, 0, 0);
		},
	});

	pi.registerTool({
		name: "ask_user_questions",
		label: "Ask user questions",
		description:
			"Ask one round of two to four independent, already-unblocked interactive questions. The user answers the whole round before control returns to the model. Active grill interview modes are enforced: this tool is accepted only for interviewMode=rounds with a matching declared frontier size.",
		promptSnippet: "Ask a round of 2-4 independent single-choice, multiple-choice, or free-text questions",
		promptGuidelines: [
			"Use ask_user_questions only for a round of 2-4 independent decisions whose dependencies are already resolved; use ask_user_question when answers must adapt the next question.",
			"During an active rounds grill, include grill session/phase/frontier metadata and make frontierSize match the number of supplied questions.",
		],
		parameters: AskQuestionsParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const grill = (params as { grill?: GrillQuestionContext }).grill;
			const questions = (params.questions as AskQuestionInput[]).map((question) =>
				resolveQuestion({ ...question, grill })
			);
			enforceGrillQuestionTool(currentGrillState(ctx), "round", grill, questions.length);
			if (ctx.mode !== "tui") {
				return errorQuestionsResult(questions, "Error: ask_user_questions requires interactive TUI mode");
			}
			const ids = questions.map((question) => question.id ?? "");
			if (new Set(ids).size !== ids.length) {
				return errorQuestionsResult(questions, "Error: every round question id must be unique");
			}
			for (const question of questions) {
				const problem = invalidQuestion(question);
				if (problem) {
					return errorQuestionsResult(questions, `Error in ${question.id}: ${problem}`);
				}
			}

			const result = await withHerdrBlocked(pi, () => askQuestionsInTui(ctx, questions));
			const details: AskQuestionsDetails = {
				questions: questions.map((question, index) => {
					const answers = result.answers[index] ?? [];
					return questionDetails(question, answers, result.cancelled && !result.answered[index]);
				}),
				cancelled: result.cancelled,
				grill,
			};
			const answered = details.questions.filter((question) => !question.cancelled);
			const summaries = answered.map((question) => `${question.id}: user ${answerSummary(question.answers)}`);
			if (result.cancelled) {
				const suffix = summaries.length > 0 ? ` Partial answers:\n${summaries.join("\n")}` : "";
				return {
					content: [{ type: "text" as const, text: `The user cancelled or paused the round.${suffix}` }],
					details,
				};
			}
			return {
				content: [{ type: "text" as const, text: summaries.join("\n") }],
				details,
			};
		},

		renderCall(args, theme) {
			const count = Array.isArray(args.questions) ? args.questions.length : 0;
			const sections = Array.isArray(args.questions)
				? args.questions.map((question) => question.section || question.id).filter(Boolean).join(", ")
				: "";
			const suffix = sections ? ` ${theme.fg("dim", `(${sections})`)}` : "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ask_user_questions"))} ${theme.fg("muted", `${count} decisiones`)}${suffix}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as AskQuestionsDetails | undefined;
			if (!details) return new Text(theme.fg("warning", "No round details"), 0, 0);
			const lines = details.questions
				.filter((question) => question.answers.length > 0 || !question.cancelled)
				.map((question) => {
					const answer = question.answers.length > 0
						? question.answers.map((item) => item.label).join(", ")
						: "No options selected";
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", question.id ?? "decisión")}: ${answer}`;
				});
			if (details.cancelled) lines.push(theme.fg("warning", "Round paused/cancelled"));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
