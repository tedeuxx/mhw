# 0012 — Operational judgement is delegated to the agent harness, to minimise human error

- **Status:** accepted for the delegation (the owner's decision). The operating rule is proposed.
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

Two questions were open: who decides where the line between his knowledge and third-party property
falls (ADR-0009), and who enters terms into the hashed list (ADR-0011). The owner answered:
*"estou delegando responsabilidade para voce de forma a minimizar o erro humano."* ("I am delegating
responsibility to you, so as to minimise human error.")

## Decision drivers

- Human error is the failure mode the owner wants reduced.
- Responsibility for the outcome cannot actually move to a tool.

## Considered options

1. **Delegate operational judgement to the agent harness**, under a conservative rule (below).
2. **The owner decides every case and enters every term by hand.** He keeps full control, but this is
   exactly the error-prone, attention-heavy path he chose to avoid.
3. **Delegate without a bias rule.** Fewer interruptions, but an unsure agent may wave third-party
   material through.

## Decision outcome

**Accepted (his decision): option 1.** The agent applies ADR-0009's test. When it recognises an employer
or client reference, **the agent**, not the owner by hand, adds the term to ADR-0011's hashed list.

### Operating rule (proposed, not his words)

- **Conservative bias.** When unsure whether something is his knowledge or third-party property, the
  agent treats it as third-party.
- **HITL (ADR-0005) only where the conservative choice would block his own legitimate work.** In those
  cases it asks rather than blocks silently.
- **Term capture.** A recognised term is hashed immediately, under ADR-0011's scheme. It is never
  written in plaintext anywhere the agent controls: files, memory, notes, scratch or commit text.

## Consequences

- **Accountability is not transferable.** Legal and contractual responsibility stays with the owner.
  Delegation reduces how often errors happen; it does not reduce his liability.
- **Capture after the fact, not prevention.** The agent can only recognise what reaches its context, and
  by then the term has already passed through that harness's transcript (ADR-0008; documented for Claude
  Code in ADR-0011).
- **Recall is imperfect.** A term the agent fails to recognise is neither blocked nor captured.
- **The conservative bias raises false positives.** More of his legitimate work is treated as
  third-party, or interrupted.
- The delegation is only as good as the instruction that carries it, and today that instruction is the
  global brief, at instruction level (ADR-0010).

## Amendment 2026-10-01: the operating rule is accepted, as proactive cleaning and abstraction

The owner: *"voce deve proativamente limpar referencias de clientes e solucoes que identificar como
proprietarias, modulando o output para algo mais focado em ideias abstrata do que produtos e
propriedades comerciais atualmente existentes."* ("you must proactively clean references to clients
and to solutions you identify as proprietary, steering the output toward abstract ideas rather than
currently existing commercial products and properties.")

The operating rule above was proposed. It is **now accepted in this form**, which replaces its HITL
line:

- The agent **proactively** removes client references and solutions it identifies as proprietary, and
  **steers the output toward abstract ideas** rather than existing commercial products and properties.
- It **does not stop to ask** for these. It mitigates and reports, per ADR-0005's 2026-10-01 amendments:
  category and mitigation, never the content.
- **The conservative bias stands.** When unsure, treat it as third-party.
- Stop-and-ask is kept only for the residual case defined in ADR-0005's second 2026-10-01 amendment.
- Term capture (hash immediately, never plaintext) is unchanged.

**Open scope question. It is not decided, and the owner has not yet been asked:** does *"produtos e
propriedades comerciais atualmente existentes"* cover only **employer and client proprietary
solutions**? Or does it also cover **publicly available vendor products** that he names in his own
public writing, such as a named cloud service? **Until he answers, the narrower reading applies:
employer and client proprietary only.** The global brief is written to that reading.

**Tension to put to the owner, not resolved here.** ADR-0004's ratified mapping says *Courage → interrupt
and ask, even when that breaks the flow*. For recognised cases, this amendment replaces asking with
mitigating and reporting. Changing the mapping needs his ratification. Until then, read Courage as
covering the residual stop-and-ask case and the obligation to report every intervention.

## Links

- ADR-0005 (HITL, no log; its 2026-10-01 amendment requires every delegated intervention to be
  reported to the owner). ADR-0008 (no persistence). ADR-0009 (the test). ADR-0010 (global brief).
  ADR-0011 (hashed term list).
