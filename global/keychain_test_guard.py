# Shared real-keychain guard for the paste-filter and MCP test suites (issue #58). TEST CODE ONLY: the
# installers never copy it. It is imported by global/clipboard/clipboard_guard_test.py and
# global/mcp/mcp_render_test.py.
#
# Rules, enforced on every subprocess the suite starts, BEFORE it runs:
#   - the real /usr/bin/security binary only with PMHWC_REAL_KEYCHAIN_TESTS=1 on GitHub Actions macOS (an
#     ephemeral runner; the variable is set in tests.yml only). Otherwise the suites use
#     global/security.test.stub, which never runs the real binary;
#   - with or without the opt-in: only a short list of verbs (no list-keychains, default-keychain,
#     login-keychain or any other search-list read or change), always against a keychain FILE under the
#     suite's base directory, and always under a throwaway HOME under that directory.
# Each suite adds its own checks (the MCP launcher, the paste-filter hook child) through `extra`.
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_SECURITY = "/usr/bin/security"
SECURITY_STUB = os.path.join(HERE, "security.test.stub")
STUB_NAME = os.path.basename(SECURITY_STUB)
OPT_IN_VAR = "PMHWC_REAL_KEYCHAIN_TESTS"
CALL_LOG_VAR = "PMHWC_SECURITY_CALL_LOG"
KEYCHAIN_PW = "throwaway-test-pw"
BASE_VERBS = frozenset({"create-keychain", "delete-keychain", "add-generic-password", "find-generic-password",
                        "delete-generic-password"})


class RealKeychainRefused(AssertionError):
    pass


def real_opt_in():
    """The real binary only on an ephemeral CI macOS runner, by explicit opt-in."""
    return (os.environ.get(OPT_IN_VAR) == "1" and os.environ.get("GITHUB_ACTIONS") == "true"
            and sys.platform == "darwin")


def _redact(s):
    return re.sub(r'(-w\s+)("[^"]*"|\S+)', r'\1<redacted>', s or "")


class Guard:
    """One guard per suite run. `real` is the opt-in in force; tests may flip it, and `exec` (what a
    vetted call finally runs), to probe the guard without executing anything."""

    def __init__(self, base, verbs=BASE_VERBS, inherit_home=False, extra=None, watched=(), words=("security",)):
        self.base = base
        self.verbs = frozenset(verbs)
        self.inherit_home = inherit_home      # True: a call with no env inherits this process's HOME
        self.extra = extra                    # extra(guard, argv, kw): suite-specific refusals
        self.watched = {"security", STUB_NAME} | set(watched)
        self.words = words
        self.real = real_opt_in()
        self.real_run, self.real_popen = subprocess.run, subprocess.Popen
        self.exec = self.real_run
        self.guarded_run = self._run
        self.popen_class = self._make_popen()

    @property
    def security(self):
        return REAL_SECURITY if self.real else SECURITY_STUB

    def under_base(self, p):
        if not p or not os.path.isabs(p):
            return False
        base = os.path.realpath(self.base)
        return os.path.commonpath([os.path.realpath(p), base]) == base

    def home_ok(self, kw=None):
        """The HOME a child runs under must be a throwaway one under the base directory."""
        env = (kw or {}).get("env")
        if env is None:
            if not self.inherit_home:
                return False
            env = os.environ
        return self.under_base(env.get("HOME", ""))

    def security_ok(self, args, stdin_text):
        """An allowed verb on a keychain FILE under the base directory; under -i, every stdin line."""
        if list(args) == ["-i"]:
            lines = [ln.strip() for ln in (stdin_text or "").splitlines() if ln.strip()]
            return bool(lines) and all(ln.split(" ", 1)[0] in self.verbs and ln.endswith('"')
                                       and self.under_base(ln[:-1].rsplit('"', 1)[-1]) for ln in lines)
        return bool(args) and args[0] in self.verbs and self.under_base(args[-1])

    def require_real(self, what):
        if not self.real:
            raise RealKeychainRefused("%s, without the CI opt-in %s=1" % (what, OPT_IN_VAR))

    def check(self, argv, stdin_text=None, kw=None):
        if isinstance(argv, (str, bytes)):
            text = os.fsdecode(argv)
            if any(w in text for w in self.words):
                raise RealKeychainRefused("a shell-string spawn names %s: refused unread" % "/".join(self.words))
            return
        if not argv:
            return
        argv = [os.fsdecode(a) for a in argv]
        name = os.path.basename(argv[0])
        if name == "security":
            self.require_real("the real security binary")
        if name in ("security", STUB_NAME) and not (self.home_ok(kw) and self.security_ok(argv[1:], stdin_text)):
            raise RealKeychainRefused("a test reached the real keychain: %r" % argv[:3])
        if self.extra:
            self.extra(self, argv, kw or {})

    def log(self, argv, stdin_text, kw):
        """Probe: with PMHWC_SECURITY_CALL_LOG set, record every vetted watched spawn (argv with -w
        values redacted, and its HOME). Off by default."""
        path = os.environ.get(CALL_LOG_VAR)
        if not path or isinstance(argv, (str, bytes)) or not argv:
            return
        argv = [os.fsdecode(a) for a in argv]
        if not any(os.path.basename(a) in self.watched for a in argv):
            return
        env = (kw or {}).get("env")
        with open(path, "a") as fh:
            fh.write(json.dumps({"argv": [_redact(a) for a in argv], "stdin": _redact(stdin_text),
                                 "home": (env if env is not None else os.environ).get("HOME", "")}) + "\n")

    def _run(self, *args, **kw):
        argv = args[0] if args else kw.get("args")
        data = kw.get("input")
        text = data.decode() if isinstance(data, bytes) else data
        self.check(argv, text, kw)
        self.log(argv, text, kw)
        return self.exec(*args, **kw)

    def _make_popen(self):
        guard = self

        class GuardedPopen(self.real_popen):
            def __init__(self, args, *a, **kw):
                name = "" if isinstance(args, (str, bytes)) or not args else os.path.basename(os.fsdecode(args[0]))
                if name in ("security", STUB_NAME) and list(args[1:]) == ["-i"]:
                    # stdin is visible only to the guarded run, which has vetted it; binary and HOME here
                    if name == "security":
                        guard.require_real("security -i")
                    if not guard.home_ok(kw):
                        raise RealKeychainRefused("security -i under the real HOME")
                else:
                    guard.check(args, None, kw)
                super().__init__(args, *a, **kw)
        return GuardedPopen

    def install(self):
        subprocess.run, subprocess.Popen = self.guarded_run, self.popen_class

    def installed(self):
        return subprocess.run is self.guarded_run and subprocess.Popen is self.popen_class

    def stub_run(self, argv, **kw):
        """`run` for production code under test: its /usr/bin/security goes to the stub unless opted in."""
        argv = list(argv)
        if argv and argv[0] == REAL_SECURITY and not self.real:
            argv[0] = SECURITY_STUB
        return subprocess.run(argv, **kw)

    def create_keychain(self, name, **kw):
        path = os.path.join(self.base, name + ".keychain-db")
        subprocess.run([self.security, "create-keychain", "-p", KEYCHAIN_PW, path], check=True,
                       capture_output=True, **kw)
        return path

    def delete_keychain(self, path, **kw):
        subprocess.run([self.security, "delete-keychain", path], capture_output=True, **kw)

    def refused_cases(self, kc, env_kw, outside_home_kw):
        """Calls the guard must refuse with or without the opt-in, for the real binary and the stub."""
        cases = []
        for sec in (REAL_SECURITY, SECURITY_STUB):
            cases += [
                ([sec, "find-generic-password", "-s", "svc", "-w"], env_kw),
                ([sec, "find-generic-password", "-s", "svc", "-w", kc], outside_home_kw),
                ([sec, "list-keychains"], env_kw), ([sec, "list-keychains", "-s", kc], env_kw),
                ([sec, "list-keychains", "-d", "user", "-s", kc], env_kw),
                ([sec, "default-keychain", "-s", kc], env_kw), ([sec, "login-keychain", "-s", kc], env_kw),
                ([sec, "create-keychain", "-p", "x", kc], outside_home_kw),
                ([sec, "-i"], dict(env_kw, input=('list-keychains -s "%s"\n' % kc).encode())),
                ([sec, "-i"], dict(env_kw, input=b'add-generic-password -s "s" -a "a" -w "v"\n')),
            ]
        cases.append(("security list-keychains", {"shell": True}))
        return cases

    def real_only_cases(self, kc, env_kw):
        """Valid throwaway calls that must still be refused for the REAL binary without the opt-in."""
        add = ('add-generic-password -s "s" -a "a" -w "v" "%s"\n' % kc).encode()
        return [([REAL_SECURITY, "find-generic-password", "-s", "svc", "-w", kc], env_kw),
                ([REAL_SECURITY, "create-keychain", "-p", "x", kc], env_kw),
                ([REAL_SECURITY, "-i"], dict(env_kw, input=add))]

    def assert_refused(self, test, cases, flag):
        """Run each case through the guard with `real` set to `flag`. `exec` must already refuse, so a
        case the guard lets through fails the test instead of executing."""
        self.real = flag
        for argv, kw in cases:
            with test.subTest(opt_in=flag, argv=argv):
                with test.assertRaises(RealKeychainRefused):
                    subprocess.run(argv, capture_output=True, **kw)

    def assert_mode(self, test):
        """Without the opt-in a run uses the stub; with it, the environment really carries the opt-in."""
        test.assertTrue(self.installed(), "the guard is not installed for this run")
        if self.real:
            test.assertTrue(real_opt_in(), "the real binary is enabled outside the CI opt-in")
        else:
            test.assertEqual(self.security, SECURITY_STUB, "without the opt-in, tests must use the stub")
