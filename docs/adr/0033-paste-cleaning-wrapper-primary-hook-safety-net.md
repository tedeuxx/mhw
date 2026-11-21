# ADR-0033: Paste cleaning: the wrapper cleans first, the prompt hook is the safety net

- **Status:** ~~proposed~~ accepted (2026-11-17, the owner's ratification recorded on [Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6962031588); see the amendment "2026-11-17: accepted" below). The requirement is the owner's (accepted, carried from ADR-0011); the choice
  of the wrapper as primary and the hook as safety net is his decision on #58 (2026-10-05). ~~The
  mechanism details below await ratification.~~
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Supersedes:** [ADR-0011](0011-clipboard-prompt-anonymisation.md), whose original decision (an
  always-on clipboard watcher) was withdrawn and whose current mechanism lived only in three amendments
- **Issue:** [#65](https://github.com/tedeuxx/mhw/issues/65)
  (consolidation); the decisions are on [#5](https://github.com/tedeuxx/mhw/issues/5)
  and [#58](https://github.com/tedeuxx/mhw/issues/58)

## Context and problem

The owner's requirement, verbatim (ADR-0011):

> *"todos prompts em area de transferencia quando processados precisam ser anonimizados e limpados de
> referencias de empregador e clientes."* · *"automaticamente."*

It was narrowed and sharpened on #5:

> *"eu so quero filtrar o copy paste ao interagir com clis de harness"* · *"nao deve impactar nenhum
> outro app ou ux do so"* · *"tem que ser limpo sozinho"*

ADR-0011 records how the mechanism got here: a watcher (withdrawn), then a prompt hook that blocks,
then a terminal wrapper that cleans, then (#58) the wrapper as primary. A reader who opens ADR-0011
meets four hundred lines about a withdrawn watcher before the decision in force. This record states
only the decision in force, so a fresh context does not infer the retired architecture.

## Decision drivers

- Clean, don't ask: a pasted secret should never reach the model (requirements document, sections 2
  and 4).
- Touch nothing outside an agent harness command-line session: no clipboard monitoring, no dialog, no
  OS permission.
- Thin protection: one justified hook at most (hook budget, requirements document section 4a).
- No per-request waiver: a hook is turned off only by an administrator with `sudo` (ADR-0028).

## Considered options

1. **Wrapper primary, prompt hook as safety net for unwrapped sessions (chosen, owner on #58).**
   Trade-off: inside a wrapped session nothing judges typed text, and anyone can set the marker by hand.
2. **Wrapper only, hook removed; the brief tells the agent not to use, repeat or store a pasted
   secret.** No custom hook at all. Rejected by the owner: sessions not opened through the wrapper
   would have no mechanical check, and once a secret is sent the provider already has it.
3. **Hook only, blocking every prompt with a finding (the 2026-10-01 state).** Rejected: a hook cannot
   rewrite a prompt in Claude Code or Codex (documented), so it can only block and offer, which is not
   *"limpo sozinho"*.
4. **The always-on clipboard watcher (ADR-0011's original decision).** Withdrawn by the owner on #5:
   too broad, and it touched the OS clipboard.

## Decision outcome

Chosen: option 1.

- **The wrapper** (`global/clipboard/paste_wrapper.py`) starts `claude`, `codex` or `kiro-cli` on a
  pseudo-terminal and replaces each finding inside a bracketed paste with `[REDACTED:<category>]`
  before the command-line tool sees it. Typed input passes byte for byte. It exports
  `PMHWC_PASTE_WRAPPER=1` only into the tool it relays for, and leaves it unset when a prompt argument
  carries a finding or cannot be checked. The installer writes a snippet of shell functions; activating
  it is the owner's act (a printed guarded line, or `install.sh --shell-rc=FILE`).
- **The prompt hook** (`clipboard_guard.py prompt-hook`, `UserPromptSubmit` in Claude Code, Codex
  `hooks.json`) passes silently when the marker is exactly `1`. Otherwise it blocks a prompt with a
  finding and shows a redacted copy. It lives in the admin layer when that layer is installed
  (ADR-0025), and is turned off only with `sudo` (ADR-0028).
- **One detection core** for both: the owner's client and employer terms as salted hashes (salt in the
  login Keychain, a user-only file as the fallback, added with `add-term` from his own terminal) plus
  five generic categories (credential, e-mail, payment card, CPF, CNPJ; `block_categories` in
  `clipboard.conf`).
- **Coverage, stated:** Claude Code and Codex command-line sessions on macOS and Linux. Kiro CLI is
  wrapped ~~but not measured~~, ~~and has no hook~~. *Amended 2026-10-11:* ~~on the V3 engine the wrapper
  cleans nothing, measured~~; see the amendment "Kiro CLI V3 does not enable bracketed paste".
  *Amended 2026-11-08 (#462):* on `kiro-cli` 3.1.0 the wrapper cleaned a V3 paste, measured; see the
  amendment "the Kiro canary results". Out of reach: desktop apps, IDE extensions, files read by
  path, pasted images, Windows. *Amended 2026-11-08:* Kiro CLI V3 has a user-level hook file; see the
  amendment of that date.

## Consequences

- Good: in a wrapped session a pasted secret never reaches the agent harness, so its transcript and
  history hold only the redacted text (measured in throwaway homes, Claude Code 2.1.289 and Codex
  0.160.0).
- Good: a session not opened through the wrapper keeps the hook, which is the gap the owner kept it for.
- Bad: in a wrapped session typed text, a paste while bracketed paste is off, and anything a descendant
  process submits are not checked.
- Bad: the marker is not a secret; setting it by hand switches the hook off for that session. Accepted
  as *defend the perimeter, not the behaviour*.
- Bad: one custom hook and the admin-layer drop-in remain, with their `sudo` maintenance cost.
- Bad: Codex runs the hook only after the owner trusts it in `/hooks`.

## What this replaced

ADR-0011 decided an always-on macOS clipboard watcher (LaunchAgent, polling, dialog). It was installed
and loaded on 2026-10-01 and withdrawn the same day on the owner's correction; the installer now removes
its leftovers and `--check` reports them as `STALE`. Its detection core (`clipboard_guard.py`, the term
hashes and the salt store) is what this record keeps. The measurements, mutation checks and residuals
of each step remain in ADR-0011's amendments.

## Amendment 2026-10-11: Kiro CLI V3 does not enable bracketed paste (measured gap)

**Observed** in the owner's fresh-session canary on the reference machine, 2026-10-11: `kiro-cli`
2.29.1 started with `--agent-engine v3` through the paste wrapper. The V3 terminal UI never enabled
bracketed paste, so after its grace period the wrapper printed its warning that pastes are **not**
cleaned. That is the behaviour this record designed for a CLI without bracketed paste (fail open,
visibly): ~~every paste into a Kiro CLI V3 session reaches Kiro uncleaned~~ every paste into that
build's V3 session reached Kiro uncleaned. Sessions on the 2.x engine
were not observed in the canary. ~~Kiro has no prompt hook from this project, so on V3 **nothing** checks
a paste.~~ *Struck 2026-11-08 (#462): both claims were true of 2.29.1 and are not current. On `kiro-cli`
3.1.0 the wrapper cleaned a V3 paste (measured), and Kiro now has the hook of the 2026-11-08
amendment. See the amendment "the Kiro canary results".* The README coverage table carries the gap.

**A native carrier exists, read from the bundle and not wired.** The bundled V3 engine (kas 2.29.1,
`@kiro/agent/dist/server/acp-server.js`) loads hook files (`{"version": "v1", "hooks": [{"name",
"trigger", "action": {"type": "command", "command", "timeout"}}]}`) from the workspace's
`.kiro/hooks/` and from a user-level global directory under `~/.kiro/hooks/`. It has a
`UserPromptSubmit` trigger (also spelled `promptSubmit`), passes `{"hook_event_name":
"UserPromptSubmit", "prompt": ...}` on stdin, and treats exit code 2 on that trigger as **block**,
sending the hook's stderr on. The proposal, for the owner: render one user-level hook file there that
runs the existing `clipboard_guard.py prompt-hook` with a Kiro output mode (exit 2 and the redacted
copy on stderr). Hooks are allowed here only for existential risk; a confidentiality breach through a
pasted prompt is that case. ~~**Not wired**~~ *(Amended 2026-11-08: wired, ~~still not measured~~; see the
amendment of that date. Amended again 2026-11-08, #462: partly measured; see the amendment "the Kiro
canary results")*, because each link is read from the bundle and none is
measured: whether the global directory is exactly `~/.kiro/hooks/`, the file suffix it accepts, that
a block keeps the prompt from the model, and where the stderr text goes (to the owner or into the
agent's context; the guard's redacted copy holds no secret, but the owner should see it). A
measurement needs a logged-in Kiro session, which a throwaway home does not have (ADR-0008); the
owner's fresh-session canary is the route. Kiro IDE: the IDE 1.2.56 bundle documents no prompt-submit
hook type for a user scope (ADR-0036), so this proposal does not reach the IDE.

## Amendment 2026-11-01: the detection core has five more categories (Issue #36)

The "One detection core" bullet above lists five generic categories, as they stood then. Since Issue #36 the core also reports `phone`, `postal-address`, `contract-value`, `health` and
`colleague-name`. Health and colleague names are also matched against two private term lists of the
owner's, kept and loaded like the employer and client list (`add-term --list health|colleague-name`).
A new setting, `report_categories`, makes a category report-only: the hook names it and sends the
prompt, and the wrapper forwards the paste and counts it in its session summary. ~~All five block by
default.~~ *Struck 2026-11-01 (gate round 1):* `postal-address` and `contract-value` are report-only by
default; the other three block. The patterns, the false-positive threshold and its measurement are in
[ADR-0035](0035-workstation-blueprint-reconciliation.md), amendment of 2026-11-01 (Issue #36).
*Written and tested*; not installed.

## Amendment 2026-11-08: Kiro CLI V3 gets the prompt hook, built now and measured at the RC (Issue #455)

**Decision (the owner, on #455, 2026-11-08):** build the hook with tests now and measure it in the
release candidate's post-install canary, rather than measure first with a probe hook in his
`~/.kiro/hooks`. Consequence, stated so nothing over-claims: every Kiro link below stays *read from the
bundle* until that canary, and a link that does not hold fails open, no worse than before.

**What is built** (*written and tested* in throwaway homes; *not installed*):

- `clipboard_guard.py prompt-hook --harness kiro`. A finding exits 2 with the block message and the
  redacted copy on stderr; a clean prompt exits 0; **nothing is ever written to stdout**. It **ignores the
  wrapper's marker**: ~~on V3 the wrapper cleans nothing but still sets it~~ on V3 the wrapper still
  sets the marker, and it does not check typed text *(struck 2026-11-08, #462: on 3.1.0 it does clean
  pastes)*; the marker silenced the hook
  (measured on the intake, scenario A). A source mutation that restores the marker short-circuit in this
  mode turns two tests red; restoring the source turns them green.
- **Failure behaviour, chosen:** whatever stops the check (a payload that is not JSON or has no `prompt`,
  an oversized prompt, an unreadable settings file, an internal error) exits 0, so the prompt passes
  unchecked: fail open, as on the other two harnesses. The notice goes to stderr only. Kiro drops stderr
  on exit 0, so **the owner sees no warning** on Kiro; putting it on stdout would send it to the model as
  part of his prompt, which is worse. Report-only categories and the unreadable-salt warning are lost the
  same way.
- `install.sh` renders `~/.kiro/hooks/personal-multi-harness-workstation-configuration-paste-filter.json`
  (`version: v1`, one `UserPromptSubmit` hook, a 30-second timeout, the marker and stamp in its
  `description`). Idempotent; a content change keeps the replaced file as `<file>.pmhwc-backup`, 0600,
  which Kiro does not load (no `.json` suffix); an unmanaged file at that name is refused; uninstall
  removes it. It stays at user level under `--hooks=managed` (no admin layer for Kiro hooks,
  hypothesis F). `mhw status` names it as `paste filter (Kiro CLI V3)`, or `…, modified`, or not at all
  when absent; `--check` reports `OK`, `DRIFT` or `MISSING`. The PROD install canary (#452) asserts it is
  rendered and blocks with the marker set and unset.
- The paste wrapper's "bracketed paste not enabled" warning, for `kiro-cli`, now says whether this hook
  is installed and that Kiro runs it only in a trusted workspace.
- `install.ps1` does not render it: Windows has no paste filter core to run (a stated gap).

**Evidence level per link**, each *read from the bundle* (kas 2.35.2,
`@kiro/agent/dist/server/acp-server.js`; `kiro-cli` 3.1.0 on the reference machine) and **not measured**
*(amended 2026-11-08, #462: the directory, the file and the trigger are now measured; the payload and
the block are measured only at the hook command, outside Kiro; the trust row is overtaken, because an
untrusted workspace opens no session; see the amendment "the Kiro canary results")*:

| Link | Read from the bundle | Not measured |
| --- | --- | --- |
| directory | user hooks dir is `<userConfigDir>/hooks`, and `userConfigDir` defaults to `~/.kiro` | that this session's `userConfigDir` is `~/.kiro` |
| file | every `*.json` file there; schema `{version: "v1", hooks: [{name, trigger, action: {type: "command", command}, timeout?, description?}]}`, timeout in seconds, default 60 | that the file validates and loads |
| trigger and payload | `UserPromptSubmit` (alias `promptSubmit`); stdin is `{…, "hook_event_name": "UserPromptSubmit", "prompt": …}` | that `prompt` arrives as the pasted text |
| environment | the hook process inherits Kiro's environment plus `KIRO_SESSION_ID`, so the wrapper's marker reaches it | that it does in a wrapped session |
| block | exit 2 on `UserPromptSubmit` blocks, and the reason is stderr only; exit 0 appends stdout to the prompt; any other exit or a timeout does not block | that the model never sees a blocked prompt, and where the owner sees the reason (scenario D) |
| trust | hooks run only in a trusted workspace; untrusted logs one info line | that an untrusted workspace runs none (scenario B) |
| engines and surfaces | the V3 engine reads it | the 2.x engine (`--v2`) and Kiro IDE: hypothesis, they do not (scenario H) |

**The measurement** is the owner's canary, after the install, in a fresh session, trusted and untrusted
workspace: [docs/runbooks/kiro-v3-prompt-hook-canary.md](../runbooks/kiro-v3-prompt-hook-canary.md).

## Amendment 2026-11-08: the Kiro canary results (Issues #455 and #462)

The owner ran [the canary runbook](../runbooks/kiro-v3-prompt-hook-canary.md) after installing v10.1.0
(RC #461), on `kiro-cli` 3.1.0 with kas 2.35.2, synthetic payload only (#455). An agent then probed the
installed hook command directly (#462). Each result at its evidence level:

| Claim | Evidence level |
| --- | --- |
| On `kiro-cli` 3.1.0 the paste wrapper cleaned a V3 paste before Kiro received it: the model saw `[REDACTED:credential]`, and the wrapper's exit line counted the cleaned pastes. No bracketed-paste warning showed. This contradicts the 2026-10-11 observation on 2.29.1, which is struck above where it read as current; 2.29.1 was not re-run | **measured** (owner, trusted workspace) |
| The user-level hook file in `~/.kiro/hooks/` is loaded (`hooks.reload.loaded`, one read, one registered) and invoked on each prompt (`ContextualHookInvoked`) | **measured** (Kiro's own log) |
| The raw key is in no file under `~/.kiro` after the cleaned paste | **measured**, for a cleaned prompt only |
| The hook command alone, fed a synthetic `UserPromptSubmit` payload with a credential, exits 2, writes nothing to stdout, and writes the block notice and the redacted copy to stderr; the key is in neither stream. A clean prompt exits 0 with no output | **measured** (direct pipe, no Kiro) |
| A payload with no `prompt` field exits 0 and writes an internal-error notice to stderr: fail open, as decided above. Whether Kiro shows that notice to the owner is unknown | exit **measured**; visibility **not measured** |
| An untrusted workspace opens no session on 3.1.0: "Don't trust, exit" ends Kiro without loading the folder, so no prompt can be sent there. The gap the 2026-11-08 build amendment expected (an untrusted session running without the hook) does not exist on this build | **measured** (owner) |
| The block path inside Kiro: that a dirty prompt reaching the hook makes Kiro keep it from the model, and where the block message shows (chat, status line, log or nowhere) | **not measured**: in the canary the wrapper had already cleaned the prompt, so the hook never saw a finding |

**Consequence for the measurement route.** With the wrapper cleaning V3 pastes, a paste can no longer
reach the hook dirty. The runbook therefore sends the dirty prompt by typing it (the wrapper relays
typed bytes unchanged) or by starting Kiro with `command kiro-cli`, which skips the wrapper's shell
function. It also adds the direct pipe as step 0, a persistence grep after the block, and removal of the
canary's trust entries. That interactive test is the owner's act, since it needs his login.
*Amended 2026-11-09: the test was not run. The owner accepted the measured evidence and closed #462 on
2026-11-08 ([his comment](https://github.com/tedeuxx/mhw/issues/462#issuecomment-6728227923)), so the block path inside Kiro stays **not measured**; the runbook
remains for an optional later run.*

**Known cosmetic item, out of scope here.** ~~The hook's block notice still names ADR-0011, which this
record superseded. It changes no behaviour; a code slice can fix the text.~~ *Struck 2026-11-09 (#464,
#465): every paste-filter notice now cites ADR-0033.*

## Amendment 2026-11-17: accepted ([Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6962031588))

The owner ratified this record on 2026-11-17, answering a picker in session with *"Todas de uma vez"*, which ratified the sixteen records listed
in the [agent's reading on Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6962024135) as they stood at `rc/next`, every part still
marked proposed; the ruling is recorded on [Issue #24](https://github.com/tedeuxx/mhw/issues/24#issuecomment-6962031588). The status moves from proposed to
accepted. Parts already struck or superseded stay so. Earlier sentences here saying the status stays
proposed, or that a part awaits ratification, are dated readings that this amendment supersedes.
Ratification changes no evidence level stated above: it installs, loads or enforces nothing.

The Kiro canary results amended in on 2026-11-08 (Issues #455 and #462) stay as written.

## Amendment 2026-11-20: the wrapper runs on Node ([#487](https://github.com/tedeuxx/mhw/issues/487), proposed)

~~The wrapper (`global/clipboard/paste_wrapper.py`)~~ The wrapper is `mhw paste-wrapper`
(`src/commands/paste-wrapper.js`), the Node port, with the same properties and the Python original's
answers held as goldens (`test/golden/S16/`). The shell functions run it as
`"<node>" "<package>/bin/mhw.js" paste-wrapper run --config … -- <cli>`; install no longer copies a
wrapper into the data directory and retires the earlier Python copy. Its pseudo-terminal is node-pty
1.1.0, vendored with the macOS prebuilds only ([ADR-0042](0042-node-pty-vendored-for-the-paste-wrapper.md),
proposed). Where that library cannot load (~~Linux and~~ Windows, which has no vendored prebuild; a
spawn-helper without its execute bit; a damaged module) the wrapper **refuses** in one line, exit 126,
and `mhw status` prints `PASTE   FAIL` with the reason: it never starts the CLI unwrapped on a terminal.
~~So on Linux the shell functions no longer start the CLI; `command <cli>` does, and the prompt hook
checks.~~ Windows is not measured (D7). Evidence level: *written and tested* (the live relay tests run on
macOS through the vendored pty); not installed on the reference machine.

*Amended the same day, PR #521 lens:*

- ~~**The Linux refusal is the owner's decision.** It is an escalation on PR #521. Until he answers, the
  Linux behaviour above stands as written.~~
- **Linux keeps the wrapper.** The owner
  [decided on PR #521](https://github.com/tedeuxx/mhw/pull/521#issuecomment-7049084616) to build the
  Linux binary in CI from the pinned source and vendor it. The Linux `pty.node` files are vendored, built
  for x64 and arm64 by run 44811001228 (ADR-0042 amendment), so on Linux the wrapper cleans pastes again.
  The live relay tests run there in CI. This works on glibc 2.35 or later; musl is not covered.
- **Two pasted shapes reach the CLI unchecked.** Both are inherited: the lens's probe found the base
  Python wrapper (`rc/next` at `478f9de`) forwarding them in the same way, so they are limits of the
  design, not of the port.
  1. A paste that stalls longer than `PASTE_IDLE_SECONDS` (2 s) partway through its payload is closed
     and cleaned as it stands. The rest of the payload then passes as typing.
  2. A payload that carries its own end marker (`ESC[201~`) ends the paste there. The bytes after it
     pass as typing.

  The "never forwarded" property in the wrapper's header holds only outside these two shapes and the
  split-marker case already stated. Whether the owner's terminal strips `ESC[201~` from clipboard text
  is not measured.
- **The shell functions name node on `PATH` when it is the same file as the node running mhw.** This is
  ADR-0017's rule. Before it, they pinned the versioned Homebrew path, which an upgrade removes.
- **`mhw status` checks the installed functions.** It prints `PASTE FAIL` when the node or the `mhw.js`
  they name is gone.

## Amendment 2026-11-21: the prompt hook moves to Node, and the salt leaves the Keychain (#488)

*S17 of #470 (#488). It records two changes: a change in protection, decided by the owner, and a
runtime change.*

**The salt is a file now, not a Keychain item.** The owner ruled on #488 (2026-11-21,
[comment](https://github.com/tedeuxx/mhw/issues/488#issuecomment-7062064253) and the follow-up after it):
«voce nao precisa nada disso num cofre acredito. é over engineering». In English: the salt does not
need a vault. A second ruling, «Embaralha, chave em arquivo», keeps the terms as salted hashes and moves
only the key to a file. ADR-0008 is unchanged: no term is stored in plain text.

- **Where the salt lives.** `<data dir>/local-overlay/clipboard-salt`, a `0600` file in a `0700`
  directory, on every operating system. `mhw add-term` creates it atomically on first use: a new file is
  opened exclusively at `0600` and renamed into place. The settings `salt_store=keychain`,
  `keychain_service` and `keychain_path` are no longer read.
- **What was removed.** The Keychain store went, and with it the Security.framework lock probe and every
  `/usr/bin/security` call made for the salt. No Python runs on the hook path, the scan path or the
  paste-wrapper path. The reason was measured first, on a throwaway keychain on the GitHub macOS runner
  (run 44858243105). `security show-keychain-info` and the `-w` read both blocked on a locked keychain
  until they were killed. The attribute read answered the same whether the keychain was locked or not.
  So no `/usr/bin/security` route could read the salt without risking an unlock dialog, and Node cannot
  make the in-process call the Python probe made.
- **The trade-off.** Any process running as the owner, agents included, can read the salt file. With it,
  that process can test guesses against the hashed lists; the lists themselves stay unreadable as text.
  This is not entirely new. ADR-0011's evidence table already recorded that any same-user process could
  read the Keychain salt without a prompt while the keychain was unlocked. What changes is that no
  locked keychain stands in the way any more.
- **Migration: none, on purpose.** Reading the old Keychain salt at install is the read that blocks on
  a locked keychain, so install does not read it. When a term list holds hashes and no salt file exists,
  install prints a `SKIP` line that names the list and tells the owner to re-add his terms. Until he
  does, the hook and `mhw scan` say term matching is off. When `mhw add-term` then creates the new
  salt, it moves each orphaned list aside to `<list>.old-salt` and names it, so no dead hash is mistaken
  for coverage.

**The prompt hook is `mhw hook prompt --harness claude|codex|kiro` (D6 of #470).** Its decision, its
redacted copy and its exit contract on each agent harness are unchanged. `test/golden/S17/answers.json`
holds 232 answers recorded from clipboard_guard.py, and `test/golden/S17/expected-differences.json`
declares every difference.

- **The command line.** It is
  `/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "<node>" "<package>/bin/mhw.js" hook prompt …`.
  Node is named by absolute path, and the variables that could make it load other code first are
  cleared. A test plants `NODE_OPTIONS=--require` and shows that the planted file never runs.
- **The admin layer runs a root-owned copy of the hook's JavaScript.** The copied files are hook-entry.js,
  hook-prompt.js and the cleaning core, so no process running as the owner can change those files. ~~so no
  process running as the owner can change the code it runs.~~ *(Struck the same day, PR #536 lens O1: false.)*
  The admin layer's hook is not root-owned end to end, because the interpreter and its libraries are code
  it runs too.
- **The residual: the node binary and its libraries.** `/usr/bin/python3` was root-owned and protected by
  SIP. A Homebrew or nvm node is not, and neither are the libraries it loads. On Homebrew these are
  libnode from the Cellar, and libuv, llhttp, ada-url, simdjson, brotli, c-ares, nghttp2, nghttp3, ngtcp2,
  sqlite, uvwasi, zstd, openssl@3 and icu4c under `/opt/homebrew/opt`. Measured with `otool -L` on node
  25.9.0; the set changes with the node build. A process running as the owner can replace any of them,
  and so change what both layers' hook does. Which node the admin layer may trust is an open owner
  question (PR #536). `mhw status` prints the
  node's path on its `hook node` line and names it `owner-writable`. A missing node is reported as
  `FAIL`. This is to be carried into the runtime ADR the migration ends with (#470), not hidden here.
- **Fail-open, pinned out of process.** A hook module that is missing, does not parse or throws gives
  the error notice, by its class only. So does a payload read that stalls past 20 s. On Claude Code and
  Codex the notice is visible. On Kiro it goes to stderr at exit 0, as before, and Kiro drops stderr
  there. That Kiro gap is unchanged by this slice.

## Links

- ADR-0011 (superseded; the history). ADR-0005 (no log). ADR-0008 (no persistence). ADR-0025 (admin
  layer). ADR-0028 (OS privilege only). Requirements document, sections 4 and 4a.
