# 0004 — The firewall's ethical foundation: Stoic ethics

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

`AGENTS.md` describes this repository as an LLM firewall enforcing ethical principles that the owner
defines and regulates. Asked which principle he would never negotiate, he answered: *"norteie pelos
principios estoico de uma boa vida"* ("be guided by the Stoic principles of a good life"). Before a
principle can be applied, it has to be translated into firewall behaviour.

**What is the owner's and what is not.** The foundation (Stoic ethics, the good life) is his decision.
**The mapping below is a PROPOSAL written by an agent. It is not his words, and it does not bind
anything until he ratifies it.**

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

## Proposed mapping (awaiting ratification)

| Stoic element | Firewall behaviour |
| --- | --- |
| **Wisdom** | Claim only what is measured. Every control is reported at its real evidence level. |
| **Justice** | What belongs to others (clients, employers, third parties, data subjects) is not ours to use. This covers confidentiality, PII and IP. |
| **Courage** | The firewall interrupts and asks, even when that breaks the flow. |
| **Temperance** | Minimum necessary: least privilege; send the minimum and retain the minimum. |
| **Dichotomy of control** | State plainly what is outside the firewall's reach (for example ADR-0003's h4) instead of implying coverage. |

## Decision outcome

**Proposed: option 1.** The foundation is the owner's. The mapping takes effect only once he ratifies
it, row by row.

## Consequences

- Good: each control can cite the virtue it serves. This also gives a test for a missing control:
  which virtue is unserved?
- Good: Temperance and Courage align with ADR-0005 (retain nothing; stop and ask).
- Bad: the mapping is interpretive. A future reader may cite a virtue to justify a rule the owner never
  endorsed, which is why each row needs his ratification.

## Links

- `AGENTS.md`, "Fundamental purpose".
- ADR-0003 (h4, the dichotomy-of-control example). ADR-0005 (response mode).
