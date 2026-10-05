#!/usr/bin/python3
# Paste filter at the CLI session's paste boundary (ADR-0011, amendment "automatic cleaning at the
# paste boundary"). A launcher that starts a harness CLI (claude, codex, kiro-cli) as a child on a
# pseudo-terminal and relays every byte both ways. In the bytes the terminal sends, it watches for a
# bracketed paste (ESC[200~ ... ESC[201~) and replaces the pasted payload with its redacted version,
# using the detection core in clipboard_guard.py, before the CLI sees it. Everything else passes
# through unchanged, byte for byte.
#
#   paste_wrapper.py run [--config FILE] -- <program> [args...]
#
# The owner activates it with shell functions he sources himself (the installer renders them into a
# managed snippet and never edits a shell rc). `command claude` bypasses it.
#
# Properties this file must keep, each with a test in paste_wrapper_test.py:
#   - typed input (anything outside a bracketed paste) reaches the CLI byte for byte, and so does a
#     paste with no finding; output from the CLI reaches the terminal byte for byte;
#   - a paste with a finding reaches the CLI with each finding replaced by [REDACTED:<category>]; the
#     original payload is never forwarded, and a paste it cannot check (too large, internal error) is
#     replaced by a one-line notice instead of being forwarded unchecked. "Never" holds for a paste
#     whose start marker arrives as one piece, or split at any byte with the pieces at most
#     HOLD_SEQUENCE_SECONDS apart; a split marker whose halves are further apart than that is not
#     recognised and its paste passes as typing (stated in ADR-0011's limits);
#   - it writes NO file, keeps no log or record of what matched (ADR-0005), never reads or writes the
#     system clipboard, and calls no dialog, notification or launchd tool. It changes nothing outside
#     the CLI session it wraps (the owner: "nao deve impactar nenhum outro app ou ux do so");
#   - window size, signals, job control, the terminal modes and the exit status are relayed, and the
#     terminal's modes are restored on every exit path;
#   - when the CLI never enables bracketed paste, nothing can be cleaned, and the owner is told so in
#     one line;
#   - every notice names categories only, never the pasted content or a matched term;
#   - the CLI it relays for gets the session marker (clipboard_guard.WRAPPER_MARKER) in its environment,
#     so the prompt hook, kept as the safety net, passes its prompts silently; a CLI it only execs
#     (not a terminal) gets the marker removed (Issue #58).
#
# Standard library only. Runs on the Command Line Tools python3 (3.9) and later. macOS and Linux.
import errno
import fcntl
import os
import pty
import re
import select
import shutil
import signal
import struct
import sys
import termios
import time
import tty

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # -I leaves the script's dir off sys.path
import clipboard_guard as core  # noqa: E402

PASTE_START = b"\x1b[200~"
PASTE_END = b"\x1b[201~"
# A possible start of a paste marker split across two reads is held before it is forwarded as typed
# input. A lone ESC is held at most HOLD_SECONDS (it is usually the Escape key). A longer prefix
# (ESC[, ESC[2, ESC[20, ESC[200) is only ever the head of a sequence the terminal writes at once, so
# it is held up to HOLD_SEQUENCE_SECONDS: a split marker delayed by a loaded host must still be
# recognised, or the paste after it would pass as typing, uncleaned (measured on Linux under load).
# A lone ESC that WAS released after its 25 ms hold is not the end of it either: if the next input,
# within HOLD_SEQUENCE_SECONDS, is "[200~", the marker was split after its first byte. The CLI already
# has the ESC, so the wrapper forwards "[200~" + the cleaned payload + the end marker, and the CLI
# reassembles the marker (QA, PR #23: the k=1 split leaked before this).
HOLD_SECONDS = 0.025
HOLD_SEQUENCE_SECONDS = 1.0
# A paste whose end marker has not arrived after this much silence is closed and cleaned as it stands.
PASTE_IDLE_SECONDS = 2.0
# How long the CLI may run without enabling bracketed paste before the owner is warned.
GRACE_SECONDS = 5.0
# After the CLI exits, its output is drained until it has been quiet this long.
EXIT_DRAIN_SECONDS = 0.2
MODE_RE = re.compile(rb"\x1b\[\?([0-9;]*)([hl])")


def _prefix_tail(buf, marker):
    """Length of the longest proper prefix of `marker` that `buf` ends with (0 if none)."""
    for k in range(min(len(marker) - 1, len(buf)), 0, -1):
        if buf.endswith(marker[:k]):
            return k
    return 0


class PasteFilter:
    """The input-side state machine. feed() takes bytes from the terminal and returns the bytes to send
    to the CLI; flush(now) releases what was held when its deadline has passed. `clean` maps a paste
    payload to (payload to forward, [categories]); it may raise, and the paste is then replaced by a
    notice. Nothing here keeps a copy of a payload once it has been forwarded."""

    def __init__(self, clean, max_bytes, notices, clock=time.monotonic):
        self.clean = clean
        self.max_bytes = max_bytes
        self.notices = notices          # {"too_large": str, "error": str} (already formatted, minus {error})
        self.clock = clock
        self.held = b""                 # outside a paste: a possible prefix of PASTE_START
        self.held_at = None
        self.esc_released_at = None     # a lone ESC was released as typing at this time (see feed)
        self.opener = PASTE_START       # what precedes the cleaned payload when a paste is forwarded
        self.in_paste = False
        self.body = bytearray()
        self.too_large = False
        self.last_input = None
        self.cleaned = 0                # pastes that had a finding
        self.categories = set()
        self.replaced = 0               # pastes replaced by a notice (too large, error)

    def deadline(self):
        if self.in_paste:
            return self.last_input + PASTE_IDLE_SECONDS
        if self.held:
            return self.held_at + (HOLD_SECONDS if self.held == b"\x1b" else HOLD_SEQUENCE_SECONDS)
        return None

    def feed(self, data):
        now = self.clock()
        self.last_input = now
        out = []
        buf = self.held + data
        self.held = b""
        while buf:
            if not self.in_paste and self.esc_released_at is not None:
                # A lone ESC was released after its 25 ms hold. If what follows within the sequence
                # hold is the rest of a paste-start marker, the marker was split after its first byte:
                # the CLI already has the ESC, so forward the rest and clean the paste (QA, PR #23).
                rest = PASTE_START[1:]
                if now - self.esc_released_at <= HOLD_SEQUENCE_SECONDS:
                    if buf.startswith(rest):
                        buf = buf[len(rest):]
                        self.esc_released_at = None
                        self.in_paste, self.body, self.too_large = True, bytearray(), False
                        self.opener = rest      # the ESC is already with the CLI
                        continue
                    if rest.startswith(buf):
                        self.held, self.held_at = buf, now      # "[", "[2" ...: wait for the rest
                        break
                self.esc_released_at = None
            if not self.in_paste:
                i = buf.find(PASTE_START)
                if i < 0:
                    keep = _prefix_tail(buf, PASTE_START)
                    out.append(buf[:len(buf) - keep])
                    if keep:
                        self.held, self.held_at = buf[len(buf) - keep:], now
                    break
                out.append(buf[:i])
                buf = buf[i + len(PASTE_START):]
                self.in_paste, self.body, self.too_large = True, bytearray(), False
                self.opener = PASTE_START
            else:
                # The end marker can straddle the previous chunk: search the body's last bytes plus
                # this chunk, never the body's own length (which _append may have trimmed).
                k = min(len(PASTE_END) - 1, len(self.body))
                window = bytes(self.body[len(self.body) - k:]) + buf
                j = window.find(PASTE_END)
                if j < 0:
                    self._append(buf)
                    break
                cut = j - k                 # where the marker starts in buf; negative: in the body
                if cut < 0:
                    del self.body[len(self.body) + cut:]
                else:
                    self._append(buf[:cut])
                out.append(self._finish())
                buf = window[j + len(PASTE_END):]
        return b"".join(out)

    def _append(self, data):
        self.body += data
        if len(self.body) > self.max_bytes:
            # Over the limit: the payload is gone. Keep only the bytes that could begin the end marker.
            self.too_large = True
            del self.body[:max(0, len(self.body) - (len(PASTE_END) - 1))]

    def flush(self, now=None):
        now = self.clock() if now is None else now
        d = self.deadline()
        if d is None or now < d:
            return b""
        if self.in_paste:
            return self._finish()        # the end marker never came: clean what arrived
        out, self.held = self.held, b""
        if out == b"\x1b":
            self.esc_released_at = now
        else:
            self.esc_released_at = None
        return out

    def _finish(self):
        body, too_large = bytes(self.body), self.too_large
        self.in_paste, self.body, self.too_large = False, bytearray(), False
        if too_large or len(body) > self.max_bytes:
            self.replaced += 1
            payload = self.notices["too_large"].encode("utf-8")
        else:
            try:
                payload, cats = self.clean(body)
            except Exception as exc:     # never forward what could not be checked
                self.replaced += 1
                payload = self.notices["error"].replace("{error}", type(exc).__name__).encode("utf-8")
            else:
                if cats:
                    self.cleaned += 1
                    self.categories.update(cats)
        del body
        return self.opener + payload + PASTE_END


class ModeTracker:
    """Watches the CLI's output for DEC private mode 2004 (bracketed paste) being set or reset."""

    def __init__(self):
        self.tail = b""
        self.enabled = False
        self.ever = False
        self.off_since = None           # when the CLI turned the mode off after having turned it on

    def feed(self, data):
        buf = self.tail + data
        last = None
        for m in MODE_RE.finditer(buf):
            if b"2004" in m.group(1).split(b";"):
                last = m
        if last is not None and last.end() > len(self.tail):
            was = self.enabled
            self.enabled = last.group(2) == b"h"
            self.ever = self.ever or self.enabled
            if was and not self.enabled:
                self.off_since = time.monotonic()
            elif self.enabled:
                self.off_since = None
        # Keep a tail long enough to hold a sequence split across reads, but not one already applied.
        cut = max(len(buf) - 64, last.end() if last is not None else 0)
        self.tail = buf[cut:]


def make_cleaner(conf, terms, salt):
    wanted = set(c.strip() for c in conf["block_categories"].split(","))

    def clean(payload):
        text = payload.decode("utf-8", "surrogateescape")
        spans = [s for s in core.find_spans(text, terms, salt) if s[2] in wanted]
        if not spans:
            return payload, []
        return core.sanitise(text, spans).encode("utf-8", "surrogateescape"), core.categories(spans)
    return clean


def notice(conf, key, **values):
    return core._format(conf, key, **values).replace("\r", " ").replace("\n", " ")


# ------------------------------------------------------------------------------------------- relay


def _winsize(fd):
    try:
        return fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8)
    except OSError:
        return None


def _write_all(fd, data):
    while data:
        try:
            n = os.write(fd, data)
        except InterruptedError:
            continue
        except BlockingIOError:
            select.select([], [fd], [], 1.0)
            continue
        data = data[n:]


def relay(real, argv0, args, conf, err=None, grace=GRACE_SECONDS):
    """Run `real` on a pty and relay. Returns the exit status to exit with."""
    err = sys.stderr if err is None else err
    terms = core.read_terms(conf["terms_file"])
    salt = None
    no_salt = False
    if terms:
        salt = core.SaltStore(conf, interactive=False).get()
        if not salt:
            no_salt = True
            err.write(notice(conf, "notice_wrapper_no_salt") + "\n")
            err.flush()
    filt = PasteFilter(make_cleaner(conf, terms, salt), int(conf["max_bytes"]), {
        "too_large": notice(conf, "notice_paste_too_large", max=conf["max_bytes"]),
        "error": notice(conf, "notice_paste_error", error="{error}"),
    })
    mode = ModeTracker()

    stdin, stdout = 0, 1
    saved = termios.tcgetattr(stdin)
    size = _winsize(stdin)
    pid, master = pty.fork()
    if pid == 0:
        try:
            termios.tcsetattr(0, termios.TCSANOW, saved)
            if size:
                fcntl.ioctl(0, termios.TIOCSWINSZ, size)
            # Only a CLI this relay cleans for carries the marker; its prompt hook then passes silently.
            os.execve(real, [argv0] + args, dict(os.environ, **{core.WRAPPER_MARKER: core.WRAPPER_MARKER_VALUE}))
        finally:
            os._exit(127)

    sig_r, sig_w = os.pipe()
    for fd in (sig_r, sig_w, master):
        fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) | os.O_NONBLOCK)
    pending_signals = []

    def on_signal(signum, _frame):
        pending_signals.append(signum)
    forwarded = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT, signal.SIGQUIT)
    old_handlers = {s: signal.signal(s, on_signal) for s in forwarded + (signal.SIGWINCH, signal.SIGCHLD)}
    old_wakeup = signal.set_wakeup_fd(sig_w)

    def set_raw():
        tty.setraw(stdin, termios.TCSANOW)

    def sync_size():
        s = _winsize(stdin)
        if s:
            try:
                fcntl.ioctl(master, termios.TIOCSWINSZ, s)     # the kernel signals the CLI's group
            except OSError:
                pass

    status = None                       # the CLI's raw wait status, once it has exited
    exited_at = None
    to_child = bytearray()
    start = time.monotonic()
    warned = False
    warned_off = None                   # the off_since the "turned it off" warning was given for
    stdin_open = True
    try:
        set_raw()
        while True:
            now = time.monotonic()
            deadlines = [d for d in (filt.deadline(),) if d is not None]
            if not warned and not mode.ever:
                deadlines.append(start + grace)
            if mode.off_since is not None and warned_off != mode.off_since and status is None:
                deadlines.append(mode.off_since + grace)
            if exited_at is not None:
                deadlines.append(exited_at + EXIT_DRAIN_SECONDS)
            timeout = max(0.0, min(deadlines) - now) if deadlines else None
            rlist = [sig_r, master] + ([stdin] if stdin_open else [])
            wlist = [master] if to_child else []
            try:
                r, w, _ = select.select(rlist, wlist, [], timeout)
            except InterruptedError:
                r, w = [], []
            if sig_r in r:
                try:
                    os.read(sig_r, 4096)
                except BlockingIOError:
                    pass
            while pending_signals:
                signum = pending_signals.pop(0)
                if signum == signal.SIGWINCH:
                    sync_size()
                elif signum == signal.SIGCHLD:
                    got = _reap(pid, saved, stdin, set_raw, sync_size)
                    if got is not None and status is None:
                        status, exited_at = got, time.monotonic()
                else:
                    try:
                        os.kill(pid, signum)
                    except OSError:
                        pass
            if master in r:
                try:
                    data = os.read(master, 65536)
                except BlockingIOError:
                    data = None
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        raise
                    data = b""
                if data == b"":
                    break                   # every holder of the CLI's terminal has closed it
                if data:
                    mode.feed(data)
                    _write_all(stdout, data)
                    if exited_at is not None:
                        exited_at = time.monotonic()
            if stdin in r:
                try:
                    data = os.read(stdin, 65536)
                except (BlockingIOError, InterruptedError):
                    data = None
                except OSError:
                    data = b""
                if data == b"":
                    stdin_open = False      # the terminal went away; the CLI gets SIGHUP from its own
                elif data:
                    to_child += filt.feed(data)
            to_child += filt.flush()
            if to_child and (master in w or not wlist):
                try:
                    n = os.write(master, bytes(to_child))
                    del to_child[:n]
                except BlockingIOError:
                    pass
                except OSError:
                    to_child.clear()
            if not warned and not mode.ever and time.monotonic() >= start + grace:
                warned = True
                _write_all(stdout, b"\r\n" + notice(conf, "notice_no_bracketed_paste", program=argv0).encode("utf-8") + b"\r\n")
            # Turned off mid-session and still off after the grace period (a CLI that is merely
            # exiting turns it off too, and is gone by then): say pastes are no longer cleaned.
            if (mode.off_since is not None and warned_off != mode.off_since and status is None
                    and time.monotonic() >= mode.off_since + grace):
                warned_off = mode.off_since
                _write_all(stdout, b"\r\n" + notice(conf, "notice_bracketed_paste_off", program=argv0).encode("utf-8") + b"\r\n")
            if exited_at is not None and time.monotonic() >= exited_at + EXIT_DRAIN_SECONDS:
                break                       # the CLI exited and a process it left behind holds its terminal
        if status is None:
            status = _wait(pid)
    finally:
        termios.tcsetattr(stdin, termios.TCSADRAIN, saved)
        signal.set_wakeup_fd(old_wakeup)
        for s, h in old_handlers.items():
            signal.signal(s, h)
        for fd in (sig_r, sig_w, master):
            try:
                os.close(fd)
            except OSError:
                pass
    if filt.cleaned or filt.replaced:
        err.write(notice(conf, "notice_session_summary", count=filt.cleaned,
                         categories=", ".join(c for c in core.CATEGORY_ORDER if c in filt.categories) or "-",
                         replaced=filt.replaced) + "\n")
    if not mode.ever:
        err.write(notice(conf, "notice_no_bracketed_paste", program=argv0) + "\n")
    if no_salt:
        err.write(notice(conf, "notice_wrapper_no_salt") + "\n")
    err.flush()
    return _exit_code(status)


def _reap(pid, saved, stdin, set_raw, sync_size):
    """Handle a SIGCHLD: the CLI exited (return its raw status) or was stopped (job control: stop this
    launcher too, so the shell gets its prompt back; on resume, continue the CLI)."""
    try:
        got, raw = os.waitpid(pid, os.WNOHANG | os.WUNTRACED)
    except ChildProcessError:
        return None
    if got == 0:
        return None
    if os.WIFSTOPPED(raw):
        termios.tcsetattr(stdin, termios.TCSADRAIN, saved)
        os.kill(os.getpid(), signal.SIGSTOP)
        set_raw()
        sync_size()
        os.kill(pid, signal.SIGCONT)
        return None
    return raw


def _wait(pid):
    while True:
        try:
            got, raw = os.waitpid(pid, os.WUNTRACED)
        except ChildProcessError:
            return 0
        if got and not os.WIFSTOPPED(raw):
            return raw


def _exit_code(raw):
    if os.WIFEXITED(raw):
        return os.WEXITSTATUS(raw)
    if os.WIFSIGNALED(raw):
        return 128 + os.WTERMSIG(raw)
    return 1


# ------------------------------------------------------------------------------------------- CLI

USAGE = """usage:
  paste_wrapper.py run [--config FILE] -- <program> [args...]
Runs <program> on a pseudo-terminal and cleans bracketed pastes before it sees them (ADR-0011).
"""


def main(argv):
    args = list(argv[1:])
    if not args or args[0] in ("-h", "--help") or args[0] != "run":
        sys.stdout.write(USAGE)
        return 0 if args and args[0] in ("-h", "--help") else 2
    args.pop(0)
    config, grace = None, GRACE_SECONDS
    while args and args[0] != "--":
        flag = args.pop(0)
        if flag == "--config" and args:
            config = args.pop(0)
        elif flag == "--grace" and args:
            grace = float(args.pop(0))
        else:
            sys.stderr.write("unknown or incomplete argument: %s\n" % flag)
            return 2
    if not args or len(args) < 2:
        sys.stderr.write(USAGE)
        return 2
    argv0, rest = args[1], args[2:]
    real = argv0 if os.sep in argv0 else shutil.which(argv0)
    if not real:
        sys.stderr.write("%s: command not found\n" % argv0)
        return 127
    # Not an interactive terminal on both ends: nothing can be pasted, so get out of the way entirely.
    # Nothing is cleaned on this path, so the marker is removed, even one inherited from an outer session.
    if not (os.isatty(0) and os.isatty(1)):
        env = dict(os.environ)
        env.pop(core.WRAPPER_MARKER, None)
        os.execve(real, [argv0] + rest, env)
    try:
        conf = core.load_config(config)
    except Exception as exc:          # an unreadable settings file: say so, and do not run unchecked
        sys.stderr.write(core.DEFAULTS["notice_paste_error"].replace("{error}", type(exc).__name__) + "\n")
        return 2
    return relay(real, argv0, rest, conf, grace=grace)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
