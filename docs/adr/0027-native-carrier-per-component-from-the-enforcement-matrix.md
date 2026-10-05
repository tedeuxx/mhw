# ADR-0027: Each component class uses the native carrier the enforcement matrix names

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead, from the matrix it measured)
- **Builds on:** [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md),
  [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md),
  [ADR-0026](0026-four-distribution-layers-rubric.md)
- **Evidence:** [`docs/native-enforcement-matrix.md`](../native-enforcement-matrix.md)
- **Issue:** [#55](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/55)

## Context and problem

The requirements document's golden rule is native first: each behaviour is carried by the closest
native component of each agent harness, and a gap is stated rather than filled with a hook. Until now
the mapping from component class to native carrier was read from vendor pages, not checked on the
installed versions. Later slices (#56 to #78) each need that mapping to choose a mechanism.

The matrix measured Claude Code 2.1.289 and Codex 0.160.0 in throwaway homes and read the vendor
documentation for Kiro and the desktop apps. Several results differ from what the requirements
document assumed:

- a user-level deny floor is dropped by a session flag in Claude Code (`--setting-sources project`,
  measured) and Codex (`codex exec --ignore-rules`, help text);
- Kiro documents an admin file, `/Library/Application Support/Kiro/managed-settings.json`, but its
  permission model runs only in Kiro IDE 1.x and the opt-in Kiro CLI V3 engine;
- the Kiro IDE does not list CLI prompt files as commands; skills are commands in both;
- Codex custom agents have no tool list;
- Kiro reports credits, not tokens.

## Decision drivers

- Golden rule: native first, the same level across agent harnesses.
- Hard locks only for irreversible or third-party harm; such a lock must sit where an agent cannot
  switch it off.
- One source text per component, rendered into each agent harness.
- Report the real evidence level for every claim.

## Considered options

1. **Adopt the matrix as the carrier map, with its gaps stated (chosen).** Each later slice takes its
   carrier from the matrix and names the gap where the matrix shows none. *Trade-off:* most Kiro and
   desktop cells are documented, not measured, so a slice may later find a cell wrong.
2. **Keep the requirements document's carriers as written.** *Trade-off:* no rework now, but Kiro IDE
   users get no commands, the deny floor stays skippable by a flag, and connector access per agent is
   claimed for Codex where no tool list exists.
3. **Fill each gap with a custom hook.** *Trade-off:* uniform on paper, but it contradicts the hook
   budget, and a hook is itself skippable by flags such as Claude Code `--bare` (measured to skip the
   managed `SessionStart` hook event).

## Decision outcome

Chosen: option 1. Concretely:

| Component class | Claude Code | Codex | Kiro |
| --- | --- | --- | --- |
| Owner-typed command | command file | skill with implicit invocation off | **skill** (CLI and IDE), not a prompt file |
| Agent and its tools | agent file with `tools` | custom agent file; tools narrowed only through `mcp_servers` and sandbox | agent file with `tools` and `allowedTools` |
| Irreversible-action deny | admin layer, so no session flag removes it | admin `requirements.toml` rules, for the same reason | admin `managed-settings.json`, effective in IDE and CLI V3 only |
| Token record | headless result fields, `/usage`, OpenTelemetry | `/status`, OpenTelemetry | credits only |
| Session goal | native `/goal` | native `/goal` | native `/goal` (CLI) |

The deny-floor row is a recommendation to the open decision #59, not a decision taken here; the owner
decides it. *(2026-10-05: the owner approved #59; the rendering is ADR-0016's 2026-10-05 amendment,
proposed.)*

## Consequences

- Good: every later slice starts from one map with evidence labels, instead of re-reading vendor pages.
- Good: the deny floor's weakest point (a session flag) is named before #59 is decided.
- Bad: Kiro has no measured cell. Until the owner logs in inside a throwaway Kiro profile
  (`KIRO_HOME`), every Kiro row rests on vendor documentation.
- Bad: on the installed Kiro CLI (default `v2` engine) the admin file and `permissions.yaml` are inert;
  parity needs the owner to opt into V3.
- Bad: no cell was exercised with a model call, so "loaded" is shown and "obeyed" is not.

## Links

- [`docs/native-enforcement-matrix.md`](../native-enforcement-matrix.md)
- [Requirements document, section 10](../personal-multi-harness-workstation-configuration-product-requirements-document-project.md#10-native-enforcement-matrix)
- Issues #56 to #78 in the matrix's "Consequences for later slices" table.
