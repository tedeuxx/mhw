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

## Leave emergency mode

Do this only after the v1 defects are fixed and installed (see ADR-0024 when it exists).

1. Claude Code: remove the `disableAllHooks` key from `~/.claude/settings.json`. Restoring
   `settings.json.bak-v1` also works, but discards any later edit to that file; compare first.
2. Codex: delete the `hooks = false` line (and its comment) under `[features]` in
   `~/.codex/config.toml`. The same caution applies to restoring `config.toml.bak-v1`.
3. Start a fresh session in each harness, then verify loading and a harmless pass/block canary
   (ADR-0022) before claiming any hook is enforced. In Codex, changed hooks need the owner's trust in
   `/hooks`; an agent never grants it.

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
