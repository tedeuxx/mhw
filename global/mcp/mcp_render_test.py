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


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: mcp_render_test.py <empty-or-new base directory>")
    BASE = os.path.abspath(sys.argv.pop(1))
    os.makedirs(BASE, exist_ok=True)
    GUARD = make_guard(BASE)
    GUARD.install()
    unittest.main(verbosity=2)
