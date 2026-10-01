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

**Chosen: option 1.** On detection the firewall **stops, and the owner decides**. The firewall keeps
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

## Links

- ADR-0003: hooks can block; this is the barrier HITL relies on.
- ADR-0004: Courage (stop and ask) and Temperance (retain the minimum).
