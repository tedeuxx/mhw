#!/usr/bin/env python3
"""Suite for the merge-authority contract (#195): the method's operational copies against the canonical
contract, and `mhw check --project=DIR` against a project brief. Throwaway HOMEs and project directories
only; nothing outside TMPDIR is written.

    python3 -B global/merge_authority_test.py

Every negative case mutates the SUBJECT (a method file's text, a project brief, an installed copy), asserts
red, restores it and asserts green. These are checks over strings and one bounded block: they cannot
observe a gate follow the contract, and a paraphrase outside the parsed surface stays a false negative
(asserted below, so the limit is visible).
"""
import contextlib
import io
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "workspace"))
import merge_authority as ma  # noqa: E402
import workstation as ws  # noqa: E402
import delivery  # noqa: E402

SKILL = REPO / "method" / "skills" / "merge-authority" / "SKILL.md"
CONTRACT = ma.parse_contract(SKILL.read_text(encoding="utf-8"), "source")
TRUNK = CONTRACT["models"]["trunk-single-env"]
# Each operational copy, and the verdicts it must still name outside its projection block. quality-gates
# names only the boundary literal in its prose; the projection block carries the rest.
CONSUMERS = {
    "method/agents/quality-assurance.md": CONTRACT["verdicts"],
    "method/skills/agents-configuration/SKILL.md": CONTRACT["verdicts"],
    "method/commands/autonomy.md": CONTRACT["verdicts"],
    "method/skills/quality-gates/SKILL.md": [TRUNK["boundary"]],
}

# The pre-fix "Merge classes" section of a consuming web-product project's root brief, byte for byte as it
# stood at the intake commit (the three green PRs that came back APPROVE-PENDING-HUMAN were reviewed under
# it). It names no project; the regression this suite exists for is this text staying green.
LEGACY_SECTION = """## Merge classes

**Loop model: `trunk-single-env`** — one branch, one environment, merge request to `main` to deploy.
The integration-branch and staging half of the platform's loop skills does not apply; where a platform
skill and this file disagree, this file wins.

The merge **is** the deploy, and the quality-assurance gate holds it. It runs on every merge request,
verifies the Definition of Done with evidence, then merges the **safe class** or escalates the
**boundary class** to the owner (ADR-0003 and its amendments are operative; read them to classify).

- **Safe:** docs, dependency bumps, tests, in-pattern work on an approved spec, the whole `product`
  backlog **including what a reader sees**, an amendment that decides something, and a record
  correction that only points at a ratified decision.
- **Boundary:** a merge touching `iac/` (confirm the plan first); anything threatening the site's
  continuity; any change to how work is decided; **publishing an article** (the owner's voice).
- **Unclear means boundary.** The gate never merges an expansion of its own authority. The owner
  ratifies by commenting on the merge request and the gate verifies that comment; a relay is never the
  authority.
- **`reader-facing` is an ordering and lens signal, not a gate**; the gate still dispatches the product
  lead's copy lens on such a diff.

**Known residue:** social scrapers pin the first card they fetch, so a wrong unfurl stays wrong on an
already-shared post. Bounded and accepted.
"""

BLOCK = """<!-- merge-authority:begin -->
- contract: merge-authority v1
- loop-model: trunk-single-env
- boundary-trigger: a merge touching `iac/` (confirm the plan first)
- boundary-trigger: anything threatening the site's continuity
- boundary-trigger: any change to how work is decided
- boundary-trigger: publishing an article (the owner's voice)
<!-- merge-authority:end -->
"""

# The corrected section: same project triggers, the block, and a reference instead of a restatement.
CORRECTED_SECTION = """## Merge classes

**Loop model: `trunk-single-env`** — one branch, one environment, merge request to `main` to deploy.

""" + BLOCK + """
Who merges, under which verdict, and the human holds are the workstation method's `merge-authority`
contract; this file only classifies.

- **Safe:** docs, dependency bumps, tests, in-pattern work on an approved spec.
- **Unclear means boundary.**
"""

HISTORY = """
## History (compliant: none of this is live)

~~The gate escalates the **boundary class** to the owner.~~ Struck when the method took merge authority.

> The gate never merges the boundary class; where a platform skill and this file disagree, this file wins.

His words then: "the gate escalates the boundary class to the owner".

```
<!-- merge-authority:begin -->
- executor: owner
<!-- merge-authority:end -->
The boundary class is escalated to the owner.
```

<!-- the gate escalates the boundary class -->
"""


class Env:
    """A throwaway HOME with the installed skill copies, and a throwaway project."""

    def __init__(self, harnesses=("Claude Code", "Codex", "Kiro")):
        self.base = Path(tempfile.mkdtemp(prefix="merge-authority-"))
        self.home = self.base / "home"
        self.project = self.base / "project"
        self.project.mkdir(parents=True)
        for name, path in ma.installed_skill_paths(self.home):
            if name in harnesses:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("---\nmanaged-by: x\n---\n" + SKILL.read_text(encoding="utf-8"), encoding="utf-8")

    def brief(self, text):
        (self.project / "AGENTS.md").write_text("# a project\n\n" + text, encoding="utf-8")

    def check(self):
        return ma.check_project(self.project, self.home)

    def close(self):
        shutil.rmtree(self.base, ignore_errors=True)


class MethodCopiesMatchTheContract(unittest.TestCase):
    def test_the_contract_maps_both_models(self):
        self.assertEqual(sorted(CONTRACT["models"]), ["gitflow-multi-env", "trunk-single-env"])
        self.assertEqual(TRUNK["executor"], "quality-assurance")
        self.assertEqual(TRUNK["holds"], ["gate-authority", "harness-marker", "iac", "lens-escalate"])
        self.assertEqual(TRUNK["boundary"], "APPROVE-AND-MERGE-BOUNDARY")
        gitflow = CONTRACT["models"]["gitflow-multi-env"]
        # The trunk executor rule is not imported: in gitflow the boundary class is itself a hold.
        self.assertEqual(gitflow["boundary"], "APPROVE-PENDING-HUMAN")
        self.assertIn("boundary-class", gitflow["holds"])
        self.assertEqual(gitflow["promotion-executor"], "owner")
        # The rc/next variant (scm): a declared integration branch adds the release-candidate hold.
        variant = TRUNK["with-integration-branch"]
        self.assertEqual(variant, {"holds": ["release-candidate"], "promotion-executor": "owner"})
        self.assertIn("release candidate", ma.projection(CONTRACT))

    def test_every_operational_copy_is_green(self):
        for rel, verdicts in CONSUMERS.items():
            with self.subTest(rel):
                text = (REPO / rel).read_text(encoding="utf-8")
                self.assertEqual(ma.method_copy_findings(text, CONTRACT, verdicts), [])

    def test_every_copy_goes_red_on_each_mutation_and_green_on_restore(self):
        # Scenario 6: an executor, a verdict literal and a hold, mutated in each copy independently.
        mutations = [
            ("`quality-assurance` merges what it clears", "`owner` merges what it clears", "executor"),
            ("boundary class -> `APPROVE-AND-MERGE-BOUNDARY`", "boundary class -> `APPROVE-PENDING-HUMAN`",
             "verdict"),
            ("(3) anything in `iac/`; ", "", "hold removed"),
            ("4 holds -> ", "5 holds -> ", "hold count"),
        ]
        for rel, verdicts in CONSUMERS.items():
            original = (REPO / rel).read_text(encoding="utf-8")
            for old, new, what in mutations:
                with self.subTest(rel=rel, mutation=what):
                    self.assertIn(old, original)
                    mutated = original.replace(old, new, 1)
                    self.assertTrue(ma.method_copy_findings(mutated, CONTRACT, verdicts), "stayed green")
                    self.assertEqual(ma.method_copy_findings(original, CONTRACT, verdicts), [])
            with self.subTest(rel=rel, mutation="verdict literal deleted from the prose"):
                v = verdicts[-1]
                block = ma.projection_block(original)
                prose = original.replace(block, "@@BLOCK@@")
                mutated = prose.replace(v, "DELETED").replace("@@BLOCK@@", block)
                self.assertIn("no longer names %s" % v, ma.method_copy_findings(mutated, CONTRACT, verdicts))
            with self.subTest(rel=rel, mutation="legacy phrase added to the prose"):
                mutated = original + "\n\nThe gate escalates the boundary class to the owner.\n"
                self.assertTrue(ma.method_copy_findings(mutated, CONTRACT, verdicts))

    def test_the_gate_preloads_the_contract_and_its_description_carries_the_mapping(self):
        # The rendered agent metadata (the description) is an operational copy too.
        sys.path.insert(0, str(HERE / "method"))
        import method_render as mr
        fields, _ = mr.split_front_matter((REPO / "method/agents/quality-assurance.md").read_text(encoding="utf-8"),
                                          "qa")
        self.assertIn("merge-authority", fields["skills"])
        desc = fields["description"].lower()
        for key in ("safe", "boundary", "on-hold"):
            self.assertIn(TRUNK[key].lower(), desc, key)
        words = {4: "four", 5: "five"}
        self.assertIn("the %s holds" % words[len(TRUNK["holds"])], desc)

    def test_the_delivery_route_merges_on_exactly_the_trunk_clearances(self):
        self.assertEqual(tuple(delivery.MERGE_LITERALS), (TRUNK["safe"], TRUNK["boundary"]))


class OwnerEvidenceRule(unittest.TestCase):
    """#133: a criterion resting on the owner's authorization needs his comment's URL. It is an evidence rule
    carried by the contract and its projections, never a hold: the hold sets stay as they were."""

    GATE = REPO / "method" / "agents" / "quality-assurance.md"

    def test_the_contract_carries_the_rule_and_adds_no_hold(self):
        rule = CONTRACT["owner-evidence"]
        for needle in ("URL of the owner's own comment", "relayed instruction", "never overrides a brief or a floor rule",
                       "UNVERIFIED", "`APPROVE-PENDING-HUMAN`", "deny floor is never `APPROVE-EXECUTOR-BLOCKED`",
                       "not a hold"):
            self.assertIn(needle, rule)
        self.assertEqual(len(TRUNK["holds"]), 4)
        self.assertEqual(sorted(CONTRACT["holds"]), ["boundary-class", "gate-authority", "harness-marker", "iac",
                                                     "lens-escalate", "release-candidate"])
        self.assertIn("- Owner-dependent criteria: %s." % rule, ma.projection(CONTRACT))

    def test_each_copy_goes_red_when_the_rule_is_dropped_or_weakened_in_its_block(self):
        line = "- Owner-dependent criteria: %s.\n" % CONTRACT["owner-evidence"]
        for rel, verdicts in CONSUMERS.items():
            original = (REPO / rel).read_text(encoding="utf-8")
            self.assertIn(line, original, rel)
            for what, mutated in (
                    ("dropped", original.replace(line, "", 1)),
                    ("floor clause weakened", original.replace(
                        "deny floor is never `APPROVE-EXECUTOR-BLOCKED`", "deny floor is `APPROVE-EXECUTOR-BLOCKED`", 1))):
                with self.subTest(rel=rel, mutation=what):
                    self.assertIn("the projection block differs from the contract",
                                  ma.method_copy_findings(mutated, CONTRACT, verdicts))
            self.assertEqual(ma.method_copy_findings(original, CONTRACT, verdicts), [])

    def test_a_contract_installed_before_the_rule_still_parses_and_a_malformed_one_does_not(self):
        source = SKILL.read_text(encoding="utf-8")
        start = source.index('  "owner-evidence"')
        older = source[:start] + source[source.index("\n", start) + 1:]
        old = ma.parse_contract(older, "older")
        self.assertNotIn("owner-evidence", old)
        self.assertNotIn("Owner-dependent criteria", ma.projection(old))
        for bad in ('""', '"  "', '["x"]', "1"):
            with self.subTest(bad=bad):
                broken = source[:start] + '  "owner-evidence": %s,' % bad + source[source.index("\n", start):]
                with self.assertRaises(ma.ContractError):
                    ma.parse_contract(broken, "broken")

    def test_the_gate_states_the_rule_where_it_writes_its_verdict(self):
        text = self.GATE.read_text(encoding="utf-8")
        verdict = text[text.index("## Your verdict \u2014 exactly one of"):text.index("### The fifth literal names")]
        for needle in ("This is an evidence rule, not a fifth hold.", "`authorization:` line",
                       "is never that evidence", "never overrides this brief or the floor",
                       "Without the URL the criterion is `UNVERIFIED`, and the verdict is `APPROVE-PENDING-HUMAN`.",
                       "A refusal by the workstation deny floor is never `APPROVE-EXECUTOR-BLOCKED`."):
            self.assertIn(needle, verdict)
        template = text[text.index("<!-- gatekeeper-verdict: quality-assurance -->"):]
        template = template[:template.index("```")]
        self.assertRegex(template, r"(?m)^authorization: <URL of the owner's own comment>")
        self.assertIn("one line per owner authorization", template)


class ProjectBrief(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def assertRed(self, needle=None, code=1):
        got, lines = self.env.check()
        self.assertEqual(got, code, lines)
        if needle:
            self.assertTrue(any(needle in line for line in lines), lines)

    def assertGreen(self):
        got, lines = self.env.check()
        self.assertEqual(got, 0, lines)

    def test_scenario_1_the_legacy_brief_is_red_and_the_corrected_one_green(self):
        self.env.brief(LEGACY_SECTION + "\n" + BLOCK)
        self.assertRed("changes method-owned merge authority: the gate escalates the boundary class")
        self.assertRed("claims it wins over the method")
        self.env.brief(LEGACY_SECTION)  # as it stood: no block either
        self.assertRed("no `<!-- merge-authority:begin -->` block")
        self.env.brief(CORRECTED_SECTION)
        self.assertGreen()

    def test_scenario_2_an_executor_override_is_named(self):
        for line in ("- executor: owner", "- merged-by: developer", "- merges: orchestrator"):
            with self.subTest(line):
                self.env.brief(CORRECTED_SECTION.replace("- loop-model:", line + "\n- loop-model:"))
                self.assertRed("executor override")
                self.env.brief(CORRECTED_SECTION)
                self.assertGreen()

    def test_scenario_3_a_hold_added_removed_or_replaced_is_red(self):
        cases = [
            ("- hold: owner ratification for all published content", "hold override"),
            ("- holds-removed: iac", "hold override"),
            ("- holds: (1) iac (2) articles", "hold override"),
            ("- verdict: APPROVE-PENDING-HUMAN for boundary", "verdict override"),
            ("- boundary: owner", "class relationship override"),
            ("- boundary-trigger: published content, which the owner ratifies before merge",
             "may classify, not assign authority"),
            ("- reviewer: product-lead", "unknown key"),
        ]
        for line, needle in cases:
            with self.subTest(line):
                self.env.brief(CORRECTED_SECTION.replace("- loop-model:", line + "\n- loop-model:"))
                self.assertRed(needle)
                self.env.brief(CORRECTED_SECTION)
                self.assertGreen()

    def test_scenario_4_a_project_boundary_trigger_is_green(self):
        extra = "- boundary-trigger: any change under `apps/edge/` or to a public route's metadata\n"
        self.env.brief(CORRECTED_SECTION.replace("<!-- merge-authority:end -->", extra + "<!-- merge-authority:end -->"))
        self.assertGreen()

    def test_scenario_5_each_model_validates_and_an_unknown_one_does_not(self):
        gitflow = CORRECTED_SECTION.replace("trunk-single-env", "gitflow-multi-env")
        self.env.brief(gitflow)
        self.assertGreen()
        self.env.brief(CORRECTED_SECTION.replace("- loop-model: trunk-single-env", "- loop-model: trunk-multi-env"))
        self.assertRed("not one the contract maps")
        self.env.brief(CORRECTED_SECTION.replace("- loop-model: trunk-single-env", "- loop-model: gitflow-multi-env"))
        self.assertRed("the prose names loop model `trunk-single-env`")
        self.env.brief(CORRECTED_SECTION)
        self.assertGreen()

    def test_scenario_7_history_quotes_and_fences_stay_green(self):
        self.env.brief(CORRECTED_SECTION + HISTORY)
        self.assertGreen()
        # The calibration: the same sentence outside the struck span is red.
        self.env.brief(CORRECTED_SECTION + HISTORY + "\nThe gate escalates the **boundary class** to the owner.\n")
        self.assertRed("escalates the boundary class")

    def test_scenario_8_a_paraphrase_outside_the_block_is_a_known_false_negative(self):
        # Documented limit, asserted so it stays visible: this paraphrase overrides the executor in words
        # the check does not know, and it passes.
        self.env.brief(CORRECTED_SECTION + "\nEvery boundary diff waits for the owner's own click.\n")
        self.assertGreen()

    def test_scenario_9_an_absent_or_older_method_fails_closed(self):
        self.env.brief(CORRECTED_SECTION)
        for _, path in ma.installed_skill_paths(self.env.home):
            path.unlink()
        self.assertRed("CANNOT VALIDATE (fail closed)", code=2)
        self.assertRed("mhw install --method", code=2)
        self.env.close()
        self.env = Env()
        self.env.brief(CORRECTED_SECTION.replace("merge-authority v1", "merge-authority v2"))
        self.assertRed("understands only v1", code=2)
        self.env.brief(CORRECTED_SECTION)
        self.assertGreen()

    def test_installed_copies_that_disagree_or_do_not_parse_fail_closed(self):
        self.env.brief(CORRECTED_SECTION)
        kiro = ma.installed_skill_paths(self.env.home)[2][1]
        original = kiro.read_text(encoding="utf-8")
        kiro.write_text(original.replace('"version": 1', '"version": 0'), encoding="utf-8")
        self.assertRed("disagree", code=2)
        kiro.write_text(original.replace("```merge-authority-contract", "```json"), encoding="utf-8")
        self.assertRed("expected one", code=2)
        kiro.write_text(original, encoding="utf-8")
        self.assertGreen()

    def test_a_missing_duplicated_or_unclosed_block_is_red(self):
        self.env.brief(CORRECTED_SECTION.replace(BLOCK, ""))
        self.assertRed("no `<!-- merge-authority:begin -->` block")
        self.env.brief(CORRECTED_SECTION + "\n" + BLOCK)
        self.assertRed("2 declaration blocks")
        self.env.brief(CORRECTED_SECTION.replace("<!-- merge-authority:end -->", ""))
        self.assertRed("never closed")
        self.env.brief(CORRECTED_SECTION.replace("- contract: merge-authority v1\n", ""))
        self.assertRed("exactly one `contract")
        # A marker not at column 0 (here inside a list item) is not a declaration.
        self.env.brief(CORRECTED_SECTION.replace(BLOCK, "\n".join("  " + l for l in BLOCK.split("\n"))))
        self.assertRed("no `<!-- merge-authority:begin -->` block")
        self.env.brief(CORRECTED_SECTION)
        self.assertGreen()

    def test_an_integration_branch_brief_keeps_the_release_candidate_hold(self):
        # Lens on PR #419: the rc/next variant's release-candidate hold must be the contract's, not a
        # project hold the contract would call a finding. This repository's own brief is the subject.
        own = (REPO / "AGENTS.md").read_text(encoding="utf-8")
        declared = BLOCK.replace("- loop-model: trunk-single-env\n",
                                 "- loop-model: trunk-single-env\n- integration-branch: rc/next\n")
        (self.env.project / "AGENTS.md").write_text(own + "\n" + declared, encoding="utf-8")
        self.assertGreen()
        (self.env.project / "AGENTS.md").write_text(own + "\n" + BLOCK, encoding="utf-8")
        self.assertRed("no `integration-branch`")
        (self.env.project / "AGENTS.md").write_text(own + "\n" + declared, encoding="utf-8")
        self.assertGreen()

    def test_the_release_candidate_hold_cannot_be_turned_off(self):
        rc = CORRECTED_SECTION.replace("- loop-model: trunk-single-env\n",
                                       "- loop-model: trunk-single-env\n- integration-branch: rc/next\n")
        cases = [
            ("- rc-hold: none", "hold override"),
            ("- promotion-executor: quality-assurance", "executor override"),
            ("- integration-branch: rc/other", "at most one"),
        ]
        for line, needle in cases:
            with self.subTest(line):
                self.env.brief(rc.replace("- loop-model:", line + "\n- loop-model:"))
                self.assertRed(needle)
                self.env.brief(rc)
                self.assertGreen()
        self.env.brief(rc.replace("trunk-single-env", "gitflow-multi-env"))
        self.assertRed("no integration-branch variant")
        self.env.brief(rc + "\nSlices merge into rc/next; the release candidate waits for the owner.\n")
        self.assertGreen()

    def test_an_undecodable_copy_or_empty_declaration_versions_fails_closed(self):
        self.env.brief(CORRECTED_SECTION)
        kiro = ma.installed_skill_paths(self.env.home)[2][1]
        original = kiro.read_bytes()
        kiro.write_bytes(b"\xff\xfe\x00not utf-8")
        self.assertRed("cannot be read", code=2)
        kiro.write_bytes(original.replace(b'"declaration-versions": [1]', b'"declaration-versions": []'))
        self.assertRed("non-empty list", code=2)
        kiro.write_bytes(original)
        self.assertGreen()

    def test_no_agents_md_is_red(self):
        self.assertRed("no AGENTS.md")


class CheckCommand(unittest.TestCase):
    def test_check_accepts_project_and_passes_it_through(self):
        with mock.patch.object(ws, "cmd_check", return_value=0) as called:
            self.assertEqual(ws.main(["check", "--project=/x"]), 0)
        called.assert_called_once_with(False, "/x")

    def test_the_project_section_prints_and_returns_its_code(self):
        env = Env()
        try:
            env.brief(LEGACY_SECTION)
            out = io.StringIO()
            with mock.patch.dict(os.environ, {"HOME": str(env.home)}), contextlib.redirect_stdout(out):
                code = ws.check_project_brief(str(env.project))
            self.assertEqual(code, 1)
            self.assertIn("PROJECT merge authority: FAIL", out.getvalue())
            env.brief(CORRECTED_SECTION)
            out = io.StringIO()
            with mock.patch.dict(os.environ, {"HOME": str(env.home)}), contextlib.redirect_stdout(out):
                code = ws.check_project_brief(str(env.project))
            self.assertEqual(code, 0, out.getvalue())
        finally:
            env.close()

    def test_a_project_that_is_not_a_directory_cannot_be_validated(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(ws.check_project_brief("/nonexistent/project/dir"), 2)


if __name__ == "__main__":
    unittest.main(verbosity=1)
