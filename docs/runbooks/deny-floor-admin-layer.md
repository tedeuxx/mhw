# Runbook: install the deny floor in the admin layer

The owner's act. Agents never run `sudo` (it is in the deny floor) and never run these steps.
Decision and evidence: [ADR-0016](../adr/0016-user-level-deny-floor-rendered-per-harness.md), amendment
2026-10-05. Restart rule: [ADR-0022](../adr/0022-restart-after-active-customization-changes.md).

## Install (one `sudo` line, in a fresh session)

**Order: the admin layer first, then the user layer.** This holds for a new machine and for every
upgrade. An admin layer an earlier release installed (v2.x: the restart guard, the picker guard with its
session-intake exception, timed breaking-glass) stays registered until step 1 and its `sudo` line
replace it. A plain `./mhw install` does not touch the admin layer.

1. `./mhw install --admin`, then the one `RUN     sudo` line it prints.
2. `./mhw install`, as yourself.
3. Close every Claude Code and Codex session and open fresh ones.

If step 1 was skipped, `./mhw install`, `./mhw check` and `./mhw status` name
every `STALE` and `DRIFT` admin target and every removed control still installed, print
`next: ./mhw install --admin, then run the one sudo line it prints`, and `install` and `check`
exit non-zero ([#52](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/52)).

From a checkout of `main` at the merged, released commit, in your own terminal:

```sh
./mhw install --admin
```

It renders and validates a stage, installs nothing, and prints one line starting `RUN     sudo`. Run
that one line as printed. It carries the stage's SHA-256, so a changed stage installs nothing. The same
line also refreshes the admin-layer hooks (ADR-0025). Then run `./mhw install` as yourself: it
detects the admin layer and removes the user-level hook duplicates.

Then close every Claude Code and Codex session and open fresh ones.

## Verify (canary)

1. `./mhw check` exits 0, every installed-target line `OK`, and no `ADMIN` line (the `PREREQ`
   section that follows reports tools and subscriptions; see [prerequisites](../prerequisites.md)).
2. `./mhw status` shows `managed: installed` and `deny floor: the admin layer`.
3. **Block, Claude Code**, in an empty scratch folder: start `claude --setting-sources project` (the
   flag that dropped the user floor) and ask it to run `npm publish --dry-run`. Expected: the command
   is denied by a permission rule. Harmless if it were not: there is no `package.json`, and
   `--dry-run` publishes nothing.
4. **Pass, Claude Code**, same session: `npm --version` runs.
5. **Block, Codex**: `codex exec --ignore-rules "run npm publish --dry-run"` in the same folder.
   Expected: refused, *"policy forbids commands starting with `npm publish`"*. Then `npm --version`
   runs.

Record the result on Issue #59. Until steps 3 and 5 are seen, the admin floor is *installed*, not
*enforced*.

## Undo

`sh global/install-managed.sh --uninstall` prints the `sudo` line that removes the admin documents
(hooks and floor together). The user-level floor stays in place throughout: it is retired only after
this canary passes, as a separate step.
