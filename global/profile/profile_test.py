#!/usr/bin/env python3
"""Synthetic profile tests. No real harness configs, account state or secret stores.

    python3 -B global/profile/profile_test.py
"""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import profile as compiler


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="workstation-profile-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / "profile.json"
        self.output = self.base / "output"
        self.doc = json.loads((compiler.HERE / "profile.example.json").read_text(encoding="utf-8"))
        self.schema = json.loads((compiler.HERE / "profile.schema.json").read_text(encoding="utf-8"))
        self.save()

    def save(self):
        self.source.write_text(json.dumps(self.doc), encoding="utf-8")

    def cli(self, command, output=False):
        args = [sys.executable, "-B", str(compiler.HERE / "profile.py"), command,
                "--source", str(self.source)]
        if output:
            args += ["--output", str(self.output)]
        return subprocess.run(args, cwd=self.base, capture_output=True, text=True)

    def test_example_and_reference_profiles_validate(self):
        self.assertEqual(compiler.validate(self.doc, self.schema), [])
        reference = compiler.load_profile(compiler.ROOT / "overlay" / "profile.json")
        self.assertEqual(reference["session_start"]["priority"], "balanced")
        self.assertEqual(reference["conversation"]["decision_tone"], "executive-concise")

    def test_native_grants_are_rejected_without_echo(self):
        sentinel = "synthetic-private-input-do-not-echo"
        self.doc[sentinel] = {"allow": ["all"]}
        self.save()
        result = self.cli("render", output=True)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(sentinel, result.stdout + result.stderr)
        self.assertFalse(self.output.exists())

    def test_unknown_nested_field_and_invalid_choice_are_redacted(self):
        sentinel = "synthetic-private-value-do-not-echo"
        self.doc["conversation"]["language"] = sentinel
        self.doc["conversation"][sentinel] = sentinel
        self.save()
        result = self.cli("validate")
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(sentinel, result.stdout + result.stderr)
        self.assertIn("conversation.language", result.stderr)

    def test_malformed_duplicate_and_oversized_json_are_rejected(self):
        for data in ('{"private":"synthetic-input",', '{"version":1,"version":1}',
                     '{"version":NaN}', ' ' * (compiler.MAX_BYTES + 1), '[' * 2000):
            with self.subTest(length=len(data)):
                self.source.write_text(data, encoding="utf-8")
                result = self.cli("validate")
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("synthetic-input", result.stderr)

    def test_missing_fields_boolean_integer_and_bounds(self):
        mutations = [
            lambda d: d.pop("conversation"),
            lambda d: d.update(version=True),
            lambda d: d.update(version=2),
            lambda d: d["interaction"].update(max_question_chars=True),
            lambda d: d["interaction"].update(max_question_chars=-1),
            lambda d: d["interaction"].update(max_question_chars=10001),
            lambda d: d["interaction"].update(decision_options=4),
            lambda d: d["interaction"].update(decision_options=True),
            lambda d: d.update(desktop={"notifications":"all"}),
            lambda d: d.update(desktop={}),
            lambda d: d.update(surfaces=[]),
            lambda d: d.update(surfaces=["codex", "codex"]),
            lambda d: d.update(surfaces=[{}]),
        ]
        for mutate in mutations:
            candidate = copy.deepcopy(self.doc)
            mutate(candidate)
            self.assertTrue(compiler.validate(candidate, self.schema))

    def test_plan_is_read_only_and_does_not_claim_installation(self):
        before = set(self.base.iterdir())
        result = self.cli("plan")
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(set(self.base.iterdir()), before)
        self.assertEqual(len(report["surfaces"]), 4)
        self.assertTrue(all(row["runtime_verification"] == "not-performed" for row in report["surfaces"]))
        self.assertEqual(report["limits"]["financial_authorization"], "not-granted")
        self.assertIn("not-written", report["limits"]["native_model_and_effort"])

    def test_render_preserves_unrelated_files_and_is_idempotent(self):
        self.output.mkdir()
        unrelated = self.output / "keep.txt"
        unrelated.write_text("keep", encoding="utf-8")
        first = self.cli("render", output=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.iterdir()}
        second = self.cli("render", output=True)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("0 generated files updated", second.stdout)
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.output.iterdir()})
        self.assertEqual(self.cli("check", output=True).returncode, 0)

    def test_drift_is_observed_then_repaired(self):
        self.assertEqual(self.cli("render", output=True).returncode, 0)
        path = self.output / "AGENTS.md"
        path.write_text(path.read_text(encoding="utf-8") + "synthetic drift\n", encoding="utf-8")
        before = path.read_bytes()
        self.assertEqual(self.cli("check", output=True).returncode, 1)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.cli("render", output=True).returncode, 0)
        self.assertEqual(self.cli("check", output=True).returncode, 0)

    def test_missing_output_check_writes_nothing(self):
        result = self.cli("check", output=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.output.exists())

    def test_unmanaged_target_refuses_all_writes(self):
        self.output.mkdir()
        (self.output / "clipboard.conf").write_text("unmanaged", encoding="utf-8")
        result = self.cli("render", output=True)
        self.assertEqual(result.returncode, 3)
        self.assertEqual([p.name for p in self.output.iterdir()], ["clipboard.conf"])
        self.assertEqual((self.output / "clipboard.conf").read_text(), "unmanaged")

    def test_symlink_refuses_all_writes(self):
        self.output.mkdir()
        other = self.base / "other"
        other.write_text("untouched", encoding="utf-8")
        try:
            (self.output / "clipboard.conf").symlink_to(other)
        except OSError:
            self.skipTest("symlink creation unavailable on this host")
        self.assertEqual(self.cli("render", output=True).returncode, 3)
        self.assertEqual(other.read_text(), "untouched")
        self.assertFalse((self.output / "AGENTS.md").exists())

    def test_mentioning_marker_does_not_establish_ownership(self):
        self.output.mkdir()
        (self.output / "AGENTS.md").write_text("Notes about " + compiler.MANAGED, encoding="utf-8")
        self.assertEqual(self.cli("render", output=True).returncode, 3)
        self.assertFalse((self.output / "clipboard.conf").exists())

    def test_pt_profile_localizes_notices_and_keeps_floor(self):
        self.doc["conversation"].update(language="pt-BR", decision_tone="executive-concise")
        self.doc["interaction"]["max_question_chars"] = 280
        self.doc["session_start"]["priority"] = "balanced"
        compiled = compiler.compile_profile(self.doc)
        self.assertIn("notice_paste_redacted=", compiled["clipboard.conf"])
        self.assertNotIn("block_categories=", compiled["clipboard.conf"])
        self.assertIn("moderate latency", compiled["AGENTS.md"])
        self.assertIn("one question per message; a question stem is at most 280 characters; "
                      "the reasoning goes in a linked artifact, not in the message.", compiled["AGENTS.md"])
        floor = (compiler.ROOT / "global" / "AGENTS.md").read_text(encoding="utf-8").rstrip()
        self.assertIn(floor, compiled["desktop-instructions.md"])

    def test_all_supported_preferences_compile(self):
        cases = [("conversation", "language"), ("conversation", "publication_language"),
                 ("conversation", "decision_tone"), ("interaction", "command_preference"),
                 ("session_start", "priority")]
        for group, key in cases:
            choices = self.schema["properties"][group]["properties"][key]["enum"]
            for choice in choices:
                candidate = copy.deepcopy(self.doc)
                candidate[group][key] = choice
                self.assertEqual(compiler.validate(candidate, self.schema), [])
                self.assertIn("AGENTS.md", compiler.compile_profile(candidate))

    def test_pacing_is_opt_in_and_reference_owner_selects_it(self):
        generic = compiler.compile_profile(self.doc)
        self.assertNotIn("**Path decisions:**", generic["AGENTS.md"])
        self.assertNotIn("**Paced conversation:**", generic["AGENTS.md"])
        owner = compiler.load_profile(compiler.ROOT / "overlay" / "profile.json")
        compiled = compiler.compile_profile(owner)
        # Issue #60: the owner's decisions are instructions; no picker-guard configuration is generated.
        self.assertNotIn("hitl.conf", compiled)
        self.assertIn("one extreme, the opposite extreme, and the middle ground", compiled["AGENTS.md"])
        self.assertIn("talk to the owner in Brazilian Portuguese. Anything published is in English",
                      compiled["AGENTS.md"])
        self.assertIn("no hook checks it", compiler.plan(owner)["limits"]["decision_options"])
        self.assertIn("silence or elapsed time is not approval", compiled["AGENTS.md"])
        self.assertIn("risk and expected benefit", compiled["AGENTS.md"])
        self.assertIn("not a hard token or spending cap", compiled["AGENTS.md"])
        self.assertIn("Continue routine work already authorized", compiled["desktop-instructions.md"])
        self.assertIn("instruction-only", compiler.plan(owner)["limits"]["conversation_cadence"])
        self.assertIn("one point at a time", compiled["AGENTS.md"])
        self.assertIn("intent=essential", compiler.plan(owner)["limits"]["desktop_notifications"])

    def test_crlf_output_is_not_false_drift(self):
        compiled = compiler.compile_profile(self.doc)
        compiler.write_or_check(self.output, compiled, root=self.base)
        for name, content in compiled.items():
            (self.output / name).write_bytes(content.replace("\n", "\r\n").encode("utf-8"))
        self.assertEqual(compiler.write_or_check(self.output, compiled, check=True, root=self.base), [])

    def test_cli_cannot_read_or_write_outside_working_directory(self):
        self.source.write_text(json.dumps(self.doc), encoding="utf-8")
        for command, flags in (("validate", ["--source", str(compiler.HERE / "profile.example.json")]),
                               ("render", ["--source", str(self.source), "--output", str(self.base.parent / "escape")])):
            result = subprocess.run([sys.executable, "-B", str(compiler.HERE / "profile.py"), command, *flags],
                                    cwd=self.base, capture_output=True, text=True)
            self.assertEqual(result.returncode, 3)
            self.assertIn("escapes the working directory", result.stderr)

    def test_symlink_ancestor_cannot_escape_working_directory(self):
        link = self.base / "outside"
        try:
            link.symlink_to(self.base.parent, target_is_directory=True)
        except OSError:
            self.skipTest("symlink creation unavailable")
        with self.assertRaises(compiler.Refuse):
            compiler.write_or_check(link / "escape", compiler.compile_profile(self.doc), root=self.base)

    def test_output_is_required_only_for_mutating_or_check_commands(self):
        self.assertEqual(self.cli("render").returncode, 2)
        self.assertEqual(self.cli("validate", output=True).returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
