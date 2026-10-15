---
name: "orchestration"
description: "Apply the three rules the main session applies before it acts: which review a merge request gets for its type, what a loop mode may and may never change, and how to ask the owner anything. Use before dispatching a review, before any pool query or rite, and before any question, decision or action you put to the owner. Not for who closes a description or the state machine (see agents-configuration), the escalation standard's argument (see engineering-standards), or what makes an item ready (see definition-of-ready)."
purpose: "keep the review routing, the loop-mode contract and the ask rules in the method that every project installs, so a project's root brief does not have to carry them and no method file points at a block a project may delete"
---

# Orchestration: the review route, the loop-mode contract, how to ask

This skill is the **only canonical home** of three rules. Each project's root brief used to carry
them, and the method's files pointed at those blocks. The owner moved them into the method (#176:
*"Mover pro mhw"*). A project can now delete its copy without leaving a method file pointing at
nothing.

**Who reads this, and how.** The main session that talks to the owner (the orchestrator) is the
actor that selects a review chain, reads a loop mode and asks the owner. A skill body does not reach a
main session on its own: on every agent harness this method installs to, the main session sees the
skill's name and description and loads the body when it chooses to. **So load this skill before you
route a review, before the first pool query of a drain or rite, and before you put anything to the
owner.** The profiles that need it at dispatch preload it. A project's root brief may name this skill
in one line. It must not restate these rules: one rule in two wordings is how the operative copy ends
up in the surface nobody reads.

## Review is routed by type

The routing labels type an item by what it changes. Each type gets this chain:

| type | review chain |
| --- | --- |
| `loop` | one `agents-lead` lens pass, plus the gate |
| `product` | the leads' lenses as the change warrants, plus the gate |
| `content` | `content-writer` drafts, `content-reviewer` repairs the draft in place (two rounds at most), plus the gate |

- **The gate runs on every merge request, under both of its lenses.** Routing never narrows a gate
  criterion, never removes a hold and never changes a verdict literal.
- **The reader-facing copy criterion fires whatever the type.**
- **A lens the row does not name needs its reason in the dispatch.**
- **A lens's stop condition bounds one pass. Routing bounds how many passes run. No rule keys on a
  round count.**
- **Intake closes the description:** `loop` by `agents-lead` alone, `content` by `product-lead` alone,
  `product` by `product-lead` and `tech-lead` together. Who applies `ready`, and what records each
  transition, is the state table in `agents-configuration`. This list does not restate that table.

## The loop-mode contract

The **record** of which mode is in force is `docs/loop-mode.md` in each repository. It carries the
value, the closed enum, the start date, the work-in-progress bound `wip:` and both pool predicates in
full. **This section is the contract**: what a mode may vary and what it may never touch. Where a
record and this contract disagree, this contract wins and the disagreement is a finding.

1. **A mode names a known agile method and fixes only what the iteration container means and which
   rites run at its edges.**
   - `scrum`: the milestone is a commitment. It is a limb of the pool predicate, and exhausting it
     ends the iteration and hands off to review, retrospective and planning. Items are ranked at
     planning.
   - `kanban`: the same milestone is a period label that bounds nothing. No rite runs at a boundary,
     and work is taken in arrival order with `loop` first.
   - The milestone exists in both modes. Nothing enters a running iteration automatically; composing
     one is the owner's act.
2. **A mode selects a pool predicate and a rite set, never a permission rule.** It may not touch the
   permission floor, the gate and its lenses, head-scoped verdicts, only-the-owner-opens-work, the
   readiness bar (`sp:N` in both modes), the routing labels or the container's existence. `content`
   has no second mode.
3. **A rite trigger keys on elapsed time, never on an empty pool.**
4. **A mechanism that needs the mode is reviewed before it is written.**
5. **Development parallelises; review does not.** At most one merge request is in review at a time,
   whatever `wip:` says. The next goes to the gate only after the previous one merged or was sent
   back.
6. **Rebase onto the current trunk before the gate.** Ask *has the trunk moved since the head I
   attested?*, not only *does a named branch overlap?*. The author resolves conflicts at merge-request
   time.
7. **The sequence inside an iteration is the machine's.** `scrum-master` proposes, the orchestrator
   opens a worktree per slice and dispatches, and there is no per-item approval. Remove a slice's
   worktree after its merge.

**Read the mode from the record before any pool query, and never infer it from a result.** An empty
active milestone ends an iteration in one mode and means nothing in the other, and the two outputs
are byte-identical.

## How to ask the owner

**Rule 1 governs every ask directed to the owner: decisions and actions, inside or outside work in
flight.** A design conversation or an ad-hoc request is not thereby an escalation. Rules 2 to 5 govern
form only where their act applies. An interview stays distinct: it elicits without options.

1. **One owner ask per activation or message.** Two asks are a list, and he rebuilds context twice.
   Ask or order the first. Keep every remaining ask until after he answers, then carry the next to its
   own activation. Never move the remainder into a prose or numbered list: where a surface shows only
   the first, the rest never reached him.
2. **The interruption is a tweet; the context lives in the options**, each stating its consequence in
   its own visible text. Reasoning goes in something he can open.
3. **Enumerate the choices with their consequences; four is a ceiling**, or the exact count the owner
   overlay sets. Use a structured multiple-choice picker where your agent harness has one, prose where
   it has none. An open question in place of a reduction you owed is the failure.
4. **An act you cannot perform, a merge above all, is an order and a link, not a question.** If there
   is no second option you would defend, it is one line: the act and the object. The tell: every
   option is the same act at a different time.
5. **An interview takes no options; an escalation always does.** An interview draws out what he
   thinks. An escalation asks him to settle what you already reduced.

**Rule 4 was once built as an automatic control and removed. Do not rebuild it.** It classified by the
spelling of option labels, not by the shape of the choice. A preventive control whose false positives
are invisible to the person it protects is worse than none.

**The workstation's user-level brief carries its own escalation rules, and they reach every main
session.** These five agree with them and add the interview rule and the list rule. The user-level
brief is the floor: where the two ever differ, follow the stricter. Language and the option count come
from the owner overlay. The argument behind the escalation standard is in `engineering-standards`;
how this loop applies it is in `agents-configuration`.

## What holds these rules

**Nothing mechanical. All three sections are instructions**, held by review: no hook, permission rule
or check reads a route, a mode or the form of a question. A test in the repository that renders this
method asserts that this skill carries them and that no method file points at a project's root brief
for them. It asserts the rules are *written*, never that a session followed them.
