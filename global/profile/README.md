# Portable preference profile

One JSON profile generates the instruction overlay consumed by the existing CLI installers, notice
localization, and a complete instruction text for a Claude desktop account-settings handoff.
It does **not** install into a harness, write account settings, select a native model or grant tools.
This is the first implementation slice of [ADR-0018](../../docs/adr/0018-portable-personal-profile-and-unified-harness-management.md).

Requires Python 3.9 or later, with no third-party packages. The suite was exercised on macOS with
Python 3.9.6 and 3.14.6 (`/usr/bin/python3 --version` and `python3 --version`, followed by the suite
command below). CI is configured for macOS, Ubuntu and Windows. Added jobs are not evidence of
completed runs.

## Source and generated files

- [`profile.schema.json`](profile.schema.json) is the closed preference vocabulary.
- [`profile.example.json`](profile.example.json) is an adopter starting point: English, concise,
  no numeric question-length limit and no model priority selected. The one-ask rule stays in force.
- [`../../overlay/profile.json`](../../overlay/profile.json) contains the reference owner's selected
  preferences, including **balanced** session-start intent.
- `AGENTS.md`, `hitl.conf`, `clipboard.conf`, `desktop-instructions.md` and `profile-plan.json` in the
  output directory are generated. Edit the JSON and regenerate; do not edit the output by hand.

The generated notice files add localization and the selected question-length limit; they do not
remove detection categories or change the generic question-count rule. English and Brazilian
Portuguese are the currently supported languages. More locales require reviewed templates.

The reference owner also selects paced dialogue, minimum-sufficient input context and three-choice
path decisions. These optional fields preserve older profile compatibility. The generated brief
instructs agents to leave room for clarification, use concise progressive disclosure, and state risk
and benefit for each choice. `exact_options=3` is rendered into the existing Claude Code guard's
configuration on macOS/Linux. It checks only choice count and single selection; cadence, semantics
and token discipline remain instructions. Other harnesses have no registered equivalent picker
guard here. See [ADR-0019](../../docs/adr/0019-paced-conversation-and-three-path-decisions.md).

## Validate, inspect, generate and check

From the repository root:

```sh
python3 -B global/profile/profile.py validate --source overlay/profile.json
python3 -B global/profile/profile.py plan --source overlay/profile.json
python3 -B global/profile/profile.py render --source overlay/profile.json --output overlay
python3 -B global/profile/profile.py check --source overlay/profile.json --output overlay
```

On Windows, use the available Python launcher (`python` or `py -3`) in place of `python3`.
The same arguments work in PowerShell. To create your own profile, copy the example into a directory
you control, edit its choices, then use that file as `--source` and that directory as `--output`.

`validate` and `plan` write nothing. `render` updates only its marked outputs, leaves unrelated files
untouched and refuses unmanaged targets and symlink targets. An identical render does not rewrite
files. Writes are atomic **per file**, not transactional across the bundle; run `check` after an
interrupted render and regenerate if needed. `check` detects missing or changed generated content
without repairing it. CRLF versus LF alone is not drift.

Errors identify only known schema locations, never input values or unknown field names. The profile
accepts no free-form prompts, secrets, account identifiers, MCP endpoints or native allow rules.
This limits accidental input; it is not a general confidentiality scanner for other files.

Exit codes: `0` success; `1` generated output missing or stale; `2` invalid profile or arguments;
`3` unreadable input/output or an unmanaged/symlink conflict.

## Install the prepared overlay

After reviewing it, use the existing installer with the generated directory as `--overlay=PATH`
(PowerShell: `-Overlay PATH`). Follow [the onboarding guide](../../docs/new-workstation.md). Compilation
and the installer's file check are separate checks. When an overlay contains `profile.json`, both
installers run the compiler's drift check before writing any target and refuse stale output. Such an
overlay therefore requires Python 3.9+ at installation too. Hand-authored overlays and `none` retain
their previous dependency requirements. Neither check proves runtime enforcement.

For Claude desktop, `desktop-instructions.md` includes the global protection brief followed by the
profile. Review it alongside existing account instructions before applying it through the product's
supported settings. No automatic account merge, upload or activation is implemented here.

The `surfaces` array describes intended targets in the plan, **not an installation filter**. Existing
installers still target every supported CLI. The compiler prepares reusable outputs for all routes.
Native model/effort mapping, slash-command registration, MCP migration, pre-authorization adapters
and financial preferences remain separate pending work, visibly named by `plan`.

## Verification

```sh
python3 -B global/profile/profile_test.py
python3 -B global/profile/profile.py check --source overlay/profile.json --output overlay
```

The synthetic suite exercises rejection before output, duplicate JSON keys, redacted diagnostics,
locale behavior, preservation of the global floor, drift detection and repair, idempotence, unmanaged
conflicts, symlinks and CRLF compatibility. The existing installer suite exercises consumption of
the reference overlay in throwaway homes.
