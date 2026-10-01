# 0009 — What is mine: individual knowledge vs third-party property

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner's mission statement for this project (quoted in full in `AGENTS.md`, "Mission"): protect him
from violating third parties' commercial rights and intellectual property. **Only his individual
knowledge and learning, gained in any environment, is his own property.**

The mission is his. **The operational test below was drafted by an agent and is a PROPOSAL, not his
words.** It binds nothing until he ratifies it. The firewall needs a test like this to decide, for any
content reaching a prompt, which side of the line it falls on.

## Decision drivers

- Justice (ADR-0004): what belongs to others is not ours to use.
- The reference workstation never persists employer or client confidential data (ADR-0008).
- A test that leaves a grey zone must route that zone to the owner, not to the agent.

## Considered options

1. **A three-way test: his, not his, grey zone → HITL** (below). Trade-off: the categories are
   judgement calls, and the grey zone interrupts.
2. **A two-way test with no grey zone.** Faster, but it forces the agent to decide cases that only the
   owner can decide.
3. **Defer entirely to his contracts.** Authoritative, but the contracts cannot be put in a portable,
   public repository, so the firewall would have no rule it can apply.

## Proposed test (awaiting ratification)

**His (portable):**

- general skills, techniques, patterns and judgement;
- public-domain and publicly documented knowledge;
- his own reasoning and opinions, and the story of his career told at the level of sector, role and
  outcome, without confidential specifics.

**Not his (third-party):**

- an employer's or client's code, documents, data, designs, internal architectures, metrics, customer
  names, unreleased plans, internal tooling and terminology, **including when reconstructed from
  memory** rather than copied;
- anything covered by an NDA or an employment IP clause.

**Grey zone → HITL (ADR-0005):** the firewall asks rather than decides.

## Decision outcome

**Proposed: option 1.** It takes effect only on the owner's ratification.

## Consequences

- **This is not legal advice.** The owner's employment contract and NDAs govern, and they may be
  **broader** than this test. One example is an IP-assignment clause covering work done outside working
  hours. **Recommendation: the owner reviews them against this ADR.** No contract text and no employer
  name enters this repository.
- Good: the "reconstructed from memory" clause covers the leak that copy-detection cannot see.
- Bad: "reconstructed from memory" and "confidential specifics" cannot be detected mechanically. They
  rest on the grey-zone HITL and on the owner's own judgement, so the firewall's coverage here is
  partial by nature (ADR-0004, dichotomy of control).
- Bad: a broad grey zone means frequent interruptions in career-narrative and content work.

## Amendment 2026-10-01: one row ratified

The owner: *"conehcimento publico da industria é liberado"* ("public industry knowledge is cleared").

**Ratified:** *public and publicly documented industry knowledge is his to use.* This is the
"public-domain and publicly documented knowledge" row of the test.

**The rest of the test stays proposed.** That covers the other "his" rows, the "not his" list and the
grey-zone routing (which ADR-0012 and ADR-0005's amendments have since reshaped). The record's status
stays **proposed** until the remaining rows are ratified.

## Links

- `AGENTS.md`, "Mission". ADR-0004 (Justice). ADR-0005 (HITL). ADR-0008 (no confidential persistence).
