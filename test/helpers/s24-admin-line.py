#!/usr/bin/env python3
"""S24 (#495) recorder: the one root command line global/workstation.py ran for the admin layer, never run.

    python3 -I -B s24-admin-line.py <base tree>   (prints the JSON test/golden/S24/admin-lines.json holds)

It imports the base revision's global/workstation.py and replaces its run() with a recorder, so no sudo,
no installer and no process of any kind starts: each scenario feeds admin_apply() a synthetic render of
install-managed.sh (the RUN line it prints) and records the argv admin_apply() would have run as root, its
output and its result, with WORKSTATION_MANAGED_ROOT unset (the owner's real path: sudo) and set (tests: no
sudo). It also records as_root() for uninstall's --remove. The paths are synthetic.
"""
import contextlib
import io
import json
import os
import sys

TREE = sys.argv[1]
sys.path.insert(0, os.path.join(TREE, "global"))
import workstation as ws  # noqa: E402

# A placeholder for the base tree's own path, so the recording does not depend on where it was extracted.
HERE = str(ws.INSTALL_MANAGED)
STAGE = "/Users/someone/Library/Caches/mhw stage/admin-stage.ABC123"
SHA = "0123456789abcdef" * 4
RENDERS = {
    "rendered": (0, ["STAGED  admin layer in " + STAGE, 'RUN     sudo /bin/sh "%s" --apply="%s" --sha256=%s' % (HERE, STAGE, SHA),
                     "THEN    mhw install   (detects the admin layer and removes the user-level duplicates), then open fresh sessions"]),
    "rendered-with-root": (0, ['RUN     sudo /bin/sh "%s" --apply="%s" --sha256=%s --root="/tmp/r"' % (HERE, STAGE, SHA)]),
    "verbose-lines": (0, ["OK      something", "DRIFT   other", "CHANGED x -> y",
                          'RUN     sudo /bin/sh "%s" --apply="%s" --sha256=%s' % (HERE, STAGE, SHA), "THEN    next"]),
    "no-run-line": (0, ["STAGED  admin layer in " + STAGE]),
    "upper-case-hash": (0, ['RUN     sudo /bin/sh "%s" --apply="%s" --sha256=ABCDEF' % (HERE, STAGE)]),
    "render-failed": (4, ["REFUSE  the stage could not be written"]),
}


def record(name, root, verbose):
    calls = []
    first = RENDERS[name]

    def fake(args, capture=True):
        calls.append(list(args))
        if len(calls) == 1:
            return first
        return 0, ["APPLIED fine", "THEN    after"]

    if root is None:
        os.environ.pop("WORKSTATION_MANAGED_ROOT", None)
    else:
        os.environ["WORKSTATION_MANAGED_ROOT"] = root
    saved = ws.run
    ws.run = fake
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            code, lines = ws.admin_apply(verbose)
    finally:
        ws.run = saved
    return {"calls": calls, "code": code, "lines": lines, "stdout": out.getvalue()}


result = {}
for name in RENDERS:
    for label, root in (("sudo", None), ("managed-root", "/tmp/throwaway root")):
        for verbose in (False, True):
            result["%s %s %s" % (name, label, "verbose" if verbose else "quiet")] = record(name, root, verbose)
os.environ.pop("WORKSTATION_MANAGED_ROOT", None)
result["as_root remove sudo"] = ws.as_root(["/bin/sh", HERE, "--remove"])
os.environ["WORKSTATION_MANAGED_ROOT"] = "/tmp/throwaway root"
result["as_root remove managed-root"] = ws.as_root(["/bin/sh", HERE, "--remove"])
text = json.dumps(result, indent=2, sort_keys=True).replace(HERE, "<INSTALL_MANAGED>")
print(text)
