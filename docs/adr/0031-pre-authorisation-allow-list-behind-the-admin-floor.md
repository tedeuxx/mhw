# ADR-0031: Pre-authorise the inner loop at user level, widened only behind the admin deny floor

- **Status:** proposed
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Issue:** [#83](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/83)
  (part of [#52](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/52);
  related: [#55](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/55),
  [#59](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/59),
  [#80](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/80))

## Context and problem

The owner, on #83 (2026-10-05), verbatim:

> "tambem faz parte desse projeto organizar a preautorizacao de tools e comandos necessarias para atingir
> o nivel de autonomia by design confiando na barreira protetora do managed workstation proposto."

and, on the same Issue:

> "outro: todo agent precisa ter automomia de permisoes e tools refinado ao nivel de propostio que ele
> implementa ao loop."

His standing rules for this work: least privilege per purpose with full autonomy inside it; deny always
beats allow; the allow list lives at user level and the barrier in the admin layer; no per-request or
expiring waivers (owner decision of 2026-10-05 on #52); defend the perimeter, not the behaviour, so no
new hooks.

Before this record the repository rendered only what may **never** run (the deny floor, ADR-0016). What
may run **without asking** was each harness's default, so routine inner-loop commands stopped for a
human, and the owner's prompt budget was spent on acts the floor already bounds.

## Decision drivers

- Native first: each harness's own allow carrier, from one versioned source.
- Deny beats allow on every harness that carries a floor, and the allow list must not be able to reach
  around the floor through a spelling the floor does not list.
- The widening depends on the barrier: no admin floor, no wide allow list.
- No new hook, no waiver, nothing written to the admin layer by this step.

## Considered options

1. **One source, rendered natively at user level, in two tiers keyed on the admin floor (chosen).**
   `global/allow-list.conf` holds `narrow` (read and inspect) and `wide` (the full inner loop on a
   feature branch) entries. `install.sh` renders the wide tier for a harness only
   while that harness's admin deny floor is complete; otherwise the narrow tier, with one `RISK` line.
   *Trade-off:* the tier follows a file under the admin root, so a removed admin floor leaves a wide
   list installed until the next install; `--check` reports that as drift (below).
2. **One flat list, always rendered.** Simpler. *Rejected:* without the admin floor, the user-level
   floor can be dropped by a session flag (`--setting-sources project`, measured in ADR-0016), so a
   flat list would pre-authorise writes with no barrier left. That breaks the owner's order rule.
3. **Allow by permission mode alone** (`bypassPermissions` in Claude Code, `never` approval in Codex).
   *Rejected:* both remove the prompt for every act, not for a purpose; the floor already denies the
   bypass flags, and the result is not least privilege.
4. **Put the allow list in the admin layer.** *Rejected by the owner's placement rule:* the allow list
   is a convenience he tunes; only the barrier is administrator-held.

## Decision outcome

Option 1. The narrow tier is cut to least privilege. The wide tier is the full inner loop, by the owner's
decision on #83 (2026-10-05, a native picker, recorded on the Issue). It exists only behind the
root-owned admin deny floor, which no agent can change. Per harness:

| Harness | Carrier (written) | Narrow tier | Wide tier (admin floor complete) |
| --- | --- | --- | --- |
| Claude Code | `permissions.allow` merged into `~/.claude/settings.json` (union, ownership recorded under `personal-multi-harness-workstation-configuration-owned-allow`); `permissions.defaultMode` only when the owner set none; owned `permissions.deny` entries (the `Edit` protections in every tier, the escaping options in the wide tier) | 10 `Bash(...)` rules (`git status`, `git rev-parse`, `git describe`, `git worktree list`, `gh issue view/list`, `gh pr view/list/diff/checks`); no mode | 32 rules: adds `git diff/log/show/grep/blame/ls-files/branch/fetch`, `git switch -c`/`--create`, `git add --`, `git commit -m`, and the repository's 10 test suites by script; 10 escaping-option denies; `acceptEdits` |
| Codex | `~/.codex/rules/workstation-allow-list.rules` (`allow` and `forbidden` prefix rules, **loaded in every session**) and `~/.codex/workstation.config.toml`, a profile used with `codex --profile workstation` | 10 allow rules; `approval_policy = "on-request"`, `sandbox_mode = "read-only"` | 22 allow rules, 10 forbidden escaping options, no test runner; `workspace-write` |
| Kiro | `~/.kiro/agents/workstation.json`: `allowedTools: ["fs_read"]`, `toolsSettings.execute_bash.allowedCommands` | 10 anchored patterns that refuse `;`, `&`, `|`, `<`, `>`, `$`, backtick, parentheses, braces and newlines | **never**: Kiro carries no deny floor (ADR-0016), so it has no barrier to widen behind |

**Pinned natively, measured on git 2.54.0** (a throwaway repository and a marker file outside it):

- `git add --`: `--` ends option parsing, so `git add -- --pathspec-from-file=<path>` is a literal
  pathspec and fails without reading the file. Unpinned, `git add --pathspec-from-file=<path>` printed
  the file's first line in its error.
- `git commit -m`: git refuses `-F` and `--file` beside `-m` (`options '-m' and '-F' cannot be used
  together`), and `-t`/`--template` leaked nothing. **Residual:** `git commit -m x
  --pathspec-from-file=<path>` printed the file's first line in its error. A prefix cannot reach an
  option after the message.

**The escaping options are denied as prefixes** in Claude Code (`permissions.deny`) and Codex
(`decision="forbidden"`): `git diff --no-index`, `git diff --output`, `git log --output`,
`git show --output`, `git grep --no-index`, `git grep -O`, `git grep --open-files-in-pager`,
`git blame --contents`, `git ls-files --exclude-from`, `git fetch --upload-pack`. Codex 0.160.0
`execpolicy check` returns `forbidden` for each of them, and `allow` for the plain command. **A prefix
deny catches the option only right after the command words, in its spaced form.** Measured as `allow` in
Codex and matched only by the allow rule in Claude Code's rendered settings:
`git diff --stat --no-index a b`, `git diff --output=<path>`. The same holds for any option after
another (`git log --oneline --output <path>`), for the attached forms (`--upload-pack=<prog>`,
`-O<prog>`), and for `git diff <path> <path>` run outside a repository, which git treats as
`--no-index` (it printed the marker file, measured).

**Test runners run repository code without a prompt, inside the perimeter. This is the owner's accepted
trade-off.** Each suite is named by its script (`overlay/allow-list.conf`: `sh global/install.test.sh`,
`python3 -B global/workstation_test.py`, ...), in the wide tier and in Claude Code only. Under
`acceptEdits` an agent can rewrite that script before running it, so the wide tier is, in effect,
arbitrary code as the owner's user. What still holds is the root-owned admin layer: the deny floor and
the OS's file ownership. The prefix escapes above, the `Edit` protections below and the absence of
`./workstation install` from the list are therefore **bounds on accident, not on intent**, once the wide
tier is installed.

**What the installer refuses, before anything is written** (each a table-driven case in
`global/allow-list.test.sh`):

1. an allow entry that is a word prefix of a floor entry, or that a floor entry covers;
2. a word holding `/` or `*`, except a runner's single relative `.sh`/`.py` script path (no `..`);
3. a `cmd` whose program runs whatever it is given: shells, interpreters (`python*`, `node`, `perl`,
   ...), dispatchers (`env`, `xargs`, `eval`, `sudo`, `find`, ...) and project-code runners (`make`,
   `npm`, `pytest`, `cargo`, `go`). A runner may start with `sh`, `bash` or `python3` only, with no
   option but `-B` or `-I`, and only in the wide tier;
4. in any tier: `git worktree add`, `git config`, `git archive`, `git format-patch`, `git am`,
   `git apply`, `git pull`, `gh issue/pr comment`, `create`, `edit`, `gh pr review`, `gh gist`, `gh api`,
   `gh extension`, `gh alias`. Each publishes, writes anywhere or runs a program through an option or
   argument;
5. in the narrow tier: the read and build routes (`git diff`, `log`, `show`, `grep`, `blame`,
   `ls-files`, `branch`, `fetch`, `add`, `commit`), so the narrow tier stays read-only;
6. `git add` other than `git add --`, and `git commit` other than `git commit -m`.

**Edit protections.** In Claude Code the files that decide the list carry an `Edit` deny in both tiers:
`~/.claude/settings.json`, the Codex `rules/**`, `config.toml` and `*.config.toml`, `~/.kiro/agents/**`,
this checkout's `global/allow-list.conf` and `overlay/**`, and `**/.git/config` and `**/.git/hooks/**`.
The paths use Claude Code's documented `//` absolute and `~/` home forms; that they match is
**documented, not measured**. `install-managed.sh` subtracts these owned denies, so they never reach the
admin drop-in.

**`./workstation` stays out of every tier**, the installer included, and no entry runs it.

**Order.** With the admin floor incomplete for a harness, the narrow tier is rendered and one line says
so. With it complete, `--check` notes that install would widen, without failing. A wide list installed
while the admin floor is absent is **drift**: `--check` exits 1 and install narrows it.

**`./workstation status`** prints one line: the Claude Code permission mode in effect (the first
`permissions.defaultMode` found, admin first, then project local, project, user), the user-level allow
count, the Codex profile's sandbox mode and allow-rule count, and the Kiro trusted-command count.

### Gaps, stated

- **`git push` is not pre-authorised, and the floor cannot make it safe to.** This slice added the
  upstream-setting and refspec trunk forms to the owner overlay floor (`git push -u origin main`,
  `--set-upstream`, `origin main:main`, `-u origin HEAD:main`, and the same for `master`). With the
  allow list loaded, Codex 0.160.0 `execpolicy check` returns `forbidden` for all twelve, and the
  Claude Code settings carry a matching `Bash(...:*)` deny for each (rendered, not live-measured).
  **A prefix still sees only the spellings it lists.** Measured as *no match* in Codex:
  `git -C <dir> push origin main`, `git push upstream main` (another remote name),
  `git push origin feature:main`, `git push origin refs/heads/main`. A `+` refspec (`git push origin
  +feature`) force-pushes past every `--force` entry. **The real perimeter for the trunk is a
  server-side rule on `main`** (a GitHub ruleset or branch protection that applies to administrators).
  That is the owner's decision and is not applied here; #89 only checks repository settings.
- **Codex loads the allow rules in every session; only the sandbox is opt-in.** Measured on Codex
  0.160.0: `codex debug prompt-input` in a throwaway `CODEX_HOME` lists the rules file's prefixes under
  "Approved command prefixes" with and without `--profile workstation`. The calibration, the same home
  without the file, has no such section. Codex 0.160.0 refuses `--profile` while `config.toml` holds a
  `[profiles.*]` table or a top-level `profile =` line ("legacy"), so the profile is a separate file
  and the owner opts in per session.
- **A Codex `allow` rule may run the command outside the sandbox.** This was not measured. Test runners
  get no Codex rule; they run inside `workspace-write`, or prompt.
- **Codex and Kiro have no file rule**, so the `Edit` protection is Claude Code only.
- **The `Edit` deny protects this checkout's source files from every Claude Code session**, the owner's
  own improvement sessions on this repository included. Bash writes are not `Edit`, and a test runner can
  write anything (above).
- **Per-agent tool lists** (the second ask on #83) are not rendered here: they belong to the agent
  definitions (#61, method rendering). Codex custom agents have no per-agent tool list (#55 matrix).
- **Windows:** `install.ps1` renders no allow list yet.

## Consequences

**Good.** The inner loop runs without asking behind the admin floor, as the owner decided: read, diff,
log, branch, fetch, stage, commit and run the repository's suites. The narrow tier stays read-only on a
machine without the admin layer. One source, three native carriers, no hook.

**Bad.** In the wide tier an agent can run any code as the owner's user through a test script it edited.
The admin floor and OS ownership are the barrier, by the owner's choice. Prefix denies leave measured
escapes. Pushing still prompts. A wide list can outlive the admin floor until the next install. The
Codex profile is opt-in per session. Kiro gains only reading.

## Evidence

| Claim | Level | How |
| --- | --- | --- |
| Narrow without, wide with the admin floor; drift when it goes away; every refusal class; the wide-tier allows, runners and escape denies; protecting `Edit` denies in both tiers; owner rules and mode kept; uninstall removes only ours | **tested** | `global/allow-list.test.sh`, throwaway homes and a throwaway admin root (`install-managed.sh --root`); mutation-checked on the source (below) |
| An added standalone `python3` (and `bash`, `env`, `xargs`, `node`, `./workstation`, `npm test`, `python3 -c`, unpinned `git add`/`git commit`, ...) is refused, exit 2, nothing written | **tested** | section 5 of the suite, one case per entry |
| The `git add --` and `git commit -m` pins; the residual `--pathspec-from-file` after `-m`; `git diff` outside a repository acting as `--no-index` | **measured**, git 2.54.0 | a throwaway repository and a marker file outside it |
| Codex: allowed forms `allow`, escaping options and the floor `forbidden`, later-position and attached forms `allow` | **measured**, Codex 0.160.0 | `codex execpolicy check` against the rendered rules files; the suite asserts the first two |
| Codex: a forbidden rule beats an allow rule whatever the file order | **measured**, Codex 0.160.0 | two rules files, both orders: `{"decision":"forbidden"}` |
| Codex loads the allow rules without `--profile` | **measured**, Codex 0.160.0 | `codex debug prompt-input`: "Approved command prefixes" lists them with and without `--profile`; absent with the file removed. Asserted in the suite |
| Codex loads the profile file | **measured**, Codex 0.160.0 | `codex --profile workstation debug prompt-input`: `sandbox_mode` is `workspace-write`; without `--profile`: `read-only` |
| Claude Code loads the rendered permission mode | **measured**, Claude Code 2.1.289 | headless `init` reports `permissionMode: "acceptEdits"` from the rendered user settings |
| Which Claude Code rule matches each probed form | **rendered**, not live | the probe matches each form against the rendered `permissions.allow`/`deny` by word prefix, which is the documented semantics |
| An allowed command runs without a prompt; a floor command, an escaping option and a protected-file edit are still blocked, in a live Claude Code or Codex session | **not measured** | needs a model call, so a login in the throwaway configuration; agents were not given the owner's credentials or Keychain |
| Kiro loads the agent file and honours `allowedCommands` | **documented** only | `kiro-cli` needs a login (#55 matrix); the patterns are tested with Python's `re.fullmatch` |

**Mutation check (source, never the test).** An unmutated control stayed green. Each mutant turned the
suite red: the runner interpreter set opened (3 red), the runner option check removed (2), the
`git add --` pin removed (1), the `git commit -m` pin removed (2), the narrow-tier read-route refusal
removed (8), Codex forbidden rendering removed (2), one deny entry dropped from the source (2), the
standalone-interpreter refusal removed (2), the never-list shortened (1). The earlier rounds' mutants
(floor-prefix refusal, tier selection, Kiro tail, `/` in a word, `Edit` protections) cover unchanged code.

## Links



- [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md): the deny floor and its admin copy.
- [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md): the admin layer.
- [ADR-0029](0029-provenance-stamp-in-every-installed-file.md): the stamp every rendered file carries.
- [Native enforcement matrix](../native-enforcement-matrix.md): carriers per harness.
