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
  (ADR-0006). ~~Kiro CLI's user-level brief location is not determined either.~~ Determined from the
  vendor docs: see the 2026-10-01 amendment on Windows, Linux and Kiro CLI below.
- Good: `install.sh --check` detects drift. The test suite (`global/install.test.sh`) covers dry-run,
  fresh install, idempotence, drift and refusing an unmanaged file. It was run against throwaway HOME
  directories, never the real one. Mutating the managed-file check made three assertions fail, which
  shows the refusal tests can fail.
- Bad: ~~**`install.ps1` is untested.** No PowerShell runtime was available, and it has never run on
  Windows.~~ It now runs on a Windows CI runner; see the amendment on Windows, Linux and Kiro CLI
  below for what that covers and what it does not.
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

## Amendment 2026-10-01: Windows runs in CI, Linux runs under dash, Kiro CLI shares the Kiro target

Issue #9 (Principle 1: the policies must be replicable on Windows and Linux; Kiro CLI is a target
surface under ADR-0006).

### Windows: `install.ps1` runs on a real Windows host

`.github/workflows/tests.yml` has a `windows` job on `windows-latest`. It runs
`global/install.test.ps1` twice, once under **Windows PowerShell 5.1** (`powershell`, what a stock
Windows ships) and once under **PowerShell 7** (`pwsh`). The test runs the installer with the same
executable that runs the test, so each leg tests the installer on that PowerShell. Every run writes only
under throwaway `USERPROFILE` directories in `RUNNER_TEMP`. The runner's git checks out with
`core.autocrlf=true`, so the source tree carries CRLF. The job prints both facts.

The suite mirrors `install.test.sh` for every feature `install.ps1` carries: dry-run writes nothing and
prints targets and the merge; fresh install; `-Check` after install; the deny floor in both harnesses'
formats; an idempotent re-run leaves every file byte-identical; drift is detected and repaired; a
removed floor rule is counted and restored; a missing Codex rules file is detected; an unmanaged brief
is refused (exit 3) and left untouched; a union merge into an existing settings file keeps every key,
hook and rule, keeps a backup byte for byte, and a re-merge is byte-identical; invalid JSON and a
non-array `permissions.deny` are refused and left untouched; `-Overlay none`; an overlay floor entry
reaches both harnesses; five invalid entries each stop the run with exit 2 and nothing written; usage
errors exit 2.

It also checks something `install.test.sh` cannot: that the Windows rendering of the brief is
**byte-identical to the POSIX one**. The rendered file has no CR byte and no BOM, and its marker's
`sha256` equals the sha256 of the LF form of `global/AGENTS.md` + `overlay/AGENTS.md`, which is what
`install.sh` hashes.

**Fixed in `install.ps1` to get there.** These were found by reading the script against the
PowerShell semantics while writing the suite. The CI run is what shows the fixed script works. It does
not show which of these would have failed on its own, because the unfixed script was never run:

- A usage error called `Write-Error` under `$ErrorActionPreference = 'Stop'`. That throws, so the
  process exits 1, not the 2 the header promises. Usage errors now write to stderr and `exit 2`.
- `Get-Rendered` returned a `byte[]` from a function, which PowerShell unrolls into the pipeline as
  separate objects. It now returns the array whole, and `Invoke-Target` types it as `byte[]`.
- The installed-versus-rendered comparison called Linq's generic `SequenceEqual`, which depends on
  PowerShell inferring the generic type. It now compares the two byte arrays as Base64 strings.
- The source was hashed and copied as checked out. Under `core.autocrlf=true` that is CRLF, so the
  rendered brief would carry CRLF and a different `sha256` from the POSIX rendering of the same
  commit. The brief sources are now read with CRLF turned into LF.

**The first Windows run was a green that proved less than it said.** Both legs printed
`59 passed, 0 failed` and exited 0, while seven assertions had thrown before reaching a verdict: a
helper returned an empty array from a function, PowerShell turned it into `$null`, and `.Count` on it
is an error under `Set-StrictMode`. Those seven were "dry-run wrote no file", the five invalid-entry
cases, and "usage errors wrote nothing". The helper now returns a number, and a script-level `trap`
counts any error raised inside the test as a failure.

**Calibrated by breaking the subject.** Commit `ee1481f` mutated `install.ps1` on purpose (usage
errors exit 1; CRLF not normalized; an invalid floor entry exits 0; no settings backup) and added one
deliberate error inside the test, to show the `trap` counts it. Commit `86711c7` reverts it, and its
tree is identical to `774f047`. On the mutated head both legs went red: Windows PowerShell 5.1
`55 passed, 12 failed`, PowerShell 7 `53 passed, 14 failed`. Every mutation was caught: the deliberate
test error, by the `trap`; the CRLF mutation, by three brief assertions; the missing backup, by the
`trap` (hashing a file that is not there throws); the invalid floor entry exiting 0, by all five
invalid-entry cases; and the usage exit code, by both usage cases.

**What the now-reachable checks found on unmutated code.** At `86711c7`, Windows PowerShell 5.1 passed
(`66 passed, 0 failed`) and PowerShell 7 failed the seven formerly-silent checks: a file appears in
the throwaway profile even when the installer writes nothing. The test now names every file it counts.
The file is `AppData\Local\Microsoft\PowerShell\StartupProfileData-NonInteractive`, written by
PowerShell 7 itself when it starts under that profile. ~~so the count leaves `AppData\` out~~ The count
leaves out only `AppData\Local\Microsoft\PowerShell\` (narrowed after review from all of `AppData\`)
and still prints what it skipped. At `11e5f31` both legs passed with `66 passed, 0 failed`. The
installer has no target under `AppData\` (read from the script), so the exclusion hides nothing of ours.

**The brief no longer tells a Windows agent it has a hook.** `global/AGENTS.md` said *"On Claude Code a
user-level hook refuses a picker … Everywhere else these rules are instructions only"*. That brief is
rendered byte-identically on Windows, where `install.ps1` installs no hook, so a Windows agent was
told a control existed that did not. It now reads *"On Claude Code on macOS and Linux a user-level hook
refuses … Everywhere else, Windows included, these rules are instructions only"*. No other sentence in
the brief claims a control: it does not mention the deny floor (rendered on Windows too) or the
clipboard guard (not rendered on Windows). The brief grows by 38 bytes, to 4,891 (`wc -c`).

### Parity: what `install.ps1` covers against `install.sh`

| Feature | `install.sh` (macOS, Linux) | `install.ps1` (Windows) |
| --- | --- | --- |
| Brief to Claude Code, `~/.claude/CLAUDE.md` | yes | **yes**, CI-tested on Windows |
| Brief to Codex, `$CODEX_HOME/AGENTS.md` | yes | **yes**, CI-tested |
| Brief to Kiro (IDE and CLI), `~/.kiro/steering/workstation-global-brief.md` | yes | **yes**, CI-tested (under `%USERPROFILE%`) |
| Owner overlay appended; `--overlay=none` / `-Overlay none` | yes | **yes**, CI-tested |
| `--dry-run` / `--check`, refuse an unmanaged file (exit 3), idempotent re-run | yes | **yes**, CI-tested |
| Deny floor merged into `~/.claude/settings.json` (union, backup, refuse a bad shape) | yes, with `jq` | **yes**, with `ConvertFrom-Json`/`ConvertTo-Json`; CI-tested. The dry-run lists the rules it would add; it does not print a full semantic diff as `install.sh` does |
| Deny floor rendered to Codex, `rules/workstation-deny-floor.rules` | yes | **yes**, CI-tested. Not parsed by `codex execpolicy` on Windows: `codex` is not on the runner |
| HITL escalation guard: hook script, `hitl.conf`, and its `PreToolUse` entry in settings (ADR-0013) | yes | **no**. Not ported. On Windows the escalation rules are instructions only |
| Clipboard guard script and settings (ADR-0011) | installed on macOS and Linux; the watcher runs only on macOS (LaunchAgent written, ~~never loaded~~ never loaded *by the installer*; on the reference machine it was loaded separately on the owner's go, 2026-10-01, see ADR-0011's second 2026-10-01 amendment); Linux prints `SKIP` | **no**. ADR-0011 has design notes for Windows only |
| MCP definition (ADR-0017) | **not in this installer**: rendered by `global/mcp/mcp_render.py` | **not in this installer either**. `mcp_render.py` has a Windows path for the Claude desktop config and refuses secrets on Windows (no launcher); its suite does not run on the Windows job |
| `XDG_DATA_HOME` honoured | yes, tested since this amendment | not applicable: nothing is installed under a data directory |

### Linux: what the ubuntu suite actually exercises

The `suites` job already ran `install.test.sh` on `ubuntu-latest`. Its invocations are `sh install.sh`,
and on that image `/bin/sh` is **dash**. A new first step prints `ls -l /bin/sh` and fails the Linux
leg unless `readlink -f /bin/sh` is `dash`. So a green ubuntu run is a run under dash, and that stays
true only while the step stays green. Measured on this PR's runs: `/bin/sh -> dash`
(`/usr/bin/dash`), then under it the hook suite (`23 passed, 0 failed`) and the installer suite
(`86 passed, 0 failed`, the four new `XDG_DATA_HOME` assertions included; Codex parsing `SKIP`). The runner announces that `ubuntu-latest` moves
to Ubuntu 26 from 2026-10-19; this step is what will say whether dash is still `/bin/sh` there. On macOS the same step only prints, and `/bin/sh` there is bash
in POSIX mode. The Linux leg exercises the brief, the hook (installed with its `#!/bin/sh` shebang and
run through `sh`), the deny floor, the clipboard script with no watcher, and that no plist is written off
macOS. `codex` is not on the runner, so the Codex rules file is checked by text, not by `codex
execpolicy`.

**A gap closed here:** `XDG_DATA_HOME` is the Linux convention, and `install.sh` honours it, but no
test set it. Test 12 now does: the hook and its config land under it, nothing lands under
`~/.local/share`, the settings entry runs the hook from there, and `--check` is clean. Calibrated: in a
scratch copy where `install.sh` ignores `XDG_DATA_HOME`, two of the four assertions fail.

**Not covered on Linux:** the hook installed as a `PreToolUse` entry is not run by a real Claude Code
on Linux. That is the same gap as on macOS CI.

### Kiro CLI: the same global steering directory as Kiro IDE

**Documented.** Kiro's steering page, <https://kiro.dev/docs/steering/> (the old CLI-specific
<https://kiro.dev/docs/cli/steering/> now redirects there; fetched 2026-10-01), has a capability table
with IDE, CLI, Web and Mobile columns. Its row *"Global steering (`~/.kiro/steering/`)"* is marked
supported for IDE and CLI. The page says *"Global steering files reside in your home directory under
`~/.kiro/steering/`, and apply to all workspaces"*, and its CLI instructions say to create a `.md` file
*"in `.kiro/steering/` (workspace scope) or `~/.kiro/steering/` (global scope)"*.

**So no new target is needed.** The installers already render
`~/.kiro/steering/workstation-global-brief.md` for Kiro IDE, and Kiro CLI reads the same directory.
The existing tests (`install.test.sh` and `install.test.ps1`, "written" and "kiro front matter") cover
that file. The decision table above now holds for both Kiro surfaces.

Three caveats, all from the same page:

- **Inclusion modes.** The table marks inclusion modes supported on the CLI, but a note on the same
  page says *"On Kiro CLI, inclusion modes are not currently supported. All steering files in the
  `.kiro/steering/` directory are loaded automatically."* The page contradicts itself. Either reading
  loads this file, because its mode is `always`. Whether the CLI shows the front matter to the model as
  text is not known.
- **Custom agents.** *"When using custom agents, steering files are not automatically included. You
  must explicitly add them to the agent's `resources` configuration to load steering context."* A Kiro
  CLI session that runs a custom agent without such a `resources` entry does not load this brief. This
  repository renders no Kiro agent configuration, so that gap is stated, not closed.
- **Windows.** The page writes the path as `~/.kiro/steering/`. That Kiro resolves `~` to
  `%USERPROFILE%` on Windows, which is where `install.ps1` writes, is **assumed**.

**Evidence level: documented.** Kiro CLI is not installed on the reference workstation, and Kiro has no
active subscription (ADR-0003), so nothing was loaded or measured.

## Links

- `AGENTS.md`, "Mission" and "Principles", item 1. ADR-0003 (Kiro access mode). ADR-0004. ADR-0005.
  ADR-0006. ADR-0008. ADR-0009. ADR-0013.
