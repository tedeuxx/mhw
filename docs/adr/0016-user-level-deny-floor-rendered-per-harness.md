# 0016 — A generic user-level deny floor, rendered per harness

- **Status:** ~~proposed. The owner asked for a mechanical floor (Issue #4). The entries in
  `global/deny-floor.conf` are the agent's proposal and await his ratification, entry by entry if he
  wants.~~ **accepted** (the owner's ratification, 2026-10-01). See the amendment "2026-10-01:
  ratified by the owner and installed on the reference workstation" below. The amendment
  "2026-10-05: the floor absorbs the plugin's irreversible-action rules and moves to the admin layer"
  is **proposed**.
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner, in Issue #4 (2026-10-01): *"the firewall must be enforced, not only instructed. User-level
deny rules hold across levels in Claude Code (ADR-0014, documented); hooks do not (a project can
disable them)."* Done when the repository ships *"a generic user-level deny floor (secret writes,
history rewrites, destructive deletes and other irreversible acts) rendered per harness"*, installed by
`install.sh` / `install.ps1` with `--dry-run` and `--check`, tested in a throwaway HOME, and *"must not
duplicate or weaken what the tadeumendonca-skills plugin already denies (ADR-0014)"*.

Until this record, the firewall's only installed control was an instruction (ADR-0014, "How 'last
barrier' maps onto real precedence"). An instruction is low precedence in all three harnesses. ADR-0013's
guard is a hook, and a project's `disableAllHooks: true` turns user hooks off (documented, ADR-0014).

### What already exists on the reference workstation

- **The owner's `~/.claude/settings.json`** carries 39 `permissions.deny` entries, read 2026-10-01 with
  `jq '.permissions.deny | length' ~/.claude/settings.json`. They mix generic irreversible acts with
  his way of working (`gh api`, `gh workflow run`, squash merges, tag pushes) and his own repository
  paths. They were put there by hand. Nothing in this repository manages them.
- **The plugin's `permission-guard.sh`** (tadeumendonca-skills 2.0.102) is a `PreToolUse(Bash)` hook.
  It reads the whole command string, so it catches spellings a prefix cannot (`git -C <dir> push
  --force`, a `+refspec`, any `rm` flag order). It is a hook, so a project can disable it.
- **`tadeumendonca-io/.codex/rules/claude-command-policy.rules`** is a project-level Codex port of the
  Claude list. It uses `prefix_rule(pattern=[…], decision="forbidden")`, which is the syntax this record
  renders (*read from that file*, and *measured* below).

## Decision drivers

- Enforced, not instructed: the floor has to sit in a layer a project cannot switch off.
- Generic (Principle 1): no owner path, account or repository. Owner extras go in `overlay/`.
- Never weaken: the installer only adds. It never removes, reorders or rewrites an existing rule. The
  plugin is not touched.
- Report each harness at its real evidence level.
- One source, rendered per harness, like the brief (ADR-0010).

## Considered options

1. **Static deny rules at user level, one source rendered to each harness's own format (chosen).**
   Claude Code `permissions.deny` merged into `~/.claude/settings.json`. A Codex rules file in
   `${CODEX_HOME:-~/.codex}/rules/`. Trade-off: a deny rule is a prefix match on the command words. It
   is narrow, and another spelling escapes it (below).
2. **Rely on the plugin's guard.** It already denies more spellings than a prefix can. Rejected: it is
   a hook, so a project can disable it. It is not what an adopter installs, and it carries the way of
   working, which ADR-0014 keeps out of the floor.
3. **A user-level whole-string guard hook owned here** (a firewall copy of the plugin's guard).
   Rejected for now: same `disableAllHooks` weakness, and a 4600-line duplicate of a guard that already
   runs on this machine. It is the right complement to the floor if the owner wants spelling coverage
   that survives without the plugin.
4. **Adopt the owner's current 39 entries as the floor.** Rejected: about half are his way of working or
   name his repositories. They stay in his settings, untouched. The ones that are generic are in the
   floor too, and the merge does not duplicate them.
5. **Managed layer** (`managed-settings.json`, `/etc/codex/requirements.toml`). This is the only
   documented non-overridable layer (ADR-0014). ~~It is still the proposed hardening, not done here: it
   needs admin rights, and the floor had to exist first. This record is that prerequisite.~~ Rendered
   since the 2026-10-05 amendment below; installing it is the owner's `sudo` act.

## Decision outcome

**Chosen: option 1.**

### The source and its grammar

`global/deny-floor.conf`, plus `overlay/deny-floor.conf` when an overlay has one (none ships today:
nothing owner-specific is warranted by the firewall's purpose yet). One entry per line:

| Entry | Claude Code | Codex |
| --- | --- | --- |
| `cmd <word> …` | `Bash(<words>:*)` | `prefix_rule(pattern=["<word>", …], decision="forbidden")` |
| `file <path>` | `Read(<path>)` and `Edit(<path>)` | nothing: Codex rules match commands, not file reads |

A word may hold letters, digits and `. _ / ~ = : @ + -` only. `*` is allowed in a file path and refused
in a `cmd` word, because Claude reads it as a wildcard and Codex as a literal character, so the two
harnesses would disagree about one entry. Every line is validated before anything is written. An
invalid one stops the run with exit 2, so an entry the parser would drop never becomes a silent hole.

### The floor (101 Claude rules from 87 `cmd` and 7 `file` entries)

| Category | Entries | Why it is on the floor |
| --- | --- | --- |
| Bypassing the permission layer | `claude --dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--permission-mode bypassPermissions`; `codex [exec] --dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `--sandbox`/`-s danger-full-access`; `sudo` | An agent starting a less-guarded agent, or escalating privilege, erases every other rule |
| Reading a credential into context | `gh auth token`; `security find-generic-password`, `find-internet-password`, `dump-keychain`; `aws configure export-credentials`, `aws configure get aws_secret_access_key`, `aws secretsmanager get-secret-value`; file reads and writes of `~/.ssh/id_*`, `~/.aws/credentials`, `~/.netrc`, `~/.config/gh/hosts.yml`, `~/.docker/config.json`, `~/.codex/auth.json`, `~/.claude/.credentials.json` | The firewall's first job is that secrets do not reach a model provider (`AGENTS.md`, "How: the LLM firewall") |
| Writing or deleting a secret | `gh secret set/delete/remove`; `aws secretsmanager create-secret/put-secret-value/update-secret/delete-secret`; `aws ssm put-parameter`; `aws iam create-access-key`; `security add-/delete-generic-password`, `add-/delete-internet-password` | A secret is set by the human, never by an agent |
| Rewriting history | `git push --force`, `--force-with-lease`, `--force-if-includes`, `-f`, `--mirror`; `git reset --hard`; `git filter-branch`, `filter-repo`; `git reflog expire/delete`; `git gc --prune=now` | Others may hold the old history; the last three destroy what makes a rewrite recoverable |
| Destructive deletes | `rm` with `-rf`, `-fr`, `-Rf`, `-fR`, `-r -f`, `-f -r`, `-R -f`, `-f -R`, `--recursive --force`, `--force --recursive`; `git clean -f`, ten combined spellings with `d` and `x`, `--force`, `-d -f`, `-x -f` | Untracked files have no other copy. The flags are a set, not a token, so each spelling is its own entry |
| Mutating infrastructure outside a pipeline | `terraform apply`, `terraform destroy` | A destroyed resource is not restored by a revert. No layer on the reference machine allows either; his repositories allow only `plan`, `fmt`, `validate` and `init` |
| Publishing, releasing, exposing a repository | `gh repo delete/archive/rename`, `gh repo edit --visibility`; `gh release create/delete/edit/upload`; `gh gist create`; `npm publish/unpublish`, `pnpm publish`, `yarn publish`, `yarn npm publish`, `cargo publish`, `twine upload`, `gem push`, `docker push` | What is published under his name cannot be unpublished from everyone who saw it (`AGENTS.md`, "Concretely", item 2) |

### Rendering and installing

- **Claude Code:** `install.sh` merges the floor into `~/.claude/settings.json` in the same `jq` pass
  as ADR-0013's hook entry. It is a **union**: a missing floor rule is appended, and every existing deny
  entry is kept in place. Nothing is ever removed. There is one backup (`settings.json.pmhwc-backup`).
  `--dry-run` prints the semantic diff. `--check` reports how many floor rules are missing. A
  `permissions` or `permissions.deny` of the wrong type is refused (exit 3), and the file is left
  untouched.
- **Codex:** a managed file, `${CODEX_HOME:-~/.codex}/rules/workstation-deny-floor.rules`, with the
  usual marker line, overwrite and drift rules (ADR-0010). The owner's own `default.rules`, where Codex
  writes his approvals, is never touched.
- **Kiro:** nothing is rendered (below).
- **Windows:** `install.ps1` renders the Codex file and merges the deny floor into the Claude Code
  settings with the same grammar and validation. ~~**Untested**: no PowerShell runtime was available, and
  it has never run.~~ Tested on a Windows CI runner since ADR-0010's 2026-10-01 amendment on Windows,
  Linux and Kiro CLI.

~~On the reference machine today, read 2026-10-01 and not installed:~~ **Pre-install state** (read
2026-10-01, before the installer ran on the reference machine): 20 of the 101 floor rules are
already in his deny list, and the merge would add 81. His other 19 entries are kept. ~~The installer was
**not** run against his real HOME; that needs his go.~~ (Struck 2026-10-01: the owner ratified and the
installer ran on the reference machine. See the amendment "2026-10-01: ratified by the owner and
installed on the reference workstation" below.)

**What the floor takes away from something allowed today.** This is the complete list, because he
ratifies it. An allow entry counts as narrowed when a floor rule denies part of what it allows. That
happens when a `Bash` rule's words equal the allow's prefix or extend it, or when an `Edit(<path>)` rule
meets a bare `Edit` or `Write` allow. Computed against the rendered floor, and calibrated against the
known-present `npm:*` hit:

| Layer | Allow entry | What the floor now denies inside it |
| --- | --- | --- |
| user (`~/.claude/settings.json`) | `Edit` | edits of the 7 credential files |
| user | `Write` | the same 7 files. That an `Edit(<path>)` rule also covers the `Write` tool is *documented* (<https://code.claude.com/docs/en/permissions>), **not measured** |
| user | `Bash(git push:*)` | `--force`, `--force-with-lease`, `-f` (already in his deny list), and newly `--force-if-includes` and `--mirror` |
| user | `Bash(npm:*)` | `npm publish`, `npm unpublish` |
| project (`tadeumendonca-io`, `tadeumendonca-skills`, committed `settings.json`) | `Edit`, `Write`, `Bash(git push:*)`, `Bash(npm:*)` | as above |
| project (same two files) | `Bash(rm:*)` | the 10 recursive-force spellings. The plugin guard already denies all of them |
| project local (`tadeumendonca-skills/.claude/settings.local.json`) | `Bash(gh repo *)` | `gh repo delete`, `archive`, `rename`: the plugin guard already denies these. **And `gh repo edit --visibility`, which the plugin guard does not deny** |

Everything else in the floor, including `sudo`, the credential-file reads, `terraform apply/destroy`
and the secret commands, is allowed by no layer today. There it changes a permission prompt into a
denial, which is still a change he ratifies.

**Overlap with the plugin guard is deliberate.** The floor sits in a layer a project cannot disable,
and the guard sits in one it can. Issue #4's "must not duplicate or weaken" is read as *must not
contradict or weaken*. The floor never allows anything the guard denies, and it never removes a rule.

### Per harness: evidence level

| Harness | What is installed | Evidence |
| --- | --- | --- |
| **Claude Code** 2.1.286 | `permissions.deny` at user level | **enforced, measured headless.** The real installer wrote the floor into a throwaway HOME (auth through a symlink to `~/Library/Keychains`, no credential copied, link deleted after). A throwaway project with `permissions.allow: ["Bash(rm:*)"]` was marked trusted in the throwaway `.claude.json`. `claude -p --model haiku --setting-sources user,project` was asked to run `rm -rf` and `rm -rf victim`. Both were in `permission_denials`, and the fixture survived on disk. **Calibration**, the same with `--setting-sources project`: both ran and the fixture was deleted. So a trusted project allow does not carve out a user deny (measured, one rule, headless), and `Bash(rm -rf:*)` also matches the bare `rm -rf`. The `Read`/`Edit` file rules are *documented*, not measured. |
| Claude Code, interactive | same file | not measured. The settings file is shared with headless mode; that it is enforced the same way is a hypothesis |
| **Codex** 0.155.0-alpha.16.3 (the `codex` on `PATH`, from the VS Code extension; the README's 16.4 is the desktop app's bundled CLI, not measured here) | `~/.codex/rules/workstation-deny-floor.rules` | **enforced, measured headless.** `codex execpolicy check` (credential-free) parses the rendered file, forbids `git push --force origin x`, and leaves `git push origin x` alone; this runs in the test suite wherever `codex` is on `PATH`. A live `codex exec -s workspace-write` with `CODEX_HOME` throwaway (only an `auth.json` symlink, deleted after) and the installer-rendered file refused `npm publish` with *"policy forbids commands starting with `npm publish`"*. **Calibration**, the same without the file: the command ran. So Codex loads a non-default file name from the user `rules/` directory (measured). The probe act was a package marked `private`, which npm refuses to publish either way. |
| Codex app / IDE extension | same file | not measured |
| **Kiro IDE** 1.0.437 | **nothing** | The shipped bundle reads `.kiro/settings/permissions.yaml` or `permissions.json` at user and workspace scope, with rules of the shape `{capability: "shell", match: […], effect: "deny"}`, and migrates a legacy `kiroAgent.commandDenylist` setting into it (*read from the bundle's `extension.js`*, not documented and not exercised). Its matching semantics, its precedence between user and workspace, and whether a deny can be overridden are not established. Nothing can be exercised without a subscription (ADR-0003). So nothing is rendered, and the floor does not exist in Kiro. |
| Kiro CLI, Claude desktop / Cowork, ChatGPT desktop | nothing | no user-level command-rule layer is known (ADR-0010, ADR-0013) |
| Windows | `install.ps1` | ~~written, **untested**~~ **tested on a Windows CI runner** under Windows PowerShell 5.1 and PowerShell 7, throwaway profiles only (ADR-0010's 2026-10-01 amendment on Windows, Linux and Kiro CLI): the settings union merge and the Codex rules file are written correctly. **Not enforced-measured**: no Claude Code or Codex ran against the result on Windows |

### Precedence, with sources

- **Claude Code.** Permission rules merge across levels, and deny is checked first, so a project cannot
  remove or carve out a user deny (*documented*: <https://code.claude.com/docs/en/permissions>;
  *measured* once above). A project's `disableAllHooks` does not reach permission rules; it turns off
  hooks (*documented*: <https://code.claude.com/docs/en/settings-reference#disableallhooks>). Managed
  settings are the only documented layer a user cannot change (*documented*:
  <https://code.claude.com/docs/en/settings#settings-precedence>), so the owner himself, or an agent
  allowed to edit `~/.claude/settings.json`, can still remove a floor rule. His current settings ask
  before any `Edit` of that file.
  Also measured: in build 2.1.286 a project's `permissions.allow` is ignored in an untrusted workspace,
  with a stderr notice.
- **Codex.** When several rules match, the evaluator returns the most restrictive decision regardless
  of file order (*measured* with `codex execpolicy check --rules allow.rules --rules forbidden.rules`,
  both orders → `forbidden`). Whether a trusted project's `.codex/rules` is evaluated together with the
  user file, so that a project `allow` cannot override a user `forbidden`, is **unmeasured** (hypothesis).
  The evaluator result suggests it but does not show the runtime loads both. Managed
  `requirements.toml` is the documented non-overridable layer (ADR-0014).
- **Kiro.** Unknown (above).

### What a deny cannot do

In Claude Code's own words, a Bash deny rule covers the invocation Claude usually produces and *"isn't a
security boundary around the program"* (<https://code.claude.com/docs/en/permissions>). A prefix rule
matches the command words from the program name on. Measured on the rendered Codex file with `codex
execpolicy check`, these escape it:

| Spelling | Result |
| --- | --- |
| `git push origin x --force` (flag after the refspec) | no match |
| `git -C . push --force` (a global option before the subcommand) | no match |
| `/bin/rm -rf x` (absolute path) | no match; `forbidden` only with `--resolve-host-executables` |
| `rm -rfv x` (one more flag letter) | no match |
| `env rm -rf x` (a wrapper) | no match |
| `claude -p hi --dangerously-skip-permissions` (bypass flag after another option: the headless form an agent would use to launch one) | no match |
| `codex exec --json --dangerously-bypass-approvals-and-sandbox hi` (same) | no match |
| `git clean -q -f`, `git clean -d -x -f` (`-f` not in the first two positions) | no match. `--force -d`, `-d -f` and `-x -f` are forbidden |
| `terraform -chdir=iac apply` (a global option before the subcommand; his repositories use this form for `plan`) | no match. `terraform apply -auto-approve` and `terraform destroy` are forbidden, and `terraform plan` is untouched |

Claude Code's prefix has the same shape: a token-bounded prefix, so a flag later in the command and
`git -C <dir>` are not covered. That is *documented* in the plugin's `devops` skill, measured there on
2.1.261, and not re-measured here. (In this repository's method that text is in the `scm` skill since
#97, which split `devops` by capability.) Neither harness's rule sees inside a script, a `Makefile` or an
`npm run` target, or a command an MCP tool runs. In Claude Code, `Read`/`Edit` rules govern the
built-in file tools, not `cat` in Bash.

**What covers part of this today, outside the floor:** the plugin's whole-string guard, wherever the
plugin is enabled and hooks are not disabled. **What covers the rest:** nothing. The floor is a floor,
not a wall, and it is reported as one.

Measured over-matches, accepted as the price of a prefix:

- `npm publish --dry-run` is forbidden.
- `sudo` is forbidden whole.
- `codex exec -s danger-full-access` is forbidden even when the owner types it into an agent on purpose.
- `aws ssm put-parameter --type String` (a non-secret parameter) and `aws secretsmanager
  get-secret-value` are forbidden. The plugin guard allows both on purpose: it denies `put-parameter`
  only for `SecureString`, and it does not deny `get-secret-value`. Being stricter than the plugin is
  intended here, and it is listed so it is not mistaken for a contradiction.

A deny only constrains what an agent runs. The owner's own terminal is untouched.

Also observed: Codex rejected `rm -rf victim` **natively**, with no rules file (*"rm -f style commands
are not permitted"*), so the `rm` entries duplicate a built-in there. That is harmless, and it is why
the Codex probe uses `npm publish`.

## Consequences

- Good: the first firewall control that a project cannot switch off in Claude Code (documented, and
  measured for one rule). In Codex it holds at user level, measured; its precedence against project
  rules is unmeasured.
- Good: one source, two renderings, and an order-preserving union, so the owner's hand-written rules
  survive and no rule is duplicated.
- Good: adopters get the floor without the plugin.
- Bad: a prefix is narrow. The escapes above are real, and only the plugin's hook, where it runs,
  narrows them.
- Bad: the union only adds. Dropping an entry from the source does not remove it from an installed
  settings file. Removal is a hand edit by the owner, which is deliberate: the installer cannot tell an
  entry it added from one he wrote.
- Bad: the first merge re-serializes `~/.claude/settings.json` (ADR-0013 already has this cost). The
  dry-run says so and shows the semantic diff.
- Bad: on the reference machine the floor narrows four user-level allows (`Edit`, `Write`, `git
  push:*`, `npm:*`). At project level it also narrows `rm:*` and `gh repo *`, as listed in the table
  above. Every other entry turns today's prompt into a denial. Each is the owner's to ratify.
- Bad: Kiro carries no floor~~, and the Windows installer is untested~~. The Windows installer is
  tested in CI since ADR-0010's 2026-10-01 amendment on Windows, Linux and Kiro CLI; whether the floor
  is enforced on Windows is not measured.
- Version cut (ADR-0002): **minor**. It is a new protection, and nothing an adopter had is weakened.

## Amendment 2026-10-01: ratified by the owner and installed on the reference workstation

**The status moves from proposed to accepted.** The source is the owner's ratification as recorded on
Issue #4
(<https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/4#issuecomment-5937083996>).
The main session asked:

> *"você ratifica as regras de bloqueio da ADR-0016 e me deixa rodar o instalador no seu ~?"*

The owner answered:

> *"de acordo"*

The one question covered both the rules and running the installer against his real HOME. So it
ratifies the floor as written in "The floor (101 Claude rules from 87 `cmd` and 7 `file` entries)",
including every narrowing listed under "What the floor takes away from something allowed today". He
did not rule on any entry separately.

**Installed on the reference workstation**, as the same comment records, from `main` at v0.7.0
(`093f84f`):

- `global/install.sh` exited 0. `global/install.sh --check` then exited 0, with every target OK and
  *"hook entry and all 101 deny-floor rules present"*.
- The user `permissions.deny` list went from 39 to 120 entries. That is the 81 additions this record
  predicted before the run ("20 of the 101 floor rules are already in his deny list, and the merge
  would add 81"). Every pre-existing deny rule is still present. Every key outside `permissions.deny`
  is byte-identical to the pre-install backup (equal canonical-JSON checksum).
- Codex: the managed `rules/workstation-deny-floor.rules` file was written.

**Evidence level on the reference machine: installed and checked, not enforced-measured.** `--check`
shows the rules are present. It does not show that a harness refuses a command there. Enforcement
evidence is still the headless measurement in throwaway homes ("Per harness: evidence level").

**What this changes in the body above.** The sentence "The installer was **not** run against his real
HOME; that needs his go" no longer holds and is struck in place. The 2026-10-01 counts beside it are
marked as the pre-install state. The rest stands: Kiro still carries no floor, Windows is still not enforced-measured,
and every escape in "What a deny cannot do" still escapes.

## Amendment 2026-10-05: the floor absorbs the plugin's irreversible-action rules and moves to the admin layer

**Status of this amendment: proposed.** The owner approved the slice (Issue #59, part of #52). The new
entries below are the agent's proposal and await his ratification, as the first 101 did.

### Why

[`docs/native-enforcement-matrix.md`](../native-enforcement-matrix.md) measured, on Claude Code
2.1.289, that the session flag `--setting-sources project` drops the user layer: a user-level
`deny: ["Bash"]` removed `Bash` from the session, and with the flag `Bash` was back. Re-measured for
this amendment in a throwaway home, same version, no login and no model call:

| Settings | `Bash` in the session's tools |
| --- | --- |
| no deny (control) | yes |
| user `settings.json` deny | **no** |
| user `settings.json` deny, `--setting-sources project` | **yes**: the floor is gone |
| `--settings` file deny, with or without `--setting-sources project` | no |

Codex has the same weakness by its help text: `codex exec --ignore-rules` skips user and project
`.rules` files (0.160.0, not exercised). Neither flag needs privilege, and an agent can type either.
The admin layer is the only one outside their reach (ADR-0014, ADR-0027). The PRD's placement rule
(ADR-0026, proposed) puts a protection in one layer, installed before the old copy is removed.

**The owner's constraint on exceptions** (2026-10-05, set while this slice was built):

> *"nao podemos ter nenhuma trava mecanica que individualize pedidos de waiver temporarios que nao
> esteja associado a um nivel de privilegio que permaneça valido ao longo da sessao. o sudo/su pode
> servir para esse proposito alinhado a um comportamento padrao de industria de so."*

In English: no mechanical lock may require per-request, temporary or expiring waivers; any exception
path is tied to an OS privilege level that stays valid across the session, which is the standard OS
behaviour of an administrator changing managed policy with `sudo`/`su`. So the admin floor has **no
waiver, no per-rule exception and no expiring switch**. It is changed only by an administrator,
through `install-managed.sh` and `sudo`, like any OS-managed policy.

**Conflict named, not extended:** the ADR-0024 breaking-glass switches are timed, per-request waivers
(each expires after at most a fixed number of minutes). They cover only the three hook layers
(`paste-filter`, `restart-guard`, `hitl-guard` in `global/hooks/breaking_glass.py`), never the deny
floor, and this amendment does not add the floor to them. They conflict with the constraint above and
are to be removed under Issue #56.

**The owner's decision on squash merges** (2026-10-05, set while this slice was built):

> *"nao podemos trabalhar com squash, lembre-se disso no nivel de managed workstation, padronizando
> configuracoes de repo no github e account se necessario. corrija o pr atual para nao cair em
> squash."*

In English: never squash; it is a workstation-level standard, applied to GitHub repository (and
account) settings where needed, and this pull request must not be merged by squash. Three changes
follow, below: the floor denies the squash spellings a prefix can see; `workspace/delivery.py merge`
uses a real merge commit (`--merge`); and a versioned repository settings standard turns squash off on
the forge.

### Decision

1. **The same floor is rendered into the admin layer.** `global/install-managed.sh` takes the deny list
   `install.sh` renders (global entries, then the overlay's) and writes it into the admin documents it
   already installs (ADR-0025): the Claude Code drop-in
   `managed-settings.d/50-personal-multi-harness-workstation-configuration.json` gains
   `permissions.deny`, and `/etc/codex/requirements.toml` gains `[rules] prefix_rules`, one rule per
   `cmd` entry, `decision = "forbidden"`. Requirements rules can only prompt or forbid, and they merge
   with every `.rules` file with the most restrictive result winning (Codex configuration reference).
   The stage hash, the validation and the one `sudo` line are unchanged in shape; the validation now
   also refuses a stage whose drop-in lacks the deny list or whose prefix rules are not all
   `forbidden` or not one per `cmd` entry. A `file` entry still has no Codex form. Kiro gets nothing.
2. **The user copy stays for now.** The placement rule removes the old copy only after the new one is
   installed. The admin copy is not installed (that is the owner's `sudo` act), so the user copy is the
   only one in force on the reference machine today. Retiring it is a later step, after the owner's
   install and canary; `install.sh` cannot remove it anyway, because its union never removes a rule.
3. **`install.sh` reports which layer carries the floor.** Every run, `--check` included, ends with
   `FLOOR` lines: the user and admin counts for Claude Code, the user file and admin prefix-rule count
   for Codex, Kiro as none, and one `carried by:` verdict (the admin layer; the user layer only; the
   user layer with an incomplete admin copy; or no complete layer). The report never changes the exit
   status: admin drift is `install-managed.sh --check`'s to report.
4. **The plugin's irreversible-action rules are absorbed where a native prefix can carry them.** The
   plugin keeps its copy until this ships; dropping it is Issue #63.

### The plugin's rules, mapped

Source: `tadeumendonca-skills` 2.0.102, `hooks/scripts/permission-guard.sh` (read only). Each numbered
deny the guard issues is one row. ~~**11 already in the floor, 8 added, 13 left as gaps.**~~
**11 already in the floor, 9 added, 12 left as gaps** (squash merge moved from gap to added, on the
owner's decision below).

| Plugin rule | Outcome | Floor entries, or the reason it is a gap |
| --- | --- | --- |
| 1 `--dangerously-skip-permissions` anywhere | already | `claude --dangerously-skip-permissions` and the other bypass flags |
| 2 `terraform apply/destroy` | already | both |
| 3a `git reset --hard` | already | |
| 3b force-push | already, flag-first spellings | `--force`, `--force-with-lease`, `--force-if-includes`, `-f`, `--mirror`. A `+refspec`, a flag after the refspec, `-c remote.<r>.push=+…` and `git -C <dir> push` are gaps |
| 4 recursive force `rm` | already, 10 spellings | `rm -rfv`, `/bin/rm` are gaps |
| 4b `git clean -f` | already, 14 spellings | |
| 5 SSM `put-parameter` SecureString | already, stricter | the floor denies every `aws ssm put-parameter` |
| 5b `gh secret set/delete/remove` | already | |
| 5g `gh repo delete` | already | |
| 5g `gh repo archive/rename` | already | |
| 5g `gh release create/delete` | already | plus `edit` and `upload` |
| 4c `git worktree remove` of a dirty worktree | **added**, stricter | `git worktree remove --force`, `-f`. A clean worktree needs no force; the dirty-state test needs a `git status` read, which no rule makes |
| 5 Secrets Manager writes | **added** the missing one | `aws secretsmanager restore-secret` |
| 5f `gh api` that writes | **added**, partial | `gh api -X` and `gh api --method` with `POST`, `PUT`, `PATCH`, `DELETE` (8). The method after the endpoint, `--method=POST`, `-XPOST` and `-f`/`-F` fields are gaps |
| 5g `gh workflow run` | **added** | `gh workflow run` |
| 7 a push whose refspec is the trunk | **added** to the overlay | `git push origin main`, `master`, `HEAD:main`, `HEAD:master` |
| 7 an empty-source refspec (deletes the trunk) | **added** to the overlay | `git push origin :main`, `:master`, `--delete main`, `--delete master` |
| 7 `--all`/`--mirror` | **added** to the overlay | `git push --all` (`--mirror` was already global) |
| 7 `--tags`/`--follow-tags` | **added** to the overlay | both |
| 6 `aws <service> delete-*`, `terminate-*`, … | gap | needs a wildcard on the service and the verb. Claude Code reads `*`, Codex reads it as a literal, and the grammar keeps the two agent harnesses identical |
| 7 `git push` while the trunk is checked out | gap | the act is in the checked-out branch, not the command |
| 7 a brace expansion in the refspec | gap | needs the shell's expansion |
| 7 a push whose target cannot be resolved | gap | needs argument parsing |
| 7b squash merge | ~~gap~~ **added**, partial, plus the repository setting | `gh pr merge --squash`, `gh pr merge -s`. ~~The prescribed spelling puts the flag after the pull-request number. Also, this repository's own `workspace/delivery.py merge` squashes, so a no-squash rule would contradict it: the owner's call~~ The owner decided: never squash (quote below). A flag after the pull-request number (`gh pr merge 12 --squash`), `--auto --squash` and a script are not caught by the prefix; the GitHub repository setting `allow_squash_merge: false` refuses a squash on the forge whatever the spelling, once applied |
| 7b only the reviewer persona merges | gap | needs the calling agent's identity (`agent_type`) |
| 7c merge only on a verdict at the current head | gap | needs the pull request's state |
| 5c/5d only the owner opens work | gap | needs `agent_type` |
| 5e copy personas post nothing public | gap | needs `agent_type` |
| 8 `$(…)`, backticks | gap | a composition form, not an act; the runtime already asks for approval (measured in the plugin) |
| 8 a `VAR=x` prefix | gap | same |
| 8b a redirect that creates a file | gap | same |
| the `bash -c '<payload>'` unwrap | gap | a prefix sees only `bash` |

**The four rule-7 rows marked "overlay" are owner-specific, so they sit in `overlay/deny-floor.conf`,
not in the generic floor** (11 entries): they encode his rule that a merge to the trunk is the deploy. An adopter who pushes to `main` himself leaves the overlay
out. The rows that need `agent_type` or a pull request's state are the method's, not the floor's
(ADR-0014); when the plugin drops its guard (#63), they survive only as instructions, and the method
slices (#61) have to carry them. **No hook was added** (PRD section 4a, hook budget zero).

**Counts after this amendment.** Generic floor: 101 `cmd` and 7 `file` entries, 115 Claude Code rules
and 101 Codex rules (was 101 and 87). With the repository overlay: 126 Claude Code rules, 112 Codex
rules. Computed by the test suites from the sources, not typed:
`awk '$1 == "cmd" { n++ } $1 == "file" { n += 2 } END { print n }' global/deny-floor.conf overlay/deny-floor.conf`.

**New over-matches, accepted as the price of a prefix:** `gh workflow run` is denied for every
repository, including one whose workflow only lints; `git worktree remove --force` is denied on a
clean but locked worktree; `git push --follow-tags` is denied even where no release follows a tag.

### Never squash: the delivery route and the repository settings standard

- **`workspace/delivery.py merge`** now merges with `gh pr merge <n> --merge --match-head-commit <head>`.
  `delivery_test.py` fails if `--squash`, `-s`, `--rebase`, `--auto` or `--admin` returns, or if a second
  merge spelling appears in the file; mutation-checked (restoring `--squash` turns it red). `verify`
  needs no change: it checks that the merge commit is contained in the release tag, which a merge
  commit satisfies, and it matches the version workflow run by the pull request's head SHA, which a
  merge does not change.
- **`global/github-repo-settings.json`** declares the standard: `allow_merge_commit: true`,
  `allow_squash_merge: false`, and `allow_rebase_merge: false` (a rebase merge also rewrites the
  branch's commits and leaves no merge commit). **`global/github-repo-settings.sh --check|--apply
  OWNER/REPO`** reads or applies it with `gh api`; a setting it cannot read (a token without admin
  rights) counts as a difference, never as a match. Tested against a stub `gh`
  (`global/github-repo-settings.test.sh`, in CI). **Not applied to any repository by this change**:
  applying it is the owner's act, and the floor itself denies `gh api --method PATCH` to agents.
- **Account level.** No account-wide merge-method setting for a personal GitHub account was found in
  the documentation (*assumed* absent). What GitHub does document is a ruleset rule, "Require a pull
  request before merging", that can restrict the allowed merge type for the targeted branches
  (*documented*, "Available rules for rulesets"); for an organization, rulesets can span its
  repositories. Neither is applied or rendered here.

### Evidence

| Claim | Level |
| --- | --- |
| A user-level deny is dropped by `--setting-sources project` (Claude Code 2.1.289) | **measured**, table above |
| The file-based managed source is still read under `--setting-sources project` | **measured**: in a throwaway home with no user and no project settings, the flag set, the owner's installed admin drop-in still fired its `SessionStart` and `UserPromptSubmit` hooks. That shows the source is loaded, not that its deny list is obeyed |
| A managed `permissions.deny` denies a command | **documented** (managed settings override user and project; deny from any layer wins). **Not measured**: a managed file needs root, and a per-command deny needs a model call, which needs a login. The hidden `--managed-settings` flag is not a substitute: a deny passed through it did not remove `Bash` at all |
| The rendered 126-rule deny list loads in Claude Code without a settings error | **structural**: loaded through `--settings` in a throwaway home; no settings error, `Read` and `Bash` listed |
| The admin prefix rules forbid what they name | **measured on the token lists, not on the admin path**: the suite turns them into a `.rules` file and `codex execpolicy check` forbids `gh workflow run deploy` and `git push --force origin x` and leaves `git push origin feature/x` alone. No override exists to load `/etc/codex/requirements.toml` from a throwaway root, so loading from the admin path is **documented** only |
| `install-managed.sh` renders, validates, hashes, installs and checks both admin documents | **tested** in throwaway roots (`global/install-managed.test.sh`); the validator was mutation-checked under Python 3.13 (a `prompt` decision, a dropped rule, an empty or missing deny list and an extra key each fail) |
| `install.sh --check` reports the carrying layer | **tested** (`global/install.test.sh`, section 16), including an incomplete admin copy on each side |
| Installed on the reference machine | **no**. The owner's `sudo` act; [runbook](../runbooks/deny-floor-admin-layer.md) |

### Consequences

- Good: once installed, no session flag an agent can type drops the floor in Claude Code or Codex.
- Good: one source and one stage: the admin copy cannot drift from the user copy, and the stage hash
  binds it.
- Good: the plugin's irreversible-action rules no longer depend on a hook that a project can disable.
- Bad: the 12 gaps above stay gaps. The ones that need an agent's identity or a pull request's state
  leave with the plugin's guard unless the method carries them as instructions.
- Bad: a misfiring admin rule cannot be removed from the user layer. It needs the owner's `sudo`
  (`install-managed.sh --uninstall` prints the line, or he edits the source and re-installs). That is
  the intended exception path under the owner's constraint above: no waiver and no expiring switch
  for the floor. A deny rule denies one command, never a read tool, so it cannot lock a session out.
- Bad: two copies coexist until the user copy is retired, which the placement rule calls a defect.
  Accepted for the install window, and named so it is not forgotten.
- Bad: Kiro still carries no floor. Its documented admin file applies only to the IDE and the opt-in
  CLI V3 engine (ADR-0027); rendering it is a later slice.
- Version cut (ADR-0002): **minor**. New protection; nothing an adopter had is removed or weakened, and
  the admin copy is opt-in by `sudo`.

## Links

- Issue #4. ADR-0002 (cut policy), ADR-0003 (Kiro access), ADR-0010 (rendering, managed-file marker),
  ADR-0013 (the settings merge this extends), ADR-0014 (purpose boundary, precedence, managed-layer
  hardening).
- `global/deny-floor.conf`, `global/install.sh`, `global/install.ps1`, `global/install.test.sh`.
