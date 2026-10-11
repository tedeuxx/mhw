#!/usr/bin/env python3
"""Tests for private_copy, the helper behind every .pmhwc-*backup (Issue #145): one Python form,
global/private_copy.py, used by the four Python steps, and one shell form in install.sh (which needs no python3,
so it cannot call the Python one). Both forms run on the same cases, in a throwaway directory, and must give the
same result: the bytes copied, mode 0600 whatever the source's mode, whatever was at the destination unlinked
first and never written through, and a link planted at the destination after the unlink refused.

    private_copy_test.py [base directory]   (default: a fresh directory under $TMPDIR)
"""
import ast
import importlib.util
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTALL_SH = HERE / "install.sh"
SHARED = HERE / "private_copy.py"
USERS = ("kiro/kiro_permissions.py", "mcp/mcp_render.py", "mcp/mcp_retire.py", "models/model_defaults.py")
_ROOT = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else None
if _ROOT is not None:
    _ROOT.mkdir(parents=True, exist_ok=True)
BASE = Path(tempfile.mkdtemp(prefix="private-copy-test.", dir=str(_ROOT) if _ROOT else None))
sys.path.insert(0, str(HERE))
import private_copy as shared  # noqa: E402


def shell_form():
    """The private_copy function, as install.sh defines it (the text between its header and the closing brace)."""
    text = INSTALL_SH.read_text(encoding="utf-8")
    m = re.search(r"^private_copy\(\) \{\n.*?^\}\n", text, re.M | re.S)
    if not m:
        raise AssertionError("install.sh defines no private_copy() function")
    return m.group(0)


def run_shell(src, dst, prelude=""):
    script = shell_form() + prelude + 'private_copy "$1" "$2"\n'
    return subprocess.run(["sh", "-c", script, "sh", str(src), str(dst)], capture_output=True, text=True)


def run_python(src, dst):
    try:
        shared.private_copy(str(src), str(dst))
        return 0
    except OSError:
        return 1


def mode(p):
    return stat.S_IMODE(os.lstat(str(p)).st_mode)


class Case:
    """One fixture: a source and whatever sits at the destination. The outcome is everything a form can
    change: the destination (kind, mode, bytes) and every other file in the directory."""
    n = 0

    def __init__(self, src_bytes=b"rules: [mine]\n\xff\x00 not utf-8\n", src_mode=0o644, at_dst=None):
        Case.n += 1
        self.dir = BASE / ("case-%d" % Case.n)
        self.dir.mkdir()
        self.src = self.dir / "settings.json"
        self.src.write_bytes(src_bytes)
        os.chmod(str(self.src), src_mode)
        self.dst = self.dir / "settings.json.pmhwc-backup"
        self.victim = self.dir / "victim"
        if at_dst == "file":
            self.dst.write_bytes(b"an older backup\n")
            os.chmod(str(self.dst), 0o644)
        elif at_dst == "readonly":
            self.dst.write_bytes(b"an older backup\n")
            os.chmod(str(self.dst), 0o400)
        elif at_dst == "hardlink":
            self.victim.write_bytes(b"the other name of the same file\n")
            os.link(str(self.victim), str(self.dst))
        elif at_dst == "symlink":
            self.victim.write_bytes(b"a file the link points at\n")
            os.symlink("victim", str(self.dst))  # relative: both cases read back the same
        elif at_dst == "dangling":
            os.symlink("victim", str(self.dst))  # relative: both cases read back the same

    def outcome(self, code):
        files = {}
        for p in sorted(self.dir.iterdir()):
            kind = "link" if p.is_symlink() else "file"
            files[p.name] = (kind, mode(p), p.read_bytes() if kind == "file" else os.readlink(str(p)))
        return code, files


class SameBehaviour(unittest.TestCase):
    CASES = {
        "nothing at the destination": {},
        "a 0600 empty source": {"src_bytes": b"", "src_mode": 0o600},
        "a 0444 source": {"src_mode": 0o444},
        "an older backup": {"at_dst": "file"},
        "a read-only older backup": {"at_dst": "readonly"},
        "a hard link at the destination": {"at_dst": "hardlink"},
        "a symbolic link at the destination": {"at_dst": "symlink"},
        "a dangling symbolic link at the destination": {"at_dst": "dangling"},
    }

    def test_both_forms_give_the_same_result(self):
        for name, kw in self.CASES.items():
            with self.subTest(name):
                py = Case(**kw)
                got_py = py.outcome(run_python(py.src, py.dst))
                sh = Case(**kw)
                p = run_shell(sh.src, sh.dst)
                got_sh = sh.outcome(p.returncode)
                self.assertEqual(got_py, got_sh, "%s: python and shell differ (shell stderr: %s)" % (name, p.stderr))
                code, files = got_py
                self.assertEqual(code, 0, name)
                kind, m, data = files[py.dst.name]
                self.assertEqual((kind, m, data), ("file", 0o600, py.src.read_bytes()), name)
                if kw.get("at_dst") in ("hardlink", "symlink"):
                    # unlink-before-create: the other name, or the link's target, keeps its own bytes
                    self.assertEqual(files["victim"][2], py.victim.read_bytes(), name)
                    self.assertNotEqual(files["victim"][2], py.src.read_bytes(), name)
                if kw.get("at_dst") == "dangling":
                    self.assertNotIn("victim", files, "the dangling link's target was created")

    def test_a_link_planted_after_the_unlink_is_refused_by_both(self):
        # The race the exclusive create guards against: something lands at the destination between the unlink
        # and the create. Simulated by making the unlink a no-op, with a link to a regular file at dst.
        py = Case(at_dst="symlink")
        real = os.path.lexists
        os.path.lexists = lambda p: False if str(p) == str(py.dst) else real(p)
        try:
            got_py = py.outcome(run_python(py.src, py.dst))
        finally:
            os.path.lexists = real
        sh = Case(at_dst="symlink")
        p = run_shell(sh.src, sh.dst, prelude="rm() { :; }\n")
        got_sh = sh.outcome(1 if p.returncode else 0)
        self.assertEqual(got_py, got_sh, "python and shell differ (shell stderr: %s)" % p.stderr)
        code, files = got_py
        self.assertEqual(code, 1)
        self.assertEqual(files["victim"][2], b"a file the link points at\n")
        self.assertEqual(files[py.dst.name][0], "link")

    def test_the_python_form_opens_exclusively_and_without_following_a_link(self):
        seen = []
        real = os.open

        def spy(path, flags, *a):
            seen.append(flags)
            return real(path, flags, *a)
        c = Case()
        os.open = spy
        try:
            shared.private_copy(str(c.src), str(c.dst))
        finally:
            os.open = real
        want = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        self.assertEqual(seen, [want])


class OneForm(unittest.TestCase):
    def test_no_python_file_defines_its_own_copy(self):
        own = []
        for p in sorted(HERE.rglob("*.py")):
            if p == SHARED or p.name.endswith("_test.py"):
                continue
            tree = ast.parse(p.read_text(encoding="utf-8"))
            if any(isinstance(n, ast.FunctionDef) and n.name == "private_copy" for n in ast.walk(tree)):
                own.append(str(p.relative_to(HERE)))
        self.assertEqual(own, [])

    def test_each_python_step_uses_the_shared_form(self):
        for rel in USERS:
            with self.subTest(rel):
                spec = importlib.util.spec_from_file_location("pc_user_" + rel.replace("/", "_")[:-3], HERE / rel)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                self.assertIs(mod.private_copy, shared.private_copy)

    def test_one_shell_form(self):
        hits = []
        for p in sorted(list(HERE.glob("*.sh")) + [HERE.parent / "mhw"]):
            if p.name.endswith(".test.sh") or not p.is_file():
                continue
            if re.search(r"^\s*private_copy\(\)", p.read_text(encoding="utf-8"), re.M):
                hits.append(p.name)
        self.assertEqual(hits, ["install.sh"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
