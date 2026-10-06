# ADR-0034: Distribute the workstation through npm, installed from GitHub by tag

- **Status:** proposed
- **Date:** 2026-10-06
- **Deciders:** the owner (decided on #68, 2026-10-06: *"siga com a adequacao da distribuicao com
  npm"*); written by agents-lead
- **Issues:** [#68](https://github.com/tedeuxx/mhw/issues/68), [#113](https://github.com/tedeuxx/mhw/issues/113)
  (part of [#52](https://github.com/tedeuxx/mhw/issues/52);
  requirements document, section 9b)

## Context and problem

`./workstation` ([ADR-0030](0030-version-key-and-one-entry-point.md)) needs a git clone. Issue #68
asked for an easier route and listed four options without choosing. The owner chose npm, installed
straight from this GitHub repository by tag, with nothing published to the public npm registry.

Three facts shape the design. All three were measured with npm 11.13.0 on macOS against a branch of
this repository.

1. **An npm install has no `.git`.** For a `github:` spec, npm resolves the ref to a commit, downloads
   GitHub's source archive for that commit and unpacks it. The provenance stamp
   ([ADR-0029](0029-provenance-stamp-in-every-installed-file.md)) reads release and commit from git,
   so without a fix every npm install would stamp `unknown`.
2. **No lifecycle script survives a global git install.** With a `prepare` script, npm runs an inner
   `npm install` in the unpacked archive. That inner run inherits `--global` and the prefix, links the
   temporary directory into the global prefix, and npm then deletes the directory. What remains is a
   dangling `workstation` link. With no script, npm installs a real directory. So the stamp cannot be
   written at package time by a script. ~~No lifecycle script survives~~ *(amended 2026-10-06, below:
   a `postinstall` survives once it undoes the inner run's link; the stamp conclusion stands)*
3. **GitHub's archive honours `export-subst`.** A file marked `export-subst` in `.gitattributes` has
   its `$Format:…$` placeholders filled in by `git archive`, which builds GitHub's tarballs. Installed
   from the branch at `e7c6bf6`, `.workstation-archive` arrived as `commit: e7c6bf6…` and
   `describe: v4.0.0-4-ge7c6bf6`.

The decision adds a distribution route and a dependency (Node.js and npm), so a record is owed.

## Decision drivers

- One release source: the git tags that CI cuts ([ADR-0002](0002-automatic-semver-cut-policy.md)).
  The npm version is never a second source.
- No public registry, no publication credential, no accidental publish.
- The stamp keeps its rule and its evidence level in the npm install.
- Native mechanisms first: npm's own `github:` spec and `bin` links, and git's own `export-subst`.
- Windows uses the PowerShell installer that already exists.

## Considered options

1. **npm from GitHub by tag, with an archive stamp (chosen).** *Trade-off:* needs Node.js 18 or
   later and git. The stamp depends on GitHub keeping `export-subst` in its archives, which git
   documents but GitHub does not promise. An install from a plain clone URL (`git+file:`, a mirror)
   gets a clone, not an archive, and stamps `unknown`.
2. **npm with a `prepare` script that writes the stamp.** *Trade-off:* breaks the global install on
   the measured npm (fact 2). Built first, measured broken, and withdrawn in this slice.
3. **A Homebrew tap or a release archive with a checksum.** *Trade-off:* macOS-first, or a release
   asset to build and sign; more machinery than the owner asked for.
4. **A one-line bootstrap that clones and installs.** *Trade-off:* the familiar pipe-to-shell
   pattern; the owner chose npm.

## Decision outcome

Option 1.

- **Package:** `package.json` with `"private": true`, so `npm publish` refuses. It has no dependencies
  and ~~no lifecycle scripts~~ one lifecycle script, `postinstall` (2026-10-06 amendment). A `files`
  allow list ships what install needs: ~~`workstation`~~ `mhw`, `workstation` (the deprecated alias),
  `.bumpversion.toml`, `.workstation-archive`, `bin/workstation.js`, `global/` without its tests,
  `method/` and `overlay/`. An untracked `overlay/mcp-servers.json` and `*.local.json` are excluded by
  name. With `files` set, npm does not apply `.gitignore` (measured: removing the explicit exclusion
  ships the file).
- **Version:** `.bumpversion.toml` rewrites `package.json`'s `version` in the bump commit, so a tag
  `vX.Y.Z` carries `X.Y.Z` (dry run of bump-my-version 1.5.1: `4.0.0` became `4.1.0` in both files).
- **Install:** ~~`npm install -g github:tedeuxx/mhw#vX.Y.Z`~~
  `npm install -g --foreground-scripts github:tedeuxx/mhw#vX.Y.Z`
  (flag added 2026-10-06, so the postinstall's output is shown),
  or `#semver:^X.Y.Z` for the newest release in a major. Major means breaking (#52).
- **Launcher:** ~~`bin/workstation.js`~~ `bin/mhw.js` (2026-10-06 amendment) resolves paths from its own file, which npm reaches through the
  link. On macOS and Linux it runs the package's ~~`./workstation`~~ `./mhw`. On Windows it maps `install
  [--method] [--overlay=…]` onto `install.ps1`, maps `check` and `status` onto `install.ps1 -Check`,
  answers `update` itself, and refuses `install --admin` and `uninstall`, which do not exist there.
- **Stamp without `.git`:** `.workstation-archive` holds `commit: $Format:%H$` and `describe:
  $Format:%(describe:tags=true,match=v[0-9]*.[0-9]*.[0-9]*)$`. `install.sh` and `install.ps1` map an
  exact tag to `vX.Y.Z`, `vX.Y.Z-N-gSHA` to `unreleased, after vX.Y.Z`, and an empty describe to
  `unreleased, no tag reachable`. They take the file only in exactly that shape; anything else
  (placeholders still present, a stray character) stays `unknown`. The stamp never carries `-dirty`,
  so it says nothing about edits made after install (see Consequences).
- **Inside another work tree:** both installers use git only when the work-tree top is the
  repository itself. A package under a home directory kept in git no longer borrows that tree's HEAD.
- **Update:** in an npm install (`package.json` present, no `.git`), `workstation update [vX.Y.Z]`
  prints the npm command ~~and `workstation install`~~, and changes nothing. *(2026-10-06: `mhw
  update`; the npm line alone installs, through the postinstall.)*
- **The admin layer** still needs the owner's `sudo` line, by design.

## Consequences

- Good: one command on a new machine and no clone. For an unmodified package, the stamp and version
  key are the same as a checkout at the same commit (measured: all 13 rendered stamps were identical).
- Bad: an npm install cannot detect local edits to the installed package; a git checkout can.
  Measured by removing a deny-floor rule from `global/deny-floor.conf`, then reinstalling:
  - in a checkout, the stamp reads `commit: …-dirty`;
  - in the npm package, the stamp still reads the clean release, with no `-dirty`.
  `check` exits 0 in both cases, because it compares the installed files with the edited source. npm
  keeps no integrity record for a git dependency (it warns `skipping integrity check for git
  dependency`). `.workstation-archive` does not change when other files are edited. The admin layer's
  `sudo` line runs `install-managed.sh` from the same, user-writable package path. To recover,
  reinstall the tag. A possible follow-up, not built: `check` downloads GitHub's archive for the
  stamped commit and compares the package against it. That adds a network dependency to `check`. A
  manifest kept inside the package would not help, because it can be edited with the package.
- Good: nothing is published; `private` makes a publish fail.
- Good: the CI suites cover it on Ubuntu, macOS and Windows. They pack a git archive of the head,
  install it globally into a throwaway prefix, and run the installed command.
- Bad: a new dependency, Node.js 18 or later, plus git for npm to resolve the tag.
- Bad: tags before the first release that carries `package.json` cannot be installed with npm. Until
  that release exists, `#semver:^4.0.0` resolves to `v4.0.0`, which has no `package.json`.
- Bad: the archive stamp relies on GitHub's `git archive` behaviour, measured on one day and not
  promised by GitHub. If it changes, installs stamp `unknown`, and `status` shows that.
- Bad: ~~`./workstation`~~ `./mhw` run directly from the package directory works, but npm-mode `update` and the
  Windows mapping exist only through the ~~`workstation`~~ `mhw` command.

## Amendment 2026-10-06: npm manages every user-level resource, and the command is `mhw`

**Owner, 2026-10-06, on #68:** *"a minha expectativa nao era que o npm apenas exportasse o script de
instalacao e gerenciamento. a expectativa é que todos recursos de managed workstation instalados na
maquina fossem gerenciados pelo npm diretamente."* Agreed design: `npm install -g --foreground-scripts …#vX.Y.Z` installs and
updates every user-level resource through a `postinstall`, with no separate install step. The same day he
renamed the package and the command `mhw` (multi-harness managed workstation), keeping `workstation` as a
deprecated alias for one minor. The repository rename is a separate step; the install line keeps the
current repository name until then.

### What was measured (npm 11.13.0, Node.js 25.9.0, macOS; throwaway prefixes, caches and HOMEs)

- **Fact 2 still holds, and its cause is narrower than stated.** pacote prepares a git dependency when
  `package.json` carries any of `prepare`, `postinstall`, `preinstall`, `install`, `build` or `prepack`. It
  runs `npm install --force` in a temporary clone with the outer `npm_config_global=true` in its
  environment, so the clone is linked into the global prefix. Measured on a minimal package with only a
  `postinstall`, installed from `git+file://`: the install failed and left a dangling link.
- **The postinstall can put it right.** The inner run executes the postinstall too, inside the clone,
  with `_PACOTE_NO_PREPARE_` set. Replacing the link with an empty directory there lets the outer
  install unpack into a real directory. Measured from GitHub at the branch head: a real `mhw` directory,
  the user layer installed, the stamp `unreleased, after v4.1.0; commit: <head>`.
- **npm hides a successful script's output** unless `--foreground-scripts` is given or the script fails.
- **npm runs no uninstall script:** `preuninstall`, `uninstall` and `postuninstall` all stayed silent on
  `npm uninstall -g`.
- **`--ignore-scripts` breaks a git install:** the git preparation still links the clone, nothing undoes
  it, and the install fails with `ENOTDIR`, leaving a dangling link. From a tarball it installs and runs
  nothing.
- **A renamed package collides on its alias bin.** From a tarball, npm refuses the second package's
  `workstation` bin with `EEXIST`. ~~From GitHub, the git preparation's `--force` takes the bin over and the
  v4.1.0 package stays installed beside `mhw`.~~ *(Struck 2026-10-06, lens on RC #108: true only for a
  pinned commit. From a tag or branch ref, npm fails with `EEXIST` before any script runs; reproduced.)*
  The upgrade is therefore: remove the v4.1.0 package first: `npm uninstall -g personal-multi-harness-workstation-configuration`, then install `mhw`.
- **A config of npm's own namespace warns.** `npm_config_workstation_method` and `--workstation-method`
  print `Unknown … config`, and the flag swallowed the next argument.

### Considered options

1. **A `postinstall` that undoes the git preparation's link, then installs (chosen).** *Trade-off:* it
   rests on pacote internals (`_PACOTE_NO_PREPARE_`, the inner `--force` global run), which a new npm
   can change; `--ignore-scripts` turns a GitHub install into a failure rather than a no-op.
2. **Install line on GitHub's tarball URL** (`npm install -g --foreground-scripts https://codeload.github.com/…/tar.gz/vX.Y.Z`).
   A remote tarball is not a git dependency, so there is no preparation, no link to undo, and
   `--ignore-scripts` would install cleanly and let `status` report it. *Trade-off:* a longer line and no
   `#semver:` range; the owner kept the `github:` line, so it is not taken here. It is the fallback if a
   future npm breaks option 1.
3. **No lifecycle script; the command installs on first run.** *Trade-off:* npm would still only deliver
   the script, which is the expectation the owner rejected.
4. **`preuninstall` to remove the resources.** Not available: npm 7 and later run no uninstall script,
   and npm 11.13.0 was measured running none.

### Decision

- `package.json`: `"name": "mhw"`, `"description": "multi-harness managed workstation"`, bins `mhw` and
  `workstation` (the alias), and `"scripts": {"postinstall": "node bin/postinstall.js"}`.
- *(Superseded by the amendment "the install conversation", Issue #113, below: the postinstall
  installs nothing, and `mhw install` asks for the password itself.)*
  `bin/postinstall.js` installs only for a global install running from the installed copy; npm's git
  preparation run puts the link back and installs nothing; any other run (local dependency, CI, `npm
  ci`) prints why it skipped. It runs `mhw postinstall`, the same path as `mhw install`, with stdin
  closed and never `sudo`. At the end: the admin `sudo` line when the admin layer is absent or stale
  (the #102 detection), the fresh-session reminder and the runtime summary, written to `/dev/tty` when
  there is one. ~~Its exit code is the user-layer install's only.~~ *(Struck 2026-10-06, Issue #110: npm
  rolls a global install back on any non-zero lifecycle exit, which deleted the package whose `sudo` path
  the report had printed. The postinstall now always exits 0 on a global install, and a non-zero
  user-layer install is reported as an `ACTION` line naming its code. Exit status no longer signals a
  refused or partial install: `mhw check` does. The prepare and skip runs already exited 0 and are
  unchanged.)*
- `MHW_METHOD=1` in the environment is the `--method` opt-in for the npm route.
- `mhw status` and `mhw check` report `installed by npm but postinstall did not run` when the user layer
  does not carry the package's stamp, and name a v4.1.0 package left beside `mhw`.
- Removal is `mhw uninstall` before `npm uninstall -g mhw`.
- The allow list refuses the `mhw` and `workstation` commands, as it refused `./workstation`
  ([ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md)).

### Consequences

- ~~Good: one npm line installs and updates the user layer; the admin layer stays the owner's `sudo` line.~~
  *(Struck 2026-10-06, Issue #113: npm installs the command, `mhw install` installs both layers.)*
- Good: the CI suites install through the git preparation route (`git+file://`), from a tarball, with
  `--ignore-scripts`, as a local dependency and over a v4.1.0-shaped package, and each property was
  mutation-checked (a mutant of the source turns its test red).
- Bad: the git-preparation repair depends on npm internals; re-measure it on every new npm major.
- Bad: `--ignore-scripts` fails a GitHub install and leaves a dangling link (recovery: install again
  without it).
- Bad: output is invisible without a terminal unless `--foreground-scripts` is given; `/dev/tty` was not
  measured from an interactive terminal. So every documented install and update line, and the line
  `mhw update` prints, carries `--foreground-scripts` (lens advisory on PR #106), and `mhw status`
  repeats the admin step (`mhw install --admin`) while the admin layer is absent or stale.
- Bad: after `npm uninstall -g mhw` alone the resources stay, and no command is left to say so.
- ~~Bad: after upgrading from v4.1.0, removing the old package also deletes the `workstation` link until
  the npm line runs once more.~~ *(Struck 2026-10-06: superseded by the order below.)*
- Bad: the upgrade from v4.1.0 is two commands, and npm's `EEXIST` is the first thing a reader who skips
  the instruction sees. Rejected alternative: drop the `workstation` bin from `mhw`, so nothing collides.
  Then `workstation` would keep running v4.1.0's code until the old package is removed, and a habitual
  `workstation install` would put the v4.1.0 user layer back over `mhw`'s: a silent downgrade, worse than a
  loud refusal. `--force` is not documented for the same reason (it overwrites without saying what).
- Evidence: written and probed in throwaway prefixes and HOMEs; not installed on the reference machine.

## Amendment 2026-10-06: the install conversation (`mhw` is the one door)

- **Status:** proposed (the owner asked for the implementation on #113; the direction below was
  written as "proposed, not ratified" there and is ratified only by his word on this record)
- **Issue:** [#113](https://github.com/tedeuxx/mhw/issues/113), follow-up to
  [#110](https://github.com/tedeuxx/mhw/issues/110)

**Owner, 2026-10-06, on #113:** *"eu achei ruim como saiu o output para o usuario saber o que precisa
fazer. a ux do processo de instalacao ainda esta ruim."* · *"eu nao deveria pedir diretamente o sudo
comnado para o usuario"* · *"vc deveria iniciar pelo mhw toda interacao do usuario (UX) e pedir
privilegio administrativo por tras se necessario para algum ponto"* · *"precisamos pensar em algo
amigavel e auto-explicativo para usuario"*, with Homebrew and npm as references. Installing straight
from GitHub stays as it is; the scope is the output shown and the extra actions asked of the user.

### Context

v4.2.1's npm install printed about 40 lines: seven action labels in no order, a final `ACTION` line that
contradicted the `sudo` step, and internal terms (`STAGED`, `FLOOR`, "narrow tier", ADR numbers). The
reader had to copy a `sudo /bin/sh … --apply=… --sha256=…` line by hand, then run `mhw install` again.

### Considered options

1. **npm installs silently; `mhw install` is the one door, Homebrew-style (chosen).** It lists what will
   change, waits for RETURN, asks for the password once through `sudo` (explaining why), installs the
   admin layer and then the user layer, and ends with `Installation successful!` and numbered next steps.
   The installers' own lines move behind `--verbose`; a `REFUSE` line is always shown. *Trade-off:* two
   commands instead of one npm line, and `mhw` now runs `sudo` itself, which reverses "never sudo".
2. **Keep the postinstall installing, with a shorter report.** *Trade-off:* a lifecycle script has no
   terminal on stdin, so it cannot ask for RETURN or a password, and the `sudo` line stays the reader's
   chore; npm hides the output without `--foreground-scripts`.
3. **The postinstall runs `sudo` from `/dev/tty`.** *Trade-off:* a password prompt in the middle of an npm
   install, which npm users do not expect, and nothing to show when there is no terminal.

### Decision

- `bin/postinstall.js` installs nothing. On a global install it prints one line naming `mhw install`
  (to `/dev/tty` when there is one) and exits 0; npm's git-preparation repair stays; the skip runs are
  silent. `MHW_METHOD` is gone with it: `mhw install --method` is the opt-in.
- `mhw install` (macOS and Linux) is a conversation: the plan, RETURN (any other key aborts, exit 1);
  only when the admin layer changes, a sentence saying why the password is needed, then the admin stage
  rendered as the owner and installed with one
  `sudo -k -p … /bin/sh install-managed.sh --apply=STAGE --sha256=HEX` call; then the user layer, then
  both checks; the result and numbered next steps, including the acts `install.sh` names for the
  owner (the paste-wrapper shell line, Codex `/hooks`). `--verbose`, `--yes`, `--no-admin` and
  `--admin` (that layer only).
- **The barrier is the password, asked every time.** `mhw` runs the admin step itself as one
  `sudo -k -p … /bin/sh install-managed.sh --apply=… --sha256=…` (and `--remove`), which ignores any
  cached credential, so the password prompt covers that exact command. (A first fix ran `sudo -k -v`
  then `sudo -n`; with `-k` sudo does not cache, per its manual, so the second call would fail: found by
  the PR #114 lens and gate, documented, not measured.) A terminal alone is not the
  barrier: an agent can fake one (`script -q /dev/null mhw install --yes` reports a tty, measured by the
  PR #114 lens), and then meets a password prompt it cannot answer. With no terminal at all, `sudo` is
  not run. The deny floor's `sudo` rule still keeps agents from typing `sudo` themselves; it does not see
  `sudo` started by `mhw`. Not measured: a passwordless `sudo` rule (NOPASSWD) for the owner would remove
  this barrier.
- When the plan listed the admin layer and it was not installed (no terminal, password refused), the
  result is `Partly installed:` and exit 1, never `Installation successful!`; an uninstall that leaves it
  reads `Partly removed:`, exits 1 and holds back `npm uninstall -g mhw`, which would delete the only tool
  able to remove it (PR #114 lens).
- `mhw update` in an npm install runs the npm update with the npm beside the `node` running `mhw` (by
  absolute path), then `mhw install` from the new package. `mhw uninstall` is the same conversation.
- Messages are in English, like every published artifact of this repository.
- Windows keeps `install.ps1` with no conversation and no admin layer, as before.

### Consequences

- Good: the reader meets one command, a plan, one question and one password prompt, and never copies a
  `sudo` line. A default install prints about a dozen lines.
- Good: tested in throwaway HOMEs and admin roots, through npm from a tarball and from `git+file://`, and
  in a pseudo-terminal (RETURN installs, another key aborts and writes nothing).
- Bad: `mhw` now runs `sudo`. Bounded: only for `install-managed.sh --apply` or `--remove`, after
  RETURN (or `--yes`) and a freshly typed password; the stage is hashed before `sudo` runs it, as before.
  The script `sudo` runs sits in the owner-writable npm prefix, as the printed line did before; the owner
  no longer sees that command, only `--verbose` shows it.
- Bad: the password is asked on every run that changes the admin layer, even seconds after another
  `sudo`: the price of not trusting a cached credential.
- Bad: the real `sudo` password prompt is exercised by no test (the tests use the admin-root override);
  it is unmeasured until the owner's install of the release.
- Bad: two commands to install from npm (`npm install -g …`, `mhw install`), as with any tool whose setup
  needs the user's consent.

## Links

- Measurements: npm 11.13.0, Node.js 25.9.0, macOS; branches `feat/npm-distribution` and
  `feat/npm-managed-install` (2026-10-06 amendment).
- [ADR-0029](0029-provenance-stamp-in-every-installed-file.md),
  [ADR-0030](0030-version-key-and-one-entry-point.md), [runbook](../runbooks/npm-install.md).
