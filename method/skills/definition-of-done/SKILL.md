---
name: "definition-of-done"
description: "Design or evaluate a Definition of Done, and apply THIS loop's own — the criteria a slice calls finished, plus the table naming which of them a gate proves and which nothing does. Use when building a DoD from scratch, checking a slice against this loop's criteria, or diagnosing why review still reads as subjective. Not for the CI/CD gates and thresholds themselves (see quality-gates), or a work item's readiness to be built (see definition-of-ready)."
purpose: "teach what makes a Definition of Done a ruler rather than a phrase, independently of any one project's gates"
---

> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).** This
> text moved from the `tadeumendonca-skills` plugin. Where it names a plugin hook, guard rule or test
> (`hooks/…`, `permission-guard.sh` and its numbered rules, `mcp-guard.sh`, `inventory-counts.test.sh`
> and the like), it describes that plugin; **none of those runs in this method**. (If the plugin is
> still enabled beside this method, its hooks do run, and they refuse these bare-named agents' posting,
> merging and filing; that is why installing this method is opt-in until the cutover, #63.) Read any rule they
> held as an **instruction you follow**. What is still mechanical, where the workstation installed it:
> the **deny floor** (native deny rules by command prefix — force-push, `git reset --hard`, recursive `rm`, `git clean -f`,
> the `gh pr merge --squash`/`-s` prefixes, secret writes, `gh api` write methods, `gh repo delete`/`archive`/`rename`, releases and
> package publishing, `terraform apply`/`destroy`, `sudo`), and **each agent's own tool list**, which is
> native in Claude Code and Kiro and an instruction in Codex. The session checks that replaced the
> plugin's reporting hooks are in `agents-configuration`, *Session-start and end-of-turn checks*.

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
The plugin's retired `closure-artifact-guard.sh` read a declared `invocable:` line and checked that the
named artifact exists; in this method that check is an instruction (`agents-configuration`, end-of-turn
check 8). **Its predicate is EXISTENCE; row 9's is REACH.** In the measured
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
`/ci` and `/provisioning`). *"The regression passes locally"* is the concrete pre-deploy gate.

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
