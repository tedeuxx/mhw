# Decision records

The Architecture Decision Records of this repository, in MADR format
([ADR-0001](0001-record-decisions-as-madr.md)). A record becomes `accepted` only when the owner ratifies
it. An accepted record is amended by appending and striking in place; a reversed one is superseded by a
new record and kept as its history.

This index is maintained by hand (Issue #65). The status column repeats each record's own `Status`
line in short form; where they differ, the record wins. Re-derive the list with
`grep -m1 -n 'Status' docs/adr/0*.md`.

## Owner asks still pending

Each is raised one at a time, when a slice reaches it.

1. **Ratify the proposed records** below, or the proposed parts of the partly accepted ones. The
   release candidate rests on proposed records: ADR-0026 to ADR-0033 are all proposed.
2. **The ten commandments** ([#77](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/77)):
   edit and ratify the draft in the requirements document, section 1c. Nothing is installed before that.
3. **The cross-repository write credential** for the plugin mirror
   ([#62](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/62)):
   create it, scoped to the plugin repository only, and store it as a secret here. The agent names it
   and never sees the value.
4. **The agent runtime interview** ([#79](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/79)):
   local containers, cloud-ready, a web console. A new idea, not yet a slice; it goes through the
   requirements route first.

## Index

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-decisions-as-madr.md) | Record significant decisions as MADR records | accepted |
| [0002](0002-automatic-semver-cut-policy.md) | Numeric SemVer on every merge to `main`, with a cut policy | proposed (the cut table) |
| [0003](0003-distribution-requirements-access-modes.md) | Distribution requirements: supported access modes | proposed |
| [0004](0004-stoic-ethical-foundation.md) | Stoic ethics as the ethical foundation | accepted |
| [0005](0005-detection-response-hitl-without-log.md) | On detection: owner in the loop, no record kept | accepted |
| [0006](0006-coverage-scope-all-agent-surfaces.md) | Coverage: every agent surface of both vendor families | accepted |
| [0007](0007-session-start-model-and-effort-defaults.md) | Session-start model and effort defaults per surface | proposed |
| [0008](0008-personal-workstation-no-confidential-persistence.md) | No employer or client confidential data persisted | accepted |
| [0009](0009-what-is-mine-individual-knowledge-vs-third-party-property.md) | What is his: individual knowledge versus third-party property | proposed |
| [0010](0010-global-brief-rendered-to-each-harness.md) | One global brief rendered to each agent harness | accepted |
| [0011](0011-clipboard-prompt-anonymisation.md) | Clipboard prompts cleaned automatically (watcher, then hook, then wrapper) | superseded by 0033 |
| [0012](0012-operational-judgement-delegated-to-the-harness.md) | Operational judgement delegated to the agent harness | accepted; the operating rule proposed |
| [0013](0013-hitl-escalation-calibration.md) | Escalation calibration; the picker guard removed | accepted; the guard removed 2026-10-05 |
| [0014](0014-purpose-boundary-firewall-vs-plugin.md) | This repository is the firewall, the plugin the way of working | accepted; reversed in part by the proposed 0032 |
| [0015](0015-master-of-first-principles-ethical-locks-on-own-aims.md) | Ethical locks on the owner's own aims | accepted framing; locks pending an interview |
| [0016](0016-user-level-deny-floor-rendered-per-harness.md) | The deny floor, rendered per agent harness | accepted; the admin-layer amendment proposed |
| [0017](0017-single-source-mcp-with-secret-indirection.md) | One MCP definition, credentials from the OS secret store | proposed |
| [0018](0018-portable-personal-profile-and-unified-harness-management.md) | Portable personal profile (the owner overlay) | proposed design |
| [0019](0019-paced-conversation-and-three-path-decisions.md) | Paced conversation and three-option decisions | accepted preferences |
| [0020](0020-desktop-preference-convergence.md) | Desktop app preferences converge | accepted requirement; settings proposed |
| [0021](0021-workspace-session-intake-and-ci-publication.md) | Session intake and publication; intake removed, `rc/next` route | accepted requirements; amended 2026-10-05 |
| [0022](0022-restart-after-active-customization-changes.md) | Restart after configuration changes | accepted requirement; an instruction only |
| [0023](0023-breaking-glass-all-layers-native-switch.md) | Total breaking glass through each native switch | proposed; ended 2026-10-04 |
| [0024](0024-breaking-glass-per-layer-expiring-switches.md) | Expiring per-layer switches | superseded by 0028 |
| [0025](0025-hook-layers-in-the-native-admin-layer.md) | Hooks in each agent harness's admin layer | proposed; restart-guard and switch parts superseded by 0028 |
| [0026](0026-four-distribution-layers-rubric.md) | Four distribution layers and the placement rubric | proposed |
| [0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md) | Native carrier per component, from the enforcement matrix | proposed |
| [0028](0028-remove-restart-guard-and-expiring-switches-os-privilege-only.md) | Restart guard and switches removed; OS privilege only | proposed |
| [0029](0029-provenance-stamp-in-every-installed-file.md) | Provenance stamp in every installed file | proposed |
| [0030](0030-version-key-and-one-entry-point.md) | Version key and the `./workstation` entry point | proposed |
| [0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md) | Inner-loop pre-authorisation behind the admin floor | proposed |
| [0032](0032-this-repository-is-the-single-source-of-the-working-method.md) | This repository is the single source of the working method | proposed |
| [0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md) | Paste cleaning: wrapper first, prompt hook as safety net | proposed; supersedes 0011 |
