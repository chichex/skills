export type SpecState = "draft" | "approved" | "implemented" | "superseded";
export type GrillState = "paused" | "finalized";
export type ArtifactType = "spec" | "grill" | "project";
export type IssueReference = `#${number}` | `${string}/${string}#${number}`;

export interface SpecMetadata {
	version: 1;
	type: "spec";
	state: SpecState;
	issue: IssueReference | null;
	grill: string | null;
	supersededBy: string | null;
}

export interface GrillMetadata {
	version: 1;
	type: "grill";
	state: GrillState;
	issue: IssueReference | null;
	grill: string;
	project: string;
}

export interface ProjectMetadata {
	version: 1;
	type: "project";
	generatedAt: string;
}

export type SddMetadata = SpecMetadata | GrillMetadata | ProjectMetadata;

export type DiagnosticCode =
	| "invalid-metadata"
	| "invalid-marker-syntax"
	| "unsupported-version"
	| "unknown-type"
	| "missing-key"
	| "extra-key"
	| "duplicate-key"
	| "key-order"
	| "invalid-state"
	| "invalid-reference"
	| "invalid-encoding"
	| "invalid-issue"
	| "invalid-date"
	| "invariant-violation"
	| "duplicate-canonical"
	| "conflicting-canonical"
	| "legacy-type-conflict"
	| "legacy-state-conflict"
	| "metadata-type-mismatch"
	| "identity-mismatch"
	| "duplicate-legacy-marker"
	| "missing-metadata";

export interface SddDiagnostic {
	code: DiagnosticCode;
	message: string;
	raw?: string;
}

export type NormalizedArtifactState = SpecState | GrillState | "unknown";
export type StateProvenance = "canonical" | "legacy-explicit" | "legacy-inferred" | "absent";

export interface NormalizedStateResult {
	value: NormalizedArtifactState;
	provenance: StateProvenance;
	raw?: string;
}

export interface LegacyMetadata {
	version: null;
	type: ArtifactType | "unknown";
	issue: IssueReference | null;
	grill: string | null;
	project: string | null;
	generatedAt: string | null;
	supersededBy: string | null;
}

export type ParseResult =
	| {
		kind: "metadata";
		format: "canonical";
		metadata: SddMetadata;
		raw: string;
		state: NormalizedStateResult;
		diagnostics: SddDiagnostic[];
	}
	| {
		kind: "metadata";
		format: "legacy";
		metadata: LegacyMetadata;
		raw: string;
		state: NormalizedStateResult;
		diagnostics: SddDiagnostic[];
	}
	| {
		kind: "absent";
		state: NormalizedStateResult;
		diagnostics: SddDiagnostic[];
	}
	| {
		kind: "invalid";
		raw: string;
		state: NormalizedStateResult;
		diagnostics: SddDiagnostic[];
	}
	| {
		kind: "conflict";
		raw: string[];
		state: NormalizedStateResult;
		diagnostics: SddDiagnostic[];
	};

export type SerializationResult =
	| { ok: true; marker: string }
	| { ok: false; diagnostics: SddDiagnostic[] };

export type UpsertResult =
	| { ok: true; document: string; marker: string; diagnostics: SddDiagnostic[] }
	| { ok: false; document: string; diagnostics: SddDiagnostic[] };

const UNRESERVED_BYTE = /^[A-Za-z0-9._~-]$/;

function encodeReference(value: string): string {
	return [...new TextEncoder().encode(value)]
		.map((byte) => {
			const character = String.fromCharCode(byte);
			return UNRESERVED_BYTE.test(character)
				? character
				: `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
		})
		.join("");
}

function serializeOptionalReference(value: string | null): string {
	return value === null ? "none" : encodeReference(value);
}

function failure(code: DiagnosticCode, message: string, raw?: string): SerializationResult {
	return { ok: false, diagnostics: [{ code, message, ...(raw === undefined ? {} : { raw }) }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaKeys(metadata: Record<string, unknown>, expected: readonly string[]): SerializationResult | undefined {
	const present = Object.keys(metadata);
	const missing = expected.find((key) => !Object.hasOwn(metadata, key));
	if (missing) return failure("missing-key", `Missing metadata key: ${missing}`, missing);
	const extra = present.find((key) => !expected.includes(key));
	if (extra) return failure("extra-key", `Unexpected metadata key: ${extra}`, extra);
	return undefined;
}

function isIssueReference(value: unknown): value is IssueReference {
	if (typeof value !== "string") return false;
	if (/^#[1-9]\d*$/.test(value)) return true;
	return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#[1-9]\d*$/.test(value);
}

function isWellFormedReference(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value === "none") return false;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return false;
		}
	}
	return true;
}

function isCalendarDate(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year === 0 || month < 1 || month > 12 || day < 1) return false;
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day <= (days[month - 1] ?? 0);
}

function validateMetadata(metadata: unknown): SerializationResult | undefined {
	if (!isRecord(metadata)) return failure("invalid-metadata", "Metadata must be an object");
	if (metadata.version !== 1) {
		return failure("unsupported-version", `Unsupported metadata version: ${String(metadata.version)}`);
	}
	if (metadata.type !== "spec" && metadata.type !== "grill" && metadata.type !== "project") {
		return failure("unknown-type", `Unknown metadata type: ${String(metadata.type)}`);
	}

	const expected = metadata.type === "spec"
		? ["version", "type", "state", "issue", "grill", "supersededBy"]
		: metadata.type === "grill"
			? ["version", "type", "state", "issue", "grill", "project"]
			: ["version", "type", "generatedAt"];
	const keyError = schemaKeys(metadata, expected);
	if (keyError) return keyError;

	if (metadata.type === "project") {
		return isCalendarDate(metadata.generatedAt)
			? undefined
			: failure("invalid-date", `Invalid generated-at date: ${String(metadata.generatedAt)}`);
	}

	if (metadata.issue !== null && !isIssueReference(metadata.issue)) {
		return failure("invalid-issue", `Invalid issue reference: ${String(metadata.issue)}`);
	}
	if (metadata.type === "spec") {
		if (!(["draft", "approved", "implemented", "superseded"] as unknown[]).includes(metadata.state)) {
			return failure("invalid-state", `Invalid spec state: ${String(metadata.state)}`);
		}
		if (metadata.grill !== null && !isWellFormedReference(metadata.grill)) {
			return failure("invalid-reference", `Invalid grill reference: ${String(metadata.grill)}`);
		}
		if (metadata.supersededBy !== null && !isWellFormedReference(metadata.supersededBy)) {
			return failure("invalid-reference", `Invalid superseded-by reference: ${String(metadata.supersededBy)}`);
		}
		if (metadata.state === "superseded" && metadata.supersededBy === null) {
			return failure("invariant-violation", "A superseded spec requires supersededBy");
		}
		if (metadata.state !== "superseded" && metadata.supersededBy !== null) {
			return failure("invariant-violation", "Only a superseded spec may have supersededBy");
		}
		return undefined;
	}

	if (!(["paused", "finalized"] as unknown[]).includes(metadata.state)) {
		return failure("invalid-state", `Invalid grill state: ${String(metadata.state)}`);
	}
	if (!isWellFormedReference(metadata.grill)) {
		return failure("invalid-reference", `Invalid grill reference: ${String(metadata.grill)}`);
	}
	if (!isWellFormedReference(metadata.project)) {
		return failure("invalid-reference", `Invalid project reference: ${String(metadata.project)}`);
	}
	return undefined;
}

export function serializeSddMetadata(metadata: SddMetadata): SerializationResult {
	const error = validateMetadata(metadata);
	if (error) return error;

	if (metadata.type === "spec") {
		return {
			ok: true,
			marker: `<!-- SDD-Tracking: version=1; type=spec; state=${metadata.state}; issue=${metadata.issue ?? "none"}; grill=${serializeOptionalReference(metadata.grill)}; superseded-by=${serializeOptionalReference(metadata.supersededBy)} -->`,
		};
	}
	if (metadata.type === "grill") {
		return {
			ok: true,
			marker: `<!-- SDD-Tracking: version=1; type=grill; state=${metadata.state}; issue=${metadata.issue ?? "none"}; grill=${encodeReference(metadata.grill)}; project=${encodeReference(metadata.project)} -->`,
		};
	}
	return {
		ok: true,
		marker: `<!-- SDD-Tracking: version=1; type=project; generated-at=${metadata.generatedAt} -->`,
	};
}

interface SourceLine {
	start: number;
	contentEnd: number;
	end: number;
	text: string;
	eol: "\n" | "\r\n" | "";
}

function sourceLines(markdown: string): SourceLine[] {
	const lines: SourceLine[] = [];
	let start = 0;
	while (start < markdown.length) {
		const newline = markdown.indexOf("\n", start);
		const end = newline === -1 ? markdown.length : newline + 1;
		const beforeNewline = newline === -1 ? markdown.length : newline;
		const hasCarriageReturn = beforeNewline > start && markdown[beforeNewline - 1] === "\r";
		const contentEnd = hasCarriageReturn ? beforeNewline - 1 : beforeNewline;
		lines.push({
			start,
			contentEnd,
			end,
			text: markdown.slice(start, contentEnd),
			eol: newline === -1 ? "" : hasCarriageReturn ? "\r\n" : "\n",
		});
		start = end;
	}
	return lines;
}

function preambleLines(markdown: string): SourceLine[] {
	const lines = sourceLines(markdown);
	const boundary = lines.findIndex((line) => /^##(?:[ \t]+.*|[ \t]*)$/.test(line.text));
	return boundary === -1 ? lines : lines.slice(0, boundary);
}

function markerLines(markdown: string): SourceLine[] {
	return preambleLines(markdown).filter((line) => /SDD-Tracking/i.test(line.text));
}

function absentState(): NormalizedStateResult {
	return { value: "unknown", provenance: "absent" };
}

function decodeReference(value: string): { ok: true; value: string } | { ok: false } {
	if (value.length === 0 || value === "none") return { ok: false };
	const bytes: number[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index] ?? "";
		if (UNRESERVED_BYTE.test(character)) {
			bytes.push(character.charCodeAt(0));
			continue;
		}
		if (character !== "%" || !/^[0-9A-F]{2}$/.test(value.slice(index + 1, index + 3))) {
			return { ok: false };
		}
		const byte = Number.parseInt(value.slice(index + 1, index + 3), 16);
		if (UNRESERVED_BYTE.test(String.fromCharCode(byte))) return { ok: false };
		bytes.push(byte);
		index += 2;
	}
	try {
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
		if (!isWellFormedReference(decoded) || encodeReference(decoded) !== value) return { ok: false };
		return { ok: true, value: decoded };
	} catch {
		return { ok: false };
	}
}

function canonicalDiagnostic(code: DiagnosticCode, message: string, raw: string): SddDiagnostic {
	return { code, message, raw };
}

function parseCanonicalMarker(raw: string): { metadata?: SddMetadata; diagnostics: SddDiagnostic[] } {
	const wrapper = /^<!-- SDD-Tracking: (.+) -->$/.exec(raw);
	if (!wrapper?.[1]) {
		return { diagnostics: [canonicalDiagnostic("invalid-marker-syntax", "Canonical marker wrapper is invalid", raw)] };
	}
	const pairs = wrapper[1].split("; ");
	const entries: Array<[string, string]> = [];
	for (const pair of pairs) {
		const match = /^([a-z][a-z-]*)=([^;=\s]+)$/.exec(pair);
		if (!match?.[1] || !match[2]) {
			return { diagnostics: [canonicalDiagnostic("invalid-marker-syntax", "Canonical field syntax is invalid", raw)] };
		}
		entries.push([match[1], match[2]]);
	}
	const keys = entries.map(([key]) => key);
	const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
	if (duplicate) {
		return { diagnostics: [canonicalDiagnostic("duplicate-key", `Repeated canonical key: ${duplicate}`, raw)] };
	}
	const values = new Map(entries);
	if (!values.has("version")) {
		return { diagnostics: [canonicalDiagnostic("missing-key", "Missing canonical key: version", raw)] };
	}
	if (values.get("version") !== "1") {
		return { diagnostics: [canonicalDiagnostic("unsupported-version", `Unsupported version: ${String(values.get("version"))}`, raw)] };
	}
	const type = values.get("type");
	if (type !== "spec" && type !== "grill" && type !== "project") {
		return { diagnostics: [canonicalDiagnostic("unknown-type", `Unknown artifact type: ${String(type)}`, raw)] };
	}
	const expected = type === "spec"
		? ["version", "type", "state", "issue", "grill", "superseded-by"]
		: type === "grill"
			? ["version", "type", "state", "issue", "grill", "project"]
			: ["version", "type", "generated-at"];
	const missing = expected.find((key) => !values.has(key));
	if (missing) {
		return { diagnostics: [canonicalDiagnostic("missing-key", `Missing canonical key: ${missing}`, raw)] };
	}
	const extra = keys.find((key) => !expected.includes(key));
	if (extra) {
		return { diagnostics: [canonicalDiagnostic("extra-key", `Unexpected canonical key: ${extra}`, raw)] };
	}
	if (keys.some((key, index) => key !== expected[index])) {
		return { diagnostics: [canonicalDiagnostic("key-order", "Canonical keys are out of order", raw)] };
	}

	let metadata: SddMetadata;
	if (type === "project") {
		metadata = { version: 1, type, generatedAt: values.get("generated-at") ?? "" };
	} else {
		const issueRaw = values.get("issue") ?? "";
		const issue = issueRaw === "none" ? null : isIssueReference(issueRaw) ? issueRaw : undefined;
		if (issue === undefined) {
			return { diagnostics: [canonicalDiagnostic("invalid-issue", `Invalid issue reference: ${issueRaw}`, raw)] };
		}
		const grillRaw = values.get("grill") ?? "";
		const grillDecoded = grillRaw === "none" ? null : decodeReference(grillRaw);
		if (grillDecoded !== null && !grillDecoded.ok) {
			return { diagnostics: [canonicalDiagnostic("invalid-encoding", `Invalid grill encoding: ${grillRaw}`, raw)] };
		}
		if (type === "spec") {
			const supersededRaw = values.get("superseded-by") ?? "";
			const supersededDecoded = supersededRaw === "none" ? null : decodeReference(supersededRaw);
			if (supersededDecoded !== null && !supersededDecoded.ok) {
				return { diagnostics: [canonicalDiagnostic("invalid-encoding", `Invalid superseded-by encoding: ${supersededRaw}`, raw)] };
			}
			metadata = {
				version: 1,
				type,
				state: values.get("state") as SpecState,
				issue,
				grill: grillDecoded === null ? null : grillDecoded.value,
				supersededBy: supersededDecoded === null ? null : supersededDecoded.value,
			};
		} else {
			const projectDecoded = decodeReference(values.get("project") ?? "");
			if (grillDecoded === null || !projectDecoded.ok) {
				return { diagnostics: [canonicalDiagnostic("invalid-encoding", "Required grill/project reference is invalid", raw)] };
			}
			metadata = {
				version: 1,
				type,
				state: values.get("state") as GrillState,
				issue,
				grill: grillDecoded.value,
				project: projectDecoded.value,
			};
		}
	}

	const serialized = serializeSddMetadata(metadata);
	if (!serialized.ok) return { diagnostics: serialized.diagnostics.map((diagnostic) => ({ ...diagnostic, raw })) };
	if (serialized.marker !== raw) {
		return { diagnostics: [canonicalDiagnostic("invalid-marker-syntax", "Canonical marker bytes are not deterministic", raw)] };
	}
	return { metadata, diagnostics: [] };
}

function normalizedLegacyText(value: string): string {
	return value
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

function normalizeLegacyState(raw: string): { value: NormalizedArtifactState; supersededBy: string | null } {
	const normalized = normalizedLegacyText(raw);
	if (normalized === "draft" || normalized === "borrador") return { value: "draft", supersededBy: null };
	if (normalized === "aprobada" || normalized === "approved" || normalized === "pendiente de ejecucion") {
		return { value: "approved", supersededBy: null };
	}
	if (normalized === "implementada" || normalized === "implemented") return { value: "implemented", supersededBy: null };
	if (normalized === "reemplazada" || normalized === "superseded") return { value: "superseded", supersededBy: null };
	const supersededMatch = /^(?:reemplazada por|superseded by) (.+)$/.exec(normalized);
	if (supersededMatch?.[1]) {
		const originalPrefix = /^\s*(?:reemplazada\s+por|superseded\s+by)\s+/iu.exec(raw);
		return {
			value: "superseded",
			supersededBy: originalPrefix ? raw.slice(originalPrefix[0].length).trim() : supersededMatch[1],
		};
	}
	if (normalized === "paused") return { value: "paused", supersededBy: null };
	if (normalized === "finalized") return { value: "finalized", supersededBy: null };
	return { value: "unknown", supersededBy: null };
}

interface LegacyStateCandidate {
	raw: string;
	line: string;
	value: NormalizedArtifactState;
	supersededBy: string | null;
}

function legacyStateCandidates(lines: SourceLine[]): LegacyStateCandidate[] {
	const candidates: LegacyStateCandidate[] = [];
	for (const line of lines) {
		const expression = /(?:Estado|Status)\s*:\s*(.*?)(?=(?:\.\s+(?:Proyecto|Project|Fuente|Source|Grill)\s*:)|\s*-->|$)/giu;
		for (const match of line.text.matchAll(expression)) {
			const raw = match[1]?.trim();
			if (!raw) continue;
			candidates.push({ raw, line: line.text, ...normalizeLegacyState(raw) });
		}
	}
	return candidates;
}

function fieldFromPreamble(lines: SourceLine[], labels: readonly string[]): string | null {
	const alternation = labels.join("|");
	const expression = new RegExp(`(?:${alternation})\\s*:\\s*(.*?)(?=(?:\\.\\s+(?:Estado|Status|Proyecto|Project|Fuente|Source|Grill)\\s*:)|\\s*-->|$)`, "iu");
	for (const line of lines) {
		const value = expression.exec(line.text)?.[1]?.trim();
		if (value) return value;
	}
	return null;
}

function historicalTracking(lines: SourceLine[]): { raw: string; fields: Map<string, string> } | undefined {
	for (const line of lines) {
		if (!/SDD-Tracking\s*:/i.test(line.text) || /(?:^|[;\s])(?:version|type)\s*=/i.test(line.text)) continue;
		const payload = /^<!--\s*SDD-Tracking\s*:\s*(.*?)\s*-->$/i.exec(line.text)?.[1];
		if (payload === undefined) return { raw: line.text, fields: new Map() };
		const fields = new Map<string, string>();
		for (const part of payload.split(";")) {
			const match = /^\s*([a-z][a-z-]*)\s*=\s*(.*?)\s*$/i.exec(part);
			if (match?.[1] && match[2] !== undefined) fields.set(match[1].toLowerCase(), match[2]);
		}
		return { raw: line.text, fields };
	}
	return undefined;
}

function legacyIssue(lines: SourceLine[], tracking: ReturnType<typeof historicalTracking>): IssueReference | null {
	const tracked = tracking?.fields.get("issue");
	if (tracked === "none") return null;
	if (isIssueReference(tracked)) return tracked;
	const source = fieldFromPreamble(lines, ["Fuente", "Source"]);
	const match = source?.match(/(?:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)?#[1-9]\d*/)?.[0];
	return isIssueReference(match) ? match : null;
}

function legacyReference(value: string | undefined | null): string | null {
	if (value === undefined || value === null || value.trim() === "" || value.trim() === "none") return null;
	return value.trim().replace(/\.$/, "");
}

function parseLegacyArtifact(markdown: string): ParseResult {
	const lines = preambleLines(markdown);
	const preamble = lines.map((line) => line.text).join("\n");
	const tracking = historicalTracking(lines);
	const states = legacyStateCandidates(lines);
	const distinctStates = new Set(states.map((state) => state.value === "unknown" ? `unknown:${normalizedLegacyText(state.raw)}` : state.value));
	if (distinctStates.size > 1) {
		return {
			kind: "conflict",
			raw: states.map((state) => state.line),
			state: absentState(),
			diagnostics: [{ code: "legacy-state-conflict", message: "Legacy state fields disagree" }],
		};
	}
	const explicit = states[0];
	const headings = lines.filter((line) => /^#(?!#)(?:[ \t]+|$)/.test(line.text));
	const hasSpecHeading = headings.some((line) => /^#\s+spec(?:\s|[—–-]|$)/i.test(line.text));
	const hasGrillHeading = headings.some((line) => /^#\s+grill(?:\s|[—–-]|$)/i.test(line.text));
	const hasProjectHeading = headings.some((line) => {
		const normalized = normalizedLegacyText(line.text);
		return normalized.startsWith("# contrato de autonomia") || normalized.startsWith("# autonomy contract");
	});
	const hasSpecGenerator = /(?:generada|generated)[^\n>]*sdd-spec/i.test(preamble);
	const hasProjectGenerator = /(?:generado|generated)[^\n>]*sdd-init/i.test(preamble);
	const hasHandoffFields = explicit !== undefined
		&& (explicit.value === "paused" || explicit.value === "finalized")
		&& /(?:Proyecto|Project)\s*:/i.test(preamble)
		&& /(?:Fuente|Source)\s*:/i.test(preamble);

	const typeSignals = new Set<ArtifactType>();
	if (hasSpecHeading || hasSpecGenerator || tracking) typeSignals.add("spec");
	if (hasGrillHeading || hasHandoffFields) typeSignals.add("grill");
	if (hasProjectHeading && hasProjectGenerator) typeSignals.add("project");
	if (explicit && ["draft", "approved", "implemented", "superseded"].includes(explicit.value)) {
		typeSignals.add("spec");
	}
	if (explicit?.value === "paused" || explicit?.value === "finalized") typeSignals.add("grill");
	if (typeSignals.size > 1) {
		return {
			kind: "conflict",
			raw: lines.filter((line) => /^(?:#|<!--)/.test(line.text)).map((line) => line.text),
			state: absentState(),
			diagnostics: [{ code: "legacy-type-conflict", message: "Legacy signals identify incompatible artifact types" }],
		};
	}

	const type = [...typeSignals][0] ?? "unknown";
	let state: NormalizedStateResult = explicit
		? { value: explicit.value, provenance: "legacy-explicit", raw: explicit.raw }
		: absentState();
	if (!explicit && type === "spec") {
		const executionHeading = sourceLines(markdown).some((line) => {
			const match = /^##[ \t]+(.+?)[ \t]*$/.exec(line.text);
			if (!match?.[1]) return false;
			return /^resultado de ejecucion(?:\s*\(.*\))?$/.test(normalizedLegacyText(match[1]));
		});
		if (executionHeading) state = { value: "implemented", provenance: "legacy-inferred" };
	}

	if (type === "unknown" && !explicit && !tracking) {
		return { kind: "absent", state: absentState(), diagnostics: [] };
	}
	const generatedLine = lines.find((line) => /(?:Generado|Generated)/i.test(line.text));
	const generatedAt = type === "project"
		? generatedLine?.text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null
		: null;
	const grill = legacyReference(tracking?.fields.get("grill") ?? fieldFromPreamble(lines, ["Grill"]));
	const project = legacyReference(fieldFromPreamble(lines, ["Proyecto", "Project"]));
	const metadata: LegacyMetadata = {
		version: null,
		type,
		issue: legacyIssue(lines, tracking),
		grill,
		project,
		generatedAt,
		supersededBy: explicit?.supersededBy ?? null,
	};
	return {
		kind: "metadata",
		format: "legacy",
		metadata,
		raw: tracking?.raw ?? explicit?.line ?? headings[0]?.text ?? generatedLine?.text ?? preamble,
		state,
		diagnostics: [],
	};
}

export function parseSddArtifact(markdown: string): ParseResult {
	if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
	const candidates = markerLines(markdown).filter((line) => /(?:^|[;\s])(?:version|type)\s*=/i.test(line.text));
	if (candidates.length === 0) return parseLegacyArtifact(markdown);
	const rawMarkers = candidates.map((candidate) => candidate.text);
	if (new Set(rawMarkers).size > 1) {
		return {
			kind: "conflict",
			raw: rawMarkers,
			state: absentState(),
			diagnostics: [{ code: "conflicting-canonical", message: "Canonical markers differ" }],
		};
	}
	const raw = rawMarkers[0] ?? "";
	const duplicateDiagnostics: SddDiagnostic[] = candidates.length > 1
		? [{ code: "duplicate-canonical", message: "Canonical marker is duplicated", raw }]
		: [];
	const parsed = parseCanonicalMarker(raw);
	if (!parsed.metadata) {
		return {
			kind: "invalid",
			raw,
			state: absentState(),
			diagnostics: [...parsed.diagnostics, ...duplicateDiagnostics],
		};
	}
	const metadata = parsed.metadata;
	return {
		kind: "metadata",
		format: "canonical",
		metadata,
		raw,
		state: metadata.type === "project"
			? absentState()
			: { value: metadata.state, provenance: "canonical", raw: metadata.state },
		diagnostics: [...parsed.diagnostics, ...duplicateDiagnostics],
	};
}

function upsertFailure(markdown: string, diagnostics: SddDiagnostic[]): UpsertResult {
	return { ok: false, document: markdown, diagnostics };
}

function preferredEol(markdown: string): "\n" | "\r\n" {
	const firstNewline = markdown.indexOf("\n");
	return firstNewline > 0 && markdown[firstNewline - 1] === "\r" ? "\r\n" : "\n";
}

function insertCanonicalMarker(markdown: string, marker: string): string {
	const eol = preferredEol(markdown);
	const lines = sourceLines(markdown);
	const first = lines[0];
	if (!first || !/^#(?!#)(?:[ \t]+|$)/.test(first.text)) {
		return markdown.length === 0 ? marker : `${marker}${eol}${markdown}`;
	}

	let lastInitialLine = 0;
	let index = 1;
	while (index < lines.length) {
		const opening = lines[index];
		if (!opening || !/^\s*<!--/.test(opening.text)) break;
		lastInitialLine = index;
		if (!/-->\s*$/.test(opening.text)) {
			let closed = false;
			for (index += 1; index < lines.length; index += 1) {
				const continuation = lines[index];
				if (!continuation) break;
				lastInitialLine = index;
				if (/-->\s*$/.test(continuation.text)) {
					closed = true;
					break;
				}
			}
			if (!closed) break;
		}
		index += 1;
	}
	const anchor = lines[lastInitialLine] ?? first;
	if (anchor.eol) {
		return `${markdown.slice(0, anchor.end)}${marker}${eol}${markdown.slice(anchor.end)}`;
	}
	return `${markdown}${eol}${marker}`;
}

export function upsertSddMetadata(markdown: string, metadata: SddMetadata): UpsertResult {
	if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
	const serialized = serializeSddMetadata(metadata);
	if (!serialized.ok) return upsertFailure(markdown, serialized.diagnostics);

	const parsed = parseSddArtifact(markdown);
	if (parsed.kind === "invalid" || parsed.kind === "conflict") {
		return upsertFailure(markdown, parsed.diagnostics);
	}
	if (parsed.kind === "metadata" && parsed.metadata.type !== "unknown" && parsed.metadata.type !== metadata.type) {
		return upsertFailure(markdown, [{
			code: "metadata-type-mismatch",
			message: `Cannot replace ${parsed.metadata.type} metadata with ${metadata.type} metadata`,
		}]);
	}

	const trackingLines = markerLines(markdown);
	const canonical = trackingLines.filter((line) => /(?:^|[;\s])(?:version|type)\s*=/i.test(line.text));
	const historical = trackingLines.filter((line) => !/(?:^|[;\s])(?:version|type)\s*=/i.test(line.text));
	let document: string;
	if (canonical.length > 0) {
		const retained = canonical[0];
		document = markdown;
		for (const line of [...trackingLines].sort((left, right) => right.start - left.start)) {
			if (line === retained) {
				document = `${document.slice(0, line.start)}${serialized.marker}${document.slice(line.contentEnd)}`;
			} else {
				document = `${document.slice(0, line.start)}${document.slice(line.end)}`;
			}
		}
	} else if (historical.length > 1) {
		return upsertFailure(markdown, [{
			code: "duplicate-legacy-marker",
			message: "More than one historical SDD-Tracking marker is present",
		}]);
	} else if (historical[0]) {
		const tracking = historicalTracking(preambleLines(markdown));
		if (metadata.type !== "spec") {
			return upsertFailure(markdown, [{ code: "metadata-type-mismatch", message: "Historical SDD-Tracking identifies a spec" }]);
		}
		const trackedIssue = tracking?.fields.get("issue");
		const trackedGrill = legacyReference(tracking?.fields.get("grill"));
		const issueMatches = trackedIssue !== undefined
			&& (trackedIssue === "none" ? metadata.issue === null : metadata.issue === trackedIssue);
		const grillMatches = tracking?.fields.has("grill") === true && metadata.grill === trackedGrill;
		if (!issueMatches || !grillMatches) {
			return upsertFailure(markdown, [{
				code: "identity-mismatch",
				message: "Canonical metadata does not preserve historical issue/grill identity",
			}]);
		}
		const marker = historical[0];
		document = `${markdown.slice(0, marker.start)}${serialized.marker}${markdown.slice(marker.contentEnd)}`;
	} else {
		document = insertCanonicalMarker(markdown, serialized.marker);
	}
	return { ok: true, document, marker: serialized.marker, diagnostics: parsed.diagnostics };
}

export function updateSddSpecState(markdown: string, state: SpecState): UpsertResult {
	if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
	if (!(state === "draft" || state === "approved" || state === "implemented" || state === "superseded")) {
		return upsertFailure(markdown, [{ code: "invalid-state", message: `Invalid spec state: ${String(state)}` }]);
	}
	const parsed = parseSddArtifact(markdown);
	if (parsed.kind === "invalid" || parsed.kind === "conflict") return upsertFailure(markdown, parsed.diagnostics);
	if (parsed.kind === "absent") {
		return upsertFailure(markdown, [{ code: "missing-metadata", message: "No spec metadata is available to preserve" }]);
	}
	if (parsed.metadata.type !== "spec") {
		return upsertFailure(markdown, [{
			code: "metadata-type-mismatch",
			message: `Cannot update spec state on ${parsed.metadata.type} metadata`,
		}]);
	}

	const existing: SpecMetadata = parsed.format === "canonical"
		? parsed.metadata
		: {
			version: 1,
			type: "spec",
			state: parsed.state.value === "draft"
				|| parsed.state.value === "approved"
				|| parsed.state.value === "implemented"
				|| parsed.state.value === "superseded"
				? parsed.state.value
				: "draft",
			issue: parsed.metadata.issue,
			grill: parsed.metadata.grill,
			supersededBy: parsed.metadata.supersededBy,
		};
	if (state === "superseded" && existing.supersededBy === null) {
		return upsertFailure(markdown, [{
			code: "invariant-violation",
			message: "A state-only transition to superseded requires an existing superseded-by reference",
		}]);
	}
	if (state !== "superseded" && existing.supersededBy !== null) {
		return upsertFailure(markdown, [{
			code: "invariant-violation",
			message: "A state-only transition cannot discard superseded-by identity",
		}]);
	}
	return upsertSddMetadata(markdown, { ...existing, state });
}
