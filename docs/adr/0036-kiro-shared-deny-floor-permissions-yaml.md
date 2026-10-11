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

*Annotated 2026-10-11:* the IDE-agent part of this option arrives anyway as a side effect of the V3
agent form the owner asked for: with a `permissions` block the IDE loads `workstation.json` too. See the
amendment "the floor also in Kiro's admin file; the agent in the V3 form".

- Good: closest to Claude Code and Codex.
- Bad: much larger. The IDE has no prompt-submit hook type to carry the paste filter (*documented*
  absence). The owner rejected it for this version.

### Option C: document the gaps only (rejected by the owner)

- Good: no code.
- Bad: Kiro keeps no floor at all.

### Option D: the Kiro CLI 2.x carrier (not chosen; the strongest alternative)

Render the floor into the CLI agent `~/.kiro/agents/workstation.json` as
`toolsSettings.execute_bash.deniedCommands` and the file tools' `deniedPaths` (*documented* for CLI
2.x agents, ADR-0016 and ADR-0027).

- Good: it reaches the engine the installed CLI runs by default (2.x, 2.29.1). Sessions launched
  through the paste wrapper run `kiro-cli` with no engine flag, so they run on 2.x and Option A does
  not reach them.
- Bad: the IDE ignores that agent (Issue #144), so the IDE, which is what #144 asks for, gets nothing.
- Bad: it applies only to sessions that select the `workstation` agent. A session on another agent
  has no floor.
- Bad: a second rendering with a different grammar (regex command patterns), which is more to keep in
  step with the floor.

Option D could be added beside A later. It is not part of this decision.

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
| A rule with an unknown field, a missing capability or an invalid effect makes Kiro reject the whole file, ~~which then contributes no rule~~ *corrected 2026-10-11 (PR #153 lens):* and a rejected file is **not** "no rule": the error is fatal, the policy engine is built with `policyLoaded=false`, and it answers **deny to every tool call** in that session | **read from the IDE bundle** (`zwe`, `DNu`, `mas`; the deny-all in `evaluate()`), and the same code in the bundled V3 engine (kas 2.29.1) |
| A rule with an unknown capability is skipped with a warning | **read from the IDE bundle** |
| When `permissions.yaml` exists, `permissions.json` in the same directory is not read | **read from the IDE bundle** (`jss`) |
| The IDE also reads a root-owned admin file as the `administration` scope: `/Library/Application Support/Kiro/managed-settings.json` (macOS), `/etc/kiro/managed-settings.json` (Linux), `C:\ProgramData\Kiro\managed-settings.json` (Windows), same rules schema, parsed as JSON | **read from the IDE bundle** (`Gjd`, `Jjd`); ~~not rendered, not measured; whether Kiro CLI V3 reads it is not checked~~ *2026-10-11 amendment:* rendered by `install-managed.sh`; the Kiro CLI V3 engine reads the same three paths with the same loader (**read from the bundled V3 engine**, kas 2.29.1, `@kiro/agent/dist/server/acp-server.js`); not measured |
| Kiro's writer takes `proper-lockfile`'s lock, a `<file>.lock` directory made with `mkdir`, around its read-modify-write, and serialises with the `yaml` package (v2: plain scalars where it can, lines folded at 80 columns) | **read from the IDE bundle** (`was`, `lineWidth: 80`) |
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
  not in the YAML, because Kiro's own write-back drops comments. Each entry is matched to its own
  distinct rule, which must be a deny of that capability with no `exclude` and exactly the recorded
  match list (PR #150 reviews).
  - Install reconciles the record with the file before it appends anything, and forgets an entry that
    has no such rule (a `NOTE` line). The record therefore never holds an entry without its own rule.
  - Uninstall removes only matched rules, and removes each one whole. It never edits one of the owner's
    rules, even when his rule holds the same pattern, with one exception. If his rule is
    byte-identical to the one mhw appended, uninstall cannot tell them apart and removes it. That
    happens when he deletes mhw's rule and types the same rule back with no install in between.
  - A rule mhw appended that later gained a pattern cannot be told apart from one of his own, so it
    stays. The extra pattern comes from his edit or from a consent pattern Kiro appended.
  - An entry that cannot be matched, or no record at all, removes nothing and prints a `NOTE`, because
    a deny left behind is the safe direction.
- **Not a string.** A plain scalar any YAML parser could read as something other than a string is
  refused, never re-quoted (PR #150 reviews). This covers YAML 1.2 core plus every YAML 1.1 implicit
  type (yaml.org/type), matched in any case:
  - bool, including `yes`, `no`, `on` and `off`;
  - float and int, in every number spelling: hex, octal, binary, underscores, sexagesimal, leading dot,
    exponent, `.inf` and `.nan`;
  - merge (`<<`);
  - null and `~`;
  - timestamp, in all three spellings;
  - value (`=`).

  Re-quoting would turn a rule Kiro rejects, which disables the whole file (*2026-10-11:* in fact puts
  Kiro in deny-all for every tool call; see "A file Kiro rejects locks Kiro out"), into a rule that applies.
- **Temporary file.** Every write goes through a random name created with `O_EXCL` (`mkstemp`) in
  the target's directory, then an atomic rename. A link planted at a predictable name is never
  followed. The backup is opened with `O_EXCL` and `O_NOFOLLOW`.
- **Stamp.** The first comment line carries the provenance stamp (ADR-0029). When Kiro rewrites the
  file the stamp is lost. If the rewrite stays inside the reader's subset, `--check` reports `STAMP`
  and install writes the stamp back. If it does not (see Consequences), the file is refused with its
  cause.
- **Kiro's lock.** install and uninstall take Kiro's own lock (`<real file>.lock`, an `mkdir`
  directory) before reading and hold it across the write and the rename. While both sides honour the
  lock, a consent rule Kiro writes meanwhile is not lost.
  - **Held lock.** The wait is bounded (3 seconds). A lock still held after that is refused visibly,
    with the lock's path; nothing is written and Kiro's lock is never removed.
  - **Before each rename.** mhw checks that the lock is still the directory it made (same device and
    inode). If Kiro reclaimed it as stale and took its own, the write is refused (exit 3): the
    temporary file is removed, nothing is renamed and Kiro's lock stays. If it is still ours, its
    mtime is refreshed, so it does not look older than proper-lockfile's 10-second stale threshold.
  - **On release.** The lock is removed only if it still looks like the one mhw made; otherwise it is
    left alone with a `NOTE`. A release that fails after a good write is a `NOTE` naming the lock,
    never a traceback, and the exit code stays 0 (PR #150 QA L1, L2; agents-lead lens).
  - **Limit.** The identity check is best effort, not proof. A device and inode pair can be reused,
    and a reclaim can still land in the short window between the check and the rename, or between
    the check and the `rmdir`.
  - *Appended 2026-10-11 (PR #150 review residuals).* **A refusal tells the truth.** A reclaim seen
    after `permissions.yaml` was renamed (when the ownership record is written) no longer says
    "nothing written": the message names the file already changed and the one that was not, and says
    that the rules appended in that run are not recorded, so uninstall will leave them (the safe
    direction). A reclaim seen before any rename says the file was not changed.
  - *Appended 2026-10-11.* **Removing the file is guarded like a rename.** When uninstall would delete
    a `permissions.yaml` mhw created that holds only its rules, it checks the lock first; if Kiro
    reclaimed it, nothing is removed (exit 3) and the record stays.
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
- ~~**Admin layer: not rendered (open option).**~~ *Closed 2026-10-11 by the owner's decision; see the
  amendment "the floor also in Kiro's admin file" below.* ~~No local admin layer for the IDE.~~ The IDE 1.2.56
  bundle reads a root-owned `managed-settings.json` as its `administration` scope, with the same rules
  schema as the user file, parsed as JSON. The paths are in the schema table above (*read from the
  bundle*; not measured; Kiro CLI V3 not checked). Issue #144's reading that the enterprise scope comes
  only from the cloud was wrong for this build. This decision renders nothing there. Rendering the
  floor into it, as `install-managed.sh` does for Claude Code and Codex, is an **open option for the
  owner** (a scope decision). Until then the Kiro floor is user scope only, and the owner or any
  process running as him can edit it.
- **Kiro CLI 2.x** (the installed 2.29.1, default engine) does not read the file. The floor reaches
  the CLI only with `--v3`. Sessions launched through the paste wrapper's `kiro-cli` function pass no
  engine flag, so they run on 2.x and have no Kiro floor (Option D would reach them).
- ~~**Windows:** `install.ps1` does not render it.~~ *Struck 2026-10-11 (#145 follow-up): `install.ps1`
  runs `global/kiro/kiro_permissions.py` with the floor it already validated, into
  `%USERPROFILE%\.kiro\settings\permissions.yaml` (Python's home on Windows). Written and tested on the
  Windows CI runner (`global/install.test.ps1`). That Kiro on Windows reads this path is documented in
  its `~/.kiro` form only; not measured.*
- **Workspace scope:** nothing is written to `~/.kiro/workspace-roots/`. A deny there still adds to
  the floor, and no allow there can lift it (*documented*).

### Evidence

| Claim | Level |
| --- | --- |
| The renderer and its merge, refusal, ownership, stamp and uninstall paths | **tested**, in throwaway HOMEs: `global/kiro/kiro_permissions_test.py` (~~41 cases~~ 44 cases since 2026-10-11, the three added ones mutation-checked on Python 3.14; 41 cases, Python 3.14 and 3.9; every source mutation of the ownership guards, the install-time reconciliation, the distinct matching, the `verify()` call, the not-a-string check including timestamps and `=`, the temporary file, Kiro's lock and the refusal message, each killed by the suite) and `global/install.test.sh` section 24, through `install.sh` |
| The rendered file is what Kiro's schema accepts | **structural**: the field set and the validation rules are read from the IDE 1.2.56 bundle. No Kiro build loaded the file |
| A Kiro IDE or Kiro CLI V3 session denies a floor command | **not measured**. The IDE runtime is outside this agent's reach. A CLI measurement needs a model call, a throwaway HOME has no login, and copying the owner's credentials into one is not allowed (ADR-0008). The owner's fresh-session canary is the route |
| A deny still applies in a Kiro CLI V3 session started with `--trust-all-tools` | **not measured** (a hypothesis for the owner's fresh-session canary). The documentation says no allow overrides a deny, but trust-all is a session switch, not an allow rule |
| Installed on the reference machine | **no**. The owner installs the release candidate |

### Consequences

- Good: Kiro gets the same floor as Claude Code and Codex from the same source, and the IDE now has
  one control from this project beyond the brief.
- Good: an unreadable or Kiro-invalid file is refused, never "fixed". A merge that would not read back
  is not written.
- Bad: Kiro's write-back drops the stamp and the comments. `--check` turns `STAMP` until the next
  install.
- Bad: Kiro's writer can also leave a file this reader refuses. It folds a plain pattern longer than
  the 80-column line onto a second line, and leaves a value such as `yes` unquoted. After such a
  write-back, `--check` and install refuse the file (exit 3) and nothing is written. The message
  names the probable cause and the remedy: quote each pattern on one line, or restore
  `permissions.yaml.pmhwc-backup` and add the new rule again. The reader is deliberately not loosened,
  because guessing at such a file could switch on a rule Kiro would reject. The floor already in the
  file still applies, since Kiro reads its own output.
- Bad: re-serialising the file loses the owner's comments. The backup keeps them.
- Bad: on the default Kiro CLI engine nothing changes.
- Version cut (ADR-0002): **minor**. A new protection for a harness. Nothing an adopter had is removed
  or weakened.

## Amendment 2026-10-11: the floor also in Kiro's admin file; the agent in the V3 form

### The owner's decision

On 2026-10-11, in session, the owner chose the open option above: render the deny floor **also** into
the root-owned Kiro admin file, through the admin-layer installer that already does this for Claude
Code and Codex, and **keep** the user `~/.kiro/settings/permissions.yaml` as the fallback (the pattern
ADR-0016 uses for Claude Code and Codex). Rejected: **admin only** (the reason given: Kiro CLI V3 might
not read it; the bundle read for this amendment shows the V3 engine does read it, and the user copy
is still what an install without the administrator password leaves), and **user only** (the owner or
any process running as him can edit it).

### Decision

`install-managed.sh` stages a third admin document, `kiro.json`, and installs it, root-owned and 0644,
at `/Library/Application Support/Kiro/managed-settings.json` (macOS) or `/etc/kiro/managed-settings.json`
(Linux).

- **One source.** The document is rendered by `global/kiro/kiro_permissions.py --mode=admin-json` from
  the `permissions.yaml` that `install.sh` rendered into the same throwaway home, so the admin and the
  user copy cannot name two floors. It holds one deny rule per capability (`shell`, `fs_read`,
  `fs_write`) and one top-level key of ours carrying the provenance stamp (JSON has no comment; the
  permission loader ignores a top-level key it does not know, *read from the bundle*).
- **Validated before install.** `validate()` refuses a stage whose Kiro document Kiro would reject: a
  byte order mark, a top-level shape other than the rules list and our key, a rule field other than
  `capability`, `effect`, `match` and `exclude`, an effect other than `deny` (the administration scope
  allows `deny` and `ask` only, *read from the bundle*), an unknown capability, an empty match list, or a
  statement over the 32-condition ceiling (see "A file Kiro rejects locks Kiro out" below). The
  document is bound into the stage hash like the other two.
- **Never over someone else's file.** An existing `managed-settings.json` without our key (an
  organisation's Kiro policy, or a file that is not JSON) is refused by the render and by `--apply`
  (exit 3), reported by `--check` as `REFUSE`, and left alone by `--remove` with a `NOTE`.
- **Reported.** `--check` compares it like the other admin documents (`OK`, `STAMP`, `DRIFT`,
  `MISSING`). `install.sh` prints a second Kiro line, `FLOOR   Kiro: admin managed-settings.json n/m
  floor patterns` (or `absent`, `present and NOT managed by this project`, `not read`), which
  `mhw status --verbose` relays.
- **Uninstall.** `--remove` deletes it when it is ours.
- **Windows: not rendered.** The admin-layer installer has no Windows form (ADR-0025). The Windows path
  `C:\ProgramData\Kiro\managed-settings.json` is read by both bundles, and nothing writes it.

### What else reads that file, read from the bundles

- **Kiro's sign-in "login controls"** read the same path, in the IDE and in the Kiro CLI binary
  (`login_controls.rs` in 2.29.1). They act only on rules of capability `signin_method` and on a
  `settings` object. Neither is rendered, so they find nothing to apply. The IDE logs a warning when the
  file has no `rules` array (*"without it the agent refuses every tool call"*); ours always has one.
- **Kiro CLI 2.x** (the Rust engine) reads the path only for login controls, not for permissions, so
  this copy does not reach it either.

### The agent in the V3 form (canary finding 3b)

The 2026-10-11 canary saw Kiro CLI 2.29.1 ask *"Your agent configs are still in the 2.0 format. Upgrade
them to run on 3.0? They'll keep working in 2.0."* for `~/.kiro/agents/workstation.json`. The bundled V3
engine skips a JSON agent that has the 2.0 fields (`allowedTools`, `toolsSettings`) and no
`permissions` block (*read from the bundle*: `kii`, `Eii`, `bii` in kas 2.29.1). The owner ran
`/upgrade-agent`; it kept the 2.0 fields and added a `permissions` block (observed on the reference
machine: the file and its `.bak`).

The renderer (`global/allow-list.sh`) now writes both, so `/upgrade-agent` is not needed: the 2.0
fields unchanged, and `permissions.rules` with the shell allow rule `/upgrade-agent` wrote (`"<words>
*"` and `"<words>"` per trusted command) and `fs_read` allow. The shell rule also carries an `exclude`
list of the characters the 2.x pattern refuses (`;`, `&`, `|`, `<`, `>`, `$`, backtick, parentheses,
braces), so where Kiro matches the command text the V3 allow is not wider than the 2.x one. How V3
splits a command (tree-sitter; substitutions are evaluated as their own commands) is read from the
bundle; whether the redirect text is part of the matched string is **not** established, and no Kiro
build ran the rendered agent.

**A consequence the owner should see.** Kiro IDE 1.2.56 has the same agent loader (the same two field
lists, *read from the IDE bundle*). With the `permissions` block it no longer skips this agent, so the
narrow allow list can reach the IDE when that agent is selected. Option B above (an IDE agent) was
rejected for this record; this happens as a side effect of the V3 form he asked for, and the
`/upgrade-agent` he ran already produced it. If he wants the IDE kept out, the alternative is a second,
V3-only agent file, which the CLI 2.x engine would also list.

### A file Kiro rejects locks Kiro out, and the way back (PR #153 lens, B1)

Read from both bundles: when Kiro cannot parse `managed-settings.json`, or a rule in it breaks the schema,
the error is fatal and Kiro IDE and the Kiro CLI V3 engine **deny every tool call** until the file is
fixed or gone. The same deny-all follows when a compiled Cedar statement of 64 or more conditions fails
Kiro's cedar-wasm probe.

How Kiro counts conditions, read from `Vpd` (IDE 1.2.56) and `yQc` (kas 2.29.1): every match pattern
compiles to **its own** statement, of 1 condition for the pattern, plus 1 per `exclude` entry, plus 1 for
an `ask` rule. So a deny rule with 184 patterns compiles to 184 statements of one condition each, not to
one statement of 184. Splitting the shell rule would not change any count, so it is not split. What can
reach the limit is a long `exclude` list.

The guard, in code:

- `kiro_permissions.py --mode=admin-validate` checks the shape Kiro's parser accepts: the fields,
  `deny` only, string lists, no byte order mark, valid JSON.
- It also refuses any rule whose statements exceed a ceiling of **32** conditions, half of Kiro's 64.
- `install-managed.sh` runs it on the stage before install, and on the installed file in `--check`.
  The latter reports `REFUSE … deny EVERY tool call; --apply rewrites it, --remove deletes it`.
- `admin_doc()` refuses to render over the ceiling.
- The `FLOOR` line reads `INVALID (…)` with the same consequence and the way out.
- The agent's V3 rule has 1 + 11 conditions. `allow-list.test.sh` asserts it stays at or under 32.

A floor that grows cannot silently produce a lockout file: the render or the stage is refused.

**Rollback**, for a lockout from any cause: `sudo /bin/sh global/install-managed.sh --remove`, or delete
that one file as root (`/Library/Application Support/Kiro/managed-settings.json`, or
`/etc/kiro/managed-settings.json` on Linux). Kiro CLI on the 2.x engine, the default, does not read the
file, so it stays usable during a lockout. `docs/runbooks/breaking-glass.md` lists the file.

### Evidence

| Claim | Level |
| --- | --- |
| A Kiro admin document Kiro would reject, or with a statement over the 32-condition ceiling, is refused at render, at `--apply` (with a matching hash) and named by `--check`; the `FLOOR` line names the deny-all | **tested** (`install-managed.test.sh` 3c; `kiro_permissions_test.py` `AdminCopy`), the ceiling mutation-checked; the deny-all and the condition counting are read from the bundles, not measured |
| `install-managed.sh` renders, validates, hashes, installs, checks, refuses beside a foreign file and removes the Kiro admin copy | **tested** under a throwaway `--root` (`global/install-managed.test.sh` 3c, 5b, 6), the install and foreign-file guards mutation-checked |
| The rendered document passes the validation Kiro's bundles apply | **emulated** in the suite from the code read in the IDE 1.2.56 and kas 2.29.1 bundles; no Kiro loaded it |
| `install.sh` counts the admin copy on its `FLOOR` line | **tested** (`global/install-managed.test.sh` 3c; `global/kiro/kiro_permissions_test.py` `AdminCopy`), the count mutation-checked |
| Kiro IDE and the Kiro CLI V3 engine apply it as the administration scope | **read from the bundles**; not measured |
| The V3 agent form loads in the V3 engine and still loads in CLI 2.x | **read from the bundle** and the vendor's own prompt text; the rendered file was not run by any Kiro |
| Installed on the reference machine | **no**. The owner installs the release candidate (`mhw install` asks for the administrator password once) |

Version cut (ADR-0002): **minor**. A new protection layer for a harness; nothing an adopter had is
removed. The status of this record stays **proposed** until the owner ratifies it.

## Amendment 2026-10-11: newline and CR in the V3 `exclude` list (PR #153 QA advisory A1)

The V3 shell rule's `exclude` list above named the characters the 2.x pattern refuses, but not the
newline and CR that the 2.x pattern also refuses. Where Kiro matches the command text, `git status`
followed by a newline and a second command was refused by the 2.x pattern and admitted by the V3 text
glob; it was safe only because V3 splits subcommands (read from the bundle, not run). The list now
carries a newline and a CR too: 13 excludes, 14 conditions per statement, under the ceiling of 32. Test
8b in `global/allow-list.test.sh` adds the newline and CR samples, asserts both entries, and goes red
when either is removed from the renderer (mutation-checked). Still **emulated**; no Kiro ran the
rendered agent.

## Links

- Issue #144 and its 2026-10-11 decision comment. ADR-0016 (the floor), ADR-0027 (the Kiro carriers),
  ADR-0029 (the stamp), ADR-0031 (the allow list), ADR-0008 (no confidential persistence).
- `global/kiro/kiro_permissions.py`, `global/kiro/kiro_permissions_test.py`, `global/install.sh`
  (`kiro_step`), `global/install.test.sh` section 24.
- kiro.dev/docs/permissions and kiro.dev/docs/ide/whats-new-v1/permissions (read 2026-10-11).
