#!/usr/bin/env node
// Ensayo de niveles de autonomía (issue #102, CA-13). Lanza un hijo
// `claude -p --input-format stream-json --output-format stream-json
// --permission-prompt-tool stdio` que corre /grill, /chiche-spec o /chiche-run
// con --autonomy <nivel> sobre un proyecto de juguete, recibe cada pregunta como
// `control_request` `can_use_tool` de AskUserQuestion, la cuenta y responde la
// opción recomendada. unattended (A3) exige 0 preguntas y plan-approved (A2)
// hasta 3; al pasar el tope corta al hijo.
//
// Uso: node rehearsal-host.mjs --stage <grill|spec|run> --level <A2|A3>
//        [--fixture <dir>] [--claude <bin>] [--budget <usd>] [--timeout <s>]
//        [--request "<pedido>"] [--keep]
// stdout: `rehearsed <YYYY-MM-DD>` | `FAILED (<n> preguntas)` | `unrehearsed`
// exit:   0 rehearsed · 1 FAILED · 2 unrehearsed o error de uso
//
// Sin --fixture genera el proyecto de juguete en un directorio temporal fuera
// del repo y lo borra al terminar (salvo --keep). Es solo de Claude Code: el
// protocolo es el del SDK y puede cambiar; si el `init` del stream no lista
// AskUserQuestion o el hijo no termina, el veredicto es `unrehearsed`.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXED_REQUEST = "agregar un flag --json que imprima el resultado como JSON";
const CAPS = { A2: 3, A3: 0 };

function usage(message) {
	process.stderr.write(`${message}\n`);
	process.stdout.write("unrehearsed\n");
	process.exit(2);
}

function parseLevel(token) {
	const lower = String(token).toLowerCase();
	const table = { a1: "A1", supervised: "A1", a2: "A2", "plan-approved": "A2", a3: "A3", unattended: "A3" };
	if (table[lower]) return table[lower];
	if (["a0", "manual", "a4", "auto-land", "a5", "auto-deploy"].includes(lower)) {
		usage(`--autonomy ${token}: no soportado todavía (v1 honra A1–A3)`);
	}
	usage(`--autonomy ${token}: valor inválido; válidos: supervised (A1), plan-approved (A2), unattended (A3)`);
	return "A1";
}

function parseArgs(argv) {
	const options = { claude: "claude", budget: "1", timeout: 900, request: FIXED_REQUEST, keep: false };
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		const value = () => {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) usage(`${token}: falta el valor`);
			index += 1;
			return next;
		};
		switch (token) {
			case "--stage": options.stage = value(); break;
			case "--level": options.level = value(); break;
			case "--fixture": options.fixture = value(); break;
			case "--claude": options.claude = value(); break;
			case "--budget": options.budget = value(); break;
			case "--timeout": options.timeout = Number(value()); break;
			case "--request": options.request = value(); break;
			case "--keep": options.keep = true; break;
			default: usage(`argumento desconocido: ${token}`);
		}
	}
	if (!["grill", "spec", "run"].includes(options.stage)) usage("--stage: grill, spec o run");
	if (options.level === undefined) usage("--level: falta el nivel");
	options.code = parseLevel(options.level);
	if (!(options.code in CAPS)) usage(`--level ${options.level}: solo se ensayan plan-approved (A2) y unattended (A3)`);
	return options;
}

// Proyecto de juguete: CLI mínimo con node --test, contrato con ## Autonomy y
// una spec chica, en un repo git con branch main (chiche-run --no-pr lo exige).
function makeToyProject() {
	const root = mkdtempSync(join(tmpdir(), "chiche-rehearsal-"));
	const write = (relative, content) => {
		mkdirSync(join(root, relative, ".."), { recursive: true });
		writeFileSync(join(root, relative), content);
	};
	write("package.json", '{\n  "name": "mini-cli",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n');
	write("src/cli.mjs", [
		"export function sum(values) {",
		"  return values.reduce((acc, value) => acc + Number(value), 0);",
		"}",
		"",
		"export function format(total) {",
		"  return `Total: ${total}`;",
		"}",
		"",
		"if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {",
		"  console.log(format(sum(process.argv.slice(2))));",
		"}",
		"",
	].join("\n"));
	write("test/cli.test.mjs", [
		'import { test } from "node:test";',
		'import assert from "node:assert/strict";',
		'import { format, sum } from "../src/cli.mjs";',
		"",
		'test("suma los argumentos y formatea el total", () => {',
		'  assert.equal(format(sum(["1", "2", "3"])), "Total: 6");',
		"});",
		"",
	].join("\n"));
	const today = new Date().toISOString().slice(0, 10);
	write(".chiche/project.md", [
		"# Contrato de autonomia — mini-cli",
		`<!-- Generado por /chiche-init el ${today}. Refrescar con /chiche-init --update. -->`,
		`<!-- Chiche-Tracking: version=2; type=project; generated-at=${today} -->`,
		"",
		"## Stack",
		"CLI mínimo en Node.js (ESM, sin dependencias). `src/cli.mjs` suma los números que recibe por argv e imprime `Total: N`. Tests con `node:test`. Sin build.",
		"",
		"## Diseño",
		"Sin superficies UI.",
		"",
		"## Comandos",
		"| Accion | Comando | cwd | Estado | Duracion | Notas |",
		"|---|---|---|---|---|---|",
		`| tests | \`node --test\` | raiz | verificado ${today} | <1s | 1/1 |`,
		`| correr el CLI | \`node src/cli.mjs 1 2 3\` | raiz | verificado ${today} | <1s | imprime \`Total: 6\` |`,
		"",
		"## Ambientes",
		"Solo local. Sin servicios, base de datos, `.env` ni secretos. Branch default `main`, sin remote: /chiche-run termina en commit local.",
		"",
		"## Verificacion autonoma",
		"1. **Unitaria determinista:** `node --test`.",
		"2. **Probe del CLI:** `node src/cli.mjs <args>` y comparar la salida.",
		"",
		"## Autonomy",
		"| Stage | Level | Since | Rehearsed |",
		"|---|---|---|---|",
		`| grill | supervised | ${today} | — |`,
		`| spec | supervised | ${today} | — |`,
		`| run | supervised | ${today} | — |`,
		`| review | supervised | ${today} | — |`,
		`| land | supervised | ${today} | — |`,
		"",
		"| Action | Pattern | Reason |",
		"|---|---|---|",
		"| npm publish | npm publish | sin confirmacion humana |",
		"| git push origin main | git push .* main | solo via PR |",
		"",
		"## Politicas de generacion",
		"Sin politicas activas.",
		"",
		"## Decisiones humanas",
		"Ninguna.",
		"",
		"## Gaps",
		"- Sin lint ni typecheck.",
		"",
	].join("\n"));
	write(".chiche/specs/json-flag.md", [
		"# Spec — Flag --json del CLI",
		`<!-- Generada por /chiche-spec el ${today}. Fuente: pedido libre. Estado: draft -->`,
		"<!-- Chiche-Tracking: version=2; type=spec; state=draft; issue=none; grill=none; superseded-by=none -->",
		"",
		"## Qué hace esto",
		"`node src/cli.mjs --json 1 2 3` imprime `{\"total\":6}` en vez de `Total: 6`.",
		"",
		"## Comportamiento esperado",
		"- **CA-1 (ALTA).** Con `--json`, el CLI imprime un objeto JSON con la clave `total`; sin el flag, la salida de texto no cambia. Test en `test/cli.test.mjs`.",
		"",
		"## Plan de entrega",
		"| Capa | Etapa | CAs | Justificacion |",
		"|---|---|---|---|",
		"| 1 | json-flag | CA-1 | un solo PR |",
		"",
		"## Inferencias",
		"| # | Inferencia | Eleccion propuesta | Alternativa razonable | Confianza | Resolucion |",
		"|---|---|---|---|---|---|",
		"| 1 | Forma del JSON | `{\"total\": N}` compacto | indentado | alta | [ASSUMED] |",
		"",
		"## Verificabilidad",
		"ALTA: `node --test`.",
		"",
		"## Plan de verificacion",
		"- **CA-1:** `node --test`.",
		"",
	].join("\n"));
	const git = (...args) => spawnSync("git", ["-c", "user.name=chiche", "-c", "user.email=chiche@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
	git("init", "-q", "-b", "main");
	git("add", "-A");
	git("commit", "-q", "-m", "proyecto de juguete para el ensayo");
	return root;
}

function promptFor(stage, code, request) {
	if (stage === "grill") return `/grill ${request} --autonomy ${code}`;
	if (stage === "spec") return `/chiche-spec ${request} --autonomy ${code} --out local`;
	return `/chiche-run .chiche/specs/json-flag.md --autonomy ${code} --inline --no-pr`;
}

function recommendedAnswers(input) {
	const answers = {};
	for (const question of input?.questions ?? []) {
		const options = question.options ?? [];
		const recommended = options.find((option) => /\((?:Recomendado|Recommended)\)/i.test(option.label ?? "")) ?? options[0];
		if (recommended?.label !== undefined) answers[question.question] = recommended.label;
	}
	return answers;
}

const options = parseArgs(process.argv.slice(2));
const cap = CAPS[options.code];
const generated = options.fixture === undefined;
const fixture = options.fixture ?? makeToyProject();
process.stderr.write(`fixture: ${fixture}\n`);

const env = { ...process.env };
delete env.CLAUDECODE;
delete env.CLAUDE_CODE_ENTRYPOINT;
const child = spawn(options.claude, [
	"-p",
	"--input-format", "stream-json",
	"--output-format", "stream-json",
	"--verbose",
	"--permission-prompt-tool", "stdio",
	"--max-budget-usd", String(options.budget),
	"--no-session-persistence",
], { cwd: fixture, env, stdio: ["pipe", "pipe", "pipe"] });

let asked = 0;
let verdict = null;
let reason = "";
let buffer = "";
let killTimer = null;

function finish(value, why) {
	if (verdict !== null) return;
	verdict = value;
	reason = why;
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGTERM");
		killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
		killTimer.unref();
	}
}

const send = (message) => {
	if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`);
};

child.stdout.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (!line.trim()) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "system" && event.subtype === "init") {
			const tools = Array.isArray(event.tools) ? event.tools : [];
			if (!tools.includes("AskUserQuestion")) finish("unrehearsed", "init sin AskUserQuestion: el hijo no puede preguntar, el conteo no vale");
			continue;
		}
		if (event.type === "control_request") {
			const request = event.request ?? {};
			if (request.subtype === "can_use_tool" && request.tool_name === "AskUserQuestion") {
				asked += 1;
				process.stderr.write(`pregunta ${asked}: ${JSON.stringify(request.input?.questions?.map((question) => question.question) ?? [])}\n`);
				if (asked > cap) {
					process.stderr.write(`corte: tope de ${cap} preguntas superado\n`);
					finish(`FAILED (${asked} preguntas)`, "tope superado");
					continue;
				}
				send({ type: "control_response", response: { subtype: "success", request_id: event.request_id, response: { behavior: "allow", updatedInput: { ...request.input, answers: recommendedAnswers(request.input) } } } });
				continue;
			}
			if (request.subtype === "can_use_tool") {
				send({ type: "control_response", response: { subtype: "success", request_id: event.request_id, response: { behavior: "allow", updatedInput: request.input } } });
				continue;
			}
			send({ type: "control_response", response: { subtype: "success", request_id: event.request_id, response: {} } });
			continue;
		}
		if (event.type === "result") {
			if (verdict === null) {
				verdict = asked <= cap ? `rehearsed ${new Date().toISOString().slice(0, 10)}` : `FAILED (${asked} preguntas)`;
				reason = `result recibido; costo ${event.total_cost_usd ?? "?"} USD`;
			}
			child.stdin.end();
		}
	}
});

child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
child.on("error", (error) => finish("unrehearsed", `no se pudo lanzar ${options.claude}: ${error.message}`));

const timeout = setTimeout(() => finish("unrehearsed", `el hijo no terminó en ${options.timeout} s`), options.timeout * 1000);
timeout.unref();

send({ type: "user", message: { role: "user", content: promptFor(options.stage, options.code, options.request) }, parent_tool_use_id: null, session_id: "" });

child.on("close", (code, signal) => {
	clearTimeout(timeout);
	if (killTimer) clearTimeout(killTimer);
	if (verdict === null) {
		verdict = "unrehearsed";
		reason = `el hijo terminó sin result (exit ${code ?? signal})`;
	}
	process.stderr.write(`preguntas: ${asked} (tope ${cap}) · ${reason}\n`);
	if (generated && !options.keep) rmSync(fixture, { recursive: true, force: true });
	process.stdout.write(`${verdict}\n`);
	process.exit(verdict.startsWith("rehearsed") ? 0 : verdict.startsWith("FAILED") ? 1 : 2);
});
