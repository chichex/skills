import {
	CustomEditor,
	type ExtensionAPI,
	type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import {
	fuzzyFilter,
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	type EditorComponent,
} from "@earendil-works/pi-tui";

import {
	applyInlineSkillCompletion,
	extractInlineSkillToken,
	promoteInlineSkillInvocation,
} from "./logic";

const MAX_SUGGESTIONS = 20;

type AutocompleteCapableEditor = EditorComponent & {
	getLines?: () => string[];
	getCursor?: () => { line: number; col: number };
	isShowingAutocomplete?: () => boolean;
	tryTriggerAutocomplete?: (explicitTab?: boolean) => void;
};

function skillCommands(pi: ExtensionAPI): SlashCommandInfo[] {
	return pi.getCommands().filter(
		(command) => command.source === "skill" && command.name.startsWith("skill:"),
	);
}

function matchingSkills(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
	if (!query) return commands.slice(0, MAX_SUGGESTIONS);

	return fuzzyFilter(commands, query, (command) => {
		const skillName = command.name.slice("skill:".length);
		return `${skillName} ${command.name}`;
	}).slice(0, MAX_SUGGESTIONS);
}

function autocompleteItems(commands: SlashCommandInfo[]): AutocompleteItem[] {
	return commands.map((command) => ({
		value: command.name,
		label: command.name,
		description: command.description,
	}));
}

function createInlineSkillProvider(pi: ExtensionAPI, current: AutocompleteProvider): AutocompleteProvider {
	return {
		// Current Pi versions reserve `/` for commands at the beginning of the
		// message. Declaring it here also makes this work without the editor shim
		// if Pi exposes inline slash triggers in a future version.
		triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "/"])],

		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const token = extractInlineSkillToken(lines, cursorLine, cursorCol);
			if (!token) return current.getSuggestions(lines, cursorLine, cursorCol, options);

			const matches = matchingSkills(skillCommands(pi), token.query);
			if (options.signal.aborted) return null;
			if (matches.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return {
				prefix: token.prefix,
				items: autocompleteItems(matches),
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const isLoadedSkill = skillCommands(pi).some((command) => command.name === item.value);
			if (isLoadedSkill) {
				const result = applyInlineSkillCompletion(
					lines,
					cursorLine,
					cursorCol,
					item.value,
					prefix,
				);
				if (result) return result;
			}

			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

function addInlineSlashTrigger(editor: EditorComponent): EditorComponent {
	const autocompleteEditor = editor as AutocompleteCapableEditor;
	if (
		typeof autocompleteEditor.getLines !== "function" ||
		typeof autocompleteEditor.getCursor !== "function" ||
		typeof autocompleteEditor.isShowingAutocomplete !== "function" ||
		typeof autocompleteEditor.tryTriggerAutocomplete !== "function"
	) {
		// A third-party editor may not inherit Pi's Editor. In that case inline
		// skill completion still works when explicitly requested with Tab.
		return editor;
	}

	const handleInput = editor.handleInput.bind(editor);
	editor.handleInput = (data: string): void => {
		const textBefore = editor.getText();
		const cursorBefore = autocompleteEditor.getCursor!();
		const autocompleteWasVisible = autocompleteEditor.isShowingAutocomplete!();

		handleInput(data);

		if (autocompleteWasVisible || autocompleteEditor.isShowingAutocomplete!()) return;

		const cursorAfter = autocompleteEditor.getCursor!();
		const textChanged = textBefore !== editor.getText();
		const cursorChanged =
			cursorBefore.line !== cursorAfter.line || cursorBefore.col !== cursorAfter.col;
		if (!textChanged && !cursorChanged) return;

		const token = extractInlineSkillToken(
			autocompleteEditor.getLines!(),
			cursorAfter.line,
			cursorAfter.col,
		);
		if (token) autocompleteEditor.tryTriggerAutocomplete!();
	};

	return editor;
}

export default function inlineSkillAutocomplete(pi: ExtensionAPI): void {
	pi.on("input", (event) => {
		if (event.source !== "interactive") return { action: "continue" };

		const knownSkillNames = new Set(
			skillCommands(pi).map((command) => command.name.slice("skill:".length)),
		);
		const transformed = promoteInlineSkillInvocation(event.text, knownSkillNames);
		if (!transformed) return { action: "continue" };

		return { action: "transform", text: transformed };
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const previousEditor = ctx.ui.getEditorComponent();
		ctx.ui.addAutocompleteProvider((current) => createInlineSkillProvider(pi, current));
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previousEditor?.(tui, theme, keybindings)
				?? new CustomEditor(tui, theme, keybindings);
			return addInlineSlashTrigger(editor);
		});
	});
}
