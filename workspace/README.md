# Workspace session lifecycle

The workstation's managed global brief recognizes `workspace/session-policy.json`. On each new
session in this repository, ask one native picker: **Melhoria de harness** or **Bugfix**, header
`Session type`. These two options are a specific exception to the general three-path preference.
Wait for the owner. Resume/compaction does not restart intake; ongoing sessions retain their context.
Do not write prompts, answers or transcripts to a session ledger.

Claude Code has a project SessionStart reminder and `/session-start`, `/session-finish` commands.
Codex reads AGENTS.md, Kiro has the always-included project steering carrier, and desktop agents
working with this folder follow its project brief. Only the Claude Code hook registration is written
here; loading and runtime behavior still require the native client to accept/load project hooks.
No Codex trust is changed and no universal native startup picker enforcement is claimed.

## End of an improvement session

The owner authorized publication of every completed improvement session, not every file save or
conversational pause. Finish its coherent scope, then:

1. Run relevant local checks, inspect the diff, and commit all intended non-secret changes on a feature
   branch. Do not sweep unrelated work into the commit. A blocked or unfinished session stays pending.
2. Push normally, open/update its PR into `main`, and give it exactly one `semver:major|minor|patch`
   label. Attach the PR to the current Codex chat when using the app. No repeated owner approval is
   needed for this already-authorized repository publication path.
3. After CI finishes, run `python3 -B workspace/delivery.py merge --pr NUMBER`. It refuses dirty
   workspaces, a different/unpushed head, a stale base, missing labels and incomplete or failed checks.
   The stable `delivery-ci` job requires every test matrix to pass; the semver and Sonar checks must
   also be present and successful. A Sonar check not yet registered is pending, not permission to
   race ahead of analysis. No force push or admin bypass.
4. `version-main` bumps with bump-my-version, atomically pushes the bump commit and numeric tag, and
   creates a published GitHub Release in the same CI job. Tag-triggered downstream workflows are not
   assumed: the Actions token normally does not trigger them.
5. Run `python3 -B workspace/delivery.py verify --pr NUMBER` from the **session feature branch**. Exit
   0 means the exact local head's PR is merged, its checks and version workflow succeeded, and a newer
   published stable release contains the merge commit. Exit 1 means pending or blocked, including
   network/auth failures. Never reinterpret it as success. Report the release link only after exit 0.

Bugfix delivery uses the same gated path when finishing a fix; its intake mode alone does not mean
the owner has closed an ongoing discussion. Pure questions, breaks and confirmations do not publish.

## Boundaries and recovery

This command is a mechanical gate for the supported publication route. Workspace instructions require
agents to use it; it cannot prevent a human/agent from invoking unrelated GitHub commands directly or
force a closed/crashed application to finish work. No background watcher, detached agent or scheduler
is installed. A new session picks up any genuinely incomplete delivery after its intake.

If CI fails, fix the failure, push and let fresh checks run. If publishing fails **after** a tag was
pushed, do not blindly rerun the version workflow: first inspect the existing tag and failed step to
avoid an unintended second bump. The verifier stays red until the release is actually available.
No new branch protections or bypass permissions are created by these scripts. At implementation time
GitHub reported `main` unprotected; the checked merge route is not server-wide enforcement.

Tests: `python3 -B workspace/delivery_test.py`; guard tests are part of the existing POSIX suite.
Python 3.9+, authenticated GitHub CLI and Git are required for delivery. The same Python gate works
across operating systems; cross-OS CI validates the pure gate logic, not live account authorization.
