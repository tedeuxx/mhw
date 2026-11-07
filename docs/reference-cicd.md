# The reference CI/CD at the STG/PROD boundary (ADR-0015 lock 4 of 5)

[ADR-0015](adr/0015-master-of-first-principles-ethical-locks-on-own-aims.md)'s first concrete lock says
what must be true before a deploying project's revision reaches STG and PROD. This reference is how a
project's own CI/CD can carry it: a reusable workflow that runs the gates, the script that decides
each gate, a caller template with the deployment jobs, and a dry run against a synthetic fixture.

| File | What it is |
| --- | --- |
| `.github/workflows/reference-delivery-gate.yml` | The gates, as a reusable workflow (`workflow_call` only). It deploys nothing and names no environment |
| `global/project-policy/delivery_gate.py` | The script each gate runs: it applies a valid contract to one revision's evidence |
| `global/project-policy/delivery_gate_test.py` | Its suite: a benign pass per gate and one test per blocking class, plus the workflows' pins |
| `global/project-policy/reference/caller-workflow.yml` | A template a project copies, with the STG and PROD deployment jobs. Not live in mhw |
| `global/project-policy/reference/fixture/` | The synthetic project the dry run gates |
| `.github/workflows/reference-delivery-dry-run.yml` | The dry run: the gate workflow against the fixture, on pull requests that change these files |

## Evidence level, said first

**Written and tested; dry-run measured in mhw's own CI against a synthetic fixture. No project runs
it.** The dry run calls the exact reusable workflow a project would adopt, at the pull request's head,
and its run URL is recorded in the body of the pull request that introduced it
([#246](https://github.com/tedeuxx/mhw/issues/246)).
It deploys nothing, so it measures the gates and their binding, never a deployment. The deployment jobs
in the caller template have never run anywhere. No project calls the workflow, so the lock's deployment
half is not installed, loaded or enforced in any repository.

The Issue asked for the dry run in a throwaway repository. It ran in mhw instead, because creating a
repository on the owner's account is his act, not an agent's; the throwaway-repository run is listed
as an owner action on #246.

## The gates

Each gate is one `delivery_gate.py` command. Every one re-validates the contract first, with
`mhw policy check`'s own code, so no gate runs on a broken contract. Exit 0 passes, 1 blocks with one
`BLOCK` line per reason, 2 means it cannot decide, and the workflow treats 2 as a block too.

| Gate | When | Evidence it reads | It blocks when | What it does not cover |
| --- | --- | --- | --- | --- |
| `mhw policy check` (lock 3) | first, before STG and before PROD | the contract, `project-policy.json` | the contract is missing, malformed, of an unknown version, or breaks the floor | anything but the contract |
| `contract` | right after it | the contract, the MADR file at `madr.path`, the runbook file for manual recovery | the contract governs another repository; the MADR is missing, resolves outside the project (a symbolic link included) or its first status line does not read exactly `accepted`; a manual-recovery runbook file is missing or outside the project | whether the owner really ratified the MADR, or the runbook was really tested on `last_tested` |
| `container` | before STG and before PROD | the evidence the project's test command writes in the digest-pinned container | the image is not pinned by digest or differs from the evidence's; the step is not in a container (`/.dockerenv`; checked by default, and the workflow never turns it off); the checkout, the evidence and the requested revision are not the same full SHA; any test layer, journey, risk scenario or one of the contract's security controls lacks a `pass`; coverage is missing, of another metric, not a finite percentage from 0 to 100, or below the threshold; a finding breaks the severity rules | whether the project's command told the truth (below) |
| `installed-stg` | after the STG deployment, before PROD | the evidence the project's STG test command writes on the runner | STG does not report the revision under test, or it cannot be read; any reported test layer, every journey and every risk scenario lacks a `pass`; no security validation is reported, or one is not in the contract; a finding breaks the severity rules | which security controls apply to an installed environment: only the reported ones are read |
| `classify` | after `installed-stg` | the rule indices the change matches (`risk-rules`) | no rule is given (an unclassified change blocks); an index is not a rule of the contract | whether the indices are the right ones: `when` is free text a person applies |
| `environment` | for an owner-approval deployment | the environment's protection, read with `gh api` | the environment does not exist (a job that names a missing one creates it unprotected), or it has no required reviewer | that the reviewer is the owner |

### Severity rules, in the evidence

A finding is `{"id", "severity", "bug_issue"}`. It blocks when it has no severity (unclassified), a
severity off the `low`/`medium`/`high`/`critical` scale (unknown), a severity the contract does not
tolerate (medium or higher always), or when a tolerated low finding has no `bug_issue` (`#N` or an
Issue URL). A result other than the literal `pass` blocks; `inconclusive` is named as such.

### Classifying a real change

`schema_version` 1 leaves `when` as free text and the conflict between rules undefined. This reference
does not change the schema. It applies the conservative reading the contract document names:

- the change's matched rules arrive as indices into `risk_classification.rules`; in the caller template
  they are the merged pull request's `risk-rule:<index>` labels;
- **a change that matches any `high` rule is high**, whatever else it matches;
- **a change that matches no rule blocks** before any approval.

So a person still applies the words of each rule, and the gate makes the result unambiguous and
complete. A machine-readable `when` would need a `schema_version` 2.

### Authorisation

The class and the contract's `approval` give the environment the PROD job names:

- low risk with `automatic-after-all-gates`: `prod-environment` (default `production`), with no wait;
- high risk, or low risk where the contract asks `owner-exact-revision`: `owner-approval-environment`
  (default `production-owner-approval`), which must have a required reviewer. GitHub then holds the
  deployment job until a reviewer approves **that run**, which runs at that revision, so the approval
  is for the exact revision and deployment (documented by GitHub; not exercised here).

## The evidence file

The project's test command writes it to `$DELIVERY_EVIDENCE`. Unknown keys block, so a typo cannot
pass silently.

| Key | `container` | `installed-stg` |
| --- | --- | --- |
| `layer` | `container` | `installed-stg` |
| `revision` | the commit tested, full SHA, read from git | same |
| `container_image` | `$DELIVERY_CONTAINER_IMAGE` | not allowed |
| `stg_deployed_revision` | not allowed | the commit STG reports it runs, or `null` when unreadable |
| `test_layers` | every applicable layer, id to result, at least one | same |
| `coverage` | `{"metric", "percent"}` | not allowed |
| `critical_user_journeys`, `risk_scenarios` | every id of the contract, id to result | same |
| `security_controls` | every control of the contract | at least one, each in the contract |
| `findings` | a list, empty when there are none | same |

## The dry run

`reference-delivery-dry-run.yml` calls the gate workflow twice against the fixture: `stage: stg`, then
`stage: prod` with risk rule 1 (low, automatic). A last job checks the outputs and says that nothing
was deployed.

- **Measured by the run:** the validator as a required step; the contract gate; tests in a
  digest-pinned container with the three-way revision binding; the installed-STG binding against a
  stand-in; the low-risk classification and its environment output.
- **A stand-in, not an STG:** the prod call's STG is the fixture app served on 127.0.0.1 in the runner.
- **Stubs:** the fixture's seven container security results are constants. It has nothing to scan.
- **Not in the run, only in the suite:** every blocking class, the high-risk path and the environment
  check. A failing gate would turn the run red, so the run shows the passing path only.
- **Not exercised anywhere:** the caller template's deployment jobs, its label read, and the
  environment read against a real protected environment. The `gh api` read of an environment's
  protection with the workflow token is documented by GitHub, not measured here.

## What it does not cover

- **The gates check evidence, not truth.** The project's own commands write the results. The gates
  check that they are complete, bound to the exact revision and the pinned image, and inside the
  floor. A command that writes `pass` without testing passes.
- **The STG must report the commit it runs.** [#193](https://github.com/tedeuxx/mhw/issues/193) found
  that a served page can expose its release and not its commit. Where STG cannot report the commit,
  `stg_deployed_revision` is `null` and the gate blocks; it never infers a match.
- **Bug Issues are checked for shape only.** Nothing reads whether `bug_issue` exists or carries the
  contract's `issue_label`.
- **Environments and reviewers are the project's settings.** The reference cannot create them.
  Required reviewers on a private repository need a paid GitHub plan. The gate checks that a reviewer
  is required, not who it is.
- **`mhw-revision` must equal the commit in `uses:`.** Nothing checks they agree. The gates also check
  out `tedeuxx/mhw` by name; a fork must change that line.
- **Risk labels are read at run time.** A label changed on the merged pull request before the run
  changes the class. The class is printed in the run log.
- **Recovery is not here.** What happens when a critical PROD validation fails is the recovery
  reference, [#247](https://github.com/tedeuxx/mhw/issues/247).
- **Local runs authorise nothing.** `delivery_gate.py` runs anywhere, but only the containerised run in
  the pipeline is evidence; outside a container the `container` gate blocks. Its
  `--no-container-check` flag exists for the suite only, and the reference workflow never passes it.

## Adopting it

Adoption in any repository is out of scope here and needs that repository's own Issue. It means:
copying the caller template, writing the test commands that produce the evidence file, creating the
three environments with the owner as reviewer on the approval one, and exposing the STG's commit.
**Named risk:** the owner's only deploying project runs a single environment with no STG. Adopting this
reference there needs its own decision first: the `installed-stg` gate has nothing to read without an
STG, and it blocks.
