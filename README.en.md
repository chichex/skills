# skills

> 🇦🇷 [Leer en español](./README.md)

This repo is built around my own **Spec-Driven Development (SDD)** workflow — plus the foundational skills it builds on. Everything I use day to day in **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, **[opencode](https://opencode.ai)**, and **[Pi](https://github.com/badlogic/pi-mono)**.

Skills are reusable pieces of knowledge an agent loads on demand: each folder is a skill with its `SKILL.md` (frontmatter `name` + `description` that decides when it applies) and, optionally, reference files the skill reads when it needs them.

> Note: the skill files themselves are in Spanish (Rioplatense). This README is the translated entry point.

## The SDD workflow

The heart of the repo, and its original part. A development pipeline with an explicit contract — **contract → spec → execution** — designed so "done" is defined by something verifiable, not by a feeling. Each stage is a skill that chains into the next:

| Skill | Stage | What it does |
|---|---|---|
| **`sdd-init`** | contract | Explores the repo thoroughly and generates `.sdd/project.md`, the *autonomy contract*: how it's run / tested / built, what environments exist, which one to use for testing, and what can be verified without a human. Every command is **executed** before being documented; anything unverified is flagged. |
| **`sdd-spec`** | spec | Turns a request (free text or an issue) into a **verifiable spec**. It surfaces every inference to disambiguate, cross-checks them against the contract, and issues a verifiability verdict (deterministic TDD / flaky e2e / requires human proof) with a concrete plan per criterion. |
| **`sdd-run`** | execution | Executes a spec end to end: clean worktree, plans against the real code, implements **tests first**, verifies each criterion with its declared mechanism, and finishes in a **PR** with the spec as the body + evidence. |

Invoked bare (no args) they open a **Phase 0 — Launcher** that surfaces the options; passing args/flags skips the menu.

## Foundational skills

The disciplines SDD builds on — which I also use standalone, outside the pipeline. They're **based on** [Matt Pocock](https://github.com/mattpocock)'s skills (see [Credits](#credits)).

| Skill | What it does |
|---|---|
| **`grill`** | A relentless interview about a plan or design **before** building. Walks every branch of the decision tree, one question at a time, with a recommended answer, until you reach a shared understanding. |
| **`mini-grill`** | An express `grill`: disambiguates a single request in one to three questions (recommended option first) and confirms the interpretation before acting. If too many decisions surface, it hands off to the full `grill`. |
| **`grill-with-domain-modeling`** | A `grill` that also maintains the domain docs (`CONTEXT.md` + ADRs) as decisions get resolved. |
| **`domain-modeling`** | Keeps the domain model alive while designing: challenges terms, sharpens fuzzy language, and writes the glossary (`CONTEXT.md`) and decisions (`docs/adr/`) the moment they crystallize. Zero-contamination rule: it never introduces the practice into a repo that doesn't already use it. |
| **`tdd`** | A test-driven development reference: the red → green loop, what makes a good test, where tests live (seams), the anti-patterns. Includes `mocking` and `tests` guides. |

SDD doesn't replace these skills — it orchestrates them. The design that precedes a spec is sharpened with `grill` and `domain-modeling`, and `sdd-run` implements following the `tdd` discipline.

In Pi, `sdd-spec` accepts `--from-grill`: it consumes a confirmed handoff without asking again about decisions already settled. The Pi version of `grill` can chain into it on confirmation, and the `grill-tools` extension provides persistence and the option to generate a spec from a finalized session.

## Repo layout

It's split by tool because the versions aren't identical: the opencode and Pi ones are plain ASCII (no diacritics), and tool/command details differ between harnesses. Pick the folder based on where you want to use them.

```
skills/
├── claude/      # versions for Claude Code  (~/.claude/skills)
├── opencode/       # versions for opencode      (~/.config/opencode/skills)
├── pi/             # skills for Pi               (~/.agents/skills)
└── pi-extensions/  # required Pi extensions       (~/.pi/agent/extensions)
```

## Installation

Clone the repo and run `install.sh`. It runs `git pull` and copies each skill —plus the Pi extensions— into its tool's folder **without wiping anything else you already have** (it only adds/updates items from this repo):

```bash
git clone https://github.com/chichex/skills.git
cd skills
./install.sh            # installs all three sets
./install.sh all        # same as above
./install.sh both       # Claude Code + opencode
./install.sh claude     # only the Claude Code ones
./install.sh opencode   # only the opencode ones
./install.sh pi         # only the Pi ones
```

Default destinations: `~/.claude/skills/`, `~/.config/opencode/skills/`, `~/.agents/skills/`, and `~/.pi/agent/extensions/` (overridable with `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, and `PI_EXTENSIONS_DIR`).

To **update** later, just run `./install.sh` again — it does the `pull` for you.

If you'd rather do it by hand, it's a plain copy:

```bash
cp -R claude/*   ~/.claude/skills/
cp -R opencode/* ~/.config/opencode/skills/
cp -R pi/*             ~/.agents/skills/
cp -R pi-extensions/*  ~/.pi/agent/extensions/
```

Once installed, Claude Code/opencode use their usual commands. In Pi, invoke `/skill:grill`, `/skill:sdd-init`, `/skill:sdd-spec`, and `/skill:sdd-run`, or let the agent load them from their `description`. Run `/reload` in an open Pi session after installing.

## Credits

Four of the **foundational skills** are **based on** **[Matt Pocock](https://github.com/mattpocock)**'s skills — from his [mattpocock/skills](https://github.com/mattpocock/skills) repo (MIT); `mini-grill` is my own stripped-down variant of `grill`:

| In this repo | Matt Pocock's original |
|---|---|
| `grill` | `grilling` |
| `grill-with-domain-modeling` | `grill-with-docs` |
| `domain-modeling` | `domain-modeling` |
| `tdd` | `tdd` |

The **SDD** family (`sdd-init`, `sdd-spec`, `sdd-run`) is my own: inspired by the same way of working (tracer bullets, tests-first, spec → implementation) as his `to-spec` / `to-tickets` / `implement` / `wayfinder` skills, but with different artifacts — the `.sdd/project.md` autonomy contract and the verifiability verdict.

## License

[MIT](./LICENSE) — use them, adapt them, whatever you like.
