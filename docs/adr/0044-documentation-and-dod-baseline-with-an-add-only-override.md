# ADR-0044: A declared documentation baseline kept current by every merge request, and an add-only test/DoD override

- **Status:** proposed (agent-written, awaiting the owner's ratification). The owner decided where the
  override lives on 2026-11-20 ([his answer on Issue #523](https://github.com/tedeuxx/mhw/issues/523));
  the rest of this record is the implementing agent's design.
- **Date:** 2026-11-20
- **Deciders:** the owner (the request and the override's home); written by `agents-lead`, the lens for
  the `loop` lane
- **Issues:** [#523](https://github.com/tedeuxx/mhw/issues/523)
- **Amends:** [ADR-0015](0015-master-of-first-principles-ethical-locks-on-own-aims.md), by an appended
  amendment: the project-policy contract gains the optional add-only `baseline_override` section and a
  coverage floor of 85.

## Context and problem

The owner, on Issue #523 (2026-11-20):

> «outro ponto importante é que nenhum MR deixe de atualizar o baseline de documentacao existente em
> todo repo com as funcionalidades mantidas pelo repo/app. ao configurar o projeto (onboarding) voce
> deve validar e implementar um baseline de documentacao, com uma proposicao padrao (madrs, prds,
> diagramas mermaid, readme.md). o mesmo deve valer para um baseline de testes/dod, que pode ser
> customizado com override baseado no baseline do mhw.»

In English: no merge request may skip updating the repository's documentation baseline for the
features it maintains; onboarding validates and puts in place a default documentation baseline (MADRs,
requirements documents, Mermaid diagrams, a README); and a test/DoD baseline works the same way, with a
project override on top of mhw's.

Before this record every part of it was an instruction nothing checked: the gate's criterion 7 ("no
doc drift"), the Definition of Done's row 6 ("docs updated", proved by a gate: no) and the
documentation standard's placement rule. And the one override layer that existed weakened the floor:
`mhw policy check` accepted `coverage.threshold_percent: 5` (exit 0, measured on 2026-11-20), while
the Definition of Done asks for at least 85.

## Decision drivers

- A check can hold only what a repository declares. "The docs of the features it maintains" has to be
  written down per repository before anything can read it.
- No hook (the workstation brief: hooks only for existential risk). The control is a CI check and the
  gate's criterion.
- Onboarding must never write an ADR record: a record earns its place by explaining the current code.
- An override that can lower the floor is not an override of a floor.
- The baseline depends on the project's shape: a command-line tool has no screens to draw.

## Considered options

1. **A declared manifest, a pull-request check and an onboarding command (chosen).**
   `docs/documentation-baseline.json` maps each capability to its code globs and its documents and
   names the five baseline items, each a path or not applicable with a reason. `mhw docs-baseline
   check` fails a change that touches a capability without changing one of its documents by more than
   whitespace, unless the body declares `docs-baseline: none — <reason>` or `docs-baseline: in #N`; a
   changed path outside every capability fails with no escape. `mhw onboard` validates read-only and,
   with `--scaffold`, writes only the missing files. Trade-off: a manifest to maintain, and a check
   that a one-word edit or a dishonest `none` satisfies.
2. **The gate's judgement alone, with criterion 7 reworded.** No new artifact, but nothing records
   which documents describe which code, so the judgement has no ruler, which is the state that let
   the request be made.
3. **A step of `/blueprint import` for onboarding.** Rejected: `/blueprint import` carries an agent
   harness setup and, by its own rule, never writes a file before an alignment interview and then
   turns what was agreed into Issues. Scaffolding product documents is a different object, and a
   read-only validation must be runnable by CI and by any agent harness, not only inside that
   interview.
4. **The override as a sibling file of `project-policy.json`.** Rejected by the owner (2026-11-20):
   one file, validated by the existing command.

## Decision outcome

Option 1.

- **The manifest and its default proposal** are in the `documentation-standard` skill, *The
  documentation baseline*: README, requirements document, ADR library (index and template only),
  architecture and sequence diagrams. Architecture and sequences may be declared not applicable, with
  the reason; the other three may not.
- **A changed path belongs to the first capability in manifest order** whose code matches it. That
  keeps ownership deterministic and lets a repository end with a catch-all.
- **The check** is `mhw docs-baseline check`, run by the `docs-baseline` workflow on every pull request
  into `main` or `rc/next`, again on every body edit. "More than whitespace" is a line in
  `git diff -w --ignore-blank-lines --numstat` (measured on git 2.52.0: a whitespace or blank-line edit
  prints none). The escape line is read only at column 0 and outside a code fence, so a body that
  quotes the rule does not invoke it.
- **The gate's criterion 7** reads the check first: a red or missing check fails the criterion, and a
  green one does not pass it on its own.
- **Onboarding** is `mhw onboard`: a new command, not a `/blueprint import` step (option 3). Without
  `--scaffold` it writes nothing. With it, it writes only missing files, never over an existing one
  (an existence test and an exclusive-create write), never outside the project's real path and never
  into the ADR library except its `README.md` and `template.md`.
- **The test/DoD baseline is mhw's.** The `project-policy.json` contract gains the optional
  `baseline_override` section (`definition_of_done.additional_criteria`,
  `documentation.additional_docs`), which can only add: it carries no key that removes, lowers or
  waives anything, and an unknown key fails. The quantitative floor is tightened through
  `coverage.threshold_percent`, which now has a floor of 85. The free-text fields must carry a letter
  or digit, which closes a blank `when` on the required high-risk rule.
- **mhw declares its own baseline** in the same change, and its suite asserts the manifest is valid and
  covers every tracked file.

## Consequences

- Good: "no doc drift" has a ruler per repository, and part of the Definition of Done's row 6 is now
  proved by a check where a manifest exists.
- Good: a new repository can be given the baseline in one command without inventing a decision record.
- Good: the project-policy override can no longer weaken coverage below the Definition of Done.
- Bad: the check is narrow. A trivial doc edit, or a `none` line with a convenient reason, passes it;
  `in #N` is not resolved against the tracker. The gate's judgement still carries the meaning.
- Bad: a coarse manifest (one catch-all capability whose documents include `docs/**`) makes almost any
  doc edit satisfy almost any code change. mhw's own manifest has a catch-all, behind seven specific
  capabilities.
- Bad: the manifest is edited in the same pull request it governs, so a change can loosen its own
  ruler. That edit is in the diff the gate reads; nothing else holds it.
- Bad: the coverage floor and the non-blank rule tighten `schema_version` 1 in place, which the
  contract's versioning rule reserves for a new version. They stay version 1 because no project
  declares the contract yet; the next such change needs version 2 (the contract's *Versioning*).
- Bad: only repositories that adopt the workflow are checked. No other repository runs it yet.

## Links

- Issue [#523](https://github.com/tedeuxx/mhw/issues/523); the owner's decision on the override.
- `method/skills/documentation-standard/SKILL.md`, *The documentation baseline*.
- `method/agents/quality-assurance.md`, criterion 7; `method/skills/definition-of-done/SKILL.md`, row 6.
- `src/commands/docs-baseline.js`, `test/docs-baseline/docs-baseline.test.js`,
  `.github/workflows/docs-baseline.yml`, `docs/documentation-baseline.json`.
- `global/project-policy/project-policy.schema.json` and
  [docs/project-policy-contract.md](../project-policy-contract.md).
- [ADR-0015](0015-master-of-first-principles-ethical-locks-on-own-aims.md), amended.
- The current-codebase rule for decision records is in the `documentation-standard` skill, Part II. It
  was recorded as record 0020 of the plugin repository's methodology library, not of this library,
  whose 0020 is a different record.
