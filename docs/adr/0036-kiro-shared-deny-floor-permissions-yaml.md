# ADR-0036: Kiro IDE and Kiro CLI share one deny floor in the user-level permissions.yaml

- **Status:** proposed
- **Date:** 2026-10-11
- **Deciders:** the owner (the option, on [Issue #144](https://github.com/tedeuxx/mhw/issues/144),
  2026-10-11); written by the implementing agent
- **Issues:** [#144](https://github.com/tedeuxx/mhw/issues/144)
- **Amends:** [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md) ("Kiro: nothing is rendered")
  and the Kiro cell of [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md)

## Context and problem

The owner, 2026-10-11: *"deveria ser kiro ide e kiro cli suportados."* (Kiro IDE and Kiro CLI should
both be supported.) Up to v5.2.0, Kiro got the global brief and nothing of the deny floor
(ADR-0016: "Kiro: nothing is rendered"). The Kiro IDE got only what it happens to share with the CLI.

The read-only measurement on #144 found that the IDE and the CLI share `~/.kiro`, and that the IDE has
no carrier for the paste wrapper, the paste prompt hook or a model default. The one native control both
read is the permission file. On #144 the owner chose the **shared deny floor**: render the existing
floor into the user-level `~/.kiro/settings/permissions.yaml`. He rejected full parity (allow rules, an
IDE agent, global hooks) and "document only".

This changes how a harness is supported, so a record is owed (ADR-0001 significance gate).

## Decision drivers

- One floor, one source. The Kiro rules come from the same validated `global/deny-floor.conf` plus
  overlay that Claude Code and Codex are rendered from, so the three cannot drift apart.
- Native mechanism first: the vendor's own permission file, not a hook.
- Merge, never clobber. The owner, or Kiro itself after a consent prompt, may already have rules in
  that file.
- A mistake must fail visibly and in the safe direction. Kiro drops every rule in a permissions file
  it cannot parse, so a merge that broke the file would silently remove the floor *and* the owner's
  own denies.
- Report every claim at its evidence level. Nothing Kiro runs is measured here.

## Considered options

### Option A: shared deny floor in the user-level permissions.yaml (chosen)

`install.sh` runs `global/kiro/kiro_permissions.py`, which merges the floor into
`~/.kiro/settings/permissions.yaml` as deny rules.

- Good: one file covers Kiro IDE 1.x and Kiro CLI V3 (*documented*), with one rule engine. A deny
  wins over any allow in any scope, so no workspace or session rule can relax it (*documented*).
- Good: no hook and no new process. The owner's rules stay in the file.
- Bad: Kiro CLI 2.x, the default engine of the installed CLI (2.29.1), does not read the file
  (ADR-0027). The floor reaches the CLI only under `--v3`.
- Bad: user scope, not admin scope. The owner, or any process running as him, can edit it.

### Option B: full parity (rejected by the owner)

Add the allow list to the same file, an IDE-compatible agent, and global hooks.

- Good: closest to Claude Code and Codex.
- Bad: much larger. The IDE has no prompt-submit hook type to carry the paste filter (*documented*
  absence). The owner rejected it for this version.

### Option C: document the gaps only (rejected by the owner)

- Good: no code.
- Bad: Kiro keeps no floor at all.

## Decision outcome

Option A.

### Schema, with the evidence for each fact

| Fact | Evidence |
| --- | --- |
| User file `~/.kiro/settings/permissions.yaml`; workspace file `~/.kiro/workspace-roots/<hash>/permissions.yaml`, outside the repository | **documented** (kiro.dev/docs/permissions, read 2026-10-11) |
| Read by Kiro IDE and Kiro CLI (V3) | **documented** (same page, product table) |
| Top level `rules:`, a list; each rule has `capability`, `effect` (`deny`, `ask` or `allow`), optional `match` and `exclude`, both lists of strings | **documented**, from the examples; the field set is confirmed in the IDE 1.2.56 bundle (`extension.js`, read-only) |
| Deny wins over ask and allow, across every scope; no allow can override a deny | **documented** |
| A shell pattern ending in `" *"` matches the bare prefix and the prefix followed by anything; `*` matches any run of characters; each part of a compound command (`;`, `&&`, `\|\|`, `\|`) is checked on its own | **documented** (wildcard, compound commands); the `" *"` expansion is **read from the IDE bundle** (it compiles a pattern to a Cedar `like` plus an `==` on the prefix) |
| Filesystem patterns are globs: `*` inside one path part, `**` across parts; a leading `~/` is the home directory | **documented** (globs); the `~/` expansion is **read from the IDE bundle** |
| A rule with an unknown field, a missing capability or an invalid effect makes Kiro reject the whole file, which then contributes no rule | **read from the IDE bundle** (`zwe`, `DNu`, `mas`) |
| A rule with an unknown capability is skipped with a warning | **read from the IDE bundle** |
| When `permissions.yaml` exists, `permissions.json` in the same directory is not read | **read from the IDE bundle** (`jss`) |
| A user-scope consent decision is written back to the file, re-serialised without comments; a new pattern of a given capability and effect is appended to the first rule of that capability and effect | **read from the IDE bundle** (`was`, `Xjd`) |
| Kiro CLI 2.x ignores the file; `kiro-cli --v3` runs the V3 engine | **documented** (ADR-0027) and the help text of the installed `kiro-cli` 2.29.1 (*measured*: the `--v3` and `--v2` flags exist) |

### Rendering

| Floor entry | Kiro rule |
| --- | --- |
| `cmd <words>` | `shell` deny `"<words> *"` |
| `glob <words>*` | `shell` deny `"<words>*"`, as written |
| `file <path>` | `fs_read` deny and `fs_write` deny `"<path>"` |

A pattern counts as present when a deny rule of that exact capability, with no `exclude`, lists it. An
allow, an ask or a deny with an `exclude` does not count. Missing patterns are appended as new deny
rules, one per capability. Install never removes a rule.

### Merge, ownership, refusals

- **Parse.** A strict reader for the subset the schema uses. An anchor, an alias, a tag, a flow
  mapping, a multi-line scalar, a top-level key other than `rules` and `policies`, or a file Kiro would
  reject is **refused**: nothing is written, exit 3.
- **Write.** The owner's rules are kept in order, value for value. The file is re-serialised, as `jq`
  re-serialises `~/.claude/settings.json`, so his comments and quoting do not survive. The result is
  parsed back and must equal his rules plus the appended ones, or nothing is written. The previous
  file is kept as `permissions.yaml.pmhwc-backup`, owner-only (0600). A new file is created 0600 in a
  0700 directory, as Kiro creates it. A symbolic link is written through.
- **Ownership.** The deny rules install appended (capability and match list, as appended) are recorded
  in `~/.local/share/personal-multi-harness-workstation-configuration/kiro-permissions-owned.json`,
  not in the YAML, because Kiro's own write-back drops comments. Uninstall edits only those rules,
  never one of the owner's, even when his rule holds the same pattern (PR #150 review). A rule counts as
  mhw's when it is a deny of that capability, has no `exclude`, and its match list starts with the
  recorded patterns; the first such rule is taken, because at install no earlier rule could match. The
  recorded patterns are removed from it. A pattern Kiro appended after a consent prompt stays. A rule
  whose match list becomes empty is removed whole, because an empty match list matches everything. A
  recorded rule that cannot be found (edited by hand), or no record at all, removes nothing and prints
  a `NOTE`, because a deny left behind is the safe direction.
- **Not a string.** A plain scalar any YAML parser could read as something other than a string is
  refused, never re-quoted (PR #150 review). This covers null, `~`, booleans in any case including
  YAML 1.1's `yes`, `no`, `on` and `off`, and every number spelling. Re-quoting would turn a rule Kiro
  rejects, which disables the whole file, into a rule that applies.
- **Temporary file.** Every write goes through a random name created with `O_EXCL` (`mkstemp`) in
  the target's directory, then an atomic rename. A link planted at a predictable name is never
  followed. The backup is opened with `O_EXCL` and `O_NOFOLLOW`.
- **Stamp.** The first comment line carries the provenance stamp (ADR-0029). When Kiro rewrites the
  file the stamp is lost. `--check` then reports `STAMP` and install writes it back.
- **permissions.json.** A non-empty `permissions.json` with no `permissions.yaml` beside it is
  refused. Writing the YAML would make Kiro stop reading the owner's JSON rules.
- **Report.** `install.sh --check` prints `OK`, `MISSING`, `DRIFT` or `STAMP` for the file, and the
  `FLOOR   Kiro:` line counts the patterns present. `mhw status` shows these lines the same way it
  shows the other targets.

### Gaps (stated, not closed)

- **Paste wrapper, paste prompt hook, model default:** none for the IDE. It has no pty to wrap, no
  documented prompt-submit hook type and no model or effort key in a file (Issue #144 measurement,
  *documented* or read from the bundle).
- **The CLI agent `~/.kiro/agents/workstation.json`** (allow list, ADR-0031) is ignored by the IDE,
  because it carries fields only the CLI has (Issue #144, read-only). The IDE gets the floor and not
  the allow list.
- **No local admin layer for the IDE.** ADR-0027 read an admin file
  (`/Library/Application Support/Kiro/managed-settings.json`), but the IDE's enterprise scope appears
  to be delivered from the cloud (Issue #144). This floor is user scope only, and the owner or any
  process running as him can edit it.
- **Kiro CLI 2.x** (the installed 2.29.1, default engine) does not read the file. The floor reaches
  the CLI only with `--v3`.
- **Windows:** `install.ps1` does not render it.
- **Workspace scope:** nothing is written to `~/.kiro/workspace-roots/`. A deny there still adds to
  the floor, and no allow there can lift it (*documented*).

### Evidence

| Claim | Level |
| --- | --- |
| The renderer and its merge, refusal, ownership, stamp and uninstall paths | **tested**, in throwaway HOMEs: `global/kiro/kiro_permissions_test.py` (29 cases, Python 3.14 and 3.9; every source mutation of the guards, the `verify()` call, the not-a-string check and the temporary file, each killed by the suite) and `global/install.test.sh` section 24, through `install.sh` |
| The rendered file is what Kiro's schema accepts | **structural**: the field set and the validation rules are read from the IDE 1.2.56 bundle. No Kiro build loaded the file |
| A Kiro IDE or Kiro CLI V3 session denies a floor command | **not measured**. The IDE runtime is outside this agent's reach. A CLI measurement needs a model call, a throwaway HOME has no login, and copying the owner's credentials into one is not allowed (ADR-0008). The owner's fresh-session canary is the route |
| Installed on the reference machine | **no**. The owner installs the release candidate |

### Consequences

- Good: Kiro gets the same floor as Claude Code and Codex from the same source, and the IDE now has
  one control from this project beyond the brief.
- Good: an unreadable or Kiro-invalid file is refused, never "fixed". A merge that would not read back
  is not written.
- Bad: Kiro's write-back drops the stamp and the comments. `--check` turns `STAMP` until the next
  install.
- Bad: re-serialising the file loses the owner's comments. The backup keeps them.
- Bad: on the default Kiro CLI engine nothing changes.
- Version cut (ADR-0002): **minor**. A new protection for a harness. Nothing an adopter had is removed
  or weakened.

## Links

- Issue #144 and its 2026-10-11 decision comment. ADR-0016 (the floor), ADR-0027 (the Kiro carriers),
  ADR-0029 (the stamp), ADR-0031 (the allow list), ADR-0008 (no confidential persistence).
- `global/kiro/kiro_permissions.py`, `global/kiro/kiro_permissions_test.py`, `global/install.sh`
  (`kiro_step`), `global/install.test.sh` section 24.
- kiro.dev/docs/permissions and kiro.dev/docs/ide/whats-new-v1/permissions (read 2026-10-11).
