# ADR-0025: Hook layers in each harness's native admin layer (workstation v2)

- **Status:** proposed
- **Date:** 2026-10-04
- **Amends:** [ADR-0013](0013-hitl-escalation-calibration.md), [ADR-0022](0022-restart-after-active-customization-changes.md),
  [ADR-0011](0011-clipboard-prompt-anonymisation.md) (where their hooks are registered, and two v1 defects)
- **Builds on:** [ADR-0024](0024-breaking-glass-per-layer-expiring-switches.md) (switches);
  **ends, once installed and verified,** the total breaking glass of [ADR-0023](0023-breaking-glass-all-layers-native-switch.md)

## Context and problem

v1 registered the three hook layers (paste filter, HITL guard, restart guard) in user files, which any
process running as the owner can change. A defect then locked the owner out (ADR-0023). Three v1
defects were diagnosed on 2026-10-04 with read-only replays:

1. **HITL guard refused the 2-option session intake.** The exception was gated on the event `cwd`
   resolving to a git repository holding `workspace/session-policy.json`. From the multi-folder
   workspace root, which is not a repository, the intake was refused.
2. **The restart guard locked out read-only tools.** It recomputed the project part of its fingerprint
   from the hook's working directory, which follows a `cd` in Claude Code's persistent shell, and it
   denied every tool, `Read` included, on any mismatch or missing baseline.
3. **Bash command substitution was refused.** This was not v1. It is the substitution rule of the
   owner's plugin permission guard. All hooks off, `$(…)` runs. It is fixed in that plugin, not here.

Defects 1 and 2 share one cause: **workspace identity derived from the current working directory.**

## Decision drivers

- No lockout: a stale or defective state must still allow diagnosis.
- Admin-only floor where the vendor offers one (owner requirement, ADR-0024).
- Native mechanisms first; state every gap.
- Nothing new persisted: no path, no content (ADR-0008).

## Considered options

1. **Keep user-level registration and fix the defects.** Cheapest. Rejected as the end state, because
   any agent running as the owner can remove a user-level hook. It is the first rollout stage below.
2. **Admin layer registers the hooks; the scripts live in a root-owned directory (chosen).**
   - Claude Code: a `managed-settings.d/` drop-in. Documented: drop-ins merge alphabetically, hook
     lists combine across sources, and file-based managed settings are "read at startup and reloaded
     when a file changes".
   - Codex: `/etc/codex/requirements.toml` `[hooks]`, documented as "trusted by policy, and can't be
     disabled", with no `/hooks` trust step.
   - Trade-off: installing or changing it needs sudo, and a defective admin hook cannot be removed
     from the user layer. That is why read-only tools are never denied and the switches exist.
3. **`allowManagedHooksOnly` / `allow_managed_hooks_only`.** Rejected: it would also silence the
   owner's plugin and project hooks, which are his way of working (ADR-0014).

## Decision outcome

Option 2, with the defect fixes:

- **HITL (defect 1):** a configured `intake_exception=Session type|Melhoria de harness|Bugfix` in
  `global/hitl.conf` holds in any directory. It is exact on header, labels and order, and
  single-select. The `session-policy.json` route stays.
- **Restart guard (defect 2):**
  - The project anchor is Claude Code's session-stable `CLAUDE_PROJECT_DIR`. Codex keeps its hook
    working directory, because its shell commands are separate processes.
  - On any non-match, `Read`, `Grep`, `Glob`, `LS`, `NotebookRead`, `TodoWrite` and
    `AskUserQuestion` pass with a notice.
  - So does one simple read-only shell command. It must have no shell metacharacters, start with
    `cat`, `ls`, `head`, `tail`, `wc`, `grep`, `rg`, `pwd`, `stat` or `find`, or be
    `git status|diff|log|show|rev-parse`, and carry no executing or writing flag.
  - This allowlist is the owner's choice for Codex (2026-10-04), and it applies to Claude Code's Bash
    too.
  - The baseline is still one aggregate hash.
- **Switches:** every layer reads its ADR-0024 switch on every call. The restart guard's SessionStart
  message announces every switched-off layer.
- **Installer:** `global/install-managed.sh` renders the hook files through `install.sh` into a
  throwaway home, validates both admin documents, and prints one sudo line. That line carries the
  stage's SHA-256, and `--apply` copies the stage before verifying the copy. Then
  `install.sh --hooks=managed` removes the user-level duplicates. ~~Brief and deny floor stay at user
  level.~~ The brief stays at user level. The deny floor is also rendered into the same admin
  documents since ADR-0016's 2026-10-05 amendment (proposed); its user copy stays until that copy is
  installed and verified.
- **Kiro:** no admin layer for hooks is documented, so it has no v2 hook. It keeps the brief and the
  paste wrapper.
- **Windows:** not supported.

### Rollout (each stage a fresh session; ADR-0022)

1. `install.sh` (user level, v2 hooks), end the total breaking glass (runbook), fresh session, canary.
2. The sudo line from `install-managed.sh`, then `install.sh --hooks=managed`, fresh session, canary.

## Consequences

- Good: the three defects have regression tests, each safety assertion is mutation-checked, and the
  floor is admin-only on Claude Code and Codex.
- Good: the paste filter, HITL guard and restart guard keep running beside the owner's plugin hooks.
- Bad, open:
  - Codex. Without a `[features] hooks = true` pin, a user-level `hooks = false` may still silence the
    managed hooks. This is unmeasured, and pinning would also force the plugin's hooks on. It is a
    decision for the owner after the canary.
  - The restart-guard state, the paste-filter term list and the salt live in user-writable
    directories, so an agent could tamper with them. Accepted: these are hygiene controls, not
    anti-tamper ones.
  - The sudo line runs the repository's `install-managed.sh`. Installation trusts the checked-out
    commit, which should be a merged, released one.
- Evidence level: *written and tested* in throwaway roots and homes (`global/install-managed.test.sh`,
  CI on ubuntu and macOS). Not installed. Hot reload of the Claude drop-in and Codex managed-hook
  routing are *documented* only, not *measured* here.

## Links

- Claude Code managed settings: code.claude.com/docs/en/managed-settings
- Codex managed configuration and hooks: learn.chatgpt.com/docs/enterprise/managed-configuration, learn.chatgpt.com/docs/hooks
- Kiro hooks and governance: kiro.dev/docs/hooks, kiro.dev/docs/enterprise/governance
