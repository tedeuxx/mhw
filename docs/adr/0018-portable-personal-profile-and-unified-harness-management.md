# 0018 — Portable personal profile and unified harness management

- **Status:** proposed implementation design. The requirements below were explicitly requested by
  the owner on 2026-10-02; the technical design has not been ratified or installed.
- **Date:** 2026-10-02
- **Deciders:** the owner

## Context and problem

The owner wants a productive, consistent personal workstation across Kiro CLI, Codex CLI, Claude
Code CLI and the Claude desktop app, including Cowork. He wants to manage his preferences,
integrations and pre-authorizations once, through this Git repository, and make installation easy
for other people on compatible workstations.

### Owner requirements

| Requirement | State |
| --- | --- |
| Calibrate tone, brevity, language, financial preferences and interactions requiring his attention | Interview in progress |
| When a decision is needed, use an executive, concise tone: decision, impact, options, minimal explanation | Selected; written in `overlay/AGENTS.md`; not installed by this change |
| Prefer slash commands for directing workstation-level agent work | Required; command names and adapters remain proposed |
| Maintain one MCP definition across harnesses, without independent manual configuration per harness | Required; local stdio renderer exists under ADR-0017 |
| Start discovery from the integrations configured in Claude Cowork | Required; initial inspection completed, full mapping remains |
| Synchronize pre-authorizations for consistent session behavior | Required; no permission policy imported or changed |
| Align the default model and reasoning effort at session start across harnesses | Required; concrete defaults and quality/cost trade-offs remain pending under ADR-0007 |
| Version the configuration in this Git project | Required; secret values and confidential material remain excluded |
| Let other people install from this repository on compatible workstations | Required; partial installers already exist |
| Use `tadeumendonca-io` and `tadeumendonca-skills` as experience references and calibrate the meaning of harness customization from them | Source review recorded in `docs/harness-baseline.md`; no changes to the reference repositories |

No spending ceiling, financial authorization, blanket tool permission, default model change or
automatic publication permission was granted by this interview.

## Decision drivers

- One editable source for preferences, MCP definitions and permission intent.
- Preserve the firewall and the separation between workstation configuration and the plugin's
  delivery workflows (ADR-0014).
- Keep generic policy separate from the reference owner's preferences and other adopters' profiles.
- Do not mistake configuration presence or a connected badge for successful tool execution.
- Never silently widen permissions when a destination lacks an equivalent control.
- Make installation, updates, drift detection and recovery understandable to another adopter.

## Considered options

1. **Versioned source plus harness adapters and an explicit compatibility report.** Recommended.
   Each adapter generates its native format; account-side features need a separate integration or
   a clearly reported manual step. Trade-off: adapters and capability tests must be maintained.
2. **Maintain each harness independently using its native settings.** Strongest alternative: fastest
   initially and every setting is native. Rejected as the target because it preserves the repeated
   work and behavioral drift the owner wants to eliminate.
3. **Route every integration through a mandatory local gateway.** Could centralize some transport
   and authorization behavior. Not selected: adds a dependency and failure point, does not eliminate
   account-side authorization, and would need a separate security and compatibility decision.

## Decision outcome

**Proposed: option 1.** This is a design record, not an installation or permission grant.

### Git source and runtime state

Version generic policies, the reviewed non-secret personal profile, schemas, synthetic examples,
adapters, command definitions, tests, compatibility documentation and installation instructions.
Installed files are generated outputs; avoid independently editing four copies.

The owner's requirement also calls for a review of ADR-0017's untracked MCP source. Proposed
evolution: keep a reviewed, non-secret integration catalog in Git and bind it to private local
account identifiers and secret references at installation. Public product names are distinct from
private server aliases, account identifiers and endpoints. This change does not migrate that catalog,
change `.gitignore`, or copy the machine's current configuration into Git. ADR-0017 remains the
implemented behavior until a reviewed migration changes it.

Never version tokens, credential values, OAuth sessions, account exports, transcripts, confidential
material or raw application configurations. Runtime credentials belong in the supported secret store.
Git rollback restores configuration intent; it does not revoke OAuth grants or undo external actions.

### Commands

Use one documented meaning per workstation command, with native invocation syntax per harness.
Prefer slash commands where supported; document alternatives and reserved-name collisions. Proposed
examples are `/ws-mcp listar`, `/ws-mcp sincronizar` and `/ws-mcp verificar`. They do not exist yet.
Command arguments must pass the same firewall as ordinary prompts. Invocation is not a blanket grant
to install software, change credentials or expand access.

### MCPs and pre-authorizations

Use the Claude account/desktop integration list as a discovery baseline, supplemented by the local
MCP configuration. Distinguish local servers, remote MCP endpoints, account connectors and extensions.
Do not infer portability or permission equivalence merely from matching product names.

Represent permission intent per integration and operation as **allow**, **ask** or **deny**, with
resource scope where needed. Separately map filesystem access, shell commands and other native tools;
MCP permissions alone do not cover session autonomy. Preserve explicit denials and report conflicting
layers. Copying a broad wildcard is not a valid translation of a narrowly scoped approval.

For each destination, report whether the exact rule is supported, configured, loaded and measured.
An unsupported translation remains a visible gap; do not silently grant broader access to obtain
fewer prompts. Account OAuth consent, runtime approval, hook trust and tool availability are distinct.
Changing one does not establish the others, and consent may still require the owner's action.

### Session-start model and effort

Include the default model and reasoning effort in the versioned personal profile, with a concrete
mapping for each harness and supported desktop mode. Resolve only models available through the
adopter's chosen subscription/access mode. Do not assume that subscription access also funds API use.

The owner requested alignment, not identical model identifiers or identical effort labels across
vendors. Define the intended quality, latency and cost trade-off first; record the provider-specific
model and effort that implement it. The earlier top-model/medium-effort proposal in ADR-0007 remains
proposed. This interview has not selected that trade-off or authorized changing current defaults.

An adapter must report whether the default can be written locally, requires an account/UI setting,
or is unsupported. Verify the effective model and effort in a fresh session; distinguish configured
values from runtime evidence and explicit session overrides. If a model disappears or access changes,
report it instead of silently switching to a billed API, buying credits or weakening a protection.

### Installation and compatibility

Build on the existing shell and PowerShell installers. The proposed unified path is: inspect
prerequisites and installed harness versions; select or create an adopter profile; preview changes;
apply supported adapters; verify loading and behavior; report gaps and remaining owner actions.

Installation must be repeatable, preserve unrelated settings, refuse unmanaged conflicts, expose
updates and drift, and document recovery. It must not reuse the reference owner's accounts,
pre-authorizations, paid subscriptions or credentials for another adopter. Financial defaults remain
pending, so installing the project cannot authorize billable services or purchases.

macOS remains the reference; Linux and Windows remain portability targets with per-feature gaps.
Declare minimum versions only with their evidence basis: measured, documented or assumed. Do not
claim the desktop app exists on every OS or that all four harnesses provide identical controls.

### Initial evidence, 2026-10-02

- The Claude desktop app's **Customize > Connectors > Yours** interface exposed 36 entries. This is
  an observed list size, not a count of operational or portable MCP servers.
- The desktop local MCP configuration contained 12 entries. The two counts overlap and must not be
  added. Some integration names were withheld from model-visible output pending classification.
- The UI showed a reconnection request and a local-server disconnection notice. Their relationship
  was not established, and no repair or reconnection was attempted.
- One public file-service connector's permissions were inspected: six read operations were set to
  **Always allow**; five write/delete operations were set to **Needs approval**. This is one observed
  configuration, not an owner-approved default for every integration or proof of enforcement.
- No connector operation was invoked, secret exported, permission changed or real configuration
  synchronized. No account-specific inventory or raw screen content is retained in this repository.

### Delivery and acceptance

1. Finish the personal-preference interview and review the complete safe integration inventory.
2. Define and validate the versioned catalog, authorization schema and model/effort mapping, including
   remote connectors and explicit unsupported cases; resolve the ADR-0017 source-location change.
3. Implement adapters and command entry points using synthetic configurations first.
4. Provide one onboarding route with preview, install, verification, update and recovery instructions.
5. In fresh sessions per supported OS/harness, demonstrate a permitted operation and an expected
   approval or refusal. Publish only synthetic test evidence, never detection content or secrets.
6. Install on the reference machine only within the existing owner-action and trust boundaries.

## Consequences

- Good: a newcomer has one documented installation route and the owner has one configuration source.
- Good: permission differences become reviewable instead of producing silent behavior changes.
- Bad: adapters, vendor account settings and OAuth consent cannot all be treated as ordinary files.
- Bad: a common policy cannot guarantee identical UX or enforcement across different harnesses.
- Bad: the full setup is not implemented by this documentation change. Existing installers remain
  partial; the linked guide explicitly names that boundary.

## Amendment 2026-10-02: first executable slice and balanced session intent

After reviewing the recorded baseline, the owner instructed the agent to continue. In the next
decision he selected **balanced**: good quality, moderate waiting time and restrained use of the
subscription allowance. This settles the intended trade-off, not a particular provider model,
effort label, paid API route or financial authorization. The earlier statement that the trade-off
was pending is historical; concrete model/effort mappings are still pending under ADR-0007.

The first implementation is `global/profile/profile.py`, a Python 3.9+ standard-library compiler
with a closed JSON vocabulary. `overlay/profile.json` is the reference preference source. It generates
the owner brief, HITL limit/notices, paste-filter notice localization, full desktop instruction
handoff and a capability/limitations plan. The existing one-ask floor and filter categories stay in
their existing sources. The 280-character limit preserves the previous overlay value; this amendment
does not newly ratify its original numerical interpretation.

The compiler supports validation, read-only planning, generation and drift checks. It refuses
unmanaged targets and symlinks, preserves unrelated files, and writes generated artifacts atomically
per file. An interrupted multi-file render needs a check and rerender; no bundle transaction is claimed.
Generated files carry source markers and are versioned beside the source. Another adopter can start
from the generic example instead of inheriting the owner's preferences.

Both native installers now check a structured overlay before writing targets; changing `profile.json`
without regenerating refuses installation. Python 3.9+ is therefore an additional prerequisite on
Windows when using a structured overlay. Hand-authored overlays and the `none` option retain their
previous requirements. The compiler was exercised with Python 3.9.6 and 3.14.6 on macOS; Windows
installer changes await the configured CI run.

**Scope:** written and exercised on the local macOS host with synthetic fixtures. Generated reference
artifacts are in Git; they are not installed into the real harnesses by this change. Desktop output
is prepared text, not an account-settings update. Native model defaults, MCP migration, permission
adapters and slash-command registration remain pending. A declared `surfaces` list is an intention
report, not a filter for the existing installers, which still target every supported CLI.

The compiler tests exercise invalid inputs, redacted diagnostics, locale consistency, floor
preservation, drift, idempotence, conflicts and newline compatibility. CI coverage is configured for
macOS, Ubuntu and Windows; that configuration alone is not a successful CI run. The existing
installer suite is also run against throwaway homes after changing the generated overlay.

The broader design remains proposed where the owner has not selected concrete behavior. This slice
adds no new permission grant, financial approval, account connection or trust change.

## Links

- [Profile compiler and contract](../../global/profile/README.md).
- [Harness and customization baseline](../harness-baseline.md).
- [New workstation installation](../new-workstation.md).
- ADR-0001 (MADR), ADR-0007 (model defaults), ADR-0010 (global brief), ADR-0013 (HITL),
  ADR-0014 (plugin boundary), ADR-0016 (deny floor), ADR-0017 (MCP rendering).
- [Owner profile](../../overlay/AGENTS.md).

## Amendment — 2026-10-02: user-level conversation preferences installed

Following the owner's explicit request for user-level paced conversation and three risk/benefit
choices across workstation projects, the generated profile was installed into all three user brief
locations by `global/install.sh`; the subsequent `--check` passed. The new instructions were supplied
to the current Codex app session, establishing loading here only. The generated owner-overlay block
was also appended to Claude desktop's account-level **Instructions for Claude** through its UI:
the previous text remained present and the UI reported **Saved**. Automatic account synchronization
and behavioral enforcement were not established. ADR-0019 records the control and its coverage.

## Amendment 2026-10-05: no HITL limits file is generated ([Issue #60](https://github.com/tedeuxx/mhw/issues/60))

The compiler no longer generates `hitl.conf`: the picker guard that read it is removed (ADR-0013,
2026-10-05 amendment). The owner's question-length limit and three-option rule are rendered into the
generated brief as instructions. The generated artifacts are now `AGENTS.md`, `clipboard.conf`,
`desktop-instructions.md` and `profile-plan.json`; a stale `hitl.conf` in an output directory is left
alone and ignored.
