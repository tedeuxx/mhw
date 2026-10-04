# Restart handoff

State on 2026-10-04 (bugfix session, branch `fix/restart-guard-diagnostics`):

- **Emergency mode is on** (ADR-0023): every hook is off in Claude Code (`disableAllHooks`) and Codex
  (`[features] hooks = false`), with `.bak-v1` backups. The brief and the deny floor stay on.
- **v2 is written and tested, not installed**:
  - the HITL intake exception now works in any directory, and the restart guard no longer locks out
    reads or follows a `cd` (ADR-0025);
  - per-layer expiring switches and `/breaking-glass` (ADR-0024);
  - the admin-layer installer `global/install-managed.sh` (ADR-0025).
- Bash command substitution is refused by the owner's plugin permission guard, not by this
  repository; the fix belongs to that plugin.

Next, in fresh sessions only: follow [the runbook](runbooks/emergency-mode.md), section "Leave
emergency mode". Install from a merged, released commit. Observe each guard natively before claiming
it loaded. Never self-grant Codex hook trust or run sudo from an agent.

Open after the canary:
- the Codex `[features] hooks = true` pin (ADR-0025, "Bad, open");
- the native cwd and `additionalContext` behaviour of the project `.codex/hooks.json` intake hook.

Keep this handoff free of secrets, configuration values and transcripts.
