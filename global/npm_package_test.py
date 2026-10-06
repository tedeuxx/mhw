#!/usr/bin/env python3
"""Regression tests for the npm package (Issue #68, ADR-0034): the `workstation` launcher, the
package-time provenance stamp, the no-.git install path and npm-mode update. Throwaway HOMEs, npm
prefixes, caches and admin roots only; never a registry, never a real configuration, never sudo.

    python3 -B global/npm_package_test.py

Needs node; the pack-and-install class also needs npm, a POSIX sh and jq (skipped without them).
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import workstation as ws  # noqa: E402

ROOT = ws.ROOT
NODE = shutil.which("node")
NPM = shutil.which("npm")
SHA = "0123456789abcdef0123456789abcdef01234567"
STAMP_SHAPE = re.compile(r"release: [A-Za-z0-9 .,()_-]+; commit: ([0-9a-f]{40}(-dirty)?|unknown)")


def node_eval(script, env=None, cwd=None):
    p = subprocess.run([NODE, "-e", script], capture_output=True, text=True, env=env, cwd=cwd)
    if p.returncode != 0:
        raise AssertionError(p.stderr)
    return json.loads(p.stdout)


def write_exe(path, text):
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


@unittest.skipUnless(NODE, "needs node")
class Launcher(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="npm-launcher-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(os.path.realpath(self.temp.name))

    @unittest.skipUnless(os.name == "posix", "needs a POSIX sh")
    def test_posix_resolves_the_package_not_the_cwd(self):
        # npm puts a symlink on PATH; the launcher must find ./workstation beside its real file even
        # when called through that link from an unrelated directory.
        (self.base / "bin").mkdir()
        (self.base / "elsewhere").mkdir()
        link = self.base / "bin" / "workstation"
        link.symlink_to(ROOT / "bin" / "workstation.js")
        p = subprocess.run([str(link), "--help"], cwd=self.base / "elsewhere", capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("./workstation install --admin", p.stdout)
        p = subprocess.run([str(link), "no-such-subcommand"], cwd=self.base / "elsewhere",
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertIn("unknown subcommand no-such-subcommand", p.stderr)

    @unittest.skipUnless(os.name == "posix", "the PowerShell stub is a POSIX script")
    def test_windows_mapping_onto_install_ps1(self):
        stub = self.base / "ps"
        write_exe(stub, "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done\n")
        env = dict(os.environ, WORKSTATION_LAUNCHER_PLATFORM="win32", WORKSTATION_POWERSHELL=str(stub))
        ps1 = str(ROOT / "global" / "install.ps1")
        base = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1]

        def run(*args):
            p = subprocess.run([NODE, str(ROOT / "bin" / "workstation.js")] + list(args), env=env,
                               cwd=self.base, capture_output=True, text=True)
            return p.returncode, p.stdout.splitlines(), p.stderr

        self.assertEqual(run("install"), (0, base, ""))
        self.assertEqual(run("install", "--method", "--overlay=none"),
                         (0, base + ["-Method", "-Overlay", "none"], ""))
        self.assertEqual(run("check"), (0, base + ["-Check"], ""))
        self.assertEqual(run("status"), (0, base + ["-Check"], ""))
        for args in (("install", "--admin"), ("uninstall",), ("check", "--method"), ("install", "--overlay=")):
            code, out, err = run(*args)
            self.assertEqual((code, out), (2, []), args)
            self.assertTrue(err.startswith("workstation: "), err)
        code, out, _ = run("update", "v4.2.0")
        self.assertEqual(code, 0)
        self.assertIn("RUN     npm install -g github:%s#v4.2.0" % ws.REPO, out)

    def test_update_text_is_the_same_in_node_and_python(self):
        for wanted in (None, "v4.2.0", "v10.0.3", "4.2.0", "v4.2", "main", "v4.2.0;x"):
            js = node_eval("const l=require(%s); const r=l.updateLines(%s, l.ROOT); "
                           "process.stdout.write(JSON.stringify([r.code, r.out || [r.err]]))"
                           % (json.dumps(str(ROOT / "bin" / "workstation.js")),
                              "undefined" if wanted is None else json.dumps(wanted)))
            code, lines = ws.npm_update_lines(wanted)
            self.assertEqual(js, [code, lines], wanted)
        _, lines = ws.npm_update_lines(None)
        major = re.search(r'^current_version\s*=\s*"(\d+\.\d+\.\d+)"',
                          (ROOT / ".bumpversion.toml").read_text(encoding="utf-8"), re.M).group(1)
        self.assertEqual(lines[1], "RUN     npm install -g github:%s#semver:^%s" % (ws.REPO, major))
        self.assertEqual(ws.npm_update_lines("main")[0], 2)

    def test_package_version_follows_bumpversion(self):
        # bump-my-version rewrites package.json in the same commit (.bumpversion.toml files entry).
        toml = (ROOT / ".bumpversion.toml").read_text(encoding="utf-8")
        version = re.search(r'^current_version\s*=\s*"([^"]+)"', toml, re.M).group(1)
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], version)
        self.assertIn('filename = "package.json"', toml)
        self.assertIs(package["private"], True)
        self.assertEqual(package["bin"], {"workstation": "bin/workstation.js"})
        self.assertNotIn("dependencies", package)


@unittest.skipUnless(NODE and shutil.which("git"), "needs node and git")
class Stamp(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="npm-stamp-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(os.path.realpath(self.temp.name))

    def stamp(self, root, env):
        return node_eval("process.stdout.write(JSON.stringify(require(%s).stamp(%s, process.env)))"
                         % (json.dumps(str(ROOT / "bin" / "stamp.js")), json.dumps(str(root))), env=env)

    @unittest.skipUnless(os.name == "posix" and shutil.which("jq"), "needs a POSIX sh and jq")
    def test_checkout_stamp_is_install_sh_stamp(self):
        # In a git checkout the package-time stamp follows install.sh's rule exactly.
        home = self.base / "home"
        home.mkdir()
        p = subprocess.run(["sh", str(ROOT / "global" / "install.sh"), "--check", "--overlay=none"],
                           env={"PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(self.base)},
                           capture_output=True, text=True)
        source = re.search(r"(?m)^SOURCE  (.*)$", p.stdout).group(1)
        self.assertEqual(self.stamp(ROOT, dict(os.environ)), source)
        self.assertRegex(source, STAMP_SHAPE)

    def tarball_dir(self):
        pkg = self.base / "pkg"
        pkg.mkdir()
        shutil.copy(ROOT / ".bumpversion.toml", pkg / ".bumpversion.toml")
        return pkg

    @unittest.skipUnless(os.name == "posix", "the fake git is a POSIX script")
    def test_hosted_tarball_stamp_from_npm_resolution(self):
        pkg = self.tarball_dir()
        version = re.search(r'^current_version\s*=\s*"([^"]+)"',
                            (pkg / ".bumpversion.toml").read_text(encoding="utf-8"), re.M).group(1)
        fake = self.base / "fakebin"
        fake.mkdir()
        listing = self.base / "ls-remote.txt"
        write_exe(fake / "git", "#!/bin/sh\ncase \"$1\" in ls-remote) cat \"%s\" || exit 128;; "
                                "*) exit 128;; esac\n" % listing)
        env = dict(os.environ, PATH=str(fake) + os.pathsep + os.environ["PATH"],
                   _PACOTE_NO_PREPARE_="git+ssh://git@github.com/o/r.git#" + SHA)
        tag = "v" + version
        other = "f" * 40
        listing.write_text("%s\trefs/tags/%s\n%s\trefs/tags/%s^{}\n" % (other, tag, SHA, tag), encoding="utf-8")
        self.assertEqual(self.stamp(pkg, env), "release: %s; commit: %s" % (tag, SHA))
        listing.write_text("%s\trefs/tags/%s\n%s\trefs/tags/%s^{}\n" % (SHA, tag, other, tag), encoding="utf-8")
        self.assertEqual(self.stamp(pkg, env), "release: unreleased, after %s; commit: %s" % (tag, SHA))
        listing.unlink()
        s = self.stamp(pkg, env)
        self.assertEqual(s, "release: unverified, %s or later (tags unreadable at package time); commit: %s"
                         % (tag, SHA))
        self.assertRegex(s, STAMP_SHAPE)
        # No resolution from npm and no checkout: unknown, never a borrowed commit.
        env.pop("_PACOTE_NO_PREPARE_")
        s = self.stamp(pkg, env)
        self.assertEqual(s, "release: unknown, npm package (.bumpversion.toml says %s); commit: unknown" % version)
        self.assertRegex(s, STAMP_SHAPE)

    def test_second_prepare_keeps_the_first_known_commit(self):
        # npm runs prepare twice for a hosted git dependency; only the first sees the resolved commit.
        known = "release: unreleased, after v4.0.0; commit: " + SHA
        unknown = "release: unknown, npm package (.bumpversion.toml says 4.0.0); commit: unknown"
        decide = "require(%s).decide" % json.dumps(str(ROOT / "bin" / "stamp.js"))
        for computed, existing, want in ((unknown, known + "\n", known), (unknown, None, unknown),
                                         (unknown, "garbage; commit: zz\n", unknown),
                                         ("release: v4.0.0; commit: " + "e" * 40, known, "release: v4.0.0; commit: " + "e" * 40)):
            got = node_eval("process.stdout.write(JSON.stringify(%s(%s, %s)))"
                            % (decide, json.dumps(computed), json.dumps(existing)))
            self.assertEqual(got, want)

    def test_a_tarball_inside_another_repository_borrows_nothing(self):
        outer = self.base / "outer"
        outer.mkdir()
        subprocess.run(["git", "init", "-q", str(outer)], check=True)
        subprocess.run(["git", "-C", str(outer), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                        "commit", "-q", "--allow-empty", "-m", "outer"], check=True)
        pkg = outer / "pkg"
        pkg.mkdir()
        shutil.copy(ROOT / ".bumpversion.toml", pkg / ".bumpversion.toml")
        env = {k: v for k, v in os.environ.items() if k != "_PACOTE_NO_PREPARE_"}
        self.assertTrue(self.stamp(pkg, env).endswith("; commit: unknown"))


@unittest.skipUnless(NODE and NPM and os.name == "posix" and shutil.which("jq") and shutil.which("git"),
                     "needs node, npm, git, jq and a POSIX sh")
class PackAndInstall(unittest.TestCase):
    """npm pack from this checkout, npm install -g into a throwaway prefix, then the installed command."""

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="npm-package-")
        cls.base = Path(os.path.realpath(cls.temp.name))
        cls.cache = cls.base / "cache"
        p = subprocess.run([NPM, "pack", "--pack-destination", str(cls.base), "--cache", str(cls.cache)],
                           cwd=ROOT, capture_output=True, text=True)
        if p.returncode != 0:
            raise AssertionError(p.stdout + p.stderr)
        cls.tgz = next(cls.base.glob("*.tgz"))
        with tarfile.open(cls.tgz) as t:
            cls.names = t.getnames()
            cls.stamp = t.extractfile("package/.workstation-stamp").read().decode().strip()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def env(self, name):
        d = self.base / name
        for sub in ("home", "root", "tmp", "proj"):
            (d / sub).mkdir(parents=True)
        return d, {"PATH": str(d / "prefix" / "bin") + os.pathsep + os.environ["PATH"], "HOME": str(d / "home"),
                   "TMPDIR": str(d / "tmp"), "WORKSTATION_MANAGED_ROOT": str(d / "root"),
                   "npm_config_cache": str(self.cache), "npm_config_prefix": str(d / "prefix"),
                   "npm_config_update_notifier": "false", "npm_config_audit": "false", "npm_config_fund": "false"}

    def test_files_allow_list(self):
        names = {n[len("package/"):] for n in self.names}
        for needed in ("workstation", ".bumpversion.toml", ".workstation-stamp", "bin/workstation.js",
                       "global/workstation.py", "global/install.sh", "global/install-managed.sh",
                       "global/install.ps1", "global/AGENTS.md", "global/deny-floor.conf", "package.json"):
            self.assertIn(needed, names)
        self.assertFalse([n for n in names if n.endswith(("_test.py", ".test.sh", ".test.ps1", ".test.stub"))])
        self.assertFalse([n for n in names if n.startswith(("docs/", "workspace/", ".github/", ".git/"))])
        self.assertNotIn("overlay/mcp-servers.json", names)
        self.assertRegex(self.stamp, STAMP_SHAPE)

    def test_files_allow_list_drops_private_overlay_files(self):
        # A local overlay MCP definition (untracked, ADR-0017) must never ride into a package.
        copy = self.base / "copy"
        tracked = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z", "--cached", "--others", "--exclude-standard"], capture_output=True,
                                 check=True).stdout.decode().split("\0")
        for rel in filter(None, tracked):
            if (ROOT / rel).is_file():
                (copy / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / rel, copy / rel)
        (copy / "overlay" / "mcp-servers.json").write_text("{}", encoding="utf-8")
        (copy / "overlay" / "x.local.json").write_text("{}", encoding="utf-8")
        p = subprocess.run([NPM, "pack", "--dry-run", "--json", "--ignore-scripts", "--cache", str(self.cache)],
                           cwd=copy, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        files = {f["path"] for f in json.loads(p.stdout)[0]["files"]}
        self.assertIn("overlay/profile.json", files)
        self.assertNotIn("overlay/mcp-servers.json", files)
        self.assertNotIn("overlay/x.local.json", files)

    def test_global_install_then_workstation(self):
        d, env = self.env("e2e")
        p = subprocess.run([NPM, "install", "-g", "--offline", str(self.tgz)], env=env, cwd=d,
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        pkg = d / "prefix" / "lib" / "node_modules" / ws.NAME
        self.assertFalse((pkg / ".git").exists())
        self.assertEqual((pkg / ".workstation-stamp").read_text(encoding="utf-8").strip(), self.stamp)
        p = subprocess.run(["workstation", "install", "--overlay=none"], env=env, cwd=d / "proj",
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("CHECK   every user-level target matches this checkout", p.stdout)
        marker = (d / "home" / ".claude" / "CLAUDE.md").read_text(encoding="utf-8").splitlines()[0]
        self.assertIn("; %s;" % self.stamp, marker)
        p = subprocess.run(["workstation", "status", "--overlay=none", "--project=" + str(d / "proj")],
                           env=env, cwd=d / "proj", capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("  source           %s (this checkout)" % ws.short_stamp(self.stamp), p.stdout)
        p = subprocess.run(["workstation", "update"], env=env, cwd=d / "proj", capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("RUN     npm install -g github:%s#semver:^" % ws.REPO, p.stdout)
        self.assertFalse((pkg / ".git").exists())

    def test_installed_package_with_a_bad_stamp_says_unknown(self):
        d, env = self.env("bad")
        pkg = d / "unpacked"
        with tarfile.open(self.tgz) as t:
            t.extractall(pkg)
        root = pkg / "package"
        (root / ".workstation-stamp").write_text('release: v1.0.0"; x; commit: zz\n', encoding="utf-8")
        p = subprocess.run(["sh", str(root / "global" / "install.sh"), "--check", "--overlay=none"],
                           env=env, capture_output=True, text=True)
        source = re.search(r"(?m)^SOURCE  (.*)$", p.stdout).group(1)
        self.assertTrue(source.startswith("release: unknown, not a git checkout"), source)
        (root / ".workstation-stamp").write_text(self.stamp + "\n", encoding="utf-8")
        p = subprocess.run(["sh", str(root / "global" / "install.sh"), "--check", "--overlay=none"],
                           env=env, capture_output=True, text=True)
        self.assertEqual(re.search(r"(?m)^SOURCE  (.*)$", p.stdout).group(1), self.stamp)

    def test_package_inside_another_repository_keeps_its_own_stamp(self):
        d, env = self.env("nested")
        outer = d / "outer"
        outer.mkdir()
        subprocess.run(["git", "init", "-q", str(outer)], check=True)
        subprocess.run(["git", "-C", str(outer), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                        "commit", "-q", "--allow-empty", "-m", "outer"], check=True)
        with tarfile.open(self.tgz) as t:
            t.extractall(outer)
        p = subprocess.run(["sh", str(outer / "package" / "global" / "install.sh"), "--check", "--overlay=none"],
                           env=env, capture_output=True, text=True)
        self.assertEqual(re.search(r"(?m)^SOURCE  (.*)$", p.stdout).group(1), self.stamp)


if __name__ == "__main__":
    unittest.main(verbosity=2)
