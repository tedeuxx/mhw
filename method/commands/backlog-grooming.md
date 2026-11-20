---
name: "backlog-grooming"
description: "Refine the whole open backlog of the current repository before a sprint: read every open Issue in partitioned read-only dispatches, give each exactly one verdict (keep, rewrite, merge, close with a named criterion, type, propose ready, owner action, cross-repository twin), find duplicates and overlaps across the summaries, write a dated record, and put the whole proposal to the owner as ONE activation before any write. After his confirmation it applies the rulings and hands off to sprint-planning; it never creates a milestone. Use when the owner asks to groom, refine or consolidate the backlog before planning one sprint that drains it."
purpose: "give backlog refinement one bounded pass with one confirmation, so consolidation and closing are reviewed together, no acceptance criterion is lost in a merge, and sprint planning starts from a backlog that says what it means"
---

Refine the whole open backlog of the current repository, then hand off to `/sprint-planning`.

**The name is the owner's; the Scrum Guide calls this activity *Product Backlog refinement*.** It is
the ongoing act of breaking down and further defining backlog items, and this command is one bounded
pass of it before a sprint. The owner asked for it as a typed command, so it is one, and the name stays
`/backlog-grooming`.

## When to use

- The owner asks to groom, refine or consolidate the backlog, or to plan one sprint that drains it.
- Before `/sprint-planning`, when the open backlog has drifted: duplicates, untyped Issues, stale
  premises, items only he can do.

Not for filing new work (`/new-issue`) and not for composing the sprint (`/sprint-planning`). Not for
`content`: a `content` piece is selected one at a time and never drained, so it never enters the sprint.

## The shape: unattended, then ONE confirmation, then the writes

Steps 1 to 5 are the loop's work and write nothing on the tracker. Step 6 is the owner's, once. Steps 7
and 8 run only after he confirms. **No comment, label, edit or close happens before step 6.**

## Steps

### 1 · Read the loop mode and its scope

Read the record of the repository you are in:

```
grep -m1 '^loop-mode: ' docs/loop-mode.md
grep -m1 '^loop-mode-repos: ' docs/loop-mode.md
```

Refuse an unrecognised or missing `loop-mode:` value by name. The backlog this command grooms is the
current repository's. `loop-mode-repos` names the repositories `/sprint-planning` will plan over;
record it for the handoff. Never infer the mode from what a query returns (the `orchestration` skill,
*The loop-mode contract*).

### 2 · Enumerate every open Issue, and fail loudly at the limit

```
gh issue list --repo <owner>/<repo> --state open --limit 200 \
  --json number,title,labels,milestone,updatedAt --jq 'length'
```

**If the count equals 200, stop and say so**: the list may be truncated, and grooming a subset while
reading it as complete is the failure this step exists to prevent. Otherwise list them with the same
query and the fields above. Never type a milestone or a label you have not seen into a query.

### 3 · Read them in partitioned read-only dispatches

Bodies and comments are long, so do not read them all in the main session. Split the numbers into
partitions of a size one dispatch can read whole (about 40k characters of body and comments each).
Dispatch one read-only reader per partition, isolated: `agents-lead` for `loop` and untyped Issues,
`product-lead` for `product` ones. Each reads `gh issue view <n> --repo <owner>/<repo> --comments` for
its partition and returns, per Issue, a summary of at most five lines and exactly one proposed verdict
(below), with its evidence.

**A reader writes nothing.** It returns its summaries; it posts no comment and applies no label.

### 4 · The verdicts, and the seam pass over the summaries

Each Issue gets **exactly one** verdict:

| verdict | what it proposes |
|---|---|
| **keep** | unchanged |
| **rewrite** | a corrected body; the old body is kept verbatim in the record |
| **merge into #M** | the source is folded into the target and closed |
| **close** | with one named closing criterion: superseded, implemented elsewhere, premise no longer holds, or tracking costs more than rediscovering (`agents-configuration`, *Closing an issue is a step, with a criterion*) |
| **type** | a proposed routing label (`loop`, `product` or `content`) for an Issue that has none |
| **propose ready** | the description is closed on its lane; it needs `sp:N` before it can be planned |
| **owner action** | only the owner can do it (a credential, an install, an external surface); it stays outside the sprint |
| **cross-repository twin** | a counterpart in another repository; flag it, never consolidate across repositories |

Rules the verdicts obey:

- **"Premise no longer holds" needs a measured command and its output.** Without one, the verdict is
  **keep**, with a note to re-verify. A stale-looking item may still be true.
- **An Issue the owner opened is never closed on a reader's opinion alone.** Every close carries its
  criterion and its evidence, and nothing closes before his confirmation in step 6.
- **`content` Issues are never proposed for the sprint.** Untyped Issues get a proposed type; typing
  is applied only after his confirmation.

Then run **one seam pass over the summaries**, in the main session or one more dispatch: find Issues
that claim the same behaviour, overlap at their edges, or depend on each other in prose (`Blocked by`,
`after #N`). Overlap becomes a **merge** proposal; a dependency is recorded so `/sprint-planning` can
order it. The pass reads summaries, not bodies, so its cost stays bounded.

### 5 · Write the record

Write `docs/backlog-grooming/<YYYY-MM-DD>.md`, in English, on a branch, before the activation:

- the enumeration count and the command that produced it;
- one row per Issue: number, title, verdict, criterion and evidence;
- **for every Issue a verdict would touch (rewrite, merge source and target, close, type), its current
  body and its acceptance-criteria lines, verbatim**, so nothing the verdict removes is lost;
- the dependencies the seam pass found, the owner actions and the twins;
- an empty *Ruling* section, filled in step 6.

Also give the owner a short executive summary in his language (the owner overlay), linking the record.
The record is the depth; the summary is what he reads.

### 6 · ONE owner activation, before any write

This is a decision, so it follows the escalation rules in force (the user brief's **Escalating to the
owner**, the owner overlay, and the `orchestration` skill's *How to ask the owner*). One picker, the
counts in the stem (for example *N keep, N merge, N close, N type, N ready, N owner action*), the record
linked, and three options:

| option | what happens |
|---|---|
| **confirm** | step 7 applies every verdict in the record |
| **confirm with changes** | he names what moves; apply his changes to the record, then step 7 applies the result. No second activation |
| **discard** | nothing is written on the tracker; the record stays as the reading, marked discarded |

If he asks a question instead, answer it and wait; a question, silence or elapsed time is not a
confirmation. Record his ruling **verbatim** in the record's *Ruling* section, with the date.

### 7 · Apply, only after confirmation

All bodies go through `--body-file` (the `shell` skill).

1. **Comment on each affected Issue** quoting his ruling and linking the record.
2. **Merges.** Add a `## Consolidated from #N` section to the target carrying the source's acceptance
   criteria verbatim. **Before closing the source, check every one of its acceptance-criteria lines is
   in the target**: for each line, `gh issue view <M> --repo <owner>/<repo> --json body --jq .body`
   and an exact `grep -F` of the line. Any miss stops that merge. Then close the source naming the
   target.
3. **Closes**, each with its criterion and its evidence in the closing comment.
4. **Rewrites** with `gh issue edit <n> --body-file`, the old body already in the record.
5. **Labels**: the confirmed routing types, and `ready` on the `loop` items he confirmed ready (on
   `loop`, `ready` is his decision and the main session applies it).
6. **Estimates.** Each newly ready `loop` item gets `sp:N`: isolated `agents-lead` and
   `quality-assurance` dispatches, the median applied (`agents-configuration`, *Estimation*;
   `/planning-poker`). Other lanes use their own estimator sets.

Open the record's pull request with its *Ruling* filled. It goes through the normal review route.

### 8 · Hand off to sprint-planning

Say the handoff in one line: `/sprint-planning <iteration title>` over the repositories in
`loop-mode-repos`. **This command creates no milestone and admits nothing to one**; composing the
sprint is that rite's, confirmed by the owner there.

## What this command never does

- It writes nothing on the tracker before the owner's confirmation in step 6.
- It never creates, edits or closes a milestone, and never admits an Issue to one.
- It never consolidates across repositories, and never puts a `content` Issue in a sprint.
- It never closes an Issue on "premise no longer holds" without a measured command and its output.
- It never opens a new Issue: findings the owner wants tracked he names, and they are filed by
  `/new-issue`.
- It never merges a pull request, publishes, releases or installs anything, and never adds a hook.

## What nothing enforces

All of it is an instruction. No hook or check observes the activation, the order of the writes, or the
criteria grep. The record's verbatim copies make a lost criterion recoverable; they do not prevent one.
