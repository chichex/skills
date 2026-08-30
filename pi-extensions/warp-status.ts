import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TITLE = "warp://cli-agent";
const MAX_TEXT_LENGTH = 200;
const QUESTION_TOOLS = new Set(["ask_user_question", "ask_user_questions"]);

function truncate(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized.length <= MAX_TEXT_LENGTH
		? normalized
		: `${normalized.slice(0, MAX_TEXT_LENGTH - 3)}...`;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join(" ");
}

function questionText(args: unknown): string {
	if (typeof args !== "object" || args === null) return "Waiting for your answer";
	const question = (args as { question?: unknown }).question;
	if (typeof question === "string" && question.trim()) return truncate(question);

	const questions = (args as { questions?: unknown }).questions;
	if (Array.isArray(questions)) {
		const prompts = questions
			.map((entry) => typeof entry === "object" && entry !== null
				? (entry as { question?: unknown }).question
				: undefined)
			.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
		if (prompts.length > 0) return truncate(`Round of ${prompts.length}: ${prompts.join(" · ")}`);
	}
	return "Waiting for your answer";
}

function emitWarpEvent(
	ctx: ExtensionContext,
	event: string,
	extra: Record<string, unknown> = {},
): void {
	if (
		process.env.TERM_PROGRAM !== "WarpTerminal" ||
		!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
	) {
		return;
	}

	const payload = JSON.stringify({
		v: 1,
		agent: "pi",
		event,
		session_id: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		project: basename(ctx.cwd),
		...extra,
	});
	const sequence = `\x1b]777;notify;${TITLE};${payload}\x07`;

	try {
		writeFileSync("/dev/tty", sequence);
	} catch {
		try {
			process.stdout.write(sequence);
		} catch {
			// Ignore terminals where neither output path is available.
		}
	}
}

export default function (pi: ExtensionAPI) {
	let lastPrompt = "";
	let lastResponse = "";

	pi.on("before_agent_start", (event, ctx) => {
		lastPrompt = truncate(event.prompt);
		lastResponse = "";
		emitWarpEvent(ctx, "prompt_submit", { query: lastPrompt });
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const text = truncate(messageText(event.message.content));
		if (text) lastResponse = text;
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (!QUESTION_TOOLS.has(event.toolName)) return;
		emitWarpEvent(ctx, "question_asked", {
			summary: questionText(event.args),
			tool_name: event.toolName,
		});
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (!QUESTION_TOOLS.has(event.toolName)) return;
		emitWarpEvent(ctx, "tool_complete", { tool_name: event.toolName });
	});

	pi.on("agent_settled", (_event, ctx) => {
		emitWarpEvent(ctx, "stop", {
			query: lastPrompt,
			response: lastResponse,
			transcript_path: ctx.sessionManager.getSessionFile() ?? "",
		});
	});
}
