export type RecordValue = Record<string, unknown>;

export interface ObjectShapeDiagnostic {
	path: string;
	code: "missing-field" | "extra-field" | "invalid-type";
	message: string;
}

export function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactObject(
	value: unknown,
	path: string,
	fields: readonly string[],
	report: (diagnostic: ObjectShapeDiagnostic) => void,
): RecordValue | null {
	if (!isRecord(value)) {
		report({ path, code: "invalid-type", message: "Expected an object" });
		return null;
	}
	const allowed = new Set(fields);
	for (const field of fields) {
		if (!Object.hasOwn(value, field)) {
			report({ path: `${path}.${field}`, code: "missing-field", message: `Missing required field ${field}` });
		}
	}
	for (const field of Object.keys(value)) {
		if (!allowed.has(field)) {
			report({ path: `${path}.${field}`, code: "extra-field", message: `Unexpected field ${field}` });
		}
	}
	return value;
}
