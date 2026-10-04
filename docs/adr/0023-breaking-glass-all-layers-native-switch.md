# ADR-0023: Total breaking glass: every hook layer off through each harness's native switch

- **Status:** proposed (total breaking glass in force on the reference workstation since 2026-10-04)
- **Date:** 2026-10-04
- **Amends:** [ADR-0013](0013-hitl-escalation-calibration.md), [ADR-0011](0011-clipboard-prompt-anonymisation.md),
  [ADR-0022](0022-restart-after-active-customization-changes.md) (their hook controls are suspended, not withdrawn)
- **Runbook:** [`docs/runbooks/breaking-glass.md`](../runbooks/breaking-glass.md)

## Context and problem

On 2026-10-04 the ADR-0022 restart guard denied every covered tool call in a live Claude Code
session, read-only tools included, after the session's working directory changed mid-session. The
session could not read, diagnose or repair anything; the guard's own runbook forbids repairing state
from the blocked session. Two other v1 hook defects add friction to normal work: the ADR-0013 picker
guard demands three options even for the owner-mandated two-option `Session type` intake, and a Bash
guard refuses command substitution.

A preventive control that locks out its owner's diagnosis path has failed in the direction he cannot
see past. The owner had to regain control of the workstation without losing the controls that do not
depend on hooks.

## Decision drivers

- Regain a working session immediately, on all three harnesses, with a single reversible step each.
- Use each vendor's **native, documented** switch, not file deletion or ad hoc edits of managed files.
- Back up every file before changing it.
- Keep every control that is not a hook: the global brief and the permission deny floor.
- Report the gap honestly: a disabled hook enforces nothing.

## Considered options

1. **Global native hook switch per harness (chosen).** Claude Code `disableAllHooks: true` in
   `~/.claude/settings.json`; Codex `[features] hooks = false` in `~/.codex/config.toml`
   (documented: hooks are on by default and `hooks` is the feature key). One line each, reverted by
   restoring the backup or deleting the line. Trade-off: it is all-or-nothing, so plugin hooks (for
   example the owner's plugin permission guard) are off too, and the paste filter is off with the
   faulty guards.
2. **Remove only the faulty hook entries.** Keeps the paste filter and plugin hooks running. Rejected
   for a total breaking glass: it edits installer-managed files by hand (drift from source), and in Codex a
   changed hook definition needs re-trust through `/hooks`, an owner act. It is the right shape for
   the permanent fix, which ADR-0024 will design as per-layer switches.
3. **Uninstall v1.** Rejected: it would also remove the brief and the deny floor, which work.

## Decision outcome

Option 1. Applied state on the reference workstation, 2026-10-04:

| Harness | Switch | Backup | v1 hooks it suspends |
| --- | --- | --- | --- |
| Claude Code | `disableAllHooks: true` (user settings) | `~/.claude/settings.json.bak-v1` | restart guard, HITL picker guard, paste filter, plus every plugin hook |
| Codex | `[features] hooks = false` (user `config.toml`) | `~/.codex/config.toml.bak-v1` | restart guard, paste filter, plus every non-managed hook |
| Kiro | none applied | none needed | none: v1 installs no Kiro hook. Kiro documents hooks only under a project's `.kiro/hooks/`, and none exists |

**Still active**, because none of it is a hook:

- the global brief (Claude Code, Codex, Kiro steering): *installed*, an instruction only;
- the permission deny floor: Claude Code `permissions.deny` and Codex
  `~/.codex/rules/workstation-deny-floor.rules` (ADR-0016), enforced by the harness's permission
  layer, not by hooks;
- the paste wrapper shell functions (ADR-0011), when the CLI is started through them.

**Suspended:** the restart guard (ADR-0022), the HITL picker guard (ADR-0013), the paste filter prompt
hook (ADR-0011), and any plugin hook, including the plugin's permission guard.

## Consequences

- Good: every harness works again; the change is one line per file and is fully reversible.
- Good: the deny floor and brief keep their real evidence level, unaffected.
- Bad: pasted employer or client references are no longer blocked at the prompt hook; only the
  wrapper (when used) and the brief's instruction remain. This is a real coverage loss.
- Bad: there is no expiry. The mode lasts until someone reverts it. ADR-0024 must replace it with
  per-layer, expiring switches.
- Evidence level: Claude Code switch *loaded* (this session runs with hooks off). Codex switch
  *written* and parsed; not yet observed in a fresh Codex session.

## Links

- Runbook: [`docs/runbooks/breaking-glass.md`](../runbooks/breaking-glass.md)
- Codex hooks documentation (feature key `hooks`, deprecated alias `codex_hooks`)
- Kiro hooks documentation (project `.kiro/hooks/`, per-hook `enabled`)
