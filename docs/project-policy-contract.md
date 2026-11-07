# The project-policy contract (ADR-0015 lock 2 of 5)

A deploying project declares, in one machine-readable file, the values its CI/CD needs to apply
[ADR-0015](adr/0015-master-of-first-principles-ethical-locks-on-own-aims.md)'s first concrete lock at
the STG/PROD boundary. `mhw` supplies the shape and the common floor; the project supplies its own
values, ratified in its own MADR.

| File | What it is |
| --- | --- |
| `global/project-policy/project-policy.schema.json` | The contract, a JSON Schema (draft 2020-12), `schema_version` 1 |
| `global/project-policy/project-policy.example.json` | A valid example for a synthetic project |
| `global/project-policy/project-policy.invalid.json` | An invalid example that weakens seven parts of the floor |
| `global/project-policy/project_policy_test.py` | The suite: the valid example passes, removing each required field fails, each floor is held |
| `global/project-policy/project_policy.py` | The fail-closed validator behind `mhw policy check` ([#245](https://github.com/tedeuxx/mhw/issues/245)) |
| `global/project-policy/project_policy_check_test.py` | The validator's suite: one test per failure class |

## Evidence level, said first

**Written and tested; no project runs it.** The schema and its examples are
[#244](https://github.com/tedeuxx/mhw/issues/244); `mhw policy check`, the fail-closed validator, is
[#245](https://github.com/tedeuxx/mhw/issues/245). The reference CI/CD that calls the validator is
[#246](https://github.com/tedeuxx/mhw/issues/246), and the recovery reference is
[#247](https://github.com/tedeuxx/mhw/issues/247). No project declares this contract and no project's
CI/CD runs the validator, so it is not installed, loaded or enforced anywhere. No project's CI/CD
carries ADR-0015's evidence either, and the lock's deployment half stays written policy only.

The validator and both suites use one small JSON Schema evaluator, in `project_policy.py`. It refuses
any schema keyword it does not implement, so the schema cannot carry a rule the validator skips.

**Patterns need full-match semantics, and the validator uses them.** JSON Schema patterns
are ECMA-262 regular expressions, where a final `$` does not match before a trailing newline. Python's
`re.search` with the same `$` does, so `"@handle\n"` or a MADR path ending in a newline would pass.
Every pattern here is anchored with `^` and `$`; the evaluator refuses one that is not (the validator
then exits 2) and matches with `re.fullmatch`, never `re.search`. It also compiles no pattern from a
file: the five patterns the schema uses are compiled from literals in `project_policy.py`, and any
other pattern exits 2. A schema pattern edit therefore lands in both files, and a test holds the two
sets equal. The suites test one trailing-newline
case per pattern, and the validator's suite repeats four of them through the command. A validator in
another language must reach the same answer: an ECMA engine, or a full match.

## Where a project puts it

`project-policy.json` at the repository root, version-controlled beside the MADR that ratifies its
values. `mhw policy check --project=DIR` reads `DIR/project-policy.json` (the current directory by
default); `--file=PATH` reads another path instead.

## Validating it: `mhw policy check`

```
mhw policy check [--project=DIR | --file=PATH]
```

It exits 0 only when the file is a valid contract. Everything else is non-zero, with one reason per
line on standard error, each naming its class:

| Exit | When |
| --- | --- |
| 0 | the file is a valid `schema_version` 1 contract |
| 1 | **missing** (no file, or a directory); **malformed** (not UTF-8, not JSON, not an object, a repeated key, or `NaN`/`Infinity`); **unknown version** (no `schema_version`, or one this validator does not know); or the contract is broken, each finding classed as one of: missing or invalid risk classification, missing mandatory evidence, medium-or-higher findings tolerated, unknown severity, inconclusive evidence does not block, risk-based approval weakened, low finding without a bug Issue, project MADR not ratified, recovery not prepared, contract invalid |
| 2 | a usage error, or the validator cannot decide: its own schema is unreadable, uses a keyword or type its evaluator does not implement, or a pattern outside its known set. It does not answer "valid" when it cannot check |

A repeated key fails because JSON readers disagree on which copy wins, and one file must not mean two
things. `NaN` fails because it compares false with every bound, so `threshold_percent` NaN would pass
every range check.

Beyond the schema, it checks one thing the pattern cannot: `recovery.runbook.last_tested` must be a
real calendar date (not `2026-02-30`) and not later than tomorrow on the validator's clock (one day of
slack for time zones). A runbook cannot have been tested in the future.

On macOS and Linux it is `mhw policy check`. On Windows, where `mhw` does not dispatch it, run
`python global/project-policy/project_policy.py check` with the same options. It needs Python 3.9 or
later and nothing else.

## Versioning

`schema_version` is an integer, and version 1 is the only one. A change that makes a valid version 1
file invalid, or changes what one means, needs a new `schema_version`; the file then declares which
version it was written for, and an unknown version fails. Adding an optional field does not.

## The common floor

Some values are constants in the schema. They are ADR-0015's floor, and a project's file cannot set
them any other way. A project may be stricter where the schema allows it, never looser:

- only `low` findings are tolerated, or none;
- an unclassified or inconclusive finding blocks;
- every tolerated low finding needs a bug Issue;
- an unclassified change blocks;
- a high-risk PROD deployment needs the owner's approval for the exact revision;
- the seven minimum security controls are named;
- the file declares the project MADR accepted;
- manual recovery carries a recovery-time objective, a runbook with a last-tested date, and an
  operator handle named as available for the deployment and the observation period.

One more constraint is **mhw's own guard, not ADR-0015 text**: the risk model must name at least one
high-risk rule. Without one, the high-risk approval rule above would have nothing to apply to, so this
guard is what makes ADR-0015's high-risk rule applicable. `mhw policy check` refuses a model without
one; that holds only where a project's CI/CD runs the check, and none does yet.

The schema names these things; it checks no evidence, and neither does the validator. Whether the
controls ran, the MADR is really accepted or the runbook was really tested is for the reference CI/CD
to read (#246).

## Fields

Every field below is required unless it says otherwise.

### `schema_version`

The integer `1`.

### `project`

The repository the contract governs, as `owner/name`.

### `madr`

The project's own decision record that sets its quality bar and its low/high deployment-risk model.

- `path`: a repository-relative path to a `.md` file, with no leading `/` and no `..` segment.
- `status`: always `accepted`. A proposed MADR is not a ratified quality bar.

### `coverage`

The quantitative half of high coverage. ADR-0015 sets no universal number; the project's MADR does.

- `threshold_percent`: a number above 0 and at most 100.
- `metric`: what the percentage counts, one of `line`, `branch` or `statement`.

### `mandatory_scenarios`

The named half of high coverage. Neither half substitutes for the other, so both are required.

- `critical_user_journeys`: at least one journey, each an object with:
  - `id`: lowercase letters, digits and hyphens, starting with a letter or digit;
  - `description`: what the journey proves, in one sentence.
- `security_controls`: the security evidence the project's CI/CD must produce, each listed once. It
  must contain the minimum ADR-0015 names: `quality-scan`, `sast`, `owasp-vulnerability-coverage`,
  `authentication`, `authorization`, `encryption-in-transit` and `encryption-at-rest`. ADR-0015 says
  that minimum is not exhaustive, so a project may add `dast`, `dependency-scan` or `secret-scan`. Any
  other value fails.
- `risk_scenarios`: at least one existential or reputational risk scenario, with the same `id` and
  `description` shape as a journey.

### `severity`

How findings are treated. The scale is `low`, `medium`, `high`, `critical`.

- `tolerated`: `["low"]`, or `[]` to tolerate nothing. Medium or higher can never be tolerated.
- `unclassified`: always `block`. A finding with no severity blocks.
- `inconclusive`: always `block`. Evidence that neither passes nor fails blocks.

### `low_findings`

What happens to a tolerated low finding.

- `bug_issue_required`: always `true`. Each one needs a bug Issue before deployment.
- `issue_label`: the label the project's tracker uses for those Issues, so a check can find them.

### `risk_classification`

How the project classifies a deployment as low or high risk.

- `rules`: at least one rule, and at least one of them of class `high`. A model with only `low`
  rules would make the high-risk approval constant gate nothing. This is mhw's own guard, not
  ADR-0015 text. Each rule is an object with:
  - `class`: `low` or `high`;
  - `when`: the condition, in the words of the project's MADR.
- `unclassified`: always `block`. A change no rule classifies blocks before approval.

### `approval`

Who authorises a PROD deployment, per risk class.

- `low_risk`: `automatic-after-all-gates`, or the stricter `owner-exact-revision`.
- `high_risk`: always `owner-exact-revision`: the owner approves that exact revision and deployment.

### `recovery`

What happens when a critical production validation fails.

- `mode`: `automatic-rollback`, the ADR's default (the schema declares none), which returns to the previous known-good version; or
  `manual`, allowed only when automatic rollback is not reliable.
- `recovery_time_objective_minutes`: required for `manual`. A whole number of minutes, at least 1,
  stated in the project's MADR.
- `runbook`: required for `manual`. An object with:
  - `path`: a repository-relative `.md` path, with the same rules as the MADR's;
  - `last_tested`: the date the runbook was last tested, as `YYYY-MM-DD`. The schema checks the shape;
    `mhw policy check` also refuses a date that does not exist or lies in the future.
- `operator`: required for `manual`. The account handle of the operator available for the deployment
  and the observation period, as `@handle`. Never contact details.

The contract only names the mode. What a runbook must contain is #247.

## What this contract does not cover

- **No project runs the check.** `mhw policy check` exists (#245), but a file that breaks the
  contract fails only where a project's CI/CD calls it. Wiring it in as a required step is #246's
  reference, and adopting that in any repository needs that repository's own Issue.
- **The validator reads no evidence and no findings.** It checks the contract a project declares,
  not a deployment. Applying the contract to a revision's actual findings and test results, and
  binding them to the exact revision, is #246 (with #193's evidence binding).
- **The schema checks shape, not truth.** Neither it nor the validator can tell whether the MADR at
  `madr.path` exists or is really accepted, whether the runbook was really tested on `last_tested`,
  how long ago that may be, or whether the operator is available. Those need evidence, which is #246.
- **`when` is free text, and nothing resolves a conflict between rules.** The validator does not read
  a change, so it cannot apply a rule. When a change matches both a `low` and a `high` rule, which wins
  is undefined in `schema_version` 1. The conservative reading is that `high` wins and no match blocks;
  defining that, or a machine-readable `when`, belongs with whatever classifies a real change (#246)
  and, if it changes what a version 1 file means, a `schema_version` 2.
- **`operator` names one account, never a team.** `@org/team` fails the pattern on purpose: ADR-0015
  asks for an identified operator, and a team handle does not identify who is available.
- **Which test layers a project runs** (unit, API, end to end, installed-STG) is not a field. ADR-0015
  asks for every applicable layer; how the reference CI/CD records them is #246.
- **No enforcement anywhere.** By the workstation's evidence words, the contract and its validator are
  *written* and tested. Neither is installed in any project, loaded or enforced.
