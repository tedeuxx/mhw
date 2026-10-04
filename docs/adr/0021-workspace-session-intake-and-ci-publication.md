# 0021 — Workspace session intake and CI publication at improvement-session completion

- **Status:** accepted owner requirements, 2026-10-02; mechanisms and evidence scoped below.
- **Date:** 2026-10-02
- **Deciders:** the owner

## Context and problem

The conversation preferences had been committed and installed but never pushed or released. The owner
requested workspace-level enforcement, automatic publication through CI **at the end of each
improvement session**, and an initial choice between harness improvement and bugfix on every new
workspace session, carried in the managed workstation configuration.

## Decision drivers

- Completion must mean published, not just locally committed or installed.
- Preserve paced questions: a pause or final answer to a doubt is not closure of an improvement session.
- No repeat approval for the owner-authorized commit/push/PR/CI/merge/release path.
- New-session intake has two explicit choices; do not invent a third path against the latest request.
- Checks must reject stale or unrelated evidence and never weaken security to complete publication.

## Considered options

1. **Declared workspace lifecycle with checked publication commands and CI release.** Selected.
   Portable shared gate, instructions and native carriers; trade-off: agents must invoke the gate.
2. **A Stop hook that publishes on every turn.** Rejected: cannot reliably tell a clarification pause
   from session closure, violates cadence and can publish incomplete changes.
3. **Background filesystem watcher or unconditional main pushes.** Rejected: publishes partial edits
   and bypasses the coherent session boundary and PR checks.

## Decision outcome

`workspace/session-policy.json` declares the intake and completion contract. The managed global brief
recognizes it. Project AGENTS.md, the Claude import/commands/SessionStart reminder and Kiro steering
carry the same contract. The user-level picker guard permits exactly two specified labels only for
this declared workspace intake; other path decisions retain three choices.

The merge command enforces clean local state, exact pushed PR head, current main ancestry, one valid
SemVer label and successful checks including `delivery-ci`. CI creates the version tag and GitHub
Release in one job. The verifier requires a merged PR for the exact session head, green CI, a newer
stable published release containing that merge, and a successful version workflow for that head.
Authentication/network errors fail closed. The owner-selected session mode remains in conversation
context; no prompt, answer, sensitive detection record or transcript is persisted by these controls.

### Coverage and limits

- The merge/verify commands and CI gate enforce the checks when executed; instruction-following
  governs calling them and choosing the correct session boundary.
- Claude Code startup context injection is registered in project settings, not measured loaded in a
  fresh real session. Other harnesses carry instructions; no Codex hook trust is granted by the agent.
- SessionStart is context injection, not a guarantee that a picker displays or that its selection is
  followed. The hook's two-choice exception is structurally tested separately.
- At inspection time, main had no branch protection/ruleset. This change does not claim server-side
  enforcement over every direct GitHub operation or add a protection that would silently break the
  established bump bot. It provides a checked, mandatory-by-instruction workspace delivery path.
- Closing an app, network loss, unavailable credentials and user cancellation can interrupt delivery.
  These leave a pending session; they are not silent success or a promise of background execution.
- A release failure after tag push needs targeted repair; blindly rerunning would bump twice.

## Consequences

### Good

- The owner's initial classification and end-of-session publication expectations are explicit.
- Publication proof is executable, repeatable and tied to the actual session rather than any green
  workflow or old tag. A GitHub Release makes the version directly available to adopters.
- Existing question cadence and firewall controls remain intact; two-choice intake cannot disable
  the count/length guard or bypass other decision-picker rules.

### Bad

- Native startup and end-of-session enforcement still differ by harness; instructions are not a wall.
- CI availability is part of delivery latency, and a green local test run is insufficient.
- Owner/workflow tokens and GitHub branch settings can still permit operations outside this route.

## Links

- [Workspace procedure](../../workspace/README.md)
- [Version policy](0002-automatic-semver-cut-policy.md)
- [Paced dialogue and three paths](0019-paced-conversation-and-three-path-decisions.md)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Actions token event behavior](https://docs.github.com/en/actions/concepts/security/github_token)

Vendor documentation checked 2026-10-02. No new minimum harness version or universal hook coverage
is claimed. The existing current session is not restarted for an intake choice introduced mid-session.

## Amendment 2026-10-04: a type declared in the first prompt is accepted without the picker

**Owner decision (2026-10-04).** The session type the owner declares explicitly in his first prompt
is accepted as given. The `Session type` picker is now the fallback, shown only when no type was
declared. This narrows the intake above: ~~an initial choice between harness improvement and bugfix
on every new workspace session~~ an initial session type on every new workspace session, taken from
the first prompt when declared there and asked with the two-choice picker otherwise.

- **Why.** A first prompt that already says `Melhoria de harness` (or `Bugfix`) made the picker a
  repeated question with a known answer, an interruption against the paced-conversation profile
  (ADR-0019) that added no information.
- **What counts as declared.** An explicit statement of one label (`Melhoria de harness`, `Bugfix`)
  or mode name (`improvement`, `bugfix`). The agent confirms it in one line. A type is never inferred
  from the task described, and a preselected default is still forbidden: with no declaration, the
  picker runs and the agent waits.
- **Carriers changed together.** `workspace/session-policy.json` gains
  `"entry_declared_in_first_prompt": "accept"` (schema version stays 1: the field is additive),
  and the same rule is written into `AGENTS.md`, `CLAUDE.md`, the Claude Code SessionStart reminder
  (`workspace/startup.py`), the `/session-start` command and its Codex skill copy, the Kiro steering
  file, `workspace/README.md` and the global brief (`global/AGENTS.md`, rendered into
  `overlay/desktop-instructions.md`).
- **Unchanged.** The two-choice picker exception of ADR-0013 and the configured `intake_exception`
  of [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md) stay as they are: when the picker is
  shown it is still exactly two labels in order. Resume and compaction still do not restart intake.
- **Evidence level.** *Written and tested*: `workspace/delivery_test.py` asserts the policy field,
  the SessionStart context and that every carrier states the declared-type rule. The SessionStart
  hook fires before the first prompt exists, so honouring a declaration is instruction-following, not
  a mechanical check. The user-level briefs change on the reference machine only when the owner
  reinstalls; until then the installed global brief still carries the picker-first wording.
