# 0008 — The reference workstation is personal: no persistence of employer or client confidential data

- **Status:** accepted
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner's current policy: *"essa maquina é pessoal e nunca pode ter persistencia de dados
confidenciais de empregador e clientes. essa minha politica atual."* ("this machine is personal and must
never persist employer or client confidential data. That is my current policy.")

The owner currently has **no freelance clients**, because of current engagement constraints. No further
detail is recorded here, because this repository is portable and may be published.

## Decision drivers

- Confidential material that is never stored cannot leak from storage.
- `AGENTS.md`, "Fundamental purpose", protection 1 (client and employer confidentiality).

## Considered options

1. **Personal by policy: never persist employer or client confidential data.** The firewall prevents
   ingress and persistence. Trade-off: it gives no help to a machine that legitimately holds such
   material.
2. **Containment posture**: the material may be present but is fenced off from agents and egress. This
   suits a mixed-use machine, but it does not describe this one, and it is much harder to make complete.

## Decision outcome

**Chosen: option 1.** The reference workstation is **personal by policy** and must **never persist**
employer- or client-confidential data.

## Consequences

- The firewall's job for this category is **ingress prevention and non-persistence**. It is not
  containment of material that is legitimately present, because on this machine none is.
- **"Persistence" is read broadly.** It includes:
  - harness session transcripts and caches. Claude Code keeps full session transcripts locally
    (ADR-0005);
  - app-local data directories;
  - working folders an agent can reach;
  - clipboard and scratch directories.

  Each must be **inventoried per surface (ADR-0006), measured, not assumed**.
- **Open question, deliberately left open (the owner has not yet been asked):** is **transient transit**
  permitted, meaning material read in passing but not stored? Until it is answered, no control may
  assume either answer.
- **For adopters:** this is the reference posture. An adopter whose machine legitimately holds employer
  or client material needs a **containment posture, which this ADR does not provide**. Adopting this one
  would give them a false sense of coverage.
- Bad: a broad reading of "persistence" combined with harness-native transcripts (ADR-0005) means the
  harness itself can persist anything that reaches a prompt. Ingress prevention is therefore the
  primary control here, not a secondary one.

## Links

- `AGENTS.md`, "Fundamental purpose". ADR-0005 (transcripts observation). ADR-0006 (surfaces).
