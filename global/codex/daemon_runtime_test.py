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
    def __init__(self, states, fd_count=20, soft=256, processes=1, command_codes=None,
                 unreachable=False, missing=(), lineage=True, identity_shift=False,
                 lifecycle_shift=False):
        self.states = list(states)
        self.unreachable = unreachable  # The sanitizer's exit 3: vendor failed with empty stdout.
        self.missing = set(missing)
        self.fd_count = fd_count
        self.soft = soft
        self.processes = processes
        self.command_codes = command_codes or {}
        self.calls = []
        self.call_options = []
        self.state = 0
        self.lineage = lineage
        self.identity_shift = identity_shift
        self.lifecycle_shift = lifecycle_shift
        self.sanitizer_reads = 0

    def resolve(self, name):
        return None if name in self.missing else "/fake/" + name

    def __call__(self, argv, **kwargs):
        key = tuple(argv[1:])
        self.calls.append(key)
        self.call_options.append(kwargs)
        code = self.command_codes.get(key, 0)
        if key == ("--version",):
            out = "codex-cli %s\n" % self.states[self.state]["binary"]
        elif (len(argv) == 3 and argv[1] == "-B" and argv[2].endswith("daemon_version_sanitizer.py")
              and self.unreachable):
            return subprocess.CompletedProcess(argv, 3, stdout="", stderr="")
        elif len(argv) == 3 and argv[1] == "-B" and argv[2].endswith("daemon_version_sanitizer.py"):
            doc = dict(self.states[self.state])
            doc.pop("binary", None)
            doc.pop("managedCodexPath", None)
            doc.pop("socketPath", None)
            running = doc["status"] == "running"
            shift = 1 if self.identity_shift and self.sanitizer_reads % 2 else 0
            if self.lifecycle_shift and self.sanitizer_reads % 2:
                doc["appServerVersion"] = "0.164.0"
            doc.update({
                "peerPid": 400 + shift if running else None,
                "peerPpid": 1 if running else None,
                "peerStartSec": 100 if running else None,
                "peerStartUsec": 10 if running else None,
                "sessionHostPid": 500 if running and self.lineage else None,
                "sessionHostStartSec": 110 if running and self.lineage else None,
                "sessionHostStartUsec": 11 if running and self.lineage else None,
                "executorPid": 600 if running and self.lineage else None,
                "executorStartSec": 120 if running and self.lineage else None,
                "executorStartUsec": 12 if running and self.lineage else None,
            })
            self.sanitizer_reads += 1
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
        elif argv[0].endswith("lsof"):
            out = "p%s\n" % argv[3] + "".join("f%du\nt%s\n" % (i, "PIPE" if i % 2 else "REG")
                                      for i in range(self.fd_count))
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

    def test_aligned_running_daemon_has_sanitized_role_metrics_without_headroom_claim(self):
        fake = Fake([state()], fd_count=20)
        snapshot = daemon.inspect(system="Darwin", resolver=fake.resolve, runner=fake)
        code, lines = daemon.result(snapshot)
        text = "\n".join(lines)
        self.assertEqual(code, 0, text)
        self.assertIn("per-role RLIMIT/headroom unavailable", text)
        self.assertIn("native socket peer pid 400", text)
        self.assertIn("session host pid 500", text)
        self.assertIn("executor child pid 600", text)
        self.assertNotIn("headroom 236", text)
        self.assertIn("PIPE 10, REG 10", text)
        self.assertNotIn("/private", text)
        self.assertNotIn("credential", text)
        self.assertNotIn(("app-server", "daemon", "version"), fake.calls)
        sanitizer_calls = [call for call in fake.calls if call and call[0] == "-B"]
        self.assertEqual(len(sanitizer_calls), 2)  # Initial identity plus post-metric revalidation.
        self.assertTrue(all(len(call) == 2 for call in sanitizer_calls))
        self.assertNotIn("/private", repr(vars(snapshot)))
        self.assertFalse(hasattr(snapshot, "socket_path"))
        lsof_calls = [call for call in fake.calls if call and call[0] == "-nP"]
        self.assertEqual(len(lsof_calls), 3)
        self.assertTrue(all(call[-1] == "-Fft" for call in lsof_calls))
        self.assertTrue(all("n" not in call[-1] for call in lsof_calls))

    def test_version_skew_is_drift(self):
        fake = Fake([state(managed="0.160.0", app="0.160.0")])
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("version skew", lines[0])

    def test_version_suffix_mismatch_is_drift(self):
        fake = Fake([state(cli="0.163.0-rc.1+vendor.2")])
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("version skew", lines[0])

    def test_identical_version_suffixes_are_aligned(self):
        version = "0.163.0-rc.1+vendor.2"
        fake = Fake([state(cli=version, managed=version, app=version)])
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[0].count(version), 4)

    def test_large_fd_total_is_reported_without_global_limit_substitution(self):
        fake = Fake([state()], fd_count=210)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0)
        self.assertIn("numeric FDs 210", lines[0])
        self.assertIn("headroom unavailable", lines[0])
        self.assertNotIn("headroom 46", lines[0])

    def test_role_identity_change_during_collection_is_drift(self):
        fake = Fake([state()], identity_shift=True)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("role identity changed during collection", lines[0])
        self.assertNotIn("--managed-daemon", lines[0])

    def test_lifecycle_projection_change_during_collection_is_drift(self):
        fake = Fake([state()], lifecycle_shift=True)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("lifecycle projection changed during collection", lines[0])

    def test_missing_session_lineage_refuses(self):
        fake = Fake([state()], lineage=False)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("session-host/executor lineage unavailable", lines[0])

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
        self.assertIn("daemon metadata unreadable", lines[0])
        self.assertIn("install will not change ambiguous role evidence", lines[0])


class Lifecycle(unittest.TestCase):
    def test_skew_uses_native_update_and_requires_aligned_postcondition(self):
        fake = Fake([state(managed="0.160.0", app="0.160.0"), state()])
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertIn(("app-server", "daemon", "update", "--from-cli", "--yes"), fake.calls)
        self.assertIn("native update completed", lines[0])

    # Issue #210 plus #200's accepted exception: an unavailable role limit never selects restart.
    def native_changes(self, fake):
        return [call for call in fake.calls
                if call[:2] == ("app-server", "daemon") and call[2:3] != ("version",)]

    def test_large_fd_total_without_role_limit_never_restarts(self):
        fake = Fake([state()], fd_count=317, soft=256)
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertEqual(self.native_changes(fake), [])
        self.assertIn("numeric FDs 317", lines[0])
        self.assertIn("RLIMIT/headroom unavailable", lines[0])
        self.assertNotIn("headroom -61", lines[0])

    def test_status_does_not_pass_or_fail_from_substitute_limit(self):
        fake = Fake([state()], fd_count=317, soft=1)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0)
        self.assertIn("headroom unavailable", lines[0])
        self.assertNotIn("headroom -", lines[0])

    def test_unreadable_role_metrics_refuse_without_native_change(self):
        fake = Fake([state()], missing=("lsof",))
        rcode, rlines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(rcode, 1)
        self.assertIn("descriptor tools unavailable", rlines[0])
        fake = Fake([state()], missing=("lsof",))
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1, lines)
        self.assertEqual(self.native_changes(fake), [])

    def test_launchctl_is_never_consulted_for_a_substitute_limit(self):
        fake = Fake([state()], fd_count=900, soft="unlimited")
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertIn("headroom unavailable", lines[0])
        self.assertFalse([call for call in fake.calls if call and call[0] == "limit"])

    def test_skew_with_low_headroom_still_updates_and_succeeds(self):
        fake = Fake([state(managed="0.160.0", app="0.160.0"), state()], fd_count=317, soft=256)
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertEqual(self.native_changes(fake),
                         [("app-server", "daemon", "update", "--from-cli", "--yes")])
        self.assertIn("native update completed", lines[0])
        self.assertIn("RLIMIT/headroom unavailable", lines[1])

    def test_missing_lineage_refuses_and_never_restarts(self):
        fake = Fake([state()], lineage=False)
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("nothing changed", lines[0])
        self.assertEqual(self.native_changes(fake), [])

    # Issue #210: a daemon that is not running is not an install failure, and is never started.
    def test_not_running_daemon_is_clean_and_untouched(self):
        fake = Fake([state()], unreachable=True, processes=0)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertIn("OK: daemon not running", lines[0])
        self.assertFalse([call for call in fake.calls if call[:2] == ("-nP", "-p")])
        fake = Fake([state()], unreachable=True, processes=0)
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 0, lines)
        self.assertEqual(self.native_changes(fake), [])

    def test_unreachable_control_with_a_live_process_is_not_called_stopped(self):
        fake = Fake([state()], unreachable=True, processes=1)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn(daemon.ALIVE_UNREACHABLE, lines[0])
        fake = Fake([state()], unreachable=True, processes=1)
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("nothing changed", lines[0])
        self.assertEqual(self.native_changes(fake), [])

    def test_unreachable_control_without_a_process_check_is_not_called_stopped(self):
        fake = Fake([state()], unreachable=True, missing=("pgrep",))
        code, lines = daemon.install(system="Darwin", resolver=fake.resolve, runner=fake)
        self.assertEqual(code, 1)
        self.assertIn("nothing changed", lines[0])
        fake = Fake([state()], unreachable=True)
        original = fake.__call__

        def broken(argv, **kwargs):
            if argv[0].endswith("pgrep"):
                return subprocess.CompletedProcess(argv, 2, stdout="", stderr="")
            return original(argv, **kwargs)
        code, lines = daemon.report(system="Darwin", resolver=fake.resolve, runner=broken)
        self.assertEqual(code, 1)
        self.assertIn("managed process unreadable", lines[0])

    def test_plan_names_an_action_only_when_install_would_act(self):
        cases = [
            (Fake([state()], fd_count=317), None),
            (Fake([state()], unreachable=True, processes=0), None),
            (Fake([state(managed="0.160.0", app="0.160.0")]), "update"),
            (Fake([state()], lineage=False), "refuse"),
            (Fake([state()], unreachable=True, processes=1), "refuse"),
        ]
        for fake, expected in cases:
            with self.subTest(expected=expected):
                action, _code, _lines = daemon.plan(system="Darwin", resolver=fake.resolve, runner=fake)
                self.assertEqual(action, expected)
                self.assertEqual(self.native_changes(fake), [])

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
    class LocalSocket:
        def __init__(self, pid=400, uid=None, groups=1):
            self.pid = pid
            self.uid = os.getuid() if uid is None else uid
            self.groups = groups

        def settimeout(self, _timeout):
            pass

        def connect(self, _path):
            pass

        def getsockopt(self, _level, option, _size):
            if option == sanitizer.LOCAL_PEERPID:
                import struct
                return struct.pack("@i", self.pid)
            import struct
            return struct.pack("@IIh", sanitizer.XUCRED_VERSION, self.uid, self.groups) + b"\0" * 64

        def close(self):
            pass

    def test_kernel_peer_requires_same_uid_positive_pid_and_start_identity(self):
        identity = lambda pid: {"pid": pid, "ppid": 1, "uid": os.getuid(),
                                "startSec": 100, "startUsec": 10,
                                "comm": b"codex", "name": b"codex"}
        found = sanitizer.peer_identity("/private/not-emitted",
                                        socket_factory=lambda *_: self.LocalSocket(),
                                        identity=identity)
        self.assertEqual(set(found), {"pid", "ppid", "uid", "startSec", "startUsec"})
        for sock in (self.LocalSocket(pid=0), self.LocalSocket(uid=os.getuid() + 1)):
            with self.subTest(pid=sock.pid, uid_matches=sock.uid == os.getuid()):
                self.assertIsNone(sanitizer.peer_identity(
                    "/private/not-emitted", socket_factory=lambda *_args, sock=sock: sock,
                    identity=identity))
        reads = []
        def reused(pid):
            reads.append(pid)
            value = identity(pid)
            return dict(value, startSec=100 + len(reads))
        self.assertIsNone(sanitizer.peer_identity(
            "/private/not-emitted", socket_factory=lambda *_: self.LocalSocket(), identity=reused))

    def test_lineage_refuses_zero_multiple_and_cycles(self):
        def roles(graph):
            return sanitizer.lineage_roles(identity=lambda pid: graph.get(pid), current_pid=30)

        base = {
            30: {"pid": 30, "ppid": 20, "uid": os.getuid(), "startSec": 3, "startUsec": 0,
                 "comm": b"python", "name": b"python"},
            20: {"pid": 20, "ppid": 1, "uid": os.getuid(), "startSec": 2, "startUsec": 0,
                 "comm": b"codex", "name": b"codex"},
            1: {"pid": 1, "ppid": 0, "uid": 0, "startSec": 1, "startUsec": 0,
                "comm": b"launchd", "name": b"launchd"},
        }
        self.assertEqual(roles(base)["sessionHostPid"], 20)
        no_host = {pid: dict(value, comm=b"python", name=b"python")
                   for pid, value in base.items()}
        self.assertIsNone(roles(no_host))
        multiple = dict(base)
        multiple[1] = dict(multiple[1], comm=b"codex", name=b"codex")
        self.assertIsNone(roles(multiple))
        foreign = dict(base)
        foreign[20] = dict(foreign[20], uid=os.getuid() + 1)
        self.assertIsNone(roles(foreign))
        cycle = dict(base)
        cycle[20] = dict(cycle[20], ppid=30)
        self.assertIsNone(roles(cycle))
        moving = dict(base)
        moving[30] = dict(moving[30], ppid=25)
        moving[25] = {"pid": 25, "ppid": 20, "uid": os.getuid(), "startSec": 25,
                      "startUsec": 0, "comm": b"python", "name": b"python"}
        reads = []
        def changed(pid):
            value = moving.get(pid)
            if pid == 25:
                reads.append(pid)
                return dict(value, startSec=value["startSec"] + (1 if len(reads) > 1 else 0))
            return value
        self.assertIsNone(sanitizer.lineage_roles(identity=changed, current_pid=30))

    def test_lineage_uses_exact_peer_among_two_codex_ancestors(self):
        uid = os.getuid()
        graph = {
            30: {"pid": 30, "ppid": 20, "uid": uid, "startSec": 3, "startUsec": 3,
                 "comm": b"python", "name": b"python"},
            20: {"pid": 20, "ppid": 10, "uid": uid, "startSec": 2, "startUsec": 2,
                 "comm": b"codex", "name": b"codex"},
            10: {"pid": 10, "ppid": 1, "uid": uid, "startSec": 1, "startUsec": 1,
                 "comm": b"codex", "name": b"codex"},
            1: {"pid": 1, "ppid": 0, "uid": 0, "startSec": 1, "startUsec": 0,
                "comm": b"launchd", "name": b"launchd"},
        }
        peer = {"pid": 20, "ppid": 10, "uid": uid, "startSec": 2, "startUsec": 2}
        roles = sanitizer.lineage_roles(peer=peer, identity=lambda pid: graph.get(pid),
                                        current_pid=30)
        self.assertEqual(roles["sessionHostPid"], peer["pid"])
        self.assertEqual(roles["sessionHostStartSec"], peer["startSec"])
        self.assertEqual(roles["sessionHostStartUsec"], peer["startUsec"])

    def test_lineage_refuses_peer_pid_with_mismatched_start(self):
        uid = os.getuid()
        graph = {
            30: {"pid": 30, "ppid": 20, "uid": uid, "startSec": 3, "startUsec": 0,
                 "comm": b"python", "name": b"python"},
            20: {"pid": 20, "ppid": 1, "uid": uid, "startSec": 2, "startUsec": 0,
                 "comm": b"codex", "name": b"codex"},
            1: {"pid": 1, "ppid": 0, "uid": 0, "startSec": 1, "startUsec": 0,
                "comm": b"launchd", "name": b"launchd"},
        }
        peer = {"pid": 20, "ppid": 1, "uid": uid, "startSec": 999, "startUsec": 0}
        self.assertIsNone(sanitizer.lineage_roles(
            peer=peer, identity=lambda pid: graph.get(pid), current_pid=30))

    def test_lineage_revalidates_stable_exact_peer_ancestry(self):
        uid = os.getuid()
        graph = {
            30: {"pid": 30, "ppid": 20, "uid": uid, "startSec": 3, "startUsec": 0,
                 "comm": b"python", "name": b"python"},
            20: {"pid": 20, "ppid": 1, "uid": uid, "startSec": 2, "startUsec": 0,
                 "comm": b"codex", "name": b"codex"},
            1: {"pid": 1, "ppid": 0, "uid": 0, "startSec": 1, "startUsec": 0,
                "comm": b"launchd", "name": b"launchd"},
        }
        reads = {pid: 0 for pid in graph}
        def stable(pid):
            reads[pid] += 1
            return graph.get(pid)
        peer = {"pid": 20, "ppid": 1, "uid": uid, "startSec": 2, "startUsec": 0}
        roles = sanitizer.lineage_roles(peer=peer, identity=stable, current_pid=30)
        self.assertEqual(roles["sessionHostPid"], 20)
        self.assertTrue(all(count >= 2 for count in reads.values()))

    def test_running_projection_exports_only_fixed_role_metadata(self):
        document = state()
        document.pop("binary")
        raw = json.dumps(document).encode()
        peer = {"pid": 400, "ppid": 1, "uid": os.getuid(), "startSec": 100, "startUsec": 10}
        roles = {"sessionHostPid": 500, "sessionHostStartSec": 110,
                 "sessionHostStartUsec": 11, "executorPid": 600,
                 "executorStartSec": 120, "executorStartUsec": 12}
        safe = sanitizer.project(raw, peer_lookup=lambda _path: peer,
                                 roles_lookup=lambda _peer: roles)
        self.assertEqual(set(safe), set(daemon._REQUIRED))
        self.assertNotIn("managedCodexPath", safe)
        self.assertNotIn("socketPath", safe)
        self.assertNotIn("SoftLimit", repr(safe))
        bad_roles = dict(roles, futurePrivatePath=1)
        self.assertIsNone(sanitizer.project(raw, peer_lookup=lambda _path: peer,
                                            roles_lookup=lambda _peer: bad_roles))
        bad_peer = dict(peer, pid=0)
        self.assertIsNone(sanitizer.project(raw, peer_lookup=lambda _path: bad_peer,
                                            roles_lookup=lambda _peer: roles))

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
        document = state(status="stopped")
        document.pop("binary")
        result = self.run_boundary(document)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        safe = json.loads(result.stdout)
        self.assertEqual(set(safe), set(daemon._REQUIRED))
        self.assertNotIn("/private", result.stdout + result.stderr)
        self.assertNotIn("managedCodexPath", result.stdout)
        self.assertNotIn("socketPath", result.stdout)

    def test_complete_version_suffix_crosses_the_boundary_unchanged(self):
        version = "0.163.0-rc.1+vendor.2"
        document = state(cli=version, managed=version, app=version, status="stopped")
        document.pop("binary")
        result = self.run_boundary(document)
        self.assertEqual(result.returncode, 0)
        safe = json.loads(result.stdout)
        for field in ("managedCodexVersion", "cliVersion", "appServerVersion"):
            self.assertEqual(safe[field], version)

    def failing_vendor(self, stdout):
        temp = tempfile.TemporaryDirectory(prefix="mhw-codex-sanitizer-")
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "codex"
        path.write_text("#!/bin/sh\nprintf '%s' '" + stdout + "'\n"
                        "printf '%s\\n' 'Error: failed to connect to /private/socket' >&2\nexit 1\n",
                        encoding="utf-8")
        path.chmod(0o700)
        env = dict(os.environ)
        env["PATH"] = str(path.parent) + os.pathsep + env.get("PATH", "")
        return subprocess.run([sys.executable, "-B", str(Path(sanitizer.__file__))],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              timeout=10, env=env)

    def test_vendor_failure_with_empty_stdout_is_the_unreachable_exit(self):
        # Measured on Codex CLI 0.163.0, macOS, daemon stopped: exit 1, 0 bytes of stdout.
        result = self.failing_vendor("")
        self.assertEqual(result.returncode, sanitizer.UNREACHABLE)
        self.assertEqual(result.returncode, daemon._UNREACHABLE)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_vendor_failure_with_output_is_not_the_unreachable_exit(self):
        result = self.failing_vendor("partial")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

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
