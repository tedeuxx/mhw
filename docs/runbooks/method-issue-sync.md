# Runbook: method backlog sync (mhw → tadeumendonca-skills)

The owner's decision of 2026-10-12 on [#62](https://github.com/tedeuxx/mhw/issues/62): a method demand
opened in mhw is reflected as a twin Issue in `tedeuxx/tadeumendonca-skills`, adapted to the plugin's
format, and the two stay in sync. The weekly -skills sprint drains the twins and releases the plugin
([ADR-0032](../adr/0032-this-repository-is-the-single-source-of-the-working-method.md), 2026-10-12
amendment). The workflow is
[`.github/workflows/method-issue-sync.yml`](../../.github/workflows/method-issue-sync.yml).

**Evidence level:** written and tested (structure and the sync script, against a stub `gh`). **Not run:**
no real run has happened, and none can until the three secrets exist and the workflow is on `main`
(GitHub runs `issues` and `workflow_dispatch` workflows from the default branch).

## What it does

| mhw event, on an Issue labelled `method` | Result |
| --- | --- |
| the `method` label is added | the twin is created, or updated if it exists |
| the Issue is edited (title or body) | the twin is updated |
| the Issue is closed | the twin is closed |
| the Issue is reopened | the twin is reopened |
| Actions → method-issue-sync → Run workflow, with an Issue number | that Issue is synced (only if it carries `method`) |
| the same, with the number empty | backfill: every open `method` Issue is synced, one at a time |

The twin carries the hidden marker `<!-- mhw-issue: tedeuxx/mhw#N -->` and a link back. On first
creation the mhw Issue gets one comment with the twin's URL.

Not mirrored: removing the `method` label, deleting or transferring the mhw Issue, and comments. An
edit made directly on the twin is overwritten by the next sync.

## Already done (2026-10-12)

- The GitHub App `tedeuxx-mhw-mirror` exists, with **Issues: read and write** and **Metadata: read**
  only, installed only on `tadeumendonca-skills` (set by the orchestrator).
- The label exists in mhw. To recreate it:

  ```sh
  gh label create method --repo tedeuxx/mhw --color 1D76DB \
    --description "A method demand: mirrored as an Issue in tadeumendonca-skills (#62)"
  ```

## What is left for the owner

1. **Generate the App's private key.** Open <https://github.com/settings/apps/tedeuxx-mhw-mirror>, note
   the **App ID** shown at the top, and under *Private keys* click *Generate a private key*. The browser
   downloads a `.pem` file.
2. **Store the three secrets** in tedeuxx/mhw. `gh secret set` reads the value from the prompt or from
   standard input, so nothing lands in the shell history:

   ```sh
   gh secret set MHW_MIRROR_APP_ID --repo tedeuxx/mhw            # paste the App ID
   gh secret set MHW_MIRROR_APP_PRIVATE_KEY --repo tedeuxx/mhw < ~/Downloads/<the-file>.pem
   claude setup-token                                            # prints a long-lived token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo tedeuxx/mhw      # paste that token
   ```

   Then delete the `.pem` file. Check the names (values are never shown):

   ```sh
   gh secret list --repo tedeuxx/mhw
   ```

   Until all three exist, every run skips with a notice (*secret(s) not set*) and stays green.
3. **Run the canary**, after the release candidate carrying this workflow is merged to `main`:

   ```sh
   gh issue create --repo tedeuxx/mhw --title "Canary: method backlog sync" \
     --body "Canary for #62. Change one line in the README of the skills plugin. Acceptance: the twin appears."
   gh issue edit <N> --repo tedeuxx/mhw --add-label method
   gh run list --repo tedeuxx/mhw --workflow method-issue-sync.yml --limit 1
   ```

   Expected: the run is green; a twin titled `[mhw#<N>] Canary: method backlog sync` appears in
   tadeumendonca-skills; the mhw Issue gets one comment linking it.

   ```sh
   gh issue list --repo tedeuxx/tadeumendonca-skills --search "mhw#<N> in:title" --state all
   gh issue close <N> --repo tedeuxx/mhw
   ```

   Expected: a second run closes the twin. The canary passes when both happened; the closed pair can
   stay as the record.

## Cost

Each sync run is one Claude Code session (at most 30 turns) on the owner's Claude subscription, through
`CLAUDE_CODE_OAUTH_TOKEN`, and counts against its usage limits. Every edit of a labelled Issue starts a
run, so a burst of edits is a burst of runs (one at a time per Issue; a newer queued run replaces an
older queued one). A backfill runs one session per open `method` Issue. The back-link job uses no model.

## Revoke

Any one of these stops it; the first is the quickest and is undone with `gh workflow enable`:

```sh
gh workflow disable method-issue-sync.yml --repo tedeuxx/mhw
gh secret delete CLAUDE_CODE_OAUTH_TOKEN --repo tedeuxx/mhw
gh secret delete MHW_MIRROR_APP_PRIVATE_KEY --repo tedeuxx/mhw
gh secret delete MHW_MIRROR_APP_ID --repo tedeuxx/mhw
```

To revoke the credentials themselves: delete the private key (or uninstall the App from
tadeumendonca-skills) on <https://github.com/settings/apps/tedeuxx-mhw-mirror>, and revoke the
long-lived Claude Code token in the claude.ai account settings where such tokens are listed (that page
was not checked for this runbook).

## Safety, and its limits

- The mhw Issue's text is treated as data, not instructions; the prompt says so, because whoever can
  edit the Issue controls that text. That is an instruction to a model, not a guarantee.
- The agent has one shell route, `.github/scripts/method_issue_sync.py`, and no file-reading tools. The
  script writes only to the twin (found by the marker), refuses a body file outside the run's scratch
  directory, refuses a body or title shaped like a credential, and mirrors state only in the direction
  the mhw Issue is in. The credential patterns are a short list, not a scanner.
- After the agent, a `verify` step (no model) fails the run unless the twin exists and its state is
  the mhw Issue's. It does not check the twin's text.
- Personal data and client or employer names are kept out of the twin by the prompt only. The
  `outbound-scan` check does not run on Issues.
- The mhw token in the agent's job is read-only; the token that comments on mhw is in a separate job
  with no agent.
