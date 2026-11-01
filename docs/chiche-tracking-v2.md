# Chiche artifact tracking contract — version 2

This document is the normative definition of the `Chiche-Tracking` marker,
version 2. It replaces [`SDD-Tracking` version 1](sdd-tracking-v1.md) as the
marker producers write. Version 1 stays valid for reading.

The key words **MUST**, **MUST NOT**, **REQUIRED**, and **SHOULD** are normative.

## Relation to version 1

Version 2 changes only the marker name and the version number. Everything else
is inherited byte for byte from [sdd-tracking-v1.md](sdd-tracking-v1.md):

- the preamble boundary, BOM handling, and the one-line HTML comment form;
- the three schemas (`spec`, `grill`, `project`), their field names, field
  order, separators, and enum spellings;
- field semantics, invariants, and the `<ref>` percent-encoding;
- parsing totality, canonical precedence, duplicate handling, legacy
  compatibility, and the upsert steps.

Where version 1 names `SDD-Tracking` in those rules, a version 2 reader applies
the same rule to either marker name, as described below.

## Marker

Version 2 uses exactly the marker name `Chiche-Tracking` and `version=2`. The
name is case-sensitive. The separators are the ones version 1 defines: one ASCII
space after the colon, `; ` between fields, and one ASCII space before `-->`.

```html
<!-- Chiche-Tracking: version=2; type=spec; state=<draft|approved|implemented|superseded>; issue=<#NN|owner/repo#NN|none>; grill=<ref|none>; superseded-by=<ref|none> -->
<!-- Chiche-Tracking: version=2; type=grill; state=<paused|finalized>; issue=<#NN|owner/repo#NN|none>; grill=<ref>; project=<ref> -->
<!-- Chiche-Tracking: version=2; type=project; generated-at=<YYYY-MM-DD> -->
```

Each marker name is bound to one version:

| Marker name | `version` | Status |
|---|---|---|
| `Chiche-Tracking` | `2` | current; producers write it |
| `SDD-Tracking` | `1` | read-only; still valid |

- `Chiche-Tracking` with `version=1` and `SDD-Tracking` with `version=2` are
  invalid canonical content with the `marker-version-mismatch` diagnostic. They
  MUST NOT be reinterpreted under the other name.
- Any other version under either name is invalid with `unsupported-version`.
- `Chiche-Tracking` has no historical form. A `Chiche-Tracking` comment that
  declares neither `version` nor `type` is invalid canonical content, not
  legacy metadata. Only `SDD-Tracking` has a historical form (version 1,
  "Parsing and precedence").

A reader exposes, for valid canonical metadata, the marker name it read
(`Chiche-Tracking` or `SDD-Tracking`) and that marker's version (`2` or `1`).
The field schema is the same for both, so the decoded metadata is identical.

## Coexistence

A document carries exactly one tracking marker: either one `Chiche-Tracking`
version 2 marker or one `SDD-Tracking` version 1 marker.

- Byte-identical duplicates of one marker keep the version 1 rule: valid
  metadata plus `duplicate-canonical`.
- A `SDD-Tracking` marker and a `Chiche-Tracking` marker in the same preamble
  are divergent canonical markers, even when their fields agree. The result is
  `conflict` with `conflicting-canonical`; no marker wins, and an upsert leaves
  the document unchanged with that error.

Serialization always writes `Chiche-Tracking: version=2`. A rewrite (upsert or
state-only update) of a document that carries a valid `SDD-Tracking` version 1
marker, or a historical `SDD-Tracking` marker, migrates it to version 2 in
place: the new marker replaces the old line at the same position, every other
byte stays unchanged, and the document ends with exactly one marker. Repeating
the rewrite returns identical bytes.

## Conformance vectors

The following concrete vectors are normative serializer outputs. They encode
the same metadata as the version 1 vectors, line by line, and differ only in
the marker name and version. Tests read this delimited block directly and
compare it byte for byte.

<!-- conformance-vectors:start -->
```html
<!-- Chiche-Tracking: version=2; type=spec; state=approved; issue=owner/repo#9; grill=session%209%2F%C3%A1; superseded-by=none -->
<!-- Chiche-Tracking: version=2; type=grill; state=finalized; issue=none; grill=grill-9; project=%2Fworkspace%2Fskills -->
<!-- Chiche-Tracking: version=2; type=project; generated-at=2026-08-08 -->
```
<!-- conformance-vectors:end -->

## Version compatibility

Version 2 is immutable. Consumers MUST keep reading version 1 as defined by
[sdd-tracking-v1.md](sdd-tracking-v1.md). Producers that require an
incompatible wire-format change MUST emit a new version.
