# mhw-sprint-01 — planning (recomposition of 2026-11-22)

The iteration was composed on 2026-11-20 and confirmed by the owner then («Confirmar»). Nineteen of its
items closed. This record covers the recomposition of 2026-11-22, which admits the groomed backlog. The
milestone is `mhw-sprint-01` (number 1, open). Loop mode: `scrum`; `loop-mode-repos: tedeuxx/mhw`.

## The pool as assembled

Open, `loop`, `ready`, carrying `sp:N`, not `blocked`, read over REST on 2026-11-22 after the grooming
([record](https://github.com/tedeuxx/mhw/blob/b3aa049642c4f2d791dc0d49f9acc048d7a94015/docs/backlog-grooming/2026-11-22.md))
and the planning poker (agents-lead and quality-assurance, isolated, median rounded up when it falls off
the scale; owner ruling «Aplicar medianas»):

#27 sp:3, #129 sp:8, #428 sp:8, #429 sp:5, #430 sp:3, #431 sp:3, #432 sp:5, #433 sp:5, #434 sp:3,
#435 sp:5, #436 sp:8, #437 sp:3, #438 sp:2, #439 sp:1, #502 sp:8 (re-estimated from 3), #531 sp:13,
#532 sp:8. Excluded: #251 (`blocked`). Out of the pool by grooming verdict: keep (#79, #190, #440, #441,
#442, #470) and owner action (#131, #220, #224, #443, #466).

## The ranking as returned

There was one `scrum-master` dispatch, with no tools. Loop before product (#339) partitions nothing here,
because every item is `loop`. **No ratified rule orders within a class; the intra-class sequence below is a
filing-order tiebreak, not a ranking.** Stated dependencies are constraints. Serial chains because of
shared files: #27→#429 (status), #431→#432 (glossary), #433→#434→#435 (`src/commands/delivery.js`),
#435→#436 (`/cleanup`), #437→#438 (`method/agents/scrum-master.md`).

Process findings it returned:
- no capacity or velocity figure exists;
- #430 (the ADR index) collides implicitly with every slice that adds an ADR;
- #437's `ready` admits the item, but the widened permission still needs the owner's word at review;
- admission into an open sprint has no ratified procedure (#532 proposes one), so it is recorded here
  as the owner's decision.

## The composition as proposed — every item, in or out, with why

| # | title (short) | in/out | why |
|---|---|---|---|
| 27 | Guard `ANTHROPIC_BASE_URL` | in | tiebreak only — no ratified rule orders within this class |
| 129 | Editorial harness | in | tiebreak only |
| 550 | Recoverable install (a): journal + status | in | split of #428; tiebreak only |
| 551 | Recoverable install (b): `mhw recover` | in | split of #428; after #550 (stated dependency) |
| 429 | `mhw verify` | in | tiebreak only; after #27 (shared `status`) |
| 430 | ADR index generator | in | tiebreak only |
| 431 | Conversation rules + glossary | in | tiebreak only |
| 432 | `/welcome` | in | after #431 (stated dependency) |
| 433 | delivery merge removes worktree | in | tiebreak only |
| 434 | delivery merge closes the Issue | in | after #433 (shared file) |
| 435 | `/cleanup` git classes | in | after #433 (stated dependency) |
| 436 | `/cleanup` other classes | in | after #435 (stated dependency); not split, consensus sp:8 |
| 437 | scrum-master reads the tracker | in | tiebreak only |
| 438 | Parallel builds | in | after #430 and #437 (stated dependency) |
| 439 | Builder done means nothing running | in | tiebreak only |
| 502 | S32: one runtime in CI | in | already admitted 2026-11-20 |
| 552 | Effectiveness (a): report | in | split of #531; tiebreak only |
| 553 | Effectiveness (b): CI skills eval | in | split of #531; tiebreak only |
| 554 | Effectiveness (c): D1 ADR + local eval | in | after #553 (soft dependency) |
| 555 | Effectiveness (d): docs/effectiveness/ | in | after #552 (stated dependency) |
| 556 | Effectiveness (e): orchestrator records `usage` | in | tiebreak only |
| 532 | Sprint admission mid-sprint | in | tiebreak only |
| 428 | Recoverable install (parent) | out | tracking parent; its points are carried by #550–#551 |
| 531 | Effectiveness (parent) | out | tracking parent; its points are carried by #552–#556 |
| 251 | `VERSION_BUMP_TOKEN` to a GitHub App | out | `blocked` |

Split estimates (isolated poker, 2026-11-22): #550 agents-lead 3 / QA 5 → 5; #551 5 / 5 → 5;
#552 5 / 8 → 8; #553 3 / 5 → 5; #554 2 / 3 → 3; #555 2 / 3 → 3; #556 1 / 2 → 2. Split by both estimators:
#531 21 sp against the 13 sp of the whole Issue, which QA attributes to review and test cost.

## The activation log

1. 2026-11-22, one picker: «Sprint mhw-sprint-01: 22 itens / 101 sp, todos loop. Quebro #428 em 2 e
   #531 em 5 sub-Issues, e os pais saem do milestone como épicos. Ordem: número da Issue com as
   dependências. Confirmo e escrevo o milestone?» Answer: «Confirmar com splits (Recomendado)».

## The composition as confirmed

As proposed: 22 open items, 101 sp. The milestone description was updated with `mhw milestone update 1
--expect-file … --description-file …`; the stale-read check passed.

## Worklog snapshot

Open in the milestone after admission, sum of `sp:` labels over the milestone's open Issues: **101**.

## Estimation pendency this leaves

None among the 22. #531 remains in the milestone without `sp:` or `ready`. This session's GitHub route
cannot clear a milestone: the deny floor refuses `gh api` writes, and the MCP update ignores a cleared
milestone. **Owner action: remove #531 from `mhw-sprint-01`.** Until then the preflight sees one item
with no estimate, and that item is a parent, not work.

## What could not be assembled

The velocity of earlier iterations, which has no recorded start or end date. File sets for the items
outside the named chains, so whether they can run in parallel is unverified.
