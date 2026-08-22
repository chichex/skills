import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	materializeSkill,
	type SkillCommandInfo,
} from "../workflow-orchestrator/materialize.ts";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface WaitPrExtensionDependencies {
	readSkillFile?: (path: string, encoding: "utf8") => Promise<string>;
	stripSkillFrontmatter?: (content: string) => string | Promise<string>;
}

export function registerWaitPrExtension(
	pi: ExtensionAPI,
	dependencies: WaitPrExtensionDependencies = {},
): void {
	pi.registerCommand("wait-pr", {
		description: "Monitorear PRs nuevos y ejecutar code-review cuando aparezcan",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/wait-pr requiere modo TUI", "error");
				return;
			}

			try {
				await ctx.waitForIdle();
				const commands = pi.getCommands() as readonly SkillCommandInfo[];
				const hasCodeReview = commands.some(
					(command) => command.name === "skill:code-review" && command.source === "skill",
				);
				if (!hasCodeReview) {
					ctx.ui.notify("No se puede iniciar /wait-pr: falta /skill:code-review", "error");
					return;
				}

				const materialized = await materializeSkill("wait-pr", args, {
					commands,
					readFile: dependencies.readSkillFile,
					stripFrontmatter: dependencies.stripSkillFrontmatter,
				});
				if (!materialized.ok) {
					ctx.ui.notify(`No se puede iniciar /wait-pr: ${materialized.message}`, "error");
					return;
				}

				pi.sendUserMessage(materialized.content);
			} catch (error) {
				ctx.ui.notify(`No se puede iniciar /wait-pr: ${errorMessage(error)}`, "error");
			}
		},
	});
}

export default function waitPrExtension(pi: ExtensionAPI): void {
	registerWaitPrExtension(pi);
}
