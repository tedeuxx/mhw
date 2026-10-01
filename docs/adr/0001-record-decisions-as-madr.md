# 0001 — Record significant decisions as MADR-format ADRs

- **Status:** accepted
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

This repository is a portable policy set protecting its owner from individual, civil and
intellectual-property risk across several agent harnesses and operating systems. Its decisions —
what the floor contains, which control a harness can carry, where a gap is accepted — will be read
later by people replicating it and by agent sessions that remember nothing. Without a durable record
of each decision and the options it rejected, a later context re-decides and drifts.

## Decision drivers

- Fresh agent contexts must be able to load prior decisions instead of re-deriving them.
- Replicators on other machines need to see *why* a control is shaped as it is, not only *what* it is.
- Rejected options must stay visible so they are not relitigated.

## Considered options

1. **MADR-format ADRs in `docs/adr/`.** Records context, drivers, options and consequences. Heavier per
   record.
2. **Nygard's four-section ADR.** Lighter, but drops the considered options — half of the argument.
3. **No ADRs; rationale in commit messages and `AGENTS.md`.** Cheapest, but rationale scatters and is
   not browsable as a decision library.

## Decision outcome

Chosen: **option 1**. Significant decisions are recorded as MADR ADRs in `docs/adr/`, under the
significance gate, numbering, status and supersession rules stated in `AGENTS.md`, Principle 2.

### Consequences

- Good: one browsable decision library; rejected paths are recorded.
- Bad: each significant decision costs a written record, and the significance gate needs judgment.
- Bad: nothing enforces the discipline yet; it is held by instruction and review.

## Links

- `AGENTS.md` — "Principles", item 2.
