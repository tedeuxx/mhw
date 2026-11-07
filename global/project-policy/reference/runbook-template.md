# Recovery runbook: <project> PROD (TEMPLATE)

<!-- ADR-0015 lock 5 of 5, mhw Issue #247. A project copies this file through its own adoption Issue,
fills every <...> value and names its path in project-policy.json, recovery.runbook.path. Read
docs/recovery-reference.md in mhw first. A project needs this runbook only when its contract sets
recovery.mode to manual; the default, automatic-rollback, needs none. -->

## When this runbook applies

A critical production validation failed after a PROD deployment (`prod-validation` blocked, or the
deployment job failed or was cancelled), and this project's recovery mode is `manual` because
automatic rollback is not reliable here. The reason it is not reliable is recorded in the project
MADR, `<madr path>`.

## Who and how fast

- **Recovery-time objective:** `<minutes>` minutes, from the failed validation to PROD running the
  previous known-good version again. The project MADR states it; the contract's
  `recovery_time_objective_minutes` carries the same number.
- **Operator:** `<@handle>`, the contract's `operator`. Available for the whole deployment and the
  observation period that follows it, `<observation period>`.
- **Fallback when the operator cannot be reached:** `<who, or "none: do not deploy">`.

## 1. Stop further exposure

<the steps that stop new traffic, users or rollout stages reaching the failed revision: pause the
rollout, shift traffic, enable maintenance mode. Each step is a command or a console action, with the
account it needs>

## 2. Return to the previous known-good version

The version to return to is the `rollback_target` the run printed before the deployment: the commit
PROD ran before it. `none` means this was the first deployment, and recovery is to withdraw it.

<the steps that redeploy rollback_target, or withdraw the first deployment, each with its command and
the credential it needs>

## 3. Confirm recovery

<the command that reads the commit PROD now runs, and the validation that must pass again at
rollback_target: every critical user journey and risk scenario of the contract>

## 4. After recovery

- Open a bug Issue for the failed validation and link the failed run.
- Record the time taken against the recovery-time objective in the log below.

## Test log

A test is a rehearsal of steps 1 to 3 against a non-production copy or a planned PROD exercise. After
each test, add one record line in exactly this form, and set the contract's `recovery.runbook.last_tested`
to its date. `delivery_gate.py recovery-plan` reads these lines: it needs one dated `last_tested`, and
every record of that date must be within the recovery-time objective. Strike an invalid record with
`~~...~~` rather than deleting it; a struck record is not read.

- Tested: <YYYY-MM-DD>; recovered in <minutes> minutes; by <@handle>
