# ADR-0045: One runtime, Node, held by a CI check

- **Status:** proposed
- **Deciders:** the owner (rulings quoted below); written by agents-lead's lane, S32 of #470 ([#502](https://github.com/tedeuxx/mhw/issues/502))
- **Date:** 2026-11-22
- **Amends:** [ADR-0034](0034-npm-distribution-from-github-by-tag.md) (the install needs Node and git only),
  [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md) (the admin hook's interpreter and its residual),
  [ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md) (the wrapper and the hook on Node; Windows
  not measured). ADR-0033's runtime change itself was recorded by its 2026-11-20 amendment (#487, S16) and its
  2026-11-21 amendment (#488, S17); this record cites them and adds only what is new. ADR-0002's bump moved to
  Node in its 2026-11-18 amendment (#473, S02).
- **Requirements:** [`docs/mhw-product-requirements-document-node-runtime.md`](../mhw-product-requirements-document-node-runtime.md) (#470)

## Context and problem

Slices S01 to S31 of #470 moved every mhw command, renderer, hook and CI script from Python, shell and
PowerShell to Node. What remained at the start of S32: seven Python helpers under `test/helpers/` that had
recorded the parity goldens, the retired live-parity CI steps (each now passing because its base no longer
held the original), `setup-python` and a Python compile check in `tests.yml`, `python3` and `jq` items in
`global/prerequisites.json`, `python3` and a dead `pwsh` probe in the closed probe set, and nothing that would
stop a new `.py`, `.sh` or `.ps1` file from landing. The requirements' own acceptance command,
`git ls-files '*.py' '*.sh' '*.ps1'`, fails open on an extensionless script (`./mhw` and
`global/security.test.stub` once were).

## Decision drivers

- One runtime to install, patch and audit on every operating system (D11 of #470: Node 26, `engines.node`).
- A check that cannot stay green while the property is false, with every exception named and dated.
- No widening: nothing here relaxes a permission or a protection.
- The owner's two rulings carried into this slice: «Adiar para a S32» (#494: remove `python3` from the
  prerequisites once the last caller is gone) and «Aceitar agora, travar no fim» (#536: accept the
  owner-writable node now, lock it at the end).

## Considered options

1. **A CI check over the tracked tree and the workflows, with an explicit allowance list (chosen).** It
   catches extensions, `#!` lines and workflow steps; the allowance is a file with a reason per entry, and a
   stale entry is red. *Trade-off:* it reads file names, first lines and workflow text; it does not read
   what a Node program spawns.
2. **The requirements' extension glob alone.** *Rejected:* fails open on an extensionless script, the main
   risk #502 names.
3. **A pre-commit hook.** *Rejected:* a hook is reserved for existential risk on this workstation (ADR-0035),
   and a local hook is skipped by any clone that does not install it.

## Decision outcome

**Option 1.** Concretely:

1. **`runtime-guard`** (a job in `tests.yml`, `.github/scripts/runtime-guard.js`, aggregated by
   `delivery-ci`) fails on any tracked `*.py`, `*.sh`, `*.bash`, `*.zsh`, `*.ps1`, `*.psm1` or `*.psd1`; on
   any tracked regular file whose first line is a `#!` naming `sh`, `bash`, `dash`, `zsh`, `ksh`, `python`
   (any version), `pwsh` or `powershell`, directly or through `env` (`-S`, `-i`, `-u NAME`, `NAME=VALUE`
   skipped); and on any workflow line that names `python`, `pip`, `pwsh`, `powershell` or `bump-my-version`
   as a word, or uses `actions/setup-python`. Comment lines are not read.
2. **The bound of the workflow arm, stated:** a `run:` block runs in the runner's own shell (bash on Linux
   and macOS, pwsh by default on Windows). A `shell:` key that selects that shell is not an invocation and is
   not flagged; the Windows job's npm-package step keeps `shell: pwsh`. What a step runs is checked; which
   shell the runner provides is not.
3. **The allowance** is `.github/runtime-guard-allowance.json`: three fixture files of the reference
   delivery template (`global/project-policy/reference/fixture/*.py`, ADR-0015 lock 4) and two exact lines of
   `reference-delivery-dry-run.yml` that pass the sample consumer's own test command to the reusable gate,
   which runs it inside that consumer's digest-pinned python image. None is mhw's code. An entry that names
   no tracked file, a line that is gone, or an entry the check would not flag fails the check, and
   `test/ci/runtime-guard.test.js` asserts each listed path exists.
4. **Calibration:** the suite plants, in throwaway git repositories, a file of each extension, an
   extensionless script for each interpreter (directly, through `env`, through `env -S`, with a byte-order
   mark and CRLF) and a workflow line of each kind, and requires each alone to turn the check red while a
   clean control beside them stays green.
5. **The recorders are deleted, and the goldens are frozen.** `test/helpers/py-probe.py`, `s15-record.py`,
   `s16-record.py`, `s17-record.py`, `s23-prose.py`, `s24-admin-line.py` and `chrome-debugging-probe.py` are
   removed with the live arms that ran them, and with two CPython oracles that ran inline (the S13
   credential-pattern oracle and the S10 `tomllib` table). The recorded goldens stay as the only oracle and
   are never rewritten from the Node side. The S05 `validate-not-utf8` golden no longer names the recording
   machine's interpreter directory (it reads `<PY>`), and a test fails if any golden names a Homebrew,
   framework, pyenv or `/usr/local` Python path.
6. **The retired live-parity steps go** (S10, S13, S14, S15, S16's parity step, S18, S20 to S31, S27 on
   Windows), with `setup-python`, the Python compile check and the shellcheck step (both had nothing left to
   check). The S16 relay and S17 add-term steps stay: they exercise the vendored pty, not Python.
7. **Prerequisites.** `python3` and `jq` leave `global/prerequisites.json`; `python3` and `pwsh` leave the
   closed probe set (`jq` stays a probe, so another declaration may still name it). mhw needs Node.js 26 or
   later and git. The S23 frozen input drops its `python3` and `pwsh` items, and the two lines the recorded
   transcript printed for them are declared differences in `test/golden/S23/expected-differences.json`.
8. **`.bumpversion.toml` keeps its name.** Nothing runs bump-my-version since #473: the version workflow runs
   `src/commands/release-bump.js`. The file stays because it is the one contract of the cut (its `message`
   is the loop guard of the version workflow, ADR-0002), and seven readers and the frozen S02 and S27
   goldens name it: `release-bump.js`, `src/lib/version.js`, `delivery.js`, `install-user.js`,
   `install-windows.js`, `src/lib/user-layer.js` and `src/render/mcp.js`, plus `package.json`'s `files`.
   Folding it into `package.json` would move all of them and re-record those goldens for no change in
   behaviour; the TOML format is read by the vendored parser already shipped. The name is historical, and
   this record is where that is said.
9. **AGENTS.md** no longer says the checked merge route has never run on a real PR: it has merged real
   slices into `rc/next` (#513 to #529 among them), and no release candidate into `main` yet.

### The lock-in criterion for the owner-writable node (owner ruling «Aceitar agora, travar no fim»)

This criterion is **open**. Locking it needs a choice only the owner can make, so no option is chosen here.

**Acceptance criterion.** Before this record is accepted, each of these three runs a node, libraries and
JavaScript that no process running as the owner can replace, or is refused with a visible line:

1. the node and libraries the **admin-layer prompt hook** names (its JavaScript is already a root-owned copy,
   ADR-0033's 2026-11-21 amendment);
2. the node **and the script** the **sudo apply line** runs:
   `sudo "<process.execPath>" "<package>/bin/mhw.js" install-admin --apply=… --sha256=…` (S26, #496). The
   script and the package it loads are owner-writable today;
3. the **user-level prompt hook's** node, whose trust root is the owner by construction: the user layer
   (`~/.claude/settings.json`, `~/.codex/hooks.json`) is itself owner-writable, so a root-owned node there
   would not make that layer root-owned. The criterion for it is to report, not to lock.

**What is locked now.** The admin hook's JavaScript (root-owned copies), its absolute node path, and the
cleared `NODE_OPTIONS`, `NODE_ICU_DATA`, `NODE_PATH` and `NODE_COMPILE_CACHE` (ADR-0033, 2026-11-21). The
sudo line's stage is pinned by its `--sha256`. Nothing else.

**What stays a residual, dated 2026-11-22.** The admin hook's node and its libraries (on Homebrew, libnode
and about fifteen libraries under `/opt/homebrew`, ADR-0033); the sudo line's node, `bin/mhw.js` and the
package, all owner-writable on a Homebrew or nvm install; and the stage hash, which is computed by the same
owner-writable code that prints the line, so it guards against a stage changed after the line was printed,
not against changed code. Which environment variables macOS `sudo` keeps is not measured (owner check at the
final install: `sudo /usr/bin/env | grep -E '^(PATH|TMPDIR|NODE_)'`).

**How `mhw status` reports it.** Its `hook node` line names every node the installed prompt hooks run (admin
layer first, then the user settings), each as `(owner-writable: …)` or `(not writable by you)`, and `FAIL`
when the node is gone; a hook whose entry or node is gone is a `paste filter … FAIL` item. `mhw install-admin`
prints the same ownership on its `NODE` line before the sudo line; it names the node, which is the file the
sudo line runs, and not the script. **`mhw status` does not report the sudo line**: it is a one-time act, not
installed state.

**Options, open for the owner.** One question at a time, through the escalation rules; not asked here.

- **A. A root-owned, self-contained node in the admin layer.** `--apply` copies an official nodejs.org
  binary, verified against the release's `SHASUMS256.txt`, into the admin root as root, and the admin hook
  and every later sudo line name it. Measured: the official `node-v26.13.1-darwin-arm64` binary links only
  `/System/Library/Frameworks/CoreFoundation`, `Security`, `/usr/lib/libc++.1.dylib` and
  `/usr/lib/libSystem.B.dylib` (`otool -L`, 2026-11-22), all SIP-protected. *Cost:* about 100 MB per
  version under the admin root, a download or bundle route mhw does not have today, and an update duty. The
  first sudo line still runs the owner's node and script once, to install it.
- **B. Refuse an owner-writable node for the admin layer.** `--apply` refuses unless the node and every
  directory above it are root-owned and not writable by the owner (for example, the nodejs.org `.pkg` in
  `/usr/local`). *Cost:* breaking for the reference machine, which runs a Homebrew node; the owner installs
  a second node.
- **C. Keep the accepted residual.** `mhw status` and `install-admin` keep naming it. *Cost:* the gap stays
  open; this record cannot then claim the criterion.

Neither A nor B closes the sudo line's **script**: whatever runs first as root was staged by an owner
process. Closing that needs a root-owned copy of mhw itself, which is its own decision.

## Consequences

- **Good:** a new script of another runtime, or a workflow step that runs one, turns a required check red;
  the exceptions are five named lines; the prerequisites name what mhw actually needs; CI no longer
  installs a Python it does not use.
- **Good:** the goldens are now the only oracle, so a Node change that moves an answer is red with no
  interpreter needed to see it.
- **Bad:** the goldens can no longer be re-recorded. A deliberate change to a recorded answer is a declared
  difference in that slice's `expected-differences.json`, by hand.
- **Bad:** live arms that ran a base revision's deleted original (S10, S13, S14, S18, S20 to S22, S25 to S31)
  are still in the test files. They skip, because no base revision holds an original any more, and they
  are dead code a later cleanup can delete; several still name `python3` in a spawn they never reach.
- **Bad:** the guard reads names, first lines and workflow text. A Node program that spawns `python3` is not
  caught; the hook-path import test (convention 5 of #470) and review hold that.
- **Neutral:** the `shellcheck` job keeps its name (the delivery route reads the job list) and now carries
  only the YAML parse and the Node syntax checks.

## Links

- Issue [#502](https://github.com/tedeuxx/mhw/issues/502) (S32), parent [#470](https://github.com/tedeuxx/mhw/issues/470).
- Owner rulings: [#494](https://github.com/tedeuxx/mhw/issues/494) «Adiar para a S32»;
  [PR #536](https://github.com/tedeuxx/mhw/pull/536#issuecomment-7063304413) «Aceitar agora, travar no fim»;
  the S26 lens carry-along on [PR #548](https://github.com/tedeuxx/mhw/pull/548) (the sudo line).
- Owner residual outside this slice: `overlay/allow-list.conf` holds two dead entries; it is the owner's file.
