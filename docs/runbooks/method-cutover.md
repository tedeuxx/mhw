# Runbook: the method cutover (#130)

The working method moves from the `tadeumendonca-skills` plugin to this repository's user layer
([ADR-0032](../adr/0032-this-repository-is-the-single-source-of-the-working-method.md), 2026-10-13
amendment). `mhw install --method` installs the method and, in the same step, retires the plugin at user
scope. It is the owner's act, in a fresh session.

**Evidence level:** written and tested in throwaway homes (`global/method/plugin_retire_test.py`, the
installer test in `global/method/method_render_test.py`, and `global/install.test.ps1` on Windows). Not
run on the reference machine.

## Before

- The release candidate carrying the method's rites and scripts (#170) and this step (#130) is on `main`,
  and installed with `mhw update` or a checkout.
- Configuration changes need a fresh session (ADR-0022): close the agent sessions first.

## The owner's steps

1. **Install, in a fresh terminal:**

   ```sh
   mhw install --method
   ```

   Expect `METHOD  installed: …` and `CHANGED …: enabledPlugins.tadeumendonca-skills@tadeumendonca true ->
   absent` (and the Codex tables), each with its `.pmhwc-plugin-backup`. A `NOTE … project-scope install(s)`
   line names the repositories that still enable the plugin themselves; each changes its own settings in
   its own pull request (tadeumendonca-io: its follow-up to #724).
2. **Verify, in a fresh Claude Code, Codex and Kiro session:**
   - the agents are listed once, under their bare names (Claude Code `/agents`), not twice;
   - `mhw status` shows the method line with **no DUPLICATE**.

   **That holds at user scope only.** A project that still installs or enables the plugin keeps it in
   its own sessions, so the method appears twice there. The install does not touch those projects. To
   find them:
   - `mhw check` prints a `NOTE … N project-scope install(s)` line (the first five paths) from
     `~/.claude/plugins/installed_plugins.json`. The full list:
     `jq -r '.plugins["tadeumendonca-skills@tadeumendonca"][]? | select(.scope=="project") | .projectPath' ~/.claude/plugins/installed_plugins.json`
   - `mhw status --project=<repository>` shows DUPLICATE for a repository whose own `.claude/settings.json`
     enables the plugin. It does not read the install records.

   Records whose `projectPath` is a session scratchpad or a removed worktree (under the temporary
   directory, or a `.claude/worktrees/…` path that no longer exists) point at no project, so they are
   safe to remove. Use `claude plugin uninstall tadeumendonca-skills@tadeumendonca --scope project` run in
   that directory while it exists, or delete the record from the file. A real repository (for example
   tadeumendonca-io, or the tadeumendonca-skills checkout) changes its own settings in its own pull request.
3. **Canary:** in a Claude Code session, type `/autonomy` with no argument: it prints its help and does
   nothing. Confirm it is the method's copy: `head -3 ~/.claude/commands/autonomy.md` carries the
   `managed-by: personal-multi-harness-workstation-configuration; source: method/commands/autonomy.md` line.

## Undo

`mhw uninstall` puts back what the install removed, from the backups (macOS and Linux). On Windows,
restore each `<file>.pmhwc-plugin-backup` by hand. The install leaves the plugin's cache directories on
disk; that the restored plugin loads from them without a download is not measured.
