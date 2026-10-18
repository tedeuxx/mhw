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
import re
import shutil
import subprocess
import sys


VENDOR_FIELDS = frozenset(("status", "backend", "managedCodexPath", "managedCodexVersion",
                           "socketPath", "cliVersion", "appServerVersion"))
UNREACHABLE = 3
SAFE_FIELDS = ("status", "backend", "managedCodexVersion", "cliVersion", "appServerVersion")
VERSION = re.compile(
    r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?"
)


def project(raw):
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
    return {field: doc[field] for field in SAFE_FIELDS}


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
