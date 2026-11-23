# 0002 — Automatic numeric SemVer on merge, with a cut policy for a policy-set artifact

- **Status:** ~~proposed~~ accepted (2026-11-17, the owner's ratification recorded on [Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6956016947); see the amendment "2026-11-17: accepted" below)
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
- The tooling is ~~bump-my-version (owner's instruction)~~ a Node script since 2026-11-18 (see the
  amendment of that date), and versions are numeric only.

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
  ~~`bump-my-version bump <part>`~~ `node src/commands/release-bump.js <part>` (since 2026-11-18),
  which commits and creates an annotated tag. It then pushes both with
  `--follow-tags`. A concurrency group serializes runs. Third-party actions are pinned to full commit
  SHAs~~, and bump-my-version is pinned by version~~.

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
- ~~Bad: bump-my-version is pinned by version, not by hash.~~ *(Struck 2026-11-18: the bump is this
  repository's own Node script, reviewed with the diff; see the amendment of that date.)*

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
[#52](https://github.com/tedeuxx/mhw/issues/52), verbatim:

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
| ~~**major**~~ | ~~A **breaking change**: a consumer of the workstation must change something on his side. Examples: the install or update interface (commands, arguments, layout an adopter relies on), or the version-key contract that projects declare.~~ |
| ~~**minor**~~ | ~~An **incremental feature**, with nothing a consumer must change. This includes **adding or removing a control** when no consumer has to change anything.~~ |
| ~~**patch**~~ | ~~A **bug fix**: something that did not do what it declared now does. Also any change with **no behaviour change**, such as docs, tests and CI.~~ |

*(Rows struck 2026-10-10: replaced by the table in the 2026-10-10 amendment below.)*

**The patch row's second sentence extends the owner's rule; it is not his wording.** He named three
categories, but every pull request still needs exactly one label, and a docs-, test- or CI-only change
fits none of them. Patch is the lowest part, and that change alters no behaviour, so it goes there.
The coordinator decided this on review of the pull request that introduced this amendment and reports
it to the owner. It stands until he ratifies or changes it.
*(Historical since 2026-10-10: the row it describes is struck; see the 2026-10-10 amendment.)*

When a change fits more than one row, the highest row wins. That rule is unchanged, and it is also what
sets the release-candidate label: each pull request carries exactly one `semver:major|minor|patch`
label, and the release-candidate pull request `rc/next` → `main` carries the **largest** part among
the changes it contains.

**Forward only.** The new table applies from the next release candidate on. Tags already cut are not
re-classified or re-cut.

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

## Amendment — 2026-10-10: incremental changes are patch

**Status unchanged: proposed.**

The owner, 2026-10-10, verbatim. The context: release-candidate pull request #115 carried
`semver:major` and would have cut v5.0.0.

> "mal comecamos a trabalhar nele ja ta em 5.0.0"
> "eu normalmente estabeleco regras objetivas de major minor e patch"
> "breaking changes (major), minor (novas funcionalides), patch (bugfixes/versoes intermediarias)"

Asked what "versoes intermediarias" means:

> "mudanças incremetnais"

On the resulting table:

> "de acordo"

In English: we have barely started working on it and it is already at 5.0.0; he normally sets
objective rules for major, minor and patch: breaking changes (major), minor (new functionality),
patch (bug fixes and intermediate versions). Intermediate versions means incremental changes. He
agreed with the table below.

### Cut policy (replaces the 2026-10-06 table)

| Part | Cut when |
| --- | --- |
| ~~**major**~~ | ~~A **breaking change**: something that worked stops working the same way for an existing user.~~ |
| ~~**minor**~~ | ~~A **new functionality**.~~ |
| ~~**patch**~~ | ~~A **bug fix**, or an **incremental change** to something that already exists. Docs, tests and CI are included here.~~ |

*(Rows struck 2026-11-23: replaced by the public-interface table in the 2026-11-23 amendment below,
which ~~awaits the owner's ratification~~ the owner ratified on 2026-11-23 ([Issue #587](https://github.com/tedeuxx/mhw/issues/587#issuecomment-7112877579)).)*

**What changed from the 2026-10-06 table.** An improvement to existing functionality (UX, messages, a
behaviour adjustment) is now **patch**; under the 2026-10-06 table it was minor. **Minor** is reserved
for something new.

**Adding or removing a control** is classified by the same three tests: a new functionality is
minor; if an existing user's setup stops working the same way, it is major; otherwise it is patch.
**This classification is the agent's reading of the owner's table, not his words.** It stands until
he ratifies or changes it.
*(Since 2026-11-23 this classification is replaced by the 2026-11-23 amendment below: a control
removed or weakened is minor or patch, and the release notes must say so; only a break of the public
interface is major. That amendment ~~awaits the owner's ratification~~ was ratified on 2026-11-23
([Issue #587](https://github.com/tedeuxx/mhw/issues/587#issuecomment-7112877579)).)*

**Unchanged:** when a change fits more than one row, the highest row wins, and the release-candidate
pull request carries the largest part among the changes it contains. Everything listed under "What
did not change" in the 2026-10-06 amendment still holds, and the rule still applies forward only.

### Considered options

1. **The plain three-line rule above** (chosen). Trade-off: "new functionality" versus "incremental
   change" is a judgement, so two people can label the same change differently, and the label check
   still proves only that one label is present.
2. **An objective rule keyed on paths and a list of contracts** (rejected). The agent proposed
   classifying a change by which files it touches and whether it alters a listed contract. It would be
   more mechanical, but it needs a list kept current as the repository changes, and the owner set it
   aside in favour of the plain three-line rule he already uses.

### Consequences

- Good: improvements to what already exists no longer raise the minor part, so the version grows more
  slowly while the workstation is young.
- Good: minor now means *something new is available*, which an adopter can read from the number.
- Bad: removing a control that leaves an existing setup working the same way is a patch, so the number
  says even less than before about being less protected. The release notes have to say it; nothing
  checks that they do.
- Bad: the boundary between new functionality and incremental change has no objective test.

### Clarification — 2026-10-10: tightening a control is patch

**The owner's ruling.** Review of PR #118 argued that tightening the deny floor was major, because
agents could run `terraform plan` and read `.env` before and now cannot. The owner was asked whether
"something that worked stops working the same way for an existing user" covers restricting what the
agent may do, with three options:

- minor: the user is the human, and a new rule kind is new functionality;
- major: the agent counts as a user;
- patch: tightening a control is always incremental, even with a new mechanism.

He picked **"Patch"** over minor and major.

**The rule.** Tightening a control, which restricts what an agent may do, is **patch**, even when it
introduces a new rule mechanism. "Existing user" in the major test means the **human**. The agent's
capabilities are not part of the breaking test. Where this narrows the agent's reading of controls
above ("a new functionality is minor"), this clarification governs for a tightening.

**Consequence.** The version number does not signal that agents lost capabilities. Only the release
notes do, and nothing checks that they say it.

## Amendment 2026-11-17: accepted ([Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6956016947))

The owner ratified this record on 2026-11-17, answering a picker in session with *"Ratificar"*; the ruling is recorded on
[Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6956016947). The status moves from proposed to
accepted. Parts already struck or superseded stay so. Earlier sentences here saying the status stays
proposed, or that a part awaits ratification, are dated readings that this amendment supersedes.
Ratification changes no evidence level stated above: it installs, loads or enforces nothing.

The ratified cut table is the 2026-10-10 one: **major** for a breaking change, **minor** for new functionality, **patch** for a bug fix or an incremental change, docs, tests and CI included.
*(Since 2026-11-23 that table is replaced by the public-interface table of the 2026-11-23 amendment
below; that amendment ~~awaits the owner's ratification~~ was ratified on 2026-11-23
([Issue #587](https://github.com/tedeuxx/mhw/issues/587#issuecomment-7112877579)). The ratification recorded here is unchanged.)*

## Amendment 2026-11-18: the bump is a Node script ([#473](https://github.com/tedeuxx/mhw/issues/473), S02 of [#470](https://github.com/tedeuxx/mhw/issues/470))

**What changed.** The tool only. `version-main.yml` runs `node src/commands/release-bump.js <part>`
instead of bump-my-version 1.5.1, and the job no longer sets up Python or installs a package with pip.
The Node requirements document for this repository (decision D8) asked for it: one runtime for CI and
release tooling. The bump-my-version entry in `global/prerequisites.json` is removed with it.

**What did not change.** The cut policy (the 2026-10-10 table, ratified 2026-11-17), numeric-only
versions, the mandatory single `semver:` label, the cut on a merged pull request into `main`, the
configuration file and its name (`.bumpversion.toml`, read by other parts of this repository until
slice S32 of #470), the commit message and tag message `bump: {current_version} → {new_version}`, the
`v{new_version}` tag, and the files bumped in the one commit (`.bumpversion.toml` and `package.json`).
*(Since 2026-11-23 the cut policy is the public-interface table of the 2026-11-23 amendment below,
which replaces the 2026-10-10 table ~~and awaits the owner's ratification~~ and was ratified on
2026-11-23 ([Issue #587](https://github.com/tedeuxx/mhw/issues/587#issuecomment-7112877579)); the rest of this list still
holds.)*

**How parity is held.** `test/release/bump.test.js` runs the script on a throwaway repository holding
this repository's real `.bumpversion.toml` and `package.json`, and compares the commit message, the
tag name, type and message, and the file diff with transcripts recorded from bump-my-version 1.5.1
itself (`test/golden/S02/`), for major, minor and patch. With `MHW_BUMP_MY_VERSION` set, it also runs
the two tools side by side.

**Where it is stricter, on purpose.** Each case refuses before anything is written:

- a current version that is not exactly `MAJOR.MINOR.PATCH`: bump-my-version 1.5.1 matched the parse
  pattern as a prefix and dropped a suffix (measured: `10.1.0-rc1` was cut as `10.1.1`);
- a tag that already exists: bump-my-version made the commit and then failed on the tag;
- a configuration key the script does not implement.

### Considered options

1. **A small Node script in this repository (chosen).** No third-party code runs while the job holds a
   `contents: write` token, and the pinned-by-version consequence above goes away. Trade-off: this
   repository now owns the bump logic, and only the golden test keeps it equal to the tool it replaced.
2. **An npm package that bumps versions.** Less code here, but a new dependency, fetched and run in the
   job that can push to `main`.
3. **Keep bump-my-version.** No work, but Python stays in the release path, against decision D8.

### Consequences

- Good: no Python, pip or `python -c` in the release path; every action in the job is pinned by SHA.
- Good: a non-numeric version or a stale tag stops the job before a commit exists.
- Bad: a regression in the script is found on the next release candidate merge to `main`, after the
  owner's go, unless the tests catch it first. The scratch-clone test bumps a clone of the checkout in
  the pull request's CI to lower that risk; it does not run the workflow itself.
- Bad: `npm-shrinkwrap.json` carries the package version too, and neither tool bumps it (parity keeps
  that). Whether it matters is not settled here.

This amendment installs, loads and enforces nothing on the reference machine; it changes a CI job.

## Amendment 2026-11-23: a major only on a break of the public interface ([#587](https://github.com/tedeuxx/mhw/issues/587))

**Status of this amendment: ~~proposed, awaiting the owner's ratification~~ accepted 2026-11-23 ([owner's ratification](https://github.com/tedeuxx/mhw/issues/587#issuecomment-7112877579)).** The
owner answered *"Ratifico"* ("I ratify") on Issue #587. The record itself stays accepted (2026-11-17).
~~Until he ratifies it, the table below is the cut policy he chose and the agents apply, not a ratified
one.~~ *(Struck 2026-11-23: ratified.)* Ratification installs, loads or enforces nothing.

The owner, 2026-11-23, recorded on [PR #585](https://github.com/tedeuxx/mhw/pull/585#issuecomment-7108104263)
and in section 8 of the [CLI native baseline requirements document](../mhw-product-requirements-document-cli-native-baseline.md),
translated from Portuguese:

> "also make the normalisation of the semver standard part of this version"
> "we were generating too many majors, it makes no sense. The current semver rule must have problems."

Asked which rule should replace it, he chose **"public interface"**.

**Why the 2026-10-10 table still produced too many majors.** Its major row (*"something that worked
stops working the same way for an existing user"*) has no boundary: almost any change to a skill, a
brief, a verdict literal or a control changes how something works for someone. Of the slices merged
into `rc/next`, 11 carried `semver:major` (#90, #92, #95, #114, #199, #208, #214, #237, #423, #445,
#525), and since the release candidate takes the largest label it contains, each of them made its
release a major: v6.0.0 to v10.0.0 in 20 days (the requirements document's reading of the tags, not
re-measured here). Most were not changes to what a user installs or types. The label counts were
re-measured on 2026-11-23 (166 merged slices when first measured that day and 168 at the last
re-run, the count growing as slices merge; the same 11 majors both times):

```
gh pr list --repo tedeuxx/mhw --state merged --base rc/next --limit 400 --json number -q 'length'
gh pr list --repo tedeuxx/mhw --state merged --base rc/next --label semver:major --limit 400 --json number -q '[.[].number]'
```

### The public interface

mhw declares a public interface, and only a break of it is a major. It is two things:

- **the `mhw` CLI**: the commands `install`, `update`, `uninstall`, `status`, `check` and `mcp`
  (`render`, `launch`, `check`), with their options, as section 4 of the CLI native baseline
  requirements document defines them;
- **the overlay schema** the user writes.

Everything else (the method, its skills and briefs, the controls, the docs, the tests, CI) is not
interface: a user does not type it or write it.

### Cut policy (replaces the 2026-10-10 table)

| Part | Cut when |
| --- | --- |
| **major** | A break of the public interface: a command or option of the mhw CLI is removed or changes meaning, or the overlay schema the user writes becomes incompatible. |
| **minor** | A new functionality, including a new control, skill or harness. |
| **patch** | A fix, or an incremental change to something that exists: method, skills, briefs, controls, docs, tests, CI. |

**A control removed or weakened is minor or patch by this table; the release notes must say so.**
Nothing checks that they do. The 2026-10-10 clarification (tightening a control is patch) agrees with
this table and still holds.

**Unchanged:** numeric-only versions, the mandatory single `semver:` label, the `semver-label` check
on pull requests into `main`, the cut on a merged pull request into `main`, the Node bump script (the
2026-11-18 amendment), the highest row winning when a change fits more than one, and the release
candidate carrying the largest part among the changes it contains.

**Forward only.** Labels already applied and tags already cut are not re-cut. The release that ships
the CLI native baseline (v11) is itself the major that sets this interface: the commands it removes
leave in that one major.

**The label check names the rows.** When `semver-label` fails, its message prints the three rows of
this table. `test/release/semver-label.test.js` reads this amendment's table and fails when the
workflow's text drifts from it.

### Considered options

1. **Majors only on a break of a declared public interface (chosen).** Trade-off: a change that alters
   how an agent behaves, or removes a protection, never moves the major part, so the number tells an
   adopter less about being less protected; the release notes carry that, unchecked. The interface has
   to be kept current when a command or option is added.
2. **Keep the 2026-10-10 table and label more carefully** (rejected). It needs no new definition, but
   the rule itself has no boundary, which is what produced eleven majors; care does not supply one.
3. **Classify by paths touched** (rejected again, as on 2026-10-10). More mechanical, but it needs a
   path list kept current, and a CLI option can change meaning in a file shared with internal code.

### Consequences

- Good: a major means *a command, an option or the overlay you wrote no longer works as before*, which
  an adopter can check against his own use.
- Good: method, skill and control work, the bulk of this repository's slices, no longer raises the
  major part.
- Bad: a control removed or weakened is visible only in the release notes, and nothing checks that the
  notes say it.
- Bad: "changes meaning" is still a judgement, and the label check still proves only that one label is
  present.

This amendment installs, loads and enforces nothing on the reference machine; it changes a rule and a
CI message.
