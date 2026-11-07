#!/usr/bin/env python3
"""The fixture project's containerised test command (mhw Issue #246, dry run only).

The reference CI/CD runs this inside the digest-pinned container, in the fixture's directory, and
gives it DELIVERY_EVIDENCE (where to write) and DELIVERY_CONTAINER_IMAGE. It writes one evidence
file in the shape docs/reference-cicd.md defines.

What is MEASURED here: the unit tests run, their results set test_layers and the two scenarios, and
line coverage of fixture_app.py is counted with the standard library's trace module. The revision is
read from git in this checkout.

What is a STUB, and says so: the seven security controls. The fixture has nothing to scan, so they
are constants. A real project replaces them with its scanners' results. The dry run measures the
plumbing of the gates, not the quality of a product.
"""
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import trace
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

STUB_SECURITY = ("quality-scan", "sast", "owasp-vulnerability-coverage", "authentication",
                 "authorization", "encryption-in-transit", "encryption-at-rest")


class Journeys(unittest.TestCase):
    def test_greet_reader(self):
        import fixture_app
        self.assertEqual(fixture_app.greet("Ada"), "Hello, Ada.")

    def test_no_unescaped_name(self):
        import fixture_app
        self.assertNotIn("<b>", fixture_app.greet("<b>Ada</b>"))


def run(name):
    result = unittest.TextTestRunner(verbosity=0).run(unittest.TestSuite([Journeys(name)]))
    return "pass" if result.wasSuccessful() and result.testsRun == 1 else "fail"


def main():
    tracer = trace.Trace(count=1, trace=0)
    tracer.runfunc(importlib.import_module, "fixture_app")  # the module body, traced too
    greet = tracer.runfunc(run, "test_greet_reader")
    escape = tracer.runfunc(run, "test_no_unescaped_name")
    app = str(HERE / "fixture_app.py")
    # Line 0 is the interpreter's own entry marker on recent Pythons, not a source line.
    executable = {n for n in trace._find_executable_linenos(app) if n > 0}
    ran = {line for (path, line) in tracer.results().counts if path == app}
    covered = ran & executable
    percent = round(100.0 * len(covered) / len(executable), 1) if executable else 0.0
    evidence = {
        "layer": "container",
        "revision": subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                                   check=True, cwd=HERE).stdout.strip(),
        "container_image": os.environ["DELIVERY_CONTAINER_IMAGE"],
        "test_layers": {"unit": "pass" if greet == escape == "pass" else "fail"},
        "coverage": {"metric": "line", "percent": percent},
        "critical_user_journeys": {"greet-reader": greet},
        "risk_scenarios": {"no-unescaped-name": escape},
        "security_controls": {name: "pass" for name in STUB_SECURITY},
        "findings": [],
    }
    Path(os.environ["DELIVERY_EVIDENCE"]).write_text(json.dumps(evidence, indent=2) + "\n",
                                                     encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
