# 0015 — Master of first principles: ethical locks on the owner's own aims

- **Status:** ~~accepted for the framing (the owner's words, 2026-10-01). Two operating rules below are
  marked **proposed (agent-written, awaiting owner ratification)**. **Concrete locks: pending owner
  interview.** None is proposed in this record.~~ **Accepted.** The owner ratified the operating rules
  and the first concrete lock on 2026-10-17 after the interview in Issue #25.
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
- ~~**Proposed (agent-written, awaiting owner ratification):**~~ **Accepted (owner, 2026-10-17):**
  agents must not help him pursue a goal by means that violate his ratified principles (ADR-0004).
- The locks live here, at the same layer as the firewall, and follow the same rules: one source,
  rendered to every harness, reported at their real evidence level.
- ~~**Concrete locks: pending owner interview.** The interview has started. This record proposes no
  lock, and no agent may invent one in the meantime.~~ **The first concrete lock was ratified by the
  owner on 2026-10-17.** Its full boundary and evidence contract are in the amendment below.

### Amendment — first concrete lock: autonomy inside, evidence at the deployment perimeter (2026-10-17)

The owner's governing intent is **autonomy with control** through **perimeter defense**. Local and
recoverable work is autonomous by default. An agent may explain a conflict with a ratified principle
and offer a safe alternative, but it must not provide analysis, planning, instructions, execution or
other assistance that would materially advance the violation. When the conflict is uncertain, it may
perform only the safe analysis needed to explain the uncertainty and must ask the owner before material
advancement.

The first concrete lock protects the product, its audience and the owner's reputation at the delivery
boundary:

- **PROD is the ethical harm perimeter.** It is where a change may create irreversible product,
  audience or reputational damage. STG remains recoverable, but is a mandatory preventive checkpoint.
- **Regression gates both STG and PROD.** Before either deployment, every applicable layer of the test
  pyramid that can run locally or in containers must have complete, green evidence from the
  containerized CI/CD pipeline for the exact revision. Local runs provide early feedback but never
  authorize a deployment.
- **STG proves the installed revision before PROD.** Every required test applicable to an installed
  environment must run against that exact revision in STG and pass before promotion. This includes the
  project's required functional, API, end-to-end and security validation.
- **High coverage is hybrid.** Each project sets a quantitative threshold and also names mandatory
  critical user journeys, security controls and existential or reputational risk scenarios. Neither
  dimension substitutes for the other.
- **The minimum security evidence is non-exhaustive, not optional.** It includes quality scans, SAST,
  OWASP vulnerability coverage, authentication, authorization and encryption in transit and at rest.
  Only low-severity findings are tolerable. Medium or higher, unclassified findings and inconclusive
  evidence block. Every tolerated low finding must have a bug Issue before deployment.
- **Each project uses three durable artifacts.** A ratified project MADR defines its quality bar and
  low/high deployment-risk model; versioned machine-readable configuration materializes them in
  CI/CD; bug Issues track tolerated low findings. `mhw` supplies the common floor. Missing or invalid
  risk classification blocks deployment before approval.
- **Authorization is risk-based.** A low-risk PROD deployment may promote automatically after every
  gate passes. A high-risk PROD deployment requires the owner's explicit approval for the exact
  revision and deployment.
- **Recovery is prepared before exposure.** A critical production validation failure stops further
  exposure and triggers automatic rollback to the previous known-good version. If reliable automatic
  rollback is unavailable, manual recovery is allowed only when the project's MADR defines its
  recovery-time objective, the runbook has been tested, and an identified operator is available for
  the deployment and observation period.
- **Exception remediation is best effort and non-exhaustive.** That flexibility applies to how an
  exception is remediated; it does not weaken any deployment gate or create a bypass.

These are policy decisions, not evidence that a carrier exists. The agent-refusal rule belongs in the
rendered harness briefs at instruction level. Deployment enforcement belongs in each project's CI/CD
and environment protections, not in a workstation hook. Until those carriers are delivered and
verified per project, this amendment is **written policy only**, not installed, loaded or enforced.

#### Options considered for the concrete lock

1. **Perimeter defense with project-specific, machine-readable gates and risk-based PROD
   authorization (chosen).** It preserves autonomy in recoverable work while making deployment
   evidence and the human residual observable. Trade-off: every deploying project must maintain its
   own ratified quality and risk model within the common floor.
2. **Require the owner's approval for every PROD deployment.** Strong direct control, but rejected by
   the owner in favour of automatic promotion for objectively low-risk changes. It would turn a
   mechanically evidenced low-risk path into a permanent human bottleneck.
3. **Keep the principles advisory and let agents or operators judge each deployment.** Lowest setup
   cost, but rejected because it provides no durable classification, no consistent gate and no proof
   that the lock was applied.

## Consequences

- **A lock on his own aims makes the firewall a two-sided control: it can refuse the owner.** To stay
  usable, a refusal must reach him in a form he can answer. That is the human-in-the-loop escalation
  of ADR-0013, which is in PR #2 and not yet merged. Until it lands, a refusal has no defined
  escalation path.
- ~~**Proposed (agent-written, awaiting owner ratification):**~~ **Accepted (owner, 2026-10-17): he can
  change his principles only through the ADR process, never mid-session.** A principle he
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
  ADR-0013 (HITL escalation, PR #2). ADR-0014 (firewall vs plugin). Issue #25 (owner interview and
  ratification, 2026-10-17). Issue #192 (implementation intake).
