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
   `global/allow-list.conf` holds `narrow` (read and inspect) and `wide` (start a feature branch,
   with edits from the permission mode) entries. `install.sh` renders the wide tier for a harness only
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

Option 1, cut to least privilege after review (2026-10-05: *drop it whenever in doubt*). Per harness:

| Harness | Carrier (written) | Narrow tier | Wide tier (admin floor complete) |
| --- | --- | --- | --- |
| Claude Code | `permissions.allow` merged into `~/.claude/settings.json` (union, ownership recorded under `personal-multi-harness-workstation-configuration-owned-allow`); `permissions.defaultMode` only when the owner set none; `Edit(...)` denies protecting the list (below), in every tier | 10 `Bash(...)` rules (`git status`, `git rev-parse`, `git describe`, `git worktree list`, `gh issue view/list`, `gh pr view/list/diff/checks`); no mode | 12 rules (adds `git switch -c` / `--create`); `acceptEdits` |
| Codex | `~/.codex/rules/workstation-allow-list.rules` (`decision="allow"` prefix rules, **loaded in every session**) and `~/.codex/workstation.config.toml`, a profile used with `codex --profile workstation` | 10 allow rules; `approval_policy = "on-request"`, `sandbox_mode = "read-only"` | 12 allow rules; `workspace-write` |
| Kiro | `~/.kiro/agents/workstation.json`: `allowedTools: ["fs_read"]`, `toolsSettings.execute_bash.allowedCommands` | 10 anchored patterns that refuse `;`, `&`, `|`, `<`, `>`, `$`, backtick, parentheses, braces and newlines | **never**: Kiro carries no deny floor (ADR-0016), so it has no barrier to widen behind |

**What the installer refuses, before anything is written** (each a table-driven case in
`global/allow-list.test.sh`):

1. an entry that is a word prefix of a floor entry, or that a floor entry covers. The first would
   pre-authorise a family the floor denies only in part; the second could never apply;
2. a word holding `/` or `*`, so no path (`./workstation`) and no wildcard;
3. a program that runs whatever it is given: shells (`bash`, `sh`, `zsh`, ...), interpreters (`python*`,
   `node`, `perl`, `ruby`, ...), dispatchers (`env`, `xargs`, `eval`, `exec`, `sudo`, `find`, ...) and
   project-code runners (`make`, `npm`, `npx`, `pytest`, `cargo`, `go`). An allow on one is an allow on
   everything;
4. a command whose own options read or write an arbitrary path or run a program (the list below),
   matched as a word prefix so a narrower spelling cannot slip back in.

**No self-widening.** No entry runs the installer, so a changed list takes effect only through an install
a human approves. In Claude Code the files that decide the list carry an `Edit` deny in both tiers:
`~/.claude/settings.json`, the Codex `rules/**`, `config.toml` and `*.config.toml`, `~/.kiro/agents/**`,
this checkout's `global/allow-list.conf` and `overlay/**`, and `**/.git/config` and `**/.git/hooks/**`
(a repository config can name a program git runs, such as `core.fsmonitor` or a hook). The paths use
Claude Code's documented `//` absolute and `~/` home forms; that they match is **documented, not
measured** (a live check needs a login).

**Order.** With the admin floor incomplete for a harness, the narrow tier is rendered and one line says
so. With it complete, `--check` notes that install would widen, without failing. A wide list installed
while the admin floor is absent is **drift**: `--check` exits 1 and install narrows it. The errors run
toward narrowing, and both directions are printed.

**`./workstation status`** prints one line: the Claude Code permission mode in effect (the first
`permissions.defaultMode` found, admin first, then project local, project, user), the user-level allow
count, the Codex profile's sandbox mode and allow-rule count, and the Kiro trusted-command count.

### What the list leaves out

| Dropped | Option that escapes |
| --- | --- |
| `git diff`, `git log`, `git show` | `--output=<path>` writes anywhere (it could overwrite the settings carrying the floor); `diff --no-index` reads anywhere |
| `git grep` | `-O<program>` runs a program; `--no-index` reads anywhere |
| `git blame` | `--contents <path>` prints any file |
| `git ls-files` | `--exclude-from=<path>` reads any file |
| `git branch --show-current`, `git branch --list` | a pinned flag still accepts trailing options such as `-D` or `-m` |
| `git fetch` | `--upload-pack=<program>` runs a program |
| `git add` | `--pathspec-from-file=<path>` reads any file, echoed back in errors |
| `git commit` | `-F`/`--file`, `-t`/`--template` read any file into the message |
| `git worktree add` | its path argument creates a checkout anywhere |
| `gh issue comment`, `gh pr comment` | `--body-file <path>` reads any file and **publishes** it |
| `./workstation` (every subcommand) | a relative path matches any executable of that name; `install` renders this very list |
| test runners (`npm test`, `pytest`, `python3 -m pytest/unittest`, `go test`, `cargo test`, `make test`) | they run project code, which `acceptEdits` lets an agent rewrite |

The kept entries were read against the same criterion. `git status`, `git rev-parse`, `git describe`
and `git worktree list` take no option that names an input or output path or a program. The `gh`
read routes (`issue view/list`, `pr view/list/diff/checks`) take no local-path option; `--web` opens a
browser and `-R` reads another repository, both read-only. `git switch -c` takes no path or program
option. **Still true of every kept git command:** git runs a program the repository's config names
(`core.fsmonitor`, a hook, `core.hooksPath`). That config is inside the working directory, which is why
`.git/config` and `.git/hooks/**` carry the `Edit` deny above. A config reached any other way, such as
`include.path` to a file outside `.git` or a global `~/.gitconfig`, is not covered.

### Gaps, stated

- **`git push` is not pre-authorised, and the floor cannot make it safe to.** This slice added the
  upstream-setting and refspec trunk forms to the owner overlay floor (`git push -u origin main`,
  `--set-upstream`, `origin main:main`, `-u origin HEAD:main`, and the same for `master`); with the
  allow list loaded, Codex 0.160.0 `execpolicy check` returns `forbidden` for all twelve, and the
  Claude Code settings carry a matching `Bash(...:*)` deny for each (rendered, not live-measured).
  **A prefix still sees only the spellings it lists.** Measured as *no match* in Codex:
  `git -C <dir> push origin main`, `git push upstream main` (another remote name),
  `git push origin feature:main`, `git push origin refs/heads/main`. A `+` refspec (`git push origin
  +feature`) force-pushes past every `--force` entry. An allow of `git push` would let all of those
  run without a prompt, so the installer's floor-overlap refusal keeps it out, and pushing stays a
  prompt. **The real perimeter for the trunk is a server-side rule on `main`** (a GitHub ruleset or
  branch protection that applies to administrators). That is the owner's decision and is not applied
  here; #89 only checks repository settings.
- **Codex loads the allow rules in every session; only the sandbox is opt-in.** Measured on Codex 0.160.0:
  `codex debug prompt-input` in a throwaway `CODEX_HOME` lists the rules file's prefixes under
  "Approved command prefixes" with and without `--profile workstation`. The calibration, the same home
  without the file, has no such section. Codex 0.160.0 refuses `--profile` while `config.toml` holds a
  `[profiles.*]` table or a top-level `profile =` line ("legacy"), so the profile is a separate file
  and the owner opts in per session.
- **A Codex `allow` rule may run the command outside the sandbox.** Whether it does was not measured;
  the kept entries are read-only apart from `git switch -c`.
- **Codex and Kiro have no file rule**, so the `Edit` protection is Claude Code only. In Codex the
  `workspace-write` sandbox can write this checkout's `allow-list.conf`; installing the result still
  needs a human, because no entry runs the installer.
- **The `Edit` deny protects this checkout's source files from every Claude Code session**, the owner's
  own improvement sessions on this repository included: editing `global/allow-list.conf` or `overlay/`
  becomes the owner's act, or a session run before install. Bash writes are not `Edit` and are not
  denied; none is allow-listed, so they prompt.
- **Per-agent tool lists** (the second ask on #83) are not rendered here: they belong to the agent
  definitions (#61, method rendering). Codex custom agents have no per-agent tool list (#55 matrix).
- **Windows:** `install.ps1` renders no allow list yet.

## Consequences

**Good.** The inner loop's read routes stop asking. The barrier is the admin floor, as the owner
ordered. One source, three native carriers, no hook. No entry can read or write outside its purpose or
run a program, and the list cannot widen itself without a human.

**Bad.** The autonomy gained is small: commits, comments, pushes, fetches and test runs still prompt,
and in the wide tier only edits (`acceptEdits`) and branch creation go through. A wide list can outlive
the admin floor until the next install. The Codex profile is opt-in per session. Kiro gains only
reading. The `Edit` denies add friction to editing this repository's own list.

## Evidence

| Claim | Level | How |
| --- | --- | --- |
| Narrow without, wide with the admin floor; drift when it goes away; every refusal class above; protecting `Edit` denies in both tiers; owner rules and mode kept; uninstall removes only ours | **tested** | `global/allow-list.test.sh`, throwaway homes and a throwaway admin root (`install-managed.sh --root`); mutation-checked on the source (below) |
| An added `python3` (and `bash`, `env`, `xargs`, `node`, `./workstation`, `npm test`, `git diff`, `gh pr comment`, ...) is refused, exit 2, nothing written | **tested** | section 5 of the suite, one case per entry |
| Codex: a forbidden rule beats an allow rule whatever the file order | **measured**, Codex 0.160.0 | `codex execpolicy check` with two rules files, both orders: `{"decision":"forbidden"}`; the suite checks every floor prefix and the twelve trunk forms against the rendered files |
| Codex loads the allow rules without `--profile` | **measured**, Codex 0.160.0 | `codex debug prompt-input`: "Approved command prefixes" lists them with and without `--profile`; absent with the file removed. Asserted in the suite |
| Codex loads the profile file | **measured**, Codex 0.160.0 | `codex --profile workstation debug prompt-input` in a throwaway `CODEX_HOME`: the prompt states `sandbox_mode` is `workspace-write`; without `--profile`: `read-only` |
| Claude Code loads the rendered permission mode | **measured**, Claude Code 2.1.289 | `claude -p --output-format stream-json --verbose --setting-sources user` with a throwaway `HOME` and `CLAUDE_CONFIG_DIR`: `init` reports `permissionMode: "acceptEdits"` |
| An allowed command runs without a prompt; a floor command and a protected-file edit are still blocked with the allow list present, in a live Claude Code or Codex session | **not measured** | needs a model call, so a login in the throwaway configuration; agents were not given the owner's credentials or Keychain. Precedence is documented (Claude Code: deny from any layer wins) and was measured for a project allow against a user deny in ADR-0016 |
| Kiro loads the agent file and honours `allowedCommands` | **documented** only | `kiro-cli` needs a login (#55 matrix); the patterns themselves are tested with Python's `re.fullmatch` |

**Mutation check (source, never the test).** An unmutated control stayed green. Each mutant turned the
suite red: removing the interpreter refusal (2 red), the runner refusal (2), the option-escape refusal
(1), the `overlay/**` protection (2), the settings protection (2), or the ban on `/` in a word (2). Earlier mutants from the first round
still apply to unchanged code: the floor-prefix refusal, the Claude Code and Codex tier selection, the
Kiro argument tail, and the owned mode removed when narrowing.

## Links


- [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md): the deny floor and its admin copy.
- [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md): the admin layer.
- [ADR-0029](0029-provenance-stamp-in-every-installed-file.md): the stamp every rendered file carries.
- [Native enforcement matrix](../native-enforcement-matrix.md): carriers per harness.
