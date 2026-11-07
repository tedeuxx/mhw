---
name: "orchestration"
description: "Apply three main-session rules — the review a merge request gets for its type, what a loop mode may never change, how to ask the owner, and what the owner reads before a content merge (preview mode, never a Claude Artifact). Use when routing or asking. Use before dispatching a review, before any pool query or rite, and before any question, decision or action you put to the owner. Not for the state machine (see agents-configuration) or escalation's argument (see engineering-standards)."
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

### Before the gate: the reader-facing lens leaves its artifact (#197)

**The pre-gate phase is incomplete until the copy artifact the diff requires is on the pull request.
Do not dispatch `quality-assurance` before it is.**

1. **Read the actual diff at its full current head.** Take `headRefOid` and `baseRefName` from
   `gh pr view <n> --json headRefOid,baseRefName`, then read `git diff --no-renames
   origin/<base>...<head>`. The Issue type, the `reader-facing` label, a path list and a file
   extension are signals only. None of them is the definition, and none of them settles the question.
2. **The trigger: the diff changes words or images a reader sees, human or machine.** That includes
   crawler-facing text, generated output and output visible only in a preview. **When you cannot tell,
   it is reader-facing.**
3. **On a non-`content` diff that triggers, dispatch `product-lead` as the copy lens, whatever the
   type, `loop` included.** It posts nothing. **You relay its returned verdict verbatim into one pull
   request comment, before you dispatch the gate.** That comment is the canonical copy artifact; the
   gate verifies and references it and does not post a second copy.
4. **On a `content` diff, no copy verdict is owed.** The artifact is `docs/content-review/<slug>.md` at
   the reviewed head, with its round section and terminal literal (the `content` row above).
5. **The artifact's shape.** The comment opens with the envelope at column 0 and carries, in order, the
   full forty-character head it attests, exactly one lens verdict, and the lens's complete text with
   its two labelled classes, each with its findings or `none`. **Only the envelope's line-3 `verdict:` is
   the literal**; a `verdict:` line inside the lens's own text is part of the quote. Ask the lens for its
   brief's enum, `APPROVE`, `ADJUST` or `ESCALATE`, and copy it there. **When two `copy-verdict`
   comments name the same head, the newest wins.**

   ```
   <!-- copy-verdict: product-lead -->
   head: <the full 40-character head this artifact attests (on a carry-forward, the new head)>
   verdict: <exactly one of APPROVE, ADJUST, ESCALATE>
   carried-from: <only on a carry-forward: the prior head, then the comparison evidence>

   <the lens's verdict, verbatim and complete: BLOCKING (…or none), then ADVISORY (…or none)>
   <!-- /copy-verdict -->
   ```

6. **What is not an artifact.** A verdict without both labelled classes, without exactly one verdict
   literal, shortened, summarised, re-classified or carrying private-source content. **A verdict that
   cannot safely be posted does not complete the phase: re-dispatch the lens for a public-safe verdict;
   never paraphrase it in transit.** A long verdict is posted whole: a `<details>` fold is
   presentation, and past the forge's comment limit a second comment under the same envelope says it
   is part 2 of 2. **If the comment cannot be posted, the phase is incomplete and the gate waits.**
7. **A moved head needs a new artifact at the new head.** Carry forward only when you prove the
   reader-facing projection byte-identical: `git diff --quiet <prior-head> <head> -- <reader-facing
   paths>` exits 0, where `<reader-facing paths>` is the union of the reader-facing paths in both
   heads' diffs, so a reader-facing file first touched at the new head cannot escape the check.
   (`git patch-id --stable` does not prove it: it ignores whitespace.) Post a fresh
   artifact for the new head whose `carried-from:` line names the prior head, that command and its exit
   status. Otherwise the lens runs again.
8. **After the gate returns, the round is complete only when the pull request carries a
   `gatekeeper-verdict` comment whose `head:` line names the current full head.** Returned text alone
   completes nothing. Never post the gate's verdict yourself; re-dispatch it or report the failure.

**What holds this, at its real level: an instruction.** No available layer can intercept an agent
dispatch. The pull request comment makes compliance observable, and the gate's refusal of criterion 10
on a missing, stale, incomplete or unsafe artifact is the merge backstop. **The open scenario, stated
rather than hidden:** a relay by the orchestrator has failed before. The gate's brief records it
forgotten five times in one session, which is why the relay moved into the gate. This rule moves it
back to the orchestrator and earlier; a forgotten relay now costs one gate round, not, as before
2026-08-04, a silently unverified criterion.

## The loop-mode contract

The **record** of which mode is in force is `docs/loop-mode.md` in each repository. It carries the
value, the closed enum, the start date ~~, the work-in-progress bound `wip:`~~ and both pool predicates
in full. *(Struck 2026-10-19, #216: the record carries no development count any more; see rule 5.)* **This section is the contract**: what a mode may vary and what it may never touch. Where a
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
5. **Development parallelises; review does not.** **One issue, one git worktree; no count bounds
   development.** Any number of eligible issues may be in development at once, each on its own branch
   in its own worktree. At most one merge request is in review at a time ~~, whatever `wip:` says~~.
   The next goes to the gate only after the previous one merged or was sent back. *(Struck 2026-10-19,
   #216, the owner's decision: the numeric work-in-progress ceiling is retired; the serial gate is
   not.)*
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

**The owner's read before a content merge is an action under rule 4: one line, the act and the preview
link.** What he reads is fixed by the `content` lane's canonical sentence, owned by the
`content-publishing` skill and copied here word for word because this is the skill you load before you
put anything to him:

The owner reads a piece in the application's preview mode before it publishes: a new piece at its held preview, a correction to a published piece as a pending revision at the piece's own URL. Never a Claude Artifact, a paste, a file or a screenshot. Where the preview mode cannot render the case, say so to the owner and stop: nothing goes live, and the change waits. This governs his read of a publication only, not an Artifact he asked for elsewhere, such as a closing-rite report.

An acceptance criterion or a remembered note that names an Artifact for his read is a conflict to name,
not an instruction. His record of the read is his own comment on the release merge request, naming the
URLs he read. The sequence, including a correction to a published piece, is in `content-publishing`.

**Do not report a new `content` piece as published, done or reached until both of its social post URLs
exist; until then it is "released, social pair pending"**, in a reply, in `what-else`, in the
`Objective reached` close line and in a worklog event. A release that deployed is not a publication.
The definition is `content-publishing` step 10, and it is not restated here (mhw#238).

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
method asserts that this skill carries them, that each of the eleven pointer sites the move wrote in
method files (ten repointed from a root brief, one added) names this skill, and that none keeps the old
root-brief wording. A pointer written elsewhere, in new wording, is not checked. The same test asserts
that the owner-read sentence is identical in its three copies and that no method file matches the
pattern `ARTIFACT_READ` in that test, which recognises two phrasings of an Artifact for the owner's
read. Other phrasings pass. It also asserts that the sentence on reporting a `content` piece as
published is in *How to ask the owner*, and that `content-publishing` steps 9 and 10 carry the
definition and the order (mhw#238). It also pins the clauses of *Before the gate* here, the matching
clauses in `autonomy`, `quality-assurance` and `product-lead`, and the rendered skill in the Claude
Code, Codex and Kiro carriers (mhw#197). It asserts the rules are *written*, never that a session followed them.
