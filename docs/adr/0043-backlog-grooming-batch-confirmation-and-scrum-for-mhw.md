# ADR-0043: Backlog grooming closes and rewrites the owner's Issues on one batch confirmation, and mhw runs scrum

- **Status:** proposed
- **Date:** 2026-11-20
- **Deciders:** the owner (the request for the command, and the switch to `scrum`); written by the
  implementing agent from the `agents-lead` intake on the Issue
- **Issues:** [#522](https://github.com/tedeuxx/mhw/issues/522)
- **Alters:** the owner's 2026-11-01 ruling that the sprint is a tadeumendonca-io construct and that
  this repository runs an independent `kanban` tracker (see *The 2026-11-01 ruling, amended* below)

## Context and problem

The owner asked for a command that refines the whole backlog and then plans one sprint that drains it,
in his words on Issue #522:

> «quero um comando para /backlog-grooming que inicia uma sessao onde o foco é refinar todo backlog
> existente, consolidando itens e revisando assertividade dos itens antes de planejar tudo em um sprint
> unico na saida dele para drenar todo backlog.»

In English: a session that refines the whole existing backlog, consolidating items and reviewing how
accurate each one is, then plans everything into one sprint that drains it.

Two things in that request cross a recorded boundary:

1. **Refining means closing and rewriting Issues the owner opened.** The method's rule is that only the
   owner opens work, and that closing is his act with a named criterion (`agents-configuration`,
   *Closing an issue is a step, with a criterion*; "an Issue he opened is never closed on agent
   advice"). A pass over about fifty Issues would cost one interruption per close if each were asked
   separately, which is the walk-through `/sprint-planning` was rebuilt to avoid (#393).
2. **"One sprint" had no meaning here.** `docs/loop-mode.md` said `kanban`: the drain ignores
   milestones and orders work in arrival order, and a measured dependency (#502 blocked by #503's
   series, sorted before it) shows arrival order can invert one. The owner's 2026-11-01 ruling scoped
   sprints to tadeumendonca-io.

The owner settled the second on 2026-11-20 through the decision picker
([comment](https://github.com/tedeuxx/mhw/issues/522#issuecomment-7049476494)):

> «mhw passa a scrum»

## Decision drivers

- The owner's time: one interruption for the whole pass, not one per Issue.
- No loss of the owner's words: a merge or a rewrite must not drop an acceptance criterion or a body.
- No close on opinion: a close must name its criterion and, for a stale premise, carry a measurement.
- The sprint must order work, so a known dependency is not inverted.

## Considered options

### For the confirmation

1. **One batch confirmation over a written record, with safeguards (chosen).** The pass writes a dated
   record with every verdict and the verbatim prior body and acceptance criteria of every Issue it would
   touch, then asks once: confirm, confirm with changes, or discard. Nothing is written on the tracker
   before he answers. *Trade-off:* he rules on many acts at once and can miss one; the record is what
   lets him, or anyone later, find and undo it.
2. **One confirmation per close or merge.** Each act is its own question. *Trade-off:* the safest per
   act, and about fifty interruptions; it reproduces the fifteen-question planning that stopped at item
   1 (#393). Rejected.
3. **No confirmation: the agents decide.** *Trade-off:* no interruption, and it breaks
   only-the-owner-opens-work and his standing rule that his Issues are never closed on agent advice.
   Rejected.

### For "one sprint" in this repository

1. **Switch this repository to `scrum`, scoped by `loop-mode-repos` (chosen by the owner).** The
   sprint is a commitment with a ranked body; the closing rites run when it is exhausted.
   *Trade-off:* rites and a planning activation per sprint, where `kanban` had none.
2. **Keep `kanban` and add a machine-readable dependency field the drain honours.** *Trade-off:* fixes
   the inversion without rites, and adds a field and a reader nothing has built. Not chosen.
3. **Keep `kanban`; the sprint is only a label.** *Trade-off:* no cost, and the order it was meant to
   carry does nothing. Not chosen.

## Decision outcome

**1. Backlog grooming may close, merge, rewrite and type the owner's Issues on one batch confirmation**,
under these safeguards, all carried by `method/commands/backlog-grooming.md`:

- every open Issue is enumerated with `--limit 200`, and a count at the limit stops the pass;
- each Issue gets exactly one verdict; a close names its criterion, and "premise no longer holds" needs
  a measured command and its output, or the verdict is keep;
- the dated record `docs/backlog-grooming/<date>.md` keeps the prior body and acceptance criteria of
  every touched Issue verbatim;
- one owner activation, before any write: confirm, confirm with changes, or discard; his ruling is
  recorded verbatim in the record and quoted, after its act is applied, on each affected Issue,
  linking the record by a commit permalink;
- a merge adds a `Consolidated from #N` section to the target, and every acceptance-criteria line of
  the source is checked in the target with an exact `grep -F -- '<line>'` before the source closes (the
  `--` because a checkbox line starts with `-`, which grep would otherwise read as an option);
- `content` never enters the sprint; cross-repository twins are flagged and never consolidated;
  items only the owner can do stay outside the sprint;
- the command creates no milestone and hands off to `/sprint-planning`, whose own confirmation
  composes the sprint.

**2. tedeuxx/mhw runs `scrum`**, recorded in `docs/loop-mode.md` with the ruling above, dated
2026-11-20 as an act. `loop-mode-repos: tedeuxx/mhw` scopes it to this repository: the method's
`sprint-planning` skill (steps 0 and 1) and `autonomy` command now read that line and plan or drain only
the repositories it names, so a run here no longer stops on the other repositories' records. A record
naming two repositories keeps the two-repository behaviour unchanged.

### The 2026-11-01 ruling, amended

The owner's ruling of 2026-11-01, given at tadeumendonca-io's `sprint-08` planning, is written in
tadeumendonca-io's `docs/planning/sprint-08.md` (section "Re-plan, 2026-11-01 — io-only",
[PR #795](https://github.com/tedeuxx/tadeumendonca-io/pull/795)): *the sprint tracker covers
tadeumendonca-io product work only; loop work moved to the workstation repository's own tracker.* That
sentence stays true and is not struck: the tadeumendonca-io sprint still covers its own product work,
and this repository still has its own tracker. What this record alters is the reading carried with it,
that this repository's tracker is a `kanban` flow and never a sprint. **For tedeuxx/mhw, that reading
is superseded: its tracker runs its own `scrum` sprints, never composed into the tadeumendonca-io
sprint.** The reading was carried in the orchestrating session's memory, where it is struck in place on
2026-11-20, and in this repository's `docs/loop-mode.md`, amended in the same pull request as this
record.

## Consequences

**Good**

- One interruption refines the whole backlog, and the record makes every act reviewable and undoable.
- A merge cannot silently drop a criterion: the record holds it, and the grep check stops the close.
- This repository's sprint orders its work, so a known dependency can be ranked rather than inverted.
- Planning and the drain read the scope from the record instead of assuming two repositories.

**Bad**

- A batch confirmation can carry an act the owner did not look at closely. The record and the per-Issue
  ruling comment are the mitigation, after the fact, not a prevention.
- Nothing enforces any safeguard. The activation, the order of writes and the grep check are
  instructions; no hook or check observes them (this workstation adds hooks only for existential risk,
  ADR-0035).
- `scrum` adds rites and a planning activation per sprint to this repository.
- The first run cannot use the installed command, which installs only after the release candidate and a
  fresh session; it runs from the branch source, and that run is the probe.

## Links

- [Issue #522](https://github.com/tedeuxx/mhw/issues/522) and the
  [owner's ruling](https://github.com/tedeuxx/mhw/issues/522#issuecomment-7049476494)
- `method/commands/backlog-grooming.md`; `method/skills/sprint-planning/SKILL.md` (steps 0 and 1);
  `method/commands/autonomy.md`; [`docs/loop-mode.md`](../loop-mode.md)
- [ADR-0032](0032-this-repository-is-the-single-source-of-the-working-method.md): this repository is the
  source of the working method
