# personal-multi-harness-workstation-configuration — the harness-neutral brief

**This file is the brief for any agent harness that reads `AGENTS.md`** (Claude Code, Codex, Kiro and
whatever comes next). It is authored, not generated.

## Fundamental purpose

This repository is the **master of first principles** for the owner as an individual interacting with
his AI workstation. It protects him from third-party risk, and it also places **ethical locks on what he
himself seeks to achieve**; the concrete locks are pending an interview with him
([ADR-0015](docs/adr/0015-master-of-first-principles-ethical-locks-on-own-aims.md)).

### Mission

In the owner's words:

> *"a sua missao como projeto de manutencao de configuracao de harness em workstation pessoal é me
> resguardar de violacoes de direitos comercials e propriedade intelectual de terceiros ao longo das
> minhas atividades profissionais pessoais. somente meu conheicmento individual e aprendizado ao longo
> da minha atividade profissional e qualquer ambiente é de minha propriedade individual e isso que me
> ajude a respeitar."*

In English: protect him from **violating third parties' commercial rights and intellectual property**
in his personal professional activity. **Only his individual knowledge and learning**, gained in any
environment, is his own property, and this project exists to help him respect that line. The working
test for where the line falls is proposed in
[ADR-0009](docs/adr/0009-what-is-mine-individual-knowledge-vs-third-party-property.md). The mission is
carried into every harness's user-level brief from one source, [`global/AGENTS.md`](global/AGENTS.md)
([ADR-0010](docs/adr/0010-global-brief-rendered-to-each-harness.md)).

### How: the LLM firewall

To pursue that mission, this repository is the owner's **LLM firewall**. It is a protection layer for his individual liability,
enforcing ethical principles that he defines and regulates. It sits between him and every AI agent
harness on his personal workstation (a Mac mini), and it is expressed as that workstation's governed
configuration. It exists to protect him, as a private individual, from **individual, civil and
intellectual-property risk** arising from his personal activity tied to his public professional persona.

It covers **every agent surface of both vendor families**, not only the CLIs: Claude Code, the Claude
desktop app including Cowork and its local MCP/extension config, Codex (CLI and app), the ChatGPT
desktop app's agentic "work" surfaces, and Kiro IDE and Kiro CLI
([ADR-0006](docs/adr/0006-coverage-scope-all-agent-surfaces.md)). Each surface's session-start default
model and effort is standardised at user level
([ADR-0007](docs/adr/0007-session-start-model-and-effort-defaults.md), proposed).

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
behaviour is ratified in [ADR-0004](docs/adr/0004-stoic-ethical-foundation.md). On detection the
response is **human-in-the-loop only, with no auditable record kept on the workstation**
([ADR-0005](docs/adr/0005-detection-response-hitl-without-log.md)). The reference workstation is
personal by policy and never persists employer or client confidential data
([ADR-0008](docs/adr/0008-personal-workstation-no-confidential-persistence.md)). Pasted
content is cleaned where it enters an agent harness command line, as he decided (*"tem que ser limpo
sozinho"*): a pty wrapper launcher, activated by shell functions the owner sources, replaces an
employer or client reference, a credential or personal data in a bracketed paste before the agent
harness sees it. A prompt hook on Claude Code and Codex is the safety net: in a session the wrapper
did not start, it blocks such a prompt and shows a redacted copy
([ADR-0033](docs/adr/0033-paste-cleaning-wrapper-primary-hook-safety-net.md), proposed; it supersedes
[ADR-0011](docs/adr/0011-clipboard-prompt-anonymisation.md), whose clipboard watcher was withdrawn on
the owner's correction). Operational
judgement is delegated to the agent harness to minimise human error; legal responsibility stays with
the owner ([ADR-0012](docs/adr/0012-operational-judgement-delegated-to-the-harness.md)). How agents
escalate a pending decision or action to the owner is calibrated here: generic rules in the global
brief and his language and limits in [`overlay/`](overlay/), all of them instructions; the picker
guard hook that once checked them on Claude Code was removed on his interview of 2026-10-05
([ADR-0013](docs/adr/0013-hitl-escalation-calibration.md), Issue #60).

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
   ~~suited to a policy-set artifact~~ — plain SemVer since 2026-10-06: **major** for a breaking change
   (something a consumer must change), **minor** for an incremental feature (including adding or
   removing a control when no consumer has to change anything), **patch** for a bug fix — declared on the pull request as exactly one
   `semver:major|minor|patch` label; a pull request without exactly one fails a check. The cut policy
   and the mechanism are in [ADR-0002](docs/adr/0002-automatic-semver-cut-policy.md), which is
   **proposed** until the owner ratifies the cut table. Since 2026-10-05 the only pull request into
   `main` is the release candidate from `rc/next`; slices merge into `rc/next` (Issue #60, ADR-0021).
   The release candidate's label is the largest part among the changes it contains.

   (Owner, 2026-10-01.)

## This repository vs the plugin

**This repository is the firewall**: the personal protection floor every session passes through. The
owner's `tadeumendonca-skills` plugin is the **way of working**: personas, the delivery loop, skills
and project hooks. The plugin may add controls and must never weaken the floor. ~~This repository carries
no way-of-working content.~~ *(Struck 2026-10-05, Issue #65: since
[ADR-0032](docs/adr/0032-this-repository-is-the-single-source-of-the-working-method.md), proposed, the
method's source is `method/` here and the plugin becomes its generated copy; until the cutover, #62 and
#63, the plugin stays the running copy.)* "Last barrier" is the firewall's purpose. The global brief is a user-level
instruction, and user level is low precedence in every harness. See
[ADR-0014](docs/adr/0014-purpose-boundary-firewall-vs-plugin.md). Its first mechanical control, a
user-level deny floor rendered to Claude Code and Codex, is accepted and was installed on the reference
workstation on 2026-10-01
([ADR-0016](docs/adr/0016-user-level-deny-floor-rendered-per-harness.md)). It is a prefix floor, not a
wall.

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

### Delivery contract (owner, 2026-10-05, Issue #60)

- There is **no session-type intake**. A session starts on the owner's first prompt, with no picker
  and no startup hook. In his words: *"eu removeria. achei que traz mais problemas do que solucao."*
  (This replaces the 2026-10-02 workspace session contract; ADR-0021, 2026-10-05 amendment.)
- **Agents merge slices into `rc/next`; only the release candidate waits for the owner.** In his
  words: *"os agentes mergeiam no rc/next, só o RC espera mim"*. A slice PR targets `rc/next` and is
  merged by an agent, with a real merge commit, once its checks and the review gate (and any lens the
  change requires) pass at its current head. No repeated owner approval is needed for that. The PR
  `rc/next` → `main` is never merged without his explicit go; the install and canary after it are
  his. This is the owner's standing authorization for this repository, not permission to bypass
  tests or protection rules, and a pause for questions publishes nothing.
- Follow `workspace/README.md` and `workspace/session-policy.json`. For a slice and for the release
  candidate alike, use the checked merge command (`python3 -B workspace/delivery.py merge --pr N`), then the
  read-only delivery verifier. For a slice into `rc/next` it requires the `tests` run registered on
  the head, `delivery-ci` and Sonar green, a clean merge state, a `quality-assurance` verdict
  approving that exact head and, on harness paths, the `agents-lead` lens CLOSED at that head (the
  exact three-line templates are in `workspace/README.md`; the lens's line 3, `the lens is CLOSED`,
  is this repository's contract, not the plugin's); it
  merges with a real merge commit pinned to the head; a PR into `main` from any branch other than `rc/next` is refused. This
  route is *written* and tested against a synthetic `gh`; no real PR has exercised it yet. Never announce a release complete
  until it confirms the exact head is in a merged PR covered by a successful version workflow and a
  published newer numeric SemVer release. Report a blocker instead of calling local commits a
  delivery.
- Claude Code offers `/session-finish`; other harnesses follow this same contract from AGENTS.md and
  the Kiro steering and invoke the shared commands. Nothing mechanical enforces the release-candidate
  rule: it is an instruction.

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

Bootstrapped 2026-10-01; the policy is defined through interviews with the owner. **What each control
reaches, per agent harness surface and operating system, at its real evidence level, is one table:
[README, "Current state"](README.md#current-state).** It replaced the amendment log this section used
to carry (Issue #65, 2026-10-05); the log is in this file's git history. The decision records, their
status and the owner asks still pending are indexed in [`docs/adr/README.md`](docs/adr/README.md).

The short form, so an agent reading only this file does not over-claim: everything on `rc/next` is
*written and tested* (and probed in throwaway homes where the table says so); **none of it is
installed on the owner's reference machine**. That machine runs an earlier release until the owner
merges the release-candidate pull request, installs it and runs the canary, in a fresh session.
