# ADR-0038: A `chrome-devtools` MCP server at Claude Code user scope, bounded by origin

- **Status:** ~~proposed. The owner chose the scope (user scope) on
  [Issue #174](https://github.com/tedeuxx/mhw/issues/174), 2026-10-13. The rest of this record, the
  pinned version, the supply-chain posture and the launch form, waits for his ratification.~~ accepted
  (2026-10-15, the owner's ratification of the whole record, recorded on
  [Issue #174](https://github.com/tedeuxx/mhw/issues/174#issuecomment-6202190001); see the amendment
  "accepted" below)
- **Date:** 2026-10-13
- **Deciders:** ~~the owner (the scope); written by the implementing agent~~ the owner (the scope on
  2026-10-13; the whole record on 2026-10-15); written by the implementing agent
- **Issues:** [#174](https://github.com/tedeuxx/mhw/issues/174)
- **Amends:** [ADR-0017](0017-single-source-mcp-with-secret-indirection.md), whose definition "lives
  only in the untracked local overlay". This record adds one tracked definition beside it, for servers
  that carry no secret and no owner value.

## Context and problem

The `tadeumendonca-skills` plugin was the only source of a `chrome-devtools` MCP server, in its
`.mcp.json`. Since tadeumendonca-io#725 disabled the plugin, `product-lead`'s `mcp__chrome-devtools`
grant and the `/sprint-review` live sweep reach no server in any project. The owner was offered three
paths: local scope in tadeumendonca-io, user scope, or keep it off. He chose **user scope**.

The server adds a new dependency (a third-party npm package fetched at launch) and a new tool class (a
real browser driven by an agent), so a record is owed (ADR-0001 significance gate).

The bound is an origin: `--allowedUrlPattern` makes the browser refuse a navigation or a subresource
outside the pattern (the package's own `--help` text, version 1.8.0). tadeumendonca-io declares the
origin in its tracked `.claude/settings.json`, under `env.HARNESS_SWEEP_ORIGIN`. The plugin passed it as
`--allowedUrlPattern ${HARNESS_SWEEP_ORIGIN:-http://127.0.0.1:9/*}`.

### What was measured, and why the plugin's argument form is not reused

Claude Code 2.1.296, macOS, a throwaway HOME, a trusted throwaway project whose `.claude/settings.json`
sets `HARNESS_SWEEP_ORIGIN`, the variable unset in the launching shell. Two recorder "servers" printed
the arguments and the environment they were started with: one at user scope (`~/.claude.json`), one at
project scope (`.mcp.json`), both with the plugin's `${HARNESS_SWEEP_ORIGIN:-…}` argument. A headless
session start (`claude -p`, not logged in; the servers start before the login check) gave:

| Server | `--allowedUrlPattern` received | `HARNESS_SWEEP_ORIGIN` in its environment |
| --- | --- | --- |
| user scope, `${…}` argument | `http://127.0.0.1:9/*` (the default) | the project's value |
| project scope, `${…}` argument | `http://127.0.0.1:9/*` (the default) | the project's value |
| user scope, the shell form below | the project's value | the project's value |

Calibrations: with the variable set in the launching shell, both `${…}` forms received it; in a
project with no settings `env`, the shell form received the default. `claude mcp get` lists the
top-level `mcpServers` entry of `~/.claude.json` as "Scope: User config".

So **a project's settings `env` reaches the server's environment, and does not reach a `${VAR}` in the
server's arguments**, at either scope: Claude Code expands the arguments before it applies the settings
`env`. With the plugin's form the browser would be bound to the discard port in tadeumendonca-io too.
That matches `/sprint-review`'s own record (three closes without a sweep, sprint-02 to sprint-04) and
its step 0 probe (2.1.283, the default observed). The owner ruled out a shell profile as the carrier on
tadeumendonca-skills#525: the bound must come from the project's tracked configuration.

## Decision drivers

- Fail closed: a project that declares no origin gets an origin that reaches nothing.
- The origin comes from the consuming project's tracked configuration, not from the owner's shell.
- Native first and one route: Claude Code's own user-level MCP configuration, written by the existing
  MCP renderer (ADR-0017), not a parallel mechanism.
- The server name `chrome-devtools`, so the tools are `mcp__chrome-devtools__*`, which is
  `product-lead`'s grant.
- Every write is backed up owner-only, printed old -> new, and removed on uninstall.
- Report each claim at its evidence level.

## Considered options

1. **User scope, the shell reads the origin at launch (chosen).** `mhw install` writes the server into
   `~/.claude.json` from a tracked `global/mcp/policy-servers.json`. The command is `/bin/sh -c`, and
   the script sets the origin from `HARNESS_SWEEP_ORIGIN`, or `http://127.0.0.1:9/*` when that is unset,
   empty or does not begin `http://` or `https://` (see "The scheme guard" below), then `exec`s `npx`. The script carries no `${`, so Claude Code expands nothing; the shell
   reads the variable from the environment the harness gave the server, which carries the project's
   settings `env`. After `exec` the process table shows the `npm exec chrome-devtools-mcp@1.8.0 …
   --allowedUrlPattern <value>` line that `/sprint-review` step 0 reads. *Trade-off:* the server is
   defined in every project, and in every project but one it starts a browser that can reach nothing;
   the launch needs `/bin/sh`, so it is not portable to Windows as written.
2. **User scope with the plugin's `${HARNESS_SWEEP_ORIGIN:-…}` argument.** The exact shape the Issue
   named. *Rejected on the measurement above:* it would always pass the default in tadeumendonca-io, so
   it delivers a server that can never sweep unless the owner exports the variable in his shell, which
   he ruled out.
3. **Local scope in tadeumendonca-io (the strongest rejected alternative).** A `.mcp.json` in the one
   project that needs the browser, so no other project gets a browser server at all. *Trade-off:* the
   smallest reach, and the origin could be written there directly. *Rejected by the owner*, who chose
   user scope on #174. Two facts weigh on it and are recorded so the choice stays reviewable: the
   measurement shows a project-scope `${…}` argument would not have read the settings `env` either, so
   that path would have needed the literal origin or the same shell form; and it puts a workstation
   control (the pinned package and its flags) into a product repository, outside this repository's
   install and uninstall.
4. **Keep it off.** No browser for any agent. *Rejected by the owner:* the sweep and the grant are
   wanted.

## Decision outcome

Option 1.

- **Definition.** `global/mcp/policy-servers.json`, tracked, in the ADR-0017 schema. The renderer
  refuses a policy server that names a secret, one without an explicit `surfaces` list, and one for
  Codex. One server: `chrome-devtools`, surface `claude-code`.
- **Package and posture.** `chrome-devtools-mcp@1.8.0`, pinned to that exact version (the version the
  plugin ran and `product-lead`'s excluded-tool list was written against; the registry's latest on
  2026-10-13 is 1.10.1). It is fetched by `npx --ignore-scripts -y`: install scripts do not run, and
  npm checks the tarball against the registry's integrity hash
  (`sha512-Wrm9z0/5WbVs778apjWgYRkpe9bvYQWjK2zVRwqoPAtz1IHQ5+GvotM07UGXJcfrA0rj6Gt1Pnn5+w/Tf1nU4w==`,
  `npm view chrome-devtools-mcp@1.8.0 dist.integrity`). Flags, ~~as the plugin: `--isolated` (a
  temporary profile, none of the owner's sessions), `--channel stable`, `--viewport 1280x800`,~~
  *(struck 2026-10-24, #224: see the amendment "attach to the owner's Chrome")* `--autoConnect`
  ~~when the project declares an http(s) origin, else `--isolated`~~ *(always, since the owner's
  [ruling](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6428313879) of 2026-10-26)*; `--channel stable`, `--no-usage-statistics`, `--no-performance-crux`, `--allowedUrlPattern <origin>`.
  The flags were checked against the pinned version's `--help` ~~.~~ and, for `--autoConnect`, its
  source.
- **Route.** `global/mcp/mcp_render.py --policy --mode=install|check|dry-run|uninstall`, called by
  `global/install.sh` (its `mcp_step`) on every `mhw install`, `mhw check` and `mhw uninstall`. The
  previous `~/.claude.json` is kept as `~/.claude.json.pmhwc-mcp-policy-backup`, owner-only (0600). Each
  change is printed `chrome-devtools <old> -> <new>`. The names it wrote are recorded under `policy` in
  the renderer's manifest, apart from the local definition's, so neither mode removes the other's
  servers, and a local definition that reuses a policy name is refused. A same-named server that mhw
  did not write is refused (exit 3), never overwritten. `--scan` also reads the new backup.
- **Coverage, harness × OS.**

  | Agent harness | macOS | Linux | Windows |
  | --- | --- | --- | --- |
  | Claude Code CLI | written and tested | written and tested (the same code; not run on Linux here) | not rendered: `install.ps1` does not call it, and the launch needs `/bin/sh` |
  | Codex | not rendered (a declared gap) | not rendered | not rendered |
  | Kiro CLI, Kiro IDE | not rendered (a declared gap) | not rendered | not rendered |
  | Claude desktop, ChatGPT desktop | not rendered | not rendered | not rendered |

## Consequences

Good:

- The grant `product-lead` already carries reaches a server again, in every project, through the
  workstation's own install, check and uninstall.
- A project with no declared origin gets a browser bound to the discard port. A declared origin reaches
  the server from the project's tracked settings, by the measurement above.
- The version is pinned and install scripts are off, so a new release of the package is not taken
  silently.

Bad:

- **A new third-party dependency, fetched at every first launch.** The package runs as the owner, drives
  a real Chrome, and is not vendored. The package has no runtime dependencies at 1.8.0 (its code is
  bundled, and its two peer dependencies are optional, so npm installs none). The integrity hash
  therefore covers all the code that runs, but it is trust on first use of the registry itself, and a
  later version may add dependencies. Measured 2026-10-13: `npm view chrome-devtools-mcp@1.8.0
  dependencies peerDependencies peerDependenciesMeta --json` shows no `dependencies` and both peers
  `optional`; `npm install --dry-run --ignore-scripts chrome-devtools-mcp@1.8.0` reports "added 1
  package". A compromised registry is outside this control.
- **A browser server in every project.** In each project but tadeumendonca-io it starts, if an agent
  calls it, a browser that can reach nothing. Its tools are visible to every agent whose tool list does
  not exclude them; the main session included.
- **The origin is only as narrow as the project declares.** A project whose settings `env` sets a wide
  pattern gets a wide browser. The bound is the project's to choose.
- **Writing `~/.claude.json` while Claude Code runs.** ADR-0017 records that a running Claude Code
  session rewrites that file; an install made while one runs may be overwritten. Not measured here; the
  instruction is the fresh-session rule (ADR-0022): install last, then restart.
- **The measurement is one build.** A later Claude Code may apply the settings `env` before it expands
  arguments, which is harmless here, or start expanding `$VAR` without braces. That second change would
  also rewrite the script's `$o`, and the browser could then be launched with an empty pattern, whose
  effect in the package is not measured: that direction is not known to fail closed. Re-measure on
  every new build with the step 0 probe; a probe line with an empty value is a stop.

## Evidence level, and what is not measured

- **Written and tested** here: `global/mcp/mcp_render_test.py` (class `Policy`: install, check, dry-run,
  uninstall, the backup's mode, a hand-written server refused, the local definition and the policy
  apart, `describe` hiding a credential-looking entry, and the launch script run with a fake `npx` for
  no value, an empty value, an http and an https value, a value with shell text in it, two dash-led
  values, a bare host, a `file:` URL and a value with a leading space); `global/install.test.sh` section 19b (a throwaway HOME through `install.sh`).
  `./mhw install --yes --no-admin` and `./mhw uninstall --yes` were run in a throwaway HOME.
- **Measured** (recorder servers, 2.1.296, as above): the expansion order, and that the shell form
  carries the project's value. The real package was not launched by Claude Code in that measurement.
- ~~**Not installed** on the reference machine. **Not loaded and not enforced**: that needs, in a fresh
  session on the reference machine after `mhw install`, a canary from `product-lead` in
  tadeumendonca-io: `navigate_page` to the declared origin succeeds, a navigation outside it is refused,
  and `/sprint-review` step 0 prints the declared origin.~~ **Canary run on 2026-10-15** (recorded on
  [Issue #174](https://github.com/tedeuxx/mhw/issues/174#issuecomment-6202067041); a fresh Claude Code
  2.1.301 session in tadeumendonca-io, workstation v5.7.0):
  - **Loaded:** the session's tool list carries the `mcp__chrome-devtools__*` tools, and the server
    process carries the bound (`--allowedUrlPattern https://tadeumendonca.io/*` in its arguments).
  - **Enforced for the origin bound**, in that session, through `product-lead`'s grant: a navigation to
    the declared origin succeeded and one to example.com was refused. The error text does not name the
    flag, so attributing the refusal to `--allowedUrlPattern` is inference from the server's arguments,
    not read from the error.
  - `/sprint-review` step 0 printed the declared origin and proceeded.
  - **Not measured:** the persona's tool exclusions (`evaluate_script`, `fill`, `type_text` and the
    rest); Codex and Kiro (not rendered); and which of the host's servers the session owns, since `ps`
    showed two bound servers on the host and cannot say which one this session reaches.

### The scheme guard (QA advisory A1 on PR #175)

The launch script keeps the value only when it begins `http://` or `https://`; anything else, including
an empty value, becomes the discard port. Without the guard, a dash-led value such as
`--remote-debugging-port=9222` would be passed where the pattern goes and would likely be parsed by the
package as a flag, leaving no allow list. The value stays one quoted argument, so shell text in it is
never run. Tested with a fake `npx` (mutation-checked: with the guard removed, the test goes red), and
re-measured under Claude Code 2.1.296 with a recorder server: the project's `https://` value arrived,
and a project with none got the discard port.

**What the guard does not validate.** It checks the scheme prefix only. A wide pattern still passes:
`https://*`, `http://*/*` or a pattern for any host the project names is accepted as written, and the
package's own URL-pattern parsing then decides what it allows. Whether a malformed pattern after the
prefix fails closed in the package is not measured. The bound is as narrow as the project declares.

## Amendment 2026-10-15: accepted ([Issue #174](https://github.com/tedeuxx/mhw/issues/174#issuecomment-6202190001))

The owner ratified this record on 2026-10-15, in the session that ran the canary, in his words:
*"ratificar a ADR-0038"*. The ratification covers the whole record: the scope he had already chosen,
and the pinned version, the supply-chain posture and the launch form that waited for him. It is
recorded on Issue #174. The status moves from proposed to accepted.

Accepting the decision does not change the evidence levels above. ~~They stay as written until a slice
records a measurement against them.~~ They come from the canary of 2026-10-15, recorded separately on
Issue #174, not from the ratification.

## Amendment 2026-10-17: a dedicated workspace for a local admin origin

The owner needed the browser on a device's admin page on his private LAN (a home router), from a
session started in his home directory. The navigation was refused: that session declares no origin,
so the discard-port default applied. That is this record working as designed, not a defect.

He was offered three paths: a dedicated workspace only, the same plus this amendment, or a LAN origin
in the user-scope default. He chose **a dedicated workspace, recorded here**. The user-scope default
stays the discard port; fail-closed is unchanged.

- **The pattern.** A task that needs the browser on a local origin outside any product repository gets
  its own directory, whose `.claude/settings.json` sets `env.HARNESS_SWEEP_ORIGIN` to that one origin
  and nothing wider. The session that does the task starts in that directory. No file in this
  repository changes for it.
- **Not the home directory.** A session started in the home directory reads `~/.claude/settings.json`
  as its user settings, so an origin set there would reach every project. The pattern needs a
  subdirectory.
- **Rejected: a LAN origin in the user-scope default.** It would let every agent in every project
  reach the device's admin page, which is the reach this record's first driver exists to deny.
- **Evidence level.** Written. The mechanism is the one measured above (a project's settings `env`
  reaches the server's environment); the session that loads the dedicated workspace has not yet been
  run at the time of writing. ADR-0022 applies: start a fresh session in that directory before relying
  on it.

## Amendment 2026-10-24: attach to the owner's Chrome ([Issue #224](https://github.com/tedeuxx/mhw/issues/224))

The owner decided, verbatim (decision D6 on #220): *"nao faz sentido voce rodar o chrome-devtools fora
do meu profile. senao voce vai sempre pedir para logar."* On #224 he added that remote debugging must
be on by default: *"eu nao quero ter que lembrar de ativar o cdp"*.

- **The change.** ~~When the project declares an http(s) origin in `HARNESS_SWEEP_ORIGIN`, the server
  passes `--autoConnect --channel stable` … Otherwise it keeps the throwaway `--isolated` launch … (decided
  by the coordinator, reversible).~~ *(Struck 2026-10-26: the gate found on PR #227 (B1) that this
  narrowed acceptance criterion 1, and the owner ruled "Sempre seu perfil" on
  [#224](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6428313879). He declined keeping the isolated launch without an origin, and declined not starting
  the server without one.)* The server always passes `--autoConnect --channel stable` and attaches
  to the owner's running Chrome, the default profile of the stable channel. `--isolated` is never
  passed (1.8.0 declares it a conflict of `--autoConnect`), and `--viewport` is removed. With no
  declared origin the bound stays on the discard port. The origin bound is unchanged.
- **The risk the owner accepted.** The agent drives a browser that holds all of his logins. Within the
  bound, a page opens with his session: on the declared origin, the agent sees what he sees when he is
  logged in there. Outside it, the bound refuses the page.
- **Why the bound still holds when attached** ~~(cited from source; the canary is owed)~~ *(measured
  2026-10-26, [live probe](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6427884355): attached to the owner's Chrome 155.0.8059.85, `https://example.com/` opened
  under the bound and `https://example.org/` was refused with "Navigation to https://example.org/ is
  blocked by blocklist/allowlist rules")*. The source reason, in 1.8.0:
  `build/src/index.js` hands the same `allowlist` to `ensureBrowserConnected` as to
  `ensureBrowserLaunched`, and `build/src/browser.js` passes it to `puppeteer.connect`. In the bundled
  puppeteer-core 25.8.0, the connect path builds the same `CdpBrowser` and `TargetManager` as the
  launch path. They refuse a `goto` outside the pattern (*"Navigation to … is blocked by
  blocklist/allowlist rules"*), detach from tabs whose URL is outside it at the first attach, and set a
  network rule on every target the server attaches to that takes everything but the pattern offline.
  That rule lands only on the server's own targets: tabs open at the first attach whose URL is outside
  the pattern are detached. The owner's own new tab was probably never attached, so no rule reached
  it: a hypothesis that fits the measured result below, where such a tab kept its network, and was not
  traced further in the source.
- **Chrome's own controls, kept.** The remote-debugging server that `--autoConnect` reaches is the
  one the owner turns on at `chrome://inspect/#remote-debugging`. Chrome starts it in an
  approval-only mode and asks him to allow a connection. **Measured** (the same probe): one connection,
  one approval prompt, which he allowed. **Not measured:** whether the prompt fires on every connection
  (as Chrome's documentation says) or once per Chrome run; the probe made one connection. That prompt
  fits D1 (presence) and is not bypassed. A local process that tries the same port meets the same prompt
  (cited, not measured).
- **Default on, with nothing to remember.** The toggle is the Chrome preference
  `devtools.remote_debugging.user-enabled`, stored in the browser's Local State, not per profile, and
  Chrome reads it at startup. Neither alternative turns it on: Chrome ignores `--remote-debugging-port`
  on the default user data directory since Chrome 136, and the `RemoteDebuggingAllowed` policy can only
  forbid remote debugging. ~~`mhw install` does not write it~~ *(owner's decision on
  [#224](https://github.com/tedeuxx/mhw/issues/224), the same day: "mhw edita o Local State")*
  `mhw install` sets it, through `global/chrome_debugging.py`:
  - only while Chrome is not running; if it runs, the step prints one SKIP line and writes nothing;
  - only that key: a JSON round-trip that keeps every other field and the file's mode, written to a
    temporary file in Chrome's own directory and renamed over the original;
  - no backup anywhere, and no output that carries the file's contents;
  - a no-op when the key is already true; `check` reports DRIFT while it is not; uninstall leaves it.
- **Status.** `mhw status` prints a `chrome debugging` line with that one key's value (read as that key,
  never printed as file contents) and whether `DevToolsActivePort` exists. So a Chrome update that
  renames the key reads "off" or "not read" instead of failing silently. `DevToolsActivePort` is
  written when the server starts, and no removal of it was found in Chrome's source, so a present file
  may be stale.
- **Accepted with the decision:** Local State also holds personal data, and a Chrome update can change
  the key. **Not measured:** the `Local State` write itself, and whether Chrome honours a value written
  from outside it; in the probe the owner turned the toggle on by hand. ~~The first install on the
  reference machine, with Chrome quit, is that measurement.~~ *(Struck 2026-10-26, PR #227 advisory A1: on the reference
  machine the key is already `true`, set by his manual toggle, so the first install prints `OK` and
  writes nothing. The write stays unmeasured until a run starts from a key that is false or absent,
  with Chrome quit. That read does show Chrome 155 stores the manual toggle under exactly this key.)*

Consequences, bad:

- **A Chrome prompt in any project whose agent calls the MCP, accepted by the owner** ([ruling](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6428313879)).
  The server is defined in every project, so any agent's first call raises Chrome's approval prompt on
  his screen. In a project with no declared origin, the bound is the discard port, so the agent reaches
  nothing useful even after he allows it.

- ~~**The bound now clamps the owner's own browsing while a session is attached.** The network rule
  lands on every target the server attaches to, including a tab the owner opens himself.~~ *(Refuted
  2026-10-26 by the [live probe](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6427884355): while the server was attached, a tab he opened himself to
  `https://example.net/`, outside the bound, loaded. One run, one build; the source reading was wrong
  for his own tabs. Not measured: a tab's network after the server disconnects. He had closed the tab
  before that step ([correction](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6427911167)).)*
- **No unattended sweep.** A connection waits for his click, so a sweep with nobody at the machine
  cannot attach. That is D1 working as designed.
- **The product lens changes.** The sweep now sees the declared origin logged in as the owner, not as
  the anonymous reader. The package offers `new_page` with an `isolatedContext` (a separate browser
  context inside the attached Chrome, holding none of his cookies), and `product-lead`'s brief now
  asks for it when the reader's view is the point.

Evidence level: **written and tested** (`global/mcp/mcp_render_test.py`, `global/workstation_test.py`,
`global/chrome_debugging_test.py`, on a fixture Local State). **Measured** for the package itself, by the
[live probe of 2026-10-26](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6427884355), which launched `chrome-devtools-mcp@1.8.0 --autoConnect --channel stable
--allowedUrlPattern 'https://example.com/*'` on its own, with the owner watching: the attach, the
approval prompt, the allowed origin opening and the disallowed origin refused. The rendered
configuration is not installed and not loaded; that needs `mhw install` and a fresh session
(ADR-0022). Still not measured: the `Local State` write, whether the prompt fires per connection or per
Chrome run, and a tab's network after the server disconnects ([correction](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6427911167)).

## Links

- [Issue #174](https://github.com/tedeuxx/mhw/issues/174); tadeumendonca-io#725 (the plugin disabled).
- ADR-0017 (the MCP renderer), ADR-0022 (fresh session after a configuration change), ADR-0029 (the
  provenance stamp, recorded per surface for the policy servers too), ADR-0032 (the working method:
  `method/agents/product-lead.md`, `method/commands/sprint-review.md`).
- `global/mcp/policy-servers.json`, `global/mcp/mcp_render.py`, `global/install.sh`.
