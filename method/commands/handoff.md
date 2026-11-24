---
name: "handoff"
description: "Print one block the owner pastes into a new terminal to open a fresh session continuing this one: one command that changes into the checkout and runs the target agent harness's start command with the continuation prompt inline (objective, anchored Issue, revision, state and next act re-derived from the tracker). The target defaults to the current agent harness. With no argument, when this session's last message asks the owner to do something in another agent harness, the block targets that harness with the ask inline instead, and this session keeps running. Use when the context is heavy, the owner wants to resume in a clean session, or he must act in another agent harness. Prints only; posts nothing. Not for asking what is left (see what-else)."
argument-hint: "[claude-code|claude|codex|kiro|kiro-cli] [objective, used only when none is anchored]"
purpose: "a session can be continued in a fresh one without losing its anchor or publishing anything"
---

Print one block that opens a fresh session continuing this one, or, in the one case *Continuation or
ask* names, a session in another agent harness that carries out an ask of this one. The block is exactly one command: `cd`
into the checkout the work stands in, then the launch environment and the target agent harness's own
start command with the prompt inline as its argument. Pasted into any terminal, it starts
the right session; nothing else is typed.
This copy is rendered for the agent harness `{{agent-harness}}`.

## Continuation or ask

Decide this first, before *The arguments*. The prompt is an **ask** only when all of these hold;
otherwise it is a **continuation**, exactly as below, and nothing in this section applies:

1. `$ARGUMENTS` is empty. Any argument gives a continuation, and `/handoff {{agent-harness}}` (this
   agent harness named as the target) forces one.
2. Your own last message to the owner carries an ask he has not answered yet, and the ask is an act he
   must carry out in another agent harness (for example: open Codex and approve its prompt hook with
   `/hooks`). Read only that message and only its most recent unanswered ask; an ask from earlier in
   the session, or one you would infer from the work, does not count.
3. That ask names exactly one agent harness, it is one of the three targets in *The arguments*
   (`claude-code`, `codex` or `kiro`, an alias read as its target), and that target is not this one,
   `{{agent-harness}}`. A harness with no target here (the Kiro IDE, a desktop app) or an ask naming
   two harnesses fails this. ~~run `mhw launch-line --resolve {{agent-harness}} <its id>`~~ *(struck
   2026-11-24, mhw#599: `mhw launch-line` left the CLI; you resolve the target yourself, by the table
   below.)*
4. The ask is tied to an Issue, so the result has somewhere to go back to.

When any of these is in doubt, it is a continuation. This is a judgement you make from your own last
message, not a check: nothing stores a pending ask, and nothing verifies that you read it right.

## The arguments

`$ARGUMENTS` is `[target] [objective]`. Only its first word can name the target, and only when it is
exactly, case and all, one of these five words:

| first word | target |
|---|---|
| `claude-code` or `claude` | `claude-code` |
| `codex` | `codex` |
| `kiro` or `kiro-cli` | `kiro` |

When it is, the word is **consumed**: that is the target, and the objective is the rest of
`$ARGUMENTS`. Otherwise it is **kept**: the target is this agent harness, `{{agent-harness}}`, and the
objective is the whole of `$ARGUMENTS`. `Claude`, `ship` or `$x` name no target. ~~Decide it with the
script, not by eye: run `mhw launch-line --resolve`~~ *(struck 2026-11-24, mhw#599: the command left the
CLI, and the table above is the whole of what it decided.)* To give an objective
that starts with one of those words, name the target first: `/handoff claude-code codex settings fix`.
The objective from the arguments is used only when none was anchored.
For an ask, there are no arguments: the target is the one *Continuation or ask* resolved.

## When to use

- The context is heavy, or the owner wants to resume the same work in a clean session.
- The owner must do something in another agent harness that this session asked of him: he types
  `/handoff` alone and gets that harness's start command with the ask inline (*Continuation or ask*).
- Not to ask what is left: that is `what-else`. Not to branch a second, parallel session: a
  continuation replaces this one. An ask is the one exception, and it changes no file in the checkout.

## Build the prompt

Re-derive every field from the tracker, not from memory of this conversation:

1. **Objective.** The native goal where the agent harness has one (`/goal`) and it is set; otherwise
   the objective agreed at session start; otherwise the objective from the arguments. If there is none
   at all, say so in one line and stop: a prompt with no objective cannot be continued.
2. **Anchored Issue.** The Issue the objective names, read with `gh issue view <n> --repo <owner/repo>
   --comments`. With no Issue anchored, the prompt still prints, built from the objective alone, and
   says that no Issue is anchored.
3. **Revision.** The repository, branch and commit the work stands at (`git -C <repo> rev-parse HEAD`
   and the branch name). `unknown` when there is none.
4. **Checkout.** The top of the work tree the work stands in (`git -C <repo> rev-parse
   --show-toplevel`), a worktree included. It goes into the block's `cd`, never into the prompt. With
   no repository at all there is nothing to change into: say so in one line and stop.
5. **Handoff state and next act.** The latest effective `handoff` or `checkpoint` worklog event's
   `handoff.state` and `next_act`, read as the worklog contract's *Resuming* section reads them. If no
   event carries one, compose both from the tracker: the open pull request, its head, its checks and the
   verdict naming that head. The next act is one act, stated as an act.
6. **Evidence.** Public references only: a pull request, a check run, a verdict comment, a path inside
   the repository.

The worklog continuity contract bounds every field: **one line each, at most 280 characters**, facts and
the next act and nothing else. No reasoning, drafts or notes for next time. Sanitise it under the
workstation brief: no secret, no personal data, no employer or client material, and no machine-local
path (`/Users/`, `/tmp/`, `~/`, `/home/`, `/private/`, `/var/folders/`, `file://`, a drive path,
`.brand`). Name a file by its path inside the repository.

## The prompt

Fill this template. Drop a line whose field is empty; keep the first line and the last two. Nothing is
typed in the new session before it starts working: the prompt is its first message.
~~The prompt carries its own `/goal` line~~ *(struck 2026-11-01, #198: the owner ruled that a fresh
session does not start with `/goal`, and «o handoff tem que sempre ser um comando de inicio da sessao de
harness com prompt inline». The prompt opens with the objective as plain text, and you refuse a
prompt whose first line opens with `/goal` (*Check it*, below).)*

```
Objective: <the objective, one line>
Continue <owner/repo>#<n> in this fresh session; the session that printed this prompt stops now.
Revision: <owner/repo> <branch> <commit>
State: <handoff state>
Next act: <the one act to perform first>
Evidence: <one public reference>
Before acting, re-derive the state from the tracker: gh issue view <n> --repo <owner/repo> --comments.
This prompt says where the work was; the tracker says where it is.
```

~~`Do not work in the same checkout as the old session.`~~ *(struck 2026-11-01, #198: the command now
changes into the checkout itself, and the session that printed it stops, so the two never share it.)*

With no Issue anchored, the second line reads `No Issue is anchored; continue the objective above in
this fresh session; the session that printed this prompt stops now.`, and the tracker line names the
open pull requests and Issues the objective mentions instead.

## The ask prompt

For an ask, fill this template instead of the continuation one. Every line stays: write `none` in the
`Owner-only:` field when the ask holds no act reserved to the owner. The `Objective:`, `Revision:` and
Issue fields come from *Build the prompt*, with the ask as the objective.

```
Objective: <the ask, one act, one line>
Carry out this one ask for <owner/repo>#<n>; the session that printed this prompt keeps running and waits for the result.
Revision: <owner/repo> <branch> <commit>
Ask: <the act the printing session asked the owner to carry out in this agent harness, one line>
Owner-only: <the acts in the ask only the owner may perform, or none>; guide the owner to each one and never perform it yourself.
Change no file in this checkout: the session that printed this prompt works in it.
Return: post the result on <owner/repo>#<n> with gh issue comment <n> --repo <owner/repo> --body-file <a file>, then tell the owner it is posted.
Before acting, read the Issue: gh issue view <n> --repo <owner/repo> --comments.
```

Owner-only acts include granting hook trust (the workstation brief: never grant hook trust yourself),
a merge he holds, a credential and an act on an external surface only he can reach. The prompt routes them to the owner;
it never asks the new session to perform them.

The template opens with `Objective:` and never with a slash command. *Hypothesis, not measured:* a
prompt passed as the start command's argument that opens with `/` (such as `/hooks`) may run as that
agent harness's own command instead of reaching it as a message. Do not put a slash command first.

## Native resume or a fresh launch

**A handoff is a fresh launch: the block below starts a new session with the prompt inline.** Each
agent harness also has a native resume, which reopens an earlier conversation **with its whole
context**. That is the opposite of what a handoff is for, so use it only when the owner asks to reopen
this same conversation (a closed terminal, say) and the context is not the reason for the handoff.
Never use it after a configuration change: the workstation brief says resume is not a substitute for a
fresh session. ~~`mhw launch-line` printed the block~~ *(struck 2026-11-24, mhw#599: the command left
the CLI; you write the block yourself, by the rule in *Quote it*.)*

Each form below was **read from that version's own `--help` on 2026-11-24 (documented); none was run,
and no session was started to measure it.**

| target | fresh launch, the prompt inline | native resume |
|---|---|---|
| `claude-code` (Claude Code 2.1.331) | `claude '<prompt>'`: the `[prompt]` argument | `claude --continue` (the most recent conversation in the current directory) or `claude --resume <session-id>` |
| `codex` (Codex CLI 0.163.0) | `codex '<prompt>'`: the `[PROMPT]` argument | `codex resume --last` (the most recent session; the picker is filtered to the current directory unless `--all`) or `codex resume <SESSION_ID>` |
| `kiro` (Kiro CLI 3.5.0) | `kiro-cli chat '<prompt>'`: the `[INPUT]` argument, "the first question to ask" | `kiro-cli chat --resume` (the most recent conversation from this directory) or `kiro-cli chat --resume-id <SESSION_ID>` |

The Kiro IDE takes the same prompt as `kiro chat '<prompt>'` (`kiro chat --help` 1.3.11, as this
command recorded it before mhw#599; not re-read); the block does not print it, and no IDE resume form is
documented here. The Claude Code and Kiro resume forms read the current directory, and the Codex picker
is filtered by it, so a resume block is `cd '<checkout>' && <the resume form>`, with no prompt.

## Quote it

**You quote the block yourself, by this rule, for a POSIX shell (zsh, bash). Never improvise it.**

- **The whole prompt goes inside one pair of single quotes**, `'…'`. Inside single quotes the shell
  changes nothing: `$`, backticks, `"`, `\`, `!` and newlines reach the agent harness as typed.
- **Each single quote in the prompt becomes the four characters `'\''`**: close the quote, an escaped
  quote, reopen. Nothing else in the prompt is escaped, and nothing is removed.
- **The checkout is quoted the same way**, whatever it holds.
- The block is one line of shell (the prompt's own newlines stay inside its quotes):
  `cd '<checkout>' && claude '<prompt>'`, `cd '<checkout>' && codex '<prompt>'` or
  `cd '<checkout>' && kiro-cli chat '<prompt>'`.
- **Fence it with one more backtick than the longest run of backticks in the line**, three at least, so
  a backtick run in the prompt cannot close the fence.
- **No launch environment.** The method declares no launch variable today, so the block carries no
  `NAME=value` prefix. ~~`LAUNCH_ENV` in mhw's `src/commands/launch-line.js`~~ *(struck 2026-11-24,
  mhw#599: the list left with the command; it was empty.)* ~~today `HARNESS_SWEEP_ORIGIN`, the origin (or
  space-separated origins, mhw#220 D7) the chrome-devtools server is bounded to~~ *(struck 2026-10-29,
  mhw#224 decision D8: the chrome-devtools server has no origin bound, so nothing reads that variable.)*
  If the next act needs a variable at launch, say so to the owner instead of adding one: declaring a
  launch variable is a reviewed change to this command. A secret the next act needs stays where it lives
  and is named in the prompt by its name only.

## Check it

**Before you print, check the filled prompt and the checkout. If any check fails, fix the prompt and
check again; never print a block that fails one.** These are the refusals the deleted command made,
now yours to apply:

- the prompt is not empty, and its first line never opens with `/goal` (#198: a fresh session does not
  start with `/goal`);
- no line is over 280 characters;
- no machine-local path anywhere (`/Users/`, `/tmp/`, `~/`, `/home/`, `/private/`, `/var/folders/`,
  `file://`, a drive path such as `C:\`, `.brand`), in any letter case;
- no control character: a terminal control such as `^C`, ESC, TAB or a carriage return, and no
  bidirectional control (U+202A to U+202E, U+2066 to U+2069). The prompt's own line breaks are the
  only control it carries;
- the checkout is an absolute path to an existing directory holding a `.git` entry, with no control
  character or line break in it.

This is a string check you make by reading, not a guarantee: copied private content carries none of
those strings and passes, and the sanitising rule in *Build the prompt* is what covers it.

## Print it

1. Fill the prompt, check it (*Check it*) and quote it (*Quote it*) into one fenced block, with the
   target from *The arguments* (or the ask's target) and the checkout from *Build the prompt*.
2. End your reply with that block, and nothing after it. Do not print the prompt separately, do not
   refer to it from another line and add no instruction around the block: the prompt is inside it.
   The output is the block alone, for every target, Kiro included.
   ~~For the Kiro target the output opens with one line for the Kiro IDE: the block is for Kiro CLI,
   and the IDE takes the same block with `kiro chat` in place of `kiro-cli chat`.~~ *(Struck
   2026-11-01, #198: that line was text around the command. The Kiro IDE is named above instead.)*
   **On Windows, end your reply instead with the filled prompt in one fenced block, and nothing after
   it.** The block is for a POSIX shell: PowerShell reads its `'\''` differently, so an apostrophe in
   the prompt would arrive corrupted. Check the prompt anyway, but do not print the quoted block:
   do not print its output. Fence the prompt with more backticks than any run of backticks
   inside it. The owner opens a new session and pastes the prompt as its first message.
3. Then stop working in this session, for a continuation. Two sessions on one checkout overwrite each
   other's work. **For an ask, do not stop:** keep working and wait for the result on the Issue. The
   ask prompt tells the new session to change no file in the checkout; that is an instruction to
   it, and nothing enforces it.

~~Run `mhw launch-line <target> <that file> --cd <the checkout> [--env NAME=VALUE]...`~~ *(struck
2026-11-24, mhw#599: the command, its prompt file and its 64 KiB read limit left the CLI; *Quote it*
and *Check it* carry what it did.)* ~~The block runs in the terminal's current
directory; open the terminal in a different checkout from the old session's.~~ *(Struck 2026-11-01,
#198: that was a second step handed to the owner. The block now starts with `cd` into the checkout, so
it runs the same from any directory.)* ~~Where the workstation's paste wrapper is installed, a prompt
passed as an argument is not cleaned by it, so the sanitising above is the clean-up.~~ *(Struck
2026-11-24, mhw#590: the workstation has no paste wrapper any more.)* Nothing cleans a prompt passed as
an argument, so the sanitising above is the clean-up. On Windows the block does not apply: step 2 prints
the prompt instead.

**What holds this, at its real level: an instruction.** Nothing runs the checks or the quoting for
you, and nothing verifies that the block you print parses. The method's test suite applies the
quoting rule as written to a synthetic prompt and parses the result under `sh`, `bash` and, where it is
installed, `zsh`, so the rule is checked; whether a session follows it is not.

## What this command never does

- It posts nothing: no comment, worklog event, label, Issue or pull request. It prints only (owner,
  2026-10-18).
- It never launches the new session itself; the owner opens it.
- It never merges, publishes or releases anything, and it never adds a hook.
- It never widens the objective; new work goes to the owner as a proposal.
- It never performs an ask's owner-only act, and its ask prompt never hands one to the new session.
