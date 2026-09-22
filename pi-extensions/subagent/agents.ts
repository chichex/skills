// Descubrimiento de agentes para la tool `subagent` (issue #44 CA-2).
//
// Adaptado de examples/extensions/subagent/agents.ts de Pi 0.85.1 con un scope
// nuevo, `package`: los agentes bundleados en pi-extensions/subagent/agents/,
// resueltos relativo a ESTE archivo (import.meta.url) para que funcionen tanto
// bajo un clon del Pi Package como bajo ~/.pi/agent/extensions/subagent/
// copiado por install.sh. `user` (<getAgentDir()>/agents) y `project` (el
// <CONFIG_DIR_NAME>/agents mas cercano hacia arriba desde cwd) son opt-in via
// agentScope; `all` combina los tres con precedencia project > user > package.
//
// Sin imports runtime de Pi: index.ts inyecta getAgentDir, CONFIG_DIR_NAME y
// parseFrontmatter reales, y los tests inyectan directorios temporales.

import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type AgentScope = "package" | "user" | "project" | "all";
export type AgentSource = "package" | "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export interface ParsedFrontmatter<T> {
	frontmatter: T;
	body: string;
}

export type FrontmatterParser = <T extends Record<string, unknown>>(content: string) => ParsedFrontmatter<T>;

export interface AgentDiscoveryDeps {
	packageAgentsDir?: string;
	getAgentDir?: () => string;
	configDirName?: string;
	parseFrontmatter?: FrontmatterParser;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	packageAgentsDir: string;
	userAgentsDir: string;
	projectAgentsDir: string | null;
}

type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
};

export const PACKAGE_AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "agents");

const DEFAULT_CONFIG_DIR_NAME = ".pi";

// Espejo de getAgentDir() de Pi para cuando nadie inyecta el real (tests);
// index.ts siempre pasa el de @earendil-works/pi-coding-agent.
function defaultAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), DEFAULT_CONFIG_DIR_NAME, "agent");
}

function parseScalar(raw: string): unknown {
	if (raw === "") return "";
	if (/^".*"$/s.test(raw)) return raw.slice(1, -1).replace(/\\"/g, '"');
	if (/^'.*'$/s.test(raw)) return raw.slice(1, -1);
	if (raw.startsWith("[") && raw.endsWith("]")) {
		return raw
			.slice(1, -1)
			.split(",")
			.map((item) => parseScalar(item.trim()))
			.filter((item) => item !== "");
	}
	return raw;
}

// Parser minimo de frontmatter (clave: valor por linea, comillas y listas de
// flujo). Alcanza para los agentes bundleados y los tests; en produccion
// index.ts inyecta parseFrontmatter de Pi, que corre un parser YAML real.
export function parseAgentFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { frontmatter: {} as T, body: content };
	const frontmatter: Record<string, unknown> = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const entry = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (!entry) continue;
		frontmatter[entry[1]!] = parseScalar((entry[2] ?? "").trim());
	}
	return { frontmatter: frontmatter as T, body: match[2] ?? "" };
}

// `tools: read, bash` y `tools: [read, bash]` son ambas YAML validas y ambas
// estan en uso; cualquier otra forma no rompe el descubrimiento.
function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((tool): tool is string => typeof tool === "string")
		.map((tool) => tool.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: AgentSource, parse: FrontmatterParser): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!existsSync(dir)) return agents;

	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const filePath = join(dir, entry.name);
		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}
		const { frontmatter, body } = parse<AgentFrontmatter>(content);
		// Un .md sin name o description string se ignora sin descartar los demas.
		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;
		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			source,
			filePath,
		});
	}
	return agents;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string, configDirName: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = join(currentDir, configDirName, "agents");
		if (isDirectory(candidate)) return candidate;
		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope, deps: AgentDiscoveryDeps = {}): AgentDiscoveryResult {
	const packageAgentsDir = deps.packageAgentsDir ?? PACKAGE_AGENTS_DIR;
	const userAgentsDir = join((deps.getAgentDir ?? defaultAgentDir)(), "agents");
	const configDirName = deps.configDirName ?? DEFAULT_CONFIG_DIR_NAME;
	const parse = deps.parseFrontmatter ?? parseAgentFrontmatter;
	const projectAgentsDir = findNearestProjectAgentsDir(cwd, configDirName);

	// Insercion en orden de precedencia creciente: project pisa a user, que
	// pisa a package.
	const agentMap = new Map<string, AgentConfig>();
	if (scope === "package" || scope === "all") {
		for (const agent of loadAgentsFromDir(packageAgentsDir, "package", parse)) agentMap.set(agent.name, agent);
	}
	if (scope === "user" || scope === "all") {
		for (const agent of loadAgentsFromDir(userAgentsDir, "user", parse)) agentMap.set(agent.name, agent);
	}
	if ((scope === "project" || scope === "all") && projectAgentsDir) {
		for (const agent of loadAgentsFromDir(projectAgentsDir, "project", parse)) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), packageAgentsDir, userAgentsDir, projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining: agents.length - listed.length,
	};
}
