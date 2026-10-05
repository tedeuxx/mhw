---
name: "new-idea"
description: "Turn a new idea, or a plan to refine, into an agreed requirements document: interview the owner round by round until every decision is settled, then write docs/<repo>-product-requirements-document-<subject>.md. Use when the owner brings an idea or a plan that is not yet agreed. Not for a one-off request (see new-issue) or for cutting an agreed document into Issues (see idea-to-issues)."
purpose: "a plan reaches building only after shared understanding, and that understanding lands in a versioned document instead of staying in the chat"
argument-hint: "<the idea or plan, in your own words>"
---

Turn `$ARGUMENTS` into an agreed requirements document for the current repository.

*Concept adapted from Matt Pocock's MIT-licensed skills (grilling and to-spec), rewritten for this
method; no text is copied.*

## When to use

- The owner brings a new idea, or a plan he wants refined, and its decisions are not settled yet.
- **Not** for a one-off request: that goes straight to one Issue with `new-issue`.
- **Not** for an agreed document: cutting it into Issues is `idea-to-issues`.

## Steps

1. **Anchor the subject.** Restate the idea in one line and pick a short kebab-case `<subject>`. If a
   requirements document on the same subject already exists in `docs/`, this is a refinement of it:
   read it first and interview only on what changes.
2. **Look up the facts yourself.** Read the code, `docs/`, the decision records and the tracker before
   asking anything. A question whose answer is in the repository is not his to answer.
3. **Run the interview rounds** (next section) until no decision is open.
4. **Write the requirements document** (section below) and show him its path and a three-line summary.
5. **Deliver it through the repository's own route** (a branch and a pull request, if that is how the
   repository works). Then point at `idea-to-issues` as the next step; do not run it unasked.

## Interview rounds

- **Facts are the agent's; decisions are the owner's.** Ask him only what is a choice.
- **Each round asks every question that is now answerable**, each with **a recommended answer** and one
  line on why. A question that depends on an unsettled answer waits for a later round.
- **The workstation's escalation limit still holds:** where his brief allows one ask per message, put the
  round's questions to him one per message, in order. The round is the set; the message carries one.
- A decision is **settled** only when he states or accepts it. Record his words, translated to English,
  next to the decision they settle.
- Stop when every decision the plan needs is settled, or when he says the rest stays open; an open
  decision is written into the document as open, never guessed.

## The requirements document

- **Path:** `docs/<git-repo-name>-product-requirements-document-<subject>.md`, where `<git-repo-name>`
  is the repository's own name.
- **Content:** the agreed **target behaviour and why**, in English, one language throughout; diagrams in
  Mermaid; open decisions listed as open. Follow `documentation-standard`.
- **Sanitised:** no secret values, no personal data, no client or employer material. Describe a third
  party by sector or category only.

## What this command never does

- It never merges, publishes or releases anything, and it never adds a hook.
- It never decides for the owner: an unanswered decision stays open in the document.
- It never opens Issues; that is `idea-to-issues`, when he asks for it.
