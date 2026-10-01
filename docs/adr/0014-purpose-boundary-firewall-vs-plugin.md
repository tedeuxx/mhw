# 0014 — Purpose boundary: this repository is the firewall, the plugin is the way of working

- **Status:** accepted (the owner's decision, 2026-10-01). The consequence "promote the firewall's
  controls to the managed layer" is **proposed**, not decided and not done.
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

Two of the owner's projects configure the same harnesses on the same workstation:

- **this repository**, the LLM firewall (`AGENTS.md`, "Fundamental purpose");
- **the `tadeumendonca-skills` plugin** (marketplace `tedeuxx/tadeumendonca-skills`), which customises
  how work is done: personas, the delivery loop, skills, and the plugin's own hooks.

Nothing said where one ends and the other begins. The owner:

> *"acho importante criar o conceito da diferença do propostio entre esse repo e o plugin. voce é o
> firewall. o skills é o harness configuration customizations. vc atua na ultima barreira de protecao
> pela hierarquizacao padrao de controle de toda industria de harness."*

("It is important to create the concept of the difference in purpose between this repo and the plugin.
You are the firewall. Skills is the harness configuration customisations. You act at the last barrier
of protection, by the standard control hierarchy of the whole harness industry.")

"Last barrier" has to be checked against how each harness actually resolves precedence, because the
answer is not the same for every kind of control.

## Decision drivers

- One owner for the protection floor, so no way-of-working change can quietly lower it.
- The plugin evolves fast. The firewall should not have to change when the plugin does.
- Report every control at its real evidence level (`AGENTS.md`, hard rules).

## Considered options

1. **Two projects, split by purpose (chosen).** This repository owns the protection floor. The plugin
   owns the way of working. The plugin may add controls but never weaken the floor. The firewall
   carries no way-of-working content. Trade-off: two places to read, and a control that serves both
   purposes needs a judgement call on where it lives.
2. **Fold the firewall into the plugin.** One install. But the plugin is public and opt-in per
   project, and it changes with every merge. The floor would then move whenever the way of working
   moves, and a project that does not install the plugin would get no floor at all.
3. **Fold the plugin's customisations into this repository.** One source. But the firewall would then
   carry personas and loop rules, and its review would mix "is this safe" with "is this a good way to
   work".

## Decision outcome

**Chosen: option 1.**

| Layer | Owns | May it weaken the floor? |
| --- | --- | --- |
| This repository (the firewall) | The personal protection floor: sanitising prompts, the third-party property line, its own hooks and deny rules once they exist | It *is* the floor |
| `tadeumendonca-skills` (the plugin) | The way of working: personas, the loop, skills, project hooks | No. It may add controls, never remove or relax one |
| A project's own harness config | That project's needs | No. It sits inside the floor (`AGENTS.md`, "The model") |

**Rule:** where the firewall and the plugin disagree on a protection, the stricter one applies. Where
the plugin needs the floor to be looser, that is a change to this repository, made here, with an ADR.

### How "last barrier" maps onto real precedence

"Last barrier" means the floor every session passes through, whatever the project or plugin says. It is
**not** the same as "highest precedence". In all three harnesses, user-level configuration, where this
repository installs today, is **low** precedence for overridable values. Only a system-managed layer
that needs admin rights is documented as non-overridable. Today the firewall installs one thing, the
global brief (ADR-0010), and that is an instruction, not an enforced control.

Evidence levels: *documented* means read from the vendor's documentation on 2026-10-01 at the URL
given. Nothing in this table was *measured* on this workstation.

| Harness | What the user level can and cannot hold | Non-overridable layer | Evidence |
| --- | --- | --- | --- |
| Claude Code | Overridable settings: a project value beats the user value. **Permission rules:** lists merge across levels, and deny is checked before allow, so a project cannot remove or carve out a user-level deny. The docs add that a Bash deny rule covers the invocation Claude usually produces and "isn't a security boundary around the program". **Hooks:** hooks merge across levels, **but a project setting `disableAllHooks: true` turns off user, project, local and plugin hooks**. What survives it is managed hooks, Agent SDK hooks, and hooks from plugins that managed settings force-enable. **Instructions:** user and project `CLAUDE.md` are concatenated, and when two instructions contradict each other "Claude may pick one arbitrarily". | Managed settings and managed `CLAUDE.md` in `/Library/Application Support/ClaudeCode/` on macOS (a system directory; writing it needs admin rights). Managed hooks survive a non-managed `disableAllHooks`. A managed `CLAUDE.md` cannot be excluded. | documented: [settings](https://code.claude.com/docs/en/settings#settings-precedence), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks), [`disableAllHooks`](https://code.claude.com/docs/en/settings-reference#disableallhooks), [memory](https://code.claude.com/docs/en/memory), [managed settings](https://code.claude.com/docs/en/managed-settings) |
| Codex | **Config:** a trusted project's `.codex/config.toml` overrides user config, except for a documented list of credential and provider keys. **Instructions:** `AGENTS.md` files are concatenated from global down to the working directory, and closer files override earlier guidance. At the global level Codex reads `AGENTS.override.md` if it exists, and otherwise `AGENTS.md`, using only the first non-empty file. So an override file, if present, makes Codex skip the rendered user brief, and `install.sh --check` does not watch for one. **Rules:** there is also a user-level `~/.codex/rules` layer. How it ranks against project rules is unmeasured and was not checked against the docs (hypothesis). | `requirements.toml`: on macOS and Linux `/etc/codex/requirements.toml` (a system directory; writing it needs admin rights), or delivered by MDM or the cloud. It constrains approval policy, sandbox mode, managed hooks, allowed MCP servers and plugin sources; a conflicting local value falls back to a compatible one. `managed_config.toml` holds only startup defaults, which the user can change during a run. | documented: [managed configuration](https://developers.openai.com/codex/enterprise/managed-configuration), [advanced config](https://developers.openai.com/codex/config-advanced), [AGENTS.md](https://developers.openai.com/codex/guides/agents-md) |
| Kiro | **Instructions:** when global steering (`~/.kiro/steering/`) and workspace steering conflict, "Kiro will prioritize the workspace steering instructions". "Team steering" pushed by MDM is still global steering. | **Unknown.** No non-overridable steering or hook layer was found in the documentation read. | documented for the steering rule: [steering](https://kiro.dev/docs/steering/). Managed layer: unknown. |

So, today: **the firewall is the last barrier by purpose, not yet by mechanism.** Its only installed
control is an instruction at user level, which a project instruction can contradict in all three
harnesses.

## Consequences

- Good: a single owner for the floor. A plugin change can no longer be the silent way a protection
  disappears, because it is out of the plugin's scope by rule.
- Good: the plugin can move fast without a firewall review, as long as it only adds.
- Bad: the rule "the plugin may not weaken the floor" is held by review, not by a mechanism. Nothing
  checks a plugin release against the floor.
- Bad: in Claude Code, a project's `disableAllHooks: true` turns off user-level and plugin hooks
  (documented). When this repository ships hooks at user level, any project can switch them off.
  A user-level deny rule cannot be switched off that way: the documentation says deny rules merge
  across levels and a project rule cannot carve one out. But a user-level deny, like every deny rule,
  is narrower than it looks: in the docs' own words it "isn't a security boundary around the
  program", so the same program invoked in another form is not covered.
- Bad: a user-level brief is low precedence for instructions in all three harnesses (documented). Not
  measured here: whether a project's `claudeMdExcludes` can exclude the user-level `CLAUDE.md`. The
  documentation exempts only the managed file from exclusion, which suggests the user file can be
  excluded. That is a hypothesis.
- Bad: in Codex, a `~/.codex/AGENTS.override.md`, if present, replaces the rendered user brief
  (documented), and `install.sh --check` reports OK regardless.
- **Proposed, not done: promote the firewall's deny rules and hooks to the managed layer.** For Claude
  Code: `/Library/Application Support/ClaudeCode/managed-settings.json` (and a managed `CLAUDE.md`). For
  Codex: `/etc/codex/requirements.toml`. That is the only documented way to make the floor
  non-overridable, which is what "last barrier" means. Costs: it needs admin rights to install and to
  change; it is a new tool-class for this repository (a system-level installer); and it makes undoing a
  mistake harder, by design. Prerequisite: the firewall has no deny rules or hooks yet, so there is
  nothing to promote until it does. Kiro has no known equivalent.

## Links

- `AGENTS.md`, "Fundamental purpose" and "The model: corporate workstation governance, applied to one
  person". ADR-0006 (coverage scope). ADR-0010 (global brief rendering).
