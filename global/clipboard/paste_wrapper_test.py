#!/usr/bin/python3
# Tests for paste_wrapper.py, the paste filter at the CLI session's paste boundary (ADR-0011). Everything
# runs under a throwaway base directory:
#   python3 -B paste_wrapper_test.py <empty-or-new base directory>
# The "terminal" is a pseudo-terminal this suite owns; the "CLI" is a recorder child that writes every
# byte it receives to a file under the base directory. Every term, token and identifier below is
# SYNTHETIC, and the credential-shaped ones are assembled at run time. Nothing here reads or writes the
# system clipboard, a shell rc, terminal preferences or the real HOME.
import fcntl
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clipboard_guard as g  # noqa: E402
import paste_wrapper as w  # noqa: E402

BASE = None
WRAPPER = os.path.join(HERE, "paste_wrapper.py")
PY = sys.executable
SALT = "5a" * 32
TERM = "Zyxw Quillon Synthetic"
S, E = b"\x1b[200~", b"\x1b[201~"
EMAIL = "pessoa.sintetica@" + "dominio-sintetico.com.br"
AWS = "AKIA" + "QQQQRRRRSSSSTTTT"
EXIT = b"\x1d\x1dEXIT"          # the recorder exits on this (Ctrl+] twice, then EXIT)

RECORDER = r'''
import fcntl, os, signal, struct, sys, termios, tty
rec, ev, mode, code = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
tty.setraw(0)
evf = open(ev, "a")
def size():
    r, c, _, _ = struct.unpack("HHHH", fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8))
    return "%dx%d" % (r, c)
def winch(*_):
    evf.write("WINCH %s\n" % size()); evf.flush()
signal.signal(signal.SIGWINCH, winch)
evf.write("START %s\n" % size()); evf.flush()
if mode == "bp":
    os.write(1, b"\x1b[?2004h")
os.write(1, b"READY\r\n")
seen, acks = b"", 0
with open(rec, "ab", buffering=0) as f:
    while True:
        try:
            d = os.read(0, 65536)
        except InterruptedError:
            continue
        except OSError:
            break
        if not d:
            break
        f.write(d)
        evf.write("READ %d %r lflag=%x\n" % (len(d), d[:24], termios.tcgetattr(0)[3])); evf.flush()
        seen += d
        while seen.count(b"\x1b[201~") > acks:
            acks += 1
            os.write(1, b"<ACK%d>" % acks)
        if b"\x1d\x1dTYPED" in seen:
            seen = seen.replace(b"\x1d\x1dTYPED", b"")
            os.write(1, b"<TYPED>")
        if b"\x1d\x1dOFF" in seen:
            seen = seen.replace(b"\x1d\x1dOFF", b"")
            os.write(1, b"\x1b[?2004l<OFF>")
        if b"\x1d\x1dEXIT" in seen:
            if mode == "bp":
                os.write(1, b"\x1b[?2004l")
            import time
            evf.write("EXITING %.4f\n" % time.monotonic()); evf.flush()
            sys.exit(code)
'''


def conf_in(d, **over):
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "clipboard.conf")
    lines = ["salt_store=file", "terms_file=%s" % os.path.join(d, "lo", "terms"),
             "salt_file=%s" % os.path.join(d, "lo", "salt")]
    lines += ["%s=%s" % kv for kv in over.items()]
    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    return path


def with_term(d):
    os.makedirs(os.path.join(d, "lo"), exist_ok=True)
    with open(os.path.join(d, "lo", "salt"), "w") as fh:
        fh.write(SALT + "\n")
    g.add_term_hashes(os.path.join(d, "lo", "terms"), [g.term_hash(SALT, f) for f in g.term_forms(TERM)])


def modes(fd):
    """The terminal's settable modes. PENDIN is masked: the kernel sets it on its own when a terminal goes
    back to canonical mode with input pending (macOS), so it is state, not a mode anyone restored."""
    a = termios.tcgetattr(fd)
    a[3] &= ~getattr(termios, "PENDIN", 0)
    return a


class Session:
    """A wrapper process on a pty this suite owns, running the recorder child."""

    def __init__(self, name, mode="bp", code=0, grace=5.0, conf=None, rows=30, cols=100, wrap=True):
        self.dir = os.path.join(BASE, name)
        os.makedirs(self.dir, exist_ok=True)
        self.conf = conf or conf_in(self.dir)
        self.rec = os.path.join(self.dir, "received.bin")
        self.ev = os.path.join(self.dir, "events.txt")
        child = os.path.join(self.dir, "recorder.py")
        with open(child, "w") as fh:
            fh.write(RECORDER)
        self.master, self.slave = pty.openpty()
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.attrs_before = modes(self.slave)
        argv = [PY, "-B", child, self.rec, self.ev, mode, str(code)]
        if wrap:
            argv = [PY, "-I", "-B", WRAPPER, "run", "--config", self.conf, "--grace", str(grace), "--"] + argv
        env = dict(os.environ, HOME=self.dir, XDG_DATA_HOME=os.path.join(self.dir, "xdg"))
        self.proc = subprocess.Popen(argv, stdin=self.slave, stdout=self.slave, stderr=self.slave,
                                     env=env, start_new_session=True, cwd=self.dir)
        self.out = b""
        self.lock = threading.Lock()
        self.stamps = []        # (time, len(out)) after each read, for latency
        # The reader must be joined before its fds are closed: a thread still polling a closed fd
        # number reads whatever the next open() reuses it for (another session's pty, or the file a
        # later assertion reads), which made assertions fail on loaded Linux runners.
        self.stop = threading.Event()
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        while not self.stop.is_set():
            try:
                r, _, _ = select.select([self.master], [], [], 0.05)
            except (OSError, ValueError):
                return
            if self.master in r:
                try:
                    d = os.read(self.master, 65536)
                except OSError:
                    return
                if not d:
                    return
                with self.lock:
                    self.out += d
                    self.stamps.append((time.monotonic(), len(self.out)))

    def wait_out(self, needle, timeout=10):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            with self.lock:
                if needle in self.out:
                    return True
            time.sleep(0.0005)
        return False

    def send(self, data):
        os.write(self.master, data)

    def diag(self):
        try:
            with open(self.ev) as fh:
                ev = fh.read()
        except OSError as exc:
            ev = "no events file: %r" % exc
        return "poll=%r rec_exists=%r %s events=%r" % (self.proc.poll(), os.path.exists(self.rec),
                                                       getattr(self, "waited", "-"), ev[-600:])

    def received(self):
        try:
            with open(self.rec, "rb") as fh:
                return fh.read()
        except OSError as exc:
            return ("<READ ERROR %r>" % exc).encode()

    def finish(self, timeout=10):
        if self.proc.poll() is None:
            self.send(EXIT)
        try:
            rc = self.proc.wait(timeout)
            self.waited = "wrapper reaped at %.4f; recorder alive then: %r" % (
                time.monotonic(), subprocess.run(["pgrep", "-f", self.dir + "/recorder.py"],
                                                 capture_output=True, text=True).stdout.split())
        except subprocess.TimeoutExpired:
            self.proc.kill()
            rc = self.proc.wait()
        time.sleep(0.1)
        self.stop.set()
        self.reader.join(5)
        attrs = modes(self.slave)
        os.close(self.slave)
        os.close(self.master)
        return rc, attrs


class Filter(unittest.TestCase):
    """The input-side state machine, with no process."""

    def make(self, max_bytes=1000):
        conf = g.load_config(conf_in(os.path.join(BASE, "filter")))
        clock = [0.0]
        f = w.PasteFilter(w.make_cleaner(conf, frozenset(), None), max_bytes,
                          {"too_large": "[TOO LARGE]", "error": "[ERR {error}]"}, clock=lambda: clock[0])
        return f, clock

    def test_typed_bytes_pass_unchanged(self):
        f, _ = self.make()
        data = bytes(b for b in range(256) if b != 0x1b) + b"\x1b[A\x1b[B\x1bOP\x1b[I"
        self.assertEqual(f.feed(data), data)

    def test_paste_with_finding_is_redacted_at_every_split(self):
        payload = ("contact %s now" % EMAIL).encode()
        stream = b"ab" + S + payload + E + b"cd"
        want = b"ab" + S + b"contact [REDACTED:email] now" + E + b"cd"
        for cut in range(1, len(stream)):
            f, clock = self.make()
            out = f.feed(stream[:cut]) + f.feed(stream[cut:])
            clock[0] += 1
            out += f.flush()
            self.assertEqual(out, want, "split at %d" % cut)
            self.assertNotIn(EMAIL.encode(), out)

    def test_paste_without_finding_is_byte_identical(self):
        f, _ = self.make()
        payload = bytes(range(32, 127)) + b"\r\n\t\xc3\xa9\xff\xfe"
        self.assertEqual(f.feed(S + payload + E), S + payload + E)

    def test_lone_escape_is_held_then_released(self):
        f, clock = self.make()
        self.assertEqual(f.feed(b"\x1b"), b"")
        clock[0] += w.HOLD_SECONDS / 2
        self.assertEqual(f.flush(), b"")
        clock[0] += w.HOLD_SECONDS
        self.assertEqual(f.flush(), b"\x1b")

    def test_marker_split_at_every_position_with_a_delay_is_cleaned(self):
        """The paste-start marker split after byte k (k = 1..5), with the second half arriving after
        the Escape-key hold has expired: the e-mail must be redacted and never forwarded (QA, PR #23)."""
        for k in range(1, len(S)):
            f, clock = self.make()
            out = f.feed(S[:k])
            clock[0] += w.HOLD_SECONDS * 4                 # past the 25 ms hold, within the 1 s one
            out += f.flush()
            out += f.feed(S[k:] + b"mail " + EMAIL.encode() + E + b"x")
            self.assertNotIn(EMAIL.encode(), out, "k=%d leaked the paste" % k)
            self.assertEqual(out, S + b"mail [REDACTED:email]" + E + b"x", "k=%d" % k)
            self.assertFalse(f.in_paste)

    def test_escape_key_controls(self):
        # A lone Escape is released after 25 ms, and what follows it is not held.
        f, clock = self.make()
        f.feed(b"\x1b")
        clock[0] += w.HOLD_SECONDS + 0.001
        self.assertEqual(f.flush(), b"\x1b")
        self.assertEqual(f.feed(b"x"), b"x")
        # Escape then an arrow-key tail: passes through at once.
        f, clock = self.make()
        f.feed(b"\x1b")
        clock[0] += w.HOLD_SECONDS + 0.001
        f.flush()
        self.assertEqual(f.feed(b"[A"), b"[A")
        # Escape, then "[200~" typed more than 1 s later: typing, not a paste.
        f, clock = self.make()
        f.feed(b"\x1b")
        clock[0] += w.HOLD_SECONDS + 0.001
        f.flush()
        clock[0] += w.HOLD_SEQUENCE_SECONDS + 0.1
        self.assertEqual(f.feed(b"[200~abc"), b"[200~abc")
        self.assertFalse(f.in_paste)

    def test_split_marker_prefix_is_held_longer_than_a_lone_escape(self):
        f, clock = self.make()
        self.assertEqual(f.feed(b"\x1b[20"), b"")
        clock[0] += w.HOLD_SECONDS * 4                  # a loaded host: far past the Escape-key hold
        self.assertEqual(f.flush(), b"", "a split paste marker was released as typing")
        self.assertEqual(f.feed(b"0~" + EMAIL.encode() + E), S + b"[REDACTED:email]" + E)
        f2, clock2 = self.make()
        f2.feed(b"\x1b[")                               # Alt+[ : still delivered, unchanged
        clock2[0] += w.HOLD_SEQUENCE_SECONDS + 0.01
        self.assertEqual(f2.flush(), b"\x1b[")

    def test_too_large_paste_is_replaced_never_forwarded(self):
        f, _ = self.make(max_bytes=50)
        payload = (EMAIL + " ") * 20
        out = f.feed(S + payload.encode()[:300]) + f.feed(payload.encode()[300:] + E + b"x")
        self.assertEqual(out, S + b"[TOO LARGE]" + E + b"x")
        self.assertEqual(f.replaced, 1)

    def test_limit_crossed_in_the_end_marker_chunk_keeps_the_marker(self):
        """The chunk that crosses max_bytes also carries the end marker: the paste must still close
        there, and what follows it must arrive as typing (lens finding on PR #23)."""
        f, _ = self.make(max_bytes=50)
        out = f.feed(S + b"a" * 45) + f.feed(b"b" * 10 + E + b"typed")
        self.assertEqual(out, S + b"[TOO LARGE]" + E + b"typed")
        self.assertFalse(f.in_paste)

    def test_oversized_single_chunk_from_an_empty_body(self):
        f, _ = self.make(max_bytes=10)
        self.assertEqual(f.feed(S + b"x" * 30 + E + b"typed"), S + b"[TOO LARGE]" + E + b"typed")
        self.assertFalse(f.in_paste)

    def test_end_marker_never_lost_around_the_limit(self):
        """Sweep payload sizes around max_bytes against every chunk size from 1 to 16: the paste always
        closes at its marker, never forwards the payload, and the bytes after it pass unchanged."""
        limit = 40
        for size in range(limit - 8, limit + 9):
            stream = S + b"p" * size + E + b"after"
            for step in range(1, 17):
                f, _ = self.make(max_bytes=limit)
                out = b"".join(f.feed(stream[i:i + step]) for i in range(0, len(stream), step))
                self.assertTrue(out.endswith(E + b"after"), "size %d step %d: %r" % (size, step, out))
                self.assertFalse(f.in_paste, "size %d step %d: paste left open" % (size, step))
                if size > limit:
                    self.assertNotIn(b"p", out)

    def test_cleaner_error_replaces_the_paste(self):
        f, _ = self.make()

        def boom(_):
            raise ValueError("would quote " + EMAIL)
        f.clean = boom
        out = f.feed(S + EMAIL.encode() + E)
        self.assertEqual(out, S + b"[ERR ValueError]" + E)

    def test_paste_without_end_is_cleaned_after_idle(self):
        f, clock = self.make()
        self.assertEqual(f.feed(S + EMAIL.encode()), b"")
        clock[0] += w.PASTE_IDLE_SECONDS + 0.1
        self.assertEqual(f.flush(), S + b"[REDACTED:email]" + E)

    def test_mode_tracker(self):
        m = w.ModeTracker()
        m.feed(b"xx\x1b[?20")
        self.assertFalse(m.ever)
        m.feed(b"04hyy")
        self.assertTrue(m.enabled and m.ever)
        m.feed(b"\x1b[?1004;2004l")
        self.assertFalse(m.enabled)
        self.assertTrue(m.ever)
        m.feed(b"\x1b[?25h zz")         # another mode: no change
        self.assertFalse(m.enabled)
        m.feed(b"\x1b[?2004h")
        self.assertTrue(m.enabled)


class Relay(unittest.TestCase):
    """A real wrapper process between a pty this suite owns and a recorder child."""

    def ready(self, s):
        self.assertTrue(s.wait_out(b"READY"), "child never started: %r" % s.out[-300:])

    def test_paste_arrives_redacted_and_typing_is_byte_exact(self):
        d = os.path.join(BASE, "redact")
        conf = conf_in(d)
        with_term(d)
        s = Session("redact", conf=conf)
        self.ready(s)
        self.assertTrue(s.wait_out(b"\x1b[?2004h"), "the mode set by the CLI must reach the terminal")
        typed = bytes(b for b in range(256) if b not in (0x1b, 0x1d)) + b"\x1b[A\x1b[D"
        s.send(typed + b"\x1d\x1dTYPED")
        self.assertTrue(s.wait_out(b"<TYPED>"))
        paste = ("deploy for %s key %s mail %s\rline two" % (TERM.upper(), AWS, EMAIL)).encode()
        s.send(S + paste + E)
        self.assertTrue(s.wait_out(b"<ACK1>"))
        s.send(S + b"plain text, no finding" + E)
        self.assertTrue(s.wait_out(b"<ACK2>"))
        rc, attrs = s.finish()
        got = s.received()
        if not got.startswith(typed):
            i = next((n for n in range(min(len(got), len(typed))) if got[n] != typed[n]), min(len(got), len(typed)))
            self.fail("typed bytes changed at %d of %d: sent %r, got %r; received starts %r; re-read %d bytes %s"
                      % (i, len(typed), typed[max(0, i - 8):i + 8], got[max(0, i - 8):i + 8], got[:40],
                         len(s.received()), s.diag()))
        cleaned = (b"deploy for [REDACTED:employer-client-term] key [REDACTED:credential] mail "
                   b"[REDACTED:email]\rline two")
        self.assertIn(S + cleaned + E, got)
        self.assertIn(S + b"plain text, no finding" + E, got)
        for secret in (TERM.upper().encode(), AWS.encode(), EMAIL.encode()):
            self.assertNotIn(secret, got)
            self.assertNotIn(secret, s.out, "the terminal output carries pasted content")
        self.assertEqual(rc, 0)
        self.assertEqual(attrs, s.attrs_before, "terminal modes not restored")
        self.assertIn(b"1 paste(s) cleaned in this session (employer-client-term, credential, email)", s.out)

    def test_marker_split_after_its_first_byte_is_cleaned(self):
        """k=1 through a real wrapper: ESC alone, the rest 150 ms later (past the Escape hold)."""
        s = Session("split1")
        self.ready(s)
        s.send(b"\x1b")
        time.sleep(0.15)
        s.send(b"[200~" + EMAIL.encode() + E)
        self.assertTrue(s.wait_out(b"<ACK1>"))
        s.finish()
        got = s.received()
        self.assertNotIn(EMAIL.encode(), got)
        self.assertTrue(got.startswith(S + b"[REDACTED:email]" + E), "%r %s" % (got[:80], s.diag()))

    def test_split_marker_and_lone_escape(self):
        s = Session("split")
        self.ready(s)
        s.send(b"\x1b")                 # a lone Escape: delivered after the hold, unchanged
        time.sleep(0.2)
        s.send(b"\x1b[20")
        time.sleep(0.01)
        s.send(b"0~" + EMAIL.encode() + b"\x1b[2")
        time.sleep(0.01)
        s.send(b"01~")
        self.assertTrue(s.wait_out(b"<ACK1>"))
        s.finish()
        got = s.received()
        self.assertTrue(got.startswith(b"\x1b" + S + b"[REDACTED:email]" + E),
                        "first read %r, re-read %r %s" % (got[:80], s.received()[:80], s.diag()))

    def test_exit_status_is_relayed(self):
        s = Session("exit7", code=7)
        self.ready(s)
        rc, _ = s.finish()
        self.assertEqual(rc, 7)

    def test_death_by_signal_is_relayed(self):
        s = Session("sig")
        self.ready(s)
        child = int(subprocess.run(["pgrep", "-P", str(s.proc.pid)], capture_output=True).stdout.split()[0])
        os.kill(child, signal.SIGKILL)
        rc, _ = s.finish()
        self.assertEqual(rc, 128 + signal.SIGKILL)

    def test_sigterm_is_forwarded(self):
        s = Session("term")
        self.ready(s)
        s.proc.send_signal(signal.SIGTERM)
        rc, attrs = s.finish()
        self.assertEqual(rc, 128 + signal.SIGTERM)
        self.assertEqual(attrs, s.attrs_before)

    def test_job_control_stop_and_resume(self):
        """The CLI stops (as on Ctrl+Z): the launcher restores the terminal and stops too, so the shell
        gets its prompt back; continued, it puts the terminal back in raw mode and continues the CLI."""
        s = Session("stop")
        self.ready(s)
        child = int(subprocess.run(["pgrep", "-P", str(s.proc.pid)], capture_output=True).stdout.split()[0])

        def state(pid):
            return subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        os.kill(child, signal.SIGSTOP)
        end = time.monotonic() + 5
        while time.monotonic() < end and not state(s.proc.pid).startswith("T"):
            time.sleep(0.02)
        self.assertTrue(state(s.proc.pid).startswith("T"), "the launcher did not stop with the CLI")
        self.assertEqual(modes(s.slave), s.attrs_before, "terminal not restored while stopped")
        os.kill(s.proc.pid, signal.SIGCONT)
        end = time.monotonic() + 5
        while time.monotonic() < end and state(child).startswith("T"):
            time.sleep(0.02)
        self.assertFalse(state(child).startswith("T"), "the CLI was not continued")
        self.assertFalse(termios.tcgetattr(s.slave)[3] & termios.ICANON, "terminal not raw again")
        s.send(S + EMAIL.encode() + E)
        self.assertTrue(s.wait_out(b"<ACK1>"))
        rc, attrs = s.finish()
        self.assertEqual(rc, 0)
        self.assertEqual(attrs, s.attrs_before)

    def test_window_size_is_relayed(self):
        s = Session("winch", rows=30, cols=100)
        self.ready(s)
        fcntl.ioctl(s.slave, termios.TIOCSWINSZ, struct.pack("HHHH", 41, 133, 0, 0))
        s.proc.send_signal(signal.SIGWINCH)
        end = time.monotonic() + 5
        events = ""
        while time.monotonic() < end and "WINCH 41x133" not in events:
            time.sleep(0.02)
            with open(s.ev) as fh:
                events = fh.read()
        s.finish()
        self.assertIn("START 30x100", events)
        self.assertIn("WINCH 41x133", events)

    def test_no_bracketed_paste_warns_and_cleans_nothing(self):
        s = Session("nobp", mode="nobp", grace=0.3)
        self.ready(s)
        self.assertTrue(s.wait_out(b"has not enabled bracketed paste"), s.out[-300:])
        s.send(EMAIL.encode() + b"\x1d\x1dTYPED")    # what an unbracketed paste looks like: typing
        self.assertTrue(s.wait_out(b"<TYPED>"), "no <TYPED>; out=%r" % s.out[-300:])
        s.finish()
        self.assertTrue(s.received().startswith(EMAIL.encode()),
                        "nothing can be told apart from typing; received=%r out=%r %s"
                        % (s.received()[:200], s.out[-300:], s.diag()))

    def test_turned_off_mid_session_warns(self):
        s = Session("off", grace=0.3)
        self.ready(s)
        self.assertTrue(s.wait_out(b"\x1b[?2004h"))
        time.sleep(0.5)
        self.assertNotIn(b"bracketed paste", s.out, "warned while the mode was on")
        s.send(b"\x1d\x1dOFF")
        self.assertTrue(s.wait_out(b"turned bracketed paste off"), s.out[-300:])
        s.finish()

    def test_missing_salt_is_said_at_start_and_at_exit(self):
        d = os.path.join(BASE, "nosalt")
        conf = conf_in(d)
        with_term(d)
        os.remove(os.path.join(d, "lo", "salt"))
        s = Session("nosalt", conf=conf)
        self.ready(s)
        s.finish()
        self.assertEqual(s.out.count(b"its salt could not be read"), 2, s.out[-400:])

    def test_wrapper_writes_no_file(self):
        s = Session("nofile")
        self.ready(s)
        s.send(S + EMAIL.encode() + E)
        self.assertTrue(s.wait_out(b"<ACK1>"))
        s.finish()
        files = sorted(os.path.relpath(os.path.join(dp, f), s.dir) for dp, _, fs in os.walk(s.dir) for f in fs)
        self.assertEqual(files, ["clipboard.conf", "events.txt", "received.bin", "recorder.py"])

    def test_not_a_terminal_execs_straight_through(self):
        d = os.path.join(BASE, "pipe")
        os.makedirs(d)
        r = subprocess.run([PY, "-I", "-B", WRAPPER, "run", "--config", conf_in(d), "--",
                            PY, "-c", "import sys; d=sys.stdin.read(); sys.stdout.write(d.upper()); sys.exit(3)"],
                           input=b"mail " + EMAIL.encode(), capture_output=True)
        self.assertEqual(r.returncode, 3)
        self.assertEqual(r.stdout, b"MAIL " + EMAIL.upper().encode())

    def test_missing_program(self):
        r = subprocess.run([PY, "-I", "-B", WRAPPER, "run", "--", "no-such-cli-pmhwc"], capture_output=True)
        self.assertEqual(r.returncode, 127)

    def test_latency_per_paste(self):
        """Wrapper-added latency, against the same child on a bare pty: a typed key, and a 1 KB and a
        100 KB paste carrying findings, with a term list loaded (the n-gram term hashing is the costly
        part of the scan). Printed for the record; asserted only against loose bounds."""
        d = os.path.join(BASE, "lat")
        conf = conf_in(d)
        with_term(d)
        line = "mail %s and text about %s " % (EMAIL, TERM)
        results = {}
        for wrap in (False, True):
            s = Session("lat-%s" % wrap, wrap=wrap, conf=conf)
            self.ready(s)
            for size in (0, 1000, 100000):
                times = []
                for i in range(1, 8):
                    t0 = time.monotonic()
                    if size:
                        acks = s.out.count(b"<ACK")
                        s.send(S + (line * (size // len(line) + 1))[:size].encode() + E)
                        self.assertTrue(s.wait_out(b"<ACK%d>" % (acks + 1), timeout=30))
                    else:
                        typed = s.out.count(b"<TYPED>")
                        s.send(b"\x1d\x1dTYPED")
                        end = time.monotonic() + 10
                        while s.out.count(b"<TYPED>") <= typed and time.monotonic() < end:
                            time.sleep(0.0005)
                    times.append(time.monotonic() - t0)
                results[(size, wrap)] = sorted(times)[len(times) // 2]
            s.finish()
        for size in (0, 1000, 100000):
            what = "typed key" if not size else "%d-byte paste" % size
            sys.stderr.write("\nLATENCY %s: bare %.1f ms, wrapped %.1f ms, added %.1f ms (median of 7)"
                             % (what, results[(size, False)] * 1000, results[(size, True)] * 1000,
                                (results[(size, True)] - results[(size, False)]) * 1000))
        sys.stderr.write("\n")
        self.assertLess(results[(0, True)], 0.1)
        self.assertLess(results[(1000, True)], 0.5)


class Hook(unittest.TestCase):
    def test_redacted_prompt_gets_a_category_notice(self):
        conf = g.load_config(conf_in(os.path.join(BASE, "hook")))
        out = g.prompt_decision(conf, "see [REDACTED:email] and [REDACTED:credential]", "claude")
        self.assertEqual(set(out), {"systemMessage"})
        self.assertIn("credential, email", out["systemMessage"])
        self.assertIsNone(g.prompt_decision(conf, "see [REDACTED:nothing]", "claude"))


class Source(unittest.TestCase):
    def test_the_source_has_no_os_surface(self):
        with open(WRAPPER, encoding="utf-8") as fh:
            src = fh.read()
        for name in ("pbcopy", "pbpaste", "osascript", "NSPasteboard", "launchctl", "display dialog",
                     "notify-send", "xclip", "wl-copy", "open(", "iTerm"):
            self.assertNotIn(name, src, name)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: paste_wrapper_test.py <base dir for throwaway files>")
    BASE = os.path.abspath(sys.argv.pop(1))
    if os.path.exists(BASE) and os.listdir(BASE):
        sys.exit("refusing: %s exists and is not empty (the suite only writes into a fresh directory)" % BASE)
    os.makedirs(BASE, exist_ok=True)
    unittest.main(verbosity=2)
