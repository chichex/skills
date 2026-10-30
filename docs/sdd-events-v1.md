# SDD event log — version 1 (events-v1)

This document is the single normative definition of the local SDD event log: an
append-only record of lifecycle transitions of grills, specs, runs, and merges.
It is independent of the program that writes or reads the log. Artifact
identity and current state remain defined by
[`SDD-Tracking` v1](./sdd-tracking-v1.md); the event log only adds when each
transition happened.

The key words **MUST**, **MUST NOT**, **REQUIRED**, and **SHOULD** are normative.

## Location

The log is the file `<git-common-dir>/chiche/events.jsonl`, where
`<git-common-dir>` is the output of
`git rev-parse --path-format=absolute --git-common-dir` run from any worktree of
the repository. Every worktree of a clone therefore shares one log, and the log
is never part of a working tree: it does not show up in `git status`.

Producers MUST NOT write the log anywhere else. In particular, a producer that
cannot resolve `<git-common-dir>` (outside a Git repository) or cannot write
there (for example, inside a sandbox) MUST skip the event instead of falling
back to a path inside the working tree. A producer creates
`<git-common-dir>/chiche/` and the file when they do not exist.

Consumers also read `<git-common-dir>/sdd/events.jsonl`, the location of the
log before the suite was renamed to chiche, and concatenate both files ordered
by `ts`: for equal `ts`, lines from `sdd/` come first, and the lines of one file
keep their file order. Producers never write to `<git-common-dir>/sdd/`.

The log is local to one clone on one machine. It is not synchronized, and
events produced on another machine never appear in it.

## Line grammar

The log is UTF-8 text. Each event is exactly one line: one JSON object
followed by a single `LF` (`0x0A`). A line, including its terminating `LF`,
MUST be at most 1024 bytes. Lines contain no `CR` and no other `LF`.

Every event has exactly these ten keys, each exactly once and in this order:
`v`, `ts`, `harness`, `event`, `issue`, `spec`, `previous`, `grill`, `pr`, `reason`.
There is no optional key: a key that does not apply carries `none` (or `[]` for
`pr`). Extra keys, missing keys, repeated keys, and reordered keys make a line
invalid.

The serialization is canonical and has a single byte form, with no
insignificant whitespace:

```text
{"v":1,"ts":"<ts>","harness":"<harness>","event":"<event>","issue":"<issue>","spec":"<ref|none>","previous":"<ref|none>","grill":"<ref|none>","pr":[<n>,<n>],"reason":"<reason>"}
```

Every string value is printable ASCII without `"` or `\`, so a line never needs
a JSON escape and can be written with `printf '%s\n' "$line"`: the line goes as
an argument, never as the format, because references carry `%HH` sequences
that a format would interpret. Numbers are decimal integers with no sign,
leading zero, fraction, or exponent. A line that is valid JSON with the right
keys and values but whose bytes differ from the canonical form (extra spaces,
escapes such as `\u0041`, `1.0`) is invalid.

## Field semantics

- `v` MUST be the number `1`.
- `ts` is the UTC time of the transition as `YYYY-MM-DDTHH:MM:SSZ`: a real
  Gregorian date with a year from `0001` through `9999`, hours `00`–`23`,
  minutes and seconds `00`–`59`. Producers truncate sub-second precision
  (`date -u +%Y-%m-%dT%H:%M:%SZ`).
- `harness` MUST be `claude`, `codex`, `opencode`, `pi`, or `antigravity`: the harness whose
  skill or tool produced the event.
- `event` MUST be one of the catalog below.
- `issue` MUST be `none`, `#NN`, or `owner/repo#NN`, with the same grammar as
  the `issue` field of `SDD-Tracking` v1: the source issue of the artifact.
  `#NN` is relative to the repository of the clone: a consumer that correlates
  events by issue resolves `#NN` against that repository, so in a clone of
  `owner/repo`, `#93` and `owner/repo#93` name the same issue.
- `spec` is a `<ref>` or `none`: the identity of the spec. It is the issue
  reference (`#NN` or `owner/repo#NN`) when the spec lives in an issue body,
  and otherwise its logical path `.sdd/specs/<slug>.md` — the same convention as
  `superseded-by`. When a spec has both a local copy and an issue copy, the
  issue reference wins. The identity therefore changes when a spec published
  only under its logical path is carried to an issue; `spec.moved` links both
  identities.
- `previous` is a `<ref>` or `none`: in `spec.moved`, the identity the spec had
  before (its logical path `.sdd/specs/<slug>.md`), with `spec` carrying the
  new one. It is `none` in every other event.
- `grill` is a `<ref>` or `none`: the logical grill id, the same value as the
  `grill` field of the handoff marker.
- `pr` is a JSON array of positive integers: the pull request numbers of the
  event, in stack layer order (bottom first). It is `[]` when the event has no
  pull request.
- `reason` MUST be `none`, `aborted`, or `interrupted`.

### Reference encoding

`spec`, `previous`, and `grill` use exactly the `<ref>` encoding of `SDD-Tracking` v1
("Reference encoding"): the UTF-8 bytes of the value, with only bytes
representing `[A-Za-z0-9._~-]` left literal and every other byte encoded as
`%HH` with uppercase hexadecimal digits. Non-canonical encodings are invalid.
For example, `.sdd/specs/x.md` is `.sdd%2Fspecs%2Fx.md` and `#93` is `%2393`.
The token `none` is the null sentinel; an actual reference MUST NOT decode to
`none`.

## Event catalog

| Event | Emitted when | Invariants |
|---|---|---|
| `grill.paused` | a grill is paused or saved for later | `grill` ≠ `none`; `pr=[]` |
| `grill.finalized` | the final grill handoff is persisted | `grill` ≠ `none`; `pr=[]` |
| `spec.published` | a spec is published in `draft` (every publication with a receipt, including a republication and a return to `draft`) | `spec` ≠ `none`; `pr=[]` |
| `spec.moved` | a spec published only under its logical path is carried to an issue, so its identity changes from `previous` (`.sdd/specs/<slug>.md`) to `spec` (`#NN`); emitted before the publication event of the same publication | `spec` ≠ `none`; `previous` ≠ `none`; `pr=[]` |
| `spec.approved` | a spec transitions to `approved`: its persisted state before the publication was not `approved`. Republishing a spec that is already `approved` emits nothing | `spec` ≠ `none`; `pr=[]` |
| `spec.superseded` | a predecessor spec is superseded (one event per predecessor) | `spec` ≠ `none`; `pr=[]` |
| `run.started` | a run created its worktree and branch, or its stack | `spec` ≠ `none`; `pr=[]` |
| `run.pr-opened` | a run opened its pull request, or submitted its stack | `spec` ≠ `none`; `pr` not empty, every PR of the stack in layer order |
| `run.committed` | a run ends committed without a pull request (`--no-pr`) | `spec` ≠ `none`; `pr=[]` |
| `run.failed` | a run aborts after `run.started` (`aborted`) or is interrupted (`interrupted`) | `spec` ≠ `none`; `pr=[]`; `reason` is `aborted` or `interrupted` |
| `land.merged` | a merge of one pull request was verified | `pr` has exactly one number |

In every event except `run.failed`, `reason` MUST be `none`.
In every event except `spec.moved`, `previous` MUST be `none`. A line that
violates an invariant is invalid.

## Appending

A producer appends one complete line per event with a single write to the
file opened in append mode (`O_APPEND`). There is no lock: local filesystems
apply each such write atomically, which is why a line is bounded to 1024 bytes.
Producers MUST NOT rewrite, truncate, reorder, or delete existing lines.

Appending is best-effort. A failed append (an unresolvable `<git-common-dir>`,
a missing permission, `events.jsonl` being a directory) MUST NOT block or fail
the operation that produced the event; the producer reports the failure in one
line and continues. An event that was not appended is lost; there is no retry
queue and no backfill.

## Reading

Consumers read the log line by line, in file order, which is append order.
`ts` values from different processes are not guaranteed to be monotonic.

Parsing a line is total: it never throws, and it yields exactly one of a valid
event, an unsupported version, or an invalid line with a typed diagnostic. A
line whose `v` is not `1` is an unsupported version, not an invalid line.
Consumers MUST skip invalid and unsupported lines and keep reading. A final
segment without its terminating `LF` may be an append in progress or a
truncated write; consumers MUST ignore it rather than treat it as an event.

Diagnostics are stable codes: `invalid-json`, `duplicate-key`, `missing-key`,
`extra-key`, `key-order`, `line-too-long`, `invalid-ts`, `invalid-harness`,
`invalid-event`, `invalid-issue`, `invalid-reference`, `invalid-pr`,
`invalid-reason`, `invariant-violation`, `non-canonical`, and
`unsupported-version`.

## Conformance vectors

The following concrete vectors are normative serializer outputs, at least one
per event of the catalog. Tests may read this delimited block directly to
detect drift.

<!-- conformance-vectors:start -->
```jsonl
{"v":1,"ts":"2026-10-14T12:00:00Z","harness":"claude","event":"grill.paused","issue":"none","spec":"none","previous":"none","grill":"2026-10-14-visualizacion-harness","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T12:30:05Z","harness":"pi","event":"grill.finalized","issue":"owner/repo#9","spec":"none","previous":"none","grill":"session%209%2F%C3%A1","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T13:00:00Z","harness":"codex","event":"spec.published","issue":"none","spec":".sdd%2Fspecs%2Fsdd-events.md","previous":"none","grill":"2026-10-14-visualizacion-harness","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T13:05:00Z","harness":"pi","event":"spec.moved","issue":"#93","spec":"%2393","previous":".sdd%2Fspecs%2Fsdd-events.md","grill":"2026-10-14-visualizacion-harness","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T13:10:00Z","harness":"opencode","event":"spec.approved","issue":"#93","spec":"%2393","previous":"none","grill":"2026-10-14-visualizacion-harness","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T13:10:00Z","harness":"pi","event":"spec.superseded","issue":"#12","spec":".sdd%2Fspecs%2Fold.md","previous":"none","grill":"none","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T14:00:00Z","harness":"claude","event":"run.started","issue":"#93","spec":"%2393","previous":"none","grill":"2026-10-14-visualizacion-harness","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T15:45:59Z","harness":"claude","event":"run.pr-opened","issue":"#93","spec":"%2393","previous":"none","grill":"2026-10-14-visualizacion-harness","pr":[101,102],"reason":"none"}
{"v":1,"ts":"2026-10-14T16:00:00Z","harness":"codex","event":"run.committed","issue":"none","spec":".sdd%2Fspecs%2Fsdd-events.md","previous":"none","grill":"none","pr":[],"reason":"none"}
{"v":1,"ts":"2026-10-14T16:20:00Z","harness":"opencode","event":"run.failed","issue":"none","spec":".sdd%2Fspecs%2Fsdd-events.md","previous":"none","grill":"none","pr":[],"reason":"aborted"}
{"v":1,"ts":"2026-10-14T16:25:00Z","harness":"pi","event":"run.failed","issue":"#93","spec":"%2393","previous":"none","grill":"none","pr":[],"reason":"interrupted"}
{"v":1,"ts":"2026-10-15T09:00:00Z","harness":"pi","event":"land.merged","issue":"#93","spec":"none","previous":"none","grill":"none","pr":[101],"reason":"none"}
```
<!-- conformance-vectors:end -->

## Version compatibility

Version 1 is immutable. Consumers may add support for later versions, but MUST
report an unsupported version rather than reinterpret it as version 1.
Producers that require an incompatible change of the line format MUST emit a
new version.
