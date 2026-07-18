import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ExecutionProfile = "light" | "standard" | "critical";
export type RouteSource = "explicit" | "automatic" | "tool";
export type RouterOperation = "idle" | "switching" | "compacting" | "fallback";

export interface ModelRef {
	provider: string;
	id: string;
}

export interface Candidate extends ModelRef {
	thinkingLevel: ThinkingLevel;
}

export interface ProfileConfig {
	priority: number;
	candidates: Candidate[];
}

export interface RouteSkillPolicy {
	policy: "route";
	profile: string;
	allowedProfiles?: ExecutionProfile[];
	argumentProfiles?: Record<string, ExecutionProfile>;
}

export interface InheritSkillPolicy {
	policy: "inherit";
	standaloneProfile?: string;
}

export type SkillPolicy = RouteSkillPolicy | InheritSkillPolicy;

export interface RouterConfig {
	version: number;
	reserveTokens: number;
	preselectedModels: ModelRef[];
	profiles: Record<string, ProfileConfig>;
	skills: Record<string, SkillPolicy>;
}

export interface CatalogModel extends ModelRef {
	contextWindow: number;
	input: Array<"text" | "image">;
	thinkingLevels: readonly ThinkingLevel[];
	hasCredentials: boolean;
}

export interface ResolvedCandidate extends Candidate {
	contextWindow: number;
	input: Array<"text" | "image">;
}

export interface ValidatedRouterConfig {
	config: RouterConfig;
	usableProfiles: Record<string, ResolvedCandidate[]>;
	catalogByKey: Record<string, CatalogModel>;
	warnings: string[];
	errors: string[];
}

export interface SkillInvocation {
	skill: string;
	args: string;
	promotedText: string;
}

export interface ExpandedSkillInvocation {
	skill: string;
	args: string;
}

export interface SkillPathCommand {
	name: string;
	source: string;
	path: string;
}

export type SkillPathMap = Record<string, string>;

export interface ReplayImage {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ReplayPayload {
	text: string;
	images?: ReplayImage[];
	/** Expansion used only by the replay guard because pi.sendUserMessage skips command expansion. */
	expandedText: string;
}

export interface RouterSnapshot {
	model: ModelRef | undefined;
	thinkingLevel: ThinkingLevel;
	contextTokens: number | null | undefined;
	hasImages: boolean;
}

export interface RouteRequest {
	skill: string;
	profile: string;
	source: RouteSource;
}

export interface ActiveRoute {
	ownerSkill: string;
	profile: string;
	priority: number;
	reserveTokens: number;
	chain: ResolvedCandidate[];
	candidateIndex: number;
	currentCandidate?: string;
	originalModel?: ModelRef;
	originalThinkingLevel: ThinkingLevel;
}

export interface FailureIncident {
	attemptedModels: string[];
	explicitContinuationUsed: boolean;
	chainExhausted: boolean;
}

export interface PendingSwitch {
	candidate: ResolvedCandidate;
	kind: "route" | "fallback" | "original";
	continuation?: "auth-quota" | "chain-exhausted" | "technical-compaction";
}

export interface RouterState {
	active?: ActiveRoute;
	operation: RouterOperation;
	manualOverride: boolean;
	queuedIntents: Array<{ skill: string; args: string }>;
	inputAppliedSkills: string[];
	pendingSwitch?: PendingSwitch;
	pendingReplay?: ReplayPayload;
	compactionRequested: boolean;
	previousContextTokens?: number | null;
	incident?: FailureIncident;
}

export type MachineAction =
	| { type: "switch"; candidate: ResolvedCandidate }
	| { type: "switch-original"; model: ModelRef; thinkingLevel: ThinkingLevel }
	| { type: "compact"; reason: "switch" | "soft-cap"; targetSoftCap: number }
	| { type: "continue"; reason: "auth-quota" | "chain-exhausted" | "technical-compaction" }
	| { type: "replay"; payload: ReplayPayload }
	| { type: "restore"; model: ModelRef; thinkingLevel: ThinkingLevel }
	| { type: "chain-exhausted" };

export interface AssistantFailure {
	role: "assistant";
	provider: string;
	model: string;
	stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
	errorMessage?: string;
	usage: {
		input: number;
		cacheRead: number;
		output: number;
	};
}

export type FailureCategory = "transient" | "auth-quota" | "context-overflow" | "none";

const EXECUTION_PROFILES = new Set<ExecutionProfile>(["light", "standard", "critical"]);
const THINKING_LEVEL_SET = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);
const INLINE_SKILL_INVOCATION = /(^|[ \t\n])\/skill:([a-z0-9][a-z0-9-]*)(?=$|[ \t\n])/g;
const EXPANDED_SKILL_BLOCK = /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/;

export function modelKey(model: ModelRef): string {
	return `${model.provider}/${model.id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function validateCandidateShape(value: unknown, path: string, errors: string[]): value is Candidate {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object with provider, id and thinkingLevel`);
		return false;
	}
	let valid = true;
	if (!isNonEmptyString(value.provider)) {
		errors.push(`${path}.provider must be a non-empty string`);
		valid = false;
	}
	if (!isNonEmptyString(value.id)) {
		errors.push(`${path}.id must be a non-empty string`);
		valid = false;
	}
	if (!isNonEmptyString(value.thinkingLevel) || !THINKING_LEVEL_SET.has(value.thinkingLevel as ThinkingLevel)) {
		errors.push(`${path}.thinkingLevel is invalid`);
		valid = false;
	}
	return valid;
}

/**
 * Validate the versioned config against Pi's current catalog and optional enabledModels.
 * Structural/configuration mistakes are errors. Catalog/auth drift is a warning and makes
 * that candidate unavailable without blocking unrelated profiles.
 */
export function validateRouterConfig(
	value: unknown,
	catalog: readonly CatalogModel[],
	enabledModels?: readonly string[],
): ValidatedRouterConfig {
	const errors: string[] = [];
	const warnings: string[] = [];
	const fallbackConfig: RouterConfig = {
		version: 0,
		reserveTokens: 32_768,
		preselectedModels: [],
		profiles: {},
		skills: {},
	};
	if (!isRecord(value)) {
		return {
			config: fallbackConfig,
			usableProfiles: {},
			catalogByKey: {},
			warnings,
			errors: ["config must be an object"],
		};
	}

	const config = value as unknown as RouterConfig;
	if (config.version !== 1) errors.push("config.version must be 1");
	if (!Number.isSafeInteger(config.reserveTokens) || config.reserveTokens <= 0) {
		errors.push("config.reserveTokens must be a positive integer");
	}
	if (!Array.isArray(config.preselectedModels)) errors.push("config.preselectedModels must be an array");
	if (!isRecord(config.profiles)) errors.push("config.profiles must be an object");
	if (!isRecord(config.skills)) errors.push("config.skills must be an object");

	const preselected = new Set<string>();
	for (const [index, model] of (Array.isArray(config.preselectedModels) ? config.preselectedModels : []).entries()) {
		if (!isRecord(model) || !isNonEmptyString(model.provider) || !isNonEmptyString(model.id)) {
			errors.push(`preselectedModels[${index}] must declare provider and id separately`);
			continue;
		}
		const key = modelKey(model as unknown as ModelRef);
		if (preselected.has(key)) errors.push(`preselected model is duplicated: ${key}`);
		preselected.add(key);
	}

	const catalogByKey: Record<string, CatalogModel> = {};
	for (const model of catalog) catalogByKey[modelKey(model)] = model;
	const enabledSet = enabledModels ? new Set(enabledModels) : undefined;
	const usableProfiles: Record<string, ResolvedCandidate[]> = {};

	for (const [profileName, rawProfile] of Object.entries(isRecord(config.profiles) ? config.profiles : {})) {
		if (!isRecord(rawProfile)) {
			errors.push(`profile ${profileName} must be an object`);
			usableProfiles[profileName] = [];
			continue;
		}
		const profile = rawProfile as unknown as ProfileConfig;
		if (!Number.isFinite(profile.priority)) errors.push(`profile ${profileName} has an invalid priority`);
		if (!Array.isArray(profile.candidates) || profile.candidates.length === 0) {
			errors.push(`profile ${profileName} must have at least one candidate`);
			usableProfiles[profileName] = [];
			continue;
		}
		const usable: ResolvedCandidate[] = [];
		const seen = new Set<string>();
		for (const [index, rawCandidate] of profile.candidates.entries()) {
			if (!validateCandidateShape(rawCandidate, `profiles.${profileName}.candidates[${index}]`, errors)) continue;
			const candidate = rawCandidate as Candidate;
			const key = modelKey(candidate);
			if (!preselected.has(key)) {
				errors.push(`profile ${profileName} candidate ${key} is not preselected`);
				continue;
			}
			if (seen.has(key)) {
				errors.push(`profile ${profileName} repeats candidate ${key}`);
				continue;
			}
			seen.add(key);
			const model = catalogByKey[key];
			if (!model) {
				warnings.push(`Model not found in ctx.modelRegistry: ${key}`);
				continue;
			}
			if (enabledSet && !enabledSet.has(key)) {
				warnings.push(`Router config is not a subset of enabledModels: ${key}`);
				continue;
			}
			if (!model.hasCredentials) {
				warnings.push(`No configured credentials for ${key}`);
				continue;
			}
			if (!model.thinkingLevels.includes(candidate.thinkingLevel)) {
				warnings.push(`${key} does not support thinking level ${candidate.thinkingLevel}`);
				continue;
			}
			usable.push({
				...candidate,
				contextWindow: model.contextWindow,
				input: [...model.input],
			});
		}
		usableProfiles[profileName] = usable;
	}

	for (const [skillName, rawPolicy] of Object.entries(isRecord(config.skills) ? config.skills : {})) {
		if (!isRecord(rawPolicy) || (rawPolicy.policy !== "route" && rawPolicy.policy !== "inherit")) {
			errors.push(`skill ${skillName} has an invalid policy`);
			continue;
		}
		if (rawPolicy.policy === "route") {
			if (!isNonEmptyString(rawPolicy.profile) || !isRecord(config.profiles) || !(rawPolicy.profile in config.profiles)) {
				errors.push(`skill ${skillName} references unknown profile ${String(rawPolicy.profile)}`);
			}
			if (rawPolicy.allowedProfiles !== undefined) {
				if (!Array.isArray(rawPolicy.allowedProfiles)) {
					errors.push(`skill ${skillName}.allowedProfiles must be an array`);
				}
				else {
					for (const profile of rawPolicy.allowedProfiles) {
						if (!EXECUTION_PROFILES.has(profile as ExecutionProfile) || !(profile in config.profiles)) {
							errors.push(`skill ${skillName} allows unknown profile ${String(profile)}`);
						}
					}
				}
			}
			if (rawPolicy.argumentProfiles !== undefined && isRecord(rawPolicy.argumentProfiles)) {
				for (const profile of Object.values(rawPolicy.argumentProfiles)) {
					if (!EXECUTION_PROFILES.has(profile as ExecutionProfile) || !(String(profile) in config.profiles)) {
						errors.push(`skill ${skillName} argument override references unknown profile ${String(profile)}`);
					}
				}
			}
		}
		else if (
			rawPolicy.standaloneProfile !== undefined
			&& (!isNonEmptyString(rawPolicy.standaloneProfile) || !(rawPolicy.standaloneProfile in config.profiles))
		) {
			errors.push(`skill ${skillName} references unknown standalone profile ${String(rawPolicy.standaloneProfile)}`);
		}
	}

	return { config, usableProfiles, catalogByKey, warnings, errors };
}

export function parseSkillInvocation(
	text: string,
	knownSkillNames: ReadonlySet<string>,
): SkillInvocation | undefined {
	if (text.startsWith("/skill:")) {
		const boundary = text.search(/[ \t\n]/);
		const command = boundary === -1 ? text : text.slice(0, boundary);
		const skill = command.slice("/skill:".length);
		if (!knownSkillNames.has(skill)) return undefined;
		const args = boundary === -1 ? "" : text.slice(boundary + 1).trim();
		return { skill, args, promotedText: args ? `/skill:${skill} ${args}` : `/skill:${skill}` };
	}

	INLINE_SKILL_INVOCATION.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = INLINE_SKILL_INVOCATION.exec(text)) !== null) {
		const skill = match[2];
		if (!skill || !knownSkillNames.has(skill)) continue;
		const boundary = match[1] ?? "";
		const tokenStart = match.index + boundary.length;
		const tokenEnd = tokenStart + `/skill:${skill}`.length;
		const beforeToken = text.slice(0, tokenStart);
		let afterToken = text.slice(tokenEnd);
		if (/[ \t]$/.test(beforeToken) && /^[ \t]/.test(afterToken)) afterToken = afterToken.slice(1);
		const args = `${beforeToken}${afterToken}`.trim();
		return { skill, args, promotedText: args ? `/skill:${skill} ${args}` : `/skill:${skill}` };
	}
	return undefined;
}

export function parseExpandedSkillBlock(text: string): ExpandedSkillInvocation | undefined {
	const match = EXPANDED_SKILL_BLOCK.exec(text);
	if (!match) return undefined;
	return { skill: match[1]!, args: match[2]?.trim() ?? "" };
}

function canonicalPath(path: string, cwd: string): string {
	const withoutAt = path.startsWith("@") ? path.slice(1) : path;
	const absolute = isAbsolute(withoutAt) ? withoutAt : resolve(cwd, withoutAt);
	try {
		return realpathSync.native(absolute);
	}
	catch {
		return resolve(absolute);
	}
}

export function buildSkillPathMap(commands: readonly SkillPathCommand[], cwd: string): SkillPathMap {
	const result: SkillPathMap = {};
	for (const command of commands) {
		if (command.source !== "skill" || !command.name.startsWith("skill:") || !command.path) continue;
		result[canonicalPath(command.path, cwd)] = command.name.slice("skill:".length);
	}
	return result;
}

export function findSkillForRead(path: string, cwd: string, map: SkillPathMap): string | undefined {
	return map[canonicalPath(path, cwd)];
}

export function parseExecutionProfile(markdown: string): ExecutionProfile {
	const match = markdown.match(/<!--\s*SDD-Execution-Profile:\s*(light|standard|critical)\s*-->/);
	return match?.[1] as ExecutionProfile | undefined ?? "standard";
}

function hasArgument(args: string, argument: string): boolean {
	return args.split(/\s+/).includes(argument);
}

function supportsImages(candidate: { input: readonly ("text" | "image")[] }, hasImages: boolean): boolean {
	return !hasImages || candidate.input.includes("image");
}

export class RouterMachine {
	readonly validated: ValidatedRouterConfig;
	readonly state: RouterState;

	constructor(validated: ValidatedRouterConfig) {
		this.validated = validated;
		this.state = {
			operation: "idle",
			manualOverride: false,
			queuedIntents: [],
			inputAppliedSkills: [],
			compactionRequested: false,
		};
	}

	requestSkill(
		skill: string,
		args: string,
		source: RouteSource,
		snapshot: RouterSnapshot,
		replay?: ReplayPayload,
	): MachineAction[] {
		const policy = this.validated.config.skills[skill];
		if (!policy) return [];
		if (policy.policy === "inherit") {
			if (this.state.active || !policy.standaloneProfile) return [];
			return this.requestRoute({ skill, profile: policy.standaloneProfile, source }, snapshot, replay);
		}

		let profile = policy.profile;
		for (const [argument, override] of Object.entries(policy.argumentProfiles ?? {})) {
			if (hasArgument(args, argument)) profile = override;
		}
		return this.requestRoute({ skill, profile, source }, snapshot, replay);
	}

	requestRoute(request: RouteRequest, snapshot: RouterSnapshot, replay?: ReplayPayload): MachineAction[] {
		if (this.state.manualOverride) return [];
		const profile = this.validated.config.profiles[request.profile];
		if (!profile) return [];
		if (
			request.source === "automatic"
			&& this.state.active
			&& profile.priority <= this.state.active.priority
		) {
			return [];
		}
		const chain = (this.validated.usableProfiles[request.profile] ?? []).filter((candidate) =>
			supportsImages(candidate, snapshot.hasImages)
		);
		if (chain.length === 0) return [];

		const originalModel = this.state.active?.originalModel ?? snapshot.model;
		const originalThinkingLevel = this.state.active?.originalThinkingLevel ?? snapshot.thinkingLevel;
		this.state.active = {
			ownerSkill: request.skill,
			profile: request.profile,
			priority: profile.priority,
			reserveTokens: this.validated.config.reserveTokens,
			chain,
			candidateIndex: -1,
			originalModel,
			originalThinkingLevel,
		};
		this.state.incident = undefined;
		this.state.previousContextTokens = snapshot.contextTokens;
		this.state.pendingReplay = replay;

		const target = chain[0]!;
		if (this.state.operation === "compacting") {
			this.state.pendingSwitch = { candidate: target, kind: "route" };
			return [];
		}
		return this.scheduleSwitch(
			target,
			"route",
			snapshot,
			undefined,
			this.profileSoftCap(request.profile, snapshot.hasImages),
		);
	}

	queueIntent(intent: { skill: string; args: string }): void {
		this.state.queuedIntents.push({ ...intent });
	}

	markInputApplied(skill: string): void {
		this.state.inputAppliedSkills.push(skill);
	}

	consumeExpandedSkill(text: string, snapshot: RouterSnapshot): MachineAction[] {
		const expanded = parseExpandedSkillBlock(text);
		if (!expanded) return [];
		const appliedIndex = this.state.inputAppliedSkills.indexOf(expanded.skill);
		if (appliedIndex >= 0) {
			this.state.inputAppliedSkills.splice(appliedIndex, 1);
			return [];
		}
		const queuedIndex = this.state.queuedIntents.findIndex((intent) => intent.skill === expanded.skill);
		if (queuedIndex >= 0) this.state.queuedIntents.splice(queuedIndex, 1);
		return this.requestSkill(expanded.skill, expanded.args, "explicit", snapshot);
	}

	profileSoftCap(profile: string, hasImages: boolean): number | undefined {
		const contexts = (this.validated.usableProfiles[profile] ?? [])
			.filter((candidate) => supportsImages(candidate, hasImages))
			.map((candidate) => candidate.contextWindow);
		if (contexts.length === 0) return undefined;
		return Math.min(...contexts) - this.validated.config.reserveTokens;
	}

	turnEnd(contextTokens: number | null | undefined, hasImages: boolean): MachineAction[] {
		if (!this.state.active || this.state.manualOverride || this.state.operation !== "idle") return [];
		if (contextTokens === undefined || contextTokens === null) return [];
		const softCap = this.profileSoftCap(this.state.active.profile, hasImages);
		if (softCap === undefined) return [];
		const previous = this.state.previousContextTokens;
		this.state.previousContextTokens = contextTokens;
		const crossed = contextTokens > softCap
			&& (previous === undefined || previous === null || previous <= softCap);
		if (!crossed || this.state.compactionRequested) return [];
		this.state.operation = "compacting";
		this.state.compactionRequested = true;
		return [{ type: "compact", reason: "soft-cap", targetSoftCap: softCap }];
	}

	compactionComplete(snapshot: RouterSnapshot): MachineAction[] {
		if (this.state.operation !== "compacting") return [];
		this.state.compactionRequested = false;
		this.state.previousContextTokens = snapshot.contextTokens;
		if (this.state.manualOverride) {
			this.state.operation = "idle";
			this.state.pendingSwitch = undefined;
			this.state.pendingReplay = undefined;
			return [];
		}
		const pending = this.state.pendingSwitch;
		if (!pending) {
			this.state.operation = "idle";
			return [];
		}
		this.state.operation = pending.kind === "fallback" ? "fallback" : "switching";
		return [this.switchAction(pending)];
	}

	compactionFailed(): void {
		this.state.operation = "idle";
		this.state.compactionRequested = false;
		this.state.pendingSwitch = undefined;
		this.state.pendingReplay = undefined;
	}

	confirmSwitch(key: string): MachineAction[] {
		const pending = this.state.pendingSwitch;
		if (!pending || modelKey(pending.candidate) !== key) return [];
		if (this.state.active) {
			const index = this.state.active.chain.findIndex((candidate) => modelKey(candidate) === key);
			this.state.active.candidateIndex = index;
			this.state.active.currentCandidate = key;
		}
		this.state.pendingSwitch = undefined;
		this.state.operation = "idle";

		const actions: MachineAction[] = [];
		if (pending.continuation && this.state.incident && !this.state.incident.explicitContinuationUsed) {
			this.state.incident.explicitContinuationUsed = true;
			actions.push({ type: "continue", reason: pending.continuation });
		}
		if (this.state.pendingReplay) {
			actions.push({ type: "replay", payload: this.state.pendingReplay });
			this.state.pendingReplay = undefined;
		}
		return actions;
	}

	switchFailed(snapshot: RouterSnapshot): MachineAction[] {
		const pending = this.state.pendingSwitch;
		if (!pending) return [];
		const failed = modelKey(pending.candidate);
		this.state.pendingSwitch = undefined;
		this.state.operation = "idle";
		this.ensureIncident().attemptedModels = unique([...this.ensureIncident().attemptedModels, failed]);
		return this.nextFallback(snapshot, pending.continuation);
	}

	clearIncident(): void {
		this.state.incident = undefined;
	}

	handleAssistantFailure(
		message: AssistantFailure,
		snapshot: RouterSnapshot,
		categoryOverride?: FailureCategory,
	): MachineAction[] {
		if (!this.state.active || this.state.manualOverride || this.state.operation !== "idle") return [];
		const currentKey = `${message.provider}/${message.model}`;
		const currentModel = this.validated.catalogByKey[currentKey];
		const category = categoryOverride ?? classifyAssistantError(message, currentModel?.contextWindow);
		if (category !== "transient" && category !== "auth-quota") return [];
		const incident = this.ensureIncident();
		if (incident.chainExhausted) return [];
		incident.attemptedModels = unique([...incident.attemptedModels, currentKey]);
		const actions = this.nextFallback(
			snapshot,
			category === "auth-quota" ? "auth-quota" : undefined,
			currentKey,
		);
		if (
			category === "transient"
			&& actions.some((action) => action.type === "compact")
			&& this.state.pendingSwitch
		) {
			this.state.pendingSwitch.continuation = "technical-compaction";
		}
		return actions;
	}

	manualOverride(): void {
		if (!this.state.active) return;
		this.state.manualOverride = true;
		this.state.operation = "idle";
		this.state.pendingSwitch = undefined;
		this.state.pendingReplay = undefined;
		this.state.compactionRequested = false;
	}

	settle(): MachineAction[] {
		const active = this.state.active;
		const shouldRestore = active && !this.state.manualOverride && active.originalModel;
		const action = shouldRestore
			? {
				type: "restore" as const,
				model: { ...active.originalModel! },
				thinkingLevel: active.originalThinkingLevel,
			}
			: undefined;
		this.resetRun();
		return action ? [action] : [];
	}

	private scheduleSwitch(
		candidate: ResolvedCandidate,
		kind: PendingSwitch["kind"],
		snapshot: RouterSnapshot,
		continuation?: PendingSwitch["continuation"],
		guardSoftCap?: number,
	): MachineAction[] {
		this.state.pendingSwitch = { candidate, kind, continuation };
		const targetSoftCap = candidate.contextWindow - this.validated.config.reserveTokens;
		const softCap = guardSoftCap === undefined ? targetSoftCap : Math.min(targetSoftCap, guardSoftCap);
		if (snapshot.contextTokens !== undefined && snapshot.contextTokens !== null && snapshot.contextTokens > softCap) {
			this.state.operation = "compacting";
			this.state.compactionRequested = true;
			return [{ type: "compact", reason: "switch", targetSoftCap: softCap }];
		}
		this.state.operation = kind === "fallback" ? "fallback" : "switching";
		return [this.switchAction(this.state.pendingSwitch)];
	}

	private switchAction(pending: PendingSwitch): MachineAction {
		if (pending.kind === "original") {
			return {
				type: "switch-original",
				model: { provider: pending.candidate.provider, id: pending.candidate.id },
				thinkingLevel: pending.candidate.thinkingLevel,
			};
		}
		return { type: "switch", candidate: pending.candidate };
	}

	private nextFallback(
		snapshot: RouterSnapshot,
		continuation?: PendingSwitch["continuation"],
		failedKey?: string,
	): MachineAction[] {
		const active = this.state.active;
		if (!active) return [];
		const incident = this.ensureIncident();
		const currentIndex = failedKey
			? active.chain.findIndex((candidate) => modelKey(candidate) === failedKey)
			: active.candidateIndex;
		for (let index = Math.max(0, currentIndex + 1); index < active.chain.length; index++) {
			const candidate = active.chain[index]!;
			const key = modelKey(candidate);
			if (incident.attemptedModels.includes(key) || !supportsImages(candidate, snapshot.hasImages)) continue;
			return this.scheduleSwitch(candidate, "fallback", snapshot, continuation);
		}

		incident.chainExhausted = true;
		const actions: MachineAction[] = [{ type: "chain-exhausted" }];
		const original = active.originalModel && this.validated.catalogByKey[modelKey(active.originalModel)];
		if (
			!original
			|| incident.attemptedModels.includes(modelKey(original))
			|| (failedKey !== undefined && modelKey(original) === failedKey)
			|| !original.hasCredentials
			|| !supportsImages(original, snapshot.hasImages)
		) {
			return actions;
		}
		const originalTarget: ResolvedCandidate = {
			provider: original.provider,
			id: original.id,
			thinkingLevel: active.originalThinkingLevel,
			contextWindow: original.contextWindow,
			input: [...original.input],
		};
		return [
			...actions,
			...this.scheduleSwitch(
				originalTarget,
				"original",
				snapshot,
				continuation ? "chain-exhausted" : undefined,
			),
		];
	}

	private ensureIncident(): FailureIncident {
		this.state.incident ??= {
			attemptedModels: [],
			explicitContinuationUsed: false,
			chainExhausted: false,
		};
		return this.state.incident;
	}

	private resetRun(): void {
		this.state.active = undefined;
		this.state.operation = "idle";
		this.state.manualOverride = false;
		this.state.queuedIntents = [];
		this.state.inputAppliedSkills = [];
		this.state.pendingSwitch = undefined;
		this.state.pendingReplay = undefined;
		this.state.compactionRequested = false;
		this.state.previousContextTokens = undefined;
		this.state.incident = undefined;
	}
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

// Kept in sync with Pi 0.80's public retry/overflow behavior so logic.ts remains
// runnable by node:test without importing Pi's globally installed runtime packages.
const NON_RETRYABLE_LIMIT = /(GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing)/i;
const RETRYABLE_PROVIDER_ERROR = /(overloaded|rate.?limit|too many requests|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|\b524\b|service.?unavailable|server.?error|internal.?error|provider.?returned.?error|network.?error|connection.?error|connection.?refused|connection.?lost|connection.?reset|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|socket connection was closed|timed? out|timeout|terminated|websocket.?closed|websocket.?error|ended without|stream ended before message_stop|http2 request did not get a response|retry delay|you can retry your request|try your request again|please retry your request|ResourceExhausted)/i;
const AUTH_OR_QUOTA_ERROR = /(\b401\b|unauthori[sz]ed|invalid api(?:[ _-]?key)?|authentication (?:failed|required)|credentials? (?:expired|invalid)|permission denied.*credential|insufficient_quota|quota exceeded|usage limit reached|out of budget|billing limit|credit balance|GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance)/i;
const OVERFLOW_ERRORS = [
	/prompt is too long/i,
	/request_too_large/i,
	/input is too long for requested model/i,
	/exceeds the context window/i,
	/exceeds (?:the )?(?:model'?s )?maximum context length/i,
	/input token count.*exceeds the maximum/i,
	/maximum prompt length is \d+/i,
	/reduce the length of the messages/i,
	/maximum context length is \d+ tokens/i,
	/exceeds (?:the )?maximum allowed input length/i,
	/is longer than the model'?s context length/i,
	/exceeds the limit of \d+/i,
	/exceeds the available context size/i,
	/greater than the context length/i,
	/context window exceeds limit/i,
	/exceeded model token limit/i,
	/too large for model with \d+ maximum context length/i,
	/prompt has [\d,]+ tokens?, but the configured context size is/i,
	/model_context_window_exceeded/i,
	/prompt too long; exceeded (?:max )?context length/i,
	/context[_ ]length[_ ]exceeded/i,
	/too many tokens/i,
	/token limit exceeded/i,
	/^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i,
];
const NON_OVERFLOW_ERRORS = [/^(Throttling error|Service unavailable):/i, /rate limit/i, /too many requests/i];

function isContextOverflow(message: AssistantFailure, contextWindow?: number): boolean {
	if (message.stopReason === "error" && message.errorMessage) {
		const excluded = NON_OVERFLOW_ERRORS.some((pattern) => pattern.test(message.errorMessage!));
		if (!excluded && OVERFLOW_ERRORS.some((pattern) => pattern.test(message.errorMessage!))) return true;
	}
	const inputTokens = message.usage.input + message.usage.cacheRead;
	if (contextWindow && message.stopReason === "stop" && inputTokens > contextWindow) return true;
	return Boolean(
		contextWindow
		&& message.stopReason === "length"
		&& message.usage.output === 0
		&& inputTokens >= contextWindow * 0.99,
	);
}

export function classifyAssistantError(message: AssistantFailure, contextWindow?: number): FailureCategory {
	if (message.stopReason === "aborted") return "none";
	if (isContextOverflow(message, contextWindow)) return "context-overflow";
	if (message.stopReason !== "error" || !message.errorMessage) return "none";
	if (!NON_RETRYABLE_LIMIT.test(message.errorMessage) && RETRYABLE_PROVIDER_ERROR.test(message.errorMessage)) {
		return "transient";
	}
	if (AUTH_OR_QUOTA_ERROR.test(message.errorMessage)) return "auth-quota";
	return "none";
}

export function formatStatus(state: RouterState): string | undefined {
	const active = state.active;
	if (!active) return undefined;
	const candidate = active.currentCandidate ?? modelKey(active.chain[0]!);
	return `skill:${active.ownerSkill} · ${active.profile} · ${candidate}`;
}

export interface DiagnosticsInput {
	currentModel?: ModelRef;
	thinkingLevel: ThinkingLevel;
	contextTokens: number | null | undefined;
	warnings: string[];
}

export function formatDiagnostics(state: RouterState, input: DiagnosticsInput): string {
	const active = state.active;
	const current = input.currentModel ? modelKey(input.currentModel) : "none";
	const owner = active ? `${active.ownerSkill} (${active.profile}, priority ${active.priority})` : "none";
	const chain = active
		? active.chain.map((candidate, index) => {
			const marker = index === active.candidateIndex ? "*" : " ";
			return `${marker}${modelKey(candidate)}@${candidate.thinkingLevel}`;
		}).join(" -> ")
		: "none";
	const original = active?.originalModel
		? `${modelKey(active.originalModel)}@${active.originalThinkingLevel}`
		: "none";
	const targetContext = active?.chain[0]?.contextWindow;
	const softCap = active
		? Math.min(...active.chain.map((candidate) => candidate.contextWindow)) - active.reserveTokens
		: undefined;
	const context = `${input.contextTokens ?? "unknown"} / target ${targetContext ?? "none"} / soft-cap ${softCap ?? "none"}`;
	const pending = state.pendingSwitch
		? `${state.operation}: ${modelKey(state.pendingSwitch.candidate)}`
		: state.operation;
	const warnings = input.warnings.length > 0 ? input.warnings.map((warning) => `- ${warning}`).join("\n") : "none";
	return [
		`Current: ${current}@${input.thinkingLevel}`,
		`Owner: ${owner}`,
		`Chain: ${chain}`,
		`Original: ${original}`,
		`Context: ${context}`,
		`Pending: ${pending}; compaction=${state.compactionRequested}; fallback=${Boolean(state.incident)}`,
		`Warnings:\n${warnings}`,
	].join("\n");
}


const AUDIT_FIELDS = [
	"event",
	"timestamp",
	"skill",
	"profile",
	"fromModel",
	"toModel",
	"category",
] as const;

/** Whitelist-only audit payload: never persist prompts, raw errors, reasons or credentials. */
export function sanitizeAuditEvent(input: Record<string, unknown>): Record<string, string | number> {
	const result: Record<string, string | number> = {};
	for (const field of AUDIT_FIELDS) {
		const value = input[field];
		if (typeof value === "string" || typeof value === "number") result[field] = value;
	}
	return result;
}
