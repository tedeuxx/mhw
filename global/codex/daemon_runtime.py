#!/usr/bin/env python3
"""Sanitized health and install-boundary lifecycle for the native Codex daemon.

Only metadata that cannot reveal session contents is retained: version/status fields, a process id and
age, the inherited launchd soft descriptor limit, and aggregate descriptor counts by type. Raw daemon
version bytes are consumed only by a short-lived local sanitizer; this parent receives only its safe
projection. Neither process emits vendor path fields, process arguments, lsof names, stderr or
exception text.

The native daemon remains the only daemon.  Install uses only Codex's own ``daemon update --from-cli``
and ``daemon restart`` commands; it never creates a launch agent, socket or process of its own.
"""
from dataclasses import dataclass, field
import json
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
_AGE = re.compile(r"[0-9:-]+")
_FD = re.compile(r"f([0-9]+)[A-Za-z]*")
_TYPE = re.compile(r"t([A-Za-z0-9_]+)")
_REQUIRED = ("status", "backend", "managedCodexVersion", "cliVersion", "appServerVersion")
_SANITIZER = str(Path(__file__).with_name("daemon_version_sanitizer.py"))


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
    soft_limit: Optional[int] = None  # None means unavailable, -1 means unlimited.
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
        if self.fd_total is None or self.soft_limit is None:
            return None
        if self.soft_limit < 0:
            return -1
        return self.soft_limit - self.fd_total

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


def _managed_processes(pid_text, ps, runner):
    """Resolve safe PID/PPID/age fields. ``pgrep`` sees arguments; this process never captures them."""
    found = []
    pids = []
    for line in (pid_text or "").splitlines():
        value = line.strip()
        if not value.isdigit():
            return []
        pid = int(value)
        if pid not in pids:
            pids.append(pid)
    for pid in pids:
        details = _call(runner, [ps, "-p", str(pid), "-o", "pid=,ppid=,etime="])
        if details is None or details.returncode != 0:
            continue
        hit = re.fullmatch(r"\s*([0-9]+)\s+([0-9]+)\s+(\S+)\s*", details.stdout or "")
        if not hit or int(hit.group(1)) != pid:
            continue
        age = hit.group(3) if _AGE.fullmatch(hit.group(3)) else "unknown"
        found.append((pid, int(hit.group(2)), age))
    return found


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
    return len(by_fd), totals


def _soft_limit(text):
    hit = re.search(r"(?:^|\s)maxfiles\s+(\S+)", text or "")
    if not hit:
        return None
    value = hit.group(1).lower()
    if value == "unlimited":
        return -1
    return int(value) if value.isdigit() else None


def inspect(system=None, resolver=shutil.which, runner=subprocess.run):
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
    version = _call(runner, [sys.executable, "-B", _SANITIZER])
    if version is None or version.returncode != 0:
        snap.errors.append("daemon metadata unavailable")
        return snap
    try:
        doc = json.loads(version.stdout)
    except (TypeError, ValueError):
        snap.errors.append("daemon metadata unreadable")
        return snap
    if (not isinstance(doc, dict) or set(doc) != set(_REQUIRED) or
            any(not isinstance(doc.get(k), str) for k in _REQUIRED)):
        snap.errors.append("daemon metadata incomplete")
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

    ps = resolver("ps")
    pgrep = resolver("pgrep")
    lsof = resolver("lsof")
    launchctl = resolver("launchctl")
    if not ps or not pgrep or not lsof or not launchctl:
        snap.errors.append("descriptor tools unavailable")
        return snap
    processes = _call(runner, [pgrep, "-f", r"(^|/)codex app-server .*--managed-daemon"])
    if processes is None or processes.returncode not in (0, 1):
        snap.errors.append("managed process unreadable")
        return snap
    matches = _managed_processes(processes.stdout if processes.returncode == 0 else "", ps, runner)
    if not matches:
        snap.errors.append("managed process missing")
        return snap
    if len(matches) != 1:
        snap.errors.append("managed process ambiguous")
        return snap
    snap.pid, _ppid, snap.age = matches[0]

    files = _call(runner, [lsof, "-nP", "-p", str(snap.pid), "-Fft"])
    if files is None or files.returncode != 0:
        snap.errors.append("descriptor aggregate unavailable")
    else:
        snap.fd_total, snap.fd_types = _fd_totals(files.stdout)
        if snap.fd_total == 0:
            snap.errors.append("descriptor aggregate unreadable")
    limits = _call(runner, [launchctl, "limit", "maxfiles"])
    if limits is None or limits.returncode != 0:
        snap.errors.append("launchd limit unavailable")
    else:
        snap.soft_limit = _soft_limit(limits.stdout)
        if snap.soft_limit is None:
            snap.errors.append("launchd limit unreadable")
    return snap


def _versions(snap):
    return "CLI %s; metadata CLI %s; managed %s; app-server %s" % (
        snap.binary_version, snap.cli_version, snap.managed_version, snap.app_server_version)


def _descriptor_text(snap):
    if snap.fd_total is None or snap.soft_limit is None:
        return "descriptor headroom unavailable"
    limit = "unlimited" if snap.soft_limit < 0 else str(snap.soft_limit)
    headroom = "unlimited" if snap.headroom == -1 else str(snap.headroom)
    kinds = ", ".join("%s %d" % item for item in sorted(snap.fd_types.items())) or "none"
    return "numeric FDs %d/%s; headroom %s (required %d); types %s" % (
        snap.fd_total, limit, headroom, SAFE_HEADROOM, kinds)


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
        return 1, [prefix + "DRIFT: " + ", ".join(snap.errors) + "; run mhw install at a session boundary"]
    if snap.status != "running":
        return 0, [prefix + "OK: daemon %s (backend %s); %s; headroom not applicable" % (
            snap.status, snap.backend, _versions(snap))]
    if snap.headroom is None:
        return 1, [prefix + "DRIFT: descriptor headroom unavailable; run mhw install at a session boundary"]
    if snap.headroom != -1 and snap.headroom < SAFE_HEADROOM:
        return 1, [prefix + "DRIFT: unsafe descriptor headroom; " + _descriptor_text(snap) +
                   "; run mhw install at a session boundary"]
    return 0, [prefix + "OK: daemon running (backend %s, pid %d, age %s); %s; %s" % (
        snap.backend, snap.pid, snap.age, _versions(snap), _descriptor_text(snap))]


def report(system=None, resolver=shutil.which, runner=subprocess.run, prefix="CODEX   "):
    return result(inspect(system=system, resolver=resolver, runner=runner), prefix=prefix)


def install(system=None, resolver=shutil.which, runner=subprocess.run):
    """Align/restart through the supported native lifecycle, then require a healthy postcondition."""
    before = inspect(system=system, resolver=resolver, runner=runner)
    if not before.supported or not before.available:
        return result(before)
    codex = resolver("codex")
    repairable = {"managed process missing", "managed process ambiguous"}
    hard = [e for e in before.errors if e not in repairable]

    action = None
    if before.version_skew:
        action = "update"
        command = [codex, "app-server", "daemon", "update", "--from-cli", "--yes"]
    elif hard:
        return 1, ["REFUSE  Codex managed daemon: metadata or descriptor evidence is incomplete; nothing changed"]
    elif before.status == "running" and (before.headroom is None or
                                          (before.headroom != -1 and before.headroom < SAFE_HEADROOM) or
                                          before.errors):
        action = "restart"
        command = [codex, "app-server", "daemon", "restart"]
    else:
        return result(before)

    changed = _call(runner, command, timeout=60)
    if changed is None or changed.returncode != 0:
        return 1, ["REFUSE  Codex managed daemon: native %s failed; vendor output suppressed; "
                   "no other process was touched"
                   % action]
    after = inspect(system=system, resolver=resolver, runner=runner)
    code, lines = result(after)
    if code:
        return 1, ["REFUSE  Codex managed daemon: native %s did not produce the required sanitized postcondition"
                   % action]
    return 0, ["CHANGED Codex managed daemon: native %s completed; package versions aligned and descriptor headroom safe"
               % action] + lines
