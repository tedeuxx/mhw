#!/usr/bin/env python3
"""The project-policy contract (ADR-0015 lock 2 of 5, Issue #244): schema, examples and field docs.

    python3 -B global/project-policy/project_policy_test.py

This suite checks the contract's SHAPE. Its JSON Schema subset evaluator is the validator's own
(project_policy.py, Issue #245; its fail-closed command is tested in project_policy_check_test.py), so
the schema this suite passes is the schema `mhw policy check` applies. The evaluator refuses any schema
keyword it does not implement, so the schema cannot grow a rule this suite silently ignores.
"""
import copy
import json
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from project_policy import evaluate  # noqa: E402  the validator's own evaluator (Issue #245)
ROOT = HERE.parent.parent
SCHEMA = HERE / "project-policy.schema.json"
VALID = HERE / "project-policy.example.json"
INVALID = HERE / "project-policy.invalid.json"
DOC = ROOT / "docs" / "project-policy-contract.md"

# The fields Issue #244 names, pinned here rather than read from the schema, so that dropping one from
# the schema's "required" list turns this suite red instead of quietly shrinking what it checks.
ISSUE_FIELDS = [
    "schema_version",      # versioned
    "project",
    "madr",                # link to the project's ratified MADR
    "coverage",            # coverage target
    "mandatory_scenarios",
    "severity",
    "low_findings",        # tolerated low findings become bug Issues
    "risk_classification",  # risk class
    "approval",            # approval rule
    "recovery",            # recovery mode
]

# Every required field at every depth, pinned for the same reason; "[]" stands for any array item and
# the last three recovery fields are required only when recovery.mode is "manual".
REQUIRED_PATHS = sorted(ISSUE_FIELDS + [
    "madr.path", "madr.status",
    "coverage.threshold_percent", "coverage.metric",
    "mandatory_scenarios.critical_user_journeys", "mandatory_scenarios.security_controls",
    "mandatory_scenarios.risk_scenarios",
    "mandatory_scenarios.critical_user_journeys[].id",
    "mandatory_scenarios.critical_user_journeys[].description",
    "mandatory_scenarios.risk_scenarios[].id", "mandatory_scenarios.risk_scenarios[].description",
    "severity.tolerated", "severity.unclassified", "severity.inconclusive",
    "low_findings.bug_issue_required", "low_findings.issue_label",
    "risk_classification.rules", "risk_classification.unclassified",
    "risk_classification.rules[].class", "risk_classification.rules[].when",
    "approval.low_risk", "approval.high_risk",
    "recovery.mode", "recovery.recovery_time_objective_minutes", "recovery.runbook", "recovery.operator",
    "recovery.runbook.path", "recovery.runbook.last_tested",
])

def required_paths(value, schema, trail=()):
    """Every required key reachable in value, including one a satisfied if/then makes required."""
    found = []
    if isinstance(value, dict) and schema.get("type") == "object":
        required = list(schema.get("required", []))
        if "if" in schema and not evaluate(value, schema["if"]):
            required += schema.get("then", {}).get("required", [])
        for key in required:
            if key in value:
                found.append(trail + (key,))
        for key, sub in schema.get("properties", {}).items():
            if key in value:
                found.extend(required_paths(value[key], sub, trail + (key,)))
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            found.extend(required_paths(item, schema["items"], trail + (i,)))
    return found


def property_names(schema):
    """Every property name the schema declares, at any depth."""
    names = set()
    for key, sub in schema.get("properties", {}).items():
        names.add(key)
        names |= property_names(sub)
    if "items" in schema:
        names |= property_names(schema["items"])
    return names


# Issue #523: the pattern that makes a free-text field carry a letter or digit. It accepts a trailing
# newline on purpose (prose may end in one), so it has its own test instead of a trailing-newline case.
NONBLANK = r"^[\s\S]*[A-Za-z0-9][\s\S]*$"


def with_override(doc):
    """doc with a full baseline_override section (Issue #523), every optional object present."""
    doc = copy.deepcopy(doc)
    doc["baseline_override"] = {
        "definition_of_done": {"additional_criteria": [
            {"id": "accessibility-audit", "description": "Every new page passes an automated accessibility audit."}]},
        "documentation": {"additional_docs": [
            {"path": "docs/runbooks/rollback.md", "description": "The rollback runbook is current."}]},
    }
    return doc


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def manual_recovery(doc):
    doc = copy.deepcopy(doc)
    doc["recovery"] = {
        "mode": "manual",
        "recovery_time_objective_minutes": 30,
        "runbook": {"path": "docs/runbooks/rollback.md", "last_tested": "2026-10-30"},
        "operator": "@example-operator",
    }
    return doc


class ProjectPolicyContractTests(unittest.TestCase):
    def setUp(self):
        self.schema = load(SCHEMA)
        self.valid = load(VALID)

    def errors(self, doc):
        return evaluate(doc, self.schema)

    def assertRejects(self, doc, path, keyword=None):
        errors = self.errors(doc)
        hits = [e for e in errors if e[0] == path and (keyword is None or e[1] == keyword)]
        self.assertTrue(hits, "expected a failure at %s (%s); got %s" % (path, keyword, errors))

    # -- the issue's acceptance criteria ---------------------------------------------------------

    def test_schema_is_versioned_and_requires_every_field_the_issue_names(self):
        self.assertEqual(self.schema["properties"]["schema_version"], {"type": "integer", "const": 1})
        self.assertEqual(self.schema["required"], ISSUE_FIELDS)
        self.assertEqual(self.valid["schema_version"], 1)
        self.assertEqual(load(INVALID)["schema_version"], 1)

    def test_the_valid_example_passes(self):
        self.assertEqual(self.errors(self.valid), [])

    def test_the_valid_example_with_manual_recovery_passes(self):
        self.assertEqual(self.errors(manual_recovery(self.valid)), [])

    def test_removing_any_required_field_fails(self):
        covered = set()
        for base in (self.valid, manual_recovery(self.valid)):
            paths = required_paths(base, self.schema)
            covered |= {".".join("[]" if isinstance(p, int) else p for p in trail).replace(".[]", "[]")
                        for trail in paths}
            for trail in paths:
                with self.subTest(field=".".join(str(p) for p in trail), mode=base["recovery"]["mode"]):
                    doc = copy.deepcopy(base)
                    parent = doc
                    for step in trail[:-1]:
                        parent = parent[step]
                    del parent[trail[-1]]
                    self.assertNotEqual(self.errors(doc), [])
        self.assertEqual(sorted(covered), REQUIRED_PATHS)

    def test_every_top_level_field_removed_fails_at_that_field(self):
        for field in ISSUE_FIELDS:
            with self.subTest(field=field):
                doc = copy.deepcopy(self.valid)
                del doc[field]
                self.assertRejects(doc, "$." + field, "required")

    def test_the_invalid_example_fails_for_each_floor_it_weakens(self):
        invalid = load(INVALID)
        errors = self.errors(invalid)
        for path, keyword in [
            ("$.madr.status", "const"),
            ("$.mandatory_scenarios.security_controls", "contains"),
            ("$.severity.tolerated", "maxItems"),
            ("$.severity.tolerated[1]", "const"),
            ("$.low_findings.bug_issue_required", "const"),
            ("$.approval.high_risk", "const"),
            ("$.risk_classification.rules", "contains"),
            ("$.recovery.runbook", "required"),
            ("$.recovery.operator", "required"),
            ("$.coverage.threshold_percent", "minimum"),
        ]:
            with self.subTest(path=path):
                self.assertIn((path, keyword), errors)

    # -- the common floor, which a project file cannot weaken -------------------------------------

    def mutate(self, path, value, base=None):
        doc = copy.deepcopy(base if base is not None else self.valid)
        parent = doc
        for step in path[:-1]:
            parent = parent[step]
        parent[path[-1]] = value
        return doc

    def test_only_low_findings_are_tolerated(self):
        for tolerated in (["medium"], ["low", "medium"], ["high"], ["critical"]):
            with self.subTest(tolerated=tolerated):
                self.assertNotEqual(self.errors(self.mutate(("severity", "tolerated"), tolerated)), [])
        self.assertEqual(self.errors(self.mutate(("severity", "tolerated"), [])), [], "stricter is allowed")

    def test_unclassified_and_inconclusive_findings_block(self):
        for key in ("unclassified", "inconclusive"):
            with self.subTest(key=key):
                self.assertRejects(self.mutate(("severity", key), "tolerate"), "$.severity." + key, "const")

    def test_low_findings_always_need_a_bug_issue(self):
        self.assertRejects(self.mutate(("low_findings", "bug_issue_required"), False),
                           "$.low_findings.bug_issue_required", "const")
        self.assertRejects(self.mutate(("low_findings", "bug_issue_required"), 1),
                           "$.low_findings.bug_issue_required", "type")
        self.assertRejects(self.mutate(("low_findings", "issue_label"), ""),
                           "$.low_findings.issue_label", "minLength")

    def test_high_risk_needs_the_owner_for_the_exact_revision(self):
        self.assertRejects(self.mutate(("approval", "high_risk"), "automatic-after-all-gates"),
                           "$.approval.high_risk", "const")
        self.assertEqual(self.errors(self.mutate(("approval", "low_risk"), "owner-exact-revision")), [],
                         "owner approval for low risk is stricter and allowed")

    def test_an_unclassified_change_blocks(self):
        self.assertRejects(self.mutate(("risk_classification", "unclassified"), "low"),
                           "$.risk_classification.unclassified", "const")
        self.assertRejects(self.mutate(("risk_classification", "rules"), []),
                           "$.risk_classification.rules", "minItems")
        self.assertRejects(self.mutate(("risk_classification", "rules"), [{"class": "medium", "when": "x"}]),
                           "$.risk_classification.rules[0].class", "enum")

    def test_the_risk_model_names_at_least_one_high_risk_rule(self):
        # An all-low model would make approval.high_risk a constant that gates nothing.
        all_low = [{"class": "low", "when": "Every change."}, {"class": "low", "when": "Docs only."}]
        self.assertRejects(self.mutate(("risk_classification", "rules"), all_low),
                           "$.risk_classification.rules", "contains")
        one_high = [{"class": "high", "when": "Every change."}]
        self.assertEqual(self.errors(self.mutate(("risk_classification", "rules"), one_high)), [],
                         "an all-high model is stricter and allowed")

    def test_patterns_refuse_a_trailing_newline(self):
        # One negative case per pattern in the schema. ECMA-262 $ does not match before a final
        # newline; Python re.search with $ does, so the #245 validator must use full-match semantics.
        manual = manual_recovery(self.valid)
        cases = [
            (("project",), "example-owner/example-app\n", None, "$.project"),
            (("madr", "path"), "docs/adr/0007-quality-bar-and-deployment-risk.md\n", None, "$.madr.path"),
            (("mandatory_scenarios", "critical_user_journeys", 0, "id"), "sign-in\n", None,
             "$.mandatory_scenarios.critical_user_journeys[0].id"),
            (("mandatory_scenarios", "risk_scenarios", 0, "id"), "unpublished-draft-exposed\n", None,
             "$.mandatory_scenarios.risk_scenarios[0].id"),
            (("recovery", "runbook", "path"), "docs/runbooks/rollback.md\n", manual, "$.recovery.runbook.path"),
            (("recovery", "runbook", "last_tested"), "2026-10-30\n", manual, "$.recovery.runbook.last_tested"),
            (("recovery", "operator"), "@example-operator\n", manual, "$.recovery.operator"),
            (("baseline_override", "definition_of_done", "additional_criteria", 0, "id"), "accessibility-audit\n",
             with_override(self.valid), "$.baseline_override.definition_of_done.additional_criteria[0].id"),
            (("baseline_override", "documentation", "additional_docs", 0, "path"), "docs/runbooks/rollback.md\n",
             with_override(self.valid), "$.baseline_override.documentation.additional_docs[0].path"),
        ]
        text = json.dumps(self.schema)
        self.assertEqual(len(cases), text.count('"pattern"') - text.count(json.dumps(NONBLANK)),
                         "one case per pattern other than the non-blank one")
        for path, value, base, where in cases:
            with self.subTest(field=where):
                self.assertRejects(self.mutate(path, value, base), where, "pattern")

    def test_the_minimum_security_evidence_is_present(self):
        floor = ["quality-scan", "sast", "owasp-vulnerability-coverage", "authentication",
                 "authorization", "encryption-in-transit", "encryption-at-rest"]
        for control in floor:
            with self.subTest(dropped=control):
                kept = [c for c in self.valid["mandatory_scenarios"]["security_controls"] if c != control]
                self.assertRejects(self.mutate(("mandatory_scenarios", "security_controls"), kept),
                                   "$.mandatory_scenarios.security_controls", "contains")
        self.assertRejects(self.mutate(("mandatory_scenarios", "security_controls"), floor + ["made-up"]),
                           "$.mandatory_scenarios.security_controls[7]", "enum")

    def test_both_coverage_dimensions_are_required(self):
        for key in ("critical_user_journeys", "risk_scenarios"):
            with self.subTest(key=key):
                self.assertRejects(self.mutate(("mandatory_scenarios", key), []),
                                   "$.mandatory_scenarios." + key, "minItems")
        for threshold in (0, -1, 101):
            with self.subTest(threshold=threshold):
                self.assertNotEqual(self.errors(self.mutate(("coverage", "threshold_percent"), threshold)), [])

    def test_coverage_cannot_go_below_the_mhw_floor_of_85(self):
        # Issue #523, measured on 2026-11-20: the schema accepted threshold_percent 5 while the DoD asks
        # for at least 85. A project may tighten the number, never lower it.
        for threshold in (5, 50, 84, 84.99):
            with self.subTest(threshold=threshold):
                self.assertRejects(self.mutate(("coverage", "threshold_percent"), threshold),
                                   "$.coverage.threshold_percent", "minimum")
        for threshold in (85, 85.5, 90, 100):
            with self.subTest(threshold=threshold):
                self.assertEqual(self.errors(self.mutate(("coverage", "threshold_percent"), threshold)), [],
                                 "85 or more is the floor or stricter")
        self.assertEqual(self.schema["properties"]["coverage"]["properties"]["threshold_percent"]["minimum"], 85)

    def test_free_text_must_carry_a_letter_or_digit(self):
        # Issue #523: minLength 1 let a blank "when" on the one required high-risk rule through, which
        # makes the high-risk approval apply to nothing, and a blank label that finds no bug Issue.
        rules = copy.deepcopy(self.valid["risk_classification"]["rules"])
        rules[0]["when"] = " "
        override = with_override(self.valid)
        cases = [
            (("mandatory_scenarios", "critical_user_journeys", 0, "description"), None,
             "$.mandatory_scenarios.critical_user_journeys[0].description"),
            (("mandatory_scenarios", "risk_scenarios", 0, "description"), None,
             "$.mandatory_scenarios.risk_scenarios[0].description"),
            (("low_findings", "issue_label"), None, "$.low_findings.issue_label"),
            (("risk_classification", "rules", 0, "when"), None, "$.risk_classification.rules[0].when"),
            (("baseline_override", "definition_of_done", "additional_criteria", 0, "description"), override,
             "$.baseline_override.definition_of_done.additional_criteria[0].description"),
            (("baseline_override", "documentation", "additional_docs", 0, "description"), override,
             "$.baseline_override.documentation.additional_docs[0].description"),
        ]
        self.assertEqual(len(cases), json.dumps(self.schema).count(json.dumps(NONBLANK)), "one case per use")
        for path, base, where in cases:
            for blank in (" ", "\t\n", "- . -"):
                with self.subTest(field=where, value=blank):
                    self.assertRejects(self.mutate(path, blank, base), where, "pattern")
            with self.subTest(field=where, value="text"):
                self.assertEqual(self.errors(self.mutate(path, "Ends in a newline.\n", base)), [])

    # -- the baseline override (Issue #523): optional, and it may only add ------------------------

    def test_the_baseline_override_is_optional_and_valid_when_full(self):
        self.assertNotIn("baseline_override", self.schema["required"])
        self.assertEqual(self.errors(with_override(self.valid)), [])
        self.assertEqual(self.errors(self.mutate(("baseline_override",), {})), [])

    def test_the_baseline_override_carries_no_key_that_lowers_or_waives(self):
        override = self.schema["properties"]["baseline_override"]
        self.assertEqual(sorted(property_names(override)), sorted([
            "definition_of_done", "additional_criteria", "id", "description",
            "documentation", "additional_docs", "path"]))
        for trail, key in [((), "waive"), ((), "coverage_threshold_percent"), (("definition_of_done",), "skip"),
                           (("documentation",), "not_applicable")]:
            with self.subTest(key=key):
                doc = with_override(self.valid)
                parent = doc["baseline_override"]
                for step in trail:
                    parent = parent[step]
                parent[key] = True
                where = "$.baseline_override" + "".join("." + t for t in trail) + "." + key
                self.assertRejects(doc, where, "additionalProperties")

    def test_the_baseline_override_lists_are_not_empty_and_fully_described(self):
        for section, key in (("definition_of_done", "additional_criteria"), ("documentation", "additional_docs")):
            with self.subTest(section=section, case="empty list"):
                doc = with_override(self.valid)
                doc["baseline_override"][section][key] = []
                self.assertRejects(doc, "$.baseline_override.%s.%s" % (section, key), "minItems")
            with self.subTest(section=section, case="list missing"):
                doc = with_override(self.valid)
                del doc["baseline_override"][section][key]
                self.assertRejects(doc, "$.baseline_override.%s.%s" % (section, key), "required")
            item = with_override(self.valid)["baseline_override"][section][key][0]
            for field in item:
                with self.subTest(section=section, dropped=field):
                    doc = with_override(self.valid)
                    del doc["baseline_override"][section][key][0][field]
                    self.assertRejects(doc, "$.baseline_override.%s.%s[0].%s" % (section, key, field), "required")
        for path in ("/etc/x.md", "../x.md", "docs/x.txt"):
            with self.subTest(path=path):
                doc = with_override(self.valid)
                doc["baseline_override"]["documentation"]["additional_docs"][0]["path"] = path
                self.assertRejects(doc, "$.baseline_override.documentation.additional_docs[0].path", "pattern")

    def test_the_madr_must_be_ratified_and_inside_the_repository(self):
        self.assertRejects(self.mutate(("madr", "status"), "proposed"), "$.madr.status", "const")
        for path in ("/etc/adr.md", "../other/adr.md", "docs/../../adr.md", "docs/adr/0007.txt"):
            with self.subTest(path=path):
                self.assertRejects(self.mutate(("madr", "path"), path), "$.madr.path", "pattern")

    def test_manual_recovery_needs_rto_tested_runbook_and_operator(self):
        manual = manual_recovery(self.valid)
        for key in ("recovery_time_objective_minutes", "runbook", "operator"):
            with self.subTest(dropped=key):
                doc = copy.deepcopy(manual)
                del doc["recovery"][key]
                self.assertRejects(doc, "$.recovery." + key, "required")
        self.assertRejects(self.mutate(("recovery", "runbook", "last_tested"), "untested", manual),
                           "$.recovery.runbook.last_tested", "pattern")
        self.assertRejects(self.mutate(("recovery", "mode"), "none"), "$.recovery.mode", "enum")

    def test_unknown_versions_and_fields_fail(self):
        self.assertRejects(self.mutate(("schema_version",), 2), "$.schema_version", "const")
        self.assertRejects(self.mutate(("schema_version",), True), "$.schema_version", "type")
        self.assertRejects(self.mutate(("skip_gates",), True), "$.skip_gates", "additionalProperties")

    def test_every_object_rejects_an_unknown_key(self):
        # QA advisory A1 on #447: dropping additionalProperties false from one nested object left the
        # suite green. Each object is pinned here, not read from the schema, so dropping it turns red.
        manual = manual_recovery(self.valid)
        objects = [
            (), ("madr",), ("coverage",), ("mandatory_scenarios",),
            ("mandatory_scenarios", "critical_user_journeys", 0), ("mandatory_scenarios", "risk_scenarios", 0),
            ("severity",), ("low_findings",), ("risk_classification",), ("risk_classification", "rules", 0),
            ("approval",), ("recovery",), ("recovery", "runbook"),
            ("baseline_override",), ("baseline_override", "definition_of_done"),
            ("baseline_override", "definition_of_done", "additional_criteria", 0),
            ("baseline_override", "documentation"), ("baseline_override", "documentation", "additional_docs", 0),
        ]
        self.assertEqual(len(objects), json.dumps(self.schema).count('"additionalProperties": false'),
                         "one case per object that declares it")
        for trail in objects:
            where = "$" + "".join("[%d]" % s if isinstance(s, int) else "." + s for s in trail)
            with self.subTest(object=where):
                doc = with_override(manual)
                parent = doc
                for step in trail:
                    parent = parent[step]
                parent["skip_gates"] = True
                self.assertRejects(doc, where + ".skip_gates", "additionalProperties")

    # -- calibration of the evaluator itself, and the field reference -----------------------------

    def test_the_evaluator_refuses_keywords_it_does_not_implement(self):
        with self.assertRaises(ValueError):  # SchemaError is a ValueError
            evaluate({}, {"type": "object", "oneOf": []})

    def test_every_schema_field_is_described_in_the_docs_page(self):
        text = DOC.read_text(encoding="utf-8")
        for name in sorted(property_names(self.schema)):
            with self.subTest(field=name):
                self.assertIn("`" + name + "`", text)
        for path in ("global/project-policy/project-policy.schema.json",
                     "global/project-policy/project-policy.example.json",
                     "global/project-policy/project-policy.invalid.json"):
            with self.subTest(path=path):
                self.assertIn(path, text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
