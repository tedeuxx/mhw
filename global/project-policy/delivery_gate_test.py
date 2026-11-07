#!/usr/bin/env python3
"""The reference CI/CD's evidence gates (ADR-0015 lock 4 of 5, Issue #246).

    python3 -B global/project-policy/delivery_gate_test.py

A benign pass for each gate, then one test per blocking class: exact-revision binding, the container,
coverage, each mandatory scenario, each severity rule, the installed STG, risk classification, the
owner-approval environment. Each blocking test asserts exit 1 AND the reason, so a red cannot come
from the wrong branch. The last class asserts the workflows themselves: every action pinned by SHA,
and no job that names an environment in the reusable gate or the dry run.
"""
import contextlib
import copy
import io
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import delivery_gate  # noqa: E402

FIXTURE = HERE / "reference" / "fixture"
REV = "a" * 40
OTHER = "b" * 40
IMAGE = "python@sha256:" + "c" * 64
WORKFLOWS = [ROOT / ".github/workflows/reference-delivery-gate.yml",
             ROOT / ".github/workflows/reference-delivery-dry-run.yml"]
TEMPLATE = HERE / "reference" / "caller-workflow.yml"


def text(path):
    """A file's text with LF line ends: a Windows checkout writes CRLF, and `$` stops before \\n only."""
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def container_evidence():
    return {
        "layer": "container", "revision": REV, "container_image": IMAGE,
        "test_layers": {"unit": "pass"},
        "coverage": {"metric": "line", "percent": 90},
        "critical_user_journeys": {"greet-reader": "pass"},
        "risk_scenarios": {"no-unescaped-name": "pass"},
        "security_controls": {name: "pass" for name in (
            "quality-scan", "sast", "owasp-vulnerability-coverage", "authentication",
            "authorization", "encryption-in-transit", "encryption-at-rest")},
        "findings": [],
    }


def installed_evidence():
    return {
        "layer": "installed-stg", "revision": REV, "stg_deployed_revision": REV,
        "test_layers": {"end-to-end": "pass"},
        "critical_user_journeys": {"greet-reader": "pass"},
        "risk_scenarios": {"no-unescaped-name": "pass"},
        "security_controls": {"authentication": "pass"},
        "findings": [],
    }


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.project = self.tmp / "project"
        shutil.copytree(FIXTURE, self.project)
        self.dockerenv = self.tmp / "dockerenv"
        self.dockerenv.write_text("", encoding="utf-8")

    def contract(self, change):
        path = self.project / "project-policy.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        change(doc)
        path.write_text(json.dumps(doc), encoding="utf-8")

    def write(self, name, doc):
        path = self.tmp / name
        path.write_text(doc if isinstance(doc, str) else json.dumps(doc), encoding="utf-8")
        return str(path)

    def container(self, evidence, revision=REV, head=REV, image=IMAGE, in_container=True):
        return delivery_gate.gate_container(
            str(self.project), self.write("ev.json", evidence), revision, head, image, True,
            dockerenv=self.dockerenv if in_container else self.tmp / "absent")

    def installed(self, evidence, revision=REV, head=REV):
        return delivery_gate.gate_installed(str(self.project), self.write("stg.json", evidence),
                                            revision, head)

    def assertBlocks(self, blocks, fragment):
        self.assertTrue(blocks, "expected a block containing %r, got a pass" % fragment)
        self.assertTrue(any(fragment in b for b in blocks), "%r not in %r" % (fragment, blocks))


class Contract(Base):
    def test_fixture_passes(self):
        self.assertEqual(delivery_gate.gate_contract(str(self.project), "tedeuxx/mhw"), [])

    def test_invalid_contract_blocks(self):
        self.contract(lambda d: d["severity"].update(tolerated=["medium"]))
        self.assertBlocks(delivery_gate.gate_contract(str(self.project)), "medium-or-higher")

    def test_contract_of_another_repository_blocks(self):
        self.assertBlocks(delivery_gate.gate_contract(str(self.project), "someone/else"),
                          "it governs tedeuxx/mhw")

    def test_missing_madr_blocks(self):
        (self.project / "docs/adr/0001-fixture-quality-bar.md").unlink()
        self.assertBlocks(delivery_gate.gate_contract(str(self.project)), "is missing, unreadable or outside")

    def test_madr_linked_outside_the_project_blocks(self):
        outside = self.tmp / "elsewhere.md"
        outside.write_text("- **Status:** accepted\n", encoding="utf-8")
        madr = self.project / "docs/adr/0001-fixture-quality-bar.md"
        madr.unlink()
        try:
            madr.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("this system cannot create a symbolic link")
        self.assertBlocks(delivery_gate.gate_contract(str(self.project)), "outside the project")

    def test_madr_path_in_another_case_blocks(self):
        # A case-insensitive file system would open it; the gate matches each name exactly, so the
        # contract names the file the repository tracks.
        self.contract(lambda d: d["madr"].update(path="docs/ADR/0001-fixture-quality-bar.md"))
        self.assertBlocks(delivery_gate.gate_contract(str(self.project)), "is missing, unreadable or outside")

    def test_runbook_that_is_a_directory_blocks(self):
        self.contract(lambda d: d.update(recovery={
            "mode": "manual", "recovery_time_objective_minutes": 30,
            "runbook": {"path": "docs/runbook.md", "last_tested": "2026-01-01"},
            "operator": "@someone"}))
        (self.project / "docs/runbook.md").mkdir()
        self.assertBlocks(delivery_gate.gate_contract(str(self.project)), "runbook docs/runbook.md")

    def test_madr_not_accepted_blocks(self):
        madr = self.project / "docs/adr/0001-fixture-quality-bar.md"
        madr.write_text("- **Status:** ~~accepted~~ proposed\n", encoding="utf-8")
        self.assertBlocks(delivery_gate.gate_contract(str(self.project)), "no status line")

    def test_madr_status_reading(self):
        self.assertTrue(delivery_gate.madr_status_accepted("status: accepted\n"))
        self.assertTrue(delivery_gate.madr_status_accepted("- **Status:** ~~proposed~~ **Accepted.**"))
        self.assertFalse(delivery_gate.madr_status_accepted("Status: proposed, accepted later"))
        self.assertFalse(delivery_gate.madr_status_accepted("no status here"))

    def test_manual_recovery_without_runbook_blocks(self):
        self.contract(lambda d: d.update(recovery={
            "mode": "manual", "recovery_time_objective_minutes": 30,
            "runbook": {"path": "docs/runbook.md", "last_tested": "2026-01-01"},
            "operator": "@someone"}))
        self.assertBlocks(delivery_gate.gate_contract(str(self.project)), "runbook docs/runbook.md")
        (self.project / "docs/runbook.md").write_text("# runbook\n", encoding="utf-8")
        self.assertEqual(delivery_gate.gate_contract(str(self.project)), [])


class Container(Base):
    def test_complete_green_evidence_passes(self):
        self.assertEqual(self.container(container_evidence()), [])

    def test_not_in_a_container_blocks(self):
        self.assertBlocks(self.container(container_evidence(), in_container=False), "not running in a container")

    def test_image_by_tag_blocks(self):
        ev = container_evidence()
        ev["container_image"] = "python:3.12"
        self.assertBlocks(self.container(ev, image="python:3.12"), "not pinned by digest")

    def test_evidence_from_another_image_blocks(self):
        ev = container_evidence()
        ev["container_image"] = "python@sha256:" + "d" * 64
        self.assertBlocks(self.container(ev), "the evidence names image")

    def test_evidence_for_another_revision_blocks(self):
        ev = container_evidence()
        ev["revision"] = OTHER
        self.assertBlocks(self.container(ev), "the evidence names revision")

    def test_checkout_at_another_revision_blocks(self):
        self.assertBlocks(self.container(container_evidence(), head=OTHER), "the checkout is at")

    def test_abbreviated_revision_cannot_decide(self):
        with self.assertRaises(delivery_gate.Usage):
            self.container(container_evidence(), revision=REV[:8], head=REV[:8])

    def test_coverage_below_threshold_blocks(self):
        ev = container_evidence()
        ev["coverage"]["percent"] = 84.9
        self.assertBlocks(self.container(ev), "below the threshold")

    def test_coverage_of_another_metric_blocks(self):
        ev = container_evidence()
        ev["coverage"]["metric"] = "branch"
        self.assertBlocks(self.container(ev), "the contract counts line")

    def test_coverage_missing_or_boolean_blocks(self):
        ev = container_evidence()
        del ev["coverage"]
        self.assertBlocks(self.container(ev), "coverage missing")
        ev = container_evidence()
        ev["coverage"]["percent"] = True
        self.assertBlocks(self.container(ev), "below the threshold")

    def test_journey_without_result_blocks(self):
        ev = container_evidence()
        ev["critical_user_journeys"] = {}
        self.assertBlocks(self.container(ev), "greet-reader has no result")

    def test_failed_journey_blocks(self):
        ev = container_evidence()
        ev["critical_user_journeys"]["greet-reader"] = "fail"
        self.assertBlocks(self.container(ev), "greet-reader is \"fail\"")

    def test_inconclusive_scenario_blocks(self):
        ev = container_evidence()
        ev["risk_scenarios"]["no-unescaped-name"] = "inconclusive"
        self.assertBlocks(self.container(ev), "inconclusive evidence blocks")

    def test_result_not_in_contract_blocks(self):
        ev = container_evidence()
        ev["critical_user_journeys"]["invented"] = "pass"
        self.assertBlocks(self.container(ev), "invented is not in the contract")

    def test_missing_security_control_blocks(self):
        ev = container_evidence()
        del ev["security_controls"]["sast"]
        self.assertBlocks(self.container(ev), "security_controls sast has no result")

    def test_failed_test_layer_blocks(self):
        ev = container_evidence()
        ev["test_layers"]["api"] = "fail"
        self.assertBlocks(self.container(ev), "test_layers api is \"fail\"")

    def test_no_test_layer_blocks(self):
        ev = container_evidence()
        ev["test_layers"] = {}
        self.assertBlocks(self.container(ev), "test_layers missing or empty")

    def test_unknown_evidence_key_blocks(self):
        ev = container_evidence()
        ev["skipped"] = True
        self.assertBlocks(self.container(ev), "unknown key(s) skipped")

    def test_wrong_layer_blocks(self):
        ev = container_evidence()
        ev["layer"] = "local"
        self.assertBlocks(self.container(ev), "not container")


class Findings(Base):
    def run_with(self, finding):
        ev = container_evidence()
        ev["findings"] = [finding]
        return self.container(ev)

    def test_low_with_bug_issue_passes(self):
        self.assertEqual(self.run_with({"id": "x", "severity": "low", "bug_issue": "#12"}), [])
        self.assertEqual(self.run_with({"id": "x", "severity": "low",
                                        "bug_issue": "https://github.com/o/r/issues/3"}), [])

    def test_low_without_bug_issue_blocks(self):
        self.assertBlocks(self.run_with({"id": "x", "severity": "low"}), "without a bug Issue")
        self.assertBlocks(self.run_with({"id": "x", "severity": "low", "bug_issue": "#12\n"}),
                          "without a bug Issue")

    def test_medium_blocks(self):
        self.assertBlocks(self.run_with({"id": "x", "severity": "medium", "bug_issue": "#1"}),
                          "does not tolerate")

    def test_unknown_severity_blocks(self):
        self.assertBlocks(self.run_with({"id": "x", "severity": "info"}), "unknown severity")

    def test_unclassified_finding_blocks(self):
        self.assertBlocks(self.run_with({"id": "x"}), "unclassified findings block")

    def test_low_when_nothing_is_tolerated_blocks(self):
        self.contract(lambda d: d["severity"].update(tolerated=[]))
        self.assertBlocks(self.run_with({"id": "x", "severity": "low", "bug_issue": "#1"}),
                          "does not tolerate")

    def test_findings_missing_blocks(self):
        ev = container_evidence()
        del ev["findings"]
        self.assertBlocks(self.container(ev), "findings missing")


class EvidenceFile(Base):
    def test_missing_file_blocks(self):
        blocks = delivery_gate.gate_container(str(self.project), str(self.tmp / "none.json"), REV, REV,
                                              IMAGE, False)
        self.assertBlocks(blocks, "missing or unreadable")

    def test_repeated_key_blocks(self):
        path = self.write("dup.json", '{"layer": "container", "layer": "container"}')
        self.assertBlocks(delivery_gate.gate_container(str(self.project), path, REV, REV, IMAGE, False),
                          "malformed")

    def test_nan_blocks(self):
        path = self.write("nan.json", '{"coverage": {"metric": "line", "percent": NaN}}')
        self.assertBlocks(delivery_gate.gate_container(str(self.project), path, REV, REV, IMAGE, False),
                          "malformed")


class InstalledStg(Base):
    def test_stg_at_the_revision_passes(self):
        self.assertEqual(self.installed(installed_evidence()), [])

    def test_stg_running_another_revision_blocks(self):
        ev = installed_evidence()
        ev["stg_deployed_revision"] = OTHER
        self.assertBlocks(self.installed(ev), "STG reports it runs")

    def test_stg_revision_unreadable_blocks(self):
        ev = installed_evidence()
        ev["stg_deployed_revision"] = None
        self.assertBlocks(self.installed(ev), "STG reports it runs null")

    def test_stg_journey_failure_blocks(self):
        ev = installed_evidence()
        ev["critical_user_journeys"]["greet-reader"] = "fail"
        self.assertBlocks(self.installed(ev), "greet-reader is \"fail\"")

    def test_no_installed_security_validation_blocks(self):
        ev = installed_evidence()
        ev["security_controls"] = {}
        self.assertBlocks(self.installed(ev), "installed security validation")

    def test_installed_control_not_in_contract_blocks(self):
        ev = installed_evidence()
        ev["security_controls"]["dast"] = "pass"
        self.assertBlocks(self.installed(ev), "security_controls dast is not in the contract")

    def test_container_evidence_is_not_installed_evidence(self):
        self.assertBlocks(self.installed(container_evidence()), "not installed-stg")


class Classify(Base):
    def test_low_rule_is_automatic(self):
        self.assertEqual(delivery_gate.classify(str(self.project), "1"),
                         ("low", "automatic-after-all-gates", []))

    def test_high_rule_wins_a_conflict(self):
        self.assertEqual(delivery_gate.classify(str(self.project), "1,0"),
                         ("high", "owner-exact-revision", []))

    def test_no_rule_blocks(self):
        for rules in ("", " , "):
            _, _, blocks = delivery_gate.classify(str(self.project), rules)
            self.assertBlocks(blocks, "unclassified change blocks")

    def test_rule_outside_the_contract_blocks(self):
        for rules in ("2", "-1", "x", "1,9"):
            _, _, blocks = delivery_gate.classify(str(self.project), rules)
            self.assertBlocks(blocks, "is not a rule index")

    def test_stricter_low_risk_approval_is_honoured(self):
        self.contract(lambda d: d["approval"].update(low_risk="owner-exact-revision"))
        self.assertEqual(delivery_gate.classify(str(self.project), "1"),
                         ("low", "owner-exact-revision", []))


class Environment(Base):
    def gate(self, doc):
        return delivery_gate.gate_environment("production-owner-approval", self.write("env.json", doc))

    def test_required_reviewer_passes(self):
        self.assertEqual(self.gate({"name": "production-owner-approval", "protection_rules": [
            {"type": "required_reviewers", "reviewers": [{"type": "User", "reviewer": {"login": "o"}}]}]}), [])

    def test_missing_environment_blocks(self):
        self.assertBlocks(self.gate({}), "created unprotected")

    def test_no_reviewer_blocks(self):
        self.assertBlocks(self.gate({"name": "production-owner-approval", "protection_rules": [
            {"type": "wait_timer", "wait_timer": 5}]}), "no required reviewer")
        self.assertBlocks(self.gate({"name": "production-owner-approval", "protection_rules": [
            {"type": "required_reviewers", "reviewers": []}]}), "no required reviewer")


class CommandLine(Base):
    def main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = delivery_gate.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_exit_codes(self):
        project = "--project=%s" % self.project
        self.assertEqual(self.main("contract", project)[0], 0)
        code, out, _ = self.main("classify", project, "--rules=0")
        self.assertEqual((code, out), (0, "class=high\napproval=owner-exact-revision\n"))
        code, _, err = self.main("classify", project, "--rules=")
        self.assertEqual(code, 1)
        self.assertIn("BLOCK  classify", err)
        self.assertEqual(self.main("classify", project)[0], 2)
        self.assertEqual(self.main("container", project)[0], 2)
        self.assertEqual(self.main("contract", "--bogus=1")[0], 2)
        self.assertEqual(self.main("nothing")[0], 2)

    def test_validator_that_cannot_decide_is_exit_2(self):
        original = delivery_gate.project_policy.check
        delivery_gate.project_policy.check = lambda path: (2, ["ERROR  schema"])
        self.addCleanup(setattr, delivery_gate.project_policy, "check", original)
        self.assertEqual(self.main("contract", "--project=%s" % self.project)[0], 2)


class Workflows(unittest.TestCase):
    USES = re.compile(r"^\s*-?\s*uses:\s*(\S+)", re.M)

    def test_every_action_is_pinned_by_sha(self):
        for path in WORKFLOWS + [TEMPLATE]:
            refs = self.USES.findall(text(path))
            self.assertTrue(refs, path)
            for ref in refs:
                if ref.startswith("./") or ref == "tedeuxx/mhw/.github/workflows/reference-delivery-gate.yml@<mhw-commit-sha>":
                    continue
                self.assertRegex(ref, r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$", "%s: %s" % (path.name, ref))

    def test_the_gate_and_the_dry_run_name_no_environment(self):
        # A job that names a missing environment creates it, unprotected: neither file may name one.
        for path in WORKFLOWS:
            self.assertNotRegex(text(path), r"(?m)^\s+environment:", path.name)

    def test_the_gate_calls_the_validator_and_every_gate(self):
        body = text(WORKFLOWS[0])
        self.assertIn("project_policy.py check", body)
        for gate in ("contract", "container", "installed-stg", "classify", "environment"):
            self.assertIn("delivery_gate.py %s " % gate, body)

    def test_the_dry_run_has_no_deployment_job(self):
        body = text(WORKFLOWS[1]).split("\njobs:\n", 1)[1]
        self.assertEqual(sorted(re.findall(r"(?m)^  ([\w-]+):$", body)),
                         ["before-prod", "before-stg", "report"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
