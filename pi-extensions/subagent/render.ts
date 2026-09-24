// Render TUI de la tool `subagent`, portado del ejemplo de Pi 0.85.1
// (examples/extensions/subagent/index.ts). Solo lo carga index.ts: la logica
// probada en tool.ts/jobs.ts no depende de pi-tui.

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import * as os from "node:os";

import { COLLAPSED_ITEM_COUNT, type ChildMessage, formatUsageStats, getFinalOutput, isFailedResult, type SingleResult } from "./jobs.ts";
import type { BackgroundDetails, SubagentDetails, SubagentParams } from "./tool.ts";

type ThemeFg = (color: string, text: string) => string;

interface ThemeLike {
	fg: ThemeFg;
	bold: (text: string) => string;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> };

function shortenPath(path: string): string {
	const home = os.homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function formatToolCall(toolName: string, args: Record<string, unknown>, themeFg: ThemeFg): string {
	const pathArg = (args.file_path || args.path || "...") as string;
	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let label = themeFg("accent", shortenPath(pathArg));
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				label += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + label;
		}
		case "write": {
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let label = themeFg("muted", "write ") + themeFg("accent", shortenPath(pathArg));
			if (lines > 1) label += themeFg("dim", ` (${lines} lines)`);
			return label;
		}
		case "edit":
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(pathArg));
		case "ls":
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath((args.path || ".") as string));
		case "find": {
			const pattern = (args.pattern || "*") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			return themeFg("muted", "grep ") + themeFg("accent", `/${pattern}/`) + themeFg("dim", ` in ${shortenPath((args.path || ".") as string)}`);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

function getDisplayItems(messages: ChildMessage[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text" && part.text) items.push({ type: "text", text: part.text });
			else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name ?? "?", args: part.arguments ?? {} });
		}
	}
	return items;
}

function aggregateUsage(results: SingleResult[]) {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const result of results) {
		total.input += result.usage.input;
		total.output += result.usage.output;
		total.cacheRead += result.usage.cacheRead;
		total.cacheWrite += result.usage.cacheWrite;
		total.cost += result.usage.cost;
		total.turns += result.usage.turns;
	}
	return total;
}

export function renderCall(args: SubagentParams, theme: ThemeLike): Text {
	const scope = args.agentScope ?? "package";
	if (args.chain && args.chain.length > 0) {
		let out = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `chain (${args.chain.length} steps)`) + theme.fg("muted", ` [${scope}]`);
		for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
			const step = args.chain[i]!;
			const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
			const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
			out += `\n	${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${preview}`)}`;
		}
		if (args.chain.length > 3) out += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
		return new Text(out, 0, 0);
	}
	if (args.tasks && args.tasks.length > 0) {
		let out = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `parallel (${args.tasks.length} tasks)`) + theme.fg("muted", ` [${scope}]`);
		for (const item of args.tasks.slice(0, 3)) {
			const preview = item.task.length > 40 ? `${item.task.slice(0, 40)}...` : item.task;
			out += `\n	${theme.fg("accent", item.agent)}${theme.fg("dim", ` ${preview}`)}`;
		}
		if (args.tasks.length > 3) out += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
		return new Text(out, 0, 0);
	}
	const agentName = args.agent || "...";
	const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
	let out = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName) + theme.fg("muted", ` [${scope}]`);
	if (args.background) out += theme.fg("warning", " background");
	out += `\n	${theme.fg("dim", preview)}`;
	return new Text(out, 0, 0);
}

function isBackgroundDetails(details: unknown): details is BackgroundDetails {
	return typeof details === "object" && details !== null && "jobId" in details;
}

export function renderResult(
	result: { content: Array<{ type: string; text?: string }>; details?: unknown },
	{ expanded }: { expanded: boolean },
	theme: ThemeLike,
): Text | Container {
	const first = result.content[0];
	const fallback = first?.type === "text" ? (first.text ?? "") : "(no output)";
	if (isBackgroundDetails(result.details)) {
		const details = result.details;
		return new Text(
			`${theme.fg("warning", "⏳")} ${theme.fg("toolTitle", theme.bold(details.jobId))} ${theme.fg("accent", details.agent)}${theme.fg("muted", " en background")}\n${theme.fg("dim", fallback)}`,
			0,
			0,
		);
	}
	const details = result.details as SubagentDetails | undefined;
	// `?.` cubre tambien `details: {}` (sin `results`): lo que produce Pi al
	// colapsar un execute() que rechaza (PR #48 review, comment 4076517102),
	// que index.ts ahora hace para que isError llegue al runtime real.
	if (!details?.results?.length) return new Text(fallback, 0, 0);

	const mdTheme = getMarkdownTheme();
	const fg = theme.fg.bind(theme);

	const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
		const toShow = limit ? items.slice(-limit) : items;
		const skipped = limit && items.length > limit ? items.length - limit : 0;
		let out = "";
		if (skipped > 0) out += theme.fg("muted", `... ${skipped} earlier items\n`);
		for (const item of toShow) {
			if (item.type === "text") {
				const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
				out += `${theme.fg("toolOutput", preview)}\n`;
			} else {
				out += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, fg)}\n`;
			}
		}
		return out.trimEnd();
	};

	const addToolCalls = (container: Container, items: DisplayItem[]) => {
		for (const item of items) {
			if (item.type === "toolCall") {
				container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, fg), 0, 0));
			}
		}
	};

	if (details.mode === "single" && details.results.length === 1) {
		const r = details.results[0]!;
		const isError = isFailedResult(r);
		const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
		const displayItems = getDisplayItems(r.messages);
		const finalOutput = getFinalOutput(r.messages);
		const header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}${isError && r.stopReason ? ` ${theme.fg("error", `[${r.stopReason}]`)}` : ""}`;

		if (expanded) {
			const container = new Container();
			container.addChild(new Text(header, 0, 0));
			if (isError && r.errorMessage) container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
			container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
			if (displayItems.length === 0 && !finalOutput) {
				container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
			} else {
				addToolCalls(container, displayItems);
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}
			}
			const usageStr = formatUsageStats(r.usage, r.model);
			if (usageStr) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
			}
			return container;
		}

		let out = header;
		if (isError && r.errorMessage) out += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
		else if (displayItems.length === 0) out += `\n${theme.fg("muted", "(no output)")}`;
		else {
			out += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
			if (displayItems.length > COLLAPSED_ITEM_COUNT) out += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		}
		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) out += `\n${theme.fg("dim", usageStr)}`;
		return new Text(out, 0, 0);
	}

	if (details.mode === "chain") {
		const successCount = details.results.filter((r) => r.exitCode === 0).length;
		const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const title = `${icon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", `${successCount}/${details.results.length} steps`)}`;

		if (expanded) {
			const container = new Container();
			container.addChild(new Text(title, 0, 0));
			for (const r of details.results) {
				const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);
				container.addChild(new Spacer(1));
				container.addChild(new Text(`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0));
				container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));
				addToolCalls(container, displayItems);
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}
				const stepUsage = formatUsageStats(r.usage, r.model);
				if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
			}
			const usageStr = formatUsageStats(aggregateUsage(details.results));
			if (usageStr) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
			}
			return container;
		}

		let out = title;
		for (const r of details.results) {
			const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
			const displayItems = getDisplayItems(r.messages);
			out += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
			out += displayItems.length === 0 ? `\n${theme.fg("muted", "(no output)")}` : `\n${renderDisplayItems(displayItems, 5)}`;
		}
		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) out += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
		out += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		return new Text(out, 0, 0);
	}

	if (details.mode === "parallel") {
		const running = details.results.filter((r) => r.exitCode === -1).length;
		const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
		const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
		const isRunning = running > 0;
		const icon = isRunning ? theme.fg("warning", "⏳") : failCount > 0 ? theme.fg("warning", "◐") : theme.fg("success", "✓");
		const status = isRunning
			? `${successCount + failCount}/${details.results.length} done, ${running} running`
			: `${successCount}/${details.results.length} tasks`;
		const title = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;

		if (expanded && !isRunning) {
			const container = new Container();
			container.addChild(new Text(title, 0, 0));
			for (const r of details.results) {
				const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);
				container.addChild(new Spacer(1));
				container.addChild(new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0));
				container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));
				addToolCalls(container, displayItems);
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}
				const taskUsage = formatUsageStats(r.usage, r.model);
				if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
			}
			const usageStr = formatUsageStats(aggregateUsage(details.results));
			if (usageStr) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
			}
			return container;
		}

		let out = title;
		for (const r of details.results) {
			const rIcon = r.exitCode === -1 ? theme.fg("warning", "⏳") : isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
			const displayItems = getDisplayItems(r.messages);
			out += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
			if (displayItems.length === 0) out += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
			else out += `\n${renderDisplayItems(displayItems, 5)}`;
		}
		if (!isRunning) {
			const usageStr = formatUsageStats(aggregateUsage(details.results));
			if (usageStr) out += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
		}
		if (!expanded) out += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		return new Text(out, 0, 0);
	}

	return new Text(fallback, 0, 0);
}
