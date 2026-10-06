# Runbook: install the deny floor in the admin layer

The owner's act, in his own terminal. Agents never run `sudo` (it is in the deny floor). `mhw` runs
`sudo` itself only after dropping any cached credential, so the admin layer needs the owner's password
typed for that run; an agent that fakes a terminal meets a prompt it cannot answer
([#113](https://github.com/tedeuxx/mhw/issues/113)). A passwordless `sudo` rule would remove that barrier.
Decision and evidence: [ADR-0016](../adr/0016-user-level-deny-floor-rendered-per-harness.md), amendment
2026-10-05. Restart rule: [ADR-0022](../adr/0022-restart-after-active-customization-changes.md).

## Install (one command, in your own terminal)

From a checkout of `main` at the merged, released commit (or with `mhw` after the npm install):

```sh
./mhw install
```

It lists what will change, waits for RETURN, says why it needs administrator access and lets `sudo` ask
for your password once. It installs the admin layer first and then the user layer, which detects the
admin layer and removes the user-level hook duplicates. The admin stage is rendered and validated as
you, and installed only with its SHA-256, so a changed stage installs nothing (ADR-0025). An admin
layer an earlier release installed (v2.x: the restart guard, the picker guard with its session-intake
exception, timed breaking-glass) is replaced in the same step.

Then close every Claude Code and Codex session and open fresh ones (the first next step says so).

If the admin layer was not installed (`--no-admin`, no terminal, or the password refused),
`./mhw install`, `./mhw check` and `./mhw status` name every `STALE` and `DRIFT` admin target and every
removed control still installed, and print `next: ./mhw install (it asks for your administrator
password once)`; `check` exits non-zero ([#52](https://github.com/tedeuxx/mhw/issues/52)).

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

`./mhw uninstall` removes the admin documents (hooks and floor together) after RETURN and your
password, then the user layer. The user-level floor stays in place throughout: it is retired only after
this canary passes, as a separate step.
