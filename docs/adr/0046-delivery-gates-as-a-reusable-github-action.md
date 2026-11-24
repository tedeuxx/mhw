# ADR-0046: The delivery gates, the contract validator and the documentation baseline check as one reusable GitHub Action

- **Status:** ~~proposed (agent-written, awaiting the owner's ratification)~~ accepted 2026-11-24, ratified by
  the owner ([«Ratifico»](https://github.com/tedeuxx/mhw/issues/592#issuecomment-7130734920); the date is 2026-11-24, [corrected](https://github.com/tedeuxx/mhw/issues/592#issuecomment-7134109017)). The destination is the
  owner's ruling in the CLI native baseline review of 2026-11-23 (*"It becomes a reusable GitHub
  Action."*, *"It goes in the same Action as delivery-gate."*); the Action's shape is the implementing
  agent's design.
- **Date:** 2026-11-23
- **Deciders:** the owner (the destination, and the removal of the three commands); written by
  `agents-lead`, the lens for the `loop` lane
- **Issues:** [#592](https://github.com/tedeuxx/mhw/issues/592), slice 6 of 10 of the
  [CLI native baseline PRD](../mhw-product-requirements-document-cli-native-baseline.md) (sections 3
  and 5)
- **Amends:** [ADR-0015](0015-master-of-first-principles-ethical-locks-on-own-aims.md) and
  [ADR-0044](0044-documentation-and-dod-baseline-with-an-add-only-override.md), by this record only: the
  checks they name are no longer CLI commands. Neither record's decision changes.

## Context and problem

ADR-0015's locks 3 to 5 and ADR-0044's documentation baseline were three CLI commands: `mhw policy
check`, `mhw delivery-gate` (seven gates: `contract`, `container`, `installed-stg`, `classify`,
`environment`, `recovery-plan`, `prod-validation`) and `mhw docs-baseline check`. A project's CI/CD
reached them by checking out mhw at a pinned commit and running `node mhw/bin/mhw.js ...`; this
repository's own `docs-baseline` workflow ran `node bin/mhw.js docs-baseline check`. The owner's review
found that the CLI's one purpose is distribution, and that controls live in harness rules or in CI/CD
pipelines (PRD, principles 2 to 4). The baseline layer of section 3 names the carrier: a reusable
workflow or action a project references as `uses: tedeuxx/mhw/...@vX`.

## Decision drivers

- **No CLI in the runtime path, and no mhw install on the runner** (principle 3).
- **The exit contract is kept**: 0 pass, 1 block, 2 usage or cannot decide; both 1 and 2 fail the step.
- **A project pins the gates it trusts**: a release tag or a full commit SHA, never a moving branch.
- **Least privilege**: no secret, no token, `contents: read`; third-party steps pinned to a SHA.

## Considered options

1. **One composite action, `actions/delivery-gates/`, with a `gate` input (chosen).** Its steps set up
   Node 26 (actions/setup-node, pinned) and run `src/action/gates.js` from the Action's own copy of this
   repository, which builds the old commands' argument lists from the inputs and runs them. The
   `contract` gate runs the validator, then the contract gate. The code of the three commands is
   unchanged, so the golden transcripts of S28 and S29 run against the new entry. Trade-off: setting up
   Node changes the node of the caller's job for the steps after it; the Action carries the whole
   repository at its ref, not only the gates.
2. **A JavaScript action (`runs: using: node24`).** Rejected: the gates need Node 26 (`engines.node`),
   and the runner's bundled Node is the runtime GitHub chooses, so the gates would run on a release they
   were never tested on.
3. **Only the reusable workflow `reference-delivery-gate.yml`.** Rejected as the only carrier: a
   reusable workflow is whole jobs, so `docs-baseline`, `recovery-plan` and `prod-validation`, which run
   as steps of a project's own jobs, could not use it. The reusable workflow stays, and now runs the
   Action from its pinned mhw checkout (`uses: ./mhw/actions/delivery-gates`), because a `uses:` cannot
   carry the `mhw-revision` input as an expression.
4. **Three actions, one per command.** Rejected by the owner's ruling: the validator goes in the same
   Action as the gates; one entry with one input keeps one pin per project.
5. **Keep the commands beside the Action.** Rejected by the owner's ruling: the CLI's purpose is
   distribution.

## Decision outcome

Option 1. `mhw policy`, `mhw delivery-gate` and `mhw docs-baseline` are unknown subcommands (exit 2).
~~`mhw onboard` stays in the CLI until #599 moves it to a skill; its code stays in
`src/commands/docs-baseline.js` beside the check's.~~ *(Struck 2026-11-24,
[#599](https://github.com/tedeuxx/mhw/issues/599): `mhw onboard` left the CLI and is the method skill
`onboard`, which names this Action's `docs-baseline` and `contract` gates; its code left
`src/commands/docs-baseline.js`, which keeps the check.)*

| Action input `gate` | was | runs |
|---|---|---|
| `contract` | `mhw policy check` then `mhw delivery-gate contract` | the validator, then the contract gate |
| `container`, `installed-stg`, `classify`, `environment`, `recovery-plan`, `prod-validation` | `mhw delivery-gate <gate>` | that gate, one input per flag |
| `docs-baseline` | `mhw docs-baseline check` | the check, against `base`, with the body in `body-file` |

`classify` and `recovery-plan` print `key=value` lines; the Action appends them to `$GITHUB_OUTPUT` and
exposes them as outputs. The environments API read the `environment` gate needs stays in the caller,
which holds the token; the Action reads only the file it is given.

In this repository: `docs-baseline.yml` and `reference-delivery-gate.yml` call the Action at the pull
request's own ref, and `delivery-gates-action.yml` runs the reference fixture project through it (its
valid contract passes, a broken copy blocks). The caller template in
`global/project-policy/reference/caller-workflow.yml` uses `tedeuxx/mhw/actions/delivery-gates@<sha>`.

## Consequences

- Good: a project needs no mhw checkout and no Node step for a gate; one pin names the gates it trusts.
- Good: the gates' code and messages did not change, so every golden transcript still holds.
- Bad: a caller that moves its mhw pin past this change must rewrite each `node mhw/bin/mhw.js
  delivery-gate` step as an Action step; a step left on the old line fails closed (an unknown
  subcommand), so nothing deploys, but it is a break of the public interface: `semver:major`.
- Bad: `docs-baseline` is still judged by the pull request's own copy of the check (`uses:
  ./actions/delivery-gates` at its head), as it was with `node bin/mhw.js`: a pull request can weaken the
  check that judges it. That pull request touches a harness path, so it needs the lens; that is review,
  not a mechanism.
- Bad: no released tag carries the Action yet. The `@v11` reference is checked after that release,
  not by this change.

## Evidence level

*Written and tested*: the entry against the S28 and S29 golden transcripts and its input mapping
(`test/action/gates.test.js`). The Action's *workflow* runs (the fixture project, `docs-baseline`, the
reference dry run) are evidence at this branch's ref on GitHub's runners once the pull request runs
them; the released `@v11` reference is not measured. No project calls the Action.

## Links

- [Issue #592](https://github.com/tedeuxx/mhw/issues/592); the PRD's sections 3 and 5
- `actions/delivery-gates/action.yml`, `src/action/gates.js`
- `.github/workflows/delivery-gates-action.yml`, `.github/workflows/docs-baseline.yml`,
  `.github/workflows/reference-delivery-gate.yml`
- [docs/reference-cicd.md](../reference-cicd.md), [docs/project-policy-contract.md](../project-policy-contract.md)
