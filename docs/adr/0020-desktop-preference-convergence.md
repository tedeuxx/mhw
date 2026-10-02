# 0020 — Converge Claude and Codex desktop user preferences

- **Status:** accepted requirement (owner, 2026-10-02); individual native settings remain proposed
  until selected or already justified by an explicit preference.
- **Date:** 2026-10-02
- **Deciders:** the owner

## Context and problem

The owner explicitly requests convergent defaults in Claude and Codex desktop apps to reduce friction
when switching harnesses. CLI configuration alone does not cover native app appearance, notifications,
keyboard behavior or account-backed instructions. This extends ADR-0018 and ADR-0019.

## Decision drivers

- Preserve the same conversational expectations across projects and apps.
- Align user outcomes, not merely similarly named settings with different effects.
- Use supported controls and retain one versioned preference source.
- Make unsupported settings and unverified app state visible.
- Keep existing permissions, privacy protections and hook trust intact.

## Considered options

1. **Shared semantic preferences with explicit native mappings.** Selected direction: distribute
   supported settings and document manual controls. Trade-off: some account/UI settings need a
   separate application and cannot be checked by the filesystem installer.
2. **Copy all defaults from one app to the other.** Rejected: keys, notification categories and
   model/effort scales are not equivalent, and copying may alter unrelated permissions.
3. **Force identical behavior through private stores or UI workarounds.** Rejected: undocumented
   internals are fragile and a tool's access restriction is not permission to bypass it.

## Decision outcome

Converge conversation language, concise paced dialogue and three risk/benefit options first, as
already selected and installed under ADR-0019. Then calibrate notifications, comparable appearance
and keyboard preferences, and session-start model/effort intent. Keep the owner's balanced model
priority; specific native defaults are still a separate mapping under ADR-0007.

~~The first open personal choice is notification intent: essential interruptions, essential plus
completion alerts, or silence.~~ The owner explicitly selected **essential** in the three-option
picker on 2026-10-02: notify when his action is needed, accepting that conclusions may go unnoticed.
This is recorded in `overlay/profile.json` as `desktop.notifications=essential`, not inferred from
the preselected recommendation.

### Reference observation — 2026-10-02

| Preference | Claude desktop | Codex desktop / documented local configuration | State |
| --- | --- | --- | --- |
| Conversation profile | Generated owner block saved in account **Instructions for Claude**, previous text preserved | User `AGENTS.md` installed and loaded into the current local app session | Instruction convergence installed; semantic compliance not guaranteed |
| Theme | System selected | UI not accessible through the computer-use tool | Not compared; no change |
| Font / size | Anthropic Serif / Medium | UI not inspected | Not compared; typography need not use identical proprietary fonts |
| Motion | System selected | UI not inspected | Not compared; no change |
| Voice language / speed | Portuguese (Brazil) / Normal | UI not inspected | Not compared; not evidence of the app's UI language |
| Completion alerts | Off | Native UI not inspected | Preference pending; no change |
| Code permission alerts | Off; ordinary Code notifications on | Native UI not inspected | Preference pending; no change |
| Default local model / effort | Not inspected for fresh-session defaults | `model=gpt-6-astra`, `model_reasoning_effort=high` in user `config.toml` | Configured values only; not proof of effective model in every app session |
| Local sandbox / approval | Not compared | `workspace-write` / `on-request` in user `config.toml` | Observed only; no authorization change |

The computer-use tool refused `cua.getApp('Codex')` with: **"Computer Use is not allowed to use the
app 'com.openai.codex' for safety reasons."** No alternative UI path was attempted. Reading the
documented, user-owned `config.toml` is a separate supported configuration route; only whitelisted
non-secret preference values were returned, with no file dump or account-state export.

## Consequences

### Good

- The existing conversation profile is already shared; native UX differences are tracked precisely.
- New preferences can be added without broad grants, account exports or separate handwritten rules.

### Bad

- Desktop convergence is incomplete: native UI defaults are not currently synchronized.
- Codex app appearance, keyboard shortcuts and native notification controls require a supported
  tool or manual application. Filesystem drift checks cannot prove their state.
- Model/effort equivalence requires a vendor-specific mapping, not equal effort labels.

## Links

- [Portable profile](0018-portable-personal-profile-and-unified-harness-management.md)
- [Conversation discipline](0019-paced-conversation-and-three-path-decisions.md)
- [Session-start defaults](0007-session-start-model-and-effort-defaults.md)
- [Codex app settings](https://learn.chatgpt.com/docs/reference/settings)
- [Codex configuration layers](https://learn.chatgpt.com/docs/config-file/config-basic)

Documentation and local observations are dated above; no minimum supported app version is claimed.

## Amendment — essential notifications applied where reachable

The profile compiler now distributes the selected attention preference to the three CLI user briefs
and desktop instruction handoff. Its 17 tests passed and the reference installer/check both exited
0. The updated owner block replaced only its previous managed block in Claude desktop; the UI
reported **Saved**, with the older unrelated instructions still present. This is not automated
ongoing account synchronization.

In Claude desktop **General > Notifications**, **Code permission requests** changed from off to on,
then was read back on after the temporary saving state ended. **Response completions** stayed off.
**Code notifications** stayed on so agents can surface an essential request, with the new instruction
limiting proactive notices to needed action. **Scheduled tasks** stayed on: its single switch combines
completion, failure and input-needed notices, so turning it off would also suppress essential alerts.
This leaves residual completion noise; the UI offers no separate categories there. Email and phone
Dispatch preferences were not altered as part of desktop convergence. Delivery itself was not tested.

The Codex native notification UI remains inaccessible to the tool; no native notification value was
changed or claimed verified there. For manual completion, open **Settings > Notifications**, disable
routine turn-completion alerts, and preserve action/approval prompts where the installed app offers
separate controls. Do not disable OS notifications wholesale. Appearance, shortcuts and concrete
model/effort mappings remain open; this record does not claim full desktop convergence.
