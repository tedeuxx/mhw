#!/usr/bin/env python3
# Tests for mcp_render.py and mcp-launch.sh (ADR-0017). Everything runs under throwaway HOMEs:
#   python3 -B global/mcp/mcp_render_test.py <empty-or-new base directory>
# Every server, command and credential below is SYNTHETIC, and each credential value is generated at
# run time. On macOS, one test creates a namespaced Keychain item with a random value and deletes it.
# No test reads, prints or copies a real credential, and none touches the real HOME.
import hashlib
import json
import os
import secrets
import shutil
import stat
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mcp_render as r  # noqa: E402

RENDER = os.path.join(HERE, "mcp_render.py")
LAUNCH = os.path.join(HERE, "mcp-launch.sh")
EXAMPLE = os.path.join(HERE, "mcp-servers.example.json")
SCHEMA = os.path.join(HERE, "mcp-servers.schema.json")
DARWIN = sys.platform == "darwin"
BASE = None
REAL_HOME = os.path.expanduser("~")
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
        self.assertEqual(read(launcher).splitlines()[0], "#!/bin/sh")
        self.assertIn(r.MARKER_ID, read(launcher).splitlines()[1])
        for path in t.values():
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600, path)
        self.assertEqual(run(h, "--check").returncode, 0)
        before = fingerprint(h)
        self.assertEqual(run(h).returncode, 0)
        self.assertEqual(fingerprint(h), before, "a re-run changed a file")

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
        self.assertIsNotNone(r.owner_act_refusal("/h/real", {"CLAUDECODE": "1"}, "/h/real"))
        self.assertIsNotNone(r.owner_act_refusal("/h/real", {"CODEX_SANDBOX": "seatbelt"}, "/h/real"))
        self.assertIsNone(r.owner_act_refusal("/h/throwaway", {"CLAUDECODE": "1"}, "/h/real"))
        self.assertIsNone(r.owner_act_refusal("/h/real", {}, "/h/real"))


class Secrets(unittest.TestCase):
    def assert_value_reaches_server_only(self, h, value, server_env):
        """The value is in no file under the throwaway HOME, and the launched server sees it."""
        blob = all_bytes(h)
        self.assertNotIn(value.encode(), blob, "a secret value is in a rendered file")
        cx = tload(targets(h)["codex"])["mcp_servers"]["fake-secret"]
        out = os.path.join(BASE, "out-env.txt")
        if os.path.exists(out):
            os.remove(out)
        p = subprocess.run([cx["command"]] + cx["args"], env=server_env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(read(out), sha(value), "the server did not receive the secret")

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

    @unittest.skipUnless(DARWIN and os.path.exists("/usr/bin/security"), "macOS Keychain only")
    def test_keychain_secret_renders_names_only_and_launches_with_the_value(self):
        service = "%s.mcp-test-%d" % (r.PROJECT, os.getpid())
        value = "synthetic-" + secrets.token_hex(16)
        account = os.environ.get("USER") or str(os.getuid())
        cmd = 'add-generic-password -s "%s" -a "%s" -w "%s"\n' % (service, account, value)
        try:
            if subprocess.run(["/usr/bin/security", "-i"], input=cmd.encode(), capture_output=True).returncode:
                self.skipTest("the login Keychain is not writable here (locked or absent)")
            h = mk_home("home-keychain")
            doc = source_doc()
            doc["servers"]["fake-secret"]["secrets"] = {"FAKE_API_TOKEN": "keychain:" + service}
            write_source(h, doc)
            p = run(h)
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertNotIn(value, p.stdout + p.stderr)
            self.assertIn(service, read(targets(h)["codex"]), "the Keychain service NAME is rendered")
            # The launcher alone runs with the real HOME: `security` resolves the user's Keychain search
            # list from HOME, so under a throwaway HOME it finds no login Keychain at all (measured).
            self.assert_value_reaches_server_only(h, value, clean_env(REAL_HOME))
        finally:
            subprocess.run(["/usr/bin/security", "delete-generic-password", "-s", service, "-a", account],
                           capture_output=True)
        cx = tload(targets(h)["codex"])["mcp_servers"]["fake-secret"]
        p = subprocess.run([cx["command"]] + cx["args"], env=clean_env(REAL_HOME), capture_output=True, text=True)
        self.assertEqual(p.returncode, 3, "the launcher started a server after its Keychain item was deleted")
        self.assertIn("no readable Keychain item", p.stderr)
        self.assertNotIn(value, p.stderr)

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
        p = run(h, "--scan")
        self.assertEqual(p.returncode, 0, p.stderr)
        for v in vals:
            self.assertNotIn(v, p.stdout + p.stderr)
        for expect in ("svc-a\targs[0] --api-key <value>", "svc-a\tenv.SVC_TOKEN", "svc-r\tbearer_token",
                       "svc-b\targs[0] --password=<value>", "svc-b\theaders.Authorization", "svc-u\turl ("):
            self.assertIn(expect, p.stdout)
        self.assertNotIn("REGION", p.stdout)
        self.assertIn("backup\t%s.pmhwc-backup" % t["kiro"], p.stdout)

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
    unittest.main(verbosity=2)
