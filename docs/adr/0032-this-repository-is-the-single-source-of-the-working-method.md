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
all three agent harnesses, and later regenerates the plugin from here ~~(#62)~~. *(Struck 2026-10-12,
#63: #62 became the Issue sync; the weekly tadeumendonca-skills sprint regenerates the plugin.)*

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
   descriptions (see Consequences); and the plugin stays a second copy until ~~#62~~ *(struck 2026-10-12,
   #63: the weekly tadeumendonca-skills sprint)* regenerates it.
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

## Amendment 2026-10-12: the plugin is fed by backlog sync, not by a file mirror (#62)

Status unchanged (proposed). The context above says the plan later regenerates the plugin from here
(#62), and
the first build of #62 (PR #158, closed) packaged `method/` in CI and pushed it to
`tadeumendonca-skills` on each release. The owner redirected it on 2026-10-12 (his words, translated,
recorded on #62): *"Demands made in mhw need to be adapted to the plugin's format"*, *"the only
expectation was to reflect Issues in the skills repo and, periodically (once a week), run the sprint and
generate the updated mirrored version"*, *"What matters is not losing the synchronism of
Issues/backlog"*. He agreed ("de acordo") to the mechanism below the same day.

**Decision.** What crosses from this repository to the plugin is the **backlog**, not files:

- A method demand is an mhw Issue labelled `method`. `.github/workflows/method-issue-sync.yml` reflects
  it as a twin Issue in `tadeumendonca-skills`, adapted to the plugin's format (which carriers change:
  agents, skills, commands, manifests, powers, hooks; and the acceptance criteria), with a hidden marker
  `<!-- mhw-issue: tedeuxx/mhw#N -->` and a link back. Edits, close and reopen follow; the mhw Issue
  gets the twin's link once. Runbook: [`docs/runbooks/method-issue-sync.md`](../runbooks/method-issue-sync.md).
- **The adaptation to plugin files is done by the -skills sprint**, which is weekly and scheduled later.
  Nothing in this repository writes plugin files. Until that sprint runs, `method/` here and the plugin
  can diverge; the twins are the record of what is owed. *(Amended 2026-10-12, #63: that sprint
  regenerates the plugin from `method/` here; it does not author the method there. See the amendment of
  that date on #63.)*

**New third-party action.** `anthropics/claude-code-action`, pinned by commit (v1.0.248, the commit `v1`
points at, verified with `git ls-remote` on 2026-10-12), joins `actions/create-github-app-token`
(v3.2.0, likewise pinned). It is the first model-running dependency in this repository's CI. Its blast
radius is bounded outside the model: the agent's only shell is `.github/scripts/method_issue_sync.py`,
which writes only to the twin, meaning the App-authored Issue carrying the marker (-skills is public, so
a marked Issue opened by anyone else is ignored and named in a warning, never edited), only from files
in the run's scratch directory, and refuses credential-shaped text and any 12-character run of a token
the run holds; it has no file-reading tools, and project settings are not loaded (read from the action's
source, `--setting-sources user`; not measured on a runner). The mhw
Issue's text is declared data, not instructions, in the prompt; that clause is an instruction to a model,
not a control.

**Cross-repository credential.** The GitHub App `tedeuxx-mhw-mirror`, now with Issues read/write and
Metadata read only, installed only on `tadeumendonca-skills`. Its token is minted per job, scoped to that
one repository and to `issues` (write in the sync job, read in the back-link job), and revoked when the
job ends. The model credential is `CLAUDE_CODE_OAUTH_TOKEN`, the owner's subscription, as in the other
two repositories; each run spends it. A PAT and archiving -skills without a mirror were rejected on
2026-10-11 and stay rejected.

**Rejected:** the CI file mirror (PR #158). It kept the files byte-identical but skipped the adaptation
the owner wants, and gave the CI write access to the plugin's contents.

**Evidence, 2026-10-12.** Written and tested: `.github/scripts/method_issue_sync_test.py` checks the
workflow's structure (parsed with the runner's ruby) and drives the script against a stub `gh`. After the
agent, a deterministic `verify` step fails the run unless the twin exists in the mhw Issue's state.
~~**Not run:**~~
~~no secret is stored yet, and~~ GitHub runs this workflow only from `main`. *(Struck 2026-10-12: it ran
once. The first canary, run 38269161317 on mhw#162 at v5.5.0, failed in the sync job before any write
because bubblewrap was missing; no twin was created. The fix, #163, is written and tested and its isolation recipe is measured on a PR runner (`isolation-smoke` in `tests.yml` passed on #163, run 38273021598); it has
not run on `main`.)* *(Struck 2026-10-12: the
three secrets were stored that day, 13:43Z, per `gh secret list --repo tedeuxx/mhw`.)* The App's author login
(`app/tedeuxx-mhw-mirror`) is a hypothesis the canary confirms. *(Added 2026-10-12: a second canary,
run 38294048591 on v5.5.1, failed before any write; the likely cause is that the subprocess env scrub
drops secret-shaped env names, the two token names included (read from the 2.1.296 bundle and measured
locally on that version; on the runner it is inferred, the tool output was not printed). #165, written and tested and not run on `main`, hands the script its inputs as 0600 files
outside the agent's Write directory; the scrub stays on.)* *(Added 2026-10-12: a third canary, run
38307434605 on v5.5.2, got the inputs through and failed at the body write: the Write tool was denied
(observed). Claude Code matches file writes against `Edit(path)` rules only, so the `Write(path)` rule
granted nothing (measured locally on 2.1.296; inferred on the runner). #167, written and tested and not
run on `main`, grants the directory with an `Edit(path)` rule and keeps the Edit tool disallowed.)*

## Amendment 2026-10-12: the workstation is the single source; the plugin is a generated distribution nobody installs (#63)

Status unchanged (proposed). The owner, 2026-10-12, recorded on #63: *"a ideia é que ninguem use o skills
depois de migrar para o mhw"*, confirmed ("siga") after the orchestrator restated it. An earlier comment
on #63 the same day framed the choice as the plugin's files staying authored in tadeumendonca-skills;
that framing was withdrawn.

**Decision.**

- **The workstation is the single source of the method**: `method/` here, installed with
  `mhw install --method`. #130 then removes the plugin from the workstation.
- **The plugin is a generated distribution that nobody installs.** tadeumendonca-skills becomes a mirror:
  it receives method Issues through the sync, and a weekly sprint there regenerates the mirrored version
  from `method/` here. Scheduling that sprint is later work.
- **Demands enter as mhw Issues labelled `method`**, mirrored to tadeumendonca-skills as twin Issues by
  `.github/workflows/method-issue-sync.yml` (the amendment of this date on #62).
- tadeumendonca-skills carries a deprecation notice in its README and AGENTS.md and an ADR there pointing
  here. Its duplicate protections are removed only after the deny-floor slice ships, as #63 states.

**Not changed by this amendment.** The installer and the opt-in passages above (*Carrier map*,
`method/README.md`) are the next slice, with #130.

**Evidence, 2026-10-12.** The sync works end to end on `main` (v5.5.3), *measured*: canary 4 on mhw#162.
Run 38324740491 created the twin tadeumendonca-skills#564, authored by `app/tedeuxx-mhw-mirror` (the
login `TWIN_AUTHOR` assumed, now confirmed), `verify` passed (OPEN) and the back-link was posted by
`github-actions`. Run 38324871241, on closing mhw#162, closed the twin, `verify` passed (CLOSED) and the
back-link was not posted again. The weekly regeneration does not exist yet.

## Amendment 2026-10-12: the four rites move into `method/` before #130 (#130)

Status unchanged (proposed). *What moved* above left the sprint and funnel rites out of the set, while
the method's own briefs (`scrum-master`, `autonomy`, `agents-configuration` and others) kept pointing to
them, so uninstalling the plugin (#130) would have left those pointers naming commands that no longer
exist on the workstation. The owner, 2026-10-12, recorded on
[#130](https://github.com/tedeuxx/mhw/issues/130#issuecomment-6136293979), chose **"Mover para o
method/"** over retiring them or postponing #130, and made two preconditions of #130: the four rites
in `method/`, and the root-brief rename to `AGENTS.md` (ADR-0037) applied across `method/`.

- **Moved:** `sprint-planning`, `sprint-review`, `sprint-retrospective` and `funnel-review`, from the
  plugin's `commands/` at its `main` commit `4882b911`, into `method/commands/`. They render like every
  other command: Claude Code commands, Codex skills with implicit invocation off, Kiro skills. The
  method now holds 11 commands.
- **Adapted as at seeding, and nothing else:** the method's front-matter shape (`name`, `description`,
  `purpose`, `argument-hint`, quoted); the retired-plugin-hooks note at the top; the plugin's namespaced
  invocations (`/tadeumendonca-skills:<name>`) made bare in `autonomy` (the rite bodies carried none). Their
  text is otherwise the plugin's, including the plugin-hook descriptions the note qualifies.
- **Their scripts moved with them** (the lens and the gate on #170): the `milestone-*` family with
  `milestone_common.py`, `worklog.py`, and `funnel-review.sh`, from the plugin's `scripts/` at the same
  commit, into `method/scripts/` with their tests and fixtures (and the worklog contract the worklog test
  reads, in `method/scripts/worklog-contract/`). The render installs the scripts, never a test, to one
  user-level directory for every agent harness,
  `${XDG_DATA_HOME:-~/.local/share}/personal-multi-harness-workstation-configuration/method/scripts/`, with
  the managed-by line after the shebang; `{{method-scripts}}` in a rendered body becomes that directory, so
  a rite runs them from any repository, ~~and a `{{method-scripts}}/<name>` naming no script stops the
  render~~ *(struck 2026-10-16, #181: a name that resolves to a document one directory down is installed
  instead; see the amendment of that date)*. Adapted: `funnel-review.sh` defaults its root to the working directory's repository instead of
  its own place, and its test drops the two arms that fired the plugin's `cadence-notice` hook, which the
  method does not carry. Where these scripts first met a SonarCloud gate (the gate on #170, N1): a new
  `confine.py` resolves a path and refuses one outside the current work tree or the temporary directory,
  and `milestone_common.text_from_file` (a description is published) and `worklog.load` (what it loads
  becomes a published comment) read only through it; `milestone_common` validates the repository as
  `<owner>/<repo>` and the number as a positive integer before any `gh` call; the worklog's private-path
  regex carries a reasoned `NOSONAR` (it refuses `/tmp/`, it opens nothing); the render installs the
  scripts `0700`. Each has a test. Not moved: the worklog contract's place in a consuming repository
  (`docs/worklog/`), which the rites still name.
- **The rename:** every reference in `method/` to a project's root brief now names `AGENTS.md`;
  harness-path class lists, dated measurements and history keep the vendor-named file where it is a
  fact about a path or the past.

## Amendment 2026-10-13: the installer retires the plugin with the method (#130)

Status unchanged (proposed). #130 was an owner action, *uninstall the plugin*, with three preconditions:
the method installed, `mhw status` naming the DUPLICATE, and the deprecation shipped in
tadeumendonca-skills. Since this amendment the uninstall is installer work, in the method's own step.

- ~~**`mhw install --method` retires the plugin at user scope**~~ *(removed 2026-10-18, see that
  amendment)* (`global/method/plugin_retire.py`), right
  after the method renders and never after a failed render, so a session is not left with neither copy:
  Claude Code's `enabledPlugins` entry and the marketplace's `extraKnownMarketplaces` entry in
  `~/.claude/settings.json`, the plugin's scope `user` install records, and its marketplace once no
  record of any scope still uses it; Codex's `[plugins."tadeumendonca-skills@…"]` and
  `[marketplaces.…]` tables, verified with `tomllib`. Each changed file is first copied to
  `<file>.pmhwc-plugin-backup` (0600), and each change prints as old -> absent.
- **Project scopes are reported, never touched**: a scope `project` install record, or a project's own
  `.claude/settings.json`, changes through that repository's pull request.
- **Not `claude plugin uninstall` / `codex plugin remove`**, though those are the native mechanisms: both
  also delete the plugin's cache, which an offline `mhw uninstall` could not bring back. The script edits
  the records those CLIs write; the cache directories stay, unused.
- **`mhw uninstall` restores** what install removed, from those backups, and nothing else; it is
  idempotent. Windows (`install.ps1 -Method`) runs the same step; it has no uninstall, so the backups
  are the restore route there.
- **`mhw status`** keeps its method line: DUPLICATE while the plugin is enabled in the user settings, the
  workspace's settings or Codex, none after.

**The opt-in stays, and the passage above is not struck.** Making the method default-on would let a
routine `mhw install` or `mhw update` retire the plugin; the cutover stays the owner's deliberate act,
`mhw install --method` in a fresh session (ADR-0022), as #130 frames it. The rites and their scripts
(#170, the amendment above) are on `rc/next`; they reach `main` with the release candidate,
which must carry both before that act. Turning `--method` on
by default is a one-line change once the canary has passed.

## Amendment 2026-10-15: the method owns the review route, the loop-mode contract and the ask rules (#176)

Status unchanged (proposed). At 5.6.0 the method treated three blocks of a consuming project's root
brief as canonical: the review-chain routing table, the loop-mode contract (`<!-- loop-mode-contract
-->`) and *How to ask*. `autonomy` also pointed at a `<!-- hitl-escalation-format -->` delimiter that
no root brief carries any more. Neither `AGENTS.md` nor `global/AGENTS.md` here carries that content, so
a project removing its blocks would have left pointers that fail when followed. The owner ruled on
tadeumendonca-io#715 on 2026-10-13: *"Mover pro mhw"*.

**Decision.**

- **A new skill, `method/skills/orchestration/SKILL.md`, is the only canonical home** of the three
  rules. It has three sections: *Review is routed by type*, *The loop-mode contract* and *How to ask the
  owner*. It is written with generic placeholders and names no consuming project. Each project keeps
  its mode record in `docs/loop-mode.md`; the contract wins over a record that disagrees with it.
- **Every pointer is repointed** to it: `autonomy`, `funnel-review`, `sprint-planning`, `new-issue`,
  `scrum-master` and `agents-configuration`.
- **Preloads:** `scrum-master` (it holds no tool, so it cannot open a skill on demand) and
  `agents-lead` (the `loop` row is its own lens). The method's skill count is 15.

**Why a separate skill and not a section of `agents-configuration`.** The rules are applied by the main
session, and a skill body does not reach a main session on its own: the main session sees the name and
description and loads the body when it chooses (measured for a skill body on Claude Code 2.1.263 in the
plugin's #409). `agents-configuration` is the largest skill in the set; a small skill with a sharp
description is what a main session can afford to load before every review dispatch, pool query and ask.

**Rejected:** the user-level brief, `global/AGENTS.md`. It does reach every main session natively on all
three agent harnesses, but it is the firewall (ADR-0014) and is loaded in every project, including ones
that do not run this loop. Its *Escalating to the owner* rules stay where they are, as the floor; the
skill's ask rules agree with them and add the interview rule and the list rule.

**Consequences.**

- Good: a consuming project can delete the three blocks without leaving a dangling method pointer.
- Good: one wording per rule, in the source every project installs.
- Bad: **reachability gets weaker for the main session.** A root brief loads with every session; the
  skill is loaded only when the main session follows its description, which is an instruction and
  not a load the agent harness performs. A project may keep a one-line pointer to the skill in its
  root brief. Restating the rules there would bring back the drift this move removes.
- Bad: until the owner installs a release carrying this skill, a project that has already deleted its
  blocks has neither copy on the reference machine.

**Evidence, 2026-10-15.** *Written and tested.* `global/method/method_render_test.py` gained
`OrchestrationOwnsTheBlocks`. It fails when any file under `method/` names one of the three block
markers, when a routing row, a contract untouchable or one of the five ask rules is missing, when the
skill names a consuming project, when either preload is dropped, or when the description loses the
trigger clause that is the main session's only route to the skill. The pointers are checked one by one:
each of the eleven pointer sites this change wrote, across six files (ten repointed from a root brief,
and one in `new-issue.md` that it added), is found by stable text of its own paragraph,
and the test fails when that paragraph, struck spans removed, no longer names the skill and the section,
or when the named section is missing from the skill. A second check fails when any file under `method/`
keeps one of the pre-move root-brief phrasings outside a struck span. A pointer written anywhere else, in
new wording, is not checked. 13 mutations of the subject files turned it red, and the unmutated copy
stayed green; a review round then found a per-file check that stayed green when one of a file's two
pointers went back to the root brief, and 7 further mutations, those two included, turned the per-pointer
checks red and recovered on restore. A second round found the eleventh site, `funnel-review.md`'s
precedence sentence, missing from the list, so rewording it back to the root brief stayed green; with
it added, 3 further mutations of that sentence turned the per-pointer check red and recovered on restore.
Rendered into a throwaway home: `METHOD  installed: 8 agents, 15 skills, 11 commands`. Claude Code
2.1.301's headless `init`, run in that home, lists `orchestration` in `skills` (*measured*). Codex was
not on this machine's path, so its listing from `~/.agents/skills` is *documented* (measured for the
other skills on 0.160.0, above). Kiro is *documented*. Nothing is installed on the reference machine.

## Amendment 2026-10-16: a rite's store contract is installed beside the scripts (#181)

Status unchanged (proposed). Refs [#181](https://github.com/tedeuxx/mhw/issues/181),
[PR #183](https://github.com/tedeuxx/mhw/pull/183). The 2026-10-12 amendment said the render installs
the scripts and that a `{{method-scripts}}/<name>` naming no script stops the render. `funnel-review`
writes its store against a contract, `method/scripts/funnel-review-contract/README.md`, and the rite
named that contract by a path relative to this repository's checkout. A session in a consuming
repository cannot resolve that path, so the installed rite could not reach the contract its own driver
writes against.

**Decision.** `{{method-scripts}}/<name>` resolves to one of two kinds of file:

- **A script** at `method/scripts/<name>`, installed as before.
- **A Markdown document** at `method/scripts/<dir>/<name>.md`, exactly one directory down. It is
  installed beside the scripts, at `<scripts>/<dir>/<name>.md`, **when, and only when, a rendered body
  names it** as `{{method-scripts}}/<dir>/<name>.md`. It is installed non-executable (the `0700` chmod
  stays scoped to scripts), with the managed-by line as an HTML comment on line 1 and the source body
  unchanged below it. A document no body names stays source-only: `method/scripts/worklog-contract/`,
  whose only reader is a test in the source tree, is not installed.
- **Any other name still stops the render**, with nothing written: a name matching neither a script nor
  a named document, a deeper path, a hidden directory, a `..` segment, or a document that is a symbolic
  link or sits in a directory that is one. Such a document is not loaded, so the body naming it fails
  as naming no file; the parent directory is checked because the `*/*.md` glob follows a symlinked
  directory.
- **Uninstall and `--mode=check` STALE detection see the document** (`candidate_files` reads
  `<scripts>/*/*.md`), and touch only files carrying this method's managed-by line. An emptied
  document directory is pruned on uninstall.

**Why.** An installed rite must reach the store contract its driver writes against, from any
repository. Installing the document through the token the rite already uses keeps one path rule for
everything a rite runs or reads, and installing only what a body names keeps the installed set derived
from the bodies rather than from a list.

**Rejected:** keep the contract in the source and name the checkout path. It costs nothing to render,
but every consuming session reads a path that does not exist on its machine. **Rejected:** install
every document under `method/scripts/`. It needs no naming rule, but it ships files no installed rite
reads, the worklog contract among them.

**Consequences.**

- Good: the rendered `funnel-review` names an installed path that exists, on Claude Code, Codex and Kiro.
- Good: a future rite can ship a contract by naming it, with no renderer change.
- Bad: the scripts directory now holds a second class of file, and a document's name is a rendered
  path, so renaming one is a change to every body that names it.
- Bad, on the transition: uninstalling with a v5.7.0 renderer leaves the contract file behind, because
  that renderer's `candidate_files` does not look one directory down; the file is inert and stamped,
  and the next install or uninstall with a renderer carrying this amendment removes it.

**Evidence, 2026-10-16.** *Written and tested.* `global/method/method_render_test.py`'s
`test_the_store_contract_ships_with_the_installed_rite` fails when the funnel-review contract is not
installed, not stamped, or not byte-identical to its source below the marker, when the worklog
contract is installed, or when a rendered carrier names a path that does not exist;
`global/method/method_commands_test.py` checks every rendered path into the scripts directory, one
directory deep included. Mutations of `method_render.py` (no document emitted, no `*/*.md` in
`candidate_files`, an unstamped document, every document installed) each turned a suite red and
recovered on restore. `test_the_installed_document_is_not_executable` fails when the installed
document carries any execute bit (calibrated by making `method_render.py` chmod documents `0700`), and
`test_a_document_through_a_symbolic_link_stops_the_render` fails when a named document that is a
symbolic link, or sits in a symlinked directory, is installed (calibrated by removing each of the two
checks in `load_documents`, one at a time; each turned only its own case red). Not run on Windows.
Nothing is installed on the reference machine.

## Amendment 2026-10-18: the plugin retirement step is removed (Issue #206)

Status unchanged (proposed). The owner's decision on Issue #206 (*"Os 4 agora"*) removes
`global/method/plugin_retire.py`, its suite and its call in `install.sh` and `install.ps1`. The 2026-10-13
amendment above was a one-shot migration for the cutover, and #130 is closed.

- **What install does now.** `mhw install --method` renders the method and does not read or edit any
  plugin record. `mhw status` still names a plugin left enabled beside the method (the `DUPLICATE`
  state), which is how a replicator finds one. Disabling it is the agent harness's own act: Claude Code
  `/plugin`, the Codex plugin commands, or the Kiro Powers panel.
- **What is lost.** Uninstall no longer restores a plugin an earlier install retired. A
  `<file>.pmhwc-plugin-backup` left by such an install stays on disk and is the way back by hand.
- **Evidence.** On the reference machine the plugin is not enabled in the Claude Code user settings
  (the owner's read-only check on #206). Replicator installs were not checked; the release notes ask
  them to run `mhw status`.

## Amendment 2026-10-26: a renamed command keeps its old name for one release

Status unchanged (proposed). The owner, 2026-10-26: *"-idea- deveria ser renomeado para -prd em todos
comandos com esse termo"* (every command whose name carries "idea" carries "prd" instead). Two commands
carried it: `new-idea` becomes `new-prd` and `idea-to-issues` becomes `prd-to-issues`. PRD (product
requirements document) is the document both write or read; its filename pattern,
`docs/<repo>-product-requirements-document-<subject>.md`, carries no command name and is unchanged.

**Decision.** A command's front matter may list `deprecated-aliases`, its old names. The renderer
renders each alias as a command of its own in every carrier: a Claude Code command file, a Codex skill
with implicit invocation off, a Kiro skill. The alias carries the command's whole body, a description
that opens *"Deprecated name of <new>, kept for one release."*, and a preface telling the agent to name
the new spelling to the owner once. Its provenance stamp names the current command's source file. An
alias that collides with a skill, a command, an agent or another alias stops the render, with nothing
written. Dropping an alias from the source makes `--mode=check` report its rendered files `STALE` and
the next install remove them, through the existing stale path.

**Why.** Nothing the owner types stops working with the rename, which follows the precedent of the
`workstation` command kept as a deprecated alias of `mhw` (ADR-0034, 2026-10-06 amendment, removed
2026-10-18). Rendering a second command is the only route that reaches all three agent harnesses:
none of their user-level command carriers has a field this renderer can set to give one file a second
name. That is *documented* at best and **not measured** in any of the three: no build was searched
for an alias field and none was exercised.

**Rejected:** rename with no alias. It costs nothing to render, but every old spelling stops working
at once, which is a breaking change for the owner's typing habit, cut as major. **Rejected:** an alias
whose body only says "run `new-prd`". It is shorter, but whether one command can invoke another differs
per agent harness and was not measured, so the alias could run nothing.

**Consequences.**

- Good: `/new-idea`, `$new-idea` and their Kiro form keep running the same steps for one release, and
  the agent tells the owner the new name.
- Good: the next rename uses the same field, with no renderer change.
- Bad: for one release each old name is a second full copy in every carrier, so a harness command list
  shows both names, distinguished only by the description.
- Bad: removing an alias is a breaking change (major), and nothing schedules it: the next release that
  drops `deprecated-aliases` from the two files does it. The `workstation` precedent shipped one major
  later than its own note said.

**Evidence, 2026-10-26.** *Written and tested.* `global/method/method_render_test.py`:
`test_the_deprecated_aliases` (the declared set, and no command name still carrying "idea"),
`test_a_deprecated_alias_renders_the_command_under_its_old_name`, `test_a_colliding_alias_stops_the_render`
and `test_a_dropped_alias_is_removed_on_the_next_install`; `global/method/method_commands_test.py`:
`test_deprecated_names_still_run_the_whole_command`. Seven mutations of the source (no alias emitted,
no deprecation note, the body dropped, the collision check off, the description unmarked, the alias
undeclared, the alias misspelled) each turned at least one suite red, and both recovered on restore.
Not run on Windows. Nothing is installed on the reference machine, and no agent harness was observed
listing or running an alias.

## Links

- [Requirements document, section 6](../mhw-product-requirements-document-project.md#6-working-method-user-layer)
  and [section 4a](../mhw-product-requirements-document-project.md#4a-hook-budget)
- [Native enforcement matrix](../native-enforcement-matrix.md)
- [`method/README.md`](../../method/README.md)
