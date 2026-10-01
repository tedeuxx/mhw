# 0010 — One global brief, rendered from a single source to each harness's user-level location

- **Status:** accepted
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner: *"voce tem esse outro principio que deve estar enforcado na ocnfiguracao global de todos
harness mantidos por esse projeto na minha workstations."* ("you have this other principle that must be
enforced in the global configuration of every harness this project maintains on my workstation.") The
mission (`AGENTS.md`, "Mission") must be carried in the **user-level (global)** configuration of every
harness. It must not depend on a project-level brief.

When this record was written, the reference install had no user-level brief for any harness: no Claude
Code user brief, no Codex user brief, and an empty Kiro global steering directory (observed by the
orchestrating session).

## Decision drivers

- One policy, so editing it in one place updates every harness (`AGENTS.md`, protection 3).
- Never silently overwrite something the owner wrote by hand.
- Drift between the source and what is installed is a defect, and it must be detectable.

## Considered options

1. **One source, `global/AGENTS.md`, rendered by an installer to each harness's user-level brief.** Each
   rendering carries a managed marker (source, version, content sha256). Trade-off: an installer must be
   maintained per OS.
2. **A hand-maintained copy per harness.** No tooling, but the copies drift, and nothing detects it.
3. **Symlinks to the repo file.** No copies, but the installed brief would change on any branch
   checkout. There is also no place for Kiro's front matter, and symlink behaviour differs on Windows.

## Decision outcome

**Chosen: option 1.**

| Harness | Rendered to | Location: evidence level |
| --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | *documented*: the user-memory location. `CLAUDE_CONFIG_DIR` is not honoured by the installer. |
| Codex | `$CODEX_HOME/AGENTS.md`, default `~/.codex/AGENTS.md` | *documented*: the global AGENTS.md location, per the brief. Not re-verified against docs in this slice. |
| Kiro (IDE) | `~/.kiro/steering/workstation-global-brief.md`, front matter `inclusion: always` | *read from the shipped bundle*, Kiro 1.0.437 (`kiro.kiro-agent/dist/extension.js`): the steering front-matter schema accepts `inclusion` ∈ {`always`, `fileMatch`, `manual`, `auto`}, and the global steering directory is `join(home, ".kiro", "steering")` (constants `Tm=".kiro"` and `$O="steering"`). Not exercised in a live session (ADR-0003: no active subscription). |

Installers: `global/install.sh` (macOS and Linux, POSIX sh) and `global/install.ps1` (Windows, under
`%USERPROFILE%`). Both support `--dry-run`/`-DryRun` and `--check`/`-Check`, refuse an existing
unmanaged file (exit 3), and are idempotent. The orchestrator runs the real install separately, with
the owner's go.

## Consequences

- **The evidence level is INSTRUCTION.** A global brief is text loaded into the model's context. It
  states what agents must do; it does **not** mechanically stop anything. Mechanical enforcement, such as
  hooks that block, is a later control. Until that exists, nothing claims this brief "enforces"
  anything. The owner's word *enforcado* is satisfied only at instruction level.
- **Not covered by this rendering (dichotomy of control, ADR-0004):** the Claude desktop app and Cowork,
  and the ChatGPT desktop app. Their custom instructions are hypothesised to live in the account,
  cloud-side, with no local user-level file to render to. This is to be measured per surface
  (ADR-0006). Kiro CLI's user-level brief location is not determined either.
- Good: `install.sh --check` detects drift. The test suite (`global/install.test.sh`) covers dry-run,
  fresh install, idempotence, drift and refusing an unmanaged file. It was run against throwaway HOME
  directories, never the real one. Mutating the managed-file check made three assertions fail, which
  shows the refusal tests can fail.
- Bad: **`install.ps1` is untested.** No PowerShell runtime was available, and it has never run on
  Windows.
- Bad: a local edit to a managed file is overwritten on the next install. `--check` reports it as drift
  first.
- Bad: the brief costs context in every session. It is under 4 KB (`wc -c global/AGENTS.md`), far under Kiro's 50,000-character
  steering limit (`hOi=5e4` in the same bundle).

## Amendment 2026-10-01: the overlay is appended, and the installer also installs the HITL guard

Under ADR-0013, the rendered brief is now `global/AGENTS.md` **followed by** the owner overlay's
`overlay/AGENTS.md`. The marker's `sha256` covers both, and the marker names its source as
`global/AGENTS.md + overlay`. `--overlay=none` (`-Overlay none` on Windows) renders the generic brief
alone. The brief with the overlay is about 5 KB: ~~It is under 4 KB~~ no longer holds.

`install.sh` also installs the HITL escalation guard and its config as managed files, and merges one
hook entry into `~/.claude/settings.json` (ADR-0013). `install.ps1` renders the overlay but does not
install the guard.

## Links

- `AGENTS.md`, "Mission" and "Principles", item 1. ADR-0003 (Kiro access mode). ADR-0004. ADR-0005.
  ADR-0006. ADR-0008. ADR-0009. ADR-0013.
