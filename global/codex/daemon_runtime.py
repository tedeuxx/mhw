#!/usr/bin/env python3
"""Sanitized health and install-boundary lifecycle for the native Codex daemon.

Only metadata that cannot reveal session contents is retained: version/status fields, kernel-backed
role identities and ages, and aggregate descriptor counts by type. Raw daemon
version bytes are consumed only by a short-lived local sanitizer; this parent receives only its safe
projection. Neither process emits vendor path fields, process arguments, lsof names, stderr or
exception text.

The native daemon remains the only daemon.  Install uses only Codex's own ``daemon update --from-cli``
and ``daemon restart`` commands; it never creates a launch agent, socket or process of its own, and it
never starts a daemon that is not running.

Since Issue #210 two states no longer fail ``mhw install``: a daemon that is not running, and low or
unreadable descriptor headroom. The first is not a fault. Per-role ``RLIMIT_NOFILE`` is not available
through an unprivileged public macOS interface, so this module reports live headroom as unavailable and
never substitutes launchd's global default or another process's limit. Install neither restarts for it
nor changes any limit. The descriptor exhaustion itself is Issue #200's.
"""
from dataclasses import dataclass, field
import json
import time
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from typing import Dict, List, Optional


SAFE_HEADROOM = 64
_VERSION = re.compile(
    r"(?<![0-9A-Za-z.+-])"
    r"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)"
    r"(?![0-9A-Za-z.+-])"
)
_FD = re.compile(r"f([0-9]+)[A-Za-z]*")
_TYPE = re.compile(r"t([A-Za-z0-9_]+)")
_VERSION_FIELDS = ("status", "backend", "managedCodexVersion", "cliVersion", "appServerVersion")
_IDENTITY_FIELDS = (
    "peerPid", "peerPpid", "peerStartSec", "peerStartUsec",
    "sessionHostPid", "sessionHostStartSec", "sessionHostStartUsec",
    "executorPid", "executorStartSec", "executorStartUsec",
)
_REQUIRED = _VERSION_FIELDS + _IDENTITY_FIELDS
_SANITIZER = str(Path(__file__).with_name("daemon_version_sanitizer.py"))
_UNREACHABLE = 3  # The sanitizer's exit when the vendor command failed with empty stdout.
NOT_RUNNING = "not running"
ALIVE_UNREACHABLE = "daemon control unreachable while a managed process runs"
_HEADROOM_UNAVAILABLE = "per-role RLIMIT/headroom unavailable on macOS without root; no global or substitute limit used"


@dataclass
class Role:
    name: str
    pid: int
    start_sec: int
    start_usec: int
    age_seconds: Optional[int] = None
    fd_total: Optional[int] = None
    fd_frontier: Optional[int] = None
    fd_types: Dict[str, int] = field(default_factory=dict)

    @property
    def identity(self):
        return self.pid, self.start_sec, self.start_usec


@dataclass
class Snapshot:
    supported: bool = True
    available: bool = True
    status: str = "unknown"
    backend: str = "unknown"
    binary_version: str = "unknown"
    cli_version: str = "unknown"
    managed_version: str = "unknown"
    app_server_version: str = "unknown"
    pid: Optional[int] = None
    age: str = "unknown"
    fd_total: Optional[int] = None
    fd_types: Dict[str, int] = field(default_factory=dict)
    peer: Optional[Role] = None
    session_host: Optional[Role] = None
    executor: Optional[Role] = None
    errors: List[str] = field(default_factory=list)

    @property
    def aligned(self):
        values = (self.binary_version, self.cli_version, self.managed_version,
                  self.app_server_version)
        return "unknown" not in values and len(set(values)) == 1

    @property
    def version_skew(self):
        values = (self.binary_version, self.cli_version, self.managed_version,
                  self.app_server_version)
        return "unknown" not in values and len(set(values)) > 1

    @property
    def headroom(self):
        return None

def _call(runner, argv, timeout=10):
    """A command result or None. Raw failures are deliberately discarded, never surfaced."""
    try:
        return runner(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                      text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None


def _version(text):
    hit = _VERSION.search(text or "")
    return hit.group(1) if hit else "unknown"


def _fd_totals(text):
    """Count numeric descriptors and their lsof ``-F t`` types; names are never requested."""
    by_fd = {}
    current = None
    for line in (text or "").splitlines():
        f = _FD.fullmatch(line)
        if f:
            current = int(f.group(1))
            by_fd.setdefault(current, "OTHER")
            continue
        t = _TYPE.fullmatch(line)
        if current is not None and t:
            by_fd[current] = t.group(1).upper()
    totals = {}
    for kind in by_fd.values():
        totals[kind] = totals.get(kind, 0) + 1
    frontier = max(by_fd) + 1 if by_fd else 0
    return len(by_fd), frontier, totals


_MANAGED = r"(^|/)codex app-server .*--managed-daemon"


def _unreachable(snap, resolver, runner):
    """The vendor command failed with no output. Not running only if no managed process exists either.

    Two independent signals must agree: the control command could not reach a daemon, and ``pgrep``
    finds no managed-daemon process (exit 1, its documented no-match code). A live process behind an
    unreachable control socket is the inconsistent lifecycle Issue #200 recorded, and stays an error.
    """
    pgrep = resolver("pgrep")
    if not pgrep:
        snap.errors.append("process tools unavailable")
        return snap
    processes = _call(runner, [pgrep, "-f", _MANAGED])
    if processes is None or processes.returncode not in (0, 1):
        snap.errors.append("managed process unreadable")
    elif processes.returncode == 1:
        snap.status = NOT_RUNNING
    else:
        snap.errors.append(ALIVE_UNREACHABLE)
    return snap


def _projection(runner):
    version = _call(runner, [sys.executable, "-B", _SANITIZER])
    if version is None:
        return None, "daemon metadata unavailable"
    if version.returncode == _UNREACHABLE:
        return _UNREACHABLE, None
    if version.returncode != 0:
        return None, "daemon metadata unavailable"
    try:
        doc = json.loads(version.stdout)
    except (TypeError, ValueError):
        return None, "daemon metadata unreadable"
    if not isinstance(doc, dict) or set(doc) != set(_REQUIRED):
        return None, "daemon metadata incomplete"
    if any(not isinstance(doc.get(field), str) for field in _VERSION_FIELDS):
        return None, "daemon metadata incomplete"
    for field in _IDENTITY_FIELDS:
        value = doc.get(field)
        if value is not None:
            if not isinstance(value, int) or isinstance(value, bool):
                return None, "daemon metadata incomplete"
            minimum = 0 if field.endswith("Ppid") or field.endswith("Usec") else 1
            if value < minimum:
                return None, "daemon metadata incomplete"
    return doc, None


def _role(doc, name, pid_field, start_prefix):
    values = (doc[pid_field], doc[start_prefix + "StartSec"], doc[start_prefix + "StartUsec"])
    if all(value is None for value in values):
        return None
    if any(value is None for value in values):
        return None
    return Role(name, *values)


def _collect_role(role, lsof, runner, now):
    files = _call(runner, [lsof, "-nP", "-p", str(role.pid), "-Fft"])
    if files is None or files.returncode != 0:
        return "descriptor aggregate unavailable for %s" % role.name
    role.fd_total, role.fd_frontier, role.fd_types = _fd_totals(files.stdout)
    if role.fd_total == 0:
        return "descriptor aggregate unreadable for %s" % role.name
    role.age_seconds = max(0, int(now) - role.start_sec)
    return None


def inspect(system=None, resolver=shutil.which, runner=subprocess.run, clock=time.time):
    """Inspect the daemon; raw version JSON is confined to the local sanitizer child."""
    snap = Snapshot()
    if (system or platform.system()) != "Darwin":
        snap.supported = False
        return snap
    codex = resolver("codex")
    if not codex:
        snap.available = False
        return snap

    cli = _call(runner, [codex, "--version"])
    if cli is None or cli.returncode != 0:
        snap.errors.append("CLI version unavailable")
    else:
        snap.binary_version = _version(cli.stdout)
        if snap.binary_version == "unknown":
            snap.errors.append("CLI version unreadable")

    # The child is the privacy boundary: raw vendor JSON exists only there. This parent captures only
    # its exact safe projection, or no output on schema/type/vendor drift.
    doc, error = _projection(runner)
    if doc == _UNREACHABLE:
        return _unreachable(snap, resolver, runner)
    if error:
        snap.errors.append(error)
        return snap
    snap.status = doc["status"]
    snap.backend = doc["backend"]
    snap.cli_version = _version(doc["cliVersion"])
    snap.managed_version = _version(doc["managedCodexVersion"])
    snap.app_server_version = _version(doc["appServerVersion"])
    if "unknown" in (snap.cli_version, snap.managed_version, snap.app_server_version):
        snap.errors.append("daemon version unreadable")
    if snap.status != "running":
        return snap
    if snap.backend != "pid":
        snap.errors.append("unsupported daemon backend")
        return snap
    snap.peer = _role(doc, "native socket peer", "peerPid", "peer")
    snap.session_host = _role(doc, "session host", "sessionHostPid", "sessionHost")
    snap.executor = _role(doc, "executor child", "executorPid", "executor")
    if not snap.peer:
        snap.errors.append("native socket peer unavailable")
    if not snap.session_host or not snap.executor:
        snap.errors.append("session-host/executor lineage unavailable")
    if snap.errors:
        return snap
    snap.pid = snap.peer.pid
    lsof = resolver("lsof")
    if not lsof:
        snap.errors.append("descriptor tools unavailable")
        return snap
    unique = {}
    for role in (snap.peer, snap.session_host, snap.executor):
        unique.setdefault(role.identity, role)
    now = clock()
    for role in unique.values():
        failure = _collect_role(role, lsof, runner, now)
        if failure:
            snap.errors.append(failure)
    # Equal roles share the same measured aggregate, but equality is an observation, never an
    # assumption. Copy only after identities matched exactly.
    for role in (snap.peer, snap.session_host, snap.executor):
        measured = unique[role.identity]
        role.age_seconds = measured.age_seconds
        role.fd_total = measured.fd_total
        role.fd_frontier = measured.fd_frontier
        role.fd_types = dict(measured.fd_types)
    after, after_error = _projection(runner)
    if after_error or after == _UNREACHABLE:
        snap.errors.append("role identity revalidation unavailable")
        return snap
    before_identity = tuple(doc[field] for field in _IDENTITY_FIELDS)
    after_identity = tuple(after[field] for field in _IDENTITY_FIELDS)
    before_lifecycle = tuple(doc[field] for field in _VERSION_FIELDS)
    after_lifecycle = tuple(after[field] for field in _VERSION_FIELDS)
    if before_identity != after_identity:
        snap.errors.append("role identity changed during collection")
    if before_lifecycle != after_lifecycle:
        snap.errors.append("lifecycle projection changed during collection")
    snap.fd_total, snap.fd_types = snap.peer.fd_total, dict(snap.peer.fd_types)
    snap.age = "%ds" % snap.peer.age_seconds if snap.peer.age_seconds is not None else "unknown"
    return snap


def _versions(snap):
    return "CLI %s; metadata CLI %s; managed %s; app-server %s" % (
        snap.binary_version, snap.cli_version, snap.managed_version, snap.app_server_version)


def _role_text(role):
    kinds = ", ".join("%s %d" % item for item in sorted(role.fd_types.items())) or "none"
    return "%s pid %d age %ss: numeric FDs %d; allocation frontier %d; types %s" % (
        role.name, role.pid, role.age_seconds, role.fd_total, role.fd_frontier, kinds)


def result(snap, prefix="CODEX   "):
    """Return ``(exit, lines)``. Every string is composed from whitelisted/synthetic metadata."""
    if not snap.supported:
        return 0, [prefix + "daemon lifecycle: not applicable on this OS (macOS only)"]
    if not snap.available:
        return 0, [prefix + "daemon lifecycle: Codex is not on PATH"]
    if snap.version_skew:
        return 1, [prefix + "DRIFT: version skew; " + _versions(snap) +
                   "; run mhw install at a session boundary"]
    if snap.errors:
        return 1, [prefix + "DRIFT: " + ", ".join(snap.errors) +
                   "; retry from one normal Codex session; install will not change ambiguous role evidence"]
    if snap.status == NOT_RUNNING:
        return 0, [prefix + "OK: daemon not running (no managed process, control unreachable); CLI %s; "
                   "headroom not applicable" % snap.binary_version]
    if snap.status != "running":
        return 0, [prefix + "OK: daemon %s (backend %s); %s; headroom not applicable" % (
            snap.status, snap.backend, _versions(snap))]
    equal = []
    if snap.peer.identity == snap.session_host.identity:
        equal.append("peer=session host")
    if snap.peer.identity == snap.executor.identity:
        equal.append("peer=executor")
    if snap.session_host.identity == snap.executor.identity:
        equal.append("session host=executor")
    relation = "; measured equality " + ", ".join(equal) if equal else "; roles distinct"
    roles = "; ".join(_role_text(role) for role in
                      (snap.peer, snap.session_host, snap.executor))
    return 0, [prefix + "OK: daemon running (backend %s); %s%s; %s; %s" % (
        snap.backend, _versions(snap), relation, roles, _HEADROOM_UNAVAILABLE)]


def report(system=None, resolver=shutil.which, runner=subprocess.run, prefix="CODEX   "):
    return result(inspect(system=system, resolver=resolver, runner=runner), prefix=prefix)


def _action(snap):
    """What install would do: update version skew, refuse ambiguity, or leave state unchanged."""
    if not snap.supported or not snap.available:
        return None
    if snap.version_skew:
        return "update"
    if snap.errors:
        return "refuse"
    return None


def plan(system=None, resolver=shutil.which, runner=subprocess.run, prefix="CODEX   "):
    """Return ``(action, exit, lines)`` from one read-only inspection, for the install preview."""
    snap = inspect(system=system, resolver=resolver, runner=runner)
    code, lines = result(snap, prefix=prefix)
    return _action(snap), code, lines


def install(system=None, resolver=shutil.which, runner=subprocess.run):
    """Align through the supported native lifecycle only on version skew.

    A stopped daemon is left alone. Role ambiguity and unstable identity refuse rather than selecting
    restart, and unavailable headroom never selects an action (#200, #210).
    """
    before = inspect(system=system, resolver=resolver, runner=runner)
    action = _action(before)
    if action is None:
        # Clean, not applicable or not running: no native lifecycle action.
        return 0, result(before)[1]
    if action == "refuse":
        return 1, ["REFUSE  Codex managed daemon: metadata evidence is incomplete; nothing changed"]
    codex = resolver("codex")
    if action == "update":
        command = [codex, "app-server", "daemon", "update", "--from-cli", "--yes"]
    else:  # Defensive: _action currently has no restart-producing state.
        command = [codex, "app-server", "daemon", "restart"]

    changed = _call(runner, command, timeout=60)
    if changed is None or changed.returncode != 0:
        return 1, ["REFUSE  Codex managed daemon: native %s failed; vendor output suppressed; "
                   "no other process was touched"
                   % action]
    after = inspect(system=system, resolver=resolver, runner=runner)
    if _action(after) is not None:
        return 1, ["REFUSE  Codex managed daemon: native %s did not produce the required sanitized postcondition"
                   % action]
    return 0, ["CHANGED Codex managed daemon: native %s completed; package versions aligned and roles "
               "resolved" % action] + result(after)[1]
