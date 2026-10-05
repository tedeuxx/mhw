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
content is checked where it enters a harness CLI prompt: a user-level prompt hook on Claude Code and
Codex blocks a prompt carrying an employer or client reference, a credential or personal data, and
shows a redacted copy ([ADR-0011](docs/adr/0011-clipboard-prompt-anonymisation.md), mechanism proposed;
the always-on clipboard watcher it replaces was withdrawn on the owner's correction). A pty wrapper
launcher, activated by shell functions the owner sources, cleans a bracketed paste into those CLIs
before they see it, as he decided (*"tem que ser limpo sozinho"*). Operational
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
   suited to a policy-set artifact, declared on the pull request as exactly one
   `semver:major|minor|patch` label; a pull request without exactly one fails a check. The cut policy
   and the mechanism are in [ADR-0002](docs/adr/0002-automatic-semver-cut-policy.md), which is
   **proposed** until the owner ratifies the cut table.

   (Owner, 2026-10-01.)

## This repository vs the plugin

**This repository is the firewall**: the personal protection floor every session passes through. The
owner's `tadeumendonca-skills` plugin is the **way of working**: personas, the delivery loop, skills
and project hooks. The plugin may add controls and must never weaken the floor. This repository carries
no way-of-working content. "Last barrier" is the firewall's purpose. The global brief is a user-level
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

Bootstrapped 2026-10-01. The policy itself is being defined through an interview with the owner.
On 2026-10-01, with the owner's go (Issue #4,
[comment](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/4#issuecomment-5937083996)),
`global/install.sh` ran against the reference machine from `main` at v0.7.0 (`093f84f`). It exited 0,
and `install.sh --check` then exited 0 with every target OK. Here is what the reference machine carries
from here now, and at what evidence level:

- **Global brief** (`global/AGENTS.md`, ADR-0010): *installed* into the three user-level locations at
  v0.7.0. Its evidence level is *loaded* in Claude Code and Codex, measured headless on 2026-10-01, and
  *documented* for Kiro.
- ~~**HITL escalation guard** (ADR-0013): its hook entry in the Claude Code user settings is *installed*
  (`--check`: "hook entry … present"). That it fires on the reference machine was not re-measured.~~
  *Amended 2026-10-05 (Issue #60; ADR-0013, ADR-0019 and ADR-0021 amendments):* on the owner's
  interview the picker guard is **removed** from the source, with its user and admin registrations,
  its limits file and its suite. Its rules (one question per message, a stem of at most 280
  characters, reasoning in a linked artifact, three options per decision: one extreme, the opposite
  extreme and the middle ground, Portuguese with him and English when published) are instructions in
  the owner overlay and the briefs. The session-type intake is removed too: its SessionStart hooks,
  `/session-start`, every brief copy of the contract and the intake fields of
  `workspace/session-policy.json`. The next `install.sh` and `install-managed.sh --apply` delete what
  an earlier version installed, and `--check` reports it as `STALE`. *Written and tested*, and probed
  in throwaway homes and roots; **not installed**: the reference machine runs the picker guard until
  the owner reinstalls both layers in a fresh session.
- **Deny floor** (ADR-0016, accepted): *installed*, with all 101 rules present per `--check`. It is
  *enforced* in Claude Code and Codex, as measured headless in throwaway homes. Enforcement on the
  reference machine was not re-measured. Kiro carries no floor.
  *Amended 2026-10-05 (#59, ADR-0016 amendment, proposed):* the floor absorbs the plugin's
  irreversible-action rules (115 generic rules, 126 with the owner overlay) and is also rendered into
  the admin layer by `install-managed.sh`, because a session flag drops the user layer (measured).
  The admin copy is *written and tested* in throwaway roots, **not installed**; installing it is the
  owner's `sudo` act ([runbook](docs/runbooks/deny-floor-admin-layer.md)). `install.sh --check` names
  the layer that carries the floor.
- ~~**Clipboard watcher** (ADR-0011, macOS): *installed* by the same run, then *loaded* on the owner's go
  (`launchctl print` shows it running, never exited; ADR-0011's second 2026-10-01 amendment). Its mode is
  `offer`, ratified by the owner on Issue #5. It changes nothing without his click. Its on-screen
  notices are still unverified, and no term has been added with `add-term` yet. ADR-0011 stays proposed
  for the open ADR-0012 agent-route question and for the categories and salt store. Linux and Windows
  have design notes only.~~
  *(Struck 2026-10-01: withdrawn on the owner's correction on Issue #5. It was stopped and disabled on
  the reference machine the same minute, and this version no longer installs it.)*
- **Paste filter** (ADR-0011, Claude Code and Codex prompt hooks, macOS and Linux): *written and
  tested*, and *measured* blocking in headless Claude Code and Codex in throwaway configurations.
  ~~**Not installed** on the reference machine.~~ *Installed* on the reference machine from v1.0.0 on
  the owner's go
  ([Issue #5](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/5#issuecomment-5942877343)).
  On Codex it runs only after the owner trusts it in `/hooks`; that trust is not recorded. It blocks
  and shows a redacted copy; it does not clean automatically.
  *Amended 2026-10-04:* on Claude Code on the reference machine it was *measured* blocking a prompt
  carrying a synthetic example credential. Codex on the reference machine is not re-measured.
  *Amended 2026-10-05 (Issue #58, owner decision):* the hook stays as the **safety net**. It now passes
  silently when the paste wrapper's marker (`PMHWC_PASTE_WRAPPER=1`) is in its environment, and blocks
  as before when it is absent. That is *written and tested*, mutation-checked. Headless, in throwaway
  homes, the marker was *measured* reaching the hook process in Claude Code 2.1.289 and Codex 0.160.0;
  the branch core passed in a wrapped session and blocked in a direct one. **Not installed** on the
  reference machine: its user and admin copies predate this change, and *measured* still blocking a
  wrapped sensitive prompt. The admin copy needs the owner's `sudo` re-install. Anyone can set the
  marker by hand, and in a wrapped session typed text is no longer checked (ADR-0011, 2026-10-05
  amendment). A prompt argument carrying a finding leaves the session unmarked, so the hook checks
  it. That is *tested* and mutation-checked, and it was *measured* blocked through the wrapper on both
  CLIs.
- **Paste wrapper** (ADR-0011, amendment "automatic cleaning at the paste boundary", macOS and Linux):
  a pty launcher for `claude`, `codex` and `kiro-cli`. It **cleans** bracketed pastes before the CLI
  sees them and passes typing through byte for byte. It is *written and tested* (Ubuntu and macOS in
  CI). Bracketed paste is *measured* enabled by Claude Code 2.1.287 and Codex 0.155.0-alpha.16.3. A
  synthetic paste is *measured* arriving redacted in both real CLIs, in throwaway homes, with nothing
  submitted. Kiro CLI is not measured. It is **not activated** on the reference machine: the
  installer writes a snippet of shell functions, and sourcing it from the shell rc is the owner's act.
  Pastes the CLI reads itself (files by path, images) and sessions not started through the functions
  are outside it.
  *Amended 2026-10-05 (Issue #58):* the wrapper is now the **primary** paste mechanism. It exports the
  session marker only into the CLI it relays for. `install.sh --shell-rc=FILE` appends one guarded
  start-up line to FILE (opt-in, idempotent, printed). Without the flag, the line is only printed.
  That is *tested* against throwaway rc files. A synthetic paste was re-*measured* arriving redacted
  in Claude Code 2.1.289 and Codex 0.160.0, both through the branch wrapper, in throwaway homes, with
  nothing submitted. ~~It is **not activated** on the reference machine~~ *Observed 2026-10-05:* a
  Claude Code session's shell snapshot on the reference machine defines `claude` and `codex` as the
  wrapper functions, so the snippet is sourced from the owner's shell. Which rc carries it was not read.
- **MCP definition** (ADR-0017, proposed): one definition, kept in the untracked local overlay and
  rendered into Codex, Claude Code, the Claude desktop app and Kiro with credentials read from the
  Keychain at launch. It is written and tested in throwaway homes. `install.sh` does not run its
  renderer, and the renderer has **not** been run on the reference machine (Issue #8). Installing it
  into the owner's real configuration is his act.
- **Total breaking glass** (ADR-0023, 2026-10-04): the restart guard locked the owner out, so every hook
  is switched off with each harness's native switch (Claude Code `disableAllHooks`, Codex
  `[features] hooks = false`), with backups. The brief and the deny floor stay on; the paste filter,
  HITL guard and restart guard are *suspended*. Kiro carried no v1 hook.
  *Ended 2026-10-04 on Claude Code, measured:* `disableAllHooks` is absent from the user settings and
  the managed restart guard wrote this session's baseline at startup. On Codex the `hooks = false`
  line is absent; whether hooks fire there again is not measured.
- **v2** (ADR-0024, ADR-0025, 2026-10-04): fixes for the intake picker and the restart-guard lockout,
  ~~per-layer expiring root-owned switches with `/breaking-glass`,~~ and the admin-layer installer.
  *Written and tested* in throwaway homes and roots; ~~**not installed**~~. The rollout is the owner's,
  in fresh sessions ([runbook](docs/runbooks/breaking-glass.md)).
  *Amended 2026-10-04:* the owner installed v2.1.0 in the admin layer (`install-managed.sh`, one
  root-owned managed-settings drop-in) and at user level (`install.sh --hooks=managed`;
  `--check` exits 0). On Claude Code the runbook canary passed in a fresh session: a declared session
  type was accepted without a picker, the restart guard created its baseline, `Read` after a `cd`
  passed and `/breaking-glass status` reported every layer active. That is *loaded* with the pass
  path measured; ~~no deny was provoked, so *enforced* is not re-measured on this machine.~~
  *Amended 2026-10-04, Claude Code block path:* on the reference machine the restart guard denied a
  tool call with `fingerprint_mismatch` after tracked configuration changed within the session. The
  restart guard's pass and block paths are therefore *measured* (*enforced*) on Claude Code here.
  *Amended 2026-10-04, Codex:* an immediately preceding session in a disposable worktree observed the
  first covered command denied with `fingerprint_mismatch`, proving managed hook routing and the deny
  path. A genuinely new session opened directly in that worktree then accepted the declared type
  without a picker, had the baseline for its hashed thread identifier, permitted a read after a
  working-directory change, and reported every breaking-glass layer active. Managed restart-guard
  routing and pass/block enforcement are therefore *measured* on this Codex surface; other Codex
  surfaces remain unmeasured.
  *Amended 2026-10-05 (ADR-0028, proposed):* on the owner's decision that no lock may require
  per-request or expiring waivers, the restart guard, the per-layer switches and `/breaking-glass`
  are removed from the source; a hook is turned off only by the administrator editing the admin
  layer with `sudo`. The ADR-0022 restart rule stays as a brief instruction. The removal is
  *written and tested* in throwaway homes and roots; **not installed**: the reference machine runs
  the restart guard and the switches until the owner runs the admin-layer installer in a fresh
  session ([runbook](docs/runbooks/breaking-glass.md)). The measurements above stay true of what is
  installed until then.
- **Conversation profile** (ADR-0019, 2026-10-02): paced clarification, concise output, scoped input
  retrieval, and three risk/benefit choices are installed in the user briefs for Claude Code, Codex
  and Kiro, and saved in Claude desktop account instructions. The brief was loaded into the current
  Codex app session. ~~The Claude Code picker guard's option-count extension is installed and passes
  synthetic tests; live runtime routing was not re-measured.~~ Cadence, risk/benefit semantics and token
  discipline remain instructions, with no universal mechanical enforcement or hard token ceiling.
  *Amended 2026-10-05 (Issue #60):* the three options are now one extreme, the opposite extreme and
  the middle ground (*"eu quero 3 opcoes da seguinte forma: extremo 1, extremo 2, meio termo."*), and
  the option-count check is removed with the picker guard: every interaction standard is an
  instruction. *Written* in the source and the regenerated overlay; the installed briefs change only
  when the owner reinstalls.
- **`./workstation` entry point and version key** (ADR-0030, proposed, 2026-10-05; Issues #57, #67):
  `install`, `install --admin`, `status`, `check`, `update` and `uninstall` over the existing installers,
  plus `.workstation-version` and a user-brief instruction to compare it at session start. *Written and
  tested*, and probed in throwaway homes, a throwaway admin root and their own synthetic clones. The
  instruction is measured present in the Codex model-visible prompt and in the brief Claude Code loads;
  whether a model follows it is not measured. **Not installed** and not run on the reference machine.
  `status` reports what the installed files register, at the *installed* level only; loaded and enforced
  need a session canary.
- **Prerequisites check** (ADR-0030 amendment, 2026-10-05; Issue #89, check-only): the versioned
  declaration `global/prerequisites.json` and a prerequisites section in `./workstation check`
  (present or missing, authenticated or not, drift from the preferred settings, the manual step per
  gap; a missing required item exits non-zero). *Written and tested* with fake tool shims in a
  throwaway home; one read-only real run of `gh auth status` and the merge-settings `--check`. It
  applies nothing. The SonarCloud and HCP Terraform probes are not run against the real services.
- **Session-start runtime summary** (ADR-0030 amendment, 2026-10-05; Issue #80): `./workstation status
  --summary` and a user-brief section telling every agent harness to state the runtime configuration in
  its first reply, pointing to Claude Code `/status`, Codex `/status` and Kiro `/context show` and
  `/tools`. *Written and tested*; the section is measured present in the Codex model-visible prompt and
  rendered into all three briefs in a throwaway home. No status line and no hook. Whether a model
  follows it is not measured. **Not installed** on the reference machine.
- **Inner-loop pre-authorisation** (ADR-0031, proposed, 2026-10-05; Issue #83): one source,
  `global/allow-list.conf` (plus the owner overlay's test suites), rendered at user level as Claude Code
  `permissions.allow`, `permissions.deny` and `permissions.defaultMode`, a Codex rules file (loaded in
  every session, measured) and a `workstation` profile file, and a Kiro `workstation` agent. The narrow
  tier is ten read routes. The wide tier is the full inner loop, by the owner's decision on #83: git
  read routes, `git add --`, `git commit -m`, branch creation, fetch, the repository's suites by script,
  `acceptEdits` and `workspace-write`, with the escaping options (`--no-index`, `--output`, ...) denied
  as prefixes. It is rendered only while the root-owned admin deny floor is complete, because a test
  runner runs repository code without a prompt: his accepted trade-off. The installer refuses
  standalone shells and interpreters, `./workstation`, and the publishing routes. `git push` is not
  pre-authorised; the owner overlay floor now denies the `-u`, `--set-upstream` and `main:main` trunk
  forms, and the trunk's real perimeter is a server-side rule he has not decided. *Written and tested*
  in throwaway homes and a throwaway admin root; the Claude Code mode and the Codex rules and profile
  are *measured loaded* headless, and Codex's decisions are measured with `execpolicy check`. Whether an
  allowed command runs without a prompt in a live session is **not measured** (it needs a login).
  **Not installed** on the reference machine.
- **Working method at user level** (ADR-0032, proposed, 2026-10-05; Issue #61): 8 agents, 12 skills
  and 2 commands moved from the plugin into `method/`, rendered by `global/method/method_render.py` as
  `install.sh`'s own step (and `install.ps1`'s on Windows) into Claude Code, Codex and Kiro user-level
  carriers, each file stamped (ADR-0029). **Opt-in** (`./workstation install --method`) until the
  plugin cutover; `status` names a duplicate when the plugin is also enabled. The hook-era text is
  marked as the retired plugin's, and its rules are instructions. *Written and tested*, and probed in throwaway homes: Claude Code 2.1.289 lists the agents,
  skills and commands and applies each agent's tool list; Codex 0.160.0 lists the skills and hides the
  command skills from implicit use; Codex agents and every Kiro cell are documented only (Kiro needs a
  login). Codex agents carry no tool list: there it is an instruction. **Not installed** on the
  reference machine; the plugin stays the running copy until #62 and #63.
