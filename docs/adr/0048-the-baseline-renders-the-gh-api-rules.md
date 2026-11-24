# ADR-0048: The baseline renders the `gh api` rules; the floor's write-method denies and `mhw milestone` leave

- **Status:** proposed (the floor change is the owner's decision of 2026-11-23; the rule set below is
  the agents' rendering of it, for his ratification)
- **Date:** 2026-11-24
- **Deciders:** the owner (written by agents-lead)
- **Amends:** [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md) (the eight `gh api` write
  entries leave the floor) and [ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md)
  (the `route` kind's one member, `mhw milestone read`, leaves the allow list)
- **Issue:** [#593](https://github.com/tedeuxx/mhw/issues/593) (slice 7a of the
  [CLI native baseline PRD](../mhw-product-requirements-document-cli-native-baseline.md), section 5)

## Context and problem

`mhw milestone read|create|update|close` existed because `gh` has no milestone subcommand and a raw
`gh api` write was denied twice: by the floor's eight method-first prefixes (`gh api -X POST`, …,
`gh api --method DELETE`) and by the owner's own hand-kept `Bash(gh api:*)` deny in
`~/.claude/settings.json` (mhw#242). The command reached the write API only because no permission rule
reads inside a program, which its own header called a hole. The PRD (section 5) removes the command:
the method skills call `gh api` themselves, and a native rule allows the milestones endpoint.

A deny beats an allow in every harness this repository renders to, so an allow for the milestones
endpoint cannot work beside a deny that matches the same command. In planning poker both estimators
raised it, and the owner decided, on 2026-11-23:

- *«Abrir o deny»* ([comment](https://github.com/tedeuxx/mhw/issues/593#issuecomment-7108759116)):
  remove the `gh api` write-method denies from the floor and allow the milestones endpoint;
- *«Mover para o baseline»* ([comment](https://github.com/tedeuxx/mhw/issues/593#issuecomment-7109429072)):
  mhw manages the `gh api` rules itself, the same in the three harnesses, and
  install retires his hand-kept `Bash(gh api:*)` entry with a backup.

**This weakens the policy floor, by the owner's decision.** The eight entries leave
`global/deny-floor.conf`, the source of every layer the floor renders to: the user settings, the Codex
floor rules, the Kiro floor and the admin layer, where no session flag could drop them. What replaces
them is user-level only. (What stays on a machine already installed is in the decision outcome.)

## Decision drivers

- The milestone acts of the rites (create, read, update, close) run without a reviewed hole.
- The owner's rule set, in his words on the Issue: `gh api` reads pass; writes are denied except the
  milestones endpoint.
- Report what a prefix rule can hold, per harness, and name what it cannot.

## Considered options

1. **The baseline renders a `gh api` rule set at user level, and the skills spell the endpoint first
   (chosen).** The milestone writes are written `gh api repos/<owner>/<repo>/milestones[/<number>] -X …`.
   The rule set denies the method-first write spellings and allows the milestone family. Because the two
   spellings differ in their first word after `gh api`, the deny never matches a milestone command the
   skills write, so the allow works beside it. *Trade-off:* a write spelled endpoint-first to another
   endpoint matches neither and is asked, not denied; and the method-first denies are user-level now,
   not in the admin layer.
2. **Keep the floor's eight entries and only add the allow.** A milestone write spelled endpoint-first
   is not caught by them either, so this would have worked too and kept the admin layer. *Rejected:* the
   owner decided to open the deny, and the brief of this slice carries that decision; this record names
   the alternative so a later reader sees it was available. **What his decision changes in effect, said
   plainly for his ratification:** option 1 renders the same method-first spellings again, at user level,
   because his rule set says writes are denied except the milestones endpoint. So a method-first write
   stays denied (not asked, as his first comment on the Issue foresaw); what leaves is the admin-layer
   copy, and his broad deny.
3. **Render no method-first deny at all, so every write except the milestones is asked.** The literal
   reading of the first comment (*"other gh api writes go from denied to asked"*). *Rejected* for the
   later rule set in the Issue body (*"writes are denied except the milestones endpoint"*), which option
   1 holds for the spellings a prefix can reach. Taking the four `deny-method` lines out of
   `global/gh-api.conf` turns option 1 into this one.
4. **Keep `mhw milestone`.** *Rejected* by the PRD: the command was a program the permission layer
   cannot see into.

## Decision outcome

**The floor.** The eight `gh api -X|--method POST|PUT|PATCH|DELETE` entries leave
`global/deny-floor.conf`. ~~The Claude Code settings merge and the Kiro floor never remove a rule an
earlier install appended, so on an upgraded machine the eight stay there until uninstall~~ *(struck in
this slice: the PROD canary's upgrade run showed the eight then stayed unrecorded in `settings.json` and
survived uninstall, and kept the Kiro file from equalling the floor)*. Since #593 an install removes a
floor rule it had recorded as its own once that rule leaves the floor: from `permissions.deny` in the
Claude Code settings, and as a pattern of the Kiro rule mhw appended. A rule the owner wrote is never
touched, and a settings file stamped before the ownership record existed removes nothing. The Codex
floor rules file is rendered whole and loses them. What `mhw install-admin` does with a rule that left
the source was not checked in this slice; the canary's admin checks, which compare the throwaway admin
root with the floor, passed on the upgrade run.

**The rule set's source is `global/gh-api.conf`**, beside the floor and the allow list, a closed grammar
(`deny-method`, `allow-endpoint`, `retire-deny`, each with a closed set of values in
`src/render/gh-api.js`; anything else refuses the step before it writes). `mhw install-user` hands it to
the allow-list step whenever the file is there, and the step renders it in every tier (narrow and wide),
because the owner's rule set is not tier-dependent and Kiro is rendered narrow only. The source file gets
the same `Edit` deny as the allow list, since taking a `deny-method` line out of it weakens the set. A tree
without the file renders none of it, which is how the installer goldens recorded from frozen sources stay
valid:

| | Claude Code | Codex | Kiro |
| --- | --- | --- | --- |
| milestone family (read and write, endpoint first) | allow `Bash(gh api repos/*/milestones*)` | **no rule** | allow: an anchored CLI 2.x pattern and a V3 match list |
| write, method first (`-X POST`, `-XPOST`, `--method POST`, `--method=POST`, and PUT, PATCH, DELETE: 16 spellings) | deny | forbidden | **no rule**: asked |
| write, endpoint first, to another endpoint | asked | no rule | asked |
| any other read | asked | no rule | asked |

"Asked" is the harness's own decision for a command no rule allows. On Codex, "no rule" leaves the
command to the sandbox and the approval policy of the profile in use.

**What "reads pass" means here.** No rule of the set denies a read. Only the milestone reads are
pre-authorised; any other read is asked, because `gh api <endpoint> -f key=value` switches to `POST`
without a method flag: a prefix allow on `gh api <endpoint>` would admit that write too.

**The retirement.** Install removes exactly `Bash(gh api:*)` from `permissions.deny` in
`~/.claude/settings.json`, keeping the previous file as `settings.json.pmhwc-gh-api-backup` (owner-only).
It never overwrites that backup: when it already exists and the entry is there again, install refuses,
leaves the entry and says so; the milestone allow then has no effect. `check` reports the entry as drift;
a dry run says what it would change. Uninstall adds the entry back to `permissions.deny` when the backup
holds it, then removes the backup. Any other spelling of a `gh api` deny the owner wrote stays.

**`mhw milestone` leaves the CLI**: it is an unknown subcommand like any other. `global/allow-list.conf`
carries no `route` entry. The installer still accepts the kind's one member, `mhw milestone read`, only so
the inputs recorded from the deleted shell step still parse; such an entry would match an unknown
subcommand. The installed package directory keeps its `Edit` deny.

**The skills** (`sprint-planning`, `sprint-retrospective`, `agents-configuration`, `new-issue`) carry
the procedure: list before create and refuse a duplicate title; the description only through
`-F description=@<file>`; read the milestone again just before an update and stop when its description
differs from the one the update was composed against (the expect-before-update guard of the old command,
now an instruction: no mechanism compares the two, and like the old one it is a preflight, not
compare-and-swap); read before a close and close only an open milestone.

## What the rules hold, and what they do not

Measured where a harness offers an instrument; modelled otherwise, and said which.

- **Codex: measured** with `codex execpolicy check` (codex-cli 0.163.0, on the rules file the step
  rendered into a throwaway home, 2026-11-24): every row of the test's table gave the expected
  decision, the method-first writes `forbidden`, a milestone call spelled endpoint first and a read no
  rule. `test/render/gh-api.test.js` runs that check whenever `codex` is on `PATH`, beside the model;
  where it is not (whether a CI runner carries it was not checked), only the model runs.
- **Claude Code and Kiro: modelled, not measured** in a running session. The test evaluates the rendered
  files with a model of each matcher (deny before ask before allow; `:*` a token boundary; `*` any text;
  Kiro's CLI 2.x patterns as regular expressions).
- **The Claude Code allow is wider than the milestones endpoint.** Its `*` crosses spaces and slashes, so
  `gh api repos/o/r/issues -f body=x/milestones -X POST` matches it and runs without a prompt. The Kiro
  V3 match list has the same width; the Kiro CLI 2.x pattern pins one owner/repository pair and an
  optional number. The test names both.
- **A milestone write spelled method first is denied** in Claude Code (the deny beats the allow) and
  forbidden in Codex. The skills spell the endpoint first; the test names the denied spelling.
- **Asked is not a person.** Under Claude Code's auto mode a command no rule decides goes to the
  auto-mode classifier, not to a prompt the owner answers; the `scm` skill records a hook `ask` that ran
  with no prompt there, and a settings `ask` in auto mode on the current build is not measured
  ([ADR-0040](0040-presence-conditioned-secret-renewal-through-the-browser.md)). An endpoint-first write
  to any endpoint, and any write on Kiro, reaches that decision, where before the owner's broad rule
  denied it.
- **Not caught by any rule:** a lower-case method (`-X post`), a method after another option
  (`gh api -H x -X POST …`), `-f`/`-F`/`--input` with no method flag (gh then sends POST), GraphQL
  mutations (`gh api graphql -f query='mutation …'`), and `gh api` run inside a script or another
  program.
- **Windows** renders no allow list (ADR-0031), so there the rule set and the retirement are not
  rendered; the floor's eight entries are gone there too.

## Consequences

- Good: the rites' milestone acts run through `gh api` with no program in between; the owner's rule set
  is rendered and versioned instead of hand-kept; the hole `mhw milestone` relied on is gone.
- Bad: the floor is weaker: the eight write entries leave the admin layer; an endpoint-first write to
  any endpoint goes from denied (by the owner's broad rule) to asked; a write through `-f` with no method
  flag was never caught and still is not; Codex has no pre-authorised milestone act; the Claude Code
  and Kiro V3 allow admit a crafted write whose text carries `/milestones`; the narrow tier, read-only
  until now, pre-authorises one write family, the milestones.

## Links

- [#593](https://github.com/tedeuxx/mhw/issues/593), [#242](https://github.com/tedeuxx/mhw/issues/242),
  [#475](https://github.com/tedeuxx/mhw/issues/475), [#537](https://github.com/tedeuxx/mhw/issues/537)
- [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md),
  [ADR-0031](0031-pre-authorisation-allow-list-behind-the-admin-floor.md)
