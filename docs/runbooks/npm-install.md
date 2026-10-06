# Runbook: install and update the workstation with npm

The npm route ([ADR-0034](../adr/0034-npm-distribution-from-github-by-tag.md), Issue #68) installs a
tagged release straight from this GitHub repository. Nothing is published to the npm registry, and the
package is `private`, so `npm publish` refuses it. Every installation on the owner's machine is his act,
in a fresh session afterwards.

## Needs

- Node.js 18 or later with npm. Measured with npm 11.13.0.
- git on `PATH`: npm uses it to resolve the tag.
- macOS and Linux: Python 3.9 or later, and `jq`, as for a checkout.
- Windows: Windows PowerShell 5.1 or PowerShell 7.

## Install

Pick the release and name it. The first installable tag is the first release that carries
`package.json`. Older tags fail with `Could not read package.json` (measured on `v4.0.0`).

```sh
npm install -g github:tedeuxx/personal-multi-harness-workstation-configuration#vX.Y.Z
workstation install --admin   # macOS and Linux: prints the one sudo line; run it yourself
workstation install           # the user layer, every agent harness
workstation status            # the source line names the release and commit the package was built from
```

`#semver:^X.Y.Z` instead of `#vX.Y.Z` takes the newest release in that major (major means breaking).

## Update

```sh
workstation update            # prints the npm command for the newest release in the installed major
workstation update vX.Y.Z     # prints it for that tag
```

In an npm install, `update` changes nothing: it prints the `npm install -g …` line and `workstation
install`, and you run both. A new major is installed by naming its tag. Then reinstall the admin layer
if `status` says it differs.

## Windows

`workstation` runs `global\install.ps1`. `install`, `install --method` and `--overlay=DIR|none` map onto
`install.ps1`, `-Method` and `-Overlay`. `check` and `status` both run `install.ps1 -Check`. `update`
prints the npm command. `install --admin` and `uninstall` do not exist on Windows and are refused with
exit 2.

## Check what was installed

The installed package has no `.git`. Its provenance comes from `.workstation-archive`, which GitHub's
archive fills in with the commit and its `git describe`:

```sh
cat "$(npm root -g)/personal-multi-harness-workstation-configuration/.workstation-archive"
```

If that file still shows `$Format:` placeholders, the package came from a clone rather than GitHub's
archive (a `git+file:` or mirror URL). The installers then stamp `release: unknown, not a git checkout`,
and `status` shows it.

## Do not

- Do not add a `prepare`, `install` or `postinstall` script. With any of them, npm 11.13.0 left a global
  git install as a dangling link into its cache (measured; ADR-0034).
- Do not run `npm publish` or `npm login`. The registry is not a distribution route here.
- Do not run `npm install -g` as root. The admin layer has its own `sudo` line.

## Remove

```sh
workstation uninstall         # macOS and Linux: the user layer; prints the admin layer's sudo line
npm uninstall -g personal-multi-harness-workstation-configuration
```
