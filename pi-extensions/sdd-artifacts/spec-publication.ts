import { createHash } from "node:crypto";

import {
	normalizeIssueRef,
	normalizeNormativeSpecContent,
	type IssueRef,
} from "../workflow-resolution/index.ts";
import {
	parseSddArtifact,
	upsertSddMetadata,
	type IssueReference,
	type SddDiagnostic,
	type SpecMetadata,
	type SpecState,
} from "./index.ts";

export type SpecPublicationMode = "interactive" | "assume";

export interface SpecPublicationExpectation {
	mode: SpecPublicationMode;
	repository: string;
	issue: IssueRef | null;
	grill: string | null;
	state?: SpecState;
	supersededBy: string | null;
}

export interface SpecPublicationDiagnostic {
	code: string;
	message: string;
}

export type SpecPublicationValidation =
	| { ok: true; metadata: SpecMetadata }
	| { ok: false; diagnostics: SpecPublicationDiagnostic[] };

export type SpecPublicationDestination =
	| { kind: "local"; path: string }
	| { kind: "issue"; issue: IssueRef }
	| { kind: "new-issue"; repository: string; title: string };

export interface SpecPublicationDocument {
	id: string;
	role?: "successor" | "predecessor";
	markdown: string;
	expectation: SpecPublicationExpectation;
	destinations: SpecPublicationDestination[];
}

type ResolvedSpecPublicationDestination = Exclude<SpecPublicationDestination, { kind: "new-issue" }>;

interface PreparedSpecPublicationDocument extends Omit<SpecPublicationDocument, "destinations"> {
	destinations: ResolvedSpecPublicationDestination[];
}

export interface PersistSpecPublicationInput {
	documents: SpecPublicationDocument[];
}

export interface SpecPublicationPorts {
	writeLocal(path: string, markdown: string): Promise<void>;
	readLocal(path: string): Promise<string>;
	writeIssue(issue: IssueRef, markdown: string): Promise<void>;
	readIssue(issue: IssueRef): Promise<string>;
	createIssue(repository: string, title: string, stagingBody: string): Promise<IssueRef>;
}

export interface SpecPublicationOperationDiagnostic extends SpecPublicationDiagnostic {
	documentId: string;
	stage: "precheck" | "prepare" | "write" | "reread" | "postcheck" | "comparison";
	destination?: string;
}

export interface SpecPublicationOutcome {
	documentId: string;
	destination: string;
	written: boolean;
	verified: boolean;
}

export interface SpecPublicationReceipt {
	version: 1;
	kind: "sdd-spec-publication";
	digest: string;
	documents: Array<{ id: string; destinations: string[] }>;
}

export type PersistSpecPublicationResult =
	| { ok: true; receipt: SpecPublicationReceipt; outcomes: SpecPublicationOutcome[] }
	| {
		ok: false;
		diagnostics: SpecPublicationOperationDiagnostic[];
		outcomes: SpecPublicationOutcome[];
		createdIssues: IssueRef[];
	};

function sameIssue(left: IssueRef | null, right: IssueRef | null): boolean {
	if (left === null || right === null) return left === right;
	return left.number === right.number && left.repository.toLowerCase() === right.repository.toLowerCase();
}

function parserDiagnostics(diagnostics: SddDiagnostic[]): SpecPublicationDiagnostic[] {
	return diagnostics.map(({ code, message }) => ({ code, message }));
}

export function validateSpecPublication(
	markdown: string,
	expectation: SpecPublicationExpectation,
): SpecPublicationValidation {
	const parsed = parseSddArtifact(markdown);
	const diagnostics = parserDiagnostics(parsed.diagnostics);
	if (parsed.kind !== "metadata") {
		if (diagnostics.length === 0) {
			diagnostics.push({ code: "invalid-artifact", message: `Expected canonical spec metadata, got ${parsed.kind}` });
		}
		return { ok: false, diagnostics };
	}
	if (parsed.format !== "canonical") {
		diagnostics.push({ code: "invalid-format", message: `Expected canonical metadata, got ${parsed.format}` });
	}
	if (parsed.metadata.type !== "spec") {
		diagnostics.push({ code: "invalid-type", message: `Expected spec metadata, got ${parsed.metadata.type}` });
		return { ok: false, diagnostics };
	}

	const metadata = parsed.metadata;
	const expectedState = expectation.state ?? (expectation.mode === "interactive" ? "approved" : "draft");
	if (metadata.state !== expectedState) {
		diagnostics.push({
			code: "state-mismatch",
			message: `Expected state=${expectedState}, got state=${metadata.state}`,
		});
	}
	const actualIssue = normalizeIssueRef(metadata.issue, expectation.repository);
	if (!sameIssue(actualIssue, expectation.issue)) {
		diagnostics.push({ code: "issue-mismatch", message: "Spec issue identity does not match the resolved source" });
	}
	if (metadata.grill !== expectation.grill) {
		diagnostics.push({ code: "grill-mismatch", message: "Spec grill identity does not match the resolved source" });
	}
	if (metadata.supersededBy !== expectation.supersededBy) {
		diagnostics.push({
			code: "superseded-by-mismatch",
			message: "Spec superseded-by identity does not match the expected lifecycle mutation",
		});
	}

	return diagnostics.length === 0 ? { ok: true, metadata } : { ok: false, diagnostics };
}

function validatePersistedPredecessor(
	markdown: string,
	expectation: SpecPublicationExpectation,
): SpecPublicationDiagnostic[] {
	const parsed = parseSddArtifact(markdown);
	if (parsed.kind !== "metadata" || parsed.format !== "canonical" || parsed.metadata.type !== "spec") {
		const validation = validateSpecPublication(markdown, expectation);
		return validation.ok
			? [{ code: "invalid-predecessor", message: "Persisted predecessor is not one canonical spec" }]
			: validation.diagnostics;
	}
	const identityValidation = validateSpecPublication(markdown, {
		...expectation,
		state: parsed.metadata.state,
		supersededBy: parsed.metadata.supersededBy,
	});
	const diagnostics = identityValidation.ok ? [] : [...identityValidation.diagnostics];
	if (parsed.metadata.state === "superseded" && parsed.metadata.supersededBy !== expectation.supersededBy) {
		diagnostics.push({
			code: "predecessor-target-mismatch",
			message: "Persisted predecessor already points to a different successor",
		});
	}
	return diagnostics;
}

function destinationReference(destination: SpecPublicationDestination): string {
	if (destination.kind === "local") return `local:${destination.path}`;
	if (destination.kind === "issue") return `issue:${destination.issue.repository}#${destination.issue.number}`;
	return `new-issue:${destination.repository}`;
}

function predecessorPointsToDestination(
	reference: string,
	destination: SpecPublicationDestination,
	repository: string,
): boolean {
	if (destination.kind === "new-issue") return false;
	if (destination.kind === "issue") {
		return sameIssue(normalizeIssueRef(reference, repository), destination.issue);
	}
	const normalizedReference = reference.replace(/^@/, "").replaceAll("\\", "/");
	const normalizedPath = destination.path.replaceAll("\\", "/");
	return normalizedReference === normalizedPath
		|| normalizedReference === `.sdd/specs/${normalizedPath.split("/").at(-1) ?? ""}`;
}

function predecessorPointsToSuccessor(
	predecessor: SpecPublicationDocument,
	successor: SpecPublicationDocument,
): boolean {
	const reference = predecessor.expectation.supersededBy;
	return reference !== null && successor.destinations.some((destination) =>
		predecessorPointsToDestination(reference, destination, successor.expectation.repository)
	);
}

export const SDD_SPEC_ISSUE_STAGING_BODY = "SDD spec publication is pending canonical issue identity.\n";

function operationDiagnostics(
	documentId: string,
	stage: SpecPublicationOperationDiagnostic["stage"],
	diagnostics: SpecPublicationDiagnostic[],
	destination?: string,
): SpecPublicationOperationDiagnostic[] {
	return diagnostics.map(({ code, message }) => ({
		code,
		message,
		documentId,
		stage,
		...(destination === undefined ? {} : { destination }),
	}));
}

export async function persistSpecPublication(
	input: PersistSpecPublicationInput,
	ports: SpecPublicationPorts,
): Promise<PersistSpecPublicationResult> {
	const diagnostics: SpecPublicationOperationDiagnostic[] = [];
	const outcomes: SpecPublicationOutcome[] = [];
	const verifiedCopies = new Map<string, string>();
	if (input.documents.length === 0) {
		diagnostics.push({
			code: "missing-document",
			message: "A publication requires at least one document",
			documentId: "<publication>",
			stage: "precheck",
		});
	}
	const successorCount = input.documents.filter((document) => (document.role ?? "successor") === "successor").length;
	if (successorCount !== 1) {
		diagnostics.push({
			code: "invalid-successor-count",
			message: `A publication requires exactly one successor, got ${successorCount}`,
			documentId: "<publication>",
			stage: "precheck",
		});
	}
	const documentIds = new Set<string>();
	for (const document of input.documents) {
		if (documentIds.has(document.id)) {
			diagnostics.push({
				code: "duplicate-document-id",
				message: `Publication document id is duplicated: ${document.id}`,
				documentId: document.id,
				stage: "precheck",
			});
		}
		documentIds.add(document.id);
		const localCount = document.destinations.filter(({ kind }) => kind === "local").length;
		const issueCount = document.destinations.filter(({ kind }) => kind === "issue" || kind === "new-issue").length;
		if (localCount > 1 || issueCount > 1) {
			diagnostics.push({
				code: "duplicate-destination-kind",
				message: "A document may target at most one local copy and one issue copy",
				documentId: document.id,
				stage: "precheck",
			});
		}
	}
	for (const document of input.documents) {
		const role = document.role ?? "successor";
		const expectedLifecycleState = document.expectation.mode === "interactive" ? "approved" : "draft";
		if (document.destinations.length === 0) {
			diagnostics.push({
				code: "missing-destination",
				message: "Every publication document requires at least one destination",
				documentId: document.id,
				stage: "precheck",
			});
		}
		for (const destination of document.destinations) {
			if (destination.kind === "issue" && !sameIssue(destination.issue, document.expectation.issue)) {
				diagnostics.push({
					code: "destination-identity-mismatch",
					message: "Issue destination does not match the validated spec identity",
					documentId: document.id,
					stage: "precheck",
					destination: destinationReference(destination),
				});
			}
			if (destination.kind === "new-issue"
				&& (role !== "successor"
					|| document.expectation.issue !== null
					|| destination.repository.toLowerCase() !== document.expectation.repository.toLowerCase())) {
				diagnostics.push({
					code: "destination-identity-mismatch",
					message: "New issue publication requires an issue-less successor in the resolved repository",
					documentId: document.id,
					stage: "precheck",
					destination: destinationReference(destination),
				});
			}
		}
		if (role === "successor"
			&& (document.expectation.state !== undefined && document.expectation.state !== expectedLifecycleState
				|| document.expectation.supersededBy !== null)) {
			diagnostics.push({
				code: "successor-lifecycle-mismatch",
				message: `A successor must be ${expectedLifecycleState} with superseded-by=none`,
				documentId: document.id,
				stage: "precheck",
			});
			continue;
		}
		if (role === "predecessor"
			&& (document.expectation.state !== "superseded" || document.expectation.supersededBy === null)) {
			diagnostics.push({
				code: "predecessor-lifecycle-mismatch",
				message: "A predecessor must be superseded and point to its successor",
				documentId: document.id,
				stage: "precheck",
			});
			continue;
		}
		const validation = validateSpecPublication(document.markdown, document.expectation);
		if (!validation.ok) {
			diagnostics.push(...operationDiagnostics(document.id, "precheck", validation.diagnostics));
		}
	}
	const successor = input.documents.find((document) => (document.role ?? "successor") === "successor");
	if (successor && !successor.destinations.some(({ kind }) => kind === "new-issue")) {
		for (const predecessor of input.documents.filter(({ role }) => role === "predecessor")) {
			if (!predecessorPointsToSuccessor(predecessor, successor)) {
				diagnostics.push({
					code: "predecessor-target-mismatch",
					message: "Predecessor superseded-by does not identify a successor destination",
					documentId: predecessor.id,
					stage: "precheck",
				});
			}
		}
	}
	if (diagnostics.length > 0) return { ok: false, diagnostics, outcomes, createdIssues: [] };

	for (const document of input.documents) {
		if (document.role !== "predecessor") continue;
		for (const destination of document.destinations) {
			if (destination.kind === "new-issue") continue;
			const reference = destinationReference(destination);
			let persisted: string;
			try {
				persisted = destination.kind === "local"
					? await ports.readLocal(destination.path)
					: await ports.readIssue(destination.issue);
			} catch (error) {
				diagnostics.push({
					code: "precheck-reread-failed",
					message: error instanceof Error ? error.message : String(error),
					documentId: document.id,
					stage: "precheck",
					destination: reference,
				});
				continue;
			}
			const predecessorDiagnostics = validatePersistedPredecessor(persisted, document.expectation);
			diagnostics.push(...operationDiagnostics(
				document.id,
				"precheck",
				predecessorDiagnostics,
				reference,
			));
		}
	}
	if (diagnostics.length > 0) return { ok: false, diagnostics, outcomes, createdIssues: [] };

	const createdIssues: IssueRef[] = [];
	const preparedDocuments: PreparedSpecPublicationDocument[] = [];
	for (const document of input.documents) {
		let markdown = document.markdown;
		let expectation = document.expectation;
		const destinations: ResolvedSpecPublicationDestination[] = [];
		for (const destination of document.destinations) {
			if (destination.kind !== "new-issue") {
				destinations.push(destination);
				continue;
			}
			const unresolvedReference = destinationReference(destination);
			let issue: IssueRef;
			try {
				issue = await ports.createIssue(destination.repository, destination.title, SDD_SPEC_ISSUE_STAGING_BODY);
				createdIssues.push(issue);
			} catch (error) {
				diagnostics.push({
					code: "issue-creation-failed",
					message: error instanceof Error ? error.message : String(error),
					documentId: document.id,
					stage: "write",
					destination: unresolvedReference,
				});
				outcomes.push({ documentId: document.id, destination: unresolvedReference, written: false, verified: false });
				continue;
			}

			if (!Number.isSafeInteger(issue.number) || issue.number < 1
				|| issue.repository.toLowerCase() !== destination.repository.toLowerCase()) {
				diagnostics.push({
					code: "created-issue-identity-mismatch",
					message: "Created issue identity does not match the requested repository",
					documentId: document.id,
					stage: "prepare",
					destination: unresolvedReference,
				});
				continue;
			}
			const initial = validateSpecPublication(markdown, expectation);
			if (!initial.ok) {
				diagnostics.push(...operationDiagnostics(document.id, "prepare", initial.diagnostics, unresolvedReference));
				continue;
			}
			const linked = upsertSddMetadata(markdown, {
				...initial.metadata,
				issue: `#${issue.number}` as IssueReference,
			});
			if (!linked.ok) {
				diagnostics.push(...operationDiagnostics(document.id, "prepare", linked.diagnostics, unresolvedReference));
				continue;
			}
			markdown = linked.document;
			expectation = { ...expectation, issue };
			const linkedValidation = validateSpecPublication(markdown, expectation);
			if (!linkedValidation.ok) {
				diagnostics.push(...operationDiagnostics(document.id, "prepare", linkedValidation.diagnostics, unresolvedReference));
				continue;
			}
			destinations.push({ kind: "issue", issue });
		}
		preparedDocuments.push({ ...document, markdown, expectation, destinations });
	}
	if (diagnostics.length > 0) return { ok: false, diagnostics, outcomes, createdIssues };

	const preparedSuccessor = preparedDocuments.find((document) => (document.role ?? "successor") === "successor");
	if (preparedSuccessor) {
		for (const predecessor of preparedDocuments.filter(({ role }) => role === "predecessor")) {
			if (!predecessorPointsToSuccessor(predecessor, preparedSuccessor)) {
				diagnostics.push({
					code: "predecessor-target-mismatch",
					message: "Predecessor superseded-by does not identify a resolved successor destination",
					documentId: predecessor.id,
					stage: "prepare",
				});
			}
		}
	}
	if (diagnostics.length > 0) return { ok: false, diagnostics, outcomes, createdIssues };

	for (const document of preparedDocuments) {
		for (const destination of document.destinations) {
			const reference = destinationReference(destination);
			const outcome = { documentId: document.id, destination: reference, written: false, verified: false };
			outcomes.push(outcome);
			try {
				if (destination.kind === "local") await ports.writeLocal(destination.path, document.markdown);
				else await ports.writeIssue(destination.issue, document.markdown);
				outcome.written = true;
			} catch (error) {
				diagnostics.push({
					code: "persistence-failed",
					message: error instanceof Error ? error.message : String(error),
					documentId: document.id,
					stage: "write",
					destination: reference,
				});
				continue;
			}

			let reread: string;
			try {
				reread = destination.kind === "local"
					? await ports.readLocal(destination.path)
					: await ports.readIssue(destination.issue);
			} catch (error) {
				diagnostics.push({
					code: "reread-failed",
					message: error instanceof Error ? error.message : String(error),
					documentId: document.id,
					stage: "reread",
					destination: reference,
				});
				continue;
			}
			const postcheck = validateSpecPublication(reread, document.expectation);
			if (!postcheck.ok) {
				diagnostics.push(...operationDiagnostics(document.id, "postcheck", postcheck.diagnostics, reference));
				continue;
			}
			outcome.verified = true;
			verifiedCopies.set(`${document.id}\0${reference}`, reread);
		}
	}

	for (const document of preparedDocuments) {
		const localDestinations = document.destinations.filter(
			(destination): destination is Extract<SpecPublicationDestination, { kind: "local" }> => destination.kind === "local",
		);
		const issueDestinations = document.destinations.filter(
			(destination): destination is Extract<SpecPublicationDestination, { kind: "issue" }> => destination.kind === "issue",
		);
		for (const local of localDestinations) {
			for (const issue of issueDestinations) {
				const localReference = destinationReference(local);
				const issueReference = destinationReference(issue);
				const localCopy = verifiedCopies.get(`${document.id}\0${localReference}`);
				const issueCopy = verifiedCopies.get(`${document.id}\0${issueReference}`);
				if (localCopy === undefined || issueCopy === undefined) continue;
				const localNorm = normalizeNormativeSpecContent(localCopy, document.expectation.repository, "local");
				const issueNorm = normalizeNormativeSpecContent(issueCopy, document.expectation.repository, "issue");
				if (localNorm !== issueNorm) {
					diagnostics.push({
						code: "copy-divergence",
						message: "Local and issue copies differ beyond the allowed transport normalizations",
						documentId: document.id,
						stage: "comparison",
						destination: `${localReference} <> ${issueReference}`,
					});
				}
			}
		}
	}
	if (diagnostics.length > 0) return { ok: false, diagnostics, outcomes, createdIssues };

	const receiptDocuments = preparedDocuments.map((document) => ({
		id: document.id,
		destinations: document.destinations.map(destinationReference),
	}));
	const digest = createHash("sha256")
		.update(JSON.stringify(receiptDocuments))
		.update("\0")
		.update(preparedDocuments.map(({ markdown }) => markdown).join("\0"))
		.digest("hex");
	return {
		ok: true,
		receipt: { version: 1, kind: "sdd-spec-publication", digest, documents: receiptDocuments },
		outcomes,
	};
}
