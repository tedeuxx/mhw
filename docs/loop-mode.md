# The loop mode of record

loop-mode: kanban
loop-mode-since: 2026-10-01
loop-mode-enum: scrum kanban
loop-mode-repos: tedeuxx/mhw
wip: 1

This repository is a **consumer** of the `tadeumendonca-skills` plugin's loop: the five lines above
follow that plugin's `docs/loop-mode.md` parsing contract (column 0), of which `commands/autonomy.md`
reads `loop-mode:` and `wip:`; the other three are carried for parity with the plugin's record and
`commands/autonomy.md` reads none of them. The plugin's `<!-- loop-mode-contract -->` block in its own
`CLAUDE.md` governs what a mode may vary — this file declares a value and decides nothing. Under
`kanban` the pool is open issues labelled `loop` (or `product`) **and** `ready`, ordered FIFO within
that partition; no milestone is consulted and none of the rites runs. This repository's drain is
**intended** to be independent of the owner's other two repositories, and `loop-mode-repos` names this
repository alone — but nothing in the plugin reads that field: `commands/autonomy.md` tells the session
to read the record in BOTH repositories and stop on a disagreement, and the sibling records say
`scrum`. A drain that follows the command literally will halt on that mismatch; treating this
repository as independent depends on the session scoping that instruction to this repository, and
nothing checks it. `wip: 1` means one slice in development at a time, and nothing mechanical enforces
it.
