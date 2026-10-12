# The working method: single source

This directory is the **only place the owner's working method is edited**: the agents, skills and
commands every project uses. It was moved here from the `tadeumendonca-skills` plugin by
[#61](https://github.com/tedeuxx/mhw/issues/61). The
decision and the carrier map are in
[ADR-0032](../docs/adr/0032-this-repository-is-the-single-source-of-the-working-method.md).

| Directory | Holds | Rendered to |
| --- | --- | --- |
| `agents/<name>.md` | one agent: `name`, `description`, `purpose`, `tools` (an explicit `[]` for none), optional `disallowed-tools` (`mcp__<server>__<tool>` of a granted server), `skills` (preloads), then its brief | Claude Code `~/.claude/agents/`, Codex `~/.codex/agents/<name>.toml`, Kiro `~/.kiro/agents/<name>.json` |
| `skills/<name>/SKILL.md` | one skill: `name`, `description`, `purpose`, then its body | `~/.claude/skills/`, `~/.agents/skills/` (Codex), `~/.kiro/skills/` |
| `commands/<name>.md` | one owner-typed command: `name`, `description`, `purpose`, `argument-hint`, then its body | `~/.claude/commands/`; a Codex skill with implicit invocation off; a Kiro skill |

**Installing it is opt-in until the plugin cutover (#63, #64):** `./mhw install --method`
renders it through `global/install.sh` (on Windows, `global/install.ps1 -Method`), which runs
`global/method/method_render.py` as its own step. `./mhw check`, `status` and `uninstall` cover
it the same way. Every rendered file carries the provenance stamp (ADR-0029).

The method carries **no hooks**. Edit the source here, never a rendered file; the next install
overwrites a rendered file and `check` reports the difference as `DRIFT`.

## The plugin is generated from here (#62)

`global/method/method_package.py build` renders this directory into the Claude Code plugin
`tadeumendonca-skills`: `.claude-plugin/plugin.json` (version = this repository's release),
`agents/`, `skills/`, `commands/`, and `.mhw-generated`, the list of what it generated. It reuses
`method_render.py`'s parser and Claude Code renderers, so the plugin carries the same text as the
user-level install. Every file carries the provenance stamp (ADR-0029) and a marker saying it is
generated and where to edit it (in `plugin.json`, inside its description: JSON has no comment). No
hooks, no settings, no MCP servers, no deny floor.

After every release, the `mirror` job in `.github/workflows/version-main.yml` builds it from the tag,
runs `method_package.py check` (the structural load test), and with a GitHub App token pushes it to
`tadeumendonca-skills`, replacing only the generated paths (`sync`). Without the App's secrets it
prints a notice and skips; it never fails the release. The App is the owner's to create:
[runbook](../docs/runbooks/mirror-github-app.md).

| What | Evidence |
| --- | --- |
| Packager, check and sync | *written and tested*: `global/method/method_package_test.py` (36 tests, on CI); 15 mutations of the packager, the renderer and the workflow each turned it red |
| `claude plugin validate --strict` on the package | *passed* on Claude Code 2.1.296 on the reference machine; the suite runs it only where `claude` is on `PATH`, so not on CI. Calibrated by hand: it fails on a missing front matter, a skill without a description, a non-string version and an unknown manifest key; it **passes** a malformed YAML value in an agent or command |
| The `mirror` job | *written*; its shape is asserted by the suite (after the release, pinned action, scoped token, every step gated on the secrets). **Not run**: the App does not exist yet and no real push has happened |
| The plugin repository after a mirror | **not run**. By design it keeps what the package does not generate, named in the job log: `hooks/` (Claude Code still loads it until the cutover, #63), `.mcp.json`, `powers/`, `.codex-plugin/`, and the commands and skills the method does not carry (the site-stack skills, #64) |
