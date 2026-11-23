---
name: "positioning-sync"
description: "Propagate a change to the owner's positioning (headline, stack, target role) to every public surface in one batch: the professional-network profile, the CV, the site's typed profile data, the code forge bio and portfolio READMEs, the newsletter theme; then update the private canonical-copy record to what shipped and run the cross-surface coherence check. Use when the positioning changes, when a surface is found out of sync with it, or when asking which of these writes waits on the owner."
purpose: "give the positioning-sync procedure one written home that every agent harness loads, so a rule that lived only in a private, untracked note becomes the same steps on Claude Code, Codex and Kiro"
---

# Positioning sync — one change, every public surface, one batch

**This skill is the procedure. The data stays private.** The owner's positioning, each surface's
canonical copy and the record of what each surface says live in a private, version-control-ignored
directory of the consuming project (`<private-dir>`). Before #567 the procedure lived there too, as a
note, and a rule in an untracked private note is not a harness mechanism: no agent loads it by default,
on any agent harness. So the procedure moved here and the data did not. **Nothing from `<private-dir>`
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
- **How the site change merges**: the `merge-authority` skill and the consuming project's gate.

## Trigger

Run it when the positioning changes: the headline, the stack the owner leads with, or the target role.
Run it too when a review or an audit finds one surface out of sync with the record; the batch is then
the stale surfaces, and steps 6 and the coherence check still run.

## Before the batch: one Issue, one proposal, one ask

1. **One tracked Issue for the batch**, in the consuming project, before any write. It names the
   surfaces in scope as `<surface>` entries and carries no private text.
2. **Draft every surface's new text first.** Read the positioning and surfaces files in `<private-dir>`
   (never write positioning from memory), then draft each surface's text in the session scratchpad.
3. **Put the whole batch to the owner as one activation** (confirm, change, or discard), under the
   `orchestration` skill's ask rules. Every write below is public, so every write is ask-first; his
   answer lands on the Issue as his own words. **Nothing is typed or saved on any surface before his
   ok.**

## The batch

| step | surface | who acts | what records it |
| --- | --- | --- | --- |
| 1 | `<professional-network>` profile: headline, about, top skills and their order | the main session, in the owner's logged-in browser, in an attended session | the live profile, re-read after saving |
| 2 | the CV | follows step 3 where derived; else the session that owns the design | the rebuilt or re-exported CV |
| 3 | the site's typed profile data, then the build | the consuming project's builder, through a pull request and its gate | the merge, and the prerendered metadata in the served page |
| 4 | `<forge>` profile bio and the READMEs of the listed portfolio repositories | bio: the main session in the browser; READMEs: a pull request per repository | the live bio; the merged READMEs |
| 5 | `<newsletter>`: its recurring theme | the main session in the browser | the live newsletter settings |
| 6 | the canonical-copy record in `<private-dir>` | the context that read the private layer (`product-lead`, or the main session) | the record, matching the live surfaces |

1. **Professional-network profile.** Update the headline, the about text and the top skills, in the
   order the proposal set. **Profile writes go through the browser in the owner's logged-in session; a
   read-only connector cannot write a profile**, and no dispatched agent holds a browser tool that types.
   Type and save only the text he approved, then re-read the live profile.
2. **CV.** Where the CV is derived from the site's typed profile data, it follows step 3: nothing is
   re-typed, the build regenerates it. A separately maintained CV design is updated to the approved
   text and re-exported.
3. **The site.** Change the typed profile data, in both locales where the site has two, then build.
   The prerendered social and search metadata follows from the data; check it in the served page, not
   in the source.
4. **Code forge.** Update the profile bio, then the README of each repository the portfolio lists.
   A README is a tracked file, so it changes through a pull request, never a direct push.
5. **Newsletter.** Align its recurring theme with the new positioning.
6. **The canonical-copy record.** Update the record in `<private-dir>` **to what actually shipped,
   never to what was intended.** Read each live surface and write what it says. A surface that did not
   ship in this batch keeps its old entry and is named on the Issue as outstanding.

## The coherence check, after the batch

Run it against the **live** surfaces, not against the drafts; `product-lead` holds a read-only browser
for exactly this. Report each line as pass or fail on the Issue, without quoting private text.

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
  batch waits on its slowest surface, and a held site merge holds the whole batch.
- **One activation for the whole proposal, not one per surface.** The owner reads the positioning once,
  as a whole. The cost: one change to one surface's text sends the activation back, and a long batch is
  a long read.
- **The site's typed data is the canonical value.** The CV derives from it and the coherence check
  compares against it, so a figure is typed once. The cost: a surface the site does not carry (the
  newsletter, a separate CV design) has no derived copy and drifts unless step 6 catches it.
- **Profile writes in the browser, by the main session, attended.** It is the only route that can write
  a profile without holding a credential for unattended public writes. The cost: nothing contains the
  act but the owner's presence (`content-publishing`, step 10).
- **The record follows the live surfaces.** It stays true after a partial batch. The cost: one more read
  of every surface.

## What nothing enforces

**All of this is an instruction.** No hook, permission rule or check observes a positioning change, a
batch, the owner's ok, a browser write or the record. A test in the repository that renders this method
asserts that this skill carries its key clauses and names no consumer; it asserts the procedure is
written, never that a session followed it. Whether every surface the consuming project has is in the
batch depends on its surfaces file, which only an agent that reads `<private-dir>` can see.
