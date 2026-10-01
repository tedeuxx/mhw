# personal-multi-harness-workstation-configuration — the harness-neutral brief

**This file is the brief for any agent harness that reads `AGENTS.md`** (Claude Code, Codex, Kiro and
whatever comes next). It is authored, not generated.

## Fundamental purpose

This repository is the **governed configuration of the owner's personal workstation** (a Mac mini) for
every AI agent harness he runs on it. It exists to protect him — as a private individual — from
**individual, civil and intellectual-property risk** arising from his personal activity tied to his
public professional persona.

Concretely, it must keep three things true on this machine:

1. **Client and employer confidentiality is never breached.** Material belonging to a current or past
   client or employer — code, documents, data, credentials, names, internal context — does not reach a
   personal repository, a public surface, a third-party service or an agent context that was not
   cleared for it.
2. **His civil identity carries no avoidable liability.** What agents publish, send or commit under his
   name is something he would sign: no leaked personal data, no unattributed third-party IP, no action
   on an external service he did not authorise.
3. **The controls are uniform across harnesses.** One policy, expressed in each harness's own
   mechanism, so that switching tools never silently drops a protection.

## The model: corporate workstation governance, applied to one person

Corporate organisations govern workstations in **layers with precedence**: an organisation-wide
managed policy that users cannot override, then user preferences, then per-project settings, then
local overrides. This repository reproduces that distribution **for one person's development and
public-professional scope**:

| Corporate layer | Equivalent here |
| --- | --- |
| Organisation policy (MDM / managed settings, non-overridable) | The owner's **personal policy floor** — protections no project, plugin or session may weaken |
| User preferences | Global per-harness user config (`~/.claude`, `~/.codex`, `~/.kiro`) |
| Project / repository config | Each repository's own harness config (e.g. `tadeumendonca-io`) — must sit **inside** the floor |
| Local overrides | Per-clone, untracked, never a place where a protection is relaxed |

The source of truth for every layer lives here, versioned; what is installed on the machine is a
**rendering** of it, and drift between the two is a defect.

## Hard rules for any agent working in this repository

- **No secret value is ever committed here** — not tokens, API keys, passwords, OAuth client secrets,
  service-account files, nor a config file copied verbatim from a machine that contains them. Reference
  secrets by name and location only.
- **No client name, client artefact or employer-confidential content** is ever written into this
  repository, even as an example. Describe by sector or category.
- **A control is reported at its real evidence level**: written, installed, loaded, enforced — four
  different claims. Never state the stronger one on evidence for the weaker.
- **Policy decisions are the owner's.** Agents propose, implement what was decided, and verify; they do
  not widen a permission or drop a protection on their own judgment.

## Status

Bootstrapped 2026-10-01. The policy itself is being defined through an interview with the owner;
nothing in the machine's configuration is managed from here yet.
