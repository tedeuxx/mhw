# 0001 — Fixture quality bar and deployment-risk model

- **Status:** accepted
- **Date:** 2026-11-07
- **Deciders:** none: this is a synthetic fixture for the reference CI/CD's dry run (mhw Issue #246)

## Context and problem

The reference CI/CD's dry run needs a project to gate. This fixture is that project. It is not a
product, it deploys nothing, and nobody ratified this record: its `accepted` status exists only so
the contract gate has a MADR to read.

## Decision outcome

- Line coverage of `fixture_app.py` at or above 85 percent.
- One critical journey, `greet-reader`, and one risk scenario, `no-unescaped-name`.
- A change to how a name is escaped is high risk; every other change is low risk.
- Recovery is automatic rollback.
