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
import signal
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTALL_SH = HERE / "install.sh"
SHARED = HERE / "private_copy.py"
USERS = ("kiro/kiro_permissions.py", "mcp/mcp_render.py", "models/model_defaults.py")
_ROOT = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else None
if _ROOT is not None:
    _ROOT.mkdir(parents=True, exist_ok=True)
BASE = Path(tempfile.mkdtemp(prefix="private-copy-test.", dir=str(_ROOT) if _ROOT else None))
sys.path.insert(0, str(HERE))
import private_copy as shared  # noqa: E402

UMASK = os.umask(0)  # this run's umask, so a shell plant (inside mktemp's umask 077) matches a Python one
os.umask(UMASK)


def shell_form():
    """The private_copy function, as install.sh defines it (the text between its header and the closing brace)."""
    text = INSTALL_SH.read_text(encoding="utf-8")
    m = re.search(r"^private_copy\(\) \{\n.*?^\}\n", text, re.M | re.S)
    if not m:
        raise AssertionError("install.sh defines no private_copy() function")
    return m.group(0)


def run_shell(src, dst, prelude=""):
    script = shell_form() + prelude + 'private_copy "$1" "$2"\n'
    # A timeout: a form that opened a FIFO for writing would block there forever.
    return subprocess.run(["sh", "-c", script, "sh", str(src), str(dst)], capture_output=True, text=True,
                          env=dict(os.environ, PC_DST=str(dst)), timeout=20)


def _blocked(signum, frame):
    raise AssertionError("the Python form blocked (it opened a FIFO for writing)")


def run_python(src, dst):
    old = signal.signal(signal.SIGALRM, _blocked)
    signal.alarm(20)
    try:
        shared.private_copy(str(src), str(dst))
        return 0
    except OSError:
        return 1
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


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
        elif at_dst == "fifo":
            os.mkfifo(str(self.dst), 0o644)
        elif at_dst == "link-to-fifo":
            os.mkfifo(str(self.victim), 0o644)
            os.symlink("victim", str(self.dst))
        elif at_dst == "link-to-device":
            os.symlink(os.devnull, str(self.dst))

    def outcome(self, code):
        files = {}
        for p in sorted(self.dir.iterdir()):
            if p.is_symlink():
                files[p.name] = ("link", mode(p), os.readlink(str(p)))
            elif stat.S_ISFIFO(os.lstat(str(p)).st_mode):
                files[p.name] = ("fifo", mode(p), b"")  # never opened here: that would block
            elif p.is_dir():
                files[p.name] = ("dir", mode(p), "|".join(sorted(x.name for x in p.iterdir())))
            else:
                files[p.name] = ("file", mode(p), p.read_bytes())
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
        "a FIFO at the destination": {"at_dst": "fifo"},
        "a symbolic link to a FIFO at the destination": {"at_dst": "link-to-fifo"},
        "a symbolic link to /dev/null at the destination": {"at_dst": "link-to-device"},
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
                if kw.get("at_dst") == "link-to-fifo":
                    self.assertEqual(files["victim"][0], "fifo", name)

    def test_anything_planted_after_the_unlink_is_refused_by_both(self):
        # The race the exclusive create guards against: something lands at the destination between the unlink
        # and the create. Simulated by making the unlink of the destination a no-op. Both forms must refuse and
        # leave what was planted exactly as it was (compared with an untouched copy of the fixture), so no byte
        # reaches a FIFO, a device or a link's target. A form that opened the FIFO would block: the shell run
        # has a timeout.
        for planted in ("symlink", "fifo", "link-to-fifo", "link-to-device", "file"):
            with self.subTest(planted):
                py = Case(at_dst=planted)
                real = os.path.lexists
                os.path.lexists = lambda p, d=str(py.dst): False if str(p) == d else real(p)
                try:
                    got_py = py.outcome(run_python(py.src, py.dst))
                finally:
                    os.path.lexists = real
                sh = Case(at_dst=planted)
                p = run_shell(sh.src, sh.dst,
                              prelude='rm() { case "$2" in "$PC_DST") return 0 ;; esac; command rm "$@"; }\n')
                got_sh = sh.outcome(1 if p.returncode else 0)
                self.assertEqual(got_py, got_sh, "%s: python and shell differ (shell stderr: %s)" % (planted, p.stderr))
                untouched = Case(at_dst=planted).outcome(1)
                self.assertEqual(got_py, untouched, planted)

    def test_anything_planted_between_the_check_and_the_create_is_refused_by_both(self):
        # The narrower race: the destination is absent when checked, and something lands there just before the
        # create (Python: inside the lexists check; shell: inside mktemp, after the absence check). The create
        # must be exclusive and never follow it: both refuse and the planted entry, and what it points at, stay.
        plants = {
            "a link to a FIFO": 'ln -s victim "$PC_DST"',
            "a link to /dev/null": 'ln -s /dev/null "$PC_DST"',
            "a link to a directory": 'ln -s victim-dir "$PC_DST"',
            "a FIFO": 'mkfifo "$PC_DST"',
            "a directory": 'mkdir "$PC_DST"',
        }
        for name, plant in plants.items():
            with self.subTest(name):
                results = []
                for form in ("python", "shell"):
                    c = Case()
                    os.mkfifo(str(c.victim), 0o644)
                    (c.dir / "victim-dir").mkdir()
                    if form == "python":
                        real = os.path.lexists

                        def planting(p, d=str(c.dst)):
                            if str(p) == d:
                                subprocess.run(["sh", "-c", plant], env=dict(os.environ, PC_DST=d), check=True,
                                               cwd=str(c.dir))
                                return False
                            return real(p)
                        os.path.lexists = planting
                        try:
                            code = run_python(c.src, c.dst)
                        finally:
                            os.path.lexists = real
                    else:
                        p = run_shell(c.src, c.dst,
                                      prelude='mktemp() { (umask %03o && cd "${PC_DST%%/*}" && %s); command mktemp "$@"; }\n'
                                      % (UMASK, plant))
                        code = 1 if p.returncode else 0
                    results.append(c.outcome(code))
                    self.assertEqual(sorted((c.dir / "victim-dir").iterdir()), [], "%s: written into the directory" % name)
                    if name == "a directory":
                        self.assertEqual(sorted(c.dst.iterdir()), [], "%s: written into the planted directory" % name)
                self.assertEqual(results[0], results[1], "%s: python and shell differ" % name)
                self.assertEqual(results[0][0], 1, name)

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
        want = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
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

    def test_a_planted_private_copy_earlier_on_the_path_never_replaces_the_real_one(self):
        # agents-lead lens on PR #151: each step puts global/ FIRST on sys.path, so a module named private_copy
        # on PYTHONPATH (which comes before site-packages too) cannot stand in for the confidentiality helper.
        fake = BASE / "planted-path"
        fake.mkdir(exist_ok=True)
        (fake / "private_copy.py").write_text("def private_copy(src, dst):\n    raise SystemExit('FAKE')\n",
                                              encoding="utf-8")
        probe = ("import importlib.util, sys\n"
                 "spec = importlib.util.spec_from_file_location('step', sys.argv[1])\n"
                 "m = importlib.util.module_from_spec(spec)\n"
                 "spec.loader.exec_module(m)\n"
                 "print(m.private_copy.__module__, sys.modules[m.private_copy.__module__].__file__)\n")
        for rel in USERS:
            with self.subTest(rel):
                p = subprocess.run([sys.executable, "-B", "-c", probe, str(HERE / rel)], capture_output=True, text=True,
                                   env=dict(os.environ, PYTHONPATH=str(fake)), cwd=str(fake))
                self.assertEqual(p.returncode, 0, p.stderr)
                self.assertEqual(Path(p.stdout.split()[-1]).resolve(), SHARED.resolve(), p.stdout)

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
