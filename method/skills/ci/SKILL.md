---
name: "ci"
description: "Wire continuous integration for a `<project>` repo — workflows, required checks, runners, pinned actions, short-lived cloud credentials, the secrets standard, the version and release workflows, and the AI review workflows. Use when writing or changing a workflow, making a check required, granting a pipeline a cloud role, or a required check never reports. Not for branching or the release flow's rules (see scm), the gate thresholds or the analysis tool (see quality-gates), or infrastructure state (see provisioning)."
purpose: "hold the pipeline wiring, so every gate the loop relies on actually runs, reports, and blocks"
---

> **Written for the selected tool: GitHub Actions.** This skill describes the continuous-integration
> capability as the owner runs it today. Everything specific to GitHub Actions sits in one section at
> the end, *Tool section — GitHub Actions*. To move to another CI system, replace that section only; the
> rules above it stay as they are.

Wire the continuous-integration capability for any `<project>` repo. Pick the loop model first
(`/agents-configuration`); which checks sit on which pull request follows from it (`/quality-gates`).

Context: $ARGUMENTS

**Split out of the former `devops` skill at #97**, together with `scm`, `quality-gates` and
`provisioning`, so an agent wiring a pipeline loads the pipeline and nothing else.

## Rules that hold on any CI system

- **Pipelines are independent per repo** — never trigger one repo's pipeline from another.
- **Every gate the loop relies on is a required check, and a required check must always report.** A
  check that never starts leaves the pull request blocked forever, and one that is skipped by a trigger
  filter is indistinguishable from one that passed. Gate the heavy *steps* inside an always-running
  job instead.
- **Pin every third-party step to an immutable revision** (a full commit SHA, not a moving tag), install
  dependencies without running their install scripts (`npm ci --ignore-scripts`), and give each job the
  least privilege it needs.
- **Serialize deploys** with a concurrency group so two runs never deploy over each other.
- **No long-lived cloud keys.** A pipeline assumes a dedicated cloud role through short-lived federated
  identity (OIDC). A role has two halves: the trust policy (WHO may assume it — pin the repository's
  **immutable** identity, never its name, because a rename silently breaks every assume-role) and a
  least-privilege permissions policy (WHAT it may do). The role itself is infrastructure work
  (`/provisioning`); the pipeline only references its ARN.
- **The agent never deploys and never applies.** The merge is what runs the deploy and the apply.

## The workflow set (per repo)

| Role | When | What |
|---|---|---|
| Build/test gate | every pull request | lint, typecheck, coverage ≥85%, E2E, the quality-gate analysis (`/quality-gates`) |
| Infrastructure gate | pull request touching `iac/` | policy scan (`checkov`), format/validate, plan (`/provisioning`) |
| Deploy / apply | merge to `main` | deploy the app; apply the infrastructure plan |
| Version | merge to `main` (or `develop` under `gitflow-multi-env`) | numeric SemVer bump, tag, release (`/scm` for the rules) |
| Release (deliberate) | on demand | a minor or major cut, or a library's release |
| AI assistant and AI review | mention, and every pull-request revision | advisory, never blocking |

**Roles by repository shape.** A static site needs an **infrastructure runner** role (broad
provisioning, bootstrapped out-of-band because it cannot manage itself) and a **deploy** role (object
write/delete/list and a CDN invalidation, created by infrastructure code). Under `gitflow-multi-env`,
roles are per environment, so a leaked staging token cannot assume the production role.

## Secrets — one standard, never decided per repo

Two axes: **scope** (does the value change per environment?) and **name**.
- **Environment secret** = every cloud OIDC role ARN.
- **Repository secret** = the same value for every environment, reserved for account- or org-wide
  tooling tokens (`TFC_API_TOKEN`, `SONAR_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `VERSION_BUMP_TOKEN`).
- **Naming:** `AWS_<LAYER>_OIDC_ROLE_ARN`, `LAYER` ∈ `INFRA`/`FED`/`BFF` — no legacy `AWS_ROLE_ARN`, no
  generic `AWS_OIDC_ROLE_ARN`.
- Writing a secret is the owner's act; the deny floor forbids it to agents.

## The version workflow — the loop guard is critical

The version workflow bumps with bump-my-version (the scheme and `.bumpversion.toml` are in `/scm`):
- **`trunk-single-env`**: every push to `main` bumps the part the merged pull request's `semver:` label
  names, tags it and publishes the release.
- **`gitflow-multi-env`**: every push to `develop` bumps the patch; `main` bumps by label.
- **A deliberate release** (a semver-pinned library, or a minor/major on demand) is a manually
  dispatched workflow, not a push.

**Loop guard.** Bump commits carry the message `bump: {current} → {new}`, and **every version workflow
skips a commit whose message starts with `bump:`**. The bump is pushed with a token that re-triggers CI,
so the message and the guard must stay aligned, or CI loops forever.

**Required secret:** `VERSION_BUMP_TOKEN`, a fine-grained token with contents and workflows write, so
the bump commit and tag can be pushed past protection by an administrator actor.

## Pros & cons
**Pros:** every gate is a required check that cannot be skipped by a path filter; no long-lived cloud
keys; one secrets standard; a loop-guarded automatic version on every merge.
**Cons:** review and analysis cost scale with push count; a pinned SHA must be bumped by hand or by an
update bot; the bump token is a standing credential.

## Tool section — GitHub Actions

Everything below is specific to GitHub Actions. A tool switch replaces this section only.

### Files and conventions
- Workflows live in `.github/workflows/`. The usual set: `build-test.yml` (pull request),
  `infra-plan.yml` (pull request, `iac/`), `deploy.yml` and `infra-apply.yml` (merge to `main`),
  `version-main.yml` (and `version-develop.yml` under GitFlow), `release.yml` (`workflow_dispatch`),
  `claude.yml` and `claude-code-review.yml`.
- `permissions:` per job, least privilege; `concurrency:` groups on deploys; third-party actions pinned
  `uses: owner/action@<40-char-sha>`.

### A required check behind a `paths:` filter never reports
If a *required* check is gated by a trigger-level `on.pull_request.paths:` filter, a pull request
touching none of those paths never starts the workflow, and branch protection leaves it permanently
`BLOCKED`. **Fix:** drop `paths:` from the `pull_request` trigger so the job always runs and reports,
then gate the heavy steps inside it with a `dorny/paths-filter@v3` step and `if:`. Keep the `push`
trigger's `paths:` (the analysis baseline runs only on real changes).

### Cloud credentials through OIDC
```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@<sha>
    with:
      role-to-assume: ${{ secrets.AWS_INFRA_OIDC_ROLE_ARN }}
```
The trust policy pins the repository's **immutable** OIDC subject,
`repo:<org>@<org_id>/<repo>@<repo_id>:*`, on the pre-existing GitHub OIDC provider. Audit secrets with
`gh secret list -R <repo>` and `--env <name>`.

### The version workflows
- `version-main.yml`: on push to `main`, skip if the head commit message starts with `bump:`, read the
  merged pull request's `semver:` label, run `bump-my-version bump <part>`, push the commit and tag with
  `VERSION_BUMP_TOKEN`, and create the GitHub Release.
- A `semver-label` workflow fails a pull request into `main` that carries not exactly one
  `semver:major|minor|patch` label.
- `release.yml` (`workflow_dispatch`) cuts a deliberate minor or major. Dispatching it is the owner's
  act: the deny floor forbids `gh workflow run` to agents.

### The Claude Code GitHub App workflows
Both use `anthropics/claude-code-action@v1` with the `CLAUDE_CODE_OAUTH_TOKEN` repository secret; the
app install is in `/scm`.

**`claude.yml` — on-demand assistant (`@claude`):**
```yaml
on:
  issue_comment: { types: [created] }
  pull_request_review_comment: { types: [created] }
  issues: { types: [opened, assigned] }
  pull_request_review: { types: [submitted] }
jobs:
  claude:
    if: contains(<event body/title>, '@claude')          # gate on the @claude mention
    permissions: { contents: read, pull-requests: read, issues: read, id-token: write, actions: read }
    steps:
      - uses: actions/checkout@v4            # fetch-depth: 1
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          additional_permissions: |
            actions: read                    # lets Claude read CI results on the PR
```
With no `prompt`, Claude follows the instruction in the comment that tagged it.

**`claude-code-review.yml` — automatic review:** runs on pull request `opened` / `synchronize` /
`ready_for_review` / `reopened`, and under `gitflow-multi-env` **skips pull requests into `main`** (the
promotion diff is huge and has nothing new). **`synchronize` re-reviews on every push**, so cost scales
with push count; keep pull requests tight.
```yaml
on: { pull_request: { types: [opened, synchronize, ready_for_review, reopened] } }
jobs:
  claude-review:
    if: github.event.pull_request.base.ref != 'main'   # skip the develop→main release PR
    permissions: { contents: read, pull-requests: read, issues: read, id-token: write }
    steps:
      - uses: actions/checkout@v4            # fetch-depth: 1
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          plugin_marketplaces: 'https://github.com/anthropics/claude-code.git'
          plugins: 'code-review@claude-code-plugins'
          prompt: '/code-review:code-review ${{ github.repository }}/pull/${{ github.event.pull_request.number }}'
```
