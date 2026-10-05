#!/usr/bin/python3
# Paste filter at the harness-CLI prompt (ADR-0011, amendment "the always-on watcher is withdrawn").
# The detection core (term hashes, salt store, generic categories) as a library, plus a small CLI:
#
#   clipboard_guard.py prompt-hook --harness claude|codex [--config FILE]
#                                        the user-level UserPromptSubmit hook: reads the hook payload
#                                        on stdin and blocks a prompt carrying a finding
#   clipboard_guard.py add-term [--config FILE]     add one term to the hashed list, typed at the terminal
#   clipboard_guard.py check-config [--config FILE] print the effective non-secret settings
#
# The file keeps its historical name: the term list (`clipboard-terms`) and the Keychain salt service
# (`…clipboard-salt`) the owner already holds are found under the same names, so nothing is migrated.
#
# Properties this file must keep, each with a test in clipboard_guard_test.py:
#   - it writes NOTHING except the term list (add-term only): no log, no history, no cache, no record of
#     what matched (ADR-0005). It never reads or writes the system clipboard, calls no dialog or
#     notification tool, and runs only when a harness CLI calls it, or inside paste_wrapper.py, which
#     imports this core to clean bracketed pastes (the owner: "nao deve impactar nenhum outro app ou ux
#     do so"). The prompt hook reads a Keychain salt only after a non-interactive lock
#     probe says unlocked, with a timeout (SaltStore(interactive=False));
#   - a notice names categories and the mitigation, never the original content or the matched term;
#   - the term list holds salted hashes of normalised terms, never plaintext, and add-term reads the
#     term from the terminal with echo off: never from argv, the environment or a pipe.
#
# Standard library only. Runs on the Command Line Tools python3 (3.9) and later.
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import unicodedata

PROJECT = "personal-multi-harness-workstation-configuration"
MAX_TERM_TOKENS = 6
MIN_TERM_CHARS = 3
TERMS_HEADER = "# %s clipboard terms v1: HMAC-SHA256(salt, normalised term), one per line; never plaintext\n" % PROJECT
CATEGORY_ORDER = ["employer-client-term", "credential", "email", "payment-card", "cpf", "cnpj"]

# --------------------------------------------------------------------------------------------- config

DEFAULTS = {
    "max_bytes": "1000000",
    "block_categories": ",".join(CATEGORY_ORDER),   # which categories block a prompt; others pass
    "show_cleaned_chars": "8000",   # the redacted copy is shown in the block message up to this size
    "salt_store": "",           # keychain | file; empty means keychain on macOS, file elsewhere
    "keychain_service": PROJECT + ".clipboard-salt",
    "terms_file": "",           # empty means <local overlay>/clipboard-terms
    "salt_file": "",            # empty means <local overlay>/clipboard-salt (salt_store=file only)
    "notice_blocked": "Paste filter (ADR-0011): {categories} in this prompt. It was NOT sent, and nothing "
                      "was changed. A redacted copy is below: submit that instead, or edit your prompt.",
    "notice_cleaned_too_long": "The redacted copy is {chars} characters, too long to show here.",
    "notice_too_large": "Paste filter (ADR-0011): this prompt is over {max} bytes and was NOT checked.",
    "notice_error": "Paste filter (ADR-0011): internal error ({error}); this prompt was NOT checked.",
    "notice_no_salt": "Paste filter (ADR-0011): the term list exists but its salt could not be read without "
                      "a prompt (Keychain locked, slow or item missing), so employer/client term matching "
                      "was NOT checked for this prompt.",
    # The paste wrapper (paste_wrapper.py), and the hook's notice for a prompt that carries its markers.
    # The first two REPLACE a paste inside the CLI's input, so they stay one line.
    "notice_paste_too_large": "[paste filter (ADR-0011): a paste over {max} bytes was NOT forwarded, it could not "
                              "be checked]",
    "notice_paste_error": "[paste filter (ADR-0011): internal error ({error}), the paste was NOT forwarded]",
    "notice_no_bracketed_paste": "Paste filter (ADR-0011): {program} has not enabled bracketed paste, so pastes in "
                                 "this session are NOT cleaned.",
    "notice_bracketed_paste_off": "Paste filter (ADR-0011): {program} turned bracketed paste off, so pastes are "
                                  "NOT cleaned until it turns it back on.",
    "notice_session_summary": "Paste filter (ADR-0011): {count} paste(s) cleaned in this session ({categories}); "
                              "{replaced} paste(s) replaced by a notice.",
    "notice_wrapper_no_salt": "Paste filter (ADR-0011): the term list exists but its salt could not be read without "
                              "a prompt, so employer/client terms are NOT cleaned in this session.",
    "notice_paste_redacted": "Paste filter (ADR-0011): this prompt carries redacted text ({categories}); the "
                             "original was not sent.",
}
HARNESSES = ("claude", "codex")


def data_dir():
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, PROJECT)


def local_overlay_dir():
    """Untracked, user-only, outside every repository: where the term list and a file salt live."""
    return os.path.join(data_dir(), "local-overlay")


def load_config(path):
    """key=value per line, '#' comments, last value wins; an invalid value falls back to its default.
    Keys this version does not know (the retired watcher's) are ignored."""
    conf = dict(DEFAULTS)
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\r\n")
                if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if key in DEFAULTS:
                    conf[key] = value.strip() if not key.startswith("notice_") else value
    for key in ("max_bytes", "show_cleaned_chars"):
        if not conf[key].isdigit() or int(conf[key]) < 1:
            conf[key] = DEFAULTS[key]
    wanted = [c.strip() for c in conf["block_categories"].split(",") if c.strip()]
    if not wanted or any(c not in CATEGORY_ORDER for c in wanted):
        conf["block_categories"] = DEFAULTS["block_categories"]   # a typo never switches a category off
    if conf["salt_store"] not in ("keychain", "file"):
        conf["salt_store"] = "keychain" if sys.platform == "darwin" else "file"
    if not conf["terms_file"]:
        conf["terms_file"] = os.path.join(local_overlay_dir(), "clipboard-terms")
    if not conf["salt_file"]:
        conf["salt_file"] = os.path.join(local_overlay_dir(), "clipboard-salt")
    return conf

# ---------------------------------------------------------------------------------- normalisation


def _is_word_char(ch):
    return unicodedata.category(ch)[0] in "LNM"


def tokens(text):
    """[(start, end, normalised)] for each word in text. A word is a run of letters, digits and
    combining marks; everything else separates. Normalised: accents dropped, case folded."""
    out = []
    i, n = 0, len(text)
    while i < n:
        if not _is_word_char(text[i]) or unicodedata.category(text[i])[0] == "M":
            i += 1
            continue
        j = i + 1
        while j < n and _is_word_char(text[j]):
            j += 1
        norm = _normalise_word(text[i:j])
        if norm:
            out.append((i, j, norm))
        i = j
    return out


def _normalise_word(word):
    decomposed = unicodedata.normalize("NFKD", word).casefold()
    return "".join(c for c in decomposed if unicodedata.category(c)[0] in "LN")


def term_forms(term):
    """The normalised forms stored for one term: words joined by a space and, for a multi-word term,
    also run together (so 'Acme Corp' also matches 'AcmeCorp' and 'acme_corp')."""
    words = [t[2] for t in tokens(term)]
    if not words:
        return []
    forms = [" ".join(words)]
    if len(words) > 1:
        forms.append("".join(words))
    return forms


def term_hash(salt, form):
    return hmac.new(bytes.fromhex(salt), form.encode("utf-8"), hashlib.sha256).hexdigest()

# --------------------------------------------------------------------------------------- detectors

# Credential prefixes in the style of gitleaks' rules: each has a fixed vendor prefix, so a match is
# very unlikely to be ordinary text. Conservative by design: an unprefixed high-entropy string is not
# flagged (that is where the false positives are).
CREDENTIAL_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|\Z)"),
    re.compile(r"\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b"),                 # AWS access key id
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"),                         # GitHub token
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{50,255}\b"),                       # GitHub fine-grained PAT
    re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"),                                # GitLab PAT
    re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"),                           # Slack token
    re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}"),    # Slack webhook
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),                                 # Google API key
    re.compile(r"\b[rs]k_live_[0-9A-Za-z]{20,}\b"),                           # Stripe live key
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}"),                               # Anthropic API key
    re.compile(r"\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}"),            # OpenAI API key
    re.compile(r"\bnpm_[A-Za-z0-9]{36}\b"),                                   # npm token
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),  # JWT
]

EMAIL = re.compile(r"(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b")
# Not personal data: an SSH remote's user, and the domains reserved for examples (RFC 2606, RFC 6761).
EMAIL_SKIP_LOCAL = ("git",)
EMAIL_SKIP_DOMAIN = re.compile(r"(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost|users\.noreply\.github\.com)$",
                               re.IGNORECASE)

CARD = re.compile(r"(?<![\d-])\d(?:[ -]?\d){14,15}(?![\d-])")
CPF = re.compile(r"(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d-])")
CNPJ = re.compile(r"(?<![\d.])\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}(?![\d-])")


def _luhn_ok(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def _card_ok(digits):
    if len(digits) == 15:
        prefix_ok = digits[:2] in ("34", "37")                                # Amex
    else:
        p2, p4 = int(digits[:2]), int(digits[:4])
        prefix_ok = digits[0] == "4" or 51 <= p2 <= 55 or 2221 <= p4 <= 2720 or digits[:4] == "6011" or p2 == 65
    return prefix_ok and _luhn_ok(digits)


def _mod11_digit(digits, weights):
    s = sum(int(d) * w for d, w in zip(digits, weights)) % 11
    return 0 if s < 2 else 11 - s


def cpf_ok(digits):
    if len(digits) != 11 or len(set(digits)) == 1:
        return False
    d1 = _mod11_digit(digits[:9], range(10, 1, -1))
    d2 = _mod11_digit(digits[:9] + str(d1), range(11, 1, -1))
    return digits[9:] == "%d%d" % (d1, d2)


def cnpj_ok(digits):
    if len(digits) != 14 or len(set(digits)) == 1:
        return False
    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    d1 = _mod11_digit(digits[:12], w1)
    d2 = _mod11_digit(digits[:12] + str(d1), [6] + w1)
    return digits[12:] == "%d%d" % (d1, d2)


def find_spans(text, term_hashes=frozenset(), salt=None):
    """[(start, end, category)] for every finding. Categories: employer-client-term, credential,
    email, payment-card, cpf, cnpj. Never returns the matched text itself."""
    spans = []
    for rx in CREDENTIAL_PATTERNS:
        spans += [(m.start(), m.end(), "credential") for m in rx.finditer(text)]
    for m in EMAIL.finditer(text):
        if m.group(1).lower() not in EMAIL_SKIP_LOCAL and not EMAIL_SKIP_DOMAIN.search(m.group(2)):
            spans.append((m.start(), m.end(), "email"))
    for m in CARD.finditer(text):
        if _card_ok(re.sub(r"[ -]", "", m.group(0))):
            spans.append((m.start(), m.end(), "payment-card"))
    spans += [(m.start(), m.end(), "cpf") for m in CPF.finditer(text) if cpf_ok(re.sub(r"\D", "", m.group(0)))]
    spans += [(m.start(), m.end(), "cnpj") for m in CNPJ.finditer(text) if cnpj_ok(re.sub(r"\D", "", m.group(0)))]
    if term_hashes and salt:
        words = tokens(text)
        for i in range(len(words)):
            for n in range(1, min(MAX_TERM_TOKENS, len(words) - i) + 1):
                group = [w[2] for w in words[i:i + n]]
                forms = {" ".join(group), "".join(group)}
                if any(term_hash(salt, f) in term_hashes for f in forms):
                    spans.append((words[i][0], words[i + n - 1][1], "employer-client-term"))
    return spans


def categories(spans):
    found = {s[2] for s in spans}
    return [c for c in CATEGORY_ORDER if c in found]


def sanitise(text, spans):
    """Replace every finding with [REDACTED:<category>]. Overlapping findings merge into one, labelled
    by the earliest-starting one. The replacement is not reversible: no mapping is kept anywhere."""
    out, pos = [], 0
    merged = []
    for start, end, cat in sorted(spans):
        if merged and start < merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end, cat])
    for start, end, cat in merged:
        out.append(text[pos:start])
        out.append("[REDACTED:%s]" % cat)
        pos = end
    out.append(text[pos:])
    return "".join(out)

# -------------------------------------------------------------------------------------- salt store


KEYCHAIN_READ_SECONDS = 2


def keychain_unlocked(path=None):
    """True when the default keychain (or the keychain file at `path`) is unlocked, False when it is
    locked, None when that cannot be determined. It asks Security.framework for the keychain's STATUS
    with user interaction switched off for this process, so it never raises an unlock dialog itself.

    Why a status probe and not an in-process read: the salt item was created by /usr/bin/security, so its
    access list trusts that tool and not python3. Read in process with interaction off, it fails with
    errSecAuthFailed (-25293); with interaction on it would ask the owner for access. Measured 2026-10-01
    on a namespaced synthetic item. So the read stays a `security` subprocess, which the item trusts, and
    this probe decides whether that read may run at all."""
    try:
        import ctypes
        sec = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/Security.framework/Security")
        cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        sec.SecKeychainSetUserInteractionAllowed.argtypes = [ctypes.c_ubyte]
        sec.SecKeychainSetUserInteractionAllowed.restype = ctypes.c_int32
        sec.SecKeychainCopyDefault.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
        sec.SecKeychainCopyDefault.restype = ctypes.c_int32
        sec.SecKeychainOpen.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
        sec.SecKeychainOpen.restype = ctypes.c_int32
        sec.SecKeychainGetStatus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        sec.SecKeychainGetStatus.restype = ctypes.c_int32
        cf.CFRelease.argtypes = [ctypes.c_void_p]
        if sec.SecKeychainSetUserInteractionAllowed(0) != 0:
            return None
        ref = ctypes.c_void_p()
        rc = sec.SecKeychainOpen(path.encode(), ctypes.byref(ref)) if path else sec.SecKeychainCopyDefault(ctypes.byref(ref))
        if rc != 0 or not ref.value:
            return None
        status = ctypes.c_uint32()
        try:
            rc = sec.SecKeychainGetStatus(ref, ctypes.byref(status))
        finally:
            cf.CFRelease(ref)
        return bool(status.value & 1) if rc == 0 else None      # kSecUnlockStateStatus = 1
    except (OSError, AttributeError):
        return None


class SaltStore:
    """The salt keys every term hash. macOS: the login Keychain (generic password), written through
    `security -i` on stdin so the value never appears in a process's argv. Elsewhere, or by choice: a
    user-only file (0600) in the local overlay directory, outside every repository.

    interactive=False is the prompt hook's mode: the Keychain is read only when keychain_unlocked() says
    the default keychain is unlocked, and the `security` read is bounded by KEYCHAIN_READ_SECONDS. A
    locked, unknown or slow keychain yields None, which the hook reports as term matching OFF; it never
    waits on an unlock dialog. add-term keeps interactive=True: the owner is at his own terminal."""

    def __init__(self, conf, run=None, interactive=True, lock_probe=None):
        self.conf = conf
        self.run = run
        self.interactive = interactive
        self.lock_probe = lock_probe

    def get(self):
        run = self.run or subprocess.run
        if self.conf["salt_store"] == "keychain":
            argv = ["/usr/bin/security", "find-generic-password", "-s", self.conf["keychain_service"],
                    "-a", _account(), "-w"]
            if self.interactive:
                r = run(argv, capture_output=True)
            else:
                if (self.lock_probe or keychain_unlocked)() is not True:
                    return None
                try:
                    r = run(argv, capture_output=True, stdin=subprocess.DEVNULL, timeout=KEYCHAIN_READ_SECONDS)
                except (OSError, subprocess.SubprocessError):
                    return None
            value = r.stdout.decode().strip() if r.returncode == 0 else ""
        else:
            try:
                with open(self.conf["salt_file"], encoding="ascii") as fh:
                    value = fh.read().strip()
            except OSError:
                value = ""
        return value if re.fullmatch(r"[0-9a-f]{64}", value) else None

    def create(self):
        value = secrets.token_hex(32)
        if self.conf["salt_store"] == "keychain":
            cmd = 'add-generic-password -s "%s" -a "%s" -w "%s"\n' % (self.conf["keychain_service"], _account(), value)
            r = (self.run or subprocess.run)(["/usr/bin/security", "-i"], input=cmd.encode(), capture_output=True)
            if r.returncode != 0:
                raise RuntimeError("could not store the salt in the Keychain")
        else:
            _private_dir(os.path.dirname(self.conf["salt_file"]))
            _atomic_write(self.conf["salt_file"], value + "\n")
        if self.get() != value:
            raise RuntimeError("the salt was written but does not read back")
        return value

    def get_or_create(self):
        return self.get() or self.create()


def _account():
    return os.environ.get("USER") or str(os.getuid())


def _private_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)


def _atomic_write(path, content):
    tmp = "%s.new.%d" % (path, os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as fh:
        fh.write(content)
    os.replace(tmp, path)

# -------------------------------------------------------------------------------------- term list


def read_terms(path):
    try:
        with open(path, encoding="ascii") as fh:
            return frozenset(line.strip() for line in fh if re.fullmatch(r"[0-9a-f]{64}", line.strip()))
    except OSError:
        return frozenset()


def add_term_hashes(path, hashes):
    _private_dir(os.path.dirname(path))
    current = read_terms(path)
    new = [h for h in hashes if h not in current]
    lines = sorted(current | set(new))
    _atomic_write(path, TERMS_HEADER + "".join(h + "\n" for h in lines))
    return len(new)

# ------------------------------------------------------------------------------- the prompt hook


REDACTED_MARKER = re.compile(r"\[REDACTED:(%s)\]" % "|".join(CATEGORY_ORDER))
PASTE_MARKER_LINE = re.compile(r"^</?pasted_content\b[^\n]*>\n?", re.MULTILINE)


def _format(conf, key, **values):
    try:
        return conf[key].format(**values)
    except (KeyError, IndexError, ValueError):
        return DEFAULTS[key].format(**values)   # an overlay template with a bad placeholder


def prompt_decision(conf, prompt, harness, salts=None):
    """The hook's whole judgement, as data. Returns the JSON object to print, or None to print nothing
    (a clean prompt: on Claude Code and Codex, plain stdout at exit 0 would become model context).

    A finding blocks the prompt. The block message names the categories and carries a REDACTED copy of
    the prompt; it never carries the original text or a matched term. On Claude Code it also sets
    suppressOriginalPrompt, without which the harness itself appends "Original prompt:" and the submitted
    text to the block message (documented: hooks reference, "What a blocked prompt leaves behind").
    Anything that stops the check fails OPEN with a visible warning (systemMessage), never silently."""
    if len(prompt.encode("utf-8")) > int(conf["max_bytes"]):
        return {"systemMessage": _format(conf, "notice_too_large", max=conf["max_bytes"])}
    warnings = []
    terms = read_terms(conf["terms_file"])
    salt = None
    if terms:
        salt = (salts or SaltStore(conf, interactive=False)).get()
        if not salt:
            warnings.append(_format(conf, "notice_no_salt"))
    blocking = set(c.strip() for c in conf["block_categories"].split(","))
    spans = [s for s in find_spans(prompt, terms, salt) if s[2] in blocking]
    if not spans:
        # Text the paste wrapper (or an earlier block) already redacted: say so, by category only.
        marked = set(REDACTED_MARKER.findall(prompt))
        if marked:
            warnings.append(_format(conf, "notice_paste_redacted",
                                    categories=", ".join(c for c in CATEGORY_ORDER if c in marked)))
        return {"systemMessage": " ".join(warnings)} if warnings else None
    # Claude Code may wrap an expanded paste in marker lines (documented); they are not the owner's text,
    # so they are dropped from the copy he would resubmit.
    cleaned = PASTE_MARKER_LINE.sub("", sanitise(prompt, spans))
    parts = [_format(conf, "notice_blocked", categories=", ".join(categories(spans)))] + warnings
    if len(cleaned) <= int(conf["show_cleaned_chars"]):
        parts.append("\n" + cleaned)
    else:
        parts.append(_format(conf, "notice_cleaned_too_long", chars=len(cleaned)))
    out = {"decision": "block", "reason": "\n".join(parts)}
    if harness == "claude":
        out["hookSpecificOutput"] = {"hookEventName": "UserPromptSubmit", "suppressOriginalPrompt": True}
    return out


def cmd_prompt_hook(conf, harness, stdin=None, stdout=None, salts=None):
    """Read one UserPromptSubmit payload from stdin, print the decision (or nothing), exit 0.
    An error is reported by its exception CLASS only, because a message can quote the input."""
    stdin = stdin if stdin is not None else sys.stdin.buffer
    stdout = stdout if stdout is not None else sys.stdout
    limit = int(conf["max_bytes"]) * 6 + 65536     # JSON escaping can inflate the prompt (\uXXXX)
    try:
        raw = stdin.read(limit + 1)
        if len(raw) > limit:
            out = {"systemMessage": _format(conf, "notice_too_large", max=conf["max_bytes"])}
        else:
            payload = json.loads(raw.decode("utf-8"))
            prompt = payload.get("prompt") if isinstance(payload, dict) else None
            if not isinstance(prompt, str):
                raise ValueError("no prompt field")
            out = prompt_decision(conf, prompt, harness, salts)
    except Exception as exc:
        out = {"systemMessage": _format(conf, "notice_error", error=type(exc).__name__)}
    if out is not None:
        # ASCII-only JSON: the output never depends on the locale the harness gives the hook.
        stdout.write(json.dumps(out, ensure_ascii=True) + "\n")
        stdout.flush()
    return 0

# ------------------------------------------------------------------------------------------ CLI

USAGE = """usage:
  clipboard_guard.py prompt-hook --harness claude|codex [--config FILE]
                                                   the UserPromptSubmit hook (payload on stdin)
  clipboard_guard.py add-term [--config FILE]      add one term, typed at your terminal with echo off
  clipboard_guard.py check-config [--config FILE]  print the effective non-secret settings
No command takes a term as an argument.
"""

AGENT_MARKERS = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT", "CODEX_SANDBOX",
                 "CODEX_SANDBOX_NETWORK_DISABLED")


class Cancelled(Exception):
    """The owner ended an entry with Ctrl+D (end of file) instead of Enter."""


def _read_secret_line(tty_fd, prompt):
    """Read one line from the terminal with nothing echoed, and return it without its line ending.

    The terminal's own modes are NOT trusted (Issue #5): a terminal can deliver Enter as "\\r" with
    ICRNL off, and in canonical mode the kernel then never completes the line, so the read blocks
    forever. So for the duration of the read this sets exactly the modes it depends on:
      - ICANON and ICRNL on, INLCR and IGNCR off: Enter ("\\r" or "\\n") completes the line, and the
        kernel still does the line editing (erase, kill);
      - ECHO and ECHONL off: nothing typed is echoed, not even the newline;
      - ISIG on: Ctrl+C raises KeyboardInterrupt instead of being read as a character.
    A line also ends at "\\r", which matters only if the driver ignored the ICRNL request.
    Ctrl+D (end of file) raises Cancelled; an unterminated partial line is never returned.
    The exact original modes are restored on every exit path, Ctrl+C included."""
    import termios
    old = termios.tcgetattr(tty_fd)
    new = termios.tcgetattr(tty_fd)
    new[0] = (new[0] | termios.ICRNL) & ~(termios.INLCR | termios.IGNCR)
    new[3] = (new[3] | termios.ICANON | termios.ISIG) & ~(termios.ECHO | termios.ECHONL)
    try:
        # Echo goes off BEFORE the prompt appears, so nothing typed after the prompt is ever echoed.
        termios.tcsetattr(tty_fd, termios.TCSADRAIN, new)
        os.write(tty_fd, prompt.encode())
        buf = b""
        while True:
            chunk = os.read(tty_fd, 1024)
            if not chunk or b"\x04" in chunk:      # EOF; a literal ^D only arrives if VEOF is disabled
                raise Cancelled()
            if b"\x03" in chunk:                    # a literal ^C only arrives if VINTR is disabled
                raise KeyboardInterrupt()
            buf += chunk
            ends = [i for i in (buf.find(b"\n"), buf.find(b"\r")) if i >= 0]
            if ends:
                buf = buf[:min(ends)]
                break
    finally:
        termios.tcsetattr(tty_fd, termios.TCSADRAIN, old)
        os.write(tty_fd, b"\n")
    return buf.decode("utf-8", "replace")


def cmd_add_term(conf, out=sys.stdout):
    present = [m for m in AGENT_MARKERS if os.environ.get(m)]
    if present:
        out.write("refused: an agent session marker is set (%s). Add terms from your own terminal, outside "
                  "any agent session, so the term never enters a transcript.\n" % ", ".join(present))
        return 2
    if not os.isatty(0):
        out.write("refused: stdin is not a terminal. The term is read only from the terminal, with echo off.\n")
        return 2
    try:
        tty = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
    except OSError:
        out.write("refused: no controlling terminal.\n")
        return 2
    try:
        first = _read_secret_line(tty, "Term (not shown): ")
        second = _read_secret_line(tty, "Again: ")
    except (KeyboardInterrupt, Cancelled):
        out.write("not added: entry cancelled. Nothing was written.\n")
        return 130
    finally:
        os.close(tty)
    if first != second:
        out.write("not added: the two entries differ.\n")
        return 1
    forms = term_forms(first)
    del first, second
    if not forms or len(forms[0].split(" ")) > MAX_TERM_TOKENS or len(forms[0].replace(" ", "")) < MIN_TERM_CHARS:
        out.write("not added: a term has 1 to %d words and at least %d letters or digits.\n" % (MAX_TERM_TOKENS, MIN_TERM_CHARS))
        return 1
    salt = SaltStore(conf).get_or_create()
    n = add_term_hashes(conf["terms_file"], [term_hash(salt, f) for f in forms])
    del forms
    out.write("added: %d new hash(es) to %s. The term itself was not stored anywhere.\n" % (n, conf["terms_file"]))
    return 0


def main(argv):
    args = list(argv[1:])
    if not args or args[0] in ("-h", "--help"):
        sys.stdout.write(USAGE)
        return 0
    command, rest = args[0], args[1:]
    config, harness = None, None
    while rest:
        flag = rest.pop(0)
        if flag == "--config" and rest:
            config = rest.pop(0)
        elif flag == "--harness" and rest:
            harness = rest.pop(0)
        else:
            sys.stderr.write("unknown or incomplete argument: %s (no term is ever taken from arguments)\n" % flag)
            return 2
    if command == "prompt-hook" and harness not in HARNESSES:
        sys.stderr.write("prompt-hook: --harness must be one of %s\n" % ", ".join(HARNESSES))
        return 2
    try:
        conf = load_config(config)
    except Exception as exc:          # an unreadable settings file: visible, and the prompt passes
        if command != "prompt-hook":
            raise
        sys.stdout.write(json.dumps({"systemMessage": DEFAULTS["notice_error"].format(error=type(exc).__name__)}) + "\n")
        return 0
    if command == "prompt-hook":
        return cmd_prompt_hook(conf, harness)
    if command == "add-term":
        return cmd_add_term(conf)
    if command == "check-config":
        for key in ("max_bytes", "block_categories", "show_cleaned_chars", "salt_store", "keychain_service",
                    "terms_file", "salt_file"):
            sys.stdout.write("%s=%s\n" % (key, conf[key]))
        sys.stdout.write("terms=%d\n" % len(read_terms(conf["terms_file"])))
        return 0
    sys.stderr.write("unknown command: %s\n" % command)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
