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

1. ~~**Ratify the proposed records** below, or the proposed parts of the partly accepted ones.~~
   *Done 2026-11-17 ([#24](https://github.com/tedeuxx/mhw/issues/24)): the owner ratified ADR-0002, 0003
   (without the local proxy), 0007, 0009, 0017, 0032 and 0034 one at a time, and the sixteen records of
   the [agent's reading](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6962024135) at once. No
   record in this index is proposed. Outside that list, the text of three records still uses the word
   for a part: ADR-0005 (the notice constraints), ADR-0013 (the 280-character reading of "tweet", whose
   2026-10-05 amendment ratified every limit as an instruction) and ADR-0015 (its 2026-11-08 amendment).
   ~~Whether each is still open is not settled here.~~ The owner ratified all three on 2026-11-18, one at
   a time: [ADR-0005](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6977796759), [ADR-0013](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6978101143) and [ADR-0015](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6978107613). No ADR part is left proposed.*
2. ~~**The ten commandments** ([#77](https://github.com/tedeuxx/mhw/issues/77)):
   edit and ratify the draft in the requirements document, section 1c. Nothing is installed before that.~~
   *Ratified on 2026-11-01; carried at the top of `global/AGENTS.md`. Installing it is the owner's act.*
3. **The cross-repository write credential** for the plugin mirror
   ([#62](https://github.com/tedeuxx/mhw/issues/62)):
   create it, scoped to the plugin repository only, and store it as a secret here. The agent names it
   and never sees the value.
4. **The agent runtime interview** ([#79](https://github.com/tedeuxx/mhw/issues/79)):
   local containers, cloud-ready, a web console. A new idea, not yet a slice; it goes through the
   requirements route first.
5. ~~**Ratify ADR-0043** ([#522](https://github.com/tedeuxx/mhw/issues/522)): the batch confirmation
   for backlog grooming and its safeguards. Since 2026-11-20 it is the one record in this index that is
   proposed. The switch to `scrum` it records is already the owner's ruling.~~
   *Ratified on 2026-11-20 ([«Ratificar»](https://github.com/tedeuxx/mhw/issues/522#issuecomment-7050932440)).
   ~~No record in this index is proposed.~~ ADR-0044 is, since #523 (ask 6), and ADR-0042, since #487 (ask 7).*
6. **Ratify [ADR-0044](0044-documentation-and-dod-baseline-with-an-add-only-override.md)** and
   ADR-0015's 2026-11-20 amendment ([#523](https://github.com/tedeuxx/mhw/issues/523)): the
   documentation baseline, its check and the add-only override. Both are proposed and agent-written.
7. **Ratify ADR-0042** ([#487](https://github.com/tedeuxx/mhw/issues/487), PR #521): node-pty 1.1.0
   vendored as the paste wrapper's pty, with the macOS binaries byte-identical to npm and the Linux ones
   built by this repository's CI from the pinned source (no npm integrity covers those). The Linux build
   is already the owner's decision on PR #521; the record as a whole is proposed.

## Index

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-decisions-as-madr.md) | Record significant decisions as MADR records | accepted |
| [0002](0002-automatic-semver-cut-policy.md) | Numeric SemVer on every merge to `main`, with a cut policy | ~~proposed (the cut table)~~ accepted 2026-11-17 (the 2026-10-10 cut table) |
| [0003](0003-distribution-requirements-access-modes.md) | Distribution requirements: supported access modes | ~~proposed~~ accepted 2026-11-17; the local proxy rejected |
| [0004](0004-stoic-ethical-foundation.md) | Stoic ethics as the ethical foundation | accepted; the Courage row amended 2026-11-17 (#30) |
| [0005](0005-detection-response-hitl-without-log.md) | On detection: owner in the loop, no record kept | accepted |
| [0006](0006-coverage-scope-all-agent-surfaces.md) | Coverage: every agent surface of both vendor families | accepted |
| [0007](0007-session-start-model-and-effort-defaults.md) | Session-start model and effort defaults per surface | ~~proposed~~ accepted 2026-11-17 (medium effort, Codex included) |
| [0008](0008-personal-workstation-no-confidential-persistence.md) | No employer or client confidential data persisted | accepted |
| [0009](0009-what-is-mine-individual-knowledge-vs-third-party-property.md) | What is his: individual knowledge versus third-party property | ~~proposed~~ accepted 2026-11-17, in full |
| [0010](0010-global-brief-rendered-to-each-harness.md) | One global brief rendered to each agent harness | accepted |
| [0011](0011-clipboard-prompt-anonymisation.md) | Clipboard prompts cleaned automatically (watcher, then hook, then wrapper) | superseded by 0033 |
| [0012](0012-operational-judgement-delegated-to-the-harness.md) | Operational judgement delegated to the agent harness | accepted; the operating rule ~~proposed~~ accepted 2026-11-17 |
| [0013](0013-hitl-escalation-calibration.md) | Escalation calibration; the picker guard removed | accepted; the guard removed 2026-10-05 |
| [0014](0014-purpose-boundary-firewall-vs-plugin.md) | This repository is the firewall, the plugin the way of working | accepted, in full 2026-11-17; reversed in part by ~~the proposed~~ the accepted 0032 |
| [0015](0015-master-of-first-principles-ethical-locks-on-own-aims.md) | Ethical locks on the owner's own aims | accepted; first concrete lock ratified 2026-10-17 |
| [0016](0016-user-level-deny-floor-rendered-per-harness.md) | The deny floor, rendered per agent harness | accepted; the admin-layer amendment and the 2026-10-24 presence amendment (0040) ~~proposed~~ accepted 2026-11-17 |
| [0017](0017-single-source-mcp-with-secret-indirection.md) | One MCP definition, credentials from the OS secret store | ~~proposed~~ accepted 2026-11-17 |
| [0018](0018-portable-personal-profile-and-unified-harness-management.md) | Portable personal profile (the owner overlay) | ~~proposed design~~ accepted 2026-11-17 |
| [0019](0019-paced-conversation-and-three-path-decisions.md) | Paced conversation and three-option decisions | accepted preferences |
| [0020](0020-desktop-preference-convergence.md) | Desktop app preferences converge | accepted requirement; settings ~~proposed~~ accepted 2026-11-17 |
| [0021](0021-workspace-session-intake-and-ci-publication.md) | Session intake and publication; intake removed, `rc/next` route | accepted requirements; amended 2026-10-05 |
| [0022](0022-restart-after-active-customization-changes.md) | Restart after configuration changes | accepted requirement; an instruction only |
| [0023](0023-breaking-glass-all-layers-native-switch.md) | Total breaking glass through each native switch | ~~proposed~~ accepted 2026-11-17; ended 2026-10-04 |
| [0024](0024-breaking-glass-per-layer-expiring-switches.md) | Expiring per-layer switches | superseded by 0028 |
| [0025](0025-hook-layers-in-the-native-admin-layer.md) | Hooks in each agent harness's admin layer | ~~proposed~~ accepted 2026-11-17; restart-guard and switch parts superseded by 0028 |
| [0026](0026-four-distribution-layers-rubric.md) | Four distribution layers and the placement rubric; `distribution.json` applies it (2026-10-11) | accepted 2026-10-11; parts changed by 0035 (accepted) and by ~~the proposed~~ the accepted (2026-11-17) 0027, 0028, 0032~~, 0036~~ and the accepted 0036 |
| [0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md) | Native carrier per component, from the enforcement matrix | ~~proposed~~ accepted 2026-11-17 |
| [0028](0028-remove-restart-guard-and-expiring-switches-os-privilege-only.md) | Restart guard and switches removed; OS privilege only | ~~proposed~~ accepted 2026-11-17 |
| [0029](0029-provenance-stamp-in-every-installed-file.md) | Provenance stamp in every installed file | ~~proposed~~ accepted 2026-11-17 |
| [0030](0030-version-key-and-one-entry-point.md) | Version key and the `./workstation` entry point | ~~proposed~~ accepted 2026-11-17 |
| [0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md) | Inner-loop pre-authorisation behind the admin floor | ~~proposed~~ accepted 2026-11-17 |
| [0032](0032-this-repository-is-the-single-source-of-the-working-method.md) | This repository is the single source of the working method | ~~proposed~~ accepted 2026-11-17 |
| [0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md) | Paste cleaning: wrapper first, prompt hook as safety net | ~~proposed~~ accepted 2026-11-17; supersedes 0011 |
| [0034](0034-npm-distribution-from-github-by-tag.md) | npm distribution from GitHub by tag, with an archive stamp; the `mhw` command and its postinstall (2026-10-06) | ~~proposed~~ accepted 2026-11-17 |
| [0035](0035-workstation-blueprint-reconciliation.md) | Workstation harness blueprint reconciled item by item (2026-10-10) | accepted |
| [0036](0036-kiro-shared-deny-floor-permissions-yaml.md) | Kiro IDE and Kiro CLI share one deny floor in the user-level `permissions.yaml` (2026-10-11) | ~~proposed~~ accepted 2026-10-11 |
| [0037](0037-agents-md-is-the-only-root-brief.md) | `AGENTS.md` is the only root brief in every repository the owner authors; no `CLAUDE.md` (2026-10-11) | ~~proposed~~ accepted 2026-10-11 |
| [0038](0038-chrome-devtools-mcp-at-user-scope-bounded-by-origin.md) | A `chrome-devtools` MCP server at Claude Code user scope, pinned, ~~bounded by the project's declared origin~~ with no origin bound since its 2026-10-29 amendment D8 (2026-10-13) | accepted 2026-10-15 |
| [0039](0039-codex-managed-daemon-version-and-headroom.md) | Review Codex daemon descriptor configuration without managing it (2026-10-18) | ~~proposed~~ accepted 2026-11-17 |
| [0040](0040-presence-conditioned-secret-renewal-through-the-browser.md) | With the owner present, the agent may create or renew a secret through his browser, copying without reading; the Bash denies unchanged (2026-10-24) | ~~proposed~~ accepted 2026-11-17; ~~canary owed~~ real-page canary passed for the script route on 2026-10-29, rerun owed under the D8 launch |
| [0041](0041-mcp-active-set-native-switch-off-per-harness.md) | The MCP active set, turned off natively in each agent harness outside it (2026-10-24) | ~~proposed~~ accepted 2026-11-17 |
| [0042](0042-node-pty-vendored-for-the-paste-wrapper.md) | node-pty 1.1.0, vendored with its macOS prebuilds from npm and Linux pty.node built by our CI from the pinned source, is the paste wrapper's pty; where it cannot load the wrapper refuses visibly (2026-11-20, #487) | proposed |
| [0043](0043-backlog-grooming-batch-confirmation-and-scrum-for-mhw.md) | Backlog grooming closes and rewrites the owner's Issues on one batch confirmation, under safeguards; mhw runs `scrum`, scoped by `loop-mode-repos` (2026-11-20) | ~~proposed~~ accepted 2026-11-20 ([ratification](https://github.com/tedeuxx/mhw/issues/522#issuecomment-7050932440)) |
| [0044](0044-documentation-and-dod-baseline-with-an-add-only-override.md) | A declared documentation baseline kept current by every merge request (`mhw docs-baseline check`, `mhw onboard`), and an add-only test/DoD override in `project-policy.json` with a coverage floor of 85; amends 0015 (2026-11-20) | proposed |
