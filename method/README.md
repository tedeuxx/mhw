# The working method: single source

This directory is the **only place the owner's working method is edited**: the agents, skills and
commands every project uses. It was moved here from the `tadeumendonca-skills` plugin by
[#61](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/61). The
decision and the carrier map are in
[ADR-0031](../docs/adr/0031-this-repository-is-the-single-source-of-the-working-method.md).

| Directory | Holds | Rendered to |
| --- | --- | --- |
| `agents/<name>.md` | one agent: `name`, `description`, `purpose`, `tools` (an explicit `[]` for none), optional `disallowed-tools` (`mcp__<server>__<tool>` of a granted server), `skills` (preloads), then its brief | Claude Code `~/.claude/agents/`, Codex `~/.codex/agents/<name>.toml`, Kiro `~/.kiro/agents/<name>.json` |
| `skills/<name>/SKILL.md` | one skill: `name`, `description`, `purpose`, then its body | `~/.claude/skills/`, `~/.agents/skills/` (Codex), `~/.kiro/skills/` |
| `commands/<name>.md` | one owner-typed command: `name`, `description`, `purpose`, `argument-hint`, then its body | `~/.claude/commands/`; a Codex skill with implicit invocation off; a Kiro skill |

`./workstation install` renders it through `global/install.sh` (on Windows, `global/install.ps1`), which runs
`global/method/method_render.py` as its own step. `./workstation check`, `status` and `uninstall` cover
it the same way. Every rendered file carries the provenance stamp (ADR-0029).

The method carries **no hooks**. Edit the source here, never a rendered file; the next install
overwrites a rendered file and `check` reports the difference as `DRIFT`.
