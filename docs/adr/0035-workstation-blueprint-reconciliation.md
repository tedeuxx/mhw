# ADR-0035: Reconcile the workstation harness blueprint item by item

- **Status:** proposed
- **Date:** 2026-10-10
- **Deciders:** the owner (each decision below, 2026-10-10, in the reconciliation interview); written
  by tech-lead
- **Issues:** [#113](https://github.com/tedeuxx/mhw/issues/113)

## Context and problem

On 2026-10-10 the owner pasted a zero-identity "workstation harness blueprint" into a session in this
repository. It carries a target configuration and a reconciliation-interview procedure. He received it
from his own method layer, on another workstation of his. It names no person, employer or client.

The agent ran the interview in three phases:

1. **Sphere.** The owner confirmed this workstation is "only personal".
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
  ([ADR-0002](0002-automatic-semver-cut-policy.md)), the improvement-session publication authorisation
  ([ADR-0021](0021-workspace-session-intake-and-ci-publication.md)), and the paste filter
  ([ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md)). Others conflict with
  preferences the owner stated in the interview: medium effort rather than high, and the personal sphere
  declared rather than inferred. Wholesale adoption would overwrite those records without amending them.

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

- **Terraform and OpenTofu**, beyond `fmt`, `validate`, `init -backend=false` and `version`: `plan`,
  `state`, `import`, `refresh`, `output`, `show`, `console`, `workspace`, `login`, `force-unlock`, and
  `-chdir`.
- **Project secrets:** `--with-decryption`, and the files `**/.env`, `**/.env.*`, `**/*.pem` and
  `**/credentials*`.
- **Hook bypass:** `--no-verify`.
- **Interactive login:** `aws sso login`.

Not adopted: blocking inline interpreters (`bash -c`, `sh -c`, `eval`, `python -c`, `node -e`). Two
gaps are declared instead:

- **A prefix floor cannot see a command wrapped in an interpreter.** A blocked command passed to
  `bash -c` or `python -c` arrives as an argument string, which no prefix entry matches.
- **Codex has no file deny inside the workspace.** The secret-file patterns hold on Claude Code. On
  Codex they do not stop a read inside the working tree.

### 4. Allow list

Amends [ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md). Only `find:*` and
`awk:*` are removed. They can delete or execute: `find -delete` or `-exec`, and `awk`'s `system()`.
Everything else stays. Owner: *"voce conseguiria somente tirar essas brechas extremas"* (could you
remove just those extreme loopholes).

A prefix floor cannot block only `find -delete`, so the whole command now asks.

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
- **The iTerm `cc-status` status hooks are a declared exception**, chosen by the owner. They are visual
  only and spend no model tokens.
- **The four removed controls still registered in the legacy admin layer** are cleared by installing
  v5.0.0.

### 7. Outbound scan

A new `mhw scan` command. The agent runs it by rule before every push and PR, and a CI check runs it
on every PR.

- It reuses the paste filter's detection engine.
- It reports `file:line`, the rule and the match length. It never prints the matched text
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
to close. In-scope follow-ups stay in the same session.

### 11. Version bump

The bump stays on the PR's `semver:*` label
([ADR-0002](0002-automatic-semver-cut-policy.md)). This is a declared divergence from the blueprint's
Conventional-Commits bump. Under the owner's 2026-10-10 rule an incremental change is a patch, and a
`feat:` prefix would turn it into a minor.

### 12. Commit and push

This repository's standing authorisation for improvement sessions stays
([ADR-0021](0021-workspace-session-intake-and-ci-publication.md)). Agents publish into `rc/next` after
review. `main` waits for the owner. This is a declared divergence from the blueprint's "commit only
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
  and Codex has no file deny inside the workspace.
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

## Links

- Issue [#113](https://github.com/tedeuxx/mhw/issues/113)
- Amends: [ADR-0007](0007-session-start-model-and-effort-defaults.md),
  [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md),
  [ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md)
- Keeps: [ADR-0002](0002-automatic-semver-cut-policy.md),
  [ADR-0021](0021-workspace-session-intake-and-ci-publication.md),
  [ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md)
- Related: [ADR-0005](0005-detection-response-hitl-without-log.md),
  [ADR-0017](0017-single-source-mcp-with-secret-indirection.md),
  [ADR-0019](0019-paced-conversation-and-three-path-decisions.md)
