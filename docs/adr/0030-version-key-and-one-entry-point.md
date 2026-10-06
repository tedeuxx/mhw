# ADR-0030: A per-project version key, checked by instruction and by `./workstation status`, behind one entry point

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Issues:** [#57](https://github.com/tedeuxx/mhw/issues/57),
  [#67](https://github.com/tedeuxx/mhw/issues/67) (part of
  [#52](https://github.com/tedeuxx/mhw/issues/52);
  requirements document, sections 7 and 9b)

## Context and problem

Two requirements from the approved plan meet here. A project must be able to say which workstation
release it expects, so that a stale install or a stale configuration is visible (section 7; the owner
chose a warning that never blocks). And installing must be one command run from the repository, with
no remembered flags and no separate admin installer step (section 9b; owner, 2026-10-04: *"precisa de
um mecanismos de instalacao facilitado gerenciado pelo proprio repo git"*). The status view is also the
detailed source the session-start summary (#80) will condense.

This sets a cross-cutting pattern every project follows (a key file and its format), which is why a
record is owed.

## Decision drivers

- Native first, thin layer: no new hook (the owner's "defend the perimeter, not the behaviour").
- One source of the installed release: the provenance stamp (ADR-0029), never a second derivation.
- Never block on the key; report at the real evidence level.
- The two existing installers stay as tested internals.

## Considered options

1. **A `.workstation-version` file, a user-brief instruction, and `./workstation` over the existing
   installers (chosen).** *Trade-off:* the session-start comparison is an instruction a model may skip;
   only `status` is deterministic.
2. **A `SessionStart` hook that compares the key.** *Trade-off:* deterministic where hooks run, but a
   new hook against the hook budget, absent in Kiro, skippable by `--bare` in Claude Code (measured in
   the enforcement matrix), and it was the shape of the removed restart guard (ADR-0028).
3. **The instruction in each project brief instead of the user brief.** *Trade-off:* every project
   repeats it and can drift from the format; the user brief reaches every project from one copy.
4. **Rewrite the installers into one program.** *Trade-off:* a large, retested rewrite for no new
   behaviour; the entry point only has to choose flags and summarise output.

## Decision outcome

Option 1.

- **Key file:** `.workstation-version` at the project root. The first line that is not blank or a `#`
  comment holds comparators `>=`, `>`, `<=`, `<`, `=` with `X`, `X.Y` or `X.Y.Z`, separated by blanks
  (or commas); all must hold. Anything else is reported as invalid.
- **Installed release:** the `release:` field of the stamp. `vX.Y.Z` is that release; `unreleased,
  after vX.Y.Z` compares as X.Y.Z, because no newer release is in it; anything else is a mismatch.
- **On mismatch:** one line, the same in the brief and in `status`: `Workstation version key: required
  <range>, installed <release>. Run ./workstation install in the managed-workstation checkout.` Nothing
  blocks.
- **`./workstation`** (POSIX shim, logic in `global/workstation.py`, Python 3.9+ standard library):
  `install` runs `install.sh` with `--hooks=managed` when it finds the admin drop-in and `--hooks=user`
  otherwise, then reports the admin layer's state and runs the check; `install --admin` runs
  `install-managed.sh`, which prints the one `sudo` line; `check` runs both `--check`s; `status` reads
  the installed stamps, the layers (managed, user, workspace carriers, Claude Code plugins), the
  protections from the installers' own `--check` lines, the version key and the runtime (host, or a
  Podman/Docker marker). `--verbose` adds every target and each agent harness's version.
- **`update [vX.Y.Z]`** refuses while a tracked file is modified (the stamp's own *dirty* rule), fetches
  tags, checks out the newest strictly numeric release tag or the one given (detached), and installs
  with the checked-out release's `workstation.py`, or its `install.sh` when the release predates it.
- **`uninstall`** runs the new `install.sh --uninstall`: it removes only files carrying the marker, and
  in the settings file only our hook entries, our two keys and ~~the deny-floor rules rendered from the
  checkout~~ the deny-floor rules the installer recorded as its own. With an admin layer present it
  prints `install-managed.sh --uninstall`'s `sudo … --remove` line for the owner. ~~A deny rule the owner
  also wrote by hand that equals a floor rule is removed with the floor; the backup keeps it.~~
  *Amended 2026-10-05 (lens finding on #88): ownership is tracked.* The merge records, in a second
  top-level key (`…-owned-deny`), the floor rules that were absent before it appended them. `uninstall`
  removes only those, so a hand-written rule equal to a floor rule stays. A settings file stamped by an
  install that predates the record counts every floor rule present as ours, because nothing can tell
  them apart. Measured: Claude Code 2.1.289 still applies `permissions.deny` from a user settings file
  carrying both keys (a probe `Bash` deny removed `Bash` from the tool list; calibration without it kept
  `Bash`).
- **Hooks in `status`** (*amended 2026-10-05, lens finding on #88*): ~~derived from whether the admin
  drop-in exists~~. Read per layer from the installed files: a hook is named only when its entry is
  registered (user settings, Codex `hooks.json`; admin drop-in, `requirements.toml` carrying the marker)
  **and** its script is present. An unreadable file reads `not read`, never a claim.
- **`--overlay`** accepts only `none` or an existing directory, passed on as an absolute resolved path;
  anything else is refused before any installer runs.

## Consequences

- Good: one command to install, one to read state; the version key needs no hook and works in all three
  agent harnesses wherever the brief is loaded.
- Good: `status` reuses the installers' `--check`, so it cannot disagree with them on a target.
- Bad: `status` parses the installers' line prefixes (`OK`, `STAMP`, `DRIFT`, `FLOOR   carried by:`); a
  change there must move with it. The end-to-end test runs the real installers to catch that.
- Bad: the session-start comparison is an instruction. Whether a model performs it is **not
  measured**; it needs a login in a throwaway configuration.
- Bad: Claude Code may not show the HTML `managed-by` comment to the model (not measured), so the
  instruction tells the agent to read the brief file's first lines when the stamp is not in context.
- ~~Not built here: `update`, `uninstall`, `install [version]` (tag checkout) and a comparison with the
  latest published release (section 9b).~~ *Amended 2026-10-05, same PR:* `update [vX.Y.Z]` and
  `uninstall` are built (below); a version is selected through `update`, not `install`. Still not built:
  a comparison with the latest published release. `install` writes the user layer for all three agent harnesses
  whether or not each is installed; `status` reports which are on `PATH`. Windows keeps `install.ps1`.
- This repository's key is `>=3.1 <4`: an install from `rc/next` (`unreleased, after v3.0.0`) reports a
  mismatch until the release that carries this change is installed.

## Evidence

Measured 2026-10-05 in throwaway homes and a throwaway admin root under the session scratch directory
(`env -i`, `HOME`, `TMPDIR` and `WORKSTATION_MANAGED_ROOT` there), never `sudo`:

- `./workstation install`, then `status`: every user target written and `check` clean; `status`
  showed the user stamp equal to the source, `managed: absent`, the floor carried by the user layer.
- `./workstation install --admin` printed the `sudo` line; that line run **without** `sudo` through
  the installer's test-only `--root` path, then `./workstation install` removed the user Codex hooks and
  `status` showed `managed: installed`, the floor and hooks carried by the admin layer.
- Version key: a project with `>=3.0 <4` read `match`; `>=9 <10` printed the mismatch line.
- Codex 0.160.0, `codex debug prompt-input` with the installed `CODEX_HOME`: the model-visible prompt
  carries the `managed-by` line with `release:` and the instruction. Claude Code 2.1.289 headless,
  `InstructionsLoaded` probe hook: the installed `CLAUDE.md` loaded as `User` memory. No model call.
- `update` and `uninstall`, each with its own synthetic origin (two numeric tags) and clone: `update`
  checked out v9.1.0 and the installed stamp read `release: v9.1.0`; `update v9.0.0` went back; a
  modified tracked file was refused with HEAD unchanged; `uninstall` removed all 12 files of ours, kept a
  foreign file, a foreign settings key and a foreign deny rule, and with an admin layer printed the
  `sudo … --remove` line.
- `global/workstation_test.py`: the comparison table, the status view, one end-to-end run of the real
  installers, and `update`/`uninstall` against their own clones, the hooks read per layer, the overlay validation and deny ownership. Thirty-seven source mutations
  (`global/workstation.py` and `install.sh --uninstall`), in a copy of the tree, each turned the suite
  red; the unmutated copy stayed green.

## Amendment 2026-10-05: the session-start runtime summary (#80)

**Context.** The owner: *"o mais importante é comunicar adequadamente ao usuario do harness qual
configuracao de runtime ele tem no inicio de cada sessao"*. At the start of every session the agent
harness user is told which runtime configuration is in effect.

**Decision.** `./workstation status --summary` renders about ten lines from the same facts `status`
gathers (no second data path): agent harness and version, configured model and effort, the stamp and
version-key result, the layers, workspace settings that override a user default (and
`disableAllHooks` wherever it is set), what no lower layer can override, the protections at their
evidence level, the configured permission mode, and host or container. The carrier in all three agent
harnesses is the same brief section, *Session-start runtime summary*: state the summary in the first
reply (after the session-type picker, when one is due), relaying `./workstation status --summary` when
the checkout is reachable, and name the native view for what only the agent harness knows: Claude Code
`/status`, Codex `/status`, Kiro `/context show` and `/tools`. Codex reads it from `AGENTS.md`, Kiro
from its always-included steering file, Claude Code from `CLAUDE.md`.

**Considered options for Claude Code.**

- *Brief instruction (chosen).* Native, already loaded, the same text as the other two agent harnesses,
  nothing new installed or executed. Bad: it depends on a model obeying it, which is not measured.
- *Native status line (rejected).* It is a settings key (`statusLine`), not a `hooks` entry, but it runs
  a command on every refresh, and the 2.1.289 bundle couples it to the hooks kill switch (the string
  `Status line is configured but disableAllHooks is true`). It would add a recurring executed command
  where the principle is no new hooks; `statusLine` holds one value, so installing ours would replace a
  status line the user already has; the summary's source runs the installers' `--check`, too slow for
  a refresh; and it renders neither in headless `-p` nor in the desktop app. Its one advantage is real:
  it reaches the user without depending on a model. Revisit if the brief instruction proves unreliable.
- *A `SessionStart` hook (rejected).* A new hook, against the stated principle.

**Gaps, stated.** No agent harness reports overrides per layer natively; the summary reads only the
user and workspace files it knows (Claude Code `settings.json` and `settings.local.json`, Codex
`config.toml` top-level keys), so a command-line flag, a Codex profile or an environment variable that
changes the session is not visible there, and the summary points to the native view for it. Kiro
settings are not read. The summary is an instruction: no hook produces it.

**Evidence, 2026-10-05**, throwaway home and admin root under the session scratch directory, `env -i`:
`./workstation install --overlay=none` rendered the section into all three user briefs; `status
--summary` with a project setting `permissions.defaultMode: acceptEdits` reported it as a workspace
override and the permission mode. Claude Code 2.1.289 headless `init`, in the same project, reported
`permissionMode: acceptEdits` and a model: the agent harness's own report agrees with the file-derived
line. `/status` was not in the headless `slash_commands` list (`context` and `model` were): the Claude
Code pointer is *documented*, not measured. Codex 0.160.0 `codex debug prompt-input`: the model-visible
prompt carries the section. Kiro: rendered steering file only (*documented* loading). No model call.
Six source mutations of `render_summary` and `read_settings` each turned `RuntimeSummary`/`Settings`
red; the restored file stayed green.

*Repair, same PR, after the agents-lead lens.* The first version listed the deny floor under
`cannot override` with "a deny in any layer wins", and cut the installer's caveat at its first `;`.
Without the admin layer the floor is user-level and a session flag drops it (#55, #59), so that line
erred in the permissive direction. Now only what sits in the admin layer is named there; any other
floor reads `deny floor NOT locked:` followed by the installer's `FLOOR   carried by:` text word for
word. QA also found a pre-#66 admin drop-in (our filename, no stamp key) reported as `managed:
absent`; `status` now reports it as `installed (legacy, pre-#66; reinstall to update)` and never says
absent while a drop-in is present. Probed in throwaway homes and roots with the admin layer absent,
present (staged, applied without `sudo` through `--root`) and as a legacy drop-in generated from the
`install-managed.sh` template at `3742ffa`. Eight more source mutations each turned the suite red.

## Amendment 2026-10-05: prerequisites in `./workstation check` (#89)

**Decision (owner, 2026-10-05, check-only).** The tools and subscriptions the workstation and its lanes
need are declared once, generically, in `global/prerequisites.json`, and `./workstation check` reports
them: present or missing, authenticated or not, drift from the preferred settings, and the manual step
for each gap. A required item that is missing makes the check exit non-zero; authentication and drift
are reported only. Nothing is applied; applying settings to real accounts comes after the owner tests
this. Owner-specific values (active lanes, repositories, Sonar project keys) live in the untracked
`overlay/prerequisites.local.json`.

**Options considered.** *A closed probe set in code, chosen.* The declaration can only pick among
probes `prerequisites.py` implements (version and path queries, `gh auth status`, the merge-settings
`--check`, three HTTPS GETs gated on a token already in the environment), so a declaration edit cannot
turn the check into a mutation. Trade-off: a new kind of probe needs code, not only JSON. *Free-form
commands in the declaration, rejected:* shorter, but the read-only property would rest on review alone.
*Failing on drift and on a missing login, rejected:* a check that fails on what only the owner can
repair, and on credentials it must never ask for, trains the reader to ignore its exit code.

**Consequences.** `./workstation check` can now fail on a machine whose installed targets all match,
when a required tool is missing. `gh auth status` output names the account, so it is discarded.
Tokens are read from the environment only and are never sent after a redirect or to a non-loopback
override. *Repair, same PR (QA and the agents-lead lens):* the probe table became constant
command-and-argument pairs (`-p` only for `xcode-select`, agent harnesses `--version` only), every probe
runs with the tools' auto-install and update switches off (a tfenv shim installed during `terraform
version`, measured), and an offline `gh auth status` reads not-checked rather than not-authenticated.
Whether a subscription is paid and active is not observable and is reported as the client
only, or `MANUAL`. Evidence: [prerequisites](../prerequisites.md).

## Links

- Requirements document, [section 7](../personal-multi-harness-workstation-configuration-product-requirements-document-project.md#7-version-key-per-project)
  and [section 9b](../personal-multi-harness-workstation-configuration-product-requirements-document-project.md#9b-one-install-command-managed-by-the-repository)
- [ADR-0029](0029-provenance-stamp-in-every-installed-file.md) (the stamp the key is compared with)
- [ADR-0028](0028-remove-restart-guard-and-expiring-switches-os-privilege-only.md) (why no hook)
- [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md) (the admin layer `install --admin` renders)
- [Native enforcement matrix](../native-enforcement-matrix.md)
