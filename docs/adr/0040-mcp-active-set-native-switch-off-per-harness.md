# ADR-0040: The MCP active set, turned off natively in each agent harness outside it

- **Status:** proposed. The owner took the five decisions it rests on in his interview of 2026-10-24
  ([Issue #219](https://github.com/tedeuxx/mhw/issues/219)); the mechanism below, its opt-in key and its
  limits wait for his ratification.
- **Date:** 2026-10-24
- **Deciders:** the owner (decisions 1 to 5); written by the implementing agent
- **Issues:** [#219](https://github.com/tedeuxx/mhw/issues/219)
- **Amends:** [ADR-0017](0017-single-source-mcp-with-secret-indirection.md), whose local definition now
  also names the active set, and whose renderer gains a mode for it.

## Context and problem

Each agent harness starts the MCP servers it finds in its own files: servers the owner added by hand,
servers a plugin brings, servers a claude.ai account syncs into Claude Code, and the claude.ai
connectors Claude Code fetches itself. Nothing on the workstation says which of them are wanted, so a
server the owner never chose runs with his credentials and his data in reach, and a server he does
want is on in one agent harness and missing in another.

The owner settled the policy in five decisions on Issue #219 (2026-10-24):

1. **Parity.** Every server in the active set is on in all three agent harnesses: Claude Code, Codex
   and Kiro.
2. **Exempt.** A server an agent harness app writes for its own built-in browser or computer use is
   never turned on, never turned off and never counted as drift.
3. The cloud API server [ADR-0035](0035-workstation-blueprint-reconciliation.md) decision 2 retired
   stays outside the set; its entry left in the Claude desktop configuration is drift.
4. No server a synced vendor plugin adds, and no claude.ai connector he never authenticated, is in the
   set. The set is the one derived from his current configuration, plus the connectors he connected.
5. **Native switch-off.** `mhw install` turns off each server outside the set through each agent
   harness's own mechanism, and uninstall reverses it. He chose this over report-only and over a
   managed allowlist.

This adds a control and changes how each agent harness is configured, so a record is owed
([ADR-0001](0001-record-decisions-as-madr.md)).

## Decision drivers

- No server name, URL, command or credential of the owner's enters this repository: the set lives in
  the untracked local overlay ([ADR-0017](0017-single-source-mcp-with-secret-indirection.md)), the tests
  use synthetic names, and the output carries names and counts, never a value.
- Native mechanisms first: each switch is the vendor's own documented key, never a hook.
- Never weaken and never lose: only what mhw turned off is turned back on, a server the owner turned
  off himself stays off, and every write keeps a backup.
- A set nobody declared must turn nothing off: an empty or missing set is not a set of zero servers.
- Report each switch at its real evidence level.

## Considered options

1. **A declared set in the local definition, and each agent harness's own per-server switch (chosen).**
   The servers of the local definition are the set once the definition carries an `active_set` key.
   Trade-off: four mechanisms, three files written that mhw did not write before
   (`config.toml` tables outside the managed block, `~/.claude/settings.json`, `~/.kiro/settings/mcp.json`
   entries outside the managed names), and a snapshot that ages until the next install.
2. **Report only.** `mhw status` names the servers outside the set; the owner turns them off.
   Rejected by the owner (decision 5): it leaves the servers running.
3. **A managed allowlist.** Claude Code's `allowedMcpServers` (or a `managed-mcp.json`) in the admin
   layer would admit only the set. Rejected by the owner (decision 5). It also has no Codex or Kiro
   counterpart, and in Claude Code an allowlist blocks every server added later, including one he
   wants, until the list is edited as root.
4. **Remove the servers from the files.** Rejected: a removed entry is gone with its configuration, a
   plugin or a sync writes it back, and uninstall cannot restore it without keeping copies of entries
   that may carry credentials.
5. **Match a plugin server in Claude Code by its `plugin:<plugin>:<server>` label (`serverName`).**
   Rejected: the settings reference documents `serverName` as the user-assigned label and the claude.ai
   display name; a match on the plugin label is not documented. The plugin's own URL (`serverUrl`) or
   command (`serverCommand`) is, so those are used.
6. **Read the connected claude.ai connectors from a local cache.** Rejected: connectors are
   account-level ([ADR-0017](0017-single-source-mcp-with-secret-indirection.md), *Remote connectors*);
   no documented local file lists them. They are declared in the overlay instead (below).

## Decision outcome

**Chosen: option 1.** `mcp_render.py --active --mode=install|check|dry-run|uninstall`, in
`global/mcp/mcp_active.py`, run by `global/install.sh` on every `mhw install`, check and uninstall,
after the policy servers ([ADR-0038](0038-chrome-devtools-mcp-at-user-scope-bounded-by-origin.md)).

### The set is declared, and parity is the default

The set is the `servers` of the local definition, `active_set` opts in, and the owner writes it:

```json
{ "version": 1,
  "servers": { "<name>": { "command": "…" } },
  "active_set": { "connectors": { "<claude.ai display name>": "on", "<another>": "off" } } }
```

- **Opt-in.** With no definition, or a definition without `active_set`, nothing is turned off, and
  what an earlier install turned off is turned back on. So an install on a machine that renders a
  definition for [ADR-0017](0017-single-source-mcp-with-secret-indirection.md) alone keeps every other
  server running, as before.
- **Parity is the default, and enforced under a set.** A server with no `surfaces` already renders to
  every surface (unchanged), which covers the three agent harnesses. Once `active_set` is declared, a
  server whose `surfaces` leaves out `codex`, `claude-code` or `kiro` is refused at validation: decision
  1 does not admit a per-harness list. The alternative, making parity an explicit flag, was not taken:
  a default that already meets the decision needs no second switch.
- **The policy servers** ([ADR-0038](0038-chrome-devtools-mcp-at-user-scope-bounded-by-origin.md)) are
  never treated as outside the set on the surfaces they name, and they are not part of parity: they are
  tracked, not the owner's, and `chrome-devtools` is Claude Code only by that record.
- **claude.ai connectors** are declared by display name, `on` (in the set) or `off` (denied). A
  connector the overlay does not name is not acted on: nothing local can list it.

### Per agent harness

| Agent harness | Outside the set | The switch | Evidence |
| --- | --- | --- | --- |
| **Codex** | a `[mcp_servers.<name>]` table in `config.toml`, outside the renderer's managed block | `enabled = false` written on the table, carrying a `managed-by` comment; an `enabled = true` line is replaced and recorded. Every edit is proved with `tomllib` before writing. A server not written as its own table (an inline table under `[mcp_servers]`) is refused, exit 3, and the other agent harnesses still apply | documented (config reference: *"Disable an MCP server without removing its configuration"*); **probed**: codex-cli 0.163.0 lists the server `enabled: false` (`codex mcp list --json`, a throwaway `CODEX_HOME`, in the suite wherever `codex` is on `PATH`). Not measured: a signed-in session not starting it |
| **Claude Code** | a server in `~/.claude.json` (user scope); a server a plugin provides, read from each installed plugin's `.mcp.json` or inline `plugin.json` (`installed_plugins.json`) and from `~/.claude/plugins/synced/*/*/.mcp.json`; a connector declared `off` | an entry appended to `deniedMcpServers` in `~/.claude/settings.json`: `serverName` for a user-scope server and for `claude.ai <Name>`; `serverUrl` (exact) or `serverCommand` for a plugin server. A plugin server whose URL or command carries `${…}`, a `*` or a credential-looking value is never copied into the settings; it is reported. The owner's own entries are kept | documented (settings reference: *"Claude Code refuses to load a matching server wherever it's defined, including plugin servers, … and the claude.ai connectors it fetches itself"*, *"Scope: Any file"*; managed MCP page: *`{ "serverName": "claude.ai Slack" }` blocks the Slack connector*). Not probed: `claude mcp` is in the owner's deny list and a headless session needs a login |
| **Kiro** IDE and CLI | a server in `~/.kiro/settings/mcp.json` | `"disabled": true` on the entry; a `"disabled": false` is recorded and restored | documented ([Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration/): *"disabled — Whether the server is disabled (default: false)"*). Not probed: kiro-cli 2.34.0 refuses `mcp list` in a throwaway HOME without a login |
| **Claude desktop app** | a server in `claude_desktop_config.json` | **none: report only.** The file has no per-server switch, and its connectors are account-level | stated limit |

**Exempt (decision 2):** `node_repl` (the Codex app's own REPL server, named on the Issue) and
`claude-in-chrome` (Claude Code's built-in Chrome server, named in the settings reference). Matched by
name on every agent harness, so a server of the owner's under one of these names is exempt too.

**Every write** keeps the previous file as `<config>.pmhwc-mcp-active-backup` (0600) and prints the
names it turned off or back on. What was changed is recorded in the manifest (`mcp-managed.json`,
`"active"`): the Codex line an `enabled` key held, the Kiro `disabled` value, the Claude Code entries
mhw added. Install turns back on a server that joined the set; uninstall turns back on all of them, so
the Codex file comes back byte for byte (tested). A server the owner turned off himself is neither
recorded nor turned back on.

### `mhw status`

`install.sh --check` prints one line per agent harness, tagged `(MCP active set)`, and `mhw status`
shows them under `mcp active set`: every server on outside the set (`DRIFT`, counted as a target
`mhw install` fixes), every set member not configured or turned off by hand on an agent harness
(`ABSENT`), and what has no switch (`REPORT`: the desktop app, and a plugin server with no documented
match). Names and counts only.

## Consequences

### Good

- A server the owner did not choose stops loading in the three agent harnesses, through switches the
  vendors document, and the same command reverses it.
- Drift is visible: a server a plugin or a sync adds after install shows in `mhw status` until the next
  install turns it off.
- Nothing changes for a machine that declares no set.

### Bad, and the limits

- **Snapshot.** The switches are computed at install. A server a synced plugin adds afterwards loads
  until the next `mhw install`; `mhw status` names it meanwhile.
- **Connectors are declared by hand and cannot be checked.** A connector the overlay does not name is
  neither denied nor reported. A connector declared `on` cannot be verified as connected. A
  `serverName` deny follows the display name, which claude.ai can change; the deny then stops matching.
- **Connectors break parity.** A claude.ai connector exists only in Claude clients; it cannot be
  rendered to Codex or Kiro, which would need its URL and its sign-in. Parity holds for the local
  definition's servers only.
- **The Claude desktop app is not switched**, and Claude Code's denylist does not reach the connectors
  the desktop app delivers in-process to its own sessions (managed MCP page). The retired cloud server
  of decision 3 is reported there, not removed.
- **Every plugin server is outside the set**, including one from a plugin the owner installed himself.
  There is no key to keep one; disabling the plugin, or a new decision, is the route.
- **A plugin server matched by URL or command only**: one whose launch line carries `${CLAUDE_PLUGIN_ROOT}`
  or another variable is reported, not denied, because whether that variable expands before matching
  is not documented.
- **Exemption by name** is a heuristic: an app that names its built-in server differently is treated as
  outside the set until the list is extended.
- **Scope:** user scope only. A project's `.mcp.json`, a project-scoped entry in `~/.claude.json`, a
  Kiro workspace `mcp.json` and a Codex project config are not read. The denylist does reach a
  project's server of the same name or URL, because Claude Code matches it wherever it is defined.
- **macOS and Linux only.** `install.ps1` does not run it; on Windows nothing is turned off.
- **Evidence:** written and tested in throwaway homes; the Codex switch probed. Not installed on the
  reference machine, and not checked in a signed-in session of any agent harness.

## Links

- Issue [#219](https://github.com/tedeuxx/mhw/issues/219) (decisions 1 to 5 and the consolidated
  design).
- [ADR-0017](0017-single-source-mcp-with-secret-indirection.md) (the local definition and its renderer),
  [ADR-0038](0038-chrome-devtools-mcp-at-user-scope-bounded-by-origin.md) (the policy servers),
  [ADR-0035](0035-workstation-blueprint-reconciliation.md) decision 2 (the retired cloud server).
- Vendor documentation read on 2026-10-24: <https://code.claude.com/docs/en/settings-reference>
  (`deniedMcpServers`), <https://code.claude.com/docs/en/managed-mcp> (matching by URL, command or name),
  <https://developers.openai.com/codex/config-reference> (`mcp_servers.<id>.enabled`),
  <https://kiro.dev/docs/mcp/configuration/> (`disabled`).
- `global/mcp/mcp_active.py`, `global/mcp/mcp_render.py`, `global/mcp/mcp_render_test.py` (class
  `ActiveSet`), `global/install.sh` (`mcp_step`), `global/install.test.sh` (section 19c),
  `global/workstation.py` (`mcp_active_lines`).
