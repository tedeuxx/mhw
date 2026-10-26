#!/usr/bin/env python3
# Tests for mcp_render.py and mcp-launch.sh (ADR-0017). Everything runs under throwaway HOMEs:
#   python3 -B global/mcp/mcp_render_test.py <empty-or-new base directory>
# Every server, command and credential below is SYNTHETIC, and each credential value is generated at
# run time. Issue #58: by default the Keychain test runs against global/security.test.stub, which
# never runs the real `security` binary. The real binary is used ONLY when PMHWC_REAL_KEYCHAIN_TESTS=1
# on a GitHub Actions macOS runner (ephemeral; set in tests.yml). Without that opt-in, a guard installed
# for the whole run refuses any attempt to execute the real binary, before anything runs. Either way,
# each keychain is a THROWAWAY file under the base directory, named explicitly (--keychain), under a
# throwaway HOME.
# No test reads, prints or copies a real credential, and none touches the real HOME.
import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mcp_render as r  # noqa: E402
sys.path.insert(0, os.path.dirname(HERE))
import keychain_test_guard as kg  # noqa: E402

RENDER = os.path.join(HERE, "mcp_render.py")
LAUNCH = os.path.join(HERE, "mcp-launch.sh")
EXAMPLE = os.path.join(HERE, "mcp-servers.example.json")
SCHEMA = os.path.join(HERE, "mcp-servers.schema.json")
DARWIN = sys.platform == "darwin"
BASE = None
FAKE_SERVER = """import hashlib, os, sys
with open(sys.argv[1], "w") as fh:
    fh.write(hashlib.sha256(os.environ.get(sys.argv[2], "").encode()).hexdigest())
"""


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


def clean_env(home, **extra):
    drop = set(r.AGENT_ENV) | {"CODEX_HOME", "XDG_DATA_HOME", "APPDATA"}
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env["HOME"] = home
    env.update(extra)
    return env


def run(home, *args, env=None):
    return subprocess.run([sys.executable, "-B", RENDER] + list(args), env=env or clean_env(home),
                          capture_output=True, text=True)


def data(home):
    return os.path.join(home, ".local", "share", r.PROJECT)


def targets(home):
    t = {"codex": os.path.join(home, ".codex", "config.toml"),
         "claude-code": os.path.join(home, ".claude.json"),
         "kiro": os.path.join(home, ".kiro", "settings", "mcp.json")}
    if DARWIN:
        t["claude-desktop"] = os.path.join(home, "Library", "Application Support", "Claude",
                                           "claude_desktop_config.json")
    return t


def mk_home(name):
    h = os.path.join(BASE, name)
    shutil.rmtree(h, ignore_errors=True)
    for d in (".codex", ".claude", ".kiro"):
        os.makedirs(os.path.join(h, d))
    if DARWIN:
        os.makedirs(os.path.join(h, "Library", "Application Support", "Claude"))
    return h


def fake_server_path():
    p = os.path.join(BASE, "fake_server.py")
    with open(p, "w") as fh:
        fh.write(FAKE_SERVER)
    return p


def source_doc(extra=None):
    servers = {
        "fake-plain": {"command": "/bin/echo", "args": ["hello"], "env": {"FAKE_REGION": "zz-1"}},
        "fake-secret": {"command": sys.executable,
                        "args": [fake_server_path(), os.path.join(BASE, "out-env.txt"), "FAKE_API_TOKEN"],
                        "secrets": {"FAKE_API_TOKEN": "env:FAKE_SRC_VAR"}},
        "fake-codex-only": {"command": "/bin/cat", "surfaces": ["codex"]},
    }
    servers.update(extra or {})
    return {"version": 1, "servers": servers}


def write_source(home, doc):
    p = os.path.join(data(home), "local-overlay", "mcp-servers.json")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as fh:
        json.dump(doc, fh)
    return p


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def jload(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def tload(p):
    import tomllib
    with open(p, "rb") as fh:
        return tomllib.load(fh)


def fingerprint(home):
    out = {}
    for root, _, files in os.walk(home):
        for f in files:
            p = os.path.join(root, f)
            with open(p, "rb") as fh:
                out[p] = hashlib.sha256(fh.read()).hexdigest()
    return out


def all_bytes(home):
    blob = b""
    for root, _, files in os.walk(home):
        for f in files:
            with open(os.path.join(root, f), "rb") as fh:
                blob += fh.read()
    return blob


# ------------------------------------------------------------------------- real-keychain guard (#58)
# The shared guard (global/keychain_test_guard.py) holds the rules; this suite adds the launcher's.
KEYCHAIN_ARG = '${keychain:+"$keychain"}'
STUB_LAUNCHER = "mcp-launch.stub.sh"    # a test copy of the launcher whose `security` calls go to the stub
GUARD = None                            # set in __main__, once BASE is known


def _reads_keychain(rest):
    return any(a.startswith("keychain:") or "=keychain:" in a for a in rest)


def _launcher_ok(guard, rest):
    """A launcher run that reads the Keychain must name a throwaway keychain first."""
    if not _reads_keychain(rest):
        return True
    return rest[:1] == ["--keychain"] and len(rest) > 1 and guard.under_base(rest[1])


def launcher_check(guard, argv, kw):
    for i, a in enumerate(argv):
        b = os.path.basename(a)
        if b in ("mcp-launch.sh", STUB_LAUNCHER):
            rest = argv[i + 1:]
            if not (guard.home_ok(kw) and _launcher_ok(guard, rest)):
                raise kg.RealKeychainRefused("a launcher run could reach the real keychain")
            if b == "mcp-launch.sh" and _reads_keychain(rest):
                guard.require_real("the real launcher reading the Keychain")
            break


def make_guard(base):
    return kg.Guard(base, extra=launcher_check, watched=("mcp-launch.sh", STUB_LAUNCHER),
                    words=("security", "mcp-launch"))


def throwaway_keychain(home, name):
    return GUARD.create_keychain(name, env=clean_env(home))


def drop_keychain(home, path):
    GUARD.delete_keychain(path, env=clean_env(home))


def keychain_launcher(rendered, name):
    """The launcher a Keychain test runs. With the CI opt-in, the rendered launcher itself. Otherwise a
    copy whose /usr/bin/security calls go to the stub (the launcher names the binary by absolute path,
    so a stub on PATH alone would never be reached)."""
    if GUARD.real:
        return rendered
    d = os.path.join(BASE, "stub-launchers", name)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, STUB_LAUNCHER)
    with open(path, "w") as fh:
        fh.write(read(rendered).replace(kg.REAL_SECURITY, kg.SECURITY_STUB))
    os.chmod(path, 0o700)
    return path


class KeychainIsolation(unittest.TestCase):
    """The one guard against #58: without the CI opt-in no test may execute the real `security` binary,
    and with it no test may reach the login or default keychain or the search list. Nothing in this test
    executes a process; a broken guard makes it fail, never touch a keychain."""

    def test_no_test_path_can_reach_the_real_keychain(self):
        G = GUARD
        G.assert_mode(self)
        kc = os.path.join(BASE, "never-created.keychain-db")
        env = {"env": clean_env(os.path.join(BASE, "never-created-home"))}
        launcher = os.path.join(BASE, "x", "mcp-launch.sh")
        stub_launcher = os.path.join(BASE, "x", STUB_LAUNCHER)
        read_kc = ["--secret", "T=keychain:svc", "--", "true"]
        refused_always = G.refused_cases(kc, env, {})
        for lch in (launcher, stub_launcher):
            refused_always += [([lch] + read_kc, env), (["sh", "-x", lch, "--keychain", kc] + read_kc, {}),
                               ([lch, "--secret", "T=env:V", "--", "true"], {})]
        real_only = G.real_only_cases(kc, env) + [([launcher, "--keychain", kc] + read_kc, env)]
        allowed = [([kg.SECURITY_STUB, "find-generic-password", "-s", "svc", "-w", kc], env),
                   ([stub_launcher, "--keychain", kc] + read_kc, env)]
        calls = []
        saved = (G.exec, G.real)
        try:
            G.exec = lambda *a, **k: self.fail("the guard let a real-keychain call through: %r" % (a[:1],))
            G.assert_refused(self, refused_always + real_only, False)
            G.assert_refused(self, refused_always, True)
            G.exec = lambda argv, **kw: calls.append(argv) or subprocess.CompletedProcess(argv, 0, b"", b"")
            for flag, cases in ((False, allowed), (True, real_only)):
                G.real = flag
                for argv, kw in cases:
                    subprocess.run(argv, **kw)
        finally:
            G.exec, G.real = saved
        self.assertEqual(len(calls), 6, "the guard refused a throwaway-keychain call it must allow")
        # The production launcher must hand the --keychain path to EVERY `security` call it makes.
        code = [ln for ln in read(LAUNCH).splitlines() if not ln.lstrip().startswith("#")]
        reads = [ln for ln in code if re.search(r"/usr/bin/security\s+(-[A-Za-z]\b|[a-z]+-[a-z-]+)", ln)]
        self.assertEqual(len(reads), 2, "the launcher's security calls changed; re-check this guard")
        for ln in reads:
            self.assertIn(KEYCHAIN_ARG, ln, "a launcher security call ignores --keychain")


class Definition(unittest.TestCase):
    def test_example_is_valid_on_macos_and_refuses_keychain_elsewhere(self):
        doc = json.loads(read(EXAMPLE))
        self.assertEqual(r.validate(doc, "darwin"), [])
        errs = r.validate(doc, "linux")
        self.assertTrue(any("keychain: is macOS only" in e for e in errs), errs)

    def test_example_carries_no_real_looking_names(self):
        doc = json.loads(read(EXAMPLE))
        self.assertTrue(all(n.startswith("example-") for n in doc["servers"]))
        self.assertTrue(all(s["description"].startswith("SYNTHETIC") for s in doc["servers"].values()))

    def test_schema_and_renderer_agree_on_the_vocabulary(self):
        schema = json.loads(read(SCHEMA))
        self.assertEqual(set(schema["properties"]), r.SOURCE_KEYS)
        self.assertEqual(set(schema["$defs"]["server"]["properties"]), r.SERVER_KEYS)
        self.assertEqual(tuple(schema["$defs"]["server"]["properties"]["surfaces"]["items"]["enum"]), r.SURFACES)

    def test_each_invalid_definition_is_refused(self):
        cases = {
            "bad name": {"bad name": {"command": "x"}},
            "unknown key": {"s": {"command": "x", "commandd": "y"}},
            "credential-named env": {"s": {"command": "x", "env": {"SERVICE_API_KEY": "v"}}},
            "credential flag in args": {"s": {"command": "x", "args": ["--auth-token=v"]}},
            "control character": {"s": {"command": "x", "args": ["a\nb"]}},
            "bad secret source": {"s": {"command": "x", "secrets": {"T": "file:/x"}}},
            "both env and secret": {"s": {"command": "x", "env": {"T": "v"}, "not_secret": ["T"],
                                          "secrets": {"T": "env:V"}}},
            "unknown surface": {"s": {"command": "x", "surfaces": ["vim"]}},
            "empty command": {"s": {"command": " "}},
        }
        for label, servers in cases.items():
            with self.subTest(label):
                self.assertNotEqual(r.validate({"version": 1, "servers": servers}, "darwin"), [], label)

    def test_credentials_are_refused_by_value_whatever_the_key_is_called(self):
        # Assembled at run time so this file holds nothing a secret scanner would flag.
        gh = "gh" + "p_" + "Q" * 36
        cases = {
            "token prefix under an innocuous name": {"env": {"SETTING": gh}},
            "url with a password": {"env": {"DATABASE_URL": "postgres://u:" + "pw" * 6 + "@db.example/x"}},
            "url with a token query": {"args": ["https://h.example/mcp?access_token=" + "z" * 20]},
            "authorization header arg": {"args": ["--header", "Authorization: Bearer " + "y" * 24]},
            "custom header arg": {"args": ["-H", "X-Api-Key: " + "k" * 20]},
            "private key block": {"env": {"CFG": "-----BEGIN RSA " + "PRIVATE KEY-----"}},
            "credential-looking name, wider set": {"env": {"GH_PAT": "x"}},
            "bare KEY name": {"env": {"STRIPE_KEY": "x"}},
        }
        for label, extra in cases.items():
            with self.subTest(label):
                server = dict({"command": "x"}, **extra)
                errs = r.validate({"version": 1, "servers": {"s": server}}, "darwin")
                self.assertNotEqual(errs, [], label)
                for v in list(extra.get("env", {}).values()) + extra.get("args", []):
                    if len(v) > 4:
                        self.assertFalse(any(v in e for e in errs), "an error message echoed the value")
        h = mk_home("home-value-cred")
        write_source(h, {"version": 1, "servers": {"s": {"command": "x", "env": {"SETTING": gh}}}})
        for mode in ("--dry-run", "--check"):
            p = run(h, mode)
            self.assertEqual(p.returncode, 2)
            self.assertNotIn(gh, p.stdout + p.stderr, mode)

    def test_not_secret_is_the_reviewed_escape(self):
        doc = {"version": 1, "servers": {"s": {"command": "x", "env": {"AUTH_MODE": "device"},
                                               "args": ["--token-file", "/p"], "not_secret": ["AUTH_MODE", "--token-file"]}}}
        self.assertEqual(r.validate(doc, "darwin"), [])

    def test_invalid_definition_writes_nothing(self):
        h = mk_home("home-invalid")
        write_source(h, {"version": 1, "servers": {"s": {"command": "x", "env": {"MY_SECRET": "v"}}}})
        before = fingerprint(h)
        p = run(h)
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn("looks like a credential", p.stderr)
        self.assertEqual(fingerprint(h), before)

    def test_missing_definition_is_a_usage_error(self):
        h = mk_home("home-nosource")
        p = run(h)
        self.assertEqual(p.returncode, 2)
        self.assertIn("no MCP definition", p.stderr)

    def test_the_definition_must_be_a_regular_file(self):
        h = mk_home("home-source-kind")
        d = os.path.join(BASE, "a-directory-source")
        os.makedirs(d, exist_ok=True)
        p = run(h, "--source=" + d, "--dry-run")
        self.assertEqual(p.returncode, 2)
        self.assertIn("not a regular file", p.stderr)
        real = write_source(h, source_doc())
        link = os.path.join(BASE, "a-linked-source.json")
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(real, link)
        self.assertEqual(run(h, "--source=" + link, "--dry-run").returncode, 0, "a symlink resolves to its file")

    def test_a_definition_that_could_be_committed_is_refused(self):
        if not shutil.which("git"):
            self.skipTest("git not available")
        h = mk_home("home-git")
        repo = os.path.join(BASE, "a-git-repo")
        shutil.rmtree(repo, ignore_errors=True)
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        src = os.path.join(repo, "mcp-servers.json")
        with open(src, "w") as fh:
            json.dump(source_doc(), fh)
        p = run(h, "--source=" + src, "--dry-run")
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("could be committed", p.stderr)
        with open(os.path.join(repo, ".gitignore"), "w") as fh:
            fh.write("mcp-servers.json\n")
        p = run(h, "--source=" + src, "--dry-run")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)


class TrustedPath(unittest.TestCase):
    """The path that is opened (and given to git) is rebuilt from a fixed root and listed entry names
    (SonarCloud S8707, S8705), never taken from the argument."""

    def fresh_dir(self, name):
        d = os.path.join(BASE, name)
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
        return os.path.realpath(d)

    def test_an_ordinary_path_is_rebuilt_unchanged(self):
        d = self.fresh_dir("trusted-plain")
        f = os.path.join(d, "def.json")
        open(f, "w").close()
        self.assertEqual(r.trusted_path(f), f)

    def test_the_result_is_the_listed_name_not_the_argument(self):
        # The argument's own last name is hidden from the listing; a hard link to the same inode is
        # listed. The result must be that listed name: a renderer that echoed the argument would not be.
        d = self.fresh_dir("trusted-listed")
        named, listed = os.path.join(d, "named.json"), os.path.join(d, "listed.json")
        open(named, "w").close()
        os.link(named, listed)
        real_listdir = os.listdir

        def hiding(p):
            return [e for e in real_listdir(p) if not (os.path.realpath(p) == d and e == "named.json")]
        r.os.listdir = hiding
        try:
            self.assertEqual(r.trusted_path(named), listed)
        finally:
            r.os.listdir = real_listdir

    def test_a_differently_spelled_name_resolves_to_the_listed_spelling(self):
        d = self.fresh_dir("trusted-case")
        f = os.path.join(d, "Def.json")
        open(f, "w").close()
        other = os.path.join(d, "dEF.JSON")
        if not os.path.exists(other):
            self.skipTest("case-sensitive filesystem")
        self.assertEqual(r.trusted_path(other), f)

    def test_a_missing_component_raises_not_found(self):
        absent = os.path.join(self.fresh_dir("trusted-missing"), "absent", "def.json")
        with self.assertRaises(FileNotFoundError):
            r.trusted_path(absent)
        with self.assertRaises(FileNotFoundError):
            r.trusted_path("relative/def.json")

    @unittest.skipUnless(hasattr(os, "geteuid") and os.geteuid() != 0, "root lists any directory")
    def test_a_directory_that_cannot_be_listed_is_refused_not_bypassed(self):
        h = mk_home("home-unlistable")
        d = self.fresh_dir("trusted-unlistable")
        inner = os.path.join(d, "inner")
        os.makedirs(inner)
        src = os.path.join(inner, "mcp-servers.json")
        with open(src, "w") as fh:
            json.dump(source_doc(), fh)
        os.chmod(d, 0o311)  # traversable, not listable
        try:
            p = run(h, "--source=" + src, "--dry-run")
        finally:
            os.chmod(d, 0o755)
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("cannot read the MCP definition", p.stderr)

    @unittest.skipUnless(hasattr(os, "geteuid") and os.geteuid() != 0, "root lists any directory")
    def test_a_symlink_under_an_unlistable_ancestor_in_a_work_tree_is_refused(self):
        # git -C only traverses, so this symlink could be committed; its target is listable and readable,
        # so nothing after the commit check would refuse. The check must fail closed, not report False.
        if not shutil.which("git"):
            self.skipTest("git not available")
        h = mk_home("home-unlistable-link")
        d = self.fresh_dir("trusted-unlistable-link")
        target = os.path.join(d, "outside", "mcp-servers.json")
        os.makedirs(os.path.dirname(target))
        with open(target, "w") as fh:
            json.dump(source_doc(), fh)
        repo = os.path.join(d, "repo")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        locked = os.path.join(repo, "locked")
        os.makedirs(os.path.join(locked, "sub"))
        link = os.path.join(locked, "sub", "mcp-servers.json")
        os.symlink(target, link)
        os.chmod(locked, 0o311)  # traversable, not listable
        try:
            p = run(h, "--source=" + link, "--dry-run")
        finally:
            os.chmod(locked, 0o755)
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("cannot read the MCP definition", p.stderr)


class Render(unittest.TestCase):
    def test_dry_run_writes_nothing_and_prints_no_current_value(self):
        h = mk_home("home-dry")
        planted = "synthetic-" + secrets.token_hex(12)
        os.makedirs(os.path.dirname(targets(h)["kiro"]))
        with open(targets(h)["kiro"], "w") as fh:
            json.dump({"mcpServers": {"hand-made": {"command": "x", "env": {"HAND_TOKEN": planted}}}}, fh)
        write_source(h, source_doc())
        before = fingerprint(h)
        p = run(h, "--dry-run")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(fingerprint(h), before)
        for path in targets(h).values():
            self.assertIn("WOULD WRITE %s" % path, p.stdout)
        self.assertNotIn(planted, p.stdout + p.stderr)

    def test_fresh_install_renders_every_surface_and_is_idempotent(self):
        h = mk_home("home-fresh")
        write_source(h, source_doc())
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        t = targets(h)
        launcher = os.path.join(data(h), "mcp-launch.sh")
        cx = tload(t["codex"])["mcp_servers"]
        self.assertEqual(set(cx), {"fake-plain", "fake-secret", "fake-codex-only"})
        self.assertEqual(cx["fake-plain"], {"command": "/bin/echo", "args": ["hello"], "env": {"FAKE_REGION": "zz-1"}})
        self.assertEqual(cx["fake-secret"]["command"], launcher)
        self.assertEqual(cx["fake-secret"]["args"][:3], ["--secret", "FAKE_API_TOKEN=env:FAKE_SRC_VAR", "--"])
        self.assertEqual(cx["fake-secret"]["env_vars"], ["FAKE_SRC_VAR"])
        for s in ("claude-code", "kiro", "claude-desktop"):
            if s not in t:
                continue
            servers = jload(t[s])["mcpServers"]
            self.assertEqual(set(servers), {"fake-plain", "fake-secret"}, s)
            self.assertEqual(servers["fake-secret"]["command"], launcher, s)
        self.assertEqual(jload(t["claude-code"])["mcpServers"]["fake-plain"]["type"], "stdio")
        self.assertNotIn("type", jload(t["kiro"])["mcpServers"]["fake-plain"])
        self.assertTrue(os.access(launcher, os.X_OK))
        self.assertEqual(stat.S_IMODE(os.stat(launcher).st_mode), 0o700, "the launcher is owner-only")
        self.assertEqual(read(launcher).splitlines()[0], "#!/bin/sh")
        self.assertIn(r.MARKER_ID, read(launcher).splitlines()[1])
        for path in t.values():
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600, path)
        self.assertEqual(run(h, "--check").returncode, 0)
        before = fingerprint(h)
        self.assertEqual(run(h).returncode, 0)
        self.assertEqual(fingerprint(h), before, "a re-run changed a file")

    def test_every_rendered_file_carries_the_source_stamp(self):
        # The provenance stamp (Issue #66, ADR-0029): the launcher and the Codex block carry it in a
        # comment line; the JSON surfaces' entries are recorded with it in the manifest.
        h = mk_home("home-stamp")
        write_source(h, source_doc())
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        src = [l[len("SOURCE  "):] for l in p.stdout.splitlines() if l.startswith("SOURCE  ")]
        self.assertEqual(len(src), 1, p.stdout)
        src = src[0]
        repo = os.path.dirname(os.path.dirname(HERE))
        head = subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "HEAD"], capture_output=True, text=True)
        if head.returncode == 0:
            self.assertRegex(src, r"^release: [^;]+; commit: %s(-dirty)?$" % head.stdout.strip())
        # The same stamp global/install.sh derives for this checkout: the rule has one reference.
        if shutil.which("sh") and shutil.which("jq"):
            ih = os.path.join(BASE, "home-stamp-install")
            os.makedirs(ih, exist_ok=True)
            q = subprocess.run(["sh", os.path.join(repo, "global", "install.sh"), "--dry-run"],
                               env=clean_env(ih), capture_output=True, text=True)
            self.assertIn("SOURCE  %s\n" % src, q.stdout, q.stderr)
        t = targets(h)
        launcher = os.path.join(data(h), "mcp-launch.sh")
        self.assertEqual(r.stamp_of(read(launcher)), src)
        self.assertEqual(r.stamp_of(read(t["codex"])), src)
        stamps = jload(os.path.join(data(h), "mcp-managed.json"))["stamps"]
        json_surfaces = [s for s in t if s != "codex"]
        self.assertEqual({s: stamps.get(s) for s in json_surfaces}, {s: src for s in json_surfaces})
        self.assertEqual(run(h, "--check").returncode, 0)
        # Another commit's stamp on unchanged content: STAMP (not DRIFT), and install rewrites it.
        other = "release: v0.0.1; commit: 0123456789abcdef0123456789abcdef01234567"
        for path in (launcher, t["codex"]):
            text = read(path).replace(src, other)
            with open(path, "w") as fh:
                fh.write(text)
        m = jload(os.path.join(data(h), "mcp-managed.json"))
        m["stamps"]["kiro"] = other
        with open(os.path.join(data(h), "mcp-managed.json"), "w") as fh:
            json.dump(m, fh)
        c = run(h, "--check")
        self.assertEqual(c.returncode, 1, c.stdout)
        self.assertEqual(sum(1 for l in c.stdout.splitlines() if l.startswith("STAMP") and other in l), 3, c.stdout)
        self.assertNotIn("DRIFT", c.stdout)
        self.assertEqual(run(h).returncode, 0)
        self.assertEqual(r.stamp_of(read(launcher)), src)
        self.assertEqual(run(h, "--check").returncode, 0)

    def test_codex_parses_the_rendered_config(self):
        codex = shutil.which("codex")
        if not codex:
            self.skipTest("codex not on PATH: the rendered config.toml was not parsed by Codex here")
        h = mk_home("home-codex")
        with open(targets(h)["codex"], "w") as fh:
            fh.write('model = "some-model"\n\n[projects."/tmp/x"]\ntrust_level = "trusted"\n')
        write_source(h, source_doc())
        self.assertEqual(run(h).returncode, 0)
        p = subprocess.run([codex, "mcp", "list", "--json"], capture_output=True, text=True,
                           env=clean_env(h, CODEX_HOME=os.path.join(h, ".codex")))
        self.assertEqual(p.returncode, 0, p.stderr)
        got = {s["name"]: s["transport"] for s in json.loads(p.stdout)}
        self.assertEqual(set(got), {"fake-plain", "fake-secret", "fake-codex-only"})
        self.assertEqual(got["fake-secret"]["command"], os.path.join(data(h), "mcp-launch.sh"))
        self.assertEqual(got["fake-secret"]["env_vars"], ["FAKE_SRC_VAR"])
        self.assertEqual(got["fake-plain"]["env"], {"FAKE_REGION": "zz-1"})

    def test_every_other_key_and_hand_server_survives_with_a_backup(self):
        h = mk_home("home-keep")
        t = targets(h)
        codex_before = ('# my own comment\nmodel = "m"\n\n[mcp_servers.hand-made]\ncommand = "x"\n'
                        'env = { HAND_TOKEN = "synthetic-not-real" }\n\n[projects."/tmp/p"]\ntrust_level = "trusted"\n')
        with open(t["codex"], "w") as fh:
            fh.write(codex_before)
        os.chmod(t["codex"], 0o640)
        json_before = {"preferences": {"theme": "dark"}, "numStartups": 3,
                       "mcpServers": {"hand-made": {"command": "x", "args": []}}}
        for s in ("claude-code", "kiro", "claude-desktop"):
            if s in t:
                os.makedirs(os.path.dirname(t[s]), exist_ok=True)
                with open(t[s], "w") as fh:
                    json.dump(json_before, fh)
        write_source(h, source_doc())
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        new = read(t["codex"])
        self.assertTrue(new.startswith(codex_before), "the user's own TOML text changed")
        parsed = tload(t["codex"])
        self.assertEqual(parsed["model"], "m")
        self.assertEqual(parsed["projects"], {"/tmp/p": {"trust_level": "trusted"}})
        self.assertIn("hand-made", parsed["mcp_servers"])
        self.assertEqual(read(t["codex"] + ".pmhwc-backup"), codex_before)
        self.assertEqual(stat.S_IMODE(os.stat(t["codex"]).st_mode), 0o640)
        for s in ("claude-code", "kiro", "claude-desktop"):
            if s not in t:
                continue
            got = jload(t[s])
            self.assertEqual(got["preferences"], {"theme": "dark"}, s)
            self.assertEqual(got["numStartups"], 3, s)
            self.assertEqual(got["mcpServers"]["hand-made"], {"command": "x", "args": []}, s)
            self.assertEqual(jload(t[s] + ".pmhwc-backup"), json_before, s)

    def test_check_detects_drift_per_surface_and_install_repairs_it(self):
        h = mk_home("home-drift")
        write_source(h, source_doc())
        self.assertEqual(run(h).returncode, 0)
        t = targets(h)
        text = read(t["codex"]).replace('args = ["hello"]', 'args = ["hello"]\nenabled = false')
        with open(t["codex"], "w") as fh:
            fh.write(text)
        p = run(h, "--check")
        self.assertEqual(p.returncode, 1)
        self.assertIn("DRIFT   %s" % t["codex"], p.stdout)
        self.assertEqual(run(h).returncode, 0)
        self.assertEqual(run(h, "--check").returncode, 0)
        for s in ("claude-code", "kiro", "claude-desktop"):
            if s not in t:
                continue
            d = jload(t[s])
            d["mcpServers"]["fake-plain"]["args"] = ["tampered"]
            with open(t[s], "w") as fh:
                json.dump(d, fh)
            p = run(h, "--check")
            self.assertEqual(p.returncode, 1, s)
            self.assertIn("DRIFT   %s" % t[s], p.stdout)
            self.assertEqual(run(h).returncode, 0)
            self.assertEqual(jload(t[s])["mcpServers"]["fake-plain"]["args"], ["hello"], s)
        self.assertEqual(run(h, "--check").returncode, 0)

    def test_a_server_removed_from_the_definition_leaves_every_surface(self):
        h = mk_home("home-remove")
        t = targets(h)
        os.makedirs(os.path.dirname(t["kiro"]))
        with open(t["kiro"], "w") as fh:
            json.dump({"mcpServers": {"hand-made": {"command": "x"}}}, fh)
        write_source(h, source_doc())
        self.assertEqual(run(h).returncode, 0)
        doc = source_doc()
        del doc["servers"]["fake-plain"]
        write_source(h, doc)
        self.assertEqual(run(h, "--check").returncode, 1)
        self.assertEqual(run(h).returncode, 0)
        self.assertNotIn("fake-plain", tload(t["codex"])["mcp_servers"])
        for s in ("claude-code", "kiro", "claude-desktop"):
            if s in t:
                self.assertNotIn("fake-plain", jload(t[s])["mcpServers"], s)
        self.assertIn("hand-made", jload(t["kiro"])["mcpServers"])
        write_source(h, {"version": 1, "servers": {}})
        self.assertEqual(run(h).returncode, 0)
        self.assertNotIn(r.BLOCK_END, read(t["codex"]))
        self.assertEqual(jload(t["kiro"])["mcpServers"], {"hand-made": {"command": "x"}})

    def test_a_hand_server_of_the_same_name_is_refused_and_untouched(self):
        h = mk_home("home-conflict-codex")
        t = targets(h)
        with open(t["codex"], "w") as fh:
            fh.write('[mcp_servers.fake-plain]\ncommand = "mine"\n')
        write_source(h, source_doc())
        before = read(t["codex"])
        p = run(h, "--surfaces=codex")
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertIn("duplicate table", p.stderr)
        self.assertEqual(read(t["codex"]), before)
        self.assertEqual(run(h, "--surfaces=codex", "--adopt").returncode, 3, "adopt must not edit TOML by hand")

        h = mk_home("home-conflict-json")
        t = targets(h)
        os.makedirs(os.path.dirname(t["kiro"]))
        with open(t["kiro"], "w") as fh:
            json.dump({"mcpServers": {"fake-plain": {"command": "mine"}}}, fh)
        before = read(t["kiro"])
        write_source(h, source_doc())
        p = run(h, "--surfaces=kiro")
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertIn("--adopt", p.stderr)
        self.assertEqual(read(t["kiro"]), before)
        self.assertEqual(run(h, "--surfaces=kiro", "--adopt").returncode, 0)
        self.assertEqual(jload(t["kiro"])["mcpServers"]["fake-plain"]["command"], "/bin/echo")
        self.assertEqual(jload(t["kiro"] + ".pmhwc-backup"), {"mcpServers": {"fake-plain": {"command": "mine"}}})
        self.assertEqual(run(h, "--surfaces=kiro", "--check").returncode, 0, "the adopted entry is now managed")

    def test_codex_content_that_would_change_meaning_is_refused(self):
        h = mk_home("home-after-block")
        t = targets(h)
        write_source(h, source_doc())
        self.assertEqual(run(h, "--surfaces=codex").returncode, 0)
        with open(t["codex"], "a") as fh:
            fh.write('startup_timeout_sec = 30\n')
        before = read(t["codex"])
        p = run(h, "--surfaces=codex")
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertIn("after the managed block", p.stderr)
        self.assertEqual(read(t["codex"]), before)
        with open(t["codex"], "w") as fh:
            fh.write(before.replace(r.BLOCK_END, ""))
        p = run(h, "--surfaces=codex")
        self.assertEqual(p.returncode, 3)
        self.assertIn("markers are damaged", p.stderr)

    def test_an_unmanaged_file_at_the_launcher_path_stops_everything(self):
        h = mk_home("home-foreign-launcher")
        os.makedirs(data(h), exist_ok=True)
        with open(os.path.join(data(h), "mcp-launch.sh"), "w") as fh:
            fh.write("#!/bin/sh\necho someone else\n")
        write_source(h, source_doc())
        p = run(h)
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        for path in targets(h).values():
            self.assertFalse(os.path.exists(path), path)

    def test_invalid_existing_config_is_refused_and_untouched(self):
        h = mk_home("home-badjson")
        t = targets(h)
        with open(t["claude-code"], "w") as fh:
            fh.write('{ "numStartups": ')
        with open(t["codex"], "w") as fh:
            fh.write('model = \n')
        write_source(h, source_doc())
        p = run(h, "--surfaces=claude-code,codex")
        self.assertEqual(p.returncode, 3)
        self.assertEqual(read(t["claude-code"]), '{ "numStartups": ')
        self.assertEqual(read(t["codex"]), 'model = \n')

    def test_an_agent_session_may_not_write_the_real_home(self):
        inside = ["/h/throwaway/.codex/config.toml", "/h/throwaway/.local/share/x/mcp-launch.sh"]
        agent = {"CLAUDECODE": "1"}
        self.assertIsNotNone(r.owner_act_refusal("/h/real", ["/h/real/.codex/config.toml"], agent, "/h/real"))
        self.assertIsNotNone(r.owner_act_refusal("/h/real", [], {"CODEX_SANDBOX": "seatbelt"}, "/h/real"))
        self.assertIsNotNone(r.owner_act_refusal("/h", ["/h/.codex/config.toml"], agent, "/h/real"),
                             "a HOME that contains the real home")
        self.assertIsNotNone(r.owner_act_refusal("/h/throwaway", inside + ["/h/real/.codex/config.toml"], agent, "/h/real"),
                             "one target outside HOME")
        self.assertIsNone(r.owner_act_refusal("/h/throwaway", inside, agent, "/h/real"))
        self.assertIsNone(r.owner_act_refusal("/h/real", ["/h/real/.codex/config.toml"], {}, "/h/real"))

    def test_an_agent_session_may_not_redirect_a_write_outside_home(self):
        # CODEX_HOME and XDG_DATA_HOME move write targets; HOME alone is not the boundary.
        for var, rel in (("CODEX_HOME", "elsewhere-codex"), ("XDG_DATA_HOME", "elsewhere-data")):
            with self.subTest(var):
                h = mk_home("home-redirect-" + var)
                elsewhere = os.path.join(BASE, rel)
                shutil.rmtree(elsewhere, ignore_errors=True)
                os.makedirs(elsewhere)
                src = write_source(h, source_doc())
                before_h, before_e = fingerprint(h), fingerprint(elsewhere)
                p = run(h, "--source=" + src, env=clean_env(h, CLAUDECODE="1", **{var: elsewhere}))
                self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
                self.assertIn("outside HOME", p.stderr)
                self.assertEqual(fingerprint(h), before_h)
                self.assertEqual(fingerprint(elsewhere), before_e)
        h = mk_home("home-agent-inside")
        write_source(h, source_doc())
        p = run(h, env=clean_env(h, CLAUDECODE="1"))
        self.assertEqual(p.returncode, 0, "an agent may still render into a throwaway HOME: " + p.stderr)


class Secrets(unittest.TestCase):
    def assert_value_reaches_server_only(self, h, value, server_env, pre=(), command=None):
        """The value is in no file under the throwaway HOME, and the launched server sees it. `pre` is put
        before the rendered launcher arguments (the throwaway --keychain); `command` replaces the rendered
        launcher (its stub copy)."""
        blob = all_bytes(h)
        self.assertNotIn(value.encode(), blob, "a secret value is in a rendered file")
        cx = tload(targets(h)["codex"])["mcp_servers"]["fake-secret"]
        launch = [command or cx["command"]] + list(pre) + cx["args"]
        out = os.path.join(BASE, "out-env.txt")
        if os.path.exists(out):
            os.remove(out)
        # Inherited tracing must not print the value: SHELLOPTS reaches /bin/sh where it is bash (macOS).
        env = dict(server_env, SHELLOPTS="xtrace")
        p = subprocess.run(launch, env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(read(out), sha(value), "the server did not receive the secret")
        self.assertNotIn(value, p.stdout + p.stderr, "the launcher printed the secret under SHELLOPTS=xtrace")
        p = subprocess.run(["sh", "-x"] + launch, env=server_env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn(value, p.stdout + p.stderr, "the launcher printed the secret under sh -x")
        if shutil.which("bash"):
            p = subprocess.run(["bash", "-x"] + launch, env=env, capture_output=True, text=True)
            self.assertNotIn(value, p.stdout + p.stderr, "the launcher printed the secret under bash -x")

    def test_env_indirection_renders_names_only_and_launches_with_the_value(self):
        h = mk_home("home-env-secret")
        value = "synthetic-" + secrets.token_hex(16)
        write_source(h, source_doc())
        self.assertEqual(run(h, env=clean_env(h, FAKE_SRC_VAR=value)).returncode, 0)
        self.assert_value_reaches_server_only(h, value, clean_env(h, FAKE_SRC_VAR=value))
        cx = tload(targets(h)["codex"])["mcp_servers"]["fake-secret"]
        p = subprocess.run([cx["command"]] + cx["args"], env=clean_env(h), capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0, "the launcher started a server without its secret")
        self.assertIn("FAKE_SRC_VAR is not set", p.stderr)

    def test_the_file_check_can_see_a_value_when_one_is_written(self):
        # Calibration of the check above: put the same kind of value in plain env (reviewed as not
        # secret) and the byte search must find it. A search that cannot fail would prove nothing.
        h = mk_home("home-calibration")
        value = "synthetic-" + secrets.token_hex(16)
        write_source(h, source_doc({"fake-leaky": {"command": "/bin/echo", "env": {"LEAKY_TOKEN": value},
                                                   "not_secret": ["LEAKY_TOKEN"]}}))
        self.assertEqual(run(h).returncode, 0)
        self.assertIn(value.encode(), all_bytes(h))

    @unittest.skipUnless(DARWIN, "keychain: sources are macOS only (the renderer refuses them elsewhere)")
    def test_keychain_secret_renders_names_only_and_launches_with_the_value(self):
        service = "%s.mcp-test-%d" % (r.PROJECT, os.getpid())
        value = "synthetic-" + secrets.token_hex(16)
        account = os.environ.get("USER") or str(os.getuid())
        h = mk_home("home-keychain")
        env = clean_env(h)      # every `security` call and every launch: throwaway HOME, throwaway keychain
        kc = throwaway_keychain(h, "mcp-secret")
        try:
            cmd = 'add-generic-password -s "%s" -a "%s" -w "%s" "%s"\n' % (service, account, value, kc)
            self.assertEqual(subprocess.run([GUARD.security, "-i"], input=cmd.encode(), capture_output=True,
                                            env=env).returncode, 0, "the throwaway keychain is not writable")
            doc = source_doc()
            doc["servers"]["fake-secret"]["secrets"] = {"FAKE_API_TOKEN": "keychain:" + service}
            write_source(h, doc)
            p = run(h)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertNotIn(value, p.stdout + p.stderr)
            self.assertIn(service, read(targets(h)["codex"]), "the Keychain service NAME is rendered")
            self.assertNotIn(kc, read(targets(h)["codex"]), "the renderer must never write --keychain")
            cx = tload(targets(h)["codex"])["mcp_servers"]["fake-secret"]
            launcher = keychain_launcher(cx["command"], "keychain-secret")
            self.assert_value_reaches_server_only(h, value, env, pre=("--keychain", kc), command=launcher)
            subprocess.run([GUARD.security, "delete-generic-password", "-s", service, "-a", account, kc],
                           capture_output=True, env=env)
            launch = [launcher, "--keychain", kc] + cx["args"]
            p = subprocess.run(launch, env=env, capture_output=True, text=True)
            self.assertEqual(p.returncode, 3, "the launcher started a server after its Keychain item was deleted")
            self.assertIn("no readable Keychain item", p.stderr)
            self.assertNotIn(value, p.stderr)
            # A non-printable value: `security -w` would hand it over hex-encoded, so the launcher refuses.
            cmd = 'add-generic-password -s "%s" -a "%s" -X "0001ff41" "%s"\n' % (service, account, kc)
            self.assertEqual(subprocess.run([GUARD.security, "-i"], input=cmd.encode(), capture_output=True,
                                            env=env).returncode, 0)
            q = subprocess.run(launch, env=env, capture_output=True, text=True)
            self.assertEqual(q.returncode, 3, q.stderr)
            self.assertIn("not printable text", q.stderr)
        finally:
            drop_keychain(h, kc)
        self.assertFalse(os.path.exists(kc), "the throwaway keychain was not deleted")

    def test_launcher_refuses_a_misplaced_or_relative_keychain(self):
        marker = os.path.join(BASE, "should-not-exist-kc")
        for args in (["--keychain", "relative.keychain-db"], ["--keychain"],
                     ["--secret", "OK=env:SET_ONE", "--keychain", os.path.join(BASE, "k.keychain-db")]):
            p = subprocess.run(["sh", LAUNCH] + args + ["--", "touch", marker],
                               env=clean_env(BASE, SET_ONE="x"), capture_output=True, text=True)
            self.assertEqual(p.returncode, 2, args)
            self.assertFalse(os.path.exists(marker), args)

    def test_launcher_refuses_bad_specs_without_running_anything(self):
        marker = os.path.join(BASE, "should-not-exist")
        for spec in ("NOEQUALS", "1BAD=env:X", "OK=file:/x", "OK=env:", "OK=env:BAD-NAME"):
            p = subprocess.run(["sh", LAUNCH, "--secret", spec, "--", "touch", marker],
                               env=clean_env(BASE), capture_output=True, text=True)
            self.assertEqual(p.returncode, 2, spec)
            self.assertFalse(os.path.exists(marker), spec)
        p = subprocess.run(["sh", LAUNCH, "--secret", "OK=env:EMPTY_ONE", "--", "touch", marker],
                           env=clean_env(BASE, EMPTY_ONE=""), capture_output=True, text=True)
        self.assertEqual(p.returncode, 3)
        self.assertFalse(os.path.exists(marker))


class BackupMode(unittest.TestCase):
    """PR #147 lens F1: the renderer's .pmhwc-backup is owner-only whatever the original's mode, and a
    link planted at the backup path is replaced, never written through."""

    def test_backup_is_owner_only_and_never_written_through(self):
        d = os.path.join(BASE, "backup-mode")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, "config.toml")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("old = 1\n")
        os.chmod(path, 0o644)
        decoy = os.path.join(d, "decoy")
        with open(decoy, "w", encoding="utf-8") as fh:
            fh.write("decoy\n")
        os.symlink(decoy, path + ".pmhwc-backup")
        r.atomic_write(path, "new = 2\n", backup=True)
        backup = path + ".pmhwc-backup"
        self.assertFalse(os.path.islink(backup))
        self.assertEqual(stat.S_IMODE(os.stat(backup).st_mode), 0o600)
        with open(backup, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "old = 1\n")
        with open(decoy, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "decoy\n")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o644)


class Scan(unittest.TestCase):
    def test_scan_lists_key_names_and_never_a_value(self):
        h = mk_home("home-scan")
        t = targets(h)
        vals = ["synthetic-%d-%s" % (i, secrets.token_hex(8)) for i in range(6)]
        with open(t["codex"], "w") as fh:
            fh.write('[mcp_servers.svc-a]\ncommand = "x"\nargs = ["--api-key", "%s"]\n'
                     'env = { SVC_TOKEN = "%s", REGION = "eu" }\n\n[mcp_servers.svc-r]\nurl = "https://h/mcp"\n'
                     'bearer_token = "%s"\n' % (vals[0], vals[1], vals[2]))
        os.makedirs(os.path.dirname(t["kiro"]))
        with open(t["kiro"], "w") as fh:
            json.dump({"mcpServers": {"svc-b": {"command": "x", "args": ["--password=" + vals[3]],
                                                "headers": {"Authorization": vals[4]}},
                                      "svc-u": {"url": "https://h/mcp?access_token=" + vals[5]}}}, fh)
        shutil.copy(t["kiro"], t["kiro"] + ".pmhwc-backup")
        shutil.copy(t["kiro"], t["kiro"] + ".new.4242")
        with open(t["claude-code"], "w") as fh:
            json.dump({"mcpServers": {"svc-c": {"command": "x", "env": {"SETTING": "gh" + "p_" + "W" * 36}}}}, fh)
        p = run(h, "--scan")
        self.assertEqual(p.returncode, 0, p.stderr)
        for v in vals:
            self.assertNotIn(v, p.stdout + p.stderr)
        for expect in ("svc-a\targs[0] --api-key <value>", "svc-a\tenv.SVC_TOKEN", "svc-r\tbearer_token",
                       "svc-b\targs[0] --password=<value>", "svc-b\theaders.Authorization", "svc-u\turl ("):
            self.assertIn(expect, p.stdout)
        self.assertNotIn("REGION", p.stdout)
        self.assertIn("backup\t%s.pmhwc-backup" % t["kiro"], p.stdout)
        self.assertIn("temp\t%s.new.4242" % t["kiro"], p.stdout)
        self.assertIn("svc-c\tenv.SETTING", p.stdout, "a credential-shaped value under an innocuous name")
        self.assertNotIn("W" * 36, p.stdout + p.stderr)

    def test_scan_is_owner_run_only(self):
        h = mk_home("home-scan-agent")
        p = run(h, "--scan", env=clean_env(h, CLAUDECODE="1"))
        self.assertEqual(p.returncode, 2)
        self.assertIn("owner-run only", p.stderr)


POLICY_STAMP = "release: v0.0.0-test; commit: synthetic"


def policy(home, mode, *extra, env=None):
    return run(home, "--policy", "--mode=" + mode, "--stamp=" + POLICY_STAMP, *extra, env=env)


def policy_entry():
    return r.entry("claude-code", r.load_policy()["servers"]["chrome-devtools"], None)


def r_manifest(home):
    return os.path.join(data(home), "mcp-managed.json")


class Policy(unittest.TestCase):
    """ADR-0038 (Issue #174): the tracked policy servers, rendered by mhw install into the Claude Code user
    configuration (~/.claude.json), old -> new, with a 0600 backup, and removed on uninstall."""

    def test_the_policy_file_pins_the_package_and_fails_closed(self):
        doc = r.load_policy()
        self.assertEqual(sorted(doc["servers"]), ["chrome-devtools"],
                         "the name chrome-devtools gives mcp__chrome-devtools__*, product-lead's grant")
        s = doc["servers"]["chrome-devtools"]
        self.assertEqual(s["surfaces"], ["claude-code"])
        self.assertEqual(s["command"], "/bin/sh")
        script = s["args"][1]
        self.assertRegex(script, r"exec npx --ignore-scripts -y chrome-devtools-mcp@[0-9]+\.[0-9]+\.[0-9]+ ",
                         "the package is pinned to one exact version, fetched with install scripts off")
        self.assertIn("--allowedUrlPattern \"$o\"", script)
        self.assertIn("o='http://127.0.0.1:9/*'", script, "the fail-closed default: the discard port")
        # Measured on Claude Code 2.1.296 (ADR-0038): a ${VAR} in a server's args is expanded from the
        # process environment before a project's settings env is applied, so it would always give the
        # default. The shell expands it at launch instead, so no ${ may reach the harness.
        self.assertNotIn("${", json.dumps(s))

    def test_the_launch_script_binds_the_declared_origin_or_the_discard_port(self):
        d = os.path.join(BASE, "policy-fake-npx")
        os.makedirs(d, exist_ok=True)
        log = os.path.join(d, "argv.txt")
        npx = os.path.join(d, "npx")
        with open(npx, "w") as fh:
            fh.write('#!/bin/sh\nfor a in "$@"; do printf "%%s\\n" "$a"; done > "%s"\n' % log)
        os.chmod(npx, 0o700)
        e = policy_entry()
        cases = ((None, "http://127.0.0.1:9/*"), ("", "http://127.0.0.1:9/*"),
                 ("https://site.example/*", "https://site.example/*"),
                 ("https://a.example/* ; touch x", "https://a.example/* ; touch x"),
                 ("http://localhost:4321/*", "http://localhost:4321/*"),
                 # A dash-led value would be read as a flag and leave the allow list empty; a value that
                 # is not an http(s) URL is not an origin. Both fall back to the discard port (QA A1).
                 ("--remote-debugging-port=9222", "http://127.0.0.1:9/*"),
                 ("-x", "http://127.0.0.1:9/*"),
                 ("site.example/*", "http://127.0.0.1:9/*"),
                 ("file:///etc/*", "http://127.0.0.1:9/*"),
                 (" https://lead-space.example/*", "http://127.0.0.1:9/*"))
        for value, bound in cases:
            env = {"PATH": d + os.pathsep + "/usr/bin:/bin"}
            if value is not None:
                env["HARNESS_SWEEP_ORIGIN"] = value
            p = subprocess.run([e["command"]] + e["args"], env=env, capture_output=True, text=True, cwd=d)
            self.assertEqual(p.returncode, 0, p.stderr)
            argv = read(log).splitlines()
            self.assertEqual(argv[-2:], ["--allowedUrlPattern", bound], value)
            self.assertIn("chrome-devtools-mcp@", " ".join(argv))
        self.assertFalse(os.path.exists(os.path.join(d, "x")), "the origin is one argument, never shell text")

    def test_install_writes_old_to_new_keeps_a_private_backup_and_uninstall_removes(self):
        h = mk_home("home-policy")
        cfg = targets(h)["claude-code"]
        with open(cfg, "w") as fh:
            json.dump({"numStartups": 7, "mcpServers": {"mine": {"command": "/bin/echo"}}}, fh)
        os.chmod(cfg, 0o644)
        seed = read(cfg)
        p = policy(h, "check")
        self.assertEqual(p.returncode, 1)
        self.assertIn("DRIFT", p.stdout)
        p = policy(h, "install")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("CHANGED %s: chrome-devtools absent -> /bin/sh -c " % cfg, p.stdout)
        self.assertIn("chrome-devtools-mcp@", p.stdout)
        got = jload(cfg)
        self.assertEqual(got["mcpServers"]["chrome-devtools"], policy_entry())
        self.assertEqual(got["mcpServers"]["mine"], {"command": "/bin/echo"})
        self.assertEqual(got["numStartups"], 7)
        backup = cfg + r.POLICY_BACKUP
        self.assertEqual(read(backup), seed)
        self.assertEqual(stat.S_IMODE(os.stat(backup).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(cfg).st_mode), 0o644, "the config keeps its own mode")
        before = fingerprint(h)
        p = policy(h, "install")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("OK ", p.stdout)
        self.assertEqual(fingerprint(h), before, "a second install changes nothing")
        self.assertEqual(policy(h, "check").returncode, 0)
        p = run(h, "--policy", "--mode=check", "--stamp=release: other; commit: other")
        self.assertEqual(p.returncode, 1)
        self.assertIn("STAMP", p.stdout)
        p = policy(h, "uninstall")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn(" -> absent", p.stdout)
        got = jload(cfg)
        self.assertNotIn("chrome-devtools", got["mcpServers"])
        self.assertEqual(got["mcpServers"]["mine"], {"command": "/bin/echo"})
        self.assertFalse(os.path.exists(r_manifest(h)), "a manifest that recorded only the policy goes")
        self.assertEqual(policy(h, "uninstall").returncode, 0, "uninstall twice is a no-op")

    def test_dry_run_writes_nothing(self):
        h = mk_home("home-policy-dry")
        before = fingerprint(h)
        p = policy(h, "dry-run")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("WOULD CHANGE", p.stdout)
        self.assertEqual(fingerprint(h), before)

    def test_a_surface_that_is_not_installed_is_skipped(self):
        h = os.path.join(BASE, "home-policy-none")
        os.makedirs(h, exist_ok=True)
        p = policy(h, "install")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("SKIP", p.stdout)
        self.assertFalse(os.path.exists(os.path.join(h, ".claude.json")))

    def test_a_hand_server_of_the_same_name_is_refused_and_untouched(self):
        h = mk_home("home-policy-hand")
        cfg = targets(h)["claude-code"]
        with open(cfg, "w") as fh:
            json.dump({"mcpServers": {"chrome-devtools": {"command": "npx", "args": ["chrome-devtools-mcp@latest"]}}},
                      fh)
        seed = read(cfg)
        p = policy(h, "install")
        self.assertEqual(p.returncode, 3)
        self.assertIn("not written by mhw", p.stderr)
        self.assertEqual(read(cfg), seed)
        self.assertFalse(os.path.exists(cfg + r.POLICY_BACKUP))

    def test_the_local_definition_and_the_policy_never_remove_each_other(self):
        h = mk_home("home-policy-both")
        cfg = targets(h)["claude-code"]
        write_source(h, source_doc())
        p = run(h, "--surfaces=claude-code")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(policy(h, "install").returncode, 0)
        p = run(h, "--surfaces=claude-code")
        self.assertEqual(p.returncode, 0, p.stderr)
        names = set(jload(cfg)["mcpServers"])
        self.assertTrue({"chrome-devtools", "fake-plain", "fake-secret"} <= names, names)
        self.assertEqual(run(h, "--check", "--surfaces=claude-code").returncode, 0)
        self.assertEqual(policy(h, "check").returncode, 0)
        self.assertEqual(policy(h, "uninstall").returncode, 0)
        names = set(jload(cfg)["mcpServers"])
        self.assertNotIn("chrome-devtools", names)
        self.assertTrue({"fake-plain", "fake-secret"} <= names, names)
        self.assertTrue(os.path.exists(r_manifest(h)), "the local definition's record stays")
        self.assertEqual(run(h, "--check", "--surfaces=claude-code").returncode, 0)

    def test_a_policy_server_that_names_a_secret_or_codex_is_refused(self):
        d = os.path.join(BASE, "policy-invalid")
        os.makedirs(d, exist_ok=True)
        for bad in ({"command": "x", "surfaces": ["claude-code"], "secrets": {"A_TOKEN": "env:B"}},
                    {"command": "x", "surfaces": ["codex"]},
                    {"command": "x"}):
            path = os.path.join(d, "p.json")
            with open(path, "w") as fh:
                json.dump({"version": 1, "servers": {"s": bad}}, fh)
            with self.assertRaises(r.Refuse):
                r.load_policy(path)

    def test_describe_shows_a_command_line_and_hides_what_looks_like_a_credential(self):
        self.assertEqual(r.describe(None), "absent")
        self.assertEqual(r.describe({"command": "/bin/echo", "args": ["a b"]}), "/bin/echo 'a b'")
        self.assertEqual(r.describe({"command": "x", "env": {"A": "secret-value"}}), "x (env: 1 value(s), not shown)")
        value = "synthetic-" + secrets.token_hex(8)
        token = "gh" + "p_" + "Z" * 36
        for e in ({"command": "x", "args": ["--api-key", value]},
                  {"command": "x", "args": ["--password=" + value]},
                  {"command": "x", "args": [token]},
                  {"command": "x", "args": ["https://u:" + value + "@h/"]}):
            got = r.describe(e)
            self.assertEqual(got, "present (not shown: it looks like it carries a credential)", e)
            self.assertNotIn(value, got)
            self.assertNotIn(token, got)

    def test_bad_policy_arguments_are_a_usage_error(self):
        h = mk_home("home-policy-usage")
        for args in (("--policy", "--mode=report"), ("--policy", "--stamp="), ("--policy", "--adopt")):
            self.assertEqual(run(h, *args).returncode, 2, args)


# ----------------------------------------------------------------------------- the MCP active set (#219)


def active(home, mode, *extra, env=None):
    return run(home, "--active", "--mode=" + mode, "--stamp=" + POLICY_STAMP, *extra, env=env)


def write_json(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(doc, fh)


ACTIVE_CODEX = """approval_policy = "on-request"

[mcp_servers.set-a]
command = "/bin/echo"

[mcp_servers.out-b]
command = "/bin/echo"

[mcp_servers.out-b.env]
SYNTH = "%s"

[mcp_servers.out-c]
enabled = true # kept as written
command = "/bin/echo"

[mcp_servers.own-off]
enabled = false
command = "/bin/echo"

[mcp_servers.node_repl]
command = "/bin/echo"
"""


def active_home(name, canary):
    """A throwaway HOME with every kind of server the active set meets. Every name is synthetic; canary is a
    generated value placed where a credential would sit, so a run can show it never prints one."""
    h = mk_home(name)
    t = targets(h)
    write_source(h, {"version": 1, "servers": {"set-a": {"command": "/bin/echo"}},
                     "active_set": {"connectors": {"Synth On": "on", "Synth Off": "off"}}})
    with open(t["codex"], "w") as fh:
        fh.write(ACTIVE_CODEX % canary)
    write_json(t["kiro"], {"mcpServers": {"set-a": {"command": "/bin/echo"},
                                          "out-k": {"command": "/bin/echo", "env": {"SYNTH": canary}},
                                          "out-k2": {"command": "/bin/echo", "disabled": False},
                                          "own-off": {"command": "/bin/echo", "disabled": True}}})
    write_json(t["claude-code"], {"numStartups": 3, "mcpServers": {
        "set-a": {"type": "stdio", "command": "/bin/echo"}, "out-u": {"type": "stdio", "command": "/bin/echo"},
        "chrome-devtools": {"command": "/bin/sh"}, "claude-in-chrome": {"command": "/bin/echo"}}})
    settings = os.path.join(h, ".claude", "settings.json")
    write_json(settings, {"model": "synthetic", "deniedMcpServers": [{"serverName": "owners-own"}]})
    synced = os.path.join(h, ".claude", "plugins", "synced", "src1", "plug1")
    os.makedirs(synced)
    write_json(os.path.join(synced, ".mcp.json"), {"mcpServers": {
        "web": {"type": "http", "url": "https://synth.example/mcp"},
        "varred": {"command": "${CLAUDE_PLUGIN_ROOT}/bin/x"},
        "leaky": {"type": "http", "url": "https://synth.example/mcp?token=" + canary},
        "envurl": {"type": "http", "url": "https://${SYNTH_HOST}/mcp"}}})
    inst = os.path.join(h, ".claude", "plugins", "cache", "mkt", "plug2", "1.0.0")
    os.makedirs(os.path.join(inst, ".claude-plugin"))
    write_json(os.path.join(inst, ".claude-plugin", "plugin.json"),
               {"name": "plug2", "mcpServers": {"local": {"command": "/bin/cat", "args": ["-u"]}}})
    write_json(os.path.join(h, ".claude", "plugins", "installed_plugins.json"),
               {"version": 2, "plugins": {"plug2@mkt": [{"installPath": inst, "scope": "user"}]}})
    if DARWIN:
        write_json(t["claude-desktop"], {"mcpServers": {"set-a": {"command": "/bin/echo"},
                                                        "desk-out": {"command": "/bin/echo"}}})
    return h, settings


class ActiveSet(unittest.TestCase):
    """Issue #219 (ADR-0041): every server outside the definition is turned off through each agent harness's
    own switch once "active_set" is declared, and uninstall turns back on exactly what install turned off."""

    def test_validation_parity_and_connectors(self):
        base = {"version": 1, "servers": {"a": {"command": "x"}}}
        self.assertEqual(r.validate(dict(base, active_set={})), [])
        self.assertEqual(r.validate(dict(base, active_set={"connectors": {"Synth": "on", "Other": "off"}})), [])
        narrow = {"version": 1, "servers": {"a": {"command": "x", "surfaces": ["codex", "claude-code"]}}}
        self.assertEqual(r.validate(narrow), [], "without an active set, surfaces may stay narrow")
        errs = r.validate(dict(narrow, active_set={}))
        self.assertTrue(any("parity" in e for e in errs), errs)
        wide = {"version": 1, "servers": {"a": {"command": "x", "surfaces": list(r.PARITY)}}, "active_set": {}}
        self.assertEqual(r.validate(wide), [])
        for bad in ([], {"connectors": []}, {"connectors": {"Synth": "maybe"}}, {"connectors": {" Synth": "on"}},
                    {"connectors": {"": "on"}}, {"unknown": 1}, {"description": 3}):
            self.assertTrue(r.validate(dict(base, active_set=bad)), bad)

    def test_schema_documents_the_active_set(self):
        schema = json.loads(read(SCHEMA))
        self.assertEqual(set(schema["properties"]["active_set"]["properties"]), r.ACTIVE_KEYS)

    def test_undeclared_turns_nothing_off(self):
        h, _ = active_home("home-active-undeclared", "synthetic-" + secrets.token_hex(8))
        write_source(h, {"version": 1, "servers": {"set-a": {"command": "/bin/echo"}}})
        before = fingerprint(h)
        for mode in ("check", "install"):
            p = active(h, mode)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertIn("SKIP    MCP active set: not declared", p.stdout)
        self.assertEqual(fingerprint(h), before, "an undeclared set writes nothing")
        os.remove(os.path.join(data(h), "local-overlay", "mcp-servers.json"))
        before = fingerprint(h)
        p = active(h, "install")
        self.assertEqual(p.returncode, 0)
        self.assertIn("no local MCP definition", p.stdout)
        self.assertEqual(fingerprint(h), before)

    def test_install_turns_off_check_is_clean_and_uninstall_restores(self):
        canary = "synthetic-" + secrets.token_hex(12)
        h, settings = active_home("home-active", canary)
        t = targets(h)
        seed = {k: read(v) for k, v in t.items()}
        seed_settings = read(settings)
        p = active(h, "check")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("DRIFT   codex: on outside the set: out-b, out-c (2)", p.stdout)
        self.assertIn("DRIFT   kiro: on outside the set: out-k, out-k2 (2)", p.stdout)
        self.assertIn("DRIFT   claude-code: on outside the set: out-u, plugin:plug2:local, plugin:plug1:web, "
                      "claude.ai Synth Off (4)", p.stdout)
        self.assertIn("plugin:plug1:varred, plugin:plug1:leaky, plugin:plug1:envurl (3)", p.stdout)
        if DARWIN:
            self.assertIn("REPORT  claude-desktop: ", p.stdout)
            self.assertIn("desk-out (1)", p.stdout)
        for kept in ("node_repl", "claude-in-chrome", "own-off", "chrome-devtools", "owners-own"):
            self.assertNotIn(kept, p.stdout, "exempt, the owner's own or a policy server: never reported")
        self.assertEqual({k: read(v) for k, v in t.items()}, seed, "check writes nothing")

        p = active(h, "install")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn(canary, p.stdout + p.stderr, "no value is ever printed")
        self.assertNotIn("synth.example", p.stdout + p.stderr, "no URL is ever printed")
        codex = tload(t["codex"])["mcp_servers"]
        self.assertEqual({n: s.get("enabled") for n, s in codex.items()},
                         {"set-a": None, "out-b": False, "out-c": False, "own-off": False, "node_repl": None})
        self.assertEqual(codex["out-b"]["env"], {"SYNTH": canary}, "the rest of the table is untouched")
        kiro = jload(t["kiro"])["mcpServers"]
        self.assertEqual({n: s.get("disabled") for n, s in kiro.items()},
                         {"set-a": None, "out-k": True, "out-k2": True, "own-off": True})
        self.assertEqual(jload(settings)["deniedMcpServers"], [
            {"serverName": "owners-own"}, {"serverName": "out-u"}, {"serverCommand": ["/bin/cat", "-u"]},
            {"serverUrl": "https://synth.example/mcp"}, {"serverName": "claude.ai Synth Off"}])
        self.assertNotIn(canary, read(settings), "a credential-looking URL is never copied into the settings")
        self.assertEqual(jload(settings)["model"], "synthetic")
        self.assertEqual(read(t["claude-code"]), seed["claude-code"], "~/.claude.json is read, never written")
        for path in (t["codex"], t["kiro"], settings):
            mode = stat.S_IMODE(os.stat(path + ".pmhwc-mcp-active-backup").st_mode)
            self.assertEqual(mode, 0o600, path)
        p = active(h, "check")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("DRIFT", p.stdout)
        self.assertNotIn("CHANGED", active(h, "install").stdout, "a second install changes nothing")

        p = active(h, "uninstall")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(read(t["codex"]), seed["codex"], "Codex: the edit is undone byte for byte")
        self.assertEqual(jload(t["kiro"]), json.loads(seed["kiro"]))
        self.assertEqual(jload(settings), json.loads(seed_settings), "only the owner's own deny entry stays")
        self.assertFalse(os.path.exists(r_manifest(h)), "the manifest held only the active record")

    def test_a_server_that_joins_the_set_or_an_undeclared_set_is_turned_back_on(self):
        h, settings = active_home("home-active-join", "synthetic-" + secrets.token_hex(8))
        t = targets(h)
        seed_codex = read(t["codex"])
        self.assertEqual(active(h, "install").returncode, 0)
        write_source(h, {"version": 1, "active_set": {},
                         "servers": {"set-a": {"command": "/bin/echo"}, "out-b": {"command": "/bin/echo"}}})
        p = active(h, "install")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("CHANGED codex: turned back on out-b (1)", p.stdout)
        self.assertIsNone(tload(t["codex"])["mcp_servers"]["out-b"].get("enabled"))
        self.assertNotIn({"serverName": "claude.ai Synth Off"}, jload(settings)["deniedMcpServers"],
                         "a connector no longer declared off is no longer denied")
        write_source(h, {"version": 1, "servers": {"set-a": {"command": "/bin/echo"}}})
        p = active(h, "install")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(read(t["codex"]), seed_codex, "an undeclared set restores what install turned off")
        self.assertEqual(jload(settings)["deniedMcpServers"], [{"serverName": "owners-own"}])

    def test_a_server_not_written_as_a_table_is_refused_and_the_rest_still_applies(self):
        h, _ = active_home("home-active-inline", "synthetic-" + secrets.token_hex(8))
        t = targets(h)
        with open(t["codex"], "a") as fh:
            fh.write("\n[mcp_servers]\ninline-x = { command = \"/bin/echo\" }\n")
        p = active(h, "install")
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertIn("inline-x", p.stderr)
        self.assertIsNone(tload(t["codex"])["mcp_servers"]["inline-x"].get("enabled"))
        self.assertTrue(jload(t["kiro"])["mcpServers"]["out-k"]["disabled"], "the other agent harnesses still apply")

    def test_policy_uninstall_keeps_the_active_record(self):
        h, settings = active_home("home-active-policy", "synthetic-" + secrets.token_hex(8))
        self.assertEqual(active(h, "install").returncode, 0)
        self.assertEqual(policy(h, "uninstall").returncode, 0)
        self.assertIn("active", jload(r_manifest(h)), "the policy mode never drops what the active set recorded")
        self.assertEqual(active(h, "uninstall").returncode, 0)
        self.assertEqual(jload(settings)["deniedMcpServers"], [{"serverName": "owners-own"}])

    def test_a_plugin_deny_that_would_block_a_kept_server_is_reported_not_written(self):
        """#222 (both reviews): Claude Code refuses a matching server "wherever it's defined", so a plugin
        server whose command or URL host equals a kept one's is reported, never denied. Kept: a set member (as
        configured and as rendered), the policy server, an exempt one; an unrelated plugin server is denied."""
        policy_cmd = [policy_entry()["command"]] + policy_entry()["args"]
        cases = (  # (plugin server, denied?)
            ({"command": "/bin/cat", "args": ["-u"]}, False),                           # = set member, configured
            ({"command": "/usr/bin/synth-rendered", "args": ["--x"]}, False),           # = set member, rendered only
            ({"type": "http", "url": "https://SET.example:443/other"}, False),          # same host as a set member
            ({"command": policy_cmd[0], "args": policy_cmd[1:]}, False),                # = the policy server
            ({"command": "/bin/synth-chrome"}, False),                                  # = an exempt server
            ({"command": "/bin/cat", "args": ["-n"]}, True),                            # unrelated command
            ({"type": "http", "url": "https://other.example/mcp"}, True))               # unrelated host
        for i, (server, denied) in enumerate(cases):
            with self.subTest(case=i):
                h = mk_home("home-active-collide-%d" % i)
                write_json(targets(h)["claude-code"], {"mcpServers": {
                    "set-a": {"type": "stdio", "command": "/bin/cat", "args": ["-u"]},
                    "set-web": {"type": "http", "url": "https://set.example/mcp"},
                    "claude-in-chrome": {"command": "/bin/synth-chrome"}}})
                write_source(h, {"version": 1, "active_set": {}, "servers": {
                    "set-a": {"command": "/bin/cat", "args": ["-u"]},
                    "set-r": {"command": "/usr/bin/synth-rendered", "args": ["--x"]},
                    "set-web": {"command": "/bin/echo"}}})
                synced = os.path.join(h, ".claude", "plugins", "synced", "src", "plug")
                os.makedirs(synced)
                write_json(os.path.join(synced, ".mcp.json"), {"mcpServers": {"p": server}})
                p = active(h, "install")
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                settings = os.path.join(h, ".claude", "settings.json")
                written = jload(settings).get("deniedMcpServers", []) if os.path.exists(settings) else []
                self.assertEqual(bool(written), denied, written)
                self.assertEqual("as a server kept on" in p.stdout, not denied, p.stdout)

    def test_deny_matches_expands_variables_and_wildcards(self):
        """A6 (#222): a kept server written with ${VAR} still matches the expanded command, and a wildcard
        serverUrl entry matches by pattern, case folded."""
        import mcp_active
        from unittest import mock
        kept = {"command": "${SYNTH_MCP_DIR}/bin/x", "args": ["-q"]}
        with mock.patch.dict(os.environ, {"SYNTH_MCP_DIR": "/synth"}):
            self.assertTrue(mcp_active.deny_matches({"serverCommand": ["/synth/bin/x", "-q"]}, "k", kept))
            self.assertFalse(mcp_active.deny_matches({"serverCommand": ["/other/bin/x", "-q"]}, "k", kept))
        self.assertTrue(mcp_active.deny_matches({"serverCommand": ["${SYNTH_MCP_DIR}/bin/x", "-q"]}, "k", kept))
        wild = {"serverUrl": "https://*.synth.example/*"}
        self.assertTrue(mcp_active.deny_matches(wild, "k", {"url": "https://A.Synth.Example/mcp"}))
        self.assertFalse(mcp_active.deny_matches(wild, "k", {"url": "https://other.example/mcp"}))
        self.assertFalse(mcp_active.deny_matches(wild, "k", {"command": "/bin/echo"}))

    def test_check_names_a_set_member_an_owners_deny_entry_blocks(self):
        h = mk_home("home-active-blocked")
        write_source(h, {"version": 1, "active_set": {}, "servers": {"set-a": {"command": "/bin/cat", "args": ["-u"]}}})
        write_json(targets(h)["claude-code"], {"mcpServers": {"set-a": {"command": "/bin/cat", "args": ["-u"]}}})
        write_json(os.path.join(h, ".claude", "settings.json"),
                   {"deniedMcpServers": [{"serverCommand": ["/bin/cat", "-u"]}]})
        p = active(h, "check")
        self.assertIn("ABSENT  claude-code: set member(s) blocked by a deniedMcpServers entry mhw did not write: "
                      "set-a (1)", p.stdout)

    def test_an_owners_empty_deny_list_is_kept_on_uninstall(self):
        h, settings = active_home("home-active-empty-deny", "synthetic-" + secrets.token_hex(8))
        write_json(settings, {"deniedMcpServers": []})
        self.assertEqual(active(h, "install").returncode, 0)
        self.assertTrue(jload(settings)["deniedMcpServers"])
        self.assertEqual(active(h, "uninstall").returncode, 0)
        self.assertEqual(jload(settings), {"deniedMcpServers": []})

    def test_a_server_in_the_managed_block_is_never_switched(self):
        """A table inside the renderer's managed block (ADR-0017) is the renderer's: the active set leaves it."""
        h, _ = active_home("home-active-block", "synthetic-" + secrets.token_hex(8))
        t = targets(h)
        with open(t["codex"], "a") as fh:
            fh.write("\n%s\n[mcp_servers.rendered-z]\ncommand = \"/bin/echo\"\n%s\n" % (r.BLOCK_BEGIN, r.BLOCK_END))
        p = active(h, "install")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("rendered-z", p.stdout)
        self.assertIsNone(tload(t["codex"])["mcp_servers"]["rendered-z"].get("enabled"))
        self.assertFalse(tload(t["codex"])["mcp_servers"]["out-b"]["enabled"])

    def test_a_committable_definition_is_refused(self):
        if not shutil.which("git"):
            self.skipTest("git not available")
        h = mk_home("home-active-git")
        repo = os.path.join(BASE, "an-active-git-repo")
        shutil.rmtree(repo, ignore_errors=True)
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        src = os.path.join(repo, "mcp-servers.json")
        write_json(src, {"version": 1, "servers": {}, "active_set": {}})
        p = active(h, "check", "--source=" + src)
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)
        self.assertIn("could be committed", p.stderr)

    def test_usage_errors(self):
        h = mk_home("home-active-usage")
        for args in (("--active", "--mode=report"), ("--active", "--stamp="), ("--active", "--adopt"),
                     ("--active", "--policy", "--mode=check")):
            self.assertEqual(run(h, *args).returncode, 2, args)

    @unittest.skipUnless(shutil.which("codex"), "codex is not on PATH")
    def test_codex_lists_the_server_as_disabled(self):
        """Probed: Codex itself reads the switch (codex mcp list --json, in a throwaway CODEX_HOME)."""
        h, _ = active_home("home-active-codex", "synthetic-" + secrets.token_hex(8))
        self.assertEqual(active(h, "install").returncode, 0)
        env = clean_env(h, CODEX_HOME=os.path.join(h, ".codex"))
        p = subprocess.run(["codex", "mcp", "list", "--json"], env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        listed = {s["name"]: s["enabled"] for s in json.loads(p.stdout)}
        self.assertEqual(listed, {"set-a": True, "out-b": False, "out-c": False, "own-off": False,
                                  "node_repl": True})



# ------------------------------------------------------------------------ the MCP connection check (#219)
# A tiny stdio MCP stub: it reads one request and answers by its mode. It writes a canary to stderr, which the
# check must never print, and its pid to a file, so a test can show the check killed it.
STUB_SERVER = r'''import json, os, sys, time
mode, pidfile = sys.argv[1], sys.argv[2]
open(pidfile, "w").write(str(os.getpid()))
sys.stderr.write("STDERR-CANARY-" + os.environ.get("SYNTH_CANARY", "") + "\n"); sys.stderr.flush()
if mode.startswith("fork-"):
    import subprocess
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
    open(pidfile + ".child", "w").write(str(child.pid))
    if mode == "fork-exit":
        sys.exit(3)
if mode == "argcheck" and (sys.argv[3:4] != ["expanded-value"] or os.environ.get("SYNTH_E") != "expanded-value"):
    sys.exit(5)
if mode == "exit":
    sys.exit(3)
req = json.loads(sys.stdin.readline())
if mode == "hang":
    time.sleep(600)
if mode == "needenv" and not os.environ.get("SYNTH_TOKEN"):
    sys.exit(4)
print("not json, a log line a server prints first"); sys.stdout.flush()
print(json.dumps({"jsonrpc": "2.0", "id": 99, "result": {}}))
if mode == "error":
    print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32603, "message": "x"}}))
else:
    print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "result": {"protocolVersion": "2025-06-18",
                      "capabilities": {}, "serverInfo": {"name": "synth", "version": "0"}}}))
sys.stdout.flush()
time.sleep(600)
'''


class _Stub:
    """A local HTTP stub: /ok answers 200, /login 401 with WWW-Authenticate, /bare401 401 without it, /missing
    404, /boom 500; /sse answers a GET with 200 and a POST with 405. Every body carries a canary the check must never print."""

    def __init__(self, canary):
        import http.server
        import threading
        stub = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def answer(self):
                stub.agents.append(self.headers.get("User-Agent", ""))
                stub.headers.append(dict(self.headers.items()))
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)
                code = {"/ok": 200, "/login": 401, "/bare401": 401, "/missing": 404, "/boom": 500,
                        "/sse": 200 if self.command == "GET" else 405}.get(self.path, 404)
                self.send_response(code)
                if self.path == "/login":
                    self.send_header("WWW-Authenticate", 'Bearer resource_metadata="x"')
                body = ("BODY-CANARY-" + canary).encode()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            do_POST = answer
            do_GET = answer

        self.agents, self.headers = [], []
        self.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def connect(home, *extra, env=None):
    return run(home, "--active", "--mode=connect", *extra, env=env)


def pid_alive(pidfile):
    try:
        os.kill(int(read(pidfile)), 0)
    except (OSError, ValueError):
        return False
    return True


class Connect(unittest.TestCase):
    """Issue #219, done-when bullet 3 (ADR-0041 amendment of 2026-10-24): an owner-run, opt-in check that starts
    each set member as each agent harness has it and says whether it answers an MCP initialize."""

    def test_http_results_map_to_ok_needs_login_and_fail(self):
        import mcp_connect as c
        stub = _Stub("synthetic-" + secrets.token_hex(6))
        try:
            got = {path: c.probe_http(stub.url + path, "http", 5)
                   for path in ("/ok", "/login", "/bare401", "/missing", "/boom")}
            got["sse"] = c.probe_http(stub.url + "/sse", "sse", 5)
        finally:
            stub.close()
        self.assertEqual(got, {"/ok": "ok", "/login": "needs login", "/bare401": "fail: http 401",
                               "/missing": "fail: http 404", "/boom": "fail: http 500", "sse": "ok"})
        self.assertTrue(all(a.startswith("mhw-mcp-connect/") for a in stub.agents), stub.agents)
        self.assertEqual(c.probe_http("http://127.0.0.1:9/mcp", "http", 3), "fail: unreachable")

    def test_stdio_members_are_started_as_each_harness_has_them_and_killed(self):
        canary = "synthetic-" + secrets.token_hex(8)
        h = mk_home("home-connect")
        stub_py = os.path.join(BASE, "mcp_stub_server.py")
        with open(stub_py, "w") as fh:
            fh.write(STUB_SERVER)
        pids = os.path.join(h, "pids")
        os.makedirs(pids)
        parity = ["codex", "claude-code", "kiro"]

        def server(mode, **more):
            return dict({"command": sys.executable, "args": [stub_py, mode, os.path.join(pids, mode)],
                         "surfaces": parity}, **more)

        doc = {"version": 1, "active_set": {}, "servers": {
            "s-ok": server("ok"), "s-err": server("error"), "s-exit": server("exit"), "s-hang": server("hang"),
            "s-secret": server("needenv", secrets={"SYNTH_TOKEN": "env:SYNTH_SRC"}),
            "s-web": {"command": "/bin/echo", "surfaces": parity}}}
        src = write_source(h, doc)
        self.assertEqual(run(h, "--source=" + src).returncode, 0, "the renderer writes every surface")
        stub = _Stub(canary)
        try:
            cc = jload(targets(h)["claude-code"])
            cc["mcpServers"]["s-web"] = {"type": "http", "url": stub.url + "/login"}
            # Not set members: the policy server and an exempt one are never started.
            started = os.path.join(h, "not-a-member-started")
            cc["mcpServers"]["chrome-devtools"] = {"command": "/usr/bin/touch", "args": [started]}
            cc["mcpServers"]["claude-in-chrome"] = {"command": "/usr/bin/touch", "args": [started]}
            write_json(targets(h)["claude-code"], cc)
            kiro = jload(targets(h)["kiro"])
            kiro["mcpServers"]["s-hang"]["disabled"] = True  # off in Kiro: not checked there
            write_json(targets(h)["kiro"], kiro)
            env = clean_env(h, SYNTH_SRC="synthetic-token", SYNTH_CANARY=canary)
            p = connect(h, "--timeout=3", env=env)
        finally:
            stub.close()
        out = p.stdout + p.stderr
        self.assertEqual(p.returncode, 1, out)
        for surface in parity:
            self.assertIn("OK      %s: s-ok: ok (MCP connect)" % surface, p.stdout)
            self.assertIn("FAIL    %s: s-err: fail: error response (MCP connect)" % surface, p.stdout)
            self.assertIn("FAIL    %s: s-exit: fail: exited 3 (MCP connect)" % surface, p.stdout)
            self.assertIn("OK      %s: s-secret: ok (MCP connect)" % surface, p.stdout,
                          "the secret reaches the server through mcp-launch.sh")
        self.assertIn("FAIL    codex: s-hang: fail: timeout (MCP connect)", p.stdout)
        self.assertNotIn("kiro: s-hang", p.stdout, "a member turned off on an agent harness is not checked there")
        self.assertIn("OK      claude-code: s-web: needs login (MCP connect)", p.stdout)
        self.assertNotIn(canary, out, "neither stderr nor a response body is printed")
        self.assertNotIn("synthetic-token", out)
        self.assertNotIn("127.0.0.1", out, "no URL is printed")
        self.assertNotIn(stub_py, out, "no command is printed")
        self.assertFalse(os.path.exists(started), "the policy server and an exempt server are not started")
        self.assertFalse(pid_alive(os.path.join(pids, "hang")), "a server that never answered is killed")
        self.assertFalse(pid_alive(os.path.join(pids, "ok")), "a server that answered is killed too")

    def test_all_ok_exits_zero_and_an_undeclared_set_checks_nothing(self):
        h = mk_home("home-connect-ok")
        stub_py = os.path.join(BASE, "mcp_stub_server.py")
        with open(stub_py, "w") as fh:
            fh.write(STUB_SERVER)
        src = write_source(h, {"version": 1, "active_set": {}, "servers": {"s-ok": {
            "command": sys.executable, "args": [stub_py, "ok", os.path.join(h, "pid")],
            "surfaces": ["codex", "claude-code", "kiro"]}}})
        self.assertEqual(run(h, "--source=" + src).returncode, 0)
        p = connect(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout.count(": s-ok: ok (MCP connect)"), 3, p.stdout)
        write_source(h, {"version": 1, "servers": {"s-ok": {"command": "/bin/echo"}}})
        p = connect(h)
        self.assertEqual(p.returncode, 0)
        self.assertIn("SKIP    MCP connect: no active set is declared", p.stdout)

    def _stub(self):
        stub_py = os.path.join(BASE, "mcp_stub_server.py")
        with open(stub_py, "w") as fh:
            fh.write(STUB_SERVER)
        return stub_py

    def _dead(self, pidfile):
        deadline = time.monotonic() + 5
        while pid_alive(pidfile) and time.monotonic() < deadline:
            time.sleep(0.1)
        return not pid_alive(pidfile)

    def test_behaviour_table(self):
        """#225 QA: one row per behaviour the amendment, the README row or the usage text states; each row fails
        when that behaviour is removed from mcp_connect.py."""
        import mcp_connect as c
        from unittest import mock
        stub_py = self._stub()
        d = os.path.join(BASE, "connect-table")
        os.makedirs(d, exist_ok=True)

        def argv(mode, extra=()):
            return [sys.executable, stub_py, mode, os.path.join(d, mode)] + list(extra)

        rows = []
        # M7, and the lens fix: the whole process group dies, on the answered and on the exited-first path.
        for mode, want in (("fork-ok", "ok"), ("fork-exit", "fail: exited 3")):
            got = c.probe_stdio(argv(mode), dict(os.environ), 10)
            rows.append(("group killed, " + mode, (got, self._dead(os.path.join(d, mode) + ".child")), (want, True)))
        # M12: ${VAR} in args and env is expanded for Claude Code and Kiro, and not for Codex (the control).
        entry = {"command": sys.executable, "args": [stub_py, "argcheck", os.path.join(d, "argcheck"), "${SYNTH_X}"],
                 "env": {"SYNTH_E": "${SYNTH_X}"}}
        with mock.patch.dict(os.environ, {"SYNTH_X": "expanded-value"}):
            for surface, want in (("claude-code", "ok"), ("kiro", "ok"), ("codex", "fail: exited 5")):
                rows.append(("expansion, " + surface, c.probe(surface, entry, 10), want))
        # M14: a default applies when the variable is unset.
        rows.append(("default", c.expand("${SYNTH_UNSET_X:-value}", {}), "value"))
        rows.append(("default, set wins", c.expand("${SYNTH_SET_X:-value}", {"SYNTH_SET_X": "mine"}), "mine"))
        # M9: a member with enabled = false in Codex is not checked there; without tomllib Codex is unread.
        h = mk_home("home-connect-table")
        with open(targets(h)["codex"], "w") as fh:
            fh.write('[mcp_servers.on-a]\ncommand = "/bin/echo"\n\n[mcp_servers.off-b]\nenabled = false\n'
                     'command = "/bin/echo"\n')
        with mock.patch.dict(os.environ, {"HOME": h}):
            os.environ.pop("CODEX_HOME", None)
            rows.append(("codex enabled = false", sorted(c.configured("codex")), ["on-a"]))
            with mock.patch.object(c.r, "tomllib", None):
                rows.append(("codex without tomllib", c.configured("codex"), None))
        # The http probe sends no configured header (a header can carry a credential).
        canary = "synthetic-" + secrets.token_hex(6)
        stub = _Stub("x")
        try:
            got = c.probe("claude-code", {"type": "http", "url": stub.url + "/ok", "headers": {"X-Synth-Auth": canary}}, 5)
        finally:
            stub.close()
        rows.append(("no configured header", (got, canary in json.dumps(stub.headers)), ("ok", False)))
        rows.append(("default timeout", c.DEFAULT_TIMEOUT, 30))
        for name, got, want in rows:
            with self.subTest(row=name):
                self.assertEqual(got, want)

    def test_connect_arguments(self):
        h = mk_home("home-connect-usage")
        for args in (("--active", "--mode=connect", "--timeout=0"), ("--active", "--mode=connect", "--timeout=x"),
                     ("--active", "--mode=check", "--timeout=5")):
            self.assertEqual(run(h, *args).returncode, 2, args)



# ------------------------------------------- a policy server extended by the local definition (#219)


def policy_copy(**change):
    """The local definition's copy of the policy server: its command and args, every surface by default."""
    s = r.load_policy()["servers"]["chrome-devtools"]
    out = {"command": s["command"], "args": list(s["args"])}
    out.update(change)
    return out


def codex_servers(home):
    p = targets(home)["codex"]
    return tload(p).get("mcp_servers", {}) if os.path.exists(p) else {}


def json_servers(home, surface):
    p = targets(home)[surface]
    return jload(p).get("mcpServers", {}) if os.path.exists(p) else {}


class PolicyExtension(unittest.TestCase):
    """ADR-0038 amendment (Issue #219): the local definition may extend a policy server to the surfaces the
    policy does not name. On the policy's own surfaces the policy's copy stays and the local copy is never
    written; a local copy that differs there is refused, that server alone."""

    def test_an_identical_copy_renders_on_the_other_surfaces_and_never_on_the_policys(self):
        h = mk_home("home-ext")
        cfg = targets(h)["claude-code"]
        write_source(h, source_doc({"chrome-devtools": policy_copy()}))
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("POLICY  claude-code: chrome-devtools rendered here by the policy servers", p.stdout)
        self.assertNotIn("chrome-devtools", json_servers(h, "claude-code"), "the local copy is never written there")
        self.assertEqual(policy(h, "install").returncode, 0, "the policy finds no hand-written copy in its way")
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        policy_server = r.load_policy()["servers"]["chrome-devtools"]
        self.assertEqual(codex_servers(h)["chrome-devtools"], r.entry("codex", policy_server, None))
        self.assertEqual(json_servers(h, "kiro")["chrome-devtools"], r.entry("kiro", policy_server, None))
        if DARWIN:
            self.assertEqual(json_servers(h, "claude-desktop")["chrome-devtools"],
                             r.entry("claude-desktop", policy_server, None))
        self.assertEqual(json_servers(h, "claude-code")["chrome-devtools"], policy_entry())
        for surface in ("codex", "kiro", "claude-code"):
            self.assertIn("fake-plain", codex_servers(h) if surface == "codex" else json_servers(h, surface))
        m = jload(r_manifest(h))
        self.assertNotIn("chrome-devtools", m["surfaces"].get("claude-code", []), "the policy's name there")
        self.assertIn("chrome-devtools", m["surfaces"]["kiro"])
        self.assertEqual(m["policy"]["claude-code"], ["chrome-devtools"])
        self.assertEqual(run(h, "--check").returncode, 0)
        self.assertEqual(policy(h, "check").returncode, 0)
        self.assertEqual(policy(h, "uninstall").returncode, 0)
        self.assertNotIn("chrome-devtools", json_servers(h, "claude-code"))
        self.assertIn("chrome-devtools", json_servers(h, "kiro"), "the policy never removes the local copies")
        self.assertEqual(run(h, "--check").returncode, 0, "nor does the local mode take the policy's surface over")

    def test_a_name_recorded_on_a_policy_surface_is_never_removed_by_the_local_mode(self):
        h = mk_home("home-ext-legacy")
        self.assertEqual(policy(h, "install").returncode, 0)
        m = jload(r_manifest(h))
        m["surfaces"] = {"claude-code": ["chrome-devtools"]}  # recorded by the local mode of an earlier release
        write_json(r_manifest(h), m)
        write_source(h, source_doc())
        p = run(h, "--surfaces=claude-code")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(json_servers(h, "claude-code")["chrome-devtools"], policy_entry())
        self.assertNotIn("chrome-devtools", jload(r_manifest(h))["surfaces"]["claude-code"])
        self.assertEqual(policy(h, "check").returncode, 0)

    def test_a_differing_copy_is_refused_alone_and_the_other_servers_render(self):
        h = mk_home("home-ext-conflict")
        different = policy_copy(args=["-c", "exec /bin/echo synthetic"])
        write_source(h, source_doc({"chrome-devtools": different}))
        p = run(h)
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertIn("REFUSE  chrome-devtools: a policy server", p.stderr)
        self.assertIn("differs from the policy's on claude-code", p.stderr)
        for surface in ("kiro", "claude-code"):
            self.assertIn("fake-plain", json_servers(h, surface), "one conflict never blocks the others")
            self.assertNotIn("chrome-devtools", json_servers(h, surface))
        self.assertIn("fake-plain", codex_servers(h))
        self.assertNotIn("chrome-devtools", codex_servers(h))
        # A copy mhw wrote earlier is kept as it is while the local copy is refused.
        write_source(h, source_doc({"chrome-devtools": policy_copy()}))
        self.assertEqual(run(h).returncode, 0)
        kiro_before, codex_before = json_servers(h, "kiro")["chrome-devtools"], codex_servers(h)["chrome-devtools"]
        write_source(h, source_doc({"chrome-devtools": different, "fake-new": {"command": "/bin/echo"}}))
        p = run(h)
        self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
        self.assertEqual(json_servers(h, "kiro")["chrome-devtools"], kiro_before)
        self.assertEqual(codex_servers(h)["chrome-devtools"], codex_before)
        self.assertIn("chrome-devtools", jload(r_manifest(h))["surfaces"]["kiro"], "still recorded as mhw's")
        self.assertIn("fake-new", json_servers(h, "kiro"))
        self.assertIn("fake-new", codex_servers(h))
        p = run(h, "--check")
        self.assertEqual(p.returncode, 3, "check refuses the conflict too")
        # Leaving the policy's surface out is an extension that cannot conflict.
        write_source(h, source_doc({"chrome-devtools": dict(different, surfaces=["codex", "kiro"])}))
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(codex_servers(h)["chrome-devtools"], r.entry("codex", different, None))

    def test_parity_counts_the_policy_surfaces(self):
        doc = {"version": 1, "active_set": {},
               "servers": {"chrome-devtools": policy_copy(surfaces=["codex", "kiro", "claude-desktop"])}}
        self.assertTrue(any("parity" in e for e in r.validate(doc)), "without the policy, claude-code is missing")
        self.assertEqual(r.validate(doc, covered=r.policy_surfaces()), [])
        narrow = {"version": 1, "active_set": {}, "servers": {"other": {"command": "x", "surfaces": ["codex", "kiro"]}}}
        self.assertTrue(any("parity" in e for e in r.validate(narrow, covered=r.policy_surfaces())),
                        "only a policy server's own surfaces count")

    def _set_home(self, name, copy):
        h = mk_home(name)
        write_source(h, {"version": 1, "active_set": {},
                         "servers": {"set-a": {"command": "/bin/echo", "surfaces": ["codex", "claude-code", "kiro"]},
                                     "chrome-devtools": copy}})
        self.assertEqual(policy(h, "install").returncode, 0)
        return h

    def test_the_active_set_agrees_with_the_render(self):
        h = self._set_home("home-ext-active", policy_copy())
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        p = active(h, "check")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("ABSENT", p.stdout, "no false ABSENT: not on desktop for set-a, not anywhere for the policy")
        self.assertNotIn("outside the set", p.stdout.replace("nothing on outside the set", ""))
        self.assertNotIn("REPORT", p.stdout)
        for surface in ("codex", "kiro", "claude-code"):
            self.assertIn("OK      %s: nothing on outside the set" % surface, p.stdout)
        if DARWIN:
            self.assertIn("chrome-devtools", json_servers(h, "claude-desktop"))
            self.assertNotIn("set-a", json_servers(h, "claude-desktop"))

    def test_an_extension_that_leaves_the_policy_surface_out_is_checked_there(self):
        h = mk_home("home-ext-active-out")
        write_source(h, {"version": 1, "active_set": {},
                         "servers": {"chrome-devtools": policy_copy(surfaces=["codex", "kiro"])}})
        p = run(h)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        p = active(h, "check")
        self.assertIn("ABSENT  claude-code: set member(s) not configured: chrome-devtools (1)", p.stdout,
                      "the policy's surface is the member's too, so a policy not installed is said")
        self.assertEqual(policy(h, "install").returncode, 0)
        p = active(h, "check")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("ABSENT", p.stdout)

    def test_the_active_set_reports_a_differing_copy(self):
        h = self._set_home("home-ext-active-conflict", policy_copy(args=["-c", "exec /bin/echo synthetic"]))
        self.assertEqual(run(h).returncode, 3)
        p = active(h, "check")
        self.assertIn("REPORT  claude-code: set member(s) whose local copy differs from the policy server's here",
                      p.stdout)
        self.assertIn("chrome-devtools (1)", p.stdout)
        self.assertIn("ABSENT  codex: set member(s) not configured: chrome-devtools (1)", p.stdout,
                      "the refused copy is not configured there, and that is said")
        self.assertNotIn("ABSENT  claude-code", p.stdout, "the policy's copy is configured there")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: mcp_render_test.py <empty-or-new base directory>")
    BASE = os.path.abspath(sys.argv.pop(1))
    os.makedirs(BASE, exist_ok=True)
    GUARD = make_guard(BASE)
    GUARD.install()
    unittest.main(verbosity=2)
