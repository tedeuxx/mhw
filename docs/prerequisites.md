# Prerequisites: tools and subscriptions, checked, never applied

Issue [#89](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/89),
check-only scope (owner decision, 2026-10-05). The declaration is
[`global/prerequisites.json`](../global/prerequisites.json); the checker is
[`global/prerequisites.py`](../global/prerequisites.py), run as the last section of `./mhw check`.

```sh
./mhw check                  # installed targets, then prerequisites
./mhw check --prerequisites  # the prerequisites section only
```

## What the declaration holds

One entry per tool or subscription: name, category (`paid-subscription`, `free-account`, `local-tool`,
`os-feature`), `required` overall, the requirement per workflow lane (`workstation`, `delivery`, `site`,
`content`, `ci`), how presence is detected, how authentication is detected, the preferred settings that
can be checked, and the manual step or documentation link. It is generic: no account, project key,
repository owner or credential value.

## What a line means

| Tag | Meaning | Fails the check |
|---|---|---|
| `OK` | present; authenticated or preferred settings matched where a probe exists | no |
| `MISSING` | not found, and required overall or in a lane the overlay activates | **yes** |
| `ABSENT` | not found, optional | no |
| `NOAUTH` | present, and its read-only probe says not authenticated | no |
| `DRIFT` | present, but below a minimum/preferred version or off the preferred settings | no |
| `NOCHECK` | an account with no local client and nothing verified, or its service unreachable | no |
| `MANUAL` | nothing on the machine can detect it (a subscription, a domain, a browser account) | no |
| `SKIP` | not applicable on this operating system | no |

Every non-`OK` line ends with `->` and the manual step. Exit codes: `0` no required item missing; `1`
at least one; `2` the declaration is invalid (nothing checked). Authentication and drift are reported,
not failed: repairing them is the owner's act, and this command never prompts for a credential.

## The probes, a closed set

The declaration can only choose among probes implemented in `prerequisites.py`; anything else is
refused as an invalid declaration.

- **Tools:** `command -v`, then the one invocation `COMMANDS` in `prerequisites.py` allows for that
  command: its version query (`--version`, or `version` for Terraform), or for `xcode-select` alone its
  path query `-p`. The command name and its arguments are taken from that constant table, never from
  the declaration's strings. The agent harnesses (`claude`, `codex`, `kiro-cli`) are run with
  `--version` only, so no check can send a prompt to a model (`claude -p` is refused as invalid).
- **No side effects from a probe:** every child runs with `TFENV_AUTO_INSTALL=false`,
  `CHECKPOINT_DISABLE=1`, `GH_NO_UPDATE_NOTIFIER=1` and `HOMEBREW_NO_AUTO_UPDATE=1`. A tfenv `terraform`
  shim otherwise downloads and installs a missing version during `terraform version` (measured by the
  agents-lead lens on tfenv 3.0.0). Other version managers (asdf, mise, volta) are not measured.
- **GitHub:** `gh auth status`, which contacts GitHub. Its output names the account, so it is only
  classified, never printed. "Not logged in" reads `NOAUTH`. Any other failure triggers one tokenless
  GET of `https://api.github.com/zen`: unreachable reads `NOCHECK` (`GitHub unreachable`), reachable
  reads `NOAUTH`. When authenticated, `global/github-repo-settings.sh --check OWNER/REPO` (the
  no-squash standard, ADR-0016) for each repository in the overlay, or this checkout's `origin`.
- **SonarCloud:** with `SONAR_TOKEN` in the environment, a GET of `/api/authentication/validate`; with
  project keys in the overlay, a GET of `/api/components/show` per key (with the token if present).
- **HCP Terraform:** with `TFC_API_TOKEN` in the environment, a GET of `/api/v2/account/details`.
- With no token in the environment the line reads `not checked (credential not available)` and no call
  is made. A token is read from the environment only, never printed, never written, and never sent
  after a redirect. A service URL override is honoured only for a plain-HTTP `127.0.0.1` address with
  a port (tests).

## Owner-specific values: the untracked overlay

`overlay/prerequisites.local.json`, gitignored by `*.local.json`:

```json
{"lanes": ["delivery", "site"], "github_repos": ["OWNER/REPO"], "sonar_projects": ["PROJECT_KEY"]}
```

`lanes` makes the items required in those lanes fail the check when missing. Invalid values are
ignored and named in a `PREREQ` line.

## Evidence level

*Written and tested.* The suite `global/prerequisites_test.py` runs `./mhw check
--prerequisites` with fake tool shims on a `PATH` holding nothing else, a throwaway `HOME`, a stub `gh`
that never contacts GitHub, and a loopback HTTP server standing in for SonarCloud and HCP Terraform:
present, missing (required, optional, lane-activated), version drift, unauthenticated, settings drift,
valid and rejected tokens, unreachable service, an offline `gh`, a shim that installs unless the probe
switches are set, and the closed command table. Twenty-two source mutations of `prerequisites.py` and
two of `cmd_check` each turned it red; the restored files stayed green. One read-only run on the reference
machine (2026-10-05): `gh auth status` and the merge-settings `--check` of this repository both passed.
The SonarCloud and HCP Terraform calls have not been run against the real services.

## Not covered

Whether a subscription is active and paid is not observable from a CLI being on `PATH`; the Claude,
ChatGPT and Kiro lines report the client only, and their sign-in is not probed. AWS, the domain, GA4,
LinkedIn, X and YouTube are `MANUAL`. Applying any setting to a real account is out of this scope.
