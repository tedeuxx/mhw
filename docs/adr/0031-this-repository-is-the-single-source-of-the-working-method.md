# ADR-0031: This repository is the single source of the working method, rendered into each agent harness's native user-level carriers

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Builds on:** [ADR-0014](0014-purpose-boundary-firewall-vs-plugin.md),
  [ADR-0026](0026-four-distribution-layers-rubric.md),
  [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md),
  [ADR-0029](0029-provenance-stamp-in-every-installed-file.md)
- **Issue:** [#61](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/61)
  (part of [#52](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/52);
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
| Skills | 10 | agents-configuration, shell, documentation-standard, engineering-standards, definition-of-ready, definition-of-done (absorbs code-review), quality-gates, published-voice (absorbs content-publishing), devops, planning-poker |
| Commands | 2 | autonomy, new-issue |

Changes made in the move, and nothing else:

- `code-review` is a section of `definition-of-done`, and `content-publishing` a section of
  `published-voice`, each carried verbatim under a heading that says so. Preloads follow: `developer`
  preloads `definition-of-done`; the content agents preload `published-voice` only.
- `planning-poker`'s description says the agents use it to estimate; the body's reference-pattern
  paragraph is struck in place with the owner's ruling.
- `agents-configuration` gains one section: the plugin's session-start and end-of-turn hook checks, now
  as steps the agent runs (section 4a).
- `product-lead` loses the plugin-namespaced browser server from its tool list and keeps
  `mcp__chrome-devtools`.
- Sanitisation: a few passages were abstracted before they entered this repository (categories:
  employer identification, a grey-zone health reference, and an employer-tooling reference).
- Front matter is normalised: every item has `name`; scalars are quoted.

Not moved here: the site-stack skills (`backend`, `frontend`, `cloud-infrastructure`, #64); `/blueprint`
(#75) and the new commands (#71 to #74), each its own Issue; the sprint and funnel rites and session
commands, which section 6 leaves out of the set; every hook.

### Carrier map (user level)

| Component | Claude Code | Codex | Kiro |
| --- | --- | --- | --- |
| Agent | `~/.claude/agents/<n>.md`: `tools` (an explicit `[]` for none) and `skills` preloads | `${CODEX_HOME:-~/.codex}/agents/<n>.toml`, name with underscores; preloads and the tool list as an instruction; `sandbox_mode = "read-only"` when the agent is granted no writing tool | `~/.kiro/agents/<n>.json`: `tools` and `allowedTools` (the same list, so no prompt within purpose), preloaded skills as `file://` resources |
| Skill | `~/.claude/skills/<n>/SKILL.md` | `~/.agents/skills/<n>/SKILL.md` | `~/.kiro/skills/<n>/SKILL.md` |
| Command | `~/.claude/commands/<n>.md` | a skill in `~/.agents/skills/<n>/` with `agents/openai.yaml` `policy.allow_implicit_invocation: false`; invoked as `$<n>` | a skill in `~/.kiro/skills/<n>/`, a slash command in CLI and IDE |
| Stamp | a `#` comment in the YAML front matter | a `#` comment (TOML, YAML); front matter comment in `SKILL.md` | front matter comment in `SKILL.md`; the first line of the agent's `prompt` (JSON has no comment) |

Tool names map from Claude Code to Kiro tags: `Read`, `Grep`, `Glob` to `read`; `Write`, `Edit` to
`write`; `Bash` to `shell`; `mcp__<server>` to `@<server>`. A tool with no mapping stops the render.

**How it runs.** `install.sh` calls the renderer after its other targets, in every mode: install,
`--check` (`OK`, `STAMP`, `DRIFT`, `MISSING`, `STALE`), `--dry-run` and `--uninstall`, so
`./workstation install`, `check`, `status` and `uninstall` cover it. A file is ours only when its
managed-by line names `source: method/`; any other file in the way is refused and left untouched. A
rendered file whose source was deleted is `STALE` and removed on install.

## Consequences

- Good: one source for the method, edited here and rendered into all three agent harnesses; Kiro gets
  the agents for the first time.
- Good: least privilege per agent is native in Claude Code (measured) and Kiro (documented).
- Bad: **Codex agents carry no tool list.** The limit is an instruction, plus a read-only sandbox for
  `scrum-master`, the only agent granted no writing tool. Codex agents also have no preload field:
  they are told to load their skills by name.
- Bad: **Kiro is documented only.** `kiro-cli agent list` and `agent validate` need a login (measured).
  The tool tags are documented for Kiro IDE 1.x and CLI V3; on the CLI's default v2 engine they are
  assumed. Kiro command-skills cannot switch off implicit invocation; their description says to run
  them only when the owner types them.
- Bad: **the text still describes the plugin's machinery.** Briefs and skills name the plugin's hooks
  and scripts (`permission-guard.sh`, `inventory-counts.test.sh` and others) as present. Read such a
  passage as describing the plugin repository at the commit above; rewriting them is content work for
  later slices, not done here.
- Bad: the browser connector `product-lead` names is not defined by this step; its server definition
  is the MCP renderer's (ADR-0017).
- Bad: while the plugin stays enabled in Claude Code, its namespaced agents and skills sit beside these
  user-level ones, and its hooks still run, until #63 retires it.
- Bad: Windows (`install.ps1`) does not render the method yet.
- Bad: the rendered files are large (the method's source is about 1.0 MB of text (`cat method/agents/*.md method/skills/*/SKILL.md method/commands/*.md | wc -c`), rendered once per agent harness), and Kiro
  loads preloaded skills in full at agent start.

## Evidence

Measured 2026-10-05 on the reference machine, in throwaway homes under the session scratch directory
(`env -i`, `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointed there), no login and no model call:

- **Claude Code 2.1.289** (`claude -p --no-session-persistence --output-format stream-json --verbose
  --strict-mcp-config`): `init` lists the 8 agents in `agents`, the 10 skills in `skills`, and
  `autonomy` and `new-issue` in `slash_commands`. With `--agent <n>`, the session's tools are the
  agent's list intersected with the session's: `developer` and `tech-lead` get `Bash, Edit, Read,
  Write`; `quality-assurance` and `product-lead` get `Bash, Read, Write`; `scrum-master` gets none. The
  default session has no separate `Grep` or `Glob` tool on this version, so those names add nothing.
- **Codex 0.160.0** (`codex debug prompt-input "hi"`): the 10 skills are in the model-visible skill list
  from `~/.agents/skills`; `autonomy` and `new-issue` are left out, as an implicit-off skill should be.
  Custom agents do not appear in this output (ADR-0027); listing them needs a model call, so they are
  **documented**, not measured. The suite parses each rendered agent file with `tomllib`.
- **Kiro CLI 2.27.1:** `kiro-cli agent list` and `kiro-cli agent validate --path <agent>.json` both stop
  at "You are not logged in". Every Kiro cell is **documented**
  ([Agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference.md),
  [Skills](https://kiro.dev/docs/skills.md)).
- **Tests:** `global/method/method_render_test.py` asserts, per rendered file, the stamp and, per agent
  and agent harness, the tool list. It was mutation-checked by breaking the renderer in a copy of the
  tree: 13 mutations (each agent harness losing an agent's tool list or the stamp, an explicit `[]`
  becoming absent, the read-only sandbox dropped, a source agent without `tools` accepted) all turned
  it red; the unmutated copy stayed green.

## Links

- [Requirements document, section 6](../personal-multi-harness-workstation-configuration-product-requirements-document-project.md#6-working-method-user-layer)
  and [section 4a](../personal-multi-harness-workstation-configuration-product-requirements-document-project.md#4a-hook-budget)
- [Native enforcement matrix](../native-enforcement-matrix.md)
- [`method/README.md`](../../method/README.md)
