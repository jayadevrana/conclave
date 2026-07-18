# Conclave — Autonomous Build Queue

This file is the source of truth for the `conclave-autobuild` scheduled task.
Each scheduled wake (every 5 hours) does **exactly ONE** unchecked `[ ]` milestone
below, tests it, marks it `[x]`, and stops when all are done.

## Operating rules for each wake (read carefully)
1. Work only in `/Volumes/NO NAME/conclave`. Do the FIRST `[ ]` milestone only.
2. Implement it, then **verify**:
   - Run `node test/*.test.mjs` (all must pass).
   - Run `node src/index.mjs "<a relevant task>" --dry-run` (must exit 0).
   - Do **at most ONE** tiny live run only if a milestone truly needs live proof.
3. Providers: use **claude + codex** only. **Grok is out of credits (403)** — do not use it live.
4. Conserve quota: prefer `--dry-run` and unit tests over live model calls. Never push to a remote or commit unless explicitly asked.
5. When the milestone passes, edit this file: change its `[ ]` to `[x]` and append a one-line result note. Update memory file `conclave-project.md`.
6. Do **not** ask for permission — make the recommended engineering choice and proceed.
7. **STOP CONDITION:** if every milestone below is `[x]`, cancel the scheduled task
   named `conclave-autobuild` (stop the loop) and write
   `.conclave/AUTOBUILD_DONE.md` summarizing everything built. Then stop.

## Already done (do not rebuild)
- [x] **M1** — propose → critique → converge → build → verify (proven live)
- [x] **M2** — decompose → parallel worktree builders → cross-verify → merge → integration verify (git layer unit-tested 11/11)

## Queue
- [x] **H1 — Verification hardening (test-runner tier).** DONE 2026-07-02: added `permTier()` (read/exec/write); verifiers run in the exec tier — claude via a curated safe Bash allowlist (**proven live**: verifier ran `node`, printed 42, edits still blocked), codex via read-only OS sandbox, grok via acceptEdits+disallowed edit tools. Verify prompts now tell verifiers to actually RUN the code.
  Add a read+execute "tester" capability so verifiers actually RUN code/tests instead of only inspecting statically.
  - Add `isTesterRole`/role `tester` handling in `src/providers/base.mjs` and each adapter:
    - claude: `--permission-mode acceptEdits --disallowedTools Edit Write MultiEdit NotebookEdit` (can run Bash, cannot edit files).
    - codex: `--sandbox workspace-write` with a prompt instruction to RUN/test only, not edit.
    - grok: `--permission-mode acceptEdits --disallowed-tools edit,write`.
  - Wire the final integration verify (and M1 verify) to use role `tester` so it can execute `node`/test commands.
  - Acceptance: dry-run passes; a verifier prompt that says "run it" can execute. Add/extend a test or a `--dry-run` proof. Note the tradeoff in README.

- [x] **M3 — Hermes recall.** DONE 2026-07-02: `src/hermes/recall.mjs` builds a primer from profile.json + recent memory.jsonl; injected into propose + converge prompts; council logs "Hermes: primed…". `test/recall.test.mjs` 6/6; verified a 2nd run injects the primer.
  Prime the council with what Hermes learned from past runs.
  - New `src/hermes/recall.mjs`: read `.conclave/hermes/profile.json` + last N `memory.jsonl` records + `conclave-project.md` and produce a compact "What we know about how this user works" primer string (stack, file hotspots, recurring decisions, verdict history).
  - Inject the primer into the propose + converge prompts (add an optional `primer` param in `src/prompts.mjs`; pass it from `src/council.mjs`).
  - Acceptance: transcript.json shows the primer text in the proposer/converge prompts on a run when prior memory exists; dry-run passes. Add a small unit test for `recall.mjs` (feed a fake memory dir, assert primer mentions the hotspots/verdicts).

- [x] **M4 — Skills library.** DONE 2026-07-02: `src/skills/` — registry.json + packs (pine, mql5-ea, fullstack) + loader.mjs (`listSkills`/`loadSkill`/`loadSkills` + GitHub-allowlisted `fetchFromGithub`); `--skill a,b` (and config.skills) inject packs into build + converge prompts; unknown ids warned. `test/skills.test.mjs` 9/9.
  Load reusable capability packs per task.
  - New `src/skills/` with a local registry `registry.json` (start with 2–3 entries, e.g. `pine`, `mql5-ea`, `fullstack`), each a markdown/JSON pack of guidance + conventions.
  - `src/skills/loader.mjs`: `loadSkill(id)` returns the pack text; `listSkills()`; a `fetchFromGithub(url)` helper (curated allowlist; may be a stub that documents the intended source) to pull top agentic skills.
  - CLI: `--skill <id[,id]>` injects the pack(s) into builder + converge prompts.
  - Acceptance: `--skill pine --dry-run` runs and the pine guidance appears in the build prompt in transcript.json; `listSkills()` works. Add a unit test for the loader.
