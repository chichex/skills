import type {
	ArtifactFormat,
	ResolutionDiagnostic,
} from "../workflow-resolution/index.ts";

export interface SpecListEntry {
	title: string;
	state: string;
	format: ArtifactFormat;
	diagnostics: ResolutionDiagnostic[];
	updatedAt: string;
}

function specStatusRank(state: string): number {
	if (state === "approved") return 0;
	if (state === "draft") return 1;
	if (state === "implemented") return 2;
	if (state === "superseded") return 3;
	return 4;
}

export function isInvalidSpecListEntry(spec: SpecListEntry): boolean {
	return spec.diagnostics.length > 0 || spec.format === "invalid" || spec.format === "conflict";
}

export function compareSpecListEntries(left: SpecListEntry, right: SpecListEntry): number {
	const leftInvalid = isInvalidSpecListEntry(left);
	const rightInvalid = isInvalidSpecListEntry(right);
	if (leftInvalid !== rightInvalid) return leftInvalid ? -1 : 1;

	if (!leftInvalid) {
		const statusDifference = specStatusRank(left.state) - specStatusRank(right.state);
		if (statusDifference !== 0) return statusDifference;
	}
	const dateDifference = right.updatedAt.localeCompare(left.updatedAt);
	if (dateDifference !== 0) return dateDifference;
	return left.title === right.title ? 0 : left.title < right.title ? -1 : 1;
}

function healthyStatusIcon(state: string): string {
	const rank = specStatusRank(state);
	if (rank === 0) return "●";
	if (rank === 1) return "◌";
	if (rank === 2) return "✓";
	return "•";
}

export interface SpecMenuPresentation {
	label: string;
	description: string;
	canExecute: boolean;
}

export function specMenuPresentation(spec: SpecListEntry): SpecMenuPresentation {
	const invalid = isInvalidSpecListEntry(spec);
	const diagnosticSummary = spec.diagnostics.map(({ code, message }) => `${code}: ${message}`);
	const diagnostics = diagnosticSummary.length > 0 ? ` · ${diagnosticSummary.join(" | ")}` : "";
	return {
		label: `${invalid ? "⚠" : healthyStatusIcon(spec.state)} ${spec.title}`,
		description: `${spec.state} · ${spec.format}${diagnostics}`,
		canExecute: !invalid,
	};
}

export function specInspectionDiagnostics(spec: SpecListEntry): string {
	return spec.diagnostics.length === 0
		? "none"
		: spec.diagnostics.map(({ code, message }) => `- \`${code}\` — ${message}`).join("\n");
}
