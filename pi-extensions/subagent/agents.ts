// Descubrimiento de agentes para la tool `subagent` (issue #44 CA-2).
// STUB: firmas sin comportamiento, para que los tests fallen por assert.

import { join } from "node:path";
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

export const PACKAGE_AGENTS_DIR = join(fileURLToPath(new URL("./", import.meta.url)), "agents");

export function parseAgentFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> {
	return { frontmatter: {} as T, body: content };
}

export function discoverAgents(_cwd: string, _scope: AgentScope, deps: AgentDiscoveryDeps = {}): AgentDiscoveryResult {
	return {
		agents: [],
		packageAgentsDir: deps.packageAgentsDir ?? PACKAGE_AGENTS_DIR,
		userAgentsDir: "",
		projectAgentsDir: null,
	};
}

export function formatAgentList(_agents: AgentConfig[], _maxItems: number): { text: string; remaining: number } {
	return { text: "", remaining: 0 };
}
