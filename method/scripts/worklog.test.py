#!/usr/bin/env python3
from __future__ import annotations

import copy
import contextlib
import hashlib
import importlib.util
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("worklog", ROOT / "scripts/worklog.py")
worklog = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(worklog)
FIXTURE = json.loads((ROOT / "scripts/fixtures/worklog/scenario.json").read_text())


def tracker_export(events, complete=True, cutoff="2026-10-01T00:00:00Z"):
    comments = []
    for index, event in enumerate(events):
        body = f"{worklog.EVENT_MARKER}\n```json\n{json.dumps(event, sort_keys=True)}\n```"
        comments.append({"repository": event["issue"].split("#")[0], "issue": event["issue"],
                         "comment_id": index + 1, "created_at": event["timestamp"],
                         "updated_at": event["timestamp"], "body": body,
                         "body_sha256": hashlib.sha256(body.encode()).hexdigest()})
    return {"schema_version": 1, "cutoff": cutoff,
            "repositories": [{"repository": "acme/skills", "pagination_complete": complete},
                             {"repository": "acme/site", "pagination_complete": complete}],
            "prior_inventory": {"complete": complete, "comment_ids": list(range(1, len(comments) + 1))},
            "comments": comments}


# #515: a scenario whose report is COMPLETE, so a defect that only flips `partial` is observable. The full
# fixture is partial from the start (acme/site#8 carries unknown attribution), which is how a silent
# zero-credit could hide behind an unrelated warning.
CLEAN_SNAPSHOT = dict(copy.deepcopy(FIXTURE["snapshot"]), counting_units=copy.deepcopy(
    [unit for unit in FIXTURE["snapshot"]["counting_units"] if unit["issue"] != "acme/site#8"]))
CLEAN_EVENTS = [copy.deepcopy(event) for event in FIXTURE["events"] if event["issue"] != "acme/site#8"]


def with_comment(export, issue, comment_id, body):
    result = copy.deepcopy(export)
    result["comments"].append({"repository": issue.split("#")[0], "issue": issue, "comment_id": comment_id,
                               "created_at": "2026-09-02T00:00:00Z", "updated_at": "2026-09-02T00:00:00Z",
                               "body": body, "body_sha256": hashlib.sha256(body.encode()).hexdigest()})
    result["prior_inventory"]["comment_ids"].append(comment_id)
    return result


def gh_captures(events):
    """The shape `gh issue view <n> --repo <r> --json url,comments` prints, one capture per Issue."""
    captures, ids = {}, []
    for index, event in enumerate(events):
        repo, number = event["issue"].split("#")
        url = f"https://github.com/{repo}/issues/{number}"
        capture = captures.setdefault(event["issue"], {"url": url, "comments": []})
        comment_id = 5000 + index
        ids.append(comment_id)
        capture["comments"].append({
            "url": f"{url}#issuecomment-{comment_id}", "id": f"IC_{comment_id}", "createdAt": event["timestamp"],
            "includesCreatedEdit": False, "author": {"login": "someone"},
            "body": f"{worklog.EVENT_MARKER}\n```json\n{json.dumps(event, sort_keys=True)}\n```"})
    return list(captures.values()), sorted(ids)


def changed(source, path, value):
    result = copy.deepcopy(source)
    target = result
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return result


# #514 lens B1: each private spelling below passed the former word-start, four-token filter.
PRIVATE_SPELLINGS = [
    "resume from /tmp/x/continuation-6.md",
    "resume from ~/notes/continuation-6.md",
    "resume from /var/folders/ab/T/continuation-6.md",
    "resume from (/Users/someone/x)",
    "resume from /home/someone/continuation-6.md",
    "resume from /private/var/x",
    "open file:///x/y",
    "read tadeumendonca-io/.brand/positioning.md first",
    "read ../.brand/positioning.md first",
    "read .BRAND/positioning.md",
    "look in the .brand",
    "resume from C:\\Users\\x\\notes.md",
]
PUBLIC_SPELLINGS = [
    "open the merge request for the branch at the named commit",
    "re-run hooks/scripts/inventory-counts.test.sh",
    "read docs/worklog/README.md",
    "the branding section of README.md, and the .branded-x fixture",
]


class WorklogTest(unittest.TestCase):
    def baseline(self):
        snapshot = worklog.validate_snapshot(copy.deepcopy(FIXTURE["snapshot"]))
        events = copy.deepcopy(FIXTURE["events"])
        events.append(copy.deepcopy(events[0]))  # repeated delivery of one identical event
        return worklog.report(snapshot, tracker_export(events), "python3 scripts/worklog.py report ...")

    def test_cross_repository_mixed_harness_counts_each_issue_once(self):
        result = self.baseline()
        self.assertTrue(result["partial"])
        self.assertEqual(13, result["totals"]["completed_points"])
        self.assertEqual(3, result["totals"]["carryover_points"])
        self.assertEqual({"sole": 5, "mixed": 8, "unknown": 0}, result["totals"]["cohort_points"])
        self.assertEqual(13, sum(result["totals"]["cohort_points"].values()))
        self.assertEqual({"sole": 1, "mixed": 1, "unknown": 1}, result["totals"]["cohort_items"])
        self.assertEqual(13, sum(item["points"] for item in result["items"] if item["credited"]))
        self.assertTrue(any("incomplete attribution coverage: acme/site#8" == warning
                            for warning in result["warnings"]))

    def test_one_delivery_retains_revisions_from_sibling_repositories(self):
        events = copy.deepcopy(FIXTURE["events"][:3])
        sibling = copy.deepcopy(events[1])
        sibling.update({"event_id": "skills-7-site-checkpoint", "timestamp": "2026-09-02T12:00:00Z",
                        "event_type": "checkpoint", "stage": "build",
                        "predecessor_event_id": "skills-7-start"})
        sibling["revision"] = {"repository": "acme/site", "branch": "feat/7-counterpart",
                               "commit": "ccccccc"}
        sibling["handoff"] = {"state": "active", "to": None}
        events.append(sibling)

        result = worklog.report(FIXTURE["snapshot"], tracker_export(events), "reproduce")
        item = next(item for item in result["items"] if item["issue"] == "acme/skills#7")
        self.assertEqual(1, sum(entry["issue"] == "acme/skills#7"
                                for entry in result["items"]))
        self.assertEqual(8, item["points"])
        self.assertEqual({"acme/skills", "acme/site"},
                         {segment["revision"]["repository"] for segment in item["segments"]})

        invalid_source = tracker_export(events)
        invalid_source["comments"][0]["repository"] = "acme/site"
        with self.assertRaisesRegex(worklog.ContractError, "issue disagrees with repository"):
            worklog.report(FIXTURE["snapshot"], invalid_source, "reproduce")

    def test_conflicting_duplicate_fails(self):
        events = copy.deepcopy(FIXTURE["events"])
        conflict = copy.deepcopy(events[0])
        conflict["stage"] = "different"
        events.append(conflict)
        with self.assertRaisesRegex(worklog.ContractError, "conflicting content"):
            worklog.report(FIXTURE["snapshot"], tracker_export(events), "reproduce")

    # #515: the three tests that stood here compared numbers the TEST computed (`sum(999 …)`, `8 + 8 + 5 + 3`,
    # a copy of the result with an item deleted), so no source mutation could turn them red. Every test below
    # mutates the INPUT and asserts what the SOURCE derives from it; each was confirmed red under the source
    # mutation named in its docstring and green again after restoring the source.

    def test_credit_is_the_frozen_estimate_not_the_current_label(self):
        """Source mutation: credit `unit["planned_points"]` instead of the frozen estimate."""
        relabelled = copy.deepcopy(FIXTURE["snapshot"])
        relabelled["counting_units"][0]["planned_points"] = 13  # the label moved after implementation start
        result = worklog.report(relabelled, tracker_export(FIXTURE["events"]), "reproduce")
        self.assertEqual(8, next(item["points"] for item in result["items"] if item["issue"] == "acme/skills#7"))
        self.assertEqual(13, result["totals"]["completed_points"])  # 8 frozen + 5, never 13 + 5
        self.assertEqual(1, result["totals"]["scope_changes"])

    def test_duplicates_and_reopen_do_not_inflate_credit(self):
        """Source mutation: read the FIRST outcome instead of the latest (reopened work is then credited)."""
        result = self.baseline()  # carries one event delivered twice
        self.assertEqual(13, result["totals"]["completed_points"])
        self.assertEqual(3, result["totals"]["carryover_points"])
        site8 = next(item for item in result["items"] if item["issue"] == "acme/site#8")
        self.assertEqual(("reopened", False), (site8["outcome"], site8["credited"]))

    def test_sprint_mismatch_is_named_and_makes_the_report_partial(self):
        """#515 defect 1. Source mutations: drop the completion-sprint check (credit returns); drop the warning."""
        clean = worklog.report(CLEAN_SNAPSHOT, tracker_export(CLEAN_EVENTS), "reproduce")
        self.assertFalse(clean["partial"], clean["warnings"])  # calibration: nothing else makes this partial
        self.assertEqual(13, clean["totals"]["completed_points"])
        self.assertEqual([], clean["totals"]["completion_sprint_mismatches"])
        renamed = dict(copy.deepcopy(CLEAN_SNAPSHOT), sprint="sprint-other")
        result = worklog.report(renamed, tracker_export(CLEAN_EVENTS), "reproduce")
        self.assertEqual(0, result["totals"]["completed_points"])
        self.assertTrue(result["partial"], "a zero produced by a sprint-name mismatch read as a complete zero")
        self.assertEqual([{"issue": "acme/site#7", "completion_sprint": "sprint-fixture"},
                          {"issue": "acme/skills#7", "completion_sprint": "sprint-fixture"}],
                         result["totals"]["completion_sprint_mismatches"])
        self.assertIn("completion sprint mismatch: acme/skills#7 was accepted in sprint-fixture, "
                      "not sprint-other; no credit here", result["warnings"])
        self.assertEqual(13, result["totals"]["carryover_points"])
        self.assertIn("completion sprint mismatches: `[{", worklog.markdown(result))

    def test_non_delivery_outcomes_are_excluded_not_carried_over(self):
        """#515 defect 2. Source mutation: drop the cancelled/superseded/no-longer-relevant exclusion branch."""
        for reason in ("cancelled", "superseded", "no_longer_relevant"):
            with self.subTest(reason=reason):
                events = copy.deepcopy(CLEAN_EVENTS)
                late = copy.deepcopy(next(e for e in events if e["event_id"] == "site-7-accepted"))
                late.update({"event_id": f"site-7-{reason}", "timestamp": "2026-09-06T11:00:00Z",
                             "outcome": reason})
                late.pop("completion_sprint")
                late.pop("acceptance_evidence")
                events.append(late)
                result = worklog.report(CLEAN_SNAPSHOT, tracker_export(events), "reproduce")
                self.assertEqual([{"issue": "acme/site#7", "reason": reason}], result["excluded"])
                self.assertEqual(0, result["totals"]["carryover_points"])
                self.assertEqual(8, result["totals"]["completed_points"])

    def test_accepted_work_without_a_frozen_estimate_is_listed(self):
        """#515 defect 2. Source mutation: stop appending accepted-but-unestimated items."""
        events = [e for e in CLEAN_EVENTS if e["event_id"] != "site-7-start"]
        result = worklog.report(CLEAN_SNAPSHOT, tracker_export(events), "reproduce")
        self.assertEqual(["acme/site#7"], result["totals"]["unestimated_completions"])
        self.assertEqual(8, result["totals"]["completed_points"])
        self.assertEqual(0, result["totals"]["carryover_points"])
        self.assertTrue(result["partial"])

    def test_points_per_week_is_completed_points_over_measured_weeks(self):
        """#515 defect 2. Source mutation: any change to `completed * 7 / duration_days`."""
        for ends_at, days, expected in (("2026-09-08T00:00:00Z", 7.0, 13.0),
                                        ("2026-09-15T00:00:00Z", 14.0, 6.5),
                                        ("2026-09-11T00:00:00Z", 10.0, 9.1)):
            with self.subTest(ends_at=ends_at):
                snapshot = dict(copy.deepcopy(CLEAN_SNAPSHOT), ends_at=ends_at)
                totals = worklog.report(snapshot, tracker_export(CLEAN_EVENTS), "reproduce")["totals"]
                self.assertEqual((13, days, expected),
                                 (totals["completed_points"], totals["duration_days"], totals["points_per_week"]))

    def test_harness_spellings_are_one_cohort(self):
        """#515 defect 3. Source mutation: compare `harness` as written instead of through harness_key."""
        def with_site7_checkpoint(harness):
            events = copy.deepcopy(CLEAN_EVENTS)
            checkpoint = copy.deepcopy(next(e for e in events if e["event_id"] == "site-7-start"))
            checkpoint.update({"event_id": "site-7-checkpoint", "event_type": "checkpoint",
                               "timestamp": "2026-09-02T11:00:00Z"})
            checkpoint.pop("frozen_estimate")
            checkpoint["attribution"]["harness"] = harness
            events.append(checkpoint)
            result = worklog.report(CLEAN_SNAPSHOT, tracker_export(events), "reproduce")
            return next(i["cohort"] for i in result["items"] if i["issue"] == "acme/site#7"), result["partial"]

        self.assertEqual("Kiro", next(e for e in CLEAN_EVENTS if e["event_id"] == "site-7-start")
                         ["attribution"]["harness"])
        for spelling in ("kiro", "KIRO", " Kiro ", "ki-ro"):
            with self.subTest(spelling=spelling):
                self.assertEqual(("sole", False), with_site7_checkpoint(spelling))
        self.assertEqual(("mixed", False), with_site7_checkpoint("Codex"))  # control: a real second harness
        self.assertEqual("unknown", with_site7_checkpoint("---")[0])
        self.assertEqual(worklog.harness_key("Claude Code"), worklog.harness_key("claude-code"))
        result = worklog.report(CLEAN_SNAPSHOT, tracker_export(CLEAN_EVENTS), "reproduce")
        self.assertIn('"harness": "Kiro"', json.dumps(result["items"]))  # segments keep the value as written

    def test_a_marker_quoted_in_prose_is_not_an_event(self):
        """#515 defect 6. Source mutation: un-anchor EVENT_MARKER_RE / EVENT_RE from the start of a line."""
        prose = [f"the `{worklog.EVENT_MARKER}` marker opens an event",
                 "a later `<!-- worklog-event:v2 -->` would be refused",
                 f"quoted twice: {worklog.EVENT_MARKER} and {worklog.EVENT_MARKER}"]
        expected = worklog.report(CLEAN_SNAPSHOT, tracker_export(CLEAN_EVENTS), "reproduce")["totals"]
        for body in prose:
            with self.subTest(body=body):
                export = with_comment(tracker_export(CLEAN_EVENTS), "acme/skills#7", 900, body)
                self.assertEqual(expected, worklog.report(CLEAN_SNAPSHOT, export, "reproduce")["totals"])
        # An envelope marker on its own line with no event fence is still malformed, and still fails.
        broken = with_comment(tracker_export(CLEAN_EVENTS), "acme/skills#7", 901,
                              f"{worklog.EVENT_MARKER}\nthe fence is missing")
        with self.assertRaisesRegex(worklog.ContractError, "malformed worklog event body"):
            worklog.report(CLEAN_SNAPSHOT, broken, "reproduce")

    def test_export_producer_composes_what_the_report_reads(self):
        """#515 defect 4. Source mutations: edited comments keep created_at as updated_at; the prior inventory
        keeps IDs of Issues not captured now; pagination defaults to complete; the comment ID is not parsed."""
        captures, ids = gh_captures(FIXTURE["events"])
        export = worklog.build_export(captures, "2026-10-01T00:00:00Z")
        self.assertEqual(ids, sorted(comment["comment_id"] for comment in export["comments"]))
        result = worklog.report(FIXTURE["snapshot"], export, "reproduce")
        expected = worklog.report(FIXTURE["snapshot"], tracker_export(FIXTURE["events"]), "reproduce")
        self.assertEqual(expected["totals"], result["totals"])
        self.assertIn("incomplete pagination: acme/skills", result["warnings"])
        self.assertIn("historical integrity unknown: prior inventory is absent or incomplete", result["warnings"])

        # Declared complete, with a prior export that also held an Issue this capture leaves out.
        prior = worklog.build_export(captures + [{"url": "https://github.com/acme/site/issues/99", "comments": [
            {"url": "https://github.com/acme/site/issues/99#issuecomment-777", "createdAt": "2026-09-01T00:00:00Z",
             "includesCreatedEdit": False, "body": "not an event"}]}], "2026-10-01T00:00:00Z",
            pagination_complete=True)
        declared = worklog.build_export(captures, "2026-10-01T00:00:00Z", prior, pagination_complete=True)
        self.assertEqual({"complete": True, "comment_ids": sorted(ids, key=str)}, declared["prior_inventory"])
        clean = worklog.report(CLEAN_SNAPSHOT, worklog.build_export(
            gh_captures(CLEAN_EVENTS)[0], "2026-10-01T00:00:00Z",
            worklog.build_export(gh_captures(CLEAN_EVENTS)[0], "2026-10-01T00:00:00Z", pagination_complete=True),
            True), "reproduce")
        self.assertFalse(clean["partial"], clean["warnings"])  # a producer-made export CAN be complete

        edited, _ = gh_captures(CLEAN_EVENTS)
        edited[0]["comments"][0]["includesCreatedEdit"] = True
        result = worklog.report(CLEAN_SNAPSHOT, worklog.build_export(edited, "2026-10-01T00:00:00Z"), "reproduce")
        self.assertTrue(any(w.startswith("comment edit timestamp unavailable: ") for w in result["warnings"]))

        for label, mutate, needle in (
                ("duplicate capture", lambda c: c.append(copy.deepcopy(c[0])), "captured twice"),
                ("not an issue url", lambda c: c[0].update(url="https://github.com/acme/site/pull/7"),
                 "must be a GitHub issue URL"),
                ("comment from another issue", lambda c: c[0]["comments"][0].update(
                    url="https://github.com/acme/site/issues/8#issuecomment-5"), "must be a comment URL on")):
            with self.subTest(label=label):
                bad, _ = gh_captures(FIXTURE["events"])
                mutate(bad)
                with self.assertRaisesRegex(worklog.ContractError, needle):
                    worklog.build_export(bad, "2026-10-01T00:00:00Z")

    def test_export_prior_inventory_is_only_as_complete_as_the_prior_capture(self):
        """#515 lens finding. Source mutation: `prior_inventory.complete` is True for any prior. A prior built
        without `--pagination-complete` (or missing a repository captured now) cannot vouch for history, so the
        new export's inventory stays incomplete and the report stays partial, with the named warning."""
        captures, _ = gh_captures(CLEAN_EVENTS)
        truncated = copy.deepcopy(captures)
        for capture in truncated:
            capture["comments"] = capture["comments"][:1]
        undeclared = worklog.build_export(truncated, "2026-10-01T00:00:00Z")
        current = worklog.build_export(captures, "2026-10-01T00:00:00Z", undeclared, pagination_complete=True)
        self.assertFalse(current["prior_inventory"]["complete"])
        result = worklog.report(CLEAN_SNAPSHOT, current, "reproduce")
        self.assertTrue(result["partial"])
        self.assertIn("historical integrity unknown: prior inventory is absent or incomplete", result["warnings"])

        # One repository declared, the other not: still incomplete.
        mixed = copy.deepcopy(worklog.build_export(captures, "2026-10-01T00:00:00Z", pagination_complete=True))
        mixed["repositories"][0]["pagination_complete"] = False
        self.assertFalse(worklog.build_export(captures, "2026-10-01T00:00:00Z", mixed, True)
                         ["prior_inventory"]["complete"])

        # A prior that never captured a repository captured now: incomplete for that repository.
        repos = sorted({c["url"].split("/issues/")[0] for c in captures})
        self.assertGreater(len(repos), 1)
        one_repo = [c for c in captures if c["url"].startswith(repos[0] + "/")]
        partial_prior = worklog.build_export(one_repo, "2026-10-01T00:00:00Z", pagination_complete=True)
        self.assertFalse(worklog.build_export(captures, "2026-10-01T00:00:00Z", partial_prior, True)
                         ["prior_inventory"]["complete"])

        # Control: the same prior, declared complete for every repository, IS complete.
        declared = worklog.build_export(truncated, "2026-10-01T00:00:00Z", pagination_complete=True)
        self.assertTrue(worklog.build_export(captures, "2026-10-01T00:00:00Z", declared, True)
                        ["prior_inventory"]["complete"])

    def test_export_cli_feeds_the_report_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            script = str(ROOT / "scripts/worklog.py")
            paths = []
            for index, capture in enumerate(gh_captures(CLEAN_EVENTS)[0]):
                paths += ["--capture", str(temp / f"capture-{index}.json")]
                (temp / f"capture-{index}.json").write_text(json.dumps(capture))
            produced = subprocess.run(["python3", "-B", script, "export", "--cutoff", "2026-10-01T00:00:00Z"]
                                      + paths, check=True, capture_output=True, text=True).stdout
            (temp / "export.json").write_text(produced)
            (temp / "snapshot.json").write_text(json.dumps(CLEAN_SNAPSHOT))
            reported = json.loads(subprocess.run(
                ["python3", "-B", script, "report", "--snapshot", str(temp / "snapshot.json"),
                 "--export", str(temp / "export.json"), "--format", "json", "--reproduction-command", "r"],
                check=True, capture_output=True, text=True).stdout)
            self.assertEqual(13, reported["totals"]["completed_points"])
            failed = subprocess.run(["python3", "-B", script, "export", "--cutoff", "not-a-time"] + paths,
                                    check=False, capture_output=True, text=True)
            self.assertEqual(2, failed.returncode)
            self.assertNotIn("Traceback", failed.stderr)

    def test_incomplete_and_edited_inputs_are_partial_or_invalid(self):
        incomplete = worklog.report(FIXTURE["snapshot"], tracker_export(FIXTURE["events"], False), "reproduce")
        self.assertTrue(incomplete["partial"])
        corrupt = tracker_export(FIXTURE["events"])
        corrupt["comments"][0]["body"] += "edited"
        with self.assertRaisesRegex(worklog.ContractError, "hash mismatch"):
            worklog.report(FIXTURE["snapshot"], corrupt, "reproduce")
        deleted = tracker_export(FIXTURE["events"])
        deleted["comments"].pop()
        result = worklog.report(FIXTURE["snapshot"], deleted, "reproduce")
        self.assertTrue(result["partial"])
        self.assertTrue(any("deleted historical" in warning for warning in result["warnings"]))
        missing_repo = tracker_export(FIXTURE["events"])
        missing_repo["repositories"] = missing_repo["repositories"][:1]
        result = worklog.report(FIXTURE["snapshot"], missing_repo, "reproduce")
        self.assertTrue(any("missing repository: acme/site" == warning for warning in result["warnings"]))

    def test_cutoff_is_an_as_of_boundary_for_acceptance_reopen_and_correction(self):
        events = copy.deepcopy(FIXTURE["events"])
        cases = [
            ("2026-09-01T00:00:00Z", 0),
            ("2026-09-03T23:00:00Z", 8),
            ("2026-09-05T23:00:00Z", 16),
            ("2026-09-07T00:00:00Z", 13),
        ]
        for cutoff, expected in cases:
            with self.subTest(cutoff=cutoff):
                result = worklog.report(FIXTURE["snapshot"], tracker_export(events, cutoff=cutoff), "reproduce")
                self.assertEqual(expected, result["totals"]["completed_points"])
        corrected = copy.deepcopy(events[0])
        corrected["event_id"] = "skills-7-start-backdated-corrected"
        corrected["frozen_estimate"]["points"] = 13
        correction = copy.deepcopy(events[1])
        correction.update({"event_id": "late-correction", "timestamp": "2026-09-07T12:00:00Z",
                           "event_type": "correction", "supersedes_event_id": events[0]["event_id"],
                           "corrected_event": corrected})
        events.append(correction)
        before = worklog.report(FIXTURE["snapshot"], tracker_export(events, cutoff="2026-09-07T11:00:00Z"), "reproduce")
        after = worklog.report(FIXTURE["snapshot"], tracker_export(events, cutoff="2026-09-07T13:00:00Z"), "reproduce")
        self.assertEqual(13, before["totals"]["completed_points"])
        self.assertEqual(18, after["totals"]["completed_points"])

    def test_correction_graph_rejects_collisions_and_supports_chains(self):
        events = copy.deepcopy(FIXTURE["events"])
        cross = copy.deepcopy(events[4])
        bad = copy.deepcopy(events[1])
        bad.update({"event_id": "cross-correction", "event_type": "correction",
                    "supersedes_event_id": events[0]["event_id"], "corrected_event": cross})
        with self.assertRaisesRegex(worklog.ContractError, "replacement event_id collision"):
            worklog.report(FIXTURE["snapshot"], tracker_export(events + [bad]), "reproduce")
        bad["corrected_event"]["event_id"] = "cross-issue-unique"
        with self.assertRaisesRegex(worklog.ContractError, "target and replacement must belong"):
            worklog.report(FIXTURE["snapshot"], tracker_export(events + [bad]), "reproduce")

        first_replacement = copy.deepcopy(events[0])
        first_replacement["event_id"] = "skills-7-start-r1"
        first_replacement["frozen_estimate"]["points"] = 13
        first = copy.deepcopy(events[1])
        first.update({"event_id": "correction-r1", "timestamp": "2026-09-07T10:00:00Z",
                      "event_type": "correction", "supersedes_event_id": events[0]["event_id"],
                      "corrected_event": first_replacement})
        second_replacement = copy.deepcopy(first_replacement)
        second_replacement["event_id"] = "skills-7-start-r2"
        second_replacement["frozen_estimate"]["points"] = 21
        second = copy.deepcopy(first)
        second.update({"event_id": "correction-r2", "timestamp": "2026-09-08T10:00:00Z",
                       "supersedes_event_id": first_replacement["event_id"],
                       "corrected_event": second_replacement})
        result = worklog.report(FIXTURE["snapshot"], tracker_export(events + [first, second]), "reproduce")
        self.assertEqual(21, next(item["points"] for item in result["items"] if item["issue"] == "acme/skills#7"))

    def test_missing_history_and_unknown_participation_are_partial(self):
        empty = worklog.report(FIXTURE["snapshot"], tracker_export([]), "reproduce")
        self.assertTrue(empty["partial"])
        self.assertEqual(3, len([warning for warning in empty["warnings"] if warning.startswith("missing worklog history:")]))
        no_work_snapshot = copy.deepcopy(FIXTURE["snapshot"])
        no_work_snapshot["counting_units"] = []
        self.assertFalse(worklog.report(no_work_snapshot, tracker_export([]), "reproduce")["partial"])

        known_unknown = copy.deepcopy(FIXTURE["events"])
        unknown = copy.deepcopy(known_unknown[3])
        unknown.update({"event_id": "site-7-unknown-checkpoint", "timestamp": "2026-09-02T12:00:00Z",
                        "event_type": "checkpoint", "stage": "build"})
        unknown.pop("frozen_estimate")
        unknown["attribution"].update({"harness": "unknown", "provenance": "declared"})
        known_unknown.append(unknown)
        result = worklog.report(FIXTURE["snapshot"], tracker_export(known_unknown), "reproduce")
        self.assertEqual("unknown", next(item["cohort"] for item in result["items"] if item["issue"] == "acme/site#7"))
        self.assertTrue(result["partial"])

        mixed_unknown = copy.deepcopy(FIXTURE["events"])
        unknown["issue"] = "acme/skills#7"
        unknown["event_id"] = "skills-7-unknown-checkpoint"
        unknown["revision"]["repository"] = "acme/skills"
        mixed_unknown.append(unknown)
        result = worklog.report(FIXTURE["snapshot"], tracker_export(mixed_unknown), "reproduce")
        self.assertEqual("mixed", next(item["cohort"] for item in result["items"] if item["issue"] == "acme/skills#7"))
        self.assertTrue(result["partial"])

    def test_malformed_contract_values_and_marker_versions_fail(self):
        malformed_events = [
            ("boolean schema", "unsupported schema_version", {"schema_version": True}),
            ("blank acceptance evidence", "entries must be non-empty strings", {"acceptance_evidence": [" \t"]}),
        ]
        for label, message, changes in malformed_events:
            with self.subTest(label=label):
                event = copy.deepcopy(FIXTURE["events"][2])
                event.update(changes)
                with self.assertRaisesRegex(worklog.ContractError, message):
                    worklog.validate_event(event)
        enum_fields = [
            ("event_type", ("event_type",)),
            ("provenance", ("attribution", "provenance")),
            ("outcome", ("outcome",)),
        ]
        invalid_enum_types = [
            ("object", {}), ("array", []), ("null", None), ("boolean", True), ("number", 7),
        ]
        for field, path in enum_fields:
            for kind, value in invalid_enum_types:
                with self.subTest(enum=field, invalid_type=kind):
                    event = changed(FIXTURE["events"][2], path, value)
                    with self.assertRaisesRegex(worklog.ContractError, "must be a non-empty string"):
                        worklog.validate_event(event)
        snapshot = copy.deepcopy(FIXTURE["snapshot"])
        snapshot["counting_units"][0]["planned_points"] = True
        with self.assertRaisesRegex(worklog.ContractError, "positive integer"):
            worklog.report(snapshot, tracker_export(FIXTURE["events"]), "reproduce")
        export = tracker_export(FIXTURE["events"])
        export["repositories"][0]["pagination_complete"] = "false"
        with self.assertRaisesRegex(worklog.ContractError, "must be a boolean"):
            worklog.report(FIXTURE["snapshot"], export, "reproduce")
        export = tracker_export(FIXTURE["events"])
        export["prior_inventory"]["complete"] = "false"
        with self.assertRaisesRegex(worklog.ContractError, "must be a boolean"):
            worklog.report(FIXTURE["snapshot"], export, "reproduce")
        export = tracker_export(FIXTURE["events"])
        export["prior_inventory"]["comment_ids"] = [{}]
        with self.assertRaisesRegex(worklog.ContractError, "entries must be strings or integers"):
            worklog.report(FIXTURE["snapshot"], export, "reproduce")
        event = copy.deepcopy(FIXTURE["events"][0])
        event["frozen_estimate"]["points"] = True
        with self.assertRaisesRegex(worklog.ContractError, "positive integer"):
            worklog.validate_event(event)
        event = copy.deepcopy(FIXTURE["events"][0])
        event["attribution"]["harness"] = {"invented": "identity"}
        with self.assertRaisesRegex(worklog.ContractError, "non-empty string"):
            worklog.validate_event(event)
        accepted = copy.deepcopy(FIXTURE["events"][2])
        accepted["acceptance_evidence"] = [{"invented": "proof"}]
        with self.assertRaisesRegex(worklog.ContractError, "string array"):
            worklog.validate_event(accepted)
        accepted = copy.deepcopy(FIXTURE["events"][2])
        accepted["acceptance_evidence"] = ["/Users/example/private.txt"]
        with self.assertRaisesRegex(worklog.ContractError, "private or machine-local"):
            worklog.validate_event(accepted)
        export = tracker_export(FIXTURE["events"])
        export["comments"][0]["body"] = export["comments"][0]["body"].replace("worklog-event:v1", "worklog-event:v2")
        export["comments"][0]["body_sha256"] = hashlib.sha256(export["comments"][0]["body"].encode()).hexdigest()
        with self.assertRaisesRegex(worklog.ContractError, "unsupported worklog marker version"):
            worklog.report(FIXTURE["snapshot"], export, "reproduce")

    def test_contract_rejects_malformed_fields_at_their_boundaries(self):
        start = FIXTURE["events"][0]
        accepted = FIXTURE["events"][2]
        checkpoint = FIXTURE["events"][1]
        event_cases = [
            ("not object", None),
            ("bad issue", changed(start, ("issue",), "missing-number")),
            ("non-UTC timestamp", changed(start, ("timestamp",), "2026-09-01")),
            ("invalid timestamp", changed(start, ("timestamp",), "not-a-dateZ")),
            ("unknown event type", changed(start, ("event_type",), "invented")),
            ("blank stage", changed(start, ("stage",), " ")),
            ("blank predecessor", changed(checkpoint, ("predecessor_event_id",), "")),
            ("attribution not object", changed(start, ("attribution",), [])),
            ("bad provenance", changed(start, ("attribution", "provenance"), "inferred")),
            ("plugin not object", changed(start, ("attribution", "plugin"), [])),
            ("revision not object", changed(start, ("revision",), [])),
            ("bad revision repo", changed(start, ("revision", "repository"), "bad")),
            ("blank branch", changed(start, ("revision", "branch"), "")),
            ("bad commit", changed(start, ("revision", "commit"), "not-a-sha")),
            ("blank evidence", changed(start, ("evidence",), [" "])),
            ("handoff not object", changed(start, ("handoff",), [])),
            ("blank handoff target", changed(start, ("handoff", "to"), "")),
            ("estimate not object", changed(start, ("frozen_estimate",), [])),
            ("bad commitment", changed(start, ("frozen_estimate", "commitment_points"), True)),
            ("estimate on checkpoint", changed(checkpoint, ("frozen_estimate",), start["frozen_estimate"])),
            ("invalid outcome", changed(accepted, ("outcome",), "done")),
            ("empty acceptance list", changed(accepted, ("acceptance_evidence",), [])),
            ("completion on reopened", changed(FIXTURE["events"][7], ("completion_sprint",), "sprint-03")),
            ("outcome on checkpoint", changed(checkpoint, ("outcome",), "accepted")),
            ("correction field on checkpoint", changed(checkpoint, ("supersedes_event_id",), "event-1")),
        ]
        for label, event in event_cases:
            with self.subTest(event=label), self.assertRaises(worklog.ContractError):
                worklog.validate_event(event)

        snapshot = FIXTURE["snapshot"]
        duplicate_repo = copy.deepcopy(snapshot)
        duplicate_repo["repositories"].append(copy.deepcopy(duplicate_repo["repositories"][0]))
        duplicate_unit = copy.deepcopy(snapshot)
        duplicate_unit["counting_units"].append(copy.deepcopy(duplicate_unit["counting_units"][0]))
        snapshot_cases = [
            ("not object", None),
            ("no repositories", changed(snapshot, ("repositories",), [])),
            ("repo not object", changed(snapshot, ("repositories", 0), [])),
            ("bad repo", changed(snapshot, ("repositories", 0, "repository"), "bad")),
            ("duplicate repo", duplicate_repo),
            ("bad milestone", changed(snapshot, ("repositories", 0, "milestone_number"), True)),
            ("units not array", changed(snapshot, ("counting_units",), {})),
            ("unit not object", changed(snapshot, ("counting_units", 0), [])),
            ("bad unit issue", changed(snapshot, ("counting_units", 0, "issue"), "bad")),
            ("undeclared unit repo", changed(snapshot, ("counting_units", 0, "issue"), "other/repo#1")),
            ("bad parent", changed(snapshot, ("counting_units", 0, "parent"), "bad")),
            ("duplicate unit", duplicate_unit),
        ]
        for label, value in snapshot_cases:
            with self.subTest(snapshot=label), self.assertRaises(worklog.ContractError):
                worklog.validate_snapshot(value)

    def test_live_correction_segments_and_markdown_are_auditable(self):
        snapshot = json.loads((ROOT / "docs/planning/sprint-03.worklog.json").read_text())
        published = [
            (5804402298, "2026-09-23T23:04:31Z", "published-5804402298.md"),
            (5804452881, "2026-09-23T23:09:16Z", "published-5804452881.md"),
        ]
        comments = []
        for comment_id, created_at, filename in published:
            body = (ROOT / "scripts/fixtures/worklog" / filename).read_text()
            comments.append({"repository": "tedeuxx/tadeumendonca-skills",
                             "issue": "tedeuxx/tadeumendonca-skills#499", "comment_id": comment_id,
                             "created_at": created_at, "updated_at": None, "body": body,
                             "body_sha256": hashlib.sha256(body.encode()).hexdigest()})
        export = {"schema_version": 1, "cutoff": "2026-09-24T00:00:00Z",
                  "repositories": [{"repository": "tedeuxx/tadeumendonca-skills",
                                    "pagination_complete": True}],
                  "prior_inventory": {"complete": True, "comment_ids": [item[0] for item in published]},
                  "comments": comments}
        result = worklog.report(snapshot, export, "python3 scripts/worklog.py report ...")
        self.assertFalse(any("missing predecessor_event_id" in warning for warning in result["warnings"]))
        self.assertTrue(result["partial"])
        self.assertEqual(2, len([warning for warning in result["warnings"]
                                if warning.startswith("comment edit timestamp unavailable:")]))
        item = result["items"][0]
        serialized = json.dumps(item, sort_keys=True)
        self.assertIn("2.0.74", serialized)
        self.assertIn("2.0.77", serialized)
        self.assertIn('"runtime_version": "unknown"', serialized)
        self.assertIn("skills-499-implementation-start-20260923t224133z-corrected", serialized)
        combined_sources = [segment["source"]["comment_id"] for segment in item["segments"]
                            if segment["event_id"] in {"skills-499-correct-start-plugin-20260923t230719z",
                                                       "skills-499-resume-plugin-2077-20260923t230719z"}]
        self.assertEqual([5804452881, 5804452881], combined_sources)
        rendered = worklog.markdown(result)
        for needle in ("report version", "schema version", "cohort points", "work-type points",
                       "comment IDs", "Items and retained segments", "2.0.74", "2.0.77", "unknown"):
            self.assertIn(needle, rendered)

    def test_parent_child_overlap_and_unsupported_schema_fail(self):
        snapshot = copy.deepcopy(FIXTURE["snapshot"])
        snapshot["counting_units"][1]["parent"] = "acme/skills#7"
        with self.assertRaisesRegex(worklog.ContractError, "parent/child overlap"):
            worklog.validate_snapshot(snapshot)
        event = copy.deepcopy(FIXTURE["events"][0])
        event["schema_version"] = 2
        with self.assertRaisesRegex(worklog.ContractError, "unsupported"):
            worklog.validate_event(event)
        private = copy.deepcopy(FIXTURE["events"][0])
        private["evidence"] = ["/Users/example/private.txt"]
        with self.assertRaisesRegex(worklog.ContractError, "private or machine-local"):
            worklog.validate_event(private)

    def test_correction_replaces_original_without_erasing_it(self):
        events = copy.deepcopy(FIXTURE["events"])
        corrected = copy.deepcopy(events[0])
        corrected["event_id"] = "skills-7-start-corrected"
        corrected["frozen_estimate"]["points"] = 13
        correction = copy.deepcopy(events[1])
        correction.update({"event_id": "correction-1", "event_type": "correction",
                           "supersedes_event_id": "skills-7-start", "corrected_event": corrected})
        events.append(correction)
        result = worklog.report(FIXTURE["snapshot"], tracker_export(events), "reproduce")
        self.assertEqual(13, next(item["points"] for item in result["items"] if item["issue"] == "acme/skills#7"))
        self.assertEqual(1, result["totals"]["scope_changes"])

    def test_cli_is_deterministic_and_prepare_is_file_backed(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            snapshot = temp / "snapshot.json"
            export = temp / "export.json"
            event = temp / "event.json"
            snapshot.write_text(json.dumps(FIXTURE["snapshot"]))
            export.write_text(json.dumps(tracker_export(FIXTURE["events"])))
            event.write_text(json.dumps(FIXTURE["events"][0]))
            command = ["python3", str(ROOT / "scripts/worklog.py"), "report", "--snapshot", str(snapshot),
                       "--export", str(export), "--format", "json", "--reproduction-command", "same command"]
            first = subprocess.run(command, check=True, capture_output=True, text=True).stdout
            second = subprocess.run(command, check=True, capture_output=True, text=True).stdout
            self.assertEqual(first, second)
            prepared = subprocess.run(["python3", str(ROOT / "scripts/worklog.py"), "prepare-event", str(event)],
                                      check=True, capture_output=True, text=True).stdout
            self.assertTrue(prepared.startswith(worklog.EVENT_MARKER))
            invalid = tracker_export(FIXTURE["events"])
            invalid["repositories"][0]["pagination_complete"] = "false"
            export.write_text(json.dumps(invalid))
            failed = subprocess.run(command, check=False, capture_output=True, text=True)
            self.assertEqual(2, failed.returncode)
            self.assertIn("must be a boolean", failed.stderr)
            self.assertNotIn("Traceback", failed.stderr)

    def test_cli_entrypoint_covers_both_formats_validation_and_clean_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            snapshot = temp / "snapshot.json"
            export = temp / "export.json"
            event = temp / "event.json"
            snapshot.write_text(json.dumps(FIXTURE["snapshot"]))
            export.write_text(json.dumps(tracker_export(FIXTURE["events"])))
            event.write_text(json.dumps(FIXTURE["events"][0]))
            commands = [
                (["worklog.py", "validate-event", str(event)], '"event_id":"skills-7-start"'),
                (["worklog.py", "prepare-event", str(event)], worklog.EVENT_MARKER),
                (["worklog.py", "report", "--snapshot", str(snapshot), "--export", str(export),
                  "--format", "json", "--reproduction-command", "reproduce"], '"report_version"'),
                (["worklog.py", "report", "--snapshot", str(snapshot), "--export", str(export),
                  "--format", "markdown", "--reproduction-command", "reproduce"], "report version:"),
            ]
            for argv, needle in commands:
                with self.subTest(argv=argv[1]), mock.patch.object(sys, "argv", argv):
                    stdout = io.StringIO()
                    with contextlib.redirect_stdout(stdout):
                        self.assertEqual(0, worklog.main())
                    self.assertIn(needle, stdout.getvalue())
            with mock.patch.object(sys, "argv", ["worklog.py", "validate-event", str(temp / "missing.json")]):
                stderr = io.StringIO()
                with contextlib.redirect_stderr(stderr):
                    self.assertEqual(2, worklog.main())
                self.assertIn("cannot read JSON", stderr.getvalue())
                self.assertNotIn("Traceback", stderr.getvalue())

            malformed_events = [
                ("boolean-schema", {"schema_version": True}),
                ("blank-proof", {"acceptance_evidence": [""]}),
            ]
            for label, changes in malformed_events:
                with self.subTest(label=label):
                    invalid_event = copy.deepcopy(FIXTURE["events"][2])
                    invalid_event.update(changes)
                    event.write_text(json.dumps(invalid_event))
                    failed = subprocess.run(["python3", "-B", str(ROOT / "scripts/worklog.py"),
                                             "validate-event", str(event)], check=False,
                                            capture_output=True, text=True)
                    self.assertEqual(2, failed.returncode)
                    self.assertNotIn("Traceback", failed.stderr)
            enum_fields = [
                ("event_type", ("event_type",)),
                ("provenance", ("attribution", "provenance")),
                ("outcome", ("outcome",)),
            ]
            invalid_enum_types = [
                ("object", {}), ("array", []), ("null", None), ("boolean", True), ("number", 7),
            ]
            for field, path in enum_fields:
                for kind, value in invalid_enum_types:
                    with self.subTest(cli_enum=field, invalid_type=kind):
                        event.write_text(json.dumps(changed(FIXTURE["events"][2], path, value)))
                        failed = subprocess.run(["python3", "-B", str(ROOT / "scripts/worklog.py"),
                                                 "validate-event", str(event)], check=False,
                                                capture_output=True, text=True)
                        self.assertEqual(2, failed.returncode)
                        self.assertIn("must be a non-empty string", failed.stderr)
                        self.assertNotIn("Traceback", failed.stderr)
            invalid_export = tracker_export(FIXTURE["events"])
            invalid_export["prior_inventory"]["comment_ids"] = [{}]
            export.write_text(json.dumps(invalid_export))
            failed = subprocess.run(["python3", "-B", str(ROOT / "scripts/worklog.py"), "report",
                                     "--snapshot", str(snapshot), "--export", str(export),
                                     "--format", "json", "--reproduction-command", "reproduce"],
                                    check=False, capture_output=True, text=True)
            self.assertEqual(2, failed.returncode)
            self.assertNotIn("Traceback", failed.stderr)

    def test_continuity_record_is_bounded_public_and_producer_strict(self):
        # #514: the home for state that must survive a session is a handoff/checkpoint event on the
        # Issue being worked, and its one free-text field — next_act — is bounded.
        handoff = copy.deepcopy(next(e for e in FIXTURE["events"] if e["event_type"] == "handoff"))
        self.assertNotIn("next_act", handoff)
        # Retained history without next_act still reads, and still reports, exactly as before.
        worklog.validate_event(copy.deepcopy(handoff))
        with_act = dict(handoff, next_act="open the merge request for the branch at the named commit")
        worklog.validate_event(copy.deepcopy(with_act))
        worklog.validate_prepared(worklog.validate_event(copy.deepcopy(with_act)))
        checkpoint = dict(handoff, event_type="checkpoint", event_id="skills-7-checkpoint")
        worklog.validate_prepared(worklog.validate_event(copy.deepcopy(checkpoint)))  # optional there
        rejected = [
            ("start-carries-next-act", dict(FIXTURE["events"][0], next_act="x"), "only valid on checkpoint"),
            ("outcome-carries-next-act", dict(FIXTURE["events"][2], next_act="x"), "only valid on checkpoint"),
            ("multi-line", dict(handoff, next_act="first\nsecond"), "single line"),
            ("carriage-return", dict(handoff, next_act="first\rsecond"), "single line"),
            ("over-limit", dict(handoff, next_act="a" * (worklog.FREE_TEXT_LIMIT + 1)), "at most 280"),
            ("machine-local", dict(handoff, next_act="resume from /private/tmp/x/continuation-5.md"), "private"),
            ("private-source", dict(handoff, next_act="read .brand/positioning first"), "private"),
            ("blank", dict(handoff, next_act="   "), "non-empty"),
            ("not-a-string", dict(handoff, next_act=["open the PR"]), "non-empty"),
        ]
        for label, event, needle in rejected:
            with self.subTest(label=label), self.assertRaisesRegex(worklog.ContractError, needle):
                worklog.validate_event(copy.deepcopy(event))
        # Exactly at the limit is accepted, so the bound is the documented one and not one lower.
        worklog.validate_event(dict(handoff, next_act="a" * worklog.FREE_TEXT_LIMIT))
        # Producer strictness: a NEW handoff must name its next act, and new evidence is bounded.
        with self.assertRaisesRegex(worklog.ContractError, "missing next_act"):
            worklog.validate_prepared(worklog.validate_event(copy.deepcopy(handoff)))
        for label, evidence, needle in [
            ("evidence-over-limit", ["b" * (worklog.FREE_TEXT_LIMIT + 1)], "at most 280"),
            ("evidence-multi-line", ["a notes\ndump"], "single line"),
        ]:
            with self.subTest(label=label), self.assertRaisesRegex(worklog.ContractError, needle):
                worklog.validate_prepared(worklog.validate_event(dict(with_act, evidence=evidence)))
        # ...while the READER tolerates the same long evidence on retained history.
        worklog.validate_event(dict(with_act, evidence=["b" * (worklog.FREE_TEXT_LIMIT + 1)]))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "handoff.json"
            path.write_text(json.dumps(handoff))
            script = str(ROOT / "scripts/worklog.py")
            refused = subprocess.run(["python3", "-B", script, "prepare-event", str(path)],
                                     check=False, capture_output=True, text=True)
            self.assertEqual(2, refused.returncode)
            self.assertEqual("", refused.stdout)
            self.assertIn("missing next_act", refused.stderr)
            validated = subprocess.run(["python3", "-B", script, "validate-event", str(path)],
                                       check=False, capture_output=True, text=True)
            self.assertEqual(0, validated.returncode)
            path.write_text(json.dumps(with_act))
            prepared = subprocess.run(["python3", "-B", script, "prepare-event", str(path)],
                                      check=True, capture_output=True, text=True).stdout
            self.assertIn('"next_act": "open the merge request', prepared)

    def test_privacy_filter_is_strict_for_producers_and_for_next_act(self):
        handoff = copy.deepcopy(next(e for e in FIXTURE["events"] if e["event_type"] == "handoff"))
        for text in PRIVATE_SPELLINGS:
            with self.subTest(next_act=text), self.assertRaisesRegex(worklog.ContractError, "private"):
                # next_act has no retained history, so the READER is strict too.
                worklog.validate_event(dict(handoff, next_act=text))
            with self.subTest(evidence=text):
                event = dict(handoff, next_act="open the pull request", evidence=[text])
                if not worklog.PRIVATE_EVIDENCE.search(text):
                    worklog.validate_event(copy.deepcopy(event))  # the reader filter did not widen
                with self.assertRaisesRegex(worklog.ContractError, "private"):
                    worklog.validate_prepared(worklog.validate_event(copy.deepcopy(event)))
        for text in PUBLIC_SPELLINGS:
            with self.subTest(allowed=text):
                worklog.validate_prepared(worklog.validate_event(dict(handoff, next_act=text, evidence=[text])))
        outcome = copy.deepcopy(FIXTURE["events"][2])
        worklog.validate_prepared(worklog.validate_event(copy.deepcopy(outcome)))
        with self.assertRaisesRegex(worklog.ContractError, "acceptance_evidence.*private"):
            worklog.validate_prepared(worklog.validate_event(dict(outcome, acceptance_evidence=["/tmp/x"])))

    def test_prepare_event_recurses_into_a_corrected_event(self):
        # #514 lens B2: a correction carrying a handoff must meet the producer bounds of that handoff,
        # because the report reads the corrected event as the effective one.
        handoff = copy.deepcopy(next(e for e in FIXTURE["events"] if e["event_type"] == "handoff"))
        wrapped = dict(handoff, event_id="skills-7-handoff-v2", evidence=["b" * (worklog.FREE_TEXT_LIMIT + 1)])
        correction = dict(handoff, event_type="correction", event_id="skills-7-correction",
                          supersedes_event_id=handoff["event_id"], corrected_event=wrapped)
        worklog.validate_event(copy.deepcopy(correction))  # the reader still accepts it as history
        with self.assertRaisesRegex(worklog.ContractError, "corrected_event: missing next_act"):
            worklog.validate_prepared(worklog.validate_event(copy.deepcopy(correction)))
        with_act = dict(correction, corrected_event=dict(wrapped, next_act="open the pull request"))
        with self.assertRaisesRegex(worklog.ContractError, r"corrected_event\.evidence\[0\]: must be at most 280"):
            worklog.validate_prepared(worklog.validate_event(copy.deepcopy(with_act)))
        private = dict(correction, corrected_event=dict(handoff, event_id="skills-7-handoff-v2",
                                                        next_act="resume from /tmp/x"))
        with self.assertRaisesRegex(worklog.ContractError, "corrected_event.next_act: contains private"):
            worklog.validate_event(copy.deepcopy(private))
        clean = dict(correction, corrected_event=dict(handoff, event_id="skills-7-handoff-v2",
                                                      next_act="open the pull request"))
        worklog.validate_prepared(worklog.validate_event(copy.deepcopy(clean)))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "correction.json"
            path.write_text(json.dumps(correction))
            script = str(ROOT / "scripts/worklog.py")
            result = subprocess.run(["python3", "-B", script, "prepare-event", str(path)],
                                    check=False, capture_output=True, text=True)
            self.assertEqual(2, result.returncode)
            self.assertEqual("", result.stdout)
            self.assertIn("corrected_event: missing next_act", result.stderr)

    @unittest.skipUnless(shutil.which("jq"), "jq is not installed")
    def test_readme_resume_command_agrees_with_the_report(self):
        # #514 lens B3: the published resume command must return the next_act of the report's effective
        # set — superseded events dropped, ordered by the effective event's timestamp, not comment position.
        readme = (ROOT / "docs/worklog/README.md").read_text()
        match = re.search(r"--json comments --jq '(.*?)'\n```", readme, re.S)
        self.assertIsNotNone(match, "resume command not found in docs/worklog/README.md")
        jq_filter = match.group(1)
        base = copy.deepcopy(next(e for e in FIXTURE["events"] if e["event_type"] == "handoff"))

        def at(minute):
            return f"2026-09-02T10:{minute:02d}:00Z"

        def handoff(event_id, minute, act=None):
            event = dict(copy.deepcopy(base), event_id=event_id, timestamp=at(minute))
            return dict(event, next_act=act) if act else event

        def checkpoint(event_id, minute):
            return dict(handoff(event_id, minute), event_type="checkpoint")

        def correction(event_id, minute, target, replacement):
            return dict(handoff(event_id, minute), event_type="correction", supersedes_event_id=target,
                        corrected_event=replacement)

        def block(event):
            return f"{worklog.EVENT_MARKER}\n```json\n{json.dumps(event, indent=2)}\n```\n"

        def oracle(events):
            records = [{"event": e, "source": {}, "available_at": e["timestamp"]} for e in events]
            effective, _, _ = worklog.retained_graph(records)
            acts = [r["event"]["next_act"] for r in effective if r["event"].get("next_act")]
            return acts[-1] if acts else ""

        malformed = f"{worklog.EVENT_MARKER}\n```json\n{{\"event_id\": \"broken\",}}\n```\n"
        scenarios = {
            "handoff corrected into a checkpoint": [
                handoff("x", 1, "act A"), correction("c", 2, "x", checkpoint("x2", 1))],
            "old handoff corrected after a newer one": [
                handoff("y", 1, "act OLD"), handoff("x", 2, "act NEW"),
                correction("c", 3, "y", handoff("y2", 1, "act OLD-FIXED"))],
            "handoff corrected into a handoff": [
                handoff("x", 1, "act A"), correction("c", 2, "x", handoff("x2", 1, "act B"))],
            "correction chain": [
                handoff("x", 1, "act A"), correction("c", 2, "x", handoff("x2", 1, "act B")),
                correction("d", 3, "x2", handoff("x3", 1, "act C"))],
            "no next_act anywhere": [checkpoint("k", 1)],
        }
        expected = {"handoff corrected into a checkpoint": "",
                    "old handoff corrected after a newer one": "act NEW",
                    "handoff corrected into a handoff": "act B",
                    "correction chain": "act C",
                    "no next_act anywhere": ""}
        for name, events in scenarios.items():
            for event in events:
                worklog.validate_event(copy.deepcopy(event))
            bodies = [block(e) for e in events]
            with self.subTest(scenario=name):
                self.assertEqual(expected[name], oracle(events))
                for extra in ([], [malformed]):
                    payload = json.dumps({"comments": [{"body": b} for b in bodies + extra]})
                    result = subprocess.run(["jq", "-r", jq_filter], input=payload, check=False,
                                            capture_output=True, text=True)
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertEqual(expected[name], result.stdout.strip())

    def test_schema_documents_the_continuity_field(self):
        schema = json.loads((ROOT / "docs/worklog/event.schema.json").read_text())
        field = schema["properties"]["next_act"]
        # The schema carries the strict next_act filter too, spelled without flags. Checked by behaviour,
        # against the same spellings the code is tested with, rather than by comparing strings.
        strict = [re.compile(part["not"]["pattern"]) for part in field["allOf"] if set(part) == {"not"}]
        self.assertEqual(1, len(strict))
        for text in PRIVATE_SPELLINGS:
            with self.subTest(schema_refuses=text):
                self.assertTrue(strict[0].search(text))
        for text in PUBLIC_SPELLINGS:
            with self.subTest(schema_allows=text):
                self.assertIsNone(strict[0].search(text))
        self.assertIn({"maxLength": worklog.FREE_TEXT_LIMIT, "not": {"pattern": "[\\r\\n]"}}, field["allOf"])
        self.assertIn({"if": {"required": ["next_act"]},
                       "then": {"properties": {"event_type": {"enum": sorted(worklog.CONTINUITY_TYPES)}}}},
                      schema["allOf"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
