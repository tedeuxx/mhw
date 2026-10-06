#!/usr/bin/env python3
"""Regression tests for the npm package mhw (Issue #68, ADR-0034): the mhw launcher and its deprecated
workstation alias, the postinstall that installs the user layer, the archive provenance stamp read when
there is no .git, npm-mode status and update. Throwaway HOMEs, npm prefixes, caches and admin roots
only; never a registry, never a real configuration, never sudo.

    python3 -B global/npm_package_test.py

An npm install from GitHub downloads the source archive GitHub builds with git archive. These tests
build the same thing locally: this working tree's files, with .workstation-archive as `git archive
HEAD` fills it in, then npm pack and npm install -g of that directory into a throwaway prefix. One test
installs through npm's git-dependency route (git+file://), which runs pacote's preparation step.
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
ALIAS = "`workstation` is renamed `mhw`; the alias will be removed in the next major"
LEGACY = "personal-multi-harness-workstation-configuration"


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


def node_eval(script):
    p = subprocess.run([NODE, "-e", script], capture_output=True, text=True)
    if p.returncode != 0:
        raise AssertionError(p.stderr)
    return json.loads(p.stdout)


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
                   "npm_config_audit": "false", "npm_config_fund": "false", "MHW_POSTINSTALL_TTY": "0"}


@unittest.skipUnless(NODE, "needs node")
class Launcher(Base):
    def run_bin(self, name, args, env=None, cwd=None):
        p = subprocess.run([str(ROOT / "bin" / name)] + list(args), env=env, cwd=cwd or self.base,
                           capture_output=True, text=True)
        return p.returncode, p.stdout, p.stderr

    @unittest.skipUnless(os.name == "posix", "needs a POSIX sh")
    def test_posix_resolves_the_package_not_the_cwd(self):
        # npm puts a symlink on PATH; the launcher must find ./mhw beside its real file even when called
        # through that link from an unrelated directory.
        (self.base / "bin").mkdir()
        (self.base / "elsewhere").mkdir()
        link = self.base / "bin" / "mhw"
        link.symlink_to(ROOT / "bin" / "mhw.js")
        p = subprocess.run([str(link), "--help"], cwd=self.base / "elsewhere", capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("./mhw install --admin", p.stdout)
        self.assertEqual(p.stderr, "")
        p = subprocess.run([str(link), "no-such-subcommand"], cwd=self.base / "elsewhere",
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)
        self.assertIn("mhw: unknown subcommand no-such-subcommand", p.stderr)

    @unittest.skipUnless(os.name == "posix", "needs a POSIX sh")
    def test_both_names_resolve_and_the_alias_prints_one_line(self):
        # The npm bin and the repository entry point: workstation behaves exactly as mhw, plus one notice
        # on stderr and nothing else.
        for args in (["--help"], ["no-such-subcommand"], ["update", "main"]):
            with self.subTest(args=args):
                code, out, err = self.run_bin("mhw.js", args)
                acode, aout, aerr = self.run_bin("workstation.js", args)
                self.assertEqual((acode, aout), (code, out))
                self.assertEqual(aerr, ALIAS + "\n" + err)
                p = subprocess.run(["sh", str(ROOT / "mhw")] + args, capture_output=True, text=True)
                q = subprocess.run(["sh", str(ROOT / "workstation")] + args, capture_output=True, text=True)
                self.assertEqual((q.returncode, q.stdout), (p.returncode, p.stdout))
                self.assertEqual(q.stderr, ALIAS + "\n" + p.stderr)
                self.assertNotIn("renamed", err + p.stderr)

    @unittest.skipUnless(os.name == "posix", "the PowerShell stub is a POSIX script")
    def test_windows_mapping_onto_install_ps1(self):
        stub = self.base / "ps"
        write_exe(stub, "#!/bin/sh\nfor a in \"$@\"; do printf '%s\\n' \"$a\"; done\n")
        env = dict(os.environ, WORKSTATION_LAUNCHER_PLATFORM="win32", WORKSTATION_POWERSHELL=str(stub))
        ps1 = str(ROOT / "global" / "install.ps1")
        base = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1]

        def run(*args, name="mhw.js"):
            code, out, err = self.run_bin(name, args, env=env)
            return code, out.splitlines(), err

        self.assertEqual(run("install"), (0, base, ""))
        self.assertEqual(run("install", "--method", "--overlay=none"),
                         (0, base + ["-Method", "-Overlay", "none"], ""))
        self.assertEqual(run("check"), (0, base + ["-Check"], ""))
        self.assertEqual(run("status"), (0, base + ["-Check"], ""))
        self.assertEqual(run("status", name="workstation.js"), (0, base + ["-Check"], ALIAS + "\n"))
        for args in (("install", "--admin"), ("uninstall",), ("check", "--method"), ("install", "--overlay=")):
            code, out, err = run(*args)
            self.assertEqual((code, out), (2, []), args)
            self.assertTrue(err.startswith("mhw: "), err)
        code, out, _ = run("update", "v4.2.0")
        self.assertEqual(code, 0)
        self.assertIn("RUN     npm install -g --foreground-scripts github:%s#v4.2.0" % ws.REPO, out)

    def test_update_text_is_the_same_in_node_and_python(self):
        for wanted in (None, "v4.2.0", "v10.0.3", "4.2.0", "v4.2", "main", "v4.2.0;x"):
            r = node_eval("const l=require(%s); const r=l.updateLines(%s, l.ROOT); "
                          "process.stdout.write(JSON.stringify([r.code, r.out || [r.err]]))"
                          % (json.dumps(str(ROOT / "bin" / "mhw.js")),
                             "undefined" if wanted is None else json.dumps(wanted)))
            code, lines = ws.npm_update_lines(wanted)
            self.assertEqual(r, [code, lines], wanted)
        _, lines = ws.npm_update_lines(None)
        major = re.search(r'^current_version\s*=\s*"(\d+\.\d+\.\d+)"',
                          (ROOT / ".bumpversion.toml").read_text(encoding="utf-8"), re.M).group(1)
        self.assertEqual(lines[-1], "RUN     npm install -g --foreground-scripts github:%s#semver:^%s" % (ws.REPO, major))
        self.assertEqual(ws.npm_update_lines("main")[0], 2)

    def test_package_json(self):
        # bump-my-version rewrites package.json in the same commit (.bumpversion.toml files entry).
        toml = (ROOT / ".bumpversion.toml").read_text(encoding="utf-8")
        version = re.search(r'^current_version\s*=\s*"([^"]+)"', toml, re.M).group(1)
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], version)
        self.assertIn('filename = "package.json"', toml)
        self.assertIs(package["private"], True)
        self.assertEqual(package["name"], "mhw")
        self.assertEqual(package["description"], "multi-harness managed workstation")
        self.assertEqual(package["bin"], {"mhw": "bin/mhw.js", "workstation": "bin/workstation.js"})
        self.assertNotIn("dependencies", package)
        # One lifecycle script. Any script makes npm 11 prepare a git install in a temporary clone that
        # it links into the global prefix (measured); bin/postinstall.js undoes that link (Prepare).
        self.assertEqual(package["scripts"], {"postinstall": "node bin/postinstall.js"})


@unittest.skipUnless(NODE, "needs node")
class Postinstall(Base):
    """bin/postinstall.js's decisions, without npm."""

    def decide(self, env, root, platform="darwin"):
        return node_eval("const p=require(%s); process.stdout.write(JSON.stringify(p.decide(%s, %s, %s, 'mhw')))"
                         % (json.dumps(str(ROOT / "bin" / "postinstall.js")), json.dumps(env),
                            json.dumps(platform), json.dumps(str(root))))["action"]

    def test_decide(self):
        prefix = self.base / "prefix"
        installed = prefix / "lib" / "node_modules" / "mhw"
        installed.mkdir(parents=True)
        clone = self.base / "cache" / "_cacache" / "tmp" / "git-clone1"
        clone.mkdir(parents=True)
        glob = {"npm_config_global": "true", "npm_config_prefix": str(prefix)}
        self.assertEqual(self.decide(glob, installed), "install")
        self.assertEqual(self.decide({"npm_config_global": "true"}, installed), "install")
        self.assertEqual(self.decide(dict(glob, _PACOTE_NO_PREPARE_="git+file://x"), clone), "prepare")
        self.assertEqual(self.decide(dict(glob, _PACOTE_NO_PREPARE_=""), installed), "prepare")
        # Not global: a local dependency, CI, npm ci.
        self.assertEqual(self.decide({}, installed), "skip")
        self.assertEqual(self.decide({"npm_config_global": "false", "CI": "true"}, installed), "skip")
        # Global, but this copy is not the installed package.
        self.assertEqual(self.decide(glob, clone), "skip")
        other = self.base / "other" / "node_modules" / "mhw"
        other.mkdir(parents=True)
        self.assertEqual(self.decide(glob, other), "skip")

    def undo(self, env, root, platform="darwin"):
        return node_eval("const p=require(%s); process.stdout.write(JSON.stringify(p.undoPrepareLink(%s, %s, %s, 'mhw')))"
                         % (json.dumps(str(ROOT / "bin" / "postinstall.js")), json.dumps(env),
                            json.dumps(platform), json.dumps(str(root))))

    @unittest.skipUnless(os.name == "posix", "symlinks")
    def test_undo_prepare_link(self):
        prefix = self.base / "prefix"
        modules = prefix / "lib" / "node_modules"
        modules.mkdir(parents=True)
        clone = self.base / "clone"
        clone.mkdir()
        (clone / "keep").write_text("x")
        env = {"npm_config_global": "true", "npm_config_prefix": str(prefix)}
        link = modules / "mhw"
        link.symlink_to(clone)
        self.assertIn("replaced the link", self.undo(env, clone))
        self.assertTrue(link.is_dir() and not link.is_symlink())
        self.assertEqual(list(link.iterdir()), [])
        self.assertTrue((clone / "keep").is_file())
        # A real directory, a link elsewhere, no global flag: untouched.
        self.assertIn("untouched", self.undo(env, clone))
        link.rmdir()
        elsewhere = self.base / "elsewhere"
        elsewhere.mkdir()
        link.symlink_to(elsewhere)
        self.assertIn("untouched", self.undo(env, clone))
        self.assertTrue(link.is_symlink())
        link.unlink()
        link.symlink_to(clone)
        self.assertIn("not global", self.undo({"npm_config_prefix": str(prefix)}, clone))
        self.assertTrue(link.is_symlink())


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
    """npm pack of a source archive, npm install -g into a throwaway prefix: the postinstall installs."""

    def pack(self, tree):
        p = subprocess.run([NPM, "pack", "--pack-destination", str(self.base), "--cache", str(self.base / "cache")],
                           cwd=tree, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        return self.base / p.stdout.strip().splitlines()[-1]

    def npm(self, d, env, *args):
        return subprocess.run([NPM] + list(args), env=env, cwd=d, capture_output=True, text=True)

    def cmd(self, d, env, *args):
        return subprocess.run(list(args), env=env, cwd=d / "proj", capture_output=True, text=True)

    def brief(self, d):
        path = d / "home" / ".claude" / "CLAUDE.md"
        return path.read_text(encoding="utf-8").splitlines()[0] if path.is_file() else None

    def test_files_allow_list(self):
        tree = source_tree(self.base / "src", archive_text())
        (tree / "overlay" / "mcp-servers.json").write_text("{}", encoding="utf-8")
        (tree / "overlay" / "x.local.json").write_text("{}", encoding="utf-8")
        with tarfile.open(self.pack(tree)) as t:
            names = {n[len("package/"):] for n in t.getnames()}
        for needed in ("mhw", "workstation", ".bumpversion.toml", ".workstation-archive", "bin/mhw.js",
                       "bin/workstation.js", "bin/postinstall.js",
                       "global/workstation.py", "global/install.sh", "global/install-managed.sh",
                       "global/install.ps1", "global/AGENTS.md", "global/deny-floor.conf", "overlay/profile.json",
                       "package.json"):
            self.assertIn(needed, names)
        self.assertFalse([n for n in names if n.endswith(("_test.py", ".test.sh", ".test.ps1", ".test.stub"))])
        self.assertFalse([n for n in names if n.startswith(("docs/", "workspace/", ".github/", ".git/"))])
        # A local overlay MCP definition (untracked, ADR-0017) must never ride into a package.
        self.assertNotIn("overlay/mcp-servers.json", names)
        self.assertNotIn("overlay/x.local.json", names)

    def test_global_install_runs_the_postinstall(self):
        tgz = self.pack(source_tree(self.base / "src", archive_text()))
        d, env = self.env("e2e")
        p = self.npm(d, env, "install", "-g", "--offline", "--foreground-scripts", str(tgz))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        pkg = d / "prefix" / "lib" / "node_modules" / "mhw"
        self.assertFalse(pkg.is_symlink())
        self.assertFalse((pkg / ".git").exists())
        stamp = expected_stamp()
        # No `mhw install`: the postinstall rendered the user layer, then printed the three things.
        self.assertIn("; %s;" % stamp, self.brief(d))
        out = p.stdout
        self.assertIn("MHW     npm postinstall: mhw install\n", out)
        self.assertRegex(out, r"(?m)^ADMIN   not installed; the one sudo line below installs it$")
        self.assertRegex(out, r'(?m)^RUN     sudo /bin/sh ".*/lib/node_modules/mhw/global/install-managed.sh" --apply=')
        self.assertRegex(out, r"(?m)^THEN    open fresh agent harness sessions")
        self.assertRegex(out, r"(?m)^Runtime summary \(mhw status --summary; detail: mhw status --verbose\)$")
        self.assertNotIn("sudo -", out)
        self.assertEqual(list((d / "root").iterdir()), [])  # the admin root: nothing written there
        # Idempotent: a second run of the same package changes nothing and still exits 0.
        before = (d / "home" / ".claude" / "CLAUDE.md").read_bytes()
        p = self.npm(d, env, "install", "-g", "--offline", str(tgz))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual((d / "home" / ".claude" / "CLAUDE.md").read_bytes(), before)
        p = self.cmd(d, env, "mhw", "status", "--project=" + str(d / "proj"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("  source           %s (this package)" % ws.short_stamp(stamp), p.stdout)
        self.assertNotIn(ws.NOT_RUN, p.stdout)
        self.assertNotIn("  npm  ", p.stdout)
        # A missed postinstall output: status repeats the admin step.
        self.assertIn("  admin layer      not installed; next: mhw install --admin, then run the one sudo line "
                      "it prints", p.stdout)
        q = self.cmd(d, env, "workstation", "status", "--project=" + str(d / "proj"))
        self.assertEqual((q.returncode, q.stderr), (0, ALIAS + "\n"))
        self.assertIn("  source           %s (this package)" % ws.short_stamp(stamp), q.stdout)
        p = self.cmd(d, env, "mhw", "update")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("RUN     npm install -g --foreground-scripts github:%s#semver:^" % ws.REPO, p.stdout)
        p = self.cmd(d, env, "mhw", "update", "main")
        self.assertEqual(p.returncode, 2)
        # mhw uninstall first (npm runs no uninstall script), then npm uninstall -g mhw.
        p = self.cmd(d, env, "mhw", "uninstall")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("THEN    npm uninstall -g mhw", p.stdout)
        self.assertIsNone(self.brief(d))
        p = self.npm(d, env, "uninstall", "-g", "mhw")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertFalse(pkg.exists())

    def test_npm_uninstall_runs_no_script(self):
        # Measured npm behaviour this design rests on: npm uninstall -g runs no lifecycle script, so the
        # user layer stays until `mhw uninstall` removes it (the documented order).
        tgz = self.pack(source_tree(self.base / "src", archive_text()))
        d, env = self.env("un")
        self.assertEqual(self.npm(d, env, "install", "-g", "--offline", str(tgz)).returncode, 0)
        self.assertIsNotNone(self.brief(d))
        p = self.npm(d, env, "uninstall", "-g", "mhw")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertFalse((d / "prefix" / "lib" / "node_modules" / "mhw").exists())
        self.assertIsNotNone(self.brief(d))

    def test_ignore_scripts_is_reported_by_status_and_check(self):
        tgz = self.pack(source_tree(self.base / "src", archive_text()))
        d, env = self.env("ign")
        p = self.npm(d, env, "install", "-g", "--offline", "--ignore-scripts", str(tgz))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIsNone(self.brief(d))
        p = self.cmd(d, env, "mhw", "status", "--project=" + str(d / "proj"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertRegex(p.stdout, r"(?m)^  npm              installed by npm but postinstall did not run: .*"
                                   r"the user layer carries nothing; run mhw install$")
        p = self.cmd(d, env, "mhw", "check")
        self.assertNotEqual(p.returncode, 0)
        self.assertRegex(p.stdout, r"(?m)^NPM     installed by npm but postinstall did not run")
        p = self.cmd(d, env, "mhw", "install")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        p = self.cmd(d, env, "mhw", "status", "--project=" + str(d / "proj"))
        self.assertNotIn(ws.NOT_RUN, p.stdout)

    def test_local_dependency_skips_the_postinstall(self):
        tgz = self.pack(source_tree(self.base / "src", archive_text()))
        d, env = self.env("local")
        (d / "proj" / "package.json").write_text('{"name":"consumer","version":"1.0.0","private":true}\n')
        p = subprocess.run([NPM, "install", "--offline", "--foreground-scripts", str(tgz)], env=env,
                           cwd=d / "proj", capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("mhw postinstall: SKIP not a global install", p.stdout)
        self.assertFalse((d / "home" / ".claude").exists())
        self.assertFalse((d / "home" / ".codex").exists())

    def test_git_dependency_preparation(self):
        # The github: route goes through pacote's git preparation, which runs an inner install in a
        # temporary clone and (with --global inherited) links that clone into the prefix. Without the
        # postinstall's undo the outer install unpacks through the link and fails (measured, npm 11.13.0).
        src = source_tree(self.base / "gitsrc", archive_text())
        subprocess.run(["git", "init", "-q", str(src)], check=True)
        subprocess.run(["git", "-C", str(src), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(src), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                        "commit", "-q", "-m", "src"], check=True)
        d, env = self.env("git")
        p = self.npm(d, env, "install", "-g", "--foreground-scripts", "git+file://" + str(src))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        # The inner preparation run's own output is not shown (npm captures it), so its effect is asserted.
        pkg = d / "prefix" / "lib" / "node_modules" / "mhw"
        self.assertTrue(pkg.is_dir() and not pkg.is_symlink())
        self.assertTrue((pkg / "global" / "workstation.py").is_file())
        self.assertIn("; %s;" % expected_stamp(), self.brief(d))
        p = self.cmd(d, env, "mhw", "status", "--project=" + str(d / "proj"))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn(ws.NOT_RUN, p.stdout)

    def test_upgrade_from_the_package_before_the_rename(self):
        # v4.1.0 shipped as personal-multi-harness-workstation-configuration with the bin workstation.
        old = self.base / "old"
        old.mkdir()
        (old / "package.json").write_text(json.dumps({
            "name": LEGACY, "version": "4.1.0", "private": True, "bin": {"workstation": "bin/workstation.js"},
            "files": ["bin/"]}), encoding="utf-8")
        (old / "bin").mkdir()
        write_exe(old / "bin" / "workstation.js", "#!/usr/bin/env node\nconsole.log('old');\n")
        old_tgz = self.pack(old)
        tgz = self.pack(source_tree(self.base / "src", archive_text()))
        d, env = self.env("up")
        self.assertEqual(self.npm(d, env, "install", "-g", "--offline", str(old_tgz)).returncode, 0)
        # From a tarball, one step fails loudly and changes nothing: npm refuses to take over another
        # package's bin. (From GitHub it succeeds: the git preparation's inner install --force takes the
        # bin over and keeps the old package, measured with npm 11.13.0; the --force case below is that state.)
        p = self.npm(d, env, "install", "-g", "--offline", str(tgz))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("EEXIST", p.stdout + p.stderr)
        self.assertFalse((d / "prefix" / "lib" / "node_modules" / "mhw").exists())
        self.assertIsNone(self.brief(d))
        # Forced past it, both packages stay installed and status names the one to remove.
        p = self.npm(d, env, "install", "-g", "--offline", "--force", str(tgz))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        p = self.cmd(d, env, "mhw", "status", "--project=" + str(d / "proj"))
        self.assertIn("  npm              the v4.1.0 package (the name before mhw) is still installed beside mhw; "
                      "remove the v4.1.0 package first: `npm uninstall -g %s`, then run the npm line mhw update "
                      "prints" % LEGACY, p.stdout)
        # The docs carry the same instruction, word for word.
        for doc in ("README.md", "docs/runbooks/npm-install.md"):
            self.assertIn(ws.UPGRADE_FIRST, (ROOT / doc).read_text(encoding="utf-8"), doc)
        # The documented route: remove the old package, then install. The user layer is the new one's.
        d, env = self.env("up2")
        self.assertEqual(self.npm(d, env, "install", "-g", "--offline", str(old_tgz)).returncode, 0)
        self.assertEqual(self.npm(d, env, "uninstall", "-g", LEGACY).returncode, 0)
        p = self.npm(d, env, "install", "-g", "--offline", str(tgz))
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("; %s;" % expected_stamp(), self.brief(d))
        p = self.cmd(d, env, "workstation", "status", "--project=" + str(d / "proj"))
        self.assertEqual((p.returncode, p.stderr), (0, ALIAS + "\n"))
        self.assertNotIn("still installed beside mhw", p.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
