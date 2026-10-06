#!/usr/bin/env python3
"""Regression tests for the npm package (Issue #68, ADR-0034): the `workstation` launcher, the archive
provenance stamp read when there is no .git, and npm-mode update. Throwaway HOMEs, npm prefixes, caches
and admin roots only; never a registry, never a real configuration, never sudo.

    python3 -B global/npm_package_test.py

An npm install from GitHub downloads the source archive GitHub builds with git archive. These tests
build the same thing locally: this working tree's files, with .workstation-archive as `git archive
HEAD` fills it in, then npm pack and npm install -g of that directory into a throwaway prefix.
Needs node and git; the install class also needs npm, jq and a POSIX sh (skipped without them).
"""
import io
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
GIT = shutil.which("git")
POSIX_JQ = os.name == "posix" and bool(shutil.which("jq"))
GLOB = "v[0-9]*.[0-9]*.[0-9]*"


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT)] + list(args), capture_output=True, text=True)


def expected_stamp():
    """install.sh's rule for HEAD, as an archive of HEAD (never dirty) must reproduce it."""
    commit = git("rev-parse", "HEAD").stdout.strip()
    exact = git("describe", "--tags", "--exact-match", "--match", GLOB, "HEAD")
    near = git("describe", "--tags", "--abbrev=0", "--match", GLOB, "HEAD")
    if exact.returncode == 0:
        release = exact.stdout.strip()
    elif near.returncode == 0:
        release = "unreleased, after " + near.stdout.strip()
    else:
        release = "unreleased, no tag reachable"
    return "release: %s; commit: %s" % (release, commit)


def archive_text():
    """.workstation-archive exactly as git archive (and so GitHub) writes it for HEAD."""
    raw = subprocess.run(["git", "-C", str(ROOT), "archive", "--format=tar", "HEAD", ".workstation-archive"],
                         capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        return t.extractfile(".workstation-archive").read().decode()


def source_tree(dest, archive=None):
    """This working tree's tracked and new files (what GitHub would archive once committed)."""
    listed = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                            capture_output=True, check=True).stdout.decode().split("\0")
    for rel in filter(None, listed):
        if (ROOT / rel).is_file():
            (dest / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / rel, dest / rel)
    if archive is not None:
        (dest / ".workstation-archive").write_text(archive, encoding="utf-8")
    return dest


def source_line(root, env):
    p = subprocess.run(["sh", str(root / "global" / "install.sh"), "--check", "--overlay=none"], env=env,
                       capture_output=True, text=True)
    return re.search(r"(?m)^SOURCE  (.*)$", p.stdout).group(1)


def write_exe(path, text):
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="npm-package-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(os.path.realpath(self.temp.name))

    def env(self, name):
        d = self.base / name
        for sub in ("home", "root", "tmp", "proj"):
            (d / sub).mkdir(parents=True)
        return d, {"PATH": str(d / "prefix" / "bin") + os.pathsep + os.environ["PATH"], "HOME": str(d / "home"),
                   "TMPDIR": str(d / "tmp"), "WORKSTATION_MANAGED_ROOT": str(d / "root"),
                   "npm_config_cache": str(self.base / "cache"), "npm_config_prefix": str(d / "prefix"),
                   "npm_config_userconfig": str(d / "npmrc"), "npm_config_update_notifier": "false",
                   "npm_config_audit": "false", "npm_config_fund": "false"}


@unittest.skipUnless(NODE, "needs node")
class Launcher(Base):
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
            p = subprocess.run([NODE, "-e", "const l=require(%s); const r=l.updateLines(%s, l.ROOT); "
                                "process.stdout.write(JSON.stringify([r.code, r.out || [r.err]]))"
                                % (json.dumps(str(ROOT / "bin" / "workstation.js")),
                                   "undefined" if wanted is None else json.dumps(wanted))],
                               capture_output=True, text=True, check=True)
            code, lines = ws.npm_update_lines(wanted)
            self.assertEqual(json.loads(p.stdout), [code, lines], wanted)
        _, lines = ws.npm_update_lines(None)
        major = re.search(r'^current_version\s*=\s*"(\d+\.\d+\.\d+)"',
                          (ROOT / ".bumpversion.toml").read_text(encoding="utf-8"), re.M).group(1)
        self.assertEqual(lines[1], "RUN     npm install -g github:%s#semver:^%s" % (ws.REPO, major))
        self.assertEqual(ws.npm_update_lines("main")[0], 2)

    def test_package_json(self):
        # bump-my-version rewrites package.json in the same commit (.bumpversion.toml files entry).
        toml = (ROOT / ".bumpversion.toml").read_text(encoding="utf-8")
        version = re.search(r'^current_version\s*=\s*"([^"]+)"', toml, re.M).group(1)
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], version)
        self.assertIn('filename = "package.json"', toml)
        self.assertIs(package["private"], True)
        self.assertEqual(package["bin"], {"workstation": "bin/workstation.js"})
        self.assertNotIn("dependencies", package)
        # Any lifecycle script makes npm 11 run an inner install that leaves a global git install as a
        # dangling link into its cache (measured); the package must carry none.
        self.assertNotIn("scripts", package)


@unittest.skipUnless(GIT and POSIX_JQ, "needs git, jq and a POSIX sh")
class ArchiveStamp(Base):
    def test_archive_is_substituted_and_matches_install_sh(self):
        text = archive_text()
        self.assertNotIn("$Format", text)
        tree = source_tree(self.base / "src", text)
        _, env = self.env("e")
        self.assertEqual(source_line(tree, env), expected_stamp())

    def test_describe_forms(self):
        tree = source_tree(self.base / "src")
        _, env = self.env("e")
        sha = "0123456789abcdef0123456789abcdef01234567"
        cases = [("v4.1.0", "release: v4.1.0"), ("v4.1.0-12-g0123456", "release: unreleased, after v4.1.0"),
                 ("", "release: unreleased, no tag reachable")]
        for describe, release in cases:
            (tree / ".workstation-archive").write_text("commit: %s\ndescribe: %s\n" % (sha, describe))
            self.assertEqual(source_line(tree, env), "%s; commit: %s" % (release, sha), describe)
        unknown = "release: unknown, not a git checkout (.bumpversion.toml says "
        for bad in ("commit: $Format:%H$\ndescribe: $Format:%(describe)$\n",
                    "commit: %s\ndescribe: v4.1.0-rc1\n" % sha,
                    "commit: %s\ndescribe: v4.1.0; commit: x\n" % sha,
                    "commit: %s\ndescribe: v4.1.0\n" % sha[:39]):
            (tree / ".workstation-archive").write_text(bad)
            self.assertTrue(source_line(tree, env).startswith(unknown), bad)

    def test_inside_another_repository_keeps_its_own_stamp(self):
        outer = self.base / "outer"
        outer.mkdir()
        subprocess.run(["git", "init", "-q", str(outer)], check=True)
        subprocess.run(["git", "-C", str(outer), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                        "commit", "-q", "--allow-empty", "-m", "outer"], check=True)
        tree = source_tree(outer / "pkg", archive_text())
        _, env = self.env("e")
        self.assertEqual(source_line(tree, env), expected_stamp())


@unittest.skipUnless(NODE and NPM and GIT and POSIX_JQ, "needs node, npm, git, jq and a POSIX sh")
class PackAndInstall(Base):
    """npm pack of a source archive, npm install -g into a throwaway prefix, then the installed command."""

    def pack(self, tree):
        p = subprocess.run([NPM, "pack", "--pack-destination", str(self.base), "--cache", str(self.base / "cache")],
                           cwd=tree, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        return self.base / p.stdout.strip().splitlines()[-1]

    def test_files_allow_list(self):
        tree = source_tree(self.base / "src", archive_text())
        (tree / "overlay" / "mcp-servers.json").write_text("{}", encoding="utf-8")
        (tree / "overlay" / "x.local.json").write_text("{}", encoding="utf-8")
        with tarfile.open(self.pack(tree)) as t:
            names = {n[len("package/"):] for n in t.getnames()}
        for needed in ("workstation", ".bumpversion.toml", ".workstation-archive", "bin/workstation.js",
                       "global/workstation.py", "global/install.sh", "global/install-managed.sh",
                       "global/install.ps1", "global/AGENTS.md", "global/deny-floor.conf", "overlay/profile.json",
                       "package.json"):
            self.assertIn(needed, names)
        self.assertFalse([n for n in names if n.endswith(("_test.py", ".test.sh", ".test.ps1", ".test.stub"))])
        self.assertFalse([n for n in names if n.startswith(("docs/", "workspace/", ".github/", ".git/"))])
        # A local overlay MCP definition (untracked, ADR-0017) must never ride into a package.
        self.assertNotIn("overlay/mcp-servers.json", names)
        self.assertNotIn("overlay/x.local.json", names)

    def test_global_install_then_workstation(self):
        tgz = self.pack(source_tree(self.base / "src", archive_text()))
        d, env = self.env("e2e")
        p = subprocess.run([NPM, "install", "-g", "--offline", str(tgz)], env=env, cwd=d, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        pkg = d / "prefix" / "lib" / "node_modules" / ws.NAME
        self.assertFalse(pkg.is_symlink())
        self.assertFalse((pkg / ".git").exists())
        stamp = expected_stamp()
        p = subprocess.run(["workstation", "install", "--overlay=none"], env=env, cwd=d / "proj",
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("CHECK   every user-level target matches this checkout", p.stdout)
        marker = (d / "home" / ".claude" / "CLAUDE.md").read_text(encoding="utf-8").splitlines()[0]
        self.assertIn("; %s;" % stamp, marker)
        p = subprocess.run(["workstation", "status", "--overlay=none", "--project=" + str(d / "proj")],
                           env=env, cwd=d / "proj", capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("  source           %s (this checkout)" % ws.short_stamp(stamp), p.stdout)
        p = subprocess.run(["workstation", "update"], env=env, cwd=d / "proj", capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("RUN     npm install -g github:%s#semver:^" % ws.REPO, p.stdout)
        p = subprocess.run(["workstation", "update", "main"], env=env, cwd=d / "proj", capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertFalse((pkg / ".git").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
