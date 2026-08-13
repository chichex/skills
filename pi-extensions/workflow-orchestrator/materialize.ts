import { readFile as readFileDefault } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

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
	| "skill-unreadable"
	| "skill-frontmatter-invalid";

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
	/**
	 * Defaults to Pi 0.84.1's own exported stripFrontmatter (dynamically
	 * imported from @earendil-works/pi-coding-agent, like staging.ts does for
	 * SessionManager), so malformed frontmatter YAML fails exactly like
	 * _expandSkillCommand's skill_expansion error path instead of silently
	 * stripping and succeeding.
	 */
	stripFrontmatter?: (content: string) => string | Promise<string>;
}

function failure(code: MaterializeSkillErrorCode, message: string): MaterializeSkillResult {
	return { ok: false, code, message };
}

async function defaultStripFrontmatter(content: string): Promise<string> {
	const { stripFrontmatter } = await import("@earendil-works/pi-coding-agent");
	return stripFrontmatter(content);
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
	// pi.getCommands() only ever surfaces sourceInfo for a skill command
	// (agent-session.js _bindExtensionCore: `{..., source: "skill", sourceInfo:
	// skill.sourceInfo}` — filePath/baseDir themselves are never exposed here).
	// sourceInfo.path always mirrors skill.filePath (resource-loader.js
	// findSourceInfoForPath always sets `path: resourcePath` before anything
	// else), so it stays trustworthy. sourceInfo.baseDir does NOT: for
	// extension-registered or metadata-matched skills, findSourceInfoForPath
	// overwrites the whole sourceInfo with registration provenance, which can
	// carry an unrelated baseDir. Pi's own _expandSkillCommand never reads
	// sourceInfo.baseDir either — it reads skill.baseDir, which skills.js
	// loadSkillFromFile always sets to dirname(filePath), with no override
	// path. Deriving baseDir from dirname(path) here instead of trusting
	// sourceInfo.baseDir keeps us aligned with Pi regardless of that overwrite.
	const path = command.sourceInfo?.path;
	if (typeof path !== "string" || path.trim() === "" || !isAbsolute(path)) {
		return failure("skill-provenance-invalid", `Skill ${name} has no usable canonical path`);
	}
	const baseDir = dirname(path);

	let source: string;
	try {
		source = await (dependencies.readFile ?? readFileDefault)(path, "utf8");
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return failure("skill-unreadable", `Cannot read canonical skill ${path}: ${detail}`);
	}

	let strippedBody: string;
	try {
		strippedBody = await (dependencies.stripFrontmatter ?? defaultStripFrontmatter)(source);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return failure("skill-frontmatter-invalid", `Skill ${name} has malformed frontmatter YAML: ${detail}`);
	}

	const body = strippedBody.trim();
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
