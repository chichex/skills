# SDD artifact tracking contract — version 1

This document is the single normative definition of machine-readable identity and
lifecycle metadata for SDD specs, grill handoffs, and autonomy contracts. It is
independent of the program that creates or consumes an artifact.

The key words **MUST**, **MUST NOT**, **REQUIRED**, and **SHOULD** are normative.

## Marker and preamble

A marker is a one-line HTML comment in the artifact preamble. The preamble starts
at byte zero and ends immediately before the first Markdown level-2 heading
(`##`). Text after that boundary is body content and MUST NOT be interpreted as
artifact metadata.

Version 1 uses exactly the marker name `SDD-Tracking`, one ASCII space after the
colon, `; ` (semicolon plus one ASCII space) between fields, and one ASCII space
before `-->`. Field names, field order, separators, and enum spellings are part
of the wire format:

```html
<!-- SDD-Tracking: version=1; type=spec; state=<draft|approved|implemented|superseded>; issue=<#NN|owner/repo#NN|none>; grill=<ref|none>; superseded-by=<ref|none> -->
<!-- SDD-Tracking: version=1; type=grill; state=<paused|finalized>; issue=<#NN|owner/repo#NN|none>; grill=<ref>; project=<ref> -->
<!-- SDD-Tracking: version=1; type=project; generated-at=<YYYY-MM-DD> -->
```

There is no optional field in a version 1 schema. Keys MUST occur exactly once
and in the displayed order. Extra keys, missing keys, repeated keys, reordered
keys, empty values, alternate separators, or alternate whitespace make a
canonical marker invalid.

## Field semantics

- `version` MUST be the decimal byte `1`.
- `type` MUST be `spec`, `grill`, or `project` and selects the complete schema.
- A spec `state` MUST be `draft`, `approved`, `implemented`, or `superseded`.
- A grill `state` MUST be `paused` or `finalized`.
- `unknown` is a normalized read result only. It MUST NOT be serialized.
- `issue` MUST be `none`, `#NN`, or `owner/repo#NN`. `NN` is a positive decimal
  integer with no sign or leading zero. Owner and repository components contain
  one or more ASCII letters, digits, `.`, `_`, or `-`.
- `generated-at` MUST be a real Gregorian calendar date in `YYYY-MM-DD` form,
  with a year from `0001` through `9999`.
- A spec with `state=superseded` MUST have `superseded-by` other than `none`.
  Every other spec state MUST have `superseded-by=none`.
- Grill `grill` and `project` references are required and therefore MUST NOT be
  empty or `none`.

### Reference encoding

A `<ref>` is serialized from its Unicode scalar value string as UTF-8 bytes.
Only bytes representing `[A-Za-z0-9._~-]` remain literal. Every other byte MUST
be encoded as `%HH`, using uppercase hexadecimal digits. Encoded unreserved
bytes, lowercase hexadecimal escapes, malformed escapes, invalid UTF-8, raw
non-ASCII, and raw reserved bytes are non-canonical and invalid. Decoding and
re-encoding a valid reference therefore reproduces the same bytes.

The token `none` is the null sentinel only where the schema allows it. An actual
reference MUST be non-empty and MUST NOT decode to `none`. Required references
have no null sentinel.

## Conformance vectors

The following concrete vectors are normative serializer outputs. Tests may read
this delimited block directly to detect drift.

<!-- conformance-vectors:start -->
```html
<!-- SDD-Tracking: version=1; type=spec; state=approved; issue=owner/repo#9; grill=session%209%2F%C3%A1; superseded-by=none -->
<!-- SDD-Tracking: version=1; type=grill; state=finalized; issue=none; grill=grill-9; project=%2Fworkspace%2Fskills -->
<!-- SDD-Tracking: version=1; type=project; generated-at=2026-08-08 -->
```
<!-- conformance-vectors:end -->

## Parsing and precedence

Parsing is total for artifact content: malformed content produces a typed result
rather than an exception. Results distinguish valid metadata, absence, invalid
content, and conflict; preserve raw metadata when present; and expose stable,
typed diagnostics.

A marker that declares `version` or `type` is a canonical candidate. An unknown
version or type, malformed wrapper or syntax, schema violation, invalid value,
or failed invariant is invalid canonical content. It MUST NOT fall back to
legacy interpretation. A historical `SDD-Tracking` marker that declares neither
`version` nor `type` is legacy metadata, not corrupt canonical metadata.

A valid canonical marker takes precedence as one complete unit. Canonical and
legacy fields MUST NOT be merged. For state-bearing artifacts, provenance is
exactly one of `canonical`, `legacy-explicit`, `legacy-inferred`, or `absent`.
Invalid or unrecognized legacy state normalizes to `unknown`; `unknown` remains
a normal read result.

Two or more byte-identical valid canonical markers yield valid metadata plus a
`duplicate-canonical` diagnostic. Divergent canonical markers yield conflict;
no marker wins. An upsert collapses identical duplicates to one and leaves a
document with divergent duplicates unchanged with a typed error.

## Legacy compatibility

Only preamble signals participate in legacy recognition. This prevents examples
or archived metadata in the body from changing artifact identity.

Legacy state readers accept `Estado:` and `Status:`. Comparison trims the value,
collapses repeated whitespace, ignores case, and removes Unicode accents before
matching complete aliases:

| Legacy value | Normalized value |
|---|---|
| `draft`, `borrador` | `draft` |
| `aprobada`, `approved`, `pendiente de ejecución` | `approved` |
| `implementada`, `implemented` | `implemented` |
| `reemplazada`, `superseded`, `reemplazada por <ref>`, `superseded by <ref>` | `superseded` |
| `paused` | `paused` |
| `finalized` | `finalized` |
| any other explicit value | `unknown` |

The original state value and `legacy-explicit` provenance are retained, including
for `unknown`. An explicit known or unknown state always wins over inference. If
there is no explicit state, a level-2 heading whose normalized title is exactly
`Resultado de ejecucion`, optionally followed by a parenthesized suffix,
normalizes to `implemented` with `legacy-inferred` provenance.

Legacy type recognition is content-based and does not receive or inspect a file
name or path:

- specs are recognized from a `Spec` H1, historical `SDD-Tracking` identity, or
  generated/source comments associated with a spec;
- grill handoffs are recognized from a `Grill` H1 or a preamble containing the
  handoff state plus `Proyecto`/`Project` and `Fuente`/`Source` fields;
- autonomy contracts are recognized from a `Contrato de autonomia` or
  `Autonomy contract` H1 plus a `Generado`/`Generated` comment with a date.

Spanish and English generated/source labels are equivalent. If signals identify
incompatible artifact types, parsing yields conflict rather than applying a
priority rule.

## Serialization and upsert

Serialization is deterministic and accepts only complete metadata satisfying the
selected schema and its invariants. It has no implicit clock, filesystem,
repository, or process context. Dates, issues, and references are explicit
inputs. Parse followed by serialize MUST reproduce canonical marker bytes.

Upsert is a pure string-in/string-out operation:

1. Replace one usable canonical marker in place.
2. Collapse byte-identical canonical duplicates at that position.
3. If no canonical marker exists, replace one compatible historical
   `SDD-Tracking` marker in place.
4. Otherwise insert after an initial H1 and its contiguous initial HTML-comment
   block, or at byte zero when no H1 exists.

Unrelated bytes remain unchanged. Inserted line endings use the document's
existing `LF` or `CRLF` style. Repeating an equivalent upsert returns identical
bytes and leaves exactly one `SDD-Tracking` marker. A state-only spec update
preserves `issue`, `grill`, and `superseded-by`; a transition that would violate
the supersession invariant is rejected. Changing state and supersession identity
requires an explicit complete-metadata upsert.

## Version compatibility

Version 1 is immutable. Consumers may add support for later versions, but MUST
report an unsupported version rather than reinterpret it as version 1 or legacy.
Producers that require an incompatible wire-format change MUST emit a new
version.
