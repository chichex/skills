// Gramática del dial de autonomía en Pi (issue #102, CA-2 y CA-9). Es la misma
// escala que el bloque `autonomy-levels` de los skills: v1 honra A1 a A3; A0,
// A4 y A5 abortan con el diagnóstico literal y cualquier otro token lista los
// válidos. `/issues --autonomy <level>` la usa para parsear su único flag y el
// orquestador la usa para agregar el flag a los args de cada ruta despachada.

export type AutonomyCode = "A1" | "A2" | "A3";
export type AutonomyName = "supervised" | "plan-approved" | "unattended";

export type ParsedAutonomy =
	| { ok: true; code: AutonomyCode; name: AutonomyName }
	| { ok: false; message: string };

const SUPPORTED: Array<{ code: AutonomyCode; name: AutonomyName }> = [
	{ code: "A1", name: "supervised" },
	{ code: "A2", name: "plan-approved" },
	{ code: "A3", name: "unattended" },
];
const UNSUPPORTED = new Set(["a0", "manual", "a4", "auto-land", "a5", "auto-deploy"]);
export const VALID_LEVELS = "válidos: supervised (A1), plan-approved (A2), unattended (A3)";

export function parseAutonomyLevel(token: string): ParsedAutonomy {
	const lower = token.trim().toLowerCase();
	const level = SUPPORTED.find((candidate) => candidate.code.toLowerCase() === lower || candidate.name === lower);
	if (level) return { ok: true, code: level.code, name: level.name };
	if (UNSUPPORTED.has(lower)) return { ok: false, message: `--autonomy ${token}: no soportado todavía (v1 honra A1–A3)` };
	return { ok: false, message: `--autonomy ${token}: valor inválido; ${VALID_LEVELS}` };
}

export type IssuesCommandArgs =
	| { ok: true; autonomy: AutonomyCode | undefined }
	| { ok: false; message: string };

// `/issues` no toma issues por argumento (los elige en la TUI): su único flag es
// `--autonomy <level>`; cualquier otro token es un error, no se descarta.
export function parseIssuesCommandArgs(args: string): IssuesCommandArgs {
	const tokens = args.trim().split(/\s+/).filter((token) => token !== "");
	let autonomy: AutonomyCode | undefined;
	const unknown: string[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		let value: string | undefined;
		if (token === "--autonomy") {
			const next = tokens[index + 1];
			if (next === undefined || next.startsWith("--")) return { ok: false, message: `--autonomy: falta el nivel; ${VALID_LEVELS}` };
			value = next;
			index += 1;
		} else if (token.startsWith("--autonomy=")) {
			value = token.slice("--autonomy=".length);
			if (value === "") return { ok: false, message: `--autonomy: falta el nivel; ${VALID_LEVELS}` };
		} else {
			unknown.push(token);
			continue;
		}
		if (autonomy !== undefined) return { ok: false, message: "--autonomy: repetido" };
		const parsed = parseAutonomyLevel(value);
		if (!parsed.ok) return parsed;
		autonomy = parsed.code;
	}
	if (unknown.length > 0) return { ok: false, message: `/issues no acepta argumentos además de --autonomy <level>: ${unknown.join(" ")}` };
	return { ok: true, autonomy };
}

export function withAutonomy(args: string, level: AutonomyCode | undefined): string {
	if (level === undefined) return args;
	return args === "" ? `--autonomy ${level}` : `${args} --autonomy ${level}`;
}
