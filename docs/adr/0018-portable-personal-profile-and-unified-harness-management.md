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

## Links

- [New workstation installation](../new-workstation.md).
- ADR-0001 (MADR), ADR-0007 (model defaults), ADR-0010 (global brief), ADR-0013 (HITL),
  ADR-0014 (plugin boundary), ADR-0016 (deny floor), ADR-0017 (MCP rendering).
- [Owner profile](../../overlay/AGENTS.md).
