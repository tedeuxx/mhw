# Runbook: install and update the workstation with npm

The npm route ([ADR-0034](../adr/0034-npm-distribution-from-github-by-tag.md), Issue #68) installs a
tagged release straight from this GitHub repository. Nothing is published to the npm registry, and the
package is `private`, so `npm publish` refuses it. The package and its command are **`mhw`** (multi-harness
managed workstation); `workstation` is a deprecated alias until the next major and prints one notice.
Every installation on the owner's machine is his act, in a fresh session afterwards.

The install line names this repository by its current name. It changes when the repository is renamed,
which is a separate step.

## Needs

- Node.js 18 or later with npm. Measured with npm 11.13.0.
- git on `PATH`: npm uses it to resolve the tag.
- macOS and Linux: Python 3.9 or later, and `jq`, as for a checkout.
- Windows: Windows PowerShell 5.1 or PowerShell 7.

## Install: npm puts `mhw` on PATH, `mhw install` sets up the workstation

Pick the release and name it. The first installable tag is the first release that carries
`package.json`. Older tags fail with `Could not read package.json` (measured on `v4.0.0`).

```sh
npm install -g github:tedeuxx/mhw#vX.Y.Z
mhw install
```

Since [#113](https://github.com/tedeuxx/mhw/issues/113) npm installs `mhw` like any global package and
installs nothing else. Its `postinstall` (`bin/postinstall.js`) prints one line, on the terminal when
there is one: `mhw X.Y.Z is ready. Run `mhw install` to set up or update this workstation.`

`mhw install` is the one door, in the style of Homebrew's installer:

1. it lists what will change: your settings in Claude Code, Codex and Kiro, and the system-wide
   protections no session can switch off (the admin layer);
2. it waits for RETURN (any other key aborts and changes nothing);
3. when the system-wide protections change, it says why it needs administrator access and lets `sudo`
   ask for your password, once. You never type a `sudo` line yourself;
4. it installs the system-wide protections, then your settings, and checks both;
5. it ends with `Installation successful!` (or `Installation incomplete:` and what to fix) and numbered
   next steps: open new sessions, the paste-cleaning line for your shell startup file when it is not
   there yet, approving the hooks in Codex's `/hooks`, `mhw status`.

`--verbose` shows every line the installers print. `--no-admin` installs your settings only, with no
password. Without a terminal (CI, a pipe, an agent's shell) `mhw install` only says what it would do;
`--yes` skips the question, but the system-wide protections need **your password, typed for that run**
(`mhw` drops any cached `sudo` credential first). With no terminal they stay a next step and the result
reads `Partly installed:` (exit 1), not `Installation successful!`. `mhw install --method` also
renders the working method; once rendered, every later install keeps it current.

## Update

```sh
mhw update            # the newest release in the installed major (major means breaking)
mhw update vX.Y.Z     # a release you name
```

`mhw update` runs the npm update itself (`npm install -g github:tedeuxx/mhw#semver:^X.Y.Z`, with the npm
that sits beside the `node` running `mhw`), then `mhw install` from the new package: the same
conversation as above. When it finds no npm beside `node`, it prints the npm line to run, then
`mhw install`.

**When the postinstall says nothing.** A local dependency, a CI checkout or `npm ci`
(`npm_config_global` not `true`) prints nothing and changes nothing. npm hides a successful lifecycle
script's output (measured, npm 11.13.0); the one line goes to `/dev/tty` when there is one, so it is
seen without `--foreground-scripts`. If it is missed, nothing is lost: `mhw status` says
`installed by npm; the workstation is not set up from it yet … run mhw install`.

**npm's git preparation.** With any lifecycle script, npm 11.13.0 prepares a git dependency by running
`npm install --force` inside a temporary clone with the outer `--global` inherited. That inner run links
the clone into the global prefix, and the outer install then unpacks through the link into a directory
npm deletes: a dangling install (measured). The postinstall recognises that inner run (`_PACOTE_NO_PREPARE_`
in its environment) and puts an empty directory back where the link was, touching only
a link that resolves to its own clone. This rests on npm internals: re-measure on a new npm major.

## Ignore-scripts

With `--ignore-scripts` (or `ignore-scripts=true` in an npmrc) nothing runs:

- **From GitHub the install fails** (`git dep preparation failed`, `ENOTDIR`) and leaves a dangling `mhw`
  link, because only the postinstall undoes the git preparation's link (measured, npm 11.13.0). Install
  again without it; that replaces the link.
- **From a packed tarball** the install succeeds; only the one postinstall line is missing. Run
  `mhw install` as usual.

## Upgrade from v4.1.0

v4.1.0's package was named `personal-multi-harness-workstation-configuration` with the bin `workstation`,
and `mhw` keeps `workstation` as its alias, so npm refuses `mhw` while the old package owns that name.
**remove the v4.1.0 package first: `npm uninstall -g personal-multi-harness-workstation-configuration`**, then install `mhw`:

```sh
npm uninstall -g personal-multi-harness-workstation-configuration
npm install -g github:tedeuxx/mhw#vX.Y.Z
mhw install
```

The user layer stays in place throughout and `mhw install` then updates it.
Do not use `--force`. v4.1.0's own `workstation update` prints an install line without this step; it fails
the same way.

~~From GitHub the same npm line upgrades: the git preparation's `install --force` hands the `workstation`
link to `mhw`, and the old package stays installed beside it (measured).~~ *(Struck 2026-10-06: measured
true only for a pinned commit. From a tag or branch ref, `npm install -g` fails with `EEXIST` on
`bin/workstation` before any script runs, and changes nothing; reproduced on `#rc/next`.)*

If both packages end up installed anyway, `mhw status` and `mhw check` say so with the same instruction:

```
  npm              the v4.1.0 package (the name before mhw) is still installed beside mhw; remove the v4.1.0 package first: …
```

## Windows

`mhw` runs `global\install.ps1`. `install`, `install --method` and `--overlay=DIR|none` map onto
`install.ps1`, `-Method` and `-Overlay`. `check` and `status` both run `install.ps1 -Check`. `update`
prints the npm command, then `mhw install`. `install --admin` and `uninstall` do not exist on Windows and
are refused with exit 2. As on macOS and Linux, the postinstall installs nothing and names `mhw install`;
there is no admin layer, no install conversation and no runtime summary on Windows yet. Exercised in CI
only.

## Check what was installed

The installed package has no `.git`. Its provenance comes from `.workstation-archive`, which GitHub's
archive fills in with the commit and its `git describe`:

```sh
cat "$(npm root -g)/mhw/.workstation-archive"
```

If that file still shows `$Format:` placeholders, the package came from a clone rather than GitHub's
archive (a `git+file:` or mirror URL). The installers then stamp `release: unknown, not a git checkout`,
and `status` shows it.

## Local edits are not detected

An npm install cannot detect edits to the installed package. A git checkout can: its stamp reads
`-dirty`. Here the stamp keeps reading the clean release and `check` passes, because it compares the
installed files with the package itself (measured, ADR-0034). npm keeps no integrity record for a git
dependency. If you suspect the package was changed, reinstall the tag with `npm install -g …#vX.Y.Z`, then `mhw install`.

## Do not

- Do not add a lifecycle script other than `postinstall`, and do not remove the postinstall's handling of
  npm's git preparation: without it a global git install is a dangling link (measured; ADR-0034). Do not
  make it install anything again: `mhw install` is the one door (#113).
- Do not run `npm publish` or `npm login`. The registry is not a distribution route here.
- Do not run `npm install -g` as root, or `sudo npm`. `mhw install` asks for administrator access
  itself, only for the admin layer.

## Remove

npm runs no uninstall script on `npm uninstall -g` (measured with npm 11.13.0: `preuninstall`,
`uninstall` and `postuninstall` all stayed silent). So remove the resources first. `mhw uninstall` runs a
script inside the package, so run it before `npm uninstall -g` deletes the package:

```sh
mhw uninstall                 # 1. the same conversation as install: RETURN, the password once, both layers
npm uninstall -g mhw          # 2. only then remove the package (its last next step says so)
```

**Not detected:** after `npm uninstall -g mhw` alone, every user-level resource stays installed and keeps
working (nothing installed runs from the package; measured, only two Claude Code `Edit(...)` deny
rules name paths inside it, and they go inert), and no `mhw` command is left to report it. A
checkout's `./mhw status` still shows the installed stamps. To remove them, reinstall the same tag, run
`mhw uninstall`, then remove the package.
