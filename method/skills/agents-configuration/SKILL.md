---
name: "agents-configuration"
description: "Run a slice through this loop's intentional design — its intake chain, state machine, iteration axis and inner-loop steps. Use when picking up a slice, proposing a change to the loop itself, or naming Agent Harness Engineering in public writing. Not the portable judgment (see engineering-standards), what \"done\" means (see definition-of-done), the CI/CD gates (see quality-gates), the permission zones (see devops), or what makes an item ready (see definition-of-ready)."
purpose: "carry the intentional design of this loop - why it is shaped this way, not only what its steps are - so every agent acting inside it can decide correctly in the cases the state table does not enumerate"
---

Apply Agent Harness Engineering — the owner's name for how this loop is built and run, the state
machine a change travels through, and the design intent behind every part of it — in any
`<project>` repo.

Context: $ARGUMENTS

This is the **universal preload**: the one skill every profile in this roster carries, because
understanding the loop itself is not domain-specific the way the rest of the process library is.

**It is the heart of this loop's blueprint, read from inside** — the owner's framing, and the
authoring standard it sets: *«agents-configuration é o coracao do blueprint do nosso loop, para ser
associado a todos agentes e eles saberem a intencionalidade do desenho do loop que estamos
implementando e perseguindo nessa configuracao/distribuicao.»* A state table tells an agent what to do
next; **this file must also tell it *why* the loop is shaped this way**, so it can act correctly in a
case the table does not enumerate — which is most cases. **What it must not become is a procedure
manual**: it is always-on in every dispatch, so depth for its own sake here is a defect, not a virtue.

**`/blueprint export` renders the same subject for a reader OUTSIDE this harness; this file carries it
for the agents inside.** Same design intent, two audiences, neither a substitute for the other — and
**nothing currently notices if the two drift.** The blueprint is a projection of
`docs/blueprint-registry.md` plus a tree read; this is authored prose. That is a coherence obligation
with no instrument behind it, named here rather than discovered later.

**Its companion is `engineering-standards`, split out of this file at #381** — the engineering
preferences that would still be true in a project that never runs this loop: the two tiers, the twelve
principles, what counts as delivery, the human residual. **The cut test was one question, applied
paragraph by paragraph:** *would this still be true in a project that does not run this loop?* Yes →
`engineering-standards`. No → here. Where a principle has a local enforcement, the principle is named
there and the enforcement here, once each.

Four companion skills carry adjacent ground and are **not** folded in here: `/engineering-standards`
(the judgment), `/definition-of-done` (what "done" means — the criteria, and which of them a gate
proves), `/quality-gates` (the CI/CD gates and their tables) and
`/devops` (the permission zones and guard hook that make the deny-boundary mechanical, plus CI/CD and
the branching topology). The single-
vs. two-environment branching topology lives in `/devops` (#227) — this skill keeps only how the state
machine, labels and inner loop work once a mode is chosen, not the mode itself.

## What Agent Harness Engineering is

Most teams point an AI coding tool at an unchanged process and write code faster inside it. Agent Harness
Engineering inverts that: **the loop itself — how a change travels from intent to live, and
every gate and guard along the way — is the thing you engineer.** The code is the output of a
well-built loop, not the point. Its spine is **agent-led verification, human-residual**: the agent
proves "done" mechanically; the human is left only the irreversible/architectural residual.

**The discipline is portable; this package is not the discipline.** Nothing about the design is
specific to one tool — the owner runs the same kind of work with Claude Code in public and with Kiro
elsewhere, which is what lets him tell the model apart from the setup around it. But **this plugin is
the Claude Code implementation of it**, and what it ships to another harness is one layer of three.

~~and ships no Kiro carrier — no configuration, no directory, no gate.~~ **Struck 2026-08-23 (#287).
Two of those three were false, and the sentence is copied verbatim into the Kiro export — so a Kiro
user read *"there is no carrier"* from inside the carrier.** It also erred in the permissive
direction: it understated what ships, which is the half of a stale claim that misleads. There **is** a
configuration and there **is** a directory — `powers/tadeumendonca-skills/`, a generated Agent Plugins
package with its own `plugin.json`, installable from Kiro's own Powers panel.

**"No gate" survives intact, and it is the load-bearing third.** What a Kiro user installs is the
knowledge layer of this harness and none of its enforcement layer: no permission guard, no merge gate,
no persona brief. That is a choice, not only a limit — but the limit is real and was measured on the
installed build: the Power **installer** transports a package's whole tree (everything but `.git`),
while the Power **loader** reads only `plugin.json`, `skills/`, `mcp.json` and `dev.kiro/`. So
`agents/` and `hooks/` would arrive on disk and never activate, which is the reason not to ship them —
an inert brief is worse than an absent one. **That reading is from the shipped bundle, not from a live
install; the version, the commands and what was *not* exercised are in
[`README.md`](../../README.md)'s Kiro section**, which is where this claim is maintained rather than
restated here.

Read a reimplementation against another harness as work someone would have to do, not as
something installed here.

The honest claim it makes (and the one it does **not**): *a development loop that turns AI-native
techniques into production-ready software* — **not** agents running in production at scale. The
loop is the track record; overclaiming the agents is off-discipline.

### The three surfaces this discipline engineers

The loop is a product with three surfaces, and this discipline owns their **design**, not their
execution. The fleet executes (the leads consolidate one demand → `developer` builds →
`quality-assurance` gates it); `product-lead` guards that the flow is *honest* (tracked,
WIP-respected). What has no other owner is the loop **as a system**:

1. **Cadence & flow** — thin vertical slices bounded by file overlap, finish-through-merge. Not "is
   each slice tracked" (`product-lead`'s bookkeeping) but "is the loop *shaped* so work flows — is
   the human's residual small, and does the slice boundary fall where the human's attention is
   actually worth spending?" A loop that asks the human on in-pattern work is a **design defect**,
   not mere friction.
2. **The gates as a composed system** — the gatekeeper (`quality-assurance`), the mechanical hooks
   (`permission-guard`, `wip-guard`, `session-wip`, `session-plugin-version`), the CI gates. The
   failure mode this discipline exists to catch is **a gate that verifies nothing**: a hook committed
   non-executable so it silently no-ops; a job that prints PASS having run nothing; a test that
   exercises the guard through a shell call and so never checks the *installed* form. A green that
   proves nothing is worse than a red. When you find one, fix the **gate**, not just the finding.
3. **The harness as the artifact** — the agent fleet, the principles, and the hooks are themselves
   versioned, tested, and improved. A defect in the loop is a bug in the *product*, filed and fixed
   like any other.

### The move that makes it a discipline, not a vibe

Every guarantee above is **mechanical or it is not real** — and the test that decides it is
`engineering-standards`', stated there once and applied here repeatedly:

> *If this guarantee failed right now, would something stop me — or only my memory?*

If only memory, it is not engineered yet — it is an intention. **This file answers "only my memory"
about several of its own rules, by name**, which is what the test is for: it is worth carrying because
it produces that admission, not because it produces a green. Each of those places says so where it
stands, rather than being collected into a list that would rot separately from them.

### Before a loop change goes into execution — re-derive the state model

**Owner rule, 2026-08-02: every time the loop is re-evaluated, redo this assessment before executing
it.** Not once, and not only when the tracker is being touched — *every* time.

Three axes, and the third is the one that gets skipped:

1. **Issue TYPES** — what kinds of work exist, and what each implies for merge class.
2. **STATES per type** — every state an item passes through, not just `open` and `closed`.
3. **WHICH ROLE acts at each transition — and what ARTIFACT records that it happened.**

The whole assessment collapses into one question, asked once per rule the change introduces:

> **What observable artifact says this rule was applied?** If the answer is *"someone reads the item
> and judges"*, the rule has no state. It will be applied inconsistently, and — worse — inconsistently
> *and silently*, because there is nothing to audit.

This rule was itself earned by a failure of exactly this shape ([ADR-0002](../../docs/adr/0002-roster-and-dev-loop.md)
amendment #8): an intake chain shipped with nothing in the tracker able to say whether a description
had been closed, one day after being written. **Keep the remedy to one bit.** Do not add a state that
duplicates something already observable — an open PR already says "in progress." Prefer the smallest
label set that makes each rule's precondition **queryable**, and if a rule needs no new state, say so
explicitly rather than leaving the axis unexamined.

### When to reach for this discipline specifically

- **Standing up the loop** in a new repo, or picking the loop model — see `/devops`.
- **A gate feels like theater**, or a green does not sit right — audit whether it verifies what it
  claims (widen the assertion to the installed form; make "did the reviewer run?" a precondition,
  not a hope).
- **The human is asked too often**, or WIP is piling — the loop's *shape* needs tuning, not more
  discipline from the people in it.
- **Validating a loop/gate change** — ~~pair it with `tech-lead` (design-time, against the principles and the ADR library) and~~ `quality-assurance` (code-time, against the Definition of Done).
  **Struck 2026-08-26 (#329), and this bullet is where the retired paired default survived its own
  correction — in the universal preload, seventy-five lines above the row that says the opposite.**
  `tech-lead` acts at **no** `loop` transition: read the `filed → **description closed**` rows in the
  states table below, which are canonical — that lane closes through `agents-lead` **alone**, with no
  exception (owner ruling 2026-08-25, one word: *"nunca"*). *Design-time validation of a loop change*
  and *`loop` intake* are the same act — the 2026-08-13 correction that established the rule was made
  on exactly such a dispatch — so this bullet was the judgement-call escape hatch ADR-0002's
  nineteenth amendment rejected by name: **a rule with a judgement-call escape hatch is the escape
  hatch**, and almost every machinery change can be described as having an architecture edge.
  **What survives untouched:** `quality-assurance` at code-time, which is the `in progress →
  **reviewed**` row — and on the `loop` lane it answers for **more** there rather than less: the same
  two-lens DoD every other lane gets, **plus** an `agents-lead` verdict marker that must be present on
  the PR before it may classify the diff safe or merge it (ADR-0002, record 0015's Corollary 2). **A
  reviewer that has to have been present, not a review that is skipped.** Struck rather than deleted
  because the pairing is what anyone reading this preload took away from it for thirteen days, and a
  rule that walked back in once walks back in again unless the door stays visible.
- **Proposing a change to the MACHINERY** — dispatch `agents-lead` before implementing it. Its
  standing question is [ADR-0004](../../docs/adr/0004-controls-and-enforcement.md)'s — *which
  layer can actually carry this control, and can that layer hold it?* Since
  [ADR-0002](../../docs/adr/0002-roster-and-dev-loop.md) it may also
  implement the harness changes it stress-tests (never merging, never gating an MR of its own — rule
  7b's catch-all and rule 5d's catch-all are unchanged by that ADR).

## Pick the loop model first

The loop has **two shapes**. They share every invariant below and differ only in how a change is
promoted. Full branching diagrams, per-environment topology, and the CI wiring live in `/devops`
(#227) — this is the pointer, not the depth.

| Model | Use when | Promotion |
|---|---|---|
| **`gitflow-multi-env`** | The repo deploys to **more than one environment** and carries an integration branch. | Two hops: PR → integration branch → staging, then a promotion PR → release branch → production behind manual approval. |
| **`trunk-single-env`** | The repo has **one long-lived branch (`main`) and one destination** — a single deployed environment, or a consumed artifact released deliberately. | One hop: PR → `main` → deploy/release. |

**How to tell**, in order of authority: the repo's `CLAUDE.md` states the model outright; otherwise
look for an integration branch (`develop`) on the remote and more than one environment in CI. **If
both signals are absent, it is `trunk-single-env`.**

## Pick the loop MODE too — and READ it, never infer it (#406)

**The loop MODEL above is how a change is PROMOTED. The loop MODE is how work FLOWS**, and the two are
independent: either model runs under either mode. A mode names a widely-known agile method and fixes
exactly two things — **what the container MEANS, and which ceremonies run at its edges.**

**Two artifacts carry it and neither is this file.** The **contract** — what a mode may vary and what it
may never touch — is the `<!-- loop-mode-contract -->` block in `CLAUDE.md` at each repository's root.
The **record** — which value is in force — is `docs/loop-mode.md`, which carries the value, the closed
enum, the back-dated start and both pool predicates in full. **This section is a POINTER plus the
minimum a dispatched persona needs, and it is deliberately not a copy of either.** The contract's
carrier is a root brief rather than this skill because the actor that *selects* a mode is the
**orchestrator**, which a skill body does not reach (#409, re-measured on #393) — while every persona
that loads *this* file is a dispatchee, and a dispatchee does not select its own mode.
**Do not copy the untouchable list here.** One rule in two wordings with no canonical home is #329
with a new subject.

| | `scrum` | `kanban` |
|---|---|---|
| the container | a **commitment** — a limb of the pool predicate, and its exhaustion is the terminal condition | a **label** — it names a period, bounds nothing, and the pool predicate does not consult it |
| the three rites at a boundary | run | **do not run** |
| ordering | ranked at the planning rite | **FIFO within the `loop`/`product` partition** |

**What does NOT vary, stated here so no persona has to go and look:** the permission floor, the merge
gate and both its lenses, head-scoped verdicts, only-the-owner-opens-work, the `product`/`content`/`loop`
routing labels, the readiness bar — **`sp:N` stays in both modes** (owner ruling 2026-09-09) — and the
container's **EXISTENCE**. Only its MEANING varies, so the iteration axis below is *commitment versus
label*, never *present versus absent*.

**The one rule to carry into every dispatch: read the mode from the record BEFORE any pool query, and
never infer it from what a query returns.** The two predicates are not distinguishable by their output —
the active-iteration derivation prints **nothing and exits 0** over an empty set, so *"`kanban`,
correctly no container"* and *"`scrum`, milestones dropped by mistake"* are byte-identical results with
opposite correct behaviours. That is rule 1's own named failure below, arriving by default rather than
by a typo, and it is the only place in this design where a wrong guess is silent.

**And nothing MECHANICAL reads the record.** `commands/autonomy.md` reads it, which is a rule a session
executes rather than a mechanism; no registered hook does, deliberately — the contract's untouchable
list is backed by a measurement that no registered hook reads any object a mode varies, and teaching one
the mode is what would end it. By this loop's own test — *would something stop me, or only my memory?* —
**the mode is not engineered.** Every section below that reads as Scrum-only is scoped by this one and
by nothing that fires.

## Intake — where work is born, and the chain it must walk

**Nothing is worked that is not recorded in the issue tracker.** No exceptions, no size threshold.

**What "closed" means for a description is `/definition-of-ready`'s subject — generically AND for this
loop, since #380 — and it is not restated here.** This section is this loop's own **mechanism** for
reaching that state — which personas close it, what label records the transition, what the state
machine does once it is set — not a second definition of what "ready" means.

**The split moved at #380 and the new line is worth stating exactly**, because the old wording implied
the concrete bar lived here and it never did — it lived nowhere. Read `/definition-of-ready` for the
SDLC-generic bar (the checklist shape, the flagship failure of scope fragmented across issues, the
relationship to estimation) **and for this loop's own concrete bar** — what `ready` asserts, the five
items a closed description carries here, and the seam sentence naming which of them a mechanism checks
and which nothing does. Read this section for **who acts and what records it**.

**The `filed → description closed` rows below did NOT move, and #329's argument is why.** They are the
canonical statement of who takes part on each lane, and they are here because this file is the
universal preload every persona carries at the moment it dispatches. A rule about *who may act* has to
be where whoever dispatches will read it; putting the operative wording where nobody looks is how #329
happened in the first place. **What is a bar went to the bar's skill; what is a transition stayed with
the state machine.**

**The chain below is the `product` lane.** All three lanes are in the states table's
`filed → **description closed**` rows, which are the canonical statement of who takes part on each —
`content` closes through `product-lead` alone, `loop` through `agents-lead` alone.

**The chain — see `agents/product-lead.md` and `agents/tech-lead.md` for the persona-level detail;
this is the canonical statement, and both briefs point here rather than restate it:**

> **The owner generates demand.** They are the only origin of work — see *Review does not open work*
> below.
>
> **The leads close the description among themselves.** `product-lead` and `tech-lead` collaborate:
> what it must deliver for the reader, what it must say to the market, what the system must carry.
> They disagree first and reconcile second; a disagreement they cannot settle goes **up** to the
> owner, never **down** as competing briefs.
>
> **Only then is the issue executable.** `developer` does not pick up an issue whose description is
> not closed.

**`agents-lead` is not a link in that chain, deliberately — and it closes the `loop` lane's description
alone.** The two are the same rule seen from either end: its object is the machinery this loop runs on,
not the product the loop builds, so it takes no part in closing a **story's** description and is the only
persona that closes a **`loop`** Issue's. It is dispatched on a **proposal about the loop itself**, before anything is
built, and per ADR-0002 that proposal now enters the tracker as a `loop`-typed Issue — filed by the
orchestrator on its naming (`agents-lead` itself remains denied `gh issue create`). `loop`-typed
`ready` is ~~an **owner-only** label transition~~ **the owner's DECISION, and the main session applies the
label once aligned with him** (struck 2026-09-25, owner ruling 2026-09-25 on #512: *«Eu, após alinhar»*; ADR-0002, record
0015's Corollary 4 and its 2026-09-25 amendment), never applied by any dispatch — see that record's section in full for the six corollaries (durable verdict marker, the
harness-diff criterion, the
proposal/build dispatch separation).

*Where the two chains meet.* A change to *how work is decided* — this skill, the states table, an
ADR that governs the loop — is still a **boundary** decision for the owner. `agents-lead` is who the
owner works that decision out with; it does not make it.

## The states

| transition | type | who acts | artifact that records it |
|---|---|---|---|
| → **filed** | all | the owner, alone | the Issue exists |
| filed → **description closed** | `product` | `product-lead` **and** `tech-lead`, dispatched in parallel and reconciling between themselves | the closed description in the Issue body, plus the intake stamp |
| filed → **description closed** | `content` | `product-lead`, **alone** — intake only, after the owner interview | the closed description in the Issue body, plus the intake stamp |
| filed → **description closed** | `loop` | `agents-lead`, **alone — `tech-lead` never co-signs this lane, with no exception** (owner ruling 2026-08-25, #329: *"nunca"*) | the closed description in the Issue body, plus the intake stamp |
| filed → **ready** | `product` | both leads, closing the description together | **`ready` label** |
| filed → **ready** | `content` | `product-lead`, alone — **intake only**; it takes no part in the drafting rounds (ADR-0002, seventeenth amendment) | **`ready` label** |
| filed → **ready** | `loop` | ~~the owner, alone~~ **the owner decides; the main session applies the label once aligned with him** (struck 2026-09-25, owner ruling 2026-09-25 on #512) — not the leads, and never a dispatch (ADR-0002, record 0015's Corollary 4) | **`ready` label** |
| ready → **in progress** | `product` | `developer` | an open PR |
| ready → **in progress** | `content` | `content-writer` — **not `developer`**, which has never been dispatched at a draft (ADR-0002, thirteenth amendment; this row said `developer` until #317 and was wrong for nine days) | an open PR |
| ready → **in progress** | `loop` | `agents-lead` (ADR-0002, record 0015's Corollary 1) | an open PR |
| in progress → **drafted** | `content` only | `content-reviewer`, at most **two** rounds against `published-voice`, **repairing the draft in place rather than blocking or handing back** (ADR-0002, seventeenth and thirty-second amendments) | **`docs/content-review/<slug>.md` on the branch** — one `## Round` section per round, each closed with `CONTENT-REVIEW-FINDINGS` or `CONTENT-REVIEW-CLEAR`; terminal on the first `CLEAR` or the second section, whichever comes first |
| in progress → **reviewed** | `product` · `content` | `quality-assurance`, against the full two-lens DoD | **a `<!-- gatekeeper-verdict: … -->` comment on the PR, carrying the head SHA it read** |
| in progress → **reviewed** | `loop` | `quality-assurance`, against the full two-lens DoD **exactly as on any other lane**, **plus** an `agents-lead` verdict marker that must be on the PR before it may classify the diff safe or merge it (ADR-0002, record 0015's Corollary 2). The marker is an **added** control, never a substitute for the DoD | **a `<!-- gatekeeper-verdict: … -->` comment on the PR, carrying the head SHA it read** |
| reviewed → **closed** | all | `quality-assurance` — safe **and** boundary since 2026-08-23 (ADR-0002 amendment #16) · the owner only on the four surviving holds | the merge, plus the verdict literal that authorised it (`APPROVE-AND-MERGE` or `APPROVE-AND-MERGE-BOUNDARY`); on a hold, the owner's ratifying comment |
| **any → blocked → back** | all | anyone, on discovering it waits on the owner or on something outside the loop | **`blocked` label** |

**`blocked` is orthogonal, not a sixth step.** It can attach at any point and returns the item to
wherever it was.

### The `filed → description closed` rows are the CANONICAL wording of the lane relation (#329)

**This table is where *who takes part at intake* is stated, and every other surface points here.** Owner
ruling, 2026-08-25: `README.md` keeps the narrative and points; `commands/new-issue.md` branches by type
and **defers** to these rows for who; the ADR-0002 amendment records *where the wording lives and why*,
not the wording. The reason is mechanical rather than editorial — **the README is prose no agent carries,
and this skill is the universal preload every persona reads at the moment it acts.** A rule exists to be
obeyed by whoever dispatches, and whoever dispatches reads the skill. **Putting the operative wording
where nobody looks is how #329 happened.**

**The three rows were ADDED, not edited.** The `filed → **ready**` rows below them were already right and
are untouched — they record *who applies the label*, which is a different question from *who closes the
description*, and conflating the two is why nothing in this file could answer the lane question before.
On `loop` the two answers differ on purpose: `agents-lead` closes the description, ~~**the owner alone
applies `ready`**~~ **the owner decides `ready` and the main session applies it once aligned with him**
(struck 2026-09-25, owner ruling 2026-09-25 on #512; ADR-0002, record 0015's Corollary 4).

**Why the `loop` row carries no exception clause, and must not grow one.** The owner's ruling was one
word — *"nunca"*. His argument, which is the load-bearing part: almost every machinery change can be
described as having an architecture edge, so **a loose exception does not stay loose — it becomes the
default case**, because the reading that admits it is always available. That is not hypothetical; it is
how the retired pairing walked back in on 2026-08-13. **A rule with a judgement-call escape hatch is the
escape hatch.**

**What this does NOT enforce, said plainly so the rows are not read as a mechanism.** Nothing observes a
dispatch. A `loop` Issue whose intake was run by both personas is indistinguishable, from the tracker and
from the diff, from one run correctly — the artifact column names the closed description, and a
description says nothing about who was asked. `hooks/scripts/inventory-counts.test.sh` asserts that these
rows and the `new-issue.md` branch **exist and say this**; it cannot assert that anyone obeyed them.

**These rows route INTAKE. The REVIEW chain is routed too, and its operative wording is NOT here (#393).**
It lives in `CLAUDE.md` at each repository's root, as one table: `loop` → one lens pass plus the gate ·
`product` → the full chain · `content` → the content pair plus the gate. **This paragraph is a pointer
and nothing else** — it names the rows without stating their conditions, and the conditions are the
rule. The carrier is a root brief rather than this skill because the actor that selects a review chain
is the **orchestrator**, and a nonce probe (#409, re-measured on #393 against build `2.1.263`) shows a
skill body does not reach it while a root `CLAUDE.md` does — while every persona that loads *this* file
is a dispatchee, and a dispatchee cannot select its own dispatch. **Do not copy the table here.** One
rule in two wordings with no canonical home is exactly #329, where the operative copy ended up in the
surface nobody read.

**`drafted` adds NO label, and that is why it is allowed to exist (#317).** It is a `content`-only
sub-state between *in progress* and *reviewed*, and the only thing that records it is a file already in
the branch's diff — so the *"what observable artifact says this rule was applied"* test is satisfied
without the tracker learning a sixth word. **The restraint stated below about `ready` being the only
state added is about the LABEL VOCABULARY and is unchanged**: nothing here is queryable with
`gh issue list --label`, deliberately, because nothing outside the PR needs to query it. Its cost is the
opposite of `ready`'s: the round is visible only to someone reading the diff, so a `content` PR that
skipped the pair looks exactly like one whose rounds were clear until you open the file list.

**`product-lead` keeps `content` intake and loses `content` craft — and the split holds because the two
acts have different OBJECTS.** **Intake judges the ISSUE** (worth doing, against what else, bounded how);
**a drafting round judges the PROSE**. The owner's decision — quoted verbatim in ADR-0002's seventeenth
amendment, not restated here — removed this persona from the flow that produces prose, and the act that
decides whether the Issue should exist never enters that flow. ~~The split is a call, not a reading.~~
**Struck at #317: the copy lens supplied that reason on review, so this no longer rests on a judgement
flagged as unsupported.** Reinforcing it: nobody else in the roster orders a `content` queue or judges
what it is worth to the reader.

~~**Its BLOCKING truth veto on published claims survives untouched** — it fires at the merge gate, relayed
by `quality-assurance` under criterion 10, rather than inside a round. **Only the craft opinion left, and
what that costs is WHEN those checks land, not WHETHER they run:** they arrive on a finished draft
instead of inside a round where acting on them costs a paragraph.~~ **Struck 2026-09-03 (ADR-0002,
thirty-second amendment).** The owner moved the copy lens off this persona for the `content` stream
entirely: *«essa lente de copy nao deveria mais ser o product lead interferindo na stream de content»*.

**What replaced it is a REPAIR, not a second veto, and saying so is the point of this paragraph.**
`content-reviewer` now edits the draft on two grounds — it can quote a clause of `published-voice`, or
the claim is false against the source — and the corrected piece goes to the held preview. **There is no
copy block left on this lane**, and a reader who sees the veto struck must not conclude the check
vanished: it moved one step earlier and changed form. **What genuinely went unreplaced is the
world-check** — cross-surface staleness, evidence proximity, the machine/ATS read, durability. **`content`
INTAKE is untouched**: `product-lead` still closes that lane's description and decides `ready`, because
intake judges the Issue and a round judges the prose. If the reading is still wrong, the row above is
where to correct it.

**Since [ADR-0006](../../docs/adr/0006-verification-and-its-artifacts.md)** the
`reviewed` row's artifact is real — the gatekeeper posts a marker comment carrying the head SHA it
read, so a verdict on a moved head fails loudly instead of reading as approval. Until 2026-08-04 that
verdict was checked by a second gatekeeper (`security`) before merge; `security` was absorbed into
`quality-assurance` ([ADR-0002](../../docs/adr/0002-roster-and-dev-loop.md) amendment
#10 — the rationale for that merge lives there, not here), so the posting rule is now
**self-enforced**: nothing verifies it but the persona itself.

**`ready` is the only state added, and the restraint is the point.** An issue with no `ready` label
is not executable — a mechanism, not something a persona must remember. *What it does not buy:*
nothing verifies the leads actually closed the description rather than one nodding it through. The
label is auditable and attributable, not proven.

## One vocabulary across every repo

| label | means | set by | queried by |
|---|---|---|---|
| `product` | the repo's own deliverable | the owner, at filing | `/autonomy on`'s queue · merge class **safe** |
| `content` | published in the owner's voice | the owner, at filing | merge class **boundary** |
| `ready` | the description is closed on that lane, per the `filed → **description closed**` rows above | the leads (`product`) · `product-lead` (`content`) · ~~**the owner**~~ **the main session, once aligned with the owner** (`loop`) | `/autonomy on` · `developer` refuses an Issue without it |
| `blocked` | waiting on the owner, or on something outside the loop | anyone | the "what needs the owner" report |
| `reader-facing` | the diff will change words or images a reader sees | the owner or the leads | which lens the gate dispatches — **a signal, never a gate** |
| `sp:N` | the item's estimated weight, one Fibonacci value from a closed set (#326) | the estimating personas for that type, median of an isolated dispatch each | `/autonomy on`'s **preflight** (an item without one blocks entry) · the points-per-week aggregation |

`product` / `content` / `loop` are exclusive per
[ADR-0002](../../docs/adr/0002-roster-and-dev-loop.md), which is the
citation for *why* — routing, not a re-argument here. **The test a label has to pass: something must
QUERY it.** A label nobody reads is decoration that ages, which is why the retired vocabulary
(`type:*`, `phase:*`, `priority:*`, `semver:*`, `status:blocked`) stays retired — each failed that
test or was superseded by a row in the table above. ~~one of the five above~~ — **struck at #326**: the
table gained `sp:N` and a prose count beside a table is a second source of truth for one fact, which is
the arrangement this repository's own gate exists because it rots. The criterion is what selects the
members; the number is derived by reading them.

**`sp:N` is the first label admitted to this table since the vocabulary was cut**, and it was admitted on
the test rather than around it: two things query it, and — unlike every candidate rejected here — no
GitHub field carries the thing it records. That is the entry rule, and it is worth stating that a label
class can pass it, or the table reads as closed when it is only strict.

**Why the formalism is not ceremony.** `quality-assurance` consolidates that every requirement of the
Issue was met, and those requirements are the leads' output — so the ruler the gate applies is
**external to the gate**. A vague issue leaves the gate nothing to anchor on, so it falls back on
impression, which has no stopping rule. That objectivity is what the labels buy: they are how the
chain above becomes checkable instead of merely believed.

### Scrum vocabulary — what these names import here, and what they do not (#372)

**The rite commands are named after the official Scrum events so a human who has never seen this loop
can tell what is happening and how to control it.** The owner's reason, and it is the ruler for every
naming decision downstream of it: *«a ideia principal que tive foi orientar a configuracao de harness
a comportamentos e elementos conhecidos pela metodologia agil do scrum para que seja mais facil para
humanos entenderem o que esta acontecendo e como controlar o harness.»*

**It is bounded by legibility, not by Scrum coverage.** *«o fluxo de trabalho podemos chamar de loop
pois é entendivel»* — `loop` stays: the flow, the issue type, the lane. **A word that already reads to
a stranger needs no Scrum equivalent**, which is why `ready`, `blocked`, `product`, `content`, every
persona name, Definition of Done, Definition of Ready and `sp:N` are all untouched. Sorting the
vocabulary by *does Scrum have a word for this* was the wrong axis and would have read as a mandate to
rename the roster.

**A Scrum name is legible BECAUSE it carries expectations, and three of the ones in play carry
expectations this loop does not honour. Say so here rather than let a Scrum-literate reader infer
them:**

1. **`sprint-planning` implies estimation-as-ceremony and a team commitment.** Neither exists. This
   loop estimates by isolated subagent dispatch with a median (`/planning-poker` is a reference
   pattern, explicitly not run as a human ceremony), and **nothing bounds how many items the owner
   admits to one iteration** — there is no commitment to under-fill against.
2. **`sprint-review` implies a stakeholder demo of an Increment.** There is none:
   **no audience, no acceptance moment and no ruler.** Merge is deploy here, so the increment has been live since each
   merge; the rite sweeps the running site and returns observations, and it gates nothing.
   ~~the rite is *refused on its shape* rather than deferred on effort: a route list rots, and a
   looker's finding is not falsifiable, so it must not be a gate. **The rite does not exist and typing
   it returns `Unknown command:`, which is correct behaviour.**~~ **Struck 2026-09-02 (#379) — the rite
   EXISTS and typing it runs a sweep.** The refusal was **satisfied, not lifted**: it ships no route
   list and it returns no verdict. **The deviation a Scrum reader must still not import is the demo**,
   and that one is not fixable by building anything.
3. **`sprint-retrospective` is the closest match and still imports one falsehood.** Scrum's
   retrospective is *the team in one room*. This one is **N isolated contexts that never see each
   other's output** — which the rite calls its mechanism, not its formatting, because a persona at
   iteration close is a fresh context and aggregating them would relocate the bias rather than remove
   it.

**Two things the rename deliberately did NOT touch, and both would have been defects.** The artifact
directory stays `docs/retrospective/<iteration>/` — a live dispatch was writing into it, prior
comments carrying the path cannot be rewritten, and three files agree on the string under a gate arm.
And **the owner's own Portuguese quotes saying «review e retrospective» are his words about Scrum
rites, not identifiers**; renaming them falsifies a quotation, which this repository has already paid
for once on exactly this operation.

**This section is in the preload rather than only in `README.md` because the README is prose no agent
carries.** `README.md` states the same three deviations for the plural external audience the owner
named, which does not read this file — the same deliberate two-home shape the four merge holds
already use. A gate arm asserts this section exists and carries its clauses; **it asserts the
disclaimer is WRITTEN, never that it is true.**

## The iteration is the unit of work

**SCOPED TO `scrum` — read this whole section against the mode in force (#406).** Everything below is
the container as a **commitment**: the pool predicate's third limb, the terminal condition, the handoff
to the closing rites. In `kanban` the same milestone is a period **label** — the pool predicate does not
consult it, nothing depends on its emptiness, and the pool is `(product OR loop) AND ready` ordered FIFO
within the type partition. **Rule 1 and rule 2 below are not RELAXED there, they have NO SUBJECT
there:** *enumerate-then-select* and *never type a milestone name into a query* bind wherever a
milestone is queried at all, and `kanban` queries none. **What crosses into both modes unchanged is the
container's existence, the readiness bar including `sp:N`, and loop-first** — the section is scoped, not
the rules it happens to sit above.


**The pool a drain works is an ITERATION, not the whole `ready` queue.** Owner decision, 2026-08-24
(#326). What the axis buys is stated narrowly on purpose: **a bounded pool and a reachable terminal
condition.** `/autonomy on` scoped by `ready` alone is unbounded for exactly the reason #103 retired
*"drain until the queue is dry"* — the queue grows by working — and an iteration is the smallest thing
that fixes a pool's contents at a moment the owner is present.

**A points-per-*iteration* series is only a rate when the iterations are the same length**; a series over
variable buckets is a burndown drawn as a trend, which on a repository whose thesis is rigor is a false
claim with a chart attached. **The rate metric is therefore points per WEEK** — a constant denominator,
immune to how long an iteration ran, and readable mid-iteration rather than only at close.

~~The weight the rate needs is not built here; see *What is not built* below.~~ **Struck within the hour
it stood, and struck rather than deleted because it was published and someone may have read it.** It was
written under a premise handed to the build — *"iterations yes, estimation no"* — that the owner's own
ratified interview of 2026-08-24 contradicts in his words: ***"inteiro. estimar antes é positivo."*** He
confirmed on 2026-08-25 that the ratified design stands. **The weight IS built: see *Estimation* below.**

### Rule 1 — the active iteration is derived from the POOL, never from a date

**The active iteration is the oldest not-yet-closed iteration holding at least one eligible item.** Dates
are metadata; they do not select. The rule is imported with its evidence: the source project first
selected *"the iteration whose date range contains today"*, which picked an iteration with zero open
items while real work sat one iteration away, and **the loop reported nothing-to-do as though it were
done.**

**That defect is reachable on this repository's own data today**, which is why the rule is adopted rather
than admired. `tadeumendonca-skills` carries one milestone left over from the retired `phase:` taxonomy,
`v0.2.0 Phase 1`, milestone number 1, holding four issues that are **all closed**:

```
gh issue list --repo <owner>/<repo> --state all --limit 200 --json number,state,milestone \
  --jq '[.[]|select(.milestone!=null)|{number,state,m:.milestone.title}]'
```

A naive *"oldest"* rule selects it and drains nothing. The pool predicate skips it, because it selects
from the items rather than from the milestones:

```
gh issue list --repo <owner>/<repo> --state open --limit 200 --json number,labels,milestone \
  --jq '[.[]|select(.milestone!=null)
          |select((.labels|map(.name)|index("ready"))
                  and ((.labels|map(.name)|index("product")) or (.labels|map(.name)|index("loop"))))
          |.milestone.number]|min'
```

**`--limit` is part of the predicate, not tidiness** — the default page is 30, and a pool query that
silently truncates selects the wrong iteration and then reports a dry pool. Same failure class as the
one above, one layer down.

**Never type a milestone name into a query — enumerate, then select from what came back.** Measured:

```
gh issue list --repo <owner>/<repo> --milestone "nonexistent-probe" --limit 1
→ (no output, exit 0)
```

**No error. An empty result is indistinguishable from a drained iteration.** Rule 1 protects against
selecting the *wrong* iteration and does nothing about naming one that does not exist — and since
exhaustion is no longer terminal (below), a typo does not stop the loop, it runs the closing ceremonies
over an iteration that never held anything. **If a milestone name is ever typed into a query, that is
the defect.**

### Rule 2 — the tracker object is a MILESTONE, and this section is it being written down

Both rules are imported as not-optional. Rule 2 is *"choose the object deliberately and write it down"*;
what follows discharges it.

**Milestones, and the choice is closer to a measurement than to a preference.** A GitHub Projects v2
iteration field cannot be driven from inside this harness at all: `gh project field-create --data-type`
accepts `{TEXT|SINGLE_SELECT|DATE|NUMBER}` and `ITERATION` is not in the set, `gh project list` fails on
a missing `read:project` token scope, and the GraphQL escape hatch is denied by the global permission
floor (`Bash(gh api:*)`). A milestone needs none of that: `gh issue edit --milestone`,
`gh issue list --milestone` and `gh issue list --json milestone` are all allowlisted already.

| requirement (#326) | milestone |
|---|---|
| one iteration per item | **yes**, and GitHub enforces it — an Issue has at most one milestone |
| mark an iteration closed | **yes**, through the reviewed read and close routes below |
| aggregate a numeric weight per iteration | **no native field**; see *What is not built* |

**The degradation, measured rather than inferred, and it is the one thing to know before trusting this
object.** The `milestone` sub-object returned by `gh issue list --json milestone` carries **four keys and
no `state`**:

```
gh issue list --repo <owner>/<repo> --state all --limit 200 --json number,milestone \
  --jq '[.[]|select(.milestone!=null)]|.[0].milestone'
→ {"description":"…","dueOn":null,"number":1,"title":"…"}
```

There is no `gh milestone` subcommand, and `state` is not among `gh issue list --json`'s available
fields, so ~~**no command available to this loop can read whether a milestone is open or closed.**~~
**Struck 2026-09-29 (#537): `python3 scripts/milestone-read.py` reads the milestone endpoint directly,
including an empty milestone, and returns state plus open and closed counts.**
~~Creating one and closing one are both owner acts in the browser.~~ **Struck first for creation at
#375 and completely at #537:** `scripts/milestone-create.py` creates and
`scripts/milestone-close.py` closes. Neither act is handed to the owner.

**Why that does not send the object back to the table, which is the honest form of this answer:** rule 1
never reads `state`. The predicate above derives the active iteration from *items*, so the one attribute
milestones cannot expose is the one attribute the design does not consult. What it does cost is the
source document's *"the iteration closes automatically"* clause, which is therefore **not adopted** —
closing is a click.

~~The alternative is unlisting `Bash(gh api:*)` from the global floor, which is the line standing
between every persona and the raw write API; one click per iteration is cheaper than reopening that
door.~~ ~~*"Creating one and closing one are both owner acts in the browser."*~~

~~**Struck 2026-08-31 (#375) for CREATION only — CLOSING is still a click.**~~ **Struck 2026-09-29
(#537): closing now has its own reviewed route.**
The owner's requirement is that the Scrum rites be executable end to end — *«voce deveria ao final
dessa reconfiguracao do loop conseguir realizar intencionalmente todas atividades previstas em ritos de
scrum»* — and creation had **no route at all**: `gh milestone` does not exist
(`gh milestone --help` → `unknown command "milestone" for "gh"`), so rule 5f's prescribed remedy
(*"use the gh subcommand for the act instead"*) is **unexecutable**, not merely inconvenient.

**The route is `scripts/milestone-create.py`, and it is an EXPLOITATION rather than a design.** It
reaches the write API because **neither the settings matcher nor `permission-guard.sh` looks inside a
script** — the same blindness that makes `python3 -c "…gh api -X POST…"` a back door, measured against
the live guard. **So nothing here may claim the raw-API route is closed**, and the floor entry the
struck sentence protects is untouched: it was never the thing standing in the way. ~~What guards the act
is `permission-guard.sh` **rule 11** — a subagent is denied, the orchestrator is asked, rule 10's exact
split, and the owner's answer to that prompt is the HITL verification #365 demands.~~ **Struck
2026-09-04 (#383): rule 11 is deleted with rule 10.** The full argument, the rejected endpoint carve-out
and the price of accepting the hole are still in ADR-0004's 2026-08-31 amendment, and the hole is still
open.

**The family is four reviewed routes since #537:** `milestone-read.py`, `milestone-create.py`,
`milestone-update.py` and `milestone-close.py`. Read identifies a milestone by number, including one
holding zero Issues, and returns title, description, state, and open/closed counts. Update accepts the
new description and expected prior description by file only and prints the prior value. ~~It refuses a
lost-update race.~~ **Struck 2026-09-29 (#537, repair round): the comparison is a local preflight before
an unconditional PATCH, not compare-and-swap. It refuses a value already stale when read but can
overwrite a write landing after that GET. GitHub documents conditional requests for unsafe methods as
unsupported unless an endpoint says otherwise, and the milestone update endpoint names no exception.**
Close reads first and refuses a milestone that is not open. All fail non-zero when
`gh` fails, and `scripts/milestone.test.py` exercises the behavior against a stub `gh` on `PATH`.

~~**What stands there now is an ABSENCE:** `scripts/` matches no allow entry, so running the script
prompts the orchestrator and refuses a subagent.~~ **Struck 2026-09-29 (#537): the reviewed milestone
family now uses the already-allowlisted `python3` interpreter.** Read, create, update and close execute
without a prompt for the orchestrator and every persona holding Bash. No settings layer changed; the
reach is the accepted consequence of the owner's non-critical pricing of milestone acts.

**One measurement that could make the route unnecessary is still NOT taken, and one obstacle to taking
it is gone:** whether `gh issue edit --milestone "<new title>"` *creates* a missing milestone. `--help`
says *"by name"*, which is a read of documentation and not a measurement. ~~and rule 10 denies that
command to the very persona that would settle it~~ — **struck: rule 10 is gone, so any persona can now
run it and settle this.** If it turns out to create, delete the script rather than keeping it.

### `loop`-typed items ARE iteration-assignable

**Decided in this slice, not inherited — the source document explicitly refuses to answer it.** There,
loop-typed items carry no iteration and sit outside the drained pool, so the question is only about where
a retrospective's output lands. **Here the premise does not hold**: `/autonomy on`'s queue is
`(product OR loop) AND ready`, so an iteration-scoped pool with loop items unassignable does not orphan a
ceremony's output — **it takes half the queue dark**. One list, one axis, one predicate.

Cost, carried knowingly: planning must slot loop items, and `loop`-typed `ready` is ~~the owner's
transition alone~~ **the owner's decision, applied by the main session once aligned with him** (struck
2026-09-25, owner ruling on #512) — so he is already the critical path for exactly these items, and this
adds one milestone assignment to a ~~transition he already performs~~ **decision he already takes**. It
adds no new gate and no new actor.

#### NOTHING is admitted into a running iteration automatically — an Issue is filed with NO milestone (#365)

**Owner's rule, verbatim, 2026-08-30:**

> *«review e retrospective geram issues somente ao final do sprint e submetidos a priorizacao do backlog
> do proximo. itens nao podem ser criados dentro do sprint automaticamente sem verificacao HITL.»*

**An Issue of any type is filed with no milestone.** Composing an iteration is the owner's act at
planning — the moment he is present and the milestone object exists. The operative instruction lives in
`commands/new-issue.md`'s *Open it* step; this is the rule it executes, stated once here.

~~**And it is the first rule in this section that is not merely an instruction.** `permission-guard.sh`
**rule 10** matches `gh issue create`/`gh issue edit` carrying `--milestone` (or `-m`) and **denies it to
every dispatched persona, asking the orchestrator**. The owner's answer to that prompt is the human
verification the rule demands.~~

**STRUCK 2026-09-04 (#383) — RULE 10 IS DELETED, AND THIS IS THE SENTENCE THAT TOLD EVERY PERSONA A
PROMPT WOULD FIRE.** It is struck rather than edited because this file is loaded on every dispatch:
a reader who took *"not merely an instruction"* from it would believe a mechanism stands where none
does. **It is merely an instruction again, and it is the only thing here.**

The owner's ruling, on the audit's criterion of **irreparable** rather than costly:
*«mexer em milestones nao é um risco crucial a iniciativa»*. A milestone assignment is undone by
`--remove-milestone` and a milestone is deleted; nothing latches.

**What that costs, said here rather than left to be inferred, because the reading it invites is
wrong.** `gh issue edit` is allowlisted in this harness's permission layer and the hook decided
*before* that layer, so **an item is now admitted to a running iteration with no prompt, no denial and
no record.** It does **not** fall through to a permission prompt. **#365's objection is unchanged** —
it was never that the act is dangerous, it was that it silently changes a running iteration's contents
and its completion bar — and what is gone is the prompt that made it visible at the moment it happened.
Nothing detects it either: no hook here reads the queue.

**`--remove-milestone` was deliberately unmatched** — taking an item back out of a running iteration is
the corrective act, not the guarded one — and that asymmetry is now the *reason the rule lost* rather
than a nicety of its design.

**Why prevention was available here when it was not for #337, #339 or #363.** *(This paragraph is kept
UNSTRUCK on purpose: it is the one thing in this section that outlived the rule.)* Each of
those shipped as detection because the act was invisible to every layer — ordering, batch composition,
an uncommitted edit. Here the act is a `Bash` command string, in a matcher this harness already
registers, and the wall those Issues hit — *a guard cannot tell "he told me" from "I did it myself"* —
**dissolves the moment the guard is allowed to ASK instead of having to KNOW.** The measurement that
made it available: the installed build accepts `permissionDecision: "ask"` on `PreToolUse`, and
`PreToolUse` hooks run even under `bypassPermissions`.

**That finding is untouched by #383 and is the most portable thing in this section.** What was decided
in 2026-09-04 is narrower and must not be read back onto it: *this particular act* was priced below the
bar. **Available is not the same as worth building** — the same sentence the escalation standard
already carries — and the next obligation that genuinely needs a human's answer should reach for `ask`
on this evidence. **Note the one thing that did change mechanically: `permission-guard.sh` now emits no
`ask` verdict anywhere**, and its `ask` helper was deleted with its last caller, so reaching for it
means re-adding it deliberately.

~~**What it costs, priced rather than shrugged at:** planning assigns N milestones, so the prompt fires N
times. Accepted, because planning is an owner-present act by construction — there is no path where this
prompt fires at a moment he is absent and should have been present, which is the property that stops an
`ask` training a bypass.~~ **Struck 2026-09-04 (#383): there is no prompt, so there is no N-prompts
cost. What replaces it is the opposite cost — planning now assigns N milestones with N silent edits,
and the owner sees each one only because he is the one driving the rite.**

~~#### A `loop` Issue joins the ACTIVE iteration at FILING, never a later one (#338)~~

~~**Owner's ask, verbatim: «tudo de loop deveria estar na iteracao corrente.»** `loop` work is never
scheduled out.~~ ~~**Scope is `loop` and only `loop`.**~~ ~~**Which repo's iteration: the one the Issue
is filed in.**~~

**Struck 2026-08-30 (#365), and it is struck rather than narrowed because #338's own failure mode cannot
occur.** Its argument was that a `loop` Issue born outside the pool is invisible to `/autonomy on` and
silently never worked. The pool is `(product OR loop) AND ready AND active-iteration`, and **a `loop`
Issue is filed WITHOUT `ready`** — ~~the owner's transition alone~~ the owner's decision, applied by the
main session once aligned with him (record 0015's Corollary 4; struck 2026-09-25, #512). The item is out
of the pool on the `ready` predicate **before the milestone predicate is consulted**, so the milestone
set at filing is inert until he acts, and when he acts he is present.

**It therefore changed exactly one observable thing — the running iteration's contents and its
completion bar** — which is precisely the scope change the owner objects to. It bought nothing and cost
the objection. He had already applied the new rule by hand, removing #357 from `sprint-01` (*«a principio
isso nao deveria influenciar a iteracao corrente»*); that was read as a one-off and it was the rule
appearing for the first time.

**What survives #338 untouched, because it never depended on the filing rule:** the *"which repo's
iteration"* answer — milestones are a per-repo namespace, so *"the current iteration"* is two objects and
the repo is named in every predicate — and **the drain's entry snapshot**. The snapshot is often read as
#338's consequence; it is not. The pool grows for reasons that outlive this strike: `product` items are
composed in, `blocked` clears, the owner admits things at planning. #338 was one contributor, never the
premise, and *What this does NOT bound* below is unchanged by this section.

### The state-model pass — the AXIS adds no label and no state, and ESTIMATION adds exactly one class

~~### The state-model pass — the axis adds NO label and NO state~~ — **the heading was struck within the
hour it stood.** It was written under the premise that estimation was out, and it was true of the axis
and false of the slice. **Corrected rather than deleted**, because a reader who took "no new vocabulary"
from it would look for `sp:N` in the wrong place.

Per the standing rule, both were walked against issue types × states × role-per-transition rather than
bolted on:

- **`ready → in progress`, all three types** — unchanged in who acts and what records it, with **two**
  added preconditions: the item is in the **active** iteration, and it carries an `sp:N`. The first is
  recorded by the **milestone assignment**, which GitHub already stores, already returns on the ordinary
  query, and already permits only one of. The second is recorded by **the label itself**.
- **Every other row is untouched.** Intake, the gate, the merge and `blocked` are indifferent to which
  iteration an item sits in and to what it weighs.
- **The AXIS adds no label**, and that restraint stands. The label vocabulary's own test is *something
  must query it*; a milestone is not a label and the pool predicate reads it directly. Adding
  `iteration:N` beside a field GitHub already enforces would duplicate an observable, which is the named
  anti-pattern.
- **ESTIMATION adds one class, `sp:N`, and it passes the same test rather than being exempted from it.**
  Two things query it — the preflight (*open, in the active iteration, no `sp:` label*) and the
  aggregation — and **no GitHub field carries a number**, so this duplicates nothing. It is the opposite
  case to `iteration:N`, and the vocabulary table below records it as a class rather than as six labels,
  because the six are one concept and a table listing them separately would be six rows nobody reads.

- **The loop-first COMPOSITION rule (below) adds neither**, and it was walked against the same three
  axes rather than assumed to be free. It changes no transition's actor and no transition's artifact —
  it constrains only the **order** in which already-eligible items are picked out of a pool that already
  exists. The state-model question *what observable artifact says this rule was applied?* has an honest
  and uncomfortable answer here: **the ordered body, and nothing else**, which is why that section
  states plainly that nothing gates it.

**Two transitions are genuinely new, and they are the ones with no artifact — so they get one.**
*An iteration was planned* and *an iteration closed* are both events a milestone's own flag cannot record
here (no readable `state`), and an event nothing records is applied inconsistently and silently.

> **The planning artifact is an ITERATION ISSUE** — one Issue per iteration, opened by the owner at
> planning, whose body is the **ordered** list of the items admitted. It records what was planned, in
> what order (milestones carry no ordering field either), and it is **closed with a criterion** like any
> other Issue, which is what records that the iteration closed.

That reuses a primitive the loop already has rather than inventing a state: it is queryable, attributable,
dated by GitHub, and it is the only place the owner's ordering can live at all.

### Loop before product — a planning-time COMPOSITION rule, and it is NOT a gate

**The owner's standing rule, 2026-08-28, in his words:**

> *«o pedido é que sempre todos itens de loop sejam atacados no inicio de sprints. lembre-se disso. faca
> enforcement se necessario.»*

**It is in force, so this section RECORDS a rule rather than proposing one** — and it dissolved a
circularity worth keeping, because the shape recurs. The rule that would order the iteration was itself
an item **inside** that iteration (this one, position 7 of 13). He answered directly instead of waiting
for the mechanism. **So this section is not a precondition for the iteration it sits in**, and a future
reader finding the rule already applied to the sprint that produced it is not looking at a defect.

**The rule.** At planning, the iteration's **ordered body** lists every eligible `loop` item before any
eligible `product` item. One ordering authority, discharged by an artifact that already exists, and the
drain keeps obeying `commands/autonomy.md`'s own *"Do not invent an order."*

**It orders only what is ELIGIBLE, and that clause is the deadlock escape rather than a softening.**
The rule ranks `(loop AND ready AND active-iteration)` ahead of
`(product AND ready AND active-iteration)`. An item **without `ready`**, or carrying **`blocked`**, is
not in the pool and therefore cannot stall it. State this explicitly or the first person to hit the
stall improvises an escape, and the standing rule is that the loop grinds work down rather than halting
on it.

**Why that clause is not theoretical — a live instance from this sprint, and it is the escape's real
shape rather than an invented one.** On 2026-08-28, position **5** (#341) needed the owner's go under
the gate's hold 1; WIP=1 held; position **6**'s build (#337) was finished and could not open its PR;
**the drain stopped until he answered.**

Note what the eligibility clause does and does not buy there: #341 was
`ready` and *in progress*, so it was in the pool and the escape did **not** apply. **The eligibility
clause covers an item that never entered; it does not cover one that entered and then stalled** — for
that, the escape is the one `/autonomy on` already names (*"When a slice hits an owner decision it did
not expect"*): write the question on the Issue, cut the slice to what can still finish, and move on.
**WIP=1 is what turns the second case into a full stop**, and that is a deliberate cost of WIP=1, not a
defect in this rule.

*Those two position numbers read `6` and `7` when this section was first written, and the correction is
a demonstration of the next subsection rather than a typo.* The order of record — `5 #341`, `6 #337`,
`7 #339` — lives in the milestone description, so a reviewer could show the claim **disagreed** with
that field but could not show it **false**: the field is mutable and unversioned, and nothing available
here distinguishes a misremembered position from one edited afterwards. **The weak home below is not an
abstract concern — this slice hit it inside itself.**

**`ready` on a `loop` item is ~~the owner's transition alone~~ the owner's decision, applied by the main
session once aligned with him** (record 0015's Corollary 4; struck 2026-09-25, #512), so a `loop` item
awaiting `ready` is by construction awaiting him — which is exactly why the pool is scoped to `ready`
and not to `loop`-ness. Measured 2026-08-28: `-skills` carried two `loop` Issues with no `ready`
(#335, #336) while `-io` carried five `ready` `product` items and **zero** `loop` items of any kind. A
rule ranking `loop` rather than *eligible* `loop` would have stalled a whole repo behind two Issues only
he could release.

#### Where the order actually lives — and it is a weak home

**The order lives in the MILESTONE DESCRIPTION, in both repos** — carrying the ruling verbatim, the
numbered positions across both trees, and the open recommendations not yet ruled on. It was chosen for
lack of an alternative and it is stated as such rather than as a design:

- **Nothing reads it.** No script under `hooks/scripts/` resolves a milestone at all. The order is
  prose, read by a human, in a field no gate opens. ~~`grep -rn "milestone" hooks/scripts/*.sh` matches
  exactly one line, and that line is a **comment** in `closure-artifact-guard.sh`~~ — **the falsifier's
  COUNT went stale within a day and the claim it supports did not**, which is the distinction worth
  keeping. Re-run at head (#357) the same command matches many lines, because `inventory-counts.test.sh`
  is itself a `*.sh` and #339's own gate arm quotes the word repeatedly. **Every match is a comment or a
  test needle; not one is a lookup.** A published command that returns a different count than its
  sentence claims reads as a refuted sentence, so the count is dropped and the property is stated
  instead: no hook resolves a milestone, and the way to falsify that is to find a `gh issue`/`gh api`
  call in a registered hook that reads one, not to count the word.
- **It is not versioned where this loop can see it.** A description edit produces no commit, no diff and
  no Issue-timeline event this harness can read — `gh api` is denied by the global permission floor, so
  the route that would expose the edit history is unavailable by construction.
- **It contradicts the paragraph directly above.** *"The planning artifact is an ITERATION ISSUE"* is
  what this skill specifies, and **there is no iteration Issue.** The specified object was not built;
  the milestone description is standing in for it. That gap is named here rather than papered over,
  because it is the same defect class #337 exists for — a rule shipped without the object it operates
  on — and the surface most likely to be read as if the object exists is this one.

**Building the iteration Issue is what would fix the home**, and it is not this slice. Until then, read
the milestone description as the order of record and treat its weakness as known.

#### Nothing gates this, and the layer analysis is why

**Ordering is not a property of a tree and not a property of a command string.** Measured against every
layer this harness has:

| layer | can it hold *loop first*? |
|---|---|
| `permission-guard.sh` (`PreToolUse`/`Bash`) | **no** — it reads a command string. `gh pr create` on a product slice is character-identical whether a loop item is outstanding or not. |
| `wip-guard.sh` | **no** — same matcher, keyed on file overlap. |
| `session-wip.sh` (`SessionStart`) | **no** — it can *report* outstanding loop items, but it fires before any pick and cannot observe the pick that follows. |
| a `Stop` hook | **detection only, one turn late** — and see the measurement below for why one is not built here. |
| `inventory-counts.test.sh` | **presence only** — it can assert this rule is WRITTEN, which is what the arm added with this section does, and all it does. |

**The only artifact that could record *"this was picked next"* is a PR's creation timestamp against the
queue state at that moment, and nothing captures the queue state at that moment.**

**A `Stop`-hook detector was designed and NOT built, on a measurement rather than on cost.** The
obvious form — *"a product PR is open while `loop` items remain in the active iteration"* — was measured
against this sprint's actual composition on 2026-08-28:

```
gh issue list --repo <owner>/<skills> --state open --limit 200 --json number,labels,milestone \
  --jq '[.[]|select(.milestone!=null)|{n:.number,m:.milestone.number,l:(.labels|map(.name))}]'
gh issue list --repo <owner>/<product> --state open --limit 200 --json number,labels,milestone \
  --jq '[.[]|select(.milestone!=null)|{n:.number,m:.milestone.number,l:(.labels|map(.name))}]'
```

**The durable reason first, because the measurement below expires and this does not.** A `PreToolUse` or
`Stop` hook receives **one `cwd`** and therefore sees **one repository**. The iteration is **not a
repo-scoped object** — it is one thing whose tracker representation is two milestones in two namespaces,
paired by a title that only convention pairs. **So no single-repo hook can observe the iteration at all,
whatever any repo happens to contain.** That holds against every future composition, and it is the
finding.

**The dated measurement that first exposed it, kept as evidence and not as the argument.** On
2026-08-28 every `loop` item sat in one repo and every `product` item in the other, the two halves of the
iteration being two milestones carrying different numbers (2 and 1) paired only by title — so the
same-repo form had **zero true positives against** that iteration's composition. **Read that as a fact
about contents on a date, never as a separation between the two repositories:** there is one development
effort and two places where files live (the owner, 2026-08-29 — *«nao existe separacao no
desenvolvimento do skills e do io»*), and the `loop` label exists in both trees. Zero true positives is
a symptom that moves when the contents move; the object being invisible from the layer is the cause, and
it does not move. The cross-repo form is buildable and
stacks three heuristics for one advisory notice: sibling-tree discovery from a payload that carries only
`cwd` (ADR-0004 calls that candidate set *"a heuristic and the weakest part"*), milestone pairing by
**title** (convention — the milestone description says so in its own words), and PR → Issue resolution
(measured over the twelve most recent PRs: the closing-keyword route resolves **9 of 12**, adding a
branch-name-suffix heuristic reaches **11 of 12**, and #330 resolves under neither).

**What would change the answer, stated so the next person does not re-walk this.** A **declared,
machine-readable order carrier** — the iteration Issue above, with the order as a parsed field rather
than prose — turns the check declarative: read the declared sequence, look up each number's labels,
assert every `loop` number precedes every `product` number. No PR classification, no tree discovery, no
prose. That is one object away, and it is the same object the *weak home* section is already asking for.

**So: the rule holds because deviation becomes visible and awkward, not because anything stops it. It is
an instruction, and by this loop's own test — *would something stop me, or only my memory?* — it is not
engineered.** Read the gate arm as asserting the rule is written down, never that a session obeyed it.

### The `loop` block MAY be carried as one branch and one MR — a PERMISSION, not a rule (#357)

**The rule, and it is one sentence.** At planning, an iteration's eligible `loop` items are planned
**individually** — each keeps its own Issue, its own `sp:N`, its own position in the ordered body — and
**may** be carried as **one branch and one merge request**. Commits stay separated per issue, so the
delivery is navigable; the closing keywords still name every issue the branch discharges.

**It is a MAY. Nothing composes a batch automatically, nothing forbids the per-item shape, and no gate
observes either.** The composition is the owner's at planning, like every other composition decision in
this section.

**Why it is worth having, and it is one reason rather than the three the proposal offered.** The saving
is **conflict-and-rebase**, not releases and not reviews. `loop` items overwhelmingly edit the same
handful of files, so N serial slices each rebase on a base the previous one just moved. Re-measured at
head over the range this Issue argues from — distinct issues touching each file, generated `powers/` and
the version-carrier files excluded:

```
git log v1.1.35..origin/main --no-merges --name-only --format='COMMIT|%s' \
  -- . ':(exclude)powers' ':(exclude)VERSION' ':(exclude).bumpversion.toml' \
     ':(exclude).claude-plugin/plugin.json'
# 7 issues → hooks/scripts/inventory-counts.test.sh
# 5 issues → skills/harness-engineering/SKILL.md · docs/blueprint-registry.md · README.md
# 4 issues → docs/adr/0004-controls-and-enforcement.md · docs/adr/0002-roster-and-dev-loop.md
```

A batch pays that cost once. **That is the whole of the benefit; the other two arguments were measured
and do not hold** — see the dropped list below.

#### More than one batch per iteration is NORMAL, and the model must say so

**The specification's headline clause was *"one Loop Batch per iteration"*. It is not adopted, because
it is false by construction rather than merely undesirable.** Two independent reasons, either of which
is sufficient:

**1 · A branch does not cross repositories, and the iteration already does.** Measured at head:

```
gh issue list --repo <owner>/<product> --state open --limit 200 --json number,labels,milestone \
  --jq '[.[]|select(.milestone!=null)|{n:.number,m:.milestone.number,mt:.milestone.title}]'
  → #556 and #516, milestone 1, "sprint-01"
gh issue list --repo <owner>/<skills>  --state open --limit 200 --json number,labels,milestone …
  → #313, #357, #358, milestone 2, "sprint-01"
```

**One iteration, five eligible items, two repositories, two milestone objects numbered 1 and 2 paired by
nothing but their title.** The moment an iteration's `loop` block spans both trees it is two branches,
two MRs, two bumps and two tags, and *"uma única revisão integral"* becomes two reviews that must agree
about one configuration. **The rule has to tolerate that shape rather than imply it away.**

**This is NOT two development efforts.** There is one, and two places where files live — the owner,
2026-08-29: *«nao existe separacao no desenvolvimento do skills e do io»*. What is two is the tracker's
representation and git's unit of integration, both of which are limitations, not design.

**And the `loop` block being single-repo today is a fact about CONTENTS, not about the rule.** Measured
at head, the product repo has **never** carried a `loop` item —
`gh issue list --repo <owner>/<product> --state all --label loop --limit 200 --json number --jq 'length'`
→ **0** — while its label set already carries `loop` alongside `product`, `content`, `ready`, `blocked`,
`reader-facing` and the full `sp:` class (`gh label list --repo <owner>/<product>`). **The label exists
there and has never been applied.** The routing labels type an item by **what it changes**, not by where
its files sit, so a `loop`-typed change to that repo's own workflows, `.claude/` settings or gate wiring
is a `loop` item belonging in that repo. Write every rule here so it survives the day that happens.

**2 · A batch that spans the whole iteration removes the installable intermediate.** Every merge to
`main` publishes a version (ADR-0005), so under the per-item shape the window between *a rule merges*
and *the rule can take effect* is bounded by whenever the owner next updates — his choice, available
after every slice. Under one batch per iteration **there is no installable intermediate by
construction**, so the iteration's entire `loop` work is authored, reviewed and gated under the
pre-batch configuration. That is tolerable for a documentation change and **not** tolerable for a hook:
this iteration shipped `hooks/scripts/preflight.sh`, a hook that can refuse a prompt, which under a
single batch would have sat inert while the rest of the batch was built against sessions it was written
to stop.

**So the practical shape is: batch by WORKSTREAM, not by iteration** — the proposal's own section 3
already names workstreams and nothing in it requires them to share one MR. **And order a batch's issues
by risk, most-likely-contested last**, because dropping the tip of a branch is free and dropping anything
earlier is not (below).

#### What a batch costs, said before anyone forms one

**A batch fails whole, and there is no cheap partial-merge path.** Simulated by three-way merge without
touching the working tree — the base is the commit, the sides are the tip and the commit's parent, which
is what `git revert` computes:

```
git merge-tree --write-tree --merge-base=<commit> HEAD <commit>^
# probed on two of this iteration's loop commits → CONFLICT in 7 files and in 5 files
```

**One `REQUEST-CHANGES` on one issue's commits leaves the iteration's whole `loop` block unshipped**, and
the implied escape — drop that issue, ship the rest — is a hand-resolved conflict across five to seven
files, under review pressure, in the files that carry the loop's own rules. Only the **last** issue's
commits are cheap to drop. Nothing bounds this mechanically; the two available bounds are compositional
(order by risk, keep batches small) and both are discipline.

**And review is traded, not preserved.** What a small diff buys is a **reviewable premise** — a reviewer
holding the whole change in view. Nothing reproduces that inside a batch-sized diff, and a traceability
matrix does not: a matrix tells a reviewer *where to look*, which is navigation, not a ruler. **The
honest statement is that the trade is favourable for documentation-shaped `loop` items and unfavourable
for hook-shaped ones.**

#### What was dropped from the specification, and why — each measured, not preferred

- **"One Loop Batch per iteration" as a RULE.** False by construction across repositories, and it
  removes the installable intermediate. Adopted as a permission instead. *(Above.)*
- **The authored traceability matrix.** Nothing in this harness parses a PR body except
  `closure-artifact-guard.sh`, which reads closing keywords rather than tables. An authored matrix is
  claim-carrying prose with no reader — this repository's named recurring failure. **Its content is
  worth having DERIVED**, which is the deferred item below.
- **Step 6, the consumer reinstall.** It has no mechanism here. There is no install path: the owner runs
  `/plugin marketplace update` + `/plugin update` and restarts, and `powers/` is a generated export gated
  by regeneration-and-diff, not an install route. What exists is `hooks/scripts/session-plugin-version.sh`,
  which compares a **version string** and injects a notice without blocking; the specification's
  *"confirmar que as cópias instaladas são idênticas ao manifest"* is a **content** identity check that
  does not exist and is not built here. **And a batch buys nothing here anyway** — one update instead of
  N was always available as the owner's choice.
- **Enforcement.** Every layer was walked and none can carry it. `permission-guard.sh` and `wip-guard.sh`
  read a command string, and `gh pr create` on a second `loop` PR is character-identical to the first.
  `wip-guard.sh` additionally sees only **open** PRs, so under WIP=1 the previous `loop` PR is already
  merged and there is nothing to overlap with — it bounds concurrency, never count-per-iteration. A
  `PreToolUse` deny would have to resolve a branch to an Issue (a suffix heuristic measured at 11 of 12
  on this repo's recent PRs), read its labels and milestone, and query merged PRs — two to three network
  calls in a hook whose file-level posture is **fail open**. **A control that fails open on every lookup
  failure, keyed on a heuristic that misses one in twelve, denying an act with a legitimate exception, is
  a control that reads as enforcement and behaves as advice.** Not built, on the same evidence #339
  rejected the same shape on.

#### Deliberately DEFERRED, not dropped: the derived commit ↔ issue coverage check

**It is the one genuinely enforceable clause in the whole specification, and it is not built here.** Both
directions are computable in CI from objects that already exist: every issue a PR closes has at least one
commit naming it, and every commit on the branch names an issue in that set. It needs no PR-body parsing,
no milestone lookup and no tree discovery.

**What it would cost, measured at head:** `git log v1.1.35..origin/main --no-merges --format='%s'`,
excluding `bump:` subjects, gives **17 of 21** carrying a `(#N)` — a commit-subject convention currently
about 81% kept, so the gate would redden on honest work until the convention is closed.

**It is deferred because it is its own decision, not because it is hard.** Folding it in prices two
decisions as one: this section is a composition permission with no mechanism, and that is a mechanism
with a red gate and a convention to enforce. **It is also worth building whether or not any batch is ever
formed**, which is the clearest sign it is a separate item.

#### Two named residuals — neither is fixed here, and both touch other people's floors

~~**1 · The `agents-lead` verdict marker is a PRESENCE check, not a HEAD check.** `permission-guard.sh`
rule 7c head-scopes the **gatekeeper's** verdict — it fetches `headRefOid` and the comment list in one
call, and since #341 an unreadable head **denies**. Nothing does the equivalent for the harness marker:
`grep -rln "harness-lead-verdict"` returns two briefs, two records, the string-identity arm in
`inventory-counts.test.sh`, a **counter** in `dispatch-metrics-stop.sh`, and a comment in
`zombie-loop-detect.sh` stating in its own words that it reads only `gatekeeper-verdict`. Hold 2 in
`agents/quality-assurance.md` reads *"a comment on the PR before you may merge it"* — **presence.**~~

~~**On a per-item slice that asymmetry costs at most one slice's diff, and re-posting on a moved head
covers it in practice. On a branch that lives a whole iteration it does not:** a marker posted at the
first commit satisfies hold 2 for everything that lands after it. **That is a real consequence of this
model, and it is recorded rather than repaired** — the repair is an added condition inside rule 7c,
which is the floor, and the floor is its own change.~~

**STRUCK AND REPAIRED 2026-09-11 (#385), and the strike lands HERE FIRST because this file is loaded
on every dispatch** — a persona that read *"presence check"* would believe hold 2 still clears on any
marker. **Hold 2 is HEAD-SCOPED now:** `agents/quality-assurance.md` requires a marker whose `commit:`
line names the `headRefOid` the gate read for its own verdict. **Since 2026-09-27 (#522) an earlier
marker of the same PR also satisfies it when its commit is an ancestor of the head, the PR's base
(its merge-base with the trunk) has not moved since it, and the tree delta from it touches no hold-2
path.** Only the newest lens marker may carry, and anything the gate
cannot read refuses — an unclassifiable repository included. The rule and its commands
are in hold 2; this sentence only keeps the preload from overstating the requirement.

**The repair is NOT the one this paragraph predicted, and the difference is the finding.** It said the
repair was *"an added condition inside rule 7c, which is the floor"*. **It is not in the floor, and a
floor rule was rejected on a measurement rather than deferred on cost:** hold 2's trigger is a path
predicate over the diff, so a `PreToolUse` deny would have to read the PR's file list to know whether
the hold applies — and `gh pr view --json files` pages at 100, so a large harness diff classifies as
non-harness and the rule **fails open**, inert exactly where it is most needed. A control that reads as
enforcement and abstains on the biggest diffs is the shape this loop exists to catch.

**What the repair actually is, in two layers, neither of which is a bound on the merge:**

- **The rule** is in the gate's own brief, held by the gate, using a payload ADR-0006 already makes it
  fetch — zero new network calls and no classification, because the gate reads the diff anyway.
- **The observation** is `hooks/scripts/zombie-loop-detect.sh`, registered on **`Stop`**
  (`hooks/hooks.json`), which reports a PR carrying harness markers of which **none** names the current
  head. It needs no classification either, and that is why it is buildable where a deny is not: it
  fires only when a marker is PRESENT and stale, so a diff carrying no marker is invisible to it and no
  misclassification is possible. **It is detection, one turn late**, and it cannot bound a merge — a
  turn that dispatched the gate and merged is over before it runs.

**The measurement that made it worth doing, taken at head rather than reasoned from the rule:** PR #454
carried **three** harness markers and **one** named the current head, so two of three cleared hold 2
while attesting a diff the PR no longer pointed at. The calibration is the gate's own marker on the
same PR under the same predicate — also 3 and 1 — which is what shows the asymmetry is in the *reading*
and not in how the two personas post.

**By this loop's own test — *would something stop me, or only my memory?* — hold 2 is still memory.**
Nothing denies a merge on a stale marker. What changed is that the loop now has one observation of the
failure where it had none, and that the rule the gate follows says *at this head* instead of *at all*.

**2 · The active iteration is derived per repository and nothing checks the two derivations agree.** The
pool predicate takes `--repo` and returns a milestone **number**; the numbers differ (1 and 2), so the
only thing tying the halves together is the **title string**, written by hand, twice. Title one
`sprint-01` and the other `sprint-1` and **each derivation succeeds, each reports a healthy pool, and the
iteration silently becomes two** — a failure that presents as everything being fine.

**Judged and deferred, and the judgement is the interesting part.** The obvious detection — derive in
both trees at session open and assert the titles match — is *not* cheap in the layer that would hold it:
a `SessionStart` hook receives one `cwd`, so it must first **discover the sibling tree**, which
ADR-0004 already calls *"a heuristic and the weakest part"*, and then pair milestones **by title** —
which is the very string whose agreement it is trying to verify. **A detector that assumes what it
checks is not a detector.** So it is its own item, on the same reasoning that kept #339 from building the
loop-first `Stop` hook, and it is named here rather than filed.

#### How this reconciles with #338 and #339, without reopening either

- **#338 governs the ITERATION; this governs the BRANCH — and #338 was struck one hour before this line
  was corrected, which moves the premise and leaves the distinction standing.**
  ~~A `loop` Issue joins the active iteration at filing;~~ **struck 2026-08-30 (#365)** — no Issue is
  filed with a milestone now, for any type — ~~and `permission-guard.sh` rule 10 holds it~~ **struck
  2026-09-04 (#383): rule 10 is deleted, so that is an instruction again and nothing holds it.** **The
  distinction this bullet exists to make is untouched:** *which iteration an item belongs to* is
  composed by the owner at planning, and *whether an item joins an **open batch branch*** is a
  different question with its own answer — admitting one means either re-opening a diff that already
  carries verdicts or deferring to the next batch. Different objects, no collision. **What #365 changed
  is only WHEN the second question can arise**: an item now reaches an iteration by a human act rather
  than at filing, so it can no longer appear mid-drain from an Issue the loop itself filed.

  *Why this survived the #365 sweep, and it is the finding rather than the fix.* **A strike lands where
  a rule is STATED and survives where it is CITED, paraphrased, or used as a premise for something
  else.** #365 struck the rule at its own heading and left it asserted here, in the file every persona
  loads on every dispatch — and it was read as current by an intake that reported correct behaviour as
  a defect. Sweep for the claim's substance, never for the sentence that was struck.
- **Admission needs no new mechanism, and it is already spelled `ready`.** The specification asks that a
  newly-discovered `loop` item enter the active batch only by explicit owner decision. `ready` on the
  `loop` lane is ~~the owner's transition alone~~ the owner's decision, applied by the main session once
  aligned with him (struck 2026-09-25, #512), and the pool predicate requires it. **That control exists;
  do not build a second one.**
- **#339's loop-first ordering is untouched.** The `loop` block is still composed ahead of every
  `product` item. This section only says the block *may* travel as one branch.
- **The drain's entry snapshot is untouched.** Terminating against the pool as it stood at entry is
  orthogonal to how many branches that pool is carried on.

#### Nothing gates this either, and the arm says only that it is written

`hooks/scripts/inventory-counts.test.sh` asserts this section exists and carries its load-bearing
clauses. **It cannot observe whether any iteration was composed as a batch, because nothing captures the
composition** — same limit, same words, as the loop-first arm above. By this loop's own test — *would
something stop me, or only my memory?* — this is an instruction, and it is one that only ever **permits**,
which is the shape with the least to lose from being unenforced.

### Estimation — the weight is an `sp:N` label, and the estimators are the personas that work the type

**Owner decision, ratified in interview 2026-08-24 and reconfirmed 2026-08-25**, in his words:

> *"inteiro. estimar antes é positivo."*
> *"todos agentes que trabalham no tipo de issue estimam"*

**The carrier is a label, because a milestone has no numeric field of any kind** — title, description, due
date, state, and nothing else. One label per Fibonacci value, closed set:

```
sp:1  sp:2  sp:3  sp:5  sp:8  sp:13
```

`gh label` and `gh issue edit` are both already allowlisted and `gh issue list --json labels` reads them
back, so this needs **no permission change and no token scope** — the same test that chose the milestone
over a Projects v2 field. Aggregation is one `jq` expression over the query the pool predicate already
runs:

```
gh issue list --repo <owner>/<repo> --state all --limit 200 --json number,labels,milestone \
  --jq '[.[]|select(.milestone!=null)|.labels[].name|select(startswith("sp:"))|ltrimstr("sp:")|tonumber]|add'
```

**Who estimates — the personas that work that type, each dispatched in ISOLATION, median recorded, no
revote:**

| type | estimators |
|---|---|
| `product` | `product-lead` · `tech-lead` · `developer` · `quality-assurance` |
| `content` | `product-lead` · `content-writer` · `content-reviewer` · `quality-assurance` |
| `loop` | `agents-lead` · `quality-assurance` |

**`scrum-master` is EXCLUDED from every row, and the exclusion is a decision rather than an oversight
(#375).** It is the one profile in the roster that appears in none of the three sets, so the absence
would otherwise read as a persona nobody remembered to place — the exact *absent is not a state* shape
ADR-0004 records for the permission floor. **The reason: it ranks the pool.** A profile that orders
which item is worked next and also assigns that item its weight is grading its own ruler, and the
median it would join is the smallest one (`loop`, two names), where a third voice would move the answer
most. It has no tool to apply a label with either, so this is what the design already implies, written
down where a reader looks for it.

**Isolation costs nothing extra here and is not a new ceremony** — a subagent cannot see another's
output, so independence is a property of dispatch rather than a discipline anyone must keep. It is the
same property the two leads' parallel intake already relies on.

**The author-estimates-his-own-work conflict is resolved without an exception, and that is why the `loop`
row has two names rather than one.** `agents-lead` authors `loop` items *and* estimates them — but never
alone: `quality-assurance` is the second voice, and it is the only persona in the roster whose whole
discipline is a fresh context. **That does not remove the bias; it exposes it in a median of two**, which
is the honest claim rather than the comfortable one.

**Where the estimate is required.** An item with no `sp:N` is **outstanding HITL work**, and outstanding
HITL work blocks the drain from entering — the owner's rule, *"todas pendencias HITL devem ser zeradas no
momento da invocacao do comando"*. It is a **preflight**, not a mid-drain check: see `/autonomy on`'s
*Preflight* for the operative wording and the one-at-a-time surfacing rule, stated once, there.

**What nothing enforces, said plainly.** Nothing constrains an item to exactly one `sp:` label, and
nothing constrains the value to the six above — a single-select field would give both for free and is
unreachable here. A gate can assert the **vocabulary is written down**; it cannot assert an item carries
one and only one. Read a sum as a sum of what was applied, never as a sum of what was estimated.

**The first pass is NOT this slice, and the figure is his rather than a re-derivation.** The whole backlog
is estimated before the first iteration — **11 `product` + 20 `content` + 2 `loop` at head → 128
dispatches**, once, accepted knowingly. That is its own slice and **the owner triggers it**: it is a
bootstrap cost, not the steady state, and once an iteration exists the pendency set is bounded by that
iteration's contents rather than by the backlog. Until it runs, every points-based series is empty — not
wrong, empty, and a chart drawn over it would be inventing its own subject.

### What exhaustion means now

**SCOPED TO `scrum` (#406), and the difference is not cosmetic.** In `kanban` exhausting the entry
snapshot ends the drain and **fires no rite** — an empty container means nothing there, and a ceremony
fired on it would be firing on noise. What exists in both modes instead is a **clock**:
`hooks/scripts/cadence-notice.sh` reports at session start how long since each rite's own artifact root
last moved, reads no mode, no container and no queue, and **reports rather than fires**. So *"nothing
fires either rite"* below is unchanged by it in either mode — a hook cannot dispatch — and the honest
comparison the carrier was built on is **clock versus nothing**, never clock versus boundary.


**Exhausting the drain's ENTRY SNAPSHOT is an internal transition, not the end of the session** — the
closing ceremonies run, and the stop moves to the planning handoff, which is the owner's. See
`/autonomy on`'s *Stop when* for the operative wording and for how this settles against #103's judgment
condition; it is stated once, there, rather than twice.

~~**One of those ceremonies exists and one does not, and the plural is where that gets lost (#355).**~~
~~The **sprint review** half, which sweeps the running product and finds a completely different class of defect, **is not built**. Read *"the closing ceremonies"* anywhere in this loop as one built and one owed.~~
**Struck 2026-09-02 (#379). BOTH exist, and the strike lands HERE first because this is the
file every persona carries always-on** — a persona that read *"one built and one owed"* would not reach
for a rite that exists, which is the same damage the struck planning sentence did below.

~~**The closing ceremonies are two, and they are complementary rather than overlapping.**~~ **Three
since #401, and the sentence is struck rather than edited because this is the always-on file: a
persona that read *"two"* would not reach for the third.**
`/sprint-retrospective` is the **method** half — the personas that ran, consulted alone, each reasoning
from its own artifacts. `/sprint-review` (#379) is the **product** half — a bounded sweep of the running
site, driven by `product-lead`, the only persona holding a browser. **`/funnel-review` (#401) is the
AUDIENCE half** — one period's published funnel read end to end, against the pieces published in it,
driven by the same persona and capped at two findings. **Each finds none of the others' class**, which
is why these are three rites and not sections of one.

**The order is `/sprint-review` → `/funnel-review` → `/sprint-retrospective` → `/sprint-planning`** —
Scrum's own for the three that carry Scrum names, and mechanically right for one more reason: the
retrospective feeds each consulted persona its own artifacts, and both earlier reports are among them.

**`/funnel-review` is a fourth RITE and not a fourth SCRUM CEREMONY, and the two must not be
collapsed.** The Scrum naming set is complete at three (ADR-0002's thirtieth amendment); Scrum has no
event for reading an audience, so this one carries no Scrum name and imports no Scrum expectation. It
is anchored to the retrospective's moment by the owner's ruling (2026-09-11) rather than to a clock of
its own. **Everything the mode contract says about *"the three rites"* at a container boundary is
unchanged by it** — this rite runs where the retrospective runs, so it inherits that answer rather than
adding a case to it.

**What the plural does NOT now mean.** The sweep declares itself a **lower bound** — routes are derived
from the product's own generator and assets are read off the page, but viewports are enumerated and an
emulated phone is not a phone. Two objects existing is not two rites running.

**And nothing FIRES either of them.** `/autonomy on` names both at its terminal condition; that is an
instruction in a command file and it is the whole of the mechanism. ~~No hook can be built for either,
and the reason is one this file already establishes for a different rule:~~ **struck 2026-09-09 (#406
slice C) — the sentence was true about FIRING and read as true about NOTICING, and one of those is now
built.** The reason it gave still holds for firing: **nothing in `hooks/scripts/` reads
the queue** — so no layer here can observe a snapshot going
empty, and a hook receives one `cwd` while the iteration is two milestone objects in two repositories.
**What `hooks/scripts/cadence-notice.sh` does is sidestep that reason rather than defeat it: it reads a
CLOCK — the version-control date of each rite's own artifact root — and makes no tracker call at all**,
so the queue's invisibility and the one-`cwd` bound never arise. It says a rite is owed; it cannot run
one, because a hook cannot dispatch. **The distinction is the whole content of this correction:
NOTICING moved from impossible-looking to built; FIRING did not move.**
By this loop's own test — *would something stop me, or only my memory?* — **neither rite is engineered.**
A notice does not change that: it is a report, and a report is not a bound.
**And the one profile whose mandate is *"did the rite run"* — `scrum-master` (#375) — cannot fire it
either.** It holds no tools, so it can only *say* a rite is owed, in a selection record nothing reads.
That is a smaller claim than "the gap is closed" and it is the honest one: the rite went from
*unobserved* to *observable by a profile somebody has to remember to dispatch*.
Stated here rather than only in the rite because this is the file all eight personas carry always-on, so
it is where a persona learns the rite exists, and learning that without learning that nothing fires it is
how a promise becomes a belief.

~~Exhausting the active iteration's pool~~ — **struck 2026-08-29 (#338).** The iteration's pool is no
longer a fixed set: `loop` items join it at filing, by the owner's decision, so *"the pool is empty"* is
not a condition a drain can reach by working. The terminal set is now the pool **as it stood when the
drain entered**, and the substitution is not cosmetic — a drain keyed on the live pool has no terminal
state at all, which is #103's argument arriving one layer down.

### What this does NOT bound, said plainly

**The iteration bounds nothing. The drain's ENTRY SNAPSHOT does.** ~~The iteration bounds the pool being
drained.~~ — **struck 2026-08-29 (#338)**, because the sentence that followed it was the load-bearing
half and it is now false for one of the two drainable types: ~~Findings from a slice land as Issues on
the next iteration by design~~. A `loop` finding lands on the **active** iteration, at filing, by the
owner's decision, so an iteration's contents are not fixed at planning and its pool grows while it is
drained. **Everything else in this paragraph survives intact and is why the axis is still worth having:**
#103's argument was never that a backlog must be small, it was that a *pool* whose contents grow while it
drains has no terminal state — and that argument now bites the iteration too, which is exactly why the
terminal set moved off it and onto the snapshot.

**What the iteration still buys, since it no longer buys the bound.** It scopes the *preflight* (the
pendency set is that iteration's contents, not the backlog's), it scopes the closing ceremonies, and it is
the denominator the tracker draws its completion bar against. Those are three real consumers; the terminal
condition is simply no longer one of them.

**Planning is still HITL and the owner still composes**, so growth is bounded by a human deciding — the
only place this loop has ever bounded anything that is a matter of worth rather than of arithmetic. What
changed is *when* that bound applies: at admission, and no longer for the duration of the drain.

**The residual, named because nothing catches it:** nothing bounds how many items the owner admits to one
iteration, so an over-filled iteration reproduces the old unbounded drain inside one milestone. There is
no mechanism for this and none is proposed — the signal is the metric (cycle time, and the count of items
carried over), not a gate.

### What is not built in this slice

- ~~**The numeric weight.** … **Not built here**, and until it is, every points-based metric starts at
  zero.~~ **STRUCK within the hour it stood.** #326's third tracker requirement was never void, and the
  weight is **built** — see *Estimation* above for the `sp:N` vocabulary, the estimator sets and the
  preflight. What is genuinely not in this slice is **the first pass**, 128 dispatches over the existing
  backlog, which is the owner's to trigger. Until it runs the points series is **empty rather than
  wrong**, and that distinction is the whole reason this bullet is corrected rather than left standing.
- ~~**The ceremonies.** REVIEW cannot run unattended in this harness — no MCP server is reachable from a
  dispatched subagent, there is no non-production environment to sweep, and resumable state has no
  durable home since #245. RETROSPECTIVE and PLANNING are dispatch-and-interview shapes, not mechanisms
  in this file.~~ **Struck 2026-08-30 (#355), and it was wrong in two different ways.** *The
  RETROSPECTIVE half is built* — `commands/sprint-retrospective.md`, a typed command the drain runs at its
  terminal condition, with the isolation, the derived consult set, the per-persona artifact and the
  cap. It was never merely a "dispatch-and-interview shape": what made it a mechanism was feeding each
  consulted persona **its own artifacts**, since a persona at iteration close is a fresh context and
  isolated speculation is still speculation. *And the MCP clause was true when written and is false at
  head* — `product-lead` declares a read-only `chrome-devtools` subset with a bounded origin, merged
  2026-08-29 (#356). ~~**The review half is still not built**, on grounds that survive the new capability
  intact — a route list rots, and a looker's finding has no ruler~~ — **struck 2026-09-02 (#379): it is
  built, and the two grounds were SATISFIED rather than lifted.** `commands/sprint-review.md` ships no
  route list (its targets come from the product's own generator, its assets off the page) and is
  explicitly not a gate and returns no verdict. **The residual the grounds did not cover is stated in
  the rite itself:** it is a lower bound, and nothing fires it. Recorded in
  `commands/sprint-retrospective.md`'s own last section as well, where the deferral was, so a reader
  who arrives at the refusal finds what discharged it. ~~**PLANNING is genuinely unbuilt and no claim is made about it.**~~ **Struck 2026-09-01
  (#378) — PLANNING IS BUILT, and this sentence is struck IN THE PRELOAD because that is where it did
  its damage.** `commands/sprint-planning.md` is a typed rite the owner invokes: it assembles the
  eligible unmilestoned work in both repositories plus the previous iteration's retrospective
  proposals, has a tool-less profile rank it, ~~presents each item alone for his ruling~~ **composes the
  iteration from that ranking and puts the WHOLE composition to him as ONE activation he confirms or
  changes (struck 2026-09-02, #393 — the walked form stopped at item 1 of 15 on the rite's first real
  run)**, and **produces the iteration object** — his wording, *«o rito deveria sim criar a iteracao como produto ao final
  dela»*, so a planning that ends without one has produced nothing. **Composition stays his**: every
  admission is his act at the rite — ~~a `permission-guard.sh` rule 10 prompt and creating the
  milestone is rule 11's~~ **struck 2026-09-04 (#383): both rules are deleted. Admission is now a
  SILENT edit (the command is allowlisted), and ~~creating the milestone still prompts only because
  `scripts/` is in no allow list — an absence, not a control~~ struck 2026-09-29 (#537): creation now
  runs through the already-allowlisted `python3` interpreter without a prompt; no guard inspection is
  needed under the owner's non-critical pricing, so review plus the blocking regression carry it.
  "Composition stays his" is now held by the rite's own procedure and by his presence at it, not by
  any layer.**
  **Struck rather than deleted because this file is loaded on every dispatch** — a persona that read
  *"planning is unbuilt"* would not reach for a rite that exists, and the strike is what tells it the
  claim changed rather than leaving the absence to be inferred. **What has NOT changed: nothing fires
  it.** No hook in `hooks/scripts/` reads the queue and a hook sees one `cwd` while an iteration is two
  milestone objects in two repositories, so by this loop's own test the rite is **not engineered** —
  ~~the same limit the retrospective half carries, and the reason *"the closing ceremonies"* still reads
  as one built and one owed.~~ **Struck 2026-09-02 (#379): all three rites now exist, so the plural is
  satisfied in COUNT.** The limit is unchanged and is now the only thing left of that sentence —
  **three objects, zero triggers.**
- **Anything that observes an iteration.** No registered hook reads the queue — ~~every `gh issue` call
  in `hooks/scripts/` is a write path~~, **struck 2026-09-09 (#406) as false at head**: two calls in
  `closure-artifact-guard.sh` are live READS (an Issue body by number; **closed** Issues in a rolling
  date window). **The conclusion is unchanged, and the reason that carries it is the property rather
  than the proxy — no registered hook selects a `--label` or a `--milestone`**, so nothing can derive an
  eligible pool. This section is a rule the loop follows, and a gate asserts only that
  the rule is **written**, never that a session obeyed it.

## The escalation standard, as this loop applies it (#393)

**The standard itself is `/engineering-standards`'** — *The escalation standard*, stated there once
because it is true of any loop that runs unattended and escalates to a human. **This section is what is
local: who composes the options here, and what this harness does and does not have.**

**The five clauses, so a persona acting mid-dispatch does not have to leave this file. ALL FIVE, or it
is not an escalation:** (1) a loop is running — a filed Issue is being worked; (2) a **dispatched
subagent** hits something on *that Issue*; (3) it rises **subagent → main session → the owner**;
(4) the trigger is a **trade** of time (work *plus* wait hours), cost (tokens) or scope (what the Issue
promises) for that item — **anything moving scope is a candidate, not an automatic escalation**; (5) the
form is a tweet at most, **at most four direct options**, his technical register, terse first, depth
pulled — because a bare question is offloading the analysis. ~~**and it always carries the
options**~~ **— struck 2026-09-03: it carries options when it is a DECISION, and none when it is an
ACTION. See the partition immediately below, which the unqualified sentence caused.**

### DECISION or ACTION — ask this before the form, and this loop enforces one half of it

**His correction, verbatim, after a pending merge was raised as a four-option picker:**

> *«se voce quer que eu faza merge isso nao é preciso mostrar em formato assim. precisa ser algo
> direto como uma ordem e o link.»* · *«que nao é uma pendencia de decisao»* · *«é uma pendencia de
> acao»* · *«enforce isso»* · *«na config do harness customizada»*

- **DECISION** — he supplies **judgement**. The loop reduced a trade and cannot pick. → the picker,
  at most four options. **`AskUserQuestion`, never a numbered list typed into prose** — his ask:
  *«use esse padrao multipla escolha para todas pendencias hitl»*, which is about decisions.
- **ACTION** — he supplies **execution**. The decision is taken; his hand on the object is all that
  remains. → **one line: the act and the link.** `Merge #397: <url>`. No options, no recommendation,
  no framing.

**The test: is there a second option the loop would actually defend?** If not, it is an instruction.
**The tell in a bad one is that every option is the same act at a different time** — *now · later ·
tomorrow · something else* is one instruction and three deferrals.

**Why an ACTION pendency reaches him at all, since clause 4 says an act with no trade is the loop's.**
Not because a trade exists — because **the loop cannot perform the act**. Merge and trunk push are
refused to the orchestrator by `permission-guard.sh` rules 7 and 7b; a credential or an external
surface is his alone. **Escalation by incapacity, never by judgement**, which is exactly why it
carries no options.

**A guard was built to enforce this half and DELETED in the same slice, on the owner's ruling. Read
why, because the reason is a rule about controls and not a detail about one hook.**

`hooks/scripts/action-pendency-guard.sh` refused a picker whose option labels carried an execution
verb beside a link to the object. Three successive narrowings — labels only, then anchored to the
leading position, then exactly one verb-initial label — and **each round of review found a new class
of genuine decision it refused.** The last round found it denying **all four of this gate's own
holds**, and `Merge it / Request changes`, which is the exact class its verb set excluded `approve` to
protect, defeated by a synonym.

**The diagnosis: it classified by LABEL SPELLING, not by CHOICE SHAPE.** Verb set → anchor →
exactly-one was a search over spellings, not a convergence, so a fourth reviewer would have found a
fourth class.

**And the argument that ended it is about the DIRECTION of its error, which is the part worth
carrying:**

> The failure it prevented cost the owner one sentence. **The failure it caused was invisible to him
> by construction** — a `PreToolUse` layer denies before he sees anything, so a suppressed decision
> reaches him as prose that reads like a decision already taken. **That is this hook's own target
> defect, produced by the hook, where nobody can see it.**

**The general rule: a preventive control whose false positives are unobservable by the person it
protects is worse than no control**, however good its true positives. Before building one, ask which
direction its errors run and whether anyone can see them.

**So this half is an INTENTION, like the rest of the escalation standard.** That is the honest state
and it is not a regression — nothing was lost that was ever held.

**One measurement survives the deletion and is worth keeping, because it is about the LAYER and not
about the hook that used it.** `AskUserQuestion` **is** routed to `PreToolUse` — measured against the
installed host bundle (`claude --version` → `2.1.260`) rather than read from docs: the tool-execution
loop calls the `PreToolUse` generator for every tool, its only exemption set is
`np = new Set([END_CONVERSATION_TOOL_NAME])` — **one member** — and the decision resolver honours a
hook `deny` **before** it consults `requiresUserInteraction`.

**Bound it exactly:** one build, one machine, **control flow read rather than a live picker watched**,
and **undocumented by the vendor**, so a future build can change it silently.

**Two consequences that outlive the deleted hook:**

- **A structured picker is interceptable, so prevention IS available on the escalation surface** — it
  was the design of that particular control that failed, not the possibility of one. Whoever tries
  again starts from a measured layer rather than from a guess.
- **A hook on this matcher can only ever DENY.** An `allow` on a tool that requires user interaction
  returns `null` and the dialog renders anyway — so this layer can suppress a question and can never
  skip one, which is precisely the asymmetry that made the deleted guard's errors invisible.

**The precondition is first for a reason: «se nao tem loop nao é hitl».** Outside work on a filed
Issue — a design conversation, an interview, an ad-hoc request typed at the terminal — **there is no
HITL pendency, whatever the subject.** A reader who meets the form without the precondition stamps
every question to the owner as an escalation, which is exactly what happened while this was being
written.

**The anchor is a FILED ITEM BEING WORKED, and it was ~~a running iteration~~ until 2026-09-09
(#406).** Owner ruling, one line: *«Trocar por issue em andamento»*. He was offered the additive form
that keeps both anchors and chose the substitution, so **the word *sprint* leaves the sentence** —
recorded rather than absorbed, because the original phrasing was ratified verbatim and this is the
loop editing his own words on his instruction. **The quoted Portuguese below is UNTOUCHED and must
stay so**: *«relacionados a issues em andamento em um sprint»* is what he said on the day he said it,
and re-basing a rule never licenses re-writing the quotation it came from.

**What the substitution buys is mode-independence.** A container that bounds a batch in one
configuration and merely labels a period in another makes the precondition vary with an axis it was
never about — and where no open item carries a container at all, the precondition never holds, so the
entire form contract is dark while every surface still reads as though it were in force. An Issue
being worked exists under every configuration this loop can be set to. **What it costs is that
*which* container the item sits in stops being part of the test**; if that ever needs to be a
condition, it is a separate rule and not this one.

His words, so the rule is not a paraphrase: *«eu apenas queria padronizar a escalacao do loop»*,
*«pendencias hitl sao apenas derivadas o protocolo de escalnomaneto padrao de subagents ate a sessao
principal»*, *«relacionados a issues em andamento em um sprint»*, *«se nao tem loop nao é hitl»*,
*«tradeoffs de tempo, custo e escopo relacionado ao issue»*, *«custo entenda-se por tokens»*, *«tempo
entenda-se como horas de trabalho e espera»*, *«coisa que mexem em escopo viram potencial decisao
necessaria escalonamento hitl»*, *«voce deveria levar sempre opcoes de decisao»*.

### Who composes the options — the leads, NAMED by `scrum-master`, dispatched by the orchestrator

**The reduction to at most four options is the loop's work, and on a scope escalation it may need both
leads first.** The owner's words: *«para isso o scrum master pode precisar envolver antes o product
lead e o technical lead»*.

**The pairing is the trade itself.** The escalation trades time, cost and scope. `product-lead` holds
what the scope is worth and where it sits against the queue; `tech-lead` holds what it costs to build
and what it drags in. **Neither alone can compose an honest option set for a trade with both halves.**

**`scrum-master` NAMES the leads a decision needs; it cannot dispatch them.** It holds `tools: []` — no
dispatch, no `Bash`, no label — so the naming lands in its selection record and **the orchestrator
dispatches**. Read any wording that sounds like it consults them as the naming, never the act.

**Bounded, or this is the product ceremony returning through a side door.** They are consulted **to
produce the option set for ONE escalation and its trade — nothing else.** Not a slice review, not an
ordering pass, not an intake. At most four direct options come back.

**When the two leads disagree, the disagreement IS the trade and it goes to him as the options.**
`scrum-master` does not resolve it and neither does the orchestrator — the same shape intake already
uses, where an unsettled disagreement goes **up** rather than **down** as competing briefs.

### What is instrumented here, and what does not exist

**The instrument exists and nothing reads it.** `dispatch-metrics-stop.sh` records tokens and duration
per dispatch, so the cost axis and the wait half of the time axis are both measured in this tree today.
**No threshold exists anywhere and none is authored** — the calibration comes from metrics and worklog
over real iterations, which is his decision and not a build's.

**Three things were missing and are named rather than assumed away:**

1. ~~**A WORKLOG does not exist.** He named *«metricas e worklog»*; the metrics half is
   `dispatch-metrics-stop.sh` and the worklog half has no equivalent in this tree.~~ **Struck
   2026-09-23 (#499): a host-neutral, explicit worklog now exists at `scripts/worklog.py`, with its
   contract in `docs/worklog/`.** It has no automatic producer and does not read the metrics hook.
   **Do not read `dispatch-metrics-stop.sh` as the worklog:** it remains a separate cumulative
   token/duration instrument with its existing format and deduplication.
2. **The mapping from a story point to tokens and hours does not exist.** The worklog uses frozen
   points for team planning velocity and deliberately does not make `sp:N` a token/hour denominator.
   **The question is open and asked rather than answered:** *how does this loop
   decide that an item's cost or time has gone wrong?* There is no mechanism.
3. **No AFK/HITL contract table is written into this harness.** The owner imported a blueprint carrying
   one; what exists here is the five-clause standard above and nothing tabular. **The table is his live
   design work and is deliberately not authored here.**

**And one correction that must travel, because the wrong rule is available from a real source.** That
imported blueprint's escalation rule is *reversibility, not seniority*. **This loop's rule is the trade
test**, and the two disagree about live acts — creating an iteration is barely reversible and trades
nothing; deferring an item is trivially reversible and trades scope for time. **If a proposal arrives
citing reversibility as the escalation rule, that is the blueprint speaking and not the owner.** The
permission floor's own irreversibility test is untouched and is a different question — it decides what
may never execute without a human, not whose decision a choice is.

### What enforces this — almost nothing, and the honest split is worth carrying

**Clauses 2, 3 and 4 are not checkable by any layer in this harness.** Nothing records that a subagent's
return was an escalation rather than its ordinary output; nothing distinguishes a relayed escalation
from the orchestrator's own prose; and whether a question was a genuine trade is a judgement no string
check reaches. **Do not build something that pretends to check them** — a detector that fails open is
worse than none, which is this loop's own rule.

**Clause 1 is a query and clause 5's shape is string-checkable**, but only once something declares that
an escalation is happening — inferring it from prose fails open. And **every layer available here is
DETECTION, one turn late**: a permission layer reads a command string, and an escalation is a message to
a human, which no matcher sees. By this loop's own test — *would something stop me, or only my memory?*
— **the escalation standard is an intention.**

## Session-start and end-of-turn checks — instructions now, not hooks (#61)

**The method carries no hooks** (requirements document, sections 4a and 6). The plugin's hooks are
retired: the deny floor carries what `permission-guard.sh` refused (#59), per-agent tool lists carry
what `mcp-guard.sh` limited, and the interaction standards carry the picker rules (#60). **The checks
below were hooks that reported; they are now steps you run yourself.** By this loop's own test —
*would something stop me, or only my memory?* — every one of them is memory. Say so if you skip one.

**At session start, in a git repository:**

1. **The open pull-request queue.** List the open PRs (`gh pr list --repo <owner>/<repo> --state open`)
   and name any whose newest gate verdict is `REQUEST-CHANGES`, or names a head the PR no longer points
   at. An inherited queue is told, not remembered.
2. **The workstation version key.** The user brief carries this check; follow it there.
3. **The rite cadence.** Where the repository keeps rite artifacts, say how long since each artifact
   root last changed (`git log -1 --format=%cs -- <root>`). Report it; it fires nothing.
4. **Finished worktrees.** `git worktree list`, and name each whose branch is merged and so removable.
   Report; remove one only as part of the work it belongs to.
5. **Tooling.** If `git`, `gh` or `jq` is missing, say so before the first command that needs it.

**At the end of a turn:**

6. **An unaddressed verdict.** If an open PR of this session carries a `REQUEST-CHANGES` verdict, or a
   verdict at an old head, and the turn did not act on it, say so.
7. **The PR link.** Hand the owner a PR link only when it is ready to merge with every check green and
   the gate's verdict at its head leaves the act to him. If such a link is owed, give it.
8. **A closure without its artifact.** If an Issue closed this turn declares `invocable:` and the
   artifact does not resolve, report it.
9. **What you did with your own hands.** When you are the orchestrating session, list the writes and
   posts you made yourself rather than through a dispatched agent.

**Not carried:** the per-dispatch token and duration metrics. Each agent harness's native usage
reporting is the source (enforcement matrix, usage row; #76).

## Opening a session — decisions before work

**Collect the pending owner decisions across the whole queue and ask them as a batch, before choosing
what to build.** One question at a time, in one sitting. Asking a decision when a slice hits it
produces one stall per slice; asking them up front produces one conversation and unblocks everything
at once.

Then **`product-lead` states the order**, and the session works it:

> Starting a slice that is **not** the top of the stated order requires `product-lead` to have
> returned a new order, or the session records that the order is unchanged.

**A session with no pending decisions says so.** A step that silently did nothing must not read like
a step that ran.

**Each decision lands as an artifact on the issue it unblocks (#85)** — a comment, not only
conversation — so the ratification survives the session that made it and a later reader can find why a
slice went the way it did without reconstructing the chat.

## What gets worked next — discovered vs requested

**Work you discover only preempts work the owner asked for when it BLOCKS it.** File everything,
always — evidence in hand is worth recording whether or not it is worked. The test:

> Does the requested work ship **wrong**, or **not at all**, without this?

Yes → it goes first, stated as a blocking relationship. No → it queues like everything else and
`product-lead` orders it. Discovered work is cheap to justify (found in context, usually safe class,
merges without the owner); requested work needs decisions, sometimes the owner's own words. Left
unchecked, the autonomy gradient sorts the queue by what can flow without a human, which is exactly
backwards from what a backlog is for.

## What "delivered" means — stated in `engineering-standards`

**Delivery versus hygiene, and the rule that a session with zero product slices is a finding rather
than a status, moved to `engineering-standards` at #381** — it holds in any project, names no
mechanism of this one, and is what the report the drain produces is written against.
`/autonomy on`'s own reporting rule cites it by that framing and is unchanged.

## Closing an issue is a step, with a criterion

**The loop must be able to REMOVE work, or it has no terminal state.** Close an issue when any of
these holds, and state which one in the closing comment:

- **Superseded** — a later decision answered it. Say what superseded it.
- **Implemented elsewhere** — the mechanism exists now, under another slice's name. Point at it.
- **Its premise no longer holds** — the condition that produced it is gone.
- **The cost of tracking exceeds the cost of rediscovering it** — real, small, cheaper to find again
  than to carry. Say so plainly rather than pretending it was fixed.

**A closing comment that states no criterion is not a close, it is a deletion.** This is the owner's
act, like opening one — the permission floor leaves closing open everywhere, deliberately: opening
work commits the owner's future attention, closing it releases attention already committed. But
**propose the batch and the criteria**; do not close silently.

### An Issue that promises an invocable artifact declares it, and does not close while it is missing

**A closing keyword is not evidence.** `Closes #NNN` fires on merge and knows nothing about whether
the thing the Issue promised exists. Measured (#337): **three Issues closed with their operable half
unbuilt** — #313 shipped `docs/blueprint-registry.md` and closed with `/blueprint` non-existent, twice;
#326 shipped the iteration rules and created none of the objects they operate on; #431 shipped a
truth-fix against a ratified ask for a detector nobody built. Each was found because the owner asked.

**So the promise is written into the Issue body as a field, at column 0**, and the field name is a
parsing contract read literally by `hooks/scripts/closure-artifact-guard.sh`:

```
invocable: /blueprint                    a plugin identifier a reader can type
invocable: hooks/scripts/detector.sh     a repo-relative path
invocable: none                          this Issue promises nothing invocable
invocable-waived: /blueprint <reason>    the promise was narrowed, and here is why
```

**Who writes it: the lane's own intake, when it closes the description** — the same act, no new state
and no new label. `none` is a real answer and the common one; the field exists so that *promised* and
*promised nothing* stop looking alike.

**What it buys, and the two facts that bound it — both measured, neither assumed.** ~~A manual
`gh issue close` on an Issue with an unmet declaration is **refused**.~~ **Struck 2026-09-04 (#383):
it is not. That hook's `PreToolUse` arm was removed — zero fires in thirty days, a predicate covering
only the minority route, and an act undone by reopening the Issue — so a manual close on an unmet
declaration now EXECUTES SILENTLY (`gh issue close` is allowlisted in both settings layers) and is
REPORTED at the end of the turn by the surviving `Stop` arm. Struck rather than edited because this
file is loaded on every dispatch, and a persona that read "refused" would believe a bound exists.**
~~A close by closing keyword is
**executed by the forge on merge**, so nothing in this harness can refuse it — that case is *reported*
at the end of the turn instead, one turn late, exactly the class `zombie-loop-detect` is.~~

**Struck 2026-08-30 (#363). The premise was true of the CLOSE and false of the MERGE, and the whole
design of the missing control turned on the difference.** Nothing can refuse the forge's close — that
half stands, and the `Stop` arm still covers it **for an Issue that declared a promise**. But the
close only happens *because a merge happened*,
**the merge is a tool call, and `permission-guard.sh` rule 7c was already intercepting it, already
fetching the PR and already reading the gate's verdict head-scoped.** ~~Rule 7d (#363) adds one field to~~
~~that same call — `closingIssuesReferences`, the forge's own resolved set, **zero additional**~~
~~**round-trips** — and denies the merge when it contains an Issue the gate's verdict at the current head~~
~~does not declare on a `closes:` line. So the route is refusable one step upstream of the act everyone~~
~~was looking at.~~

**STRUCK 2026-09-08 (#383, slice S4) — RULE 7d IS REMOVED, AND THE STRIKE LANDS HERE FIRST because this
file is loaded on every dispatch.** A persona that read *"the route is refusable"* would believe a
mechanism stands where none does. The owner's criterion is *«situacoes irreparaveis»*, and the act 7d
refused — the forge auto-closing an Issue the verdict never declared — is repaired exactly by
`gh issue reopen`. **`closure-artifact-guard`'s `PreToolUse` arm went at slice S1 of the same audit,
partly because 7d covered the route it could not**, so the pair now leaves the class with **no refusal
surface at all**. Both removals are correct on the criterion and the second-order effect is real; it is
recorded rather than argued with. What survives 7d's removal, because it is a property of the forge and
not of the hook: the forge's resolved closing set is derived from the merge request BODY alone, a
NEGATED closing keyword still creates the link (#393 slice A), and a prose mention is not a
declaration. The body-derived limit is stated once below, where it always was.

**Two limits ride with it and are not closed by it:** `closingIssuesReferences` is **PR-body-derived**
— measured with a throwaway PR carrying `Closes #358` only in a commit message, the field returned `[]`
— so a keyword living only in a commit message is invisible; and no hook sees a **browser** merge.
**The `Stop` arm is not redundant with the refusal and must not be retired against it — but it does NOT
cover those two, and reading it as the patch is the error this paragraph carried for one round.** Its
predicate is *an Issue that **declares** an `invocable:` line*, and #355 — the instance rule 7d was
built from — declares none, re-derived at head with
`gh issue view 355 --json body --jq '[.body|split("\n")[]|select(test("^invocable"))]'` returning `[]`.
So the arm could not have fired on it by any route. **An undeclared Issue closed by a browser merge or
by a commit-message keyword is caught by nothing at all.** And the
promise is **declared, never derived**: deriving it from prose was measured over twenty closed Issues
and produced eleven unresolved identifiers with **zero** true positives, which is a gate that reddens
on honest work until someone loosens it into nothing.

**The limit, stated wherever the rule is:** an Issue that declares nothing is invisible to the guard,
and nothing mechanical forces the declaration. **The scope is Issues promising an invocable artifact
and nothing wider** — a `content` Issue closes on a published article and a record Issue on a merged
record; neither is this rule's business, and both answer `invocable: none` if they are closed by hand
at all.

## Review does not open work

**Only the owner decides what enters the queue.** A REVIEW never files: an agent that turns its own
finding into an Issue has decided something should exist and is merely asking for agreement
afterwards. Findings are **named** — in a verdict, in the PR, to the human — and the owner decides
whether any of them becomes tracked work.

**Enforced by WHO is asking.** `permission-guard` rule 5c reads `agent_type`, ~~which the harness
stamps and the model cannot forge~~ which on Claude Code the harness stamps and the model cannot
forge, and which on Codex, since #501, is DECLARED by the session (a parent names the role it
spawns, and a config can declare any role name), so there it is a routing signal and not an
identity check (ADR-0004's 2026-09-23 amendment); every subagent except `developer` (rule 5d) is denied
`gh issue create` outright, and the main loop is asked. Reading, listing, commenting, labelling and
closing stay open everywhere.

**The one exception.** A story is broken into tasks, and `developer` executes them. **Opening scope**
is creating work nobody asked for; **decomposing** is dividing work the owner opened and the leads
ratified. `developer` may file a task, and the rule it must follow — *only under a story carrying
`ready`, referencing its parent, never extending the story* — lives in `agents/developer.md`, and
`quality-assurance` verifies it on the task's own MR.

**Why, measured rather than assumed.** In one session the queue grew by 19 issues net, with roughly
13 born inside a *review of something else*. Every finding became work nobody had decided to do. The
accepted cost: a finding in a verdict is ephemeral where an Issue is not — fewer things tracked, some
real findings lost, preferred to a queue that grows by working.

## The agent's state while a slice is blocked — stated in `engineering-standards`

**What an agent does while waiting on an actor it does not control moved to `engineering-standards`
at #381.** It is a rule about turn-taking with a human, true of any agent on any machinery, and it
names nothing in this loop. The obligation is unchanged: name and BEGIN the next non-overlapping
action before ending the turn, or say plainly that there is none.

## Inner loop (per slice)

1. **Plan-first**, then implement. Ask only on architecture / contracts / irreversible calls; decide
   autonomously on in-pattern implementation.
2. **One thin vertical slice at a time**, end-to-end and reviewable. Keep it surgical; adjacent debt
   is **named, not refactored inline and not filed** — see *Review does not open work*.
   ~~**WIP=1 — one worktree, one in-flight branch, one open PR at a time, full stop, until formally
   reversed** (owner correction, 2026-08-13; see *WIP=1* below for the struck predecessor rule and
   why).~~ **REVERSED 2026-09-11 (#385) — this is the formal reversal that clause was waiting for**,
   and the strike lands here because this is the operative sentence a builder reads on every dispatch.
   **The bound is now `wip:` in `docs/loop-mode.md`, read from the record and never assumed** — it is
   `2` at the time of writing, and a value read from a file is the point. **Development parallelises;
   THE REVIEW GATE DOES NOT** — at most one merge request is in review at a time, whatever `wip` says
   (owner ruling 1, stated in `CLAUDE.md`'s `loop-mode-contract` block, which is the surface that
   reaches the orchestrator). **Isolation is a `git worktree` per slice**, which is what ruling 4
   re-permits. **Nothing enforces any of it**: `wip-guard.sh` is deleted and `gh pr create` is
   allowlisted in both settings layers, so an (N+1)th PR executes silently.
   **Integrate `main` before requesting review** if `main` has moved.
3. **Develop locally**, against whatever backing services the repo actually has — see `/devops`.
4. **Validate locally**: run the repo's **functional regression** and self-verify the gates (lint,
   typecheck, coverage). Report with the real output, never a claim.
5. **Run `/code-review`** before opening the PR — the author's own completeness pass. *Namespaced
   deliberately:* a bare `/code-review` resolves to a different, external marketplace plugin this
   repo also installs.
6. **`quality-assurance` reviews every MR, holding TWO lenses in one pass** — delivery (*was every
   requirement of the Issue met?*) and production (*can this cause a problem in production?*). Both
   are labelled per finding. The gatekeeper posts its verdict to the PR before returning — a
   `<!-- gatekeeper-verdict: … -->` comment carrying the head SHA it read
   ([ADR-0006](../../docs/adr/0006-verification-and-its-artifacts.md)). A relay
   from the invoking context is a notification, never the authority.

### Always true

- **Pipelines are independent per repo** (never cross-trigger). Infrastructure changes are
  **pipeline-only**: a reviewed plan on the PR, apply on merge.
- **Merge with a real merge commit, never squash** — each thin slice's conventional commits are the
  changelog and the slice-by-slice trail.
- **The regression suite must functionally cover 100% of implemented features.** Which suites that
  means is per repo — E2E always; an API suite only where an API exists.
- **Something irreversible always asks.** The models differ on *which* act is the point of no return,
  never on whether one exists.

## The merge is the go/no-go — who decides which class

**"The merge is the go/no-go" does NOT mean "the merge always asks a human."** What the merge asks
for is a **judgement**, and who supplies it depends on the class:

- **Safe class** — docs, dependency bumps, tests, in-pattern implementation of an already-approved
  spec. **`quality-assurance` merges it**, once both of its lenses are green.
- **Boundary class** — infrastructure and anything threatening continuity, a change to the loop's own
  rules, publishing in the owner's voice. ~~**The gate never merges these.** It approves pending the
  human and hands the go/no-go up.~~ **Struck 2026-08-23** ([ADR-0002](../../docs/adr/0002-roster-and-dev-loop.md)
  amendment #16, the owner's decision): **the gate merges these too**, under its own verdict literal
  `APPROVE-AND-MERGE-BOUNDARY`, and **the owner reviews live, after deploy**. The argument is the loop
  model itself — under `trunk-single-env` there is no preview to hold for, so holding the merge produced
  no staging copy to inspect, only a queue. **Under `gitflow-multi-env` this reasoning does not
  transfer** and this skill does not extend it there: a repo with an integration branch *does* have a
  place to hold a change and look at it, which is the whole premise the retirement rests on.

**Four holds survive, and none of them survives on the preview argument** — read them as separate rules
that happen to have lived inside "boundary class" until it stopped being a hold, not as the retired
clause under another name. On any of these the gate returns `APPROVE-PENDING-HUMAN` and does not merge:

1. **An expansion of the gate's own authority** — a diff widening which class it may merge, removing a
   boundary trigger, or otherwise loosening its own mandate. Unconditional, whatever the diff looks like;
   see [ADR-0011](../../docs/adr/0011-skills-and-preload.md) for the record of this clause drifting out
   of `agents/quality-assurance.md` and back in, which is why it is restated in two places on purpose.
2. **A harness diff carrying no `agents-lead` verdict marker ON THE PR** ([ADR-0002](../../docs/adr/0002-roster-and-dev-loop.md),
   record 0015's Corollary 2). It is a *missing reviewer*, not a class. **The surface is part of the
   hold, not context** (#336, owner's ruling): the marker literal is a PR-only string, and a comment on
   the Issue — where `agents-lead`'s **intake** stress test lands, deliberately without the marker
   envelope — satisfies nothing here. Until 2026-08-28 the producing brief said the opposite about the
   case it called common, and a gate with two places to look and no rule saying which fails
   unattributably in either direction.
3. **Anything in `iac/`** — the merge applies, a destroyed resource is not recovered by a revert, and
   there *is* a preview here: the plan posted on the PR.
4. **An explicit lens `ESCALATE`**, or a `BLOCKING` truth finding from `product-lead` — a lens has one
   path to the owner and this is it. **It cannot fire on a `content` diff since 2026-09-03**: that lens
   does not run there, so this hold has no object on that lane, and the honest statement is that a
   `content` piece reaches merge with none of the four holds available rather than with one
   (ADR-0002, thirty-second amendment).

*Significance beats in-pattern:* when the class is unclear, it is boundary — which now means the gate
merges it under the boundary literal rather than holding it, so **when what is unclear is whether one of
the four holds applies, the conservative reading is that it does.**

**A FIFTH verdict literal exists since 2026-09-01 (#374), and it is NOT a fifth hold.** The holds above
are still four. `APPROVE-EXECUTOR-BLOCKED` means *DoD green, class safe or boundary, none of the four
holds applies* — so the verdict would have been a clearance — **and the gate could not execute the
merge**. The decision is made; only the act is outstanding, and it becomes the owner's by exception.

**Why the state needed a name rather than an inference.** Rule 7b makes `quality-assurance` the only
permitted executor of an authorised merge, so a layer outside this harness refusing to dispatch it —
Claude Code's auto-mode classifier does, recorded in the transcript as `toolDenialKind:
"automode-blocked"` — leaves the PR open, cleared, with nothing anywhere saying so. And *"a clearance
posted and the PR still open"* is a **race detector**, not a strand detector: the healthy sequence is
verdict-then-merge seconds later, and no artifact distinguishes the two at any single instant.

**Two things this does not change**, said because a new literal invites the assumption that it does.
**Rule 7b's single-executor design stays** — the strand is the correct failure of a correct rule, and
rule 7c refuses a merge carrying this literal, deliberately. And **the gate must have ATTEMPTED the
merge once at that head to be entitled to post it**: a refusal nobody attempted leaves no record, and
measured across two PRs in one session, the loop that skipped the attempt as pointless produced no
signal at all. The full decision, its rejected options and the readers that must move in lockstep are
[ADR-0004](../../docs/adr/0004-controls-and-enforcement.md)'s 2026-09-01 amendment.

**What the safe/boundary split still decides, since a distinction that changes nothing should be retired
rather than kept:** which of the four holds can apply (every one is a boundary trigger), which verdict
literal is posted — so the merge record itself says whether anything shipped without a pre-publication
check — and what the verdict must state. What it no longer decides, outside the four holds, is **who
merges**.

This framing above is the corrected one — an earlier prose restatement of it, in the retired
`dev-loop` skill this file replaces, said the opposite (*"auto-merging to `main` is never in-pattern
here"*) and went stale against
[ADR-0004](../../docs/adr/0004-controls-and-enforcement.md)'s classified-autonomy decision
without anyone noticing until the two disagreed in front of an agent (#62). That incident, and the
decision-currency lesson it carries, is recorded as ADR-0004's 2026-08-13 amendment rather than
re-told here — this section states only the current, corrected rule.

**Failure path:** revert the offending merge and let the revert deploy/re-release — a forward fix
with a new slice, not a long-lived hotfix branch.

## What the human does, and the judgment behind it — stated in `engineering-standards`

**The human residual and the eleven principles in two tiers moved to `engineering-standards` at
#381**, on the cut test above: every one of them is true of a project that never runs this loop, and
none of them names a persona, a hook or an ADR of this one. Nothing was edited in the move.

**What did NOT move is the WIP bound below, and that is the one place the split had to choose.**
Principle #3 states that a bound exists; *what this loop's bound is*, the owner correction that
produced it, what it protects and the measurement showing nothing enforces it are all local — they
cite `wip-guard.sh`, this repository's own PRs and two dated incidents. So the principle is stated
there once and the rule is stated here once, and neither file says *see the other one* for its own
half.

## WIP=1 — the struck exception, and why — ~~and the rule that replaced it~~ **REVERSED 2026-09-11 (#385)**

**READ THIS BEFORE THE SECTION: WIP=1 NO LONGER HOLDS.** The bound is `wip:` in `docs/loop-mode.md`
(`2` at the time of writing), development parallelises on `git worktree`, and **the review gate stays
serial at any value** (ADR-0002's thirty-fourth amendment; owner rulings, 2026-09-10). **Everything
below is kept because it is the record of how the rule got there and what it was protecting**, and two
parts of it outlived the reversal and are still load-bearing:

- **the failure class it caught** — two slices in ONE checkout, and an uncommitted probe left applied
  to a shared tree — which is precisely what **a worktree per slice** now prevents by construction
  rather than by discipline. **The reversal does not reopen it; it closes it a different way.**
- **the finding that nothing ever enforced WIP=1** (*`wip-guard.sh` did NOT enforce WIP=1*, below).
  That is why the reversal cost nothing to execute — there was no mechanism to dismantle — and it is
  equally true of the new bound.

`engineering-standards`' principle #3 used to read, and this project's own struck-not-deleted
convention keeps the old text visible rather than erasing it:

~~**A slice may start while another is open only if they touch no file in common**; if they overlap,
finish the first to its Definition of Done. Serial focus beats half-finished breadth — but serialising
*disjoint* work buys nothing and stalls the queue, which is why the bound is overlap and not a
count.~~

**Struck 2026-08-13 (owner correction).** This session tested the disjoint-files exception directly —
two disjoint-file issues were built in separate `git worktree` checkouts at the same time — and the
owner corrected it on sight: *"nao temos intencionalidade de trabalhar assim por enquanto"* ("we have
no intention of working that way for now"). The written rule and current intent disagreed, and intent
wins.

~~**State plainly, in its place: one worktree, one in-flight branch, one open PR at a time — full stop,
until this is formally reversed.**~~ **THAT REVERSAL HAPPENED — 2026-09-11, #385, by the exact route
this sentence named: an explicit owner decision, recorded the same way.** The worktree mechanism itself — a separate checkout sharing the
same repo's history, removed after merge — is **not** struck; it remains the correct isolation tool
for a single build. Only the license to run two of them at once is struck. A future session may
reverse this by the same route: an explicit owner decision, recorded the same way.

~~**Named residual: the policy above and the mechanism disagree.** `hooks/scripts/wip-guard.sh` still
denies a second PR only on file **overlap**, not on a raw count — the mechanism
[ADR-0002](../../docs/adr/0002-roster-and-dev-loop.md)'s twelfth amendment (2026-08-13)
describes, unchanged by this correction. So today the hook permits a second, disjoint PR that this
written policy now forbids. Follow the written policy regardless of what the hook allows;~~ ~~closing the
gap is a `wip-guard.sh` change, not a docs one, and is not this skill's job to make.~~ **Struck
2026-08-29 (#343): it is true of the count half and FALSE of the half that actually cost something.**
No change to `wip-guard.sh` could close the checkout gap, for the reason recorded immediately below —
the hook fired at `gh pr create` and the failure happens hours earlier. Struck rather than deleted
because it stood for sixteen days and it is the sentence that told every reader the gap had a known
remedy and merely needed doing.

**And the outer strike is 2026-09-04 (#383): THE HOOK IS DELETED, so there is no longer a mechanism
for the policy to disagree with.** The residual did not shrink — **it grew, and it is now the whole
of the situation**: nothing whatsoever bounds work in progress. Read the next section as the record
of a hook that is gone rather than of one that underdelivers, and read the policy above as held by
instruction alone, which is what the next section already concluded while the file still existed.

### What WIP=1 is PROTECTING — recorded 2026-08-29 (#343), because it was never written down

**The rule stood for sixteen days with no recorded reason, and a rule whose reason is unwritten is one
the next reader reverses on the first inconvenience.** #343 was opened to reverse it; the owner
declined — *«por enquanto siga com a regra de wip»* (2026-08-28) — and re-scoped the item to this
recording, on the ground that **a proposal to relax a rule whose purpose is unwritten cannot be
evaluated.** What follows is written in three deliberately separated layers, because they are not
equally strong and blending them is how a reconstruction becomes a citation.

**Layer 1 — what the owner actually said, quoted and dated. It is thin, and saying so is the point.**

- **2026-08-13**, striking the disjoint-files exception: *"nao temos intencionalidade de trabalhar
  assim por enquanto."* A statement of intent. **No reason given, and none has been given since.**
- **2026-08-28**, declining the reversal: WIP=1 continues; he wants to evaluate a proposal admitting
  parallel work later; and the precondition he named is **not tooling** — the personas and skills are
  not yet equalised across his other harness projects.
- **Earlier, on [#88](https://github.com/tedeuxx/tadeumendonca-skills/issues/88)**, rejecting a
  *count*: *"acho que nao faz sentido implementarmos wip, é contra produtivo. o que eu tava tentando
  alcancar com ele é evitar uma penca de prs com merge complicado se ficam caducados."* **The stated
  concern there was stale PRs rotting into conflicts, not concurrency** — which is why
  `wip-guard.sh` bounds file overlap and not a count.

**These three do not compose into one purpose, and this record does not pretend they do.** #88 argues
against a count; the 2026-08-13 correction imposes one; the 2026-08-28 answer keeps it while pointing
at an unrelated precondition. **Read layer 1 as the whole of the recorded intent. It is an intent, not
a rationale.**

**Layer 2 — the failures the rule demonstrably catches, from EVIDENCE rather than reconstruction.**
**Both items below are the owner's own report. Neither is an instrument reading, and this heading says
so rather than borrowing the word "measured" from the section beneath it** — that section's two
figures are measurements, these are not, and the distinction is the reason layer 2 is a layer at all.
**Two instances, and the second is what stops the first being an anecdote:**

- **2026-08-28 — two slices ran in ONE CHECKOUT** at the same time and neither agent was told. Both
  discovered it by accident: a reviewer's measurements landed against `main` rather than its branch,
  and a builder's fixes landed on the wrong branch's working tree.
- **Earlier — a mutation probe left APPLIED to a source file in the product repo while THREE agents
  shared ONE BRANCH.** A probe exists to be reverted; three writers on one tree meant nobody owned the
  revert, and it stayed. *(The file is named in ADR-0002's twenty-fifth amendment rather than here —
  this skill is published and project-agnostic, and a consumer path in it is a gated defect.)*

*(Source for both: the owner's own comment on #343, which enumerates them as what this record must
capture "from evidence rather than reconstruction". They are reports, not something re-measured here.)*

**The second instance also shows why nothing could have caught either, and it is worth more than the
first for that reason.** An uncommitted edit left applied to a shared working tree produces **no
commit, no diff and no ref naming it.** Searched at head, across every ref, for a commit that ever
introduced or removed the probe's own marker in that file:

```
git -C <product-repo> log --oneline --all -S "<the probe's marker>" -- <the file>
→ (no output)
```

**Nothing, and the nothing is the finding rather than a gap in the search** — the probe was never
committed, so no commit can carry it. **The failure class is invisible to git by construction**, and
*"discovered by accident"* is therefore not carelessness; it is the only discovery route that exists.
*(No count is published beside this. The first draft of this paragraph cited "twenty content commits"
which was a `-20` display cap read as a total — the exact defect this repo publishes commands to
prevent, caught by re-running the command without the limit.)*

**Neither is a file-overlap failure, and that is the whole finding.** A shared *checkout* is not a
shared *file*, so `wip-guard.sh` would have permitted both — it intersected path lists, and the two
slices' path lists need not intersect at all for the tree underneath them to be one object. **On the
`profile.ts` instance it is worse than permitted: three agents on one branch share one path list, so
there was no second PR for the guard to intersect against at all.** *(That hook was deleted on
2026-09-04, #383. The tense is past throughout this paragraph for that reason; the finding is about
the failure class and does not depend on the hook still existing.)*

**Layer 3 — what remains unrecorded, stated so nobody mistakes layer 2 for it.** Layer 2 says what the
rule catches. It does **not** say what the owner wanted caught, and those are different claims. If the
purpose turns out to be *"I want to see every change as it happens"*, no amount of isolation tooling
satisfies it and separate worktrees answer nothing. **That question is still open and only he can
close it** — which is precisely why the proposal he asked for is a different artifact from this one.

### `wip-guard.sh` did NOT enforce WIP=1, which is why REMOVING it (#383) changed nothing about what protects you

**The hook was deleted on 2026-09-04**, under the owner's dehydration criterion — *a mechanical lock
survives only where no other harness element can carry the control*. The two facts below are why that
removal costs nothing: **they were measured while the file still existed, and each concludes that the
file was not holding WIP=1.** A reader who thought it was is wrong in exactly the same way before and
after the deletion; the only thing that changed is that the misreading is no longer available.

**What the removal DOES cost, stated plainly rather than folded into the sentence above:** the hook
bounded one real thing — a second PR of the same author overlapping an open one's file list — and
nothing bounds that now. `gh pr create` is allowlisted in both `settings.json` layers, so the act
**executes silently**; it does not fall through to a prompt. Under WIP=1 that bound had no work to do
(fact 1), which is the whole argument for accepting the loss, and it is an argument about the policy
being obeyed rather than about the act being safe.

**Two independent facts, both measured at head on 2026-08-29 and re-derived on 2026-09-04 where they
are still re-derivable, and each one alone is enough.** *(The
two dates in this section differ on purpose: an EVENT is dated from the artifact that reports it — the
owner's comment on #343, `createdAt` 2026-08-28 — and a MEASUREMENT from the day it was run. A record
that dates an event off the authoring session's clock post-dates its own source, which is how this
section read for one round.)*

**1 · Under WIP=1 the hook never ran its overlap check at all.** It read
`gh pr list --state open --author @me`, so with the previous PR already merged the list came back
empty and the script exited at `[ -z "$open_prs" ] && exit 0` before computing a single path. **This
half is still re-derivable at any head, because its subject is the PR queue rather than the deleted
file** — re-run 2026-09-04 over the fourteen most recently merged PRs (#402 down to #377), **zero had
any other PR of the same author open at their creation instant**:

```
gh pr list --repo <owner>/<repo> --state merged --limit 14 --json number,createdAt,mergedAt \
  --jq '[.[]] as $p | [$p[] | .number as $n | .createdAt as $c
        | {pr:$n, open_at_create: [$p[]
            | select(.number != $n and .createdAt < $c and .mergedAt > $c)] | length}]'
# → open_at_create: 0, fourteen times out of fourteen (2026-08-29 and again 2026-09-04)
```

**It bounded concurrency; it never bounded a count per iteration, and across the whole `sprint-01`
`loop` block it did not fire once.** *(Bounds of the measurement: this repo only, the fourteen most
recent merged PRs only, and `--author @me` scoping means a bot's PR is outside it either way.)*

**2 · It was structurally blind to checkout identity, by construction and not by oversight.**
~~`grep -c worktree hooks/scripts/wip-guard.sh` → **0**.~~ **That falsifier died with the file on
2026-09-04 and is struck rather than left standing: a command that now matches nothing reads to
whoever runs it as *"nothing to worry about"*, which is the failure this repo names most often.** The
claim is still falsifiable, against git history rather than against the working tree:

```
git log --oneline --all --diff-filter=D -- hooks/scripts/wip-guard.sh   # the deleting commit
git show <that-commit>^:hooks/scripts/wip-guard.sh | grep -c worktree   # → 0
```

It derived its own side from `git diff --name-only <merge-base> HEAD` in whatever directory it
happened to run in, so two agents in one checkout produced the *same* answer and it could not tell
them apart. Other hooks in this same directory *do* reason about worktrees explicitly —
`zombie-loop-detect.sh` and `orchestrator-tool-census.sh` — so the harness knows the object exists;
that guard simply was not about it.

**And no version of that hook could have been.** It was a `PreToolUse` on `gh pr create`, which is the
*last* act of a slice. The 2026-08-28 collision did its damage during the build — a measurement read
off the wrong branch, an edit written to the wrong tree — **hours before any PR was created**. A
control that fires at the merge boundary cannot observe a failure that completes before the boundary
is reached. That is a moment problem, not a matcher problem; it is why the struck clause above was
wrong to promise the gap away as a hook change, and it is the load-bearing reason the deletion is not
a loss of protection.

**So: WIP=1 is held by instruction and by nothing else.** By this loop's own test — *would something
stop me, or only my memory?* — **it is not engineered**, and the 2026-08-28 collision is what that
costs when the memory is a fresh context that never had it. That sentence was true while the hook
existed and is unchanged by its removal, which is the point: read WIP=1 as protecting the **working
tree** from being two things at once, and note that the **merge queue** — which the hook did protect
from stale overlapping branches — now has no mechanism either. Different objects, different moments,
and since #383 neither of them has one.

## Using this skill

This file is the loop you are inside. Read it for *why* a rule is shaped the way it is, not only for
what the rule says — that is what lets you act correctly in the cases the state table does not
enumerate, which is most of them.

See also: `/engineering-standards` (the judgment applied inside all of this — the two tiers, the
twelve principles, delivery versus hygiene, the human residual), `/definition-of-done` (the Definition
of Done — the criteria and the seam table), `/quality-gates` (the CI/CD gate tables per loop model and
the merge-class rules), `/devops` (the permission zones and guard hook, branching,
per-environment topology, OIDC, the deploy workflows, TFC state), `/definition-of-ready` (the
SDLC-generic bar this loop's intake chain reaches), and `/documentation-standard` (the ADR practice
that records decisions about all of it).
