# 0002 — Automatic numeric SemVer on merge, with a cut policy for a policy-set artifact

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** the owner (the cut table below awaits his ratification)

## Context and problem

Adopters replicate this policy set on their own workstations. For them, the version number answers one
question: *do I need to do something, and am I less protected if I don't?* ~~That makes the usual
"breaking API change" test the wrong one. Here a change is breaking if it leaves an existing adopter less
protected or forces them to act.~~ *(Struck 2026-10-06: the owner chose the usual breaking-change test;
see the 2026-10-06 amendment.)* The owner asked for an automatic tag pipeline, built on
bump-my-version, that cuts major, minor and patch according to a predefined policy. His standing rule is
purely numeric SemVer, with no pre-release suffix.

## Decision drivers

- An adopter must be able to tell from the number alone whether an upgrade needs action.
- Nothing merges to `main` without a version being cut. No merged state goes unnamed.
- The tooling is bump-my-version (owner's instruction), and versions are numeric only.

## Considered options

1. **Mandatory PR label, bumped on merge.** The author declares the part. A check rejects a PR with
   zero or several labels. Trade-off: the classification is a human judgement, and the check verifies
   only that a label is present, not that it is correct.
2. **Derive the part from conventional-commit subjects.** No label to forget, but the cut policy below
   is about adopter impact. A commit prefix (`feat`, `fix`) does not encode that: a "fix" that tightens a
   deny can force adopters to act.
3. **Manual release on demand.** Full control, but merged states go unversioned, which the owner's ask
   excludes.

## Decision outcome

Chosen: **option 1**.

### Proposed cut policy

| Part | Cut when |
| --- | --- |
| ~~**major**~~ | ~~An existing adopter must act, or ends up less protected: a control removed or weakened, an incompatible change to the install layout or overlay schema, a raised minimum harness version, or an OS/harness dropped.~~ |
| ~~**minor**~~ | ~~A new protection, or new OS/harness support, with no action required from existing adopters.~~ |
| ~~**patch**~~ | ~~A fix to a control that did not do what it declared, docs, tests.~~ |

*(Rows struck 2026-10-06: replaced by the plain-SemVer table in the 2026-10-06 amendment below.)*

When a change fits more than one row, the highest row wins.

### Mechanism

- `.bumpversion.toml`: `current_version = "0.1.0"`, numeric-only `parse`/`serialize`, `commit` and
  `tag` on, tag `v{new_version}`, commit and tag message `bump: {current} → {new}`.
- `.github/workflows/semver-label.yml`: on every PR into `main`, fails unless exactly one
  `semver:major|minor|patch` label is present. Runs with no token permissions.
- `.github/workflows/version-main.yml`: when a PR into `main` is merged, it re-reads the label and runs
  `bump-my-version bump <part>`, which commits and creates an annotated tag. It then pushes both with
  `--follow-tags`. A concurrency group serializes runs. Third-party actions are pinned to full commit
  SHAs, and bump-my-version is pinned by version.

## Consequences

- Good: every merged state has a numeric tag whose part tells an adopter whether to act.
- Bad: **pushing the bump commit to a protected `main` needs a token or a ruleset bypass, and neither
  exists yet.** The repository has no remote. Until a `VERSION_BUMP_TOKEN` (or a bypass for the
  workflow's actor) exists, the workflow falls back to the default token, and the push fails visibly.
- Bad: the label check proves a label is present, not that it is right. Misclassification, above all a
  ~~weakened control labelled `minor`~~ *(struck 2026-10-06: a weakened control is `minor` when no
  consumer has to change anything)* breaking change labelled `minor` or `patch`, is caught only by
  review.
- Bad: the bump runs on the PR `closed` event, not on `push`, so a direct push to `main` cuts no version.
  This is acceptable only while `main` is PR-only.
- Bad: bump-my-version is pinned by version, not by hash.

## Links

- `AGENTS.md`, "Principles", item 3.
- ADR-0001: the MADR discipline this record follows.

## Amendment — 2026-10-02: publish at improvement-session completion

The owner explicitly requires automatic CI publication at the end of each improvement session,
including its push and new version available on GitHub. ADR-0021 adds the workspace contract,
checked merge and publication verifier. `version-main` now atomically pushes its bump commit/tag and
creates a GitHub Release in that same job. The inspection found existing successful version jobs,
remote tag v1.1.0 and no GitHub Releases; the original no-remote statement above is historical.
The cut table remains proposed as a general policy; this feature uses its additive minor category.

## Amendment — 2026-10-06: plain SemVer (breaking, feature, fix)

**Status unchanged: proposed** until the owner ratifies this table.

The owner, 2026-10-06, on
[#52](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/52), verbatim:

> "precisamos revisar a regra de semver agora para evitar muitos tags de major"
> "deveria seguir a regra de major (breaking changes), minor (features incrementais) e patch (bugfixing)"

In English: revise the SemVer rule now to avoid too many major tags; it should follow major for
breaking changes, minor for incremental features and patch for bug fixing.

**Why the original table produced too many majors.** Its major row fired on *a control removed or
weakened*, whether or not anyone had to change anything. The thin-harness direction recorded on #52
(2026-10-04) removes controls as a matter of course, so most slices of that work were labelled major
although an adopter only installed the release as usual. The number then stopped telling an adopter
the one thing it was meant to: whether he has to act.

### Cut policy (replaces the struck table above)

| Part | Cut when |
| --- | --- |
| **major** | A **breaking change**: a consumer of the workstation must change something on his side. Examples: the install or update interface (commands, arguments, layout an adopter relies on), or the version-key contract that projects declare. |
| **minor** | An **incremental feature**, with nothing a consumer must change. This includes **adding or removing a control** when no consumer has to change anything. |
| **patch** | A **bug fix**: something that did not do what it declared now does. |

When a change fits more than one row, the highest row wins. That rule is unchanged, and it is also what
sets the release-candidate label: each pull request carries exactly one `semver:major|minor|patch`
label, and the release-candidate pull request `rc/next` → `main` carries the **largest** part among
the changes it contains.

**What did not change.** Numeric-only versions, bump-my-version, the mandatory single label, the
`semver-label` check on pull requests into `main`, and the cut on merge to `main`.

### Considered options

1. **Plain SemVer, keyed on whether a consumer must change something** (chosen). Trade-off: removing
   or weakening a control is now `minor`, so the number no longer warns an adopter that he is less
   protected after the upgrade. That signal moves to the release notes and the record of the change.
2. **Keep the adopter-protection table** (rejected). It keeps the "less protected" signal in the
   number, but it is the rule that produced the major tags the owner asked to stop; a reader cannot
   tell a major that needs action from one that does not.

### Consequences

- Good: a major again means *you must change something*, which is the question the version answers.
- Good: fewer major tags while the thin-harness work removes controls.
- Bad: "less protected" is no longer visible in the version number. A release that removes a control
  must say so in its notes; nothing checks that it does.
- Bad: the line between "a consumer must change" and "a consumer may want to change" is a judgement.
  The label check still proves only that one label is present.
