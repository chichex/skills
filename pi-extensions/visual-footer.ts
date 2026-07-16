import { homedir } from "node:os";
import { basename, relative } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}

function shortCwd(cwd: string): string {
	const home = homedir();
	const fromHome = relative(home, cwd);
	if (fromHome === "") return "~";
	if (fromHome !== ".." && !fromHome.startsWith("../")) return `~/${fromHome}`;
	return cwd;
}

function cleanStatus(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function visualFooter(pi: ExtensionAPI) {
	let working = false;
	let enabled = true;
	let requestRender: () => void = () => {};

	const installFooter = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(requestRender);

			const align = (left: string, right: string, width: number): string => {
				if (!right) return truncateToWidth(left, width, "…");

				const rightWidth = visibleWidth(right);
				if (rightWidth >= width - 8) return truncateToWidth(right, width, "…");

				const leftWidth = Math.max(0, width - rightWidth - 2);
				const fittedLeft = truncateToWidth(left, leftWidth, "…");
				const padding = " ".repeat(Math.max(2, width - visibleWidth(fittedLeft) - rightWidth));
				return fittedLeft + padding + right;
			};

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					let totalInput = 0;
					let totalOutput = 0;
					let totalCost = 0;

					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						totalInput += entry.message.usage.input;
						totalOutput += entry.message.usage.output;
						totalCost += entry.message.usage.cost.total;
					}

					const separator = theme.fg("dim", " │ ");
					const cwd = shortCwd(ctx.cwd);
					const project = basename(ctx.cwd) || cwd;
					const parent = cwd.endsWith(project) ? cwd.slice(0, -project.length) : "";
					const stateDot = theme.fg(working ? "warning" : "success", "●");
					const projectText = theme.bold(theme.fg("accent", project));
					const pathText = `${stateDot}  ${theme.fg("muted", parent)}${projectText}`;

					const branch = footerData.getGitBranch();
					const sessionName = ctx.sessionManager.getSessionName();
					const locationParts: string[] = [];
					if (working) locationParts.push(theme.bold(theme.fg("warning", "WORKING")));
					if (branch) {
						locationParts.push(`${theme.fg("muted", "git:")}${theme.bold(theme.fg("success", branch))}`);
					}
					if (sessionName && width >= 100) locationParts.push(theme.fg("accent", sessionName));
					const locationLine = align(pathText, locationParts.join(separator), width);

					const badge = (icon: string, value: string, color: "accent" | "success" | "warning") =>
						theme.bg("selectedBg", theme.bold(theme.fg(color, ` ${icon} ${value} `)));

					const inputBadge = badge("↑", formatTokens(totalInput), "accent");
					const outputBadge = badge("↓", formatTokens(totalOutput), "success");
					const subscribed = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
					const costLabel = subscribed ? `SUB $${totalCost.toFixed(3)}` : `$${totalCost.toFixed(3)}`;
					const costBadge = badge("◆", costLabel, "warning");

					const usage = ctx.getContextUsage();
					const percent = usage?.percent;
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextColor =
						percent !== null && percent !== undefined && percent >= 85
							? "error"
							: percent !== null && percent !== undefined && percent >= 60
								? "warning"
								: "success";
					const filled = percent === null || percent === undefined ? 0 : Math.min(10, Math.round(percent / 10));
					const bar = percent === null || percent === undefined ? "??????????" : `${"■".repeat(filled)}${"□".repeat(10 - filled)}`;
					const percentText = percent === null || percent === undefined ? "?" : `${percent.toFixed(1)}%`;
					const contextText =
						theme.fg("muted", "CTX ") +
						theme.bold(theme.fg(contextColor, `[${bar}] ${percentText}`)) +
						theme.fg("muted", `/${formatTokens(contextWindow)}`);

					let statsLeft: string;
					if (width >= 110) {
						statsLeft = [inputBadge, outputBadge, costBadge, contextText].join(" ");
					} else if (width >= 78) {
						statsLeft = [inputBadge, outputBadge, contextText].join(" ");
					} else {
						statsLeft = contextText;
					}

					const provider = ctx.model?.provider ?? "no-provider";
					const model = ctx.model?.id ?? "no-model";
					const thinking = pi.getThinkingLevel();
					const thinkingColors = {
						off: "thinkingOff",
						minimal: "thinkingMinimal",
						low: "thinkingLow",
						medium: "thinkingMedium",
						high: "thinkingHigh",
						xhigh: "thinkingXhigh",
						max: "thinkingMax",
					} as const;
					const providerText = width >= 95 ? `${theme.fg("muted", "(")}${theme.fg("accent", provider)}${theme.fg("muted", ") ")}` : "";
					const modelText = theme.bold(theme.fg("text", model));
					const thinkingText = theme.bold(theme.fg(thinkingColors[thinking], thinking.toUpperCase()));
					const modelSide = `${providerText}${modelText}${separator}${thinkingText}`;
					const statsLine = align(statsLeft, modelSide, width);

					const lines = [locationLine, statsLine];
					const statuses = [...footerData.getExtensionStatuses().entries()]
						.filter(([key]) => key !== "visual-footer")
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => cleanStatus(text));
					if (statuses.length > 0) {
						lines.push(truncateToWidth(theme.fg("accent", `◈ ${statuses.join("  ")}`), width, "…"));
					}
					return lines;
				},
			};
		});
	};

	pi.on("session_start", (_event, ctx) => {
		working = false;
		if (enabled) installFooter(ctx);
	});

	pi.on("agent_start", () => {
		working = true;
		requestRender();
	});

	pi.on("agent_settled", () => {
		working = false;
		requestRender();
	});

	pi.on("message_end", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());
	pi.on("session_info_changed", () => requestRender());
	pi.on("session_compact", () => requestRender());

	pi.registerCommand("visual-footer", {
		description: "Toggle the colorful visual footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				installFooter(ctx);
				ctx.ui.notify("Visual footer enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
			}
		},
	});
}
