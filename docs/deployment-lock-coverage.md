# ADR-0015's first concrete lock: the coverage report

What carries [ADR-0015](adr/0015-master-of-first-principles-ethical-locks-on-own-aims.md)'s first
concrete lock, per capability of [#192](https://github.com/tedeuxx/mhw/issues/192), with its carrier,
the operating systems and agent harnesses it reaches, and its real evidence level. The five slices are
[#243](https://github.com/tedeuxx/mhw/issues/243) to [#247](https://github.com/tedeuxx/mhw/issues/247).
Each slice also has a row in the README's [Current state](../README.md#current-state); this page
reads the lock as one control.

## Said first

**The lock is written and tested, and enforced nowhere.** Its agent half is an instruction in the
global brief, not installed on the reference machine. Its deployment half is a contract, a validator,
a set of gates and templates that a project's CI/CD is meant to run, and **no project runs them**. mhw
can distribute and test those carriers; it cannot claim enforcement in another repository until that
repository adopts them through its own Issue and measures them there (#192, *Required design before
build*). No hook carries any of it, by design.

Evidence words, strongest last: *written* (in the source), *tested* (a suite in mhw's CI), *dry-run
measured* (run in mhw's CI against a synthetic fixture, deploying nothing), *installed*, *loaded*,
*enforced*. The last three are claims about a place, so each says where.

## Per capability

| #192 capability | Carrier | Agent harness | OS | Evidence level |
| --- | --- | --- | --- | --- |
| 1. The material-advancement refusal and its uncertainty rule (#243) | the global brief, rendered per agent harness | Claude Code, Codex, Kiro: the user brief; desktop apps: pasted by hand | macOS, Linux; Windows rendering only | written and tested (generated-source drift); not installed on the reference machine. An instruction: no agent harness can check intent, so never *enforced* |
| 2. The versioned project-policy contract (#244) | `global/project-policy/project-policy.schema.json` and its examples ([contract](project-policy-contract.md)) | none: a file a project's CI/CD is meant to read | any (the suite runs on macOS, Linux, Windows) | written and tested. No project declares it |
| 3. Conservative validation, fail closed (#245) | `mhw policy check` | none: a command a project's CI/CD is meant to run | macOS, Linux (`mhw`); Windows (`python global/project-policy/project_policy.py check`) | written and tested; mutation-checked. Run by mhw's dry run only; by no project |
| 4. Exact-revision containerised evidence before STG and PROD, installed-STG evidence before PROD (#246) | `reference-delivery-gate.yml`, `delivery_gate.py`, the caller template ([reference CI/CD](reference-cicd.md)) | none: GitHub Actions | GitHub Actions `ubuntu-latest` (the dry run); the gate suite on macOS, Linux, Windows | written and tested; dry-run measured against a synthetic fixture, the installed STG a local stand-in. The caller's deployment jobs never ran. Adopted by no project |
| 5. Risk-based authorisation: low risk automatic, high risk the owner's approval of the exact revision (#246) | the `classify` and `environment` gates; the project's environment with a required reviewer | none | as row 4 | low-risk path dry-run measured; high-risk path and the environment check in the suite only; never against a real protected environment. Residual: the recovery reference's reviewer-free rollback environment (row 6) is a standing PROD path without the owner's approval, held only by workflow review |
| 6. Recovery: automatic rollback by default, manual only with an objective, a tested runbook and an operator (#247) | the `recovery-plan` and `prod-validation` gates, the template's recovery jobs, the runbook template ([recovery reference](recovery-reference.md)) | none | the suite on macOS, Linux, Windows | written and tested: both paths and each blocking class in the suite. No dry run reaches it and no rollback has run anywhere |
| 7. This coverage report (#247) | this page and the README's Current state rows | none | n/a | written. A report, not a control |

## What no carrier reaches

- **Truth.** Every gate checks that evidence is complete, bound to the exact revision and inside the
  floor. A project command that writes `pass` without testing passes.
- **People.** Whether the owner ratified a project MADR, whether a reviewer is the owner, whether an
  operator is available: names and settings are read, presence is not.
- **The reviewer-free rollback environment.** The recovery reference's `recover` job names a PROD
  environment with no required reviewer, with `id-token: write` and a free `run:`. Any job on the
  trunk that names that environment deploys to PROD without the owner's approval, whatever its risk
  class. Only review of the project's workflows holds that path; no gate reads it.
  [docs/recovery-reference.md](recovery-reference.md) recommends how to narrow it.
- **Another repository.** Nothing here installs a carrier in a project, and nothing here can see
  whether a project's CI/CD runs one.
- **Kiro and the desktop apps, for the deployment half.** The deployment half has no agent harness
  carrier at all; it lives in a project's CI/CD. The table above says *none* for every agent harness
  rather than implying one.
- **A deploying project without an STG.** The owner's only deploying project has none; the
  `installed-stg` gate blocks there until that project decides otherwise.

## Owner actions and target-repository follow-ups

None of these is opened by this page; each is the owner's or a target repository's own work.

- Install the release that carries lock 1, in a fresh session, and run its canary.
- Run lock 4's dry run in a throwaway repository on his account (#246's owner action).
- For each deploying project that adopts the lock: an Issue in that repository to declare the
  contract, ratify its MADR, create its environments, expose the commit STG and PROD run, write its
  evidence and recovery commands and, for manual recovery, fill and test the runbook.
