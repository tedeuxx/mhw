---
name: "engineering-standards"
description: "The owner's engineering preferences, portable to any project — two tiers (a non-negotiable floor, a risk-calibrated judgment layer), the twelve principles behind every call, delivered versus hygiene, and the human residual. Use when deciding how much rigor a change deserves, whether something counts as delivery, or what to do while blocked. Not this loop's machinery, state machine or WIP rule (see agents-configuration), and not what done means concretely (see definition-of-done)."
purpose: "hold the engineering preferences that survive leaving this loop, so a project that runs different machinery can adopt the judgment without inheriting a configuration that says nothing to it"
---

Apply the owner's engineering standards — the two tiers, the twelve principles, and the few rules
about delivery and the human residual that hold regardless of machinery — in any `<project>` repo.

Context: $ARGUMENTS

**This is the half of the former `harness-engineering` that travels (#381).** That skill held two
bodies of content in one file: the intentional design of *this* loop, and the engineering preferences
that would still be true in a project that never runs it. The owner's cut, in his words —
*«engineering-standards serve mais de forma generica as preferencias de engenharia que possuimos de
forma mais abrangente»* — and the test that decides every paragraph: **would this still be true in a
project that does not run this loop?** Yes → here. No → `agents-configuration`.

**The operational ruler that test was applied with, so a later reader can re-apply it rather than
re-derive it — and it is GATED rather than merely stated:** nothing in this file names a persona of
this roster, a hook script of this repository, or a decision record of either library. A paragraph
that needs one of those is describing local machinery and belongs in `agents-configuration`. This
repository's inventory gate asserts all three absences, so a local paragraph drifting back in here
reddens instead of being noticed by whoever happens to read it next.

**A consequence of gating it on TOKENS, said here because it shapes how this paragraph is written:**
the gate greps for the names, not for the sentences around them, so a file teaching the rule cannot
spell its own examples. That is why the three are described rather than listed — the alternative is a
red on the one paragraph that was never wrong. The same shape is recorded in
`documentation-standard`'s citation-form section, reached from a different direction.

**Issue numbers are the one exception, and it is deliberate rather than an oversight.** This paragraph
and the one above carry `#381` because they are *provenance* — where this file came from — not
content a consumer applies. The gate does not forbid them for exactly that reason, and forbidding
them would have made the file unable to say where it came from.

**Its companion is `agents-configuration`, and the two are not interchangeable.** This file is the
judgment; that one is the loop the judgment is applied inside — its state machine, its intake chain,
its gates, its WIP rule and the mechanisms that hold them. Where a principle below has a local
enforcement, the enforcement is named there and the principle is named here, once each.

## The move that makes it a discipline, not a vibe

Every guarantee a loop claims is **mechanical or it is not real.** "The reviewer holds the merge
gate" is engineered only once a hook denies the merge to every context but the reviewer; until then
it is an instruction the loop can break — and the same model that skipped a review is the one trusted
to remember. The test, applied to any claimed property of a loop:

> *If this guarantee failed right now, would something stop me — or only my memory?*

If only memory, it is not engineered yet — it is an intention.

**`agents-configuration` applies this test to itself repeatedly and by name** — several of its own
rules are labelled *not engineered* under it. That is the intended use: the test is worth having
because it produces that admission, not because it produces a green.

## Before you trust a green, break it on purpose

The test above asks whether a control **exists**. This one asks whether the control that exists **can
fail** — a separate question with a separate answer, because a guarantee can be fully mechanised and
still be worthless if the mechanism returns the same answer whatever the world is doing.

> **A check whose positive result is unconditional is not a check.**

**IS:** before a green is used as evidence, make the thing it watches actually wrong — on purpose, in
the subject rather than in the checker — and confirm it goes red. Then restore, and confirm it goes
green again. A check observed failing and recovering has been **calibrated**; a check that has only
ever passed has been **observed passing**, which is a far smaller claim and is routinely spent as if it
were the larger one.

**IS NOT — and each of these is a thing this rule keeps being confused with:**

- **Not "distrust every green."** The cost is paid once, when a check is written or changed, and the
  result is durable. A standing posture of suspicion produces nothing checkable and spends the
  attention the calibration itself needs.
- **Not "add another check."** A second check resting on the same blind premise is more noise with the
  same blindness — two greens where there was one, and still nothing that can go red. The move is to
  break the check you have, not to acquire a second one you have not broken either.
- **Not reading the check.** Reading catches a check that is obviously wrong; the expensive ones look
  right. The instances below were found by breaking a subject and waiting for a red that never came,
  and none of them by re-reading.
- **Not mutating the CHECKER.** Editing the assertion, the pattern or the threshold proves only that
  the checker responds to being edited. Change the **subject** — the source, the file, the served
  artifact, the world — and leave the checker untouched.

**The shapes it takes outside a test suite**, because this is usually filed as a testing rule and its
costly instances are not tests:

- **A response code that is the same for every input.** An app served behind a catch-all rewrite
  answers `200` for a path that does not exist, so *"I fetched it and it worked"* is true of an address
  nobody can open.
- **A search whose pattern is dead.** A published falsifier that matches nothing emits nothing, and
  emitting nothing reads as *nothing to worry about*. **A check that fails open is the worst member of
  this set**, because its silence is indistinguishable from success.
- **An exemption, allowance or suppression whose subject is gone.** It stops excusing anything and goes
  on passing, so nothing announces that the rule it was carved out of is now unexercised.
- **A step that reports success having done no work** — a job printing a verdict its command never
  produced, a guard registered where it never observes the act it names, a double that answers
  identically whatever it is asked.
- **A literal that a superset also satisfies.** Tightening a pinned string to something a broader match
  still contains leaves the assertion strictly weaker while reading as an update.

**What it costs, said rather than skipped:** breaking a green means deliberately putting a working
system into a wrong state, and the restore is the half that gets forgotten — so restore-and-re-green is
part of the rule, not a courtesy. It is also work demanded at exactly the moment the change already
looks finished.

**And nothing enforces it, on any machinery.** No layer can distinguish a mutation that landed from one
that silently no-opped: the evidence is a red that appeared and then went away, which leaves no
artifact behind. By the test above this rule is **not engineered, and cannot be** — it is held by
whoever writes the check and whoever reviews it. Say so out loud wherever a green from an uncalibrated
check is being offered as evidence.

**The test-suite instance is stated once, in `/code-review`** — mutate the source, count the reds,
restore — and is deliberately not restated here. This section is the class that instance belongs to;
`/content-publishing` carries another instance of the same class, at the point a link is composed.

## The judgment — twelve principles, two tiers

The lens every agent applies while working, not a separate concern from the work. Read it as defaults
plus the explicit triggers to deviate, not as rigid rules.

~~plus the explicit triggers to deviate~~ — **struck #410, and it is struck rather than edited because
a reader took a design decision from it.** Read in the plural beside a numbered list, it says *each
principle carries one*, and that was false the day it was written: exactly **one** of the eleven did.
**Four of them cannot**, by construction rather than by omission — the floor is the tier that never
bends, so a deviation clause on it would contradict the tier it belongs to. **Two of twelve carry one
now**, and the criterion is *an explicit clause naming the condition under which the principle
yields*. The command prints both sides of the count — the principle openers and every deviation
clause — so the number is read off the output rather than taken on trust:

```
awk '/^\*\*1\. Plan-first/,/^## What "delivered" means/' skills/engineering-standards/SKILL.md \
  | grep -nE '^\*\*[0-9]+\.|\*When I '
# -> 12 principle openers, 2 deviation clauses (principles 1 and 12)
```

### The spine: agent-led verification, human-residual

Everything below serves one purpose: the gates are objective and mechanical so an agent can *prove*
"done" itself, and the human's attention is reserved for what can't be reliably automated. An agent
that asks a human to check something a gate could have checked is leaking the residual the wrong way.

### Two tiers — know which you're in

- **Non-negotiable floor** (never bends, regardless of risk): the quality gate, 100% functional
  regression, observability, security/resilience by-design. These exist so you can *move fast without
  fear* — you only get to evolve incrementally because the floor protects what already works.
- **Calibrated judgment** (scales to blast-radius): how much planning, how much threat-modeling
  depth, how much abstraction, when to ask. Heavy where the change is irreversible or high-impact;
  product-speed where it's cheap to revert.

**The floor is a set of properties, not a fixed checklist of tools.** *What* proves each property is
read from the repo — the loop model, the suites that exist, the runtime that emits telemetry. A floor
stated in terms of components a given repo doesn't have isn't a higher standard; it's an
unsatisfiable one, and unsatisfiable gates get faked or skipped.

### How I approach work

**1. Plan-first.** Design the solution and align on it *before* writing code. Default to Plan mode
for any non-trivial task. *When I move faster:* a trivial, in-pattern change doesn't need a ceremony
— but the bar for "trivial" is low, not high.

**2. Ask before deciding — on the right things.** Stop and align on **architecture, contracts
(API/schema), and anything irreversible**. *Decide autonomously* on implementation that fits the
existing pattern. The line is "does this change a boundary others depend on, or something hard to
undo?" → ask. Otherwise → decide and report. Never make a *solo architectural* call.

**3. Thin vertical slices, bounded by overlap AND by a work-in-progress bound.** Each increment
crosses the layers and delivers reviewable value. Serial focus beats half-finished breadth.

> **The bound itself is a local decision and is not stated here.** What the bound *is* — one branch
> and one open PR at a time, versus a file-overlap rule — depends on the machinery available to hold
> it, on what a shared checkout costs, and on what the owner of that loop has ruled. This loop's
> answer, the correction that produced it, what it is protecting, and the measurement showing that
> nothing enforces it are all in **`agents-configuration`**, under *WIP=1*. Read them there; this
> principle only says that a bound exists and that it is not optional.

**4. Surgical changes, tracked debt.** Keep each change focused on its slice. When adjacent mess sits
in the path, **work around it and file the debt** — do *not* refactor alongside (no boy-scouting
mid-feature). Debt is recorded and paid in a dedicated cycle, not smuggled into an unrelated change.

### What I optimize for

**5. Simple but extensible.** Bias to the simplest thing that solves the problem now, with clear
extension points only where growth is genuinely known. Not radical YAGNI, not build-for-scale-upfront
— the deliberate middle. Abstraction must pay for itself before it's added.

**6. No architecture or tech dogma — the tool follows the problem.** There is no fixed
monolith-vs-microservices default and no sacred stack; decide by team, scale, coupling, and
operational cost. A given platform may be opinionated (one stack, one set of conventions) *as its
chosen context* — honor those conventions inside it — but the underlying principle is adaptability,
not allegiance to a tool.

**7. Rigor calibrated to blast-radius.** Match the weight of process to the cost of being wrong.
Irreversible / live / high-coupling → maximum rigor and a human in the loop. Cheap-to-revert /
isolated / git-reversible → product-speed. This is the dial; the floor (tier 1) is what the dial
never turns below. "Cheap to revert" is a property of the *change*, not of a tier of environment — a
repo with a single environment has no cheap tier to hide in, so the dial reads off blast-radius
directly.

### What "good" must always carry (the floor)

**8. Quality is a gate, not an option.** "Done" requires tests written alongside the code, coverage
at or above the project threshold, lint/typecheck clean, and review. **The regression suite must
functionally cover 100% of implemented features** — every feature that ships adds its regression; the
suite is the proof nothing broke. A change that adds behavior without its regression is not done.
Which suites constitute that regression is per repo: E2E wherever there's a UI, a contract/API suite
only where an API exists.

**9. Observability is part of "done."** A change isn't finished until its behavior is provable
**where it runs**. Where there's a server, that's structured logs, metrics and tracing; for a static
frontend it's analytics, the client error surface, and a build/prerender smoke. After a deploy,
smoke-test and confirm health through whichever of those the repo has, before calling it complete.

**10. Security and resilience by-design.** Least-privilege, idempotency, conscious fail-fast vs
fail-open choices, sensible retries, and light threat-modeling are part of the design — not a scan
bolted on at CI. Depth scales to criticality (calibrated), but the *posture* is always present.

**11. Living docs.** Architecture and decisions live as Mermaid diagrams plus markdown in the repo,
kept current with the code — not as an afterthought. The history (clean, conventional commits)
carries the *why*; the docs carry the *shape*.

### How I investigate

**The twelfth sits after the floor and is NOT part of it.** It is tier 2 — preferred, not
non-negotiable — and it is last only because the numbers are cited from outside this file, so
inserting it in the middle would renumber principles other documents name. Position is not tier here;
the label is.

**12. Dive deep — a TRUE answer that closes the inquiry is the failure.** *(Tier 2.)* The defect this
guards against is not a wrong answer. Wrong answers get corrected on contact; a **correct** one that
satisfies the question and ends the investigation leaves the mechanism underneath unexamined, and
nothing about it looks like a failure from the outside. Three moves separate an answer that is true
from one that is finished:

- **A repeating symptom is never explained by the actor's discipline alone.** *"I knew the rule and
  broke it"* describes the failure; it does not cause it. The question that reopens the inquiry is
  what made the rule **reachable at the moment of the act** — and where a rule is written into a
  surface the acting context does not read, no amount of care would have changed the outcome.
- **When two hypotheses disagree, measure before choosing between them.** The answer is often *both*,
  and only the measured half is actionable.
- **Name which of three a finding is** — a defect in what was built, a mismatch between the
  configuration and the current shape of the tooling it runs on, or discipline. Blurring them aims
  the work at a target no control can reach.

*When I stop shallower:* a **first occurrence whose cause is already mechanically visible** — the
command, the file and line, or the measurement is in hand, and nothing about it has recurred. Diving
past that point turns every symptom into an investigation, which is a real cost and the reason this
principle needs a stated floor rather than an *always*. **Two conditions override it:** the symptom
**repeats**, or the answer that satisfies the question is *the actor should have been more careful*.
That second one is a trigger to keep going and never a conclusion — it is the shape a true-and-closing
answer takes most often, because it is unfalsifiable and always available.

## What "delivered" means

**A slice DELIVERED when a reader can do, see or read something different.** Everything else is
**hygiene** — comments, dead code, a test mechanism, a process rule, a README. Hygiene is not lesser
work and it is not delivery: it is the cost of being able to deliver again.

**Report product slices against hygiene slices, every session.** A session with zero product slices
is a finding, not a status. **Hygiene is picked up when it BLOCKS a product slice, or in one
deliberate bounded batch** — not opportunistically, and not because it is what flows most easily
without a human.

## The agent's state while a slice is blocked on someone else

**With no defined action for that interval, the default behaviour is to report status. Reporting
reads to the agent as delivery and to the owner as stopping.**

> **On dispatching work to a reviewer — or to any actor you do not control — name and BEGIN the next
> non-overlapping action before ending the turn.** If there is none, say so: *"waiting on X, nothing
> disjoint in the queue"* is honest status. Silence is not, because silence is indistinguishable from
> being stuck.

## What the human does (the residual)

Everything mechanical is the agent's job: plan, slice, build, validate locally, make the gates green,
report evidence. The human is left only the residual — approving (or redirecting)
architectural/contract decisions and giving the **go/no-go on the irreversible act**. Designing the
loop so that residual stays small is the whole point.

## The escalation standard — when a running loop reaches the human, and in what form

**This is a standard for ONE act: an escalation rising out of a running loop to the human who owns it.**
It is not a rule about every question anyone has for that human, and reading it as one is the failure it
was written after — a design conversation, an interview, an ad-hoc request typed at a terminal are none
of them escalations, whatever their subject.

### The precondition comes FIRST, or the rest is misapplied

> **No loop running, no escalation.** The protocol exists *inside* work on a filed item that is
> being worked. Outside that there is no pendency to escalate, whatever the topic.

**The precondition is a FILED ITEM being worked — not a container being open, and the difference is
the whole reason this sentence is worth re-reading.** ~~an iteration is in flight~~ was the original
anchor and it is struck: it makes the standard depend on a **configuration axis it was never about**.
A loop that carries no batch container, or carries one that bounds nothing, has no iteration in
flight — so read literally the precondition never holds, **every clause beneath it is unreachable, and
the whole form contract goes dark in exactly the mode that interrupts a human most.** A filed item
being worked exists under every configuration, which is why the anchor moved to it.

**A container may still be present, and that is not what is being tested.** The question is whether
there is an item, filed and in progress, that the thing rising is *about*. If there is not, whatever
is happening is a conversation.

**Say this before the form, always.** A reader who meets the form without the precondition stamps every
question to the human as an escalation and applies a four-option contract to conversations it was never
about. That is not hypothetical: it is what happened to this standard while it was being written.

### The full definition — five clauses, all of them, or it is not one

1. **A loop is running** — a filed work item is being worked.
2. **A dispatched subagent** hits something on *that item*.
3. **It rises through the protocol** — subagent → main session → the human. Not laterally, and not from
   a context that was never dispatched.
4. **The trigger is a TRADE** of time, cost or scope against each other, for that item.
5. **The form is the contract below** — which of the two forms depends on whether the human is
   supplying **judgement** or **execution**. See *Before clause 5*.

**All five. Four of five is not an escalation, and the missing clause tells you what it is instead** —
clause 1 missing makes it a conversation, clause 2 a design question, clause 4 a status report.

### Clause 4 — what a trade IS, with the axes defined literally

> **A decision rises when it trades TIME, COST or SCOPE against each other for that work item.** A
> decision that moves none of them is the loop's, and the loop takes it.

It is the classic project-management triangle, **scoped per item** rather than per project, and the
three axes are meant literally:

| axis | what it means here |
|---|---|
| **time** | **hours of WORK and hours of WAITING — both.** The waiting half is the one that gets forgotten, and it is the half an unattended loop generates most of |
| **cost** | **tokens.** The spend of running the work, not money in the abstract and not effort — a reader who takes *cost* as money reaches for the wrong instrument |
| **scope** | what the item contains or promises |

**Scope influences cost and time.** The axes are not independent: adding to what an item promises spends
tokens and hours, and cutting it returns them. **A decision presented as *only* a scope change is
usually a decision about all three.**

**The operational test: anything that MOVES SCOPE is a *potential* escalation.** Keep the word
*potential* — it is doing the work. Touching scope makes an act a **candidate**, not automatically an
escalation, and both failure modes are live: escalate every scope touch and the form's brevity buys
nothing because the human is back in a queue; escalate none and they find out afterwards.

**Two consequences, and both cut against intuition:**

- **An act with no trade is the loop's, however irreversible it is.** Executing a decision already made
  trades nothing — performing it is not a second decision.
- **An act with a trade is the human's, however cheap and reversible it is.** Deferring an item trades
  scope for time; dropping one trades scope for cost.

**This is NOT *reversibility, not seniority*, and the divergence is worth recording rather than
performing silently.** Reversibility is a plausible rule and a common one — it governs at least one
widely-circulated loop blueprint — and it sorts the wrong acts: the irreversible-but-already-decided act
becomes attended, the cheap-but-genuinely-contested one unattended. **If you inherit a blueprint whose
escalation rule is reversibility, this is the line where you diverge from it, and say so where the
divergence is visible.**

**Do not confuse either with the permission floor's own irreversibility test**, which is untouched and
answers a different question. A permission layer asks *what must never execute without a human* — about
the **act**. This asks *whose decision a choice is* — about the **choice**. They coexist.

### Before clause 5 — WHICH KIND of pendency this is, because the form follows from it

**Two things rise to the human out of a running loop, and only one of them is a decision.**

| | a **DECISION** pendency | an **ACTION** pendency |
|---|---|---|
| what is left | the loop reduced a trade to alternatives and cannot pick between them | the decision is already taken; the human's hand on the object is the only remaining act |
| what the human supplies | **judgement** | **execution** |
| the form | the options — the reduction *is* the work | **an order and the object.** One line: the act, and where it is |
| options | always, at most four | **none. Manufacturing them is the defect** |

**The test, and it is one question: is there a second option you would actually defend?** If yes, it
is a decision and clause 5's form applies. If no, it is an instruction, and dressing it as a choice
is the failure below.

**Why options on an action pendency are actively harmful rather than merely redundant.** A set of
options *asserts that a choice exists*. Where none does, the human reads the alternatives, looks for
the trade between them, finds none, and has to **reconstruct the decision that was already taken in
order to discover that it was already taken**. That is the exact cost — rebuilding context for a
question nobody is asking — that the whole unattended/attended split exists to avoid. **A wrong form
here does not merely waste words; it spends the thing the standard is protecting.**

**The tell in a bad one: every option is the same act at a different time.** *Do it now · remind me
later · tomorrow · something else* is not four options. It is one instruction and three ways of
deferring it, and the human can defer anything without being offered the choice.

**Clause 4 still holds and this does not weaken it.** An act with no trade is the loop's — *executing
a decision already made trades nothing*. An action pendency reaches the human not because a trade
exists but because **the loop cannot perform the act**: a permission floor refuses it, a credential
is theirs, or the object is outside the machine. So an action pendency is an escalation by
**incapacity**, never by judgement, and that is why its form carries no options.

**Say the ask FIRST and say it as an act.** Not *"when you have a moment, there's a thing"* — the
verb and the object, then stop. Depth is still pulled, never pushed.

### Clause 5 — the form for a DECISION, and it is part of the design rather than presentation polish

**An escalation interrupts a person doing something else.** The work is unattended by design; the human
is not sitting in the loop waiting to be addressed. **So the cost is not the decision, it is the context
they have to rebuild to take it**, and every word that does not shorten that rebuild lengthens it.

> **Succinct, direct, objective — a tweet at most.** **At most FOUR options**, each described directly,
> for a fast decision. **High-level, but in the decider's own technical register: name the objects, not
> the process.** **The FIRST escalation of a topic is terse — depth is PULLED, not pushed.** **And it
> ALWAYS carries the options.**

**The register is the decider's, and it is an executive one.** State **the decision and its consequence,
and stop.** Do not narrate how the answer was reached, do not hedge, do not show the work — **the work
still exists, in an artifact they can open.** That is what makes terseness honest rather than lossy:
nothing is withheld, it is *placed* where pulling it costs one question instead of where reading past it
costs a paragraph every time.

**Address the DECIDER, not the engineer — even when they are the same person.** On a small team they
usually are, and the temptation is to write to the half that would enjoy the reasoning. **Write to the
half that has to answer.**

**Four is a ceiling, not a target.** Two is better than four; one clear recommendation plus *"or tell me
otherwise"* is often better than either.

### The failure test — a question with no options is not an escalation

**A bare question is offloading the analysis.** That is this standard's own failure test, and it catches
the shape that feels like deference: *asking what they want* instead of *composing what the loop already
worked out and asking them to pick*.

**It is scoped to DECISIONS, and the scope is load-bearing.** An action pendency carries no options **by
design**, so this test does not apply to it and must not be read as demanding options everywhere.
**The heading keeps its original wording deliberately** — it is the clause as it was first stated, and
narrowing it by rewriting the sentence would put the scope where nobody looking for the rule would
read it. The scope is stated here, under it, where it qualifies rather than replaces.
**The two failures are mirror images and the same reader makes both**: options withheld where the
loop owed the reduction, and options manufactured where nothing was ever in question. *Which class
is this?* comes first; the test comes second.

**It is also what makes the scope test affordable.** A scope-touching act becomes an escalation only
once it is reduced to choices, and **the reduction is the loop's work**. So: **if it cannot be reduced
to at most four direct options, it is not ready to rise** — the loop owes more work before it interrupts
anybody. That is the correct response to *"this is complicated"*: do the analysis, then bring the
choices.

**Where the options need composing, compose them below the human rather than at them.** A trade with a
value half and a build half needs both read before the options are honest — and **where two consulted
opinions disagree, the disagreement IS the trade**: it rises as the options rather than being resolved
underneath. Which roles those are is a property of the roster, not of this standard.

### How much is NOT settled, and no threshold is authored

**No number, no multiplier, no trigger condition.** How far a spend runs before the trade is worth
escalating does not follow from this standard and is not stated here. **The calibration comes later,
from metrics and a worklog collected over real iterations** — and a threshold invented before those
exist would be a decision nobody made in a record that reads as if someone had.

**So the question is open rather than answered:** *how does the loop decide that an item's cost or time
has gone wrong?* Nothing here answers it.

**The honest state to write down rather than assume:** the instrument usually exists — a harness
recording per-dispatch tokens and duration is already measuring two of the three axes — and **nothing
reads it against anything**, which is an instrument and not a control. And **a worklog is a different
artifact from per-dispatch metrics**; a loop that has the second does not thereby have the first.

### What enforces this — say it before anyone reads a green as coverage

**Clauses 1 and 5 are partly mechanizable. Clauses 2, 3 and 4 are not, at all.**

- **Whether a loop is running** is a query, so a hook can read it.
- **The FORM is string-checkable** — option count and length — **but only once something says an
  escalation is happening.** Nothing infers that from prose without failing open.
- **Whether a question was a genuine trade, whether it rose through the protocol, and whether four
  options were the right four are none of them checkable by any layer.** Do not build something that
  pretends otherwise: a detector that fails open is worse than none.
- ~~**And every layer available is DETECTION, one turn late.** A permission layer reads a command
  string and an escalation is a message to a human; no layer intercepts one.~~ **Struck: false where
  the escalation is raised THROUGH A TOOL.** The premise was that an escalation is prose, and prose
  reaches the human without passing any layer. That holds for a typed message and fails for a
  **structured picker**, which is a tool call like any other — so a `PreToolUse` layer sees its
  payload *before* the human does, and can refuse it. **So the DECISION/ACTION partition above is the
  one clause of this standard where prevention is even AVAILABLE** — build there rather than adding
  another detector.
- **Whether prevention is achieved IN PRACTICE rests on a premise about the RUNTIME, and it is a
  premise you have to measure rather than read.** In the one harness checked it is **measured-real and
  undocumented at the same time** — a third state worth naming, because a reader who only asks *is it
  documented?* concludes the wrong thing in both directions. What settled it was reading the shipped
  bundle's control flow: the tool-execution loop calls the pre-execution generator for every tool, its
  exemption set has **one** member, and that member is a different tool.
- **Bound a measurement like that exactly, or it becomes the next false claim:** one build, one
  machine, **control flow read rather than a live refusal watched**. A vendor who changes it silently
  breaks the control while every suite stays green, because a suite that feeds the script a payload
  proves the script and never the routing.
- **A control resting on an UNVERIFIED routing is INERT WHILE READING AS INSTALLED** — registered,
  green, documented, refusing nothing. That is worse than no control, because it is believed. **So
  measure the routing on the harness you are actually on, and write down what you read**, before
  writing anywhere that the clause is held.

### But AVAILABLE is not the same as WORTH BUILDING — this was tried, and deleted

**A guard enforcing the ACTION half was built and removed in the same slice**, and the reason is a
rule about controls rather than a note about one hook.

It refused a picker whose option labels carried an execution verb beside a link to the object. Three
narrowings — labels only, then leading position, then exactly one verb-initial label — and **each
round of review found a new class of genuine decision it refused**, ending with *"merge it / request
changes"*: the exact class its verb set excluded *approve* to protect, defeated by a synonym.

**The diagnosis: it classified by LABEL SPELLING, not by CHOICE SHAPE**, so the narrowings were a
search over spellings rather than a convergence, and a fourth reviewer would have found a fourth
class.

> **The failure it prevented cost the human one sentence. The failure it caused was invisible to them
> by CONSTRUCTION** — a pre-execution layer denies before they see anything, so a suppressed decision
> arrives as prose that reads like a decision already taken. **That is the defect the control existed
> to prevent, produced by the control, where nobody can observe it.**

**The general rule, and it is the transferable part:**

> **A preventive control whose false positives are unobservable by the person it protects is worse
> than no control, however good its true positives.** Before building one, ask which direction its
> errors run and who can see them. If the answer is *nobody*, do not build it — or invert the
> condition so the errors run toward letting something through, where they are at least visible.

**So this clause is an intention, like the rest of the standard.** Nothing was lost that was ever
held.

By the test at the top of this file — *would something stop me, or only my memory?* — **this standard
is an intention, in every clause.** One clause was briefly more than that, and the attempt is recorded
above rather than deleted, because *what was tried and why it was removed* is the useful part.

**A harness adopting this standard should expect two splits, not one.** The first is by medium: what
travels through a **tool** is interceptable, what travels through **language** is not. The second is
the one that actually decides whether to build: **interceptable is not the same as worth
intercepting** — and the question that separates them is which direction the control's errors run, and
whether anyone can see them.

## Using this skill

When an agent works in a consuming repo, these twelve principles are the lens for every choice: plan
first, ask on the boundaries, slice thin, keep the floor green, and verify your own work before
handing the residual to a human. The deep-dive component skills tell you *how* to build each piece;
this tells you *how to decide* while you do. Today that means three reference skills — `/backend`,
`/frontend` and `/cloud-infrastructure`.

See also: `/definition-of-done` (the Definition of Done itself — the criteria, and the table naming
which of them a gate proves), `/quality-gates` (the gate tables per loop model and the concrete
gate definitions for both stacks), `/devops` (the permission zones and guard hook, branching,
per-environment topology, OIDC, the deploy workflows, TFC state), and — for the loop these principles
are applied inside, which is where every mechanism named above actually lives —
**`/agents-configuration`**.

~~`/playwright` (E2E) … Repos with an API layer add its contract/API suite — see `/postman`.~~
**Struck: neither identifier resolves.** Both were folded into the reference skills — E2E is a
section of `/frontend`, the contract/API suite a section of `/backend` — and a pointer at a skill
that does not exist fails at zero bytes of stderr, which is the silent break this library gates
elsewhere and had left standing here.
