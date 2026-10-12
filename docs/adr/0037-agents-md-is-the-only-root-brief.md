# ADR-0037: AGENTS.md is the only root brief in every repository the owner authors

- **Status:** ~~proposed~~ accepted (2026-10-11, the owner's ratification in session; see the
  amendment "accepted" below)
- **Date:** 2026-10-11
- **Deciders:** the owner (the rule, in session, 2026-10-11); written by the implementing agent
- **Related:** [ADR-0010](0010-global-brief-rendered-to-each-harness.md) (the user-level brief, unchanged),
  [ADR-0032](0032-this-repository-is-the-single-source-of-the-working-method.md) (the plugin cutover, #62);
  cross-repository: tedeuxx/tadeumendonca-io#721 (PR #722) and tedeuxx/tadeumendonca-skills#562, in flight

## Context and problem

The owner, 2026-10-11:

> *"o que eu quero eh não usar mais o arquivo que funciona somente no claude (claude.md), preferindo
> trabalhar com padrões abertos (agents.md)"*

> *"o meu problema eh o arquivo de instrução root em cada repositório git"*

> *"nível usuário acho que não faz diferença"*

He wants the open format, `AGENTS.md`, and not the one file only Claude Code reads. His concern is the
root instruction file of each git repository. The user level is out of scope: mhw keeps rendering the
global brief to `~/.claude/CLAUDE.md` (ADR-0010).

Until this record, this repository carried both: a root `AGENTS.md` with the rules, and a root
`CLAUDE.md` that imported it with `@AGENTS.md` plus three lines of its own. That bridge was the only way
Claude Code reached `AGENTS.md`, on the belief that Claude Code does not read `AGENTS.md` itself.

The change sets a cross-cutting pattern for every repository he authors, so a record is owed
(ADR-0001 significance gate).

## Decision drivers

- One open format that Claude Code, Codex and Kiro all read natively, with no vendor-only file.
- One file to keep current, so the copies cannot drift apart.
- The rule must survive Claude Code's precedence: a vendor file that wins silently would hide the
  open one.
- Native behaviour first; no hook (the workstation's hook budget admits only existential risk).

## Considered options

### Option A: `AGENTS.md` alone; delete `CLAUDE.md`, no bridge (chosen)

The root instruction file is `AGENTS.md`. There is no root `CLAUDE.md`, no `.claude/CLAUDE.md` and no
`CLAUDE.local.md`, not even a one-line `@AGENTS.md` bridge.

- Good: one file, the open standard, read natively by all three agent harnesses (measured below for
  Claude Code and Codex).
- Bad: it rests on a Claude Code behaviour that is measured, not documented as a contract: `AGENTS.md`
  is read only as a fallback. A later build could change that silently.
- Bad: a stray `CLAUDE.md` anywhere Claude Code looks (root, `.claude/`, local, an ancestor directory)
  turns `AGENTS.md` off entirely, and nothing in the session says so.

### Option B: keep the `@AGENTS.md` bridge (rejected by the owner)

A one-line `CLAUDE.md` importing `AGENTS.md`. It works on every Claude Code build that honours imports.
Rejected: it keeps the vendor-only file the owner wants gone, and it is a second file to keep right.

### Option C: keep both files with their own content (rejected)

The state before. Rejected: two briefs drift, and Claude Code reads only one of them.

## Decision outcome

Option A. In every repository the owner authors, the root instruction file is `AGENTS.md` alone.

In this repository:

- `CLAUDE.md` is deleted. Everything it carried was already in `AGENTS.md` (the delivery contract:
  `workspace/README.md`, no session-type intake, agents merge slices into `rc/next`, the release
  candidate waits for the owner), so nothing moved.
- `AGENTS.md` carries the rule as a hard rule, and `workspace/delivery_test.py` asserts that no
  shadowing file exists, that `AGENTS.md` stays under 30,000 bytes (an early warning before Codex's
  32,768) and that the rule sentence is there.
- `mhw status` reports, for the workspace given by `--project` (or the git root of the current
  directory), a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the root or in any ancestor
  directory, and an `AGENTS.md` over 32,768 bytes. It never names the user-level `~/.claude/CLAUDE.md`.
  In a linked git worktree it skips the main checkout's own three files, because Claude Code does not
  read them from there (measured; see Evidence). It still names ancestors above the main checkout, and
  labels them as not measured. `mhw status --summary` keeps its ten-line
  limit by counting the findings on its existing workspace item. This is a check the owner or an agent
  runs; no hook runs it.

For the cutover (#62): the generated `tadeumendonca-skills` distribution emits `AGENTS.md` only, never
`CLAUDE.md` (requirements document, section 8).

Cross-repository work is in flight and is not this record's change: tedeuxx/tadeumendonca-io#721 (PR
#722) and tedeuxx/tadeumendonca-skills#562.

### Evidence

Measured 2026-10-11 on the reference machine, in throwaway directories outside every repository, with
no `CLAUDE.md` in any ancestor directory. The user-level `~/.claude/CLAUDE.md` was present throughout.
Each probe appended a random nonce as the **last line** of a copy of this repository's `AGENTS.md` and
asked the model to return it without reading files. The copy was this record's own final `AGENTS.md`
(22,397 bytes; 22,428 with the nonce line). No nonce was committed.

| Agent harness | Setup | Result |
| --- | --- | --- |
| Claude Code 2.1.296 (`claude -p`, `--tools ""`, `PMHWC_PASTE_WRAPPER` unset) | `AGENTS.md` only | nonce returned: `AGENTS.md` loaded whole, end included |
| Claude Code 2.1.296 | the same, plus a root `CLAUDE.md` holding one heading | `NONE`: `AGENTS.md` not loaded (calibration) |
| Codex CLI 0.160.0 (`codex exec --ephemeral -s read-only --skip-git-repo-check`) | `AGENTS.md` only | nonce returned |
| Codex CLI 0.160.0 | nonce placed after 40,000 bytes of padding (62,430 bytes) | `NONE`: truncated (calibration) |

The user-level `~/.claude/CLAUDE.md` did **not** shadow the project `AGENTS.md`: the first row ran with
it present.

~~The owner's own probes the same day also found that `.claude/CLAUDE.md`, `CLAUDE.local.md` or an
ancestor `CLAUDE.md` each replace `AGENTS.md`; those three were not re-measured by this record.~~
~~Codex's limit is its `project_doc_max_bytes` default, 32,768 bytes (owner's live probe; the
calibration above shows truncation, not the exact byte).~~ *(Struck 2026-10-11: the `agents-lead`
lens on PR #154 measured all of it, in the rows below.)*

The `agents-lead` lens on PR #154 ran the probes below on the same builds, the same day. Each used a
fresh nonce, in throwaway directories with no shadowing file above the probe root.

| Probe | Layout | What came back |
| --- | --- | --- |
| R1 | root `.claude/CLAUDE.md` beside the root `AGENTS.md` | only the `.claude/CLAUDE.md` nonce: `AGENTS.md` shadowed |
| R2 | root `CLAUDE.local.md` beside the root `AGENTS.md` | only the `CLAUDE.local.md` nonce: `AGENTS.md` shadowed |
| B | a plain directory with `CLAUDE.md`, above a separate git repository with `AGENTS.md` | only the ancestor nonce: shadowed |
| C | `X/.claude/CLAUDE.md` above the git repository `X/repo` | only the ancestor nonce: shadowed |
| L | `X/CLAUDE.local.md` above the git repository `X/repo` | only the ancestor nonce: shadowed |
| w | a **linked worktree** of an outer repository that has a committed `CLAUDE.md`, at `outer/.claude/worktrees/w`, with its own `CLAUDE.md` removed | only the worktree's own `AGENTS.md` nonce; neither outer file was loaded |
| f | the same, with the linked worktree at `outer/sub/f` | only the worktree's own `AGENTS.md` nonce |
| e | a **separate** `git init` repository at `outer/.claude/worktrees/e` | only the outer `CLAUDE.md` nonce: its own `AGENTS.md` shadowed |
| Codex | root `AGENTS.md` of exactly 32,768 bytes ending in a nonce | the nonce came back whole |
| Codex | the same at 32,769 bytes | the nonce came back missing exactly its final byte |

So, on Claude Code 2.1.296, any of the three names shadows `AGENTS.md` from the root or from an
ancestor directory. A linked worktree does not read its main checkout's files, wherever the worktree
sits. A separate repository nested under a checkout does read them. Why Claude Code skips the main
checkout from a linked worktree is a hypothesis about its internals and is not established; only the
behaviour is measured. **Not measured:** an ancestor *above* the main checkout, seen from a linked
worktree. `mhw status` keeps naming those and labels them as not measured.

Codex's limit is inclusive: 32,768 bytes is read whole, and from 32,769 on the tail is cut. `mhw status`
uses `size > 32768`. The user-level `~/.codex/AGENTS.md` (about 14.8 KB) was loaded in both Codex runs
and did not count against the project budget. **Hypothesis, not measured:** Codex applies the budget to
the concatenation of every project `AGENTS.md` from the git root down to the working directory. If so,
a nested `AGENTS.md` shares the root's budget, and a check that measures only the root file
under-reports. Kiro truncates steering at 50,000 characters (owner's measurement). That is a looser
limit than Codex's, so the Codex limit governs. Kiro was not probed.

### Consequences

- Good: one open-format brief per repository, read natively by the agent harnesses measured.
- Good: the failure mode is named where the owner looks (`mhw status`) instead of being silent.
- Bad: the rule rests on undocumented Claude Code fallback behaviour, measured on one build. A build
  that stops reading `AGENTS.md` would leave Claude Code sessions with no project brief and every check
  here green; only a fresh nonce probe finds it.
- Bad: `mhw status` reports; it prevents nothing. A `CLAUDE.md` added by a person, a tool or an
  `/init` command takes effect at once.
- ~~Bad: the ancestor check is a directory walk. A git worktree nested inside another checkout (for
  example under `.claude/worktrees/`) inherits the outer checkout's `CLAUDE.md` as an ancestor, and the
  check names it; that is correct, and may surprise.~~ *(Struck 2026-10-11: false for the case it
  named. The PR #154 lens measured probes w and f, and a linked worktree does not inherit its main
  checkout's files.)*
- Bad: the ancestor check is a directory walk, and it encodes a measured Claude Code behaviour that is
  not documented. A **linked worktree** (for example this repository's agent worktrees under
  `.claude/worktrees/`) does not read its main checkout's `CLAUDE.md`, `.claude/CLAUDE.md` or
  `CLAUDE.local.md`, so the check skips them. A **separate repository** nested under a checkout does
  read them, so the check names them. A build that changes either behaviour makes the check wrong in
  one direction or the other, and only a fresh probe would show it.
- Neutral: the method source in `method/` still speaks of a consuming repository's `CLAUDE.md` (for
  example the loop-mode contract block). Rewording it is the plugin repository's change
  (tadeumendonca-skills#562) and the cutover's (#62), not this record's.

## Amendment 2026-10-11: accepted

The owner ratified this record, in session on 2026-10-11, answering a picker with *"Ratificar"*. The
status moves from proposed to accepted. Nothing in the decision changes; the evidence levels stated
above stay as written (`mhw status` reports the case; it is a check the owner runs, not a hook).

## Links

- [ADR-0010](0010-global-brief-rendered-to-each-harness.md): the user-level brief, unchanged.
- [ADR-0032](0032-this-repository-is-the-single-source-of-the-working-method.md) and
  [requirements document, section 8](../mhw-product-requirements-document-project.md#8-plugin-as-a-generated-artifact):
  the cutover.
- tedeuxx/tadeumendonca-io#721, PR #722; tedeuxx/tadeumendonca-skills#562.
