#!/usr/bin/env python3
"""Local privacy boundary for ``codex app-server daemon version``.

Raw vendor bytes exist only in this short-lived process. The parent receives either an exact safe
projection or no output and a non-zero exit. This helper deliberately writes no diagnostics.

Exit ``UNREACHABLE`` (3) means only that the vendor command exited non-zero and wrote nothing to stdout,
which is what Codex CLI 0.163.0 does on macOS when no managed daemon is running (measured 2026-10-18:
exit 1, 0 bytes of stdout). The vendor's stderr is still never read. The parent decides between "not
running" and "alive but unreachable" with its own process check; this bit alone decides nothing.
"""
import json
import ctypes
import re
import os
import shutil
import socket
import struct
import subprocess
import sys


VENDOR_FIELDS = frozenset(("status", "backend", "managedCodexPath", "managedCodexVersion",
                           "socketPath", "cliVersion", "appServerVersion"))
UNREACHABLE = 3
SAFE_FIELDS = ("status", "backend", "managedCodexVersion", "cliVersion", "appServerVersion")
VERSION = re.compile(
    r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?"
)
SOL_LOCAL = 0
LOCAL_PEERCRED = 0x001
LOCAL_PEERPID = 0x002
XUCRED_VERSION = 0
PROC_PIDTBSDINFO = 3


class ProcBsdInfo(ctypes.Structure):
    """Darwin's public ``struct proc_bsdinfo``; names never leave this process."""

    _fields_ = [
        ("pbi_flags", ctypes.c_uint32), ("pbi_status", ctypes.c_uint32),
        ("pbi_xstatus", ctypes.c_uint32), ("pbi_pid", ctypes.c_uint32),
        ("pbi_ppid", ctypes.c_uint32), ("pbi_uid", ctypes.c_uint32),
        ("pbi_gid", ctypes.c_uint32), ("pbi_ruid", ctypes.c_uint32),
        ("pbi_rgid", ctypes.c_uint32), ("pbi_svuid", ctypes.c_uint32),
        ("pbi_svgid", ctypes.c_uint32), ("rfu_1", ctypes.c_uint32),
        ("pbi_comm", ctypes.c_char * 16), ("pbi_name", ctypes.c_char * 32),
        ("pbi_nfiles", ctypes.c_uint32), ("pbi_pgid", ctypes.c_uint32),
        ("pbi_pjobc", ctypes.c_uint32), ("e_tdev", ctypes.c_uint32),
        ("e_tpgid", ctypes.c_uint32), ("pbi_nice", ctypes.c_int32),
        ("pbi_start_tvsec", ctypes.c_uint64), ("pbi_start_tvusec", ctypes.c_uint64),
    ]


def process_identity(pid, library=None):
    """Return kernel PID/PPID/UID/start identity plus private names, or ``None``.

    The caller may use the names for a local role predicate. They are never serialized.
    """
    try:
        lib = library or ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                     ctypes.c_void_p, ctypes.c_int]
        lib.proc_pidinfo.restype = ctypes.c_int
        info = ProcBsdInfo()
        size = ctypes.sizeof(info)
        got = lib.proc_pidinfo(int(pid), PROC_PIDTBSDINFO, 0, ctypes.byref(info), size)
        if got != size or info.pbi_pid != int(pid) or not info.pbi_start_tvsec:
            return None
        return {
            "pid": int(info.pbi_pid), "ppid": int(info.pbi_ppid), "uid": int(info.pbi_uid),
            "startSec": int(info.pbi_start_tvsec), "startUsec": int(info.pbi_start_tvusec),
            "comm": bytes(info.pbi_comm).split(b"\0", 1)[0],
            "name": bytes(info.pbi_name).split(b"\0", 1)[0],
        }
    except (AttributeError, OSError, TypeError, ValueError):
        return None


def peer_identity(path, socket_factory=socket.socket, identity=process_identity, uid=None):
    """Authenticate the exact AF_UNIX peer and bind its PID to kernel start identity."""
    if not isinstance(path, str) or not path or "\0" in path:
        return None
    peer = None
    try:
        peer = socket_factory(socket.AF_UNIX, socket.SOCK_STREAM)
        peer.settimeout(2.0)
        peer.connect(path)
        raw_pid = peer.getsockopt(SOL_LOCAL, LOCAL_PEERPID, struct.calcsize("@i"))
        raw_cred = peer.getsockopt(SOL_LOCAL, LOCAL_PEERCRED, 256)
        if len(raw_pid) != struct.calcsize("@i") or len(raw_cred) < struct.calcsize("@IIh"):
            return None
        pid = struct.unpack("@i", raw_pid)[0]
        version, peer_uid, groups = struct.unpack_from("@IIh", raw_cred)
        expected_uid = os.getuid() if uid is None else uid
        if pid <= 0 or version != XUCRED_VERSION or peer_uid != expected_uid or groups < 0:
            return None
        found = identity(pid)
        if not found or found["uid"] != expected_uid:
            return None
        confirmed = identity(pid)
        stable = ("pid", "ppid", "uid", "startSec", "startUsec")
        if not confirmed or any(found[key] != confirmed[key] for key in stable):
            return None
        return {key: found[key] for key in ("pid", "ppid", "uid", "startSec", "startUsec")}
    except (OSError, TypeError, ValueError, struct.error):
        return None
    finally:
        if peer is not None:
            try:
                peer.close()
            except OSError:
                pass


def lineage_roles(peer=None, identity=process_identity, current_pid=None, uid=None):
    """Resolve the session host on the bounded lineage of this proven local child.

    An authenticated peer identity on the stable ancestry is authoritative for this runtime.
    Executable names are only an unambiguous local fallback and are always discarded.
    """
    # The parent is the mhw/check process that created this short-lived sanitizer. It is the proven
    # executor child for this observation and remains alive while the parent collects metrics.
    child_pid = os.getppid() if current_pid is None else int(current_pid)
    child = identity(child_pid)
    expected_uid = os.getuid() if uid is None else uid
    if not child or child["uid"] != expected_uid:
        return None
    seen = set()
    cursor = child
    chain = []
    named_hosts = []
    for _ in range(32):
        pid = cursor["pid"]
        if pid in seen or pid <= 0:
            return None
        seen.add(pid)
        chain.append(cursor)
        names = {cursor.get("comm", b"").lower(), cursor.get("name", b"").lower()}
        if b"codex" in names:
            if cursor["uid"] != expected_uid:
                return None
            named_hosts.append(cursor)
        if cursor["ppid"] <= 0:
            break
        cursor = identity(cursor["ppid"])
        if not cursor:
            break
    host = None
    if peer is not None:
        peer_key = (peer.get("pid"), peer.get("uid"), peer.get("startSec"), peer.get("startUsec"))
        same_pid = [entry for entry in chain if entry["pid"] == peer.get("pid")]
        exact = [entry for entry in same_pid
                 if (entry["pid"], entry["uid"], entry["startSec"], entry["startUsec"]) == peer_key]
        # Seeing the peer PID with a different kernel start identity is reuse/change, never a cue to
        # fall back to a name. An exact match is the host for this runtime even when wrappers leave
        # more than one process named codex on the ancestry.
        if same_pid and len(exact) != 1:
            return None
        if len(exact) == 1:
            host = exact[0]
    if host is None:
        if len(named_hosts) != 1:
            return None
        host = named_hosts[0]
    stable = ("pid", "ppid", "uid", "startSec", "startUsec")
    for before in chain:
        after = identity(before["pid"])
        if not after or any(before[key] != after[key] for key in stable):
            return None
    return {
        "sessionHostPid": host["pid"], "sessionHostStartSec": host["startSec"],
        "sessionHostStartUsec": host["startUsec"], "executorPid": child["pid"],
        "executorStartSec": child["startSec"], "executorStartUsec": child["startUsec"],
    }


def project(raw, peer_lookup=peer_identity, roles_lookup=lineage_roles):
    """Return the safe projection, or None for any schema, type or decoding drift."""
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (AttributeError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(doc, dict) or set(doc) != VENDOR_FIELDS:
        return None
    if any(not isinstance(value, str) for value in doc.values()):
        return None
    if doc["status"] not in ("running", "stopped") or doc["backend"] != "pid":
        return None
    if any(not VERSION.fullmatch(doc[field]) for field in
           ("managedCodexVersion", "cliVersion", "appServerVersion")):
        return None
    peer = None
    if doc["status"] == "running":
        peer = peer_lookup(doc["socketPath"])
        peer_fields = {"pid", "ppid", "uid", "startSec", "startUsec"}
        if (not isinstance(peer, dict) or set(peer) != peer_fields or
                any(not isinstance(peer[field], int) or isinstance(peer[field], bool)
                    for field in peer_fields) or peer["pid"] <= 0 or peer["ppid"] < 0 or
                peer["startSec"] <= 0 or peer["startUsec"] < 0):
            return None
    roles = roles_lookup(peer) if doc["status"] == "running" else None
    role_fields = {"sessionHostPid", "sessionHostStartSec", "sessionHostStartUsec",
                   "executorPid", "executorStartSec", "executorStartUsec"}
    if roles is not None and (not isinstance(roles, dict) or set(roles) != role_fields or
                              any(not isinstance(roles[field], int) or isinstance(roles[field], bool)
                                  for field in role_fields) or
                              any(roles[field] <= 0 for field in
                                  ("sessionHostPid", "sessionHostStartSec",
                                   "executorPid", "executorStartSec")) or
                              any(roles[field] < 0 for field in
                                  ("sessionHostStartUsec", "executorStartUsec"))):
        return None
    safe = {field: doc[field] for field in SAFE_FIELDS}
    safe.update({
        "peerPid": None if peer is None else peer["pid"],
        "peerPpid": None if peer is None else peer["ppid"],
        "peerStartSec": None if peer is None else peer["startSec"],
        "peerStartUsec": None if peer is None else peer["startUsec"],
    })
    for field in ("sessionHostPid", "sessionHostStartSec", "sessionHostStartUsec", "executorPid",
                  "executorStartSec", "executorStartUsec"):
        safe[field] = None if roles is None else roles[field]
    return safe


def main(argv):
    if argv:
        return 2
    codex = shutil.which("codex")
    if not codex:
        return 1
    try:
        vendor = subprocess.run([codex, "app-server", "daemon", "version"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return 1
    if vendor.returncode != 0:
        return UNREACHABLE if not (vendor.stdout or b"").strip() else 1
    safe = project(vendor.stdout)
    if safe is None:
        return 1
    sys.stdout.write(json.dumps(safe, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
