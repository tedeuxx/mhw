---
name: "shell"
description: "Apply the platform's working-files and shell discipline in any `<project>` repo — where scratch files go, one atomic Bash call per invocation, the `gh --repo` flag position, and `--body-file` for any multi-line PR/issue body. Use whenever a persona writes a working file, runs a shell command, or composes a PR/issue comment. Not for the loop's state machine (see agents-configuration) or what a merge verdict must contain (see quality-gates)."
purpose: "state the working-file and shell discipline once, because the same procedure copied into every brief is exactly what a preloaded skill exists to remove"
---

> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).** This
> text moved from the `tadeumendonca-skills` plugin. Where it names a plugin hook, guard rule or test
> (`hooks/…`, `permission-guard.sh` and its numbered rules, `mcp-guard.sh`, `inventory-counts.test.sh`
> and the like), it describes that plugin; **none of those runs in this method**. Read any rule they
> held as an **instruction you follow**. What is still mechanical, where the workstation installed it:
> the **deny floor** (native deny rules by command prefix — force-push, `git reset --hard`, recursive `rm`, `git clean -f`,
> squash merge, secret writes, `gh api` write methods, `gh repo delete`/`archive`/`rename`, releases and
> package publishing, `terraform apply`/`destroy`, `sudo`), and **each agent's own tool list**, which is
> native in Claude Code and Kiro and an instruction in Codex. The session checks that replaced the
> plugin's reporting hooks are in `agents-configuration`, *Session-start and end-of-turn checks*.

Apply this working-files and shell-command discipline in any `<project>` repo, for any persona dispatched
into it.

Context: $ARGUMENTS

## Why this is one skill, and why it is now called `shell`

**Renamed from `command-hygiene` at #384**, on the owner's ruling — *«entao nomeie como shell
apenas»* — during the pass that put every distributed mechanism to him one at a time. The content did
not change; the identifier did, because *hygiene* names a virtue and *shell* names the object.

**One mechanism difference is NOT renamed away, and it is the part worth knowing if this file is read
on other machinery:** in the plugin, **part of** the discipline was **enforced** — its retired
`permission-guard.sh` denied `$(...)`/backticks, `VAR=x` prefixes and a redirect that creates a file.
**No hook does that in this method (#61).** What still stops for a human is the agent harness's own
permission matcher, measured below; the rest of this file is an instruction you follow. ~~denies chained commands, stdout redirects and `2>/dev/null`
outright~~ — **struck 2026-09-05 (#383): the chain branch is removed and a `/dev/null` target is
exempt, both measured. See the table below.** The atomic-call preference is an instruction here too.
On a harness without that guard the same file is an instruction only, and a
reader who takes the confident tone as evidence that something is stopping them will be wrong.

Two behaviors — where scratch files go, and how a shell command avoids tripping the permission matcher —
were independently restated, near-verbatim, in all five agent briefs the roster held at #225 (a content
drafter landed later that same day, making six; its reviewing pair at #317, making seven). A real skill is preloaded once and referenced; the same
procedure copy-pasted into five files is what it looks like when that fails (#225). Both behaviors are transversal — every persona that writes a file or runs `Bash` needs
them — so they're one preload, not a per-persona restatement.

## Working files — where they go

**Every scratch file a persona writes goes in the session scratchpad** — the path the harness hands you
at session start, session-specific and outside every tracked tree — for commit messages, PR/issue
bodies, drafts, verdict text.

**There used to be a repo-root `<repo-root>/.scratch/` directory here instead, retired at #245.** It
existed on the belief that WHERE a scratch file lived affected permission friction; #244 measured
directly that it does not — the friction was always the shell-redirect pattern used to write the file,
not its destination, and that is now denied mechanically regardless of location (see "Never redirect
stdout" below). Carrying a repo-side scratch directory bought nothing that fix didn't already buy, and
cost a sweep hook (`session-scratch.sh`) and a rule that lived only in agent-brief prose — exactly the
shape a preloaded skill exists to remove. If a brief still names `.scratch/`, that is stale and should be
fixed to point here instead.

**`Write` is the route — never a shell redirect (`>`/`>>`) into a stub file.** An `Edit` onto a file that
already exists is the other valid route where `Write` doesn't fit. If the file cannot be written by any
tool-granted route available, that is a posting failure to report as one — not a reason to fall back to
an inline argument that strips backticks and `$`, and not a reason to reach for `>` because it is
quicker.

## Command hygiene — what actually stops for a human, and what never did

**The permission matcher is ELEMENT-WISE across a composition. That is the fact this section is built
on, and it was measured rather than read.** A composition is decomposed and each element evaluated on
its own; the call is approved when every element is approved, and stopped — naming the offending
element — when one is not. Measured 2026-09-05 against build 2.1.261, in a nested session carrying
this platform's guard **minus** its composition rules, with every verdict confirmed on disk rather
than taken from the session's own report:

| payload | result |
|---|---|
| `mkdir <A> && mkdir <B>` — both allowlisted | **executed, no prompt** |
| `mkdir <A> ; mkdir <B>` — both allowlisted | **executed, no prompt** |
| `mkdir <A> && mkdir -p <B>` — second in `deny` | **whole call denied**, neither directory created |
| `mkdir <A> && touch <B>` — second in neither list | stopped: *"What required approval: touch in `<B>`"* |
| `mkdir <A>-$(basename /x/y)` | stopped: *"What required approval: Contains command_substitution"* |
| `FOO=1 mkdir <A>` | stopped, naming `mkdir` — although bare `mkdir <A>` executed |
| `cmd 2>/dev/null` · `cmd >/dev/null` · `[[ zzz > aaa ]]` | **executed, no prompt** |
| `cmd > file` · `cmd 2> file` | stopped: *"Output redirection to `<file>`"* |

~~Do NOT chain with `&&` / `;` / pipes … the permission matcher can't decompose a compound.~~
**STRUCK 2026-09-05: the first clause is false and had been the whole reason for the rule.** A chain
of allowlisted commands does not prompt; a chain carrying an unapproved element is caught anyway, by
the element. On this platform the chain deny was removed for exactly that reason, and it is struck
rather than deleted because every persona here wrote its commands to it for months.

**What still stops for a human, and is therefore still worth avoiding:**

- **`$(...)` and backticks.** Flagged by name, whatever the command is.
- **`VAR=x cmd` env-var prefixes, including the measured post-statement form.** The
  prefix defeats the allow entry, which is a different mechanism from decomposition and the reason
  this bullet is separate. Prefer the repo's own scripts (`npm --prefix <app> run <script>`) over an
  inline env-prefixed command.

  **The position clause is #438's, and it was a measurement rather than a tightening of tone.** The
  runtime decomposes the tested composition and stops the prefixed element, naming it —
  measured on build 2.1.267 in a nested session carrying this platform's guard with its env-var branch
  removed, each verdict confirmed on disk or in the tool result:

  ```
  wc -l <f>                 allowlisted    -> EXECUTED
  FOO=1 wc -l <f>           same command   -> "This command requires approval"
  true; FOO=1 wc -l <f>     POST-STATEMENT -> "…The following part requires approval: FOO=1 wc -l <f>"
  true; touch <f>           calibration    -> EXECUTED  (the leading statement alone is harmless)
  ```

  **An `=` in ARGUMENT position is a different thing** — `terraform plan -var foo=bar`,
  `make FOO=1 target`, `npx playwright test --grep=smoke`. These are not env prefixes.

  **The guard recognizes only a bounded language of simple compositions for the added check.** The
  whole original string must contain only plain ASCII words, blanks, simple subshells and the listed
  separators (`;`, `&&`, `||`, `|`, `&`). Quotes, escapes, comments, newlines, redirections, expansions,
  globs, arrays and arithmetic are outside that language. It never searches a heredoc body or comment
  for a command position. Even real later prefixes in `echo "ok"; BAR=2 cmd` or
  `((FOO=1)); BAR=2 cmd` therefore abstain in the extension. The original leading predicate still
  uses the existing quote collapse and remains independent; other rules still run. The suite measures
  guard decisions, not a runtime subset for untested forms. Where the extension abstains, the runtime
  decides and may still require a human.

  **On this platform the enforcement matched the leading spelling only, until #438.** A rule whose
  incidence depends on how the author phrased the command rather than on the act is not a rule about
  the act — and on a harness with no such guard the whole bullet is an instruction anyway, so read the
  position clause as a fact about the runtime and the enforcement note as a fact about here.
- **A redirect that CREATES a file** — see the `>` rule below.

**Prefer one atomic command per call anyway, and know that the reason changed.** It is now a
legibility and attribution preference — one call, one verdict, one thing to read in a transcript —
not a permission necessity. Where a chain is genuinely the clearer expression, it costs nothing.

**`git -C <dir>` and `npm --prefix <dir>`, never `cd X && …`.** The workspace root is not a repository
itself in a multi-repo layout, and a `cd` compound risks leaving a shell in the wrong directory for the
next call. ~~and a `cd` compound both chains commands (tripping the rule above)~~ — struck with the
rule it cited; the directory reason is the one that survives and it is sufficient on its own.

**Target another repo with `gh <subcommand> --repo <owner/repo>`, never `gh -R <owner/repo> <subcommand>`.**
The permission matcher reads a command **prefix**, and an allowlist is typically spelled per-subcommand
(`Bash(gh issue view:*)`); a flag placed *before* the subcommand changes the prefix to `gh -R`, which
matches none of them — a working, read-only command that stops for a human over its punctuation alone.
Put the flag after the subcommand and it matches.

**Never redirect stdout to create a file (`>`/`>>`) — mechanically enforced (#244), not advisory.**
`command > path` prompts a human regardless of destination — `.scratch/`, the session scratchpad,
anywhere — and regardless of whether `command` itself is allowlisted; measured directly, repeatedly, in
this session (`git show … > file`, `gh pr diff … > file`, a generator script's own stdout). Guidance
alone did not hold — the pattern kept recurring after it was already diagnosed — so the plugin's
retired `permission-guard.sh` denied it outright. **That hook is gone; the rule is now an instruction,
and the agent harness's own prompt is what still stops a file-creating redirect.** Two routes cover everything `>` was used
for: content the agent is composing itself goes through `Write`; content that is a command's own stdout
is obtained by running the command *without* the redirect (the output already returns to the caller) and
`Write`-ing it from there if it needs to persist. `2>&1` / `1>&2` / `>&2` (redirecting one stream to
another) are unaffected — they create no file.

**And a `/dev/null` target is unaffected too, because the runtime's own check is DESTINATION-AWARE.**
Measured 2026-09-05 in the same rule-less session: `cmd 2>/dev/null` and `cmd >/dev/null` ran with no
prompt, while `cmd 2>somefile` stopped for a human naming that file. `[[ a > b ]]`, bash's string
comparison, ran untouched. Those three were being denied by this platform's guard and by nothing else,
which is a control that only ever over-blocks; both are exempt since #383. **Both exemptions are
narrow, and the bound is measured rather than assumed:** a target merely *beginning* `/dev/null`
(`date > /dev/nullx`, `date > /dev/null/../x`) and a `[[ … ]]` span in *argument* position
(`echo x [[ a > /tmp/evil ]] b`, a real redirect in bash) are **not** exempt — the runtime required
approval for all three on build 2.1.261, so exempting them would have put this hook *above* the layer
it is supposed to sit under.

**Two bounds on that paragraph, both measured on 2026-09-05 and both in the permissive direction.**
The `/dev/null` exemption first shipped requiring whitespace or end-of-string after the target, so
`cmd >/dev/null;cmd2`, `… &&cmd2`, `(cmd >/dev/null)` and `… 2>/dev/null|cmd2` were denied although
none creates a file; the trailing class now carries the shell separators too, and `date >/dev/null;touch m1`
was confirmed **executing with no prompt** on build 2.1.261 with this hook absent. And the `[[ … ]]`
bound above is **false for one subset of argument position**: the strip's keyword alternative is not
itself position-checked, so `echo x do [[ a > /tmp/evil ]] b` — any of `if|while|until|elif|then|else|do`
immediately before the span — reaches ALLOW even though it is a real redirect. That is left rather than
fixed, because the narrowing that would fix it denies a multi-line `if … / then / [[ … ]] / fi`. It is
safe in the direction that matters and it is stated rather than left to be discovered: the runtime
stopped that payload with *"Redirect has multiple targets"*, so the hook fires on **less** than the
runtime, which is the side of the rule below that costs an instruction and never a block.

**The general rule the fix
follows is worth more than the fix: a hook that exists to turn a prompt into a self-correcting
instruction must fire on a SUBSET of what the runtime stops for, never on more.** Where it cannot tell,
it should abstain and let the layer that parses shell decide.

## `--body-file`, always, for anything longer than one line

**Get the content into a file in the session scratchpad, then post it with `--body-file <path>`** — `gh pr comment`,
`gh pr create`, `gh issue create`, `gh issue comment`, any command taking a `--body`/`--message` flag with
multi-line or backtick-bearing content. This has no per-case exception: backticks and `$` are silently
eaten from an inline `--body` string by shell interpolation, and this platform has paid for that failure
more than once in a single session before the rule was written down. `--body` is not a fallback — if the
file genuinely cannot be written by any route, that's a posting failure to report as one, not a prompt to
start deleting characters until the inline command survives the shell.

## Using this skill

Preload this in any persona's `skills:` list that writes files or runs shell commands — which, in
practice, is every persona in the roster. When a brief's own prose restates any of the three behaviors
above, that's duplication this skill exists to remove; the brief should cite this skill instead of
re-deriving the rule.
