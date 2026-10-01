# 0003 — Distribution requirements: supported access modes

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

This repository is an LLM firewall. It sanitises external and internal prompts of secrets, personal
data, PII, client and employer confidential data, and sensitive personal data (see `AGENTS.md`,
"Fundamental purpose"). Where a sanitiser can sit depends on **how each harness reaches its model**,
and that is a distribution requirement: someone replicating this set must know which access modes it
supports.

**Fact (owner, 2026-10-01):** the reference install reaches Claude (through Claude Code) and Codex
through the owner's **top-tier subscriptions**, signed in with a subscription login rather than an API
key.

## Requirement

- **Every control must work under subscription login.**
- API-key mode is **optional and never assumed**. A control that works only with an API key does not
  satisfy this requirement.
- Each control declares the access modes it works under, alongside the OS × harness enforcement
  declaration required by `AGENTS.md`, Principle 1. Any access mode a control does not reach is stated
  as a gap.

### Recognised access-mode states

- **subscription login**: the reference mode for Claude and Codex. Every control must work under it.
- **API key**: optional, never assumed.
- **no active subscription**: a target distribution the policy set supports for adopters, with no
  active subscription on the reference install. This is the state of **Kiro IDE and Kiro CLI**. The
  owner: *"considere kiro-ide/cli como uma distribuicao alvo valida embora nao tenhamos subscription
  ativa no tier pessoal"*.

**What the "no active subscription" state costs.** Controls for these targets can be authored and
statically checked, but on the reference install they will likely not be exercised end-to-end in a live
session. Their evidence level is therefore **capped at *documented* or *installed***, never *measured*,
until a subscription or a test account exists. Reporting them as measured would claim the stronger
evidence on the weaker, which `AGENTS.md`'s hard rules forbid.

## Hypotheses to be measured

None of these is asserted. Each one is unverified until it is **measured** on the reference install,
with the harness version recorded. A vendor document that settles one is cited as *documented*, which
is weaker evidence than *measured*. No vendor document was cited when this record was written.

- ~~**h1:** under subscription OAuth, Claude Code may not forward credentials to a custom
  `ANTHROPIC_BASE_URL` gateway.~~ **Measured false**, 2026-10-01: it does forward them. See the
  2026-10-01 amendment below.
- ~~**h2:** Codex signed in with a ChatGPT account may not support a custom model provider without an API
  key.~~ **Measured false**, 2026-10-01: a custom provider receives the ChatGPT credential when it asks
  for it. See the amendment below.
- **h3:** intercepting subscription traffic may conflict with the vendors' terms of use, which would be
  a civil risk in itself, the very class of risk this repository exists to avoid. **Documented** in the
  amendment below: the terms are cited, and one Anthropic clause is ambiguous for this case.
- ~~**h4:** traffic from the claude.ai web and desktop apps, and from their connectors, never passes
  through this workstation, so it is outside any local firewall.~~ **Refined per surface** in the
  amendment below. Most of it holds, but the desktop app's Code tab does pass through local hooks, and
  "passes through this workstation" was the wrong test: Cowork runs locally, yet nothing found shows it
  loading the user-level hooks.

## Decision drivers

- Subscription login is how the reference install actually works.
- A sanitiser that breaks the owner's access, or breaches vendor terms, creates the liability it is
  meant to remove.
- Controls must be portable across OS × harness × access mode (Principle 1).

## Considered options

1. **Hook-layer barrier.** Each harness's pre-tool and pre-prompt hooks inspect content and **block**
   it. They cannot rewrite it. Expected to work under subscription login, since it does not touch the
   transport, but this is still to be measured per harness.
2. **Local proxy sanitiser.** A local gateway **rewrites** outbound prompts. It is acceptable only on a
   harness and access mode where h1–h3 are measured to be clear.
3. **Both, layered.** Hooks as the floor everywhere. The proxy is added only where measurement clears
   it.

## Decision outcome

**Proposed: option 3, layered, with the proxy contingent on measurement.** No final choice until the
hypotheses are measured and the owner ratifies.

## Consequences

- Good: the hook floor does not depend on any unmeasured transport assumption.
- Bad: hooks only block, so a prompt that the proxy would have cleaned is refused instead, unless the
  proxy is cleared.
- Bad: h4, if confirmed, means a whole access surface (claude.ai web and desktop, and their connectors)
  is outside this firewall. That gap must be stated, not hidden.
- Bad: until h1–h3 are measured, external-prompt rewriting is not offered on the reference install.

## Amendment 2026-10-01: h1–h4 measured or documented

Issue #7 asked for each hypothesis to be settled as *measured*, *documented* (with a URL) or left as
a hypothesis with a reason. Measured on the macOS reference workstation. Vendor pages were fetched on
2026-10-01. Nothing below is legal advice.

### Method: a loopback listener that never sees a vendor

A small Python HTTP server, started for the probe and stopped after it, listened on `127.0.0.1` only.
It recorded each request's **method, path (query stripped) and sorted header names**. It never
recorded a header value or a body: the body was read and discarded. It answered every request `400`
with a vendor-shaped error, so nothing was forwarded and no request reached Anthropic or OpenAI.
**No quota was spent:** each run reported zero cost, or failed on the first model call. The listener
was calibrated first with a request carrying a dummy `Authorization` value. The log held the name
`authorization` and not the value.

The listener's process memory held the credential briefly during each run. No log, transcript or file
received it. Neither CLI ran with a debug flag. Claude Code ran with `--no-session-persistence`, and
Codex with `--ephemeral`. Codex ran under a throwaway `CODEX_HOME` whose only credential was a
**symlink** to the real auth file, as in ADR-0010's amendment. The symlink was confirmed still a
symlink after each run, and the throwaway directory was deleted at once. Claude Code ran in an empty
throwaway directory, with the base URL set in the process environment only. No user config file was
edited.

### h1: Claude Code, subscription login, custom `ANTHROPIC_BASE_URL`: **measured false, and documented**

Claude Code 2.1.286, `claude -p --tools "" --strict-mcp-config --no-session-persistence`. Before
the run, no API-key variable was set and the user settings carry no `apiKeyHelper` (key names only).
The only credential on the machine was the subscription login.

| Arm | What reached the listener |
| --- | --- |
| `ANTHROPIC_BASE_URL` → loopback, subscription login only | `POST /v1/messages` with an **`authorization`** header (and `anthropic-beta`, `x-app`, `x-claude-code-session-id`, …), no `x-api-key`. A `HEAD /api/hello` went to the listener first. |
| calibration: same, plus a dummy `ANTHROPIC_API_KEY` | the same request with **`x-api-key`** and **no `authorization`**. Claude Code warned that the variable "takes precedence over your claude.ai login". |
| side arm: the base URL set **only** in a project-level `.claude/settings.json` `env` block | the same `POST /v1/messages` with **`authorization`** |

So **under subscription login, Claude Code sends the subscription bearer credential to whatever host
`ANTHROPIC_BASE_URL` names.** The calibration shows that the header follows the credential: it is not
a header the CLI always sends. The vendor documents this
([LLM gateway, "Subscriptions and gateways"](https://code.claude.com/docs/en/llm-gateway)):
*"Setting only that variable, without a gateway credential, doesn't replace the subscription. Requests
still route through the gateway, but a saved claude.ai login remains the active credential, so its
usage limits and billing apply. Gateways that pass this traffic on to Anthropic must forward the OAuth
capability in anthropic-beta."*

**A finding the hypothesis did not ask about.** The side arm shows that a **repository's own**
`.claude/settings.json` can route the owner's subscription credential to a host the repository names.
That was measured in headless `-p` mode only. Whether the interactive workspace-trust dialog stops it
first was not measured. Claude Code has a pin for the destination, `allowedProviders` with
`["customEndpoint"]` ([same page](https://code.claude.com/docs/en/llm-gateway)). The page describes it
in a managed settings file, and it requires 2.1.285 or later. It was not tested here. **Candidate
control, proposed only:** pin the base URL at the managed level, or have a user-level guard refuse a
session whose effective `ANTHROPIC_BASE_URL` is not on an allowlist.

### h2: Codex, ChatGPT login, custom model provider: **measured false, and documented**

The Codex CLI bundled with the ChatGPT desktop app, 0.155.0-alpha.16.4. `auth_mode` was `chatgpt`,
and the API-key field was empty (both read as non-secret switches). Command shape:
`codex exec --skip-git-repo-check --ephemeral --json -s read-only --disable shell_tool --disable
unified_exec --disable memories`. The provider was set in the throwaway home's `config.toml`.

| Arm | What reached the listener |
| --- | --- |
| A: custom `model_providers.<id>`, `base_url` → loopback, `requires_openai_auth = true` | `GET /v1/models` and `POST /v1/responses`, each with **`authorization`** and **`chatgpt-account-id`** |
| B (calibration): the same provider without `requires_openai_auth` and without `env_key` | the same requests with **neither** header |
| C: the built-in provider with `openai_base_url` → loopback | `GET /v1/models`, WebSocket upgrades on `/v1/responses` with a fallback to HTTPS `POST /v1/responses`, each with **`authorization`** and **`chatgpt-account-id`** |

So **a custom provider gets the ChatGPT credential when it sets `requires_openai_auth = true`, and so
does the built-in provider when `openai_base_url` moves it.** Without either, nothing is sent. This is
documented ([Authentication, "Alternative model providers"](https://developers.openai.com/codex/auth)):
*"Set requires_openai_auth = true to use OpenAI authentication. You can then sign in with ChatGPT or an
API key. This is useful when you access OpenAI models through an LLM proxy server."* Codex also ignores
these keys in a project-local `.codex/config.toml`
([Advanced config](https://developers.openai.com/codex/config-advanced)), so the side-arm exposure
found for Claude Code is closed by design here. That was read, not measured.

### h3: vendor terms on intercepting subscription traffic: **documented, with one ambiguous clause**

**Anthropic.**

- [Claude Code legal and compliance, "Authentication and credential use"](https://code.claude.com/docs/en/legal-and-compliance):
  *"OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and
  Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native
  Anthropic applications."* Also: *"Anthropic does not permit third-party developers to offer Claude.ai
  login into their own applications, or to route requests through Free, Pro, or Max plan credentials on
  behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai
  credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own
  flow."* And: *"Nor does it prevent an end user from signing in to the unmodified Claude Code binary
  with their own Claude subscription"*. Finally: *"Anthropic reserves the right to take measures to
  enforce these restrictions and may do so without prior notice."*
- [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms) (effective
  2025-10-08): *"You may not share your Account login information, Anthropic API key, or Account
  credentials with anyone else."* Another clause forbids *"bypassing any of our systems or protective
  measures"*.
- [Usage Policy](https://www.anthropic.com/legal/aup) (effective 2025-09-15): it forbids
  *"Intentionally bypass capabilities, restrictions, or guardrails established within our products"*.
  The clause targets producing harmful output. A sanitiser that only removes data is not that.

**What it allows and forbids, plainly.** The vendor's own gateway page describes the exact configuration:
the unmodified CLI, the user's own subscription, and `ANTHROPIC_BASE_URL` pointing at a gateway that
passes the traffic on. That page states no prohibition. Nothing cited forbids an end user from running
his own local proxy for his own traffic. **The ambiguity is "intermediate".** Read literally, a local
proxy that receives and forwards the owner's OAuth token *intermediates* it. The sentence's subject is
"developers", and its context is serving other users. The owner would be both developer and sole user.
No cited text resolves that case, and Anthropic reserves enforcement without notice. So the civil risk
h3 names is **not ruled out on the Anthropic side.** It is an owner decision on evidence, not one this
record can close.

**OpenAI.**

- [Terms of Use](https://openai.com/policies/row-terms-of-use/) (effective 2026-01-01): *"You may
  not share your account credentials or make your account available to anyone else"*. Among the things
  a user may not do: *"Automatically or programmatically extract data or Output"* and *"Interfere with
  or disrupt our Services, including circumvent any rate limits or restrictions or bypass any
  protective measures or safety mitigations we put on our Services."*
- The Codex authentication page quoted under h2 names an LLM proxy as a supported use of ChatGPT
  sign-in.

**What it allows and forbids, plainly.** OpenAI documents a proxy under ChatGPT login as a supported
configuration. Nothing cited forbids a user's own local proxy. A proxy must not share the credential
with another person, extract Output programmatically, or bypass rate limits or safety mitigations. A
local sanitiser that only removes data does none of these.

### h4: which surfaces never pass through a local hook: **per surface**

"Local hook" here means a user-level hook this repository can install: Claude Code's
`~/.claude/settings.json` hooks, or Codex's `~/.codex/hooks.json` and `config.toml` hooks.

| Surface | Passes through a user-level local hook? | Evidence |
| --- | --- | --- |
| Claude Code CLI | **yes**, unless a project sets `disableAllHooks` (ADR-0016) | measured: hook routing on 2.1.285 (ADR-0013) |
| Claude desktop app, **Code** tab (local sessions) | **yes**: *"Hooks and skills defined in settings apply to both"* the CLI and Desktop | documented, [Desktop, "Shared configuration"](https://code.claude.com/docs/en/desktop). Not measured |
| Claude desktop app, **Chat** tab | **no**. The app talks to Anthropic directly, and no vendor page describes a hook or proxy for it. Local MCP servers from the desktop config do run locally, but they see tool calls, not prompts | no hook mechanism documented. Not measured |
| **Cowork**, on this machine | **not shown.** Local Cowork reads *"the MDM or OS-level policy and the managed settings file on that device"*, and it takes skills, plugins and connectors from the claude.ai account, *"not from the CLI's ~/.claude directory"*. Cowork's per-session settings files on this machine hold a `permissions` key and **no `hooks` key** (key names read only) | documented ([managed settings](https://code.claude.com/docs/en/managed-settings), [Desktop](https://code.claude.com/docs/en/desktop)); metadata measured. Whether the user-level hooks fire in Cowork was not exercised live |
| Cowork in a full VM sandbox (`requireCoworkFullVmSandbox`), and **remote** Cowork | **no**. In the VM sandbox *"the device's MDM policy and managed settings file aren't present"*. Remote sessions *"run on Anthropic-managed VMs, where Claude Code has no device policy to read"* | documented, [managed settings](https://code.claude.com/docs/en/managed-settings) |
| **Connectors** (remote MCP) in every Claude client | **no**: *"Claude connects to your remote MCP server from Anthropic's cloud infrastructure, rather than from your local device. This is true across every Claude client, including claude.ai, Claude Desktop, Cowork, and the mobile apps."* | documented, [custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) |
| claude.ai web, Claude mobile apps | **no**. They have no local process on this workstation | inferred from the architecture, and supported by the connectors page above. No vendor page states it for prompts |
| Claude Code cloud sessions (web, mobile, `--cloud`) | **no local hook**. They run on Anthropic's cloud VMs. A repository's hooks can run there, inside the cloud VM | documented, [Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web) |
| Remote Control (phone steering a local session) | **yes**: the session is local | documented, [Remote Control](https://code.claude.com/docs/en/remote-control). Not measured |
| Codex CLI and the Codex app in the ChatGPT desktop app | **yes**: they share `CODEX_HOME` and its hooks (see `docs/persistence-inventory.md`) | documented, [Codex hooks](https://developers.openai.com/codex/hooks). Not measured: ADR-0016's measured Codex control is a rules file, not a hook |
| Codex Cloud, ChatGPT web and mobile, the ChatGPT desktop **chat** surface | **no**. No user-level hook location is documented for them | still a hypothesis, on the ground that no vendor page names a local hook for these surfaces. None was looked for exhaustively |

### What this means for option 2, the local proxy sanitiser

**Technically viable under subscription login on both harnesses.** Each one sends its subscription
credential to the configured local endpoint, as measured, and each vendor documents that endpoint as
a gateway or proxy. **Not measured:** a proxy forwarding the rewritten request on to the vendor.
That run would spend quota and would need the proxy to hold the token.

**Terms:** OpenAI's documentation names the proxy case as supported. On Anthropic's side, the
"intermediate" clause leaves the case open. The decision stays with the owner (Decision outcome,
unchanged).

**Reach:** a proxy covers the CLIs, the desktop Code tab, and anything else that honours these
variables. It does **not** cover the surfaces h4 marks "no". Those stay outside the firewall, as the
Consequences already warn.

**And a cost the record did not have:** the routing that makes a proxy possible is the same routing
that sends the subscription credential to any host a base URL names. A proxy installed by this
repository would hold a live subscription token. That puts the workstation-security category from
`AGENTS.md` directly on the proxy.

Status stays **proposed**. No installer changed in this amendment.

## Links

- `AGENTS.md`, "Fundamental purpose" and "Principles", item 1.
- ADR-0001: the MADR discipline this record follows.
- ADR-0010 (the 2026-10-01 measurement method this amendment reuses). ADR-0013. ADR-0016. Issue #7.
- ADR-0007's 2026-10-01 amendment settles the default-model rows measured alongside this one.
