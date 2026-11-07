#!/usr/bin/env python3
"""The project-policy contract (ADR-0015 lock 2 of 5, Issue #244): schema, examples and field docs.

    python3 -B global/project-policy/project_policy_test.py

This suite checks the contract's SHAPE only. The JSON Schema subset evaluator below lives in this test
and is not a tool: mhw ships no validator for the contract yet (that is Issue #245, which also decides
what a project's CI runs). The evaluator refuses any schema keyword it does not implement, so the
schema cannot grow a rule this suite silently ignores.
"""
import copy
import json
from pathlib import Path
import re
import unittest

HERE = Path(__file__).resolve().parent
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

ANNOTATIONS ={"$schema", "title", "description", "$comment"}
KEYWORDS = ANNOTATIONS | {
    "type", "const", "enum", "required", "properties", "additionalProperties", "items", "minItems",
    "maxItems", "uniqueItems", "contains", "allOf", "if", "then", "minimum", "maximum",
    "exclusiveMinimum", "minLength", "pattern",
}
TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
}


def same(a, b):
    """JSON equality: true is not 1."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    return a == b


def evaluate(value, schema, path="$"):
    """Errors, as (path, keyword) pairs, of value against the subset of draft 2020-12 used here."""
    unknown = set(schema) - KEYWORDS
    if unknown:
        raise ValueError("%s: schema keyword not implemented by this suite: %s" % (path, sorted(unknown)))
    errors = []
    kind = schema.get("type")
    if kind is not None and not TYPES[kind](value):
        return [(path, "type")]
    if "const" in schema and not same(value, schema["const"]):
        errors.append((path, "const"))
    if "enum" in schema and not any(same(value, option) for option in schema["enum"]):
        errors.append((path, "enum"))
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append((path + "." + key, "required"))
        if schema.get("additionalProperties", True) is False:
            for key in value:
                if key not in properties:
                    errors.append((path + "." + key, "additionalProperties"))
        elif "additionalProperties" in schema and schema["additionalProperties"] is not True:
            raise ValueError("%s: only additionalProperties false is implemented" % path)
        for key, sub in properties.items():
            if key in value:
                errors.extend(evaluate(value[key], sub, path + "." + key))
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append((path, "minItems"))
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append((path, "maxItems"))
        if schema.get("uniqueItems") and any(
                any(same(item, earlier) for earlier in value[:i]) for i, item in enumerate(value)):
            errors.append((path, "uniqueItems"))
        if "items" in schema:
            for i, item in enumerate(value):
                errors.extend(evaluate(item, schema["items"], "%s[%d]" % (path, i)))
        if "contains" in schema and not any(not evaluate(item, schema["contains"], path) for item in value):
            errors.append((path, "contains"))
    if TYPES["number"](value):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append((path, "minimum"))
        if "maximum" in schema and value > schema["maximum"]:
            errors.append((path, "maximum"))
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append((path, "exclusiveMinimum"))
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append((path, "minLength"))
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append((path, "pattern"))
    for sub in schema.get("allOf", []):
        errors.extend(evaluate(value, sub, path))
    if "if" in schema:
        if not evaluate(value, schema["if"], path):
            errors.extend(evaluate(value, schema.get("then", {}), path))
    elif "then" in schema:
        raise ValueError("%s: then without if" % path)
    return errors


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
            ("$.recovery.runbook", "required"),
            ("$.recovery.operator", "required"),
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

    # -- calibration of the evaluator itself, and the field reference -----------------------------

    def test_the_evaluator_refuses_keywords_it_does_not_implement(self):
        with self.assertRaises(ValueError):
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
