import { execFile } from "node:child_process";
import { cpus, freemem, homedir, platform, totalmem } from "node:os";
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

interface CpuTimes {
	idle: number;
	total: number;
}

interface SystemUsage {
	cpu?: number;
	ram?: number;
	disk?: number;
}

function readCpuTimes(): CpuTimes {
	let idle = 0;
	let total = 0;
	for (const cpu of cpus()) {
		idle += cpu.times.idle;
		total += Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
	}
	return { idle, total };
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function readMacRamUsage(): Promise<number | undefined> {
	return new Promise((resolve) => {
		execFile("/usr/bin/memory_pressure", ["-Q"], { timeout: 2_000 }, (error, stdout) => {
			if (error) return resolve(undefined);
			const freeMatch = stdout.match(/free percentage:\s*(\d+)%/i);
			resolve(freeMatch ? clampPercent(100 - Number(freeMatch[1])) : undefined);
		});
	});
}

export default function visualFooter(pi: ExtensionAPI) {
	let working = false;
	let enabled = true;
	let worktreeName: string | undefined;
	let requestRender: () => void = () => {};
	let systemUsage: SystemUsage = {};
	let previousCpuTimes: CpuTimes | undefined;
	let metricsTimer: ReturnType<typeof setInterval> | undefined;
	let staticUsageSampledAt = 0;
	let staticUsageRefreshInFlight = false;

	const detectWorktree = async (cwd: string): Promise<string | undefined> => {
		const result = await pi.exec(
			"git",
			["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
			{ cwd, timeout: 2_000 },
		);
		if (result.code !== 0) return undefined;

		const [gitDir, commonDir] = result.stdout.trim().split(/\r?\n/);
		if (!gitDir || !commonDir || gitDir === commonDir) return undefined;
		return basename(gitDir);
	};

	const refreshSystemUsage = async (ctx: ExtensionContext): Promise<void> => {
		const memoryTotal = totalmem();
		if (platform() !== "darwin") {
			systemUsage.ram = memoryTotal > 0 ? clampPercent(((memoryTotal - freemem()) / memoryTotal) * 100) : undefined;
		}

		const currentCpuTimes = readCpuTimes();
		if (previousCpuTimes) {
			const totalDelta = currentCpuTimes.total - previousCpuTimes.total;
			const idleDelta = currentCpuTimes.idle - previousCpuTimes.idle;
			if (totalDelta > 0) systemUsage.cpu = clampPercent((1 - idleDelta / totalDelta) * 100);
		}
		previousCpuTimes = currentCpuTimes;

		requestRender();

		if (staticUsageRefreshInFlight || Date.now() - staticUsageSampledAt < 30_000) return;
		staticUsageRefreshInFlight = true;
		try {
			if (platform() === "darwin") {
				systemUsage.ram = await readMacRamUsage();
			}

			const diskResult = await pi.exec("df", ["-Pk", ctx.cwd], { timeout: 2_000 });
			if (diskResult.code === 0) {
				const dataLine = diskResult.stdout.trim().split(/\r?\n/).at(-1);
				const match = dataLine?.match(/\s(\d+)%\s/);
				if (match) systemUsage.disk = clampPercent(Number(match[1]));
			}
		} catch {
			// Keep the last known values when a system command is unavailable.
		} finally {
			staticUsageSampledAt = Date.now();
			staticUsageRefreshInFlight = false;
			requestRender();
		}
	};

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
					const stateDot = theme.fg(working ? "warning" : "dim", working ? "●" : "○");
					const projectText = theme.bold(theme.fg("accent", project));
					const pathText = `${stateDot}  ${theme.fg("muted", parent)}${projectText}`;

					const branch = footerData.getGitBranch();
					const sessionName = ctx.sessionManager.getSessionName();
					const locationParts: string[] = [];
					if (working) locationParts.push(theme.bold(theme.fg("warning", "WORKING")));
					if (worktreeName) {
						locationParts.push(
							`${theme.fg("muted", "wt:")}${theme.bold(theme.fg("warning", worktreeName))}`,
						);
					}
					if (branch) {
						locationParts.push(`${theme.fg("dim", "git:")}${theme.fg("muted", branch)}`);
					}
					if (sessionName && width >= 100) locationParts.push(theme.fg("accent", sessionName));
					const locationLine = align(pathText, locationParts.join(separator), width);

					const badge = (
						icon: string,
						value: string,
						color: "accent" | "muted" | "warning" | "error",
					) => theme.bg("selectedBg", theme.fg(color, ` ${icon} ${value} `));

					const inputBadge = badge("↑", formatTokens(totalInput), "accent");
					const outputBadge = badge("↓", formatTokens(totalOutput), "muted");
					const subscribed = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
					const costLabel = subscribed ? `SUB $${totalCost.toFixed(3)}` : `$${totalCost.toFixed(3)}`;
					const costBadge = badge("◆", costLabel, "muted");

					const usage = ctx.getContextUsage();
					const percent = usage?.percent;
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextColor =
						percent !== null && percent !== undefined && percent >= 85
							? "error"
							: percent !== null && percent !== undefined && percent >= 60
								? "warning"
								: "muted";
					const filled = percent === null || percent === undefined ? 0 : Math.min(10, Math.round(percent / 10));
					const bar = percent === null || percent === undefined ? "??????????" : `${"■".repeat(filled)}${"□".repeat(10 - filled)}`;
					const percentText = percent === null || percent === undefined ? "?" : `${percent.toFixed(1)}%`;
					const contextText =
						theme.fg("muted", "CTX ") +
						theme.bold(theme.fg(contextColor, `[${bar}] ${percentText}`)) +
						theme.fg("muted", `/${formatTokens(contextWindow)}`);

					const usageColor = (value: number | undefined): "muted" | "warning" | "error" =>
						value !== undefined && value >= 90
							? "error"
							: value !== undefined && value >= 70
								? "warning"
								: "muted";
					const usageValue = (value: number | undefined) =>
						value === undefined ? "?" : `${Math.round(value)}%`;
					const systemBadges = [
						badge("CPU", usageValue(systemUsage.cpu), usageColor(systemUsage.cpu)),
						badge("RAM", usageValue(systemUsage.ram), usageColor(systemUsage.ram)),
						badge("DSK", usageValue(systemUsage.disk), usageColor(systemUsage.disk)),
					].join(" ");

					let statsLeft: string;
					if (width >= 150) {
						statsLeft = [inputBadge, outputBadge, costBadge, contextText, systemBadges].join(" ");
					} else if (width >= 125) {
						statsLeft = [inputBadge, outputBadge, contextText, systemBadges].join(" ");
					} else if (width >= 100) {
						statsLeft = [contextText, systemBadges].join(" ");
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
					const providerText = width >= 95 ? `${theme.fg("dim", "(")}${theme.fg("muted", provider)}${theme.fg("dim", ") ")}` : "";
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
						lines.push(truncateToWidth(`${theme.fg("dim", "◈ ")}${statuses.join("  ")}`, width, "…"));
					}
					return lines;
				},
			};
		});
	};

	pi.on("session_start", async (_event, ctx) => {
		working = false;
		systemUsage = {};
		previousCpuTimes = readCpuTimes();
		staticUsageSampledAt = 0;
		worktreeName = await detectWorktree(ctx.cwd).catch(() => undefined);
		if (enabled) installFooter(ctx);
		void refreshSystemUsage(ctx);
		metricsTimer = setInterval(() => void refreshSystemUsage(ctx), 2_000);
	});

	pi.on("session_shutdown", () => {
		if (metricsTimer) clearInterval(metricsTimer);
		metricsTimer = undefined;
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
