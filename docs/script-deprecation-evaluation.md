# Support script deprecation evaluation

A read-only evaluation of every support script this repository ships or runs, against the owner's
rule that no solution should depend on support scripts. Scripts are the exception, and each agent
harness's native mechanisms are the preferred anchor of behaviour
([#197 decision](https://github.com/tedeuxx/mhw/issues/197#issuecomment-6253156628)). For each script it
asks one question: can a native mechanism that works across Claude Code, Codex and Kiro replace it?

This is the deliverable of [#206](https://github.com/tedeuxx/mhw/issues/206). **No script is removed
here.** Each deprecation the owner accepts becomes its own slice.

- **Tree evaluated:** `rc/next` at `f76c0af01963748632cf7cfb5b8969bec16ee84c`, 2026-11-01.
- **Earlier pass:** a first evaluation, pinned to `v6.0.0`, is on the Issue. The owner accepted its
  four clean deprecations on 2026-10-18 and PR #208 removed them (see
  [What the first pass already removed](#what-the-first-pass-already-removed)). This document
  re-reads the current tree, including the scripts added since then.

## How to read it

**Evidence levels.** These follow the [native enforcement matrix](native-enforcement-matrix.md):

| Label | Meaning here |
| --- | --- |
| **measured** | Run or read on this tree today, with the command named in [Measurements](#measurements). |
| **documented** | Taken from vendor documentation. Not re-read today and not exercised on any agent harness build. |
| **cited** | Taken from an earlier record in this repository (the README or a script's header), with its date where known. It may have been measured then; it was not re-run today. |
| **assumed** | Neither measured nor documented. The reason is stated where it matters. |

Repository facts (which scripts exist, who calls them, what the deny floor lists) are **measured**. No
claim about a native mechanism was exercised on an agent harness build for this evaluation, so every
native cell is **documented**, **cited** or **assumed**, never stronger.

**Recommendations.** There are three, and the difference between the last two matters:

| Recommendation | Meaning |
| --- | --- |
| **deprecate** | A native mechanism on all three agent harnesses does the job, and little or nothing is lost. |
| **keep as the exception** | The script covers a gap that has no native carrier on at least one agent harness. It is the exception #197 allows. Re-evaluate it when a vendor ships the missing carrier ([Re-evaluation triggers](#re-evaluation-triggers)). |
| **keep** | The script does not compete with a native mechanism. It writes the native carriers from the versioned source, or it is the entry point or a shared helper of scripts that do. Removing it would remove the route by which policy reaches the native mechanism. |

**Hooks are not a native replacement** unless they meet the existential-risk rule of the global brief
("Hooks only for existential risk"). Only one script here is a hook body, and it meets that rule.

**Abbreviations:** CC = Claude Code, Cx = Codex, K = Kiro (CLI and IDE).

## Result

**35 scripts evaluated, one row each: 0 deprecate, 18 keep as the exception, 17 keep.** The 26 test
files are one grouped row at the end and are not counted in the 35.

No clean deprecation is left. The first pass found four, and they are already gone. Every remaining
script either writes the native carriers (keep) or covers a gap that at least one agent harness has no
native carrier for (keep as the exception).

## Who calls the scripts

Measured by searching the tree for each script's name, test files and decision records excluded.

- **CI:** `tests.yml` compiles every Python script and runs every test. `outbound-scan.yml` runs
  `mhw scan`. `method-issue-sync.yml` runs `.github/scripts/method_issue_sync.py`.
- **The installer:** `mhw` and `global/workstation.py` call `install.sh`, `install-managed.sh` and the
  renderers. `install.ps1` is the Windows route. `method_render.py` installs `method/scripts/*` and
  replaces `{{method-scripts}}` in rendered bodies with the installed directory.
- **Agent instructions:** the method's skills and commands call the method scripts (named per row).
  `AGENTS.md` and `workspace/README.md` call `workspace/delivery.py`.

## The evaluation

### Entry point and distribution

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `mhw` | POSIX entry point: checks for `python3`, then runs `global/workstation.py`. | The owner; `outbound-scan.yml`; `bin/mhw.js` on macOS and Linux. | None. CC `/status`, Cx `/status` and K `/context show` report the session, not the workstation (documented). | The one door to install, status, check, scan, update and uninstall. | **keep** |
| `bin/mhw.js` | The npm package's command: runs `./mhw`, or `install.ps1` on Windows. | npm, which links it onto `PATH`. | None. npm is a distribution channel, not an agent harness. | The npm install route ([ADR-0034](adr/0034-npm-distribution-from-github-by-tag.md)). | **keep** |
| `global/workstation.py` | The logic behind `mhw`: install, status (stamp, version key, drift), check, scan, update, uninstall. | `mhw`. | None. No agent harness compares installed configuration with a versioned source (assumed: no vendor documents one). | Status, drift report and version key. | **keep** |
| `bin/postinstall.js` | npm postinstall: repairs a dangling global install from a git dependency, then prints one next-step line. | npm. | None. It works around an npm defect (cited: measured earlier on npm 11.13.0 under Issue #68, 2026-10-06, per the script's header; not re-run today), not an agent harness gap. | A broken global install on affected npm versions. | **keep as the exception** |

### Rendering into each agent harness

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `global/install.sh` | Renders the brief, deny floor, hooks, overlay and other settings into each user layer, with owner-only backups. | `global/workstation.py`. | None. It writes the native carriers. No agent harness syncs user configuration from a versioned source (assumed). | Rendering, and so the whole source-to-machine contract. | **keep** |
| `global/install.ps1` | The Windows form of the installer. | `bin/mhw.js` on Windows. | None, as above. | The Windows route. | **keep** |
| `global/install-managed.sh` | Installs the admin (managed) layer: the floor no lower layer can override. | `mhw install --admin`. | The managed-settings files it writes are the native target (CC, Cx documented; K cited: the README records it as read from the installed Kiro bundle, not documented by the vendor). Nothing produces them from the policy. | The non-overridable floor. | **keep** |
| `global/allow-list.sh` | Merges the pre-authorisation allow list and removes retired allow entries. | `install.sh`. | The allow list is a native setting (CC documented). Nothing writes it from the policy. | The managed allow list. | **keep** |
| `global/private_copy.py` | Shared helper: every backup of an agent harness configuration is owner-only (0600). | `kiro_permissions.py`, `mcp_render.py`, `model_defaults.py`; a shell form in `install.sh`, also used by `allow-list.sh`; a PowerShell form (`Copy-Private`) in `install.ps1`. | Not applicable: a helper of other scripts. | Owner-only backups, which can hold configuration values. | **keep** |
| `global/profile/profile.py` | Renders the owner overlay (language, decision tone, limits) into the brief. | `install.sh`, `install.ps1`, CI. | None. The brief is a native carrier; nothing renders a profile into it. | The owner overlay. | **keep** |
| `global/kiro/kiro_permissions.py` | Merges the deny floor into Kiro `permissions.yaml` and the Kiro admin file. | `install.sh`, `install.ps1`, `install-managed.sh`. | The target file is native (K documented). Nothing produces it from the floor. | The Kiro floor. | **keep** |
| `global/models/model_defaults.py` | Pins each agent harness's model and effort, reports old to new, restores on uninstall. | `install.sh`, `install.ps1`. | The keys are native in all three (documented). Nothing sets them from policy. | Uniform session-start defaults and their restore. | **keep** |
| `global/method/method_render.py` | Renders `method/` into native agents, skills, commands and steering, and installs the method scripts. | `install.sh`, `install.ps1`. | A plugin, marketplace or Powers package is the native distribution (documented). [ADR-0032](adr/0032-this-repository-is-the-single-source-of-the-working-method.md) replaced the plugin with this renderer. | The method's only install route. | **keep** |

### MCP servers

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `global/mcp/mcp_render.py` | Renders the policy MCP servers into each agent harness, checking credential names. | `install.sh`, `workstation.py`. | Each agent harness's MCP configuration is the native target (documented). No cross-harness sync from one source (assumed). | One MCP definition for all agent harnesses ([ADR-0017](adr/0017-single-source-mcp-with-secret-indirection.md)). | **keep** |
| `global/mcp/mcp_active.py` | Turns off every MCP server outside the declared active set, through each agent harness's own switch. | `mcp_render.py --active` on every install, check and uninstall. | It writes the native switches: Cx `enabled = false`, CC `deniedMcpServers`, K `"disabled": true` (per the script; documented). The Claude desktop app has no per-server switch. | The active set ([ADR-0041](adr/0041-mcp-active-set-native-switch-off-per-harness.md)). | **keep** |
| `global/mcp/mcp_connect.py` | Opt-in probe: starts each active server as each agent harness would and reports whether it answers, never printing a value. | `mhw status --mcp-connect`. | Partial. CC `claude mcp list` reports server health (documented). K lists loaded servers with `/mcp` (documented). Cx `codex mcp list` lists configuration; a health check is not documented (assumed absent). | One uniform, value-free check across all three; the "needs login" distinction. | **keep as the exception** (gap: Cx) |
| `global/mcp/mcp-launch.sh` | Starts an MCP server with its secret read from the keychain. | MCP configuration rendered by `mcp_render.py`; `mcp_connect.py`. | MCP configuration expands environment variables (CC documented; Cx and K assumed). That reads the process environment, not the keychain. | Secrets never at rest in configuration or the shell environment. | **keep as the exception** (no native keychain read) |
| `global/chrome_debugging.py` | Sets Chrome's remote-debugging preference so the `chrome-devtools` server can attach, only when Chrome is not running. | `install.sh`, `workstation.py`. | None in any agent harness: it is a browser preference. The alternative is the owner's own click at `chrome://inspect`, which the owner chose to automate (#224). | The automatic setup the owner asked for. | **keep as the exception** |

### Confidentiality at input and output

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `global/clipboard/clipboard_guard.py` | The prompt hook body: blocks a prompt carrying an employer or client reference, a credential or personal data, and shows a redacted copy. Also stores salted term hashes. | The native prompt hook (CC `UserPromptSubmit`, Cx `hooks.json`), registered by `install.sh` and `install-managed.sh`. | The prompt hook itself is native on CC and Cx (documented) and meets the existential-risk rule. No agent harness filters prompt content natively (assumed). K IDE has no prompt hook (cited: README). | The safety net of the confidentiality floor ([ADR-0033](adr/0033-paste-cleaning-wrapper-primary-hook-safety-net.md)). | **keep as the exception** (gap: K) |
| `global/clipboard/paste_wrapper.py` | pty launcher that replaces sensitive content in a bracketed paste before the agent harness sees it. | Shell functions `install.sh` adds to the owner's shell start file. | None: no agent harness redacts a paste (assumed). Gaps: the K V3 engine does not enable bracketed paste (cited: the README records it as observed on 2026-10-11); desktop apps and the K IDE are not reached. | The primary cleaner of the confidentiality floor. | **keep as the exception** (gaps: K V3, IDEs, desktop apps) |
| `global/scan.py` | `mhw scan`: checks a branch's files and unpushed commits and prints file, line, category and length, never the text. | `workstation.py`; `outbound-scan.yml`; the global brief before every push. | Forge push protection covers secrets only (documented). Nothing native covers personal data or employer and client terms (assumed). | Outbound coverage beyond secrets. | **keep as the exception** |

### Checks and reports

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `global/prerequisites.py` | `mhw check --prerequisites`: tools and subscriptions present, authenticated, and repository merge settings matching the standard. | `workstation.py`. | CC `/doctor` (documented), CC only. None on Cx or K (assumed). | One report across tools and agent harnesses. | **keep** |
| `global/owner_actions.py` | Counts open `owner-action` Issues for `mhw status`, and says "not read" instead of a false 0. | `workstation.py`. | `gh issue list --label owner-action` (documented). That is the forge CLI, not an agent harness mechanism. | The false-0 guard. | **keep** |

### Delivery and CI

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `workspace/delivery.py` | Checked merge and verify: required runs at the head, a gate verdict and lens CLOSED at that exact head, a real merge commit; refuses a PR into `main` from anything but `rc/next`. | `AGENTS.md`, `workspace/README.md`. | Forge rulesets cover required checks and merge-commit-only (documented). A verdict pinned to the head has no native carrier (assumed). | The only head-scoped verdict check. The owner kept it out of #197's scope. | **keep as the exception** |
| `.github/scripts/method_issue_sync.py` | The narrow GitHub boundary for the CI agent that mirrors `method` Issues. | `method-issue-sync.yml`. | The action's tool allow list is native; it cannot limit writes to one Issue (assumed). | Confinement of the sync agent to its twin Issue. | **keep as the exception** (CI) |

### Method scripts

All are installed by `method_render.py` and called through `{{method-scripts}}` from the method's
skills and commands.

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `method/scripts/milestone_common.py` | Shared code of the milestone family. | The four milestone scripts. | Follows the family. | Follows the family. | **keep as the exception** |
| `method/scripts/milestone-read.py` | Reads a milestone by number: state, description, open and closed counts. | `sprint-planning`, `sprint-retrospective`, `agents-configuration`. | `gh` has no milestone subcommand (measured). A GitHub MCP server configured natively could read it (configuration documented; its milestone tools assumed). | The reviewed milestone route. | **keep as the exception** |
| `method/scripts/milestone-create.py` | Creates a milestone. | `sprint-planning`, `agents-configuration`. | `gh` has no milestone subcommand (measured), and raw `gh api` writes are denied by the deny floor (measured). A GitHub MCP server could write it (configuration documented; its milestone tools assumed; see hypothesis 1). | The reviewed milestone route. | **keep as the exception** |
| `method/scripts/milestone-update.py` | Updates a milestone description from a file, refusing a value already stale. | `sprint-planning`, `agents-configuration`. | Same as `milestone-create.py`. | The reviewed milestone route and its stale-value refusal. | **keep as the exception** |
| `method/scripts/milestone-close.py` | Closes an open milestone. | `sprint-planning`, `sprint-retrospective`, `agents-configuration`. | Same as `milestone-create.py`. | The reviewed milestone route. | **keep as the exception** |
| `method/scripts/confine.py` | Shared helper: refuses an input path outside the work tree or the temporary directory, for content that gets published. | `milestone_common.py`, `worklog.py`, `launch-line.py`. | Not applicable: a helper of other scripts. | Path confinement of published content. | **keep** |
| `method/scripts/worklog.py` | Validates worklog events and produces a deterministic report. | `autonomy`, `sprint-planning`, `agents-configuration`. | Native usage reporting (CC and Cx tokens, K credits; documented) is a different instrument. | A computed, not generated, report. | **keep as the exception** |
| `method/scripts/rite-cadence.py` | Dates a rite by the commits that added its ran-marker. | `agents-configuration` (session check 3), `funnel-review`. | A plain `git log` dates scaffolding too (the #128 defect). | Marker-correct dating. | **keep as the exception** |
| `method/scripts/funnel-review.sh` | Deterministic report over a committed funnel collection file. | `funnel-review`. | The model composing the report from the skill (assumed): numbers would be generated, not computed. | Computed numbers. | **keep as the exception** |
| `method/scripts/launch-line.py` | Prints the one paste-ready command that opens a fresh session with a prompt, quoted for a POSIX shell. | `handoff` command (#198). | Each CLI accepts a starting prompt as an argument (`claude`, `codex`, `kiro-cli chat`; documented). Quoting a multi-line prompt safely is left to the model (assumed unreliable). | Deterministic quoting, so a pasted prompt stays one command. | **keep as the exception** |

### Tests

| Script | What it does | Called by | Native multi-harness replacement (evidence) | Lost if removed | Recommendation |
| --- | --- | --- | --- | --- | --- |
| The 26 test files (`*_test.py`, `*.test.py`, `*.test.sh`, `install.test.ps1`, `keychain_test_guard.py`, `security.test.stub`) | Exercise each script and its install in throwaway homes. | `tests.yml`. | Not applicable: they check scripts; they anchor no agent behaviour. | The regression suite. A test leaves with the script it tests. | **keep** |

## What the first pass already removed

The `v6.0.0` pass found four clean deprecations. The owner accepted all four on 2026-10-18 ("Os 4
agora"), and PR #208 removed them into `rc/next`. None of them is in the tree evaluated here
(measured):

- `bin/workstation.js` and the root `workstation` alias: removed; use `mhw`.
- `global/github-repo-settings.sh`: replaced by `gh repo view --json …` and `gh repo edit`.
- `global/method/plugin_retire.py`: removed; the plugin is disabled through the agent harness itself.
- `global/mcp/mcp_retire.py`: removed; a leftover `aws-api` table is removed by hand.

## Re-evaluation triggers

Each "keep as the exception" row would become a deprecation candidate if a vendor shipped the missing
carrier. The change to watch for:

| Script | What would make it replaceable |
| --- | --- |
| `bin/postinstall.js` | npm fixes the dangling global install from a git dependency. |
| `mcp_connect.py` | Codex gains a native MCP health check, so all three report health. |
| `mcp-launch.sh` | MCP configuration reads a secret from the OS keychain natively, on all three. |
| `chrome_debugging.py` | The `chrome-devtools` server no longer needs the preference, or the owner prefers his own click. |
| `clipboard_guard.py`, `paste_wrapper.py` | Native prompt-content filtering on all three, including the Kiro IDE and the Kiro V3 engine. |
| `scan.py` | Forge or agent harness outbound scanning that covers personal data and owner-defined terms. |
| `delivery.py` | A forge rule that requires a verdict pinned to the head before merge. |
| `method_issue_sync.py` | A CI agent allow list that can limit writes to one Issue. |
| Milestone family | A `gh milestone` subcommand, or a GitHub MCP server the deny floor can see (see hypothesis 1). |
| `worklog.py`, `rite-cadence.py`, `funnel-review.sh`, `launch-line.py` | No native mechanism is in view; these compute results the model would otherwise generate. |

## Not checked

- **No native claim was exercised.** Every documented cell comes from vendor documentation as known,
  not re-read today and not run on any agent harness build.
- **Hypothesis 1, carried from the first pass.** Moving milestone writes to a GitHub MCP server would
  put GitHub writes on a channel the prefix deny floor does not see: the floor denies `gh api` write
  methods by prefix, and an MCP tool call is not a shell command. This would remove a control silently.
  To settle it: list that server's tools, then probe one deny per agent harness.
- **Hypothesis 2, carried from the first pass.** `git log -S'<marker>'` cannot replace
  `rite-cadence.py`, because `-S` matches a marker added or removed. To settle it: run it against the
  `rite-cadence.test.py` fixtures.
- **Codex MCP health.** Whether `codex mcp list`, or any Codex command, reports server health was not
  checked. It decides `mcp_connect.py`.
- **Replicator installs.** Whether other people's installs still carry what the first pass removed was
  not checked. By the owner's decision of 2026-10-18, the next release-candidate pull request tells a
  replicator to run `mhw status` and clean up by hand.

## Measurements

Run on `rc/next` at `f76c0af01963748632cf7cfb5b8969bec16ee84c`:

- Script inventory: `git ls-files`, filtered to `.py`, `.sh`, `.ps1`, `.js` and the extension-less
  `mhw`, then split into the 35 scripts and 26 test files.
- Callers: a fixed-string search of the tree for each script's full file name, test files and
  `docs/adr/` excluded, then a check that each named caller file contains that name. A mention in a
  comment is not a call. (The first version of this document searched the milestone family by the
  prefix `milestone-`, which matched files that call none of them; the gate caught it and the four
  rows were corrected.)
- `gh milestone --help` prints `unknown command "milestone" for "gh"`.
- `global/deny-floor.conf` lists `gh api -X POST|PUT|PATCH|DELETE` and the `--method` forms.
- `global/install.sh` registers the paste filter as a Claude Code `UserPromptSubmit` entry and in the
  Codex `hooks.json`.
- `global/method/method_render.py` replaces `{{method-scripts}}` with the installed scripts directory.
