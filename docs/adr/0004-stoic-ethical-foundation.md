# 0004 — The firewall's ethical foundation: Stoic ethics

- **Status:** accepted — mapping ratified by the owner, 2026-10-01; the Courage row amended by the owner,
  2026-11-17 ([Issue #30](https://github.com/tedeuxx/mhw/issues/30#issuecomment-6956199279); see the amendment "2026-11-17: the Courage row" below)
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

`AGENTS.md` describes this repository as an LLM firewall enforcing ethical principles that the owner
defines and regulates. Asked which principle he would never negotiate, he answered: *"norteie pelos
principios estoicos de uma boa vida"* ("be guided by the Stoic principles of a good life"). Before a
principle can be applied, it has to be translated into firewall behaviour.

The foundation (Stoic ethics, the good life) is his decision. The mapping below was drafted by an agent
and **ratified by him** on 2026-10-01: asked whether it represents what he meant by a good life, he
answered *"sim, representa"*.

## Decision drivers

- A firewall decision should trace back to a stated principle, not to case-by-case taste.
- The principle should produce behaviour that can be checked, not only an attitude.

## Considered options

1. **Map the four cardinal virtues and the dichotomy of control onto firewall behaviour** (below).
   Trade-off: any mapping is an interpretation, and a stretched analogy can lend authority to a rule
   that should stand on its own reasons.
2. **Adopt Stoic ethics as a stated value with no operational mapping.** This is faithful to his words
   and adds no interpretation, but no control can be traced back to it.
3. **A generic compliance framework instead.** Its rules are checkable, but it replaces his chosen
   foundation, so it was rejected.

## Mapping

| Stoic element | Firewall behaviour |
| --- | --- |
| **Wisdom** | Claim only what is measured. Every control is reported at its real evidence level. |
| **Justice** | What belongs to others (clients, employers, third parties, data subjects) is not ours to use. This covers confidentiality, PII and IP. |
| **Courage** | ~~The firewall interrupts and asks, even when that breaks the flow.~~ In the residual case (the global brief's rule 4) the firewall interrupts and asks, even when that breaks the flow; otherwise it mitigates and reports, per ADR-0012. *(Amended 2026-11-17, Issue #30.)* |
| **Temperance** | Minimum necessary: least privilege; send the minimum and retain the minimum. |
| **Dichotomy of control** | State plainly what is outside the firewall's reach (for example ADR-0003's h4) instead of implying coverage. |

## Decision outcome

**Chosen: option 1**, with the mapping above as ratified by the owner.

## Consequences

- Good: each control can cite the virtue it serves. This also gives a test for a missing control:
  which virtue is unserved?
- Good: Temperance and Courage align with ADR-0005 (retain nothing; ~~stop and ask~~ stop and ask in the
  residual case, otherwise mitigate and report, per ADR-0012).
- Bad: the mapping is interpretive. A future reader may cite a virtue to justify a rule the owner never
  endorsed; a new rule must cite its own reasons, not only a virtue, and a change to the mapping
  itself needs his ratification.

## Amendment 2026-11-17: the Courage row ([Issue #30](https://github.com/tedeuxx/mhw/issues/30#issuecomment-6956199279))

The owner amended the Courage row on 2026-11-17, answering a picker in session with *"Emendar"*. The ruling
is recorded on [Issue #30](https://github.com/tedeuxx/mhw/issues/30#issuecomment-6956199279) and carried into the ratification slice on
[Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6962031588). The row now reads: interrupt and ask in the residual case
(the global brief's rule 4); otherwise mitigate and report, per
[ADR-0012](0012-operational-judgement-delegated-to-the-harness.md). The old wording is struck in place
above. The rest of the mapping is unchanged.

## Links

- `AGENTS.md`, "Fundamental purpose".
- ADR-0003 (h4, the dichotomy-of-control example). ADR-0005 (response mode).
