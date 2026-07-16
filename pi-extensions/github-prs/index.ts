import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";

type PrAction = "open-web" | "comments-fix" | "review" | "merge" | "close";
type MergeStrategy = "merge" | "squash" | "rebase";

interface PullRequestListItem {
	number: number;
	title: string;
	url: string;
	isDraft: boolean;
	headRefName: string;
	baseRefName: string;
	reviewDecision: string;
	updatedAt: string;
	author?: { login?: string } | null;
	statusCheckRollup?: Array<{
		__typename?: string;
		status?: string;
		conclusion?: string;
	}>;
}

interface ClosingIssueReference {
	number: number;
	url: string;
	repository: {
		name: string;
		owner: { login: string };
	};
}

interface PullRequestMergeDetails {
	number: number;
	title: string;
	state: string;
	baseRefName: string;
	headRefOid: string;
	mergeable: string;
	mergeStateStatus: string;
	mergedAt?: string | null;
	autoMergeRequest?: unknown | null;
	closingIssuesReferences: ClosingIssueReference[];
}

interface RelatedIssue {
	number: number;
	title: string;
	url: string;
	state: string;
	repo: string;
}

const ACTION_ITEMS: SelectItem[] = [
	{
		value: "open-web",
		label: "Abrir en la web",
		description: "Abrir el PR seleccionado en el navegador",
	},
	{
		value: "comments-fix",
		label: "Ver y corregir comentarios",
		description: "Atender feedback; grillar sólo si hay una ambigüedad real",
	},
	{
		value: "review",
		label: "Revisar con code-review",
		description: "Usa /skill:code-review y al final permite publicar los comments",
	},
	{
		value: "merge",
		label: "Mergear PR",
		description: "Mergear y cerrar los issues asociados que sigan abiertos",
	},
	{
		value: "close",
		label: "Cerrar PR",
		description: "Cerrar el pull request sin mergearlo",
	},
];

const MERGE_STRATEGY_ITEMS: SelectItem[] = [
	{
		value: "squash",
		label: "Squash and merge",
		description: "Combinar todos los commits del PR en uno",
	},
	{
		value: "merge",
		label: "Create a merge commit",
		description: "Conservar los commits y crear un commit de merge",
	},
	{
		value: "rebase",
		label: "Rebase and merge",
		description: "Reaplicar los commits sin crear un commit de merge",
	},
];

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

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("es-AR", {
		day: "2-digit",
		month: "2-digit",
		year: "2-digit",
	}).format(date);
}

function checksSummary(pr: PullRequestListItem): string {
	const checks = pr.statusCheckRollup ?? [];
	if (checks.length === 0) return "sin checks";

	const pending = checks.filter((check) => {
		const status = check.status?.toUpperCase();
		return status === "IN_PROGRESS" || status === "QUEUED" || status === "PENDING" || status === "WAITING";
	}).length;
	const failed = checks.filter((check) => {
		const conclusion = check.conclusion?.toUpperCase();
		return conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "CANCELLED" || conclusion === "ACTION_REQUIRED";
	}).length;

	if (failed > 0) return `${failed} check${failed === 1 ? "" : "s"} fallando`;
	if (pending > 0) return `${pending} check${pending === 1 ? "" : "s"} pendiente${pending === 1 ? "" : "s"}`;
	return "checks OK";
}

function reviewSummary(pr: PullRequestListItem): string {
	if (pr.isDraft) return "draft";
	const decision = pr.reviewDecision?.toUpperCase();
	if (decision === "APPROVED") return "aprobado";
	if (decision === "CHANGES_REQUESTED") return "cambios pedidos";
	if (decision === "REVIEW_REQUIRED") return "review pendiente";
	return "sin decisión";
}

function prItems(prs: PullRequestListItem[]): SelectItem[] {
	return prs.map((pr) => ({
		value: String(pr.number),
		label: `#${pr.number} ${pr.title}`,
		description: [
			`@${pr.author?.login ?? "desconocido"}`,
			`${pr.headRefName} → ${pr.baseRefName}`,
			reviewSummary(pr),
			checksSummary(pr),
			formatDate(pr.updatedAt),
		].join(" · "),
	}));
}

export default function githubPrsExtension(pi: ExtensionAPI): void {
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

	async function selectItem<T extends string>(
		ctx: ExtensionContext,
		title: string,
		items: SelectItem[],
		help: string,
	): Promise<T | null> {
		return ctx.ui.custom<T | null>((tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

			const selectList = new SelectList(items, Math.min(items.length, 12), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			selectList.onSelect = (item) => done(item.value as T);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", help), 1, 0));
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

	async function listOpenPrs(ctx: ExtensionContext): Promise<PullRequestListItem[]> {
		return withLoader(ctx, "Consultando pull requests abiertos en GitHub…", async (signal) => {
			const output = await runGh(
				[
					"pr",
					"list",
					"--state",
					"open",
					"--limit",
					"100",
					"--json",
					"number,title,url,isDraft,headRefName,baseRefName,reviewDecision,updatedAt,author,statusCheckRollup",
				],
				ctx,
				signal,
			);
			return parseJson<PullRequestListItem[]>(output, "gh pr list");
		});
	}

	async function loadMergeDetails(
		number: number,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<PullRequestMergeDetails> {
		const output = await runGh(
			[
				"pr",
				"view",
				String(number),
				"--json",
				"number,title,state,baseRefName,headRefOid,mergeable,mergeStateStatus,mergedAt,autoMergeRequest,closingIssuesReferences",
			],
			ctx,
			signal,
		);
		return parseJson<PullRequestMergeDetails>(output, `gh pr view #${number}`);
	}

	async function loadRelatedIssues(
		references: ClosingIssueReference[],
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<RelatedIssue[]> {
		const unique = new Map<string, ClosingIssueReference>();
		for (const reference of references) {
			const repo = `${reference.repository.owner.login}/${reference.repository.name}`;
			unique.set(`${repo}#${reference.number}`, reference);
		}

		return Promise.all([...unique.values()].map(async (reference) => {
			const repo = `${reference.repository.owner.login}/${reference.repository.name}`;
			const output = await runGh(
				[
					"issue",
					"view",
					String(reference.number),
					"--repo",
					repo,
					"--json",
					"number,title,url,state",
				],
				ctx,
				signal,
			);
			const issue = parseJson<Omit<RelatedIssue, "repo">>(output, `gh issue view ${repo}#${reference.number}`);
			return { ...issue, repo };
		}));
	}

	function relatedIssueSummary(issues: RelatedIssue[]): string {
		if (issues.length === 0) return "No se encontraron issues asociados mediante referencias de cierre de GitHub.";
		return [
			`Issues asociados (${issues.length}):`,
			...issues.map((issue) => `• ${issue.repo}#${issue.number} — ${issue.title} [${issue.state.toLowerCase()}]`),
		].join("\n");
	}

	async function waitForAutomaticIssueClosure(
		issue: RelatedIssue,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<RelatedIssue> {
		let current = issue;
		for (let attempt = 0; attempt < 3 && current.state.toUpperCase() === "OPEN"; attempt += 1) {
			if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750));
			const output = await runGh(
				[
					"issue",
					"view",
					String(issue.number),
					"--repo",
					issue.repo,
					"--json",
					"number,title,url,state",
				],
				ctx,
				signal,
			);
			current = {
				...parseJson<Omit<RelatedIssue, "repo">>(output, `gh issue view ${issue.repo}#${issue.number}`),
				repo: issue.repo,
			};
		}
		return current;
	}

	async function closeIssuesStillOpen(
		issues: RelatedIssue[],
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<{ manuallyClosed: RelatedIssue[]; failures: Array<{ issue: RelatedIssue; error: string }> }> {
		const checked = await Promise.all(issues.map((issue) => waitForAutomaticIssueClosure(issue, ctx, signal)));
		const open = checked.filter((issue) => issue.state.toUpperCase() === "OPEN");
		const manuallyClosed: RelatedIssue[] = [];
		const failures: Array<{ issue: RelatedIssue; error: string }> = [];

		for (const issue of open) {
			try {
				await runGh(
					["issue", "close", String(issue.number), "--repo", issue.repo, "--reason", "completed"],
					ctx,
					signal,
				);
				manuallyClosed.push(issue);
			} catch (error) {
				failures.push({ issue, error: errorMessage(error) });
			}
		}
		return { manuallyClosed, failures };
	}

	async function mergePr(pr: PullRequestListItem, ctx: ExtensionContext): Promise<void> {
		const strategy = await selectItem<MergeStrategy>(
			ctx,
			`Cómo mergear PR #${pr.number}`,
			MERGE_STRATEGY_ITEMS,
			"↑↓ navegar • enter elegir • esc back",
		);
		if (strategy === null) return;

		const { beforeMerge, issues } = await withLoader(
			ctx,
			`Consultando PR #${pr.number} e issues asociados en GitHub…`,
			async (signal) => {
				const beforeMerge = await loadMergeDetails(pr.number, ctx, signal);
				const issues = await loadRelatedIssues(beforeMerge.closingIssuesReferences ?? [], ctx, signal);
				return { beforeMerge, issues };
			},
		);
		const statusWarning = beforeMerge.mergeable.toUpperCase() === "MERGEABLE"
			? ""
			: `\n\nEstado informado por GitHub: ${beforeMerge.mergeable} / ${beforeMerge.mergeStateStatus}.`;
		const confirmed = await ctx.ui.confirm(
			`Mergear PR #${pr.number}`,
			[
				`${pr.title}`,
				`Estrategia: ${strategy}`,
				`Destino: ${beforeMerge.baseRefName}`,
				"",
				relatedIssueSummary(issues),
				"",
				"Después del merge se cerrarán como completados los asociados que GitHub no haya cerrado automáticamente.",
			].join("\n") + statusWarning,
		);
		if (!confirmed) return;

		await withLoader(ctx, `Mergeando PR #${pr.number} en GitHub…`, (signal) => runGh(
			[
				"pr",
				"merge",
				String(pr.number),
				`--${strategy}`,
				"--match-head-commit",
				beforeMerge.headRefOid,
			],
			ctx,
			signal,
		));

		const afterMerge = await withLoader(
			ctx,
			`Verificando el estado del PR #${pr.number} en GitHub…`,
			(signal) => loadMergeDetails(pr.number, ctx, signal),
		);
		if (!afterMerge.mergedAt && afterMerge.state.toUpperCase() !== "MERGED") {
			if (afterMerge.autoMergeRequest || afterMerge.mergeStateStatus.toUpperCase() === "QUEUED") {
				ctx.ui.notify(
					`PR #${pr.number} quedó en auto-merge o en la merge queue; los issues no se cerrarán hasta que el merge ocurra`,
					"info",
				);
				return;
			}
			throw new Error(`PR #${pr.number} no figura mergeado después de ejecutar gh pr merge`);
		}

		const { manuallyClosed, failures } = await withLoader(
			ctx,
			"Verificando y cerrando issues asociados en GitHub…",
			(signal) => closeIssuesStillOpen(issues, ctx, signal),
		);
		if (failures.length > 0) {
			ctx.ui.notify(
				[
					`PR #${pr.number} mergeado, pero no se pudieron cerrar algunos issues:`,
					...failures.map(({ issue, error }) => `${issue.repo}#${issue.number}: ${error}`),
				].join("\n"),
				"warning",
			);
		} else if (issues.length === 0) {
			ctx.ui.notify(`PR #${pr.number} mergeado; no tenía issues asociados`, "info");
		} else if (manuallyClosed.length === 0) {
			ctx.ui.notify(`PR #${pr.number} mergeado; GitHub cerró sus ${issues.length} issue(s) asociado(s)`, "info");
		} else {
			ctx.ui.notify(
				`PR #${pr.number} mergeado; se cerraron ${manuallyClosed.map((issue) => `${issue.repo}#${issue.number}`).join(", ")}`,
				"info",
			);
		}
	}

	function queueCommentFix(pr: PullRequestListItem): void {
		const availableCommands = new Set(pi.getCommands().map((command) => command.name));
		const grillSkill = availableCommands.has("skill:grill") ? "`grill`" : "el workflow de grill disponible";
		pi.sendUserMessage([
			`Atendé los comentarios del PR #${pr.number} (${pr.title}) del repositorio actual: ${pr.url}`,
			"Obtené con GitHub CLI la conversación completa, reviews e inline review threads, incluyendo los no resueltos; no te limites a `gh pr view --comments`.",
			"Revisá primero el estado del worktree y ubicá la rama correcta del PR sin pisar cambios locales.",
			"Clasificá el feedback y corregí todo comentario accionable con cambios acotados, tests pertinentes y verificación. Después resumí qué atendiste y qué quedó pendiente.",
			`Evaluá únicamente si algún comentario exige una decisión de producto, alcance o diseño que no pueda resolverse desde el código o el contexto del PR. Sólo si existe esa ambigüedad real, usá el skill ${grillSkill} antes de editar ese punto; si no, no grilles ni abras una entrevista.`,
		].join("\n\n"));
	}

	function queueReview(pr: PullRequestListItem): boolean {
		const reviewCommand = pi.getCommands().find((command) => command.name === "skill:code-review");
		if (!reviewCommand) return false;
		pi.sendUserMessage(`/skill:code-review ${pr.url}`);
		return true;
	}

	pi.registerCommand("prs", {
		description: "Ver y administrar pull requests abiertos del repositorio actual",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("El selector de PRs requiere modo TUI", "error");
				return;
			}

			await ctx.waitForIdle();
			try {
				let prs = await listOpenPrs(ctx);
				if (prs.length === 0) {
					ctx.ui.notify("No hay pull requests abiertos", "info");
					return;
				}

				while (true) {
					const selectedNumber = await selectItem<string>(
						ctx,
						`Pull requests abiertos (${prs.length})`,
						prItems(prs),
						"↑↓ navegar • enter elegir • esc salir",
					);
					if (selectedNumber === null) return;

					const pr = prs.find((candidate) => candidate.number === Number(selectedNumber));
					if (!pr) throw new Error("No se pudo resolver el PR seleccionado");

					while (true) {
						const action = await selectItem<PrAction>(
							ctx,
							`PR #${pr.number} · ${pr.title}`,
							ACTION_ITEMS,
							"↑↓ navegar • enter elegir • esc back",
						);
						if (action === null) break;

						if (action === "open-web") {
							await withLoader(ctx, `Abriendo PR #${pr.number} en GitHub…`, (signal) =>
								runGh(["pr", "view", String(pr.number), "--web"], ctx, signal));
							ctx.ui.notify(`PR #${pr.number} abierto en el navegador`, "info");
							continue;
						}

						if (action === "comments-fix") {
							queueCommentFix(pr);
							return;
						}

						if (action === "review") {
							if (queueReview(pr)) return;
							ctx.ui.notify("Todavía no está instalado /skill:code-review", "warning");
							continue;
						}

						if (action === "merge") {
							await mergePr(pr, ctx);
							prs = await listOpenPrs(ctx);
							if (prs.length === 0) {
								ctx.ui.notify("No quedan pull requests abiertos", "info");
								return;
							}
							if (!prs.some((candidate) => candidate.number === pr.number)) break;
							continue;
						}

						const confirmed = await ctx.ui.confirm(
							`Cerrar PR #${pr.number}`,
							`${pr.title}\n\nEl PR se cerrará sin mergearlo.`,
						);
						if (!confirmed) continue;

						await withLoader(ctx, `Cerrando PR #${pr.number} en GitHub…`, (signal) =>
							runGh(["pr", "close", String(pr.number)], ctx, signal));
						ctx.ui.notify(`PR #${pr.number} cerrado`, "info");
						prs = await listOpenPrs(ctx);
						if (prs.length === 0) {
							ctx.ui.notify("No quedan pull requests abiertos", "info");
							return;
						}
						break;
					}
				}
			} catch (error) {
				ctx.ui.notify(`PRs: ${errorMessage(error)}`, "error");
			}
		},
	});
}
