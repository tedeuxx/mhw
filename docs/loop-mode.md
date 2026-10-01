# The loop mode of record

loop-mode: kanban
loop-mode-since: 2026-10-01
loop-mode-enum: scrum kanban
loop-mode-repos: tedeuxx/personal-multi-harness-workstation-configuration
wip: 1

This repository is a **consumer** of the `tadeumendonca-skills` plugin's loop: the five lines above
follow that plugin's `docs/loop-mode.md` parsing contract (column 0, read literally by
`commands/autonomy.md`), and the plugin's `<!-- loop-mode-contract -->` block in its own `CLAUDE.md`
governs what a mode may vary — this file declares a value and decides nothing. Under `kanban` the pool
is open issues labelled `loop` (or `product`) **and** `ready`, ordered FIFO within that partition; no
milestone is consulted and none of the rites runs. This repository's drain is **independent** of the
owner's other two repositories, so `loop-mode-repos` names this repository alone and its value is never
compared against theirs. `wip: 1` means one slice in development at a time, and nothing mechanical
enforces it.
