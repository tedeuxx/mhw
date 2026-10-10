#!/usr/bin/env python3
"""Install the session-start default model and reasoning effort per agent harness (ADR-0007, ADR-0035).

    model_defaults.py --mode=install|check|dry-run|uninstall [--stamp="release: R; commit: C"]
                      [--policy=FILE|none] [--home=DIR]

The policy is one versioned file, overlay/model-defaults.json (the owner's values: model IDs depend on
his subscriptions, so the generic layer pins none). Each value is written into the harness's own native
user-level key, and nothing else in that file is touched:

    Claude Code  ~/.claude/settings.json            model, effortLevel
    Codex        ${CODEX_HOME:-~/.codex}/config.toml  model, model_reasoning_effort (top-level keys)
    Kiro CLI     ~/.kiro/settings/cli.json            chat.defaultModel

Kiro takes no effort here: its effort is a per-model entry (chat.modelDefaults.<id>), and whether the
pinned model accepts one was not verified, so the policy schema refuses a Kiro effort.

Ownership. These files belong to the owner, so the keys mhw set are recorded, with the provenance stamp,
in ${XDG_DATA_HOME:-~/.local/share}/personal-multi-harness-workstation-configuration/model-defaults.json.
A key is written only when it is absent, or still holds the value mhw recorded writing. A key holding
any other value is the owner's: it is never overwritten (KEPT, exit unchanged), and the line says how to
hand it over. Uninstall removes a key only while it still holds the value mhw recorded. Every write
leaves the previous file beside it as <file>.pmhwc-models-backup. A TOML edit is parsed (tomllib, Python
3.11+) before it replaces the file; one that would not parse is refused and nothing is written. A
recorded file outside --home (and CODEX_HOME) is never edited.

Output lines use install.sh's words: OK, SET, STAMP, DRIFT, MISSING, STALE, KEPT, REFUSE, REMOVED, WOULD.
Exit codes: 0 ok (an owner's value KEPT included); 1 a target differs (--check); 2 usage or invalid
policy; 3 a file or value mhw cannot read, a foreign record, or an edit that would not parse.
Standard library only, Python 3.9+.
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

MARKER_ID = "managed-by: personal-multi-harness-workstation-configuration"
NAME = "personal-multi-harness-workstation-configuration"
SOURCE = "overlay/model-defaults.json"
BACKUP = ".pmhwc-models-backup"
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*(\[1m\])?")

# harness -> (file format, {policy field: native key}, allowed efforts or None, aliases refused)
HARNESSES = {
    "claude-code": ("json4", {"model": "model", "effort": "effortLevel"},
                    ("low", "medium", "high", "xhigh", "max"),
                    ("default", "best", "opus", "sonnet", "haiku", "fable", "opusplan")),
    "codex": ("toml", {"model": "model", "effort": "model_reasoning_effort"},
              ("minimal", "low", "medium", "high", "xhigh"), ()),
    "kiro-cli": ("json2", {"model": "chat.defaultModel"}, None, ("auto",)),
}


class PolicyError(Exception):
    pass


def target_path(harness, home):
    if harness == "claude-code":
        return home / ".claude" / "settings.json"
    if harness == "codex":
        return Path(os.environ.get("CODEX_HOME") or home / ".codex") / "config.toml"
    return home / ".kiro" / "settings" / "cli.json"


def record_path(home):
    return Path(os.environ.get("XDG_DATA_HOME") or home / ".local" / "share") / NAME / "model-defaults.json"


def load_policy(path):
    """-> {harness: {native key: value}}. Model IDs only, never an alias (ADR-0035, decision 8)."""
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise PolicyError("cannot read %s: %s" % (path, e))
    if not isinstance(doc, dict) or doc.get("version") != 1:
        raise PolicyError("%s: an object with \"version\": 1 is required" % path)
    out = {}
    for harness, entry in doc.items():
        if harness == "version":
            continue
        if harness not in HARNESSES:
            raise PolicyError("%s: unknown agent harness %r (known: %s)" % (path, harness, ", ".join(HARNESSES)))
        _, keys, efforts, aliases = HARNESSES[harness]
        if not isinstance(entry, dict) or not isinstance(entry.get("model"), str):
            raise PolicyError("%s: %s needs a \"model\" string" % (path, harness))
        for field in entry:
            if field not in keys:
                raise PolicyError("%s: %s takes no %r here (its fields: %s)" % (path, harness, field, ", ".join(keys)))
        model = entry["model"]
        if not ID_RE.fullmatch(model) or model.split("[")[0] in aliases:
            raise PolicyError("%s: %s model %r is not a pinned model ID (an alias is refused)" % (path, harness, model))
        if "effort" in entry and entry["effort"] not in efforts:
            raise PolicyError("%s: %s effort %r is not one of %s" % (path, harness, entry["effort"], ", ".join(efforts)))
        out[harness] = {keys[f]: entry[f] for f in keys if f in entry}
    return out


# --------------------------------------------------------------------------------------------------
# Native files: read one key, write a set of keys. A TOML file is edited line by line, top level only.

UNREADABLE = object()


def _toml_line(key):
    """A top-level assignment of the key in any of its three TOML spellings: bare, "basic" or 'literal'.
    Matching only the bare one read a quoted key as absent and inserted a duplicate (PR #119 lens)."""
    k = re.escape(key)
    return re.compile(r"\s*(?:%s|\"%s\"|'%s')\s*=" % (k, k, k))


def _toml_value(line):
    m = re.fullmatch(r"\s*(?:[A-Za-z0-9_.-]+|\"[^\"\\]*\"|'[^']*')\s*=\s*(?:\"([^\"\\]*)\"|'([^']*)')\s*(#.*)?",
                     line)
    if not m:
        return UNREADABLE
    return m.group(1) if m.group(1) is not None else m.group(2)


def _top_level(lines):
    for i, line in enumerate(lines):
        if line.lstrip().startswith("["):
            return i
    return len(lines)


class NativeFile:
    def __init__(self, harness, path):
        self.fmt = HARNESSES[harness][0]
        self.path = path
        self.exists = path.exists()
        self.doc = None
        self.lines = None
        text = path.read_text(encoding="utf-8") if self.exists else ""
        if self.fmt == "toml":
            self.lines = text.splitlines()
        else:
            self.doc = json.loads(text) if text.strip() else {}
            if not isinstance(self.doc, dict):
                raise ValueError("not a JSON object")

    def get(self, key):
        if self.doc is not None:
            value = self.doc.get(key)
            return value if value is None or isinstance(value, str) else UNREADABLE
        for line in self.lines[:_top_level(self.lines)]:
            if _toml_line(key).match(line):
                return _toml_value(line)
        return None

    def put(self, key, value):
        """value None removes the key."""
        if self.doc is not None:
            if value is None:
                self.doc.pop(key, None)
            else:
                self.doc[key] = value
            return
        top = _top_level(self.lines)
        for i, line in enumerate(self.lines[:top]):
            if _toml_line(key).match(line):
                if value is None:
                    del self.lines[i]
                else:
                    self.lines[i] = "%s = %s" % (key, json.dumps(value))
                return
        if value is not None:
            self.lines.insert(0, "%s = %s" % (key, json.dumps(value)))

    def text(self):
        if self.doc is not None:
            return json.dumps(self.doc, indent=4 if self.fmt == "json4" else 2, ensure_ascii=False) + "\n"
        return "\n".join(self.lines) + "\n" if self.lines else ""

    def invalid(self):
        """-> why the new text would not parse, or None. TOML is edited line by line, so the result is
        parsed with tomllib (Python 3.11+) before anything is written; on an older Python the check is
        skipped and the line editor alone stands. JSON is serialised whole and cannot come out invalid."""
        if self.fmt != "toml":
            return None
        try:
            import tomllib
        except ImportError:
            return None
        try:
            tomllib.loads(self.text())
        except tomllib.TOMLDecodeError as e:
            return str(e)
        return None

    def write(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".new.%d" % os.getpid())
        tmp.write_text(self.text(), encoding="utf-8")
        if self.exists:
            shutil.copy2(self.path, str(self.path) + BACKUP)
            shutil.copymode(self.path, tmp)
        os.replace(tmp, self.path)


def show(pairs):
    return ", ".join("%s = %s" % (k, json.dumps(v)) for k, v in pairs.items()) or "no key"


# --------------------------------------------------------------------------------------------------

def read_record(path):
    """-> (record dict, stamp or None, state): state 'absent', 'ours' or 'foreign'."""
    if not path.exists():
        return {}, None, "absent"
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        managed = doc.get("managed-by", "")
    except (OSError, ValueError, AttributeError):
        return {}, None, "foreign"
    if not isinstance(managed, str) or MARKER_ID not in managed or not isinstance(doc.get("set"), dict):
        return {}, None, "foreign"
    m = re.search(r"; (release: [^;]*; commit: [^;]*);", managed)
    return doc["set"], (m.group(1) if m else None), "ours"


def record_text(entries, stamp):
    doc = {"managed-by": "%s; source: %s; %s; do not edit, re-run the installer" % (MARKER_ID, SOURCE, stamp),
           "note": "The session-start model and effort keys this project set, per file; it removes only these.",
           "set": entries}
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def plan(policy, home, record):
    """-> list of (harness, path, want {key: value}, recorded {key: value})."""
    out, seen = [], set()
    for harness in HARNESSES:
        path = target_path(harness, home)
        rec = record.get(str(path), {})
        want = policy.get(harness, {})
        if want or rec.get("keys"):
            out.append((harness, path, want, dict(rec.get("keys") or {})))
        seen.add(str(path))
    for p, rec in record.items():
        if p not in seen and rec.get("harness") in HARNESSES and rec.get("keys"):
            out.append((rec["harness"], Path(p), {}, dict(rec["keys"])))
    return out


def _inside(path, roots):
    target = Path(os.path.abspath(str(path)))
    for root in roots:
        base = Path(os.path.abspath(str(root)))
        if target == base or base in target.parents:
            return True
    return False


def main(argv=None):
    mode, stamp, policy_file, home = None, "release: unknown; commit: unknown", None, Path.home()
    for arg in (argv if argv is not None else sys.argv[1:]):
        if arg.startswith("--mode="):
            mode = arg.split("=", 1)[1]
        elif arg.startswith("--stamp="):
            stamp = arg.split("=", 1)[1]
        elif arg.startswith("--policy="):
            policy_file = arg.split("=", 1)[1]
        elif arg.startswith("--home="):
            home = Path(arg.split("=", 1)[1])
        else:
            print("unknown argument: %s" % arg, file=sys.stderr)
            return 2
    if mode not in ("install", "check", "dry-run", "uninstall"):
        print("--mode=install|check|dry-run|uninstall is required", file=sys.stderr)
        return 2
    try:
        policy = {} if mode == "uninstall" or policy_file in (None, "", "none") else load_policy(policy_file)
    except PolicyError as e:
        print("REFUSE  model defaults: %s; nothing written" % e, file=sys.stderr)
        return 2

    rpath = record_path(home)
    record, rec_stamp, rstate = read_record(rpath)
    if rstate == "foreign":
        print("REFUSE  %s: exists and is NOT managed by this project; move it aside" % rpath)
        return 3

    status = 0
    pending = False
    new_record = {}
    roots = [home] + ([Path(os.environ["CODEX_HOME"])] if os.environ.get("CODEX_HOME") else [])
    for harness, path, want, rec in plan(policy, home, record):
        if not _inside(path, roots):
            # A recorded file outside --home (and CODEX_HOME) is never edited: a record read through a
            # leaked XDG_DATA_HOME must not reach the real settings of a test's or a dry run's caller.
            print("NOTE    %s: recorded, but outside %s; left untouched" % (path, home))
            new_record[str(path)] = {"harness": harness, "keys": rec}
            continue
        try:
            nf = NativeFile(harness, path)
        except (OSError, ValueError, UnicodeDecodeError):
            print("REFUSE  %s: not readable as its format; model defaults left untouched" % path)
            status = max(status, 3)
            if rec:
                new_record[str(path)] = {"harness": harness, "keys": rec}
            continue
        keep, changes, refused, unreadable, notes = {}, {}, [], [], []
        for key in list(want) + [k for k in rec if k not in want]:
            cur, w, r = nf.get(key), want.get(key), rec.get(key)
            if mode == "uninstall":
                w = None
            if w is not None:
                if cur == w:
                    if r is not None:
                        keep[key] = w
                elif cur is None or (r is not None and cur == r):
                    changes[key] = w
                    keep[key] = w
                elif cur is UNREADABLE:
                    unreadable.append("%s holds a value mhw cannot read, the policy says %s" % (key, json.dumps(w)))
                else:
                    refused.append("%s is %s, the policy says %s" % (key, json.dumps(cur), json.dumps(w)))
            elif r is not None:
                if cur == r:
                    changes[key] = None
                elif cur is not None:
                    notes.append("%s was changed to a value of yours; left alone" % key)
        label = "model defaults %s" % harness
        if refused:
            # KEPT, not REFUSE: the owner's value is a settled state, not a failure. It changes no exit
            # code (so it masks no real failure in another install step) and it is no pending write
            # (so a repeated install settles); `mhw status` and the install's next steps still name it.
            print("KEPT    %s: %s (%s); your value, not overwritten. Delete the key and re-run install to "
                  "have mhw set and own it, or keep your value" % (path, "; ".join(refused), label))
        if unreadable:
            status = max(status, 3)
            print("REFUSE  %s: %s (%s); not readable, so not overwritten" % (path, "; ".join(unreadable), label))
        for note in notes:
            print("NOTE    %s: %s" % (path, note))
        if not changes:
            if keep:
                new_record[str(path)] = {"harness": harness, "keys": keep}
            if not refused and not unreadable and mode != "uninstall":
                mine = "" if keep == want else " (a value equal to the policy that you set stays yours)"
                print("OK      %s: %s (%s)%s" % (path, show(want), label, mine))
            continue
        sets = {k: v for k, v in changes.items() if v is not None}
        drops = [k for k, v in changes.items() if v is None]
        what = "; ".join(filter(None, ["set " + show(sets) if sets else "",
                                       "remove " + ", ".join(drops) if drops else ""]))
        word = "STALE  " if not sets else ("MISSING" if all(nf.get(k) is None for k in sets) else "DRIFT  ")
        for k, v in changes.items():
            nf.put(k, v)
        broken = nf.invalid()
        if broken:
            # The edit would leave a file the agent harness cannot parse: write nothing, record nothing new.
            status = max(status, 3)
            print("REFUSE  %s: setting the model defaults would make it unparseable (%s); nothing written "
                  "(%s)" % (path, broken, label))
            if rec:
                new_record[str(path)] = {"harness": harness, "keys": rec}
            continue
        if keep:
            new_record[str(path)] = {"harness": harness, "keys": keep}
        if mode == "check":
            print("%s %s: install would %s (%s)" % (word, path, what, label))
            status = max(status, 1)
            pending = True
        elif mode == "dry-run":
            print("WOULD SET %s: %s (%s; backup %s%s)" % (path, what, label, path.name, BACKUP))
        else:
            nf.write()
            verb = "REMOVED" if mode == "uninstall" else "SET    "
            kept = "; previous file kept as %s%s" % (path, BACKUP) if nf.exists else "; new file"
            print("%s %s: %s (%s%s)" % (verb, path, what, label, kept))

    # The ownership record, with the provenance stamp.
    if new_record:
        if rstate == "ours" and record == new_record and rec_stamp == stamp:
            print("OK      %s (%s)" % (rpath, stamp))
        elif mode == "check" and pending:
            pass  # the harness line above already says what install would do, record included
        elif mode == "check":
            if rstate == "ours" and record == new_record:
                print("STAMP   %s: content matches, but it carries (%s) and the source is (%s)" % (rpath, rec_stamp, stamp))
            elif rstate == "absent":
                print("MISSING %s" % rpath)
            else:
                print("DRIFT   %s" % rpath)
            status = max(status, 1)
        elif mode == "dry-run":
            print("WOULD WRITE %s (the record of the model-default keys mhw set)" % rpath)
        else:
            rpath.parent.mkdir(parents=True, exist_ok=True)
            tmp = rpath.with_name(rpath.name + ".new.%d" % os.getpid())
            tmp.write_text(record_text(new_record, stamp), encoding="utf-8")
            os.replace(tmp, rpath)
            print("WROTE   %s (%s)" % (rpath, stamp))
    elif rstate == "ours":
        if mode == "check" and pending:
            pass
        elif mode == "check":
            print("STALE   %s: records no key any more; install removes it" % rpath)
            status = max(status, 1)
        elif mode == "dry-run":
            print("WOULD REMOVE %s" % rpath)
        else:
            rpath.unlink()
            print("REMOVED %s" % rpath)
    return status


if __name__ == "__main__":
    sys.exit(main())
