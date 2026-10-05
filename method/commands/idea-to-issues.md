---
name: "idea-to-issues"
description: "Cut an agreed requirements document into vertical-slice GitHub Issues, each with acceptance criteria and its blocking order, each checked against the definition of ready. Use when a docs/<repo>-product-requirements-document-<subject>.md is agreed and the owner wants it tracked. Not for an idea still being decided (see new-idea) or a single request (see new-issue)."
purpose: "an agreed document becomes tracked scope the owner can sequence, so work never starts untracked"
argument-hint: "<path to the requirements document, or its subject>"
---

Cut the requirements document named by `$ARGUMENTS` into tracked Issues in the current repository.

*Concept adapted from Matt Pocock's MIT-licensed to-tickets skill, rewritten for GitHub Issues and this
method; no text is copied.*

## When to use

- A requirements document is agreed (written by `new-idea`, or by hand) and the owner wants it tracked.
- **Not** while its decisions are still open: finish them with `new-idea` first, or carry each open
  decision into the slice it blocks, marked as open.

## Steps

1. **Read the document** and the open Issues of the repository (`gh issue list --state open --limit 200`),
   so no slice duplicates or overlaps work already tracked.
2. **Propose the slices** (next section) as a numbered list: title, one-line outcome, blockers.
3. **Ask the owner about granularity and blocking order**, each with a recommended answer, one question
   per message. Stop if he wants the list changed; propose again.
4. **Check every slice against the definition of ready** (section below). A slice that fails is fixed
   before it is opened, or opened with the failing item named.
5. **Open the Issues in blocking order**, so each blocker already has a number when it is cited.
6. **Report** the Issue links in order, with the blocked-by chain, in a few lines.

## Vertical slices

- **A complete path through every layer** the change touches, so the slice is demonstrable on its own.
- **Small enough for one fresh session** to build and gate it.
- **Seams read against each other:** if two slices built as written would both claim, or both leave out,
  one piece of behaviour, move that piece into exactly one of them.
- Cite the document's section each slice comes from.

## Definition of ready

Load `definition-of-ready` and apply the bar it gives for this repository. At least:

- the change is stated as a convention, mechanism or behaviour, not as "improve X";
- **acceptance criteria** are observable: an artifact or a passing check;
- the seam against neighbouring Issues was read;
- blockers are named as `Blocked by #N`.

Do not apply the `ready` label: who applies it is the repository's intake rule, not this command's.

## Opening the Issues

- Write each body to a file in the session scratch directory and open it with
  `gh issue create --title "<title>" --body-file <path>`. Never an inline `--body` for multi-line text.
- Each body carries: the outcome, the acceptance criteria, `Blocked by #N` lines, and a link to the
  requirements document section.
- Add milestones or labels only where the repository's own rules say this command may.

## What this command never does

- It never merges, publishes or releases anything, and it never adds a hook.
- It never opens an Issue the owner did not approve in step 3.
- It never starts building a slice; the loop does that, when he says so.
