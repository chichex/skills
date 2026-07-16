import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
	allowEmptySelection: Type.Optional(
		Type.Boolean({
			description: "Allow submitting a multiple-choice question with no options selected. Defaults to false.",
		}),
	),
	section: Type.Optional(Type.String({ description: "Optional section or topic label" })),
	questionNumber: Type.Optional(Type.Integer({ minimum: 1, description: "Current question number" })),
	estimatedTotal: Type.Optional(Type.Integer({ minimum: 1, description: "Current estimated total" })),
});

function errorAskResult(
	question: string,
	message: string,
): { content: Array<{ type: "text"; text: string }>; details: AskQuestionDetails } {
	return {
		content: [{ type: "text", text: message }],
		details: { question, selectionMode: "single", answers: [], cancelled: true },
	};
}

export default function askUserQuestion(pi: ExtensionAPI) {
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
			const allowEmptySelection = selectionMode === "multiple" && (params.allowEmptySelection ?? false);
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
					done(selectionMode === "multiple"
						? selectedAnswers(answer)
						: [{ value: answer, label: answer, wasCustom: true }]);
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
						if (selected.size === 0 && !allowEmptySelection) {
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

					function styleProse(text: string): string {
						return text
							.split(/(`[^`]+`)/g)
							.map((part) => part.startsWith("`") && part.endsWith("`")
								? theme.fg("mdCode", part)
								: theme.fg("text", part))
							.join("");
					}

					lines.push(theme.fg("borderMuted", "─".repeat(renderWidth)));
					const progress = params.questionNumber
						? `Pregunta ${params.questionNumber}${params.estimatedTotal ? ` de ~${params.estimatedTotal}` : ""}`
						: undefined;
					if (params.section) {
						addWrappedWithPrefix(" ", theme.fg("accent", theme.bold(params.section)));
					}
					if (progress) addWrappedWithPrefix(" ", theme.fg("dim", progress));
					if (params.section || progress) lines.push("");
					let renderedQuestionTitle = false;
					for (const rawLine of params.question.split(/\r?\n/)) {
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

					for (let index = 0; index < options.length; index++) {
						const option = options[index];
						const focused = index === optionIndex;
						const checked = selected.has(index);
						const cursor = focused ? theme.fg("accent", "› ") : "  ";
						const marker = selectionMode === "multiple" && !option.isOther ? `${checked ? "[x]" : "[ ]"} ` : "";
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
						for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
					}

					lines.push("");
					if (notice) addWrappedWithPrefix(" ", theme.fg("warning", notice));
					const help = inputMode
						? "Enter enviar · Esc volver/pausar"
						: selectionMode === "multiple"
							? allowEmptySelection
								? "↑↓ navegar · Espacio marcar · Enter enviar (puede quedar vacío) · Esc cancelar"
								: "↑↓ navegar · Espacio marcar · Enter enviar · Esc cancelar"
							: "↑↓ navegar · Enter elegir · Esc cancelar";
					addWrappedWithPrefix(" ", theme.fg("dim", help));
					lines.push(theme.fg("borderMuted", "─".repeat(renderWidth)));
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
			if (result.length === 0) {
				return { content: [{ type: "text", text: "User submitted no selections." }], details };
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
			const answer = details.answers.length > 0
				? details.answers.map((item) => item.label).join(", ")
				: "No options selected";
			return new Text(`${theme.fg("success", "✓ ")}${answer}`, 0, 0);
		},
	});
}
