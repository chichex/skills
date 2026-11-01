export interface InlineSkillToken {
	prefix: string;
	query: string;
	tokenStart: number;
	tokenEnd: number;
}

export interface CompletionResult {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
}

export interface SkillCommandLike {
	name: string;
	description?: string;
}

export interface SkillSuggestion {
	value: string;
	label: string;
	description: string | undefined;
}

// Los skills `sdd-*` (issue #103) son alias deprecados de `chiche-*`: su
// descripción abre con "alias deprecado de chiche-<etapa>". La marca se deriva
// de esa descripción, no de una lista de nombres.
const DEPRECATED_ALIAS_DESCRIPTION = /^alias deprecado de ([a-z0-9][a-z0-9-]*)\b/;

const INLINE_SLASH_TOKEN = /(?:^|[ \t])(\/[a-zA-Z0-9._:-]*)$/;
const SKILL_COMMAND = /^skill:[a-z0-9][a-z0-9-]*$/;
const SKILL_INVOCATION = /(^|[ \t\n])\/skill:([a-z0-9][a-z0-9-]*)(?=$|[ \t\n])/g;

export function extractInlineSkillToken(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): InlineSkillToken | undefined {
	const currentLine = lines[cursorLine];
	if (currentLine === undefined || cursorCol < 0 || cursorCol > currentLine.length) return undefined;

	const textBeforeCursor = currentLine.slice(0, cursorCol);
	const match = INLINE_SLASH_TOKEN.exec(textBeforeCursor);
	const prefix = match?.[1];
	if (!prefix) return undefined;

	const tokenStart = textBeforeCursor.length - prefix.length;
	if (cursorLine === 0 && tokenStart === 0) return undefined;

	const commandPrefix = prefix.slice(1);
	if (commandPrefix.includes(":") && !commandPrefix.startsWith("skill:")) return undefined;

	return {
		prefix,
		query: commandPrefix.startsWith("skill:") ? commandPrefix.slice("skill:".length) : commandPrefix,
		tokenStart,
		tokenEnd: cursorCol,
	};
}

export function applyInlineSkillCompletion(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	commandName: string,
	prefix: string,
): CompletionResult | undefined {
	if (!SKILL_COMMAND.test(commandName)) return undefined;

	const token = extractInlineSkillToken(lines, cursorLine, cursorCol);
	if (!token || token.prefix !== prefix) return undefined;

	const currentLine = lines[cursorLine] ?? "";
	const beforeToken = currentLine.slice(0, token.tokenStart);
	let afterToken = currentLine.slice(cursorCol);

	// Replace the remainder too when completion is requested with the cursor in
	// the middle of an already typed slash token.
	const tokenSuffix = afterToken.match(/^[a-zA-Z0-9._:-]*/)?.[0] ?? "";
	afterToken = afterToken.slice(tokenSuffix.length).replace(/^[ \t]+/, "");

	const replacement = `/${commandName} `;
	const nextLines = [...lines];
	nextLines[cursorLine] = `${beforeToken}${replacement}${afterToken}`;

	return {
		lines: nextLines,
		cursorLine,
		cursorCol: beforeToken.length + replacement.length,
	};
}

export function promoteInlineSkillInvocation(
	text: string,
	knownSkillNames: ReadonlySet<string>,
): string | undefined {
	if (text.startsWith("/skill:")) return undefined;

	SKILL_INVOCATION.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SKILL_INVOCATION.exec(text)) !== null) {
		const skillName = match[2];
		if (!skillName || !knownSkillNames.has(skillName)) continue;

		const boundary = match[1] ?? "";
		const tokenStart = match.index + boundary.length;
		const tokenEnd = tokenStart + `/skill:${skillName}`.length;
		const beforeToken = text.slice(0, tokenStart);
		let afterToken = text.slice(tokenEnd);

		if (/[ \t]$/.test(beforeToken) && /^[ \t]/.test(afterToken)) {
			afterToken = afterToken.slice(1);
		}

		const argumentsText = `${beforeToken}${afterToken}`.trim();
		return argumentsText ? `/skill:${skillName} ${argumentsText}` : `/skill:${skillName}`;
	}

	return undefined;
}

/** Nombre del skill vigente si `description` declara un alias deprecado; si no, `undefined`. */
export function deprecatedAliasTarget(description: string | undefined): string | undefined {
	return DEPRECATED_ALIAS_DESCRIPTION.exec(description ?? "")?.[1];
}

/** Estable: los alias deprecados van después de los skills vigentes, sin tocar el orden del resto. */
export function orderSkillCommands<T extends SkillCommandLike>(commands: readonly T[]): T[] {
	const isAlias = (command: T) => deprecatedAliasTarget(command.description) !== undefined;
	return [...commands.filter((command) => !isAlias(command)), ...commands.filter(isAlias)];
}

/** El valor que se completa no cambia; el alias lleva "(alias)" en la etiqueta, que se ve aunque la terminal no muestre la descripción. */
export function skillSuggestions(commands: readonly SkillCommandLike[]): SkillSuggestion[] {
	return commands.map((command) => ({
		value: command.name,
		label: deprecatedAliasTarget(command.description) ? `${command.name} (alias)` : command.name,
		description: command.description,
	}));
}
