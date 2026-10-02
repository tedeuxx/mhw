# 0002 — Automatic numeric SemVer on merge, with a cut policy for a policy-set artifact

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** the owner (the cut table below awaits his ratification)

## Context and problem

Adopters replicate this policy set on their own workstations. For them, the version number answers one
question: *do I need to do something, and am I less protected if I don't?* That makes the usual
"breaking API change" test the wrong one. Here a change is breaking if it leaves an existing adopter less
protected or forces them to act. The owner asked for an automatic tag pipeline, built on
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
| **major** | An existing adopter must act, or ends up less protected: a control removed or weakened, an incompatible change to the install layout or overlay schema, a raised minimum harness version, or an OS/harness dropped. |
| **minor** | A new protection, or new OS/harness support, with no action required from existing adopters. |
| **patch** | A fix to a control that did not do what it declared, docs, tests. |

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
  weakened control labelled `minor`, is caught only by review.
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
