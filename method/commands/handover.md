---
name: "handover"
description: "Branch a focused child session: name the starting directory (a fresh worktree), the agent harness with its reason, the exact launch line, and a minimal sanitised prompt that tells the child to report back on the issue tracker and print a return prompt. Use when one objective of the current session should run in its own session. Not for splitting a plan into Issues (see idea-to-issues)."
purpose: "work branches into focused child sessions and comes back without losing context, wherever the child ran"
argument-hint: "<the child session's objective>"
---

Prepare a child session for the objective in `$ARGUMENTS`. The owner opens it; this command only writes
what he needs to open it.

## When to use

- One objective of the current session is self-contained and would run better with its own context.
- The child's result must come back to this session, or to any later one, without the owner retyping it.

## Steps

1. **Anchor the objective** in one line, and the Issue that carries it. If no Issue exists, stop and
   offer `new-issue` first: the issue tracker is the bus between sessions, and a child with no Issue
   has nowhere to report.
2. **Choose the starting directory**, the **agent harness** and the **launch line** (sections below).
3. **Write the handover prompt** (section below) to a file in the session scratch directory.
4. **Check it is sanitised** (section below), then show the owner exactly four things, in this order:
   the starting directory, the agent harness and its reason, the launch line, and the prompt.

## Starting directory

- **A fresh worktree from the trunk**, never the owner's main checkout when it holds uncommitted work
  (`git -C <repo> status --porcelain` prints anything). Create it, do not ask him to:
  `git -C <repo> fetch origin <trunk>` then
  `git -C <repo> worktree add -b <branch> <path> origin/<trunk>`.
- `<path>` is outside the main checkout and outside temporary directories, so it survives this session.
  Use the repository's own worktree convention where it documents one.
- A read-only objective (research, review) may start in an existing checkout; say so.

## Agent harness

- Name one: **Claude Code**, **Codex** or **Kiro**, with a one-line reason tied to the task (a native
  feature it needs, a tool list it must enforce, a model or cost the owner prefers for this work).
- If no harness is better for the task, keep the current one and say that is the reason.
- Never pick a harness for a capability the workstation's enforcement matrix marks as absent there.

## Launch line

One line he can paste in a terminal, opening the harness **in the starting directory**:

- Claude Code: `cd "<path>" && claude`
- Codex: `cd "<path>" && codex`
- Kiro: `cd "<path>" && kiro-cli chat`

The prompt is **pasted** into the session, not passed as an argument: a paste never meets shell quoting,
and where the workstation's paste filter is installed it judges the prompt on arrival.

## The handover prompt

Minimal: only what the child needs, with pointers instead of copied content.

- **Session type**, when the target repository declares a session contract, so the child skips its
  intake question.
- **Objective** in one line, and **Issue** `<owner>/<repo>#<n>`.
- **Goal anchor**: the child's first act is to anchor that objective with the agent harness's native
  `/goal` where it exists (listed in Claude Code and Codex, documented for the Kiro CLI), so the goal
  lives in the session; where there is no native `/goal`, it states the objective in its first reply.
- **Context**: the paths, Issue comments or pull requests to read, by reference. No pasted logs or files.
- **Constraints**: what it must not touch, and the delivery route of the repository.
- **Done when**: the observable result that ends the child's objective.
- **The return-prompt instruction**, verbatim in substance (next section).

## The return prompt

The handover prompt ends by telling the child, when its objective is done or blocked:

1. Post a comment on the Issue headed `## Return to the parent session`, with the result, its evidence
   (pull request, commit, check run) and any decision still open for the owner. Write the body to a file
   and post it with `gh issue comment <n> --body-file <path>`.
2. Print the same text as a **return prompt** the owner can paste into any session.

The tracker comment is the durable copy: the parent, or any later session in any agent harness, reads
the Issue to recover the result, without knowing where the child ran.

## Sanitised

- No secret values, no personal data, no client or employer material, in either prompt. Name a secret
  by its name and location only; describe a third party by sector.
- Re-read the prompt file for those before showing it. Where the paste filter is installed (Claude Code
  and Codex prompt hooks), it also blocks a pasted prompt carrying a credential or personal data; Kiro
  has no such filter, so this re-read is the only check there.

## What this command never does

- It never launches the child session itself, merges, publishes or releases anything, and it never
  adds a hook.
- It never starts the child in a checkout holding uncommitted work.
- It never copies conversation content into the prompt beyond the minimum the objective needs.
