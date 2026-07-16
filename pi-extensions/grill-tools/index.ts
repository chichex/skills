import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import { getMarkdownTheme, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { menuItems, selectMenu, type MenuItem } from "../lib/menu";

const AGENT_DIR = join(homedir(), ".pi", "agent");
const STORE_DIR = join(AGENT_DIR, "grill-sessions");
const SESSIONS_DIR = join(AGENT_DIR, "sessions");
const FORMAT_VERSION = 3;
const DEFAULT_QUESTION_LIMIT = 20;

type GrillWorkflowMode = "standard" | "domain-modeling";

interface GrillEstimate {
	min: number;
	likely: number;
	max: number;
}

interface GrillSection {
	id: string;
	title: string;
	estimatedQuestions: number;
	dependsOn?: string[];
	status?: "pending" | "active" | "resolved";
}

interface GrillInteraction {
	id: string;
	question: string;
	answers: string[];
	section?: string;
	recommendation?: string;
	createdAt: string;
}

interface GrillDecision {
	id: string;
	title: string;
	agreement: string;
	section?: string;
	updatedAt: string;
}

interface GrillPendingBranch {
	id: string;
	title: string;
	description?: string;
	section?: string;
}

interface GrillIssueReference {
	number: number;
	repository?: string;
}

type GrillStatus = "active" | "paused" | "finalized";

interface GrillSnapshot {
	version: number;
	id: string;
	topic: string;
	projectPath: string;
	projectName: string;
	status: GrillStatus;
	workflowMode: GrillWorkflowMode;
	sourceIssue?: GrillIssueReference;
	createdAt: string;
	updatedAt: string;
	estimate: GrillEstimate;
	questionLimit: number;
	sections: GrillSection[];
	interactions: GrillInteraction[];
	decisions: GrillDecision[];
	pendingBranches: GrillPendingBranch[];
	summary?: string;
	handoffMarkdown?: string;
	parentId?: string;
	revision: number;
}

interface SpecDocument {
	path: string;
	projectPath: string;
	title: string;
	state: string;
	updatedAt: string;
	markdown: string;
}

const EstimateSchema = Type.Object({
	min: Type.Integer({ minimum: 0 }),
	likely: Type.Integer({ minimum: 0 }),
	max: Type.Integer({ minimum: 0 }),
});

const SectionSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	estimatedQuestions: Type.Integer({ minimum: 0 }),
	dependsOn: Type.Optional(Type.Array(Type.String())),
	status: Type.Optional(StringEnum(["pending", "active", "resolved"] as const)),
});

const DecisionSchema = Type.Object({
	id: Type.String({ description: "Stable decision identifier; reuse it when revising a decision" }),
	title: Type.String(),
	agreement: Type.String(),
	section: Type.Optional(Type.String()),
});

const PendingBranchSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	description: Type.Optional(Type.String()),
	section: Type.Optional(Type.String()),
});

const InteractionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this asked question" }),
	question: Type.String(),
	answers: Type.Array(Type.String(), { minItems: 1 }),
	section: Type.Optional(Type.String()),
	recommendation: Type.Optional(Type.String()),
});

const IssueReferenceSchema = Type.Object({
	number: Type.Integer({ minimum: 1, description: "GitHub issue number that originated this grill" }),
	repository: Type.Optional(Type.String({ description: "Optional owner/repo identity" })),
});

const GrillSessionParams = Type.Object({
	action: StringEnum(["create", "configure", "checkpoint", "pause", "finalize", "get"] as const),
	sessionId: Type.Optional(Type.String({ description: "Required except for create" })),
	topic: Type.Optional(Type.String({ description: "Required for create" })),
	projectPath: Type.Optional(Type.String({ description: "Defaults to the current git root or cwd" })),
	workflowMode: Type.Optional(
		StringEnum(["standard", "domain-modeling"] as const, {
			description: "Whether the grill only produces a handoff or also maintains domain documentation",
		}),
	),
	sourceIssue: Type.Optional(IssueReferenceSchema),
	estimate: Type.Optional(EstimateSchema),
	questionLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	sections: Type.Optional(Type.Array(SectionSchema, { description: "Full replacement section map" })),
	interaction: Type.Optional(InteractionSchema),
	decision: Type.Optional(DecisionSchema),
	pendingBranches: Type.Optional(
		Type.Array(PendingBranchSchema, { description: "Full replacement list of unresolved branches" }),
	),
	summary: Type.Optional(Type.String()),
	handoffMarkdown: Type.Optional(Type.String({ description: "Required for finalize" })),
});

const SelectGrillSessionParams = Type.Object({
	status: Type.Optional(
		StringEnum(["resumable", "active", "paused", "finalized", "all"] as const, {
			description: "Defaults to resumable (active and paused)",
		}),
	),
	scope: Type.Optional(
		StringEnum(["current-project", "all"] as const, {
			description: "Defaults to current-project",
		}),
	),
	query: Type.Optional(Type.String({ description: "Optional case-insensitive topic search" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	intent: Type.Optional(
		StringEnum(["manage", "spec-source"] as const, {
			description: "Defaults to manage. spec-source selects a finalized handoff without opening its action menu.",
		}),
	),
});

function now(): string {
	return new Date().toISOString();
}

function slugify(text: string): string {
	const slug = text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "grill";
}

function jsonPath(id: string): string {
	return join(STORE_DIR, `${id}.json`);
}

function markdownPath(id: string): string {
	return join(STORE_DIR, `${id}.md`);
}

async function ensureStore(): Promise<void> {
	await mkdir(STORE_DIR, { recursive: true });
}

async function writeAtomic(path: string, content: string): Promise<void> {
	await ensureStore();
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, content, "utf8");
	await rename(temporary, path);
}

function isSnapshot(value: unknown): value is GrillSnapshot {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<GrillSnapshot>;
	return (
		typeof candidate.id === "string" &&
		typeof candidate.topic === "string" &&
		typeof candidate.projectPath === "string" &&
		(candidate.status === "active" || candidate.status === "paused" || candidate.status === "finalized") &&
		Array.isArray(candidate.interactions) &&
		Array.isArray(candidate.decisions) &&
		Array.isArray(candidate.pendingBranches)
	);
}

async function saveSnapshot(snapshot: GrillSnapshot): Promise<void> {
	snapshot.updatedAt = now();
	await writeAtomic(jsonPath(snapshot.id), `${JSON.stringify(snapshot, null, 2)}\n`);
}

function normalizeSnapshot(snapshot: GrillSnapshot): GrillSnapshot {
	if (!snapshot.sourceIssue) {
		const match = snapshot.topic.match(/\bissue\s*#(\d+)/i) ?? snapshot.id.match(/^issue-(\d+)(?:-|$)/i);
		const number = Number(match?.[1]);
		if (Number.isInteger(number) && number > 0) snapshot.sourceIssue = { number };
	}
	if (snapshot.workflowMode !== "standard" && snapshot.workflowMode !== "domain-modeling") {
		const domainDecision = snapshot.decisions.find((decision) => {
			const identity = `${decision.id} ${decision.title}`.toLowerCase();
			return identity.includes("domain modeling") || identity.includes("modelado de dominio");
		});
		const agreement = domainDecision?.agreement.toLowerCase() ?? "";
		const explicitlyDisabled = /\b(no|false|standard|disabled|desactivad[oa]|sin documentaci[oó]n)\b/.test(agreement);
		snapshot.workflowMode = domainDecision && !explicitlyDisabled ? "domain-modeling" : "standard";
	}
	snapshot.version = FORMAT_VERSION;
	return snapshot;
}

async function loadSnapshot(id: string): Promise<GrillSnapshot> {
	if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid grill session id");
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(jsonPath(id), "utf8"));
	} catch (error) {
		throw new Error(`Could not load grill session ${id}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isSnapshot(parsed)) throw new Error(`Invalid grill session file: ${id}`);
	return normalizeSnapshot(parsed);
}

async function listSnapshots(): Promise<GrillSnapshot[]> {
	await ensureStore();
	const files = (await readdir(STORE_DIR)).filter((file) => file.endsWith(".json"));
	const snapshots: GrillSnapshot[] = [];
	for (const file of files) {
		try {
			const parsed: unknown = JSON.parse(await readFile(join(STORE_DIR, file), "utf8"));
			if (isSnapshot(parsed)) snapshots.push(normalizeSnapshot(parsed));
		} catch {
			// Ignore corrupt entries in the selector; direct get still reports the error.
		}
	}
	return snapshots.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function projectRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
	const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5_000 });
	return result.code === 0 && result.stdout.trim() ? resolve(result.stdout.trim()) : resolve(cwd);
}

function compactSnapshot(snapshot: GrillSnapshot): object {
	return {
		id: snapshot.id,
		topic: snapshot.topic,
		projectPath: snapshot.projectPath,
		status: snapshot.status,
		workflowMode: snapshot.workflowMode,
		sourceIssue: snapshot.sourceIssue,
		progress: `${snapshot.interactions.length} of ~${snapshot.estimate.likely} (limit ${snapshot.questionLimit})`,
		estimate: snapshot.estimate,
		sections: snapshot.sections,
		decisions: snapshot.decisions,
		pendingBranches: snapshot.pendingBranches,
		summary: snapshot.summary,
		handoffMarkdown: snapshot.handoffMarkdown,
		parentId: snapshot.parentId,
		revision: snapshot.revision,
		updatedAt: snapshot.updatedAt,
	};
}

function snapshotText(prefix: string, snapshot: GrillSnapshot): string {
	const output = `${prefix}\n${JSON.stringify(compactSnapshot(snapshot), null, 2)}`;
	const truncated = truncateHead(output, { maxBytes: 45 * 1024, maxLines: 1_900 });
	return truncated.truncated
		? `${truncated.content}\n\n[Snapshot truncated. Full state: ${jsonPath(snapshot.id)}]`
		: truncated.content;
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return value;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusIcon(status: GrillStatus): string {
	if (status === "active") return "●";
	if (status === "paused") return "Ⅱ";
	return "✓";
}

function snapshotMenuItem(snapshot: GrillSnapshot): MenuItem<string> {
	return {
		value: snapshot.id,
		label: `${statusIcon(snapshot.status)} ${snapshot.topic}`,
		description: `${snapshot.status} · ${snapshot.workflowMode} · ${basename(snapshot.projectPath)} · ${snapshot.interactions.length}/~${snapshot.estimate.likely} · ${formatDate(snapshot.updatedAt)} · ${snapshot.id.slice(-8)}`,
	};
}

function inspectionMarkdown(snapshot: GrillSnapshot): string {
	const lines = [
		`# ${snapshot.topic}`,
		"",
		`- **Estado:** ${snapshot.status}`,
		`- **Modo:** ${snapshot.workflowMode}`,
		...(snapshot.sourceIssue
			? [`- **Issue de origen:** ${snapshot.sourceIssue.repository ? `${snapshot.sourceIssue.repository}#` : "#"}${snapshot.sourceIssue.number}`]
			: []),
		`- **Proyecto:** ${snapshot.projectPath}`,
		`- **Progreso:** ${snapshot.interactions.length} de ~${snapshot.estimate.likely} (límite ${snapshot.questionLimit})`,
		`- **Actualizado:** ${formatDate(snapshot.updatedAt)}`,
		`- **ID:** \`${snapshot.id}\``,
	];

	if (snapshot.summary) lines.push("", "## Resumen", "", snapshot.summary);
	if (snapshot.decisions.length > 0) {
		lines.push("", "## Decisiones", "");
		for (const decision of snapshot.decisions) {
			lines.push(`- **${decision.title}:** ${decision.agreement}`);
		}
	}
	if (snapshot.pendingBranches.length > 0) {
		lines.push("", "## Ramas pendientes", "");
		for (const branch of snapshot.pendingBranches) {
			lines.push(`- **${branch.title}**${branch.description ? ` — ${branch.description}` : ""}`);
		}
	} else {
		lines.push("", "## Ramas pendientes", "", "Ninguna.");
	}

	lines.push("", `JSON: \`${jsonPath(snapshot.id)}\``);
	if (snapshot.handoffMarkdown) lines.push(`Handoff: \`${markdownPath(snapshot.id)}\``);
	return lines.join("\n");
}

function specMetadata(markdown: string, path: string): Pick<SpecDocument, "title" | "state"> {
	const heading = markdown.match(/^#\s+(?:Spec\s*[—–-]\s*)?(.+?)\s*$/m)?.[1]?.trim();
	const state = markdown.match(/Estado:\s*([^>\n.]+?)(?:\s*-->|[.\n])/i)?.[1]?.trim();
	return {
		title: heading || basename(path, ".md").replace(/[-_]+/g, " "),
		state: state || "sin estado",
	};
}

function specStatusRank(state: string): number {
	const normalized = state.toLowerCase();
	if (normalized.includes("aprobad") || normalized.includes("approved")) return 0;
	if (normalized.includes("draft") || normalized.includes("borrador")) return 1;
	if (normalized.includes("implement")) return 2;
	return 3;
}

function specStatusIcon(state: string): string {
	const rank = specStatusRank(state);
	if (rank === 0) return "●";
	if (rank === 1) return "◌";
	if (rank === 2) return "✓";
	return "•";
}

function specMenuItem(spec: SpecDocument): MenuItem<string> {
	return {
		value: spec.path,
		label: `${specStatusIcon(spec.state)} ${spec.title}`,
		description: `${spec.state} · ${basename(spec.projectPath)} · ${formatDate(spec.updatedAt)} · ${basename(spec.path)}`,
	};
}

function specInspectionMarkdown(spec: SpecDocument): string {
	return `${spec.markdown.trim()}\n\n---\n\n**Ruta:** \`${spec.path}\``;
}

async function listSpecs(projectPaths: string[]): Promise<SpecDocument[]> {
	const roots = [...new Set(projectPaths.map((path) => resolve(path)))];
	const specs = (await Promise.all(roots.map(async (projectPath) => {
		const directory = join(projectPath, ".sdd", "specs");
		let files: string[];
		try {
			files = (await readdir(directory, { withFileTypes: true }))
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.map((entry) => entry.name);
		} catch {
			return [];
		}

		return Promise.all(files.map(async (file) => {
			const path = join(directory, file);
			const [markdown, fileStat] = await Promise.all([readFile(path, "utf8"), stat(path)]);
			return {
				path,
				projectPath,
				...specMetadata(markdown, path),
				updatedAt: fileStat.mtime.toISOString(),
				markdown,
			};
		}));
	}))).flat();

	return specs.sort((a, b) => {
		const statusDifference = specStatusRank(a.state) - specStatusRank(b.state);
		if (statusDifference !== 0) return statusDifference;

		const dateDifference = b.updatedAt.localeCompare(a.updatedAt);
		if (dateDifference !== 0) return dateDifference;

		return a.title.localeCompare(b.title);
	});
}

async function listSessionCwds(): Promise<string[]> {
	let directories;
	try {
		directories = (await readdir(SESSIONS_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory());
	} catch {
		return [];
	}

	const paths = await Promise.all(directories.map(async (directory): Promise<string | undefined> => {
		try {
			const sessionDirectory = join(SESSIONS_DIR, directory.name);
			const sessionFile = (await readdir(sessionDirectory)).find((file) => file.endsWith(".jsonl"));
			if (!sessionFile) return undefined;
			const handle = await open(join(sessionDirectory, sessionFile), "r");
			try {
				const buffer = Buffer.alloc(4096);
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
				const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0];
				const header = JSON.parse(firstLine) as { cwd?: unknown };
				return typeof header.cwd === "string" ? header.cwd : undefined;
			} finally {
				await handle.close();
			}
		} catch {
			return undefined;
		}
	}));

	return paths.filter((path): path is string => typeof path === "string");
}

async function knownProjectRoots(pi: ExtensionAPI, currentProject: string): Promise<string[]> {
	const [snapshots, sessionCwds] = await Promise.all([listSnapshots(), listSessionCwds()]);
	const candidates = new Set([currentProject, ...snapshots.map((snapshot) => snapshot.projectPath), ...sessionCwds]);
	const roots = await Promise.all([...candidates].map(async (path) => {
		try {
			return await projectRoot(pi, path);
		} catch {
			return resolve(path);
		}
	}));
	return [...new Set(roots)];
}

function upsertDecision(snapshot: GrillSnapshot, decision: Omit<GrillDecision, "updatedAt">): void {
	const existing = snapshot.decisions.findIndex((item) => item.id === decision.id);
	const next: GrillDecision = { ...decision, updatedAt: now() };
	if (existing >= 0) snapshot.decisions[existing] = next;
	else snapshot.decisions.push(next);
}

export default function grillTools(pi: ExtensionAPI) {
	pi.registerEntryRenderer("grill-session-inspection", (entry) => {
		const data = entry.data as { markdown?: string };
		return new Markdown(data.markdown ?? "", 1, 1, getMarkdownTheme());
	});

	pi.registerEntryRenderer("sdd-spec-inspection", (entry) => {
		const data = entry.data as { markdown?: string };
		return new Markdown(data.markdown ?? "", 1, 1, getMarkdownTheme());
	});

	pi.registerCommand("specs", {
		description: "Abrir el selector interactivo de specs SDD locales",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("El selector de specs requiere modo TUI", "error");
				return;
			}

			await ctx.waitForIdle();

			try {
				const currentProject = await projectRoot(pi, ctx.cwd);
				let effectiveScope: "current-project" | "all" = "current-project";
				let allSpecs: SpecDocument[] | undefined;
				const currentSpecs = await listSpecs([currentProject]);
				const showAllChoice = "🌐 Mostrar specs de todos los proyectos conocidos por Pi…";
				const showProjectChoice = `⌂ Volver a specs de ${basename(currentProject)}`;
				const backChoice = "← Volver a la lista de specs";

				while (true) {
					const specs = effectiveScope === "current-project"
						? currentSpecs
						: (allSpecs ??= await listSpecs(await knownProjectRoots(pi, currentProject)));
					const scopeChoice = effectiveScope === "current-project" ? showAllChoice : showProjectChoice;
					const items: MenuItem<string>[] = [
						...specs.map(specMenuItem),
						{ value: scopeChoice, label: scopeChoice, description: "Cambia el alcance del selector" },
					];

					const selectedChoice = await selectMenu(
						ctx,
						`Specs SDD · ${effectiveScope === "current-project" ? basename(currentProject) : "todos los proyectos conocidos"}`,
						items,
						{ minPrimaryColumnWidth: 44, maxPrimaryColumnWidth: 52 },
					);
					if (selectedChoice === null) return;
					if (selectedChoice === showAllChoice) {
						effectiveScope = "all";
						continue;
					}
					if (selectedChoice === showProjectChoice) {
						effectiveScope = "current-project";
						continue;
					}

					const selected = specs.find((spec) => spec.path === selectedChoice);
					if (!selected) throw new Error("No se pudo resolver la spec seleccionada");

					const inspectChoice = "Inspeccionar";
					const runChoice = "Ejecutar con /skill:sdd-run";
					const action = await selectMenu(
						ctx,
						`${selected.title} · ${selected.state}`,
						menuItems([backChoice, inspectChoice, runChoice]),
					);
					if (action === null || action === backChoice) continue;

					if (action === inspectChoice) {
						pi.appendEntry("sdd-spec-inspection", {
							markdown: specInspectionMarkdown(selected),
						});
						return;
					}

					const hasSddRunSkill = pi.getCommands().some((command) => command.name === "skill:sdd-run");
					const instruction = `Ejecutá la spec SDD en ${selected.path}. Su raíz de proyecto es ${selected.projectPath}.`;
					pi.sendUserMessage(hasSddRunSkill
						? `/skill:sdd-run ${selected.path}\n\nLa spec fue seleccionada mediante /specs. Trabajá desde la raíz ${selected.projectPath}.`
						: instruction);
					return;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Specs: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("grills", {
		description: "Abrir el selector interactivo de sesiones de grill",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("El selector de grills requiere modo TUI", "error");
				return;
			}

			await ctx.waitForIdle();

			try {
				const currentProject = await projectRoot(pi, ctx.cwd);
				const allSnapshots = await listSnapshots();
				let effectiveScope: "current-project" | "all" = "current-project";
				const showAllChoice = "🌐 Mostrar sesiones de todos los proyectos…";
				const showProjectChoice = `⌂ Volver a sesiones de ${basename(currentProject)}`;
				const backChoice = "← Volver a la lista de sesiones";

				while (true) {
					const snapshots = allSnapshots.filter((snapshot) =>
						effectiveScope === "all" || resolve(snapshot.projectPath) === currentProject
					);
					const scopeChoice = effectiveScope === "current-project" ? showAllChoice : showProjectChoice;
					const items: MenuItem<string>[] = [
						...snapshots.map(snapshotMenuItem),
						{ value: scopeChoice, label: scopeChoice, description: "Cambia el alcance del selector" },
					];

					const selectedChoice = await selectMenu(
						ctx,
						`Grill sessions · ${effectiveScope === "current-project" ? basename(currentProject) : "todos los proyectos"}`,
						items,
						{ minPrimaryColumnWidth: 44, maxPrimaryColumnWidth: 52 },
					);
					if (selectedChoice === null) return;
					if (selectedChoice === showAllChoice) {
						effectiveScope = "all";
						continue;
					}
					if (selectedChoice === showProjectChoice) {
						effectiveScope = "current-project";
						continue;
					}

					const selected = snapshots.find((snapshot) => snapshot.id === selectedChoice);
					if (!selected) throw new Error("No se pudo resolver la sesión seleccionada");

					const inspectChoice = "Inspeccionar";
					const resumeChoice = "Retomar en esta conversación";
					const duplicateChoice = "Duplicar como nueva revisión y retomar";
					const createSpecChoice = "Crear spec SDD desde el handoff finalizado";
					const actionChoices = selected.status === "finalized"
						? [backChoice, inspectChoice, createSpecChoice, duplicateChoice]
						: [backChoice, resumeChoice, inspectChoice];
					const action = await selectMenu(
						ctx,
						`${selected.topic} · ${selected.status}`,
						menuItems(actionChoices),
					);
					if (action === null || action === backChoice) continue;

					if (action === inspectChoice) {
						pi.appendEntry("grill-session-inspection", {
							markdown: inspectionMarkdown(selected),
						});
						return;
					}

					if (action === createSpecChoice) {
						const hasSddSpecSkill = pi.getCommands().some((command) => command.name === "skill:sdd-spec");
						const instruction = `Create an SDD spec from finalized grill session ${selected.id}. Use project root ${selected.projectPath}. Treat the frozen handoff as authoritative and do not ask again about confirmed decisions.`;
						pi.sendUserMessage(hasSddSpecSkill ? `/skill:sdd-spec --from-grill ${selected.id}` : instruction);
						return;
					}

					let session = selected;
					if (action === duplicateChoice) {
						const timestamp = now();
						session = {
							...selected,
							id: `${slugify(selected.topic)}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`,
							status: "active",
							createdAt: timestamp,
							updatedAt: timestamp,
							handoffMarkdown: undefined,
							parentId: selected.id,
							revision: selected.revision + 1,
						};
						await saveSnapshot(session);
					} else if (action === resumeChoice) {
						session.status = "active";
						await saveSnapshot(session);
					}

					const instruction = [
						`Retomá la sesión de grill ${session.id}, ya seleccionada localmente mediante /grills.`,
						`Cargá su snapshot autoritativo con grill_session usando action "get" y sessionId "${session.id}"; no vuelvas a abrir el selector.`,
						"Mostrá brevemente lo resuelto y pendiente, y pedí autorización antes de continuar.",
					].join(" ");
					const availableCommands = new Set(pi.getCommands().map((command) => command.name));
					const grillCommand = availableCommands.has("skill:grill") ? "skill:grill" : undefined;
					pi.sendUserMessage(grillCommand ? `/${grillCommand} ${instruction}` : instruction);
					return;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Grills: ${message}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "grill_session",
		label: "Grill session",
		description:
			"Create, configure, checkpoint, pause, finalize, or retrieve a persistent grill interview. Grill sessions are stored globally and survive Pi sessions. Use only as directed by the grill skill.",
		parameters: GrillSessionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.action === "create") {
				if (!params.topic?.trim()) throw new Error("topic is required for create");
				if (!params.estimate) throw new Error("estimate is required for create");
				const root = params.projectPath?.trim()
					? resolve(ctx.cwd, params.projectPath.trim())
					: await projectRoot(pi, ctx.cwd);
				const timestamp = now();
				const id = `${slugify(params.topic)}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;
				const snapshot: GrillSnapshot = {
					version: FORMAT_VERSION,
					id,
					topic: params.topic.trim(),
					projectPath: root,
					projectName: basename(root),
					status: "active",
					workflowMode: params.workflowMode ?? "standard",
					sourceIssue: params.sourceIssue
						? {
							number: params.sourceIssue.number,
							repository: params.sourceIssue.repository?.trim() || undefined,
						}
						: undefined,
					createdAt: timestamp,
					updatedAt: timestamp,
					estimate: params.estimate,
					questionLimit: params.questionLimit ?? DEFAULT_QUESTION_LIMIT,
					sections: params.sections ?? [],
					interactions: [],
					decisions: [],
					pendingBranches: params.pendingBranches ?? [],
					summary: params.summary,
					revision: 1,
				};
				await saveSnapshot(snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Created grill session.", snapshot) }],
					details: { action: "create", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (!params.sessionId) throw new Error(`sessionId is required for ${params.action}`);
			const snapshot = await loadSnapshot(params.sessionId);

			if (params.action === "get") {
				return {
					content: [{ type: "text", text: snapshotText("Loaded grill session.", snapshot) }],
					details: { action: "get", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (snapshot.status === "finalized") {
				throw new Error("Finalized grill sessions are immutable; duplicate it with select_grill_session first");
			}

			if (params.action === "configure") {
				if (!params.workflowMode) throw new Error("workflowMode is required for configure");
				snapshot.workflowMode = params.workflowMode;
				await saveSnapshot(snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Grill session configured.", snapshot) }],
					details: { action: "configure", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (params.action === "checkpoint") {
				if (!params.interaction) throw new Error("interaction is required for checkpoint");
				if (snapshot.interactions.some((item) => item.id === params.interaction!.id)) {
					throw new Error(`Interaction id already exists: ${params.interaction.id}`);
				}
				if (snapshot.interactions.length >= snapshot.questionLimit) {
					throw new Error(
						`Hard question limit reached (${snapshot.questionLimit}). Pause and split the remaining branches before asking more.`,
					);
				}
				snapshot.interactions.push({ ...params.interaction, createdAt: now() });
				if (params.decision) upsertDecision(snapshot, params.decision);
				if (params.pendingBranches) snapshot.pendingBranches = params.pendingBranches;
				if (params.sections) snapshot.sections = params.sections;
				if (params.estimate) snapshot.estimate = params.estimate;
				if (params.summary !== undefined) snapshot.summary = params.summary;
				snapshot.status = "active";
				await saveSnapshot(snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Checkpoint saved.", snapshot) }],
					details: { action: "checkpoint", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (params.action === "pause") {
				if (params.pendingBranches) snapshot.pendingBranches = params.pendingBranches;
				if (params.sections) snapshot.sections = params.sections;
				if (params.estimate) snapshot.estimate = params.estimate;
				if (params.summary !== undefined) snapshot.summary = params.summary;
				snapshot.status = "paused";
				await saveSnapshot(snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Grill session paused.", snapshot) }],
					details: { action: "pause", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (params.action === "finalize") {
				if (!params.handoffMarkdown?.trim()) throw new Error("handoffMarkdown is required for finalize");
				if (params.pendingBranches) snapshot.pendingBranches = params.pendingBranches;
				if (params.sections) snapshot.sections = params.sections;
				if (params.summary !== undefined) snapshot.summary = params.summary;
				snapshot.status = "finalized";
				snapshot.handoffMarkdown = params.handoffMarkdown.trim();
				await writeAtomic(markdownPath(snapshot.id), `${snapshot.handoffMarkdown}\n`);
				await saveSnapshot(snapshot);
				return {
					content: [{
						type: "text",
						text: `${snapshotText("Grill session finalized.", snapshot)}\nMarkdown: ${markdownPath(snapshot.id)}`,
					}],
					details: {
						action: "finalize",
						snapshot,
						jsonPath: jsonPath(snapshot.id),
						markdownPath: markdownPath(snapshot.id),
					},
				};
			}

			throw new Error(`Unsupported action: ${params.action}`);
		},

		renderCall(args, theme) {
			const id = args.sessionId ? ` ${theme.fg("dim", args.sessionId)}` : "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("grill_session"))} ${theme.fg("accent", args.action)}${id}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { snapshot?: GrillSnapshot; markdownPath?: string } | undefined;
			if (!details?.snapshot) return new Text(theme.fg("warning", "No snapshot"), 0, 0);
			const snapshot = details.snapshot;
			const suffix = details.markdownPath ? `\n${theme.fg("dim", details.markdownPath)}` : "";
			return new Text(
				`${theme.fg("success", "✓ ")}${snapshot.topic} · ${snapshot.status} · ${snapshot.workflowMode} · ${snapshot.interactions.length}/~${snapshot.estimate.likely}${suffix}`,
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "select_grill_session",
		label: "Select grill session",
		description:
			"Interactively list, inspect, resume, duplicate, or turn finalized grill sessions into an SDD spec. Use when the user wants to see, continue, or specify from a previous grilling interview.",
		promptSnippet: "Interactively select and resume a previous grill session",
		promptGuidelines: [
			"Use select_grill_session when the user asks to list, inspect, resume, or revisit grilling sessions.",
		],
		parameters: SelectGrillSessionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) throw new Error("select_grill_session requires interactive or RPC mode");
			const status = params.status ?? "resumable";
			const scope = params.scope ?? "current-project";
			const limit = params.limit ?? 50;
			const currentProject = await projectRoot(pi, ctx.cwd);
			const query = params.query?.trim().toLowerCase();

			const allSnapshots = await listSnapshots();
			function filteredSnapshots(targetScope: "current-project" | "all"): GrillSnapshot[] {
				let matches = allSnapshots;
				if (targetScope === "current-project") {
					matches = matches.filter((snapshot) => resolve(snapshot.projectPath) === currentProject);
				}
				if (status === "resumable") matches = matches.filter((snapshot) => snapshot.status !== "finalized");
				else if (status !== "all") matches = matches.filter((snapshot) => snapshot.status === status);
				if (query) matches = matches.filter((snapshot) => snapshot.topic.toLowerCase().includes(query));
				return matches.slice(0, limit);
			}

			let effectiveScope = scope;
			const showAllChoice = "🌐 Mostrar sesiones de todos los proyectos…";
			const showProjectChoice = `⌂ Volver a sesiones de ${basename(currentProject)}`;
			const backChoice = "← Volver a la lista de sesiones";

			while (true) {
				const snapshots = filteredSnapshots(effectiveScope);
				const scopeChoice = effectiveScope === "current-project" ? showAllChoice : showProjectChoice;
				const items: MenuItem<string>[] = snapshots.map(snapshotMenuItem);
				if (scope === "current-project") {
					items.push({ value: scopeChoice, label: scopeChoice, description: "Cambia el alcance del selector" });
				}

				if (items.length === 0) {
					return {
						content: [{ type: "text", text: "No grill sessions matched the selected filters." }],
						details: { selected: null, action: "none", status, scope: effectiveScope },
					};
				}

				const selectedChoice = await selectMenu(
					ctx,
					`Grill sessions · ${effectiveScope === "current-project" ? basename(currentProject) : "all projects"}`,
					items,
					{ minPrimaryColumnWidth: 44, maxPrimaryColumnWidth: 52 },
				);
				if (selectedChoice === null) {
					return {
						content: [{ type: "text", text: "The user cancelled grill session selection." }],
						details: { selected: null, action: "cancel" },
					};
				}
				if (selectedChoice === showAllChoice) {
					effectiveScope = "all";
					continue;
				}
				if (selectedChoice === showProjectChoice) {
					effectiveScope = "current-project";
					continue;
				}

				const selected = snapshots.find((snapshot) => snapshot.id === selectedChoice);
				if (!selected) throw new Error("Could not resolve the selected grill session");

				if ((params.intent ?? "manage") === "spec-source") {
					if (selected.status !== "finalized" || !selected.handoffMarkdown) {
						throw new Error("An SDD source must be a finalized grill session with a handoff");
					}
					return {
						content: [{ type: "text", text: snapshotText("Selected finalized grill session as SDD source.", selected) }],
						details: {
							selected,
							action: "spec-source",
							jsonPath: jsonPath(selected.id),
							markdownPath: markdownPath(selected.id),
						},
					};
				}

				const createSpecChoice = "Crear spec SDD desde el handoff finalizado";
				const actionChoices = selected.status === "finalized"
					? [backChoice, "Inspect only", createSpecChoice, "Duplicate as a new revision"]
					: [backChoice, "Resume in this conversation", "Inspect only"];
				const selectedAction = await selectMenu(
					ctx,
					`${selected.topic} · ${selected.status}`,
					menuItems(actionChoices),
				);
				if (selectedAction === null || selectedAction === backChoice) continue;

				if (selectedAction === "Inspect only") {
					return {
						content: [{ type: "text", text: snapshotText("Selected grill session for inspection.", selected) }],
						details: {
							selected,
							action: "inspect",
							jsonPath: jsonPath(selected.id),
							markdownPath: selected.handoffMarkdown ? markdownPath(selected.id) : undefined,
						},
					};
				}

				if (selectedAction === createSpecChoice) {
					const hasSddSpecSkill = pi.getCommands().some((command) => command.name === "skill:sdd-spec");
					const instruction = [
						`Create an SDD spec from finalized grill session ${selected.id}.`,
						`Use project root ${selected.projectPath}.`,
						"Treat the frozen handoff as authoritative and do not ask again about confirmed decisions.",
					].join(" ");
					pi.sendUserMessage(
						hasSddSpecSkill ? `/skill:sdd-spec --from-grill ${selected.id}` : instruction,
						{ deliverAs: "steer" },
					);
					return {
						content: [{
							type: "text",
							text: `${snapshotText("Selected finalized grill session as SDD source.", selected)}\nNext action: ${instruction}`,
						}],
						details: {
							selected,
							action: "create-sdd-spec",
							jsonPath: jsonPath(selected.id),
							markdownPath: markdownPath(selected.id),
						},
					};
				}

				if (selected.status === "finalized") {
					const timestamp = now();
					const duplicate: GrillSnapshot = {
						...selected,
						id: `${slugify(selected.topic)}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`,
						status: "active",
						createdAt: timestamp,
						updatedAt: timestamp,
						handoffMarkdown: undefined,
						parentId: selected.id,
						revision: selected.revision + 1,
					};
					await saveSnapshot(duplicate);
					return {
						content: [{ type: "text", text: snapshotText("Duplicated finalized grill session as a new active revision.", duplicate) }],
						details: { selected: duplicate, action: "duplicate", sourceId: selected.id, jsonPath: jsonPath(duplicate.id) },
					};
				}

				selected.status = "active";
				await saveSnapshot(selected);
				return {
					content: [{ type: "text", text: snapshotText("Resumed grill session in this conversation.", selected) }],
					details: { selected, action: "resume", jsonPath: jsonPath(selected.id) },
				};
			}
		},

		renderCall(args, theme) {
			const scope = args.scope ?? "current-project";
			const status = args.status ?? "resumable";
			const intent = args.intent ?? "manage";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("select_grill_session"))} ${theme.fg("muted", `${scope} · ${status} · ${intent}`)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { selected?: GrillSnapshot | null; action?: string } | undefined;
			if (!details?.selected) return new Text(theme.fg("warning", details?.action === "cancel" ? "Cancelled" : "No sessions"), 0, 0);
			return new Text(
				`${theme.fg("success", "✓ ")}${details.selected.topic} · ${theme.fg("accent", details.action ?? "selected")}`,
				0,
				0,
			);
		},
	});
}
