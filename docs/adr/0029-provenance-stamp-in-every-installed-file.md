# ADR-0029: A provenance stamp (release and commit) in every installed file, checked by `--check`

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Issue:** [#66](https://github.com/tedeuxx/mhw/issues/66)
  (part of [#52](https://github.com/tedeuxx/mhw/issues/52);
  requirements document, section 9a)

## Context and problem

The owner's requirement, on #66 (2026-10-04), verbatim:

> "todo arquivo de elemento de configuracao customizada de harness de qualquer um dos 3 harnesses
> suportados precisa ter dentro dele impresso um sha e o tag de versao semantica de onde aquele arquivo
> é proviniente, gerado automaticamente."

Before this record, every file `install.sh` and `install-managed.sh` rendered carried a `managed-by`
line with `version:` read from `.bumpversion.toml`. That names the version in the file, not the commit,
and it reads the same on every commit between two releases. Two files were not stamped at all: the
Codex `hooks.json` (left without a version for fear that a new value would ask the owner to re-trust the
hook) and the admin Claude Code drop-in (strict JSON, no comment). The user `settings.json` is the owner's
own file, with the repository's entries merged into it. `--check` also deliberately ignored the version,
so a file from an older release with the same content read as OK.

## Decision drivers

- The owner's requirement: commit SHA and SemVer tag in every customised file, written automatically.
- Native first: each format's own comment or metadata field; a custom carrier only where none exists.
- A stamp must never stop a harness from loading the file, and must not cost the owner a hook re-trust.
- Thin: no new tool, no new installed file, no second derivation of the stamp.

## Considered options

1. **A stamp line or key in each file, derived once per run from git (chosen).** Comment where the
   format has one; in JSON, a documented field the harness ignores. *Trade-off:* the owner's
   `settings.json` gains one top-level key of ours, and every commit changes every installed file's
   stamp, so `--check` reports STAMP until the next install.
2. **An installed manifest for JSON (`installed.json`: file, layer, tag, SHA, content hash), as section
   9a first proposed.** *Trade-off:* the JSON file itself still says nothing about its source; a second
   file must be kept in step and can be lost or edited apart from what it describes.
3. **Keep `version:` only.** *Trade-off:* no commit, so a file rendered from `rc/next` or a branch is
   indistinguishable from the release before it. Fails the requirement.

## Decision outcome

Option 1.

**The rule** (written in `install.sh`, the only place it is derived):

| Checkout state | `release:` | `commit:` |
| --- | --- | --- |
| HEAD is exactly a numeric tag `vX.Y.Z`, nothing tracked modified | `vX.Y.Z` | the full SHA |
| Any other commit (`rc/next`, a branch, between releases) | `unreleased, after vX.Y.Z` (nearest tag) | the full SHA |
| No tag reachable (a shallow CI clone) | `unreleased, no tag reachable` | the full SHA |
| A tracked file differs from HEAD | as above, never the bare tag | the full SHA plus `-dirty` |
| Not a git checkout | `unknown, not a git checkout (.bumpversion.toml says X)` | `unknown` |

Only a strictly numeric tag enters a stamp (ADR-0002). `install-managed.sh` reads the stamp back from a
file `install.sh` rendered, so the two installers cannot name two sources.

**Where it is written, per format:**

| File | Format | Carrier |
| --- | --- | --- |
| `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` | Markdown | the `<!-- managed-by … -->` comment |
| `~/.kiro/steering/workstation-global-brief.md` | Markdown with front matter | the same comment, after the front matter |
| hook scripts, `hitl.conf`, `clipboard.conf`, `paste-filter.sh`, `paste_wrapper.py` (user and admin copies) | shell, Python, key=value | a `#` comment on line 1 or 2 |
| `~/.codex/rules/workstation-deny-floor.rules` | Starlark rules | a `#` comment |
| `/etc/codex/requirements.toml` (admin) | TOML | a `#` comment |
| `~/.codex/hooks.json` | JSON | its `description` field |
| `~/.claude/settings.json` (merged) | JSON | top-level key `personal-multi-harness-workstation-configuration` |
| admin Claude Code drop-in `50-…json` | JSON | the same top-level key |

**`--check`** (both installers) prints `SOURCE` with the source's stamp and each file's stamp on its
line. Content is compared without the stamp fields. Matching content under another stamp is `STAMP`
and fails the check (exit 1); install rewrites it (`RESTAMPED`). A content change stays `DRIFT`. This
reverses the earlier rule that an older release's stamp on matching content is OK.

## Consequences

- Good: any installed file names the commit and release it came from; `--check` names the files left
  behind by an older install.
- Good: no new file and no new dependency; git is read only when it is there.
- Bad: every new commit makes every installed file `STAMP` until the owner re-installs. That is the
  requirement working, but it is noise on a busy branch.
- Bad: the owner's `settings.json` carries one key of ours. If Claude Code ever rewrites that file and
  drops unknown keys, `--check` reports `STAMP` (missing) rather than losing anything else. Whether it
  does was **not measured**.
- `install.ps1` (Windows) applies the same rule and carriers: the brief, Kiro steering, Codex rules
  and the settings key. Only the Windows CI jobs (PowerShell 5.1 and 7) verify it, because the
  reference machine has no PowerShell. Its test was not mutation-checked.
- `global/mcp/mcp_render.py` (ADR-0017) stamps the credential launcher and the opening line of its
  Codex `config.toml` block. It also merges entries into the apps' own JSON files (`~/.claude.json`,
  the Claude desktop config, Kiro `mcp.json`). Their stamp is recorded in its manifest
  (`mcp-managed.json`), as section 9a first proposed. Those files belong to the apps, and no field in
  them was measured to be ignored. Its `--check` reports `STAMP` the same way. Its suite asserts that
  its stamp equals `install.sh`'s for the same checkout, so the two derivations cannot drift silently.

## Evidence

Measured 2026-10-05 in throwaway homes and roots under the session scratch directory (`env -i`, `HOME`,
`CLAUDE_CONFIG_DIR`, `CODEX_HOME` pointed there), no login and no model call:

- **Claude Code 2.1.289**, headless (`claude -p … --output-format stream-json --verbose --tools Bash,Read`):
  a probe-only `InstructionsLoaded` hook recorded the stamped `~/.claude/CLAUDE.md` loaded as `User`
  memory at `session_start`. The installed `settings.json`, stamp key included, plus a probe-only `Bash`
  deny, loads: `Bash` leaves the tool list. Calibration: the same file with `permissions.deny` of the
  wrong type leaves `Bash` in place, with no error in the debug log, so Claude Code drops a file it
  rejects silently and the tool list is the observable. The admin drop-in, passed through `--settings`
  (the managed path needs root), loads the same way. The managed path itself was not exercised.
- **Codex 0.160.0**: `codex debug prompt-input` includes the stamped `AGENTS.md`; `codex execpolicy check`
  on the stamped rules file forbids `git push --force`; `codex app-server` `hooks/list` lists the stamped
  `hooks.json` hook with no warning. Changing `description` leaves the hook's `currentHash` unchanged,
  while changing its `timeout` changes it, so a new stamp does not ask the owner to re-trust the hook.
  The admin `requirements.toml` was not loaded from its path (it needs root); its stamped header line,
  placed at the top of a throwaway `config.toml`, loads (`codex doctor`: `config.load` ok), while the
  calibration with a broken line fails.
- **Kiro: documented only.** Steering files are Markdown read from `~/.kiro/steering/`
  ([Configuration scopes](https://kiro.dev/docs/configuration.md)); loading needs a Kiro login, which the
  throwaway home does not have.
- **Tests:** `global/install.test.sh` section 15 and `global/install-managed.test.sh` section 3 assert
  every rendered file carries the source's stamp, that `--check` names a foreign stamp `STAMP` and a
  content change `DRIFT`, and the release rule in a throwaway git repository. Each was mutation-checked
  by breaking the source in a copy of the tree (dropped stamp, dropped JSON key, exact tag ignored,
  dirty state ignored, stamp mismatch read as OK): every mutation turned the suite red; the unmutated
  copy stayed green.

## Links

- Requirements document, [section 9a](../mhw-product-requirements-document-project.md#9a-provenance-stamp-in-every-installed-file)
- [ADR-0002](0002-automatic-semver-cut-policy.md) (numeric SemVer tags)
- [ADR-0010](0010-global-brief-rendered-to-each-harness.md), [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md),
  [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md) (the files stamped here)
- [Native enforcement matrix](../native-enforcement-matrix.md)
