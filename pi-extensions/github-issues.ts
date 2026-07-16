import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	BorderedLoader,
	DynamicBorder,
	getMarkdownTheme,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Markdown,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
} from "@earendil-works/pi-tui";

import {
	analyzeRelatedIssues,
	formatRelatedAnalysis,
	type IssueCandidate,
	type IssueDetails,
	type IssueListItem,
	type RelatedIssueAnalysis,
	type RelatedIssueFinding,
} from "./github-issue-selector";

type IssueListAction =
	| { kind: "select"; number: number }
	| { kind: "create" }
	| { kind: "exit" };

type IssueAction = "analyze" | "grill" | "close" | "delete" | "list" | "exit";

type AnalysisOutcome =
	| { analysis: RelatedIssueAnalysis }
	| { error: string };

type GrillStatus = "active" | "paused" | "finalized";

interface StoredGrill {
	id: string;
	topic: string;
	projectPath: string;
	status: GrillStatus;
	updatedAt: string;
	sourceIssue?: { number?: number; repository?: string };
}

interface AssociatedGrill {
	id: string;
	status: GrillStatus;
	updatedAt: string;
}

interface AssociatedSpec {
	path: string;
	state: string;
	updatedAt?: string;
	location: "local" | "issue";
}

interface IssueWork {
	grills: AssociatedGrill[];
	specs: AssociatedSpec[];
}

const GRILL_STORE_DIR = join(homedir(), ".pi", "agent", "grill-sessions");

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseJson<T>(output: string, context: string): T {
	try {
		return JSON.parse(output) as T;
	} catch {
		throw new Error(`${context} devolvió JSON inválido`);
	}
}

function formatIssueChoice(issue: Pick<IssueListItem, "number" | "title" | "labels">): string {
	const labels = issue.labels.map((label) => label.name).filter(Boolean);
	return `#${issue.number} ${issue.title}${labels.length > 0 ? `  [${labels.join(", ")}]` : ""}`;
}

function localizedGrillStatus(status: GrillStatus): string {
	if (status === "active") return "activo";
	if (status === "paused") return "pausado";
	return "finalizado";
}

function workSummary(work: IssueWork | undefined): string {
	if (!work || (work.grills.length === 0 && work.specs.length === 0)) {
		return "sin grill ni spec asociados";
	}

	const parts: string[] = [];
	if (work.grills.length > 0) {
		const present = new Set(work.grills.map((grill) => grill.status));
		const statuses = (["active", "paused", "finalized"] as const)
			.filter((status) => present.has(status))
			.map(localizedGrillStatus);
		parts.push(`${work.grills.length === 1 ? "grill" : `grills (${work.grills.length})`}: ${statuses.join(" + ")}`);
	}
	if (work.specs.length > 0) {
		const states = [...new Set(work.specs.map((spec) => spec.state))];
		parts.push(`${work.specs.length === 1 ? "spec" : `specs (${work.specs.length})`}: ${states.join(" + ")}`);
	}
	return parts.join(" · ");
}

function specState(markdown: string): string {
	return markdown.match(/Estado:\s*([^>\n.]+?)(?:\s*-->|[.\n])/i)?.[1]?.trim() || "sin estado";
}

function issueNumberFromSpec(markdown: string, path: string): number | undefined {
	const header = markdown.slice(0, 8_192);
	const tracking = header.match(/SDD-Tracking:[^>]*\bissue\s*=\s*(?:[^;\s]*#)?(\d+)/i)?.[1];
	const source = header.match(/Fuente:[^>\n]*\bissue\s*#(\d+)/i)?.[1];
	const filename = basename(path).match(/^issue-(\d+)(?:-|\.md$)/i)?.[1];
	const number = Number(tracking ?? source ?? filename);
	return Number.isInteger(number) && number > 0 ? number : undefined;
}

function issueNumberFromGrill(snapshot: StoredGrill): number | undefined {
	const explicit = snapshot.sourceIssue?.number;
	if (Number.isInteger(explicit) && explicit! > 0) return explicit;
	const topic = snapshot.topic.match(/\bissue\s*#(\d+)/i)?.[1];
	const id = snapshot.id.match(/^issue-(\d+)(?:-|$)/i)?.[1];
	const number = Number(topic ?? id);
	return Number.isInteger(number) && number > 0 ? number : undefined;
}

function isStoredGrill(value: unknown): value is StoredGrill {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<StoredGrill>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.topic === "string" &&
		typeof candidate.projectPath === "string" &&
		(candidate.status === "active" || candidate.status === "paused" || candidate.status === "finalized") &&
		typeof candidate.updatedAt === "string"
	);
}

async function collectWorkflowAssociations(
	projectPath: string,
	issues: IssueListItem[],
): Promise<Map<number, IssueWork>> {
	const byIssue = new Map<number, IssueWork>();
	const workFor = (number: number): IssueWork => {
		let work = byIssue.get(number);
		if (!work) {
			work = { grills: [], specs: [] };
			byIssue.set(number, work);
		}
		return work;
	};

	let grillFiles: string[] = [];
	try {
		grillFiles = (await readdir(GRILL_STORE_DIR)).filter((file) => file.endsWith(".json"));
	} catch {
		// No persistent grill store yet.
	}
	await Promise.all(grillFiles.map(async (file) => {
		try {
			const parsed: unknown = JSON.parse(await readFile(join(GRILL_STORE_DIR, file), "utf8"));
			if (!isStoredGrill(parsed) || resolve(parsed.projectPath) !== resolve(projectPath)) return;
			const number = issueNumberFromGrill(parsed);
			if (!number) return;
			workFor(number).grills.push({ id: parsed.id, status: parsed.status, updatedAt: parsed.updatedAt });
		} catch {
			// Ignore corrupt snapshots here; /grills reports them when accessed directly.
		}
	}));

	const specsDirectory = join(projectPath, ".sdd", "specs");
	let specFiles: string[] = [];
	try {
		specFiles = (await readdir(specsDirectory)).filter((file) => file.endsWith(".md"));
	} catch {
		// The project has no local specs yet.
	}
	await Promise.all(specFiles.map(async (file) => {
		const path = join(specsDirectory, file);
		try {
			const [markdown, fileStat] = await Promise.all([readFile(path, "utf8"), stat(path)]);
			const number = issueNumberFromSpec(markdown, path);
			if (!number) return;
			workFor(number).specs.push({
				path,
				state: specState(markdown),
				updatedAt: fileStat.mtime.toISOString(),
				location: "local",
			});
		} catch {
			// Ignore files that disappear while the selector is loading.
		}
	}));

	for (const issue of issues) {
		const body = issue.body?.trim() ?? "";
		if (!/^#\s+Spec\b/im.test(body) && !/SDD-Tracking:/i.test(body)) continue;
		workFor(issue.number).specs.push({
			path: issue.url,
			state: specState(body),
			updatedAt: issue.updatedAt,
			location: "issue",
		});
	}

	for (const work of byIssue.values()) {
		work.grills.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		work.specs.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
	}
	return byIssue;
}

function formatIssueMarkdown(issue: IssueDetails, work?: IssueWork): string {
	const labels = issue.labels.map((label) => label.name).filter(Boolean).join(", ") || "ninguna";
	const assignees = issue.assignees.map((assignee) => assignee.login).filter(Boolean).join(", ") || "ninguno";
	const author = issue.author?.login || "desconocido";
	const milestone = issue.milestone?.title || "ninguno";
	const body = issue.body.trim() || "_(sin descripción)_";
	const comments = (issue.comments ?? []).slice(-5).map((comment) => {
		const login = comment.author?.login ?? "desconocido";
		return `### @${login}\n\n${comment.body.trim() || "_(comentario vacío)_"}`;
	});
	const markdown = [
		`# #${issue.number} — ${issue.title}`,
		"",
		`- **Estado:** ${issue.state}`,
		`- **Autor:** @${author}`,
		`- **Labels:** ${labels}`,
		`- **Assignees:** ${assignees}`,
		`- **Milestone:** ${milestone}`,
		`- **URL:** ${issue.url}`,
		"",
		"## Trabajo asociado",
		"",
		...(work && (work.grills.length > 0 || work.specs.length > 0)
			? [
				...work.grills.map((grill) => `- **Grill ${localizedGrillStatus(grill.status)}:** \`${grill.id}\``),
				...work.specs.map((spec) => spec.location === "issue"
					? `- **Spec ${spec.state}:** body de este issue`
					: `- **Spec ${spec.state}:** \`${spec.path}\``),
			]
			: ["- Sin grill ni spec asociados."]),
		"",
		"## Descripción",
		"",
		body,
		...(comments.length > 0 ? ["", "## Últimos comentarios", "", ...comments] : []),
	].join("\n");
	const truncated = truncateHead(markdown, { maxBytes: 45 * 1024, maxLines: 1_900 });
	return truncated.truncated
		? `${truncated.content}\n\n_Contenido truncado; abrí ${issue.url} para verlo completo._`
		: truncated.content;
}

export default function githubIssuesExtension(pi: ExtensionAPI): void {
	pi.registerEntryRenderer("github-issue-local-view", (entry) => {
		const data = entry.data as { markdown?: string };
		return new Markdown(data.markdown ?? "", 1, 1, getMarkdownTheme());
	});
	pi.registerEntryRenderer("github-issue-local-analysis", (entry) => {
		const data = entry.data as { markdown?: string };
		return new Markdown(data.markdown ?? "", 1, 1, getMarkdownTheme());
	});

	async function runGh(
		args: string[],
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<string> {
		const result = await pi.exec("gh", args, {
			cwd: ctx.cwd,
			signal,
			timeout: 30_000,
		});

		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || `gh terminó con código ${result.code}`);
		}

		return result.stdout.trim();
	}

	async function withLoader<T>(
		ctx: ExtensionContext,
		message: string,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		type Outcome = { value: T } | { error: unknown };
		const outcome = await ctx.ui.custom<Outcome>((tui, theme, _keybindings, done) => {
			const loader = new BorderedLoader(tui, theme, message, { cancellable: false });
			operation(loader.signal)
				.then((value) => done({ value }))
				.catch((error) => done({ error }));
			return loader;
		});

		if ("error" in outcome) throw outcome.error;
		return outcome.value;
	}

	async function showIssueList(
		ctx: ExtensionContext,
		issues: IssueListItem[],
		workByIssue: Map<number, IssueWork>,
	): Promise<IssueListAction> {
		return ctx.ui.custom<IssueListAction>((tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			container.addChild(
				new Text(theme.fg("accent", theme.bold(`GitHub Issues abiertos (${issues.length})`)), 1, 0),
			);

			const items: SelectItem[] = issues.map((issue) => ({
				value: String(issue.number),
				label: formatIssueChoice(issue),
				description: workSummary(workByIssue.get(issue.number)),
			}));
			const selectList = new SelectList(items, Math.min(Math.max(items.length, 1), 12), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.onSelect = (item) => done({ kind: "select", number: Number(item.value) });
			selectList.onCancel = () => done({ kind: "exit" });
			if (items.length > 0) {
				container.addChild(selectList);
			} else {
				container.addChild(new Text(theme.fg("muted", "No hay issues abiertos."), 1, 1));
			}
			container.addChild(
				new Text(theme.fg("dim", "↑↓ navegar • enter elegir • c crear issue • esc salir"), 1, 0),
			);
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (matchesKey(data, "c")) {
						done({ kind: "create" });
						return;
					}
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});
	}

	async function showIssueActions(
		ctx: ExtensionContext,
		issue: Pick<IssueDetails, "number">,
		hasAnalysis: boolean,
	): Promise<IssueAction | null> {
		const items: SelectItem[] = [
			{
				value: "analyze",
				label: `${hasAnalysis ? "Reanalizar" : "Analizar"} dependencias potenciales (Recomendado)`,
				description: "Compara con otros issues, detecta prerrequisitos y recomienda el orden de trabajo; usa el modelo",
			},
			{
				value: "grill",
				label: `Grillar #${issue.number}`,
				description: "Inicia una entrevista para aclarar alcance, decisiones y casos borde antes de escribir la spec; usa el modelo",
			},
			{
				value: "close",
				label: `Cerrar #${issue.number}`,
				description: "Marca el issue como completado en GitHub; se puede volver a abrir",
			},
			{
				value: "delete",
				label: `Eliminar #${issue.number} permanentemente`,
				description: "Borra el issue de GitHub de forma irreversible; pide confirmación",
			},
			{
				value: "list",
				label: "← Volver a la lista de issues",
				description: "Regresa al selector sin modificar este issue",
			},
			{
				value: "exit",
				label: "Salir de /issues",
				description: "Cierra el administrador de issues",
			},
		];

		return ctx.ui.custom<IssueAction | null>((tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			container.addChild(
				new Text(theme.fg("accent", theme.bold(`Issue #${issue.number} · elegí una acción`)), 1, 0),
			);

			const selectList = new SelectList(
				items,
				items.length,
				{
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				},
				{ minPrimaryColumnWidth: 48, maxPrimaryColumnWidth: 48 },
			);
			selectList.onSelect = (item) => done(item.value as IssueAction);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "↑↓ navegar • enter elegir • esc cancelar"), 1, 0));
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});
	}

	async function listOpenIssues(
		ctx: ExtensionContext,
	): Promise<{ issues: IssueListItem[]; workByIssue: Map<number, IssueWork> }> {
		return withLoader(ctx, "Consultando issues y trabajo asociado…", async (signal) => {
			const output = await runGh(
				["issue", "list", "--state", "open", "--limit", "100", "--json", "number,title,body,url,state,updatedAt,author,labels"],
				ctx,
				signal,
			);
			const issues = parseJson<IssueListItem[]>(output, "gh issue list");
			const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
				cwd: ctx.cwd,
				signal,
				timeout: 5_000,
			});
			const projectPath = rootResult.code === 0 && rootResult.stdout.trim()
				? resolve(rootResult.stdout.trim())
				: resolve(ctx.cwd);
			return { issues, workByIssue: await collectWorkflowAssociations(projectPath, issues) };
		});
	}

	async function loadIssue(number: number, ctx: ExtensionContext): Promise<IssueDetails> {
		return withLoader(ctx, `Consultando issue #${number} en GitHub…`, async (signal) => {
			const output = await runGh(
				[
					"issue",
					"view",
					String(number),
					"--json",
					"number,title,body,url,state,updatedAt,author,labels,assignees,milestone,comments",
				],
				ctx,
				signal,
			);
			return parseJson<IssueDetails>(output, `gh issue view #${number}`);
		});
	}

	async function analyzeDependencies(
		ctx: ExtensionContext,
		issue: IssueDetails,
		getCandidates: (signal: AbortSignal) => Promise<IssueCandidate[]>,
	): Promise<RelatedIssueAnalysis | undefined> {
		if (!ctx.model) {
			ctx.ui.notify("No hay un modelo activo para analizar dependencias", "error");
			return undefined;
		}

		const outcome = await ctx.ui.custom<AnalysisOutcome | null>((tui, theme, _keybindings, done) => {
			const loader = new BorderedLoader(
				tui,
				theme,
				`Analizando dependencias de #${issue.number} con ${ctx.model!.id}…`,
			);
			loader.onAbort = () => done(null);

			getCandidates(loader.signal)
				.then((candidates) => analyzeRelatedIssues(ctx, issue, candidates, loader.signal))
				.then((analysis) => done({ analysis }))
				.catch((error) => {
					if (!loader.signal.aborted) done({ error: errorMessage(error) });
				});
			return loader;
		});

		if (outcome === null) {
			ctx.ui.notify("Análisis cancelado", "info");
			return undefined;
		}
		if ("error" in outcome) {
			ctx.ui.notify(`No se pudo analizar: ${outcome.error}`, "error");
			return undefined;
		}
		return outcome.analysis;
	}

	function queueGrill(
		issue: Pick<IssueDetails, "number" | "title">,
		context?: { selectedIssue: IssueDetails; prerequisite: RelatedIssueFinding },
	): void {
		const availableCommands = new Set(pi.getCommands().map((command) => command.name));
		const grillCommand = availableCommands.has("skill:grill") ? "skill:grill" : undefined;
		const instruction = context
			? [
				`Grillá primero el issue #${issue.number} (${issue.title}).`,
				`Fue detectado como prerrequisito del issue #${context.selectedIssue.number} (${context.selectedIssue.title}).`,
				`Evidencia: ${context.prerequisite.reason}`,
				"Antes de preguntar, obtené sus detalles completos con gh issue view y explorá el codebase.",
				"No implementes hasta que confirme el entendimiento compartido.",
			].join(" ")
			: [
				`Grillá el issue #${issue.number} (${issue.title}) del repositorio actual.`,
				"Antes de preguntar, obtené sus detalles completos con gh issue view y explorá el codebase.",
				"No implementes hasta que confirme el entendimiento compartido.",
			].join(" ");
		pi.sendUserMessage(grillCommand ? `/${grillCommand} ${instruction}` : instruction);
	}

	async function viewIssues(ctx: ExtensionContext): Promise<void> {
		let candidateCache: IssueCandidate[] | undefined;

		while (true) {
			const { issues, workByIssue } = await listOpenIssues(ctx);
			const listAction = await showIssueList(ctx, issues, workByIssue);
			if (listAction.kind === "exit") return;
			if (listAction.kind === "create") {
				if (await createIssue(ctx)) candidateCache = undefined;
				continue;
			}

			const selected = issues.find((issue) => issue.number === listAction.number);
			if (!selected) throw new Error("No se pudo resolver el issue seleccionado");
			const issue = await loadIssue(selected.number, ctx);
			pi.appendEntry("github-issue-local-view", {
				issueNumber: issue.number,
				markdown: formatIssueMarkdown(issue, workByIssue.get(issue.number)),
			});

			let analysis: RelatedIssueAnalysis | undefined;
			while (true) {
				const action = await showIssueActions(ctx, issue, analysis !== undefined);

				if (!action || action === "exit") return;
				if (action === "list") break;
				if (action === "close") {
					if (await closeIssue(issue, ctx)) {
						candidateCache = undefined;
						break;
					}
					continue;
				}
				if (action === "delete") {
					if (await deleteIssue(issue, ctx)) {
						candidateCache = undefined;
						break;
					}
					continue;
				}
				if (action === "grill") {
					queueGrill(issue);
					return;
				}
				if (action !== "analyze") continue;

				analysis = await analyzeDependencies(ctx, issue, async (signal) => {
					if (!candidateCache) {
						const output = await runGh(
							[
								"issue",
								"list",
								"--state",
								"all",
								"--limit",
								"100",
								"--json",
								"number,title,body,url,state,updatedAt,author,labels",
							],
							ctx,
							signal,
						);
						candidateCache = parseJson<IssueCandidate[]>(output, "gh issue list para dependencias");
					}
					return candidateCache.filter((candidate) => candidate.number !== issue.number);
				});
				if (!analysis) continue;

				const analysisMarkdown = formatRelatedAnalysis(issue, analysis);
				pi.appendEntry("github-issue-local-analysis", {
					issueNumber: issue.number,
					markdown: analysisMarkdown,
				});

				const prerequisites = analysis.related.filter((finding) => finding.mustBeDoneFirst);
				const prerequisiteChoices = new Map<string, RelatedIssueFinding>();
				for (const [index, prerequisite] of prerequisites.entries()) {
					prerequisiteChoices.set(
						`Grillar primero #${prerequisite.number}: ${prerequisite.title}${index === 0 ? " (Recomendado)" : ""}`,
						prerequisite,
					);
				}
				const grillSelectedChoice = `Grillar #${issue.number}`;
				const continueChoice = "Seguir inspeccionando sin grillar";
				const next = await ctx.ui.select(
					`Dependencias analizadas para #${issue.number}`,
					[...prerequisiteChoices.keys(), grillSelectedChoice, continueChoice],
				);
				const prerequisite = next ? prerequisiteChoices.get(next) : undefined;
				if (prerequisite) {
					queueGrill(prerequisite, { selectedIssue: issue, prerequisite });
					return;
				}
				if (next === grillSelectedChoice) {
					queueGrill(issue);
					return;
				}
			}
		}
	}

	async function createIssue(ctx: ExtensionContext): Promise<boolean> {
		const rawTitle = await ctx.ui.input("Crear issue", "Título");
		const title = rawTitle?.trim();
		if (!title) return false;

		const body = await ctx.ui.editor("Descripción del issue", "");
		if (body === undefined) return false;

		const preview = body.trim()
			? `${body.trim().slice(0, 300)}${body.trim().length > 300 ? "…" : ""}`
			: "(sin descripción)";
		const confirmed = await ctx.ui.confirm("Crear issue", `${title}\n\n${preview}`);
		if (!confirmed) return false;

		const url = await withLoader(ctx, "Creando issue en GitHub…", (signal) =>
			runGh(["issue", "create", "--title", title, "--body", body], ctx, signal));
		ctx.ui.notify(url ? `Issue creado: ${url}` : "Issue creado", "info");
		return true;
	}

	async function closeIssue(
		issue: Pick<IssueDetails, "number" | "title">,
		ctx: ExtensionContext,
	): Promise<boolean> {
		const confirmed = await ctx.ui.confirm(
			`Cerrar issue #${issue.number}`,
			`${issue.title}\n\nEsta acción marcará el issue como completado.`,
		);
		if (!confirmed) return false;

		await withLoader(ctx, `Cerrando issue #${issue.number} en GitHub…`, (signal) =>
			runGh(["issue", "close", String(issue.number), "--reason", "completed"], ctx, signal));
		ctx.ui.notify(`Issue #${issue.number} cerrado`, "info");
		return true;
	}

	async function deleteIssue(
		issue: Pick<IssueDetails, "number" | "title">,
		ctx: ExtensionContext,
	): Promise<boolean> {
		const confirmed = await ctx.ui.confirm(
			`Eliminar issue #${issue.number}`,
			`${issue.title}\n\nEsta acción es permanente y el issue no se podrá recuperar.`,
		);
		if (!confirmed) return false;

		await withLoader(ctx, `Eliminando issue #${issue.number} de GitHub…`, (signal) =>
			runGh(["issue", "delete", String(issue.number), "--yes"], ctx, signal));
		ctx.ui.notify(`Issue #${issue.number} eliminado`, "info");
		return true;
	}

	pi.registerCommand("issues", {
		description: "Listar y administrar GitHub Issues; presioná c para crear uno",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("El administrador de issues requiere modo TUI", "error");
				return;
			}

			await ctx.waitForIdle();
			try {
				await viewIssues(ctx);
			} catch (error) {
				ctx.ui.notify(`GitHub Issues: ${errorMessage(error)}`, "error");
			}
		},
	});
}
