import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

import type { IssueListItem } from "./github-issue-selector";
import { selectManyMenu, selectMenu, type MenuItem } from "./lib/menu";

type IssueListAction =
	| { kind: "select"; numbers: number[] }
	| { kind: "create" }
	| { kind: "exit" };

type SelectionAction = "analyze" | "close" | "delete" | "back";
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

interface BulkMutationResult {
	number: number;
	title: string;
	success: boolean;
	error?: string;
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

function formatIssueChoice(issue: Pick<IssueListItem, "number" | "title">): string {
	return `#${issue.number} ${issue.title}`;
}

function issueListDescription(issue: Pick<IssueListItem, "labels">, work: IssueWork | undefined): string {
	const labels = issue.labels.map((label) => label.name).filter(Boolean).join(", ") || "sin labels";
	return `${labels} · ${workSummary(work)}`;
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

export default function githubIssuesExtension(pi: ExtensionAPI): void {
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
		initialSelection: number[],
	): Promise<IssueListAction> {
		const createValue = "__create__";
		const items: MenuItem<string>[] = [
			...issues.map((issue) => ({
				value: String(issue.number),
				label: formatIssueChoice(issue),
				description: issueListDescription(issue, workByIssue.get(issue.number)),
			})),
			{
				value: createValue,
				label: "＋ Crear un issue nuevo",
				description: "Abre el editor y pide confirmación antes de publicarlo",
				multiSelectable: false,
			},
		];
		const selected = await selectManyMenu(
			ctx,
			`GitHub Issues abiertos (${issues.length})`,
			items,
			{
				maxVisible: 12,
				maxSelected: 12,
				initialSelectedValues: initialSelection.map(String),
			},
		);
		if (selected === null) return { kind: "exit" };
		if (selected.includes(createValue)) return { kind: "create" };
		return { kind: "select", numbers: selected.map(Number) };
	}

	async function showSelectionActions(
		ctx: ExtensionContext,
		issues: IssueListItem[],
	): Promise<SelectionAction> {
		const numbers = issues.map((issue) => `#${issue.number}`).join(", ");
		const items: MenuItem<SelectionAction>[] = [
			{
				value: "analyze",
				label: "1  Analizar",
				description: "Explora issues, código, tests y contrato; recomienda grill, spec, quick-run o rechazo",
				recommended: true,
				shortcut: "1",
			},
			{
				value: "close",
				label: "2  Cerrar como completado",
				description: `Cierra ${issues.length === 1 ? numbers : `los ${issues.length} issues seleccionados`}`,
				success: true,
				shortcut: "2",
			},
			{
				value: "delete",
				label: "3  Eliminar permanentemente",
				description: `Elimina ${issues.length === 1 ? numbers : `los ${issues.length} issues seleccionados`}; no se puede deshacer`,
				danger: true,
				shortcut: "3",
			},
			{
				value: "back",
				label: "0  Volver atrás",
				description: "Regresa a la lista conservando la selección",
				shortcut: "0",
				separatorBefore: true,
			},
		];
		const selected = await selectMenu(
			ctx,
			issues.length === 1 ? `Issue ${numbers} · elegí una acción` : `${issues.length} issues (${numbers}) · elegí una acción`,
			items,
			{ maxVisible: items.length, minPrimaryColumnWidth: 42, maxPrimaryColumnWidth: 50 },
		);
		return selected ?? "back";
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

	function queueIssueTriage(issues: IssueListItem[], ctx: ExtensionContext): boolean {
		const triageCommand = pi.getCommands().find((command) => command.name === "skill:issue-triage");
		if (!triageCommand) {
			ctx.ui.notify("Todavía no está instalado /skill:issue-triage", "warning");
			return false;
		}
		pi.sendUserMessage(`/skill:issue-triage ${issues.map((issue) => `#${issue.number}`).join(" ")}`);
		return true;
	}

	function bulkSummary(action: "close" | "delete", results: BulkMutationResult[]): string {
		const verb = action === "close" ? "Cierre" : "Eliminación";
		const succeeded = results.filter((result) => result.success);
		const failed = results.filter((result) => !result.success);
		return [
			`${verb}: ${succeeded.length}/${results.length} completados.`,
			...succeeded.map((result) => `✓ #${result.number} — ${result.title}`),
			...failed.map((result) => `✗ #${result.number} — ${result.title}: ${result.error}`),
		].join("\n");
	}

	async function mutateIssues(
		action: "close" | "delete",
		issues: IssueListItem[],
		ctx: ExtensionContext,
	): Promise<boolean> {
		const issueLines = issues.map((issue) => `#${issue.number} — ${issue.title}`).join("\n");
		const destructive = action === "delete";
		const confirmed = await ctx.ui.confirm(
			destructive ? `Eliminar ${issues.length} issue(s)` : `Cerrar ${issues.length} issue(s)`,
			[
				issueLines,
				"",
				destructive
					? "Esta acción es permanente y los issues no se podrán recuperar."
					: "Los issues se marcarán como completados y se podrán volver a abrir.",
			].join("\n"),
		);
		if (!confirmed) return false;

		const results = await withLoader(
			ctx,
			destructive ? "Eliminando issues en GitHub…" : "Cerrando issues en GitHub…",
			async (signal): Promise<BulkMutationResult[]> => Promise.all(issues.map(async (issue) => {
				try {
					const args = destructive
						? ["issue", "delete", String(issue.number), "--yes"]
						: ["issue", "close", String(issue.number), "--reason", "completed"];
					await runGh(args, ctx, signal);
					return { number: issue.number, title: issue.title, success: true };
				} catch (error) {
					return { number: issue.number, title: issue.title, success: false, error: errorMessage(error) };
				}
			})),
		);
		const failures = results.filter((result) => !result.success).length;
		ctx.ui.notify(bulkSummary(action, results), failures > 0 ? "warning" : "info");
		return results.some((result) => result.success);
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

	async function viewIssues(ctx: ExtensionContext): Promise<void> {
		let selectedNumbers: number[] = [];

		while (true) {
			const { issues, workByIssue } = await listOpenIssues(ctx);
			selectedNumbers = selectedNumbers.filter((number) => issues.some((issue) => issue.number === number));
			const listAction = await showIssueList(ctx, issues, workByIssue, selectedNumbers);
			if (listAction.kind === "exit") return;
			if (listAction.kind === "create") {
				if (await createIssue(ctx)) selectedNumbers = [];
				continue;
			}

			selectedNumbers = listAction.numbers;
			const selectedIssues = selectedNumbers
				.map((number) => issues.find((issue) => issue.number === number))
				.filter((issue): issue is IssueListItem => issue !== undefined);
			if (selectedIssues.length === 0) continue;

			const action = await showSelectionActions(ctx, selectedIssues);
			if (action === "back") continue;
			if (action === "analyze") {
				if (queueIssueTriage(selectedIssues, ctx)) return;
				continue;
			}
			if (await mutateIssues(action, selectedIssues, ctx)) selectedNumbers = [];
		}
	}

	pi.registerCommand("issues", {
		description: "Seleccionar y administrar GitHub Issues; Analizar enruta a grill, spec, quick-run o rechazo",
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
