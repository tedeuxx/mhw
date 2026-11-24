---
name: "onboard"
description: "Onboard a repository onto the documentation baseline: validate docs/documentation-baseline.json and the five baseline items read-only and report each gap, or, when asked to scaffold, first write the missing default files (never one that exists, never an ADR record). Use when a repository is new to the method, when the owner asks what documentation a repository is missing, or before its first pull request runs the delivery gates Action's docs-baseline gate. It reports; it opens no Issue and posts nothing."
purpose: "a repository can be brought onto the documentation baseline from inside any agent harness, with no CLI in the path, and the delivery gates Action stays the one authority that judges it"
---

# Onboard: the documentation baseline, validated or put in place

**What this does.** It reads one repository (the project) against the documentation baseline the
`documentation-standard` skill declares (*The documentation baseline*), and reports each gap as one
line. Asked to scaffold, it first writes the missing files of the default proposal. It was
`mhw onboard [--project=DIR] [--scaffold]` until mhw#599; this skill carries the procedure that command
ran, and you run it yourself.

**What decides, and what does not.** **The delivery gates Action is the authority**: its
`docs-baseline` gate judges the manifest and every pull request against it, and its `contract` gate
validates `project-policy.json`. This skill is the onboarding read before those gates run. Where it
and a gate disagree, the gate wins, and the disagreement is a finding to report.

**Default: read-only.** Scaffold only when the owner, or the task you were given, asks for it.

## 1 · The project

The project is the repository the owner named, else the current working tree's top
(`git -C <dir> rev-parse --show-toplevel`). Resolve it to its real path. If it is not an existing
directory, say so in one line and stop.

## 2 · Scaffold, only when asked

**Never write a file that exists. Never write through a directory that resolves outside the project.
Never write an ADR record.** Decide all three for every file **before you create anything**: a check
made after creating a directory through a link has already written outside.

1. **The manifest to scaffold from.** When `docs/documentation-baseline.json` exists, use it (it must be
   a valid manifest, step 3; if it is not, scaffold nothing and report it). Otherwise use the default
   below, and write it too.
2. **The files**, for each baseline item that is a path (an item declared
   `{"not_applicable": "<reason>"}` gets no file), with `<name>` the project directory's name in
   lowercase, every run of other characters a single hyphen, and `project` when nothing is left:
   - the README, the requirements document, the ADR library's `README.md` and `template.md`, the
     architecture and the sequences documents, with the contents in *The scaffold's contents* below;
   - the manifest itself, only when none existed.
3. **The checks, for every file, before anything is written:**
   - it does not exist yet, and is not a symbolic link (a dangling one included);
   - the nearest ancestor of its directory that exists resolves (`realpath`) to the project or a
     directory under it;
   - it is not at or under the ADR library, compared case-folded on the resolved path, unless it is the
     library's `README.md` or `template.md`. A record earns its place by explaining the current code, so
     the scaffold never writes one, not even a placeholder.

   If any file fails the second or third check, write nothing and report it. A file that exists is
   skipped, not an error.
4. **Write the rest**, each with `WROTE <path>`; when none was missing, `NOTE  nothing to write: every
   baseline file exists`.

### The default manifest

```json
{
  "schema_version": 1,
  "baseline": {
    "readme": "README.md",
    "prd": "docs/<name>-product-requirements-document-project.md",
    "adr_library": "docs/adr",
    "architecture": "docs/architecture.md",
    "sequences": "docs/sequences.md"
  },
  "capabilities": [
    { "id": "project", "code": ["**"], "docs": ["README.md", "docs/<name>-product-requirements-document-project.md", "docs/**"] }
  ]
}
```

### The scaffold's contents

With `<prd>` and `<adr>` the manifest's paths, `<prd-to-adr>` the ADR library relative to the
requirements document's directory:

- **README**: `# <name>`, then *What this project is and what it does today, mirroring its
  requirements document, `[<prd>](<prd>)`. Keep the two in step: a change that alters what the
  project does updates both.*, then `## Decisions` and *The decision records are in `[<adr>](<adr>/README.md)`.*
- **Requirements document**: `# <name> Product Requirements Document: project`, the empty headings
  `## Problem`, `## Users`, `## Requirements`, `## Out of scope`, then `## Decisions` and *Significant
  decisions are recorded in `[the ADR library](<prd-to-adr>/README.md)`.*
- **ADR index** (`<adr>/README.md`): `# Decision records`, *The Architecture Decision Records of this
  repository, in MADR format. Copy `[template.md](template.md)` for a new one. A record is written only
  when a significant decision explains the current code; there is no record yet.*, then `## Index` and
  the empty table header `| Record | Decision | Status |`.
- **ADR template** (`<adr>/template.md`): `# NNNN — Title of the decision`, the lines `- Status:
  proposed`, `- Deciders:`, `- Date:`, then the MADR headings `## Context and problem`, `## Decision
  drivers`, `## Considered options`, `## Decision outcome`, `## Consequences` (with `Good:` and `Bad:`)
  and `## Links`.
- **Architecture**: `# Architecture`, *Read bottom-up. Replace each layer with this project's own.*, a
  ` ```mermaid ` `block-beta` diagram of one column with three layers (`Application · project
  contributors`, `Runtime · project contributors`, `Platform · vendor`) in the `documentation-standard`
  palette, and its legend line.
- **Sequences**: `# Sequences`, *One flow per diagram, left to right. Replace the steps with this
  project's own.*, and a ` ```mermaid ` `flowchart LR` of four steps (`Request`, `Validate`, `Store`,
  `Respond`).

## 3 · Validate, read-only

Report one line per finding, in this order. `OK` is a pass, `GAP` a gap, `NOTE` information that is
neither.

1. **The manifest**, `docs/documentation-baseline.json`. It is valid when it is a JSON object with
   exactly `schema_version` (the number `1`), `baseline` and `capabilities`:
   - `baseline` holds exactly `readme`, `prd`, `adr_library`, `architecture` and `sequences`. Each is a
     repository-relative path (no leading `/`, no empty, `.` or `..` segment, only `A-Z a-z 0-9 _ . @
     + / -`); `architecture` and `sequences` may instead be exactly `{"not_applicable": "<reason>"}`,
     the reason carrying a letter or digit; `prd` is named
     `docs/<repo>-product-requirements-document-<subject>.md`;
   - `capabilities` is a non-empty array of objects with exactly `id` (lowercase letters, digits and
     hyphens, not repeated), `code` and `docs` (each a non-empty array of globs: the path characters
     plus `*` and `?`, and `**` only as a whole segment).

   Valid: `OK    docs/documentation-baseline.json is a valid manifest, <N> capabilities`. Missing, not
   JSON or invalid: `GAP   <what is wrong>; the delivery gates Action's docs-baseline gate will refuse
   it`, then `NOTE  the items below are checked against the default baseline`, and use the default
   manifest above for the rest.
2. **The items.** Each path item must be a regular file: `OK    <label>: <path>` or `GAP   <label>:
   <path> is missing`, for the README, the requirements document, the ADR library index
   (`<adr>/README.md`) and the ADR template (`<adr>/template.md`). The architecture and sequences
   documents must also carry a line that is exactly ` ```mermaid ` (trailing blanks aside), else `GAP
   <key> diagram: <path> carries no ```mermaid block`. A not-applicable item is `NOTE  <key>: not
   applicable, <reason>`.
3. **Coverage, only with a valid manifest and only when the project is the top of a git repository.**
   List the tracked files (`git -C <project> ls-files`). A file belongs to a capability when one of its
   `code` or `docs` globs matches it: `**` is zero or more whole segments, `*` and `?` stay inside one
   segment, nothing else is special. Every tracked file outside every capability is a gap: `GAP   <n>
   tracked file(s) outside every capability, first: <up to five>`; else `OK    every one of <n> tracked
   files belongs to a capability`. Then `NOTE  tracked files each capability owns (first match):
   <id> <count>, … of <n>`, counting each file under the first capability, in manifest order, whose
   `code` matches it: a catch-all that owns most of the tree means almost any document edit satisfies
   almost any change. When the project is not a repository top: `NOTE  coverage not checked: <project>
   is not the top of a git repository`.
4. **`project-policy.json`, when the project has one.** Each path in its
   `baseline_override.documentation.additional_docs` is checked as an item (`additional document
   (project-policy.json)`). If the file is not JSON: `GAP   project-policy.json is not JSON; validate it
   with the delivery gates Action's contract gate`. In every case: `NOTE  project-policy.json is
   present; the delivery gates Action's contract gate validates it, this skill does not`.
5. **The total**: `GAP   <n> gap(s) in the documentation baseline`, or `OK    the documentation baseline
   is complete`.

## What holds this, at its real level

**An instruction.** Nothing runs these steps for you, and nothing checks that you ran them all: the
gaps you report are your reading of the tree. The checks that *are* mechanical run later, on every pull
request, in the delivery gates Action (`docs-baseline` and `contract`), and they are why a missed gap
here still surfaces. The write checks in step 2 are yours to make before writing; no layer refuses a
write through a link, so the order you make them in is the whole of that protection.

## What this skill never does

- It opens no Issue and posts nothing. A gap goes to the owner in your reply.
- It never overwrites a file, and never writes an ADR record.
- It never changes `project-policy.json` and never judges it: that is the Action's `contract` gate.
