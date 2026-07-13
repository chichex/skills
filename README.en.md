# skills

> 🇦🇷 [Leer en español](./README.md)

The skills I use day to day in **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** and **[opencode](https://opencode.ai)**.

They're reusable pieces of knowledge an agent loads on demand: each folder is a skill with its `SKILL.md` (frontmatter `name` + `description` that decides when it applies) and, optionally, reference files the skill reads when it needs them.

The repo is split by tool because the versions aren't identical: the opencode ones are plain ASCII (no diacritics) and there are minor content differences between them. Pick the folder based on where you want to use them.

```
skills/
├── claude/      # versions for Claude Code  (~/.claude/skills)
└── opencode/    # versions for opencode      (~/.config/opencode/skills)
```

> Note: the skill files themselves are in Spanish (Rioplatense). This README is the translated entry point.

## The skills

Two families plus a couple of standalones.

### SDD — Spec-Driven Development

A development pipeline with an explicit contract: **contract → spec → execution**. The point is to let "done" be defined by something verifiable, not by a feeling.

| Skill | What it does |
|---|---|
| **`sdd-init`** | Explores the repo thoroughly and generates `.sdd/project.md`, the *autonomy contract*: how it's run / tested / built, what environments exist, which one to use for testing, and what can be verified without a human. Every command is **executed** before being documented; anything unverified is flagged. |
| **`sdd-spec`** | Turns a request (free text or an issue) into a **verifiable spec**. It surfaces every inference on the table to disambiguate, cross-checks them against the contract, and issues a verifiability verdict (deterministic TDD / flaky e2e / requires human proof) with a concrete plan per criterion. |
| **`sdd-run`** | Executes a spec end to end: clean worktree, plans against the real code, implements **tests first**, verifies each criterion with its declared mechanism, and finishes in a **PR** with the spec as the body + evidence. |

### Domain modeling

| Skill | What it does |
|---|---|
| **`domain-modeling`** | Keeps the domain model alive while designing: challenges terms, sharpens fuzzy language, and writes the glossary (`CONTEXT.md`) and decisions (`docs/adr/`) the moment they crystallize. Zero-contamination rule: it never introduces the practice into a repo that doesn't already use it. |

### Standalones

| Skill | What it does |
|---|---|
| **`grill`** | A relentless interview about a plan or design **before** building. Walks every branch of the decision tree, one question at a time, with a recommended answer, until you reach a shared understanding. |
| **`grill-with-domain-modeling`** | A `grill` that also maintains the domain docs (`CONTEXT.md` + ADRs) as decisions get resolved. |
| **`tdd`** | A test-driven development reference: the red → green loop, what makes a good test, where tests live (seams), the anti-patterns. Includes `mocking` and `tests` guides. |

## Installation

Clone the repo and run `install.sh`. It runs `git pull` and copies each skill into its tool's folder **without wiping the other skills you already have** (it only adds/updates the ones in this repo):

```bash
git clone https://github.com/chichex/skills.git
cd skills
./install.sh            # installs both sets (claude + opencode)
./install.sh claude     # only the Claude Code ones
./install.sh opencode   # only the opencode ones
```

Default destinations: `~/.claude/skills/` and `~/.config/opencode/skills/` (overridable with `CLAUDE_SKILLS_DIR` / `OPENCODE_SKILLS_DIR`).

To **update** later, just run `./install.sh` again — it does the `pull` for you.

If you'd rather do it by hand, it's a plain copy:

```bash
cp -R claude/*   ~/.claude/skills/
cp -R opencode/* ~/.config/opencode/skills/
```

Once installed, they're invoked bare (`/grill`, `/sdd-init`, …) or the agent loads them on its own when the context warrants it, based on their `description`.

## Credits

Four of these skills are **Spanish adaptations** of **[Matt Pocock](https://github.com/mattpocock)**'s skills — from his [mattpocock/skills](https://github.com/mattpocock/skills) repo (MIT):

| In this repo | Matt Pocock's original |
|---|---|
| `grill` | `grilling` |
| `grill-with-domain-modeling` | `grill-with-docs` |
| `domain-modeling` | `domain-modeling` |
| `tdd` | `tdd` |

The **SDD** family (`sdd-init`, `sdd-spec`, `sdd-run`) is my own: inspired by the same way of working (tracer bullets, tests-first, spec → implementation) as his `to-spec` / `to-tickets` / `implement` / `wayfinder` skills, but with different artifacts — the `.sdd/project.md` autonomy contract and the verifiability verdict.

## License

[MIT](./LICENSE) — use them, adapt them, whatever you like.
