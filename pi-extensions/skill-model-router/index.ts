import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	StringEnum,
	getSupportedThinkingLevels,
	isContextOverflow as isPiContextOverflow,
	isRetryableAssistantError,
} from "@earendil-works/pi-ai";
import {
	getAgentDir,
	isToolCallEventType,
	parseSkillBlock,
	type ExtensionAPI,
	type ExtensionContext,
	type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import {
	RouterMachine,
	buildSkillPathMap,
	classifyAssistantError,
	findSkillForRead,
	formatDiagnostics,
	formatStatus,
	modelKey,
	parseSkillInvocation,
	sanitizeAuditEvent,
	validateRouterConfig,
	type AssistantFailure,
	type CatalogModel,
	type ExecutionProfile,
	type FailureCategory,
	type MachineAction,
	type ModelRef,
	type ReplayImage,
	type ReplayPayload,
	type ResolvedCandidate,
	type RouterConfig,
	type RouterSnapshot,
	type SkillPathMap,
	type ThinkingLevel,
} from "./logic";

const CONFIG_PATH = fileURLToPath(new URL("./config.json", import.meta.url));
const AUDIT_ENTRY_TYPE = "skill-model-router-audit";
const STATUS_ID = "skill-model-router";
const CONTINUATION_TEXT =
	"Continue after the technical provider fallback. Do not repeat tool side effects that already completed.";

interface AuditData {
	event: string;
	timestamp: number;
	skill?: string;
	profile?: string;
	fromModel?: string;
	toModel?: string;
	category?: string;
}

interface RouteToolDetails {
	targetSkill: string;
	profile: ExecutionProfile;
	model: string;
	pending: string;
}

function readCanonicalConfig(): { config?: RouterConfig; error?: string } {
	try {
		return { config: JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as RouterConfig };
	}
	catch {
		return { error: `Could not read or parse ${CONFIG_PATH}` };
	}
}

function readEnabledModels(): { enabledModels?: string[]; warning?: string } {
	const settingsPath = join(getAgentDir(), "settings.json");
	try {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as { enabledModels?: unknown };
		if (parsed.enabledModels === undefined) return {};
		if (!Array.isArray(parsed.enabledModels) || !parsed.enabledModels.every((value) => typeof value === "string")) {
			return { warning: `${settingsPath}: enabledModels is not a string array` };
		}
		return { enabledModels: parsed.enabledModels };
	}
	catch (error) {
		const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
		if (code === "ENOENT") return {};
		return { warning: `${settingsPath}: could not read enabledModels` };
	}
}

function commandSkillNames(pi: ExtensionAPI): Set<string> {
	return new Set(
		pi.getCommands()
			.filter((command) => command.source === "skill" && command.name.startsWith("skill:"))
			.map((command) => command.name.slice("skill:".length)),
	);
}

function commandForSkill(pi: ExtensionAPI, skill: string): SlashCommandInfo | undefined {
	return pi.getCommands().find(
		(command) => command.source === "skill" && command.name === `skill:${skill}`,
	);
}

function stripFrontmatter(content: string): string {
	return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function expandInvocation(pi: ExtensionAPI, skill: string, args: string): string | undefined {
	const command = commandForSkill(pi, skill);
	const path = command?.sourceInfo.path;
	if (!path) return undefined;
	try {
		const body = stripFrontmatter(readFileSync(path, "utf8"));
		const baseDir = command.sourceInfo.baseDir ?? dirname(path);
		const block = `<skill name="${skill}" location="${path}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
		return args ? `${block}\n\n${args}` : block;
	}
	catch {
		return undefined;
	}
}

function messageText(message: unknown): string | undefined {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "user") return undefined;
	if (!("content" in message)) return undefined;
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return undefined;
	return message.content
		.filter((part): part is { type: "text"; text: string } =>
			Boolean(part && typeof part === "object" && part.type === "text" && typeof part.text === "string"),
		)
		.map((part) => part.text)
		.join("\n");
}

function contentHasImage(content: unknown): boolean {
	return Array.isArray(content)
		&& content.some((part) => part && typeof part === "object" && part.type === "image");
}

function branchHasImages(ctx: ExtensionContext): boolean {
	for (const entry of ctx.sessionManager.getBranch() as readonly unknown[]) {
		if (!entry || typeof entry !== "object") continue;
		if ("message" in entry && entry.message && typeof entry.message === "object" && "content" in entry.message) {
			if (contentHasImage(entry.message.content)) return true;
		}
		if ("content" in entry && contentHasImage(entry.content)) return true;
	}
	return false;
}

function snapshotFromContext(
	ctx: ExtensionContext,
	thinkingLevel: ThinkingLevel,
	incomingImages = false,
): RouterSnapshot {
	return {
		model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
		thinkingLevel,
		contextTokens: ctx.getContextUsage()?.tokens,
		hasImages: incomingImages || branchHasImages(ctx),
	};
}

function replayImages(images: readonly { type: "image"; data: string; mimeType: string }[] | undefined): ReplayImage[] | undefined {
	return images?.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}

export default function skillModelRouter(pi: ExtensionAPI): void {
	const canonical = readCanonicalConfig();
	let machine: RouterMachine | undefined;
	let warnings: string[] = canonical.error ? [canonical.error] : [];
	let skillPaths: SkillPathMap = {};
	let internalModelChanges = 0;
	let replayGuard: ReplayPayload | undefined;
	let lastFailureCategory: FailureCategory | undefined;
	let settledWhileCompacting = false;

	function currentSnapshot(ctx: ExtensionContext, incomingImages = false): RouterSnapshot {
		return snapshotFromContext(ctx, pi.getThinkingLevel() as ThinkingLevel, incomingImages);
	}

	function audit(event: string, ctx: ExtensionContext, details: Omit<AuditData, "event" | "timestamp"> = {}): void {
		const data = sanitizeAuditEvent({ event, timestamp: Date.now(), ...details }) as AuditData;
		pi.appendEntry(AUDIT_ENTRY_TYPE, data);
		void ctx;
	}

	function updateStatus(ctx: ExtensionContext): void {
		const status = machine ? formatStatus(machine.state) : undefined;
		ctx.ui.setStatus("skill-model-router", status ? ctx.ui.theme.fg("accent", status) : undefined);
	}

	function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
		if (ctx.hasUI) ctx.ui.notify(message, level);
	}

	async function setModelAndThinking(
		modelRef: ModelRef,
		thinkingLevel: ThinkingLevel,
		ctx: ExtensionContext,
	): Promise<boolean> {
		const model = ctx.modelRegistry.find(modelRef.provider, modelRef.id);
		if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) return false;
		const alreadySelected = ctx.model?.provider === model.provider && ctx.model.id === model.id;
		if (!alreadySelected) {
			internalModelChanges++;
			try {
				const changed = await pi.setModel(model);
				if (!changed) return false;
			}
			catch {
				return false;
			}
			finally {
				internalModelChanges--;
			}
		}
		pi.setThinkingLevel(thinkingLevel);
		return true;
	}

	async function executeActions(actions: MachineAction[], ctx: ExtensionContext): Promise<boolean> {
		let triggeredAgent = false;
		for (const action of actions) {
			if (!machine) return triggeredAgent;
			switch (action.type) {
				case "switch": {
					const fromModel = ctx.model ? modelKey(ctx.model) : undefined;
					const wasFallback = machine.state.operation === "fallback";
					const success = await setModelAndThinking(action.candidate, action.candidate.thinkingLevel, ctx);
					if (!success) {
						notify(ctx, `Skill model unavailable: ${modelKey(action.candidate)}; trying the next safe candidate.`, "warning");
						triggeredAgent = (await executeActions(machine.switchFailed(currentSnapshot(ctx)), ctx)) || triggeredAgent;
						break;
					}
					const toModel = modelKey(action.candidate);
					if (wasFallback) {
						audit("fallback", ctx, {
							skill: machine.state.active?.ownerSkill,
							profile: machine.state.active?.profile,
							fromModel,
							toModel,
							category: lastFailureCategory,
						});
					}
					audit("switch", ctx, {
						skill: machine.state.active?.ownerSkill,
						profile: machine.state.active?.profile,
						fromModel,
						toModel,
					});
					triggeredAgent = (await executeActions(machine.confirmSwitch(toModel), ctx)) || triggeredAgent;
					break;
				}
				case "switch-original": {
					const fromModel = ctx.model ? modelKey(ctx.model) : undefined;
					const success = await setModelAndThinking(action.model, action.thinkingLevel, ctx);
					if (!success) {
						machine.switchFailed(currentSnapshot(ctx));
						notify(ctx, "The fallback chain and original model are unavailable; leaving the provider error visible.", "error");
						break;
					}
					const toModel = modelKey(action.model);
					audit("restore", ctx, {
						skill: machine.state.active?.ownerSkill,
						profile: machine.state.active?.profile,
						fromModel,
						toModel,
						category: "chain-exhausted",
					});
					triggeredAgent = (await executeActions(machine.confirmSwitch(toModel), ctx)) || triggeredAgent;
					break;
				}
				case "compact": {
					audit("compaction-request", ctx, {
						skill: machine.state.active?.ownerSkill,
						profile: machine.state.active?.profile,
						category: action.reason,
					});
					ctx.compact({
						customInstructions: "Preserve active task, decisions, modified files, pending verification, and skill routing context.",
						onComplete: () => {
							if (!machine) return;
							const postCompaction = machine.compactionComplete(currentSnapshot(ctx));
							void (async () => {
								const resumed = await executeActions(postCompaction, ctx);
								if (settledWhileCompacting && !resumed && machine) {
									settledWhileCompacting = false;
									await executeActions(machine.settle(), ctx);
								}
								else if (resumed) {
									settledWhileCompacting = false;
								}
								updateStatus(ctx);
							})();
						},
						onError: () => {
							const pendingReplay = machine?.state.pendingReplay;
							machine?.compactionFailed();
							if (pendingReplay && ctx.mode === "tui") ctx.ui.setEditorText(pendingReplay.text);
							const imageNote = pendingReplay?.images?.length ? " Reattach the preserved image(s) before resubmitting." : "";
							notify(
								ctx,
								`Skill routing compaction failed or was aborted; keeping the current model and cancelling the pending switch.${imageNote}`,
								"warning",
							);
							if ((pendingReplay || settledWhileCompacting) && machine) {
								settledWhileCompacting = false;
								void executeActions(machine.settle(), ctx).finally(() => updateStatus(ctx));
							}
							else {
								updateStatus(ctx);
							}
						},
					});
					break;
				}
				case "continue":
					triggeredAgent = true;
					pi.sendUserMessage(CONTINUATION_TEXT, { deliverAs: "followUp" });
					break;
				case "replay": {
					triggeredAgent = true;
					replayGuard = action.payload;
					const content: Array<{ type: "text"; text: string } | ReplayImage> = [
						{ type: "text", text: action.payload.text },
						...(action.payload.images ?? []),
					];
					// deliverAs followUp: if the agent is unexpectedly busy, queue instead of
					// throwing "already processing" and losing the skill. The input event (and
					// the replayGuard expansion) runs before the message is queued.
					pi.sendUserMessage(content, { deliverAs: "followUp" });
					break;
				}
				case "restore": {
					const fromModel = ctx.model ? modelKey(ctx.model) : undefined;
					if (await setModelAndThinking(action.model, action.thinkingLevel, ctx)) {
						audit("restore", ctx, { fromModel, toModel: modelKey(action.model) });
					}
					else {
						notify(ctx, `Could not restore original model ${modelKey(action.model)}.`, "warning");
					}
					break;
				}
				case "chain-exhausted":
					audit("chain-exhausted", ctx, {
						skill: machine.state.active?.ownerSkill,
						profile: machine.state.active?.profile,
						category: lastFailureCategory,
					});
					break;
			}
		}
		updateStatus(ctx);
		return triggeredAgent;
	}

	async function requestSkillRoute(
		skill: string,
		args: string,
		source: "explicit" | "automatic",
		ctx: ExtensionContext,
		replay?: ReplayPayload,
	): Promise<MachineAction[]> {
		if (!machine) return [];
		const previousActive = machine.state.active;
		const actions = machine.requestSkill(skill, args, source, currentSnapshot(ctx, Boolean(replay?.images?.length)), replay);
		if (machine.state.active && machine.state.active !== previousActive) {
			audit("route", ctx, {
				skill: machine.state.active.ownerSkill,
				profile: machine.state.active.profile,
				fromModel: ctx.model ? modelKey(ctx.model) : undefined,
				toModel: machine.state.pendingSwitch ? modelKey(machine.state.pendingSwitch.candidate) : undefined,
			});
		}
		await executeActions(actions, ctx);
		return actions;
	}

	pi.registerEntryRenderer<AuditData>(AUDIT_ENTRY_TYPE, (entry, { expanded }, theme) => {
		const data = entry.data;
		if (!data) return new Text(theme.fg("dim", "[skill-model-router] audit"), 0, 0);
		const route = [data.skill, data.profile].filter(Boolean).join("/");
		const models = [data.fromModel, data.toModel].filter(Boolean).join(" → ");
		const summary = [data.event, route, models, data.category].filter(Boolean).join(" · ");
		const suffix = expanded ? `\n${new Date(data.timestamp).toISOString()}` : "";
		return new Text(theme.fg("dim", `[skill-model-router] ${summary}${suffix}`), 0, 0);
	});

	pi.registerTool({
		name: "route_skill",
		label: "Route Skill",
		description:
			"Route a confirmed installed downstream skill to a light, standard, or critical profile. Does not accept provider or model IDs.",
		promptSnippet: "Route a confirmed downstream skill to a cognitive profile",
		promptGuidelines: [
			"Call route_skill only after the user has confirmed the downstream route/profile required by issue-triage or an SDD execution marker.",
		],
		parameters: Type.Object(
			{
				targetSkill: Type.String({ description: "Exact name of an installed skill" }),
				profile: StringEnum(["light", "standard", "critical"] as const),
				reason: Type.String({ minLength: 1, maxLength: 240, description: "Brief visible explanation" }),
			},
			{ additionalProperties: false },
		),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!machine) {
				return {
					content: [{ type: "text" as const, text: `Routing unavailable: ${warnings.join("; ") || "router not initialized"}` }],
					details: { targetSkill: params.targetSkill, profile: params.profile, model: "unchanged", pending: "disabled" },
				};
			}
			if (!commandSkillNames(pi).has(params.targetSkill)) {
				throw new Error(`route_skill target is not installed: ${params.targetSkill}`);
			}
			const previousActive = machine.state.active;
			const actions = machine.requestRoute(
				{ skill: params.targetSkill, profile: params.profile, source: "tool" },
				currentSnapshot(ctx),
			);
			if (machine.state.active && machine.state.active !== previousActive) {
				audit("route", ctx, {
					skill: params.targetSkill,
					profile: params.profile,
					fromModel: ctx.model ? modelKey(ctx.model) : undefined,
					toModel: machine.state.pendingSwitch ? modelKey(machine.state.pendingSwitch.candidate) : undefined,
				});
			}
			await executeActions(actions, ctx);
			const resultModel = ctx.model ? modelKey(ctx.model) : "none";
			const pending = machine.state.pendingSwitch ? modelKey(machine.state.pendingSwitch.candidate) : machine.state.operation;
			return {
				content: [{
					type: "text" as const,
					text: `Profile ${params.profile} confirmed for ${params.targetSkill}. Model: ${resultModel}. Pending: ${pending}. Reason: ${params.reason}`,
				}],
				details: {
					targetSkill: params.targetSkill,
					profile: params.profile,
					model: resultModel,
					pending,
				} satisfies RouteToolDetails,
			};
		},
	});

	pi.registerCommand("skill-models", {
		description: "Show skill model routing, fallback, compaction and configuration state",
		handler: async (_args, ctx) => {
			const output = machine
				? formatDiagnostics(machine.state, {
					currentModel: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
					thinkingLevel: pi.getThinkingLevel() as ThinkingLevel,
					contextTokens: ctx.getContextUsage()?.tokens,
					warnings,
				})
				: `Skill model router disabled.\nWarnings:\n${warnings.map((warning) => `- ${warning}`).join("\n") || "none"}`;
			notify(ctx, output, machine ? "info" : "error");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		warnings = canonical.error ? [canonical.error] : [];
		if (!canonical.config) {
			machine = undefined;
			updateStatus(ctx);
			return;
		}
		const enabled = readEnabledModels();
		if (enabled.warning) warnings.push(enabled.warning);
		const catalog: CatalogModel[] = ctx.modelRegistry.getAll().map((model) => ({
			provider: model.provider,
			id: model.id,
			contextWindow: model.contextWindow,
			input: [...model.input] as Array<"text" | "image">,
			thinkingLevels: getSupportedThinkingLevels(model) as ThinkingLevel[],
			hasCredentials: ctx.modelRegistry.hasConfiguredAuth(model),
		}));
		const validation = validateRouterConfig(canonical.config, catalog, enabled.enabledModels);
		warnings.push(...validation.warnings, ...validation.errors);
		machine = validation.errors.length === 0 ? new RouterMachine(validation) : undefined;
		skillPaths = buildSkillPathMap(
			pi.getCommands().map((command) => ({
				name: command.name,
				source: command.source,
				path: command.sourceInfo.path,
			})),
			ctx.cwd,
		);
		replayGuard = undefined;
		lastFailureCategory = undefined;
		settledWhileCompacting = false;
		updateStatus(ctx);
		if (warnings.length > 0) notify(ctx, `skill-model-router: ${warnings.length} configuration warning(s); run /skill-models.`, "warning");
	});

	pi.on("input", async (event, ctx) => {
		if (replayGuard && event.source === "extension" && event.text === replayGuard.text) {
			const replay = replayGuard;
			replayGuard = undefined;
			return { action: "transform" as const, text: replay.expandedText, images: event.images };
		}
		if (!machine || event.source === "extension") return { action: "continue" as const };
		const invocation = parseSkillInvocation(event.text, commandSkillNames(pi));
		if (!invocation) return { action: "continue" as const };
		if (event.streamingBehavior) {
			machine.queueIntent({ skill: invocation.skill, args: invocation.args });
			return invocation.promotedText === event.text
				? { action: "continue" as const }
				: { action: "transform" as const, text: invocation.promotedText, images: event.images };
		}

		const expandedText = expandInvocation(pi, invocation.skill, invocation.args);
		const replay = expandedText
			? {
				text: event.text,
				images: replayImages(event.images),
				expandedText,
			} satisfies ReplayPayload
			: undefined;
		const actions = await requestSkillRoute(invocation.skill, invocation.args, "explicit", ctx, replay);
		machine.markInputApplied(invocation.skill);
		if (actions.some((action) => action.type === "compact")) {
			if (replay) return { action: "handled" as const };
			machine.compactionFailed();
			notify(ctx, "Could not preserve the expanded skill input for compaction; continuing on the current model.", "warning");
		}
		return invocation.promotedText === event.text
			? { action: "continue" as const }
			: { action: "transform" as const, text: invocation.promotedText, images: event.images };
	});

	pi.on("message_start", async (event, ctx) => {
		if (!machine) return;
		const text = messageText(event.message);
		if (!text || !parseSkillBlock(text)) return;
		const previousActive = machine.state.active;
		const actions = machine.consumeExpandedSkill(text, currentSnapshot(ctx));
		if (machine.state.active && machine.state.active !== previousActive) {
			audit("route", ctx, {
				skill: machine.state.active.ownerSkill,
				profile: machine.state.active.profile,
				fromModel: ctx.model ? modelKey(ctx.model) : undefined,
				toModel: machine.state.pendingSwitch ? modelKey(machine.state.pendingSwitch.candidate) : undefined,
			});
		}
		await executeActions(actions, ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!machine || !isToolCallEventType("read", event)) return;
		const skill = findSkillForRead(event.input.path, ctx.cwd, skillPaths);
		if (!skill) return;
		await requestSkillRoute(skill, "", "automatic", ctx);
	});

	pi.on("model_select", (event, ctx) => {
		if (!machine?.state.active || internalModelChanges > 0 || event.source === "restore") return;
		machine.manualOverride();
		audit("manual-override", ctx, {
			skill: machine.state.active.ownerSkill,
			profile: machine.state.active.profile,
			fromModel: event.previousModel ? modelKey(event.previousModel) : undefined,
			toModel: modelKey(event.model),
		});
		updateStatus(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		if (!machine || event.message.role !== "assistant") return;
		const message = event.message as AssistantFailure;
		if (message.stopReason !== "error") {
			machine.clearIncident();
			return;
		}
		const contextWindow = ctx.modelRegistry.find(message.provider, message.model)?.contextWindow;
		lastFailureCategory = isPiContextOverflow(event.message, contextWindow)
			? "context-overflow"
			: isRetryableAssistantError(event.message)
				? "transient"
				: classifyAssistantError(message, contextWindow);
		const actions = machine.handleAssistantFailure(message, currentSnapshot(ctx), lastFailureCategory);
		await executeActions(actions, ctx);
		if (lastFailureCategory === "transient" && actions.some((action) => action.type === "compact")) {
			return {
				message: {
					...event.message,
					errorMessage: "Technical provider failure; fallback waits for context compaction before one continuation.",
				},
			};
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!machine) return;
		const usage = ctx.getContextUsage();
		await executeActions(machine.turnEnd(usage?.tokens, branchHasImages(ctx)), ctx);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!machine) return;
		if (machine.state.operation === "compacting") {
			settledWhileCompacting = true;
			return;
		}
		await executeActions(machine.settle(), ctx);
		lastFailureCategory = undefined;
		updateStatus(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus(STATUS_ID, undefined);
	});
}
