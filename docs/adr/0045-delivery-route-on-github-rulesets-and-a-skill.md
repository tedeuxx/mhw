# ADR-0045: The delivery route on GitHub rulesets and a skill; the review verdicts as commit statuses

- **Status:** ~~proposed (agent-written, awaiting the owner's ratification)~~ accepted 2026-11-24, ratified by
  the owner ([«Ratifico»](https://github.com/tedeuxx/mhw/issues/591#issuecomment-7133422761)). The route itself is the
  owner's choice in the CLI native baseline review of 2026-11-23 (*"GitHub + skill"*); the verdict
  mechanism and its trust model are the implementing agent's design, settling open question 3 of that
  requirements document.
- **Date:** 2026-11-23
- **Deciders:** the owner (the route, and the removal of `mhw delivery`); written by `agents-lead`, the
  lens for the `loop` lane
- **Issues:** [#591](https://github.com/tedeuxx/mhw/issues/591), slice 5 of 10 of the
  [CLI native baseline PRD](../mhw-product-requirements-document-cli-native-baseline.md) (section 5,
  open question 3)
- **Amends:** [ADR-0021](0021-workspace-session-intake-and-ci-publication.md), by an appended amendment:
  the merge route it records is no longer a command.

## Context and problem

Since #474 every merge of this repository ran through `mhw delivery merge`, a Node command that read the
pull request, refused on any unmet condition and then ran `gh pr merge --merge --match-head-commit`;
`mhw delivery verify` proved the result. The owner's CLI review of 2026-11-23 found that this is a
harness feature built in the CLI layer: *"Too many harness features were wrongly implemented in the CLI
layer"*, and the CLI's one purpose is distribution. For the delivery route he chose *"GitHub + skill"*:
*"it makes no sense not to be via harness"*. GitHub rulesets require the checks; a skill conducts the
flow.

Two of the command's conditions were not checks GitHub knew about: the `quality-assurance` verdict at
the exact head, and, on a harness diff, the `agents-lead` lens closed at the head or carried forward to
it. Both live in pull request comments. Open question 3 asked how a verdict becomes a status check a
ruleset can require.

## Decision drivers

- **Nothing in the runtime path depends on the CLI** (principle 3 of the PRD).
- **No condition is lost in the move.** Each condition the command checked is either held by GitHub or
  named as a step, and the difference is stated (Issue #591, acceptance).
- **A pull request must not be able to change the evaluator that judges it.**
- **Head-scoped by construction**: a verdict for one head must never satisfy another.
- **Report the real evidence level**: written, tested, applied and enforced are different claims.

## Considered options

1. **A workflow reads the newest strict-header verdict comment and posts a commit status on the PR's
   head; a ruleset requires it (chosen).** `.github/workflows/review-status.yml` runs
   `.github/scripts/review-status.js` on `pull_request_target` and `issue_comment`, and posts
   `review/route`, `review/quality-assurance` and (into `rc/next`) `review/agents-lead`. The reading is
   the removed command's, case for case. Trade-off: a commit status is writable by more than the
   reviewer (see *Trust model*), and comment events run the default branch's copy, so the mechanism
   acts fully only after a release.
2. **The workflow job itself is the required check (its own check run).** Rejected: a job started by a
   comment reports on the default branch's head commit, not on the pull request's head, so a ruleset
   could never see it there.
3. **A GitHub pull request review (approve) instead of a comment.** Rejected: every persona posts
   through the owner's account, and GitHub does not let an author approve his own pull request, so the
   reviews could not be posted at all; it would also discard the head and `owner-check:` lines the
   merge-authority contract requires.
4. **A `pull_request` trigger, so the statuses update on the PR's own copy.** Rejected: the PR's copy
   could be edited to post success; `pull_request_target` and `issue_comment` run the base and default
   branch copies, which only a reviewed merge changes.
5. **Keep `mhw delivery` and add the rulesets beside it.** Rejected by the owner's ruling: the CLI's
   purpose is distribution.

## Decision outcome

Option 1.

### The statuses

`review-status.js` reads the pull request with `gh pr view` (its head, branches, cross-repository flag,
state and comments), fetches the head and the base as objects (never checked out, never run), and
posts on the head the forge reports at run time, not on the commit of the event that woke it:

| status | success when | otherwise |
|---|---|---|
| `review/route` | a slice from its own branch into `rc/next`, or `rc/next` into `main`; same repository | failure |
| `review/quality-assurance` | the newest trusted comment opening with `<!-- gatekeeper-verdict`, in the strict four-line header, names this head and says `APPROVE-AND-MERGE`, with an `owner-check:` line 4 | pending when none is posted or it names another head; failure when it refuses or is malformed |
| `review/agents-lead` (`rc/next` only) | no harness path in the diff from the merge base, or the newest lens marker is `the lens is CLOSED` at this head, or at an earlier commit that carries forward by (a), (b) and (c) | pending when absent or not carried; failure when open at this head or malformed |

The header formats, the newest-wins rule, the fence and preamble rules and the carry-forward conditions
are unchanged from the command, and its verdict and lens cases moved to `test/review-status/`. A moved
head has no status until the next run, so a required status is head-scoped by construction. The
release candidate gets no lens status, because the command did not gate it; it does need
`review/quality-assurance`, which the command did not read for `main`.

### The rulesets

`global/github-repo-settings.json` gains `rulesets`, one GitHub ruleset API body per delivery branch,
held to `global/github-repo-settings.schema.json`. Both require a pull request with merge commits only
(`allowed_merge_methods: ["merge"]`), forbid deletion and force-push, and require an up-to-date head and
these statuses: `delivery-ci`, `scan`, `docs-baseline`, `semver-label` (which now runs on both bases),
`SonarCloud Code Analysis`, `review/route`, `review/quality-assurance`, and on `rc/next` also
`review/agents-lead`. Every status posted by a workflow is pinned to the GitHub Actions app
(`integration_id` 15368); Sonar's is not pinned. `rc/next` has no bypass actor. `main` keeps one, the
repository admin role, because `version-main` pushes the bump commit and tag to `main` directly.

**Applying them is the owner's act**, recorded as an `owner-action` Issue with the one-line command. It
should follow the release that puts the workflow on `main`.

### The skill

The method skill `merge-pull-request` names every condition the command checked and, for each, whether
GitHub holds it or it is a step; then the one merge, `gh pr merge N --merge --match-head-commit SHA`;
then the proof `verify` gave (a slice merged; a release published, stable, newer and containing the
merge, with its version workflow green).

### Every condition of the removed command, and where it went

| condition | now |
|---|---|
| clean, pushed local checkout at the PR head; head branch checked out | `--match-head-commit`: GitHub refuses if the head moved |
| same repository; base `rc/next` or `main`; `main` only from `rc/next`; a slice not from `rc/next` or `main` | `review/route` |
| exactly one semver label | `semver-label`, on both bases |
| the `tests` run registered on the head, every aggregated job and `delivery-ci` | required `delivery-ci`, pinned to GitHub Actions |
| `delivery-ci`, Sonar, `docs-baseline` green; the newest run of each counts | required statuses; GitHub reads the newest |
| no other head check pending or failed | **a step** in the skill (`gh pr checks`); a ruleset cannot say "every check" |
| merge state clean; not behind the base | the ruleset (`strict`, and GitHub refuses a conflict); the skill reads the state to name it |
| the verdict at the head | `review/quality-assurance` |
| the lens on harness paths, with carry-forward | `review/agents-lead` |
| merge commit pinned to the head | the skill's command, and `allowed_merge_methods` |
| `verify`: slice merged; release published, newer, containing the merge, version workflow green | **steps** in the skill |
| the owner's go on the release candidate | **an instruction**, as before; the status reads the verdict, not its `authorization:` citation |

### Trust model: who can make a status green

- **Through a comment.** The evaluator counts a comment when GitHub reports its author as `OWNER`,
  `MEMBER` or `COLLABORATOR`: anyone with write access. Every persona posts through the owner's
  account, so a green status says *a trusted account posted a well-formed verdict naming this head*,
  never *this persona reviewed it*. That is the limit the command and the plugin's merge floor had.
- **Through the evaluator.** Only a merged change alters it: `pull_request_target` runs the base
  branch's copy and `issue_comment` the default branch's. A pull request's own edits to it do not run.
- **Directly, as a status.** The rulesets pin each workflow status to the GitHub Actions app. That
  refuses a status written with a personal token (GitHub documents the pin; it is not measured here),
  and the workstation's deny floor also refuses the `gh api --method POST` prefix to agents. It does
  **not** refuse a status written by another workflow of this repository that holds `statuses: write`,
  including one a same-repository pull request adds on a `pull_request` trigger. Such a pull request
  touches `.github/`, a harness path, so it needs the lens: that is review, not a mechanism.
- **By bypass.** On `main` the repository admin role bypasses the ruleset, and the owner's account,
  which every agent uses, is that role: `gh pr merge --admin` would merge past it. Not doing so is an
  instruction. `rc/next` has no bypass.

So the rulesets hold against an honest mistake and a skipped step, not against an actor with write
access who means to get past them: the same level the command had, now held where the merge happens.

## Consequences

- Good: the conditions are held by GitHub whatever command merges, once applied; the CLI loses a
  700-line command; the verdict formats did not change, so no persona's brief changes beyond the
  command's name.
- Good: `review/route` makes *main only from `rc/next`* a required status, which no option of a ruleset
  expresses by itself.
- Bad: until the owner applies the rulesets, nothing requires any status, so the skill's conditions are
  the whole check, held by instruction; the removed command at least refused when it was run.
- Bad: comment events act only once the workflow is on `main`, and push events once it is on the base.
  Until then the executor re-runs the workflow or runs the evaluator's dry run.
- Bad: *no other check failed* and the owner's go on the release candidate are instructions.
- Bad: removing `mhw delivery` is a break of the public interface: `semver:major`.
- Bad (QA B1 on PR #608): `main`'s version-bump commit can no longer be pushed into `rc/next`, and
  the *Update branch* button is refused there too, so every release starts with a sync slice (a branch
  from `rc/next` with `main` merged in, `semver:patch`, the docs-baseline escape line), or the release
  candidate stays `BEHIND`. Step 0 of *Releasing the candidate* in `workspace/README.md`.

## Evidence level

*Written and tested*: the evaluator against synthetic payloads (`test/review-status/review-status.test.js`),
the declaration against its schema and against each weakening (`test/review-status/rulesets.test.js`).
**Not applied** to any repository, **not run** by GitHub on any real pull request, and the
`integration_id` pin, `allowed_merge_methods` and the bypass behaviour are *documented*, not measured.

## Links

- [Issue #591](https://github.com/tedeuxx/mhw/issues/591); the PRD's section 5 and open question 3
- `.github/workflows/review-status.yml`, `.github/scripts/review-status.js`
- `global/github-repo-settings.json`, `global/github-repo-settings.schema.json`
- `method/skills/merge-pull-request/SKILL.md`, `workspace/README.md`
- [ADR-0021](0021-workspace-session-intake-and-ci-publication.md) (the `rc/next` route),
  [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md) (merge commits only)
