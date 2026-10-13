#!/usr/bin/env python3
"""Behavioural tests for every reviewed milestone route, using a stub gh on PATH."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, sys

state_path = pathlib.Path(os.environ["MILESTONE_STUB_STATE"])
log_path = pathlib.Path(os.environ["MILESTONE_STUB_LOG"])
args = sys.argv[1:]
with log_path.open("a", encoding="utf-8") as stream:
    stream.write(json.dumps(args) + "\n")
if os.environ.get("MILESTONE_STUB_FAIL") == "1":
    print("stub gh failure", file=sys.stderr)
    raise SystemExit(9)
if args[:2] == ["repo", "view"]:
    print("owner/repo")
    raise SystemExit(0)
state = json.loads(state_path.read_text())
if not args or args[0] != "api":
    print("unsupported stub command", file=sys.stderr)
    raise SystemExit(8)
endpoint = args[1]
if "?state=all" in endpoint:
    print(json.dumps([[state["milestone"]]]))
    raise SystemExit(0)
if endpoint.endswith("/milestones") and "POST" in args:
    fields = [args[i + 1] for i, value in enumerate(args) if value == "-f"]
    values = dict(field.split("=", 1) for field in fields)
    created = dict(state["milestone"], number=8, title=values["title"], description=values.get("description", ""))
    print(json.dumps(created))
    raise SystemExit(0)
if endpoint.endswith("/milestones/404"):
    print("not found", file=sys.stderr)
    raise SystemExit(1)
if endpoint.endswith("/milestones/7") and "PATCH" not in args:
    current = dict(state["milestone"])
    if os.environ.get("MILESTONE_STUB_RACE_AFTER_GET"):
        state["milestone"]["description"] = os.environ["MILESTONE_STUB_RACE_AFTER_GET"]
        state["race_observed"] = os.environ["MILESTONE_STUB_RACE_AFTER_GET"]
        state_path.write_text(json.dumps(state))
    print(json.dumps(current))
    raise SystemExit(0)
if endpoint.endswith("/milestones/7") and "PATCH" in args:
    fields = [args[i + 1] for i, value in enumerate(args) if value == "-f"]
    values = dict(field.split("=", 1) for field in fields)
    updated = dict(state["milestone"], **values)
    state["milestone"] = updated
    state_path.write_text(json.dumps(state))
    print(json.dumps(updated))
    raise SystemExit(0)
print("unsupported endpoint", file=sys.stderr)
raise SystemExit(8)
'''


class MilestoneRoutes(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="milestone-routes-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.stub = self.bin / "gh"
        self.stub.write_text(STUB)
        self.stub.chmod(0o755)
        self.state = self.base / "state.json"
        self.log = self.base / "gh.log"
        self.state.write_text(json.dumps({"milestone": {
            "number": 7,
            "title": "sprint-05",
            "description": "before",
            "state": "open",
            "open_issues": 0,
            "closed_issues": 0,
        }}))
        self.environment = dict(os.environ)
        self.environment.update({
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "MILESTONE_STUB_STATE": str(self.state),
            "MILESTONE_STUB_LOG": str(self.log),
            "PYTHONDONTWRITEBYTECODE": "1",
        })

    def run_route(self, name, *arguments, check=True, environment=None):
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / name), *map(str, arguments)],
            capture_output=True,
            text=True,
            check=check,
            env=environment or self.environment,
        )

    def test_read_returns_state_and_zero_counts(self):
        result = self.run_route("milestone-read.py", 7, "--repo", "owner/repo")
        value = json.loads(result.stdout)
        self.assertEqual(value["state"], "open")
        self.assertEqual(value["open_issues"], 0)
        self.assertEqual(value["closed_issues"], 0)
        self.assertEqual(value["description"], "before")

    def test_read_fails_loudly_on_gh_failure_and_missing_milestone(self):
        failed_environment = dict(self.environment, MILESTONE_STUB_FAIL="1")
        failed = self.run_route("milestone-read.py", 7, "--repo", "owner/repo", check=False, environment=failed_environment)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("stub gh failure", failed.stderr)
        missing = self.run_route("milestone-read.py", 404, "--repo", "owner/repo", check=False)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("not found", missing.stderr)

    def test_update_is_file_only_prints_prior_and_rejects_an_already_stale_read(self):
        expected = self.base / "expected.txt"
        description = self.base / "description.txt"
        expected.write_text("before\n")
        description.write_text("after $HOME `id`\n")
        result = self.run_route(
            "milestone-update.py", 7, "--repo", "owner/repo",
            "--expect-file", expected, "--description-file", description,
        )
        value = json.loads(result.stdout)
        self.assertEqual(value["previous_description"], "before")
        self.assertEqual(value["milestone"]["description"], "after $HOME `id`")
        expected.write_text("stale\n")
        refused = self.run_route(
            "milestone-update.py", 7, "--repo", "owner/repo",
            "--expect-file", expected, "--description-file", description, check=False,
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("already stale when read", refused.stderr)

    def test_update_is_check_then_write_and_cannot_reject_a_race_after_get(self):
        expected = self.base / "expected.txt"
        description = self.base / "description.txt"
        expected.write_text("before\n")
        description.write_text("reviewer-update\n")
        raced_environment = dict(self.environment, MILESTONE_STUB_RACE_AFTER_GET="concurrent-writer")
        result = self.run_route(
            "milestone-update.py", 7, "--repo", "owner/repo",
            "--expect-file", expected, "--description-file", description,
            environment=raced_environment,
        )
        value = json.loads(result.stdout)
        stored_state = json.loads(self.state.read_text())
        stored = stored_state["milestone"]["description"]
        self.assertEqual(value["previous_description"], "before")
        self.assertEqual(stored_state["race_observed"], "concurrent-writer")
        self.assertEqual(stored, "reviewer-update")
        self.assertNotEqual(stored, "concurrent-writer")

    def test_close_reads_then_closes_and_refuses_closed_state(self):
        result = self.run_route("milestone-close.py", 7, "--repo", "owner/repo")
        value = json.loads(result.stdout)
        self.assertEqual(value["previous_state"], "open")
        self.assertEqual(value["milestone"]["state"], "closed")
        refused = self.run_route("milestone-close.py", 7, "--repo", "owner/repo", check=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("refusing to close it again", refused.stderr)

    def test_create_is_file_only_fails_loudly_and_rejects_duplicate(self):
        description = self.base / "description.txt"
        description.write_text("order $HOME `id`\n")
        created = self.run_route(
            "milestone-create.py", "sprint-06", "--repo", "owner/repo", "--description-file", description,
        )
        self.assertEqual(json.loads(created.stdout)["milestone"]["description"], "order $HOME `id`")
        duplicate = self.run_route("milestone-create.py", "sprint-05", "--repo", "owner/repo", check=False)
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIn("already exists", duplicate.stderr)
        failed_environment = dict(self.environment, MILESTONE_STUB_FAIL="1")
        failed = self.run_route(
            "milestone-create.py", "sprint-06", "--repo", "owner/repo", check=False, environment=failed_environment,
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("stub gh failure", failed.stderr)

    def test_description_file_is_confined_to_the_work_tree_or_temp(self):
        """mhw #170 (Sonar S8707): the description is published, so the file it comes from is confined."""
        inside_tree = ROOT / "scripts" / "fixtures" / "worklog" / "scenario.json"
        temp_file = self.base / "description.txt"
        temp_file.write_text("ok\n")
        outside = Path("/").resolve()
        cases = [
            # (path, working directory, accepted?)
            (temp_file, self.base, True),
            (inside_tree, ROOT, True),
            (inside_tree, outside, False),  # the same file, from outside its work tree and outside temp
            (Path("/etc/hosts"), ROOT, False),
            (Path(os.path.expanduser("~/.ssh/config")), ROOT, False),
            (self.base / ".." / ".." / ".." / ".." / ".." / "etc" / "hosts", self.base, False),
        ]
        for path, cwd, accepted in cases:
            with self.subTest(path=str(path), cwd=str(cwd)):
                if self.log.exists():
                    self.log.unlink()
                result = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "milestone-create.py"), "sprint-09", "--repo", "owner/repo",
                     "--description-file", str(path)],
                    capture_output=True, text=True, check=False, env=self.environment, cwd=str(cwd))
                if accepted:
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("outside the repository work tree and the temporary directory", result.stderr)
                    self.assertNotIn("POST", self.log.read_text() if self.log.exists() else "")

    def test_confinement_is_by_path_component_and_follows_symlinks(self):
        """The lens on #170: a sibling whose name merely starts with an allowed root, and a symlink inside an
        allowed root that points out of it, are both refused."""
        if os.path.realpath(self.base).startswith(os.path.realpath("/tmp") + os.sep):
            self.skipTest("the test directory is under /tmp, an allowed root; set TMPDIR elsewhere for this case")
        root = self.base / "tmpx"
        sibling = self.base / "tmpxX"
        root.mkdir()
        sibling.mkdir()
        (root / "ok.txt").write_text("ok\n")
        (sibling / "evil.txt").write_text("evil\n")
        (root / "out.txt").symlink_to(Path("/etc/hosts"))
        environment = dict(self.environment, TMPDIR=str(root))
        cases = [(root / "ok.txt", True), (sibling / "evil.txt", False), (root / "out.txt", False)]
        for path, accepted in cases:
            with self.subTest(path=str(path)):
                if self.log.exists():
                    self.log.unlink()
                result = subprocess.run(
                    [sys.executable, str(ROOT / "scripts" / "milestone-create.py"), "sprint-10", "--repo", "owner/repo",
                     "--description-file", str(path)],
                    capture_output=True, text=True, check=False, env=environment, cwd=str(root))
                if accepted:
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("outside the repository work tree and the temporary directory", result.stderr)
                    self.assertNotIn("POST", self.log.read_text() if self.log.exists() else "")

    def test_repository_and_number_are_validated_before_gh(self):
        """mhw #170 (Sonar S8705): nothing shaped like a flag reaches the gh argv."""
        for repo in ("--jq", "-Xowner/repo", "owner", "owner/repo/extra", "owner/repo;id", "owner repo",
                     "../x", "./x", "owner/..", "owner/."):
            with self.subTest(repo=repo):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_route("milestone-read.py", 7, "--repo=" + repo, check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("<owner>/<repo>", result.stderr)
                self.assertFalse(self.log.exists(), "gh was called with an invalid repository")
        for number in (0, -1):
            with self.subTest(number=number):
                if self.log.exists():
                    self.log.unlink()
                result = self.run_route("milestone-read.py", number, "--repo", "owner/repo", check=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("positive integer", result.stderr)
                self.assertFalse(self.log.exists(), "gh was called with an invalid number")
        self.assertEqual(self.run_route("milestone-read.py", 7, "--repo", "owner/repo").returncode, 0)

    def test_route_surfaces_and_inline_description_absence(self):
        update = (ROOT / "scripts/milestone-update.py").read_text()
        create = (ROOT / "scripts/milestone-create.py").read_text()
        self.assertNotIn('add_argument("--description")', update)
        self.assertNotIn('add_argument("--description")', create)
        for route in ("milestone-create.py", "milestone-read.py", "milestone-update.py", "milestone-close.py"):
            self.assertTrue((ROOT / "scripts" / route).is_file())


if __name__ == "__main__":
    unittest.main()
