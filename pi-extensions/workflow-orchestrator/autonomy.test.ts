// Issue #102, CA-2 y CA-9: gramática del dial de autonomía en Pi. `/issues
// --autonomy <level>` parsea el flag (antes descartaba sus args) y el
// orquestador lo propaga al despachar.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAutonomyLevel, parseIssuesCommandArgs, withAutonomy } from "./autonomy.ts";

test("parseAutonomyLevel acepta código o palabra sin distinguir mayúsculas y devuelve el código canónico", () => {
	for (const [token, code, name] of [
		["A1", "A1", "supervised"],
		["a1", "A1", "supervised"],
		["supervised", "A1", "supervised"],
		["Plan-Approved", "A2", "plan-approved"],
		["a2", "A2", "plan-approved"],
		["UNATTENDED", "A3", "unattended"],
		["A3", "A3", "unattended"],
	] as const) {
		const parsed = parseAutonomyLevel(token);
		assert.deepEqual(parsed, { ok: true, code, name }, token);
	}
});

test("parseAutonomyLevel rechaza A0/A4/A5 con el diagnóstico literal y cualquier otro token listando los válidos", () => {
	for (const token of ["A0", "manual", "a4", "auto-land", "A5", "auto-deploy"]) {
		assert.deepEqual(parseAutonomyLevel(token), { ok: false, message: `--autonomy ${token}: no soportado todavía (v1 honra A1–A3)` }, token);
	}
	for (const token of ["", "extreme", "A33", "supervised,plan-approved"]) {
		const parsed = parseAutonomyLevel(token);
		assert.equal(parsed.ok, false, token);
		if (!parsed.ok) assert.equal(parsed.message, `--autonomy ${token}: valor inválido; válidos: supervised (A1), plan-approved (A2), unattended (A3)`);
	}
});

test("parseIssuesCommandArgs lee --autonomy <level> de /issues, tolera espacios y rechaza valor ausente, repetido o tokens desconocidos", () => {
	assert.deepEqual(parseIssuesCommandArgs(""), { ok: true, autonomy: undefined });
	assert.deepEqual(parseIssuesCommandArgs("   "), { ok: true, autonomy: undefined });
	assert.deepEqual(parseIssuesCommandArgs("--autonomy A2"), { ok: true, autonomy: "A2" });
	assert.deepEqual(parseIssuesCommandArgs("  --autonomy   unattended "), { ok: true, autonomy: "A3" });
	assert.deepEqual(parseIssuesCommandArgs("--autonomy=plan-approved"), { ok: true, autonomy: "A2" });
	assert.deepEqual(parseIssuesCommandArgs("--autonomy"), { ok: false, message: "--autonomy: falta el nivel; válidos: supervised (A1), plan-approved (A2), unattended (A3)" });
	assert.deepEqual(parseIssuesCommandArgs("--autonomy --otro"), { ok: false, message: "--autonomy: falta el nivel; válidos: supervised (A1), plan-approved (A2), unattended (A3)" });
	assert.deepEqual(parseIssuesCommandArgs("--autonomy A2 --autonomy A3"), { ok: false, message: "--autonomy: repetido" });
	assert.deepEqual(parseIssuesCommandArgs("--autonomy A4"), { ok: false, message: "--autonomy A4: no soportado todavía (v1 honra A1–A3)" });
	assert.deepEqual(parseIssuesCommandArgs("#12 --autonomy A2"), { ok: false, message: "/issues no acepta argumentos además de --autonomy <level>: #12" });
});

test("withAutonomy agrega el flag canónico al final de los args y no toca los args sin nivel", () => {
	assert.equal(withAutonomy("#14", undefined), "#14");
	assert.equal(withAutonomy("#14", "A2"), "#14 --autonomy A2");
	assert.equal(withAutonomy("", "A3"), "--autonomy A3");
	assert.equal(withAutonomy("--from-grill \"id\"", "A1"), "--from-grill \"id\" --autonomy A1");
});
