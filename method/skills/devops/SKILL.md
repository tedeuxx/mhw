---
name: "devops"
description: "Operate DevOps for a `<project>` repo — GitHub Actions, Terraform Cloud, branching, the pipeline-only IaC floor, numeric SemVer, the Claude Code GitHub App, and SonarCloud (setup, CI step, gate wiring). Use when wiring a pipeline, granting CI a role, cutting a release, bumping SemVer, or a Sonar gate is red. Not for Terraform config (see cloud-infrastructure), state machine (see agents-configuration), the gate list Sonar sits inside (see quality-gates), or the pre-merge pass (see code-review)."
purpose: "hold the pipeline, the state backend, branching and the permission model in one place, so an infrastructure mutation has exactly one route and that route is CI"
---

Operate the DevOps capability for any `<project>` repo — GitHub Actions, Terraform Cloud, branching, and
the permission floor that keeps infrastructure mutation pipeline-only. Pick the repo's loop model first —
everything below (branching, environments, the permission boundary) follows from it.

Context: $ARGUMENTS

Pipelines are **independent per repo** — never trigger one repo's pipeline from another.

## Pick the model first

Determine the repo's loop model (`/agents-configuration`) before configuring protection, writing a deploy
workflow, or writing a single allow/deny entry. **How to tell:** the repo's `CLAUDE.md` states it.
Otherwise, count environments — more than one → `gitflow-multi-env`; one (or none, for a consumed
artifact) → `trunk-single-env`.

## Branching and environments — the two models

### `trunk-single-env` (the active model — `-io` and the skills plugin)
```
main ←── feature/*
```
- **feature/*** (and `fix/*`, `docs/*`, `chore/*`): cut from `main`; PR → `main` required. Short-lived.
- **main**: the **only** long-lived branch, and the **working** branch. Protected (PR required, 0
  approvals, no force-push/deletion), `enforce_admins=false` for the owner and the version-bump actor.
- **No `develop`, no `release/*`, no `hotfix/*`.** A hotfix is just another short-lived branch off `main`.
- **All required checks sit on the PR to `main`**: lint + typecheck + coverage + quality gate + security
  + the full regression. There is no downstream tier to defer any of them to.
- **The merge deploys**, so it is the go/no-go. Never configure auto-merge into `main`.
- **Merge strategy: real merge commits, never squash.** Squashing collapses the per-commit
  conventional-commit history the categorized release notes are built from. See
  [[merge-strategy-no-squash]].
- **Two variants of what "ships" means:** a *deployed app* (`-io`) — merge triggers the deploy, patch
  bumps automatically on push; a *marketplace-distributed plugin* (the skills repo) — every merge to
  `main` auto-bumps the patch and publishes a Release, since the marketplace only serves published
  versions — adoption is the consumer's opt-in, so publishing ≠ forcing. Deliberate minor/major via
  `release.yml`.

### `gitflow-multi-env` (backend-ful reference — OFF in a static repo)
```
main ←── release/* ←── develop ←── feature/*
     ←── hotfix/*
```
- **feature/***: from `develop`; PR → `develop`. **develop**: default branch; protected; auto-deploy to
  staging on merge. **main**: protected; production deploy requires GitHub Environment approval +
  reviewer. **hotfix/***: from `main`; merged to both `main` and `develop`.
- Protection on `main` + `develop`: require PR, 0 approvals, `enforce_admins=false` so the owner and the
  `VERSION_BUMP_TOKEN` actor push directly; no force-push/deletion.
- **Environments are decided by git branch**: `develop` → staging, `main` → production. The pipeline
  deploys on merge; the agent never deploys. Locally there is only ever staging — production is
  unreachable by construction, so production credentials are never on the laptop.

**Versioning & tags** — numeric SemVer via bump-my-version, with the `bump:` loop guard. Under
`trunk-single-env`, on every push to `main` (patch); under `gitflow-multi-env`, on every push to
`develop` (patch) and on `main` via a PR `semver:` label. The full rules — scheme, config file,
release notes, the loop guard, the required secret — are their own section below. See
[[versioning-numeric-semver]].

## GitHub Actions — OIDC, secrets, the workflow set

**Pipeline roles & AWS auth (OIDC).** Every pipeline assumes a dedicated AWS role via GitHub OIDC
(`aws-actions/configure-aws-credentials` + `permissions: id-token: write`) — **no `AWS_ACCESS_KEY_ID`
secrets**. A deploy role has two halves: the trust policy (WHO may assume — the repo's **immutable** OIDC
subject `repo:<org>@<org_id>/<repo>@<repo_id>:*` on the pre-existing GitHub OIDC provider, see `/iam`) and
a least-privilege permissions policy (WHAT it may do).

**Active roles for a static site (`-io`):** an **infra runner** (`github-actions-<project>-iac`, broad
provisioning, bootstrapped out-of-band since it provisions everything and can't self-manage) and a **fed
deploy** role (`s3:PutObject`/`DeleteObject`/`ListBucket`; `cloudfront:CreateInvalidation`, created by
Terraform). Under `gitflow-multi-env`, roles are per-env (`github-actions-{iac,bff,fed}-<env>`) so a
leaked staging token can't assume the prod role.

**Runner-policy gotcha — role deletion:** the runner must be able to delete every resource it creates,
including IAM roles. AWS calls `iam:ListInstanceProfilesForRole` before `iam:DeleteRole` — grant that
(+ `iam:ListRoleTags`) from the start, or a `terraform destroy` of any role fails `AccessDenied`
mid-apply, orphaning the role.

**Secrets — one standard, never decided per repo.** Two axes: SCOPE (does the value change per
environment?) and NAME. **Environment secret** = every AWS OIDC role ARN. **Repository secret** = the
same value for every environment, reserved for account/org-wide tooling tokens (`TFC_API_TOKEN`,
`SONAR_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `VERSION_BUMP_TOKEN`). Naming: `AWS_<LAYER>_OIDC_ROLE_ARN`
(`LAYER` ∈ `INFRA`/`FED`/`BFF`) — no legacy `AWS_ROLE_ARN`, no generic `AWS_OIDC_ROLE_ARN`. See
[[secrets-scope-naming-standard]]. Audit with `gh secret list -R <repo>` and `--env <name>`.

**Workflow set (per repo):** the build/test gate (`build-test.yml` on PR — lint, typecheck, coverage
≥85%, E2E, SonarCloud, path-filtered) and the infra gate (`infra-plan.yml` — checkov, `fmt`/`validate`,
`plan`, path-filtered to `iac/`); deploy workflows (`deploy.yml`, `infra-apply.yml` on merge to `main`);
`version-main.yml` (numeric SemVer bump); `claude.yml`/`claude-code-review.yml` (the Claude Code GitHub
App, below).
`concurrency` groups to avoid overlapping deploys; SHA-pin third-party actions; `npm ci --ignore-scripts`;
least-privilege `permissions:` per job.

### The Claude Code GitHub App — `claude.yml` + `claude-code-review.yml`

AI-assisted development is a **standing preference**: every repo runs the Claude Code GitHub App for an
on-demand assistant **and** an automatic PR review — a quality signal alongside (not replacing)
SonarCloud + the coverage gates. Two workflows, identical across all repos, both advisory and
non-blocking by design; both use `anthropics/claude-code-action@v1` with the `CLAUDE_CODE_OAUTH_TOKEN`
secret.

**`claude.yml` — on-demand assistant (`@claude`).** Triggers when `@claude` appears in an issue
(opened/assigned), an issue comment, a PR review, or a PR review comment:
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

**`claude-code-review.yml` — automatic PR review.** Runs on PR `opened` / `synchronize` /
`ready_for_review` / `reopened` — but **skips PRs into `main`** under `gitflow-multi-env` (the
`develop→main` release/promotion diff is huge and has nothing new to review); under `trunk-single-env`
there is no promotion PR to skip. **Cost scales with diff size, and `synchronize` re-reviews on _every_
push** to the PR branch (so a long-lived PR that keeps getting commits — e.g. version bumps — re-triggers
a full review each time). Keep PRs tight; gate big/release PRs out.
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

**Setup (one-time, per repo):** install the **Claude GitHub App** (via `/install-github-app`, a runbook
step, not Terraform) and create `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) as a repo secret —
same secrets standard as above.

**Pros/cons, specific to this automation:** on-demand `@claude` assistant plus a review on every
revision, advisory so it never gates a merge on a non-deterministic reviewer — traded against review
cost/noise scaling with push count, and single attribution tied to the owner's own auth rather than a
service principal.

**Required check + trigger `paths:` filter gotcha.** If a *required* status check is gated by a
trigger-level `on.pull_request.paths:` filter, a PR touching none of those paths (a docs-only PR) never
starts the workflow, so branch protection leaves it permanently `BLOCKED`. **Fix:** drop `paths:` from
the `pull_request` trigger so the job always runs and reports, then gate the heavy *steps* inside it with
a `dorny/paths-filter@v3` step + `if:`. Keep the `push` trigger's `paths:` (SonarCloud baseline only on
real changes).

### SonarCloud — the quality-gate mechanics

Folded in here (#259) because it is the same object as everything else in this section: a CI step
wired into the workflow set above, not a separate capability. SonarCloud runs on every PR and on push
to develop/main as a **Quality Gate** — static analysis (bugs, code smells, **vulnerabilities/SAST**,
security hotspots), coverage, and duplication. A failing gate **blocks the merge/deploy**. Analysis is
**CI-based**, not Automatic: SonarCloud **Automatic Analysis must be OFF** per project or the scanner is
rejected. For the full gate list this sits inside (lint, typecheck, coverage thresholds, contract/E2E,
dependency + secret scanning), see `quality-gates` — this section is the Sonar mechanics only.

**Setup (per repo):**
- `sonar-project.properties`: `sonar.projectKey`, `sonar.organization`, `sonar.sources` (+
  `sonar.tests`/`sonar.coverage.exclusions` for code repos).
- Secret **`SONAR_TOKEN`** — **per repo under a personal GitHub account**, since organization-level
  secrets do not exist there; under an org, define it once at org level and grant it to the repos that
  need it. *The cost of the personal-account shape is rotation:* one token change is N repo edits, so
  keep a list of the repos that hold it, or the next rotation silently leaves one red.
- Coverage import (code repos): `sonar.javascript.lcov.reportPaths=coverage/lcov.info` (from vitest;
  covers TS/TSX too). IaC repos have no coverage.

**CI step (after tests, in the build/test workflow above).** The legacy `sonarcloud-github-action` is
**deprecated/archived** — use the unified scan action. One step both scans and gates via
`qualitygate.wait` (no separate quality-gate action):
```yaml
- uses: SonarSource/sonarqube-scan-action@v7
  env:
    SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
    SONAR_HOST_URL: https://sonarcloud.io   # SonarCloud host
  with:
    args: -Dsonar.qualitygate.wait=true     # poll + FAIL the job on a red gate
```
Checkout needs `fetch-depth: 0` (full history → accurate new-code/blame attribution).

**Conventions:**
- **Where it lives:** code repos (api/fed) run Sonar **inside the build/test workflow** after
  lint/typecheck/tests — it consumes the test step's `coverage/lcov.info`. The iac repo runs Sonar in a
  **standalone `sonar.yml`** (no coverage to consume, and it must not trigger the AWS plan on push).
- **iac:** SonarCloud **IaC analysis** scans the Terraform (smells, security hotspots) **in addition to**
  `checkov` (policy/security gate in the infra-plan workflow) — the two are complementary
  (`cloud-infrastructure`'s Terraform section).
- **Quality gate definition:** the built-in **"Sonar way"** gate (Default) on **new code**
  (clean-as-you-code), incl. **Coverage on New Code ≥ 80%**. `qualitygate.wait=true` fails the *job*; to
  actually **block merge**, also make the workflow check (`ci` for api/fed, `sonar` for iac) a
  **required status check** in branch protection.
- Vitest still enforces the local **≥85%** (whole-codebase) as a fast pre-check; Sonar owns the
  authoritative gate on **new code** (≥80%) — two different scopes, not a contradiction.
- `SONAR_TOKEN` is a per-repo GitHub secret — same secrets standard as the rest of this skill.
- **This skills repo is not a Sonar project** — markdown command guides have nothing to analyze.

**Pros/cons, specific to this automation:** SAST + coverage + smells in one quality gate that blocks
merge, free for public repos, trend tracking — traded against false positives to triage, another
account/gate to manage, and thresholds that need tuning.

## Versioning & tags — numeric SemVer via bump-my-version

The single source of truth for **versioning and git tags** across the repos, folded in here (#258)
because the trigger workflows it describes (`version-main.yml`, `version-develop.yml`, `release.yml`)
are pipeline wiring — the same object as everything else in this skill. The numeric-SemVer **scheme**
is identical everywhere; the **trigger model differs by repo role** — every repo whose `main` produces
something consumable auto-bumps on merge (`version-main.yml`, or `version-develop.yml` under GitFlow),
and a deliberate minor/major is cut on demand via `release.yml`.

**A consumed artifact is not one thing — split by how it's consumed:**
- **Marketplace-distributed plugin** (`<project>-skills`) — **auto-bumps the PATCH on every merge to
  `main`** (`version-main.yml`) and publishes a Release, because the marketplace only serves
  *published* versions and an unreleased `main` is invisible to the installed plugin. **Publishing ≠
  forcing adoption:** each consumer opts in via `/plugin update`, so publishing on every merge has no
  downside and removes the "merged but never shipped" failure mode. Deliberate minor/major via
  `release.yml`. (Methodology ADR-0005.)
- **Semver-pinned library** (an npm dependency a consumer locks) — releases **deliberately**, because
  its tag *is* a consumer lockfile and every tag invites a version resolution. Here `release.yml`
  (`workflow_dispatch`) is the trigger and pushes do not auto-bump.

A **deployed** repo — a site or service whose merge to `main` *is* the deploy — is a **deploy-model**
repo: `main` auto-bumps the patch on merge (`version-main.yml`), because the version's job there is to
name what is live, and something went live either way. The test is not what the repo contains but
**who acts on the number**: a consumer resolving a dependency (deliberate release) or an operator
identifying a running build (auto-bump).

### Scheme — purely numeric SemVer
`MAJOR.MINOR.PATCH` only — **no `-dev` / pre-release suffix** (explicitly rejected). `VERSION` starts
at `0.1.0`. Tags are `vX.Y.Z`.

### `.bumpversion.toml` (same in every repo)
```toml
[tool.bumpversion]
current_version = "0.1.0"
parse           = "(?P<major>\\d+)\\.(?P<minor>\\d+)\\.(?P<patch>\\d+)"
serialize       = ["{major}.{minor}.{patch}"]     # numeric only — no pre-release part
tag             = true
tag_name        = "v{new_version}"
commit          = true
message         = "bump: {current_version} → {new_version}"   # MUST match the loop guard
tag_message     = "bump: {current_version} → {new_version}"
allow_dirty     = false

[[tool.bumpversion.files]]
filename = "VERSION"
```
> Add a `[[tool.bumpversion.files]]` entry per file that **also** carries the version (e.g.
> `package.json`, `openapi.json`, or — in the skills repo — `.claude-plugin/plugin.json`) so they bump
> in lockstep with `VERSION`.

### When each part bumps
- **push to `develop`** → `version-develop.yml` runs `bump-my-version bump patch` →
  `0.1.0 → 0.1.1 → …` → commit + tag `vX.Y.Z`.
- **push to `main`** → `version-main.yml` reads the merged PR's `semver:` label and bumps **that**
  part (resetting lower parts), then tags **and** creates a GitHub Release:
  - `semver:major` → major · `semver:minor` → minor (**default**) · `semver:patch` → patch.
- PR labels `semver:major | semver:minor | semver:patch` are required before merge to `main` (label set
  owned by the Issues backlog, this skill's own "Issues & backlog" section).

### Release notes (the GitHub Release)
`version-main` publishes a **GitHub Release** for the tag with notes **auto-categorized from the
conventional-commit subjects** in the commit range since the **previous release** — `feat`→Features,
`fix`→Fixes, `docs`→Documentation, `refactor`→Refactoring, `ci|chore|build|test`→CI & chores, plus a
"Full changelog" compare link. Two reasons it uses the *previous release* (via `gh release list`) and
not the previous **tag**: (a) `develop` auto-tags **every** commit (`v0.1.x`), so a tag-to-tag range
between releases is ~empty; only `main` publishes Releases. (b) GitFlow ships **one** release PR, so
notes come from the **commit log**, not the single PR. Net: **commit messages _are_ the changelog** —
write `type: subject` (conventional commits). (`--generate-notes` alone would show only the lone
release PR.)

### Loop guard (critical)
Bump commits use message `bump: {current} → {new}`; **both workflows skip any commit whose message
starts with `bump:`**. The workflows push with the `VERSION_BUMP_TOKEN` PAT (which retriggers CI), so
this message MUST stay aligned with the guard via `message`/`tag_message` above — otherwise CI loops
infinitely.

### Required secret
`VERSION_BUMP_TOKEN` — a GitHub fine-grained PAT with `contents: write` + `workflows: write` (lets the
bump commit/tag push and bypass PR protection as an admin actor) — same secrets standard as the rest of
this skill.

### Conventions
- Same scheme/threshold in all repos — never a per-repo variant.
- The version is the contract stamp: the API's OpenAPI `info.version` == the `VERSION` file of the
  repo that ships it (`/backend`'s OpenAPI section) — generated from it at build time, never typed
  twice, so a published contract can always be traced back to the exact tag that produced it.

### Post-release: back-merge `main → develop`
After a release to `main`, the version-bump commit + tag live only on `main`, so `develop`'s `VERSION`
lags. **Back-merge `main` into `develop`** so the lineage reconciles and the next dev work continues
from the released version (e.g. `0.2.0` → next `develop` push → `0.2.1`):
```bash
git checkout develop && git merge --no-ff origin/main -m "chore: back-merge main into develop" && git push
```
Skipping it leaves `develop` on an older minor (e.g. `0.1.x`) while `main` is `0.2.x` — harmless for
consumers (they pin `main` tags) but confusing. Do it **once per release**.

**Pros/cons, specific to versioning:** automated, consistent numeric tags across all repos, loop-guarded,
PR-label-driven on main — traded against no pre-release channel (numeric-only, a deliberate rejection of
`-dev`) and the standing requirement of the `VERSION_BUMP_TOKEN` PAT.

## Terraform Cloud — the state backend

TFC is the **remote state backend only**, not the execution engine. Org, one workspace per environment
(`<project>-iac-staging`, `<project>-iac-production`), **execution mode: Local** — TFC stores + locks
state, GitHub Actions runs `plan`/`apply` (`TF_WORKSPACE=<project>-iac-staging terraform init`), auth via
the `TFC_API_TOKEN` secret. **The workspace name is load-bearing** — a rename desyncs state and `plan`
proposes recreating everything.

No local state, no S3/DynamoDB backend — TFC is the single state store. Workspaces are created once as a
bootstrap step, not by Terraform. Non-secret inputs via `-var-file`; AWS access via OIDC at apply time.

## Execution policy — pipeline only, both models

**Every state mutation goes through the pipeline. A human/agent NEVER runs `terraform apply` or
`terraform destroy` from a laptop.** `plan` on PR, `apply` on merge. Local is read-only at most (`fmt`,
`validate`, an inspection `plan`). **Destroying live infra = code + merge** — remove the resource from
config and merge; a full teardown uses a dedicated, reviewed `destroy` workflow
(`workflow_dispatch`), never a laptop.

**Infra-first ordering:** a capability needing new infrastructure ships its IaC slice first (PR →
pipeline applies); only then can the app slice be developed and validated against it — a real dependency
edge in the loop.

## The permission model — the tolerance test and the two layers

**Anything tracked and reversible via git is tolerable.** The danger is never "low environment" — it is
irreversibility that escapes git: cloud/infra state, remote refs on protected branches, secrets, live
traffic. Effect contained in the git-tracked tree → allow freely; effect that escapes git → gate. This
test is model-independent; what changes between models is only *which command* crosses the line.

**`gitflow-multi-env` zones:**

| Zone | Contents |
|---|---|
| **Allow** | Edit/Write · git on feature branches · `gh pr` create/view/diff/checks + merge to `develop` · issue ops · npm/npx · test runners · node/tsx/python3 · `terraform fmt/validate/plan` · `aws` read-only · curl local |
| **Ask** | `gh pr merge --base main` (promotion) · the release action |
| **Deny** | push/merge to `main` · `terraform apply`/`destroy` · direct `aws` mutations · `git reset --hard` · `rm -rf` · **force-push** · **all** secret writes · `gh repo delete`/`archive`/`rename` · anything targeting production · `--dangerously-skip-permissions` |

**`trunk-single-env` zones:**

| Zone | Contents |
|---|---|
| **Allow** | Edit/Write · git on feature branches (incl. push) · `gh pr` create/view/diff/checks · issue ops · npm/npx · test runners · node/tsx/python3 · `terraform fmt/validate/plan` · `aws` read-only · curl local |
| **Ask** | the release action |
| **Deny** | direct `git push` to `main` · `terraform apply`/`destroy` · direct `aws` mutations · `git reset --hard` · `rm -rf` · **force-push** · **all** secret writes · `gh repo delete`/`archive`/`rename` · `--dangerously-skip-permissions` |

**~~The Ask row's last three moved there from Deny at #383 S3~~ — they moved BACK the same day, and
the round trip is the most transferable thing in this section.** The test that moved them out is
correct and is worth carrying into any project that copies these tables: not *does the effect escape
git*, but *can the prior state be restored*. A force-push leaves the old tip in the reflog and in the
remote's unreachable objects; an AWS secret write sits behind a version stage, a 30-day recovery
window or SSM parameter history; `gh repo archive`/`rename` both undo. Their neighbours genuinely do
not restore — `git reset --hard` (uncommitted work has no other copy), `gh secret set` (Actions
secrets have no version history) and `gh repo delete` (the repository id is never reissued, so every
OIDC trust pinned to it breaks permanently). **Note the two secret rows are split on the provider, not
on the word** — that pair is the clearest illustration of the test.

**What sent them back to Deny is not the test but the LADDER.** `deny → ask → context → nothing`
assumes the middle rungs reach a human. Measured on this harness, in the owner's own interactive
session under **auto mode**: the guard returned `ask` for the exact force-push command and **the act
executed with no prompt**. An earlier measurement showing an unanswerable `ask` fails CLOSED was
taken in a **headless** session and in a **dispatched subagent** — both correct, neither the context
that decides.

**So the rule for any project copying this table: before you downgrade an act from Deny to Ask,
measure what an Ask does in the mode your humans actually run.** Two contexts can give opposite
answers, and the safe-looking one is the easy one to measure. Where the middle rung is not honoured,
a reparable-but-serious act has only Deny or nothing — and the honest response is to keep the Deny
and say why, rather than ship an Ask that reads like a control and behaves like an allow.

**A caveat specific to these rows, from the token-boundary section below:** a settings entry is a
**token-bounded prefix**, so it matches an entry plus any trailing tokens but cannot express *"this flag
anywhere in the command"*. `git push --force` and `git push origin main --force` are both denied by
settings — the second because `git push origin main` is a deny entry and `--force` is just a trailing
token. What no entry reaches is `git -C <dir> push --force`, whose prefix (`git -C`) is itself
allowlisted. The hook is what covers that one, as an `ask`. **A project copying this table gets the
static spellings and not that one.**

~~`git push origin main --force` … [is] not [denied by settings]~~ — **struck: measured false
2026-09-05.** Kept visible because it was the example a reader would have checked first, and it argued
for a hole that is not there.

**A force-push to the TRUNK and to any other ref are both Deny, and two different rules answer them.**
The guard runs the trunk rule first deliberately, so a trunk force-push gets the trunk message
(*branch and open a PR*) rather than the force-push one. While the two rules returned different
verdicts that ordering was a floor decision; now that both deny, it decides only which remedy the
caller is told to use — smaller, still worth pinning, and pinned by asserting the REASON rather than
the verdict. **The general point for a copied table: when two overlapping rules converge on one
verdict, a verdict-only test can no longer tell which rule answered, and a reordering becomes
invisible.**

**`gh pr merge` is deliberately NOT in the Ask row (#62).** It used to sit there as *"this is the deploy,
so it is the go/no-go"* — true about the merge, wrong about the mechanism, and it contradicted
`quality-assurance`, which merges the safe class by its own definition. The reason it cannot be a
permission rule is structural: whether a merge needs the human depends on the **class** of the change,
and a permission matcher reads a command string — `gh pr merge 331 --merge` looks identical whether the
diff is a typo fix or a Terraform change. So **the classification is the gate, and `quality-assurance`
holds it**: it merges the safe class once both lenses are green, ~~never the boundary class~~ **and, since
2026-08-23 (ADR-0002 amendment #16), the boundary class too under a distinct verdict literal — holding only
four named exceptions, of which `iac/` is one, so nothing in this skill's pipeline-only rule is loosened by
it**. This is a
persona-level guarantee, not a mechanical one — accepted deliberately, which is why the irreversible
floor stays in Deny rather than moving to this layer.

**Do not carry `gitflow-multi-env` zones into `trunk-single-env`**: don't pre-authorize merges to
`develop` (the branch doesn't exist); don't deny working on `main` (it's the working branch); don't add
`*prd*` deny patterns for environments the repo doesn't have.

**Two layers.** Global (`~/.claude/settings.json`): the universal floor — deny the always-forbidden and
register the guard hook, protecting every repo even with no local config. Per-project (committed
`.claude/settings.json`): the inner-loop allow for that repo's stack — a versioned repo contract, never
`settings.local.json`. **Deny from any layer wins**, so the global floor is inescapable and the project
layer only adds autonomy. **Never `--dangerously-skip-permissions`.**

**The two layers are NOT peers, and which one answers first decides what a removal costs.** The
`PreToolUse` hook decides **before** the permission system: a hook `deny` is final and the static
lists are never consulted, while a hook that abstains hands the command on to allow/deny/prompt.
Measured 2026-09-05 with a payload both layers match — the hook's text came back, not the permission
system's. **Two consequences worth carrying into any decision to delete a hook rule.** First, removing
a rule whose act sits in `allow` is a **real** removal with silent execution, not a downgrade to a
prompt — that is the difference between *nothing changes but the message* and *nothing stops it at
all*. Second, a hook rule can only ever be **stricter** than the layer beneath it, never more
permissive, so every case where it fires and the permission system would not is an **over-block with
no control behind it**. For a rule whose object is friction rather than irreversibility, that is the
governing test: fire on a subset of what the runtime stops for, never on more.

**The permission matcher is ELEMENT-WISE across a composition**, which is the fact that test was
derived from. Measured against build 2.1.261: `a && b` with both elements allowlisted **executes with
no prompt**; the same chain with one element denied is **refused whole**; with one element merely
unlisted, the runtime stops and **names that element**. A chain is not a blind spot. What does stop
for a human is `$(...)`/backticks (flagged by name), a `VAR=x cmd` prefix (it defeats the allow entry),
and a redirect that **creates a file** — and that last check is destination-aware, so `2>/dev/null`
passes and `2>somefile` does not. `/shell` carries the payload table.

**The env-var prefix was also stopped in the tested post-statement position, while a rule
built against it here was anchored to the leading one for months (#438).** Re-measured on build
2.1.267 rather than carried from 2.1.261: `true; FOO=1 wc -l <f>` comes back *"This Bash command
contains multiple operations. The following part requires approval: FOO=1 wc -l <f>"*, while `true;
touch <f>` executes — so the decomposition names that prefixed element, and the
leading statement alone is harmless. **No case was found where an env-var prefix let a command
through**: it defeated an allow entry, the working-directory sandbox, and the sandbox's auto-approval
of an unlisted command alike (`cp <in-cwd> <in-cwd>` executed; `FOO=1 cp`, same paths, blocked).
**That supports widening to the measured forms, not a universal subset claim.** Rule 8 retains its
original leading check. Its extension first recognizes the entire original string as a simple
composition: plain ASCII words, blanks, simple subshells and separators. It abstains on strings with
quotes, escapes, comments, newlines, redirections, expansions, globs, arrays or arithmetic. Thus both
`echo ok #;BAR=1` and a real prefix in `echo "ok"; BAR=2 cmd` abstain in the extension; the runtime
decides. The simple tested prefixes still deny, and the other rules remain independent. These are
guard-suite results; they do not measure Claude's effective permissions for either quoted or unquoted
heredocs. The governing subset constraint remains an obligation.

### An entry's `:*` is a TOKEN boundary, not a raw prefix — and it is why some rules cannot live here

**The single most portable fact about this layer, and it decides which controls a settings file can
carry at all.** `Bash(<prefix>:*)` matches only where `<prefix>` ends at a token break. Measured
2026-09-05 with a probe settings file loaded via `--settings`, verdict read off disk:

```
deny  Bash(mkdir <P>/BOUND:*)   vs   mkdir <P>/BOUND    -> DENIED   (control)
                                     mkdir <P>/BOUNDX   -> CREATED  <- the finding
                                     mkdir <P>/OTHER    -> CREATED  (control)
```

**Three consequences, and the third is the one that sends rules into a hook.**

1. **Sibling flags must each be listed.** `Bash(git push --force:*)` does **not** cover
   `--force-with-lease`, which is why both appear in these deny lists. The same is true of every
   `rm -rf` spelling — the flags are a **set**, not a token, so `rm -fR`, `rm -r -f` and `rm -f -r`
   are the same act and each needs its own entry.
2. **An allow entry does not weaken one deny; it weakens all of them together.** `gh -R <repo> <sub>`
   and `git -C <dir> <sub>` both carry the prefix past *every* per-subcommand deny beneath them. Put
   the flag **after** the subcommand (`gh <sub> --repo o/r`) and the per-subcommand entry matches
   again — which is the whole reason this skill prescribes that flag position.
3. **A settings file cannot express "this flag ANYWHERE in the command."** `git push origin main
   --force` is a prefix of nothing in the list. A control of that shape has to be a hook, and that is
   a structural limit of this layer rather than a gap in the list.

### The two layers are not peers — which one answers, and in what order

Measured on build 2.1.261, all four read off disk in a probe plugin loaded with `claude --plugin-dir`:

| situation | who answers |
|---|---|
| hook returns `deny` | **the hook** — final, and its reason is what the caller sees |
| hook returns `ask`, no settings entry matches | **the hook** — refused in headless, with its reason |
| hook returns `ask`, a settings `deny` also matches | **the permission layer** — a static `deny` beats a hook `ask` |
| hook abstains | the permission layer: allow / deny / prompt as listed |

**An unanswerable `ask` fails CLOSED.** In a headless session and in a dispatched subagent alike — the
case with no prompt surface at all — the act is refused and the hook's reason is surfaced. ~~So
`deny -> ask` is a real loosening only where a human is present to answer, and never a silent hole.~~

**STRUCK, AND THE STRIKE IS THE MOST USEFUL LINE IN THIS SECTION.** ~~Not measured: the interactive
main session.~~ It was measured, and the answer was the opposite of the safe one the omission implied:
**under auto mode the `ask` is answered automatically and the act EXECUTES with no prompt.** So the
row above is complete only for the two contexts it names, and there is a **third**:

| context | what an unanswerable / unattended `ask` does |
|---|---|
| headless main session (`-p`) | **refused**, hook's reason surfaced |
| dispatched subagent | **refused**, hook's reason surfaced |
| **interactive main session, AUTO mode** | **EXECUTED, no prompt** |

**Three consequences for anyone designing a control on any harness.** First, `deny -> ask` is a
**silent hole** exactly where the human is closest to the machine, which is the inverse of the
intuition. Second, **an `ask` is not a rung you may assume exists** — whether it reaches a human is a
property of the host's operating mode, not of the hook, and it is a measurement rather than a reading.
Third, **measure the mode your humans actually run before you rely on it**: two contexts here give
opposite answers, and the reassuring one is the cheap one to obtain.

**Enforcement = static deny + the guard hook.** Static allow/deny covers every case where the target is
visible in the command string. The `PreToolUse` guard hook (`hooks/permission-guard.sh`, matcher `Bash`)
is the backstop for the irreversible floor in every repo regardless of model — inspects the command
string only, fails open on a parse error by design. **One rule is excepted, and only one: the merge
floor (rule 7c) fails CLOSED since 2026-08-28** — if it cannot READ the gatekeeper's verdict on the PR
(no `gh`, no network, expired auth, a PR ref resolving to nothing), the merge is denied with a message
naming which precondition was missing, rather than passing silently. The owner's rule for that case is
*no readable verdict, no merge*, and the unblock is his. **Do not read that as the guard's general
posture** — everything else here still fails open, and the criterion for the exception is that this one
rule's degradation lands on the irreversible act itself. ~~**It is deliberately branch-agnostic**: no
`git branch`/`rev-parse` call, no environment-name matching~~ — **STRUCK 2026-09-02 (#383): the
property is false, and the sentence was technically-true-and-misleading, which is the worse shape.**
The literal half held (no `git branch`, no `rev-parse`); the property it asserted did not. The trunk-push
rule **resolves the checked-out branch and denies on it**, using a third command the sentence did not
name:

```
branch="$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null || true)"
case "$branch" in main|master) deny "…HEAD is '$branch', so this push lands on the trunk…" ;; esac
```

`symbolic-ref` rather than `rev-parse` is deliberate in the guard — it reports the branch even on an
unborn HEAD, where `rev-parse` fails and the check would silently skip. **So the hook reads the branch;
what it does not read is an ENVIRONMENT NAME**, and that is the property that actually makes one hook
correct under both loop models. A rule keyed on `staging`/`production` belongs in the repo's own
`settings.json`, never the shared hook. **And the local deny is the only layer refusing that push today, which is a
CONTINGENCY rather than a property.** Branch protection on `main` is configured with
`enforce_admins` disabled, so protection does not apply to administrators — and every agent in this
loop acts through an admin credential, so the forge would accept the push the hook refuses. Read
2026-09-02:

```
gh api repos/<owner>/<repo>/branches/main/protection --jq '.enforce_admins.enabled'   → false
```

**Carry the caveat wherever that fact is repeated:** if `enforce_admins` is ever enabled the forge
starts refusing this actor and the local rule becomes the redundant layer — **and nothing in this
plugin observes that today**. The setting lives at the forge and changes without a commit, and the
command above is denied to every context **inside the loop** by the `Bash(gh api:*)` floor entry, so
the reading is a human's. **Treat it as dated, not as settled — and note the gap is unwatched rather
than unwatchable**: CI is not an in-loop context and that floor entry does not reach it, so a job
that re-reads the setting is buildable, one token-scope decision away. Nothing here forecloses
closing it.

### The forge CLI accepts five spellings of the repo flag, and a space-only regex turns a rule OFF

**A property of `gh` rather than of any guard, and it decides whether a rule keyed on a flag works at
all.** All five are accepted and mean the same thing:

```
-R owner/repo      -R=owner/repo      -Rowner/repo      --repo owner/repo      --repo=owner/repo
```

The same is true of every other `gh` option — `--base owner`, `--base=owner`, `-Bowner` — because
attached values are the CLI's convention and not a quirk of one subcommand.

**The failure mode is the reason this is written down: a rule that misses a spelling does not loosen,
it turns OFF, silently.** Measured in this repository — a guard's trigger matched only the spaced
form, so `gh -R=owner/x pr create` fell through with **no decision, no denial and no trace**, for any
repository rather than only the cross-repo case. It was found by a gate running the **real** `gh`, not
by reading the pattern. Two further consequences worth carrying:

- **An extraction regex must accept the same set as the trigger.** A command that passed the trigger on
  the bare subcommand and then failed extraction produced a guard judging one repository's request
  against **another repository's** queue — internally coherent, entirely wrong, and its denial named a
  real pull request and a real file list, so the author believed it. **A confidently wrong verdict is
  worse than a missed one.**
- **A hook cannot source a variable out of another hook.** Two guards needing the same class carry
  **duplicated literals**, so editing one leaves the other a spelling behind with both suites green.
  Nothing makes them move together; the most that is available is a check asserting they cannot drift
  apart in silence.

*(This lived only in `hooks/scripts/wip-guard.sh`'s header until #383 deleted that file, which is why
it is here: it is a fact about the tool every repo on this platform drives, not about the hook that
happened to record it.)*

## Why this doesn't cost cadence

Strong local validation is the keystone: the agent proves "done" locally without ever needing the denied
boundary, so the deny costs ~zero velocity. Cut local validation and you'd be forced to either loosen the
boundary (risky) or gate everything (slow) — both break cadence.

## Issues & backlog

GitHub Issues per repository — no central backlog repo. Review open issues at session start; on
delivering a plan item, open/close its issue. Product ownership stays with the human. The live label
vocabulary is `product`/`content`/`ready`/`blocked`/`reader-facing` — see `/agents-configuration`. (The
retired `type:`/`priority:`/`phase:` scheme is documented in `github-actions`'s own history if you need
the shape a `semver:`-labeled `gitflow-multi-env` repo still uses.)

## Repo metadata

GitHub repo descriptions follow one format — lead with the platform name, concise, no marketing fluff:
`<apex-domain> — <repo role>: <stack/scope>`. Every repo in a platform leads with the same `<apex-domain>`
deliberately — the description is read in search results and on a profile, detached from other repos, so
the shared prefix is what tells a reader they're one system.

## Language

Everything published on GitHub is in **English** — repo descriptions, READMEs, `docs/`, `CLAUDE.md`,
commit and PR text, Issues. Product UI content language is a separate concern.

## Pros & cons
**Pros**
- One capability for OIDC, secrets/environments, branching, deploys, TFC state, and the permission floor.
- No long-lived AWS keys (OIDC); pipelines independent per repo; managed state with per-env workspaces.
**Cons**
- A large umbrella skill covering many concerns.
- GitHub-platform + TFC lock-in.
