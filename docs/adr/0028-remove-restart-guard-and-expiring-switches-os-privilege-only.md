# ADR-0028: Remove the restart guard and the expiring switches; OS privilege is the only way to turn a hook off

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Supersedes in part:** [ADR-0024](0024-breaking-glass-per-layer-expiring-switches.md) (all of it: the
  per-layer expiring switches and `/breaking-glass`), [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md)
  (its restart-guard and switch parts; the admin layer itself stays)
- **Amends:** [ADR-0022](0022-restart-after-active-customization-changes.md) (the restart requirement stays,
  as an instruction; its hook enforcement is removed)
- **Issue:** [#56](https://github.com/tedeuxx/mhw/issues/56)
  (part of [#52](https://github.com/tedeuxx/mhw/issues/52))

## Context and problem

Two mechanisms built on 2026-10-04 no longer fit the owner's decisions:

- **The restart guard** (ADR-0022, ADR-0025). A `SessionStart`/`PreToolUse` hook that denied tool calls
  when configuration metadata changed during a session. It locked the owner out once (ADR-0023). It
  then kept denying routine work after vendor-written changes (ADR-0022, 2026-10-04 amendments). Claude
  Code `--bare` skips the managed `SessionStart` hook (measured, see the
  [enforcement matrix](../native-enforcement-matrix.md)), so a flag could bypass it anyway.
- **The per-layer expiring switches** (ADR-0024). A root-owned file per hook layer, which expired after
  at most 240 minutes. `/breaking-glass` printed the `sudo` line that wrote it.

The owner's direction for the whole review, on #52 (2026-10-04), verbatim:

> "lembre-se que o objetivo final é um harness fino nessa camada de protecao. a menor atuacao ja
> garante a maior parte dos cenarios nocivos que desejamos atacar. podemos tbm começar com um escopo
> bem reduzido para aumento de maturidade ao longo da experiencia de uso."

His decision on waivers, on #56 and #52 (2026-10-05), verbatim:

> "nao podemos ter nenhuma trava mecanica que individualize pedidos de waiver temporarios que nao
> esteja associado a um nivel de privilegio que permaneça valido ao longo da sessao. o sudo/su pode
> servir para esse proposito alinhado a um comportamento padrao de industria de so."

In English: no mechanical lock may require individual, temporary waiver requests unless the waiver
is tied to a privilege level that stays valid for the whole session. `sudo`/`su` serves that
purpose, as in standard operating-system behaviour.

His direction for this slice, as relayed to the build (2026-10-05; not quoted verbatim): defend the
perimeter, not the behaviour. Hard control of agent behaviour has proved ineffective.

## Decision drivers

- No per-request or expiring waiver. An exception goes only through OS privilege.
- Defend the perimeter (secrets, third-party material, irreversible acts), not the agent's behaviour.
- A thin layer: remove code that protects against no harm the deny floor and the brief do not
  already cover (requirements document, sections 4 and 4a).
- Removal must be clean. It must take effect only when the owner next runs the installer.

## Considered options

1. **Remove the restart guard, the switches and `/breaking-glass`. The OS-privilege route is the
   admin editing or removing the managed documents with `sudo` (chosen).** It adds no code. It uses
   the route every OS-managed policy already has. Trade-off: no slash command. Turning one layer off
   is a hand edit of a root-owned file, documented in the runbook, not a one-line command.
2. **Keep `/breaking-glass`, reduced to printing a `sudo` line with no expiry.** A whole-layer line
   already exists: `install-managed.sh --uninstall`. A per-layer line needs new code that runs as
   root to edit the admin documents. That brings back a root-run helper, its ownership checks and
   their tests. Rejected as thicker than option 1 for the same result.
3. **Keep the root-owned switch files, without expiry.** This would comply with the decision: the
   privilege lasts the whole session. Rejected: it is a second policy plane beside the admin
   documents, and every hook must read it on every call. Editing the policy file itself is the
   standard OS behaviour the owner named.
4. **Keep a rethought restart guard** (the 2026-10-04 "Repensar o guard" choice on #52). Superseded
   by the owner's thin-layer direction on #52 the same day. A session on stale configuration is a
   behaviour problem, not a perimeter one.

## Decision outcome

Option 1.

- **Restart guard:** `global/hooks/restart_guard.py` and its tests are deleted. Neither installer
  registers it. The ADR-0022 rule stays in the global brief as an instruction: configuration changes
  need a fresh session. Stale configuration is also covered by the version key (#57).
- **Switches:** `global/hooks/breaking_glass.py`, its tests and the `/breaking-glass` command are
  deleted. The paste filter and the HITL picker guard no longer read a switch.
- **Turning a hook off:** only the administrator, with `sudo`, by editing or removing the managed
  documents (the Claude Code drop-in and `/etc/codex/requirements.toml`). `install-managed.sh
  --uninstall` prints the line that removes everything this project installed there. A layer stays
  off until the administrator restores it; nothing expires. `install-managed.sh --check` reports an
  edited document as `DRIFT`, so a layer that is off stays visible. The steps are in the
  [breaking-glass runbook](../runbooks/breaking-glass.md).
- **Clean removal, at the next installer run only:**
  - `install.sh` deletes the managed `restart_guard.py`, `breaking_glass.py`, the rendered
    `/breaking-glass` command and the guard's baseline directory. It drops the restart-guard hook
    entries from the Claude Code settings and rewrites the Codex `hooks.json` without them.
    `--check` reports each leftover as `STALE` or `DRIFT`. A file it did not write is left alone.
  - `install-managed.sh --apply` installs admin documents without the restart guard, and deletes
    the two old scripts and the switch directory. `--check` reports them as `STALE`; `--remove`
    deletes them too.
- **Hooks that remain:** the paste prompt hook (its future is the open owner decision on #58) and the
  HITL picker guard (until #60). The deny floor is native configuration, not a hook, and is unchanged.

## Consequences

- Good: the lockout class is gone. No hook decides whether the owner's session may act.
- Good: one way to grant an exception, the one every OS already has. Nothing expires behind his back.
- Good: less code. Two modules, two suites, one command and one CI step are removed.
- Bad: stale configuration is now instruction only on every agent harness. An agent can continue on
  stale configuration and nothing stops it. The version key (#57, not built yet) will report the
  mismatch; it will not block it.
- Bad: turning one hook layer off means editing a root-owned file by hand. A malformed edit can stop
  the agent harness from loading the managed settings. The runbook keeps the deny floor entries and
  tells the owner to validate the file and re-run `--check`.
- Bad: `install-managed.sh --remove` also removes the admin copy of the deny floor, which lives in
  the same documents. The user copy stays.
- Open, not measured: whether rewriting the Codex `hooks.json` asks the owner to trust the paste
  hook again in `/hooks`.
- Evidence level: *written and tested* in throwaway homes and roots (`global/install.test.sh`,
  `global/install-managed.test.sh`, the paste filter and HITL suites). The cleanup assertions were
  checked by mutating the installer source. **Not installed:** the reference workstation still runs
  the restart guard until the owner runs the admin-layer installer in a fresh session.

## Links

- [ADR-0002](0002-automatic-semver-cut-policy.md): a removed control is a `major` cut.
- [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md): `sudo` is in the deny floor, so an
  agent cannot run the line itself.
- Requirements document, sections 4 and 4a:
  [`docs/personal-multi-harness-workstation-configuration-product-requirements-document-project.md`](../personal-multi-harness-workstation-configuration-product-requirements-document-project.md)

## Amendment 2026-10-05: the picker guard is removed too ([Issue #60](https://github.com/tedeuxx/mhw/issues/60))

"The HITL picker guard (until #60)" above has reached its end: the guard is removed on the owner's
interview of 2026-10-05 (ADR-0013, 2026-10-05 amendment). It is removed the same way as the restart
guard here: a run of each installer deletes what an earlier version installed, and `--check` reports
it until then. The paste prompt hook (#58) is now the only hook this repository installs.
