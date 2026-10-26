---
name: "handoff"
description: "Print one block the owner pastes into a new terminal to open a fresh session continuing this one: the launch environment and the target agent harness's start command with the continuation prompt inline (objective, anchored Issue, revision, state and next act re-derived from the tracker). The target defaults to the current agent harness. Use when the context is heavy or the owner wants to resume in a clean session. Prints only; posts nothing. Not for asking what is left (see what-else)."
argument-hint: "[claude-code|claude|codex|kiro|kiro-cli] [objective, used only when none is anchored]"
purpose: "a session can be continued in a fresh one without losing its anchor or publishing anything"
---

Print one block that opens a fresh session continuing this one: the launch environment, then the target
agent harness's own start command with the continuation prompt inline as its argument. This copy is
rendered for the agent harness `{{agent-harness}}`.

## The arguments

`$ARGUMENTS` is `[target] [objective]`. Only its first word can name the target, and only when it is
exactly one of `claude-code`, `claude`, `codex`, `kiro` or `kiro-cli`. Decide it with the script, not by
eye: run `python3 {{method-scripts}}/launch-line.py --resolve {{agent-harness}} <the first word>` (with
no argument at all, omit the word; a first word carrying anything but letters and hyphens cannot name
a target, so omit it too). Its first output line is the target; its second is `consumed` when
the word named the target, so the objective is the rest of `$ARGUMENTS`, or `kept` when it did not, so
the target is this agent harness and the objective is the whole of `$ARGUMENTS`. To give an objective
that starts with one of those words, name the target first: `/handoff claude-code codex settings fix`.
The objective from the arguments is used only when none was anchored.

## When to use

- The context is heavy, or the owner wants to resume the same work in a clean session.
- Not to ask what is left: that is `what-else`. Not to branch a second, parallel session: the fresh
  session replaces this one.

## Build the prompt

Re-derive every field from the tracker, not from memory of this conversation:

1. **Objective.** The native goal where the agent harness has one (`/goal`) and it is set; otherwise
   the objective agreed at session start; otherwise the objective from the arguments. If there is none at all, say so in one
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

Fill this template. Drop a line whose field is empty; keep the first line and the last two. The prompt
carries its own `/goal` line, so nothing is typed in the new session before it starts working.

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

1. **Launch environment.** Name every environment variable the next act reads only at launch (a
   variable an MCP server or the agent harness reads when it starts, such as an origin a browser
   server is bounded to). Each becomes `--env NAME=VALUE`. A value is public: no secret, no personal
   data, no machine-local path; a secret the next act needs stays where it lives and is named in the
   prompt by its name only. With none, pass no `--env`.
2. Write the filled prompt to a file outside every repository (the session scratchpad, or the system
   temporary directory).
3. Run `python3 {{method-scripts}}/launch-line.py <target> <that file> [--env NAME=VALUE]...`, with
   the target from *The arguments*. It quotes the environment and the prompt for a POSIX shell (zsh,
   bash), deterministically, so `'`, `$`, backticks and newlines reach the new session intact, and
   prints one fenced block. It refuses a prompt whose first line does not open with `/goal`, a line over
   280 characters, a machine-local path, a control character (a terminal control such as `^C`, ESC
   or TAB, or a bidirectional control), or an `--env` that is not a variable name, names a loader or
   interpreter variable such as `PATH`, or whose value is unsafe; fix it and run it again. It reads the file only when it resolves under the system temporary
   directory or the current work tree, is a regular file and holds at most 64 KiB. Never quote the
   prompt by hand.
4. End your reply with the script's output, exactly as printed, and nothing after it. Do not print the
   prompt separately, do not refer to it from another line and add no instruction around the block:
   the prompt is inside it. For the Kiro target the output opens with one line for the Kiro IDE: the
   block is for Kiro CLI, and the IDE takes the same block with `kiro chat` in place of `kiro-cli chat`.
5. Then stop working in this session. Two sessions on one checkout overwrite each other's work.

The block names the target's start command and its documented argument for an initial prompt: `claude
'<prompt>'` (the `[prompt]` argument of `claude --help`), `codex '<prompt>'` (Codex's `[PROMPT]`
argument of `codex --help` 0.163.0) and `kiro-cli chat '<prompt>'` (the `[INPUT]` argument of `kiro-cli
chat --help` 2.34.1, "the first question to ask"); for the Kiro IDE, `kiro chat [prompt]` from `kiro chat
--help` 1.3.11. Each is read from `--help`, none run. The block runs in the terminal's current directory; open the
terminal in a different checkout from the old session's. Where the workstation's paste wrapper is
installed, those names reach it and an environment prefix reaches the agent harness through it; a
prompt passed as an argument is not cleaned by the wrapper, so the sanitising above is the clean-up. On
Windows the block is for a POSIX shell and does not apply to PowerShell; paste the prompt into a new
session instead.

## What this command never does

- It posts nothing: no comment, worklog event, label, Issue or pull request. It prints only (owner,
  2026-10-18).
- It never launches the new session itself; the owner opens it.
- It never merges, publishes or releases anything, and it never adds a hook.
- It never widens the objective; new work goes to the owner as a proposal.
