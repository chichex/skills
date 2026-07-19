import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	RouterMachine,
	buildSkillPathMap,
	classifyAssistantError,
	findSkillForRead,
	formatDiagnostics,
	formatStatus,
	modelKey,
	parseExecutionProfile,
	parseExpandedSkillBlock,
	parseSkillInvocation,
	sanitizeAuditEvent,
	validateRouterConfig,
	type AssistantFailure,
	type CatalogModel,
	type ReplayPayload,
	type RouterConfig,
	type RouterSnapshot,
} from "./logic.ts";

const CONFIG_PATH = new URL("./config.json", import.meta.url);

/**
 * Source repo root for the layout integration tests (extension + skills + READMEs).
 * Found by walking up from this file looking for the repo markers. Undefined when
 * running from the installed copy (~/.pi/agent/extensions/...), which only ships
 * the extension files — there the layout tests skip instead of failing with ENOENT.
 */
const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function findRepoRoot(startDir: string): string | undefined {
	let dir = startDir;
	for (let depth = 0; depth < 6; depth++) {
		if (
			existsSync(join(dir, "pi-extensions/skill-model-router/index.ts"))
			&& existsSync(join(dir, "pi"))
			&& existsSync(join(dir, "README.md"))
		) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
	return undefined;
}

function read(relativePath: string): string {
	if (!REPO_ROOT) throw new Error(`source repo root not found for ${relativePath}`);
	return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

const SKIP_REASON = "source repo layout not found (running from the installed extension copy)";

function loadConfig(): RouterConfig {
	return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as RouterConfig;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function catalogModel(
	provider: string,
	id: string,
	contextWindow: number,
	input: Array<"text" | "image"> = ["text", "image"],
	hasCredentials = true,
): CatalogModel {
	return { provider, id, contextWindow, input, thinkingLevels: THINKING_LEVELS, hasCredentials };
}

const CATALOG: CatalogModel[] = [
	catalogModel("openai-codex", "gpt-5.6-sol", 372_000),
	catalogModel("openai-codex", "gpt-5.6-terra", 372_000),
	catalogModel("openai-codex", "gpt-5.6-luna", 372_000),
	catalogModel("kimi-coding", "k3", 1_048_576),
	catalogModel("opencode-go", "glm-5.2", 1_000_000, ["text"]),
	catalogModel("opencode-go", "kimi-k3", 1_048_576),
	catalogModel("opencode-go", "qwen3.7-max", 1_000_000, ["text"]),
	catalogModel("anthropic", "original", 1_000_000),
];

const ENABLED_MODELS = CATALOG.slice(0, 7).map(modelKey);

function validated(config = loadConfig(), catalog = CATALOG, enabledModels = ENABLED_MODELS) {
	const result = validateRouterConfig(config, catalog, enabledModels);
	assert.deepEqual(result.errors, []);
	return result;
}

function snapshot(overrides: Partial<RouterSnapshot> = {}): RouterSnapshot {
	return {
		model: { provider: "anthropic", id: "original" },
		thinkingLevel: "medium",
		contextTokens: 10_000,
		hasImages: false,
		...overrides,
	};
}

function failure(errorMessage: string, stopReason: AssistantFailure["stopReason"] = "error"): AssistantFailure {
	return {
		role: "assistant",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		stopReason,
		errorMessage,
		usage: { input: 1_000, cacheRead: 0, output: 0 },
	};
}

test("config.json is the canonical approved matrix and keeps provider/id separate", () => {
	const config = loadConfig();
	assert.equal(config.version, 1);
	assert.equal(config.reserveTokens, 32_768);
	assert.deepEqual(
		config.preselectedModels.map(modelKey),
		[
			"openai-codex/gpt-5.6-sol",
			"openai-codex/gpt-5.6-terra",
			"openai-codex/gpt-5.6-luna",
			"kimi-coding/k3",
			"opencode-go/glm-5.2",
			"opencode-go/kimi-k3",
			"opencode-go/qwen3.7-max",
		],
	);
	assert.deepEqual(config.profiles.critical, {
		priority: 100,
		candidates: [
			{ provider: "openai-codex", id: "gpt-5.6-sol", thinkingLevel: "max" },
			{ provider: "kimi-coding", id: "k3", thinkingLevel: "max" },
			{ provider: "opencode-go", id: "qwen3.7-max", thinkingLevel: "high" },
		],
	});
	assert.deepEqual(config.profiles.discovery.candidates.map(modelKey), [
		"kimi-coding/k3",
		"openai-codex/gpt-5.6-sol",
	]);
	assert.deepEqual(config.profiles.standard.candidates.map(modelKey), [
		"openai-codex/gpt-5.6-terra",
		"kimi-coding/k3",
	]);
	assert.deepEqual(config.profiles["safe-ops"].candidates.map(modelKey), [
		"openai-codex/gpt-5.6-terra",
		"kimi-coding/k3",
		"opencode-go/glm-5.2",
	]);
	assert.deepEqual(config.profiles.light.candidates.map(modelKey), [
		"opencode-go/qwen3.7-max",
		"openai-codex/gpt-5.6-terra",
		"kimi-coding/k3",
	]);
	assert.deepEqual(config.profiles.utility.candidates.map(modelKey), [
		"openai-codex/gpt-5.6-luna",
		"opencode-go/glm-5.2",
	]);
	assert.equal(
		Object.values(config.profiles).some((profile) =>
			profile.candidates.some((candidate) => modelKey(candidate) === "opencode-go/kimi-k3"),
		),
		false,
	);
	assert.deepEqual(config.skills["domain-modeling"], {
		policy: "inherit",
		standaloneProfile: "standard",
	});
	assert.deepEqual(config.skills["github-issue-selector"], { policy: "inherit" });
});

test("configuration validation rejects foreign models/profiles and skips unusable candidates", () => {
	const invalid = structuredClone(loadConfig());
	invalid.profiles.critical.candidates[0] = {
		provider: "other",
		id: "not-preselected",
		thinkingLevel: "max",
	};
	invalid.skills["code-review"] = { policy: "route", profile: "missing" };
	const invalidResult = validateRouterConfig(invalid, CATALOG, ENABLED_MODELS);
	assert.match(invalidResult.errors.join("\n"), /not preselected/i);
	assert.match(invalidResult.errors.join("\n"), /unknown profile/i);

	const unavailableCatalog = CATALOG.map((model) =>
		modelKey(model) === "kimi-coding/k3" ? { ...model, hasCredentials: false } : model,
	).filter((model) => modelKey(model) !== "openai-codex/gpt-5.6-sol");
	const result = validateRouterConfig(loadConfig(), unavailableCatalog, [
		...ENABLED_MODELS.filter((key) => key !== "opencode-go/qwen3.7-max"),
	]);
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.usableProfiles.critical.map(modelKey), []);
	assert.match(result.warnings.join("\n"), /not found.*gpt-5\.6-sol/i);
	assert.match(result.warnings.join("\n"), /credentials.*kimi-coding\/k3/i);
	assert.match(result.warnings.join("\n"), /enabledModels.*qwen3\.7-max/i);
});

test("explicit and inline invocations resolve without depending on extension order", () => {
	const known = new Set(["sdd-run", "grill"]);
	assert.deepEqual(parseSkillInvocation("/skill:sdd-run spec.md", known), {
		skill: "sdd-run",
		args: "spec.md",
		promotedText: "/skill:sdd-run spec.md",
	});
	assert.deepEqual(parseSkillInvocation("implement this /skill:sdd-run", known), {
		skill: "sdd-run",
		args: "implement this",
		promotedText: "/skill:sdd-run implement this",
	});
	assert.equal(parseSkillInvocation("/skill:not-installed x", known), undefined);
	assert.equal(parseSkillInvocation("plain text", known), undefined);
});

test("expanded blocks retain the skill and user arguments", () => {
	const text = '<skill name="sdd-run" location="/skills/sdd-run/SKILL.md">\nbody\n</skill>\n\n--assume spec.md';
	assert.deepEqual(parseExpandedSkillBlock(text), { skill: "sdd-run", args: "--assume spec.md" });
	assert.equal(parseExpandedSkillBlock("<skill-ish>"), undefined);
});

test("canonical skill paths match exact SKILL.md reads, including symlinks", () => {
	const dir = mkdtempSync(join(tmpdir(), "skill-router-"));
	const realDir = join(dir, "real", "demo");
	mkdirSync(realDir, { recursive: true });
	const skillPath = join(realDir, "SKILL.md");
	writeFileSync(skillPath, "# demo\n");
	const linkedRoot = join(dir, "linked");
	symlinkSync(join(dir, "real"), linkedRoot);
	const linkedPath = join(linkedRoot, "demo", "SKILL.md");
	const map = buildSkillPathMap([
		{ name: "skill:demo", source: "skill", path: linkedPath },
	], dir);
	assert.equal(findSkillForRead(skillPath, dir, map), "demo");
	assert.equal(findSkillForRead("@real/demo/SKILL.md", dir, map), "demo");
	assert.equal(findSkillForRead(`${skillPath}.bak`, dir, map), undefined);
	assert.equal(findSkillForRead(join(dir, "real", "other", "SKILL.md"), dir, map), undefined);
});

test("inherit and unconfigured skills do not route, while domain-modeling routes standalone", () => {
	const machine = new RouterMachine(validated());
	assert.deepEqual(machine.requestSkill("github-issue-selector", "", "explicit", snapshot()), []);
	assert.deepEqual(machine.requestSkill("unknown", "", "explicit", snapshot()), []);
	const actions = machine.requestSkill("domain-modeling", "", "explicit", snapshot());
	assert.equal(actions[0]?.type, "switch");
	assert.equal(machine.state.active?.profile, "standard");
});

test("idle, --assume, queued and automatic routes apply at the correct boundary", () => {
	const machine = new RouterMachine(validated());
	const idle = machine.requestSkill("sdd-spec", "request", "explicit", snapshot());
	assert.equal(idle[0]?.type, "switch");
	assert.equal(machine.state.active?.profile, "standard");
	machine.confirmSwitch("openai-codex/gpt-5.6-terra");

	const assumed = new RouterMachine(validated());
	assumed.requestSkill("sdd-spec", "--assume request", "explicit", snapshot());
	assert.equal(assumed.state.active?.profile, "critical");

	const queued = new RouterMachine(validated());
	queued.queueIntent({ skill: "repo-clean", args: "" });
	assert.equal(queued.state.active, undefined);
	const expanded = '<skill name="repo-clean" location="/skills/repo-clean/SKILL.md">\nbody\n</skill>';
	const queuedActions = queued.consumeExpandedSkill(expanded, snapshot());
	assert.equal(queuedActions[0]?.type, "switch");
	assert.equal(queued.state.active?.ownerSkill, "repo-clean");

	const automatic = new RouterMachine(validated());
	const autoActions = automatic.requestSkill("code-review", "", "automatic", snapshot());
	assert.equal(autoActions[0]?.type, "switch");
	assert.equal(automatic.state.active?.ownerSkill, "code-review");
});

test("automatic nesting only upgrades priority; route_skill can override explicitly", () => {
	const machine = new RouterMachine(validated());
	machine.requestSkill("sdd-run", "", "explicit", snapshot());
	machine.confirmSwitch("openai-codex/gpt-5.6-terra");
	assert.equal(machine.state.active?.profile, "standard");

	assert.deepEqual(machine.requestSkill("find-skills", "", "automatic", snapshot()), []);
	assert.equal(machine.state.active?.ownerSkill, "sdd-run");
	assert.deepEqual(machine.requestSkill("sdd-spec", "", "automatic", snapshot()), []);
	assert.equal(machine.state.active?.ownerSkill, "sdd-run");

	const upgraded = machine.requestSkill("code-review", "", "automatic", snapshot());
	assert.equal(upgraded[0]?.type, "switch");
	assert.equal(machine.state.active?.profile, "critical");
	machine.confirmSwitch("openai-codex/gpt-5.6-sol");

	const override = machine.requestRoute(
		{ skill: "sdd-spec", profile: "light", source: "tool" },
		snapshot({ model: { provider: "openai-codex", id: "gpt-5.6-sol" } }),
	);
	assert.equal(override[0]?.type, "switch");
	assert.equal(machine.state.active?.profile, "light");
});

test("manual model override suspends routing and restore; normal settle restores exact original state", () => {
	const normal = new RouterMachine(validated());
	normal.requestSkill("grill", "", "explicit", snapshot());
	normal.confirmSwitch("openai-codex/gpt-5.6-sol");
	assert.deepEqual(normal.settle(), [
		{
			type: "restore",
			model: { provider: "anthropic", id: "original" },
			thinkingLevel: "medium",
		},
	]);
	assert.equal(normal.state.active, undefined);

	const manual = new RouterMachine(validated());
	manual.requestSkill("grill", "", "explicit", snapshot());
	manual.confirmSwitch("openai-codex/gpt-5.6-sol");
	manual.manualOverride();
	assert.deepEqual(manual.requestSkill("code-review", "", "automatic", snapshot()), []);
	assert.deepEqual(manual.settle(), []);
	assert.equal(manual.state.active, undefined);
});

test("execution profile marker is strict and defaults to standard", () => {
	assert.equal(parseExecutionProfile("<!-- SDD-Execution-Profile: light -->"), "light");
	assert.equal(parseExecutionProfile("<!-- SDD-Execution-Profile: critical -->"), "critical");
	assert.equal(parseExecutionProfile("<!-- SDD-Execution-Profile: utility -->"), "standard");
	assert.equal(parseExecutionProfile("# no marker"), "standard");
});

test("assistant error classification delegates overflow/retry and admits only unequivocal auth/quota", () => {
	assert.equal(classifyAssistantError(failure("429 too many requests"), 372_000), "transient");
	assert.equal(classifyAssistantError(failure("401 invalid API key"), 372_000), "auth-quota");
	assert.equal(classifyAssistantError(failure("insufficient_quota: billing limit"), 372_000), "auth-quota");
	assert.equal(
		classifyAssistantError(failure("Your input exceeds the context window of this model"), 372_000),
		"context-overflow",
	);
	assert.equal(classifyAssistantError(failure("Request was aborted", "aborted"), 372_000), "none");
	assert.equal(classifyAssistantError(failure("ordinary length stop", "length"), 372_000), "none");
	assert.equal(classifyAssistantError(failure("tests are red"), 372_000), "none");
});

test("fallback advances one usable candidate per error and never retries a candidate in one incident", () => {
	const machine = new RouterMachine(validated());
	machine.requestSkill("grill", "", "explicit", snapshot());
	machine.confirmSwitch("openai-codex/gpt-5.6-sol");

	const first = machine.handleAssistantFailure(
		failure("503 service unavailable"),
		snapshot({ model: { provider: "openai-codex", id: "gpt-5.6-sol" } }),
	);
	assert.equal(first.length, 1);
	assert.equal(first[0]?.type, "switch");
	assert.equal(first[0]?.type === "switch" && modelKey(first[0].candidate), "kimi-coding/k3");
	machine.confirmSwitch("kimi-coding/k3");

	const second = machine.handleAssistantFailure(
		{ ...failure("connection reset"), provider: "kimi-coding", model: "k3" },
		snapshot({ model: { provider: "kimi-coding", id: "k3" } }),
	);
	assert.equal(second.length, 1);
	assert.equal(second[0]?.type === "switch" && modelKey(second[0].candidate), "opencode-go/qwen3.7-max");
	machine.confirmSwitch("opencode-go/qwen3.7-max");

	const exhausted = machine.handleAssistantFailure(
		{ ...failure("timeout"), provider: "opencode-go", model: "qwen3.7-max" },
		snapshot({ model: { provider: "opencode-go", id: "qwen3.7-max" } }),
	);
	assert.equal(exhausted[0]?.type, "chain-exhausted");
	assert.equal(exhausted[1]?.type, "switch-original");
	assert.deepEqual(machine.state.incident?.attemptedModels.sort(), [
		"kimi-coding/k3",
		"openai-codex/gpt-5.6-sol",
		"opencode-go/qwen3.7-max",
	].sort());
});

test("auth/quota fallback requests exactly one explicit continuation and image branches skip text-only models", () => {
	const auth = new RouterMachine(validated());
	auth.requestSkill("grill", "", "explicit", snapshot());
	auth.confirmSwitch("openai-codex/gpt-5.6-sol");
	const authFallback = auth.handleAssistantFailure(
		failure("401 unauthorized: invalid API key"),
		snapshot({ model: { provider: "openai-codex", id: "gpt-5.6-sol" } }),
	);
	assert.equal(authFallback[0]?.type, "switch");
	assert.deepEqual(auth.confirmSwitch("kimi-coding/k3"), [{ type: "continue", reason: "auth-quota" }]);
	assert.deepEqual(auth.confirmSwitch("kimi-coding/k3"), []);

	const images = new RouterMachine(validated());
	images.requestSkill("grill", "", "explicit", snapshot({ hasImages: true }));
	images.confirmSwitch("openai-codex/gpt-5.6-sol");
	images.handleAssistantFailure(
		failure("503 server error"),
		snapshot({ model: { provider: "openai-codex", id: "gpt-5.6-sol" }, hasImages: true }),
	);
	images.confirmSwitch("kimi-coding/k3");
	const afterKimi = images.handleAssistantFailure(
		{ ...failure("timeout"), provider: "kimi-coding", model: "k3" },
		snapshot({ model: { provider: "kimi-coding", id: "k3" }, hasImages: true }),
	);
	assert.equal(afterKimi[0]?.type, "chain-exhausted");
	assert.equal(afterKimi[1]?.type, "switch-original");
});

test("a transient fallback that needs compaction becomes one explicit serialized continuation", () => {
	const machine = new RouterMachine(validated());
	machine.requestRoute({ skill: "sdd-spec", profile: "light", source: "tool" }, snapshot());
	machine.confirmSwitch("opencode-go/qwen3.7-max");
	const actions = machine.handleAssistantFailure(
		{ ...failure("503 service unavailable"), provider: "opencode-go", model: "qwen3.7-max" },
		snapshot({ model: { provider: "opencode-go", id: "qwen3.7-max" }, contextTokens: 400_000 }),
	);
	assert.deepEqual(actions, [{ type: "compact", reason: "switch", targetSoftCap: 339_232 }]);
	const afterCompact = machine.compactionComplete(snapshot({ contextTokens: 40_000 }));
	assert.equal(afterCompact[0]?.type, "switch");
	assert.deepEqual(machine.confirmSwitch("openai-codex/gpt-5.6-terra"), [
		{ type: "continue", reason: "technical-compaction" },
	]);
});

test("context protection computes 372000 - 32768 and compacts before a smaller switch", () => {
	const machine = new RouterMachine(validated());
	assert.equal(machine.profileSoftCap("critical", false), 339_232);
	const discovery = new RouterMachine(validated());
	assert.deepEqual(discovery.requestSkill("sdd-init", "", "explicit", snapshot({ contextTokens: 400_000 })), [
		{ type: "compact", reason: "switch", targetSoftCap: 339_232 },
	]);
	const replay: ReplayPayload = {
		text: "/skill:grill inspect this",
		images: [{ type: "image", data: "base64", mimeType: "image/png" }],
		expandedText: '<skill name="grill" location="/skills/grill/SKILL.md">\nbody\n</skill>\n\ninspect this',
	};
	const actions = machine.requestSkill(
		"grill",
		"inspect this",
		"explicit",
		snapshot({ contextTokens: 350_000 }),
		replay,
	);
	assert.deepEqual(actions, [{ type: "compact", reason: "switch", targetSoftCap: 339_232 }]);
	assert.equal(machine.state.operation, "compacting");
	const afterCompact = machine.compactionComplete(snapshot({ contextTokens: 40_000 }));
	assert.equal(afterCompact[0]?.type, "switch");
	assert.deepEqual(machine.confirmSwitch("openai-codex/gpt-5.6-sol"), [{ type: "replay", payload: replay }]);
});

test("a direct switch drops the replay: the original input continues normally", () => {
	// Regression: an explicit skill invocation with enough context must not replay.
	// Replaying here double-submits the skill while the original prompt() is in flight
	// ("Agent is already processing a prompt") and the thrown prompt triggers a premature
	// agent_settled that restores the original model mid-run.
	const machine = new RouterMachine(validated());
	const replay: ReplayPayload = {
		text: "/skill:grill inspect this",
		expandedText: '<skill name="grill" location="/skills/grill/SKILL.md">\nbody\n</skill>\n\ninspect this',
	};
	const actions = machine.requestSkill("grill", "inspect this", "explicit", snapshot({ contextTokens: 10_000 }), replay);
	assert.deepEqual(actions.map((action) => action.type), ["switch"]);
	assert.equal(machine.state.operation, "switching");
	assert.equal(machine.state.pendingReplay, undefined);
	assert.deepEqual(machine.confirmSwitch("openai-codex/gpt-5.6-sol"), []);
});

test("soft-cap crossing requests compaction once and failure clears a pending switch", () => {
	const unknownBaseline = new RouterMachine(validated());
	unknownBaseline.requestSkill("grill", "", "explicit", snapshot({ contextTokens: undefined }));
	unknownBaseline.confirmSwitch("openai-codex/gpt-5.6-sol");
	assert.deepEqual(unknownBaseline.turnEnd(340_000, false), [
		{ type: "compact", reason: "soft-cap", targetSoftCap: 339_232 },
	]);

	const machine = new RouterMachine(validated());
	machine.requestSkill("grill", "", "explicit", snapshot({ contextTokens: 300_000 }));
	machine.confirmSwitch("openai-codex/gpt-5.6-sol");
	assert.deepEqual(machine.turnEnd(330_000, false), []);
	assert.deepEqual(machine.turnEnd(340_000, false), [
		{ type: "compact", reason: "soft-cap", targetSoftCap: 339_232 },
	]);
	assert.deepEqual(machine.turnEnd(350_000, false), []);
	assert.equal(machine.state.operation, "compacting");
	machine.compactionFailed();
	assert.equal(machine.state.operation, "idle");
	assert.equal(machine.state.pendingSwitch, undefined);
	assert.equal(machine.state.compactionRequested, false);
});

test("switch, fallback and compaction actions are serialized", () => {
	const machine = new RouterMachine(validated());
	machine.requestSkill("grill", "", "explicit", snapshot({ contextTokens: 350_000 }));
	assert.equal(machine.state.operation, "compacting");
	assert.deepEqual(
		machine.handleAssistantFailure(failure("503 server error"), snapshot({ contextTokens: 350_000 })),
		[],
	);
	assert.deepEqual(machine.turnEnd(360_000, false), []);
});

test("diagnostics/status expose operational state while audit sanitization drops sensitive fields", () => {
	const machine = new RouterMachine(validated());
	machine.requestSkill("repo-clean", "", "explicit", snapshot());
	machine.confirmSwitch("openai-codex/gpt-5.6-terra");
	const status = formatStatus(machine.state);
	assert.match(status ?? "", /repo-clean/);
	assert.match(status ?? "", /safe-ops/);
	const diagnostics = formatDiagnostics(machine.state, {
		currentModel: { provider: "openai-codex", id: "gpt-5.6-terra" },
		thinkingLevel: "high",
		contextTokens: 12_345,
		warnings: ["example warning"],
	});
	for (const expected of ["Current", "Owner", "Chain", "Original", "Context", "Pending", "Warnings"]) {
		assert.match(diagnostics, new RegExp(expected, "i"));
	}
	assert.deepEqual(
		sanitizeAuditEvent({
			event: "fallback",
			timestamp: 123,
			skill: "repo-clean",
			profile: "safe-ops",
			fromModel: "openai-codex/gpt-5.6-terra",
			toModel: "kimi-coding/k3",
			category: "transient",
			error: "secret customer prompt",
			apiKey: "sk-secret",
			prompt: "private",
			reason: "may contain user data",
		}),
		{
			event: "fallback",
			timestamp: 123,
			skill: "repo-clean",
			profile: "safe-ops",
			fromModel: "openai-codex/gpt-5.6-terra",
			toModel: "kimi-coding/k3",
			category: "transient",
		},
	);
});

test("Pi adapter registers every required event, tool, command, status and audit event", { skip: REPO_ROOT ? false : SKIP_REASON }, () => {
	const index = read("pi-extensions/skill-model-router/index.ts");
	for (const event of [
		"input",
		"message_start",
		"tool_call",
		"model_select",
		"message_end",
		"turn_end",
		"agent_settled",
	]) {
		assert.match(index, new RegExp(`pi\\.on\\(\\"${event}\\"`));
	}
	assert.match(index, /name:\s*"route_skill"/);
	assert.match(index, /registerCommand\("skill-models"/);
	assert.match(index, /setStatus\("skill-model-router"/);
	assert.match(index, /text:\s*event\.text/);
	for (const event of [
		"route",
		"switch",
		"fallback",
		"manual-override",
		"restore",
		"compaction-request",
		"chain-exhausted",
	]) {
		assert.match(index, new RegExp(`audit\\(\\"${event}\\"`));
	}
});

test("Pi workflow skills persist and confirm downstream execution profiles", { skip: REPO_ROOT ? false : SKIP_REASON }, () => {
	const triage = read("pi/issue-triage/SKILL.md");
	for (const label of ["Perfil downstream", "Modelo resultante", "Motivo"]) {
		assert.match(triage, new RegExp(label));
	}
	assert.match(triage, /route_skill/);
	assert.match(triage, /despu[eé]s de confirmar/i);
	assert.match(triage, /no est[aá] disponible/i);
	for (const gate of ["seguridad", "migraciones", "concurrencia", "contratos p[uú]blicos", "blast radius", "verificaci[oó]n d[eé]bil"]) {
		assert.match(triage, new RegExp(gate, "i"));
	}

	const sddSpec = read("pi/sdd-spec/SKILL.md");
	assert.match(sddSpec, /Perfil de ejecuci[oó]n/);
	assert.match(sddSpec, /SDD-Execution-Profile: light\|standard\|critical/);
	assert.match(sddSpec, /alcance acotado/i);
	assert.match(sddSpec, /riesgo duro/i);
	assert.match(sddSpec, /CAs materiales BAJA\/NULA/i);
	assert.match(sddSpec, /--assume[\s\S]*critical/i);

	const sddRun = read("pi/sdd-run/SKILL.md");
	assert.match(sddRun, /SDD-Execution-Profile/);
	assert.match(sddRun, /si falta[\s\S]*standard/i);
	assert.match(sddRun, /route_skill/);
	assert.match(sddRun, /antes de planificar o editar/i);
});

test("README files document profiles, command, fallback and reload", { skip: REPO_ROOT ? false : SKIP_REASON }, () => {
	for (const path of ["README.md", "README.en.md"]) {
		const content = read(path);
		assert.match(content, /skill-model-router/);
		assert.match(content, /skill-models/);
		assert.match(content, /fallback/i);
		assert.match(content, /light/);
		assert.match(content, /standard/);
		assert.match(content, /critical/);
		assert.match(content, /\/reload/);
	}
});
