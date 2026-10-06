# ADR-0032: This repository is the single source of the working method, rendered into each agent harness's native user-level carriers

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Builds on:** [ADR-0014](0014-purpose-boundary-firewall-vs-plugin.md),
  [ADR-0026](0026-four-distribution-layers-rubric.md),
  [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md),
  [ADR-0029](0029-provenance-stamp-in-every-installed-file.md)
- **Issue:** [#61](https://github.com/tedeuxx/mhw/issues/61)
  (part of [#52](https://github.com/tedeuxx/mhw/issues/52);
  requirements document, sections 4a and 6)

## Context and problem

The owner's working method (agents, skills and slash commands) lived in the `tadeumendonca-skills`
plugin. The plugin reached Claude Code natively, Codex through a plugin that also registered hooks,
and Kiro through a generated Power whose loader reads skills only, so Kiro never received the agents.
The approved plan (#52) moves the method into this repository's user layer, renders it natively into
all three agent harnesses, and later regenerates the plugin from here (#62).

The owner's rulings on #61 that bound this record:

- `devops` moves **whole** to user level: *"tudo no usuario, verificacao de workstation nivel projeto
  git"*. A project's fit is checked through its workstation version key (#57), not a project copy.
- `planning-poker` **stays**: *"planning-poker é usado pelos agentes."* Its description must stop saying
  it is a reference pattern only.
- `product-lead` stays at user level.
- Every agent gets least privilege for its purpose and full autonomy within it, through native
  per-agent tool lists. Codex custom agents have no tool list (ADR-0027), so there it is an instruction.
- Native first; a gap is never filled with a hook. No hook moves (section 4a).
- Every rendered file carries the provenance stamp (ADR-0029).

## Decision drivers

- One source text per component; the installed files are renderings, and drift is a defect.
- Native carrier per agent harness, as the enforcement matrix measured it.
- The stamp is derived once, by `install.sh`.
- Keep the installer change in its own step, because other slices are editing `install.sh` at the same
  time (#60, #80).

## Considered options

1. **Copy the method into `method/` here and render it with a dedicated step (chosen).** `method/` is
   the source; `global/method/method_render.py` writes each agent harness's user-level carrier;
   `install.sh` calls it with its own mode and stamp. *Trade-off:* the method's text is carried as it
   stood in the plugin, so passages that describe the plugin's own files and hooks are now stale
   descriptions (see Consequences); and the plugin stays a second copy until #62 regenerates it.
2. **Keep the plugin as the source and install its packages per agent harness** (Claude Code plugin,
   Codex plugin, Kiro Power). *Trade-off:* no copy, but Kiro gets no agents (its Power loader reads
   skills only), the Codex package registers hooks the hook budget retires, and the method keeps living
   outside the repository that governs the workstation, which is what #52 reverses.
3. **Inline every preloaded skill into each Codex agent's instructions, as the plugin's Codex builder
   did.** *Trade-off:* Codex agents start with their skills in context, as in Claude Code, but
   `quality-assurance` alone would carry about 460 KB of instructions (its brief plus six preloads, `wc -c`), repeated per agent; the skills
   are already installed as Codex skills, so the agent is told to load them by name instead.
4. **Fill the Codex tool-list gap with a hook.** Rejected by the hook budget (section 4a) and ADR-0027.

## Decision outcome

Option 1.

### What moved

From the plugin's `main` at commit `01045b660fc31fa6cb4f063fc0c5a2f1aa04db7c` (v2.0.104):

| Kind | Count | Members |
| --- | --- | --- |
| Agents | 8 | agents-lead, tech-lead, developer, quality-assurance, scrum-master, product-lead, content-writer, content-reviewer |
| Skills | 12 | agents-configuration, shell, documentation-standard, engineering-standards, definition-of-ready, definition-of-done, code-review, quality-gates, published-voice, content-publishing, devops, planning-poker |
| Commands | 2 | autonomy, new-issue |

Changes made in the move, and nothing else:

- The skill set and the preloads are moved as they are. The requirements document's section 6 proposes
  folding `code-review` into `definition-of-done` and `content-publishing` into `published-voice`;
  consolidating skills changes the owner's method, so that stays a proposal for him, not part of this
  move.
- `planning-poker`'s description says the agents use it to estimate; the body's reference-pattern
  paragraph is struck in place with the owner's ruling.
- `agents-configuration` gains one section: the plugin's session-start and end-of-turn hook checks, now
  as steps the agent runs (section 4a).
- **No text claims enforcement this method does not have.** Every file that names a plugin hook, guard
  rule or test opens with a note that those are the retired plugin's, that the rules they held are
  instructions now, and what is still mechanical: the workstation deny floor (where installed) and each
  agent's tool list. Passages that described a hook as actively denying, refusing or reporting are
  rewritten as instructions, or as denied by the deny floor where its prefixes cover the act (force-push,
  squash merge, `terraform apply`/`destroy`, `gh api` writes, and the rest of `global/deny-floor.conf`).
  The checks that remain only as text name the plugin in the past tense.
- `product-lead` loses the plugin-namespaced browser server and keeps `mcp__chrome-devtools`. The
  plugin's `mcp-guard.sh` limited that grant to the browser's read-only tools; the source now carries the
  same limit as `disallowed-tools` (the seven input-carrying tools), rendered as Claude Code
  `disallowedTools` and Kiro `excludedTools`, and as an instruction in Codex.
- Sanitisation: a few passages were abstracted before they entered this repository (categories:
  employer identification, a grey-zone health reference, and an employer-tooling reference).
- Front matter is normalised: every item has `name`; scalars are quoted.

Not moved here: the site-stack skills (`backend`, `frontend`, `cloud-infrastructure`, #64); `/blueprint`
(#75) and the new commands (#71 to #74), each its own Issue; the sprint and funnel rites and session
commands, which section 6 leaves out of the set; every hook.

### Carrier map (user level)

| Component | Claude Code | Codex | Kiro |
| --- | --- | --- | --- |
| Agent | `~/.claude/agents/<n>.md`: `tools` (an explicit `[]` for none), `disallowedTools`, and `skills` preloads | `${CODEX_HOME:-~/.codex}/agents/<n>.toml`, name with underscores; preloads, the tool list and MCP use as an instruction; `sandbox_mode = "read-only"` when the agent is granted no writing tool; no `mcp_servers` narrowing rendered | `~/.kiro/agents/<n>.json`: `tools`, `excludedTools`, preloaded skills as `file://` resources; **no `allowedTools`**, so nothing is auto-approved, because Kiro carries no deny floor |
| Skill | `~/.claude/skills/<n>/SKILL.md` | `~/.agents/skills/<n>/SKILL.md` | `~/.kiro/skills/<n>/SKILL.md` |
| Command | `~/.claude/commands/<n>.md` | a skill in `~/.agents/skills/<n>/` with `agents/openai.yaml` `policy.allow_implicit_invocation: false`; invoked as `$<n>` | a skill in `~/.kiro/skills/<n>/`, a slash command in CLI and IDE |
| Stamp | a `#` comment in the YAML front matter | a `#` comment (TOML, YAML); front matter comment in `SKILL.md` | front matter comment in `SKILL.md`; the first line of the agent's `prompt` (JSON has no comment) |

Tool names map from Claude Code to Kiro tags: `Read`, `Grep`, `Glob` to `read`; `Write`, `Edit` to
`write`; `Bash` to `shell`; `mcp__<server>` to `@<server>`. A tool with no mapping stops the render.

**Opt-in until the plugin cutover.** The method is installed only with `./workstation install --method`
(`install.sh --method`, `install.ps1 -Method`). Without it, and with no rendered method file present,
the step writes nothing and prints `METHOD  not installed`. Once installed, later runs keep it current and
`--check` covers it; `--uninstall` removes it. `./workstation status` prints a `method` line and names a
**DUPLICATE** when the method is installed while the `tadeumendonca-skills` plugin is enabled in Claude
Code (`enabledPlugins`) or Codex (`config.toml`). The reason, measured by the agents-lead lens on this PR:
with both present, Claude Code 2.1.289 and Codex list every agent, skill and command twice, and the
plugin's still-running `permission-guard.sh` keys its role rules on the namespaced agent type, so it
refuses the bare-named agents' posting, filing and merging.

**How it runs.** `install.sh` calls the renderer after its other targets, in every mode: install,
`--check` (`OK`, `STAMP`, `DRIFT`, `MISSING`, `STALE`), `--dry-run` and `--uninstall`, so
`./workstation install`, `check`, `status` and `uninstall` cover it. On Windows, `install.ps1` runs the
same renderer (install, `-Check`, `-DryRun`) with `--home=%USERPROFILE%`, when Python 3.9 or later is on
`PATH`; it has no uninstall mode, as before. A file is ours only when its
managed-by line names `source: method/`; any other file in the way is refused and left untouched. A
rendered file whose source was deleted is `STALE` and removed on install.

## Consequences

- Good: one source for the method, edited here and rendered into all three agent harnesses; Kiro gets
  the agents for the first time.
- Good: least privilege per agent is native in Claude Code (measured) and Kiro (documented) as a tool
  list. In Kiro nothing is auto-approved, so every call within the list prompts.
- Bad: **Codex agents carry no tool list.** The limit is an instruction, plus a read-only sandbox for
  `scrum-master`, the only agent granted no writing tool. Codex documents a per-agent `mcp_servers`
  narrowing; this step does not render it, because the server names live in the owner's untracked MCP
  overlay (ADR-0017) and are not known here. So every Codex agent inherits the parent session's MCP
  servers, held back by an instruction only. Codex agents also have no preload field:
  they are told to load their skills by name.
- Bad: **Kiro is documented only.** `kiro-cli agent list` and `agent validate` need a login (measured).
  The tool tags are documented for Kiro IDE 1.x and CLI V3; on the CLI's default v2 engine they are
  assumed. Kiro command-skills cannot switch off implicit invocation; their description says to run
  them only when the owner types them.
- Bad: **the text still carries the plugin's history.** Measurements, struck passages and design
  arguments still name the plugin's hooks and scripts. Each such file opens with the note above, and no
  passage claims one of them runs; but a full rewrite of that history is later content work.
- Bad: the rules the plugin's hooks held mechanically on Claude Code (no posting by the content agents
  and `product-lead`, the gatekeeper as the only merger, no `gh issue create` by a reviewing agent, no
  plain push to the trunk) are **instructions** now. A per-agent tool list cannot split `Bash` by
  subcommand, and the deny floor matches prefixes for every session alike.
- Bad: the browser connector `product-lead` names is not defined by this step; its server definition
  is the MCP renderer's (ADR-0017).
- Bad: installing the method while the plugin is enabled duplicates everything and lets the plugin's
  hooks refuse the bare-named agents (above). The opt-in and the `status` warning make that visible; they
  do not prevent it.
- Bad: on Windows the renderer needs a Python 3.9+ interpreter on `PATH`; without one, `install.ps1` prints `SKIP` and exits 2. The Windows CI jobs are the only probe there.
- Bad: the rendered files are large (the method's source is about 1.0 MB of text (`cat method/agents/*.md method/skills/*/SKILL.md method/commands/*.md | wc -c`), rendered once per agent harness), and Kiro
  loads preloaded skills in full at agent start.

## Evidence

Measured 2026-10-05 on the reference machine, in throwaway homes under the session scratch directory
(`env -i`, `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointed there), no login and no model call:

- **Claude Code 2.1.289** (`claude -p --no-session-persistence --output-format stream-json --verbose
  --strict-mcp-config`): `init` lists the 8 agents in `agents`, the 12 skills in `skills`, and
  `autonomy` and `new-issue` in `slash_commands`. With `--agent <n>`, the session's tools are the
  agent's list intersected with the session's: `developer` and `tech-lead` get `Bash, Edit, Read,
  Write`; `quality-assurance` and `product-lead` get `Bash, Read, Write`; `scrum-master` gets none. The
  default session has no separate `Grep` or `Glob` tool on this version, so those names add nothing.
  `disallowedTools` in an agent's front matter removes the named tool (probe agent, `Write` excluded:
  `Read, Bash` against a control's `Read, Write, Bash`); this was measured with a built-in tool, and the
  MCP tool names in `product-lead`'s list were not exercised (no MCP server in the throwaway home).
- **Codex 0.160.0** (`codex debug prompt-input "hi"`): the 12 skills are in the model-visible skill list
  from `~/.agents/skills`; `autonomy` and `new-issue` are left out, as an implicit-off skill should be.
  Custom agents do not appear in this output (ADR-0027); listing them needs a model call, so they are
  **documented**, not measured. The suite parses each rendered agent file with `tomllib`.
- **Kiro CLI 2.27.1:** `kiro-cli agent list` and `kiro-cli agent validate --path <agent>.json` both stop
  at "You are not logged in". Every Kiro cell is **documented**
  ([Agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference.md),
  [Skills](https://kiro.dev/docs/skills.md)).
- **Tests:** `global/method/method_render_test.py` asserts, per rendered file, the stamp and, per agent
  and agent harness, the tool list. It was mutation-checked by breaking the renderer in a copy of the
  tree: 19 mutations (each agent harness losing an agent's tool list, its exclusions or the stamp, an
  explicit `[]` becoming absent, the read-only sandbox dropped, `--home` ignored, a source agent
  without `tools` accepted, the opt-in gate removed, Kiro auto-approval restored, the Codex MCP note
  dropped) all turned it red; the unmutated copy stayed green.
- **Windows:** no local PowerShell. `global/install.test.ps1` checks the rendered method (tool list,
  stamp, Codex policy file, Kiro tools, `-Check` clean) on the Windows CI jobs, which are the probe.

## Amendment 2026-10-05: `devops` split by capability (#97)

The ruling above moved `devops` **whole** to user level. It stays at user level; it is no longer whole.
The owner, on [#97](https://github.com/tedeuxx/mhw/issues/97):
*"pois ficaria melhor ajustado a densidade de cada skill"*, *"eu acho valido nomear por capability"*,
and *"talvez quality e quality-gates deveria virar 1 coisa so"*. The method's skill set is now **14**,
not the 12 in *What moved* (that table records the plugin snapshot and is unchanged):

| Capability skill | Selected tool | Took from `devops` |
| --- | --- | --- |
| `scm` | GitHub | branching per model, the PR-only path and the integration branch `rc/next`, merge commits only, the SemVer scheme and release flow, labels, the repository-settings standard, the permission floor for forge acts, the Claude Code GitHub App |
| `ci` | GitHub Actions | the workflow set, required checks and the `paths:` gotcha, OIDC roles, the secrets standard, pinned actions, the version and release workflows, the two Claude workflows |
| `quality-gates` (existing, merged) | SonarCloud | setup, analysis mode, the CI step, gate wiring, thresholds; red-gate diagnosis was added |
| `provisioning` | Terraform Cloud | remote state, the pipeline-only IaC floor, infra-first ordering, the runner-role deletion gotcha |

Each opens with a disclaimer naming the selected tool and keeps every tool-specific word in one closing
`## Tool section — <tool>`, so a tool switch replaces that section only. Preloads: `agents-lead` takes
`scm` and `ci`; `tech-lead`, `developer` and `quality-assurance` take `scm`, `ci` and `provisioning`.
No new record: this keeps the decision above (user level, one source, native carriers) and changes only
the cut of one skill.

**Evidence, measured 2026-10-05 in a throwaway home** (`install.sh --method --overlay=none`):
`METHOD installed: 8 agents, 14 skills, 2 commands`; Claude Code 2.1.289's headless `init` lists `scm`,
`ci`, `quality-gates` and `provisioning` in `skills` and no `devops`; `codex debug prompt-input` (Codex
0.160.0) lists the four from `~/.agents/skills` and no `devops`. Kiro is *documented*, not measured.
`global/method/method_render_test.py` gained `CapabilitySkills`, which fails when a capability skill
lacks the disclaimer, lacks exactly one closing tool section, or carries a tool word outside both; 11
mutations of the skill sources turned it red and the unmutated copy stayed green.

## Links

- [Requirements document, section 6](../mhw-product-requirements-document-project.md#6-working-method-user-layer)
  and [section 4a](../mhw-product-requirements-document-project.md#4a-hook-budget)
- [Native enforcement matrix](../native-enforcement-matrix.md)
- [`method/README.md`](../../method/README.md)
