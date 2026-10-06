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

## Install and update: one npm line

Pick the release and name it. The first installable tag is the first release that carries
`package.json`. Older tags fail with `Could not read package.json` (measured on `v4.0.0`).

```sh
npm install -g --foreground-scripts github:tedeuxx/mhw#vX.Y.Z
```

That line is the install and the update. The package's `postinstall` (`bin/postinstall.js`) runs the same
path as `mhw install`: non-interactive (stdin closed), idempotent, never `sudo`, never an admin path. At
the end it prints three things:

1. the admin layer's one `sudo` line, when that layer is absent or differs from the package (the same
   detection as `mhw check`, Issue #102). Run it yourself, then `mhw install` once more, as the line
   after it says;
2. a reminder to open fresh agent harness sessions: a running session keeps the configuration it
   started with;
3. the runtime summary (`mhw status --summary`).

`#semver:^X.Y.Z` instead of `#vX.Y.Z` takes the newest release in that major (major means breaking).
`mhw update` prints that line for the installed major, or for a tag you name.

**Where the output goes.** npm hides a successful lifecycle script's output (measured, npm 11.13.0). The
postinstall therefore writes its report to the terminal (`/dev/tty`) when there is one; with no terminal
(CI, a pipe) it goes to npm, which shows it only with `--foreground-scripts` or on failure. Not measured
in an interactive terminal from here, so **every documented install and update line carries
`--foreground-scripts`**, and `mhw update` prints it that way. If the output was missed, `mhw status` repeats the admin step: it prints the next step, `mhw install --admin` and its `sudo` line, while the admin layer is absent or stale.

**The working method.** Opt-in, as with `mhw install --method`: `MHW_METHOD=1 npm install -g --foreground-scripts …`. Once
rendered, every later install keeps it current. (An `npm_config_*` variable or a `--workstation-method`
flag would make npm warn about an unknown config, measured; `--workstation-method` also swallowed the
next argument.)

**When it installs nothing.** The postinstall installs only for a global install, from the installed
copy. A local dependency, a CI checkout or `npm ci` (`npm_config_global` not `true`) prints
`mhw postinstall: SKIP not a global install …` and changes nothing.

**npm's git preparation.** With any lifecycle script, npm 11.13.0 prepares a git dependency by running
`npm install --force` inside a temporary clone with the outer `--global` inherited. That inner run links
the clone into the global prefix, and the outer install then unpacks through the link into a directory
npm deletes: a dangling install (measured). The postinstall recognises that inner run (`_PACOTE_NO_PREPARE_`
in its environment), installs nothing, and puts an empty directory back where the link was, touching only
a link that resolves to its own clone. This rests on npm internals: re-measure on a new npm major.

## Ignore-scripts

With `--ignore-scripts` (or `ignore-scripts=true` in an npmrc) nothing runs:

- **From GitHub the install fails** (`git dep preparation failed`, `ENOTDIR`) and leaves a dangling `mhw`
  link, because only the postinstall undoes the git preparation's link (measured, npm 11.13.0). Install
  again without it; that replaces the link.
- **From a packed tarball** the install succeeds and installs no resource. `mhw status` then reports
  `installed by npm but postinstall did not run`, and `mhw check` prints the same line and exits non-zero.
  Run `mhw install`.

## Upgrade from v4.1.0

v4.1.0's package was named `personal-multi-harness-workstation-configuration` with the bin `workstation`.
From GitHub the same npm line upgrades: the git preparation's `install --force` hands the `workstation`
link to `mhw`, and the old package stays installed beside it (measured). `mhw status` then says:

```
  npm              a second global package, personal-multi-harness-workstation-configuration v4.1.0 (the name before mhw), …
```

Remove it with `npm uninstall -g personal-multi-harness-workstation-configuration`. That also deletes the
`workstation` link, so run the npm line once more to restore the alias. The user layer stays throughout.
From a packed tarball instead, npm refuses the second package's `workstation` bin with `EEXIST` and
changes nothing; remove the old package first.

## Windows

`mhw` runs `global\install.ps1`. `install`, `install --method` and `--overlay=DIR|none` map onto
`install.ps1`, `-Method` and `-Overlay`. `check` and `status` both run `install.ps1 -Check`. `update`
prints the npm command. `install --admin` and `uninstall` do not exist on Windows and are refused with
exit 2. The postinstall runs `install.ps1` and prints the fresh-session reminder; there is no admin layer
and no runtime summary on Windows. Exercised in CI only.

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
dependency. If you suspect the package was changed, reinstall the tag with `npm install -g --foreground-scripts …#vX.Y.Z`.

## Do not

- Do not add a lifecycle script other than `postinstall`, and do not remove the postinstall's handling of
  npm's git preparation: without it a global git install is a dangling link (measured; ADR-0034).
- Do not run `npm publish` or `npm login`. The registry is not a distribution route here.
- Do not run `npm install -g` as root, or `sudo npm`. The admin layer has its own `sudo` line.

## Remove

npm runs no uninstall script on `npm uninstall -g` (measured with npm 11.13.0: `preuninstall`,
`uninstall` and `postuninstall` all stayed silent). So remove the resources first, in this order. The
admin layer's `sudo` line runs a script inside the package, so run it before `npm uninstall -g` deletes
the package:

```sh
mhw uninstall                 # 1. macOS and Linux: removes the user layer; prints the admin layer's RUN sudo line
sudo /bin/sh "…/global/install-managed.sh" --remove   # 2. that printed line, exactly as printed, run yourself
npm uninstall -g mhw          # 3. only then remove the package
```

**Not detected:** after `npm uninstall -g mhw` alone, every user-level resource stays installed and keeps
working (nothing installed runs from the package; measured, only two Claude Code `Edit(...)` deny
rules name paths inside it, and they go inert), and no `mhw` command is left to report it. A
checkout's `./mhw status` still shows the installed stamps. To remove them, reinstall the same tag, run
`mhw uninstall`, then remove the package.
