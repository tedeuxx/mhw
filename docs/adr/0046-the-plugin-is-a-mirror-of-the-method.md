# ADR-0046: The method's agent briefs name tadeumendonca-skills as its plugin-form mirror, and the evidence their old notice carried lives here

- **Status:** ~~proposed~~ accepted (2026-11-23, the owner's ratification on
  [PR #601](https://github.com/tedeuxx/mhw/pull/601#issuecomment-7110437425): «Ratificado»). The decision is his ruling of 2026-11-23 on
  [Issue #579](https://github.com/tedeuxx/mhw/issues/579); the text was written by `agents-lead`.
- **Date:** 2026-11-23
- **Deciders:** the owner (the premise and the ruling); written by `agents-lead`, the lens for the
  `loop` lane
- **Issue:** [#579](https://github.com/tedeuxx/mhw/issues/579) (from the audit on
  [#571](https://github.com/tedeuxx/mhw/issues/571))
- **Builds on:** [ADR-0032](0032-this-repository-is-the-single-source-of-the-working-method.md)

## Context and problem

Seven of the eight agent briefs in `method/agents/` opened with a notice saying their text *"moved from
the `tadeumendonca-skills` plugin"*, under a heading that called the hooks it names those of a plugin
no longer maintained. Issue #579 was filed to delete that notice, on the same premise.

The premise is false. In the owner's words (Portuguese, verbatim): *«o tadeumendonca-skills é uma forma
alternativa de distribuicao (plugin de harness). deveria espelhar tudo que possivel que o mhw mantem
automaticamente. esse era o design.»* In English: tadeumendonca-skills is an alternative form of
distribution, a harness plugin; it should mirror everything it can of what mhw maintains, automatically;
that was the design. ADR-0032 already records it: *"the weekly tadeumendonca-skills sprint regenerates
the plugin."* Asked again with the correct premise, he chose «Corrigir o texto» (correct the text).

The repository is live and still ships the hooks the notice names (measured 2026-11-23):

```
gh repo view tedeuxx/tadeumendonca-skills --json isArchived --jq .isArchived
# -> false
git -C <tadeumendonca-skills checkout> ls-tree --name-only origin/main hooks/scripts/ | grep 'guard\.sh$'
# -> closure-artifact-guard.sh, hitl-one-question-guard.sh, mcp-guard.sh, permission-guard.sh
#    (origin/main at cd25a4dfb3ef91e4fdad6617c62b71fb37c081f4, fetched copy; not re-fetched)
```

## Decision drivers

- An agent brief loads on every dispatch, so a false sentence in its first lines misleads every agent.
- mhw is the source; the plugin is a rendering of it for one harness. The text must say that direction.
- The notice still has a job: the briefs name the plugin's hooks, and none of those runs in this method.
- An evidence command in a brief must run, or say that it no longer does.

## Considered options

1. **Correct the notice; move the evidence it carried here.** *(Chosen.)* The notice keeps its job
   (which hooks are not controls you have) and states the direction: the source is `method/` in
   `tedeuxx/mhw`, and `tedeuxx/tadeumendonca-skills` is its plugin-form mirror. Cost: one more record,
   and the briefs cite it.
2. **Delete the notice and the evidence commands, evidence here** (the Issue's original outcome). Lost:
   it rested on the false premise, and an agent reading a plugin hook name with no notice would take it
   for a control it has.
3. **Leave the text.** Lost: the notice describes the mirror wrongly on every dispatch.

## Decision outcome

Option 1. Each of the seven briefs now opens with:

> **Read this first: hooks named below are the plugin mirror's, not controls you have (#61).** The
> source of this text is the `method/` directory of `tedeuxx/mhw`; `tedeuxx/tadeumendonca-skills` is its
> plugin-form mirror, a Claude Code plugin that carries as much of what mhw maintains as it can (the
> workstation repository's ADR-0046). …

The rest of each notice is unchanged. The same correction reaches the sentences that called the
plugin's rule 5e, its guard or its hooks retired: they do not run in this method, and the mirror still
runs them (`git -C <tadeumendonca-skills checkout> show origin/main:hooks/scripts/permission-guard.sh |
grep -n '5e'` finds the rule at cd25a4df). `test/render/mirror-notice.test.js` fails when a brief in
`method/agents/` carries the old notice wording, or describes the mirror, its rules or its hooks as
retired, archived, deprecated or dead.

## The evidence the briefs carried

Every reference to the mirror in `method/`, found with:

```
grep -rn 'tadeumendonca-skills' method/
```

50 lines at `origin/rc/next` 4bf6f36c, before this change. Each command below was run on 2026-11-23.

1. **The terminal-instruction report, in `agents-lead` and `product-lead`.** The briefs said *"Read that
   report with `gh issue view 393 --repo tedeuxx/tadeumendonca-skills --json body --jq .body`"*. **That
   command no longer runs:** it returns *"Could not resolve to an issue or pull request with the number
   of 393"*. The Issue was transferred to mhw with the other `loop` Issues;
   [`docs/loop-issue-transfer-map.md`](../loop-issue-transfer-map.md) maps `tadeumendonca-skills#393` to
   `mhw#341`. The working command, now in both briefs:

   ```
   gh issue view 341 --repo tedeuxx/mhw --json body --jq .body
   ```

   A bare `#393` read in mhw names a different Issue (`mhw#393`, the milestone routes), so every bare
   `#393` in `method/agents/` that meant this report now reads `mhw#341`.
2. **The marker counts in the same section.** The briefs say `gh pr view <n> --json comments --jq
   '[.comments[]|select(.body|test("harness-lead-verdict"))]|length'` returns 1, 2 and 1 on
   `-skills`#417, #415 and #414, and 3 on #348. Run from an mhw checkout with no repository flag, it
   reads mhw's pull requests instead. With the flag it reproduces:

   ```
   for n in 417 415 414 348; do gh pr view $n --repo tedeuxx/tadeumendonca-skills --json comments \
     --jq '[.comments[]|select(.body|test("harness-lead-verdict"))]|length'; done
   # -> 1 2 1 3
   ```

   The briefs' wording is left as it is in this change; see Consequences.
3. **The notice count.** `grep -c 'text moved from the .tadeumendonca-skills. plugin' method/agents/*.md`
   gave 1 in each of seven briefs and 0 in `tech-lead`; it gives 0 in all eight after this change.

## What was left, and why

- **The evidence inside `quality-assurance`'s hold 2** (the clauses *"Measured 2026-09-27:"*, *"excluded
  by the `powers/` prefix"*, *"the 60 most recent PRs of `tadeumendonca-skills`"* and the
  `gh pr view 454` and `gh pr view 493` commands). Hold 2 is being rewritten by PR #586 (#574), and the
  owner's ruling on that PR keeps the mirror's manifest as a hold-2 signal. These are live provenance of
  a check that reads the mirror, not text about where the briefs came from.
- **The same notice in skills and commands** (`method/skills/*/SKILL.md`, `method/commands/*.md`). The
  ruling and this slice cover the agent briefs. A test pins the rites' notice heading
  (`test/render/method-commands.test.js`), so correcting them is its own change.
- **Live provenance and sync:** `method/README.md` (where the method came from, #61), the worklog
  fixtures under `method/scripts/fixtures/worklog/` (recorded events whose `repository` field is the
  mirror), and the method-to-mirror Issue sync (`.github/workflows/method-issue-sync.yml`). They
  describe the mirror correctly or record what happened.

## Consequences

- Good: the briefs state the direction of the mirror; a broken evidence command is replaced by one
  that runs; a test keeps the old notice wording out of the agent briefs.
- Bad: the notice is two lines longer in seven briefs, loaded on every dispatch.
- Bad: skills and commands still carry the old notice and its heading until their own change.
- Bad: the marker-count sentence in `agents-lead` and `product-lead` still gives a command with no
  repository flag; item 2 above is its working form.
- The test checks wording, not truth: it cannot tell whether the mirror really carries what mhw
  maintains.

## Links

- Issue [#579](https://github.com/tedeuxx/mhw/issues/579) and the owner's ruling on it.
- Audit: [#571](https://github.com/tedeuxx/mhw/issues/571#issuecomment-7103806097).
- [ADR-0032](0032-this-repository-is-the-single-source-of-the-working-method.md).
- [`docs/loop-issue-transfer-map.md`](../loop-issue-transfer-map.md).
