# Runbook: emergency mode (v1 hooks disabled)

Decision record: [ADR-0023](../adr/0023-emergency-mode-v1-hooks-disabled.md).

## Check the current state

```sh
python3 -c "import json,os;print('claude disableAllHooks =',json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('disableAllHooks'))"
python3 -c "import tomllib,os;print('codex features.hooks =',tomllib.load(open(os.path.expanduser('~/.codex/config.toml'),'rb')).get('features',{}).get('hooks'))"
```

Emergency mode is on when Claude prints `True` and Codex prints `False`.

## Enter emergency mode (what was done on 2026-10-04)

1. Claude Code: `cp -p ~/.claude/settings.json ~/.claude/settings.json.bak-v1`, then set
   `"disableAllHooks": true` at the top level of `~/.claude/settings.json`.
2. Codex: `cp -p ~/.codex/config.toml ~/.codex/config.toml.bak-v1`, then add `hooks = false` under
   the existing `[features]` table of `~/.codex/config.toml`.
3. Kiro: nothing. v1 installs no Kiro hook.
4. Start a fresh session in each harness. Neither switch is claimed to reload mid-session.

## Leave emergency mode (the v2 rollout, ADR-0025)

Only from a merged, released commit. Each stage ends in fresh sessions; an agent never runs sudo and
never grants hook trust.

1. **User level, v2 hooks.** `sh global/install.sh`; then remove `disableAllHooks` from
   `~/.claude/settings.json` and the `hooks = false` line under `[features]` in `~/.codex/config.toml`
   (restoring the `.bak-v1` files also works, but discards later edits; compare first). Open fresh
   sessions. Codex: the owner reviews and trusts the changed hooks in `/hooks`.
2. **Canary.** Observe `Restart guard: baseline_created.`; the intake picker passes; `Read` after a
   `cd` passes; `/breaking-glass status` answers. Stop on an unexpected refusal and note its reason code.
3. **Admin layer.** `sh global/install-managed.sh` prints one sudo line; the owner runs it, then
   `sh global/install.sh --hooks=managed`. Fresh sessions, the same canary. Codex managed hooks need no
   `/hooks` trust.
4. If a stage fails: `/breaking-glass` switches one layer off for up to 240 minutes, or
   `install-managed.sh --uninstall` prints the removal line. Re-entering this emergency mode remains
   the last resort; with v2 in the admin layer, the user-level switches no longer reach those hooks.

## What stays active during emergency mode

| Control | Mechanism | Affected? |
| --- | --- | --- |
| Global brief | user instruction files (all three harnesses) | no |
| Deny floor | Claude `permissions.deny`; Codex `rules/workstation-deny-floor.rules` | no |
| Paste wrapper | shell functions for `claude`, `codex`, `kiro-cli` | no, when sourced |
| Paste filter | prompt hook | **suspended** |
| Restart guard | SessionStart/PreToolUse hook | **suspended** |
| HITL picker guard | Claude Code PreToolUse hook | **suspended** |
| Plugin hooks | plugin hook definitions | **suspended** |

Only the agent's adherence to the brief protects a pasted third-party reference typed into a CLI
started without the wrapper. Prefer starting CLIs through the wrapper while this mode is on.
