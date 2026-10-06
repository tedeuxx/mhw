#!/usr/bin/python3
# Tests for clipboard_guard.py, the paste filter at the harness-CLI prompt (ADR-0011). Everything runs
# under a throwaway base directory:
#   python3 -B clipboard_guard_test.py <empty-or-new base directory>
# Every term, token and identifier below is SYNTHETIC, and the credential-shaped ones are assembled at
# run time so that this file never contains a string a secret scanner would flag. Nothing here reads or
# writes the system clipboard. Issue #58: by default every Keychain test runs against
# global/security.test.stub, which never runs the real `security` binary; the tests that need the real
# binary or Security.framework are skipped. They run ONLY with PMHWC_REAL_KEYCHAIN_TESTS=1 on a GitHub
# Actions macOS runner (ephemeral; set in tests.yml). Without that opt-in, a guard installed for the whole
# run refuses any attempt to reach the real binary or framework, before anything runs. Either way each
# keychain is a THROWAWAY file under the base directory, named explicitly (keychain_path), the whole run
# uses a throwaway HOME, and the search list is never read or changed.
import io
import json
import os
import pty
import select
import stat
import subprocess
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clipboard_guard as g  # noqa: E402
sys.path.insert(0, os.path.dirname(HERE))
import keychain_test_guard as kg  # noqa: E402

BASE = None
SALT = "5a" * 32
TERM = "Zyxw Quillon Synthetic"          # a made-up three-word "employer" for tests
DARWIN = sys.platform == "darwin"
REAL_SLEEP = time.sleep


def tok(prefix, n, alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ234567"):
    return prefix + (alphabet * (n // len(alphabet) + 1))[:n]


def cpf(nine):
    d1 = g._mod11_digit(nine, range(10, 1, -1))
    d2 = g._mod11_digit(nine + str(d1), range(11, 1, -1))
    s = nine + "%d%d" % (d1, d2)
    return "%s.%s.%s-%s" % (s[:3], s[3:6], s[6:9], s[9:])


def cnpj(twelve):
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    d1 = g._mod11_digit(twelve, w1)
    d2 = g._mod11_digit(twelve + str(d1), [6] + w1)
    s = twelve + "%d%d" % (d1, d2)
    return "%s.%s.%s/%s-%s" % (s[:2], s[2:5], s[5:8], s[8:12], s[12:])


def luhn_complete(prefix15):
    for last in "0123456789":
        if g._luhn_ok(prefix15 + last):
            return prefix15 + last
    raise AssertionError


CREDENTIALS = {
    "aws": tok("AKIA", 16),
    "github": tok("gh" + "p_", 36, "abcdefghijkmnpqrstuvwxyz0123456789"),
    "slack": tok("xo" + "xb-", 24, "0123456789abcdef-"),
    "google": tok("AI" + "za", 35, "abcdefghijkmnpqrstuvwxyz0123456789_-"),
    "stripe": tok("sk_" + "live_", 24, "abcdefghijkmnpqrstuvwxyz0123456789"),
    "anthropic": tok("sk-" + "ant-", 30, "abcdefghijkmnpqrstuvwxyz0123456789"),
    "jwt": "ey" + "J" + tok("", 20, "abcdefghij") + ".ey" + "J" + tok("", 20, "klmnopqrst") + "." + tok("", 20, "uvwxyz0123"),
    "private-key": "-----BEGIN " + "RSA PRIVATE KEY-----\n" + tok("", 64, "abcdefghij") + "\n-----END " + "RSA PRIVATE KEY-----",
}


# ------------------------------------------------------------------------- real-keychain guard (#58)
# The shared guard (global/keychain_test_guard.py) holds the rules; this suite adds the hook child's
# and the Security.framework lock probe's. lock-keychain is the one extra verb this suite needs.
GUARD = None                            # set in __main__, once BASE is known
_REAL_PROBE = g.keychain_unlocked


def hook_child_check(guard, argv, kw):
    """A hook child process reading the Keychain runs the real binary and framework itself."""
    if g.__file__ in argv and "--config" in argv:
        conf = g.load_config(argv[argv.index("--config") + 1])
        if conf["salt_store"] == "keychain":
            guard.require_real("a hook child reading the Keychain")
            if not (guard.home_ok(kw) and guard.security_ok(["find-generic-password", conf["keychain_path"] or "-"], None)):
                raise kg.RealKeychainRefused("a child process was configured for the real keychain")


def guarded_probe(path=None):
    GUARD.require_real("the Security.framework lock probe")
    if path is None or not GUARD.under_base(path) or not GUARD.home_ok():
        raise kg.RealKeychainRefused("the lock probe was pointed at the default keychain or ran under the real HOME")
    return _REAL_PROBE(path)


def make_guard(base):
    return kg.Guard(base, verbs=kg.BASE_VERBS | {"lock-keychain"}, inherit_home=True, extra=hook_child_check,
                    watched=(os.path.basename(g.__file__),))


def use_throwaway_home():
    """Point this process's HOME, inherited by every child including production `security` calls, at a
    throwaway directory under BASE (#58)."""
    home = os.path.join(BASE, "keychain-home")
    os.makedirs(home, exist_ok=True)
    os.environ["HOME"] = home


def install_keychain_guard():
    GUARD.install()
    g.keychain_unlocked = guarded_probe


def throwaway_keychain(name):
    return GUARD.create_keychain(name)


def drop_keychain(path):
    GUARD.delete_keychain(path)


class KeychainIsolation(unittest.TestCase):
    """The one guard against #58: without the CI opt-in no test may reach the real `security` binary or
    Security.framework, and with it no test may reach the login or default keychain or the search list.
    Nothing in this test executes a process; a broken guard makes it fail, never touch a keychain."""

    def test_no_test_path_can_reach_the_real_keychain(self):
        global _REAL_PROBE
        G = GUARD
        G.assert_mode(self)
        self.assertIs(g.keychain_unlocked, guarded_probe)
        self.assertTrue(G.home_ok(), "this run's HOME is not a throwaway one")
        kc = os.path.join(BASE, "never-created.keychain-db")
        outside = {"env": {"HOME": os.path.dirname(os.path.realpath(BASE))}}
        child_conf = conf_in(os.path.join(BASE, "kc-guard-child"), salt_store="keychain", keychain_path=kc)
        child = [sys.executable, g.__file__, "prompt-hook", "--harness", "claude", "--config", child_conf]
        refused_always = G.refused_cases(kc, {}, outside) + [(child, outside)]
        real_only = G.real_only_cases(kc, {}) + [(child, {})]
        default = g.load_config(conf_in(os.path.join(BASE, "kc-guard-default"), salt_store="keychain"))
        conf = g.load_config(conf_in(os.path.join(BASE, "kc-guard"), salt_store="keychain", keychain_path=kc))
        calls, stored, probes = [], [SALT], []

        def fake(argv, **kw):          # records, executes nothing, answers like `security` would
            calls.append((list(argv), kw.get("input")))
            if kw.get("input"):
                stored[0] = kw["input"].decode().split('-w "', 1)[1].split('"', 1)[0]
            return subprocess.CompletedProcess(argv, 0, stdout=(stored[0] + "\n").encode(), stderr=b"")
        saved = (G.exec, G.real, _REAL_PROBE)
        try:
            G.exec = lambda *a, **k: self.fail("the guard let a real-keychain call through: %r" % (a[:1],))
            _REAL_PROBE = lambda *a: self.fail("the guard let the Security.framework probe run")
            G.assert_refused(self, real_only, False)
            # Production code with a throwaway path still reaches the real binary and framework: refused.
            for attempt in (lambda: g.SaltStore(conf, G.guarded_run).create(), lambda: g.keychain_unlocked(kc)):
                with self.assertRaises(kg.RealKeychainRefused):
                    attempt()
            for flag in (False, True):
                G.real = flag
                for interactive in (True, False):
                    with self.assertRaises(kg.RealKeychainRefused):
                        g.SaltStore(default, G.guarded_run, interactive=interactive, lock_probe=lambda *a: True).get()
                for attempt in (lambda: g.SaltStore(default, G.guarded_run).create(), g.keychain_unlocked):
                    with self.assertRaises(kg.RealKeychainRefused):
                        attempt()
                G.assert_refused(self, refused_always, flag)
            # With the opt-in, the production code given a throwaway path must name it on EVERY call.
            G.exec, G.real = fake, True
            g.SaltStore(conf, G.guarded_run).create()
            g.SaltStore(conf, G.guarded_run, interactive=False, lock_probe=lambda *a: probes.append(a) or True).get()
            # Without it, the same calls through the stub are allowed.
            G.real = False
            g.SaltStore(conf, G.stub_run).create()
        finally:
            G.exec, G.real, _REAL_PROBE = saved
        self.assertEqual(probes, [(kc,)], "the lock probe was not pointed at the throwaway keychain")
        self.assertEqual([c[0][0] for c in calls], [kg.REAL_SECURITY] * 3 + [kg.SECURITY_STUB] * 2)
        for argv, data in calls:
            self.assertTrue(argv[-1] == kc or (argv[1:] == ["-i"] and data.decode().rstrip().endswith('"%s"' % kc)), argv[:2])


class FakeSalts:
    def __init__(self, value=SALT):
        self.value = value

    def get(self):
        return self.value


def conf_in(d, **over):
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "clipboard.conf")
    lines = ["salt_store=file", "terms_file=%s" % os.path.join(d, "lo", "terms"),
             "salt_file=%s" % os.path.join(d, "lo", "salt")] + ["%s=%s" % kv for kv in over.items()]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return path


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def tree(d):
    """(path, size, mtime) of every file under d: what 'nothing was written' is checked against."""
    out = []
    for root, dirs, files in os.walk(d):
        for f in dirs + files:
            p = os.path.join(root, f)
            st = os.lstat(p)
            out.append((p, st.st_size, st.st_mtime_ns))
    return sorted(out)


class Normalisation(unittest.TestCase):
    def test_variants_match_one_term(self):
        hashes = frozenset(g.term_hash(SALT, f) for f in g.term_forms(TERM))
        for variant in ["ZYXW quillon synthetic", "zyxw-Quillon_synthetic!", "Zÿxw Quillón Synthétic",
                        "ZyxwQuillonSynthetic", "a\nZyxw\tQuillon  Synthetic\nb"]:
            spans = g.find_spans(variant, hashes, SALT)
            self.assertEqual(g.categories(spans), ["employer-client-term"], variant)

    def test_partial_and_neighbours_do_not_match(self):
        hashes = frozenset(g.term_hash(SALT, f) for f in g.term_forms(TERM))
        for text in ["Zyxw Quillon", "Quillon Synthetic", "Zyxw Quillons Synthetic", "zyxwquillon"]:
            self.assertEqual(g.find_spans(text, hashes, SALT), [], text)

    def test_hash_depends_on_salt_and_is_not_plaintext(self):
        a = g.term_hash(SALT, "zyxw quillon synthetic")
        b = g.term_hash("6b" * 32, "zyxw quillon synthetic")
        self.assertNotEqual(a, b)
        self.assertRegex(a, r"^[0-9a-f]{64}$")

    def test_without_salt_no_term_matching(self):
        hashes = frozenset(g.term_hash(SALT, f) for f in g.term_forms(TERM))
        self.assertEqual(g.find_spans(TERM, hashes, None), [])


class TermFile(unittest.TestCase):
    def test_file_holds_hashes_only_user_only_modes(self):
        d = os.path.join(BASE, "termfile")
        path = os.path.join(d, "lo", "terms")
        n = g.add_term_hashes(path, [g.term_hash(SALT, f) for f in g.term_forms(TERM)])
        self.assertEqual(n, 2)
        self.assertEqual(g.add_term_hashes(path, [g.term_hash(SALT, f) for f in g.term_forms(TERM)]), 0)
        body = read(path).lower()
        for word in ("zyxw", "quillon", "synthetic"):
            self.assertNotIn(word, body)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode), 0o700)
        self.assertEqual(len(g.read_terms(path)), 2)


class Salt(unittest.TestCase):
    def test_file_store(self):
        d = os.path.join(BASE, "salt-file")
        conf = g.load_config(conf_in(d))
        store = g.SaltStore(conf)
        self.assertIsNone(store.get())
        value = store.get_or_create()
        self.assertRegex(value, r"^[0-9a-f]{64}$")
        self.assertEqual(store.get_or_create(), value)
        self.assertEqual(stat.S_IMODE(os.stat(conf["salt_file"]).st_mode), 0o600)
        with open(conf["salt_file"], "w") as fh:
            fh.write("not-a-salt\n")
        self.assertIsNone(store.get())

    @unittest.skipUnless(DARWIN, "macOS Keychain only")
    def test_keychain_store_keeps_salt_out_of_argv(self):
        service = "%s.clipboard-salt.test-%d" % (g.PROJECT, os.getpid())
        d = os.path.join(BASE, "salt-keychain")
        kc = throwaway_keychain("salt-store")
        conf = g.load_config(conf_in(d, salt_store="keychain", keychain_service=service, keychain_path=kc))
        seen = []

        def run(argv, **kw):
            seen.append(list(argv))
            return GUARD.stub_run(argv, **kw)
        try:
            try:
                value = g.SaltStore(conf, run).create()
            except RuntimeError:
                self.skipTest("the throwaway keychain is not writable here")
            self.assertEqual(g.SaltStore(conf, GUARD.stub_run).get(), value)
            self.assertTrue(all(value not in " ".join(a) for a in seen), "the salt reached a process argv")
            self.assertTrue(all(a[-1] == kc for a in seen if a[1:] != ["-i"]), "a call did not name the throwaway keychain")
            subprocess.run([GUARD.security, "delete-generic-password", "-s", service, "-a", g._account(), kc],
                           capture_output=True)
            self.assertIsNone(g.SaltStore(conf, GUARD.stub_run).get(), "the throwaway Keychain item was not deleted")
        finally:
            drop_keychain(kc)


class Patterns(unittest.TestCase):
    def test_each_credential_is_found_and_redacted(self):
        for name, secret in CREDENTIALS.items():
            text = "config: %s # end" % secret
            spans = g.find_spans(text)
            self.assertIn("credential", g.categories(spans), name)
            out = g.sanitise(text, spans)
            self.assertNotIn(secret, out, name)
            self.assertIn("[REDACTED:credential]", out, name)

    def test_email(self):
        self.assertEqual(g.categories(g.find_spans("write to ana.example@zyxw-mail.zyxw today")), ["email"])
        for benign in ["git@github.com:owner/repo.git", "user@example.com", "x@host.test", "1+me@users.noreply.github.com"]:
            self.assertEqual(g.find_spans(benign), [], benign)

    def test_brazilian_ids_need_valid_check_digits(self):
        good, bad = cpf("529982247"), cpf("529982247")[:-1] + "0"
        self.assertEqual(g.categories(g.find_spans("CPF " + good)), ["cpf"])
        self.assertEqual(g.find_spans("CPF " + bad if bad != good else "CPF 111.111.111-11"), [])
        self.assertEqual(g.find_spans("111.111.111-11"), [])
        self.assertEqual(g.categories(g.find_spans("CNPJ " + cnpj("112223330001"))), ["cnpj"])

    def test_card_needs_luhn_and_a_card_prefix(self):
        card = luhn_complete("411111111111111")
        self.assertEqual(g.categories(g.find_spans("card %s-%s-%s-%s" % (card[:4], card[4:8], card[8:12], card[12:]))),
                         ["payment-card"])
        wrong = card[:-1] + str((int(card[-1]) + 1) % 10)
        self.assertEqual(g.find_spans("card " + wrong), [])
        self.assertEqual(g.find_spans("order " + luhn_complete("911111111111111")), [])

    def test_ordinary_engineering_text_is_clean(self):
        text = ("commit 3f1e2d4c5b6a79880f1e2d4c5b6a79880f1e2d4c\nuuid 123e4567-e89b-12d3-a456-426614174000\n"
                "ssh git@github.com:o/r.git, port 8080, build 20261001, sk-test-shaped words, AKIA lowercase akia")
        self.assertEqual(g.find_spans(text), [])

    def test_overlapping_findings_merge(self):
        text = "x " + CREDENTIALS["aws"] + " y"
        spans = [(2, 10, "credential"), (5, 22, "employer-client-term")]
        self.assertEqual(g.sanitise(text, spans), "x [REDACTED:credential] y")


def hook_conf(name, **over):
    d = os.path.join(BASE, name)
    conf = g.load_config(conf_in(d, **over))
    return d, conf


def with_term(conf, term=TERM):
    g.add_term_hashes(conf["terms_file"], [g.term_hash(SALT, f) for f in g.term_forms(term)])


def decide(conf, prompt, harness="claude", salts=None):
    out = io.StringIO()
    payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt}).encode()
    g.cmd_prompt_hook(conf, harness, io.BytesIO(payload), out, salts or FakeSalts())
    text = out.getvalue()
    return (json.loads(text) if text else None), text


def decide_default_salts(conf, prompt):
    """Like decide(), but the hook builds its own SaltStore, exactly as in production."""
    out = io.StringIO()
    payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt}).encode()
    g.cmd_prompt_hook(conf, "claude", io.BytesIO(payload), out)
    text = out.getvalue()
    return (json.loads(text) if text else None), text


class PromptHook(unittest.TestCase):
    def assert_no_content(self, text, prompt):
        low = text.lower()
        for word in g.tokens(TERM):
            self.assertNotIn(word[2], low, "a term word reached the hook output")
        for secret in CREDENTIALS.values():
            self.assertNotIn(secret.lower()[:24], low, "a secret reached the hook output")
        self.assertNotIn("ana@zyxw-mail.zyxw", low)

    def test_clean_prompt_prints_nothing(self):
        d, conf = hook_conf("hook-clean")
        with_term(conf)
        out, raw = decide(conf, "refactor the parser; see commit 3f1e2d4 and git@github.com:o/r.git")
        self.assertIsNone(out)
        self.assertEqual(raw, "", "a clean prompt printed something (it would become model context)")

    def test_every_category_blocks(self):
        d, conf = hook_conf("hook-each")
        with_term(conf)
        cases = {"employer-client-term": "notes for " + TERM.lower(), "email": "mail ana@zyxw-mail.zyxw",
                 "cpf": "CPF " + cpf("529982247"), "cnpj": "CNPJ " + cnpj("112223330001"),
                 "payment-card": "card " + luhn_complete("411111111111111")}
        cases.update({"credential/" + k: "use " + v for k, v in CREDENTIALS.items()})
        for name, prompt in cases.items():
            out, raw = decide(conf, prompt)
            self.assertEqual(out and out.get("decision"), "block", name)
            self.assertIn(name.split("/")[0], out["reason"], name)
            self.assert_no_content(raw, prompt)

    def test_the_block_message_never_carries_the_term_or_the_original(self):
        d, conf = hook_conf("hook-notice")
        with_term(conf)
        prompt = "deploy for %s with %s, mail ana@zyxw-mail.zyxw" % (TERM, CREDENTIALS["github"])
        for harness in ("claude", "codex"):
            out, raw = decide(conf, prompt, harness)
            self.assertEqual(out["decision"], "block")
            self.assertIn("employer-client-term, credential, email", out["reason"])
            self.assertIn("deploy for [REDACTED:employer-client-term] with [REDACTED:credential], mail "
                          "[REDACTED:email]", out["reason"], "the redacted copy is missing")
            self.assert_no_content(raw, prompt)
        out, _ = decide(conf, prompt, "claude")
        # Without this flag Claude Code appends "Original prompt:" and the submitted text (documented).
        self.assertIs(out["hookSpecificOutput"]["suppressOriginalPrompt"], True)
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        out, _ = decide(conf, prompt, "codex")
        self.assertNotIn("hookSpecificOutput", out)

    def test_paste_marker_lines_are_not_in_the_copy(self):
        d, conf = hook_conf("hook-markers")
        prompt = 'look at this\n<pasted_content id="p1">\nkey %s\n</pasted_content id="p1">\nthanks' % CREDENTIALS["aws"]
        out, _ = decide(conf, prompt)
        self.assertIn("look at this\nkey [REDACTED:credential]\nthanks", out["reason"])
        self.assertNotIn("pasted_content", out["reason"])

    def test_block_categories_narrow_and_a_typo_restores_all(self):
        d, conf = hook_conf("hook-narrow", block_categories="credential,employer-client-term")
        self.assertIsNone(decide(conf, "mail ana@zyxw-mail.zyxw")[0])
        self.assertEqual(decide(conf, "key " + CREDENTIALS["aws"])[0]["decision"], "block")
        d, conf = hook_conf("hook-typo", block_categories="credential,emial")
        self.assertEqual(decide(conf, "mail ana@zyxw-mail.zyxw")[0]["decision"], "block")

    def test_hook_keychain_read_is_gated_bounded_and_non_interactive(self):
        """The hook's Keychain path (the owner's real configuration since he added a term): it calls
        /usr/bin/security only when the lock probe says the keychain is UNLOCKED, with a timeout and no
        stdin, never `security -i`; a locked or unknown keychain is never touched and is reported."""
        d, conf = hook_conf("hook-kc", salt_store="keychain", keychain_service="pmhwc.test.not-real")
        with_term(conf)
        calls = []

        def fake_run(argv, **kw):
            calls.append((list(argv), kw))
            return subprocess.CompletedProcess(argv, 0, (SALT + "\n").encode(), b"")
        real_run, real_probe = g.subprocess.run, g.keychain_unlocked
        try:
            g.subprocess.run = fake_run
            for state in (False, None):
                g.keychain_unlocked = lambda state=state: state
                out, raw = decide_default_salts(conf, "notes for " + TERM)
                self.assertEqual(calls, [], "security was called with the keychain %r" % state)
                self.assertNotIn("decision", out)
                self.assertIn("NOT checked", out["systemMessage"])
            g.keychain_unlocked = lambda: True
            out, raw = decide_default_salts(conf, "notes for " + TERM)
            self.assertEqual(out["decision"], "block")
            self.assertEqual(len(calls), 1)
            argv, kw = calls[0]
            self.assertEqual(argv[:2], ["/usr/bin/security", "find-generic-password"])
            self.assertNotIn("-i", argv)
            self.assertEqual(kw.get("timeout"), g.KEYCHAIN_READ_SECONDS)
            self.assertLessEqual(g.KEYCHAIN_READ_SECONDS, 2)
            self.assertIs(kw.get("stdin"), subprocess.DEVNULL)

            def slow(argv, **kw):
                raise subprocess.TimeoutExpired(argv, kw.get("timeout"))
            g.subprocess.run = slow
            out, raw = decide_default_salts(conf, "notes for " + TERM)
            self.assertIn("NOT checked", out["systemMessage"])
        finally:
            g.subprocess.run, g.keychain_unlocked = real_run, real_probe

    def test_file_salt_branch_starts_no_process(self):
        """With salt_store=file the hook must start no subprocess at all, `security` included. A PATH
        fake cannot see /usr/bin/security (absolute path), so this injects at subprocess.run itself."""
        d, conf = hook_conf("hook-file-noproc")
        salt = g.SaltStore(conf).get_or_create()
        g.add_term_hashes(conf["terms_file"], [g.term_hash(salt, f) for f in g.term_forms(TERM)])
        calls = []
        real_run, real_popen, real_probe = g.subprocess.run, g.subprocess.Popen, g.keychain_unlocked

        def record(*a, **k):
            calls.append(a[0] if a else k.get("args"))
            raise AssertionError("the file-salt hook path started a process")
        try:
            g.subprocess.run = g.subprocess.Popen = record
            g.keychain_unlocked = lambda *a: calls.append("keychain_unlocked") or True
            out, raw = decide_default_salts(conf, "notes for " + TERM)
        finally:
            g.subprocess.run, g.subprocess.Popen, g.keychain_unlocked = real_run, real_popen, real_probe
        self.assertEqual(calls, [], "the file-salt branch touched the Keychain or started a process")
        self.assertEqual(out["decision"], "block")

    @unittest.skipUnless(kg.real_opt_in(), "real Keychain: CI macOS opt-in only (PMHWC_REAL_KEYCHAIN_TESTS=1)")
    def test_hook_process_reads_a_real_namespaced_keychain_salt(self):
        """A real prompt-hook process against a THROWAWAY keychain file, under the throwaway HOME, through
        the real lock probe and the real `security` read. The keychain is deleted afterwards."""
        service = "%s.clipboard-salt.hooktest-%d" % (g.PROJECT, os.getpid())
        kc = throwaway_keychain("hook-real")
        d, conf = hook_conf("hook-kc-real", salt_store="keychain", keychain_service=service, keychain_path=kc)
        try:
            try:
                salt = g.SaltStore(conf).create()
            except RuntimeError:
                self.skipTest("the throwaway keychain is not writable here")
            g.add_term_hashes(conf["terms_file"], [g.term_hash(salt, f) for f in g.term_forms(TERM)])
            payload = json.dumps({"prompt": "ship it for " + TERM}).encode()
            py = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable
            r = subprocess.run([py, "-I", "-B", g.__file__, "prompt-hook", "--harness", "claude", "--config",
                                os.path.join(d, "clipboard.conf")], input=payload, capture_output=True, timeout=30)
            self.assertEqual((r.returncode, r.stderr), (0, b""))
            out = json.loads(r.stdout)
            self.assertIs(g.keychain_unlocked(kc), True)
            self.assertEqual(out["decision"], "block")
            self.assertNotIn(b"quillon", r.stdout.lower())
        finally:
            drop_keychain(kc)
        self.assertFalse(os.path.exists(kc), "the throwaway keychain was not deleted")

    @unittest.skipUnless(kg.real_opt_in(), "real Keychain: CI macOS opt-in only (PMHWC_REAL_KEYCHAIN_TESTS=1)")
    def test_lock_probe_reports_a_locked_throwaway_keychain_without_waiting(self):
        """A THROWAWAY keychain file under the test's base directory (never the login keychain), locked:
        the probe must say False at once. A probe that waited on an unlock dialog would take seconds."""
        kc = throwaway_keychain("probe")
        try:
            self.assertIs(g.keychain_unlocked(kc), True)
            subprocess.run([GUARD.security, "lock-keychain", kc], check=True, capture_output=True)
            t = time.monotonic()
            self.assertIs(g.keychain_unlocked(kc), False)
            self.assertLess(time.monotonic() - t, 1.0)
        finally:
            drop_keychain(kc)
        self.assertFalse(os.path.exists(kc))
        # The search list is deliberately NOT compared before and after: reading it is itself refused (#58).

    def test_too_large_warns_and_passes(self):
        d, conf = hook_conf("hook-large", max_bytes="100")
        out, raw = decide(conf, "key " + CREDENTIALS["aws"] + " " + "a" * 200)
        self.assertNotIn("decision", out)
        self.assertIn("NOT checked", out["systemMessage"])
        self.assert_no_content(raw, "")

    def test_missing_salt_warns_and_generic_categories_still_block(self):
        d, conf = hook_conf("hook-nosalt")
        with_term(conf)
        out, _ = decide(conf, "hello " + TERM, salts=FakeSalts(None))
        self.assertIn("term matching was NOT checked", out["systemMessage"])
        out, _ = decide(conf, "hello key " + CREDENTIALS["aws"], salts=FakeSalts(None))
        self.assertEqual(out["decision"], "block")
        self.assertIn("term matching was NOT checked", out["reason"])

    def test_long_redacted_copy_is_not_shown(self):
        d, conf = hook_conf("hook-long", show_cleaned_chars="50")
        out, _ = decide(conf, "key " + CREDENTIALS["aws"] + " " + "word " * 40)
        self.assertEqual(out["decision"], "block")
        self.assertIn("too long to show", out["reason"])
        self.assertNotIn("word word", out["reason"])

    def test_bad_payload_fails_open_visibly_with_class_only(self):
        d, conf = hook_conf("hook-bad")
        for raw in (b"not json " + CREDENTIALS["aws"].encode(), json.dumps({"prompt": 3}).encode(), b"[]"):
            out = io.StringIO()
            g.cmd_prompt_hook(conf, "claude", io.BytesIO(raw), out, FakeSalts())
            msg = json.loads(out.getvalue())
            self.assertNotIn("decision", msg)
            self.assertIn("NOT checked", msg["systemMessage"])
            self.assertNotIn(CREDENTIALS["aws"], out.getvalue())

    def test_overlay_template_with_a_bad_placeholder_falls_back(self):
        d, conf = hook_conf("hook-tmpl")
        conf["notice_blocked"] = "broken {nope}"
        out, _ = decide(conf, "key " + CREDENTIALS["aws"])
        self.assertIn("It was NOT sent", out["reason"])

    def test_hook_process_writes_nothing_and_touches_no_os_surface(self):
        """A real `prompt-hook` process, as a harness runs it, in a throwaway HOME, with fake pbcopy,
        pbpaste, osascript and launchctl on PATH that record any call: the filter must call none of
        them (no clipboard, no OS dialog or notification), print only its JSON and write no file.
        The fake `security` here proves NOTHING: the code calls /usr/bin/security by absolute path,
        which a PATH fake never sees. test_file_salt_branch_starts_no_process covers that."""
        d, conf_unused = hook_conf("hook-proc")
        conf_path = os.path.join(d, "clipboard.conf")
        home = os.path.join(d, "home")
        fakes = os.path.join(d, "fakebin")
        os.makedirs(home)
        os.makedirs(fakes)
        calls = os.path.join(BASE, "hook-proc-calls")
        for tool in ("pbcopy", "pbpaste", "osascript", "security", "launchctl"):
            path = os.path.join(fakes, tool)
            with open(path, "w") as fh:
                fh.write('#!/bin/sh\necho "%s" >> "%s"\n' % (tool, calls))
            os.chmod(path, 0o755)
        g.add_term_hashes(g.load_config(conf_path)["terms_file"], [])
        salt = g.SaltStore(g.load_config(conf_path)).get_or_create()
        with_term_conf = g.load_config(conf_path)
        g.add_term_hashes(with_term_conf["terms_file"], [g.term_hash(salt, f) for f in g.term_forms(TERM)])
        snap = tree(d)
        env = {"HOME": home, "TMPDIR": home, "PATH": fakes + ":/usr/bin:/bin"}
        py = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable
        for prompt, blocked in (("ship it for " + TERM, True), ("ship it", False)):
            payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt}).encode()
            r = subprocess.run([py, "-I", "-B", g.__file__, "prompt-hook", "--harness", "claude", "--config", conf_path],
                               input=payload, capture_output=True, env=env, timeout=60)
            self.assertEqual((r.returncode, r.stderr), (0, b""), prompt)
            if blocked:
                self.assertEqual(json.loads(r.stdout)["decision"], "block")
                self.assertNotIn(b"quillon", r.stdout.lower())
            else:
                self.assertEqual(r.stdout, b"")
        self.assertEqual(tree(d), snap, "the hook wrote to disk")
        self.assertFalse(os.path.exists(calls), "the hook called an OS surface: %s" % (read(calls) if os.path.exists(calls) else ""))

    def test_the_source_has_no_os_surface(self):
        """The owner: "nao deve impactar nenhum outro app ou ux do so". The filter's source names no
        clipboard, dialog, notification or background-agent tool at all."""
        src = read(g.__file__)
        for name in ("pbcopy", "pbpaste", "osascript", "NSPasteboard", "launchctl", "display dialog",
                     "display notification", "LaunchAgents"):
            self.assertNotIn(name, src, name)


class WrapperMarker(unittest.TestCase):
    """Issue #58: the paste wrapper is the primary mechanism. In a session it started (the marker in the
    environment), the hook passes silently; without the marker it blocks, as the safety net."""

    SENSITIVE = "deploy for %s with %s, mail ana@zyxw-mail.zyxw" % (TERM, CREDENTIALS["github"])

    def env(self, value=None):
        return {} if value is None else {g.WRAPPER_MARKER: value}

    def run_hook(self, conf, environ, harness="claude"):
        out = io.StringIO()
        payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": self.SENSITIVE}).encode()
        g.cmd_prompt_hook(conf, harness, io.BytesIO(payload), out, FakeSalts(), environ=environ)
        return out.getvalue()

    def test_marker_present_passes_silently(self):
        d, conf = hook_conf("marker-on")
        with_term(conf)
        for harness in ("claude", "codex"):
            self.assertEqual(self.run_hook(conf, self.env(g.WRAPPER_MARKER_VALUE), harness), "", harness)

    def test_marker_absent_or_wrong_blocks(self):
        d, conf = hook_conf("marker-off")
        with_term(conf)
        for value in (None, "", "0", "true", g.WRAPPER_MARKER_VALUE + " "):
            for harness in ("claude", "codex"):
                raw = self.run_hook(conf, self.env(value), harness)
                out = json.loads(raw)
                self.assertEqual(out.get("decision"), "block", (value, harness))
                self.assertIn("[REDACTED:credential]", out["reason"])
                self.assertNotIn(b"quillon", raw.lower().encode())

    def test_the_default_reads_this_process_environment(self):
        d, conf = hook_conf("marker-default")
        saved = os.environ.get(g.WRAPPER_MARKER)
        try:
            os.environ[g.WRAPPER_MARKER] = g.WRAPPER_MARKER_VALUE
            self.assertTrue(g.wrapped_session())
            os.environ.pop(g.WRAPPER_MARKER)
            self.assertFalse(g.wrapped_session())
        finally:
            if saved is not None:
                os.environ[g.WRAPPER_MARKER] = saved

    def test_a_real_hook_process_follows_the_marker(self):
        """As a harness runs it: the hook process inherits the CLI's environment."""
        d, conf_unused = hook_conf("marker-proc")
        conf_path = os.path.join(d, "clipboard.conf")
        py = "/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable
        payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": "use " + CREDENTIALS["aws"]}).encode()
        base_env = {"HOME": os.path.join(d, "home"), "PATH": "/usr/bin:/bin"}
        for marker, blocked in ((None, True), (g.WRAPPER_MARKER_VALUE, False)):
            env = dict(base_env, **self.env(marker))
            r = subprocess.run([py, "-I", "-B", g.__file__, "prompt-hook", "--harness", "codex", "--config", conf_path],
                               input=payload, capture_output=True, env=env, timeout=60)
            self.assertEqual((r.returncode, r.stderr), (0, b""), marker)
            if blocked:
                self.assertEqual(json.loads(r.stdout)["decision"], "block")
            else:
                self.assertEqual(r.stdout, b"")


class Config(unittest.TestCase):
    def test_invalid_values_fall_back(self):
        d = os.path.join(BASE, "conf")
        conf = g.load_config(conf_in(d, max_bytes="lots", show_cleaned_chars="-3", block_categories=""))
        self.assertEqual((conf["max_bytes"], conf["show_cleaned_chars"], conf["block_categories"]),
                         ("1000000", "8000", ",".join(g.CATEGORY_ORDER)))

    def test_retired_watcher_keys_are_ignored(self):
        d = os.path.join(BASE, "conf-old")
        conf = g.load_config(conf_in(d, mode="sanitise", poll_seconds="1", button_keep="Keep"))
        self.assertNotIn("mode", conf)
        self.assertNotIn("button_keep", conf)

    def test_shipped_configs_parse(self):
        repo = os.path.dirname(os.path.dirname(HERE))
        joined = os.path.join(BASE, "joined.conf")
        with open(joined, "w", encoding="utf-8") as out:
            for part in ("global/clipboard.conf", "overlay/clipboard.conf"):
                with open(os.path.join(repo, part), encoding="utf-8") as fh:
                    out.write(fh.read())
        generic = g.load_config(os.path.join(repo, "global", "clipboard.conf"))
        self.assertEqual(generic["block_categories"], ",".join(g.CATEGORY_ORDER))
        owner = g.load_config(joined)
        for key in g.DEFAULTS:
            if key.startswith("notice_"):
                self.assertNotEqual(owner[key], g.DEFAULTS[key], "the overlay does not translate " + key)
                owner[key].format(categories="credential", max="1", error="X", chars=1, program="claude",
                                  count=1, replaced=0)


class AddTermCli(unittest.TestCase):
    def env(self, d):
        e = {k: v for k, v in os.environ.items() if k not in g.AGENT_MARKERS}
        e.update(HOME=os.path.join(d, "home"), XDG_DATA_HOME=os.path.join(d, "home", "data"),
                 PYTHONDONTWRITEBYTECODE="1")
        return e

    def test_term_in_argv_is_refused(self):
        d = os.path.join(BASE, "cli-argv")
        conf = conf_in(d)
        r = subprocess.run([sys.executable, "-B", g.__file__, "add-term", "--config", conf, TERM],
                           capture_output=True, env=self.env(d), stdin=subprocess.DEVNULL)
        self.assertEqual(r.returncode, 2)
        self.assertFalse(os.path.exists(g.load_config(conf)["terms_file"]))

    def test_pipe_is_refused(self):
        d = os.path.join(BASE, "cli-pipe")
        conf = conf_in(d)
        r = subprocess.run([sys.executable, "-B", g.__file__, "add-term", "--config", conf],
                           input=(TERM + "\n" + TERM + "\n").encode(), capture_output=True, env=self.env(d))
        self.assertEqual(r.returncode, 2)
        self.assertIn(b"not a terminal", r.stdout)
        self.assertFalse(os.path.exists(g.load_config(conf)["terms_file"]))

    def test_agent_session_is_refused(self):
        d = os.path.join(BASE, "cli-agent")
        conf = conf_in(d)
        e = self.env(d)
        e["CLAUDECODE"] = "1"
        r = subprocess.run([sys.executable, "-B", g.__file__, "add-term", "--config", conf],
                           capture_output=True, env=e, stdin=subprocess.DEVNULL)
        self.assertEqual(r.returncode, 2)
        self.assertIn(b"agent session marker", r.stdout)

    def test_terminal_entry_echo_off_hashes_only(self):
        d = os.path.join(BASE, "cli-tty")
        conf = conf_in(d)
        pid, fd = pty.fork()
        if pid == 0:
            os.execve(sys.executable, [sys.executable, "-B", g.__file__, "add-term", "--config", conf], self.env(d))
        seen = b""
        deadline = time.time() + 20
        sent = 0
        while time.time() < deadline:
            if not select.select([fd], [], [], 1)[0]:
                continue
            try:
                chunk = os.read(fd, 1024)
            except OSError:
                break
            if not chunk:
                break
            seen += chunk
            if sent == 0 and b"Term (not shown):" in seen:
                os.write(fd, (TERM + "\n").encode())
                sent = 1
            elif sent == 1 and b"Again:" in seen:
                os.write(fd, (TERM + "\n").encode())
                sent = 2
        reaped, status = 0, 0
        for _ in range(50):                     # up to 5 s for the child to exit on its own
            reaped, status = os.waitpid(pid, os.WNOHANG)
            if reaped:
                break
            time.sleep(0.1)
        if not reaped:
            os.kill(pid, 9)
            _, status = os.waitpid(pid, 0)
        self.assertTrue(os.WIFEXITED(status), "add-term hung and was killed: %r" % seen[-200:])
        os.close(fd)
        self.assertEqual(os.WEXITSTATUS(status), 0, seen)
        self.assertNotIn(b"Quillon", seen, "the term was echoed to the terminal")
        c = g.load_config(conf)
        self.assertEqual(len(g.read_terms(c["terms_file"])), 2)
        body = read(c["terms_file"])
        self.assertNotIn("quillon", body.lower())
        salt = g.SaltStore(c).get()
        hashes = g.read_terms(c["terms_file"])
        self.assertEqual(g.categories(g.find_spans("re: zyxw QUILLON synthetic", hashes, salt)), ["employer-client-term"])

    def drive_cancel(self, d, key):
        """Run add-term in a pty, press `key` at the first prompt, return (exit status, terminal output)."""
        conf = conf_in(d)
        pid, fd = pty.fork()
        if pid == 0:
            os.execve(sys.executable, [sys.executable, "-B", g.__file__, "add-term", "--config", conf], self.env(d))
        seen, sent, deadline = b"", False, time.time() + 20
        while time.time() < deadline:
            if not select.select([fd], [], [], 1)[0]:
                continue
            try:
                chunk = os.read(fd, 1024)
            except OSError:
                break
            if not chunk:
                break
            seen += chunk
            if not sent and b"Term (not shown):" in seen:
                os.write(fd, key)
                sent = True
        reaped, status = 0, 0
        for _ in range(50):
            reaped, status = os.waitpid(pid, os.WNOHANG)
            if reaped:
                break
            time.sleep(0.1)
        if not reaped:
            os.kill(pid, 9)
            _, status = os.waitpid(pid, 0)
        os.close(fd)
        self.assertTrue(os.WIFEXITED(status), "add-term did not exit cleanly: %r" % seen[-200:])
        self.assertFalse(os.path.exists(g.load_config(conf)["terms_file"]), "a cancelled entry wrote the term list")
        return os.WEXITSTATUS(status), seen

    def test_ctrl_c_cancels_cleanly(self):
        code, seen = self.drive_cancel(os.path.join(BASE, "cli-ctrl-c"), b"\x03")
        self.assertNotEqual(code, 0)
        self.assertIn(b"not added", seen)
        self.assertNotIn(b"Traceback", seen)

    def test_ctrl_d_cancels_cleanly(self):
        code, seen = self.drive_cancel(os.path.join(BASE, "cli-ctrl-d"), b"\x04")
        self.assertNotEqual(code, 0)
        self.assertIn(b"not added", seen)
        self.assertNotIn(b"Traceback", seen)


class SecretLineReader(unittest.TestCase):
    """Issue #5: _read_secret_line driven through a real pty, starting from terminal modes it must not
    trust. Each test sets the slave's modes first, then types into the master."""

    def setUp(self):
        import termios
        self.termios = termios
        self.master, self.slave = pty.openpty()
        self.result = {}

    def tearDown(self):
        for f in (self.master, self.slave):
            try:
                os.close(f)
            except OSError:
                pass

    def set_modes(self, iflag_clear=0, lflag_set=0):
        t = self.termios
        a = t.tcgetattr(self.slave)
        a[0] &= ~iflag_clear
        a[3] |= lflag_set
        t.tcsetattr(self.slave, t.TCSANOW, a)
        return t.tcgetattr(self.slave)

    def start(self):
        import threading

        def reader():
            try:
                self.result["value"] = g._read_secret_line(self.slave, "P: ")
            except BaseException as exc:          # the test inspects what was raised
                self.result["raised"] = type(exc).__name__
        th = threading.Thread(target=reader, daemon=True)
        th.start()
        deadline = time.time() + 5                  # wait for the prompt: modes are set before it
        seen = b""
        while b"P: " not in seen and time.time() < deadline:
            if select.select([self.master], [], [], 0.2)[0]:
                seen += os.read(self.master, 1024)
        self.assertIn(b"P: ", seen)
        return th

    def type_and_finish(self, th, data):
        os.write(self.master, data)
        th.join(5)
        self.assertFalse(th.is_alive(), "the read never finished (Issue #5)")
        out = b""
        while select.select([self.master], [], [], 0.3)[0]:
            chunk = os.read(self.master, 1024)
            if not chunk:
                break
            out += chunk
        return out

    def test_enter_as_cr_with_icrnl_off(self):
        before = self.set_modes(iflag_clear=self.termios.ICRNL)
        out = self.type_and_finish(self.start(), b"term\r")
        self.assertEqual(self.result.get("value"), "term")
        self.assertEqual(self.termios.tcgetattr(self.slave), before, "terminal modes were not restored")
        self.assertNotIn(b"term", out)

    def test_enter_as_lf(self):
        before = self.set_modes()
        self.type_and_finish(self.start(), b"term\n")
        self.assertEqual(self.result.get("value"), "term")
        self.assertEqual(self.termios.tcgetattr(self.slave), before)

    def test_nothing_echoed_with_echonl_on(self):
        t = self.termios
        before = self.set_modes(lflag_set=t.ECHONL)
        th = self.start()
        during = t.tcgetattr(self.slave)            # the reader is blocked in os.read now
        self.assertFalse(during[3] & t.ECHO, "ECHO on during the read")
        self.assertFalse(during[3] & t.ECHONL, "ECHONL on during the read")
        self.assertTrue(during[3] & t.ICANON and during[0] & t.ICRNL)
        out = self.type_and_finish(th, b"term\r")
        self.assertEqual(self.result.get("value"), "term")
        # Only the one line break the reader writes itself after the read, never an echo of Enter.
        self.assertEqual(out, b"\r\n", "something was echoed during the read: %r" % out)
        self.assertEqual(t.tcgetattr(self.slave), before)

    def test_eof_cancels_and_restores(self):
        before = self.set_modes(iflag_clear=self.termios.ICRNL)
        self.type_and_finish(self.start(), b"\x04")
        self.assertEqual(self.result.get("raised"), "Cancelled")
        self.assertNotIn("value", self.result)
        self.assertEqual(self.termios.tcgetattr(self.slave), before)

    def test_partial_line_then_eof_is_not_returned(self):
        self.set_modes()
        self.type_and_finish(self.start(), b"ter\x04\x04")
        self.assertEqual(self.result.get("raised"), "Cancelled")



if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: clipboard_guard_test.py <base dir for throwaway files>")
    BASE = os.path.abspath(sys.argv.pop(1))
    if os.path.exists(BASE) and os.listdir(BASE):
        sys.exit("refusing: %s exists and is not empty (the suite only writes into a fresh directory)" % BASE)
    os.makedirs(BASE, exist_ok=True)
    os.environ.pop(g.WRAPPER_MARKER, None)     # a suite run from a wrapped session must still judge prompts
    use_throwaway_home()
    GUARD = make_guard(BASE)
    install_keychain_guard()
    unittest.main(verbosity=2)
