# Restart handoff

State on 2026-10-04, after the v2 canary (bugfix session):

- **Total breaking glass is over** (ADR-0023): `disableAllHooks` is gone from the Claude Code settings
  and `hooks = false` from the Codex config.
- **v2 admin layer is installed** (ADR-0024, ADR-0025): Claude Code managed settings and Codex
  requirements register the paste filter, restart guard and (Claude Code only) HITL guard.
  `/breaking-glass status` shows all three layers on.
- **Claude Code canary, fresh session — passed:**
  - `Restart guard: baseline_created.` shown at startup (seen by the owner; baseline file present);
  - a `Read` after a `cd` was not refused;
  - `/breaking-glass status` answered;
  - the HITL guard script accepted a synthetic intake picker and refused a two-option non-intake
    picker. A live intake picker was not shown, because the session type was declared in the prompt;
  - a prompt carrying a public example credential was blocked by the paste filter, with a redacted copy.
- **Codex canary: pending**, in a fresh Codex session. Its managed hooks need no `/hooks` trust.
- Bash command substitution is refused by the owner's plugin permission guard, not by this
  repository; the fix belongs to that plugin.

Never self-grant Codex hook trust or run sudo from an agent.

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
