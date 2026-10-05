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
  merges it without his explicit go. After his merge, the install and the fresh-session canary are
  his too.

Every merge is a real merge commit, never a squash or a rebase. A blocked or unfinished slice stays
pending; a pause for questions publishes nothing.

## Publishing a slice

1. Run the relevant local checks, inspect the diff, and commit all intended non-secret changes on a
   feature branch cut from a fresh `origin/rc/next`. Do not sweep unrelated work into the commit.
2. Push normally, open the PR with `--base rc/next`, and give it exactly one
   `semver:major|minor|patch` label.
3. After CI and the review gate, run `python3 -B workspace/delivery.py merge --pr NUMBER` from the
   slice branch checkout. For a PR into `rc/next` it requires every job that the `tests` workflow's
   `delivery-ci` aggregates (read from `.github/workflows/tests.yml`) to be registered on the head by
   the `tests` workflow, plus `delivery-ci` and Sonar green. `semver-label` is not required there,
   because that workflow runs only on PRs into `main`. A pending check, a missing `tests` run (a
   "CLEAN" PR on which no tests ran) and a merge state other than clean (DIRTY, BEHIND, UNKNOWN...)
   are refused. It also reads the review gate from the PR's comments, because the plugin's merge
   floor cannot see this script's own merge. Only a strict header on the **first three lines** of a
   comment counts. Lines are compared whole, and nothing below the header is read, so text in a
   fence, a blockquote or the prose can neither supply nor override a verdict. The newest trusted
   comment that opens with each envelope wins, so a later `REQUEST-CHANGES`, a later open lens or a
   later malformed header refuses. `quality-assurance` must open its comment with these three lines,
   which are exactly the plugin's own required verdict shape. Line 2 is `APPROVE-AND-MERGE` or
   `APPROVE-AND-MERGE-BOUNDARY`; any other literal refuses. Anything may follow line 3.

   ```
   <!-- gatekeeper-verdict: quality-assurance -->
   APPROVE-AND-MERGE
   head: <the full 40-character head SHA>
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
   A marker posted for an earlier head never carries forward here. **Authorship is not proven:** every persona posts
   through the owner's account, so "trusted author" means `OWNER`, `MEMBER` or `COLLABORATOR`, not
   "this persona wrote it". The plugin's own merge floor has the same limit. It merges
   with `--merge --match-head-commit SHA`, never a squash. No force push, no admin bypass.
4. Run `python3 -B workspace/delivery.py verify --pr NUMBER`. For a slice, exit 0 means the PR is
   merged into `rc/next` with its checks green at the exact local head; no tag or release is
   expected.

## Releasing the candidate (the owner's go)

1. Open or update the PR `rc/next` → `main` with one semver label.
2. On the owner's go, run `python3 -B workspace/delivery.py merge --pr NUMBER` from a checkout of
   `rc/next`. It refuses a head branch other than `rc/next`, dirty workspaces, a different/unpushed
   head, a stale base, a non-clean merge state, missing labels, a missing `tests` run and
   incomplete or failed checks. The stable `delivery-ci` job requires every test matrix to pass; the
   semver and Sonar checks must also be present and successful. Only the most recent run of each
   check on the head counts: a re-run that passed supersedes an older failure of the same check, and
   a newer failed or still running re-run blocks. A Sonar check not yet registered is pending, not
   permission to race ahead of analysis.
3. `version-main` bumps with bump-my-version, atomically pushes the bump commit and numeric tag, and
   creates a published GitHub Release in the same CI job. Tag-triggered downstream workflows are not
   assumed: the Actions token normally does not trigger them.
4. Run `python3 -B workspace/delivery.py verify --pr NUMBER` from the same checkout. Exit 0 means the
   exact local head's PR is merged, its checks and version workflow succeeded, and a newer published
   stable release contains the merge commit. Exit 1 means pending or blocked, including network/auth
   failures. Never reinterpret it as success. Report the release link only after exit 0.

`delivery.py` refuses any PR into `main` whose head branch is not `rc/next`: a slice never goes
straight to `main`. Bases other than `rc/next` and `main` are refused.

## Boundaries and recovery

The merge and verify commands are a mechanical gate for both supported routes. The `rc/next`
route is written and tested against a synthetic `gh` only; no real PR has exercised it yet. Workspace
instructions require agents to use it; it cannot prevent a human or agent from invoking unrelated
GitHub commands directly, and nothing mechanical stops an agent from merging the release candidate
without the owner's go: that rule is an instruction. No background watcher, detached agent or
scheduler is installed.

If CI fails, fix the failure, push and let fresh checks run. If publishing fails **after** a tag was
pushed, do not blindly rerun the version workflow: first inspect the existing tag and failed step to
avoid an unintended second bump. The verifier stays red until the release is actually available.
No new branch protections or bypass permissions are created by these scripts. At implementation time
GitHub reported `main` unprotected; the checked merge route is not server-wide enforcement.

Tests: `python3 -B workspace/delivery_test.py`. Python 3.9+, authenticated GitHub CLI and Git are
required for delivery. The same Python gate works across operating systems; cross-OS CI validates
the pure gate logic, not live account authorization.
