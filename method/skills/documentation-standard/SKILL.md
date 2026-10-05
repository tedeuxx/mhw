---
name: "documentation-standard"
description: "Write or review documentation for any <project> repo — general docs (README, architecture pages, diagram choice, Markdown + Mermaid only) AND Architecture Decision Records (MADR format, the significance gate, the methodology/product library split, numbering and status, and the current-codebase rule for a reversed decision). Use when adding a README or architecture page, choosing a diagram type, reviewing drifted docs, writing or superseding an ADR, or judging architectural significance."
purpose: "keep documentation diffable and decisions durable, so a fresh context can load what was already decided instead of re-deciding it"
---

# Documentation — the general standard and the ADR practice

Write or review docs for any `<project>` repo following the platform's documentation standard.

**Two bodies of content, kept legible as two sections rather than blended (#260).** Part I is
*general documentation* — README, architecture pages, diagram choice, the Markdown + Mermaid rule,
where a doc lives. Part II is *the governed artifact* — an Architecture Decision Record: MADR format,
the significance gate that decides whether one is owed at all, the methodology/product library split,
numbering and status, and the current-codebase rule that replaced supersede-never-delete (#281,
[ADR-0020](../../docs/adr/0020-an-adr-earns-its-place-by-explaining-the-current-codebase.md)). They
were two separate skills until #260, on the owner's own call, made **after** he was shown that the split
was legitimate rather than accidental — general
docs describe a *system*, an ADR records *one decision that was made about it*, and neither collapses
into the other. Merged anyway because both bodies belong to the same object (repository documentation)
and a reader who needs one is very likely, on this platform, to need the other in the same sitting. Read
Part I for *how to document the system*; read Part II for *how to record a decision about it*.

Context: $ARGUMENTS

## Part I — General documentation (README, architecture pages, diagrams)

### Rule

All documentation is **Markdown + Mermaid**. **No static image diagrams** — every diagram is Mermaid so
it stays diffable and versioned. (ADRs, Part II below, are a specific document *within* this standard —
see Part II for their own format, which layers MADR structure on top of this rule rather than replacing
it.)

### Where a document lives — the placement rule

**A `docs/` folder belongs to the smallest unit that owns the thing being described, and travels with it.**
Resolve it in that order and the paths below follow mechanically:

1. **The deployable unit owns its docs.** A standalone repo puts them at `docs/`; a monorepo puts them at
   `<unit>/docs/` — one folder per workspace (the SPA, the API, the IaC root), never one shared folder at
   the top pretending to describe all three.
2. **Name the file for the question it answers, not for the unit** — `architecture.md`, `data-model.md`,
   `sequences.md`. The unit is already the directory; repeating it in the filename buys nothing and
   breaks the cross-repo habit of knowing where to look.
3. **A diagram that spans two units is duplicated from each side, not centralised.** Each copy is drawn
   from its own unit's vantage point (what it calls out to, what calls it), because a single "system"
   diagram is the one that rots first — nobody owns it, so nobody updates it on a change.

*Why placement is a rule at all:* docs decay in proportion to their distance from the code, and the only
reliable forcing function is that the same PR touching the code also touches the file next to it. A
`docs/` folder one repo away is a folder nobody's diff ever reaches. **The ADR libraries in Part II are
the one deliberate exception to "next to the code"** — they live at each repo's own `docs/adr/` root
regardless of which unit a decision concerns, because a decision record needs one stable, browsable
index per repo more than it needs to sit beside the specific file it changed.

### Diagram types

| Diagram | Mermaid | Where |
|---|---|---|
| Infra architecture | `flowchart TD` / `graph LR` | `docs/architecture.md` (each repo) |
| Data model (tables) | `erDiagram` | `docs/data-model.md` in the API unit |
| Flows / integrations | `sequenceDiagram` | `docs/sequences.md`, one per unit that participates |
| Frontend components | `flowchart LR` | `docs/architecture.md` in the SPA unit |

### Expected content per file

- **`iac/docs/architecture.md`** — Terraform module dependency graph (+ network topology when a VPC is provisioned: subnets/NAT/endpoints).
- **The API unit's `docs/data-model.md`** — `erDiagram` of the persisted entities (fields, types, implicit relations); on a document store, the implicit relations are the ones worth drawing, since nothing in the engine declares them.
- **The API unit's `docs/sequences.md`** — the auth exchange end to end, one representative write path (admin → API → store → notification), and any request that leaves the normal path (a bot/SEO render, a webhook).
- **The API unit's `docs/architecture.md`** — compute × gateway × data store × secrets × object storage.
- **The SPA unit's `docs/sequences.md`** — login, one representative authenticated fetch, one paginated/infinite-scroll read.
- **The SPA unit's `docs/architecture.md`** — pages × hooks × store × services.

### Conventions

- Every repo has a `docs/` folder; keep diagrams next to the code they describe (Part II's ADR libraries excepted, per the placement rule above).
- ~~Documentation is a deliverable per phase (labeled `type:docs`), part of the `v1.0.0` GA criteria.~~
  **Struck 2026-08-13 — `type:*`/`phase:*` were retired 2026-08-02** (`/dev-loop`, "eleven had never
  been applied to anything"); the live vocabulary is `product`/`content`/`ready`/`blocked`/
  `reader-facing`, and there is no `v1.0.0` GA milestone in the live loop. See `github-actions`'s own
  labels table for the same retirement, carried there with the "kept, not corrected" flag this line
  lacked.

### Licensing — the `LICENSE` file and the manifest field

**Folded in from the standalone `license` skill (#384), on the owner's ruling — *«deveria»*.** It was
one rule in 25 lines, the smallest file in the library, and it carried an always-on `description`
competing for the matcher's attention with fourteen others. It belongs here because a `LICENSE` file
is a **document at the repository root** and the manifest field is its declaration — the same object
Part I already governs, at the same grain as *where a document lives*. Nothing about the rule changed
in the move.

Every repo on the platform is **MIT-licensed** — permissive, ubiquitous, friction-free, which is the
point for code and skills meant to be reused.

- A **`LICENSE`** file at the repo root: MIT, `Copyright (c) <year> <owner>`. GitHub **auto-detects**
  it (shows the license and the "MIT" badge); the file — not just a manifest field — is what gives it
  legal effect.
- **Manifests declare it too:** `plugin.json` / `package.json` `"license": "MIT"`; OpenAPI
  `info.license` where applicable. Keep them in sync with the `LICENSE` file.
- Keep the **copyright year** current (use a range, e.g. `2026–2027`, once it spans years).

**Why MIT, and the trade-off.** Permissive and universally understood, with no copyleft obligations —
which maximizes adoption and reuse, and the skills library exists to be reused. The trade: **no
explicit patent grant** (Apache-2.0 has one) and no copyleft, so derivatives may be closed. Accepted
for simplicity; if a patent grant ever matters, Apache-2.0 is the drop-in swap.

### Pros & cons (of the general standard)

**Pros**
- Diffable, versioned docs; diagrams as code (Mermaid); no binary images to drift.
- One permissive license across every repo — zero legal friction for reuse or contribution, and
  GitHub auto-detects the `LICENSE` file.

**Cons**
- Mermaid has expressiveness limits.
- Keeping docs current is a discipline, not enforced.
- MIT carries no patent grant and no copyleft — a deliberate trade for simplicity.

## Part II — Architecture Decision Records (the governed artifact)

### What an ADR is

A short, immutable record of one **architecturally-significant decision**: the context that forced it,
the options weighed, the choice, and its consequences. ADRs are the **durable shared brain** of the
platform — a fresh, per-task agent context cannot remember prior decisions, so it reads them here.
Without ADRs, isolated contexts re-decide and drift; with them, every context stays coherent with what
was already pacted. This is why the ADR library is the substrate the rest of the dev-loop stands on (see
`README.md`, the current single source of truth for the dev-loop design — the former
`docs/proposals/agentic-dev-loop.md` is now a superseded historical record, per ADR-0002).

### When to write one — the significance test (the light gate)

Write (or amend) an ADR when a change crosses a **significant boundary** — objectively, any of:
- touches infrastructure (`iac/`),
- changes a public contract / schema,
- alters a previously-recorded (fixed) decision,
- introduces a new dependency or tool-class,
- establishes a cross-cutting pattern others will follow.

Otherwise, no ADR — a routine in-pattern change declares "no ADR" and moves on. Authorship is split by
domain (#223): `tech-lead` flags the need at intake and writes the record for product/system-architecture
decisions; `agents-lead` does the same for pure loop/harness/machinery decisions. `quality-assurance`
verifies on the MR that a significance-crossing change references one, regardless of which of the two
authored it. (`adr-author` named here until 2026-08-03 was absorbed into `tech-lead`; the further split
from `tech-lead`-exclusive to domain-based landed 2026-08-13 — whoever holds the decision writes it, in
the same MR as the change, and "whoever" now names two personas by domain rather than one persona by
default.)

**Decision & trade-off:** a *light* gate (significance-triggered), not a *strong* one (ADR for every
change). Trade-off: a light gate can miss a decision that only looks routine — and the test is applied at
two moments, which the sentence here denied until 2026-08-03. **The domain-holding lead applies it at
intake, before the build, and writes the record** (`agents/tech-lead.md` and `agents/agents-lead.md`
each state this for their own domain); **`quality-assurance` verifies on the MR** that a
significance-crossing change references one, whoever authored it. That is what the persona contracts say
today, and it is checkable there. A strong gate would never miss one but taxes every trivial change and
trains people to write empty ADRs; the light gate keeps ADRs meaningful.

### Format — MADR

Every ADR uses **MADR** (Markdown Any Decision Record). Copy `docs/adr/template.md`. Sections: title,
status, context & problem, decision drivers, considered options, decision outcome, consequences (good and
bad), links. This is Part I's Markdown + Mermaid rule specialized for one document type — the MADR
sections are the shape *within* a Markdown file, not an exception to the format.

**Decision & trade-off:** MADR over Nygard's leaner 4-section form. Trade-off: MADR is heavier per ADR.
Chosen because recording the **considered options and their trade-offs** is the point for a
proof-of-engineering product — the rejected paths are half the argument. Nygard's form drops them.

### Two libraries — methodology vs product

| Library | Lives in | Records |
|---|---|---|
| **Methodology** | `tadeumendonca-skills/docs/adr/` | decisions about the *machine* — the dev-loop, the roster, the gates, this practice itself |
| **Product** | `docs/adr/` in the repo that installs the plugin — one library per product, at its root | decisions about the *product* — its architecture, stack, infra, UX |

This skill (the template + practice) is single and lives in the plugin; both libraries consume it.

**Decision & trade-off:** two libraries, not one. Trade-off: a reader consults two places, and a decision
that is half-methodology half-product needs a judgment call on where it lands (rule of thumb: does it
constrain *this product* or *any project using the plugin?*). Chosen because the plugin is reused across
projects — folding product decisions into it would leak one project's choices into every consumer.

### Numbering & status

- **Numbering:** zero-padded sequential **per library** (`0001`, `0002`, …). Filename `NNNN-kebab-title.md`.
- **Status lifecycle:** `proposed → accepted → superseded` (or `rejected`). A design starts `proposed`; the human's ratification makes it `accepted`.
- **Disposition of a record that is leaving:** see the next section — one of **four**. For a *reversed* decision the record's `status` field is the criterion (dispositions 1–3); a decision that is still **in force** and merely relocating is disposition 4, absorption, where `status` says nothing because the record is still `accepted` right up to the deletion.

### A record earns its place by explaining the CURRENT codebase

**The rule.** An ADR is kept because it explains the codebase that exists now. A whole-file record whose
entire subject is a component that was switched off does not — and it does not merely fail to help, it
actively harms, because a later reader (human, and above all an agent loading a decision library) infers
architecture from it. **A record leaves this library only as one of four dispositions, never as an
absence.** For a *reversed* decision the choice among the first three is made on the record's **`status`
field — never its filename**:

1. **Delete the record; keep a History row.** *(Default, for a record whose whole subject is a component
   that no longer exists.)* `git rm` the file and leave one row in the library's `README.md` History
   table: the id, one line naming what was decided, and what replaced it. **That row is the marker.** It
   costs one line, carries no architecture a reader could rebuild from, and answers *"was this ever
   decided?"* without answering *"how was it built?"* — which is the whole of the distinction this rule
   turns on. **A deletion with no row is not this rule; it is a gap.** A silent absence and a deliberate
   absence must not look identical.
2. **Fold the context into the record that replaced it — before the deletion, not after.** *(Mandatory
   whenever the current decision is only intelligible against what it replaced.)* The superseding record
   carries a `## What this replaced` section: what was in place, why it was reversed, and the one
   consequence that still shapes the current design. A sentence in a live record explaining what it
   replaced **explains today's codebase**; a whole file for the retired one does not. **If there is
   nowhere to fold and no row is written, do not delete** — that deletion is a net loss of information
   with no compensating artifact, and it is the version of this change that would deserve the name
   *"we deleted our history."* **Where disposition 2 has no target, disposition 1 is what covers it** —
   a reversal whose replacement is a *pivot* rather than a numbered record has nothing to fold into, and
   the History row is then the only artifact, which is why it is mandatory and not a nicety.
3. **Keep the file** where the record is not about a retired component at all: a **`proposed`** record
   (it explains an *intended* codebase, and its status already says so), and an **`accepted`** record
   whose mechanism has no instances yet (a current convention, merely unexercised). Scope dispositions
   1 and 2 to **reversed** decisions, never to *unbuilt* or *unexercised* ones.
4. **Absorb the record into the document that governs what it decided; keep a History row naming the
   destination.** *(For a record whose decision is **still in force** and is merely moving.)* This is
   the disposition dispositions 1–3 do not cover, and the gap was real: they are keyed on a **reversal**,
   so a live decision being relocated into a capability document matched none of them — `## What this
   replaced` is the wrong heading for a decision nothing replaced, and a row reading "superseded by" is
   simply false. See *"Absorption is a different act from reversal"* below for the preconditions, which
   are **stricter** than disposition 1's, not looser.

### Absorption is a different act from reversal

**The reader's question is different, and that is what sets the preconditions.** A reversed record
leaves a reader asking *"was this ever decided?"* — a question a one-line row answers completely, and
the trail may end there. An absorbed record leaves a reader asking *"where is this decision now?"* —
and that reader is still **bound** by it. A row that ends the trail is a correct disposition for a
reversal and a **broken** one for an absorption.

So both of disposition 1's compensations are tightened:

- **The History row is mandatory and so is its destination.** Row form: the **bare four-digit number**,
  one line naming what was decided, and a **relative markdown link to where the decision lives now**.
  A row with no destination is not this disposition. **All three columns are non-empty, and the third
  column BEGINS with the destination link** — before any *"— section …"* pointer and before the
  *"Absorbed under …"* authority citation. That ordering is not style: it is what lets a gate tell the
  destination from the authority when both are relative links in the same cell. Measured on 2026-08-20,
  before it was required: strip the destination from a row and leave the authority citation, and a
  check that merely asks whether the column *contains* a relative link stays green.
- **There is no "nowhere to fold" case, so the fold is unconditional.** Under disposition 2 the fold is
  mandatory only *wherever there is a fold target*, and disposition 1's row covers a reversal whose
  replacement is a pivot rather than a record. Absorption has a target **by construction** — the
  destination is the whole reason the record is moving. **No destination, no deletion.**
- **What must arrive at the destination, and what may be dropped.** Arriving: the decision as it
  currently binds, the **rejected options that are still live** (the paths a future reader must not
  relitigate — half the argument, which is why this practice chose MADR over Nygard's leaner form), and
  the consequences still being paid. Droppable, deliberately: superseded narrative, round-by-round
  defect archaeology, and struck amendments that no longer bind anything. **The fold is lossy by
  instruction.** Left unsaid, "absorb" reads as "append", and a capability document assembled by
  concatenation is one no fresh context can afford to read — which defeats the reason the absorption
  was worth doing.

**Where the record "is not an ADR at all", the destination is the code, not another record.** The
reasoning moves next to the thing it governs — a test, a config, the function it constrains — and the
History row links there. The link is a path like any other, so the same row form and the same check
apply; nothing special is needed for this bucket.

**Why the row is written `0008` and never with an `ADR-` prefix.** The prose arm of the citation gate
asserts that every `ADR-nnnn` token in a tracked file names a **live** record, and it does not except
this table. Measured, by running the gate's own two regexes over both row forms: the bare
`| 0008 | … |` matches **neither**; the same row written with the prefix matches the **prose** arm. The
bare form is what lets the row name a dead record without the row itself reading as a live citation to
the next agent that loads the library.

**A consequence worth knowing before you write about this rule.** The gate cannot tell a *citation* from
a *discussion of the citation form* — it greps the token, not the sentence around it. So a document
teaching this rule cannot illustrate it with a concrete prefixed number: the moment the record in the
example is absorbed, the teaching text goes red and the "fix" is to edit an example that was never
wrong. Write the rule with the `nnnn` placeholder and keep concrete numbers to the **bare** form, which
nothing scans. This paragraph is the reason the one above reads the way it does.

**What the gate holds, and what it cannot.** `hooks/scripts/inventory-counts.test.sh` asserts that every
number this library has issued is either a live record or a History row that names a destination — in
both directions, and against a **declared ceiling** rather than the highest surviving file, because a
deletion at the top of the sequence leaves no gap to find. That makes the absorption **visible and
attributable**. It does **not** read the destination's content: a row pointing at a document that never
received the decision passes exactly like one pointing at a document that did. **Whether the fold was
lossless is a reviewer's judgement and there is no instrument for it** — do not let the green stand in
for that read.

**This rule is about whole records, not about sentences inside a live one.** Within an `accepted` record
the convention is unchanged and **load-bearing**: **amend by appending, strike in place (`~~…~~`), never
rewrite.** Struck history inside a live record is how a reader — and at least one gate in this repo —
tells a superseded claim from a stale one: `hooks/scripts/inventory-counts.test.sh`'s roster-membership
assertion distinguishes the two by exactly those markers (its `roster_narr_re` pattern matches `~~`,
`STRUCK`, `former`, `supersed` and the other past-tense forms), and its own comment states the reason.
Stripping struck history out of a live record does not turn that check red — it makes it **quieter**,
having less to read, which is worse. Nothing here licenses that.

**Before deleting, discharge every inbound reference in the same MR.** A published page, a generated
artifact or a test may resolve the file. The deletion is not done until they do not.

**What this rule replaced.** It was **supersede-never-delete**: a reversed decision kept its file, took
`status: superseded`, and linked forward — *"reverted decisions are history, not gaps."* **Both rules
share a premise** — a retired record misleads a future reader who infers architecture from it — **and
split only on the remedy.** That shared premise is **attested, not read back into the old rule after the
fact** — the old rule's own text argued from preservation value and never stated it, so the evidence is
worth pointing at: it is written in the owner's published voice on the platform's own architecture page,
in its `status` / `superseded-by` bullet, which says in as many words that the record of a retired
architecture *reads as an instruction* and is the cheapest way to make an agent rebuild something that
was cut on purpose. [ADR-0020](../../docs/adr/0020-an-adr-earns-its-place-by-explaining-the-current-codebase.md)
quotes that clause verbatim. The old rule says *mark it*; this one says the marker is not enough,
because the file is still there to be inferred from, and an agent loading a decision library reads
**bodies**, not status lines. *Accepted cost:* the reasoning of a reversal is no longer preserved at length. Disposition 2 is
what keeps the part of it that was load-bearing; disposition 1's row is what keeps the absence
deliberate. **The decision and its rejected options are recorded in
[ADR-0020](../../docs/adr/0020-an-adr-earns-its-place-by-explaining-the-current-codebase.md)** — this
section is the operative wording, that record is the argument, including the correction that the
significance arm which fires is *sets a cross-cutting pattern* and not *alters a previously-recorded
decision* (supersede-never-delete was never itself recorded as an ADR).

~~**Nothing enforces the deletion rule** — unlike the strike convention above, which at least one
assertion reads in part. Measured on this repo, on a full scratch copy of the tree including `.git`:
`rm docs/adr/0002-roster-and-dev-loop.md` — the library's largest record, cited by name from
several others — then `bash hooks/scripts/inventory-counts.test.sh` → **`69 passed, 0 failed`**,
identical to the control run on the unmutated copy. No hook, workflow or settings file asserts anything
about the ADR library's shape, so the largest record in it can vanish with every gate green. This rule
is a **discipline, not an enforcement** — including the History row and the fold, which are prose too
and inherit the same zero enforcement.~~

**Struck (#283).** It was true when written and is not true now, and the enforcement arrived in two
slices for a reason worth keeping: the deletion rule went unenforced only while **the deletion set was
empty**, and #283 takes it from zero to roughly fourteen in one reconciliation. The same mutation, run
at head, on the tree in place:

```
mv docs/adr/0002-roster-and-dev-loop.md <elsewhere>
bash hooks/scripts/inventory-counts.test.sh        →  65 passed, 5 failed
```

**The passing total is re-measured at each folding slice's head, never carried.** It read `60` until
2026-08-20; the five reds have not moved, and the five extra greens are arms the same reconciliation
added — 4c at slice S3 (*no record links to itself*) and 4d at S5 (*no index row cites its own record*),
plus the suite growing around them. A figure of this shape ages every time the suite does, which is why
the composition below is what the claim rests on and the tally is not.

Four of those five are the **citation** gate (#283 slice 1): the relative link and the repo-root path
stop resolving, the prose `ADR-nnnn` form stops resolving, and the **foreign-number exemption goes
stale** — `0002` was the only file citing one of the two declared foreign numbers, so removing it
leaves an exemption with nothing left to exempt. The fifth is the **record-numbering** gate (#283
slice 2), which is the one that does not depend on anybody citing the record: it keys on the number, so
it catches the deletion of a record nothing cites at all — the case the citation gate is blind to by
construction, and the case an absorbed record is most likely to be.

**This paragraph read `57 passed, 4 failed` and named a set of arms that included one which never ran,
until #283 slice 2's review, and the correction is worth more than the number.** The count was real;
the composition was not. The prose-citation arm reported **neither `PASS` nor `FAIL`** on that run — it sat below the
stale-exemption arm in the same `if/elif` chain, so a red above it meant its verdict was never reached.
An assertion did not fail, it **disappeared**, and because the totals stayed plausible no count could
have surfaced it. Every arm in that block and in the numbering block now emits its own verdict, which
is why the same mutation reports one more failure than it did.

**And the same defect was found three more times, in the round that fixed the first two, which is why
the passing total moved again — `57 → 58 → 60`.** The sweep that cleared the rest of the file re-read its
own reasoning instead of mutating it, and re-reading is not evidence: the flag-class chain, the
skill-descriptions chain and the roster block's shallow-clone guard were all suppressing computable
verdicts, and all three were found by planting a defect and watching for the line that never came.
**The two moves have different causes, and only two of the three fixes are in the second one.**
`57 → 58` is the earlier round splitting the prose-citation arm and the numbering pair apart;
`58 → 60` is the flag-class and skill-descriptions splits, one verdict each. The roster fix added
**none** — measured on a clean tree, that block emits four verdicts before it and four after — and that
makes it the sharper case rather than the weaker one: the verdict it recovered disappears only on a
shallow clone, so no total could ever have moved to announce it. **The number to carry away is not 60.
It is that a sweep's conclusion is worth exactly as much as the mutations behind it**, and that the arms
it clears must be re-cleared the same way each time the file grows.

**What is still discipline and not enforcement, stated exactly.** The row's **existence** and its
**destination** are gated; the row's **honesty** is not, and the **fold** is not. Nothing reads whether
the destination document actually received the decision. Those halves land in the same MR as the
deletion, where a reviewer can still see both — which is where they stay.

**Where a "this is not live" disclaimer belongs.** In the artifact's **body**, above the fold — not in a
skill's `description:` frontmatter, which is gated as a *trigger* (length, single line, `Use when`, no
stem opener) and has no budget for a disclaimer competing with it. `skills/backend/SKILL.md` already
carries its reference-only statement that way, and that is the right home.

### Cite the clause, not the line

**Reference another record's content — or your own — by quoting the clause verbatim, never by `:NN`.** A
line number depends on another file's whitespace; a quoted clause depends only on that clause continuing
to exist, and if it stops existing that is a **finding** rather than a silent misdirection. Where the
target is a *region* rather than a clause — a table, a section, an amendment — **quote its heading
verbatim** (`the "Considered options" section`, `the 2026-08-15 amendment`). A heading is a string, so it
keeps both properties the clause rule buys, and it closes the one case where the convention would
otherwise revert to line numbers exactly where they are hardest to check. **What it does not close:
quoting the wrong heading.** A heading pins a region only if it is the region the cited content sits in
— not the nearest heading that *describes* it. Check that the thing you are citing is under the heading
you quoted, or the citation is verbatim, checkable, and pointing somewhere else.

*The measurement that produced this rule, because it is the argument.* On the first authorship in either
library to use line locators, **five of nine were wrong** — four cited `:26` for a clause at `:25`, and
one named a range that ended a line early *and* pointed at a definition while the surrounding sentence
described the attachment. **A gate caught four and graded the fifth advisory**, so one imprecise locator
would still have shipped through a reviewed path. That is not a case for more care; it is the case that
**the locator form is the defect**. And nothing anywhere resolves a `:NN` — no test in either repo
asserts a line locator — so a single inserted line silently re-breaks every citation with all gates
green.

*What it costs:* quoting is longer than `:25`, in records that are already long. Accepted.

**A count, an enumeration and a "complete list" are each a claim about a SET — and verifying the members
does not verify the set.** *"Three live records cite this"* is checked by re-reading the three that were
named, which leaves the **three** itself untested: the set can hold five, and the two nobody counted are
exactly the ones a later executor mishandles, because a list published as complete is read as complete.
The same holds for a cost list, a sweep, or *"these are all the places"*. So **state the criterion that
selects the members and publish the command that returns them** — `git grep -n -E "…" -- docs/adr/`, and
the regex is part of the claim — or do not publish the count. A number verified against its examples and
not against its criterion is an anecdote about the members, shaped like a fact about the set.

### Authoring checklist

- [ ] One decision per ADR. If you're recording two, write two.
- [ ] The **considered options** section is real — at least the chosen path and the strongest rejected alternative, each with its trade-off.
- [ ] Consequences list the **bad** ones too, not only the wins. An ADR with no downsides is not honest.
- [ ] Links back to the driving Issue/spec and to any ADR it supersedes or depends on.
- [ ] Committed **in the same MR** as the change it justifies (no decision drift — the docs move with the code).
- [ ] Every citation of another record quotes the **clause or heading**, never a line number.
- [ ] If the MR **deletes** a reversed record: the History row is written and the `## What this replaced` fold has landed in the superseding record, in this same MR — both are preconditions, not follow-ups.
- [ ] If the MR **absorbs** a record whose decision is still in force: the destination carries the decision, its still-live rejected options and its remaining consequences; the History row is written with the **bare** number and a relative link to that destination; every inbound citation moved in this same MR. No destination, no deletion.

### Pros & cons (of the ADR practice)

**Pros**
- Durable decision memory that a fresh per-task context can load → the anti-drift substrate.
- The rejected options are recorded → future changes see *why* a path was not taken and don't relitigate it.
- Light gate keeps the practice cheap; ADRs stay meaningful, not ceremonial.

**Cons**
- Discipline cost: an ADR per significant decision is work, and the significance test needs judgment.
- Two libraries add a lookup and an occasional "where does this belong?" call.
- MADR is verbose; a trivial-but-significant decision can feel over-documented.
