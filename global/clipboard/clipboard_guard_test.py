#!/usr/bin/python3
# Tests for clipboard_guard.py (ADR-0011). Everything runs under a throwaway base directory:
#   python3 -B clipboard_guard_test.py <empty-or-new base directory>
# Every term, token and identifier below is SYNTHETIC, and the credential-shaped ones are assembled at
# run time so that this file never contains a string a secret scanner would flag. On macOS, the
# pasteboard tests use a private NAMED pasteboard that is destroyed afterwards (never the general one),
# and the Keychain test uses a namespaced item that is deleted afterwards.
import io
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


class FakePasteboard:
    def __init__(self, text=None, types=None, forbid_read=False):
        self.text = text
        self.typelist = list(types) if types is not None else ([g.TEXT_TYPE] if text is not None else [])
        self.count = 1
        self.forbid_read = forbid_read
        self.reads = 0

    def change_count(self):
        return self.count

    def types(self):
        return list(self.typelist)

    def string(self):
        if self.forbid_read:
            raise AssertionError("a marked item was read past its type list")
        self.reads += 1
        return self.text

    def set_string(self, s):
        self.text, self.typelist, self.count = s, [g.TEXT_TYPE], self.count + 1

    def clear(self):
        self.text, self.typelist, self.count = None, [], self.count + 1


class FakeNotifier:
    def __init__(self, answer="keep"):
        self.answer = answer
        self.sent = []

    def notify(self, key, **values):
        self.sent.append(g.DEFAULTS[key].format(**values))
        return True

    def offer(self, cats):
        self.sent.append(g.DEFAULTS["notice_offer"].format(categories=", ".join(cats)))
        return self.answer


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


def guard(text=None, types=None, mode="offer", answer="keep", terms=(), forbid_read=False, d=None):
    d = d or os.path.join(BASE, "guard-%d" % time.monotonic_ns())
    conf = g.load_config(conf_in(d, mode=mode))
    if terms:
        g.add_term_hashes(conf["terms_file"], [g.term_hash(SALT, f) for t in terms for f in g.term_forms(t)])
    pb = FakePasteboard(text, types, forbid_read)
    n = FakeNotifier(answer)
    return g.Guard(conf, pb, n, FakeSalts()), pb, n


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

    @unittest.skipUnless(DARWIN and os.path.exists("/usr/bin/security"), "macOS Keychain only")
    def test_keychain_store_keeps_salt_out_of_argv(self):
        service = "%s.clipboard-salt.test-%d" % (g.PROJECT, os.getpid())
        d = os.path.join(BASE, "salt-keychain")
        conf = g.load_config(conf_in(d, salt_store="keychain", keychain_service=service))
        seen = []

        def run(argv, **kw):
            seen.append(list(argv))
            return subprocess.run(argv, **kw)
        try:
            try:
                value = g.SaltStore(conf, run).create()
            except RuntimeError:
                self.skipTest("the login Keychain is not writable here (locked or absent)")
            self.assertEqual(g.SaltStore(conf).get(), value)
            self.assertTrue(all(value not in " ".join(a) for a in seen), "the salt reached a process argv")
        finally:
            subprocess.run(["/usr/bin/security", "delete-generic-password", "-s", service, "-a", g._account()],
                           capture_output=True)
        self.assertIsNone(g.SaltStore(conf).get(), "the throwaway Keychain item was not deleted")


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


class GuardBehaviour(unittest.TestCase):
    def test_marked_items_are_never_read(self):
        qt_style = "com.trolltech.anymime.application--x-nspasteboard-concealed-type"   # hypothetical Qt UTI
        for marker in g.SKIP_TYPES + (qt_style,):
            gd, pb, n = guard(CREDENTIALS["aws"], [g.TEXT_TYPE, marker], mode="sanitise", forbid_read=True)
            self.assertEqual(gd.check(pb.count), "skipped-marked", marker)
            self.assertEqual((pb.text, n.sent), (CREDENTIALS["aws"], []), marker)

    def test_sanitise_mode_replaces_then_notifies_category_only(self):
        text = "deploy for %s with %s" % (TERM, CREDENTIALS["github"])
        gd, pb, n = guard(text, mode="sanitise", terms=[TERM])
        self.assertEqual(gd.check(pb.count), "cleaned")
        self.assertEqual(pb.text, "deploy for [REDACTED:employer-client-term] with [REDACTED:credential]")
        self.assertEqual(len(n.sent), 1)
        self.assertIn("employer-client-term, credential", n.sent[0])
        self.assert_no_content(n.sent, text)

    def test_offer_mode_default_is_keep_and_changes_nothing(self):
        text = "mail ana@zyxw-mail.zyxw"
        gd, pb, n = guard(text)
        self.assertEqual(gd.conf["mode"], "offer")
        self.assertEqual(gd.check(pb.count), "kept")
        self.assertEqual((pb.text, pb.count), (text, 1))
        self.assert_no_content(n.sent, text)

    def test_offer_clean_and_clear(self):
        text = "mail ana@zyxw-mail.zyxw"
        gd, pb, n = guard(text, answer="clean")
        self.assertEqual(gd.check(pb.count), "cleaned")
        self.assertEqual(pb.text, "mail [REDACTED:email]")
        gd, pb, n = guard(text, answer="clear")
        self.assertEqual(gd.check(pb.count), "cleared")
        self.assertIsNone(pb.text)
        self.assert_no_content(n.sent, text)

    def test_a_newer_copy_is_never_overwritten(self):
        gd, pb, n = guard("mail ana@zyxw-mail.zyxw", answer="clean")
        pb.count = 7                               # the owner copied something else during the dialog
        self.assertEqual(gd.check(1), "changed")
        self.assertEqual(pb.text, "mail ana@zyxw-mail.zyxw")
        self.assertIn("Mitigation: none applied", n.sent[-1])

    def test_too_large_is_reported_not_silently_passed(self):
        gd, pb, n = guard("a" * 2_000_000, mode="sanitise")
        self.assertEqual(gd.check(pb.count), "too-large")
        self.assertIn("NOT checked", n.sent[0])

    def test_terms_without_salt_are_reported(self):
        gd, pb, n = guard("hello " + TERM, mode="sanitise", terms=[TERM])
        gd.salts = FakeSalts(None)
        self.assertEqual(gd.check(pb.count), "clean")
        self.assertIn("term matching is OFF", n.sent[0])

    def test_no_text_item(self):
        gd, pb, n = guard(None, ["public.png"])
        self.assertEqual(gd.check(pb.count), "no-text")

    def test_run_writes_nothing_and_prints_nothing(self):
        d = os.path.join(BASE, "nolog")
        before_env = dict(os.environ)
        os.makedirs(os.path.join(d, "home"), exist_ok=True)
        os.environ.update(HOME=os.path.join(d, "home"), TMPDIR=os.path.join(d, "home"),
                          XDG_DATA_HOME=os.path.join(d, "home", "data"))
        try:
            gd, pb, n = guard("token %s and %s" % (CREDENTIALS["aws"], TERM), mode="sanitise", terms=[TERM], d=d)
            gd.conf["poll_seconds"] = "1"
            snap = tree(d)
            out, err = io.StringIO(), io.StringIO()
            real = sys.stdout, sys.stderr
            sys.stdout, sys.stderr = out, err
            try:
                g.time.sleep = lambda s: None
                gd.run(max_cycles=5)
            finally:
                sys.stdout, sys.stderr = real
                g.time.sleep = REAL_SLEEP
            self.assertEqual(tree(d), snap, "the watcher wrote to disk")
            self.assertEqual((out.getvalue(), err.getvalue()), ("", ""))
            self.assertEqual(pb.text, "token [REDACTED:credential] and [REDACTED:employer-client-term]")
        finally:
            os.environ.clear()
            os.environ.update(before_env)

    def test_item_copied_while_the_dialog_is_open_is_still_checked(self):
        """Regression for the independent lens's probe on 5a080a9: the loop used to re-read the change
        count after check(), so an item copied during the offer dialog was marked seen unchecked."""
        second = "second copy with key " + CREDENTIALS["aws"]
        for answer in ("keep", "clean", "clear"):
            gd, pb, n = guard("mail ana@zyxw-mail.zyxw", answer=answer)
            first_offer = n.offer
            state = {"done": False}

            def offer(cats, pb=pb, state=state, first_offer=first_offer):
                if not state["done"]:          # the owner copies something else while the dialog is up
                    state["done"] = True
                    pb.text, pb.typelist, pb.count = second, [g.TEXT_TYPE], pb.count + 1
                return first_offer(cats)
            n.offer = offer
            g.time.sleep = lambda s: None
            try:
                gd.run(max_cycles=6)
            finally:
                g.time.sleep = REAL_SLEEP
            offers = [s for s in n.sent if "Nothing changed yet" in s]
            self.assertEqual(len(offers), 2, "%s: the item copied during the dialog was never checked" % answer)
            self.assertIn("credential", offers[1], answer)

    def test_the_guards_own_write_is_not_rechecked(self):
        gd, pb, n = guard("key " + CREDENTIALS["aws"], mode="sanitise")
        g.time.sleep = lambda s: None
        try:
            gd.run(max_cycles=5)
        finally:
            g.time.sleep = REAL_SLEEP
        self.assertEqual(pb.reads, 1, "the redacted copy the guard wrote was read again as a new item")
        self.assertEqual(len(n.sent), 1)

    def test_a_failure_on_every_poll_is_reported_once(self):
        gd, pb, n = guard("x")

        def broken():
            raise OSError("pasteboard server gone")
        pb.change_count = broken
        g.time.sleep = lambda s: None
        try:
            gd.run(max_cycles=10)
        finally:
            g.time.sleep = REAL_SLEEP
        self.assertEqual(len(n.sent), 1)
        self.assertIn("OSError", n.sent[0])

    def test_startup_failure_is_one_notice_and_a_clean_exit(self):
        conf = g.load_config(conf_in(os.path.join(BASE, "startup")))
        n = FakeNotifier()

        def backend(name):
            raise OSError("no AppKit here: SECRETDETAIL")
        self.assertEqual(g.cmd_watch(conf, backend=backend, notifier=n), 0)
        self.assertEqual(len(n.sent), 1)
        self.assertIn("could not start (OSError)", n.sent[0])
        self.assertNotIn("SECRETDETAIL", n.sent[0])

    def test_one_error_one_notice_with_class_name_only(self):
        gd, pb, n = guard("x")

        def boom():
            raise UnicodeDecodeError("utf-8", b"SECRETBYTES", 0, 1, "bad")
        pb.string = boom
        g.time.sleep = lambda s: None
        try:
            gd.run(max_cycles=4)
        finally:
            g.time.sleep = REAL_SLEEP
        self.assertEqual(len(n.sent), 1)
        self.assertIn("UnicodeDecodeError", n.sent[0])
        self.assertNotIn("SECRETBYTES", n.sent[0])

    def assert_no_content(self, notices, text):
        joined = "\n".join(notices).lower()
        for word in g.tokens(text):
            if len(word[2]) >= 4 and word[2] not in ("mail", "with", "deploy", "token"):
                self.assertNotIn(word[2], joined)
        for secret in CREDENTIALS.values():
            self.assertNotIn(secret.lower(), joined)


class NotifierArgv(unittest.TestCase):
    def test_content_never_reaches_osascript(self):
        calls = []

        def run(argv, **kw):
            calls.append((list(argv), kw.get("input")))
            return subprocess.CompletedProcess(argv, 0, b"Clean\n", b"")
        conf = g.load_config(None)
        nt = g.Notifier(conf, run)
        self.assertEqual(nt.offer(["credential", "email"]), "clean")
        self.assertTrue(nt.notify("notice_cleaned", categories="credential"))
        blob = repr(calls)
        self.assertNotIn(CREDENTIALS["aws"], blob)
        self.assertIn("credential", blob)
        self.assertTrue(all(c[0][0] == "/usr/bin/osascript" for c in calls))

    def test_timeout_failure_and_missing_osascript_mean_keep_and_no_crash(self):
        conf = g.load_config(None)
        gave_up = g.Notifier(conf, lambda a, **k: subprocess.CompletedProcess(a, 0, b"\n", b""))
        failed = g.Notifier(conf, lambda a, **k: subprocess.CompletedProcess(a, 1, b"", b"x"))
        self.assertEqual(gave_up.offer(["email"]), "keep")
        self.assertEqual(failed.offer(["email"]), "keep")

        def missing(a, **k):
            raise FileNotFoundError(a[0])
        self.assertFalse(g.Notifier(conf, missing).notify("notice_error", error="X"))

    def test_ambiguous_button_labels_mean_keep(self):
        conf = g.load_config(None)
        conf["button_clear"] = conf["button_clean"]
        nt = g.Notifier(conf, lambda a, **k: subprocess.CompletedProcess(a, 0, b"Clean\n", b""))
        self.assertEqual(nt.offer(["email"]), "keep")

    @unittest.skipUnless(DARWIN and os.path.exists("/usr/bin/osacompile"), "macOS only")
    def test_scripts_compile_without_displaying_anything(self):
        for i, script in enumerate((g.NOTIFY_SCRIPT, g.OFFER_SCRIPT)):
            cmd = ["/usr/bin/osacompile", "-o", os.path.join(BASE, "s%d.scpt" % i)]
            for line in script:
                cmd += ["-e", line]
            r = subprocess.run(cmd, capture_output=True)
            self.assertEqual(r.returncode, 0, r.stderr)

    def test_bad_overlay_template_falls_back(self):
        conf = g.load_config(None)
        conf["notice_cleared"] = "broken {nope}"
        sent = []
        g.Notifier(conf, lambda a, **k: sent.append(a) or subprocess.CompletedProcess(a, 0, b"", b"")).notify(
            "notice_cleared", categories="email")
        self.assertIn("clipboard cleared", " ".join(sent[0]))


class Config(unittest.TestCase):
    def test_invalid_values_fall_back_to_the_safest_default(self):
        d = os.path.join(BASE, "conf")
        conf = g.load_config(conf_in(d, mode="delete-everything", poll_seconds="-3", max_bytes="lots"))
        self.assertEqual((conf["mode"], conf["poll_seconds"], conf["max_bytes"]), ("offer", "1", "1000000"))

    def test_overlay_last_value_wins(self):
        d = os.path.join(BASE, "conf2")
        path = conf_in(d, mode="sanitise")
        with open(path, "a") as fh:
            fh.write("mode=offer\n# mode=sanitise\n")
        self.assertEqual(g.load_config(path)["mode"], "offer")

    def test_shipped_configs_parse(self):
        repo = os.path.dirname(os.path.dirname(HERE))
        generic = g.load_config(os.path.join(repo, "global", "clipboard.conf"))
        self.assertEqual(generic["mode"], "offer")
        joined = os.path.join(BASE, "joined.conf")
        with open(joined, "w", encoding="utf-8") as out:
            for part in ("global/clipboard.conf", "overlay/clipboard.conf"):
                with open(os.path.join(repo, part), encoding="utf-8") as fh:
                    out.write(fh.read())
        owner = g.load_config(joined)
        self.assertEqual(owner["mode"], "offer")
        self.assertEqual(len({owner["button_keep"], owner["button_clear"], owner["button_clean"]}), 3)
        for key in g.DEFAULTS:
            if key.startswith("notice_"):
                owner[key].format(categories="credential", max="1", error="X")
                for label in ("button_keep", "button_clear", "button_clean"):
                    if key == "notice_offer":
                        self.assertIn(owner[label], owner[key], "the notice names a button the dialog lacks")


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


@unittest.skipUnless(DARWIN, "macOS pasteboard only")
class MacNamedPasteboard(unittest.TestCase):
    def setUp(self):
        self.name = "%s.test.%d.%d" % (g.PROJECT, os.getpid(), time.monotonic_ns())
        self.pb = g.MacPasteboard(self.name)

    def tearDown(self):
        self.pb.release()

    def test_concealed_item_skipped_and_untouched(self):
        self.pb.put({g.TEXT_TYPE: CREDENTIALS["aws"], "org.nspasteboard.ConcealedType": ""})
        gd = g.Guard(g.load_config(conf_in(os.path.join(BASE, "mac1"), mode="sanitise")), self.pb, FakeNotifier(), FakeSalts())
        self.assertEqual(gd.check(self.pb.change_count()), "skipped-marked")
        self.assertEqual(self.pb.string(), CREDENTIALS["aws"])

    def test_sanitise_on_a_real_pasteboard(self):
        self.pb.put({g.TEXT_TYPE: "key " + CREDENTIALS["aws"], "public.html": "<b>key " + CREDENTIALS["aws"] + "</b>"})
        gd = g.Guard(g.load_config(conf_in(os.path.join(BASE, "mac2"), mode="sanitise")), self.pb, FakeNotifier(), FakeSalts())
        self.assertEqual(gd.check(self.pb.change_count()), "cleaned")
        self.assertEqual(self.pb.string(), "key [REDACTED:credential]")
        # NSStringPboardType is the legacy alias AppKit adds for plain text; the HTML flavour must be gone.
        self.assertEqual(set(self.pb.types()) - {"NSStringPboardType"}, {g.TEXT_TYPE},
                         "a rich flavour carrying the original survived")

    def test_watch_process_end_to_end_writes_nothing(self):
        d = os.path.join(BASE, "mac-e2e")
        home = os.path.join(d, "home")
        os.makedirs(home, exist_ok=True)
        capture = os.path.join(BASE, "mac-e2e-capture")
        fake = os.path.join(BASE, "fake-osascript")
        with open(fake, "w") as fh:
            fh.write('#!/bin/sh\nprintf "%s\\n" "$@" >> "' + capture + '"\n')
        os.chmod(fake, 0o755)
        conf = conf_in(d, mode="sanitise", osascript=fake)
        self.pb.put({g.TEXT_TYPE: "jwt " + CREDENTIALS["jwt"]})
        snap = tree(d)
        env = {"HOME": home, "TMPDIR": home, "PATH": "/usr/bin:/bin"}
        r = subprocess.run(["/usr/bin/python3" if os.path.exists("/usr/bin/python3") else sys.executable, "-I", "-B",
                            g.__file__, "watch", "--config", conf, "--pasteboard", self.name, "--max-cycles", "2"],
                           capture_output=True, env=env, timeout=60)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, b"", b""))
        self.assertEqual(tree(d), snap, "the watch process wrote to disk")
        self.assertEqual(self.pb.string(), "jwt [REDACTED:credential]")
        notices = read(capture)
        self.assertIn("credential", notices)
        self.assertNotIn(CREDENTIALS["jwt"][:20], notices)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: clipboard_guard_test.py <base dir for throwaway files>")
    BASE = os.path.abspath(sys.argv.pop(1))
    if os.path.exists(BASE) and os.listdir(BASE):
        sys.exit("refusing: %s exists and is not empty (the suite only writes into a fresh directory)" % BASE)
    os.makedirs(BASE, exist_ok=True)
    unittest.main(verbosity=2)
