# 0015 — Master of first principles: ethical locks on the owner's own aims

- **Status:** accepted for the framing (the owner's words, 2026-10-01). **Concrete locks: pending owner
  interview.** None is proposed in this record.
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

Until now this repository protected the owner from **third-party** risk: confidentiality, other
people's intellectual property, personal data (`AGENTS.md`, "Mission"). The owner widened that:

> *"me coloquem travas eticas no que quero alcançar tbm enforçadas nesse repo. ele seria o repo de
> master de first principals do meu individuo interagindo com esse workstation de ia."*

("Put ethical locks on what I want to achieve too, enforced in this repo. It would be the master
repository of first principles for me as an individual interacting with this AI workstation.")

So the question is no longer only "whose property is this?" but also "is this goal, or this way of
reaching it, consistent with his principles?". That second question has no record yet.

## Decision drivers

- One place for his first principles, so no project, plugin or session can carry a different set.
- His ratified foundation is Stoic ethics (ADR-0004). A lock should trace back to it.
- A control that can refuse its own owner needs a way for him to see and answer the refusal, or it is
  either ignored or switched off.
- Report every control at its real evidence level (`AGENTS.md`, hard rules).

## Considered options

1. **This repository is the master of first principles, and the ethical locks on his own aims live
   here, at the same layer as the firewall (chosen).** Trade-off: the firewall becomes two-sided. It
   can refuse the owner, not only protect him.
2. **Keep this repository third-party-only, and put the locks somewhere else** (the plugin, or a
   per-project brief). The firewall stays one-sided and simpler. But the plugin is the way of working
   and may not define the floor (ADR-0014), and per-project locks would differ between projects.
3. **No written locks; rely on the model's default behaviour.** No work. But the locks would be the
   vendor's, not his, and they would change with each model release.

## Decision outcome

**Chosen: option 1.**

- This repository is the **master of first principles** for the owner as an individual interacting
  with his AI workstation. Its scope covers both third-party risk and his own aims.
- Agents must not help him pursue a goal by means that violate his ratified principles (ADR-0004).
- The locks live here, at the same layer as the firewall, and follow the same rules: one source,
  rendered to every harness, reported at their real evidence level.
- **Concrete locks: pending owner interview.** The interview has started. This record proposes no lock,
  and no agent may invent one in the meantime.

## Consequences

- **A lock on his own aims makes the firewall a two-sided control: it can refuse the owner.** To stay
  usable, a refusal must reach him in a form he can answer. That is the human-in-the-loop escalation
  of ADR-0013, which is in a separate pull request and not yet merged. Until it lands, a refusal has
  no defined escalation path.
- **He can change his principles only through the ADR process, never mid-session.** A principle he
  wants to relax is amended or superseded by a record he ratifies. An instruction typed into a session
  does not unlock it. This keeps a lock from being argued away under pressure, which is the point of
  having one.
- Bad: "enforced" is not yet true. The firewall's only installed control is a user-level instruction
  (ADR-0010), and a project instruction can contradict it in every harness (ADR-0014). A lock written
  into the global brief would be at the same level: **written, then installed**, not enforced.
- Bad: a lock is a judgement about intent. Unlike a secret or a client name, it has no string to match,
  so a mechanical check is unlikely. Most locks will probably stay at instruction level.
- Bad: a false refusal costs the owner time on his own legitimate work. The interview must define each
  lock tightly enough that a false refusal is visible to him and can be overruled through ADR-0013's
  escalation.

## Links

- `AGENTS.md`, "Fundamental purpose". ADR-0004 (Stoic foundation). ADR-0010 (global brief).
  ADR-0013 (HITL escalation, in a separate pull request). ADR-0014 (firewall vs plugin).
