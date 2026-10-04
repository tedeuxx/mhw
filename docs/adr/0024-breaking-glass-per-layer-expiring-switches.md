# ADR-0024: Breaking glass: one expiring, root-owned switch per hook protection layer

- **Status:** proposed
- **Date:** 2026-10-04
- **Supersedes, once installed:** the all-or-nothing emergency mode of [ADR-0023](0023-emergency-mode-v1-hooks-disabled.md)

## Context and problem

ADR-0023 regained control by switching every hook off through each harness's global switch. That
switch is all-or-nothing, never expires, and any process running as the owner can flip it back. The
owner set these requirements for `/breaking-glass` (2026-10-04):

1. one switch per protection layer;
2. switching a layer off needs OS administrator privilege, preferably through the harness's native
   managed layer;
3. every switch expires automatically;
4. a switch takes effect without a restart;
5. each session shows that a layer is off, without recording any content;
6. the command only prints the sudo line for the owner to run;
7. architecture: prioritise each harness's native mechanisms.

## What the native mechanisms provide (vendor documentation, read 2026-10-04)

| Need | Claude Code | Codex | Kiro |
| --- | --- | --- | --- |
| Admin-only layer | `managed-settings.json` (macOS `/Library/Application Support/ClaudeCode/`, Linux `/etc/claude-code/`); user `disableAllHooks` cannot disable managed hooks | `/etc/codex/requirements.toml` with `[hooks]` entries, `allow_managed_hooks_only`; managed hooks are "trusted by policy, and can't be disabled" | none for hooks: device `managed-settings.json` covers sign-in only |
| Per-hook switch | none | per-hook disable in `/hooks`, non-managed hooks only | per-hook `enabled` field, project files |
| Expiry | none (`once` only in skill frontmatter) | none | none |
| Reload without restart | user/project settings hooks: file watcher, documented; managed layer: not documented | not documented; an open upstream issue asks for it | IDE toggle "applies immediately"; CLI not documented |
| Non-blocking notice | `systemMessage`, `additionalContext` | `systemMessage` | not documented |

No vendor offers an expiring or restart-free per-layer switch at an admin-only level. Requirements
3 and 4 cannot be met by a native field alone.

## Decision drivers

- Requirements 1 to 7 above, in that order of weight where they conflict.
- A switch must fail toward the protection: any doubt leaves the layer on.
- The agent must not be able to forge a switch or elevate through the sudo line.

## Considered options

1. **Native layer registers the hooks; a root-owned switch file per layer, read on every hook call
   (chosen).** Install the v2 hooks in each harness's managed layer (Claude `managed-settings.json`,
   Codex `requirements.toml`), which the owner's user account cannot override. Each hook calls
   `breaking_glass.disabled_until(layer)` first. A switch is
   `<base>/breaking-glass/<layer>.json`, accepted only when it, its directory and the base are owned
   by root, not group- or world-writable, and not symbolic links. The expiry is capped at 240 minutes
   from the file's modification time, so a forged far-future date still expires. Trade-off: it is a
   project mechanism layered on the native one, not a vendor switch; and Kiro has no admin layer.
2. **Native fields as the switch** (managed `disableAllHooks`, Codex `[features].hooks`, Kiro
   `enabled`). Rejected: all-or-nothing in Claude and Codex, no expiry anywhere, and Codex and the
   Claude managed layer have no documented reload, so a switch would need a restart.
3. **User-writable switch file.** Rejected: any agent running as the owner could forge it, which
   defeats requirement 2.

## Decision outcome

Option 1.

- **Layers:** `paste-filter`, `restart-guard`, `hitl-guard`. The global brief and the deny floor are
  not hook layers and have no switch: neither has a restart-free native toggle, and they never
  caused a lockout.
- **Paths:** base macOS `/Library/Application Support/personal-multi-harness-workstation-configuration`,
  Linux `/etc/personal-multi-harness-workstation-configuration`; switches in `breaking-glass/`; the
  helper the sudo line runs is a root-owned copy in `bin/`, never the repository checkout, so the
  agent cannot edit what the owner runs as root. Windows: not supported yet; the gap is stated.
- **Command:** `/breaking-glass` runs `breaking_glass.py sudo-line …`, which prints
  `sudo /usr/bin/python3 -I -B "<base>/bin/breaking_glass.py" disable <layer> --minutes N` and changes
  nothing. It refuses to print a line unless the helper is root-owned and not writable by others.
  `sudo` is already in the deny floor (ADR-0016), so the agent cannot run the line itself.
- **Notice:** each SessionStart hook, and each skipped prompt-level hook, emits `systemMessage` with
  the result of `notice()`: layer names and expiry time only.
- **No restart:** switches are read per invocation. Installing the hooks in the managed layer still
  needs one fresh session (ADR-0022); flipping a switch afterwards does not.
- **Kiro:** hooks stay in user-writable files; the switch check is the same, but Kiro gives no admin
  floor, so an agent running as the owner could remove a Kiro hook. Stated as a gap.

## Consequences

- Good: per-layer, expiring, restart-free, admin-only on Claude Code and Codex, with a visible notice.
- Good: the failure direction is toward the protection, and every rejection path is tested by a
  source mutation (`global/hooks/breaking_glass_test.py`).
- Bad: installing the helper and the managed hooks is a sudo act for the owner, once.
- Bad: a lockout by a defective managed hook can no longer be fixed from the user layer. The switch is
  the only escape, which is why the restart guard must never deny read-only tools (plan for v2).
- Evidence level: module, command and the three hooks' switch checks *written and tested* in temporary
  directories (ADR-0025 wires them; `/breaking-glass` is rendered to `~/.claude/commands/` by
  `install.sh`). Nothing is installed on the reference workstation yet.

## Links

- [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md) (deny floor, `sudo`),
  [ADR-0022](0022-restart-after-active-customization-changes.md), [ADR-0023](0023-emergency-mode-v1-hooks-disabled.md)
- Claude Code: settings, hooks and managed-settings documentation (code.claude.com)
- Codex: hooks and managed configuration documentation (learn.chatgpt.com/docs)
- Kiro: hooks, custom agent configuration and governance documentation (kiro.dev/docs)
