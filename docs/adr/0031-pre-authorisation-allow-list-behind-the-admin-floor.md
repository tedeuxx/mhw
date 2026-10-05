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
   `global/allow-list.conf` holds `narrow` (read and inspect) and `wide` (build on a feature branch,
   run tests, comment on the tracker) entries. `install.sh` renders the wide tier for a harness only
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

Option 1. Per harness:

| Harness | Carrier (written) | Narrow tier | Wide tier (admin floor complete) |
| --- | --- | --- | --- |
| Claude Code | `permissions.allow` merged into `~/.claude/settings.json` (union, ownership recorded under `personal-multi-harness-workstation-configuration-owned-allow`); `permissions.defaultMode` only when the owner set none | 20 `Bash(...)` rules; no mode | 37 rules (adds commit, branch creation, fetch, worktree add, issue/PR comment, `./workstation install`, eight test runners); `acceptEdits` |
| Codex | `~/.codex/rules/workstation-allow-list.rules` (`decision="allow"` prefix rules) and `~/.codex/workstation.config.toml`, a profile used with `codex --profile workstation` | 20 allow rules; `approval_policy = "on-request"`, `sandbox_mode = "read-only"` | 29 allow rules (no test runners); `workspace-write` |
| Kiro | `~/.kiro/agents/workstation.json`: `allowedTools: ["fs_read"]`, `toolsSettings.execute_bash.allowedCommands` | 20 anchored patterns that refuse `;`, `&`, `|`, `<`, `>`, `$`, backtick, parentheses, braces and newlines | **never**: Kiro carries no deny floor (ADR-0016), so it has no barrier to widen behind |

**The installer refuses an allow entry that is a word prefix of a floor entry, or that a floor entry
covers.** The first would pre-authorise a family the floor denies only in part; the second could never
apply. That is why `git push` is absent (next section).

**Order.** With the admin floor incomplete for a harness, the narrow tier is rendered and one line says
so. With it complete, `--check` notes that install would widen, without failing. A wide list installed
while the admin floor is absent is **drift**: `--check` exits 1 and install narrows it. The errors run
toward narrowing, and both directions are printed.

**`./workstation status`** prints one line: the Claude Code permission mode in effect (the first
`permissions.defaultMode` found, admin first, then project local, project, user), the user-level allow
count, the Codex profile's sandbox mode and allow-rule count, and the Kiro trusted-command count.

### Gaps, stated

- **`git push` is not pre-authorised.** The floor denies only some spellings of pushing to the trunk or
  tags. `git push -u origin main` and `git push origin main:main` match no floor entry, so an allow
  would let them run without a prompt. Pushing stays a prompt until the trunk is protected by a control
  that does not depend on spelling.
- **Codex has no default-profile selector here.** Codex 0.160.0 refuses `--profile` while `config.toml`
  holds a `[profiles.*]` table or a top-level `profile =` line ("legacy"), so the profile is a separate
  file and the owner opts in per session with `--profile workstation`.
- **A Codex `allow` rule may run the command outside the sandbox.** Test runners are left out of the
  Codex rules for that reason; they run inside `workspace-write` without a rule. Whether every allowed
  command escalates was not measured.
- **Per-agent tool lists** (the second ask on #83) are not rendered here: they belong to the agent
  definitions (#61, method rendering). Codex custom agents have no per-agent tool list (#55 matrix).
- **Windows:** `install.ps1` renders no allow list yet.
- **Test runners execute project code.** `npm test`, `make test` and the like run whatever the project
  defines; pre-authorising them trusts the project. No floor sees a command a script runs (ADR-0016,
  "What a deny cannot do").

## Consequences

**Good.** Routine inner-loop work stops asking; the barrier is the admin floor, as the owner ordered.
One source, three native carriers, no hook. The narrow tier keeps the convenience safe on a machine
without the admin layer. Every entry is checked against the floor before anything is written.

**Bad.** The prompt layer is weaker by design on a machine with the admin floor: commits, comments and
test runs go through without a human. A wide list can outlive the admin floor until the next install.
The Codex profile is opt-in per session. Kiro gains only reading.

## Evidence

| Claim | Level | How |
| --- | --- | --- |
| Narrow without, wide with the admin floor; drift when it goes away; refusal of floor-overlapping entries; owner rules and mode kept; uninstall removes only ours | **tested** | `global/allow-list.test.sh`, throwaway homes and a throwaway admin root (`install-managed.sh --root`); mutation-checked on the source (below) |
| Codex: a forbidden rule beats an allow rule whatever the file order | **measured**, Codex 0.160.0 | `codex execpolicy check` with two rules files, both orders: `{"decision":"forbidden"}`; the suite checks every floor prefix against the rendered files |
| Codex loads the profile file | **measured**, Codex 0.160.0 | `codex --profile workstation debug prompt-input` in a throwaway `CODEX_HOME`: the prompt states `sandbox_mode` is `workspace-write`; without `--profile`: `read-only` |
| Claude Code loads the rendered permission mode | **measured**, Claude Code 2.1.289 | `claude -p --output-format stream-json --verbose --setting-sources user` with a throwaway `HOME` and `CLAUDE_CONFIG_DIR`: `init` reports `permissionMode: "acceptEdits"` |
| An allowed command runs without a prompt, and a floor command is still blocked with the allow list present, in a live Claude Code or Codex session | **not measured** | needs a model call, so a login in the throwaway configuration; agents were not given the owner's credentials or Keychain. Precedence is documented (Claude Code: deny from any layer wins) and was measured for a project allow against a user deny in ADR-0016 |
| Kiro loads the agent file and honours `allowedCommands` | **documented** only | `kiro-cli` needs a login (#55 matrix); the patterns themselves are tested with Python's `re.fullmatch` |

**Mutation check (source, never the test).** Each mutant turned the suite red; an unmutated control
stayed green: removing the floor-prefix refusal (1 red), forcing the Claude Code tier wide (4), forcing
the Codex tier wide (2), opening the Kiro argument tail to `.*` (1), putting `git push` in the source
(24), keeping a mode the installer set when narrowing (1).

## Links

- [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md): the deny floor and its admin copy.
- [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md): the admin layer.
- [ADR-0029](0029-provenance-stamp-in-every-installed-file.md): the stamp every rendered file carries.
- [Native enforcement matrix](../native-enforcement-matrix.md): carriers per harness.
