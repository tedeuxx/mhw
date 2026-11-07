#!/usr/bin/env python3
"""`mhw policy check`, the fail-closed validator of the project-policy contract (ADR-0015 lock 3 of 5,
Issue #245).

    python3 -B global/project-policy/project_policy_check_test.py

One test per failure class: the three the Issue names (missing, malformed, unknown version) and the five
#192 names (missing or invalid risk classification, missing mandatory evidence, medium-or-higher
findings, unknown severity, inconclusive evidence), plus the validator's own refusal to answer when it
cannot evaluate. Each asserts a non-zero exit AND the class in the reason, so a red cannot come from
the wrong branch.
"""
import contextlib
import copy
import datetime
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import project_policy  # noqa: E402

VALID = json.loads((HERE / "project-policy.example.json").read_text(encoding="utf-8"))
TODAY = datetime.date(2026, 11, 7)


def manual(doc):
    doc = copy.deepcopy(doc)
    doc["recovery"] = {
        "mode": "manual",
        "recovery_time_objective_minutes": 30,
        "runbook": {"path": "docs/runbooks/rollback.md", "last_tested": "2026-10-30"},
        "operator": "@example-operator",
    }
    return doc


def put(doc, path, value):
    doc = copy.deepcopy(doc)
    parent = doc
    for step in path[:-1]:
        parent = parent[step]
    parent[path[-1]] = value
    return doc


def drop(doc, path):
    doc = copy.deepcopy(doc)
    parent = doc
    for step in path[:-1]:
        parent = parent[step]
    del parent[path[-1]]
    return doc


class PolicyCheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.file = self.dir / "project-policy.json"

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = project_policy.main(argv)
        return code, out.getvalue(), err.getvalue()

    def check_bytes(self, raw, today=TODAY, schema=project_policy.SCHEMA):
        self.file.write_bytes(raw)
        return project_policy.check(str(self.file), schema, today)

    def check_doc(self, doc, **kw):
        return self.check_bytes(json.dumps(doc).encode("utf-8"), **kw)

    def assertFails(self, result, reason, code=1):
        got, lines = result
        self.assertEqual(got, code, lines)
        self.assertTrue(any(reason in line for line in lines), "no %r in %s" % (reason, lines))
        self.assertFalse(any(line.startswith("OK") for line in lines), lines)

    # -- passes ----------------------------------------------------------------------------------

    def test_the_valid_example_passes_through_project_and_file(self):
        (self.dir / "project-policy.json").write_text(json.dumps(VALID), encoding="utf-8")
        code, out, err = self.run_main(["check", "--project=" + str(self.dir)])
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(out.startswith("OK  "), out)
        code, out, _ = self.run_main(["check", "--file=" + str(HERE / "project-policy.example.json")])
        self.assertEqual(code, 0, out)

    def test_manual_recovery_with_everything_it_needs_passes(self):
        self.assertEqual(self.check_doc(manual(VALID))[0], 0)
        self.assertEqual(self.check_doc(put(manual(VALID), ("recovery", "runbook", "last_tested"),
                                            "2026-11-08"))[0], 0, "one day of time-zone slack")

    # -- the Issue's three classes ---------------------------------------------------------------

    def test_missing_fails(self):
        code, _, err = self.run_main(["check", "--project=" + str(self.dir)])
        self.assertEqual(code, 1)
        self.assertIn("missing", err)
        self.assertFails(project_policy.check(str(self.dir), today=TODAY), "missing")  # a directory

    def test_a_directory_is_missing_on_every_os(self):
        # Windows raises PermissionError, not IsADirectoryError, when a directory is read (run
        # 42402521059); simulate it here so a POSIX run catches a read before the directory test.
        def windows_read(path_self):
            if path_self.is_dir():
                raise PermissionError(13, "Permission denied")
            return original(path_self)
        original = Path.read_bytes
        with unittest.mock.patch.object(Path, "read_bytes", windows_read):
            self.assertFails(project_policy.check(str(self.dir), today=TODAY), "missing: ")

    def test_malformed_fails(self):
        for name, raw in [
            ("not JSON", b"{\"schema_version\": 1,"),
            ("empty", b""),
            ("not UTF-8", b"\xff\xfe{}"),
            ("NaN", json.dumps(put(VALID, ("coverage", "threshold_percent"), float("nan"))).encode()),
            ("Infinity", json.dumps(put(VALID, ("coverage", "threshold_percent"), float("inf"))).encode()),
            ("repeated key", json.dumps(VALID).replace('"approval": {', '"approval": {"high_risk": '
                                                       '"automatic-after-all-gates", ', 1).encode()),
        ]:
            with self.subTest(case=name):
                self.assertFails(self.check_bytes(raw), "malformed")
        for value in ([VALID], "x", 1, None):
            with self.subTest(top=value):
                self.assertFails(self.check_doc(value), "malformed")

    def test_unknown_version_fails(self):
        for doc in (drop(VALID, ("schema_version",)), put(VALID, ("schema_version",), 2),
                    put(VALID, ("schema_version",), True), put(VALID, ("schema_version",), "1"),
                    put(VALID, ("schema_version",), 1.5)):
            with self.subTest(version=doc.get("schema_version", "absent")):
                result = self.check_doc(doc)
                self.assertFails(result, "unknown version")
                # Refused before the version-1 schema is applied: one reason, not a v1 report.
                self.assertEqual(len(result[1]), 1, result[1])

    # -- the classes #192 names ------------------------------------------------------------------

    def test_missing_or_invalid_risk_classification_fails(self):
        for doc in (drop(VALID, ("risk_classification",)),
                    put(VALID, ("risk_classification", "unclassified"), "low"),
                    put(VALID, ("risk_classification", "rules"), []),
                    put(VALID, ("risk_classification", "rules"), [{"class": "low", "when": "Always."}]),
                    put(VALID, ("risk_classification", "rules"), [{"class": "medium", "when": "x"}]),
                    put(VALID, ("risk_classification", "rules"), [{"class": "high", "when": ""}])):
            with self.subTest(doc=doc.get("risk_classification")):
                self.assertFails(self.check_doc(doc), "missing or invalid risk classification")

    def test_missing_mandatory_evidence_fails(self):
        controls = VALID["mandatory_scenarios"]["security_controls"]
        for doc in (drop(VALID, ("mandatory_scenarios",)),
                    put(VALID, ("mandatory_scenarios", "security_controls"),
                        [c for c in controls if c != "sast"]),
                    put(VALID, ("mandatory_scenarios", "critical_user_journeys"), []),
                    put(VALID, ("mandatory_scenarios", "risk_scenarios"), []),
                    drop(VALID, ("coverage",)),
                    put(VALID, ("coverage", "threshold_percent"), 0)):
            with self.subTest():
                self.assertFails(self.check_doc(doc), "missing mandatory evidence")

    def test_medium_or_higher_findings_fail(self):
        for tolerated in (["medium"], ["high"], ["critical"], ["low", "medium"]):
            with self.subTest(tolerated=tolerated):
                self.assertFails(self.check_doc(put(VALID, ("severity", "tolerated"), tolerated)),
                                 "medium-or-higher findings tolerated")

    def test_unknown_severity_fails(self):
        for doc in (put(VALID, ("severity", "tolerated"), ["moderate"]),
                    put(VALID, ("severity", "tolerated"), ["LOW"]),
                    put(VALID, ("severity", "unclassified"), "tolerate"),
                    drop(VALID, ("severity",))):
            with self.subTest(severity=doc.get("severity")):
                self.assertFails(self.check_doc(doc), "unknown severity")

    def test_inconclusive_evidence_that_does_not_block_fails(self):
        for value in ("tolerate", "pass", None):
            with self.subTest(inconclusive=value):
                self.assertFails(self.check_doc(put(VALID, ("severity", "inconclusive"), value)),
                                 "inconclusive evidence does not block")

    # -- the rest of the floor -------------------------------------------------------------------

    def test_the_rest_of_the_floor_fails_with_its_own_reason(self):
        for doc, reason in [
            (put(VALID, ("approval", "high_risk"), "automatic-after-all-gates"), "risk-based approval weakened"),
            (put(VALID, ("low_findings", "bug_issue_required"), False), "low finding without a bug Issue"),
            (put(VALID, ("madr", "status"), "proposed"), "project MADR not ratified"),
            (drop(manual(VALID), ("recovery", "operator")), "recovery not prepared"),
            (put(VALID, ("skip_gates",), True), "contract invalid"),
        ]:
            with self.subTest(reason=reason):
                self.assertFails(self.check_doc(doc), reason)

    def test_the_invalid_example_fails(self):
        code, _, err = self.run_main(["check", "--file=" + str(HERE / "project-policy.invalid.json")])
        self.assertEqual(code, 1)
        for reason in ("medium-or-higher findings tolerated", "missing mandatory evidence",
                       "missing or invalid risk classification", "recovery not prepared"):
            self.assertIn(reason, err)

    def test_last_tested_must_be_a_real_past_date(self):
        for value, keyword in (("2026-02-30", "date"), ("2026-13-01", "date"), ("2026-11-09", "future")):
            with self.subTest(last_tested=value):
                doc = put(manual(VALID), ("recovery", "runbook", "last_tested"), value)
                self.assertFails(self.check_doc(doc), "last_tested: %s (recovery not prepared)" % keyword)

    def test_patterns_are_full_matches_through_the_command(self):
        # ECMA-262 $ does not match before a final newline; Python re.search with $ would.
        for path, value, base in [
            (("project",), "example-owner/example-app\n", VALID),
            (("madr", "path"), "docs/adr/0007-quality-bar-and-deployment-risk.md\n", VALID),
            (("recovery", "operator"), "@example-operator\n", manual(VALID)),
            (("recovery", "runbook", "last_tested"), "2026-10-30\n", manual(VALID)),
        ]:
            with self.subTest(field=".".join(path)):
                self.assertFails(self.check_doc(put(base, path, value)), ": pattern (")

    def test_a_team_is_not_an_identified_operator(self):
        # ADR-0015 asks for an identified operator; @org/team names a group, so it stays refused.
        self.assertFails(self.check_doc(put(manual(VALID), ("recovery", "operator"), "@org/oncall")),
                         "$.recovery.operator: pattern")

    # -- cannot validate: refuse to answer, never pass -------------------------------------------

    def test_an_unusable_schema_is_exit_2_not_a_pass(self):
        bad = self.dir / "schema.json"
        bad.write_text(json.dumps({"type": "object", "oneOf": []}), encoding="utf-8")
        self.assertFails(self.check_doc(VALID, schema=bad), "cannot evaluate", code=2)
        bad.write_text(json.dumps({"type": "object", "properties": {"project": {"pattern": "e"}}}),
                       encoding="utf-8")
        self.assertFails(self.check_doc(VALID, schema=bad), "only patterns anchored", code=2)
        bad.write_text("{", encoding="utf-8")
        self.assertFails(self.check_doc(VALID, schema=bad), "cannot read the contract schema", code=2)
        self.assertFails(self.check_doc(VALID, schema=self.dir / "absent.json"),
                         "cannot read the contract schema", code=2)

    def test_a_broken_schema_is_exit_2_with_a_reason_not_a_traceback(self):
        bad = self.dir / "schema.json"
        for name, schema in [
            ("unknown type", {"type": "null"}),
            ("type as a list", {"type": ["object", "null"]}),
            ("non-string pattern", {"type": "object", "properties": {"project": {"pattern": 7}}}),
            ("anchored but invalid regex", {"type": "object", "properties": {"project": {"pattern": "^(a$"}}}),
            ("anchored, unknown regex", {"type": "object", "properties": {"project": {"pattern": "^.*$"}}}),
            ("not an object", [1]),
        ]:
            with self.subTest(case=name):
                bad.write_text(json.dumps(schema), encoding="utf-8")
                self.assertFails(self.check_doc(VALID, schema=bad), "cannot evaluate", code=2)
                if "regex" in name:
                    self.assertFails(self.check_doc(VALID, schema=bad), "not in the validator's known set",
                                     code=2)

    def test_every_schema_pattern_is_in_the_known_set(self):
        # The validator compiles no pattern from a file; the shipped schema must use only known ones.
        def patterns(node):
            if isinstance(node, dict):
                if isinstance(node.get("pattern"), str):
                    yield node["pattern"]
                for v in node.values():
                    yield from patterns(v)
            elif isinstance(node, list):
                for v in node:
                    yield from patterns(v)
        used = set(patterns(json.loads(project_policy.SCHEMA.read_text(encoding="utf-8"))))
        self.assertEqual(used, set(project_policy.KNOWN_PATTERNS))

    def test_usage_errors_are_exit_2(self):
        for argv in (["check", "--project=a", "--file=b"], ["check", "--projects=a"], ["check", "--file="]):
            with self.subTest(argv=argv):
                self.assertEqual(self.run_main(argv)[0], 2)

    @unittest.skipIf(os.name == "nt", "./mhw is the POSIX launcher; Windows runs project_policy.py")
    def test_the_mhw_command_reaches_the_validator(self):
        mhw = str(ROOT / "mhw")
        ok = subprocess.run([mhw, "policy", "check", "--file=" + str(HERE / "project-policy.example.json")],
                            capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        bad = subprocess.run([mhw, "policy", "check", "--project=" + str(self.dir)],
                             capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        self.assertIn("missing", bad.stderr)
        self.assertEqual(subprocess.run([mhw, "policy"], capture_output=True).returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
