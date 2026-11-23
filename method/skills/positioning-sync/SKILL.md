---
name: "positioning-sync"
description: "Propagate a change to the owner's positioning (headline, stack, target role) to every public surface the consuming project lists, in one batch: the gated, revertible changes (site profile data, READMEs) merge first, the browser writes (profiles, newsletter) follow; then the cross-surface coherence check reads every surface live. Use when the positioning changes, when a surface is found out of sync with it, or when asking which of these writes waits on the owner."
purpose: "give the positioning-sync procedure one written home that every agent harness loads, so a rule that lived only in a private, untracked note becomes the same steps on Claude Code, Codex and Kiro"
---

# Positioning sync — one change, every public surface, one batch

**This skill is the procedure. The data stays private.** The owner's positioning and the list of his
public surfaces live in a private, version-control-ignored directory of the consuming project
(`<private-dir>`). Before #567 the procedure lived there too, as a note, and a rule in an untracked
private note is not a harness mechanism: no agent loads it by default, on any agent harness. So the
procedure moved here and the data did not. **Nothing from `<private-dir>`
enters this skill, the Issue, a pull request, a commit or a comment**, quoted or paraphrased.

**The rule it carries, in one line: a positioning change propagates to every public surface in one
batch, or it does not propagate.** A surface updated alone is a contradiction a reader finds before the
owner does.

## What this skill does not restate

Each of these is owned elsewhere; read it there.

- **How the copy reads**: the `published-voice` skill. This skill moves copy between surfaces; it never
  judges a sentence.
- **Which surfaces a change leaves stale, and the confidentiality and precision checks**: the
  `product-lead` agent, *Cross-surface sync*, *Check 3 — confidentiality and third parties* and
  *Precision drift*. The coherence check below is that agent's list run after the batch, not a second
  ruler.
- **How a browser write in the owner's name is contained**: the `content-publishing` skill, step 10
  (*WHO*, *WHICH HARNESS*, *WHAT CONTAINS IT*). The same three facts hold for a profile write.
- **How to put the proposal to the owner**: the `orchestration` skill, *How to ask the owner*.
- **How a gated change merges**: the `merge-authority` skill and the consuming project's gate.

## Trigger

Run it when the positioning changes: the headline, the stack the owner leads with, or the target role.
Run it too when a review or an audit finds one surface out of sync with the others; the batch is then
the stale surfaces, and the coherence check still runs.

## The surface list is the consumer's, not this skill's

**The batch is every surface the consuming project's surfaces list in `<private-dir>` names**, read
at the start of each run. This skill names no fixed set. The rows below are a template: each surface
the list names becomes one row, classified as **gated** (a tracked file, changed through a pull
request and a gate, revertible) or **browser** (an external public surface written in the owner's
session). The surfaces named in the table are an example of a typical set, not a required one; a
consumer without one of them drops the row, and a consumer with another adds one.

## Before the batch: one Issue, one proposal, one ask

1. **One tracked Issue for the batch**, in the consuming project, before any write. It names the
   surfaces in scope as `<surface>` entries and carries no private text.
2. **Draft every surface's new text first**, where the owner can open it: in `<private-dir>`, because
   the drafts derive from private positioning, never in a public tracked file and never only in the
   session scratchpad. Read the positioning and the surfaces list first; never write positioning from
   memory.
3. **Put the whole batch to the owner as one activation** (confirm, change, or discard), under the
   `orchestration` skill's ask rules, linking the drafts. Every write below is public, so every write is
   ask-first; his answer lands on the Issue as his own words. **Nothing is typed or saved on any surface
   before his ok.** **His ok on the text is not merge authorisation**: each gated change still merges
   only under its own gate and the `merge-authority` skill.

## The batch — gated changes first, browser writes after

**No browser write starts until every gated change in the batch has merged.** A gated change can be
sent back or held; a browser write is live the moment it is saved. Merging first is what keeps a held
gated change from leaving the external surfaces on the new positioning and the site on the old one.

| step | kind | surface (example) | who acts | evidence |
| --- | --- | --- | --- | --- |
| 1 | gated | `<site>` typed profile data, then the build | the consuming project's builder, through a pull request and its gate | the merge, and the prerendered metadata in the served page |
| 2 | gated | the CV, where derived from step 1 | follows step 1; nothing re-typed | the rebuilt CV |
| 3 | gated | the README of each repository the portfolio lists | a pull request per repository, each under its gate | the merged READMEs |
| 4 | browser | `<professional-network>` profile: headline, about, top skills and their order | the main session, in the owner's logged-in browser, in an attended session | the live profile, re-read after saving |
| 5 | browser | `<forge>` profile bio; a separately maintained CV design, re-exported | the main session, in the browser | the live bio; the re-exported CV |
| 6 | browser | `<newsletter>`: its recurring theme | the main session, in the browser | the live newsletter settings |

1. **The site.** Change the typed profile data, in both locales where the site has two, then build.
   The prerendered social and search metadata follows from the data; check it in the served page, not
   in the source.
2. **The derived CV.** Where the CV is derived from the site's typed profile data, it follows step 1:
   nothing is re-typed, the build regenerates it.
3. **The portfolio READMEs.** A README is a tracked file, so it changes through a pull request, never a
   direct push.
4. **The professional-network profile.** Once steps 1 to 3 have merged, update the headline, the about
   text and the top skills, in the order the proposal set. **Profile writes go through the browser in
   the owner's logged-in session; a read-only connector cannot write a profile.** The one dispatched
   profile with a browser grant has its text-entry tools (`fill`, `fill_form`, `type_text`) removed,
   but that grant still allows clicks and key presses, so it is a narrower grant and not a bound on
   writing. Type and save only the text he approved, then re-read the live profile.
5. **The forge bio, and a separately maintained CV design.** Update the bio to the approved text. A CV
   design that is not derived from the site is updated to the approved text and re-exported.
6. **The newsletter.** Align its recurring theme with the new positioning.
**There is no record of what shipped (owner's ruling on #567).** The live surfaces are the source of
truth: nothing copies their text into a private file after the batch, and the coherence check below
reads them live. A surface that did not ship in this batch is named on the Issue as outstanding. The
drafts in `<private-dir>` are a working location for his read, not a record; they are not updated to
match what shipped.

## The coherence check, after the batch

Run it against the **live** surfaces, not against the drafts. `product-lead` runs it with its read-only
browser and returns the result; **it posts nothing. The main session relays that result verbatim onto
the Issue**, the same way it relays the copy verdict (`orchestration`, *Before the gate*, step 3), as
pass or fail per line and without quoting private text.

- **Headline coherent across surfaces**: every surface leads with the same positioning, in its own
  length.
- **Years of experience consistent**: one figure everywhere, taken from the site's typed profile data.
- **Contact address consistent**: the same address on every surface that shows one.
- **The portfolio points at existing, non-empty repositories**: each listed repository resolves and has
  content. On GitHub: `gh repo view <owner>/<repo> --json isEmpty,isArchived`.
- **No client name on any surface**: a client is described by its sector or industry, per the
  consuming project's own rule. A breach is a blocking finding.

A failed line is a finding for the same batch: fix it, re-run the check, then close the Issue.

## Choices and their trade-offs

- **One batch, not surface by surface.** Readers never see two positionings at once. The cost: the
  batch waits on its slowest surface, and because the browser writes wait for every gated merge, a
  held site merge holds the whole batch.
- **Gated changes first, browser writes after.** A gated change can still be sent back without any
  external surface having moved. The cost: the external surfaces lag the site by the time the browser
  writes take, so for that window the site is ahead of them.
- **One activation for the whole proposal, not one per surface.** The owner reads the positioning once,
  as a whole. The cost: one change to one surface's text sends the activation back, and a long batch is
  a long read.
- **The site's typed data is the canonical value.** The CV derives from it and the coherence check
  compares against it, so a figure is typed once. The cost: a surface the site does not carry (the
  newsletter, a separate CV design) has no derived copy, and only the coherence check catches its drift.
- **Profile writes in the browser, by the main session, attended.** It is the only route that can write
  a profile without holding a credential for unattended public writes. The cost: nothing contains the
  act but the owner's presence (`content-publishing`, step 10).
- **No record of what shipped; the live surfaces are the truth.** Nothing can go stale against them, and
  there is one less private write. The cost: every coherence check reads every surface live, and
  there is no history of what a surface said before the batch.

## What nothing enforces

**All of this is an instruction.** No hook, permission rule or check observes a positioning change, a
batch, its order, the owner's ok or a browser write. A test in the repository that renders
this method asserts that this skill carries its key clauses and names no consumer; it asserts the
procedure is written, never that a session followed it. Whether every surface the consuming project has
is in the batch depends on its surfaces list, which only an agent that reads `<private-dir>` can see.
