# The loop mode of record

loop-mode: scrum
~~loop-mode: kanban~~
loop-mode-since: 2026-11-20
~~loop-mode-since: 2026-10-01~~
loop-mode-enum: scrum kanban
loop-mode-repos: tedeuxx/mhw
~~wip: 1~~

This repository is a **consumer** of the `tadeumendonca-skills` plugin's loop: the ~~five~~ four
declaration lines above follow that plugin's `docs/loop-mode.md` parsing contract (column 0), of which
`commands/autonomy.md` reads `loop-mode:` ~~and `wip:`~~; the other three are carried for parity with
the plugin's record and `commands/autonomy.md` reads none of them. **The `wip:` line is retired
(2026-10-19, #216, the owner's decision):** it is struck at column 0, so a `^wip: ` read finds nothing,
and no method file reads it any more. Development runs one issue per git worktree with no count; the
review gate stays serial (the method's `orchestration` skill, *The loop-mode contract*, rules 5 to 7). The plugin's `<!-- loop-mode-contract -->` block in its own
`CLAUDE.md` governs what a mode may vary — this file declares a value and decides nothing. ~~Under
`kanban` the pool is open issues labelled `loop` (or `product`) **and** `ready`, ordered FIFO within
that partition; no milestone is consulted and none of the rites runs.~~ This repository's drain is
**intended** to be independent of the owner's other two repositories, and `loop-mode-repos` names this
repository alone ~~— but nothing in the plugin reads that field: `commands/autonomy.md` tells the session
to read the record in BOTH repositories and stop on a disagreement, and the sibling records say
`scrum`. A drain that follows the command literally will halt on that mismatch; treating this
repository as independent depends on the session scoping that instruction to this repository, and
nothing checks it~~. *Amended 2026-11-20 (#522): the method's `autonomy` command and `sprint-planning`
skill now read `loop-mode-repos` and scope their loop-mode read and their pool to the repositories it
names, so a drain or a planning run here reads this record alone. That is an instruction those files
carry; nothing mechanical checks it.* ~~`wip: 1` means one slice in development at a time, and nothing mechanical enforces
it.~~ Nothing mechanical enforces the worktree rule or the serial gate either.

## 2026-11-20: switched to `scrum` (#522)

The owner's ruling, verbatim, given through the decision picker on 2026-11-20 and recorded on
[Issue #522](https://github.com/tedeuxx/mhw/issues/522#issuecomment-7049476494):

> «mhw passa a scrum»

In English: tedeuxx/mhw runs `scrum`, scoped by `loop-mode-repos` to this repository alone. The
switch is an **act**, so `loop-mode-since` is dated to the day it lands, not back-dated. Not chosen:
`kanban` with a machine-readable dependency field, and `kanban` with the sprint as a label only.

What it changes here:

- **The sprint is a commitment.** The pool is open issues labelled `loop` (or `product`) **and**
  `ready` **and** carrying the active iteration's milestone, where the active iteration is the oldest
  open milestone that holds an eligible item. It is derived from the items and never from a typed title:

  ```
  gh issue list --repo tedeuxx/mhw --state open --limit 200 --json number,labels,milestone \
    --jq '[.[]|select(.milestone!=null)
            |select((.labels|map(.name)|index("ready"))
                    and ((.labels|map(.name)|index("product")) or (.labels|map(.name)|index("loop"))))
            |.milestone.number]|min'
  ```

  The order inside it is the ranked body composed at `/sprint-planning`, not arrival order.
- **The closing rites run** when the drain exhausts its entry snapshot: `/sprint-review`,
  `/sprint-retrospective`, then `/sprint-planning`.
- **This sprint is this repository's own.** It is not composed with tadeumendonca-io's sprint, and
  `loop-mode-repos` keeps it apart. For this repository, the ruling supersedes the owner's 2026-11-01
  ruling that sprints are a tadeumendonca-io construct and that mhw runs an independent kanban tracker
  ([ADR-0043](adr/0043-backlog-grooming-batch-confirmation-and-scrum-for-mhw.md)).

Nothing mechanical reads this record. The mode is an instruction the `autonomy` command and the rites
follow.
