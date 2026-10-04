#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import restart_guard as guard


class RestartTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        self.root = self.home / "project"
        (self.root / ".git").mkdir(parents=True)
        self.data = self.home / "data"
        self.event = {"hook_event_name": "SessionStart", "source": "startup", "session_id": "synthetic", "cwd": str(self.root)}
        env = patch.dict("os.environ", {"CODEX_HOME": str(self.home / ".codex")})
        env.start()
        self.addCleanup(env.stop)

    def call(self, event=None, harness="claude-code"):
        return guard.decide(self.event if event is None else event, harness, self.home, self.data, self.root)

    def pre(self):
        return dict(self.event, hook_event_name="PreToolUse")

    def test_missing_baseline_blocks(self):
        self.assertFalse(self.call(self.pre()))

    def test_diagnostics_distinguish_absent_changed_and_invalid_state(self):
        def status():
            return guard.inspect(self.pre(), "claude-code", self.home, self.data, self.root)
        self.assertEqual(status(), "missing_baseline")
        self.assertFalse(self.data.exists())
        self.assertTrue(self.call())
        self.assertEqual(status(), "baseline_match")
        (self.root / "CLAUDE.md").write_text("synthetic change")
        self.assertEqual(status(), "fingerprint_mismatch")
        state = next((self.data / "restart-state").glob("*.json"))
        for malformed in ("[]", "null", "{}", '{"fingerprint": 12}', "not json"):
            state.write_text(malformed)
            self.assertEqual(status(), "invalid_baseline")
            self.assertFalse(self.call(self.pre()))

    def test_native_output_identifies_the_guard_and_reason(self):
        missing = guard.output(self.pre(), "missing_baseline")
        changed = guard.output(self.pre(), "fingerprint_mismatch")
        self.assertNotEqual(missing, changed)
        self.assertIn("missing_baseline", missing["hookSpecificOutput"]["permissionDecisionReason"])
        self.assertIn("fingerprint_mismatch", changed["hookSpecificOutput"]["permissionDecisionReason"])
        created = guard.output(self.event, "baseline_created")
        self.assertIn("baseline_created", created["systemMessage"])
        self.assertEqual(guard.output(self.pre(), "baseline_match"), {})

    def test_malformed_state_denies_instead_of_raising(self):
        self.assertTrue(self.call())
        state = next((self.data / "restart-state").glob("*.json"))
        for malformed in ("[]", "null", "not json"):
            state.write_text(malformed)
            self.assertFalse(self.call(self.pre()))
            self.assertEqual(state.read_text(), malformed)

    def test_diagnostics_do_not_replace_stale_or_missing_startup_state(self):
        self.assertEqual(guard.inspect(self.event, "claude-code", self.home, self.data, self.root), "missing_baseline")
        self.assertFalse(self.data.exists())
        self.assertTrue(self.call())
        state = next((self.data / "restart-state").glob("*.json"))
        before = (state.read_bytes(), state.stat().st_mtime_ns)
        (self.root / "CLAUDE.md").write_text("synthetic change")
        self.assertEqual(guard.inspect(self.event, "claude-code", self.home, self.data, self.root), "fingerprint_mismatch")
        self.assertEqual((state.read_bytes(), state.stat().st_mtime_ns), before)

    def test_diagnose_cli_never_creates_baseline_even_for_startup_payload(self):
        env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home),
                   XDG_DATA_HOME=str(self.home / "diagnostic-data"))
        result = subprocess.run(
            [sys.executable, "-B", str(Path(guard.__file__).resolve()),
             "--harness", "claude-code", "--diagnose"],
            input=json.dumps(self.event), text=True, capture_output=True,
            cwd=self.root, env=env, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {"status": "missing_baseline"})
        self.assertFalse((self.home / "diagnostic-data").exists())
        self.assertEqual(result.stderr, "")

    def test_event_cwd_cannot_select_a_filesystem_path(self):
        self.assertTrue(self.call(dict(self.event, cwd="/untrusted/event/path")))
        self.assertTrue(self.call(dict(self.pre(), cwd="/different/event/path")))

    def test_each_cli_detects_user_and_workspace_changes(self):
        for harness, (folder, names) in guard.NATIVE.items():
            with self.subTest(harness=harness):
                self.assertTrue(self.call(harness=harness))
                self.assertTrue(self.call(self.pre(), harness))
                path = self.home / folder / names[0]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic configuration")
                self.assertFalse(self.call(self.pre(), harness))
                fresh = dict(self.event, session_id="new-" + harness)
                self.assertTrue(self.call(fresh, harness))
                (self.root / "AGENTS.md").write_text(harness)
                self.assertFalse(self.call(dict(fresh, hook_event_name="PreToolUse"), harness))

    def test_resume_clear_and_compaction_do_not_rebaseline(self):
        self.assertTrue(self.call())
        (self.root / "CLAUDE.md").write_text("changed")
        for source in ("resume", "clear", "compact", "startup"):
            self.assertFalse(self.call(dict(self.event, source=source)))

    def test_configuration_contents_and_paths_are_not_persisted(self):
        (self.root / "CLAUDE.md").write_text("SYNTHETIC_PRIVATE_VALUE")
        self.assertTrue(self.call())
        for path in (self.data / "restart-state").iterdir():
            value = path.read_text()
            self.assertNotIn("SYNTHETIC_PRIVATE_VALUE", value)
            self.assertNotIn(str(self.root), value)
            self.assertEqual(set(json.loads(value)), {"fingerprint"})

    def test_symlink_state_and_invalid_events_block(self):
        self.assertFalse(self.call(dict(self.pre(), session_id=None)))
        self.data.mkdir()
        try:
            (self.data / "restart-state").symlink_to(self.root, target_is_directory=True)
        except OSError:
            self.skipTest("symlink unavailable")
        self.assertFalse(self.call())

    def test_output_blocks_tools_and_session_without_payload(self):
        self.assertEqual(guard.output(self.pre(), "missing_baseline")["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertFalse(guard.output(self.event, "missing_baseline")["continue"])
        self.assertEqual(guard.output(self.pre(), "baseline_match"), {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
