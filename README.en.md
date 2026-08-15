# skills

> 🇦🇷 [Leer en español](./README.md)

This repo is built around my own **Spec-Driven Development (SDD)** workflow — plus the foundational skills it builds on. Everything I use day to day in **[Codex](https://developers.openai.com/codex/)**, **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, **[opencode](https://opencode.ai)**, and **[Pi](https://github.com/badlogic/pi-mono)**.

Skills are reusable pieces of knowledge an agent loads on demand: each folder is a skill with its `SKILL.md` (frontmatter `name` + `description` that decides when it applies) and, optionally, reference files the skill reads when it needs them.

> Note: the skill files themselves are in Spanish (Rioplatense). This README is the translated entry point.

## The SDD workflow

The heart of the repo, and its original part. A development pipeline with an explicit contract — **contract → spec → execution** — designed so "done" is defined by something verifiable, not by a feeling. Each stage is a skill that chains into the next:

| Skill | Stage | What it does |
|---|---|---|
| **`sdd-init`** | contract | Explores the repo thoroughly and generates `.sdd/project.md`, the *autonomy contract*: how it's run / tested / built, what environments exist, which one to use for testing, and what can be verified without a human. Every command is **executed** before being documented; anything unverified is flagged. It also captures the *generation policies* the user activates (max PR size, minimum coverage, new dependencies, commit convention, and technology-specific policies — style guides, max lines per file), which `sdd-run` enforces as hard gates or follows as explicit guidelines. |
| **`sdd-spec`** | spec | Turns a request (free text or an issue) into a **verifiable spec**. It surfaces every inference to disambiguate, cross-checks them against the contract, and issues a verifiability verdict (deterministic TDD / flaky e2e / requires human proof) with a concrete plan per criterion. With `--from-grill` (all four harnesses; in Pi it also accepts the session ID) it starts from a finalized `grill` handoff in `.sdd/grills/`: decisions the grill already settled enter the spec as confirmed and are never asked again; the bare launcher offers `De un grill cerrado` whenever handoffs exist. |
| **`sdd-run`** | execution | Executes a spec end to end: clean worktree, plans against the real code, implements **tests first**, verifies each criterion with its declared mechanism, and finishes in a **PR** with the spec as the body + evidence. |

Invoked bare (no args) they open a **Phase 0 — Launcher** that surfaces the options; passing args/flags skips the menu.

## Foundational skills

The disciplines SDD builds on — which I also use standalone, outside the pipeline. Some are **based on** [Matt Pocock](https://github.com/mattpocock)'s skills (see [Credits](#credits)); others are original.

| Skill | What it does |
|---|---|
| **`grill`** | A relentless interview about a plan or design **before** building. In all four harnesses it starts with an upfront reconnaissance (code, domain docs, previous handoffs) that builds the decision tree with its dependencies and persists and resumes sessions in `.sdd/grills/` (Pi resumes from its global runtime snapshot, but every pause or close also writes the interoperable handoff into the project's `.sdd/grills/`), can export the pending decisions as a self-contained questionnaire for a stakeholder without an agent (e.g., pasting it into a Google Doc), and on close chains into `sdd-spec --from-grill`. In Claude Code the interview runs **in rounds** over the dependency frontier — each `AskUserQuestion` call presents up to 4 already-unblocked decisions — or one question at a time for dense trees, with a lightweight shortcut when 1-3 questions are enough. In all four harnesses it can also maintain domain documentation. |
| **`mini-grill`** *(Codex/Claude/opencode)* | An express `grill`: disambiguates a single request in one to three questions (recommended option first) and confirms the interpretation before acting. If too many decisions surface, it hands off to the full `grill`. |
| **`grill-with-domain-modeling`** *(Codex/Claude/opencode)* | A `grill` that also maintains the domain docs (`CONTEXT.md` + ADRs) as decisions get resolved. In all four harnesses this mode can also be selected inside `grill`; in Claude Code this skill is a wrapper that pins that choice and skips the configuration question. |
| **`domain-modeling`** | Keeps the domain model alive while designing: challenges terms, sharpens fuzzy language, and writes the glossary (`CONTEXT.md`) and decisions (`docs/adr/`) the moment they crystallize. Zero-contamination rule: it never introduces the practice into a repo that doesn't already use it. |
| **`tdd`** | A test-driven development reference: the red → green loop, what makes a good test, where tests live (seams), the anti-patterns. Includes `mocking` and `tests` guides. Available in all four harnesses; `sdd-run` references its doctrine when declaring the plan's seams and in the tests-first step. |
| **`code-review`** *(Codex/Pi/opencode)* | Reviews a PR across three separate axes—correctness and risk, standards, and spec—runs available checks, reports evidence-backed findings with the exact preview of the comments, and finally asks whether to post them to GitHub as a single COMMENT review. It never posts without explicit confirmation. |
| **`github-issue-selector`** *(Codex/Pi)* | Lets you choose or inspect an issue when no specific number was provided. |
| **`issue-triage`** *(Codex/Claude/Pi)* | Analyzes one or more issues against code, tests, and dependencies; classifies the next stage and emits a structured handoff after confirmation, but never executes it. Joint selections become one canonical issue while originals are closed as superseded. |
| **`quick-run`** *(Codex/Claude/Pi)* | Consumes only a confirmed `issue-triage` handoff to implement a small change in an isolated worktree, with tests first when applicable, a finite attempt budget, and a PR or local commit carrying exact evidence. |
| **`repo-clean`** *(Codex/Pi)* | Leaves the current branch with no pending changes and synchronized with `origin/<branch>`. When uncommitted work exists, it shows the impact and asks whether to preserve or discard it; it never switches branches or force-pushes. |
| **`find-skills`** *(Codex/Pi)* | Searches the open ecosystem for installable skills through `npx skills`. Vendored from `vercel-labs/skills`. |
| **`yt-summary`** *(Codex/Claude)* | Downloads a single YouTube subtitle track with `yt-dlp` and guides a summary with a TL;DR, key points, and timestamps. |

SDD doesn't replace these skills — it orchestrates them. The design that precedes a spec is sharpened with `grill` and `domain-modeling`, and `sdd-run` implements following the `tdd` discipline.

Separately, the repo has an **internal skill** at `.claude/skills/harness-port/`: it guides porting and maintaining skills across the four harnesses (identical doctrine, only the interaction layer changes — question tool, invocation syntax, extras like the `agents/openai.yaml` sidecar in Codex or the `compatibility` field in Pi), with the codex/pi `code-review` pair as the canonical example. It's a Claude Code project skill: it only loads while working inside this repo, and it isn't distributed by `install.sh` or the plugin.

### Pi integration

In Pi, `grill` is the single interview entry point: the user chooses between handoff only and maintaining domain documentation as well. The current rail uses structured signals and skills materialized from Pi's canonical provenance; entrypoints no longer merely inject slash skills as text.

#### Orchestrated rail and session boundaries

The public entrypoints are `/issues` for triage, `/grills` for resuming interviews, `/specs` for finding/inspecting specs, and `/sdd-run <path|#NN>` for direct execution authorization.

| Transition | Session boundary |
|---|---|
| `/issues` → confirmed Grill/Spec/Quick-run/Run | Fresh **child session**, linked through `parentSession`; stop, error, rejection, or cancellation preserve the triage session. |
| Active/paused Grill → resume | **Same session**; the authoritative snapshot reconstructs progress. |
| Finalized Grill → Spec | **Same session**; the handoff is persisted before `sdd-spec --from-grill` is materialized. |
| Spec → Run | **Child session**, only after explicit authorization through **Run now**, `/sdd-run`, or **Run** in `/specs`. |
| Triage → Quick-run | Clean **child session**; `quick-run` retains its own preflight, worktree, TDD, budget, and no-merge PR delivery. |

For cross-project launches, the request uses the target project's root, repository, and artifact: the child is stored there, loads its project-scoped resources, and copies no origin transcript. Finding a spec does not run it, inspecting/cancelling does not switch sessions, and the workflow never merges PRs.

Errors fail closed before the switch. If replacement already happened and kickoff or resource loading fails, the result is reported honestly as a `post-switch` error, retains the child reference, and never pretends the origin was rolled back.

The repo also keeps every global Pi extension used by this workflow:

| Extension | What it adds |
|---|---|
| **`ask-user-question`** | The `ask_user_question` tool with single/multiple selection, recommendations, free-text answers, and optional empty submission. |
| **`claude-tool-renderer.ts`** | Renders edits with a compact Claude Code-style header and diff. |
| **`grill-tools`** | Persistence through `grill_session`, the `select_grill_session` selector, and `/grills` and `/specs`; Grill resume and Grill → Spec preserve the conversation. |
| **`workflow-orchestrator`** | Consumes `WorkflowResolutionV1`, materializes canonical skills, manages bounded one-shot receipts, and opens same/cross-project child sessions. It also registers `/sdd-run`; the `launch_sdd_run` gate is active only when the root has a canonical `.sdd/project.md`. |
| **`inline-skill-autocomplete`** | Opens skill autocomplete when `/` or `/skill:…` is typed anywhere in a draft. On submit, it promotes the invocation so Pi expands it correctly. |
| **`github-issue-selector.ts`** + **`github-issues.ts`** | The `select_github_issue` tool and multi-select `/issues` command. Its unified menu can analyze through `issue-triage`, bulk-close, or bulk-delete the selection. |
| **`github-prs`** | The `/prs` command; its review action invokes `/skill:code-review`. |
| **`visual-footer.ts`** | A visual footer with status, model, tokens, and current directory; toggle it with `/visual-footer`. |
| **`warp-status.ts`** | Emits Pi status events for Warp's terminal integration. |


It also includes the global **`claude-code`** theme with the palette used by these interfaces.

## Repo layout

It's split by tool because the versions aren't identical and each harness exposes different tools and commands. Pick the folder based on where you want to use them.

```
skills/
├── codex/       # versions for Codex        (~/.codex/skills)
├── claude/      # versions for Claude Code  (~/.claude/skills)
├── opencode/       # versions for opencode      (~/.config/opencode/skills)
├── pi/             # skills for Pi               (~/.agents/skills)
├── pi-extensions/  # Pi extensions                (~/.pi/agent/extensions)
├── pi-themes/      # Pi themes                    (~/.pi/agent/themes)
├── .claude/        # the repo's internal project skills (harness-port)
├── .claude-plugin/ # Claude Code plugin marketplace + manifest
├── .github/        # CI (GitHub Actions)
└── scripts/        # frontmatter lint and drift report (used by CI)
```

The repo runs CI on GitHub Actions (`.github/workflows/ci.yml`): it validates shell syntax and style (`bash -n` + shellcheck), the frontmatter of every skill (`scripts/lint-frontmatter.sh`, which also runs on local macOS), and the `pi-extensions` tests on Node 26. It also publishes an informational drift report between each skill's per-harness copies (`scripts/drift-report.sh`): the expected divergence is only each harness's interaction layer; a large divergence in doctrine warrants manual review.

## Installation

### Claude Code: as a plugin (recommended)

The `claude/` skills can be installed as a Claude Code plugin, without cloning the repo or running `install.sh`:

```
/plugin marketplace add chichex/skills
/plugin install chichex-skills@chichex
```

The plugin exposes every skill in `claude/` and updates itself with each push to the repo (no pinned version: Claude Code versions by commit, so each push arrives as an automatic update).

### All harnesses: with `install.sh`

Clone the repo and run `install.sh`. It runs `git pull` and copies each skill—plus Pi extensions, both standalone `.ts` files and directories with `index.ts`—into its tool's folder **without wiping anything else you already have** (it only adds/updates items from this repo):

```bash
git clone https://github.com/chichex/skills.git
cd skills
./install.sh            # installs all four sets
./install.sh all        # same as above
./install.sh both       # Claude Code + opencode
./install.sh codex      # only the Codex ones
./install.sh claude     # only the Claude Code ones
./install.sh opencode   # only the opencode ones
./install.sh pi         # only the Pi ones
```

Default destinations: `${CODEX_HOME:-~/.codex}/skills/`, `~/.claude/skills/`, `~/.config/opencode/skills/`, `~/.agents/skills/`, `~/.pi/agent/extensions/`, and `~/.pi/agent/themes/` (overridable with `CODEX_SKILLS_DIR`, `CLAUDE_SKILLS_DIR`, `OPENCODE_SKILLS_DIR`, `PI_SKILLS_DIR`, `PI_EXTENSIONS_DIR`, and `PI_THEMES_DIR`).

Because Codex also discovers Pi skills under `~/.agents/skills` and does not merge duplicate names, installing the Codex set adds a managed block to `${CODEX_HOME:-~/.codex}/config.toml`. It disables only the Pi copies that have an equivalent under `codex/`; Pi keeps using its files normally. The rest of `config.toml` is preserved and later runs update the same block without duplicating it. Set `CODEX_DEDUPLICATE_PI_SKILLS=0` to skip this change or `CODEX_CONFIG_FILE` to target another config.

To **update** later, just run `./install.sh` again — it does the `pull` for you.

If you'd rather do it by hand, it's a plain copy:

```bash
cp -R codex/*    "${CODEX_HOME:-$HOME/.codex}/skills/"
cp -R claude/*   ~/.claude/skills/
cp -R opencode/* ~/.config/opencode/skills/
cp -R pi/*             ~/.agents/skills/
cp -R pi-extensions/*  ~/.pi/agent/extensions/
cp pi-themes/*.json    ~/.pi/agent/themes/
```

Once installed, Codex invokes them as `$grill`, `$code-review`, `$sdd-spec`, and so on, or loads them from their `description` — except for `sdd-run` and `quick-run`: their `agents/openai.yaml` sidecars declare `policy.allow_implicit_invocation: false`, so they only run when explicitly invoked with `$sdd-run` or `$quick-run`. Claude Code/opencode use their usual commands. Pi uses `/skill:grill`, `/skill:code-review`, `/skill:sdd-spec`, and equivalents.

**Pi rollout:** run `./install.sh pi` only with explicit authorization, because it updates the checkout and replaces the managed global copies; then run `/reload`. Already-open sessions do not receive the new code until they reload. Interactive testing requires a persisted session and two disposable repositories; real stages require a local/fake provider or explicitly authorized provider usage. The autonomous smoke test runs neither the installer nor providers.

## Credits

Four of the **foundational skills** are **based on** **[Matt Pocock](https://github.com/mattpocock)**'s skills — from his [mattpocock/skills](https://github.com/mattpocock/skills) repo (MIT); `mini-grill` is my own stripped-down variant of `grill`:

| In this repo | Matt Pocock's original |
|---|---|
| `grill` | `grilling` |
| `grill-with-domain-modeling` | `grill-with-docs` |
| `domain-modeling` | `domain-modeling` |
| `tdd` | `tdd` |

In addition, `grill`'s **questionnaire export** is inspired by his `to-questionnaire` skill.

The **SDD** family (`sdd-init`, `sdd-spec`, `sdd-run`) is my own: inspired by the same way of working (tracer bullets, tests-first, spec → implementation) as his `to-spec` / `to-tickets` / `implement` / `wayfinder` skills, but with different artifacts — the `.sdd/project.md` autonomy contract and the verifiability verdict.

`find-skills` is kept exactly as installed from [`vercel-labs/skills`](https://skills.sh/vercel-labs/skills/find-skills); it is not my own skill.

## License

[MIT](./LICENSE) for original and adapted material; `find-skills` retains its upstream source terms.
