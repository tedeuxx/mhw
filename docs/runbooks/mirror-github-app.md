# Runbook: the GitHub App that mirrors the method into `tadeumendonca-skills`

After every release, the `mirror` job in `.github/workflows/version-main.yml` packages `method/` as the
Claude Code plugin and pushes it to `tedeuxx/tadeumendonca-skills`
([#62](https://github.com/tedeuxx/mhw/issues/62),
[ADR-0032](../adr/0032-this-repository-is-the-single-source-of-the-working-method.md), 2026-10-12
amendment). Its credential is a GitHub App installed on that one repository: the owner's decision of
2026-10-11 on #62, which rejected a fine-grained PAT.

Until the two secrets below exist, the job prints a notice (`plugin mirror skipped`) and does nothing.
The release itself never depends on it.

These steps are the owner's. The agent names the secrets; it never sees the private key.

## 1. Create the App

GitHub, **Settings → Developer settings → GitHub Apps → New GitHub App**:

- **Name:** any free name, for example `tedeuxx-mhw-mirror`. Commits appear as `<name>[bot]`.
- **Homepage URL:** `https://github.com/tedeuxx/mhw`.
- **Webhook:** untick **Active**. The App receives no events.
- **Repository permissions:** **Contents: Read and write**. **Metadata: Read-only** (GitHub sets it).
  Nothing else.
- **Account permissions:** none.
- **Where can this GitHub App be installed?** **Only on this account.**

Create it, and note the **App ID** on its page.

## 2. Install it on one repository

On the App's page, **Install App → tedeuxx → Only select repositories → `tadeumendonca-skills`**.
Not "All repositories".

## 3. Generate a private key

On the App's page, **Private keys → Generate a private key**. The browser downloads a `.pem` file.

## 4. Store the two secrets in `tedeuxx/mhw`

In a terminal, from any directory. You type these; the key goes from the file to GitHub and is never
pasted into an agent session.

```sh
gh secret set MHW_MIRROR_APP_ID --repo tedeuxx/mhw
gh secret set MHW_MIRROR_APP_PRIVATE_KEY --repo tedeuxx/mhw < path/to/the-downloaded-key.pem
```

The first command asks for the value: type the App ID. Then delete the `.pem` file, or keep it in your
password manager. GitHub keeps no copy you can download again; a lost key is replaced by generating a
new one and running the second command again.

Check: `gh secret list --repo tedeuxx/mhw` lists both names (never the values).

## 5. If `main` of `tadeumendonca-skills` is protected

The job pushes straight to that repository's default branch. If a branch protection rule or ruleset
requires a pull request there, add the App to its bypass list; otherwise the push is refused and the job
fails after the release (the release stays published). Whether protection is on was not read: the
agent's `gh api` is denied by the deny floor.

## What the job does with it, and what it does not

- Mints a token with `actions/create-github-app-token` (pinned by commit), scoped to `tadeumendonca-skills`
  and `contents: write`, revoked when the job ends. It is never printed.
- Builds the package from the release tag, runs the package check, then replaces only the generated paths
  (`.claude-plugin/plugin.json`, `agents/<n>.md`, `commands/<n>.md`, `skills/<n>/`, `.mhw-generated`),
  commits as `<name>[bot]` with the tag in the message and `[skip ci]`, and pushes.
- `[skip ci]` keeps that repository's own push workflows, its patch bump among them, off the generated
  commit. Its `VERSION` and `.bumpversion.toml` stay at its last own release and fall out of step with
  `plugin.json`; the cutover ([#63](https://github.com/tedeuxx/mhw/issues/63)) retires them.
- It leaves every other file as it is, and says so in the job log (`LEFT`, `NOTE`): the plugin's
  `hooks/`, `.mcp.json`, `powers/`, `.codex-plugin/`, the commands and skills the method does not carry
  (for example the site-stack skills, [#64](https://github.com/tedeuxx/mhw/issues/64)). Claude Code
  still loads that `hooks/hooks.json` until the cutover removes it.

## Status

*Written and tested* in this repository; **not run**: the App does not exist yet and no real push has
happened. The first run after step 4 is the first evidence.

## Revoke

Uninstall the App from `tadeumendonca-skills` (or delete the App), then
`gh secret delete MHW_MIRROR_APP_PRIVATE_KEY --repo tedeuxx/mhw` and the same for `MHW_MIRROR_APP_ID`.
The next release then skips the mirror with its notice.
