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

export type PreparedMaterializedSkill = Extract<MaterializeSkillResult, { ok: true }>;
export type SameSessionTransitionResult =
	| { ok: true; queued: true; source: { path: string; baseDir: string } }
	| Exclude<MaterializeSkillResult, { ok: true }>;

type SkillLookupAPI = Pick<ExtensionAPI, "getCommands">;
type SkillQueueAPI = Pick<ExtensionAPI, "sendUserMessage">;

/**
 * Resolve and read the canonical skill without sending a message. Consumers
 * that must persist state can use this as a fail-closed preflight, then write,
 * then call queueMaterializedSkill.
 */
export function prepareMaterializedSkill(
	pi: SkillLookupAPI,
	name: string,
	args: string,
	options: SameSessionTransitionOptions = {},
): Promise<MaterializeSkillResult> {
	return materializeSkill(name, args, {
		commands: pi.getCommands() as readonly SkillCommandInfo[],
		readFile: options.readSkillFile,
		stripFrontmatter: options.stripSkillFrontmatter,
	});
}

/**
 * Queue already-materialized content. ExtensionAPI.sendUserMessage is
 * intentionally fire-and-forget: this receipt means Pi accepted the queue
 * request synchronously, not that the ensuing provider turn succeeded.
 * Asynchronous delivery failures are surfaced by Pi as extension_error.
 */
export function queueMaterializedSkill(
	pi: SkillQueueAPI,
	prepared: PreparedMaterializedSkill,
	options: Pick<SameSessionTransitionOptions, "deliverAs"> = {},
): Extract<SameSessionTransitionResult, { ok: true }> {
	pi.sendUserMessage(
		prepared.content,
		options.deliverAs ? { deliverAs: options.deliverAs } : undefined,
	);
	return { ok: true, queued: true, source: prepared.source };
}

export async function continueWithMaterializedSkill(
	pi: SkillLookupAPI & SkillQueueAPI,
	name: string,
	args: string,
	options: SameSessionTransitionOptions = {},
): Promise<SameSessionTransitionResult> {
	const prepared = await prepareMaterializedSkill(pi, name, args, options);
	if (!prepared.ok) return prepared;
	return queueMaterializedSkill(pi, prepared, options);
}
