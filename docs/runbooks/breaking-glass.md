# Runbook: breaking glass (OS privilege only)

Decision record: [ADR-0028](../adr/0028-remove-restart-guard-and-expiring-switches-os-privilege-only.md).

There is no per-request or expiring waiver, and no `/breaking-glass` command. The hooks this project
installs live in each agent harness's admin layer. Only an administrator changes that layer, with
`sudo`, as with any OS-managed policy. A change stays until the administrator reverts it; nothing
expires. An agent never runs `sudo`: it is in the deny floor (ADR-0016). An agent may print a line
for the owner to run.

The owner's decision (2026-10-05), quoted in ADR-0028: no mechanical lock may require individual,
temporary waiver requests unless the waiver is tied to a privilege level that stays valid for the
whole session; `sudo`/`su` serves that purpose.

## What is in the admin layer

| Path (macOS; Linux in brackets) | Carries |
| --- | --- |
| `/Library/Application Support/ClaudeCode/managed-settings.d/50-personal-multi-harness-workstation-configuration.json` [`/etc/claude-code/managed-settings.d/…`] | Claude Code: the paste prompt hook (`UserPromptSubmit`) and the deny floor (`permissions.deny`). An admin layer installed before Issue #60 also carries the removed HITL picker guard (`PreToolUse`, matcher `AskUserQuestion`); the next `--apply` deletes it |
| `/etc/codex/requirements.toml` | Codex: the paste prompt hook (`[[hooks.UserPromptSubmit]]`) and the deny floor (`[rules] prefix_rules`) |
| `/Library/Application Support/personal-multi-harness-workstation-configuration/bin/` [`/etc/personal-multi-harness-workstation-configuration/bin/`] | the hook scripts those entries run |

Kiro has no admin layer for hooks and runs none of these. Windows installs no hook.

## Turn every hook off

1. In the repository checkout, as yourself: `sh global/install-managed.sh --uninstall`. It prints one
   line, `sudo /bin/sh "<checkout>/global/install-managed.sh" --remove`. Run it in your own terminal.
2. This also removes the **admin copy of the deny floor**, which lives in the same documents. The
   user-level copy stays when `install.sh` installed it; check with `sh global/install.sh --check
   --hooks=managed` (its `FLOOR` lines name the layer that carries it).
3. Do **not** run plain `sh global/install.sh` or `./mhw install` afterwards: with no admin
   layer, both register the hooks again at user level. Keep `sh global/install.sh --hooks=managed`
   for as long as every hook should stay off.
4. Open fresh sessions (ADR-0022).

## Turn one hook off

Edit the admin document with `sudo`, keeping every other entry, the deny floor included:

- Claude Code paste prompt hook: remove the `UserPromptSubmit` entry from the drop-in.
- Claude Code HITL picker guard (removed by Issue #60; only in an admin layer installed before it):
  remove the `PreToolUse` entry whose matcher is `AskUserQuestion`, or run the next `--apply`.
- Codex paste prompt hook: remove the `[[hooks.UserPromptSubmit]]` block and its
  `[[hooks.UserPromptSubmit.hooks]]` table from `requirements.toml`.

Then, as yourself:

- Check the JSON still parses: `/usr/bin/python3 -m json.tool "<drop-in path>"`. A malformed managed
  document can stop the agent harness from loading managed settings.
- `sh global/install-managed.sh --check` now reports `DRIFT` for the edited document. That is the
  visible record that a layer is off.
- Open fresh sessions. The Claude Code drop-in is documented to reload when the file changes; that is
  not measured here, so do not rely on it.

## Turn hooks back on

`./mhw install --admin` renders a fresh stage and prints one line:
`sudo /bin/sh "<checkout>/global/install-managed.sh" --apply="<stage>" --sha256=<hash>`. Run it in your
own terminal, then `./mhw install` as yourself (it detects the admin layer and keeps the hooks
there), then open fresh sessions. Use a merged, released commit: the line runs the checked-out
installer as root. `./mhw status` then shows `managed: installed`.

## Owner install act for the release that removes the restart guard (ADR-0028)

In a fresh session, from the merged, released commit, running steps 1 to 3 in your own terminal.
Until step 1 lands, the old restart guard is still loaded: any agent session open during the
install may deny acting tools once the admin files change. That is expected; end it and use step 4.

1. `sh global/install-managed.sh`, then run the printed `sudo … --apply=… --sha256=…` line yourself.
   It rewrites the admin documents without the restart guard and deletes `restart_guard.py`,
   `breaking_glass.py` and the `breaking-glass/` switch directory from the admin layer.
2. `sh global/install.sh --hooks=managed` as yourself. It deletes the user-level `restart_guard.py`,
   `breaking_glass.py`, `~/.claude/commands/breaking-glass.md` and the guard's `restart-state/`
   baselines, and drops any restart-guard hook entry left in the user settings.
3. `sh global/install-managed.sh --check` and `sh global/install.sh --check --hooks=managed` both
   exit 0.
4. Open fresh Claude Code and Codex sessions. Codex may ask you to trust the paste hook again in
   `/hooks` if it ran from the user level before; whether a rewritten `hooks.json` triggers that is not
   measured.

**Canary (fresh session, disposable workspace):**

- At startup there is no `Restart guard:` message.
- Edit a synthetic configuration file the old guard watched, for example create or change `AGENTS.md`
  in a throwaway git directory. Then make one harmless read (`ls`) and one harmless write (create a
  scratch file). Both pass: no `fingerprint_mismatch` or `missing_baseline` denial.
- `/breaking-glass` is no longer offered.
- The paste prompt hook still blocks a synthetic credential and shows a redacted copy (a harmless
  block canary, never a real secret). **Run this canary outside the paste wrapper** (`command claude`,
  `command codex`): since 2026-10-05 (#58) the hook passes silently in a session the wrapper started,
  so inside one this canary passes by design and proves nothing.

Record only the agent harness, its version and the pass/block outcomes.

## Owner install act for the wrapper-primary release (#58, ADR-0011 2026-10-05 amendment)

The marker logic lives in the core both layers run. Until the admin copy is replaced, the admin hook
keeps blocking wrapped sessions too (the stricter behaviour, measured). In a fresh session, from the
merged, released commit, in your own terminal:

1. `sh global/install-managed.sh`, then run the printed `sudo … --apply=… --sha256=…` line yourself.
2. `sh global/install.sh --hooks=managed` as yourself. Optionally add `--shell-rc="$HOME/.zshrc"` to
   append the wrapper's start-up line, or add the printed line yourself.
3. `sh global/install-managed.sh --check` and `sh global/install.sh --check --hooks=managed` both exit 0.
4. Open fresh Claude Code and Codex sessions, then two canaries with a synthetic credential:
   outside the wrapper (`command claude`) the prompt is **blocked**; inside the wrapper a **pasted**
   credential arrives as `[REDACTED:credential]` and nothing blocks.

## History

- 2026-10-04: total breaking glass through each vendor's native user switch
  ([ADR-0023](../adr/0023-breaking-glass-all-layers-native-switch.md)), ended the same day. Those user
  switches do not reach admin-layer hooks.
- 2026-10-04 to 2026-10-05: per-layer expiring switches and `/breaking-glass`
  ([ADR-0024](../adr/0024-breaking-glass-per-layer-expiring-switches.md)), superseded by ADR-0028.
