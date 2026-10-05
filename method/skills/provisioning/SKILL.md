---
name: "provisioning"
description: "Provision infrastructure for a `<project>` repo through the pipeline only — remote state and runs, one workspace per environment, plan on the pull request and apply on merge, never from a laptop, and infra-first ordering. Use when adding or changing infrastructure, wiring a plan or apply job, setting up remote state, or tearing something down. Not for the infrastructure code's patterns (see cloud-infrastructure), workflow wiring and pipeline roles (see ci), or branching (see scm)."
purpose: "keep every infrastructure state mutation on one reviewed route, the pipeline, so a destroyed resource never comes from a laptop"
---

> **Written for the selected tool: Terraform Cloud.** This skill describes the provisioning capability
> as the owner runs it today. Everything specific to Terraform and Terraform Cloud sits in one section at
> the end, *Tool section — Terraform Cloud*. To move to another state backend or provisioning tool,
> replace that section only; the rules above it stay as they are.

Provision infrastructure for any `<project>` repo. Pick the loop model first (`/agents-configuration`);
the number of environments, and therefore of state workspaces, follows from it.

Context: $ARGUMENTS

**Split out of the former `devops` skill at #97**, together with `scm`, `ci` and `quality-gates`.

## The pipeline-only floor — both loop models

**Every infrastructure state mutation goes through the pipeline. A human or an agent NEVER applies or
destroys from a laptop.** Plan on the pull request, apply on merge. Locally: read-only at most — format,
validate, an inspection plan.

- **Destroying live infrastructure = code + merge.** Remove the resource from the configuration and
  merge. A full teardown uses a dedicated, reviewed, manually dispatched destroy workflow, never a
  laptop.
- **A reviewed plan on the pull request is the preview.** It is why an `iac/` change is one of the four
  holds on which the gate never merges without the owner (`/quality-gates`): the merge applies, and a
  revert does not recover a destroyed resource.
- **On this workstation the floor is native**: the deny floor (`global/deny-floor.conf`, ADR-0016)
  denies the apply and destroy command prefixes in Claude Code and Codex. A global option placed before
  the subcommand is not caught by a prefix, so the rule is also an instruction.

## Remote state — the state backend

- **Remote state only.** No local state file and no second, hand-rolled backend; one service stores and
  locks state.
- **One workspace per environment** (`<project>-iac-staging`, `<project>-iac-production` under
  `gitflow-multi-env`; one under `trunk-single-env`). Workspaces are created once, as a bootstrap step,
  not by the infrastructure code.
- **The workspace name is load-bearing.** A rename desyncs the state, and the next plan proposes
  recreating everything.
- **The pipeline runs the plan and the apply**; the state service stores and locks. Non-secret inputs
  come from a variable file; cloud access is short-lived federated identity at apply time (`/ci`).

## Infra-first ordering

A capability that needs new infrastructure ships its infrastructure slice first (pull request → the
pipeline applies). Only then can the app slice be developed and validated against it. This is a real
dependency edge in the loop, and sequencing it is part of closing the description.

## The pipeline's own role must be able to undo what it creates

The infrastructure runner must be able to delete every resource it creates, including IAM roles. AWS
calls `iam:ListInstanceProfilesForRole` before `iam:DeleteRole`: grant that (and `iam:ListRoleTags`)
from the start, or a destroy of any role fails `AccessDenied` mid-apply and orphans the role.

## Pros & cons
**Pros:** one route for every mutation; managed, locked state per environment; a reviewed plan is the
preview of an irreversible act.
**Cons:** the state service is a dependency and a lock-in; the workspace name is a load-bearing string
nothing renames safely; nothing local can apply, so an emergency fix still waits on the pipeline.

## Tool section — Terraform Cloud

Everything below is specific to Terraform and Terraform Cloud (TFC). A tool switch replaces this section
only.

- **TFC is the remote state backend only, not the execution engine.** Org, one workspace per
  environment, **execution mode: Local** — TFC stores and locks state; CI runs `terraform plan` and
  `terraform apply` (`TF_WORKSPACE=<project>-iac-staging terraform init`), authenticated by the
  `TFC_API_TOKEN` repository secret.
- No S3/DynamoDB backend: TFC is the single state store. Non-secret inputs with `-var-file`.
- **Local commands allowed:** `terraform fmt`, `terraform validate`, an inspection `terraform plan`.
  **Denied:** `terraform apply` and `terraform destroy` (deny-floor prefixes). `terraform -chdir=iac
  apply` is not matched by the prefix; do not run it.
- **The infrastructure gate** on a pull request: `checkov` (policy scan), `terraform fmt -check`,
  `terraform validate`, `terraform plan` with the plan posted on the pull request. The configuration
  patterns themselves are in `/cloud-infrastructure`.
- **Teardown:** a `workflow_dispatch` destroy workflow, reviewed like any other change. Dispatching it
  is the owner's act: the deny floor forbids `gh workflow run` to agents, because a dispatched workflow
  reaches the pipeline's credentials without the review a merge carries.
