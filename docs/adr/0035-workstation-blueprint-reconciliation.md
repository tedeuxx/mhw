# ADR-0035: Reconcile the workstation harness blueprint item by item

- **Status:** proposed
- **Date:** 2026-10-10
- **Deciders:** the owner (each decision below, 2026-10-10, in the reconciliation interview); written
  by tech-lead
- **Issues:** none (owner request in session, 2026-10-10)

## Context and problem

On 2026-10-10 the owner pasted a zero-identity "workstation harness blueprint" into a session in this
repository. It carries a target configuration and a reconciliation-interview procedure. By its own account (the
pasted blueprint's text, not verified here), it comes from his own method layer on another workstation
of his. It names no person, employer or client.

The agent ran the interview in three phases:

1. **Sphere.** The owner answered the phase-1 picker *"Só pessoal"* (only personal).
2. **Inventory and matrix.** A read-only inventory of the installed configuration, then a
   reconciliation matrix of each blueprint item against it: already in place, divergent, or absent.
3. **Decisions.** One decision per pending item, each through a three-option picker
   ([ADR-0019](0019-paced-conversation-and-three-path-decisions.md)).

This record keeps the outcome. It does not reproduce the blueprint. Each item is summarised in one
line in the table under "Decision outcome".

A record is owed because the outcome alters recorded decisions (the deny floor, the allow list, the
model and effort defaults, the hook set) and adds a control (the outbound scan).

## Decision drivers

- The mission's core risk is third-party confidentiality. Every hook and every control has to answer to it.
- Accepted records are amended, never contradicted in silence. Where the blueprint diverges from an
  accepted decision or from the owner's stated preference, the divergence is declared.
- Report each control at its real evidence level. A gap a mechanism cannot close is declared, not
  implied away.
- Thin harness: the smallest mechanism that covers the most harm, native mechanisms first.

## Considered options

### Option A: adopt the blueprint wholesale

Install the blueprint's target configuration as written.

- Good: one step, and this workstation would match the source station exactly.
- Bad: several items conflict with accepted records here. Examples: the PR-label SemVer cut
  ([ADR-0002](0002-automatic-semver-cut-policy.md)), the paste filter
  ([ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md)), and the standing publication
  route, which stays (ADR-0021, 2026-10-05 amendment): agents merge slices into `rc/next` after review;
  `main` waits for the owner ([ADR-0021](0021-workspace-session-intake-and-ci-publication.md)). Others
  conflict with preferences the owner stated in the interview: medium effort rather than high, and the
  blueprint's stop-on-undeclared rule, which he declined (he accepted the sphere declaration itself). Wholesale adoption would overwrite those records without amending them.

### Option B: reconcile item by item (chosen)

Put each pending item to the owner as its own decision. Adopt, adapt or decline it. Record each
divergence.

- Good: every change has an owner decision behind it. Accepted records are amended in the open.
  Divergences are named where the next reader looks.
- Bad: slower, twelve decisions instead of one. The workstation will still differ from the source
  station, so a future blueprint refresh needs another reconciliation.

## Decision outcome

Chosen: **Option B.** The owner's words are quoted verbatim where he gave them, followed by an English
rendering.

| # | Blueprint item (one line) | Decision |
| --- | --- | --- |
| 1 | Every workspace declares its sphere; an undeclared one is treated as client work and the agent stops | Adapted |
| 2 | Cloud access through the CLI, not through an MCP server | Adopted |
| 3 | A broad deny floor for infrastructure state, project secrets, hook bypass, login and inline interpreters | Adopted in part |
| 4 | A narrow pre-authorisation allow list | Adapted |
| 5 | A default model and high reasoning effort in every harness | Adapted |
| 6 | Hooks kept to a minimum | Adopted, with a stated principle and one exception |
| 7 | An outbound content check before anything leaves the machine | Adopted, informing only |
| 8 | Model defaults pinned by ID, never by alias | Adopted |
| 9 | A queue of owner actions | Adopted |
| 10 | A defined way to close a session | Adapted |
| 11 | Version bump from Conventional Commits | Not adopted |
| 12 | Commit only when asked | Not adopted |

### 1. Sphere

The owner's repositories (mhw, tadeumendonca-io, tadeumendonca-skills) declare `sphere: personal` in
their `AGENTS.md`. Owner: *"pode marcar os repos como pessoal"* (you may mark the repos as personal).

Not adopted: the blueprint's rule that an undeclared workspace means client work, and the agent stops.
The declaration is added. The stop-on-undeclared default is not.

### 2. Cloud access

The `aws-api` MCP server is removed from the Codex user configuration. Cloud access goes through the
CLI only. Owner: *"pode remover, não uso"* (you may remove it, I don't use it).

### 3. Deny floor: the moderate option

Amends [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md). Added to the floor:

- **Terraform and OpenTofu:** everything beyond `fmt`, `validate` and `version`. That is `init`,
  `plan`, `state`, `import`, `refresh`, `output`, `show`, `console`, `workspace`, `login`, `logout`,
  `force-unlock`, `taint`, `untaint`, `test`, `get`, `providers`, `graph`, `metadata`, and the global
  option `-chdir`.
- **Project secrets:** `--with-decryption`, and the files `**/.env`, `**/.env.*`, `**/*.pem` and
  `**/credentials*`.
- **Hook bypass:** `--no-verify`.
- **Interactive login:** `aws sso login`.

**Every `init` is blocked (owner, 2026-10-10).** The prefix floor cannot tell `init` apart from
`init -backend=false`, so the choice was to allow both or block both. The owner picked *"Bloquear todo
init"* (block every init). Consequence: the agent cannot run `validate` on a fresh project, which needs
an initialised working directory. The owner runs `init` once, or leaves validation to CI.

Not adopted: blocking inline interpreters (`bash -c`, `sh -c`, `eval`, `python -c`, `node -e`). Three
gaps are declared instead:

- **A prefix floor cannot see a command wrapped in an interpreter.** A blocked command passed to
  `bash -c` or `python -c` arrives as an argument string, which no prefix entry matches.
- **Codex has no file deny inside the workspace.** The secret-file patterns hold on Claude Code. On
  Codex they do not stop a read inside the working tree.
- **A prefix floor cannot allow `init -backend=false` alone.** An allow for it would also allow plain
  `init`, so every `init` is denied.

### 4. Allow list

Amends [ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md). Only `find:*` and
`awk:*` are removed. They can delete or execute: `find -delete` or `-exec`, and `awk`'s `system()`.
Everything else stays. Owner: *"voce conseguiria somente tirar essas brechas extremas que mencionou
no 3?"* (could you remove only those extreme loopholes you mentioned in 3?).

A prefix floor cannot block only `find -delete`, so the whole command now asks.

*Added 2026-10-10 (slice A):* `find:*` and `awk:*` are not owned by mhw. They are in neither
`global/allow-list.conf` nor `overlay/allow-list.conf`, nowhere in mhw's git history as an allow entry,
and not under mhw's ownership key in `~/.claude/settings.json`. They are present in the
tadeumendonca-skills plugin's project settings. Their removal is therefore an owner action, not code
in this repository.

### 5. Model and effort

Amends [ADR-0007](0007-session-start-model-and-effort-defaults.md). Every harness starts on its top
model with reasoning effort **medium**. Owner: *"eu queria um modelo top esforco medio em todos harness
por padrao. ex opus 5.5 medium"* (I wanted a top model at medium effort in every harness by default,
e.g. Opus 5.5 medium).

- Codex drops from high to medium.
- Kiro gets a pinned model. ~~Which models Kiro offers is **not verified yet**.~~ *Struck 2026-10-10
  (slice B):* measured, see the slice B amendment below. Kiro CLI 2.29.0 lists `claude-sonnet-4.5` as
  its top model, and Kiro takes no effort here.
- Not adopted: the blueprint's "high" effort.

### 6. Hooks

Owner principle: *"hooks somente devem ser utilizados para mitigacao de riscos existenciais"* (hooks
should only be used to mitigate existential risks).

- **The paste filter stays.** Third-party confidentiality is the mission's core risk.
- **The iTerm `cc-status` status hooks are a declared exception**, chosen by the owner. In the agent's
  assessment (not verified), they are visual only and spend no model tokens.
- **The four removed controls still registered in the legacy admin layer** are cleared by installing
  v5.0.0.

### 7. Outbound scan

A new `mhw scan` command. The agent runs it by rule before every push and PR, and a CI check runs it
on every PR.

- Design proposed by the agent, not the owner's words: it reuses the paste filter's detection engine,
  and it reports `file:line`, the rule and the match length. It never prints the matched text
  ([ADR-0005](0005-detection-response-hitl-without-log.md)).
- **It informs. It never blocks.**

### 8. Model IDs, not aliases

Every harness pins its model default by ID, never by alias. For example `claude-opus-5-5[1m]`, not
`opus[1m]`. The IDs are versioned in mhw, so a vendor alias moving to a new model shows up as a
reviewed change instead of a silent one.

### 9. Owner-action queue

Actions only the owner can take are GitHub Issues in mhw with an `owner-action` label. `mhw status`
shows the open count.

### 10. Session close

A session ends with *"Objective reached: <objective>"* and the evidence. The agent never asks whether
to close.

### 11. Version bump

The bump stays on the PR's `semver:*` label
([ADR-0002](0002-automatic-semver-cut-policy.md)). This is a declared divergence from the blueprint's
Conventional-Commits bump. Under the owner's 2026-10-10 rule an incremental change is a patch, and a
`feat:` prefix would turn it into a minor.

### 12. Commit and push

The standing publication route stays (ADR-0021, 2026-10-05 amendment): agents merge slices into
`rc/next` after review; `main` waits for the owner
([ADR-0021](0021-workspace-session-intake-and-ci-publication.md)). This is a declared divergence from the blueprint's "commit only
when asked".

### Not covered by the interview

A read-only inventory could not verify these items. They stay open:

- read-only production access through IAM;
- how AWS credentials are renewed;
- an "always ask" list for MCP write tools;
- Kiro still has no deny floor.

## Consequences

### Good

- Every change here traces to an owner decision, and every divergence from the blueprint is written
  where a later reconciliation will find it.
- The floor gains the infrastructure-state, secret and bypass routes the inventory found open.
- The allow list loses its two entries that could delete or execute.
- Model defaults become reviewed, versioned values instead of vendor aliases.
- Outbound content gets a check that names where a finding is without repeating it.

### Bad

- **Declared gaps** (decision 3): the floor does not see a command wrapped in an inline interpreter,
  Codex has no file deny inside the workspace, and the floor cannot allow `init -backend=false` alone.
- The agent cannot run `validate` on a fresh Terraform or OpenTofu project. The owner runs `init` once,
  or CI validates.
- `find` and `awk` now ask every time, including for harmless reads.
- The outbound scan informs and never blocks, so a finding the agent ignores still ships.
- ~~The Kiro model choice rests on an unverified list of Kiro's models.~~ *Struck 2026-10-10 (slice
  B):* the list was measured. The residual gaps of decisions 5 and 8 are in the slice B amendment.
- The four items not covered by the interview stay open, Kiro's missing floor among them.
- The configuration diverges from the source station on purpose (decisions 1, 5, 11 and 12), so the
  next blueprint refresh needs its own reconciliation.

### Implementation plan

Each decision lands as its own reviewed slice into `rc/next`, and amends the record it changes in the
same pull request. One line per slice, with the files it touches:

1. **Deny floor** (decision 3): `global/deny-floor.conf`, plus the declared gaps in
   [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md).
2. **Allow list** (decision 4): `global/allow-list.conf`. Neither `global/allow-list.conf` nor
   `overlay/allow-list.conf` carries a `find` or `awk` entry at this base (`af15e02`), so the slice
   first finds where the rendered entries come from.
3. **Model and effort, pinned by ID** (decisions 5 and 8): ~~the overlay profile (`overlay/profile.json`,
   `overlay/profile-plan.json`) and its renderer under `global/profile/`.~~ *Struck 2026-10-10 (slice
   B):* `overlay/model-defaults.json` and its renderer `global/models/model_defaults.py`; see the slice
   B amendment below for why the carrier changed.
4. **Codex MCP removal** (decision 2): the `aws-api` entry in the Codex user configuration, and in the
   untracked local MCP overlay ([ADR-0017](0017-single-source-mcp-with-secret-indirection.md)) if it
   is there.
5. **Hook principle and session close** (decisions 6 and 10): the brief and overlay text,
   `global/AGENTS.md` and `overlay/AGENTS.md`.
6. **Outbound scan** (decision 7): the new `mhw scan` in `global/workstation.py`, reusing the paste
   filter's engine, and a CI check in `.github/workflows/`.
7. **Owner-action queue** (decision 9): the `owner-action` label in mhw, and the open count in
   `render_status` in `global/workstation.py`.
8. **Sphere lines** (decision 1): `AGENTS.md` in mhw, tadeumendonca-io and tadeumendonca-skills.

Decisions 11 and 12 change nothing. They keep [ADR-0002](0002-automatic-semver-cut-policy.md) and
[ADR-0021](0021-workspace-session-intake-and-ci-publication.md) as they are.

## Amendment 2026-10-10: implementing decision 3 (slice A)

**1. A new floor entry kind, `glob`.** `global/deny-floor.conf` gains the kind `glob`, rendered for
Claude Code only, as `Bash(<words>)` ending in a trailing `*`. It exists because a prefix rule cannot
catch `terraform -chdir=DIR`: the option and its value are one token. Measured on Claude Code 2.1.296,
`Bash(terraform -chdir:*)` let `terraform -chdir=. version` run, while `Bash(terraform -chdir=*)`
blocked it. The entry blocks every `-chdir` form, `fmt` and `validate` included. Codex has no
equivalent, so on Codex `-chdir` is a declared gap.

**2. Where the Terraform and OpenTofu list comes from.** It was taken from `terraform -help` on
Terraform 1.12.1: 22 subcommands per binary. OpenTofu is not installed on the reference machine, so its
list mirrors Terraform's. A subcommand that exists only in OpenTofu is not covered.

**3. Further declared gaps.** Slice A closes none of these:

- **Flags placed mid-command are not caught.** A prefix entry matches from the program name, so
  `aws ssm get-parameter --name X --with-decryption`, `git commit -m msg --no-verify`, combined short
  flags, `git -C <dir> …` and `aws --profile <p> …` all pass the floor entries written for them.
- **Terraform global options, `TF_CLI_ARGS` and wrappers.** An option before the subcommand, a
  subcommand injected through the environment, or a wrapper script that calls the binary is not seen.
- **Claude Code `**/` file denies apply only inside the working directory.** A secret file outside it
  is not covered. And `**/.env.*` also blocks `.env.example`, a file that holds no secret.

## Amendment 2026-10-10: implementing decisions 5 and 8 (slice B)

Pull request #119, into `rc/next`. Its evidence level is: *written and tested* in throwaway homes;
**not installed** on the reference machine; no default checked in a new session of any harness.

**1. The carrier changed from the plan.** Item 3 of the implementation plan named the overlay profile
and `global/profile/`. That renderer compiles instruction text into the overlay and, by its own
contract, *"Never install[s] into a harness"*. Decisions 5 and 8 need the opposite: a value written
into each harness's own native user-level key, without disturbing the rest of the file. So the slice
ships its own carrier, run as one step of `global/install.sh`:

- **Policy:** `overlay/model-defaults.json`, owner-specific because the IDs depend on his
  subscriptions. The generic layer pins nothing: with no overlay file the policy is empty.
- **Renderer:** `global/models/model_defaults.py`, standard library only, Python 3.9 or later. It
  writes only `model` and `effortLevel` (Claude Code, `~/.claude/settings.json`), `model` and
  `model_reasoning_effort` (Codex, top-level keys of `${CODEX_HOME:-~/.codex}/config.toml`) and
  `chat.defaultModel` (Kiro CLI, `~/.kiro/settings/cli.json`). The policy loader refuses any other
  field, and refuses an alias (decision 8).
- **Ownership record:** the keys mhw set, with the provenance stamp, in
  `${XDG_DATA_HOME:-~/.local/share}/personal-multi-harness-workstation-configuration/model-defaults.json`.

| Harness | Pinned model | Effort | Evidence |
| --- | --- | --- | --- |
| Claude Code | `claude-opus-5-5[1m]` | `medium` | the keys documented and read from the bundle; not checked in a new session |
| Codex | `gpt-5.6-sol` | `medium` | the keys read from the binary; not checked in a new session |
| Kiro CLI | `claude-sonnet-4.5` | not set | the model list measured (`kiro-cli chat --list-models`, 2.29.0): it is the top model offered; not checked in a new session |

**2. Ownership semantics.** A key is written only when it is absent, or still holds the value mhw
recorded writing.

- **KEPT.** A key holding any other value is the owner's. It is kept, never overwritten. It changes no
  exit code, it is not a pending write (so a repeated install settles, and `mhw status` does not count
  it), and `mhw install` lists it as an owner next step: delete the key and run install again to hand
  it to mhw. A value the owner set that already equals the policy also stays his.
- **REFUSE, exit 3**, only for: a file or value mhw cannot read; an ownership record mhw does not own;
  an edit that would not parse.
- **The TOML parse guard needs Python 3.11 or later** (`tomllib`). Every Codex edit is parsed before
  the atomic replace; below 3.11 the check is skipped and the line editor stands alone. The editor
  finds the bare, `"basic"` and `'literal'` spellings of a key.
- **A recorded file outside `--home` (and `CODEX_HOME`) is never edited.** It is noted and left alone.
- **Backup and format.** Every write leaves the previous file as `<file>.pmhwc-models-backup`, then
  replaces the file atomically with its mode kept. The backup is overwritten on each write, so after a
  second write it no longer holds the pre-mhw original. JSON files are re-serialised whole: the same
  keys and order, but re-indented.
- **Uninstall** removes a key only while it still holds the value mhw recorded.

**3. Declared gaps.**

- **Kiro has no effort setting here.** Its effort is a per-model entry, and whether the pinned model
  accepts one was not verified, so the policy refuses a Kiro effort.
- **Windows:** `install.ps1` does not render these values. The control is macOS and Linux only.
- **A vendor-retired pinned ID passes `--check` and breaks the session, with no fallback.** `--check`
  compares strings only. Measured on Claude Code by the agents-lead review of #119: a retired ID makes
  the session exit with a model error rather than fall back to a default. For Codex and Kiro the
  behaviour is a hypothesis. Kiro already marks retiring models `[EOL]` in its list.
- **A pinned ID implies a minimum harness version, and none is declared yet** (AGENTS.md principle 1).
  The same Claude Code probe reported that an ID outside its model catalog needs an update.
- **Layers above the user file win.** Workspace or project settings, the environment variables
  `ANTHROPIC_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL`, and Codex profiles and `-m` all override the pin.
  The project layer winning was measured on Claude Code; the rest is read or documented. `mhw status`
  now reports a workspace override instead of saying the policy matches.
- **Kiro's native writer is not used.** `kiro-cli settings chat.defaultModel <id>` exists. The slice
  writes the flat key into `cli.json` itself, and the on-disk shape the native writer produces was
  not measured.

**4. On the reference machine.** The owner's user layer holds his own Claude Code `model` and Codex
`model_reasoning_effort`. Those are KEPT, so those two pins take effect only after he deletes the keys
and installs again.

## Amendment 2026-10-10: implementing decision 7 (slice F)

**1. Where it lives.** `mhw scan` is dispatched by `main` in `global/workstation.py`. The logic is in
`global/scan.py`, imported on demand as `mhw check` imports `global/prerequisites.py`. It calls the paste
filter's `find_spans` from `global/clipboard/clipboard_guard.py` as it is. There is no second detector.

**2. What it scans.** By default, the files this branch changed since it left its upstream: the merge
base of `HEAD` and `@{upstream}`, compared with the working tree (*and, appended 2026-10-10, every
commit after that merge base: see item 7*). That covers committed and uncommitted
changes to tracked files. Deleted and untracked files are not scanned. `--base=REF` replaces
`@{upstream}`, and explicit paths replace the git selection. Whole files are scanned, not only the
changed lines, so a finding that predates the branch is reported again in a file the branch touches.

**3. What it prints.** One line per finding: `path:line: category, N chars`. A file it does not scan
(binary, over the paste filter's `max_bytes`, unreadable) is named with the reason. All six categories
are reported, whatever `block_categories` says, because that setting decides what blocks a prompt.
Employer and client terms are matched only when the term list and its salt are readable without a
prompt. On a CI runner there is no term list, so that category is never checked there.
*Appended 2026-10-10 (#120 review, lens finding 2): whenever that category is not checked (no term list,
an empty or unreadable one, or no salt), a NOTE line says so. Its absence is never silent.*

**4. Exit codes.** 0 with or without findings. 2 when the scan cannot run: not a git repository, no
upstream and no `--base`, or an unknown argument. No opt-in blocking flag exists. *Appended
2026-10-10 (#120 review, SonarCloud S8705 and S8707): a `--base` value that starts with `-` or does not
resolve to a commit also exits 2. The ref is verified with `git rev-parse --verify --end-of-options`,
and only the verified id reaches `git merge-base`, after `--end-of-options`. A path that resolves outside
the current directory (explicit paths) or outside the repository (git mode, for example a tracked
symlink) is not opened: it is reported as `SKIPPED` with the reason, and the exit code stays 0.*

**5. CI.** `.github/workflows/outbound-scan.yml` runs `mhw scan --base=origin/<PR base>` on every pull
request. ~~It is not among the needs of the `delivery-ci` gate, so it never blocks a merge.~~
*Corrected 2026-10-10 (#120 review, lens finding 3): findings never block, because the scan exits 0 with
findings. A scan that cannot run, or crashes, turns the `scan` check red. `workspace/delivery.py`
refuses any head check that is not green, so that red check then holds the checked merge. Failing
closed there is intended. The job is still not among the needs of `delivery-ci`.*

**6. The rule.** `global/AGENTS.md` item 8 tells the agent to run `mhw scan` before every push and pull
request. It is an instruction. No hook runs the scan. *Appended 2026-10-10 (#120 review): findings
never block a push or a merge, but a scan that cannot run holds the checked merge (item 5). Item 8 now
says that it is an instruction, that no hook runs it, and that it is macOS and Linux only. It also tells
the agent to fix a finding in an unpushed commit by rewriting that commit, not with a follow-up commit.*

**7. Declared gaps.** On Windows, `bin/mhw.js` does not route `scan`, so the command exists on macOS and
Linux only. ~~The scan reads the working tree, not the commits, so with uncommitted edits it does not
scan exactly what a push sends.~~ *Corrected 2026-10-10 (#120 review, lens finding 1): that sentence
understated the gap. Scanning only the final tree missed content added in one unpushed commit and
removed in a later one, and it missed commit messages. The default mode now also scans the added lines
and the message of every commit between the merge base and `HEAD`. It reports them as
`<short-sha>:path:line: category, N chars` and `<short-sha>:message: category, N chars`. What remains
outside: a merge commit's own diff (its message is scanned, and the commits it brings in are scanned one
by one), file and path names, and untracked files. With uncommitted edits, the working-tree half scans
what is on disk, not what a push sends. A finding in an unpushed commit is fixed by rewriting the commit
that introduced it. A follow-up commit would leave it in the push.*
*Appended 2026-10-10 (#120 review round 2, finding B2): the agent's own attribution instruction puts a
`Co-Authored-By` trailer with the vendor's no-reply address in every commit, and the message scan
reported that address on each one, so item 8 told the agent to strip a trailer it is required to add.
~~In the commit-message path only, a line whose whole form is `Co-Authored-By: <name> <that exact
address>` (the key in any case) is no longer reported.~~ The shared detection engine is unchanged, so
the paste filter still treats the address as it did. The same address elsewhere in a message, in
another trailer, or in a file or a commit's added lines is still reported, and so is a
`Co-Authored-By` line with a different or lookalike address.*
*Corrected 2026-10-10 (#120 review round 3): the struck sentence exempted the whole line, so the name
field was never scanned, and a credential, an email or a CPF placed there was not reported. In the
commit-message path only, the name is scanned; only the vendor no-reply address in that trailer is
exempt. The key and the name stay in the scanned text, the line count is kept, and the exact trailer
still gives no finding.*

## Links

- Issues: none (owner request in session, 2026-10-10)
- Pull requests: #118 (slice A), #119 (slice B), #120 (slice F)
- Amends: [ADR-0007](0007-session-start-model-and-effort-defaults.md),
  [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md),
  [ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md)
- Keeps: [ADR-0002](0002-automatic-semver-cut-policy.md),
  [ADR-0021](0021-workspace-session-intake-and-ci-publication.md),
  [ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md)
- Related: [ADR-0005](0005-detection-response-hitl-without-log.md),
  [ADR-0017](0017-single-source-mcp-with-secret-indirection.md),
  [ADR-0019](0019-paced-conversation-and-three-path-decisions.md)
