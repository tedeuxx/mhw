---
name: "definition-of-done"
description: "Design or evaluate a Definition of Done, and apply THIS loop's own — the criteria a slice calls finished, plus the table naming which of them a gate proves and which nothing does. Use when building a DoD from scratch, checking a slice against this loop's criteria, running the author's own self-check before submitting a merge request, or diagnosing why review still reads as subjective. Not for the CI/CD gates and thresholds themselves (see quality-gates), or a work item's readiness to be built (see definition-of-ready)."
purpose: "teach what makes a Definition of Done a ruler rather than a phrase, independently of any one project's gates"
---

# Definition of Done — the ruler that decides when work stops

Apply this SDLC-generic concept in any `<project>` — it defines what makes a Definition of Done a real
mechanism rather than a phrase, independent of which loop, tracker or team runs it. `/definition-of-ready`
and this skill are the two ends of the same lifecycle: **ready** is the entry gate to building, **done**
is the exit gate out of it. Neither substitutes for the other, and a project that only builds one of them
fails at the end it left open — a strong DoD cannot rescue a story that was ambiguous when the builder
started (see *Ready is a precondition of done*, below), and a strong Definition of Ready does not verify
what was actually shipped.

Context: $ARGUMENTS

## Why a Definition of Done is a mechanism, not a phrase

**"Done" is a claim, and a claim needs a ruler or it is just an assertion.** Without one, "done" is
decided by whoever is reviewing, on however much they happened to notice that day — which is a different
bar every time, set by mood and attention rather than by anything the team agreed. A DoD exists to move
that decision from a person's impression to a checkable list: an item either satisfies each stated
criterion or it does not, and the criteria were agreed **before** the work started, not invented while
reading the diff.

That is the whole mechanism, and it is worth stating plainly because it is easy to build a DoD that looks
like this and is not one — see *Failure modes*, below, for the three shapes that fail while still calling
themselves a Definition of Done.

## Designing a DoD from scratch

**The central mistake is starting from the wrong source.** The instinct is to reach for a generic,
industry-standard checklist — or worse, to inherit whatever a previous team or a corporate template
already had — and adopt it wholesale. That checklist was written against a different project's actual
surfaces, and a criterion is only meaningful against what a *specific* project actually delivers. Design
starts from the project's own purpose, not from a template that precedes it — see *My take*, below, for
this stated as the owner's own diagnosis of the failure, in his words.

**The concrete process, once the source is right:**

1. **Read what the project actually produces.** A service with no UI has no screen to certify as
   finished; a library with no runtime has no deploy smoke to run. A criterion naming a surface the
   project does not have is not a stricter bar — it is an unsatisfiable one, and an unsatisfiable
   criterion teaches the team to rubber-stamp it or skip it quietly. This is the same discipline
   `/definition-of-ready` applies on the other end of the lifecycle, and for the same reason.
2. **Ask, for each candidate criterion: is it objective, falsifiable and evidence-producing?** See
   *What makes a criterion well-formed*, below — this is the test that separates a real gate from a
   phrase that sounds like one.
3. **Ask who checks each criterion, and how.** A criterion nobody actually checks is not a criterion,
   it is a sentence — see the second failure mode below for what a DoD that is never actually verified
   looks like in practice.
4. **Know the DoD is complete when every criterion traces to a real cost of skipping it.** If a
   criterion cannot be tied to a specific, nameable failure the project has had or would plausibly have —
   a bug that shipped, a regression nobody caught, a decision nobody could reconstruct — it is decoration,
   and decoration is exactly what makes a DoD heavy enough that a team routes around it (the fourth
   failure mode below).

## What makes a DoD criterion well-formed

**Objective, falsifiable, evidence-producing** — the same three properties, stated once so every
project-specific DoD can be checked against them rather than re-derived. A criterion is well-formed when:

- **Objective** — two different reviewers, reading the same evidence, reach the same verdict. "Works
  well" fails this; "the suite named in the CI config is green" does not.
- **Falsifiable** — there exists a concrete way for the criterion to be *unmet*, and that way is
  checkable by someone who disagrees with the reviewer. A criterion that is always satisfied whatever
  the diff contains is not a criterion; it is a formality wearing a checkbox.
- **Evidence-producing** — satisfying it leaves behind something a later reader can point at: a command's
  real output, a passing check's name, a line in the diff. "I looked and it's fine" is not evidence; a
  named artifact is.

**A concrete instance of this rule, rather than an abstract restatement of it:** this plugin's own
`quality-gates` skill states its review discipline as *"a finding blocks only if it names a criterion and
a falsifier"* — the exact same property, applied at the point a finding is judged rather than at the
point a criterion is written. Read that skill for the worked, mechanical form (evidence required per
criterion, a stated falsifier, severity set by whoever found it) rather than re-deriving it here; this
skill states the general rule, `quality-gates` is one project's concrete implementation of it.

## Common DoD shapes

There is no one correct shape — the right one depends on how many kinds of work the DoD has to cover and
how much the team can afford to run per item.

- **A fixed checklist.** One list, applied identically to every item — lint clean, tests written,
  reviewed, documented. Simple to state and simple to audit, and it is where most teams start. It
  breaks down when the work is heterogeneous: a checklist item that makes sense for a feature ("user-
  visible change has an end-to-end test") is either vacuous or actively wrong for a dependency bump or a
  documentation fix, and a DoD that cannot tell the two apart either exempts items informally (which
  erodes the checklist's authority) or blocks trivial work on decoration.
- **Per-item-type criteria.** The checklist branches on what kind of item it is — a feature's criteria
  differ from a bugfix's, which differ from an infrastructure change's, which differ from a
  content/copy change's. This is heavier to design and maintain (more than one list to keep current), but
  it is what an unsatisfiable-criterion problem actually asks for: the criteria that apply are the ones
  that make sense for the surface the item touches. This plugin's own loop is an instance of a related
  idea one level up — its gate table branches on loop model rather than item type, but the principle
  (branch on what actually varies, rather than force one list to cover everything) is the same move.
- **An automated gate.** The criteria are encoded as CI checks, and "done" is defined as "every required
  check is green." This is the strongest form of *objective and evidence-producing* — a human cannot
  misjudge a check that either ran and passed or did not — but it only covers what can be automated, and
  a criterion nobody wrote a check for silently has no enforcement at all, however confidently the team
  believes it is covered. The trade-off worth naming explicitly: automation converts "was this checked"
  from a judgment call into a fact, at the cost of upfront engineering per criterion, and it can quietly
  narrow "done" to "what the pipeline happens to measure" if nobody periodically asks what the pipeline
  is *not* measuring.

**These are not mutually exclusive, and most working DoDs are a fixed core plus one of the other two
layered on top** — a small fixed checklist that applies to everything (lint, review, a merge to the
trunk), with either type-specific additions or automated enforcement carrying the weight for what the
fixed core cannot express on its own.

## Failure modes of a badly-made DoD

Four, named together rather than ranked — a real DoD can fail any of these independently, and a DoD that
avoids one is not thereby safe from the others.

- **Vague, unfalsifiable criteria.** "Works well," "is stable," "looks good" — nothing here is
  objectively testable, so the criterion decides nothing; it just relocates the same impression-based
  judgment the DoD exists to remove, now wearing a checkbox.
- **A DoD nobody actually checks item-by-item.** The list exists, and review happens anyway as "looks
  good to me" rather than as a walk through each stated criterion. The DoD is real on paper and
  ceremonial in practice — which is worse than no DoD, because it lets everyone believe a check happened
  that did not.
- **A DoD copied from another team or project without adapting it.** The criteria were well-formed
  *somewhere else*, against a different project's surfaces, and inherited wholesale rather than checked
  against what this project actually delivers. This is the central mistake named in *Designing a DoD from
  scratch* above, and it is listed again here as a failure mode because it is also the most common
  starting condition of a DoD that later exhibits the other three.
- **A DoD so heavy the team routes around it.** Every criterion added has a cost paid on every item, and
  a checklist that grew past what any given item actually needs teaches the team to fill it in
  perfunctorily or skip it under deadline pressure. A DoD that is honored in the breach is functionally
  no different from having none, except that it also cost the discipline of maintaining it.

**The common thread across all four:** each one produces a DoD that *looks* like a mechanism — a
document, a checklist, a gate in CI — while not actually functioning as the ruler it claims to be. The
test in *Why a Definition of Done is a mechanism, not a phrase* (does a criterion decide, or does a
person still decide and the criterion just gets cited afterwards?) is what separates a real DoD from any
of these four.

## THIS loop's concrete Definition of Done — the criteria, and which of them a gate proves

**Moved here from `/quality-gates` at #380, on the owner's own definitions, quoted because they are the
ruler rather than a preference:**

> *«quality gates para mim sao mais relacionados a metricas de ci/cd.»*
> *«definition of done para mim sao relacionado a completude de um issue.»*

A reader asking *"what is this project's Definition of Done?"* used to open the skill called
`definition-of-done` and find only theory, while the actual list lived in the skill named after CI/CD
mechanisms. **Nothing above this heading changed and no threshold moved** — `/quality-gates` keeps the
gate tables, the thresholds and the enforcement wiring, which are CI/CD metrics and belong there.

### The criteria (a slice is "done" only when all hold)

| # | criterion | is it PROVED by a gate? |
|---|---|---|
| 1 | Unit/integration tests written alongside the code, **coverage ≥ 85%**, green | **yes** — CI, threshold in `/quality-gates` Part II |
| 2 | **Regression added for the feature** (the 100% invariant below) | **partly** — CI proves the suite is green, nothing proves a regression was *added for this feature* |
| 3 | Lint + typecheck clean | **yes** — CI |
| 4 | **Observability instrumented for the new behaviour**, in whatever form this repo's runtime supports | **no** — a reviewer's judgement |
| 5 | Security/resilience posture applied (least-privilege, idempotency, fail-fast/open, retries) | **partly** — SAST and dependency scanning catch a subset; the posture is not enumerable |
| 6 | **Docs/Mermaid updated**; debt named in the review | **no** |
| 7 | **Conventional-commit** subject (the commit log is the changelog) | **no** — a convention this repo keeps and does not enforce; the derived commit↔issue coverage check that would is deliberately deferred, per `/agents-configuration` |
| 8 | **Validated locally**, with real command output rather than a claim | **no** — the report is the only artifact |
| 9 | **Where the slice's consumer is an artifact somebody has to AUTHOR, that artifact is named and its existence stated** (#362) | **no, and it cannot be** — see below; the row is admitted knowing that |

Anything short of all of these is in-progress, not done.

### Row 9 — the DoD accepted CORRECT as DELIVERED, and this is the narrowest honest repair (#362)

**The gap, as a property rather than as an incident: the criteria above verify that a change is
CORRECT. Until row 9, nothing asked whether it is USED.** For most slices those coincide — a guard that
denies denies, a rule that is written is written. **They come apart exactly where a feature's consumer
is an artifact somebody has to author**, and there the loop had no criterion at all.

**The measured instance, and it passed every layer.** A slice shipped two review affordances behind a
preview parameter; one of them renders only when an article declares a field in its front matter. Only
the test fixture written to prove the feature declared one. **So the feature worked for its own fixture
and for nothing else** — with six E2E tests, a mutation-checked assertion suite, and the limitation
*disclosed in the builder's own report*. The builder was right about the diff. The gate was right about
the diff. The relay was right about what it relayed. **Nobody owned whether the feature reached its
consumer**, and the owner found it by opening the page himself.

**This is not "it was not tested."** The mechanism was proven and the outcome was never looked at.

#### What row 9 deliberately is NOT

**It is not a blanket *"prove it is used."*** That would block every mechanism built ahead of its
consumer, which this repo does deliberately and correctly — `published-voice` was extracted ahead of its
second consumer and that is recorded as an accepted exception, not a defect. The scope is the narrow
one: **a slice whose consumer is an authored artifact.** Where the consumer is code, a caller, a hook or
a reader following a link, rows 1–8 already cover it and row 9 has no subject.

**It is not gateable, and saying so is the point rather than an apology.** *"Does this reach its
consumer"* has no mechanical form in the general case, and a criterion nobody can check is the shape
this repository names as its worst. Row 9 is admitted to the list **with its right-hand column reading
`no, and it cannot be`** — which is precisely what the seam table exists to make sayable. A criterion
that is honest about having no gate is worth more than one that implies it has one.

**It is not the existing `invocable:` field under another name, and the difference is the predicate.**
`hooks/scripts/closure-artifact-guard.sh` reads a declared `invocable:` line and refuses a manual close
when the named artifact does not exist. **Its predicate is EXISTENCE; row 9's is REACH.** In the measured
instance an honest `invocable:` declaration would have named a component path that resolves perfectly —
the guard would have passed, and the feature would still have reached nobody. Read row 9 as covering
what that guard cannot see rather than as a tightening of it.

#### How it is actually satisfied, and by whom

**At review, in one sentence, in the verdict.** The reviewer asks: *what has to exist, outside this
diff, for this change to do anything for a reader — and does it exist?* Three honest answers, and the
third is the one this row was written for:

- **"Nothing must — the consumer is code, and it is `<path>`."** **The object is named even here, and
  that requirement is the answer to this criterion's own sharpest weakness.** Left as a bare *"nothing
  must"*, this is unfalsifiable, it is the cheapest thing to write, and it is available on exactly the
  class row 9 exists for — **the measured instance below would have accepted it.** A criterion whose
  cheapest passing answer is indistinguishable from its failure mode is not gating anything. Naming the
  path costs a reviewer nothing when the answer is true and is impossible to write when it is not.
- **"X exists."** Name it. That is the evidence.
- **"X does not exist yet."** *This is the answer that used to pass silently as a disclosed
  limitation.* It does not stop the merge — building a mechanism ahead of its consumer stays legitimate
  — but it is a finding the owner is handed as a **question**, not as a sentence in a report. The
  measured instance reached him twice as prose and neither time as a question.

#### The residual, named because nothing catches it

**Nothing observes that anyone asked.** No hook can: the question is about an artifact outside the diff,
in another repository more often than not, and a `PreToolUse` guard reads a command string while a
`Stop` hook reads committed state. **By this loop's own test — *would something stop me, or only my
memory?* — row 9 is not engineered.** It is a criterion with a reviewer behind it and no instrument,
which is exactly what four of the other eight rows already are; it is listed with them rather than
pretending to be a ninth gate.

**And the sweep will not cover it either.** The iteration-close review rite derives its target list
from the application's own route generator, and a held or unpublished artifact is by construction not
in that list — so the rite that looks most like a backstop here is structurally blind to the very case
row 9 names. That is stated so nobody closes this gap twice by pointing at the sweep.

### The seam — a green gate is not a met DoD, and this is the sentence that makes it visible

**This is the most valuable line in the move, and it was not statable while the two lived in one file.**
Read the right-hand column above as the whole of the claim, and **read the members rather than a count**
— a tally beside a table is a second source of truth for one fact, and it is the arrangement this
repository's own gate exists because it rots:

- **fully proved by a gate:** rows 1 and 3;
- **proved in part, with the uncovered part named in the row:** rows 2 and 5;
- **not proved by anything mechanical:** rows 4, 6, 7, 8 and 9 — and row 9 is the one that **cannot**
  be, by construction rather than for want of someone building it.

A pipeline that is entirely green has established rows 1 and 3, part of 2 and part of 5, **and nothing
else**.

The consequence runs in both directions, and the second one is the one that gets missed:

- **A DoD criterion with no gate is not thereby weaker** — it is checked by a person, at review, and its
  evidence is whatever that person can point at. It fails the way a person fails: quietly, under time
  pressure, on the day it matters.
- **A gate that proves no DoD criterion is not thereby pointless, and must not be read as delivery
  evidence.** `hooks/scripts/inventory-counts.test.sh` proves inventory consistency; nothing in the list
  above depends on it. Its green says something true and says nothing about whether a slice is done.

**The failure this prevents is a category error, not a missing check:** a DoD living inside the gates
file inherits the gates' authority, so *"CI is green"* silently reads as *"the DoD is met"*. It is not,
it never was, and the table above is the cheapest form of saying so.

#### A second seam, on one lane only: a met DoD is not a delivered PIECE (#399)

**This is a DISCLOSURE, not a tenth row, and the distinction is the whole of it.** The DoD governs a
**diff and its Issue**. On the content lane the *piece* keeps travelling after the merge — promotion,
then the social pair on both networks — and **nothing carries that remainder**: no criterion, no gate,
no hook, and no artifact that says it happened. So on that lane the DoD's exit gate is the **merge**,
and the merge is not the audience.

**Do not close this by adding a posting criterion.** It would put an obligation on the gatekeeper that
it cannot check, on **every** lane, to cover one — and a criterion with no ruler behind it is the exact
shape this file spends its length arguing against. Row 9 (*Reach*) already carries the nearest
obligation the DoD can honestly hold, and its column already reads `no, and it cannot be`. **The
remainder belongs to the lane's own document** (`/content-publishing`, its steps 9 and 10), which
names it step by step and states there, in its own table, that nothing enforces any of it.

**Why it is written here anyway:** a reader who meets the nine rows and the seam table above, and
nothing else, concludes that a green pipeline plus a reviewer's read is the whole distance to done.
On eight of nine lanes-worth of work that is true. On this one it stops one step short of the reader,
and the gap is invisible from inside the list.

### The regression invariant — 100% functional coverage

The regression suite must **functionally cover 100% of the repo's implemented features** — not a
representative sample. Every feature that ships adds its own regression; the collective suite is the
proof that *nothing already working broke*. This is the one criterion that does **not** bend to
blast-radius — it is the floor that lets the platform be evolved incrementally without fear. A change
that adds behaviour without its regression breaks the invariant and is not done.

**Which suites this means is per repo.** E2E (browser) always, where there is a UI. An **API/contract
suite only where an API exists.** Demanding coverage of a surface the repo does not have is not rigor —
it is an unsatisfiable gate, and an unsatisfiable gate teaches the agent to fabricate evidence or quietly
skip the check. This is *Designing a DoD from scratch* step 1 applied to this repo rather than restated;
read the repo, then name the suites.

**Observability (row 4) is scoped the same way.** "Instrumented" means structured logs, metrics and
tracing where there is a server to emit them; for a static frontend it means analytics, the client-side
error surface, and a build/prerender smoke. Neither is a lesser standard — both must prove the change is
working where it runs.

### Local validation, and post-deploy

Development is validated **locally and automatically before the deploy** — not by a manual
click-through. Run the repo's regression against the local environment; what "locally" requires depends
on the loop model (a static repo runs fully offline; a repo with backing services points at them per
`/devops`). *"The regression passes locally"* is the concrete pre-deploy gate.

**A deploy is not finished at "merged."** After it lands — in every environment it lands in — run a smoke
and confirm health through the repo's observability before considering it complete. That closes the loop
with row 4: the proof a change works is that you can *see* it working where it runs.

## Ready is a precondition of done

**A DoD cannot rescue an item that was never properly ready.** This is not a general truism weakened for
effect — it is a specific, observed failure: a project whose User Stories were never well-defined, only
arbitrary Acceptance Criteria attached to something that stayed ambiguous throughout, reaches the point
where *any* DoD applied at the end is inert. The checklist can be perfectly well-formed and still certify
nothing, because there was never a stable, agreed statement of what "this item" was for the checklist to
be checked against. See *My take*, below, for this stated in the owner's own words, and
`/definition-of-ready` for the entry-gate discipline this depends on.

**The practical implication:** when a DoD seems to be failing — findings keep surfacing that no criterion
anticipated, review keeps re-litigating scope — the fix is not always a heavier DoD. Check the item's
readiness first. A DoD that keeps needing new criteria to catch what a vague story keeps producing is
treating a Definition-of-Ready failure as a Definition-of-Done problem, and no amount of checklist
tuning at the exit gate fixes an ambiguity that should have been resolved at the entry gate.

## Pros & cons

**Pros**
- Converts "is this done" from an impression, decided anew by whoever is looking, into a checkable
  property that two different reviewers reach the same verdict on.
- Makes the cost of "done" visible and negotiable *before* work starts, rather than discovered as a
  surprise at review time.
- A DoD shaped per project (rather than inherited generically) scales down honestly — a project with
  fewer surfaces gets a shorter, still-complete list, the same move `/definition-of-ready` makes on its
  own checklist.

**Cons**
- Designing it well needs judgment the first time, and re-judgment whenever the project's surfaces
  change — a DoD that is never revisited eventually drifts into one of the four failure modes above.
- A DoD, however well designed, still depends on a well-formed item to check it against — see *Ready is
  a precondition of done*.
- The automated-gate shape trades a judgment-call risk for a coverage-gap risk: what the pipeline does
  not measure is invisible, not merely unmeasured, unless someone periodically asks what is missing.

## My take

*(Elicited directly from the owner — not scaffolded, not generalized.)*

**The most common failure, and he named all four together rather than picking one:** vague or subjective
criteria that name nothing testable ("works well," "is stable"); a DoD that exists on paper but is never
actually checked item-by-item, so review degrades back into "looks good"; a DoD copied from another team
or project without adapting it to what *this* project actually delivers; and a DoD so heavy the team
routes around it or fills it in perfunctorily rather than actually clearing it. All four are real, all
four happen, and none of them is "the" failure mode — that is the origin of *Failure modes of a badly-made
DoD*, above, named together rather than ranked because that is how he answered.

**The central mistake, in his words:** *"o grande erro cometido é seguir uma regulamentação corporativa ou
algo genérico que não é ajustado ao propósito do projeto"* — the big mistake is following a corporate
regulation or something generic that isn't adjusted to the project's own purpose. Asked where to start
when designing a DoD from scratch, this was his answer — not "write more criteria" or "add more gates,"
but a warning about the *source* the criteria come from. That is why *Designing a DoD from scratch* above
opens on where the DoD's criteria come from, before it says anything about what a well-formed criterion
looks like: getting the source right is upstream of getting any individual criterion right.

**The concrete failure story, in his words:** *"um projeto que não tinha USs bem definidas, só tinha CAs
arbitrários, ficava ambíguo e com isso ao final qualquer DOD (checklist de completude) era inócuo"* — a
project that had no well-defined User Stories, only arbitrary Acceptance Criteria, stayed ambiguous
throughout, and because of that, by the end, any DoD (a completeness checklist) was inert. He offered
this unprompted as the answer to what makes a DoD fail in practice, and it is the origin of *Ready is a
precondition of done* above, verbatim to what he described rather than a general principle this skill
invented and attributed to him. The direct implication he is naming: a Definition of Done is downstream
of intake quality, and `/definition-of-ready`'s own discipline — closing the ambiguity at the edges of a
story before it is built — is not a separate concern from this skill, it is the concern that determines
whether this skill's checklist means anything at all.

---

# Part II - The author's self-check before submitting (formerly `code-review`)

**Absorbed from the former `code-review` skill when the method moved to this repository's user layer (#61, requirements document section 6).** It is no longer a separate skill: where this method names `/code-review` or `code-review`, it means this section. The text below is carried as it stood at the plugin's commit `01045b660fc31fa6cb4f063fc0c5a2f1aa04db7c`.

Review your own slice for COMPLETENESS before opening the merge request. Author-side, run by `developer`, and distinct from the gatekeeper's review that comes after.

Context: $ARGUMENTS

## What this is, and what it is not

**An anticipation of both of the gate's lenses, run by the author.** `quality-assurance` will consolidate that every requirement of the Issue was met and every DoD item holds, **and** it will ask whether this can cause a problem in production — one gate, two rulers, since `security` was absorbed into it on 2026-08-04. **You answer both first, while fixing is still free.**

**The merge raised the value of this pass rather than lowering it.** There is no longer a second gatekeeper reading the same diff from a different direction, so a defect one of them would have caught is now caught once or not at all. §7 below is where that lands.

**You verify the DoD items here — you do not defer them.** The gate re-verifies independently, in a fresh context, and that independence is the point of having it. But arriving at the gate with the DoD unchecked outsources your own work to it, and every item it has to raise costs a round, a re-ratification and the owner's attention.

**Why it exists, measured rather than assumed.** Two hook slices in one session took **eight commits between them — six of those corrective, after review** (`tadeumendonca-skills` PRs #123 and #124; `gh pr view <n> --json commits` counts them). Reading back what each correction fixed, almost all of it was reachable by the author before opening:

- a flag spelling (`--base=x`) whose class had **already been hardened in the same file**;
- **seven assertions that could not fail** — three in one guard suite where the dangerous token sat inside a quote pair by accident, a `Storage.prototype` spy that never took, a case short-circuited by an earlier guard, a defence whose test never reached it, and a regression case that denied for a different reason than the one it named. Every one found by mutation; none by reading;
- doc drift in the second PR that was **the exact pattern the first PR had just taught**;
- a rule that could not read a body written the way this repo writes bodies — a convention the author had followed all day.

None needed a fresh context. They needed a list.

**A round costs a dispatch, a re-ratification and the owner's attention. This list costs minutes.**

*Why this skill and not a hook — the harness-design argument, and the owner's rule about where mechanism belongs — is at the end, under **Where the mechanism belongs**. The checklist comes first deliberately: a reader mid-slice is here for what to check.*

---

## 1 · Completeness, at both levels

### The task, and every artifact it owes

**Enumerate the Issue's requirements and mark each met or unmet, individually.** Not "implements the issue" — that consolidates nothing, and it is the sentence the gate rejects.

A thin slice owes **all of its artifacts, not just its code**: the application change, the infrastructure that serves it, the pipeline that ships it, the **automated E2E journey**, the tests written inline, the decision record if a boundary was crossed, and the documentation the change makes stale. An artifact missing is an artifact the gate will ask for.

- Any requirement you cannot mark met is **unfinished work**, not a note for the PR body. Finish it or cut the slice and say what you cut.
- If the description is not closed enough to enumerate — no stated acceptance, a requirement you would have to invent — **stop**. That is an intake failure, and building past it produces a slice that passes its gate and still fails the person who asked.
- **Nothing ships half-done.** Scope you cut, a gate you could not run, an assumption you made: say it in the PR body. The reviewer will find it; finding it in your own report is cheaper for everyone.

### The story, when this task closes it

If this is the **last** task under its story, the story's completeness is now the question — and the leads are about to ask it. Before opening:

- **every task under the story is implemented and merged**, not merely opened;
- the story delivers what its description promised, read against the intake ratification rather than against your memory of it;
- anything it does not deliver is **named**, and named as a task rather than as a caveat.

A story whose last task is green while an earlier one is still open is not finished — and that is a state only the author can see, since each task's own gate passed.

### The DoD, item by item

Verify these yourself. Each with **evidence** — a command's real output, a line in the diff — never "looks fine":

1. **Scope** — one thin vertical slice, no unrelated changes; adjacent debt reported, not fixed inline and not filed.
2. **Traceability** — references its Issue; acceptance covered by E2E journeys.
3. **Tests proportional** — inline, to the coverage floor; a user-visible change adds a green E2E story. §2 is how you check they can fail.
4. **Gates green with real evidence** — §8.
5. **Decision recorded** — an ADR if a significance boundary was crossed; otherwise say "no ADR" explicitly rather than silently.
6. **Observability** — name the artifact that proves the new behaviour where it runs. **`n/a` is a finding, not a shrug**: say what has no observable and why.
7. **No doc drift** — §3.
8. **History hygiene** — conventional subjects; a real merge commit, never squash.
9. **Security posture** — §7.
10. **Content truth** — decide whether the diff changes anything a reader or a crawler sees, and **say which in the PR body**. That is your half: the copy lens is dispatched by the gate, so "the lens has returned" is not a thing you can verify here — but a reader-facing diff that arrives unflagged is one the gate can miss, and a literal in a component or a meta tag counts as reader-facing.

## 2 · Every assertion must be able to fail

**Coverage cannot see this and neither can reading.** A tautological test executes the line, satisfies the threshold, and proves nothing.

> **Mutate the SOURCE, run the suite, count the reds. A new assertion that adds no red asserts nothing.**

Mutate the **source**, never the test — mutating the test proves only the composition you wrote. And after each: **restore, and re-run green.**

Two shapes that recur, both seen more than once:

- **Short-circuit.** The inputs satisfy an earlier guard, so the branch under test never runs. Choose inputs that clear every prior guard, and add a **control** asserting the opposite outcome without the condition.
- **Same literal on both sides.** Asserting `X` against a component built from `X`. Pin the *coupling* instead — read the rendered value and build the expectation from it — and put "is the value right" where a stale literal cannot pass.

**A stub that cannot distinguish the inputs cannot witness the rule.** If the test doubles answer identically whatever they are asked, no assertion in the suite can observe which input the code used.

## 3 · What did this slice make false?

A rule change leaves stale claims in places the diff does not touch.

> **Grep the repo for every identifier, command name, count and claim the slice made FALSE — search the words of the OLD claim, not the words you edited — and do not stop until every hit is read and dispositioned.**

An enumeration of places to look fails open: you check the four you remember. A grep returns the ones you forgot. **But only if you grep the right thing**, and the obvious instinct is the wrong one.

**Why "made false" and not "changed", which is what this line said for one day.** A stale claim survives precisely in the files the diff did **not** touch — and those files are phrased in the words of the *old, now-false* statement. The tokens you edited and the tokens that carry the claim are, in the general case, **disjoint sets**. Searching what you changed searches the one region guaranteed to be already correct, and it returns clean, which reads as *there is nothing there*. **It fails open** — the exact failure this section exists to close.

Measured, twice in one day, on the two slices that followed the one this file shipped in:

- the sweep ran on the term that was **edited** (`agent_type`) while the sentence reaching a sibling ADR was carried by *"no exempt spelling"* and *"denies `gh issue create`"* — neither of which appears in the diff. The gate blocked the merge on it;
- and an earlier round returned three hits and acted on two, which satisfies *"read every hit"* literally. Hence **dispositioned**: each hit gets an outcome — a fix, or a recorded finding that it is not drift.

**A list names the class; a procedure finds the instances** — the same difference §2 turns on. This section was itself rewritten from a list after failing on its own PR, and then corrected again when the procedure searched the wrong thing. *A procedure with the wrong input is a list that also reassures you.*

**A second failure mode, and it is the one that LOOKS like success: a sweep that converges on what a gate can see.** Run the grep, fix the hits that turn something red, watch the suite go green, and stop — because green is the signal you were trained to stop on. **Every remaining hit sits in a field nothing checks, and the sweep is now indistinguishable from a complete one right up until someone reads the prose.**

Measured, on the slice that moved a body of knowledge between two skills. **The claim was left false in every surface a gate does not read, and corrected in every surface one does — and nobody chose that split.** The criterion, not a count, because a count here would age the moment either set moves: *fixed* was exactly *has a gated quotation compared against its carrier*; *missed* was exactly *does not*. Among the missed was the moved file's **own `description:`** — the trigger whose entire job is routing a model to the thing it now carried, telling that model to look elsewhere. Nothing was red at any point.

Re-derive the set with the words of the **old** claim rather than trusting either list:

```
grep -rn "see quality-gates\|/quality-gates" skills/ docs/blueprint-registry.md agents/ commands/ README.md
```

> **Disposition the hits BEFORE running any suite, and count them against what you fixed.** If the number you fixed equals the number that would have gone red, that is not confirmation — it is the signature of a gate-driven sweep, and the remaining hits are in the ungated fields by construction.

The cheap structural check, because a field is gated or it is not and you can tell in one look: **for every record that carries a gated field, read its ungated siblings in the same breath.** A registry row whose quotation is compared to its carrier also carries a description, a purpose and a what-it-does that nothing compares to anything.

**And run the gates BETWEEN corrections, not once at the end.** A correction is a publication and can mint its own defect, so a batch of them landed together arrives as one red with several causes — or, worse, as a green that only holds because two errors were introduced in fields nothing reads. Measured on the slice this section was written from: of four self-minted defects, **the two the suite could see were caught by a mid-round run and would otherwise have shipped inside the fix for someone else's finding.** The cost is seconds; the alternative is a review round spent separating your own corrections from the thing you were correcting.

**And its limit, which is not a defect but is a thing to know: a phrase sweep finds RESTATEMENTS, never OMISSIONS.** A grep of the old claim cannot reach a place that should now say something and says nothing — it shares none of the words you are searching for. Measured: a rule was added to two persona files, an ADR and a state table, and the *procedural narration* an agent actually reads was missed by the sweep and found by reading. **So after the grep, ask separately: where does this repo TELL someone how to do this, and does that place now know?** This section is necessary and not sufficient, for the same reason it gives about lists.

Then read each hit against these, which is where the list still earns its place:

- the **README** or equivalent published description — **and any count or table it carries.** A number bumped by a test while the rows below it stay put is the shape this repo has shipped more than once;
- the **header of the file you changed** — a contract sentence at the top that the body now contradicts;
- the **principles skills and the ADRs** that describe the behaviour;
- **persona files**, if the change alters what a persona must produce or may do.

**Supersede, never rewrite.** Strike the old sentence with the reason it stopped being true. A silently edited claim invites the next sweep to revert the decision.

*The trap worth naming:* deferring this to a later slice fails, because the sentence becomes false **the moment this one merges** — leaving the documented behaviour contradicting the real one for however long the later slice takes.

## 4 · Alternative spellings, if the diff parses anything

If the change matches command strings, paths, branch names or labels, try the forms that are legal and not obvious:

- **attached values** — `--flag=value` and `-Fvalue`, not only `--flag value`;
- **inside quotes** — text that looks like a flag but never reaches the tool as one;
- **the second occurrence** — greedy `.*` takes the *last* match, not the first;
- **word boundaries** — a marker matching inside another word is not a marker;
- **case and prefix** variants of any name you anchor on.

Most of these have escaped a matcher in this repo at least once — the API matcher walked past a quoted URL, and the quote collapse stopped at an escaped quote. Try all five anyway; the list is short and the cost of skipping one is a review round.

## 5 · Does the repo already do this differently?

The convention you are about to break is usually **your own**, from earlier the same day:

- bodies and multi-line text go through `--body-file`, never inline;
- merge with a real merge commit, never squash;
- `git -C <dir>` / `npm --prefix <dir>` instead of `cd`;
- one atomic command per call — a preference for legibility, ~~no `&&` chains~~ **not a permission
  necessity since #383**, which measured that the matcher decomposes a chain and evaluates each element
  (`shell` carries the table).

**If your change makes a repo convention impossible to follow, the change is wrong** — not the convention.

## 6 · The tree is clean and it is yours

- **`git status` before committing.** Foreign changes mean a concurrent agent left work in the tree; committing them ships something nobody reviewed.
- **Reviewers run in the same working tree.** While a gate is reviewing, use a `git worktree` rather than the main checkout — a mutation for verification and an edit for authoring look identical to git, and both parties lose.
- **Verify the branch base.** A branch cut while another slice was mid-merge starts from the wrong commit and carries its diff into your PR.

## 7 · The question the Issue does not contain — anticipate the production lens

The sections above anticipate the delivery lens. This one anticipates the other, and it is the half most often skipped **because the Issue cannot prompt it**: *can this cause a problem in production?* is not enumerable in advance — if it were, it would be a requirement.

Name the axes you looked at and what you found, **the way the gate will**:

- **Dependencies** — a new package, a version change, a lockfile move.
- **Permissions and IAM** — anything widening what CI or the agent may do.
- **Secrets** — a value, a path, a private source quoted into something public.
- **Action pins** — a moving tag where a SHA belongs.
- **New external inputs** — anything the code now reads that someone else writes.
- **The deploy path** — does this merge publish, and does the artifact change?
- **The edge function** — logic running at the CDN edge, where a mistake serves every visitor and the rollback is a deploy.

> **`n/a` is only valid when you NAME the axes you checked and found untouched.** "No security impact" is a reassurance. *"`package.json` and both lockfiles are absent from the diff; no file under `iac/` or `.github/`; a secret-pattern scan over the diff returns nothing"* is a check.

**Verify the ARTIFACT, not the diff's appearance.** A comment-only change is not automatically inert: on a build that inlines and prerenders repository content, the question is whether an edited line can be **emitted**, which is a different question from whether it is a comment.

**And ask which direction a failure takes.** A guard that fails **open** stops protecting silently; one that fails **closed** wedges the loop loudly. Both are defects — but only one announces itself, so the silent direction is the one to check first. Trace every new error path and say where it lands.

**An early return is an allow path.** If the change adds one — an `exit 0`, a `return`, a `continue` — **enumerate every rule downstream of it and prove each is still reachable.** This is not the short-circuit of §2, which is about test inputs, nor the failure direction above, which is about errors: it is a *success* path that silently unreaches code the diff never touched, so every existing test still passes and coverage does not move. Measured: one such return let two commands through with no decision at all, neither of them the case the return was written for.

## 8 · Gates, with real output

Run them and paste what they printed. **Never a claim.**

- The suite you touched, plus the suites you did not — a change to one hook can redden another.
- Lint, typecheck, build.
- The functional regression: **E2E always; an API suite only where an API exists.**
- **A gate that skipped is not a gate that passed.** If a job matched no files, say so in those words.

---

## The one-line version

> **Would a stranger reading only the Issue agree this is finished; can every assertion you added fail; is every sentence this slice leaves behind still true; and can this break production?**

Four clauses because the sections are four jobs, and the mutation pass is the one most easily skipped — by this document's own count, it found seven defects that reading found none of.

If either answer needs a caveat, the caveat belongs in the PR body before the reviewer finds it.

## Where the mechanism belongs

The harness has two ways to hold a rule: a **hook**, which is mechanical and cannot be argued down, and a **skill**, which is only as strong as the reading. The floor belongs to hooks — irreversible acts need a guarantee that survives a long context and a tired session.

**But a hook is expensive, and it can only see a command string.** Measured on the slice that added one narrow exception to the floor: **five commits, four of them corrective, and three separate bypasses** — every fix a regex trying to infer intent from what the model happened to type, across attached flag values, a number that was not the declared one, and a body written to a file. Each fix was correct and each left the next spelling open, because *intent is not in the string*.

A rule about **what "finished" means** is exactly that class. No matcher can express it, and a guard that tried would be the same regex arms race one level up.

So the trade this skill takes deliberately: **a checklist the author follows, instead of a mechanism the author fights.** It is weaker — nothing enforces it — and it is the right weakness here, because what it checks is judgement rather than an act.

**The owner's rule for this harness, in their words — a rule here, not a claim about software in general:**

> **A shell script supporting the workflow of executing tasks is an antipattern.**

Read it as scoped to *this loop's* workflow layer. Plenty of shell earns its place in this repo — the gates, the counts, the tests — and none of that is what the rule is about.

The floor is not workflow. `terraform destroy`, `rm -rf`, `git reset --hard`, a push to the trunk — those escape git and no later commit undoes them, so they earn a mechanism. ~~a force-push … a secret write~~ — **struck (#383): escaping git and being irreparable are different properties, and this sentence used the first as evidence for the second.** A force-push leaves the old tip in the reflog and in the remote's unreachable objects; an AWS secret write sits behind a version stage and a recovery window. ~~Both reverse, so both earn a **question** rather than a refusal.~~ **Second strike, same day: both DO reverse, and they earn a refusal anyway — because this harness has no working middle rung.** A hook `ask` is answered automatically in its default working mode (measured: the guard returned `ask`, the act executed with no prompt), so *question* is not a verdict that reaches anyone. **Read the general lesson and not the instance: a control's ladder is only as long as the rungs the host actually honours, and which rungs those are is a measurement, not a reading of the docs.** A `gh secret set` does not reverse — Actions secrets have no version history — and would keep its refusal under either criterion. **WIP discipline, who may open an Issue, how a story is decomposed, what "finished" means — every one of those is reversible by the next commit**, and every one of them is a rule about judgement, which a matcher cannot read.

*The line, so it does not blur:* **if the act cannot be undone, it needs a hook. If it can be fixed in the next commit, a hook costs more than it returns** — and the cost is not hypothetical: it is review rounds spent on spellings, plus a guard the loop learns to work around rather than follow.

## Decision & trade-off

**An author-side anticipation of both gates, over relying on them to catch everything.** *Trade-off:* it deliberately overlaps what the gatekeepers check, and duplicated checks can drift apart. Accepted because the alternative was measured and is worse — eight rounds on two slices, with most findings reachable before opening.

**The overlap is the design, not a cost to minimise.** The author checks the DoD to *arrive finished*; the gate re-checks it in a fresh context with no authorship bias, which is the only reason its verdict means anything. Running it twice is not waste — running it *only at the gate* is, because every item raised there costs a round.

**When the two disagree, the gate wins.** It is the ruler, and it never inherits this pass as evidence: "the author checked" is not a verification, it is a claim.

**Not a gate itself.** Nothing enforces this and it must not become a required check. It is the author's own pass, and a checklist that blocks is a third gate nobody decided to add.
