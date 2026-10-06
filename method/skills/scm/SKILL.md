---
name: "scm"
description: "Run source control for a `<project>` repo — repositories, pull requests, merge commits only, the PR-only path to main, the integration branch rc/next, labels, the numeric SemVer release flow, the repository-settings standard, the agent permission floor for forge acts, and the AI assistant app. Use when cutting a branch, opening or merging a PR, labelling, cutting a release, checking repository settings, or deciding whether a forge act may run. Not for workflow wiring (see ci), the quality gate (see quality-gates), infrastructure state (see provisioning), or the state machine (see agents-configuration)."
purpose: "hold the path a change takes into the trunk, so every change reaches main through a reviewed pull request and lands as a real merge commit"
---

> **Written for the selected tool: GitHub.** This skill describes the source-control capability as the
> owner runs it today. Everything specific to GitHub sits in one section at the end, *Tool section —
> GitHub*. To move to another forge, replace that section only; the rules above it stay as they are.

> **Hooks named below are the retired plugin's, not controls you have (#61).** Where this text names a
> plugin hook or guard rule (`permission-guard.sh`, `wip-guard.sh` and the like), it describes that
> plugin; none of those runs in this method. Read any rule they held as an **instruction you follow**.
> What is still mechanical, where the workstation installed it, is the **deny floor** (native deny rules
> by command prefix, ADR-0016) and **each agent's own tool list**.

Run the source-control capability for any `<project>` repo. Pick the repo's loop model first; branching,
the integration branch and the permission boundary all follow from it.

Context: $ARGUMENTS

**This skill and its three siblings were one `devops` skill until #97**, split by capability so each
agent loads only what it needs: `scm` (this file), `ci` (pipelines), `quality-gates` (the gate policy
and its analysis tool) and `provisioning` (infrastructure state and the pipeline-only floor).

## Pick the model first

Determine the repo's loop model (`/agents-configuration`) before configuring protection or writing a
single allow or deny entry. **How to tell:** the repo's `CLAUDE.md` states it. Otherwise, count
environments: more than one → `gitflow-multi-env`; one (or none, for a consumed artifact) →
`trunk-single-env`.

## Branching — the two models

### `trunk-single-env`
```
main ←── feature/*
```
- **feature/*** (and `fix/*`, `docs/*`, `chore/*`): cut from `main`; a pull request to `main` is
  required. Short-lived.
- **main**: the **only** long-lived branch, and the **working** branch. Protected (pull request
  required, no force-push, no deletion).
- **No `develop`, no `release/*`, no `hotfix/*`.** A hotfix is just another short-lived branch.
- **The merge deploys or publishes**, so it is the go/no-go. Never configure auto-merge into `main`.
- **Two variants of what "ships" means:** a *deployed app*, where the merge triggers the deploy and the
  patch bumps on push; a *distributed artifact* (a plugin, a policy set), where every merge publishes a
  release because consumers can only adopt a published version. Publishing is not forcing adoption;
  each consumer opts in.

### `trunk-single-env` with the integration branch `rc/next`
```
main ←── rc/next ←── feature/*
```
The owner's rule (2026-10-05, Issue #60): *"os agentes mergeiam no rc/next, só o RC espera mim"*.
- **A slice** is a pull request into `rc/next`, cut from a fresh `rc/next`. Agents merge it once the
  review gate passes.
- **The release candidate** is the pull request `rc/next` → `main`. It waits for the owner; no agent
  merges it without his explicit go.
- **Nothing else targets `main`.** The repository's own delivery route (`workspace/README.md`, where it
  exists) is the operative wording; this section names the shape.

### `gitflow-multi-env` (reference — off in a single-environment repo)
```
main ←── release/* ←── develop ←── feature/*
     ←── hotfix/*
```
- **feature/***: from `develop`; pull request → `develop`. **develop**: default branch; protected;
  auto-deploys to staging on merge. **main**: protected; production deploy needs an environment
  approval and a reviewer. **hotfix/***: from `main`; merged to both `main` and `develop`.
- **Environments follow the branch**: `develop` → staging, `main` → production. The pipeline deploys on
  merge; the agent never deploys. Production credentials are never on the laptop.

## The path to main — pull request only, merge commit only

- **Work reaches `main` only through a pull request.** No direct push to the trunk, and **no
  force-push** to it or to any shared branch. Branch and open a pull request instead.
- **Merge commits only — never squash, never rebase.** The owner, 2026-10-05: *"nao podemos trabalhar
  com squash"*. Squashing collapses the per-commit conventional history the release notes are built
  from, and a rebase merge rewrites the commits a reviewer verified.
- **Who merges which class** is the gatekeeper's call (`/quality-gates`, `/agents-configuration`); a
  permission rule cannot read the class of a diff, because `merge 331` looks the same for a typo fix and
  an infrastructure change. **The classification is the gate**, held by `quality-assurance`.

## Versioning and the release flow — numeric SemVer

**Scheme:** `MAJOR.MINOR.PATCH` only — **no `-dev` or other pre-release suffix** (explicitly rejected).
`VERSION` starts at `0.1.0`. Tags are `vX.Y.Z`. Same scheme in every repo, never a per-repo variant.

**Who acts on the number decides the trigger.** A consumer resolving a dependency → deliberate release.
An operator identifying a running build, or a consumer adopting a published artifact → every merge to
`main` bumps and tags. The trigger workflows are pipeline wiring and live in `/ci`.

**The cut is declared on the pull request** as exactly one `semver:major|minor|patch` label; the merge
to `main` bumps **that** part (resetting lower parts), tags it and publishes a release. A pull request
without exactly one label fails a check. The default is plain SemVer: **major** for a breaking
change (something a consumer must change), **minor** for an incremental feature, **patch** for a bug
fix. Where a repository records its own cut policy (this workstation's is its ADR-0002, which since
2026-10-06 is that plain rule, with adding or removing a control counted as minor when no consumer has
to change anything), that table decides which label applies. A pull request that bundles several
changes, such as a release candidate, carries the largest part among them.

### `.bumpversion.toml` (same in every repo)
```toml
[tool.bumpversion]
current_version = "0.1.0"
parse           = "(?P<major>\\d+)\\.(?P<minor>\\d+)\\.(?P<patch>\\d+)"
serialize       = ["{major}.{minor}.{patch}"]     # numeric only — no pre-release part
tag             = true
tag_name        = "v{new_version}"
commit          = true
message         = "bump: {current_version} → {new_version}"   # MUST match the loop guard in /ci
tag_message     = "bump: {current_version} → {new_version}"
allow_dirty     = false

[[tool.bumpversion.files]]
filename = "VERSION"
```
Add a `[[tool.bumpversion.files]]` entry per file that **also** carries the version (`package.json`,
an OpenAPI document, a plugin manifest) so they bump in lockstep. The version is the contract stamp: a
published API contract's version equals the `VERSION` of the repo that ships it, generated from it at
build time, never typed twice.

### Release notes
Notes are **categorized from the conventional-commit subjects** since the **previous release** —
`feat`→Features, `fix`→Fixes, `docs`→Documentation, `refactor`→Refactoring,
`ci|chore|build|test`→CI & chores, plus a full-changelog compare link. Use the previous *release*, not
the previous tag: under `gitflow-multi-env`, `develop` tags every commit, so a tag-to-tag range is
nearly empty. **Commit messages are the changelog** — write `type: subject`.

### Post-release back-merge (`gitflow-multi-env` only)
The bump commit and tag land on `main` only, so back-merge `main` into `develop` once per release:
```bash
git checkout develop && git merge --no-ff origin/main -m "chore: back-merge main into develop" && git push
```

## Labels and issues

Issues live in each repository — no central backlog repo. Review open issues at session start; on
delivering a plan item, open or close its issue. Product ownership stays with the human. The live label vocabulary is
`product`/`content`/`loop`/`ready`/`blocked`/`reader-facing` plus the `sp:N` class (see
`/agents-configuration`), and on pull requests the `semver:*` cut label above. A label nothing queries
is decoration; retired schemes (`type:`/`priority:`/`phase:`) stay retired.

**Repository descriptions** follow one format: `<apex-domain> — <repo role>: <stack/scope>`. The shared
prefix tells a reader detached from the other repositories that they are one system.

**Language:** everything published on the forge is in **English** — descriptions, READMEs, `docs/`,
`CLAUDE.md`, commit and pull-request text, Issues.

## The permission floor for forge acts — the tolerance test

**Anything tracked and reversible through version control is tolerable.** The danger is irreversibility
that escapes it: remote refs on protected branches, secrets, cloud state, live traffic. Effect contained
in the tracked tree → allow freely; effect that escapes it → gate. What changes between models is only
*which command* crosses the line.

**`trunk-single-env` zones:**

| Zone | Contents |
|---|---|
| **Allow** | Edit/Write · git on feature branches (incl. push) · pull request create/view/diff/checks · issue ops · npm/npx · test runners · node/tsx/python3 · infrastructure format/validate/plan · cloud read-only · curl local |
| **Ask** | the release action |
| **Deny** | direct push to `main` · infrastructure apply/destroy from a laptop (`/provisioning`) · direct cloud mutations · `git reset --hard` · `rm -rf` · **force-push** · **all** secret writes · repository delete/archive/rename · `--dangerously-skip-permissions` |

**`gitflow-multi-env` zones:** as above, plus merge to `develop` in **Allow**, the promotion merge to
`main` in **Ask**, and anything targeting production in **Deny**. Do not carry these zones into
`trunk-single-env`: `develop` does not exist there and `main` is the working branch.

**Restorable is the finer test, and an Ask needs a human to exist.** A force-push leaves the old tip in
the reflog; a cloud secret write usually sits behind version history. Their neighbours do not restore:
`git reset --hard` (uncommitted work has no other copy), a forge secret write (no history), a repository
delete (its id is never reissued, so every OIDC trust pinned to it breaks). **Measured on the plugin's
harness:** an `ask` in an interactive session under **auto mode** executed the act with no prompt, while
a headless session and a dispatched subagent refused it. So before downgrading an act from Deny to Ask,
measure what an Ask does in the mode your humans run; where it is not honoured, keep the Deny.

**The floor is the workstation's, and it matches prefixes.** On this workstation it is
`global/deny-floor.conf`, rendered as native deny rules into Claude Code and Codex (ADR-0016); Kiro
carries none. No guard hook backs it any more (#61). Two consequences:

- **A plain push to `main` is not denied by any layer here.** The floor denies force-pushes, not a
  fast-forward push, and branch protection does not stop an administrator credential when it exempts
  administrators. **Do not push to the trunk; branch and open a pull request.** That is an instruction.
- **The merge gate is the gatekeeper's own procedure.** No layer reads its verdict before a merge.

### Two layers, and deny wins

1. **The workstation floor** carries the always-forbidden and protects every repo, even one with no
   local configuration.
2. **Per project, a committed settings file** holds that repo's inner-loop allow for its stack. It is a
   versioned repo contract (in Claude Code, `.claude/settings.json`), **never** the untracked
   local-override file (`settings.local.json`), which is never a place where a protection is relaxed.
3. **Deny from any layer wins**, so the floor is inescapable and the project layer only adds autonomy.
4. **A rule keyed on an environment name** (`staging`, `production`) lives in that repo's own settings,
   never in the shared floor. A single-environment repo carries no production-name (`*prd*`) deny
   patterns for environments it does not have.

### A settings entry's `:*` is a TOKEN boundary, not a raw prefix

Measured on Claude Code 2.1.261 with a probe settings file: `deny Bash(mkdir <P>/BOUND:*)` denied
`mkdir <P>/BOUND` and **let `mkdir <P>/BOUNDX` through**. Three consequences:

1. **Sibling flags must each be listed.** `--force` does not cover `--force-with-lease`; `rm -rf`,
   `rm -fR`, `rm -r -f` are the same act and each needs its own entry.
2. **An allow entry can carry a prefix past every deny beneath it.** `git -C <dir> <sub>` and a forge
   CLI's repo flag placed before the subcommand both change the prefix. Put the flag after the
   subcommand and the per-subcommand entry matches again.
3. **A settings file cannot express "this flag anywhere in the command."** `git push origin main --force`
   is caught only because `git push origin main` is itself a deny entry; `git -C <dir> push --force` is
   caught by nothing. That is a structural limit of the layer, stated as a gap.

**The hook layer, where one exists, answers before the settings layer:** a hook `deny` is final; a hook
that abstains hands the command on. A hook rule can only be **stricter** than the layer beneath it, so
it must fire on a subset of what the runtime stops for, never on more.

**The runtime's matcher is element-wise across a composition.** `a && b` with both allowlisted runs
with no prompt; with one denied the whole call is refused; with one unlisted, the runtime names that
element. What still stops for a human is `$(...)`/backticks, a `VAR=x cmd` prefix, and a redirect that
creates a file. `/shell` carries the payload table.

## Why this does not cost cadence

Strong local validation is the keystone: the agent proves "done" locally without ever needing the
denied boundary, so the deny costs almost no velocity. Cut local validation and you must either loosen
the boundary or gate everything; both break cadence.

## Tool section — GitHub

Everything below is specific to GitHub and its CLI, `gh`. A tool switch replaces this section only.

### Branch protection and the trunk
- `main` (and `develop` under `gitflow-multi-env`) is protected: pull request required, 0 approvals, no
  force-push or deletion, `enforce_admins=false` so the owner and the version-bump actor can push the
  bump commit. **That setting is why branch protection does not stop an agent's push**: agents act
  through an administrator credential. Read it with
  `gh api repos/<owner>/<repo>/branches/main/protection --jq '.enforce_admins.enabled'`; the deny floor
  forbids `gh api` write methods, not this read.
- A `gitflow-multi-env` production deploy uses a **GitHub Environment** with a required reviewer.
- Server-side rulesets are an optional template, not applied by default (Issue #97 proposal).

### Merge commits only — the commands and the repository setting
- Merge with `gh pr merge <n> --merge`. The deny floor denies the `gh pr merge --squash` and
  `gh pr merge -s` prefixes only; `gh pr merge 12 --squash` (flag after the number), `--auto --squash`
  and a script are not caught by a prefix.
- **The repository setting is what refuses a squash whatever the spelling.** The standard is
  `global/github-repo-settings.json`: `allow_merge_commit: true`, `allow_squash_merge: false`,
  `allow_rebase_merge: false` (ADR-0016, 2026-10-05 amendment).
  - Check: `global/github-repo-settings.sh --check OWNER/REPO` (read-only; a token without admin rights
    reads none of them and exits 1). `./workstation check` covers it the same way.
  - Apply: `global/github-repo-settings.sh --apply OWNER/REPO` — **the owner's act**, one PATCH of the
    repository, then a check.

### Pull requests, labels and releases with `gh`
- Open a slice with `gh pr create --base rc/next --body-file <file>` (the body always via
  `--body-file`, per `/shell`), and give it exactly one `semver:major|minor|patch` label
  (`gh pr edit <n> --add-label semver:minor`). On a PR into `main`, the `semver-label` workflow fails
  without exactly one.
- The merge to `main` creates a **GitHub Release** for the tag. Its notes come from the commit range
  since the previous release, found with `gh release list` (`--generate-notes` alone would show only
  the lone release PR). `gh release create|edit|delete|upload` are in the deny floor: CI cuts the
  release, an agent does not. A tag push is not in the floor; not pushing tags by hand is an
  instruction.
- Audit secrets with `gh secret list -R <repo>` and `--env <name>`; writing one is denied.

### The repo flag accepts five spellings
`gh` accepts `-R owner/repo`, `-R=owner/repo`, `-Rowner/repo`, `--repo owner/repo` and
`--repo=owner/repo` as the same thing, and the same attached-value convention for every option
(`--base owner`, `--base=owner`, `-Bowner`). **A rule that misses a spelling does not loosen, it turns
OFF silently**: a guard matching only the spaced form let `gh -R=owner/x pr create` through with no
decision. An extraction regex must accept the same set as its trigger. Place the flag **after** the
subcommand (`gh pr view --repo o/r`), never `gh -R o/r pr view`, so the per-subcommand allow entry
matches.

### The Claude Code GitHub App
AI-assisted development is a standing preference: every repo runs the Claude Code GitHub App for an
on-demand `@claude` assistant **and** an automatic PR review — a quality signal alongside, not replacing,
the quality gate. Both are advisory and never gate a merge.
- **Setup, once per repo:** install the app with `/install-github-app` (a runbook step, not
  infrastructure code) and create the repository secret `CLAUDE_CODE_OAUTH_TOKEN` from
  `claude setup-token`.
- **The two workflow files** (`claude.yml`, `claude-code-review.yml`) are pipeline wiring; their
  triggers, permissions and cost are in `/ci`.
- **Trade-off:** single attribution tied to the owner's own auth rather than a service principal, and
  review cost that scales with push count.
