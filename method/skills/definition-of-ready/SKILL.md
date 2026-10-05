---
name: "definition-of-ready"
description: "Set the bar a work item must clear before a builder can pick it up, generically and for THIS loop — what `ready` asserts and which of its criteria anything actually checks. Use when writing acceptance criteria, running intake, sizing a backlog, or diagnosing why in-progress work stalls on undecided scope. Not for what \"done\" means at delivery (see definition-of-done), or the state machine of who acts at each transition (see agents-configuration)."
purpose: "set the bar a work item clears before a builder picks it up, so the gate at the other end has something external to itself to measure against"
---

> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).** This
> text moved from the `tadeumendonca-skills` plugin. Where it names a plugin hook, guard rule or test
> (`hooks/…`, `permission-guard.sh` and its numbered rules, `mcp-guard.sh`, `inventory-counts.test.sh`
> and the like), it describes that plugin; **none of those runs in this method**. Read any rule they
> held as an **instruction you follow**. What is still mechanical, where the workstation installed it:
> the **deny floor** (native deny rules by command prefix — force-push, `git reset --hard`, recursive `rm`, `git clean -f`,
> squash merge, secret writes, `gh api` write methods, `gh repo delete`/`archive`/`rename`, releases and
> package publishing, `terraform apply`/`destroy`, `sudo`), and **each agent's own tool list**, which is
> native in Claude Code and Kiro and an instruction in Codex. The session checks that replaced the
> plugin's reporting hooks are in `agents-configuration`, *Session-start and end-of-turn checks*.

# Definition of Ready — the bar a work item clears before it is buildable

Apply this concept in any `<project>` — it defines what makes an item **ready to build**,
independent of which loop, tracker or team runs it, **and since #380 it also carries this loop's own
concrete bar**, so the name and the ruler are in one place. `/definition-of-done` is the other end of
the same lifecycle: **ready** is the entry gate to building, **done** is the exit gate out of it.
~~`/quality-gates`~~ — **struck #380: the DoD moved to `/definition-of-done`; `/quality-gates` is the
CI/CD half.** Neither substitutes for the other, and a loop that only
enforces one of them fails at the end it left open — a strong Definition of Done cannot repair a story
that was ambiguous when the builder started, and a strong Definition of Ready does not verify what was
actually shipped.

Context: $ARGUMENTS

## Why "ready" is a concept a loop needs, not a courtesy

**A builder should not have to make a product or architecture call mid-build.** That is the whole reason
this bar exists. When a work item is picked up before it is ready, the person building it is forced to
either stop and ask — which is the exact interruption a well-shaped backlog exists to avoid — or guess,
which quietly moves a product/architecture decision into whoever happens to be typing that day. Neither
is acceptable, and both are avoidable at a cost that is always cheaper paid *before* the build starts:
a wrong assumption caught at intake costs a sentence; the same assumption caught mid-build costs a
half-built branch, and caught at review it costs a review round on top of that.

**"Ready" is therefore a property of the description, not of the backlog's mood.** An item is ready when
someone who did **not** write it, and is not going to build it, can read it and know: what to build, what
"acceptable" looks like from the outside, and where the item's boundary sits against its neighbors. If
any of those three requires a conversation to resolve, the item is not ready yet, however long it has sat
in the queue.

## The checklist shape — conditional on what the project actually has

There is no universal Definition-of-Ready checklist, because "ready" is defined against what a builder
would otherwise have to invent — and what a builder would have to invent depends entirely on what the
project's surfaces are. **A checklist item that names a surface the project does not have is not a higher
bar; it is an unsatisfiable one**, and an unsatisfiable gate teaches the team to rubber-stamp it or to
skip it quietly — the same failure mode this whole platform's engineering floor names for a Definition of
Done (`/definition-of-done`) is exactly this on the other end of the lifecycle.

So the right move is not "adopt the universal checklist" — it is "read the project, then name the items
that actually remove ambiguity for it." Three worked examples, same discipline, different shape:

- **A UI-heavy product** (a consumer-facing app, a product with a design system). Ready needs: a user
  story, a navigable screen prototype/mockup so "what does this look like" is not answered mid-build,
  documentation of any external API the work integrates with, acceptance criteria, and an estimate. This
  is the dense case — it has the most surfaces that can be silently assumed, so it has the longest list.
- **A backend service with no UI.** Drop the prototype — there is no screen to mock. Keep the story,
  the external-API documentation (a service still integrates with something), acceptance criteria stated
  as request/response or event-contract shape, and an estimate. The absence of a prototype item here is
  not a lowered bar; a prototype for a surface that renders nothing removes no ambiguity, so requiring
  one would be decoration.
- **A CLI / library / plugin — this repo is exactly this case.** Drop the prototype (no screen) **and**
  drop the external-API-integration item (a skill library like this one has no runtime dependency it
  calls over a network at build time — it is *consumed* by other repos, but consumes nothing itself).
  What is left: a clear statement of the convention or mechanism being added, acceptance criteria stated
  as an observable artifact or a passing check, and — where sizing matters — an estimate. This is not a
  special case invented for this repo; it is the same discipline applied to a project shape with fewer
  ambiguous surfaces to pin down.

**The pattern behind all three:** ready-ness items exist to remove ambiguity from a specific surface, and
a surface the project does not have cannot carry ambiguity. Checking "does this project have that
surface at all" is the first step of building any checklist, before asking whether any given item is
satisfied.

## How to recognize an item that looks ready but isn't

The common failure is not a missing acceptance criterion — those are easy to spot, because their absence
is visible in the text. **The common failure is undefined scope at the edges.** The center of a story is
almost always clear: everyone agrees roughly what it is about. What is missing is where it **starts and
stops** — the boundary against the item next to it, not the item's own substance.

**The flagship failure pattern: overlapping behavior fragmented across separate issues.** Two issues are
filed, each individually readable, each individually plausible as "ready" by every item on the checklist
above. What neither one states is that a piece of behavior sits in the seam between them — implicitly
half-claimed by both, or by neither. Nobody notices at intake, because intake reads each issue on its own
terms and the checklist has nothing that asks "does this boundary overlap a neighbor's." The overlap
surfaces **mid-build**, when the second issue's implementer discovers the first one already built (or
half-built, or assumed) the shared piece — which is exactly the class of interruption a Definition of
Ready exists to prevent, arriving anyway because the checklist checked completeness within an issue and
never checked the seam between issues.

**The check this implies, and it is not on the standard checklist:** before marking two related issues
ready, read them against each other, not only against themselves. Ask "if both of these are built exactly
as written, is there a piece of behavior that belongs to both, or to neither?" A single well-formed issue
can pass every item above and still be the wrong slice, because slicing is a decision about the seams
between issues and no single-issue checklist can see a seam.

## Ready and estimation — related, not the same question

Estimation (story points, or any relative-sizing method) commonly sits **inside** a Definition-of-Ready
checklist, and it is worth separating why it belongs there from what it actually measures. An item can
only be sized honestly once it is unambiguous enough to compare against a reference item — sizing an item
whose scope is still fuzzy at the edges produces a number that measures the fuzziness, not the work. So
**estimation is not itself a readiness check; it is a symptom check that piggybacks on one.** A team that
cannot agree on an item's size in five minutes has usually found an ambiguity the rest of the checklist
missed, which is why "can we size this" is a fast, cheap probe for "is this actually ready" even when the
number produced is never used for anything else.

*How estimation itself is done — the mechanics of relative sizing, consensus and the group technique most
teams reach for* — is a separate concern from what this skill defines, and belongs in its own skill:
**`/planning-poker`** (#266). This skill states only the relationship: sizing is a
readiness signal as much as it is a planning input, and a checklist that drops it loses a cheap probe for
exactly the failure mode named above.

## THIS loop's concrete readiness bar — what `ready` asserts, and what checks it

**Added at #380, and the reason is the exact symmetry the owner named:** *«assim como temos o
definition-of-ready tbm»*. The Definition of Done had its concept in one skill and its real ruler in
another; so did this. Fixing only one end would have taught a reader that one of the two names means
what it says and the other does not — worse than both being wrong the same way.

**What is here and what is deliberately NOT here.** This section is the **bar** — what a description
must contain before `ready` is honest. The **state machine** — who acts at each transition and what
artifact records it — stays in `/agents-configuration`, where #329 put the canonical `filed →
description closed` rows on a mechanical argument that has not changed: that file is the universal
preload every persona carries at the moment it acts, and a rule about *who may act* has to be where
whoever dispatches will read it. *When* an item moves is that file's; *what makes it eligible to* is
this one's.

### What the `ready` label asserts

**`ready` means: the description is closed on that item's lane, so a builder will not have to make a
product or architecture call mid-build.** It is the entry gate, and an item without it is not
executable — a mechanism, not something a persona must remember.

Applied to this repo, the CLI/library shape from the three worked examples above is the one that
governs, so the bar is short and complete rather than long and partly unsatisfiable:

- **a clear statement of the convention or mechanism being added** — not "improve X";
- **acceptance criteria stated as an observable artifact or a passing check** — the same
  *evidence-producing* property `/definition-of-done` requires at the other end;
- **the seam read against neighbouring Issues**, per *How to recognize an item that looks ready but
  isn't* above. This is the one item on the list that no single-issue review can perform;
- **an `sp:N` estimate**, which is a readiness *signal* as much as a planning input — see *Ready and
  estimation* above for why it belongs here and what it actually measures;
- **an `invocable:` declaration** — what this Issue promises a reader will be able to type or open, or
  `none`. It is a parsing contract, read literally, and `none` is a real answer and the common one.

### The seam — which of these is checked by something, and which is discipline

**The same sentence `/definition-of-done` owes at the exit gate, owed here at the entry gate.** State it
by member rather than by count, for the reason that file gives:

**Three buckets, not two, and the third exists because two collapsed a distinction this repo pays for.**
An earlier form of this list had *checked by a mechanism* and *checked by nobody* only, and put `sp:N`
in the first — which is false, and false in the **permissive** direction, on the one table whose entire
job is separating an instrument from a memory.

- ~~**Checked by a hook:** the `invocable:` declaration.
  `hooks/scripts/closure-artifact-guard.sh` is registered in `hooks/hooks.json` and refuses a manual
  close on an unmet one. This is the only bullet here where something fires.~~
  **Struck 2026-09-04 (#383), and the bucket is now EMPTY — which is the finding, not a formatting
  change.** That hook's `PreToolUse` arm was removed; it is registered on `Stop` alone and **refuses
  nothing**. So **nothing at this entry gate fires**, and the honest reading of this list is that all
  three bullets are downstream of the first one's disappearance.
- **Reported AFTER the fact, which is a different thing and must not be read as the first bucket:**
  the `invocable:` declaration. The plugin's `Stop` hook that reported an Issue **already closed** with
  an unmet declaration is retired (#61); the report is now an end-of-turn step you run yourself
  (`agents-configuration`, check 8). A manual close on an unmet declaration executes silently. **A
  report is evidence for a human, never a bound.**
- **Checked by an instruction the session follows, not by a hook:** the presence of `sp:N`. The drain's
  preflight *"refuses to enter"* while an item in the active iteration lacks one — and that preflight
  is **prose in `commands/autonomy.md` executed by the session**, not `hooks/scripts/preflight.sh`.
  **The names collide, and `commands/sprint-planning.md` is where the collision is warned about**, in
  its own words: *"That preflight is the command's own self-check and is NOT
  `hooks/scripts/preflight.sh`. The names collide and nothing but this sentence separates them … the
  word* refuses *here describes a rule someone follows, not a hook that fires."* Its falsifier,
  re-run at head:

  ```
  grep -cE 'sp:|milestone|iteration' hooks/scripts/preflight.sh    # -> 0
  ```

- **Checked by nobody:** whether the description is genuinely closed, whether the acceptance criteria
  are observable, and whether the seam against neighbouring Issues was read at all. **Nothing observes
  a dispatch.** An Issue whose intake was skipped entirely is indistinguishable, from the tracker and
  from the diff, from one run correctly — the artifact of record is a closed description, and a
  description says nothing about who was asked.

**Why the middle bucket is not a softer version of the first.** By this loop's own test — *would
something stop me, or only my memory?* — the bucket that fires is **empty since #383**, and every
surviving bucket is memory or after-the-fact evidence. A reader who needs to know what protects them
should read them together. The split exists because their *failure modes* differ: the reporting bucket
fails by arriving too late to change anything, the instruction bucket fails when a session skips a
written step, and the last has no step to skip. **Do not promote anything into the firing bucket
without naming the registered hook AND the event it is registered on**, which is the error this list
has now made twice — once by putting `sp:N` there, and once by leaving `invocable:` there through a
removal that took only one of a hook's two registrations. **A hook can survive a slice and stop
refusing in it**, and the registration is the only thing that says which.

**So `ready` is attributable and auditable, and it is not proven.** That is the honest form, and it is
the same shape as the label's own entry rule: something must *query* it, which two things do. Nothing
verifies that the personas who were supposed to close the description actually did.

## Pros & cons

**Pros**
- Moves ambiguity resolution to where it is cheapest — before a branch exists — rather than to wherever
  the builder first trips on it.
- Makes "is this item buildable" a checkable property instead of a feeling, the same move the `ready`
  label makes mechanical in this repo's own loop (`/agents-configuration`).
- The checklist scales down honestly: a project with fewer surfaces gets a shorter, still-complete list,
  rather than a universal list with items nobody can satisfy.

**Cons**
- The checklist itself needs judgment to shape per project — get it wrong and it either blocks trivial
  work on decoration or waves through real ambiguity.
- It catches ambiguity *inside* an issue reliably; it does nothing by construction to catch ambiguity **at
  the seam between issues** unless the team deliberately reads related issues against each other — the
  flagship failure above is exactly this blind spot.
- A bar that is only ever checked at filing time goes stale the moment a related issue is filed after it;
  readiness is not a one-time property if the backlog around an item keeps changing.

## My take

*(Elicited directly from the owner — not scaffolded, not generalized.)*

**Default posture, the macro/common case:** a user story, a navigable screen prototype (when UI is
involved), documentation of the APIs the work integrates with, acceptance criteria, and story-point
estimation. In his words: *"estoria, prototipo de tela, documentacao das apis a serem integradas,
criterios de aceitacao, pontuacao das estorias — esse tipo de coisas. no cenario macro esses seriam os
criterios mais comuns."*

**On this very repo, that checklist shrinks — and it is not a lowered bar.** This library has no
navigable prototypes and no external API integration to document, so those two items are simply absent
by project shape: *"aqui no caso por exemplo, nao trabalhamos com prototipos navegaveis, tbm nao temos
integracao com apis externas."* That is the origin of the "conditional on what the project actually has"
framing above — it is not a general principle he stated abstractly, it is what fell out of asking him to
apply his own checklist to the repo he was standing in at the time.

**What is usually missing when an issue looks ready but isn't:** undefined scope at the edges — the
center of the story is clear, but where it starts and stops is not. That single sentence is the origin
of the whole "recognize an item that looks ready but isn't" section above.

**The concrete failure pattern he has seen:** overlapping behavior fragmented across separate issues —
the boundary between two issues isn't clean, so the same behavior is implicitly half-claimed by more than
one issue, and the overlap surfaces mid-build rather than at intake. That is the flagship failure named
above, verbatim to what he described rather than a generic pattern this skill invented and attributed to
him.
