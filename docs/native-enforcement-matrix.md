# Native enforcement matrix

What each agent harness can carry with its own native components, and what stays instruction only.
This is the deliverable of [#55](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/55)
and section 10 of the [requirements document](personal-multi-harness-workstation-configuration-product-requirements-document-project.md#10-native-enforcement-matrix).
It decides which mechanism each later slice uses. The decision it records is
[ADR-0027](adr/0027-native-carrier-per-component-from-the-enforcement-matrix.md) (proposed).

- **Date:** 2026-10-05, reference workstation (macOS, Apple silicon).
- **Versions on this machine:** Claude Code CLI `2.1.289` (and the same version bundled in its VS Code
  extension), Codex CLI `0.160.0` (the binary bundled in the ChatGPT VS Code extension, which is also
  the `codex` on `PATH`), Kiro CLI `2.27.1` (default agent engine `v2`), Kiro IDE `1.0.437`, Claude
  desktop app `2.9939.4`, ChatGPT desktop app `26.928.40906`.
- **Where measurements ran:** throwaway homes under the session scratch directory only (`HOME`,
  `CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointed there, `env -i`). No real user configuration was read
  or written, no credential was copied or linked, and no model call was made. The admin layer the
  owner already installed (Claude Code `managed-settings.d`, Codex `/etc/codex/requirements.toml`) was
  read by the agent harnesses as usual; it was not changed.

## How to read a cell

| Label | Meaning |
| --- | --- |
| **measured** | Exercised on the version named, with the command in [How each cell was measured](#how-each-cell-was-measured). "Present" means the component was loaded or listed, not that a model obeyed it. |
| **documented** | Taken from the vendor page linked in the cell. Not exercised here. |
| **assumed** | Neither measured nor documented; the reason is stated. |

A cell names one label first. A second clause says what the label does **not** cover. Where an agent
harness has no native component for a class, the cell says so as a stated gap; it is not filled with a hook.

## The matrix

| Component class | Claude Code (CLI) | Codex (CLI) | Kiro (CLI and IDE) | Claude desktop | ChatGPT desktop |
| --- | --- | --- | --- | --- | --- |
| **Agents** (subagents) | **measured** (2.1.289): `~/.claude/agents/<name>.md` is listed in the session's `agents`. | **documented**: `~/.codex/agents/<name>.toml` ([Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)). Not visible to `codex debug prompt-input`, so loading needs a model call; not measured. | **documented**: `~/.kiro/agents/<name>.json` (CLI 2.x; V3 also Markdown) ([Custom agents](https://kiro.dev/docs/custom-agents/configuration-reference.md)). Measurement blocked: `kiro-cli agent list` requires login (measured). | **documented** for the **Code** tab, which runs Claude Code and shows subagents ([Desktop](https://code.claude.com/docs/en/desktop)). Chat and Cowork: none from `~/.claude`. | **documented**: subagent activity appears in the desktop app; custom agents are for "local Codex clients" ([Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)). Chat surface: none. |
| **Per-agent tool list** | **measured** (2.1.289): an agent with `tools: Read`, run as the session agent, exposes only `Read`. As a subagent: documented, same front matter ([Subagents](https://code.claude.com/docs/en/sub-agents)). | **documented**, gap: the agent file has no tool list. Only `sandbox_mode`, `mcp_servers`, `skills.config` and other `config.toml` keys can differ per agent ([Subagents, custom agent file schema](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)). | **documented**: `tools` and `allowedTools`; CLI 2.x adds `toolsSettings` (`deniedCommands`, `deniedPaths`); V3 adds a `permissions` block ([CLI 2.x reference](https://kiro.dev/docs/cli/2x-reference.md)). | **assumed** same as Claude Code in the Code tab; the Desktop page does not say. | **documented**, gap: no per-agent tool list, as for Codex. |
| **Skills** | **measured** (2.1.289): `~/.claude/skills/<name>/SKILL.md` is listed in `skills` and as a slash command. | **measured** (0.160.0): skills in `$CODEX_HOME/skills/` and `~/.agents/skills/` appear in the model-visible skill list. | **documented**: `~/.kiro/skills/`, and every skill is also a slash command in CLI and IDE ([Slash commands](https://kiro.dev/docs/reference/slash-commands.md), [IDE slash commands](https://kiro.dev/docs/ide/chat/slash-commands.md)). | **documented**: local Code-tab sessions load `~/.claude/skills/`; Cowork takes skills from the claude.ai account, not from `~/.claude` ([Desktop](https://code.claude.com/docs/en/desktop)). | **documented**: the CLI, the IDE extension and the desktop app share the same configuration layers ([Best practices](https://learn.chatgpt.com/guides/best-practices.md)). |
| **Commands or prompts** (owner-typed) | **measured** (2.1.289): `~/.claude/commands/<name>.md` is listed as a slash command. The vendor documents commands as merged into skills ([Skills](https://code.claude.com/docs/en/skills)). | **measured** (0.160.0): a skill with `allow_implicit_invocation: false` is **left out** of the model-visible list, so it acts only when invoked. Invoking it by `$name` was not measured. Custom prompts are deprecated ([Custom prompts](https://learn.chatgpt.com/docs/custom-prompts.md)). | **documented**: CLI prompt files in `~/.kiro/prompts/`; `$ARGUMENTS` interpolation is documented for **V3 file prompts** only ([Manage prompts](https://kiro.dev/docs/cli/chat/manage-prompts.md)). The **IDE** slash menu lists steering, agents and skills, **not prompt files**. | **documented**: the slash menu lists built-in commands and custom skills ([Desktop](https://code.claude.com/docs/en/desktop)). Command files: assumed. | **assumed**: the desktop app's skill invocation syntax is not documented. |
| **Steering or briefs** | **measured** on 2.1.286 ([ADR-0010](adr/0010-global-brief-rendered-to-each-harness.md)): `~/.claude/CLAUDE.md` reaches the model. Not re-run on 2.1.289: the throwaway home has no login. | **measured** (0.160.0): `$CODEX_HOME/AGENTS.md` text is in the model-visible input. | **documented**: `~/.kiro/steering/` is global scope for IDE and CLI ([Configuration scopes](https://kiro.dev/docs/configuration.md)). | **assumed** for `CLAUDE.md` in the Code tab (it runs Claude Code). Chat: account instructions, pasted by hand. | **documented**: `AGENTS.md` through the shared configuration layers ([Best practices](https://learn.chatgpt.com/guides/best-practices.md)). Chat: account instructions only. |
| **Permission rules** | **measured** (2.1.289): a user-level `deny: ["Bash"]` removes `Bash` from the session. The session flag `--setting-sources project` drops the user layer, and `Bash` is back: a user-level deny is skippable without privilege. `Agent(name)` and `Skill(name)` denies do **not** remove those from the session lists; whether they refuse at invocation was not measured. | **measured** (0.160.0): a `prefix_rule` with `decision = "forbidden"` forbids its prefix; a command with an extra word before the matched words is not caught (prefix match). The 0.160.0 help lists `codex exec --ignore-rules`, "Do not load user or project execpolicy `.rules` files"; not exercised. Admin `requirements.toml` rules are documented as merged and restrictive ([Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)). | **documented**: `permissions.yaml`, deny wins at any scope ([Permissions](https://kiro.dev/docs/permissions.md)). This is **CLI V3 and IDE 1.x**; the installed CLI's default engine is `v2`, where only per-agent `toolsSettings` exist ([What's new in CLI V3](https://kiro.dev/docs/cli/v3.md)). | **documented**: settings and managed settings apply to Claude Code sessions in Desktop ([Desktop, managed settings](https://code.claude.com/docs/en/desktop)). | **documented**: shared configuration layers, so `rules/` applies ([Rules](https://learn.chatgpt.com/docs/agent-configuration/rules.md)). |
| **Admin-managed settings** | **measured** (2.1.289): a hook in `/Library/Application Support/ClaudeCode/managed-settings.d/` ran in a throwaway home with an empty user layer. | **documented**: admin `requirements.toml` and managed configuration ([Managed configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration.md)). The README records a 2026-10-04 canary on this machine with no version or command, so it is not counted as measured; re-running needs a tool call, which needs a login. | **documented**: `/Library/Application Support/Kiro/managed-settings.json`, `deny` and `ask` only, "the IDE and the CLI read the same file" ([Enterprise permissions](https://kiro.dev/docs/enterprise/governance/permissions.md)). For the CLI this assumes the V3 engine. | **documented**: managed settings override user and project settings in Desktop; Cowork reads the device's managed settings file ([Desktop](https://code.claude.com/docs/en/desktop), [Managed settings](https://code.claude.com/docs/en/managed-settings)). | **documented**: managed configuration and `requirements.toml` ([Managed configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration.md)). |
| **Hooks** | **measured** (2.1.289): managed `SessionStart` and `UserPromptSubmit` hooks fired. With `--bare` the managed `SessionStart` hook did **not** fire, while `UserPromptSubmit` still did. | **documented** ([Hooks](https://learn.chatgpt.com/docs/hooks.md)). A hook firing was not measured here (see the admin cell). Only the feature flag was read: `hooks` is stable and enabled in 0.160.0 (`codex features list`). | **documented**: CLI 2.x hooks live inside the agent file; V3 and IDE use `.kiro/hooks/*.json` ([Hooks](https://kiro.dev/docs/hooks.md), [CLI 2.x reference](https://kiro.dev/docs/cli/2x-reference.md)). | **documented** for the Code tab: hooks in settings apply to both CLI and Desktop ([Desktop](https://code.claude.com/docs/en/desktop); see [ADR-0003](adr/0003-distribution-requirements-access-modes.md)). Chat: none. | **documented**: the desktop app's Codex surface shares `CODEX_HOME` and its hooks ([Hooks](https://learn.chatgpt.com/docs/hooks.md)). Chat: none. |
| **Usage and token reporting** | **measured** (2.1.289), shape only: the headless JSON result carries `usage`, `modelUsage` and `total_cost_usd`; values were zero because the throwaway home is not logged in. `/usage` is listed. OpenTelemetry export is documented ([Monitoring](https://code.claude.com/docs/en/monitoring-usage)). | **documented**: `/status` shows current token usage; `/usage` shows account activity; OpenTelemetry is opt-in ([Slash commands in Codex CLI](https://learn.chatgpt.com/docs/developer-commands.md?surface=cli)). Not measured: needs a login. | **documented**: `/usage` shows **credits**, not tokens ([Slash commands](https://kiro.dev/docs/reference/slash-commands.md)). A per-request token view (`/stats`) exists in the page source but is hidden from the published page. The same page documents `/context show` (what is in context) and `/tools` (each tool, its estimated token count and its permission). | **assumed**: `/usage` in the Code tab, as Claude Code. Not documented for Desktop. | **assumed**: account usage pages exist; a per-session token count in the app is not documented. |
| **Native `/goal`** | **measured** (2.1.289): `goal` is in the built-in slash command list. Not exercised. Documented ([Commands](https://code.claude.com/docs/en/commands)). | **measured** (0.160.0): feature `goals` is stable and enabled. Not exercised. Documented for CLI, IDE extension and desktop app ([Long-running work](https://learn.chatgpt.com/docs/long-running-work.md)). | **documented** for the CLI, `/goal` with `--max` and `clear` ([Goal](https://kiro.dev/docs/cli/chat/goal.md)). The 2.27.1 binary carries a `/goal` command string; not exercised. IDE: not documented. | **assumed** in the Code tab, as Claude Code; not documented for Desktop. | **documented**: `/goal` starts Goal mode in the desktop app ([Long-running work](https://learn.chatgpt.com/docs/long-running-work.md)). |
| **Sandbox or container** | **documented**: `/sandbox`, OS-level (Seatbelt on macOS, bubblewrap on Linux and WSL2); falls back to unsandboxed unless `sandbox.failIfUnavailable` ([Sandboxing](https://code.claude.com/docs/en/sandboxing)). A reference dev container is documented ([Dev container](https://code.claude.com/docs/en/devcontainer)). | **measured** (0.160.0): `codex sandbox -P :read-only` refused a write in the working directory; `-P :workspace` allowed it, and also allowed a write in another directory under `/private/tmp` (temporary directories are writable). No container mode is documented for agent sessions. | **documented**, gap: no local sandbox. Sandboxed execution is a Kiro Web and cloud-session feature (`--cloud`), not IDE or CLI ([Permissions](https://kiro.dev/docs/permissions.md), [Cloud sessions](https://kiro.dev/docs/cloud-sessions.md)). | **documented**: Cowork can be required to run in a full VM (`requireCoworkFullVmSandbox`), where device policy is absent ([Managed settings](https://code.claude.com/docs/en/managed-settings); see [ADR-0003](adr/0003-distribution-requirements-access-modes.md)). | **assumed**: the desktop app's Codex surface uses the Codex sandbox; not checked. |

**Count:** 55 cells. **16 measured**, **32 documented**, **7 assumed**. Of the measured cells, 1 rests on
an earlier run (Claude Code brief on 2.1.286), and 3 show
presence or output shape only (Claude Code `/goal` and usage; Codex `goals` flag). No Kiro cell is
measured: the throwaway home has no Kiro login, and copying the owner's login was out of bounds.

## Also measured, because later slices depend on it

### Per-session token counts (worklog, [#76](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/76))

- **Claude Code:** yes. Headless runs return token and cost fields per session (shape measured on
  2.1.289); `/usage` in a session; OpenTelemetry for export.
- **Codex:** yes, documented: `/status` per session, OpenTelemetry opt-in. Not measured.
- **Kiro:** **credits only** in the published documentation. No per-session token count is
  documented. The worklog for Kiro can record credits, or must leave tokens empty.

### Native `/goal` (session goal anchor, `/what-else` [#74](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/74), [#11](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/11))

All three command-line agent harnesses have one: Claude Code (listed in 2.1.289), Codex (feature flag
on in 0.160.0, documented on CLI, IDE extension and desktop app), Kiro CLI (documented; string in the
2.27.1 binary). None was exercised. Kiro IDE: not documented.

### Command carriers

| Agent harness | Native carrier | Arguments | Evidence |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/commands/<name>.md`, or a skill | `$ARGUMENTS` | measured listed (2.1.289); arguments documented |
| Codex | skill in `~/.agents/skills/<name>/` with `agents/openai.yaml` `policy.allow_implicit_invocation: false` | none documented | measured: left out of the model-visible list (0.160.0); explicit `$name` invocation not measured |
| Kiro CLI | prompt file `~/.kiro/prompts/<name>.md`, or a skill | `$ARGUMENTS` for V3 file prompts only; skills support placeholders in the CLI | documented |
| Kiro IDE | **a skill** (`~/.kiro/skills/`), an agent or a manual steering file | placeholder substitution is CLI-only | documented: the IDE slash menu does not list prompt files |

### Do the IDE extensions read the same files as their command-line tools?

- **Claude Code VS Code extension:** **measured, at binary level.** The extension ships its own
  `claude` binary, version 2.1.289. Run headless against the same throwaway home, it loaded the same
  user-level agent, skill and command, and listed `goal` and `usage`. The IDE user interface itself
  was not driven. The vendor documents `~/.claude/settings.json` as shared between extension and CLI
  ([VS Code](https://code.claude.com/docs/en/vs-code)).
- **Codex (ChatGPT VS Code extension):** **measured identity.** The `codex` on this machine's `PATH`
  is the extension's bundled binary, so CLI and extension are the same program. Shared configuration
  layers are documented ([Config basics](https://learn.chatgpt.com/docs/config-file/config-basic.md)).
- **Kiro IDE and Kiro CLI:** **documented only.** They are separate programs (IDE 1.0.437, CLI
  2.27.1) that share the global `~/.kiro/` scope ([Configuration scopes](https://kiro.dev/docs/configuration.md)),
  but not every carrier: the IDE does not offer CLI prompt files, and the CLI's default `v2` engine does
  not use the IDE's `permissions.yaml` and hooks format.

### Sandbox and container support, for [#78](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/78)

- **Claude Code:** native OS-level sandbox (documented) and a vendor reference dev container
  (documented). Nothing native runs a session in Podman or Docker.
- **Codex:** native OS-level sandbox (measured: read-only refuses writes; workspace mode also opens
  temporary directories). No documented container mode for agent sessions.
- **Kiro:** no local sandbox; a cloud sandbox for cloud sessions (documented).
- **Desktop apps:** Cowork can be forced into a VM (documented); the rest is not documented.
- **Consequence:** a container mode is a launcher this repository would write. Inside a container the
  macOS admin layer (`/Library/Application Support/...`) is absent unless the image carries the Linux
  equivalent (`/etc/claude-code/` and `/etc/kiro/` are documented; Codex reads `/etc/codex/` on this
  machine, measured by the 2026-10-04 canary), so #78 must render the admin layer into
  the image or state the gap.

## Findings that change the requirements document

These contradict or sharpen statements in the requirements document. They are findings for the
owner; the requirements document gained only a link to this page.

1. **A user-level deny floor can be switched off by a session flag.** Section 4 places the deny floor
   at user level (open decision #59). In Claude Code, `--setting-sources project` dropped a user-level
   deny (measured, 2.1.289). In Codex, `codex exec --ignore-rules` skips user and project rules files
   (0.160.0 help text, not exercised). Neither flag needs privilege, and both are typed by an agent as
   easily as by the owner. Only the admin layer is outside their reach.
2. **Kiro has a documented admin carrier.** Sections 3 and 3a say Kiro has none for these controls and
   that its path was not found. The vendor documents `/Library/Application Support/Kiro/managed-settings.json`
   (deny and ask only, IDE and CLI). It applies only where the capability-based permission model runs:
   Kiro IDE 1.x and Kiro CLI V3. The installed CLI defaults to the `v2` engine, so on the command line
   it is inert until the owner opts into V3.
3. **Kiro command carrier.** Section 6 renders commands as Kiro prompt files. The IDE does not list
   prompt files, and prompt arguments are documented for V3 only. A **skill** is a slash command in
   both the Kiro CLI and the Kiro IDE.
4. **Codex has no per-agent tool list.** Section 4 grants connector access through "native per-agent
   tool lists". In Codex a custom agent can narrow MCP servers (`mcp_servers`) and the sandbox, but not
   the built-in tool set. For connectors exposed as MCP servers this is enough; for anything else it
   is instruction only.
5. **Kiro reports credits, not tokens.** Section 3b's worklog asks for tokens per model per Issue.
   Kiro can supply credits only.
6. **`/goal` is native in all three command-line agent harnesses.** Per section 3b, `/what-else` is not
   built where the native goal already shows progress; that is now a question per agent harness, not
   only for one.

## Consequences for later slices

| Issue | Native mechanism the matrix supports | Gap stated |
| --- | --- | --- |
| [#56](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/56) Remove the restart guard | Brief instruction plus version key; nothing native replaces a `SessionStart` check | Claude Code `--bare` already skips the managed `SessionStart` hook (measured), so the guard was bypassable by a flag |
| [#57](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/57) Version key | User brief instruction in all three; `./workstation status` the deterministic check (2026-10-05: instruction present in the model-visible Codex prompt with the stamp line, `codex debug prompt-input`; brief loaded as `User` memory in headless Claude Code) | Whether a model obeys it is not measured (needs a login); whether Claude Code shows the HTML `managed-by` comment to the model is not measured, so the instruction falls back to reading the brief file; Kiro documented |
| [#58](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/58) Paste cleaning | Claude Code prompt hook (measured: the managed `UserPromptSubmit` hook fired); Codex prompt hook (documented); the wrapper is not a native component. Since 2026-10-05 the wrapper is primary and the hook blocks only without its environment marker; the marker was measured reaching the hook process on Claude Code 2.1.289 and Codex 0.160.0 (ADR-0011, 2026-10-05 amendment) | Kiro: a `userPromptSubmit` hook is documented, but in CLI 2.x it lives inside each agent file, so it covers only sessions run with that agent; V3 and IDE use standalone hook files. Not measured |
| [#59](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/59) Deny floor | Claude Code: user deny (measured); managed deny (documented). Codex: user `rules/` prefix rules (measured, prefix limit measured); admin `requirements.toml` rules (documented). Kiro `managed-settings.json` (documented) | User deny (measured); managed deny (documented). At user level a session flag drops the floor in Claude Code (measured) and Codex (help text); only the admin layer is outside its reach. Kiro CLI needs the V3 engine. Prefix rules miss a word inserted before the matched words |
| [#60](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/60) Interaction standards | Owner overlay in each brief | Instruction only everywhere, as decided |
| [#61](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/61) Method at user layer | Claude Code agents, skills, commands (measured); Codex custom agents (documented) and skills (measured); Kiro agents and skills (documented) | Codex agents carry no tool list; Kiro agent format differs between CLI 2.x and V3 |
| [#62](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/62) CI mirror | Claude Code plugin format | Not a matrix question |
| [#63](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/63) Deprecate the plugin as a source | none needed | Not a matrix question |
| [#64](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/64) Site project on user level | Same carriers as #61 | Same gaps |
| [#65](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/65) Current-state table | This matrix's labels | Not a matrix question |
| [#66](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/66) Provenance stamp | Markdown comments and `SKILL.md` front matter in all three; Codex agent TOML takes `#` comments | Kiro agent JSON cannot carry a comment: needs the installed manifest |
| [#67](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/67) `./workstation` | Built 2026-10-05 over `install.sh` and `install-managed.sh`: writes the user carriers, prints the admin `sudo` line; probed in throwaway homes and a throwaway admin root | Kiro admin layer only matters once the CLI runs V3; Windows keeps `install.ps1` |
| [#68](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/68) Easier distribution | none | Not a matrix question |
| [#69](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/69) Documentation standard | A skill in all three (skills measured in Claude Code and Codex) | Kiro skills documented only |
| [#71](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/71)–[#73](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/73) `/new-idea`, `/idea-to-issues`, `/handover` | Claude Code command file (measured: listed); Codex implicit-off skill (measured: left out of the model-visible list); Kiro **skill**, which works in CLI and IDE (documented) | Codex has no documented argument syntax; Kiro prompt-file arguments are V3 only |
| [#74](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/74) `/what-else` | Native `/goal`: Claude Code (measured: listed), Codex (measured: feature flag on), Kiro CLI (documented) | Whether each native goal shows progress was not exercised; Kiro IDE has no documented `/goal` |
| [#75](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/75) `/blueprint` | Same carriers as #71–#73 | Same gaps |
| [#76](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/76) Worklog | Claude Code headless result fields and `/usage` (measured, shape only); Codex `/status` (documented); OpenTelemetry in both (documented) | Kiro: credits only |
| [#77](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/77) Ten commandments | User brief in all three | Instruction only, as intended |
| [#78](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/78) Container mode | Claude Code native OS sandbox (documented); Codex native OS sandbox (measured); Claude Code reference dev container (documented) | No native Podman or Docker session mode in any of the three; the admin layer must be rendered into the image or stated as absent |
| [#79](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/79) Agent runtime: local containers, cloud-ready, web console | Native OS sandboxes in Claude Code (documented) and Codex (measured); Kiro cloud sessions (documented). Cloud sessions for Claude Code and Codex are not covered by this matrix | No native local container mode in any of the three; the admin layer must be rendered into an image or stated as absent |
| [#80](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/80) Session-start runtime summary | Claude Code headless `init` lists tools, agents, skills, commands and hook events (measured); Codex `/status` (documented); Kiro `/context show` and `/tools` (documented, [Slash commands](https://kiro.dev/docs/reference/slash-commands.md); see the Kiro usage cell) | No agent harness reports overrides per layer natively; session flags that drop a layer (measured in Claude Code, help text in Codex) must be named in the summary |

## How each cell was measured

All runs used `env -i` with `PATH`, `HOME` and the configuration directory set to a throwaway
directory `<scratch>`. `<cc>` is `claude` 2.1.289 (`/opt/homebrew/bin/claude`, and the VS Code
extension's `resources/native-binary/claude`). `<codex>` is `codex` 0.160.0. Probe files were named
`probe-agent`, `probe-skill`, `probe-command` and held no real content.

| Cell | Command (shape) | Result |
| --- | --- | --- |
| Claude Code agents, skills, commands, `/goal`, `/usage` | `<cc> -p --no-session-persistence --output-format stream-json --verbose --tools "" --strict-mcp-config "x"` with `HOME=<scratch>`, `CLAUDE_CONFIG_DIR=<scratch>/.claude` | `init` lists `probe-agent` in `agents`, `probe-skill` in `skills`, `probe-skill` and `probe-command` in `slash_commands`, plus `goal` and `usage`; result carries `usage`, `modelUsage`, `total_cost_usd`; reply "Not logged in" |
| Claude Code per-agent tool list | same, plus `--agent probe-agent` (agent front matter `tools: Read`) | `tools: ["Read"]` |
| Claude Code permission rule | same with `--tools "Bash,Read"` and user `settings.json` `{"permissions":{"deny":["Agent(probe-agent)","Skill(probe-skill)","Bash"]}}`; calibration adds `--setting-sources project` | `tools: ["Read"]`, agent and skill still listed; calibration `tools: ["Bash","Read"]` |
| Claude Code admin layer and hooks | same, plus `--include-hook-events`; then with `--bare`, then `--safe-mode` | default and `--safe-mode`: `SessionStart:startup` and `UserPromptSubmit` hook events; `--bare`: only `UserPromptSubmit` |
| Claude Code VS Code extension | the extension's bundled binary, same probe | version 2.1.289; same probe agent, skill and command; `goal` and `usage` listed |
| Codex brief, skills, implicit-off skill | `<codex> debug prompt-input "hi"` with `HOME=<scratch>`, `CODEX_HOME=<scratch>/.codex`; `$CODEX_HOME/AGENTS.md`, skills in `$CODEX_HOME/skills/` and `~/.agents/skills/` (one with `allow_implicit_invocation: false`, one calibration without) | brief text present; `probe-skill` and calibration skill listed; implicit-off skill absent; custom agent and prompt file absent (not in this output by design) |
| Codex feature flags | `<codex> features list` | `goals stable true`, `hooks stable true`, `multi_agent stable true` |
| Codex admin layer and hooks | not run: `codex debug prompt-input` runs no hooks, and triggering `PreToolUse` needs a tool call, which needs a login | cells labelled documented |
| Codex permission rule | `<codex> execpolicy check --rules <scratch>/probe.rules probetool danger now`, then `probetool safe`, then `probetool -x danger`; rule `prefix_rule(pattern = ["probetool", "danger"], decision = "forbidden")` | `forbidden`; no match; no match |
| Codex rules bypass flag | `<codex> exec --help` | lists `--ignore-rules`: "Do not load user or project execpolicy `.rules` files" |
| Codex sandbox | `<codex> sandbox -P :read-only -C <scratch>/work -- /usr/bin/touch <scratch>/work/f`; `-P :workspace` for `<scratch>/work/f` and `<scratch>/outside/f` | read-only: `Operation not permitted`, exit 1; workspace: both created, exit 0 |
| Kiro | `kiro-cli agent list` and `kiro-cli agent validate --path …` with `HOME=<scratch>` | "You are not logged in"; measurement stopped there |

## What was not measured, and what would settle it

- **Anything that needs a model call:** whether a brief, an agent or a deny is obeyed at invocation on
  today's versions; token values; `/goal` behaviour. A login inside a throwaway configuration directory,
  done by the owner, would settle these. Agents were deliberately not given the owner's credentials.
- **Kiro, every cell.** `KIRO_HOME` is documented for a separate profile; a login there by the owner
  would allow the same probes as above.
- **Desktop apps and IDE user interfaces.** They were not driven; their cells rely on vendor pages.
- **The Claude Code `--bare` flag** was measured to skip the managed `SessionStart` hook event; whether
  it also skips managed `PreToolUse` hooks needs a tool call, so it was not measured.
