---
name: "handoff"
description: "Print a prompt and the shell line that open a fresh session continuing this one: the session objective (or the argument when none is anchored), the anchored Issue with its revision, handoff state and next act re-derived from the tracker, and the launch command for this agent harness. Use when the context is heavy or the owner wants to resume in a clean session. Prints only; posts nothing. Not for asking what is left (see what-else)."
purpose: "a session can be continued in a fresh one without losing its anchor or publishing anything"
---

Print a prompt that continues this session in a fresh one, and the shell line that opens it. This copy
is rendered for the agent harness `{{agent-harness}}`. `$ARGUMENTS`, when given, is the objective to use
if none was anchored.

## When to use

- The context is heavy, or the owner wants to resume the same work in a clean session.
- Not to ask what is left: that is `what-else`. Not to branch a second, parallel session: the fresh
  session replaces this one.

## Build the prompt

Re-derive every field from the tracker, not from memory of this conversation:

1. **Objective.** The native goal where the agent harness has one (`/goal`) and it is set; otherwise
   the objective agreed at session start; otherwise `$ARGUMENTS`. If there is none at all, say so in one
   line and stop: a prompt with no objective cannot be continued.
2. **Anchored Issue.** The Issue the objective names, read with `gh issue view <n> --repo <owner/repo>
   --comments`. With no Issue anchored, the prompt still prints, built from the objective alone, and
   says that no Issue is anchored.
3. **Revision.** The repository, branch and commit the work stands at (`git -C <repo> rev-parse HEAD`
   and the branch name). `unknown` when there is none.
4. **Handoff state and next act.** The latest effective `handoff` or `checkpoint` worklog event's
   `handoff.state` and `next_act`, read as the worklog contract's *Resuming* section reads them. If no
   event carries one, compose both from the tracker: the open pull request, its head, its checks and the
   verdict naming that head. The next act is one act, stated as an act.
5. **Evidence.** Public references only: a pull request, a check run, a verdict comment, a path inside
   the repository.

The worklog continuity contract bounds every field: **one line each, at most 280 characters**, facts and
the next act and nothing else. No reasoning, drafts or notes for next time. Sanitise it under the
workstation brief: no secret, no personal data, no employer or client material, and no machine-local
path (`/Users/`, `/tmp/`, `~/`, `/home/`, `/private/`, `/var/folders/`, `file://`, a drive path,
`.brand`). Name a file by its path inside the repository.

## The prompt

Fill this template. Drop a line whose field is empty; keep the first line and the last two.

```
/goal <the objective, one line>
Continue <owner/repo>#<n> in this fresh session; the session that printed this prompt stops now.
Revision: <owner/repo> <branch> <commit>
State: <handoff state>
Next act: <the one act to perform first>
Evidence: <one public reference>
Before acting, re-derive the state from the tracker: gh issue view <n> --repo <owner/repo> --comments.
This prompt says where the work was; the tracker says where it is. Do not work in the same checkout as the old session.
```

With no Issue anchored, the second line reads `No Issue is anchored; continue the objective above in
this fresh session; the session that printed this prompt stops now.`, and the tracker line names the
open pull requests and Issues the objective mentions instead.

## Print it

1. Write the filled prompt to a file outside every repository (the session scratchpad, or the system
   temporary directory).
2. Run `python3 {{method-scripts}}/launch-line.py {{agent-harness}} <that file>`. It quotes the prompt for
   a POSIX shell (zsh, bash), deterministically, and prints the line that opens this agent harness with
   it. It refuses a prompt whose first line does not open with `/goal`, a line over 280 characters, or a
   machine-local path; fix the prompt and run it again. It reads the file only when it resolves under
   the system temporary directory or the current work tree, is a regular file and holds at most 64 KiB.
   Never quote the prompt by hand.
3. Print, inline, in this order: the prompt as filled, then the script's output, exactly as printed.
   The owner pastes the launch line into a terminal; where the output carries a line for an IDE, that
   line tells him what to do there instead.
4. Then stop working in this session. Two sessions on one checkout overwrite each other's work.

The launch line names the agent harness's command (`claude`, `codex`, `kiro-cli`). Where the
workstation's paste wrapper is installed, those names reach it; a prompt passed as an argument is not
cleaned by the wrapper, so the sanitising above is the clean-up. On Windows the line is for a POSIX
shell and does not apply to PowerShell; paste the prompt into a new session instead.

## What this command never does

- It posts nothing: no comment, worklog event, label, Issue or pull request. It prints only (owner,
  2026-10-18).
- It never launches the new session itself; the owner opens it.
- It never merges, publishes or releases anything, and it never adds a hook.
- It never widens the objective; new work goes to the owner as a proposal.
