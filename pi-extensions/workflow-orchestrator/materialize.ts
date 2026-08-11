import { readFile as readFileDefault } from "node:fs/promises";
import { isAbsolute } from "node:path";

export interface SkillCommandSourceInfo {
	path?: unknown;
	baseDir?: unknown;
	source?: unknown;
	scope?: unknown;
	origin?: unknown;
}

export interface SkillCommandInfo {
	name: string;
	source: string;
	sourceInfo?: SkillCommandSourceInfo;
}

export type MaterializeSkillErrorCode =
	| "skill-not-found"
	| "skill-not-skill"
	| "skill-ambiguous"
	| "skill-provenance-invalid"
	| "skill-unreadable";

export type MaterializeSkillResult =
	| {
		ok: true;
		content: string;
		source: { path: string; baseDir: string };
	}
	| {
		ok: false;
		code: MaterializeSkillErrorCode;
		message: string;
	};

export interface MaterializeSkillDependencies {
	commands: readonly SkillCommandInfo[];
	readFile?: (path: string, encoding: "utf8") => Promise<string>;
}

function failure(code: MaterializeSkillErrorCode, message: string): MaterializeSkillResult {
	return { ok: false, code, message };
}

/** Reproduces Pi 0.84.1's frontmatter/EOL behavior used by _expandSkillCommand. */
function stripPiFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return normalized;
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return normalized;
	return normalized.slice(endIndex + 4).trim();
}

export async function materializeSkill(
	name: string,
	args: string,
	dependencies: MaterializeSkillDependencies,
): Promise<MaterializeSkillResult> {
	const commandName = `skill:${name}`;
	const matches = dependencies.commands.filter((command) => command.name === commandName);
	if (matches.length === 0) {
		return failure("skill-not-found", `Skill ${name} is not present in pi.getCommands()`);
	}
	if (matches.length > 1) {
		return failure("skill-ambiguous", `Skill ${name} has ${matches.length} command provenances`);
	}

	const command = matches[0]!;
	if (command.source !== "skill") {
		return failure("skill-not-skill", `Command ${commandName} is not sourced from a skill`);
	}
	const path = command.sourceInfo?.path;
	const baseDir = command.sourceInfo?.baseDir;
	if (
		typeof path !== "string"
		|| path.trim() === ""
		|| !isAbsolute(path)
		|| typeof baseDir !== "string"
		|| baseDir.trim() === ""
		|| !isAbsolute(baseDir)
	) {
		return failure("skill-provenance-invalid", `Skill ${name} has no usable canonical path and baseDir`);
	}

	let source: string;
	try {
		source = await (dependencies.readFile ?? readFileDefault)(path, "utf8");
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return failure("skill-unreadable", `Cannot read canonical skill ${path}: ${detail}`);
	}

	const body = stripPiFrontmatter(source).trim();
	const block = [
		`<skill name="${name}" location="${path}">`,
		`References are relative to ${baseDir}.`,
		"",
		body,
		"</skill>",
	].join("\n");
	const trimmedArgs = args.trim();
	return {
		ok: true,
		content: trimmedArgs ? `${block}\n\n${trimmedArgs}` : block,
		source: { path, baseDir },
	};
}
