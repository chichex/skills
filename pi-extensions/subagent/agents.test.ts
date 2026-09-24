import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { discoverAgents, formatAgentList, PACKAGE_AGENTS_DIR, parseAgentFrontmatter } from "./agents.ts";

// Issue #44 CA-2: descubrimiento de agentes por scope. `package` se resuelve
// relativo al archivo de la extension (import.meta.url), `user` a
// <getAgentDir()>/agents, `project` al <configDirName>/agents mas cercano hacia
// arriba desde cwd, y `all` combina los tres con precedencia project > user >
// package. Un .md invalido se ignora sin descartar los demas.

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

function agentMarkdown(name: string, extra = ""): string {
	return `---\nname: ${name}\ndescription: "Agente ${name}"\n${extra}---\n\nSos ${name}.\n`;
}

interface Fixture {
	root: string;
	packageAgentsDir: string;
	agentDir: string;
	projectRoot: string;
	cwd: string;
}

async function fixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "chichex-subagent-agents-"));
	const packageAgentsDir = join(root, "package", "agents");
	const agentDir = join(root, "pi-agent");
	const projectRoot = join(root, "project");
	const cwd = join(projectRoot, "src", "deep");
	await mkdir(packageAgentsDir, { recursive: true });
	await mkdir(join(agentDir, "agents"), { recursive: true });
	await mkdir(join(projectRoot, ".pi", "agents"), { recursive: true });
	await mkdir(cwd, { recursive: true });
	await writeFile(join(packageAgentsDir, "alpha.md"), agentMarkdown("alpha"));
	await writeFile(join(packageAgentsDir, "beta.md"), agentMarkdown("beta"));
	await writeFile(join(agentDir, "agents", "beta.md"), agentMarkdown("beta", "tools: read, bash\n"));
	await writeFile(join(agentDir, "agents", "gamma.md"), agentMarkdown("gamma"));
	await writeFile(join(projectRoot, ".pi", "agents", "gamma.md"), agentMarkdown("gamma", "model: openai/gpt-x\n"));
	await writeFile(join(projectRoot, ".pi", "agents", "delta.md"), agentMarkdown("delta", "tools: [grep, find]\n"));
	return { root, packageAgentsDir, agentDir, projectRoot, cwd };
}

function deps(fx: Fixture) {
	return { packageAgentsDir: fx.packageAgentsDir, getAgentDir: () => fx.agentDir, configDirName: ".pi" };
}

function names(agents: Array<{ name: string; source: string }>): string[] {
	return agents.map((agent) => `${agent.name}(${agent.source})`).sort();
}

test("CA-2: `package` es el default y se resuelve relativo a la extension, con los tres agentes bundleados", () => {
	assert.equal(PACKAGE_AGENTS_DIR, join(REPO_ROOT, "pi-extensions", "subagent", "agents"));
	const result = discoverAgents(REPO_ROOT, "package", {});
	assert.equal(result.packageAgentsDir, PACKAGE_AGENTS_DIR);
	assert.deepEqual(names(result.agents), ["implementer(package)", "reviewer(package)", "scout(package)"]);
	for (const agent of result.agents) {
		assert.equal(agent.filePath, join(PACKAGE_AGENTS_DIR, `${agent.name}.md`));
		assert.ok(agent.systemPrompt.trim().length > 0, `${agent.name}: body no vacio`);
		assert.equal(agent.model, undefined, `${agent.name}: sin model (hereda el de la sesion)`);
	}
});

test("CA-2: cada scope lee solo su directorio y `all` aplica precedencia project > user > package", async () => {
	const fx = await fixture();
	try {
		const pkg = discoverAgents(fx.cwd, "package", deps(fx));
		assert.deepEqual(names(pkg.agents), ["alpha(package)", "beta(package)"]);

		const user = discoverAgents(fx.cwd, "user", deps(fx));
		assert.deepEqual(names(user.agents), ["beta(user)", "gamma(user)"]);
		assert.equal(user.userAgentsDir, join(fx.agentDir, "agents"));

		const project = discoverAgents(fx.cwd, "project", deps(fx));
		assert.deepEqual(names(project.agents), ["delta(project)", "gamma(project)"]);
		assert.equal(project.projectAgentsDir, join(fx.projectRoot, ".pi", "agents"), "el .pi/agents mas cercano hacia arriba");

		const all = discoverAgents(fx.cwd, "all", deps(fx));
		assert.deepEqual(names(all.agents), ["alpha(package)", "beta(user)", "delta(project)", "gamma(project)"]);
		const gamma = all.agents.find((agent) => agent.name === "gamma");
		assert.equal(gamma?.model, "openai/gpt-x", "gana la definicion del proyecto");
		const beta = all.agents.find((agent) => agent.name === "beta");
		assert.deepEqual(beta?.tools, ["read", "bash"], "gana la definicion del usuario sobre la del package");
		const delta = all.agents.find((agent) => agent.name === "delta");
		assert.deepEqual(delta?.tools, ["grep", "find"], "tools acepta la forma de lista YAML");
	} finally {
		await rm(fx.root, { recursive: true, force: true });
	}
});

test("CA-2: sin .pi/agents hacia arriba, `project` esta vacio y `all` no lo necesita; configDirName es inyectable", async () => {
	const fx = await fixture();
	try {
		const elsewhere = join(fx.root, "elsewhere");
		await mkdir(elsewhere, { recursive: true });
		const project = discoverAgents(elsewhere, "project", deps(fx));
		assert.equal(project.projectAgentsDir, null);
		assert.deepEqual(project.agents, []);
		const all = discoverAgents(elsewhere, "all", deps(fx));
		assert.deepEqual(names(all.agents), ["alpha(package)", "beta(user)", "gamma(user)"]);

		// Distribuciones rebrandeadas usan otro CONFIG_DIR_NAME.
		await mkdir(join(fx.projectRoot, ".otro", "agents"), { recursive: true });
		await writeFile(join(fx.projectRoot, ".otro", "agents", "omega.md"), agentMarkdown("omega"));
		const rebranded = discoverAgents(fx.cwd, "project", { ...deps(fx), configDirName: ".otro" });
		assert.deepEqual(names(rebranded.agents), ["omega(project)"]);
	} finally {
		await rm(fx.root, { recursive: true, force: true });
	}
});

test("CA-2: un .md sin name o description string se ignora sin descartar los demas", async () => {
	const fx = await fixture();
	try {
		await writeFile(join(fx.packageAgentsDir, "sin-name.md"), '---\ndescription: "x"\n---\nBody.\n');
		await writeFile(join(fx.packageAgentsDir, "sin-description.md"), "---\nname: sin-description\n---\nBody.\n");
		await writeFile(join(fx.packageAgentsDir, "description-lista.md"), "---\nname: lista\ndescription: [a, b]\n---\nBody.\n");
		await writeFile(join(fx.packageAgentsDir, "sin-frontmatter.md"), "Solo prosa.\n");
		await writeFile(join(fx.packageAgentsDir, "README.txt"), "no es .md\n");
		const result = discoverAgents(fx.cwd, "package", deps(fx));
		assert.deepEqual(names(result.agents), ["alpha(package)", "beta(package)"]);
	} finally {
		await rm(fx.root, { recursive: true, force: true });
	}
});

test("CA-2: el parser de frontmatter es inyectable (index.ts inyecta el de Pi) y el default entiende strings, comillas y listas", () => {
	const parsed = parseAgentFrontmatter('---\nname: x\ndescription: "Con: dos puntos"\ntools: read, bash\nmodel: a/b\n---\n\nBody\n');
	assert.deepEqual(parsed.frontmatter, { name: "x", description: "Con: dos puntos", tools: "read, bash", model: "a/b" });
	assert.equal(parsed.body.trim(), "Body");
	const list = parseAgentFrontmatter("---\nname: y\ndescription: 'simple'\ntools: [read, grep]\n---\n");
	assert.deepEqual(list.frontmatter, { name: "y", description: "simple", tools: ["read", "grep"] });
	assert.deepEqual(parseAgentFrontmatter("sin frontmatter"), { frontmatter: {}, body: "sin frontmatter" });
});

test("CA-2: un parser inyectado reemplaza al default", async () => {
	const fx = await fixture();
	try {
		const calls: string[] = [];
		const result = discoverAgents(fx.cwd, "package", {
			...deps(fx),
			parseFrontmatter: (content: string) => {
				calls.push(content);
				return { frontmatter: { name: "inyectado", description: "d" }, body: "b" };
			},
		});
		assert.equal(calls.length, 2, "un parseo por .md del package");
		assert.deepEqual(names(result.agents), ["inyectado(package)"]);
	} finally {
		await rm(fx.root, { recursive: true, force: true });
	}
});

test("formatAgentList resume nombre, fuente y description con tope", () => {
	const agents = [
		{ name: "a", description: "uno", source: "package" as const, systemPrompt: "", filePath: "/a.md" },
		{ name: "b", description: "dos", source: "user" as const, systemPrompt: "", filePath: "/b.md" },
	];
	assert.deepEqual(formatAgentList(agents, 1), { text: "a (package): uno", remaining: 1 });
	assert.deepEqual(formatAgentList([], 5), { text: "none", remaining: 0 });
});
