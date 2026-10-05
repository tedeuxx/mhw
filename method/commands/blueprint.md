---
name: "blueprint"
description: "Carry a project's agent harness setup between projects as a requirements document. export writes the effective setup as docs/<repo>-product-requirements-document-agent-harness-setup.md; import reads such a document and changes nothing before an alignment interview, then turns what was agreed into Issues. Use when the owner wants to copy a setup to or from another project."
purpose: "a project's effective agent harness setup travels to other projects in the document format every repository already uses"
argument-hint: "export | import <path to the requirements document>"
---

Run `$ARGUMENTS`: `export`, or `import <path>`. With no argument, ask which one, with `export`
recommended.

## export

Write the **effective** agent harness setup of the current project, the one a session here actually
runs with, as a requirements document.

1. **Read what is in effect**, layer by layer, and note where each part comes from: the user-level brief,
   the project brief (`AGENTS.md`, `CLAUDE.md`, steering), the settings and permission layers, agents,
   skills, commands, hooks, MCP server names, and the delivery route. Where the project offers a runtime
   summary command, use its output.
2. **Write** `docs/<git-repo-name>-product-requirements-document-agent-harness-setup.md`, following
   `documentation-standard`:
   - the **target behaviour and why** of each part, in English;
   - one Mermaid diagram of the layers, stacked and labelled;
   - each control at its real evidence level (written, installed, loaded, enforced) and per agent harness;
   - what the importer must supply locally (accounts, secrets by name, paths), as a list of inputs.
3. **Sanitise:** no secret values, no personal data, no client or employer material, no machine-specific
   paths beyond placeholders. Name a secret by its name and location only.
4. Show the path and a three-line summary. Deliver it through the repository's own route.

## import

Read a requirements document in that format (`$ARGUMENTS` after `import`) and bring it into the current
project. **Nothing is changed before the alignment interview is complete**: no file, setting, label or
Issue.

1. **Read** the document and the current project's effective setup (as in `export`, step 1).
2. **Compare:** list what the document adds, what it changes and what conflicts with this project.
3. **Run the alignment interview** (next section).
4. **Record the agreement:** write the agreed target as this project's own requirements document,
   then offer `idea-to-issues` to turn it into tracked work. The changes are built by the loop, through
   the repository's normal gates, never applied by this command.

## Alignment interview

- With the person running the session, before anything changes: what they expect the imported setup to
  do here, and each add, change and conflict from step 2, each with a recommended answer.
- One question per message where the workstation's brief limits asks.
- An item they do not accept is left out and written down as left out, with the reason.
- The interview is complete only when every item from step 2 has an answer.

## What this command never does

- It never merges, publishes or releases anything, and it never adds a hook.
- `import` never writes a file or setting before the interview is complete, and never applies a
  configuration change directly: changes go through Issues and the normal gates.
- `export` never copies a secret value, personal data or third-party material into the document.
