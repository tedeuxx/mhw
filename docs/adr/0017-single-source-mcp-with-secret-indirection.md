# 0017 — One MCP definition, rendered per surface, with credentials read from the OS secret store at launch

- **Status:** proposed. The owner asked for the mechanism (Issue #8). Installing it into his real
  configuration files is his act, from his own terminal, and has not happened.
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner, in Issue #8: standardise workstation-level harness configuration across all surfaces
(ADR-0006). *"Observed: the same local MCP servers are configured independently in the Claude desktop
app and in Codex, and some carry credentials inline in plain-text config."* Done when *"a single-source
MCP definition (in the untracked overlay — server names and credentials never enter this public repo)
renders to each surface, credentials move to the OS secret store or to environment indirection, and
--check detects drift. Changes to the owner's real config files happen only with his go."*

ADR-0006 already listed this as a candidate control (*"a single source for MCP configuration across
surfaces, rendered into each surface's config. Not decided"*). The persistence inventory found
credential-named keys in the Codex user config (plaintext) and in the desktop app's MCP config (key
names only, `docs/persistence-inventory.md`), and found that the desktop app keeps **timestamped
backups** of that config which are never pruned.

Two facts shape the design. **This repository is public**, so the definition (server names, launch
commands) cannot live in it, and its tracked `overlay/` directory is public too. And **a credential in
a config file is a credential on disk**: in every backup of that file, in any agent context that reads
the file, and in every copy the OS makes of it.

## Decision drivers

- No server name, command or credential enters this repository. The repository ships only the generic
  mechanism and a synthetic example.
- No rendered file holds a credential value. That must be measured, not argued.
- One definition, several surfaces, and drift between them is reported (`--check`), as for ADR-0010.
- Never weaken: the renderer touches only its own entries. Every other key, server and comment in a
  surface's file survives, with a backup.
- Report each surface at its real evidence level (documented, measured, enforced).

## Considered options

1. **A JSON definition in the untracked local overlay, a renderer per surface, and a launcher that reads
   each credential from the macOS Keychain (or from a named environment variable) when the server
   starts (chosen).** The rendered configs name the launcher, the secret's NAME and its source, never a
   value. Trade-off: one more process in every secret-bearing server's start, and the Keychain read
   depends on the launching process's `HOME` (measured, below).
2. **Each surface's own environment indirection** (Codex `env_vars`, Claude Code's `${VAR}` expansion).
   No launcher. Rejected: a GUI app inherits only the login session's environment, so the secret would
   have to be set there (`launchctl setenv`), where every process of the session can read it; and the
   desktop app and Kiro document no expansion. The launcher's `env:` source keeps this available where
   it fits.
3. **The renderer reads the Keychain and writes the value into each config.** Simplest for the apps.
   Rejected: it recreates the plaintext credential the Issue exists to remove.
4. **Codex: render a separate file and include it from `config.toml`.** Rejected on measurement:
   Codex 0.155.0-alpha.16.3 accepts an `include = ["extra.toml"]` key and **silently ignores it**; the
   included file's server was absent from `codex mcp list --json` in a throwaway `CODEX_HOME`. So the
   Codex rendering is a marked block inside `config.toml`.
5. **Drive the vendors' CLIs** (`claude mcp add --scope user`, `codex mcp add`). Rejected: `claude mcp`
   is in the owner's deny list, the CLIs record no ownership (so nothing can tell a rendered entry from a
   hand one, and nothing can detect drift), and they are not idempotent syncs.
6. **Edit the TOML with a TOML-writing library.** Rejected: it is a third-party dependency, and this
   repository ships none. The standard library's `tomllib` (Python 3.11+) reads TOML, and the renderer
   uses it to prove every edit before writing.

## Decision outcome

**Chosen: option 1.**

### The definition: only in the untracked local overlay

`${XDG_DATA_HOME:-~/.local/share}/personal-multi-harness-workstation-configuration/local-overlay/mcp-servers.json`,
the same directory that already holds the clipboard guard's term list (ADR-0011), outside every
repository. `--source=FILE` points elsewhere. The renderer **refuses a definition inside a git work
tree that does not ignore it**, and `.gitignore` here ignores `mcp-servers.json` at any depth, so a
copy dropped into this repository is not committable by accident. The repository ships:

- `global/mcp/mcp_render.py`, the renderer (standard library only);
- `global/mcp/mcp-launch.sh`, the launcher (POSIX `sh`);
- `global/mcp/mcp-servers.schema.json`, the schema (the renderer enforces the same rules itself, and a
  test keeps the two vocabularies equal);
- `global/mcp/mcp-servers.example.json`, three synthetic servers named `example-*`.

Per server: `command`, `args`, `env` (non-secret values only), `secrets` (`NAME` →
`keychain:<service>` or `env:<VAR>`), `surfaces` (default all), `not_secret`. **Checks a schema
cannot express, all loud, all naming a location and never a value:**

- **By name:** an `env` name that looks like a credential (`TOKEN`, `SECRET`, `PASSWORD`, `PWD`,
  `API_KEY`, `AUTH`, `DSN`, a `PAT` or `KEY` word such as `GH_PAT` or `STRIPE_KEY`, …) and an `args` flag
  that does (`--api-key=…`). The owner can list a reviewed name in `not_secret`.
- **By value, whatever the key is called:** an `env` value, an argument or the command carrying userinfo
  or a credential query parameter in a URL (`postgres://user:pass@…`, `?access_token=…`), an
  Authorization-style header (`Authorization: Bearer …`, `X-Api-Key: …`), a bearer or basic scheme, a
  private-key block, or a well-known token prefix (GitHub, GitLab, OpenAI-style `sk-`, Stripe, Slack,
  AWS access key id, Google API key, npm). There is no escape for these: the whole value goes into the
  Keychain under `secrets`. So a `--dry-run` or `--check` of such a definition stops at validation and
  shows nothing of it.
- **The limit, stated:** a credential with no recognisable shape, under a name that suggests nothing,
  passes. Both checks are heuristics, and the miss is silent.

Only local `stdio` servers are in the schema.

### The launcher: the value is read at process start

A server with `secrets` is rendered as `mcp-launch.sh --secret NAME=keychain:<service> … -- <command>
<args>`. The launcher reads each value (`/usr/bin/security find-generic-password -s <service> -w`, or
the named variable), exports it as `NAME`, and `exec`s the server. The value travels through the tool's
stdout into the launcher's shell, never through any process's argv. The launcher switches tracing off
before anything else, because an inherited `SHELLOPTS=xtrace`, `sh -x` or `bash -x` would otherwise
print each value to stderr, which the surfaces keep in their MCP server logs (the suite runs all three
and asserts the value never appears). `-w` prints a value that is not printable text as hex,
**byte-identical** to a printable value that happens to be hex (measured with synthetic items), so the
launcher first reads the form with `-g` and refuses the hex case with exit 3. **A missing, locked or empty secret
stops the launch** with a message naming `NAME` and its source, never the value, so the surface shows a
failed server instead of starting one without its credential. The renderer installs the launcher, with
the usual marker line, beside the other managed files. It refuses to render anything if an unmanaged
file sits at the launcher's path, because every secret-bearing entry would execute that file.

### Per surface

| Surface | File and key | How it is merged | Evidence |
| --- | --- | --- | --- |
| **Codex** CLI 0.155.0-alpha.16.3 | `${CODEX_HOME:-~/.codex}/config.toml`, `[mcp_servers.<name>]` | One block between two marker comments, always placed last. Text outside the block is never edited. Before writing, `tomllib` must show that (a) the old file minus the old block means exactly what the text outside the block means, (b) the new file minus our servers equals that outside content, and (c) each of our servers parses to exactly the intended entry. A same-named table outside the block is refused: **Codex refuses to load a config with a duplicate table** (measured: `duplicate key`, exit 1, nothing loaded). `env:` secrets are forwarded with `env_vars` | **Rendered and parsed by Codex, measured**: `codex mcp list --json` in a throwaway `CODEX_HOME` returns every rendered server with the launcher as its command, its `env` and its `env_vars`. This runs in the suite wherever `codex` is on `PATH`. **Not measured:** Codex actually spawning the launcher, which needs a signed-in session |
| Codex in the ChatGPT desktop app | the same file | — | documented to share `CODEX_HOME` (persistence inventory); not measured |
| **Claude Code** CLI | `~/.claude.json`, top-level `mcpServers` (user scope), entries with `"type": "stdio"` | JSON merge (below) | **documented**: *"User-scoped servers are stored in `~/.claude.json`"* ([MCP scopes](https://code.claude.com/docs/en/mcp)). Not measured: `claude mcp` is denied on the reference machine and a headless run needs a signed-in session. User scope is the lowest MCP scope: a project or local entry of the same name wins, whole-entry (same page) |
| **Claude desktop app** (macOS; Windows by path) | `claude_desktop_config.json` in the app's application-support directory, `mcpServers` | JSON merge | documented: macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json` ([Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers)); not measured. No Linux app is published, so Linux is skipped |
| Cowork | — | not rendered separately | **not established** whether a Cowork session starts the desktop config's local servers (ADR-0003 h4) |
| **Kiro IDE and Kiro CLI** | `~/.kiro/settings/mcp.json`, `mcpServers` | JSON merge | **documented** ([Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration/): *"User Level: `~/.kiro/settings/mcp.json`"*); capped at documented, no subscription (ADR-0003). A workspace file can override it |
| ChatGPT desktop chat, claude.ai web and mobile | — | nothing | no local MCP configuration is known |
| **Remote connectors** in every Claude client | — | **not covered** | connectors run *"from Anthropic's cloud infrastructure, rather than from your local device"* (ADR-0003 h4). No local file can carry them, and the schema has no remote servers |

**The JSON merge** (Claude Code, desktop, Kiro): only `mcpServers` changes. Which entries are ours is
recorded in a manifest of names beside the launcher (`mcp-managed.json`, outside the repository), so a
server removed from the definition is removed from the surface and a hand-written server is never
touched. A same-named hand entry is refused unless it is already identical; `--adopt` replaces it
(JSON only: the TOML block cannot safely take over hand-written text). The file is re-serialized with
two-space indentation; `--dry-run` says so.

**Every surface:** a surface whose directory does not exist is skipped (the app is not installed). Each
write keeps one backup (`<file>.pmhwc-backup`), writes atomically, keeps the file's mode, and creates a
new file `0600`. An unreadable or wrongly shaped file is refused (exit 3) and left untouched.
`--dry-run` prints, per file, the servers to add, update and remove, and this project's rendered
entries. **It never prints a current value**, because a textual diff would show the neighbouring hand
entries, which may hold credentials. `--check` reports drift per file (exit 1). Exit codes are
`install.sh`'s.

### The migration helper: `--scan`, owner-run only

`mcp_render.py --scan` reads each surface's MCP section, **and each `.pmhwc-backup`**, and prints
`surface · config|backup · file · server · location`, where location is a key path (`env.X`,
`headers.Authorization`, `bearer_token`, `args[3] --api-key <value>`, `args[2] <credential-looking
value>`, a URL with userinfo or a credential-like query parameter). It applies the same value shapes as
validation, so a token under an innocuous name is listed too. It also lists any leftover
`<file>.new.<pid>` temporary copy, which an interrupted write could leave beside a config. **It never
prints a value**; a test plants seven synthetic values and asserts none reaches its output. It refuses to run when the process carries an agent session's
environment markers (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CODEX_SANDBOX`,
`CODEX_SANDBOX_NETWORK_DISABLED`). Like validation, it misses a credential with no recognisable name
or shape, and nothing announces that miss.

### Measured: no rendered file holds a secret value

In throwaway HOMEs on macOS (the suite, `global/mcp/mcp_render_test.py`):

1. ~~A namespaced Keychain item~~ *(struck 2026-10-05, issue #58: the test wrote the owner's real login
   Keychain. It now uses a throwaway keychain file; see the amendment below.)* A Keychain item with a
   random synthetic value is created through `security -i` on stdin,
   the definition references it, and the renderer runs. **A byte search of every file under the
   throwaway HOME** (configs, backups, manifest, launcher) **does not find the value.** The renderer's
   own output does not carry it either.
2. The rendered Codex entry is executed as Codex would execute it. A fake server hashes the variable it
   received, and the hash equals the value's: the server gets the credential that no file holds.
3. The item is deleted, and the same launch exits 3 with *"no readable Keychain item"*, without the
   value.
4. **Calibration:** the same byte search finds a value deliberately written as plain `env` (reviewed as
   `not_secret`). So the search can see a value when one is there.
5. The same, with an `env:` source, on every OS the suite runs on.

The renderer never reads a secret by construction: no code path calls the Keychain or reads an `env:`
source. A mutation that makes it do so turns the suite red (see the pull request).

**Measured surprise:** `security` resolves the user's Keychain search list from `HOME`. Under a
throwaway `HOME` the launcher found no login Keychain and refused to start the server. ~~In the test,
only the launcher runs with the real `HOME`.~~ *(Struck 2026-10-05, issue #58; see below.)* In use, a
surface that started MCP servers with a rewritten `HOME` would get a failed server, loudly. Whether any
surface does is not measured.

**Amendment 2026-10-05 (issue #58): the suite no longer touches the real Keychain.** The launcher takes
an optional `--keychain PATH` (absolute, before every `--secret`) and passes it to each `security`
read. The renderer never writes it, so in use the launcher reads the login Keychain exactly as before.

**By default, the suite never runs the real `security` binary.** `security create-keychain` adds the
new keychain to the user's search list, and a throwaway `HOME` does not prove that list is untouched,
so a throwaway keychain file alone is not isolation. The Keychain test runs against
`global/security.test.stub`, which records its argv and simulates a keychain as a JSON file. The
launcher names `/usr/bin/security` by absolute path, so a stub on `PATH` would never be reached. The
test therefore runs a copy of the launcher whose `security` calls go to the stub. The real binary
runs **only** with `PMHWC_REAL_KEYCHAIN_TESTS=1` on a GitHub Actions macOS runner, which is ephemeral.
That variable is set in `tests.yml` only.

**Either way, every keychain is a throwaway file under the test's base directory, named explicitly,
under a throwaway `HOME`.** A guard installed for the whole run refuses, before anything executes:

- the real binary, or the real launcher reading the Keychain, without the opt-in;
- a `security` call that does not name a keychain file under the base directory;
- a verb outside a short list, such as `list-keychains` or `default-keychain`;
- an inherited `HOME`;
- a Keychain launch without `--keychain`.

One test, which executes no process, is mutation-checked. Eight mutations give eight reds: either
launcher read drops the path, the opt-in is ignored, and the guard is opened or not installed in
five more ways.

## Consequences

- Good: the credentials leave the config files, so they leave every later backup of those files, any
  agent context that reads them, and any accidental commit or sync of them.
- Good: one definition for four config files, with drift reported and hand-written entries untouched.
- Good: the repository holds no server name, command or credential, and the renderer refuses a
  definition that could be committed.
- **Bad, and the most important limit: the Keychain is not a wall against the same user.** An item
  created with the `security` tool is readable by that tool without a prompt, and the launcher is a
  script, so an agent running as the owner can call it (or `security`) and print a value. ADR-0016's
  deny floor denies `security find-generic-password` as a command prefix, and it already states that a
  script is not matched. So this moves credentials **out of files**; it does not protect them from a
  determined process of the same user. Creating an item with `-T ""` should make every read ask the
  owner, which would turn such a read into a visible prompt (**hypothesis, not measured**; it would also
  prompt at every server start).
- Bad: the value still ends up in the server's environment, as it did before, where a same-user process
  can inspect it.
- **Bad: what was already on disk stays there.** The renderer's own backup, the desktop app's
  timestamped backups, Time Machine and any transcript that read the old config keep the plaintext
  value. `--scan` lists the renderer's backups; the remedy for the rest is to **rotate** each migrated
  credential.
- Bad: an app that edits its own config (Codex toggling a server, the desktop app's settings) shows as
  drift, and the next install reverts it. A running app may overwrite a file the renderer just wrote, so
  the apps are quit before installing.
- Bad: Windows renders only credential-free servers (no launcher there) and is untested; Linux has
  `env:` only, no secret-store source; `install.ps1` is not extended. The Codex surface needs Python
  3.11+ (macOS's stock `/usr/bin/python3` is 3.9, so it refuses there with a message).
- Bad: a server that takes its credential as a command-line argument cannot be migrated without putting
  the value in argv, which the launcher deliberately does not do.
- Bad: the agent-session refusals read environment markers. Under them, `--scan` refuses, and an
  install refuses unless **every** write target (the launcher, the manifest, the Codex config and each
  JSON config) is inside `HOME` and `HOME` neither is nor contains the real home. `CODEX_HOME`,
  `XDG_DATA_HOME` and `APPDATA` move targets, so `HOME` alone was not the boundary (an independent review
  measured a write outside it; the suite now covers both variables). It is still a speed bump, not a
  control: a process can unset the markers. The two Codex names are strings in the shipped Codex
  binary; that a Codex session sets them is **not measured**.
- Version cut (ADR-0002): **minor**: a new control, and nothing an adopter had is weakened.

## Installing it is the owner's act

From inside an agent session the renderer refuses any write outside a throwaway `HOME`. From his own
terminal, the steps are:

1. `python3 global/mcp/mcp_render.py --scan`: the list of credential-looking keys.
2. For each credential: `security add-generic-password -s <service> -a "$USER" -w`, typing the value at
   the prompt, so it never reaches argv, the shell history or an agent.
3. Write the definition in the local overlay (start from `global/mcp/mcp-servers.example.json`).
4. Remove the hand-written Codex tables that the definition now owns. For the JSON surfaces,
   `--adopt` replaces them.
5. Quit the apps that write these files: the Claude desktop app, the ChatGPT desktop app (Codex),
   Kiro, and **every running Claude Code CLI session**, which rewrites `~/.claude.json` while it runs.
   Then `--dry-run`, install, and `--check`.
6. Delete the backups and leftover temporary copies that still hold plaintext values (`--scan` lists
   them), and rotate those credentials.

## Links

- Issue #8. ADR-0003 (h4: connectors are cloud-side). ADR-0006 (surfaces; this record discharges its
  candidate control). ADR-0008 and `docs/persistence-inventory.md` (credential-named keys, desktop
  config backups). ADR-0010 (managed-file marker). ADR-0011 (the local overlay directory). ADR-0016
  (the deny floor and its script limit).
- `global/mcp/`, `.gitignore`, `.github/workflows/tests.yml`.
