# Workspace delivery route

`workspace/session-policy.json` declares how a change in this repository reaches a release. There is
no session-type intake: a session starts on the owner's first prompt, with no picker and no startup
hook (owner, 2026-10-05, Issue #60: *"eu removeria. achei que traz mais problemas do que solucao."*).
Do not write prompts, answers or transcripts to a session ledger.

## Who merges what

The owner's rule (2026-10-05, Issue #60): *"os agentes mergeiam no rc/next, só o RC espera mim"*.

- **A slice** is a pull request into the integration branch `rc/next`. Agents merge it on their own
  once the review gate passes: every required check green, the independent lens the change needs
  posted, and the gate's verdict at the PR's current head. No repeated owner approval is needed for
  this.
- **The release candidate** is the pull request `rc/next` → `main`. It waits for the owner: no agent
  merges it without his explicit go. His go is his own comment authorizing the merge; once the gate's
  verdict at the same head cites that comment's URL, `quality-assurance` executes the merge (#133, the
  `merge-authority` contract). ~~After his merge~~ After that merge, the install and the fresh-session
  canary are his.

Every merge is a real merge commit, never a squash or a rebase. A blocked or unfinished slice stays
pending; a pause for questions publishes nothing.

## Publishing a slice

1. Run the relevant local checks, inspect the diff, and commit all intended non-secret changes on a
   feature branch cut from a fresh `origin/rc/next`. Do not sweep unrelated work into the commit.
2. Push normally, open the PR with `--base rc/next`, and give it exactly one
   `semver:major|minor|patch` label: ~~**major** for a breaking change (something that worked stops
   working the same way for an existing user), **minor** for a new functionality, **patch** for a
   bug fix or an incremental change to something that already exists, docs, tests and CI included
   (ADR-0002, 2026-10-10 amendment)~~ **major** only for a break of the public interface (a command
   or option of the `mhw` CLI is removed or changes meaning, or the overlay schema the user writes
   becomes incompatible), **minor** for a new functionality, including a new control, skill or
   harness, **patch** for a fix or an incremental change to something that exists (method, skills,
   briefs, controls, docs, tests, CI) (ADR-0002, 2026-11-23 amendment, ~~awaiting the owner's
   ratification~~ ratified by the owner on 2026-11-23). The
   release-candidate PR carries the largest part among the changes it contains.
3. After CI and the review gate, the executor merges by the `merge-pull-request` method skill
   (#591, [ADR-0045](../docs/adr/0045-delivery-route-on-github-rulesets-and-a-skill.md)).
   ~~run `./mhw delivery merge --pr NUMBER` from the slice branch checkout~~ *(struck 2026-11-23:
   `mhw delivery` left the CLI.)* The skill names every condition the removed command checked and says
   which of them GitHub holds and which are steps. GitHub holds them through the rulesets declared in
   `global/github-repo-settings.json`: on `rc/next` they require `delivery-ci` (every job the `tests`
   workflow aggregates, so a "CLEAN" PR on which no tests ran cannot merge), `scan`, `docs-baseline`,
   `semver-label` (on both bases since #591), Sonar and three review statuses, plus a pull request,
   merge commits only and an up-to-date head (a stale or conflicting head is refused). The skill's
   steps hold the rest: no other check pending or failed (`gh pr checks`), a clean merge state read and
   named, and the owner's go on the release candidate. Then one command, a real merge commit pinned to
   the head that was reviewed:

   ```
   gh pr merge N --merge --match-head-commit SHA
   ```

   **The three review statuses** are posted on the PR's current head by
   `.github/workflows/review-status.yml`, which runs `.github/scripts/review-status.js`: `review/route`
   (a slice from its own branch into `rc/next`; into `main` only from `rc/next`; never from another
   repository), `review/quality-assurance` and, on `rc/next`, `review/agents-lead`. They read the
   review gate from the PR's comments. Only a strict header at the very top of a comment counts: the
   **first four lines** of the gate's verdict, the **first three lines** of the lens marker. Lines are
   compared whole, and nothing below the header is read, so text in a fence, a blockquote or the prose
   can neither supply nor override a verdict. The newest trusted comment that opens with each envelope
   wins, so a later `REQUEST-CHANGES`, a later open lens or a later malformed header turns the status
   red. `quality-assurance` must open its comment with these four lines, the method's required verdict
   shape. Line 2 is `APPROVE-AND-MERGE`, the one clearance literal; any other literal refuses, and the
   boundary literal retired at #134 is refused by name (a verdict is head-scoped, so a merge always
   needs a fresh one). Line 4 is `owner-check: none` or `owner-check:` followed by the one live act the
   owner should do after the merge; a verdict without it is malformed and refuses. Anything may follow
   line 4.

   ```
   <!-- gatekeeper-verdict: quality-assurance -->
   APPROVE-AND-MERGE
   head: <the full 40-character head SHA>
   owner-check: none
   ```

   When the diff from the merge base touches a harness path (`.claude/`, `.codex/`, `.github/`,
   `.agents/`, `.kiro/`, `AGENTS.md`, `CLAUDE.md`, at any depth), `agents-lead` must also open a
   comment with these three lines. Lines 1 and 2 are the plugin's required marker shape. **Line 3
   is this repository's contract, not the plugin's:** the plugin brief asks the lens to say
   `the lens is CLOSED` in those words but fixes no position, so a marker that follows only the
   plugin brief is refused here (fail closed) until line 3 is exactly that sentence. Any other
   line 3 means the lens is open.

   ```
   <!-- harness-lead-verdict: <one-line summary> -->
   commit: <the full 40-character head SHA>
   the lens is CLOSED
   ```

   Line 3 is pinned rather than searched for: finding the sentence anywhere in the body would mean
   parsing fences, blockquotes and prose again, which is where the spoofs this gate refuses lived.
   ~~A marker posted for an earlier head never carries forward here.~~ *(Struck 2026-11-18, the owner's
   ruling on #474: "Mantém sem harness".)* A CLOSED lens marker for an earlier commit carries forward to
   the current head when all three hold, and the status stays pending, naming the one that failed,
   otherwise:

   - **(a)** that commit is an ancestor of the head (`git merge-base --is-ancestor`);
   - **(b)** its merge-bases with `origin/rc/next` (`git merge-base --all`, compared as a set) equal
     the head's, so the base did not move under it;
   - **(c)** the diff from that commit to the head touches no harness path (the list above).

   Only the newest lens marker is considered. It is selected as the `quality-assurance` brief selects
   it: the newest trusted comment that does not open with the gate's envelope and has a line opening
   with `<!-- harness-lead-verdict` at column 0 outside a fenced code block. That comment must then be
   in the strict three-line format above, so a newer open, malformed or preambled marker withdraws an
   earlier closed one. An open marker never carries, and a commit the workflow cannot read refuses.
   The diffs are read with `git diff -z`, so git quotes no path; a path that still starts with a
   double quote counts as a harness path. The release candidate gets no `review/agents-lead`: the
   removed command did not gate it either.

   **When the workflow runs, and which copy.** It runs on `pull_request_target` (a push, an edit, a
   reopen) from the **base** branch's copy and on `issue_comment` from the **default** branch's copy
   (`main`), so a PR can never change the evaluator that judges it; nothing from the PR is checked
   out or run. A status is posted on the head the forge reports at run time, so a moved head has no
   status until the next run: head-scoped by construction. Consequence: comment events act only once
   the workflow is on `main`, and push events only once it is on the base. Until then, after a verdict
   is posted, re-run the newest `review-status` run for the head (`gh run rerun ID`), or run the
   evaluator's dry run from a checkout, which prints the same decisions and posts nothing:
   `node .github/scripts/review-status.js --pr N --dry-run`.

   **Trust: who can make a status green.** "Trusted author" means `OWNER`, `MEMBER` or `COLLABORATOR`,
   that is anyone with write access; every persona posts through the owner's account, so authorship by
   a persona is not proven (the plugin's own merge floor had the same limit). A commit status can also
   be written by any workflow of this repository that holds `statuses: write`, including one a
   same-repository PR adds on a `pull_request` trigger; the ruleset pins each review status to the
   GitHub Actions app, which stops a status written by a personal token but not one written by another
   workflow. Such a PR touches `.github/`, a harness path, so it needs the lens; that is review, not a
   mechanism. ADR-0045 records the model.
4. Prove the merge as the skill's *After the merge* says: for a slice, the PR is `MERGED` into
   `rc/next` with a merge commit; no tag or release is expected. ~~Run `./mhw delivery verify`~~ *(struck
   2026-11-23, #591.)*

## The PROD test, part of the definition of done on every PR

mhw has no STG or PROD environment; its PROD is the owner running `mhw install` on his workstation
(owner, 2026-11-07, Issue #452: *"alem dos dods atuais teria esse que é o teste PROD"*, "besides the current DoDs there would be
this one, the PROD test"). So every PR,
each slice and the release candidate, must also pass the `tests` job
`prod-canary-installed-not-enforced`, which `delivery-ci` aggregates and the rulesets
therefore require (~~`mhw delivery`~~ until #591) (the owner chose every PR over the release candidate only, 2026-11-07). It installs the npm
package packed from the exact head as GitHub serves a tag, fresh and as an upgrade from the latest
published tag, in a clean digest-pinned container on Linux and in a throwaway HOME on macOS, and runs
the canary in `.github/scripts/prod-canary.js` (Node since #501): the installed package carries no
`.py`, `.sh` or `.ps1` file but the ones a later slice of #470 still retires (the job's `CANARY_LEGACY`,
each of which must still be carried); the deny floor in the three user carriers and the admin
layer (in a throwaway root) equals `global/deny-floor.conf` plus the overlay's; the installed prompt
hook blocks a synthetic credential and passes a clean prompt with the paste-wrapper marker unset;
`mhw status` exits 0 and `mhw check` exits 0 but for the required agent harness CLIs and `gh`, which a
throwaway workstation cannot hold; uninstall restores the owner's files.

**Its evidence level is *installed*, never *enforced*.** No agent harness session runs in it, so it shows
nothing about what a harness loads or refuses. Outside it, and still the owner's after the release: the
real `/Library` or `/etc` admin layer, the Keychain, the shell start-up in a real terminal, and the
fresh-session canary in each agent harness. It is the regression evidence for the owner's install
(ADR-0015, 2026-11-08 amendment, ~~proposed~~ accepted 2026-11-18,
[ruling](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6978107613)), not the full ADR-0015 lock: there is no STG and no security
evidence. Run it locally the same way: `node .github/scripts/prod-canary.js pack`, then `run`
against a throwaway work directory, or `node .github/scripts/prod-canary.js container` with podman or
docker (`CONTAINER_RUNTIME`).

## Releasing the candidate (the owner's go)

0. **Sync `main` into `rc/next` first, as a slice.** Each release leaves `main` one commit ahead of
   `rc/next`: the version bump `version-main` pushes. The release candidate is then `BEHIND`, and the
   `main` ruleset requires an up-to-date head. ~~Merge `origin/main` into `rc/next` and push it~~ (how
   commits `61e53ec` and `30ec206` did it) is refused once the rulesets are applied: the `rc/next`
   ruleset requires a pull request and has no bypass, and GitHub's *Update branch* button is a push to
   `rc/next` too. `gh pr merge --admin` is not a route. The route is a slice like any other:
   `git switch -c sync/main-vX.Y.Z origin/rc/next`, then `git merge origin/main` (a real merge commit, so
   the branch is up to date with `rc/next` and contains `main`), push, and open a PR into `rc/next`
   labelled `semver:patch` (the version lines in it are already `main`'s). Its body needs the line
   `docs-baseline: none — a sync of main's version bump into rc/next; it changes no behaviour`:
   measured on a bump-only diff against this repository's manifest, the `docs-baseline` check fails
   the `workstation` capability without it and passes with it. It touches no harness path, so it needs
   no lens; it needs the gate's verdict like every slice, and the executor merges it by the
   `merge-pull-request` skill. Then the release candidate is up to date.
1. Open or update the PR `rc/next` → `main` with one semver label.
2. On the owner's go, the executor merges by the `merge-pull-request` skill (~~`./mhw delivery merge
   --pr NUMBER` from a checkout of `rc/next`~~, struck 2026-11-23, #591). His go is his own comment on
   the PR authorizing the merge; `quality-assurance` then posts a verdict at the same head citing that
   comment's URL and runs the merge (#133, owner decision 2026-11-01). The `main` ruleset requires
   `review/quality-assurance`, so the merge waits for that re-verdict at the head; **nothing reads the
   citation**, so the go itself stays an instruction. ~~This route does not check either~~ *(struck: the
   removed command read no verdict for `main`; the status now does.)* `review/route` refuses a head
   branch other than `rc/next`; the ruleset refuses a stale head and missing or failed required checks
   (`delivery-ci`, `scan`, `semver-label`, Sonar, `docs-baseline`). Only the most recent run of each
   check on the head counts, and a Sonar check not yet registered is pending, not permission to race
   ahead of analysis.
3. `version-main` bumps with the Node script `src/commands/release-bump.js` (~~bump-my-version~~ until
   #473), atomically pushes the bump commit and numeric tag, and
   creates a published GitHub Release in the same CI job. Tag-triggered downstream workflows are not
   assumed: the Actions token normally does not trigger them. The push to `main` is why the `main`
   ruleset keeps one bypass, the repository admin role: an agent acting through the owner's account
   can therefore bypass it too (`gh pr merge --admin`), and not doing so is an instruction.
4. Prove the release as the skill's *After the merge* says (~~`./mhw delivery verify --pr NUMBER`~~,
   struck 2026-11-23, #591): the PR is merged, the newest version workflow run for its head succeeded,
   and the latest release is published, stable, newer than the version before the merge, and contains
   the merge commit. Report the release link only then; a network or auth failure is pending, never
   success.

A slice never goes straight to `main`: `review/route` is red on any PR into `main` whose head branch
is not `rc/next`, and on any PR from another repository.

## Boundaries and recovery

The rulesets are *written and tested* against their schema
(`global/github-repo-settings.schema.json`, `test/review-status/`); **they are not applied** to any
repository. Applying them is the owner's act, recorded as an `owner-action` Issue, and it should follow
the release that puts `.github/workflows/review-status.yml` on `main`, because comment events run the
default branch's copy. Until they are applied, no status is required by anything and the
`merge-pull-request` skill's conditions are the whole check; GitHub reported `main` unprotected when
the removed command was written. The evaluator is tested against synthetic payloads only; no real PR
has exercised it yet. Nothing mechanical stops an agent from merging the release candidate without the
owner's go: that rule is an instruction. No background watcher, detached agent or scheduler is
installed.

If CI fails, fix the failure, push and let fresh checks run. If publishing fails **after** a tag was
pushed, do not blindly rerun the version workflow: first inspect the existing tag and failed step to
avoid an unintended second bump.

~~The command is Node (`src/commands/delivery.js`, #474)~~ *(Struck 2026-11-23, #591: the command, its
tests in `test/delivery/` and the golden transcripts in `test/golden/S03/` are removed; their verdict
and lens cases moved to `test/review-status/`.)* The evaluator imports only `node:` modules, finds
`gh` and `git` on PATH and runs each by its absolute path, never through a shell (`src/lib/gh.js`).
