---
name: "quality-gates"
description: "Apply THIS loop's CI/CD gate policy — the gate table per loop model, the merge-class rules, and the thresholds (lint/typecheck zero, coverage ≥85%, contract/E2E, dependency + secret scanning, SAST). Use when calibrating gates, wiring CI, or deciding who merges a class. Not for the criteria that make a slice complete (see definition-of-done), the pre-merge pass (see code-review), or Sonar mechanics (see devops)."
purpose: "state the CI/CD gates this loop runs and where each sits, so a merge decision rests on mechanical checks rather than on impression"
---

# Quality gates — the CI/CD policy, and where each gate sits

Apply the platform's verification model and deploy gates in any `<project>` repo. This defines the mechanical gates and where they sit — the enforcement half of the principles layer (`/engineering-standards` carries the judgment, `/agents-configuration` the flow — one file until #381 split them). **What makes a slice COMPLETE is `/definition-of-done` since #380**, on the owner's definitions quoted below; this file is the CI/CD metrics half of that pair and nothing else.

**Two bodies of content, kept legible as two sections rather than blended (#257).** Part I is the
*verification model and the gate tables* — the thesis, the gate table per loop model, the merge-class
rules, and where enforcement lives. ~~the *definition* of done — the thesis, the DoD, the 100%
functional-regression invariant, the gate table per loop model~~ — **struck #380: the DoD, the
regression invariant and local/post-deploy validation moved to `/definition-of-done`.** Part II is the
*concrete, stack-agnostic policy* that satisfies it — the actual
thresholds, and what each check is for. They were split into two skills at #230 specifically so
`quality-assurance` could preload the concrete policy independent of stack; the split was folded back
into one file at #257, on the owner's call, once the two skills sat next to each other under
near-identical names (`quality-gates` next to `coverage`, whose own doc already opened "# Quality
gates") — a naming collision, not a judgment that the two kinds of content were the same thing. Read
Part I for *which gate sits where and who merges what*; read Part II for *the numbers each gate checks*.

Context: $ARGUMENTS

## Part I — The verification model and the gate tables

**This section narrowed twice, and the second cut is the one that matters.** At #265 the *generic* case
for a Definition of Done — why "done" needs a ruler, what makes a criterion well-formed, the shapes a
DoD can take — moved to `/definition-of-done`. **At #380 the CONCRETE Definition of Done followed it**,
so the two halves of one concept stopped living in two skills. What is left here is what the owner's own
definitions put here: **CI/CD metrics.**

**Read `/definition-of-done` for what a slice must satisfy to be complete** — both the generic
discipline and this loop's own criteria, with the table saying which of them a gate proves. **Read
this file for the gates themselves.** The two are a pair and neither is sufficient: a slice can clear
every gate below and still fail the DoD, which is exactly what the seam table in the other file is for.

### The thesis: agent-led verification, human-residual
The point of this model is that **agents perform the majority of verification and humans are left only the residual.** Every gate below is objective and mechanical *on purpose* — so an agent can prove "done" by itself, and a human's scarce attention goes only to what can't be automated with confidence: irreversible/architectural judgment and the final go/no-go.

**Trust comes from the harness, not the agent's word.** For this to hold, verification must be *enforced by the machine* — hooks and CI required checks that actually run and block — never accepted as the agent's self-report. An agent can hallucinate a green check; a required check cannot. So the agent **reports with real evidence** (actual command output) and the **hook / CI is the source of truth**. If a gate is only "the agent said it ran," the human residual silently grows back, because now someone has to check whether it really verified. Keep the gates inescapable and mechanical.

### The Definition of Done lives in `/definition-of-done` — MOVED at #380

~~**Definition of Done (a slice is "done" only when all hold)** — the eight criteria, the 100%
functional-regression invariant, local validation, and post-deploy verification.~~ **MOVED 2026-09-02
(#380) to `/definition-of-done`, where the concrete list now sits beside the generic discipline that
governs it.** Struck rather than deleted because this is where every persona in this roster looked for
it for weeks, and an absence here with no marker reads as a deletion.

**The owner's definitions are the ruler, and they are what forced the move:**

> *«quality gates para mim sao mais relacionados a metricas de ci/cd.»*
> *«definition of done para mim sao relacionado a completude de um issue.»*
> *«eu queria que os nomes seguissem conceitos claros de agil. quality gates e definition of done tem
> uma intersecao mas servem a propositos distintos.»*

**What stayed here is exactly what those definitions put here: CI/CD metrics.** The gate tables per loop
model, the thresholds in Part II, the enforcement wiring, the merge-class rules. **No threshold moved and
no gate changed** — this was a relocation, not a retuning.

**What you must read there and cannot read here:** the criteria themselves, and the table stating
**which of them a gate proves and which it does not**. That table is the sentence neither file could
carry while both halves lived in one of them — *a green pipeline is not a met Definition of Done* — and
it is the reason the split was worth the churn rather than a naming preference.

**If you are `quality-assurance`, `/definition-of-done` is now in your preload beside this file** (added
in the same slice; a ruler the gate cannot see is not a ruler). If you are reading this skill for the
DoD and it is *not* in your preload, that is a finding — say so rather than reconstructing the list.

### Gates — calibrated to blast-radius
The gate set is the same; **where it sits** follows the loop model (`/agents-configuration`). The organizing rule: **the heavy gates sit at the point of no return.**

#### `gitflow-multi-env`
| Gate | Staging (merge → integration branch) | Production (promote → release branch) |
|---|---|---|
| Coverage (≥85%) | **required** | required |
| Static analysis / quality gate | **required** | required |
| Security (dependency audit / SAST) | **required** | required |
| Lint + typecheck | — | required |
| **Full regression** | runs (local pre-push + staging post-deploy); not a merge-blocker *into* staging | **required, blocking check on the promotion PR** |
| Human review + branch protection | — | required |
| Version bump label | — | required (drives tag + Release) |
| **Manual approval** | — | **required — promotion always asks** |

Staging stays light so integration is fast and cheap to revert. Production layers on the heavy gates because it's expensive and irreversible — the green staging regression is the prerequisite that makes the promotion safe.

#### `trunk-single-env`
| Gate | PR → `main` (the only gate) |
|---|---|
| Coverage (≥85%) | **required** |
| Static analysis / quality gate | **required** |
| Security (dependency audit / SAST) | **required** |
| Lint + typecheck | **required** |
| **Full regression** | **required, blocking** |
| Human review + branch protection | required |
| Version bump | on merge (auto-bump + tag + Release) |
| **The gatekeeper approves** | **required, every MR — `quality-assurance`, holding both lenses in one pass: was every requirement of the issue met, and can this cause a problem in production. It absorbed the `security` persona on 2026-08-04; the second question did not go away, it stopped being a second dispatch** |
| **Merge asks a HUMAN** | **only for the four surviving holds** (ADR-0002 amendment #16) — not for the boundary class as such — see below |

There is no downstream tier to defer to, so **nothing is deferred**: a gate skipped on this PR is a gate that never runs. This is not a heavier model than `gitflow-multi-env` — it is the same total rigor, collapsed onto one hop.

**The merge is the go/no-go; that is not the same as the merge always asking a human.** This table used to read *"Merge asks — required"*, which contradicted `quality-assurance`'s own definition and made an agent's conclusion depend on which file it happened to read (#62). The merge needs a **judgement**; who supplies it is set by the class. `quality-assurance` merges the **safe** class itself once both of its lenses are green; ~~it never merges the **boundary** class — infrastructure and anything threatening continuity, a change to the loop's own rules, publishing in the owner's voice~~ **and since 2026-08-23 (ADR-0002 amendment #16) it merges the boundary class too, under its own verdict literal `APPROVE-AND-MERGE-BOUNDARY`, with the owner reviewing live after deploy.** The argument is the loop model itself — under `trunk-single-env` there is no preview to hold for, so the hold delayed publication without producing anything to inspect. **That reasoning is confined to this table on purpose and is NOT carried into the `gitflow-multi-env` one**, where an integration branch is exactly the place to hold a change and look at it. **Four holds survive, and the gate still never merges them:** an expansion of its own authority, a harness diff carrying no `agents-lead` verdict marker, anything in `iac/` (where the merge applies and the PR's plan is the preview), and an explicit lens `ESCALATE`. When the class is unclear, it is boundary — and when what is unclear is whether a hold applies, it applies.

(Infrastructure repos, both models: format + validate + policy scan + a reviewed plan; apply only on merge, pipeline-only.)

### Where enforcement lives
- **Hooks** (deterministic, fire on every relevant action): fast local feedback — formatting, lint-on-edit, guardrails. Shipped close to the agent.
- **CI required checks** (the blocking source of truth): coverage, quality gate, security, and the regression — on the promotion PR under `gitflow-multi-env`, on the PR to `main` under `trunk-single-env`. These are what actually gate merges; the agent's job is to make them green and report the evidence, not to *be* the gate.
- **Pipelines are independent per repo** — never trigger one repo's pipeline from another.

The agent's contract: self-verify against these locally, show the real output, and only hand the human the residual — the judgment calls and the go/no-go.

## Part II — The concrete gate policy (stack-agnostic thresholds)

**Framework-agnostic, and stack-agnostic on purpose.** Where Part I says a slice must have "coverage
≥85%" and "the regression passes," this is the actual policy that satisfies those lines — the gate
list and the thresholds, specialized per stack only in the runner configuration, never in the number.
Originally extracted from the former `backend` family's `coverage` skill (#230) precisely so this
policy did not get pulled into the backend reference pattern (a BFF-on-Lambda architecture with no live
consumer) and so `quality-assurance` could preload it on every merge request regardless of which stack,
or whether either stack is even backend-shaped — folded into this file at #257 without losing that
independence, since it is now a section of the skill every reviewing persona already preloads rather
than a second file to preload alongside it.

CI **blocks deploy** if any gate fails — no artifact upload, no CDN invalidation, no function update.
IaC has its own gate (`checkov`, in `cloud-infrastructure`) and is not covered here.

**Quality — identical on both sides:** lint (zero errors), typecheck (zero type errors). No variation —
these are the cheapest gates in the set and the ones most often made advisory "for now".

**Test — one threshold, two kinds of proof.** **Unit coverage ≥ 85%** on lines/functions/branches/
statements, on **both** sides; below threshold blocks. The number is deliberately the same so neither
stack can argue it is the special case. Above the unit line the stacks diverge, because what counts as
*the behaviour actually working* differs — for this backend, that is unit/integration via vitest (see
the Framework section) plus an **API/contract run** — the Postman collection executed against a deployed
API: 401 without a bearer token, 200 with it, schema checks (see the Contract tests section). **Only
what exists is required** — a service with no browser surface owes no E2E journey, but the row that
*does* apply is blocking, and "not applicable" is a claim to be checked once, not a default answer.

**Security — same four checks, different location for the secret.** Dependencies: block on
high/critical advisories, dependency review and automated update PRs. SAST + quality gate: the
SonarCloud Quality Gate blocks merge and imports the unit-coverage lcov, so SAST, coverage and smells
are judged together — see `devops` for the mechanics of that import. Secrets: secret scanning,
nothing sensitive committed — on the server a sensitive value is fetched at runtime from a secret store
(see the Secrets section); in a browser bundle there is no such place at all, so client configuration is
non-secret by construction (see the Config section). Automated review: an automated code-review action
on every pull request, advisory rather than blocking.

**Conventions:** do not lower a threshold to go green — fix the gap; an assertion that cannot fail is
worse than no assertion (coverage counts lines executed, not behaviour verified).

### Decision & trade-off
- **One threshold across both stacks, rather than tuning each.** *Why:* a per-stack number invites the
  argument every time a suite is inconvenient. A single shared number converts a recurring negotiation
  into a one-time decision. *Trade-off:* it is arbitrary for at least one of the two stacks, and it will
  occasionally be too strict for glue code and too lax for a core module.
- **Gates block the deploy rather than warn.** *Why:* an advisory gate is a gate that is red on the day
  it matters and has been red for weeks. *Trade-off:* a flaky suite can stop a correct change, so
  flakiness has to be treated as a defect in the gate rather than a cost of having one.
- **Coverage is imported into the SAST gate rather than checked separately.** *Why:* one verdict, one
  place to look, smells cannot be traded off against coverage silently. *Trade-off:* an outage or
  misconfiguration in that one service blocks every merge.
- **This policy folded into `quality-gates` rather than staying a standalone `coverage` skill (#257).**
  *Why:* the owner's call, made once the rename that produced `quality-gates` (#255) put it next to a
  near-identically-named skill. *Trade-off:* named and accepted at filing — the preload-independence
  rationale the extraction bought at #230 is now carried by this file being one preload rather than two,
  not by a separate file; see the note opening this Part for how that preload wiring was re-verified
  rather than assumed to still hold.

### Pros & cons (of the concrete policy)
**Pros:** deterministic merge gate, one policy, one place to change it; unit + contract + SAST together,
so a change that is covered but broken still fails; framework-agnostic — the policy survives changing
the runner.
**Cons:** an 85% threshold can incentivize trivial tests that raise the number and assert nothing; gates
add latency to every merge, including the ones that could not possibly break anything.
