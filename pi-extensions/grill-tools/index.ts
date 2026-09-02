import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { StringEnum } from "@earendil-works/pi-ai";
import {
	getMarkdownTheme,
	truncateHead,
	withFileMutationQueue,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { menuItems, selectMenu, type MenuItem } from "../lib/menu.ts";
import {
	persistSpecPublication,
	SDD_SPEC_ISSUE_STAGING_BODY,
	type SpecPublicationDestination,
	type SpecPublicationPorts,
} from "../sdd-artifacts/spec-publication.ts";
import { requestSddRun } from "../workflow-orchestrator/controller.ts";
import {
	continueWithMaterializedSkill,
	prepareMaterializedSkill,
	queueMaterializedSkill,
} from "../workflow-orchestrator/same-session.ts";
import {
	inspectMarkdownArtifact,
	normalizeNormativeSpecContent,
	type ArtifactFormat,
	type ArtifactProvenance,
	type IssueRef,
	type ResolutionDiagnostic,
} from "../workflow-resolution/index.ts";
import {
	allowsFinalizeSpecContinuation,
	handoffFileNames,
	planGrillHandoff,
	slugify,
} from "./logic.ts";
import {
	compareSpecListEntries,
	isInvalidSpecListEntry,
	specInspectionDiagnostics,
	specMenuPresentation,
} from "./spec-list.ts";

const AGENT_DIR = join(homedir(), ".pi", "agent");
const STORE_DIR = join(AGENT_DIR, "grill-sessions");
const SESSIONS_DIR = join(AGENT_DIR, "sessions");
const FORMAT_VERSION = 4;
const DEFAULT_QUESTION_LIMIT = 20;

type GrillWorkflowMode = "standard" | "domain-modeling";
type GrillInterviewMode = "unselected" | "fast" | "rounds" | "adaptive";

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
	interviewMode: GrillInterviewMode;
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
	format: ArtifactFormat;
	provenance: ArtifactProvenance;
	issue: IssueRef | null;
	diagnostics: ResolutionDiagnostic[];
	updatedAt: string;
	markdown: string;
}

interface SpecProject {
	projectPath: string;
	repository: string;
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
	interviewMode: Type.Optional(
		StringEnum(["unselected", "fast", "rounds", "adaptive"] as const, {
			description: "Persisted answer-collection mode. Configure it immediately after the user chooses a grill modality.",
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
	continueWithSpec: Type.Optional(Type.Boolean({ description: "After finalize, materialize sdd-spec --from-grill in this session" })),
});

const SpecPublicationDestinationParams = Type.Object({
	kind: StringEnum(["local", "issue", "new-issue"] as const),
	path: Type.Optional(Type.String({ description: "Relative .sdd/specs/*.md path for a local destination" })),
	issueNumber: Type.Optional(Type.Integer({ minimum: 1, description: "Existing issue destination" })),
	title: Type.Optional(Type.String({ description: "Title used only while creating a new issue" })),
});

const SpecPublicationDocumentParams = Type.Object({
	id: Type.String({ minLength: 1 }),
	role: StringEnum(["successor", "predecessor"] as const),
	markdown: Type.String({ minLength: 1 }),
	issueNumber: Type.Optional(Type.Integer({ minimum: 1, description: "Expected semantic source issue" })),
	grill: Type.Optional(Type.String({ minLength: 1, description: "Expected decoded grill session id" })),
	supersededBy: Type.Optional(Type.String({ minLength: 1, description: "Required decoded successor ref for predecessors" })),
	destinations: Type.Array(SpecPublicationDestinationParams, { minItems: 1 }),
});

const PersistSddSpecParams = Type.Object({
	mode: StringEnum(["interactive", "assume"] as const),
	repository: Type.String({ minLength: 1, description: "Resolved owner/repo identity, or local/<project>" }),
	projectPath: Type.Optional(Type.String({ description: "Defaults to the current git root or cwd" })),
	documents: Type.Array(SpecPublicationDocumentParams, { minItems: 1 }),
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

function jsonPath(id: string): string {
	return join(STORE_DIR, `${id}.json`);
}

function markdownPath(id: string): string {
	return join(STORE_DIR, `${id}.md`);
}

async function ensureStore(): Promise<void> {
	await mkdir(STORE_DIR, { recursive: true });
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, content, "utf8");
	await rename(temporary, path);
}

async function writeAtomic(path: string, content: string): Promise<void> {
	await ensureStore();
	await writeFileAtomic(path, content);
}

// Escribe (o actualiza) el handoff interoperable en `.sdd/grills/` del
// proyecto de la sesion. El snapshot JSON global sigue siendo la fuente de
// verdad runtime; este archivo es el artefacto SDD que consumen los otros
// harnesses y el handoff materializado de sdd-spec --from-grill. Nunca rompe la accion que lo
// invoca: ante un proyecto inexistente devuelve el error como texto.
async function writeRepoHandoff(
	snapshot: GrillSnapshot,
): Promise<{ path: string; diagnostics: string[] } | { error: string }> {
	try {
		const directory = join(snapshot.projectPath, ".sdd", "grills");
		await mkdir(directory, { recursive: true });
		let existing: string | null = null;
		try {
			existing = await readFile(join(directory, handoffFileNames(snapshot).primary), "utf8");
		} catch {
			existing = null;
		}
		const plan = planGrillHandoff(snapshot, existing);
		const path = join(directory, plan.fileName);
		await writeFileAtomic(path, plan.content);
		return { path, diagnostics: plan.diagnostics };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function repoHandoffNote(outcome: { path: string; diagnostics: string[] } | { error: string }): string {
	if ("error" in outcome) return `\nRepo handoff could not be written: ${outcome.error}`;
	const diagnostics = outcome.diagnostics.length ? ` (recovered: ${outcome.diagnostics.join(", ")})` : "";
	return `\nRepo handoff: ${outcome.path}${diagnostics}`;
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
	if (
		snapshot.interviewMode !== "fast" &&
		snapshot.interviewMode !== "rounds" &&
		snapshot.interviewMode !== "adaptive"
	) {
		snapshot.interviewMode = "unselected";
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

function repositoryFromRemote(remote: string): string | null {
	const match = /github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(remote.trim());
	return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : null;
}

async function projectRepository(pi: ExtensionAPI, projectPath: string): Promise<string> {
	const result = await pi.exec("git", ["config", "--get", "remote.origin.url"], {
		cwd: projectPath,
		timeout: 5_000,
	});
	return result.code === 0
		? repositoryFromRemote(result.stdout) ?? `local/${basename(projectPath)}`
		: `local/${basename(projectPath)}`;
}

function isInside(parent: string, candidate: string): boolean {
	const fromParent = relative(parent, candidate);
	return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function confinedSpecPath(projectPath: string, requestedPath: string): string {
	const cleaned = requestedPath.trim().replace(/^@/, "");
	if (!cleaned) throw new Error("Local destination path is required");
	const directory = resolve(projectPath, ".sdd", "specs");
	const candidate = isAbsolute(cleaned) ? resolve(cleaned) : resolve(projectPath, cleaned);
	if (!isInside(directory, candidate) || dirname(candidate) !== directory || !candidate.endsWith(".md")) {
		throw new Error(`Local spec destination must be one Markdown file directly under ${directory}`);
	}
	return candidate;
}

interface IssueArchiveParts {
	normative: string;
	original: string;
}

function issueArchiveParts(markdown: string): IssueArchiveParts | null {
	const normalized = markdown.replace(/\r\n?/g, "\n");
	const match = /\n[ \t\n]*<details><summary>Body original<\/summary>\n\n([\s\S]*)\n\n<\/details>[ \t\n]*$/.exec(normalized);
	if (!match || match.index === undefined) return null;
	return {
		normative: `${normalized.slice(0, match.index).replace(/\n*$/, "")}\n`,
		original: match[1] ?? "",
	};
}

function stripIssueTransportArchive(markdown: string): string {
	return issueArchiveParts(markdown)?.normative ?? markdown;
}

function issueBodyForPublication(markdown: string, currentBody: string, repository: string): string {
	if (currentBody === SDD_SPEC_ISSUE_STAGING_BODY) return markdown;
	if (normalizeNormativeSpecContent(currentBody, repository, "issue")
		=== normalizeNormativeSpecContent(markdown, repository, "local")) {
		return currentBody;
	}
	const original = issueArchiveParts(currentBody)?.original
		?? currentBody.replace(/\r\n?/g, "\n").replace(/\n*$/, "");
	if (!original) return markdown;
	return `${markdown.replace(/\r\n?/g, "\n").replace(/\n*$/, "")}\n\n<details><summary>Body original</summary>\n\n${original}\n\n</details>\n`;
}

async function ensureSafeSpecDestination(projectPath: string, path: string): Promise<void> {
	const projectCanonical = await realpath(projectPath);
	const directory = resolve(projectPath, ".sdd", "specs");
	await mkdir(directory, { recursive: true });
	const directoryCanonical = await realpath(directory);
	if (!isInside(projectCanonical, directoryCanonical)) {
		throw new Error("Refusing a .sdd/specs directory that resolves outside the project");
	}
	try {
		const destinationCanonical = await realpath(path);
		if (!isInside(directoryCanonical, destinationCanonical)) {
			throw new Error("Refusing a local spec symlink that resolves outside .sdd/specs");
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") throw error;
	}
}

async function withTemporaryBody<T>(body: string, operation: (path: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), "sdd-spec-publication-"));
	const path = join(directory, "body.md");
	try {
		await writeFile(path, body, "utf8");
		return await operation(path);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function runGh(
	pi: ExtensionAPI,
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	const result = await pi.exec("gh", args, { cwd, timeout: 30_000, signal });
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || `gh exited with code ${result.code}`);
	}
	return result.stdout;
}

async function withLocalMutationQueues<T>(paths: string[], operation: () => Promise<T>): Promise<T> {
	const uniquePaths = [...new Set(paths)].sort();
	async function run(index: number): Promise<T> {
		const path = uniquePaths[index];
		return path === undefined
			? operation()
			: withFileMutationQueue(path, () => run(index + 1));
	}
	return run(0);
}

function compactSnapshot(snapshot: GrillSnapshot): object {
	return {
		id: snapshot.id,
		topic: snapshot.topic,
		projectPath: snapshot.projectPath,
		status: snapshot.status,
		workflowMode: snapshot.workflowMode,
		interviewMode: snapshot.interviewMode,
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
		description: `${snapshot.status} · ${snapshot.workflowMode}/${snapshot.interviewMode} · ${basename(snapshot.projectPath)} · ${snapshot.interactions.length}/~${snapshot.estimate.likely} · ${formatDate(snapshot.updatedAt)} · ${snapshot.id.slice(-8)}`,
	};
}

function inspectionMarkdown(snapshot: GrillSnapshot): string {
	const lines = [
		`# ${snapshot.topic}`,
		"",
		`- **Estado:** ${snapshot.status}`,
		`- **Modo de documentación:** ${snapshot.workflowMode}`,
		`- **Modalidad de entrevista:** ${snapshot.interviewMode}`,
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

function inspectSpecDocument(
	markdown: string,
	path: string,
	project: SpecProject,
): Pick<SpecDocument, "title" | "state" | "format" | "provenance" | "issue" | "diagnostics"> {
	const heading = markdown.match(/^#\s+(?:Spec\s*[—–-]\s*)?(.+?)\s*$/m)?.[1]?.trim();
	const artifact = inspectMarkdownArtifact({
		kind: "markdown",
		id: path,
		expectedType: "spec",
		location: "local",
		path,
		markdown,
	}, { repository: project.repository, projectRoot: project.projectPath });
	const state = artifact.type === "spec" && artifact.format !== "invalid" && artifact.format !== "conflict"
		? artifact.state
		: "unknown";
	return {
		title: heading || basename(path, ".md").replace(/[-_]+/g, " "),
		state,
		format: artifact.format,
		provenance: artifact.provenance,
		issue: artifact.issue,
		diagnostics: artifact.diagnostics,
	};
}

function specMenuItem(spec: SpecDocument): MenuItem<string> {
	const presentation = specMenuPresentation(spec);
	return {
		value: spec.path,
		label: presentation.label,
		description: `${presentation.description} · ${spec.provenance} · ${basename(spec.projectPath)} · ${formatDate(spec.updatedAt)} · ${basename(spec.path)}`,
	};
}

function specInspectionMarkdown(spec: SpecDocument): string {
	const identity = spec.issue ? `${spec.issue.repository}#${spec.issue.number}` : "none";
	const diagnostics = specInspectionDiagnostics(spec);
	return `${spec.markdown.trim()}\n\n---\n\n**Ruta:** \`${spec.path}\`  \n**Normalizado:** ${spec.state} · ${spec.format}/${spec.provenance} · issue ${identity}  \n**Diagnósticos:**\n${diagnostics}`;
}

async function listSpecs(projects: SpecProject[]): Promise<SpecDocument[]> {
	const byRoot = new Map<string, SpecProject>();
	for (const project of projects) byRoot.set(resolve(project.projectPath), { ...project, projectPath: resolve(project.projectPath) });
	const specs = (await Promise.all([...byRoot.values()].map(async (project) => {
		const directory = join(project.projectPath, ".sdd", "specs");
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
				projectPath: project.projectPath,
				...inspectSpecDocument(markdown, path, project),
				updatedAt: fileStat.mtime.toISOString(),
				markdown,
			};
		}));
	}))).flat();

	return specs.sort(compareSpecListEntries);
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

function publishInterviewState(pi: ExtensionAPI, snapshot: GrillSnapshot): void {
	pi.events.emit("grill:interview-state", {
		id: snapshot.id,
		status: snapshot.status,
		interviewMode: snapshot.interviewMode,
	});
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
				const currentSpecProject: SpecProject = {
					projectPath: currentProject,
					repository: await projectRepository(pi, currentProject),
				};
				let effectiveScope: "current-project" | "all" = "current-project";
				let allSpecs: SpecDocument[] | undefined;
				const currentSpecs = await listSpecs([currentSpecProject]);
				const showAllChoice = "🌐 Mostrar specs de todos los proyectos conocidos por Pi…";
				const showProjectChoice = `⌂ Volver a specs de ${basename(currentProject)}`;
				const backChoice = "← Volver a la lista de specs";

				while (true) {
					if (effectiveScope === "all" && allSpecs === undefined) {
						const roots = await knownProjectRoots(pi, currentProject);
						const projects = await Promise.all(roots.map(async (projectPath): Promise<SpecProject> => ({
							projectPath,
							repository: await projectRepository(pi, projectPath),
						})));
						allSpecs = await listSpecs(projects);
					}
					const specs = effectiveScope === "current-project" ? currentSpecs : allSpecs ?? [];
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
					const runChoice = "Ejecutar";
					const actionChoices = isInvalidSpecListEntry(selected)
						? [backChoice, inspectChoice]
						: [backChoice, inspectChoice, runChoice];
					const action = await selectMenu(
						ctx,
						`${selected.title} · ${selected.state}`,
						menuItems(actionChoices),
					);
					if (action === null || action === backChoice) continue;

					if (action === inspectChoice) {
						pi.appendEntry("sdd-spec-inspection", {
							markdown: specInspectionMarkdown(selected),
						});
						return;
					}

					const result = await requestSddRun(pi, selected.path, ctx);
					if (!result.ok && !("originPreserved" in result && !result.originPreserved)) {
						ctx.ui.notify(`No se pudo ejecutar la spec (${result.code}): ${result.message}`, "error");
					}
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
						const transition = await continueWithMaterializedSkill(
							pi,
							"sdd-spec",
							`--from-grill ${selected.id}`,
						);
						if (!transition.ok) ctx.ui.notify(`No se pudo abrir sdd-spec: ${transition.message}`, "error");
						return;
					}

					const timestamp = now();
					const session = action === duplicateChoice
						? {
							...selected,
							id: `${slugify(selected.topic)}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`,
							status: "active" as const,
							interviewMode: "unselected" as const,
							createdAt: timestamp,
							updatedAt: timestamp,
							handoffMarkdown: undefined,
							parentId: selected.id,
							revision: selected.revision + 1,
						}
						: { ...selected, status: "active" as const, interviewMode: "unselected" as const };
					const prepared = await prepareMaterializedSkill(pi, "grill", `--resume ${session.id}`);
					if (!prepared.ok) {
						ctx.ui.notify(`No se pudo retomar grill: ${prepared.message}`, "error");
						return;
					}
					await saveSnapshot(session);
					queueMaterializedSkill(pi, prepared);
					return;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Grills: ${message}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "persist_sdd_spec",
		label: "Persist SDD spec",
		description:
			"Validate, persist, reread, and compare canonical sdd-spec lifecycle mutations. Returns a receipt only after every requested destination passes the parser-backed postcondition. Use only as directed by sdd-spec.",
		parameters: PersistSddSpecParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const requestedRoot = params.projectPath?.trim()
				? resolve(ctx.cwd, params.projectPath.trim())
				: await projectRoot(pi, ctx.cwd);
			const root = await projectRoot(pi, requestedRoot);
			const repository = params.repository.trim();
			const actualRepository = await projectRepository(pi, root);
			if (repository.toLowerCase() !== actualRepository.toLowerCase()) {
				throw new Error(`Repository identity mismatch: expected ${actualRepository}, got ${repository}`);
			}

			const localPaths: string[] = [];
			const documents = params.documents.map((document) => {
				if (document.role === "successor" && document.supersededBy !== undefined) {
					throw new Error(`Successor ${document.id} cannot declare supersededBy`);
				}
				const destinations: SpecPublicationDestination[] = document.destinations.map((destination) => {
					if (destination.kind === "local") {
						if (!destination.path) throw new Error(`Local destination path is required for ${document.id}`);
						const path = confinedSpecPath(root, destination.path);
						localPaths.push(path);
						return { kind: "local", path };
					}
					if (destination.kind === "issue") {
						if (!destination.issueNumber) throw new Error(`issueNumber is required for ${document.id}`);
						return { kind: "issue", issue: { repository, number: destination.issueNumber } };
					}
					if (!destination.title?.trim()) throw new Error(`New issue title is required for ${document.id}`);
					return { kind: "new-issue", repository, title: destination.title.trim() };
				});
				return {
					id: document.id,
					role: document.role,
					markdown: stripIssueTransportArchive(document.markdown),
					expectation: {
						mode: params.mode,
						repository,
						issue: document.issueNumber === undefined
							? null
							: { repository, number: document.issueNumber },
						grill: document.grill?.trim() || null,
						...(document.role === "predecessor" ? { state: "superseded" as const } : {}),
						supersededBy: document.role === "predecessor"
							? document.supersededBy?.trim() || null
							: null,
					},
					destinations,
				};
			});
			const allowedPaths = new Set(localPaths);
			function assertAllowedPath(path: string): void {
				if (!allowedPaths.has(path)) throw new Error(`Unexpected local publication path: ${path}`);
			}
			function assertRepository(issue: IssueRef): void {
				if (issue.repository.toLowerCase() !== repository.toLowerCase()) {
					throw new Error(`Unexpected issue repository: ${issue.repository}`);
				}
			}
			async function readGithubIssue(issue: IssueRef): Promise<string> {
				assertRepository(issue);
				const output = await runGh(
					pi,
					["issue", "view", String(issue.number), "--repo", issue.repository, "--json", "body"],
					root,
					signal,
				);
				const parsed: unknown = JSON.parse(output);
				if (!parsed || typeof parsed !== "object" || typeof (parsed as { body?: unknown }).body !== "string") {
					throw new Error(`gh returned an invalid body for ${issue.repository}#${issue.number}`);
				}
				return (parsed as { body: string }).body;
			}

			const ports: SpecPublicationPorts = {
				async writeLocal(path, markdown) {
					assertAllowedPath(path);
					await ensureSafeSpecDestination(root, path);
					await writeFileAtomic(path, markdown);
				},
				async readLocal(path) {
					assertAllowedPath(path);
					return readFile(path, "utf8");
				},
				async writeIssue(issue, markdown) {
					const currentBody = await readGithubIssue(issue);
					const publicationBody = issueBodyForPublication(markdown, currentBody, repository);
					await withTemporaryBody(publicationBody, async (bodyPath) => {
						await runGh(pi, [
							"issue", "edit", String(issue.number), "--repo", issue.repository, "--body-file", bodyPath,
						], root, signal);
					});
				},
				async readIssue(issue) {
					return readGithubIssue(issue);
				},
				async createIssue(issueRepository, title, stagingBody) {
					if (issueRepository.toLowerCase() !== repository.toLowerCase()) {
						throw new Error(`Unexpected issue repository: ${issueRepository}`);
					}
					const output = await withTemporaryBody(stagingBody, (bodyPath) => runGh(
						pi,
						["issue", "create", "--repo", issueRepository, "--title", title, "--body-file", bodyPath],
						root,
						signal,
					));
					const number = Number(/\/issues\/(\d+)/.exec(output)?.[1]);
					if (!Number.isSafeInteger(number) || number < 1) {
						throw new Error(`Could not resolve the created issue identity from gh output: ${output.trim()}`);
					}
					return { repository: issueRepository, number };
				},
			};

			const result = await withLocalMutationQueues(localPaths, () => persistSpecPublication({ documents }, ports));
			const text = result.ok
				? `Canonical spec publication verified. Receipt:\n${JSON.stringify(result.receipt, null, 2)}`
				: `Canonical spec publication blocked; no receipt was issued.\n${result.diagnostics
					.map(({ documentId, stage, code, message }) => `- ${documentId} · ${stage} · ${code}: ${message}`)
					.join("\n")}${result.createdIssues.length > 0
					? `\nRetained staging issues: ${result.createdIssues.map(({ repository, number }) => `${repository}#${number}`).join(", ")}. Retry them as existing issue destinations; do not create them again.`
					: ""}`;
			return { content: [{ type: "text", text }], details: result };
		},
	});

	pi.registerTool({
		name: "grill_session",
		label: "Grill session",
		description:
			"Create, configure, checkpoint, pause, finalize, or retrieve a persistent grill interview. Persists both documentation workflowMode and answer-collection interviewMode; checkpoints are rejected until interviewMode is selected. Grill sessions survive Pi sessions. Use only as directed by the grill skill.",
		parameters: GrillSessionParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.continueWithSpec && params.action !== "finalize") {
				throw new Error("continueWithSpec is valid only for finalize");
			}
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
					interviewMode: params.interviewMode ?? "unselected",
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
				publishInterviewState(pi, snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Created grill session.", snapshot) }],
					details: { action: "create", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (!params.sessionId) throw new Error(`sessionId is required for ${params.action}`);
			const snapshot = await loadSnapshot(params.sessionId);

			if (params.action === "get") {
				publishInterviewState(pi, snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Loaded grill session.", snapshot) }],
					details: { action: "get", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (snapshot.status === "finalized") {
				throw new Error("Finalized grill sessions are immutable; duplicate it with select_grill_session first");
			}

			if (params.action === "configure") {
				if (!params.workflowMode && !params.interviewMode) {
					throw new Error("configure requires workflowMode and/or interviewMode");
				}
				if (params.workflowMode) snapshot.workflowMode = params.workflowMode;
				if (params.interviewMode) snapshot.interviewMode = params.interviewMode;
				snapshot.status = "active";
				await saveSnapshot(snapshot);
				publishInterviewState(pi, snapshot);
				return {
					content: [{ type: "text", text: snapshotText("Grill session configured.", snapshot) }],
					details: { action: "configure", snapshot, jsonPath: jsonPath(snapshot.id) },
				};
			}

			if (params.action === "checkpoint") {
				if (snapshot.interviewMode === "unselected") {
					throw new Error("Configure grill_session interviewMode before saving interview checkpoints");
				}
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
				publishInterviewState(pi, snapshot);
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
				publishInterviewState(pi, snapshot);
				const pausedHandoff = await writeRepoHandoff(snapshot);
				return {
					content: [{
						type: "text",
						text: `${snapshotText("Grill session paused.", snapshot)}${repoHandoffNote(pausedHandoff)}`,
					}],
					details: {
						action: "pause",
						snapshot,
						jsonPath: jsonPath(snapshot.id),
						repoHandoffPath: "path" in pausedHandoff ? pausedHandoff.path : undefined,
					},
				};
			}

			if (params.action === "finalize") {
				if (params.continueWithSpec && !allowsFinalizeSpecContinuation(snapshot.workflowMode)) {
					throw new Error("domain-modeling finalize cannot continue to sdd-spec before the separate ADR review completes");
				}
				if (!params.handoffMarkdown?.trim()) throw new Error("handoffMarkdown is required for finalize");
				if (params.pendingBranches) snapshot.pendingBranches = params.pendingBranches;
				if (params.sections) snapshot.sections = params.sections;
				if (params.summary !== undefined) snapshot.summary = params.summary;
				snapshot.status = "finalized";
				snapshot.handoffMarkdown = params.handoffMarkdown.trim();
				await writeAtomic(markdownPath(snapshot.id), `${snapshot.handoffMarkdown}\n`);
				await saveSnapshot(snapshot);
				publishInterviewState(pi, snapshot);
				const finalizedHandoff = await writeRepoHandoff(snapshot);
				const continuation = params.continueWithSpec
					? await continueWithMaterializedSkill(
						pi,
						"sdd-spec",
						`--from-grill ${snapshot.id}`,
						{ deliverAs: "followUp" },
					)
					: undefined;
				const continuationNote = continuation
					? continuation.ok
						? "\nNext stage: canonical sdd-spec queued in this session."
						: `\nNext stage could not be materialized: ${continuation.message}`
					: "";
				return {
					content: [{
						type: "text",
						text: `${snapshotText("Grill session finalized.", snapshot)}\nMarkdown: ${markdownPath(snapshot.id)}${repoHandoffNote(finalizedHandoff)}${continuationNote}`,
					}],
					details: {
						action: "finalize",
						snapshot,
						jsonPath: jsonPath(snapshot.id),
						markdownPath: markdownPath(snapshot.id),
						repoHandoffPath: "path" in finalizedHandoff ? finalizedHandoff.path : undefined,
						continuation,
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
				`${theme.fg("success", "✓ ")}${snapshot.topic} · ${snapshot.status} · ${snapshot.workflowMode}/${snapshot.interviewMode} · ${snapshot.interactions.length}/~${snapshot.estimate.likely}${suffix}`,
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
					const transition = await continueWithMaterializedSkill(
						pi,
						"sdd-spec",
						`--from-grill ${selected.id}`,
						{ deliverAs: "followUp" },
					);
					if (!transition.ok) throw new Error(`Could not materialize sdd-spec: ${transition.message}`);
					return {
						content: [{
							type: "text",
							text: `${snapshotText("Selected finalized grill session as SDD source.", selected)}\nCanonical sdd-spec queued in this session.`,
						}],
						details: {
							selected,
							action: "create-sdd-spec",
							jsonPath: jsonPath(selected.id),
							markdownPath: markdownPath(selected.id),
							transition,
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
					const prepared = await prepareMaterializedSkill(pi, "grill", `--resume ${duplicate.id}`);
					if (!prepared.ok) throw new Error(`Could not materialize grill: ${prepared.message}`);
					await saveSnapshot(duplicate);
					const transition = queueMaterializedSkill(pi, prepared, { deliverAs: "followUp" });
					return {
						content: [{ type: "text", text: snapshotText("Duplicated finalized grill session as a new active revision.", duplicate) }],
						details: { selected: duplicate, action: "duplicate", sourceId: selected.id, jsonPath: jsonPath(duplicate.id), transition },
					};
				}

				const resumed = { ...selected, status: "active" as const };
				const prepared = await prepareMaterializedSkill(pi, "grill", `--resume ${resumed.id}`);
				if (!prepared.ok) throw new Error(`Could not materialize grill: ${prepared.message}`);
				await saveSnapshot(resumed);
				const transition = queueMaterializedSkill(pi, prepared, { deliverAs: "followUp" });
				return {
					content: [{ type: "text", text: snapshotText("Resumed grill session in this conversation.", resumed) }],
					details: { selected: resumed, action: "resume", jsonPath: jsonPath(resumed.id), transition },
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
