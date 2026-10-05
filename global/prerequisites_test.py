#!/usr/bin/env python3
"""Regression tests for the prerequisites section of ./workstation check (Issue #89).

Throwaway HOME, fake tool shims on a PATH that holds nothing else, a stub gh that never contacts GitHub,
and a loopback HTTP server standing in for SonarCloud and HCP Terraform. Never a real account, never a
real credential, never a write outside the temporary directory.

    python3 -B global/prerequisites_test.py
"""
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prerequisites as pq  # noqa: E402

HERE = Path(__file__).resolve().parent
TOKEN = "fake-token-for-tests-0000"
LOGIN = "fake-login-never-printed"

GH_SHIM = """#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
case "$1 $2" in
  "--version "*) echo "gh version 2.40.1 (2024-01-01)"; exit 0 ;;
  "auth status") echo "Logged in to github.com account $FAKE_LOGIN"; exit "${FAKE_GH_AUTH:-0}" ;;
  "api "*) cat "$STUB_REPO"; exit 0 ;;
esac
exit 3
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        self.server.seen.append((self.path, auth))
        good = auth == "Bearer " + TOKEN
        if self.path == "/api/authentication/validate":
            body, code = json.dumps({"valid": good}).encode(), 200
        elif self.path == "/api/v2/account/details":
            body, code = b"{}", 200 if good else 401
        elif self.path.startswith("/api/components/show?component="):
            key = self.path.split("=", 1)[1]
            body, code = b"{}", 200 if key == "public-project" else 404
        else:
            body, code = b"", 404
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="prereq-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.bin = self.base / "bin"
        self.overlay = self.base / "overlay"
        for d in (self.bin, self.overlay, self.base / "home"):
            d.mkdir()
        for tool in ("sh", "dirname", "grep", "cat"):
            real = shutil.which(tool)
            if real:
                os.symlink(real, self.bin / tool)
        self.log = self.base / "gh.log"
        self.repo = self.base / "repo.json"
        self.repo.write_text(json.dumps({"allow_merge_commit": True, "allow_squash_merge": False,
                                         "allow_rebase_merge": False}), encoding="utf-8")
        self.env = {"PATH": str(self.bin), "HOME": str(self.base / "home"), "STUB_LOG": str(self.log),
                    "STUB_REPO": str(self.repo), "FAKE_LOGIN": LOGIN, "WORKSTATION_OVERLAY": str(self.overlay)}

    def shim(self, name, text):
        path = self.bin / name
        path.write_text(text, encoding="utf-8")
        path.chmod(0o755)

    def tool(self, name, version_line, code=0):
        self.shim(name, "#!/bin/sh\necho '%s'\nexit %d\n" % (version_line, code))

    def declare(self, items, lanes=("workstation", "site")):
        path = self.base / "decl.json"
        path.write_text(json.dumps({"lanes": {lane: lane for lane in lanes}, "items": items}), encoding="utf-8")
        self.env["WORKSTATION_PREREQUISITES"] = str(path)

    def overlay_file(self, doc):
        (self.overlay / pq.OVERLAY_FILE).write_text(json.dumps(doc), encoding="utf-8")

    def check(self, *extra):
        p = subprocess.run([sys.executable, "-B", str(HERE / "workstation.py"), "check", "--prerequisites"]
                           + list(extra), env=self.env, capture_output=True, text=True, timeout=120)
        return p.returncode, p.stdout + p.stderr


def item(id_, required="required", **kw):
    out = {"id": id_, "name": id_, "category": "local-tool", "required": required,
           "manual": "STEP-" + id_, "presence": {"commands": [id_]}}
    out.update(kw)
    return out


GH_ITEM = item("gh", version={"args": ["--version"]}, auth={"kind": "gh-auth-status"},
               preferred={"kind": "github-repo-settings"})


class Declaration(unittest.TestCase):
    def test_repository_declaration_is_valid_and_generic(self):
        doc = pq.load_declaration(pq.DECLARATION)
        ids = [i["id"] for i in doc["items"]]
        for needed in ("claude", "codex", "github", "sonarcloud", "terraform-cloud", "git", "jq", "python3",
                       "terraform", "node"):
            self.assertIn(needed, ids)
        for i in doc["items"]:
            self.assertTrue(i["manual"].strip(), i["id"])
        text = pq.DECLARATION.read_text(encoding="utf-8")
        # Generic: no account, repository owner, e-mail or credential value.
        self.assertNotRegex(text, r"[\w.+-]+@[\w-]+\.[\w.]+")
        self.assertNotIn("tedeuxx", text)
        self.assertNotRegex(text, r"(ghp_|gho_|github_pat_|sqp_|squ_)[A-Za-z0-9]")

    def test_probe_set_is_closed(self):
        lanes = {"lanes": {"site": ""}}
        bad = [
            item("x", version={"args": ["install"]}),
            item("x", presence={"commands": ["x"], "args": ["--apply"]}),
            item("x", presence={"commands": ["x; rm"]}),
            item("x", auth={"kind": "shell"}),
            item("x", auth={"kind": "tfc-token", "env": "lower case"}),
            item("x", preferred={"kind": "apply-settings"}),
            item("x", lanes={"nowhere": "required"}),
            item("x", required="maybe"),
            item("x", manual=""),
        ]
        for b in bad:
            with self.subTest(b=b):
                with self.assertRaises(pq.DeclarationError):
                    pq.validate(dict(lanes, items=[b]))
        pq.validate(dict(lanes, items=[item("x", version={"args": ["--version"], "minimum": "1.2"},
                                            lanes={"site": "optional"})]))

    def test_versions(self):
        self.assertEqual(pq.parse_version("Terraform v1.9.5\non darwin_arm64"), (1, 9, 5))
        self.assertEqual(pq.parse_version("ShellCheck - tool\nversion: 0.10.0"), (0, 10, 0))
        self.assertEqual(pq.parse_version("v22"), (22, 0, 0))
        self.assertIsNone(pq.parse_version("no digits"))

    def test_base_url_override_is_loopback_only(self):
        saved = os.environ.get("WORKSTATION_SONAR_URL")
        try:
            for value, want in (("http://127.0.0.1:8080", "http://127.0.0.1:8080"),
                                ("https://evil.example", pq.SONAR_URL), ("http://127.0.0.1.evil:1", pq.SONAR_URL),
                                ("http://localhost:1", pq.SONAR_URL)):
                os.environ["WORKSTATION_SONAR_URL"] = value
                self.assertEqual(pq.base_url("WORKSTATION_SONAR_URL", pq.SONAR_URL), want)
        finally:
            if saved is None:
                os.environ.pop("WORKSTATION_SONAR_URL", None)
            else:
                os.environ["WORKSTATION_SONAR_URL"] = saved


@unittest.skipUnless(os.name == "posix" and shutil.which("sh"), "needs a POSIX sh")
class Presence(Base):
    def test_present_missing_optional_and_lane(self):
        self.tool("alpha", "alpha 2.3.4")
        self.declare([item("alpha", version={"args": ["--version"], "minimum": "2.0"}),
                      item("beta", required="optional"),
                      item("gamma", required="optional", lanes={"site": "required"})])
        code, out = self.check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^OK      alpha \[required\]: present \(alpha 2\.3\.4\)$")
        self.assertRegex(out, r"(?m)^ABSENT  beta \[optional\]: missing \(beta not found\) -> STEP-beta$")
        self.assertRegex(out, r"(?m)^ABSENT  gamma \[optional; required for site\]: .* -> STEP-gamma$")
        self.assertIn("PREREQ  0 required item(s) missing; check-only, nothing was applied", out)
        # The owner's overlay activates the site lane: its required item now fails the check.
        self.overlay_file({"lanes": ["site", "bogus"]})
        code, out = self.check()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"(?m)^MISSING gamma \[optional; required for site\]: .* -> STEP-gamma$")
        self.assertIn("invalid lanes ignored", out)
        # A required item missing fails without any overlay.
        self.overlay_file({})
        (self.bin / "alpha").unlink()
        code, out = self.check()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"(?m)^MISSING alpha \[required\]: missing \(alpha not found\) -> STEP-alpha$")
        self.assertIn("PREREQ  1 required item(s) missing", out)

    def test_version_drift_is_reported_not_fatal(self):
        self.tool("alpha", "Alpha v1.5.0")
        self.declare([item("alpha", version={"args": ["version"], "minimum": "1.9"})])
        code, out = self.check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^DRIFT   alpha \[required\]: present \(alpha 1\.5\.0\) · drift: version "
                              r"1\.5\.0 below minimum 1\.9 -> STEP-alpha$")

    def test_any_of_path_probe_os_and_manual(self):
        self.tool("second", "second 1.0")
        self.tool("pathq", "", code=2)
        self.declare([item("first", presence={"commands": ["first", "second"]}),
                      item("pathq", presence={"commands": ["pathq"], "args": ["-p"]}),
                      item("macos", os=["NoSuchOS"]),
                      item("sub", presence={"kind": "manual"})])
        code, out = self.check()
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"(?m)^OK      first \[required\]: present \(second\)$")
        # Present on PATH but its path query fails: not installed (xcode-select -p without the tools).
        self.assertRegex(out, r"(?m)^MISSING pathq ")
        self.assertRegex(out, r"(?m)^SKIP    macos \[required\]: not applicable on ")
        self.assertRegex(out, r"(?m)^MANUAL  sub \[required\]: not detectable here \(manual\) -> STEP-sub$")

    def test_invalid_declaration_exits_2(self):
        self.declare([item("x", version={"args": ["install"]})])
        code, out = self.check()
        self.assertEqual(code, 2, out)
        self.assertIn("declaration invalid, nothing checked", out)

    def test_repository_declaration_with_nothing_on_path(self):
        self.env.pop("WORKSTATION_PREREQUISITES", None)
        code, out = self.check()
        self.assertEqual(code, 1, out)
        for required in ("claude", "codex", "github", "git", "jq", "python3"):
            self.assertRegex(out, r"(?m)^MISSING %s \[required\]: missing " % required)
        self.assertRegex(out, r"(?m)^ABSENT  terraform \[optional; required for site\]")


@unittest.skipUnless(os.name == "posix" and shutil.which("sh") and shutil.which("jq"), "needs sh and jq")
class GitHub(Base):
    def setUp(self):
        super().setUp()
        self.shim("gh", GH_SHIM)
        os.symlink(shutil.which("jq"), self.bin / "jq")
        self.declare([GH_ITEM])
        self.overlay_file({"github_repos": ["owner-x/repo-y"]})

    def calls(self):
        return self.log.read_text(encoding="utf-8") if self.log.exists() else ""

    def test_authenticated_and_matching(self):
        code, out = self.check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^OK      gh \[required\]: present \(gh 2\.40\.1\) · authenticated · "
                              r"merge settings match the standard \(owner-x/repo-y\)$")
        self.assertNotIn(LOGIN, out)
        self.assertIn("api repos/owner-x/repo-y", self.calls())

    def test_squash_on_is_drift_and_never_applied(self):
        self.repo.write_text(json.dumps({"allow_merge_commit": True, "allow_squash_merge": True,
                                         "allow_rebase_merge": False}), encoding="utf-8")
        code, out = self.check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^DRIFT   gh \[required\]: .*drift owner-x/repo-y: "
                              r"allow_squash_merge=true \(standard: false\) -> STEP-gh$")
        self.assertNotIn("PATCH", self.calls())
        self.assertNotIn("--method", self.calls())
        self.assertTrue(json.loads(self.repo.read_text(encoding="utf-8"))["allow_squash_merge"])

    def test_unauthenticated(self):
        self.env["FAKE_GH_AUTH"] = "1"
        code, out = self.check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^NOAUTH  gh \[required\]: present \(gh 2\.40\.1\) · not authenticated · "
                              r"merge settings not checked \(credential not available\) -> STEP-gh$")
        self.assertNotIn(LOGIN, out)
        self.assertNotIn("api ", self.calls())


@unittest.skipUnless(os.name == "posix", "needs POSIX")
class Services(Base):
    def setUp(self):
        super().setUp()
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.seen = []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        url = "http://127.0.0.1:%d" % self.server.server_address[1]
        self.env.update({"WORKSTATION_SONAR_URL": url, "WORKSTATION_TFC_URL": url})
        self.declare([item("sonar", required="optional", presence={"kind": "account"},
                           auth={"kind": "sonarcloud-token", "env": "SONAR_TOKEN"},
                           preferred={"kind": "sonarcloud-project"}),
                      item("tfc", required="optional", presence={"kind": "account"},
                           auth={"kind": "tfc-token", "env": "TFC_API_TOKEN"})])

    def test_no_credential_no_call(self):
        code, out = self.check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^NOCHECK sonar \[optional\]: account, no local client to detect · "
                              r"authentication not checked \(credential not available\); \$SONAR_TOKEN unset · "
                              r"project not checked \(no project key in the overlay\) -> STEP-sonar$")
        self.assertRegex(out, r"(?m)^NOCHECK tfc .*not checked \(credential not available\); \$TFC_API_TOKEN unset")
        self.assertEqual(self.server.seen, [])

    def test_valid_and_rejected_tokens_and_project(self):
        self.overlay_file({"sonar_projects": ["public-project", "missing-project"]})
        self.env.update({"SONAR_TOKEN": TOKEN, "TFC_API_TOKEN": TOKEN})
        code, out = self.check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"(?m)^DRIFT   sonar \[optional\]: .*authenticated \(\$SONAR_TOKEN\) · "
                              r"project public-project reachable · project missing-project not reachable "
                              r"\(HTTP 404\) -> STEP-sonar$")
        self.assertRegex(out, r"(?m)^OK      tfc \[optional\]: .*authenticated \(\$TFC_API_TOKEN\)$")
        self.assertNotIn(TOKEN, out)
        self.env.update({"SONAR_TOKEN": "wrong", "TFC_API_TOKEN": "wrong"})
        code, out = self.check()
        self.assertRegex(out, r"(?m)^NOAUTH  sonar .*not authenticated \(\$SONAR_TOKEN rejected\)")
        self.assertRegex(out, r"(?m)^NOAUTH  tfc .*not authenticated \(\$TFC_API_TOKEN rejected\)")
        self.assertTrue(all(path.startswith("/api/") for path, _ in self.server.seen))

    def test_unreachable_is_not_checked(self):
        self.env.update({"SONAR_TOKEN": TOKEN, "WORKSTATION_SONAR_URL": "http://127.0.0.1:9"})
        code, out = self.check()
        self.assertRegex(out, r"(?m)^NOCHECK sonar .*authentication not checked \(service unreachable\)")


if __name__ == "__main__":
    unittest.main(verbosity=1)
