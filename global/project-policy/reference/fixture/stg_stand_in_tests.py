#!/usr/bin/env python3
"""The fixture project's installed-STG test command, against a LOCAL STAND-IN (mhw Issue #246).

The dry run deploys nothing, so there is no STG. This script starts the fixture app on 127.0.0.1 in
this runner, serving `/version` (the commit it was started from) and `/greet?name=`, then tests it
over HTTP the way a real project tests its installed STG, and writes the evidence file to
DELIVERY_EVIDENCE.

It measures the binding the installed-STG gate reads: the revision STG reports must be the revision
under test, and an unreadable one blocks. It does NOT measure an installation: a stand-in started
from this checkout cannot run another revision unless someone makes it. The security control it
reports is the one it checks, that the served greeting escapes markup.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import urlopen

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fixture_app  # noqa: E402

REVISION = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True,
                          cwd=HERE).stdout.strip()


class StandIn(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/version":
            body = REVISION
        elif url.path == "/greet":
            body = fixture_app.greet(parse_qs(url.query).get("name", [""])[0])
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *args):
        pass


def get(base, path):
    with urlopen(base + path, timeout=5) as response:
        return response.read().decode("utf-8")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), StandIn)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_address[1]
    try:
        deployed = get(base, "/version").strip()
    except OSError:
        deployed = None  # unreadable: the gate blocks
    greet = "pass" if get(base, "/greet?name=Ada") == "Hello, Ada." else "fail"
    escaped = "pass" if "<b>" not in get(base, "/greet?name=" + quote("<b>Ada</b>")) else "fail"
    server.shutdown()
    evidence = {
        "layer": "installed-stg",
        "revision": REVISION,
        "stg_deployed_revision": deployed,
        "test_layers": {"end-to-end": greet},
        "critical_user_journeys": {"greet-reader": greet},
        "risk_scenarios": {"no-unescaped-name": escaped},
        "security_controls": {"owasp-vulnerability-coverage": escaped},
        "findings": [],
    }
    Path(os.environ["DELIVERY_EVIDENCE"]).write_text(json.dumps(evidence, indent=2) + "\n",
                                                     encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
