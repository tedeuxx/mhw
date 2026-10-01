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

## Amendment 2026-10-01: loading measured in Claude Code and Codex (headless), Kiro stays documented

Issue #3 asked for the evidence level to move from *installed* to *loaded*. Measured on the reference
workstation. `global/install.sh --check` reported all three renderings `OK` at managed version 0.3.0
(marker `sha256: b1dad692…`, brief plus overlay) before the runs. No `~/.codex/AGENTS.override.md`
exists (`ls` returned "No such file or directory"), so nothing shadows the Codex rendering.

**Method.** Each harness ran once in a fresh, empty, throwaway directory under the session scratchpad.
The directory is not inside any repository, and neither it nor any ancestor holds an `AGENTS.md` or
`CLAUDE.md`. The prompt told the model to use no tool and to read no file. It asked for (1) the brief's
H1 title and (2) the bold lead sentence of rule 1, or the literal `NOT_IN_CONTEXT` if no brief was in
context. Only the title suffix `: LLM firewall` and the rule-1 sentence *Third-party property never
enters your work.* discriminate. The prompt itself says "workstation brief", so those two words prove
nothing. Each harness then ran a **calibration**: the same prompt, in the same directory, with the
user-level brief removed from the session's sources. The calibration shows whether the probe can return
`NOT_IN_CONTEXT`.

| Harness | Version | Run | Exact command shape | Result |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.286 | measurement | `claude -p --tools "" --strict-mcp-config --no-session-persistence --output-format json < question.txt` | **PASS**: returned both strings verbatim. `num_turns: 1`, `permission_denials: []`, no built-in tools available (`--tools ""`), no MCP servers (`--strict-mcp-config`). |
| Claude Code | 2.1.286 | calibration | same, plus `--setting-sources project` | `NOT_IN_CONTEXT`. Excluding the `user` setting source also excluded `~/.claude/CLAUDE.md` on this build. That was measured here, not read from documentation. |
| Codex CLI | 0.155.0-alpha.16.4 (bundled with the ChatGPT app), model `gpt-6-astra` | measurement | `codex exec --skip-git-repo-check --ephemeral --json -s read-only --disable shell_tool --disable unified_exec --disable memories -C <dir> - < question.txt` | **PASS**: returned both strings verbatim. The `--json` event stream holds only `agent_message` items, with no command-execution or tool-call item. `--disable memories` rules out recall from Codex's memory store. |
| Codex CLI | same, `-m gpt-6-astra` pinned | calibration | same, under `env CODEX_HOME=<empty dir>` whose only entry was a **symlink** to `~/.codex/auth.json` (no copy) | `NOT_IN_CONTEXT`. After the run the symlink was still a symlink, so no credential was copied. The directory was deleted immediately. |
| Kiro (IDE) | 1.0.437 | none | none | Not run. ADR-0003: no active subscription. It stays at **documented / read from the shipped bundle**, as in the decision table above. |

**Evidence level reached: *loaded* for Claude Code and Codex, in their non-interactive modes only.**
Bounds on that claim:

- **Headless, not interactive.** `claude -p` and `codex exec` were measured. The interactive Claude
  Code session, the Codex TUI, the Codex app and the ChatGPT desktop app were not. Both CLIs load
  user-level instructions in the same session bootstrap in both modes. That is a hypothesis, and it was
  not measured.
- **One run per arm, one machine, one build each.** A harness update can change the result silently.
  Re-run the probe when either CLI updates.
- **"Loaded" is not "obeyed".** The probe shows that the brief's text is in the model's context. It
  says nothing about whether the model follows the brief. The ADR's *instruction* level, and the
  absence of any *enforced* claim, are unchanged.
- **Both calibrations change more than the brief.** An empty `CODEX_HOME` also drops `config.toml`
  (plugins, MCP servers, profile). `--setting-sources project` also drops `~/.claude/settings.json`,
  including its model choice and plugins. The token deltas therefore cannot be attributed to the brief
  alone, and they are not used as evidence: Codex input 19,693 against 13,776, Claude cache-creation
  11,537 against 7,330. The evidence is the `NOT_IN_CONTEXT` answer, set against the verbatim answer.

## Links

- `AGENTS.md`, "Mission" and "Principles", item 1. ADR-0003 (Kiro access mode). ADR-0004. ADR-0005.
  ADR-0006. ADR-0008. ADR-0009. ADR-0013.
