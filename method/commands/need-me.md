---
name: "need-me"
description: "Answer the owner's question \"do you need me for anything?\": gather what is pending on him (this session, the session's Issues and pull requests, open owner-action Issues in the workstation repository), then put each item to him one at a time under the existing escalation rules: a decision as one native picker with exactly three options, an action as one line with the act and the link. Records his answer on the Issue or pull request it belongs to. Use when the owner asks whether you need him. If nothing is pending, says so in one line."
purpose: "the owner can pull every pending decision or action from any session on demand, one ask at a time, without the agent manufacturing an ask or restating the escalation rules in a weaker form"
---

The owner is asking whether you need him for anything. Find what is pending on him, then ask it one
item at a time.

## The rules this command runs

This command adds no escalation rule of its own. It runs the rules already in force, in this order of
precedence, and where two differ it follows the stricter:

- the user brief's section **Escalating to the owner**, which every agent harness on this workstation
  loads;
- the **owner overlay** below it: language, escalation limits and path decisions;
- the `orchestration` skill's **How to ask the owner**, where it is installed.

Read those sections now; do not work from this summary of them. In short, and only as a pointer: one
ask per message; the ask goes first and labelled; the question stem is at most 280 characters, or the
limit the overlay sets; the reasoning goes in an artifact he can open, linked from the message; and
**decision or action** decides the form. Decide what is yours: anything reversible that you have the
evidence for is not his, so decide it and report it instead of asking.

## Gather what is pending

Read the minimum, scoped to this session; never the whole backlog.

1. **This session.** Anything you were about to ask him, an owner decision a slice is blocked on, and
   an act you cannot perform yourself (a merge into `main`, a release, an install, a credential, a
   native trust prompt, an external surface).
2. **The session's Issues and pull requests.** Those named in the objective or in this session:
   `gh issue view <n> --repo <owner/repo> --comments` and `gh pr view <n> --repo <owner/repo>
   --comments`. A pending item is a question to him that has no answer from him yet, a `blocked` label
   that waits on him, or a pull request whose gate verdict at its current head leaves the act to him.
3. **The owner-action queue** in the workstation repository, `tedeuxx/mhw` (the repository
   `mhw status` reads it from). Where `mhw` is on PATH, its count is the `owner-action` line of
   `mhw status --summary`, which already says `not read (<reason>)` instead of a false 0. To list the
   items, run `gh issue list --repo tedeuxx/mhw --state open --label owner-action --limit 1000 --json
   number,title,url`. **An empty list is not yet an empty queue:** `gh issue list` with a label the
   repository does not have also prints `[]` and exits 0. So when the list is empty, confirm the label
   exists with `gh label list --repo tedeuxx/mhw --limit 1000 --json name`. If `owner-action` is not
   among the names, or either call fails, say the queue was **not read** and why. Never report it as
   empty.

Then filter: drop what is yours to decide (above), and drop what is already answered on the tracker.
An answer given only in this conversation counts as an answer, and you record it (below) before you
go on.

## When nothing is pending

Say so in one line, name what you read (for example `Nothing pending: read this session, #12, PR #34
and the owner-action queue.`), and stop. **Never manufacture an ask** to have something to show: an
invented question costs him the context he rebuilds to find that nothing was in question.

## Ask one at a time

Order the pending items by what each blocks, most first. Put **only the first** to him. Never list the
others in the message: where a surface shows only the first, the rest never reached him.

- **A decision** (he supplies judgement): one native multiple-choice picker, the one this agent
  harness offers (in Claude Code, `AskUserQuestion`). Exactly **three** authored, mutually exclusive
  options: one extreme, the opposite extreme, and the middle ground between them. Each has a short
  label and states its risk and expected benefit. Recommend one, on the evidence. Leave the native
  free-text route open; it is not a fourth option. Never invent an unsafe or misleading option to fill
  a position. With no picker, show three numbered choices and wait.
- **An action** (the decision is taken and only his hand remains): one line, the act and the link, for
  example `Merge the release candidate: <url>`. No options, no recommendation. If every option you
  could write is the same act at a different time, it is an action.

The question stem stays within the overlay's limit; the evidence and the reasoning go in a linked
artifact (the Issue, the pull request, or a comment on it), not in the message.

## After he answers

1. **Record it where the decision belongs**: a comment on that Issue or pull request, quoting his
   words, posted with `--body-file` (`gh issue comment <n> --repo <owner/repo> --body-file <file>` or
   `gh pr comment ...`). An action needs no record unless his reply carries a decision; check the
   object's state once he says it is done.
2. If no Issue or pull request owns the item, do not open one; say his answer lives only in this
   conversation.
3. **Offer the next pending item**, alone, the same way. When none is left, say so in one line.

If he asks a question instead of choosing, answer it and wait. A question, silence or elapsed time is
not an answer, and do not repeat the picker while he is clarifying.

## What this command never does

- It writes nothing except the comment that records his answer where the decision belongs: no label,
  no Issue, no branch, no file outside the session scratchpad.
- It never merges, publishes, releases or installs anything, and it never adds a hook.
- It never acts on his answer by itself: carrying out the decision is the session's normal work,
  under its normal gates.
- It never asks two things in one message, and it never asks what is yours to decide.
