#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codex import daemon_runtime as daemon
from codex import daemon_version_sanitizer as sanitizer


class Fake:
    def __init__(self, states, fd_count=20, soft=256, processes=1, command_codes=None):
        self.states = list(states)
        self.fd_count = fd_count
        self.soft = soft
        self.processes = processes
        self.command_codes = command_codes or {}
        self.calls = []
        self.call_options = []
        self.state = 0

    def resolve(self, name):
        return "/fake/" + name

    def __call__(self, argv, **kwargs):
        key = tuple(argv[1:])
        self.calls.append(key)
        self.call_options.append(kwargs)
        code = self.command_codes.get(key, 0)
        if key == ("--version",):
            out = "codex-cli %s\n" % self.states[self.state]["binary"]
        elif len(argv) == 3 and argv[1] == "-B" and argv[2].endswith("daemon_version_sanitizer.py"):
            doc = dict(self.states[self.state])
            doc.pop("binary", None)
            doc.pop("managedCodexPath", None)
            doc.pop("socketPath", None)
            out = json.dumps(doc)
        elif key in (("app-server", "daemon", "update", "--from-cli", "--yes"),
                     ("app-server", "daemon", "restart")):
            if code == 0 and self.state + 1 < len(self.states):
                self.state += 1
            out = "/private/owner/path must never be relayed\n"
        elif argv[0].endswith("pgrep"):
            out = "".join("%d\n" % (400 + i) for i in range(self.processes))
            if not out:
                code = 1
        elif argv[0].endswith("ps"):
            out = "%s 1 00:12\n" % argv[2]
        elif argv[0].endswith("lsof"):
            out = "p400\n" + "".join("f%du\nt%s\n" % (i, "PIPE" if i % 2 else "REG")
                                      for i in range(self.fd_count))
        elif argv[0].endswith("launchctl"):
            out = "maxfiles %s unlimited\n" % self.soft
        else:
            out = ""
        return subprocess.CompletedProcess(argv, code, stdout=out,
                                           stderr="credential=/private/secret should stay suppressed")


def state(cli="0.163.0", managed="0.163.0", app="0.163.0", status="running", backend="pid"):
    return {"binary": cli, "status": status, "backend": backend,
            "managedCodexPath": "/private/owner/managed-codex",
            "managedCodexVersion": managed, "socketPath": "/private/owner/daemon.sock",
            "cliVersion": cli, "appServerVersion": app}


class Inspection(unittest.TestCase):
    def test_every_probe_discards_stderr_without_materializing_it(self):
        fake = Fake([state()])
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertTrue(fake.call_options)
        for options in fake.call_options:
            self.assertIs(options.get("stdout"), subprocess.PIPE)
            self.assertIs(options.get("stderr"), subprocess.DEVNULL)
            self.assertNotIn("capture_output", options)

    def test_aligned_running_daemon_has_sanitized_headroom(self):
        fake = Fake([state()], fd_count=20)
        snapshot = daemon.inspect(system="Darwin", resolver=fake.resolve, runner=fake)
        code, lines = daemon.result(snapshot)
        text = "\n".join(lines)
        self.assertEqual(code, 0, text)
        self.assertIn("headroom 236 (required 64)", text)
        self.assertIn("PIPE 10, REG 10", text)
        self.assertNotIn("/private", text)
        self.assertNotIn("credential", text)
        self.assertNotIn(("app-server", "daemon", "version"), fake.calls)
        sanitizer_calls = [call for call in fake.calls if call and call[0] == "-B"]
        self.assertEqual(len(sanitizer_calls), 1)
        self.assertEqual(len(sanitizer_calls[0]), 2)  # -B and the fixed sanitizer path; no vendor path.
        self.assertNotIn("/private", repr(vars(snapshot)))
        self.assertFalse(hasattr(snapshot, "socket_path"))

    def test_version_skew_is_drift(self):
        fake = Fake([state(managed="0.160.0", app="0.160.0")])
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("version skew", lines[0])

    def test_unsafe_headroom_is_drift(self):
        fake = Fake([state()], fd_count=210)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("unsafe descriptor headroom", lines[0])
        self.assertIn("headroom 46", lines[0])

    def test_lifecycle_carrier_drift_is_named_without_arguments(self):
        fake = Fake([state()], processes=2)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("managed process ambiguous", lines[0])
        self.assertNotIn("--managed-daemon", lines[0])

    def test_invalid_pid_output_is_not_a_lifecycle_carrier(self):
        fake = Fake([state()])
        original = fake.__call__

        def unrelated(argv, **kwargs):
            if argv[0].endswith("pgrep"):
                text = "/private/value-that-is-not-a-pid\n"
                return subprocess.CompletedProcess(argv, 0, stdout=text, stderr="")
            return original(argv, **kwargs)

        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=unrelated)
        self.assertEqual(code, 1)
        self.assertIn("managed process missing", lines[0])

    def test_stopped_daemon_needs_no_descriptor_read(self):
        fake = Fake([state(status="stopped")])
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertIn("headroom not applicable", lines[0])
        self.assertFalse([call for call in fake.calls if call and call[0] == "-f"])

    def test_missing_cli_and_other_os_are_clean_skips(self):
        code, lines = daemon.report(system="Linux", resolver=lambda _name: None)
        self.assertEqual(code, 0)
        self.assertIn("not applicable", lines[0])
        code, lines = daemon.report(system="Darwin", resolver=lambda _name: None)
        self.assertEqual(code, 0)
        self.assertIn("not on PATH", lines[0])

    def test_malformed_vendor_output_never_echoes_it(self):
        class Malformed(Fake):
            def __call__(self, argv, **kwargs):
                if len(argv) == 3 and argv[1] == "-B" and argv[2].endswith("daemon_version_sanitizer.py"):
                    return subprocess.CompletedProcess(argv, 0, stdout="/private/owner prompt text", stderr="token=x")
                return super().__call__(argv, **kwargs)
        fake = Malformed([state()])
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertEqual(lines, ["CODEX   DRIFT: daemon metadata unreadable; run mhw install at a session boundary"])


class Lifecycle(unittest.TestCase):
    def test_skew_uses_native_update_and_requires_aligned_postcondition(self):
        fake = Fake([state(managed="0.160.0", app="0.160.0"), state()])
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertIn(("app-server", "daemon", "update", "--from-cli", "--yes"), fake.calls)
        self.assertIn("native update completed", lines[0])

    def test_low_headroom_uses_native_restart(self):
        fake = Fake([state(), state()], fd_count=210)
        original = fake.__call__
        def moving(argv, **kwargs):
            result = original(argv, **kwargs)
            if tuple(argv[1:]) == ("app-server", "daemon", "restart") and result.returncode == 0:
                fake.fd_count = 20
            return result
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=moving)
        self.assertEqual(code, 0, lines)
        self.assertIn(("app-server", "daemon", "restart"), fake.calls)

    def test_native_failure_suppresses_vendor_output(self):
        command = ("app-server", "daemon", "update", "--from-cli", "--yes")
        fake = Fake([state(managed="0.160.0", app="0.160.0")], command_codes={command: 7})
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("vendor output suppressed", lines[0])
        self.assertNotIn("/private", "\n".join(lines))

    def test_update_that_does_not_align_fails_closed(self):
        fake = Fake([state(managed="0.160.0", app="0.160.0"),
                     state(managed="0.160.0", app="0.160.0")])
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("did not produce", lines[0])

    def test_unreadable_metadata_never_triggers_a_native_change(self):
        class Malformed(Fake):
            def __call__(self, argv, **kwargs):
                if len(argv) == 3 and argv[1] == "-B" and argv[2].endswith("daemon_version_sanitizer.py"):
                    return subprocess.CompletedProcess(argv, 0, stdout="not json", stderr="private")
                return super().__call__(argv, **kwargs)

        fake = Malformed([state()])
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("nothing changed", lines[0])
        self.assertFalse([call for call in fake.calls if "update" in call or "restart" in call])


class SanitizerBoundary(unittest.TestCase):
    def vendor(self, document):
        temp = tempfile.TemporaryDirectory(prefix="mhw-codex-sanitizer-")
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "codex"
        payload = json.dumps(document)
        path.write_text("#!/bin/sh\nprintf '%s\\n' '" + payload.replace("'", "'\\''") + "'\n"
                        "printf '%s\\n' 'private vendor error' >&2\n", encoding="utf-8")
        path.chmod(0o700)
        return path

    def run_boundary(self, document):
        vendor = self.vendor(document)
        env = dict(os.environ)
        env["PATH"] = str(vendor.parent) + os.pathsep + env.get("PATH", "")
        return subprocess.run([sys.executable, "-B", str(Path(sanitizer.__file__))],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              timeout=10, env=env)

    def test_external_executable_argument_is_refused_silently(self):
        document = state()
        document.pop("binary")
        vendor = self.vendor(document)
        env = dict(os.environ)
        env["PATH"] = str(vendor.parent) + os.pathsep + env.get("PATH", "")
        result = subprocess.run([sys.executable, "-B", str(Path(sanitizer.__file__)), str(vendor)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                timeout=10, env=env)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_raw_sensitive_fields_never_cross_the_child_boundary(self):
        document = state()
        document.pop("binary")
        result = self.run_boundary(document)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        safe = json.loads(result.stdout)
        self.assertEqual(set(safe), set(daemon._REQUIRED))
        self.assertNotIn("/private", result.stdout + result.stderr)
        self.assertNotIn("managedCodexPath", result.stdout)
        self.assertNotIn("socketPath", result.stdout)

    def test_schema_type_and_extra_field_drift_fail_without_output(self):
        valid = state()
        valid.pop("binary")
        cases = []
        missing = dict(valid)
        missing.pop("socketPath")
        cases.append(missing)
        wrong_type = dict(valid)
        wrong_type["managedCodexPath"] = ["private"]
        cases.append(wrong_type)
        extra = dict(valid)
        extra["futurePrivatePath"] = "/private/future"
        cases.append(extra)
        sensitive_safe_value = dict(valid)
        sensitive_safe_value["status"] = "/private/escape"
        cases.append(sensitive_safe_value)
        for document in cases:
            with self.subTest(keys=sorted(document)):
                result = self.run_boundary(document)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
