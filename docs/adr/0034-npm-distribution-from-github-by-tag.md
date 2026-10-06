# ADR-0034: Distribute the workstation through npm, installed from GitHub by tag

- **Status:** proposed
- **Date:** 2026-10-06
- **Deciders:** the owner (decided on #68, 2026-10-06: *"siga com a adequacao da distribuicao com
  npm"*); written by agents-lead
- **Issues:** [#68](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/68)
  (part of [#52](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/52);
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
   written at package time by a script.
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
  and no lifecycle scripts. A `files` allow list ships what install needs: `workstation`,
  `.bumpversion.toml`, `.workstation-archive`, `bin/workstation.js`, `global/` without its tests,
  `method/` and `overlay/`. An untracked `overlay/mcp-servers.json` and `*.local.json` are excluded by
  name. With `files` set, npm does not apply `.gitignore` (measured: removing the explicit exclusion
  ships the file).
- **Version:** `.bumpversion.toml` rewrites `package.json`'s `version` in the bump commit, so a tag
  `vX.Y.Z` carries `X.Y.Z` (dry run of bump-my-version 1.5.1: `4.0.0` became `4.1.0` in both files).
- **Install:** `npm install -g github:tedeuxx/personal-multi-harness-workstation-configuration#vX.Y.Z`,
  or `#semver:^X.Y.Z` for the newest release in a major. Major means breaking (#52).
- **Launcher:** `bin/workstation.js` resolves paths from its own file, which npm reaches through the
  link. On macOS and Linux it runs the package's `./workstation`. On Windows it maps `install
  [--method] [--overlay=…]` onto `install.ps1`, maps `check` and `status` onto `install.ps1 -Check`,
  answers `update` itself, and refuses `install --admin` and `uninstall`, which do not exist there.
- **Stamp without `.git`:** `.workstation-archive` holds `commit: $Format:%H$` and `describe:
  $Format:%(describe:tags=true,match=v[0-9]*.[0-9]*.[0-9]*)$`. `install.sh` and `install.ps1` map an
  exact tag to `vX.Y.Z`, `vX.Y.Z-N-gSHA` to `unreleased, after vX.Y.Z`, and an empty describe to
  `unreleased, no tag reachable`. They take the file only in exactly that shape; anything else
  (placeholders still present, a stray character) stays `unknown`. An archive is never dirty.
- **Inside another work tree:** both installers use git only when the work-tree top is the
  repository itself. A package under a home directory kept in git no longer borrows that tree's HEAD.
- **Update:** in an npm install (`package.json` present, no `.git`), `workstation update [vX.Y.Z]`
  prints the npm command and `workstation install`, and changes nothing.
- **The admin layer** still needs the owner's `sudo` line, by design.

## Consequences

- Good: one command on a new machine, no clone, and the same stamp and version key as a checkout.
- Good: nothing is published; `private` makes a publish fail.
- Good: the CI suites cover it on Ubuntu, macOS and Windows. They pack a git archive of the head,
  install it globally into a throwaway prefix, and run the installed command.
- Bad: a new dependency, Node.js 18 or later, plus git for npm to resolve the tag.
- Bad: tags before the first release that carries `package.json` cannot be installed with npm. Until
  that release exists, `#semver:^4.0.0` resolves to `v4.0.0`, which has no `package.json`.
- Bad: the archive stamp relies on GitHub's `git archive` behaviour, measured on one day and not
  promised by GitHub. If it changes, installs stamp `unknown`, and `status` shows that.
- Bad: `./workstation` run directly from the package directory works, but npm-mode `update` and the
  Windows mapping exist only through the `workstation` command.

## Links

- Measurements: npm 11.13.0, Node.js 25.9.0, macOS; branch `feat/npm-distribution`.
- [ADR-0029](0029-provenance-stamp-in-every-installed-file.md),
  [ADR-0030](0030-version-key-and-one-entry-point.md), [runbook](../runbooks/npm-install.md).
