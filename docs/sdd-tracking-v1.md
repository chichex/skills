# SDD artifact tracking contract — version 1

This document is the single normative definition of machine-readable identity and
lifecycle metadata for SDD specs, grill handoffs, and autonomy contracts. It is
independent of the program that creates or consumes an artifact.

The key words **MUST**, **MUST NOT**, **REQUIRED**, and **SHOULD** are normative.

## Marker and preamble

A marker is a one-line HTML comment in the artifact preamble. The preamble starts
at byte zero (after a leading UTF-8 BOM, `U+FEFF`, if present) and ends
immediately before the first Markdown level-2 heading (`##`). A `##` line that
appears inside a fenced code block (delimited by matching lines of three or
more backticks or three or more tildes) does not end the preamble. Text after
the boundary is body content and MUST NOT be interpreted as artifact metadata.

A leading BOM, when present, MUST remain the first bytes of the document
through every parse and upsert; it is never treated as part of an H1 heading
and never separates the marker from byte zero.

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

A legacy field (`Estado:`/`Status:`, `Proyecto:`/`Project:`, `Fuente:`/`Source:`,
`Grill:`, and a historical `SDD-Tracking:` marker) is only read from a
single-line HTML comment (`<!-- ... -->`). Prose outside a comment MUST NOT be
interpreted as a legacy field, and a line that merely mentions
`SDD-Tracking` without forming a well-formed one-line comment marker MUST NOT
be treated as a historical marker with empty identity; both are ignored as if
they were prose. A well-formed historical marker MAY be indented.

Legacy state readers accept `Estado:` and `Status:`. Comparison trims the value,
collapses repeated whitespace, ignores case, and removes Unicode accents before
matching complete aliases. Value extraction stops before another labeled field
on the same line (including a second `Estado:`/`Status:` field) and before a
trailing `.` that immediately precedes the comment's closing `-->`:

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

Two `superseded` state fields disagree — and therefore yield
`legacy-state-conflict` — not only when their normalized state differs, but
also when both normalize to `superseded` while naming different successor
references (e.g. two `reemplazada por <ref>` fields pointing at different
files). A shared reference is not a conflict.

Recovering the reference named by `reemplazada por <ref>`/`superseded by <ref>`
MUST read it from the raw text, tolerating a stray combining mark (accent)
anywhere in the prefix words; it MUST NOT fall back to the lowercased,
accent-stripped normalized text, which would corrupt a case-sensitive or
accented reference.

Legacy type recognition is content-based and does not receive or inspect a file
name or path:

- specs are recognized from a `Spec` H1, historical `SDD-Tracking` identity, or
  generated/source comments associated with a spec;
- grill handoffs are recognized from a `Grill` H1 or a preamble containing the
  handoff state plus `Proyecto`/`Project` and `Fuente`/`Source` fields;
- autonomy contracts are recognized from a `Contrato de autonomia` or
  `Autonomy contract` H1 plus a `Generado`/`Generated` comment with a date.

An H1 keyword (`Spec`, `Grill`) is recognized regardless of the punctuation
that follows it — a space, `:`, hyphen, or em/en dash, or end of line — so
`# Spec: Title` is recognized the same as `# Spec — Title`.

Spanish and English generated/source labels are equivalent. If signals identify
incompatible artifact types, parsing yields conflict rather than applying a
priority rule.

A legacy document's `issue`/`grill` identity is derived with fallbacks: the
issue comes from a well-formed tracked `issue` field, or otherwise from a
`Fuente:`/`Source:` field; the grill reference comes from a tracked `grill`
field, or otherwise from a `Grill:` field. Any comparison against a legacy
document's identity (including an upsert's identity check, below) MUST apply
the same derivation, not only the raw marker fields — otherwise a document the
parser reads correctly could still be rejected as an identity mismatch.

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

An HTML comment immediately after the H1 that never closes (no `-->` before
the block ends) is not part of the contiguous initial comment block; step 4
anchors before it rather than consuming it, so the marker always lands inside
the preamble the parser will see.

Unrelated bytes remain unchanged. Inserted line endings use the document's
existing `LF` or `CRLF` style. Repeating an equivalent upsert returns identical
bytes and leaves exactly one `SDD-Tracking` marker. A state-only spec update
preserves `issue`, `grill`, and `superseded-by`; a transition that would violate
the supersession invariant is rejected. Changing state and supersession identity
requires an explicit complete-metadata upsert.

When an upsert writes a canonical marker (steps 3 or 4) into a document whose
preamble still carries a legacy `Estado:`/`Status:` field, and that field's
normalized value would disagree with the new canonical state, upsert rewrites
the field's captured value in place to the new state's keyword. The field, its
label, and every other byte on the line are left untouched, and no rewrite
happens when the value already agrees — so a legacy-only consumer that reads
`Estado:`/`Status:` directly, without understanding the canonical marker,
never keeps showing a state a canonical upsert has since changed.

## Version compatibility

Version 1 is immutable. Consumers may add support for later versions, but MUST
report an unsupported version rather than reinterpret it as version 1 or legacy.
Producers that require an incompatible wire-format change MUST emit a new
version.
