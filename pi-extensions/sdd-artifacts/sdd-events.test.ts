import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	appendSddEvent,
	parseSddEventLine,
	recordSddEvents,
	serializeSddEvent,
	type SddEvent,
} from "./sdd-events.ts";

// Entradas independientes de los vectores normativos de docs/sdd-events-v1.md:
// refs decodificadas y `null` donde la línea dice `none`.
const VECTOR_INPUTS: SddEvent[] = [
	{ v: 1, ts: "2026-10-14T12:00:00Z", harness: "claude", event: "grill.paused", issue: null, spec: null, previous: null, grill: "2026-10-14-visualizacion-harness", pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T12:30:05Z", harness: "pi", event: "grill.finalized", issue: "owner/repo#9", spec: null, previous: null, grill: "session 9/á", pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T13:00:00Z", harness: "codex", event: "spec.published", issue: null, spec: ".sdd/specs/sdd-events.md", previous: null, grill: "2026-10-14-visualizacion-harness", pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T13:05:00Z", harness: "pi", event: "spec.moved", issue: "#93", spec: "#93", previous: ".sdd/specs/sdd-events.md", grill: "2026-10-14-visualizacion-harness", pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T13:10:00Z", harness: "opencode", event: "spec.approved", issue: "#93", spec: "#93", previous: null, grill: "2026-10-14-visualizacion-harness", pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T13:10:00Z", harness: "pi", event: "spec.superseded", issue: "#12", spec: ".sdd/specs/old.md", previous: null, grill: null, pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T14:00:00Z", harness: "claude", event: "run.started", issue: "#93", spec: "#93", previous: null, grill: "2026-10-14-visualizacion-harness", pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T15:45:59Z", harness: "claude", event: "run.pr-opened", issue: "#93", spec: "#93", previous: null, grill: "2026-10-14-visualizacion-harness", pr: [101, 102], reason: null },
	{ v: 1, ts: "2026-10-14T16:00:00Z", harness: "codex", event: "run.committed", issue: null, spec: ".sdd/specs/sdd-events.md", previous: null, grill: null, pr: [], reason: null },
	{ v: 1, ts: "2026-10-14T16:20:00Z", harness: "opencode", event: "run.failed", issue: null, spec: ".sdd/specs/sdd-events.md", previous: null, grill: null, pr: [], reason: "aborted" },
	{ v: 1, ts: "2026-10-14T16:25:00Z", harness: "pi", event: "run.failed", issue: "#93", spec: "#93", previous: null, grill: null, pr: [], reason: "interrupted" },
	{ v: 1, ts: "2026-10-15T09:00:00Z", harness: "pi", event: "land.merged", issue: "#93", spec: null, previous: null, grill: null, pr: [101], reason: null },
];

function vectorOf(event: string): SddEvent {
	const vector = VECTOR_INPUTS.find((input) => input.event === event);
	assert.ok(vector, `vector de ${event}`);
	return vector;
}

const CATALOG = [
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
];

async function readContract(): Promise<string> {
	return readFile(new URL("../../docs/sdd-events-v1.md", import.meta.url), "utf8");
}

async function conformanceVectors(): Promise<string[]> {
	const contract = await readContract();
	const block = contract.match(/<!-- conformance-vectors:start -->\n```jsonl\n([\s\S]*?)\n```\n<!-- conformance-vectors:end -->/);
	assert.ok(block, "bloque conformance-vectors presente");
	return (block[1] ?? "").split("\n");
}

// Línea canónica armada a mano para los casos negativos: JSON compacto con las
// claves en el orden normativo. No pasa por el serializer bajo prueba.
const BASE_WIRE = {
	v: 1,
	ts: "2026-10-14T14:00:00Z",
	harness: "claude",
	event: "run.started",
	issue: "#93",
	spec: "%2393",
	previous: "none",
	grill: "none",
	pr: [] as unknown,
	reason: "none",
};

function wire(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({ ...BASE_WIRE, ...overrides });
}

function diagnosticOf(line: string): string {
	const result = parseSddEventLine(line);
	assert.equal(result.kind, "invalid", `se esperaba inválida: ${line}`);
	return result.kind === "invalid" ? (result.diagnostics[0]?.code ?? "<sin diagnóstico>") : "<válida>";
}

test("CA-1: el doc normativo fija ubicación, gramática, claves, catálogo, refs y best-effort", async () => {
	const contract = await readContract();
	assert.match(contract, /`<git-common-dir>\/sdd\/events\.jsonl`/);
	assert.match(contract, /git rev-parse --path-format=absolute --git-common-dir/);
	assert.match(contract, /UTF-8/);
	assert.match(contract, /`LF`/);
	assert.match(contract, /at most 1024 bytes/);
	assert.match(contract, /`v`, `ts`, `harness`, `event`, `issue`, `spec`, `previous`, `grill`, `pr`, `reason`/);
	for (const event of CATALOG) {
		assert.match(contract, new RegExp(`^\\| \`${event.replace(".", "\\.")}\` \\|`, "m"), `fila del catálogo para ${event}`);
	}
	assert.match(contract, /\[`SDD-Tracking` v1\]\(\.\/sdd-tracking-v1\.md\)/);
	assert.match(contract, /exactly the `<ref>` encoding of `SDD-Tracking` v1/);
	assert.match(contract, /Appending is best-effort/);
	assert.match(contract, /MUST NOT block or fail/);
	assert.match(contract, /Consumers MUST skip invalid and unsupported lines/);
	assert.match(contract, /final\s+segment without its terminating `LF`/);
});

test("CA-1 (review #94): el doc nombra el escape real, printf '%s\\n', la transición de spec.approved y el puente spec.moved", async () => {
	const contract = await readContract();
	assert.match(contract, /escapes such as `\\u0041`/, "el ejemplo de escape es un escape JSON, no una A literal");
	assert.doesNotMatch(contract, /escapes such as `A`/);
	assert.match(contract, /`printf '%s\\n' "\$line"`/, "nombra la forma de printf que no interpreta los %HH");
	assert.match(contract, /never as the format/);
	assert.match(contract, /^\| `spec\.approved` \| [^|]*persisted state before the publication was not `approved`[^|]*\|/m);
	assert.match(contract, /^\| `spec\.moved` \| [^|]*\| `spec` ≠ `none`; `previous` ≠ `none`; `pr=\[\]` \|$/m);
	assert.match(contract, /In every event except `spec\.moved`, `previous` MUST be `none`/);
	assert.match(contract, /`#NN` is relative to the repository of the clone/);
});

test("CA-1: serializeSddEvent reproduce byte a byte cada vector del doc, con al menos uno por evento", async () => {
	const vectors = await conformanceVectors();
	assert.equal(vectors.length, VECTOR_INPUTS.length, "un vector por entrada");
	const lines = VECTOR_INPUTS.map((input) => {
		const serialized = serializeSddEvent(input);
		assert.equal(serialized.ok, true, JSON.stringify(serialized));
		return serialized.ok ? serialized.line : "";
	});
	assert.deepEqual(lines, vectors);
	assert.deepEqual([...new Set(VECTOR_INPUTS.map(({ event }) => event))].sort(), [...CATALOG].sort());
});

test("CA-2: parse(serialize(e)) devuelve e para todo vector", async () => {
	for (const line of await conformanceVectors()) {
		const parsed = parseSddEventLine(line);
		assert.equal(parsed.kind, "event", `${line}: ${JSON.stringify(parsed)}`);
		if (parsed.kind !== "event") continue;
		const reserialized = serializeSddEvent(parsed.event);
		assert.deepEqual(reserialized, { ok: true, line });
	}
	for (const input of VECTOR_INPUTS) {
		const serialized = serializeSddEvent(input);
		assert.equal(serialized.ok, true);
		if (serialized.ok) assert.deepEqual(parseSddEventLine(serialized.line), { kind: "event", event: input });
	}
});

test("CA-2: rechazo tipado con un código de diagnóstico por caso", () => {
	const longGrill = "g".repeat(1100);
	const cases: Array<[string, string, string]> = [
		["clave extra", wire({ extra: "x" }), "extra-key"],
		["clave faltante", JSON.stringify({ v: 1, ts: BASE_WIRE.ts, harness: "claude", event: "run.started", issue: "#93", spec: "%2393", previous: "none", grill: "none", pr: [] }), "missing-key"],
		["clave previous faltante", JSON.stringify({ v: 1, ts: BASE_WIRE.ts, harness: "claude", event: "run.started", issue: "#93", spec: "%2393", grill: "none", pr: [], reason: "none" }), "missing-key"],
		["clave repetida", wire().replace('"harness":"claude"', '"harness":"claude","harness":"pi"'), "duplicate-key"],
		["clave fuera de orden", JSON.stringify({ v: 1, harness: "claude", ts: BASE_WIRE.ts, event: "run.started", issue: "#93", spec: "%2393", previous: "none", grill: "none", pr: [], reason: "none" }), "key-order"],
		["previous fuera de orden", JSON.stringify({ v: 1, ts: BASE_WIRE.ts, harness: "claude", event: "run.started", issue: "#93", spec: "%2393", grill: "none", previous: "none", pr: [], reason: "none" }), "key-order"],
		["JSON truncado", wire().slice(0, 40), "invalid-json"],
		["JSON que no es objeto", "[1,2]", "invalid-json"],
		["línea vacía", "", "invalid-json"],
		["ts sin T ni Z", wire({ ts: "2026-10-14 14:00:00" }), "invalid-ts"],
		["ts con milisegundos", wire({ ts: "2026-10-14T14:00:00.000Z" }), "invalid-ts"],
		["ts con fecha imposible", wire({ ts: "2026-02-30T14:00:00Z" }), "invalid-ts"],
		["ts con hora 24", wire({ ts: "2026-10-14T24:00:00Z" }), "invalid-ts"],
		["ts que no es string", wire({ ts: 1760450400 }), "invalid-ts"],
		["harness desconocido", wire({ harness: "cursor" }), "invalid-harness"],
		["event fuera del catálogo", wire({ event: "run.merged" }), "invalid-event"],
		["issue sin #", wire({ issue: "93" }), "invalid-issue"],
		["issue con cero a la izquierda", wire({ issue: "#093" }), "invalid-issue"],
		["issue vacío", wire({ issue: "" }), "invalid-issue"],
		["ref con byte reservado crudo", wire({ grill: "session 9" }), "invalid-reference"],
		["ref con escape en minúscula", wire({ spec: ".sdd%2fspecs%2fx.md" }), "invalid-reference"],
		["ref con no reservado escapado", wire({ spec: "%41bc" }), "invalid-reference"],
		["ref vacía", wire({ spec: "" }), "invalid-reference"],
		["previous no canónica", wire({ event: "spec.moved", previous: ".sdd/specs/x.md" }), "invalid-reference"],
		["ref que no es string", wire({ grill: 7 }), "invalid-reference"],
		["pr que no es array", wire({ pr: "101" }), "invalid-pr"],
		["pr con cero", wire({ event: "land.merged", pr: [0] }), "invalid-pr"],
		["pr negativo", wire({ event: "land.merged", pr: [-1] }), "invalid-pr"],
		["pr con string", wire({ event: "land.merged", pr: ["101"] }), "invalid-pr"],
		["pr fraccionario", wire({ event: "land.merged", pr: [1.5] }), "invalid-pr"],
		["reason desconocido", wire({ reason: "crashed" }), "invalid-reason"],
		["línea de más de 1024 bytes", wire({ grill: longGrill }), "line-too-long"],
		["espacios no canónicos", wire().replace('"v":1,', '"v": 1,'), "non-canonical"],
		["escape JSON no canónico", wire().replace('"harness":"claude"', '"harness":"\\u0063laude"'), "non-canonical"],
		["número no canónico", wire({ event: "land.merged" }).replace('"pr":[]', '"pr":[101.0]'), "non-canonical"],
	];
	const problems: string[] = [];
	for (const [name, line, code] of cases) {
		const actual = diagnosticOf(line);
		if (actual !== code) problems.push(`${name}: esperaba ${code}, dio ${actual}`);
	}
	assert.deepEqual(problems, []);
});

test("CA-2: el límite de 1024 bytes incluye el LF: 1023 bytes de contenido pasan, 1024 no", () => {
	const filler = (length: number) => wire({ grill: "g".repeat(length) });
	const base = Buffer.byteLength(filler(0), "utf8");
	const fits = filler(1023 - base);
	const overflows = filler(1024 - base);
	assert.equal(Buffer.byteLength(fits, "utf8"), 1023);
	assert.equal(parseSddEventLine(fits).kind, "event");
	assert.equal(diagnosticOf(overflows), "line-too-long");
	const serialized = serializeSddEvent({ ...vectorOf("run.started"), grill: "g".repeat(2000) });
	assert.equal(serialized.ok, false);
	assert.equal(serialized.ok ? "" : serialized.diagnostics[0]?.code, "line-too-long");
});

test("CA-2: v distinto de 1 es unsupported-version, no inválido", () => {
	for (const line of [
		wire({ v: 2 }),
		JSON.stringify({ v: 2, ts: "2027-01-01T00:00:00.000Z", kind: "otra forma" }),
		wire({ v: "1" }),
	]) {
		const result = parseSddEventLine(line);
		assert.equal(result.kind, "unsupported-version", line);
		assert.equal(result.kind === "event" ? "" : result.diagnostics[0]?.code, "unsupported-version");
	}
	assert.equal(diagnosticOf(JSON.stringify({ ts: BASE_WIRE.ts })), "missing-key");
});

test("CA-2 (review #94): una línea con v distinto de 1 y claves repetidas sigue siendo unsupported-version", () => {
	const repeated = wire({ v: 2 }).replace('"harness":"claude"', '"harness":"claude","harness":"pi"');
	const result = parseSddEventLine(repeated);
	assert.equal(result.kind, "unsupported-version", JSON.stringify(result));
	assert.equal(diagnosticOf(wire().replace('"harness":"claude"', '"harness":"claude","harness":"pi"')), "duplicate-key", "con v=1 sigue siendo duplicate-key");
});

test("CA-2 (review #94): las claves repetidas se buscan recién sobre una línea acotada a 1024 bytes", () => {
	const repeatedAndLong = wire({ grill: "g".repeat(1100) }).replace('"harness":"claude"', '"harness":"claude","harness":"pi"');
	assert.equal(diagnosticOf(repeatedAndLong), "line-too-long");
});

test("CA-2: el parseo es total y nunca lanza", () => {
	const inputs = ["", " ", "null", "true", "1", "\"x\"", "{", "}", "{}", "{\"v\":1}", "\u0000", "\uD800", "{\"v\":1,\"v\":1}", "x".repeat(5000), `${wire()}\n`, `${wire()}\r`];
	for (const input of inputs) {
		assert.doesNotThrow(() => parseSddEventLine(input), JSON.stringify(input));
		assert.notEqual(parseSddEventLine(input).kind, "event", JSON.stringify(input));
	}
});

test("CA-2: sdd-events.ts solo importa rutas relativas y node:", async () => {
	const source = await readFile(new URL("./sdd-events.ts", import.meta.url), "utf8");
	const specifiers = [...source.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)"/gm)].map((match) => match[1] ?? "");
	assert.ok(specifiers.length > 0);
	assert.deepEqual(specifiers.filter((specifier) => !specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("node:")), []);
});

test("CA-3: cada invariante del catálogo produce su diagnóstico al parsear y al serializar", () => {
	const violations: Array<[string, Record<string, unknown>]> = [
		["grill.paused sin grill", { event: "grill.paused", grill: "none" }],
		["grill.paused con pr", { event: "grill.paused", grill: "g", pr: [1] }],
		["grill.finalized sin grill", { event: "grill.finalized", grill: "none" }],
		["grill.finalized con pr", { event: "grill.finalized", grill: "g", pr: [1] }],
		["spec.published sin spec", { event: "spec.published", spec: "none" }],
		["spec.published con pr", { event: "spec.published", pr: [1] }],
		["spec.approved sin spec", { event: "spec.approved", spec: "none" }],
		["spec.approved con pr", { event: "spec.approved", pr: [1] }],
		["spec.moved sin spec", { event: "spec.moved", spec: "none", previous: ".sdd%2Fspecs%2Fx.md" }],
		["spec.moved sin previous", { event: "spec.moved", previous: "none" }],
		["spec.moved con pr", { event: "spec.moved", previous: ".sdd%2Fspecs%2Fx.md", pr: [1] }],
		["previous en un evento que no es spec.moved", { event: "spec.published", previous: ".sdd%2Fspecs%2Fx.md" }],
		["previous en land.merged", { event: "land.merged", pr: [1], previous: ".sdd%2Fspecs%2Fx.md" }],
		["spec.superseded sin spec", { event: "spec.superseded", spec: "none" }],
		["spec.superseded con pr", { event: "spec.superseded", pr: [1] }],
		["run.started sin spec", { event: "run.started", spec: "none" }],
		["run.started con pr", { event: "run.started", pr: [1] }],
		["run.pr-opened sin spec", { event: "run.pr-opened", spec: "none", pr: [1] }],
		["run.pr-opened sin pr", { event: "run.pr-opened", pr: [] }],
		["run.committed sin spec", { event: "run.committed", spec: "none" }],
		["run.committed con pr", { event: "run.committed", pr: [1] }],
		["run.failed sin spec", { event: "run.failed", spec: "none", reason: "aborted" }],
		["run.failed con pr", { event: "run.failed", pr: [1], reason: "aborted" }],
		["run.failed sin reason", { event: "run.failed", reason: "none" }],
		["land.merged sin pr", { event: "land.merged", pr: [] }],
		["land.merged con dos pr", { event: "land.merged", pr: [1, 2] }],
		["reason en un evento que no es run.failed", { event: "run.started", reason: "aborted" }],
		["reason interrupted en land.merged", { event: "land.merged", pr: [1], reason: "interrupted" }],
	];
	const problems: string[] = [];
	for (const [name, overrides] of violations) {
		const parsedCode = diagnosticOf(wire(overrides));
		if (parsedCode !== "invariant-violation") problems.push(`parse ${name}: dio ${parsedCode}`);
		const model = {
			...vectorOf("run.started"),
			event: overrides.event,
			...(overrides.grill === undefined ? {} : { grill: overrides.grill === "none" ? null : overrides.grill }),
			...(overrides.spec === undefined ? {} : { spec: null }),
			...(overrides.previous === undefined ? {} : { previous: overrides.previous === "none" ? null : decodeURIComponent(String(overrides.previous)) }),
			...(overrides.pr === undefined ? {} : { pr: overrides.pr }),
			...(overrides.reason === undefined ? {} : { reason: overrides.reason === "none" ? null : overrides.reason }),
		} as SddEvent;
		const serialized = serializeSddEvent(model);
		const serializedCode = serialized.ok ? "<ok>" : serialized.diagnostics[0]?.code;
		if (serializedCode !== "invariant-violation") problems.push(`serialize ${name}: dio ${serializedCode}`);
	}
	assert.deepEqual(problems, []);
	assert.equal(parseSddEventLine(wire({ event: "land.merged", spec: "none", pr: [7] })).kind, "event", "land.merged admite spec none");
	assert.equal(parseSddEventLine(wire({ event: "spec.moved", previous: ".sdd%2Fspecs%2Fx.md" })).kind, "event", "spec.moved con spec y previous es válido");
});

function gitRepo(name: string): string {
	const base = realpathSync(mkdtempSync(join(tmpdir(), `sdd-events-${name}-`)));
	execFileSync("git", ["init", "-q", "-b", "main", base]);
	return base;
}

function commonDirOf(repo: string): string {
	return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repo, encoding: "utf8" }).trim();
}

test("CA-7: 20 appends concurrentes dejan intactas las líneas previas y suman 20 líneas válidas completas", async (t) => {
	const repo = gitRepo("concurrency");
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const log = join(commonDirOf(repo), "sdd", "events.jsonl");
	mkdirSync(join(commonDirOf(repo), "sdd"), { recursive: true });
	const previous = (await conformanceVectors()).slice(0, 3);
	writeFileSync(log, `${previous.join("\n")}\n`, "utf8");

	const results = await Promise.all(Array.from({ length: 20 }, (_unused, index) => appendSddEvent(repo, {
		...vectorOf("run.pr-opened"),
		pr: [index + 1, 1000 + index],
	})));
	assert.deepEqual(results.filter((result) => !result.ok), []);

	const content = readFileSync(log, "utf8");
	assert.ok(content.endsWith("\n"), "termina en LF");
	const lines = content.slice(0, -1).split("\n");
	assert.deepEqual(lines.slice(0, 3), previous, "líneas previas intactas");
	const appended = lines.slice(3);
	assert.equal(appended.length, 20);
	const prs = appended.map((line) => {
		const parsed = parseSddEventLine(line);
		assert.equal(parsed.kind, "event", line);
		return parsed.kind === "event" ? parsed.event.pr[0] : 0;
	});
	assert.deepEqual([...prs].sort((left, right) => (left ?? 0) - (right ?? 0)), Array.from({ length: 20 }, (_unused, index) => index + 1));
});

test("CA-6/7: appendSddEvent no lanza ante un destino que no se puede escribir ni fuera de git", async (t) => {
	const repo = gitRepo("unwritable");
	const outside = realpathSync(mkdtempSync(join(tmpdir(), "sdd-events-outside-")));
	t.after(() => {
		rmSync(repo, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});
	mkdirSync(join(commonDirOf(repo), "sdd", "events.jsonl"), { recursive: true });
	const blocked = await appendSddEvent(repo, VECTOR_INPUTS[0]!);
	assert.equal(blocked.ok, false);
	const notGit = await appendSddEvent(outside, VECTOR_INPUTS[0]!);
	assert.equal(notGit.ok, false);
	assert.deepEqual(execFileSync("ls", ["-A", outside], { encoding: "utf8" }), "", "fuera de git no escribe nada en el directorio");
});

test("recordSddEvents sella ts con el reloj inyectado y devuelve un aviso de una línea si falla", async (t) => {
	const repo = gitRepo("record");
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const now = () => new Date("2026-10-14T18:19:20.987Z");
	const fields = { event: "grill.paused" as const, issue: null, spec: null, previous: null, grill: "g-1", pr: [], reason: null };
	assert.equal(await recordSddEvents(repo, "pi", [fields], { now }), null);
	const log = join(commonDirOf(repo), "sdd", "events.jsonl");
	assert.equal(
		readFileSync(log, "utf8"),
		'{"v":1,"ts":"2026-10-14T18:19:20Z","harness":"pi","event":"grill.paused","issue":"none","spec":"none","previous":"none","grill":"g-1","pr":[],"reason":"none"}\n',
	);
	rmSync(log);
	mkdirSync(log);
	const warning = await recordSddEvents(repo, "pi", [fields, fields], { now });
	assert.ok(warning, "devuelve un aviso");
	assert.doesNotMatch(warning ?? "", /\n/, "el aviso es de una línea");
	assert.match(warning ?? "", /SDD event log/);
});

test("recordSddEvents (review #94) resuelve el common-dir una sola vez por lote", async (t) => {
	const repo = gitRepo("record-once");
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const common = commonDirOf(repo);
	const calls: string[][] = [];
	const runGit = async (args: readonly string[]) => {
		calls.push([...args]);
		return { code: 0, stdout: `${common}\n` };
	};
	const fields = { event: "grill.paused" as const, issue: null, spec: null, previous: null, grill: "g-1", pr: [], reason: null };
	assert.equal(await recordSddEvents(repo, "pi", [fields, fields, fields], { runGit }), null);
	assert.equal(calls.length, 1, "un solo git rev-parse para los 3 eventos");
	assert.equal(readFileSync(join(common, "sdd", "events.jsonl"), "utf8").split("\n").length - 1, 3);

	calls.length = 0;
	const outside = async (args: readonly string[]) => {
		calls.push([...args]);
		return { code: 128, stdout: "" };
	};
	const warning = await recordSddEvents(repo, "pi", [fields, fields], { runGit: outside });
	assert.equal(calls.length, 1, "fuera de git también se consulta una vez");
	assert.match(warning ?? "", /^SDD event log not updated \(2\/2 events\): no <git-common-dir>/);
});
