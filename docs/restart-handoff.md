# Restart handoff

State on 2026-10-04 (bugfix session, branch `fix/restart-guard-diagnostics`):

- **Total breaking glass is on** (ADR-0023): every hook is off in Claude Code (`disableAllHooks`) and Codex
  (`[features] hooks = false`), with `.bak-v1` backups. The brief and the deny floor stay on.
- **v2 is written and tested, not installed**:
  - the HITL intake exception now works in any directory, and the restart guard no longer locks out
    reads or follows a `cd` (ADR-0025);
  - per-layer expiring switches and `/breaking-glass` (ADR-0024);
  - the admin-layer installer `global/install-managed.sh` (ADR-0025).
- Bash command substitution is refused by the owner's plugin permission guard, not by this
  repository; the fix belongs to that plugin.

Next, in fresh sessions only: follow [the runbook](runbooks/breaking-glass.md), section "End the total
breaking glass". Install from a merged, released commit. Observe each guard natively before claiming
it loaded. Never self-grant Codex hook trust or run sudo from an agent.

Open after the canary:
- the Codex `[features] hooks = true` pin (ADR-0025, "Bad, open");
- the native cwd and `additionalContext` behaviour of the project `.codex/hooks.json` intake hook.

Next improvement session (owner agreed 2026-10-04), across this repository and the plugin repository:
1. An ADR with the rubric for the four distribution layers: managed (a protection nothing may weaken),
   user (any project, not a floor), workspace (one repository's contract), plugin (the way of working).
2. A manifest in each repository declaring every distributed artifact's layer, and a CI check in both
   that fails on an undeclared artifact, one in the wrong repository, or one declared twice.
3. An inventory of the plugin's commands, hooks and skills against the rubric, ratified by the owner.
4. Dehydration, one artifact at a time, in paired PRs: this repository installs it first, the plugin
   removes it second, so protection never has a gap. Likely first: the plugin permission guard's floor
   rules, which also fixes the command-substitution refusal.

Keep this handoff free of secrets, configuration values and transcripts.
