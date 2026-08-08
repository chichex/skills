import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	parseSddArtifact,
	serializeSddMetadata,
	updateSddSpecState,
	upsertSddMetadata,
} from "./index.ts";

test("serializes the three v1 artifact types with the exact canonical schema", () => {
	assert.deepEqual(
		serializeSddMetadata({
			version: 1,
			type: "spec",
			state: "approved",
			issue: "owner/repo#9",
			grill: "session 9/á",
			supersededBy: null,
		}),
		{
			ok: true,
			marker: "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=owner/repo#9; grill=session%209%2F%C3%A1; superseded-by=none -->",
		},
	);
	assert.deepEqual(
		serializeSddMetadata({
			version: 1,
			type: "grill",
			state: "finalized",
			issue: null,
			grill: "grill-9",
			project: "/workspace/skills",
		}),
		{
			ok: true,
			marker: "<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=grill-9; project=%2Fworkspace%2Fskills -->",
		},
	);
	assert.deepEqual(
		serializeSddMetadata({
			version: 1,
			type: "project",
			generatedAt: "2026-08-08",
		}),
		{
			ok: true,
			marker: "<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-08 -->",
		},
	);
});

test("keeps the normative conformance vectors in sync with the serializer", async () => {
	const contract = await readFile(new URL("../../docs/sdd-tracking-v1.md", import.meta.url), "utf8");
	const block = contract.match(/<!-- conformance-vectors:start -->\n```html\n([\s\S]*?)\n```\n<!-- conformance-vectors:end -->/);
	assert.ok(block, "normative conformance vector block is present");

	const actual = block[1]?.split("\n");
	const inputs = [
		{
			version: 1,
			type: "spec",
			state: "approved",
			issue: "owner/repo#9",
			grill: "session 9/á",
			supersededBy: null,
		},
		{
			version: 1,
			type: "grill",
			state: "finalized",
			issue: null,
			grill: "grill-9",
			project: "/workspace/skills",
		},
		{ version: 1, type: "project", generatedAt: "2026-08-08" },
	] as const;
	const expected = inputs.map((input) => {
		const serialized = serializeSddMetadata(input);
		assert.equal(serialized.ok, true);
		return serialized.ok ? serialized.marker : "";
	});

	assert.deepEqual(actual, expected);
});

test("rejects metadata outside the v1 schema and its invariants", () => {
	const cases: Array<{ metadata: unknown; code: string }> = [
		{ metadata: { version: 2, type: "project", generatedAt: "2026-08-08" }, code: "unsupported-version" },
		{
			metadata: { version: 1, type: "spec", state: "unknown", issue: null, grill: null, supersededBy: null },
			code: "invalid-state",
		},
		{
			metadata: { version: 1, type: "spec", state: "approved", issue: "#0", grill: null, supersededBy: null },
			code: "invalid-issue",
		},
		{
			metadata: { version: 1, type: "spec", state: "superseded", issue: null, grill: null, supersededBy: null },
			code: "invariant-violation",
		},
		{
			metadata: { version: 1, type: "spec", state: "approved", issue: null, grill: null, supersededBy: "next" },
			code: "invariant-violation",
		},
		{
			metadata: { version: 1, type: "grill", state: "paused", issue: null, grill: "none", project: "project" },
			code: "invalid-reference",
		},
		{
			metadata: { version: 1, type: "grill", state: "paused", issue: null, grill: "session", project: "\ud800" },
			code: "invalid-reference",
		},
		{ metadata: { version: 1, type: "project", generatedAt: "2025-02-29" }, code: "invalid-date" },
		{ metadata: { version: 1, type: "other" }, code: "unknown-type" },
		{ metadata: { version: 1, type: "project", generatedAt: "2026-08-08", extra: true }, code: "extra-key" },
	];

	for (const { metadata, code } of cases) {
		const result = serializeSddMetadata(metadata as never);
		assert.equal(result.ok, false, JSON.stringify(metadata));
		assert.equal(result.ok ? undefined : result.diagnostics[0]?.code, code, JSON.stringify(metadata));
	}
});

test("parses canonical metadata as one typed unit and decodes references losslessly", () => {
	const raw = "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=owner/repo#9; grill=session%209%2F%C3%A1; superseded-by=none -->";
	assert.deepEqual(parseSddArtifact(`# Example\n${raw}\n\nBody\n`), {
		kind: "metadata",
		format: "canonical",
		metadata: {
			version: 1,
			type: "spec",
			state: "approved",
			issue: "owner/repo#9",
			grill: "session 9/á",
			supersededBy: null,
		},
		raw,
		state: { value: "approved", provenance: "canonical", raw: "approved" },
		diagnostics: [],
	});

	const projectRaw = "<!-- SDD-Tracking: version=1; type=project; generated-at=2024-02-29 -->";
	assert.deepEqual(parseSddArtifact(`${projectRaw}\n# Contract\n`), {
		kind: "metadata",
		format: "canonical",
		metadata: { version: 1, type: "project", generatedAt: "2024-02-29" },
		raw: projectRaw,
		state: { value: "unknown", provenance: "absent" },
		diagnostics: [],
	});
});

test("reports every canonical schema violation without falling back to legacy", () => {
	const cases: Array<{ marker: string; code: string }> = [
		{
			marker: "<!-- SDD-Tracking: version=2; type=project; generated-at=2026-08-08 -->",
			code: "unsupported-version",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=other; generated-at=2026-08-08 -->",
			code: "unknown-type",
		},
		{
			marker: "<!-- SDD-Tracking:version=1; type=project; generated-at=2026-08-08 -->",
			code: "invalid-marker-syntax",
		},
		{
			marker: "<!-- SDD-Tracking version=1; type=project; generated-at=2026-08-08 -->",
			code: "invalid-marker-syntax",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=project -->",
			code: "missing-key",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; version=1; type=project; generated-at=2026-08-08 -->",
			code: "duplicate-key",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-08; extra=x -->",
			code: "extra-key",
		},
		{
			marker: "<!-- SDD-Tracking: type=project; version=1; generated-at=2026-08-08 -->",
			code: "key-order",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=spec; state=unknown; issue=none; grill=none; superseded-by=none -->",
			code: "invalid-state",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#0; grill=none; superseded-by=none -->",
			code: "invalid-issue",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=path%2fchild; superseded-by=none -->",
			code: "invalid-encoding",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=spec; state=superseded; issue=none; grill=none; superseded-by=none -->",
			code: "invariant-violation",
		},
		{
			marker: "<!-- SDD-Tracking: version=1; type=project; generated-at=2026-02-30 -->",
			code: "invalid-date",
		},
	];

	for (const { marker, code } of cases) {
		const result = parseSddArtifact(`# Artifact\n${marker}\n<!-- Estado: implementada -->\n`);
		assert.equal(result.kind, "invalid", marker);
		assert.equal(result.diagnostics[0]?.code, code, marker);
		assert.deepEqual(result.state, { value: "unknown", provenance: "absent" }, marker);
	}
});

test("handles canonical duplicates without choosing divergent metadata", () => {
	const approved = "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#9; grill=none; superseded-by=none -->";
	const draft = "<!-- SDD-Tracking: version=1; type=spec; state=draft; issue=#9; grill=none; superseded-by=none -->";
	const duplicate = parseSddArtifact(`# Spec\n${approved}\n${approved}\n`);
	assert.equal(duplicate.kind, "metadata");
	assert.deepEqual(duplicate.diagnostics.map(({ code }) => code), ["duplicate-canonical"]);
	assert.equal(duplicate.kind === "metadata" ? duplicate.metadata.type : undefined, "spec");

	assert.deepEqual(parseSddArtifact(`# Spec\n${approved}\n${draft}\n`), {
		kind: "conflict",
		raw: [approved, draft],
		state: { value: "unknown", provenance: "absent" },
		diagnostics: [{
			code: "conflicting-canonical",
			message: "Canonical markers differ",
		}],
	});
});

test("recognizes Spanish and English legacy fixtures by preamble content", async () => {
	const cases = [
		{
			file: "spec-es.md",
			type: "spec",
			state: { value: "approved", provenance: "legacy-explicit", raw: "pendiente   de ejecución" },
			identity: { issue: "#9", grill: "sesión legacy/á" },
		},
		{
			file: "spec-en.md",
			type: "spec",
			state: { value: "implemented", provenance: "legacy-explicit", raw: "implemented" },
			identity: { issue: "owner/repo#9", grill: null },
		},
		{
			file: "grill-es.md",
			type: "grill",
			state: { value: "paused", provenance: "legacy-explicit", raw: "paused" },
			identity: { issue: "#9", grill: "sesión-9", project: "/workspace/proyecto" },
		},
		{
			file: "grill-en.md",
			type: "grill",
			state: { value: "finalized", provenance: "legacy-explicit", raw: "finalized" },
			identity: { issue: "owner/repo#9", grill: "grill-9", project: "/workspace/project" },
		},
		{
			file: "project-es.md",
			type: "project",
			state: { value: "unknown", provenance: "absent" },
			identity: { generatedAt: "2026-07-18" },
		},
		{
			file: "project-en.md",
			type: "project",
			state: { value: "unknown", provenance: "absent" },
			identity: { generatedAt: "2026-07-19" },
		},
	] as const;

	for (const fixtureCase of cases) {
		const markdown = await readFile(new URL(`./fixtures/${fixtureCase.file}`, import.meta.url), "utf8");
		const result = parseSddArtifact(markdown);
		assert.equal(result.kind, "metadata", fixtureCase.file);
		assert.equal(result.kind === "metadata" ? result.format : undefined, "legacy", fixtureCase.file);
		assert.equal(result.kind === "metadata" ? result.metadata.type : undefined, fixtureCase.type, fixtureCase.file);
		assert.deepEqual(result.state, fixtureCase.state, fixtureCase.file);
		assert.ok(result.kind !== "metadata" || result.raw.length > 0, fixtureCase.file);
		if (result.kind === "metadata" && result.format === "legacy") {
			for (const [key, value] of Object.entries(fixtureCase.identity)) {
				assert.equal(result.metadata[key as keyof typeof result.metadata], value, `${fixtureCase.file}: ${key}`);
			}
		}
	}
});

test("normalizes complete legacy state aliases while preserving their raw value", () => {
	const cases = [
		["DRAFT", "draft"],
		["Borrador", "draft"],
		["APROBADA", "approved"],
		["pendiente   de EJECUCIÓN", "approved"],
		["Implementada", "implemented"],
		["SUPERSEDED", "superseded"],
		["waiting for legal review", "unknown"],
	] as const;
	for (const [raw, value] of cases) {
		const result = parseSddArtifact(`# Spec — Legacy\n<!-- Status: ${raw} -->\n`);
		assert.equal(result.kind, "metadata", raw);
		assert.deepEqual(result.state, { value, provenance: "legacy-explicit", raw }, raw);
	}

	const replaced = parseSddArtifact("# Spec — Legacy\n<!-- Estado: Reemplazada por specs/nueva á -->\n");
	assert.deepEqual(replaced.state, {
		value: "superseded",
		provenance: "legacy-explicit",
		raw: "Reemplazada por specs/nueva á",
	});
	assert.equal(
		replaced.kind === "metadata" && replaced.format === "legacy" ? replaced.metadata.supersededBy : undefined,
		"specs/nueva á",
	);
});

test("infers implemented only from the exact execution-result heading when state is absent", () => {
	const inferred = parseSddArtifact("# Spec — Legacy\n\n## Resultado de ejecución (2026-08-08 · HEAD abc1234)\nDone\n");
	assert.deepEqual(inferred.state, { value: "implemented", provenance: "legacy-inferred" });

	const explicitUnknown = parseSddArtifact("# Spec — Legacy\n<!-- Status: waiting -->\n\n## Resultado de ejecucion (today)\nDone\n");
	assert.deepEqual(explicitUnknown.state, { value: "unknown", provenance: "legacy-explicit", raw: "waiting" });

	const nearMiss = parseSddArtifact("# Spec — Legacy\n\n## Resultado de ejecuciones\nDone\n");
	assert.deepEqual(nearMiss.state, { value: "unknown", provenance: "absent" });
});

test("keeps canonical precedence and reports incompatible legacy signals", () => {
	const canonical = "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#9; grill=none; superseded-by=none -->";
	const canonicalResult = parseSddArtifact(`# Spec\n${canonical}\n<!-- Status: implemented -->\n`);
	assert.equal(canonicalResult.kind, "metadata");
	assert.deepEqual(canonicalResult.state, { value: "approved", provenance: "canonical", raw: "approved" });

	const typeConflict = parseSddArtifact("# Spec — Conflict\n<!-- Estado: paused. Proyecto: /workspace/x. Fuente: issue #9. -->\n");
	assert.equal(typeConflict.kind, "conflict");
	assert.equal(typeConflict.diagnostics[0]?.code, "legacy-type-conflict");

	const stateConflict = parseSddArtifact("# Spec — Conflict\n<!-- Status: draft -->\n<!-- Estado: implementada -->\n");
	assert.equal(stateConflict.kind, "conflict");
	assert.equal(stateConflict.diagnostics[0]?.code, "legacy-state-conflict");

	const headingStateConflict = parseSddArtifact("# Grill — Conflict\n<!-- Status: implemented -->\n");
	assert.equal(headingStateConflict.kind, "conflict");
	assert.equal(headingStateConflict.diagnostics[0]?.code, "legacy-type-conflict");

	const archived = parseSddArtifact("# Spec — Archive\n\n## Archived example\n<!-- Status: implemented -->\n");
	assert.deepEqual(archived.state, { value: "unknown", provenance: "absent" });
});

test("inserts canonical metadata conservatively with the original EOL and is idempotent", () => {
	const metadata = {
		version: 1,
		type: "spec",
		state: "approved",
		issue: "#9",
		grill: null,
		supersededBy: null,
	} as const;
	const marker = "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#9; grill=none; superseded-by=none -->";
	const original = "# Spec — CRLF\r\n<!-- Generated metadata -->\r\n<!-- Source metadata -->\r\n\r\nBody stays byte-identical.\r\n";
	const first = upsertSddMetadata(original, metadata);
	assert.deepEqual(first, {
		ok: true,
		document: `# Spec — CRLF\r\n<!-- Generated metadata -->\r\n<!-- Source metadata -->\r\n${marker}\r\n\r\nBody stays byte-identical.\r\n`,
		marker,
		diagnostics: [],
	});
	const second = upsertSddMetadata(first.document, metadata);
	assert.equal(second.ok, true);
	assert.equal(second.document, first.document);
	assert.equal(second.document.match(/SDD-Tracking/g)?.length, 1);

	const withoutH1 = upsertSddMetadata("Intro\n", metadata);
	assert.equal(withoutH1.ok, true);
	assert.equal(withoutH1.document, `${marker}\nIntro\n`);
});

test("replaces canonical or one compatible historical marker in place", async () => {
	const approved = {
		version: 1,
		type: "spec",
		state: "approved",
		issue: "#9",
		grill: "sesión legacy/á",
		supersededBy: null,
	} as const;
	const serialized = serializeSddMetadata(approved);
	assert.equal(serialized.ok, true);
	const marker = serialized.ok ? serialized.marker : "";

	const canonicalDraft = "<!-- SDD-Tracking: version=1; type=spec; state=draft; issue=#9; grill=sesi%C3%B3n%20legacy%2F%C3%A1; superseded-by=none -->";
	const canonicalDocument = `# Spec\n<!-- Generated -->\n${canonicalDraft}\n\nBody\n`;
	const canonicalResult = upsertSddMetadata(canonicalDocument, approved);
	assert.equal(canonicalResult.ok, true);
	assert.equal(canonicalResult.document, canonicalDocument.replace(canonicalDraft, marker));

	const legacyDocument = await readFile(new URL("./fixtures/spec-es.md", import.meta.url), "utf8");
	const historical = "<!-- SDD-Tracking: issue=#9; grill=sesión legacy/á -->";
	const legacyResult = upsertSddMetadata(legacyDocument, approved);
	assert.equal(legacyResult.ok, true);
	assert.equal(legacyResult.document, legacyDocument.replace(historical, marker));
	assert.equal(legacyResult.document.match(/SDD-Tracking/g)?.length, 1);
});

test("collapses identical canonical duplicates and leaves divergent duplicates unchanged", () => {
	const draft = "<!-- SDD-Tracking: version=1; type=spec; state=draft; issue=#9; grill=none; superseded-by=none -->";
	const approved = "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=#9; grill=none; superseded-by=none -->";
	const metadata = {
		version: 1,
		type: "spec",
		state: "approved",
		issue: "#9",
		grill: null,
		supersededBy: null,
	} as const;

	const identicalDocument = `# Spec\n${draft}\nIntro stays.\n${draft}\n\n## Body\nText\n`;
	const collapsed = upsertSddMetadata(identicalDocument, metadata);
	assert.equal(collapsed.ok, true);
	assert.equal(collapsed.document, `# Spec\n${approved}\nIntro stays.\n\n## Body\nText\n`);
	assert.equal(collapsed.document.match(/SDD-Tracking/g)?.length, 1);
	assert.ok(collapsed.diagnostics.some(({ code }) => code === "duplicate-canonical"));

	const canonicalWithHistorical = `# Spec\n${draft}\n<!-- SDD-Tracking: issue=#9; grill=none -->\n`;
	const canonicalWins = upsertSddMetadata(canonicalWithHistorical, metadata);
	assert.equal(canonicalWins.ok, true);
	assert.equal(canonicalWins.document, `# Spec\n${approved}\n`);
	assert.equal(canonicalWins.document.match(/SDD-Tracking/g)?.length, 1);

	const divergentDocument = `# Spec\n${draft}\n${approved}\n`;
	const blocked = upsertSddMetadata(divergentDocument, metadata);
	assert.equal(blocked.ok, false);
	assert.equal(blocked.document, divergentDocument);
	assert.equal(blocked.diagnostics[0]?.code, "conflicting-canonical");
});

test("state-only updates preserve identity and reject contradictory supersession transitions", async () => {
	const approved = "<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=owner/repo#9; grill=session%209; superseded-by=none -->";
	const original = `# Spec\n${approved}\n\nBody\n`;
	const implemented = updateSddSpecState(original, "implemented");
	assert.equal(implemented.ok, true);
	const parsed = parseSddArtifact(implemented.document);
	assert.equal(parsed.kind, "metadata");
	assert.deepEqual(parsed.kind === "metadata" ? parsed.metadata : undefined, {
		version: 1,
		type: "spec",
		state: "implemented",
		issue: "owner/repo#9",
		grill: "session 9",
		supersededBy: null,
	});

	const blockedSupersede = updateSddSpecState(original, "superseded");
	assert.equal(blockedSupersede.ok, false);
	assert.equal(blockedSupersede.document, original);
	assert.equal(blockedSupersede.diagnostics[0]?.code, "invariant-violation");

	const explicitSupersede = upsertSddMetadata(original, {
		version: 1,
		type: "spec",
		state: "superseded",
		issue: "owner/repo#9",
		grill: "session 9",
		supersededBy: "specs/replacement.md",
	});
	assert.equal(explicitSupersede.ok, true);
	const blockedUnsupersede = updateSddSpecState(explicitSupersede.document, "approved");
	assert.equal(blockedUnsupersede.ok, false);
	assert.equal(blockedUnsupersede.diagnostics[0]?.code, "invariant-violation");

	const legacy = await readFile(new URL("./fixtures/spec-es.md", import.meta.url), "utf8");
	const migrated = updateSddSpecState(legacy, "implemented");
	assert.equal(migrated.ok, true);
	const migratedMetadata = parseSddArtifact(migrated.document);
	assert.deepEqual(migratedMetadata.kind === "metadata" ? migratedMetadata.metadata : undefined, {
		version: 1,
		type: "spec",
		state: "implemented",
		issue: "#9",
		grill: "sesión legacy/á",
		supersededBy: null,
	});
});

test("places a new marker after a contiguous multiline initial comment block", () => {
	const original = "# Spec\n<!--\nGenerated metadata\n-->\n<!-- Source metadata -->\n\nBody\n";
	const metadata = {
		version: 1,
		type: "spec",
		state: "draft",
		issue: null,
		grill: null,
		supersededBy: null,
	} as const;
	const marker = "<!-- SDD-Tracking: version=1; type=spec; state=draft; issue=none; grill=none; superseded-by=none -->";
	const result = upsertSddMetadata(original, metadata);
	assert.equal(result.ok, true);
	assert.equal(result.document, `# Spec\n<!--\nGenerated metadata\n-->\n<!-- Source metadata -->\n${marker}\n\nBody\n`);
});

test("returns the original document for invalid, incompatible, or ambiguous upserts", () => {
	const target = {
		version: 1,
		type: "spec",
		state: "approved",
		issue: "#9",
		grill: null,
		supersededBy: null,
	} as const;
	const invalidCanonical = "# Spec\n<!-- SDD-Tracking: version=2; type=spec; state=approved; issue=#9; grill=none; superseded-by=none -->\n";
	const invalidResult = upsertSddMetadata(invalidCanonical, target);
	assert.equal(invalidResult.ok, false);
	assert.equal(invalidResult.document, invalidCanonical);
	assert.equal(invalidResult.diagnostics[0]?.code, "unsupported-version");

	const mismatchedIdentity = "# Spec\n<!-- SDD-Tracking: issue=#10; grill=none -->\n";
	const mismatchResult = upsertSddMetadata(mismatchedIdentity, target);
	assert.equal(mismatchResult.ok, false);
	assert.equal(mismatchResult.document, mismatchedIdentity);
	assert.equal(mismatchResult.diagnostics[0]?.code, "identity-mismatch");

	const duplicateLegacy = "# Spec\n<!-- SDD-Tracking: issue=#9; grill=none -->\n<!-- SDD-Tracking: issue=#9; grill=none -->\n";
	const duplicateResult = upsertSddMetadata(duplicateLegacy, target);
	assert.equal(duplicateResult.ok, false);
	assert.equal(duplicateResult.document, duplicateLegacy);
	assert.equal(duplicateResult.diagnostics[0]?.code, "duplicate-legacy-marker");
});

test("round-trips every canonical type and arbitrary UTF-8 references byte-for-byte", () => {
	const metadata = [
		{
			version: 1,
			type: "spec",
			state: "draft",
			issue: null,
			grill: "emoji 🚀/%",
			supersededBy: null,
		},
		{
			version: 1,
			type: "spec",
			state: "superseded",
			issue: "#99",
			grill: null,
			supersededBy: "specs/v2 — final.md",
		},
		{
			version: 1,
			type: "grill",
			state: "paused",
			issue: "owner/repo#42",
			grill: "session:42",
			project: "C:\\workspace\\skills",
		},
		{ version: 1, type: "project", generatedAt: "2000-02-29" },
	] as const;

	for (const input of metadata) {
		const serialized = serializeSddMetadata(input);
		assert.equal(serialized.ok, true);
		if (!serialized.ok) continue;
		const parsed = parseSddArtifact(serialized.marker);
		assert.equal(parsed.kind, "metadata", serialized.marker);
		if (parsed.kind !== "metadata" || parsed.format !== "canonical") continue;
		assert.deepEqual(parsed.metadata, input);
		assert.deepEqual(serializeSddMetadata(parsed.metadata), serialized);
	}
});

test("treats malformed artifact content as data and never throws", () => {
	const malformed = [
		"",
		"\u0000\ud800",
		"<!-- SDD-Tracking: version=1;type=project; generated-at=2026-08-08 -->",
		"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=%41; superseded-by=none -->",
		"<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=none; grill=%C3%28; superseded-by=none -->",
		"<!-- SDD-Tracking: version=999999999999999999999999999; type=project; generated-at=nope",
	];
	for (const markdown of malformed) {
		assert.doesNotThrow(() => parseSddArtifact(markdown), JSON.stringify(markdown));
	}
});

test("runs the Markdown fixture conformance matrix", async () => {
	const cases = [
		["canonical-spec.md", "metadata", "canonical", "spec", "approved", undefined],
		["canonical-grill.md", "metadata", "canonical", "grill", "finalized", undefined],
		["canonical-project.md", "metadata", "canonical", "project", "unknown", undefined],
		["legacy-unknown.md", "metadata", "legacy", "spec", "unknown", undefined],
		["legacy-inferred.md", "metadata", "legacy", "spec", "implemented", undefined],
		["harness-pi.md", "metadata", "legacy", "spec", "approved", undefined],
		["harness-claude.md", "metadata", "legacy", "spec", "implemented", undefined],
		["harness-codex.md", "metadata", "legacy", "spec", "draft", undefined],
		["harness-opencode.md", "metadata", "legacy", "spec", "superseded", undefined],
		["invalid-canonical.md", "invalid", undefined, undefined, "unknown", "missing-key"],
		["unsupported-version.md", "invalid", undefined, undefined, "unknown", "unsupported-version"],
		["invalid-encoding.md", "invalid", undefined, undefined, "unknown", "invalid-encoding"],
		["duplicate-identical.md", "metadata", "canonical", "spec", "draft", "duplicate-canonical"],
		["duplicate-divergent.md", "conflict", undefined, undefined, "unknown", "conflicting-canonical"],
	] as const;

	for (const [file, kind, format, type, state, diagnostic] of cases) {
		const markdown = await readFile(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
		const result = parseSddArtifact(markdown);
		assert.equal(result.kind, kind, file);
		assert.equal(result.kind === "metadata" ? result.format : undefined, format, file);
		assert.equal(result.kind === "metadata" ? result.metadata.type : undefined, type, file);
		assert.equal(result.state.value, state, file);
		assert.equal(result.diagnostics[0]?.code, diagnostic, file);
	}

	const metadata = {
		version: 1,
		type: "project",
		generatedAt: "2026-08-08",
	} as const;
	for (const [file, eol] of [["upsert-lf.md", "\n"], ["upsert-crlf.md", "\r\n"]] as const) {
		const markdown = await readFile(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
		const once = upsertSddMetadata(markdown, metadata);
		assert.equal(once.ok, true, file);
		const twice = upsertSddMetadata(once.document, metadata);
		assert.equal(twice.ok, true, file);
		assert.equal(twice.document, once.document, file);
		assert.equal(once.document.match(/SDD-Tracking/g)?.length, 1, file);
		assert.ok(once.document.includes(eol), file);
		if (eol === "\r\n") assert.equal(/(^|[^\r])\n/.test(once.document), false, file);
		else assert.equal(once.document.includes("\r\n"), false, file);
	}
});
