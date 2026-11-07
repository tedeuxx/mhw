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

## Evidence level, said first

**Written and tested; nothing reads it.** This slice ships the schema and its examples only
([#244](https://github.com/tedeuxx/mhw/issues/244)). No `mhw` command validates a project's file
yet: the fail-closed validator is [#245](https://github.com/tedeuxx/mhw/issues/245), the reference
CI/CD that calls it is [#246](https://github.com/tedeuxx/mhw/issues/246), and the recovery reference is
[#247](https://github.com/tedeuxx/mhw/issues/247). No project declares this contract. No project's
CI/CD carries ADR-0015's evidence either, and the lock's deployment half stays written policy only.

The suite checks the schema with a small JSON Schema evaluator that lives in the test file. It is not
a tool and does not stand in for #245. It refuses any schema keyword it does not implement, so the
schema cannot carry a rule the suite skips.

**Patterns need full-match semantics, and the #245 validator must use them.** JSON Schema patterns
are ECMA-262 regular expressions, where a final `$` does not match before a trailing newline. Python's
`re.search` with the same `$` does, so `"@handle\n"` or a MADR path ending in a newline would pass.
Every pattern here is anchored with `^` and `$`; the suite's evaluator refuses one that is not and
matches with `re.fullmatch`, and it tests one trailing-newline case per pattern. A validator in
another language must reach the same answer: an ECMA engine, or a full match.

## Where a project puts it

The contract has no fixed path in a consumer repository yet: #245 settles where the validator looks.
The file is plain JSON, so a project can keep it in version control next to the MADR that ratifies its
values.

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
  operator handle named as available for the deployment.

One more constraint is **mhw's own guard, not ADR-0015 text**: the risk model must name at least one
high-risk rule. Without one, the high-risk approval rule above would have nothing to apply to, so this
guard is what makes ADR-0015's high-risk rule enforceable.

The schema names these things; it checks no evidence. Whether the controls ran, the MADR is really
accepted or the runbook was really tested is for a validator to read (#245, #246).

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
  - `last_tested`: the date the runbook was last tested, as `YYYY-MM-DD`.
- `operator`: required for `manual`. The account handle of the operator available for the deployment
  and the observation period, as `@handle`. Never contact details.

The contract only names the mode. What a runbook must contain is #247.

## What this contract does not cover

- **No check reads a project's file.** That is #245. Until then a file that breaks the schema fails
  nowhere.
- **The schema checks shape, not truth.** It cannot tell whether the MADR at `madr.path` exists or is
  really accepted, whether the runbook was really tested on `last_tested`, or whether the operator is
  available. Those need evidence a validator reads, which is #245 and #246.
- **Which test layers a project runs** (unit, API, end to end, installed-STG) is not a field. ADR-0015
  asks for every applicable layer; how the reference CI/CD records them is #246.
- **No enforcement anywhere.** By the workstation's evidence words, this is *written* and tested. It is
  not installed in any project, not loaded and not enforced.
