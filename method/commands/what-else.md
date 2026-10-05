---
name: "what-else"
description: "Answer what is left against the session's anchored objective: restate it (from the native /goal where the agent harness has one), read the session's Issues, open pull requests and recorded owner decisions on the issue tracker, and report what is done with evidence, what is left, what waits on the owner, and the next step. Use when the owner asks how far the session is from its goal. Read-only."
purpose: "any session, in any agent harness, can recover and bound its own scope from the shared bus, so it neither drifts nor stops short without saying what is left"
argument-hint: "<optional: the objective, if none was anchored>"
---

Report what is left against this session's objective. `$ARGUMENTS`, when given, is the objective to
use if none was anchored.

## The anchored objective

- **Native first:** where the agent harness has a native goal command (`/goal`) and a goal is set, that
  goal is the objective. Read it from there.
- Otherwise use the objective agreed at session start (the first reply that stated it), or
  `$ARGUMENTS`.
- If there is none at all, say so in one line, propose one from the session's Issues, and stop: an
  answer against no objective cannot say what is left.

## Read the bus

The issue tracker is the communication bus between sessions, so read it, not only this conversation:

- **The session's Issues:** those named in the objective or in this session, with their comments
  (`gh issue view <n> --comments`). A `## Return to the parent session` comment is a child session's
  result.
- **Open pull requests** of those Issues (`gh pr list --state open --search "<n>"`), with their checks
  (`gh pr checks <pr>`).
- **Recorded owner decisions:** his comments on those Issues and pull requests. A decision only in this
  conversation and not on the tracker is reported as **not recorded**.

Read the minimum: the named Issues and their pull requests, not the whole backlog.

## The answer

In this order, short:

1. **Waiting on the owner:** the one ask first, labelled, if there is one.
2. **Objective:** one line.
3. **Done:** each item with its evidence (a merged pull request, a commit, a check run, a comment link).
   No evidence, not done.
4. **Left:** what the objective still needs. Work outside the objective is named as **out of scope**,
   not counted as left.
5. **Next step:** one.

## What this command never does

- It writes nothing: no comment, label, Issue, branch or file. It only reads and reports.
- It never merges, publishes or releases anything, and it never adds a hook.
- It never widens the objective; new work goes to the owner as a proposal.
