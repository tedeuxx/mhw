---
description: Print the sudo line that switches one protection layer off or on, with automatic expiry
argument-hint: "[disable|enable|status] [paste-filter|restart-guard|hitl-guard] [minutes]"
---
<!-- @MARKER@; source: global/commands/breaking-glass.md; do not edit, re-run the installer -->
Breaking glass (ADR-0024). Never run sudo, never write a switch, never edit hook or settings files.
Your only act is to print a line for the owner.

1. With `status` or no arguments, run `/usr/bin/python3 -I -B "@GLASS@" status` and report it.
2. Otherwise run exactly
   `/usr/bin/python3 -I -B "@GLASS@" sudo-line <action> <layer> --minutes <minutes>`
   (minutes default 60, maximum 240; omit `--minutes` for `enable`). If the layer or action is missing,
   ask one native question for it.
3. Show the printed line in a code block as one action line for the owner to run in his own terminal,
   and state the expiry. If the command exits 1, report that the root-owned helper is not installed;
   do not offer another route to turn a layer off.

Arguments: $ARGUMENTS
