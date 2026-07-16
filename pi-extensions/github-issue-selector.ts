import { StringEnum } from "@earendil-works/pi-ai";
import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import {
	getMarkdownTheme,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export interface IssueListItem {
	number: number;
	title: string;
	body?: string;
	url: string;
	state: string;
	updatedAt: string;
	author?: { login?: string } | null;
	labels: Array<{ name: string }>;
}

export interface IssueDetails extends IssueListItem {
	body: string;
	assignees: Array<{ login: string }>;
	milestone?: { title?: string } | null;
	comments?: Array<{ body: string; author?: { login?: string } | null }>;
}

export interface RelatedIssueFinding {
	number: number;
	title: string;
	state: string;
	relationship: "prerequisite" | "dependent" | "overlap" | "context";
	reason: string;
	mustBeDoneFirst: boolean;
	confidence: "high" | "medium" | "low";
}

export interface RelatedIssueAnalysis {
	summary: string;
	related: RelatedIssueFinding[];
	analysisError?: string;
}

const parameters = Type.Object({
	state: Type.Optional(
		StringEnum(["open", "closed", "all"] as const, {
			description: "Issue state to list. Defaults to open.",
		}),
	),
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 100,
			description: "Maximum number of issues to show. Defaults to 30.",
		}),
	),
	query: Type.Optional(
		Type.String({
			description: "Optional GitHub issue search query.",
		}),
	),
	repo: Type.Optional(
		Type.String({
			description: "Optional owner/repo. Defaults to the repository for the current working directory.",
		}),
	),
});

function parseJson<T>(text: string, context: string): T {
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`${context} returned invalid JSON`);
	}
}

function ghError(stderr: string, fallback: string): Error {
	const message = stderr.trim();
	return new Error(message || fallback);
}

function formatChoice(issue: IssueListItem): string {
	const labels = issue.labels.map((label) => label.name).filter(Boolean);
	const suffix = labels.length > 0 ? `  [${labels.join(", ")}]` : "";
	return `#${issue.number} ${issue.title}${suffix}`;
}

export type IssueCandidate = IssueListItem & { body: string };

const RELATED_ISSUES_SYSTEM_PROMPT = `You analyze relationships between GitHub issues.

Given one selected issue and a catalog of candidate issues from the same repository:
- Identify only materially related issues. Similar labels or generic words alone are not enough.
- Classify each relationship as prerequisite, dependent, overlap, or context.
- Set mustBeDoneFirst=true only when the candidate is an OPEN technical or logical prerequisite that still blocks the selected issue. A CLOSED issue may be a prerequisite already satisfied, but must always have mustBeDoneFirst=false.
- Base every finding on concrete evidence from titles, bodies, comments, explicit #number references, shared components, or required sequencing.
- Include at most 8 findings, ordered by importance.
- Use only issue numbers present in the candidate catalog.

Return JSON only, with this exact shape:
{
  "summary": "brief conclusion",
  "related": [
    {
      "number": 123,
      "relationship": "prerequisite|dependent|overlap|context",
      "reason": "concrete evidence",
      "mustBeDoneFirst": false,
      "confidence": "high|medium|low"
    }
  ]
}`;

function clip(text: string | undefined, maxLength: number): string {
	const value = (text ?? "").trim();
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function extractJsonObject(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
	if (fenced) return fenced;
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) return text.slice(start, end + 1);
	return text.trim();
}

function normalizeRelatedAnalysis(text: string, candidates: IssueCandidate[]): RelatedIssueAnalysis {
	const raw = parseJson<{
		summary?: unknown;
		related?: Array<{
			number?: unknown;
			relationship?: unknown;
			reason?: unknown;
			mustBeDoneFirst?: unknown;
			confidence?: unknown;
		}>;
	}>(extractJsonObject(text), "related issue analysis");
	const byNumber = new Map(candidates.map((candidate) => [candidate.number, candidate]));
	const relationships = new Set(["prerequisite", "dependent", "overlap", "context"]);
	const confidences = new Set(["high", "medium", "low"]);
	const seen = new Set<number>();
	const related: RelatedIssueFinding[] = [];

	for (const finding of Array.isArray(raw.related) ? raw.related : []) {
		const number = typeof finding.number === "number" ? finding.number : Number(finding.number);
		const candidate = byNumber.get(number);
		if (!candidate || seen.has(number)) continue;
		seen.add(number);

		const relationship = relationships.has(String(finding.relationship))
			? (String(finding.relationship) as RelatedIssueFinding["relationship"])
			: "context";
		const confidence = confidences.has(String(finding.confidence))
			? (String(finding.confidence) as RelatedIssueFinding["confidence"])
			: "low";

		const isOpen = candidate.state.toUpperCase() === "OPEN";
		related.push({
			number,
			title: candidate.title,
			state: candidate.state,
			relationship,
			reason: clip(typeof finding.reason === "string" ? finding.reason : "Related by issue analysis.", 320),
			mustBeDoneFirst: isOpen && relationship === "prerequisite" && finding.mustBeDoneFirst === true,
			confidence,
		});
		if (related.length === 8) break;
	}

	return {
		summary: clip(typeof raw.summary === "string" ? raw.summary : "Related issue analysis completed.", 500),
		related,
	};
}

export async function analyzeRelatedIssues(
	ctx: ExtensionContext,
	issue: IssueDetails,
	candidates: IssueCandidate[],
	signal: AbortSignal,
): Promise<RelatedIssueAnalysis> {
	if (!ctx.model) {
		return { summary: "No se pudo analizar: no hay un modelo activo.", related: [], analysisError: "No active model" };
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) {
		const error = auth.ok ? `No API key for ${ctx.model.provider}` : auth.error;
		return { summary: `No se pudo analizar: ${error}`, related: [], analysisError: error };
	}

	const comments = clip(
		(issue.comments ?? [])
			.map((comment) => `@${comment.author?.login ?? "unknown"}: ${clip(comment.body, 1_000)}`)
			.join("\n\n"),
		8_000,
	);
	const catalog = candidates
		.slice(0, 100)
		.map((candidate) => {
			const labels = candidate.labels.map((label) => label.name).filter(Boolean).join(", ") || "none";
			return `#${candidate.number} [${candidate.state}] ${candidate.title}\nLabels: ${labels}\n${clip(candidate.body, 700)}`;
		})
		.join("\n\n---\n\n");
	const userMessage: UserMessage = {
		role: "user",
		content: [{
			type: "text",
			text: [
				"SELECTED ISSUE",
				`#${issue.number} [${issue.state}] ${issue.title}`,
				`Labels: ${issue.labels.map((label) => label.name).join(", ") || "none"}`,
				clip(issue.body, 12_000) || "(no body)",
				comments ? `\nCOMMENTS\n${comments}` : "",
				"\nCANDIDATE ISSUES",
				catalog || "(none)",
			].filter(Boolean).join("\n\n"),
		}],
		timestamp: Date.now(),
	};

	const response = await complete(
		ctx.model,
		{ systemPrompt: RELATED_ISSUES_SYSTEM_PROMPT, messages: [userMessage] },
		{ apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal },
	);
	if (response.stopReason === "aborted") throw new Error("Related issue analysis was cancelled");
	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	return normalizeRelatedAnalysis(text, candidates);
}

export function formatRelatedAnalysis(issue: IssueDetails, analysis: RelatedIssueAnalysis): string {
	const lines = [
		`## Análisis de relaciones para #${issue.number}`,
		"",
		analysis.summary,
		"",
	];
	if (analysis.analysisError) {
		lines.push("> No hubo análisis semántico completo; podés continuar igualmente.");
	} else if (analysis.related.length === 0) {
		lines.push("No encontré otros issues materialmente relacionados.");
	} else {
		lines.push("### Issues relacionados", "");
		for (const finding of analysis.related) {
			const isClosedPrerequisite = finding.relationship === "prerequisite" && finding.state.toUpperCase() === "CLOSED";
			const marker = finding.mustBeDoneFirst
				? "PRERREQUISITO PENDIENTE"
				: isClosedPrerequisite ? "PRERREQUISITO CUMPLIDO" : finding.relationship.toUpperCase();
			lines.push(
				`- **#${finding.number} — ${finding.title}**`,
				`  - Relación: **${marker}** · estado: ${finding.state.toLowerCase()} · confianza: ${finding.confidence}`,
				`  - Motivo: ${finding.reason}`,
			);
		}
	}
	const prerequisites = analysis.related.filter((finding) => finding.mustBeDoneFirst);
	lines.push(
		"",
		prerequisites.length > 0
			? `### Orden recomendado\n\nResolver primero **${prerequisites.map((finding) => `#${finding.number}`).join(", ")}**.`
			: "### Orden recomendado\n\nNo detecté un issue que necesariamente haya que completar antes.",
	);
	return lines.join("\n");
}

function formatIssue(issue: IssueDetails): string {
	const labels = issue.labels.map((label) => label.name).filter(Boolean).join(", ") || "none";
	const assignees = issue.assignees.map((assignee) => assignee.login).filter(Boolean).join(", ") || "none";
	const author = issue.author?.login || "unknown";
	const milestone = issue.milestone?.title || "none";
	const body = issue.body.trim() || "(no description)";

	const output = [
		`Selected GitHub issue #${issue.number}: ${issue.title}`,
		`URL: ${issue.url}`,
		`State: ${issue.state}`,
		`Author: ${author}`,
		`Labels: ${labels}`,
		`Assignees: ${assignees}`,
		`Milestone: ${milestone}`,
		"",
		"Body:",
		body,
	].join("\n");
	const truncated = truncateHead(output, { maxBytes: 40 * 1024, maxLines: 1_850 });
	return truncated.truncated
		? `${truncated.content}\n\n[Issue content truncated; open ${issue.url} for the full body.]`
		: truncated.content;
}

export default function (pi: ExtensionAPI) {
	pi.registerEntryRenderer("github-issue-analysis", (entry) => {
		const data = entry.data as { markdown?: string };
		return new Markdown(data.markdown ?? "", 1, 1, getMarkdownTheme());
	});

	pi.registerTool({
		name: "select_github_issue",
		label: "Select GitHub issue",
		description:
			"Show an interactive selector with GitHub issues from a repository and return the selected issue's full details. Use when the user wants to choose, inspect, specify, or work on an issue but has not provided an issue number.",
		promptSnippet: "Interactively select a GitHub issue and return its details",
		promptGuidelines: [
			"Use select_github_issue when the user asks to choose an issue without naming a specific issue number.",
		],
		parameters,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.hasUI) {
				throw new Error("select_github_issue requires interactive or RPC mode");
			}

			const state = params.state ?? "open";
			const limit = params.limit ?? 30;
			const listArgs = [
				"issue",
				"list",
				"--state",
				state,
				"--limit",
				String(limit),
				"--json",
				"number,title,url,state,updatedAt,author,labels",
			];

			if (params.query?.trim()) listArgs.push("--search", params.query.trim());
			if (params.repo?.trim()) listArgs.push("--repo", params.repo.trim());

			const listed = await pi.exec("gh", listArgs, {
				cwd: ctx.cwd,
				signal,
				timeout: 30_000,
			});

			if (listed.code !== 0) {
				throw ghError(listed.stderr, "Could not list GitHub issues");
			}

			const issues = parseJson<IssueListItem[]>(listed.stdout, "gh issue list");
			if (issues.length === 0) {
				return {
					content: [{ type: "text", text: `No ${state} GitHub issues matched the requested filters.` }],
					details: { selected: null, state, query: params.query ?? null },
				};
			}

			const choices = issues.map(formatChoice);
			const selectedChoice = await ctx.ui.select(
				`Select a GitHub issue (${issues.length} ${state})`,
				choices,
			);

			if (selectedChoice === undefined) {
				return {
					content: [{ type: "text", text: "The user cancelled issue selection." }],
					details: { selected: null, cancelled: true },
				};
			}

			const selectedIndex = choices.indexOf(selectedChoice);
			const selected = issues[selectedIndex];
			if (!selected) throw new Error("Could not resolve the selected GitHub issue");

			const viewArgs = [
				"issue",
				"view",
				String(selected.number),
				"--json",
				"number,title,body,url,state,updatedAt,author,labels,assignees,milestone,comments",
			];
			if (params.repo?.trim()) viewArgs.push("--repo", params.repo.trim());

			const viewed = await pi.exec("gh", viewArgs, {
				cwd: ctx.cwd,
				signal,
				timeout: 30_000,
			});

			if (viewed.code !== 0) {
				throw ghError(viewed.stderr, `Could not read GitHub issue #${selected.number}`);
			}

			const issue = parseJson<IssueDetails>(viewed.stdout, "gh issue view");
			const inspectChoice = "Inspeccionar sin analizar dependencias";
			const analyzeChoice = "Analizar dependencias potenciales (usa el modelo)";
			const grillChoice = `Grillar el issue #${issue.number} (usa el modelo)`;
			const cancelChoice = "Cancelar";
			const selectedAction = await ctx.ui.select(
				`¿Qué hacemos con el issue #${issue.number}?`,
				[inspectChoice, analyzeChoice, grillChoice, cancelChoice],
			);

			let relatedAnalysis: RelatedIssueAnalysis | undefined;
			let relatedText: string | undefined;
			let nextAction: "inspect" | "analyze" | "grill-prerequisite" | "grill" | "cancelled" = "cancelled";
			let grillTarget: number | null = null;
			const availableCommands = new Set(pi.getCommands().map((command) => command.name));
			const grillCommand = availableCommands.has("skill:grill") ? "skill:grill" : undefined;
			const grillPrompt = (instruction: string) => grillCommand ? `/${grillCommand} ${instruction}` : instruction;
			const repoHint = params.repo?.trim() ? ` en el repo ${params.repo.trim()}` : "";

			if (selectedAction === inspectChoice) {
				nextAction = "inspect";
			} else if (selectedAction === grillChoice) {
				nextAction = "grill";
				grillTarget = issue.number;
				const instruction = [
					`Grillá el issue #${issue.number} (${issue.title})${repoHint}.`,
					"Antes de preguntar, usá los detalles completos del issue recién seleccionado y explorá el codebase.",
					"No analices dependencias con otro modelo salvo que sea necesario para desambiguar el alcance.",
					"No implementes hasta que confirme el entendimiento compartido.",
				].join(" ");
				pi.sendUserMessage(grillPrompt(instruction), { deliverAs: "steer" });
			} else if (selectedAction === analyzeChoice) {
				nextAction = "analyze";
				onUpdate?.({
					content: [{ type: "text", text: `Analizando dependencias potenciales para el issue #${issue.number}...` }],
					details: { selected: issue, phase: "related-issues" },
				});

				const candidateArgs = [
					"issue",
					"list",
					"--state",
					"all",
					"--limit",
					"100",
					"--json",
					"number,title,body,url,state,updatedAt,author,labels",
				];
				if (params.repo?.trim()) candidateArgs.push("--repo", params.repo.trim());

				const candidateResult = await pi.exec("gh", candidateArgs, {
					cwd: ctx.cwd,
					signal,
					timeout: 30_000,
				});
				if (candidateResult.code !== 0) {
					const error = candidateResult.stderr.trim() || "Could not list candidate issues";
					relatedAnalysis = {
						summary: `No se pudo buscar issues relacionados: ${error}`,
						related: [],
						analysisError: error,
					};
				} else {
					const candidates = parseJson<IssueCandidate[]>(candidateResult.stdout, "related gh issue list")
						.filter((candidate) => candidate.number !== issue.number);
					try {
						relatedAnalysis = await analyzeRelatedIssues(ctx, issue, candidates, signal);
					} catch (error) {
						if (signal.aborted) throw error;
						const message = error instanceof Error ? error.message : String(error);
						relatedAnalysis = {
							summary: `No se pudo completar el análisis de relaciones: ${message}`,
							related: [],
							analysisError: message,
						};
					}
				}

				relatedText = formatRelatedAnalysis(issue, relatedAnalysis);
				pi.appendEntry("github-issue-analysis", {
					issueNumber: issue.number,
					markdown: relatedText,
				});

				const prerequisites = relatedAnalysis.related.filter((finding) => finding.mustBeDoneFirst);
				const prerequisiteChoices = new Map<string, RelatedIssueFinding>();
				for (const [index, finding] of prerequisites.entries()) {
					const recommendation = index === 0 ? " (Recomendado)" : "";
					prerequisiteChoices.set(
						`Grillar primero #${finding.number}: ${finding.title}${recommendation}`,
						finding,
					);
				}

				const grillSelectedChoice = prerequisites.length > 0
					? `Grillar igualmente el issue #${issue.number}`
					: `Grillar el issue #${issue.number}`;
				const finishChoice = "Finalizar sin grillar";
				const nextChoice = await ctx.ui.select(
					`Análisis completo para #${issue.number}`,
					[...prerequisiteChoices.keys(), grillSelectedChoice, finishChoice],
				);
				const prerequisite = nextChoice ? prerequisiteChoices.get(nextChoice) : undefined;

				if (prerequisite) {
					nextAction = "grill-prerequisite";
					grillTarget = prerequisite.number;
					const instruction = [
						`Grillá primero el issue #${prerequisite.number} (${prerequisite.title})${repoHint}.`,
						`Fue detectado como prerrequisito del issue #${issue.number} (${issue.title}).`,
						`Evidencia del análisis: ${prerequisite.reason}`,
						"Antes de preguntar, obtené y leé sus detalles completos con gh issue view.",
						"No implementes hasta que confirme el entendimiento compartido.",
					].join(" ");
					pi.sendUserMessage(grillPrompt(instruction), { deliverAs: "steer" });
				} else if (nextChoice === grillSelectedChoice) {
					nextAction = "grill";
					grillTarget = issue.number;
					const instruction = `Grillá el issue #${issue.number} (${issue.title})${repoHint}. Usá sus detalles y el análisis de dependencias recién completado. No implementes hasta que confirme el entendimiento compartido.`;
					pi.sendUserMessage(grillPrompt(instruction), { deliverAs: "steer" });
				}
			}

			const sections = [formatIssue(issue)];
			if (relatedText) sections.push(relatedText);
			sections.push(`Next action selected: ${nextAction}${grillTarget ? ` (#${grillTarget})` : ""}.`);
			return {
				content: [{ type: "text", text: sections.join("\n\n") }],
				details: { selected: issue, relatedAnalysis, cancelled: nextAction === "cancelled", nextAction, grillTarget },
			};
		},
	});
}
