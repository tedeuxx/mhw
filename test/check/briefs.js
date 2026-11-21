// Synthetic project briefs for the merge-authority tests (#494, S23 of #470), moved from
// global/merge_authority_test.py with the suite. They name no project.

// The pre-fix "Merge classes" section of a consuming web-product project's root brief, byte for byte as it
// stood at the intake commit of #195. It names no project; the regression the suite exists for is this
// text staying green.
export const LEGACY_SECTION = `## Merge classes

**Loop model: \`trunk-single-env\`** — one branch, one environment, merge request to \`main\` to deploy.
The integration-branch and staging half of the platform's loop skills does not apply; where a platform
skill and this file disagree, this file wins.

The merge **is** the deploy, and the quality-assurance gate holds it. It runs on every merge request,
verifies the Definition of Done with evidence, then merges the **safe class** or escalates the
**boundary class** to the owner (ADR-0003 and its amendments are operative; read them to classify).

- **Safe:** docs, dependency bumps, tests, in-pattern work on an approved spec, the whole \`product\`
  backlog **including what a reader sees**, an amendment that decides something, and a record
  correction that only points at a ratified decision.
- **Boundary:** a merge touching \`iac/\` (confirm the plan first); anything threatening the site's
  continuity; any change to how work is decided; **publishing an article** (the owner's voice).
- **Unclear means boundary.** The gate never merges an expansion of its own authority. The owner
  ratifies by commenting on the merge request and the gate verifies that comment; a relay is never the
  authority.
- **\`reader-facing\` is an ordering and lens signal, not a gate**; the gate still dispatches the product
  lead's copy lens on such a diff.

**Known residue:** social scrapers pin the first card they fetch, so a wrong unfurl stays wrong on an
already-shared post. Bounded and accepted.
`;

export const BLOCK = `<!-- merge-authority:begin -->
- contract: merge-authority v1
- loop-model: trunk-single-env
- boundary-trigger: a merge touching \`iac/\` (confirm the plan first)
- boundary-trigger: anything threatening the site's continuity
- boundary-trigger: any change to how work is decided
- boundary-trigger: publishing an article (the owner's voice)
<!-- merge-authority:end -->
`;

// The corrected section: same project triggers, the block, and a reference instead of a restatement.
export const CORRECTED_SECTION = `## Merge classes

**Loop model: \`trunk-single-env\`** — one branch, one environment, merge request to \`main\` to deploy.

` + BLOCK + `
Who merges, under which verdict, and the human holds are the workstation method's \`merge-authority\`
contract; this file only classifies.

- **Safe:** docs, dependency bumps, tests, in-pattern work on an approved spec.
- **Unclear means boundary.**
`;

export const HISTORY = `
## History (compliant: none of this is live)

~~The gate escalates the **boundary class** to the owner.~~ Struck when the method took merge authority.

> The gate never merges the boundary class; where a platform skill and this file disagree, this file wins.

His words then: "the gate escalates the boundary class to the owner".

\`\`\`
<!-- merge-authority:begin -->
- executor: owner
<!-- merge-authority:end -->
The boundary class is escalated to the owner.
\`\`\`

<!-- the gate escalates the boundary class -->
`;

// A synthetic brief that describes a release candidate in its prose (the integration-branch case), standing
// in for this repository's own AGENTS.md, which changes from release to release.
export const RC_BRIEF = `# a project

Agents merge slices into \`rc/next\`; only the release candidate waits for the owner.
The release candidate is the pull request \`rc/next\` -> \`main\`.
`;

/** The project brief a check reads: a heading, then the text. @param {string} text */
export const brief = (text) => '# a project\n\n' + text;
