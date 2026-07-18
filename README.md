# Conclave

A **council of AI coding CLIs** — Claude Code, Codex, and Grok — that brainstorm a task together, challenge each other, converge on one agreed plan, split the work, build it, and **verify each other's output**. Each model runs through its **own official CLI using your own subscription login** (Claude Max / ChatGPT / X Premium) — no API keys required.

This is milestone 1 of a larger vision: a single agentic-coding cockpit where you plug in multiple AIs, pick who orchestrates, and a memory layer (**Hermes**) learns how *you* work.

## How it works

```
        ┌── propose ──┐        each council member drafts an
        │  claude     │        independent approach (parallel)
        │  codex      │
        └──────┬──────┘
               │ critique         members adversarially review
               ▼                  every proposal (parallel)
          converge                orchestrator resolves the
               │                  disagreements → ONE agreed plan
               ▼
        build ⇄ verify            builder writes real code;
        (loop ≤ N)                a DIFFERENT model verifies it
               │                  against acceptance criteria,
               ▼                  loops back on FAIL
           report + Hermes
```

**Role → permission mapping** (safety by construction): planners, critics, and the
verifier run **read-only**; only the **builder** can modify files.

| Role | Claude | Codex | Grok |
|---|---|---|---|
| think / critique / verify | `--permission-mode plan` | `--sandbox read-only` | `--permission-mode plan` |
| build | `--permission-mode acceptEdits` | `--sandbox workspace-write` | `--permission-mode acceptEdits` |

## Providers

Two kinds of council members, mixable freely:

| Kind | Members | Cost | How they connect |
|---|---|---|---|
| **CLI agents** (build + verify + run code) | `claude`, `codex`, `grok` | your existing subscriptions | your logged-in CLIs |
| **Free cloud models** (no install, no keys) | `bigpickle`, `nemotron`, `deepseek`, `mimo`, `northmini` | free | OpenCode Zen via `opencode run` |

```bash
conclave "..." --council claude,codex,nemotron,deepseek   # 4 brains, 2 of them free
```

Free cloud members are strongest as extra proposers/critics on the council; keep a
CLI agent as builder and verifier (they're the ones with hardened file/exec tiers).

## Prerequisites

- Node.js ≥ 18
- The CLIs you want to use, installed and **logged in**:
  - `claude` (Claude Code) — `claude` then `/login`
  - `codex` (OpenAI Codex) — `codex login`
  - `grok` (xAI Grok) — `grok login`

Only the providers you actually reference in roles need to be logged in. Each
provider must also have available quota/credits on its plan — e.g. Grok returns
`403 spending-limit` if the account is out of credits. The default council
(`claude` + `codex`) needs only those two.

## Quick start

```bash
cd "conclave"

# 1) Prove the whole loop works offline (no CLIs called, no cost):
node src/index.mjs "Build a CLI todo app in Node" --dry-run

# 2) Run for real (uses your logged-in subscriptions):
node src/index.mjs "Build a CLI todo app in Node with add/list/done and a JSON store"
```

## Configure

Edit [`conclave.config.json`](conclave.config.json) — or override per-run on the CLI:

```bash
node src/index.mjs "Port this Pine strategy to MQL5" \
  --council claude,codex,grok \
  --orchestrator claude \
  --builder codex \
  --verifier grok \
  --max-build 3
```

| Setting | Meaning |
|---|---|
| `providers` | Which CLIs are available (+ optional pinned `model`) |
| `roles.orchestrator` | Who synthesizes the final plan |
| `roles.council` | The brainstorm/critique panel |
| `roles.builder` | Who writes the code |
| `roles.verifier` | Who checks it (use a *different* model than the builder) |
| `loop.maxBuildAttempts` | How many build↔verify rounds before giving up |
| `workspace` | Directory the builder writes into |

## Output

Every run writes to `.conclave/`:

- `runs/<id>/transcript.json` — the full structured blackboard (every proposal, critique, plan, build, verdict)
- `runs/<id>/report.md` — a readable summary
- `hermes/memory.jsonl` + `hermes/profile.json` — what Hermes learned (files touched, decisions, verdicts)

## Modes: M1 (sequential) vs M2 (divide & conquer)

- **M2 (default)** — the orchestrator splits the plan into sub-tasks, assigns each to a
  builder from the pool (round-robin), and builds them **in parallel, each in its own
  git worktree/branch** so they can't clobber each other. Every sub-task is
  **cross-verified by a different model**, then passed branches merge back into the
  workspace (a model resolves any conflict), and a final **integration verify** runs on
  the merged whole.
- **M1 (`--sequential`)** — one builder implements the whole task, one verifier checks
  it, looping on failure. Cheaper for small jobs.

```bash
node src/index.mjs "Build an Express todo API with tests" \
  --builders codex,claude --verifiers claude,codex   # M2 (default)

node src/index.mjs "Fix this one bug" --sequential    # M1
```

## Roadmap

- [x] **M1** — two models debate → converge → build → verify
- [x] **M2** — task decomposition → parallel builders in isolated git worktrees → cross-verify → merge → integration verify
- [x] **H1** — verification hardening: verifiers run in an **exec** tier (can execute code/tests via a safe allowlist, cannot edit files) instead of static-only inspection
- [x] **M3** — Hermes recall: primes the council with your stack/conventions/decisions from past runs
- [x] **M4** — skills library: `--skill pine,mql5-ea,fullstack` injects capability packs into the builders (`src/skills/`)
- [ ] **M5** — client login + web cockpit (multi-tenant)

## Project layout

```
src/
  index.mjs            CLI entrypoint + arg parsing
  config.mjs           config load/merge + provider resolution
  council.mjs          propose→critique→converge, then M1 loop or M2 hand-off
  parallel.mjs         M2: split → parallel worktree builds → cross-verify → merge → integrate
  worktree.mjs         git layer (repo init, worktrees, branch merge, conflict handling)
  prompts.mjs          role prompt templates (propose/critique/converge/build/verify/resolve)
  blackboard.mjs       structured transcript + report renderer
  providers/
    claude.mjs codex.mjs grok.mjs   CLI adapters (uniform ask() interface)
    base.mjs registry.mjs
  hermes/index.mjs     memory/learning layer (v0)
  util/                spawn, json extraction, logging
test/
  worktree.test.mjs    real-git integration test for the worktree layer
```

## Author

Built by [Jayadev Rana](https://jayadevrana.in) — @bluealgocapital · [YouTube](https://www.youtube.com/@jayadevrana3657) · [GitHub](https://github.com/jayadevrana)
