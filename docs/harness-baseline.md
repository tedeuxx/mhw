# Harness and customization: the working baseline

The owner requested this baseline on 2026-10-02, using `tadeumendonca-io` and
`tadeumendonca-skills` as references for his experience. This is a shared vocabulary for the setup
interview, not an assessment of his expertise or a new permission policy.

## Start from the existing experience

The skills repository's README separates **solution**, **customization** and **runtime**. Its opening
sections describe the site as a consumer, the plugin as reusable agent configuration, and Claude Code
as the runtime. That is the foundation here; the workstation repository adds the personal policy
and configuration source that applies across projects and runtimes.

| Term | Meaning in this setup | Concrete example |
| --- | --- | --- |
| Model | The inference engine used by a session | A selected provider model and its reasoning-effort setting |
| Harness | The software around the model that manages sessions, context, tool execution and permissions | Claude Code CLI, Codex CLI, Kiro CLI; desktop agent surfaces must be checked by mode |
| Harness customization | Instructions and configuration that shape how that runtime works | Briefs, skills, commands, personas, hook registrations, MCP definitions, permissions and defaults |
| Plugin | A distribution package for related customizations | `tadeumendonca-skills` |
| Project | The actual work and its local constraints | `tadeumendonca-io`, a consumer of the plugin |
| Workstation profile | Personal preferences, protections and defaults intended to follow the owner between projects | This repository's global policy and owner overlay |
| Session | One effective combination of runtime, model, loaded instructions, tools and permissions | A fresh session used to verify the installed configuration |

The subscription determines available access and limits; it is not the harness or the configuration.
Changing the model does not migrate the surrounding tools, permissions or workflow.

## What the customizations do

- **Briefs and steering** supply instructions and context. Loading them does not prove obedience.
- **Skills** package reusable knowledge or procedures. Discovery, invocation and successful execution
  are separate events.
- **Commands** give the human a repeatable entry point into a procedure. The skills repository has
  command files for autonomy, blueprint and sprint activities; native invocation syntax and transport
  still depend on the destination harness.
- **Personas/subagents** separate responsibilities and context. A role description does not itself
  establish a tool permission or enforce reviewer independence.
- **MCPs** expose integration capabilities. A connected server does not authorize every operation.
- **Permissions and hooks** can gate actions when the runtime actually supports and invokes them.
  A model agreeing to a rule is not the same as an external check refusing the action.
- **Model and effort defaults** select how new sessions begin. Their effective values need checking
  after startup, including account restrictions and session overrides.

## Responsibilities across the three repositories

| Repository | Responsibility | What should not be copied into it automatically |
| --- | --- | --- |
| This workstation repository | Personal policy, conversation preferences, integration source, authorization intent, session defaults and installers | A project's whole delivery process or account credentials |
| `tadeumendonca-skills` | Reusable engineering knowledge, commands, roles and delivery workflow | Personal account state or a weaker personal protection floor |
| `tadeumendonca-io` | Product requirements, project instructions, validation and deployment constraints | A second independently maintained copy of the personal profile |

These are configuration responsibilities, not a claim about native precedence. Actual precedence,
hook execution and protection against project overrides must be established per harness.

Borrow the references' patterns: explicit responsibility, one owner decision at a time, reusable
procedures, review distinct from CI, and truthful evidence levels. Do not automatically import their
engineering workflow into every personal task. This repository's current privacy and protection
rules remain authoritative when a reference uses a different policy.

## What alignment means

The target is the same **intent and observable behavior** where each harness can support it, with
explicit differences where it cannot. It is not identical configuration files or identical model
names. For each feature, distinguish **written**, **installed**, **loaded** and **enforced**; a UI
setting and a runtime test answer different questions.

Use this vocabulary during calibration: first define the desired behavior, then choose its owning
layer, map the native mechanism, and verify it in a fresh session. Explain the consequence to the
owner before naming a setting, command or issue number.

## Source scope

Read from the local checkouts on 2026-10-02, without modifying either reference repository:

- [Skills README](https://github.com/tedeuxx/tadeumendonca-skills/blob/06371da73a52ae5a116d85dce07ddaccb31e27c2/README.md),
  especially “One of three pillars” and “What travels if this design moves to another harness”;
  its root `AGENTS.md` and command filenames were also inspected.
- [Site brief](https://github.com/tedeuxx/tadeumendonca-io/blob/04dcb4ef6b61e4869e40b0f0a095ef30f27ed65a/AGENTS.md)
  and README; project configuration was inspected only for relevant key locations.

These are source readings, not fresh tests of those repositories' runtime or published deployment.
For the proposed workstation implementation, see [ADR-0018](adr/0018-portable-personal-profile-and-unified-harness-management.md).
