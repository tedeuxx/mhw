# 0005 — On detection: human-in-the-loop only, no auditable record on the workstation

- **Status:** accepted
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

When the firewall detects sensitive data in a prompt, what should happen, and who must know? The
owner's answer: *"o HITL apenas, sem registro auditavel no meu workstation"* ("HITL only, with no
auditable record on my workstation").

## Decision drivers

- A detection log would itself be a store of the sensitive data it detected.
- The decision about whether to proceed belongs to the owner.

## Considered options

1. **HITL only, no record.** Stop and let the owner decide; the firewall keeps nothing.
2. **HITL plus a local audit log.** Gives evidence and lets recurrences be learned from, but it
   concentrates sensitive data on the workstation. Rejected.
3. **Silent automatic redaction or blocking.** No interruption, but the owner neither knows nor
   decides. Rejected.

## Decision outcome

**Chosen: option 1.** ~~On detection the firewall **stops, and the owner decides**.~~ *(Narrowed by
the second 2026-10-01 amendment below: it now applies only to the residual case.)* The firewall keeps
**no auditable record** of the detection on the workstation.

This relies on ADR-0003: the hook layer can **block**, and blocking is what a HITL stop needs. Whether
a block reaches the owner as a question, rather than as a silent refusal, depends on the harness and
its operating mode. That has to be measured per harness.

## Consequences

- Good: no new store of sensitive data is created by the firewall itself.
- Bad: **no after-the-fact evidence of diligence** if the owner ever has to demonstrate it.
- Bad: **no learning from recurrences**. Nothing counts which patterns keep appearing.
- Bad: **an unattended or autonomous run halts on any detection.**
- Bad, measured on 2026-10-01 for Claude Code only: **"no record" binds the firewall, not the harness.**
  Claude Code keeps its own session transcripts on the workstation
  (`~/.claude/projects/<project>/<session>.jsonl` exists for the session that wrote this record).
  A prompt that triggered a detection, and the HITL exchange about it, may therefore persist in
  harness-native storage. Whether it does, and the equivalent for Codex and Kiro, is still to be
  measured.

## Amendment 2026-10-01: every intervention is reported to the owner

The owner, asked how he will know the firewall is working: *"toda atuacao que voce realizar manualmente
no trafego de inputs e outputs de llm que cair em uma politica de principios individuais mantidos pela
sua configuracao de workstation deve informar ao hitl qual a violacao que ia ocorrendo e a mitigacao
feita."* ("every action you take on LLM input and output traffic that falls under a policy of individual
principles maintained by your workstation configuration must tell the HITL which violation was about
to occur and what mitigation was applied.")

**Decision (his):** every intervention by the firewall or agent on LLM input or output traffic that
falls under one of the owner's policies **MUST notify the owner**. The notice states:

1. **which violation was about to occur**, giving the policy (ADR) and the category;
2. **the mitigation applied**.

This adds to the decision above and does not replace it. "No auditable record" still holds; the notice
is not a record.

**Proposed constraints on the notice** (not his words, awaiting ratification):

- It names the **category** and **where it happened**: which surface, and whether input or output. It
  **never** names the sensitive content or term itself, because then the notice would re-leak what was
  cleaned.
- It is **ephemeral**, consistent with keeping no log.
- It is shown in **the channel the owner actually sees** for that surface: an in-session message for the
  CLIs, and an OS notification for the clipboard watcher (ADR-0011).

**Consequence:** this notice is the firewall's **only observability signal**, so **a silent intervention
is a defect**. Bad: an in-session notice is written into that harness's transcript like any other
message. That is the reason the category-only constraint is load-bearing rather than cosmetic.

## Amendment 2026-10-01 (second): recognised cases are mitigated proactively, then reported

Following the owner's instruction recorded in ADR-0012's 2026-10-01 amendment, the response to a
detection depends on whether the agent recognises the case.

- **Recognised cases** (a client reference, or a solution identified as proprietary): **mitigate
  proactively, then notify.** Remove the reference, or abstract it, and report the category and the
  mitigation, never the content (first amendment above).
- **Stop and ask is reserved for the residual case.** That is where abstraction would destroy the
  owner's own legitimate content, or where the agent cannot tell whether the mitigation is enough.

The original "stops, and the owner decides" sentence in "Decision outcome" is struck in place, with a
pointer here. It no longer holds as a blanket rule, only for the residual case. "No auditable record"
is unchanged.

## Links

- ADR-0003: hooks can block; this is the barrier HITL relies on.
- ADR-0004: Courage (stop and ask) and Temperance (retain the minimum).
