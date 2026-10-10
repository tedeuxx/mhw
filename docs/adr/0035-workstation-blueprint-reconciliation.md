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
- Kiro gets a pinned model. Which models Kiro offers is **not verified yet**.
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
- The Kiro model choice rests on an unverified list of Kiro's models.
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
3. **Model and effort, pinned by ID** (decisions 5 and 8): the overlay profile (`overlay/profile.json`,
   `overlay/profile-plan.json`) and its renderer under `global/profile/`.
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

## Amendment 2026-10-10: implementing decision 9 (owner-action queue)

**1. The label.** `owner-action` exists in `tedeuxx/mhw`, described *"An action only the owner can
take"*. It was created once with `gh label create`; `gh label create` exits 1 on an existing label, so
re-running it is safe but not silent. No owner-action Issue was opened by this slice.

**2. Where the count shows.** `mhw status` gains one line, `owner actions`, naming the label and the
repository. `mhw status --summary` appends `· owner actions: <count>` to its `workstation` line instead
of adding a line, so the summary keeps its ten-line bound. The logic is its own module,
`global/owner_actions.py`; `global/workstation.py` only imports it, stores the text in the gathered
facts and prints it.

**3. How it is read.** Read-only: `gh issue list --repo tedeuxx/mhw --label owner-action --state open
--limit 1000 --json number`, counted in Python. `--limit` is set because gh pages at 30 by default; a
count at 1000 shows as "1000 or more". Each gh call is bounded by a 5-second timeout. The repository and
label are constants, not an overlay value.

**4. Never a false 0.** When the count cannot be read the view says `not read (<reason>)`, and status
still exits 0. The reasons: gh not found, gh could not run, gh timed out, gh not authenticated (exit 4,
measured with gh 2.93.0; or an HTTP 401 in gh's error text, not measured), offline, gh exited N, output not understood. gh's own error
text is classified and never printed. **An absent label is also "not read":** `gh issue list` with a
label that does not exist prints `[]` and exits 0 (measured), which would read as 0. So a 0 is shown
only after a second read-only call, `gh label list --limit 1000 --json name`, finds the label by exact
name. `gh label list --search` was not used: right after creation it did not find the new label
(measured).

**5. Declared limits.**

- The count is of open Issues carrying the label. It says nothing about whether each one is still an
  action only the owner can take.
- `mhw status` now makes one or two network calls, so it can wait up to 10 seconds when GitHub is slow
  to answer. A machine with no gh, or with gh not logged in, answers at once.
- Pull requests carrying the label are not counted: `gh issue list` lists Issues only.
- On Windows, `mhw status` runs `install.ps1`'s check, which does not show the count.

## Links

- Issues: none (owner request in session, 2026-10-10)
- Amends: [ADR-0007](0007-session-start-model-and-effort-defaults.md),
  [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md),
  [ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md)
- Keeps: [ADR-0002](0002-automatic-semver-cut-policy.md),
  [ADR-0021](0021-workspace-session-intake-and-ci-publication.md),
  [ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md)
- Related: [ADR-0005](0005-detection-response-hitl-without-log.md),
  [ADR-0017](0017-single-source-mcp-with-secret-indirection.md),
  [ADR-0019](0019-paced-conversation-and-three-path-decisions.md)
