#!/usr/bin/env python3
"""Render the workstation deny floor into Kiro's user-level permissions.yaml (ADR-0036, Issue #144).

    kiro_permissions.py --mode=install|check|dry-run|uninstall|report --stamp=STAMP --floor=FILE
                        [--admin=FILE]   (report only: also a FLOOR line for the root-owned admin copy)
    kiro_permissions.py --mode=admin-json --stamp=STAMP --from-yaml=FILE
                        (print the admin managed-settings.json install-managed.sh installs; writes nothing)
    kiro_permissions.py --mode=admin-validate --file=FILE
                        (exit 3 unless FILE is an admin document Kiro accepts, every statement under the
                        condition ceiling; a file Kiro rejects puts Kiro in deny-all)

FILE is the deny floor install.sh already validated (global/deny-floor.conf, then the overlay's), the same
single source the Claude Code and Codex floors are rendered from. STAMP is install.sh's provenance stamp
("release: ...; commit: ..."), so it is derived once (ADR-0029).

Target. ~/.kiro/settings/permissions.yaml, from HOME only: no argument names a path this script writes.
Kiro IDE (1.x) and Kiro CLI V3 read it with one rule engine (documented, kiro.dev/docs/permissions).

Rendering. Every floor entry becomes a deny pattern:
  cmd  <words>        shell    "<words> *"   Kiro compiles a pattern ending in " *" to "equals <words>, or
                                              <words> followed by anything" (read from the IDE bundle)
  glob <words>*       shell    "<words>*"     as written
  file <path>         fs_read and fs_write "<path>"  (a leading ~/ is the home directory)
A pattern is present when some deny rule of that exact capability, with no exclude list, lists it. The
missing patterns are appended as new deny rules, one per capability. Nothing is ever removed on install.

Merge, never clobber. The file is parsed with a strict reader for the subset Kiro's schema uses (a
top-level "rules" list of mappings with capability, effect, match and exclude, and an optional "policies"
list). Anything outside that subset (an anchor, a tag, a flow mapping, a multi-line scalar, an unknown
key), or a file Kiro itself would reject (it then drops every rule in it), is REFUSED: nothing written.
The owner's rules are kept, in order, value for value; the file is re-serialised, so his comments and
quoting do not survive (the backup does). The new text is parsed back and must equal the old rules plus
the appended ones, or nothing is written. Before a write the previous file is copied to
permissions.yaml.pmhwc-backup, owner-only (0600).

Ownership. The deny rules this script appended (capability and match list, as appended) are recorded in
$XDG_DATA_HOME/personal-multi-harness-workstation-configuration/kiro-permissions-owned.json, outside the
YAML: Kiro rewrites permissions.yaml when the owner answers a consent prompt with a user-scope rule (read
from the IDE bundle), which drops every comment. Each entry is matched to its own distinct rule: a deny
of that capability, no exclude, with exactly the recorded match list. Install reconciles the record with
the file before anything else and forgets an entry with no such rule (a NOTE line), so the record never
holds an entry without its own rule. Uninstall removes only matched rules, whole, never one of the
owner's rules even when it holds the same pattern, unless his rule is byte-identical to the one mhw
appended (he deleted mhw's rule and typed the same rule back, with no install in between), which it cannot
tell apart. A rule mhw appended that has since gained a pattern
(his edit, or a consent pattern Kiro appended) can no longer be told apart from his, so it stays. An
entry that cannot be matched, or no record at all, removes nothing (the safe direction), said on a NOTE
line.

The provenance stamp is the first comment line. A Kiro rewrite drops it: --check then reads STAMP, and
install writes it back, as long as the rewrite stays inside the reader's subset. Kiro's writer (the yaml
package, lines folded at 80 columns) can fold a long pattern or leave a value such as yes unquoted; such a
file is refused with that cause and the remedy named, never guessed at.

Kiro's lock. install and uninstall take Kiro's own lock (proper-lockfile: a <real file>.lock directory made
with mkdir, read from the IDE bundle) before reading, and hold it across the write and the rename, so while
both honour the lock a consent rule Kiro writes meanwhile is not lost. The wait is bounded; a lock still
held is refused, with nothing written and the lock left alone. Before each rename, and before uninstall
removes a file mhw created, the lock must still be the directory mhw made (same device and inode), or that
step is refused and the file is left as it is (Kiro reclaimed it); the refusal names any file this run had
already changed before it saw the reclaim. If the lock is still ours, its mtime is refreshed so it does not
look stale to Kiro. On release it is removed
only if it still looks like ours, and a failed release is a NOTE, never a traceback. The identity check is
best effort: an inode can be reused, and a reclaim can land between a check and the rename or the rmdir.

permissions.json. Kiro reads permissions.yaml when it exists and permissions.json only otherwise (read from
the IDE bundle). Writing a yaml beside the owner's json would silently drop his json rules, so a non-empty
permissions.json without a permissions.yaml is REFUSED.

Exit codes, as install.sh: 0 ok · 1 drift, stamp or missing (--check) · 2 usage or floor · 3 refused.
"""
import contextlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # global/, first: no other module named private_copy may replace it
from private_copy import private_copy  # noqa: E402

MARKER_ID = "managed-by: personal-multi-harness-workstation-configuration"
BACKUP = ".pmhwc-backup"
CAPS = ("shell", "fs_read", "fs_write")
EFFECTS = ("deny", "allow", "ask")
RULE_KEYS = ("capability", "effect", "match", "exclude")
WORD_RE = re.compile(r"[A-Za-z0-9._/~=:@+*-]+")
# Plain scalars a YAML parser could read as something other than a string, and the characters a plain
# scalar may not start with. Both are refused, never re-quoted: quoting one would turn a rule Kiro rejects
# (which disables the whole file) into a rule that applies. Fail closed: YAML 1.2 core plus every YAML 1.1
# implicit type (yaml.org/type: bool, float, int, merge, null, timestamp, value), matched case-insensitively
# (after lowering), with any number spelling (signs, leading dot, exponent, hex, octal, binary, underscores,
# sexagesimal) and the three timestamp spellings.
NOT_STRING_WORDS = {"~", "null", "true", "false", "yes", "no", "on", "off", "y", "n", "<<", "="}
NOT_STRING_RE = re.compile(r"[-+]?(?:0x[0-9a-f_]+|0o[0-7_]+|0b[01_]+"
                           r"|(?:[0-9][0-9_]*(?::[0-9_]+)*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:e[-+]?[0-9_]+)?"
                           r"|\.inf|\.nan)")
TIMESTAMP_RE = re.compile(r"[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:(?:[t ]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}"
                          r"(?:\.[0-9]*)?(?:[ \t]*(?:z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)?")


def not_a_string(tok):
    low = tok.lower()
    return (low in NOT_STRING_WORDS or NOT_STRING_RE.fullmatch(low) is not None
            or TIMESTAMP_RE.fullmatch(low) is not None)
BAD_START = set("&*!|>{}%@`,[]'\"#")


class Refuse(Exception):
    pass


def target():
    return Path.home() / ".kiro" / "settings" / "permissions.yaml"


def owned_path():
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "personal-multi-harness-workstation-configuration" / "kiro-permissions-owned.json"


# --- the floor -------------------------------------------------------------------------------------------

def load_floor(path):
    """-> {capability: [pattern, ...]} in floor order, without repeats."""
    want = {c: [] for c in CAPS}

    def add(cap, pattern):
        if pattern not in want[cap]:
            want[cap].append(pattern)

    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.rstrip("\r")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        f = line.split()
        if f[0] not in ("cmd", "file", "glob") or len(f) < 2 or not all(WORD_RE.fullmatch(w) for w in f[1:]):
            raise ValueError("invalid deny-floor entry: %s" % line)
        if f[0] == "cmd":
            if any("*" in w for w in f[1:]):
                raise ValueError("a cmd word may not hold *: %s" % line)
            add("shell", " ".join(f[1:]) + " *")
        elif f[0] == "glob":
            add("shell", " ".join(f[1:]))
        else:
            if len(f) != 2:
                raise ValueError("a file entry takes one path: %s" % line)
            add("fs_read", f[1])
            add("fs_write", f[1])
    if not any(want.values()):
        raise ValueError("the deny floor has no entry")
    return want


# --- a strict reader for the subset of YAML Kiro's schema uses -------------------------------------------

def _strip_comment(text, lineno):
    """The line without its comment; quotes are tracked so a # inside one stays."""
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote == '"':
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                quote = None
        elif quote == "'":
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    i += 2
                    continue
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or text[i - 1] in " \t"):
            return text[:i].rstrip()
        i += 1
    if quote:
        raise Refuse("line %d: a quoted scalar does not end on its line" % lineno)
    return text.rstrip()


def _lines(text):
    out = []
    for n, raw in enumerate(text.splitlines(), 1):
        body = _strip_comment(raw.rstrip("\r"), n)
        if not body.strip():
            continue
        if body.strip() in ("---", "..."):
            if out:
                raise Refuse("line %d: more than one YAML document" % n)
            continue
        if "\t" in body[:len(body) - len(body.lstrip())]:
            raise Refuse("line %d: a tab in the indentation" % n)
        out.append((len(body) - len(body.lstrip(" ")), body.strip(), n))
    return out


def _scalar(tok, n):
    tok = tok.strip()
    if not tok:
        raise Refuse("line %d: an empty value" % n)
    if tok[0] == '"':
        try:
            value = json.loads(tok)
        except ValueError:
            raise Refuse("line %d: a double-quoted scalar this reader does not decode: %s" % (n, tok))
        if not isinstance(value, str):
            raise Refuse("line %d: not a string" % n)
        return value
    if tok[0] == "'":
        if len(tok) < 2 or tok[-1] != "'" or re.search(r"(?<!')'(?!')", tok[1:-1]):
            raise Refuse("line %d: a single-quoted scalar this reader does not decode: %s" % (n, tok))
        return tok[1:-1].replace("''", "'")
    if tok[0] in BAD_START or tok.startswith(("- ", "? ", ": ")) or tok == "-":
        raise Refuse("line %d: a value YAML reads as something other than a plain string: %s" % (n, tok))
    if ": " in tok or tok.endswith(":") or " #" in tok:
        raise Refuse("line %d: a plain scalar holding ': ' or ' #': %s" % (n, tok))
    if not_a_string(tok):
        raise Refuse("line %d: %s is not a string in YAML" % (n, tok))
    return tok


def _flow_seq(tok, n):
    if not (tok.startswith("[") and tok.endswith("]")):
        raise Refuse("line %d: a flow sequence must open and close on one line" % n)
    inner = tok[1:-1].strip()
    if not inner:
        return []
    items, cur, quote, i = [], "", None, 0
    while i < len(inner):
        ch = inner[i]
        if quote == '"' and ch == "\\":
            cur += inner[i:i + 2]
            i += 2
            continue
        if quote:
            if ch == quote:
                if quote == "'" and inner[i + 1:i + 2] == "'":
                    cur += "''"
                    i += 2
                    continue
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch in "[]{}":
            raise Refuse("line %d: a nested flow collection" % n)
        elif ch == ",":
            items.append(cur)
            cur = ""
            i += 1
            continue
        cur += ch
        i += 1
    if cur.strip() or not items:
        items.append(cur)
    return [_scalar(x, n) for x in items]


def _key_value(content, n):
    m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s+(.*))?", content)
    if not m:
        raise Refuse("line %d: expected 'key: value', got: %s" % (n, content))
    return m.group(1), (m.group(2) or "").strip()


def _block_seq(lines, i, min_indent):
    """Items '- x' at one indent >= min_indent, from lines[i] -> (raw item lines, next index)."""
    if i >= len(lines) or lines[i][0] < min_indent or not (lines[i][1] == "-" or lines[i][1].startswith("- ")):
        return None, i
    ind = lines[i][0]
    items = []
    while i < len(lines) and lines[i][0] == ind and (lines[i][1] == "-" or lines[i][1].startswith("- ")):
        start = i
        i += 1
        while i < len(lines) and lines[i][0] > ind:
            i += 1
        items.append(lines[start:i])
    if i < len(lines) and lines[i][0] > ind:
        raise Refuse("line %d: unexpected indentation" % lines[i][2])
    return (ind, items), i


def _seq_value(rest, lines, i, parent_indent, n):
    """A key's sequence value: inline flow or a following block of scalars -> (list, next index)."""
    if rest:
        return _flow_seq(rest, n), i
    got, j = _block_seq(lines, i, parent_indent)
    if got is None:
        raise Refuse("line %d: the key has no value" % n)
    out = []
    for item in got[1]:
        ind, content, m = item[0]
        if len(item) != 1 or content == "-":
            raise Refuse("line %d: a sequence item must be one scalar on its line" % m)
        out.append(_scalar(content[2:], m))
    return out, j


def _rule(item):
    ind, content, n = item[0]
    first = content[2:].strip()
    if not first:
        raise Refuse("line %d: a rule must start on its '- ' line" % n)
    if first.startswith("{"):
        raise Refuse("line %d: a rule written as a flow mapping" % n)
    key_indent = ind + 2 + (len(content[2:]) - len(content[2:].lstrip(" ")))
    body = [(key_indent, first, n)] + list(item[1:])
    rule, i = {}, 0
    while i < len(body):
        kind, kcontent, kn = body[i]
        if kind != key_indent:
            raise Refuse("line %d: unexpected indentation in a rule" % kn)
        key, rest = _key_value(kcontent, kn)
        if key in rule:
            raise Refuse("line %d: %s repeated in one rule" % (kn, key))
        if key not in RULE_KEYS:
            raise Refuse("line %d: Kiro rejects a rule with the field %r, and then drops every rule in the file"
                         % (kn, key))
        i += 1
        if key in ("match", "exclude"):
            rule[key], i = _seq_value(rest, body, i, key_indent, kn)
        else:
            if not rest:
                raise Refuse("line %d: %s has no value" % (kn, key))
            rule[key] = _scalar(rest, kn)
    if "capability" not in rule:
        raise Refuse("line %d: a rule with no capability; Kiro would drop every rule in the file" % n)
    if rule.get("effect") not in EFFECTS:
        raise Refuse("line %d: a rule whose effect is not deny, allow or ask; Kiro would drop every rule in the "
                     "file" % n)
    return {k: rule[k] for k in RULE_KEYS if k in rule}


def parse(text):
    """-> {"rules": [rule, ...], "policies": [id, ...] or None}. Raises Refuse."""
    lines = _lines(text)
    doc = {"rules": None, "policies": None}
    i = 0
    if not lines:
        return {"rules": [], "policies": None}
    while i < len(lines):
        ind, content, n = lines[i]
        if ind != 0:
            raise Refuse("line %d: unexpected indentation at the top level" % n)
        key, rest = _key_value(content, n)
        if key not in doc:
            raise Refuse("line %d: a top-level key this reader does not keep: %s" % (n, key))
        if doc[key] is not None:
            raise Refuse("line %d: %s repeated" % (n, key))
        i += 1
        if key == "policies":
            doc[key], i = _seq_value(rest, lines, i, 0, n)
            continue
        if rest:
            if rest != "[]":
                raise Refuse("line %d: rules must be a block list of rules (or [])" % n)
            doc["rules"] = []
            continue
        got, i = _block_seq(lines, i, 0)
        if got is None:
            raise Refuse("line %d: rules has no value" % n)
        doc["rules"] = [_rule(item) for item in got[1]]
    if doc["rules"] is None:
        raise Refuse('no "rules" list; Kiro would reject the file')
    return doc


# --- emit, merge, verify ---------------------------------------------------------------------------------

def _q(s):
    return json.dumps(s, ensure_ascii=True)


def emit(doc, stamp, floor_from, header=True):
    out = [] if not header else ["# %s; source: %s via global/kiro/kiro_permissions.py (only the deny-floor rules recorded as ours "
           "are this project's; every other rule is yours); %s; re-run the installer" % (MARKER_ID, floor_from,
                                                                                         stamp),
           "# The workstation deny floor for Kiro IDE and Kiro CLI V3 (ADR-0036). A deny wins over any allow in",
           "# any scope. Your own rules are kept; comments are not (the installer re-serialises this file)."]
    if doc.get("policies") is not None:
        out.append("policies:" + ("" if doc["policies"] else " []"))
        out += ["  - %s" % _q(p) for p in doc["policies"]]
    if not doc["rules"]:
        out.append("rules: []")
    else:
        out.append("rules:")
        for rule in doc["rules"]:
            first = True
            for key in RULE_KEYS:
                if key not in rule:
                    continue
                lead = "  - " if first else "    "
                first = False
                value = rule[key]
                if isinstance(value, list):
                    if not value:
                        out.append("%s%s: []" % (lead, key))
                    else:
                        out.append("%s%s:" % (lead, key))
                        out += ["      - %s" % _q(v) for v in value]
                else:
                    out.append("%s%s: %s" % (lead, key, _q(value)))
    return "\n".join(out) + "\n"


def covered(rules, cap, pattern):
    return any(r.get("capability") == cap and r.get("effect") == "deny" and not r.get("exclude")
               and pattern in (r.get("match") or []) for r in rules)


def missing(doc, want):
    return {c: [p for p in want[c] if not covered(doc["rules"], c, p)] for c in CAPS}


def stamp_of(text):
    for line in text.splitlines()[:5]:
        if MARKER_ID in line:
            m = re.search(r"; (release: [^;]*; commit: [^;]*);", line)
            return m.group(1) if m else "none"
    return "none"


def merged(doc, miss):
    rules = [dict(r) for r in doc["rules"]]
    for c in CAPS:
        if miss[c]:
            rules.append({"capability": c, "effect": "deny", "match": list(miss[c])})
    return {"rules": rules, "policies": doc.get("policies")}


def verify(new_text, want_doc):
    try:
        got = parse(new_text)
    except Refuse as e:
        raise Refuse("the merged file would not read back (%s); nothing written" % e)
    if got != want_doc:
        raise Refuse("the merged file would not read back as your rules plus the floor; nothing written")


# --- files -----------------------------------------------------------------------------------------------

def write(path, text):
    """Atomic. A file that is a symbolic link is written through; a new file is 0600 in a 0700 directory, as
    Kiro creates it; an existing file keeps its mode."""
    real = Path(os.path.realpath(str(path)))
    if real.exists():
        mode = os.stat(str(real)).st_mode & 0o7777
    else:
        mode = 0o600
        real.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # A random name created with O_EXCL (mkstemp) in the same directory: a symbolic link planted at a
    # predictable temporary path cannot redirect the write.
    fd, tmp = tempfile.mkstemp(prefix=real.name + ".new.", dir=str(real.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, mode)
        refresh_held_locks(str(real))
        os.replace(tmp, str(real))
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    _CHANGED.append(str(real))


def read_owned():
    try:
        doc = json.loads(owned_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or not isinstance(doc.get("appended"), list):
        return None
    appended = [{"capability": e["capability"], "match": list(e["match"])} for e in doc["appended"]
                if isinstance(e, dict) and e.get("capability") in CAPS and isinstance(e.get("match"), list)
                and e["match"] and all(isinstance(p, str) for p in e["match"])]
    return {"appended": appended, "created": doc.get("created") is True}


def write_owned(appended, created, stamp):
    """The record of the rules install appended: each one's capability and match list, as appended."""
    path = owned_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"_": "%s; source: global/kiro/kiro_permissions.py (the deny rules it appended to "
                 "~/.kiro/settings/permissions.yaml; uninstall removes only these); %s; do not edit" % (MARKER_ID, stamp),
            "created": created, "appended": appended}
    write(path, json.dumps(body, indent=2) + "\n")


def is_ours(rule, entry):
    """True when rule is the deny rule install appended for entry: same capability, effect deny, no exclude,
    and exactly entry's match list, in order."""
    return (rule.get("capability") == entry["capability"] and rule.get("effect") == "deny"
            and not rule.get("exclude") and rule.get("match") == entry["match"])


def match_entries(rules, appended):
    """-> for each recorded entry, the index of its own rule, or None. Each rule serves one entry at most.
    Only a rule exactly as install appended it counts. A rule that also holds another pattern (his edit, or
    a consent pattern Kiro appended) cannot be told apart from one of his own, so it is never taken: the
    deny it carries stays, which is the safe direction (PR #150 re-review)."""
    claimed, out = set(), []
    for entry in appended:
        i = next((i for i, r in enumerate(rules) if i not in claimed and is_ours(r, entry)), None)
        if i is not None:
            claimed.add(i)
        out.append(i)
    return out


LOCK_WAIT = 3.0  # seconds; Kiro holds its lock only for one read-modify-write


@contextlib.contextmanager
def kiro_lock(path):
    """Kiro's own lock on permissions.yaml (proper-lockfile, read from the IDE bundle): a directory
    <real file>.lock created with mkdir, which is atomic. Taken with a short bounded wait and held across the
    read, the write and the rename. Still held after the wait: Refuse, nothing written."""
    real = Path(os.path.realpath(str(path)))
    if not real.parent.is_dir():
        yield  # no settings directory: no file, so no Kiro writer to wait for (and none is created here)
        return
    lock = str(real) + ".lock"
    deadline = time.monotonic() + LOCK_WAIT
    while True:
        try:
            os.mkdir(lock, 0o700)
            break
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise Refuse("Kiro's lock %s is held (Kiro is writing the file, or a crashed writer left it); "
                             "nothing written. Re-run when Kiro is idle; if no Kiro is running, remove that "
                             "directory and re-run" % lock)
            time.sleep(0.1)
    st = os.stat(lock)
    ident = (st.st_dev, st.st_ino)
    held = (lock, ident)
    _HELD_LOCKS.append(held)
    try:
        yield
    finally:
        _HELD_LOCKS.remove(held)
        release_lock(lock, ident)


# The lock directories this process holds, with the identity each had when mhw made it. write() checks and
# refreshes them just before its rename, and uninstall just before it removes the file (refresh_held_locks).
_HELD_LOCKS = []
# The files this process has already replaced or removed under the lock, in order, so a refusal that comes
# after one of them says so instead of claiming nothing was written (PR #150 review residual).
_CHANGED = []
# How many deny patterns this run appends to permissions.yaml (set by run() just before it writes).
_APPENDED = 0


def refresh_held_locks(pending):
    """Just before pending (a real path) is replaced or removed: each held lock must still be the directory mhw
    made (same device and inode). If Kiro reclaimed it as stale and took its own, Refuse, so pending is left as
    it is: write() removes its temporary file and renames nothing, uninstall removes nothing. The message says
    which files were already changed before the reclaim was seen, if any. Otherwise the lock's mtime is
    refreshed, so it never looks older than proper-lockfile's stale threshold (10 s, read from the IDE bundle).
    Best effort: an inode can be reused, and a reclaim can still land between this check and the rename."""
    for lock, ident in _HELD_LOCKS:
        try:
            st = os.stat(lock)
        except OSError:
            st = None
        if st is None or (st.st_dev, st.st_ino) != ident:
            raise Refuse(reclaimed_message(lock, pending))
        os.utime(lock)


def reclaimed_message(lock, pending):
    """What a refusal after a reclaim must say: the truth about what this run already changed."""
    head = "Kiro's lock %s is no longer the one mhw took (Kiro reclaimed it as stale)" % lock
    if not _CHANGED:
        return head + "; %s not changed, so no rule Kiro is writing is lost. Re-run" % pending
    msg = "%s; %s was already changed before that, and %s was not" % (head, " and ".join(_CHANGED), pending)
    if _APPENDED and Path(pending) == Path(os.path.realpath(str(owned_path()))):
        # Only the record can be left behind: the rules this run appended are in the file and not recorded, so
        # they read as the owner's from now on (install never records a pattern already present).
        msg += (". The deny rules this run appended are in the file but not in mhw's record, so uninstall will "
                "leave them in place (the safe direction); remove them by hand if you want them gone")
    return msg


def release_lock(lock, ident):
    """Remove the lock only when it still looks like ours (same device and inode as the directory we made;
    best effort, since an inode can be reused and a reclaim can land between the stat and the rmdir);
    otherwise Kiro may have reclaimed it as stale and taken it, so it is left alone. A failure to remove is
    reported, never raised: by then the write has succeeded."""
    try:
        st = os.stat(lock)
    except OSError:
        print("NOTE    Kiro's lock %s was gone before mhw released it; nothing removed" % lock)
        return
    if (st.st_dev, st.st_ino) != ident:
        print("NOTE    Kiro's lock %s is no longer the one mhw took (Kiro reclaimed it); left alone" % lock)
        return
    try:
        os.rmdir(lock)
    except OSError as e:
        print("NOTE    could not release Kiro's lock %s (%s); remove that directory if no Kiro is running"
              % (lock, e.__class__.__name__))


# --- modes -----------------------------------------------------------------------------------------------

def load_target(path):
    """-> (text or None, doc). Raises Refuse."""
    json_path = path.with_name("permissions.json")
    if not path.exists() and json_path.exists():
        try:
            nonempty = json_path.read_text(encoding="utf-8").strip() != ""
        except (OSError, UnicodeDecodeError):
            nonempty = True
        if nonempty:
            raise Refuse("%s holds your rules, and Kiro reads permissions.yaml instead of it when both exist; "
                         "nothing written. Move its rules into permissions.yaml (same schema), then re-run"
                         % json_path)
    if not path.exists():
        return None, {"rules": [], "policies": None}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise Refuse("unreadable (%s); left untouched" % e.__class__.__name__)
    try:
        return text, parse(text)
    except Refuse as e:
        raise Refuse("%s. Kiro probably rewrote this file after a consent prompt: its writer folds a long pattern "
                     "onto several lines and leaves values such as yes unquoted, which this reader refuses rather "
                     "than guess at. Nothing written. Put each pattern on one line, quoted (\"...\"), or restore "
                     "%s%s and add your new rule again, then re-run" % (e, path.name, BACKUP))


def total(want):
    return sum(len(v) for v in want.values())


# --- the root-owned admin copy (ADR-0036, 2026-10-11 amendment) ------------------------------------------
# Kiro IDE 1.2.56 and the Kiro CLI V3 engine (kas 2.29.1) read a root-owned managed-settings.json as their
# "administration" scope: the same rules schema as permissions.yaml, parsed as JSON, deny and ask only (read
# from both bundles). The same file is read by Kiro's sign-in "login controls", which act only on rules of
# capability signin_method and on a "settings" object, neither of which is rendered here. install-managed.sh
# writes it, as root, from the floor install.sh rendered; this script only renders and counts.
NAME = "personal-multi-harness-workstation-configuration"


# A rejected admin file is not "no rule": Kiro catches the parse error as fatal, builds its policy engine with
# policyLoaded=false, and that engine answers deny to EVERY tool call (IDE 1.2.56 and kas 2.29.1, read from
# both bundles). The same happens when a compiled Cedar statement with 64 or more conditions fails Kiro's
# cedar-wasm probe ("treating as invalid (deny-all)"). Kiro compiles each match pattern to its own statement
# whose condition count is 1 (the pattern) + one per exclude + 1 for an ask rule, so the pattern count of a
# rule does not add up; the exclude list does. CONDITION_CEILING keeps every statement far under that limit.
KIRO_CONDITION_LIMIT = 64
CONDITION_CEILING = 32
ROLLBACK = ("Kiro IDE and the Kiro CLI V3 engine deny every tool call while a file Kiro rejects is there; remove "
            "it with sudo /bin/sh global/install-managed.sh --remove (or delete that one file as root). Kiro CLI "
            "2.x does not read it")


def conditions(rule):
    """Conditions in each Cedar statement Kiro compiles from this rule (its Vpd/yQc, read from the bundles)."""
    match = rule.get("match") or []
    match_all = not match or match == ["*"]
    return (0 if match_all else 1) + len(rule.get("exclude") or []) + (1 if rule.get("effect") == "ask" else 0)


def admin_check(doc):
    """Raise Refuse unless doc is an admin document of ours that Kiro accepts with every statement under
    CONDITION_CEILING conditions."""
    if not isinstance(doc, dict) or set(doc) != {"rules", NAME}:
        raise Refuse("the top level must be the rules list and the %s key, nothing else" % NAME)
    if not isinstance(doc[NAME], str) or MARKER_ID not in doc[NAME] or "; release: " not in doc[NAME] \
            or "; commit: " not in doc[NAME]:
        raise Refuse("the %s key does not carry the provenance stamp" % NAME)
    rules = doc["rules"]
    if not isinstance(rules, list) or not rules:
        raise Refuse("rules must be a non-empty list")
    seen = set()
    for i, r in enumerate(rules):
        # Kiro rejects an unknown rule field; the administration scope allows deny and ask, and only deny is ours.
        if not isinstance(r, dict) or not set(r) <= {"capability", "effect", "match", "exclude"} \
                or "match" not in r or r.get("effect") != "deny" or r.get("capability") not in CAPS:
            raise Refuse("rule %d is not a deny rule of shell, fs_read or fs_write with only Kiro's fields" % i)
        for k in ("match", "exclude"):
            v = r.get(k, [])
            if not isinstance(v, list) or not all(isinstance(x, str) and x for x in v):
                raise Refuse("rule %d: %s must be a list of non-empty strings" % (i, k))
        if not r["match"]:
            raise Refuse("rule %d: an empty match list would deny the whole capability" % i)
        n = conditions(r)
        if n > CONDITION_CEILING:
            raise Refuse("rule %d compiles to statements of %d conditions, over the ceiling of %d (Kiro treats "
                         "%d or more that fail its cedar-wasm check as deny-all)"
                         % (i, n, CONDITION_CEILING, KIRO_CONDITION_LIMIT))
        seen.add(r["capability"])
    if len(seen) != len(rules):
        raise Refuse("one rule per capability")


def admin_validate(path):
    """Raise Refuse unless the file at path is an admin document Kiro accepts (bytes as Kiro reads them)."""
    try:
        raw = Path(path).read_bytes()
    except OSError as e:
        raise Refuse("unreadable (%s)" % e.__class__.__name__)
    if raw.startswith(b"\xef\xbb\xbf"):
        raise Refuse("starts with a byte order mark, which Kiro refuses")
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as e:
        raise Refuse("not JSON Kiro can parse (%s)" % e.__class__.__name__)
    admin_check(doc)
    return doc


def admin_doc(want, stamp):
    """The admin document: one stamp key of ours (JSON has no comment) and one deny rule per capability."""
    doc = {NAME: "%s; source: global/install-managed.sh via global/kiro/kiro_permissions.py; %s; do not edit, "
                 "re-run the installer" % (MARKER_ID, stamp),
           "rules": [{"capability": c, "effect": "deny", "match": list(want[c])} for c in CAPS if want[c]]}
    admin_check(doc)
    return doc


def want_from_yaml(path):
    """The floor as install.sh rendered it into a fresh permissions.yaml: its deny rules, in order."""
    doc = parse(Path(path).read_text(encoding="utf-8"))
    want = {c: [] for c in CAPS}
    for r in doc["rules"]:
        if r.get("effect") != "deny" or r.get("exclude") or r.get("capability") not in CAPS:
            raise Refuse("%s holds a rule that is not a plain floor deny rule" % path)
        for p in r.get("match") or []:
            if p not in want[r["capability"]]:
                want[r["capability"]].append(p)
    if not any(want.values()):
        raise Refuse("%s holds no deny-floor pattern" % path)
    return want


def admin_report(admin, want):
    """One FLOOR line for the admin copy: absent, not ours, unreadable, or n/m floor patterns."""
    n_want = total(want)
    where = "admin managed-settings.json"
    if not os.path.lexists(admin):
        state = "absent"
    else:
        try:
            with open(admin, encoding="utf-8") as f:
                doc = json.load(f)
        except (OSError, UnicodeDecodeError, ValueError) as e:
            state = "not read (%s); if Kiro cannot parse it either: %s" % (e.__class__.__name__, ROLLBACK)
        else:
            if not isinstance(doc, dict) or MARKER_ID not in str(doc.get(NAME, "")):
                state = "present and NOT managed by this project"
            else:
                try:
                    admin_validate(admin)
                except Refuse as e:
                    state = "INVALID (%s): %s" % (e, ROLLBACK)
                else:
                    n_miss = sum(1 for c in CAPS for p in want[c] if not covered(doc["rules"], c, p))
                    state = "%d/%d floor patterns" % (n_want - n_miss, n_want)
    print("FLOOR   Kiro: %s %s (read by Kiro IDE 1.2.56 and the Kiro CLI V3 engine as the administration scope, "
          "read from their bundles; Kiro CLI 2.x does not read it; not enforced-measured; ADR-0036)"
          % (where, state))


def run(mode, stamp, want, floor_from):
    path = target()
    n_want = total(want)
    try:
        text, doc = load_target(path)
    except Refuse as e:
        if mode == "report":
            print("FLOOR   Kiro: user permissions.yaml not read (%s)" % e)
            return 0
        print("REFUSE  %s: %s" % (path, e))
        return 3
    miss = missing(doc, want)
    n_miss = total(miss)
    if mode == "report":
        state = "absent" if text is None else "%d/%d floor patterns" % (n_want - n_miss, n_want)
        print("FLOOR   Kiro: user permissions.yaml %s (read by Kiro IDE and Kiro CLI V3, documented; Kiro CLI "
              "2.x does not read it; not enforced-measured; ADR-0036)" % state)
        return 0
    # Install reconciles the record with the file first: an entry whose rule is gone (or edited past
    # recognition) is forgotten, so the record never holds an entry without its own rule, and a later
    # uninstall cannot claim one of the owner's rules for it, unless his rule is byte-identical to the one
    # mhw appended (PR #150 re-review).
    rec = read_owned() if mode == "install" else None
    kept = []
    if rec is not None:
        found = match_entries(doc["rules"], rec["appended"])
        kept = [e for e, i in zip(rec["appended"], found) if i is not None]
        if len(kept) != len(rec["appended"]):
            print("NOTE    %s: %d recorded mhw rule(s) no longer in %s (removed or edited by hand); forgotten, so "
                  "uninstall never takes one of your rules for them" % (owned_path(), len(rec["appended"]) - len(kept),
                                                                       path))
            write_owned(kept, rec["created"], stamp)
    have = stamp_of(text) if text is not None else "none"
    if text is not None and n_miss == 0 and have == stamp:
        print("OK      %s (all %d deny-floor patterns present; %s)" % (path, n_want, stamp))
        return 0
    if mode == "check":
        if text is None:
            print("MISSING %s" % path)
        elif n_miss == 0:
            print("STAMP   %s: the deny-floor patterns match, but it carries (%s) and the source is (%s)"
                  % (path, have, stamp))
        else:
            print("DRIFT   %s (%d deny-floor pattern(s) missing; %s)" % (path, n_miss, have))
        return 1
    new_doc = merged(doc, miss)
    new_text = emit(new_doc, stamp, floor_from)
    try:
        verify(new_text, new_doc)
    except Refuse as e:
        print("REFUSE  %s: %s" % (path, e))
        return 3
    if mode == "dry-run":
        print("WOULD MERGE %s: %d deny-floor pattern(s), every rule of yours kept (backup %s%s):"
              % (path, n_miss, path.name, BACKUP))
        for c in CAPS:
            for p in miss[c]:
                print("  + %s deny %s" % (c, p))
        return 0
    created = rec["created"] if rec else text is None
    appended = kept + [{"capability": c, "match": list(miss[c])} for c in CAPS if miss[c]]
    backup = Path(str(path) + BACKUP)
    if text is not None:
        private_copy(os.path.realpath(str(path)), str(backup))
    global _APPENDED
    _APPENDED = n_miss
    write(path, new_text)
    write_owned(appended, created, stamp)
    if text is None:
        print("MERGED  %s (new file; %d deny-floor patterns)" % (path, n_want))
    elif n_miss == 0:
        print("RESTAMPED %s (%s; previous version kept as %s)" % (path, stamp, backup))
    else:
        print("MERGED  %s (%d deny-floor pattern(s) added, every rule of yours kept; previous version kept as %s)"
              % (path, n_miss, backup))
    return 0


def uninstall(stamp, floor_from):
    path = target()
    rec = read_owned()
    if rec is None:
        if path.exists():
            print("NOTE    %s: no record of which deny rules mhw added; nothing removed (a deny left behind is the "
                  "safe direction). Remove them by hand if you want them gone" % path)
        return 0
    if not path.exists():
        owned_path().unlink()
        print("REMOVED %s (the file it describes is gone)" % owned_path())
        return 0
    try:
        text, doc = load_target(path)
    except Refuse as e:
        print("REFUSE  %s: %s" % (path, e))
        return 3
    # Only the rules install appended are edited, never one of the owner's unless it is byte-identical to
    # one mhw appended (which cannot be told apart): each recorded entry is matched
    # to its own distinct rule (match_entries). One that cannot be matched is left alone, said.
    rules = [dict(r) for r in doc["rules"]]
    drop = set()
    for entry, i in zip(rec["appended"], match_entries(doc["rules"], rec["appended"])):
        if i is None:
            print("NOTE    %s: the %s deny rule mhw appended (%d pattern(s)) was not found as its own rule "
                  "(removed or edited by hand?); nothing removed for it (a deny left behind is the safe direction)"
                  % (path, entry["capability"], len(entry["match"])))
            continue
        # The rule holds exactly what install appended, so it goes whole (never left with an empty match
        # list, which would match everything).
        drop.add(i)
    rules = [r for i, r in enumerate(rules) if i not in drop]
    new_doc = {"rules": rules, "policies": doc.get("policies")}
    if rec["created"] and not rules and not doc.get("policies"):
        private_copy(os.path.realpath(str(path)), str(path) + BACKUP)
        # Guarded like a rename: if Kiro reclaimed the lock, the file stays (PR #150 review residual).
        refresh_held_locks(os.path.realpath(str(path)))
        path.unlink()
        print("REMOVED %s (mhw created it and only its deny-floor rules were in it; kept as %s%s)"
              % (path, path, BACKUP))
    elif new_doc == doc:
        print("OK      %s holds no deny rule mhw added" % path)
    else:
        new_text = emit(new_doc, stamp, floor_from, header=False)
        try:
            verify(new_text, new_doc)
        except Refuse as e:
            print("REFUSE  %s: %s" % (path, e))
            return 3
        private_copy(os.path.realpath(str(path)), str(path) + BACKUP)
        write(path, new_text)
        print("UNMERGED %s (the deny rules mhw added removed, your rules kept; previous version kept as "
              "%s%s)" % (path, path, BACKUP))
    owned_path().unlink()
    print("REMOVED %s" % owned_path())
    return 0


def main(argv=None):
    args = argv if argv is not None else sys.argv[1:]
    opts = {}
    for a in args:
        k, sep, v = a.partition("=")
        if not sep or k not in ("--mode", "--stamp", "--floor", "--floor-from", "--admin", "--from-yaml", "--file") \
                or k in opts:
            opts = None
            break
        opts[k] = v
    if opts and opts.get("--mode") == "admin-validate":
        # install-managed.sh's check of the staged admin document, before it is installed as root.
        if set(opts) != {"--mode", "--file"}:
            print("usage: kiro_permissions.py --mode=admin-validate --file=FILE (the JSON admin document)",
                  file=sys.stderr)
            return 2
        try:
            admin_validate(opts["--file"])
        except Refuse as e:
            print("REFUSE  Kiro admin document %s: %s" % (opts["--file"], e), file=sys.stderr)
            return 3
        return 0
    if opts and opts.get("--mode") == "admin-json":
        # The admin document for install-managed.sh, from the permissions.yaml install.sh rendered into a
        # throwaway home: printed on stdout, nothing written.
        if not opts.get("--stamp") or not opts.get("--from-yaml") or set(opts) != {"--mode", "--stamp", "--from-yaml"}:
            print("usage: kiro_permissions.py --mode=admin-json --stamp=STAMP --from-yaml=FILE", file=sys.stderr)
            return 2
        try:
            want = want_from_yaml(opts["--from-yaml"])
            doc = admin_doc(want, opts["--stamp"])
        except (OSError, UnicodeDecodeError, Refuse) as e:
            print("REFUSE  Kiro admin document: %s" % e, file=sys.stderr)
            return 3
        print(json.dumps(doc, indent=2, ensure_ascii=True))
        return 0
    modes = ("install", "check", "dry-run", "uninstall", "report")
    if not opts or opts.get("--mode") not in modes or not opts.get("--stamp") or not opts.get("--floor") \
            or "--from-yaml" in opts or "--file" in opts or ("--admin" in opts and opts["--mode"] != "report"):
        print("usage: kiro_permissions.py --mode=install|check|dry-run|uninstall|report --stamp=STAMP "
              "--floor=FILE [--floor-from=TEXT] [--admin=FILE, report only]\n"
              "       kiro_permissions.py --mode=admin-json --stamp=STAMP --from-yaml=FILE", file=sys.stderr)
        return 2
    floor_from = opts.get("--floor-from") or "global/deny-floor.conf"
    try:
        want = load_floor(opts["--floor"])
    except (OSError, ValueError) as e:
        print("REFUSE  Kiro deny floor: %s" % e, file=sys.stderr)
        return 2
    mode = opts["--mode"]
    if mode not in ("install", "uninstall"):
        code = run(mode, opts["--stamp"], want, floor_from)
        if opts.get("--admin"):
            admin_report(opts["--admin"], want)
        return code
    # A writing mode holds Kiro's own lock from before the read until after the rename, so while both honour
    # it a consent rule Kiro writes meanwhile is not lost (best effort; see kiro_lock, PR #150 lens).
    try:
        with kiro_lock(target()):
            if mode == "uninstall":
                return uninstall(opts["--stamp"], floor_from)
            return run(mode, opts["--stamp"], want, floor_from)
    except Refuse as e:
        print("REFUSE  %s: %s" % (target(), e))
        return 3


if __name__ == "__main__":
    sys.exit(main())
