import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	materializeSkill,
	type MaterializeSkillResult,
	type SkillCommandInfo,
} from "./materialize.ts";

export interface SameSessionTransitionOptions {
	deliverAs?: "steer" | "followUp";
	readSkillFile?: (path: string, encoding: "utf8") => Promise<string>;
	stripSkillFrontmatter?: (content: string) => string | Promise<string>;
}

export type SameSessionTransitionResult =
	| { ok: true; source: { path: string; baseDir: string } }
	| Exclude<MaterializeSkillResult, { ok: true }>
	| { ok: false; code: "continuation-failed"; message: string };

export async function continueWithMaterializedSkill(
	pi: Pick<ExtensionAPI, "getCommands" | "sendUserMessage">,
	name: string,
	args: string,
	options: SameSessionTransitionOptions = {},
): Promise<SameSessionTransitionResult> {
	const materialized = await materializeSkill(name, args, {
		commands: pi.getCommands() as readonly SkillCommandInfo[],
		readFile: options.readSkillFile,
		stripFrontmatter: options.stripSkillFrontmatter,
	});
	if (!materialized.ok) return materialized;
	try {
		pi.sendUserMessage(
			materialized.content,
			options.deliverAs ? { deliverAs: options.deliverAs } : undefined,
		);
	} catch (error) {
		return {
			ok: false,
			code: "continuation-failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
	return { ok: true, source: materialized.source };
}
