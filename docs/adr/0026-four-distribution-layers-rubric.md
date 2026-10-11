# ADR-0026: Four distribution layers and the rubric that places each artifact

- **Status:** ~~proposed~~ ~~accepted (ratified by the owner, 2026-10-04)~~ accepted (2026-10-11, the
  owner's ratification in session; see the amendment "accepted" below, which also says why the
  2026-10-04 date is struck)
- **Date:** 2026-10-04
- **Deciders:** the owner
- **Refines:** [ADR-0014](0014-purpose-boundary-firewall-vs-plugin.md) (its two-way split becomes four layers)
- **Builds on:** [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md),
  [ADR-0021](0021-workspace-session-intake-and-ci-publication.md),
  [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md)

## Context and problem

ADR-0014 split the work into two parts: this repository is the firewall and the plugin is the way of
working. Workstation v2 (ADR-0025) then added a third carrier, each harness's native admin layer. The
workspace session contract (ADR-0021) added a fourth, one repository's own configuration. Nothing
says which of the four carriers an artifact belongs in. As a result:

- some protections exist twice. The plugin's permission guard carries floor rules that overlap this
  repository's deny floor and hooks. When the two copies disagree, the plugin's copy refuses
  something the floor allows, as Bash command substitution showed on 2026-10-04;
- a protection can sit in a layer the owner can switch off with no privilege, even when the harness
  offers an admin-only layer;
- no check can catch a misplaced artifact, because no rule defines what "misplaced" means.

The owner agreed on 2026-10-04 that the next improvement session starts with this rubric. The
manifests, the inventory and the dehydration all depend on it.

## Decision drivers

- One protection lives in exactly one place, so it cannot drift from a copy of itself.
- A protection sits in the strongest layer its harness supports natively. Where a harness offers no
  such layer, the gap is stated, never hidden (AGENTS.md, principle 1).
- Moving an artifact between layers never leaves a window in which neither layer protects.
- Placement must be decidable from the artifact itself, so a CI check can enforce it later.

## Considered options

1. **Four layers with an ordered placement test (chosen).** Each artifact is tested against the
   layers from the strongest down and lands in the first one that fits.
   - Good: it is decidable, it maps one-to-one onto native mechanisms, and it gives a CI check
     something to enforce.
   - Bad: it forces explicit placement, including for artifacts that work today without one, and it
     makes the Kiro gap visible because Kiro has no admin layer for hooks (ADR-0024).
2. **Keep ADR-0014's two-way split and decide case by case.**
   - Good: no new record, and no migration.
   - Bad: duplication is never detected, the managed layer has no criterion for entry, and the
     command-substitution conflict recurs with every new guard.
3. **Three layers, with no separate user layer.** Every cross-project artifact would be managed.
   - Good: fewer layers.
   - Bad: preferences would become root-owned. Changing them would need sudo, and
     `/breaking-glass` would grow to cover non-protections. Least privilege, applied to the owner
     himself, argues against it.

## Decision outcome

~~**Proposed: option 1.**~~ **Chosen: option 1** (accepted 2026-10-11).

### The layers

| Layer | Holds | Native carrier | Lives in | May it weaken a layer above? |
| --- | --- | --- | --- | --- |
| **managed** | A protection that nothing may weaken | The harness's admin-only layer: Claude Code `managed-settings`, Codex `/etc/codex/requirements.toml` | This repository, installed by `install-managed.sh` | It is the top layer |
| **user** | Applies to every project but is not a floor: the global brief, the owner overlay, preferences, cross-project commands | `~/.claude`, `~/.codex`, `~/.kiro` | This repository, installed by `install.sh` | No |
| **workspace** | One repository's own contract, such as session intake or that repository's CI publication | That repository's `AGENTS.md`, `.claude/`, `.codex/`, `.kiro/` | The repository it governs | No |
| **plugin** | The way of working: personas, the delivery loop, skills, workflow commands and hooks | The `tadeumendonca-skills` plugin | The plugin repository | No |

### The placement test

Apply the questions in order. The artifact goes into the layer at the first "yes".

1. **Does it protect the owner or a third party, so that switching it off would be a risk and not
   just an inconvenience?** Then it is **managed**.
   - If the harness offers no admin-only carrier for this artifact type, it is installed at user
     level as **managed-class**. The gap is declared next to it and is not reclassified as a
     preference.
2. **Should it apply in every project on the workstation?** Then it is **user**.
3. **Does it hold only for one repository?** Then it is **workspace**, in that repository.
4. **Otherwise** it is a way of working, and it is **plugin**.

### Rules

- **One layer per artifact.** An artifact declared in two layers, or a rule copied into a lower
  layer, is a defect. The lower copy is removed.
- **Stricter wins.** This rule is unchanged from ADR-0014. It now applies across all four layers.
- **Promote, then remove.** An artifact moves upward in paired changes. The new layer installs it,
  and it is verified at least *installed*. Only then does the old layer remove its copy. A protection
  is never removed first.
- **Placement by repository.** Managed and user artifacts live in this repository, workspace
  artifacts in the repository they govern, and plugin artifacts in the plugin repository.
- **Evidence.** An artifact's declared layer is a claim about its *intent*. Whether it is installed,
  loaded or enforced at that layer is reported separately, at its measured level.

### Out of scope here

The manifest format, the CI check and the inventory of the plugin's artifacts are separate changes
that apply this rubric. This record decides no individual artifact's placement.

## Consequences

- Good: duplicated protections can be found mechanically once each repository declares its
  artifacts against these layers.
- Good: the command-substitution refusal gets a principled fix. The floor part of the plugin guard
  moves to this repository, and the plugin keeps only the way-of-working part.
- Good: entry into the managed layer, and so the scope of `/breaking-glass`, has a written criterion.
- Bad: every existing artifact needs a declared layer before the check can turn on.
- Bad: Kiro's managed-class artifacts stay at user level. The rubric names that gap but cannot
  close it.
- Bad: promotion is two pull requests in two repositories for each artifact, which is slower than a
  single edit.

## Amendment 2026-10-11: accepted

**Ratified by the owner on 2026-10-11, in session.** He chose to turn the uncommitted ratification
edit and the manifest into a pull request rather than park or discard them. This pull request is the
first recorded trace of the ratification.

**Why the 2026-10-04 date is struck.** A local edit, never committed, set the status to *"accepted
(ratified by the owner, 2026-10-04)"*. No Issue comment, pull request or commit records a ratification
on that date: `rc/next` carried this record as `proposed` until this change, and the index said the
same. A date with no trace is not evidence, so the record dates its acceptance to 2026-10-11. The
struck text stays in the status line so the earlier claim remains visible.

**What later records change here.** Read this record together with them. None of the proposed ones is
in force until the owner ratifies it.

- [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md) (proposed) fills in the
  *Native carrier* column per component class, from the measured enforcement matrix.
- [ADR-0028](0028-remove-restart-guard-and-expiring-switches-os-privilege-only.md) (proposed) removes
  `/breaking-glass` and the expiring switches. The criterion for entering the managed layer stands.
  The phrase *"the scope of `/breaking-glass`"* in Consequences, and the `/breaking-glass` argument in
  option 3, name a command that no longer exists. The code at this record's acceptance already works
  that way: OS privilege is the only way to turn a managed hook off. ADR-0028 itself is still
  proposed, so the decision behind that code awaits the owner's ratification.
- [ADR-0032](0032-this-repository-is-the-single-source-of-the-working-method.md) (proposed) moves the
  working method (agents, skills, commands) from the plugin into this repository, rendered at user
  level. Placement test question 2 already puts it there, since the method applies in every project.
  ADR-0032 is proposed, so this change is not yet in force.
  Once ADR-0032 is accepted, the **plugin** row of the layer table and the plugin clause of
  *Placement by repository* are superseded for those artifacts. Until the plugin cutover, the method
  installed alongside the enabled plugin is a copy in two layers, the defect *One layer per artifact*
  names. `mhw status` reports it as `DUPLICATE`.
- [ADR-0035](0035-workstation-blueprint-reconciliation.md) (accepted) decision 6, *hooks only for
  existential risk*, narrows which hooks may enter the managed layer. It is consistent with placement
  test question 1.
- [ADR-0036](0036-kiro-shared-deny-floor-permissions-yaml.md) (proposed) and its 2026-10-11 amendment
  give Kiro an admin carrier for the **deny floor** (`managed-settings.json`). The Kiro gap named in
  option 1 and in Consequences is now narrower: Kiro still has no admin carrier for **hooks**
  ([ADR-0025](0025-hook-layers-in-the-native-admin-layer.md)).

**The manifest.** [`distribution.json`](../../distribution.json) applies this rubric to the files
`rc/next` tracks: every tracked file is listed in exactly one artifact, or in `not_distributed`.
That holds under one precedence rule, which the manifest states in its `path_rules` field: **a
`not_distributed` entry wins over an artifact's directory entry.** Without that rule, five test files
would sit in two places: `global/mcp/mcp_render_test.py`, `global/mcp/mcp_retire_test.py`,
`global/method/method_commands_test.py`, `global/method/method_render_test.py` and
`global/models/model_defaults_test.py`. Each matches both `*_test.py` and its component's directory.
Nothing reads it. No check, test or CI job consumes it, and this amendment adds none: a check would be
a new tool, owed its own record, as *Out of scope here* says. Each artifact's layer is the
implementing agent's application of the test and is open to the owner's correction. Like the record,
the manifest states intent, not what is installed.

**Two departures from this record's own layer table, ratified with it.** The manifest follows the
placement test where it disagrees with the examples in *The layers* table. The owner ratifies these
two departures together with the record:

1. **The global brief is `managed`, not `user`.** The table lists *"the global brief"* in the user
   row. The manifest places it as managed-class, with its gap declared. The reason is placement test
   question 1: the brief carries the firewall's mission and its protections, so switching it off would
   be a risk and not an inconvenience. Its clause on missing carriers then applies: no admin
   instruction carrier is used yet, so it is installed at user level, declared as managed-class, and
   not reclassified as a preference. The table row predates that reading.
2. **`.github/` is `not_distributed`, although the table gives *"that repository's CI publication"* as
   its workspace example.** Meanwhile `AGENTS.md`, `CLAUDE.md` and `workspace/` are classed
   `workspace`, though none of them is installed on a workstation either, so "not installed" is not
   the line between them. The line is the reader. Those files are read by an agent harness working in
   this repository, which makes them the repository's own contract with the harness. The workflows
   are read only by the forge's CI runner, which is not one of the four carriers. The table's CI
   example stays true for the publication contract written in `AGENTS.md` and `workspace/`; the
   workflow files that execute it are outside the four layers.

## Links

- [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md),
  [ADR-0028](0028-remove-restart-guard-and-expiring-switches-os-privilege-only.md),
  [ADR-0032](0032-this-repository-is-the-single-source-of-the-working-method.md),
  [ADR-0035](0035-workstation-blueprint-reconciliation.md),
  [ADR-0036](0036-kiro-shared-deny-floor-permissions-yaml.md): later records that change parts of this
  one (see the amendment above)
- [ADR-0014](0014-purpose-boundary-firewall-vs-plugin.md): firewall versus plugin, refined here
- [ADR-0024](0024-breaking-glass-per-layer-expiring-switches.md): native admin layers per harness
- [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md): the first artifacts placed in the managed layer
- [Restart handoff](../archive/restart-handoff.md): the four-step plan this record starts
