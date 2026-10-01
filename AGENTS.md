# personal-multi-harness-workstation-configuration — the harness-neutral brief

**This file is the brief for any agent harness that reads `AGENTS.md`** (Claude Code, Codex, Kiro and
whatever comes next). It is authored, not generated.

## Fundamental purpose

This repository is the owner's **LLM firewall**. It is a protection layer for his individual liability,
enforcing ethical principles that he defines and regulates. It sits between him and every AI agent
harness on his personal workstation (a Mac mini), and it is expressed as that workstation's governed
configuration. It exists to protect him, as a private individual, from **individual, civil and
intellectual-property risk** arising from his personal activity tied to his public professional persona.

It covers **every agent surface of both vendor families**, not only the CLIs: Claude Code, the Claude
desktop app including Cowork and its local MCP/extension config, Codex (CLI and app), the ChatGPT
desktop app's agentic "work" surfaces, and Kiro
([ADR-0006](docs/adr/0006-coverage-scope-all-agent-surfaces.md)).

Its job is to **sanitise prompts** in both directions it can reach:

- **external**: prompts that leave the machine for an LLM provider or any other service;
- **internal**: prompts passed between agents (agent ↔ subagent).

What it removes from them:

- workstation security risks (secrets, credentials);
- personal data and PII;
- client and employer confidential data;
- sensitive personal data, such as health data and the other categories LGPD treats as *dados pessoais
  sensíveis*.

Its ethical foundation is **Stoic ethics, the good life** (owner); how that maps onto firewall
behaviour is proposed in [ADR-0004](docs/adr/0004-stoic-ethical-foundation.md). On detection the
response is **human-in-the-loop only, with no auditable record kept on the workstation**
([ADR-0005](docs/adr/0005-detection-response-hitl-without-log.md)).

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

## Principles

1. **Compatible distributions and environments.** The owner's macOS machine is the reference
   installation and must stay fully supported. The policies themselves must be **replicable by other
   people on their own workstations, Windows and Linux included**. The repository is therefore a
   portable policy set, not a dump of one machine:
   - owner-specific values (paths, accounts, his own repositories) live in an **overlay** kept
     separate from the generic policy;
   - every control declares **which OS × harness combinations enforce it**, and where one cannot, the
     gap is stated rather than hidden;
   - the repository declares, **per harness, the minimum harness version** that supports every feature
     the policy set relies on, and states **how that minimum was established** — *measured* (exercised
     on that version), *documented* (taken from the vendor's documentation or changelog) or *assumed*
     (neither). Those are three different evidence levels and are never presented as one. No minimum is
     declared yet; none has been measured.

   (Owner, 2026-10-01.)

2. **MADR discipline.** Significant policy and architecture decisions about this repository are
   recorded as **Architecture Decision Records in MADR format**, in [`docs/adr/`](docs/adr/):
   - **significance gate** — an ADR is owed when a change alters the personal policy floor, adds or
     removes a control, changes how a harness or OS is supported, introduces a new tool-class or
     dependency, alters a previously recorded decision, or sets a cross-cutting pattern; a routine
     in-pattern change records none;
   - **format** — MADR sections: title, status, context and problem, decision drivers, considered
     options (the chosen path and at least the strongest rejected alternative, each with its
     trade-off), decision outcome, consequences (good and bad), links;
   - **numbering** — zero-padded and sequential (`0001`, `0002`, …), filename `NNNN-kebab-title.md`;
   - **status** — `proposed → accepted → superseded` (or `rejected`); a record becomes `accepted` only
     on the owner's ratification;
   - **changing a decision** — an accepted record is amended by appending and striking in place
     (`~~…~~`), never rewritten; a reversed decision is superseded by a new record, and a record leaves
     the library only with a recorded trace of what replaced it, never as a silent absence.

   (Owner, 2026-10-01. Adopted in [ADR-0001](docs/adr/0001-record-decisions-as-madr.md).)

3. **Automatic versioning.** Every merge to `main` cuts a **purely numeric SemVer** tag
   (`vMAJOR.MINOR.PATCH`, no pre-release suffix) with **bump-my-version**, configured in
   [`.bumpversion.toml`](.bumpversion.toml). The part bumped is chosen by a **predefined cut policy**
   suited to a policy-set artifact, declared on the pull request as exactly one
   `semver:major|minor|patch` label; a pull request without exactly one fails a check. The cut policy
   and the mechanism are in [ADR-0002](docs/adr/0002-automatic-semver-cut-policy.md), which is
   **proposed** until the owner ratifies the cut table.

   (Owner, 2026-10-01.)

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
