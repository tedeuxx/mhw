# Install on another workstation

This repository already installs part of the workstation policy and compiles a portable preference
profile. The unified commands, MCP management, pre-authorizations and native model/effort workflow is still a
[proposed design](adr/0018-portable-personal-profile-and-unified-harness-management.md).
The commands below install only the existing components described in the [README](../README.md#install).

## Obtain and review the source

```sh
git clone https://github.com/tedeuxx/mhw.git
cd mhw
```

Choose a reviewed release tag before applying configuration. Review the README's component and OS
coverage. Git, the intended harnesses and their own subscriptions/authentication must be available;
the policy installer does not purchase plans or sign in to accounts. Python 3 is still listed as a
prerequisite until S32, though since #496 neither installer runs it, and none runs `jq` (the user
settings merge is Node since #491, the admin layer since #496); prerequisite detection is not yet a
unified guided flow.

## Preview without inheriting the reference owner's profile

macOS/Linux:

```sh
node bin/mhw.js install-user --overlay=none --dry-run
```

Windows (PowerShell or any shell; `install.ps1` until #497):

```powershell
node bin\mhw.js install-windows --overlay=none --dry-run
```

For a personal profile, copy `global/profile/profile.example.json` into a directory you control and
edit its choices. Validate and render it with the [profile compiler](../global/profile/README.md):

```sh
cd /path/to/my-profile
node /path/to/repository/bin/mhw.js profile validate --source profile.json
node /path/to/repository/bin/mhw.js profile render --source profile.json --output .
```

Paths above are placeholders (after an npm install, `mhw profile` is the same command). On Windows, use
your chosen Windows paths.
Pass the generated directory with `--overlay=PATH` (on Windows too since #497; ~~`-Overlay PATH`~~ was install.ps1's) for preview, apply and check.
The repository's `overlay/` is the reference owner's profile, not a universal default for every adopter.
Hand-authored overlays remain supported; the compiler refuses to overwrite their unmarked files.
Both installers verify structured profiles before writing. If you edit `profile.json`, regenerate
before installation; otherwise the stale-output check refuses the run. Python 3.9+ must be available
when installing a structured profile, including on Windows.

## Apply and check existing components

Return to the repository root after preparing an external profile. After reviewing the preview,
macOS/Linux:

```sh
./mhw install --overlay=none
./mhw status --overlay=none
./mhw check --overlay=none
```

`./mhw install --overlay=none` in your own terminal also installs the admin layer: it asks for your
administrator password once, after RETURN. `--no-admin` leaves it out.

Windows (PowerShell or any shell; `install.ps1` until #497):

```powershell
node bin\mhw.js install --overlay=none
node bin\mhw.js check --overlay=none
```

Use the same overlay choice in preview, apply and check. The installer refuses unmanaged conflicts;
resolve them deliberately instead of deleting existing configuration. A successful check establishes
file/configuration agreement, not that every harness loaded or enforced the policy. Its last section
lists the prerequisite tools and subscriptions, with the manual step for each gap, and fails when a
required one is missing ([prerequisites](prerequisites.md)). Follow the
README's separate hook-trust ~~and paste-wrapper activation~~ instructions where applicable (the paste wrapper
is removed since [#590](https://github.com/tedeuxx/mhw/issues/590); there is nothing to activate).

## Restart after installation

Save a sanitized handoff before applying active customization. After installation, open a new
session in each affected harness; restart desktop applications when needed. Do not continue work
in a session that still has the old configuration. Codex hook trust remains an owner action in
`/hooks`. Follow the disposable fresh-session canary in
[ADR-0022](adr/0022-restart-after-active-customization-changes.md) before claiming enforcement.
The macOS/Linux installer registers restart hooks for Claude Code and Codex. Kiro, Windows and
desktop routes without verified native hooks retain the same rule as instructions only.

## Current limits and updates

- Windows installs fewer controls than macOS/Linux; see the README's feature coverage.
- MCP rendering is a separate mechanism. Remote account connectors and synchronized allow/ask/deny
  permissions are not installed by the commands above.
- Slash commands for workstation management are proposed, not available commands.
- Unified model and reasoning-effort defaults remain under design; the installer does not implement
  native settings across vendors. The profile records the selected intent, which is **balanced** for
  the reference owner; exact model and effort values remain pending.
- For an update, review the new release, select it, and repeat preview, apply and check with your
  profile. Recheck behavior in fresh harness sessions.
- There is no unified rollback command yet. Existing installers preserve certain backups and managed
  markers; inspect the affected component before restoring anything. A Git checkout alone does not
  roll back installed files, credentials, account consent or external actions.
