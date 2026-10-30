// Log local de eventos SDD (events-v1, issue #93). El formato normativo vive en
// docs/sdd-events-v1.md: una línea JSON canónica por evento en
// <git-common-dir>/sdd/events.jsonl, append-only y best-effort. Este módulo
// serializa, parsea (parseo total, nunca lanza) y agrega líneas; las
// referencias `spec`/`grill` usan el mismo codec `<ref>` que SDD-Tracking v1.

import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

import { resolveGitCommonDir, type GitRunner } from "../lib/chiche-paths.ts";
import {
	decodeReference,
	encodeReference,
	isCalendarDate,
	isIssueReference,
	type IssueReference,
} from "./index.ts";

export const SDD_EVENT_HARNESSES = ["claude", "codex", "opencode", "pi", "antigravity"] as const;
export type SddEventHarness = (typeof SDD_EVENT_HARNESSES)[number];

export const SDD_EVENT_NAMES = [
	"grill.paused",
	"grill.finalized",
	"spec.published",
	"spec.moved",
	"spec.approved",
	"spec.superseded",
	"run.started",
	"run.pr-opened",
	"run.committed",
	"run.failed",
	"land.merged",
] as const;
export type SddEventName = (typeof SDD_EVENT_NAMES)[number];

export type SddEventReason = "aborted" | "interrupted";

export interface SddEvent {
	v: 1;
	ts: string;
	harness: SddEventHarness;
	event: SddEventName;
	issue: IssueReference | null;
	spec: string | null;
	/** Identidad anterior de la spec: solo en `spec.moved`, `null` en el resto. */
	previous: string | null;
	grill: string | null;
	pr: number[];
	reason: SddEventReason | null;
}

/** Lo que aporta quien produce el evento; `v`, `ts` y `harness` los sella el registro. */
export type SddEventFields = Pick<SddEvent, "event" | "issue" | "spec" | "previous" | "grill" | "pr" | "reason">;

export type SddEventDiagnosticCode =
	| "invalid-json"
	| "duplicate-key"
	| "missing-key"
	| "extra-key"
	| "key-order"
	| "line-too-long"
	| "invalid-ts"
	| "invalid-harness"
	| "invalid-event"
	| "invalid-issue"
	| "invalid-reference"
	| "invalid-pr"
	| "invalid-reason"
	| "invariant-violation"
	| "non-canonical"
	| "unsupported-version";

export interface SddEventDiagnostic {
	code: SddEventDiagnosticCode;
	message: string;
}

export type SddEventSerialization = { ok: true; line: string } | { ok: false; diagnostics: SddEventDiagnostic[] };

export type SddEventParseResult =
	| { kind: "event"; event: SddEvent }
	| { kind: "unsupported-version"; diagnostics: SddEventDiagnostic[] }
	| { kind: "invalid"; diagnostics: SddEventDiagnostic[] };

export type SddEventAppendResult = { ok: true; path: string } | { ok: false; message: string };

export const SDD_EVENT_KEYS = ["v", "ts", "harness", "event", "issue", "spec", "previous", "grill", "pr", "reason"] as const;
/** Tope de una línea, contando su LF final. */
export const SDD_EVENT_MAX_LINE_BYTES = 1024;
export const SDD_EVENTS_FILE = "events.jsonl";

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/;

function diagnostic(code: SddEventDiagnosticCode, message: string): SddEventDiagnostic {
	return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function isTimestamp(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = TIMESTAMP.exec(value);
	return match !== null && isCalendarDate(match[1]);
}

function isReference(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const decoded = decodeReference(encodeReference(value));
	return decoded.ok && decoded.value === value;
}

function isPrList(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && (item as number) > 0);
}

function invariantProblem(event: SddEvent): string | null {
	if (event.event === "run.failed") {
		if (event.reason === null) return "run.failed requires reason=aborted or reason=interrupted";
	} else if (event.reason !== null) {
		return `${event.event} requires reason=none`;
	}
	if (event.event === "spec.moved") {
		if (event.spec === null) return "spec.moved requires spec";
		if (event.previous === null) return "spec.moved requires previous";
		return event.pr.length === 0 ? null : "spec.moved requires pr=[]";
	}
	if (event.previous !== null) return `${event.event} requires previous=none`;
	if (event.event === "grill.paused" || event.event === "grill.finalized") {
		if (event.grill === null) return `${event.event} requires grill`;
		return event.pr.length === 0 ? null : `${event.event} requires pr=[]`;
	}
	if (event.event === "land.merged") {
		return event.pr.length === 1 ? null : "land.merged requires exactly one pr";
	}
	if (event.spec === null) return `${event.event} requires spec`;
	if (event.event === "run.pr-opened") {
		return event.pr.length > 0 ? null : "run.pr-opened requires at least one pr";
	}
	return event.pr.length === 0 ? null : `${event.event} requires pr=[]`;
}

// Valida un evento del modelo (refs decodificadas, `null` por `none`) con las
// claves ya verificadas. Devuelve el primer problema.
function eventProblem(event: Record<string, unknown>): SddEventDiagnostic | null {
	if (!isTimestamp(event.ts)) return diagnostic("invalid-ts", `Invalid ts: ${String(event.ts)}`);
	if (!(SDD_EVENT_HARNESSES as readonly unknown[]).includes(event.harness)) {
		return diagnostic("invalid-harness", `Invalid harness: ${String(event.harness)}`);
	}
	if (!(SDD_EVENT_NAMES as readonly unknown[]).includes(event.event)) {
		return diagnostic("invalid-event", `Invalid event: ${String(event.event)}`);
	}
	if (event.issue !== null && !isIssueReference(event.issue)) {
		return diagnostic("invalid-issue", `Invalid issue: ${String(event.issue)}`);
	}
	for (const key of ["spec", "previous", "grill"] as const) {
		if (event[key] !== null && !isReference(event[key])) {
			return diagnostic("invalid-reference", `Invalid ${key} reference: ${String(event[key])}`);
		}
	}
	if (!isPrList(event.pr)) return diagnostic("invalid-pr", "pr must be an array of positive integers");
	if (event.reason !== null && event.reason !== "aborted" && event.reason !== "interrupted") {
		return diagnostic("invalid-reason", `Invalid reason: ${String(event.reason)}`);
	}
	const invariant = invariantProblem(event as unknown as SddEvent);
	return invariant === null ? null : diagnostic("invariant-violation", invariant);
}

// Claves faltantes, extra y, si `ordered`, fuera de orden. Un objeto del
// modelo no tiene orden de claves: el serializer lo saltea y la línea sale
// siempre en el orden canónico.
function keyProblem(keys: readonly string[], ordered: boolean): SddEventDiagnostic | null {
	const missing = SDD_EVENT_KEYS.find((key) => !keys.includes(key));
	if (missing !== undefined) return diagnostic("missing-key", `Missing key: ${missing}`);
	const extra = keys.find((key) => !(SDD_EVENT_KEYS as readonly string[]).includes(key));
	if (extra !== undefined) return diagnostic("extra-key", `Unexpected key: ${extra}`);
	if (ordered && keys.some((key, index) => key !== SDD_EVENT_KEYS[index])) {
		return diagnostic("key-order", "Keys are out of order");
	}
	return null;
}

function wireReference(value: string | null): string {
	return value === null ? "none" : encodeReference(value);
}

export function serializeSddEvent(event: SddEvent): SddEventSerialization {
	const failure = (problem: SddEventDiagnostic): SddEventSerialization => ({ ok: false, diagnostics: [problem] });
	if (!isRecord(event)) return failure(diagnostic("invalid-json", "An SDD event must be an object"));
	if (!Object.hasOwn(event, "v")) return failure(diagnostic("missing-key", "Missing key: v"));
	if (event.v !== 1) return failure(diagnostic("unsupported-version", `Unsupported version: ${String(event.v)}`));
	const keyError = keyProblem(Object.keys(event), false);
	if (keyError) return failure(keyError);
	const problem = eventProblem(event as unknown as Record<string, unknown>);
	if (problem) return failure(problem);

	const line = `{"v":1,"ts":"${event.ts}","harness":"${event.harness}","event":"${event.event}","issue":"${event.issue ?? "none"}","spec":"${wireReference(event.spec)}","previous":"${wireReference(event.previous)}","grill":"${wireReference(event.grill)}","pr":[${event.pr.join(",")}],"reason":"${event.reason ?? "none"}"}`;
	if (byteLength(line) + 1 > SDD_EVENT_MAX_LINE_BYTES) {
		return failure(diagnostic("line-too-long", `The line exceeds ${SDD_EVENT_MAX_LINE_BYTES} bytes with its LF`));
	}
	return { ok: true, line };
}

function stringEnd(text: string, start: number): number {
	let index = start + 1;
	while (index < text.length) {
		const character = text[index];
		if (character === "\\") {
			index += 2;
			continue;
		}
		if (character === "\"") return index + 1;
		index += 1;
	}
	return text.length;
}

// Claves del objeto de primer nivel en el orden en que aparecen, incluidas las
// repetidas (JSON.parse se queda con la última y las esconde). Recibe texto
// que JSON.parse ya aceptó como objeto.
function topLevelKeys(text: string): string[] {
	const keys: string[] = [];
	let depth = 0;
	let index = 0;
	while (index < text.length) {
		const character = text[index];
		if (character === "\"") {
			const end = stringEnd(text, index);
			if (depth === 1) {
				let next = end;
				while (next < text.length && " \t\n\r".includes(text[next] ?? "")) next += 1;
				if (text[next] === ":") keys.push(JSON.parse(text.slice(index, end)) as string);
			}
			index = end;
			continue;
		}
		if (character === "{" || character === "[") depth += 1;
		else if (character === "}" || character === "]") depth -= 1;
		index += 1;
	}
	return keys;
}

type WireValue<T> = { ok: true; value: T } | { ok: false };

function wireNullable(value: unknown): WireValue<string | null> {
	if (typeof value !== "string") return { ok: false };
	return { ok: true, value: value === "none" ? null : value };
}

function wireRef(value: unknown): WireValue<string | null> {
	if (value === "none") return { ok: true, value: null };
	if (typeof value !== "string") return { ok: false };
	const decoded = decodeReference(value);
	return decoded.ok ? { ok: true, value: decoded.value } : { ok: false };
}

function invalid(code: SddEventDiagnosticCode, message: string): SddEventParseResult {
	return { kind: "invalid", diagnostics: [diagnostic(code, message)] };
}

function parseLine(line: string): SddEventParseResult {
	if (typeof line !== "string") return invalid("invalid-json", "A line must be a string");
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return invalid("invalid-json", "The line is not valid JSON");
	}
	if (!isRecord(value)) return invalid("invalid-json", "The line is not a JSON object");
	if (!Object.hasOwn(value, "v")) return invalid("missing-key", "Missing key: v");
	if (value.v !== 1) {
		return {
			kind: "unsupported-version",
			diagnostics: [diagnostic("unsupported-version", `Unsupported version: ${JSON.stringify(value.v)}`)],
		};
	}
	if (byteLength(line) + 1 > SDD_EVENT_MAX_LINE_BYTES) {
		return invalid("line-too-long", `The line exceeds ${SDD_EVENT_MAX_LINE_BYTES} bytes with its LF`);
	}
	// Recién acá, con v=1 y la línea acotada: las claves de otra versión no se
	// juzgan, y el escaneo corre sobre a lo sumo 1024 bytes.
	const keys = topLevelKeys(line);
	const seen = new Set<string>();
	const duplicate = keys.find((key) => seen.has(key) || (seen.add(key), false));
	if (duplicate !== undefined) return invalid("duplicate-key", `Repeated key: ${duplicate}`);
	const keyError = keyProblem(keys, true);
	if (keyError) return { kind: "invalid", diagnostics: [keyError] };

	const issue = wireNullable(value.issue);
	if (!issue.ok) return invalid("invalid-issue", "issue must be a string");
	const spec = wireRef(value.spec);
	if (!spec.ok) return invalid("invalid-reference", `Invalid spec reference: ${JSON.stringify(value.spec)}`);
	const previous = wireRef(value.previous);
	if (!previous.ok) return invalid("invalid-reference", `Invalid previous reference: ${JSON.stringify(value.previous)}`);
	const grill = wireRef(value.grill);
	if (!grill.ok) return invalid("invalid-reference", `Invalid grill reference: ${JSON.stringify(value.grill)}`);
	const reason = wireNullable(value.reason);
	if (!reason.ok) return invalid("invalid-reason", "reason must be a string");

	const event = {
		v: 1,
		ts: value.ts,
		harness: value.harness,
		event: value.event,
		issue: issue.value,
		spec: spec.value,
		previous: previous.value,
		grill: grill.value,
		pr: value.pr,
		reason: reason.value,
	} as unknown as SddEvent;
	// El serializer valida el evento (eventProblem) y devuelve su diagnóstico.
	const canonical = serializeSddEvent(event);
	if (!canonical.ok) return { kind: "invalid", diagnostics: canonical.diagnostics };
	if (canonical.line !== line) return invalid("non-canonical", "The line is not in its canonical byte form");
	return { kind: "event", event };
}

/** Parseo total de una línea sin su LF: nunca lanza. */
export function parseSddEventLine(line: string): SddEventParseResult {
	try {
		return parseLine(line);
	} catch (error) {
		return invalid("invalid-json", error instanceof Error ? error.message : String(error));
	}
}

/** `ts` en UTC con precisión de segundos: trunca los milisegundos. */
export function sddEventTimestamp(date: Date): string {
	return `${date.toISOString().slice(0, 19)}Z`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function notGitMessage(projectRoot: string): string {
	return `no <git-common-dir> for ${projectRoot}: not a Git repository`;
}

// Un solo write en modo append (O_APPEND) sobre `<commonDir>/sdd/events.jsonl`,
// con el common-dir ya resuelto. Nunca lanza.
async function appendToCommonDir(commonDir: string, event: SddEvent): Promise<SddEventAppendResult> {
	try {
		const serialized = serializeSddEvent(event);
		if (!serialized.ok) {
			const [first] = serialized.diagnostics;
			return { ok: false, message: `invalid event (${first?.code}): ${first?.message}` };
		}
		const directory = join(commonDir, "sdd");
		await mkdir(directory, { recursive: true });
		const path = join(directory, SDD_EVENTS_FILE);
		const bytes = new TextEncoder().encode(`${serialized.line}\n`);
		const handle = await open(path, "a");
		try {
			const { bytesWritten } = await handle.write(bytes, 0, bytes.length);
			if (bytesWritten !== bytes.length) return { ok: false, message: `short write to ${path}` };
		} finally {
			await handle.close();
		}
		return { ok: true, path };
	} catch (error) {
		return { ok: false, message: oneLine(error instanceof Error ? error.message : String(error)) };
	}
}

/**
 * Agrega una línea a `<git-common-dir>/sdd/events.jsonl` de `projectRoot` con
 * un solo write en modo append (O_APPEND), sin lock. Nunca lanza: fuera de git,
 * sin permiso o con `events.jsonl` como directorio devuelve `ok: false` y no
 * escribe en ningún otro lugar.
 */
export async function appendSddEvent(
	projectRoot: string,
	event: SddEvent,
	options: { runGit?: GitRunner } = {},
): Promise<SddEventAppendResult> {
	const commonDir = await resolveGitCommonDir(projectRoot, options.runGit);
	if (commonDir === null) return { ok: false, message: notGitMessage(projectRoot) };
	return appendToCommonDir(commonDir, event);
}

/**
 * Registra eventos best-effort: sella `v`, `ts` y `harness` y los agrega en
 * orden. Devuelve `null` si todos se agregaron, o un aviso de una sola línea
 * para sumar al resultado de quien los produjo, que nunca falla por esto.
 */
export async function recordSddEvents(
	projectRoot: string,
	harness: SddEventHarness,
	events: SddEventFields[],
	options: { now?: () => Date; runGit?: GitRunner } = {},
): Promise<string | null> {
	if (events.length === 0) return null;
	const now = options.now ?? (() => new Date());
	// Un solo `git rev-parse` por lote: fuera de git, un único diagnóstico.
	const commonDir = await resolveGitCommonDir(projectRoot, options.runGit);
	const failures: string[] = [];
	for (const fields of events) {
		if (commonDir === null) {
			failures.push(notGitMessage(projectRoot));
			continue;
		}
		const outcome = await appendToCommonDir(commonDir, { v: 1, ts: sddEventTimestamp(now()), harness, ...fields });
		if (!outcome.ok) failures.push(outcome.message);
	}
	if (failures.length === 0) return null;
	return oneLine(`SDD event log not updated (${failures.length}/${events.length} events): ${failures[0]}`);
}
