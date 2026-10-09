import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
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
	isSddArtifactPath,
	listSddArtifacts,
	resolveSddArtifactDirs,
	type SddArtifactDirs,
} from "../lib/sdd-paths.ts";
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
	DEFAULT_GRILL_QUESTION_LIMIT,
	GRILL_SNAPSHOT_VERSION,
	filterGrillInventory,
	inventoryActions,
	isGrillHandoffCandidatePath,
	normalizeGrillSnapshot,
	reconcileGrillInventory,
	type GrillDecision,
	type GrillInventory,
	type GrillInventoryAction,
	type GrillInventoryEntry,
	type GrillSnapshot,
	type GrillStatus,
	type HandoffFileCandidate,
	type SnapshotFileCandidate,
} from "./inventory.ts";
import { writeFileAtomic } from "./atomic-write.ts";
import {
	handoffFileNames,
	planGrillHandoff,
	slugify,
} from "./logic.ts";
import {
	buildImportedDuplicate,
	buildImportedResume,
	persistImportedSnapshots,
	snapshotStorageStem,
} from "./runtime-import.ts";
import {
	compareSpecListEntries,
	isInvalidSpecListEntry,
	specInspectionDiagnostics,
	specMenuPresentation,
} from "./spec-list.ts";

const AGENT_DIR = join(homedir(), ".pi", "agent");
const STORE_DIR = join(AGENT_DIR, "grill-sessions");
const SESSIONS_DIR = join(AGENT_DIR, "sessions");
const FORMAT_VERSION = GRILL_SNAPSHOT_VERSION;
const DEFAULT_QUESTION_LIMIT = DEFAULT_GRILL_QUESTION_LIMIT;

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
	return join(STORE_DIR, `${snapshotStorageStem(id)}.json`);
}

function markdownPath(id: string): string {
	return join(STORE_DIR, `${snapshotStorageStem(id)}.md`);
}

async function ensureStore(): Promise<void> {
	await mkdir(STORE_DIR, { recursive: true });
}

async function writeAtomic(path: string, content: string): Promise<void> {
	await ensureStore();
	await writeFileAtomic(path, content);
}

async function fileExists(path: string): Promise<boolean> {
	return stat(path).then((entry) => entry.isFile(), () => false);
}

// Escribe (o actualiza) el handoff interoperable en `<git-common-dir>/sdd/grills/`
// del proyecto de la sesion (spec #84, CA-10): fuera del working tree y
// compartido por todos sus worktrees; fuera de un repo git, en `.sdd/grills/`.
// El snapshot JSON global sigue siendo la fuente de verdad runtime; este
// archivo es el artefacto SDD que consumen los otros harnesses y el handoff
// materializado de sdd-spec --from-grill. Nunca rompe la accion que lo
// invoca: ante un proyecto inexistente devuelve el error como texto.
async function writeRepoHandoff(
	snapshot: GrillSnapshot,
): Promise<{ path: string; diagnostics: string[] } | { error: string }> {
	try {
		const dirs = await resolveSddArtifactDirs(snapshot.projectPath, "grills");
		await mkdir(dirs.local, { recursive: true });
		const names = handoffFileNames(snapshot);
		let existing: string | null = null;
		try {
			existing = await readFile(join(dirs.local, names.primary), "utf8");
		} catch {
			existing = null;
		}
		const plan = planGrillHandoff(snapshot, existing);
		// Ante el mismo nombre gana el trackeado: una revisión local con el nombre
		// de un handoff ya commiteado quedaría oculta, así que usa el fallback.
		const shadowed = dirs.local !== dirs.tracked
			&& plan.fileName !== names.fallback
			&& await fileExists(join(dirs.tracked, plan.fileName));
		const path = join(dirs.local, shadowed ? names.fallback : plan.fileName);
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

async function saveSnapshot(snapshot: GrillSnapshot): Promise<void> {
	snapshot.updatedAt = now();
	await writeAtomic(jsonPath(snapshot.id), `${JSON.stringify(snapshot, null, 2)}\n`);
}

function requireNormalizedSnapshot(value: unknown, expectedId?: string): GrillSnapshot {
	const normalized = normalizeGrillSnapshot(value);
	if (!normalized.snapshot) {
		throw new Error(normalized.diagnostics.map(({ message }) => message).join("; ") || "Invalid grill snapshot");
	}
	if (expectedId !== undefined && normalized.snapshot.id !== expectedId) {
		throw new Error(`Snapshot identity mismatch: expected ${expectedId}, got ${normalized.snapshot.id}`);
	}
	return normalized.snapshot;
}

async function loadSnapshot(id: string): Promise<GrillSnapshot> {
	if (!id.trim()) throw new Error("Invalid grill session id");
	try {
		return requireNormalizedSnapshot(JSON.parse(await readFile(jsonPath(id), "utf8")), id);
	} catch (error) {
		const wrapped = new Error(`Could not load grill session ${id}: ${error instanceof Error ? error.message : String(error)}`);
		const code = (error as NodeJS.ErrnoException | null)?.code;
		if (code !== undefined) (wrapped as NodeJS.ErrnoException).code = code;
		throw wrapped;
	}
}

async function readSnapshotIfPresent(id: string): Promise<GrillSnapshot | null> {
	try {
		return await loadSnapshot(id);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function writeNewSnapshot(snapshot: GrillSnapshot): Promise<void> {
	await ensureStore();
	const path = jsonPath(snapshot.id);
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
	try {
		await link(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
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

interface ProjectLookup {
	root(cwd: string): Promise<string>;
	repository(projectPath: string): Promise<string>;
}

function createProjectLookup(pi: ExtensionAPI): ProjectLookup {
	const roots = new Map<string, Promise<string>>();
	const repositories = new Map<string, Promise<string>>();
	return {
		root(cwd) {
			const key = resolve(cwd);
			const cached = roots.get(key);
			if (cached) return cached;
			const lookup = projectRoot(pi, key);
			roots.set(key, lookup);
			return lookup;
		},
		repository(projectPath) {
			const key = resolve(projectPath);
			const cached = repositories.get(key);
			if (cached) return cached;
			const lookup = projectRepository(pi, key);
			repositories.set(key, lookup);
			return lookup;
		},
	};
}

function isInside(parent: string, candidate: string): boolean {
	const fromParent = relative(parent, candidate);
	return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

// Destino local de una spec (spec #84, CA-11). Una ruta relativa es la ruta
// lógica `.sdd/specs/<x>.md`: se resuelve primero en el árbol trackeado (si
// ya existe ahí, se actualiza en su lugar) y si no en
// `<git-common-dir>/sdd/specs/`. Una ruta absoluta tiene que caer directamente
// bajo uno de esos dos directorios.
async function confinedSpecPath(projectPath: string, requestedPath: string): Promise<string> {
	const cleaned = requestedPath.trim().replace(/^@/, "");
	if (!cleaned) throw new Error("Local destination path is required");
	const dirs = await resolveSddArtifactDirs(projectPath, "specs");
	const refuse = () => new Error(`Local spec destination must be one Markdown file directly under ${dirs.tracked} or ${dirs.local}`);
	let candidate = resolve(isAbsolute(cleaned) ? cleaned : resolve(projectPath, cleaned));
	if (!isAbsolute(cleaned)) {
		if (dirname(candidate) !== resolve(dirs.tracked)) throw refuse();
		if (resolve(dirs.local) !== resolve(dirs.tracked) && !await fileExists(candidate)) candidate = join(dirs.local, basename(candidate));
	}
	if (!isSddArtifactPath(dirs, candidate) || !candidate.endsWith(".md")) throw refuse();
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
	const dirs = await resolveSddArtifactDirs(projectPath, "specs");
	const directory = dirname(resolve(path));
	if (directory !== resolve(dirs.tracked) && directory !== resolve(dirs.local)) {
		throw new Error("Refusing a spec destination outside .sdd/specs and <git-common-dir>/sdd/specs");
	}
	await mkdir(directory, { recursive: true });
	const directoryCanonical = await realpath(directory);
	if (directory === resolve(dirs.tracked) && directory !== resolve(dirs.local)
		&& !isInside(await realpath(projectPath), directoryCanonical)) {
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
		interviewMode: snapshot.interviewMode,
		sourceIssue: snapshot.sourceIssue,
		progress: `${snapshot.interactions.length} of ~${snapshot.estimate.likely} (limit ${snapshot.questionLimit})`,
		estimate: snapshot.estimate,
		sections: snapshot.sections,
		decisions: snapshot.decisions,
		pendingBranches: snapshot.pendingBranches,
		summary: snapshot.summary,
		handoffMarkdown: snapshot.handoffMarkdown,
		importedHandoff: snapshot.importedHandoff,
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

function inventorySource(entry: GrillInventoryEntry): string {
	if (entry.snapshotPath && entry.handoffPaths.length > 0) return "snapshot + handoff";
	if (entry.snapshotPath) return "snapshot";
	if (entry.handoffPaths.length > 0) return "handoff";
	return "unknown";
}

function inventoryMenuItem(entry: GrillInventoryEntry): MenuItem<string> {
	const identity = entry.grillId ?? basename(entry.snapshotPath ?? entry.handoffPaths[0] ?? entry.key);
	const operationalRoot = entry.projectPath ?? "global";
	const warnings = entry.warnings.length > 0 ? ` · ⚠ ${entry.warnings.length} warning(s)` : "";
	const errors = entry.valid ? "" : ` · BLOCKED (${entry.diagnostics.length})`;
	const icon = entry.valid && entry.state !== "unknown" ? statusIcon(entry.state) : "!";
	return {
		value: entry.key,
		label: `${icon} ${entry.topic} · ${identity} @ ${operationalRoot}`,
		description: `${entry.state} · ${inventorySource(entry)} · authority ${entry.authority ?? "none"}${warnings}${errors}`,
		danger: !entry.valid,
	};
}

function compactInventorySnapshot(snapshot: GrillSnapshot): object {
	const handoffSummary = snapshot.handoffMarkdown === undefined
		? undefined
		: `[${Buffer.byteLength(snapshot.handoffMarkdown, "utf8")} bytes; rendered once below]`;
	const importedHandoff = snapshot.importedHandoff
		? {
			...snapshot.importedHandoff,
			markdown: `[${Buffer.byteLength(snapshot.importedHandoff.markdown, "utf8")} bytes; rendered once below]`,
		}
		: undefined;
	return {
		...compactSnapshot(snapshot),
		handoffMarkdown: handoffSummary,
		importedHandoff,
	};
}

function inventoryInspectionMarkdown(entry: GrillInventoryEntry): string {
	const lines = [
		`# ${entry.topic}`,
		"",
		`- **Estado reconciliado:** ${entry.state}`,
		`- **Identidad:** ${entry.grillId ? `\`${entry.grillId}\`` : "no recuperable"}`,
		`- **Fuente:** ${inventorySource(entry)}`,
		`- **Autoridad:** ${entry.authority ?? "ninguna (fail-closed)"}`,
		`- **Proyecto operativo:** ${entry.projectPath ?? "no atribuible"}`,
		`- **Proyecto histórico:** ${entry.historicalProjectPath ?? "no declarado"}`,
		"",
		"## Procedencias",
		"",
		...(entry.snapshotPath ? [`- Snapshot: \`${entry.snapshotPath}\``] : []),
		...entry.handoffPaths.map((path) => `- Handoff: \`${path}\``),
	];
	if (entry.warnings.length > 0) {
		lines.push("", "## Advertencias", "", ...entry.warnings.map(({ code, message }) => `- **${code}:** ${message}`));
	}
	if (entry.diagnostics.length > 0) {
		lines.push("", "## Diagnósticos bloqueantes", "", ...entry.diagnostics.map(({ code, message }) => `- **${code}:** ${message}`));
	}
	if (entry.snapshot) {
		lines.push("", "## Snapshot runtime", "", "```json", JSON.stringify(compactInventorySnapshot(entry.snapshot), null, 2), "```");
	}
	const handoffMarkdown = entry.handoffMarkdown
		?? entry.snapshot?.handoffMarkdown
		?? entry.snapshot?.importedHandoff?.markdown;
	if (handoffMarkdown !== undefined) lines.push("", "## Handoff disponible", "", handoffMarkdown.trim());
	const output = lines.join("\n");
	const truncated = truncateHead(output, { maxBytes: 45 * 1024, maxLines: 1_900 });
	if (!truncated.truncated) return truncated.content;
	const sources = [entry.snapshotPath, ...entry.handoffPaths].filter((path): path is string => Boolean(path));
	return `${truncated.content}\n\n[Inventory inspection truncated. Full sources: ${sources.join(", ") || "unavailable"}]`;
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

// Lista `.sdd/specs/` de cada proyecto y `<git-common-dir>/sdd/specs/` una
// sola vez por repo (spec #84, CA-11): las specs locales se atribuyen al primer
// proyecto de la lista que comparte ese common-dir, y ante el mismo nombre gana
// la trackeada.
async function listSpecs(projects: SpecProject[]): Promise<SpecDocument[]> {
	const byRoot = new Map<string, SpecProject>();
	for (const project of projects) byRoot.set(resolve(project.projectPath), { ...project, projectPath: resolve(project.projectPath) });
	const seenLocal = new Set<string>();
	const sources: Array<{ path: string; project: SpecProject }> = [];
	for (const project of byRoot.values()) {
		const dirs = await resolveSddArtifactDirs(project.projectPath, "specs");
		const localSeen = seenLocal.has(resolve(dirs.local));
		seenLocal.add(resolve(dirs.local));
		for (const entry of await listSddArtifacts(dirs)) {
			if (entry.location === "local" && localSeen) continue;
			sources.push({ path: entry.path, project });
		}
	}
	const specs = (await Promise.all(sources.map(async ({ path, project }) => {
		{
			const [markdown, fileStat] = await Promise.all([readFile(path, "utf8"), stat(path)]);
			return {
				path,
				projectPath: project.projectPath,
				...inspectSpecDocument(markdown, path, project),
				updatedAt: fileStat.mtime.toISOString(),
				markdown,
			};
		}
	})));

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

async function readSnapshotCandidates(
	pi: ExtensionAPI,
	fallbackRepository: string,
	projects: ProjectLookup = createProjectLookup(pi),
): Promise<SnapshotFileCandidate[]> {
	await ensureStore();
	const files = (await readdir(STORE_DIR, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => entry.name)
		.sort();
	async function repositoryFor(projectPath: string | null): Promise<string> {
		return projectPath ? projects.repository(projectPath) : fallbackRepository;
	}
	const candidates: SnapshotFileCandidate[] = [];
	for (const file of files) {
		const path = join(STORE_DIR, file);
		try {
			const value: unknown = JSON.parse(await readFile(path, "utf8"));
			const normalized = normalizeGrillSnapshot(value);
			candidates.push({
				path,
				repository: await repositoryFor(normalized.recoveredProjectPath),
				value,
			});
		} catch (error) {
			candidates.push({
				path,
				repository: fallbackRepository,
				readError: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return candidates;
}

async function knownProjectRoots(
	pi: ExtensionAPI,
	currentProject: string,
	snapshots?: SnapshotFileCandidate[],
	projects: ProjectLookup = createProjectLookup(pi),
): Promise<string[]> {
	const sessionCwdsPromise = listSessionCwds();
	const effectiveSnapshots = snapshots
		?? await readSnapshotCandidates(pi, await projects.repository(currentProject), projects);
	const sessionCwds = await sessionCwdsPromise;
	const snapshotRoots = effectiveSnapshots.flatMap(({ value }) => {
		const projectPath = normalizeGrillSnapshot(value).recoveredProjectPath;
		return projectPath ? [projectPath] : [];
	});
	const candidates = [...new Set([currentProject, ...snapshotRoots, ...sessionCwds])];
	const roots: string[] = [];
	for (let index = 0; index < candidates.length; index += 4) {
		const batch = candidates.slice(index, index + 4);
		roots.push(...await Promise.all(batch.map(async (path) => {
			try {
				return await projects.root(path);
			} catch {
				return resolve(path);
			}
		})));
	}
	return [...new Set(roots.map((root) => resolve(root)))];
}

async function handoffFiles(directory: string): Promise<string[]> {
	try {
		return (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && isGrillHandoffCandidatePath(entry.name))
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

async function grillDirsByRoot(roots: string[]): Promise<Map<string, SddArtifactDirs>> {
	const dirs = new Map<string, SddArtifactDirs>();
	for (let index = 0; index < roots.length; index += 4) {
		const batch = roots.slice(index, index + 4);
		const resolved = await Promise.all(batch.map((root) => resolveSddArtifactDirs(root, "grills")));
		batch.forEach((root, offset) => dirs.set(root, resolved[offset]!));
	}
	return dirs;
}

function declaredHandoffProject(path: string, markdown: string, repository: string, projectRoot: string): string | null {
	const declared = inspectMarkdownArtifact({
		kind: "markdown",
		id: path,
		expectedType: "grill",
		location: "handoff",
		path,
		markdown,
	}, { repository, projectRoot }).project;
	return declared ? resolve(declared) : null;
}

// Lee `.sdd/grills/` de cada root conocido y `<git-common-dir>/sdd/grills/`
// una sola vez por repo (spec #84, CA-10): un handoff local no se duplica entre
// los worktrees que comparten el common-dir. Su raíz operativa es el campo
// `Proyecto` del handoff cuando nombra uno de esos worktrees; si no, el
// proyecto preferido (el actual) o el primero que comparte el common-dir. Ante
// el mismo nombre gana el handoff trackeado de esa raíz.
async function readHandoffCandidates(
	pi: ExtensionAPI,
	projectRoots: string[],
	projects: ProjectLookup = createProjectLookup(pi),
	preferredRoot?: string,
): Promise<HandoffFileCandidate[]> {
	const candidates: HandoffFileCandidate[] = [];
	const roots = [...new Set(projectRoots.map((root) => resolve(root)))].sort();
	const dirsByRoot = await grillDirsByRoot(roots);
	async function push(path: string, projectPath: string, markdown?: string): Promise<void> {
		const repository = await projects.repository(projectPath);
		try {
			candidates.push({ path, projectPath, repository, markdown: markdown ?? await readFile(path, "utf8") });
		} catch (error) {
			candidates.push({
				path,
				projectPath,
				repository,
				readError: error instanceof Error ? error.message : String(error),
			});
		}
	}
	const sharing = new Map<string, string[]>();
	for (const projectPath of roots) {
		const dirs = dirsByRoot.get(projectPath)!;
		for (const file of await handoffFiles(dirs.tracked)) await push(join(dirs.tracked, file), projectPath);
		if (resolve(dirs.local) !== resolve(dirs.tracked)) sharing.set(resolve(dirs.local), [...sharing.get(resolve(dirs.local)) ?? [], projectPath]);
	}
	const preferred = preferredRoot ? resolve(preferredRoot) : null;
	for (const [localDirectory, sharingRoots] of sharing) {
		const fallbackRoot = preferred && sharingRoots.includes(preferred) ? preferred : sharingRoots[0]!;
		for (const file of await handoffFiles(localDirectory)) {
			const path = join(localDirectory, file);
			let markdown: string | undefined;
			try {
				markdown = await readFile(path, "utf8");
			} catch {
				await push(path, fallbackRoot);
				continue;
			}
			const declared = declaredHandoffProject(path, markdown, await projects.repository(fallbackRoot), fallbackRoot);
			const projectPath = declared && sharingRoots.includes(declared) ? declared : fallbackRoot;
			if (await fileExists(join(dirsByRoot.get(projectPath)!.tracked, file))) continue;
			await push(path, projectPath, markdown);
		}
	}
	return candidates;
}

async function loadGrillInventory(pi: ExtensionAPI, currentProject: string): Promise<GrillInventory> {
	const projects = createProjectLookup(pi);
	const repository = await projects.repository(currentProject);
	const snapshots = await readSnapshotCandidates(pi, repository, projects);
	const roots = await knownProjectRoots(pi, currentProject, snapshots, projects);
	const handoffs = await readHandoffCandidates(pi, roots, projects, currentProject);
	return reconcileGrillInventory({ snapshots, handoffs });
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

const INSPECT_ACTION = "inspect";
const RESUME_ACTION = "resume";
const CREATE_SPEC_ACTION = "create-spec";
const DUPLICATE_ACTION = "duplicate";

const ACTION_LABELS: Record<GrillInventoryAction, string> = {
	[INSPECT_ACTION]: "Inspeccionar",
	[RESUME_ACTION]: "Retomar en esta conversación",
	[CREATE_SPEC_ACTION]: "Crear spec SDD desde el handoff finalizado",
	[DUPLICATE_ACTION]: "Duplicar como nueva revisión y retomar",
};

function actionMenuItems(entry: GrillInventoryEntry, backChoice: string): MenuItem<string>[] {
	return [
		{ value: backChoice, label: backChoice },
		...inventoryActions(entry).map((action) => ({ value: action, label: ACTION_LABELS[action] })),
	];
}

async function rereadHandoffOnly(
	pi: ExtensionAPI,
	entry: GrillInventoryEntry,
	expectedState: "paused" | "finalized",
): Promise<GrillInventoryEntry> {
	if (!entry.valid || entry.snapshot || entry.authority !== "handoff" || entry.state !== expectedState) {
		throw new Error(`A valid handoff-only ${expectedState} entry is required`);
	}
	if (!entry.projectPath || !entry.grillId || entry.handoffPaths.length === 0) {
		throw new Error("The handoff path, operational root, and grill identity are required");
	}
	const dirs = await resolveSddArtifactDirs(entry.projectPath, "grills");
	const requestedPath = resolve(entry.handoffPaths[0]!);
	if (!isSddArtifactPath(dirs, requestedPath) || !isGrillHandoffCandidatePath(requestedPath)) {
		throw new Error(`Handoff source must be one Markdown file directly under ${dirs.tracked} or ${dirs.local}`);
	}
	const directory = dirname(requestedPath);
	const [canonicalDirectory, canonicalPath] = await Promise.all([realpath(directory), realpath(requestedPath)]);
	if (dirname(canonicalPath) !== canonicalDirectory) {
		throw new Error("Refusing a handoff source that resolves outside .sdd/grills");
	}
	const repository = await projectRepository(pi, entry.projectPath);
	const markdown = await readFile(canonicalPath, "utf8");
	const fresh = reconcileGrillInventory({
		snapshots: [],
		handoffs: [{
			path: canonicalPath,
			projectPath: entry.projectPath,
			repository,
			markdown,
		}],
	}).entries[0];
	if (!fresh?.valid || fresh.state !== expectedState || fresh.grillId !== entry.grillId) {
		throw new Error(`Handoff source changed or no longer has safe ${expectedState} grill metadata`);
	}
	return fresh;
}

async function validatedFinalizedHandoffPath(
	pi: ExtensionAPI,
	entry: GrillInventoryEntry,
): Promise<string> {
	const fresh = await rereadHandoffOnly(pi, entry, "finalized");
	return fresh.handoffPaths[0]!;
}

async function persistImportedPlan(plan: ReturnType<typeof buildImportedResume>): Promise<{
	snapshots: GrillSnapshot[];
	createdIds: string[];
}> {
	return persistImportedSnapshots(plan, {
		read: readSnapshotIfPresent,
		writeNew: writeNewSnapshot,
		remove: async (id) => {
			await rm(jsonPath(id), { force: true });
		},
	});
}

async function rollbackSnapshots(ids: string[]): Promise<void> {
	const failures: string[] = [];
	for (const id of [...ids].reverse()) {
		try {
			await rm(jsonPath(id), { force: true });
		} catch (error) {
			failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (failures.length > 0) throw new Error(`snapshot rollback failed: ${failures.join("; ")}`);
}

function queueWithRollback(
	pi: ExtensionAPI,
	prepared: Parameters<typeof queueMaterializedSkill>[1],
	rollback: () => Promise<void>,
): ReturnType<typeof queueMaterializedSkill> | Promise<never> {
	try {
		return queueMaterializedSkill(pi, prepared, { deliverAs: "followUp" });
	} catch (error) {
		return rollback().then(
			() => Promise.reject(error),
			(rollbackError) => Promise.reject(new Error(
				`${error instanceof Error ? error.message : String(error)}; ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
			)),
		);
	}
}

interface GrillActionOutcome {
	action: GrillInventoryAction;
	snapshot?: GrillSnapshot;
	sourceId?: string;
	sourceTarget?: string;
	transition?: ReturnType<typeof queueMaterializedSkill>;
}

async function performGrillAction(
	pi: ExtensionAPI,
	entry: GrillInventoryEntry,
	action: Exclude<GrillInventoryAction, "inspect">,
): Promise<GrillActionOutcome> {
	if (!inventoryActions(entry).includes(action)) {
		throw new Error(`Action ${action} is not available for this grill entry`);
	}
	if (action === CREATE_SPEC_ACTION) {
		const sourceTarget = entry.snapshot
			? entry.snapshot.id
			: await validatedFinalizedHandoffPath(pi, entry);
		const argument = `--from-grill ${JSON.stringify(sourceTarget)}`;
		const continuation = await continueWithMaterializedSkill(
			pi,
			"sdd-spec",
			argument,
			{ deliverAs: "followUp" },
		);
		if (!continuation.ok) throw new Error(`Could not materialize sdd-spec: ${continuation.message}`);
		return { action, sourceTarget, transition: continuation };
	}

	const timestamp = now();
	if (action === RESUME_ACTION) {
		const sourceEntry = entry.snapshot ? entry : await rereadHandoffOnly(pi, entry, "paused");
		const expectedId = sourceEntry.grillId;
		if (!expectedId) throw new Error("A grill identity is required to resume");
		const prepared = await prepareMaterializedSkill(pi, "grill", `--resume ${JSON.stringify(expectedId)}`);
		if (!prepared.ok) throw new Error(`Could not materialize grill: ${prepared.message}`);
		if (entry.snapshot) {
			const resumed = { ...entry.snapshot, status: "active" as const, interviewMode: "unselected" as const };
			await saveSnapshot(resumed);
			const transition = await queueWithRollback(pi, prepared, async () => {
				await writeAtomic(jsonPath(entry.snapshot!.id), `${JSON.stringify(entry.snapshot, null, 2)}\n`);
			});
			return { action, snapshot: resumed, transition };
		}
		const imported = await persistImportedPlan(buildImportedResume(sourceEntry, timestamp));
		const resumed = imported.snapshots[0]!;
		const transition = await queueWithRollback(pi, prepared, () => rollbackSnapshots(imported.createdIds));
		return { action, snapshot: resumed, transition };
	}

	const sourceEntry = entry.snapshot ? entry : await rereadHandoffOnly(pi, entry, "finalized");
	const sourceId = sourceEntry.grillId;
	if (!sourceId) throw new Error("A grill identity is required to duplicate");
	const childId = `${slugify(sourceEntry.topic)}-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;
	const prepared = await prepareMaterializedSkill(pi, "grill", `--resume ${JSON.stringify(childId)}`);
	if (!prepared.ok) throw new Error(`Could not materialize grill: ${prepared.message}`);
	let duplicate: GrillSnapshot;
	if (entry.snapshot) {
		duplicate = {
			...entry.snapshot,
			id: childId,
			status: "active",
			interviewMode: "unselected",
			createdAt: timestamp,
			updatedAt: timestamp,
			handoffMarkdown: undefined,
			parentId: sourceId,
			revision: entry.snapshot.revision + 1,
		};
		await writeNewSnapshot(duplicate);
		duplicate = await loadSnapshot(childId);
		const transition = await queueWithRollback(pi, prepared, () => rollbackSnapshots([childId]));
		return { action, snapshot: duplicate, sourceId, transition };
	}
	const imported = await persistImportedPlan(buildImportedDuplicate(sourceEntry, childId, timestamp));
	duplicate = imported.snapshots[1]!;
	const transition = await queueWithRollback(pi, prepared, () => rollbackSnapshots(imported.createdIds));
	return { action, snapshot: duplicate, sourceId, transition };
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
		description: "Abrir el selector interactivo de sesiones y handoffs de grill",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("El selector de grills requiere modo TUI", "error");
				return;
			}

			await ctx.waitForIdle();

			try {
				const currentProject = await projectRoot(pi, ctx.cwd);
				const inventory = await loadGrillInventory(pi, currentProject);
				let effectiveScope: "current-project" | "all" = "current-project";
				const showAllChoice = "🌐 Ver grills de todos los proyectos conocidos…";
				const showProjectChoice = `⌂ Volver a grills de ${basename(currentProject)}`;
				const backChoice = "← Volver a la lista de sesiones";
				const emptyChoice = "__empty-current-project__";
				const globalErrorsChoice = "__unattributed-errors__";
				const truncatedChoice = "__truncated-results__";

				while (true) {
					const filtered = filterGrillInventory(inventory, {
						currentProject,
						scope: effectiveScope,
						status: "all",
						limit: 100,
					});
					const scopeChoice = effectiveScope === "current-project" ? showAllChoice : showProjectChoice;
					const items: MenuItem<string>[] = filtered.entries.map(inventoryMenuItem);
					if (filtered.entries.length === 0 && effectiveScope === "current-project") {
						items.push({
							value: emptyChoice,
							label: "Este proyecto no tiene grills inventariados.",
							description: "El scope permanece local; elegí Ver todos para ampliarlo.",
						});
					}
					if (effectiveScope === "current-project" && filtered.unattributedErrorCount > 0) {
						items.push({
							value: globalErrorsChoice,
							label: `⚠ Hay ${filtered.unattributedErrorCount} error(es) global(es) sin proyecto atribuible`,
							description: "Disponibles sólo en Ver todos; no se adjudican a este repositorio.",
						});
					}
					if (filtered.truncatedCount > 0) {
						items.push({
							value: truncatedChoice,
							label: `… ${filtered.truncatedCount} grill(s) adicional(es) ocultos por el límite`,
							description: "Refiná el scope o los filtros para verlos.",
						});
					}
					items.push({ value: scopeChoice, label: scopeChoice, description: "Cambia el alcance manualmente" });

					const selectedChoice = await selectMenu(
						ctx,
						`Grill sessions · ${effectiveScope === "current-project" ? basename(currentProject) : "todos los proyectos conocidos"}`,
						items,
						{
							minPrimaryColumnWidth: 44,
							maxPrimaryColumnWidth: 72,
							help: "↑↓ navegar · Enter elegir · Esc cancelar",
						},
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
					if (selectedChoice === emptyChoice || selectedChoice === globalErrorsChoice || selectedChoice === truncatedChoice) continue;

					const selected = filtered.entries.find((entry) => entry.key === selectedChoice);
					if (!selected) throw new Error("No se pudo resolver la sesión seleccionada");
					const action = await selectMenu(
						ctx,
						`${selected.topic} · ${selected.state} · ${inventorySource(selected)}`,
						actionMenuItems(selected, backChoice),
						{ help: "↑↓ navegar · Enter elegir · Esc cancelar" },
					);
					if (action === null || action === backChoice) continue;
					if (action === INSPECT_ACTION) {
						pi.appendEntry("grill-session-inspection", { markdown: inventoryInspectionMarkdown(selected) });
						return;
					}
					const outcome = await performGrillAction(
						pi,
						selected,
						action as Exclude<GrillInventoryAction, "inspect">,
					);
					if (outcome.snapshot) publishInterviewState(pi, outcome.snapshot);
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
			const documents = await Promise.all(params.documents.map(async (document) => {
				if (document.role === "successor" && document.supersededBy !== undefined) {
					throw new Error(`Successor ${document.id} cannot declare supersededBy`);
				}
				const destinations: SpecPublicationDestination[] = await Promise.all(document.destinations.map(async (destination) => {
					if (destination.kind === "local") {
						if (!destination.path) throw new Error(`Local destination path is required for ${document.id}`);
						const path = await confinedSpecPath(root, destination.path);
						localPaths.push(path);
						return { kind: "local", path };
					}
					if (destination.kind === "issue") {
						if (!destination.issueNumber) throw new Error(`issueNumber is required for ${document.id}`);
						return { kind: "issue", issue: { repository, number: destination.issueNumber } };
					}
					if (!destination.title?.trim()) throw new Error(`New issue title is required for ${document.id}`);
					return { kind: "new-issue", repository, title: destination.title.trim() };
				}));
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
			}));
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
			"Create, configure, checkpoint, pause, finalize, or retrieve a persistent grill interview. Persists the answer-collection interviewMode; checkpoints are rejected until interviewMode is selected. Grill sessions survive Pi sessions. Use only as directed by the grill skill.",
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
				if (!params.interviewMode || params.interviewMode === "unselected") {
					throw new Error("configure requires interviewMode: fast, rounds or adaptive");
				}
				snapshot.interviewMode = params.interviewMode;
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
						`--from-grill ${JSON.stringify(snapshot.id)}`,
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
				`${theme.fg("success", "✓ ")}${snapshot.topic} · ${snapshot.status} · ${snapshot.interviewMode} · ${snapshot.interactions.length}/~${snapshot.estimate.likely}${suffix}`,
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
			const requestedScope = params.scope ?? "current-project";
			const limit = params.limit ?? 50;
			const currentProject = await projectRoot(pi, ctx.cwd);
			const inventory = await loadGrillInventory(pi, currentProject);
			let effectiveScope = requestedScope;
			const showAllChoice = "🌐 Ver grills de todos los proyectos conocidos…";
			const showProjectChoice = `⌂ Volver a grills de ${basename(currentProject)}`;
			const backChoice = "← Volver a la lista de sesiones";
			const emptyChoice = "__empty-current-project__";
			const globalErrorsChoice = "__unattributed-errors__";
			const truncatedChoice = "__truncated-results__";

			while (true) {
				const filtered = filterGrillInventory(inventory, {
					currentProject,
					scope: effectiveScope,
					status,
					query: params.query,
					limit,
				});
				const scopeChoice = effectiveScope === "current-project" ? showAllChoice : showProjectChoice;
				const items: MenuItem<string>[] = filtered.entries.map(inventoryMenuItem);
				if (filtered.entries.length === 0 && effectiveScope === "current-project") {
					items.push({
						value: emptyChoice,
						label: "Este proyecto no tiene grills que coincidan con los filtros.",
						description: "El scope permanece local; elegí Ver todos para ampliarlo.",
					});
				}
				if (effectiveScope === "current-project" && filtered.unattributedErrorCount > 0) {
					items.push({
						value: globalErrorsChoice,
						label: `⚠ Hay ${filtered.unattributedErrorCount} error(es) global(es) sin proyecto atribuible`,
						description: "Disponibles sólo en Ver todos; no se adjudican a este repositorio.",
					});
				}
				if (filtered.truncatedCount > 0) {
					items.push({
						value: truncatedChoice,
						label: `… ${filtered.truncatedCount} grill session(s) hidden by limit ${limit}`,
						description: "Refine scope or filters to see the omitted identities.",
					});
				}
				if (requestedScope === "current-project") {
					items.push({ value: scopeChoice, label: scopeChoice, description: "Cambia el alcance manualmente" });
				}

				if (items.length === 0) {
					return {
						content: [{ type: "text", text: "No grill sessions matched the selected filters." }],
						details: { selected: null, action: "none", status, scope: effectiveScope },
					};
				}

				const selectedChoice = await selectMenu(
					ctx,
					`Grill sessions · ${effectiveScope === "current-project" ? basename(currentProject) : "all known projects"}`,
					items,
					{
						minPrimaryColumnWidth: 44,
						maxPrimaryColumnWidth: 72,
						help: "↑↓ navigate · Enter select · Esc cancel",
					},
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
				if (selectedChoice === emptyChoice || selectedChoice === globalErrorsChoice || selectedChoice === truncatedChoice) continue;

				const selected = filtered.entries.find((entry) => entry.key === selectedChoice);
				if (!selected) throw new Error("Could not resolve the selected grill session");

				if ((params.intent ?? "manage") === "spec-source") {
					if (!selected.valid || selected.state !== "finalized") {
						throw new Error("An SDD source must be a valid finalized grill handoff");
					}
					const sourceTarget = selected.snapshot
						? selected.snapshot.id
						: await validatedFinalizedHandoffPath(pi, selected);
					return {
						content: [{ type: "text", text: inventoryInspectionMarkdown(selected) }],
						details: {
							selected: selected.snapshot ?? selected,
							entry: selected,
							action: "spec-source",
							sourceKind: selected.snapshot ? "id" : "path",
							sourceTarget,
							jsonPath: selected.snapshot ? jsonPath(selected.snapshot.id) : undefined,
							markdownPath: selected.handoffPaths[0],
						},
					};
				}

				const selectedAction = await selectMenu(
					ctx,
					`${selected.topic} · ${selected.state} · ${inventorySource(selected)}`,
					actionMenuItems(selected, backChoice),
					{ help: "↑↓ navigate · Enter select · Esc cancel" },
				);
				if (selectedAction === null || selectedAction === backChoice) continue;
				if (selectedAction === INSPECT_ACTION) {
					return {
						content: [{ type: "text", text: inventoryInspectionMarkdown(selected) }],
						details: { selected: selected.snapshot ?? selected, entry: selected, action: "inspect" },
					};
				}

				const outcome = await performGrillAction(
					pi,
					selected,
					selectedAction as Exclude<GrillInventoryAction, "inspect">,
				);
				if (outcome.snapshot) publishInterviewState(pi, outcome.snapshot);
				const text = outcome.snapshot
					? snapshotText(
						outcome.action === DUPLICATE_ACTION
							? "Duplicated finalized grill session as a new active revision."
							: "Resumed grill session in this conversation.",
						outcome.snapshot,
					)
					: `${inventoryInspectionMarkdown(selected)}\n\nCanonical sdd-spec queued in this session.`;
				return {
					content: [{ type: "text", text }],
					details: {
						selected: outcome.snapshot ?? selected.snapshot ?? selected,
						entry: selected,
						action: outcome.action,
						sourceId: outcome.sourceId,
						sourceTarget: outcome.sourceTarget,
						jsonPath: outcome.snapshot ? jsonPath(outcome.snapshot.id) : undefined,
						transition: outcome.transition,
					},
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
