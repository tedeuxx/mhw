#!/usr/bin/env python3
"""The recovery reference (ADR-0015 lock 5 of 5, Issue #247).

    python3 -B global/project-policy/recovery_test.py

Both recovery paths, automatic rollback and manual recovery, through `delivery_gate.py recovery-plan`
before the PROD deployment and `prod-validation` after it. Each blocking test asserts the block AND
its reason, so a red cannot come from the wrong branch. The runbook template is filled and read by the
gate, so the record form it documents is the one the gate accepts. The last class reads the caller
template's recovery jobs.
"""
import contextlib
import io
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import delivery_gate  # noqa: E402

FIXTURE = HERE / "reference" / "fixture"
RUNBOOK_TEMPLATE = HERE / "reference" / "runbook-template.md"
CALLER = HERE / "reference" / "caller-workflow.yml"
REV = "a" * 40
PREVIOUS = "b" * 40
TESTED = "2026-01-15"
RUNBOOK = "docs/recovery-runbook.md"


def text(path):
    """A file's text with LF line ends: a Windows checkout writes CRLF."""
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def filled_runbook(date=TESTED, minutes="20", handle="@operator-one"):
    return (text(RUNBOOK_TEMPLATE).replace("<YYYY-MM-DD>", date).replace("<minutes> minutes;",
                                                                         "%s minutes;" % minutes)
            .replace("by <@handle>", "by %s" % handle))


def prod_evidence():
    return {"layer": "prod", "revision": REV, "prod_deployed_revision": REV,
            "critical_user_journeys": {"greet-reader": "pass"},
            "risk_scenarios": {"no-unescaped-name": "pass"}}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.project = self.tmp / "project"
        shutil.copytree(FIXTURE, self.project)

    def manual(self, rto=30, runbook=None, path=RUNBOOK, last_tested=TESTED):
        contract = self.project / "project-policy.json"
        doc = json.loads(contract.read_text(encoding="utf-8"))
        doc["recovery"] = {"mode": "manual", "recovery_time_objective_minutes": rto,
                           "runbook": {"path": path, "last_tested": last_tested},
                           "operator": "@operator-one"}
        contract.write_text(json.dumps(doc), encoding="utf-8")
        if runbook is not None:
            target = self.project / RUNBOOK
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(runbook.encode("utf-8"))

    def plan(self, prod=PREVIOUS, revision=REV):
        return delivery_gate.recovery_plan(str(self.project), revision, prod)

    def validate(self, evidence, revision=REV, head=REV):
        path = self.tmp / "prod.json"
        path.write_text(evidence if isinstance(evidence, str) else json.dumps(evidence),
                        encoding="utf-8")
        return delivery_gate.gate_prod_validation(str(self.project), str(path), revision, head)

    def assertBlocks(self, blocks, fragment, case=""):
        self.assertTrue(blocks, "expected a block containing %r, got a pass %s" % (fragment, case))
        self.assertTrue(any(fragment in b for b in blocks), "%r not in %r %s" % (fragment, blocks, case))


class AutomaticRollback(Base):
    def test_previous_revision_is_the_rollback_target(self):
        self.assertEqual(self.plan(), (["mode=automatic-rollback", "rollback_target=" + PREVIOUS], []))

    def test_first_deployment_withdraws(self):
        self.assertEqual(self.plan("none"), (["mode=automatic-rollback", "rollback_target=none"], []))

    def test_unreadable_prod_revision_blocks(self):
        for value in ("unknown", "NONE", PREVIOUS[:12], PREVIOUS + "\n", PREVIOUS.upper(), None):
            outputs, blocks = self.plan(value)
            self.assertIsNone(outputs, value)
            self.assertBlocks(blocks, "not a full commit SHA or none")

    def test_prod_already_at_the_revision_blocks(self):
        self.assertBlocks(self.plan(REV)[1], "no previous version to return to")

    def test_revision_that_is_not_a_full_sha_cannot_decide(self):
        with self.assertRaises(delivery_gate.Usage):
            self.plan(revision=REV[:7])

    def test_broken_contract_blocks(self):
        contract = self.project / "project-policy.json"
        doc = json.loads(contract.read_text(encoding="utf-8"))
        doc["recovery"] = {"mode": "manual"}
        contract.write_text(json.dumps(doc), encoding="utf-8")
        self.assertBlocks(self.plan()[1], "recovery not prepared")


class ManualRecovery(Base):
    def test_tested_runbook_within_the_objective_passes(self):
        self.manual(runbook=filled_runbook())
        self.assertEqual(self.plan(), (["mode=manual", "rollback_target=" + PREVIOUS,
                                        "runbook=" + RUNBOOK, "recovery_time_objective_minutes=30",
                                        "operator=@operator-one"], []))

    def test_crlf_runbook_passes(self):
        self.manual(runbook=filled_runbook().replace("\n", "\r\n"))
        self.assertEqual(self.plan()[1], [])

    def test_windows_separator_in_the_path_passes(self):
        self.manual(runbook=filled_runbook(), path=RUNBOOK)
        original = delivery_gate.inside
        self.addCleanup(setattr, delivery_gate, "inside", original)
        delivery_gate.inside = lambda project, rel: original(project, rel.replace("/", "\\"))
        self.assertEqual(self.plan()[1], [])

    def test_missing_runbook_blocks(self):
        self.manual()
        self.assertBlocks(self.plan()[1], "is missing, unreadable or outside the project")

    def test_runbook_linked_outside_the_project_blocks(self):
        outside = self.tmp / "elsewhere.md"
        outside.write_text(filled_runbook(), encoding="utf-8")
        self.manual()
        (self.project / "docs").mkdir(exist_ok=True)
        try:
            (self.project / RUNBOOK).symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("this system cannot create a symbolic link")
        self.assertBlocks(self.plan()[1], "outside the project")

    def test_runbook_not_utf8_blocks(self):
        self.manual()
        (self.project / RUNBOOK).write_bytes(b"\xff\xfe Tested")
        self.assertBlocks(self.plan()[1], "is missing, unreadable or outside the project")

    def test_untested_template_blocks(self):
        # The template as shipped carries a placeholder record, not a test.
        self.manual(runbook=text(RUNBOOK_TEMPLATE))
        self.assertBlocks(self.plan()[1], "no test record dated %s" % TESTED)

    def test_record_of_another_date_blocks(self):
        self.manual(runbook=filled_runbook(date="2026-01-14"))
        self.assertBlocks(self.plan()[1], "no test record dated %s" % TESTED)

    def test_record_over_the_objective_blocks(self):
        self.manual(runbook=filled_runbook(minutes="31"))
        self.assertBlocks(self.plan()[1], "recovered in 31 minutes, over the recovery-time objective of 30")

    def test_record_at_the_objective_passes(self):
        self.manual(runbook=filled_runbook(minutes="30"))
        self.assertEqual(self.plan()[1], [])

    def test_any_record_of_the_date_over_the_objective_blocks(self):
        runbook = filled_runbook() + "- Tested: %s; recovered in 45 minutes; by @someone\n" % TESTED
        self.manual(runbook=runbook)
        self.assertBlocks(self.plan()[1], "recovered in 45 minutes")

    def test_struck_record_is_not_read(self):
        runbook = filled_runbook(date="2026-01-14").replace(
            "- Tested: 2026-01-14", "~~- Tested: 2026-01-14").replace("by @operator-one",
                                                                     "by @operator-one~~")
        runbook += "~~- Tested: %s; recovered in 5 minutes; by @someone~~\n" % TESTED
        self.manual(runbook=runbook)
        self.assertBlocks(self.plan()[1], "no test record dated %s" % TESTED)

    def test_record_is_matched_whole_line(self):
        for line in ("- Tested: %s; recovered in 5 minutes; by @someone, more" % TESTED,
                     "Not Tested: %s; recovered in 5 minutes; by @someone" % TESTED,
                     "  - Tested: %s; recovered in 5 minutes; by @someone" % TESTED,
                     "- Tested: %s; recovered in 5 minutes; by @someone " % TESTED,
                     "- Tested: %s; recovered in 5 minutes; by @someone ~~old~~" % TESTED,
                     "- Tested: %s; recovered in ٥ minutes; by @someone" % TESTED):
            self.manual(runbook="# runbook\n%s\n" % line)
            self.assertBlocks(self.plan()[1], "no test record dated", line)

    def test_unreadable_prod_revision_blocks_manual_too(self):
        self.manual(runbook=filled_runbook())
        self.assertBlocks(self.plan("")[1], "not a full commit SHA or none")


class ProdValidation(Base):
    def test_validated_prod_passes(self):
        self.assertEqual(self.validate(prod_evidence()), [])

    def test_failed_journey_blocks(self):
        doc = prod_evidence()
        doc["critical_user_journeys"]["greet-reader"] = "fail"
        self.assertBlocks(self.validate(doc), 'greet-reader is "fail", not pass')

    def test_inconclusive_risk_scenario_blocks(self):
        doc = prod_evidence()
        doc["risk_scenarios"]["no-unescaped-name"] = "inconclusive"
        self.assertBlocks(self.validate(doc), "inconclusive evidence blocks")

    def test_missing_journey_blocks(self):
        doc = prod_evidence()
        doc["critical_user_journeys"] = {}
        self.assertBlocks(self.validate(doc), "greet-reader has no result")

    def test_prod_running_another_revision_blocks(self):
        doc = prod_evidence()
        doc["prod_deployed_revision"] = PREVIOUS
        self.assertBlocks(self.validate(doc), "PROD reports it runs")

    def test_prod_revision_unreadable_blocks(self):
        doc = prod_evidence()
        doc["prod_deployed_revision"] = None
        self.assertBlocks(self.validate(doc), "PROD reports it runs null")

    def test_evidence_for_another_revision_blocks(self):
        self.assertBlocks(self.validate(prod_evidence(), revision=REV, head=PREVIOUS),
                          "the checkout is at")
        doc = prod_evidence()
        doc["revision"] = PREVIOUS
        self.assertBlocks(self.validate(doc), "the evidence names revision")

    def test_wrong_layer_and_unknown_key_block(self):
        doc = prod_evidence()
        doc["layer"] = "installed-stg"
        doc["extra"] = 1
        blocks = self.validate(doc)
        self.assertBlocks(blocks, "not prod")
        self.assertBlocks(blocks, "unknown key(s) extra")

    def test_malformed_evidence_blocks_not_cannot_decide(self):
        for raw in ("", "{", "[]", '{"layer": NaN}', '{"layer": "prod", "layer": "prod"}'):
            self.assertTrue(self.validate(raw), raw)

    def test_missing_evidence_blocks(self):
        self.assertBlocks(delivery_gate.gate_prod_validation(
            str(self.project), str(self.tmp / "absent.json"), REV, REV), "missing or unreadable")


class CommandLine(Base):
    def main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = delivery_gate.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_recovery_plan_exit_codes(self):
        project = "--project=%s" % self.project
        code, out, _ = self.main("recovery-plan", project, "--revision=" + REV,
                                 "--prod-revision=" + PREVIOUS)
        self.assertEqual((code, out), (0, "mode=automatic-rollback\nrollback_target=%s\n" % PREVIOUS))
        code, out, err = self.main("recovery-plan", project, "--revision=" + REV, "--prod-revision=" + REV)
        self.assertEqual((code, out), (1, ""))
        self.assertIn("BLOCK  recovery-plan", err)
        self.assertEqual(self.main("recovery-plan", project, "--revision=" + REV)[0], 2)
        self.assertEqual(self.main("recovery-plan", project, "--revision=x", "--prod-revision=none")[0], 2)

    def test_prod_validation_exit_codes(self):
        path = self.tmp / "prod.json"
        path.write_text(json.dumps(prod_evidence()), encoding="utf-8")
        args = ["--project=%s" % self.project, "--evidence=%s" % path, "--revision=" + REV]
        self.assertEqual(self.main("prod-validation", *args, "--checkout-head=" + REV)[0], 0)
        code, _, err = self.main("prod-validation", *args, "--checkout-head=" + PREVIOUS)
        self.assertEqual(code, 1)
        self.assertIn("BLOCK  prod-validation", err)
        self.assertEqual(self.main("prod-validation", *args)[0], 2)


class CallerTemplate(unittest.TestCase):
    def setUp(self):
        self.body = text(CALLER)
        self.jobs = self.body.split("\njobs:\n", 1)[1]

    def job(self, name):
        match = re.search(r"(?ms)^  %s:\n(.*?)(?=^  [\w-]+:\n|\Z)" % re.escape(name), self.jobs)
        self.assertIsNotNone(match, name)
        return match.group(1)

    def test_recovery_is_planned_before_the_prod_deployment(self):
        self.assertIn("delivery_gate.py recovery-plan ", self.job("recovery-plan"))
        self.assertRegex(self.job("deploy-prod"), r"needs: \[[^]]*\brecovery-plan\b")

    def test_prod_is_validated_after_the_deployment(self):
        validate = self.job("validate-prod")
        self.assertIn("needs: deploy-prod", validate)
        self.assertIn("delivery_gate.py prod-validation ", validate)

    def test_recovery_runs_on_any_failure_after_exposure(self):
        recover = self.job("recover")
        condition = re.search(r"(?m)^    if: (.*)$", recover).group(1)
        for fragment in ("always()", "needs.recovery-plan.result == 'success'",
                         "needs.deploy-prod.result != 'skipped'",
                         "needs.validate-prod.result != 'success'"):
            self.assertIn(fragment, condition)
        # The automatic path never waits for a reviewer: it names the environment with none.
        self.assertRegex(recover, r"(?m)^    environment: <the PROD environment with no required reviewer>$")
        self.assertIn("automatic-rollback", recover)
        self.assertIn("manual", recover)

    def test_no_step_interpolates_an_output_into_a_script(self):
        # Outputs reach a script through env:, never ${{ }} inside run:, so a value cannot inject.
        lines = self.jobs.split("\n")
        scripts = 0
        for index, line in enumerate(lines):
            match = re.match(r"^( *)(?:- )?run:(.*)$", line)
            if not match:
                continue
            scripts += 1
            indent = len(match.group(1))
            script = [match.group(2)]
            for following in lines[index + 1:]:
                if following.strip() and len(following) - len(following.lstrip(" ")) <= indent:
                    break
                script.append(following)
            self.assertNotIn("${{", "\n".join(script), line)
        self.assertGreaterEqual(scripts, 6)


if __name__ == "__main__":
    unittest.main(verbosity=1)
