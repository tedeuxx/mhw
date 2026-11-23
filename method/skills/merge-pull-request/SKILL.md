---
name: "merge-pull-request"
description: "Merge a cleared pull request into rc/next or main the way the delivery rulesets expect: read the required statuses and the conditions no ruleset can hold, then run one gh pr merge pinned to the head, and prove the result afterwards. Use when a slice or the release candidate has its gate verdict and you are the executor the merge-authority contract names. Not for deciding whether to merge (see merge-authority), nor for opening or labelling the pull request (see scm)."
purpose: "conduct the merge on GitHub's own protection instead of a CLI command, and name every condition the removed mhw delivery merge and verify checked, so none of them is lost in the move"
---

# Merge a pull request: the delivery route on GitHub rulesets

**The decision is not here.** Whether a pull request may merge, who merges it and which holds wait for
the owner is the `merge-authority` contract. This skill is the act that follows a clearance: the
`APPROVE-AND-MERGE` verdict at the head, posted by `quality-assurance`, who is also the executor. On the
release candidate (`rc/next` into `main`) that verdict exists only after the owner's own comment
authorized the merge and the re-verdict at the same head cites its URL.

**What replaced what (#591).** Until #591 a CLI command, `mhw delivery merge` and `mhw delivery verify`,
read these conditions and refused the merge itself. GitHub now holds most of them: a ruleset per branch
requires status checks, a pull request, merge commits only and an up-to-date head. The review verdicts
reach the ruleset as commit statuses, which a workflow posts from the verdict comments. The rest are
steps you run. Each condition below says which of the two holds it.

## The statuses the rulesets require

| status | it is success when | posted by |
|---|---|---|
| `delivery-ci` | every job of the `tests` workflow passed on this head | the `tests` workflow |
| `scan` | the outbound scan ran (its findings never block) | the `outbound-scan` workflow |
| `docs-baseline` | every touched capability changed a document, or the body says why not | the `docs-baseline` workflow |
| `semver-label` | the pull request carries exactly one `semver:major\|minor\|patch` label | the `semver-label` workflow, on both bases |
| `SonarCloud Code Analysis` | the quality gate passed | the analysis app |
| `review/route` | a slice comes from its own branch into `rc/next`; `main` accepts only `rc/next`; same repository only | the `review-status` workflow |
| `review/quality-assurance` | the newest trusted gate verdict, in its strict four-line header, names this head and says `APPROVE-AND-MERGE` | the `review-status` workflow |
| `review/agents-lead` | (`rc/next` only) no harness path changed, or the newest lens marker is `the lens is CLOSED` at this head or carries forward to it | the `review-status` workflow |

The verdict and marker formats, the carry-forward rule (a), (b) and (c), and the trust model are in
the repository's delivery route document (`workspace/README.md` in this workstation's repository) and
its decision record (ADR-0045 there). They are not restated here.

## Before the merge: every condition, and what holds it

1. **The head you merge is the head that was reviewed.** Read `headRefOid` with
   `gh pr view N --repo OWNER/REPO --json headRefOid,headRefName,baseRefName,state,mergeStateStatus,isCrossRepository`.
   The removed command compared it with a clean, pushed local checkout; `--match-head-commit` below
   does the same on the server: GitHub refuses the merge if the head moved. *Held by the merge command.*
2. **The pull request is open** (`state` is `OPEN`). If it is already `MERGED`, report its URL and go
   to *After the merge*. *A step.*
3. **The route.** Base `rc/next` from a branch that is neither `rc/next` nor `main`, or base `main` from
   `rc/next` only, and never from another repository. *Held by `review/route`.*
4. **Exactly one semver label.** *Held by `semver-label`.*
5. **The tests ran on this head and passed**: every job `delivery-ci` aggregates, then `delivery-ci`
   itself. A pull request that is clean but on which no tests ran has no `delivery-ci` status, so it
   cannot merge. *Held by the required `delivery-ci` status, pinned to GitHub Actions.*
6. **SonarCloud, `docs-baseline` and the scan are green.** A Sonar status not yet registered is pending,
   not permission to race ahead. *Held by the required statuses.*
7. **Only the newest run of each check counts.** A re-run that passed supersedes an older failure; a
   newer failed or running re-run blocks. *Held by GitHub's own reading of a required check.*
8. **No other check on the head is failed or pending.** A ruleset requires only the checks it names; the
   removed command refused any red or pending check. Run `gh pr checks N --repo OWNER/REPO` and stop on
   any line that is not a pass or a skip. *A step: nothing mechanical holds it.*
9. **The merge state is clean.** `mergeStateStatus` is `CLEAN` (or `HAS_HOOKS`); stop on `DIRTY`,
   `BEHIND`, `BLOCKED`, `UNSTABLE` or `UNKNOWN` and say which. A conflict and a stale head are also
   refused by GitHub (`strict` status checks). *Held by the ruleset, and read by you so you can say why.*
   **A release candidate that is `BEHIND` `main`** (each release leaves `main` one version-bump commit
   ahead of `rc/next`) is not updated by a push to `rc/next`, nor by GitHub's *Update branch* button,
   nor by `--admin`: once the rulesets are applied, the `rc/next` ruleset refuses all three. Sync first,
   as a slice: a branch cut from `origin/rc/next` with `origin/main` merged into it, a PR into `rc/next`
   labelled `semver:patch`, merged by this skill like any slice. The repository's delivery route says
   which escape line its documentation check needs (`workspace/README.md`, *Releasing the candidate*,
   step 0, in this workstation's repository).
10. **The gate verdict.** *Held by `review/quality-assurance`.* A later `REQUEST-CHANGES`, a malformed
    verdict or the retired boundary literal makes it red even after an approval.
11. **The lens, on a harness diff into `rc/next`.** *Held by `review/agents-lead`.* The release
    candidate is not lens-gated, as the removed command did not gate it.
12. **On the release candidate, the owner's go.** His own comment authorizing the merge, cited by URL on
    the verdict's `authorization:` line. *An instruction*: the status reads the verdict's header, not
    the citation.

**When a status is missing although the comment is there.** The statuses are posted by a workflow that
runs from the base branch on a push and from the default branch on a comment. Until that workflow is on
the base and default branches, or when a run failed, re-run the newest `review-status` run for the head
(`gh run list --workflow review-status.yml --repo OWNER/REPO`, then `gh run rerun ID --repo OWNER/REPO`).
Where the repository carries the evaluator, its dry run prints the same three decisions and posts
nothing: `node .github/scripts/review-status.js --pr N --dry-run` from a checkout. **Until the rulesets
are applied to the repository, no status is required by anything**: the dry run, or reading the
conditions above, is then the whole check, and you merge only when every one of them holds.

## The merge

One command, a real merge commit pinned to the head you read in step 1:

```
gh pr merge N --repo OWNER/REPO --merge --match-head-commit HEAD_SHA
```

Never `--squash`, `--rebase`, `--auto` or `--admin`. A refusal from GitHub is the answer: report it, do
not look for another way in. The rulesets allow only the merge method, so a squash is refused whatever
its spelling.

## After the merge: the proof the removed verify gave

- **A slice:** `gh pr view N --repo OWNER/REPO --json state,mergeCommit` shows `MERGED` and a merge
  commit. No tag or release is expected. Report the merged pull request.
- **The release candidate:** do not announce a release until all of these hold:
  1. the pull request is `MERGED` with a merge commit;
  2. the newest run of the version workflow for the pull request's head succeeded
     (`gh run list --workflow version-main.yml --repo OWNER/REPO --json headSha,event,conclusion,databaseId`);
  3. the latest release is published, neither draft nor prerelease, and its numeric SemVer tag is
     newer than the version before the merge (`gh release view --repo OWNER/REPO --json tagName,isDraft,isPrerelease,publishedAt,url`);
  4. that tag contains the merge commit (`git fetch --tags origin`, then
     `git merge-base --is-ancestor MERGE_COMMIT TAG`).

  If publishing failed after a tag was pushed, inspect the tag and the failed step before any re-run, so
  the version is not bumped twice.

## What holds this, at its real level

The rulesets are *written* here; they hold nothing until the owner applies them to a repository. Once
applied, GitHub refuses a merge whose required statuses are not green, whatever command is used. The
statuses are only as trustworthy as who can write them: anyone with write access can post a comment the
workflow accepts, and any workflow of the repository with permission to write statuses can post one
under the same name. Conditions 8 and 12, and this skill itself, are instructions.
