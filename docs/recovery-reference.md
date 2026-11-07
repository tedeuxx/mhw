# The recovery reference (ADR-0015 lock 5 of 5)

[ADR-0015](adr/0015-master-of-first-principles-ethical-locks-on-own-aims.md)'s first concrete lock says
recovery is prepared before exposure:

> A critical production validation failure stops further exposure and triggers automatic rollback to
> the previous known-good version. If reliable automatic rollback is unavailable, manual recovery is
> allowed only when the project's MADR defines its recovery-time objective, the runbook has been
> tested, and an identified operator is available for the deployment and observation period.

This reference is how a project's CI/CD can carry that clause. It adds two gates to `delivery_gate.py`,
three jobs to the caller template and a runbook template.

| File | What it is |
| --- | --- |
| `global/project-policy/delivery_gate.py` | `recovery-plan` and `prod-validation`, beside the gates of [docs/reference-cicd.md](reference-cicd.md) |
| `global/project-policy/recovery_test.py` | Its suite: both recovery paths, each blocking class, the runbook template read by the gate, the template's recovery jobs |
| `global/project-policy/reference/caller-workflow.yml` | The template's `recovery-plan`, `validate-prod` and `recover` jobs. Not live in mhw |
| `global/project-policy/reference/runbook-template.md` | The manual-recovery runbook a project copies |

## Evidence level, said first

**Written and tested; no project runs it, and nothing ran it in CI beyond its suite.** The suite runs
on macOS, Linux and Windows in mhw's CI. The template's recovery jobs have never run anywhere, and the
dry run of lock 4 does not reach them: it deploys nothing, so it has nothing to recover. No rollback
has been performed or measured by this reference, so the recovery half of the lock is not installed,
loaded or enforced in any repository.

## The two paths

The project's contract names one mode in `recovery.mode` ([docs/project-policy-contract.md](project-policy-contract.md)).

| | `automatic-rollback` (ADR-0015's default) | `manual` |
| --- | --- | --- |
| When it is allowed | always | only when automatic rollback is not reliable for this project, and the conditions below all hold |
| What returns PROD | the `recover` job, with no human step | the operator, following the runbook |
| What it returns to | the commit PROD ran before the deployment; before the first one, nothing, so the deployment is withdrawn | the same version, by the runbook's steps |
| How long it may take | the project's own deployment time | the recovery-time objective in the project MADR |

### The conditions for manual recovery

Manual recovery is allowed only when **all** of these hold. The ones marked *checked* block the PROD
deployment when they fail; the rest are the project's to keep and nothing reads them.

1. **Automatic rollback is not reliable for this project**, and the project MADR says why. *Not
   checked*: no gate can tell whether a rollback would have worked.
2. **The project MADR defines the recovery-time objective**, and the contract carries the same number
   in `recovery_time_objective_minutes`. *Checked* that the contract carries one (`mhw policy check`)
   and that the MADR is accepted (the `contract` gate). *Not checked* that the MADR states the same
   number.
3. **The runbook exists in the project.** *Checked* by the `contract` gate and again by
   `recovery-plan`: a file at `recovery.runbook.path`, inside the project, a symbolic link out of it
   refused.
4. **The runbook has been tested.** *Checked* by `recovery-plan`: the runbook carries a test record
   dated the contract's `last_tested`, and every record of that date recovered within the
   recovery-time objective. `mhw policy check` already refuses a `last_tested` in the future. *Not
   checked*: whether the test really happened, and how old it may be (the contract has no maximum age;
   a project's MADR can set one, and nothing reads it).
5. **An identified operator is available for the deployment and the observation period.** *Checked*
   only that the contract names one account handle (`mhw policy check`). *Not checked*: availability,
   and whether the `by @handle` of the runbook's test record is that operator (`recovery-plan` reads
   the date and minutes of a record, never its handle, so a test run by someone else counts).
   No gate can read whether a person is present. The template prints the operator, the runbook and
   the objective in the failed run's summary.

### The runbook test record

`recovery-plan` reads whole lines of this form, starting at the first column, with or without a
leading `- ` or `* `:

```
- Tested: 2026-01-15; recovered in 20 minutes; by @operator
```

The date is `YYYY-MM-DD` and the minutes are ASCII digits. A line with anything before or after it,
an indented one, or one struck with `~~...~~`, is not a record. CRLF and LF line ends read the same. The template's own
placeholder record is not a test, so a runbook copied without filling it blocks.

## The gates

Each is one `delivery_gate.py` command and re-validates the contract first, like every gate of the
reference CI/CD.

| Gate | When | It blocks when | What it does not cover |
| --- | --- | --- | --- |
| `recovery-plan` | after `gates-before-prod`, before the PROD deployment | the commit PROD runs is not a full SHA or `none` (an unreadable PROD revision blocks); PROD already runs the revision, so there is nothing to return to; for `manual`, the runbook is missing, unreadable, outside the project, has no test record dated `last_tested`, or a record of that date exceeds the objective | whether `none` is true: a reader that prints `none` for a PROD it could not read turns a rollback into a withdrawal |
| `prod-validation` | after the PROD deployment | PROD does not report the revision (or it cannot be read); the checkout, the evidence and the revision are not the same full SHA; any critical user journey or risk scenario of the contract lacks a `pass`; the evidence file is missing, malformed, carries an unknown key or another layer | whether the project's command told the truth, as for every gate |

`recovery-plan` prints, for `$GITHUB_OUTPUT`, `mode=` and `rollback_target=`, and for `manual` also
`runbook=`, `recovery_time_objective_minutes=` and `operator=`. **`prod-validation` blocks with exit
1 on a missing or malformed evidence file, not with exit 2**: a PROD that cannot be validated is
treated as one that failed. In the template, any result of `validate-prod` other than success
recovers, whatever the exit code.

### The evidence file for `prod-validation`

| Key | Value |
| --- | --- |
| `layer` | `prod` |
| `revision` | the commit tested, full SHA |
| `prod_deployed_revision` | the commit PROD reports it runs, or `null` when unreadable |
| `critical_user_journeys`, `risk_scenarios` | every id of the contract, id to result |

Unknown keys block. The security controls and findings are not read here: they were gated before
STG and before PROD, and this file decides only whether the exposed revision works.

## The template's jobs

- **`recovery-plan`** reads the commit PROD runs and runs the gate. `deploy-prod` needs it, so a PROD
  deployment does not start until recovery is prepared.
- **`validate-prod`** runs the project's PROD validation command and the gate.
- **`recover`** runs when `recovery-plan` passed, `deploy-prod` started (it succeeded, failed or was
  cancelled) and `validate-prod` did not succeed. In `automatic-rollback` it stops further exposure,
  redeploys `rollback_target` (or withdraws a first deployment) and validates again. In `manual` it
  writes the operator, the runbook and the objective to the run's summary and fails, so the run is
  red and the operator acts. A mode it does not know fails too.
- **The rollback names an environment with no required reviewer.** A rollback reduces exposure, and
  waiting for an approval would defeat *automatic*. The project chooses that environment; the gate
  cannot check it has no reviewer. **That environment is a standing PROD path without the owner's
  approval** (see *What it does not cover*). Narrow it in the project:
  - give it a credential that can only point PROD at an artifact already deployed there, never build
    or push a new one;
  - limit its deployment branches to the trunk;
  - pin the cloud's OIDC trust for that credential to the environment and to the `job_workflow_ref`
    of the project's delivery workflow, so no other workflow file can assume it.

  The OIDC claims are documented by GitHub, not measured here.
- **`concurrency: delivery`** with `cancel-in-progress: false` keeps a second delivery from starting
  over a recovery.

## What it does not cover

- **The reviewer-free rollback environment bypasses the owner's approval.** `recover` needs it, with
  `id-token: write` and a free `run:`, so any trunk job that names it deploys to PROD without a
  reviewer, whatever the change's risk class. Only review of the project's workflows holds that path;
  no gate here reads which job names which environment. The narrowing above reduces what such a job
  could do, and is not measured.
- **No rollback has ever run here.** The template's recovery jobs are placeholders until a project
  writes its deployment commands. Whether a rollback is *reliable*, which is what allows the default
  mode, is the project's to measure.
- **Previous known-good is read as "what PROD ran before".** The gate cannot tell that version was
  good; it was the last revision this pipeline validated only when every earlier run recovered
  correctly.
- **The owner rejecting an approval.** Whether GitHub reports a rejected `production-owner-approval`
  deployment as failed or as skipped is not measured. If failed, `recover` runs and redeploys the
  revision PROD already runs, which should change nothing but is not needed; not measured.
- **Observation after validation.** The observation period ADR-0015 names is the operator's; nothing
  in the reference watches PROD after `validate-prod` passes.
- **Progressive rollouts.** "Stop further exposure" is one placeholder step; a project with staged
  traffic writes its own.
- **Local runs authorise nothing**, as for every gate.

## Adopting it

Adoption in any repository needs that repository's own Issue: copying the three jobs, writing the
command that reads the commit PROD runs and the PROD validation command, choosing the rollback
environment and, for manual recovery, filling the runbook template and recording its tests. The
owner's only deploying project has no STG yet ([docs/reference-cicd.md](reference-cicd.md),
*Adopting it*), which blocks the reference before recovery is reached.
